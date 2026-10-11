import type { Production } from '../types/domain';
import type { Job } from '../services/prompt11';
import type { StudioReadModel } from '../services/productions';
import { continueHref } from './commandCenter';

/**
 * TONDE Live priority engine (single home for Home ranking — §62).
 *
 * A LiveItem is derived from source-of-truth domain state, never invented:
 * productions, their Studio read models, and jobs. There is deliberately no
 * persistence: items are re-derived on every load so a resolved blocker or a
 * completed job exits TONDE Live by itself.
 *
 * Ranking (highest first):
 * 1. FAILED — terminal background work that needs retry/requeue.
 * 2. BLOCKER — a production waiting on a creator decision, or a read model
 *    reporting needs_attention.
 * 3. RESULT_READY — recorded execution evidence waiting for creator review.
 * 4. JOB_ACTIVE — a meaningful live job worth surfacing (see below).
 * 5. CONTINUE — the exact saved Studio context for the spotlight production.
 *
 * Capped at 5 so Home stays a command center, not an inbox.
 *
 * Deliberately NOT produced (no source data, and faking them is forbidden):
 * imminent shoot/deadline items (no schedule source on Home), output-ready
 * exports (would need per-production export queries — N+1), continuity or
 * rights items (scoped Studio canvases, reachable through the blocker link).
 */

export type LiveItemType = 'failed_job' | 'blocker' | 'result_ready' | 'job_active' | 'continue';

export interface LiveItem {
  id: string;
  type: LiveItemType;
  /** Short eyebrow, e.g. RESULT READY / BLOCKED / TONDE WORKING. */
  eyebrow: string;
  title: string;
  summary: string;
  /** One-line human reason, e.g. "Needs you now". Never a score. */
  reason: string;
  /** Exact teleport destination — never a generic landing page. */
  href: string;
  productionId: string | null;
  productionTitle: string | null;
}

export const LIVE_MAX = 5;

/** Job types a creator can act on. Engineering noise never reaches Home. */
const MEANINGFUL_JOB = ['reference', 'director', 'plan', 'result', 'export', 'book', 'match', 'intake'];

export function isMeaningfulJob(job: Job): boolean {
  const kind = `${job.job_type} ${job.job_type_display_name ?? ''}`.toLowerCase();
  return MEANINGFUL_JOB.some(token => kind.includes(token));
}

const TERMINAL_JOB = new Set(['failed', 'dead_letter', 'timed_out']);

function jobHref(workspaceId: string, job: Job): string {
  if (job.production_id) return continueHref(workspaceId, job.production_id);
  return '/jobs';
}

export interface LiveModel {
  production: Production;
  /** Studio read model when loaded (spotlight + top productions, bounded). */
  detail: StudioReadModel | null;
}

