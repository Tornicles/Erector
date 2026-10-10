import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompts 1-9 correction pass, on real embedded PostgreSQL against one 001->025 stack.
// Additive migration 025 repairs two Prompt 7 residual findings (relational integrity for
// execution_plans model profiles; single-computation readiness in ai_creation_surface) and is
// proven here. This file also pins the durable-jobs foundation the earlier gap audit wrongly
// reported as absent, so a later reader cannot conclude `tonde.jobs` does not exist.
// Nothing here crosses a workspace boundary, and nothing here fabricates a live provider.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const ABSENT = '00000000-0000-4000-8000-00000000dead';
let wa, wb, production, scene, bulkProduction;
const shots = [];
const BULK_SHOTS = 30;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };

const planPayload = (over = {}) => ({
  plan_status: 'ready', generated_by: 'deterministic', provider_target: 'manual',
  expected_duration_ms: 4000, aspect_ratio: '9:16',
  canonical_prompt: { subject: 'A cup pours', action: 'pours', environment: 'Dark kitchen',
    camera: 'low angle', movement: 'slow push', lighting: 'one soft source', style: 'warm',
    continuity: 'same cup', negative: [] },
  provider_prompt: 'A low slow push as the cup pours in a warm dark kitchen.',
  negative_constraints: [], limitations: [],
  motion: { needed: false }, audio: { needed: false },
  first_frame: { source: '', note: '' }, last_frame: { source: '', note: '' },
  continuity: { must: [], should: [], flexible: [], changes: [] },
  ...over,
});
const declare = (workspace, over = {}, action = asEditor) => action(() => scalar(
  'select tonde.declare_ai_model($1,$2,$3)', [workspace, JSON.stringify({
    provider_key: 'runway', model_key: 'ref-v1', label: 'Reference video', operation: 'image_to_video',
    capability_state: 'SUPPORTED', modalities: ['image', 'video'], supports_image_reference: true, ...over }), null]));

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
  wa = await asUser(A, () => scalar('select tonde.bootstrap_workspace()'));
  wb = await asUser(B, () => scalar('select tonde.bootstrap_workspace()'));
  production = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Kitchen film', 'short_film']));
  scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)',
    [wa, production, null, JSON.stringify({ title: 'Kitchen', duration_ms: 24000 })]).then(row => row.scene_id));
  for (let index = 0; index < 6; index += 1) {
    shots.push(await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)',
      [wa, production, scene, null, JSON.stringify({ title: `Shot ${index + 1}`, duration_ms: 4000, execution_method: 'ai' })])
      .then(row => row.shot_id)));
  }
  // A larger Production, so the readiness bound is proven to scale rather than merely hold at six.
  bulkProduction = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)',
    [wa, 'Long production', 'short_film']));
  const bulkScene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)',
    [wa, bulkProduction, null, JSON.stringify({ title: 'Bulk', duration_ms: BULK_SHOTS * 4000 })]).then(row => row.scene_id));
  for (let index = 0; index < BULK_SHOTS; index += 1) {
    await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)',
      [wa, bulkProduction, bulkScene, null, JSON.stringify({ title: `Bulk ${index + 1}`, duration_ms: 4000, execution_method: 'ai' })]));
  }
});

after(async () => { await db?.close(); });

