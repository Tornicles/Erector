import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 10 packet 031 — integrations, on real embedded PostgreSQL over one 001->031 stack.
// These tests pin the laws the migration claims: nothing is enabled without an adapter, nothing is
// CONNECTED without a witness, granted scopes are a subset of requested scopes, secrets cannot enter a
// provider definition, OAuth state is single-use and expiring, and capability answers are scoped to
// one workspace. Nothing here contacts a provider and no external capability is claimed as working.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
async function asService(action) {
  await db.exec('begin; set local role service_role;');
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);
const capabilityAs = (user, workspace, provider, key) => asUser(user, () =>
  scalar('select tonde.integration_capability_state($1,$2,$3)', [workspace, provider, key]));
const capability = (workspace, provider, key) => capabilityAs(A, workspace, provider, key);
const hash = fill => fill.repeat(64);

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
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  }
  for (const id of [A, B]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asEditor(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asOther(() => scalar('select tonde.bootstrap_workspace()'));
});

after(async () => { await db?.close(); });

test('registry: the AI catalog is registered and no provider claims an adapter it does not have', async () => {
  assert.equal(Number(await scalar('select count(*) from tonde.ai_providers p left join tonde.integration_providers r on r.key = p.key where r.key is null')), 0);
  assert.equal(Number(await scalar('select count(*) from tonde.integration_providers')), Number(await scalar('select count(*) from tonde.ai_providers')));
  const manual = (await rows("select enabled, adapter_state, connection_required, auth_type from tonde.integration_providers where key = 'manual'"))[0];
  assert.deepEqual(manual, { enabled: true, adapter_state: 'implemented', connection_required: false, auth_type: 'none' });
  assert.equal(Number(await scalar("select count(*) from tonde.integration_providers where key <> 'manual' and (enabled or adapter_state <> 'absent')")), 0);

  const enabledWithoutAdapter = await failure(() => asService(() => db.query(
    "insert into tonde.integration_providers(key,name,category,auth_type,enabled) values('probe_enabled','Probe','social_publishing','oauth',true)")));
  assert.match(enabledWithoutAdapter.message, /provider_enabled_has_adapter|check constraint/i);

  const secretConfiguration = await failure(() => asService(() => db.query(
    "insert into tonde.integration_providers(key,name,category,auth_type,configuration) values('probe_secret','Probe','social_publishing','oauth',$1)",
    [JSON.stringify({ client_secret: 'must-not-be-stored' })])));
  assert.match(secretConfiguration.message, /must not contain secrets/);

  await asService(() => db.query(
    "insert into tonde.integration_providers(key,name,category,auth_type,configuration,note) values('probe_disabled','Probe','social_publishing','oauth',$1,'Registered for tests only; no adapter exists.')",
    [JSON.stringify({ api_version: 'v3' })]));
  assert.equal(await scalar("select adapter_state = 'absent' and not enabled from tonde.integration_providers where key = 'probe_disabled'"), true);
});

test('capabilities: an adapter must exist before a capability can be enabled', async () => {
  const noAdapter = await failure(() => asService(() => db.query(
    "insert into tonde.integration_provider_capabilities(provider_key,capability_key,enabled) values('runway','image_to_video',true)")));
  assert.match(noAdapter.message, /No adapter exists/);

  // A declared-but-disabled capability is a record of intent, not a claim of support.
  await asService(() => db.query(
    "insert into tonde.integration_provider_capabilities(provider_key,capability_key,enabled,note) values('runway','image_to_video',false,'Declared only; no adapter exists yet.')"));
  assert.equal(await scalar("select not enabled from tonde.integration_provider_capabilities where provider_key='runway' and capability_key='image_to_video'"), true);
});

