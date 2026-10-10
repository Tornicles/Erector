import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 11 packet 043 — the Director correction, on real embedded PostgreSQL over one 001->043 stack.
// These tests pin the owner's product law: TONDE is the production Director and the media is made in the
// creator's own external tool. Tool knowledge is documented, sourced, reviewed knowledge rather than an
// API connection; a kit names the tools the creator actually has; the playbook compiles a tool-specific
// prompt from the Shot's plan; every Result returns to TONDE to be checked against the playbook, and a
// FIX produces the next prompt. The whole path must work with no media-generation credential configured,
// and TONDE must never claim to have executed anything.
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

const boundary = () => asOwner(() => rows('select tonde.ai_director_boundary() as result')
  .then(result => result[0].result));
const profileSave = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.ai_tool_profile_save($1,$2,$3) as result',
  [over.workspace ?? wa, over.tool_key ?? 'veo', JSON.stringify(over.payload ?? {})])
  .then(result => result[0].result));
const profileReview = (profile, decision, note = '', user = A) => asUser(user, () => rows(
  'select tonde.ai_tool_profile_review($1,$2,$3,$4) as result', [wa, profile, decision, note])
  .then(result => result[0].result));
const catalogRead = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.ai_tool_catalog($1,$2,$3) as result',
  [over.workspace ?? wa, over.capability_type ?? null, over.include_drafts ?? false])
  .then(result => result[0].result));
const kitSet = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.production_ai_tool_set($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [over.workspace ?? wa, over.production, over.tool_key ?? 'veo', over.display_name ?? null,
   over.profile_id ?? null, over.note ?? '', over.remove ?? false, over.sort_order ?? null])
  .then(result => result[0].result));
const playbook = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.ai_playbook_for_shot($1,$2,$3,$4) as result',
  [over.workspace ?? wa, over.production, over.shot, over.tool_key ?? null])
  .then(result => result[0].result));
const promptCompile = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.ai_playbook_prompt_compile($1,$2,$3,$4,$5) as result',
  [over.workspace ?? wa, over.production, over.shot, over.tool_key ?? null, over.plan_revision ?? null])
  .then(result => result[0].result));
const checkResult = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.ai_result_check($1,$2,$3,$4,$5) as result',
  [over.workspace ?? wa, over.production, over.shot, over.result, JSON.stringify(over.payload ?? {})])
  .then(result => result[0].result));
const history = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.ai_playbook_history($1,$2,$3,$4) as result',
  [over.workspace ?? wa, over.production, over.shot, over.limit ?? 50])
  .then(result => result[0].result));

let sequence = 0;
// A Production with three Shots: one AI Shot with a saved AI plan, one practical Shot, one Hybrid Shot.
async function newProduction(label = 'director') {
  sequence += 1;
  return asOwner(async () => {
    const project = await scalar('insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id',
      [wa, `Director ${label}`, A]);
    const production = await scalar('insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id',
      [wa, project, `Director Production ${label}`, A]);
    const scene = await scalar('insert into tonde.scenes(workspace_id,production_id,title,description) values($1,$2,$3,$4) returning id',
      [wa, production, `Scene ${label}`, 'A rooftop at dusk']);
    const aiShot = await scalar(`insert into tonde.shots(workspace_id,production_id,scene_id,title,description,action,
      sort_order,execution_method) values($1,$2,$3,$4,$5,$6,$7,'ai') returning id`,
      [wa, production, scene, 'Hero approach', 'The pilot walks towards the aircraft',
       'Slow walk, coat moving in the wind', 1024 * sequence]);
    const realShot = await scalar(`insert into tonde.shots(workspace_id,production_id,scene_id,title,description,
      sort_order,execution_method) values($1,$2,$3,$4,$5,$6,'real') returning id`,
      [wa, production, scene, 'Cockpit hands', 'Close on the hands on the controls', 2048 * sequence]);
    const hybridShot = await scalar(`insert into tonde.shots(workspace_id,production_id,scene_id,title,description,
      sort_order,execution_method) values($1,$2,$3,$4,$5,$6,'hybrid') returning id`,
      [wa, production, scene, 'Actor against generated skyline', 'The actor walks on a clean stage',
       3072 * sequence]);
    return { project, production, scene, aiShot, realShot, hybridShot };
  });
}

// The Shot's plan is what the playbook is compiled from. A plan is written by the Studio's own path in
// the product; these tests insert the saved plan directly so the Director read is what is under test.
async function saveAiPlan(production, shot, over = {}) {
  const plan = await asService(() => scalar(`insert into tonde.execution_plans(workspace_id,production_id,shot_id,
    execution_method,provider_target,canonical_prompt,provider_prompt,prompt_version,aspect_ratio,
    expected_duration_ms,negative_constraints,first_frame,motion,audio,continuity,plan_status)
    values($1,$2,$3,'ai',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ready') returning id`,
    [wa, production, shot, over.provider_target ?? 'veo', JSON.stringify(over.canonical_prompt ?? { sections: {} }),
     over.provider_prompt ?? 'A wide shot of the pilot walking towards the aircraft at dusk.',
     over.prompt_version ?? 1, over.aspect_ratio ?? '16:9', over.expected_duration_ms ?? 12000,
     over.negative_constraints ?? ['no text overlays'], JSON.stringify(over.first_frame ?? {}),
     JSON.stringify(over.motion ?? { needed: true }), JSON.stringify(over.audio ?? {}),
     JSON.stringify(over.continuity ?? { keep_wardrobe: true })]));
  // Approving a plan is a creator decision, so it is made by the authenticated owner rather than written
  // by the server role, which the human-acceptance guard refuses by design.
  await asOwner(() => db.query("update tonde.execution_plans set approval = 'approved' where id = $1", [plan]));
  return plan;
}

