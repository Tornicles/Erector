import { authenticatedRequest } from './api';
import type { Database } from '../types/database';

/**
 * Prompt 9A surface: the dependency graph, the impact engine and stale artifacts.
 *
 * Two things this client must never blur together. First, computing an impact and applying one
 * are different requests: `preview` records an analysis and changes nothing, and `apply` needs
 * that analysis id plus an explicit confirmation and one of the three constitutional
 * propagation choices. Second, an `inferred` edge is a proposal carrying its own rationale, so
 * it is always reported as a POTENTIAL dependency rather than as canonical certainty.
 */

export type DependencyStrength = Database['tonde']['Enums']['dependency_strength'];
export type DependencyOrigin = Database['tonde']['Enums']['dependency_origin'];
export type ImpactClass = Database['tonde']['Enums']['impact_class'];
export type ImpactMode = Database['tonde']['Enums']['impact_mode'];
export type ArtifactKind = Database['tonde']['Enums']['artifact_kind'];
export type StaleState = Database['tonde']['Enums']['stale_state'];

/** The three propagation choices, in the order a creator should read them. */
export const PROPAGATION_MODES: Array<Exclude<ImpactMode, 'preview'>> = ['update_all', 'review_changes', 'change_only_this'];

export type ImpactModeOption = { mode: ImpactMode; label: string; description: string };

export type ImpactModesPayload = { modes: ImpactModeOption[]; rule: string; direction: string };

export type DependencyNode = {
  object_id: string; level: string; label: string; depth: number; relation: string;
  classification: ImpactClass; classification_label?: string; level_label?: string; relation_label?: string;
  status?: 'Locked' | 'Approved' | 'Open' | string;
  locked: boolean; approved: boolean; revision: number | null;
};

export type DependencyEdgeRow = {
  source_object_id: string; target_object_id: string; relation: string; strength: DependencyStrength;
  origin: DependencyOrigin; reason: string; affected_fields: string[]; active: boolean;
  note?: string | null; evidence?: Record<string, unknown>; revision: number; updated_at?: string | null;
  source_label?: string | null; target_label?: string | null;
  relation_label?: string; strength_label?: string; origin_label?: string; state_label?: string;
};

export type DependencyGraph = {
  root_object_id: string; root_kind: string; root_label: string;
  direction: 'forward' | 'reverse'; direction_label?: string; depth: number;
  nodes: DependencyNode[]; edges: DependencyEdgeRow[];
  total: number; total_label?: string; truncated: boolean; cycles_safe: boolean; note: string;
};

export type DependencyEdgeList = {
  object_id: string; items: DependencyEdgeRow[]; limit: number; offset: number; note: string;
};

export type ImpactCounts = {
  direct: number; downstream: number; potential: number; locked: number; approved: number;
  by_level: Record<string, number>; total: number;
};

export type ImpactPreview = {
  analysis_id: string; root_object_id: string; root_kind: string; root_label: string;
  root_revision: number; structure_revision: number; depth: number;
  nodes: DependencyNode[]; counts: ImpactCounts; locked_ids: string[]; approved_ids: string[];
  explanation: string; applied: false; requires_confirmation: true;
  summary_line: string; modes: ImpactModeOption[]; total_label: string; rule: string;
};

export type ImpactApplyResult = {
  analysis_id: string; mode: Exclude<ImpactMode, 'preview'>; mode_label: string; applied: true;
  marked: number; direct_count: number; downstream_count: number; unresolved_count: number;
  locked_skipped: Array<{ object_id: string; label: string; reason: string; reason_label?: string }>;
  requiring_review: Array<{ object_id: string; label: string; revision: number; reason: string; reason_label?: string }>;
  note: string; summary_line: string;
};

export type ImpactHistoryRow = {
  analysis_id: string; root_object_id: string; root_label: string; root_kind: string;
  root_revision: number; structure_revision: number; mode: ImpactMode; applied_mode: ImpactMode | null;
  applied_at: string | null; counts: Partial<ImpactCounts>; explanation: string; unresolved_count: number;
  created_at: string; mode_label?: string; applied_mode_label?: string; affected_label?: string;
};

export type ImpactHistory = {
  items: ImpactHistoryRow[]; total: number; limit: number; offset: number; truncated: boolean; note: string;
};

export type StaleMarker = {
  artifact_id: string; artifact_kind: ArtifactKind; artifact_ref: string | null;
  object_id: string; object_label: string | null; object_kind: string | null;
  state: StaleState; reason: string;
  caused_by_object_id: string | null; caused_by_label: string | null; caused_by_revision: number | null;
  source_revision: number | null; current_revision: number | null;
  resolved_at: string | null; created_at: string;
  artifact_kind_label?: string; state_label?: string;
};

export type StaleMarkerList = {
  items: StaleMarker[]; total: number; open: number; limit: number; offset: number;
  note: string; open_label?: string;
};

function base(workspaceId: string, productionId: string) {
  return `/api/v1/workspaces/${workspaceId}/productions/${productionId}/intelligence`;
}

