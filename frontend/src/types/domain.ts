import type { Database } from './database';
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
export function formatRuntime(ms: number | null): string {
  if (ms === null) return 'Runtime not set';
  durationMs(ms);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