// A Result is what the creator uploads back after executing externally: a media row and the Result.
async function uploadResult(production, shot, label = 'v1') {
  return asOwner(async () => {
    // The object key is derived from the workspace and the media identity, which the database enforces.
    const mediaId = crypto.randomUUID();
    const media = await scalar(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,
      mime_type,file_category,bytes,created_by) values($1,$2,'tonde-results',$3,$4,'image/png','image',2048,$5) returning id`,
      [mediaId, wa, `${wa}/${mediaId}/${label}.png`, `${label}.png`, A]);
    const result = await scalar(`insert into tonde.results(workspace_id,production_id,shot_id,media_id,provenance)
      values($1,$2,$3,$4,$5) returning id`,
      [wa, production, shot, media, JSON.stringify({ executed_with: 'external_tool' })]);
    return { media, result };
  });
}

const criteriaFor = (passing, failing = [], failingSeverity = 'material') => [
  ...passing.map(criterion => ({ criterion, result: 'pass' })),
  ...failing.map(criterion => ({ criterion, result: 'fail', severity: failingSeverity })),
];

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
  await asService(async () => {
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')", [wa, C]);
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [wa, D]);
  });
});

after(async () => { await db?.close(); });

test('the Director boundary is stated by the database and the check criteria are a closed set', async () => {
  const law = await boundary();
  assert.equal(law.product_role, 'director');
  assert.equal(law.direct_media_generation, false);
  assert.equal(law.generation_provider_required, false);
  assert.equal(law.media_generation_provider_dependency, 'none for the core product');
  assert.equal(law.ai_creation, 'external tool playbook plus result checking');
  assert.deepEqual(law.execution_strategies, ['real', 'ai', 'hybrid']);
  assert.equal(law.tonde_generates_final_media, false);
  assert.equal(law.external_tools_are_tonde_truth, false);
  assert.equal(law.results_return_to_tonde, true);
  assert.equal(law.tonde_compiles_prompts_for_external_tools, true);
  assert.equal(law.tonde_evaluates_results, true);
  assert.equal(law.tool_knowledge_is_documented_and_sourced, true);
  assert.equal(law.optional_future_connector, 'allowed, optional, and not built');
  // A client may read the boundary; nobody may rewrite it, because it is a function of the code.
  assert.equal(await scalar(`select has_function_privilege('authenticated',
    'tonde.ai_director_boundary()', 'EXECUTE')`), true);
  // The boundary is a statement of law read from the code, so it reads no table and needs no elevated
  // rights: exactly one such function exists and it is not a security definer.
assert.deepEqual(await rows(`select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'ai_director_boundary'`), [{ prosecdef: false }]);
  // The criteria a check compares are a closed set, and the set is the one the product names.
  const criteria = await rows(`select unnest(tonde_private.ai_playbook_criteria()) as criterion`);
  assert.deepEqual(criteria.map(row => row.criterion).sort(), ['camera_movement', 'composition', 'continuity',
    'environment', 'lighting', 'performance', 'props', 'reference_relationship', 'shot_objective',
    'subject_identity', 'timing', 'wardrobe']);
  // The durable worker vocabulary carries no media-generation provider class: the AI job types are
  // TONDE's own intelligence and compilation work.
  const work = await rows("select job_type, worker_class, description from tonde.job_type_definitions where worker_class = 'ai' order by job_type");
  assert.deepEqual(work.map(row => row.job_type), ['long_form_generation', 'production_generation',
    'prompt_compilation', 'reference_analysis', 'shot_match', 'story_generation', 'transcription']);
  for (const entry of work) {
    assert.equal(/image generation provider|video generation provider|fal\.ai|replicate/i.test(entry.description),
      false, `${entry.job_type} must not describe a media-generation provider call`);
  }
  for (const entry of work) {
    assert.equal(/provider call bills for work|calls? a(?:n)? .*provider to (?:make|produce) media/i.test(entry.description),
      false, `${entry.job_type} must describe TONDE's own work`);
  }
});

