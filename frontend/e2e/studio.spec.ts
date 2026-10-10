import { expect, test, type Page } from '@playwright/test';

// Prompt 5 Studio end-to-end flow. The Supabase transport and the TONDE Studio API
// are both stubbed at the network boundary: this proves the browser keeps ONE Master
// Production, writes canonical Scenes/Shots against revisions, and never invents state.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneA = '00000000-0000-4000-8000-000000000010';
const sceneB = '00000000-0000-4000-8000-000000000011';
const shotA = '00000000-0000-4000-8000-000000000014';
const shotB = '00000000-0000-4000-8000-000000000015';

const initialProduction = { id: productionId, workspace_id: workspace, project_id: uid, title: 'Browser test production', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 30000, calculated_duration_ms: null, start_ms: 0, end_ms: null, created_by: uid, revision: 2, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-studio', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };
const directorSurface = { production: { id: productionId, title: initialProduction.title, production_type: 'short_film', execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 2 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 30000, assigned_ms: 0, dialogue_ms: 0, action_ms: 0, slack_ms: 30000, status: 'under' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

async function platform(page: Page) {
  await page.route('https://tonde-test.supabase.co/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith('/rpc/bootstrap_workspace')) return route.fulfill({ json: workspace });
    if (path.endsWith('/rpc/create_project_with_production')) return route.fulfill({ json: productionId });
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: uid, email: 'creator@example.com' } });
    if (path === '/rest/v1/scenes') return route.fulfill({ json: [] });
    if (path === '/rest/v1/creative_documents') return route.fulfill({ json: [] });
    if (path === '/rest/v1/production_references') return route.fulfill({ json: [] });
    if (path === '/rest/v1/productions') {
      if (request.method() === 'PATCH') return route.fulfill({ json: { ...initialProduction, ...request.postDataJSON(), revision: 3 } });
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      return route.fulfill({ json: single ? initialProduction : [initialProduction] });
    }
    return route.fulfill({ status: 400, json: { message: `Unexpected fixture endpoint: ${path}` } });
  });
  await page.addInitScript(({ uid }) => {
    const payload = btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-05T00:00:00Z' } }));
  }, { uid });
}

type Shot = { id: string; scene_id: string; title: string; duration: number | null; approval: string; locked: boolean; revision: number };
type Scene = { id: string; title: string; approval: string; locked: boolean; revision: number };