test('certification: enclosing Scene and Production locks protect CRUD, but not derived-plan staleness', async t => {
  const plan = await asEditor(() => scalar("insert into tonde.execution_plans(workspace_id,production_id,shot_id,execution_method) values($1,$2,$3,'real') returning id", [wa,production,shots[0]]));
  const lock = (object, value) => asEditor(() => scalar('select tonde.lock_set($1,$2,$3,$4,null,$5)',
    [wa, production, object, value, 'Certification lock regression']));
  t.after(async () => {
    for (const [table,id] of [['scenes',scene],['productions',production]])
      if (await scalar(`select locked_at is not null from tonde.${table} where id=$1`, [id])) await lock(id,false);
  });
  await asEditor(() => db.query('update tonde.productions set planned_duration_ms=24000 where id=$1', [production]));
  await lock(scene,true);
  assert.equal(await scalar('select tonde_private.pi_is_locked($1,$2)', [wa,shots[0]]),true);
  if (plan) assert.equal(await scalar('select tonde_private.pi_is_locked($1,$2)', [wa,plan]),false);
  await assert.rejects(asEditor(() => db.query('update tonde.shots set description=$2 where id=$1', [shots[0],'Blocked'])), /enclosing scope/);
  await assert.rejects(asEditor(() => scalar('select tonde.scene_audio_direction_save($1,$2,$3,null,$4)',
    [wa,production,scene,JSON.stringify({music_direction:'First audio insert must respect a Scene lock'})])), /enclosing scope/);
  await lock(scene,false);
  await lock(production,true);
  assert.equal(await scalar('select tonde_private.pi_is_locked($1,$2)', [wa,shots[0]]),true);
  await assert.rejects(asEditor(() => scalar('select tonde.create_studio_shot($1,$2,null,null,$3)',
    [wa,production,JSON.stringify({title:'Orphan must inherit Production lock'})])), /enclosing scope/);
  await lock(production,false);
});

test('certification: Reference attestation, history, stale analysis pins and tenant isolation', async () => {
  const reference = await asEditor(() => scalar("insert into tonde.production_references(workspace_id,production_id,source_type,source_url) values($1,$2,'url','https://example.com/reference') returning id", [wa,production]));
  const attest = (revision,purpose,action=asEditor) => action(() => scalar('select tonde.reference_identity_save($1,$2,$3,$4,$5)',
    [wa,production,reference,revision,JSON.stringify({source_identity:'Creator-identified example',source_identity_verified:true,creator_purpose:purpose})]));
  const claim = rev => asEditor(() => scalar("select tonde.claim_reference_analysis_pinned($1,$2,$3,$4,'preprocessing',array['preprocessing'],10,'')", [wa,production,reference,rev]));
  await assert.rejects(claim(1), /identity and creator purpose/);
  await assert.rejects(asEditor(() => db.query("update tonde.production_references set identity_provenance='creator_supplied' where id=$1", [reference])), /permission denied/);
  const saved = await attest(1,'Learn the pacing, not ownership or consent');
  assert.equal(saved.identity_revision,2);
  assert.equal(saved.rights_classification,'unknown','a URL never attests ownership');
  assert.equal(saved.revision,2);
  assert.equal(Number(await scalar('select count(*) from tonde.object_versions where object_id=$1',[reference])),2);
  await assert.rejects(attest(1,'Stale edit'), /changed since/);
  await assert.rejects(attest(2,'Cross-tenant',asOther), /Workspace editor|Workspace access|permission denied/i);
  await claim(2);
  await attest(await scalar('select revision from tonde.production_references where id=$1',[reference]),'A new objective');
  await assert.rejects(asEditor(() => scalar("select tonde.claim_reference_analysis($1,$2,$3,'analyzing',array['analyzing'],45,'')",[wa,production,reference])), /identity changed/);
  await claim(3);
  assert.equal(await scalar('select identity_revision from tonde.reference_analyses where reference_id=$1',[reference]),3);
  const unsupported = {identity_revision:3,status:'partial',summary:'Metadata only',capability:'metadata_only',capabilities:{modalities:{image:'unavailable',audio:'unavailable'}}};
  for (const [category,evidence] of [['story',[]],['lighting',[{kind:'measurement',detail:'Invented frame'}]],['voice',[{kind:'measurement',detail:'Invented audio'}]]]) {
    await assert.rejects(asEditor(() => scalar("select tonde.save_reference_analysis($1,$2,$3,$4,$5,'[]'::jsonb,null)",
      [wa,production,reference,JSON.stringify(unsupported),JSON.stringify([{finding_id:category,category,statement:'Not observed',epistemic:'observed',confidence:'high',evidence}])])), /evidence|observations require/);
  }
  await assert.rejects(asEditor(() => scalar("select tonde.save_reference_analysis($1,$2,$3,$4,'[]'::jsonb,'[]'::jsonb,null)",
    [wa,production,reference,JSON.stringify({...unsupported,identity_revision:2})])), /identity revision changed/);
  const snapshots = await rows('select revision,snapshot from tonde.object_versions where object_id=$1 order by revision',[reference]);
  assert.equal(snapshots[0].snapshot.identity_provenance,'unknown');
  assert.equal(snapshots[1].snapshot.creator_purpose,'Learn the pacing, not ownership or consent');
});

