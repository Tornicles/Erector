import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Prompt 11 packet 036 — the durable job platform, on real embedded PostgreSQL over one 001->036
// stack. These tests pin the laws the migration claims: enqueue is idempotent and priority-capped,
// claiming is one atomic statement so two workers cannot own one job, only the lease owner may act,
// heartbeat fails when the lease is gone, completion is idempotent, retry is classification-aware and
// never more optimistic than the job type allows, exhausted work is preserved in the dead letter,
// cancellation is honest about irreversible remote effects, timeouts and lease loss are distinct, and
// a domain transaction that authorizes publishing cannot commit without its outbox event.
//
// Leasing is claimed as *atomic*, not merely sequential: `job_claim` performs one statement with
// FOR UPDATE SKIP LOCKED, and a second claim in the same database cannot see a job that is already
// leased. True parallel contention (two independent sessions racing for one row) is exercised against
// hosted PostgreSQL by scripts/pre-prompt10-hosted-verify.mjs, because the embedded single-session
// PostgreSQL harness cannot hold two transactions open at once.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, connection;
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
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);

const register = (workerName, workerClass, capabilities = []) => asService(() => rows(
  'select tonde.worker_register($1,$2,$3,$4,$5) as result',
  [workerName, workerClass, 'probe-instance', '11.0.0', capabilities]).then(result => result[0].result));
const enqueue = (fields = {}) => asService(() => rows(
  'select tonde.job_enqueue($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
  [fields.workspace ?? wa, fields.jobType, fields.production ?? null,
   JSON.stringify(fields.payload ?? {}), fields.idempotencyKey ?? null, fields.priority ?? null,
   fields.parent ?? null, fields.requestedBy === undefined ? null : fields.requestedBy,
   fields.timeoutSeconds ?? null]).then(result => result[0].result));
const claim = (workerName, workerClass, limit = 25, leaseSeconds = 300) => asService(() => rows(
  'select tonde.job_claim($1,$2,$3,$4) as result', [workerName, workerClass, limit, leaseSeconds])
  .then(result => result[0].result));
// Claiming is type-scoped, so a worker may also pick up unrelated ready work. This helper claims until
// it holds the job the test is about, so a test never depends on what else happens to be queued.
const claimJob = async (workerName, workerClass, job, leaseSeconds = 300) => {
  for (let round = 0; round < 20; round += 1) {
    const result = await claim(workerName, workerClass, 25, leaseSeconds);
    const entry = result.claimed.find(candidate => candidate.job_id === job);
    if (entry) return entry;
    if (result.count === 0) break;
  }
  throw new Error(`job ${job} should be claimable by ${workerName}`);
};
const notClaimed = async (workerName, workerClass, job) => {
  const result = await claim(workerName, workerClass, 25);
  assert.equal(result.claimed.some(candidate => candidate.job_id === job), false,
    `job ${job} must not be claimable by ${workerName}`);
  return result;
};
const heartbeat = (job, workerName, seconds = 300) => asService(() => rows(
  'select tonde.job_heartbeat($1,$2,$3) as result', [job, workerName, seconds]).then(result => result[0].result));
const start = (job, workerName) => asService(() => rows(
  'select tonde.job_start($1,$2) as result', [job, workerName]).then(result => result[0].result));
const complete = (job, workerName, over = {}) => asService(() => rows(
  'select tonde.job_complete($1,$2,$3,$4,$5) as result',
  [job, workerName, JSON.stringify(over.result ?? {}), over.resultReference ?? null, over.note ?? ''])
  .then(result => result[0].result));
const fail = (job, workerName, over = {}) => asService(() => rows(
  'select tonde.job_fail($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [job, workerName, over.code ?? 'PROBE_FAILURE', over.message ?? 'The probe failed',
   over.classification ?? null, over.retryAfter ?? null, over.timeoutKind ?? null, over.note ?? ''])
  .then(result => result[0].result));
const cancelRequest = (job, user = A, reason = 'Probe cancellation') => asUser(user, () => rows(
  'select tonde.job_cancel_request($1,$2,$3) as result', [wa, job, reason]).then(result => result[0].result));
const acknowledge = (job, workerName, outcome, note = '') => asService(() => rows(
  'select tonde.job_cancel_acknowledge($1,$2,$3,$4) as result', [job, workerName, outcome, note])
  .then(result => result[0].result));
const recover = (limit = 100, grace = 0) => asService(() => rows(
  'select tonde.job_recover_expired_leases($1,$2) as result', [limit, grace]).then(result => result[0].result));
const scanTimeouts = (limit = 100) => asService(() => rows(
  'select tonde.job_timeout_scan($1) as result', [limit]).then(result => result[0].result));
const reconcile = (job, outcome, over = {}) => asService(() => rows(
  'select tonde.job_reconcile($1,$2,$3,$4,$5,$6) as result',
  [job, over.actor ?? 'probe-reconciler', outcome, over.note ?? 'Probe reconciliation',
   JSON.stringify(over.result ?? {}), over.resultReference ?? null]).then(result => result[0].result));
const requeue = (job, note = 'Probe requeue') => asService(() => rows(
  'select tonde.job_requeue($1,$2,$3) as result', [job, 'probe-operator', note]).then(result => result[0].result));
const release = (job, workerName, note = 'Probe release') => asService(() => rows(
  'select tonde.job_release($1,$2,$3) as result', [job, workerName, note]).then(result => result[0].result));
const status = (job, user = A) => asUser(user, () => rows(
  'select tonde.job_status($1,$2) as result', [wa, job]).then(result => result[0].result));
const listJobs = (user = A, over = {}) => asUser(user, () => rows(
  'select tonde.job_list($1,$2,$3,$4,$5) as result',
  [over.workspace ?? wa, over.limit ?? 50, over.state ?? null, over.jobType ?? null,
   over.includeTerminal ?? true]).then(result => result[0].result));
const state = async job => scalar('select status::text from tonde.jobs where id = $1', [job]);
const expireLease = job => db.query(
  "update tonde.jobs set lease_expires_at = now() - interval '5 minutes' where id = $1", [job]);
const backdateDeadline = job => db.query(
  "update tonde.jobs set deadline_at = now() - interval '5 minutes' where id = $1", [job]);
const requeueRow = job => db.query(
  "update tonde.jobs set status = 'queued', available_at = now(), reconciliation_required = false, lease_owner = null, lease_expires_at = null where id = $1", [job]);
const worker = label => `probe-${label}`;
const MEDIA = 'media_preprocessing';
const PUBLISH = 'publication_submission';
const RETENTION = 'retention_sweep';
const EXPORT = 'export';

