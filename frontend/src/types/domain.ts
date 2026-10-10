import type { Database } from './database';
import type { ExecutionMethod } from './product';
export type Row<T extends keyof Database['tonde']['Tables']> = Database['tonde']['Tables'][T]['Row'];
export type Production = Row<'productions'>;
export type Project = Row<'projects'>;
export type Scene = Row<'scenes'>;
export type Shot = Row<'shots'>;
export type { ExecutionFace, ExecutionMethod, ProductionType, ApprovalStatus, ResultStatus, ReferenceRights } from './product';
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'offline' | 'conflict';
export function durationMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Duration must be non-negative integer milliseconds.');
  return value;
}
/**
 * The creator-facing name of a Shot's execution method.
 *
 * The stored enum stays `real | ai | hybrid` (Prompt 2 vocabulary); SHOOT / AI PLAYBOOK /
 * SHOOT + AI are how the same three methods are named to the creator. One Shot, one method.
 *
 * `ai` is named AI PLAYBOOK rather than GENERATE because TONDE directs the creator's execution in
 * their own external tool; it does not generate the final media itself (constitution Amendment E).
 */
export const EXECUTION_METHOD_LABEL: Record<ExecutionMethod, string> = {
  real: 'SHOOT',
  ai: 'AI PLAYBOOK',
  hybrid: 'SHOOT + AI',
};

export function executionMethodLabel(method: string | null | undefined): string {
  if (!method) return 'UNASSIGNED';
  return EXECUTION_METHOD_LABEL[method as ExecutionMethod] ?? method.replaceAll('_', ' ').toUpperCase();
}

export function formatRuntime(ms: number | null | undefined): string {
  // Display-only and total: backend/AI plans may omit a duration or send a float,
  // and that must render as unset rather than crash the page. Strict validation
  // for writes still lives in durationMs.
  if (ms === null || ms === undefined) return 'Runtime not set';
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'Runtime not set';
  const safe = Math.max(0, Math.floor(ms));
  return `${Math.floor(safe / 60000)}:${String(Math.floor(safe / 1000) % 60).padStart(2, '0')}.${String(safe % 1000).padStart(3, '0')}`;
}
