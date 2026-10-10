import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SeriesStudioCanvas } from '../studio/SeriesStudio';
import { longFormService, type ProductionLine, type SeriesOverview } from '../services/longForm';

vi.mock('../services/longForm', () => ({
  longFormService: {
    listSeries: vi.fn(), overview: vi.fn(), productionLine: vi.fn(), slots: vi.fn(), jobs: vi.fn(),
    createSeries: vi.fn(), saveCollection: vi.fn(), updateEpisode: vi.fn(), createEpisode: vi.fn(),
    previewGenerateAhead: vi.fn(), generateAhead: vi.fn(), retry: vi.fn(), seriesDirectorScope: vi.fn(),
    structure: vi.fn(), search: vi.fn(), directorScope: vi.fn(),
  },
}));

const workspaceId = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const seriesId = '00000000-0000-4000-8000-000000000501';
const episodeId = '00000000-0000-4000-8000-000000000601';
const episodeProduction = '00000000-0000-4000-8000-000000000020';
const hostAsset = '00000000-0000-4000-8000-000000000801';

const overview = (): SeriesOverview => ({
  series_id: seriesId, title: 'Daily Personal Finance', series_kind: 'recurring', timezone: 'Europe/London',
  lifecycle: 'active', revision: 2, cadence_metadata: { kind: 'daily' }, format: { planned_episodes: 10 },
  summary: null, collections: [], counts: { episodes_active: 7, episodes_archived: 0, collections: 0,
    planned_episodes: '10', next_episode_number: 8 },
  reuse: [{ asset_id: hostAsset, name: 'Host', asset_type: 'character', missing: false }],
  upcoming: [], last_generate_ahead: null,
  note: 'Recurring context is referenced, never copied: each Episode stays its own canonical Production.',
});

const line = (): ProductionLine => ({
  total: 1, limit: 30, offset: 0, truncated: false, readiness_is_criteria_based: true,
  items: [{
    episode_id: episodeId, episode_number: 3, title: 'Money minute 3', planned_date: '2026-10-08',
    production_id: episodeProduction, production_title: 'Money minute 3', lifecycle: 'active',
    production_lifecycle: 'active', requested_depth: 'complete_plan', requested_depth_label: 'Complete Production Plan',
    depth: 'idea', depth_label: 'Idea', line_state: 'idea', line_state_label: 'Idea', approval: 'draft', locked: false,
    production_revision: 1, episode_revision: 1, collection_id: null,
    execution_summary: { real: 0, ai: 0, hybrid: 0 },
    timing: { production: { target_ms: 45000, calculated_ms: 0, status: 'under' }, counts: { scenes: 0, shots: 0 } },
    blockers: [{ code: 'requested_depth_missing', severity: 'blocking',
      message: 'The Story is not written yet.', action: 'Write or generate the Story for this Episode.' }],
    readiness: { blocking: 1, warnings: 0, state: 'BLOCKED' },
  }],
  note: 'States come from real domain state (documents, Scenes, Shots, plans, captures, Results, approval). No percentage is invented.',
});

function mount(series: string | null = seriesId) {
  const onSelectSeries = vi.fn();
  render(<MemoryRouter><SeriesStudioCanvas workspaceId={workspaceId} projectId={projectId}
    seriesId={series} onSelectSeries={onSelectSeries} /></MemoryRouter>);
  return { onSelectSeries };
}