test('documented tool knowledge is a draft until a person reviews it, and it names its source', async () => {
  const drafted = await profileSave({ tool_key: 'veo', payload: { display_name: 'Veo', capability_type: 'video_generation',
    media_kind: 'video', input_types: ['text', 'image'], supports_reference_image: true,
    supports_first_frame: true, supports_negative_prompt: false, max_duration_ms: 8000,
    aspect_ratios: ['16:9'], prompt_characteristics: 'Describe the camera move in one clause; the model does not honour negatives.',
    tool_version: '2026-08', documented_at: '2026-08-01' } });
  assert.equal(drafted.created, true);
  assert.equal(drafted.review_state, 'draft');
  assert.equal(drafted.usable_for_direction, false);
  assert.equal(drafted.source_title, null);
  assert.match(drafted.meaning, /does not apply it/);
  // A draft may be corrected in place, and the revision moves.
  const corrected = await profileSave({ tool_key: 'veo', payload: { display_name: 'Veo', tool_version: '2026-08',
    known_limitations: 'Struggles with legible text.', source_title: 'Veo prompting guide',
    source_url: 'https://example.invalid/veo/prompting', source_kind: 'manufacturer' } });
  assert.equal(corrected.created, false);
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.known_limitations, 'Struggles with legible text.');
  // A reviewer approves it, and knowledge TONDE will rely on has to name its documentation.
  const reviewed = await profileReview(drafted.profile_id, 'review', 'Read the guide, it matches the tool.');
  assert.equal(reviewed.review_state, 'reviewed');
  assert.equal(reviewed.usable_for_direction, true);
  assert.equal(reviewed.source_title, 'Veo prompting guide');
  assert.equal((await profileReview(drafted.profile_id, 'review')).idempotent, true);
  // Reviewed knowledge is not silently rewritten: the same version is refused, a new version is a record.
  const rewrite = await failure(() => profileSave({ tool_key: 'veo', payload: { tool_version: '2026-08',
    known_limitations: 'Something else now.' } }));
  assert.equal(rewrite.code, 'PT409');
  assert.match(rewrite.message, /TOOL_PROFILE_VERSION_REQUIRED/);
  const versioned = await profileSave({ tool_key: 'veo', payload: { display_name: 'Veo', tool_version: '2026-09',
    capability_type: 'video_generation', media_kind: 'video', max_duration_ms: 10000,
    prompt_characteristics: 'Longer takes are supported as of this version.', source_title: 'Veo release notes' } });
  assert.equal(versioned.created, true);
  assert.equal(versioned.revision, 1);
  assert.equal(Number(await scalar(`select count(*)::int from tonde.ai_tool_profiles
    where workspace_id = $1 and tool_key = 'veo'`, [wa])), 2, 'both versions remain readable');
  assert.equal(await scalar(`select known_limitations from tonde.ai_tool_profiles
    where id = $1`, [drafted.profile_id]), 'Struggles with legible text.');
  // Unsourced knowledge cannot be relied on, and authority is separated: an editor maintains, an admin reviews.
  const unsourced = await profileSave({ tool_key: 'unknown_tool', payload: { display_name: 'Unknown tool',
    tool_version: '1' } });
  const needsSource = await failure(() => profileReview(unsourced.profile_id, 'review'));
  assert.equal(needsSource.code, 'PT400');
  assert.match(needsSource.message, /TOOL_PROFILE_NEEDS_SOURCE/);
  const editorReviews = await failure(() => profileReview(unsourced.profile_id, 'review', 'looks fine', C));
  assert.equal(editorReviews.code, '42501');
  const viewerSaves = await failure(() => profileSave({ tool_key: 'veo', payload: { tool_version: '2026-10' } }, D));
  assert.equal(viewerSaves.code, '42501');
  const strangerSaves = await failure(() => profileSave({ tool_key: 'veo', payload: {} }, B));
  assert.equal(strangerSaves.code, '42501');
  // Retiring keeps the record and names why or what replaced it.
  const retired = await profileReview(drafted.profile_id, 'retire', 'Superseded by the 2026-09 version.');
  assert.equal(retired.review_state, 'retired');
  assert.equal(retired.superseded_by, versioned.profile_id);
  // Retiring the only remaining live version without a note is refused: a retirement is explained.
  const noReason = await failure(() => profileReview(versioned.profile_id, 'retire', '   '));
  assert.equal(noReason.code, '22023');
  assert.match(noReason.message, /says why, or names the version that replaces it/);
  const badDecision = await failure(() => profileReview(versioned.profile_id, 'promote'));
  assert.equal(badDecision.code, '22023');
  // Put the reviewed 2026-09 knowledge back so later tests direct with it.
  await asService(() => db.query(`update tonde.ai_tool_profiles set review_state = 'reviewed',
    reviewed_by = $2, reviewed_at = now(), superseded_by = null where id = $1`, [versioned.profile_id, A]));
});

test('the tool catalog is knowledge with provenance, never a connection', async () => {
  const read = await catalogRead();
  const veo = read.tools.find(tool => tool.tool_key === 'veo');
  assert.notEqual(veo, undefined);
  assert.equal(read.count, read.tools.length);
  assert.equal(veo.review_state, 'reviewed');
  assert.equal(veo.tonde_connection, 'none');
  assert.equal(veo.source_title, 'Veo release notes');
  assert.equal(veo.tool_version, '2026-09');
  assert.equal(Number(veo.max_duration_ms), 10000);
  assert.equal(read.meaning.includes('not a list of API connections'), true);
  assert.equal(read.meaning.includes('can run that tool or bill for it'), true);
  // A draft is not knowledge TONDE relies on, and asking for drafts says so.
  const withDrafts = await catalogRead({ include_drafts: true });
  assert.equal(withDrafts.tools.some(tool => tool.review_state === 'draft'), true);
  assert.equal(withDrafts.returned_drafts, true);
  // The capability filter is a closed vocabulary.
  const videoTools = await catalogRead({ capability_type: 'video_generation' });
  assert.equal(videoTools.tools.every(tool => tool.capability_type === 'video_generation'), true);
  const badCapability = await failure(() => catalogRead({ capability_type: 'make_anything' }));
  assert.equal(badCapability.code, '22023');
  // Another workspace sees none of it and may not read it.
  assert.equal(Number(await asStranger(() => scalar(
    'select count(*)::int from tonde.ai_tool_profiles where workspace_id = $1', [wa]))), 0);
  assert.equal((await failure(() => catalogRead({}, B))).code, '42501');
  const viewerRead = await asViewer(() => rows('select tonde.ai_tool_catalog($1,$2,$3) as result',
    [wa, null, false]).then(result => result[0].result));
  assert.equal(viewerRead.count >= 1, true, 'a viewer is a member and may read the catalog');
});

