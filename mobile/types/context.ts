/**
 * Context types — Prompt A4 (mobile)
 */

export type ContextStatus =
  | 'not_started' | 'in_progress' | 'missing_required_fields'
  | 'blocked_by_quality' | 'blocked_by_anti_gaming'
  | 'ready_for_stack' | 'context_collected';

export interface ContextAnswerInput {
  question_id: string;
  value: unknown;
  notes?: string;
}

export interface ContextSubmissionRequest {
  answers: ContextAnswerInput[];
  submit_final?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ContextSubmissionResponse {
  validation_id: string;
  context_id: string;
  context_status: ContextStatus;
  accepted_answers: string[];
  blockers: Record<string, unknown>[];
  warnings: string[];
  can_proceed_to_engines: boolean;
  engine_input_object?: Record<string, unknown>;
}

export interface ValidationContext {
  context_id: string;
  validation_id: string;
  status: ContextStatus;
  raw_goal?: string;
  answers: Record<string, unknown>[];
  missing_fields: string[];
  context_blockers: Record<string, unknown>[];
  engine_input_object?: Record<string, unknown>;
}
