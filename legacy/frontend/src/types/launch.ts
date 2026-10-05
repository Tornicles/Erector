/**
 * Torgima Launch Types
 * Mirrors backend/models/launch.py
 */

import { TorgimaStatus } from './enums';

export interface TorgimaLaunchPayload {
  erector_validation_id: string;
  erector_version: string;
  launched_at: string;
  user_email: string;
  goal: string;
  purpose: string;
  reality_score: number;
  validation_confidence: number;
  verdict: string;
  economy_context: Record<string, unknown>;
  business_climate: string;
  reality_framework: Record<string, unknown>;
  assumptions: Record<string, unknown>[];
  dependencies: Record<string, unknown>[];
  risks: Record<string, unknown>[];
  team_structure: Record<string, unknown>;
  launch_package: Record<string, unknown>;
}

export interface LaunchPackage {
  launch_id: string;
  validation_id: string;
  owner_user_id: string;
  framework_id?: string | null;
  payload?: TorgimaLaunchPayload | null;
  torgima_status: TorgimaStatus;
  torgima_workspace_id?: string | null;
  sent_at?: string | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
  retry_count: number;
  last_retry_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface InitiateLaunchRequest {
  validation_id: string;
  framework_id?: string;
}
