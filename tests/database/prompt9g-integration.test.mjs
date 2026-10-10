import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 9G full integration and certification, on real embedded PostgreSQL against one 001->024
// stack. Each 9A-9F pass proves its own semantics; this file proves the SEAMS between them, because
// that is where a product composed of several engines actually breaks:
//
//  dependency graph -> impact -> locks/approvals -> stale artifacts (9A + 9E + 9D)
//  Shot Match finding -> the same continuity finding the continuity engine resolves (9F + 9B)
//  Shot Match correction -> versioning -> memory candidate -> structured search (9F + 9D + 9C)
//  versioning -> branch -> merge -> mainline, with old versions immutable (9D)
//  Results -> Shot Match -> FIX THIS SHOT -> new Take -> second analysis -> creator approval (9F)
//  readiness unblocked by a creator's decision on an analysis (9E + 9F)
//  long-form Episode Shot carrying a Result and an analysis (9F + Prompt 8)
//
// Nothing here crosses a workspace boundary, and nothing here fabricates analysis.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const MEDIA_ONE = '00000000-0000-4000-8000-000000000900';
const MEDIA_TWO = '00000000-0000-4000-8000-000000000901';
const MEDIA_KEYFRAME = '00000000-0000-4000-8000-000000000902';
let wa, wb, film, sceneOne, shotOne, shotTwo, otherShot, character, aiPlan, mediaOne, mediaTwo, takeOne;

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

const sceneId = (production, title, duration = 20000) => asEditor(() => scalar(
  "select (tonde.create_studio_scene($1,$2,$3,$4)->>'scene_id')::uuid",
  [wa, production, null, JSON.stringify({ title, duration_ms: duration })]));
const shotId = (production, scene, title, duration = 4000) => asEditor(() => scalar(
  "select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>'shot_id')::uuid",
  [wa, production, scene, null, JSON.stringify({ title, duration_ms: duration })]));
const preview = (object, depth = 2) => asEditor(() => scalar(
  'select tonde.impact_preview($1,$2,$3,$4,$5)', [wa, film, object, depth, 200]));
const applyImpact = (analysis, mode, selected = []) => asEditor(() => scalar(
  'select tonde.apply_impact($1,$2,$3,$4,$5,$6,$7)', [wa, film, analysis, mode, selected.length ? selected : null, null, '']));
const markers = (state = null) => asEditor(() => scalar(
  'select tonde.stale_artifact_list($1,$2,$3,$4,$5)', [wa, film, state, 200, 0]));
const syncDependencies = () => asEditor(() => scalar('select tonde.dependency_sync($1,$2)', [wa, film]));
const lockSet = (object, locked, expected = null, note = '') => asEditor(() => scalar(
  'select tonde.lock_set($1,$2,$3,$4,$5,$6)', [wa, film, object, locked, expected, note]));
const approvalDecide = (object, decision, expected = null, note = '') => asEditor(() => scalar(
  'select tonde.approval_decide($1,$2,$3,$4,$5,$6)', [wa, film, object, decision, expected, note]));
const accessState = object => asEditor(() => scalar('select tonde.access_state($1,$2,$3)', [wa, film, object]));
const readiness = (production = film) => asEditor(() => scalar(
  'select tonde.production_readiness($1,$2,$3)', [wa, production, null]));
const versionList = (object, limit = 100) => asEditor(() => scalar(
  "select tonde.version_list($1,$2,$3,$4,$5,$6)", [wa, film, object, 'main', limit, 0]));
const versionCompare = (left, right) => asEditor(() => scalar(
  'select tonde.version_compare($1,$2,$3,$4)', [wa, film, left, right]));
const branchCreate = (object, scope, payload) => asEditor(() => scalar(
  'select tonde.branch_create($1,$2,$3,$4)', [wa, film, object, JSON.stringify({ scope, ...payload })]));
const mergePreview = branch => asEditor(() => scalar('select tonde.merge_preview($1,$2,$3)', [wa, film, branch]));
const mergeDecide = (proposal, decision, selected = [], propagation = 'change_only_this', note = '') => asEditor(() => scalar(
  'select tonde.merge_decide($1,$2,$3,$4,$5,$6,$7)', [wa, film, proposal, decision, selected.length ? selected : null, propagation, note]));
