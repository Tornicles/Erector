import { requireSupabase } from '../lib/supabase';
import { AppError } from './errors';
export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  errors: { code: string; message: string; type: string }[] | null;
  metadata: { request_id: string; timestamp: string; version: string };
}
export async function authenticatedRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new AppError('validation', 'Invalid application API path.');
  const { data: { session }, error } = await requireSupabase().auth.getSession();
  if (error || !session) throw new AppError('authentication', 'Sign in to continue.');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  headers.set('Content-Type', 'application/json');
  const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  let body: ApiEnvelope<T>;
  try { body = await response.json(); } catch { throw new AppError('unavailable', 'The TONDE service is unavailable.'); }
  if (!response.ok || !body.success || body.data === null) {
    throw new AppError(response.status === 401 ? 'authentication' : response.status === 403 ? 'authorization' : 'unavailable', body.errors?.[0]?.message ?? 'The request could not be completed.');
  }
  return body.data;
}
