import { expect, test, type Page } from '@playwright/test';

// Prompt 9C Production Memory end-to-end: what this Production remembers is inspectable, the
// authority that decides what is in force is visible, a successful-pattern candidate stays a
// proposal until the creator decides, and structured search returns real object references. The
// API is stubbed at the network boundary, so the browser provably never decides these things
// itself: it cannot claim an inference is confirmed, it cannot accept a candidate without a real
// decision, it cannot ask for a filter the API does not support, and it never presents search as
// semantic or as media analysis.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const character = '00000000-0000-4000-8000-000000000801';
const shotTwelve = '00000000-0000-4000-8000-000000000401';
const itemHandheld = '00000000-0000-4000-8000-000000000901';
const itemPattern = '00000000-0000-4000-8000-000000000902';
const candidateOne = '00000000-0000-4000-8000-000000000a01';

const LIMITATION = 'Memory is what this Production recorded and what you confirmed. An unconfirmed inference is labelled as an inference, and nothing here is a hidden behavioural profile.';
const AUTHORITY_RULE = 'A current creator instruction outranks a current Production decision, which outranks an explicit saved preference, which outranks a historical pattern, which outranks an inference.';
const SEARCH_LIMITATION = 'Search reads structured production state and returns real object references. It does not use embeddings and it does not read media.';
const MEMORY_RULE = 'Memory is inspectable production knowledge with real provenance, not hidden conversational memory. Nothing becomes reusable memory from a single Shot without an explicit policy or your decision.';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-mem', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };

const production = { id: productionId, workspace_id: workspace, project_id: projectId, title: 'Marquee film', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 600000, calculated_duration_ms: 600000, start_ms: 0, end_ms: null, created_by: uid, revision: 7, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };
const shot = { id: shotTwelve, scene_id: '00000000-0000-4000-8000-000000000301', order: 1, sort_order: 1024, title: 'Marcus close-up', description: 'Marcus leaves.', action: '', purpose: 'product', subject: 'Marcus', framing: 'medium close up', angle: 'eye level', movement: 'static', composition: 'lower third', transition: 'cut', story_relationship: 'proves the decision', story_beat: 'Break', creative_notes: '', execution_method: 'real', planned_duration_ms: 8000, approval: 'draft', locked_at: null, revision: 4, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [] };

const studioModel = {
  production: { id: productionId, workspace_id: workspace, title: production.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 600000, calculated_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
  scenes: [{
    id: '00000000-0000-4000-8000-000000000301', order: 1, sort_order: 1024, title: 'Scene 2 Kitchen', purpose: 'The reveal', story_beat: 'Break',
    description: 'Marcus decides to stay.', action_lines: [], opening_state: 'Packed bag', ending_state: 'Bag unpacked',
    visual_intent: 'One soft source', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 20000,
    duration_ms: 20000, timing: 'derived', approval: 'draft', locked_at: null, revision: 5, updated_at: '2026-10-05T00:00:00Z',
    character_asset_ids: [character], dialogue_lines: 0, shot_count: 1, bindings: [], shots: [shot],
  }],
  orphan_shots: [],
  assets: [{ id: character, asset_type: 'character', name: 'Marcus', description: 'Lead character', approval: 'draft', locked_at: null, revision: 2, metadata: {}, used_by_scenes: ['00000000-0000-4000-8000-000000000301'] }],
  documents: {},
  timing: { total_ms: 600000, target_ms: 600000, delta_ms: 0, status: 'fits', scene_states: [{ scene_id: '00000000-0000-4000-8000-000000000301', order: 1024, duration_ms: 20000, shots: 1, timing: 'derived' }] },
  runtime_conflict: false,
  timeline: [{ scene_id: '00000000-0000-4000-8000-000000000301', order: 1, title: 'Scene 2 Kitchen', duration_ms: 20000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotTwelve, order: 1, title: 'Marcus close-up', duration_ms: 8000, execution_method: 'real', approval: 'draft', locked: false }] }],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 1, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 2 }, needs_attention: 0 },
  truncated: false, provider,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 9C production memory.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'short_film', execution_method: 'real', planned_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 600000, assigned_ms: 600000, dialogue_ms: 0, action_ms: 0, slack_ms: 0, status: 'fits' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

