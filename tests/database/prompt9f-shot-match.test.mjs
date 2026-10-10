import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 9F Results, Shot Match and FIX THIS SHOT (additive migration 024). Real embedded
// PostgreSQL. This proves that a Result is what was actually created and keeps its provenance and
// history, that media capability is verified from real media rows so a visual comparison cannot be
// claimed when frames are unavailable, that a finding keeps the evidence discipline and never
// invents a measured lens or identifies a person, that a Real mismatch recommends a pickup and an AI
// mismatch recommends regeneration without launching anything, that Shot Match never approves a
// Result, that FIX THIS SHOT is a scoped correction with a previewed impact that preserves the
// previous plan and Result, and that a correction becomes reusable memory only when a later analysis
// confirms it helped. Nothing here crosses a workspace boundary.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
let wa, wb, film, sceneOne, shotOne, shotTwo, realPlan, aiPlan, media, keyframe, thumbnail, take;

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

const resultRegister = (payload, production = film) => asEditor(() => scalar(
  'select tonde.result_register($1,$2,$3)', [wa, production, JSON.stringify(payload)]));
const resultList = (shot = null, state = null, production = film) => asEditor(() => scalar(
  'select tonde.result_list($1,$2,$3,$4,$5,$6)', [wa, production, shot, state, 50, 0]));
const resultDetail = result => asEditor(() => scalar('select tonde.result_detail($1,$2,$3)', [wa, film, result]));
const resultState = (result, state, revision = null, note = '') => asEditor(() => scalar(
  'select tonde.result_state_set($1,$2,$3,$4,$5,$6)', [wa, film, result, state, revision, note]));
const matchAnalyze = (shot, payload) => asEditor(() => scalar(
  'select tonde.match_analyze($1,$2,$3,$4)', [wa, film, shot, JSON.stringify(payload)]));
const matchReports = (shot = null, result = null) => asEditor(() => scalar(
  'select tonde.match_reports($1,$2,$3,$4,$5,$6)', [wa, film, shot, result, 25, 0]));
const reportGet = report => asEditor(() => scalar('select tonde.match_report_get($1,$2,$3)', [wa, film, report]));
const reportDecide = (report, decision, note = '') => asEditor(() => scalar(
  'select tonde.match_report_decide($1,$2,$3,$4,$5)', [wa, film, report, decision, note]));
const correctionPropose = (report, payload) => asEditor(() => scalar(
  'select tonde.match_correction_propose($1,$2,$3,$4)', [wa, film, report, JSON.stringify(payload)]));
const correctionApply = (correction, revision = null, propagation = 'change_only_this', note = '', candidate = false) =>
  asEditor(() => scalar('select tonde.match_correction_apply($1,$2,$3,$4,$5,$6,$7)',
    [wa, film, correction, revision, propagation, note, candidate]));
const correctionReject = (correction, note = '') => asEditor(() => scalar(
  'select tonde.match_correction_reject($1,$2,$3,$4)', [wa, film, correction, note]));

// Media rows are real rows: a valid bucket, an object key that belongs to the workspace and the row,
// and an explicit id so a derived frame can point at the media it was extracted from.
let mediaCount = 0;
const mediaId = async (overrides = {}) => {
  mediaCount += 1;
  const id = overrides.id ?? `00000000-0000-4000-8000-${String(900 + mediaCount).padStart(12, '0')}`;
  const row = { provider: 'supabase', bucket: 'tonde-production-media', key: `${wa}/${id}/take`,
    filename: 'take.mov', mime: 'video/mp4', category: 'video', bytes: 1024, derived: null, ...overrides };
  return asEditor(() => scalar(
    `insert into tonde.media_files(id, workspace_id, storage_provider, bucket, object_key, original_filename,
      mime_type, file_category, bytes, upload_state, processing_state, derived_from_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploaded','ready',$10) returning id`,
    [id, wa, row.provider, row.bucket, row.key, row.filename, row.mime, row.category, row.bytes, row.derived]));
};