test('the Production Kit names the tools the creator actually has', async () => {
  const { production } = await newProduction('kit');
  const veo = (await catalogRead()).tools.find(tool => tool.tool_key === 'veo');
  const added = await kitSet({ production, tool_key: 'veo', display_name: 'Veo', profile_id: veo.profile_id,
    note: 'The one I pay for' });
  assert.equal(added.created, true);
  assert.equal(added.tool_profile_id, veo.profile_id);
  assert.match(added.meaning, /needs no credential/);
  const again = await kitSet({ production, tool_key: 'veo', note: 'Updated note' });
  assert.equal(again.created, false);
  // A profile of a different tool cannot be attached to this tool.
  const mismatch = await failure(() => kitSet({ production, tool_key: 'kling', profile_id: veo.profile_id }));
  assert.equal(mismatch.code, '22023');
  assert.match(mismatch.message, /not a profile of this tool/);
  const missingProduction = await failure(() => kitSet({ production: '00000000-0000-4000-8000-00000000dead' }));
  assert.equal(missingProduction.code, 'P0002');
  const badKey = await failure(() => kitSet({ production, tool_key: 'Veo Pro' }));
  assert.equal(badKey.code, '22023');
  // The kit is tenant data.
  assert.equal(Number(await asStranger(() => scalar(
    'select count(*)::int from tonde.production_ai_tools where workspace_id = $1', [wa]))), 0);
  assert.equal((await failure(() => kitSet({ production, tool_key: 'sora' }, B))).code, '42501');
  assert.equal((await failure(() => kitSet({ production, tool_key: 'sora' }, D))).code, '42501',
    'a viewer may read the kit but not change it');
  // Removing is idempotent and audited.
  const removed = await kitSet({ production, tool_key: 'veo', remove: true });
  assert.equal(removed.removed, true);
  const removedAgain = await kitSet({ production, tool_key: 'veo', remove: true });
  assert.equal(removedAgain.idempotent, true);
  assert.equal(Number(await scalar(`select count(*)::int from tonde.audit_events
    where workspace_id = $1 and event_type = 'production_ai_tool.removed'`, [wa])), 1);
});

test('a playbook needs the Shot AI plan, and then it is direction rather than generation', async () => {
  const { production, aiShot, realShot } = await newProduction('playbook');
  // A Shot with no saved AI plan is still readable as direction: TONDE says there is no plan yet rather
  // than refusing to show the Shot. The prompt is what cannot be compiled without a plan.
  const unplanned = await playbook({ production, shot: aiShot });
  assert.equal(unplanned.execution.has_ai_plan, false);
  assert.equal(unplanned.prompt, null);
  assert.equal(unplanned.tool_knowledge.status, 'absent');
  assert.match(unplanned.tool_knowledge.detail, /No AI plan is saved for this Shot/);
  const unplannedPrompt = await failure(() => promptCompile({ production, shot: aiShot }));
  assert.equal(unplannedPrompt.code, 'PT404');
  assert.match(unplannedPrompt.message, /PLAYBOOK_NEEDS_PLAN/);
  await saveAiPlan(production, aiShot);
  const read = await playbook({ production, shot: aiShot });
  assert.equal(read.shot_id, aiShot);
  assert.equal(read.execution.has_ai_plan, true);
  assert.equal(read.execution.plan_approval, 'approved');
  assert.equal(read.execution.prompt_version, 1);
  assert.deepEqual(read.execution.strategies, ['real', 'ai', 'hybrid']);
  assert.equal(read.shot_objective.title, 'Hero approach');
  assert.equal(read.settings.aspect_ratio, '16:9');
  assert.equal(Number(read.settings.expected_duration_ms), 12000);
  assert.equal(read.target_media, 'video', 'a moving Shot targets video');
  assert.equal(typeof read.prompt, 'string');
  assert.match(read.prompt, /SHOT: Hero approach/);
  assert.match(read.prompt, /ASPECT RATIO: 16:9/);
  assert.match(read.prompt, /DURATION: 12000 ms/);
  assert.match(read.prompt, /MUST NOT APPEAR: no text overlays/);
  assert.equal(read.evaluation_criteria.length, 12);
  for (const entry of read.evaluation_criteria) assert.equal(typeof entry.what_tonde_checks, 'string');
  assert.equal(read.expected_result.deliverable, 'video');
  assert.match(read.expected_result.detail, /return point/);
  assert.equal(read.last_check, null);
  assert.equal(read.cost.resold_by_tonde, false);
  assert.match(read.meaning, /The media is produced in your tool/);
  assert.match(read.meaning, /direction, not generation/);
  // A practical Shot has no AI plan, so the AI playbook reports that rather than inventing one.
  const practical = await playbook({ production, shot: realShot });
  assert.equal(practical.execution.has_ai_plan, false);
  assert.equal(practical.prompt, null);
  assert.equal(practical.evaluation_criteria.length, 12, 'the criteria still say how a Result is judged');
  // The read is tenant data.
  assert.equal((await failure(() => playbook({ production, shot: aiShot }, B))).code, '42501');
  assert.notEqual(await asViewer(() => playbook({ production, shot: aiShot })), null);
  // A stale plan revision is refused rather than silently directed from, with the mapped conflict code
  // that a transport can actually return.
  const stale = await failure(() => promptCompile({ production, shot: aiShot, plan_revision: 99 }));
  assert.equal(stale.code, 'PT409');
  assert.match(stale.message, /changed since you loaded it/);
});

