/**
 * Report and Share Types
 * Mirrors backend/models/reports.py + sharing.py
 */

import { ReportPackageType, ReportFormat, ShareExpiry } from './enums';

export type ReportStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'expired';

export interface ExportUrl {
  format: ReportFormat;
  url: string;
  generated_at: string;
  expires_at?: string | null;
}

export interface ValidationReport {
  report_id: string;
  validation_id: string;
  owner_user_id: string;
  package_type: ReportPackageType;
  status: ReportStatus;
  format: ReportFormat;
  version: number;
  title: string;
  page_count?: number | null;
  file_url?: string | null;
  export_urls: ExportUrl[];
  generated_from_score_id?: string | null;
  generated_from_framework_id?: string | null;
  generated_at?: string | null;
  expires_at?: string | null;
  created_at: string;
}

export interface ReportAccessLog {
  access_log_id: string;
  accessed_at: string;
  ip_hash?: string | null;
  user_agent?: string | null;
  downloaded: boolean;
  format?: string | null;
}

export interface ReportShare {
  share_id: string;
  report_id: string;
  validation_id: string;
  owner_user_id: string;
  expiry: ShareExpiry;
  expires_at?: string | null;
  revoked_at?: string | null;
  access_logs: ReportAccessLog[];
  created_at: string;
}

export interface CreateShareRequest {
  report_id: string;
  expiry: ShareExpiry;
  password?: string;
}