// Finding 4A: execution_plans.model_profile_id / fallback_model_profile_id gained no relational
// integrity in 017. Both are now tenant-safe composite foreign keys to ai_model_profiles.
test('an execution plan can only reference a model profile that exists in its own workspace', async () => {
  const constraints = (await rows(
    `select conname from pg_constraint where conrelid = 'tonde.execution_plans'::regclass and contype = 'f'`))
    .map(row => row.conname);
  assert.ok(constraints.includes('execution_plans_model_profile_fk'), 'primary model-profile FK exists');
  assert.ok(constraints.includes('execution_plans_fallback_model_profile_fk'), 'fallback model-profile FK exists');

  const strong = await declare(wa);
  const foreign = await declare(wb, { model_key: 'ref-wb' }, asOther);
  const saved = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots[0], null, JSON.stringify(planPayload({ model_profile_id: strong.model_profile_id })),
      JSON.stringify([]), null]));
  const planId = saved.plan_id;
  assert.ok(planId, 'the plan was stored with a valid primary profile');

  // A nonexistent profile is refused by the database, not only by the RPC.
  const missing = await failure(() => db.query(
    'update tonde.execution_plans set model_profile_id = $1 where id = $2', [ABSENT, planId]));
  assert.equal(missing.code, '23503');
  // Another workspace's profile is refused: the workspace is part of the key.
  const cross = await failure(() => db.query(
    'update tonde.execution_plans set model_profile_id = $1 where id = $2', [foreign.model_profile_id, planId]));
  assert.equal(cross.code, '23503');
  // A valid primary profile is accepted.
  await db.query('update tonde.execution_plans set model_profile_id = $1 where id = $2', [strong.model_profile_id, planId]);
  // The fallback column is enforced the same way, and a null fallback stays valid.
  const badFallback = await failure(() => db.query(
    'update tonde.execution_plans set fallback_model_profile_id = $1 where id = $2', [ABSENT, planId]));
  assert.equal(badFallback.code, '23503');
  await db.query('update tonde.execution_plans set fallback_model_profile_id = $1 where id = $2', [strong.model_profile_id, planId]);
  await db.query('update tonde.execution_plans set fallback_model_profile_id = null where id = $1', [planId]);
  // A null primary is valid too (a Real or not-yet-routed plan names no AI model).
  await db.query('update tonde.execution_plans set model_profile_id = null where id = $1', [planId]);
  await db.query('update tonde.execution_plans set model_profile_id = $1 where id = $2', [strong.model_profile_id, planId]);
  // A referenced profile cannot be deleted out from under a plan. `on delete restrict` is a
  // restrict_violation (23001), distinct from the foreign_key_violation (23503) a bad reference raises.
  const deleted = await failure(() => db.query('delete from tonde.ai_model_profiles where id = $1', [strong.model_profile_id]));
  assert.equal(deleted.code, '23001');
});

