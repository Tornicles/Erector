import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionVersioningCanvas } from '../studio/ProductionVersioning';
import { productionVersioningService } from '../services/productionVersioning';
import { AppError } from '../services/errors';

vi.mock('../services/productionVersioning', () => ({
  productionVersioningService: {
    vocabulary: vi.fn(), versions: vi.fn(), version: vi.fn(), compare: vi.fn(), restore: vi.fn(),
    branches: vi.fn(), createBranch: vi.fn(), branch: vi.fn(), setChange: vi.fn(), clearChange: vi.fn(),
    setState: vi.fn(), preview: vi.fn(), decide: vi.fn(),
  },
  BRANCH_SCOPES: ['story', 'script', 'act', 'sequence', 'scene', 'shot', 'execution_plan', 'asset'],
  PROPAGATION_MODES: ['update_all', 'review_changes', 'change_only_this'],
  BRANCHABLE_FIELDS: {
    scene: [{ field: 'title', label: 'Title' }, { field: 'description', label: 'Description' }],
    shot: [{ field: 'title', label: 'Title' }],
    creative_document: [{ field: 'title', label: 'Title' }, { field: 'content', label: 'Content' }],
    asset: [{ field: 'name', label: 'Name' }],
  },
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneTwo = '00000000-0000-4000-8000-000000000301';
const shotTwelve = '00000000-0000-4000-8000-000000000401';
const storyId = '00000000-0000-4000-8000-000000000601';
const versionOne = '00000000-0000-4000-8000-000000000c01';
const versionTwo = '00000000-0000-4000-8000-000000000c02';
const branchOne = '00000000-0000-4000-8000-000000000d01';
const changeOne = '00000000-0000-4000-8000-000000000d02';
const proposalOne = '00000000-0000-4000-8000-000000000e01';

const RULE = 'A branch is an object-level alternative, not a duplicate Production. Mainline history is never overwritten: a restore and a merge both create a new current revision.';
const LIMITATION = 'Compare shows the meaningful creative fields that differ. It is not a raw JSON diff and it does not judge which version is better.';

const vocabulary = {
  scopes: [{ scope: 'scene' as const, label: 'Scene' }, { scope: 'shot' as const, label: 'Shot' },
    { scope: 'story' as const, label: 'Story' }, { scope: 'asset' as const, label: 'Asset' }],
  branch_states: [{ state: 'open' as const, label: 'Open alternative' }],
  change_states: [{ state: 'pending' as const, label: 'Ready to merge' }],
  merge_states: [{ state: 'proposed' as const, label: 'Waiting for your decision' }],
  source_actions: [{ action: 'update', label: 'Edited' }, { action: 'restore', label: 'Restored from an older version' }],
  propagation_modes: [
    { mode: 'update_all' as const, label: 'Update every affected dependent' },
    { mode: 'review_changes' as const, label: 'Only the dependents I select' },
    { mode: 'change_only_this' as const, label: 'Change only this and record the rest as unresolved' },
  ],
  branchable_kinds: [{ kind: 'scene', label: 'Scene', fields: [{ field: 'title', label: 'Title' }] }],
  rule: RULE,
  limitation: LIMITATION,
};

const history = {
  object_id: sceneTwo, object_kind: 'scene', object_label: 'Scene 2 Kitchen', branch: 'main', current_revision: 2,
  items: [
    { version_id: versionTwo, object_id: sceneTwo, revision: 2, branch: 'main', parent_version_id: versionOne,
      actor_type: 'user', actor_user_id: 'owner', source_action: 'update', created_at: '2026-10-05T10:00:00Z',
      is_current: true, source_action_label: 'Edited', current_line: 'This is the current revision.' },
    { version_id: versionOne, object_id: sceneTwo, revision: 1, branch: 'main', parent_version_id: null,
      actor_type: 'user', actor_user_id: 'owner', source_action: 'insert', created_at: '2026-10-04T10:00:00Z',
      is_current: false, source_action_label: 'Created', current_line: 'History: this is not the current revision.' },
  ],
  total: 2, limit: 50, offset: 0, truncated: false,
  note: 'Versions are immutable records of what the object was. Historical versions are never edited.',
};

const branches = {
  items: [
    { branch_id: branchOne, name: 'Product-first opening', scope: 'scene' as const, scope_object_id: sceneTwo,
      scope_object_label: 'Scene 2 Kitchen', source_version_id: versionOne, source_revision: 1,
      state: 'open' as const, reason: 'Try the product earlier.', merged_at: null, merged_proposal_id: null,
      changes: 1, created_at: '2026-10-05T10:00:00Z', state_label: 'Open alternative', scope_label: 'Scene',
      changes_line: '1 proposed change(s) are waiting to be merged.' },
  ],
  total: 1, limit: 50, offset: 0, truncated: false, rule: RULE,
};

const branchDetail = {
  ...branches.items[0],
  changes: [
    { change_id: changeOne, target_object_id: sceneTwo, target_label: 'Scene 2 Kitchen', target_kind: 'scene',
      base_version_id: versionOne, base_revision: 1, patch: { title: 'Scene 2 Kitchen, product first' },
      changed_fields: ['title'], note: 'Lead with it.', state: 'pending' as const, applied_version_id: null,
      applied_revision: null, current_revision: 1, state_label: 'Ready to merge',
      changed_field_labels: ['Title'] },
  ],
  change_count: 1,
  note: 'Branch edits never change the mainline. Only an accepted merge does.',
};

const preview = {
  proposal_id: proposalOne, branch_id: branchOne, branch_name: 'Product-first opening', structure_revision: 42,
  items: [{ change_id: changeOne, target_object_id: sceneTwo, target_label: 'Scene 2 Kitchen', target_kind: 'scene',
    base_revision: 1, current_revision: 1, changed_fields: ['title'], status: 'clean' as const, conflicts: [],
    state_label: 'Ready to merge' }],
  conflicts: [],
  counts: { clean: 1, conflicted: 0, total: 1 },
  impact: { targets: { [sceneTwo]: { direct: 2, downstream: 3, potential: 0, total: 5, truncated: false } },
    note: 'Impact is computed, never applied, by this preview.' },
  state: 'proposed' as const,
  note: 'Merge is a proposal. Conflicted changes are never resolved automatically.',
  counts_line: '1 change(s) can merge cleanly.',
  conflict_line: 'No conflict: the mainline has not moved since these changes were written.',
};

const decision = {
  proposal_id: proposalOne, branch_id: branchOne, state: 'merged' as const,
  applied: [{ change_id: changeOne, target_object_id: sceneTwo, target_label: 'Scene 2 Kitchen', revision: 2,
    changed_fields: ['title'], changed_field_labels: ['Title'] }],
  applied_count: 1, skipped: [], propagation: 'review_changes' as const,
  impact: [{ object_id: sceneTwo, analysis_id: 'analysis-1', mode: 'review_changes' as const,
    counts: { direct: 2, downstream: 3, total: 5 }, marked: 2, requiring_review: [{ object_id: shotTwelve }],
    locked_skipped: [], unresolved_count: 0, mode_label: 'Only the dependents I select',
    impact_line: '2 direct and 3 downstream object(s) depend on this; 2 artifact marker(s) were recorded.',
    review_line: 'Approved content was flagged for review instead of being rewritten silently.' }],
  note: 'New mainline revisions were created. Branch history is preserved.',
  applied_line: '1 new mainline revision(s) were created. Branch history is preserved.',
  state_label: 'Merged',
};

const services = productionVersioningService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const renderCanvas = () => render(
  <ProductionVersioningCanvas workspaceId={workspaceId} productionId={productionId}
    targets={[
      { id: storyId, label: 'Story', kind: 'creative_document', scope: 'story' },
      { id: sceneTwo, label: 'Scene 2 Kitchen', kind: 'scene', scope: 'scene' },
      { id: shotTwelve, label: 'Marcus close-up', kind: 'shot', scope: 'shot' },
    ]}
    busy={false} onChanged={vi.fn()} />,
);

const waitForVocabulary = async () => {
  await waitFor(() => expect(screen.getByRole('option', { name: 'Scene' })).toBeTruthy());
};

describe('ProductionVersioningCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.vocabulary.mockResolvedValue(vocabulary);
    services.versions.mockResolvedValue(history);
    services.branches.mockResolvedValue(branches);
    services.branch.mockResolvedValue(branchDetail);
    services.preview.mockResolvedValue(preview);
    services.decide.mockResolvedValue(decision);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('states what a branch is and what compare does and does not do', async () => {
    renderCanvas();
    await waitForVocabulary();
    expect(screen.getByText('What version am I looking at, and what happens if I accept an alternative?')).toBeTruthy();
    expect(screen.getByText(RULE)).toBeTruthy();
    expect(screen.getByText(LIMITATION)).toBeTruthy();
  });

  it('lists history and marks which revision is current', async () => {
    renderCanvas();
    await waitForVocabulary();
    expect(screen.getByText('This is the current revision.')).toBeTruthy();
    expect(screen.getByText('History: this is not the current revision.')).toBeTruthy();
    expect(screen.getAllByText('Edited')[0]).toBeTruthy();
    expect(screen.getAllByText('Created')[0]).toBeTruthy();
    expect(screen.getByText(/Versions are immutable records of what the object was/)).toBeTruthy();
  });

  it('refuses to restore the revision that is already current', async () => {
    renderCanvas();
    await waitForVocabulary();
    const buttons = screen.getAllByRole('button', { name: /Restore this version/ });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('restores an older version and reports the new revision it created', async () => {
    services.restore.mockResolvedValue({ object_id: sceneTwo, restored_from_version_id: versionOne,
      restored_from_revision: 1, new_revision: 3, changed_fields: ['title'], changed_field_labels: ['Title'],
      note: 'A new current revision was created from an older version. Nothing was rewound and no history was deleted.' });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getAllByRole('button', { name: /Restore this version/ })[1]);
    await waitFor(() => expect(services.restore).toHaveBeenCalled());
    expect(services.restore.mock.calls[0][2]).toBe(versionOne);
    await waitFor(() => expect(screen.getByText(/was created from revision 1/)).toBeTruthy());
  });

  it('compares two versions and shows the meaningful fields that differ', async () => {
    services.compare.mockResolvedValue({ object_id: sceneTwo, object_kind: 'scene', object_label: 'Scene 2 Kitchen',
      left_version_id: versionOne, left_revision: 1, right_version_id: versionTwo, right_revision: 2,
      changes: [{ field: 'title', label: 'Title', before: 'Scene 2 Kitchen', after: 'Scene 2 Kitchen, revised' }],
      change_count: 1, note: 'Only meaningful creative fields are shown, not a raw JSON diff.',
      limitation: LIMITATION });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getByRole('button', { name: /Compare versions/ }));
    await waitFor(() => expect(services.compare).toHaveBeenCalledWith(workspaceId, productionId, versionOne, versionTwo));
    await waitFor(() => expect(screen.getByText('Scene 2 Kitchen, revised')).toBeTruthy());
    expect(screen.getByText(/1 field\(s\) changed between revision 1 and revision 2/)).toBeTruthy();
  });

  it('describes a branch as an open alternative and reports what it proposes', async () => {
    renderCanvas();
    await waitForVocabulary();
    expect(screen.getByText('Open alternative')).toBeTruthy();
    expect(screen.getAllByText('Scene')[0]).toBeTruthy();
    expect(screen.getByText(/1 proposed change\(s\) are waiting to be merged\./)).toBeTruthy();
    expect(screen.getByText(/1 alternative\(s\) are open/)).toBeTruthy();
  });

  it('creates a branch from a known version and posts the origin it named', async () => {
    services.createBranch.mockResolvedValue({ ...branches.items[0], state: 'open' as const,
      note: 'The branch is an alternative. Nothing on the mainline changed.' });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: 'Product-first opening' } });
    fireEvent.change(screen.getByLabelText('Branch source version'), { target: { value: versionOne } });
    fireEvent.change(screen.getByLabelText('Branch reason'), { target: { value: 'Try the product earlier.' } });
    fireEvent.click(screen.getByRole('button', { name: /Create branch/ }));
    await waitFor(() => expect(services.createBranch).toHaveBeenCalled());
    expect(services.createBranch.mock.calls[0][2]).toMatchObject({ scopeObjectId: storyId, scope: 'scene',
      name: 'Product-first opening', sourceVersionId: versionOne, reason: 'Try the product earlier.' });
  });

  it('shows a branch proposal as a proposal and lets it be discarded as history', async () => {
    services.clearChange.mockResolvedValue({ change_id: changeOne, state: 'rejected' as const,
      note: 'The proposed change was discarded. It stays readable as branch history.' });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getByRole('button', { name: /Open this branch/ }));
    await waitFor(() => expect(services.branch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Ready to merge')).toBeTruthy());
    expect(screen.getByText(/Branch edits never change the mainline/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Discard this change/ }));
    await waitFor(() => expect(services.clearChange).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/stays readable as branch history/)).toBeTruthy());
  });

  it('proposes a field patch on the branch without touching the mainline', async () => {
    services.setChange.mockResolvedValue({ change_id: changeOne, target_object_id: sceneTwo,
      target_label: 'Scene 2 Kitchen', target_kind: 'scene', base_version_id: versionOne, base_revision: 1,
      patch: { title: 'Scene 2 Kitchen, product first' }, changed_fields: ['title'], note: 'Lead with it.',
      state: 'pending' as const, applied_version_id: null, applied_revision: null,
      state_label: 'Ready to merge', changed_field_labels: ['Title'] });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getByRole('button', { name: /Open this branch/ }));
    await waitFor(() => expect(services.branch).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Branch change target'), { target: { value: sceneTwo } });
    fireEvent.change(screen.getByLabelText('Branch change field'), { target: { value: 'title' } });
    fireEvent.change(screen.getByLabelText('Branch change value'), { target: { value: 'Scene 2 Kitchen, product first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose change' }));
    await waitFor(() => expect(services.setChange).toHaveBeenCalled());
    expect(services.setChange.mock.calls[0][3]).toMatchObject({ targetObjectId: sceneTwo,
      patch: { title: 'Scene 2 Kitchen, product first' } });
  });

  it('previews a merge and reports clean and conflicted change counts', async () => {
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getByRole('button', { name: /Preview merge/ }));
    await waitFor(() => expect(services.preview).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/1 change\(s\) can merge cleanly\./).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/No conflict: the mainline has not moved/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Impact is computed, never applied, by this preview\./)).toBeTruthy();
    expect(screen.getByText(/Merge is a proposal\./)).toBeTruthy();
  });

  it('shows a conflict with both values instead of resolving it here', async () => {
    services.preview.mockResolvedValue({
      ...preview,
      counts: { clean: 0, conflicted: 1, total: 1 },
      counts_line: '0 change(s) can merge cleanly and 1 conflict(s) need your decision.',
      conflict_line: 'A conflict is shown, never resolved automatically: the mainline and this branch both changed the same field.',
      items: [{ ...preview.items[0], status: 'conflict' as const, state_label: 'Conflicted',
        conflicts: [{ field: 'title', label: 'Title', branch_value: 'Scene 2 Kitchen, product first',
          main_value: 'Scene 2 Kitchen, rewritten', base_value: 'Scene 2 Kitchen' }] }],
      conflicts: [{ change_id: changeOne, target_object_id: sceneTwo, target_label: 'Scene 2 Kitchen',
        base_revision: 1, current_revision: 2,
        reason: 'The mainline moved after this branch change was written.',
        fields: [{ field: 'title', label: 'Title', branch_value: 'a', main_value: 'b', base_value: 'c' }] }],
    });
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getByRole('button', { name: /Preview merge/ }));
    await waitFor(() => expect(screen.getAllByText(/0 change\(s\) can merge cleanly and 1 conflict\(s\) need your decision\./).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/shown, never resolved automatically/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/mainline moved after this branch change was written/).length).toBeGreaterThan(0);
    // A conflicted change cannot be selected for merging.
    expect(screen.queryByRole('button', { name: /Merge selected changes/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Merge selected changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('posts the merge decision with the scope and propagation the creator chose', async () => {
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getByRole('button', { name: /Preview merge/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Merge selected changes/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Merge propagation'), { target: { value: 'review_changes' } });
    fireEvent.change(screen.getByLabelText('Merge decision note'), { target: { value: 'Ship it.' } });
    fireEvent.click(screen.getByRole('button', { name: /Merge selected changes/ }));
    await waitFor(() => expect(services.decide).toHaveBeenCalled());
    const call = services.decide.mock.calls[0];
    expect(call[2]).toBe(proposalOne);
    expect(call[3]).toMatchObject({ decision: 'merge', selectedChangeIds: [changeOne],
      propagation: 'review_changes', note: 'Ship it.' });
    await waitFor(() => expect(screen.getAllByText(/1 new mainline revision\(s\) were created/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Approved content was flagged for review/).length).toBeGreaterThan(0);
  });

  it('never presents a merge as an approval', async () => {
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getByRole('button', { name: /Preview merge/ }));
    await waitFor(() => expect(services.preview).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(screen.getByText(/Merging creates revisions and marks dependent artifacts\. It is not an approval\./)).toBeTruthy();
  });

  it('surfaces a refused restore instead of pretending it worked', async () => {
    services.restore.mockRejectedValue(new AppError('conflict',
      'That object changed since you loaded it.'));
    renderCanvas();
    await waitForVocabulary();
    fireEvent.click(screen.getAllByRole('button', { name: /Restore this version/ })[1]);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/That object changed since you loaded it\./)).toBeTruthy();
    expect(services.versions).toHaveBeenCalled();
  });
});