const seedProduction = label => asEditor(async () => {
  const project = await scalar("insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id", [wa, `Probe ${label}`, A]);
  const production = await scalar("insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id", [wa, project, `Probe Production ${label}`, A]);
  const media = randomUUID();
  const checksum = `sha256:probe-${label}`;
  await db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes,upload_state,checksum)
    values($1,$2,'tonde-results',$3,'clip.mp4','video/mp4','video',2048,'uploaded',$4)`,
    [media, wa, `${wa}/${media}/clip.mp4`, checksum]);
  const result = await scalar('insert into tonde.results(workspace_id,production_id,media_id) values($1,$2,$3) returning id', [wa, production, media]);
  return { project, production, media, result, checksum };
});

// A real creator-authorized publication plus the durable submission job the outbox dispatcher would
// create for it. The publication itself is Prompt 10 fixture furniture; this suite is about the job.
const seedPublicationJob = async label => {
  const fixture = await seedProduction(label);
  const publication = await asEditor(() => rows(
    `select tonde.publication_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result`,
    [wa, fixture.production, fixture.result, 'probe_publisher', null, 'Probe channel', connection,
     'Probe title', 'Probe caption', 'public', null, JSON.stringify({})]).then(result => result[0].result));
  await asEditor(() => db.query('select tonde.publication_set_state($1,$2,$3,$4)',
    [wa, publication.publication_id, 'ready', 'Probe state change']));
  const authorization = await asEditor(() => rows(
    'select tonde.publication_authorize($1,$2,$3,$4) as result',
    [wa, publication.publication_id, 'authorize', 'Probe authorization']).then(result => result[0].result));
  const job = await enqueue({ jobType: PUBLISH, production: fixture.production, idempotencyKey: `probe-publish-${label}`,
    payload: { publication_id: publication.publication_id, authorization_id: authorization.authorization_id } });
  return { ...fixture, publication, authorization, job: job.job_id };
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
  for (const id of [A, B]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asEditor(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asOther(() => scalar('select tonde.bootstrap_workspace()'));
  // A verified publishing fixture, exactly like the Prompt 10 suite uses: test furniture that proves
  // the boundary, not a provider. Nothing here reaches a network.
  await asService(async () => {
    await db.query(`insert into tonde.integration_providers(key,name,category,auth_type,adapter_state,enabled,note)
      values('probe_publisher','Probe publisher','social_publishing','oauth','verified',true,'Test fixture only; no real adapter exists.')`);
    await db.query(`insert into tonde.integration_provider_capabilities(provider_key,capability_key,connection_required,required_scopes,enabled,note)
      values('probe_publisher','publish',true,$1,true,'Test fixture only.')`, [['publish_content']]);
    connection = await scalar(`insert into tonde.integration_connections(workspace_id,provider,connected_by,status,verified_at,requested_scopes,scopes,external_account_label)
      values($1,'probe_publisher',$2,'connected',now(),$3,$3,'Probe account') returning id`, [wa, A, ['publish_content']]);
  });
});

after(async () => { await db?.close(); });

test('the job state vocabulary, the type registry and every worker class are closed sets', async () => {
  const states = (await rows("select unnest(enum_range(null::tonde.job_state))::text as value")).map(row => row.value);
  assert.deepEqual(states, ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'retrying',
    'leased', 'waiting', 'cancel_requested', 'timed_out', 'dead_letter']);
  const classes = (await rows('select distinct worker_class from tonde.job_type_definitions order by 1'))
    .map(row => row.worker_class);
  assert.deepEqual(classes, ['ai', 'export', 'knowledge', 'maintenance', 'media', 'notification',
    'publishing', 'reconciliation']);
  // Every job type the check constraint accepts has a definition, and every definition is accepted by
  // the constraint: the vocabulary and the capability map cannot drift apart.
  const allowed = (await rows(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'tonde.jobs'::regclass and conname = 'jobs_job_type_check'`))[0].def;
  const listed = [...allowed.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
  const defined = (await rows('select job_type from tonde.job_type_definitions order by 1')).map(row => row.job_type);
  assert.deepEqual(listed, defined);
  assert.equal(defined.length, 20);
  // Every job row must name a defined type (the foreign key, not just the check).
  assert.ok(await scalar(`select exists (select 1 from pg_constraint where conrelid = 'tonde.jobs'::regclass
    and conname = 'jobs_job_type_defined' and contype = 'f')`));
  // An externally consequential type is always reconciled after an uncertain outcome.
  assert.equal(Number(await scalar(`select count(*) from tonde.job_type_definitions
    where externally_consequential and not requires_reconciliation`)), 0);
  assert.equal(Number(await scalar('select count(*) from tonde.job_type_definitions where max_priority < default_priority')), 0);
  // The 20 registry rows are the ones this packet claims, and each names a real worker class.
  assert.equal(Number(await scalar(`select count(*) from tonde.job_type_definitions d
    where d.enabled and d.worker_class in ('media','ai','export','publishing','reconciliation','notification','maintenance','knowledge')`)), 20);
});

test('enqueue is idempotent, priority-capped and validated, and refuses a client session', async () => {
  const request = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-enqueue-0001' });
  assert.equal(request.idempotent, false);
  assert.equal(request.status, 'queued');
  assert.equal(request.worker_class, 'media');
  assert.equal(request.priority, 50);
  assert.equal(await scalar('select worker_class from tonde.jobs where id = $1', [request.job_id]), 'media');
  assert.equal(await scalar('select operation_id is not null and payload_version = 1 from tonde.jobs where id = $1', [request.job_id]), true);
  // The same key returns the same durable request instead of queueing the work twice.
  const repeat = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-enqueue-0001' });
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.job_id, request.job_id);
  assert.equal(Number(await scalar(`select count(*) from tonde.jobs
    where workspace_id = $1 and job_type = $2 and idempotency_key = 'probe-enqueue-0001'`, [wa, MEDIA])), 1);
  // Priority is clamped by the type ceiling: a caller cannot promote its own work.
  const promoted = await enqueue({ jobType: MEDIA, priority: 100 });
  assert.equal(promoted.priority, 60);
  assert.equal(promoted.max_priority, 60);
  // A request is always made on behalf of a real identity.
  assert.equal(await scalar('select requested_by from tonde.jobs where id = $1', [promoted.job_id]), A);
  assert.equal((await failure(() => enqueue({ jobType: 'not_a_job_type' }))).code, '22023');
  assert.equal((await failure(() => enqueue({ jobType: MEDIA, payload: { oversized: 'x'.repeat(70000) } }))).code, '22023');
  assert.equal((await failure(() => enqueue({ jobType: MEDIA, idempotencyKey: 'short' }))).code, '22023');
  assert.equal((await failure(() => enqueue({ jobType: MEDIA, timeoutSeconds: 5 }))).code, '22023');
  assert.equal((await failure(() => enqueue({ jobType: MEDIA, workspace: randomUUID() }))).code, 'P0002');
  await db.query("update tonde.job_type_definitions set enabled = false where job_type = 'cloud_import'");
  assert.equal((await failure(() => enqueue({ jobType: 'cloud_import' }))).code, 'PT409');
  await db.query("update tonde.job_type_definitions set enabled = true where job_type = 'cloud_import'");
  // A client session can never enqueue: the function is not granted to authenticated at all.
  const denied = await failure(() => asEditor(() => db.query(
    "select tonde.job_enqueue($1,'media_preprocessing',null,'{}'::jsonb,null,null,null,null,null)", [wa])));
  assert.match(denied.message, /permission denied/i);
  // Enqueueing into another workspace is a trusted-server operation and names that workspace's own
  // identity, so a job can never be created in a workspace the caller did not name.
  const foreign = await enqueue({ workspace: wb, jobType: MEDIA, idempotencyKey: 'probe-enqueue-foreign1' });
  assert.equal(await scalar('select workspace_id from tonde.jobs where id = $1', [foreign.job_id]), wb);
  assert.equal(await scalar('select requested_by from tonde.jobs where id = $1', [foreign.job_id]), B);
  // A foreign Production is refused, and so is a parent job from another workspace.
  assert.equal((await failure(() => enqueue({ jobType: MEDIA, production: randomUUID() }))).code, 'P0002');
  assert.equal((await failure(() => enqueue({ jobType: MEDIA, parent: foreign.job_id }))).code, 'P0002');
});

