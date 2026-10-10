import { expect, test, type Page } from '@playwright/test';

// Prompt 9F Results, Shot Match and FIX THIS SHOT end-to-end: a Result shows what was actually
// created and where it came from, the comparison only claims the modalities the database verified,
// the analysis is a diagnosis ordered by production impact rather than a similarity score, a
// mismatch produces a recommendation instead of an action, and FIX THIS SHOT previews one scoped
// correction before applying it. The API is stubbed at the network boundary, so the browser
// provably decides none of this itself: it never manufactures an approval, never invents a finding
// without evidence, and never launches generation.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneOne = '00000000-0000-4000-8000-000000000201';
const shotOne = '00000000-0000-4000-8000-000000000401';
const resultOne = '00000000-0000-4000-8000-000000000501';
const reportOne = '00000000-0000-4000-8000-000000000502';
const correctionOne = '00000000-0000-4000-8000-000000000503';
const planOne = '00000000-0000-4000-8000-000000000504';

const LIMITATION = 'Comparison only uses the modalities verified from real media rows. No visual claim is made without extracted frames or an image, no audio claim without an audio track, and no lens, person or identity is ever measured or identified from imagery.';
const RULE = 'A Result is what was actually created, not the plan. Shot Match diagnoses what is different and how to fix it: it is not a similarity score, it never approves a Result, and it launches no generation. Approval and Final stay creator decisions.';
const PRESERVED = 'A new revision was created. The previous plan, the Result and every earlier analysis are preserved.';
const REAL_LINE = 'Real Take 1 · preferred';
const CAPABILITY_LINE = 'Compared from metadata, a thumbnail, an image, extracted frames.';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-ms', timestamp: '2026-10-06T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };

const production = { id: productionId, workspace_id: workspace, project_id: projectId, title: 'Marquee film', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 600000, calculated_duration_ms: 600000, start_ms: 0, end_ms: null, created_by: uid, revision: 7, created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z' };

const shot = { id: shotOne, scene_id: sceneOne, order: 1, sort_order: 1024, title: 'Marcus enters', description: 'Marcus enters with the Product.', action: '', purpose: 'product', subject: 'Marcus', framing: 'lower third', angle: 'eye level', movement: 'static', composition: 'lower third', transition: 'cut', story_relationship: 'proves the decision', story_beat: 'Break', creative_notes: '', execution_method: 'real', planned_duration_ms: 4000, approval: 'draft', locked_at: null, revision: 2, updated_at: '2026-10-06T00:00:00Z', result_count: 1, bindings: [] };
const scene = { id: sceneOne, order: 1, sort_order: 1024, title: 'Scene 1 Apartment', purpose: 'The reveal', story_beat: 'Break',
  description: 'Marcus enters.', action_lines: [], opening_state: 'Empty counter', ending_state: 'Product placed',
  visual_intent: 'One soft source', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 20000,
  duration_ms: 20000, timing: 'derived', approval: 'draft', locked_at: null, revision: 3,
  updated_at: '2026-10-06T00:00:00Z', character_asset_ids: [], dialogue_lines: 0, shot_count: 1, bindings: [], shots: [shot] };

const studioModel = {
  production: { id: productionId, workspace_id: workspace, title: production.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 600000, calculated_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-06T00:00:00Z' },
  scenes: [scene], orphan_shots: [], assets: [], documents: {},
  timing: { total_ms: 600000, target_ms: 600000, delta_ms: 0, status: 'fits', scene_states: [] },
  runtime_conflict: false,
  timeline: [{ scene_id: sceneOne, order: 1, title: scene.title, duration_ms: 20000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotOne, order: 1, title: shot.title, duration_ms: 4000, execution_method: 'real', approval: 'draft', locked: false }] }],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 1, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 2 }, needs_attention: 0 },
  truncated: false, provider,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 9F shot match.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'short_film', execution_method: 'real', planned_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 600000, assigned_ms: 600000, dialogue_ms: 0, action_ms: 0, slack_ms: 0, status: 'fits' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

