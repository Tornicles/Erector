import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 9C Production memory and structured search (additive migration 021). Real embedded
// PostgreSQL. This proves that memory is structured and inspectable with real provenance, that the
// authority hierarchy decides what is in force (a creator instruction beats an old pattern), that a
// correction supersedes within its tier while the older statement stays readable, that candidates
// come from real evidence and only become memory under an explicit policy or an explicit decision,
// that a candidate whose evidence moved cannot be accepted, that production search returns real
// object references from structured state rather than prose or embeddings, and that none of it
// crosses a workspace boundary.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
let wa, wb, film, secondFilm, sceneOne, sceneTwo, shotOne, shotTwo, shotThree;
let marcus, product, apartment, lens, realPlan, aiPlan, resultId, findingId, series, episode;

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
const asViewer = action => asUser(C, action);
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };

const sceneId = (production, title) => asEditor(() => scalar(
  'select (tonde.create_studio_scene($1,$2,$3,$4)->>\'scene_id\')::uuid',
  [wa, production, null, JSON.stringify({ title, duration_ms: 20000 })]));
const shotId = (production, scene, title) => asEditor(() => scalar(
  'select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>\'shot_id\')::uuid',
  [wa, production, scene, null, JSON.stringify({ title, duration_ms: 4000 })]));

const search = query => asEditor(() => scalar('select tonde.production_search($1,$2,$3)', [wa, film, JSON.stringify(query)]));
const setItem = payload => asEditor(() => scalar('select tonde.memory_item_set($1,$2,$3)', [wa, film, JSON.stringify(payload)]));
const listItems = (state = 'active', scope = null) => asEditor(() => scalar(
  'select tonde.memory_item_list($1,$2,$3,$4,$5,$6,$7,$8)', [wa, film, scope, null, null, state, 200, 0]));
const resolveMemory = (subject, kind = null) => asEditor(() => scalar(
  'select tonde.memory_resolve($1,$2,$3,$4)', [wa, film, subject, kind]));
const retireItem = (id, reason = '') => asEditor(() => scalar(
  'select tonde.memory_item_retire($1,$2,$3,$4)', [wa, film, id, reason]));
const setPolicy = payload => asEditor(() => scalar('select tonde.memory_policy_set($1,$2,$3)', [wa, film, JSON.stringify(payload)]));
const getPolicies = () => asEditor(() => scalar('select tonde.memory_policy_get($1,$2)', [wa, film]));
const recordCandidate = payload => asEditor(() => scalar('select tonde.memory_candidate_record($1,$2,$3)', [wa, film, JSON.stringify(payload)]));
const listCandidates = (state = 'proposed') => asEditor(() => scalar(
  'select tonde.memory_candidate_list($1,$2,$3,$4,$5)', [wa, film, state, 50, 0]));
const decideCandidate = (id, decision, note = '') => asEditor(() => scalar(
  'select tonde.memory_candidate_decide($1,$2,$3,$4,$5)', [wa, film, id, decision, note]));
const memorySummary = () => asEditor(() => scalar('select tonde.memory_summary($1,$2)', [wa, film]));
const resolveIn = (production, subject) => asEditor(() => scalar('select tonde.memory_resolve($1,$2,$3,$4)', [wa, production, subject, null]));

