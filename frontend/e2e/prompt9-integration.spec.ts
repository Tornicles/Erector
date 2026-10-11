import { expect, test, type Page } from '@playwright/test';

// Prompt 9G full integration, end-to-end through the real Studio surfaces with the API stubbed at
// the network boundary. Each 9A-9F pass has its own spec; this one walks the whole loop across the
// tools to prove the engines compose into one Production and that the browser decides nothing:
//
//  §224  a Character wardrobe change is previewed, REVIEW CHANGES applies only what the creator
//        selected, a locked Shot stays untouched and is reported, the affected prompt is marked
//        stale, and a reload keeps every piece of that state;
//  §227  a Result is analyzed, FIX THIS SHOT previews one scoped correction and applies it, a new
//        Take produces a second Result and a second analysis, and the Result only becomes approved
//        through the creator's own decision;
//  §96   readiness is the same Production's category, with real blockers and never a score.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const character = '00000000-0000-4000-8000-000000000801';
const sceneOne = '00000000-0000-4000-8000-000000000301';
const shotOne = '00000000-0000-4000-8000-000000000401';
const shotTwo = '00000000-0000-4000-8000-000000000402';
const analysis = '00000000-0000-4000-8000-000000000b01';
const marker = '00000000-0000-4000-8000-000000000c01';
const resultOne = '00000000-0000-4000-8000-000000000501';
const reportOne = '00000000-0000-4000-8000-000000000502';
const correctionOne = '00000000-0000-4000-8000-000000000503';
const planOne = '00000000-0000-4000-8000-000000000504';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-9g', timestamp: '2026-10-07T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };

