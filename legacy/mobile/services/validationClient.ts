/**
 * Validation API Client — Prompt A3 (mobile)
 */

import type {
  CreateValidationRequest,
  CreateValidationResponse,
  FailValidationRequest,
  TransitionValidationRequest,
  TransitionValidationResponse,
  ValidationDetailResponse,
  ValidationHealthStatus,
  ValidationSession,
  SystemEvent,
} from '../types/validation';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data: T | null;
  errors: Array<{ code: string; message: string; type: string }> | null;
  metadata: Record<string, unknown>;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  return res.json() as Promise<ApiEnvelope<T>>;
}

export function createValidation(
  payload: CreateValidationRequest,
  token: string,
  idempotencyKey?: string,
): Promise<ApiEnvelope<CreateValidationResponse>> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return request('/api/v1/validations', { method: 'POST', body: JSON.stringify(payload), headers }, token);
}

export function listValidations(
  token: string,
  filters: Record<string, string | number> = {},
): Promise<ApiEnvelope<{ validations: ValidationSession[]; total: number }>> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => params.set(k, String(v)));
  const qs = params.toString();
  return request(`/api/v1/validations${qs ? `?${qs}` : ''}`, {}, token);
}

export function getValidation(
  validationId: string,
  token: string,
): Promise<ApiEnvelope<ValidationDetailResponse>> {
  return request(`/api/v1/validations/${encodeURIComponent(validationId)}`, {}, token);
}

export function transitionValidation(
  validationId: string,
  payload: TransitionValidationRequest,
  token: string,
): Promise<ApiEnvelope<TransitionValidationResponse>> {
  return request(
    `/api/v1/validations/${encodeURIComponent(validationId)}/state`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    token,
  );
}

export function failValidation(
  validationId: string,
  payload: FailValidationRequest,
  token: string,
): Promise<ApiEnvelope<unknown>> {
  return request(
    `/api/v1/validations/${encodeURIComponent(validationId)}/fail`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function archiveValidation(
  validationId: string,
  token: string,
): Promise<ApiEnvelope<unknown>> {
  return request(`/api/v1/validations/${encodeURIComponent(validationId)}/archive`, { method: 'POST' }, token);
}

export function getValidationEvents(
  validationId: string,
  token: string,
): Promise<ApiEnvelope<{ events: SystemEvent[]; total: number }>> {
  return request(`/api/v1/validations/${encodeURIComponent(validationId)}/events`, {}, token);
}

export function getValidationHealth(
  validationId: string,
  token: string,
): Promise<ApiEnvelope<ValidationHealthStatus>> {
  return request(`/api/v1/validations/${encodeURIComponent(validationId)}/health`, {}, token);
}
