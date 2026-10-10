import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioComposition } from '../pages/StudioPage';
import { productionService, type DirectorBrief, type DirectorStory, type DirectorStudio, type StudioReadModel, type StudioScene } from '../services/productions';
import { productionContinuityService } from '../services/productionContinuity';
import { longFormService } from '../services/longForm';
import type { Production } from '../types/domain';

vi.mock('../services/productions', () => ({
  PAGE_SIZE: 40,
  productionService: {
    get: vi.fn(), saveTitle: vi.fn(), directorStudioSurface: vi.fn(), directorCommand: vi.fn(),
    directorCommandPreview: vi.fn(), directorStoryAlternatives: vi.fn(), productionAudioSurface: vi.fn(),
    studioSurface: vi.fn(), createStudioScene: vi.fn(), updateStudioScene: vi.fn(), reorderStudioScenes: vi.fn(),
    archiveStudioScene: vi.fn(), createStudioShot: vi.fn(), updateStudioShot: vi.fn(), moveStudioShot: vi.fn(),
    reorderStudioShots: vi.fn(), archiveStudioShot: vi.fn(), setStudioApproval: vi.fn(), setStudioLock: vi.fn(),
    reconcileStudioRuntime: vi.fn(),
    realSurface: vi.fn(), realShotDetail: vi.fn(), directRealShot: vi.fn(), directRealScene: vi.fn(),
    saveRealPlan: vi.fn(), setRealPlanApproval: vi.fn(), setRealPlanLock: vi.fn(),
    setShotCaptureState: vi.fn(), saveShotTake: vi.fn(), deleteShotTake: vi.fn(), recordShotDeviation: vi.fn(),
    aiSurface: vi.fn(), aiShotDetail: vi.fn(), directAiShot: vi.fn(), saveAiPlan: vi.fn(),
    setAiPlanApproval: vi.fn(), setAiPlanLock: vi.fn(), confirmAiCost: vi.fn(),
    createAiAttempt: vi.fn(), updateAiAttempt: vi.fn(), selectAiResult: vi.fn(),
    aiBatchPreview: vi.fn(), createAiBatch: vi.fn(), recordAiBatchItem: vi.fn(), aiHybridDecision: vi.fn(),
  },
}));
vi.mock('../services/longForm', () => ({
  longFormService: {
    structure: vi.fn(), summaries: vi.fn(), setApproval: vi.fn(), setLock: vi.fn(), reorder: vi.fn(),
    createAct: vi.fn(), createSequence: vi.fn(), split: vi.fn(), moveScene: vi.fn(),
    saveSummary: vi.fn(), search: vi.fn(), directorScope: vi.fn(),
  },
}));
vi.mock('../services/productionContinuity', () => ({
  productionContinuityService: { summary: vi.fn(), findings: vi.fn(), check: vi.fn() },
}));
vi.mock('../services/productionShotMatch', () => {
  const fail = vi.fn(async () => { throw new Error('unavailable in this test'); });
  return {
    productionShotMatchService: {
      vocabulary: fail, results: fail, reports: fail, result: fail, report: fail,
      setResultState: vi.fn(), analyze: fail, decide: fail,
      proposeCorrection: fail, applyCorrection: fail, rejectCorrection: fail,
    },
  };
});

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneA = '00000000-0000-4000-8000-000000000010';
const shotA = '00000000-0000-4000-8000-000000000014';

const production: Production = {
  id: productionId, workspace_id: workspaceId, project_id: '00000000-0000-4000-8000-000000000001', title: 'Ridgeway coffee',
  production_type: 'commercial', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft',
  locked_at: null, planned_duration_ms: 30000, calculated_duration_ms: null, start_ms: 0, end_ms: null,
  created_by: '00000000-0000-4000-8000-000000000001',
  revision: 7, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
};

const shot = {
  id: shotA, scene_id: sceneA, order: 1, sort_order: 1024, title: 'Establish', description: 'Macro on the scale.', action: '',
  purpose: 'establish', subject: 'Scale', framing: 'wide', angle: 'eye level', movement: 'slow push',
  composition: 'centred', transition: 'cut', story_relationship: 'proves the promise', story_beat: 'Hook',
  creative_notes: '', execution_method: 'real' as const, planned_duration_ms: 12000, approval: 'draft' as const,
  locked_at: null, revision: 1, updated_at: '2026-10-05T00:00:00Z', result_count: 2, bindings: [],
};
const scene: StudioScene = {
  id: sceneA, order: 1, sort_order: 1024, title: 'Dark kitchen', purpose: 'Earn attention', story_beat: 'Hook',
  description: 'A dark kitchen.', action_lines: [], opening_state: 'Empty counter.', ending_state: 'Kettle silent.',
  visual_intent: 'One soft source.', dialogue_notes: '', environment_asset_id: null,
  planned_duration_ms: 12000, duration_ms: 12000, timing: 'derived', approval: 'draft', locked_at: null,
  revision: 1, updated_at: '2026-10-05T00:00:00Z', character_asset_ids: [], dialogue_lines: 0, shot_count: 1,
  bindings: [], shots: [shot],
};

