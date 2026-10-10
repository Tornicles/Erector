import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 8 long-form, Movie Mode, Series and Production Line persistence (additive migration 018).
// Real embedded PostgreSQL with minimal Supabase platform schemas. This does NOT emulate Auth HTTP,
// Storage HTTP, PostgREST, hosted settings or any AI provider: no generation is attempted here.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, film, documentary, youtube, projectA;
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
const asOther = action => asUser(B, action);
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };
const actId = async (production, title) => asEditor(() => scalar(
  'select (tonde.create_long_form_act($1,$2,$3,$4)->>\'act_id\')::uuid', [wa, production, null, JSON.stringify({ title })]));
const sequenceId = async (production, title, act = null) => asEditor(() => scalar(
  'select (tonde.create_long_form_sequence($1,$2,$3,$4)->>\'sequence_id\')::uuid',
  [wa, production, null, JSON.stringify({ title, act_id: act })]));
const sceneId = async (production, title, duration = null) => asEditor(() => scalar(
  'select (tonde.create_studio_scene($1,$2,$3,$4)->>\'scene_id\')::uuid',
  [wa, production, null, JSON.stringify({ title, duration_ms: duration })]));
const shotId = async (production, scene, title, duration, method = 'real') => asEditor(() => scalar(
  'select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>\'shot_id\')::uuid',
  [wa, production, scene, null, JSON.stringify({ title, duration_ms: duration, execution_method: method })]));

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
  // §118 a 90-minute film, and §119 a 70-minute documentary with five chapter-like groups.
  film = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Ninety minute film', 'long_form_film']));
  projectA = await scalar('select project_id from tonde.productions where id = $1', [film]);
  await asEditor(() => db.query('update tonde.productions set planned_duration_ms = 5400000 where id = $1', [film]));
  documentary = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Seventy minute documentary', 'documentary']));
  await asEditor(() => db.query('update tonde.productions set planned_duration_ms = 4200000 where id = $1', [documentary]));
});

after(async () => { await db?.close(); });

test('§118 a 3-Act film is created and read back as a bounded hierarchy', async () => {
  const actOne = await actId(film, 'Act 1 — Ordinary world');
  const seqOne = await sequenceId(film, 'Sequence 1 — Wake up', actOne);
  const seqTwo = await sequenceId(film, 'Sequence 2 — The letter', actOne);
  const sceneOne = await sceneId(film, 'Bedroom', 60000);
  const sceneTwo = await sceneId(film, 'Kitchen', 90000);
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)',
    [wa, film, sceneOne, null, seqOne, null]));
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)',
    [wa, film, sceneTwo, null, seqTwo, null]));
  const structure = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3)', [wa, film, 'production']));
  assert.equal(structure.items.length, 1, 'one Act so far');
  assert.equal(structure.items[0].display, 'Act 1');
  assert.equal(structure.items[0].child_counts.sequences, 2);
  const actView = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4)', [wa, film, 'act', actOne]));
  assert.equal(actView.items.length, 2);
  assert.deepEqual(actView.items.map(i => i.display), ['Sequence 1', 'Sequence 2']);
  assert.equal(actView.breadcrumb.at(-1).level, 'act');
  const seqView = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4)', [wa, film, 'sequence', seqOne]));
  assert.equal(seqView.items.length, 1);
  assert.equal(seqView.items[0].level, 'scene');
  assert.equal(seqView.items[0].title, 'Bedroom');
});

test('§120 a long YouTube Production works with Sequences and no Acts', async () => {
  youtube = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Long YouTube chapter video', 'youtube']));
  const seq = await sequenceId(youtube, 'Chapter 1 — Why this matters', null);
  const scene = await sceneId(youtube, 'Chapter opening', 45000);
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, youtube, scene, null, seq, null]));
  const structure = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3)', [wa, youtube, 'production']));
  assert.equal(structure.items.length, 0, 'no Act level is required');
  assert.equal(structure.scope.orphan_sequences, 1);
  const timing = await asEditor(() => scalar('select tonde.long_form_timing($1,$2)', [wa, youtube]));
  assert.equal(Number(timing.production.calculated_ms), 45000);
  assert.equal(timing.production.status, 'unresolved', 'no runtime target means no fit verdict');
});

test('§121 Production → Acts → Scenes works without any Sequence, and §15 reports the real discrepancy', async () => {
  const act = await actId(documentary, 'Section 1 — Origins');
  const scene = await sceneId(documentary, 'Interview 1', 120000);
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, documentary, scene, null, null, act]));
  await asEditor(() => db.query('select tonde.update_long_form_act($1,$2,$3,$4,$5)',
    [wa, documentary, act, null, JSON.stringify({ duration_ms: 60000 })]));
  const structure = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4)', [wa, documentary, 'act', act]));
  assert.equal(structure.items.length, 1);
  assert.equal(structure.items[0].level, 'scene');
  const timing = await asEditor(() => scalar('select tonde.long_form_timing($1,$2)', [wa, documentary]));
  const section = timing.acts[0];
  assert.equal(Number(section.target_ms), 60000);
  assert.equal(Number(section.calculated_ms), 120000);
  assert.equal(Number(section.delta_ms), 60000);
  assert.equal(section.status, 'over');
  assert.equal(timing.conflicts[0].over_by_label, '1:00');
});

