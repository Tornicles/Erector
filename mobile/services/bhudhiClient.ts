import type { BhudhiTrigger } from '../types/bhudhi';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data: T | null;
  errors: Array<{ code: string; message: string }> | null;
  metadata: Record<string, unknown>;
}

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string>),
    },
  });
  return res.json() as Promise<ApiEnvelope<T>>;
}

export function triggerBhudhi(payload: BhudhiTrigger, token: string) {
  return request('/api/v1/bhudhi/trigger', token, { method: 'POST', body: JSON.stringify(payload) });
}

export function interpretGoal(payload: { raw_goal: string; validation_id?: string }, token: string) {
  return request('/api/v1/bhudhi/interpret-goal', token, { method: 'POST', body: JSON.stringify(payload) });
}

export function structureAssumptions(payload: { validation_id: string; structured_goal: unknown; context: unknown }, token: string) {
  return request('/api/v1/bhudhi/structure-assumptions', token, { method: 'POST', body: JSON.stringify(payload) });
}

export function explainScore(payload: Record<string, unknown>, token: string) {
  return request('/api/v1/bhudhi/explain-score', token, { method: 'POST', body: JSON.stringify(payload) });
}

export function getBhudhiLogs(validationId: string, token: string) {
  return request(`/api/v1/bhudhi/logs/${encodeURIComponent(validationId)}`, token);
}

export function getBhudhiUsage(token: string) {
  return request('/api/v1/bhudhi/usage', token);
}

