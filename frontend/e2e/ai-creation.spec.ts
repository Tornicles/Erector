import { expect, test, type Page } from '@playwright/test';

// Prompt 7 AI Creation end-to-end flow (§163). The platform and the TONDE API are stubbed at
// the network boundary, and the stub keeps its own state, so a reload proves what persisted.
// The browser must: plan on the canonical Shot, refuse to generate without a connection, offer
// manual export, record an Attempt, select a Result, switch execution method on the SAME Shot,
// survive a face switch, and survive a reload.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneA = '00000000-0000-4000-8000-000000000010';
const shotA = '00000000-0000-4000-8000-000000000014';
const shotB = '00000000-0000-4000-8000-000000000015';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-ai', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const provider = { provider: 'unconfigured', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };
const production = { id: productionId, workspace_id: workspace, title: 'Ridgeway coffee', production_type: 'commercial', execution_method: 'hybrid', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 2, lifecycle: 'active', calculated_duration_ms: 30000, updated_at: '2026-10-05T00:00:00Z' };

async function platform(page: Page) {
  await page.route('https://tonde-test.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: uid, email: 'creator@example.com' } });
    if (path.endsWith('/rpc/bootstrap_workspace')) return route.fulfill({ json: workspace });
    if (path === '/rest/v1/workspace_members') return route.fulfill({ json: [{ role: 'owner' }] });
    if (path === '/rest/v1/productions') {
      const single = route.request().headers().accept?.includes('vnd.pgrst.object');
      return route.fulfill({ json: single ? production : [production] });
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(({ uid }) => {
    const payload = btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-05T00:00:00Z' } }));
  }, { uid });
}

type ShotState = { id: string; title: string; method: 'real' | 'ai' | 'hybrid'; promptVersion: number; stale: boolean; readiness: string; selectedAttemptId: string | null };

test('AI Creation plans, refuses politely, records a manual Attempt, selects a Result, switches method and persists', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await platform(page);

  let shots: ShotState[] = [
    { id: shotA, title: 'Bag reveal', method: 'ai', promptVersion: 2, stale: false, readiness: 'provider_not_connected', selectedAttemptId: null },
    { id: shotB, title: 'Sip', method: 'ai', promptVersion: 1, stale: false, readiness: 'provider_not_connected', selectedAttemptId: null },
  ];
  const attempts: Array<{ attempt_id: string; shot_id: string; attempt_number: number; status: string; mode: string; provider_key: string; idempotency_key: string; selected: boolean; output_media_id: string | null }> = [];
  let nextAttempt = 1;
  const writeLog: Array<{ path: string; body: Record<string, unknown> }> = [];
  const shotOf = (id: string) => {
    const found = shots.find(shot => shot.id === id);
    if (!found) throw new Error(`Fixture has no Shot ${id}`);
    return found;
  };
  const prompt = (shot: ShotState) => ({
    plan_id: `plan-${shot.id}`, shot_id: shot.id, execution_method: shot.method, approval: 'draft', locked: false,
    revision: 1, plan_status: 'ready', readiness_note: '', generated_by: 'deterministic',
    prompt_version: shot.promptVersion, source_shot_revision: shot.stale ? 2 : 3, shot_revision: 3,
    prompt_stale: shot.stale, source_versions: { shot_revision: 3 },
    canonical_prompt: { SUBJECT: 'Mara and the coffee bag', ACTION: 'She turns the bag label-out.', ENVIRONMENT: 'Dark kitchen', MOVEMENT: 'slow push in', TIMING: '5000 ms (5s) of finished runtime.' },
    provider_prompt: 'SUBJECT: Mara and the coffee bag\nMOVEMENT: slow push in', provider_prompt_edited: false,
    provider_prompt_edited_at: null, provider_target: 'manual', model_profile_id: null, fallback_model_profile_id: null,
    model_version: '', model: '', provider: 'manual', routing: { recommended: null, fallback: null, alternatives: [], excluded: [], reasoning: [], manual_export: { kind: 'MANUAL EXPORT OPTION', model_profile_id: null, provider_key: 'manual', model_key: 'manual', label: 'Manual export', reason: 'No connection needed. TONDE compiles the prompt, references and settings for you to run yourself.', cost_state: 'unknown', cost_amount: null, cost_currency: '' }, connection_required: false },
    first_frame: {}, last_frame: {}, motion: { needed: true, description: 'slow push in', intensity: 'low' },
    audio: { needed: false }, continuity: { must: [], should: [], flexible: [] }, hybrid: { method: shot.method, reasons: [] },
    negative_constraints: ['no invented brand marks'], limitations: ['No provider is connected, so TONDE compiled the prompt for manual export.'],
    aspect_ratio: '9:16', expected_duration_ms: 5000, cost_state: 'unknown', cost_amount: null, cost_currency: '',
    cost_note: '', shot_size: '', framing: '', composition: '', movement: '', movement_purpose: '', lighting_intent: '',
    performance: '', product_direction: '', sound_plan: '', editorial_intent: '', updated_at: null,
    model_profile: null, connection: null,
  });

  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) {
      return route.fulfill({ json: envelope({ production: { id: productionId, title: production.title, production_type: 'commercial', execution_method: 'hybrid', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 2 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 30000, assigned_ms: 0, dialogue_ms: 0, action_ms: 0, slack_ms: 30000, status: 'under' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} }) });
    }
    if (path.endsWith('/director/provider')) return route.fulfill({ json: envelope(provider) });
    if (path.endsWith('/studio/timing')) {
      return route.fulfill({ json: envelope({ total_ms: 10000, target_ms: 30000, delta_ms: -20000, status: 'under', scene_states: [{ scene_id: sceneA, order: 1024, duration_ms: 10000, shots: shots.length, timing: 'derived' }] }) });
    }
    if (path.endsWith('/studio')) {
      const readModel = {
        production,
        scenes: [{
          id: sceneA, order: 1, sort_order: 1024, title: 'Dark kitchen', purpose: 'Earn attention', story_beat: 'Hook',
          description: 'A dark kitchen.', action_lines: [], opening_state: '', ending_state: '', visual_intent: '',
          dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 10000, duration_ms: 10000,
          timing: 'derived', approval: 'draft', locked_at: null, revision: 1, updated_at: '2026-10-05T00:00:00Z',
          character_asset_ids: [], dialogue_lines: 0, shot_count: shots.length, bindings: [],
          shots: shots.map((shot, index) => ({
            id: shot.id, scene_id: sceneA, order: index + 1, sort_order: (index + 1) * 1024, title: shot.title,
            description: '', action: '', purpose: 'product', subject: 'Mara', framing: 'medium', angle: 'eye level',
            movement: 'slow push in', composition: 'centred', transition: 'cut', story_relationship: '', story_beat: 'Hook',
            creative_notes: '', execution_method: shot.method, planned_duration_ms: 5000, approval: 'draft',
            locked_at: null, revision: 3, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [],
          })),
        }],
        orphan_shots: [], assets: [], documents: {},
        timing: { total_ms: 10000, target_ms: 30000, delta_ms: -20000, status: 'under', scene_states: [{ scene_id: sceneA, order: 1024, duration_ms: 10000, shots: shots.length, timing: 'derived' }] },
        runtime_conflict: false,
        timeline: [{ scene_id: sceneA, order: 1, title: 'Dark kitchen', duration_ms: 10000, timing: 'derived', approval: 'draft', locked: false, execution_methods: [...new Set(shots.map(shot => shot.method))], shots: shots.map((shot, index) => ({ shot_id: shot.id, order: index + 1, title: shot.title, duration_ms: 5000, execution_method: shot.method, approval: 'draft', locked: false })) }],
        status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: shots.length, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 1 + shots.length }, needs_attention: 0 },
        truncated: false, provider,
        capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'AI prompt compilation is available.' },
      };
      return route.fulfill({ json: envelope(readModel) });
    }
    if (path.endsWith('/real/surface')) {
      return route.fulfill({ json: envelope({
        production, execution_faces: ['real', 'ai'], setup: [],
        timing: { total_ms: 10000, target_ms: 30000, delta_ms: -20000, status: 'under', scene_states: [{ scene_id: sceneA, order: 1024, duration_ms: 10000, shots: shots.length, timing: 'derived' }] },
        scenes: [{ scene_id: sceneA, order: 1, title: 'Dark kitchen', shots: shots.length, ready: 0, unresolved: shots.length, captured: 0, pickup_needed: 0, complexity: null, unresolved_note: null }],
        shots: shots.map((shot, index) => ({
          shot_id: shot.id, scene_id: sceneA, scene_order: 1, scene_title: 'Dark kitchen', order: index + 1,
          title: shot.title, purpose: 'product', subject: 'Mara', framing: 'medium', execution_method: shot.method,
          approval: 'draft', locked: false, planned_duration_ms: 5000, expected_duration_ms: 5000, plan_id: null,
          plan_revision: null, plan_status: null, readiness: 'unplanned', readiness_note: '', complexity: null,
          camera_resource_id: null, lens_resource_id: null, movement: 'slow push in', stabilization: '',
          lighting_intent: '', sound_plan: '', solo_feasibility: null, crew_roles: [], safety_flags: [],
          requirements: { owned: 0, substitute: 0, missing: 0, unverified: 0 }, capture: null,
          takes: { count: 0, preferred_take_id: null }, deviations: 0,
        })),
        summary: { shots: shots.length, planned: 0, unplanned: shots.length, ready: 0, ready_with_substitution: 0, needs_decision: 0, missing_resource: 0, safety_blocked: 0, captured: 0, pickup_needed: 0, in_progress: 0, approved_plans: 0, changed_after_approval: 0, crew_roles: [], safety_flags: [], complexity: null },
        readiness_queue: { ready_to_shoot: [], needs_decision: [], missing_resource: [], pickup_required: [] },
        provider,
        capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', setup_matching: true, take_logging: true, on_set_mode: true, ai_prompt_compilation: true, note: 'Real execution planning is available.' },
      }) });
    }
    if (path.endsWith('/ai/surface')) {
      return route.fulfill({ json: envelope({
        production, execution_faces: ['real', 'ai'],
        connections: [{ provider_key: 'runway', label: 'Runway', connection_required: true, manual_export_supported: true, state: 'not_connected', credential_reference: '', connected_at: null }],
        models: [], known_models: [], locks: [],
        scenes: [{ scene_id: sceneA, order: 1, title: 'Dark kitchen', shots: shots.length, ready: 0, blocked: shots.length, unplanned: 0, selected: 0 }],
        shots: shots.map((shot, index) => ({
          shot_id: shot.id, scene_id: sceneA, title: shot.title, purpose: 'product', order: index + 1,
          execution_method: shot.method, approval: 'draft', locked: false, revision: 3, planned_duration_ms: 5000,
          readiness: shot.readiness, plan_id: `plan-${shot.id}`, plan_revision: 1, plan_status: 'ready',
          prompt_version: shot.promptVersion, prompt_stale: shot.stale, provider_target: 'manual',
          model_profile_id: null, model_label: null, model_key: null, capability_state: null,
          cost_state: 'unknown', cost_amount: null, cost_currency: '', aspect_ratio: '9:16',
          expected_duration_ms: 5000, hybrid: null,
        })),
        summary: { shots: shots.length, ai_or_hybrid: shots.filter(shot => shot.method !== 'real').length, real: shots.filter(shot => shot.method === 'real').length, planned: shots.length, ready: 0, manual_export: shots.length, blocked: shots.length, stale: shots.filter(shot => shot.stale).length, with_selected_result: shots.filter(shot => shot.selectedAttemptId).length, connected_providers: 0, declared_models: 0 },
        capabilities: { prompt_compilation: true, model_routing: true, live_generation: false, manual_export: true, note: 'Provider-neutral. TONDE ranks only the models you have declared, and holds no vendor capability facts of its own.' },
        provider, live_generation: false,
        truthfulness: 'Provider-neutral. TONDE knows no vendor capability it was not told, and reports COST UNKNOWN rather than a number it does not have.',
      }) });
    }
    if (path.endsWith('/direct')) {
      writeLog.push({ path, body });
      const shot = shotOf(path.split('/').slice(-2)[0]);
      return route.fulfill({ json: envelope({
        applied: null, plan: prompt(shot),
        routing: prompt(shot).routing,
        hybrid: { method: shot.method, reasons: ['Part of this Shot is practical and part of it is not.'], shoot_component: 'Shoot the Product.', generate_component: 'Generate the World.', combine: [], matching: [], plate_requirements: ['Locked camera'], limitations: [], factors: {}, advisory: true },
        references: [], scope: 'shot', shot_id: shot.id,
        answer: { summary: 'slow push in on Mara and the coffee bag.', why: 'The Shot needs a controlled push in.', model: null, method: shot.method, method_reasons: [], needs_reference: false, limitations: [], truthfulness: 'Identity is preserved as closely as the selected model supports; TONDE never promises exact identity reproduction.', direction_applied: ['motion simplified'], direction_note: '' },
      }) });
    }
    if (path.endsWith('/attempts')) {
      const shot = shotOf(path.split('/').slice(-2)[0]);
      const input = body as { idempotency_key: string; mode: string };
      const existing = attempts.find(item => item.idempotency_key === input.idempotency_key);
      writeLog.push({ path, body });
      if (existing) return route.fulfill({ json: envelope({ attempt_id: existing.attempt_id, status: existing.status, idempotent: true, billed: false }) });
      const created = { attempt_id: `attempt-${nextAttempt}`, shot_id: shot.id, attempt_number: nextAttempt, status: 'planned', mode: input.mode, provider_key: 'manual', idempotency_key: input.idempotency_key, selected: false, output_media_id: null };
      nextAttempt += 1;
      attempts.push(created);
      return route.fulfill({ json: envelope({ attempt_id: created.attempt_id, status: created.status, idempotent: false, billed: false }) });
    }
    if (path.includes('/attempts/')) {
      const attemptId = path.split('/').pop()!;
      const attempt = attempts.find(item => item.attempt_id === attemptId)!;
      if (body.status) attempt.status = String(body.status);
      if (body.output_media_id) attempt.output_media_id = String(body.output_media_id);
      writeLog.push({ path, body });
      return route.fulfill({ json: envelope({ attempt_id: attemptId, updated: true }) });
    }
    if (path.includes('/results/') && path.endsWith('/select')) {
      const attemptId = path.split('/').slice(-2)[0];
      const attempt = attempts.find(item => item.attempt_id === attemptId)!;
      attempt.selected = true;
      shotOf(attempt.shot_id).selectedAttemptId = attemptId;
      attempt.status = 'succeeded';
      attempt.output_media_id = 'media-1';
      writeLog.push({ path, body });
      return route.fulfill({ json: envelope({ attempt_id: attemptId, selected: true, result_state: 'needs_review' }) });
    }
    if (path.endsWith('/hybrid')) {
      const shot = shotOf(path.split('/').slice(-2)[0]);
      shot.method = String(body.execution_method) === 'generate' ? 'ai' : String(body.execution_method) === 'shoot' ? 'real' : 'hybrid';
      shot.readiness = shot.method === 'real' ? 'unsupported' : 'provider_not_connected';
      writeLog.push({ path, body });
      return route.fulfill({ json: envelope({ advisory: true, recommended: { method: body.execution_method, reasons: [], shoot_component: '', generate_component: '', combine: [], matching: [], limitations: [], plate_requirements: [], factors: {}, advisory: true }, creator_choice: body.execution_method, creator_reason: null, override_recorded: { shot_id: shot.id, identifier_unchanged: true }, already: false, note: 'Recorded on the same Shot. The Production and Shot identifiers are unchanged.', shot_id: shot.id, truthfulness: 'TONDE advises; you decide. A warning is not a refusal.' }) });
    }
    if (path.includes('/ai/shots/')) {
      const shot = shotOf(path.split('/').pop()!);
      const own = attempts.filter(item => item.shot_id === shot.id);
      return route.fulfill({ json: envelope({
        shot: { shot_id: shot.id, scene_id: sceneA, title: shot.title, description: '', action: '', purpose: 'product', subject: 'Mara', framing: 'medium', angle: '', movement: 'slow push in', composition: '', transition: '', story_relationship: '', story_beat: '', creative_notes: '', execution_method: shot.method, approval: 'draft', locked: false, revision: 3, planned_duration_ms: 5000 },
        scene: { scene_id: sceneA, title: 'Dark kitchen', order: 1, purpose: 'Earn attention', description: 'Morning light.', environment_asset_id: null },
        readiness: shot.readiness, plan: prompt(shot), real_plan: null, references: [], locks: [],
        attempts: own.map(item => ({ attempt_id: item.attempt_id, attempt_number: item.attempt_number, operation: 'video', provider_key: item.provider_key, model_key: '', model_version: '', model_profile_id: null, prompt_version: shot.promptVersion, source_shot_revision: 3, mode: item.mode, status: item.status, external_job_id: null, seed: null, settings: {}, input_references: [], cost_state: 'unknown', cost_amount: null, cost_currency: '', retryable: null, retry_of: null, started_at: null, completed_at: null, failure_code: '', failure_message: '', output_media_id: item.output_media_id, result_id: item.selected ? 'result-1' : null, result_state: item.selected ? 'needs_review' : null, selected: item.selected, creator_rating: null, creator_decision: '', idempotency_key: item.idempotency_key, created_at: null, revision: 1 })),
        selected_result: own.find(item => item.selected) ? { attempt_id: own.find(item => item.selected)!.attempt_id, attempt_number: own.find(item => item.selected)!.attempt_number, status: 'succeeded', provider_key: 'manual', model_key: '', result_id: 'result-1', output_media_id: 'media-1', result_state: 'needs_review', selected: true, completed_at: null } : null,
        batch_items: [], script_line: null,
      }) });
    }
    return route.fulfill({ status: 400, json: { message: `Unexpected fixture endpoint: ${path}` } });
  });

  // Open Studio on the AI face with Shot 1 selected.
  await page.goto(`/studio/${productionId}?tool=AI Creation&scene=${sceneA}&shot=${shotA}`);
  await expect(page.getByRole('region', { name: 'AI Creation' })).toBeVisible();
  await expect(page.getByText(/Live generation: not available in this workspace/)).toBeVisible();
  await expect(page.getByText(/TONDE knows no vendor capability it was not told/)).toBeVisible();

  // TONDE is the Director: the playbook prompt is the primary action, and running the Shot inside TONDE is
  // a secondary path that is disabled with the exact reasons. The creator runs it in their own tool.
  const generateBar = page.getByRole('group', { name: 'AI playbook actions' });
  await expect(generateBar.getByRole('button', { name: /Run this Shot in a connected provider/ })).toBeDisabled();
  await expect(page.getByText(/Running it inside TONDE/)).toBeVisible();
  await expect(page.getByText(/No provider is connected in this workspace/)).toBeVisible();
  await expect(generateBar.getByRole('button', { name: /Copy playbook prompt/ })).toBeEnabled();
  await expect(page.getByText('COST UNKNOWN', { exact: true })).toBeVisible();
  await expect(page.locator('#provider-prompt')).toHaveValue(/SUBJECT: Mara and the coffee bag/);

  // The Result the creator made in their own tool is recorded with an idempotency key, and nothing is billed twice.
  await generateBar.getByRole('button', { name: /Record Result from my tool/ }).click();
  await expect(page.getByText(/Attempt recorded. Run the prompt yourself/)).toBeVisible();
  await expect(page.getByText('Attempt 1', { exact: true }).first()).toBeVisible();
  expect(writeLog.find(entry => entry.path.endsWith('/attempts'))?.body).toMatchObject({ mode: 'manual' });

  // What came back from the manual run is reported, and only then can it be selected.
  await page.getByLabel('Output media id').fill('media-1');
  await page.getByRole('button', { name: 'Save the result' }).click();
  await expect(page.getByText('Attempt updated.')).toBeVisible();

  // The same Shot's first Attempt is selected as the current output, not as an approval.
  await page.getByRole('button', { name: /Select this result/ }).click();
  await expect(page.getByText(/This is not a Shot approval/)).toBeVisible();

  // Switching execution method writes to the same canonical Shot.
  await page.getByRole('button', { name: 'SHOOT', exact: true }).click();
  await expect(page.getByText(/identifiers are unchanged/)).toBeVisible();
  await expect(page.getByText(/SHOT 1 · SHOOT/)).toBeVisible();

  // Switching to the REAL face keeps the same Production and the same Shot.
  await page.getByRole('button', { name: 'REAL PRODUCTION', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Real Production' })).toBeVisible();
  await expect(page.getByText('Ridgeway coffee').first()).toBeVisible();
  await expect(page.getByText('Bag reveal').first()).toBeVisible();
  await page.getByRole('button', { name: 'AI CREATION', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AI Creation' })).toBeVisible();

  // A reload keeps the prompt, the Attempt, the selected Result and the execution method.
  await page.reload();
  await expect(page.getByRole('region', { name: 'AI Creation' })).toBeVisible();
  await expect(page.getByText('Attempt 1', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Selected result: Attempt 1/)).toBeVisible();
  await expect(page.getByText(/SHOT 1 · SHOOT/)).toBeVisible();
  expect(errors).toEqual([]);
});
