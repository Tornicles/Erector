import { authenticatedRequest } from './api';

/**
 * Prompt 10 surface: destination accounts.
 *
 * The rule this client exists to respect: a destination account is CONNECTED only when the provider
 * confirmed it. `status` is the only source of that word, and the surface reads it rather than an
 * optimistic local flag. TONDE stores no provider credential — a connection names the vault reference
 * that holds it — and the client never sees a token, an authorization code or a secret.
 */

export type ConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'reauth_required' | 'expired'
  | 'revoked' | 'error' | 'disabled';
export type AdapterState = 'absent' | 'implemented' | 'verified';

export type IntegrationVocabulary = {
  connection_states: Record<string, string>;
  adapter_states: Record<string, string>;
  capability_states: string[];
  credential_law: string;
  token_refresh_boundary: string;
  retry: Record<string, string>;
  oauth_state_law: string;
};

export type AdapterDescription = {
  provider: string; adapter_present: boolean; configured: boolean;
  unconfigured_dependencies: string[]; network_calls: boolean;
};

export type ProviderCapability = {
  provider_key: string; capability_key: string; connection_required: boolean;
  required_scopes: string[]; enabled: boolean; note: string;
};

export type IntegrationProvider = {
  key: string; name: string; category: string; auth_type: string; adapter_state: AdapterState;
  enabled: boolean; media_types: string[]; scopes: string[]; restrictions: Record<string, unknown>;
  note: string; docs_url: string; capabilities: ProviderCapability[]; adapter: AdapterDescription;
  connection_available: boolean;
};

export type IntegrationConnection = {
  id: string; provider: string; provider_account_id: string | null; status: ConnectionStatus;
  scopes: string[]; auth_type: string; external_account_label: string;
  requested_scopes: string[]; verified_at: string | null; last_success_at: string | null;
  last_error_at: string | null; last_error_code: string | null; revoked_at: string | null;
  metadata: Record<string, unknown>; adapter: AdapterDescription;
  granted_scopes: string[]; missing_requested_scopes: string[]; verified: boolean;
  credential_reference_recorded: boolean; note: string;
};

export type CapabilityAnswer = {
  provider: string; capability: string; state: string; available: boolean;
  adapter: AdapterDescription; meaning?: string;
};

export type CapabilityMatrix = {
  provider: string; granted_scopes: string[]; adapter: AdapterDescription;
  connected_accounts: Array<{ id: string; label: string; verified_at: string | null }>;
  capabilities: Array<{ capability: string; connection_required: boolean; required_scopes: string[];
    missing_scopes: string[]; state: CapabilityAnswer }>;
};

export type IntegrationAction = {
  provider?: string; connection_id?: string; connected?: boolean; verified?: boolean; status?: string;
  verified_at?: string | null; last_success_at?: string | null; account_label?: string;
  granted_scopes?: string[]; requested_scopes?: string[]; unrequested_scopes_ignored?: string[];
  unconfigured?: string[]; adapter?: AdapterDescription; credential_reference_recorded?: boolean;
  credential_storage?: string; token_refresh_boundary?: string; retry?: string; note: string;
  reauthorized?: boolean; previous_status?: string | null; revoked_at?: string | null;
  remote_revoked?: boolean | null; state?: string;
};

export type OAuthInitiation = {
  provider: string; initiated: boolean; authorize_url: string | null; state: string | null;
  verifier?: string; state_id?: string; redirect_uri?: string; requested_scopes?: string[];
  expires_at?: string; expires_in_minutes?: number; unconfigured: string[]; note: string; retry?: string;
};

export const integrationService = {
  vocabulary: (workspaceId: string) =>
    authenticatedRequest<IntegrationVocabulary>(`/api/v1/workspaces/${workspaceId}/integrations/vocabulary`),

  providers: (workspaceId: string) =>
    authenticatedRequest<{ items: IntegrationProvider[]; count: number; vocabulary: IntegrationVocabulary }>(
      `/api/v1/workspaces/${workspaceId}/integrations/providers`),

  capabilities: (workspaceId: string, provider: string) =>
    authenticatedRequest<CapabilityMatrix>(
      `/api/v1/workspaces/${workspaceId}/integrations/providers/${encodeURIComponent(provider)}/capabilities`),

  connections: (workspaceId: string) =>
    authenticatedRequest<{ items: IntegrationConnection[]; count: number; vocabulary: IntegrationVocabulary }>(
      `/api/v1/workspaces/${workspaceId}/integrations/connections`),

  attemptInitiation: (workspaceId: string, body: { provider: string; redirect_uri?: string;
    requested_scopes?: string[] }) =>
    authenticatedRequest<OAuthInitiation>(`/api/v1/workspaces/${workspaceId}/integrations/oauth/initiate`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  completeCallback: (workspaceId: string, body: { state: string; code: string; account_label?: string;
    credential_reference?: string }) =>
    authenticatedRequest<IntegrationAction>(`/api/v1/workspaces/${workspaceId}/integrations/oauth/callback`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  connect: (workspaceId: string, body: { provider: string; credential_reference?: string;
    account_label?: string; requested_scopes?: string[] }) =>
    authenticatedRequest<IntegrationAction>(`/api/v1/workspaces/${workspaceId}/integrations/connections`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  verify: (workspaceId: string, connectionId: string, body: { credential_reference?: string; note?: string } = {}) =>
    authenticatedRequest<IntegrationAction>(
      `/api/v1/workspaces/${workspaceId}/integrations/connections/${connectionId}/verify`, {
        method: 'POST', body: JSON.stringify(body),
      }),

  reauthorize: (workspaceId: string, connectionId: string, body: { credential_reference?: string;
    requested_scopes?: string[] }) =>
    authenticatedRequest<IntegrationAction>(
      `/api/v1/workspaces/${workspaceId}/integrations/connections/${connectionId}/reauthorize`, {
        method: 'POST', body: JSON.stringify(body),
      }),

  disconnect: (workspaceId: string, connectionId: string, body: { reason?: string } = {}) =>
    authenticatedRequest<IntegrationAction>(
      `/api/v1/workspaces/${workspaceId}/integrations/connections/${connectionId}/disconnect`, {
        method: 'POST', body: JSON.stringify(body),
      }),
};