test('Studio edits canonical Scenes and Shots, keeps one Master Production and survives reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  let scenes: Scene[] = [
    { id: sceneA, title: 'Dark kitchen', approval: 'draft', locked: false, revision: 1 },
    { id: sceneB, title: 'Weighing', approval: 'draft', locked: false, revision: 1 },
  ];
  let shots: Shot[] = [
    { id: shotA, scene_id: sceneA, title: 'Establish', duration: 12000, approval: 'draft', locked: false, revision: 1 },
    { id: shotB, scene_id: sceneB, title: 'Scale macro', duration: 18000, approval: 'draft', locked: false, revision: 1 },
  ];
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let productionWrites = 0;
  const shotsOf = (sceneId: string) => shots.filter(shot => shot.scene_id === sceneId);
  const sceneTiming = (sceneId: string) => {
    const own = shotsOf(sceneId);
    const total = own.reduce((sum, shot) => sum + (shot.duration ?? 0), 0);
    if (!own.length) return { duration: 0, timing: 'planned' };
    if (own.some(shot => shot.duration === null)) return { duration: total, timing: 'incomplete' };
    return { duration: total, timing: 'derived' };
  };
  const timing = () => {
    const states = scenes.map((scene, index) => ({ scene_id: scene.id, order: (index + 1) * 1024, ...sceneTiming(scene.id), shots: shotsOf(scene.id).length }));
    const total = states.reduce((sum, state) => sum + state.duration, 0); const target = 30000;
    return { total_ms: total, target_ms: target, delta_ms: total - target, status: total === target ? 'fits' : total > target ? 'over' : 'under', scene_states: states };
  };
  const readModel = () => ({
    production: { id: productionId, workspace_id: workspace, title: initialProduction.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 30000, calculated_duration_ms: timing().total_ms, approval: 'draft', locked_at: null, revision: 2, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
    scenes: scenes.map((scene, index) => {
      const state = sceneTiming(scene.id);
      return {
        id: scene.id, order: index + 1, sort_order: (index + 1) * 1024, title: scene.title, purpose: 'Earn attention', story_beat: 'Hook', description: 'A dark kitchen.',
        action_lines: [], opening_state: '', ending_state: '', visual_intent: '', dialogue_notes: '', environment_asset_id: null,
        planned_duration_ms: state.duration, duration_ms: state.duration, timing: state.timing, approval: scene.approval,
        locked_at: scene.locked ? '2026-10-05T00:00:00Z' : null, revision: scene.revision, updated_at: '2026-10-05T00:00:00Z',
        character_asset_ids: [], dialogue_lines: 0, shot_count: shotsOf(scene.id).length, bindings: [],
        shots: shotsOf(scene.id).map((shot, order) => ({
          id: shot.id, scene_id: shot.scene_id, order: order + 1, sort_order: (order + 1) * 1024, title: shot.title, description: '', action: '',
          purpose: 'establish', subject: 'Scale', framing: 'wide', angle: 'eye level', movement: 'slow push', composition: 'centred',
          transition: 'cut', story_relationship: 'proves the promise', story_beat: 'Hook', creative_notes: '', execution_method: 'real',
          planned_duration_ms: shot.duration, approval: shot.approval, locked_at: shot.locked ? '2026-10-05T00:00:00Z' : null,
          revision: shot.revision, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [],
        })),
      };
    }),
    orphan_shots: [], assets: [], documents: {}, timing: timing(), runtime_conflict: timing().status !== 'fits',
    timeline: scenes.map((scene, index) => {
      const state = sceneTiming(scene.id);
      return {
        scene_id: scene.id, order: index + 1, title: scene.title, duration_ms: state.duration, timing: state.timing,
        approval: scene.approval, locked: scene.locked, execution_methods: ['real'],
        shots: shotsOf(scene.id).map((shot, order) => ({ shot_id: shot.id, order: order + 1, title: shot.title, duration_ms: shot.duration, execution_method: 'real', approval: shot.approval, locked: shot.locked })),
      };
    }),
    status_summary: { production_approval: 'draft', production_locked: false, scenes: scenes.length, shots: shots.length, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: scenes.length + shots.length }, needs_attention: 0 },
    truncated: false, provider,
    capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: false, ai_prompt_compilation: false, note: 'Real execution planning arrives with Prompt 6.' },
  });

  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/director/provider')) return route.fulfill({ json: envelope(provider) });
    if (path.endsWith('/studio/timing')) return route.fulfill({ json: envelope(timing()) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(readModel()) });
    if (path.endsWith('/studio/scenes')) {
      writes.push({ path, body });
      const created: Scene = { id: '00000000-0000-4000-8000-000000000012', title: String(body.title), approval: 'draft', locked: false, revision: 1 };
      scenes = [...scenes, created];
      return route.fulfill({ json: envelope({ scene_id: created.id, title: created.title, sort_order: scenes.length * 1024, revision: 1, approval: 'draft', timing: timing() }) });
    }
    if (path.endsWith('/shots')) {
      writes.push({ path, body });
      const created: Shot = { id: '00000000-0000-4000-8000-000000000016', scene_id: String(body.scene_id), title: String(body.title), duration: null, approval: 'draft', locked: false, revision: 1 };
      shots = [...shots, created];
      return route.fulfill({ json: envelope({ shot_id: created.id, title: created.title, sort_order: shots.length * 1024, revision: 1, approval: 'draft', execution_method: 'real', timing: timing() }) });
    }
    if (path.endsWith('/scenes/reorder')) {
      writes.push({ path, body });
      const order = body.ordered_ids as string[];
      scenes = order.map(id => scenes.find(scene => scene.id === id)!);
      return route.fulfill({ json: envelope({ scenes: order.length, timing: timing() }) });
    }
    if (/\/studio\/scenes\/[^/]+\/archive$/.test(path)) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ scene_id: path.split('/').slice(-1)[0], archived_shots: 0, timing: timing() }) });
    }
    if (/\/studio\/scenes\/[^/]+$/.test(path) && request.method() === 'PATCH') {
      writes.push({ path, body });
      const scene = scenes.find(item => path.endsWith(item.id));
      if (scene) { if (typeof body.title === 'string') scene.title = body.title; scene.revision += 1; }
      return route.fulfill({ json: envelope({ scene_id: scene?.id, revision: scene?.revision, approval: scene?.approval, timing: timing() }) });
    }
    if (/\/studio\/shots\/[^/]+$/.test(path) && request.method() === 'PATCH') {
      writes.push({ path, body });
      const shot = shots.find(item => path.endsWith(item.id));
      if (shot) {
        if (typeof body.title === 'string') shot.title = body.title;
        if ('duration_ms' in body) shot.duration = body.duration_ms === null ? null : Number(body.duration_ms);
        shot.revision += 1;
        if (shot.approval === 'approved') shot.approval = 'changed_after_approval';
      }
      return route.fulfill({ json: envelope({ shot_id: shot?.id, revision: shot?.revision, approval: shot?.approval, execution_method: 'real', scene_id: shot?.scene_id, timing: timing() }) });
    }
    if (path.endsWith('/approval')) {
      writes.push({ path, body });
      const shot = shots.find(item => item.id === body.id);
      if (shot) shot.approval = String(body.approval);
      return route.fulfill({ json: envelope({ scope: body.scope, id: body.id, approval: body.approval, revision: 2 }) });
    }
    return route.fulfill({ json: envelope(null) });
  });
  page.on('request', request => { if (request.url() === 'https://tonde-test.supabase.co/rest/v1/productions' && request.method() === 'PATCH') productionWrites += 1; });

  await page.goto(`/studio/${productionId}?tool=Scenes`);

  // 1. One Master Production: canonical Scenes and runtime come from the read model.
  await expect(page.getByRole('heading', { name: 'Scenes' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Scene 1: Dark kitchen/ })).toBeVisible();
  await expect(page.getByText('30s total')).toBeVisible();

  // 2. Renaming a Scene persists against its revision.
  await page.getByLabel('Title', { exact: true }).first().fill('Cold open');
  await page.getByRole('button', { name: 'Save Scene' }).click();
  await expect(page.getByText(/Saved\. Runtime fits\./)).toBeVisible();
  expect(writes.find(write => write.path.endsWith(`/studio/scenes/${sceneA}`))?.body).toMatchObject({ title: 'Cold open', expected_revision: 1 });

  // 3. Creating a Shot persists into the selected Scene.
  await page.getByRole('button', { name: 'Shots' }).click();
  await page.getByLabel('New Shot title').fill('Kettle clicks');
  await page.getByRole('button', { name: /Add Shot/ }).click();
  await expect(page.getByLabel('New Shot title')).toHaveValue('');
  expect(writes.find(write => write.path.endsWith('/studio/shots'))?.body).toMatchObject({ scene_id: sceneA, title: 'Kettle clicks' });

  // 4. An undecided duration is reported as incomplete, never guessed.
  await expect(page.getByText(/timing incomplete/).first()).toBeVisible();

  // 5. Timeline selection drives the canvas selection.
  await page.getByRole('button', { name: /Scene 2: Weighing/ }).click();
  await expect(page.getByRole('heading', { name: /Shots in Scene 2: Weighing/ })).toBeVisible();

  // 6. A duration change is a canonical write and the timeline reports the real overage.
  await page.getByRole('button', { name: /Shot 1 of Scene 2: Scale macro/ }).click();
  await page.getByLabel('Duration (ms)').fill('20000');
  await page.getByRole('button', { name: 'Save Shot' }).click();
  await expect(page.getByText(/Runtime over by 2s\./)).toBeVisible();
  await expect(page.getByText(/Over target by 2s/)).toBeVisible();

  // 7. Approved content that changes stops claiming to be approved.
  await page.getByRole('button', { name: 'Approve Shot' }).click();
  await expect(page.getByText(/Shot is Approved\./)).toBeVisible();
  await page.getByLabel('Title', { exact: true }).last().fill('Scale macro v2');
  await page.getByRole('button', { name: 'Save Shot' }).click();
  await expect(page.getByText(/it is now Changed After Approval - review it again\./)).toBeVisible();

  // 8. Switching execution face keeps the same Production, Scenes and Shots.
  await page.getByRole('button', { name: 'AI CREATION', exact: true }).click();
  await expect(page.getByRole('button', { name: /Scene 2: Weighing/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Shots in Scene 2: Weighing/ })).toBeVisible();
  expect(productionWrites).toBe(0);

  // 9. Reload restores tool and selection from the URL and re-reads canonical state.
  await page.reload();
  await expect(page.getByRole('heading', { name: /Shots in Scene 2: Weighing/ })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true }).last()).toHaveValue('Scale macro v2');

  expect(errors).toEqual([]);
});