const finding = (overrides = {}) => ({
  category: 'framing', expected: 'Product in the lower third', observed: 'Product is off frame',
  difference: 'The Product is not readable in the frame', epistemic: 'observed', confidence: 'high',
  severity: 'warning', evidence: ['frame 0-48'], suggested_correction: 'Lower the camera and move closer', ...overrides,
});

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
  sceneOne = await asEditor(() => scalar(
    "select (tonde.create_studio_scene($1,$2,$3,$4)->>'scene_id')::uuid",
    [wa, film, null, JSON.stringify({ title: 'Scene 1 Apartment', duration_ms: 20000 })]));
  shotOne = await asEditor(() => scalar(
    "select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>'shot_id')::uuid",
    [wa, film, sceneOne, null, JSON.stringify({ title: 'Marcus enters', duration_ms: 4000 })]));
  shotTwo = await asEditor(() => scalar(
    "select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>'shot_id')::uuid",
    [wa, film, sceneOne, null, JSON.stringify({ title: 'Product reveal', duration_ms: 4000 })]));
  await asEditor(() => scalar('select tonde.save_real_plan($1,$2,$3,$4,$5)', [wa, film, shotOne, null,
    JSON.stringify({ plan_status: 'ready', framing: 'Product lower third' })]));
  realPlan = await asEditor(() => scalar(
    "select id from tonde.execution_plans where workspace_id = $1 and shot_id = $2 and execution_method = 'real'", [wa, shotOne]));
  aiPlan = await asEditor(() => scalar(
    "insert into tonde.execution_plans(workspace_id, production_id, shot_id, execution_method) values ($1,$2,$3,'ai') returning id",
    [wa, film, shotTwo]));
  media = await mediaId();
  take = await asEditor(() => scalar(
    "insert into tonde.shot_takes(workspace_id, production_id, shot_id, plan_id, take_number, status, media_id) values ($1,$2,$3,$4,1,'preferred',$5) returning id",
    [wa, film, shotOne, realPlan, media]));
  await db.query("insert into tonde.workspace_members(workspace_id, user_id, role) values ($1,$2,'viewer')", [wa, C]);
});

after(async () => { await db.close(); });

test('a Result is created for review with its real provenance and links', async () => {
  const result = await resultRegister({ shot_id: shotOne, origin: 'real_take', take_id: take });
  assert.equal(result.state, 'needs_review');
  assert.equal(result.approval, 'draft');
  assert.equal(result.provenance.origin, 'real_take');
  assert.equal(result.provenance.take_id, take);
  assert.equal(result.provenance.take_number, 1);
  assert.equal(result.provenance.media_state, 'uploaded/ready');
  const detail = await resultDetail(result.result_id);
  assert.equal(detail.shot_id, shotOne);
  assert.equal(detail.media_id, media);
  assert.equal(detail.capabilities.metadata, true);
  assert.equal(detail.capabilities.video_frames, false, 'no keyframe was extracted, so frames are not claimed');
  const listed = await resultList(shotOne);
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].origin, 'real_take');
  assert.equal(listed.items[0].match_reports, 0);
});

test('a Result cannot be registered without a real source', async () => {
  const noTake = await failure(() => resultRegister({ shot_id: shotOne, origin: 'real_take' }));
  assert.equal(noTake.code, '22023');
  const otherShot = await failure(() => resultRegister({ shot_id: shotTwo, origin: 'real_take', take_id: take }));
  assert.equal(otherShot.code, '22023');
  const badOrigin = await failure(() => resultRegister({ shot_id: shotOne, origin: 'vibes' }));
  assert.equal(badOrigin.code, '22023');
});

test('media capability is verified from real media rows, not declared', async () => {
  const result = (await resultList(shotOne)).items[0];
  const claimed = await failure(() => matchAnalyze(shotOne, { result_id: result.result_id,
    capabilities: { video_frames: true }, findings: [finding()] }));
  assert.equal(claimed.code, '23514');
  assert.match(String(claimed.message), /not available/i);

  // A real keyframe row makes frame-level comparison possible, and nothing else does.
  keyframe = await mediaId({ category: 'keyframe', filename: 'frame.jpg', mime: 'image/jpeg', derived: media });
  thumbnail = await mediaId({ category: 'thumbnail', filename: 'thumb.jpg', mime: 'image/jpeg', derived: media });
  const detail = await resultDetail(result.result_id);
  assert.equal(detail.capabilities.video_frames, true);
  assert.equal(detail.capabilities.thumbnail, true);
  assert.equal(detail.capabilities.audio, false, 'no audio track was extracted');
});

