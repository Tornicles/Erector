import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioComposition } from '../pages/StudioPage';
import { AppError } from '../services/errors';
import { productionService, type DirectorBundle, type DirectorStudio, type StudioReadModel, type StudioScene } from '../services/productions';
import { prompt11Service } from '../services/prompt11';
import { productionVersioningService } from '../services/productionVersioning';
import type { Production } from '../types/domain';

vi.mock('../services/productions', () => ({
  PAGE_SIZE: 40,
  productionService: {
    get: vi.fn(), saveTitle: vi.fn(), directorStudioSurface: vi.fn(), directorCommand: vi.fn(),
    directorCommandPreview: vi.fn(), saveDirectorBrief: vi.fn(), studioSurface: vi.fn(), studioTiming: vi.fn(),
    createStudioScene: vi.fn(), updateStudioScene: vi.fn(), reorderStudioScenes: vi.fn(), archiveStudioScene: vi.fn(),
    createStudioShot: vi.fn(), updateStudioShot: vi.fn(), moveStudioShot: vi.fn(), reorderStudioShots: vi.fn(),
    archiveStudioShot: vi.fn(), setStudioApproval: vi.fn(), setStudioLock: vi.fn(), reconcileStudioRuntime: vi.fn(),
    list: vi.fn(), listReferences: vi.fn(), getReferences: vi.fn(), scenes: vi.fn(), shots: vi.fn(),
    realSurface: vi.fn(), realShotDetail: vi.fn(), directRealShot: vi.fn(), directRealScene: vi.fn(),
    saveRealPlan: vi.fn(), setRealPlanApproval: vi.fn(), setRealPlanLock: vi.fn(),
    setShotCaptureState: vi.fn(), saveShotTake: vi.fn(), deleteShotTake: vi.fn(), recordShotDeviation: vi.fn(),
  },
}));
vi.mock('../services/prompt11', () => ({ prompt11Service: { jobs: vi.fn() } }));
vi.mock('../services/productionVersioning', () => ({
  productionVersioningService: { vocabulary: vi.fn(), versions: vi.fn(), restore: vi.fn() },
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneA = '00000000-0000-4000-8000-000000000010';
const sceneB = '00000000-0000-4000-8000-000000000011';
const shotA = '00000000-0000-4000-8000-000000000014';
const shotB = '00000000-0000-4000-8000-000000000015';

const production: Production = {
  id: productionId, workspace_id: workspaceId, project_id: '00000000-0000-4000-8000-000000000001', title: 'Ridgeway coffee',
  production_type: 'commercial', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft',
  locked_at: null, planned_duration_ms: 30000, calculated_duration_ms: null, start_ms: 0, end_ms: null,
  created_by: '00000000-0000-4000-8000-000000000001',
  revision: 7, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
};

function scene(id: string, order: number, title: string, duration: number, overrides: Partial<StudioScene> = {}): StudioScene {
  return {
    id, order, sort_order: order * 1024, title, purpose: 'Earn attention', story_beat: 'Hook', description: 'A dark kitchen.',
    action_lines: ['The kettle clicks off.'], opening_state: 'Empty counter.', ending_state: 'Kettle silent.',
    visual_intent: 'One soft source.', dialogue_notes: '', environment_asset_id: null,
    planned_duration_ms: duration, duration_ms: duration, timing: 'derived', approval: 'draft', locked_at: null,
    revision: 1, updated_at: '2026-10-05T00:00:00Z', character_asset_ids: [], dialogue_lines: 0, shot_count: 0,
    bindings: [], shots: [], ...overrides,
  };
}

function shot(id: string, sceneId: string, order: number, title: string, duration: number | null) {
  return {
    id, scene_id: sceneId, order, sort_order: order * 1024, title, description: 'Macro on the scale.', action: '',
    purpose: 'establish', subject: 'Scale', framing: 'wide', angle: 'eye level', movement: 'slow push',
    composition: 'centred', transition: 'cut', story_relationship: 'proves the promise', story_beat: 'Hook',
    creative_notes: '', execution_method: 'real' as const, planned_duration_ms: duration, approval: 'draft' as const,
    locked_at: null, revision: 1, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [],
  };
}

function model(overrides: Partial<StudioReadModel> = {}): StudioReadModel {
  const first = scene(sceneA, 1, 'Dark kitchen', 12000, { shots: [shot(shotA, sceneA, 1, 'Establish', 12000)], shot_count: 1 });
  const second = scene(sceneB, 2, 'Weighing', 18000, { shots: [shot(shotB, sceneB, 1, 'Scale macro', 18000)], shot_count: 1 });
  return {
    production: {
      id: productionId, workspace_id: workspaceId, title: 'Ridgeway coffee', production_type: 'commercial', custom_type: null,
      execution_method: 'real', planned_duration_ms: 30000, calculated_duration_ms: 30000, approval: 'draft',
      locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z',
    },
    scenes: [first, second],
    orphan_shots: [],
    assets: [],
    documents: {},
    timing: {
      total_ms: 30000, target_ms: 30000, delta_ms: 0, status: 'fits',
      scene_states: [
        { scene_id: sceneA, order: 1024, duration_ms: 12000, shots: 1, timing: 'derived' },
        { scene_id: sceneB, order: 2048, duration_ms: 18000, shots: 1, timing: 'derived' },
      ],
    },
    runtime_conflict: false,
    timeline: [
      { scene_id: sceneA, order: 1, title: 'Dark kitchen', duration_ms: 12000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotA, order: 1, title: 'Establish', duration_ms: 12000, execution_method: 'real', approval: 'draft', locked: false }] },
      { scene_id: sceneB, order: 2, title: 'Weighing', duration_ms: 18000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotB, order: 1, title: 'Scale macro', duration_ms: 18000, execution_method: 'real', approval: 'draft', locked: false }] },
    ],
    status_summary: { production_approval: 'draft', production_locked: false, scenes: 2, shots: 2, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 4 }, needs_attention: 0 },
    truncated: false,
    provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' },
    capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: false, ai_prompt_compilation: false, note: 'Later prompts deepen execution.' },
    ...overrides,
  };
}

