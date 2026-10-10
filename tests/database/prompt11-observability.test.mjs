import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 11 packet 042 — observability, health, readiness and the alert seam, on real embedded
// PostgreSQL over one 001->042 stack. These tests pin the laws the migration claims: metrics are live
// counts and ages read from the durable tables, not cached numbers, and a metric with no rows reports
// zero; a snapshot is immutable evidence and the same window is captured once; an alert rule is
// deterministic over a closed metric set, opens exactly one event while breaching, keeps observing it,
// and is resolved only by the observation that shows the metric back inside the threshold; a person can
// acknowledge but never fake a resolution; health answers from real invariants, including the tenant
// tables actually carrying row level security; readiness names the row or function behind every answer
// and reports the unconfigured dependencies (no verified provider adapter, no scanner, no worker, no
// email surface at all) as not configured instead of ready; and a release record is written by the
// platform alone.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';
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
  await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asOwner = action => asUser(A, action);
const asEditor = action => asUser(C, action);
const asViewer = action => asUser(D, action);
const asStranger = action => asUser(B, action);

const metricsRead = (workspace = wa, window = 60, user = A) => asUser(user, () => rows(
  'select tonde.metrics_read($1,$2) as result', [workspace, window]).then(result => result[0].result));
const metricsCapture = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.metrics_capture($1,$2,$3) as result',
  [over.workspace ?? wa, over.window ?? 60, over.note ?? '']).then(result => result[0].result));
const snapshotsRead = (workspace = wa, limit = 24, user = A) => asUser(user, () => rows(
  'select tonde.snapshots_read($1,$2) as result', [workspace, limit]).then(result => result[0].result));
const ruleSet = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.alert_rule_set($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
  [over.workspace ?? wa, over.name ?? 'Probe rule', over.metric ?? 'jobs_queued', over.comparator ?? 'gte',
   over.threshold ?? 1, over.severity ?? 'warning', over.window ?? 60, over.enabled ?? true,
   over.note ?? '']).then(result => result[0].result));
const evaluate = (workspace = wa, limit = 100, user = A) => asUser(user, () => rows(
  'select tonde.alert_evaluate($1,$2) as result', [workspace, limit]).then(result => result[0].result));
const acknowledge = (alert, note = '', user = A) => asUser(user, () => rows(
  'select tonde.alert_acknowledge($1,$2,$3) as result', [wa, alert, note]).then(result => result[0].result));
const alertsRead = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.alert_events_read($1,$2,$3) as result',
  [over.workspace ?? wa, over.state ?? null, over.limit ?? 100]).then(result => result[0].result));
// Health is platform-wide infrastructure information, so the platform asks for it directly; a workspace
// admin reads the same picture through operations_status, which is scoped to the workspace they administer.
const healthCheck = (record = false) => asService(() => rows(
  'select tonde.health_check($1) as result', [record]).then(result => result[0].result));
const healthAs = (user, record = false) => asUser(user, () => rows(
  'select tonde.health_check($1) as result', [record]).then(result => result[0].result));
const readinessCheck = (workspace = wa, user = A) => asUser(user, () => rows(
  'select tonde.readiness_check($1) as result', [workspace]).then(result => result[0].result));
const operationsStatus = (workspace = wa, user = A) => asUser(user, () => rows(
  'select tonde.operations_status($1) as result', [workspace]).then(result => result[0].result));
const releaseRecord = (environment, releaseId, migratedThrough, notes = '') => asService(() => rows(
  'select tonde.release_record($1,$2,$3,$4,$5) as result',
  [environment, releaseId, migratedThrough, notes, JSON.stringify({ probe: true })]).then(result => result[0].result));

const register = (workerName, workerClass = 'export') => asService(() => rows(
  'select tonde.worker_register($1,$2,$3,$4,$5) as result',
  [workerName, workerClass, 'probe-instance', '11.0.0', []]).then(result => result[0].result));
const enqueue = (jobType, production, workspace = wa) => asService(() => rows(
  'select tonde.job_enqueue($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
  [workspace, jobType, production, JSON.stringify({}), null, null, null, A, null]).then(result => result[0].result));
