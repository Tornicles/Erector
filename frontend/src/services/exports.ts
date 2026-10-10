import { authenticatedRequest } from './api';

/**
 * Prompt 10 surface: exporting a Production.
 *
 * Two distinct products, never one:
 *
 * * **Download Full Document** — a PDF or DOCX of the Production version the export pins;
 * * **Export Production Package** — a ZIP described file by file, or its structured-data JSON.
 *
 * This client never invents a download state. `state` and `ready` come from the database; the download
 * link is authorized per request and is short-lived, and when no signed URL can be produced the surface
 * says so instead of showing a link that does not work.
 */

export type ExportKind = 'full_document' | 'production_package';
export type ExportState = 'requested' | 'building' | 'ready' | 'failed' | 'expired';
export type ExportFormat = 'pdf' | 'docx' | 'zip' | 'json';
export type PackageType = 'complete' | 'script' | 'shot_list' | 'storyboard' | 'prompt_pack' | 'camera_plan'
  | 'continuity_report' | 'audio_plan' | 'edit_plan' | 'structured_data';

export const EXPORT_PACKAGE_TYPES: PackageType[] = ['complete', 'script', 'shot_list', 'storyboard',
  'prompt_pack', 'camera_plan', 'continuity_report', 'audio_plan', 'edit_plan', 'structured_data'];

export type ExportVocabulary = {
  products: Record<string, { label: string; formats: string[]; note: string }>;
  states: Record<string, string>;
  package_types: string[];
  retry: Record<string, string>;
  boundary: string;
};

export type ProductionExport = {
  id: string; workspace_id: string; production_id: string; job_id: string | null;
  kind: ExportKind; requested_format: ExportFormat; package_type: PackageType; state: ExportState;
  production_revision: number; production_version_id: string | null; generated_media_id: string | null;
  file_count: number | null; total_bytes: number | null; content_checksum: string | null;
  requested_by: string; created_at: string; ready_at: string | null; failed_at: string | null;
  expired_at: string | null; failure_code: string | null; failure_message: string | null;
  completed_at: string | null; manifest: { files?: Array<{ path: string; bytes: number; checksum: string }>;
    pin?: Record<string, unknown> } | null;
  downloadable: boolean; retry: string | null; note: string; schema_version: string;
};

export type ExportRequestResult = {
  export_id: string; state: ExportState; kind: ExportKind; format: ExportFormat; package_type: PackageType;
  production_revision: number; production_version_id: string | null; retry: string; built_by: string;
  entitlement?: { entitlement: string; state: string; enforced: boolean; available: boolean };
};

export type ExportDownload = {
  authorized: boolean; export_id: string; state: ExportState; bucket: string; object_key: string;
  window_seconds: number; kind: ExportKind; format: ExportFormat; download_url: string | null;
  retry?: string; note?: string;
};

export const exportService = {
  vocabulary: (workspaceId: string) =>
    authenticatedRequest<ExportVocabulary>(`/api/v1/workspaces/${workspaceId}/exports/vocabulary`),

  list: (workspaceId: string, params: { production_id?: string } = {}) => {
    const suffix = params.production_id ? `?production_id=${params.production_id}` : '';
    return authenticatedRequest<{ items: ProductionExport[]; count: number; vocabulary: ExportVocabulary }>(
      `/api/v1/workspaces/${workspaceId}/exports${suffix}`);
  },

  request: (workspaceId: string, body: { production_id: string; kind: ExportKind; format: ExportFormat;
    package_type?: PackageType }) =>
    authenticatedRequest<ExportRequestResult>(`/api/v1/workspaces/${workspaceId}/exports`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  detail: (workspaceId: string, exportId: string) =>
    authenticatedRequest<ProductionExport>(`/api/v1/workspaces/${workspaceId}/exports/${exportId}`),

  build: (workspaceId: string, exportId: string) =>
    authenticatedRequest<ProductionExport>(`/api/v1/workspaces/${workspaceId}/exports/${exportId}/build`, {
      method: 'POST',
    }),

  download: (workspaceId: string, exportId: string) =>
    authenticatedRequest<ExportDownload>(`/api/v1/workspaces/${workspaceId}/exports/${exportId}/download`),

  expire: (workspaceId: string, exportId: string) =>
    authenticatedRequest<ProductionExport>(`/api/v1/workspaces/${workspaceId}/exports/${exportId}/expire`, {
      method: 'POST',
    }),
};
