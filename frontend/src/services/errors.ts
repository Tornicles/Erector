export type ErrorKind = 'authentication' | 'authorization' | 'validation' | 'not_found' | 'conflict' | 'database' | 'provider' | 'unavailable';
export class AppError extends Error {
  constructor(public kind: ErrorKind, message: string) { super(message); this.name = 'AppError'; }
}
export function safeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const value = error as { code?: string; status?: number } | null;
  if (value?.code === '42501' || value?.status === 403) return new AppError('authorization', 'You do not have permission to make this change.');
  if (value?.status === 401) return new AppError('authentication', 'Your session has expired. Please sign in again.');
  // A stale revision is a conflict, not a generic failure: the database refused the write and the
  // creator reloads. PT409 is the PostgREST-mapped conflict code; 40001 is its retired predecessor.
  if (value?.code === 'PT409' || value?.code === '40001' || value?.status === 409) return new AppError('conflict', 'This production changed elsewhere. Reload the latest version before saving.');
  if (value?.code?.startsWith('23')) return new AppError('validation', 'This change conflicts with the production structure or a protected object.');
  if (value?.code === 'PGRST116') return new AppError('not_found', 'This item is unavailable or you do not have access.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) return new AppError('unavailable', 'You are offline. Reconnect and retry; your changes are not saved yet.');
  return new AppError('database', 'TONDE could not complete the request. Check the connection and retry.');
}