// Claiming takes a job out of the queue, so a test that wants a known queue depth drains what it can and
// leaves everything that is not claimable work alone.
const drainQueued = async () => {
  for (let round = 0; round < 20; round += 1) {
    const claimed = await asService(() => rows('select tonde.job_claim($1,$2,$3,$4) as result',
      ['ops-probe-worker', 'export', 25, 300]).then(row => row[0].result));
    if (claimed.count === 0) return;
    for (const entry of claimed.claimed) await completeJob(entry.job_id, 'ops-probe-worker');
  }
  throw new Error('the queue should have drained');
};
const claimJob = async (workerName, job) => {
  for (let round = 0; round < 20; round += 1) {
    const result = await asService(() => rows('select tonde.job_claim($1,$2,$3,$4) as result',
      [workerName, 'export', 25, 300]).then(row => row[0].result));
    const entry = result.claimed.find(candidate => candidate.job_id === job);
    if (entry) return entry;
    if (result.count === 0) break;
  }
  throw new Error(`job ${job} should be claimable by ${workerName}`);
};
const startJob = (job, workerName) => asService(() => rows(
  'select tonde.job_start($1,$2) as result', [job, workerName]).then(result => result[0].result));
const completeJob = (job, workerName) => asService(() => rows(
  'select tonde.job_complete($1,$2,$3,$4,$5) as result',
  [job, workerName, JSON.stringify({ ok: true }), null, 'probe']).then(result => result[0].result));
const deadLetterJob = (job, workerName) => asService(() => rows(
  'select tonde.job_fail($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [job, workerName, 'PROBE_HARD_FAILURE', 'The probe cannot continue', 'must_not_retry', null, null, ''])
  .then(result => result[0].result));

const newProduction = (label = 'probe') => asOwner(async () => {
  const project = await scalar('insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id',
    [wa, `Ops ${label}`, A]);
  const production = await scalar('insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id',
    [wa, project, `Ops Production ${label}`, A]);
  return { project, production };
});

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
  for (const id of [A, B, C, D]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asOwner(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asStranger(() => scalar('select tonde.bootstrap_workspace()'));
  // A workspace with an owner, an editor and a viewer, so the tests can tell member-level reads apart
  // from the operations authority that snapshots, rules and acknowledgements need.
  await asService(async () => {
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')", [wa, C]);
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [wa, D]);
  });
});

after(async () => { await db?.close(); });

test('the observability vocabulary and the write boundary are closed', async () => {
  for (const table of ['operational_snapshots', 'alert_rules', 'alert_events', 'system_checks',
    'deployment_releases']) {
    assert.equal(Number(await scalar(`select count(*) from pg_tables where schemaname='tonde' and tablename=$1`, [table])), 1);
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid = ('tonde.' || $1)::regclass`, [table]), true);
    assert.equal(await scalar(`select has_table_privilege('authenticated', 'tonde.' || $1, 'SELECT')`, [table]), true);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await scalar(`select has_table_privilege('authenticated', 'tonde.' || $1, $2)`, [table, privilege]),
        false, `authenticated must not hold ${privilege} on tonde.${table}`);
    }
  }
  const metricDef = (await rows(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'tonde.alert_rules'::regclass and contype = 'c'`))
    .map(row => row.def).find(def => def.includes('jobs_dead_letter'));
  const listed = [...metricDef.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
  assert.equal(listed.length, 18);
  // The closed set is exactly what the metrics read produces: every rule metric has a value.
  const metrics = (await metricsRead()).metrics.values;
  for (const metric of listed) {
    assert.equal(Object.hasOwn(metrics, metric), true, `the metrics read must produce ${metric}`);
  }
  assert.deepEqual(Object.keys(metrics).sort(), listed);
  const comparatorDef = (await rows(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'tonde.alert_rules'::regclass and contype = 'c'`))
    .map(row => row.def).find(def => def.includes('gte'));
  assert.deepEqual([...comparatorDef.matchAll(/'([a-z]+)'/g)].map(match => match[1]).sort(),
    ['gt', 'gte', 'lt', 'lte']);
  assert.equal(await scalar(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p
    where p.pronamespace = 'tonde'::regnamespace and p.proname = 'release_record'`), false,
    'only the platform records a release');
  assert.equal(await scalar(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p
    where p.pronamespace = 'tonde'::regnamespace and p.proname = 'metrics_read'`), true);
  for (const name of ['workspace_metrics', 'metric_value', 'rule_breached', 'guard_alert_event',
    'guard_operational_snapshot']) {
    assert.equal(await scalar(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p
      where p.pronamespace = 'tonde_private'::regnamespace and p.proname = $1`, [name]), false);
  }
  const classes = await rows(`select data_class, purge_action, purge_exempt from tonde.retention_classes
    where data_class in ('operational_evidence','alert_configuration') order by data_class`);
  assert.deepEqual(classes, [
    { data_class: 'alert_configuration', purge_action: 'retain', purge_exempt: false },
    { data_class: 'operational_evidence', purge_action: 'retain', purge_exempt: false },
  ]);
});