test('the prompt adapts to the tool the creator chose, and every adaptation is named', async () => {
  const { production, aiShot } = await newProduction('adapt');
  await saveAiPlan(production, aiShot);
  // Kling is documented with longer takes and a separate negative prompt; Veo is not.
  const kling = await profileSave({ tool_key: 'kling', payload: { display_name: 'Kling', capability_type: 'video_generation',
    media_kind: 'video', input_types: ['text', 'image'], supports_reference_image: true,
    supports_negative_prompt: true, max_duration_ms: 30000, aspect_ratios: ['16:9', '9:16'],
    prompt_characteristics: 'Reads a comma-separated subject, action and camera clause.',
    workflow_guidance: 'Generate two candidates and pick the take.', source_title: 'Kling user guide',
    source_kind: 'manufacturer', tool_version: '2026-05' } });
  const prepared = await profileReview(kling.profile_id, 'review', 'Matches the guide.');
  assert.equal(prepared.usable_for_direction, true);
  await kitSet({ production, tool_key: 'kling', profile_id: kling.profile_id });
  await kitSet({ production, tool_key: 'veo', profile_id: undefined });
  const veo = (await catalogRead()).tools.filter(tool => tool.tool_key === 'veo').sort((left, right) => right.revision - left.revision)[0];
  await kitSet({ production, tool_key: 'veo', profile_id: veo.profile_id });
  const forVeo = await promptCompile({ production, shot: aiShot, tool_key: 'veo' });
  const forKling = await promptCompile({ production, shot: aiShot, tool_key: 'kling' });
  assert.notEqual(forVeo.prompt, forKling.prompt, 'the same Shot compiles differently per tool');
  assert.match(forVeo.prompt, /TOOL NOTES \(veo\)/);
  assert.match(forKling.prompt, /TOOL NOTES \(kling\)/);
  assert.match(forKling.prompt, /TOOL WORKFLOW: Generate two candidates/);
  // Veo documents eight to ten seconds and no negative prompt; the twelve second Shot is a real conflict.
  assert.equal(forVeo.conflicts.includes('duration_beyond_documented_limit'), true);
  assert.equal(forVeo.conflicts.includes('negative_prompt_unsupported'), true);
  assert.equal(forKling.conflicts.length, 0);
  const split = forVeo.adaptations.find(entry => entry.kind === 'duration_split_required');
  assert.notEqual(split, undefined);
  assert.equal(Number(split.planned_duration_ms), 12000);
  assert.equal(Number(split.documented_max_duration_ms) <= 12000, true);
  const phrasing = forVeo.adaptations.find(entry => entry.kind === 'negative_prompt_needs_phrasing');
  assert.notEqual(phrasing, undefined);
  assert.match(phrasing.detail, /phrased inside the prompt/);
  // Knowledge state is reported with the prompt, and the tool is still not a connection.
  assert.equal(forVeo.knowledge_status, 'reviewed');
  assert.equal(forKling.knowledge_status, 'reviewed');
  assert.equal(forVeo.tool_connection, 'none');
  assert.equal((await failure(() => promptCompile({ production, shot: aiShot, tool_key: 'sora' }))).code, 'PT404');
  assert.equal(String((await failure(() => promptCompile({ production, shot: aiShot, tool_key: 'sora' }))).message)
    .includes('TOOL_NOT_IN_KIT'), true);
});