beforeEach(() => {
  vi.mocked(longFormService.listSeries).mockResolvedValue([{
    id: seriesId, workspace_id: workspaceId, project_id: projectId, title: 'Daily Personal Finance',
    series_kind: 'recurring', timezone: 'Europe/London', lifecycle: 'active', revision: 2,
    cadence_metadata: { kind: 'daily' }, format: { planned_episodes: 10 }, summary: {}, bible_document_id: null,
    created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
  }]);
  vi.mocked(longFormService.overview).mockResolvedValue(overview());
  vi.mocked(longFormService.productionLine).mockResolvedValue(line());
  vi.mocked(longFormService.slots).mockResolvedValue({
    horizon: 'next_7', timezone: 'Europe/London', today: '2026-10-05', cadence_metadata: { kind: 'daily' },
    slots: [{ slot_key: '2026-10-06', planned_date: '2026-10-06', episode_number: 8, state: 'open', existing_episode_id: null }],
    counts: { open: 7, preserved: 0, held: 0, total: 7 },
    note: 'Slot dates come from the Series timezone and cadence.',
  });
  vi.mocked(longFormService.jobs).mockResolvedValue({ jobs: [{
    job_id: 'job-1', shared_job_id: 'shared-1', state: 'retrying', horizon: 'next_14', depth: 'briefs',
    timezone: 'Europe/London', created_count: 12, preserved_count: 7, blocked_count: 2, failed_count: 0,
    note: 'Some slots are held by the creator and were skipped.',
    items: [{ slot_key: '2026-10-06', planned_date: '2026-10-06', episode_number: 1, state: 'blocked',
      created_production_id: null, created_episode_id: null, error_message: 'This slot is held by the creator.' }],
  }] });
  vi.mocked(longFormService.createSeries).mockResolvedValue({ series_id: seriesId, title: 'Daily Personal Finance', revision: 1 });
  vi.mocked(longFormService.saveCollection).mockResolvedValue({ collection_id: 'c-1', title: 'Season 1', revision: 1 });
  vi.mocked(longFormService.previewGenerateAhead).mockResolvedValue({
    horizon: 'next_7', depth: 'ideas_only', depth_label: 'Ideas Only', timezone: 'Europe/London', today: '2026-10-05',
    cadence_metadata: { kind: 'daily' },
    slots: [{ slot_key: '2026-10-06', planned_date: '2026-10-06', episode_number: 8, state: 'open', existing_episode_id: null }],
    counts: { open: 7, preserved: 0, held: 0, total: 7 }, reuse: [], recent_titles: [], requires_confirmation: true,
    reuse_note: 'Series-level Assets are referenced through inheriting bindings.',
    depth_note: 'Generate Ahead records the requested depth and creates the Production shell.',
    do_not_overwrite: 'Existing Episodes at these slots are preserved and never overwritten.',
    recent_jobs: [], series_revision: 2, note: 'Preview only: nothing was created.',
  });
  vi.mocked(longFormService.generateAhead).mockResolvedValue({
    job_id: 'job-2', shared_job_id: 'shared-2', state: 'succeeded', horizon: 'next_7', depth: 'ideas_only',
    timezone: 'Europe/London', counts: { created: 7, preserved: 0, blocked: 0, failed: 0, planned: 7 },
    created_episodes: [{ episode_id: episodeId, episode_number: 8, production_id: episodeProduction,
      title: 'Money minute 8', planned_date: '2026-10-14', slot_key: '2026-10-14', topic_source: 'title_pattern' }],
    blocked_slots: [], preview: {}, note: 'Existing Episodes and approved work were preserved.',
  });
  vi.mocked(longFormService.retry).mockResolvedValue({ job_id: 'job-1', state: 'retrying', counts: { created: 1, preserved: 0, blocked: 1, failed: 0 } });
  vi.mocked(longFormService.seriesDirectorScope).mockResolvedValue({
    resolution: { horizon: 'next_7', avoid_recent_topics: true, ambiguous: false, note: 'Finite horizon.' },
    context: { series_id: seriesId, title: 'Daily Personal Finance', series_kind: 'recurring', timezone: 'Europe/London',
      cadence_metadata: { kind: 'daily' }, format_metadata_keys: ['title_pattern'],
      recent_titles: [{ episode_number: 3, title: 'Money minute 3', planned_date: '2026-10-08', line_state: 'idea' }],
      upcoming: [], avoid_list: ['Money minute 3'] },
    next_horizon_label: 'next_7',
    rule: 'Series context is bounded: titles, dates, states and the avoid list only. Nothing was created by resolving the command.',
  });
});

