import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 6 Real Production Director persistence (additive migration 016).
// Real embedded PostgreSQL with minimal Supabase platform schemas. This does NOT
// emulate Auth HTTP, Storage HTTP, PostgREST or hosted settings.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, production, scene, shotOne, shotTwo;
let camera, lens50, microLav, light;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };

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
  production = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)',
    [wa, 'Ridgeway coffee', 'commercial']));
  // An exact 30-second Production, as Prompt 4 would have committed it.
  await asEditor(() => db.query('update tonde.productions set planned_duration_ms = 30000 where id = $1', [production]));
  scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)',
    [wa, production, null, JSON.stringify({ title: 'Dark kitchen', purpose: 'Earn attention' })]).then(row => row.scene_id));
  shotOne = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)',
    [wa, production, scene, null, JSON.stringify({ title: 'Establish', duration_ms: 15000 })]).then(row => row.shot_id));
  shotTwo = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)',
    [wa, production, scene, null, JSON.stringify({ title: 'Scale macro', duration_ms: 15000 })]).then(row => row.shot_id));
  // Real Setup, as the creator would have entered it in Setup.
  const resource = (type, name) => asEditor(() => scalar(
    `insert into tonde.production_resources(workspace_id, resource_type, name, metadata)
     values ($1,$2,$3,'{}'::jsonb) returning id`, [wa, type, name]));
  camera = await resource('camera', 'A7C II');
  lens50 = await resource('lens', '50 mm f/1.8');
  microLav = await resource('microphone', 'Lav mic');
  light = await resource('light', 'Amaran 100d');
});

after(async () => { await db?.close(); });

const realPlan = (over = {}) => ({
  plan_status: 'ready', readiness_note: '', complexity: 'quick', complexity_is_estimate: true,
  generated_by: 'deterministic', shot_size: 'medium close-up',
  camera_position: 'eye level, about 2 m from subject', camera_height: 'eye level', camera_angle: 'frontal',
  framing: 'subject left of centre', composition: 'negative space for the label',
  movement: 'locked', movement_purpose: 'Stillness makes the product read as considered.',
  stabilization: 'tripod', capture_fps: '24 fps', delivery_fps: '24 fps', shutter: '1/48 starting point',
  aperture: 'f/2.8-f/4 starting point', iso_range: 'base ISO starting point', white_balance: '3200 K',
  nd_filter: '', exposure_note: 'Adjust for exposure and required depth of field.',
  focus_strategy: 'Manual focus on the label', depth_of_field: 'Enough for the label to stay sharp',
  lighting_intent: 'soft premium beauty', lighting_plan: 'One LED through the softbox at 45 degrees camera left',
  lighting_diagram: { subject: 'Barista', camera: 'eye level', lights: [{ role: 'key', direction: '45 degrees camera left' }] },
  blocking: 'Barista starts at the counter, turns to the camera on the second beat',
  performance: 'Start restrained, hold one beat before the smile arrives',
  product_direction: 'Label faces camera, no hand across the logo', sound_plan: 'Lav on the presenter',
  microphone_plan: 'Lav clipped under the collar', sync_strategy: 'Clap at the head of each take',
  solo_feasibility: 'solo', crew_roles: [], environment_requirements: ['controllable window'],
  location_requirements: ['counter depth for the camera'], safety_notes: ['Keep the LED stand out of the walkway'],
  safety_flags: [], editorial_intent: 'establish', setup_steps: ['Level the tripod', 'Rig the softbox'],
  capture_checklist: ['Battery and media checked', 'Focus verified'],
  expected_duration_ms: 6000, ...over,
});
// resource_id is deliberately absent by default: a requirement only claims an owned
// resource when the test names one.
const requirement = (over = {}) => ({ kind: 'camera', label: 'Primary camera', status: 'owned',
  resource_type: 'camera', epistemic: 'REQUIRED', ...over });
const alternative = (over = {}) => ({ kind: 'fastest', label: 'Fastest', description: 'Static and simple',
  expected_impact: 'Loses the push-in', tradeoffs: ['Less build'], ...over });

const savePlan = (shotId, plan, requirements = [], alternatives = [], expectedShotRevision = null) =>
  asEditor(() => scalar('select tonde.save_real_plan($1,$2,$3,$4,$5,$6,$7,$8)', [wa, production, shotId,
    expectedShotRevision, JSON.stringify(plan), JSON.stringify(requirements), JSON.stringify(alternatives), null]));