test('connections: CONNECTED needs a witness, a verified provider and requested scopes', async () => {
  const provider = (await rows("select enabled, adapter_state from tonde.integration_providers where key='runway'"))[0];
  assert.deepEqual(provider, { enabled: false, adapter_state: 'absent' });

  const unregistered = await failure(() => asService(() => db.query(
    "insert into tonde.integration_connections(workspace_id,provider,connected_by) values($1,'not_registered',$2)", [wa, A])));
  assert.match(unregistered.message, /connection_provider_registered|foreign key/i);

  const unrequestedScope = await failure(() => asService(() => db.query(
    "insert into tonde.integration_connections(workspace_id,provider,connected_by,scopes) values($1,'runway',$2,$3)", [wa, A, ['generate']])));
  assert.match(unrequestedScope.message, /connection_scopes_were_requested|check constraint/i);

  const unwitnessed = await failure(() => asService(() => db.query(
    "insert into tonde.integration_connections(workspace_id,provider,connected_by,status) values($1,'runway',$2,'connected')", [wa, A])));
  assert.match(unwitnessed.message, /without a recorded verification/);

  // A witness without a live provider is still not a connection: the guard refuses the claim.
  const unverifiedProvider = await failure(() => asService(() => db.query(
    "insert into tonde.integration_connections(workspace_id,provider,connected_by,status,verified_at,requested_scopes,scopes) values($1,'runway',$2,'connected',now(),$3,$3)",
    [wa, A, ['generate']])));
  assert.match(unverifiedProvider.message, /no verified adapter/);

  const unrevoked = await failure(() => asService(() => db.query(
    "insert into tonde.integration_connections(workspace_id,provider,connected_by,status) values($1,'runway',$2,'revoked')", [wa, A])));
  assert.match(unrevoked.message, /must record when it was revoked/);

  // The honest path: a verified adapter first, then a witnessed connection with requested scopes.
  await asService(() => db.query("update tonde.integration_providers set enabled = true, adapter_state = 'verified' where key = 'runway'"));
  const connection = await asService(() => scalar(
    "insert into tonde.integration_connections(workspace_id,provider,connected_by,status,verified_at,requested_scopes,scopes,external_account_label) values($1,'runway',$2,'connected',now(),$3,$3,'Probe channel') returning id",
    [wa, A, ['generate']]));
  assert.ok(connection);

  // Credentials existing never lets a client claim state: the client has read-only use of connections.
  const clientWrite = await failure(() => asEditor(() => db.query(
    "update tonde.integration_connections set status = 'revoked', revoked_at = now() where id = $1", [connection])));
  assert.match(clientWrite.message, /permission denied/);
  const clientInsert = await failure(() => asEditor(() => db.query(
    "insert into tonde.integration_connections(workspace_id,provider,connected_by) values($1,'runway',$2)", [wa, A])));
  assert.match(clientInsert.message, /permission denied/);

  // Disconnect is a server action, and it must record the moment it happened.
  await asService(() => db.query("update tonde.integration_connections set status = 'revoked', revoked_at = now() where id = $1", [connection]));
  assert.equal(await scalar("select status = 'revoked' and revoked_at is not null from tonde.integration_connections where id = $1", [connection]), true);
});

test('capability state: workspace-scoped, reason-bearing, and never optimistic', async () => {
  // Self-contained: an earlier test may have promoted runway, so start from the honest baseline.
  await asService(() => db.query("update tonde.integration_providers set enabled = false, adapter_state = 'absent' where key = 'runway'"));
  // Before any adapter is verified, TONDE says so instead of implying availability.
  assert.equal(await capability(wa, 'runway', 'image_to_video'), 'PROVIDER_NOT_IMPLEMENTED');
  // The registry is product catalog: readable by a member, not writable by a client.
  assert.equal(Number(await asEditor(() => scalar("select count(*) from tonde.integration_providers where key='runway'"))), 1);
  const clientCatalogWrite = await failure(() => asEditor(() => db.query("update tonde.integration_providers set enabled = true where key='runway'")));
  assert.match(clientCatalogWrite.message, /permission denied/);

  await asService(() => db.query("update tonde.integration_providers set enabled = true, adapter_state = 'verified' where key = 'runway'"));
  await asService(() => db.query("update tonde.integration_provider_capabilities set required_scopes = $1 where provider_key = 'runway' and capability_key = 'image_to_video'", [['generate']]));
  assert.equal(await capability(wa, 'unknown_provider', 'anything'), 'UNKNOWN_PROVIDER');
  assert.equal(await capability(wa, 'runway', 'not_a_capability'), 'UNKNOWN_CAPABILITY');
  assert.equal(await capability(wa, 'runway', 'image_to_video'), 'CAPABILITY_DISABLED');
  await asService(() => db.query("update tonde.integration_provider_capabilities set enabled = true where provider_key = 'runway' and capability_key = 'image_to_video'"));
  assert.equal(await capability(wa, 'runway', 'image_to_video'), 'CONNECTION_NOT_READY');

  const connection = await asService(() => scalar(
    "insert into tonde.integration_connections(workspace_id,provider,connected_by,status,verified_at,requested_scopes,scopes) values($1,'runway',$2,'connected',now(),$3,'{}') returning id",
    [wa, A, ['generate']]));
  assert.equal(await capability(wa, 'runway', 'image_to_video'), 'MISSING_SCOPE');
  await asService(() => db.query("update tonde.integration_connections set scopes = $2 where id = $1", [connection, ['generate']]));
  assert.equal(await capability(wa, 'runway', 'image_to_video'), 'AVAILABLE');

  // A capability that needs no connection is available on its own evidence.
  await asService(() => db.query(
    "insert into tonde.integration_provider_capabilities(provider_key,capability_key,connection_required,enabled) values('runway','read_status',false,true)"));
  assert.equal(await capability(wa, 'runway', 'read_status'), 'AVAILABLE');

  // Withdrawing the witness withdraws the answer.
  await asService(() => db.query("update tonde.integration_connections set status = 'revoked', revoked_at = now() where id = $1", [connection]));
  assert.equal(await capability(wa, 'runway', 'image_to_video'), 'CONNECTION_NOT_READY');

  // Another workspace cannot evaluate, or even name, this workspace's capability state.
  const crossTenant = await failure(() => capabilityAs(B, wa, 'runway', 'image_to_video'));
  assert.match(crossTenant.message, /Workspace access denied/);
  assert.equal(await capabilityAs(B, wb, 'runway', 'image_to_video'), 'CONNECTION_NOT_READY');

  // Leave the registry truthful for any later test in this file.
  await asService(() => db.query("update tonde.integration_providers set enabled = false, adapter_state = 'absent' where key = 'runway'"));
});

