/**
 * Context API Client — Prompt A4
 */

import type { ApiEnvelope } from './api';
import type {
  ContextSubmissionRequest,
  ContextSubmissionResponse,
  ValidationContext,
} from '../types/context';
import type { GetQuestionsResponse } from '../types/questions';

const BASE_URL = process.env.REACT_APP_BACKEND_URL || '';

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

export function getQuestions(validationId: string, token: string): Promise<ApiEnvelope<GetQuestionsResponse>> {
  return request<GetQuestionsResponse>(`/api/v1/validations/${encodeURIComponent(validationId)}/questions`, token);
}

export function submitContext(
  validationId: string,
  payload: ContextSubmissionRequest,
  token: string,
): Promise<ApiEnvelope<ContextSubmissionResponse>> {
  return request<ContextSubmissionResponse>(
    `/api/v1/validations/${encodeURIComponent(validationId)}/context`,
    token,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export function getContext(validationId: string, token: string): Promise<ApiEnvelope<ValidationContext>> {
  return request<ValidationContext>(`/api/v1/validations/${encodeURIComponent(validationId)}/context`, token);
}

export function resetContext(validationId: string, token: string): Promise<ApiEnvelope<{ reset: boolean }>> {
  return request(`/api/v1/validations/${encodeURIComponent(validationId)}/context/reset`, token, { method: 'POST' });
}