const surface = () => asEditor(() => scalar('select tonde.real_execution_surface($1,$2,$3)', [wa, production, null]));
const detail = shotId => asEditor(() => scalar('select tonde.real_shot_detail($1,$2,$3)', [wa, production, shotId]));

test('a Real plan persists with its Setup requirements and practical alternatives', async () => {
  const result = await savePlan(shotOne, realPlan(), [
    requirement({ resource_id: camera }),
    requirement({ kind: 'lens', label: 'Preferred lens', ideal_name: '85 mm', status: 'owned', resource_type: 'lens', resource_id: lens50 }),
    requirement({ kind: 'microphone', label: 'Dialogue mic', status: 'owned', resource_type: 'microphone', resource_id: microLav }),
    requirement({ kind: 'light', label: 'Key light', status: 'owned', resource_type: 'light', resource_id: light }),
  ], [alternative(), alternative({ kind: 'solo', label: 'Fully solo', tradeoffs: [] })]);
  assert.equal(result.readiness, 'ready');
  assert.equal(result.requirements, 4);
  assert.equal(result.alternatives, 2);
  const row = await one('select plan_status, movement, solo_feasibility, expected_duration_ms, generated_by from tonde.execution_plans where id = $1', [result.plan_id]);
  assert.deepEqual(row, { plan_status: 'ready', movement: 'locked', solo_feasibility: 'solo', expected_duration_ms: 6000, generated_by: 'deterministic' });
  const read = await detail(shotOne);
  assert.equal(read.readiness, 'ready');
  assert.equal(read.requirements.length, 4);
  // Each requirement resolves the Setup resource it actually matched.
  const cameraRequirement = read.requirements.find(item => item.requirement_kind === 'camera');
  assert.equal(cameraRequirement.resource_name, 'A7C II');
  assert.equal(cameraRequirement.resource_id, camera);
  assert.equal(read.alternatives.length, 2);
  assert.equal(read.plan.lighting_diagram.lights[0].direction, '45 degrees camera left');
});

test('a Real plan writes the Shot duration so the exact runtime stays authoritative', async () => {
  const before = await one('select planned_duration_ms, revision from tonde.shots where id = $1', [shotOne]);
  assert.notEqual(before.planned_duration_ms, 9000);
  const result = await savePlan(shotOne, realPlan({ expected_duration_ms: 9000 }), [requirement({ resource_id: camera })]);
  const after = await one('select planned_duration_ms, revision from tonde.shots where id = $1', [shotOne]);
  assert.equal(after.planned_duration_ms, 9000);
  assert.ok(after.revision > before.revision);
  // 9000 + 15000 = 24000, so the exact 30 s target is not yet met and says so.
  assert.equal(result.timing.total_ms, 24000);
  assert.equal(result.timing.target_ms, 30000);
  assert.equal(result.timing.status, 'under');
});

test('readiness is derived from explicit requirement facts, never an arbitrary score', async () => {
  // Substitute only.
  await savePlan(shotOne, realPlan({ plan_status: 'ready_with_substitution' }), [
    requirement({ kind: 'lens', label: 'Preferred lens', ideal_name: '85 mm', status: 'substitute',
      resource_type: 'lens', substitute_resource_id: lens50, alternative: 'Use the 50 mm and move the camera closer.' }),
  ]);
  assert.equal((await detail(shotOne)).readiness, 'ready_with_substitution');
  // A missing resource outranks a substitute.
  await savePlan(shotOne, realPlan({ plan_status: 'missing_resource' }), [
    requirement({ kind: 'lens', label: 'Preferred lens', ideal_name: '85 mm', status: 'substitute',
      resource_type: 'lens', substitute_resource_id: lens50 }),
    requirement({ kind: 'light', label: 'Second light', ideal_name: 'Another LED', status: 'missing',
      resource_type: 'light', alternative: 'Bounce the key into the ceiling instead.' }),
  ]);
  assert.equal((await detail(shotOne)).readiness, 'missing_resource');
  // Safety outranks everything.
  await savePlan(shotOne, realPlan({ safety_flags: ['driving-while-filming'], safety_notes: ['Do not film while driving.'] }), [
    requirement({ kind: 'light', label: 'Second light', status: 'missing', resource_type: 'light' }),
  ]);
  const read = await detail(shotOne);
  assert.equal(read.readiness, 'safety_blocked');
  assert.deepEqual(read.plan.safety_flags, ['driving-while-filming']);
  // Unverified Setup is a decision, not a pass.
  await savePlan(shotOne, realPlan(), [requirement({ kind: 'accessory', label: 'Unknown brand light', status: 'unverified', resource_type: 'light' })]);
  assert.equal((await detail(shotOne)).readiness, 'needs_decision');
});

