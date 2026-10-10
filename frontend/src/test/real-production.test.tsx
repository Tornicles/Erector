import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/AuthContext';
import { OnSetPage } from '../pages/OnSetPage';
import { RealProductionCanvas } from '../studio/RealProduction';
import {
  productionService, type RealCaptureState, type RealPlan, type RealRequirement, type RealShotDetail,
  type RealSurface, type StudioReadModel, type StudioTiming,
} from '../services/productions';

vi.mock('../services/productions', () => ({
  PAGE_SIZE: 40,
  productionService: {
    realSurface: vi.fn(), realShotDetail: vi.fn(), directRealShot: vi.fn(), directRealScene: vi.fn(),
    saveRealPlan: vi.fn(), setRealPlanApproval: vi.fn(), setRealPlanLock: vi.fn(),
    setShotCaptureState: vi.fn(), saveShotTake: vi.fn(), deleteShotTake: vi.fn(), recordShotDeviation: vi.fn(),
  },
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneId = '00000000-0000-4000-8000-000000000010';
const shotA = '00000000-0000-4000-8000-000000000014';
const shotB = '00000000-0000-4000-8000-000000000015';

const CAMERA = '00000000-0000-4000-8000-0000000000a1';
const LENS_35 = '00000000-0000-4000-8000-0000000000a2';
const LENS_50 = '00000000-0000-4000-8000-0000000000a3';
const TRIPOD = '00000000-0000-4000-8000-0000000000a4';
const LED = '00000000-0000-4000-8000-0000000000a5';
const SOFTBOX = '00000000-0000-4000-8000-0000000000a6';
const LAV = '00000000-0000-4000-8000-0000000000a7';
const MYSTERY = '00000000-0000-4000-8000-0000000000a8';

const setup = [
  { id: CAMERA, resource_type: 'camera', name: 'Solo camera body', manufacturer: 'Aperture', model: 'S1', mount: 'AF', stabilization: true, metadata: {} },
  { id: LENS_35, resource_type: 'lens', name: '35 mm lens', manufacturer: 'Aperture', model: '35/1.8', mount: 'AF', stabilization: null, metadata: {} },
  { id: LENS_50, resource_type: 'lens', name: '50 mm lens', manufacturer: 'Aperture', model: '50/1.8', mount: 'AF', stabilization: null, metadata: {} },
  { id: TRIPOD, resource_type: 'support', name: 'Tripod', manufacturer: null, model: null, mount: null, stabilization: true, metadata: {} },
  { id: LED, resource_type: 'light', name: 'Amaran 100d', manufacturer: 'Amaran', model: '100d', mount: null, stabilization: null, metadata: {} },
  { id: SOFTBOX, resource_type: 'modifier', name: '90 cm softbox', manufacturer: null, model: null, mount: null, stabilization: null, metadata: {} },
  { id: LAV, resource_type: 'microphone', name: 'Lav mic', manufacturer: null, model: null, mount: null, stabilization: null, metadata: {} },
  { id: MYSTERY, resource_type: 'camera', name: 'Random Brand X Light', manufacturer: null, model: null, mount: null, stabilization: null, metadata: {} },
];

function timing(): StudioTiming {
  return { total_ms: 30000, target_ms: 30000, delta_ms: 0, status: 'fits', scene_states: [{ scene_id: sceneId, order: 1024, duration_ms: 30000, shots: 2, timing: 'derived' }] };
}

function model(): StudioReadModel {
  return {
    production: {
      id: productionId, workspace_id: workspaceId, title: 'Ridgeway coffee', production_type: 'commercial', custom_type: null,
      execution_method: 'real', planned_duration_ms: 30000, calculated_duration_ms: 30000, approval: 'draft',
      locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z',
    },
    scenes: [], orphan_shots: [], assets: [], documents: {}, timing: timing(),
    runtime_conflict: false, timeline: [],
    status_summary: { production_approval: 'draft', production_locked: false, scenes: 0, shots: 0, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 0 }, needs_attention: 0 },
    truncated: false,
    provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' },
    capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: false, note: 'Real execution planning is available.' },
  };
}

function surface(overrides: Partial<RealSurface> = {}): RealSurface {
  const base: RealSurface = {
    production: {
      id: productionId, workspace_id: workspaceId, title: 'Ridgeway coffee', production_type: 'commercial',
      execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active',
    },
    execution_faces: ['real', 'ai'], setup, timing: timing(),
    scenes: [{ scene_id: sceneId, order: 1, title: 'Dark kitchen', shots: 2, ready: 2, unresolved: 0, captured: 1, pickup_needed: 0, complexity: 'quick', unresolved_note: null }],
    shots: [shotSummary(shotA, 1, 'Establish', {}), shotSummary(shotB, 2, 'Kettle pours', {})],
    summary: {
      shots: 2, planned: 2, unplanned: 0, ready: 2, ready_with_substitution: 0, needs_decision: 0, missing_resource: 0,
      safety_blocked: 0, captured: 1, pickup_needed: 0, in_progress: 1, approved_plans: 0, changed_after_approval: 0,
      crew_roles: [], safety_flags: [], complexity: 'quick',
    },
    readiness_queue: { ready_to_shoot: [shotA], needs_decision: [], missing_resource: [], pickup_required: [] },
    provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' },
    capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', setup_matching: true, take_logging: true, on_set_mode: true, ai_prompt_compilation: false, note: 'Setup matching is deterministic.' },
  };
  return { ...base, ...overrides };
}

function shotSummary(shotId: string, order: number, title: string, overrides: Record<string, unknown>) {
  return {
    shot_id: shotId, scene_id: sceneId, scene_order: 1, scene_title: 'Dark kitchen', order, title,
    purpose: 'establish', subject: 'Kettle', framing: 'medium', execution_method: 'real' as const,
    approval: 'draft' as const, locked: false, planned_duration_ms: 15000, expected_duration_ms: 15000,
    plan_id: 'plan-' + shotId, plan_revision: 1, plan_status: 'ready' as const, readiness: 'ready' as const,
    readiness_note: 'All requirements are owned.', complexity: 'quick' as const, camera_resource_id: CAMERA,
    lens_resource_id: LENS_35, movement: 'locked', stabilization: 'tripod', lighting_intent: 'soft premium',
    sound_plan: 'lav plus scratch', solo_feasibility: 'solo' as const, crew_roles: [], safety_flags: [],
    requirements: { owned: 4, substitute: 0, missing: 0, unverified: 0 },
    capture: null, takes: { count: 0, preferred_take_id: null }, deviations: 0,
    ...overrides,
  };
}

function plan(overrides: Partial<RealPlan> = {}): RealPlan {
  return {
    plan_id: 'plan-1', shot_id: shotA, approval: 'draft', locked: false, revision: 1, plan_status: 'ready',
    readiness_note: 'Every requirement is owned.', complexity: 'quick', complexity_is_estimate: true,
    generated_by: 'engine', camera_resource_id: CAMERA, lens_resource_id: LENS_35, shot_size: 'medium close-up',
    camera_position: 'Eye level, 1.6 m from the counter, slightly off-axis.', camera_height: 'eye level',
    camera_angle: '30 degrees off-axis', framing: 'medium close-up', composition: 'product on the lower third',
    perspective_note: 'Perspective comes from camera distance, not the lens alone.', movement: 'locked',
    movement_purpose: 'Stillness lets the steam movement carry the frame.', stabilization: 'tripod',
    capture_fps: '24', delivery_fps: '24', shutter: '1/48', aperture: 'f/2.8–f/4 starting point', iso_range: 'ISO 400–800 starting range',
    white_balance: '5600 K, fixed for continuity', nd_filter: 'ND 3 stop if the window is in frame', exposure_note: 'Starting point only; check on the monitor.',
    focus_strategy: 'Manual, focus on the kettle spout, then lock.', depth_of_field: 'Shallow enough to separate the kettle.',
    lighting_intent: 'Soft premium beauty', lighting_plan: 'Amaran 100d through the 90 cm softbox at 45 degrees camera-left, bounced into the wall for fill.',
    lighting_diagram: {}, blocking: 'Hand enters from frame left, sets the kettle down on the mark, then stills.',
    performance: 'Start restrained, hold for one beat after the pour, then let the shoulders drop.',
    product_direction: 'Label stays square to camera; wipe the glass before the take.',
    sound_plan: 'Lav on the talent for the pour; camera mic as scratch only.', microphone_plan: 'Lav first, camera scratch',
    sync_strategy: 'Clap in frame so the scratch audio can be aligned.', solo_feasibility: 'solo', crew_roles: [],
    environment_requirements: [], location_requirements: ['A clean countertop with room for the camera behind it.'],
    safety_notes: [], safety_flags: [], editorial_intent: 'establishing',
    setup_steps: ['Mount the camera on the tripod'], capture_checklist: ['Camera mounted', 'Battery and card checked', 'White balance set'],
    expected_duration_ms: 15000, ...overrides,
  };
}

function requirement(overrides: Partial<RealRequirement>): RealRequirement {
  return {
    id: 'req-1', kind: 'lens', label: 'Lens', ideal_name: '85 mm lens', detail: 'Compressed perspective for the product.',
    alternative: 'Move the camera closer with the 50 mm while keeping the framing.', status: 'substitute',
    epistemic: 'RECOMMENDED', resource_type: 'lens', resource_id: null, substitute_resource_id: LENS_50,
    resource_name: null, substitute_name: '50 mm lens', sort_order: 0, ...overrides,
  };
}

function detail(overrides: Partial<RealShotDetail> = {}): RealShotDetail {
  return {
    shot: {
      shot_id: shotA, scene_id: sceneId, title: 'Establish', purpose: 'establish', subject: 'Kettle',
      framing: 'medium', movement: 'locked', execution_method: 'real', approval: 'draft', locked: false,
      revision: 3, planned_duration_ms: 15000, story_beat: 'Hook', creative_notes: '',
    },
    scene: { scene_id: sceneId, title: 'Dark kitchen', order: 1, purpose: 'Earn attention', description: 'A dark kitchen.', environment_asset_id: null },
    plan: plan(), readiness: 'ready', requirements: [], alternatives: [], capture: null,
    takes: [], deviations: [], setup, brief: null, script_line: null, ...overrides,
  };
}

function renderCanvas(props: Partial<React.ComponentProps<typeof RealProductionCanvas>> = {}) {
  const onSelectShot = props.onSelectShot ?? vi.fn();
  const onChanged = props.onChanged ?? vi.fn();
  const element = <RealProductionCanvas workspaceId={workspaceId} productionId={productionId} model={model()}
    timing={timing()} surface={null} busy={false} onSelectShot={onSelectShot} onChanged={onChanged} {...props} />;
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
  return { onSelectShot, onChanged };
}

async function openFirstShot() {
  await screen.findByRole('heading', { name: 'Ridgeway coffee' });
  const buttons = await screen.findAllByRole('button', { name: /Open the Real plan/ });
  fireEvent.click(buttons[0]);
  await screen.findByRole('heading', { name: 'Establish' });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(productionService.realSurface).mockResolvedValue(surface());
  vi.mocked(productionService.realShotDetail).mockResolvedValue(detail());
  vi.mocked(productionService.saveShotTake).mockImplementation(async (_w, _p, _s, input) => ({
    take_id: 'take-' + input.take_number, shot_id: shotA, take_number: input.take_number,
    status: input.status ?? 'recorded', notes: input.notes ?? '', preferred: input.status === 'preferred',
  }));
  vi.mocked(productionService.setShotCaptureState).mockImplementation(async (_w, _p, _s, status, notes) => ({
    shot_id: shotA, status, notes: notes ?? '', captured_at: status === 'captured' ? '2026-10-05T10:00:00Z' : null, revision: 1,
  } as RealCaptureState));
  vi.mocked(productionService.recordShotDeviation).mockResolvedValue({
    deviation_id: 'dev-1', shot_id: shotA, field: 'movement', planned_value: 'gimbal push-in',
    actual_value: 'handheld static', recorded_at: '2026-10-05T10:00:00Z',
  } as never);
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Real Production canvas', () => {
  it('plans a Shot from the owned Setup and labels exposure values as starting points', async () => {
    renderCanvas();
    await openFirstShot();
    expect(screen.getAllByText(/Solo camera body/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/35 mm lens/).length).toBeGreaterThan(0);
    expect(screen.getByText(/f\/2\.8–f\/4 starting point/)).toBeVisible();
    expect(screen.getAllByText('STARTING POINT').length).toBeGreaterThan(0);
    expect(screen.getByText(/Perspective comes from camera distance, not the lens alone\./)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Lighting/ }));
    expect(screen.getByText(/Soft premium beauty/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Sound/ }));
    expect(screen.getByText(/Lav on the talent for the pour/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Performance/ }));
    expect(screen.getByText(/Start restrained, hold for one beat after the pour/)).toBeVisible();
  });

  it('substitutes an owned lens for a missing one instead of claiming it is owned', async () => {
    vi.mocked(productionService.realShotDetail).mockResolvedValue(detail({
      readiness: 'ready_with_substitution', requirements: [requirement({})],
    }));
    renderCanvas();
    await openFirstShot();
    expect(screen.getByText('Ready with substitution')).toBeVisible();
    expect(screen.getByText(/wants 85 mm lens/)).toBeVisible();
    expect(screen.getByText(/using 50 mm lens/)).toBeVisible();
    expect(screen.getByText(/Move the camera closer/)).toBeVisible();
    expect(screen.getByText('substitute')).toBeVisible();
    expect(screen.queryByText('owned')).not.toBeInTheDocument();
  });

  it('keeps unknown equipment unverified rather than inventing capability', async () => {
    vi.mocked(productionService.realShotDetail).mockResolvedValue(detail({
      readiness: 'needs_decision',
      requirements: [requirement({ label: 'Camera', ideal_name: 'Random Brand X Light', status: 'unverified', epistemic: 'UNKNOWN', substitute_name: null, substitute_resource_id: null, alternative: 'TONDE has no verified specification for this item.' })],
    }));
    renderCanvas();
    await openFirstShot();
    expect(screen.getByText('unverified')).toBeVisible();
    expect(screen.getByText(/TONDE has no verified specification for this item\./)).toBeVisible();
    expect(screen.queryByText(/wattage/)).not.toBeInTheDocument();
  });

  it('sends the practical constraints the creator actually selected', async () => {
    vi.mocked(productionService.directRealShot).mockResolvedValue({
      applied: null, plan: plan(), requirements: [], alternatives: [], scope: 'shot', shot_id: shotA,
      answer: { summary: 'Phone-only plan.', why: 'Constraint respected.', affected: [], readiness: 'ready', readiness_note: 'Ready on the phone.', missing: [], substitutes: [], unverified: [], safety: [], truthfulness: 'Recommendations, not measurements.' },
    });
    renderCanvas();
    await openFirstShot();
    fireEvent.click(screen.getByRole('button', { name: 'Use only my phone' }));
    fireEvent.click(screen.getByRole('button', { name: 'I only have one light' }));
    fireEvent.click(screen.getByRole('button', { name: 'I am shooting alone' }));
    fireEvent.click(screen.getByRole('button', { name: /Preview how to shoot this/ }));
    await waitFor(() => expect(productionService.directRealShot).toHaveBeenCalled());
    const call = vi.mocked(productionService.directRealShot).mock.calls[0];
    expect(call[3].constraints).toEqual(expect.arrayContaining(['phone_only', 'one_light', 'solo']));
    expect(await screen.findByText(/Phone-only plan\./)).toBeVisible();
  });

  it('refuses to let the Director rewrite a locked Shot', async () => {
    vi.mocked(productionService.realShotDetail).mockResolvedValue(detail({
      shot: { ...detail().shot, locked: true },
    }));
    renderCanvas();
    await openFirstShot();
    expect(screen.getByRole('button', { name: 'Apply to this Shot' })).toBeDisabled();
    expect(screen.getByText(/Shot locked/)).toBeVisible();
  });

  it('reports the approval state a material plan edit leaves behind', async () => {
    vi.mocked(productionService.saveRealPlan).mockResolvedValue({
      plan_id: 'plan-1', shot_id: shotA, plan_revision: 2, approval: 'changed_after_approval',
      plan_status: 'ready', readiness: 'ready', requirements: 0, alternatives: 0, timing: timing(),
    });
    renderCanvas();
    await openFirstShot();
    fireEvent.click(screen.getByRole('button', { name: /Edit this plan by hand/ }));
    fireEvent.change(screen.getByLabelText('Lighting plan'), { target: { value: 'Available light only now.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my version' }));
    expect(await screen.findByText(/Changed After Approval/)).toBeVisible();
    expect(productionService.saveRealPlan).toHaveBeenCalledWith(workspaceId, productionId, shotA,
      expect.objectContaining({ expected_shot_revision: 3 }));
  });

  it('records a field deviation without rewriting the plan', async () => {
    renderCanvas();
    await openFirstShot();
    fireEvent.click(screen.getByRole('button', { name: /Field deviations/ }));
    fireEvent.change(screen.getByLabelText('Planned value'), { target: { value: 'gimbal push-in' } });
    fireEvent.change(screen.getByLabelText('Actual value'), { target: { value: 'handheld static' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record deviation' }));
    await waitFor(() => expect(productionService.recordShotDeviation).toHaveBeenCalledWith(workspaceId, productionId, shotA,
      expect.objectContaining({ field: 'movement', planned_value: 'gimbal push-in', actual_value: 'handheld static' })));
    expect(productionService.saveRealPlan).not.toHaveBeenCalled();
    expect(await screen.findByText(/Recording a deviation never rewrites the plan\./)).toBeVisible();
  });

  it('logs Takes and makes one preferred', async () => {
    vi.mocked(productionService.realShotDetail).mockResolvedValue(detail({
      takes: [
        { take_id: 'take-1', take_number: 1, status: 'recorded', notes: 'light flickered', preferred: false },
        { take_id: 'take-2', take_number: 2, status: 'good', notes: 'clean', preferred: true },
      ],
      capture: { shot_id: shotA, status: 'shooting', notes: '', captured_at: null, revision: 1 },
    }));
    renderCanvas();
    await openFirstShot();
    fireEvent.click(screen.getByRole('button', { name: /Takes/ }));
    expect(screen.getByText(/Take 1/)).toBeVisible();
    expect(screen.getByText(/preferred/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Prefer this take/ }));
    await waitFor(() => expect(productionService.saveShotTake).toHaveBeenCalledWith(workspaceId, productionId, shotA,
      expect.objectContaining({ take_number: 1, status: 'preferred' })));
  });

  it('marks a Shot captured without calling it approved', async () => {
    renderCanvas();
    await openFirstShot();
    fireEvent.click(screen.getByRole('button', { name: 'Captured' }));
    await waitFor(() => expect(productionService.setShotCaptureState).toHaveBeenCalledWith(workspaceId, productionId, shotA, 'captured', '', null));
    expect(await screen.findByText(/Captured is not approved/)).toBeVisible();
  });

  it('surfaces safety and location limits from the plan', async () => {
    vi.mocked(productionService.realShotDetail).mockResolvedValue(detail({
      readiness: 'safety_blocked',
      plan: plan({
        safety_flags: ['drive-and-film'],
        safety_notes: ['Do not film while driving. Mount the camera and use a second person or shoot the vehicle stationary.'],
        location_requirements: ['A small room forces a shorter lens: expect a wider perspective than planned.'],
      }),
    }));
    renderCanvas();
    await openFirstShot();
    expect(screen.getByText('Safety blocked')).toBeVisible();
    expect(screen.getByText(/Do not film while driving/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Location and environment/ }));
    expect(screen.getByText(/A small room forces a shorter lens/)).toBeVisible();
  });

  it('plans a whole Scene and then the whole Production Scene by Scene', async () => {
    vi.mocked(productionService.directRealScene).mockResolvedValue({
      scope: 'scene', scene_id: sceneId, applied: false,
      shots: [{ shot_id: shotA, plan: plan() }], skipped: [{ shot_id: shotB, reason: 'Shot is locked' }],
      summary: { directed: 1, skipped: 1 },
    });
    renderCanvas();
    await openFirstShot();
    fireEvent.click(screen.getByRole('button', { name: 'Preview this whole Scene' }));
    await waitFor(() => expect(productionService.directRealScene).toHaveBeenCalledWith(workspaceId, productionId, sceneId,
      expect.objectContaining({ apply: false })));
    expect(await screen.findByText(/1 Shot\(s\) planned for this Scene, 1 skipped\./)).toBeVisible();
    expect(screen.getByText(/Shot is locked/)).toBeVisible();

    vi.mocked(productionService.directRealScene).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Plan every Shot' }));
    await waitFor(() => expect(productionService.directRealScene).toHaveBeenCalledWith(workspaceId, productionId, sceneId,
      expect.objectContaining({ apply: true })));
    expect(await screen.findByText(/Planned 1 Shot\(s\) across the Production; 1 skipped/)).toBeVisible();
  });

  it('shows honest empty state when no Shot has a plan', async () => {
    vi.mocked(productionService.realShotDetail).mockResolvedValue(detail({ plan: null, readiness: 'unplanned', requirements: [] }));
    renderCanvas();
    await openFirstShot();
    expect(screen.getByText('No Real plan yet')).toBeVisible();
    expect(screen.getByText(/TONDE will build one from the Shot and the Setup you own\./)).toBeVisible();
  });
});

