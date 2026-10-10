import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionIntelligenceCanvas } from '../studio/ProductionIntelligence';
import { productionIntelligenceService, type ImpactPreview } from '../services/productionIntelligence';
import { AppError } from '../services/errors';

vi.mock('../services/productionIntelligence', () => ({
  productionIntelligenceService: {
    modes: vi.fn(), sync: vi.fn(), declareDependency: vi.fn(), setDependenciesActive: vi.fn(),
    dependencies: vi.fn(), graph: vi.fn(), preview: vi.fn(), apply: vi.fn(), history: vi.fn(),
    stale: vi.fn(), markStale: vi.fn(), resolveStale: vi.fn(),
  },
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const character = '00000000-0000-4000-8000-000000000801';
const sceneEighteen = '00000000-0000-4000-8000-000000000301';
const shotTwelve = '00000000-0000-4000-8000-000000000401';
const shotFourteen = '00000000-0000-4000-8000-000000000403';
const plan = '00000000-0000-4000-8000-000000000901';
const analysis = '00000000-0000-4000-8000-000000000b01';
const marker = '00000000-0000-4000-8000-000000000c01';

const modes = [
  { mode: 'update_all' as const, label: 'UPDATE ALL', description: 'Mark every affected derived artifact.' },
  { mode: 'review_changes' as const, label: 'REVIEW CHANGES', description: 'Mark only the dependents you selected.' },
  { mode: 'change_only_this' as const, label: 'CHANGE ONLY THIS', description: 'Keep the change local.' },
];

const graph = {
  root_object_id: character, root_kind: 'asset', root_label: 'Marcus', direction: 'forward' as const,
  direction_label: 'What this affects', depth: 2,
  nodes: [
    { object_id: shotTwelve, level: 'shot', label: 'Shot 12', depth: 1, relation: 'asset',
      classification: 'direct' as const, classification_label: 'Direct', level_label: 'Shot',
      relation_label: 'Asset binding', status: 'Open', locked: false, approved: false, revision: 4 },
    { object_id: plan, level: 'execution_plan', label: 'AI plan for Shot 12', depth: 2, relation: 'execution',
      classification: 'downstream' as const, classification_label: 'Downstream', level_label: 'Execution plan',
      relation_label: 'Execution', status: 'Open', locked: false, approved: false, revision: 3 },
    { object_id: shotFourteen, level: 'shot', label: 'Shot 14', depth: 1, relation: 'creative',
      classification: 'potential' as const, classification_label: 'Potential', level_label: 'Shot',
      relation_label: 'Creative', status: 'Locked', locked: true, approved: false, revision: 2 },
  ],
  edges: [],
  total: 3, total_label: '3 reachable object(s)', truncated: false, cycles_safe: true,
  note: 'Traversal is bounded and cycle-safe.',
};

const edgeList = {
  object_id: character, limit: 100, offset: 0,
  items: [
    { source_object_id: character, target_object_id: shotTwelve, relation: 'asset', strength: 'hard' as const,
      origin: 'derived' as const, reason: 'This character binding references the source directly.',
      affected_fields: ['character'], active: true, revision: 1, source_label: 'Marcus', target_label: 'Shot 12',
      relation_label: 'Asset binding', strength_label: 'Hard', origin_label: 'Derived from your Production',
      state_label: 'Active' },
  ],
  note: 'Edges are deactivated, never deleted.',
};

const markers = {
  items: [
    { artifact_id: marker, artifact_kind: 'dependent_object' as const, artifact_ref: null, object_id: plan,
      object_label: 'AI plan for Shot 12', object_kind: 'execution_plan', state: 'stale' as const,
      reason: 'The source Marcus changed after this artifact was derived.', caused_by_object_id: character,
      caused_by_label: 'Marcus', caused_by_revision: 4, source_revision: 3, current_revision: 4,
      resolved_at: null, created_at: '2026-10-05T10:00:00Z', artifact_kind_label: 'Dependent object',
      state_label: 'Stale' },
  ],
  total: 1, open: 1, limit: 100, offset: 0, note: 'Stale means the artifact may no longer match its source.',
  open_label: '1 artifact(s) may no longer match their source.',
};

function preview(overrides: Partial<ImpactPreview> = {}): ImpactPreview {
  return {
    analysis_id: analysis, root_object_id: character, root_kind: 'asset', root_label: 'Marcus',
    root_revision: 4, structure_revision: 41, depth: 2, nodes: graph.nodes,
    counts: { direct: 1, downstream: 1, potential: 1, locked: 1, approved: 0,
      by_level: { shot: 2, execution_plan: 1 }, total: 3 },
    locked_ids: [shotFourteen], approved_ids: [],
    explanation: 'Marcus affects 1 direct object and 1 downstream object.',
    applied: false, requires_confirmation: true,
    summary_line: 'Marcus affects 1 direct object, 1 downstream object, 1 potential dependency.',
    modes, total_label: '3 affected object(s)',
    rule: 'Impact is computed, never applied. Nothing in this Production changed yet.',
    ...overrides,
  };
}

function mount(overrides: { selectedShotId?: string | null; selectedSceneId?: string | null } = {}) {
  const onChanged = vi.fn(); const onSelectShot = vi.fn(); const onSelectScene = vi.fn();
  render(<ProductionIntelligenceCanvas workspaceId={workspaceId} productionId={productionId}
    assets={[{ id: character, name: 'Marcus', asset_type: 'character' }]}
    selectedSceneId={overrides.selectedSceneId ?? sceneEighteen}
    selectedShotId={overrides.selectedShotId === undefined ? shotTwelve : overrides.selectedShotId}
    sceneTitle="Scene 18" shotTitle="Shot 12" productionTitle="Marquee film"
    busy={false} onChanged={onChanged} />);
  return { onChanged, onSelectShot, onSelectScene };
}

beforeEach(() => {
  vi.mocked(productionIntelligenceService.modes).mockResolvedValue({
    modes, rule: 'Impact is computed, never applied by computing it.', direction: 'An edge means one thing only.' });
  vi.mocked(productionIntelligenceService.graph).mockResolvedValue(graph);
  vi.mocked(productionIntelligenceService.dependencies).mockResolvedValue(edgeList);
  vi.mocked(productionIntelligenceService.stale).mockResolvedValue(markers);
  vi.mocked(productionIntelligenceService.history).mockResolvedValue({
    items: [{ analysis_id: analysis, root_object_id: character, root_label: 'Marcus', root_kind: 'asset',
      root_revision: 4, structure_revision: 41, mode: 'update_all', applied_mode: 'update_all',
      applied_at: '2026-10-05T10:05:00Z', counts: { direct: 1, downstream: 1 }, explanation: 'Marcus affects 1.',
      unresolved_count: 1, created_at: '2026-10-05T10:00:00Z', mode_label: 'UPDATE ALL',
      applied_mode_label: 'UPDATE ALL', affected_label: '1 direct, 1 downstream' }],
    total: 1, limit: 20, offset: 0, truncated: false,
    note: 'An impact analysis is a snapshot. Regenerating never overwrites this record.' });
  vi.mocked(productionIntelligenceService.sync).mockResolvedValue({
    production_id: productionId, edges_considered: 7, note: 'Derived edges come from real bindings.' });
  vi.mocked(productionIntelligenceService.preview).mockResolvedValue(preview());
  vi.mocked(productionIntelligenceService.apply).mockResolvedValue({
    analysis_id: analysis, mode: 'update_all', mode_label: 'UPDATE ALL', applied: true, marked: 2,
    direct_count: 1, downstream_count: 1, unresolved_count: 0,
    locked_skipped: [{ object_id: shotFourteen, label: 'Shot 14',
      reason: 'The dependent object is locked. Unlock it before TONDE updates it.', reason_label: 'Protected by a lock' }],
    requiring_review: [{ object_id: sceneEighteen, label: 'Scene 18 script', revision: 3,
      reason: 'Approved content is never rewritten silently.', reason_label: 'Needs creator review' }],
    note: 'Affected derived artifacts were marked. Approved content and locked objects were reported, not rewritten.',
    summary_line: '2 artifact(s) marked for UPDATE ALL. 1 locked dependent(s) were reported instead of changed.',
  });
  vi.mocked(productionIntelligenceService.setDependenciesActive).mockResolvedValue({
    changed: 2, active: false, note: 'Edges are deactivated, never deleted: the history of a relationship stays readable.' });
  vi.mocked(productionIntelligenceService.resolveStale).mockResolvedValue({
    artifact_id: marker, state: 'current', note: 'The creator resolved this artifact. Historical markers stay readable.' });
  vi.mocked(productionIntelligenceService.markStale).mockResolvedValue({
    artifact_id: marker, state: 'stale', note: 'The artifact was marked, not rewritten, and the marker stays readable as history.' });
});

afterEach(() => { vi.clearAllMocks(); });

describe('Production Intelligence', () => {
  it('states that impact is computed and never applied by computing it', async () => {
    mount();
    expect(await screen.findByText('What does this change affect?')).toBeInTheDocument();
    expect(await screen.findByText(/Impact is computed, never applied by computing it/)).toBeInTheDocument();
    expect(screen.getByText(/An edge means one thing only/)).toBeInTheDocument();
    expect(productionIntelligenceService.apply).not.toHaveBeenCalled();
  });

  it('labels every reachable object and marks an inferred dependency as potential', async () => {
    mount();
    expect((await screen.findAllByText('Marcus')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('AI plan for Shot 12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Direct').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Downstream').length).toBeGreaterThan(0);
    expect(screen.getByText('Potential')).toBeInTheDocument();
    expect(screen.getByText('Execution plan')).toBeInTheDocument();
    expect(await screen.findByText(/3 reachable object\(s\)/)).toBeInTheDocument();
  });

  it('never applies an impact on its own: the apply button stays dead until a choice is made', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Preview impact/ }));
    await waitFor(() => expect(productionIntelligenceService.preview)
      .toHaveBeenCalledWith(workspaceId, productionId, shotTwelve, 2));
    expect((await screen.findAllByText(/Marcus affects 1 direct object, 1 downstream object/)).length).toBe(2);
    const applyButton = screen.getByRole('button', { name: /Apply/ });
    expect(applyButton).toBeDisabled();
    fireEvent.click(applyButton);
    expect(productionIntelligenceService.apply).not.toHaveBeenCalled();
    expect(screen.getByText(/Choose a propagation choice first/)).toBeInTheDocument();
  });

  it('shows the three constitutional propagation choices and their real meaning', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Preview impact/ }));
    expect(await screen.findByRole('radio', { name: /UPDATE ALL/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /REVIEW CHANGES/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /CHANGE ONLY THIS/ })).toBeInTheDocument();
    expect(screen.getByText(/Keep the change local/)).toBeInTheDocument();
    expect(screen.getAllByText(/never applied/).length).toBeGreaterThan(0);
  });

  it('refuses REVIEW CHANGES until at least one dependent is selected', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Preview impact/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /REVIEW CHANGES/ }));
    const applyButton = screen.getByRole('button', { name: /Apply REVIEW CHANGES/ });
    expect(applyButton).toBeDisabled();
    expect(screen.getByText(/Select at least one dependent to change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /AI plan for Shot 12/ }));
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);
    await waitFor(() => expect(productionIntelligenceService.apply).toHaveBeenCalledWith(workspaceId, productionId,
      { analysisId: analysis, mode: 'review_changes', selectedIds: [plan], expectedRootRevision: 4 }));
  });

  it('offers only real dependents for REVIEW CHANGES and never a potential proposal', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Preview impact/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /REVIEW CHANGES/ }));
    expect(screen.getByRole('checkbox', { name: /^Shot 12/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Shot 14/ })).not.toBeInTheDocument();
    expect(screen.getByText(/A potential dependency is a proposal, so it is never applied/)).toBeInTheDocument();
  });

  it('applies UPDATE ALL against the pinned revision and reports what was protected', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Preview impact/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /UPDATE ALL/ }));
    fireEvent.click(screen.getByRole('button', { name: /Apply UPDATE ALL/ }));
    await waitFor(() => expect(productionIntelligenceService.apply).toHaveBeenCalledWith(workspaceId, productionId,
      { analysisId: analysis, mode: 'update_all', selectedIds: [], expectedRootRevision: 4 }));
    expect(await screen.findByText(/REPORTED, NOT CHANGED/)).toBeInTheDocument();
    expect(screen.getByText(/Shot 14 — The dependent object is locked/)).toBeInTheDocument();
    expect(screen.getByText(/NEEDS YOUR REVIEW/)).toBeInTheDocument();
    expect(screen.getByText(/Scene 18 script — Approved content is never rewritten silently/)).toBeInTheDocument();
  });

  it('keeps a pending downstream change visible under CHANGE ONLY THIS', async () => {
    vi.mocked(productionIntelligenceService.apply).mockResolvedValueOnce({
      analysis_id: analysis, mode: 'change_only_this', mode_label: 'CHANGE ONLY THIS', applied: true, marked: 1,
      direct_count: 1, downstream_count: 1, unresolved_count: 1, locked_skipped: [], requiring_review: [],
      note: 'CHANGE ONLY THIS: the change stayed local and the remaining downstream impact is recorded as unresolved.',
      summary_line: '1 artifact(s) marked for CHANGE ONLY THIS. 1 downstream change(s) remain unresolved.' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Preview impact/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /CHANGE ONLY THIS/ }));
    fireEvent.click(screen.getByRole('button', { name: /Apply CHANGE ONLY THIS/ }));
    await waitFor(() => expect(productionIntelligenceService.apply).toHaveBeenCalledWith(workspaceId, productionId,
      { analysisId: analysis, mode: 'change_only_this', selectedIds: [], expectedRootRevision: 4 }));
    expect(await screen.findByText(/1 downstream change\(s\) stay unresolved/)).toBeInTheDocument();
    expect(screen.getByText(/the change stayed local/)).toBeInTheDocument();
  });

  it('reports a locked dependent in the preview counts instead of hiding it', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Preview impact/ }));
    const counts = await screen.findByLabelText('Affected objects');
    expect(counts).toHaveTextContent('Locked');
    expect(counts).toHaveTextContent('Approved');
    expect(counts).toHaveTextContent('2 shot · 1 execution_plan');
  });

  it('surfaces a failed preview as an alert rather than a silent no-op', async () => {
    vi.mocked(productionIntelligenceService.preview)
      .mockRejectedValueOnce(new AppError('conflict', 'Preview the impact again.'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Preview impact/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Preview the impact again.');
  });

  it('deactivates a stored relationship instead of deleting it', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Deactivate/ }));
    await waitFor(() => expect(productionIntelligenceService.setDependenciesActive)
      .toHaveBeenCalledWith(workspaceId, productionId, { edgeIds: [character, shotTwelve], active: false,
        note: 'Deactivated from Studio.' }));
    expect(screen.getByText(/Deactivating keeps the history readable/)).toBeInTheDocument();
  });

  it('lists a stale artifact with its cause and resolves it explicitly', async () => {
    mount();
    expect(await screen.findByText('Dependent object')).toBeInTheDocument();
    expect(screen.getByText(/Caused by Marcus/)).toBeInTheDocument();
    expect(await screen.findByText('1 artifact(s) may no longer match their source.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark resolved/ }));
    await waitFor(() => expect(productionIntelligenceService.resolveStale)
      .toHaveBeenCalledWith(workspaceId, productionId, marker));
  });

  it('marks an artifact stale only with a real reason, and never rewrites it', async () => {
    mount();
    const submit = await screen.findByRole('button', { name: /^Mark stale$/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Stale reason'), { target: { value: 'Marcus is injured from Scene 4.' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(productionIntelligenceService.markStale).toHaveBeenCalledWith(workspaceId, productionId,
      { objectId: shotTwelve, artifactKind: 'dependent_object', reason: 'Marcus is injured from Scene 4.' }));
    expect(screen.getByText(/It never rewrites the artifact/)).toBeInTheDocument();
  });

  it('shows impact history as a snapshot that a new preview cannot overwrite', async () => {
    mount();
    expect(await screen.findByText('IMPACT HISTORY')).toBeInTheDocument();
    expect(screen.getByText(/1 direct, 1 downstream/)).toBeInTheDocument();
    expect(screen.getByText(/never overwrites a previous one/)).toBeInTheDocument();
  });
});