test('§122/§95 moving a Scene between Sequences keeps the same Scene UUID and its Shots', async () => {
  const act = await actId(film, 'Act 2 — The break');
  const seqA = await sequenceId(film, 'Sequence 3 — Search', act);
  const seqB = await sequenceId(film, 'Sequence 4 — Decision', act);
  const scene = await sceneId(film, 'Hospital corridor', 40000);
  const shot = await shotId(film, scene, 'Corridor push in', 20000);
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, film, scene, null, seqA, null]));
  const moved = await asEditor(() => scalar('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, film, scene, null, seqB, null]));
  assert.equal(moved.scene_id, scene);
  assert.equal(moved.sequence_id, seqB);
  assert.equal(Number(moved.shots_unchanged), 1);
  const shotScene = await scalar('select scene_id from tonde.shots where id = $1', [shot]);
  assert.equal(shotScene, scene, 'the Shot still belongs to the same canonical Scene');
  const original = await scalar('select id from tonde.scenes where id = $1', [scene]);
  assert.equal(original, scene);
});

test('§123 changing a Shot duration rolls up to Scene → Sequence → Act → Production', async () => {
  const act = await actId(film, 'Act 3 — Resolution');
  const seq = await sequenceId(film, 'Sequence 5 — Return', act);
  const scene = await sceneId(film, 'Front porch', null);
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, film, scene, null, seq, null]));
  const shot = await shotId(film, scene, 'Porch approach', 10000);
  const beforeTiming = await asEditor(() => scalar('select tonde.long_form_timing($1,$2)', [wa, film]));
  const beforeAct = Number(beforeTiming.acts.find(a => a.act_id === act).calculated_ms);
  await asEditor(() => db.query('select tonde.update_studio_shot($1,$2,$3,$4,$5)',
    [wa, film, shot, null, JSON.stringify({ duration_ms: 25000 })]));
  const afterTiming = await asEditor(() => scalar('select tonde.long_form_timing($1,$2)', [wa, film]));
  const afterAct = Number(afterTiming.acts.find(a => a.act_id === act).calculated_ms);
  assert.equal(afterAct - beforeAct, 15000);
  const sceneRow = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4)', [wa, film, 'sequence', seq]));
  assert.equal(Number(sceneRow.items[0].calculated_duration_ms), 25000);
  assert.equal(Number(afterTiming.production.calculated_ms) - Number(beforeTiming.production.calculated_ms), 15000);
  assert.equal(Number(afterTiming.counts.shots) > 0, true);
});

test('§124 a large Production is read lazily: Acts are paginated and shots are never loaded eagerly', async () => {
  const bulk = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Large production', 'long_form_film']));
  for (let index = 0; index < 8; index += 1) {
    const act = await actId(bulk, `Act ${index + 1}`);
    const scene = await sceneId(bulk, `Scene ${index + 1}`, 30000);
    await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, bulk, scene, null, null, act]));
    await shotId(bulk, scene, `Shot ${index + 1}`, 30000);
  }
  const firstPage = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4,$5,$6)',
    [wa, bulk, 'production', null, 3, 0]));
  assert.equal(firstPage.items.length, 3);
  assert.equal(firstPage.truncated, true);
  assert.equal(firstPage.total, 8);
  assert.equal(firstPage.items.every(item => item.level === 'act'), true, 'no Shot is returned when asking for Acts');
  const secondPage = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4,$5,$6)',
    [wa, bulk, 'production', null, 3, 3]));
  assert.deepEqual(secondPage.items.map(i => i.title), ['Act 4', 'Act 5', 'Act 6']);
});