const byId = (list, id) => list.find(item => item.entity_id === id);
const lanesOf = result => Object.fromEntries(result.lanes.map(lane => [lane.lane, lane.total]));

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
  secondFilm = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Second film', 'short_film']));
  sceneOne = await sceneId(film, 'Scene 1 Apartment');
  sceneTwo = await sceneId(film, 'Scene 2 Kitchen');
  shotOne = await shotId(film, sceneOne, 'Marcus enters');
  shotTwo = await shotId(film, sceneTwo, 'Marcus close-up');
  shotThree = await shotId(film, sceneTwo, 'Product hero insert');

  // A viewer in Workspace A: memory must be readable to a member and writable only to an editor.
  await db.query("insert into tonde.workspace_members(workspace_id, user_id, role) values ($1,$2,'viewer')", [wa, C]);

  // Assets, an Environment, Setup resources and Scene participants: the real production facts the
  // structured search reads.
  marcus = await asEditor(() => scalar(
    "insert into tonde.assets(workspace_id, asset_type, name, description) values ($1,'character','Marcus', 'Lead character') returning id", [wa]));
  product = await asEditor(() => scalar(
    "insert into tonde.assets(workspace_id, asset_type, name, description) values ($1,'product','Hero Bottle', 'Amber glass bottle') returning id", [wa]));
  apartment = await asEditor(() => scalar(
    "insert into tonde.assets(workspace_id, asset_type, name, description) values ($1,'environment','Apartment Interior', 'Loft with tall windows') returning id", [wa]));
  await asEditor(() => db.query(
    "insert into tonde.scene_participants(workspace_id, production_id, scene_id, asset_id, role) values ($1,$2,$3,$4,'character'), ($1,$2,$5,$4,'character')",
    [wa, film, sceneOne, marcus, sceneTwo]));
  await asEditor(() => db.query('update tonde.scenes set environment_asset_id = $2 where id = $1', [sceneOne, apartment]));
  // A Product attaches to a Shot through a real scope binding; participants are Characters by contract.
  await asEditor(() => db.query(
    "insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role) values ($1,$2,$3,$4,'product')",
    [wa, film, shotThree, product]));

  lens = await asEditor(() => scalar(
    "insert into tonde.production_resources(workspace_id, resource_type, name, manufacturer) values ($1,'lens','50mm f/1.8', 'Canon') returning id", [wa]));
  await asEditor(() => scalar(
    "insert into tonde.production_resources(workspace_id, resource_type, name) values ($1,'camera','Camera A') returning id", [wa]));

  realPlan = await asEditor(() => scalar(
    "insert into tonde.execution_plans(workspace_id, production_id, shot_id, execution_method, lens_resource_id, shot_size, movement) values ($1,$2,$3,'real',$4,'Close up','static') returning id",
    [wa, film, shotTwo, lens]));
  aiPlan = await asEditor(() => scalar(
    "insert into tonde.execution_plans(workspace_id, production_id, shot_id, execution_method, provider, model, shot_size) values ($1,$2,$3,'ai','veo','veo-3','Insert') returning id",
    [wa, film, shotThree]));
  await asEditor(() => db.query(
    "insert into tonde.ai_generation_attempts(workspace_id, production_id, shot_id, plan_id, operation, attempt_number, provider_key, model_key, idempotency_key, mode, status) values ($1,$2,$3,$4,'video',1,'veo','veo-3','attempt-veo-0001','manual','planned')",
    [wa, film, shotThree, aiPlan]));

  const mediaId = '00000000-0000-4000-8000-0000000000c1';
  const media = await asEditor(() => scalar(
    "insert into tonde.media_files(id, workspace_id, bucket, object_key, original_filename, mime_type, file_category, bytes, upload_state, processing_state) values ($1,$2,'tonde-results',$3,'take-1.mp4','video/mp4','video',2048,'uploaded','ready') returning id",
    [mediaId, wa, `${wa}/${mediaId}/take-1.mp4`]));
  resultId = await asEditor(() => scalar(
    "insert into tonde.results(workspace_id, production_id, scene_id, shot_id, media_id, state) values ($1,$2,$3,$4,$5,'raw') returning id",
    [wa, film, sceneOne, shotOne, media]));
  findingId = (await asEditor(() => scalar('select tonde.continuity_finding_record($1,$2,$3)', [wa, film, JSON.stringify({
    kind: 'unexplained_change', domain: 'wardrobe', severity: 'warning', shot_id: shotTwo, trait: 'jacket',
    explanation: 'Scene 2 plans the red jacket without a declared change.',
    suggested_resolution: 'Declare the wardrobe change or fix the plan.',
    rationale: 'The declarations for this trait disagree.', epistemic: 'estimated', confidence: 'low',
    evidence: [{ artifact: 'continuity_states', trait: 'jacket' }] })]))).finding_id;

  const project = await asEditor(() => scalar('select project_id from tonde.productions where id = $1', [film]));
  series = await asEditor(() => scalar(
    "select (tonde.create_series($1,$2,$3)->>'series_id')::uuid", [wa, project,
      JSON.stringify({ title: 'Crime Series', series_kind: 'narrative' })]));
  episode = await asEditor(() => scalar(
    "select (tonde.create_series_episode($1,$2,$3)->>'episode_id')::uuid", [wa, series,
      JSON.stringify({ production_id: film, episode_number: 1 })]));
  assert.ok(series && episode, 'the Series and its Episode exist for the Series-scope test');
});

after(async () => { await db.close(); });

test('§180 structured search finds a Character and returns the real Shots and Scenes, not prose', async () => {
  const result = await search({ asset_name: 'marcus', kinds: ['shot', 'scene'] });
  assert.ok(result.total >= 4, `expected the two Scenes and their Shots, got ${JSON.stringify(lanesOf(result))}`);
  const shot = byId(result.results, shotOne);
  assert.ok(shot, 'the real Shot id is returned');
  assert.equal(shot.entity_type, 'shot');
  assert.equal(shot.context, 'Scene 1 Apartment', 'a Shot result names its Scene, not a sentence about it');
  assert.ok(byId(result.results, sceneTwo), 'the Scene the Character participates in is returned');
  assert.ok(result.results.every(item => item.entity_id && item.entity_type), 'every result is an object reference');
  const facet = result.interpretation.facets.find(item => item.facet === 'asset');
  assert.equal(facet.value, 'Marcus', 'the resolved Asset identity is disclosed');
  // Case does not have to match, and the resolution is honest about what it resolved to.
  const upper = await search({ asset_name: 'MARCUS', kinds: ['shot'] });
  assert.ok(byId(upper.results, shotOne));
});

