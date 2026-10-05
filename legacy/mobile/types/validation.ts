/**
 * Validation Lifecycle Types — Prompt A3 (mobile)
 */

export type ValidationStatus =
  | 'draft'
  | 'context_collecting'
  | 'context_collected'
  | 'economic_stack_built'
  | 'engines_queued'
  | 'engines_running'
  | 'partial_results'
  | 'scoring'
  | 'recursive_challenge'
  | 'path_generation'
  | 'simulation_ready'
  | 'report_ready'
  | 'completed'
  | 'failed'
  | 'launched'
  | 'archived';

export type ValidationEventType =
  | 'validation_created'
  | 'validation_started'
  | 'validation_state_changed'
  | 'validation_completed'
  | 'validation_failed'
  | 'validation_archived'
  | 'engine_started'
  | 'engine_completed'
  | 'engine_failed'
  | 'engine_fallback'
  | 'score_updated'
  | 'report_generated'
  | 'climate_changed'
  | 'launch_ready'
  | 'launch_completed'
  | 'revalidation_required';

export type EventStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'dead_lettered'
  | 'ignored';

export interface ValidationProgress {
  total_engines: number;
  engines_completed: number;
  engines_failed: number;
  engines_fallback: number;
  percent_complete: number;
  current_stage?: string | null;
  live_message?: string | null;
  updated_at?: string | null;
}

export interface EngineRunSummary {
  queued_count: number;
  running_count: number;
  completed_count: number;
  failed_count: number;
  fallback_count: number;
  skipped_count: number;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ValidationStateHistoryEntry {
  from_status: ValidationStatus;
  to_status: ValidationStatus;
  reason: string;
  actor_type: string;
  actor_id?: string | null;
  event_id?: string | null;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ValidationSession {
  validation_id: string;
  owner_user_id: string;
  team_id?: string | null;
  status: ValidationStatus;
  idempotency_key?: string | null;
  title?: string | null;
  raw_goal?: string | null;
  progress: ValidationProgress;
  engine_run_summary: EngineRunSummary;
  blockers: string[];
  warnings: string[];
  failed_reason?: string | null;
  failure_code?: string | null;
  state_history: ValidationStateHistoryEntry[];
  event_ids: string[];
  last_activity_at: string;
  created_at: string;
  updated_at?: string | null;
  completed_at?: string | null;
  launched_at?: string | null;
  archived_at?: string | null;
}

export interface CreateValidationRequest {
  raw_goal: string;
  title?: string;
  industry?: string;
  founder_country?: string;
  customer_country?: string;
  success_definition?: string;
  idempotency_key?: string;
  team_id?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateValidationResponse {
  validation_id: string;
  status: ValidationStatus;
  idempotency_key: string;
  created: boolean;
  existing: boolean;
  validation: Partial<ValidationSession>;
}

export interface ValidationDetailResponse {
  validation: ValidationSession;
  allowed_next_states: ValidationStatus[];
  latest_events: SystemEvent[];
  health_status: ValidationHealthStatus;
}

export interface TransitionValidationRequest {
  next_status: ValidationStatus;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionValidationResponse {
  validation_id: string;
  previous_status: ValidationStatus;
  current_status: ValidationStatus;
  transitioned: boolean;
  reason: string;
  event_id?: string | null;
}

export interface ValidationHealthStatus {
  status: ValidationStatus;
  is_stuck: boolean;
  stuck_reason?: string | null;
  idle_seconds: number;
  last_activity_at?: string | null;
  checked_at: string;
}

export interface SystemEvent {
  event_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  validation_id?: string | null;
  payload: Record<string, unknown>;
  status: EventStatus;
  emitted_at: string;
  attempts: number;
}

export interface DeadLetterQueueItem {
  dead_letter_id: string;
  original_event_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  validation_id?: string | null;
  payload: Record<string, unknown>;
  failure_reason: string;
  attempts: number;
  status: string;
}

export interface FailValidationRequest {
  reason: string;
  error_code?: string;
  metadata?: Record<string, unknown>;
}
