import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Prompt 10 authorization order — packets 031–035 on one 001→035 stack.
//
// The defect class this file exists for: a function that looks a resource up before it checks the
// caller's workspace authority, so a cross-tenant call surfaces an internal lookup failure
// (P0002 → HTTP 500 through PostgREST) or another workspace's row instead of a controlled denial.
// Migration 035 repaired the one instance inside `publication_reconcile`. This is the durable audit of
// the whole Prompt 10 surface, so the class cannot come back unnoticed:
//   * every client-reachable Prompt 10 RPC denies a non-member with 42501 and a workspace denial;
//   * a non-member never sees P0002, an ambiguous-column failure, or another workspace's data;
//   * the denied attempts change nothing in the target workspace;
//   * the entity-not-found answer still exists for a member whose id is genuinely missing;
//   * human publishing authority is not service-owned and commercial/server outcomes are not
//     client-owned;
//   * the set of Prompt 10 functions a client can execute equals the set audited here, so a future
//     Prompt 10 RPC that is granted but not audited fails this test.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb;
let production, result, provider, publication, exportId;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const out = await action(); await db.exec('commit'); return out; }
  catch (error) { await db.exec('rollback'); throw error; }
}
async function asService(action) {
  await db.exec('begin; set local role service_role;');
  await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  try { const out = await action(); await db.exec('commit'); return out; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);
// `currentCall` runs inside whatever role/transaction the caller already opened; `call` opens a client
// session of its own. Seeding must use the former, so it never nests one transaction in another.
const currentCall = (name, args) => rows(
  `select tonde.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) as result`, args)
  .then(answer => answer[0].result);
const call = (name, user, args) => asUser(user, () => currentCall(name, args));

// Every client-reachable Prompt 10 RPC, called with real identifiers that belong to workspace A, so a
// late authority check would find an actual row to leak or fail on.
const CLIENT_RPCS = [
  ['integration_capability_state', () => [wa, provider, 'publish']],
  ['publication_create', () => [wa, production, result, provider, null, 'Probe channel', null,
    'Probe title', 'Probe caption', 'private', null, '{}']],
  ['publication_update', () => [wa, publication, 'Probe title', 'Probe caption', 'Probe channel', '{}', 'private', null]],
  ['publication_set_state', () => [wa, publication, 'cancelled', 'Probe cross-tenant state change']],
  ['publication_authorize', () => [wa, publication, 'withdraw', 'Probe cross-tenant withdrawal']],
  ['publication_reconcile', () => [wa, publication, 'published', 'probe-remote', 'published', null, 'Probe cross-tenant reconcile']],
  ['publication_preview', () => [wa, publication]],
  ['publication_retry_safety', () => [wa, publication]],
  ['export_request', () => [wa, production, 'production_package', 'json', 'structured_data']],
  ['export_download', () => [wa, exportId]],
  ['entitlement_state', () => [wa, 'audit.credits']],
  ['billing_checkout_start', () => [wa, 'audit_plan', 'Probe cross-tenant checkout']],
  ['billing_status', () => [wa]],
];
// Functions that record a human creator decision: a client session only, never the trusted server.
const AUTHENTICATED_ONLY = ['publication_create', 'publication_update', 'publication_set_state',
  'publication_authorize', 'publication_preview', 'publication_retry_safety'];
// Functions that record trusted-server outcomes: never reachable from a client session.
const SERVICE_ONLY = ['publication_submit', 'publication_record_result', 'export_mark_building',
  'export_complete', 'export_fail', 'export_expire', 'billing_apply_subscription',
  'billing_grant_entitlement', 'billing_revoke_entitlement', 'usage_reserve', 'usage_commit',
  'usage_release', 'usage_record', 'billing_webhook_receive', 'billing_webhook_finish'];
const PREFIX = '^(publication_|export_|billing_|usage_|entitlement_|integration_)';

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''), current_user) $$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid(), auth.role() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
  `);
  for (const file of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  }
  for (const id of [A, B]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asEditor(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asOther(() => scalar('select tonde.bootstrap_workspace()'));

  // Workspace A furniture: a production with an uploaded Result, a registered destination whose
  // adapter exists in code and was never verified (test furniture, no network), an authorized
  // publication pinned to that Result, a requested export, and an entitlement definition with a grant.
  await asEditor(async () => {
    const project = await scalar('insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id', [wa, 'Audit project', A]);
    production = await scalar('insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id', [wa, project, 'Audit Production', A]);
    const media = randomUUID();
    await db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes,upload_state,checksum)
      values($1,$2,'tonde-production-media',$3,'audit.png','image/png','image',128,'uploaded','sha256:audit-media')`,
      [media, wa, `${wa}/${media}/audit.png`]);
    result = await scalar('insert into tonde.results(workspace_id,production_id,media_id) values($1,$2,$3) returning id', [wa, production, media]);
  });
  provider = 'audit_publisher';
  await asService(async () => {
    await db.query(`insert into tonde.integration_providers(key,name,category,auth_type,adapter_state,enabled,note)
      values($1,'Audit publisher','social_publishing','oauth','implemented',true,'Test fixture: an adapter exists in code and was never exercised.')`, [provider]);
    await db.query(`insert into tonde.integration_provider_capabilities(provider_key,capability_key,connection_required,required_scopes,enabled)
      values($1,'publish',true,$2,true)`, [provider, ['publish.video']]);
    await db.query(`insert into tonde.entitlement_definitions(key,name,kind,unit,enabled)
      values('audit.credits','Audit credits','quota','credit',true)`);
    await db.query(`insert into tonde.workspace_entitlements(workspace_id,entitlement_key,source,limit_amount,granted_by)
      values($1,'audit.credits','grant',10,$2)`, [wa, A]);
  });
  publication = await asEditor(async () => {
    const created = await currentCall('publication_create', [wa, production, result, provider, null,
      'Probe channel', null, 'Probe title', 'Probe caption', 'private', null, '{}']);
    await currentCall('publication_set_state', [wa, created.publication_id, 'ready', 'Probe readiness']);
    await currentCall('publication_authorize', [wa, created.publication_id, 'authorize', 'Probe authorization']);
    return created.publication_id;
  });
  exportId = await asEditor(async () => {
    const requested = await currentCall('export_request', [wa, production, 'production_package', 'json', 'structured_data']);
    return requested.export_id;
  });
});

