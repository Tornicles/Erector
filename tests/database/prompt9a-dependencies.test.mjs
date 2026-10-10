import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 9A dependency graph, impact engine and stale artifacts (additive migration 019).
// Real embedded PostgreSQL: this proves edge direction, derived edges, bounded/cycle-safe
// traversal, classification, the three apply modes, lock and approval protection, stale-marker
// behaviour and workspace isolation. No AI inference is exercised here: inferred edges are
// written explicitly and are always reported as potential, never as canonical certainty.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, film, other, scene, shots = [], character, aiPlan, otherProduction;
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
const shotId = async (production, sceneId, title) => asEditor(() => scalar(
  'select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>\'shot_id\')::uuid',
  [wa, production, sceneId, null, JSON.stringify({ title, duration_ms: 4000, execution_method: 'ai' })]));
const preview = async (object, depth = 2) => asEditor(() => scalar(
  'select tonde.impact_preview($1,$2,$3,$4,$5)', [wa, film, object, depth, 200]));
const applyImpact = async (analysis, mode, selected = [], expected = null) => asEditor(() => scalar(
  'select tonde.apply_impact($1,$2,$3,$4,$5,$6,$7)',
  [wa, film, analysis, mode, selected, expected, '']));
const markers = async () => asEditor(() => scalar('select tonde.stale_artifact_list($1,$2,$3,$4,$5)', [wa, film, 'stale', 200, 0]));
const markersAll = async () => asEditor(() => scalar('select tonde.stale_artifact_list($1,$2,$3,$4,$5)', [wa, film, null, 200, 0]));

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
  film = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Marquee film', 'short_film']));
  otherProduction = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Second film', 'short_film']));
  scene = await asEditor(() => scalar('select (tonde.create_studio_scene($1,$2,$3,$4)->>\'scene_id\')::uuid',
    [wa, film, null, JSON.stringify({ title: 'Kitchen', duration_ms: 20000 })]));
  for (const title of ['Shot 12', 'Shot 13', 'Shot 14', 'Shot 15', 'Shot 16']) {
    shots.push(await shotId(film, scene, title));
  }
  other = await shotId(otherProduction, null, 'Other production shot');
  character = await asEditor(() => scalar(
    `insert into tonde.assets(workspace_id, asset_type, name, description) values ($1,'character','Marcus','Wardrobe established in Scene 4') returning id`,
    [wa]));
});

after(async () => { await db?.close(); });

test('§169 a Character Asset bound to five Shots is discoverable as direct impact', async () => {
  await asEditor(() => db.query(
    `insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role)
     select $1, $2, id, $3, 'character' from unnest($4::uuid[]) as id`, [wa, film, character, shots]));
  const sync = await asEditor(() => scalar('select tonde.dependency_sync($1,$2)', [wa, film]));
  assert.equal(sync.edges_considered >= 5, true, 'every binding contributes a derived edge');
  const analysis = await preview(character, 1);
  assert.equal(analysis.counts.direct, 5, 'five direct dependents');
  assert.equal(analysis.counts.downstream, 0);
  const found = analysis.nodes.map(node => node.object_id).sort();
  assert.deepEqual(found, [...shots].sort());
  assert.equal(analysis.nodes[0].classification, 'direct');
  assert.equal(analysis.nodes[0].level, 'shot');
  assert.match(analysis.explanation, /Marcus/);
  assert.match(analysis.explanation, /5 direct objects/);
  assert.match(analysis.rule, /never applied/);
});

test('§170 a downstream prompt/plan is found two levels out and marked stale by UPDATE ALL', async () => {
  aiPlan = await asEditor(() => scalar(
    `insert into tonde.execution_plans(workspace_id, production_id, shot_id, execution_method, plan_metadata)
     values ($1,$2,$3,'ai','{"compiled_prompt":"hold the bag at chest height"}') returning id`, [wa, film, shots[0]]));
  await asEditor(() => scalar('select tonde.dependency_sync($1,$2)', [wa, film]));
  const analysis = await preview(character, 2);
  assert.equal(analysis.counts.direct, 5);
  assert.equal(analysis.counts.downstream, 1, 'the AI plan sits downstream of the Shot');
  assert.equal(analysis.counts.by_level.execution_plan, 1);
  const result = await applyImpact(analysis.analysis_id, 'update_all');
  assert.equal(result.mode, 'update_all');
  assert.equal(result.marked, 6);
  const open = await markers();
  const planMarker = open.items.find(item => item.object_id === aiPlan);
  assert.ok(planMarker, 'the plan keeps a stale marker instead of being rewritten');
  assert.equal(planMarker.state, 'stale');
  assert.equal(planMarker.artifact_kind, 'dependent_object');
  assert.match(planMarker.reason, /Marcus/);
  const plan = await rows('select plan_metadata from tonde.execution_plans where id = $1', [aiPlan]);
  assert.equal(plan[0].plan_metadata.compiled_prompt, 'hold the bag at chest height', 'the artifact itself is untouched');
});