test('§180 an identity facet that names nothing returns nothing and says so', async () => {
  const result = await search({ asset_name: 'Nobody Here', kinds: ['shot', 'scene'] });
  assert.equal(result.total, 0);
  assert.equal(result.results.length, 0);
  assert.match(result.notes[0], /No Asset in this workspace matches "Nobody Here"/);
});

test('§181 search finds the Real plan by the lens name Setup records', async () => {
  const result = await search({ lens: '50mm', kinds: ['plan'] });
  assert.equal(lanesOf(result).plan, 1, 'only the plan whose lens resource is named 50mm');
  const plan = byId(result.results, realPlan);
  assert.ok(plan, 'the real execution plan id is returned');
  assert.equal(plan.execution_method, 'real');
  assert.equal(plan.approval, 'draft');
  const meaning = result.interpretation.facets.find(item => item.facet === 'lens').meaning;
  assert.match(meaning, /does not claim a measured focal length/, 'the lens facet never claims measurement');
});

test('§182 search finds Shots with a provider Attempt and the plan that names the provider', async () => {
  const shots = await search({ provider: 'veo', kinds: ['shot'] });
  assert.equal(lanesOf(shots).shot, 1);
  assert.ok(byId(shots.results, shotThree));
  const plans = await search({ provider: 'veo', model: 'veo-3', kinds: ['plan'] });
  assert.equal(lanesOf(plans).plan, 1);
  assert.ok(byId(plans.results, aiPlan));
});

test('§59 structured search filters on real state: approval, Result state, continuity and Environment', async () => {
  const unapproved = await search({ approval: 'not_approved', kinds: ['shot'] });
  assert.equal(lanesOf(unapproved).shot, 3, 'every Shot is still unapproved');
  const approved = await search({ approval: 'approved', kinds: ['shot'] });
  assert.equal(lanesOf(approved).shot, 0);

  const results = await search({ result_state: 'raw', kinds: ['result'] });
  assert.equal(lanesOf(results).result, 1);
  assert.ok(byId(results.results, resultId), 'the Result object reference is returned');
  assert.equal(byId(results.results, resultId).has_media, true);

  const findings = await search({ continuity_state: 'open', severity: 'warning', domain: 'wardrobe', kinds: ['continuity_finding'] });
  assert.equal(lanesOf(findings).continuity_finding, 1);
  assert.ok(byId(findings.results, findingId));
  assert.equal(byId(findings.results, findingId).state, 'open');

  const scenes = await search({ environment: 'Apartment', kinds: ['scene'] });
  assert.ok(byId(scenes.results, sceneOne), 'the Scene in that Environment is found');
  assert.equal(byId(scenes.results, sceneOne).context, 'Apartment Interior');

  const products = await search({ asset_name: 'Hero Bottle', kinds: ['shot'] });
  assert.ok(byId(products.results, shotThree), 'a Product participant finds its Shots');
});

test('§59 text search reads real production text only, and never claims media analysis', async () => {
  const byText = await search({ text: 'kitchen', kinds: ['scene'] });
  assert.ok(byId(byText.results, sceneTwo));
  const missing = await search({ text: 'helicopter', kinds: ['scene', 'shot'] });
  assert.equal(missing.total, 0);
  const notes = byText.notes.join(' ');
  assert.match(notes, /does not read media/);
  assert.match(notes, /does not use embeddings/);
  assert.match(byText.interpretation.tokens.join(' '), /kitchen/, 'the tokens actually searched are disclosed');
});

test('§59 an unknown filter is a rejected request, not a silent full search', async () => {
  assert.equal((await failure(() => search({ kinds: ['nonsense'] }))).code, '22023');
  assert.equal((await failure(() => search({ approval: 'maybe' }))).code, '22023');
  assert.equal((await failure(() => search({ severity: 'urgent' }))).code, '22023');
  assert.equal((await failure(() => search({ asset_type: 'camera' }))).code, '22023');
  assert.equal((await failure(() => search({ asset_id: 'not-a-uuid' }))).code, '22023');
  assert.equal((await failure(() => asEditor(() => scalar('select tonde.production_search($1,$2,$3)',
    [wa, '00000000-0000-4000-8000-00000000dead', '{}'])))).code, 'P0002');
  assert.equal((await failure(() => asEditor(() => scalar('select tonde.production_search($1,$2,$3)', [wa, film, '[]' ])))).code, '22023');
});

