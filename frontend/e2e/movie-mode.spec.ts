import { expect, test, type Page } from '@playwright/test';

// §156 full movie end-to-end: a 3-Act film is planned and navigated in Movie Mode, one
// bounded level at a time, with real runtime rollups. The Studio API and the Supabase
// transport are stubbed at the network boundary, so this proves the browser never invents
// structure: every level, rollup and approval it shows came from a read or a guarded write.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const actOne = '00000000-0000-4000-8000-000000000101';
const actTwo = '00000000-0000-4000-8000-000000000102';
const actThree = '00000000-0000-4000-8000-000000000103';
const sequenceFour = '00000000-0000-4000-8000-000000000201';
const sceneEighteen = '00000000-0000-4000-8000-000000000301';
const shotThree = '00000000-0000-4000-8000-000000000401';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-movie', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };

const production = { id: productionId, workspace_id: workspace, project_id: projectId, title: 'Ninety minute film', production_type: 'long_form_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 5400000, calculated_duration_ms: 5500000, start_ms: 0, end_ms: null, created_by: uid, revision: 7, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };

const studioModel = {
  production: { id: productionId, workspace_id: workspace, title: production.title, production_type: 'long_form_film', custom_type: null, execution_method: 'real', planned_duration_ms: 5400000, calculated_duration_ms: 5500000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
  scenes: [{
    id: sceneEighteen, order: 18, sort_order: 18432, title: 'Scene 18', purpose: 'Confrontation', story_beat: 'Break',
    description: 'Marcus decides to stay.', action_lines: [], opening_state: 'Packed bag', ending_state: 'Bag unpacked',
    visual_intent: 'One soft source', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 60000,
    duration_ms: 60000, timing: 'derived', approval: 'draft', locked_at: null, revision: 5, updated_at: '2026-10-05T00:00:00Z',
    character_asset_ids: [], dialogue_lines: 0, shot_count: 1, bindings: [],
    shots: [{ id: shotThree, scene_id: sceneEighteen, order: 1, sort_order: 1024, title: 'Marcus holds the phone', description: 'Macro.', action: '', purpose: 'product', subject: 'The phone', framing: 'medium close up', angle: 'eye level', movement: 'static', composition: 'lower third', transition: 'cut', story_relationship: 'proves the decision', story_beat: 'Break', creative_notes: '', execution_method: 'real', planned_duration_ms: 8000, approval: 'draft', locked_at: null, revision: 2, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [] }],
  }],
  orphan_shots: [], assets: [], documents: {},
  timing: { total_ms: 5500000, target_ms: 5400000, delta_ms: 100000, status: 'over', scene_states: [{ scene_id: sceneEighteen, order: 18432, duration_ms: 60000, shots: 1, timing: 'derived' }] },
  runtime_conflict: true,
  timeline: [{ scene_id: sceneEighteen, order: 18, title: 'Scene 18', duration_ms: 60000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotThree, order: 1, title: 'Marcus holds the phone', duration_ms: 8000, execution_method: 'real', approval: 'draft', locked: false }] }],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 1, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 2 }, needs_attention: 0 },
  truncated: false, provider,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 8 long-form.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'long_form_film', execution_method: 'real', planned_duration_ms: 5400000, approval: 'draft', locked_at: null, revision: 7 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 5400000, assigned_ms: 5500000, dialogue_ms: 0, action_ms: 0, slack_ms: -100000, status: 'over' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

const timing = { production: { target_ms: 5400000, calculated_ms: 5500000, delta_ms: 100000, status: 'over', target_label: '1:30:00', calculated_label: '1:31:40', delta_label: '1:40' }, counts: { acts: 3, sequences: 4, scenes: 9, shots: 22 }, rule: 'A planned target is never overwritten by a calculated child total.' };

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

