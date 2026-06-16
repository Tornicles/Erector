/**
 * Erector API Response Envelope Types
 * Mirrors backend/models/base.py ApiResponse contract.
 */

import { ErrorType } from './enums';

export interface ApiError {
  code: string;
  type: ErrorType;
  message: string;
  field?: string | null;
  details?: Record<string, unknown> | null;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  next_cursor?: string | null;
  previous_cursor?: string | null;
}

export interface ApiMetadata {
  request_id: string;
  version: string;
  timestamp: string; // ISO8601
  processing_time_ms: number;
  pagination?: PaginationMeta | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  errors: ApiError[] | null;
  metadata: ApiMetadata;
}

// Convenience type aliases
export type ApiListResponse<T> = ApiResponse<T[]>;
export type ApiPagedResponse<T> = ApiResponse<T[]> & {
  metadata: ApiMetadata & { pagination: PaginationMeta };
};