test('§183 a creator correction outranks an old pattern and the history stays readable', async () => {
  const pattern = await setItem({ scope: 'production', kind: 'pattern', subject_key: 'camera_movement',
    statement: 'Handheld is the house style for this channel.', source: 'historical_pattern', origin: 'inferred',
    evidence: [{ artifact: 'result', result_id: resultId, observation: 'handheld used in 4 of 5 past Shots', count: 4 }],
    rationale: 'Repeated across previous Productions.' });
  assert.equal(pattern.authority_rank, 4);
  const preference = await setItem({ scope: 'production', kind: 'preference', subject_key: 'camera_movement',
    statement: 'Handheld when the scene is tense.', source: 'saved_preference' });
  assert.equal(preference.authority_rank, 3);
  const decision = await setItem({ scope: 'production', kind: 'decision', subject_key: 'camera_movement',
    statement: 'Locked off for the kitchen scene.', source: 'production_decision' });
  assert.equal(decision.authority_rank, 2);

  const before = await resolveMemory('camera_movement');
  assert.equal(before.resolved.source, 'production_decision', 'the decision outranks the preference and the pattern');
  assert.equal(before.considered.length, 3);
  assert.equal(before.considered.filter(item => item.in_force).length, 1, 'exactly one item is in force');
  const losingSources = before.considered.filter(item => !item.in_force).map(item => item.source).sort();
  assert.deepEqual(losingSources, ['historical_pattern', 'saved_preference']);

  // The creator changes their mind. That correction is authoritative from now on.
  const correction = await setItem({ scope: 'production', kind: 'correction', subject_key: 'camera_movement',
    statement: "I don't want handheld anymore.", source: 'creator_instruction' });
  assert.equal(correction.authority_rank, 1);
  const after = await resolveMemory('camera_movement');
  assert.equal(after.resolved.item_id, correction.item_id);
  assert.equal(after.resolved.source, 'creator_instruction');
  assert.equal(after.resolved.confirmed, true);
  assert.match(after.explanation, /creator instruction/);
  assert.match(after.explanation, /outranks/);
  assert.ok(after.considered.some(item => item.source === 'historical_pattern' && item.in_force === false),
    'the old pattern is still visible and explicitly not in force');
  assert.match(after.note_text, /current creator instruction outranks/);
  // Resolution is Production-scoped: the second film has no such knowledge.
  const other = await resolveIn(secondFilm, 'camera_movement');
  assert.equal(other.resolved, null);
  assert.match(other.explanation, /remembers nothing/);
});

test('memory restated in the same tier supersedes and keeps the older statement', async () => {
  const first = await setItem({ scope: 'production', kind: 'preference', subject_key: 'lighting_style',
    statement: 'Soft side light from camera left.', source: 'saved_preference' });
  const second = await setItem({ scope: 'production', kind: 'preference', subject_key: 'lighting_style',
    statement: 'Softer key, less fill.', source: 'saved_preference' });
  assert.equal(second.superseded_id, first.item_id);
  const resolved = await resolveMemory('lighting_style');
  assert.equal(resolved.resolved.item_id, second.item_id);
  assert.equal(resolved.considered.length, 1, 'a superseded statement is not still competing');
  const history = await listItems('archived');
  const old = history.items.find(item => item.item_id === first.item_id);
  assert.ok(old, 'the superseded statement stays readable');
  assert.equal(old.superseded_by, second.item_id);
  assert.match(old.retire_reason, /Superseded/);

  // An identical restatement refreshes rather than duplicating.
  const again = await setItem({ scope: 'production', kind: 'preference', subject_key: 'lighting_style',
    statement: 'Softer key, less fill.', source: 'saved_preference' });
  assert.equal(again.updated, true);
  assert.equal(again.item_id, second.item_id);
  assert.match(again.note_text, /refreshed instead of duplicated/);
});

test('memory provenance is complete: scope, tier, source object, confirmation and change', async () => {
  const created = await setItem({ scope: 'production', kind: 'technique', subject_key: 'product_emphasis',
    statement: 'Lower the camera to keep the Product in the lower third.', source: 'production_decision',
    source_object_id: realPlan, rationale: 'Product prominence is the point of the Shot.' });
  const listed = await listItems();
  const item = listed.items.find(entry => entry.item_id === created.item_id);
  assert.equal(item.scope, 'production');
  assert.equal(item.source, 'production_decision');
  assert.equal(item.origin, 'declared');
  assert.equal(item.authority_rank, 2);
  assert.equal(item.source_object_id, realPlan);
  assert.equal(item.source_revision, 1, 'the pinned revision is recorded');
  assert.equal(item.source_changed, false);
  assert.equal(item.source_object_label, 'Real plan');
  assert.equal(item.confirmed_by, A);
  assert.ok(item.confirmed_at, 'a creator-confirmed item records when it was confirmed');
  assert.equal(item.in_force, true);
  assert.ok(item.created_at);
  // Changing the object the memory was drawn from is visible rather than silent.
  await asEditor(() => db.query("update tonde.execution_plans set movement = 'slow push' where id = $1", [realPlan]));
  const after = await listItems();
  const changed = after.items.find(entry => entry.item_id === created.item_id);
  assert.equal(changed.source_changed, true, 'the pinned revision no longer matches the live object');
  assert.equal(changed.source_object_revision, 2);
});

