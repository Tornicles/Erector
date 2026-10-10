import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Prompt 11 packet 038 — retention and deletion orchestration, on real embedded PostgreSQL over one
// 001->038 stack. These tests pin the laws the migration claims: a deletion is the owner's explicit,
// confirmed decision and becomes durable work in the same transaction; a legal hold stops it; freezing
// hides the workspace and cancels open work; stored credentials are destroyed while provider-side
// revocation is recorded as an obligation rather than claimed; purging is bounded and resumable and
// queues storage objects before their rows leave; completion requires an independent verification that
// found nothing; an account is only recorded as deleted when nothing references it; retention sweeps
// apply policy in bounded batches, retain evidence by design, and never rewrite quarantined media; and
// a client session can never freeze, revoke, purge, verify or complete anything.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
let wa, wb, wc;
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
  await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asOwner = action => asUser(A, action);
const asStranger = action => asUser(B, action);

const requestDeletion = (workspace, over = {}) => asUser(over.user ?? A, () => rows(
  'select tonde.deletion_request($1,$2,$3,$4,$5,$6) as result',
  [workspace, over.scope ?? 'workspace', over.reason ?? 'Probe deletion',
   over.exportFirst ?? false, over.confirmation ?? 'PROBE-CONFIRMATION', over.graceDays ?? 7])
  .then(result => result[0].result));
const cancelDeletion = (workspace, request, reason = 'Probe cancellation', user = A) => asUser(user, () => rows(
  'select tonde.deletion_cancel($1,$2,$3) as result', [workspace, request, reason])
  .then(result => result[0].result));
const deletionStatus = (workspace, user = A) => asUser(user, () => rows(
  'select tonde.deletion_status($1) as result', [workspace]).then(result => result[0].result));
const beginDeletion = (request, force = false) => asService(() => rows(
  'select tonde.deletion_begin($1,$2) as result', [request, force]).then(result => result[0].result));
const revokeCredentials = request => asService(() => rows(
  'select tonde.deletion_revoke_credentials($1) as result', [request]).then(result => result[0].result));
const purgeStep = (request, limit = 5000) => asService(() => rows(
  'select tonde.deletion_purge_step($1,$2) as result', [request, limit]).then(result => result[0].result));
const verifyDeletion = request => asService(() => rows(
  'select tonde.deletion_verify($1) as result', [request]).then(result => result[0].result));
const completeDeletion = request => asService(() => rows(
  'select tonde.deletion_complete($1) as result', [request]).then(result => result[0].result));
const failDeletion = (request, code, message = 'Probe failure') => asService(() => rows(
  'select tonde.deletion_fail($1,$2,$3) as result', [request, code, message]).then(result => result[0].result));
const recordAuthDeletion = (request, outcome, evidence = {}) => asService(() => rows(
  'select tonde.deletion_record_auth_deletion($1,$2,$3) as result', [request, outcome, JSON.stringify(evidence)])
  .then(result => result[0].result));
const placeHold = (workspace, scope = 'workspace', reason = 'Probe hold') => asService(() => rows(
  'select tonde.legal_hold_place($1,$2,$3,$4) as result', [workspace, scope, reason, 'probe-operator'])
  .then(result => result[0].result));
const releaseHold = (hold, reason = 'Probe release') => asService(() => rows(
  'select tonde.legal_hold_release($1,$2) as result', [hold, reason]).then(result => result[0].result));
const sweepRequest = (dataClass, over = {}) => asService(() => rows(
  'select tonde.retention_sweep_request($1,$2,$3) as result',
  [dataClass, over.days === undefined ? null : over.days, over.dryRun ?? false])
  .then(result => result[0].result));
const sweepApply = (sweep, limit = 500) => asService(() => rows(
  'select tonde.retention_sweep_apply($1,$2) as result', [sweep, limit]).then(result => result[0].result));
const purgeClaim = (workerName, limit = 20, lease = 300) => asService(() => rows(
  'select tonde.storage_purge_claim($1,$2,$3) as result', [workerName, limit, lease])
  .then(result => result[0].result));
const purgeComplete = (purge, workerName, outcome = 'purged', detail = {}) => asService(() => rows(
  'select tonde.storage_purge_complete($1,$2,$3,$4) as result',
  [purge, workerName, outcome, JSON.stringify(detail)]).then(result => result[0].result));
const purgeFail = (purge, workerName, code = 'PROBE_PURGE_FAILURE') => asService(() => rows(
  'select tonde.storage_purge_fail($1,$2,$3,$4) as result', [purge, workerName, code, 'Probe purge failure'])
  .then(result => result[0].result));
const retentionStatus = (workspace, user = A) => asUser(user, () => rows(
  'select tonde.retention_status($1) as result', [workspace]).then(result => result[0].result));

const newWorkspace = (label, owner = A) => asService(async () => {
  const id = await scalar(`insert into tonde.workspaces(name,kind,owner_user_id) values($1,'team',$2) returning id`,
    [`Probe ${label}`, owner]);
  await db.query('insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,$3)',
    [id, owner, 'owner']);
  return id;
});

