import { fireEvent, render, screen } from '@testing-library/react';
import type { FormEvent } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  continueHref,
  deriveHomeMode,
  failedJobs,
  homeHeroCopy,
  liveJobs,
  saveStudioContext,
} from '../home/commandCenter';
import {
  LIVE_MAX,
  contextStripItem,
  isMeaningfulJob,
  rankLiveItems,
  type LiveItem,
  type LiveModel,
} from '../home/liveEngine';
import {
  HomeContextStrip,
  HomeStartBox,
  ProductionCarousel,
  TondeLive,
  type CarouselProduction,
} from '../home/TondeLive';
import type { Production } from '../types/domain';
import type { Job } from '../services/prompt11';
import type { StudioReadModel } from '../services/productions';

const base = (overrides: Partial<Production> = {}): Production => ({
  id: '00000000-0000-4000-8000-000000000001',
  workspace_id: '00000000-0000-4000-8000-000000000002',
  project_id: '00000000-0000-4000-8000-000000000001',
  title: 'North Bean',
  production_type: 'commercial',
  custom_type: null,
  execution_method: 'real',
  lifecycle: 'active',
  approval: 'draft',
  locked_at: null,
  planned_duration_ms: 30000,
  calculated_duration_ms: null,
  start_ms: 0,
  end_ms: null,
  created_by: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  created_at: '2026-10-05T00:00:00Z',
  updated_at: '2026-10-05T00:00:00Z',
  ...overrides,
});

const job = (overrides: Partial<Job> = {}): Job => ({
  job_id: 'job-1',
  job_type: 'reference_analysis',
  status: 'running',
  attempts: 1,
  max_attempts: 3,
  ...overrides,
});

const modelWith = (
  production: Production,
  scenes: StudioReadModel['scenes'],
  needsAttention = 0,
): LiveModel => ({
  production,
  detail: {
    scenes,
    production: { approval: production.approval },
    status_summary: { needs_attention: needsAttention },
  } as unknown as StudioReadModel,
});

const shotScene = (resultCount: number) => ([
  {
    id: 'scene-3',
    order: 3,
    shots: [{ id: 'shot-3b', title: 'Empty Street', result_count: resultCount }],
  },
] as unknown as StudioReadModel['scenes']);