test('metrics are live rows, not cached numbers', async () => {
  const { production } = await newProduction('metrics');
  const before = (await metricsRead()).metrics;
  assert.equal(Number(before.values.jobs_queued), 0);
  assert.equal(Number(before.values.jobs_dead_letter), 0);
  assert.equal(Number(before.values.workers_live), 0);
  assert.equal(Number(before.values.outbox_pending), 0);
  assert.equal(before.source, 'live rows');
  assert.equal(Number(before.window_minutes), 60);
  // A worker that is online is counted as live; going offline is reflected at once.
  await register('ops-probe-worker');
  assert.equal(Number((await metricsRead()).metrics.values.workers_live), 1);
  await asService(() => db.query("update tonde.workers set status = 'offline' where worker_id = 'ops-probe-worker'"));
  assert.equal(Number((await metricsRead()).metrics.values.workers_live), 0);
  await asService(() => db.query("update tonde.workers set status = 'online', heartbeat_at = now() where worker_id = 'ops-probe-worker'"));
  // A dead letter is work that will never finish, and it is counted as such. Claiming it takes it out of
  // the queue, so the two numbers follow the same durable row independently.
  const doomed = await enqueue('export', production);
  await claimJob('ops-probe-worker', doomed.job_id);
  await deadLetterJob(doomed.job_id, 'ops-probe-worker');
  const withDead = (await metricsRead()).metrics;
  assert.equal(Number(withDead.values.jobs_dead_letter), 1);
  assert.equal(Number(withDead.jobs.by_state.dead_letter), 1);
  assert.equal(Number(withDead.values.jobs_queued), 0, 'claimed work is no longer queued work');
  // A queued job shows up immediately, and so does its age.
  const queued = await enqueue('export', production);
  await asService(() => db.query(
    "update tonde.jobs set available_at = now() - interval '90 seconds' where id = $1", [queued.job_id]));
  const after = (await metricsRead()).metrics;
  assert.equal(Number(after.values.jobs_queued), 1);
  assert.equal(Number(after.values.oldest_queued_seconds) >= 90, true);
  assert.equal(Number(after.jobs.by_state.queued), 1);
  // The window is echoed, and a bad window is refused rather than clamped.
  assert.equal(Number((await metricsRead(wa, 1440)).metrics.window_minutes), 1440);
  const badWindow = await failure(() => metricsRead(wa, 0));
  assert.match(badWindow.message, /between 1 and 10080/);
  // A viewer may read the workspace's own metrics; a stranger may not read the workspace at all.
  assert.equal(Number((await asViewer(() => rows('select tonde.metrics_read($1,60) as result', [wa])
    .then(result => result[0].result))).metrics.values.jobs_queued), 1);
  const strangerRead = await failure(() => metricsRead(wa, 60, B));
  assert.equal(strangerRead.code, '42501');
});