// A small but real workspace: a project, a production, a verified-looking media object, a result and
// one queued durable job. Deletion must handle all of it, and the job proves freezing cancels work.
const seedWorkspace = async label => {
  const workspace = await newWorkspace(label);
  const project = await asOwner(() => scalar(
    'insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id',
    [workspace, `Probe ${label}`, A]));
  const production = await asOwner(() => scalar(
    'insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id',
    [workspace, project, `Probe Production ${label}`, A]));
  const media = randomUUID();
  await asOwner(() => db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,
    original_filename,mime_type,file_category,bytes,upload_state,checksum,retention_policy,expires_at,
    created_by)
    values($1,$2,'tonde-production-media',$3,'clip.mp4','video/mp4','video',2048,'uploaded',$4,
      'temporary',now() + interval '30 days',$5)`,
    [media, workspace, `${workspace}/${media}/clip.mp4`, `sha256:probe-${label}`, A]));
  const result = await asOwner(() => scalar(
    'insert into tonde.results(workspace_id,production_id,media_id) values($1,$2,$3) returning id',
    [workspace, production, media]));
  const job = await asService(() => scalar(
    `select (tonde.job_enqueue($1,'media_preprocessing',$2,$3,$4,null,null,null,null) ->> 'job_id')::uuid`,
    [workspace, production, JSON.stringify({ probe: label }), `probe-deletion-${label}`]));
  return { workspace, project, production, media, result, job };
};

// Drives the orchestrator the way the worker does: revoke, then purge in bounded steps until drained.
const driveToVerifying = async request => {
  await revokeCredentials(request);
  let last;
  for (let round = 0; round < 80; round += 1) {
    last = await purgeStep(request, 5000);
    if (last.rows_purged === 0 && last.objects_queued === 0) break;
  }
  return verifyDeletion(request);
};

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
  for (const id of [A, B, C]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asOwner(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asStranger(() => scalar('select tonde.bootstrap_workspace()'));
  wc = await asUser(C, () => scalar('select tonde.bootstrap_workspace()'));
});

after(async () => { await db?.close(); });

test('the retention vocabulary, the policy registry and the purge-exempt set are closed and audited', async () => {
  const states = (await rows("select unnest(enum_range(null::tonde.deletion_state))::text as value")).map(r => r.value);
  assert.deepEqual(states, ['scheduled', 'frozen', 'revoking', 'purging', 'verifying', 'completed',
    'failed', 'cancelled']);
  const scopes = (await rows("select unnest(enum_range(null::tonde.deletion_scope))::text as value")).map(r => r.value);
  assert.deepEqual(scopes, ['workspace', 'account']);
  // Every class names a real table, and the retained-evidence set is exactly the audited one.
  const classes = await rows('select data_class, table_names, purge_action, purge_exempt from tonde.retention_classes order by purge_order');
  // The registry grows only by adding a class deliberately: 038 seeded the fourteen Prompt 11 classes,
  // 041 added the two Discover classes (saved content and the applications made from it) and 042 added
  // the operational evidence and alert configuration classes.
  assert.equal(classes.length, 18);
  const retained = (await rows(`select distinct unnest(table_names) as name from tonde.retention_classes
    where purge_exempt order by 1`)).map(r => r.name);
  assert.deepEqual(retained, ['audit_events', 'deletion_events', 'deletion_requests', 'legal_holds',
    'storage_purge_queue', 'workspaces']);
  // Append-only execution history is not residue: a routine sweep retains it, and only an
  // authorized deletion removes it.
  const jobEvents = classes.find(c => c.data_class === 'job_events');
  assert.equal(jobEvents.purge_action, 'retain');
  assert.equal(jobEvents.purge_exempt, false);
  // Billing evidence is the deliberate case where the two flags differ: a sweep retains it, a deletion
  // cannot leave it attached to rows it is removing.
  const usage = classes.find(c => c.data_class === 'usage_events');
  assert.equal(usage.purge_action, 'retain');
  assert.equal(usage.purge_exempt, false);
  const tables = await rows(`select unnest(table_names) as name from tonde.retention_classes`);
  for (const entry of tables) {
    assert.equal(Number(await scalar(`select count(*) from information_schema.tables
      where table_schema in ('tonde','tonde_private') and table_name = $1`, [entry.name])), 1,
    `${entry.name} must exist`);
  }
  // The purge list is derived from the catalog: it includes real workspace tables and excludes the
  // exempt set and the workspace tombstone.
  const purged = (await rows('select unnest(tonde_private.workspace_purge_tables()) as name')).map(r => r.name);
  for (const name of ['media_files', 'jobs', 'projects', 'productions', 'usage_events', 'results',
    'media_upload_intents', 'job_events', 'object_versions', 'publication_attempts']) {
    assert.ok(purged.includes(name), `${name} must be purged`);
  }
  for (const name of retained) assert.equal(purged.includes(name), false, `${name} must never be purged`);
  assert.equal(purged.includes('workspaces'), false);
  // No client reaches the policy registry.
  assert.equal((await failure(() => asOwner(() => rows('select * from tonde.retention_classes')))).code, '42501');
});

test('a deletion is the owner\'s confirmed decision and becomes durable work in the same transaction', async () => {
  const { workspace } = await seedWorkspace('request');
  // A non-member of the workspace cannot even ask about it.
  assert.equal((await failure(() => requestDeletion(workspace, { confirmation: 'Probe request', user: B }))).code, '42501');
  // Typed confirmation: the exact workspace name, not a checkbox.
  const wrong = await failure(() => requestDeletion(workspace, { confirmation: 'probe request' }));
  assert.equal(wrong.code, 'PT400');
  assert.match(wrong.message, /DELETION_NOT_CONFIRMED/);
  const requested = await requestDeletion(workspace, { confirmation: 'Probe request', graceDays: 7 });
  const request = requested.requests[0].request_id;
  assert.equal(requested.requests[0].state, 'scheduled');
  assert.equal(requested.requests[0].idempotent, false);
  assert.equal(requested.grace_days, 7);
  // The durable work request committed with the decision, not after it.
  const job = (await rows(`select j.job_type, j.worker_class, j.status::text as status, j.input_metadata
    from tonde.jobs j join tonde.deletion_requests r on r.job_id = j.id where r.id = $1`, [request]))[0];
  assert.equal(job.job_type, 'deletion_orchestration');
  assert.equal(job.worker_class, 'maintenance');
  assert.equal(job.status, 'queued');
  assert.equal(job.input_metadata.deletion_request_id, request);
  // The request and its first event are recorded.
  assert.equal(Number(await scalar('select count(*) from tonde.deletion_events where request_id = $1', [request])), 1);
  assert.equal(await scalar('select event_type from tonde.deletion_events where request_id = $1', [request]), 'requested');
  assert.equal(Number(await scalar(`select count(*) from tonde.audit_events
    where workspace_id = $1 and event_type = 'deletion.requested'`, [workspace])), 1);
  // Asking twice is not two deletions.
  const repeat = await requestDeletion(workspace, { confirmation: 'Probe request' });
  assert.equal(repeat.requests[0].idempotent, true);
  assert.equal(repeat.requests[0].request_id, request);
  assert.equal(Number(await scalar('select count(*) from tonde.deletion_requests where workspace_id = $1', [workspace])), 1);
  // A client session can read its own record but can never write one.
  assert.equal((await failure(() => asOwner(() => db.query(`insert into tonde.deletion_requests(workspace_id,
    owner_user_id, scope, requested_by, confirmed_name, grace_until)
    values($1,$2,'workspace',$2,'x',now())`, [workspace, A])))).code, '42501');
  assert.equal(Number((await asOwner(() => rows('select count(*)::integer as total from tonde.deletion_requests where workspace_id = $1', [workspace])))[0].total), 1);
  assert.equal(Number((await asStranger(() => rows('select count(*)::integer as total from tonde.deletion_requests where workspace_id = $1', [workspace])))[0].total), 0);
});

test('a legal hold stops both the request and the freeze, and releasing it unblocks', async () => {
  const { workspace } = await seedWorkspace('hold');
  const hold = await placeHold(workspace, 'workspace', 'Litigation hold');
  assert.equal(hold.active, true);
  assert.equal((await placeHold(workspace, 'workspace', 'Litigation hold')).idempotent, true);
  const refused = await failure(() => requestDeletion(workspace, { confirmation: 'Probe hold', graceDays: 0 }));
  assert.equal(refused.code, 'PT409');
  assert.match(refused.message, /LEGAL_HOLD_ACTIVE/);
  assert.equal(Number(await scalar('select count(*) from tonde.deletion_requests where workspace_id = $1', [workspace])), 0);
  assert.equal((await releaseHold(hold.hold_id, 'Matter closed')).active, false);
  const requested = await requestDeletion(workspace, { confirmation: 'Probe hold', graceDays: 0 });
  const request = requested.requests[0].request_id;
  // A hold placed after the request still blocks freezing.
  const second = await placeHold(workspace, 'workspace', 'Second hold');
  const blocked = await failure(() => beginDeletion(request, true));
  assert.equal(blocked.code, 'PT409');
  assert.match(blocked.message, /LEGAL_HOLD_ACTIVE/);
  assert.equal(await scalar('select lifecycle::text from tonde.workspaces where id = $1', [workspace]), 'active');
  await releaseHold(second.hold_id, 'Released again');
  const frozen = await beginDeletion(request, false);
  assert.equal(frozen.state, 'frozen');
  assert.equal(frozen.idempotent, false);
  assert.equal((await beginDeletion(request, false)).idempotent, true);
});

test('freezing enforces the grace period, hides the workspace, and cancels open work first', async () => {
  const fixture = await seedWorkspace('freeze');
  const requested = await requestDeletion(fixture.workspace, { confirmation: 'Probe freeze', graceDays: 3 });
  const request = requested.requests[0].request_id;
  const early = await failure(() => revokeCredentials(request));
  assert.equal(early.code, 'PT409');
  assert.match(early.message, /DELETION_NOT_FROZEN/);
  const graceRefusal = await failure(() => beginDeletion(request, false));
  assert.equal(graceRefusal.code, 'PT409');
  assert.match(graceRefusal.message, /DELETION_GRACE_ACTIVE/);
  const frozen = await beginDeletion(request, true);
  assert.equal(frozen.state, 'frozen');
  assert.equal(frozen.jobs_cancelled, 1);
  assert.equal(await scalar('select lifecycle::text from tonde.workspaces where id = $1', [fixture.workspace]), 'deleted');
  // The open job is cancelled through the job state machine, with its reason recorded.
  const job = (await rows(`select status::text as status, termination_reason, cancel_reason, completed_at is not null as stamped
    from tonde.jobs where id = $1`, [fixture.job]))[0];
  assert.equal(job.status, 'cancelled');
  assert.equal(job.termination_reason, 'user_cancelled');
  assert.match(job.cancel_reason, /Workspace deletion/);
  assert.equal(job.stamped, true);
  // A frozen workspace is no longer visible to its members.
  assert.equal(Number((await asOwner(() => rows('select count(*)::integer as total from tonde.workspaces where id = $1', [fixture.workspace])))[0].total), 0);
  // The owner can still cancel while the workspace is frozen but nothing was destroyed.
  const cancelled = await cancelDeletion(fixture.workspace, request, 'Changed my mind');
  assert.equal(cancelled.state, 'cancelled');
  assert.equal((await cancelDeletion(fixture.workspace, request, 'Changed my mind')).idempotent, true);
  const status = await deletionStatus(fixture.workspace);
  assert.equal(status.state, 'cancelled');
  assert.equal(status.cancellable, false);
  // A stranger cannot read the record at all.
  assert.equal((await failure(() => deletionStatus(fixture.workspace, B))).code, '42501');
});

test('revoking destroys the stored ciphertext and records provider revocation as an obligation', async () => {
  const { workspace } = await seedWorkspace('revoke');
  await asService(async () => {
    await db.query(`insert into tonde.integration_providers(key,name,category,auth_type,adapter_state,enabled,note)
      values('probe_deletions','Probe deletion provider','social_publishing','oauth','verified',true,
        'Test fixture only; no adapter exists.') on conflict (key) do nothing`);
  });
  await asService(async () => {
    await db.query(`insert into tonde.integration_provider_capabilities(provider_key,capability_key,
      connection_required,required_scopes,enabled,note)
      values('probe_deletions','publish',true,$1,true,'Test fixture only.') on conflict do nothing`,
      [['publish_content']]);
  });
  const connection = await asService(() => scalar(
    `insert into tonde.integration_connections(workspace_id,provider,connected_by,status,verified_at,
      requested_scopes,scopes,external_account_label)
      values($1,'probe_deletions',$2,'connected',now(),$3,$3,'Probe account') returning id`,
    [workspace, A, ['publish_content']]));
  await asService(() => db.query(`insert into tonde_private.integration_credentials(connection_id,ciphertext,encryption_key_id)
    values($1, decode(repeat('ab',40),'hex'), 'probe-key')`, [connection]));
  assert.equal(Number(await scalar('select count(*) from tonde_private.integration_credentials where connection_id = $1', [connection])), 1);
  const requested = await requestDeletion(workspace, { confirmation: 'Probe revoke', graceDays: 0 });
  const request = requested.requests[0].request_id;
  await beginDeletion(request, false);
  const revoked = await revokeCredentials(request);
  assert.equal(revoked.state, 'revoking');
  assert.equal(revoked.credentials_destroyed, 1);
  assert.equal(revoked.idempotent, false);
  assert.equal(Number(await scalar('select count(*) from tonde_private.integration_credentials where connection_id = $1', [connection])), 0);
  assert.equal(await scalar('select status from tonde.integration_connections where id = $1', [connection]), 'revoked');
  // The provider token was destroyed here; revoking it at the provider is an obligation, not a claim.
  assert.equal(revoked.remote_revocation_required.length, 1);
  assert.equal(revoked.remote_revocation_required[0].provider, 'probe_deletions');
  assert.equal(Number(await scalar(`select count(*) from tonde.deletion_events
    where request_id = $1 and event_type = 'remote_revocation_required'`, [request])), 1);
  assert.equal((await revokeCredentials(request)).idempotent, true);
});

test('purging is bounded and resumable, queues objects before their rows leave, and completes only when verified', async () => {
  const fixture = await seedWorkspace('purge');
  const requested = await requestDeletion(fixture.workspace, { confirmation: 'Probe purge', graceDays: 0 });
  const request = requested.requests[0].request_id;
  await beginDeletion(request, false);
  const first = await revokeCredentials(request);
  assert.equal(first.state, 'revoking');
  const step = await purgeStep(request, 2);
  assert.equal(step.rows_purged > 0, true);
  assert.equal(step.objects_queued, 1);
  // The object is queued for storage purging before its row leaves; the queue holds the real key.
  const queued = (await rows(`select bucket, object_key, state, reason from tonde.storage_purge_queue
    where workspace_id = $1`, [fixture.workspace]));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].bucket, 'tonde-production-media');
  assert.match(queued[0].object_key, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/clip\.mp4$/);
  assert.equal(queued[0].state, 'pending');
  assert.match(queued[0].reason, /deletion:/);
  // Verification counts what is actually still there: a pending object blocks completion.
  const verifying = await driveToVerifying(request);
  assert.equal(verifying.state, 'verifying');
  assert.equal(verifying.verified, false);
  assert.ok(verifying.residuals.counts.storage_purge_pending >= 1);
  const refused = await failure(() => completeDeletion(request));
  assert.equal(refused.code, 'PT409');
  assert.match(refused.message, /DELETION_RESIDUALS_REMAIN/);
  assert.equal(await scalar('select state from tonde.deletion_requests where id = $1', [request]), 'verifying');
  // The purge worker removes the object and reports that it is gone.
  const claimed = await purgeClaim('probe-purge-worker', 10);
  const entry = claimed.find(candidate => candidate.workspace_id === fixture.workspace);
  assert.ok(entry);
  assert.equal(entry.bucket, queued[0].bucket);
  assert.equal((await purgeComplete(entry.purge_id, 'probe-purge-worker', 'purged', { verified: true })).state, 'purged');
  const verified = await verifyDeletion(request);
  assert.equal(verified.verified, true);
  assert.equal(verified.residuals.total, 0);
  const completed = await completeDeletion(request);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.idempotent, false);
  assert.equal((await completeDeletion(request)).idempotent, true);
  // What remains is the tombstone and the evidence, and the trail says so.
  assert.equal(await scalar('select lifecycle::text from tonde.workspaces where id = $1', [fixture.workspace]), 'deleted');
  assert.equal(Number(await scalar('select count(*) from tonde.deletion_requests where id = $1', [request])), 1);
  assert.equal(Number(await scalar('select count(*) from tonde.productions where workspace_id = $1', [fixture.workspace])), 0);
  assert.equal(Number(await scalar('select count(*) from tonde.media_files where workspace_id = $1', [fixture.workspace])), 0);
  assert.equal(Number(await scalar('select count(*) from tonde.jobs where workspace_id = $1', [fixture.workspace])), 0);
  assert.ok(Number(await scalar(`select count(*) from tonde.audit_events where workspace_id = $1`, [fixture.workspace])) > 0);
  const trail = (await rows(`select event_type from tonde.deletion_events where request_id = $1 order by id`, [request]))
    .map(row => row.event_type);
  for (const expected of ['requested', 'frozen', 'credentials_revoked', 'purge_progress', 'verified', 'completed']) {
    assert.ok(trail.includes(expected), `the trail records ${expected}`);
  }
  // A completed deletion is a dead end for cancellation, and the status says so.
  const status = await deletionStatus(fixture.workspace);
  assert.equal(status.state, 'completed');
  assert.equal(status.cancellable, false);
});

test('an account deletion is only recorded as deleted when nothing references the identity', async () => {
  const requested = await asUser(C, () => rows(
    'select tonde.deletion_request($1,$2,$3,$4,$5,$6) as result',
    [wc, 'account', 'Deleting my account', false, 'Personal workspace', 0]).then(result => result[0].result));
  const request = requested.requests[0].request_id;
  assert.equal(requested.requests[0].state, 'scheduled');
  await beginDeletion(request, false);
  await revokeCredentials(request);
  const verifying = await driveToVerifying(request);
  assert.equal(verifying.verified, false);
  assert.ok(verifying.residuals.counts.profile_not_anonymized >= 1);
  // The identity is still referenced, so "deleted" is refused: the honest outcome is anonymized.
  const optimistic = await failure(() => recordAuthDeletion(request, 'deleted'));
  assert.equal(optimistic.code, 'PT409');
  assert.match(optimistic.message, /AUTH_IDENTITY_STILL_REFERENCED/);
  const honest = await recordAuthDeletion(request, 'anonymized_disabled', { admin_api: 'users.delete',
    result: 'identity still referenced by retained evidence; account anonymized and disabled' });
  assert.equal(honest.auth_deletion_outcome, 'anonymized_disabled');
  assert.ok(honest.references.total >= 1);
  const completed = await completeDeletion(request);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.auth_deletion_outcome, 'anonymized_disabled');
  assert.equal(completed.preferences_removed >= 0, true);
  // The profile is anonymized, preferences are gone, and the workspace is a tombstone.
  assert.equal(await scalar('select display_name from tonde.profiles where user_id = $1', [C]), 'Deleted account');
  assert.equal(await scalar('select avatar_url from tonde.profiles where user_id = $1', [C]), null);
  assert.equal(Number(await scalar('select count(*) from tonde.user_preferences where user_id = $1', [C])), 0);
  assert.equal(await scalar('select lifecycle::text from tonde.workspaces where id = $1', [wc]), 'deleted');
  // A workspace-scoped deletion must never claim to have dealt with an authentication identity.
  const fixture = await seedWorkspace('scope');
  const scoped = await requestDeletion(fixture.workspace, { confirmation: 'Probe scope', graceDays: 0 });
  const notApplicable = await failure(() => recordAuthDeletion(scoped.requests[0].request_id, 'deleted'));
  assert.equal(notApplicable.code, '22023');
  assert.match(notApplicable.message, /AUTH_DELETION_NOT_APPLICABLE/);
});

test('retention sweeps retain evidence by design and never rewrite quarantined media', async () => {
  const fixture = await seedWorkspace('sweep');
  const infected = randomUUID();
  await asService(() => db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,
    original_filename,mime_type,file_category,bytes,upload_state,processing_state,scan_state,checksum,
    retention_policy,expires_at,verified_at,verified_bytes,verified_by,created_by)
    values($1,$2,'tonde-production-media',$3,'infected.mp4','video/mp4','video',2048,'quarantined',
      'blocked','infected',$4,'temporary',now() - interval '30 days',now(),2048,'probe-scanner',$5)`,
    [infected, fixture.workspace, `${fixture.workspace}/${infected}/infected.mp4`, 'sha256:probe-infected', A]));
  await asService(() => db.query(`update tonde.media_files set expires_at = now() - interval '30 days' where id = $1`,
    [fixture.media]));
  // A retained class reports what it holds and deletes nothing.
  const retained = await sweepRequest('audit_events');
  assert.equal(retained.purge_action, 'retain');
  const retainedResult = await sweepApply(retained.sweep_id);
  assert.equal(retainedResult.state, 'completed');
  assert.equal(retainedResult.rows_this_batch, 0);
  assert.ok(retainedResult.retained > 0);
  // The media class queues objects and marks rows deleted - except quarantined ones, which keep saying
  // they are infected and blocked while only their object is queued.
  const sweep = await sweepRequest('media_temporary', { days: 0 });
  assert.equal(sweep.purge_action, 'queue_object_purge');
  const applied = await sweepApply(sweep.sweep_id, 100);
  assert.equal(applied.rows_this_batch, 1);
  assert.equal(applied.objects_queued, 2);
  assert.equal(applied.state, 'completed');
  assert.equal(await scalar('select upload_state from tonde.media_files where id = $1', [fixture.media]), 'deleted');
  assert.equal(await scalar('select upload_state from tonde.media_files where id = $1', [infected]), 'quarantined');
  assert.equal(await scalar('select processing_state from tonde.media_files where id = $1', [infected]), 'blocked');
  assert.equal(await scalar('select scan_state from tonde.media_files where id = $1', [infected]), 'infected');
  assert.equal(Number(await scalar(`select count(*) from tonde.storage_purge_queue
    where workspace_id = $1 and reason = 'retention:media_temporary'`, [fixture.workspace])), 2);
  // The classes the migration does not know how to act on are refused, never silently ignored.
  assert.equal((await failure(() => sweepRequest('not_a_class'))).code, '22023');
  // A client session cannot run retention at all.
  assert.equal((await failure(() => asOwner(() => rows('select tonde.retention_sweep_request($1,null,false)', ['media_temporary'])))).code, '42501');
});

