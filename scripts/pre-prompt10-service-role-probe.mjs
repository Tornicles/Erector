// Focused hosted diagnostic: which role does the server key act as, and which statement
// fails when the server path writes a guarded row? Reads credentials from ignored env;
// never prints them. Cleans up the one controlled user it creates.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(readFileSync('backend/.env', 'utf8').split(/\r?\n/).filter(s => s.includes('=') && !s.trim().startsWith('#')).map(s => {
  const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const url = env.SUPABASE_URL.replace(/\/$/, ''), key = env.SUPABASE_PUBLISHABLE_KEY, secret = env.SUPABASE_SERVICE_ROLE_KEY;
const out = [];
const log = (name, value) => { out.push({ name, value }); console.log(name, JSON.stringify(value)); };
async function request(path, { method = 'GET', token, admin = false, schema, body, headers = {} } = {}) {
  const h = { apikey: admin ? secret : key, ...headers };
  if (token || admin) h.Authorization = `Bearer ${admin ? secret : token}`;
  if (schema) h[method === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = schema;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}
const roleClaim = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role; } catch { return null; } };
log('publishable key role claim', roleClaim(key));
log('server key role claim', roleClaim(secret));
log('server key is legacy JWT', secret.startsWith('eyJ'));
log('server key is new-style secret', secret.startsWith('sb_secret_'));
const password = 'Tonde!' + randomBytes(18).toString('base64url');
const email = `tonde.probe.${Date.now()}@example.com`;
const made = await request('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true } });
log('controlled user created', made.status);
const user = made.data;
try {
  const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const token = login.data.access_token;
  const ws = await request('/rest/v1/workspaces?select=id', { token, schema: 'tonde' });
  const workspace = ws.data[0].id;
  const production = await request('/rest/v1/rpc/create_project_with_production', { method: 'POST', token, schema: 'tonde', body: { target_workspace: workspace, production_title: 'Diagnostic only', kind: 'short_film' } });
  log('creator Production created', production.status);
  const job = { workspace_id: workspace, production_id: production.data, job_type: 'export', input_object_id: production.data, requested_by: user.id };
  for (const prefer of ['return=minimal', 'return=representation']) {
    const r = await request('/rest/v1/jobs', { method: 'POST', admin: true, schema: 'tonde', headers: { Prefer: prefer }, body: job });
    log(`service_role INSERT jobs (${prefer})`, { status: r.status, code: r.data?.code, message: r.data?.message, details: r.data?.details, hint: r.data?.hint });
  }
  const asCreator = await request('/rest/v1/jobs', { method: 'POST', token, schema: 'tonde', headers: { Prefer: 'return=minimal' }, body: job });
  log('authenticated INSERT jobs', { status: asCreator.status, code: asCreator.data?.code, message: asCreator.data?.message });
  const mediaId = '00000000-0000-4000-8000-0000000000ff';
  const media = { id: mediaId, workspace_id: workspace, bucket: 'tonde-results', object_key: `${workspace}/${mediaId}/probe.png`, original_filename: 'probe.png', mime_type: 'image/png', file_category: 'image', bytes: 68, created_by: user.id };
  const mediaInsert = await request('/rest/v1/media_files', { method: 'POST', admin: true, schema: 'tonde', headers: { Prefer: 'return=minimal' }, body: media });
  log('service_role INSERT media_files', { status: mediaInsert.status, code: mediaInsert.data?.code, message: mediaInsert.data?.message });
  const workspaceProbe = await request('/rest/v1/workspaces?select=id', { admin: true, schema: 'tonde' });
  log('service_role SELECT workspaces', { status: workspaceProbe.status, code: workspaceProbe.data?.code, message: workspaceProbe.data?.message, rows: Array.isArray(workspaceProbe.data) ? workspaceProbe.data.length : null });
} finally {
  await request(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE', admin: true, body: { should_soft_delete: true } });
  log('controlled user soft-deleted', user.id);
  writeFileSync('test-results/pre-prompt10/service-role-probe.json', JSON.stringify(out, null, 2));
}
