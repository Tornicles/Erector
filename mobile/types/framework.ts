/**
 * Mobile — Reality Framework Types (summary for mobile UI)
 */

export interface FrameworkOrder {
  order_id: string;
  instruction: string;
  purpose: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  due_date?: string | null;
}

export interface FrameworkProject {
  project_id: string;
  name: string;
  objective: string;
  risk_level: string;
  orders: FrameworkOrder[];
}

export interface FrameworkProgram {
  program_id: string;
  name: string;
  purpose: string;
  projects: FrameworkProject[];
}

export interface RealityFrameworkSummary {
  framework_id: string;
  validation_id: string;
  version: number;
  goal?: string | null;
  purpose?: string | null;
  programs: FrameworkProgram[];
  status: 'draft' | 'active' | 'archived';
  created_at: string;
}
