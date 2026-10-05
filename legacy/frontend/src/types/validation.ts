/**
 * Validation Lifecycle Types — Prompt A3
 * Mirrors backend/app/models/validation.py and events.py
 */

import {
  ValidationStatus,
  GoalType,
  ValidationDepth,
  UserType,
  VerdictType,
} from './enums';

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

export type DeadLetterStatus = 'open' | 'retrying' | 'resolved' | 'ignored' | 'pending' | 'abandoned';

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
  goal_type: GoalType;
  validation_depth: ValidationDepth;
  user_type: UserType;
  industry?: string | null;
  founder_country?: string | null;
  customer_country?: string | null;
  target_launch_date?: string | null;
  budget_range?: string | null;
  currency: string;
  success_definition?: string | null;
  context_input?: Record<string, unknown> | null;
  structured_goal?: Record<string, unknown> | null;
  economic_stack_id?: string | null;
  current_score_id?: string | null;
  current_verdict?: VerdictType | null;
  selected_path_id?: string | null;
  current_framework_id?: string | null;
  current_climate_id?: string | null;
  launch_id?: string | null;
  active_simulation_id?: string | null;
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
  schema_version?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateValidationRequest {
  raw_goal: string;
  title?: string;
  goal_type?: GoalType;
  validation_depth?: ValidationDepth;
  industry?: string;
  founder_country?: string;
  customer_country?: string;
  target_launch_date?: string;
  budget_range?: string;
  currency?: string;
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
  event_type: ValidationEventType | string;
  entity_type: string;
  entity_id: string;
  validation_id?: string | null;
  owner_user_id?: string | null;
  team_id?: string | null;
  payload: Record<string, unknown>;
  status: EventStatus;
  emitted_at: string;
  processed_at?: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
  attempts: number;
  next_retry_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface DeadLetterQueueItem {
  dead_letter_id: string;
  original_event_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  validation_id?: string | null;
  owner_user_id?: string | null;
  payload: Record<string, unknown>;
  failure_reason: string;
  attempts: number;
  status: DeadLetterStatus;
  next_retry_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface FailValidationRequest {
  reason: string;
  error_code?: string;
  metadata?: Record<string, unknown>;
}

export interface ValidationListFilters {
  status?: ValidationStatus;
  team_id?: string;
  search?: string;
  created_after?: string;
  created_before?: string;
  page?: number;
  page_size?: number;
}