const readModel = (): StudioReadModel => ({
  production: {
    id: productionId, workspace_id: workspaceId, title: 'Ridgeway coffee', production_type: 'commercial', custom_type: null,
    execution_method: 'real', planned_duration_ms: 30000, calculated_duration_ms: 30000, approval: 'draft',
    locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z',
  },
  scenes: [scene], orphan_shots: [], assets: [], documents: {},
  timing: { total_ms: 12000, target_ms: 30000, delta_ms: -18000, status: 'under', scene_states: [{ scene_id: sceneA, order: 1024, duration_ms: 12000, shots: 1, timing: 'derived' }] },
  runtime_conflict: false,
  timeline: [{ scene_id: sceneA, order: 1, title: 'Dark kitchen', duration_ms: 12000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotA, order: 1, title: 'Establish', duration_ms: 12000, execution_method: 'real', approval: 'draft', locked: false }] }],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 1, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 2 }, needs_attention: 1 },
  truncated: false,
  provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' },
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: false, ai_prompt_compilation: false, note: 'Later prompts deepen execution.' },
});

const brief = {
  production_goal: 'A 30-second premium coffee commercial', audience: 'Home brewers', core_message: 'Slow craft',
  desired_response: 'Trust', production_type: 'commercial', format: '16:9', platform: 'YouTube', aspect_ratio: '16:9',
  tone: ['warm'], creative_concept: 'Dawn in the roastery', story_approach: 'Question to payoff', dialogue_mode: null,
  dialogue_approach: null, voiceover_approach: null, product_brand: 'North Bean', product_category: 'coffee',
  call_to_action: null, style_direction: [], execution_preference: 'real', resources: ['one camera'], crew_size: 1,
  available_hours: 4, deadline: null, budget_amount: null, cast: [], environments: [], deliverables: [],
  hard_constraints: ['one location'], soft_preferences: [], collaboration_mode: 'stop_at_major_decisions',
  producer: 'deterministic', revision: 2,
  runtime: { kind: 'exact', exact_ms: 30000, min_ms: null, max_ms: null, note: '' },
  style_dna: null, assumptions: [], open_decisions: [], conflicts: [],
} as unknown as DirectorBrief;

const story = {
  title: 'North Bean — Slow Craft', logline: 'Steam and light.', premise: 'Craft takes time.', central_question: 'Can slow win?',
  protagonist: 'Barista', desire: 'A perfect cup', conflict: 'The clock', stakes: 'Reputation', hook: 'Steam', payoff: 'First sip',
  call_to_action: null, emotional_progression: ['calm'], beginning: 'Darkness', middle: 'Work', ending: 'Sip', theme: null,
  grammar: 'linear', variation: 'original', dialogue_mode: null, dialogue_approach: null, runtime_ms: 30000,
  producer: 'deterministic', assumptions: [],
  beats: [{ id: 'beat-1', order: 1, name: 'Hook', story_function: 'open', content: 'Steam curls.', emotion: 'calm', visual_idea: '', techniques: [], planned_duration_ms: 12000 }],
} as unknown as DirectorStory;