const vocabulary = {
  scopes: [{ scope: 'production', label: 'This Production' }, { scope: 'series', label: 'This Series' }, { scope: 'workspace', label: 'Entire workspace' }],
  kinds: [{ kind: 'preference', label: 'Preference' }, { kind: 'technique', label: 'Successful technique' }, { kind: 'correction', label: 'Your correction' }],
  sources: [
    { source: 'creator_instruction', label: 'Your current instruction', authority_rank: 1, strength: 5 },
    { source: 'production_decision', label: 'Current Production decision', authority_rank: 2, strength: 4 },
    { source: 'saved_preference', label: 'Saved preference', authority_rank: 3, strength: 3 },
    { source: 'historical_pattern', label: 'Historical pattern', authority_rank: 4, strength: 2 },
    { source: 'inference', label: 'Inferred by TONDE', authority_rank: 5, strength: 1 },
  ],
  origins: [{ origin: 'declared', label: 'You said it' }, { origin: 'accepted', label: 'You accepted a candidate' }, { origin: 'inferred', label: 'Inferred and unconfirmed' }],
  item_states: [{ state: 'active', label: 'Active' }],
  candidate_states: [{ state: 'proposed', label: 'Waiting for your decision' }, { state: 'applied', label: 'Accepted' }],
  search_kinds: [{ kind: 'shot', label: 'Shot' }, { kind: 'scene', label: 'Scene' }],
  authority_rule: AUTHORITY_RULE, rule: MEMORY_RULE, limitation: LIMITATION, search_limitation: SEARCH_LIMITATION,
};

const summary = {
  items: { active: 3, archived: 1, subjects: 2, creator_confirmed: 2, inferred: 1, sources_changed: 0 },
  by_scope: { production: 3 }, by_source: { saved_preference: 2 },
  candidates: { proposed: 1, applied: 0, rejected: 0 },
  policy: { scope: 'production', explicit: false, candidate_capture: true, auto_accept_candidates: false, note: 'Default policy.', updated_at: null,
    scope_label: 'This Production', explicit_label: 'Default policy',
    capture_label: 'TONDE may record pattern candidates for review.',
    accept_label: 'Nothing becomes memory without your explicit decision.' },
  series_id: null, limitations: LIMITATION,
  summary_line: '3 remembered item(s) are active; 2 of them you confirmed.',
  candidate_line: '1 pattern candidate(s) are waiting for your decision.',
  changed_line: 'Every remembered item still points at the revision it was drawn from.',
};

