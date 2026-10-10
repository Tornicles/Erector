import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 5 Studio workspace persistence (additive migration 015).
// Real embedded PostgreSQL with minimal Supabase platform schemas. This does NOT
// emulate Auth HTTP, Storage HTTP, PostgREST or hosted settings.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, production;
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
  production = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Studio fixture', 'commercial']));
  // An exact 30-second Production, as Prompt 4 would have committed it.
  await db.query('update tonde.productions set planned_duration_ms = 30000 where id = $1', [production]);
});

after(async () => { await db?.close(); });

const newScene = (title, duration = null) => ({ title, purpose: 'Earn attention', duration_ms: duration });
const newShot = (title, duration = null) => ({ title, purpose: 'establish', framing: 'wide', duration_ms: duration });

test('a Scene is created, renamed and survives reload with a scoped object identity', async () => {
  const created = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Dark kitchen', 12000)]));
  const sceneId = created.scene_id;
  assert.equal(created.title, 'Dark kitchen');
  assert.equal((await one('select kind, production_id from tonde.objects where id = $1', [sceneId])).kind, 'scene');
  const renamed = await asEditor(() => scalar('select tonde.update_studio_scene($1,$2,$3,$4,$5)', [wa, production, sceneId, created.revision, { title: 'Cold open' }]));
  assert.equal(renamed.revision, created.revision + 1);
  assert.equal(await one('select title from tonde.scenes where id = $1', [sceneId]).then(r => r.title), 'Cold open');
});

test('a Scene title that is blank is refused and a stale revision is a conflict', async () => {
  const created = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Second scene')]));
  const blank = await failure(() => asEditor(() => db.query('select tonde.update_studio_scene($1,$2,$3,$4,$5)', [wa, production, created.scene_id, created.revision, { title: '   ' }])));
  assert.equal(blank.code, '22023');
  await asEditor(() => db.query('select tonde.update_studio_scene($1,$2,$3,$4,$5)', [wa, production, created.scene_id, created.revision, { purpose: 'Prove the promise' }]));
  const stale = await failure(() => asEditor(() => db.query('select tonde.update_studio_scene($1,$2,$3,$4,$5)', [wa, production, created.scene_id, created.revision, { title: 'Too late' }])));
  assert.equal(stale.code, 'PT409');
});

test('Shots are canonical rows in the right Scene with persisted order and creative fields', async () => {
  const scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Weighing')]));
  const first = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('Scale macro', 8000)]));
  const second = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('Beans fall', 9000)]));
  assert.ok(first.sort_order < second.sort_order, 'later Shot receives a higher order');
  const row = await one('select scene_id, lifecycles.lifecycle, framing, purpose, planned_duration_ms from tonde.shots, lateral (select lifecycle) as lifecycles where id = $1', [first.shot_id]);
  assert.equal(row.scene_id, scene.scene_id);
  assert.equal(row.framing, 'wide');
  assert.equal(Number(row.planned_duration_ms), 8000);
  const object = await one('select kind, production_id from tonde.objects where id = $1', [first.shot_id]);
  assert.equal(object.kind, 'shot');
  assert.equal(object.production_id, production);
});

