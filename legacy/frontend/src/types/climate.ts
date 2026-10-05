/**
 * Business Climate Types
 * Mirrors backend/models/climates.py
 */

import { ClimateState } from './enums';

export interface ClimateFormula {
  formula_id: string;
  condition: string;
  action: string;
  expected_outcome: string;
  time_to_effect_days?: number | null;
}

export interface ClimateMetricsSnapshot {
  reality_score?: number | null;
  execution_score?: number | null;
  resource_score?: number | null;
  trust_score?: number | null;
  momentum_score?: number | null;
  risk_score?: number | null;
  snapshotted_at: string;
}

export interface BusinessClimate {
  climate_id: string;
  framework_id?: string | null;
  validation_id: string;
  owner_user_id: string;
  current_climate: ClimateState;
  reason?: string | null;
  next_climate?: ClimateState | null;
  transition_probability?: number | null;
  transition_timeline?: string | null;
  forecast_30d?: ClimateState | null;
  forecast_90d?: ClimateState | null;
  forecast_180d?: ClimateState | null;
  forecast_365d?: ClimateState | null;
  warnings: string[];
  recovery_formulas: ClimateFormula[];
  advancement_formulas: ClimateFormula[];
  learning_explanation?: string | null;
  metrics_snapshot?: ClimateMetricsSnapshot | null;
  created_at: string;
  updated_at?: string | null;
}