test('claiming is one atomic statement: a leased job cannot be claimed, and the class must match', async () => {
  await register(worker('atomic'), 'media');
  const request = await enqueue({ jobType: MEDIA, priority: 55, idempotencyKey: 'probe-atomic-0001' });
  const entry = await claimJob(worker('atomic'), 'media', request.job_id);
  assert.equal(entry.retry_policy, 'safe_to_retry');
  assert.equal(entry.externally_consequential, false);
  assert.equal(entry.attempt, 1);
  assert.equal(entry.payload_version, 1);
  // The job is leased now; a second claim sees nothing even though it asks for work.
  await notClaimed(worker('atomic'), 'media', request.job_id);
  // Another worker of the same class also sees nothing: a lease is not stealable by claiming.
  await register(worker('atomic-two'), 'media');
  await notClaimed(worker('atomic-two'), 'media', request.job_id);
  // Claiming records the lease, the attempt and the deadline the type's timeout implies.
  const row = (await rows('select status::text, lease_owner, attempts, lease_acquired_at is not null as leased_at, deadline_at is not null as deadline, lease_expires_at is not null as expiring from tonde.jobs where id = $1', [request.job_id]))[0];
  assert.deepEqual(row, { status: 'leased', lease_owner: worker('atomic'), attempts: 1, leased_at: true, deadline: true, expiring: true });
  // A worker claims only its own class.
  await register(worker('exporter'), 'export');
  const exportJob = await enqueue({ jobType: EXPORT, idempotencyKey: 'probe-atomic-0002' });
  await claimJob(worker('exporter'), 'export', exportJob.job_id);
  await notClaimed(worker('atomic'), 'media', exportJob.job_id);
  // The priority order is honoured: a higher-priority ready job is claimed first.
  await register(worker('priority'), 'media');
  const low = await enqueue({ jobType: MEDIA, priority: 20, idempotencyKey: 'probe-atomic-0003' });
  const high = await enqueue({ jobType: MEDIA, priority: 58, idempotencyKey: 'probe-atomic-0004' });
  const ordered = await claim(worker('priority'), 'media', 25);
  const order = ordered.claimed.map(candidate => candidate.job_id).filter(id => id === low.job_id || id === high.job_id);
  assert.deepEqual(order, [high.job_id, low.job_id]);
  // An unregistered or mismatched worker cannot claim, and a draining worker stops claiming.
  assert.equal((await failure(() => claim('probe-ghost', 'media', 1))).code, '42501');
  assert.equal((await failure(() => claim(worker('priority'), 'export', 1))).code, '42501');
  await asService(() => db.query("select tonde.worker_heartbeat($1,'draining',300)", [worker('priority')]));
  assert.equal((await failure(() => claim(worker('priority'), 'media', 1))).code, 'PT409');
  await asService(() => db.query("select tonde.worker_heartbeat($1,'online',300)", [worker('priority')]));
  // Claim limits are bounded, and an event records the lease.
  assert.equal((await failure(() => claim(worker('priority'), 'media', 99))).code, '22023');
  assert.equal((await failure(() => claim(worker('priority'), 'media', 1, 5))).code, '22023');
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events
    where job_id = $1 and event_type = 'leased' and actor_kind = 'worker'`, [request.job_id])), 1);
});

test('only the lease owner may act, and an expired lease cannot be completed', async () => {
  await register(worker('owner'), 'media');
  await register(worker('thief'), 'media');
  const request = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-owner-0001' });
  await claimJob(worker('owner'), 'media', request.job_id);
  assert.equal((await failure(() => heartbeat(request.job_id, worker('thief')))).code, '42501');
  assert.equal((await failure(() => complete(request.job_id, worker('thief')))).code, '42501');
  assert.equal((await failure(() => fail(request.job_id, worker('thief')))).code, '42501');
  assert.equal((await failure(() => release(request.job_id, worker('thief')))).code, '42501');
  assert.equal((await start(request.job_id, worker('owner'))).status, 'running');
  // An expired lease is not silently extendable: recovery decides what happens next.
  await expireLease(request.job_id);
  const expired = await failure(() => heartbeat(request.job_id, worker('owner')));
  assert.equal(expired.code, 'PT409');
  assert.match(expired.message, /JOB_LEASE_EXPIRED/);
  assert.equal((await failure(() => complete(request.job_id, worker('owner')))).code, 'PT409');
  // The row is untouched by those refusals: still running, still leased, not completed.
  assert.deepEqual((await rows('select status::text, lease_owner, completed_at is null as open from tonde.jobs where id = $1', [request.job_id]))[0],
    { status: 'running', lease_owner: worker('owner'), open: true });
});

test('heartbeat extends the lease, reports a pending cancellation, and refuses a terminal job', async () => {
  await register(worker('beater'), 'media');
  const request = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-beater-0001' });
  await claimJob(worker('beater'), 'media', request.job_id, 60);
  const first = await heartbeat(request.job_id, worker('beater'), 60);
  const extended = await heartbeat(request.job_id, worker('beater'), 900);
  assert.equal(extended.owned, true);
  assert.ok(new Date(extended.lease_expires_at) > new Date(first.lease_expires_at));
  assert.equal(extended.cancel_requested, false);
  // A cancellation request is visible to the worker through the same call.
  await cancelRequest(request.job_id, A, 'Probe stop');
  const observed = await heartbeat(request.job_id, worker('beater'), 120);
  assert.equal(observed.cancel_requested, true);
  assert.equal(observed.cancel_reason, 'Probe stop');
  assert.match(observed.meaning, /stop if the operation can be stopped safely/);
  // Once cancelled, there is no lease left to heartbeat.
  await acknowledge(request.job_id, worker('beater'), 'cancelled');
  assert.equal(await state(request.job_id), 'cancelled');
  assert.equal((await failure(() => heartbeat(request.job_id, worker('beater')))).code, '42501');
  // A lease extension is also bounded.
  await register(worker('beater-two'), 'media');
  const other = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-beater-0002' });
  await claimJob(worker('beater-two'), 'media', other.job_id);
  assert.equal((await failure(() => heartbeat(other.job_id, worker('beater-two'), 5))).code, '22023');
});

test('completion is idempotent and a terminal job cannot be completed again', async () => {
  await register(worker('finisher'), 'export');
  const request = await enqueue({ jobType: EXPORT, idempotencyKey: 'probe-finisher-0001' });
  await claimJob(worker('finisher'), 'export', request.job_id);
  const first = await complete(request.job_id, worker('finisher'), { resultReference: 'export:probe-1', result: { files: 1 } });
  assert.equal(first.status, 'succeeded');
  assert.equal(first.idempotent, false);
  assert.equal(first.result_reference, 'export:probe-1');
  // A duplicate completion of a finished job changes nothing and says so.
  const duplicate = await complete(request.job_id, worker('finisher'), { resultReference: 'export:probe-2' });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.result_reference, 'export:probe-1');
  assert.equal(await scalar('select result_reference from tonde.jobs where id = $1', [request.job_id]), 'export:probe-1');
  assert.equal(Number(await scalar("select count(*) from tonde.job_events where job_id = $1 and event_type = 'completed'", [request.job_id])), 1);
  // A finished job cannot be cancelled or heartbeated again, and a duplicate failure report on a
  // finished job is recognised rather than applied.
  assert.equal((await fail(request.job_id, worker('finisher'))).idempotent, true);
  assert.equal((await failure(() => cancelRequest(request.job_id, A))).code, 'PT409');
  assert.equal((await failure(() => heartbeat(request.job_id, worker('finisher')))).code, '42501');
  // A queued job that was never leased cannot be completed out of thin air.
  const queued = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-finisher-0002' });
  assert.equal((await failure(() => complete(queued.job_id, worker('finisher')))).code, 'PT409');
  assert.equal(await state(queued.job_id), 'queued');
  assert.equal(await scalar("select status = 'succeeded' and progress = 100 and completed_at is not null and lease_owner is null and termination_reason = 'completed' from tonde.jobs where id = $1", [request.job_id]), true);
});

test('retry is classification-aware: never more optimistic than the type allows', async () => {
  await register(worker('retrier'), 'media');
  // A clean failure of a safe type is scheduled, with persisted backoff.
  const request = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-retry-0001' });
  await claimJob(worker('retrier'), 'media', request.job_id);
  const scheduled = await fail(request.job_id, worker('retrier'), { classification: 'safe_to_retry' });
  assert.equal(scheduled.status, 'retrying');
  assert.equal(scheduled.effective_classification, 'safe_to_retry');
  assert.equal(scheduled.reason, null);
  assert.ok(Number(scheduled.backoff_seconds) >= 30);
  assert.equal(await scalar("select status = 'retrying' and available_at > now() and failure_classification = 'safe_to_retry' and lease_owner is null from tonde.jobs where id = $1", [request.job_id]), true);
  // A worker that reports an uncertain outcome escalates the treatment even for a safe type.
  await requeueRow(request.job_id);
  await claimJob(worker('retrier'), 'media', request.job_id);
  const uncertain = await fail(request.job_id, worker('retrier'), { classification: 'requires_reconciliation' });
  assert.equal(uncertain.status, 'waiting');
  assert.equal(uncertain.reconciliation_required, true);
  assert.equal(await scalar("select reconciliation_required and status = 'waiting' from tonde.jobs where id = $1", [request.job_id]), true);
  // The type's own policy is a floor: a billable publishing submission cannot be downgraded to a plain
  // retry by a worker claiming safe_to_retry.
  await register(worker('publisher'), 'publishing');
  const publication = await seedPublicationJob('retry-policy');
  await claimJob(worker('publisher'), 'publishing', publication.job);
  const downgraded = await fail(publication.job, worker('publisher'), { classification: 'safe_to_retry' });
  assert.equal(downgraded.job_type_policy, 'requires_reconciliation');
  assert.equal(downgraded.effective_classification, 'requires_reconciliation');
  assert.equal(downgraded.status, 'waiting');
  // A provider Retry-After is honoured rather than overwritten by the backoff (a fresh job, so the
  // attempt budget is untouched by the earlier steps).
  const retryAfterJob = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-retry-0003' });
  await claimJob(worker('retrier'), 'media', retryAfterJob.job_id);
  const withRetryAfter = await fail(retryAfterJob.job_id, worker('retrier'), { classification: 'safe_to_retry', retryAfter: 900 });
  assert.equal(withRetryAfter.status, 'retrying');
  assert.ok(Number(withRetryAfter.backoff_seconds) >= 900);
  assert.equal(await scalar("select available_at > now() + interval '14 minutes' from tonde.jobs where id = $1", [retryAfterJob.job_id]), true);
  // An unknown classification is refused outright rather than guessed at.
  await requeueRow(request.job_id);
  await claimJob(worker('retrier'), 'media', request.job_id);
  assert.equal((await failure(() => fail(request.job_id, worker('retrier'), { classification: 'probably_fine' }))).code, '22023');
  // A reported failure must be attached to a lease that is actually held.
  assert.equal((await failure(() => fail(request.job_id, worker('thief')))).code, '42501');
  const unleased = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-retry-0002' });
  assert.equal((await failure(() => fail(unleased.job_id, worker('retrier')))).code, 'PT409');
});

test('retry exhaustion preserves the work in the dead letter with its cause', async () => {
  await register(worker('exhauster'), 'media');
  const request = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-exhaust-0001' });
  const maxAttempts = Number(await scalar('select max_attempts from tonde.jobs where id = $1', [request.job_id]));
  assert.equal(maxAttempts, 3);
  let last;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await requeueRow(request.job_id);
    await claimJob(worker('exhauster'), 'media', request.job_id);
    last = await fail(request.job_id, worker('exhauster'), { code: 'PROBE_UNAVAILABLE', message: `attempt ${attempt + 1} failed`, classification: 'safe_to_retry' });
  }
  assert.equal(last.status, 'dead_letter');
  assert.equal(last.reason, 'retry_exhausted');
  const row = (await rows(`select status::text, attempts, max_attempts, dead_lettered_at is not null as stamped,
    dead_letter_reason, error_code, error_message, reconciliation_required from tonde.jobs where id = $1`, [request.job_id]))[0];
  assert.deepEqual(row, { status: 'dead_letter', attempts: 3, max_attempts: 3, stamped: true,
    dead_letter_reason: 'retry_exhausted', error_code: 'PROBE_UNAVAILABLE',
    error_message: `attempt ${maxAttempts} failed`, reconciliation_required: false });
  // Nothing discarded it silently: the history names every attempt and the final cause.
  const events = (await rows('select event_type from tonde.job_events where job_id = $1 order by id', [request.job_id])).map(row => row.event_type);
  assert.equal(events.filter(type => type === 'retry_scheduled').length, maxAttempts - 1);
  assert.equal(events[events.length - 1], 'dead_lettered');
  // A duplicate failure report on a finished job is harmless.
  assert.equal((await fail(request.job_id, worker('exhauster'))).idempotent, true);
  // A dead letter can be requeued by an operator, which preserves its history and counts the requeue.
  const requeued = await requeue(request.job_id, 'Probe operator requeue');
  assert.equal(requeued.status, 'queued');
  assert.equal(requeued.attempts, 0);
  assert.equal(requeued.requeue_count, 1);
  assert.equal(await scalar("select dead_lettered_at is null and dead_letter_reason is null and status = 'queued' from tonde.jobs where id = $1", [request.job_id]), true);
  assert.equal((await failure(() => requeue(request.job_id))).code, 'PT409');
  assert.equal(Number(await scalar("select count(*) from tonde.job_events where job_id = $1 and event_type = 'requeued'", [request.job_id])), 1);
});

test('a worker timeout and a provider timeout are named, not blurred into a generic failure', async () => {
  await register(worker('timeout-worker'), 'publishing');
  await register(worker('final-worker'), 'maintenance');
  const publication = await seedPublicationJob('timeouts');
  await claimJob(worker('timeout-worker'), 'publishing', publication.job);
  // A provider timeout on an external operation is an uncertain outcome: it reconciles first.
  const providerTimeout = await fail(publication.job, worker('timeout-worker'), {
    code: 'PROVIDER_TIMEOUT', message: 'The destination did not answer in time',
    classification: 'requires_reconciliation', timeoutKind: 'provider_timeout' });
  assert.equal(providerTimeout.status, 'waiting');
  assert.equal(providerTimeout.reconciliation_required, true);
  assert.equal(providerTimeout.timeout_kind, 'provider_timeout');
  assert.equal(await scalar("select reconciliation_required and failure_classification = 'requires_reconciliation' from tonde.jobs where id = $1", [publication.job]), true);
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events where job_id = $1 and event_type = 'reconciliation_required'`, [publication.job])), 1);
  // A job awaiting reconciliation cannot be claimed: nothing repeats an uncertain external effect.
  await db.query('update tonde.jobs set available_at = now() where id = $1', [publication.job]);
  await notClaimed(worker('timeout-worker'), 'publishing', publication.job);
  // Reconciliation establishes the real state and then decides: here it repeats the submission.
  const reconciled = await reconcile(publication.job, 'requeue', { note: 'The destination has no copy yet' });
  assert.equal(reconciled.status, 'retrying');
  assert.equal(await scalar("select reconciliation_required = false and reconciled_at is not null and status = 'retrying' from tonde.jobs where id = $1", [publication.job]), true);
  // A worker timeout on internal work with no attempts left is a named timeout, not a vague failure.
  const sweep = await enqueue({ jobType: RETENTION, idempotencyKey: 'probe-timeout-0001' });
  await db.query('update tonde.jobs set max_attempts = 1 where id = $1', [sweep.job_id]);
  await claimJob(worker('final-worker'), 'maintenance', sweep.job_id);
  const workerTimeout = await fail(sweep.job_id, worker('final-worker'), {
    code: 'WORKER_TIMEOUT', message: 'The worker stopped responding', classification: 'safe_to_retry',
    timeoutKind: 'worker_timeout' });
  assert.equal(workerTimeout.status, 'dead_letter');
  assert.equal(workerTimeout.reason, 'worker_timeout');
  assert.equal(await scalar("select timed_out_at is not null and termination_reason = 'worker_timeout' from tonde.jobs where id = $1", [sweep.job_id]), true);
  // A timeout kind is a closed vocabulary.
  const other = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-timeout-0002' });
  await register(worker('timeout-media'), 'media');
  await claimJob(worker('timeout-media'), 'media', other.job_id);
  assert.equal((await failure(() => fail(other.job_id, worker('timeout-media'), { timeoutKind: 'the_network' }))).code, '22023');
});