const registerResult = payload => asEditor(() => scalar(
  'select tonde.result_register($1,$2,$3)', [wa, film, JSON.stringify(payload)]));
const analyze = (shot, payload) => asEditor(() => scalar(
  'select tonde.match_analyze($1,$2,$3,$4)', [wa, film, shot, JSON.stringify(payload)]));
const reportGet = report => asEditor(() => scalar('select tonde.match_report_get($1,$2,$3)', [wa, film, report]));
const reportDecide = (report, decision, note = '') => asEditor(() => scalar(
  'select tonde.match_report_decide($1,$2,$3,$4,$5)', [wa, film, report, decision, note]));
const proposeCorrection = (report, payload) => asEditor(() => scalar(
  'select tonde.match_correction_propose($1,$2,$3,$4)', [wa, film, report, JSON.stringify(payload)]));
const applyCorrection = (correction, expected = null, propagation = 'change_only_this', note = '', candidate = false) =>
  asEditor(() => scalar('select tonde.match_correction_apply($1,$2,$3,$4,$5,$6,$7)',
    [wa, film, correction, expected, propagation, note, candidate]));
const resultState = (result, state, expected = null, note = '') => asEditor(() => scalar(
  'select tonde.result_state_set($1,$2,$3,$4,$5,$6)', [wa, film, result, state, expected, note]));
const search = query => asEditor(() => scalar('select tonde.production_search($1,$2,$3)', [wa, film, JSON.stringify(query)]));
const candidateList = (state = 'proposed') => asEditor(() => scalar(
  'select tonde.memory_candidate_list($1,$2,$3,$4,$5)', [wa, film, state, 50, 0]));
const decideCandidate = (id, decision, note = '') => asEditor(() => scalar(
  'select tonde.memory_candidate_decide($1,$2,$3,$4,$5)', [wa, film, id, decision, note]));
const captureState = shot => asEditor(() => scalar(
  'select status::text from tonde.shot_capture_state where workspace_id = $1 and shot_id = $2', [wa, shot]));
const continuityFindings = (state = null) => asEditor(() => scalar(
  'select tonde.continuity_finding_list($1,$2,$3,$4,$5,$6,$7)', [wa, film, state, null, null, 100, 0]));
const updateContinuityFinding = (id, state, note = '') => asEditor(() => scalar(
  'select tonde.continuity_finding_update($1,$2,$3,$4,$5)', [wa, film, id, state, note]));

const mediaId = async (id, overrides = {}) => {
  const row = { bucket: 'tonde-production-media', mime: 'video/mp4', category: 'video', bytes: 2048,
    derived: null, ...overrides };
  return asEditor(() => scalar(
    `insert into tonde.media_files(id, workspace_id, storage_provider, bucket, object_key, original_filename,
      mime_type, file_category, bytes, upload_state, processing_state, derived_from_id)
     values ($1,$2,'supabase',$3,$4,'take.mp4',$5,$6,$7,'uploaded','ready',$8) returning id`,
    [id, wa, row.bucket, `${wa}/${id}/take.mp4`, row.mime, row.category, row.bytes, row.derived]));
};

