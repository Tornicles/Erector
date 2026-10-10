// Blocker A: is the stale-approval hang in the transport (pooled keep-alive) rather than the server?
// The same stale request is sent twice: once through the pooled `fetch` path, once over a raw
// node:http connection that cannot be reused (agent:false, Connection: close).
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const env = Object.fromEntries(readFileSync('backend/.env', 'utf8').split(/\r?\n/).filter(s => s.includes('=') && !s.trim().startsWith('#')).map(s => {
  const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const url = env.SUPABASE_URL.replace(/\/$/, ''), key = env.SUPABASE_PUBLISHABLE_KEY, secret = env.SUPABASE_SERVICE_ROLE_KEY;
const out = [];
const note = (name, value) => { out.push({ name, value }); console.log(name, JSON.stringify(value)); };

async function pooled(path, { method = 'GET', token, admin = false, schema, body, timeoutMs = 20000 } = {}) {
  const h = { apikey: admin ? secret : key };
  if (token || admin) h.Authorization = `Bearer ${admin ? secret : token}`;
  if (schema) h[method === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = schema;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const started = Date.now();
  try {
    const r = await fetch(url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, ms: Date.now() - started };
  } catch (error) { return { status: 0, failure: error.name, ms: Date.now() - started }; }
}
// One connection, closed afterwards, never reused: a transport-independent measurement.
function raw(path, { method = 'POST', token, schema, body, timeoutMs = 20000 } = {}) {
  return new Promise(resolve => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { apikey: key, Authorization: `Bearer ${token}`, Connection: 'close' };
    if (schema) headers[method === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = schema;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const started = Date.now();
    const target = new URL(url + path);
    const req = (target.protocol === 'https:' ? https : http).request({ hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), path: target.pathname + target.search, method, headers, agent: false }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, data, ms: Date.now() - started }); });
    });
    req.on('error', error => resolve({ status: 0, failure: error.code ?? error.message, ms: Date.now() - started }));
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

const password = 'Tonde!' + randomBytes(18).toString('base64url');
const email = `tonde.transport.${Date.now()}@example.com`;
const made = await pooled('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true } });
const user = made.data;
let workspace, production;
try {
  const login = await pooled('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const token = login.data.access_token;
  workspace = (await pooled('/rest/v1/workspaces?select=id', { token, schema: 'tonde' })).data[0].id;
  production = (await pooled('/rest/v1/rpc/create_project_with_production', { method: 'POST', token, schema: 'tonde', body: { target_workspace: workspace, production_title: 'Transport probe', kind: 'short_film' } })).data;
  const revision = (await pooled(`/rest/v1/productions?select=revision&id=eq.${production}`, { token, schema: 'tonde' })).data[0].revision;
  const payload = { target_workspace: workspace, target_production: production, target_object: production, decision: 'approve', expected_revision: revision, note_text: 'Transport probe' };
  note('1. fresh approve, pooled fetch', await pooled('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: payload }));
  note('2. stale approve, pooled fetch (first attempt)', await pooled('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: payload, timeoutMs: 25000 }));
  note('3. stale approve, raw one-shot connection', await raw('/rest/v1/rpc/approval_decide', { token, schema: 'tonde', body: payload, timeoutMs: 25000 }));
  note('4. stale approve, pooled fetch (second attempt)', await pooled('/rest/v1/rpc/approval_decide', { method: 'POST', token, schema: 'tonde', body: payload, timeoutMs: 25000 }));
  note('5. stale approve, raw one-shot, immediately after a pooled success',
    await raw('/rest/v1/rpc/approval_decide', { token, schema: 'tonde', body: payload, timeoutMs: 25000 }));
  const state = await pooled(`/rest/v1/productions?select=revision,approval&id=eq.${production}`, { token, schema: 'tonde' });
  note('6. object state (must still be the approved revision, unmuted by any stale call)', state.data?.[0]);
} finally {
  writeFileSync('test-results/pre-prompt10/blocker-a-transport.json', JSON.stringify(out, null, 2));
  if (production) await pooled(`/rest/v1/productions?id=eq.${production}`, { method: 'PATCH', admin: true, schema: 'tonde', body: { lifecycle: 'archived' }, timeoutMs: 15000 });
  await pooled(`/auth/v1/admin/users/${user?.id}`, { method: 'DELETE', admin: true, body: { should_soft_delete: true } });
  console.log('controlled user soft-deleted', user?.id);
}
