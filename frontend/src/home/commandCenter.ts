import type { Production } from '../types/domain';
import type { Job } from '../services/prompt11';

export type HomeMode = 'new' | 'active' | 'urgent';

/**
 * Home mode is derived from real workspace state, never stored.
 * - NEW: no active productions to continue or triage.
 * - URGENT: something blocking/failed needs the creator now.
 * - ACTIVE: work exists and nothing is on fire.
 */
export function deriveHomeMode(input: {
  productions: Production[];
  failedJobs: number;
  reviewCount: number;
  needsAttention: number;
}): HomeMode {
  if (input.productions.length === 0) return 'new';
  if (input.failedJobs > 0 || input.reviewCount > 0 || input.needsAttention > 0) return 'urgent';
  return 'active';
}

export const FAILED_JOB_STATES = new Set(['failed', 'dead_letter', 'timed_out']);
export const LIVE_JOB_STATES = new Set(['queued', 'leased', 'running', 'waiting', 'retrying', 'cancel_requested']);

export function isFailedJob(job: Job): boolean {
  return FAILED_JOB_STATES.has(job.status);
}

export function isLiveJob(job: Job): boolean {
  return LIVE_JOB_STATES.has(job.status);
}

export function failedJobs(jobs: Job[]): Job[] {
  return jobs.filter(isFailedJob);
}

export function liveJobs(jobs: Job[]): Job[] {
  return jobs.filter(isLiveJob);
}
export function homeHeroCopy(mode: HomeMode, productionTitle: string | null, detail: string | null): { eyebrow: string; title: string; lead: string } {
  if (mode === 'new') return {
    eyebrow: 'TONDE · YOUR AI PRODUCTION DIRECTOR',
    title: 'Bring the idea. Leave with the production.',
    lead: 'Start with a thought, script, song, reference or footage. TONDE turns it into one connected Production from idea through execution and delivery.',
  };
  if (mode === 'urgent') return {
    eyebrow: 'TODAY · WORK NEEDS YOU',
    title: 'Keep the production moving.',
    lead: detail ?? 'TONDE has already ranked the decisions that can block your next shoot, review or delivery.',
  };
  return {
    eyebrow: 'CONTINUE NOW',
    title: 'Pick up exactly where you stopped.',
    lead: detail ?? (productionTitle ? `${productionTitle} is waiting in Studio.` : 'Your active Production is waiting in Studio.'),
  };
}

/** Continue target: exact saved Studio query when known, else the Production root. */
export function continueHref(workspaceId: string, productionId: string): string {
  try {
    const saved = localStorage.getItem(`tonde:studio-context:${workspaceId}:${productionId}`);
    if (saved) return `/studio/${productionId}?${saved}`;
  } catch {
    /* storage unavailable — fall through to the Production root */
  }
  return `/studio/${productionId}`;
}

/** Persist the exact Studio context so Home can resume it later. */
export function saveStudioContext(workspaceId: string, productionId: string, search: string): void {
  try {
    if (search) localStorage.setItem(`tonde:studio-context:${workspaceId}:${productionId}`, search);
    else localStorage.removeItem(`tonde:studio-context:${workspaceId}:${productionId}`);
  } catch {
    /* storage unavailable — resume falls back to the Production root */
  }
}
