import { authenticatedRequest } from './api';

export type DiscoverItem = {
  item_id: string;
  canonical_id: string;
  item_kind: string;
  title: string;
  summary: string;
  visibility: string;
  review_state: string;
  provenance: { source_label?: string; locator?: string; rights_classification?: string; attribution?: string };
  applicability: Record<string, unknown>;
  source_state: string;
  usable: boolean;
  support?: Record<string, { available: boolean; reason?: string; detail?: string }>;
  saved: boolean;
};
export type DiscoverIndex = { items: DiscoverItem[]; count: number; meaning: string };
export type DiscoverPreview = {
  application_id: string;
  state: 'previewed';
  impact: { confirmation: string; changes: Array<{ object: string; action?: string; detail: string }>; creates_nothing: true; meaning: string };
};
export type DiscoverApplication = { application_id: string; state: string; applied_object_kind?: string; applied_object_id?: string; meaning?: string };
export type ProductionKnowledgeItem = {
  item_id: string; canonical_id: string; name: string; category: string; description: string; purpose: string;
  effect: string; knowledge_class: string; source_kind: string; review_state: string; usable_for_guidance: boolean;
  sources: Array<{ source_kind: string; label: string; locator?: string | null }>;
  adaptation: Record<string, unknown> | null;
};
export type KnowledgeSearch = { items: ProductionKnowledgeItem[]; open_conflicts: unknown[]; rule: string };
export type DeviceReadiness = { devices: Array<{ resource_id: string; name: string; capability_state: string }>; shots: Array<{ shot_id: string; title?: string; has_real_plan: boolean }>; unsatisfied_proposals: unknown[]; note?: string };
export type SceneIntelligence = { requirements: Array<{ requirement_id?: string; kind: string; detail: string; state?: string; mandatory?: boolean }>; devices: Array<{ name: string; capability_state: string }>; gaps: Array<{ reason: string; detail?: string }>; shots: Array<{ shot_id: string; title?: string }> };
export type Job = { job_id: string; job_type: string; job_type_display_name?: string; status: string; status_label?: string; progress?: number; attempts: number; max_attempts: number; production_id?: string | null; cancellable?: boolean; reconciliation_required?: boolean; error_code?: string | null; error_message?: string | null; state_line?: string };
export type JobList = { jobs: Job[]; count: number; note: string };

const base = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}`;
export const prompt11Service = {
  discover(workspaceId: string, query = '', kind?: string) {
    const params = new URLSearchParams({ limit: '100' });
    if (query.trim()) params.set('q', query.trim());
    if (kind) params.set('kind', kind);
    return authenticatedRequest<DiscoverIndex>(`${base(workspaceId)}/discover?${params}`);
  },
  saveDiscover(workspaceId: string, itemId: string, saved: boolean) {
    return authenticatedRequest<unknown>(`${base(workspaceId)}/discover/${itemId}/save`, {
      method: saved ? 'POST' : 'DELETE', ...(saved ? { body: JSON.stringify({ note: '' }) } : {}),
    });
  },
  previewDiscover(workspaceId: string, input: { item_id: string; kind: string; production_id: string; note?: string }) {
    return authenticatedRequest<DiscoverPreview>(`${base(workspaceId)}/discover/create-this/previews`, { method: 'POST', body: JSON.stringify(input) });
  },
  applyDiscover(workspaceId: string, applicationId: string, confirmation: string) {
    return authenticatedRequest<DiscoverApplication>(`${base(workspaceId)}/discover/create-this/applications/${applicationId}/apply`, { method: 'POST', body: JSON.stringify({ confirmation, note: '' }) });
  },
  knowledge(workspaceId: string, query = '') {
    const params = new URLSearchParams({ limit: '100', include_unreviewed: 'true' });
    if (query.trim()) params.set('q', query.trim());
    return authenticatedRequest<KnowledgeSearch>(`${base(workspaceId)}/knowledge?${params}`);
  },
  deviceReadiness(workspaceId: string, productionId: string) {
    return authenticatedRequest<DeviceReadiness>(`${base(workspaceId)}/productions/${productionId}/device-readiness`);
  },
  sceneIntelligence(workspaceId: string, productionId: string, sceneId?: string) {
    const params = new URLSearchParams();
    if (sceneId) params.set('scene_id', sceneId);
    const suffix = params.size ? `?${params}` : '';
    return authenticatedRequest<SceneIntelligence>(`${base(workspaceId)}/productions/${productionId}/scene-intelligence${suffix}`);
  },
  jobs(workspaceId: string) { return authenticatedRequest<JobList>(`${base(workspaceId)}/jobs?limit=100&include_terminal=true`); },
  cancelJob(workspaceId: string, jobId: string, reason: string) {
    return authenticatedRequest<Job>(`${base(workspaceId)}/jobs/${jobId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
  },
  requeueJob(workspaceId: string, jobId: string, note: string) {
    return authenticatedRequest<Job>(`${base(workspaceId)}/jobs/${jobId}/requeue`, { method: 'POST', body: JSON.stringify({ note }) });
  },
};