after(async () => { await db?.close(); });

test('every client-reachable Prompt 10 RPC denies a non-member before it looks anything up', async () => {
  for (const [name, build] of CLIENT_RPCS) {
    const error = await failure(() => call(name, B, build()));
    assert.equal(error.code, '42501', `${name} must deny a non-member with 42501, saw ${error.code}: ${error.message}`);
    assert.match(error.message, /Workspace access denied/, `${name} must answer with the workspace denial`);
    assert.notEqual(error.code, 'P0002', `${name} must not surface a lookup failure to a non-member`);
    assert.notEqual(error.code, '42702', `${name} must not fail on an ambiguous column`);
  }
});

test('a member whose identifier is genuinely missing still gets the controlled not-found answer', async () => {
  const missing = await failure(() => call('publication_reconcile', A,
    [wa, randomUUID(), 'published', 'probe-remote', 'published', null, 'Probe missing publication']));
  assert.equal(missing.code, 'P0002');
  assert.match(missing.message, /does not exist in this workspace/);
  const missingExport = await failure(() => call('export_download', A, [wa, randomUUID()]));
  assert.equal(missingExport.code, 'P0002');
  const otherWorkspace = await failure(() => call('billing_status', B, [wa]));
  assert.equal(otherWorkspace.code, '42501');
});

test('the denied cross-tenant attempts left workspace A exactly as it was', async () => {
  const snapshot = () => asEditor(async () => JSON.stringify({
    publication: await rows('select state, production_revision, result_revision, submission_attempts, idempotency_key, authorization_id from tonde.publications where id = $1', [publication]),
    authorizations: await scalar('select count(*)::integer from tonde.publication_authorizations where publication_id = $1', [publication]),
    export: await rows('select state, production_revision, generated_media_id from tonde.exports where id = $1', [exportId]),
    connections: await scalar('select count(*)::integer from tonde.integration_connections where workspace_id = $1', [wa]),
    entitlement: await rows("select consumed_amount, reserved_amount from tonde.workspace_entitlements where workspace_id = $1 and entitlement_key = 'audit.credits'", [wa]),
  }));
  const before = await snapshot();
  for (const [name, build] of CLIENT_RPCS) await failure(() => call(name, B, build()));
  const after = await snapshot();
  assert.equal(after, before);
  const [state] = JSON.parse(before).publication;
  assert.equal(state.state, 'ready');
  assert.equal(state.submission_attempts, 0);
  assert.ok(state.authorization_id, 'the creator authorization still stands');
});

test('human publishing authority is client-only and trusted-server outcomes are server-only', async () => {
  const privilege = async name => (await rows(
    `select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as client,
       bool_or(has_function_privilege('service_role', p.oid, 'execute')) as trusted,
       bool_or(has_function_privilege('anon', p.oid, 'execute')) as anonymous
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tonde' and p.proname = $1`, [name]))[0];
  for (const name of AUTHENTICATED_ONLY) {
    const grant = await privilege(name);
    assert.equal(grant.client, true, `${name} must be reachable by a creator session`);
    assert.equal(grant.trusted, false, `${name} must not be reachable by the trusted server`);
  }
  for (const name of SERVICE_ONLY) {
    const grant = await privilege(name);
    assert.equal(grant.client, false, `${name} must not be reachable by a client session`);
    assert.equal(grant.anonymous, false, `${name} must not be reachable anonymously`);
  }
  const authority = await privilege('publication_authorize');
  assert.equal(authority.anonymous, false, 'no anonymous publishing authority exists');
});

test('the audited set is exactly the Prompt 10 surface a client can execute', async () => {
  const clientReachable = (await rows(
    `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tonde' and p.proname ~ $1
       and has_function_privilege('authenticated', p.oid, 'execute')
     group by 1 order by 1`, [PREFIX])).map(row => row.name);
  assert.deepEqual(clientReachable, CLIENT_RPCS.map(([name]) => name).sort(),
    'a client-reachable Prompt 10 RPC exists that this audit does not cover, or vice versa');
  const serviceOnly = (await rows(
    `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tonde' and p.proname ~ $1
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')
     group by 1 order by 1`, [PREFIX])).map(row => row.name);
  assert.deepEqual(serviceOnly, [...SERVICE_ONLY].sort(),
    'a server-only Prompt 10 RPC exists that this audit does not classify');
});