test('a Shot with no Real plan reports unplanned rather than pretending readiness', async () => {
  // The private readiness helper is intentionally unreachable from the API, so this is
  // observed through the public surface rather than by calling it.
  const missing = await failure(() => asEditor(() => scalar(
    'select tonde_private.real_readiness_state($1,$2,$3)', [wa, production, shotTwo])));
  assert.equal(missing.code, '42501');
  const read = await surface();
  const shot = read.shots.find(item => item.shot_id === shotTwo);
  assert.equal(shot.readiness, 'unplanned');
  assert.equal(shot.plan_id, null);
  assert.equal(read.summary.unplanned, 1);
  assert.ok(read.readiness_queue.needs_decision.includes(shotTwo));
});

test('an owned requirement cannot claim ownership without naming the owned resource', async () => {
  const error = await failure(() => savePlan(shotTwo, realPlan(), [
    { kind: 'light', label: 'Key light', status: 'owned', resource_type: 'light' },
  ]));
  assert.equal(error.code, '23514');
});

test('Setup is matched against what the creator actually owns', async () => {
  const read = await detail(shotOne);
  const names = read.setup.map(item => item.name);
  assert.ok(names.includes('A7C II'));
  assert.ok(names.includes('50 mm f/1.8'));
  assert.ok(names.includes('Amaran 100d'));
  // An unowned ideal is never presented as owned.
  await savePlan(shotOne, realPlan({ plan_status: 'ready_with_substitution' }), [
    requirement({ kind: 'lens', label: 'Preferred lens', ideal_name: '85 mm', status: 'substitute',
      resource_type: 'lens', substitute_resource_id: lens50, alternative: '50 mm with the camera moved closer.' }),
  ]);
  const after = await detail(shotOne);
  const lensRow = after.requirements.find(item => item.requirement_kind === 'lens');
  assert.equal(lensRow.ideal_name, '85 mm');
  assert.equal(lensRow.resource_id, null);
  assert.equal(lensRow.status, 'substitute');
  assert.equal(lensRow.substitute_name, '50 mm f/1.8');
});

test('a locked Shot refuses the Real plan and the Director path identically', async () => {
  await asEditor(() => scalar('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)', [wa, production, 'shot', shotTwo, true, null]));
  const error = await failure(() => savePlan(shotTwo, realPlan(), [requirement({ resource_id: camera })]));
  assert.equal(error.code, '23514');
  assert.match(error.message, /locked/i);
  const capture = await failure(() => asEditor(() => scalar('select tonde.set_shot_capture_state($1,$2,$3,$4,$5,$6)',
    [wa, production, shotTwo, 'captured', '', null])));
  assert.equal(capture.code, '23514');
  await asEditor(() => scalar('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)', [wa, production, 'shot', shotTwo, false, null]));
});

test('editing an approved Real plan stops claiming approval', async () => {
  await savePlan(shotOne, realPlan({ expected_duration_ms: null }), [requirement({ resource_id: camera })]);
  const approved = await asEditor(() => scalar('select tonde.set_real_plan_approval($1,$2,$3,$4,$5)',
    [wa, production, shotOne, 'approved', null]));
  assert.equal(approved.approval, 'approved');
  const changed = await savePlan(shotOne, realPlan({ lighting_intent: 'hard side light', expected_duration_ms: null }), [requirement({ resource_id: camera })]);
  assert.equal(changed.approval, 'changed_after_approval');
  const read = await detail(shotOne);
  assert.equal(read.plan.approval, 'changed_after_approval');
  assert.equal(read.plan.lighting_intent, 'hard side light');
  // Re-approving a version that was changed is a creator decision and is allowed.
  const again = await asEditor(() => scalar('select tonde.set_real_plan_approval($1,$2,$3,$4,$5)',
    [wa, production, shotOne, 'approved', null]));
  assert.equal(again.approval, 'approved');
});