const finding = (overrides = {}) => ({
  category: 'framing', expected: 'Product in the lower third', observed: 'Product is off frame',
  difference: 'The Product is not readable in the frame', epistemic: 'observed', confidence: 'high',
  severity: 'warning', evidence: ['frame 0-48'], suggested_correction: 'Lower the camera and move closer',
  ...overrides });

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
  shotTwo = await shotId(film, sceneOne, 'Product reveal');
  otherShot = await shotId(film, sceneOne, 'Insert of the countertop');
  character = await asEditor(() => scalar(
    `insert into tonde.assets(workspace_id, asset_type, name, description)
     values ($1,'character','Marcus','Wardrobe established in Scene 1') returning id`, [wa]));
  await asEditor(() => db.query(
    `insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role)
     values ($1,$2,$3,$4,'character'), ($1,$2,$5,$4,'character')`, [wa, film, shotOne, character, shotTwo]));
  await asEditor(() => scalar('select tonde.save_real_plan($1,$2,$3,$4,$5)', [wa, film, shotOne, null,
    JSON.stringify({ plan_status: 'ready', framing: 'Product lower third', camera_height: 'eye level' })]));
  aiPlan = await asEditor(() => scalar(
    `insert into tonde.execution_plans(workspace_id, production_id, shot_id, execution_method, plan_metadata)
     values ($1,$2,$3,'ai','{"compiled_prompt":"hold the bag at chest height"}') returning id`, [wa, film, shotTwo]));
  await syncDependencies();
  mediaOne = await mediaId(MEDIA_ONE);
  mediaTwo = await mediaId(MEDIA_TWO);
  await mediaId(MEDIA_KEYFRAME, { category: 'keyframe', mime: 'image/jpeg', derived: MEDIA_ONE });
  takeOne = await asEditor(() => scalar(
    `insert into tonde.shot_takes(workspace_id, production_id, shot_id, plan_id, take_number, status, media_id)
     values ($1,$2,$3,(select id from tonde.execution_plans where workspace_id = $1 and shot_id = $3
       and execution_method = 'real'),1,'preferred',$4) returning id`, [wa, film, shotOne, mediaOne]));
  await db.query("insert into tonde.workspace_members(workspace_id, user_id, role) values ($1,$2,'viewer')", [wa, C]);
  await asEditor(() => scalar('select tonde.approval_decide($1,$2,$3,$4,$5,$6)', [wa, film, shotTwo, 'approve', null, 'The AI intent is approved.']));
});

after(async () => { await db.close(); });

// -------------------------------------------------------------------- 9A + 9D + 9E seam

test('a wardrobe change previews impact, respects a locked Shot, marks the dependent plan stale (9A/9E)', async t => {
  t.after(async () => {
    if (await scalar('select locked_at is not null from tonde.shots where id=$1', [shotOne]))
      await lockSet(shotOne, false, null, 'Integration test cleanup.');
  });
  const realPlan = await asEditor(() => scalar(
    "select id from tonde.execution_plans where workspace_id = $1 and shot_id = $2 and execution_method = 'real'", [wa, shotOne]));
  await lockSet(shotOne, true, null, 'The pickup is scheduled for this Shot.');
  const analysis = await preview(character, 2);
  assert.equal(analysis.counts.direct >= 2, true, 'the bound Shots are direct dependents');
  assert.equal(analysis.counts.downstream >= 1, true, 'the dependent plans sit downstream of their Shots');
  assert.equal(analysis.counts.locked >= 1, true, 'the locked Shot is named in the preview itself');
  const applied = await applyImpact(analysis.analysis_id, 'update_all');
  assert.equal(applied.locked_skipped.some(item => item.object_id === shotOne), true);
  assert.match(applied.locked_skipped[0].reason, /locked/);
  const lockedRow = await rows('select locked_at from tonde.shots where id = $1', [shotOne]);
  assert.ok(lockedRow[0].locked_at, 'the lock survived the propagation');
  const open = await markers('stale');
  assert.equal(open.items.some(item => item.object_id === realPlan), true, 'the affected plan is marked stale');
  assert.equal(await scalar('select framing from tonde.execution_plans where id = $1', [realPlan]), 'Product lower third',
    'a stale artifact is marked, never rewritten');
  await lockSet(shotOne, false, null, 'Unwrapped for the correction.');
});

test('approved dependents are reported for review, never silently rewritten (9A/9E)', async () => {
  const analysis = await preview(character, 2);
  assert.equal(analysis.counts.approved >= 1, true, 'an approved dependent is recognised as such');
  assert.equal(analysis.counts.direct >= 2, true);
  const applied = await applyImpact(analysis.analysis_id, 'review_changes', [shotTwo]);
  assert.equal(applied.marked, 1, 'only the selected dependent is marked');
  const second = await preview(character, 2);
  const all = await applyImpact(second.analysis_id, 'update_all');
  assert.equal(all.requiring_review.some(item => item.object_id === shotTwo), true,
    'an approved dependent is reported rather than rewritten');
  assert.match(all.requiring_review.find(item => item.object_id === shotTwo).reason, /never rewritten silently/);
  const approval = await accessState(shotTwo);
  assert.equal(approval.approval, 'approved', 'approved content is not edited by propagation');
  const flags = await markers(null);
  assert.equal(flags.items.some(item => item.object_id === shotTwo && item.state === 'conflicted'), true,
    'the approved dependent carries a review flag');
});

