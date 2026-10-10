import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionReadinessCanvas } from '../studio/ProductionReadiness';
import { productionReadinessService } from '../services/productionReadiness';
import { AppError } from '../services/errors';

vi.mock('../services/productionReadiness', () => ({
  productionReadinessService: {
    vocabulary: vi.fn(), readiness: vi.fn(), state: vi.fn(), history: vi.fn(),
    decide: vi.fn(), setLock: vi.fn(),
  },
  ACCESS_ACTIONS: ['approve', 'request_review', 'reopen', 'lock', 'unlock'],
  READINESS_SEVERITIES: ['blocking', 'review', 'warning'],
  REVIEWABLE_KINDS: ['production', 'scene', 'shot', 'execution_plan', 'creative_document'],
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneTwo = '00000000-0000-4000-8000-000000000301';
const shotTwelve = '00000000-0000-4000-8000-000000000401';

const LIMITATION = 'Readiness is a category derived from real production state, not a score or a percentage. AI provider availability is an external dependency and is not guessed here.';

const vocabulary = {
  access_actions: [
    { action: 'approve' as const, label: 'Approved' },
    { action: 'request_review' as const, label: 'Waiting for review' },
    { action: 'reopen' as const, label: 'Reopened for editing' },
    { action: 'lock' as const, label: 'Locked' },
    { action: 'unlock' as const, label: 'Unlocked' },
  ],
  approval_states: [
    { state: 'draft' as const, label: 'Draft' },
    { state: 'approved' as const, label: 'Approved' },
    { state: 'changed_after_approval' as const, label: 'Changed after approval' },
  ],
  readiness_states: [
    { state: 'ready' as const, label: 'Ready' },
    { state: 'blocked' as const, label: 'Blocked' },
    { state: 'unknown' as const, label: 'Not enough planned state' },
  ],
  readiness_dimensions: [
    { dimension: 'scene_plan' as const, label: 'Scene plan' },
    { dimension: 'continuity' as const, label: 'Continuity' },
    { dimension: 'approvals' as const, label: 'Approvals' },
  ],
  severities: [
    { severity: 'blocking' as const, label: 'Blocks progress' },
    { severity: 'review' as const, label: 'Needs review' },
    { severity: 'warning' as const, label: 'Warning' },
  ],
  rule: 'Approval means a creator accepted this specific revision. Lock and approval are independent.',
  limitation: LIMITATION,
};

const report = {
  production_id: productionId, production_revision: 12, title: 'Marquee film',
  state: 'blocked' as const, state_label: 'Blocked',
  dimensions: [
    { dimension: 'scene_plan' as const, label: 'Scene plan', state: 'ready' as const, state_label: 'Ready',
      present: true, counts: { blocking: 0, review: 0, warning: 0 } },
    { dimension: 'continuity' as const, label: 'Continuity', state: 'blocked' as const, state_label: 'Blocked',
      present: true, counts: { blocking: 1, review: 1, warning: 0 } },
  ],
  blockers: [
    { code: 'continuity_critical', severity: 'blocking' as const, dimension: 'continuity' as const,
      severity_label: 'Blocks progress', dimension_label: 'Continuity',
      problem: 'Marcus wears a red jacket then a blue one.', affected_object_id: sceneTwo,
      affected_label: 'Scene 2 Kitchen', affected_kind: 'scene',
      why_it_matters: 'A critical continuity conflict is unresolved.',
      required_action: 'Resolve or explicitly accept the continuity finding.',
      action_source: 'continuity_finding' },
    { code: 'changed_after_approval', severity: 'review' as const, dimension: 'approvals' as const,
      severity_label: 'Needs review', dimension_label: 'Approvals',
      problem: 'Approved content changed since it was approved.', affected_object_id: shotTwelve,
      affected_label: 'Marcus enters', affected_kind: 'shot',
      why_it_matters: 'An approval describes a specific revision.',
      required_action: 'Review the new revision and approve it.', action_source: 'shot' },
  ],
  counts: { blocking: 1, review: 1, warning: 0, total: 2 },
  headline: '1 blocker must be resolved before this Production can move forward.',
  notes: ['Readiness is a category derived from real production state, not a score or a percentage.'],
  generated_at: '2026-10-05T10:00:00Z', limitation: LIMITATION,
};

const accessState = {
  object_id: sceneTwo, object_kind: 'scene', label: 'Scene 2 Kitchen',
  approval: 'approved' as const, approval_label: 'Approved', locked: false,
  current_revision: 5, approved_revision: 4, approved_by: 'owner-user', approved_at: '2026-10-05T09:00:00Z',
  changed_since_approval: false, locked_at: null, locked_by: null, lock_reason: '',
  decisions: [
    { id: 'd1', action: 'approve' as const, from_approval: 'needs_review' as const, to_approval: 'approved' as const,
      from_locked: false, to_locked: false, pinned_revision: 4, note: 'The opening beat is locked.',
      actor_user_id: 'owner-user', created_at: '2026-10-05T09:00:00Z', action_label: 'Approved' },
  ],
  note: 'Approval names the exact revision it accepted.',
  changed_line: 'This is the revision the creator approved.',
  lock_line: 'Unlocked.',
};

const changedState = {
  ...accessState, approval: 'changed_after_approval' as const, changed_since_approval: true,
  changed_line: 'This content changed after it was approved. The earlier approval still names the revision it accepted, not this one.',
};

const lockedState = {
  ...accessState, locked: true, locked_at: '2026-10-05T09:30:00Z', locked_by: 'owner-user',
  lock_reason: 'The pickups are scheduled.', lock_line: 'Locked. The lock protects this decision from incidental change; approval is separate.',
};

beforeEach(() => {
  vi.mocked(productionReadinessService.vocabulary).mockResolvedValue(vocabulary);
  vi.mocked(productionReadinessService.readiness).mockResolvedValue(report);
  vi.mocked(productionReadinessService.state).mockResolvedValue(accessState);
  vi.mocked(productionReadinessService.decide).mockResolvedValue({
    object_id: sceneTwo, object_kind: 'scene', label: 'Scene 2 Kitchen', action: 'approve',
    action_label: 'Approved', approval: 'approved', approval_label: 'Approved', revision: 6,
    approved_revision: 6, locked: false, note: 'Ship the beat.', actor_user_id: 'owner-user',
    decided_at: '2026-10-05T11:00:00Z',
    meaning: 'A creator accepted this exact revision. Approval is a human decision, not a generation result.',
  });
  vi.mocked(productionReadinessService.setLock).mockResolvedValue({
    object_id: sceneTwo, object_kind: 'scene', label: 'Scene 2 Kitchen', task: 'lock',
    action_label: 'Locked', locked: true, revision: 6, was_locked: false, note: 'Pickups scheduled.',
    actor_user_id: 'owner-user', decided_at: '2026-10-05T11:00:00Z',
    meaning: 'This object is protected from incidental change. Approval is unaffected.',
  });
});

afterEach(() => { vi.clearAllMocks(); });

const targets = [
  { id: sceneTwo, label: 'Scene 2 Kitchen', kind: 'scene' },
  { id: shotTwelve, label: 'Marcus enters', kind: 'shot' },
];

function renderCanvas(overrides: { onOpen?: (objectId: string, kind: string | null) => void } = {}) {
  return render(<ProductionReadinessCanvas workspaceId={workspaceId} productionId={productionId}
    targets={targets} busy={false} onChanged={() => {}} onOpen={overrides.onOpen} />);
}

describe('readiness report', () => {
  it('shows the category and its dimensions, and never a score or a percentage', async () => {
    renderCanvas();
    await waitFor(() => expect(productionReadinessService.readiness).toHaveBeenCalled());
    const summary = within(await screen.findByLabelText('Readiness summary'));
    expect(summary.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(summary.getByText('1 blocker must be resolved before this Production can move forward.')).toBeInTheDocument();
    expect(screen.getByText('1 blocking · 1 needing review · 0 warnings')).toBeInTheDocument();
    expect(summary.getAllByText('Continuity').length).toBeGreaterThan(0);
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/%/);
    expect(screen.getByText(LIMITATION)).toBeInTheDocument();
    // The surface says out loud that readiness is not a score, rather than rendering one.
    expect(screen.getByText(/not a score or a percentage/)).toBeInTheDocument();
  });

  it('renders each blocker with its problem, why it matters and the next action', async () => {
    renderCanvas();
    expect(await screen.findByText('Marcus wears a red jacket then a blue one.')).toBeInTheDocument();
    expect(screen.getByText('A critical continuity conflict is unresolved.')).toBeInTheDocument();
    expect(screen.getByText('Next: Resolve or explicitly accept the continuity finding.')).toBeInTheDocument();
    expect(screen.getAllByText('Blocks progress').length).toBe(1);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('navigates to the affected object from a blocker', async () => {
    const onOpen = vi.fn();
    renderCanvas({ onOpen });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Scene 2 Kitchen' }));
    expect(onOpen).toHaveBeenCalledWith(sceneTwo, 'scene');
    fireEvent.click(screen.getByRole('button', { name: 'Open Marcus enters' }));
    expect(onOpen).toHaveBeenCalledWith(shotTwelve, 'shot');
  });
});

describe('approval state', () => {
  it('names the revision that was approved, who decided and when', async () => {
    renderCanvas();
    await waitFor(() => expect(productionReadinessService.state).toHaveBeenCalled());
    const approval = await screen.findByLabelText('Current approval and lock');
    expect(within(approval).getByText('Approved')).toBeInTheDocument();
    expect(approval.textContent).toContain('Revision approved');
    expect(approval.textContent).toContain('4');
    expect(approval.textContent).toContain('owner-user');
    expect(screen.getByText('This is the revision the creator approved.')).toBeInTheDocument();
  });

  it('reports content that changed after approval instead of still approved', async () => {
    vi.mocked(productionReadinessService.state).mockResolvedValue(changedState);
    renderCanvas();
    expect(await screen.findByText(/changed after it was approved/)).toBeInTheDocument();
    expect(screen.getByText(/still names the revision it accepted/)).toBeInTheDocument();
  });

  it('sends an approval with the revision the creator is looking at', async () => {
    renderCanvas();
    await waitFor(() => expect(productionReadinessService.state).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Decision reason'), { target: { value: 'Ship the beat.' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve revision 5' }));
    await waitFor(() => expect(productionReadinessService.decide).toHaveBeenCalledWith(
      workspaceId, productionId, sceneTwo,
      { decision: 'approve', expectedRevision: 5, note: 'Ship the beat.' }));
    expect(await screen.findByText(/A creator accepted this exact revision/)).toBeInTheDocument();
  });

  it('offers request review and reopen as distinct decisions', async () => {
    renderCanvas();
    await waitFor(() => expect(productionReadinessService.state).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Request review' }));
    await waitFor(() => expect(productionReadinessService.decide).toHaveBeenCalledWith(
      workspaceId, productionId, sceneTwo,
      expect.objectContaining({ decision: 'request_review' })));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(productionReadinessService.decide).toHaveBeenCalledWith(
      workspaceId, productionId, sceneTwo, expect.objectContaining({ decision: 'reopen' })));
  });

  it('locks without requiring a reason and shows the recorded outcome', async () => {
    renderCanvas();
    await waitFor(() => expect(productionReadinessService.state).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Lock$/ }));
    await waitFor(() => expect(productionReadinessService.setLock).toHaveBeenCalledWith(
      workspaceId, productionId, sceneTwo,
      { locked: true, expectedRevision: 5, note: '' }));
    expect(await screen.findByText(/protected from incidental change/)).toBeInTheDocument();
  });

  it('refuses to unlock without a reason and then records the explicit unlock', async () => {
    vi.mocked(productionReadinessService.state).mockResolvedValue(lockedState);
    vi.mocked(productionReadinessService.setLock).mockResolvedValue({
      object_id: sceneTwo, object_kind: 'scene', label: 'Scene 2 Kitchen', task: 'unlock',
      action_label: 'Unlocked', locked: false, revision: 7, was_locked: true,
      note: 'Unlocked for the reshoot.', actor_user_id: 'owner-user', decided_at: '2026-10-05T12:00:00Z',
      meaning: 'This object is unlocked. The unlock and its reason are on record.',
    });
    renderCanvas();
    expect(await screen.findByText('Locked because: The pickups are scheduled.')).toBeInTheDocument();
    const unlock = screen.getByRole('button', { name: /Unlock/ });
    expect(unlock).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Decision reason'), { target: { value: 'Unlocked for the reshoot.' } });
    expect(unlock).toBeEnabled();
    fireEvent.click(unlock);
    await waitFor(() => expect(productionReadinessService.setLock).toHaveBeenCalledWith(
      workspaceId, productionId, sceneTwo,
      { locked: false, expectedRevision: 5, note: 'Unlocked for the reshoot.' }));
    expect(await screen.findByText(/The unlock and its reason are on record/)).toBeInTheDocument();
  });

  it('shows the append-only decision history with its action labels', async () => {
    renderCanvas();
    const history = await screen.findByLabelText('Decision history');
    expect(history.textContent).toContain('Approved');
    expect(history.textContent).toContain('revision 4');
    expect(history.textContent).toContain('The opening beat is locked.');
  });

  it('surfaces a refusal as an alert instead of pretending it worked', async () => {
    vi.mocked(productionReadinessService.decide).mockRejectedValue(
      new AppError('conflict', 'That object changed since you loaded it. Review the current revision.'));
    renderCanvas();
    await waitFor(() => expect(productionReadinessService.state).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Approve revision 5' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That object changed since you loaded it.');
  });
});