test('a snapshot is immutable evidence and the same window is captured once', async () => {
  const captured = await metricsCapture({ note: 'Probe capture' });
  assert.equal(captured.idempotent, false);
  assert.equal(captured.metrics.values !== undefined, true);
  const again = await metricsCapture({ note: 'A second attempt at the same window' });
  assert.equal(again.idempotent, true);
  assert.equal(again.snapshot_id, captured.snapshot_id);
  assert.equal(again.captured_at, captured.captured_at);
  assert.equal(Number(await scalar('select count(*)::int from tonde.operational_snapshots where workspace_id = $1', [wa])), 1);
  const listed = await snapshotsRead();
  assert.equal(listed.count, 1);
  assert.equal(Number(listed.snapshots[0].values.jobs_dead_letter), 1);
  // An observation is never rewritten, and a client never deletes it.
  const rewrite = await failure(() => asService(() => db.query(
    `update tonde.operational_snapshots set metrics = '{}'::jsonb where id = $1`, [captured.snapshot_id])));
  assert.equal(rewrite.code, '23514');
  assert.match(rewrite.message, /never edited/);
  const purge = await failure(() => asOwner(() => db.query(
    'delete from tonde.operational_snapshots where id = $1', [captured.snapshot_id])));
  assert.match(purge.message, /permission denied/);
  // Capturing needs operations authority: an editor and a viewer are refused.
  const editorCapture = await failure(() => metricsCapture({}, C));
  assert.equal(editorCapture.code, '42501');
  const viewerCapture = await failure(() => metricsCapture({}, D));
  assert.equal(viewerCapture.code, '42501');
  // A second window is a second record, and it is audited.
  const otherWindow = await metricsCapture({ window: 1440 });
  assert.equal(otherWindow.idempotent, false);
  assert.equal(Number(await scalar(`select count(*)::int from tonde.audit_events
    where workspace_id = $1 and event_type = 'observability.metrics_captured'`, [wa])), 2);
});

test('an alert opens once, keeps observing and is resolved by the observation that recovers', async () => {
  const { production } = await newProduction('alerts');
  // Earlier probes left claimable work behind; drain it so the queue depth starts from a known zero.
  await drainQueued();
  assert.equal(Number((await metricsRead()).metrics.values.jobs_queued), 0);
  const rule = await ruleSet({ name: 'Queue depth', metric: 'jobs_queued', comparator: 'gte', threshold: 2,
    severity: 'critical', note: 'Anything waiting is worth knowing about' });
  assert.equal(rule.replaced_existing, false);
  assert.equal(rule.metric, 'jobs_queued');
  // Within threshold: nothing opens.
  const quiet = await evaluate();
  assert.equal(quiet.evaluated, 1);
  assert.equal(quiet.opened, 0);
  assert.equal(quiet.outcomes[0].outcome, 'within_threshold');
  // Breaching: exactly one event, with the observation that opened it.
  await enqueue('export', production);
  await enqueue('export', production);
  const fired = await evaluate();
  assert.equal(fired.opened, 1);
  assert.equal(fired.outcomes[0].outcome, 'opened');
  assert.equal(Number(fired.outcomes[0].observed), 2);
  const events = await alertsRead();
  assert.equal(events.count, 1);
  assert.equal(events.events[0].state, 'open');
  assert.equal(events.events[0].severity, 'critical');
  assert.equal(Number(events.events[0].evidence.first_observation), 2);
  assert.equal(events.rules.length, 1);
  // Still breaching: the same event is observed again, not duplicated.
  const still = await evaluate();
  assert.equal(still.opened, 0);
  assert.equal(still.updated, 1);
  const again = await alertsRead();
  assert.equal(again.count, 1);
  assert.equal(again.events[0].observations, 2);
  assert.equal(Number(again.events[0].observed), 2);
  // A person acknowledges it; acknowledging does not resolve it.
  const acknowledged = await acknowledge(again.events[0].alert_id, 'Watching the queue');
  assert.equal(acknowledged.state, 'acknowledged');
  const afterAck = await alertsRead();
  assert.equal(afterAck.events[0].state, 'acknowledged');
  assert.equal(afterAck.events[0].resolved_at, null);
  const ackAgain = await acknowledge(again.events[0].alert_id);
  assert.equal(ackAgain.idempotent, true);
  const resolvedAck = await failure(() => asService(() => db.query(
    "update tonde.alert_events set state = 'resolved', resolution = 'observed_in_range', resolved_at = now() where id = $1",
    [again.events[0].alert_id])));
  assert.equal(resolvedAck === null, false);
  // The work drains and the NEXT evaluation resolves it, recording that the system observed recovery.
  await drainQueued();
  assert.equal(Number((await metricsRead()).metrics.values.jobs_queued), 0);
  const recovered = await evaluate();
  assert.equal(recovered.resolved, 1);
  assert.equal(recovered.outcomes[0].outcome, 'resolved');
  const closed = await alertsRead();
  assert.equal(closed.events[0].state, 'resolved');
  assert.equal(closed.events[0].resolution, 'observed_in_range');
  assert.equal(closed.events[0].evidence.resolved_by, 'observation');
  assert.equal(Number(closed.events[0].observed), 0);
  assert.notEqual(closed.events[0].resolved_at, null);
  const ackResolved = await failure(() => acknowledge(closed.events[0].alert_id));
  assert.equal(ackResolved.code, 'PT409');
  assert.match(ackResolved.message, /ALERT_ALREADY_RESOLVED/);
  // A resolved alert is a closed record.
  const rewrite = await failure(() => asService(() => db.query(
    "update tonde.alert_events set state = 'open' where id = $1", [closed.events[0].alert_id])));
  assert.equal(rewrite.code, '23514');
  assert.match(rewrite.message, /closed record/);
  const forgedOpen = await failure(() => asService(() => db.query(
    `insert into tonde.alert_events(workspace_id,rule_id,metric,comparator,threshold,observed,severity,state)
      values($1,$2,'jobs_queued','gte',2,5,'critical','resolved')`, [wa, rule.rule_id])));
  assert.equal(forgedOpen.code, '42501');
});