test('append-only execution history is retained by sweeps and removed only by an authorized deletion', async () => {
  const fixture = await seedWorkspace('events');
  const history = await asService(() => scalar(`insert into tonde.job_events(workspace_id,job_id,event_type,
    actor_kind,actor,created_at) values($1,$2,'enqueued','system','probe',now() - interval '120 days') returning id`,
    [fixture.workspace, fixture.job]));
  // A sweep reports it and deletes nothing: history is not residue.
  const sweep = await sweepRequest('job_events');
  assert.equal(sweep.purge_action, 'retain');
  const applied = await sweepApply(sweep.sweep_id, 500);
  assert.equal(applied.state, 'completed');
  assert.equal(applied.rows_this_batch, 0);
  assert.ok(applied.retained > 0);
  assert.equal(Number(await scalar('select count(*) from tonde.job_events where id = $1', [history])), 1);
  // Nor can a privileged caller simply delete it, and the append-only laws of earlier packets still
  // hold for their own tables.
  const refused = await failure(() => asService(() => db.query('delete from tonde.job_events where id = $1', [history])));
  assert.equal(refused.code, '23514');
  assert.equal((await failure(() => asService(() => db.query(`update tonde.job_events set actor = 'forged' where id = $1`,
    [history])))).code, '23514');
  const versions = await failure(() => asService(() => db.query(
    'delete from tonde.object_versions where workspace_id = $1', [fixture.workspace])));
  assert.equal(versions.code, '23514');
  // The authorized deletion is the one path that removes it - and only for its own workspace.
  const other = await seedWorkspace('events-other');
  const otherHistory = await asService(() => scalar(`insert into tonde.job_events(workspace_id,job_id,event_type,
    actor_kind,actor) values($1,$2,'enqueued','system','probe') returning id`, [other.workspace, other.job]));
  const requested = await requestDeletion(fixture.workspace, { confirmation: 'Probe events', graceDays: 0 });
  const request = requested.requests[0].request_id;
  await beginDeletion(request, false);
  await revokeCredentials(request);
  await purgeStep(request, 5000);
  assert.equal(Number(await scalar('select count(*) from tonde.job_events where id = $1', [history])), 0);
  assert.equal(Number(await scalar('select count(*) from tonde.job_events where id = $1', [otherHistory])), 1);
});

