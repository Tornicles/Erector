import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  continueHref,
  deriveHomeMode,
  deriveLifecycle,
  failedJobs,
  homeHeroCopy,
  liveJobs,
  rankAttention,
  saveStudioContext,
} from '../home/commandCenter';
import { AttentionStrip, ContinueCard, LiveJobs } from '../home/HomeCommandCenter';
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

describe('rankAttention', () => {
  it('ranks decisions before failed jobs before drafts and caps at three', () => {
    const decision = base({ id: 'prod-decision', title: 'Needs review', approval: 'needs_review' });
    const draft = base({ id: 'prod-draft', title: 'Draft shaping', approval: 'draft' });
    const failed = job({ job_id: 'job-9', status: 'failed', error_message: 'Export ended.' });
    const items = rankAttention({ orderedWork: [decision, draft], jobs: [failed] });
    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe('decision');
    expect(items[1].kind).toBe('failed_job');
    expect(items[2].kind).toBe('draft');
    expect(items[0].href).toBe('/studio/prod-decision');
    expect(items[1].href).toBe('/jobs');
  });
  it('returns an empty queue when nothing needs the creator', () => {
    expect(rankAttention({ orderedWork: [base({ approval: 'approved' })], jobs: [job()] })).toHaveLength(0);
  });
});

describe('job partitions', () => {
  it('treats terminal states as failed and everything else as live', () => {
    const jobs = [job({ job_id: 'a', status: 'failed' }), job({ job_id: 'b', status: 'running' }), job({ job_id: 'c', status: 'queued' })];
    expect(failedJobs(jobs).map(item => item.job_id)).toEqual(['a']);
    expect(liveJobs(jobs).map(item => item.job_id)).toEqual(['b', 'c']);
  });
});

describe('deriveLifecycle', () => {
  it('starts a sceneless production in Development', () => {
    const model = { scenes: [], production: { approval: 'draft' }, status_summary: { needs_attention: 0 } } as unknown as StudioReadModel;
    const stages = deriveLifecycle(model);
    expect(stages[0].state).toBe('active');
    expect(stages[0].note).toBe('No Scenes yet');
  });
  it('moves a production waiting on review into Review', () => {
    const model = {
      scenes: [{ shots: [{ result_count: 0 }] }],
      production: { approval: 'needs_review' },
      status_summary: { needs_attention: 1 },
    } as unknown as StudioReadModel;
    const stages = deriveLifecycle(model);
    expect(stages[4].state).toBe('active');
    expect(stages[4].note).toBe('Waiting on you');
  });
});

describe('continue routing', () => {
  it('resumes the exact saved Studio query and falls back to the production root', () => {
    localStorage.clear();
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

describe('command center components', () => {
  it('collapses attention and jobs to nothing when the workspace is quiet', () => {
    const { container: attention } = render(<MemoryRouter><AttentionStrip items={[]} /></MemoryRouter>);
    expect(attention).toBeEmptyDOMElement();
    const { container: jobs } = render(<MemoryRouter><LiveJobs jobs={[]} loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    expect(jobs).toBeEmptyDOMElement();
  });
  it('routes Continue to the exact saved Studio context', () => {
    localStorage.clear();
    saveStudioContext('ws-1', base().id, 'view=shots&scene=scene-3');
    render(<MemoryRouter><ContinueCard production={base()} sceneCount={1} shotCount={2} resultsReady={1} blockers={0} href={continueHref('ws-1', base().id)} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Continue in Studio →' })).toHaveAttribute('href', `/studio/${base().id}?view=shots&scene=scene-3`);
    expect(screen.getByRole('link', { name: 'Review Results' })).toHaveAttribute('href', `/studio/${base().id}?tool=Results`);
  });
  it('surfaces failed jobs with an honest retry action and no fake progress', () => {
    render(<MemoryRouter><LiveJobs jobs={[job({ status: 'failed', error_message: 'Export ended.' })]} loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Export ended.');
    expect(screen.getByRole('link', { name: 'Retry job' })).toHaveAttribute('href', '/jobs');
  });
});
