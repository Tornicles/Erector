import { authenticatedRequest } from './api';

/**
 * Prompt 10 surface: publishing to an external destination.
 *
 * Three separations this client must not blur:
 *
 * * a **creative approval** of a Result is not publishing authority. Authorizing is its own recorded
 *   act, naming the exact Production revision, Result revision, media checksum and destination;
 * * a **submitted** publication is not a published one. `published` requires a remote resource the
 *   destination returned, and `unknown_remote_state` is displayed as unknown rather than as success or
 *   failure;
 * * the **provider call happens on the server** through a bounded adapter. The browser holds no
 *   provider token and never receives one.
 */

export type PublicationState = 'draft' | 'ready' | 'awaiting_authorization' | 'submitting' | 'submitted'
  | 'processing' | 'published' | 'failed' | 'cancelled' | 'removed' | 'unknown_remote_state';

export type PublishingVocabulary = {
  states: Record<string, string>;
  failure_categories: Record<string, string>;
  permitted_settings_keys: string[];
  authority_law: string;
  retry: Record<string, string>;
  unknown_state_law: string;
  provider_boundary: string;
};

export type Publication = {
  id: string; workspace_id: string; production_id: string; production_revision: number;
  result_id: string; result_revision: number; media_id: string; media_checksum: string;
  destination_provider: string; destination_account_id: string | null; destination: string;
  destination_config: Record<string, unknown>; media_type: string; visibility: string;
  scheduled_for: string | null; title: string; caption: string; state: PublicationState; state_label?: string;
  authorization_id: string | null; operation_id: string; idempotency_key: string;
  submission_attempts: number; last_attempt_at: string | null; submitted_at: string | null;
  remote_resource_type: string; remote_resource_id: string | null; remote_url: string | null;
  remote_state: string; last_checked_at: string | null; published_at: string | null;
  failed_at: string | null; failure_category: string | null; failure_code: string | null;
  failure_message: string | null; cancelled_at: string | null; removed_at: string | null;
  created_at: string; updated_at: string;
};

export type PublicationPreview = {
  publication_id: string; state: PublicationState;
  production: { id: string; title: string; pinned_revision: number; current_revision: number };
  result: { id: string; state: string; approval: string; pinned_revision: number; current_revision: number };
  media: { id: string; media_type: string; mime_type: string; bytes: number; pinned_checksum: string;
    current_checksum: string; upload_state: string; thumbnail_media_id: string | null };
  destination: { provider: string; provider_name: string | null; account_id: string | null;
    account_label: string; target: string; visibility: string; scheduled_for: string | null };
  content: { title: string; caption: string; settings: Record<string, unknown>; fingerprint: string };
  provider_constraints: Record<string, unknown>;
  capability: string; missing_scopes: string[];
  authorization: { authorization_id: string | null; decision: string | null; actor_user_id: string | null;
    authorized_at: string | null };
  retry_safety: string; can_submit: boolean; blocked_by: string[]; note: string;
  permitted_settings_keys?: string[]; vocabulary?: PublishingVocabulary;
};

export type PublicationAttempt = {
  id: string; attempt_number: number; state: string; operation_id: string; idempotency_key: string;
  request_fingerprint: string; remote_resource_id: string | null; remote_url: string | null;
  remote_state: string; failure_category: string | null; failure_code: string | null;
  failure_message: string | null; started_at: string | null; finished_at: string | null;
};

export type PublicationStatus = {
  publication: Publication; preview: PublicationPreview | null;
  authorizations: Array<{ id: string; decision: string; actor_user_id: string | null; authorized_at: string;
    production_revision: number; result_revision: number; media_id: string; media_checksum: string;
    destination_provider: string; destination: string; note: string }>;
  attempts: PublicationAttempt[];
  reconciliations: Array<{ id: string; observed_state: string; remote_state: string;
    remote_resource_id: string | null; source: string; note: string; observed_at: string }>;
  retry_safety: string; adapter: Record<string, unknown>; vocabulary?: PublishingVocabulary;
};