test('a rule is a closed set of metrics, and changing its meaning supersedes the live alert', async () => {
  const badMetric = await failure(() => ruleSet({ name: 'Nonsense', metric: 'vibes_per_second' }));
  assert.match(badMetric.message, /not a metric this system observes/);
  const badComparator = await failure(() => ruleSet({ name: 'Loose', comparator: 'approximately' }));
  assert.match(badComparator.message, /compares with gt, gte, lt or lte/);
  const badSeverity = await failure(() => ruleSet({ name: 'Loud', severity: 'panic' }));
  assert.match(badSeverity.message, /not a TONDE alert severity/);
  const noName = await failure(() => ruleSet({ name: '   ' }));
  assert.match(noName.message, /needs a name/);
  // An editor and a viewer cannot define rules.
  const editorRule = await failure(() => ruleSet({ name: 'Editor rule' }, C));
  assert.equal(editorRule.code, '42501');
  // A rule that breaches, then changes its threshold, has its live alert resolved as superseded.
  const rule = await ruleSet({ name: 'Purge backlog', metric: 'storage_purge_pending', comparator: 'gte', threshold: 0 });
  const fired = await evaluate();
  assert.equal(fired.opened >= 1, true);
  const live = (await alertsRead({ state: 'open' })).events.find(event => event.rule_id === rule.rule_id);
  assert.notEqual(live, undefined);
  const changed = await ruleSet({ name: 'Purge backlog', metric: 'storage_purge_pending', comparator: 'gte', threshold: 100 });
  assert.equal(changed.replaced_existing, true);
  const superseded = (await alertsRead()).events.find(event => event.alert_id === live.alert_id);
  assert.equal(superseded.state, 'resolved');
  assert.equal(superseded.resolution, 'superseded_by_rule_change');
  assert.equal(superseded.evidence.superseded_by_rule_change, true);
  assert.equal(Number(superseded.evidence.new_threshold), 100);
  // The changed rule is now quiet, and it is the only rule left enabled with that name.
  const recheck = await evaluate();
  assert.equal(recheck.outcomes.find(entry => entry.rule_id === rule.rule_id).outcome, 'within_threshold');
  await ruleSet({ name: 'Purge backlog', enabled: false });
  const disabled = await evaluate();
  assert.equal(disabled.outcomes.some(entry => entry.rule_id === rule.rule_id), false);
});