describe('Series Studio', () => {
  it('lists the project Series and opens the selected one', async () => {
    const { onSelectSeries } = mount(null);
    const button = await screen.findByRole('button', { name: /Daily Personal Finance/ });
    fireEvent.click(button);
    expect(onSelectSeries).toHaveBeenCalledWith(seriesId);
  });

  it('shows Episode state, blockers and criteria-based readiness without a percentage', async () => {
    mount();
    expect((await screen.findAllByRole('cell', { name: 'Idea' })).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Complete Production Plan').length).toBeGreaterThan(0);
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
    expect(screen.getByText(/The Story is not written yet\./)).toBeInTheDocument();
    expect(screen.getByText(/Write or generate the Story for this Episode\./)).toBeInTheDocument();
    expect(screen.getByText(/Readiness is criteria-based\./)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /3 · Money minute 3/ });
    expect(link).toHaveAttribute('href', `/studio/${episodeProduction}?tool=Movie Mode`);
  });

  it('shows reused Assets as canonical references, never copies', async () => {
    mount();
    expect(await screen.findByText('Host · character')).toBeInTheDocument();
    expect(screen.getAllByText(/referenced, never copied/).length).toBeGreaterThan(0);
  });

  it('creates a Series with a real timezone, cadence and format payload', async () => {
    const { onSelectSeries } = mount(null);
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Daily Personal Finance' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Europe/London' } });
    fireEvent.change(screen.getByLabelText('Cadence'), { target: { value: 'selected_weekdays' } });
    fireEvent.change(screen.getByLabelText(/Weekdays/), { target: { value: '5, 1, 3' } });
    fireEvent.change(screen.getByLabelText('Runtime target (seconds)'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Planned episodes'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Series/ }));
    await waitFor(() => expect(longFormService.createSeries).toHaveBeenCalledWith(workspaceId, projectId,
      { title: 'Daily Personal Finance', series_kind: 'recurring', timezone: 'Europe/London',
        cadence_metadata: { kind: 'selected_weekdays', weekdays: [5, 1, 3] },
        format: { production_type: 'recurring_content', execution_method: 'real', runtime_target_ms: 45000,
          title_pattern: '{series} {n}', planned_episodes: 10 } }));
    expect(onSelectSeries).toHaveBeenCalledWith(seriesId);
  });

  it('previews Generate Ahead, requires confirmation and never overwrites existing Episodes', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Depth'), { target: { value: 'ideas_only' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() => expect(longFormService.previewGenerateAhead).toHaveBeenCalledWith(workspaceId, seriesId, {
      horizon: 'next_7', depth: 'ideas_only', hold_slots: [], topics: [] }));
    expect(await screen.findByText(/PREVIEW · Next 7 days · Ideas Only/)).toBeInTheDocument();
    expect(screen.getByText(/Preview only: nothing was created\./)).toBeInTheDocument();
    expect(screen.getByText(/never overwritten/)).toBeInTheDocument();
    expect(longFormService.generateAhead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Confirm and create 7 Episode shell/ }));
    await waitFor(() => expect(longFormService.generateAhead).toHaveBeenCalledWith(workspaceId, seriesId, {
      horizon: 'next_7', depth: 'ideas_only', hold_slots: [], topics: [], expected_series_revision: 2 }));
    expect(await screen.findByText(/7 created · 0 preserved/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open Production/ })).toHaveAttribute('href',
      `/studio/${episodeProduction}?tool=Movie Mode`);
  });

  it('keeps a held slot blocked and retries only that job', async () => {
    mount();
    expect(await screen.findByText(/This slot is held by the creator\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry blocked slots/ }));
    await waitFor(() => expect(longFormService.retry).toHaveBeenCalledWith(workspaceId, 'job-1'));
  });

  it('resolves a Series Director command to a bounded horizon and creates nothing', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Direction'), {
      target: { value: "Plan next seven episodes but don't repeat this week's topics." } });
    fireEvent.click(screen.getByRole('button', { name: /Resolve Series scope/ }));
    expect(await screen.findByText(/Horizon Next 7 days\./)).toBeInTheDocument();
    expect(screen.getByText(/Avoid list: Money minute 3\./)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was created by resolving the command\./)).toBeInTheDocument();
    expect(longFormService.generateAhead).not.toHaveBeenCalled();
  });
});