test('an inference cannot claim creator authority, and an unconfirmed item must disclose a basis', async () => {
  const claimed = await failure(() => setItem({ scope: 'production', kind: 'preference', subject_key: 'x',
    statement: 'Handheld is required.', source: 'creator_instruction', origin: 'inferred',
    evidence: [{ artifact: 'result', result_id: resultId }] }));
  assert.equal(claimed.code, '23514');
  const baseless = await failure(() => setItem({ scope: 'production', kind: 'pattern', subject_key: 'x',
    statement: 'Handheld is required.', source: 'historical_pattern', origin: 'inferred' }));
  assert.equal(baseless.code, '23514');
  const manufactured = await failure(() => setItem({ scope: 'production', kind: 'preference', subject_key: 'x',
    statement: 'Accepted something.', source: 'saved_preference', origin: 'accepted' }));
  assert.equal(manufactured.code, '22023');
  const unknown = await failure(() => setItem({ scope: 'production', kind: 'nonsense_kind', subject_key: 'x', statement: 'y' }));
  assert.equal(unknown.code, '22023');
  const noStatement = await failure(() => setItem({ scope: 'production', kind: 'preference', subject_key: 'x', statement: '   ' }));
  assert.equal(noStatement.code, '22023');
  const foreignSource = await failure(() => setItem({ scope: 'production', kind: 'preference', subject_key: 'x',
    statement: 'y', source_object_id: '00000000-0000-4000-8000-00000000dead' }));
  assert.equal(foreignSource.code, '22023');
  // The database refuses the same things a direct write would try to smuggle in, and memory
  // tables have no direct write path at all: the guarded RPC is the only way in.
  const direct = await failure(() => asEditor(() => db.query(
    "insert into tonde.memory_items(workspace_id, production_id, scope, kind, subject_key, statement, source, origin, evidence) values ($1,$2,'production','preference','x','y','creator_instruction','inferred','[{\"artifact\":\"result\"}]'::jsonb)",
    [wa, film])));
  assert.equal(direct.code, '42501');
  const directUpdate = await failure(() => asEditor(() => db.query(
    "update tonde.memory_items set statement = 'forged' where workspace_id = $1", [wa])));
  assert.equal(directUpdate.code, '42501');
});

test('memory scopes: Production knowledge stays local, Series knowledge follows its Series, workspace knowledge applies', async () => {
  const local = await setItem({ scope: 'production', kind: 'preference', subject_key: 'kitchen_palette',
    statement: 'Warm tungsten in the kitchen.', source: 'saved_preference' });
  const workspaceWide = await setItem({ scope: 'workspace', kind: 'preference', subject_key: 'interview_greeting',
    statement: 'Always open the interview with the host on camera.', source: 'saved_preference' });
  assert.equal(workspaceWide.scope, 'workspace');
  const seriesItem = await setItem({ scope: 'series', kind: 'series_rule', subject_key: 'opening_title',
    statement: 'Every episode opens on the title card.', source: 'saved_preference' });
  assert.equal(seriesItem.scope, 'series');

  assert.ok((await resolveIn(film, 'kitchen_palette')).resolved, 'the Production finds its own knowledge');
  assert.equal((await resolveIn(secondFilm, 'kitchen_palette')).resolved, null, 'another Production does not inherit it');
  assert.ok((await resolveIn(secondFilm, 'interview_greeting')).resolved, 'workspace knowledge applies everywhere');
  assert.equal((await resolveIn(secondFilm, 'opening_title')).resolved, null,
    'Series knowledge does not reach a Production outside that Series');
  assert.ok((await resolveIn(film, 'opening_title')).resolved, 'Series knowledge applies to its own Episode');

  const localItems = await listItems('active', 'production');
  assert.ok(localItems.items.some(item => item.item_id === local.item_id));
  assert.ok(!localItems.items.some(item => item.item_id === workspaceWide.item_id), 'a scope filter really filters');
  const otherFilmItems = await asEditor(() => scalar('select tonde.memory_item_list($1,$2,$3,$4,$5,$6,$7,$8)',
    [wa, secondFilm, 'production', null, null, 'active', 200, 0]));
  assert.ok(!otherFilmItems.items.some(item => item.item_id === local.item_id), 'the list is Production-scoped too');
  assert.ok(!otherFilmItems.items.some(item => item.item_id === workspaceWide.item_id),
    'a Production-scope filter excludes workspace knowledge as well');
  const otherFilmAll = await asEditor(() => scalar('select tonde.memory_item_list($1,$2,$3,$4,$5,$6,$7,$8)',
    [wa, secondFilm, null, null, null, 'active', 200, 0]));
  assert.ok(otherFilmAll.items.some(item => item.item_id === workspaceWide.item_id),
    'workspace knowledge is listed for every Production in the workspace');
  assert.ok(!otherFilmAll.items.some(item => item.item_id === local.item_id),
    'Production knowledge is never listed for another Production');
  const summary = await memorySummary();
  assert.equal(summary.items.creator_confirmed >= 3, true);
  assert.ok(summary.by_scope.production >= 1);
  assert.ok(summary.by_source.saved_preference >= 1);
  assert.match(summary.limitations, /hidden behavioural profile/);
});