const vocabulary = {
  result_states: [{ state: 'raw', label: 'Raw' }, { state: 'needs_review', label: 'Needs review' },
    { state: 'approved', label: 'Approved' }, { state: 'rejected', label: 'Rejected' }, { state: 'final', label: 'Final' }],
  result_origins: [{ origin: 'real_take', label: 'Real Take' }, { origin: 'ai_generation', label: 'AI Attempt' }],
  match_verdicts: [{ verdict: 'matches_intent', label: 'Matches intent' },
    { verdict: 'acceptable_variation', label: 'Acceptable variation' }, { verdict: 'needs_attention', label: 'Needs attention' },
    { verdict: 'mismatch', label: 'Mismatch' }, { verdict: 'unknown', label: 'Not enough evidence' }],
  correction_states: [{ state: 'proposed', label: 'Proposed' }, { state: 'applied', label: 'Applied' }, { state: 'rejected', label: 'Rejected' }],
  correction_recommendations: [{ recommendation: 'none', label: 'No fix required' },
    { recommendation: 'pickup_required', label: 'Pickup required' },
    { recommendation: 'regeneration_recommended', label: 'Regeneration recommended' }],
  match_origins: [{ origin: 'deterministic', label: 'Deterministic comparison' },
    { origin: 'creator', label: 'Creator statement' }, { origin: 'ai_proposal', label: 'AI proposal' }],
  severities: [{ severity: 'info', label: 'Note' }, { severity: 'warning', label: 'Warning' }, { severity: 'critical', label: 'Critical' }],
  rule: RULE, limitation: LIMITATION,
};

const capabilities = { metadata: true, thumbnail: true, image: true, video_frames: true, audio: false,
  media_state: 'uploaded/ready', file_category: 'video', mime_type: 'video/mp4',
  notes: ['No audio track was extracted, so audio comparison is not claimed.'] };

function resultItem(overrides: Record<string, unknown> = {}) {
  return {
    result_id: resultOne, shot_id: shotOne, shot_label: 'Shot 1 Marcus enters',
    state: 'needs_review', state_label: 'Needs review', approval: 'draft', locked: false, revision: 3,
    origin: 'real_take', origin_label: 'Real Take',
    provenance: { origin: 'real_take', take_id: planOne, take_number: 1, take_status: 'preferred', media_state: 'uploaded/ready' },
    capabilities, capability_line: CAPABILITY_LINE,
    match_reports: 1, match_worst_severity: 'critical', match_severity_label: 'Critical',
    match_recommendation: 'pickup_required', match_recommendation_label: 'Pickup required',
    created_at: '2026-10-06T10:00:00Z',
    final_line: 'Final is explicitly accepted evidence or deliverable state. Generation completion never sets it.',
    ...overrides,
  };
}

const resultsList = { items: [resultItem()], total: 1, limit: 50, offset: 0, note: 'A Result is what was created, not the plan.', rule: RULE };

const report = {
  report_id: reportOne, shot_id: shotOne, shot_label: 'Shot 1 Marcus enters', result_id: resultOne,
  result_state: 'needs_review', state: 'complete', severity: 'critical', severity_label: 'Critical',
  approval: 'draft', decision: null, decision_note: '', decided_by: null, decided_at: null,
  origin: 'creator', origin_label: 'Creator statement',
  recommendation: 'pickup_required', recommendation_label: 'Pickup required',
  capabilities, capability_line: CAPABILITY_LINE,
  findings: [{ category: 'product_fidelity', verdict: 'mismatch', verdict_label: 'Mismatch',
    expected: 'Product mark readable', observed: 'Product mark is unreadable',
    difference: 'The Product logo cannot be read', epistemic: 'observed', epistemic_label: 'Observed',
    confidence: 'high', confidence_label: 'High confidence', severity: 'critical', severity_label: 'Critical',
    evidence: ['frame 12-40'], suggested_correction: 'Rotate the Product toward camera', region: '', time_range: '',
    continuity_finding_id: '00000000-0000-4000-8000-000000000505' }],
  dimensions: [{ dimension: 'product_fidelity', verdict: 'mismatch', verdict_label: 'Mismatch', findings: 1, weight: 95 }],
  summary: {
    what_worked: [{ category: 'color', verdict: 'acceptable_variation' }],
    what_drifted: [{ category: 'product_fidelity', verdict: 'mismatch', severity: 'critical', difference: 'The Product logo cannot be read' }],
    what_matters_most: [{ category: 'product_fidelity', weight: 95, difference: 'The Product logo cannot be read', verdict: 'mismatch' }],
    what_to_fix_next: [{ category: 'product_fidelity', fix: 'Rotate the Product toward camera' }],
    note: 'Ordered by production impact, not by a similarity score.',
  },
  recommendations: [], limitations: ['No audio track was extracted, so audio comparison is not claimed.'],
  corrected_plan_id: null, corrections: [],
  iteration_chain: [
    { report_id: '00000000-0000-4000-8000-0000000005ff', created_at: '2026-10-06T09:00:00Z', severity: 'warning', recommendation: 'pickup_required', decision: 'pickup' },
    { report_id: reportOne, created_at: '2026-10-06T10:00:00Z', severity: 'critical', recommendation: 'pickup_required', decision: null },
  ],
  headline: 'The Product logo cannot be read', note: 'The iteration history is preserved.', rule: RULE, limitation: LIMITATION,
};