// Finding 5: the two platform guards were the only trigger functions still SECURITY INVOKER while
// calling `tonde_private` helpers, and only `authenticated` holds EXECUTE on those helpers. Because
// PostgreSQL may evaluate an `AND` operand out of order, the helper was reached even for rows the
// guard's own condition excluded, so a write by any other role - the server role included - failed
// with `permission denied for function ...`. The server role is the only writer of the durable-jobs
// foundation (`authenticated` holds SELECT alone there), so the server path was unusable.
test('the server role can write guarded rows but still cannot manufacture an approval', async () => {
  const asService = async action => {
    await db.exec('begin; set local role service_role;');
    try { const result = await action(); await db.exec('rollback'); return result; }
    catch (error) { await db.exec('rollback'); throw error; }
  };
  const guards = await rows(`select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde_private' and p.proname in ('guard_mutation','guard_human_acceptance') order by 1`);
  assert.equal(guards.length, 2, 'both platform guards exist');
  assert.ok(guards.every(row => row.prosecdef === true),
    'a guard that consults private helpers decides as its own owner, not as whatever role is writing');
  // Composition, not a bare total: the count grows only by adding a guarded table deliberately.
  // 031 added the two integration catalog guards, 032 the publications aggregate and 033 the exports
  // aggregate, 034 added six commercial catalog/authority tables, 036 added the append-only job event
  // history, 038 added the retention policy registry, the deletion requests and the append-only
  // deletion trail, 039 added the four knowledge provenance surfaces (sources, conflicts, tutorials and
  // tutorial steps; the import ledger carries its own append-only guard), 040 added the four device
  // and scene surfaces (device capability, lens capability, scene requirements and settings proposals),
  // 041 added the four Discover surfaces (items, saves, collections and applications), and 042 added the
  // four observability surfaces (operational snapshots, alert rules, the append-only alert trail and
  // recorded system checks), and 043 added the two Director-correction tables (documented AI tool
  // knowledge and the Production Kit's AI tools), so the deliberate total is 68 + 31; any other movement
  // is a removed or duplicated guard and must fail here.
  assert.deepEqual(await rows(`select tg.tgname, count(*)::integer as guarded_tables from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'tonde' and not tg.tgisinternal and tg.tgname in ('guard_mutation','a_human_acceptance')
    group by 1 order by 1`), [
    { tgname: 'a_human_acceptance', guarded_tables: 13 },
    { tgname: 'guard_mutation', guarded_tables: 99 },
  ], 'every guarded table keeps its guard');

  const job = await asService(() => scalar(`insert into tonde.jobs(workspace_id,production_id,job_type,input_object_id,requested_by)
    values($1,$2,'export',$2,$3) returning id`, [wa, production, A]));
  assert.ok(job, 'the server path can enqueue durable work');
  const mediaId = '00000000-0000-4000-8000-0000000009f0';
  const media = await asService(() => scalar(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes,created_by)
    values($1,$2,'tonde-results',$3,'server.png','image/png','image',68,$4) returning id`,
    [mediaId, wa, `${wa}/${mediaId}/server.png`, A]));
  assert.equal(media, mediaId, 'the server path can register guarded media metadata');
  await asService(() => db.query('update tonde.productions set updated_at = now() where id = $1', [production]));
  // A guarded table that carries an approval column stays editable server-side for ordinary work...
  await asService(() => db.query('update tonde.assets set updated_at = now() where workspace_id = $1', [wa]));
  // ...while INV-11 is intact: an approval still requires an authenticated creator decision.
  const forged = await failure(() => asService(() => db.query("update tonde.productions set approval = 'approved' where id = $1", [production])));
  assert.equal(forged.code, '42501');
  assert.equal(await scalar('select approval::text from tonde.productions where id = $1', [production]), 'draft');
  // The guards themselves stay unreachable as callable functions.
  assert.equal(await scalar(`select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde_private' and p.proname in ('guard_mutation','guard_human_acceptance')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('service_role', p.oid, 'execute'))`), 0);
});

// Finding 6: every optimistic-concurrency guard raised SQLSTATE 40001, which tells PostgREST the
// failure is transient, so PostgREST retries the transaction indefinitely and the request never
// returns (documented Supabase behaviour: "SQLSTATE 40001 in an RPC function causes infinite
// retries", present in PostgREST 14). Conflicts now raise the PostgREST-mapped PT409 -> HTTP 409,
// and the conflict itself is unchanged: refused, nothing applied, current state intact.
test('no live function raises the retryable conflict code and a stale write is refused as PT409', async () => {
  const offenders = await rows(`select n.nspname||'.'||p.proname as fn from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('tonde','tonde_private') and p.prosrc ~ 'errcode[[:space:]]*=[[:space:]]*''40001'''`);
  assert.deepEqual(offenders.map(row => row.fn), [], 'no applied function may raise the retryable SQLSTATE 40001');
  const mapped = await scalar(`select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('tonde','tonde_private') and p.prosrc ~ 'PT409'`);
  assert.ok(mapped >= 44, `every concurrency guard raises the transport-safe code (found ${mapped})`);
  const revision = await scalar('select revision from tonde.productions where id = $1', [production]);
  const approval = await scalar('select approval::text from tonde.productions where id = $1', [production]);
  const stale = await failure(() => asEditor(() => scalar('select tonde.approval_decide($1,$2,$3,$4,$5,$6)',
    [wa, production, production, 'approve', revision + 7, 'Stale revision'])));
  assert.equal(stale.code, 'PT409', 'a stale revision is still refused, now with the mapped conflict code');
  assert.match(stale.message, /changed since you loaded it/);
  assert.equal(await scalar('select approval::text from tonde.productions where id = $1', [production]), approval,
    'a refused stale approval applies nothing');
  assert.equal(await scalar('select revision from tonde.productions where id = $1', [production]), revision,
    'a refused stale approval does not move the revision');
});

// Finding 4B (already repaired in 017, re-proven here): one declaration edit is one revision.
test('re-declaring a model moves its revision exactly once', async () => {
  const before = await declare(wa, { model_key: 'revise-v1', supports_image_edit: false, supports_lipsync: false });
  const corrected = await declare(wa, { model_key: 'revise-v1', supports_image_edit: true, supports_lipsync: true, cost_amount: 0.5, cost_currency: 'USD' });
  assert.equal(corrected.revision, before.revision + 1, 'one declaration edit is one revision, not two');
  assert.equal(corrected.cost_known, true);
  const stored = (await rows('select revision, supports_image_edit, supports_lipsync from tonde.ai_model_profiles where id = $1',
    [before.model_profile_id]))[0];
  assert.equal(stored.supports_image_edit, true);
  assert.equal(stored.supports_lipsync, true);
});

// Finding 5: the earlier audit's "no jobs/outbox table exists" was wrong. The durable jobs
// foundation has been canonical since migration 001 and hardened by 005 and 018.
test('the durable jobs foundation exists and is hardened, contrary to the stale audit', async () => {
  const reg = await scalar(`select to_regclass('tonde.jobs')::text`);
  assert.ok(reg, 'tonde.jobs exists');
  const columns = (await rows(
    `select column_name from information_schema.columns where table_schema = 'tonde' and table_name = 'jobs'`))
    .map(row => row.column_name);
  for (const column of ['id', 'workspace_id', 'production_id', 'job_type', 'status', 'progress',
    'input_object_id', 'output_object_id', 'input_metadata', 'attempts', 'max_attempts',
    'error_code', 'error_message', 'lease_owner', 'lease_expires_at', 'available_at',
    'requested_by', 'created_at', 'started_at', 'completed_at', 'updated_at']) {
    assert.ok(columns.includes(column), `jobs.${column} exists`);
  }
  const states = (await rows(
    `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'tonde' and t.typname = 'job_state' order by e.enumsortorder`)).map(row => row.enumlabel);
  // Prompt 11 (036) extends the vocabulary deliberately: a claim is a distinct state from execution,
  // work may wait for reconciliation, a cancellation can be requested while a worker holds the job,
  // and a bounded attempt or an exhausted retry is not a vague failure. The 001-018 states keep
  // their order and meaning; the new ones are appended, never interleaved.
  assert.deepEqual(states, ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'retrying',
    'leased', 'waiting', 'cancel_requested', 'timed_out', 'dead_letter']);
  // The claimability index is the worker-queue foundation: claimable work is ordered and partial.
  const claimable = await scalar(
    `select count(*) from pg_indexes where schemaname = 'tonde' and tablename = 'jobs' and indexname = 'jobs_claimable'`);
  assert.equal(Number(claimable), 1);
  // Lease and attempt invariants added by migration 005.
  const checks = Number(await scalar(
    `select count(*) from pg_constraint where conrelid = 'tonde.jobs'::regclass and contype = 'c'`));
  assert.ok(checks >= 6, 'the completion/lease/attempt checks are present');
});