test('§141 a candidate is a proposal: nothing becomes memory until a creator decision', async () => {
  const policies = await getPolicies();
  const productionPolicy = policies.policies.find(item => item.scope === 'production');
  assert.equal(productionPolicy.explicit, false, 'the default policy is disclosed as the default');
  assert.equal(productionPolicy.candidate_capture, true);
  assert.equal(productionPolicy.auto_accept_candidates, false);

  const recorded = await recordCandidate({ kind: 'technique', subject_key: 'apartment_product_emphasis',
    statement: 'For this apartment setup, lowering the camera 20-30 cm improved Product emphasis.',
    proposed_source: 'historical_pattern', observed_count: 2,
    basis: [{ artifact: 'result', result_id: resultId, note: 'Two Shots improved after lowering the camera' }],
    source_object_id: shotTwo, source_revision: 1 });
  assert.equal(recorded.state, 'proposed');
  assert.equal(recorded.memory_item_id, null, 'recording a candidate saves no memory');
  assert.equal((await resolveMemory('apartment_product_emphasis')).resolved, null);

  const duplicate = await recordCandidate({ kind: 'technique', subject_key: 'apartment_product_emphasis',
    statement: 'For this apartment setup, lowering the camera 20-30 cm improved Product emphasis.',
    proposed_source: 'historical_pattern', observed_count: 2,
    basis: [{ artifact: 'result', result_id: resultId, note: 'Again' }],
    source_object_id: shotTwo, source_revision: 1 });
  assert.equal(duplicate.duplicate, true, 'retrying the same candidate does not duplicate it');
  assert.equal(duplicate.candidate_id, recorded.candidate_id);
  assert.equal((await listCandidates()).total, 1);

  const accepted = await decideCandidate(recorded.candidate_id, 'accept', 'Works for our apartment.');
  assert.equal(accepted.state, 'applied');
  const resolved = await resolveMemory('apartment_product_emphasis');
  assert.equal(resolved.resolved.item_id, accepted.memory_item_id);
  assert.equal(resolved.resolved.origin, 'accepted');
  assert.equal(resolved.resolved.confirmed, true, 'creator acceptance is recorded as confirmation');
  assert.equal(resolved.resolved.authority_rank, 4, 'an accepted pattern carries pattern authority, not creator-instruction authority');
  const decided = (await listCandidates('applied')).items[0];
  assert.equal(decided.decided_by, A);
  assert.match(decided.decision_note, /Works for our apartment/);
  const redecided = await decideCandidate(recorded.candidate_id, 'dismiss');
  assert.equal(redecided.state, 'applied', 'a decided candidate is not decided twice');

  const rejected = await recordCandidate({ kind: 'pattern', subject_key: 'wide_openers',
    statement: 'Open every episode on a wide.', proposed_source: 'historical_pattern',
    basis: [{ artifact: 'shot', shot_id: shotOne }], source_object_id: shotOne, source_revision: 1 });
  const dismissed = await decideCandidate(rejected.candidate_id, 'dismiss', 'Not our format.');
  assert.equal(dismissed.state, 'rejected');
  assert.equal((await resolveMemory('wide_openers')).resolved, null, 'a dismissed proposal is not memory');
  const policy = listCandidates ? (await listCandidates('rejected')).policy : null;
  assert.equal(policy.auto_accept_candidates, false);
});

test('§141 the memory policy can refuse candidates, and an auto-accepted candidate stays labelled an inference', async () => {
  await setPolicy({ scope: 'production', candidate_capture: false, note: 'Ask me first.' });
  const refused = await failure(() => recordCandidate({ kind: 'pattern', subject_key: 'refused',
    statement: 'Something.', proposed_source: 'historical_pattern', basis: [{ artifact: 'shot', shot_id: shotOne }],
    source_object_id: shotOne, source_revision: 1 }));
  assert.equal(refused.code, '23514');
  assert.equal((await listCandidates()).policy.candidate_capture, false);

  await setPolicy({ scope: 'production', candidate_capture: true, auto_accept_candidates: true, note: 'Auto-accept patterns.' });
  const auto = await recordCandidate({ kind: 'pattern', subject_key: 'auto_pattern',
    statement: 'Use a 35mm look for walk-and-talks.', proposed_source: 'historical_pattern',
    basis: [{ artifact: 'plan', plan_id: realPlan }], source_object_id: realPlan, source_revision: 2 });
  assert.equal(auto.state, 'applied');
  assert.ok(auto.memory_item_id, 'the policy created the memory item');
  const resolved = await resolveMemory('auto_pattern');
  assert.equal(resolved.resolved.origin, 'inferred', 'machine acceptance is never labelled creator confirmation');
  assert.equal(resolved.resolved.confirmed, false);
  const listed = (await listItems()).items.find(item => item.item_id === auto.memory_item_id);
  assert.equal(listed.confirmed_by, null);
  assert.equal(listed.candidate_id, auto.candidate_id);
  assert.match(auto.note_text, /until you confirm or retire it/);
  assert.equal(auto.policy.auto_accept_candidates, true);
  await setPolicy({ scope: 'production', candidate_capture: true, auto_accept_candidates: false, note: '' });
});