test('knowledge TONDE does not have is reported, never guessed', async () => {
  const { production, aiShot } = await newProduction('unknown-tool');
  await saveAiPlan(production, aiShot);
  await kitSet({ production, tool_key: 'runway', display_name: 'Runway' });
  const compiled = await promptCompile({ production, shot: aiShot, tool_key: 'runway' });
  assert.equal(compiled.knowledge_status, 'absent');
  assert.equal(compiled.knowledge.applied, false);
  assert.equal(compiled.knowledge.profile, null);
  assert.match(compiled.knowledge.detail, /without tool-specific notes rather than guessed/);
  assert.equal(compiled.prompt.includes('TOOL NOTES'), false);
  assert.match(compiled.prompt, /SHOT: Hero approach/, 'the playbook is still compiled');
  assert.deepEqual(compiled.adaptations, []);
  assert.deepEqual(compiled.conflicts, []);
  // A draft is reported and deliberately not applied.
  await profileSave({ tool_key: 'runway', payload: { display_name: 'Runway', tool_version: '1',
    prompt_characteristics: 'Someone typed this without reading anything.',
    max_duration_ms: 5000, supports_negative_prompt: false } });
  const draft = await promptCompile({ production, shot: aiShot, tool_key: 'runway' });
  assert.equal(draft.knowledge_status, 'draft');
  assert.equal(draft.knowledge.applied, false);
  assert.equal(draft.knowledge.profile.prompt_characteristics,
    'Someone typed this without reading anything.');
  assert.equal(draft.prompt.includes('Someone typed this'), false,
    'unreviewed knowledge must not change the prompt');
  assert.equal(draft.conflicts.includes('duration_beyond_documented_limit'), false,
    'a draft limit does not raise a conflict either');
  // The playbook read reports the same state, and the recommendation never pretends otherwise.
  const read = await playbook({ production, shot: aiShot, tool_key: 'runway' });
  assert.equal(read.tool_knowledge.status, 'draft');
  assert.match(read.why, /nobody reviewed it/);
  assert.equal(read.recommended_tool, 'runway');
});

test('a Result returns to TONDE and is checked against the playbook', async () => {
  const { production, aiShot, hybridShot } = await newProduction('check');
  await saveAiPlan(production, aiShot);
  const uploaded = await uploadResult(production, aiShot, 'v1');
  // A FIX without instructions is not direction.
  const uninstructed = await failure(() => checkResult({ production, shot: aiShot, result: uploaded.result,
    payload: { verdict: 'fix', criteria: criteriaFor([], ['composition']) } }));
  assert.equal(uninstructed.code, '22023');
  // An ACCEPT cannot coexist with a material failure.
  const contradictory = await failure(() => checkResult({ production, shot: aiShot, result: uploaded.result,
    payload: { verdict: 'accept', criteria: criteriaFor(['composition'], ['lighting']) } }));
  assert.equal(contradictory.code, 'PT409');
  assert.match(contradictory.message, /CHECK_CONTRADICTS_ITSELF/);
  // The check itself: two material failures, an instruction, and the next prompt in the same answer.
  const checked = await checkResult({ production, shot: aiShot, result: uploaded.result, payload: {
    verdict: 'fix', tool_key: 'veo', prompt_text: 'The prompt I ran in Veo',
    instructions: 'Hold the camera still and keep the coat closed; the wind lifted it out of continuity.',
    criteria: criteriaFor(['shot_objective', 'timing', 'environment'], ['continuity', 'wardrobe']),
    findings: [{ criterion: 'wardrobe', note: 'Coat opens at the half-way mark.' }] } });
  assert.equal(checked.verdict, 'fix');
  assert.equal(checked.severity, 'critical');
  assert.equal(checked.tool_key, 'veo');
  assert.match(checked.instructions, /keep the coat closed/);
  assert.match(checked.next_prompt, /CORRECTION FROM THE LAST CHECK: Hold the camera still/);
  assert.match(checked.next_prompt, /SHOT: Hero approach/);
  assert.equal(checked.prompt_checked, 'The prompt I ran in Veo');
  assert.equal(checked.next_step.includes('Run the next prompt in your external tool'), true);
  assert.match(checked.meaning, /It did not produce the media/);
  assert.equal(checked.criteria.find(entry => entry.criterion === 'continuity').result, 'fail');
  assert.equal(checked.criteria.find(entry => entry.criterion === 'continuity').severity, 'material');
  assert.equal(checked.what_changed.previous_check_id, null);
  // The check is evidence: a client cannot rewrite it, and it names who checked and when.
  assert.equal(Number(await scalar(`select has_table_privilege('authenticated', 'tonde.shot_match_reports', 'UPDATE')`)), 0);
  assert.equal(Number(await scalar('select checked_by::text = $1::text from tonde.shot_match_reports where id = $2',
    [A, checked.check_id])), 1);
  // A Result of another Shot is not this Shot's Result, and another workspace is not this one.
  const other = await uploadResult(production, hybridShot, 'other');
  assert.equal((await failure(() => checkResult({ production, shot: aiShot, result: other.result,
    payload: { verdict: 'accept', criteria: criteriaFor(['composition']) } }))).code, 'PT409');
  assert.equal((await failure(() => checkResult({ production, shot: aiShot,
    result: '00000000-0000-4000-8000-00000000beef',
    payload: { verdict: 'accept', criteria: criteriaFor(['composition']) } }))).code, 'P0002');
  assert.equal((await failure(() => checkResult({ production, shot: aiShot, result: uploaded.result,
    payload: { verdict: 'accept', criteria: criteriaFor(['composition']) } }, B))).code, '42501');
  assert.equal((await failure(() => checkResult({ production, shot: aiShot, result: uploaded.result,
    payload: { verdict: 'accept', criteria: criteriaFor(['composition']) } }, D))).code, '42501');
});

