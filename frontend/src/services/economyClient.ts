/**
 * Economy API Client — Prompt A2
 * All economy, resolution, comparison, and stack endpoints.
 */

import type { ApiEnvelope } from './api';
import type {
  Economy,
  EconomySummary,
  EconomyResolveResponse,
  EconomyCompareRequest,
  EconomyCompareResponse,
  EconomicStack,
  EconomicStackBuildRequest,
} from '../types/economy';

const BASE_URL = process.env.REACT_APP_BACKEND_URL || '';

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  return res.json() as Promise<ApiEnvelope<T>>;
}

// ── Economy List ──────────────────────────────────────────────────────────────

export interface EconomyListData {
  economies: EconomySummary[];
  total: number;
}

export function fetchEconomies(
  skip = 0,
  limit = 30,
): Promise<ApiEnvelope<EconomyListData>> {
  return request<EconomyListData>(`/api/v1/economies?skip=${skip}&limit=${limit}`);
}

// ── Economy Detail ────────────────────────────────────────────────────────────

export function fetchEconomy(economyId: string): Promise<ApiEnvelope<Economy>> {
  return request<Economy>(`/api/v1/economies/${encodeURIComponent(economyId)}`);
}

// ── Country Resolution ────────────────────────────────────────────────────────

export function resolveCountry(
  country: string,
): Promise<ApiEnvelope<EconomyResolveResponse>> {
  return request<EconomyResolveResponse>(
    `/api/v1/economies/resolve/${encodeURIComponent(country)}`,
  );
}

// ── Economy Comparison ────────────────────────────────────────────────────────

export function compareEconomies(
  payload: EconomyCompareRequest,
): Promise<ApiEnvelope<EconomyCompareResponse>> {
  return request<EconomyCompareResponse>('/api/v1/economies/compare', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Economic Stack ────────────────────────────────────────────────────────────

export function buildEconomicStack(
  payload: EconomicStackBuildRequest,
): Promise<ApiEnvelope<EconomicStack>> {
  return request<EconomicStack>('/api/v1/stack/build', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
