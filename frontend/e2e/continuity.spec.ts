import { expect, test, type Page } from '@playwright/test';

// Prompt 9B continuity end-to-end: a Production's declared state is recorded at a real point in
// Production order, a deterministic check turns the declarations into findings, and the creator
// decides what happens to a finding. The API is stubbed at the network boundary, so the browser
// provably never decides anything itself: it cannot invent an anchor, it cannot resolve a finding
// by resolving a check, it cannot mark an inferred proposal as observed, and it says out loud that
// a check reads declarations rather than media.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const character = '00000000-0000-4000-8000-000000000801';
const sceneEighteen = '00000000-0000-4000-8000-000000000301';
const sceneNineteen = '00000000-0000-4000-8000-000000000302';
const shotTwelve = '00000000-0000-4000-8000-000000000401';
const stateOpening = '00000000-0000-4000-8000-000000000e01';
const stateEnding = '00000000-0000-4000-8000-000000000e02';
const stateClean = '00000000-0000-4000-8000-000000000e03';
const checkId = '00000000-0000-4000-8000-000000000f01';
const findingBreak = '00000000-0000-4000-8000-000000000f11';
const findingProposal = '00000000-0000-4000-8000-000000000f12';

const LIMITATION = 'Continuity here is what the Production records. It does not analyse media, and an unrecorded trait is unknown rather than consistent.';
const CHECK_RULE = 'A check compares the continuity statements recorded for this Production. It changes no statement, and it does not analyse media.';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-cont', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };

const production = { id: productionId, workspace_id: workspace, project_id: projectId, title: 'Marquee film', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 600000, calculated_duration_ms: 600000, start_ms: 0, end_ms: null, created_by: uid, revision: 7, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };
const shot = { id: shotTwelve, scene_id: sceneEighteen, order: 1, sort_order: 1024, title: 'Shot 12', description: 'Marcus leaves.', action: '', purpose: 'product', subject: 'Marcus', framing: 'medium close up', angle: 'eye level', movement: 'static', composition: 'lower third', transition: 'cut', story_relationship: 'proves the decision', story_beat: 'Break', creative_notes: '', execution_method: 'real', planned_duration_ms: 8000, approval: 'draft', locked_at: null, revision: 4, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [] };

const studioModel = {
  production: { id: productionId, workspace_id: workspace, title: production.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 600000, calculated_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
  scenes: [{
    id: sceneEighteen, order: 1, sort_order: 1024, title: 'Scene 18', purpose: 'Confrontation', story_beat: 'Break',
    description: 'Marcus decides to stay.', action_lines: [], opening_state: 'Packed bag', ending_state: 'Bag unpacked',
    visual_intent: 'One soft source', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 20000,
    duration_ms: 20000, timing: 'derived', approval: 'draft', locked_at: null, revision: 5, updated_at: '2026-10-05T00:00:00Z',
    character_asset_ids: [character], dialogue_lines: 0, shot_count: 1, bindings: [], shots: [shot],
  }],
  orphan_shots: [],
  assets: [{ id: character, asset_type: 'character', name: 'Marcus', description: 'Wardrobe established in Scene 4', approval: 'draft', locked_at: null, revision: 2, metadata: {}, used_by_scenes: [sceneEighteen] }],
  documents: {},
  timing: { total_ms: 600000, target_ms: 600000, delta_ms: 0, status: 'fits', scene_states: [{ scene_id: sceneEighteen, order: 1024, duration_ms: 20000, shots: 1, timing: 'derived' }] },
  runtime_conflict: false,
  timeline: [{ scene_id: sceneEighteen, order: 1, title: 'Scene 18', duration_ms: 20000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotTwelve, order: 1, title: 'Shot 12', duration_ms: 8000, execution_method: 'real', approval: 'draft', locked: false }] }],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 1, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 2 }, needs_attention: 0 },
  truncated: false, provider,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 9B production continuity.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'short_film', execution_method: 'real', planned_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 600000, assigned_ms: 600000, dialogue_ms: 0, action_ms: 0, slack_ms: 0, status: 'fits' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

