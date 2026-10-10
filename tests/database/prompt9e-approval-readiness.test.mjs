import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 9E approval, locks and Production readiness (additive migration 023). Real embedded
// PostgreSQL. This proves that approval names the exact revision it accepted and is a creator
// decision that an AI or service-role operation cannot manufacture, that a stale approval is
// rejected, that lock and approval stay independent and unlock is explicit and on record, that the
// decision record is append-only, and that readiness is a category derived from real state with
// actionable, navigable blockers rather than an arbitrary score. Nothing here crosses a workspace
// boundary.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
let wa, wb, film, sceneOne, shotOne;

const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
async function asService(action) {
  await db.exec('begin; set local role service_role;');
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
  await db.query("select set_config('request.jwt.claim.role', '', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);
const asViewer = action => asUser(C, action);
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };

const approvalDecide = (object, decision, expected = null, note = '') => asEditor(() => scalar(
  'select tonde.approval_decide($1,$2,$3,$4,$5,$6)', [wa, film, object, decision, expected, note]));
const lockSet = (object, locked, expected = null, note = '') => asEditor(() => scalar(
  'select tonde.lock_set($1,$2,$3,$4,$5,$6)', [wa, film, object, locked, expected, note]));
const accessState = object => asEditor(() => scalar('select tonde.access_state($1,$2,$3)', [wa, film, object]));
const accessHistory = (object, limit = 50, offset = 0) => asEditor(() => scalar(
  'select tonde.access_history($1,$2,$3,$4,$5)', [wa, film, object, limit, offset]));
const readiness = (production = film) => asEditor(() => scalar('select tonde.production_readiness($1,$2,$3)', [wa, production, null]));
const sceneId = (production, title) => asEditor(() => scalar(
  "select (tonde.create_studio_scene($1,$2,$3,$4)->>'scene_id')::uuid",
  [wa, production, null, JSON.stringify({ title, duration_ms: 20000 })]));
const shotId = (production, scene, title, duration = 4000) => asEditor(() => scalar(
  "select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>'shot_id')::uuid",
  [wa, production, scene, null, JSON.stringify({ title, duration_ms: duration })]));

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
  wa = await asUser(A, () => scalar('select tonde.bootstrap_workspace()'));
  wb = await asUser(B, () => scalar('select tonde.bootstrap_workspace()'));
  film = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Marquee film', 'short_film']));
  sceneOne = await sceneId(film, 'Scene 1 Apartment');
  shotOne = await shotId(film, sceneOne, 'Marcus enters');
  await db.query("insert into tonde.workspace_members(workspace_id, user_id, role) values ($1,$2,'viewer')", [wa, C]);
});

after(async () => { await db.close(); });

test('approval names the exact revision it accepted and records the actor', async () => {
  const decided = await approvalDecide(sceneOne, 'approve', null, 'Lock the opening beat.');
  assert.equal(decided.approval, 'approved');
  assert.ok(decided.revision, 'a revision was returned');
  const state = await accessState(sceneOne);
  assert.equal(state.approval, 'approved');
  assert.equal(state.approved_revision, decided.revision, 'the approved revision is pinned, not implied');
  assert.equal(state.approved_by, A, 'the creator who approved is recorded');
  assert.ok(state.approved_at, 'the time is recorded');
  assert.equal(state.changed_since_approval, false);
  const history = await accessHistory(sceneOne);
  assert.equal(history.total >= 1, true);
  assert.equal(history.items[0].action, 'approve');
  assert.equal(history.items[0].pinned_revision, decided.revision);
  assert.equal(history.items[0].actor_user_id, A);
});

test('a material change after approval is reported, never silently still approved', async () => {
  const before = await accessState(sceneOne);
  await asEditor(() => db.query('update tonde.scenes set title = $2 where id = $1', [sceneOne, 'Scene 1 Apartment, revised']));
  const after = await accessState(sceneOne);
  assert.equal(after.approval, 'changed_after_approval');
  assert.equal(after.changed_since_approval, true);
  assert.equal(after.approved_revision, before.approved_revision, 'the earlier approval still names the revision it accepted');
});