test('an observed difference needs a modality that supports it and the evidence it was seen on', async () => {
  const result = (await resultList(shotOne)).items[0];
  const audioClaim = await failure(() => matchAnalyze(shotOne, { result_id: result.result_id,
    findings: [finding({ category: 'audio', evidence: ['00:00-00:02'] })] }));
  assert.equal(audioClaim.code, '23514');
  const noEvidence = await failure(() => matchAnalyze(shotOne, { result_id: result.result_id,
    findings: [finding({ evidence: [] })] }));
  assert.equal(noEvidence.code, '23514');
  assert.match(String(noEvidence.message), /cite the evidence/i);
});

test('Shot Match never invents a measured lens and never identifies a person', async () => {
  const result = (await resultList(shotOne)).items[0];
  const lens = await failure(() => matchAnalyze(shotOne, { result_id: result.result_id,
    findings: [finding({ category: 'lens_perspective', observed: 'Shot at 52.7mm' })] }));
  assert.equal(lens.code, '22023');
  assert.match(String(lens.message), /estimated look/i);
  const person = await failure(() => matchAnalyze(shotOne, { result_id: result.result_id,
    findings: [finding({ person_name: 'Marcus' })] }));
  assert.equal(person.code, '22023');
  assert.match(String(person.message), /never identifies a person/i);
});

test('the analysis is prioritized by production impact and stays honest about its limits', async () => {
  const result = (await resultList(shotOne)).items[0];
  const analysis = await matchAnalyze(shotOne, { result_id: result.result_id, origin: 'creator', findings: [
    finding({ category: 'product_fidelity', severity: 'critical', observed: 'Product mark is unreadable',
      difference: 'The Product logo cannot be read', evidence: ['frame 12-40'],
      suggested_correction: 'Rotate the Product toward camera', continuity_domain: 'product_condition' }),
    finding({ category: 'color', severity: 'info', observed: 'Background is slightly cooler',
      difference: 'Background colour is slightly cooler than planned', evidence: ['frame 4'],
      suggested_correction: 'Warm the background 200K', verdict: 'acceptable_variation' }),
    finding({ category: 'framing', severity: 'warning', observed: 'Product sits high in frame',
      difference: 'The Product is higher than the planned lower third', evidence: ['frame 0-48'],
      suggested_correction: 'Lower the camera about 20 cm' }),
  ] });
  assert.equal(analysis.severity, 'critical');
  assert.equal(analysis.summary.what_matters_most[0].category, 'product_fidelity',
    'production impact orders the list, not a similarity score');
  assert.equal(analysis.summary.what_to_fix_next[0].category, 'product_fidelity');
  assert.ok(analysis.summary.what_worked.some(item => item.category === 'color'));
  assert.ok(analysis.summary.what_drifted.some(item => item.category === 'framing'));
  assert.match(analysis.summary.note, /not by a similarity score/i);
  assert.equal(analysis.recommendation, 'pickup_required', 'a Real Result recommends a pickup');
  assert.ok(analysis.limitations.some(item => /audio/i.test(item)), 'the surface states what it could not see');
  assert.equal(analysis.continuity_finding_ids.length, 1, 'a continuity-relevant finding links into continuity');
  const linked = (await reportGet(analysis.report_id)).findings
    .find(item => item.category === 'product_fidelity');
  assert.ok(linked.continuity_finding_id, 'the finding points at the continuity finding it raised');
  const continuity = await asEditor(() => scalar(
    'select explanation from tonde.continuity_findings where id = $1', [linked.continuity_finding_id]));
  assert.match(String(continuity), /Product logo cannot be read/);
});