const vocabulary = {
  domains: [{ domain: 'character', label: 'Character' }, { domain: 'wardrobe', label: 'Wardrobe' }, { domain: 'prop', label: 'Prop' }],
  anchors: [{ anchor: 'production', label: 'Whole Production' }, { anchor: 'scene_opening', label: 'Scene opening' }, { anchor: 'scene_ending', label: 'Scene ending' }, { anchor: 'shot', label: 'Shot' }],
  transitions: [{ transition: 'baseline', label: 'First statement' }, { transition: 'continuous', label: 'Continues unchanged' }, { transition: 'changed', label: 'Declared change' }],
  finding_kinds: [{ kind: 'boundary_break', label: 'Break across a Scene boundary' }],
  finding_states: [{ state: 'open', label: 'Open' }],
  severities: [{ severity: 'critical', label: 'Conflict' }],
  rules: [
    { kind: 'boundary_break', severity: 'critical', description: 'A trait changes across a Scene boundary without a declared change.' },
    { kind: 'unexplained_change', severity: 'warning', description: 'A trait changes inside one Scene while the statement says it continues unchanged.' },
    { kind: 'lock_conflict', severity: 'critical', description: 'A declared change touches a subject the creator protected with a continuity lock.' },
    { kind: 'missing_reason', severity: 'warning', description: 'A change was declared with no reason, so later Shots cannot be checked against it.' },
    { kind: 'unverified_after', severity: 'info', description: 'The last statement for a trait is a declared change and later work has none: continuity there is unknown.' },
  ],
  rule: 'Continuity is temporal: a statement records what one trait of one subject is at one point in Production order, and a change is declared rather than inferred.',
  limitation: LIMITATION,
};

const checkSummary = {
  check_id: checkId, verdict: 'conflict', verdict_label: 'Conflict', counts: { critical: 1, warning: 0, info: 0 },
  explanation: '1 continuity conflict needs a creator decision.', limitations: LIMITATION,
  created_at: '2026-10-05T10:00:00Z', is_current: true,
  freshness: 'This check matches the recorded statements.',
  summary: '1 continuity conflict(s) need a creator decision.', state_count: 3,
};

const summary = {
  live_states: 3, retired_states: 1, subject_count: 1,
  domains: [{ domain: 'character', count: 2, label: 'Character' }, { domain: 'wardrobe', count: 1, label: 'Wardrobe' }],
  check: checkSummary, findings: { open: 1, acknowledged: 0, critical_open: 1 },
  analysis_stale: false, stale_label: 'The recorded continuity analysis matches the statements.', limitations: LIMITATION,
};

const statements = {
  items: [
    { state_id: stateEnding, domain: 'character', subject_object_id: character, subject_label: 'Marcus',
      trait: 'shirt condition', anchor: 'scene_ending', scene_id: sceneEighteen, shot_id: null,
      scene_label: 'Scene 18', shot_label: null, value: 'blood on the left shoulder', transition: 'changed',
      origin: 'declared', epistemic: 'observed', confidence: 'high', reason: 'Marcus is injured in the kitchen.',
      retired: false, revision: 1, created_at: '2026-10-05T10:00:00Z', domain_label: 'Character',
      anchor_label: 'Scene ending', transition_label: 'Declared change', origin_label: 'Declared by you' },
    { state_id: stateOpening, domain: 'character', subject_object_id: character, subject_label: 'Marcus',
      trait: 'shirt condition', anchor: 'scene_opening', scene_id: sceneEighteen, shot_id: null,
      scene_label: 'Scene 18', shot_label: null, value: 'clean shirt', transition: 'baseline', origin: 'declared',
      epistemic: 'observed', confidence: 'high', reason: 'First appearance.',
      retired: true, retire_reason: 'Superseded by a newer statement at the same point in the Production.',
      revision: 2, created_at: '2026-10-05T09:00:00Z', domain_label: 'Character', anchor_label: 'Scene opening',
      transition_label: 'First statement', origin_label: 'Declared by you' },
  ],
  total: 2, live: 1, limit: 100, offset: 0, truncated: false, limitation: LIMITATION,
};

const findingBase = {
  domain: 'character', trait: 'shirt condition', subject_object_id: character, subject_label: 'Marcus',
  earlier_state_id: stateEnding, later_state_id: stateClean, scene_id: sceneNineteen, shot_id: null,
  scene_label: 'Scene 19', shot_label: null,
  explanation: 'The trait "shirt condition" was "blood on the left shoulder" at Scene 18 ending and is "shirt clean" at Scene 19 opening across a Scene boundary, and no change was declared.',
  suggested_resolution: 'Confirm the state actually carries over, or declare the change and the reason for it.',
  confidence: 'high', evidence: [{ kind: 'continuity_state', object_id: stateEnding }],
  state: 'open', resolution_note: '', resolved_at: null, check_id: checkId, created_at: '2026-10-05T10:00:00Z',
  severity_label: 'Conflict', kind_label: 'Break across a Scene boundary', state_label: 'Open',
  domain_label: 'Character', epistemic_label: 'Observed', subject_line: 'Marcus - shirt condition',
};
const derivedFinding = { ...findingBase, finding_id: findingBreak, kind: 'boundary_break', severity: 'critical', origin: 'derived', rationale: '', epistemic: 'observed' };
const proposal = { ...findingBase, finding_id: findingProposal, check_id: null, kind: 'unexplained_change', severity: 'warning',
  origin: 'inferred', rationale: 'Two statements disagree across the cut and no change is declared.', epistemic: 'estimated', confidence: 'low',
  explanation: 'The wardrobe may not match the injury across the cut.', suggested_resolution: 'Check the Scene 19 continuity photograph.',
  severity_label: 'Caution', kind_label: 'Unexplained change', origin_label: 'Inferred (proposal)', epistemic_label: 'Estimated' };