export function rankLiveItems(input: {
  workspaceId: string;
  /** Productions in display order (current / needs-attention first). */
  models: LiveModel[];
  jobs: Job[];
  limit?: number;
}): LiveItem[] {
  const limit = input.limit ?? LIVE_MAX;
  const items: LiveItem[] = [];
  const push = (item: LiveItem) => { if (items.length < limit) items.push(item); };

  // 1. Failed work first: nothing downstream can use it until retried.
  for (const job of input.jobs) {
    if (!TERMINAL_JOB.has(job.status)) continue;
    push({
      id: `live-failed-${job.job_id}`,
      type: 'failed_job',
      eyebrow: 'JOB FAILED',
      title: job.job_type_display_name ?? job.job_type.replaceAll('_', ' '),
      summary: job.error_message ?? 'This background work ended and needs attention before anything downstream can use it.',
      reason: 'Needs you now',
      href: '/jobs',
      productionId: job.production_id ?? null,
      productionTitle: input.models.find(model => model.production.id === job.production_id)?.production.title ?? null,
    });
    if (items.length >= limit) return items;
  }

  // 2. Blockers: productions waiting on a decision, or read models flagging attention.
  for (const model of input.models) {
    const { production, detail } = model;
    const waiting = production.approval === 'needs_review' || production.approval === 'changed_after_approval';
    const flagged = (detail?.status_summary.needs_attention ?? 0) > 0;
    if (!waiting && !flagged) continue;
    const count = detail?.status_summary.needs_attention ?? 0;
    push({
      id: `live-blocker-${production.id}`,
      type: 'blocker',
      eyebrow: production.approval === 'changed_after_approval' ? 'CHANGED AFTER APPROVAL' : 'NEEDS YOU',
      title: production.title,
      summary: count > 0
        ? `${count} item${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} a creator decision before this production can move forward.`
        : 'TONDE will not guess on this. Review the current state and approve or revise it.',
      reason: waiting ? 'Blocks progress' : 'Needs you now',
      href: continueHref(input.workspaceId, production.id),
      productionId: production.id,
      productionTitle: production.title,
    });
    if (items.length >= limit) return items;
  }

  // 3. Results ready: recorded evidence waiting for review, first shot wins the link.
  for (const model of input.models) {
    const { production, detail } = model;
    if (!detail) continue;
    const ready = detail.scenes.flatMap(scene => scene.shots.map(shot => ({ scene, shot })))
      .find(entry => entry.shot.result_count > 0);
    if (!ready) continue;
    const total = detail.scenes.reduce((sum, scene) => sum + scene.shots.reduce((n, shot) => n + shot.result_count, 0), 0);
    push({
      id: `live-result-${production.id}`,
      type: 'result_ready',
      eyebrow: 'RESULT READY',
      title: `${ready.shot.title} · Shot ${String(ready.scene.order).padStart(2, '0')}${String.fromCharCode(65 + Math.max(ready.scene.shots.findIndex(item => item.id === ready.shot.id), 0))}`,
      summary: total > 1
        ? `${total} recorded results are waiting. Review the first against the plan before approving.`
        : 'Execution evidence is attached. Review it against the plan before approving.',
      reason: 'Ready for review',
      href: `/studio/${production.id}?tool=Results&scene=${ready.scene.id}&shot=${ready.shot.id}`,
      productionId: production.id,
      productionTitle: production.title,
    });
    if (items.length >= limit) return items;
  }

  // 4. Meaningful live jobs: only work that changes what the creator does next.
  for (const job of input.jobs) {
    if (TERMINAL_JOB.has(job.status) || !isMeaningfulJob(job)) continue;
    const title = input.models.find(model => model.production.id === job.production_id)?.production.title ?? null;
    push({
      id: `live-job-${job.job_id}`,
      type: 'job_active',
      eyebrow: 'TONDE WORKING',
      title: job.job_type_display_name ?? job.job_type.replaceAll('_', ' '),
      summary: job.state_line ?? job.status_label ?? 'TONDE is doing meaningful work in the background.',
      reason: 'In progress',
      href: jobHref(input.workspaceId, job),
      productionId: job.production_id ?? null,
      productionTitle: title,
    });
    if (items.length >= limit) return items;
  }

  // 5. Continue: the exact saved context always has a seat when room remains.
  const spotlight = input.models[0];
  if (spotlight) {
    push({
      id: `live-continue-${spotlight.production.id}`,
      type: 'continue',
      eyebrow: 'CONTINUE',
      title: spotlight.production.title,
      summary: 'Pick up exactly where you stopped — card, shot and context included.',
      reason: 'Where you left off',
      href: continueHref(input.workspaceId, spotlight.production.id),
      productionId: spotlight.production.id,
      productionTitle: spotlight.production.title,
    });
  }
  return items;
}

/**
 * The single secondary strip below Continue: the highest-ranked live job that
 * is NOT already the foreground item. Anything else would duplicate TONDE
 * Live, so the strip hides completely when there is nothing secondary to say.
 */
export function contextStripItem(items: LiveItem[]): LiveItem | null {
  if (items.length === 0) return null;
  if (items[0].type === 'job_active') return null;
  return items.find(item => item.type === 'job_active') ?? null;
}

/** Continue target resolution (documented rule, highest first): saved exact
 *  Studio context → production root. Shot-level precision (pending review,
 *  decision, active card) lives in the saved context Studio persists. */
export function spotlightHref(workspaceId: string, productionId: string): string {
  return continueHref(workspaceId, productionId);
}