// -------------------------------------------------------------------- 9F + 9B seam

test('a Shot Match continuity finding is the same finding the continuity engine owns (9F/9B)', async () => {
  const result = await registerResult({ shot_id: shotOne, origin: 'real_take', take_id: takeOne });
  const analysis = await analyze(shotOne, { result_id: result.result_id, origin: 'creator', findings: [
    finding({ category: 'wardrobe', severity: 'critical', continuity_domain: 'wardrobe',
      observed: 'Marcus wears the blue jacket', difference: 'The wardrobe changed without a declared reason',
      suggested_correction: 'Declare the wardrobe change or return to the planned jacket' })] });
  assert.equal(analysis.continuity_finding_ids.length, 1);
  const linked = (await reportGet(analysis.report_id)).findings[0].continuity_finding_id;
  assert.equal(linked, analysis.continuity_finding_ids[0]);
  const list = await continuityFindings();
  const owned = list.items.find(item => item.finding_id === linked);
  assert.ok(owned, 'it appears in the continuity engine list, not only in the analysis');
  assert.equal(owned.domain, 'wardrobe');
  assert.equal(owned.origin, 'derived', 'an observed finding is derived, never inferred');
  assert.match(String(owned.explanation), /wardrobe changed without a declared reason/);
  const resolved = await updateContinuityFinding(linked, 'resolved', 'The jacket is declared for Scene 1.');
  assert.equal(resolved.state, 'resolved', 'the continuity engine can resolve the finding the analysis raised');
  const after = await reportGet(analysis.report_id);
  assert.equal(after.findings[0].continuity_finding_id, linked, 'the analysis still points at the same finding');
});

// -------------------------------------------------------------------- 9F + 9D + 9C seam

test('FIX THIS SHOT versions the correction, keeps the earlier plan, and reaches memory and search (9F/9D/9C)', async () => {
  const result = await registerResult({ shot_id: shotOne, origin: 'real_take', take_id: takeOne });
  const analysis = await analyze(shotOne, { result_id: result.result_id, findings: [
    finding({ category: 'framing', severity: 'critical', observed: 'Product sits high in frame',
      difference: 'The Product is higher than the planned lower third', evidence: ['frame 0-48'] })] });
  assert.equal(analysis.recommendation, 'pickup_required', 'a Real Result recommends a pickup');
  const plan = await asEditor(() => scalar(
    "select id from tonde.execution_plans where workspace_id = $1 and shot_id = $2 and execution_method = 'real'", [wa, shotOne]));
  const correction = await proposeCorrection(analysis.report_id, { target_object_id: plan,
    patch: { camera_height: 'low, at product level' }, root_cause: 'The camera was higher than planned, so the Product read as secondary',
    why: 'The Result makes the Product secondary to the Character', affected: 'Shot 1 Real Execution Plan only' });
  assert.ok(correction.preview.analysis_id, 'the impact was computed by the proposal');

  const premature = await failure(() => applyCorrection(correction.correction_id, correction.source_revision,
    'change_only_this', 'Try it.', true));
  assert.equal(premature.code, '23514', 'memory cannot be claimed before a later analysis confirms it');
  assert.equal(await scalar('select camera_height from tonde.execution_plans where id = $1', [plan]), 'eye level',
    'the refused request changed nothing');

  // A later analysis on a NEW take, then the correction is applied and recorded as a candidate.
  const secondTake = await asEditor(() => scalar(
    `insert into tonde.shot_takes(workspace_id, production_id, shot_id, plan_id, take_number, status, media_id)
     values ($1,$2,$3,$4,2,'good',$5) returning id`, [wa, film, shotOne, plan, mediaTwo]));
  const secondResult = await registerResult({ shot_id: shotOne, origin: 'real_take', take_id: secondTake });
  // The second Result is a different take with no extracted frames, so the confirmation cannot claim
  // a visual modality: it confirms the timing, which the media's own metadata supports.
  await analyze(shotOne, { result_id: secondResult.result_id, findings: [
    finding({ category: 'timing', severity: 'info', observed: 'The blocking change held at four seconds',
      difference: 'No material drift remains', verdict: 'matches_intent', evidence: ['duration_ms 4000'],
      suggested_correction: '' })] });
  const applied = await applyCorrection(correction.correction_id, correction.source_revision,
    'change_only_this', 'Apply the planned fix.', true);
  assert.equal(applied.state, 'applied');
  assert.deepEqual(applied.changed_fields, ['camera_height']);
  assert.equal(await scalar('select camera_height from tonde.execution_plans where id = $1', [plan]), 'low, at product level');
  const versions = await versionList(plan);
  const correctionVersion = versions.items.find(item => item.source_action === 'correction');
  assert.ok(correctionVersion, 'the new revision says a correction produced it');
  const snapshot = await scalar(
    'select snapshot from tonde.object_versions where workspace_id = $1 and object_id = $2 and revision = $3',
    [wa, plan, correction.source_revision]);
  assert.equal(snapshot.camera_height, 'eye level', 'the earlier plan is preserved exactly as it was');
  const candidate = await candidateList();
  assert.equal(candidate.total >= 1, true, 'a confirmed correction becomes a memory candidate');
  const accepted = await decideCandidate(candidate.items[0].candidate_id, 'accept', 'It worked on the second take.');
  assert.equal(accepted.state, 'applied', 'an accepted candidate becomes memory');
  const found = await search({ text: 'Product', kinds: ['plan', 'memory'], limit: 25 });
  assert.equal(found.results.some(item => item.entity_id === plan), true,
    'the corrected plan is findable through structured search');
  const memoryHit = found.results.find(item => item.entity_type === 'memory_item');
  assert.ok(memoryHit, 'the reusable memory is findable through the same structured search');
  assert.equal(typeof memoryHit.in_force, 'boolean', 'a memory hit says whether it is still in force');
  assert.equal(Number(await scalar('select count(*) from tonde.memory_items where workspace_id = $1', [wa])) >= 1, true);
});