test('an AI Result recommends regeneration and launches nothing', async () => {
  // An AI Result must name the Attempt it came from or its media; an empty claim is refused.
  const unsourced = await failure(() => resultRegister({ shot_id: shotTwo, origin: 'ai_generation',
    execution_plan_id: aiPlan }));
  assert.equal(unsourced.code, '22023');
  const aiMedia = await mediaId({ category: 'image', filename: 'gen.png', mime: 'image/png' });
  const aiResult = await resultRegister({ shot_id: shotTwo, origin: 'ai_generation',
    execution_plan_id: aiPlan, media_id: aiMedia });
  assert.equal(aiResult.state, 'needs_review');
  assert.equal(aiResult.provenance.origin, 'ai_generation');
  assert.equal(aiResult.capabilities.image, true);
  const analysis = await matchAnalyze(shotTwo, { result_id: aiResult.result_id, findings: [
    finding({ category: 'subject_position', severity: 'critical', observed: 'Product is left of the planned mark',
      difference: 'The Product is not on its mark', evidence: ['image'], suggested_correction: 'Strengthen the Product lock' }),
  ] });
  assert.equal(analysis.recommendation, 'regeneration_recommended');
  const decided = await reportDecide(analysis.report_id, 'regeneration', 'Try a tighter product lock.');
  assert.equal(decided.approval, 'approved');
  assert.match(decided.note, /Nothing was launched/i);
  const attempts = await scalar('select count(*) from tonde.ai_generation_attempts where workspace_id = $1', [wa]);
  assert.equal(Number(attempts), 0, 'no generation was launched by a recommendation');
  const after = await reportGet(analysis.report_id);
  assert.equal(after.decision, 'regeneration', 'the decision is recorded on the analysis');
  assert.equal(after.result_state, 'needs_review', 'recommending regeneration never approves the Result');
});

test('a creator pickup touches the On-Set capture state, and deciding twice is refused', async () => {
  const report = (await matchReports(shotOne)).items.find(item => item.recommendation === 'pickup_required');
  const decided = await reportDecide(report.report_id, 'pickup', 'Pick up the product read.');
  assert.equal(decided.capture_status, 'pickup_needed');
  const capture = await asEditor(() => scalar(
    "select status::text from tonde.shot_capture_state where workspace_id = $1 and shot_id = $2", [wa, shotOne]));
  assert.equal(capture, 'pickup_needed');
  const again = await failure(() => reportDecide(report.report_id, 'pickup'));
  assert.equal(again.code, '23514');
});

test('Shot Match never approves the Result and Final is always explicit', async () => {
  const result = (await resultList(shotOne)).items[0];
  const state = (await asEditor(() => rows(
    'select state::text as state, approval::text as approval from tonde.results where id = $1', [result.result_id])))[0];
  assert.equal(state.state, 'needs_review');
  assert.equal(state.approval, 'draft');
  const finalFirst = await failure(() => resultState(result.result_id, 'final'));
  assert.equal(finalFirst.code, '23514');
  assert.match(String(finalFirst.message), /approved/i);
  const approved = await resultState(result.result_id, 'approved');
  assert.equal(approved.state, 'approved');
  const revision = await scalar('select revision from tonde.results where id = $1', [result.result_id]);
  const final = await resultState(result.result_id, 'final', revision);
  assert.equal(final.state, 'final');
  const skip = await failure(() => resultState(result.result_id, 'raw'));
  assert.equal(skip.code, '23514', 'a Final Result cannot jump back to raw');
});

test('the Result keeps its revision history', async () => {
  const result = (await resultList(shotOne)).items[0];
  const history = await asEditor(() => scalar('select tonde.version_list($1,$2,$3,$4,$5,$6)',
    [wa, film, result.result_id, 'main', 50, 0]));
  assert.equal(history.total >= 3, true, 'creation, the state change and the final change are all revisions');
  const actions = history.items.map(item => item.source_action);
  assert.ok(actions.includes('insert'));
  assert.ok(actions.includes('update'));
});

