/**
 * Scoring Types
 * Mirrors backend/models/scoring.py — all 27 deterministic scores.
 */

export interface ScoreRationale {
  score_name: string;
  score_value: number;
  one_sentence_reason: string;
  primary_drivers: string[];
  penalties: string[];
  blockers_applied: string[];
}

export interface BlockerFlag {
  blocker_id: string;
  condition: string;
  triggered: boolean;
  severity: string;
  affected_scores: string[];
  verdict_effect?: string | null;
  explanation: string;
}

export interface ValidationScore {
  score_id: string;
  validation_id: string;
  owner_user_id: string;
  version: number;
  // All 27 scores
  reality_score: number;
  validation_confidence_score: number;
  market_score: number;
  customer_pain_score: number;
  execution_score: number;
  timing_score: number;
  competition_score: number;
  scalability_score: number;
  local_economy_score: number;
  resource_score: number;
  risk_score: number;
  trust_score: number;
  momentum_score: number;
  evidence_score: number;
  assumption_risk_score: number;
  dependency_risk_score: number;
  institutional_risk_score: number;
  narrative_risk_score: number;
  bias_risk_score: number;
  learning_score: number;
  commitment_score: number;
  systemic_risk_score: number;
  counterfactual_score: number;
  survivor_pattern_score: number;
  integrity_score: number;
  future_alignment_score: number;
  reliability_score: number;
  // Meta
  blocker_flags: BlockerFlag[];
  score_rationales: ScoreRationale[];
  scoring_formula_version: string;
  recalculation_reason?: string | null;
  created_at: string;
}

export const SCORE_FIELD_NAMES: (keyof ValidationScore)[] = [
  'reality_score', 'validation_confidence_score', 'market_score',
  'customer_pain_score', 'execution_score', 'timing_score',
  'competition_score', 'scalability_score', 'local_economy_score',
  'resource_score', 'risk_score', 'trust_score', 'momentum_score',
  'evidence_score', 'assumption_risk_score', 'dependency_risk_score',
  'institutional_risk_score', 'narrative_risk_score', 'bias_risk_score',
  'learning_score', 'commitment_score', 'systemic_risk_score',
  'counterfactual_score', 'survivor_pattern_score', 'integrity_score',
  'future_alignment_score', 'reliability_score',
];