// -------------------------------------------------------------------- 9D seam

test('version history stays immutable, a branch is an alternative, and a merge is a reviewed decision (9D)', async () => {
  const startRevision = await scalar('select revision from tonde.shots where id = $1', [shotOne]);
  await asEditor(() => db.query('update tonde.shots set description = $2 where id = $1', [shotOne, 'Revision two.']));
  await asEditor(() => db.query('update tonde.shots set description = $2 where id = $1', [shotOne, 'Revision three.']));
  const versions = await versionList(shotOne, 200);
  assert.equal(versions.current_revision, startRevision + 2, 'each edit adds a revision instead of replacing one');
  const revBefore = versions.items.find(item => item.revision === startRevision).version_id;
  const revAfter = versions.items.find(item => item.revision === startRevision + 2).version_id;
  const compare = await versionCompare(revBefore, revAfter);
  assert.equal(compare.changes.some(change => change.field === 'description'), true);
  assert.equal(compare.changes.find(change => change.field === 'description').after, 'Revision three.');
  const immutable = await failure(() => asEditor(() => db.query(
    'update tonde.object_versions set snapshot = $$ {} $$::jsonb where workspace_id = $1 and object_id = $2 and revision = $3',
    [wa, shotOne, startRevision])));
  assert.ok(['42501', '23514'].includes(immutable.code), `an old version cannot be edited (${immutable.code})`);

  const branch = await branchCreate(shotOne, 'shot', { name: 'Tighter ending', reason: 'Try a different beat.',
    source_version_id: versions.items.find(item => item.revision === startRevision + 1).version_id });
  await asEditor(() => scalar('select tonde.branch_change_set($1,$2,$3,$4)', [wa, film, branch.branch_id,
    JSON.stringify({ target_object_id: shotOne, patch: { description: 'Branch: the Product stays in shadow.' } })]));
  const mainline = await asEditor(() => scalar('select description from tonde.shots where id = $1', [shotOne]));
  assert.equal(mainline, 'Revision three.', 'an edited branch changes nothing on the mainline');
  const proposal = await mergePreview(branch.branch_id);
  assert.equal(proposal.state, 'proposed');
  const merged = await mergeDecide(proposal.proposal_id, 'merge', [], 'change_only_this', 'Bring the tighter beat back.');
  assert.equal(merged.state, 'merged');
  const after = await versionList(shotOne, 200);
  assert.equal(after.current_revision >= startRevision + 3, true, 'an accepted merge creates a new mainline revision');
  const preserved = await scalar(
    'select snapshot from tonde.object_versions where workspace_id = $1 and object_id = $2 and revision = $3',
    [wa, shotOne, startRevision + 1]);
  assert.equal(preserved.description, 'Revision two.', 'the historical version is untouched by the merge');
});