test('approval cannot be smuggled in with unreviewed content', async () => {
  await savePlan(shotOne, realPlan({ expected_duration_ms: null }), [requirement({ resource_id: camera })]);
  await asEditor(() => scalar('select tonde.set_real_plan_approval($1,$2,$3,$4,$5)', [wa, production, shotOne, 'needs_review', null]));
  // Approving and changing content in one statement does not approve unseen work.
  const smuggled = await failure(() => asEditor(() => db.query(
    "update tonde.execution_plans set approval = 'approved', lighting_intent = 'unreviewed' where shot_id = $1 and execution_method = 'real'",
    [shotOne])));
  assert.equal(smuggled.code, '23514');
  // Editing an already-approved plan is allowed but stops claiming approval.
  await asEditor(() => scalar('select tonde.set_real_plan_approval($1,$2,$3,$4,$5)', [wa, production, shotOne, 'approved', null]));
  await asEditor(() => db.query(
    "update tonde.execution_plans set approval = 'approved', lighting_intent = 'quietly changed' where shot_id = $1 and execution_method = 'real'",
    [shotOne]));
  const after = await one('select approval from tonde.execution_plans where shot_id = $1 and execution_method = $2', [shotOne, 'real']);
  assert.equal(after.approval, 'changed_after_approval');
});

test('a stale Shot revision is a conflict, not a silent overwrite', async () => {
  const current = await one('select revision from tonde.shots where id = $1', [shotOne]);
  const error = await failure(() => savePlan(shotOne, realPlan(), [requirement({ resource_id: camera })], [], current.revision - 1));
  assert.equal(error.code, 'PT409');
});

test('Takes are numbered, exclusive when preferred, and removable', async () => {
  const first = await asEditor(() => scalar('select tonde.save_shot_take($1,$2,$3,$4,$5)', [wa, production, shotOne,
    JSON.stringify({ take_number: 1, status: 'recorded', notes: 'First pass' }), null]));
  assert.equal(first.take_number, 1);
  const second = await asEditor(() => scalar('select tonde.save_shot_take($1,$2,$3,$4,$5)', [wa, production, shotOne,
    JSON.stringify({ take_number: 2, status: 'preferred', notes: 'Better energy' }), null]));
  assert.equal(second.preferred, true);
  // A Take that was never preferred keeps its own status rather than being invented as good.
  const firstRow = await one('select status from tonde.shot_takes where shot_id = $1 and take_number = 1', [shotOne]);
  assert.equal(firstRow.status, 'recorded');
  // Preferring Take 1 now releases Take 2: the database upholds one preferred Take.
  await asEditor(() => scalar('select tonde.save_shot_take($1,$2,$3,$4,$5)', [wa, production, shotOne,
    JSON.stringify({ take_number: 1, status: 'preferred', notes: 'Use this one' }), null]));
  const demoted = await one('select status from tonde.shot_takes where shot_id = $1 and take_number = 2', [shotOne]);
  assert.equal(demoted.status, 'good');
  const read = await detail(shotOne);
  assert.equal(read.takes.length, 2);
  assert.equal(read.takes.filter(take => take.preferred).length, 1);
  assert.equal(read.takes.find(take => take.preferred).take_number, 1);
  // Recording the same number again updates rather than duplicating.
  await asEditor(() => scalar('select tonde.save_shot_take($1,$2,$3,$4,$5)', [wa, production, shotOne,
    JSON.stringify({ take_number: 1, status: 'unusable', notes: 'Boom in frame' }), null]));
  assert.equal((await detail(shotOne)).takes.length, 2);
  const beforeDelete = await detail(shotOne);
  const removed = await asEditor(() => scalar('select tonde.delete_shot_take($1,$2,$3,$4)',
    [wa, production, shotOne, beforeDelete.takes[0].id]));
  assert.ok(removed.take_id);
  assert.equal((await detail(shotOne)).takes.length, 1);
});

