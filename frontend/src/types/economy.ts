/**
 * Economy Types
 * Mirrors backend/models/economy.py
 */

import { EconomyType, CivilizationDnaDimension } from './enums';

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

export interface Economy {
  economy_id: string;
  economy_type: EconomyType;
  name: string;
  display_name: string;
  description: string;
  core_characteristic: string;
  example_countries: string[];
  countries: string[];
  country_codes: string[];
  civilization_dna: CivilizationDnaProfile;
  resistance_patterns: string[];
  opportunity_patterns: string[];
  trust_mechanisms: string[];
  payment_patterns: string[];
  source_notes?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface CountryEconomyMapping {
  mapping_id: string;
  country_name: string;
  country_code: string;
  primary_economy_id: string;
  secondary_economy_ids: string[];
  confidence: number;
  notes?: string | null;
}

export interface EconomyStackLayer {
  economy_id: string;
  economy_type: EconomyType;
  country?: string | null;
  country_code?: string | null;
  layer_reason: string;
  confidence: number;
  dna_snapshot?: CivilizationDnaProfile | null;
  difficulty_multiplier: number;
}

export interface EconomicStack {
  stack_id: string;
  validation_id: string;
  owner_user_id: string;
  founder_economy?: EconomyStackLayer | null;
  customer_economy?: EconomyStackLayer | null;
  revenue_economy?: EconomyStackLayer | null;
  platform_economy?: EconomyStackLayer | null;
  talent_economy?: EconomyStackLayer | null;
  regulatory_economy?: EconomyStackLayer | null;
  primary_economy?: EconomyStackLayer | null;
  secondary_economies: EconomyStackLayer[];
  stack_confidence: number;
  difficulty_multipliers: Record<string, number>;
  created_at: string;
}
