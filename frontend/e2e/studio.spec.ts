import { expect, test, type Page } from '@playwright/test';

// Card-first Studio end-to-end flow. The Supabase transport and the TONDE Studio API
// are both stubbed at the network boundary: this proves the browser keeps ONE Master
// Production, writes canonical Cards (Scenes) and Shots against revisions, and never
// invents state. Cards are the primary navigation; every other surface opens as a
// drawer over the focused card.
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

function state() {
  const scenes: Scene[] = [
    { id: sceneA, title: 'Dark kitchen', approval: 'draft', locked: false, revision: 1 },
    { id: sceneB, title: 'Weighing', approval: 'draft', locked: false, revision: 1 },
  ];
  const shots: Shot[] = [
    { id: shotA, scene_id: sceneA, title: 'Establish', duration: 12000, approval: 'draft', locked: false, revision: 1 },
    { id: shotB, scene_id: sceneB, title: 'Scale macro', duration: 18000, approval: 'draft', locked: false, revision: 1 },
  ];
  return { scenes, shots };
}

type StudioState = ReturnType<typeof state>;

function studioModel(current: StudioState) {
  // Read scenes/shots live from the state object: write handlers mutate it in
  // place and the read model must project the newest state after each refresh.
  const shotsOf = (sceneId: string) => current.shots.filter(shot => shot.scene_id === sceneId);
  const sceneTiming = (sceneId: string) => {
    const own = shotsOf(sceneId);
    const total = own.reduce((sum, shot) => sum + (shot.duration ?? 0), 0);
    if (!own.length) return { duration: 0, timing: 'planned' };
    if (own.some(shot => shot.duration === null)) return { duration: total, timing: 'incomplete' };
    return { duration: total, timing: 'derived' };
  };
  const timing = () => {
    const states = current.scenes.map((scene, index) => ({ scene_id: scene.id, order: (index + 1) * 1024, ...sceneTiming(scene.id), shots: shotsOf(scene.id).length }));
    const total = states.reduce((sum, item) => sum + item.duration, 0); const target = 30000;
    return { total_ms: total, target_ms: target, delta_ms: total - target, status: total === target ? 'fits' : total > target ? 'over' : 'under', scene_states: states };
  };
  const readModel = () => ({
    production: { id: productionId, workspace_id: workspace, title: initialProduction.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 30000, calculated_duration_ms: timing().total_ms, approval: 'draft', locked_at: null, revision: 2, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
    scenes: current.scenes.map((scene, index) => {
      const own = sceneTiming(scene.id);
      return {
        id: scene.id, order: index + 1, sort_order: (index + 1) * 1024, title: scene.title, purpose: 'Earn attention', story_beat: 'Hook', description: 'A dark kitchen.',
        action_lines: [], opening_state: '', ending_state: '', visual_intent: '', dialogue_notes: '', environment_asset_id: null,
        planned_duration_ms: own.duration, duration_ms: own.duration, timing: own.timing, approval: scene.approval,
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
    timeline: [],
    status_summary: { production_approval: 'draft', production_locked: false, scenes: current.scenes.length, shots: current.shots.length, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: current.scenes.length + current.shots.length }, needs_attention: 0 },
    truncated: false, provider,
    capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: false, ai_prompt_compilation: false, note: 'Real execution planning arrives with Prompt 6.' },
  });
  return { shotsOf, timing, readModel };
}

async function studioRoutes(page: Page, current: StudioState, writes: Array<{ path: string; body: Record<string, unknown> }>) {
  const model = studioModel(current);
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/director/provider')) return route.fulfill({ json: envelope(provider) });
    if (path.endsWith('/studio/timing')) return route.fulfill({ json: envelope(model.timing()) });
    if (path.endsWith('/jobs')) return route.fulfill({ json: envelope({ jobs: [], count: 0, note: '' }) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(model.readModel()) });
    if (path.endsWith('/studio/scenes') && request.method() === 'POST') {
      writes.push({ path, body });
      const created: Scene = { id: '00000000-0000-4000-8000-000000000012', title: String(body.title), approval: 'draft', locked: false, revision: 1 };
      current.scenes.push(created);
      return route.fulfill({ json: envelope({ scene_id: created.id, title: created.title, sort_order: current.scenes.length * 1024, revision: 1, approval: 'draft', timing: model.timing() }) });
    }
    if (path.endsWith('/studio/shots') && request.method() === 'POST') {
      writes.push({ path, body });
      const created: Shot = { id: '00000000-0000-4000-8000-000000000016', scene_id: String(body.scene_id), title: String(body.title), duration: null, approval: 'draft', locked: false, revision: 1 };
      current.shots.push(created);
      return route.fulfill({ json: envelope({ shot_id: created.id, title: created.title, sort_order: current.shots.length * 1024, revision: 1, approval: 'draft', execution_method: 'real', timing: model.timing() }) });
    }
    if (path.endsWith('/scenes/reorder')) {
      writes.push({ path, body });
      const order = body.ordered_ids as string[];
      current.scenes.splice(0, current.scenes.length, ...order.map(id => current.scenes.find(scene => scene.id === id)!));
      return route.fulfill({ json: envelope({ scenes: order.length, timing: model.timing() }) });
    }
    if (/\/studio\/scenes\/[^/]+\/archive$/.test(path)) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ scene_id: path.split('/').slice(-1)[0], archived_shots: 0, timing: model.timing() }) });
    }
    if (/\/studio\/scenes\/[^/]+$/.test(path) && request.method() === 'PATCH') {
      writes.push({ path, body });
      const scene = current.scenes.find(item => path.endsWith(item.id));
      if (scene) { if (typeof body.title === 'string') scene.title = body.title; scene.revision += 1; }
      return route.fulfill({ json: envelope({ scene_id: scene?.id, revision: scene?.revision, approval: scene?.approval, timing: model.timing() }) });
    }
    if (/\/studio\/shots\/[^/]+$/.test(path) && request.method() === 'PATCH') {
      writes.push({ path, body });
      const shot = current.shots.find(item => path.endsWith(item.id));
      if (shot) {
        if (typeof body.title === 'string') shot.title = body.title;
        if ('duration_ms' in body) shot.duration = body.duration_ms === null ? null : Number(body.duration_ms);
        shot.revision += 1;
        if (shot.approval === 'approved') shot.approval = 'changed_after_approval';
      }
      return route.fulfill({ json: envelope({ shot_id: shot?.id, revision: shot?.revision, approval: shot?.approval, execution_method: 'real', scene_id: shot?.scene_id, timing: model.timing() }) });
    }
    if (path.endsWith('/approval')) {
      writes.push({ path, body });
      const shot = current.shots.find(item => item.id === body.id);
      if (shot) shot.approval = String(body.approval);
      return route.fulfill({ json: envelope({ scope: body.scope, id: body.id, approval: body.approval, revision: 2 }) });
    }
    return route.fulfill({ json: envelope(null) });
  });
}

