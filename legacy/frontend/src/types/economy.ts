/**
 * Economy Types — Prompt A2
 * Mirrors backend/app/models/economy.py
 */

import { EconomyType } from './enums';

// ── Civilization DNA ──────────────────────────────────────────────────────────

export interface CivilizationDnaProfile {
  trust_index: number;
  authority_index: number;
  corruption_index: number;
  innovation_index: number;
  digital_adoption_index: number;
  education_index: number;
  social_mobility_index: number;
  bureaucracy_index: number;
  stability_index: number;
  information_freedom_index: number;
  risk_tolerance_index: number;
  community_dependence_index: number;
  crime_pressure_index: number;
  payment_reliability_index: number;
  infrastructure_reliability_index: number;
  institutional_strength_index: number;
  media_volatility_index: number;
  legal_predictability_index: number;
  labor_reliability_index: number;
  crisis_exposure_index: number;
  adoption_friction_index: number;
  social_proof_dependence_index: number;
  reputation_fragility_index: number;
  informal_network_strength_index: number;
  future_change_velocity_index: number;
}

// ── Pattern ───────────────────────────────────────────────────────────────────

export interface EconomyPattern {
  name: string;
  description: string;
  severity_or_strength: 'low' | 'medium' | 'high' | 'critical';
  examples: string[];
  affected_engines: string[];
  notes?: string | null;
}

// ── Full Economy ──────────────────────────────────────────────────────────────

export interface Economy {
  economy_id: string;
  economy_type: EconomyType;
  name: string;
  display_name: string;
  short_description: string;
  long_description: string;
  core_characteristic: string;
  example_countries: string[];
  countries: string[];
  civilization_dna: CivilizationDnaProfile;
  resistance_patterns: EconomyPattern[];
  opportunity_patterns: EconomyPattern[];
  trust_mechanisms: EconomyPattern[];
  payment_patterns: EconomyPattern[];
  institutional_patterns: EconomyPattern[];
  narrative_patterns: EconomyPattern[];
  platform_patterns: EconomyPattern[];
  regulatory_patterns: EconomyPattern[];
  customer_behavior_patterns: EconomyPattern[];
  business_model_fit: Record<string, string>;
  common_failure_modes: EconomyPattern[];
  common_success_patterns: EconomyPattern[];
  recommended_entry_strategies: EconomyPattern[];
  source_notes?: string | null;
  schema_version: string;
  created_at?: string | null;
  updated_at?: string | null;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export interface EconomySummary {
  economy_id: string;
  economy_type: EconomyType;
  display_name: string;
  short_description: string;
  core_characteristic: string;
  example_countries: string[];
  top_dna_signals: Record<string, number>;
  primary_resistance_patterns: string[];
  primary_opportunity_patterns: string[];
  dna_average: number;
}

// ── Country Mapping ───────────────────────────────────────────────────────────

export interface CountryEconomyMapping {
  mapping_id: string;
  country_name: string;
  country_code: string;
  country_code_alpha3?: string | null;
  aliases: string[];
  primary_economy_id: string;
  primary_economy_type: EconomyType;
  secondary_economy_ids: string[];
  secondary_economy_types: EconomyType[];
  confidence: number;
  notes?: string | null;
}

// ── Resolution ────────────────────────────────────────────────────────────────

export interface EconomyResolveResponse {
  country_name: string;
  country_code: string;
  primary_economy: EconomySummary;
  secondary_economies: EconomySummary[];
  confidence: number;
  reasoning: string;
}

// ── Comparison ────────────────────────────────────────────────────────────────

export interface EconomyCompareRequest {
  goal_summary: string;
  industry: string;
  business_model: string;
  target_customer: string;
  economies_to_compare?: string[];
  founder_country?: string | null;
  customer_country?: string | null;
  revenue_model?: string | null;
  platform?: string | null;
  budget_range?: string | null;
}

export interface EconomyComparisonResult {
  economy_id: string;
  economy_type: EconomyType;
  display_name: string;
  fit_score: number;
  dimension_scores: Record<string, number>;
  advantages: string[];
  disadvantages: string[];
  major_risks: string[];
  major_opportunities: string[];
  recommended_entry_strategy: string;
  difficulty_multiplier: number;
}

export interface EconomyCompareResponse {
  goal_summary: string;
  ranked_results: EconomyComparisonResult[];
  best_fit_economy_id: string;
  worst_fit_economy_id: string;
  comparison_notes: string;
}

// ── Economic Stack ────────────────────────────────────────────────────────────

export interface DifficultyMultipliers {
  execution_difficulty: number;
  trust_difficulty: number;
  payment_difficulty: number;
  infrastructure_difficulty: number;
  regulatory_difficulty: number;
  narrative_volatility: number;
  adoption_friction: number;
  crisis_exposure: number;
  talent_reliability: number;
}

export interface EconomicStackLayer {
  layer_type: string;
  economy_id: string;
  economy_type: EconomyType;
  country?: string | null;
  country_code?: string | null;
  layer_reason: string;
  confidence: number;
  dna_snapshot?: CivilizationDnaProfile | null;
  difficulty_multiplier: number;
  notes?: string | null;
}

export interface EconomicStack {
  stack_id: string;
  validation_id?: string | null;
  founder_economy?: EconomicStackLayer | null;
  customer_economy?: EconomicStackLayer | null;
  revenue_economy?: EconomicStackLayer | null;
  platform_economy?: EconomicStackLayer | null;
  talent_economy?: EconomicStackLayer | null;
  regulatory_economy?: EconomicStackLayer | null;
  primary_economy?: EconomicStackLayer | null;
  secondary_economies: EconomicStackLayer[];
  stack_confidence: number;
  difficulty_multipliers?: DifficultyMultipliers | null;
  resolved_from?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface EconomicStackBuildRequest {
  founder_country: string;
  customer_country: string;
  validation_id?: string | null;
  revenue_country?: string | null;
  platform?: string | null;
  revenue_model?: string | null;
  team_locations?: string[];
  regulatory_country?: string | null;
  industry?: string | null;
  business_model?: string | null;
  target_customer?: string | null;
}