test('storage purging is a lease: only its holder may act, and exhausted retries stop honestly', async () => {
  const fixture = await seedWorkspace('lease');
  const requested = await requestDeletion(fixture.workspace, { confirmation: 'Probe lease', graceDays: 0 });
  const request = requested.requests[0].request_id;
  await beginDeletion(request, false);
  await revokeCredentials(request);
  await purgeStep(request, 5000);
  const claimed = await purgeClaim('probe-lease-worker-a', 10, 60);
  const entry = claimed.find(candidate => candidate.workspace_id === fixture.workspace);
  assert.ok(entry);
  assert.equal(entry.attempts, 1);
  // A worker that does not hold the lease cannot complete or fail the purge.
  const stolen = await failure(() => purgeComplete(entry.purge_id, 'probe-other-worker', 'purged'));
  assert.equal(stolen.code, '42501');
  assert.match(stolen.message, /PURGE_LEASE_NOT_OWNED/);
  assert.equal((await purgeComplete(entry.purge_id, 'probe-lease-worker-a', 'absent')).state, 'absent');
  assert.equal((await purgeComplete(entry.purge_id, 'probe-lease-worker-a', 'purged')).idempotent, true);
  // Exhausted attempts land in a state that says it failed, after bounded backoff.
  const second = await seedWorkspace('lease-retry');
  const secondRequest = (await requestDeletion(second.workspace, { confirmation: 'Probe lease-retry', graceDays: 0 }))
    .requests[0].request_id;
  await beginDeletion(secondRequest, false);
  await revokeCredentials(secondRequest);
  await purgeStep(secondRequest, 5000);
  let outcome;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await asService(() => db.query(`update tonde.storage_purge_queue set available_at = now()
      where workspace_id = $1`, [second.workspace]));
    const claim = await purgeClaim('probe-retry-worker', 10, 60);
    const row = claim.find(candidate => candidate.workspace_id === second.workspace);
    if (!row) break;
    outcome = await purgeFail(row.purge_id, 'probe-retry-worker');
  }
  assert.equal(outcome.state, 'failed');
  assert.equal(outcome.retrying, false);
  assert.equal(outcome.attempts, 5);
  assert.equal(outcome.max_attempts, 5);
  assert.equal(await scalar('select state from tonde.storage_purge_queue where workspace_id = $1', [second.workspace]), 'failed');
  assert.equal(await scalar('select last_error_code from tonde.storage_purge_queue where workspace_id = $1', [second.workspace]), 'PROBE_PURGE_FAILURE');
  // A failed object keeps the deletion incomplete, and verification says exactly that.
  const verifying = await verifyDeletion(secondRequest);
  assert.equal(verifying.verified, false);
  assert.ok(verifying.residuals.counts.storage_purge_pending >= 1);
});