test('approval is a creator decision, never an AI or service-role operation', async () => {
  const viewer = await failure(() => asViewer(() => scalar('select tonde.approval_decide($1,$2,$3,$4,$5,$6)', [wa, film, sceneOne, 'approve', null, ''])));
  assert.equal(viewer.code, '42501');
  const other = await failure(() => asOther(() => scalar('select tonde.approval_decide($1,$2,$3,$4,$5,$6)', [wa, film, sceneOne, 'approve', null, ''])));
  assert.equal(other.code, '42501');
  // A service-role write cannot manufacture approval either: the database refuses it.
  const approvalBefore = await scalar('select approval from tonde.scenes where id = $1', [sceneOne]);
  const forged = await failure(() => asService(() => db.query("update tonde.scenes set approval = 'approved' where id = $1", [sceneOne])));
  assert.equal(forged.code, '42501');
  assert.equal(await scalar('select approval from tonde.scenes where id = $1', [sceneOne]), approvalBefore,
    'the forged approval did not land');
});

test('a stale approval is rejected instead of landing on unseen content', async () => {
  const current = await scalar('select revision from tonde.scenes where id = $1', [sceneOne]);
  const stale = await failure(() => approvalDecide(sceneOne, 'approve', current - 1));
  assert.equal(stale.code, 'PT409');
  const fresh = await approvalDecide(sceneOne, 'approve', current);
  assert.equal(fresh.approval, 'approved');
});

test('lock protects content, unlock is explicit, and lock is independent of approval', async () => {
  const locked = await lockSet(shotOne, true, null, 'The pickups are scheduled.');
  assert.equal(locked.locked, true);
  const state = await accessState(shotOne);
  assert.equal(state.locked, true);
  assert.equal(state.locked_by, A);
  assert.equal(state.lock_reason, 'The pickups are scheduled.');
  assert.equal(state.approval, 'draft', 'locked but draft is valid');

  const blocked = await failure(() => asEditor(() => db.query('update tonde.shots set title = $2 where id = $1', [shotOne, 'Nope'])));
  assert.match(String(blocked.message), /unlock/i);
  assert.equal(blocked.code, '23514');

  const again = await failure(() => lockSet(shotOne, true));
  assert.equal(again.code, '23514');

  const unlocked = await lockSet(shotOne, false, null, 'Unlocked for the reshoot.');
  assert.equal(unlocked.locked, false);
  assert.equal(unlocked.was_locked, true);
  const reopened = await accessState(shotOne);
  assert.equal(reopened.locked, false);
  const unlockRow = (await accessHistory(shotOne)).items.find(item => item.action === 'unlock');
  assert.ok(unlockRow, 'the unlock and its reason are on record');
  assert.equal(unlockRow.note, 'Unlocked for the reshoot.');

  // Approved but unlocked is also valid: approval and lock do not collapse into one another.
  const approved = await approvalDecide(shotOne, 'approve');
  assert.equal(approved.approval, 'approved');
  assert.equal(approved.locked, false);
});

test('the decision record is append-only', async () => {
  const decided = await accessHistory(sceneOne);
  const id = decided.items[0].id;
  const updated = await failure(() => db.query("update tonde.access_decisions set note = 'rewritten' where id = $1", [id]));
  assert.equal(updated.code, '23514');
  assert.match(String(updated.message), /append-only/i);
  const removed = await failure(() => db.query('delete from tonde.access_decisions where id = $1', [id]));
  assert.equal(removed.code, '23514');
  assert.equal((await accessHistory(sceneOne)).total, decided.total, 'nothing was removed');
});

test('readiness reports a real, navigable blocker for an unplanned Production', async () => {
  const fresh = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Fresh film', 'short_film']));
  const payload = await readiness(fresh);
  assert.equal(payload.state, 'blocked');
  const no_scenes = payload.blockers.find(item => item.code === 'no_scenes');
  assert.ok(no_scenes, 'the empty production is blocked on a missing scene plan');
  assert.equal(no_scenes.dimension, 'scene_plan');
  assert.equal(no_scenes.severity, 'blocking');
  assert.equal(no_scenes.affected_object_id, fresh, 'the blocker points at the real object to navigate to');
  assert.ok(no_scenes.required_action && no_scenes.why_it_matters);
  assert.equal(payload.counts.score, undefined, 'readiness is a category, not a score');
  assert.equal(payload.counts.percent, undefined);
  assert.equal(typeof payload.headline, 'string');
});