test('FIX THIS SHOT proposes a scoped correction with a previewed impact', async () => {
  const report = (await matchReports(shotOne)).items.find(item => item.recommendation === 'pickup_required');
  const correction = await correctionPropose(report.report_id, { target_object_id: realPlan,
    patch: { camera_height: 'low, at product level' }, root_cause: 'The camera was higher than planned',
    why: 'The Result makes the Product secondary to the Character', affected: 'Shot 1 Real Execution Plan only' });
  assert.equal(correction.state, 'proposed');
  assert.equal(correction.target_kind, 'execution_plan');
  assert.equal(correction.source_revision, 1);
  assert.ok(correction.preview.analysis_id, 'the impact was computed, not applied');
  assert.ok(correction.preview.counts);
  const bad = await failure(() => correctionPropose(report.report_id, { target_object_id: realPlan,
    patch: { revision: 9 }, root_cause: 'x' }));
  assert.equal(bad.code, '22023');
  const rejected = await correctionReject(correction.correction_id, 'Not this time.');
  assert.equal(rejected.state, 'rejected');
});

test('applying a correction creates a new revision, preserves the old plan and propagates impact', async () => {
  const report = (await matchReports(shotOne)).items.find(item => item.recommendation === 'pickup_required');
  const correction = await correctionPropose(report.report_id, { target_object_id: realPlan,
    patch: { camera_height: 'low, at product level', framing: 'Product dominates the lower third' },
    root_cause: 'Camera was approximately higher than planned', why: 'The Product was secondary',
    affected: 'Shot 1 Real Execution Plan only' });
  const stale = await failure(() => correctionApply(correction.correction_id, 99));
  assert.equal(stale.code, 'PT409');
  const applied = await correctionApply(correction.correction_id, correction.source_revision, 'change_only_this',
    'Apply the planned correction.', false);
  assert.equal(applied.state, 'applied');
  assert.equal(applied.applied_revision, correction.source_revision + 1);
  assert.ok(applied.applied_version_id);
  assert.deepEqual(applied.changed_fields.sort(), ['camera_height', 'framing']);
  assert.equal(await scalar('select camera_height from tonde.execution_plans where id = $1', [realPlan]),
    'low, at product level');
  const versions = await asEditor(() => scalar('select tonde.version_list($1,$2,$3,$4,$5,$6)',
    [wa, film, realPlan, 'main', 50, 0]));
  const correctionVersion = versions.items.find(item => item.source_action === 'correction');
  assert.ok(correctionVersion, 'the new revision says a correction produced it');
  const earlier = await asEditor(() => scalar(
    'select snapshot from tonde.object_versions where workspace_id = $1 and object_id = $2 and revision = $3',
    [wa, realPlan, correction.source_revision]));
  assert.equal(earlier.camera_height ?? '', '', 'the earlier plan is preserved exactly as it was');
  assert.equal(earlier.framing ?? '', 'Product lower third', 'the earlier plan keeps what it said');
  assert.equal(applied.propagation.length, 1);
  assert.equal(await scalar('select state::text from tonde.match_corrections where id = $1', [correction.correction_id]), 'applied');
  const twice = await failure(() => correctionApply(correction.correction_id));
  assert.equal(twice.code, '23514');
  // §94/§93: a locked object is never corrected incidentally.
  await asEditor(() => db.query('update tonde.execution_plans set locked_at = now() where id = $1', [realPlan]));
  const lockedReport = (await matchReports(shotOne)).items[0];
  const lockedCorrection = await correctionPropose(lockedReport.report_id, { target_object_id: realPlan,
    patch: { framing: 'Nope' }, root_cause: 'x' });
  const locked = await failure(() => correctionApply(lockedCorrection.correction_id));
  assert.equal(locked.code, '23514');
  assert.match(String(locked.message), /unlock/i);
  await asEditor(() => db.query('update tonde.execution_plans set locked_at = null where id = $1', [realPlan]));
});