test('cancellation is honest: a remote operation that cannot be stopped is never called cancelled', async () => {
  await register(worker('cancel-worker'), 'publishing');
  // A queued job is cancelled outright: nothing ran.
  const queued = await enqueue({ jobType: RETENTION, idempotencyKey: 'probe-cancel-0001' });
  const cancelled = await cancelRequest(queued.job_id);
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.meaning, /nothing ran/);
  assert.equal(await scalar("select status = 'cancelled' and cancelled_at is not null and termination_reason = 'user_cancelled' and lease_owner is null and completed_at is not null from tonde.jobs where id = $1", [queued.job_id]), true);
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events where job_id = $1 and event_type = 'cancelled' and actor_kind = 'user'`, [queued.job_id])), 1);
  // The cancellation is attributed to the creator who asked for it.
  assert.equal(await scalar('select cancel_requested_by from tonde.jobs where id = $1', [queued.job_id]), A);
  // A running external job cannot be cancelled after the destination accepted it, and TONDE says so.
  const publication = await seedPublicationJob('cancellation');
  await claimJob(worker('cancel-worker'), 'publishing', publication.job);
  await start(publication.job, worker('cancel-worker'));
  const requested = await cancelRequest(publication.job, A, 'Creator changed their mind');
  assert.equal(requested.status, 'cancel_requested');
  assert.equal(requested.irreversible, true);
  assert.match(requested.meaning, /may already have taken effect externally/);
  const refused = await acknowledge(publication.job, worker('cancel-worker'), 'cannot_cancel_remote', 'The destination accepted the post');
  assert.equal(refused.status, 'running');
  assert.equal(refused.outcome, 'cannot_cancel_remote');
  assert.match(refused.meaning, /cannot be cancelled/);
  assert.equal(await scalar('select cancel_requested_at is not null from tonde.jobs where id = $1', [publication.job]), true);
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events where job_id = $1 and event_type = 'cancel_not_possible_remote'`, [publication.job])), 1);
  // The request stays on the record as evidence, and the real outcome is recorded afterwards.
  const completed = await complete(publication.job, worker('cancel-worker'), { resultReference: 'publication:probe-1' });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.cancel_race, 'completion_after_cancel_request');
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events where job_id = $1 and event_type = 'completed'`, [publication.job])), 1);
  // A worker can also genuinely stop, and then the job is cancelled.
  const stopped = await seedPublicationJob('cancellation-stopped');
  await claimJob(worker('cancel-worker'), 'publishing', stopped.job);
  await start(stopped.job, worker('cancel-worker'));
  await cancelRequest(stopped.job, A, 'Stop before sending');
  const acknowledged = await acknowledge(stopped.job, worker('cancel-worker'), 'cancelled', 'Nothing was sent');
  assert.equal(acknowledged.status, 'cancelled');
  assert.equal(await scalar("select termination_reason = 'user_cancelled' and lease_owner is null from tonde.jobs where id = $1", [stopped.job]), true);
  // A non-member cannot cancel anything, and the refusal precedes the lookup.
  const foreign = await failure(() => asOther(() => db.query('select tonde.job_cancel_request($1,$2,$3)', [wa, queued.job_id, 'probe'])));
  assert.equal(foreign.code, '42501');
  assert.match(foreign.message, /Workspace access denied/);
  // A member of their own workspace is authorized, so a genuinely missing job answers "not found"
  // rather than a denial - the same distinction Prompt 10's authorization-order sweep pins.
  const missing = await failure(() => asOther(() => db.query('select tonde.job_cancel_request($1,$2,$3)', [wb, randomUUID(), 'probe'])));
  assert.equal(missing.code, 'P0002');
  // A finished job cannot be cancelled, and acknowledging without a request is refused.
  assert.equal((await failure(() => cancelRequest(queued.job_id))).code, 'PT409');
  const quiet = await seedPublicationJob('cancellation-quiet');
  await claimJob(worker('cancel-worker'), 'publishing', quiet.job);
  assert.equal((await failure(() => acknowledge(quiet.job, worker('cancel-worker'), 'cancelled'))).code, 'PT409');
  assert.equal((await failure(() => acknowledge(quiet.job, worker('cancel-worker'), 'maybe'))).code, '22023');
});

test('an expired lease is recovered without blind repetition, and safe work returns to the queue', async () => {
  await register(worker('crashed'), 'media');
  await register(worker('crashed-pub'), 'publishing');
  // Safe internal work returns to the queue with a persisted backoff.
  const safeJob = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-recover-0001' });
  await claimJob(worker('crashed'), 'media', safeJob.job_id);
  await start(safeJob.job_id, worker('crashed'));
  await expireLease(safeJob.job_id);
  const recovered = await recover();
  assert.ok(recovered.recovered >= 1);
  assert.ok(recovered.by_state.retrying >= 1);
  assert.equal(await scalar("select status = 'retrying' and lease_owner is null and lease_expires_at is null and available_at > now() from tonde.jobs where id = $1", [safeJob.job_id]), true);
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events where job_id = $1 and event_type = 'lease_expired'`, [safeJob.job_id])), 1);
  // Externally consequential work does not run again until reconciliation says what happened.
  const publication = await seedPublicationJob('recovery');
  await claimJob(worker('crashed-pub'), 'publishing', publication.job);
  await start(publication.job, worker('crashed-pub'));
  await expireLease(publication.job);
  await recover();
  assert.equal(await scalar("select status = 'waiting' and reconciliation_required and lease_owner is null from tonde.jobs where id = $1", [publication.job]), true);
  await db.query('update tonde.jobs set available_at = now() where id = $1', [publication.job]);
  await notClaimed(worker('crashed-pub'), 'publishing', publication.job);
  // Reconciliation that finds nothing was sent may then repeat the work.
  const requeued = await reconcile(publication.job, 'requeue', { note: 'Nothing was sent' });
  assert.equal(requeued.status, 'retrying');
  // A recovery that exhausts attempts dead-letters rather than looping forever.
  const doomed = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-recover-0009' });
  await db.query('update tonde.jobs set max_attempts = 1 where id = $1', [doomed.job_id]);
  await claimJob(worker('crashed'), 'media', doomed.job_id);
  await expireLease(doomed.job_id);
  await recover();
  assert.equal(await scalar("select status = 'dead_letter' and dead_letter_reason = 'lease_expired' and dead_lettered_at is not null from tonde.jobs where id = $1", [doomed.job_id]), true);
  await db.query('update tonde.jobs set max_attempts = 1 where id = $1', [safeJob.job_id]).catch(() => null);
  await db.query("update tonde.jobs set attempts = 0, max_attempts = 1, status = 'queued', available_at = now() where id = $1", [safeJob.job_id]);
  await claimJob(worker('crashed'), 'media', safeJob.job_id);
  await expireLease(safeJob.job_id);
  await recover();
  assert.equal(await scalar("select status = 'dead_letter' and dead_letter_reason = 'lease_expired' and dead_lettered_at is not null from tonde.jobs where id = $1", [safeJob.job_id]), true);
  // The batch is bounded and reports what it did.
  assert.equal((await failure(() => recover(10000))).code, '22023');
  assert.equal((await recover(1)).recovered <= 1, true);
});