test('§163 a candidate whose evidence changed cannot be accepted silently', async () => {
  await setPolicy({ scope: 'production', candidate_capture: true, auto_accept_candidates: false });
  const initialRev = await asEditor(() => scalar('select revision from tonde.shots where id = $1', [shotThree]));
  const candidate = await recordCandidate({ kind: 'technique', subject_key: 'stale_pattern',
    statement: 'Push in on the reveal.', proposed_source: 'historical_pattern',
    basis: [{ artifact: 'shot', shot_id: shotThree }], source_object_id: shotThree, source_revision: initialRev });
  await asEditor(() => db.query('update tonde.shots set action = $2 where id = $1', [shotThree, 'Product hero insert revised']));
  const movedRev = await asEditor(() => scalar('select revision from tonde.shots where id = $1', [shotThree]));
  assert.equal(movedRev, initialRev + 1, 'the Shot really moved on');
  const stale = await failure(() => decideCandidate(candidate.candidate_id, 'accept'));
  assert.equal(stale.code, 'PT409', 'an accepted proposal cannot be applied against a moved revision');
  const listed = (await listCandidates()).items.find(item => item.candidate_id === candidate.candidate_id);
  assert.equal(listed.source_changed, true, 'the surface can see why');
  assert.equal((await resolveMemory('stale_pattern')).resolved, null, 'nothing was remembered');
  // Recording from the current revision is the repair. The stale candidate does not block it: it is
  // retired as superseded, stays readable, and the fresh one is a different candidate.
  const fresh = await recordCandidate({ kind: 'technique', subject_key: 'stale_pattern',
    statement: 'Push in on the reveal.', proposed_source: 'historical_pattern',
    basis: [{ artifact: 'shot', shot_id: shotThree }], source_object_id: shotThree, source_revision: movedRev });
  assert.equal(fresh.state, 'proposed');
  assert.notEqual(fresh.candidate_id, candidate.candidate_id);
  const superseded = (await listCandidates('rejected')).items.find(item => item.candidate_id === candidate.candidate_id);
  assert.ok(superseded, 'the stale candidate stays readable as history');
  assert.match(superseded.decision_note, /Superseded/);
  await decideCandidate(fresh.candidate_id, 'accept');
  assert.ok((await resolveMemory('stale_pattern')).resolved);
  // A candidate pinned to a revision that does not exist is rejected at recording time.
  const future = await failure(() => recordCandidate({ kind: 'pattern', subject_key: 'future',
    statement: 'Nope.', proposed_source: 'historical_pattern', basis: [{ artifact: 'shot', shot_id: shotOne }],
    source_object_id: shotOne, source_revision: movedRev + 50 }));
  assert.equal(future.code, 'PT409');
});

test('memory can be retired by the creator and stays readable as history', async () => {
  const item = await setItem({ scope: 'production', kind: 'preference', subject_key: 'retire_me',
    statement: 'Use the gimbal here.', source: 'saved_preference' });
  const retired = await retireItem(item.item_id, 'We sold the gimbal.');
  assert.equal(retired.retired_at !== null, true);
  assert.equal(retired.state, 'archived');
  assert.match(retired.retire_reason, /We sold the gimbal/);
  assert.equal((await resolveMemory('retire_me')).resolved, null, 'a retired item is not used');
  const history = await listItems('archived');
  assert.ok(history.items.some(entry => entry.item_id === item.item_id), 'it is still inspectable');
  const active = await listItems('active');
  assert.ok(!active.items.some(entry => entry.item_id === item.item_id));
  const again = await retireItem(item.item_id);
  assert.equal(again.state, 'archived', 'retiring twice is not an error');
});

test('memory search returns in-force state and is never a hidden profile', async () => {
  const result = await search({ text: 'handheld', kinds: ['memory'] });
  assert.equal(lanesOf(result).memory >= 1, true);
  const item = result.results.find(entry => entry.source === 'historical_pattern');
  assert.ok(item, 'the remembered pattern is searchable as a real reference');
  assert.equal(item.in_force, false, 'the old handheld pattern is shown as outranked, not hidden');
  assert.ok(item.authority_rank > 1);
  const correction = result.results.find(entry => entry.source === 'creator_instruction');
  assert.ok(correction, 'the correction that outranked it is visible next to it');
  assert.equal(correction.in_force, true, 'the creator instruction is the one in force');
  assert.equal(correction.authority_rank, 1);
  const inForce = await search({ text: 'handheld anymore', kinds: ['memory'] });
  assert.equal(inForce.results[0].in_force, true);
  const exploration = await search({ kinds: ['memory'] });
  assert.equal(exploration.interpretation.facets.length, 0, 'no facet is claimed when none was used');
  assert.ok(exploration.results.every(entry => entry.entity_id && entry.entity_type));
});

