// Blocker A diagnosis: does a stale-revision approval reach PostgreSQL when issued over hosted HTTP?
// Creates one controlled user/Production, approves once, then fires the stale call without awaiting
// it and samples pg_stat_activity while it is outstanding. Cleans up the controlled fixtures.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const env = Object.fromEntries(readFileSync('backend/.env', 'utf8').split(/\r?\n/).filter(s => s.includes('=') && !s.trim().startsWith('#')).map(s => {
  const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const url = env.SUPABASE_URL.replace(/\/$/, ''), key = env.SUPABASE_PUBLISHABLE_KEY, secret = env.SUPABASE_SERVICE_ROLE_KEY;
const evidence = { steps: [], activity: [] };
const note = (name, value) => { evidence.steps.push({ name, value }); console.log(name, JSON.stringify(value)); };

async function request(path, { method = 'GET', token, admin = false, schema, body, timeoutMs = 45000 } = {}) {
  const h = { apikey: admin ? secret : key };
  if (token || admin) h.Authorization = `Bearer ${admin ? secret : token}`;
  if (schema) h[method === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = schema;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const started = Date.now();
  try {
    const r = await fetch(url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { ok: r.ok, status: r.status, data, ms: Date.now() - started };
  } catch (error) { return { ok: false, status: 0, data: null, ms: Date.now() - started, failure: error.name }; }
}
function sql(query, label) {
  const file = `test-results/pre-prompt10/blocker-a-${label}.sql`;
  writeFileSync(file, query);
  const run = spawnSync('bash', ['-lc', `supabase db query --linked --file ${file} -o json`], { encoding: 'utf8', timeout: 90000 });
  const text = run.stdout ?? '';
  try { return JSON.parse(text)[0]; } catch { return { parseError: text.slice(0, 400) }; }
}

const password = 'Tonde!' + randomBytes(18).toString('base64url');
const email = `tonde.blockera.${Date.now()}@example.com`;
const made = await request('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true } });
const user = made.data;
let workspace, production;
try {
  const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const token = login.data.access_token;
  workspace = (await request('/rest/v1/workspaces?select=id', { token, schema: 'tonde' })).data[0].id;
  production = (await request('/rest/v1/rpc/create_project_with_production', { method: 'POST', token, schema: 'tonde', body: { target_workspace: workspace, production_title: 'Blocker A only', kind: 'short_film' } })).data;
  const current = await request(`/rest/v1/productions?select=revision&id=eq.${production}`, { token, schema: 'tonde' });
  const liveRevision = current.data[0].revision;
  const payload = { target_workspace: workspace, target_production: production, target_object: production, decision: 'approve', expected_revision: liveRevision, note_text: 'Blocker A diagnosis' };
  const fresh = await request('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: payload });
  note('fresh approval over HTTP', { status: fresh.status, ms: fresh.ms, approval: fresh.data?.approval, revision: fresh.data?.revision });
  note('controlled identifiers', { workspace, production, liveRevision });

  // Fire the stale call and do NOT await it.
  const staleStarted = Date.now();
  const stale = request('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: payload, timeoutMs: 40000 });
  stale.then(r => { evidence.staleResult = { status: r.status, ms: r.ms, code: r.data?.code ?? null, failure: r.failure ?? null }; console.log('stale resolved', JSON.stringify(evidence.staleResult)); });

  for (const delay of [4000, 12000]) {
    await new Promise(resolve => setTimeout(resolve, delay));
    const snapshot = sql(`select pid, state, wait_event_type, wait_event, backend_type,
        now() - query_start as query_age, now() - xact_start as xact_age, left(query, 120) as query,
        pg_blocking_pids(pid)::text as blocked_by
      from pg_stat_activity
      where datname is not null and pid <> pg_backend_pid()
        and (state <> 'idle' or now() - state_change < interval '10 seconds')
      order by query_start nulls last`, `activity-${delay}`);
    evidence.activity.push({ atMs: Date.now() - staleStarted, snapshot });
    console.log(`activity at +${Date.now() - staleStarted}ms`, JSON.stringify(snapshot).slice(0, 1500));
  }
  await Promise.allSettled([stale]);
  const after = await request(`/rest/v1/productions?select=revision,approval&id=eq.${production}`, { token, schema: 'tonde' });
  note('object state after the stale attempt', after.data?.[0]);
  await request(`/rest/v1/rpc/approval_decide`, { method: 'POST', token, schema: 'tonde', body: { ...payload, decision: 'reopen', expected_revision: after.data?.[0]?.revision } });
} finally {
  writeFileSync('test-results/pre-prompt10/blocker-a-diagnosis.json', JSON.stringify(evidence, null, 2));
  if (production) await request(`/rest/v1/productions?id=eq.${production}`, { method: 'PATCH', admin: true, schema: 'tonde', body: { lifecycle: 'archived' }, timeoutMs: 15000 });
  await request(`/auth/v1/admin/users/${user?.id}`, { method: 'DELETE', admin: true, body: { should_soft_delete: true } });
  console.log('controlled user soft-deleted', user?.id);
}