test('the deadline scan distinguishes an expired deadline from a crash and from a cancellation', async () => {
  await register(worker('deadline'), 'media');
  await register(worker('deadline-pub'), 'publishing');
  // Work that never started and whose deadline passed is simply timed out.
  const queued = await enqueue({ jobType: RETENTION, idempotencyKey: 'probe-deadline-0001' });
  await backdateDeadline(queued.job_id);
  const scanned = await scanTimeouts();
  assert.ok(scanned.expired >= 1);
  assert.equal(await scalar("select status = 'timed_out' and timed_out_at is not null and termination_reason = 'deadline_exceeded' and completed_at is not null from tonde.jobs where id = $1", [queued.job_id]), true);
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events where job_id = $1 and event_type = 'timed_out'`, [queued.job_id])), 1);
  // Externally consequential work whose deadline passed in flight waits for reconciliation instead.
  const publication = await seedPublicationJob('deadline');
  await claimJob(worker('deadline-pub'), 'publishing', publication.job);
  await start(publication.job, worker('deadline-pub'));
  await backdateDeadline(publication.job);
  await scanTimeouts();
  assert.equal(await scalar("select status = 'waiting' and reconciliation_required and termination_reason = 'deadline_exceeded' from tonde.jobs where id = $1", [publication.job]), true);
  // A job whose cancellation arrived first is cancelled, not timed out.
  const cancelled = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-deadline-0002' });
  await backdateDeadline(cancelled.job_id);
  await cancelRequest(cancelled.job_id);
  await scanTimeouts();
  assert.equal(await state(cancelled.job_id), 'cancelled');
  // A job with no deadline and no live attempt is never swept.
  const open = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-deadline-0003' });
  await db.query('update tonde.jobs set deadline_at = null where id = $1', [open.job_id]);
  await scanTimeouts();
  assert.equal(await state(open.job_id), 'queued');
  // An attempt that ran past its own per-attempt bound is a worker timeout, not a job deadline.
  await register(worker('attempt-deadline'), 'media');
  const overdue = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-deadline-0004' });
  await claimJob(worker('attempt-deadline'), 'media', overdue.job_id);
  await db.query("update tonde.jobs set attempt_deadline_at = now() - interval '1 minute' where id = $1", [overdue.job_id]);
  const attemptScan = await scanTimeouts();
  assert.ok(attemptScan.attempt_expired >= 1);
  assert.equal(await scalar("select status = 'retrying' and failure_classification is null from tonde.jobs where id = $1", [overdue.job_id]), true);
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events where job_id = $1 and event_type = 'retry_scheduled'
    and detail->>'expired_clock' = 'worker_timeout'`, [overdue.job_id])), 1);
  // With no attempts left the same clock produces a named timeout instead of another retry.
  await db.query("update tonde.jobs set attempts = max_attempts, status = 'running', lease_owner = 'probe-attempt-deadline', lease_expires_at = now() + interval '5 minutes', attempt_deadline_at = now() - interval '1 minute' where id = $1", [overdue.job_id]);
  await asService(() => db.query("select tonde.worker_register('probe-attempt-deadline','media','smoke','11.0.0','{}')"));
  await scanTimeouts();
  assert.equal(await scalar("select status = 'timed_out' and termination_reason = 'worker_timeout' and timed_out_at is not null from tonde.jobs where id = $1", [overdue.job_id]), true);
  assert.equal((await failure(() => scanTimeouts(10000))).code, '22023');
});