const surface = (): DirectorStudio => ({
  production: { id: productionId, title: 'Ridgeway coffee', production_type: 'commercial', execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 7 },
  brief, brief_revision: 2, brief_producer: 'deterministic', story, story_variation: 'original', story_producer: 'deterministic',
  scenes: [], runtime_fit: { target_ms: 30000, assigned_ms: 12000, dialogue_ms: 0, action_ms: 12000, slack_ms: 18000, status: 'under' },
  documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false,
  references: [{ reference_id: 'ref-1', source_type: 'url', source_url: 'https://example.test/film', source_description: 'Reference film', source_identity: 'Example film', source_provider: 'example', identity_provenance: 'source_metadata', source_identity_verified_at: null, creator_purpose: 'Learn pacing', learning_targets: ['pacing'], revision: 1, shaping_ready: true, rights_classification: 'third_party_inspiration', state: 'ready', role: 'inspiration', capability: { capability: 'metadata', media_bytes: '0', modalities: {}, note: '', producer: 'deterministic' }, status: 'ready', stages: [], summary: '', producer: 'deterministic', findings: [], techniques: [], style: {}, causal: [], adaptation_notes: [], limitations: [] }],
  techniques: [], decisions: [], operations: [],
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
  vi.mocked(productionService.studioSurface).mockResolvedValue(readModel());
  vi.mocked(productionService.directorStudioSurface).mockResolvedValue(surface());
  vi.mocked(productionService.updateStudioShot).mockResolvedValue({ shot_id: shotA, revision: 2, approval: 'draft', timing: readModel().timing });
  vi.mocked(productionService.directorStoryAlternatives).mockResolvedValue({
    selected_story: story,
    alternatives: [{ ...story, title: 'Alt direction', variation: 'emotional', logline: 'An emotional take.' }],
    note: 'Three directions explored.',
  });
  vi.mocked(productionService.directorCommand).mockResolvedValue({
    command: { kind: 'story', scope: 'production', confidence: 'high', rationale: 'Use the emotional variation.', operations: [], signals: [], scene_order: null, reference_role: null, target_runtime_ms: null, parameters: {} },
    rationale: 'Emotional variation', answer: null, changes: ['Story regenerated'], operations: [], limitations: [], causal: [],
    story_alternatives: [], line_alternatives: {}, reference_role: null, adaptations_applied: [], plan: null, producer: 'deterministic',
    applied: { production_id: productionId, operation_id: 'op-1', idempotent: false, production_revision: 8 },
  });
  vi.mocked(productionService.productionAudioSurface).mockResolvedValue({ audio_plan: null, scene_directions: [] });
  vi.mocked(productionService.directorCommandPreview).mockResolvedValue({
    kind: 'story', scope: 'production', confidence: 'high', rationale: 'Preview.', operations: [],
    signals: [], reference_role: null, target_runtime_ms: null, scene_order: null,
  });
  vi.mocked(productionService.realSurface).mockResolvedValue({
    production: { id: productionId, workspace_id: workspaceId, title: 'Ridgeway coffee', production_type: 'commercial',
      execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active' },
    execution_faces: ['real', 'ai'], setup: [], timing: readModel().timing,
    scenes: [{ scene_id: sceneA, order: 1, title: 'Dark kitchen', shots: 1, ready: 0, unresolved: 1, captured: 0, pickup_needed: 0, complexity: null, unresolved_note: null }],
    shots: [{ shot_id: shotA, scene_id: sceneA, scene_order: 1, scene_title: 'Dark kitchen', order: 1, title: 'Establish',
      purpose: 'establish', subject: 'Scale', framing: 'wide', execution_method: 'real', approval: 'draft', locked: false,
      planned_duration_ms: 12000, expected_duration_ms: 12000, plan_id: null, plan_revision: null, plan_status: null,
      readiness: 'unplanned', readiness_note: 'No plan yet.', complexity: null, camera_resource_id: null, lens_resource_id: null,
      movement: 'slow push', stabilization: '', lighting_intent: '', sound_plan: '', solo_feasibility: null, crew_roles: [], safety_flags: [],
      requirements: { owned: 0, substitute: 0, missing: 0, unverified: 0 }, capture: null, takes: { count: 0, preferred_take_id: null }, deviations: 0 }],
    summary: { shots: 1, planned: 0, unplanned: 1, ready: 0, ready_with_substitution: 0, needs_decision: 0, missing_resource: 0,
      safety_blocked: 0, captured: 0, pickup_needed: 0, in_progress: 0, approved_plans: 0, changed_after_approval: 0,
      crew_roles: [], safety_flags: [], complexity: null },
    readiness_queue: { ready_to_shoot: [], needs_decision: [], missing_resource: [], pickup_required: [] },
    provider: readModel().provider,
    capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', setup_matching: true, take_logging: true, on_set_mode: true, ai_prompt_compilation: false, note: '' },
  });
  vi.mocked(productionService.realShotDetail).mockResolvedValue({
    shot: { shot_id: shotA, scene_id: sceneA, title: 'Establish', purpose: 'establish', subject: 'Scale', framing: 'wide',
      movement: 'slow push', execution_method: 'real', approval: 'draft', locked: false, revision: 1, planned_duration_ms: 12000,
      story_beat: 'Hook', creative_notes: '' },
    scene: { scene_id: sceneA, title: 'Dark kitchen', order: 1, purpose: 'Earn attention', description: 'A dark kitchen.', environment_asset_id: null },
    plan: null, readiness: 'unplanned', requirements: [], alternatives: [], capture: null, takes: [], deviations: [],
    setup: [], brief: null, script_line: null,
  });
  vi.mocked(productionService.aiSurface).mockResolvedValue({
    production: { id: productionId, workspace_id: workspaceId, title: 'Ridgeway coffee', production_type: 'commercial',
      execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active' },
    execution_faces: ['real', 'ai'], connections: [], models: [], known_models: [], locks: [],
    scenes: [{ scene_id: sceneA, order: 1, title: 'Dark kitchen', shots: 1, ready: 0, blocked: 0, unplanned: 1, selected: 0 }],
    shots: [{ shot_id: shotA, scene_id: sceneA, title: 'Establish', purpose: 'establish', order: 1, execution_method: 'real',
      approval: 'draft', locked: false, revision: 1, planned_duration_ms: 12000, readiness: 'unplanned', plan_id: null,
      plan_revision: null, plan_status: null, prompt_version: null, prompt_stale: false, provider_target: null,
      model_profile_id: null, model_label: null, model_key: null, capability_state: null, cost_state: 'unknown',
      cost_amount: null, cost_currency: '', aspect_ratio: '16:9', expected_duration_ms: null, hybrid: null }],
    summary: { shots: 1, ai_or_hybrid: 0, real: 1, planned: 0, ready: 0, manual_export: 0, blocked: 0, stale: 0, with_selected_result: 0, connected_providers: 0, declared_models: 0 },
    capabilities: { prompt_compilation: true, model_routing: false, live_generation: false, manual_export: true, note: '' },
    provider: readModel().provider, live_generation: false, truthfulness: 'AI Creation directs external generation.',
  });
  vi.mocked(productionService.aiShotDetail).mockResolvedValue({
    shot: { shot_id: shotA, scene_id: sceneA, title: 'Establish', description: 'Macro on the scale.', action: '', purpose: 'establish',
      subject: 'Scale', framing: 'wide', angle: 'eye level', movement: 'slow push', composition: 'centred', transition: 'cut',
      story_relationship: 'proves the promise', story_beat: 'Hook', creative_notes: '', execution_method: 'real', approval: 'draft',
      locked: false, revision: 1, planned_duration_ms: 12000 },
    scene: { scene_id: sceneA, title: 'Dark kitchen', order: 1, purpose: 'Earn attention', description: 'A dark kitchen.', environment_asset_id: null },
    readiness: 'unplanned', plan: null, real_plan: null, references: [], locks: [], attempts: [], selected_result: null, batch_items: [], script_line: null,
  });
  vi.mocked(productionContinuityService.summary).mockResolvedValue({
    live_states: 2, retired_states: 0, subject_count: 1, domains: [], check: null,
    findings: { open: 1, acknowledged: 0, critical_open: 0 }, analysis_stale: false, limitations: '',
  });
  vi.mocked(productionContinuityService.findings).mockResolvedValue({
    items: [{ finding_id: 'f-1', kind: 'unexplained_change', severity: 'warning', domain: 'wardrobe', trait: 'cuff', subject_object_id: null, subject_label: null, earlier_state_id: null, later_state_id: null, scene_id: sceneA, shot_id: null, explanation: 'The cuff stain must persist into the interior shot.', suggested_resolution: 'Keep the stain.', origin: 'derived', epistemic: 'observed', confidence: 'high', evidence: [], state: 'open', check_id: null, created_at: '2026-10-05T00:00:00Z' }],
    total: 1, limit: 100, offset: 0, truncated: false, check: null, checks_available: 0, open_count: 1, note: '', limitation: '',
  });
  vi.mocked(productionContinuityService.check).mockResolvedValue({
    check_id: 'c-1', verdict: 'needs_review', counts: {}, finding_count: 1, state_count: 2, production_revision: 7,
    state_watermark: null, explanation: 'One open finding.', limitations: '', created_at: '2026-10-05T00:00:00Z', findings: [], rule: '', limitation: '',
  });
  vi.mocked(longFormService.structure).mockResolvedValue({
    production_id: productionId, production_revision: 7, structure_revision: 1, level: 'production',
    scope: { level: 'production', id: productionId, title: 'Ridgeway coffee' },
    breadcrumb: [{ level: 'production', id: productionId, title: 'Ridgeway coffee' }],
    breadcrumb_line: 'Ridgeway coffee', items: [], total: 0, limit: 50, offset: 0, truncated: false,
    lazy: 'One level at a time.', timing: {},
  });
  vi.mocked(longFormService.summaries).mockResolvedValue({ items: [], total: 0, truncated: false });
});

describe('Studio eight views', () => {
  it('offers all eight faces of the same Production on one rail', async () => {
    studio('/?tool=Scenes');
    await screen.findByRole('heading', { name: 'Scenes' });
    const rail = screen.getByRole('navigation', { name: 'Studio functions' });
    expect(rail.querySelectorAll('button').length).toBe(8);
    for (const name of ['Idea', 'Story', 'Script', 'Scenes', 'Shots', 'Produce', 'Results']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
  });

  it('opens the Idea Lab from the real Brief, explores directions and applies one', async () => {
    const router = studio('/?tool=Idea');
    expect(await screen.findByText('IDEA LAB · SEARCH + DIRECTION')).toBeVisible();
    expect(screen.getAllByText('A 30-second premium coffee commercial').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Example film')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Explore directions/ }));
    expect(await screen.findByText('Alt direction')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Use this direction/ }));
    await waitFor(() => expect(productionService.directorCommand).toHaveBeenCalledWith(workspaceId, productionId, expect.objectContaining({ apply: true })));
    fireEvent.click(screen.getByRole('button', { name: /Continue into Story/ }));
    await waitFor(() => expect(router.state.location.search).toContain('tool=Story'));
  });

  it('switches Produce, Edit and Hybrid through the top bar without leaving the Production', async () => {
    const router = studio('/?tool=Scenes');
    await screen.findByRole('heading', { name: 'Scenes' });
    fireEvent.click(screen.getByRole('button', { name: 'Produce' }));
    await waitFor(() => expect(router.state.location.search).toContain('tool=Real+Production'));
    fireEvent.click(screen.getByRole('button', { name: 'HYBRID' }));
    await waitFor(() => expect(router.state.location.search).toContain('tool=Hybrid'));
    expect(await screen.findByText('HYBRID · PER-SHOT STRATEGY')).toBeVisible();
    expect(screen.getByText(/1 Real · 0 AI · 0 Hybrid/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Audio and edit' }));
    await waitFor(() => expect(router.state.location.search).toContain('tool=Audio'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(router.state.location.search).toContain('tool=Movie+Mode'));
  });

  it('assigns per-Shot execution on the Hybrid board without splitting the Production', async () => {
    studio('/?tool=Hybrid');
    const select = await screen.findByRole('combobox', { name: 'Execution for Establish' });
    fireEvent.change(select, { target: { value: 'ai' } });
    await waitFor(() => expect(productionService.updateStudioShot).toHaveBeenCalledWith(
      workspaceId, productionId, shotA, expect.objectContaining({ execution_method: 'ai' })));
  });

  it('selects a Scene from the drawer and follows it in canvas, inspector and timeline', async () => {
    const router = studio('/?tool=Scenes');
    await screen.findByRole('heading', { name: 'Scenes' });
    fireEvent.click(await screen.findByRole('button', { name: /Scene 1 · Dark kitchen/ }));
    await waitFor(() => expect(router.state.location.search).toContain(`scene=${sceneA}`));
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
    expect(await screen.findByText('INSPECT · SCENE 1')).toBeVisible();
    expect(screen.getByText('Empty counter.')).toBeVisible();
  });

  it('inspects the selected Shot and surfaces scoped continuity findings honestly', async () => {
    studio(`/?tool=Shots&scene=${sceneA}&shot=${shotA}`);
    await screen.findByText('Selected Shot');
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
    expect(await screen.findByText('INSPECT · SHOT')).toBeVisible();
    expect(screen.getByText('Macro on the scale.', { selector: '.s8-info-value' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Continuity' }));
    expect(await screen.findByText(/cuff stain must persist/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Run continuity check/ }));
    await waitFor(() => expect(productionContinuityService.check).toHaveBeenCalledWith(workspaceId, productionId, 'Run from Studio inspector.'));
  });

  it('shows Result evidence on the Results drawer and the timeline', async () => {
    studio('/?tool=Results');
    expect(await screen.findByRole('button', { name: /Establish.*2 Results/ })).toBeVisible();
    expect(screen.getAllByText(/2 Results/).length).toBeGreaterThanOrEqual(2);
  });
});
