import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 11 packet 040 — device and lens intelligence, scene intelligence and the camera settings
// engine, on real embedded PostgreSQL over one 001->040 stack. These tests pin the laws the migration
// claims: capability is declared with its source and verified by a person as a separate, recorded act;
// a verified limit that changes loses its verification instead of silently keeping it; the engine is
// deterministic arithmetic over declared limits and a stated intent, so the same inputs are one
// proposal; where the equipment cannot hold the intent the engine names the exact limit it hit instead
// of inventing a number; neutral density without a measured scene exposure is reported as not
// determined; accepting settings is the creator's decision and is what writes into the real execution
// plan; a scene requirement is recorded with its source and can only be waived with a reason; scene
// intelligence and readiness report the gaps rather than assuming they are covered; and all of it is
// tenant-isolated with no write surface for a plain client.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';
let wa, wb;
let camFull, camLimits, camFresh, lens50, lensTight, lensOther;
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
const asAdmin = action => asUser(D, action);
const asStranger = action => asUser(B, action);

const newProduction = label => asOwner(async () => {
  const project = await scalar("insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id", [wa, `Probe ${label}`, A]);
  const production = await scalar("insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id", [wa, project, `Probe Production ${label}`, A]);
  return { project, production };
});
let ordering = 0;
const newShot = (production, label, withPlan = true) => asOwner(async () => {
  const order = () => (++ordering) * 1024;
  const scene = await scalar("insert into tonde.scenes(workspace_id,production_id,title,sort_order) values($1,$2,$3,$4) returning id", [wa, production, `Scene ${label}`, order()]);
  const shot = await scalar("insert into tonde.shots(workspace_id,production_id,scene_id,title,sort_order) values($1,$2,$3,$4,$5) returning id", [wa, production, scene, `Shot ${label}`, order()]);
  const plan = withPlan
    ? await scalar("insert into tonde.execution_plans(workspace_id,production_id,shot_id,execution_method) values($1,$2,$3,'real') returning id", [wa, production, shot])
    : null;
  return { scene, shot, plan };
});
const newResource = (type, name, mount = null) => asOwner(() => scalar(
  'insert into tonde.production_resources(workspace_id,resource_type,name,mount) values($1,$2,$3,$4) returning id',
  [wa, type, name, mount]));

const declareDevice = (resource, facts, over = {}) => asUser(over.user ?? A, () => rows(
  'select tonde.device_capability_declare($1,$2,$3,$4,$5,$6) as result',
  [over.workspace ?? wa, resource, JSON.stringify(facts), over.source ?? 'creator', over.sourceLabel ?? null,
   over.notes ?? null]).then(result => result[0].result));
const declareLens = (resource, facts, over = {}) => asUser(over.user ?? A, () => rows(
  'select tonde.lens_capability_declare($1,$2,$3,$4,$5,$6) as result',
  [over.workspace ?? wa, resource, JSON.stringify(facts), over.source ?? 'creator', over.sourceLabel ?? null,
   over.notes ?? null]).then(result => result[0].result));
const verifyCapability = (resource, note = 'Checked against the manual', user = D) => asUser(user, () => rows(
  'select tonde.device_capability_verify($1,$2,$3) as result', [wa, resource, note])
  .then(result => result[0].result));
const propose = (camera, lens, intent, over = {}) => asUser(over.user ?? A, () => rows(
  'select tonde.camera_settings_propose($1,$2,$3,$4,$5,$6) as result',
  [over.workspace ?? wa, over.production, over.shot, camera, lens, JSON.stringify(intent)])
  .then(result => result[0].result));
const decide = (proposal, decision, note = '', user = A) => asUser(user, () => rows(
  'select tonde.camera_settings_decide($1,$2,$3,$4) as result', [wa, proposal, decision, note])
  .then(result => result[0].result));
const addRequirement = (over = {}) => asUser(over.user ?? A, () => rows(
  'select tonde.scene_requirement_add($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [over.workspace ?? wa, over.production, over.kind ?? 'lighting', over.detail ?? 'A probe requirement',
   over.scene ?? null, over.shot ?? null, over.mandatory ?? true, over.source ?? 'creator'])
  .then(result => result[0].result));
const settle = (requirement, state, note = '', user = A) => asUser(user, () => rows(
  'select tonde.scene_requirement_settle($1,$2,$3,$4) as result', [wa, requirement, state, note])
  .then(result => result[0].result));
const intelligence = (production, scene = null, user = A) => asUser(user, () => rows(
  'select tonde.scene_intelligence($1,$2,$3) as result', [wa, production, scene])
  .then(result => result[0].result));
const readiness = (production, user = A) => asUser(user, () => rows(
  'select tonde.device_readiness($1,$2) as result', [wa, production]).then(result => result[0].result));