test('a graceful shutdown hands leases back with an honest next state', async () => {
  await register(worker('shutdown'), 'export');
  const first = await enqueue({ jobType: EXPORT, idempotencyKey: 'probe-shutdown-0001' });
  const second = await enqueue({ jobType: EXPORT, idempotencyKey: 'probe-shutdown-0002' });
  // One claim takes both: the point is that a worker may hold several leases at once.
  const batch = await claim(worker('shutdown'), 'export', 25);
  const held = batch.claimed.map(entry => entry.job_id);
  assert.ok(held.includes(first.job_id) && held.includes(second.job_id));
  assert.equal(await scalar('select count(*) from tonde.jobs where id = any($1::uuid[]) and lease_owner = $2',
    [[first.job_id, second.job_id], worker('shutdown')]), 2);
  const released = await asService(() => rows(
    'select tonde.worker_release_leases($1,$2) as result', [worker('shutdown'), 'Probe shutdown'])
    .then(result => result[0].result));
  assert.ok(released.released_count >= 2);
  const targets = released.released.filter(entry => [first.job_id, second.job_id].includes(entry.job_id));
  assert.equal(targets.length, 2);
  assert.equal(targets.every(entry => entry.status === 'retrying'), true);
  assert.equal(Number(await scalar('select count(*) from tonde.jobs where lease_owner = $1', [worker('shutdown')])), 0);
  assert.equal(Number(await scalar(`select count(*) from tonde.jobs where id = any($1::uuid[]) and status = 'retrying' and available_at > now()`,
    [[first.job_id, second.job_id]])), 2);
  assert.equal(Number(await scalar(`select count(*) from tonde.job_events where job_id = $1 and event_type = 'released'`, [first.job_id])), 1);
  // A single release does the same for one job and refuses an unleased one.
  await requeueRow(first.job_id);
  await claimJob(worker('shutdown'), 'export', first.job_id);
  const single = await release(first.job_id, worker('shutdown'), 'Probe single release');
  assert.equal(single.status, 'retrying');
  assert.equal((await failure(() => release(second.job_id, worker('shutdown')))).code, '42501');
  // A draining worker reports what it still holds so nothing is abandoned silently.
  const drain = await asService(() => rows(
    "select tonde.worker_heartbeat($1,'draining',300) as result", [worker('shutdown')])
    .then(result => result[0].result));
  assert.equal(drain.status, 'draining');
  assert.equal(drain.active_lease_count, 0);
  assert.equal(drain.shutdown_advised, true);
  const offline = await asService(() => rows(
    "select tonde.worker_heartbeat($1,'offline',300) as result", [worker('shutdown')])
    .then(result => result[0].result));
  assert.equal(offline.status, 'offline');
  assert.equal(await scalar('select shutdown_completed_at is not null from tonde.workers where worker_id = $1', [worker('shutdown')]), true);
  assert.equal((await failure(() => asService(() => db.query(
    "select tonde.worker_heartbeat('probe-never-registered','online',300)")))).code, '42501');
  assert.equal((await failure(() => asService(() => db.query(
    "select tonde.worker_register('probe-bad-class','not_a_class','i','v','{}')")))).code, '22023');
  // Re-registering a worker brings it back online without losing its record.
  const back = await register(worker('shutdown'), 'export');
  assert.equal(back.status, 'online');
});

