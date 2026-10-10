import { expect, test, type Page } from '@playwright/test';

// §169-§173 production intelligence end-to-end: a change to a reusable Asset is traced through
// the real dependency graph, previewed, and then applied with ONE explicit creator decision.
// The API is stubbed at the network boundary, so the browser provably never decides anything
// itself: it shows what the guarded RPCs returned, it cannot apply an impact without a
// confirmed propagation choice, and it can never turn a potential dependency into a change.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const character = '00000000-0000-4000-8000-000000000801';
const sceneEighteen = '00000000-0000-4000-8000-000000000301';
const shotTwelve = '00000000-0000-4000-8000-000000000401';
const shotFourteen = '00000000-0000-4000-8000-000000000403';
const plan = '00000000-0000-4000-8000-000000000901';
const analysis = '00000000-0000-4000-8000-000000000b01';
const marker = '00000000-0000-4000-8000-000000000c01';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-intel', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
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
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 9A production intelligence.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'short_film', execution_method: 'real', planned_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 600000, assigned_ms: 600000, dialogue_ms: 0, action_ms: 0, slack_ms: 0, status: 'fits' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

const modes = {
  modes: [
    { mode: 'update_all', label: 'UPDATE ALL', description: 'Mark every affected derived artifact.' },
    { mode: 'review_changes', label: 'REVIEW CHANGES', description: 'Mark only the dependents you selected.' },
    { mode: 'change_only_this', label: 'CHANGE ONLY THIS', description: 'Keep the change local.' },
  ],
  rule: 'Impact is computed, never applied by computing it. Applying requires the previewed analysis and an explicit confirmation.',
  direction: 'An edge means one thing only: the source is relied upon, the target depends on it.',
};

const graph = {
  root_object_id: character, root_kind: 'asset', root_label: 'Marcus', direction: 'forward',
  direction_label: 'What this affects', depth: 2,
  nodes: [
    { object_id: shotTwelve, level: 'shot', label: 'Shot 12', depth: 1, relation: 'asset', classification: 'direct', classification_label: 'Direct', level_label: 'Shot', relation_label: 'Asset binding', status: 'Open', locked: false, approved: false, revision: 4 },
    { object_id: plan, level: 'execution_plan', label: 'AI plan for Shot 12', depth: 2, relation: 'execution', classification: 'downstream', classification_label: 'Downstream', level_label: 'Execution plan', relation_label: 'Execution', status: 'Open', locked: false, approved: false, revision: 3 },
    { object_id: shotFourteen, level: 'shot', label: 'Shot 14', depth: 1, relation: 'creative', classification: 'potential', classification_label: 'Potential', level_label: 'Shot', relation_label: 'Creative', status: 'Locked', locked: true, approved: false, revision: 2 },
  ],
  edges: [],
  total: 3, total_label: '3 reachable object(s)', truncated: false, cycles_safe: true,
  note: 'Traversal is bounded and cycle-safe. Edges only ever mean: the source is relied upon, the target depends on it.',
};

const edgeList = {
  object_id: character, limit: 100, offset: 0,
  items: [{ source_object_id: character, target_object_id: shotTwelve, relation: 'asset', strength: 'hard', origin: 'derived', reason: 'This character binding references the source directly.', affected_fields: ['character'], active: true, revision: 1, note: '', evidence: {}, updated_at: '2026-10-05T10:00:00Z', source_label: 'Marcus', target_label: 'Shot 12', relation_label: 'Asset binding', strength_label: 'Hard', origin_label: 'Derived from your Production', state_label: 'Active' }],
  note: 'Edges are deactivated, never deleted: the history of a relationship stays readable.',
};

const markers = {
  items: [{ artifact_id: marker, artifact_kind: 'dependent_object', artifact_ref: null, object_id: plan, object_label: 'AI plan for Shot 12', object_kind: 'execution_plan', state: 'stale', reason: 'The source Marcus changed after this artifact was derived.', caused_by_object_id: character, caused_by_label: 'Marcus', caused_by_revision: 4, source_revision: 3, current_revision: 4, resolved_at: null, created_at: '2026-10-05T10:00:00Z', artifact_kind_label: 'Dependent object', state_label: 'Stale' }],
  total: 1, open: 1, limit: 100, offset: 0,
  note: 'Stale means the artifact may no longer match its source. Nothing was deleted.',
  open_label: '1 artifact(s) may no longer match their source.',
};

