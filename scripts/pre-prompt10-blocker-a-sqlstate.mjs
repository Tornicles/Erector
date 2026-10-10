// Blocker A mechanism test: does the hang follow SQLSTATE 40001, or one particular function?
// Three unrelated RPCs are driven to their 40001 conflict path, plus non-40001 error paths as controls.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(readFileSync('backend/.env', 'utf8').split(/\r?\n/).filter(s => s.includes('=') && !s.trim().startsWith('#')).map(s => {
  const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const url = env.SUPABASE_URL.replace(/\/$/, ''), key = env.SUPABASE_PUBLISHABLE_KEY, secret = env.SUPABASE_SERVICE_ROLE_KEY;
const out = [];
const note = (name, r) => { const row = { name, status: r.status, code: r.data?.code ?? null, ms: r.ms, failure: r.failure ?? null }; out.push(row); console.log(name, '→', JSON.stringify(row)); };

async function request(path, { method = 'GET', token, admin = false, schema, body, timeoutMs = 15000 } = {}) {
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
const rpc = (name, token, body, timeoutMs) => request(`/rest/v1/rpc/${name}`, { method: 'POST', token, schema: 'tonde', body, timeoutMs });

const password = 'Tonde!' + randomBytes(18).toString('base64url');
const email = `tonde.sqlstate.${Date.now()}@example.com`;
const made = await request('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true } });
const user = made.data;
let workspace, production;
try {
  const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const token = login.data.access_token;
  workspace = (await request('/rest/v1/workspaces?select=id', { token, schema: 'tonde' })).data[0].id;
  production = (await rpc('create_project_with_production', token, { target_workspace: workspace, production_title: 'SQLSTATE probe', kind: 'short_film' })).data;
  await request(`/rest/v1/productions?id=eq.${production}`, { method: 'PATCH', token, schema: 'tonde', body: { planned_duration_ms: 8000 } });
  const scene = (await rpc('create_studio_scene', token, { target_workspace: workspace, target_production: production, expected_production_revision: null, scene: { title: 'Probe scene', duration_ms: 8000 } })).data.scene_id;

  // 1. audio_plan_save — fresh create, then a stale revision (40001), then a validation error (22023).
  const fresh = await rpc('audio_plan_save', token, { target_workspace: workspace, target_production: production, expected_revision: null, values_json: { overall_intent: 'Probe' } });
  note('audio_plan_save fresh create', fresh);
  note('audio_plan_save stale revision (expect SQLSTATE 40001)', await rpc('audio_plan_save', token,
    { target_workspace: workspace, target_production: production, expected_revision: null, values_json: { overall_intent: 'Probe again' } }));
  note('audio_plan_save unsupported field (expect SQLSTATE 22023 control)', await rpc('audio_plan_save', token,
    { target_workspace: workspace, target_production: production, expected_revision: fresh.data?.revision, values_json: { not_a_field: 1 } }));

  // 2. reference_identity_save — fresh attestation, then a stale revision (40001).
  const reference = (await request('/rest/v1/production_references', { method: 'POST', token, schema: 'tonde', headers: { Prefer: 'return=representation' }, body: { workspace_id: workspace, production_id: production, source_type: 'description', source_description: 'Probe' } })).data[0];
  note('reference_identity_save fresh attestation', await rpc('reference_identity_save', token,
    { target_workspace: workspace, target_production: production, target_reference: reference.id, expected_revision: reference.revision, values_json: { source_identity: 'Probe reference', source_identity_verified: true, creator_purpose: 'Probe purpose' } }));
  note('reference_identity_save stale revision (expect SQLSTATE 40001)', await rpc('reference_identity_save', token,
    { target_workspace: workspace, target_production: production, target_reference: reference.id, expected_revision: reference.revision, values_json: { creator_purpose: 'Stale purpose' } }));

  // 3. lock_set — a non-40001 guard (already locked → 23514) beside a 40001 stale unlock.
  const revision = (await request(`/rest/v1/productions?select=revision&id=eq.${production}`, { token, schema: 'tonde' })).data[0].revision;
  note('lock_set fresh lock', await rpc('lock_set', token, { target_workspace: workspace, target_production: production, target_object: production, locked: true, expected_revision: revision }));
  note('lock_set already locked (expect SQLSTATE 23514 control)', await rpc('lock_set', token, { target_workspace: workspace, target_production: production, target_object: production, locked: true, expected_revision: revision + 1 }));
  note('lock_set stale unlock (expect SQLSTATE 40001)', await rpc('lock_set', token, { target_workspace: workspace, target_production: production, target_object: production, locked: false, expected_revision: revision }));

  // Cleanup state so the controlled Production is left consistent.
  await rpc('lock_set', token, { target_workspace: workspace, target_production: production, target_object: production, locked: false, expected_revision: revision + 1 }, 25000);
  note('scene created', { status: 200, data: scene, ms: 0 });
} finally {
  writeFileSync('test-results/pre-prompt10/blocker-a-sqlstate.json', JSON.stringify(out, null, 2));
  if (production) await request(`/rest/v1/productions?id=eq.${production}`, { method: 'PATCH', admin: true, schema: 'tonde', body: { lifecycle: 'archived' }, timeoutMs: 15000 });
  await request(`/auth/v1/admin/users/${user?.id}`, { method: 'DELETE', admin: true, body: { should_soft_delete: true } });
  console.log('controlled user soft-deleted', user?.id);
}
