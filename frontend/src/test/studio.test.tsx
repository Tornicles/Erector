import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioComposition } from '../pages/StudioPage';
import { AppError } from '../services/errors';
import { productionService, type DirectorStudio, type StudioReadModel, type StudioScene } from '../services/productions';
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

function studio(entry = '/?tool=Scenes') {
  const router = createMemoryRouter([{ path: '/', element: <StudioComposition initial={production} reload={vi.fn()} /> }], { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(productionService.saveTitle).mockResolvedValue({ ...production, title: 'Ridgeway coffee', revision: 8 });
  vi.mocked(productionService.directorStudioSurface).mockResolvedValue(directorSurface());
  vi.mocked(productionService.studioSurface).mockResolvedValue(model());
  vi.mocked(productionService.createStudioScene).mockResolvedValue({ scene_id: sceneB, revision: 1, timing: model().timing });
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
});

describe('Studio shell', () => {
  it('opens one real Production, keeps the Studio tool in the URL and restores selection on refresh', async () => {
    const router = studio('/?tool=Shots&scene=' + sceneA + '&shot=' + shotA);
    expect(await screen.findByRole('heading', { name: /Shots in Scene 1: Dark kitchen/ })).toBeVisible();
    expect(productionService.studioSurface).toHaveBeenCalledWith(workspaceId, productionId);
    expect(screen.getByText(/REAL PRODUCTION \/ SHOTS/)).toBeVisible();
    expect(await screen.findByLabelText(`Shot editor for Establish`)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Scenes' }));
    await waitFor(() => expect(router.state.location.search).toContain('tool=Scenes'));
    expect(await screen.findByRole('heading', { name: 'Scenes' })).toBeVisible();
  });

  it('repairs a deep link that names no Scene instead of opening the wrong context', async () => {
    const router = studio('/?tool=Scenes');
    await waitFor(() => expect(router.state.location.search).toContain(`scene=${sceneA}`));
    expect(await screen.findByRole('heading', { name: /Scene 1: Dark kitchen/ })).toBeVisible();
  });

  it('keeps the timeline and the canvases on one shared selection', async () => {
    studio('/?tool=Scenes&scene=' + sceneA);
    const block = await screen.findByRole('button', { name: /Scene 2: Weighing/ });
    fireEvent.click(block);
    expect(await screen.findByRole('heading', { name: /Scene 2: Weighing/ })).toBeVisible();
    const shotBlock = screen.getByRole('button', { name: /Shot 1 of Scene 2: Scale macro/ });
    fireEvent.click(shotBlock);
    expect(await screen.findByText(/Selected Shot/)).toBeVisible();
    expect(screen.getAllByText('Scale macro').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/18s/).length).toBeGreaterThan(0);
  });

  it('shows a runtime conflict as a real number instead of a readiness score', async () => {
    const conflict = model({
      runtime_conflict: true,
      timing: { total_ms: 34000, target_ms: 30000, delta_ms: 4000, status: 'over', scene_states: [
        { scene_id: sceneA, order: 1024, duration_ms: 12000, shots: 1, timing: 'derived' },
        { scene_id: sceneB, order: 2048, duration_ms: 22000, shots: 1, timing: 'derived' },
      ] },
    });
    vi.mocked(productionService.studioSurface).mockResolvedValue(conflict);
    studio('/?tool=Scenes&scene=' + sceneA);
    expect(await screen.findByText(/Over target by 4s/)).toBeVisible();
    expect(screen.getByText(/is over its 30s target by 4s/)).toBeVisible();
  });
});

describe('Scene and Shot editing', () => {
  it('renames a Scene against its revision and reports the exact persisted result', async () => {
    studio('/?tool=Scenes&scene=' + sceneA);
    const title = await screen.findByLabelText('Title', { selector: '#scene-edit-title' });
    fireEvent.change(title, { target: { value: 'Cold open' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Scene' }));
    await waitFor(() => expect(productionService.updateStudioScene).toHaveBeenCalledWith(workspaceId, productionId, sceneA,
      expect.objectContaining({ title: 'Cold open', expected_revision: 1 })));
    expect(await screen.findByText(/Saved\./)).toBeVisible();
  });

  it('creates a Scene against the Production revision and selects it', async () => {
    studio('/?tool=Scenes&scene=' + sceneA);
    fireEvent.change(await screen.findByLabelText('New Scene title'), { target: { value: 'Cold open' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Scene/ }));
    await waitFor(() => expect(productionService.createStudioScene).toHaveBeenCalledWith(workspaceId, productionId,
      expect.objectContaining({ title: 'Cold open', expected_production_revision: 7 })));
  });

  it('creates a Shot into the Scene that is actually selected', async () => {
    studio('/?tool=Shots&scene=' + sceneA);
    fireEvent.change(await screen.findByLabelText('New Shot title'), { target: { value: 'Kettle clicks' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Shot/ }));
    await waitFor(() => expect(productionService.createStudioShot).toHaveBeenCalledWith(workspaceId, productionId,
      expect.objectContaining({ scene_id: sceneA, title: 'Kettle clicks', expected_production_revision: 7 })));
    // The form clears only after the write resolved, so it never pretends an unsaved Shot exists.
    expect(screen.getByLabelText('New Shot title')).toHaveValue('');
    expect(await screen.findByText(/Saved\./)).toBeVisible();
  });

  it('blocks a locked Shot from being edited and says why', async () => {
    const locked = scene(sceneA, 1, 'Dark kitchen', 12000, {
      locked_at: '2026-10-05T00:00:00Z',
      shots: [{ ...shot(shotA, sceneA, 1, 'Establish', 12000), locked_at: '2026-10-05T00:00:00Z' }], shot_count: 1,
    });
    vi.mocked(productionService.studioSurface).mockResolvedValue(model({ scenes: [locked, model().scenes[1]] }));
    studio('/?tool=Shots&scene=' + sceneA + '&shot=' + shotA);
    expect(await screen.findByText(/Unlock this Shot to edit it\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save Shot' })).toBeDisabled();
    expect(screen.getByLabelText('Title', { selector: '#shot-edit-title' })).toBeDisabled();
  });

  it('sends only the changed Shot fields, including an explicit empty duration', async () => {
    studio('/?tool=Shots&scene=' + sceneA + '&shot=' + shotA);
    const duration = await screen.findByLabelText('Duration (ms)');
    fireEvent.change(duration, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Shot' }));
    await waitFor(() => expect(productionService.updateStudioShot).toHaveBeenCalledWith(workspaceId, productionId, shotA,
      expect.objectContaining({ duration_ms: null, expected_revision: 1 })));
  });

  it('moves a Shot to another Scene through the canonical move operation', async () => {
    studio('/?tool=Shots&scene=' + sceneA + '&shot=' + shotA);
    fireEvent.change(await screen.findByLabelText('Move to Scene'), { target: { value: sceneB } });
    await waitFor(() => expect(productionService.moveStudioShot).toHaveBeenCalledWith(workspaceId, productionId, shotA, sceneB, 1));
    expect(await screen.findByText(/Moved the Shot to Scene 2\./)).toBeVisible();
  });

  it('archives rather than deletes, and reports how much was archived', async () => {
    studio('/?tool=Scenes&scene=' + sceneA);
    fireEvent.click(await screen.findByRole('button', { name: /Archive Dark kitchen/ }));
    await waitFor(() => expect(productionService.archiveStudioScene).toHaveBeenCalledWith(workspaceId, productionId, sceneA, 1, true));
    expect(await screen.findByText(/Content is archived, not deleted\./)).toBeVisible();
  });

  it('reorders Scenes with the complete ordered set', async () => {
    studio('/?tool=Scenes&scene=' + sceneA);
    fireEvent.click(await screen.findByRole('button', { name: /Move Dark kitchen later/ }));
    await waitFor(() => expect(productionService.reorderStudioScenes).toHaveBeenCalledWith(workspaceId, productionId,
      [sceneB, sceneA], 7));
  });

  it('applies one approval change to a multi-selected set of Shots', async () => {
    studio('/?tool=Shots&scene=' + sceneA);
    fireEvent.click(await screen.findByLabelText('Select shot 1: Establish'));
    expect(await screen.findByText('1 Shot selected')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Approval'), { target: { value: 'approved' } });
    await waitFor(() => expect(productionService.setStudioApproval).toHaveBeenCalledWith(workspaceId, productionId, 'shot', shotA, 'approved', 1));
    expect(await screen.findByText(/Updated 1 Shot\(s\) with the same change\./)).toBeVisible();
  });

  it('reports a conflict instead of pretending the write succeeded', async () => {
    vi.mocked(productionService.updateStudioScene).mockRejectedValueOnce(new AppError('conflict', 'That scene changed since you loaded it'));
    studio('/?tool=Scenes&scene=' + sceneA);
    fireEvent.change(await screen.findByLabelText('Title', { selector: '#scene-edit-title' }), { target: { value: 'Stale edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Scene' }));
    expect(await screen.findByText('That scene changed since you loaded it')).toBeVisible();
    expect(await screen.findByText(/Reload before applying your change\./)).toBeVisible();
  });

  it('surfaces a locked Scene error from the database rather than silently ignoring it', async () => {
    vi.mocked(productionService.updateStudioScene).mockRejectedValueOnce(new AppError('conflict', 'That scene is locked. Unlock it before editing.'));
    studio('/?tool=Scenes&scene=' + sceneA);
    fireEvent.change(await screen.findByLabelText('Title', { selector: '#scene-edit-title' }), { target: { value: 'Locked edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Scene' }));
    expect(await screen.findByText('That scene is locked. Unlock it before editing.')).toBeVisible();
  });

  it('shows changed-after-approval when approved content is edited', async () => {
    vi.mocked(productionService.updateStudioShot).mockResolvedValueOnce({ shot_id: shotA, revision: 3, approval: 'changed_after_approval', timing: model().timing });
    studio('/?tool=Shots&scene=' + sceneA + '&shot=' + shotA);
    fireEvent.change(await screen.findByLabelText('Title', { selector: '#shot-edit-title' }), { target: { value: 'Tighter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Shot' }));
    expect(await screen.findByText(/it is now Changed After Approval - review it again\./)).toBeVisible();
  });
});

describe('Director scope', () => {
  it('scopes a direction to the selected Shot only', async () => {
    vi.mocked(productionService.directorCommandPreview).mockResolvedValue({
      kind: 'shot_intensity', scope: 'shot', confidence: 'high', rationale: 'I will make this Shot more tense.',
      operations: ['intensify_shot'], signals: ['shot'], reference_role: null, target_runtime_ms: null, scene_order: 1,
    });
    studio('/?tool=Shots&scene=' + sceneA + '&shot=' + shotA);
    expect(await screen.findByText(/Scope: Shot “Establish” in Scene 1 · REAL PRODUCTION face\./)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Message to the Director'), { target: { value: 'Make this Shot more tense.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
    expect(await screen.findByText(/I will make this Shot more tense\./)).toBeVisible();
    expect(productionService.directorCommandPreview).toHaveBeenCalledWith(workspaceId, productionId, 'Make this Shot more tense.');
  });

  it('falls back to Production scope when nothing is selected', async () => {
    studio('/?tool=Scenes&scene=' + '__none__');
    expect(await screen.findByText(/Scope: whole Production · REAL PRODUCTION face\./)).toBeVisible();
  });

  it('targets a whole Scene when a Scene, not a Shot, is selected', async () => {
    studio('/?tool=Scenes&scene=' + sceneB);
    expect(await screen.findByText(/Scope: Scene “Weighing” · REAL PRODUCTION face\./)).toBeVisible();
    expect(screen.getByLabelText('Message to the Director')).toHaveAttribute('placeholder', '“Make Scene 1 more intense.”');
  });
});

describe('Script to Scene synchronization', () => {
  // §33: a Script Scene selects the canonical Scene. There is no Script-only Scene universe.
  it('selects the canonical Scene when a Script Scene is chosen, without leaving the Script tool', async () => {
    vi.mocked(productionService.directorStudioSurface).mockResolvedValue({
      ...directorSurface(),
      scenes: [
        { id: sceneA, order: 1, title: 'Dark kitchen', purpose: 'Earn attention', story_beat: 'Hook', description: 'A dark kitchen.',
          action_lines: ['The kettle clicks off.'], characters: ['Barista'], environment: 'Kitchen', products: ['Ridgeway beans'],
          techniques: [], shots: [], dialogue_notes: '', planned_duration_ms: 12000, opening_state: '', ending_state: '',
          visual_intent: '', dialogue: [{ id: 'line-1', scene_id: sceneA, kind: 'dialogue', speaker: 'Barista', content: 'Still warm.', intention: '', delivery: '', subtext: '', duration_ms: 1500, pause_after_ms: null, flags: {} }] },
        { id: sceneB, order: 2, title: 'Weighing', purpose: 'Prove the promise', story_beat: 'Turn', description: 'The scale settles.',
          action_lines: [], characters: [], environment: 'Kitchen', products: [], techniques: [], shots: [], dialogue_notes: '',
          planned_duration_ms: 18000, opening_state: '', ending_state: '', visual_intent: '', dialogue: [] },
      ],
    });
    const router = studio('/?tool=Script&scene=' + sceneA);
    fireEvent.click(await screen.findByRole('button', { name: 'Weighing' }));
    await waitFor(() => expect(router.state.location.search).toContain('scene=' + sceneB));
    // The canonical selection moved; switching to Shots proves the same Scene is active.
    fireEvent.click(screen.getByRole('button', { name: 'Shots' }));
    expect(await screen.findByRole('heading', { name: /Shots in Scene 2: Weighing/ })).toBeVisible();
  });
});

// §105: the Prompt 4 intelligence the Director produced must remain visible and usable
// inside Studio. These canvases read the same persisted surface, not a copy.
describe('Prompt 4 intelligence inside Studio', () => {
  const brief = {
    production_goal: 'Sell Ridgeway beans to commuters', audience: 'Urban commuters', core_message: 'Still warm when you get there',
    desired_response: 'Try Ridgeway', production_type: 'commercial', format: '30s vertical', platform: 'social', aspect_ratio: '9:16',
    tone: ['warm'], creative_concept: 'A dark kitchen that turns into a morning', story_approach: 'product_first',
    dialogue_mode: 'sparse', dialogue_approach: 'A single line.', voiceover_approach: null, product_brand: 'Ridgeway',
    product_category: null, call_to_action: 'Find Ridgeway', style_direction: ['one soft source'], execution_preference: 'real',
    resources: [], crew_size: 1, available_hours: 4, deadline: null, budget_amount: null, cast: ['Barista'],
    environments: ['Kitchen'], deliverables: ['30s master'], hard_constraints: ['one camera'], soft_preferences: [],
    collaboration_mode: 'solo', producer: 'deterministic', revision: 1,
    runtime: { kind: 'exact', exact_ms: 30000, min_ms: null, max_ms: null, note: '30 seconds' },
    style_dna: null, assumptions: [], open_decisions: [], conflicts: [],
  } as unknown as NonNullable<DirectorStudio['brief']>;
  const story = {
    title: 'Morning, weighed', logline: 'One barista proves freshness before sunrise.', premise: 'The scale settles on the beans.',
    central_question: 'Is it fresh?', protagonist: 'Barista', desire: 'Serve it warm', conflict: 'Time', stakes: 'The promise',
    hook: 'Dark kitchen', payoff: 'Steam rises', call_to_action: 'Find Ridgeway', beats: [], emotional_progression: [],
    beginning: 'Dark', middle: 'Weighing', ending: 'Steam', theme: 'craft', grammar: 'trailer', variation: 'base',
    dialogue_mode: 'sparse', dialogue_approach: null, runtime_ms: 30000, producer: 'deterministic', assumptions: [],
  } as unknown as NonNullable<DirectorStudio['story']>;
  const reality = {
    feasibility: 'ready' as const, complexity: 'simple' as const, items: [], domains: { light: 'sufficient' },
    conflicts: [], adaptations: [], summary: 'Shootable with one camera and one light.', inventory_used: [], notes: [],
  };
  beforeEach(() => {
    vi.mocked(productionService.directorStudioSurface).mockResolvedValue({
      ...directorSurface(), brief, brief_revision: 1, brief_producer: 'deterministic', story, story_producer: 'deterministic', reality,
    });
  });

  it('shows the persisted Brief, Story and Reality Check the Director produced', async () => {
    const router = studio('/?tool=Brief');
    expect(await screen.findByRole('form', { name: 'Intelligent Brief' })).toBeVisible();
    expect(screen.getByLabelText('Production goal')).toHaveValue('Sell Ridgeway beans to commuters');
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(await screen.findByText(/One barista proves freshness before sunrise\./)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reality Check' }));
    expect(await screen.findByText(/Shootable with one camera and one light\./)).toBeVisible();
    // The tool survives in the URL, and the deep-link repair names the first Scene
    // rather than leaving the Studio scoped to nothing.
    await waitFor(() => expect(router.state.location.search).toContain('tool=Reality+Check'));
    expect(router.state.location.search).toContain('scene=' + sceneA);
  });
});

// §106: REAL and AI are faces of one Master Production, not two Productions.
describe('Real and AI execution faces', () => {
  it('keeps the same canonical Scenes and Shots when the face changes', async () => {
    const router = studio('/?tool=Scenes');
    await screen.findByRole('heading', { name: 'Scenes' });
    expect(productionService.studioSurface).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'AI CREATION' }));
    expect(screen.getByRole('button', { name: 'AI CREATION' })).toHaveAttribute('aria-pressed', 'true');
    // The face change is a change of execution tooling only: the wording says so, and the
    // Production, Scene selection and Shot selection are untouched.
    expect(screen.getByText(/Switching faces never changes the Production, Scene or Shot\./)).toBeVisible();
    expect(screen.getByText(/AI CREATION \/ SCENES/)).toBeVisible();
    // One read model, one Production: switching face does not create a second Production.
    expect(productionService.studioSurface).toHaveBeenCalledTimes(1);
    expect(router.state.location.search).toContain('tool=Scenes');
    expect(router.state.location.search).toContain(`scene=${sceneA}`);
  });
});

// §64/§140: the Studio REAL face opens the practical execution canvas for the selected Shot.
describe('Real Production tool inside Studio', () => {
  const realShot = {
    shot_id: shotA, scene_id: sceneA, scene_order: 1, scene_title: 'Dark kitchen', order: 1, title: 'Establish',
    purpose: 'establish', subject: 'Kettle', framing: 'medium', execution_method: 'real' as const,
    approval: 'draft' as const, locked: false, planned_duration_ms: 12000, expected_duration_ms: 12000,
    plan_id: 'plan-1', plan_revision: 1, plan_status: 'ready' as const, readiness: 'ready' as const,
    readiness_note: 'All requirements are owned.', complexity: 'quick' as const, camera_resource_id: null,
    lens_resource_id: null, movement: 'locked', stabilization: 'tripod', lighting_intent: 'soft premium',
    sound_plan: 'lav plus scratch', solo_feasibility: 'solo' as const, crew_roles: [], safety_flags: [],
    requirements: { owned: 0, substitute: 0, missing: 0, unverified: 0 }, capture: null,
    takes: { count: 0, preferred_take_id: null }, deviations: 0,
  };
  beforeEach(() => {
    vi.mocked(productionService.realSurface).mockResolvedValue({
      production: { id: productionId, workspace_id: workspaceId, title: 'Ridgeway coffee', production_type: 'commercial',
        execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active' },
      execution_faces: ['real', 'ai'], setup: [], timing: model().timing,
      scenes: [{ scene_id: sceneA, order: 1, title: 'Dark kitchen', shots: 1, ready: 1, unresolved: 0, captured: 0, pickup_needed: 0, complexity: 'quick', unresolved_note: null }],
      shots: [realShot],
      summary: { shots: 1, planned: 1, unplanned: 0, ready: 1, ready_with_substitution: 0, needs_decision: 0, missing_resource: 0,
        safety_blocked: 0, captured: 0, pickup_needed: 0, in_progress: 0, approved_plans: 0, changed_after_approval: 0,
        crew_roles: [], safety_flags: [], complexity: 'quick' },
      readiness_queue: { ready_to_shoot: [shotA], needs_decision: [], missing_resource: [], pickup_required: [] },
      provider: model().provider,
      capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', setup_matching: true, take_logging: true, on_set_mode: true, ai_prompt_compilation: false, note: 'Setup matching is deterministic.' },
    });
    vi.mocked(productionService.realShotDetail).mockResolvedValue({
      shot: { shot_id: shotA, scene_id: sceneA, title: 'Establish', purpose: 'establish', subject: 'Kettle', framing: 'medium',
        movement: 'locked', execution_method: 'real', approval: 'draft', locked: false, revision: 3, planned_duration_ms: 12000,
        story_beat: 'Hook', creative_notes: '' },
      scene: { scene_id: sceneA, title: 'Dark kitchen', order: 1, purpose: 'Earn attention', description: 'A dark kitchen.', environment_asset_id: null },
      plan: null, readiness: 'unplanned', requirements: [], alternatives: [], capture: null, takes: [], deviations: [],
      setup: [], brief: null, script_line: null,
    });
  });

  it('opens the practical Real canvas and links to On-Set Mode', async () => {
    const router = studio('/?tool=Real Production&scene=' + sceneA + '&shot=' + shotA);
    expect(await screen.findByRole('region', { name: 'Real Production' })).toBeVisible();
    expect(productionService.realSurface).toHaveBeenCalledWith(workspaceId, productionId);
    expect(productionService.realShotDetail).toHaveBeenCalledWith(workspaceId, productionId, shotA);
    expect(await screen.findByText('No Real plan yet')).toBeVisible();
    for (const link of screen.getAllByRole('link', { name: /On-Set Mode/ }))
      expect(link).toHaveAttribute('href', `/on-set/${productionId}`);
    expect(router.state.location.search).toContain('tool=Real+Production');
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });
