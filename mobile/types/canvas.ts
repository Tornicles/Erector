/**
 * Mobile — Canvas Types (subset for mobile touch canvas)
 */

import { SimulationObjectType, SimulationObjectState, FitColor } from './enums';

export interface Position { x: number; y: number; }
export interface Dimensions { width: number; height: number; }

export interface SimulationObject {
  object_id: string;
  object_type: SimulationObjectType;
  label: string;
  state: SimulationObjectState;
  position: Position;
  dimensions: Dimensions;
  weight: number;
  cost?: number | null;
  risk_level?: number | null;
}

export interface BranchNode {
  node_id: string;
  level: 1 | 2 | 3;
  color: FitColor;
  title: string;
  one_sentence_description: string;
  probability: number;
  impact: number;
}

export interface BranchPreview {
  branch_id: string;
  source_object_id: string;
  fit_score: number;
  fit_color: FitColor;
  first_order_nodes: BranchNode[];
  second_order_nodes: BranchNode[];
  third_order_nodes: BranchNode[];
}

export interface CommandCenterState {
  reality_score: number;
  business_climate?: string | null;
  risk_heat: number;
  opportunity_heat: number;
  execution_readiness: number;
}