test('state transitions cannot be skipped, and the schema enforces what each phase stamps', async () => {
  const fixture = await seedWorkspace('transitions');
  const requested = await requestDeletion(fixture.workspace, { confirmation: 'Probe transitions', graceDays: 0 });
  const request = requested.requests[0].request_id;
  // Purging, verifying and completing before freezing are all refused.
  for (const action of [() => purgeStep(request), () => verifyDeletion(request), () => completeDeletion(request)]) {
    const refused = await failure(action);
    assert.equal(refused.code, 'PT409');
  }
  await beginDeletion(request, false);
  // Verifying before any purge is refused, and revoking twice is idempotent rather than a second state.
  assert.equal((await failure(() => verifyDeletion(request))).code, 'PT409');
  await revokeCredentials(request);
  assert.equal((await revokeCredentials(request)).idempotent, true);
  // A deletion in a terminal state cannot fail or be cancelled again.
  await driveToVerifying(request);
  await asService(() => db.query(`update tonde.storage_purge_queue set state = 'purged', purged_at = now()
    where workspace_id = $1`, [fixture.workspace]));
  await verifyDeletion(request);
  await completeDeletion(request);
  assert.equal((await failure(() => cancelDeletion(fixture.workspace, request))).code, 'PT409');
  assert.equal((await failure(() => failDeletion(request, 'PROBE'))).code, 'PT409');
  // The phase stamps are real constraints, not conventions: a direct write cannot fake a phase.
  const other = await seedWorkspace('constraints');
  assert.equal((await failure(() => asService(() => db.query(`insert into tonde.deletion_requests(workspace_id,
    owner_user_id, scope, state, requested_by, confirmed_name, grace_until)
    values($1,$2,'workspace','completed',$2,'x',now())`, [other.workspace, A])))).code, '23514');
  assert.equal((await failure(() => asService(() => db.query(`insert into tonde.deletion_requests(workspace_id,
    owner_user_id, scope, state, requested_by, confirmed_name, grace_until)
    values($1,$2,'workspace','failed',$2,'x',now())`, [other.workspace, A])))).code, '23514');
  assert.equal((await failure(() => asService(() => db.query(`insert into tonde.deletion_requests(workspace_id,
    owner_user_id, scope, state, requested_by, confirmed_name, grace_until)
    values($1,$2,'workspace','cancelled',$2,'x',now())`, [other.workspace, A])))).code, '23514');
  // An account-scoped request must be made by the account owner, and two open requests cannot coexist.
  assert.equal((await failure(() => asService(() => db.query(`insert into tonde.deletion_requests(workspace_id,
    owner_user_id, scope, requested_by, confirmed_name, grace_until)
    values($1,$2,'account',$3,'x',now())`, [other.workspace, A, B])))).code, '23514');
  await requestDeletion(other.workspace, { confirmation: 'Probe constraints', graceDays: 1 });
  assert.equal((await failure(() => asService(() => db.query(`insert into tonde.deletion_requests(workspace_id,
    owner_user_id, scope, requested_by, confirmed_name, grace_until)
    values($1,$2,'workspace',$2,'x',now())`, [other.workspace, A])))).code, '23505');
});