test('Studio edits canonical Cards and Shots, keeps one Master Production and survives reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const current = state();
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await studioRoutes(page, current, writes);
  let productionWrites = 0;
  page.on('request', request => { if (request.url() === 'https://tonde-test.supabase.co/rest/v1/productions' && request.method() === 'PATCH') productionWrites += 1; });

  // 1. One Master Production as cards: a legacy Scenes link folds into the card
  // view instead of a tool canvas, and the URL carries card focus, not a tool maze.
  await page.goto(`/studio/${productionId}?tool=Scenes&scene=${sceneA}`);
  await expect(page.getByRole('region', { name: 'Production cards' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Card 1: Dark kitchen' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Card 2: Weighing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Card 1: Dark kitchen' })).toBeVisible();
  await expect(page.getByText('FOCUS · CARD 01')).toBeVisible();
  await expect(page.getByRole('option', { name: /01A · Establish/ })).toBeVisible();
  await expect(page).not.toHaveURL(/tool=/);

  // 2. Renaming a Card persists against its revision.
  await page.getByRole('button', { name: 'Card 1 options' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('New title for Card 1').fill('Cold open');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  expect(writes.find(write => write.path.endsWith(`/studio/scenes/${sceneA}`))?.body).toMatchObject({ title: 'Cold open', expected_revision: 1 });

  // 3. Adding a Shot to the focused card persists into that card with no duration guessed.
  await page.getByRole('button', { name: 'Card 2: Weighing' }).click();
  await expect(page.getByText('FOCUS · CARD 02')).toBeVisible();
  await page.getByRole('button', { name: '＋ Shot' }).click();
  await expect(page.getByText(/Saved\. Runtime fits\./)).toBeVisible();
  expect(writes.find(write => write.path.endsWith('/studio/shots'))?.body).toMatchObject({ scene_id: sceneB, title: 'New shot' });
  await expect(page.getByRole('option', { name: /02B · New shot/ })).toBeVisible();
  await expect(page.getByText('untimed')).toBeVisible();

  // 4. A duration change is a canonical write and the note reports the real overage.
  await page.getByRole('option', { name: /02A · Scale macro/ }).click();
  await expect(page.getByText('FOCUS · SHOT 02A')).toBeVisible();
  await page.getByRole('button', { name: 'Shot 02A options' }).click();
  await page.getByLabel('Duration (ms)').fill('20000');
  await page.getByRole('button', { name: 'Save duration' }).click();
  await expect(page.getByText(/Runtime over by 2s\./)).toBeVisible();
  expect(writes.find(write => write.path.endsWith(`/studio/shots/${shotB}`))?.body).toMatchObject({ duration_ms: 20000, expected_revision: 1 });

  // 5. Approved content that changes stops claiming to be approved.
  await page.getByRole('button', { name: 'Shot 02A options' }).click();
  await page.getByRole('button', { name: 'Approve shot' }).click();
  await expect(page.getByText(/Shot is Approved\./)).toBeVisible();
  await page.getByRole('button', { name: 'Shot 02A options' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('New title for Shot 02A').fill('Scale macro v2');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/it is now Changed After Approval - review it again\./)).toBeVisible();

  // 6. Switching execution face keeps the same Production, Cards and Shots.
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article', { name: 'Card 2: Weighing' })).toBeVisible();
  await expect(page.getByRole('option', { name: /02A · Scale macro v2/ })).toBeVisible();
  expect(productionWrites).toBe(0);

  // 7. Reload restores card and Shot focus from the URL and re-reads canonical state.
  await page.reload();
  await expect(page.getByText('FOCUS · SHOT 02A')).toBeVisible();
  await expect(page.getByRole('option', { name: /02A · Scale macro v2/ })).toBeVisible();

  expect(errors).toEqual([]);
});

// §102 mobile review and §103 keyboard alternative to dragging. Drag/drop is not the
// only way to reorder: every card exposes a labelled Move earlier/later control, and
// the Director stays reachable on a narrow viewport.
test('a narrow viewport keeps cards, Shots and the Director usable and reorders with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const current = state();
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await studioRoutes(page, current, writes);
  const reorderWrites: Array<{ ordered: string[] }> = [];
  page.on('request', request => {
    if (request.url().endsWith('/studio/scenes/reorder') && request.method() === 'POST') {
      reorderWrites.push({ ordered: (request.postDataJSON() as { ordered_ids: string[] }).ordered_ids });
    }
  });

  await page.goto(`/studio/${productionId}?scene=${sceneA}`);

  // Mobile: cards, the focused card's Shots and the Director stay reachable.
  await expect(page.getByRole('region', { name: 'Production cards' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Card 1: Dark kitchen' })).toBeVisible();
  await expect(page.getByRole('option', { name: /01A · Establish/ })).toBeVisible();
  await expect(page.getByLabel('Message to the Director')).toBeVisible();

  // Keyboard: open the card menu, focus Move later, activate without any drag.
  await page.getByRole('button', { name: 'Card 1 options' }).click();
  const moveLater = page.getByRole('button', { name: 'Move later' });
  await moveLater.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => reorderWrites.length).toBeGreaterThan(0);
  expect(reorderWrites[0]).toEqual({ ordered: [sceneB, sceneA] });
  await expect(page.getByText(/Card order saved \(2 Cards\)\./)).toBeVisible();

  expect(errors).toEqual([]);
});
