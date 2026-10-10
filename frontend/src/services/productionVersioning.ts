import { authenticatedRequest } from './api';
import type { Database } from '../types/database';

/**
 * Prompt 9D surface: version history, creative branches, restore and reviewed merges.
 *
 * Five things this client must never blur together. A version is history: it is immutable, pinned
 * and never rewritten, and a restore creates a NEW current revision instead of rewinding. A compare
 * shows the meaningful creative fields that differ, not a raw JSON diff. A branch is an object-level
 * alternative, not a duplicate Production, and its edits change nothing on the mainline until an
 * explicit merge. A merge is a proposal: a conflict is shown rather than resolved automatically, and
 * `merged` is never `approved`. And accepting a merge propagates through the dependency-aware impact
 * engine, so approved content is flagged for review instead of being rewritten silently.
 */

export type BranchState = Database['tonde']['Enums']['branch_state'];
export type BranchChangeState = Database['tonde']['Enums']['branch_change_state'];
export type MergeState = Database['tonde']['Enums']['merge_state'];

export type BranchScope = 'story' | 'script' | 'act' | 'sequence' | 'scene' | 'shot' | 'execution_plan' | 'asset';
export type PropagationMode = 'update_all' | 'review_changes' | 'change_only_this';

export const BRANCH_SCOPES: BranchScope[] = ['story', 'script', 'act', 'sequence', 'scene', 'shot',
  'execution_plan', 'asset'];

export const PROPAGATION_MODES: PropagationMode[] = ['update_all', 'review_changes', 'change_only_this'];

/**
 * The fields a branch change may set, by object kind. The database holds the same whitelist, so the
 * surface can explain a refusal instead of offering a field that will be rejected.
 */
export const BRANCHABLE_FIELDS: Record<string, Array<{ field: string; label: string }>> = {
  creative_document: [{ field: 'title', label: 'Title' }, { field: 'content', label: 'Content' }],
  scene: [{ field: 'title', label: 'Title' }, { field: 'description', label: 'Description' },
    { field: 'purpose', label: 'Purpose' }, { field: 'planned_duration_ms', label: 'Planned duration' }],
  shot: [{ field: 'title', label: 'Title' }, { field: 'description', label: 'Description' },
    { field: 'action', label: 'Action' }, { field: 'purpose', label: 'Purpose' },
    { field: 'subject', label: 'Subject' }, { field: 'planned_duration_ms', label: 'Planned duration' }],
  execution_plan: [{ field: 'shot_size', label: 'Shot size' }, { field: 'movement', label: 'Movement' },
    { field: 'framing', label: 'Framing' }, { field: 'composition', label: 'Composition' },
    { field: 'camera_position', label: 'Camera position' }, { field: 'camera_height', label: 'Camera height' },
    { field: 'camera_angle', label: 'Camera angle' }, { field: 'lighting_intent', label: 'Lighting intent' },
    { field: 'plan_metadata', label: 'Plan metadata' }],
  asset: [{ field: 'name', label: 'Name' }, { field: 'description', label: 'Description' },
    { field: 'search_metadata', label: 'Search metadata' },
    { field: 'consistency_metadata', label: 'Consistency metadata' }],
};

export type VersioningVocabulary = {
  scopes: Array<{ scope: BranchScope; label: string }>;
  branch_states: Array<{ state: BranchState; label: string }>;
  change_states: Array<{ state: BranchChangeState; label: string }>;
  merge_states: Array<{ state: MergeState; label: string }>;
  source_actions: Array<{ action: string; label: string }>;
  propagation_modes: Array<{ mode: PropagationMode; label: string }>;
  branchable_kinds: Array<{ kind: string; label: string; fields: Array<{ field: string; label: string }> }>;
  rule: string;
  limitation: string;
};

export type VersionEntry = {
  version_id: string; object_id: string; revision: number; branch: string;
  parent_version_id: string | null; actor_type: string; actor_user_id: string | null;
  source_action: string; created_at: string; is_current: boolean;
  source_action_label?: string; current_line?: string;
};

export type VersionList = {
  object_id: string; object_kind: string; object_label: string; branch: string; current_revision: number;
  items: VersionEntry[]; total: number; limit: number; offset: number; truncated: boolean; note: string;
};

export type VersionDetail = VersionEntry & {
  object_kind: string; object_label: string; snapshot: Record<string, unknown>;
  note: string; current_line?: string; source_action_label?: string;
};