const production = { id: productionId, workspace_id: workspace, project_id: projectId, title: 'Marquee film', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 600000, calculated_duration_ms: 600000, start_ms: 0, end_ms: null, created_by: uid, revision: 7, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' };

const shot = (id: string, title: string, locked: boolean, approval: string, revision: number) => ({
  id, scene_id: sceneOne, order: 1, sort_order: 1024, title, description: `${title} description`, action: '',
  purpose: 'product', subject: 'Marcus', framing: 'lower third', angle: 'eye level', movement: 'static',
  composition: 'lower third', transition: 'cut', story_relationship: 'proves the decision', story_beat: 'Break',
  creative_notes: '', execution_method: 'real', planned_duration_ms: 4000, approval, locked_at: locked ? '2026-10-07T00:00:00Z' : null,
  revision, updated_at: '2026-10-07T00:00:00Z', result_count: 1, bindings: [] });

const studioModel = {
  production: { id: productionId, workspace_id: workspace, title: production.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 600000, calculated_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-07T00:00:00Z' },
  scenes: [{
    id: sceneOne, order: 1, sort_order: 1024, title: 'Scene 1 Apartment', purpose: 'The reveal', story_beat: 'Break',
    description: 'Marcus enters.', action_lines: [], opening_state: 'Empty counter', ending_state: 'Product placed',
    visual_intent: 'One soft source', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 20000,
    duration_ms: 20000, timing: 'derived', approval: 'draft', locked_at: null, revision: 3,
    updated_at: '2026-10-07T00:00:00Z', character_asset_ids: [character], dialogue_lines: 0, shot_count: 2,
    bindings: [], shots: [shot(shotOne, 'Marcus enters', true, 'draft', 4), shot(shotTwo, 'Product reveal', false, 'approved', 3)],
  }],
  orphan_shots: [],
  assets: [{ id: character, asset_type: 'character', name: 'Marcus', description: 'Wardrobe established in Scene 1', approval: 'draft', locked_at: null, revision: 2, metadata: {}, used_by_scenes: [sceneOne] }],
  documents: {},
  timing: { total_ms: 600000, target_ms: 600000, delta_ms: 0, status: 'fits', scene_states: [] },
  runtime_conflict: false,
  timeline: [{ scene_id: sceneOne, order: 1, title: 'Scene 1 Apartment', duration_ms: 20000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [] }],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 2, scenes_locked: 0, shots_locked: 1, approval_counts: { draft: 1, approved: 1 }, needs_attention: 1 },
  truncated: false, provider,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 9G integration.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'short_film', execution_method: 'real', planned_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 600000, assigned_ms: 600000, dialogue_ms: 0, action_ms: 0, slack_ms: 0, status: 'fits' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

const modes = {
  modes: [
    { mode: 'update_all', label: 'UPDATE ALL', description: 'Mark every affected derived artifact.' },
    { mode: 'review_changes', label: 'REVIEW CHANGES', description: 'Mark only the dependents you selected.' },
    { mode: 'change_only_this', label: 'CHANGE ONLY THIS', description: 'Keep the change local.' },
  ],
  rule: 'Impact is computed, never applied by computing it.',
  direction: 'An edge means one thing only: the source is relied upon, the target depends on it.',
};

const graphNodes = [
  { object_id: shotOne, level: 'shot', label: 'Marcus enters', depth: 1, relation: 'asset', classification: 'direct', classification_label: 'Direct', level_label: 'Shot', relation_label: 'Asset binding', status: 'Locked', locked: true, approved: false, revision: 4 },
  { object_id: shotTwo, level: 'shot', label: 'Product reveal', depth: 1, relation: 'asset', classification: 'direct', classification_label: 'Direct', level_label: 'Shot', relation_label: 'Asset binding', status: 'Approved', locked: false, approved: true, revision: 3 },
];
const graph = { root_object_id: character, root_kind: 'asset', root_label: 'Marcus', direction: 'forward', direction_label: 'What this affects', depth: 2, nodes: graphNodes, edges: [], total: 2, total_label: '2 reachable object(s)', truncated: false, cycles_safe: true, note: 'Traversal is bounded and cycle-safe.' };

const preview = {
  analysis_id: analysis, root_object_id: character, root_kind: 'asset', root_label: 'Marcus',
  root_revision: 4, structure_revision: 41, depth: 2, nodes: graphNodes,
  counts: { direct: 2, downstream: 0, potential: 0, locked: 1, approved: 1, by_level: { shot: 2 }, total: 2 },
  locked_ids: [shotOne], approved_ids: [shotTwo],
  explanation: 'Marcus affects 2 direct objects.',
  applied: false, requires_confirmation: true, modes: modes.modes, total_label: '2 affected object(s)',
  summary_line: 'Marcus affects 2 direct objects, 1 of them locked.',
  rule: 'Impact is computed, never applied. Nothing in this Production changed yet.',
};

const appliedImpact = {
  analysis_id: analysis, mode: 'review_changes', mode_label: 'REVIEW CHANGES', applied: true, marked: 1,
  direct_count: 2, downstream_count: 0, unresolved_count: 0,
  locked_skipped: [{ object_id: shotOne, label: 'Marcus enters', reason: 'The dependent object is locked. Unlock it before TONDE updates it.', reason_label: 'Protected by a lock' }],
  requiring_review: [{ object_id: shotTwo, label: 'Product reveal', revision: 3, reason: 'Approved content is never rewritten silently.', reason_label: 'Needs creator review' }],
  note: 'Affected derived artifacts were marked. Approved content and locked objects were reported, not rewritten.',
  summary_line: '1 artifact(s) marked for REVIEW CHANGES. 1 locked dependent(s) were reported instead of changed.',
};

const markers = {
  items: [{ artifact_id: marker, artifact_kind: 'dependent_object', artifact_ref: null, object_id: planOne, object_label: 'Real plan for Marcus enters', object_kind: 'execution_plan', state: 'stale', reason: 'The source Marcus changed after this artifact was derived.', caused_by_object_id: character, caused_by_label: 'Marcus', caused_by_revision: 5, source_revision: 1, current_revision: 5, resolved_at: null, created_at: '2026-10-07T10:00:00Z', artifact_kind_label: 'Dependent object', state_label: 'Stale' }],
  total: 1, open: 1, limit: 100, offset: 0, note: 'Stale means the artifact may no longer match its source. Nothing was deleted.',
};

const capabilities = { metadata: true, thumbnail: true, image: true, video_frames: true, audio: false, media_state: 'uploaded/ready', notes: ['No audio track was extracted, so audio comparison is not claimed.'] };
const capabilityLine = 'Compared from metadata, a thumbnail, an image, extracted frames.';

const resultItem = {
  result_id: resultOne, shot_id: shotOne, shot_label: 'Marcus enters', state: 'needs_review', state_label: 'Needs review',
  approval: 'draft', locked: false, revision: 3, origin: 'real_take', origin_label: 'Real Take',
  provenance: { origin: 'real_take', take_number: 1, take_status: 'preferred' }, capabilities, capability_line: capabilityLine,
  match_reports: 1, match_worst_severity: 'critical', match_severity_label: 'Critical',
  match_recommendation: 'pickup_required', match_recommendation_label: 'Pickup required', created_at: '2026-10-07T10:00:00Z',
  final_line: 'Final is explicitly accepted evidence or deliverable state. Generation completion never sets it.',
};

const report = {
  report_id: reportOne, shot_id: shotOne, shot_label: 'Marcus enters', result_id: resultOne,
  result_state: 'needs_review', state: 'complete', severity: 'critical', severity_label: 'Critical',
  approval: 'draft', decision: null, decision_note: '', decided_by: null, decided_at: null,
  origin: 'creator', origin_label: 'Creator statement',
  recommendation: 'pickup_required', recommendation_label: 'Pickup required', capabilities, capability_line: capabilityLine,
  findings: [{ category: 'framing', verdict: 'mismatch', verdict_label: 'Mismatch', expected: 'Product in the lower third',
    observed: 'Product is off frame', difference: 'The Product is not readable in the frame',
    epistemic: 'observed', epistemic_label: 'Observed', confidence: 'high', confidence_label: 'High confidence',
    severity: 'critical', severity_label: 'Critical', evidence: ['frame 0-48'],
    suggested_correction: 'Lower the camera and move closer', region: '', time_range: '' }],
  dimensions: [{ dimension: 'framing', verdict: 'mismatch', verdict_label: 'Mismatch', findings: 1, weight: 60 }],
  summary: { what_worked: [], what_drifted: [{ category: 'framing', verdict: 'mismatch', severity: 'critical', difference: 'The Product is not readable in the frame' }],
    what_matters_most: [{ category: 'framing', weight: 60, difference: 'The Product is not readable in the frame', verdict: 'mismatch' }],
    what_to_fix_next: [{ category: 'framing', fix: 'Lower the camera and move closer' }],
    note: 'Ordered by production impact, not by a similarity score.' },
  recommendations: [], limitations: ['No audio track was extracted, so audio comparison is not claimed.'],
  corrected_plan_id: null, corrections: [],
  iteration_chain: [{ report_id: '00000000-0000-4000-8000-0000000005ff', created_at: '2026-10-07T09:00:00Z', severity: 'warning', recommendation: 'pickup_required', decision: 'pickup' },
    { report_id: reportOne, created_at: '2026-10-07T10:00:00Z', severity: 'critical', recommendation: 'pickup_required', decision: null }],
  headline: 'The Product is not readable in the frame', note: 'The iteration history is preserved.', limitation: 'Comparison only uses the modalities verified from real media rows.',
};

const readinessReport = {
  production_id: productionId, production_revision: 7, title: 'Marquee film', state: 'needs_review', state_label: 'Needs review',
  dimensions: [{ dimension: 'results', label: 'Results', state: 'needs_review', state_label: 'Needs review', present: true, counts: { blocking: 0, review: 1, warning: 0 } }],
  blockers: [{ code: 'result_needs_review', severity: 'review', dimension: 'results', severity_label: 'Needs review', dimension_label: 'Results',
    problem: '1 Result needs review', affected_object_id: productionId, affected_label: 'Marquee film', affected_kind: 'production',
    why_it_matters: 'A Result that is still raw or needs review is not final.', required_action: 'Review the Result and accept or reject it.', action_source: 'result' }],
  counts: { blocking: 0, review: 1, warning: 0, total: 1 },
  headline: '1 item needs a creator decision before this Production is ready.',
  notes: ['Readiness is a category derived from real production state, not a score or a percentage.'],
  generated_at: '2026-10-07T10:00:00Z',
  limitation: 'Readiness is a category derived from real production state, not a score or a percentage. AI provider availability is an external dependency and is not guessed here.',
};
const readinessVocabulary = {
  access_actions: [{ action: 'approve', label: 'Approved' }], approval_states: [{ state: 'draft', label: 'Draft' }],
  readiness_states: [{ state: 'needs_review', label: 'Needs review' }],
  readiness_dimensions: [{ dimension: 'results', label: 'Results' }],
  severities: [{ severity: 'review', label: 'Needs review' }],
  rule: 'Approval means a creator accepted this specific revision.',
  limitation: readinessReport.limitation,
};

async function platform(page: Page) {
  await page.route('https://tonde-test.supabase.co/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: uid, email: 'creator@example.com' } });
    if (path === '/rest/v1/productions') {
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      if (request.method() === 'PATCH') return route.fulfill({ json: { ...production, ...request.postDataJSON(), revision: 8 } });
      return route.fulfill({ json: single ? production : [production] });
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(({ uid }) => {
    const payload = btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-07T00:00:00Z' } }));
  }, { uid });
}

type Write = { path: string; body: Record<string, unknown> };

async function productionApi(page: Page, writes: Write[]) {
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    const method = request.method();
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });

    // 9A impact
    if (path.endsWith('/intelligence/modes')) return route.fulfill({ json: envelope(modes) });
    if (path.endsWith('/intelligence/graph')) return route.fulfill({ json: envelope(graph) });
    if (path.endsWith('/intelligence/dependencies') && method === 'GET') return route.fulfill({ json: envelope({ object_id: character, items: [], total: 0, limit: 100, offset: 0, note: 'Edges are deactivated, never deleted.' }) });
    if (path.endsWith('/intelligence/impact/preview')) { writes.push({ path, body }); return route.fulfill({ json: envelope(preview) }); }
    if (path.endsWith('/intelligence/impact/apply')) { writes.push({ path, body }); return route.fulfill({ json: envelope(appliedImpact) }); }
    if (path.endsWith('/intelligence/impact/history')) return route.fulfill({ json: envelope({ items: [], total: 0, limit: 20, offset: 0, truncated: false, note: 'An impact analysis is a snapshot.' }) });
    if (path.endsWith('/intelligence/stale') && method === 'GET') return route.fulfill({ json: envelope(markers) });
    if (path.endsWith('/intelligence/stale') && method === 'POST') return route.fulfill({ json: envelope({ artifact_id: marker, state: 'stale', note: 'The artifact was marked, not rewritten.' }) });
    if (path.endsWith('/resolve')) return route.fulfill({ json: envelope({ artifact_id: marker, state: 'current', note: 'The creator resolved this artifact.' }) });

    // 9E readiness
    if (path.endsWith('/readiness/vocabulary')) return route.fulfill({ json: envelope(readinessVocabulary) });
    if (path.endsWith('/readiness')) return route.fulfill({ json: envelope(readinessReport) });

    // 9F results and shot match
    if (path.endsWith('/shot-match/vocabulary')) return route.fulfill({ json: envelope({
      result_states: [{ state: 'needs_review', label: 'Needs review' }, { state: 'approved', label: 'Approved' }],
      result_origins: [{ origin: 'real_take', label: 'Real Take' }],
      match_verdicts: [{ verdict: 'mismatch', label: 'Mismatch' }],
      correction_states: [{ state: 'proposed', label: 'Proposed' }],
      correction_recommendations: [{ recommendation: 'pickup_required', label: 'Pickup required' }],
      match_origins: [{ origin: 'creator', label: 'Creator statement' }],
      severities: [{ severity: 'critical', label: 'Critical' }],
      rule: 'A Result is what was actually created, not the plan.',
      limitation: 'Comparison only uses the modalities verified from real media rows.' }) });
    if (path.endsWith('/results') && method === 'GET') return route.fulfill({ json: envelope({ items: [resultItem], total: 1, limit: 50, offset: 0, note: 'A Result is what was created, not the plan.' }) });
    if (path.includes('/results/') && path.endsWith('/state') && method === 'POST') {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ result_id: resultOne, state: body.state, state_label: 'Approved',
        previous_state: 'needs_review', approval: 'approved', revision: 4, note: body.note ?? '',
        meaning: 'A creator accepted this Result. Shot Match never approves a Result.' }) });
    }
    if (path.includes('/results/') && method === 'GET') return route.fulfill({ json: envelope({ ...resultItem, scene_id: sceneOne, media_id: planOne,
      plan: { plan_id: planOne, execution_method: 'real', approval: 'draft', revision: 1, framing: 'Product lower third' },
      version_count: 4, match_reports: [{ report_id: reportOne, state: 'complete', severity: 'critical', recommendation: 'pickup_required', decision: null, origin: 'creator', approval: 'draft', created_at: '2026-10-07T10:00:00Z' }], corrections: [] }) });
    if (path.includes('/shots/') && path.endsWith('/shot-match') && method === 'POST') { writes.push({ path, body }); return route.fulfill({ json: envelope(report) }); }
    if (path.endsWith('/corrections') && method === 'POST') {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ correction_id: correctionOne, report_id: reportOne, shot_id: shotOne,
        state: 'proposed', state_label: 'Proposed', target_object_id: planOne, target_kind: 'execution_plan',
        target_label: 'Real plan for Marcus enters', source_revision: 1, patch: body.patch,
        root_cause: body.root_cause, why: body.why, affected: body.affected, recommendation: 'pickup_required',
        preview: { analysis_id: analysis, counts: { direct: 1, downstream: 2, potential: 0, total: 3 } },
        impact_line: 'The impact was computed and is applied only when you accept the correction. Nothing downstream was changed by proposing it.' }) });
    }
    if (path.endsWith('/apply')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ correction_id: correctionOne, report_id: reportOne, shot_id: shotOne,
        state: 'applied', state_label: 'Applied', target_object_id: planOne, target_kind: 'execution_plan',
        target_label: 'Real plan for Marcus enters', source_revision: 1, patch: { framing: 'Product lower third, camera lower' },
        root_cause: 'The camera was higher than planned', affected: 'Scoped to Shot 1 only', applied_revision: 2,
        applied_version_id: '00000000-0000-4000-8000-000000000507', changed_fields: ['framing'],
        propagation: [{ marked: 2 }], candidate: null,
        preserved_line: 'A new revision was created. The previous plan, the Result and every earlier analysis are preserved.',
        note: 'A new revision was created.' }) });
    }
    if (path.endsWith('/decide')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ report_id: reportOne, shot_id: shotOne, decision: body.decision,
        decision_label: 'Pickup requested', approval: 'approved', recommendation: 'pickup_required',
        recommendation_label: 'Pickup required', capture_status: body.decision === 'pickup' ? 'pickup_needed' : null,
        note: body.decision === 'pickup'
          ? 'The Shot is marked for a pickup in the On-Set capture state. The Result itself is unchanged.'
          : 'Regeneration is recommended. Nothing was launched: generation still needs the normal explicit confirmation.',
        meaning: 'Deciding a Shot Match report is not an approval of the Result.' }) });
    }
    if (path.endsWith('/shot-match') && method === 'GET') return route.fulfill({ json: envelope({ items: [report], total: 2, note: 'Each report is one analysis in the Shot iteration history.' }) });
    if (path.includes('/shot-match/') && method === 'GET') return route.fulfill({ json: envelope(report) });
    return route.fulfill({ json: envelope(null) });
  });
}