test('a Shot order is replaced only with the complete live set of that Scene', async () => {
  const scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Order test')]));
  const a = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('A')]));
  const b = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('B')]));
  const incomplete = await failure(() => asEditor(() => db.query('select tonde.reorder_studio_shots($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, [a.shot_id]])));
  assert.equal(incomplete.code, '22023');
  await asEditor(() => db.query('select tonde.reorder_studio_shots($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, [b.shot_id, a.shot_id]]));
  const order = (await db.query('select title from tonde.shots where scene_id = $1 and lifecycle = $$active$$ order by sort_order', [scene.scene_id])).rows.map(r => r.title);
  assert.deepEqual(order, ['B', 'A']);
});

test('a Scene order is persisted and must list exactly the live Scenes', async () => {
  const before = (await db.query("select id from tonde.scenes where workspace_id = $1 and production_id = $2 and lifecycle = 'active' order by sort_order", [wa, production])).rows.map(r => r.id);
  assert.ok(before.length >= 3, 'fixture has several live Scenes');
  const reversed = [...before].reverse();
  await asEditor(() => db.query('select tonde.reorder_studio_scenes($1,$2,$3,$4)', [wa, production, null, reversed]));
  const after = (await db.query("select id from tonde.scenes where workspace_id = $1 and production_id = $2 and lifecycle = 'active' order by sort_order", [wa, production])).rows.map(r => r.id);
  assert.deepEqual(after, reversed);
  const foreign = await failure(() => asEditor(() => db.query('select tonde.reorder_studio_scenes($1,$2,$3,$4)', [wa, production, null, [before[0], before[0]]])));
  assert.equal(foreign.code, '22023');
});

test('a Shot moves between Scenes and the timeline hierarchy follows', async () => {
  const source = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Move source')]));
  const target = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Move target')]));
  const shot = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, source.scene_id, null, newShot('Travelling macro', 4000)]));
  const moved = await asEditor(() => scalar('select tonde.move_studio_shot($1,$2,$3,$4,$5)', [wa, production, shot.shot_id, target.scene_id, shot.revision]));
  assert.equal(moved.scene_id, target.scene_id);
  assert.equal(await one('select scene_id from tonde.shots where id = $1', [shot.shot_id]).then(r => r.scene_id), target.scene_id);
  const wrongScene = await failure(() => asEditor(() => db.query('select tonde.move_studio_shot($1,$2,$3,$4,$5)', [wa, production, shot.shot_id, '00000000-0000-4000-8000-00000000dead', null])));
  assert.equal(wrongScene.code, 'P0002');
});

test('Shot durations drive the derived Scene timing and report the runtime honestly', async () => {
  const scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Timing')]));
  const a = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('One', 5000)]));
  const b = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('Two', 5000)]));
  assert.equal(a.timing.scene_states.find(s => s.scene_id === scene.scene_id).timing, 'derived');
  const edited = await asEditor(() => scalar('select tonde.update_studio_shot($1,$2,$3,$4,$5)', [wa, production, b.shot_id, b.revision, { duration_ms: '7000' }]));
  const derived = edited.timing.scene_states.find(s => s.scene_id === scene.scene_id);
  assert.equal(Number(derived.duration_ms), 12000);
  // A Shot without a duration makes that Scene's timing incomplete rather than guessed.
  await asEditor(() => db.query('select tonde.update_studio_shot($1,$2,$3,$4,$5)', [wa, production, a.shot_id, a.revision, { duration_ms: null }]));
  const incomplete = await asEditor(() => scalar('select tonde.studio_timing($1,$2,$3)', [wa, production, null]));
  assert.equal(incomplete.scene_states.find(s => s.scene_id === scene.scene_id).timing, 'incomplete');
  assert.ok(['fits', 'over', 'under'].includes(incomplete.status));
  assert.equal(Number(incomplete.total_ms), incomplete.scene_states.reduce((sum, s) => sum + Number(s.duration_ms), 0));
});

test('runtime reconciliation lands exactly on the Production target and is rejectable', async () => {
  const scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Absorber', 10000)]));
  await asEditor(() => db.query('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('Hold', 10000)]));
  const current = await asEditor(() => scalar('select tonde.studio_timing($1,$2,$3)', [wa, production, null]));
  // Pin an exact target two seconds under the current total so the absorber must shorten.
  const target = Number(current.total_ms) - 2000;
  await db.query('update tonde.productions set planned_duration_ms = $1 where id = $2', [target, production]);
  const before = await asEditor(() => scalar('select tonde.studio_timing($1,$2,$3)', [wa, production, null]));
  assert.equal(before.status, 'over');
  assert.equal(Number(before.delta_ms), 2000);
  const empty = await failure(() => asEditor(() => db.query('select tonde.reconcile_studio_runtime($1,$2,$3,$4)', [wa, production, '00000000-0000-4000-8000-00000000dead', null])));
  assert.equal(empty.code, 'P0002');
  const reconciled = await asEditor(() => scalar('select tonde.reconcile_studio_runtime($1,$2,$3,$4)', [wa, production, scene.scene_id, null]));
  assert.equal(reconciled.timing.status, 'fits');
  assert.equal(Number(reconciled.timing.total_ms), target);
  assert.equal(Number(reconciled.timing.target_ms), target);
  assert.equal(Number(reconciled.adjusted_ms), -2000);
  assert.equal(Number(reconciled.shot_duration_ms), 8000);
});

test('approval means something: a modified approved Shot reports changed_after_approval', async () => {
  const scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Approval')]));
  const shot = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('Approve me', 2000)]));
  const approved = await asEditor(() => scalar('select tonde.set_studio_approval($1,$2,$3,$4,$5,$6)', [wa, production, 'shot', shot.shot_id, 'approved', shot.revision]));
  assert.equal(approved.approval, 'approved');
  const modified = await asEditor(() => scalar('select tonde.update_studio_shot($1,$2,$3,$4,$5)', [wa, production, shot.shot_id, approved.revision, { title: 'Changed after approval' }]));
  assert.equal(modified.approval, 'changed_after_approval');
  const unsupported = await failure(() => asEditor(() => db.query('select tonde.set_studio_approval($1,$2,$3,$4,$5,$6)', [wa, production, 'shot', shot.shot_id, 'shipped', null])));
  assert.equal(unsupported.code, '22023');
});

test('a locked Shot refuses the UI path and the Director path identically', async () => {
  const scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Locking')]));
  const shot = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('Locked', 3000)]));
  const locked = await asEditor(() => scalar('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)', [wa, production, 'shot', shot.shot_id, true, null]));
  assert.equal(locked.locked, true);
  const viaRpc = await failure(() => asEditor(() => db.query('select tonde.update_studio_shot($1,$2,$3,$4,$5)', [wa, production, shot.shot_id, locked.revision, { title: 'Director edit' }])));
  assert.equal(viaRpc.code, '23514');
  const direct = await failure(() => asEditor(() => db.query("update tonde.shots set title = 'Sneaky' where id = $1", [shot.shot_id])));
  assert.equal(direct.code, '23514');
  const unlocked = await asEditor(() => scalar('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)', [wa, production, 'shot', shot.shot_id, false, locked.revision]));
  assert.equal(unlocked.locked, false);
  const after = await asEditor(() => scalar('select tonde.update_studio_shot($1,$2,$3,$4,$5)', [wa, production, shot.shot_id, unlocked.revision, { title: 'Unlocked edit' }]));
  assert.equal(after.revision, unlocked.revision + 1);
  assert.equal(await one('select title from tonde.shots where id = $1', [shot.shot_id]).then(r => r.title), 'Unlocked edit');
});

test('archiving removes a Shot from the live order without hard deletion', async () => {
  const scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Archive scene')]));
  const shot = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, newShot('Archived shot', 1000)]));
  const blocked = await failure(() => asEditor(() => db.query('select tonde.archive_studio_scene($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, false])));
  assert.equal(blocked.code, '23514');
  await asEditor(() => db.query('select tonde.archive_studio_shot($1,$2,$3,$4)', [wa, production, shot.shot_id, null]));
  const row = await one('select lifecycle from tonde.shots where id = $1', [shot.shot_id]);
  assert.equal(row.lifecycle, 'archived', 'the Shot still exists');
  const liveCount = await one("select count(*)::int as live from tonde.shots where scene_id = $1 and lifecycle = 'active'", [scene.scene_id]);
  assert.equal(liveCount.live, 0);
  const cascaded = await asEditor(() => scalar('select tonde.archive_studio_scene($1,$2,$3,$4,$5)', [wa, production, scene.scene_id, null, true]));
  assert.equal(cascaded.archived_shots, 0);
  assert.equal(await one('select lifecycle from tonde.scenes where id = $1', [scene.scene_id]).then(r => r.lifecycle), 'archived');
});

test('another workspace cannot create, edit, move or reconcile this Production', async () => {
  const scene = await one("select id, revision from tonde.scenes where production_id = $1 and lifecycle = 'active' order by sort_order limit 1", [production]);
  for (const call of [
    () => db.query('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Intruder')]),
    () => db.query('select tonde.update_studio_scene($1,$2,$3,$4,$5)', [wa, production, scene.id, scene.revision, { title: 'Intruder' }]),
    () => db.query('select tonde.reconcile_studio_runtime($1,$2,$3,$4)', [wa, production, scene.id, null]),
    () => db.query('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)', [wa, production, 'scene', scene.id, true, null]),
  ]) {
    const denied = await failure(() => asUser(B, call));
    assert.equal(denied.code, '42501', 'workspace denial for every Studio write');
  }
  const relation = await asUser(B, () => db.query('select count(*)::int as visible from tonde.scenes where production_id = $1', [production]));
  assert.equal(relation.rows[0].visible, 0, 'and nothing becomes readable');
  assert.notEqual(wb, wa);
});

test('Studio RPCs are executable by authenticated members only and private helpers stay hidden', async () => {
  const publicFns = [
    'studio_timing(uuid,uuid,integer)', 'create_studio_scene(uuid,uuid,integer,jsonb)',
    'update_studio_scene(uuid,uuid,uuid,integer,jsonb)', 'reorder_studio_scenes(uuid,uuid,integer,uuid[])',
    'archive_studio_scene(uuid,uuid,uuid,integer,boolean)', 'create_studio_shot(uuid,uuid,uuid,integer,jsonb)',
    'update_studio_shot(uuid,uuid,uuid,integer,jsonb)', 'move_studio_shot(uuid,uuid,uuid,uuid,integer)',
    'reorder_studio_shots(uuid,uuid,uuid,integer,uuid[])', 'archive_studio_shot(uuid,uuid,uuid,integer)',
    'set_studio_approval(uuid,uuid,text,uuid,text,integer)', 'set_studio_lock(uuid,uuid,text,uuid,boolean,integer)',
    'reconcile_studio_runtime(uuid,uuid,uuid,integer)',
  ];
  for (const signature of publicFns) {
    const row = await one(`select
      has_function_privilege('authenticated', 'tonde.${signature}', 'execute') as authenticated_can,
      has_function_privilege('anon', 'tonde.${signature}', 'execute') as anon_can,
      has_function_privilege('service_role', 'tonde.${signature}', 'execute') as service_can`);
    assert.equal(row.authenticated_can, true, signature);
    assert.equal(row.anon_can, false, signature);
    assert.equal(row.service_can, false, signature);
  }
  for (const signature of ['assert_scope_object(uuid,uuid,uuid,text)', 'studio_guard(uuid,uuid,integer)',
    'studio_revision_guard(uuid,uuid,uuid,text,integer)', 'studio_timing(uuid,uuid)']) {
    const row = await one(`select has_function_privilege('authenticated', 'tonde_private.${signature}', 'execute') as authenticated_can`);
    assert.equal(row.authenticated_can, false, signature);
  }
  const anonDenied = await failure(async () => {
    await db.exec('begin; set local role anon;');
    try { await db.query('select tonde.create_studio_scene($1,$2,$3,$4)', [wa, production, null, newScene('Anon')]); }
    finally { await db.exec('rollback'); }
  });
  assert.equal(anonDenied.code, '42501');
});

// The manual hosted-apply checklist must actually report presence, not just exist:
// supabase/manual-apply/06_verify.sql is the query a human runs after applying 015.
test('the manual hosted-apply verification query reports every Studio object present', async () => {
  const sql = await readFile('supabase/manual-apply/06_verify.sql', 'utf8');
  const rows = (await db.query(sql)).rows;
  assert.ok(rows.length > 0, 'the verification query returned no rows');
  const missing = rows.filter(row => row.result !== 'OK').map(row => `${row.kind} ${row.name}`);
  assert.deepEqual(missing, [], `objects missing after the migration chain: ${missing.join(', ')}`);
});
