import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionShotMatchCanvas } from '../studio/ProductionShotMatch';
import { productionShotMatchService, type ResultDetail } from '../services/productionShotMatch';
import { AppError } from '../services/errors';

vi.mock('../services/productionShotMatch', () => ({
  productionShotMatchService: {
    vocabulary: vi.fn(), results: vi.fn(), registerResult: vi.fn(), result: vi.fn(),
    setResultState: vi.fn(), reports: vi.fn(), analyze: vi.fn(), report: vi.fn(), decide: vi.fn(),
    proposeCorrection: vi.fn(), applyCorrection: vi.fn(), rejectCorrection: vi.fn(),
  },
  RESULT_STATES: ['raw', 'needs_review', 'approved', 'rejected', 'final'],
  RESULT_ORIGINS: ['real_take', 'ai_generation', 'hybrid', 'manual_import'],
  MATCH_VERDICTS: ['matches_intent', 'acceptable_variation', 'needs_attention', 'mismatch', 'unknown'],
  CORRECTION_STATES: ['proposed', 'applied', 'rejected'],
  CORRECTION_RECOMMENDATIONS: ['none', 'pickup_required', 'regeneration_recommended', 'both'],
  MATCH_ORIGINS: ['deterministic', 'creator', 'ai_proposal'],
  MATCH_DECISIONS: ['pickup', 'regeneration', 'accepted', 'dismiss'],
  PROPAGATION_MODES: ['change_only_this', 'review_changes', 'update_all'],
  MEDIA_MODALITIES: ['metadata', 'thumbnail', 'image', 'video_frames', 'audio', 'text'],
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const shotOne = '00000000-0000-4000-8000-000000000401';
const resultOne = '00000000-0000-4000-8000-000000000501';
const reportOne = '00000000-0000-4000-8000-000000000502';
const correctionOne = '00000000-0000-4000-8000-000000000503';
const planOne = '00000000-0000-4000-8000-000000000504';

const LIMITATION = 'Comparison only uses the modalities verified from real media rows. No visual claim is made without extracted frames or an image, no audio claim without an audio track, and no lens, person or identity is ever measured or identified from imagery.';

const vocabulary = {
  result_states: [{ state: 'needs_review' as const, label: 'Needs review' }],
  result_origins: [{ origin: 'real_take' as const, label: 'Real Take' }],
  match_verdicts: [{ verdict: 'mismatch' as const, label: 'Mismatch' }],
  correction_states: [{ state: 'proposed' as const, label: 'Proposed' }],
  correction_recommendations: [{ recommendation: 'pickup_required' as const, label: 'Pickup required' }],
  match_origins: [{ origin: 'creator' as const, label: 'Creator statement' }],
  severities: [{ severity: 'critical' as const, label: 'Critical' }],
  rule: 'A Result is what was actually created, not the plan.',
  limitation: LIMITATION,
};

const capabilities = { metadata: true, thumbnail: true, image: true, video_frames: true, audio: false,
  media_state: 'uploaded/ready', notes: ['No audio track was extracted, so audio comparison is not claimed.'] };

const resultItem = {
  result_id: resultOne, shot_id: shotOne, shot_label: 'Shot 1 Marcus enters',
  state: 'needs_review' as const, state_label: 'Needs review', approval: 'draft' as const,
  locked: false, revision: 3, origin: 'real_take' as const, origin_label: 'Real Take',
  provenance: { origin: 'real_take' as const, take_number: 1, take_status: 'preferred' },
  capabilities, capability_line: 'Compared from metadata, a thumbnail, an image, extracted frames.',
  match_reports: 1, match_worst_severity: 'critical' as const, match_severity_label: 'Critical',
  match_recommendation: 'pickup_required' as const, match_recommendation_label: 'Pickup required',
  created_at: '2026-10-06T10:00:00Z',
  final_line: 'Final is explicitly accepted evidence or deliverable state. Generation completion never sets it.',
};

const results = { items: [resultItem], total: 1, limit: 50, offset: 0,
  note: 'A Result is what was created, not the plan.' };

const report = {
  report_id: reportOne, shot_id: shotOne, shot_label: 'Shot 1 Marcus enters',
  result_id: resultOne, result_state: 'needs_review' as const,
  state: 'complete', severity: 'critical' as const, severity_label: 'Critical',
  approval: 'draft' as const, decision: null, decision_note: '', decided_by: null, decided_at: null,
  origin: 'creator' as const, origin_label: 'Creator statement',
  recommendation: 'pickup_required' as const, recommendation_label: 'Pickup required',
  capabilities, capability_line: 'Compared from metadata, a thumbnail, an image, extracted frames.',
  findings: [{ category: 'product_fidelity', verdict: 'mismatch' as const, verdict_label: 'Mismatch',
    expected: 'Product mark readable', observed: 'Product mark is unreadable',
    difference: 'The Product logo cannot be read', epistemic: 'observed' as const, epistemic_label: 'Observed',
    confidence: 'high' as const, confidence_label: 'High confidence', severity: 'critical' as const,
    severity_label: 'Critical', evidence: ['frame 12-40'],
    suggested_correction: 'Rotate the Product toward camera', region: '', time_range: '',
    continuity_finding_id: '00000000-0000-4000-8000-000000000505' }],
  dimensions: [{ dimension: 'product_fidelity', verdict: 'mismatch' as const, verdict_label: 'Mismatch',
    findings: 1, weight: 95 }],
  summary: {
    what_worked: [{ category: 'color', verdict: 'acceptable_variation' as const }],
    what_drifted: [{ category: 'product_fidelity', verdict: 'mismatch' as const, severity: 'critical' as const,
      difference: 'The Product logo cannot be read' }],
    what_matters_most: [{ category: 'product_fidelity', weight: 95,
      difference: 'The Product logo cannot be read', verdict: 'mismatch' as const }],
    what_to_fix_next: [{ category: 'product_fidelity', fix: 'Rotate the Product toward camera' }],
    note: 'Ordered by production impact, not by a similarity score.',
  },
  recommendations: [], limitations: ['No audio track was extracted, so audio comparison is not claimed.'],
  corrected_plan_id: null, corrections: [],
  iteration_chain: [
    { report_id: '00000000-0000-4000-8000-0000000005ff', created_at: '2026-10-06T09:00:00Z',
      severity: 'warning' as const, recommendation: 'pickup_required' as const, decision: 'pickup' },
    { report_id: reportOne, created_at: '2026-10-06T10:00:00Z', severity: 'critical' as const,
      recommendation: 'pickup_required' as const, decision: null },
  ],
  headline: 'The Product logo cannot be read', note: 'The iteration history is preserved.',
  rule: 'A Result is what was actually created, not the plan.',
};

const reportList = { items: [report], total: 2, note: 'Each report is one analysis in the Shot iteration history.' };

const { match_reports: _analyses, ...detailBase } = resultItem;
const detail: ResultDetail = { ...detailBase,
  scene_id: '00000000-0000-4000-8000-000000000301', media_id: planOne,
  plan: { plan_id: planOne, execution_method: 'real', approval: 'draft', revision: 1,
    framing: 'Product lower third' },
  version_count: 4,
  match_reports: [{ report_id: reportOne, state: 'complete', severity: 'critical' as const,
    recommendation: 'pickup_required' as const, decision: null, origin: 'creator' as const,
    approval: 'draft', created_at: '2026-10-06T10:00:00Z' }],
  corrections: [] };

const proposedCorrection = { correction_id: correctionOne, report_id: reportOne, shot_id: shotOne,
  state: 'proposed' as const, state_label: 'Proposed', target_object_id: planOne,
  target_kind: 'execution_plan', target_label: 'Real plan', source_revision: 1,
  patch: { camera_height: 'low, at product level' },
  root_cause: 'The camera was higher than planned', why: 'The Product read as secondary',
  affected: 'Shot 1 Real Execution Plan only', recommendation: 'pickup_required' as const,
  preview: { analysis_id: '00000000-0000-4000-8000-000000000506',
    counts: { direct: 1, downstream: 2, potential: 0, total: 3 },
    note: 'Impact is computed by this proposal.' },
  impact_line: 'The impact was computed and is applied only when you accept the correction. Nothing downstream was changed by proposing it.',
  note: 'The correction is a proposal.' };

const shots = [{ id: shotOne, label: 'Shot 1 Marcus enters', method: 'real', resultCount: 1 }];
const targets = [
  { id: shotOne, label: 'Shot 1 Marcus enters', kind: 'shot' },
  { id: planOne, label: 'Shot 1 Real plan', kind: 'execution_plan' },
];

function renderCanvas(overrides: { onChanged?: () => void; onOpenShot?: (id: string) => void } = {}) {
  return render(<ProductionShotMatchCanvas workspaceId={workspaceId} productionId={productionId}
    shots={shots} targets={targets} busy={false} onChanged={overrides.onChanged ?? vi.fn()}
    onOpenShot={overrides.onOpenShot} />);
}

async function ready() {
  await waitFor(() => expect(productionShotMatchService.result).toHaveBeenCalled());
  await waitFor(() => expect(productionShotMatchService.report).toHaveBeenCalled());
}

beforeEach(() => {
  vi.mocked(productionShotMatchService.vocabulary).mockResolvedValue(vocabulary);
  vi.mocked(productionShotMatchService.results).mockResolvedValue(results);
  vi.mocked(productionShotMatchService.result).mockResolvedValue(detail);
  vi.mocked(productionShotMatchService.reports).mockResolvedValue(reportList);
  vi.mocked(productionShotMatchService.report).mockResolvedValue(report);
  vi.mocked(productionShotMatchService.setResultState).mockResolvedValue({
    result_id: resultOne, state: 'approved', state_label: 'Approved', previous_state: 'needs_review',
    approval: 'approved', revision: 4, note: '',
    meaning: 'A creator accepted this Result. Shot Match never approves a Result.' });
  vi.mocked(productionShotMatchService.analyze).mockResolvedValue(report);
  vi.mocked(productionShotMatchService.decide).mockResolvedValue({
    report_id: reportOne, shot_id: shotOne, decision: 'regeneration', decision_label: 'Regeneration recommended',
    approval: 'approved', recommendation: 'regeneration_recommended', recommendation_label: 'Regeneration recommended',
    capture_status: null,
    note: 'Regeneration is recommended. Nothing was launched: generation still needs the normal explicit confirmation.',
    meaning: 'Deciding a Shot Match report is not an approval of the Result.' });
  vi.mocked(productionShotMatchService.proposeCorrection).mockResolvedValue(proposedCorrection);
  vi.mocked(productionShotMatchService.applyCorrection).mockResolvedValue({
    ...proposedCorrection, state: 'applied', state_label: 'Applied', applied_revision: 2,
    applied_version_id: '00000000-0000-4000-8000-000000000507', changed_fields: ['camera_height'],
    propagation: [{ marked: 2 }],
    preserved_line: 'A new revision was created. The previous plan, the Result and every earlier analysis are preserved.' });
  vi.mocked(productionShotMatchService.rejectCorrection).mockResolvedValue({
    ...proposedCorrection, state: 'rejected', state_label: 'Rejected',
    note: 'The correction was rejected. Nothing changed and nothing was overwritten.' });
});

describe('results', () => {
  it('shows what was actually created with where it came from and what was verified', async () => {
    renderCanvas();
    const list = await screen.findByLabelText('Recorded results');
    expect(within(list).getByText('Real Take 1 · preferred')).toBeInTheDocument();
    expect(within(list).getByText('Needs review')).toBeInTheDocument();
    expect(within(list).getByText('Pickup required')).toBeInTheDocument();
    expect(within(list).getByText('Compared from metadata, a thumbnail, an image, extracted frames.'))
      .toBeInTheDocument();
    expect(await screen.findByText('REAL · draft · revision 1')).toBeInTheDocument();
    expect(await screen.findByText('This analysis was based on metadata, a thumbnail, an image, extracted frames.'))
      .toBeInTheDocument();
  });

  it('states that Final is never set by generation and sends the revision being reviewed', async () => {
    const onChanged = vi.fn();
    renderCanvas({ onChanged });
    await ready();
    expect(screen.getByText(/Generation completion never sets it/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Result decision reason'), { target: { value: 'The take reads correctly.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept Result' }));
    await waitFor(() => expect(productionShotMatchService.setResultState).toHaveBeenCalledWith(
      workspaceId, productionId, resultOne,
      { state: 'approved', expectedRevision: 3, note: 'The take reads correctly.' }));
    // One decision produces exactly one message: the outcome, never an outcome plus a status.
    expect(await screen.findByText(/Shot Match never approves a Result/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers Final only as a request and reports the database refusal honestly', async () => {
    vi.mocked(productionShotMatchService.setResultState).mockRejectedValue(
      new AppError('conflict', 'A Result becomes Final only after a creator approved it'));
    renderCanvas();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Final' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A Result becomes Final only after a creator approved it');
  });

  it('says plainly that a Result is registered where the media is captured', async () => {
    vi.mocked(productionShotMatchService.results).mockResolvedValue({ ...results, items: [], total: 0 });
    vi.mocked(productionShotMatchService.result).mockResolvedValue(detail);
    renderCanvas();
    expect(await screen.findByText(/A Result is registered where the media is captured/)).toBeInTheDocument();
  });
});

describe('shot match', () => {
  it('states the limitation instead of implying it can see everything', async () => {
    renderCanvas();
    expect(await screen.findByText(LIMITATION)).toBeInTheDocument();
    expect(screen.getByText(/report an estimated look/)).toBeInTheDocument();
  });

  it('refuses to record an observed difference with no evidence', async () => {
    renderCanvas();
    await ready();
    fireEvent.change(screen.getByLabelText('Difference'), { target: { value: 'Product is off frame' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record this analysis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cite the evidence it was seen on');
    expect(productionShotMatchService.analyze).not.toHaveBeenCalled();
  });

  it('records the dimension, the evidence and the severity the creator states', async () => {
    const onChanged = vi.fn();
    renderCanvas({ onChanged });
    await ready();
    fireEvent.change(screen.getByLabelText('Dimension compared'), { target: { value: 'product_fidelity' } });
    fireEvent.change(screen.getByLabelText('Finding severity'), { target: { value: 'critical' } });
    fireEvent.change(screen.getByLabelText('Difference'), { target: { value: 'The Product logo cannot be read' } });
    fireEvent.change(screen.getByLabelText('Evidence'), { target: { value: 'frame 12-40' } });
    fireEvent.change(screen.getByLabelText('Suggested correction'), { target: { value: 'Rotate the Product toward camera' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record this analysis' }));
    await waitFor(() => expect(productionShotMatchService.analyze).toHaveBeenCalledWith(
      workspaceId, productionId, shotOne, {
        resultId: resultOne, origin: 'creator',
        findings: [{ category: 'product_fidelity', difference: 'The Product logo cannot be read',
          evidence: ['frame 12-40'], severity: 'critical', epistemic: 'observed', confidence: 'high',
          suggested_correction: 'Rotate the Product toward camera' }],
      }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('presents the analysis as a diagnosis ordered by impact, with what it could not see', async () => {
    renderCanvas();
    const analysis = await screen.findByLabelText('Shot Match analysis');
    expect(within(analysis).getAllByText('The Product logo cannot be read').length).toBeGreaterThan(0);
    expect(within(analysis).getByText(/This analysis was based on metadata/)).toBeInTheDocument();
    const summary = within(analysis).getByLabelText('Summary');
    expect(summary.textContent).toContain('What worked');
    expect(summary.textContent).toContain('What to fix next');
    expect(summary.textContent).toContain('Rotate the Product toward camera');
    expect(screen.getByText(/not by a similarity score/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Dimension verdicts')).getByText('Mismatch')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Findings')).getByText('Evidence: frame 12-40')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Findings')).getByText('High confidence', { exact: false })).toBeInTheDocument();
    const limits = screen.getByLabelText('What this comparison could not see');
    expect(limits.textContent).toContain('No audio track was extracted');
  });

  it('shows the iteration history and never renders a numeric similarity', async () => {
    renderCanvas();
    const chain = await screen.findByLabelText('Iteration history');
    expect(chain.textContent).toContain('decided: pickup');
    expect(chain.textContent).toContain('no decision yet');
    expect(document.body.textContent ?? '').not.toMatch(/%/);
    expect(document.body.textContent ?? '').not.toMatch(/similarity=\d/i);
  });

  it('decides an analysis without approving the Result and says nothing is launched', async () => {
    const onChanged = vi.fn();
    renderCanvas({ onChanged });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Recommend regeneration' }));
    await waitFor(() => expect(productionShotMatchService.decide).toHaveBeenCalledWith(
      workspaceId, productionId, reportOne, { decision: 'regeneration', note: '' }));
    expect(await screen.findByText(/Nothing was launched/)).toBeInTheDocument();
    expect(screen.getByText(/Deciding an analysis is not an approval of the Result/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('fix this shot', () => {
  it('refuses a root cause that only names the mismatch', async () => {
    renderCanvas();
    await ready();
    fireEvent.change(screen.getByLabelText('Corrected value'), { target: { value: 'low, at product level' } });
    fireEvent.change(screen.getByLabelText('Root cause'), { target: { value: 'mismatch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Explain the production cause, not only which dimension differs');
    expect(productionShotMatchService.proposeCorrection).not.toHaveBeenCalled();
  });

  it('proposes one scoped change on one object and previews the impact', async () => {
    renderCanvas();
    await ready();
    fireEvent.change(screen.getByLabelText('Correction target'), { target: { value: planOne } });
    fireEvent.change(screen.getByLabelText('Field to correct'), { target: { value: 'camera_height' } });
    fireEvent.change(screen.getByLabelText('Corrected value'), { target: { value: 'low, at product level' } });
    fireEvent.change(screen.getByLabelText('Root cause'),
      { target: { value: 'The camera was higher than planned, so the Product read as secondary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose correction' }));
    await waitFor(() => expect(productionShotMatchService.proposeCorrection).toHaveBeenCalledWith(
      workspaceId, productionId, reportOne, {
        targetObjectId: planOne, patch: { camera_height: 'low, at product level' },
        rootCause: 'The camera was higher than planned, so the Product read as secondary',
        why: 'The Product logo cannot be read', affected: 'Scoped to Shot 1 Real plan only',
      }));
    const proposal = await screen.findByLabelText('Correction proposal');
    expect(proposal.textContent).toContain('1 direct');
    expect(proposal.textContent).toContain('2 downstream');
    expect(proposal.textContent).toContain('computed, not applied');
    expect(proposal.textContent).toContain('Real plan');
  });

  it('applies the correction as a new revision and keeps the earlier plan and Result', async () => {
    const onChanged = vi.fn();
    renderCanvas({ onChanged });
    await ready();
    fireEvent.change(screen.getByLabelText('Corrected value'), { target: { value: 'low, at product level' } });
    fireEvent.change(screen.getByLabelText('Root cause'),
      { target: { value: 'The camera was higher than planned, so the Product read as secondary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose correction' }));
    await screen.findByLabelText('Correction proposal');
    fireEvent.click(screen.getByRole('button', { name: 'Apply to this Shot' }));
    await waitFor(() => expect(productionShotMatchService.applyCorrection).toHaveBeenCalledWith(
      workspaceId, productionId, correctionOne,
      { expectedRevision: 1, propagation: 'change_only_this', note: '', recordCandidate: false }));
    expect((await screen.findAllByText(/The previous plan, the Result and every earlier analysis are preserved/)).length)
      .toBe(1);
    expect(screen.getByText('Applied. Revision 2.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers reusable memory only as a deliberate, later-confirmed choice', async () => {
    renderCanvas();
    await ready();
    fireEvent.change(screen.getByLabelText('Corrected value'), { target: { value: 'low, at product level' } });
    fireEvent.change(screen.getByLabelText('Root cause'),
      { target: { value: 'The camera was higher than planned, so the Product read as secondary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose correction' }));
    await screen.findByLabelText('Correction proposal');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to this Shot' }));
    await waitFor(() => expect(productionShotMatchService.applyCorrection).toHaveBeenCalledWith(
      workspaceId, productionId, correctionOne, expect.objectContaining({ recordCandidate: true })));
  });

  it('rejects a proposed correction without changing anything', async () => {
    renderCanvas();
    await ready();
    fireEvent.change(screen.getByLabelText('Corrected value'), { target: { value: 'low, at product level' } });
    fireEvent.change(screen.getByLabelText('Root cause'),
      { target: { value: 'The camera was higher than planned, so the Product read as secondary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose correction' }));
    await screen.findByLabelText('Correction proposal');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(productionShotMatchService.rejectCorrection).toHaveBeenCalledWith(
      workspaceId, productionId, correctionOne, { note: '' }));
    expect(await screen.findByText(/Nothing changed and nothing was overwritten/)).toBeInTheDocument();
  });

  it('offers the execution plan the Result was made against, even when the caller cannot list it', async () => {
    render(<ProductionShotMatchCanvas workspaceId={workspaceId} productionId={productionId}
      shots={shots} targets={[{ id: shotOne, label: 'Shot 1 Marcus enters', kind: 'shot' }]}
      busy={false} onChanged={vi.fn()} />);
    await ready();
    const targetSelect = await screen.findByLabelText('Correction target');
    await waitFor(() => expect(within(targetSelect).getByRole('option',
      { name: /Execution plan \(REAL · revision 1\)/ })).toBeInTheDocument());
    fireEvent.change(targetSelect, { target: { value: planOne } });
    const fields = within(screen.getByLabelText('Field to correct')).getAllByRole('option')
      .map(option => (option as HTMLOptionElement).value);
    expect(fields).toContain('camera_height');
  });

  it('offers only the fields a scoped correction may change', async () => {
    renderCanvas();
    await ready();
    fireEvent.change(screen.getByLabelText('Correction target'), { target: { value: planOne } });
    const fields = within(screen.getByLabelText('Field to correct')).getAllByRole('option')
      .map(option => (option as HTMLOptionElement).value);
    expect(fields).toContain('camera_height');
    expect(fields).toContain('provider_prompt');
    // Identity, ordering, approval and locks are never correctable through this surface.
    expect(fields.filter(value => ['revision', 'approval', 'locked_at', 'id', 'status', 'sort_order', 'created_by']
      .includes(value))).toEqual([]);
  });
});