test('health answers from real invariants, including tenant tables carrying row level security', async () => {
  const healthy = await healthCheck();
  const check = name => healthy.checks.find(entry => entry.check === name);
  assert.equal(check('database_answers').state, 'ok');
  assert.equal(check('tenant_tables_have_rls').state, 'ok');
  assert.equal(Number(check('tenant_tables_have_rls').observed.tables_without_rls), 0);
  assert.equal(check('stuck_retention_sweeps').state, 'ok');
  assert.equal(check('stuck_deletion_requests').state, 'ok');
  assert.equal(check('storage_purge_backlog').state, 'ok');
  assert.equal(check('expired_job_leases').state, 'ok');
  assert.equal(healthy.check_count, 7);
  // The dead letter from earlier is reported as degraded work that a person must look at.
  assert.equal(check('dead_letter_jobs').state, 'degraded');
  assert.equal(Number(check('dead_letter_jobs').observed.dead_letter) >= 1, true);
  assert.equal(healthy.state, 'degraded');
  // Row level security coming off a tenant table is caught, and reported by name.
  const rlsTables = await rows(`select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'tonde' and t.table_type = 'BASE TABLE' and c.column_name = 'workspace_id'
      and c.table_name = 'discover_saves'`);
  assert.equal(rlsTables.length, 1);
  await db.exec('alter table tonde.discover_saves disable row level security');
  try {
    const degraded = await healthCheck();
    const rls = degraded.checks.find(entry => entry.check === 'tenant_tables_have_rls');
    assert.equal(rls.state, 'degraded');
    assert.equal(Number(rls.observed.tables_without_rls), 1);
    assert.match(rls.detail, /leak/);
  } finally {
    await db.exec('alter table tonde.discover_saves enable row level security');
  }
  const restored = await healthCheck();
  assert.equal(restored.checks.find(entry => entry.check === 'tenant_tables_have_rls').state, 'ok');
  // A stuck sweep is caught from the real row.
  await asService(() => db.query(`insert into tonde.retention_sweeps(data_class, cutoff_at, state, started_at)
    values('job_events', now() - interval '2 days', 'running', now() - interval '3 hours')`));
  const stuck = await healthCheck();
  const sweep = stuck.checks.find(entry => entry.check === 'stuck_retention_sweeps');
  assert.equal(sweep.state, 'degraded');
  assert.equal(Number(sweep.observed.stuck_sweeps), 1);
  await asService(() => db.query("update tonde.retention_sweeps set state = 'completed', completed_at = now() where state = 'running'"));
  // An expired lease is reported as late work, not as lost work.
  await asService(() => db.query(`update tonde.jobs set status = 'leased', lease_owner = 'ops-probe-worker',
    lease_expires_at = now() - interval '10 minutes' where status = 'succeeded'`));
  const late = await healthCheck();
  const leases = late.checks.find(entry => entry.check === 'expired_job_leases');
  assert.equal(leases.state, 'degraded');
  assert.equal(Number(leases.observed.expired_leases) >= 1, true);
  assert.match(leases.detail, /late/);
  // The staging is undone exactly: the same completed rows go back to succeeded, and nothing else moves.
  await asService(() => db.query(`update tonde.jobs set status = 'succeeded', lease_owner = null, lease_expires_at = null
    where status = 'leased' and progress = 100 and completed_at is not null`));
  // Health is platform-only: a viewer is refused, and so is a workspace owner, because the counts are
  // platform-wide. A workspace admin reads the same picture through the operations console read instead.
  const viewerHealth = await failure(() => healthAs(D));
  assert.equal(viewerHealth.code, '42501');
  assert.match(viewerHealth.message, /permission denied for function health_check/);
  const ownerHealth = await failure(() => healthAs(A));
  assert.equal(ownerHealth.code, '42501');
  assert.equal((await operationsStatus()).health.checks.length, 7);
  const recorded = await healthCheck(true);
  assert.equal(recorded.state !== undefined, true);
  const stored = (await rows(`select check_kind, state, summary from tonde.system_checks order by checked_at desc limit 1`))[0];
  assert.equal(stored.check_kind, 'health');
  assert.equal(stored.state, recorded.state);
  const rewrite = await failure(() => asService(() => db.query(
    "update tonde.system_checks set state = 'ok'")));
  assert.equal(rewrite.code, '23514');
  assert.match(rewrite.message, /never rewritten/);
});

