import { expect, test, type Page } from '@playwright/test';

// Prompt 9E approval, locks and Production readiness end-to-end: approval names the exact revision
// a creator accepted, a later change is reported as changed after approval rather than still
// approved, lock and approval stay independent, unlocking is explicit and carries its reason, and
// readiness is a category derived from real state with navigable blockers - never a score, and
// never a claim about an external provider. The API is stubbed at the network boundary, so the
// browser provably never decides any of this itself: it cannot manufacture an approval, it cannot
// unlock without a reason, and it never asks for a decision the API does not support.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneTwo = '00000000-0000-4000-8000-000000000301';
const shotTwelve = '00000000-0000-4000-8000-000000000401';

const LIMITATION = 'Readiness is a category derived from real production state, not a score or a percentage. AI provider availability is an external dependency and is not guessed here.';
const RULE = 'Approval means a creator accepted this specific revision. It is not a generation result, a validation pass or a model opinion. Lock and approval are independent.';
const CHANGED_LINE = 'This content changed after it was approved. The earlier approval still names the revision it accepted, not this one.';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-rd', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };

const production = { id: productionId, workspace_id: workspace, project_id: projectId, title: 'Marquee film', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 600000, calculated_duration_ms: 600000, start_ms: 0, end_ms: null, created_by: uid, revision: 7, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };

const scene = { id: sceneTwo, order: 1, sort_order: 1024, title: 'Scene 2 Kitchen', purpose: 'The reveal', story_beat: 'Break',
  description: 'Marcus decides to stay.', action_lines: [], opening_state: 'Packed bag', ending_state: 'Bag unpacked',
  visual_intent: 'One soft source', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 20000,
  duration_ms: 20000, timing: 'derived', approval: 'changed_after_approval', locked_at: null, revision: 5,
  updated_at: '2026-10-05T00:00:00Z', character_asset_ids: [], dialogue_lines: 0, shot_count: 1, bindings: [], shots: [] };
const shot = { id: shotTwelve, scene_id: sceneTwo, order: 1, sort_order: 1024, title: 'Marcus close-up', description: 'Marcus leaves.', action: '', purpose: 'product', subject: 'Marcus', framing: 'medium close up', angle: 'eye level', movement: 'static', composition: 'lower third', transition: 'cut', story_relationship: 'proves the decision', story_beat: 'Break', creative_notes: '', execution_method: 'real', planned_duration_ms: 8000, approval: 'draft', locked_at: null, revision: 4, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [] };
scene.shots = [shot] as never;

const studioModel = {
  production: { id: productionId, workspace_id: workspace, title: production.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 600000, calculated_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
  scenes: [scene], orphan_shots: [], assets: [], documents: {},
  timing: { total_ms: 600000, target_ms: 600000, delta_ms: 0, status: 'fits', scene_states: [] },
  runtime_conflict: false,
  timeline: [{ scene_id: sceneTwo, order: 1, title: 'Scene 2 Kitchen', duration_ms: 20000, timing: 'derived', approval: 'changed_after_approval', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotTwelve, order: 1, title: 'Marcus close-up', duration_ms: 8000, execution_method: 'real', approval: 'draft', locked: false }] }],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 1, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 1, changed_after_approval: 1 }, needs_attention: 1 },
  truncated: false, provider,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 9E readiness.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'short_film', execution_method: 'real', planned_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 600000, assigned_ms: 600000, dialogue_ms: 0, action_ms: 0, slack_ms: 0, status: 'fits' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

const vocabulary = {
  access_actions: [{ action: 'approve', label: 'Approved' }, { action: 'request_review', label: 'Waiting for review' },
    { action: 'reopen', label: 'Reopened for editing' }, { action: 'lock', label: 'Locked' }, { action: 'unlock', label: 'Unlocked' }],
  approval_states: [{ state: 'draft', label: 'Draft' }, { state: 'approved', label: 'Approved' },
    { state: 'changed_after_approval', label: 'Changed after approval' }],
  readiness_states: [{ state: 'ready', label: 'Ready' }, { state: 'ready_with_warnings', label: 'Ready with warnings' },
    { state: 'needs_review', label: 'Needs review' }, { state: 'blocked', label: 'Blocked' }, { state: 'unknown', label: 'Not enough planned state' }],
  readiness_dimensions: [{ dimension: 'scene_plan', label: 'Scene plan' }, { dimension: 'continuity', label: 'Continuity' },
    { dimension: 'approvals', label: 'Approvals' }],
  severities: [{ severity: 'blocking', label: 'Blocks progress' }, { severity: 'review', label: 'Needs review' }, { severity: 'warning', label: 'Warning' }],
  rule: RULE, limitation: LIMITATION,
};

