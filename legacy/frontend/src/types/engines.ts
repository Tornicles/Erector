/**
 * Engine Output Types
 * Mirrors backend/models/engines.py
 */

import { EngineName, EngineStatus, RiskSeverity } from './enums';

export interface Source {
  source_id: string;
  source_type: string;
  title: string;
  url?: string | null;
  citation?: string | null;
  freshness?: string | null;
  reliability_score?: number | null;
  accessed_at?: string | null;
}

export interface Risk {
  risk_id: string;
  name: string;
  category: string;
  severity: RiskSeverity;
  probability: number;
  impact: number;
  timeframe?: string | null;
  description: string;
  mitigation?: string | null;
  cascade_potential: boolean;
  source_engine?: string | null;
  evidence_refs: string[];
}

export interface Opportunity {
  opportunity_id: string;
  name: string;
  category: string;
  size_score: number;
  timing?: string | null;
  effort_required?: string | null;
  competition_level?: string | null;
  expiration_window?: string | null;
  capture_action?: string | null;
  source_engine?: string | null;
  evidence_refs: string[];
}

export interface EngineOutput {
  engine_output_id: string;
  validation_id: string;
  owner_user_id: string;
  engine_name: EngineName;
  engine_number: number;
  status: EngineStatus;
  score: number;
  confidence: number;
  findings: string[];
  risks: Risk[];
  opportunities: Opportunity[];
  assumptions_created: string[];
  dependencies_created: string[];
  recommendations: string[];
  sources: Source[];
  economy_context?: Record<string, unknown> | null;
  fallback_used: boolean;
  fallback_reason?: string | null;
  execution_time_ms: number;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  created_at: string;
}