const items = {
  items: [
    { item_id: itemHandheld, scope: 'production', kind: 'preference', subject_key: 'camera_movement',
      statement: 'Handheld when the scene is tense.', source: 'saved_preference', origin: 'declared', authority_rank: 3,
      rationale: '', evidence: [], source_object_id: character, source_object_label: 'Marcus', source_revision: 2,
      source_object_revision: 2, source_changed: false, candidate_id: null, confirmed_by: uid,
      confirmed_at: '2026-10-05T10:00:00Z', state: 'active', retired_at: null, retire_reason: '', supersedes_id: null,
      superseded_by: null, in_force: true, production_id: productionId, series_id: null,
      created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z', created_by: uid,
      scope_label: 'This Production', kind_label: 'Preference', source_label: 'Saved preference',
      origin_label: 'You said it', state_label: 'Active', authority_line: 'Tier 3 of 5 - Saved preference',
      force_line: 'In force: this is what TONDE is using for this subject.',
      source_line: 'Drawn from Marcus at revision 2' },
    { item_id: itemPattern, scope: 'production', kind: 'technique', subject_key: 'camera_movement',
      statement: 'Handheld is the house style.', source: 'historical_pattern', origin: 'inferred', authority_rank: 4,
      rationale: 'Repeated across previous Productions.', evidence: [{ kind: 'result' }], source_object_id: shotTwelve,
      source_object_label: 'Marcus close-up', source_revision: 4, source_object_revision: 4, source_changed: true,
      candidate_id: null, confirmed_by: null, confirmed_at: null, state: 'active', retired_at: null, retire_reason: '',
      supersedes_id: null, superseded_by: null, in_force: false, production_id: productionId, series_id: null,
      created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z', created_by: uid,
      scope_label: 'This Production', kind_label: 'Successful technique', source_label: 'Historical pattern',
      origin_label: 'Inferred and unconfirmed', state_label: 'Active',
      authority_line: 'Tier 4 of 5 - Historical pattern',
      force_line: 'Not in force: a stronger or newer memory outranks it.',
      source_line: 'The object this was drawn from has changed since; the remembered statement may no longer describe it.' },
  ],
  total: 2, limit: 100, offset: 0, truncated: false, note: LIMITATION, authority_rule: AUTHORITY_RULE,
};

const policies = {
  production_id: productionId, series_id: null,
  policies: [
    { scope: 'production', explicit: false, candidate_capture: true, auto_accept_candidates: false, note: 'Default policy.',
      updated_at: null, scope_label: 'This Production', explicit_label: 'Default policy',
      capture_label: 'TONDE may record pattern candidates for review.',
      accept_label: 'Nothing becomes memory without your explicit decision.' },
    { scope: 'workspace', explicit: true, candidate_capture: false, auto_accept_candidates: false,
      note: 'Never learn across Productions.', updated_at: '2026-10-04T09:00:00Z', scope_label: 'Entire workspace',
      explicit_label: 'Set by you', capture_label: 'TONDE will not record pattern candidates.',
      accept_label: 'Nothing becomes memory without your explicit decision.' },
  ],
  note: 'Memory policy decides whether TONDE may record pattern candidates.',
};

const candidates = {
  items: [
    { candidate_id: candidateOne, kind: 'technique', subject_key: 'apartment_product_emphasis',
      statement: 'For this apartment setup, lowering the camera 20-30 cm improved Product emphasis.',
      proposed_source: 'historical_pattern', basis: [{ kind: 'result', object_id: shotTwelve }], observed_count: 2,
      source_object_id: shotTwelve, source_object_label: 'Marcus close-up', source_revision: 4, source_changed: false,
      state: 'proposed', decided_by: null, decided_at: null, decision_note: '', created_at: '2026-10-05T10:00:00Z',
      state_label: 'Waiting for your decision', kind_label: 'Successful technique',
      proposed_source_label: 'Historical pattern' },
  ],
  total: 1, limit: 50, offset: 0, truncated: false, policy: policies.policies[0],
  note: 'A candidate is a proposal drawn from real evidence. It is never a creator preference until you accept it.',
};