test('§96/§97/§98 moving a Sequence and splitting an Act or Sequence preserve every child identity', async () => {
  const split = await actId(film, 'Act 4 — Coda');
  const seqOne = await sequenceId(film, 'Coda sequence one', split);
  const seqTwo = await sequenceId(film, 'Coda sequence two', split);
  const firstScene = await sceneId(film, 'Coda beat one', 10000);
  const secondScene = await sceneId(film, 'Coda beat two', 10000);
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, film, firstScene, null, seqOne, null]));
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, film, secondScene, null, seqTwo, null]));
  const splitOrder = await scalar('select sort_order from tonde.sequences where id = $1', [seqTwo]);
  const splitAct = await asEditor(() => scalar('select tonde.split_long_form_structure($1,$2,$3,$4,$5,$6,$7)',
    [wa, film, 'act', split, splitOrder, null, 'Act 5 — New coda']));
  assert.equal(Number(splitAct.moved_sequences), 1);
  const movedScene = await scalar('select sequence_id from tonde.scenes where id = $1', [secondScene]);
  assert.equal(movedScene, seqTwo, 'the Scene keeps its Sequence');
  const movedSequenceAct = await scalar('select act_id from tonde.sequences where id = $1', [seqTwo]);
  assert.equal(movedSequenceAct, splitAct.created_id);
  const stillThere = await scalar('select count(*)::int from tonde.scenes where id in ($1,$2)', [firstScene, secondScene]);
  assert.equal(stillThere, 2, 'a split never duplicates Scenes');
  const splitSequence = await asEditor(() => scalar('select tonde.split_long_form_structure($1,$2,$3,$4,$5,$6,$7)',
    [wa, film, 'sequence', seqOne, 0, null, 'Half one']));
  assert.equal(Number(splitSequence.moved_scenes), 1);
  const sceneMoved = await scalar('select sequence_id from tonde.scenes where id = $1', [firstScene]);
  assert.equal(sceneMoved, splitSequence.created_id);
});

test('§144 two sessions reordering the same Sequence: the stale update is rejected', async () => {
  const act = await actId(film, 'Act 6 — Order test');
  const seqOne = await sequenceId(film, 'Order A', act);
  const seqTwo = await sequenceId(film, 'Order B', act);
  const loaded = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4)', [wa, film, 'act', act]));
  const structureRevision = Number(loaded.structure_revision);
  await asEditor(() => db.query('select tonde.reorder_long_form($1,$2,$3,$4,$5,$6)',
    [wa, film, 'sequence', [seqTwo, seqOne], structureRevision, act]));
  const stale = await failure(() => asEditor(() => db.query('select tonde.reorder_long_form($1,$2,$3,$4,$5,$6)',
    [wa, film, 'sequence', [seqOne, seqTwo], structureRevision, act])));
  assert.equal(stale.code, 'PT409');
  const order = await db.query('select id from tonde.sequences where act_id = $1 and lifecycle = $2 order by sort_order', [act, 'active']);
  assert.deepEqual(order.rows.map(r => r.id), [seqTwo, seqOne]);
});

test('§146 a locked Act cannot be regenerated or edited until it is unlocked', async () => {
  const act = await actId(documentary, 'Section 2 — Locked');
  await asEditor(() => db.query('select tonde.set_long_form_lock($1,$2,$3,$4,$5,$6)', [wa, documentary, 'act', act, true, null]));
  const blocked = await failure(() => asEditor(() => db.query('select tonde.update_long_form_act($1,$2,$3,$4,$5)',
    [wa, documentary, act, null, JSON.stringify({ purpose: 'Rewrite the whole section' })])));
  assert.equal(blocked.code, '23514');
  await asEditor(() => db.query('select tonde.set_long_form_lock($1,$2,$3,$4,$5,$6)', [wa, documentary, 'act', act, false, null]));
  const allowed = await asEditor(() => scalar('select tonde.update_long_form_act($1,$2,$3,$4,$5)',
    [wa, documentary, act, null, JSON.stringify({ purpose: 'Scoped rewrite' })]));
  assert.equal(allowed.lifecycle, 'active');
});

test('§145 Workspace B cannot read Workspace A structure, Series or Production Line', async () => {
  const denied = await failure(() => asOther(() => scalar('select tonde.long_form_structure($1,$2,$3)', [wa, film, 'production'])));
  assert.equal(denied.code, '42501');
  const seriesForOther = await failure(() => asOther(() => scalar('select tonde.create_series($1,$2,$3)',
    [wa, projectA, JSON.stringify({ title: 'Intrusion' })])));
  assert.equal(seriesForOther.code, '42501');
  const seriesRow = await asEditor(() => scalar('select tonde.create_series($1,$2,$3)',
    [wa, projectA, JSON.stringify({ title: 'Workspace A only', cadence_metadata: { kind: 'daily' } })]));
  const overviewDenied = await failure(() => asOther(() => scalar('select tonde.series_overview($1,$2)', [wa, seriesRow.series_id])));
  assert.equal(overviewDenied.code, '42501');
  const visibleToOther = await asOther(() => scalar('select count(*)::int from tonde.series where workspace_id = $1', [wa]));
  assert.equal(visibleToOther, 0, 'RLS hides the other workspace Series entirely');
});

test('§27/§28 summaries are derived, versioned and reported stale after the source changes', async () => {
  const act = await actId(film, 'Act 7 — Summary');
  const saved = await asEditor(() => scalar('select tonde.save_structure_summary($1,$2,$3,$4,$5,$6,$7,$8)',
    [wa, film, 'act', act, JSON.stringify({ text: 'Marcus decides to stay.' }), null, 'derived by creator', 'creator']));
  assert.equal(saved.stale, false);
  const structure = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4)', [wa, film, 'act', act]));
  assert.equal(structure.scope.summary.stale, false);
  await asEditor(() => db.query('select tonde.update_long_form_act($1,$2,$3,$4,$5)',
    [wa, film, act, null, JSON.stringify({ purpose: 'Now he leaves instead' })]));
  const staleList = await asEditor(() => scalar('select tonde.long_form_summaries($1,$2)', [wa, film]));
  const staleRow = staleList.items.find(item => item.scope_object_id === act);
  assert.equal(staleRow.stale, true, 'a derived summary is never treated as current truth');
});

