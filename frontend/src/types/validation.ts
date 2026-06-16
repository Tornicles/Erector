/**
 * Validation Session Types
 * Mirrors backend/models/validation.py
 */

import { ValidationStatus, GoalType, ValidationDepth, UserType, VerdictType } from './enums';

export interface ValidationProgress {
  total_engines: number;
  engines_completed: number;
  engines_failed: number;
  engines_fallback: number;
  percent_complete: number;
  current_stage?: string | null;
  live_message?: string | null;
}

export interface StructuredGoal {
  problem_claim?: string | null;
  target_user?: string | null;
  value_claim?: string | null;
  change_claim?: string | null;
  contradictions: string[];
  hidden_assumptions: string[];
  clarity_score?: number | null;
}

export interface EngineRunSummary {
  engine_name: string;
  status: string;
  score?: number | null;
  execution_time_ms?: number | null;
  fallback_used: boolean;
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
  structured_goal?: StructuredGoal | null;
  economic_stack_id?: string | null;
  current_score_id?: string | null;
  current_verdict?: VerdictType | null;
  selected_path_id?: string | null;
  current_framework_id?: string | null;
  current_climate_id?: string | null;
  launch_id?: string | null;
  active_simulation_id?: string | null;
  progress: ValidationProgress;
  engine_run_summary: EngineRunSummary[];
  blockers: string[];
  warnings: string[];
  failed_reason?: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at?: string | null;
  completed_at?: string | null;
  launched_at?: string | null;
  archived_at?: string | null;
}

export interface CreateValidationRequest {
  title?: string;
  raw_goal: string;
  goal_type?: GoalType;
  validation_depth?: ValidationDepth;
  founder_country?: string;
  customer_country?: string;
  industry?: string;
  currency?: string;
  idempotency_key?: string;
}

export interface UpdateValidationRequest {
  title?: string;
  raw_goal?: string;
  goal_type?: GoalType;
  target_launch_date?: string;
  budget_range?: string;
  success_definition?: string;
}
