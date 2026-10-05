/**
 * Context collection types — Prompt A4
 */

export type ContextStatus =
  | 'not_started' | 'in_progress' | 'missing_required_fields'
  | 'blocked_by_quality' | 'blocked_by_anti_gaming'
  | 'ready_for_stack' | 'context_collected';

export type AnswerQualityFlag =
  | 'vague' | 'inflated' | 'contradictory' | 'unrealistic_timeline'
  | 'unrealistic_budget' | 'missing_customer' | 'missing_evidence'
  | 'missing_legal_constraint' | 'unsupported_claim' | 'overconfident_language'
  | 'no_competitor_claim' | 'everyone_needs_this' | 'unclear_revenue_model'
  | 'weak_success_definition' | 'incomplete' | 'acceptable';

export interface StructuredGoal {
  problem_claim?: string;
  target_user?: string;
  value_claim?: string;
  change_claim?: string;
  success_claim?: string;
  revenue_claim?: string;
  timing_claim?: string;
  resource_claim?: string;
  contradictions: string[];
  hidden_assumptions: string[];
  unclear_terms: string[];
  clarity_score: number;
  interpretation_confidence: number;
  source: string;
}

export interface ContextAnswer {
  answer_id: string;
  question_id: string;
  category: string;
  value: unknown;
  normalized_value?: unknown;
  quality_flags: string[];
  submitted_at: string;
}

export interface ContextBlocker {
  blocker_id: string;
  blocker_type: string;
  message: string;
  resolution_action: string;
  blocks_engine_start: boolean;
  question_id?: string;
}

export interface EngineInputObject {
  validation_id: string;
  raw_goal: string;
  structured_goal: Record<string, unknown>;
  user_context: Record<string, unknown>;
  business_context: Record<string, unknown>;
  economy_context: Record<string, unknown>;
  team_context: Record<string, unknown>;
  revenue_context: Record<string, unknown>;
  evidence_context: Record<string, unknown>;
  risk_context: Record<string, unknown>;
  assumptions_seed: Record<string, unknown>[];
  dependencies_seed: Record<string, unknown>[];
  missing_context: string[];
  input_quality_score: number;
  integrity_score: number;
  readiness_for_engines: boolean;
  generated_at: string;
}

export interface ValidationContext {
  context_id: string;
  validation_id: string;
  owner_user_id: string;
  status: ContextStatus;
  raw_goal?: string;
  structured_goal?: StructuredGoal;
  answers: ContextAnswer[];
  missing_fields: string[];
  context_blockers: ContextBlocker[];
  context_warnings: string[];
  engine_input_object?: EngineInputObject;
  economic_stack_preview?: Record<string, unknown>;
}

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
  rejected_answers: Record<string, unknown>[];
  missing_required_fields: string[];
  blockers: ContextBlocker[];
  warnings: string[];
  next_questions: Record<string, unknown>[];
  can_proceed_to_engines: boolean;
  engine_input_object?: EngineInputObject;
}