export const productionIntelligenceService = {
  async modes(workspaceId: string, productionId: string): Promise<ImpactModesPayload> {
    return authenticatedRequest<ImpactModesPayload>(`${base(workspaceId, productionId)}/modes`);
  },

  /** Derive the edges the Production already knows. No AI inference is involved. */
  async sync(workspaceId: string, productionId: string): Promise<{
    production_id: string; edges_considered: number; note: string;
  }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/dependencies/sync`, { method: 'POST' });
  },

  async declareDependency(workspaceId: string, productionId: string, input: {
    sourceObjectId: string; targetObjectId: string; relation: string; strength?: DependencyStrength;
    origin?: DependencyOrigin; reason?: string; affectedFields?: string[]; evidence?: Record<string, unknown>;
  }) {
    return authenticatedRequest(`${base(workspaceId, productionId)}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({
        source_object_id: input.sourceObjectId, target_object_id: input.targetObjectId,
        relation: input.relation, strength: input.strength ?? 'soft', origin: input.origin ?? 'explicit',
        reason: input.reason ?? '', affected_fields: input.affectedFields ?? [], evidence: input.evidence ?? {},
      }),
    });
  },

  /** Deactivate or reactivate edges. The relationship row stays readable as history. */
  async setDependenciesActive(workspaceId: string, productionId: string, input: {
    edgeIds: string[]; active: boolean; note?: string;
  }) {
    return authenticatedRequest<{ changed: number; active: boolean; note: string }>(
      `${base(workspaceId, productionId)}/dependencies/active`, {
        method: 'PATCH',
        body: JSON.stringify({ edge_ids: input.edgeIds, active: input.active, note: input.note ?? '' }),
      });
  },

  async dependencies(workspaceId: string, productionId: string, objectId: string, limit = 100, offset = 0): Promise<DependencyEdgeList> {
    const params = new URLSearchParams({ object_id: objectId, limit: String(limit), offset: String(offset) });
    return authenticatedRequest<DependencyEdgeList>(`${base(workspaceId, productionId)}/dependencies?${params}`);
  },

  async graph(workspaceId: string, productionId: string, objectId: string, options: {
    direction?: 'forward' | 'reverse'; depth?: number; limit?: number;
  } = {}): Promise<DependencyGraph> {
    const params = new URLSearchParams({
      object_id: objectId, direction: options.direction ?? 'forward',
      depth: String(options.depth ?? 2), limit: String(options.limit ?? 200),
    });
    return authenticatedRequest<DependencyGraph>(`${base(workspaceId, productionId)}/graph?${params}`);
  },

  /** Compute and record an impact. Nothing in the Production changes. */
  async preview(workspaceId: string, productionId: string, objectId: string, depth = 2, limit = 200): Promise<ImpactPreview> {
    return authenticatedRequest<ImpactPreview>(`${base(workspaceId, productionId)}/impact/preview`, {
      method: 'POST', body: JSON.stringify({ object_id: objectId, depth, limit }),
    });
  },

  /**
   * Apply a previewed impact. `confirm` is the creator's authority and `selectedIds` carries the
   * REVIEW CHANGES selection, so neither a preview id alone nor an empty selection can apply.
   */
  async apply(workspaceId: string, productionId: string, input: {
    analysisId: string; mode: Exclude<ImpactMode, 'preview'>; selectedIds?: string[];
    expectedRootRevision?: number | null; note?: string;
  }): Promise<ImpactApplyResult> {
    return authenticatedRequest<ImpactApplyResult>(`${base(workspaceId, productionId)}/impact/apply`, {
      method: 'POST',
      body: JSON.stringify({
        analysis_id: input.analysisId, mode: input.mode, selected_ids: input.selectedIds ?? [],
        expected_root_revision: input.expectedRootRevision ?? null, note: input.note ?? '', confirm: true,
      }),
    });
  },

  async history(workspaceId: string, productionId: string, limit = 20, offset = 0): Promise<ImpactHistory> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return authenticatedRequest<ImpactHistory>(`${base(workspaceId, productionId)}/impact/history?${params}`);
  },

  async stale(workspaceId: string, productionId: string, state?: StaleState | null, limit = 100, offset = 0): Promise<StaleMarkerList> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (state) params.set('state', state);
    return authenticatedRequest<StaleMarkerList>(`${base(workspaceId, productionId)}/stale?${params}`);
  },

  /** Record that an artifact may no longer match its source. The artifact is not rewritten. */
  async markStale(workspaceId: string, productionId: string, input: {
    objectId: string; artifactKind: ArtifactKind; reason: string; reference?: string | null;
  }) {
    return authenticatedRequest<{ artifact_id: string; state: StaleState; note: string }>(
      `${base(workspaceId, productionId)}/stale`, {
        method: 'POST',
        body: JSON.stringify({
          object_id: input.objectId, artifact_kind: input.artifactKind,
          reason: input.reason, reference: input.reference ?? null,
        }),
      });
  },

  async resolveStale(workspaceId: string, productionId: string, artifactId: string, note = '') {
    return authenticatedRequest<{ artifact_id: string; state: StaleState; note: string }>(
      `${base(workspaceId, productionId)}/stale/${artifactId}/resolve`, {
        method: 'POST', body: JSON.stringify({ note }),
      });
  },
};
