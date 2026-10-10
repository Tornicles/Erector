import type { Production } from '../types/domain';
import type { Job } from '../services/prompt11';
import type { StudioReadModel } from '../services/productions';

export type HomeMode = 'new' | 'active' | 'urgent';

export type AttentionKind = 'decision' | 'failed_job' | 'draft';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
}

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

const TERMINAL_JOB = new Set(['failed', 'dead_letter', 'timed_out']);

export function failedJobs(jobs: Job[]): Job[] {
  return jobs.filter(job => TERMINAL_JOB.has(job.status));
}

export function liveJobs(jobs: Job[]): Job[] {
  return jobs.filter(job => !TERMINAL_JOB.has(job.status));
}

/**
 * Priority ranking (documented product rule, highest first):
 * 1. BLOCKING — productions waiting on a creator decision (review / changed after approval).
 * 2. FAILED — background jobs that ended terminally and need retry/requeue.
 * 3. DRAFTS — undecided productions still being shaped.
 * Capped at 3 so Home stays a command center, not an inbox.
 */
export function rankAttention(input: {
  orderedWork: Production[];
  jobs: Job[];
  limit?: number;
}): AttentionItem[] {
  const limit = input.limit ?? 3;
  const items: AttentionItem[] = [];
  for (const production of input.orderedWork) {
    if (items.length >= limit) break;
    if (production.approval === 'needs_review' || production.approval === 'changed_after_approval') {
      items.push({
        id: `decision-${production.id}`,
        kind: 'decision',
        eyebrow: production.approval === 'changed_after_approval' ? 'CHANGED AFTER APPROVAL' : 'DECISION WAITING',
        title: production.title,
        detail: 'TONDE will not guess on this. Review the current state and approve or revise it.',
        actionLabel: 'Review decision',
        href: `/studio/${production.id}`,
      });
    }
  }
  for (const job of failedJobs(input.jobs)) {
    if (items.length >= limit) break;
    items.push({
      id: `job-${job.job_id}`,
      kind: 'failed_job',
      eyebrow: 'JOB FAILED',
      title: job.job_type_display_name ?? job.job_type.replaceAll('_', ' '),
      detail: job.error_message ?? 'This background work ended and needs attention before anything downstream can use it.',
      actionLabel: 'Retry job',
      href: '/jobs',
    });
  }
  for (const production of input.orderedWork) {
    if (items.length >= limit) break;
    if (production.approval === 'draft' && !items.some(item => item.id === `decision-${production.id}`)) {
      items.push({
        id: `draft-${production.id}`,
        kind: 'draft',
        eyebrow: 'DRAFT SHAPING',
        title: production.title,
        detail: 'Still being understood and planned. Continue directing it in Studio.',
        actionLabel: 'Continue shaping',
        href: `/studio/${production.id}`,
      });
    }
  }
  return items;
}

export interface LifecycleStage {
  key: string;
  label: string;
  state: 'done' | 'active' | 'waiting';
  note: string;
}

const STAGE_LABELS = ['Development', 'Pre-production', 'Production', 'Post', 'Review', 'Delivery'];

/**
 * Current-production lifecycle derived from the live Studio read model —
 * never decorative. Rules:
 * - approved → Delivery (accepted at its version).
 * - needs_review / changed_after_approval → Review.
 * - every Shot has a Result → Post.
 * - any Result → Production.
 * - Shots but no Results → Pre-production (draft) or Production (otherwise).
 * - Scenes but no Shots → Pre-production.
 * - No Scenes → Development.
 */
export function deriveLifecycle(model: StudioReadModel | null): LifecycleStage[] {
  if (!model) return STAGE_LABELS.map(label => ({ key: label, label, state: 'waiting' as const, note: 'Loading production state…' }));
  const scenes = model.scenes.length;
  const shots = model.scenes.flatMap(scene => scene.shots);
  const results = shots.reduce((total, shot) => total + shot.result_count, 0);
  const approval = model.production.approval;
  const blockers = model.status_summary.needs_attention;
  let current = 0;
  if (approval === 'approved') current = 5;
  else if (approval === 'needs_review' || approval === 'changed_after_approval') current = 4;
  else if (shots.length > 0 && results > 0 && shots.every(shot => shot.result_count > 0)) current = 3;
  else if (results > 0) current = 2;
  else if (shots.length > 0) current = approval === 'draft' ? 1 : 2;
  else if (scenes > 0) current = 1;
  else current = 0;
  const notes = [
    scenes === 0 ? 'No Scenes yet' : `${scenes} Scene${scenes === 1 ? '' : 's'}`,
    shots.length === 0 ? 'No Shots yet' : `${shots.length} Shot${shots.length === 1 ? '' : 's'}`,
    results === 0 ? 'No Results yet' : `${results} Result${results === 1 ? '' : 's'}`,
    results === 0 ? 'Waiting' : shots.every(shot => shot.result_count > 0) ? 'Full coverage' : 'Partial coverage',
    approval === 'needs_review' || approval === 'changed_after_approval' ? 'Waiting on you' : 'No open review',
    approval === 'approved' ? 'Accepted at its version' : 'Not accepted yet',
  ];
  if (current === 1 && blockers > 0) notes[1] = `${blockers} blocker${blockers === 1 ? '' : 's'}`;
  return STAGE_LABELS.map((label, index) => ({
    key: label,
    label,
    state: index < current ? 'done' : index === current ? 'active' : 'waiting',
    note: notes[index],
  }));
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
