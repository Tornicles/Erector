import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionContinuityCanvas } from '../studio/ProductionContinuity';
import { productionContinuityService } from '../services/productionContinuity';
import { AppError } from '../services/errors';

vi.mock('../services/productionContinuity', () => ({
  productionContinuityService: {
    vocabulary: vi.fn(), summary: vi.fn(), states: vi.fn(), recordStatement: vi.fn(),
    retireStatement: vi.fn(), chain: vi.fn(), check: vi.fn(), findings: vi.fn(),
    updateFinding: vi.fn(), recordProposal: vi.fn(),
  },
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const character = '00000000-0000-4000-8000-000000000801';
const sceneEighteen = '00000000-0000-4000-8000-000000000301';
const sceneNineteen = '00000000-0000-4000-8000-000000000302';
const shotTwelve = '00000000-0000-4000-8000-000000000401';
const stateTorn = '00000000-0000-4000-8000-000000000e01';
const stateBlood = '00000000-0000-4000-8000-000000000e02';
const stateClean = '00000000-0000-4000-8000-000000000e03';
const checkId = '00000000-0000-4000-8000-000000000f01';
const findingBreak = '00000000-0000-4000-8000-000000000f11';
const findingProposal = '00000000-0000-4000-8000-000000000f12';

const LIMITATION = 'Continuity here is what the Production records. It does not analyse media, and an unrecorded trait is unknown rather than consistent.';

const vocabulary = {
  domains: [{ domain: 'character' as const, label: 'Character' }, { domain: 'wardrobe' as const, label: 'Wardrobe' }],
  anchors: [{ anchor: 'production' as const, label: 'Whole Production' }, { anchor: 'scene_opening' as const, label: 'Scene opening' },
    { anchor: 'scene_ending' as const, label: 'Scene ending' }, { anchor: 'shot' as const, label: 'Shot' }],
  transitions: [{ transition: 'baseline' as const, label: 'First statement' },
    { transition: 'continuous' as const, label: 'Continues unchanged' }, { transition: 'changed' as const, label: 'Declared change' }],
  finding_kinds: [{ kind: 'boundary_break' as const, label: 'Break across a Scene boundary' }],
  finding_states: [{ state: 'open' as const, label: 'Open' }],
  severities: [{ severity: 'critical' as const, label: 'Conflict' }],
  rules: [
    { kind: 'boundary_break' as const, severity: 'critical' as const, description: 'A trait changes across a Scene boundary without a declared change.' },
    { kind: 'unexplained_change' as const, severity: 'warning' as const, description: 'A trait changes inside one Scene while the statement says it continues unchanged.' },
    { kind: 'lock_conflict' as const, severity: 'critical' as const, description: 'A declared change touches a subject the creator protected with a continuity lock.' },
    { kind: 'missing_reason' as const, severity: 'warning' as const, description: 'A change was declared with no reason, so later Shots cannot be checked against it.' },
    { kind: 'unverified_after' as const, severity: 'info' as const, description: 'The last statement for a trait is a declared change and later work has none: continuity there is unknown.' },
  ],
  rule: 'Continuity is temporal: a statement records what one trait of one subject is at one point in Production order, and a change is declared rather than inferred.',
  limitation: LIMITATION,
};

const summary = {
  live_states: 3, retired_states: 1, subject_count: 1,
  domains: [{ domain: 'character' as const, count: 2, label: 'Character' }, { domain: 'wardrobe' as const, count: 1, label: 'Wardrobe' }],
  check: {
    check_id: checkId, verdict: 'conflict' as const, verdict_label: 'Conflict', counts: { critical: 1, warning: 0, info: 0 },
    explanation: '1 continuity conflict needs a creator decision.', limitations: LIMITATION,
    created_at: '2026-10-05T10:00:00Z', is_current: true,
    freshness: 'This check matches the recorded statements.',
    summary: '1 continuity conflict(s) need a creator decision.', state_count: 3,
  },
  findings: { open: 1, acknowledged: 0, critical_open: 1 },
  analysis_stale: false, stale_label: 'The recorded continuity analysis matches the statements.', limitations: LIMITATION,
};

const statements = {
  items: [
    { state_id: stateBlood, domain: 'character' as const, subject_object_id: character, subject_label: 'Marcus',
      trait: 'shirt condition', anchor: 'scene_ending' as const, scene_id: sceneEighteen, shot_id: null,
      scene_label: 'Scene 18', shot_label: null, value: 'blood on the left shoulder', transition: 'changed' as const,
      origin: 'declared' as const, epistemic: 'observed' as const, confidence: 'high' as const,
      reason: 'Marcus is injured in the kitchen.', retired: false, revision: 1, created_at: '2026-10-05T10:00:00Z',
      domain_label: 'Character', anchor_label: 'Scene ending', transition_label: 'Declared change', origin_label: 'Declared by you' },
    { state_id: stateTorn, domain: 'character' as const, subject_object_id: character, subject_label: 'Marcus',
      trait: 'shirt condition', anchor: 'scene_opening' as const, scene_id: sceneEighteen, shot_id: null,
      scene_label: 'Scene 18', shot_label: null, value: 'clean shirt', transition: 'baseline' as const,
      origin: 'declared' as const, epistemic: 'observed' as const, confidence: 'high' as const, reason: 'First appearance.',
      retired: true, retire_reason: 'Superseded by a newer statement at the same point in the Production.',
      revision: 2, created_at: '2026-10-05T09:00:00Z', domain_label: 'Character', anchor_label: 'Scene opening',
      transition_label: 'First statement', origin_label: 'Declared by you' },
  ],
  total: 2, live: 1, limit: 100, offset: 0, truncated: false, limitation: LIMITATION,
};

const findingBase = {
  domain: 'character' as const, trait: 'shirt condition', subject_object_id: character, subject_label: 'Marcus',
  earlier_state_id: stateBlood, later_state_id: stateClean, scene_id: sceneNineteen, shot_id: null,
  scene_label: 'Scene 19', shot_label: null,
  explanation: 'The trait "shirt condition" was "blood on the left shoulder" at Scene 18 ending and is "shirt clean" at Scene 19 opening across a Scene boundary, and no change was declared.',
  suggested_resolution: 'Confirm the state actually carries over, or declare the change and the reason for it.',
  confidence: 'high' as const, evidence: [{ kind: 'continuity_state', object_id: stateBlood }],
  state: 'open' as const, resolution_note: '', resolved_at: null, check_id: checkId, created_at: '2026-10-05T10:00:00Z',
  severity_label: 'Conflict', kind_label: 'Break across a Scene boundary', state_label: 'Open',
  domain_label: 'Character', epistemic_label: 'Observed', subject_line: 'Marcus - shirt condition',
};

const secondFinding = {
  ...findingBase, finding_id: findingProposal, kind: 'unexplained_change' as const, severity: 'warning' as const,
  origin: 'inferred' as const, rationale: 'Two statements disagree across the cut and no change is declared.',
  epistemic: 'estimated' as const, confidence: 'low' as const, check_id: null,
  explanation: 'The wardrobe may not match the injury across the cut.',
  suggested_resolution: 'Check the Scene 19 continuity photograph.',
  severity_label: 'Caution', kind_label: 'Unexplained change', origin_label: 'Inferred (proposal)',
  epistemic_label: 'Estimated', state_label: 'Open',
};

const findings = {
  items: [{ ...findingBase, finding_id: findingBreak, kind: 'boundary_break' as const, severity: 'critical' as const,
    origin: 'derived' as const, rationale: '', epistemic: 'observed' as const }, secondFinding],
  total: 2, limit: 100, offset: 0, truncated: false,
  check: {
    check_id: checkId, verdict: 'conflict' as const, verdict_label: 'Conflict', counts: { critical: 1, warning: 0, info: 0 },
    explanation: '1 continuity conflict needs a creator decision.', limitations: LIMITATION,
    created_at: '2026-10-05T10:00:00Z', is_current: true,
    freshness: 'This check matches the recorded statements.',
    summary: '1 continuity conflict(s) need a creator decision.', state_count: 3,
  },
  checks_available: 2, open_count: 2,
  note: 'A finding describes the recorded statements. Resolving it is a creator decision and does not change the statements.',
  open_label: '2 finding(s) are still open.', limitation: LIMITATION,
};

// The domain list is the shared vocabulary, so the form is only usable once it has loaded: the
// test waits for a real option rather than setting a value the select cannot hold.
const setFields = async (domain = 'character', trait = 'shirt condition', value = 'torn shirt') => {
  await screen.findByRole('option', { name: 'Character' });
  fireEvent.change(screen.getByLabelText('Continuity domain'), { target: { value: domain } });
  fireEvent.change(screen.getByLabelText('Continuity trait'), { target: { value: trait } });
  fireEvent.change(screen.getByLabelText('Continuity value'), { target: { value: value } });
};

function mount(overrides: { selectedShotId?: string | null; selectedSceneId?: string | null } = {}) {
  const onChanged = vi.fn();
  render(<ProductionContinuityCanvas workspaceId={workspaceId} productionId={productionId}
    assets={[{ id: character, name: 'Marcus', asset_type: 'character' }]}
    selectedSceneId={overrides.selectedSceneId === undefined ? sceneEighteen : overrides.selectedSceneId}
    selectedShotId={overrides.selectedShotId === undefined ? shotTwelve : overrides.selectedShotId}
    sceneTitle="Scene 18" shotTitle="Shot 12" busy={false} onChanged={onChanged} />);
  return { onChanged };
}

beforeEach(() => {
  vi.mocked(productionContinuityService.vocabulary).mockResolvedValue(vocabulary);
  vi.mocked(productionContinuityService.summary).mockResolvedValue(summary);
  vi.mocked(productionContinuityService.states).mockResolvedValue(statements);
  vi.mocked(productionContinuityService.findings).mockResolvedValue(findings);
  vi.mocked(productionContinuityService.recordStatement).mockResolvedValue({
    state_id: stateBlood, updated: false, superseded_state_id: stateTorn,
    note: 'The previous statement at this point was kept and marked as superseded.' });
  vi.mocked(productionContinuityService.retireStatement).mockResolvedValue({
    state_id: stateBlood, retired: true, note: 'The statement is retired, not deleted: its history stays readable.' });
  vi.mocked(productionContinuityService.chain).mockResolvedValue({
    subject_object_id: character, subject_label: 'Marcus', statement_count: 3,
    statements: [
      { state_id: stateTorn, domain: 'character', trait: 'shirt condition', anchor: 'scene_opening',
        position_label: 'Scene 18 opening', scene_id: sceneEighteen, shot_id: null, value: 'torn shirt',
        transition: 'baseline', origin: 'declared', epistemic: 'observed', confidence: 'high', reason: 'First appearance.',
        domain_label: 'Character', anchor_label: 'Scene opening', transition_label: 'First statement' },
      { state_id: stateBlood, domain: 'character', trait: 'shirt condition', anchor: 'scene_ending',
        position_label: 'Scene 18 ending', scene_id: sceneEighteen, shot_id: null, value: 'blood on the left shoulder',
        transition: 'changed', origin: 'declared', epistemic: 'observed', confidence: 'high',
        reason: 'Marcus is injured in the kitchen.', domain_label: 'Character', anchor_label: 'Scene ending',
        transition_label: 'Declared change' },
    ],
    note: 'This is the recorded timeline of the subject. It lists declared statements in Production order.',
    limitation: LIMITATION,
  });
  vi.mocked(productionContinuityService.check).mockResolvedValue({
    check_id: checkId, verdict: 'conflict', verdict_label: 'Conflict', counts: { critical: 1, warning: 0, info: 0 },
    finding_count: 1, state_count: 3, production_revision: 9, state_watermark: '2026-10-05T10:00:00Z',
    explanation: '1 continuity conflict needs a creator decision.', limitations: LIMITATION,
    created_at: '2026-10-05T10:00:00Z',
    findings: [{ ...findingBase, finding_id: findingBreak, kind: 'boundary_break', severity: 'critical',
      origin: 'derived', rationale: '', epistemic: 'observed' }],
    rule: 'A check compares the continuity statements recorded for this Production. It changes no statement, and it does not analyse media.',
    limitation: LIMITATION,
  });
  vi.mocked(productionContinuityService.updateFinding).mockResolvedValue({
    finding_id: findingBreak, state: 'resolved', resolution_note: 'Decided from Studio: resolved.',
    note: 'The finding was recorded. The continuity statements and any approval are unchanged.' });
});

afterEach(() => { vi.clearAllMocks(); });

describe('Continuity', () => {
  it('states the temporal rule and what a check cannot see', async () => {
    mount();
    expect(await screen.findByText(/What does this Production say is true/)).toBeInTheDocument();
    expect(await screen.findByText(/a change is declared rather than inferred/)).toBeInTheDocument();
    expect(screen.getAllByText(/It does not analyse media/).length).toBeGreaterThan(0);
  });

  it('summarises what is recorded and whether the last check still matches it', async () => {
    mount();
    const counts = await screen.findByLabelText('Continuity summary');
    expect(counts).toHaveTextContent('Live statements');
    expect(counts).toHaveTextContent('Superseded or retired');
    expect(counts).toHaveTextContent('Subjects tracked');
    expect(screen.getByText(/The recorded continuity analysis matches the statements/)).toBeInTheDocument();
    expect(screen.getByText(/1 continuity conflict\(s\) need a creator decision/)).toBeInTheDocument();
    expect(screen.getByText(/Character \(2\) · Wardrobe \(1\)/)).toBeInTheDocument();
  });

  it('lists every deterministic rule with the severity a creator will see', async () => {
    mount();
    const rules = await screen.findByLabelText('Deterministic continuity rules');
    expect(rules).toHaveTextContent('A trait changes across a Scene boundary without a declared change.');
    expect(rules).toHaveTextContent('A declared change touches a subject the creator protected with a continuity lock.');
    expect(rules).toHaveTextContent('The last statement for a trait is a declared change and later work has none');
    expect(screen.getAllByText('critical').length).toBeGreaterThan(0);
  });

  it('shows statements with their real labels and keeps a superseded one readable', async () => {
    mount();
    expect((await screen.findAllByText('blood on the left shoulder')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Marcus is injured in the kitchen/)).toBeInTheDocument();
    expect(screen.getByText(/Superseded by a newer statement/)).toBeInTheDocument();
    expect(screen.getByText(/One live statement per trait per point/)).toBeInTheDocument();
  });

  it('records a statement at its real anchor and reports what was superseded', async () => {
    const { onChanged } = mount();
    await setFields('character', 'shirt condition', 'torn shirt');
    fireEvent.change(screen.getByLabelText('Continuity anchor'), { target: { value: 'scene_ending' } });
    fireEvent.change(screen.getByLabelText('Continuity transition'), { target: { value: 'changed' } });
    fireEvent.change(screen.getByLabelText('Continuity reason'), { target: { value: 'The shirt tore in the kitchen.' } });
    fireEvent.click(screen.getByRole('button', { name: /Record statement for Scene 18/ }));
    await waitFor(() => expect(productionContinuityService.recordStatement).toHaveBeenCalledWith(workspaceId, productionId, {
      domain: 'character', trait: 'shirt condition', value: 'torn shirt', anchor: 'scene_ending',
      subjectObjectId: character, sceneId: sceneEighteen, shotId: null, transition: 'changed',
      reason: 'The shirt tore in the kitchen.',
    }));
    expect(await screen.findByText(/kept and marked as superseded/)).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('refuses an anchor that names nothing real: a Shot or Scene statement needs a real Shot or Scene', async () => {
    mount({ selectedShotId: null, selectedSceneId: null });
    await setFields();
    fireEvent.change(screen.getByLabelText('Continuity anchor'), { target: { value: 'shot' } });
    const submit = screen.getByRole('button', { name: /Record statement for/ });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/a Shot statement names a real Shot/)).toBeInTheDocument();
    fireEvent.click(submit);
    expect(productionContinuityService.recordStatement).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Continuity anchor'), { target: { value: 'scene_opening' } });
    expect(screen.getByText(/a Scene statement names a real Scene/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it('runs the check, shows the verdict, and says it changed no statement', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Check this Production/ }));
    await waitFor(() => expect(productionContinuityService.check)
      .toHaveBeenCalledWith(workspaceId, productionId, 'Run from Studio.'));
    expect((await screen.findAllByText(/1 continuity conflict needs a creator decision/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/It changes no statement, and it does not analyse media/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 finding\(s\) · 3 live statement\(s\) at revision 9/)).toBeInTheDocument();
  });

  it('reports a finding with its cause, its severity and what TONDE suggests', async () => {
    mount();
    const list = await screen.findByLabelText('Open continuity findings');
    expect(list).toHaveTextContent('Break across a Scene boundary');
    expect(list).toHaveTextContent('Confirm the state actually carries over');
    expect(list).toHaveTextContent(/was "blood on the left shoulder"/);
    expect(screen.getByText('2 finding(s) are still open.')).toBeInTheDocument();
  });

  it('shows an inferred proposal as a proposal rather than as a fact', async () => {
    mount();
    const list = await screen.findByLabelText('Open continuity findings');
    expect(list).toHaveTextContent('Inferred (proposal)');
    expect(list).toHaveTextContent('Estimated');
    expect(list).toHaveTextContent(/Basis: Two statements disagree across the cut/);
    expect(list).toHaveTextContent(/The wardrobe may not match the injury across the cut/);
  });

  it('decides a finding without approving anything', async () => {
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: /Mark resolved/ }))[0]);
    await waitFor(() => expect(productionContinuityService.updateFinding).toHaveBeenCalledWith(workspaceId, productionId,
      findingBreak, { state: 'resolved', note: 'Decided from Studio: resolved.' }));
    expect(await screen.findByText(/The continuity statements and any approval are unchanged/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
  });

  it('reads one subject\u2019s timeline in Production order', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Read timeline for Marcus/ }));
    await waitFor(() => expect(productionContinuityService.chain)
      .toHaveBeenCalledWith(workspaceId, productionId, character));
    const timeline = await screen.findByLabelText('Continuity timeline');
    expect(timeline).toHaveTextContent('Scene 18 opening');
    expect(timeline).toHaveTextContent('Scene 18 ending');
    expect(timeline).toHaveTextContent('3 statement(s), earliest first.');
  });

  it('retires a statement instead of deleting it', async () => {
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: /Retire/ }))[0]);
    await waitFor(() => expect(productionContinuityService.retireStatement)
      .toHaveBeenCalledWith(workspaceId, productionId, stateBlood, 'Retired from Studio.'));
    expect(await screen.findByText(/retired, not deleted/)).toBeInTheDocument();
  });

  it('filters findings by severity through the service rather than locally', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Finding severity filter'), { target: { value: 'critical' } });
    await waitFor(() => expect(productionContinuityService.findings)
      .toHaveBeenCalledWith(workspaceId, productionId, { severity: 'critical' }));
  });

  it('surfaces a failed check as an alert rather than a silent no-op', async () => {
    vi.mocked(productionContinuityService.check)
      .mockRejectedValueOnce(new AppError('conflict', 'The statements changed after this check ran.'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Check this Production/ }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('The statements changed after this check ran.');
  });
});
