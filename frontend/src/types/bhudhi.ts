export type BhudhiMode = 'interpret' | 'structure' | 'draft' | 'explain' | 'suggest';

export type BhudhiStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'fallback'
  | 'rate_limited'
  | 'budget_exceeded';

export type BhudhiTriggerType =
  | 'goal_decomposition'
  | 'assumption_extraction'
  | 'framework_language'
  | 'score_rationale'
  | 'path_alternatives'
  | 'clarification_question_generation'
  | 'report_language'
  | 'user_explanation'
  | 'context_summary'
  | 'evidence_summary';

export type BhudhiSource =
  | 'context_collection'
  | 'validation_engine'
  | 'scoring_engine'
  | 'framework_builder'
  | 'report_generator'
  | 'path_system'
  | 'user_request'
  | 'test_harness'
  | 'system';

export type BhudhiForbiddenAction =
  | 'decide'
  | 'calculate'
  | 'override'
  | 'score'
  | 'verdict'
  | 'alter_economy_profile'
  | 'determine_climate'
  | 'approve_assumption'
  | 'reject_assumption'
  | 'change_validation_state'
  | 'change_dependency_status'
  | 'mark_launch_ready';

export type BhudhiRiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export type PromptInjectionRiskType =
  | 'instruction_override'
  | 'system_prompt_request'
  | 'secret_extraction'
  | 'tool_abuse_request'
  | 'authority_escalation'
  | 'output_schema_evasion'
  | 'hidden_directive'
  | 'malicious_payload'
  | 'role_confusion'
  | 'jailbreak_attempt';

export interface BhudhiAuthorityContext {
  allowed_mode: BhudhiMode;
  forbidden_actions: BhudhiForbiddenAction[];
  can_modify_state: boolean;
  can_write_database: boolean;
  can_generate_user_text: boolean;
  can_generate_structured_output: boolean;
  max_risk_level: BhudhiRiskLevel;
}

export interface BhudhiTrigger {
  trigger_id?: string;
  validation_id?: string | null;
  owner_user_id?: string | null;
  team_id?: string | null;
  trigger_type: BhudhiTriggerType;
  source: BhudhiSource;
  mode: BhudhiMode;
  input_payload: Record<string, unknown>;
  requested_output_schema?: string | null;
  authority_context?: BhudhiAuthorityContext | null;
  priority?: string;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BhudhiResponse {
  request_id: string;
  validation_id?: string | null;
  mode: BhudhiMode;
  trigger_type: BhudhiTriggerType;
  status: BhudhiStatus;
  output?: Record<string, unknown> | null;
  validated_output?: Record<string, unknown> | null;
  rejected_reason?: string | null;
  fallback_used: boolean;
  fallback_reason?: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  latency_ms: number;
}

