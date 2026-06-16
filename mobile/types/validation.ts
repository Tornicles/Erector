/**
 * Mobile — Validation Types (subset for mobile UI)
 */

import { ValidationStatus, VerdictType, GoalType } from './enums';

export interface ValidationProgress {
  total_engines: number;
  engines_completed: number;
  engines_failed: number;
  percent_complete: number;
  current_stage?: string | null;
  live_message?: string | null;
}

export interface ValidationSession {
  validation_id: string;
  owner_user_id: string;
  status: ValidationStatus;
  title?: string | null;
  raw_goal?: string | null;
  goal_type: GoalType;
  current_verdict?: VerdictType | null;
  progress: ValidationProgress;
  last_activity_at: string;
  created_at: string;
}

export interface CreateValidationRequest {
  raw_goal: string;
  goal_type?: GoalType;
  founder_country?: string;
  customer_country?: string;
  industry?: string;
}