test('the whole production loop composes across Impact, Results and Readiness (9G)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  await productionApi(page, writes);

  // ---------------------------------------------------------------- §224 dependency and impact
  await page.goto(`/studio/${productionId}?tool=Impact`);
  await expect(page.getByRole('heading', { name: 'What does this change affect?' })).toBeVisible();
  await page.getByLabel('Source object').selectOption(character);
  await page.getByRole('button', { name: /Preview impact/ }).click();
  await expect(page.getByText(/Marcus affects 2 direct objects/).first()).toBeVisible();
  await expect(page.getByLabel('Affected objects')).toContainText('Locked');
  const graph = page.getByLabel('Dependency graph');
  await expect(graph).toContainText('Marcus enters');
  await expect(graph).toContainText('Product reveal');
  await expect(graph).toContainText('locked');

  // REVIEW CHANGES applies only what the creator selected, and reports what it protected.
  await page.getByRole('radio', { name: /REVIEW CHANGES/ }).check();
  const dependents = page.getByLabel('Dependents to change');
  await expect(dependents).toContainText('Marcus enters');
  await page.getByRole('checkbox', { name: /Product reveal/ }).check();
  await page.getByRole('button', { name: /Apply REVIEW CHANGES/ }).click();
  await expect(page.getByText(/REPORTED, NOT CHANGED/)).toBeVisible();
  await expect(page.getByText(/Marcus enters — The dependent object is locked/)).toBeVisible();
  const applyWrite = writes.find(write => write.path.endsWith('/impact/apply'));
  expect(applyWrite?.body).toMatchObject({ analysis_id: analysis, mode: 'review_changes', selected_ids: [shotTwo], confirm: true });
  expect(applyWrite?.body.selected_ids).not.toContain(shotOne);

  // The affected prompt is marked stale, not rewritten, and the marker survives a reload.
  // The drawer itself is ephemeral, so the post-reload check reopens it through the same link.
  await expect(page.getByLabel('Stale artifacts')).toContainText('Real plan for Marcus enters');
  await page.reload();
  await page.goto(`/studio/${productionId}?tool=Impact`);
  await expect(page.getByLabel('Stale artifacts')).toContainText('Real plan for Marcus enters');
  await expect(page.getByRole('heading', { name: 'What does this change affect?' })).toBeVisible();

  // ---------------------------------------------------------------- §227 Result and Shot Match
  await page.goto(`/studio/${productionId}?tool=Results`);
  const results = page.getByLabel('Results');
  await expect(results.getByText('Real Take 1 · preferred')).toBeVisible();
  await expect(results.getByText(capabilityLine).first()).toBeVisible();

  // Shot Match records the diagnosis with its evidence and states what it could not see.
  await page.getByLabel('Dimension compared').selectOption('framing');
  await page.getByLabel('Finding severity').selectOption('critical');
  await page.getByLabel('Difference').fill('The Product is not readable in the frame');
  await page.getByLabel('Evidence').fill('frame 0-48');
  await page.getByLabel('Suggested correction').fill('Lower the camera and move closer');
  await page.getByRole('button', { name: 'Record this analysis' }).click();
  await expect.poll(() => writes.some(write => write.path.includes('/shots/'))).toBe(true);
  const analysisWrite = writes.find(write => write.path.includes('/shots/'));
  expect(analysisWrite?.body).toMatchObject({ result_id: resultOne, origin: 'creator' });
  const analysisPanel = page.getByLabel('Shot Match analysis');
  await expect(analysisPanel.getByText('Evidence: frame 0-48')).toBeVisible();
  await expect(analysisPanel.getByText(/not by a similarity score/)).toBeVisible();
  await expect(page.getByLabel('What this comparison could not see'))
    .toContainText('No audio track was extracted');

  // FIX THIS SHOT previews one scoped correction before anything is applied.
  await page.getByLabel('Corrected value').fill('Product lower third, camera lower');
  await page.getByLabel('Root cause').fill('The camera was higher than planned, so the Product read as secondary');
  await page.getByRole('button', { name: 'Propose correction' }).click();
  const proposal = page.getByLabel('Correction proposal');
  await expect(proposal.getByText(/1 direct/)).toBeVisible();
  await expect(proposal.getByText(/2 downstream/)).toBeVisible();
  await expect(proposal.getByText(/computed, not applied/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to this Shot' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/apply'))).toBe(true);
  await expect(page.getByText(/The previous plan, the Result and every earlier analysis are preserved/)).toBeVisible();

  // The creator marks the pickup, and the analysis decision is not an approval of the Result.
  await page.getByRole('button', { name: 'Request pickup' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/decide'))).toBe(true);
  await expect(page.getByText(/On-Set capture state/)).toBeVisible();
  await expect(page.getByText(/not an approval of the Result/)).toBeVisible();

  // The Result becomes approved only through the creator's own decision.
  await page.getByLabel('Result decision reason').fill('The new take reads correctly.');
  await page.getByRole('button', { name: 'Accept Result' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/state'))).toBe(true);
  const stateWrite = writes.find(write => write.path.endsWith('/state'));
  expect(stateWrite?.body).toMatchObject({ state: 'approved', note: 'The new take reads correctly.' });
  await expect(page.getByText(/Shot Match never approves a Result/)).toBeVisible();

  // The second Result and its analysis are readable as the iteration history of one Shot.
  await expect(page.getByLabel('Iteration history').getByText('decided: pickup')).toBeVisible();

  // ---------------------------------------------------------------- §96 readiness
  await page.goto(`/studio/${productionId}?tool=Readiness`);
  const summary = page.getByLabel('Readiness summary');
  await expect(summary.getByText('Needs review').first()).toBeVisible();
  await expect(summary.getByText('1 item needs a creator decision before this Production is ready.')).toBeVisible();
  await expect(page.getByLabel('Readiness blockers').getByText('1 Result needs review')).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('%');
  expect(text).toMatch(/not a score or a percentage/);

  // ---------------------------------------------------------------- one Production, one surface
  await expect(page.getByRole('button', { name: /^Generate/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /New Production/i })).toHaveCount(0);

  expect(errors).toEqual([]);
});
