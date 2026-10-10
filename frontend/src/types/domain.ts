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

export function formatRuntime(ms: number | null): string {
  if (ms === null) return 'Runtime not set';
  durationMs(ms);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
