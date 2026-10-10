import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCreationCanvas } from '../studio/AICreation';
import {
  productionService, type AiDirectionResult, type AiPrompt, type AiShotDetail, type AiSurface,
} from '../services/productions';

vi.mock('../services/productions', () => ({
  PAGE_SIZE: 40,
  productionService: {
    aiSurface: vi.fn(), aiShotDetail: vi.fn(), directAiShot: vi.fn(), saveAiPlan: vi.fn(),
    setAiPlanApproval: vi.fn(), setAiPlanLock: vi.fn(), confirmAiCost: vi.fn(),
    createAiAttempt: vi.fn(), updateAiAttempt: vi.fn(), selectAiResult: vi.fn(),
    aiBatchPreview: vi.fn(), createAiBatch: vi.fn(), recordAiBatchItem: vi.fn(), aiHybridDecision: vi.fn(),
  },
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneId = '00000000-0000-4000-8000-000000000010';
const shotId = '00000000-0000-4000-8000-000000000014';
const attemptOne = '00000000-0000-4000-8000-0000000000c1';
const attemptTwo = '00000000-0000-4000-8000-0000000000c2';
const characterId = '00000000-0000-4000-8000-000000000051';

const mocked = productionService as unknown as Record<string, ReturnType<typeof vi.fn>>;

function surface(overrides: Partial<AiSurface> = {}): AiSurface {
  const base: AiSurface = {
    production: {
      id: productionId, workspace_id: workspaceId, title: 'Ridgeway coffee', production_type: 'commercial',
      execution_method: 'hybrid', planned_duration_ms: 30000, approval: 'draft', locked_at: null,
      revision: 7, lifecycle: 'active',
    },
    execution_faces: ['real', 'ai'],
    connections: [
      { provider_key: 'runway', label: 'Runway', connection_required: true, manual_export_supported: true,
        state: 'not_connected', credential_reference: '', connected_at: null },
    ],
    models: [
      { model_profile_id: 'profile-1', provider_key: 'runway', model_key: 'gen-4-reference',
        label: 'Gen-4 reference', operation: 'video', capability_state: 'SUPPORTED', availability: 'available',
        cost_known: false, cost_unit: '', cost_amount: null, cost_currency: '', supports_image_reference: true,
        supports_first_frame: true, supports_last_frame: false, max_duration_ms: 10000, source: 'declared' },
    ],
    known_models: [],
    locks: [
      { lock_id: 'lock-1', scope: 'character', subject_id: characterId, label: 'Mara', locked: true,
        priority: 'MUST PRESERVE', locked_traits: ['oval face', 'dark curly hair'], allowed_variations: ['wardrobe'],
        prohibited_changes: ['face shape'], identity_truth: 'Preserve key identity traits as closely as the selected generation model supports.',
        consent_note: '', note: '', locked_at: '2026-10-05T00:00:00Z', revision: 3 },
    ],
    scenes: [{ scene_id: sceneId, order: 1, title: 'Dark kitchen', shots: 1, ready: 0, blocked: 1, unplanned: 0, selected: 0 }],
    shots: [
      { shot_id: shotId, scene_id: sceneId, title: 'Bag reveal', purpose: 'product', order: 1,
        execution_method: 'ai', approval: 'draft', locked: false, revision: 3, planned_duration_ms: 5000,
        readiness: 'provider_not_connected', plan_id: 'plan-1', plan_revision: 2, plan_status: 'ready',
        prompt_version: 2, prompt_stale: false, provider_target: 'runway', model_profile_id: 'profile-1',
        model_label: 'Gen-4 reference', model_key: 'gen-4-reference', capability_state: 'SUPPORTED',
        cost_state: 'unknown', cost_amount: null, cost_currency: '', aspect_ratio: '9:16',
        expected_duration_ms: 5000, hybrid: null },
    ],
    summary: { shots: 1, ai_or_hybrid: 1, real: 0, planned: 1, ready: 0, manual_export: 0, blocked: 1, stale: 0,
      with_selected_result: 0, connected_providers: 0, declared_models: 1 },
    capabilities: { prompt_compilation: true, model_routing: true, live_generation: false, manual_export: true,
      note: 'Provider-neutral. TONDE ranks only the models you have declared, and holds no vendor capability facts of its own.' },
    provider: { provider: 'unconfigured', configured: false, model_profile: 'default', capabilities: [], notes: [] },
    live_generation: false,
    truthfulness: 'Provider-neutral. TONDE knows no vendor capability it was not told, and reports COST UNKNOWN rather than a number it does not have.',
  };
  return { ...base, ...overrides };
}

function prompt(overrides: Partial<AiPrompt> = {}): AiPrompt {
  const base: AiPrompt = {
    plan_id: 'plan-1', shot_id: shotId, execution_method: 'ai', approval: 'draft', locked: false, revision: 2,
    plan_status: 'ready', readiness_note: '', generated_by: 'deterministic', prompt_version: 2,
    source_shot_revision: 3, shot_revision: 3, prompt_stale: false, source_versions: { shot_revision: 3 },
    canonical_prompt: {
      SUBJECT: 'Mara and the coffee bag. Mara: oval face, dark curly hair. Preserve key identity traits as closely as the selected generation model supports.',
      ACTION: 'She sets the bag down and turns it label-out.',
      ENVIRONMENT: 'Dark kitchen Morning light through a window.',
      CAMERA: 'medium close-up', MOVEMENT: 'slow push in', 'COLOR / STYLE': 'warm low contrast',
      PRODUCT: 'Ridgeway bag stays exactly as supplied; matte kraft label, green logo.',
      CONTINUITY: 'Continues from Shot “Kettle click”.', TIMING: '5000 ms (5s) of finished runtime.',
    },
    provider_prompt: 'SUBJECT: Mara and the coffee bag\nMOVEMENT: slow push in',
    provider_prompt_edited: false, provider_prompt_edited_at: null, provider_target: 'runway',
    model_profile_id: 'profile-1', fallback_model_profile_id: null, model_version: '', model: 'gen-4-reference',
    provider: 'runway',
    routing: { recommended: { kind: 'BEST FIT', model_profile_id: 'profile-1', provider_key: 'runway',
        model_key: 'gen-4-reference', label: 'Gen-4 reference',
        reason: 'This Shot requires image-reference adherence, so reference support decided the choice.',
        cost_state: 'unknown', cost_amount: null, cost_currency: '' },
      fallback: null, alternatives: [], excluded: [{ model_profile_id: 'profile-2', provider_key: 'runway',
        model_key: 'text-only-cheap', state: 'UNSUPPORTED',
        reasons: ['Reference images are required and this model does not accept image references.'] }],
      reasoning: ['This Shot requires image-reference adherence, so reference support decided the choice.'],
      manual_export: { kind: 'MANUAL EXPORT OPTION', model_profile_id: null, provider_key: 'manual',
        model_key: 'manual', label: 'Manual export',
        reason: 'No connection needed. TONDE compiles the prompt, references and settings for you to run yourself, and you record the Attempt it produced.',
        cost_state: 'unknown', cost_amount: null, cost_currency: '' },
      connection_required: false, format: 'sectioned' },
    first_frame: { source: 'previous_last_frame' }, last_frame: {},
    motion: { needed: true, description: 'slow push in', intensity: 'low' },
    audio: { needed: false },
    continuity: { must: ['character', 'product'], should: ['world'], flexible: ['style'], temporal_state: 'morning',
      framing_relationship: '', previous_state: 'Hands off frame', next_state: '' },
    hybrid: { method: 'shoot', reasons: ['Your Setup covers this Shot as written.'],
      shoot_component: 'Shoot the Product so its packaging stays exact.',
      generate_component: 'Generate the Environment.', combine: [], matching: [],
      plate_requirements: ['Locked camera', 'Clean plate'] },
    negative_constraints: ['no invented brand marks', 'no change to face shape'],
    limitations: ['This model does not accept image references, so identity is carried in words only.'],
    aspect_ratio: '9:16', expected_duration_ms: 5000, cost_state: 'unknown', cost_amount: null,
    cost_currency: '', cost_note: '',
    shot_size: '', framing: '', composition: '', movement: '', movement_purpose: '', lighting_intent: '',
    performance: '', product_direction: '', sound_plan: '', editorial_intent: '',
    updated_at: '2026-10-05T00:00:00Z', model_profile: { label: 'Gen-4 reference', capability_state: 'SUPPORTED',
      supports_first_frame: true, supports_last_frame: false, provider_key: 'runway' }, connection: null,
  };
  return { ...base, ...overrides };
}

function detail(overrides: Partial<AiShotDetail> = {}): AiShotDetail {
  const base: AiShotDetail = {
    shot: { shot_id: shotId, scene_id: sceneId, title: 'Bag reveal', description: '', action: '',
      purpose: 'product', subject: 'Mara and the coffee bag', framing: 'medium close-up', angle: '',
      movement: 'slow push in', composition: '', transition: '', story_relationship: '', story_beat: '',
      creative_notes: '', execution_method: 'ai', approval: 'draft', locked: false, revision: 3,
      planned_duration_ms: 5000 },
    scene: { scene_id: sceneId, title: 'Dark kitchen', order: 1, purpose: 'Earn attention',
      description: 'Morning light through a window.', environment_asset_id: null },
    readiness: 'provider_not_connected',
    plan: prompt(),
    real_plan: null,
    references: [{ reference_id: 'ref-1', role: 'face', priority: 'MUST PRESERVE', asset_id: characterId,
      media_id: null, origin: 'asset', note: '', sort_order: 0, asset_name: 'Mara', asset_type: 'character' }],
    locks: surface().locks,
    attempts: [
      { attempt_id: attemptOne, attempt_number: 1, operation: 'video', provider_key: 'manual', model_key: '',
        model_version: '', model_profile_id: null, prompt_version: 2, source_shot_revision: 3, mode: 'manual',
        status: 'planned', external_job_id: null, seed: null, settings: {}, input_references: [],
        cost_state: 'unknown', cost_amount: null, cost_currency: '', retryable: null, retry_of: null,
        started_at: null, completed_at: null, failure_code: '', failure_message: '', output_media_id: null,
        result_id: null, result_state: null, selected: false, creator_rating: null, creator_decision: '',
        idempotency_key: 'key-1', created_at: null, revision: 1 },
      { attempt_id: attemptTwo, attempt_number: 2, operation: 'video', provider_key: 'runway',
        model_key: 'gen-4-reference', model_version: '', model_profile_id: 'profile-1', prompt_version: 2,
        source_shot_revision: 3, mode: 'live', status: 'succeeded', external_job_id: 'job-9', seed: 42,
        settings: {}, input_references: [], cost_state: 'known', cost_amount: 0.75, cost_currency: 'USD',
        retryable: null, retry_of: null, started_at: null, completed_at: '2026-10-05T01:00:00Z',
        failure_code: '', failure_message: '', output_media_id: null, result_id: 'result-1',
        result_state: 'needs_review', selected: false, creator_rating: null, creator_decision: '',
        idempotency_key: 'key-2', created_at: null, revision: 1 },
    ],
    selected_result: null,
    batch_items: [],
    script_line: null,
  };
  return { ...base, ...overrides };
}

function direction(overrides: Partial<AiDirectionResult> = {}): AiDirectionResult {
  const base: AiDirectionResult = {
    applied: null, plan: prompt(), routing: prompt().routing as AiDirectionResult['routing'],
    hybrid: { method: 'hybrid', reasons: ['Part of this Shot is practical and part of it is not.'],
      shoot_component: 'Shoot the Product.', generate_component: 'Generate the World.',
      combine: [], matching: ['Shadow direction on the counter'], plate_requirements: ['Locked camera'],
      limitations: [], factors: {}, advisory: true },
    references: [], scope: 'shot', shot_id: shotId,
    answer: { summary: 'medium close-up on Mara and the coffee bag. 8 prompt sections, provider prompt compiled.',
      why: 'This Shot requires image-reference adherence, so reference support decided the choice.',
      model: { provider_key: 'runway', model_key: 'gen-4-reference', label: 'Gen-4 reference',
        reason: 'This Shot requires image-reference adherence, so reference support decided the choice.',
        cost_state: 'unknown', cost_amount: null, cost_currency: '' },
      method: 'hybrid', method_reasons: ['Part of this Shot is practical.'],
      needs_reference: true, limitations: ['Only 2 reference image(s) can be sent.'],
      truthfulness: 'Identity is preserved as closely as the selected model supports; TONDE never promises exact identity reproduction.',
      direction_applied: ['motion simplified'], direction_note: '' },
  };
  return { ...base, ...overrides, answer: { ...base.answer, ...(overrides.answer ?? {}) } };
}

function renderCanvas(props: Partial<Parameters<typeof AiCreationCanvas>[0]> = {}) {
  const onSelectShot = props.onSelectShot ?? vi.fn();
  const onChanged = props.onChanged ?? vi.fn();
  render(<AiCreationCanvas workspaceId={workspaceId} productionId={productionId} busy={false}
    selectedShotId={props.selectedShotId ?? null}
    onSelectShot={onSelectShot} onChanged={onChanged} />);
  return { onSelectShot, onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.aiSurface.mockResolvedValue(surface());
  mocked.aiShotDetail.mockResolvedValue(detail());
  mocked.directAiShot.mockResolvedValue(direction());
  mocked.setAiPlanApproval.mockResolvedValue({ plan_id: 'plan-1', approval: 'approved', revision: 3 });
  mocked.setAiPlanLock.mockResolvedValue({ plan_id: 'plan-1', locked: true, revision: 3 });
  mocked.confirmAiCost.mockResolvedValue({ confirmed: true });
  mocked.createAiAttempt.mockResolvedValue({ attempt_id: attemptOne, status: 'submitted', idempotent: false });
  mocked.updateAiAttempt.mockResolvedValue({ attempt_id: attemptTwo, updated: true });
  mocked.selectAiResult.mockResolvedValue({ attempt_id: attemptTwo, selected: true, result_state: 'needs_review' });
  mocked.aiBatchPreview.mockResolvedValue({ scope: 'production', shots: 1, ready: 0, blocked: 1,
    estimated_cost: null, cost_state: 'unknown', confirmation_required: true });
  mocked.createAiBatch.mockResolvedValue({ batch_id: 'batch-1', state: 'open', items: 1 });
  mocked.aiHybridDecision.mockResolvedValue({ advisory: true, recommended: direction().hybrid,
    creator_choice: 'shoot', creator_reason: null,
    override_recorded: { shot_id: shotId, identifier_unchanged: true }, already: false,
    note: 'Recorded on the same Shot. The Production and Shot identifiers are unchanged.',
    shot_id: shotId, truthfulness: 'TONDE advises; you decide. A warning is not a refusal.' });
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('AI Creation surface', () => {
  it('states capability and cost truthfully and never claims live generation without a connection', async () => {
    renderCanvas();
    expect((await screen.findAllByText(/PROVIDER-NEUTRAL/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/TONDE knows no vendor capability it was not told/)).toBeTruthy();
    expect(screen.getByText(/Live generation: not available in this workspace/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Providers and connections/ })).toBeTruthy();
  });

  it('shows the AI readiness queue with explicit states rather than a completion score', async () => {
    renderCanvas();
    await screen.findByRole('heading', { name: 'Readiness' });
    const queue = screen.getByRole('region', { name: /AI readiness queue/ });
    expect(within(queue).getByText('Ready to generate')).toBeTruthy();
    expect(within(queue).getByText('Manual export')).toBeTruthy();
    expect(within(queue).getByText('Explicit readiness states, not a completion percentage.')).toBeTruthy();
  });

  it('lists declared models with declared capability, never inferred from the name', async () => {
    renderCanvas();
    fireEvent.click(await screen.findByRole('button', { name: /Models you declared/ }));
    expect((await screen.findAllByText('Gen-4 reference')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Supported').length).toBeGreaterThan(0);
    // Declared facts are shown as declared: accepted references, and an undeclared price stays unknown.
    expect(screen.getAllByText('accepted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
    expect(screen.getByText('first')).toBeTruthy();
  });

  it('shows locked continuity with what may vary and what never changes', async () => {
    renderCanvas();
    fireEvent.click(await screen.findByRole('button', { name: /Continuity locks/ }));
    const list = await screen.findByText(/MUST PRESERVE/);
    expect(list).toBeTruthy();
    expect(screen.getByText(/may vary: wardrobe/)).toBeTruthy();
    expect(screen.getByText(/never: face shape/)).toBeTruthy();
  });

  it('opens a Shot and shows the canonical prompt, provider prompt and honest limitations', async () => {
    renderCanvas({ selectedShotId: shotId });
    expect(await screen.findByText(/AI EXECUTION PLAN/)).toBeTruthy();
    expect(screen.getAllByText(/Mara and the coffee bag/).length).toBeGreaterThan(0);
    // The Prompt section is open by default: sections are progressive disclosure, not hidden data.
    expect(await screen.findByDisplayValue(/SUBJECT: Mara and the coffee bag/)).toBeTruthy();
    expect(screen.getAllByText(/This model does not accept image references/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Preserve key identity traits as closely as the selected generation model supports/)).toBeTruthy();
  });

  it('offers the playbook to run externally, and disables the in-TONDE run with the exact reasons', async () => {
    renderCanvas({ selectedShotId: shotId });
    const bar = await screen.findByRole('group', { name: 'AI playbook actions' });
    const run = within(bar).getByRole('button', { name: /Run this Shot in a connected provider/ });
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Running it inside TONDE\s+needs a connected provider: No provider is connected in this workspace/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Copy playbook prompt/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('records a manual Attempt with an idempotency key when no provider is connected', async () => {
    renderCanvas({ selectedShotId: shotId });
    fireEvent.click(await screen.findByRole('button', { name: /Record Result from my tool/ }));
    await waitFor(() => expect(mocked.createAiAttempt).toHaveBeenCalledTimes(1));
    const [workspace, production, shot, input] = mocked.createAiAttempt.mock.calls[0];
    expect([workspace, production, shot]).toEqual([workspaceId, productionId, shotId]);
    expect(input.mode).toBe('manual');
    expect(input.idempotency_key).toContain(shotId);
    expect(await screen.findByText(/Attempt recorded. Run the prompt yourself/)).toBeTruthy();
  });

  it('reports an idempotent retry as not billed twice', async () => {
    mocked.createAiAttempt.mockResolvedValue({ attempt_id: attemptOne, status: 'submitted', idempotent: true });
    renderCanvas({ selectedShotId: shotId });
    fireEvent.click(await screen.findByRole('button', { name: /Record Result from my tool/ }));
    expect(await screen.findByText(/already exists, so nothing was billed twice/)).toBeTruthy();
  });

  it('selects a result on the same Shot and says selected is not approved', async () => {
    renderCanvas({ selectedShotId: shotId });
    fireEvent.click(await screen.findByRole('button', { name: /Select this result/ }));
    await waitFor(() => expect(mocked.selectAiResult).toHaveBeenCalledWith(workspaceId, productionId, shotId, attemptTwo));
    expect(await screen.findByText(/This is not a Shot approval/)).toBeTruthy();
  });

  it('marks an Attempt cancelled through the Attempt update path', async () => {
    renderCanvas({ selectedShotId: shotId });
    const cancel = await screen.findByRole('button', { name: /Mark cancelled/ });
    fireEvent.click(cancel);
    await waitFor(() => expect(mocked.updateAiAttempt).toHaveBeenCalled());
    const call = mocked.updateAiAttempt.mock.calls[0];
    expect(call[2]).toBe(shotId);
    expect(call[3]).toBe(attemptOne);
    expect(call[4]).toEqual({ status: 'cancelled' });
  });

  it('passes the creator direction through and reports what was honoured', async () => {
    renderCanvas({ selectedShotId: shotId });
    fireEvent.change(await screen.findByLabelText(/Tell the Director what you need/), {
      target: { value: 'Make the motion simpler and keep the Character exactly like the last Shot.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ask how to direct this/ }));
    await waitFor(() => expect(mocked.directAiShot).toHaveBeenCalled());
    const input = mocked.directAiShot.mock.calls[0][3];
    expect(input.text).toMatch(/Make the motion simpler/);
    expect(input.apply).toBe(false);
    expect(await screen.findByText(/Honoured: motion simplified/)).toBeTruthy();
  });

  it('switches execution method on the same Shot identifier', async () => {
    renderCanvas({ selectedShotId: shotId });
    fireEvent.click(await screen.findByRole('button', { name: 'SHOOT' }));
    await waitFor(() => expect(mocked.aiHybridDecision).toHaveBeenCalledWith(workspaceId, productionId, shotId,
      { execution_method: 'shoot', expected_shot_revision: 3 }));
    expect(await screen.findByText(/identifiers are unchanged/)).toBeTruthy();
  });

  it('marks a frame the model does not support as recorded but not sent', async () => {
    mocked.aiShotDetail.mockResolvedValue(detail({ plan: prompt({ last_frame: { source: 'storyboard_frame' } }) }));
    renderCanvas({ selectedShotId: shotId });
    fireEvent.click(await screen.findByRole('button', { name: /Frames and motion/ }));
    expect(await screen.findByText(/Last frame is not supported by this model/)).toBeTruthy();
    expect(screen.getByText(/recorded, not sent/)).toBeTruthy();
  });

  it('flags a stale prompt instead of presenting it as current', async () => {
    mocked.aiShotDetail.mockResolvedValue(detail({ plan: prompt({ prompt_stale: true, shot_revision: 5, source_shot_revision: 3 }) }));
    renderCanvas({ selectedShotId: shotId });
    expect(await screen.findByText(/compiled \(shot revision 5 against prompt revision 3\)/)).toBeTruthy();
    expect(screen.getAllByText(/Stale/).length).toBeGreaterThan(0);
  });

  it('requires confirmation before a batch can be opened and shows unknown cost', async () => {
    renderCanvas();
    fireEvent.click(await screen.findByRole('button', { name: /Preview batch generation/ }));
    expect(await screen.findByText('Batch preview')).toBeTruthy();
    expect(screen.getByText('COST UNKNOWN')).toBeTruthy();
    expect(screen.getByText(/needs your confirmation/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Confirm and open the batch/ }));
    await waitFor(() => expect(mocked.createAiBatch).toHaveBeenCalledWith(workspaceId, productionId,
      { scope: 'production', confirmed: true }));
    expect(await screen.findByText(/Successful Shots are kept even if some fail/)).toBeTruthy();
  });

  it('shows the models TONDE refused to choose and why', async () => {
    renderCanvas({ selectedShotId: shotId });
    fireEvent.click(await screen.findByRole('button', { name: /Ask how to direct this/ }));
    expect(await screen.findByText(/Models TONDE did not choose/)).toBeTruthy();
    expect(screen.getByText(/text-only-cheap/)).toBeTruthy();
    expect(screen.getAllByText(/does not accept image references/).length).toBeGreaterThan(0);
  });

  it('asks the Director for an answer without writing anything to the Shot', async () => {
    renderCanvas({ selectedShotId: shotId });
    fireEvent.click(await screen.findByRole('button', { name: /Ask how to direct this/ }));
    await waitFor(() => expect(mocked.directAiShot).toHaveBeenCalled());
    expect(mocked.directAiShot.mock.calls[0][3].apply).toBe(false);
    expect(await screen.findByText(/Nothing was written to the Shot yet/)).toBeTruthy();
  });

  it('surfaces a failed read instead of rendering an invented empty surface', async () => {
    mocked.aiSurface.mockRejectedValue(new Error('The application data platform is not configured.'));
    render(<AiCreationCanvas workspaceId={workspaceId} productionId={productionId} busy={false}
      selectedShotId={null} onSelectShot={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