// -------------------------------------------------------------------- 9F + 9E seam

test('readiness stops blocking once the creator decides the analysis, and pickup reaches On-Set (9F/9E)', async () => {
  const before = await readiness();
  const open = before.blockers.filter(blocker => blocker.code === 'shot_match_pickup');
  assert.equal(open.length, 1, 'an undecided completed analysis blocks readiness');
  assert.equal(open[0].action_source, 'shot_match_report');
  const reports = await asEditor(() => scalar('select tonde.match_reports($1,$2,$3,$4,$5,$6)', [wa, film, null, null, 100, 0]));
  const undecided = reports.items.filter(item => item.decision === null && item.severity !== 'info');
  assert.equal(undecided.length >= 1, true, 'at least one analysis awaits a creator decision');
  // The Creator labels the first one a pickup; the rest are dismissed as reviewed.
  const decided = await reportDecide(undecided[0].report_id, 'pickup', 'Pick up the product read.');
  assert.equal(decided.capture_status, 'pickup_needed');
  assert.equal(await captureState(shotOne), 'pickup_needed', 'the On-Set capture state carries the pickup');
  assert.equal(decided.note.includes('On-Set capture state'), true);
  for (const report of undecided.slice(1)) await reportDecide(report.report_id, 'dismiss', 'Reviewed.');
  const after = await readiness();
  assert.equal(after.blockers.some(blocker => blocker.code === 'shot_match_pickup'), false,
    'decided analyses no longer block readiness');
});

test('Shot Match never approves a Result, and Final needs the creator (9F/9E)', async () => {
  const results = await asEditor(() => scalar('select tonde.result_list($1,$2,$3,$4,$5,$6)', [wa, film, shotOne, null, 50, 0]));
  const target = results.items.find(item => item.state !== 'final') ?? results.items[0];
  const blocked = await failure(() => resultState(target.result_id, 'final'));
  assert.equal(blocked.code, '23514');
  assert.match(String(blocked.message), /approved/i);
  const approved = await resultState(target.result_id, 'approved', target.revision, 'The take reads correctly.');
  assert.equal(approved.approval, 'approved');
  const revision = await scalar('select revision from tonde.results where id = $1', [target.result_id]);
  const finalized = await resultState(target.result_id, 'final', revision);
  assert.equal(finalized.state, 'final');
  assert.equal(finalized.approval, 'approved', 'an accepted Result is not reported as changed after approval');
  const ledger = await asEditor(() => scalar('select tonde.access_history($1,$2,$3,$4,$5)', [wa, film, target.result_id, 50, 0]));
  assert.equal(ledger.items.some(item => item.action === 'approve' && item.actor_user_id === A), true,
    'the creator decision is on the append-only ledger');
  const earlier = await asEditor(() => scalar(
    'select snapshot from tonde.object_versions where workspace_id = $1 and object_id = $2 and revision = 1', [wa, target.result_id]));
  assert.equal(earlier.state, 'needs_review', 'the earlier Result revision stays readable and unchanged');
});