const report = {
  production_id: productionId, production_revision: 7, title: 'Marquee film', state: 'blocked', state_label: 'Blocked',
  dimensions: [
    { dimension: 'scene_plan', label: 'Scene plan', state: 'ready', state_label: 'Ready', present: true, counts: { blocking: 0, review: 0, warning: 0 } },
    { dimension: 'continuity', label: 'Continuity', state: 'blocked', state_label: 'Blocked', present: true, counts: { blocking: 1, review: 1, warning: 0 } },
    { dimension: 'approvals', label: 'Approvals', state: 'needs_review', state_label: 'Needs review', present: true, counts: { blocking: 0, review: 1, warning: 0 } },
  ],
  blockers: [
    { code: 'continuity_critical', severity: 'blocking', dimension: 'continuity', severity_label: 'Blocks progress', dimension_label: 'Continuity',
      problem: 'Marcus wears a red jacket then a blue one.', affected_object_id: sceneTwo, affected_label: 'Scene 2 Kitchen',
      affected_kind: 'scene', why_it_matters: 'A critical continuity conflict is unresolved.',
      required_action: 'Resolve or explicitly accept the continuity finding.', action_source: 'continuity_finding' },
    { code: 'changed_after_approval', severity: 'review', dimension: 'approvals', severity_label: 'Needs review', dimension_label: 'Approvals',
      problem: 'Approved content changed since it was approved.', affected_object_id: shotTwelve, affected_label: 'Marcus close-up',
      affected_kind: 'shot', why_it_matters: 'An approval describes a specific revision.',
      required_action: 'Review the new revision and approve it.', action_source: 'shot' },
  ],
  counts: { blocking: 1, review: 1, warning: 0, total: 2 },
  headline: '1 blocker must be resolved before this Production can move forward.',
  notes: ['Readiness is a category derived from real production state, not a score or a percentage.'],
  generated_at: '2026-10-05T10:00:00Z', limitation: LIMITATION,
};

function accessState(overrides: Record<string, unknown> = {}) {
  return {
    object_id: sceneTwo, object_kind: 'scene', label: 'Scene 2 Kitchen',
    approval: 'changed_after_approval', approval_label: 'Changed after approval', locked: false,
    current_revision: 5, approved_revision: 4, approved_by: uid, approved_at: '2026-10-05T09:00:00Z',
    changed_since_approval: true, locked_at: null, locked_by: null, lock_reason: '',
    decisions: [{ id: 'd1', action: 'approve', from_approval: 'needs_review', to_approval: 'approved',
      from_locked: false, to_locked: false, pinned_revision: 4, note: 'The opening beat is locked.',
      actor_user_id: uid, created_at: '2026-10-05T09:00:00Z', action_label: 'Approved' }],
    note: 'Approval names the exact revision it accepted.',
    changed_line: CHANGED_LINE, lock_line: 'Unlocked.', rule: RULE,
    ...overrides,
  };
}

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

async function readinessApi(page: Page, writes: Write[], state: { locked: boolean; approved: boolean }) {
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    const method = request.method();
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });
    if (path.endsWith('/readiness/vocabulary')) return route.fulfill({ json: envelope(vocabulary) });
    if (path.endsWith('/readiness')) return route.fulfill({ json: envelope(report) });
    if (path.endsWith('/decide') && method === 'POST') {
      writes.push({ path, body });
      state.approved = body.decision === 'approve';
      return route.fulfill({ json: envelope({ object_id: sceneTwo, object_kind: 'scene', label: 'Scene 2 Kitchen',
        action: body.decision, action_label: 'Approved', approval: state.approved ? 'approved' : 'needs_review',
        approval_label: state.approved ? 'Approved' : 'Needs review', revision: 6,
        approved_revision: state.approved ? 6 : null, locked: state.locked, note: body.note ?? '',
        actor_user_id: uid, decided_at: '2026-10-05T11:00:00Z',
        meaning: state.approved ? 'A creator accepted this exact revision. Approval is a human decision, not a generation result.'
          : 'This revision is waiting for a creator review.' }) });
    }
    if (path.endsWith('/lock') && method === 'POST') {
      writes.push({ path, body });
      state.locked = body.locked === true;
      return route.fulfill({ json: envelope({ object_id: sceneTwo, object_kind: 'scene', label: 'Scene 2 Kitchen',
        task: state.locked ? 'lock' : 'unlock', action_label: state.locked ? 'Locked' : 'Unlocked', locked: state.locked,
        revision: 7, was_locked: !state.locked, note: body.note ?? '', actor_user_id: uid,
        decided_at: '2026-10-05T11:00:00Z',
        meaning: state.locked ? 'This object is protected from incidental change. Approval is unaffected.'
          : 'This object is unlocked. The unlock and its reason are on record.' }) });
    }
    if (path.includes('/access/') && method === 'GET') {
      if (state.locked) {
        return route.fulfill({ json: envelope(accessState({ locked: true, locked_at: '2026-10-05T09:30:00Z',
          locked_by: uid, lock_reason: 'The pickups are scheduled.',
          lock_line: 'Locked. The lock protects this decision from incidental change; approval is separate.' })) });
      }
      if (state.approved) {
        return route.fulfill({ json: envelope(accessState({ approval: 'approved', approval_label: 'Approved',
          approved_revision: 6, changed_since_approval: false,
          changed_line: 'This is the revision the creator approved.' })) });
      }
      return route.fulfill({ json: envelope(accessState()) });
    }
    return route.fulfill({ json: envelope(null) });
  });
}