test('the outbox claims, delivers, skips, fails and reprocesses idempotently', async () => {
  await register(worker('outbox'), 'maintenance');
  const first = await asService(() => rows(
    "select tonde.outbox_enqueue($1,'probe.event','probe',null,'probe-outbox-0001',$2) as result",
    [wa, JSON.stringify({ hello: 'world' })]).then(result => result[0].result));
  assert.equal(first.idempotent, false);
  assert.equal(first.state, 'pending');
  const repeat = await asService(() => rows(
    "select tonde.outbox_enqueue($1,'probe.event','probe',null,'probe-outbox-0001',$2) as result",
    [wa, JSON.stringify({ hello: 'again' })]).then(result => result[0].result));
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.event_id, first.event_id);
  assert.equal(Number(await scalar("select count(*) from tonde.outbox_events where workspace_id = $1 and dedupe_key = 'probe-outbox-0001'", [wa])), 1);
  // Claiming is atomic and stamps the lease and the attempt.
  const claimOne = await asService(() => rows(
    'select tonde.outbox_claim($1,100,120) as result', [worker('outbox-worker')]).then(result => result[0].result));
  const event = claimOne.claimed.find(entry => entry.event_id === first.event_id);
  assert.ok(event);
  assert.equal(event.attempt, 1);
  assert.deepEqual(event.payload, { hello: 'world' });
  // Only the lease owner may deliver, and delivery names the durable work it created.
  const foreign = await failure(() => asService(() => db.query(
    'select tonde.outbox_deliver($1,$2,null)', [first.event_id, worker('outbox-other')])));
  assert.equal(foreign.code, '42501');
  const job = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-outbox-job-0001' });
  const delivered = await asService(() => rows(
    'select tonde.outbox_deliver($1,$2,$3) as result', [first.event_id, worker('outbox-worker'), job.job_id])
    .then(result => result[0].result));
  assert.equal(delivered.state, 'delivered');
  assert.equal(delivered.job_id, job.job_id);
  assert.equal(await scalar('select delivered_at is not null and processed_at is not null and lease_owner is null from tonde.outbox_events where id = $1', [first.event_id]), true);
  // Repeated delivery is harmless.
  const again = await asService(() => rows(
    'select tonde.outbox_deliver($1,$2,null) as result', [first.event_id, worker('outbox-worker')])
    .then(result => result[0].result));
  assert.equal(again.idempotent, true);
  assert.equal(again.job_id, job.job_id);
  // A job from another workspace cannot be named as the delivered work.
  const foreignJob = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-outbox-job-0002' });
  const crossWorkspace = await asService(() => rows(
    "select tonde.outbox_enqueue($1,'probe.event','probe',null,'probe-outbox-0009','{}'::jsonb) as result", [wb])
    .then(result => result[0].result));
  await asService(() => db.query('select tonde.outbox_claim($1,100,120)', [worker('outbox-worker')]));
  const mismatch = await failure(() => asService(() => db.query(
    'select tonde.outbox_deliver($1,$2,$3)', [crossWorkspace.event_id, worker('outbox-worker'), foreignJob.job_id])));
  assert.equal(mismatch.code, '22023');
  // A skipped event records why it needed no work.
  const skipped = await asService(() => rows(
    "select tonde.outbox_enqueue($1,'probe.skip','probe',null,'probe-outbox-0002','{}'::jsonb) as result",
    [wa]).then(result => result[0].result));
  await asService(() => db.query('select tonde.outbox_claim($1,100,120)', [worker('outbox-worker')]));
  const skippedResult = await asService(() => rows(
    "select tonde.outbox_skip($1,$2,'PROVIDER_NOT_IMPLEMENTED','No adapter exists') as result",
    [skipped.event_id, worker('outbox-worker')]).then(result => result[0].result));
  assert.equal(skippedResult.state, 'skipped');
  assert.equal(skippedResult.reason_code, 'PROVIDER_NOT_IMPLEMENTED');
  assert.equal((await asService(() => rows("select tonde.outbox_skip($1,$2,'X','y') as result",
    [skipped.event_id, worker('outbox-worker')]).then(result => result[0].result))).idempotent, true);
  // A retriable failure stays pending; a non-retriable one is preserved as failed and can be reprocessed.
  const failing = await asService(() => rows(
    "select tonde.outbox_enqueue($1,'probe.fail','probe',null,'probe-outbox-0003','{}'::jsonb) as result",
    [wa]).then(result => result[0].result));
  await asService(() => db.query('select tonde.outbox_claim($1,100,120)', [worker('outbox-worker')]));
  const retriable = await asService(() => rows(
    "select tonde.outbox_fail($1,$2,'TRANSIENT','Try again later',true) as result",
    [failing.event_id, worker('outbox-worker')]).then(result => result[0].result));
  assert.equal(retriable.state, 'pending');
  assert.ok(new Date(retriable.available_at) > new Date());
  await db.query('update tonde.outbox_events set available_at = now() where id = $1', [failing.event_id]);
  await asService(() => db.query('select tonde.outbox_claim($1,100,120)', [worker('outbox-worker')]));
  const permanent = await asService(() => rows(
    "select tonde.outbox_fail($1,$2,'PERMANENT','This will not work',false) as result",
    [failing.event_id, worker('outbox-worker')]).then(result => result[0].result));
  assert.equal(permanent.state, 'failed');
  assert.equal((await failure(() => asService(() => db.query(
    'select tonde.outbox_deliver($1,$2,null)', [failing.event_id, worker('outbox-worker')])))).code, '42501');
  const reprocessed = await asService(() => rows(
    'select tonde.outbox_reprocess($1,$2,$3) as result', [failing.event_id, 'probe-operator', 'Probe reprocess'])
    .then(result => result[0].result));
  assert.equal(reprocessed.state, 'pending');
  assert.equal(reprocessed.attempts, 0);
  assert.equal((await failure(() => asService(() => db.query(
    "select tonde.outbox_reprocess($1,'probe-operator','x')", [first.event_id])))).code, 'PT409');
  // An outbox event that holds a lease is never claimed by a second worker.
  await asService(() => db.query('select tonde.outbox_claim($1,100,120)', [worker('outbox-worker')]));
  await register(worker('outbox-two'), 'maintenance');
  const other = await asService(() => rows(
    'select tonde.outbox_claim($1,100,120) as result', [worker('outbox-two-worker')]).then(result => result[0].result));
  assert.equal(other.claimed.every(entry => entry.event_id !== failing.event_id), true);
  // Bounds and validation.
  assert.equal((await failure(() => asService(() => db.query(
    "select tonde.outbox_claim('probe-outbox-worker',0,120)")))).code, '22023');
  assert.equal((await failure(() => asService(() => db.query(
    "select tonde.outbox_enqueue($1,'probe.event','probe',null,'short','{}'::jsonb)", [wa])))).code, '22023');
});

test('a client session can read job state but can never mutate, claim or enqueue', async () => {
  const request = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-client-0001' });
  const view = await status(request.job_id, A);
  assert.equal(view.job_type, MEDIA);
  assert.equal(view.status, 'queued');
  assert.equal(view.cancellable, true);
  assert.equal(view.lease_owner, null);
  assert.deepEqual(view.payload, {});
  assert.equal(view.events[0].event_type, 'enqueued');
  assert.equal(view.externally_consequential, false);
  const listed = await listJobs(A, { jobType: MEDIA });
  assert.equal(listed.jobs.some(entry => entry.job_id === request.job_id), true);
  assert.equal((await listJobs(A, { state: 'queued' })).jobs.every(entry => entry.status === 'queued'), true);
  assert.equal((await listJobs(A, { includeTerminal: false })).jobs.every(entry => entry.status !== 'succeeded'), true);
  const summary = await asEditor(() => rows('select tonde.job_workspace_summary($1) as result', [wa]).then(result => result[0].result));
  assert.ok(Number(summary.jobs_by_state.queued) >= 1);
  assert.ok(Number(summary.dead_letters) >= 1);
  // Another workspace cannot even ask: every read is workspace-scoped before anything is looked up.
  assert.equal((await failure(() => status(request.job_id, B))).code, '42501');
  assert.equal((await failure(() => listJobs(B))).code, '42501');
  assert.equal((await failure(() => asOther(() => db.query('select tonde.job_workspace_summary($1)', [wa])))).code, '42501');
  // A member of their own workspace is authorized, and the job simply is not there: not found, not a
  // denial, and no A data leaks.
  assert.equal((await failure(() => asOther(() => db.query('select tonde.job_status($1,$2)', [wb, request.job_id])))).code, 'P0002');
  // B's own workspace is readable, and holds none of A's jobs.
  const ownList = await asOther(() => rows('select tonde.job_list($1,50,null,null,true) as result', [wb]).then(result => result[0].result));
  assert.equal(ownList.jobs.some(entry => entry.job_id === request.job_id), false);
  // Every privileged operation is unavailable to a client session.
  for (const sql of [
    "select tonde.job_claim('probe-client','media',1,300)",
    "select tonde.job_complete($1,'probe-client','{}'::jsonb,null,'')",
    "select tonde.job_fail($1,'probe-client','X','x',null,null,null,'')",
    "select tonde.job_recover_expired_leases(10,0)",
    "select tonde.job_timeout_scan(10)",
    "select tonde.job_reconcile($1,'probe-client','requeue','x','{}'::jsonb,null)",
    "select tonde.job_requeue($1,'probe-client','x')",
    "select tonde.job_release($1,'probe-client','x')",
    "select tonde.worker_register('probe-client','media','i','v','{}')",
    "select tonde.worker_heartbeat('probe-client','online',300)",
    "select tonde.outbox_claim('probe-client',5,120)",
    "select tonde.outbox_enqueue($1,'probe.event','probe',null,'probe-client-key1','{}'::jsonb)",
    "select tonde.job_metrics()",
  ]) {
    const denied = await failure(() => asEditor(() => db.query(sql, sql.includes('$1') ? [request.job_id] : [])));
    assert.match(denied.message, /permission denied/i, sql);
  }
  // Direct table writes are refused too: a browser cannot move a job by hand.
  const directWrite = await failure(() => asEditor(() => db.query(
    "update tonde.jobs set status = 'succeeded' where id = $1", [request.job_id])));
  assert.equal(directWrite.code, '42501', directWrite.message);
  assert.equal(await state(request.job_id), 'queued');
  const directInsert = await failure(() => asEditor(() => db.query(
    "insert into tonde.jobs(workspace_id,job_type,requested_by) values($1,'media_preprocessing',$2)", [wa, A])));
  assert.match(directInsert.message, /permission denied/i);
  // The outbox and the worker registry are server-only: a client session holds no privilege on them at
  // all, so it can neither read nor write one.
  assert.match((await failure(() => asEditor(() => db.query('select count(*) from tonde.outbox_events')))).message, /permission denied/i);
  assert.match((await failure(() => asEditor(() => db.query('select count(*) from tonde.workers')))).message, /permission denied/i);
  assert.match((await failure(() => asEditor(() => db.query(
    "insert into tonde.outbox_events(workspace_id,event_type,resource_kind,dedupe_key) values($1,'probe','probe','probe-client-0001')",
    [wa])))).message, /permission denied/i);
  // Job events are append-only even for the trusted server.
  assert.equal((await failure(() => asService(() => db.query(
    'delete from tonde.job_events where job_id = $1', [request.job_id])))).code, '23514');
  assert.equal((await failure(() => asService(() => db.query(
    "update tonde.job_events set event_type = 'completed' where job_id = $1", [request.job_id])))).code, '23514');
});