test('§119 five chapter-like groups work for a documentary with a custom structure', async () => {
  for (let index = 2; index <= 5; index += 1) {
    const section = await actId(documentary, `Section ${index} — Topic ${index}`);
    const scene = await sceneId(documentary, `Scene for section ${index}`, 60000);
    await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, documentary, scene, null, null, section]));
  }
  const structure = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4,$5,$6)',
    [wa, documentary, 'production', null, 20, 0]));
  // Five documentary sections, plus the locked Section 2 created by the lock test: no fixed formula.
  assert.equal(structure.total, 6);
  for (const index of [1, 2, 3, 4, 5]) {
    assert.equal(structure.items.some(item => item.title.startsWith(`Section ${index}`)), true);
  }
  assert.equal(structure.items.every(item => item.level === 'act'), true);
  const timing = await asEditor(() => scalar('select tonde.long_form_timing($1,$2)', [wa, documentary]));
  assert.equal(Number(timing.production.target_ms), 4200000);
  assert.equal(timing.production.status, 'under', 'the real remaining gap is reported, never rounded away');
});

test('§92/§93 structured search returns real objects, and bound filters scope to Scenes and Shots', async () => {
  const character = await asEditor(() => scalar(
    "insert into tonde.assets(workspace_id, asset_type, name) values ($1,'character','Marcus') returning id", [wa]));
  const scene = await sceneId(film, 'Marcus confronts Maya', 45000);
  await asEditor(() => db.query('select tonde.move_long_form_scene($1,$2,$3,$4,$5,$6)', [wa, film, scene, null, null, null]));
  await asEditor(() => db.query('insert into tonde.scene_participants(workspace_id, production_id, scene_id, asset_id) values ($1,$2,$3,$4)',
    [wa, film, scene, character]));
  const shot = await shotId(film, scene, 'Marcus holds the phone', 20000);
  await asEditor(() => db.query(
    `insert into tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type, title, content)
     values ($1,$2,$3,'script','Marcus scene','MARCUS: I am not leaving. MAYA: Then stay.')`,
    [wa, film, scene]));
  const byTitle = await asEditor(() => scalar('select tonde.long_form_search($1,$2,$3)', [wa, film, 'confronts']));
  assert.equal(byTitle.items.length, 1);
  assert.equal(byTitle.items[0].id, scene);
  const byScript = await asEditor(() => scalar('select tonde.long_form_search($1,$2,$3,$4)', [wa, film, 'Then stay', JSON.stringify({ levels: ['document'] })]));
  assert.equal(byScript.items.length, 1);
  assert.equal(byScript.items[0].level, 'document');
  const byCharacter = await asEditor(() => scalar('select tonde.long_form_search($1,$2,$3,$4)', [wa, film, 'Marcus',
    JSON.stringify({ character_asset_id: character })]));
  assert.equal(byCharacter.items.length, 2, 'the Scene and its Shot');
  assert.deepEqual(new Set(byCharacter.items.map(i => i.level)), new Set(['scene', 'shot']));
  assert.equal(byCharacter.binding_filter.scoped_to, 'scenes/shots');
  const byShot = await asEditor(() => scalar('select tonde.long_form_search($1,$2,$3,$4)', [wa, film, 'phone', JSON.stringify({ levels: ['shot'], execution_method: 'real' })]));
  assert.equal(byShot.items.length, 1);
  assert.equal(byShot.items[0].id, shot);
  assert.equal(byShot.items[0].execution_method, 'real');
  const tooShort = await failure(() => asEditor(() => scalar('select tonde.long_form_search($1,$2,$3)', [wa, film, 'x'])));
  assert.equal(tooShort.code, '22023');
});

test('§25/§26 Director context is scoped and bounded, never the whole Production', async () => {
  const scene = await scalar(
    "select id from tonde.scenes where production_id = $1 and title = 'Marcus confronts Maya'", [film]);
  const context = await asEditor(() => scalar('select tonde.long_form_context($1,$2,$3,$4,$5)',
    [wa, film, 'scene', scene, 1200]));
  assert.equal(context.scope.level, 'scene');
  assert.equal(context.characters, 'Marcus');
  assert.equal(context.siblings.length <= 12, true);
  assert.equal(context.budget_chars, 1200);
  assert.equal(context.truncated, true);
  assert.equal(context.timing.counts.shots > 0, true);
  const anyShot = await scalar('select id from tonde.shots where scene_id = $1 limit 1', [scene]);
  const shotContext = await asEditor(() => scalar('select tonde.long_form_context($1,$2,$3,$4,$5)',
    [wa, film, 'shot', anyShot, 800]));
  assert.equal(shotContext.path.length >= 2, true);
  assert.equal(shotContext.scope.level, 'shot');
});