export type VersionComparison = {
  object_id: string; object_kind: string; object_label: string;
  left_version_id: string; left_revision: number; right_version_id: string; right_revision: number;
  changes: Array<{ field: string; label: string; before: unknown; after: unknown }>;
  change_count: number; note: string; limitation?: string;
};

export type Branch = {
  branch_id: string; name: string; scope: BranchScope; scope_object_id: string;
  scope_object_label?: string | null; source_version_id: string | null; source_revision: number | null;
  state: BranchState; reason: string; merged_at: string | null; merged_proposal_id: string | null;
  changes?: number; created_at: string; updated_at?: string;
  state_label?: string; scope_label?: string; changes_line?: string;
};

export type BranchList = {
  items: Branch[]; total: number; limit: number; offset: number; truncated: boolean; rule?: string;
};

export type BranchChange = {
  change_id: string; target_object_id: string; target_label?: string | null; target_kind?: string | null;
  base_version_id: string | null; base_revision: number | null;
  patch: Record<string, unknown>; changed_fields: string[]; note: string;
  state: BranchChangeState; applied_version_id: string | null; applied_revision: number | null;
  current_revision?: number | null; created_at?: string;
  state_label?: string; changed_field_labels?: string[]; conflict_line?: string;
};

export type BranchDetail = Branch & {
  changes: BranchChange[]; change_count: number; note: string;
  scope_object_label?: string | null; merged_proposal_id?: string | null;
};

export type MergeConflictField = {
  field: string; label?: string; branch_value: unknown; main_value: unknown; base_value?: unknown;
};

export type MergeConflict = {
  change_id: string; target_object_id: string; target_label?: string | null;
  base_revision: number | null; current_revision: number | null; reason: string;
  fields: MergeConflictField[];
};

export type MergePreview = {
  proposal_id: string; branch_id: string; branch_name: string; structure_revision: number | null;
  items: Array<{ change_id: string; target_object_id: string; target_label?: string | null;
    target_kind?: string | null; base_revision: number | null; current_revision: number | null;
    changed_fields: string[]; status: 'clean' | 'conflict'; conflicts: MergeConflictField[];
    state_label?: string }>;
  conflicts: MergeConflict[];
  counts: { clean: number; conflicted: number; total: number };
  impact: { targets?: Record<string, { direct: number; downstream: number; potential: number;
    total: number; truncated: boolean }>; note?: string };
  state: MergeState; note: string;
  counts_line?: string; conflict_line?: string;
};

export type MergeDecision = {
  proposal_id: string; branch_id: string; state: MergeState;
  applied: Array<{ change_id: string; target_object_id: string; target_label?: string | null;
    revision: number; changed_fields: string[]; changed_field_labels?: string[] }>;
  applied_count?: number;
  skipped?: Array<{ change_id: string; target_object_id: string; reason: string }>;
  propagation?: PropagationMode;
  impact?: Array<{ object_id: string; analysis_id: string; mode: PropagationMode;
    counts: Record<string, number>; marked: number;
    requiring_review?: Array<Record<string, unknown>>; locked_skipped?: Array<Record<string, unknown>>;
    unresolved_count?: number; mode_label?: string; impact_line?: string; review_line?: string }>;
  note: string; applied_line?: string; state_label?: string;
};

function base(workspaceId: string, productionId: string) {
  return `/api/v1/workspaces/${workspaceId}/productions/${productionId}/versions`;
}

export const productionVersioningService = {
  async vocabulary(workspaceId: string, productionId: string): Promise<VersioningVocabulary> {
    return authenticatedRequest<VersioningVocabulary>(`${base(workspaceId, productionId)}/vocabulary`);
  },

  /** The immutable history of one object, newest first. */
  async versions(workspaceId: string, productionId: string, objectId: string, options: {
    branch?: string; limit?: number; offset?: number;
  } = {}): Promise<VersionList> {
    const params = new URLSearchParams({
      object_id: objectId, branch: options.branch ?? 'main',
      limit: String(options.limit ?? 50), offset: String(options.offset ?? 0),
    });
    return authenticatedRequest<VersionList>(`${base(workspaceId, productionId)}?${params}`);
  },

  async version(workspaceId: string, productionId: string, versionId: string): Promise<VersionDetail> {
    return authenticatedRequest<VersionDetail>(`${base(workspaceId, productionId)}/${versionId}`);
  },

  /** Compare two versions of the same object. Only meaningful creative fields are returned. */
  async compare(workspaceId: string, productionId: string, leftVersionId: string, rightVersionId: string): Promise<VersionComparison> {
    const params = new URLSearchParams({ left_version_id: leftVersionId, right_version_id: rightVersionId });
    return authenticatedRequest<VersionComparison>(`${base(workspaceId, productionId)}/compare?${params}`);
  },

  /** Create a new current revision from an older version. Nothing is rewound or deleted. */
  async restore(workspaceId: string, productionId: string, versionId: string, note = ''): Promise<{
    object_id: string; restored_from_version_id: string; restored_from_revision: number;
    new_revision: number; changed_fields: string[]; changed_field_labels?: string[]; note: string;
  }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/${versionId}/restore`, {
      method: 'POST', body: JSON.stringify({ note }),
    });
  },

  async branches(workspaceId: string, productionId: string, options: {
    state?: BranchState | null; limit?: number; offset?: number;
  } = {}): Promise<BranchList> {
    const params = new URLSearchParams({
      limit: String(options.limit ?? 50), offset: String(options.offset ?? 0),
    });
    if (options.state) params.set('state', options.state);
    return authenticatedRequest<BranchList>(`${base(workspaceId, productionId)}/branches?${params}`);
  },

  /** Open an alternative from a known version. Nothing on the mainline changes. */
  async createBranch(workspaceId: string, productionId: string, input: {
    scopeObjectId: string; scope: BranchScope; name: string;
    sourceVersionId?: string | null; reason?: string;
  }): Promise<Branch & { note: string }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/branches`, {
      method: 'POST',
      body: JSON.stringify({
        scope_object_id: input.scopeObjectId, scope: input.scope, name: input.name,
        source_version_id: input.sourceVersionId ?? null, reason: input.reason ?? '',
      }),
    });
  },

  async branch(workspaceId: string, productionId: string, branchId: string): Promise<BranchDetail> {
    return authenticatedRequest<BranchDetail>(`${base(workspaceId, productionId)}/branches/${branchId}`);
  },

  /** Propose a field patch on a branch. The mainline is not touched. */
  async setChange(workspaceId: string, productionId: string, branchId: string, input: {
    targetObjectId: string; patch: Record<string, unknown>; note?: string;
  }): Promise<BranchChange> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/branches/${branchId}/changes`, {
      method: 'POST',
      body: JSON.stringify({ target_object_id: input.targetObjectId, patch: input.patch, note: input.note ?? '' }),
    });
  },

  /** Discard a proposed change. It stays readable as branch history. */
  async clearChange(workspaceId: string, productionId: string, branchId: string, changeId: string, note = ''): Promise<{
    change_id: string; state: BranchChangeState; note: string;
  }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/branches/${branchId}/changes/${changeId}/clear`, {
      method: 'POST', body: JSON.stringify({ note }),
    });
  },

  /** Abandon or reopen a branch. Merging is only ever a merge decision. */
  async setState(workspaceId: string, productionId: string, branchId: string, state: 'open' | 'abandoned', note = ''): Promise<{
    branch_id: string; state: BranchState; note: string;
  }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/branches/${branchId}/state`, {
      method: 'POST', body: JSON.stringify({ state, note }),
    });
  },

  /** Classify every proposed change as clean or conflicted and record a real proposal. */
  async preview(workspaceId: string, productionId: string, branchId: string): Promise<MergePreview> {
    return authenticatedRequest<MergePreview>(`${base(workspaceId, productionId)}/branches/${branchId}/merge-preview`, {
      method: 'POST', body: JSON.stringify({}),
    });
  },

  /** Accept or reject a merge. Only clean, selected changes become new mainline revisions. */
  async decide(workspaceId: string, productionId: string, proposalId: string, input: {
    decision: 'merge' | 'reject'; selectedChangeIds?: string[];
    propagation?: PropagationMode; note?: string;
  }): Promise<MergeDecision> {
    return authenticatedRequest<MergeDecision>(`${base(workspaceId, productionId)}/merges/${proposalId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        decision: input.decision, selected_change_ids: input.selectedChangeIds ?? [],
        propagation: input.propagation ?? 'change_only_this', note: input.note ?? '',
      }),
    });
  },
};