test('readiness names its sources and reports what is not configured instead of ready', async () => {
  const report = await readinessCheck();
  const dependency = name => report.dependencies.find(entry => entry.dependency === name);
  assert.equal(report.workspace_id, wa);
  // A worker is online (registered earlier), so the fleet is ready for work.
  assert.equal(dependency('worker_fleet').state, 'ok');
  assert.equal(report.ready_for_work, true);
  assert.equal(dependency('worker_fleet').source, 'tonde.workers');
  // No scanner is configured, and the answer comes from the media limits function itself.
  assert.equal(dependency('media_scanner').state, 'not_configured');
  assert.match(dependency('media_scanner').detail, /No malware scanner/);
  assert.equal(dependency('media_scanner').source, 'tonde.media_upload_limits().scanner_configured');
  // No provider adapter was ever verified against a real provider.
  assert.equal(dependency('integration_providers').state, 'not_configured');
  assert.deepEqual(dependency('integration_providers').providers.verified, []);
  const providers = dependency('integration_providers').providers.providers;
  assert.equal(providers.length > 0, true);
  // The manual export adapter is implemented; every other provider has no adapter at all, and not one of
  // them is verified. A capability claim needs a verified adapter, and there is none.
  assert.deepEqual(providers.filter(provider => provider.adapter_state !== 'absent')
    .map(provider => provider.provider), ['manual']);
  assert.equal(providers.filter(provider => provider.adapter_state === 'absent')
    .every(provider => provider.state === 'not_configured'), true);
  assert.equal(providers.every(provider => provider.state !== 'ok'), true);
  assert.equal(providers.every(provider => provider.connections === 0), true);
  assert.match(dependency('integration_providers').detail, /claims none of it/);
  // No AI connection is recorded as connected, and no subscription exists.
  assert.equal(dependency('ai_generation').state, 'not_configured');
  assert.deepEqual(dependency('ai_generation').connections, []);
  assert.equal(dependency('billing').state, 'not_configured');
  // Email delivery has no configuration surface at all, and readiness says exactly that.
  assert.equal(dependency('email_delivery').state, 'not_configured');
  assert.match(dependency('email_delivery').detail, /no email provider configuration surface/);
  assert.match(dependency('email_delivery').source, /schema scan/);
  // Every dependency names where it was read from.
  for (const entry of report.dependencies) {
    assert.equal(typeof entry.source, 'string');
    assert.equal(entry.source.length > 0, true, `${entry.dependency} must name its source`);
    assert.equal(['ok', 'degraded', 'failed', 'not_configured'].includes(entry.state), true);
  }
  assert.equal(report.state, 'degraded', 'some dependencies are configured and some are not');
  // A verified adapter flips that dependency to ok; nothing else is touched.
  await asService(() => db.query(`update tonde.integration_providers set adapter_state = 'verified'
    where key = (select key from tonde.integration_providers order by key limit 1)`));
  const verified = await readinessCheck();
  assert.equal(verified.dependencies.find(entry => entry.dependency === 'integration_providers').state, 'ok');
  assert.equal(verified.dependencies.find(entry => entry.dependency === 'integration_providers').providers.verified.length, 1);
  await asService(() => db.query("update tonde.integration_providers set adapter_state = 'implemented'"));
  // Readiness needs operations authority, and it is readable for another workspace only by its admins.
  const stranger = await failure(() => readinessCheck(wa, B));
  assert.equal(stranger.code, '42501');
  const viewer = await failure(() => readinessCheck(wa, D));
  assert.equal(viewer.code, '42501');
  const platform = await asService(() => rows('select tonde.readiness_check(null) as result').then(result => result[0].result));
  assert.equal(platform.workspace_id, null);
  assert.equal(platform.dependencies.length, report.dependencies.length);
});

test('the operations console read combines health, readiness, metrics and open alerts', async () => {
  const status = await operationsStatus();
  assert.equal(status.workspace_id, wa);
  assert.equal(status.health.checks.length, 7);
  assert.equal(status.readiness.dependencies.length, 7);
  assert.equal(status.metrics.workspace_id, wa);
  assert.equal(status.alerts.workspace === undefined, true);
  assert.equal(status.alerts.workspace_id, wa);
  assert.equal(Array.isArray(status.alerts.events), true);
  assert.notEqual(status.read_at, null);
  assert.equal(status.metrics.values.workers_live !== undefined, true);
  const viewer = await failure(() => operationsStatus(wa, D));
  assert.equal(viewer.code, '42501');
  const stranger = await failure(() => operationsStatus(wa, B));
  assert.equal(stranger.code, '42501');
  // A member who is not an admin may still read metrics and the alert trail.
  assert.equal((await metricsRead(wa, 60, C)).metrics.workspace_id, wa);
  assert.equal((await alertsRead({}, C)).workspace_id, wa);
  const badState = await failure(() => alertsRead({ state: 'vibes' }));
  assert.match(badState.message, /open, acknowledged or resolved/);
});

