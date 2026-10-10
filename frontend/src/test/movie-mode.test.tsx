import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MovieModeCanvas } from '../studio/MovieMode';
import { longFormService, type StructurePage } from '../services/longForm';
import { AppError } from '../services/errors';

vi.mock('../services/longForm', () => ({
  longFormService: {
    listSeries: vi.fn(), structure: vi.fn(), timing: vi.fn(), search: vi.fn(), scriptIndex: vi.fn(),
    context: vi.fn(), summaries: vi.fn(), saveSummary: vi.fn(), createAct: vi.fn(), updateAct: vi.fn(),
    createSequence: vi.fn(), updateSequence: vi.fn(), moveScene: vi.fn(), moveSequence: vi.fn(), split: vi.fn(),
    reorder: vi.fn(), setApproval: vi.fn(), setLock: vi.fn(), directorScope: vi.fn(),
  },
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const actOne = '00000000-0000-4000-8000-000000000101';
const actTwo = '00000000-0000-4000-8000-000000000102';
const sequenceFour = '00000000-0000-4000-8000-000000000201';
const sceneEighteen = '00000000-0000-4000-8000-000000000301';
const shotThree = '00000000-0000-4000-8000-000000000401';

const timing = {
  production: { target_ms: 5400000, calculated_ms: 5500000, delta_ms: 100000, status: 'over',
    target_label: '1:30:00', calculated_label: '1:31:40', delta_label: '1:40' },
  counts: { acts: 2, sequences: 4, scenes: 9, shots: 22 },
  rule: 'A planned target is never overwritten by a calculated child total.',
};

const actItem = (id: string, title: string, index: number, overrides: Record<string, unknown> = {}) => ({
  id, level: 'act' as const, title, display: `Act ${index}`, display_index: index, order: index * 1024,
  purpose: 'Raise the stakes', planned_duration_ms: 1860000, calculated_duration_ms: 1900000, label: '31:40',
  delta_ms: 40000, status: 'over', depth: 'scenes_planned', depth_label: 'Scenes Planned', approval: 'draft' as const,
  locked: false, revision: 3, summary: null, documents: [], child_counts: { sequences: 2, scenes: 5 }, ...overrides,
});

function actsPage(): StructurePage {
  return {
    production_id: productionId, production_revision: 7, structure_revision: 41, level: 'production',
    scope: { level: 'production', id: productionId, title: 'Ninety minute film', depth: 'scenes_planned',
      depth_label: 'Scenes Planned', orphan_sequences: 0, orphan_scenes: 0,
      summary: { text: 'A film about leaving.', stale: false, source_revision: 7, revision: 1, stale_label: 'CURRENT' } },
    breadcrumb: [{ level: 'production', id: productionId, title: 'Ninety minute film' }],
    breadcrumb_line: 'Ninety minute film',
    items: [actItem(actOne, 'Act 1 - Ordinary world', 1), actItem(actTwo, 'Act 2 - The break', 2)],
    total: 2, limit: 50, offset: 0, truncated: false,
    lazy: 'One level at a time: a large Production is paged, never expanded eagerly.',
    timing,
  };
}

function actPage(): StructurePage {
  return {
    ...actsPage(), level: 'act',
    scope: { level: 'act', id: actTwo, title: 'Act 2 - The break', display: 'Act', depth: 'scenes_planned' },
    breadcrumb: [{ level: 'production', id: productionId, title: 'Ninety minute film' },
      { level: 'act', id: actTwo, title: 'Act 2 - The break' }],
    breadcrumb_line: 'Ninety minute film -> Act 2 - The break',
    items: [
      { id: sequenceFour, level: 'sequence', title: 'Sequence 4 - Return', kind: 'narrative', display: 'Sequence 1',
        display_index: 1, order: 1024, purpose: 'The return', planned_duration_ms: 240000, calculated_duration_ms: 240000,
        label: '4:00', delta_ms: 0, status: 'fits', depth: 'scenes_planned', depth_label: 'Scenes Planned',
        approval: 'approved', locked: true, revision: 4, summary: null, documents: [], child_counts: { scenes: 2 } },
      { id: sceneEighteen, level: 'scene', title: 'Scene 18', display: 'Scene 18', display_index: 18, order: 2048,
        purpose: 'Confrontation', planned_duration_ms: 60000, calculated_duration_ms: 60000, label: '1:00', delta_ms: 0,
        status: 'fits', depth: 'shots_planned', depth_label: 'Shots Planned', approval: 'draft', locked: false, revision: 5,
        summary: { text: 'Marcus decides to stay.', stale: true, source_revision: 4, revision: 2,
          stale_label: 'STALE — the object changed since this summary was derived' },
        documents: [{ document_id: 'doc-1', document_type: 'script', revision: 2 }], child_counts: { shots: 4 } },
    ],
    total: 2,
  };
}

function mount() {
  const onSelectScene = vi.fn(); const onSelectShot = vi.fn(); const onChanged = vi.fn();
  render(<MovieModeCanvas workspaceId={workspaceId} productionId={productionId} selectedSceneId={null}
    selectedShotId={null} onSelectScene={onSelectScene} onSelectShot={onSelectShot} onChanged={onChanged} busy={false} />);
  return { onSelectScene, onSelectShot, onChanged };
}

beforeEach(() => {
  vi.mocked(longFormService.structure).mockImplementation(async (_workspace, _production, options = {}) =>
    (options.level ?? 'production') === 'production' ? actsPage() : actPage());
  vi.mocked(longFormService.summaries).mockResolvedValue({ items: [], total: 0, truncated: false });
  vi.mocked(longFormService.setApproval).mockResolvedValue({ approval: 'approved', revision: 5 });
  vi.mocked(longFormService.setLock).mockResolvedValue({ locked: true, revision: 5 });
  vi.mocked(longFormService.reorder).mockResolvedValue({ structure_revision: 42 });
  vi.mocked(longFormService.createAct).mockResolvedValue({ act_id: actOne, revision: 1 });
  vi.mocked(longFormService.createSequence).mockResolvedValue({ sequence_id: sequenceFour, revision: 1 });
  vi.mocked(longFormService.split).mockResolvedValue({ created_id: 'new-act', structure_revision: 42 });
  vi.mocked(longFormService.moveScene).mockResolvedValue({ scene_id: sceneEighteen, revision: 6 });
  vi.mocked(longFormService.saveSummary).mockResolvedValue({ summary_id: 's-1', revision: 1 });
  vi.mocked(longFormService.search).mockResolvedValue({ query: 'phone', total: 1, items: [
    { level: 'shot', id: shotThree, title: 'Marcus holds the phone', snippet: 'weapon lower third',
      match_field: 'shot', scene_id: sceneEighteen, shot_id: shotThree, approval: 'draft', locked: false,
      depth: 'shots_planned', takes: 1, results: 0, attempts: 0, execution_method: 'real' },
  ], limit: 40, offset: 0, truncated: false, filters: {}, note: 'Structured relational matches.' });
  vi.mocked(longFormService.directorScope).mockResolvedValue({
    resolution: { level: 'act', identifier: actTwo, operation: 'shorten_scope', ambiguous: false,
      scope_is_explicit: true, note: 'Act 2 was named.' },
    direction: { kind: 'shorten_scope' }, structure_revision: 41,
    breadcrumb_line: 'Ninety minute film -> Act 2 - The break',
    context: { scope: { level: 'act', id: actTwo, title: 'Act 2 - The break' }, path: [], siblings: [],
      timing, depth: 'scenes_planned', truncated: false },
    rule: 'Scope is explicit. A command that names no scope is reported as ambiguous instead of being widened to the whole Production, and no other Act is rewritten.',
  });
});

afterEach(() => { vi.clearAllMocks(); });

describe('Movie Mode', () => {
  it('shows the planned target, the calculated child total and the real difference', async () => {
    mount();
    expect(await screen.findByLabelText('Runtime rollup')).toBeInTheDocument();
    expect(screen.getByText('1:30:00')).toBeInTheDocument();
    expect(screen.getByText('1:31:40')).toBeInTheDocument();
    expect(screen.getByText(/over by 1:40/)).toBeInTheDocument();
    expect(screen.getByText(/2 Acts · 4 Sequences · 9 Scenes · 22 Shots/)).toBeInTheDocument();
    expect(screen.getByText(/never expanded eagerly/)).toBeInTheDocument();
  });

  it('drills into an Act lazily with an explicit scope and keeps the Act revision for its writes', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText(/Act 2 - The break/));
    await waitFor(() => expect(longFormService.structure).toHaveBeenCalledWith(workspaceId, productionId,
      { level: 'act', scopeId: actTwo, limit: 50 }));
    expect(await screen.findByText('Sequence 1 · Sequence 4 - Return', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/STALE — the object changed since this summary was derived/)).toBeInTheDocument();
    expect(screen.getByLabelText('Structure breadcrumb')).toHaveTextContent('Act 2 - The break');
  });

  it('unlocks a locked Sequence with an explicit unlock call against the revision that was read', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText(/Act 1 - Ordinary world/));
    await screen.findByText('Sequence 1 · Sequence 4 - Return', { selector: 'strong' });
    fireEvent.click(screen.getByRole('button', { name: /Unlock/ }));
    await waitFor(() => expect(longFormService.setLock).toHaveBeenCalledWith(workspaceId, productionId,
      { level: 'sequence', id: sequenceFour, locked: false, expectedRevision: 4 }));
  });

  it('reorders with the complete order and the structure revision', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Move Act 2 earlier'));
    await waitFor(() => expect(longFormService.reorder).toHaveBeenCalledTimes(1));
    expect(longFormService.reorder).toHaveBeenCalledWith(workspaceId, productionId,
      { level: 'act', orderedIds: [actTwo, actOne], expectedStructureRevision: 41, parentId: null });
  });

  it('creates an Act against the production revision and never invents a duration', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Act title'), { target: { value: 'Act 3 - Coda' } });
    fireEvent.change(screen.getByLabelText('Narrative goal'), { target: { value: 'Acceptance' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Act/ }));
    await waitFor(() => expect(longFormService.createAct).toHaveBeenCalledWith(workspaceId, productionId,
      { title: 'Act 3 - Coda', narrative_goal: 'Acceptance' }, 7));
  });

  it('splits an Act at a Scene boundary using the opened Act revision', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText(/Act 2 - The break/));
    await screen.findByText('Sequence 1 · Sequence 4 - Return', { selector: 'strong' });
    fireEvent.click(screen.getByRole('button', { name: /Split Act here/ }));
    await waitFor(() => expect(longFormService.split).toHaveBeenCalledWith(workspaceId, productionId,
      { level: 'act', id: actTwo, splitOrder: 2048, expectedRevision: 3, title: 'Act 2 - The break B' }));
  });

  it('reports a locked Act failure instead of pretending the change applied', async () => {
    vi.mocked(longFormService.setApproval).mockRejectedValueOnce(new AppError('authorization', 'Unlock this Act before changing it.'));
    mount();
    fireEvent.click(await screen.findByLabelText(/Act 1 - Ordinary world/));
    await screen.findByText('Sequence 1 · Sequence 4 - Return', { selector: 'strong' });
    expect(screen.getByRole('button', { name: /Reopen for review/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reopen for review/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unlock this Act before changing it.');
  });

  it('forwards structured search filters and shares the selection with the Studio', async () => {
    const { onSelectShot } = mount();
    fireEvent.change(await screen.findByLabelText('Search'), { target: { value: 'phone' } });
    fireEvent.change(screen.getByLabelText('Execution'), { target: { value: 'real' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() => expect(longFormService.search).toHaveBeenCalledWith(workspaceId, productionId, 'phone',
      { levels: undefined, executionMethod: 'real' }));
    fireEvent.click(await screen.findByRole('button', { name: /Marcus holds the phone/ }));
    expect(onSelectShot).toHaveBeenCalledWith(sceneEighteen, shotThree);
  });

  it('resolves a Director command to one explicit scope and creates nothing', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Direction'), { target: { value: 'Make Act 2 shorter.' } });
    fireEvent.click(screen.getByRole('button', { name: /Resolve scope/ }));
    expect(await screen.findByText('Ninety minute film -> Act 2 - The break')).toBeInTheDocument();
    expect(screen.getByText(/no other Act is rewritten/)).toBeInTheDocument();
    expect(longFormService.createAct).not.toHaveBeenCalled();
    expect(longFormService.reorder).not.toHaveBeenCalled();
  });
});