const preview = {
  analysis_id: analysis, root_object_id: character, root_kind: 'asset', root_label: 'Marcus',
  root_revision: 4, structure_revision: 41, depth: 2, nodes: graph.nodes,
  counts: { direct: 1, downstream: 1, potential: 1, locked: 1, approved: 0, by_level: { shot: 2, execution_plan: 1 }, total: 3 },
  locked_ids: [shotFourteen], approved_ids: [],
  explanation: 'Marcus affects 1 direct object and 1 downstream object.',
  applied: false, requires_confirmation: true,
  summary_line: 'Marcus affects 1 direct object, 1 downstream object, 1 potential dependency.',
  modes: modes.modes, total_label: '3 affected object(s)',
  rule: 'Impact is computed, never applied. Nothing in this Production changed yet.',
};

const applied = {
  analysis_id: analysis, mode: 'update_all', mode_label: 'UPDATE ALL', applied: true, marked: 2,
  direct_count: 1, downstream_count: 1, unresolved_count: 0,
  locked_skipped: [{ object_id: shotFourteen, label: 'Shot 14', reason: 'The dependent object is locked. Unlock it before TONDE updates it.', reason_label: 'Protected by a lock' }],
  requiring_review: [{ object_id: sceneEighteen, label: 'Scene 18 script', revision: 3, reason: 'Approved content is never rewritten silently.', reason_label: 'Needs creator review' }],
  note: 'Affected derived artifacts were marked. Approved content and locked objects were reported, not rewritten.',
  summary_line: '2 artifact(s) marked for UPDATE ALL. 1 locked dependent(s) were reported instead of changed.',
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

/** Stub the Production-intelligence API at the network boundary and record every write. */
async function intelligenceApi(page: Page, writes: Write[], state: { resolved: boolean }) {
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });
    if (path.endsWith('/intelligence/modes')) return route.fulfill({ json: envelope(modes) });
    if (path.endsWith('/intelligence/graph')) return route.fulfill({ json: envelope(graph) });
    if (path.endsWith('/intelligence/dependencies') && request.method() === 'GET') return route.fulfill({ json: envelope(edgeList) });
    if (path.endsWith('/intelligence/dependencies/sync')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ production_id: productionId, edges_considered: 7, note: 'Derived edges come from real bindings, plans and dialogue. Nothing was inferred here.' }) });
    }
    if (path.endsWith('/intelligence/dependencies/active')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ changed: 2, active: body.active, note: 'Edges are deactivated, never deleted: the history of a relationship stays readable.' }) });
    }
    if (path.endsWith('/intelligence/impact/preview')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope(preview) });
    }
    if (path.endsWith('/intelligence/impact/apply')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope(applied) });
    }
    if (path.endsWith('/intelligence/impact/history')) {
      return route.fulfill({ json: envelope({ items: [], total: 0, limit: 20, offset: 0, truncated: false, note: 'An impact analysis is a snapshot. Regenerating never overwrites this record.' }) });
    }
    if (path.endsWith('/intelligence/stale') && request.method() === 'GET') {
      return route.fulfill({ json: envelope(state.resolved
        ? { ...markers, items: [{ ...markers.items[0], state: 'current', state_label: 'Current', resolved_at: '2026-10-05T11:00:00Z' }] }
        : markers) });
    }
    if (path.endsWith('/intelligence/stale') && request.method() === 'POST') {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ artifact_id: marker, state: 'stale', note: 'The artifact was marked, not rewritten, and the marker stays readable as history.' }) });
    }
    if (path.endsWith('/resolve')) {
      writes.push({ path, body }); state.resolved = true;
      return route.fulfill({ json: envelope({ artifact_id: marker, state: 'current', note: 'The creator resolved this artifact. Historical markers stay readable.' }) });
    }
    return route.fulfill({ json: envelope(null) });
  });
}