const reasons = proposal => proposal.refusals.map(refusal => refusal.reason);
const constraintDef = async (table, needle) => {
  const found = (await rows(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = ('tonde.' || $1)::regclass and contype = 'c'`, [table])).map(row => row.def)
    .filter(def => def.includes(needle));
  assert.equal(found.length, 1, `expected exactly one check constraint mentioning ${needle} on tonde.${table}`);
  return found[0];
};
const listed = def => [...def.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();

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
  // A workspace with an owner, a plain editor and a second admin, so the tests can tell editing
  // authority apart from verification authority.
  await asService(async () => {
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')", [wa, C]);
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'admin')", [wa, D]);
  });
  camFull = await newResource('camera', 'Probe camera A', 'EF');
  camLimits = await newResource('camera', 'Probe camera B', 'EF');
  camFresh = await newResource('camera', 'Probe camera C', 'EF');
  lens50 = await newResource('lens', 'Probe 50mm', 'EF');
  lensTight = await newResource('lens', 'Probe tight lens', 'EF');
  lensOther = await newResource('lens', 'Probe other mount lens', 'M42');
  // The camera the satisfied intent is built against: short shutter, wide ISO range, four stops of ND.
  await declareDevice(camFull, { device_kind: 'camera', sensor_format: 'Super 35', crop_factor: 1.5,
    resolution_modes: ['4K', '1080p'], frame_rates: [24, 25, 30, 60], max_frame_rate: 60,
    codecs: ['prores', 'h264'], mounts: ['EF'], stabilization: 'optical', nd_stops: 4,
    iso_min: 100, iso_max: 6400, shutter_min_seconds: 0.000125 }, { source: 'manufacturer', sourceLabel: 'Probe manual' });
  // A deliberately narrow camera: a slow shortest shutter, a low ISO ceiling and two stops of ND.
  await declareDevice(camLimits, { device_kind: 'camera', sensor_format: '1 inch', crop_factor: 2.7,
    resolution_modes: ['1080p'], frame_rates: [24, 25], max_frame_rate: 25, codecs: ['h264'], mounts: ['EF'],
    nd_stops: 2, iso_min: 100, iso_max: 400, shutter_min_seconds: 0.04 });
  await declareDevice(camFresh, { crop_factor: 1, mounts: ['EF'], frame_rates: [24, 30], max_frame_rate: 30,
    codecs: ['prores'], resolution_modes: ['4K'], iso_min: 100, iso_max: 3200, nd_stops: 3,
    shutter_min_seconds: 0.0001 });
  await declareLens(lens50, { mount: 'EF', focal_min_mm: 50, focal_max_mm: 50, max_aperture: 1.8,
    min_aperture: 22, image_circle_mm: 43.3, min_focus_m: 0.45, stabilization: 'none' });
  await declareLens(lensTight, { mount: 'EF', focal_min_mm: 24, focal_max_mm: 70, max_aperture: 2.8,
    min_aperture: 22, image_circle_mm: 25 });
  await declareLens(lensOther, { mount: 'M42', focal_min_mm: 50, focal_max_mm: 50, max_aperture: 2,
    min_aperture: 16, image_circle_mm: 43.3 });
  // The workspace admin verifies the main camera, so the tests can tell a verified capability from a
  // declared one in the engine's output and in the readiness read.
  await verifyCapability(camFull);
});

after(async () => { await db?.close(); });

test('the device and scene vocabulary is a closed set and a client has no write surface', async () => {
  for (const table of ['device_capabilities', 'lens_capabilities', 'scene_requirements', 'camera_settings_proposals']) {
    assert.equal(Number(await scalar(`select count(*) from pg_tables where schemaname='tonde' and tablename=$1`, [table])), 1);
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid = ('tonde.' || $1)::regclass`, [table]), true);
    assert.equal(await scalar(`select has_table_privilege('authenticated', 'tonde.' || $1, 'SELECT')`, [table]), true);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await scalar(`select has_table_privilege('authenticated', 'tonde.' || $1, $2)`, [table, privilege]),
        false, `authenticated must not hold ${privilege} on tonde.${table}`);
    }
  }
  assert.deepEqual(listed(await constraintDef('device_capabilities', 'phone_camera')),
    ['action_camera', 'camera', 'drone', 'other', 'phone_camera']);
  assert.deepEqual(listed(await constraintDef('scene_requirements', 'time_of_day')),
    ['audio', 'cast', 'environment', 'framing', 'lighting', 'location', 'movement', 'permission', 'prop',
     'safety', 'time_of_day', 'wardrobe']);
  assert.deepEqual(listed(await constraintDef('camera_settings_proposals', 'rejected')),
    ['accepted', 'proposed', 'rejected', 'superseded']);
  // A satisfied proposal cannot carry a refusal, and a refusal cannot be hidden behind the flag.
  assert.match(await constraintDef('camera_settings_proposals', 'jsonb_array_length'),
    /satisfied.*jsonb_array_length/);
  // The frame-rate ceiling is a scalar check: a CHECK may not contain a subquery.
  assert.equal(Number(await scalar(`select count(*) from pg_constraint where conrelid='tonde.device_capabilities'::regclass
    and conname='device_rates_bounded'`)), 1);
  const illegal = await failure(() => asService(() => db.query(
    `insert into tonde.device_capabilities(resource_id,workspace_id,device_kind,sensor_format,crop_factor,
      frame_rates,max_frame_rate) values($1,$2,'camera','Probe',1,'{24,25}',60)`, [camFresh, wa])));
  assert.match(illegal.message, /device_rates_bounded|check constraint/i);
  // The engine's private arithmetic is not callable by a client, and the public reads are.
  assert.equal(await scalar(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p
    where p.pronamespace = 'tonde_private'::regnamespace and p.proname = 'guard_camera_settings'`), false);
  assert.equal(await scalar(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p
    where p.pronamespace = 'tonde_private'::regnamespace and p.proname = 'exposure_ev'`), false);
  assert.equal(await scalar(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p
    where p.pronamespace = 'tonde'::regnamespace and p.proname = 'camera_settings_propose'`), true);
});

test('capability is declared with its source and read back as declared, not as fact', async () => {
  const declared = await declareDevice(camFresh, { crop_factor: 1, mounts: ['EF'], frame_rates: [24, 30],
    max_frame_rate: 30, iso_max: 3200 }, { source: 'manufacturer', sourceLabel: 'https://example.invalid/spec' });
  assert.equal(declared.capability_state, 'declared');
  assert.equal(declared.replaced_existing_declaration, true);
  assert.equal(declared.verification_withdrawn, false);
  assert.equal(Number(declared.sensor_diagonal_mm), 43.27);
  assert.equal(Number(declared.crop_factor), 1);
  assert.match(declared.meaning, /declared/);
  // Redecorating the same resource replaces the declaration rather than duplicating it.
  const again = await declareDevice(camFresh, { crop_factor: 1, mounts: ['EF'] });
  assert.equal(again.replaced_existing_declaration, true);
  assert.equal(Number(await scalar('select count(*) from tonde.device_capabilities where resource_id = $1', [camFresh])), 1);
  assert.equal(await scalar('select verified_at is null from tonde.device_capabilities where resource_id = $1', [camFresh]), true);
  const lens = await declareLens(lens50, { mount: 'EF', focal_min_mm: 50, focal_max_mm: 50, max_aperture: 1.8,
    min_aperture: 22, image_circle_mm: 43.3 });
  assert.deepEqual(lens.focal_range.map(Number), [50, 50]);
  assert.equal(lens.capability_state, 'declared');
  // A named source that is not the creator's own claim must say which label it is.
  const unnamed = await failure(() => asService(() => db.query(
    `insert into tonde.device_capabilities(resource_id,workspace_id,device_kind,sensor_format,crop_factor,source)
      values($1,$2,'camera','Probe',1,'manufacturer')`, [lens50, wa])));
  assert.match(unnamed.message, /device_source_is_named|check constraint/i);
});

test('verification is a separate admin act, and a changed verified limit loses its verification', async () => {
  const editorRefused = await failure(() => verifyCapability(camFresh, 'Editor tried to verify', C));
  assert.equal(editorRefused.code, '42501');
  assert.match(editorRefused.message, /review authority/i);
  const verified = await verifyCapability(camFresh, 'Compared against the manufacturer sheet');
  assert.equal(verified.capability_state, 'verified');
  assert.equal(verified.verified_by, D);
  assert.equal(await scalar('select verified_by = $2 from tonde.device_capabilities where resource_id = $1', [camFresh, D]), true);
  // A declaration that changes a limit withdraws the verification instead of inheriting it, and it stays
  // correctable.
  const changed = await declareDevice(camFresh, { crop_factor: 1, mounts: ['EF'], iso_max: 1600 });
  assert.equal(changed.verification_withdrawn, true);
  assert.equal(changed.capability_state, 'declared');
  assert.equal(await scalar('select verified_at is null and verified_by is null from tonde.device_capabilities where resource_id = $1', [camFresh]), true);
  // Re-declaring the same facts keeps the verification that is still true.
  await verifyCapability(camFresh, 'Verified again');
  const unchanged = await declareDevice(camFresh, { crop_factor: 1, mounts: ['EF'], iso_max: 1600 });
  assert.equal(unchanged.verification_withdrawn, false);
  assert.equal(unchanged.capability_state, 'verified');
  // A client cannot reach around the guard: the table has no write surface at all.
  const direct = await failure(() => asAdmin(() => db.query(
    'update tonde.device_capabilities set verified_at = now() where resource_id = $1', [camFull])));
  assert.match(direct.message, /permission denied/);
});

test('capability cannot be invented, and the wrong resource kind is refused', async () => {
  const missing = await failure(() => declareDevice('00000000-0000-4000-8000-999999999999', { crop_factor: 1 }));
  assert.match(missing.message, /does not exist/);
  const lensAsDevice = await failure(() => declareDevice(lens50, { crop_factor: 1 }));
  assert.match(lensAsDevice.message, /lens capability/i);
  const cameraAsLens = await failure(() => declareLens(camFull, { mount: 'EF', focal_min_mm: 50, focal_max_mm: 50,
    max_aperture: 2 }));
  assert.match(cameraAsLens.message, /lens resource/i);
  const badSource = await failure(() => declareDevice(camFresh, { crop_factor: 1 }, { source: 'vibes' }));
  assert.match(badSource.message, /where it came from/i);
  const notAnObject = await failure(() => asOwner(() => rows(
    'select tonde.device_capability_declare($1,$2,$3,$4,$5,$6) as result', [wa, camFresh, '[]', 'creator', null, null])));
  assert.match(notAnObject.message, /declared as an object/i);
  const undeclared = await newResource('lens', 'Probe undeclared lens', 'EF');
  const unknownToVerify = await failure(() => verifyCapability(undeclared));
  assert.equal(unknownToVerify.code, 'PT409');
  assert.match(unknownToVerify.message, /no declared capability/);
});

test('an undeclared capability is refused rather than guessed at', async () => {
  const made = await newProduction('missing-capability');
  const { shot } = await newShot(made.production, 'missing-capability');
  const production = made.production;
  const noCamera = await failure(() => propose('00000000-0000-4000-8000-999999999999', null, {}, { production, shot }));
  assert.equal(noCamera.code, 'PT409');
  assert.match(noCamera.message, /CAPABILITY_MISSING/);
  const noLens = await failure(() => propose(camFull, '00000000-0000-4000-8000-999999999999', {}, { production, shot }));
  assert.equal(noLens.code, 'PT409');
  assert.match(noLens.message, /LENS_CAPABILITY_MISSING/);
  const noShot = await failure(() => propose(camFull, lens50, {}, { production, shot: '00000000-0000-4000-8000-999999999999' }));
  assert.match(noShot.message, /shot does not exist/i);
});

test('the engine is deterministic: the same intent against the same capability is one proposal', async () => {
  const { production } = await newProduction('deterministic');
  const { shot } = await newShot(production, 'deterministic');
  const intent = { frame_rate: 24, aperture: 2.8, iso: 400, resolution: '4K', codec: 'prores', focal_mm: 50 };
  const first = await propose(camFull, lens50, intent, { production, shot });
  const second = await propose(camFull, lens50, intent, { production, shot });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.proposal_id, first.proposal_id);
  assert.equal(first.satisfied, true);
  assert.deepEqual(first.refusals, []);
  assert.equal(first.capability_state, 'verified');
  assert.equal(Number(first.settings.frame_rate), 24);
  assert.equal(Number(first.settings.shutter_seconds), 0.020833);
  assert.equal(Number(first.settings.iso), 400);
  assert.equal(Number(first.settings.aperture), 2.8);
  assert.equal(first.settings.resolution, '4K');
  assert.equal(first.settings.codec, 'prores');
  assert.equal(first.settings.nd_stops, null);
  assert.equal(first.basis.frame_rate.includes('Requested') || first.basis.frame_rate.includes('supported'), true);
  assert.equal(Number(await scalar('select count(*) from tonde.camera_settings_proposals where workspace_id = $1', [wa])) >= 1, true);
  // A different intent is a different proposal, and the defaults are declared as defaults.
  const defaults = await propose(camFull, lens50, {}, { production, shot });
  assert.equal(defaults.idempotent, false);
  assert.notEqual(defaults.proposal_id, first.proposal_id);
  assert.equal(Number(defaults.settings.frame_rate), 24);
  assert.equal(Number(defaults.settings.shutter_angle), 180);
  assert.equal(Number(defaults.settings.iso), 100);
  assert.equal(Number(defaults.settings.aperture), 1.8);
  assert.match(defaults.basis.frame_rate, /24p default/);
  assert.match(defaults.basis.shutter_seconds, /180 degree default/);
  assert.match(defaults.basis.iso, /base sensitivity/);
  assert.match(defaults.basis.aperture, /wide open/);
});

test('a camera that cannot hold the intent refuses with the limit it hit', async () => {
  const { production } = await newProduction('device-refusals');
  const { shot } = await newShot(production, 'device-refusals');
  const tooFast = await propose(camLimits, lens50, { frame_rate: 24 }, { production, shot });
  assert.equal(tooFast.satisfied, false);
  assert.deepEqual(reasons(tooFast), ['SHUTTER_TOO_FAST']);
  assert.equal(Number(tooFast.refusals[0].limit), 0.04);
  // Every limit the combination hits is reported, not just the first one.
  const frames = await propose(camLimits, lens50, { frame_rate: 60 }, { production, shot });
  assert.deepEqual(reasons(frames), ['FRAME_RATE_UNSUPPORTED', 'SHUTTER_TOO_FAST']);
  assert.equal(Number(frames.refusals[0].limit), 25);
  const oddRate = await propose(camLimits, lens50, { frame_rate: 23.976, shutter_angle: 360 }, { production, shot });
  assert.deepEqual(reasons(oddRate), ['FRAME_RATE_UNSUPPORTED']);
  assert.deepEqual(oddRate.refusals[0].limit, [24, 25]);
  const sensitivity = await propose(camLimits, lens50, { frame_rate: 24, shutter_angle: 360, iso: 3200 }, { production, shot });
  assert.equal(reasons(sensitivity).includes('INSUFFICIENT_SENSITIVITY'), true);
  assert.equal(Number(sensitivity.refusals.find(refusal => refusal.reason === 'INSUFFICIENT_SENSITIVITY').limit), 400);
  assert.equal(Number(sensitivity.settings.iso), 400);
  const resolution = await propose(camLimits, lens50, { frame_rate: 24, shutter_angle: 360, resolution: '8K' }, { production, shot });
  assert.deepEqual(reasons(resolution), ['RESOLUTION_UNSUPPORTED']);
  assert.match(resolution.basis.shutter_seconds, /360 degree shutter/);
  const codec = await propose(camLimits, lens50, { frame_rate: 24, shutter_angle: 360, codec: 'h265' }, { production, shot });
  assert.deepEqual(reasons(codec), ['CODEC_UNSUPPORTED']);
  const refusedAngle = await failure(() => propose(camLimits, lens50, { shutter_angle: 400 }, { production, shot }));
  assert.match(refusedAngle.message, /shutter angle/i);
  const refusedLight = await failure(() => propose(camLimits, lens50, { lighting: 'moody' }, { production, shot }));
  assert.match(refusedLight.message, /lighting level/i);
});

test('a lens that cannot mount, cover or reach the intent refuses with the limit it hit', async () => {
  const { production } = await newProduction('lens-refusals');
  const { shot } = await newShot(production, 'lens-refusals');
  const mount = await propose(camFull, lensOther, {}, { production, shot });
  assert.equal(mount.satisfied, false);
  assert.equal(reasons(mount).includes('MOUNT_MISMATCH'), true);
  assert.deepEqual(mount.refusals.find(refusal => refusal.reason === 'MOUNT_MISMATCH').limit, ['EF']);
  const circle = await propose(camFull, lensTight, {}, { production, shot });
  assert.equal(reasons(circle).includes('IMAGE_CIRCLE_TOO_SMALL'), true);
  assert.equal(Number(circle.refusals[0].required_mm), 28.84);
  assert.equal(Number(circle.refusals[0].limit), 25);
  const wide = await propose(camFull, lens50, { aperture: 1.2 }, { production, shot });
  assert.deepEqual(reasons(wide), ['APERTURE_UNAVAILABLE']);
  assert.match(wide.refusals[0].limit, /f\/1\.8$/);
  assert.equal(Number(wide.settings.aperture), 1.8);
  const closed = await propose(camFull, lens50, { aperture: 32 }, { production, shot });
  assert.deepEqual(reasons(closed), ['APERTURE_UNAVAILABLE']);
  assert.match(closed.refusals[0].limit, /f\/22\.0$/);
  assert.equal(Number(closed.settings.aperture), 22);
  const reach = await propose(camFull, lens50, { focal_mm: 85 }, { production, shot });
  assert.deepEqual(reasons(reach), ['FOCAL_LENGTH_UNAVAILABLE']);
  assert.equal(reach.refusals[0].limit, '50.00-50.00 mm');
  // Without a lens there is nothing to check the image circle or the aperture against, and the engine
  // says so rather than pretending the value is supported.
  const noLens = await propose(camFull, null, { aperture: 4 }, { production, shot });
  assert.equal(noLens.satisfied, true);
  assert.match(noLens.basis.aperture, /no lens limit was supplied/);
  assert.equal(noLens.settings.nd_stops, null);
});

test('neutral density comes from a measured scene exposure or is reported as not determined', async () => {
  const { production } = await newProduction('exposure');
  const { shot } = await newShot(production, 'exposure');
  const unmeasured = await propose(camFull, lens50, { frame_rate: 24, aperture: 2.8, iso: 400 }, { production, shot });
  assert.equal(unmeasured.settings.nd_stops, null);
  assert.match(unmeasured.basis.nd_stops, /not determined/);
  const measured = await propose(camFull, lens50, { frame_rate: 24, aperture: 2.8, iso: 400, scene_ev: 9 }, { production, shot });
  assert.equal(measured.satisfied, true);
  assert.equal(Number(measured.settings.nd_stops), 3);
  assert.match(measured.basis.nd_stops, /Scene EV 9 against settings EV 6\.56/);
  const beyond = await propose(camFull, lens50, { frame_rate: 24, aperture: 2.8, iso: 400, scene_ev: 12 }, { production, shot });
  assert.equal(beyond.satisfied, false);
  assert.deepEqual(reasons(beyond), ['INSUFFICIENT_ND']);
  assert.equal(Number(beyond.refusals[0].required_stops), 6);
  assert.equal(Number(beyond.refusals[0].limit), 4);
  assert.equal(Number(beyond.settings.nd_stops), 4);
  const dimmed = await propose(camFull, lens50, { frame_rate: 24, aperture: 2.8, iso: 400, scene_ev: 5 }, { production, shot });
  assert.equal(dimmed.satisfied, true);
  assert.equal(Number(dimmed.settings.nd_stops), 0);
});

test('accepting settings is a creator decision that writes into the real execution plan', async () => {
  const { production } = await newProduction('accept');
  const { shot, plan } = await newShot(production, 'accept');
  const proposal = await propose(camFull, lens50, { frame_rate: 30, aperture: 2.8, iso: 400, resolution: '4K' },
    { production, shot });
  assert.equal(proposal.satisfied, true);
  const accepted = await decide(proposal.proposal_id, 'accept', 'Use these for the interview');
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.applied_plan_id, plan);
  const stored = (await rows('select camera_resource_id, lens_resource_id, plan_metadata, revision from tonde.execution_plans where id = $1', [plan]))[0];
  assert.equal(stored.camera_resource_id, camFull);
  assert.equal(stored.lens_resource_id, lens50);
  assert.equal(Number(stored.plan_metadata.camera_settings.frame_rate), 30);
  assert.equal(Number(stored.plan_metadata.camera_settings.iso), 400);
  assert.equal(stored.plan_metadata.camera_settings_proposal_id, proposal.proposal_id);
  assert.equal(Number(stored.revision), 2);
  const decided = (await rows('select state, decided_by, decided_at, applied_plan_id, decision_note from tonde.camera_settings_proposals where id = $1', [proposal.proposal_id]))[0];
  assert.equal(decided.state, 'accepted');
  assert.equal(decided.decided_by, A);
  assert.equal(decided.applied_plan_id, plan);
  assert.equal(decided.decision_note, 'Use these for the interview');
  assert.notEqual(decided.decided_at, null);
  // Accepting twice is the same decision, not a second one.
  const again = await decide(proposal.proposal_id, 'accept');
  assert.equal(again.idempotent, true);
  assert.equal(again.state, 'accepted');
  // The decision is readable through the plan and the readiness read.
  const report = await readiness(production);
  assert.equal(report.shots.find(entry => entry.shot_id === shot).settings_accepted, true);
});

test('an unsatisfied proposal cannot be accepted and a decided proposal is a closed record', async () => {
  const { production } = await newProduction('refusal-decision');
  const { shot } = await newShot(production, 'refusal-decision');
  const unsatisfied = await propose(camFull, lensOther, {}, { production, shot });
  assert.equal(unsatisfied.satisfied, false);
  const forced = await failure(() => decide(unsatisfied.proposal_id, 'accept'));
  assert.equal(forced.code, 'PT409');
  assert.match(forced.message, /SETTINGS_UNSATISFIED/);
  const unexplained = await failure(() => decide(unsatisfied.proposal_id, 'reject', '  '));
  assert.match(unexplained.message, /rejection says why/i);
  const rejected = await decide(unsatisfied.proposal_id, 'reject', 'The mount does not fit');
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.applied_plan_id, null);
  const rewritten = await failure(() => asService(() => db.query(
    "update tonde.camera_settings_proposals set settings = '{}'::jsonb where id = $1", [unsatisfied.proposal_id])));
  assert.equal(rewritten.code, '23514');
  assert.match(rewritten.message, /closed record/);
  // A proposal cannot be inserted already decided, and a client cannot reach around the RPCs.
  const preDecided = await failure(() => asService(() => db.query(
    `insert into tonde.camera_settings_proposals(workspace_id,production_id,shot_id,camera_resource_id,intent_hash,state)
      values($1,$2,$3,$4,'probe-hash','accepted')`, [wa, production, shot, camFull])));
  assert.equal(preDecided.code, '42501');
  const withdrawn = await failure(() => asOwner(() => db.query(
    "update tonde.camera_settings_proposals set state = 'accepted' where id = $1", [unsatisfied.proposal_id])));
  assert.match(withdrawn.message, /permission denied/);
});

test('scene requirements record what a scene needs and can only be waived with a reason', async () => {
  const { production } = await newProduction('requirements');
  const { scene, shot } = await newShot(production, 'requirements');
  const noTarget = await failure(() => addRequirement({ production, detail: 'Nothing to attach to' }));
  assert.match(noTarget.message, /belongs to a scene or a shot/);
  const badKind = await failure(() => addRequirement({ production, scene, kind: 'vibes' }));
  assert.match(badKind.message, /not a TONDE scene requirement/);
  const badSource = await failure(() => addRequirement({ production, scene, source: 'rumour' }));
  assert.match(badSource.message, /where it came from/);
  const added = await addRequirement({ production, scene, kind: 'lighting', detail: 'Key light on the subject' });
  assert.equal(added.state, 'open');
  assert.equal(added.mandatory, true);
  const duplicate = await addRequirement({ production, scene, kind: 'lighting', detail: ' Key light on the subject ' });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.requirement_id, added.requirement_id);
  // A requirement attached to a shot inherits the shot's scene.
  const onShot = await addRequirement({ production, shot, kind: 'safety', detail: 'Stunt coordinator on set' });
  assert.equal(onShot.mandatory, true);
  assert.equal(await scalar('select scene_id = $2 from tonde.scene_requirements where id = $1', [onShot.requirement_id, scene]), true);
  const optional = await addRequirement({ production, scene, kind: 'prop', detail: 'A newspaper prop', mandatory: false });
  assert.equal(optional.mandatory, false);
  const unexplained = await failure(() => settle(added.requirement_id, 'waived'));
  assert.match(unexplained.message, /says why/i);
  const waived = await settle(added.requirement_id, 'waived', 'Shot in daylight instead');
  assert.equal(waived.state, 'waived');
  const stamped = (await rows('select resolved_by, resolved_at, resolution_note from tonde.scene_requirements where id = $1', [added.requirement_id]))[0];
  assert.equal(stamped.resolved_by, A);
  assert.notEqual(stamped.resolved_at, null);
  assert.equal(stamped.resolution_note, 'Shot in daylight instead');
  const met = await settle(onShot.requirement_id, 'met', 'Coordinator booked');
  assert.equal(met.state, 'met');
  const reopened = await settle(added.requirement_id, 'open');
  assert.equal(reopened.state, 'open');
  assert.equal(await scalar('select resolved_by is null and resolved_at is null from tonde.scene_requirements where id = $1', [added.requirement_id]), true);
  // The database itself refuses a settled requirement without the person and the time that settled it.
  const unstamped = await failure(() => asService(() => db.query(
    "update tonde.scene_requirements set state = 'met' where id = $1", [added.requirement_id])));
  assert.match(unstamped.message, /scene_requirement_settled_is_stamped|check constraint/i);
  const unknown = await failure(() => settle('00000000-0000-4000-8000-999999999999', 'met'));
  assert.match(unknown.message, /does not exist/);
});

test('scene intelligence reports the gaps nothing yet satisfies instead of assuming coverage', async () => {
  const { production } = await newProduction('intelligence');
  const { scene, shot } = await newShot(production, 'intelligence');
  const planless = await newShot(production, 'intelligence-planless', false);
  const uncovered = await addRequirement({ production, scene, kind: 'lighting', detail: 'Key light' });
  const unplanned = await addRequirement({ production, shot: planless.shot, kind: 'safety', detail: 'Coordinator' });
  const optional = await addRequirement({ production, scene, kind: 'prop', detail: 'Newspaper', mandatory: false });
  const report = await intelligence(production);
  assert.equal(report.production_id, production);
  assert.equal(Number(report.scenes_considered), 2);
  assert.equal(report.requirements.length, 3);
  const gapIds = report.gaps.map(gap => gap.requirement_id);
  assert.equal(gapIds.includes(uncovered.requirement_id), true);
  assert.equal(gapIds.includes(optional.requirement_id), false, 'a requirement that is not mandatory is not a gap');
  assert.equal(report.gaps.find(gap => gap.requirement_id === uncovered.requirement_id).reason, 'UNRESOLVED');
  assert.equal(report.gaps.find(gap => gap.requirement_id === unplanned.requirement_id).reason, 'NO_EXECUTION_PLAN');
  assert.equal(report.shots.find(entry => entry.shot_id === planless.shot).settings_accepted, false);
  assert.equal(report.devices.some(device => device.resource_id === camFull && device.capability_state === 'verified'), true);
  assert.ok(report.meaning.includes('reported as missing'));
  // Settling the requirement closes the gap.
  await settle(uncovered.requirement_id, 'met', 'Light booked');
  const after = await intelligence(production);
  assert.equal(after.gaps.some(gap => gap.requirement_id === uncovered.requirement_id), false);
  // A scene-scoped read is scoped to that scene.
  const scoped = await intelligence(production, scene);
  assert.equal(scoped.requirements.every(requirement => requirement.scene_id === scene), true);
  assert.equal(scoped.shots.every(entry => entry.scene_id === scene), true);
  const unknown = await failure(() => intelligence('00000000-0000-4000-8000-999999999999'));
  assert.match(unknown.message, /Production does not exist/);
});

test('device readiness reports what is known about the equipment and what it could not satisfy', async () => {
  const { production } = await newProduction('readiness');
  const { shot } = await newShot(production, 'readiness');
  const refused = await propose(camFull, lensTight, { frame_rate: 24 }, { production, shot });
  const satisfied = await propose(camFull, lens50, { frame_rate: 25, aperture: 2.8, iso: 400 }, { production, shot });
  const accepted = await decide(satisfied.proposal_id, 'accept', 'Ready to shoot');
  assert.equal(accepted.applied_plan_id !== null, true);
  const report = await readiness(production);
  assert.equal(report.production_id, production);
  const camera = report.devices.find(device => device.resource_id === camFull);
  assert.equal(camera.capability_state, 'verified');
  assert.equal(camera.device_kind, 'camera');
  assert.equal(Number(camera.crop_factor), 1.5);
  assert.equal(Number(camera.sensor_diagonal_mm), 28.84);
  assert.equal(camera.source_label, 'Probe manual');
  const lens = report.devices.find(device => device.resource_id === lens50);
  assert.equal(Number(lens.lens.max_aperture), 1.8);
  assert.deepEqual(lens.lens.focal_range.map(Number), [50, 50]);
  assert.equal(report.devices.some(device => device.resource_id === lensOther), true);
  assert.equal(report.shots.find(entry => entry.shot_id === shot).has_real_plan, true);
  assert.equal(report.shots.find(entry => entry.shot_id === shot).settings_accepted, true);
  const unsatisfied = report.unsatisfied_proposals.find(entry => entry.proposal_id === refused.proposal_id);
  assert.equal(unsatisfied.satisfied, false);
  assert.deepEqual(unsatisfied.refusals.map(refusal => refusal.reason), ['IMAGE_CIRCLE_TOO_SMALL']);
  // A resource with no capability at all is reported as missing, never as ready.
  const bare = await newResource('camera', 'Probe undeclared camera');
  const bareReport = await readiness(production);
  assert.equal(bareReport.devices.find(device => device.resource_id === bare).capability_state, 'missing');
  assert.equal(bareReport.devices.find(device => device.resource_id === bare).sensor_diagonal_mm, null);
});

test('capability, requirements and proposals are tenant-isolated', async () => {
  const { production } = await newProduction('isolation');
  const { scene, shot } = await newShot(production, 'isolation');
  await addRequirement({ production, scene, kind: 'audio', detail: 'Room tone' });
  const proposal = await propose(camFull, lens50, {}, { production, shot });
  assert.equal(Number(await asStranger(() => scalar('select count(*)::int from tonde.device_capabilities where resource_id = $1', [camFull]))), 0);
  assert.equal(Number(await asStranger(() => scalar('select count(*)::int from tonde.lens_capabilities where resource_id = $1', [lens50]))), 0);
  assert.equal(Number(await asStranger(() => scalar('select count(*)::int from tonde.scene_requirements where production_id = $1', [production]))), 0);
  assert.equal(Number(await asStranger(() => scalar('select count(*)::int from tonde.camera_settings_proposals where id = $1', [proposal.proposal_id]))), 0);
  // The stranger's own workspace declares nothing, so a bare count over the table is only its own rows.
  assert.equal(Number(await asStranger(() => scalar('select count(*)::int from tonde.device_capabilities'))), 0);
  const foreignWorkspace = await failure(() => declareDevice(camFull, { crop_factor: 1 }, { workspace: wb }));
  assert.equal(foreignWorkspace.code, '42501');
  const foreignPropose = await failure(() => propose(camFull, lens50, {}, { workspace: wb, production, shot }));
  assert.equal(foreignPropose.code, '42501');
  const foreignDecide = await failure(() => decide(proposal.proposal_id, 'reject', 'Not mine', B));
  assert.equal(foreignDecide.code, '42501');
  const foreignRequirement = await failure(() => addRequirement({ workspace: wb, production, scene }));
  assert.equal(foreignRequirement.code, '42501');
  const foreignIntelligence = await failure(() => intelligence(production, null, B));
  assert.equal(foreignIntelligence.code, '42501');
  const foreignReadiness = await failure(() => readiness(production, B));
  assert.equal(foreignReadiness.code, '42501');
  // The member of another workspace still sees its own workspace's capability, which is empty here.
  const own = await asStranger(() => scalar('select count(*)::int from tonde.device_capabilities where workspace_id = $1', [wb]));
  assert.equal(Number(own), 0);
});
