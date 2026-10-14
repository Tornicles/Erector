// Hosted two-user Supabase acceptance runner (Prompt 1).
// Reads credentials from gitignored env files; never prints secrets.
// Usage: node scripts/hosted-acceptance.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const root = resolve(process.cwd());
const fe = loadEnv(resolve(root, 'frontend/.env.local'));
const be = loadEnv(resolve(root, 'backend/.env'));

const URL = (fe.VITE_SUPABASE_URL || be.SUPABASE_URL || '').replace(/\/$/, '');
const ANON = fe.VITE_SUPABASE_PUBLISHABLE_KEY || be.SUPABASE_PUBLISHABLE_KEY;
const SR = be.SUPABASE_SERVICE_ROLE_KEY;
const apiBase = (process.env.TONDE_BACKEND_URL || fe.VITE_API_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');

async function apiRequest(path, token, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const envelope = await response.json();
  if (!response.ok || !envelope.success || !envelope.data) throw new Error(`API ${path}: HTTP ${response.status}`);
  return envelope.data;
}

async function uploadPrivateReference(workspace, token) {
  const intent = await apiRequest(`/api/v1/workspaces/${workspace}/media/upload-intents`, token,
    { purpose: 'reference', original_filename: 'acceptance.txt', mime_type: 'text/plain', expected_bytes: 5, resumable: false });
  const signed = await apiRequest(`/api/v1/workspaces/${workspace}/media/upload-intents/${intent.intent_id}/signed-upload`, token, {});
  if (signed.intent_id !== intent.intent_id || signed.media_id !== intent.media_id
    || signed.object_key !== intent.object_key || signed.bucket !== intent.bucket) throw new Error('Signed upload scope mismatch');
  const up = await req(`/storage/v1/object/upload/sign/${signed.bucket}/${signed.object_key}?token=${encodeURIComponent(signed.token)}`, {
    method: 'PUT', headers: { 'Content-Type': 'text/plain', 'x-upsert': 'false' }, raw: 'hello',
  });
  if (up.ok) createdStorageObjects.push({ bucket: signed.bucket, key: signed.object_key });
  if (!up.ok) throw new Error(`Signed Storage upload: HTTP ${up.status}`);
  const verified = await apiRequest(`/api/v1/workspaces/${workspace}/media/upload-intents/${intent.intent_id}/complete`, token, {});
  return { ...intent, verified, up };
}

if (!URL || !ANON) {
  console.error('Missing SUPABASE URL / publishable key in env files.');
  process.exit(2);
}

const results = [];
const rec = (name, status, detail = '') => results.push({ name, status, detail });

async function req(path, { method = 'GET', token, schema, body, headers = {}, raw } = {}) {
  const h = { apikey: ANON, ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (schema && method === 'GET') h['Accept-Profile'] = schema;
  if (schema && method !== 'GET') h['Content-Profile'] = schema;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${URL}${path}`, { method, headers: h, body: payload });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, ok: res.ok };
}

async function admin(path, { method = 'GET', body, schema } = {}) {
  const h = { apikey: SR, Authorization: `Bearer ${SR}` };
  if (schema && method === 'GET') h['Accept-Profile'] = schema;
  if (schema && method !== 'GET') h['Content-Profile'] = schema;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${URL}${path}`, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, ok: res.ok };
}

const stamp = Date.now();
const PW = 'TondeAcc!2026xyz';
const A = { email: `tonde.acc.a.${stamp}@example.com`, password: PW };
const B = { email: `tonde.acc.b.${stamp}@example.com`, password: PW };
let userA, userB;
let wsCleanup = null;
let wsCleanupB = null;
const created = [];
const createdStorageObjects = [];

// Follow the expanded certification runner's retention model. Immutable application records and
// upload intents cannot be hard-deleted by a test runner; archive fixtures, remove only created
// Storage objects, and soft-delete only controlled Auth users. Report cleanup failures, never hide them.
async function cleanup() {
  const failures = [];
  for (const item of createdStorageObjects) {
    try {
      const removed = await admin(`/storage/v1/object/${item.bucket}`, { method: 'DELETE', body: { prefixes: [item.key] } });
      if (!removed.ok) failures.push(`Storage cleanup HTTP ${removed.status}`);
    } catch { failures.push('Storage cleanup could not reach the provider'); }
  }
  for (const ws of [wsCleanup, wsCleanupB]) {
    if (!ws) continue;
    try {
      const archived = await admin(`/rest/v1/productions?workspace_id=eq.${ws}`, { method: 'PATCH', schema: 'tonde', body: { lifecycle: 'archived' } });
      if (!archived.ok) failures.push(`Fixture archive HTTP ${archived.status}`);
    } catch { failures.push('Fixture archive could not reach the provider'); }
  }
  for (const id of created) {
    try {
      const removed = await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE', body: { should_soft_delete: true } });
      if (!removed.ok) failures.push(`Controlled Auth cleanup HTTP ${removed.status}`);
    } catch { failures.push('Controlled Auth cleanup could not reach the provider'); }
  }
  if (failures.length) { console.error('Cleanup failed:', failures.join('; ')); process.exitCode = 1; }
  else console.log('Controlled Storage objects removed; Productions archived; Auth users soft-deleted. Retention-protected fixture history remains.');
}

async function makeUser(u) {
  const r = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: { email: u.email, password: u.password, email_confirm: true },
  });
  if (!r.ok) throw new Error(`admin create user failed: HTTP ${r.status}`);
  created.push(r.data.id);
  return r.data;
}