test('§130/§132/§131 a daily Creator Series generates seven future slots idempotently', async () => {
  const series = await asEditor(() => scalar('select tonde.create_series($1,$2,$3)', [wa, projectA, JSON.stringify({
    title: 'Daily Personal Finance', series_kind: 'recurring', timezone: 'Europe/London',
    cadence_metadata: { kind: 'daily' }, format: { production_type: 'recurring_content', runtime_target_ms: 45000, title_pattern: 'Money minute {n}' } })]));
  const preview = await asEditor(() => scalar('select tonde.generate_ahead_preview($1,$2,$3)',
    [wa, series.series_id, JSON.stringify({ horizon: 'next_7', depth: 'ideas_only' })]));
  assert.equal(Number(preview.counts.open), 7);
  assert.equal(Number(preview.counts.preserved), 0);
  assert.equal(preview.requires_confirmation, true);
  assert.equal(preview.depth_label, 'Ideas Only');
  assert.equal(preview.timezone, 'Europe/London');
  const unconfirmed = await failure(() => asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)',
    [wa, series.series_id, JSON.stringify({ horizon: 'next_7', depth: 'ideas_only' })])));
  assert.equal(unconfirmed.code, '22023');
  const first = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)',
    [wa, series.series_id, JSON.stringify({ horizon: 'next_7', depth: 'ideas_only', confirm: true })]));
  assert.equal(first.counts.created, 7);
  assert.equal(first.counts.preserved, 0);
  assert.equal(first.created_episodes.length, 7);
  assert.equal(first.created_episodes.every(e => e.topic_source === 'title_pattern'), true,
    'no topic is invented on the creator\'s behalf');
  const second = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)',
    [wa, series.series_id, JSON.stringify({ horizon: 'next_7', depth: 'ideas_only', confirm: true })]));
  assert.equal(second.counts.created, 0, 'running NEXT 7 twice creates no duplicates');
  assert.equal(second.counts.preserved, 7);
  const totalEpisodes = await scalar('select count(*)::int from tonde.series_episodes where series_id = $1', [series.series_id]);
  assert.equal(totalEpisodes, 7);
  const episodes = await db.query('select title, episode_number, requested_depth from tonde.series_episodes where series_id = $1 order by episode_number', [series.series_id]);
  assert.deepEqual(episodes.rows.map(r => r.episode_number).map(Number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(episodes.rows[0].title, 'Money minute 1');
  assert.equal(episodes.rows[0].requested_depth, 'ideas_only');
  // Tomorrow is a real date slot, not a duplicate of the seven already created.
  const tomorrow = await asEditor(() => scalar('select tonde.series_slots($1,$2,$3)', [wa, series.series_id, 'tomorrow']));
  assert.equal(Number(tomorrow.counts.preserved), 1);
  assert.equal(Number(tomorrow.counts.open), 0);
  globalThis.financeSeries = series.series_id;
});

test('§133/§76 Next 14 with held slots fails partially, and the retry only resumes what is missing', async () => {
  const series = globalThis.financeSeries;
  const held = await asEditor(() => scalar('select tonde.series_slots($1,$2,$3,$4)', [wa, series, 'next_14', 0]));
  const holdKeys = held.slots.filter(slot => slot.state === 'open').slice(0, 2).map(slot => slot.slot_key);
  assert.equal(holdKeys.length, 2);
  const run = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)', [wa, series, JSON.stringify({
    horizon: 'next_14', depth: 'briefs', confirm: true, hold_slots: holdKeys })]));
  assert.equal(run.state, 'retrying');
  assert.equal(Number(run.counts.created), 5, 'the seven preserved slots are not recreated');
  assert.equal(Number(run.counts.preserved), 7);
  assert.equal(Number(run.counts.blocked), 2);
  assert.equal(Number(run.counts.failed), 0);
  const createdAfterRun = await scalar('select count(*)::int from tonde.series_episodes where series_id = $1', [series]);
  assert.equal(createdAfterRun, 12);
  const jobs = await asEditor(() => scalar('select tonde.generate_ahead_jobs($1,$2)', [wa, series]));
  const job = jobs.jobs.find(entry => entry.job_id === run.job_id);
  assert.equal(job.items.filter(item => item.state === 'blocked').length, 2);
  assert.equal(job.items.filter(item => item.state === 'preserved').length >= 7, true);
  // The blocked slots stay blocked until the creator asks again.
  const stillBlocked = await asEditor(() => scalar('select tonde.retry_generate_ahead($1,$2)', [wa, run.job_id]));
  assert.equal(stillBlocked.counts.created, 0);
  assert.equal(stillBlocked.counts.blocked, 2);
  const episodesBeforeRetry = await scalar('select count(*)::int from tonde.series_episodes where series_id = $1', [series]);
  assert.equal(episodesBeforeRetry, 12, 'a retry never duplicates what already exists');
  globalThis.financeRun = run;
});

