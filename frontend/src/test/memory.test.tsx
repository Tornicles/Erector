import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionMemoryCanvas } from '../studio/ProductionMemory';
import { productionMemoryService } from '../services/productionMemory';
import { AppError } from '../services/errors';

vi.mock('../services/productionMemory', () => ({
  productionMemoryService: {
    vocabulary: vi.fn(), summary: vi.fn(), items: vi.fn(), recordItem: vi.fn(), retireItem: vi.fn(),
    resolve: vi.fn(), policies: vi.fn(), setPolicy: vi.fn(), candidates: vi.fn(), recordCandidate: vi.fn(),
    decideCandidate: vi.fn(), search: vi.fn(),
  },
  SEARCH_KINDS: ['shot', 'scene', 'plan', 'result', 'continuity_finding', 'continuity_state', 'memory', 'asset'],
  WRITABLE_ORIGINS: ['declared', 'inferred'],
  CANDIDATE_SOURCES: ['saved_preference', 'historical_pattern', 'inference'],
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const character = '00000000-0000-4000-8000-000000000801';
const shotTwelve = '00000000-0000-4000-8000-000000000401';
const itemHandheld = '00000000-0000-4000-8000-000000000901';
const itemPattern = '00000000-0000-4000-8000-000000000902';
const candidateOne = '00000000-0000-4000-8000-000000000a01';

const LIMITATION = 'Memory is what this Production recorded and what you confirmed. An unconfirmed inference is labelled as an inference, and nothing here is a hidden behavioural profile.';
const AUTHORITY_RULE = 'A current creator instruction outranks a current Production decision, which outranks an explicit saved preference, which outranks a historical pattern, which outranks an inference.';
const SEARCH_LIMITATION = 'Search reads structured production state and returns real object references. It does not use embeddings and it does not read media.';

const vocabulary = {
  scopes: [{ scope: 'production' as const, label: 'This Production' }, { scope: 'series' as const, label: 'This Series' },
    { scope: 'workspace' as const, label: 'Entire workspace' }],
  kinds: [{ kind: 'preference' as const, label: 'Preference' }, { kind: 'technique' as const, label: 'Successful technique' },
    { kind: 'correction' as const, label: 'Your correction' }],
  sources: [
    { source: 'creator_instruction' as const, label: 'Your current instruction', authority_rank: 1, strength: 5 },
    { source: 'production_decision' as const, label: 'Current Production decision', authority_rank: 2, strength: 4 },
    { source: 'saved_preference' as const, label: 'Saved preference', authority_rank: 3, strength: 3 },
    { source: 'historical_pattern' as const, label: 'Historical pattern', authority_rank: 4, strength: 2 },
    { source: 'inference' as const, label: 'Inferred by TONDE', authority_rank: 5, strength: 1 },
  ],
  origins: [{ origin: 'declared' as const, label: 'You said it' }, { origin: 'accepted' as const, label: 'You accepted a candidate' },
    { origin: 'inferred' as const, label: 'Inferred and unconfirmed' }],
  item_states: [{ state: 'active', label: 'Active' }],
  candidate_states: [{ state: 'proposed' as const, label: 'Waiting for your decision' }],
  search_kinds: [{ kind: 'shot' as const, label: 'Shot' }],
  authority_rule: AUTHORITY_RULE,
  rule: 'Memory is inspectable production knowledge with real provenance, not hidden conversational memory. Nothing becomes reusable memory from a single Shot without an explicit policy or your decision.',
  limitation: LIMITATION,
  search_limitation: SEARCH_LIMITATION,
};

const summary = {
  items: { active: 3, archived: 1, subjects: 2, creator_confirmed: 2, inferred: 1, sources_changed: 0 },
  by_scope: { production: 3 }, by_source: { saved_preference: 2 },
  candidates: { proposed: 1, applied: 0, rejected: 0 },
  policy: { scope: 'production' as const, explicit: false, candidate_capture: true, auto_accept_candidates: false,
    note: 'Default policy.', updated_at: null, explicit_label: 'Default policy',
    capture_label: 'TONDE may record pattern candidates for review.',
    accept_label: 'Nothing becomes memory without your explicit decision.' },
  series_id: null, limitations: LIMITATION,
  summary_line: '3 remembered item(s) are active; 2 of them you confirmed.',
  candidate_line: '1 pattern candidate(s) are waiting for your decision.',
  changed_line: 'Every remembered item still points at the revision it was drawn from.',
};

const items = {
  items: [
    { item_id: itemHandheld, scope: 'production' as const, kind: 'preference' as const, subject_key: 'camera_movement',
      statement: 'Handheld when the scene is tense.', source: 'saved_preference' as const, origin: 'declared' as const,
      authority_rank: 3, rationale: '', evidence: [], source_object_id: character, source_object_label: 'Marcus',
      source_revision: 2, source_object_revision: 2, source_changed: false, candidate_id: null, confirmed_by: 'u',
      confirmed_at: '2026-10-05T10:00:00Z', state: 'active', retired_at: null, retire_reason: '',
      supersedes_id: null, superseded_by: null, in_force: true, production_id: productionId, series_id: null,
      created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z', created_by: 'u',
      scope_label: 'This Production', kind_label: 'Preference', source_label: 'Saved preference',
      origin_label: 'You said it', authority_line: 'Tier 3 of 5 - Saved preference',
      force_line: 'In force: this is what TONDE is using for this subject.',
      source_line: 'Drawn from Marcus at revision 2' },
    { item_id: itemPattern, scope: 'production' as const, kind: 'technique' as const, subject_key: 'camera_movement',
      statement: 'Handheld is the house style.', source: 'historical_pattern' as const, origin: 'inferred' as const,
      authority_rank: 4, rationale: 'Repeated across previous Productions.', evidence: [{ kind: 'result' }],
      source_object_id: shotTwelve, source_object_label: null, source_revision: 4, source_object_revision: 4,
      source_changed: true, candidate_id: null, confirmed_by: null, confirmed_at: null, state: 'active',
      retired_at: null, retire_reason: '', supersedes_id: null, superseded_by: null, in_force: false,
      production_id: productionId, series_id: null, created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T10:00:00Z', created_by: 'u', scope_label: 'This Production',
      kind_label: 'Successful technique', source_label: 'Historical pattern', origin_label: 'Inferred and unconfirmed',
      authority_line: 'Tier 4 of 5 - Historical pattern',
      force_line: 'Not in force: a stronger or newer memory outranks it.',
      source_line: 'The object this was drawn from has changed since; the remembered statement may no longer describe it.' },
  ],
  total: 2, limit: 100, offset: 0, truncated: false, note: LIMITATION, authority_rule: AUTHORITY_RULE,
};

const policies = {
  production_id: productionId, series_id: null,
  policies: [
    { scope: 'production' as const, explicit: false, candidate_capture: true, auto_accept_candidates: false,
      note: 'Default policy.', updated_at: null, scope_label: 'This Production', explicit_label: 'Default policy',
      capture_label: 'TONDE may record pattern candidates for review.',
      accept_label: 'Nothing becomes memory without your explicit decision.' },
  ],
  note: 'Memory policy decides whether TONDE may record pattern candidates.',
};

const candidates = {
  items: [
    { candidate_id: candidateOne, kind: 'technique' as const, subject_key: 'apartment_product_emphasis',
      statement: 'For this apartment setup, lowering the camera 20-30 cm improved Product emphasis.',
      proposed_source: 'historical_pattern' as const, basis: [{ kind: 'result', object_id: shotTwelve }],
      observed_count: 2, source_object_id: shotTwelve, source_object_label: 'Shot 12', source_revision: 4,
      source_changed: false, state: 'proposed' as const, decided_by: null, decided_at: null, decision_note: '',
      created_at: '2026-10-05T10:00:00Z', state_label: 'Waiting for your decision',
      kind_label: 'Successful technique', proposed_source_label: 'Historical pattern' },
  ],
  total: 1, limit: 50, offset: 0, truncated: false,
  policy: policies.policies[0],
  note: 'A candidate is a proposal drawn from real evidence. It is never a creator preference until you accept it.',
};

const searchResult = {
  interpretation: { text: 'marcus', tokens: ['marcus'], kinds: ['shot' as const, 'scene' as const], limit: 50,
    series_id: null,
    facets: [{ facet: 'asset', value: 'Marcus', meaning: 'Objects whose Scene includes this Asset, or that bind this Asset directly.' }],
    kind_labels: ['Shot', 'Scene'],
    facet_line: 'Objects whose Scene includes this Asset, or that bind this Asset directly.' },
  lanes: [{ lane: 'shot' as const, total: 2, returned: 2, label: 'Shot' }],
  results: [
    { entity_type: 'shot', entity_id: shotTwelve, label: 'Marcus close-up', context: 'Scene 2 Kitchen',
      detail: 'He turns to leave.', matched_on: 'Character/Product binding or Scene participant',
      entity_label: 'Shot' },
    { entity_type: 'memory_item', entity_id: itemPattern, label: 'Handheld is the house style.',
      context: 'This Production', detail: 'technique · historical_pattern · inferred', matched_on: 'memory text',
      in_force: false, source: 'historical_pattern' as const, entity_label: 'Memory' },
  ],
  total: 2, returned: 2, truncated: false,
  notes: ['Search reads structured production state and returns real object references. It does not use embeddings and it does not read media.',
    'Memory results say whether the remembered item is currently in force, so what TONDE is reusing is visible rather than implied.'],
  search_limitation: SEARCH_LIMITATION,
  authority_rule: AUTHORITY_RULE,
};

const emptySearch = {
  ...searchResult,
  lanes: [], results: [], total: 0, returned: 0,
  notes: ['No Asset in this workspace matches "Nobody Here". Nothing was searched, because ignoring the filter would return unrelated objects.'],
};

const services = productionMemoryService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const renderCanvas = (overrides: { busy?: boolean } = {}) => render(
  <ProductionMemoryCanvas workspaceId={workspaceId} productionId={productionId}
    assets={[{ id: character, name: 'Marcus', asset_type: 'character' }]}
    busy={overrides.busy ?? false} onChanged={vi.fn()} />,
);

const waitForVocabulary = async () => {
  // The authority select is fed by the single source of truth for source labels, so waiting for a
  // real option proves the loaded vocabulary rather than a hardcoded list.
  await waitFor(() => expect(screen.getByRole('option', { name: 'Your current instruction' })).toBeTruthy());
};

describe('ProductionMemoryCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.vocabulary.mockResolvedValue(vocabulary);
    services.summary.mockResolvedValue(summary);
    services.items.mockResolvedValue(items);
    services.policies.mockResolvedValue(policies);
    services.candidates.mockResolvedValue(candidates);
    services.search.mockResolvedValue(searchResult);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('shows the authority tiers and the limits of memory and search', async () => {
    renderCanvas();
    await waitForVocabulary();
    expect(screen.getByText('What does TONDE remember about making this Production, and why is it using it?')).toBeTruthy();
    const tiers = screen.getAllByText(/Tier \d/);
    expect(tiers.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(/inferred and unconfirmed/)).toBeTruthy();
    expect(screen.getByText(AUTHORITY_RULE)).toBeTruthy();
    expect(screen.getAllByText(LIMITATION)[0]).toBeTruthy();
  });

  it('reports what is remembered and whether the source has moved', async () => {
    renderCanvas();
    await waitForVocabulary();
    expect(screen.getByText(/3 remembered item\(s\) are active; 2 of them you confirmed\./)).toBeTruthy();
    expect(screen.getByText(/1 pattern candidate\(s\) are waiting for your decision\./)).toBeTruthy();
    expect(screen.getByText(/Every remembered item still points at the revision it was drawn from\./)).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(services.items).toHaveBeenCalledWith(workspaceId, productionId, { state: 'active' });
  });

  it('marks an item in force and shows an outranked one as outranked rather than hiding it', async () => {
    renderCanvas();
    await waitForVocabulary();
    expect(screen.getByText('In force: this is what TONDE is using for this subject.')).toBeTruthy();
    expect(screen.getByText('Not in force: a stronger or newer memory outranks it.')).toBeTruthy();
    expect(screen.getByText(/The object this was drawn from has changed since/)).toBeTruthy();
    expect(screen.getByText(/Drawn from Marcus at revision 2/)).toBeTruthy();
    expect(screen.getByText('inferred')).toBeTruthy();
  });

  it('refuses to remember an inference without a basis and never offers an approval control', async () => {
    renderCanvas();
    await waitForVocabulary();
    fireEvent.change(screen.getByLabelText('Memory subject key'), { target: { value: 'lighting_style' } });
    fireEvent.change(screen.getByLabelText('Memory statement'), { target: { value: 'Softer key, less fill.' } });
    fireEvent.change(screen.getByLabelText('Memory origin'), { target: { value: 'inferred' } });
    expect(screen.getByText(/An inference without a basis is refused/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Remember this/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^approve/i })).toBeNull();
    // A candidate gets a creator decision, not an approval: accepting one is the only way a
    // proposal becomes memory, and it is not an approval of any Production object.
    expect(screen.getByRole('button', { name: 'Accept as memory' })).toBeTruthy();
  });

  it('remembers a statement with its scope, tier and origin', async () => {
    services.recordItem.mockResolvedValue({ item_id: 'new', updated: false, superseded_id: itemPattern,
      authority_rank: 1, scope: 'production', source: 'creator_instruction', origin: 'declared', in_force: true,
      note_text: 'Remembered with your authority at tier 1 of 5.' });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.change(screen.getByLabelText('Memory subject key'), { target: { value: 'camera_movement' } });
    fireEvent.change(screen.getByLabelText('Memory statement'), { target: { value: "I don't want handheld anymore." } });
    fireEvent.change(screen.getByLabelText('Memory source'), { target: { value: 'creator_instruction' } });
    fireEvent.change(screen.getByLabelText('Memory source object'), { target: { value: character } });
    fireEvent.click(screen.getByRole('button', { name: /Remember this/ }));
    await waitFor(() => expect(services.recordItem).toHaveBeenCalled());
    const call = services.recordItem.mock.calls[0][2];
    expect(call.scope).toBe('production');
    expect(call.subjectKey).toBe('camera_movement');
    expect(call.statement).toBe("I don't want handheld anymore.");
    expect(call.source).toBe('creator_instruction');
    expect(call.origin).toBe('declared');
    expect(call.sourceObjectId).toBe(character);
    expect(call.evidence).toEqual([]);
    await waitFor(() => expect(screen.getByText(/The previous statement of this tier was kept as history\./)).toBeTruthy());
  });

  it('sends the basis with an inferred memory item', async () => {
    services.recordItem.mockResolvedValue({ item_id: 'new', updated: false, superseded_id: null,
      authority_rank: 4, scope: 'production', source: 'historical_pattern', origin: 'inferred', in_force: true,
      note_text: 'This is an inferred memory item.' });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.change(screen.getByLabelText('Memory subject key'), { target: { value: 'apartment_key' } });
    fireEvent.change(screen.getByLabelText('Memory statement'), { target: { value: 'Lower the camera for Product emphasis.' } });
    fireEvent.change(screen.getByLabelText('Memory source'), { target: { value: 'historical_pattern' } });
    fireEvent.change(screen.getByLabelText('Memory origin'), { target: { value: 'inferred' } });
    fireEvent.change(screen.getByLabelText('Memory basis'), { target: { value: 'Two accepted Results improved.' } });
    fireEvent.click(screen.getByRole('button', { name: /Remember this/ }));
    await waitFor(() => expect(services.recordItem).toHaveBeenCalled());
    const call = services.recordItem.mock.calls[0][2];
    expect(call.origin).toBe('inferred');
    expect(call.evidence).toEqual([{ kind: 'note', text: 'Two accepted Results improved.' }]);
    expect(call.rationale).toBe('Two accepted Results improved.');
  });

  it('explains why TONDE is using something and what it outranked', async () => {
    services.resolve.mockResolvedValue({ subject_key: 'camera_movement',
      resolved: { item_id: itemHandheld, statement: 'Handheld when the scene is tense.', kind: 'preference',
        scope: 'production', source: 'saved_preference', origin: 'declared', authority_rank: 3, confirmed: true,
        created_at: '2026-10-05T10:00:00Z', retired_at: null, in_force: true,
        authority_line: 'Tier 3 of 5 - Saved preference', force_line: 'In force' },
      considered: [
        { item_id: itemHandheld, statement: 'Handheld when the scene is tense.', kind: 'preference',
          scope: 'production', source: 'saved_preference', origin: 'declared', authority_rank: 3, confirmed: true,
          created_at: '2026-10-05T10:00:00Z', retired_at: null, in_force: true,
          authority_line: 'Tier 3 of 5 - Saved preference', force_line: 'In force' },
        { item_id: itemPattern, statement: 'Handheld is the house style.', kind: 'technique', scope: 'production',
          source: 'historical_pattern', origin: 'inferred', authority_rank: 4, confirmed: false,
          created_at: '2026-09-01T10:00:00Z', retired_at: null, in_force: false,
          authority_line: 'Tier 4 of 5 - Historical pattern', force_line: 'Outranked' }],
      explanation: 'Using the saved preference recorded on 2026-10-05 (creator-confirmed). It outranks: historical_pattern.',
      note_text: AUTHORITY_RULE });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.change(screen.getByLabelText('Resolution subject key'), { target: { value: 'camera_movement' } });
    fireEvent.click(screen.getByRole('button', { name: /Explain the memory for this subject/ }));
    await waitFor(() => expect(services.resolve).toHaveBeenCalledWith(workspaceId, productionId, 'camera_movement'));
    await waitFor(() => expect(screen.getAllByText(/It outranks: historical_pattern/).length).toBeGreaterThan(0));
    const resolved = within(screen.getByLabelText('Why TONDE is using this'));
    expect(resolved.getByText('In force')).toBeTruthy();
    expect(resolved.getByText('Outranked')).toBeTruthy();
  });

  it('retires a remembered item without deleting it', async () => {
    services.retireItem.mockResolvedValue({ item_id: itemHandheld, state: 'archived',
      retired_at: '2026-10-05T12:00:00Z', retire_reason: 'Retired from Studio.',
      note_text: 'The item stays readable as history. Nothing TONDE recorded was deleted.' });
    renderCanvas();
    await waitForVocabulary();
    const retire = screen.getAllByRole('button', { name: /Retire/ })[0];
    fireEvent.click(retire);
    await waitFor(() => expect(services.retireItem).toHaveBeenCalledWith(workspaceId, productionId, itemHandheld, 'Retired from Studio.'));
    await waitFor(() => expect(screen.getByText(/Nothing TONDE recorded was deleted\./)).toBeTruthy());
  });

  it('treats a pattern as a proposal and accepts or dismisses it explicitly', async () => {
    services.decideCandidate.mockResolvedValue({ candidate_id: candidateOne, state: 'applied',
      memory_item_id: 'item-new', authority_rank: 4,
      note_text: 'Remembered with your authority. It outranks an inference and any unconfirmed pattern.' });
    renderCanvas();
    await waitForVocabulary();
    expect(screen.getByText(/never a creator preference until you accept it/)).toBeTruthy();
    expect(screen.getByText(/observed 2 time\(s\)/)).toBeTruthy();
    expect(screen.getByText(/drawn from Shot 12 at revision 4/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept as memory' }));
    await waitFor(() => expect(services.decideCandidate).toHaveBeenCalledWith(workspaceId, productionId, candidateOne,
      { decision: 'accept', note: 'Accepted from Studio.' }));
    await waitFor(() => expect(screen.getByText(/It outranks an inference/)).toBeTruthy());
  });

  it('lets the creator change the memory policy, and says what an auto-accepted candidate is', async () => {
    services.setPolicy.mockResolvedValue({ scope: 'production', explicit: true, candidate_capture: false,
      auto_accept_candidates: false, note: '', updated_at: null,
      capture_label: 'TONDE will not record pattern candidates.' });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getByRole('button', { name: /Stop recording candidates here/ }));
    await waitFor(() => expect(services.setPolicy).toHaveBeenCalledWith(workspaceId, productionId, {
      scope: 'production', candidateCapture: false, autoAcceptCandidates: false, note: 'Default policy.' }));
    await waitFor(() => expect(screen.getByText(/TONDE will not record pattern candidates\./)).toBeTruthy());
  });

  it('searches real production state with the chosen kinds and shows what matched', async () => {
    renderCanvas();
    await waitForVocabulary();
    fireEvent.change(screen.getByLabelText('Search Asset name'), { target: { value: 'Marcus' } });
    fireEvent.change(screen.getByLabelText('Search text'), { target: { value: 'marcus' } });
    fireEvent.click(screen.getByRole('button', { name: /Search this Production/ }));
    await waitFor(() => expect(services.search).toHaveBeenCalled());
    const call = services.search.mock.calls[0][2];
    expect(call.kinds).toEqual(['shot', 'scene']);
    expect(call.assetName).toBe('Marcus');
    expect(call.text).toBe('marcus');
    expect(call.approval).toBeNull();
    await waitFor(() => expect(screen.getByText(/2 object\(s\) matched · 2 shown/)).toBeTruthy());
    expect(screen.getByText('Marcus close-up')).toBeTruthy();
    expect(screen.getByText(/Matched on: Character\/Product binding or Scene participant/)).toBeTruthy();
    expect(screen.getByText('Outranked')).toBeTruthy();
    const searchSection = within(screen.getByLabelText('Structured production search'));
    expect(searchSection.getAllByText(/does not use embeddings/).length).toBeGreaterThan(0);
    expect(searchSection.getAllByText(/Objects whose Scene includes this Asset/).length).toBeGreaterThan(0);
  });

  it('says nothing matched when a named Character or Product does not exist', async () => {
    services.search.mockResolvedValue(emptySearch);
    renderCanvas();
    await waitForVocabulary();
    fireEvent.change(screen.getByLabelText('Search Asset name'), { target: { value: 'Nobody Here' } });
    fireEvent.click(screen.getByRole('button', { name: /Search this Production/ }));
    await waitFor(() => expect(screen.getByText(/No Asset in this workspace matches "Nobody Here"/)).toBeTruthy());
    expect(screen.getByText(/returns nothing rather than everything/)).toBeTruthy();
  });

  it('reports a failure as an alert instead of pretending the memory loaded', async () => {
    services.summary.mockRejectedValue(new AppError('unavailable', 'Production memory is unavailable.'));
    renderCanvas();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Production memory is unavailable.');
  });
});
