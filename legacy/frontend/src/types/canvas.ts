/**
 * Canvas and Reality Playground Types
 * Mirrors backend/models/canvas.py
 */

import { SimulationObjectType, SimulationObjectState, FitColor } from './enums';

export interface Position { x: number; y: number; z: number; }
export interface Dimensions { width: number; height: number; }
export interface CanvasViewport { x: number; y: number; zoom: number; width: number; height: number; }

export interface VisualConfig {
  color?: string | null;
  icon?: string | null;
  shape: string;
  opacity: number;
  glow: boolean;
}

export interface CompatibilityRating {
  target_object_id: string;
  score: number;
  fit_color: FitColor;
  reason?: string | null;
}

export interface SimulationObject {
  object_id: string;
  object_type: SimulationObjectType;
  label: string;
  state: SimulationObjectState;
  position: Position;
  dimensions: Dimensions;
  weight: number;
  properties: Record<string, unknown>;
  cost?: number | null;
  risk_level?: number | null;
  impact_score?: number | null;
  dependency_ids: string[];
  compatibility_ratings: CompatibilityRating[];
  climate_effect?: number | null;
  failure_impact?: string | null;
  visual_config: VisualConfig;
}

export interface ObjectRelationship {
  relationship_id: string;
  from_object_id: string;
  to_object_id: string;
  relationship_type: string;
  strength: number;
  direction: 'unidirectional' | 'bidirectional';
  active: boolean;
  consequence?: string | null;
}

export interface BranchNode {
  node_id: string;
  level: 1 | 2 | 3;
  color: FitColor;
  title: string;
  one_sentence_description: string;
  probability: number;
  impact: number;
  child_node_ids: string[];
  full_detail?: string | null;
  education_card?: string | null;
}

export interface BranchPreview {
  branch_id: string;
  source_object_id: string;
  target_position?: Position | null;
  fit_score: number;
  fit_color: FitColor;
  first_order_nodes: BranchNode[];
  second_order_nodes: BranchNode[];
  third_order_nodes: BranchNode[];
  generated_from_engine?: string | null;
  precomputed_at: string;
}

export interface CommandCenterState {
  reality_score: number;
  business_climate?: string | null;
  risk_heat: number;
  opportunity_heat: number;
  resource_load: number;
  market_resistance: number;
  execution_readiness: number;
}

export interface CanvasState {
  canvas_id: string;
  validation_id: string;
  simulation_id?: string | null;
  viewport: CanvasViewport;
  objects: SimulationObject[];
  relationships: ObjectRelationship[];
  economy_zones: unknown[];
  active_scenario?: string | null;
  active_timeline_position: number;
  selected_object_id?: string | null;
  branch_previews_loaded: boolean;
  updated_at: string;
}