test('§134/§61 Next 30 uses a shallower depth than Next 7 and never invents deeper content', async () => {
  const series = globalThis.financeSeries;
  const shallow = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)', [wa, series, JSON.stringify({
    horizon: 'next_30', depth: 'ideas_only', confirm: true })]));
  assert.equal(Number(shallow.counts.created) + Number(shallow.counts.preserved), 30,
    'Next 30 accounts for every slot: created plus preserved');
  assert.equal(Number(shallow.counts.created) > 0, true);
  assert.equal(shallow.created_episodes.every(item => item.planned_date !== null), true);
  const deepRequest = await asEditor(() => scalar('select tonde.generate_ahead_preview($1,$2,$3)',
    [wa, series, JSON.stringify({ horizon: 'custom', count: 2, depth: 'complete_plan', base_date: '2027-01-04' })]));
  assert.equal(Number(deepRequest.counts.open), 2);
  const applied = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)', [wa, series, JSON.stringify({
    horizon: 'custom', count: 2, depth: 'complete_plan', base_date: '2027-01-04', confirm: true })]));
  assert.equal(Number(applied.counts.created), 2);
  const line = await asEditor(() => scalar('select tonde.series_production_line($1,$2,$3)', [wa, series, 60]));
  const deepEpisode = line.items.find(item => item.planned_date === '2027-01-04');
  assert.equal(deepEpisode.requested_depth, 'complete_plan');
  assert.equal(deepEpisode.depth, 'idea', 'the actual depth stays truthful: nothing was fabricated');
  assert.equal(deepEpisode.readiness.state, 'BLOCKED');
  const codes = deepEpisode.blockers.map(blocker => blocker.code);
  assert.equal(codes.includes('requested_depth_missing'), true);
  assert.equal(JSON.stringify(deepEpisode).includes('percent'), false, 'no vanity percentage is produced');
  // Only the requested custom range was created for that date.
  const dateCount = await scalar('select count(*)::int from tonde.series_episodes where series_id = $1 and planned_date = $2', [series, '2027-01-04']);
  assert.equal(dateCount, 1);
});

test('§136/§137 Entire Series needs a finite plan, then creates only the missing slots', async () => {
  const narrative = await asEditor(() => scalar('select tonde.create_series($1,$2,$3)', [wa, projectA, JSON.stringify({
    title: 'Crime Drama', series_kind: 'narrative', timezone: 'UTC',
    cadence_metadata: { kind: 'weekly' }, format: { planned_episodes: 10, production_type: 'series', execution_method: 'real' } })]));
  const openEnded = await failure(() => asEditor(() => scalar('select tonde.generate_ahead_preview($1,$2,$3)',
    [wa, globalThis.financeSeries, JSON.stringify({ horizon: 'entire_series', depth: 'story' })])));
  assert.equal(openEnded.code, '23514', 'an open-ended Series is never generated infinitely');
  const preview = await asEditor(() => scalar('select tonde.generate_ahead_preview($1,$2,$3)',
    [wa, narrative.series_id, JSON.stringify({ horizon: 'entire_series', depth: 'story' })]));
  assert.equal(Number(preview.counts.total), 10);
  const run = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)',
    [wa, narrative.series_id, JSON.stringify({ horizon: 'entire_series', depth: 'story', confirm: true })]));
  assert.equal(Number(run.counts.created), 10);
  const again = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)',
    [wa, narrative.series_id, JSON.stringify({ horizon: 'entire_series', depth: 'story', confirm: true })]));
  assert.equal(Number(again.counts.created), 0);
  assert.equal(Number(again.counts.preserved), 10);
  globalThis.dramaSeries = narrative.series_id;
});

test('§138/§84 an approved Episode is preserved and never auto-approved or overwritten', async () => {
  const series = globalThis.financeSeries;
  const episode = await one('select id, production_id, episode_number from tonde.series_episodes where series_id = $1 order by episode_number limit 1', [series]);
  await asEditor(() => db.query('select tonde.set_studio_approval($1,$2,$3,$4,$5,$6)',
    [wa, episode.production_id, 'production', null, 'approved', null]));
  const run = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)', [wa, series, JSON.stringify({
    horizon: 'next_7', depth: 'script', confirm: true })]));
  assert.equal(Number(run.counts.preserved) >= 7, true);
  assert.equal(run.created_episodes.every(item => item.episode_number > 7), true);
  const preserved = await one('select approval, revision from tonde.productions where id = $1', [episode.production_id]);
  assert.equal(preserved.approval, 'approved', 'an approved Episode stays approved');
  const episodeRows = await scalar('select count(*)::int from tonde.series_episodes where series_id = $1 and episode_number = $2', [series, episode.episode_number]);
  assert.equal(episodeRows, 1, 'no duplicate Episode was created for the preserved slot');
  const requestedDepth = await scalar('select requested_depth from tonde.series_episodes where id = $1', [episode.id]);
  assert.equal(requestedDepth, 'ideas_only', 'the preserved Episode keeps its own recorded depth');
});