const searchResult = {
  interpretation: { text: 'marcus', tokens: ['marcus'], kinds: ['shot', 'scene'], limit: 50, series_id: null,
    facets: [{ facet: 'asset', value: 'Marcus', meaning: 'Objects whose Scene includes this Asset, or that bind this Asset directly.' }],
    kind_labels: ['Shot', 'Scene'],
    facet_line: 'Objects whose Scene includes this Asset, or that bind this Asset directly.' },
  lanes: [{ lane: 'shot', total: 1, returned: 1, label: 'Shot' }, { lane: 'scene', total: 1, returned: 1, label: 'Scene' }],
  results: [
    { entity_type: 'shot', entity_id: shotTwelve, label: 'Marcus close-up', context: 'Scene 2 Kitchen',
      detail: 'Marcus leaves.', matched_on: 'Character/Product binding or Scene participant', entity_label: 'Shot' },
    { entity_type: 'memory_item', entity_id: itemPattern, label: 'Handheld is the house style.',
      context: 'This Production', detail: 'technique · historical_pattern · inferred', matched_on: 'memory text',
      in_force: false, source: 'historical_pattern', entity_label: 'Memory' },
  ],
  total: 2, returned: 2, truncated: false,
  notes: [SEARCH_LIMITATION,
    'Memory results say whether the remembered item is currently in force, so what TONDE is reusing is visible rather than implied.'],
  search_limitation: SEARCH_LIMITATION, authority_rule: AUTHORITY_RULE,
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

type Write = { path: string; search: string; body: Record<string, unknown> };

/** Stub the memory API at the network boundary and record every write and search. */
async function memoryApi(page: Page, writes: Write[], state: { accepted: boolean; capture: boolean }) {
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });
    if (path.endsWith('/memory/vocabulary')) return route.fulfill({ json: envelope(vocabulary) });
    if (path.endsWith('/memory/summary')) {
      return route.fulfill({ json: envelope({ ...summary,
        policy: { ...summary.policy, candidate_capture: state.capture },
      }) });
    }
    if (path.endsWith('/memory/items') && request.method() === 'GET') return route.fulfill({ json: envelope(items) });
    if (path.endsWith('/memory/items') && request.method() === 'POST') {
      writes.push({ path, search: url.search, body });
      return route.fulfill({ json: envelope({ item_id: 'item-new', updated: false, superseded_id: itemPattern,
        authority_rank: 1, scope: 'production', source: 'creator_instruction', origin: 'declared', in_force: true,
        note_text: 'Remembered with your authority at tier 1 of 5.' }) });
    }
    if (path.endsWith('/memory/resolve')) {
      return route.fulfill({ json: envelope({ subject_key: 'camera_movement',
        resolved: { item_id: itemHandheld, statement: "I don't want handheld anymore.", kind: 'correction',
          scope: 'production', source: 'creator_instruction', origin: 'declared', authority_rank: 1, confirmed: true,
          created_at: '2026-10-06T09:00:00Z', retired_at: null, in_force: true,
          source_label: 'Your current instruction', authority_line: 'Tier 1 of 5 - Your current instruction',
          force_line: 'In force' },
        considered: [
          { item_id: itemHandheld, statement: "I don't want handheld anymore.", kind: 'correction', scope: 'production',
            source: 'creator_instruction', origin: 'declared', authority_rank: 1, confirmed: true,
            created_at: '2026-10-06T09:00:00Z', retired_at: null, in_force: true,
            authority_line: 'Tier 1 of 5 - Your current instruction', force_line: 'In force' },
          { item_id: itemPattern, statement: 'Handheld is the house style.', kind: 'technique', scope: 'production',
            source: 'historical_pattern', origin: 'inferred', authority_rank: 4, confirmed: false,
            created_at: '2026-09-01T10:00:00Z', retired_at: null, in_force: false,
            authority_line: 'Tier 4 of 5 - Historical pattern', force_line: 'Outranked' }],
        explanation: 'Using the creator instruction recorded on 2026-10-06 (creator-confirmed). It outranks: historical_pattern.',
        note_text: AUTHORITY_RULE }) });
    }
    if (path.endsWith('/memory/policies') && request.method() === 'GET') return route.fulfill({ json: envelope(policies) });
    if (path.endsWith('/memory/policies') && request.method() === 'PUT') {
      writes.push({ path, search: url.search, body });
      state.capture = Boolean(body.candidate_capture);
      return route.fulfill({ json: envelope({ scope: 'production', explicit: true,
        candidate_capture: state.capture, auto_accept_candidates: false, note: '', updated_at: null,
        explicit_label: 'Set by you',
        capture_label: state.capture ? 'TONDE may record pattern candidates for review.' : 'TONDE will not record pattern candidates.',
        accept_label: 'Nothing becomes memory without your explicit decision.' }) });
    }
    if (path.endsWith('/memory/candidates') && request.method() === 'GET') {
      return route.fulfill({ json: envelope(state.accepted
        ? { ...candidates, items: [{ ...candidates.items[0], state: 'applied', state_label: 'Accepted',
            decided_by: uid, decided_at: '2026-10-05T12:00:00Z', decision_note: 'Accepted from Studio.' }], total: 1 }
        : candidates) });
    }
    if (path.includes('/memory/candidates/') && path.endsWith('/decide')) {
      writes.push({ path, search: url.search, body });
      state.accepted = body.decision === 'accept';
      return route.fulfill({ json: envelope({ candidate_id: candidateOne, state: state.accepted ? 'applied' : 'rejected',
        memory_item_id: state.accepted ? 'item-new' : null, authority_rank: 4, state_label: state.accepted ? 'Accepted' : 'Dismissed',
        note_text: state.accepted
          ? 'Remembered with your authority. It outranks an inference and any unconfirmed pattern, and a later instruction of yours outranks it.'
          : 'Dismissed. Nothing was remembered and the candidate stays readable as history.' }) });
    }
    if (path.endsWith('/memory/search')) {
      writes.push({ path, search: url.search, body });
      return route.fulfill({ json: envelope(searchResult) });
    }
    return route.fulfill({ json: envelope(null) });
  });
}