test('a check judges only the criteria the product names, and an unknown one is refused', async () => {
  const { production, aiShot } = await newProduction('criteria');
  await saveAiPlan(production, aiShot);
  const uploaded = await uploadResult(production, aiShot, 'criteria');
  const invented = await failure(() => checkResult({ production, shot: aiShot, result: uploaded.result,
    payload: { verdict: 'accept', criteria: [{ criterion: 'vibes', result: 'pass' }] } }));
  assert.equal(invented.code, '22023');
  assert.match(invented.message, /CHECK_CRITERION_UNKNOWN/);
  const empty = await failure(() => checkResult({ production, shot: aiShot, result: uploaded.result,
    payload: { verdict: 'accept', criteria: [] } }));
  assert.equal(empty.code, '22023');
  const badVerdict = await failure(() => checkResult({ production, shot: aiShot, result: uploaded.result,
    payload: { verdict: 'maybe', criteria: criteriaFor(['composition']) } }));
  assert.equal(badVerdict.code, '22023');
  // An advisory failure can be accepted: severity decides, and the check records it either way.
  const advisory = await checkResult({ production, shot: aiShot, result: uploaded.result, payload: {
    verdict: 'accept', criteria: criteriaFor(['composition', 'lighting'], ['props'], 'advisory') } });
  assert.equal(advisory.verdict, 'accept');
  assert.equal(advisory.instructions, null);
  assert.equal(advisory.criteria.find(entry => entry.criterion === 'props').severity, 'advisory');
});

test('the iteration records what changed between attempts and closes on acceptance', async () => {
  const { production, aiShot } = await newProduction('iterate');
  await saveAiPlan(production, aiShot);
  const first = await uploadResult(production, aiShot, 'attempt-1');
  const checkOne = await checkResult({ production, shot: aiShot, result: first.result, payload: {
    verdict: 'fix', tool_key: 'veo', instructions: 'Steady the camera and close the coat.',
    criteria: criteriaFor(['shot_objective'], ['continuity', 'wardrobe', 'camera_movement']) } });
  const second = await uploadResult(production, aiShot, 'attempt-2');
  const checkTwo = await checkResult({ production, shot: aiShot, result: second.result, payload: {
    verdict: 'fix', tool_key: 'veo', instructions: 'Only the coat remains: keep it closed through the turn.',
    criteria: criteriaFor(['shot_objective', 'continuity', 'camera_movement'],
      ['wardrobe', 'performance']) } });
  assert.equal(checkTwo.what_changed.previous_check_id, checkOne.check_id);
  assert.equal(checkTwo.what_changed.previous_verdict, 'fix');
  assert.deepEqual(checkTwo.what_changed.criteria_now_passing.sort(), ['camera_movement', 'continuity']);
  assert.deepEqual(checkTwo.what_changed.criteria_still_failing, ['wardrobe']);
  assert.deepEqual(checkTwo.what_changed.criteria_newly_failing, ['performance']);
  assert.match(checkTwo.next_prompt, /CORRECTION FROM THE LAST CHECK: Only the coat remains/);
  const third = await uploadResult(production, aiShot, 'attempt-3');
  const accepted = await checkResult({ production, shot: aiShot, result: third.result, payload: {
    verdict: 'accept', tool_key: 'veo',
    criteria: criteriaFor(['shot_objective', 'continuity', 'camera_movement', 'wardrobe', 'performance',
      'composition', 'lighting', 'timing', 'environment', 'subject_identity', 'props', 'reference_relationship']) } });
  assert.equal(accepted.verdict, 'accept');
  assert.equal(accepted.next_prompt, null);
  assert.equal(accepted.what_changed.criteria_still_failing.length, 0);
  assert.equal(accepted.what_changed.criteria_newly_failing.length, 0);
  // Each check is compared with the one before it: the second attempt fixed the camera and continuity,
  // and the third fixed the wardrobe and the performance.
  assert.equal(checkOne.what_changed.previous_check_id, null);
  assert.equal(checkOne.what_changed.criteria_now_passing, undefined,
    'the first check on a Shot has nothing earlier to compare with');
  assert.deepEqual(checkTwo.what_changed.criteria_now_passing.sort(), ['camera_movement', 'continuity']);
  assert.deepEqual(accepted.what_changed.criteria_now_passing.sort(), ['performance', 'wardrobe']);
  // The history is the loop in order, and TONDE never executed the media.
  const trail = await history({ production, shot: aiShot });
  assert.deepEqual(trail.checks.map(entry => entry.verdict), ['fix', 'fix', 'accept']);
  assert.equal(trail.checks[0].previous_check_id, null);
  assert.equal(trail.checks[2].previous_check_id, checkTwo.check_id);
  assert.equal(trail.attempts.length, 0, 'TONDE executed nothing: the creator did');
  assert.equal(trail.meaning.includes('was never produced by TONDE'), true);
  assert.equal(Number(await scalar(`select count(*)::int from tonde.shot_match_reports
    where workspace_id = $1 and shot_id = $2 and verdict is not null`, [wa, aiShot])), 3);
  const capped = await failure(() => history({ production, shot: aiShot, limit: 0 }));
  assert.equal(capped.code, '22023');
});

