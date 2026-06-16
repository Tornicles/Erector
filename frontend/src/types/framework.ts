/**
 * Reality Framework Types
 * Mirrors backend/models/frameworks.py
 */

export interface FrameworkOrder {
  order_id: string;
  project_id: string;
  instruction: string;
  purpose: string;
  time_estimate?: string | null;
  dependency_indicator?: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  owner?: string | null;
  due_date?: string | null;
}

export interface FrameworkProject {
  project_id: string;
  program_id: string;
  name: string;
  objective: string;
  deliverables: string[];
  owner?: string | null;
  contributors: string[];
  timeline?: string | null;
  metrics: string[];
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  dependencies: string[];
  orders: FrameworkOrder[];
}

export interface FrameworkProgram {
  program_id: string;
  name: string;
  purpose: string;
  owner?: string | null;
  projects: FrameworkProject[];
  metrics: string[];
  risks: string[];
  dependencies: string[];
}

export interface IndividualLayers {
  skills_layer: {
    current_skills: string[];
    skill_gaps: string[];
    learning_priority: string[];
  };
  habits_layer: {
    productive_habits: string[];
    destructive_habits: string[];
    habit_changes_required: string[];
  };
  capacity_layer: {
    available_hours_per_week?: number | null;
    capacity_constraints: string[];
  };
  personal_constraints_layer: {
    financial_runway_months?: number | null;
    location_constraints: string[];
    time_constraints: string[];
    legal_constraints: string[];
  };
  energy_management_layer: {
    burnout_risk: string;
    recovery_protocols: string[];
  };
  learning_path_layer: {
    recommended_resources: string[];
    milestones: string[];
    estimated_days?: number | null;
  };
}

export interface TeamStructure {
  departments: Array<{
    department_id: string;
    name: string;
    head_user_id?: string | null;
    members: string[];
    responsibilities: string[];
  }>;
  governance?: string | null;
  communication_rules: string[];
  escalation_structure: string[];
  hiring_sequence: string[];
  team_dependencies: string[];
}

export interface RealityFramework {
  framework_id: string;
  validation_id: string;
  owner_user_id: string;
  team_id?: string | null;
  version: number;
  path_selected?: string | null;
  identity?: string | null;
  goal?: string | null;
  purpose?: string | null;
  reality_laws: string[];
  policies: string[];
  constraints: string[];
  assumptions: string[];
  dependencies: string[];
  risks: string[];
  opportunities: string[];
  programs: FrameworkProgram[];
  projects: FrameworkProject[];
  orders: FrameworkOrder[];
  team_structure: TeamStructure;
  individual_layers: IndividualLayers;
  business_climate_id?: string | null;
  ideal_scene?: string | null;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
  updated_at?: string | null;
}