test('§171 a valid creative cycle terminates instead of recursing forever', async () => {
  await asEditor(() => db.query('select tonde.dependency_edge($1,$2,$3,$4,$5,$6,$7,$8)',
    [wa, film, shots[1], shots[2], 'creative', 'soft', 'explicit', 'Shot 13 sets up Shot 14.']));
  await asEditor(() => db.query('select tonde.dependency_edge($1,$2,$3,$4,$5,$6,$7,$8)',
    [wa, film, shots[2], shots[1], 'creative', 'soft', 'explicit', 'Shot 14 answers Shot 13.']));
  const graph = await asEditor(() => scalar("select tonde.dependency_graph($1,$2,$3,'forward',6,200)", [wa, film, shots[1]]));
  assert.equal(graph.cycles_safe, true);
  assert.equal(graph.nodes.some(node => node.object_id === shots[2]), true);
  assert.equal(graph.nodes.some(node => node.object_id === shots[1]), false, 'the root is never reported as its own dependent');
});

test('§16 an inferred dependency is reported as potential, never as certain', async () => {
  await asEditor(() => db.query('select tonde.dependency_edge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [wa, film, character, other, 'creative', 'advisory', 'inferred',
      'The same wardrobe may matter in the second film.', ['wardrobe'], JSON.stringify({ confidence: 'low' })]));
  const analysis = await preview(character, 2);
  const node = analysis.nodes.find(item => item.object_id === other);
  assert.equal(node.classification, 'potential');
  assert.equal(analysis.counts.potential, 1);
});

test('§12 an excluded binding deactivates its derived edge without deleting the relationship', async () => {
  await asEditor(() => db.query(
    `update tonde.scope_bindings set inheritance = 'exclude' where scope_object_id = $1 and asset_id = $2`,
    [shots[4], character]));
  await asEditor(() => scalar('select tonde.dependency_sync($1,$2)', [wa, film]));
  const graph = await asEditor(() => scalar("select tonde.dependency_graph($1,$2,$3,'forward',1,200)", [wa, film, character]));
  assert.equal(graph.nodes.some(node => node.object_id === shots[4]), false, 'an excluded binding stops being a live dependency');
  const stored = await rows(
    'select active, revision from tonde.object_dependencies where source_object_id = $1 and target_object_id = $2', [character, shots[4]]);
  assert.equal(stored[0].active, false, 'the edge is kept as history, not deleted');
  assert.ok(stored[0].revision > 1, 'the deactivation is versioned');
});

test('§173 UPDATE ALL never bypasses a lock: the locked Shot stays untouched and is reported', async () => {
  const before = await rows('select revision from tonde.shots where id = $1', [shots[0]]);
  const lockedMarkersBefore = (await markersAll()).items.filter(item => item.object_id === shots[0] && item.state === 'stale').length;
  await asEditor(() => db.query('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)', [wa, film, 'shot', shots[0], true, null]));
  const analysis = await preview(character, 2);
  assert.equal(analysis.counts.locked >= 1, true, 'the preview already names the locked dependent');
  const result = await applyImpact(analysis.analysis_id, 'update_all');
  assert.equal(result.locked_skipped.some(item => item.object_id === shots[0]), true);
  assert.match(result.locked_skipped[0].reason, /locked/);
  const after = await rows('select revision, locked_at from tonde.shots where id = $1', [shots[0]]);
  assert.equal(after[0].revision >= before[0].revision, true);
  assert.ok(after[0].locked_at, 'the lock is intact');
  // This apply must not have created a new marker for the locked Shot: its marker history is
  // unchanged and it was reported instead.
  const open = await markersAll();
  const lockedMarkers = open.items.filter(item => item.object_id === shots[0] && item.state === 'stale');
  assert.equal(lockedMarkers.length, lockedMarkersBefore, 'a locked dependent is not silently marked as if it had been updated');
});

test('§172 CHANGE ONLY THIS keeps every dependent and records the unresolved downstream impact', async () => {
  const analysis = await preview(character, 2);
  const result = await applyImpact(analysis.analysis_id, 'change_only_this');
  assert.equal(result.mode, 'change_only_this');
  assert.equal(result.unresolved_count >= 1, true, 'the downstream plan stays unresolved and visible');
  assert.match(result.note, /CHANGE ONLY THIS/);
  const storedAnalysis = await rows('select unresolved_count, applied_mode from tonde.impact_analyses where id = $1', [analysis.analysis_id]);
  assert.equal(storedAnalysis[0].applied_mode, 'change_only_this');
  assert.equal(storedAnalysis[0].unresolved_count, result.unresolved_count);
  const planStillThere = await rows('select revision, plan_metadata from tonde.execution_plans where id = $1', [aiPlan]);
  assert.equal(planStillThere.length, 1, 'nothing was deleted');
});