test('capture state records progress without equating captured and approved', async () => {
  const setup = await asEditor(() => scalar('select tonde.set_shot_capture_state($1,$2,$3,$4,$5,$6)',
    [wa, production, shotOne, 'setup', 'Rigging the tripod', null]));
  assert.equal(setup.status, 'setup');
  const captured = await asEditor(() => scalar('select tonde.set_shot_capture_state($1,$2,$3,$4,$5,$6)',
    [wa, production, shotOne, 'captured', '', setup.revision]));
  assert.equal(captured.status, 'captured');
  assert.ok(captured.captured_at);
  const stale = await failure(() => asEditor(() => scalar('select tonde.set_shot_capture_state($1,$2,$3,$4,$5,$6)',
    [wa, production, shotOne, 'pickup_needed', '', setup.revision])));
  assert.equal(stale.code, 'PT409');
  const read = await detail(shotOne);
  assert.equal(read.capture.status, 'captured');
  // Capture is not approval: the plan keeps its own approval state.
  assert.notEqual(read.capture.status, 'approved');
  const shotRow = await one('select approval from tonde.shots where id = $1', [shotOne]);
  assert.equal(shotRow.approval, 'draft');
  const pickup = await asEditor(() => scalar('select tonde.set_shot_capture_state($1,$2,$3,$4,$5,$6)',
    [wa, production, shotTwo, 'pickup_needed', 'Reshoot once the light is back', null]));
  assert.equal(pickup.status, 'pickup_needed');
  const queue = (await surface()).readiness_queue;
  assert.ok(queue.pickup_required.includes(shotTwo));
});

test('a field deviation records what actually happened without destroying the plan', async () => {
  const planned = (await detail(shotOne)).plan.movement;
  const deviation = await asEditor(() => scalar('select tonde.record_shot_deviation($1,$2,$3,$4)',
    [wa, production, shotOne, JSON.stringify({ field: 'movement', planned_value: 'gimbal push-in',
      actual_value: 'handheld static close-up', reason: 'Gimbal battery died' })]));
  assert.equal(deviation.field, 'movement');
  const read = await detail(shotOne);
  assert.equal(read.deviations.length, 1);
  assert.equal(read.deviations[0].planned_value, 'gimbal push-in');
  assert.equal(read.plan.movement, planned, 'the original plan is unchanged');
  const unsupported = await failure(() => asEditor(() => scalar('select tonde.record_shot_deviation($1,$2,$3,$4)',
    [wa, production, shotOne, JSON.stringify({ field: 'vibes' })])));
  assert.equal(unsupported.code, '22023');
});

test('another workspace cannot read or change this Real production', async () => {
  const read = await failure(() => asUser(B, () => scalar('select tonde.real_execution_surface($1,$2,$3)', [wa, production, null])));
  assert.equal(read.code, '42501');
  const plan = await failure(() => asUser(B, () => scalar('select tonde.save_real_plan($1,$2,$3,$4,$5,$6,$7,$8)',
    [wa, production, shotOne, null, JSON.stringify(realPlan()), '[]', '[]', null])));
  assert.equal(plan.code, '42501');
  const take = await failure(() => asUser(B, () => scalar('select tonde.save_shot_take($1,$2,$3,$4,$5)',
    [wa, production, shotOne, JSON.stringify({ take_number: 9 }), null])));
  assert.equal(take.code, '42501');
  const deviation = await failure(() => asUser(B, () => scalar('select tonde.record_shot_deviation($1,$2,$3,$4)',
    [wa, production, shotOne, JSON.stringify({ field: 'other' })])));
  assert.equal(deviation.code, '42501');
  // B is a member of its own workspace, so the refusal is membership, not a missing row:
  // asking for a Production in its own workspace that does not exist is a not-found.
  const notFound = await failure(() => asUser(B, () =>
    scalar('select tonde.real_execution_surface($1,$2,$3)', [wb, production, null])));
  assert.equal(notFound.code, 'P0002');
});

test('a Production-level rollup reports gaps and crew without a fake readiness score', async () => {
  const read = await surface();
  assert.equal(read.summary.shots, 2);
  assert.equal(read.summary.planned, 1);
  assert.ok(read.summary.missing_resource + read.summary.needs_decision + read.summary.ready
    + read.summary.ready_with_substitution + read.summary.safety_blocked + read.summary.unplanned === 2);
  assert.equal(typeof read.summary.captured, 'number');
  assert.ok(Array.isArray(read.summary.crew_roles));
  assert.ok(Array.isArray(read.summary.safety_flags));
  assert.equal(read.scenes.length, 1);
  assert.equal(read.scenes[0].shots, 2);
  assert.ok(Array.isArray(read.setup));
  assert.equal(read.timing.target_ms, 30000);
  assert.ok(!('readiness_score' in read.summary));
});