test('a state move outside the transition matrix is refused by the database', async () => {
  const matrix = (await db.query(`select tonde_private.job_transition_allowed('queued','succeeded') as illegal,
    tonde_private.job_transition_allowed('queued','leased') as legal,
    tonde_private.job_transition_allowed('succeeded','queued') as terminal,
    tonde_private.job_transition_allowed('dead_letter','queued') as requeueable,
    tonde_private.job_transition_allowed('waiting','succeeded') as reconciled,
    tonde_private.job_transition_allowed(null,'queued') as fresh`)).rows[0];
  assert.deepEqual(matrix, { illegal: false, legal: true, terminal: false, requeueable: true, reconciled: true, fresh: false });
  // The matrix is not merely documentation: an illegal move is refused when attempted.
  const request = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-matrix-0001' });
  await db.query("update tonde.jobs set status = 'cancelled', completed_at = now() where id = $1", [request.job_id]);
  assert.equal((await failure(() => requeue(request.job_id))).code, 'PT409');
  assert.equal((await failure(() => reconcile(request.job_id, 'complete'))).code, 'PT409');
  const waiting = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-matrix-0002' });
  assert.equal((await failure(() => reconcile(waiting.job_id, 'complete'))).code, 'PT409');
  assert.equal((await failure(() => reconcile(waiting.job_id, 'maybe'))).code, '22023');
  // The database refuses a directly written illegal state for a leased job too.
  // The database refuses a directly written illegal state: a leased row cannot lose its lease, and a
  // cancelled row cannot lose the timestamp its state requires.
  const leased = await enqueue({ jobType: MEDIA, idempotencyKey: 'probe-matrix-0003' });
  await register(worker('matrix'), 'media');
  await claimJob(worker('matrix'), 'media', leased.job_id);
  const brokenLease = await failure(() => db.query("update tonde.jobs set lease_owner = null where id = $1", [leased.job_id]));
  assert.match(brokenLease.message, /jobs_check|lease/i);
  const brokenCancel = await failure(() => db.query(
    "update tonde.jobs set status = 'cancel_requested' where id = $1", [leased.job_id]));
  assert.match(brokenCancel.message, /jobs_cancel_requested_stamped/);
  const brokenDeadLetter = await failure(() => db.query(
    "update tonde.jobs set status = 'dead_letter' where id = $1", [leased.job_id]));
  assert.match(brokenDeadLetter.message, /jobs_dead_letter_explained/);
});

test('recording a creator publishing authorization cannot commit without its outbox event', async () => {
  const fixture = await seedProduction('outbox-guarantee');
  const publication = await asEditor(() => rows(
    `select tonde.publication_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result`,
    [wa, fixture.production, fixture.result, 'probe_publisher', null, 'Probe channel', connection,
     'Probe title', 'Probe caption', 'public', null, JSON.stringify({})]).then(result => result[0].result));
  await asEditor(() => db.query('select tonde.publication_set_state($1,$2,$3,$4)',
    [wa, publication.publication_id, 'ready', 'Probe state change']));
  const authorization = await asEditor(() => rows(
    'select tonde.publication_authorize($1,$2,$3,$4) as result',
    [wa, publication.publication_id, 'authorize', 'Probe authorization']).then(result => result[0].result));
  const event = (await rows(`select state, event_type, resource_kind, resource_id, dedupe_key, payload
    from tonde.outbox_events where workspace_id = $1 and dedupe_key = $2`,
    [wa, `publication.authorized:${authorization.authorization_id}`]))[0];
  assert.ok(event, 'the authorization emitted its outbox event in the same transaction');
  assert.equal(event.state, 'pending');
  assert.equal(event.event_type, 'publication.authorized');
  assert.equal(event.resource_kind, 'publication');
  assert.equal(event.resource_id, publication.publication_id);
  assert.equal(event.payload.authorization_id, authorization.authorization_id);
  assert.equal(event.payload.destination_provider, 'probe_publisher');
  assert.equal(event.payload.production_id, fixture.production);
  // The guarantee is atomic: rolling the authorization back takes its outbox event with it.
  const doomed = await seedProduction('outbox-rollback');
  const doomedPublication = await asEditor(() => rows(
    `select tonde.publication_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result`,
    [wa, doomed.production, doomed.result, 'probe_publisher', null, 'Probe channel', connection,
     'Probe title', 'Probe caption', 'public', null, JSON.stringify({})]).then(result => result[0].result));
  await asEditor(() => db.query('select tonde.publication_set_state($1,$2,$3,$4)',
    [wa, doomedPublication.publication_id, 'ready', 'Probe state change']));
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [A]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  await db.exec('set local role authenticated');
  await db.query('select tonde.publication_authorize($1,$2,$3,$4)',
    [wa, doomedPublication.publication_id, 'authorize', 'Probe doomed authorization']);
  await db.exec('rollback');
  assert.equal(Number(await scalar(`select count(*) from tonde.outbox_events o join tonde.publication_authorizations a
    on o.dedupe_key = 'publication.authorized:' || a.id::text where a.publication_id = $1`,
    [doomedPublication.publication_id])), 0);
  assert.equal(Number(await scalar('select count(*) from tonde.publication_authorizations where publication_id = $1',
    [doomedPublication.publication_id])), 0);
  // Withdrawing an authorization is not a work request, so it emits nothing.
  const withdrawn = await asEditor(() => rows(
    'select tonde.publication_authorize($1,$2,$3,$4) as result',
    [wa, publication.publication_id, 'withdraw', 'Probe withdrawal']).then(result => result[0].result));
  assert.equal(Number(await scalar(`select count(*) from tonde.outbox_events
    where workspace_id = $1 and dedupe_key = $2`, [wa, `publication.authorized:${withdrawn.authorization_id}`])), 0);
});

test('operational metrics answer queue depth, dead letters, reconciliation and outbox backlog', async () => {
  const metrics = await asService(() => rows('select tonde.job_metrics() as result').then(result => result[0].result));
  assert.ok(Array.isArray(metrics.jobs_by_type));
  assert.equal(typeof metrics.queue_depth, 'number');
  assert.ok(Number(metrics.dead_letter_count) >= 1);
  assert.ok(Number(metrics.reconciliation_pending) >= 0);
  assert.ok(Number(metrics.lease_expiry_events) >= 1);
  assert.equal(typeof metrics.outbox.pending, 'number');
  assert.equal(typeof metrics.outbox.failed, 'number');
  assert.ok(Number(metrics.online_workers) >= 1);
  const entry = metrics.jobs_by_type.find(row => row.job_type === MEDIA);
  assert.ok(entry);
  assert.ok(Number(entry.total) >= 1);
  assert.ok(Number(entry.avg_duration_seconds ?? 0) >= 0);
  const publishing = metrics.jobs_by_type.find(row => row.job_type === PUBLISH);
  assert.ok(publishing);
  assert.ok(Number(publishing.waiting_for_reconciliation) >= 0);
  // Metrics name job types, never payloads or credentials.
  assert.equal(/token|secret|password/i.test(JSON.stringify(metrics)), false);
});