test('§139/§140/§141 Series Style, Character and Product are canonical Assets referenced, never copied', async () => {
  const style = await asEditor(() => scalar("insert into tonde.assets(workspace_id, asset_type, name) values ($1,'style_bible','Slow finance style') returning id", [wa]));
  const character = await asEditor(() => scalar("insert into tonde.assets(workspace_id, asset_type, name) values ($1,'character','Host') returning id", [wa]));
  const product = await asEditor(() => scalar("insert into tonde.assets(workspace_id, asset_type, name) values ($1,'product','Budget planner') returning id", [wa]));
  const series = await asEditor(() => scalar('select tonde.create_series($1,$2,$3)', [wa, projectA, JSON.stringify({
    title: 'Weekly host show', series_kind: 'recurring', timezone: 'UTC', cadence_metadata: { kind: 'weekly' },
    format: { style_bible_id: style, host_asset_id: character, product_ids: [product], runtime_target_ms: 600000 } })]));
  const run = await asEditor(() => scalar('select tonde.generate_ahead($1,$2,$3)', [wa, series.series_id, JSON.stringify({
    horizon: 'custom', count: 3, depth: 'ideas_only', confirm: true, base_date: '2027-03-01' })]));
  const episodeIds = run.created_episodes.map(item => item.production_id);
  const bindings = await db.query(
    "select production_id, binding_role, asset_id, inheritance from tonde.scope_bindings where scope_object_id = any($1::uuid[]) order by binding_role", [episodeIds]);
  for (const production of episodeIds) {
    const roles = bindings.rows.filter(row => row.production_id === production);
    assert.equal(roles.some(row => row.binding_role === 'style' && row.asset_id === style && row.inheritance === 'inherit'), true);
    assert.equal(roles.some(row => row.binding_role === 'character' && row.asset_id === character), true);
    assert.equal(roles.some(row => row.binding_role === 'product' && row.asset_id === product), true);
  }
  assert.equal(bindings.rows.filter(row => row.asset_id === character).length, 3,
    'the same canonical Character is referenced by three Episodes');
  const assetRows = await scalar('select count(*)::int from tonde.assets where workspace_id = $1', [wa]);
  const styleRows = await scalar('select count(*)::int from tonde.assets where workspace_id = $1 and name = $2', [wa, 'Slow finance style']);
  assert.equal(styleRows, 1, 'no per-Episode copy of the Style Bible exists');
  assert.equal(assetRows >= 3, true);
  // An Episode-specific override references its own Style Bible and leaves the Series row untouched.
  const episodeStyle = await asEditor(() => scalar("insert into tonde.assets(workspace_id, asset_type, name) values ($1,'style_bible','Episode 1 alternative grade') returning id", [wa]));
  await asEditor(() => db.query(
    "insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance) values ($1,$2,$2,$3,'style','override')",
    [wa, episodeIds[0], episodeStyle]));
  const inheritedStyle = await scalar("select count(*)::int from tonde.scope_bindings where scope_object_id = $1 and asset_id = $2 and binding_role = 'style'", [episodeIds[0], style]);
  assert.equal(inheritedStyle, 1, 'the inherited Series style binding stays in place');
  const seriesFormat = await scalar('select format from tonde.series where id = $1', [series.series_id]);
  assert.equal(seriesFormat.style_bible_id, style);
  assert.equal(Number((await scalar('select count(*)::int from tonde.scope_bindings where scope_object_id = $1 and inheritance = $2', [episodeIds[0], 'override']))), 1);
  globalThis.hostShow = series.series_id;
});

test('§142 Series Director context is bounded: titles, dates and states, not full history', async () => {
  const context = await asEditor(() => scalar('select tonde.series_director_context($1,$2,$3)', [wa, globalThis.financeSeries, 5]));
  assert.equal(context.title, 'Daily Personal Finance');
  assert.equal(context.series_kind, 'recurring');
  assert.equal(context.recent_titles.length, 5);
  assert.equal(context.avoid_list.length, 5);
  assert.equal(context.format_metadata_keys.includes('title_pattern'), true);
  assert.equal(JSON.stringify(context).includes('MARCUS'), false, 'no historical Script text is dumped into Director context');
  assert.equal(context.timezone, 'Europe/London');
});