test('§213 an impact computed against an older revision cannot be applied silently', async () => {
  const analysis = await preview(character, 1);
  await asEditor(() => db.query('update tonde.shots set description = $2 where id = $1', [shots[1], 'changed after preview']));
  const error = await failure(() => applyImpact(analysis.analysis_id, 'update_all'));
  assert.equal(error.code, 'PT409');
  assert.match(error.message, /changed since this impact was computed/);
});

test('§19 traversal honours the requested depth and never expands unbounded', async () => {
  const shallow = await preview(character, 1);
  assert.equal(shallow.counts.by_level.execution_plan, undefined, 'depth 1 stops at the direct dependents');
  const graph = await asEditor(() => scalar("select tonde.dependency_graph($1,$2,$3,'forward',1,2)", [wa, film, character]));
  assert.equal(graph.depth, 1);
  assert.equal(graph.nodes.length <= 2, true);
  assert.equal(graph.truncated, true, 'a bounded page reports that it was truncated');
});

test('§82/§94 approved dependents are flagged for review rather than rewritten, and review_changes only touches what was selected', async () => {
  await asEditor(() => db.query('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)', [wa, film, 'shot', shots[0], false, null]));
  await asEditor(() => db.query('select tonde.set_studio_approval($1,$2,$3,$4,$5,$6)', [wa, film, 'shot', shots[2], 'approved', null]));
  const analysis = await preview(character, 2);
  assert.equal(analysis.counts.approved >= 1, true);
  const reviewed = await applyImpact(analysis.analysis_id, 'review_changes', [shots[3]]);
  assert.equal(reviewed.marked, 1, 'only the selected dependent is marked');
  const open = await markersAll();
  assert.equal(open.items.some(item => item.object_id === shots[2] && item.state === 'conflicted'), false,
    'an approved dependent is not touched when it was not selected');
  const second = await preview(character, 2);
  const all = await applyImpact(second.analysis_id, 'update_all');
  assert.equal(all.requiring_review.some(item => item.object_id === shots[2]), true, 'the approved dependent is reported');
  assert.match(all.requiring_review.find(item => item.object_id === shots[2]).reason, /never rewritten silently/);
  const flags = await markersAll();
  assert.equal(flags.items.some(item => item.object_id === shots[2] && item.state === 'conflicted'), true);
  const stillApproved = await rows('select approval from tonde.shots where id = $1', [shots[2]]);
  assert.equal(stillApproved[0].approval, 'approved', 'the approved content was not edited');
});

test('§23/§24 a creator can resolve a stale marker and the history stays readable', async () => {
  const open = await markers();
  const marker = open.items[0];
  const resolved = await asEditor(() => scalar('select tonde.resolve_stale_artifact($1,$2,$3,$4)', [wa, film, marker.artifact_id, 'Re-derived after the change.']));
  assert.equal(resolved.state, 'current');
  const list = await markersAll();
  const row = list.items.find(item => item.artifact_id === marker.artifact_id);
  assert.equal(row.state, 'current');
  assert.ok(row.resolved_at, 'the resolution is recorded, not erased');
});

test('§212 workspace isolation: another workspace cannot read the graph, the impact or the markers', async () => {
  const graph = await failure(() => asOther(() => scalar("select tonde.dependency_graph($1,$2,$3,'forward',2,50)", [wa, film, character])));
  assert.equal(graph.code, '42501');
  const impact = await failure(() => asOther(() => scalar('select tonde.impact_preview($1,$2,$3,$4,$5)', [wa, film, character, 2, 50])));
  assert.equal(impact.code, '42501');
  const list = await failure(() => asOther(() => scalar('select tonde.stale_artifact_list($1,$2,$3,$4,$5)', [wa, film, null, 50, 0])));
  assert.equal(list.code, '42501');
  const rowsVisible = await asOther(() => rows('select * from tonde.object_dependencies where workspace_id = $1', [wa]));
  assert.equal(rowsVisible.length, 0, 'RLS hides another workspace edges');
});

test('§11/§25 dependency metadata records the real reason and metadata is never a raw JSON blob', async () => {
  const edges = await asEditor(() => scalar('select tonde.dependency_edges($1,$2,$3)', [wa, film, character]));
  const bound = edges.items.find(item => item.target_object_id === shots[0]);
  assert.equal(bound.relation, 'asset');
  assert.equal(bound.origin, 'derived');
  assert.equal(bound.strength, 'hard');
  assert.deepEqual(bound.affected_fields, ['character']);
  assert.match(bound.reason, /character binding references the source directly/);
  assert.equal(bound.source_label, 'Marcus');
  assert.equal(bound.target_label, 'Shot 12');
  const inferred = edges.items.find(item => item.target_object_id === other);
  assert.equal(inferred.origin, 'inferred');
  assert.equal(inferred.evidence.confidence, 'low');
  assert.match(inferred.reason, /wardrobe may matter/);
});