const detail = { ...resultItem(), scene_id: sceneOne, media_id: planOne,
  plan: { plan_id: planOne, execution_method: 'real', approval: 'draft', revision: 1, framing: 'Product lower third' },
  version_count: 4,
  match_reports: [{ report_id: reportOne, state: 'complete', severity: 'critical', recommendation: 'pickup_required', decision: null, origin: 'creator', approval: 'draft', created_at: '2026-10-06T10:00:00Z' }],
  corrections: [] };

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
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-06T00:00:00Z' } }));
  }, { uid });
}

type Write = { path: string; body: Record<string, unknown> };

async function shotMatchApi(page: Page, writes: Write[]) {
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    const method = request.method();
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });
    if (path.endsWith('/shot-match/vocabulary')) return route.fulfill({ json: envelope(vocabulary) });

    // A creator records what is different. The surface never invents a finding.
    if (path.includes('/shots/') && path.endsWith('/shot-match') && method === 'POST') {
      writes.push({ path, body });
      const finding = (body.findings as Array<Record<string, unknown>>)[0];
      return route.fulfill({ json: envelope({ ...report, origin: 'creator',
        severity: finding.severity, severity_label: 'Critical',
        findings: [{ ...report.findings[0], category: finding.category, difference: finding.difference,
          evidence: finding.evidence, severity: finding.severity,
          suggested_correction: finding.suggested_correction }] }) });
    }
    if (path.endsWith('/corrections') && method === 'POST') {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ correction_id: correctionOne, report_id: reportOne, shot_id: shotOne,
        state: 'proposed', state_label: 'Proposed', target_object_id: body.target_object_id,
        target_kind: 'execution_plan', target_label: 'Shot 1 Real plan', source_revision: 1,
        patch: body.patch, root_cause: body.root_cause, why: body.why, affected: body.affected,
        recommendation: 'pickup_required',
        preview: { analysis_id: '00000000-0000-4000-8000-000000000506', counts: { direct: 1, downstream: 2, potential: 0, total: 3 } },
        impact_line: 'The impact was computed and is applied only when you accept the correction. Nothing downstream was changed by proposing it.',
        note: 'The correction is a proposal.' }) });
    }
    if (path.endsWith('/apply')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ correction_id: correctionOne, report_id: reportOne, shot_id: shotOne,
        state: 'applied', state_label: 'Applied', target_object_id: planOne, target_kind: 'execution_plan',
        target_label: 'Shot 1 Real plan', source_revision: 1, patch: { camera_height: 'low, at product level' },
        root_cause: 'The camera was higher than planned', why: 'The Product read as secondary',
        affected: 'Scoped to Shot 1 Real plan only', applied_revision: 2,
        applied_version_id: '00000000-0000-4000-8000-000000000507', changed_fields: ['camera_height'],
        propagation: [{ counts: { direct: 1, downstream: 2 }, marked: 2 }],
        preserved_line: PRESERVED, note: 'A new revision was created.' }) });
    }
    if (path.endsWith('/reject')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ correction_id: correctionOne, report_id: reportOne, shot_id: shotOne,
        state: 'rejected', state_label: 'Rejected', target_object_id: planOne, target_kind: 'execution_plan',
        target_label: 'Shot 1 Real plan', source_revision: 1, patch: {},
        note: 'The correction was rejected. Nothing changed and nothing was overwritten.' }) });
    }
    if (path.endsWith('/decide')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ report_id: reportOne, shot_id: shotOne, decision: body.decision,
        decision_label: 'Regeneration recommended', approval: 'approved',
        recommendation: 'pickup_required', recommendation_label: 'Pickup required',
        capture_status: body.decision === 'pickup' ? 'pickup_needed' : null,
        note: 'Regeneration is recommended. Nothing was launched: generation still needs the normal explicit confirmation.',
        meaning: 'Deciding a Shot Match report is not an approval of the Result.' }) });
    }
    if (path.endsWith('/state') && method === 'POST') {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ result_id: resultOne, state: body.state, state_label: 'Approved',
        previous_state: 'needs_review', approval: 'approved', revision: 4, note: body.note ?? '',
        meaning: 'A creator accepted this Result. Shot Match never approves a Result.' }) });
    }
    if (path.endsWith('/results') && method === 'GET') return route.fulfill({ json: envelope(resultsList) });
    if (path.includes('/results/') && method === 'GET') return route.fulfill({ json: envelope(detail) });
    if (path.endsWith('/shot-match') && method === 'GET') {
      return route.fulfill({ json: envelope({ items: [{ ...report }], total: 2,
        note: 'Each report is one analysis in the Shot iteration history.', rule: RULE }) });
    }
    if (path.includes('/shot-match/') && method === 'GET') return route.fulfill({ json: envelope(report) });
    return route.fulfill({ json: envelope(null) });
  });
}