test('a correction becomes reusable memory only after a later analysis confirms it helped', async () => {
  const result = (await resultList(shotOne)).items[0];
  const first = (await matchReports(shotOne)).items[0];
  const correction = await correctionPropose(first.report_id, { target_object_id: realPlan,
    patch: { lighting_intent: 'Softer key, add negative fill' }, root_cause: 'The key was too hard',
    why: 'The Product edge is blown out', affected: 'Shot 1 Real Execution Plan only' });
  const premature = await failure(() => correctionApply(correction.correction_id, correction.source_revision,
    'change_only_this', 'Try it.', true));
  assert.equal(premature.code, '23514');
  assert.match(String(premature.message), /later Shot Match/i);
  // A later analysis confirms it helped, so the correction can become a candidate.
  await matchAnalyze(shotOne, { result_id: result.result_id, findings: [
    finding({ category: 'lighting', severity: 'info', observed: 'Product edge is clean now',
      difference: 'No material drift remains', evidence: ['frame 6'], verdict: 'matches_intent',
      suggested_correction: '' }),
  ] });
  const applied = await correctionApply(correction.correction_id, correction.source_revision,
    'change_only_this', 'Apply the softer key.', true);
  assert.equal(applied.state, 'applied');
  assert.ok(applied.candidate, 'the correction was recorded as a memory candidate');
  assert.equal(applied.candidate.state, 'proposed');
  const candidate = await scalar(
    "select statement from tonde.memory_candidates where workspace_id = $1 and source_object_id = $2", [wa, realPlan]);
  assert.match(String(candidate), /The Product edge is blown out/i, 'the reusable memory names the reason it worked');
  const items = await scalar("select count(*) from tonde.memory_items where workspace_id = $1 and source_object_id = $2", [wa, realPlan]);
  assert.equal(Number(items), 0, 'nothing becomes memory automatically from one Shot');
});

test('the iteration history is preserved and the surface stays workspace-isolated', async () => {
  const result = (await resultList(shotOne)).items[0];
  const report = await reportGet((await matchReports(shotOne)).items[0].report_id);
  assert.equal(report.iteration_chain.length >= 2, true, 'every analysis stays readable');
  assert.equal(report.result_state, 'final');
  const viewer = await asViewer(() => scalar('select tonde.match_reports($1,$2,$3,$4,$5,$6)', [wa, film, shotOne, null, 25, 0]));
  assert.equal(viewer.total >= 2, true, 'a viewer may read the analyses');
  const viewerWrite = await failure(() => asViewer(() => scalar(
    'select tonde.match_analyze($1,$2,$3,$4)', [wa, film, shotOne, JSON.stringify({ result_id: result.result_id, findings: [finding()] })])));
  assert.equal(viewerWrite.code, '42501');
  const other = await failure(() => asOther(() => scalar('select tonde.result_list($1,$2,$3,$4,$5,$6)', [wa, film, null, null, 50, 0])));
  assert.equal(other.code, '42501');
  const hidden = await asOther(() => rows('select * from tonde.match_corrections where workspace_id = $1', [wa]));
  assert.equal(hidden.length, 0, 'RLS hides another workspace corrections');
  const direct = await failure(() => asEditor(() => db.query(
    "insert into tonde.shot_match_reports(workspace_id, production_id, shot_id, result_id, state) values ($1,$2,$3,$4,'complete')",
    [wa, film, shotOne, result.result_id])));
  assert.equal(direct.code, '42501', 'reports are written only through the guarded RPCs');
});

test('the private helpers stay unreachable', async () => {
  const reachable = await asEditor(() => scalar("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'tonde_private' and p.proname in ('ms_result','ms_capabilities','ms_available','ms_dimension','ms_impact_weight','ms_severity_verdict','ms_summary','ms_method')"));
  assert.equal(Number(reachable) >= 8, true);
  const denied = await failure(() => asEditor(() => scalar("select tonde_private.ms_capabilities($1,$2)", [wa, null])));
  assert.match(String(denied.message), /permission denied/i);
  const grant = await scalar("select exists(select 1 from information_schema.routine_privileges where specific_schema = 'tonde_private' and routine_name = 'ms_summary' and grantee in ('authenticated','anon','PUBLIC'))");
  assert.equal(grant, false);
});