test('a locked plan is never corrected incidentally, and its approval is untouched (9F/9E)', async t => {
  const plan = await asEditor(() => scalar(
    "select id from tonde.execution_plans where workspace_id = $1 and shot_id = $2 and execution_method = 'real'", [wa, shotOne]));
  t.after(async () => {
    if (await scalar('select locked_at is not null from tonde.execution_plans where id=$1', [plan]))
      await lockSet(plan, false, null, 'Integration test cleanup.');
  });
  await lockSet(plan, true, null, 'Locked for the pickup.');
  const reports = await asEditor(() => scalar('select tonde.match_reports($1,$2,$3,$4,$5,$6)', [wa, film, shotOne, null, 25, 0]));
  const analysis = reports.items[0];
  const correction = await proposeCorrection(analysis.report_id, { target_object_id: plan,
    patch: { framing: 'Product dominates the lower third' }, root_cause: 'The framing was planned before the pickup' });
  const refused = await failure(() => applyCorrection(correction.correction_id));
  assert.equal(refused.code, '23514');
  assert.match(String(refused.message), /unlock/i);
  const state = await accessState(plan);
  assert.equal(state.locked, true, 'the plan is still locked');
  assert.equal(await scalar('select framing from tonde.execution_plans where id = $1', [plan]), 'Product lower third',
    'the locked plan was not changed');
  await lockSet(plan, false, null, 'Unwrapped for the correction.');
});

// -------------------------------------------------------------------- long-form seam

test('a Shot inside a Series Episode carries a Result and an analysis like any other Shot (9F/Prompt 8)', async () => {
  const project = await scalar('select project_id from tonde.productions where id = $1', [film]);
  const series = await asEditor(() => scalar('select tonde.create_series($1,$2,$3)', [wa, project, JSON.stringify({
    title: 'Daily Product Films', series_kind: 'recurring', timezone: 'Europe/London',
    cadence_metadata: { kind: 'daily' }, format: { production_type: 'recurring_content', runtime_target_ms: 45000 } })]));
  const episode = await asEditor(() => scalar('select tonde.create_series_episode($1,$2,$3)',
    [wa, series.series_id, JSON.stringify({ title: 'Money minute 1', episode_number: 1 })]));
  assert.ok(episode.production_id, 'the Episode is a real Production');
  const episodeScene = await sceneId(episode.production_id, 'Episode opening');
  const episodeShot = await shotId(episode.production_id, episodeScene, 'Episode product beat');
  const episodeMedia = await mediaId('00000000-0000-4000-8000-000000000903', { category: 'image', mime: 'image/png' });
  const episodeTake = await asEditor(() => scalar(
    `insert into tonde.shot_takes(workspace_id, production_id, shot_id, plan_id, take_number, status, media_id)
     values ($1,$2,$3,null,1,'good',$4) returning id`, [wa, episode.production_id, episodeShot, episodeMedia]));
  // The same Result and Shot Match contracts apply, scoped to the Episode's own Production.
  const result = await asEditor(() => scalar('select tonde.result_register($1,$2,$3)',
    [wa, episode.production_id, JSON.stringify({ shot_id: episodeShot, origin: 'real_take', take_id: episodeTake })]));
  assert.equal(result.state, 'needs_review');
  const analysis = await asEditor(() => scalar('select tonde.match_analyze($1,$2,$3,$4)', [wa, episode.production_id, episodeShot,
    JSON.stringify({ result_id: result.result_id, findings: [finding({ category: 'product_fidelity', severity: 'warning',
      observed: 'The mark is soft', difference: 'The Product mark is soft at this size', evidence: ['image'] })] })]));
  assert.equal(analysis.severity, 'warning');
  const context = await asEditor(() => scalar('select tonde.long_form_context($1,$2,$3,$4,$5)',
    [wa, episode.production_id, 'shot', episodeShot, 800]));
  assert.equal(context.scope.level, 'shot', 'the long-form hierarchy still resolves the Shot');
  assert.equal(context.path.length >= 2, true);
});