test('a Result is what was created, the comparison is a diagnosis, and FIX THIS SHOT is scoped (9F)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  await shotMatchApi(page, writes);

  await page.goto(`/studio/${productionId}?tool=Results`);

  // 1. A Result shows what was actually created, where it came from and what was verified.
  const results = page.getByLabel('Results');
  await expect(results.getByText(REAL_LINE)).toBeVisible();
  await expect(results.getByLabel('Recorded results').getByText('Needs review')).toBeVisible();
  await expect(results.getByText(CAPABILITY_LINE).first()).toBeVisible();
  await expect(page.getByText('REAL · draft · revision 1')).toBeVisible();
  await expect(page.getByText(/Generation completion never sets it/)).toBeVisible();

  // 2. Nothing on this surface is a similarity score.
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('%');
  expect(text).toMatch(/not a similarity score/);
  expect(text).toContain(LIMITATION);

  // 3. Accepting a Result is a creator decision and posts the revision being reviewed.
  await page.getByLabel('Result decision reason').fill('The take reads correctly.');
  await page.getByRole('button', { name: 'Accept Result' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/state'))).toBe(true);
  const stateWrite = writes.find(write => write.path.endsWith('/state'));
  expect(stateWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/results/${resultOne}/state`);
  expect(stateWrite?.body).toEqual({ state: 'approved', expected_revision: 3, note: 'The take reads correctly.' });
  await expect(page.getByText(/Shot Match never approves a Result/)).toBeVisible();

  // 4. A finding may not be recorded without the evidence it was seen on.
  await page.getByLabel('Difference').fill('The Product logo cannot be read');
  await page.getByRole('button', { name: 'Record this analysis' }).click();
  await expect(page.getByRole('alert')).toContainText('cite the evidence it was seen on');
  expect(writes.some(write => write.path.includes('/shots/'))).toBe(false);

  // 5. The recorded analysis carries the dimension, the evidence and the severity the creator stated.
  await page.getByLabel('Dimension compared').selectOption('product_fidelity');
  await page.getByLabel('Finding severity').selectOption('critical');
  await page.getByLabel('Evidence').fill('frame 12-40');
  await page.getByLabel('Suggested correction').fill('Rotate the Product toward camera');
  await page.getByRole('button', { name: 'Record this analysis' }).click();
  await expect.poll(() => writes.some(write => write.path.includes('/shots/'))).toBe(true);
  const analyzeWrite = writes.find(write => write.path.includes('/shots/'));
  expect(analyzeWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/shots/${shotOne}/shot-match`);
  expect(analyzeWrite?.body).toMatchObject({ result_id: resultOne, origin: 'creator' });
  expect((analyzeWrite?.body.findings as Array<Record<string, unknown>>)[0]).toMatchObject({
    category: 'product_fidelity', evidence: ['frame 12-40'], severity: 'critical',
    epistemic: 'observed', confidence: 'high' });

  // 6. The analysis is a diagnosis: dimension verdicts, a summary ordered by impact, and what it
  //    could not see. No numeric similarity is rendered anywhere.
  const analysis = page.getByLabel('Shot Match analysis');
  await expect(analysis.getByText('Mismatch').first()).toBeVisible();
  await expect(analysis.getByText('Evidence: frame 12-40')).toBeVisible();
  await expect(analysis.getByText('Ordered by production impact, not by a similarity score.')).toBeVisible();
  const limits = page.getByLabel('What this comparison could not see');
  await expect(limits.getByText('No audio track was extracted, so audio comparison is not claimed.')).toBeVisible();

  // 7. Deciding an analysis recommends regeneration without launching anything.
  await page.getByRole('button', { name: 'Recommend regeneration' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/decide'))).toBe(true);
  const decideWrite = writes.find(write => write.path.endsWith('/decide'));
  expect(decideWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/shot-match/${reportOne}/decide`);
  expect(decideWrite?.body).toEqual({ decision: 'regeneration', note: '' });
  await expect(page.getByText(/Nothing was launched/)).toBeVisible();
  await expect(page.getByText(/Deciding an analysis is not an approval of the Result/)).toBeVisible();

  // 8. The Shot's whole iteration history stays readable.
  const chain = page.getByLabel('Iteration history');
  await expect(chain.getByText('decided: pickup')).toBeVisible();

  // 9. FIX THIS SHOT refuses a root cause that only names the mismatch, then proposes one scoped
  //    change and previews the impact before anything is applied.
  await page.getByLabel('Corrected value').fill('low, at product level');
  await page.getByLabel('Root cause').fill('mismatch');
  await page.getByRole('button', { name: 'Propose correction' }).click();
  await expect(page.getByRole('alert')).toContainText('Explain the production cause');
  expect(writes.some(write => write.path.endsWith('/corrections'))).toBe(false);

  await page.getByLabel('Correction target').selectOption(planOne);
  await page.getByLabel('Field to correct').selectOption('camera_height');
  await page.getByLabel('Root cause').fill('The camera was higher than planned, so the Product read as secondary');
  await page.getByRole('button', { name: 'Propose correction' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/corrections'))).toBe(true);
  const proposeWrite = writes.find(write => write.path.endsWith('/corrections'));
  expect(proposeWrite?.body).toMatchObject({ target_object_id: planOne, patch: { camera_height: 'low, at product level' } });
  const proposal = page.getByLabel('Correction proposal');
  await expect(proposal.getByText(/1 direct/)).toBeVisible();
  await expect(proposal.getByText(/2 downstream/)).toBeVisible();
  await expect(proposal.getByText(/computed, not applied/)).toBeVisible();

  // 10. Applying creates a new revision and says the earlier plan and Result are preserved.
  await page.getByRole('button', { name: 'Apply to this Shot' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/apply'))).toBe(true);
  const applyWrite = writes.find(write => write.path.endsWith('/apply'));
  expect(applyWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/shot-match/corrections/${correctionOne}/apply`);
  expect(applyWrite?.body).toEqual({ expected_revision: 1, propagation: 'change_only_this', note: '', record_candidate: false });
  await expect(page.getByText(PRESERVED)).toBeVisible();

  // 11. This surface can never launch generation.
  await expect(page.getByRole('button', { name: /^Generate/ })).toHaveCount(0);

  // 12. A narrow viewport keeps the surface usable and never overflows horizontally.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByLabel('Results').getByText(REAL_LINE)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  expect(errors).toEqual([]);
});