test('an Asset change is traced, previewed and applied with one explicit decision (§169-§173)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  const state = { resolved: false };
  await intelligenceApi(page, writes, state);

  await page.goto(`/studio/${productionId}?tool=Impact`);

  // 1. The screen states the invariant: impact is computed, never applied by computing it.
  await expect(page.getByRole('heading', { name: 'What does this change affect?' })).toBeVisible();
  await expect(page.getByText(/Impact is computed, never applied by computing it/).first()).toBeVisible();
  await expect(page.getByText(/An edge means one thing only/)).toBeVisible();

  // 2. An inferred dependency is shown as a POTENTIAL proposal, and a locked dependent is
  //    reported as Locked rather than presented as ordinary work.
  await expect(page.getByText('Direct', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Potential', { exact: true })).toBeVisible();
  await expect(page.getByText(/3 reachable object\(s\)/)).toBeVisible();

  // 3. Derived dependencies are re-computed from real Production state, and the response says so.
  await page.getByRole('button', { name: /Sync derived dependencies/ }).click();
  await expect(page.getByText(/7 dependency edge\(s\) re-derived/)).toBeVisible();
  // The workspace and Production come from the authorised URL, never from the request body.
  expect(writes.find(write => write.path.endsWith('/dependencies/sync'))?.path)
    .toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/intelligence/dependencies/sync`);

  // 4. Previewing a change to the reusable Character Asset changes nothing and cannot be applied
  //    until a real propagation choice exists.
  await page.getByLabel('Source object').selectOption(character);
  await page.getByRole('button', { name: /Preview impact/ }).click();
  await expect(page.getByText(/Marcus affects 1 direct object, 1 downstream object/).first()).toBeVisible();
  await expect(page.getByLabel('Affected objects')).toContainText('Locked');
  const applyButton = page.getByRole('button', { name: /^Apply/ });
  await expect(applyButton).toBeDisabled();
  await expect(page.getByText(/Choose a propagation choice first/)).toBeVisible();
  expect(writes.filter(write => write.path.endsWith('/impact/apply'))).toHaveLength(0);

  // 5. REVIEW CHANGES needs the creator to pick what changes; a potential proposal is not offered.
  await page.getByRole('radio', { name: /REVIEW CHANGES/ }).check();
  await expect(applyButton).toBeDisabled();
  await expect(page.getByText(/Select at least one dependent to change/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Shot 14/ })).toHaveCount(0);
  await expect(page.getByText(/A potential dependency is a proposal, so it is never applied/)).toBeVisible();

  // 6. UPDATE ALL is applied against the pinned revision and reports what it protected.
  await page.getByRole('radio', { name: /UPDATE ALL/ }).check();
  await page.getByRole('button', { name: /Apply UPDATE ALL/ }).click();
  await expect(page.getByText(/REPORTED, NOT CHANGED/)).toBeVisible();
  await expect(page.getByText(/Shot 14 — The dependent object is locked/)).toBeVisible();
  await expect(page.getByText(/Scene 18 script — Approved content is never rewritten silently/)).toBeVisible();
  expect(writes.find(write => write.path.endsWith('/impact/apply'))?.body).toMatchObject({
    analysis_id: analysis, mode: 'update_all', expected_root_revision: 4, selected_ids: [], confirm: true,
  });

  // 7. A relationship is deactivated, not deleted.
  await page.getByRole('button', { name: /Deactivate/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/dependencies/active'))).toBe(true);
  expect(writes.find(write => write.path.endsWith('/dependencies/active'))?.body).toMatchObject({
    edge_ids: [character, shotTwelve], active: false, note: 'Deactivated from Studio.',
  });

  // 8. A stale artifact names its cause and is resolved by the creator, never resurrected automatically.
  await expect(page.getByText(/Caused by Marcus/)).toBeVisible();
  await page.getByRole('button', { name: /Mark resolved/ }).click();
  await expect.poll(() => state.resolved).toBe(true);
  expect(writes.find(write => write.path.endsWith('/resolve'))?.body).toMatchObject({ note: '' });

  // 9. Marking something stale needs a real reason and never rewrites the artifact.
  await expect(page.getByRole('button', { name: /^Mark stale$/ })).toBeDisabled();
  await page.getByLabel('Stale reason').fill('Marcus is injured from Scene 4.');
  await page.getByRole('button', { name: /^Mark stale$/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/intelligence/stale') && write.body.artifact_kind === 'dependent_object')).toBe(true);
  expect(writes.find(write => write.path.endsWith('/intelligence/stale'))?.body).toMatchObject({
    object_id: character, artifact_kind: 'dependent_object', reason: 'Marcus is injured from Scene 4.',
  });

  // 9b. A narrow viewport keeps the whole surface usable and never overflows horizontally.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'What does this change affect?' })).toBeVisible();
  await page.getByLabel('Source object').selectOption(character);
  await page.getByRole('button', { name: /Preview impact/ }).click();
  await expect(page.getByRole('radio', { name: /CHANGE ONLY THIS/ })).toBeVisible();
  await page.getByRole('radio', { name: /CHANGE ONLY THIS/ }).check();
  await expect(page.getByRole('button', { name: /Apply CHANGE ONLY THIS/ })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // 10. Reload keeps the tool and re-reads canonical state instead of remembering it.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'What does this change affect?' })).toBeVisible();
  await expect(page.getByText(/Impact is computed, never applied by computing it/).first()).toBeVisible();

  expect(errors).toEqual([]);
});
