// Does the stale-revision approval path hang in the database, or only in the HTTP layer?
// Creates one controlled user/Production, times each call, then archives and soft-deletes them.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(readFileSync('backend/.env', 'utf8').split(/\r?\n/).filter(s => s.includes('=') && !s.trim().startsWith('#')).map(s => {
  const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const url = env.SUPABASE_URL.replace(/\/$/, ''), key = env.SUPABASE_PUBLISHABLE_KEY, secret = env.SUPABASE_SERVICE_ROLE_KEY;
const log = [];
async function request(path, { method = 'GET', token, admin = false, schema, body, headers = {}, timeoutMs = 60000 } = {}) {
  const h = { apikey: admin ? secret : key, ...headers };
  if (token || admin) h.Authorization = `Bearer ${admin ? secret : token}`;
  if (schema) h[method === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = schema;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const started = Date.now();
  let r, failure = null;
  try {
    r = await fetch(url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) { failure = error.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : error.message; }
  const ms = Date.now() - started;
  if (failure) { log.push({ path, ms, failure }); console.log('FAIL', method, path, `${ms}ms`, failure); return { status: 0, data: null, ok: false }; }
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  log.push({ path, ms, status: r.status, code: data?.code ?? null });
  console.log(r.ok ? 'OK  ' : 'ERR ', method, path, `${ms}ms`, `HTTP ${r.status}`, data?.code ?? '');
  return { status: r.status, ok: r.ok, data };
}
const password = 'Tonde!' + randomBytes(18).toString('base64url');
const email = `tonde.timing.${Date.now()}@example.com`;
const made = await request('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true } });
const user = made.data;
try {
  const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const token = login.data.access_token;
  const ws = await request('/rest/v1/workspaces?select=id', { token, schema: 'tonde' });
  const workspace = ws.data[0].id;
  const created = await request('/rest/v1/rpc/create_project_with_production', { method: 'POST', token, schema: 'tonde', body: { target_workspace: workspace, production_title: 'Timing only', kind: 'short_film' } });
  const production = created.data;
  const current = await request(`/rest/v1/productions?select=revision,approval&id=eq.${production}`, { token, schema: 'tonde' });
  const revision = current.data[0].revision;
  const base = { target_workspace: workspace, target_production: production, target_object: production, decision: 'approve', expected_revision: revision, note_text: 'Timing probe' };
  await request('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: base });
  await request('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: base }); // now stale
  await request('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: { ...base, decision: 'reopen', expected_revision: revision + 1 } });
  await request('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: base }); // stale again, after reopen
} finally {
  writeFileSync('test-results/pre-prompt10/stale-approval-timing.json', JSON.stringify(log, null, 2));
  await request(`/rest/v1/productions?id=eq.${user.production ?? ''}`, { method: 'PATCH', admin: true, schema: 'tonde', body: { lifecycle: 'archived' }, timeoutMs: 15000 }).catch(() => {});
  await request(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE', admin: true, body: { should_soft_delete: true } });
  console.log('controlled user soft-deleted', user.id);
}
