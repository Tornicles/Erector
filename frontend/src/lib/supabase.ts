import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export function validatePublicConfiguration(url?: string, key?: string): string | null {
  if (!url || !key) return 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to connect TONDE to your Supabase project.';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      return 'Supabase requires HTTPS outside local development.';
    }
  } catch { return 'The Supabase URL is invalid.'; }
  if (key.startsWith('sb_secret_')) return 'A server secret cannot be used as a browser key.';
  if (key.split('.').length === 3) {
    try {
      const part = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload: { role?: string } = JSON.parse(atob(part));
      if (payload.role !== 'anon') return 'Only a publishable or anon key is allowed in the browser.';
    } catch { return 'The Supabase public key is invalid.'; }
  } else if (!key.startsWith('sb_publishable_')) return 'Use a Supabase publishable or anon key.';
  return null;
}
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configurationError = validatePublicConfiguration(url, key);
const localPreview = import.meta.env.VITE_TONDE_LOCAL_PREVIEW === '1' && configurationError !== null;
export const supabase = configurationError ? null : createClient<Database, 'tonde'>(url!, key!, {
  db: { schema: 'tonde' },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});
export function requireSupabase() {
  if (!supabase) throw new Error(configurationError ?? 'Supabase is not configured.');
  return supabase;
}
// Local iteration only: the app can render its seven-area shell without a live Supabase project.
// This does not mean the project is configured; real auth/OAuth/email/Storage still need the project.
export { localPreview };
