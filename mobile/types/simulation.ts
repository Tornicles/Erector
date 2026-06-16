/**
 * Mobile — Simulation Types (subset for mobile UI)
 */

import { SimulationType, SimulationStatus, ScenarioType } from './enums';

export interface SimulationRun {
  simulation_id: string;
  validation_id: string;
  simulation_type: SimulationType;
  scenario: ScenarioType;
  status: SimulationStatus;
  logs_count: number;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

export interface SimulationSavepoint {
  savepoint_id: string;
  simulation_id: string;
  label: string;
  description?: string | null;
  branch_name?: string | null;
  created_at: string;
}