// Finding 4C: ai_creation_surface recomputed readiness up to four times per Shot (a scene
// lateral, the Shot list, and three summary filters). It now evaluates ai_readiness_state exactly
// once per active Shot and reuses that value everywhere, while keeping its document shape.
test('ai_creation_surface evaluates readiness once per Shot and keeps its document shape', async () => {
  const activeShots = Number(await scalar(
    `select count(*) from tonde.shots where workspace_id = $1 and production_id = $2 and lifecycle = 'active'`,
    [wa, production]));
  assert.equal(activeShots, 6);
  // Install a counting wrapper around the private helper before the surface is ever executed in
  // this session, so the surface resolves the wrapper on its first (and only) compilation.
  await db.exec(`
    create table public.correction_readiness_probe(shot_id uuid);
    alter function tonde_private.ai_readiness_state(uuid,uuid,uuid) rename to ai_readiness_state_impl;
    create function tonde_private.ai_readiness_state(target_workspace uuid, target_production uuid, target_shot uuid)
    returns tonde.ai_readiness language plpgsql security definer set search_path = '' as $probe$
    begin
      insert into public.correction_readiness_probe(shot_id) values (target_shot);
      return tonde_private.ai_readiness_state_impl(target_workspace, target_production, target_shot);
    end $probe$;
  `);
  let surface;
  let bulk;
  let calls;
  let bulkCalls;
  try {
    surface = await asEditor(() => scalar('select tonde.ai_creation_surface($1,$2,$3)', [wa, production, null]));
    calls = Number(await scalar('select count(*) from public.correction_readiness_probe'));
    // A large Production: the bound must scale, not merely hold at six.
    await db.exec('delete from public.correction_readiness_probe');
    bulk = await asEditor(() => scalar('select tonde.ai_creation_surface($1,$2,$3)', [wa, bulkProduction, null]));
    bulkCalls = Number(await scalar('select count(*) from public.correction_readiness_probe'));
  } finally {
    await db.exec(`
      drop function tonde_private.ai_readiness_state(uuid,uuid,uuid);
      alter function tonde_private.ai_readiness_state_impl(uuid,uuid,uuid) rename to ai_readiness_state;
      drop table public.correction_readiness_probe;
    `);
  }
  assert.equal(calls, activeShots, 'readiness is evaluated once per active Shot, not four times');
  assert.equal(bulkCalls, BULK_SHOTS, 'the bound holds on a long Production, not only at six Shots');
  assert.equal(bulk.summary.shots, BULK_SHOTS);
  assert.equal(bulk.shots.length, BULK_SHOTS);
  assert.equal(surface.summary.shots, 6);
  assert.equal(surface.shots.length, 6);
  for (const item of surface.shots) assert.ok(typeof item.readiness === 'string' && item.readiness.length > 0);
  for (const key of ['production', 'execution_faces', 'connections', 'models', 'known_models', 'locks',
    'scenes', 'shots', 'summary', 'capabilities']) {
    assert.ok(key in surface, `surface.${key} is present`);
  }
  // After restoring the real helper, the surface still works (a cached plan re-resolves cleanly).
  const again = await asEditor(() => scalar('select tonde.ai_creation_surface($1,$2,$3)', [wa, production, null]));
  assert.equal(again.summary.shots, 6);
  assert.equal(again.summary.shots + bulk.summary.shots, 6 + BULK_SHOTS);
});