test('OAuth state: single-use, bound, short-lived and server-only', async () => {
  let minted = 0;
  const mint = (over = {}) => {
    minted += 1;
    return asService(() => rows(
      `insert into tonde.integration_oauth_states(workspace_id,user_id,provider_key,state_hash,verifier_hash,redirect_uri,requested_scopes,expires_at)
       values($1,$2,'runway',$3,$4,'http://localhost:5173/auth/callback',$5, now() + interval '10 minutes') returning id, expires_at, state_hash`,
      [wa, A, over.stateHash ?? hash(String(minted)), over.verifierHash ?? hash('b'), ['generate']]).then(result => result[0]));
  };

  const first = await mint();
  await asService(() => db.query('update tonde.integration_oauth_states set consumed_at = now(), consumed_by = $2 where id = $1', [first.id, A]));
  const replay = await failure(() => asService(() => db.query(
    'update tonde.integration_oauth_states set consumed_at = now(), consumed_by = $2 where id = $1', [first.id, A])));
  assert.match(replay.message, /already consumed/);

  const stale = await mint();
  const expired = await failure(() => asService(() => db.query(
    'update tonde.integration_oauth_states set consumed_at = $2, consumed_by = $3 where id = $1',
    [stale.id, new Date(new Date(stale.expires_at).getTime() + 1000).toISOString(), A])));
  assert.match(expired.message, /expired/);

  const rewriting = await mint();
  const rewritten = await failure(() => asService(() => db.query(
    'update tonde.integration_oauth_states set state_hash = $2, consumed_at = now() where id = $1', [rewriting.id, hash('c')])));
  assert.match(rewritten.message, /cannot be rewritten/);

  const longWindow = await failure(() => asService(() => db.query(
    `insert into tonde.integration_oauth_states(workspace_id,user_id,provider_key,state_hash,expires_at)
     values($1,$2,'runway',$3, now() + interval '31 minutes')`, [wa, A, hash('d')])));
  assert.match(longWindow.message, /oauth_state_window_is_short|check constraint/i);

  const duplicate = await mint({ stateHash: hash('e') });
  const duplicatedHash = await failure(() => asService(() => db.query(
    `insert into tonde.integration_oauth_states(workspace_id,user_id,provider_key,state_hash,expires_at)
     values($1,$2,'runway',$3, now() + interval '5 minutes')`, [wa, A, duplicate.state_hash])));
  assert.match(duplicatedHash.message, /duplicate key|unique/i);

  // The raw state is never stored, and no client role can reach the flow table at all.
  assert.equal(Number(await scalar("select count(*) from tonde.integration_oauth_states where state_hash !~ '^[0-9a-f]{64}$'")), 0);
  const clientRead = await failure(() => asEditor(() => scalar('select count(*) from tonde.integration_oauth_states')));
  assert.match(clientRead.message, /permission denied/);
  const clientWrite = await failure(() => asEditor(() => db.query(
    `insert into tonde.integration_oauth_states(workspace_id,user_id,provider_key,state_hash,expires_at)
     values($1,$2,'runway',$3, now() + interval '5 minutes')`, [wa, A, hash('f')])));
  assert.match(clientWrite.message, /permission denied/);
});
