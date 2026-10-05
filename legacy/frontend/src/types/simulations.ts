/**
 * Simulation Types
 * Mirrors backend/models/simulations.py
 */

import { SimulationType, SimulationStatus, ScenarioType, RiskSeverity } from './enums';

export interface SimulationEvent {
  event_id: string;
  timestamp_offset: number;
  scenario: ScenarioType;
  title: string;
  description: string;
  event_type: string;
  severity: RiskSeverity;
  affected_object_ids: string[];
  score_delta: number;
  climate_delta: number;
  source_engine?: string | null;
  confidence: number;
}

export interface SimulationMilestone {
  milestone_id: string;
  title: string;
  day_offset: number;
  scenario: ScenarioType;
  success_condition: string;
  failure_condition?: string | null;
}

export interface CurvePoint {
  offset_days: number;
  value: number;
  scenario: ScenarioType;
}

export interface SimulationTimeline {
  horizon: string;
  custom_days?: number | null;
  events: SimulationEvent[];
  milestones: SimulationMilestone[];
  burnout_curve: CurvePoint[];
  revenue_probability_curve: CurvePoint[];
  failure_triggers: string[];
}

export interface ScenarioOutcome {
  scenario: ScenarioType;
  probability: number;
  final_score?: number | null;
  key_factors: string[];
  critical_path: string[];
  summary?: string | null;
}

export interface SimulationRun {
  simulation_id: string;
  validation_id: string;
  owner_user_id: string;
  simulation_type: SimulationType;
  scenario: ScenarioType;
  status: SimulationStatus;
  timeline?: SimulationTimeline | null;
  events: SimulationEvent[];
  best_case?: ScenarioOutcome | null;
  expected_case?: ScenarioOutcome | null;
  worst_case?: ScenarioOutcome | null;
  collapse_case?: ScenarioOutcome | null;
  logs_count: number;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

export interface SimulationSavepoint {
  savepoint_id: string;
  simulation_id: string;
  validation_id: string;
  owner_user_id: string;
  label: string;
  description?: string | null;
  parent_savepoint_id?: string | null;
  branch_name?: string | null;
  created_at: string;
}