test('approval names a revision, a change is reported, and readiness is a category with real blockers (9E)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  const state = { locked: false, approved: false };
  await readinessApi(page, writes, state);

  await page.goto(`/studio/${productionId}?tool=Readiness`);

  // 1. Readiness is a category with dimensions and counts - never a score or a percentage.
  const summary = page.getByLabel('Readiness summary');
  await expect(summary.getByText('Blocked').first()).toBeVisible();
  await expect(summary.getByText('1 blocker must be resolved before this Production can move forward.')).toBeVisible();
  await expect(summary.getByText('1 blocking · 1 needing review · 0 warnings')).toBeVisible();
  await expect(summary.getByText('Continuity').first()).toBeVisible();
  await expect(page.getByText(LIMITATION)).toBeVisible();
  const text = (await page.locator('body').innerText());
  expect(text).not.toContain('%');
  expect(text).toMatch(/not a score or a percentage/);

  // 2. Every blocker names the problem, why it matters, the next action and the object to open.
  const blockers = page.getByLabel('Readiness blockers');
  await expect(blockers.getByText('Marcus wears a red jacket then a blue one.')).toBeVisible();
  await expect(blockers.getByText('Next: Resolve or explicitly accept the continuity finding.')).toBeVisible();
  await expect(blockers.getByText('Needs review').first()).toBeVisible();
  await blockers.getByRole('button', { name: 'Open Scene 2 Kitchen' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('scene')).toBe(sceneTwo);

  // 3. Approval is shown with the revision it named, who decided and when, and a later change is
  //    reported as changed after approval instead of silently still approved.
  await page.getByLabel('Object to review').selectOption(sceneTwo);
  const approval = page.getByLabel('Current approval and lock');
  await expect(approval.getByText('Changed after approval')).toBeVisible();
  await expect(approval.getByText('4', { exact: true })).toBeVisible();
  await expect(page.getByText(CHANGED_LINE)).toBeVisible();
  await expect(page.getByText('Locked because: The pickups are scheduled.')).toHaveCount(0);

  // 4. Approving posts the decision with the revision the creator is looking at.
  await page.getByLabel('Decision reason').fill('Ship the beat.');
  await page.getByRole('button', { name: 'Approve revision 5' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/decide'))).toBe(true);
  const decideWrite = writes.find(write => write.path.endsWith('/decide'));
  expect(decideWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/access/${sceneTwo}/decide`);
  expect(decideWrite?.body).toEqual({ decision: 'approve', expected_revision: 5, note: 'Ship the beat.' });
  await expect(page.getByText('This is the revision the creator approved.')).toBeVisible();

  // 5. The surface only offers the three decisions the API accepts.
  const requestReview = page.getByRole('button', { name: 'Request review' });
  const reopen = page.getByRole('button', { name: 'Reopen' });
  await expect(requestReview).toBeVisible();
  await expect(reopen).toBeVisible();
  await requestReview.click();
  await expect.poll(() => writes.filter(write => write.path.endsWith('/decide')).length).toBe(2);
  expect(['approve', 'request_review', 'reopen']).toContain(String(writes[1].body.decision));

  // 6. Locking protects the decision and does not touch approval.
  await page.getByRole('button', { name: /^Lock$/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/lock'))).toBe(true);
  const lockWrite = writes.find(write => write.path.endsWith('/lock'));
  expect(lockWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/access/${sceneTwo}/lock`);
  expect(lockWrite?.body).toMatchObject({ locked: true });
  await expect(page.getByText(/protected from incidental change/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Unlock/ })).toBeDisabled();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

  // 7. Unlocking is explicit: the reason is required before the button enables, and it is recorded.
  await page.getByLabel('Decision reason').fill('Unlocked for the reshoot.');
  const unlock = page.getByRole('button', { name: /Unlock/ });
  await expect(unlock).toBeEnabled();
  await unlock.click();
  await expect.poll(() => writes.filter(write => write.path.endsWith('/lock')).length).toBe(2);
  const lockWrites = writes.filter(write => write.path.endsWith('/lock'));
  expect(lockWrites[0].body).toMatchObject({ locked: true });
  expect(lockWrites[1].body).toEqual({ locked: false, expected_revision: 5, note: 'Unlocked for the reshoot.' });
  await expect(page.getByText(/The unlock and its reason are on record/)).toBeVisible();

  // 8. Nothing on this surface is a generation result: it never claims a model approved anything.
  await expect(page.getByRole('button', { name: /^Generate/ })).toHaveCount(0);

  // 9. A narrow viewport keeps the surface usable and never overflows horizontally.
  // The drawer is ephemeral by design, so reopening after reload goes through the same link.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.goto(`/studio/${productionId}?tool=Readiness`);
  await expect(page.getByText('1 blocker must be resolved before this Production can move forward.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  expect(errors).toEqual([]);
});