test('a release record is written by the platform, is idempotent and never rewritten', async () => {
  const recorded = await releaseRecord('local', 'prompt-11-local', '001-042', 'Local regression pass');
  assert.equal(recorded.idempotent, false);
  assert.equal(recorded.environment, 'local');
  assert.equal(recorded.migrated_through, '001-042');
  const again = await releaseRecord('local', 'prompt-11-local', '001-042', 'A second attempt');
  assert.equal(again.idempotent, true);
  assert.equal(again.release_id, recorded.release_id);
  assert.equal(Number(await scalar(`select count(*)::int from tonde.deployment_releases where environment = 'local'`)), 1);
  assert.equal(Number(await scalar(`select count(*)::int from tonde.deployment_releases where environment = 'hosted'`)), 0,
    'nothing claims a hosted release that was not made');
  const badEnvironment = await failure(() => releaseRecord('production', 'probe', '001-042'));
  assert.match(badEnvironment.message, /names local, hosted or preview/);
  const noRange = await failure(() => releaseRecord('hosted', 'probe', '  '));
  assert.match(noRange.message, /names itself and the migration range/);
  // A client cannot record a release, and an existing record cannot be rewritten.
  const asClient = await failure(() => asOwner(() => rows(
    'select tonde.release_record($1,$2,$3,$4,$5) as result', ['hosted', 'probe', '001-042', '', '{}'])
    .then(result => result[0].result)));
  assert.equal(asClient.code, '42501');
  const rewrite = await failure(() => asService(() => db.query(
    "update tonde.deployment_releases set migrated_through = '001-999'")));
  assert.equal(rewrite.code, '23514');
  assert.match(rewrite.message, /never rewritten/);
});

test('observability data is tenant-isolated', async () => {
  const { production } = await newProduction('isolation');
  const otherProduction = await asUser(B, async () => {
    const project = await scalar('insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id',
      [wb, 'Ops isolation', B]);
    return scalar('insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id',
      [wb, project, 'Ops Production isolation', B]);
  });
  const rule = await ruleSet({ name: 'Isolation rule', metric: 'jobs_dead_letter', comparator: 'gte', threshold: 0 });
  await evaluate();
  const foreign = await asStranger(async () => ({
    snapshots: Number(await scalar('select count(*)::int from tonde.operational_snapshots where workspace_id = $1', [wa])),
    rules: Number(await scalar('select count(*)::int from tonde.alert_rules where workspace_id = $1', [wa])),
    events: Number(await scalar('select count(*)::int from tonde.alert_events where workspace_id = $1', [wa])),
  }));
  assert.deepEqual(foreign, { snapshots: 0, rules: 0, events: 0 });
  assert.equal(Number(await asStranger(() => scalar(
    'select count(*)::int from tonde.operational_snapshots where workspace_id = $1', [wb]))), 0,
  'the other workspace has its own empty observability surface');
  // The other workspace's own metrics never see this workspace's work.
  const otherMetrics = await asStranger(() => rows('select tonde.metrics_read($1,60) as result', [wb])
    .then(result => result[0].result));
  assert.equal(Number(otherMetrics.metrics.values.jobs_queued), 0);
  assert.equal(Number(otherMetrics.metrics.values.jobs_dead_letter), 0);
  const foreignMetricRead = await failure(() => metricsRead(wa, 60, B));
  assert.equal(foreignMetricRead.code, '42501');
  const foreignEvaluate = await failure(() => evaluate(wa, 100, B));
  assert.equal(foreignEvaluate.code, '42501');
  const foreignRule = await failure(() => ruleSet({ name: 'Not mine' }, B));
  assert.equal(foreignRule.code, '42501');
  const foreignSnapshots = await failure(() => snapshotsRead(wa, 10, B));
  assert.equal(foreignSnapshots.code, '42501');
  // The other workspace can run its own evaluation and see only its own alert.
  await enqueue('export', otherProduction, wb);
  const otherEvaluate = await asStranger(() => rows('select tonde.alert_evaluate($1,100) as result', [wb])
    .then(result => result[0].result));
  assert.equal(otherEvaluate.opened, 0, 'a rule that was never defined in that workspace cannot fire');
  const otherAlerts = await asStranger(() => rows('select tonde.alert_events_read($1,null,50) as result', [wb])
    .then(result => result[0].result));
  assert.equal(otherAlerts.rules.length, 0);
  const foreignAck = await failure(() => acknowledge(rule.rule_id, 'not mine', B));
  assert.equal(foreignAck.code, '42501');
});