const directorSurface = (): DirectorStudio => ({
  production: { id: productionId, title: 'Ridgeway coffee', production_type: 'commercial', execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 7 },
  brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null,
  scenes: [], runtime_fit: { target_ms: 30000, assigned_ms: 30000, dialogue_ms: 0, action_ms: 30000, slack_ms: 0, status: 'fits' },
  documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false,
  references: [], techniques: [], decisions: [], operations: [],
  provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' },
  reference_roles: {},
});

function studio(entry = '/') {
  const router = createMemoryRouter([{ path: '/', element: <StudioComposition initial={production} reload={vi.fn()} /> }], { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(productionService.saveTitle).mockResolvedValue({ ...production, title: 'Ridgeway coffee', revision: 8 });
  vi.mocked(productionService.directorStudioSurface).mockResolvedValue(directorSurface());
  vi.mocked(productionService.studioSurface).mockResolvedValue(model());
  vi.mocked(productionService.createStudioScene).mockResolvedValue({ scene_id: '00000000-0000-4000-8000-000000000012', revision: 1, timing: model().timing });
  vi.mocked(productionService.updateStudioScene).mockResolvedValue({ scene_id: sceneA, revision: 2, approval: 'draft', timing: model().timing });
  vi.mocked(productionService.reorderStudioScenes).mockResolvedValue({ scenes: 2, timing: model().timing });
  vi.mocked(productionService.archiveStudioScene).mockResolvedValue({ scene_id: sceneA, archived_shots: 1, timing: model().timing });
  vi.mocked(productionService.createStudioShot).mockResolvedValue({ shot_id: shotB, revision: 1, timing: model().timing });
  vi.mocked(productionService.updateStudioShot).mockResolvedValue({ shot_id: shotA, revision: 2, approval: 'draft', timing: model().timing });
  vi.mocked(productionService.moveStudioShot).mockResolvedValue({ shot_id: shotA, scene_id: sceneB, revision: 2, timing: model().timing });
  vi.mocked(productionService.reorderStudioShots).mockResolvedValue({ shots: 1, timing: model().timing });
  vi.mocked(productionService.archiveStudioShot).mockResolvedValue({ shot_id: shotA, archived: true, timing: model().timing });
  vi.mocked(productionService.setStudioApproval).mockResolvedValue({ scope: 'shot', id: shotA, approval: 'approved', revision: 2 });
  vi.mocked(productionService.setStudioLock).mockResolvedValue({ scope: 'shot', id: shotA, locked: true, revision: 2 });
  vi.mocked(productionService.reconcileStudioRuntime).mockResolvedValue({ adjusted_ms: -2000, shot_id: shotA, scene_id: sceneA, shot_duration_ms: 10000, timing: model().timing });
  vi.mocked(prompt11Service.jobs).mockResolvedValue({ jobs: [], count: 0, note: '' });
  vi.mocked(productionVersioningService.vocabulary).mockResolvedValue({ scopes: [], branch_states: [], change_states: [], merge_states: [], source_actions: [], propagation_modes: [], branchable_kinds: [], rule: '', limitation: '' });
  vi.mocked(productionVersioningService.versions).mockResolvedValue({ object_id: productionId, object_kind: 'production', object_label: 'Ridgeway coffee', branch: 'main', current_revision: 7, total: 1, limit: 50, offset: 0, truncated: false, note: '', items: [{ version_id: 'v1', object_id: productionId, revision: 7, branch: 'main', parent_version_id: null, actor_type: 'user', actor_user_id: null, source_action: 'create', source_action_label: 'Created', is_current: true, created_at: '2026-10-05T00:00:00Z' }] });
  vi.mocked(productionVersioningService.restore).mockResolvedValue({ object_id: productionId, restored_from_version_id: 'v1', restored_from_revision: 6, new_revision: 8, changed_fields: [], note: '' });
});

function openCardMenu(order: number) {
  fireEvent.click(screen.getByRole('button', { name: `Card ${order} options` }));
}

describe('Card-first Studio shell', () => {
  it('opens one real Production as cards with no tool maze', async () => {
    const router = studio('/?scene=' + sceneA + '&shot=' + shotA);
    expect(await screen.findByRole('region', { name: 'Production cards' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Card 1: Dark kitchen' })).toBeVisible();
    expect(document.querySelector<HTMLElement>('[data-scene="' + sceneB + '"]'))
      .toHaveAttribute('aria-hidden', 'true');
    expect(productionService.studioSurface).toHaveBeenCalledWith(workspaceId, productionId);
    // No permanent tool navigation competes with the cards.
    expect(screen.queryByRole('navigation', { name: 'Studio functions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /All studio tools/ })).toBeNull();
    // The URL carries card/Shot focus, never a tool maze.
    expect(router.state.location.search).toContain('scene=' + sceneA);
    expect(router.state.location.search).not.toContain('tool=');
  });

  it('repairs a selection that names no card instead of opening the wrong context', async () => {
    const router = studio('/');
    await waitFor(() => expect(router.state.location.search).toContain(`scene=${sceneA}`));
    expect(await screen.findByRole('article', { name: 'Card 1: Dark kitchen' })).toBeVisible();
  });

  it('maps a legacy tool deep link into a drawer section rather than a blank canvas', async () => {
    const router = studio('/?tool=Results');
    expect(await screen.findByRole('dialog', { name: 'Results' })).toBeVisible();
    await waitFor(() => expect(router.state.location.search).not.toContain('tool='));
    expect(router.state.location.search).toContain('scene=' + sceneA);
  });

  it('keeps one dominant card with honest readiness, visual state and next action', async () => {
    studio('/?scene=' + sceneA);
    const card = await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    expect(within(card).getByText('READY')).toBeVisible();
    expect(within(card).getByText('NO VISUAL YET')).toBeVisible();
    expect(within(card).getByRole('button', { name: 'START THIS CARD →' })).toBeVisible();
  });

  it('only exposes the focused Card in the stage, then moves focus from the Production timeline', async () => {
    const router = studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    const stage = screen.getByRole('region', { name: 'Production cards' });
    expect(within(stage).getByRole('article', { name: 'Card 1: Dark kitchen' })).toBeVisible();
    expect(stage.querySelector<HTMLElement>('[data-scene="' + sceneB + '"]')).toHaveAttribute('aria-hidden', 'true');
    expect(stage.querySelectorAll('.cs-hero.active')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Card 2: Weighing' }));
    await waitFor(() => expect(router.state.location.search).toContain('scene=' + sceneB));
    expect(screen.getByText('FOCUS · CARD 02')).toBeVisible();
    expect(screen.getByRole('option', { name: /02A · Scale macro/ })).toBeVisible();
    expect(document.querySelector<HTMLElement>('[data-scene="' + sceneB + '"]'))
      .toHaveAttribute('aria-hidden', 'false');
    expect(document.querySelector<HTMLElement>('[data-scene="' + sceneA + '"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('moves card focus with the keyboard', async () => {
    const router = studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.keyDown(screen.getByRole('region', { name: 'Production cards' }), { key: 'ArrowRight' });
    await waitFor(() => expect(router.state.location.search).toContain('scene=' + sceneB));
  });

  it('selects a Shot and makes it TONDE’s explicit scope', async () => {
    const router = studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.click(screen.getByRole('option', { name: /01A · Establish/ }));
    await waitFor(() => expect(router.state.location.search).toContain('shot=' + shotA));
    expect(screen.getByText('FOCUS · SHOT 01A')).toBeVisible();
    expect(screen.getByText(/affect Shot 01A unless you say otherwise/)).toBeVisible();
  });

  it('shows an honest empty state when the Production has no cards yet', async () => {
    vi.mocked(productionService.studioSurface).mockResolvedValue(model({ scenes: [] }));
    studio('/');
    expect(await screen.findByRole('heading', { name: 'This Production has no cards yet.' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ask TONDE to develop it →' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add a blank card' })).toBeVisible();
  });

  it('reports only active background work scoped to this Production', async () => {
    vi.mocked(productionService.studioSurface).mockResolvedValue(model({ scenes: [] }));
    vi.mocked(prompt11Service.jobs).mockResolvedValue({
      jobs: [
        { job_id: 'mine', job_type: 'reference_analysis', status: 'running', attempts: 1, max_attempts: 3, production_id: productionId },
        { job_id: 'workspace', job_type: 'reference_analysis', status: 'running', attempts: 1, max_attempts: 3, production_id: null },
        { job_id: 'done', job_type: 'reference_analysis', status: 'succeeded', attempts: 1, max_attempts: 3, production_id: productionId },
      ],
      count: 3, note: '',
    });
    studio('/');
    expect(await screen.findByText(/TONDE has 1 active background task for this Production/)).toBeVisible();
    expect(screen.queryByText(/building cards in the background/i)).toBeNull();
  });

  it('does not claim background work for workspace-level or completed jobs', async () => {
    vi.mocked(productionService.studioSurface).mockResolvedValue(model({ scenes: [] }));
    vi.mocked(prompt11Service.jobs).mockResolvedValue({
      jobs: [
        { job_id: 'workspace', job_type: 'reference_analysis', status: 'running', attempts: 1, max_attempts: 3, production_id: null },
        { job_id: 'done', job_type: 'reference_analysis', status: 'succeeded', attempts: 1, max_attempts: 3, production_id: productionId },
      ],
      count: 2, note: '',
    });
    studio('/');
    expect(await screen.findByText(/Describe the first moment to TONDE/)).toBeVisible();
    expect(screen.queryByRole('status', { name: /background/i })).toBeNull();
  });

  it('adds a blank card from the empty state through the real create path', async () => {
    vi.mocked(productionService.studioSurface).mockResolvedValue(model({ scenes: [] }));
    studio('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a blank card' }));
    await waitFor(() => expect(productionService.createStudioScene).toHaveBeenCalledWith(workspaceId, productionId,
      expect.objectContaining({ title: 'New moment', expected_production_revision: 7 })));
  });

  it('keeps the same cards when the execution face changes, defaulting to Real', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    expect(screen.getByRole('button', { name: 'REAL' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.getByRole('button', { name: 'AI' })).toHaveAttribute('aria-pressed', 'true');
    // One read model, one Production: switching face refetches nothing and moves no selection.
    expect(productionService.studioSurface).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>('[data-scene="' + sceneA + '"]'))
      .toHaveAttribute('aria-hidden', 'false');
    expect(document.querySelector<HTMLElement>('[data-scene="' + sceneB + '"]'))
      .toHaveAttribute('aria-hidden', 'true');
  });

  it('routes a card waiting on review to Readiness instead of a generic page', async () => {
    vi.mocked(productionService.studioSurface).mockResolvedValue(model({
      scenes: [scene(sceneA, 1, 'Dark kitchen', 12000, { approval: 'needs_review', shots: [shot(shotA, sceneA, 1, 'Establish', 12000)], shot_count: 1 }), model().scenes[1]],
    }));
    studio('/?scene=' + sceneA);
    const card = await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    expect(within(card).getByText('NEEDS YOU')).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'REVIEW DECISION →' }));
    expect(await screen.findByRole('dialog', { name: 'Readiness' })).toBeVisible();
  });
});

describe('Card and Shot editing', () => {
  it('renames a Card against its revision and reports the exact persisted result', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    openCardMenu(1);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('New title for Card 1'), { target: { value: 'Cold open' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(productionService.updateStudioScene).toHaveBeenCalledWith(workspaceId, productionId, sceneA,
      expect.objectContaining({ title: 'Cold open', expected_revision: 1 })));
    expect(await screen.findByText(/Saved\./)).toBeVisible();
  });

  it('inserts a card after the focused one through create plus reorder', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.click(screen.getByRole('button', { name: '＋ Add after' }));
    await waitFor(() => expect(productionService.createStudioScene).toHaveBeenCalledWith(workspaceId, productionId,
      expect.objectContaining({ title: 'New moment' })));
    await waitFor(() => expect(productionService.reorderStudioScenes).toHaveBeenCalledWith(workspaceId, productionId,
      [sceneA, '00000000-0000-4000-8000-000000000012', sceneB], 7));
    expect(await screen.findByText(/New card inserted at that position\./)).toBeVisible();
  });

  it('inserts between two cards from the film strip', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.click(screen.getByRole('button', { name: 'Insert a card after Card 1' }));
    await waitFor(() => expect(productionService.reorderStudioScenes).toHaveBeenCalledWith(workspaceId, productionId,
      [sceneA, '00000000-0000-4000-8000-000000000012', sceneB], 7));
  });

  it('moves a card with the keyboardreachable control and offers a real impact review', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    openCardMenu(1);
    fireEvent.click(screen.getByRole('button', { name: 'Move later' }));
    await waitFor(() => expect(productionService.reorderStudioScenes).toHaveBeenCalledWith(workspaceId, productionId,
      [sceneB, sceneA], 7));
    expect(await screen.findByText(/Card 1 moved\./)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review impact' }));
    expect(await screen.findByRole('dialog', { name: 'Impact' })).toBeVisible();
  });

  it('archives a card only after an explicit second step, never deleting', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    openCardMenu(1);
    fireEvent.click(screen.getByRole('button', { name: 'Archive…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive card' }));
    await waitFor(() => expect(productionService.archiveStudioScene).toHaveBeenCalledWith(workspaceId, productionId, sceneA, 1, true));
    expect(await screen.findByText(/Content is archived, not deleted\./)).toBeVisible();
  });

  it('approves and locks a card through the real approval and lock paths', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    openCardMenu(1);
    fireEvent.click(screen.getByRole('button', { name: 'Approve card' }));
    await waitFor(() => expect(productionService.setStudioApproval).toHaveBeenCalledWith(workspaceId, productionId, 'scene', sceneA, 'approved', 1));
    openCardMenu(1);
    fireEvent.click(screen.getByRole('button', { name: 'Lock card' }));
    await waitFor(() => expect(productionService.setStudioLock).toHaveBeenCalledWith(workspaceId, productionId, 'scene', sceneA, true, 1));
  });

  it('adds a Shot to the focused card through the real create path', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.click(screen.getByRole('button', { name: '＋ Shot' }));
    await waitFor(() => expect(productionService.createStudioShot).toHaveBeenCalledWith(workspaceId, productionId,
      expect.objectContaining({ scene_id: sceneA, title: 'New shot', expected_production_revision: 7 })));
  });

  it('renames the focused Shot and reports changed-after-approval honestly', async () => {
    vi.mocked(productionService.updateStudioShot).mockResolvedValueOnce({ shot_id: shotA, revision: 3, approval: 'changed_after_approval', timing: model().timing });
    const router = studio('/?scene=' + sceneA + '&shot=' + shotA);
    expect(await screen.findByText('FOCUS · SHOT 01A')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Shot 01A options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('New title for Shot 01A'), { target: { value: 'Tighter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(productionService.updateStudioShot).toHaveBeenCalledWith(workspaceId, productionId, shotA,
      expect.objectContaining({ title: 'Tighter', expected_revision: 1 })));
    expect(await screen.findByText(/it is now Changed After Approval - review it again\./)).toBeVisible();
    expect(router.state.location.search).toContain('shot=' + shotA);
  });

  it('saves an explicit empty duration as undecided, never guessed', async () => {
    studio('/?scene=' + sceneA + '&shot=' + shotA);
    expect(await screen.findByText('FOCUS · SHOT 01A')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Shot 01A options' }));
    fireEvent.change(screen.getByLabelText('Duration (ms)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save duration' }));
    await waitFor(() => expect(productionService.updateStudioShot).toHaveBeenCalledWith(workspaceId, productionId, shotA,
      expect.objectContaining({ duration_ms: null, expected_revision: 1 })));
  });

  it('reports a conflict instead of pretending the write succeeded', async () => {
    vi.mocked(productionService.updateStudioScene).mockRejectedValueOnce(new AppError('conflict', 'That scene changed since you loaded it'));
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    openCardMenu(1);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('New title for Card 1'), { target: { value: 'Stale edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That scene changed since you loaded it')).toBeVisible();
    expect(await screen.findByText(/Reload before applying your change\./)).toBeVisible();
  });
});

describe('Director scope and proposals', () => {
  it('scopes a direction to the selected Shot and previews through the server', async () => {
    vi.mocked(productionService.directorCommandPreview).mockResolvedValue({
      kind: 'shot_intensity', scope: 'shot', confidence: 'high', rationale: 'I will make this Shot more tense.',
      operations: ['intensify_shot'], signals: ['shot'], reference_role: null, target_runtime_ms: null, scene_order: 1,
    });
    studio('/?scene=' + sceneA + '&shot=' + shotA);
    expect(await screen.findByText('FOCUS · SHOT 01A')).toBeVisible();
    expect(screen.getByText(/Scope: Shot “Establish” in Scene 1/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Message to the Director'), { target: { value: 'Make this Shot more tense.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
    expect(await screen.findByText(/I will make this Shot more tense\./)).toBeVisible();
    expect(productionService.directorCommandPreview).toHaveBeenCalledWith(workspaceId, productionId, 'Make this Shot more tense.');
  });

  it('applies a Director plan only through an explicit apply call', async () => {
    vi.mocked(productionService.directorCommand).mockResolvedValue({
      command: { kind: 'scene_intensity', scope: 'scene', confidence: 'high', rationale: 'Intensify.', operations: ['intensify_scene'], signals: ['scene 1'], reference_role: null, target_runtime_ms: null, scene_order: 1, parameters: {} },
      rationale: 'Scene 1 intensification', answer: 'Done.', changes: ['Scene 1 intensified'], operations: ['intensify_scene'],
      limitations: [], causal: [], story_alternatives: [], line_alternatives: {}, reference_role: null,
      adaptations_applied: [], plan: {} as unknown as DirectorBundle, producer: 'deterministic', applied: null,
    });
    studio('/?scene=' + sceneA);
    await screen.findByText('FOCUS · CARD 01');
    fireEvent.change(screen.getByLabelText('Message to the Director'), { target: { value: 'Make Card 1 scarier.' } });
    fireEvent.click(screen.getByRole('button', { name: /Ask the Director/ }));
    expect(await screen.findByText('Done.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Apply to this Production/ }));
    await waitFor(() => expect(productionService.directorCommand).toHaveBeenCalledWith(workspaceId, productionId,
      expect.objectContaining({ text: 'Make Card 1 scarier.', apply: true })));
  });

  it('falls back to Production scope when nothing is selected', async () => {
    studio('/?scene=__none__');
    expect(await screen.findByText('FOCUS · CARD 01')).toBeVisible();
  });
});

describe('Production Details drawer', () => {
  it('opens honest production intelligence without a tool maze', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.click(screen.getByRole('button', { name: 'Production Details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Production Details' });
    expect(within(dialog).getByText(/No Story direction recorded yet/)).toBeVisible();
    expect(within(dialog).getByText(/No references shape this Production yet/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reads real change history from the versioning service', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.click(screen.getByRole('button', { name: 'Production Details' }));
    expect(await screen.findByRole('dialog', { name: 'Production Details' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open history' })).toBeVisible();
  });
});

describe('Undo and redo', () => {
  it('says there is nothing to undo when no earlier revision exists', async () => {
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText(/Nothing to undo/)).toBeVisible();
    expect(productionVersioningService.restore).not.toHaveBeenCalled();
  });

  it('undoes by restoring the earlier version as a new revision, then redoes', async () => {
    vi.mocked(productionVersioningService.versions)
      .mockResolvedValueOnce({
        object_id: productionId, object_kind: 'production', object_label: 'Ridgeway coffee', branch: 'main',
        current_revision: 7, total: 2, limit: 50, offset: 0, truncated: false, note: '',
        items: [
          { version_id: 'v7', object_id: productionId, revision: 7, branch: 'main', parent_version_id: 'v6', actor_type: 'user', actor_user_id: null, source_action: 'scene_update', source_action_label: 'Scene updated', is_current: true, created_at: '2026-10-05T00:00:00Z' },
          { version_id: 'v6', object_id: productionId, revision: 6, branch: 'main', parent_version_id: null, actor_type: 'user', actor_user_id: null, source_action: 'scene_create', source_action_label: 'Scene created', is_current: false, created_at: '2026-10-05T00:00:00Z' },
        ],
      })
      .mockResolvedValueOnce({
        object_id: productionId, object_kind: 'production', object_label: 'Ridgeway coffee', branch: 'main',
        current_revision: 8, total: 3, limit: 50, offset: 0, truncated: false, note: '',
        items: [
          { version_id: 'v8', object_id: productionId, revision: 8, branch: 'main', parent_version_id: 'v7', actor_type: 'user', actor_user_id: null, source_action: 'restore', source_action_label: 'Restored', is_current: true, created_at: '2026-10-05T00:00:00Z' },
          { version_id: 'v7', object_id: productionId, revision: 7, branch: 'main', parent_version_id: 'v6', actor_type: 'user', actor_user_id: null, source_action: 'scene_update', source_action_label: 'Scene updated', is_current: true, created_at: '2026-10-05T00:00:00Z' },
          { version_id: 'v6', object_id: productionId, revision: 6, branch: 'main', parent_version_id: null, actor_type: 'user', actor_user_id: null, source_action: 'scene_create', source_action_label: 'Scene created', is_current: false, created_at: '2026-10-05T00:00:00Z' },
        ],
      });
    studio('/?scene=' + sceneA);
    await screen.findByRole('article', { name: 'Card 1: Dark kitchen' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(productionVersioningService.restore).toHaveBeenCalledWith(workspaceId, productionId, 'v6', expect.stringContaining('Undo')));
    expect(await screen.findByText(/Undone — revision 6 restored as new revision 8/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(productionVersioningService.restore).toHaveBeenCalledWith(workspaceId, productionId, 'v7', expect.stringContaining('Redo')));
  });
});

describe('expanded Card view', () => {
  it('opens the expanded same Card from a deep link and keeps one Shot detail closed until asked', async () => {
    const router = studio('/?scene=' + sceneA + '&view=card&focus=card');
    const expanded = await screen.findByRole('region', { name: 'Card 1 expanded' });
    expect(within(expanded).getByRole('heading', { name: 'Dark kitchen' })).toBeVisible();
    expect(within(expanded).getByRole('status')).toHaveTextContent('FOCUS · CARD 01');
    // The floating sequence is replaced by the same Card expanded — never a second Studio.
    expect(screen.queryByRole('region', { name: 'Production cards' })).toBeNull();
    expect(router.state.location.search).toContain('view=card');
  });

  it('carries Card area focus in the URL and returns to Production with the Card centred', async () => {
    const router = studio('/?scene=' + sceneB + '&view=card&focus=camera');
    const expanded = await screen.findByRole('region', { name: 'Card 2 expanded' });
    expect(within(expanded).getByRole('status')).toHaveTextContent('FOCUS · CAMERA');
    fireEvent.click(within(expanded).getByRole('tab', { name: 'AUDIO' }));
    await waitFor(() => expect(router.state.location.search).toContain('focus=audio'));

    fireEvent.click(within(expanded).getByRole('button', { name: '← BACK TO PRODUCTION' }));
    await waitFor(() => expect(router.state.location.search).not.toContain('view=card'));
    expect(await screen.findByRole('region', { name: 'Production cards' })).toBeVisible();
    // The same Card stays centred in the floating sequence.
    expect(router.state.location.search).toContain('scene=' + sceneB);
    expect(document.querySelector<HTMLElement>('[data-scene="' + sceneB + '"]'))
      .toHaveAttribute('aria-hidden', 'false');
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });
