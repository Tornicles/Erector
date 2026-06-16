/**
 * Question types — Prompt A4
 */

export type QuestionCategory =
  | 'basic' | 'industry' | 'economy' | 'team' | 'revenue'
  | 'evidence' | 'risk' | 'follow_up';

export type QuestionType =
  | 'text' | 'textarea' | 'number' | 'currency' | 'percentage' | 'date'
  | 'boolean' | 'single_select' | 'multi_select' | 'country' | 'industry'
  | 'file_reference' | 'evidence_reference';

export type QuestionPriority = 'required' | 'recommended' | 'optional' | 'conditional';

export type QuestionStatus =
  | 'pending' | 'answered' | 'skipped' | 'blocked' | 'invalid' | 'needs_clarification';

export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
  risk_hint?: string;
}

export interface BranchCondition {
  field: string;
  operator: string;
  value?: unknown;
  additional_conditions?: Record<string, unknown>[];
  explanation?: string;
}

export interface QuestionValidationRule {
  rule_type: string;
  parameters?: Record<string, unknown>;
  error_message: string;
  warning_message?: string;
}

export interface QuestionDefinition {
  question_id: string;
  category: QuestionCategory;
  question_type: QuestionType;
  priority: QuestionPriority;
  prompt: string;
  help_text?: string;
  placeholder?: string;
  options?: QuestionOption[];
  required: boolean;
  blocks_progress_if_missing?: boolean;
  order: number;
  tags?: string[];
}

export interface QuestionBatch {
  validation_id: string;
  context_id: string;
  questions: QuestionDefinition[];
  required_count: number;
  answered_required_count: number;
  next_batch_reason: string;
  can_submit_context: boolean;
}

export interface QuestionProgress {
  total_required_questions: number;
  answered_required_questions: number;
  total_answered: number;
  categories_completed: string[];
  categories_remaining: string[];
  percent_complete: number;
}

export interface GetQuestionsResponse {
  validation_id: string;
  context_id: string;
  batch: QuestionBatch;
  progress: QuestionProgress;
  blockers: Record<string, unknown>[];
  warnings: string[];
}