test('§212 memory and search are workspace-isolated, and a viewer may read but not write', async () => {
  const reads = [
    () => asOther(() => scalar('select tonde.memory_item_list($1,$2,$3,$4,$5,$6,$7,$8)', [wa, film, null, null, null, 'all', 50, 0])),
    () => asOther(() => scalar('select tonde.memory_resolve($1,$2,$3,$4)', [wa, film, 'camera_movement', null])),
    () => asOther(() => scalar('select tonde.memory_summary($1,$2)', [wa, film])),
    () => asOther(() => scalar('select tonde.memory_candidate_list($1,$2,$3,$4,$5)', [wa, film, null, 10, 0])),
    () => asOther(() => scalar('select tonde.memory_policy_get($1,$2)', [wa, film])),
    () => asOther(() => scalar('select tonde.production_search($1,$2,$3)', [wa, film, '{}'])),
    () => asOther(() => scalar('select tonde.memory_item_set($1,$2,$3)', [wa, film, JSON.stringify({ kind: 'preference', subject_key: 'x', statement: 'y' })])),
    () => asOther(() => scalar('select tonde.memory_candidate_decide($1,$2,$3,$4,$5)', [wa, film, '00000000-0000-4000-8000-0000000000ff', 'accept', ''])),
    () => asOther(() => scalar('select tonde.memory_policy_set($1,$2,$3)', [wa, film, JSON.stringify({ scope: 'production' })]))
  ];
  for (const action of reads) {
    const denied = await failure(action);
    assert.equal(denied.code, '42501', `expected workspace access denial, got ${denied.code}: ${denied.message}`);
  }
  // RLS hides the rows themselves from another workspace.
  const hidden = await asOther(() => scalar('select count(*)::int from tonde.memory_items where workspace_id = $1', [wa]));
  assert.equal(hidden, 0);
  const own = await asEditor(() => scalar('select count(*)::int from tonde.memory_items where workspace_id = $1', [wa]));
  assert.ok(own > 0, 'the workspace really does have memory rows');
  // Another workspace's Production id is not a way in.
  const foreign = await failure(() => asOther(() => scalar('select tonde.production_search($1,$2,$3)', [wb, film, '{}'])));
  assert.equal(foreign.code, 'P0002');

  // A viewer is a workspace member: reading is allowed, writing is not.
  const viewerRead = await asViewer(() => scalar('select tonde.memory_summary($1,$2)', [wa, film]));
  assert.ok(viewerRead.items.active > 0, 'a viewer may inspect what TONDE remembers');
  const viewerSearch = await asViewer(() => scalar('select tonde.production_search($1,$2,$3)', [wa, film, JSON.stringify({ kinds: ['shot'] })]));
  assert.equal(viewerSearch.total, 3);
  const viewerWrite = await failure(() => asViewer(() => scalar('select tonde.memory_item_set($1,$2,$3)',
    [wa, film, JSON.stringify({ kind: 'preference', subject_key: 'x', statement: 'y' })])));
  assert.equal(viewerWrite.code, '42501');
  const viewerPolicy = await failure(() => asViewer(() => scalar('select tonde.memory_policy_set($1,$2,$3)',
    [wa, film, JSON.stringify({ scope: 'production', candidate_capture: false })])));
  assert.equal(viewerPolicy.code, '42501');
});

test('memory rows have no direct write path and the guard owns the revision', async () => {
  const target = (await listItems()).items[0];
  for (const statement of [
    ['update tonde.memory_items set workspace_id = $2 where id = $1', [target.item_id, wb]],
    ['update tonde.memory_items set revision = 99 where id = $1', [target.item_id]],
    ['update tonde.memory_policies set note = $2 where workspace_id = $1', [wa, 'forged']],
    ['insert into tonde.memory_candidates(workspace_id, production_id, kind, subject_key, statement, basis, source_object_id, source_revision) values ($1,$2,\'preference\',\'forged\',\'forged\',\'[{"artifact":"shot"}]\'::jsonb,$3,1)', [wa, film, shotOne]]
  ]) {
    const denied = await failure(() => asEditor(() => db.query(statement[0], statement[1])));
    assert.equal(denied.code, '42501', `direct write must be impossible: ${statement[0]}`);
  }
  // The revision is still database-managed through the guarded RPCs.
  await setPolicy({ scope: 'production', candidate_capture: true, auto_accept_candidates: false, note: 'first' });
  await setPolicy({ scope: 'production', candidate_capture: true, auto_accept_candidates: false, note: 'second' });
  const revision = await asEditor(() => scalar(
    "select revision from tonde.memory_policies where workspace_id = $1 and scope = 'production'", [wa]));
  assert.ok(revision >= 2, 'the guard bumped the policy revision instead of overwriting identity');
  const stored = await asEditor(() => scalar(
    "select note from tonde.memory_policies where workspace_id = $1 and scope = 'production'", [wa]));
  assert.equal(stored, 'second');
});
