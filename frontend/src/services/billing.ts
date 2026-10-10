import { authenticatedRequest } from './api';

/**
 * Prompt 10 surface: subscription, entitlements, usage and cost.
 *
 * Billing is server-authoritative. This client can open a checkout intent and read status; it cannot
 * subscribe the workspace, grant an entitlement or record usage, and there is no route through which it
 * could try. Entitlement answers are read from the server for display only — the same check runs again
 * server-side before any paid operation does anything.
 *
 * Cost figures keep the four kinds apart, because combining them would be a product lie:
 * actual provider cost, estimated provider cost, what the creator was charged, and credits consumed.
 */

export type SubscriptionState = 'none' | 'trialing' | 'active' | 'past_due' | 'incomplete'
  | 'cancel_at_period_end' | 'cancelled' | 'suspended';

export type BillingVocabulary = {
  subscription_states: Record<string, string>;
  cost_kinds: Record<string, string>;
  authority_law: string;
  webhook_law: string;
  retry: Record<string, string>;
};

export type EntitlementRow = {
  key: string; name: string; kind: string; unit: string; source: string;
  limit_amount: number | null; consumed_amount: number; reserved_amount: number;
  remaining: number | null; valid_until: string | null;
};

export type BillingStatus = {
  workspace_id: string;
  subscription: { state: SubscriptionState; plan_key: string | null; plan_name: string | null;
    cancel_at_period_end: boolean; current_period_end: string | null; provider_state_at: string | null;
    grants_entitlements: boolean };
  provider: { name: string; configured: boolean };
  entitlements: EntitlementRow[];
  open_checkouts: Array<{ intent_id: string; plan_key: string; state: string; created_at: string }>;
  note: string;
  vocabulary?: BillingVocabulary;
};

export type EntitlementDecision = {
  entitlement: string; state: string; enforced: boolean; available: boolean; meaning: string;
  server_authoritative?: boolean; frontend_role?: string;
};

export type UsageEvent = {
  id: string; metric: string; quantity: number; unit: string; operation: string; provider: string;
  model: string; production_id: string | null; provider_cost: number | null; estimated_cost: number | null;
  price_amount: number | null; credit_units: number; currency: string; cost_basis: string;
  source_event_id: string | null; created_at: string;
};

export type UsageSummary = {
  workspace_id: string; events: number;
  metrics: Array<{ metric: string; unit: string; quantity: number; events: number; credits: number;
    actual_provider_cost: number; estimated_provider_cost: number; charges: number;
    basis_counts: Record<string, number> }>;
  window: { since: string | null; limit: number };
  cost_separation: string; note: string; vocabulary?: BillingVocabulary;
};

export type CostSummary = {
  workspace_id: string; actual_provider_cost: number; estimated_provider_cost: number;
  charged_to_creator: number; credits_consumed: number; currency: string | string[];
  rows: { actual: number; estimated: number; unknown: number };
  meaning: Record<string, string>; note: string; vocabulary?: BillingVocabulary;
};

export type CheckoutResult = {
  intent_id: string; plan_key: string; state: string; provider: string; provider_price_id: string;
  checkout_url: string | null; provider_configured: boolean; unconfigured: string[]; retry: string;
  note: string; authority: string;
};

export type PortalResult = {
  workspace_id: string; portal_url: string | null; provider: string | null;
  provider_configured: boolean; unconfigured: string[]; has_account: boolean; retry: string; note: string;
  plan_changes_happen_at?: string;
};

export const billingService = {
  vocabulary: (workspaceId: string) =>
    authenticatedRequest<BillingVocabulary>(`/api/v1/workspaces/${workspaceId}/billing/vocabulary`),

  status: (workspaceId: string) =>
    authenticatedRequest<BillingStatus>(`/api/v1/workspaces/${workspaceId}/billing/status`),

  account: (workspaceId: string) =>
    authenticatedRequest<{ workspace_id: string; account: Record<string, unknown> | null;
      has_subscription: boolean; note: string }>(`/api/v1/workspaces/${workspaceId}/billing/account`),

  entitlement: (workspaceId: string, key: string) =>
    authenticatedRequest<EntitlementDecision>(
      `/api/v1/workspaces/${workspaceId}/entitlements/${encodeURIComponent(key)}`),

  usage: (workspaceId: string, params: { metric?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.metric) search.set('metric', params.metric);
    if (params.limit) search.set('limit', String(params.limit));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return authenticatedRequest<{ items: UsageEvent[]; count: number; note: string }>(
      `/api/v1/workspaces/${workspaceId}/usage${suffix}`);
  },

  usageSummary: (workspaceId: string) =>
    authenticatedRequest<UsageSummary>(`/api/v1/workspaces/${workspaceId}/usage/summary`),

  costs: (workspaceId: string) =>
    authenticatedRequest<CostSummary>(`/api/v1/workspaces/${workspaceId}/costs`),

  checkout: (workspaceId: string, body: { plan_key: string; note?: string }) =>
    authenticatedRequest<CheckoutResult>(`/api/v1/workspaces/${workspaceId}/billing/checkout`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  portal: (workspaceId: string, body: { note?: string } = {}) =>
    authenticatedRequest<PortalResult>(`/api/v1/workspaces/${workspaceId}/billing/portal`, {
      method: 'POST', body: JSON.stringify(body),
    }),
};