test('readiness dimensions and blockers follow real production state', async () => {
  const payload = await readiness(film);
  const dimensionNames = payload.dimensions.map(item => item.dimension);
  assert.equal(dimensionNames.includes('scene_plan'), true);
  assert.equal(dimensionNames.includes('shots'), true, 'a production with a Shot has a shots dimension');
  const withoutShots = payload.blockers.find(item => item.code === 'scene_without_shots' && item.affected_object_id === sceneOne);
  assert.equal(withoutShots, undefined, 'the scene has a Shot, so it is not reported as shot-less');
  const unplanned = payload.blockers.find(item => item.code === 'shot_unplanned' && item.affected_object_id === shotOne);
  assert.ok(unplanned, 'a Shot with no plan is reported');

  // A critical continuity finding is a real blocker, not an inference.
  await asEditor(() => db.query(
    "insert into tonde.continuity_findings(workspace_id, production_id, kind, severity, domain, explanation, origin, epistemic, evidence, at_shot_id) values ($1,$2,'unexplained_change','critical','wardrobe','Marcus wears a red jacket then a blue one.', 'derived','observed','[\"shot 1\", \"shot 8\"]'::jsonb, $3)",
    [wa, film, shotOne]));
  const withContinuity = await readiness(film);
  assert.equal(withContinuity.state, 'blocked');
  assert.ok(withContinuity.blockers.some(item => item.code === 'continuity_critical' && item.severity === 'blocking'));

  // An unresolved blocking intake decision is a real blocker; a creator answer clears it.
  const decision = await scalar(
    "insert into tonde.director_decisions(workspace_id, production_id, decision_id, question, priority, decided_by) values ($1,$2,'q1','Widescreen or vertical?','blocking','tonde') returning id",
    [wa, film]);
  const withDecision = await readiness(film);
  assert.ok(withDecision.blockers.some(item => item.code === 'unresolved_decision'));
  await db.query("update tonde.director_decisions set decided_by = 'creator' where id = $1", [decision]);
  const answered = await readiness(film);
  assert.equal(answered.blockers.some(item => item.code === 'unresolved_decision'), false);
});

test('a missing Real resource blocks through the readiness engine', async () => {
  await asEditor(() => scalar('select tonde.save_real_plan($1,$2,$3,$4,$5,$6)',
    [wa, film, shotOne, null, JSON.stringify({ plan_status: 'ready' }),
      JSON.stringify([{ kind: 'camera', label: 'Camera body', status: 'missing' }])]));
  const payload = await readiness(film);
  const missing = payload.blockers.find(item => item.code === 'missing_resource');
  assert.ok(missing, 'a missing required resource is a blocker');
  assert.equal(missing.severity, 'blocking');
  assert.equal(missing.dimension, 'resources');
  assert.equal(missing.affected_object_id, shotOne, 'the blocker points at the Shot');
});

test('readiness and access state are workspace-isolated and viewer-readable', async () => {
  const viewerReadiness = await asViewer(() => scalar('select tonde.production_readiness($1,$2,$3)', [wa, film, null]));
  assert.equal(typeof viewerReadiness.state, 'string');
  const viewerState = await asViewer(() => scalar('select tonde.access_state($1,$2,$3)', [wa, film, sceneOne]));
  assert.equal(viewerState.object_id, sceneOne);
  const viewerWrite = await failure(() => asViewer(() => scalar('select tonde.lock_set($1,$2,$3,$4,$5,$6)', [wa, film, sceneOne, true, null, ''])));
  assert.equal(viewerWrite.code, '42501');

  const other = await failure(() => asOther(() => scalar('select tonde.production_readiness($1,$2,$3)', [wa, film, null])));
  assert.equal(other.code, '42501');
  const hidden = await asOther(() => rows('select * from tonde.access_decisions where workspace_id = $1', [wa]));
  assert.equal(hidden.length, 0, 'RLS hides another workspace\'s decisions');
});

test('the private helpers stay unreachable', async () => {
  const reachable = await asEditor(() => scalar("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'tonde_private' and p.proname in ('ax_approval','ax_set_approval','ax_set_lock','ax_locked_at','rd_blocker','access_decisions_immutable')"));
  assert.equal(Number(reachable) >= 6, true);
  const denied = await failure(() => asEditor(() => scalar("select tonde_private.ax_approval($1,$2)", [wa, sceneOne])));
  assert.match(String(denied.message), /permission denied/i);
  const grant = await scalar("select exists(select 1 from information_schema.routine_privileges where specific_schema = 'tonde_private' and routine_name = 'rd_blocker' and grantee in ('authenticated','anon','PUBLIC'))");
  assert.equal(grant, false);
});