describe('On-Set Mode', () => {
  function renderOnSet() {
    const auth = {
      session: null, workspaceId, loading: false, error: null, configured: true, localPreview: false, retry: vi.fn(),
    };
    const router = createMemoryRouter([{ path: '/on-set/:productionId', element: <OnSetPage /> }],
      { initialEntries: [`/on-set/${productionId}`] });
    render(<AuthContext.Provider value={auth}><RouterProvider router={router} /></AuthContext.Provider>);
  }

  it('walks Shot by Shot, logs Takes and keeps capture state', async () => {
    vi.mocked(productionService.realSurface).mockResolvedValue(surface());
    vi.mocked(productionService.realShotDetail).mockResolvedValue(detail({
      plan: plan({ safety_notes: [], capture_checklist: ['Camera mounted', 'Audio rolling'] }),
    }));
    renderOnSet();
    expect(await screen.findByText(/1 of 2 Shots captured/)).toBeVisible();
    expect(screen.getByText(/Pick the Shot you are standing in front of/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Open the first Shot/ }));
    await screen.findByRole('heading', { name: 'Establish' });
    expect(screen.getByText(/STARTING POINT/)).toBeVisible();
    expect(screen.getByText('Camera mounted')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Take note'), { target: { value: 'good, but the light flickered' } });
    fireEvent.click(screen.getByRole('button', { name: /Log take/ }));
    await waitFor(() => expect(productionService.saveShotTake).toHaveBeenCalledWith(workspaceId, productionId, shotA,
      expect.objectContaining({ take_number: 1, status: 'recorded', notes: 'good, but the light flickered' })));

    fireEvent.click(screen.getByRole('button', { name: 'Needs a pickup' }));
    await waitFor(() => expect(productionService.setShotCaptureState).toHaveBeenCalledWith(workspaceId, productionId, shotA, 'pickup_needed', '', null));

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(productionService.realShotDetail).toHaveBeenCalledWith(workspaceId, productionId, shotB));
  });

  it('offers a practical replan when something changes on set', async () => {
    vi.mocked(productionService.directRealShot).mockResolvedValue({
      applied: null, plan: plan(), requirements: [], alternatives: [], scope: 'shot', shot_id: shotA,
      answer: { summary: 'Available-light plan.', why: 'The window carries the shot.', affected: ['lighting_plan'], readiness: 'ready', readiness_note: 'Ready with the window as key.', missing: [], substitutes: [], unverified: [], safety: [], truthfulness: 'Recommendations only.' },
    });
    renderOnSet();
    fireEvent.click(await screen.findByRole('button', { name: /Open the first Shot/ }));
    await screen.findByRole('heading', { name: 'Establish' });
    fireEvent.click(screen.getByRole('button', { name: 'My light died' }));
    await waitFor(() => expect(productionService.directRealShot).toHaveBeenCalledWith(workspaceId, productionId, shotA,
      expect.objectContaining({ apply: false, constraints: ['available_light_only'] })));
    expect(await screen.findByText(/Available-light plan\./)).toBeVisible();
  });

  it('says the Production has nothing to shoot when there are no Shots', async () => {
    vi.mocked(productionService.realSurface).mockResolvedValue(surface({ shots: [], scenes: [], summary: { ...surface().summary, shots: 0, captured: 0 } }));
    renderOnSet();
    expect(await screen.findByText('Nothing to shoot yet')).toBeVisible();
  });
});