test('the whole Director path works with no media-generation credential configured', async () => {
  // The acceptance case the owner named: no FAL_API_KEY, no REPLICATE_API_KEY, no VEO_GENERATION_KEY,
  // no KLING_GENERATION_KEY, no RUNWAY_GENERATION_KEY — and nothing in this database knows them either.
  assert.equal(Number(await scalar(`select count(*)::int from tonde.ai_provider_connections
    where state = 'connected'`)), 0, 'no provider is connected anywhere');
  assert.equal(Number(await scalar(`select count(*)::int from tonde.ai_generation_attempts`)), 0,
    'TONDE has executed no generation attempt at all');
  assert.equal(Number(await scalar(`select count(*)::int from tonde.integration_providers
    where adapter_state = 'verified'`)), 0, 'no provider adapter was ever verified');
  const { production, aiShot } = await newProduction('zero-credentials');
  await saveAiPlan(production, aiShot);
  const kling = await profileSave({ tool_key: 'kling', payload: { display_name: 'Kling', tool_version: '2',
    capability_type: 'video_generation', media_kind: 'video', supports_negative_prompt: true,
    max_duration_ms: 30000, aspect_ratios: ['16:9'], prompt_characteristics: 'Subject, action, camera.',
    source_title: 'Kling guide' } });
  await profileReview(kling.profile_id, 'review', 'Checked against the guide.');
  await kitSet({ production, tool_key: 'kling', profile_id: kling.profile_id });
  // Director: the playbook exists.
  const read = await playbook({ production, shot: aiShot, tool_key: 'kling' });
  assert.equal(read.tool_connection, 'none');
  assert.equal(read.recommended_tool, 'kling');
  assert.equal(read.adaptations.length >= 0, true);
  // The tool-specific prompt exists and is copyable.
  const compiled = await promptCompile({ production, shot: aiShot, tool_key: 'kling' });
  assert.equal(compiled.knowledge_status, 'reviewed');
  assert.equal(compiled.prompt_length > 100, true);
  // The creator executes externally and uploads the Result, which is checked and corrected.
  const uploaded = await uploadResult(production, aiShot, 'zero-credential');
  const checked = await checkResult({ production, shot: aiShot, result: uploaded.result, payload: {
    verdict: 'fix', tool_key: 'kling', instructions: 'Keep the aircraft in frame for the whole walk.',
    criteria: criteriaFor(['shot_objective'], ['composition']) } });
  assert.equal(checked.verdict, 'fix');
  assert.notEqual(checked.next_prompt, null);
  const trail = await history({ production, shot: aiShot });
  assert.equal(trail.checks.length, 1);
  assert.equal(trail.attempts.length, 0);
  // Still true after the whole path ran: TONDE required and used no generation credential.
  assert.equal(Number(await scalar(`select count(*)::int from tonde.ai_provider_connections
    where state = 'connected'`)), 0);
  assert.equal(Number(await scalar(`select count(*)::int from tonde.ai_generation_attempts`)), 0);
  const law = await boundary();
  assert.equal(law.generation_provider_required, false);
  assert.equal(law.direct_media_generation, false);
});

test('cost is split honestly between TONDE and the external tool', async () => {
  const { production, aiShot } = await newProduction('cost');
  await saveAiPlan(production, aiShot, { provider_target: 'kling' });
  const kling = await profileSave({ tool_key: 'kling', payload: { display_name: 'Kling', tool_version: 'cost-1',
    capability_type: 'video_generation', media_kind: 'video', source_title: 'Kling pricing page',
    typical_external_cost_note: 'Roughly 5 external credits for a five second clip.' } });
  await profileReview(kling.profile_id, 'review', 'Read the pricing page.');
  await kitSet({ production, tool_key: 'kling', profile_id: kling.profile_id });
  const undocumented = await playbook({ production, shot: aiShot });
  assert.equal(undocumented.cost.resold_by_tonde, false);
  assert.equal(undocumented.cost.estimate_or_actual, 'estimate');
  assert.equal(undocumented.cost.tonde_cost.state, 'unknown', 'TONDE charges nothing it cannot state');
  assert.equal(undocumented.cost.tonde_cost.amount, null);
  assert.equal(undocumented.cost.external_tool_cost.kind, 'external');
  assert.equal(undocumented.cost.external_tool_cost.amount, null,
    'no invented figure for a tool whose cost TONDE cannot document');
  assert.equal(undocumented.cost.tonde_cost.amount, null);
  assert.match(undocumented.cost.external_tool_cost.note, /5 external credits/);
  assert.match(undocumented.cost.external_tool_cost.basis, /never a TONDE charge/);
  assert.match(undocumented.cost.meaning, /does not resell generation/);
  // A known TONDE charge is reported as the TONDE charge, not as the tool's.
  await asService(() => db.query(`update tonde.execution_plans set cost_state = 'known', cost_amount = 1.5,
    cost_currency = 'USD', cost_note = 'Direction for this Shot' where workspace_id = $1 and shot_id = $2`,
    [wa, aiShot]));
  const stated = await playbook({ production, shot: aiShot });
  assert.equal(stated.cost.tonde_cost.state, 'known');
  assert.equal(Number(stated.cost.tonde_cost.amount), 1.5);
  assert.equal(stated.cost.tonde_cost.currency, 'USD');
  assert.equal(stated.cost.external_tool_cost.amount, null,
    "the tool cost is still the creator's own, and it is not added to the TONDE charge");
});