// §102 mobile review and §103 keyboard alternative to dragging. Drag/drop is not the only
// way to reorder: every timeline Shot exposes a labelled Move earlier/later control.
test('a narrow viewport keeps Scene, Shot and Director usable and reorders with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const shots = [
    { id: shotA, scene_id: sceneA, title: 'Establish', duration: 12000, order: 1 },
    { id: shotB, scene_id: sceneA, title: 'Scale macro', duration: 18000, order: 2 },
  ];
  const ordered = () => [...shots].sort((a, b) => a.order - b.order);
  const readModel = () => ({
    production: { id: productionId, workspace_id: workspace, title: initialProduction.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 30000, calculated_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 2, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
    scenes: [{ id: sceneA, order: 1, sort_order: 1024, title: 'Dark kitchen', purpose: 'Earn attention', story_beat: 'Hook', description: 'A dark kitchen.', action_lines: [], opening_state: '', ending_state: '', visual_intent: '', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 30000, duration_ms: 30000, timing: 'derived', approval: 'draft', locked_at: null, revision: 1, updated_at: '2026-10-05T00:00:00Z', character_asset_ids: [], dialogue_lines: 0, shot_count: 2, bindings: [], shots: ordered().map((shot, index) => ({ id: shot.id, scene_id: sceneA, order: index + 1, sort_order: (index + 1) * 1024, title: shot.title, description: '', action: '', purpose: 'establish', subject: 'Scale', framing: 'wide', angle: 'eye level', movement: 'slow push', composition: 'centred', transition: 'cut', story_relationship: 'proves the promise', story_beat: 'Hook', creative_notes: '', execution_method: 'real', planned_duration_ms: shot.duration, approval: 'draft', locked_at: null, revision: 1, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [] })) }],
    orphan_shots: [], assets: [], documents: {},
    timing: { total_ms: 30000, target_ms: 30000, delta_ms: 0, status: 'fits', scene_states: [{ scene_id: sceneA, order: 1024, duration_ms: 30000, shots: 2, timing: 'derived' }] },
    runtime_conflict: false,
    timeline: [{ scene_id: sceneA, order: 1, title: 'Dark kitchen', duration_ms: 30000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: ordered().map((shot, index) => ({ shot_id: shot.id, order: index + 1, title: shot.title, duration_ms: shot.duration, execution_method: 'real', approval: 'draft', locked: false })) }],
    status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 2, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 3 }, needs_attention: 0 },
    truncated: false, provider,
    capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: false, ai_prompt_compilation: false, note: 'Real execution planning arrives with Prompt 6.' },
  });
  const reorderWrites: Array<{ ordered: string[]; scene: string }> = [];
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio/timing')) return route.fulfill({ json: envelope(readModel().timing) });
    if (path.endsWith('/shots/reorder')) {
      const orderedIds = body.ordered_ids as string[];
      // The Scene is addressed by the URL path (/scenes/<id>/shots/reorder), not by the body.
      reorderWrites.push({ ordered: orderedIds, scene: path.split('/studio/scenes/')[1].split('/')[0] });
      orderedIds.forEach((id, index) => { const shot = shots.find(item => item.id === id); if (shot) shot.order = index + 1; });
      return route.fulfill({ json: envelope({ shots: orderedIds.length, timing: readModel().timing }) });
    }
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(readModel()) });
    return route.fulfill({ json: envelope(null) });
  });

  await page.goto(`/studio/${productionId}?tool=Shots&scene=${sceneA}`);

  // Mobile: Scene and Shot stay reachable and the Director panel remains available.
  await expect(page.getByRole('heading', { name: /Shots in Scene 1: Dark kitchen/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TONDE Director' })).toBeVisible();
  await expect(page.getByLabel('Message to the Director')).toBeVisible();

  // Keyboard: zoom to Shot detail, then reorder through the accessible control, not a drag.
  await page.getByRole('button', { name: 'shot', exact: true }).click();
  const moveLater = page.getByRole('button', { name: 'Move shot Establish later' });
  await moveLater.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => reorderWrites.length).toBeGreaterThan(0);
  expect(reorderWrites[0]).toEqual({ ordered: [shotB, shotA], scene: sceneA });
  await expect(page.getByRole('button', { name: /Shot 1 of Scene 1: Scale macro/ })).toBeVisible();

  expect(errors).toEqual([]);
});