const findings = {
  items: [derivedFinding, proposal], total: 2, limit: 100, offset: 0, truncated: false,
  check: checkSummary, checks_available: 2, open_count: 2,
  note: 'A finding describes the recorded statements. Resolving it is a creator decision and does not change the statements.',
  open_label: '2 finding(s) are still open.', limitation: LIMITATION,
};

const checkResult = {
  check_id: checkId, verdict: 'conflict', verdict_label: 'Conflict', counts: { critical: 1, warning: 0, info: 0 },
  finding_count: 1, state_count: 3, production_revision: 9, state_watermark: '2026-10-05T10:00:00Z',
  explanation: '1 continuity conflict needs a creator decision.', limitations: LIMITATION,
  created_at: '2026-10-05T10:00:00Z', findings: [derivedFinding], rule: CHECK_RULE, limitation: LIMITATION,
};

const chain = {
  subject_object_id: character, subject_label: 'Marcus', statement_count: 3,
  statements: [
    { state_id: stateOpening, domain: 'character', trait: 'shirt condition', anchor: 'scene_opening', position_label: 'Scene 18 opening',
      scene_id: sceneEighteen, shot_id: null, value: 'torn shirt', transition: 'baseline', origin: 'declared',
      epistemic: 'observed', confidence: 'high', reason: 'First appearance.', domain_label: 'Character',
      anchor_label: 'Scene opening', transition_label: 'First statement' },
    { state_id: stateEnding, domain: 'character', trait: 'shirt condition', anchor: 'scene_ending', position_label: 'Scene 18 ending',
      scene_id: sceneEighteen, shot_id: null, value: 'blood on the left shoulder', transition: 'changed', origin: 'declared',
      epistemic: 'observed', confidence: 'high', reason: 'Marcus is injured in the kitchen.', domain_label: 'Character',
      anchor_label: 'Scene ending', transition_label: 'Declared change' },
  ],
  note: 'This is the recorded timeline of the subject. It lists declared statements in Production order.',
  limitation: LIMITATION,
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
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-05T00:00:00Z' } }));
  }, { uid });
}

type Write = { path: string; body: Record<string, unknown> };

/** Stub the continuity API at the network boundary and record every write. */
async function continuityApi(page: Page, writes: Write[], state: { resolved: boolean; superseded: boolean }) {
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });
    if (path.endsWith('/continuity/vocabulary')) return route.fulfill({ json: envelope(vocabulary) });
    if (path.endsWith('/continuity/summary')) return route.fulfill({ json: envelope(summary) });
    if (path.endsWith('/continuity/states') && request.method() === 'GET') return route.fulfill({ json: envelope(statements) });
    if (path.endsWith('/continuity/chain')) return route.fulfill({ json: envelope(chain) });
    if (path.endsWith('/continuity/states') && request.method() === 'POST') {
      writes.push({ path, body }); state.superseded = true;
      return route.fulfill({ json: envelope({ state_id: stateEnding, updated: false, superseded_state_id: stateOpening,
        note: 'The previous statement at this point was kept and marked as superseded.' }) });
    }
    if (path.endsWith('/continuity/check')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope(checkResult) });
    }
    if (path.endsWith('/continuity/findings') && request.method() === 'GET') {
      return route.fulfill({ json: envelope(state.resolved
        ? { ...findings, items: [{ ...derivedFinding, state: 'resolved', state_label: 'Resolved', resolved_at: '2026-10-05T11:00:00Z', resolution_note: 'Decided from Studio: resolved.' }, proposal], open_count: 1,
            check: { ...checkSummary, is_current: false, freshness: 'The statements changed after this check ran, so it is out of date.' } }
        : findings) });
    }
    if (path.endsWith('/continuity/findings') && request.method() === 'POST') {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ ...proposal, state: 'open', note: 'This is a proposal, not a finding of fact. It does not change any continuity statement.' }) });
    }
    if (path.includes('/continuity/findings/') && request.method() === 'PATCH') {
      writes.push({ path, body }); state.resolved = true;
      return route.fulfill({ json: envelope({ finding_id: findingBreak, state: 'resolved',
        resolution_note: 'Decided from Studio: resolved.',
        note: 'The finding was recorded. The continuity statements and any approval are unchanged.' }) });
    }
    if (path.includes('/continuity/states/') && path.endsWith('/retire')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ state_id: stateEnding, retired: true,
        note: 'The statement is retired, not deleted: its history stays readable.' }) });
    }
    return route.fulfill({ json: envelope(null) });
  });
}