test('Real execution RPCs are executable by authenticated members only', async () => {
  const signatures = [
    'real_execution_surface(uuid,uuid,integer)', 'real_shot_detail(uuid,uuid,uuid)',
    'save_real_plan(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,uuid)',
    'set_real_plan_approval(uuid,uuid,uuid,text,integer)', 'set_real_plan_lock(uuid,uuid,uuid,boolean,integer)',
    'set_shot_capture_state(uuid,uuid,uuid,text,text,integer)', 'save_shot_take(uuid,uuid,uuid,jsonb,integer)',
    'delete_shot_take(uuid,uuid,uuid,uuid)', 'record_shot_deviation(uuid,uuid,uuid,jsonb)'];
  for (const signature of signatures) {
    const row = await one(`select has_function_privilege('authenticated', 'tonde.${signature}', 'execute') as member_can,
      has_function_privilege('anon', 'tonde.${signature}', 'execute') as anon_can`);
    assert.equal(row.member_can, true, signature);
    assert.equal(row.anon_can, false, signature);
  }
  for (const signature of ['real_setup_inventory(uuid)', 'real_readiness_state(uuid,uuid,uuid)',
    'real_requirement_rollup(uuid,uuid)', 'real_plan_document(uuid,uuid,uuid)',
    'json_text_array(jsonb,text)', 'json_text(jsonb,text,integer)']) {
    const row = await one(`select has_function_privilege('authenticated', 'tonde_private.${signature}', 'execute') as member_can`);
    assert.equal(row.member_can, false, signature);
  }
  const anonDenied = await failure(async () => {
    await db.exec('begin; set local role anon;');
    try { await db.query('select tonde.real_execution_surface($1,$2,$3)', [wa, production, null]); }
    finally { await db.exec('rollback'); }
  });
  assert.equal(anonDenied.code, '42501');
});

test('the new Real tables enforce row-level security through membership, not trust', async () => {
  const planId = (await detail(shotOne)).plan.plan_id;
  const freshShot = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)',
    [wa, production, scene, null, JSON.stringify({ title: 'Cutaway', duration_ms: 2000 })]).then(row => row.shot_id));
  // Every row below is fully valid, so the only thing that can refuse it is the policy.
  const inserts = {
    real_plan_requirements: [`insert into tonde.real_plan_requirements(workspace_id, production_id, shot_id, plan_id, requirement_kind, label, status) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [wa, production, freshShot, planId, 'light', 'Cross-workspace light', 'missing']],
    real_plan_alternatives: [`insert into tonde.real_plan_alternatives(workspace_id, production_id, shot_id, plan_id, kind, label) values ($1,$2,$3,$4,$5,$6) returning id`,
      [wa, production, freshShot, planId, 'safest', 'Cross-workspace option']],
    shot_capture_state: [`insert into tonde.shot_capture_state(workspace_id, production_id, shot_id, status) values ($1,$2,$3,$4) returning id`,
      [wa, production, freshShot, 'captured']],
    shot_takes: [`insert into tonde.shot_takes(workspace_id, production_id, shot_id, take_number) values ($1,$2,$3,$4) returning id`,
      [wa, production, freshShot, 1]],
    shot_deviations: [`insert into tonde.shot_deviations(workspace_id, production_id, shot_id, field) values ($1,$2,$3,$4) returning id`,
      [wa, production, freshShot, 'other']],
  };
  for (const [table, [sql, args]] of Object.entries(inserts)) {
    const rls = await scalar(`select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tonde' and c.relname = '${table}'`);
    assert.equal(rls, true, table);
    const policies = await scalar(`select count(*) from pg_policies where schemaname = 'tonde' and tablename = '${table}'`);
    assert.ok(policies >= 3, `${table} has ${policies} policies`);
    const denied = await failure(() => asUser(B, () => scalar(sql, args)));
    assert.equal(denied.code, '42501', `${table} allowed a cross-workspace insert (${denied.code}: ${denied.message})`);
    // The same row is accepted for a member of the owning workspace, so the policy is
    // what refused it rather than a constraint.
    const allowed = await asEditor(() => scalar(sql, args));
    assert.ok(allowed, `${table} refused a legitimate insert`);
  }
});

test('the manual hosted-apply verification query reports every Real object present', async () => {
  const sql = await readFile('supabase/manual-apply/07_verify.sql', 'utf8');
  const rows = (await db.query(sql)).rows;
  assert.ok(rows.length > 0, 'the verification query returned no rows');
  const missing = rows.filter(row => row.result !== 'OK').map(row => `${row.kind} ${row.name}`);
  assert.deepEqual(missing, [], `objects missing after the migration chain: ${missing.join(', ')}`);
});