test('memory is inspectable, a pattern stays a proposal, and search returns real references (9C)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  const state = { accepted: false, capture: true };
  await memoryApi(page, writes, state);

  await page.goto(`/studio/${productionId}?tool=Memory`);

  // 1. The surface states the authority rule and the limits of memory and search up front.
  await expect(page.getByText(/Memory is inspectable production knowledge with real provenance/)).toBeVisible();
  await expect(page.getByText(/nothing here is a hidden behavioural profile/).first()).toBeVisible();
  await expect(page.getByText(AUTHORITY_RULE).first()).toBeVisible();

  // 2. What is remembered is reported, and the default policy is disclosed as the default.
  await expect(page.getByText(/3 remembered item\(s\) are active; 2 of them you confirmed/)).toBeVisible();
  await expect(page.getByText(/1 pattern candidate\(s\) are waiting for your decision/)).toBeVisible();
  await expect(page.getByText('Default policy').first()).toBeVisible();

  // 3. An item in force and an outranked item are both visible: the weak one is not hidden.
  await expect(page.getByText('In force: this is what TONDE is using for this subject.')).toBeVisible();
  await expect(page.getByText('Not in force: a stronger or newer memory outranks it.')).toBeVisible();
  await expect(page.getByText(/The object this was drawn from has changed since/)).toBeVisible();
  await expect(page.getByText('Tier 4 of 5 - Historical pattern')).toBeVisible();
  await expect(page.getByText('inferred', { exact: true })).toBeVisible();

  // 4. Remembering a statement sends the scope, the tier and the origin, never a fabricated one.
  await page.getByLabel('Memory subject key').fill('camera_movement');
  await page.getByLabel('Memory statement').fill("I don't want handheld anymore.");
  await page.getByLabel('Memory source', { exact: true }).selectOption('creator_instruction');
  await page.getByRole('button', { name: /Remember this/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/memory/items'))).toBe(true);
  const remembered = writes.find(write => write.path.endsWith('/memory/items'));
  expect(remembered?.body).toMatchObject({
    scope: 'production', kind: 'preference', subject_key: 'camera_movement',
    statement: "I don't want handheld anymore.", source: 'creator_instruction', origin: 'declared',
  });
  expect(remembered?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/memory/items`);
  await expect(page.getByText(/The previous statement of this tier was kept as history/)).toBeVisible();

  // 5. An inference has to disclose a basis before the surface will submit it. (The previous
  // success cleared the form, so refill the statement first and vary only the basis.)
  await page.getByLabel('Memory subject key').fill('camera_movement');
  await page.getByLabel('Memory statement').fill('Handheld suits the tense scenes.');
  await page.getByLabel('Memory origin').selectOption('inferred');
  await expect(page.getByText(/An inference without a basis is refused/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Remember this/ })).toBeDisabled();
  await page.getByLabel('Memory basis').fill('Observed on two accepted Results.');
  await expect(page.getByRole('button', { name: /Remember this/ })).toBeEnabled();
  await page.getByLabel('Memory origin').selectOption('declared');

  // 6. Why TONDE is using something names the winner and what it outranked.
  await page.getByRole('button', { name: /Explain the memory for this subject/ }).click();
  await expect(page.getByText(/It outranks: historical_pattern/).first()).toBeVisible();
  const resolvedCard = page.getByLabel('Why TONDE is using this');
  await expect(resolvedCard.getByText('Outranked')).toBeVisible();
  await expect(resolvedCard.getByText('Tier 1 of 5 - Your current instruction')).toBeVisible();

  // 7. A pattern candidate is a proposal: the surface says so and asks for a real decision.
  await expect(page.getByText(/It is never a creator preference until you accept it/)).toBeVisible();
  await expect(page.getByText(/observed 2 time\(s\)/)).toBeVisible();
  await expect(page.getByText(/drawn from Marcus close-up at revision 4/)).toBeVisible();
  await page.getByRole('button', { name: 'Accept as memory' }).click();
  await expect.poll(() => state.accepted).toBe(true);
  const decision = writes.find(write => write.path.includes('/memory/candidates/'));
  expect(decision?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/memory/candidates/${candidateOne}/decide`);
  expect(decision?.body).toEqual({ decision: 'accept', note: 'Accepted from Studio.' });
  await expect(page.getByText(/It outranks an inference and any unconfirmed pattern/)).toBeVisible();

  // 8. The memory policy is a creator decision and it is honoured, not just displayed.
  await page.getByRole('button', { name: /Stop recording candidates here/ }).click();
  await expect.poll(() => state.capture).toBe(false);
  const policyWrite = writes.find(write => write.path.endsWith('/memory/policies'));
  expect(policyWrite?.body).toEqual({ scope: 'production', series_id: null, candidate_capture: false,
    auto_accept_candidates: false, note: 'Default policy.' });
  await expect(page.getByText(/TONDE will not record pattern candidates/).first()).toBeVisible();

  // 9. Structured search sends only real facets and shows what each result actually matched on.
  await page.getByLabel('Search Asset name').fill('Marcus');
  await page.getByLabel('Search text').fill('marcus');
  await page.getByLabel('Search approval').selectOption('not_approved');
  await page.getByRole('button', { name: /Search this Production/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/memory/search'))).toBe(true);
  const searchWrite = writes.find(write => write.path.endsWith('/memory/search'));
  const query = new URLSearchParams(searchWrite?.search ?? '');
  expect(query.get('asset_name')).toBe('Marcus');
  expect(query.get('text')).toBe('marcus');
  expect(query.get('approval')).toBe('not_approved');
  expect(query.get('kinds')).toBe('shot,scene');
  const searchRegion = page.getByLabel('Structured production search');
  await expect(searchRegion.getByText('Marcus close-up')).toBeVisible();
  await expect(searchRegion.getByText(/Matched on: Character\/Product binding or Scene participant/).first()).toBeVisible();
  await expect(searchRegion.getByText(/2 object\(s\) matched · 2 shown/)).toBeVisible();
  await expect(searchRegion.getByText(/does not use embeddings and it does not read media/).first()).toBeVisible();
  await expect(searchRegion.getByText(/Objects whose Scene includes this Asset/).first()).toBeVisible();

  // 10. There is no approval here: memory is knowledge, and accepting a candidate is not an approval.
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);

  // 11. A narrow viewport keeps the surface usable and never overflows horizontally.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText(/Memory is inspectable production knowledge with real provenance/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  expect(errors).toEqual([]);
});