test('a declared change is checked, a conflict is decided, and continuity stays truthful (9B)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  const state = { resolved: false, superseded: false };
  await continuityApi(page, writes, state);

  await page.goto(`/studio/${productionId}?tool=Continuity&scene=${sceneEighteen}&shot=${shotTwelve}`);

  // 1. Continuity is temporal, and the surface says what a check cannot see.
  await expect(page.getByText(/a change is declared rather than inferred/)).toBeVisible();
  await expect(page.getByText(/It does not analyse media/).first()).toBeVisible();
  await expect(page.getByText(/unrecorded trait is unknown rather than consistent/).first()).toBeVisible();

  // 2. The recorded analysis is named together with whether it still matches the statements.
  await expect(page.getByText(/The recorded continuity analysis matches the statements/)).toBeVisible();
  await expect(page.getByText(/1 continuity conflict\(s\) need a creator decision/).first()).toBeVisible();

  // 3. A statement is recorded for the real Scene ending, with the anchor the browser should never invent.
  await page.getByLabel('Continuity trait').fill('shirt condition');
  await page.getByLabel('Continuity value').fill('torn shirt');
  await page.getByLabel('Continuity anchor').selectOption('scene_opening');
  await page.getByLabel('Continuity transition').selectOption('changed');
  await page.getByLabel('Continuity reason').fill('The shirt tore in the kitchen.');
  await page.getByRole('button', { name: /Record statement for Scene 18 \(opening\)/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/continuity/states'))).toBe(true);
  expect(writes.find(write => write.path.endsWith('/continuity/states'))?.body).toMatchObject({
    domain: 'character', trait: 'shirt condition', value: 'torn shirt', anchor: 'scene_opening',
    scene_id: sceneEighteen, shot_id: null, transition: 'changed', reason: 'The shirt tore in the kitchen.',
    subject_object_id: character,
  });
  expect(writes.find(write => write.path.endsWith('/continuity/states'))?.path)
    .toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/continuity/states`);
  await expect(page.getByText(/kept and marked as superseded/)).toBeVisible();

  // 4. A superseded statement is history, not a deletion.
  await expect(page.getByText(/Superseded by a newer statement/).first()).toBeVisible();
  await page.getByLabel('Include superseded and retired statements').check();
  await expect(page.getByText(/Superseded by a newer statement/).first()).toBeVisible();

  // 5. The check carries a note and nothing else, and it names the conflict it found.
  await page.getByRole('button', { name: /Check this Production/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/continuity/check'))).toBe(true);
  expect(writes.find(write => write.path.endsWith('/continuity/check'))?.body).toEqual({ note: 'Run from Studio.' });
  await expect(page.getByText(/It changes no statement, and it does not analyse media/).first()).toBeVisible();
  await expect(page.getByText(/Break across a Scene boundary/).first()).toBeVisible();
  await expect(page.getByText(/Confirm the state actually carries over/).first()).toBeVisible();

  // 6. A proposal is shown as a proposal: inferred, estimated, and with its own basis.
  await expect(page.getByText('Inferred (proposal)')).toBeVisible();
  await expect(page.getByText(/Basis: Two statements disagree across the cut/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve/ })).toHaveCount(0);

  // 7. Resolving a finding is a creator decision and changes no statement or approval.
  await page.getByRole('button', { name: /Mark resolved/ }).first().click();
  await expect.poll(() => state.resolved).toBe(true);
  const decision = writes.find(write => write.path.includes('/continuity/findings/') && write.body.state === 'resolved');
  expect(decision?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/continuity/findings/${findingBreak}`);
  await expect(page.getByText(/The continuity statements and any approval are unchanged/)).toBeVisible();
  await expect(page.getByText(/The statements changed after this check ran, so it is out of date/)).toBeVisible();

  // 8. A subject's timeline is read in Production order, earliest first.
  await page.getByRole('button', { name: /Read timeline for Marcus/ }).click();
  await expect(page.getByText(/Scene 18 opening/).first()).toBeVisible();
  await expect(page.getByText(/3 statement\(s\), earliest first/)).toBeVisible();

  // 9. A narrow viewport keeps the whole surface usable and never overflows horizontally.
  // The drawer is ephemeral by design, so reopening after reload goes through the same link.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.goto(`/studio/${productionId}?tool=Continuity&scene=${sceneEighteen}&shot=${shotTwelve}`);
  await expect(page.getByText(/a change is declared rather than inferred/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  expect(errors).toEqual([]);
});