test('certification: all derived artifacts remain reported under source/enclosing locks and own locks', async t => {
  const plan = await scalar("select id from tonde.execution_plans where shot_id=$1 and execution_method='real'", [shotOne]);
  const document = await asEditor(() => scalar("insert into tonde.creative_documents(workspace_id,production_id,scope_object_id,document_type,title,content) values($1,$2,$3,'script','Derived script','Retain this script') returning id", [wa,film,shotOne]));
  const line = await asEditor(() => scalar("insert into tonde.dialogue_lines(workspace_id,production_id,document_id,scene_id,shot_id,line_type,content,sort_order) values($1,$2,$3,$4,$5,'dialogue','Retain this line',1024) returning id", [wa,film,document,sceneOne,shotOne]));
  const result = (await registerResult({shot_id:shotOne,origin:'real_take',take_id:takeOne})).result_id;
  const artifacts = [plan,document,line,result];
  for (const target of artifacts) await asEditor(() => scalar("select tonde.dependency_edge($1,$2,$3,$4,'derived_from','hard','explicit','Certification source relationship')", [wa,film,shotOne,target]));
  t.after(async () => {
    for (const [table,id] of [['shots',shotOne],['scenes',sceneOne],['execution_plans',plan],['creative_documents',document],['dialogue_lines',line],['results',result]])
      if (await scalar(`select locked_at is not null from tonde.${table} where id=$1`,[id])) await lockSet(id,false,null,'Certification cleanup');
  });
  await lockSet(shotOne,true);
  await lockSet(sceneOne,true);
  for (const target of artifacts) assert.equal(await scalar('select tonde_private.pi_is_locked($1,$2)',[wa,target]),false,
    'a source or enclosing Scene lock must not conceal derived staleness');
  const before = await rows('select id,revision,snapshot from tonde.object_versions where object_id=any($1::uuid[]) order by id',[artifacts]);
  const impact = await preview(character,3);
  const applied = await applyImpact(impact.analysis_id,'update_all');
  for (const target of artifacts) {
    assert.equal(applied.locked_skipped.some(item=>item.object_id===target),false);
    assert.ok((await markers()).items.some(item=>item.object_id===target),'every dependent is marked/reported');
  }
  assert.deepEqual(await rows('select id,revision,snapshot from tonde.object_versions where object_id=any($1::uuid[]) order by id',[artifacts]),before,
    'impact metadata never silently rewrites content/history');
  await lockSet(sceneOne,false); await lockSet(shotOne,false);
  for (const target of artifacts) await lockSet(target,true);
  const ownLocked = await applyImpact((await preview(shotOne,1)).analysis_id,'update_all');
  for (const target of artifacts) assert.ok(ownLocked.locked_skipped.some(item=>item.object_id===target),'own locked dependents stay in impact reporting');
});

// -------------------------------------------------------------------- isolation

test('every 9F surface stays inside one workspace', async () => {
  const reads = [
    () => asOther(() => scalar('select tonde.result_list($1,$2,$3,$4,$5,$6)', [wa, film, null, null, 50, 0])),
    () => asOther(() => scalar('select tonde.match_reports($1,$2,$3,$4,$5,$6)', [wa, film, null, null, 25, 0])),
  ];
  for (const read of reads) {
    const denied = await failure(read);
    assert.equal(denied.code, '42501');
  }
  const viewer = await asViewer(() => scalar('select tonde.match_reports($1,$2,$3,$4,$5,$6)', [wa, film, null, null, 25, 0]));
  assert.equal(viewer.total >= 1, true, 'a viewer may read the analyses');
  const viewerWrite = await failure(() => asViewer(() => scalar(
    'select tonde.match_analyze($1,$2,$3,$4)', [wa, film, shotOne, JSON.stringify({ result_id: '00000000-0000-4000-8000-000000000999', findings: [finding()] })])));
  assert.equal(viewerWrite.code, '42501');
  const hidden = await asOther(() => rows('select * from tonde.match_corrections where workspace_id = $1', [wa]));
  assert.equal(hidden.length, 0, 'RLS hides another workspace corrections');
  // Another workspace cannot even see the Shot: the Result contract resolves inside its own
  // Production, so there is nothing to attach a Result to.
  const before = await scalar('select count(*)::int from tonde.results where workspace_id = $1', [wa]);
  const otherResult = await failure(() => asOther(() => scalar('select tonde.result_register($1,$2,$3)',
    [wb, film, JSON.stringify({ shot_id: shotOne, origin: 'real_take', take_id: takeOne })])));
  assert.ok(['P0002', '42501'].includes(otherResult.code), `a foreign Shot is unreachable (${otherResult.code})`);
  assert.equal(await scalar('select count(*)::int from tonde.results where workspace_id = $1', [wa]), before,
    'nothing was created across the boundary');
});
