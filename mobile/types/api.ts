/**
 * Mobile — API Response Envelope Types
 * React Native / Expo compatible. Re-exports from shared contracts.
 */

export interface ApiError {
  code: string;
  type: string;
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
  timestamp: string;
  processing_time_ms: number;
  pagination?: PaginationMeta | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  errors: ApiError[] | null;
  metadata: ApiMetadata;
}
