/**
 * Minimal API client for the Erector backend.
 * Uses REACT_APP_BACKEND_URL from the environment.
 */

const BASE_URL = process.env.REACT_APP_BACKEND_URL || '';

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data: T | null;
  errors: Array<{ code: string; message: string; type: string; field?: string }> | null;
  metadata: {
    request_id: string;
    version: string;
    timestamp: string;
    processing_time_ms: number;
    pagination: null | object;
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body: ApiEnvelope<T> = await res.json();
  return body;
}

// ── Health ────────────────────────────────────────────────────────────────────

export interface HealthData {
  status: 'healthy' | 'degraded';
  version: string;
  environment: string;
  timestamp: string;
  database: { connected: boolean; name: string | null; error: string | null };
  mock_auth_enabled: boolean;
}

export function fetchHealth(): Promise<ApiEnvelope<HealthData>> {
  return request<HealthData>('/api/health');
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface MagicLinkData {
  message: string;
  email: string;
  expires_in_minutes: number;
  mock_token: string | null;
}

export function requestMagicLink(email: string): Promise<ApiEnvelope<MagicLinkData>> {
  return request<MagicLinkData>('/api/v1/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in: number;
}

export function verifyMagicLink(token: string): Promise<ApiEnvelope<TokenPair>> {
  return request<TokenPair>(`/api/v1/auth/verify?token=${encodeURIComponent(token)}`);
}