test('the deletion trail is append-only and a client can never write or overreach', async () => {
  const fixture = await seedWorkspace('trail');
  const requested = await requestDeletion(fixture.workspace, { confirmation: 'Probe trail', graceDays: 0 });
  const request = requested.requests[0].request_id;
  const event = await scalar('select id from tonde.deletion_events where request_id = $1', [request]);
  const write = await failure(() => asOwner(() => db.query(`insert into tonde.deletion_events(workspace_id,
    request_id, event_type, actor_kind) values($1,$2,'frozen','user')`, [fixture.workspace, request])));
  assert.equal(write.code, '42501');
  const edit = await failure(() => asOwner(() => db.query('update tonde.deletion_events set detail = $2 where id = $1',
    [event, JSON.stringify({ forged: true })])));
  assert.equal(edit.code, '42501');
  // Even a privileged session cannot rewrite the append-only trail, and cannot skip a phase.
  assert.equal((await failure(() => asService(() => db.query('update tonde.deletion_events set detail = $2 where id = $1',
    [event, JSON.stringify({ forged: true })])))).code, '23514');
  assert.equal((await failure(() => asSubService('select tonde_private.deletion_advance($1,$2,$3,$4,$5)',
    [request, 'completed', 'system', 'probe', 'completed']))).code, '42501');
  // Client sessions cannot reach the orchestration functions, and a non-member cannot read the record.
  const privileged = [
    ['select tonde.deletion_begin($1,false)', [request]],
    ['select tonde.deletion_revoke_credentials($1)', [request]],
    ['select tonde.deletion_purge_step($1,100)', [request]],
    ['select tonde.deletion_verify($1)', [request]],
    ['select tonde.deletion_complete($1)', [request]],
    ['select tonde.deletion_fail($1,$2,$3)', [request, 'PROBE', 'Probe']],
    ['select tonde.storage_purge_claim($1,10,60)', ['probe-client-worker']],
    ['select tonde.retention_sweep_apply($1,10)', [request]],
  ];
  for (const [call, args] of privileged) {
    const refused = await failure(() => asOwner(() => rows(call, args)));
    assert.equal(refused.code, '42501', `${call} must be privileged: ${refused.message}`);
  }
  assert.equal((await failure(() => deletionStatus(fixture.workspace, B))).code, '42501');
  assert.equal((await failure(() => deletionStatus(wb))).code, '42501');
  // A member of the workspace sees the honest status, including what it cannot yet do.
  const status = await deletionStatus(fixture.workspace);
  assert.equal(status.state, 'scheduled');
  assert.equal(status.scope, 'workspace');
  assert.equal(status.cancellable, true);
  assert.equal(status.legal_hold, null);
  assert.ok(status.events.length >= 1);
  assert.ok(status.meaning.length > 0);
});

test('retention status tells a member what expired and what is still queued, and refuses a stranger', async () => {
  const fixture = await seedWorkspace('status');
  await asService(() => db.query(`update tonde.media_files set expires_at = now() - interval '2 days' where id = $1`,
    [fixture.media]));
  // A distinct age makes this its own sweep rather than the idempotent replay of an earlier one.
  const sweep = await sweepRequest('media_temporary', { days: 1 });
  const applied = await sweepApply(sweep.sweep_id, 100);
  assert.equal(applied.rows_this_batch, 1);
  const status = await retentionStatus(fixture.workspace);
  assert.equal(status.expired_media, 0);
  assert.equal(status.objects_awaiting_purge, 1);
  assert.equal(status.objects_purged, 0);
  assert.equal(status.objects_failed, 0);
  assert.equal(status.classes.length, 18);
  assert.ok(status.meaning.length > 0);
  assert.equal((await failure(() => retentionStatus(fixture.workspace, B))).code, '42501');
});

// A service-role call that is expected to be refused by the revocation list rather than by RLS.
async function asSubService(sql, args) {
  return asService(() => rows(sql, args));
}