test('§129/§47 Season is optional: a recurring Series works with no Season at all', async () => {
  const overview = await asEditor(() => scalar('select tonde.series_overview($1,$2)', [wa, globalThis.financeSeries]));
  assert.equal(overview.collections.length, 0);
  assert.equal(Number(overview.counts.episodes_active) > 30, true);
  assert.equal(overview.reuse.length, 0);
  const collection = await asEditor(() => scalar('select tonde.save_series_collection($1,$2,$3)',
    [wa, globalThis.dramaSeries, JSON.stringify({ title: 'Season 1', purpose: 'Ten episode run' })]));
  assert.equal(collection.title, 'Season 1');
  const renumbered = await asEditor(() => scalar('select tonde.series_overview($1,$2)', [wa, globalThis.dramaSeries]));
  assert.equal(renumbered.collections.length, 1);
  assert.equal(Number(renumbered.counts.next_episode_number), 11);
});

test('§143 the Production Line reports real depth and blockers for real Episodes', async () => {
  const line = await asEditor(() => scalar('select tonde.series_production_line($1,$2,$3)', [wa, globalThis.dramaSeries, 10]));
  assert.equal(line.items.length, 10);
  const first = line.items[0];
  assert.equal(first.line_state, 'idea');
  assert.equal(first.depth, 'idea');
  assert.equal(first.readiness.state, 'BLOCKED');
  assert.equal(first.blockers.some(blocker => blocker.code === 'no_scenes'), true);
  assert.equal(first.execution_summary.real, 0);
  assert.equal(typeof first.production_revision, 'number');
  assert.equal(line.note.includes('No percentage'), true);
  // Build one Episode for real and watch the Production Line change.
  const episode = line.items[0];
  const scene = await sceneId(episode.production_id, 'Opening murder', 60000);
  const shot = await shotId(episode.production_id, scene, 'Body in the rain', 60000, 'hybrid');
  await asEditor(() => db.query('select tonde.set_studio_approval($1,$2,$3,$4,$5,$6)',
    [wa, episode.production_id, 'shot', shot, 'approved', null]));
  const after = await asEditor(() => scalar('select tonde.series_production_line($1,$2,$3)', [wa, globalThis.dramaSeries, 10]));
  const changed = after.items.find(item => item.episode_id === episode.episode_id);
  assert.equal(changed.depth, 'shots_planned', 'the depth reflects the Shots that really exist');
  assert.equal(changed.line_state, 'shot_plan');
  assert.equal(changed.execution_summary.hybrid, 1);
  assert.equal(changed.blockers.some(blocker => blocker.code === 'no_scenes'), false);
  assert.equal(changed.readiness.state, 'READY WITH WARNINGS');
});

test('§118/§149 long-form hierarchy is identical for Real and AI execution, and Photography stays simple', async () => {
  const photo = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Portrait session', 'photography']));
  const photoShot = await shotId(photo, null, 'Window light portrait', null, 'real');
  const photoStructure = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3)', [wa, photo, 'production']));
  assert.equal(photoStructure.items.length, 0, 'photography is not forced into Acts');
  assert.equal(photoStructure.scope.orphan_scenes, 0);
  const photoTiming = await asEditor(() => scalar('select tonde.long_form_timing($1,$2)', [wa, photo]));
  assert.equal(Number(photoTiming.counts.shots), 1);
  const aiShot = await scalar('select id from tonde.shots where id = $1', [photoShot]);
  assert.equal(aiShot, photoShot);
  // The same Act/Sequence/Scene structure holds for an AI Shot on the film.
  const scene = await scalar("select id from tonde.scenes where production_id = $1 and title = 'Marcus confronts Maya'", [film]);
  const filmShot = await scalar('select id from tonde.shots where scene_id = $1 limit 1', [scene]);
  await asEditor(() => db.query('select tonde.update_studio_shot($1,$2,$3,$4,$5)',
    [wa, film, filmShot, null, JSON.stringify({ execution_method: 'ai' })]));
  const filmStructure = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3)', [wa, film, 'production']));
  assert.equal(filmStructure.items.length > 0, true, 'AI execution does not create a second hierarchy');
  const method = await scalar('select execution_method from tonde.shots where scene_id = $1 limit 1', [scene]);
  assert.equal(method, 'ai');
});

test('§99/§100 empty Acts are valid and archiving replaces destructive deletion', async () => {
  const empty = await actId(film, 'Act 8 — Planned but empty');
  const structure = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4)', [wa, film, 'act', empty]));
  assert.equal(structure.items.length, 0, 'an empty Act needs no placeholder records');
  const archived = await asEditor(() => scalar('select tonde.update_long_form_act($1,$2,$3,$4,$5)',
    [wa, film, empty, null, JSON.stringify({ lifecycle: 'archived' })]));
  assert.equal(archived.lifecycle, 'archived');
  const visible = await asEditor(() => scalar('select tonde.long_form_structure($1,$2,$3,$4,$5,$6)',
    [wa, film, 'production', null, 50, 0]));
  assert.equal(visible.items.some(item => item.id === empty), false, 'archived Acts leave the live order');
  const stillReadable = await scalar('select count(*)::int from tonde.acts where id = $1', [empty]);
  assert.equal(stillReadable, 1, 'archiving never deletes history');
});
