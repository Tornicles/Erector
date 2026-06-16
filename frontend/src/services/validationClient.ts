/**
 * Validation API Client — Prompt A3
 */

import type { ApiEnvelope } from './api';
import type {
  CreateValidationRequest,
  CreateValidationResponse,
  FailValidationRequest,
  SystemEvent,
  TransitionValidationRequest,
  TransitionValidationResponse,
  ValidationDetailResponse,
  ValidationHealthStatus,
  ValidationListFilters,
  ValidationSession,
} from '../types/validation';

const BASE_URL = process.env.REACT_APP_BACKEND_URL || '';

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  return res.json() as Promise<ApiEnvelope<T>>;
}

export interface ValidationListData {
  validations: ValidationSession[];
  total: number;
}

export interface ValidationEventsData {
  events: SystemEvent[];
  total: number;
}

export function createValidation(
  payload: CreateValidationRequest,
  token: string,
  idempotencyKey?: string,
): Promise<ApiEnvelope<CreateValidationResponse>> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return request<CreateValidationResponse>(
    '/api/v1/validations',
    { method: 'POST', body: JSON.stringify(payload), headers },
    token,
  );
}

export function listValidations(
  token: string,
  filters: ValidationListFilters = {},
): Promise<ApiEnvelope<ValidationListData>> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.team_id) params.set('team_id', filters.team_id);
  if (filters.search) params.set('search', filters.search);
  if (filters.created_after) params.set('created_after', filters.created_after);
  if (filters.created_before) params.set('created_before', filters.created_before);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.page_size) params.set('page_size', String(filters.page_size));
  const qs = params.toString();
  return request<ValidationListData>(
    `/api/v1/validations${qs ? `?${qs}` : ''}`,
    {},
    token,
  );
}

export function getValidation(
  validationId: string,
  token: string,
): Promise<ApiEnvelope<ValidationDetailResponse>> {
  return request<ValidationDetailResponse>(
    `/api/v1/validations/${encodeURIComponent(validationId)}`,
    {},
    token,
  );
}

export function transitionValidation(
  validationId: string,
  payload: TransitionValidationRequest,
  token: string,
): Promise<ApiEnvelope<TransitionValidationResponse>> {
  return request<TransitionValidationResponse>(
    `/api/v1/validations/${encodeURIComponent(validationId)}/state`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    token,
  );
}

export function failValidation(
  validationId: string,
  payload: FailValidationRequest,
  token: string,
): Promise<ApiEnvelope<{ validation_id: string; status: string; event_id?: string }>> {
  return request(
    `/api/v1/validations/${encodeURIComponent(validationId)}/fail`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export function archiveValidation(
  validationId: string,
  token: string,
): Promise<ApiEnvelope<{ validation_id: string; status: string; archived_at?: string }>> {
  return request(
    `/api/v1/validations/${encodeURIComponent(validationId)}/archive`,
    { method: 'POST' },
    token,
  );
}

export function getValidationEvents(
  validationId: string,
  token: string,
): Promise<ApiEnvelope<ValidationEventsData>> {
  return request<ValidationEventsData>(
    `/api/v1/validations/${encodeURIComponent(validationId)}/events`,
    {},
    token,
  );
}

export function getValidationHealth(
  validationId: string,
  token: string,
): Promise<ApiEnvelope<ValidationHealthStatus>> {
  return request<ValidationHealthStatus>(
    `/api/v1/validations/${encodeURIComponent(validationId)}/health`,
    {},
    token,
  );
}