test('Movie Mode plans and navigates a 3-Act film lazily with real rollups (§156)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const structureRequests: Array<Record<string, unknown>> = [];
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let acts = [
    { id: actOne, title: 'Act 1 - Ordinary world', approval: 'draft', locked: false, revision: 3, target: 1740000, calculated: 1740000 },
    { id: actTwo, title: 'Act 2 - The break', approval: 'draft', locked: false, revision: 3, target: 1860000, calculated: 1900000 },
  ];
  const structurePage = (level: string, scopeId: string | null) => {
    if (level === 'act' && scopeId === actTwo) return {
      production_id: productionId, production_revision: 7, structure_revision: 41, level: 'act',
      scope: { level: 'act', id: actTwo, title: 'Act 2 - The break', display: 'Act', depth: 'scenes_planned' },
      breadcrumb: [{ level: 'production', id: productionId, title: production.title }, { level: 'act', id: actTwo, title: 'Act 2 - The break' }],
      breadcrumb_line: 'Ninety minute film -> Act 2 - The break',
      items: [
        { id: sequenceFour, level: 'sequence', title: 'Sequence 4 - Return', kind: 'narrative', display: 'Sequence 1', display_index: 1, order: 1024, purpose: 'The return', planned_duration_ms: 240000, calculated_duration_ms: 240000, label: '4:00', delta_ms: 0, status: 'fits', depth: 'scenes_planned', depth_label: 'Scenes Planned', approval: 'approved', locked: true, revision: 4, summary: null, documents: [], child_counts: { scenes: 2 } },
        { id: sceneEighteen, level: 'scene', title: 'Scene 18', display: 'Scene 18', display_index: 18, order: 2048, purpose: 'Confrontation', planned_duration_ms: 60000, calculated_duration_ms: 60000, label: '1:00', delta_ms: 0, status: 'fits', depth: 'shots_planned', depth_label: 'Shots Planned', approval: 'draft', locked: false, revision: 5, summary: { text: 'Marcus decides to stay.', stale: true, source_revision: 4, revision: 2, stale_label: 'STALE — the object changed since this summary was derived' }, documents: [], child_counts: { shots: 4 } },
      ],
      total: 2, limit: 50, offset: 0, truncated: false,
      lazy: 'One level at a time: a large Production is paged, never expanded eagerly.', timing,
    };
    return {
      production_id: productionId, production_revision: 7, structure_revision: 41, level: 'production',
      scope: { level: 'production', id: productionId, title: production.title, depth: 'scenes_planned', depth_label: 'Scenes Planned', orphan_sequences: 0, orphan_scenes: 0, summary: { text: 'A film about leaving.', stale: false, source_revision: 7, revision: 1, stale_label: 'CURRENT' } },
      breadcrumb: [{ level: 'production', id: productionId, title: production.title }],
      breadcrumb_line: production.title,
      items: acts.map((act, index) => ({ id: act.id, level: 'act', title: act.title, display: `Act ${index + 1}`, display_index: index + 1, order: (index + 1) * 1024, purpose: 'Raise the stakes', planned_duration_ms: act.target, calculated_duration_ms: act.calculated, label: '29:00', delta_ms: act.calculated - act.target, status: act.calculated === act.target ? 'fits' : 'over', depth: 'scenes_planned', depth_label: 'Scenes Planned', approval: act.approval, locked: act.locked, revision: act.revision, summary: null, documents: [], child_counts: { sequences: 2 } })),
      total: acts.length, limit: 50, offset: 0, truncated: false,
      lazy: 'One level at a time: a large Production is paged, never expanded eagerly.', timing,
    };
  };
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });
    if (path.endsWith('/long-form/structure')) {
      const level = String(new URL(request.url()).searchParams.get('level') ?? 'production');
      const scopeId = new URL(request.url()).searchParams.get('scope_id');
      structureRequests.push({ level, scopeId });
      return route.fulfill({ json: envelope(structurePage(level, scopeId)) });
    }
    if (path.endsWith('/long-form/summaries')) return route.fulfill({ json: envelope({ items: [], total: 0, truncated: false }) });
    if (path.endsWith('/long-form/search')) return route.fulfill({ json: envelope({ query: 'phone', total: 1, items: [{ level: 'shot', id: shotThree, title: 'Marcus holds the phone', snippet: 'weapon lower third', match_field: 'shot', scene_id: sceneEighteen, shot_id: shotThree, approval: 'draft', locked: false, depth: 'shots_planned', takes: 1, results: 0, attempts: 0, execution_method: 'real' }], limit: 40, offset: 0, truncated: false, filters: {}, note: 'Structured relational matches.' }) });
    if (path.endsWith('/long-form/director/scope')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ resolution: { level: 'act', identifier: actTwo, operation: 'shorten_scope', ambiguous: false, scope_is_explicit: true, note: 'Act 2 was named.' }, direction: { kind: 'shorten_scope' }, structure_revision: 41, breadcrumb_line: 'Ninety minute film -> Act 2 - The break', context: { scope: { level: 'act', id: actTwo, title: 'Act 2 - The break' }, path: [], siblings: [], timing, depth: 'scenes_planned', truncated: false }, rule: 'Scope is explicit. A command that names no scope is reported as ambiguous instead of being widened to the whole Production, and no other Act is rewritten.' }) });
    }
    if (path.endsWith('/long-form/acts') && request.method() === 'POST') {
      writes.push({ path, body });
      acts = [...acts, { id: actThree, title: String(body.title), approval: 'draft', locked: false, revision: 1, target: 1800000, calculated: 1800000 }];
      return route.fulfill({ json: envelope({ act_id: actThree, revision: 1, structure_revision: 42 }) });
    }
    if (path.endsWith('/long-form/approval')) {
      writes.push({ path, body });
      acts = acts.map(act => act.id === body.id ? { ...act, approval: String(body.approval), revision: act.revision + 1 } : act);
      return route.fulfill({ json: envelope({ level: 'act', id: body.id, approval: body.approval, revision: 4 }) });
    }
    if (path.endsWith('/long-form/lock')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ level: body.level, id: body.id, locked: body.locked, revision: 5 }) });
    }
    if (path.endsWith('/long-form/reorder')) { writes.push({ path, body }); return route.fulfill({ json: envelope({ structure_revision: 42, timing }) }); }
    return route.fulfill({ json: envelope(null) });
  });

  await page.goto(`/studio/${productionId}?tool=Movie Mode`);

  // 1. The Production level is read lazily, with the planned target, the calculated child total
  //    and the real difference between them.
  await expect(page.getByRole('heading', { name: 'Long-form structure' })).toBeVisible();
  await expect(page.getByLabel('Runtime rollup')).toContainText('1:30:00');
  await expect(page.getByLabel('Runtime rollup')).toContainText('1:31:40');
  await expect(page.getByLabel('Runtime rollup')).toContainText('over by 1:40');
  await expect(page.getByText(/One level at a time/).first()).toBeVisible();
  expect(structureRequests[0]).toMatchObject({ level: 'production', scopeId: null });

  // 2. Drilling into Act 2 loads exactly that Act: its Sequences and orphan Scenes, plus the
  //    breadcrumb back to the Production.
  await page.getByRole('button', { name: /Act 2 - The break/ }).first().click();
  await expect(page.getByLabel('Structure breadcrumb')).toContainText('Act 2 - The break');
  await expect(page.locator('strong', { hasText: 'Sequence 4 - Return' })).toBeVisible();
  await expect(page.getByText(/STALE — the object changed since this summary was derived/)).toBeVisible();
  await expect.poll(() => structureRequests.some(request => request.level === 'act' && request.scopeId === actTwo)).toBe(true);

  // 3. A locked Sequence can only be changed by an explicit unlock, against its revision.
  await page.getByRole('button', { name: /Unlock/ }).first().click();
  await expect(page.getByText(/is unlocked\./)).toBeVisible();

  // 4. Semantic zoom returns to the Acts without inventing a flattened view.
  await page.getByRole('group', { name: 'Semantic timeline zoom' }).getByRole('button', { name: 'Act', exact: true }).click();
  await expect.poll(() => structureRequests.filter(request => request.level === 'production').length).toBeGreaterThan(1);

  // 5. Adding an Act writes against the Production revision and persists across a reload.
  await page.getByLabel('Act title').fill('Act 3 - Coda');
  await page.getByLabel('Narrative goal').fill('Acceptance');
  await page.getByRole('button', { name: /Add Act/ }).click();
  await expect(page.getByText('Act 3 - Coda', { exact: true })).toBeVisible();
  expect(writes.find(write => write.path.endsWith('/long-form/acts'))?.body).toMatchObject({ title: 'Act 3 - Coda', narrative_goal: 'Acceptance' });

  // 6. Approval is creator-only, explicit and reported.
  await page.getByRole('button', { name: /^Approve$/ }).first().click();
  await expect(page.getByText(/is now Approved\./)).toBeVisible();
  expect(writes.find(write => write.path.endsWith('/long-form/approval'))?.body).toMatchObject({ level: 'act', approval: 'approved' });

  // 7. Structured search returns real objects and shares the Shot selection with the Studio.
  await page.getByRole('textbox', { name: 'Search' }).fill('phone');
  await page.getByRole('combobox', { name: 'Execution' }).selectOption('real');
  await page.getByRole('button', { name: /^Search$/ }).click();
  await page.getByRole('button', { name: 'shot Marcus holds the phone' }).click();
  // The search result shares the Shot selection with the Studio: the URL carries
  // the Shot and TONDE's focus follows it (there is no separate summary region).
  await expect.poll(() => page.url()).toContain(`shot=${shotThree}`);
  await expect(page.getByText(/FOCUS · SHOT/)).toBeVisible();

  // 8. A Director command resolves to one explicit scope and changes nothing by itself.
  const writesBefore = writes.length;
  await page.getByRole('textbox', { name: 'Direction' }).fill('Make Act 2 shorter.');
  await page.getByRole('button', { name: /Resolve scope/ }).click();
  await expect(page.getByText('Ninety minute film -> Act 2 - The break')).toBeVisible();
  await expect(page.getByText(/no other Act is rewritten/)).toBeVisible();
  expect(writes.length).toBe(writesBefore + 1);

  // 9. Reopening re-reads canonical state rather than remembering it (the drawer
  // is ephemeral by design, so the check reopens it through the same link).
  await page.reload();
  await page.goto(`/studio/${productionId}?tool=Movie Mode`);
  await expect(page.getByRole('heading', { name: 'Long-form structure' })).toBeVisible();
  await expect(page.getByText('Act 3 - Coda', { exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});