async function signIn(u) {
  const r = await req('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: u.email, password: u.password },
  });
  if (!r.ok) throw new Error(`sign-in failed: HTTP ${r.status}`);
  return r.data.access_token;
}

async function main() {
  // 0. Anonymous denial
  const anonWs = await req('/rest/v1/workspaces?select=id', { schema: 'tonde' });
  rec('anonymous cannot read tonde.workspaces', anonWs.status >= 400 ? 'PASS' : 'FAIL',
    `HTTP ${anonWs.status}`);

  // 1. Signup creates exactly one profile / workspace / owner membership
  userA = await makeUser(A);
  const tokenA = await signIn(A);
  const wsA = await req('/rest/v1/workspaces?select=id,name,kind,owner_user_id', { token: tokenA, schema: 'tonde' });
  const profA = await req(`/rest/v1/profiles?select=user_id&user_id=eq.${userA.id}`, { token: tokenA, schema: 'tonde' });
  const memA = await req(`/rest/v1/workspace_members?select=workspace_id,role&user_id=eq.${userA.id}`, { token: tokenA, schema: 'tonde' });
  rec('A has exactly one profile', Array.isArray(profA.data) && profA.data.length === 1 ? 'PASS' : 'FAIL', `count=${profA.data?.length ?? 0}`);
  rec('A has exactly one personal workspace', Array.isArray(wsA.data) && wsA.data.length === 1 && wsA.data[0].kind === 'personal' ? 'PASS' : 'FAIL', `count=${wsA.data?.length ?? 0}`);
  rec('A is owner member of that workspace', Array.isArray(memA.data) && memA.data.length === 1 && memA.data[0].role === 'owner' ? 'PASS' : 'FAIL', `count=${memA.data?.length ?? 0}, role=${memA.data?.[0]?.role ?? 'none'}`);
  const workspaceId = wsA.data?.[0]?.id;
  wsCleanup = workspaceId;

  // 2. Repeat login never creates duplicates
  await signIn(A);
  const wsA2 = await req('/rest/v1/workspaces?select=id', { token: tokenA, schema: 'tonde' });
  rec('repeat login creates no duplicate workspace', Array.isArray(wsA2.data) && wsA2.data.length === 1 ? 'PASS' : 'FAIL', `count=${wsA2.data?.length}`);

  // 3. B isolated
  userB = await makeUser(B);
  const tokenB = await signIn(B);
  const wsB = await req('/rest/v1/workspaces?select=id', { token: tokenB, schema: 'tonde' });
  wsCleanupB = wsB.data?.[0]?.id;
  rec('B sees only own workspace', Array.isArray(wsB.data) && wsB.data.length === 1 && wsB.data[0].id !== workspaceId ? 'PASS' : 'FAIL', `count=${wsB.data?.length ?? 0}`);

  // 4. A creates a production through the reviewed RPC (Real default)
  const rpc = await req('/rest/v1/rpc/create_project_with_production', {
    method: 'POST', token: tokenA, schema: 'tonde',
    body: { target_workspace: workspaceId, production_title: 'Acceptance Film', kind: 'social_video' },
  });
  const prods = await req(`/rest/v1/productions?select=id,title,execution_method,lifecycle,workspace_id&workspace_id=eq.${workspaceId}`, { token: tokenA, schema: 'tonde' });
  const prod = Array.isArray(prods.data) ? prods.data[0] : null;
  rec('A creates a production (Projects→Studio)', rpc.ok && prod ? 'PASS' : 'FAIL', `rpc HTTP ${rpc.status}`);
  rec('Real is the default execution method', prod?.execution_method === 'real' ? 'PASS' : 'FAIL', prod?.execution_method);

  // 5. Title save persists
  if (prod) {
    await req(`/rest/v1/productions?id=eq.${prod.id}`, {
      method: 'PATCH', token: tokenA, schema: 'tonde', headers: { Prefer: 'return=representation' },
      body: { title: 'Acceptance Film v2' },
    });
    const re = await req(`/rest/v1/productions?select=title&id=eq.${prod.id}`, { token: tokenA, schema: 'tonde' });
    rec('title save persists after reload', re.data?.[0]?.title === 'Acceptance Film v2' ? 'PASS' : 'FAIL', re.data?.[0]?.title);
  }

  // 6. Archive allowed; hard delete rejected
  if (prod) {
    const arch = await req(`/rest/v1/productions?id=eq.${prod.id}`, {
      method: 'PATCH', token: tokenA, schema: 'tonde', headers: { Prefer: 'return=representation' },
      body: { lifecycle: 'archived' },
    });
    rec('A can archive a production', arch.ok && arch.data?.[0]?.lifecycle === 'archived' ? 'PASS' : 'FAIL', `HTTP ${arch.status}`);
    const del = await req(`/rest/v1/productions?id=eq.${prod.id}`, {
      method: 'DELETE', token: tokenA, schema: 'tonde', headers: { Prefer: 'return=representation' },
    });
    const still = await req(`/rest/v1/productions?select=id&id=eq.${prod.id}`, { token: tokenA, schema: 'tonde' });
    rec('hard deletion is rejected', (del.status >= 400 || (Array.isArray(del.data) && del.data.length === 0)) && still.data?.length === 1 ? 'PASS' : 'FAIL', `delete HTTP ${del.status}`);
  }

  // 7. B cannot read or mutate A's rows by ID swap
  const hiddenSchemaProbe = await req('/rest/v1/rpc/is_workspace_member', {
    method: 'POST', token: tokenB,
    headers: { 'Accept-Profile': 'tonde_private', 'Content-Profile': 'tonde_private' },
    body: { target_workspace: wsCleanup },
  });
  rec('authenticated cannot select hidden tonde_private via PostgREST', hiddenSchemaProbe.status === 406 ? 'PASS' : 'FAIL', `HTTP ${hiddenSchemaProbe.status}`);

  if (prod) {
    const bRead = await req(`/rest/v1/productions?select=id,title&id=eq.${prod.id}`, { token: tokenB, schema: 'tonde' });
    rec("B cannot read A's production by ID", Array.isArray(bRead.data) && bRead.data.length === 0 ? 'PASS' : 'FAIL', `rows=${bRead.data?.length ?? 0}`);
    const bPatch = await req(`/rest/v1/productions?id=eq.${prod.id}`, {
      method: 'PATCH', token: tokenB, schema: 'tonde', headers: { Prefer: 'return=representation' },
      body: { title: 'hacked' },
    });
    const afterBMutation = await req(`/rest/v1/productions?select=title&id=eq.${prod.id}`, { token: tokenA, schema: 'tonde' });
    const bMutationDenied = bPatch.status >= 400 || (Array.isArray(bPatch.data) && bPatch.data.length === 0);
    rec("B cannot mutate A's production", bMutationDenied && afterBMutation.data?.[0]?.title === 'Acceptance Film v2' ? 'PASS' : 'FAIL', `HTTP ${bPatch.status}; owner value unchanged=${afterBMutation.data?.[0]?.title === 'Acceptance Film v2'}`);
    const bRpc = await req('/rest/v1/rpc/create_project_with_production', {
      method: 'POST', token: tokenB, schema: 'tonde',
      body: { target_workspace: workspaceId, production_title: 'intrusion', kind: 'social_video' },
    });
    rec("B cannot create inside A's workspace", bRpc.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${bRpc.status}`);
    for (const [functionName, args] of [
      ['is_workspace_member', { target_workspace: workspaceId }],
      ['can_edit_workspace', { target_workspace: workspaceId }],
      ['is_workspace_admin', { target_workspace: workspaceId }],
    ]) {
      const probe = await req(`/rest/v1/rpc/${functionName}`, { method: 'POST', token: tokenB, schema: 'tonde', body: args });
      rec(`B ${functionName} helper is hidden from PostgREST`, probe.status === 404 ? 'PASS' : 'FAIL', `HTTP ${probe.status}`);
    }
  }

  // Human approval is distinct from content edits and privileged execution.
  if (prod) {
    const combinedApproval = await req(`/rest/v1/productions?id=eq.${prod.id}`, {
      method: 'PATCH', token: tokenA, schema: 'tonde', headers: { Prefer: 'return=representation' },
      body: { title: 'Acceptance Film v3', approval: 'approved' },
    });
    const afterCombined = await req(`/rest/v1/productions?select=title,approval&id=eq.${prod.id}`, { token: tokenA, schema: 'tonde' });
    rec('combined content edit and approval is rejected', combinedApproval.status >= 400 && afterCombined.data?.[0]?.title === 'Acceptance Film v2' && afterCombined.data?.[0]?.approval === 'draft' ? 'PASS' : 'FAIL', `HTTP ${combinedApproval.status}; unchanged=${afterCombined.data?.[0]?.title === 'Acceptance Film v2' && afterCombined.data?.[0]?.approval === 'draft'}`);
    const creatorApproval = await req(`/rest/v1/productions?id=eq.${prod.id}`, {
      method: 'PATCH', token: tokenA, schema: 'tonde', headers: { Prefer: 'return=representation' }, body: { approval: 'approved' },
    });
    rec('authenticated workspace editor may explicitly approve', creatorApproval.ok && creatorApproval.data?.[0]?.approval === 'approved' ? 'PASS' : 'FAIL', `HTTP ${creatorApproval.status}`);
    const resetApproval = await req(`/rest/v1/productions?id=eq.${prod.id}`, {
      method: 'PATCH', token: tokenA, schema: 'tonde', body: { approval: 'draft' },
    });
    const forgedApproval = await admin(`/rest/v1/productions?id=eq.${prod.id}`, {
      method: 'PATCH', schema: 'tonde', body: { approval: 'approved' },
    });
    const afterServiceApproval = await req(`/rest/v1/productions?select=approval&id=eq.${prod.id}`, { token: tokenA, schema: 'tonde' });
    rec('service-role cannot manufacture human approval', resetApproval.ok && forgedApproval.status >= 400 && afterServiceApproval.data?.[0]?.approval === 'draft' ? 'PASS' : 'FAIL', `reset HTTP ${resetApproval.status}, service HTTP ${forgedApproval.status}, state=${afterServiceApproval.data?.[0]?.approval}`);
  }

  // 8. Exercise the same server-authorized, signed and independently verified upload as the UI.
  // A normal authenticated direct Storage write is deliberately forbidden since 044–046.
  const uploadA = await uploadPrivateReference(workspaceId, tokenA);
  const key = uploadA.object_key;
  const bucket = uploadA.bucket;
  rec('A opens a creator-scoped upload intent', uploadA.media_id && key.startsWith(`${workspaceId}/`) ? 'PASS' : 'FAIL');
  rec('A signed private upload is independently verified', uploadA.verified.state === 'verified' && uploadA.verified.media_id === uploadA.media_id ? 'PASS' : 'FAIL');
  const directA = await req(`/storage/v1/object/${bucket}/${key}`, {
    method: 'POST', token: tokenA, headers: { 'Content-Type': 'text/plain', 'x-upsert': 'true' }, raw: 'intrude',
  });
  rec('A cannot bypass signed-upload authorization', directA.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${directA.status}`);
  for (const [functionName, args] of [
    ['can_read_storage_object', { target_bucket: bucket, target_name: key }],
    ['can_upload_storage_object', { target_bucket: bucket, target_name: key }],
  ]) {
    const probe = await req(`/rest/v1/rpc/${functionName}`, { method: 'POST', token: tokenB, schema: 'tonde', body: args });
    rec(`B ${functionName} helper is hidden from PostgREST`, probe.status === 404 ? 'PASS' : 'FAIL', `HTTP ${probe.status}`);
  }
  const bSign = await req(`/storage/v1/object/sign/${bucket}/${key}`, {
    method: 'POST', token: tokenB, body: { expiresIn: 60 },
  });
  // B's sign request must not yield a usable URL; verify the download too if one came back.
  const bSignUrl = bSign.data?.signedURL || bSign.data?.signedUrl;
  let bDownload = { status: 0 };
  if (bSignUrl) {
    const full = bSignUrl.startsWith('http') ? bSignUrl : `${URL}/storage/v1${bSignUrl.startsWith('/') ? '' : '/'}${bSignUrl}`;
    const res = await fetch(full);
    bDownload = { status: res.status };
  }
  const anonDirectRead = await req(`/storage/v1/object/authenticated/${bucket}/${key}`);
  const anonList = await req(`/storage/v1/object/list/${bucket}`, {
    method: 'POST', body: { prefix: workspaceId, limit: 100, offset: 0 },
  });
  const anonListRows = Array.isArray(anonList.data) ? anonList.data : [];
  const anonCanSeeAcceptanceObject = anonListRows.some(row => row.name === key || `${workspaceId}/${row.name}` === key);
  rec('anonymous cannot read/list private Storage objects', anonDirectRead.status >= 400 && !anonCanSeeAcceptanceObject ? 'PASS' : 'FAIL', `read HTTP ${anonDirectRead.status}, list HTTP ${anonList.status}, target visible=${anonCanSeeAcceptanceObject}`);
  const bDirectRead = await req(`/storage/v1/object/authenticated/${bucket}/${key}`, { token: tokenB });
  rec("B cannot read A's private Storage object", bDirectRead.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${bDirectRead.status}`);
  rec("B cannot sign A's Storage path", bDownload.status >= 400 || !bSignUrl ? 'PASS' : 'FAIL', `sign HTTP ${bSign.status}, signed download HTTP ${bDownload.status}`);
  const bUp = await req(`/storage/v1/object/${bucket}/${key}`, {
    method: 'POST', token: tokenB, headers: { 'Content-Type': 'text/plain', 'x-upsert': 'true' }, raw: 'intrude',
  });
  rec("B cannot upsert A's Storage object", bUp.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${bUp.status}`);
  const bDelete = await req(`/storage/v1/object/${bucket}/${key}`, { method: 'DELETE', token: tokenB });
  const ownerRead = await req(`/storage/v1/object/authenticated/${bucket}/${key}`, { token: tokenA });
  rec("B cannot delete A's Storage object", bDelete.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${bDelete.status}`);
  rec('A retains access after denied cross-user mutations', ownerRead.ok ? 'PASS' : 'FAIL', `HTTP ${ownerRead.status}`);

  const uploadB = await uploadPrivateReference(wsCleanupB, tokenB);
  const keyB = uploadB.object_key;
  const bucketB = uploadB.bucket;
  rec('B opens own creator-scoped upload intent', uploadB.media_id && keyB.startsWith(`${wsCleanupB}/`) ? 'PASS' : 'FAIL');
  rec('B signed private upload is independently verified', uploadB.verified.state === 'verified' && uploadB.verified.media_id === uploadB.media_id ? 'PASS' : 'FAIL');
  const aDirectReadB = await req(`/storage/v1/object/authenticated/${bucketB}/${keyB}`, { token: tokenA });
  rec("A cannot read B's private Storage object", aDirectReadB.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${aDirectReadB.status}`);
  const aSignB = await req(`/storage/v1/object/sign/${bucketB}/${keyB}`, { method: 'POST', token: tokenA, body: { expiresIn: 60 } });
  rec("A cannot sign B's Storage path", aSignB.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${aSignB.status}`);
  const aUpsertB = await req(`/storage/v1/object/${bucketB}/${keyB}`, {
    method: 'POST', token: tokenA, headers: { 'Content-Type': 'text/plain', 'x-upsert': 'true' }, raw: 'intrude',
  });
  rec("A cannot upsert B's Storage object", aUpsertB.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${aUpsertB.status}`);
  const aDeleteB = await req(`/storage/v1/object/${bucketB}/${keyB}`, { method: 'DELETE', token: tokenA });
  rec("A cannot delete B's Storage object", aDeleteB.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${aDeleteB.status}`);
  const ownerReadB = await req(`/storage/v1/object/authenticated/${bucketB}/${keyB}`, { token: tokenB });
  rec('B retains access after denied cross-user mutations', ownerReadB.ok ? 'PASS' : 'FAIL', `HTTP ${ownerReadB.status}`);

  // 8b. Backend readiness and cross-workspace access (requires the local API running)
  let apiUp = false;
  try {
    const h = await fetch(`${apiBase}/api/health`);
    apiUp = h.ok;
  } catch { apiUp = false; }
  if (!apiUp) {
    rec('backend /api/ready for A', 'BLOCKED', `no API at ${apiBase}`);
    rec('backend /access rejects B', 'BLOCKED', `no API at ${apiBase}`);
  } else {
    const authGet = async (path, token) => {
      const res = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      let data = null; try { data = await res.json(); } catch { /* ignore */ }
      return { status: res.status, data };
    };
    const readyA = await authGet('/api/ready', tokenA);
    rec('backend /api/ready for A', readyA.status === 200 && readyA.data?.data?.status === 'ready' ? 'PASS' : 'FAIL', `HTTP ${readyA.status}`);
    const accessB = await authGet(`/api/v1/workspaces/${workspaceId}/access`, tokenB);
    rec('backend /access rejects B', accessB.status === 403 ? 'PASS' : 'FAIL', `HTTP ${accessB.status}`);
  }

  // 9. Report
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('CHECK', 52) + pad('RESULT', 8) + 'DETAIL');
  console.log('-'.repeat(100));
  for (const r of results) console.log(pad(r.name, 52) + pad(r.status, 8) + r.detail);
  const passed = results.filter((r) => r.status === 'PASS').length;
  const blocked = results.filter((r) => r.status === 'BLOCKED').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${passed}/${results.length} passed (${blocked} blocked, ${failed} failed)`);
  if (failed > 0) process.exitCode = 1;
  else if (blocked > 0) process.exitCode = 2;
}

main()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(cleanup);
