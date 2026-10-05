/**
 * Question types — Prompt A4 (mobile)
 */

export type QuestionCategory =
  | 'basic' | 'industry' | 'economy' | 'team' | 'revenue'
  | 'evidence' | 'risk' | 'follow_up';

export interface QuestionDefinition {
  question_id: string;
  category: QuestionCategory;
  prompt: string;
  help_text?: string;
  required: boolean;
}

export interface QuestionBatch {
  validation_id: string;
  context_id: string;
  questions: QuestionDefinition[];
  required_count: number;
  answered_required_count: number;
  can_submit_context: boolean;
}

export interface GetQuestionsResponse {
  validation_id: string;
  context_id: string;
  batch: QuestionBatch;
  progress: Record<string, unknown>;
  blockers: Record<string, unknown>[];
  warnings: string[];
}