const liveItem = (overrides: Partial<LiveItem> = {}): LiveItem => ({
  id: 'live-1',
  type: 'continue',
  eyebrow: 'CONTINUE',
  title: 'North Bean',
  summary: 'Pick up exactly where you stopped.',
  reason: 'Where you left off',
  href: '/studio/prod-1',
  productionId: 'prod-1',
  productionTitle: 'North Bean',
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe('deriveHomeMode', () => {
  it('selects NEW when the creator has no productions', () => {
    expect(deriveHomeMode({ productions: [], failedJobs: 0, reviewCount: 0, needsAttention: 0 }).valueOf()).toBe('new');
  });
  it('selects URGENT when a failed job exists', () => {
    expect(deriveHomeMode({ productions: [base()], failedJobs: 1, reviewCount: 0, needsAttention: 0 })).toBe('urgent');
  });
  it('selects URGENT when a decision is waiting', () => {
    expect(deriveHomeMode({ productions: [base()], failedJobs: 0, reviewCount: 1, needsAttention: 0 })).toBe('urgent');
  });
  it('selects ACTIVE for returning work with nothing on fire', () => {
    expect(deriveHomeMode({ productions: [base()], failedJobs: 0, reviewCount: 0, needsAttention: 0 })).toBe('active');
  });
});

describe('job partitions', () => {
  it('keeps successful/cancelled terminal jobs out of both failure and live work', () => {
    const jobs = [
      job({ job_id: 'failed', status: 'failed' }),
      job({ job_id: 'dead', status: 'dead_letter' }),
      job({ job_id: 'timeout', status: 'timed_out' }),
      job({ job_id: 'running', status: 'running' }),
      job({ job_id: 'queued', status: 'queued' }),
      job({ job_id: 'waiting', status: 'waiting' }),
      job({ job_id: 'retrying', status: 'retrying' }),
      job({ job_id: 'succeeded', status: 'succeeded' }),
      job({ job_id: 'cancelled', status: 'cancelled' }),
    ];
    expect(failedJobs(jobs).map(item => item.job_id)).toEqual(['failed', 'dead', 'timeout']);
    expect(liveJobs(jobs).map(item => item.job_id)).toEqual(['running', 'queued', 'waiting', 'retrying']);
  });

  it('does not surface a succeeded meaningful job in TONDE Live', () => {
    const items = rankLiveItems({
      workspaceId: 'ws-1',
      models: [modelWith(base(), [])],
      jobs: [job({ job_id: 'done', job_type: 'reference_analysis', status: 'succeeded' })],
    });
    expect(items.map(item => item.type)).toEqual(['continue']);
  });
});

describe('continue routing', () => {
  it('resumes the exact saved Studio query and falls back to the production root', () => {
    expect(continueHref('ws-1', 'prod-1')).toBe('/studio/prod-1');
    saveStudioContext('ws-1', 'prod-1', 'view=shots&scene=scene-3');
    expect(continueHref('ws-1', 'prod-1')).toBe('/studio/prod-1?view=shots&scene=scene-3');
  });
});

describe('homeHeroCopy', () => {
  it('prioritizes START for new creators, CONTINUE for active, ACT for urgent', () => {
    expect(homeHeroCopy('new', null, null).title).toMatch(/Bring the idea/);
    expect(homeHeroCopy('active', 'North Bean', null).eyebrow).toBe('CONTINUE NOW');
    expect(homeHeroCopy('urgent', null, null).title).toMatch(/Keep the production moving/);
  });
});

describe('isMeaningfulJob', () => {
  it('surfaces creator-meaningful work and filters engineering noise', () => {
    expect(isMeaningfulJob(job({ job_type: 'reference_analysis' }))).toBe(true);
    expect(isMeaningfulJob(job({ job_type: 'director_plan' }))).toBe(true);
    expect(isMeaningfulJob(job({ job_type: 'export_package' }))).toBe(true);
    expect(isMeaningfulJob(job({ job_type: 'thumbnail_generated' }))).toBe(false);
    expect(isMeaningfulJob(job({ job_type: 'database_sync' }))).toBe(false);
  });
});

describe('rankLiveItems', () => {
  it('invents nothing for a brand-new creator', () => {
    expect(rankLiveItems({ workspaceId: 'ws-1', models: [], jobs: [] })).toEqual([]);
  });
  it('ranks failed work above blockers above results above live jobs above continue', () => {
    const blocked = base({ id: 'prod-blocked', title: 'Blocked One', approval: 'needs_review' });
    const evidenced = base({ id: 'prod-evidence', title: 'Evidence One', approval: 'draft' });
    const models = [
      modelWith(blocked, [], 2),
      modelWith(evidenced, shotScene(1)),
    ];
    const jobs = [
      job({ job_id: 'failed-1', job_type: 'export_package', status: 'failed', error_message: 'Export ended.' }),
      job({ job_id: 'live-1', job_type: 'reference_analysis', status: 'running', state_line: 'Mapping pacing.' }),
    ];
    const items = rankLiveItems({ workspaceId: 'ws-1', models, jobs });
    expect(items.map(item => item.type)).toEqual(['failed_job', 'blocker', 'result_ready', 'job_active', 'continue']);
    expect(items[0].href).toBe('/jobs');
    expect(items[4].type).toBe('continue');
  });
  it('caps the live field at five and keeps the highest priority', () => {
    expect(LIVE_MAX).toBe(5);
    const models = Array.from({ length: 4 }, (_, index) =>
      modelWith(base({ id: `prod-${index}`, title: `Waiting ${index}`, approval: 'needs_review' }), [], 1),
    );
    const jobs = [
      job({ job_id: 'failed-1', job_type: 'export_package', status: 'failed' }),
      job({ job_id: 'failed-2', job_type: 'result_analysis', status: 'timed_out' }),
      job({ job_id: 'live-1', job_type: 'reference_analysis', status: 'running' }),
    ];
    const items = rankLiveItems({ workspaceId: 'ws-1', models, jobs });
    expect(items).toHaveLength(5);
    expect(items.map(item => item.type)).toEqual(['failed_job', 'failed_job', 'blocker', 'blocker', 'blocker']);
  });
  it('links a ready Result to the exact Studio Result context', () => {
    const items = rankLiveItems({
      workspaceId: 'ws-1',
      models: [modelWith(base({ id: 'prod-evidence' }), shotScene(2))],
      jobs: [],
    });
    expect(items[0].type).toBe('result_ready');
    expect(items[0].href).toBe('/studio/prod-evidence?tool=Results&scene=scene-3&shot=shot-3b');
  });
  it('links a blocker and the continue seat to the exact saved Studio context', () => {
    saveStudioContext('ws-1', 'prod-blocked', 'view=shots&scene=scene-3');
    const items = rankLiveItems({
      workspaceId: 'ws-1',
      models: [modelWith(base({ id: 'prod-blocked', approval: 'needs_review' }), [], 1)],
      jobs: [],
    });
    expect(items[0].type).toBe('blocker');
    expect(items[0].href).toBe('/studio/prod-blocked?view=shots&scene=scene-3');
    expect(items[1].type).toBe('continue');
    expect(items[1].href).toBe('/studio/prod-blocked?view=shots&scene=scene-3');
  });
  it('never surfaces routine background jobs as live objects', () => {
    const items = rankLiveItems({
      workspaceId: 'ws-1',
      models: [modelWith(base(), [])],
      jobs: [job({ job_id: 'noise', job_type: 'thumbnail_generated', status: 'running' })],
    });
    expect(items.map(item => item.type)).toEqual(['continue']);
  });
});

describe('contextStripItem', () => {
  it('hides completely when there is nothing secondary to say', () => {
    expect(contextStripItem([])).toBeNull();
    expect(contextStripItem([liveItem({ type: 'continue' })])).toBeNull();
  });
  it('stays quiet when the foreground is already the live job', () => {
    expect(contextStripItem([liveItem({ type: 'job_active' }), liveItem({ type: 'continue' })])).toBeNull();
  });
  it('surfaces the highest-ranked live job below a foreground priority', () => {
    const active = liveItem({ id: 'job-1', type: 'job_active', title: 'Reference analysis' });
    const item = contextStripItem([liveItem({ type: 'blocker' }), active, liveItem({ type: 'continue' })]);
    expect(item?.id).toBe('job-1');
  });
});

describe('TondeLive', () => {
  it('is honest when nothing needs the creator', () => {
    const { container } = render(<MemoryRouter><TondeLive items={[]} active={false} /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing needs your attention right now.');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
  it('renders every object as an exact link in rank order with one foreground', () => {
    const items = [
      liveItem({ id: 'b', type: 'blocker', eyebrow: 'NEEDS YOU', href: '/studio/p1?view=shots' }),
      liveItem({ id: 'r', type: 'result_ready', eyebrow: 'RESULT READY', href: '/studio/p2?tool=Results&scene=s&shot=h' }),
      liveItem({ id: 'c', type: 'continue', eyebrow: 'CONTINUE', href: '/studio/p1' }),
    ];
    render(<MemoryRouter><TondeLive items={items} active={false} /></MemoryRouter>);
    const links = screen.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/studio/p1?view=shots',
      '/studio/p2?tool=Results&scene=s&shot=h',
      '/studio/p1',
    ]);
    expect(links[0].className).toMatch(/hl-focus/);
    expect(links[1].className).toMatch(/hl-left/);
    expect(links[2].className).toMatch(/hl-right/);
  });
  it('pauses ambient motion on hover and focus, then resumes', () => {
    render(<MemoryRouter><TondeLive items={[liveItem()]} active /></MemoryRouter>);
    const region = screen.getByRole('complementary', { name: 'TONDE Live' });
    fireEvent.mouseEnter(region);
    expect(region.className).toMatch(/is-paused/);
    fireEvent.mouseLeave(region);
    expect(region.className).not.toMatch(/is-paused/);
    fireEvent.focus(region);
    expect(region.className).toMatch(/is-paused/);
    fireEvent.blur(region);
    expect(region.className).not.toMatch(/is-paused/);
  });
});

describe('ProductionCarousel', () => {
  const entry = (overrides: Partial<CarouselProduction> = {}): CarouselProduction => ({
    production: base(),
    sceneCount: 12,
    shotCount: 31,
    resultsReady: 1,
    blockers: 2,
    href: '/studio/prod-1?view=shots',
    secondary: { label: 'Review Result', href: '/studio/prod-1?tool=Results' },
    headline: 'Card 03 · The Empty Street',
    standfirst: 'Shot 03B has a Result ready for review.',
    ...overrides,
  });

  beforeEach(() => {
    if (!window.HTMLElement.prototype.scrollIntoView) {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), writable: true });
    }
  });

  it('centers one production with an exact continue destination', () => {
    render(<MemoryRouter><ProductionCarousel entries={[entry()]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Continue →' })).toHaveAttribute('href', '/studio/prod-1?view=shots');
    expect(screen.getByRole('link', { name: 'Review Result' })).toHaveAttribute('href', '/studio/prod-1?tool=Results');
  });
  it('moves focus between productions with arrows and keyboard without navigating', () => {
    const second = entry({
      production: base({ id: 'prod-2', title: 'Amara + David' }),
      href: '/studio/prod-2',
      secondary: null,
      headline: 'Shoot tomorrow',
    });
    render(<MemoryRouter><ProductionCarousel entries={[entry(), second]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Continue →' })).toHaveAttribute('href', '/studio/prod-1?view=shots');
    fireEvent.click(screen.getByRole('button', { name: 'Next production' }));
    expect(screen.getByRole('link', { name: 'Continue →' })).toHaveAttribute('href', '/studio/prod-2');
    fireEvent.keyDown(screen.getByRole('region', { name: 'Continue productions' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('link', { name: 'Continue →' })).toHaveAttribute('href', '/studio/prod-1?view=shots');
  });
  it('focuses a side production on click instead of navigating away', () => {
    const second = entry({
      production: base({ id: 'prod-2', title: 'Amara + David' }),
      href: '/studio/prod-2',
      secondary: null,
      headline: 'Shoot tomorrow',
    });
    render(<MemoryRouter><ProductionCarousel entries={[entry(), second]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Focus Amara + David' }));
    expect(screen.getByRole('link', { name: 'Continue →' })).toHaveAttribute('href', '/studio/prod-2');
  });
});

describe('HomeContextStrip', () => {
  it('renders nothing when there is nothing secondary to say', () => {
    const { container } = render(<MemoryRouter><HomeContextStrip item={null} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
  it('links the single secondary item to its exact destination', () => {
    render(<MemoryRouter><HomeContextStrip item={liveItem({ type: 'job_active', title: 'Reference analysis', href: '/studio/p1' })} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Open →' })).toHaveAttribute('href', '/studio/p1');
  });
});

describe('HomeStartBox', () => {
  it('only offers truthful intake sources and keeps DIRECT THIS honest', () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <HomeStartBox intent="" onChange={() => {}} onSubmit={onSubmit} disabled={false} busy={false} source="describe" onSource={() => {}} />
      </MemoryRouter>,
    );
    for (const label of ['＋ Upload', '↗ Reference', '◉ Describe', '▤ Script', '◉ Record']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /song/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DIRECT THIS →' })).toBeDisabled();
  });
  it('submits the real intent instead of a toast', () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <MemoryRouter>
        <HomeStartBox intent="A six-part zombie series" onChange={() => {}} onSubmit={onSubmit} disabled={false} busy={false} source="describe" onSource={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'DIRECT THIS →' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  it('explains a locked restored intake and lets the creator start a fresh editable request', () => {
    const onStartNew = vi.fn();
    render(
      <MemoryRouter>
        <HomeStartBox intent="Saved production goal" onChange={() => {}} onSubmit={vi.fn()} disabled busy={false} source="describe" onSource={() => {}} onStartNew={onStartNew} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('textbox', { name: 'Describe what you want to make' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('This request is attached to a saved Production.');
    fireEvent.click(screen.getByRole('button', { name: 'Start a new intake' }));
    expect(onStartNew).toHaveBeenCalledOnce();
  });
  it('offers a fresh intake from an editable saved plan with an accurate explanation', () => {
    render(
      <MemoryRouter>
        <HomeStartBox intent="Saved production goal" onChange={() => {}} onSubmit={vi.fn()} disabled={false} busy={false} source="describe" onSource={() => {}} onStartNew={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('re-plan the same saved Production');
    expect(screen.getByRole('button', { name: 'Start a new intake' })).toBeEnabled();
  });
});