export type PublicationAction = {
  publication_id: string; state?: string; previous_state?: string; attempt_id?: string;
  attempt_number?: number; operation_id?: string; idempotency_key?: string; outcome?: string;
  remote_resource_id?: string | null; remote_url?: string | null; remote_state?: string;
  failure_category?: string | null; meaning?: string; note?: string; retry?: string;
  submitted?: boolean; unconfigured?: string[]; provider_detail?: string;
  entitlement?: { entitlement: string; state: string; enforced: boolean; available: boolean };
  creative_approval_used_as_authority?: boolean; refreshed?: boolean; source?: string;
  authorization_id?: string; decision?: string; actor_user_id?: string;
  authorized_version?: { production_revision: number; result_revision: number };
  destination?: { provider?: string; target?: string; account_id?: string | null };
};

export const publishingService = {
  vocabulary: (workspaceId: string) =>
    authenticatedRequest<PublishingVocabulary>(`/api/v1/workspaces/${workspaceId}/publishing/vocabulary`),

  list: (workspaceId: string, params: { production_id?: string; result_id?: string; state?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.production_id) search.set('production_id', params.production_id);
    if (params.result_id) search.set('result_id', params.result_id);
    if (params.state) search.set('state', params.state);
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return authenticatedRequest<{ items: Publication[]; count: number; vocabulary: PublishingVocabulary }>(
      `/api/v1/workspaces/${workspaceId}/publications${suffix}`);
  },

  create: (workspaceId: string, body: { production_id: string; result_id: string; provider: string;
    media_id?: string; destination?: string; account_id?: string; title?: string; caption?: string;
    visibility?: string; scheduled_for?: string | null; config?: Record<string, unknown> }) =>
    authenticatedRequest<PublicationAction>(`/api/v1/workspaces/${workspaceId}/publications`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  status: (workspaceId: string, publicationId: string) =>
    authenticatedRequest<PublicationStatus>(`/api/v1/workspaces/${workspaceId}/publications/${publicationId}`),

  preview: (workspaceId: string, publicationId: string) =>
    authenticatedRequest<PublicationPreview>(
      `/api/v1/workspaces/${workspaceId}/publications/${publicationId}/preview`),

  update: (workspaceId: string, publicationId: string, body: { title: string; caption: string;
    destination: string; config: Record<string, unknown>; visibility: string; scheduled_for?: string | null }) =>
    authenticatedRequest<PublicationAction>(
      `/api/v1/workspaces/${workspaceId}/publications/${publicationId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),

  setState: (workspaceId: string, publicationId: string, body: { desired: string; note?: string }) =>
    authenticatedRequest<PublicationAction>(
      `/api/v1/workspaces/${workspaceId}/publications/${publicationId}/state`, {
        method: 'POST', body: JSON.stringify(body),
      }),

  authorize: (workspaceId: string, publicationId: string, body: { decision: 'authorize' | 'withdraw';
    note?: string }) =>
    authenticatedRequest<PublicationAction>(
      `/api/v1/workspaces/${workspaceId}/publications/${publicationId}/authorize`, {
        method: 'POST', body: JSON.stringify(body),
      }),

  submit: (workspaceId: string, publicationId: string) =>
    authenticatedRequest<PublicationAction>(
      `/api/v1/workspaces/${workspaceId}/publications/${publicationId}/submit`, { method: 'POST' }),

  refresh: (workspaceId: string, publicationId: string) =>
    authenticatedRequest<PublicationAction>(
      `/api/v1/workspaces/${workspaceId}/publications/${publicationId}/refresh`, { method: 'POST' }),

  reconcile: (workspaceId: string, publicationId: string, body: { observed: string;
    remote_resource_id?: string | null; remote_state?: string; failure_category?: string | null; note?: string }) =>
    authenticatedRequest<PublicationAction>(
      `/api/v1/workspaces/${workspaceId}/publications/${publicationId}/reconcile`, {
        method: 'POST', body: JSON.stringify(body),
      }),
};
