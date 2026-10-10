import { authenticatedRequest } from './api';
import type { Database } from '../types/database';

/**
 * Prompt 9E surface: approval, locks and Production readiness.
 *
 * Three things this client must never blur together. Approval is a creator decision about a SPECIFIC
 * revision: it is shown with the revision it named, the person who made it and the time, and newer
 * content is shown as changed rather than still approved. Lock is independent of approval: it
 * protects a decision from incidental change, and an unlock is explicit and carries its reason.
 * Readiness is a category derived from real production state with actionable, navigable blockers,
 * never a score or a percentage and never a claim about external provider availability.
 */

export type AccessAction = Database['tonde']['Enums']['access_action'];
export type ReadinessState = Database['tonde']['Enums']['readiness_state'];
export type ReadinessDimension = Database['tonde']['Enums']['readiness_dimension'];
export type ApprovalStatus = Database['tonde']['Enums']['approval'];

export type ReadinessSeverity = 'blocking' | 'review' | 'warning';

export const ACCESS_ACTIONS: AccessAction[] = ['approve', 'request_review', 'reopen', 'lock', 'unlock'];
export const READINESS_SEVERITIES: ReadinessSeverity[] = ['blocking', 'review', 'warning'];

/** Only kinds that actually carry approval and lock columns may be decided through this surface. */
export const REVIEWABLE_KINDS = ['production', 'act', 'sequence', 'scene', 'shot', 'execution_plan',
  'dialogue_line', 'creative_document', 'result'] as const;

export type ReadinessVocabulary = {
  access_actions: Array<{ action: AccessAction; label: string }>;
  approval_states: Array<{ state: ApprovalStatus; label: string }>;
  readiness_states: Array<{ state: ReadinessState; label: string }>;
  readiness_dimensions: Array<{ dimension: ReadinessDimension; label: string }>;
  severities: Array<{ severity: ReadinessSeverity; label: string }>;
  rule: string;
  limitation: string;
};

export type ReadinessBlocker = {
  code: string; severity: ReadinessSeverity; dimension: ReadinessDimension; problem: string;
  affected_object_id: string | null; affected_label: string | null; affected_kind: string | null;
  why_it_matters: string; required_action: string; action_source: string;
  severity_label?: string; dimension_label?: string;
};

export type ReadinessReport = {
  production_id: string; production_revision: number; title: string;
  state: ReadinessState; state_label?: string;
  dimensions: Array<{ dimension: ReadinessDimension; label?: string; state: ReadinessState;
    state_label?: string; present: boolean; counts: { blocking: number; review: number; warning: number } }>;
  blockers: ReadinessBlocker[];
  counts: { blocking: number; review: number; warning: number; total: number };
  headline: string;
  notes: string[];
  generated_at: string;
  limitation?: string;
};

export type AccessDecisionRecord = {
  id?: string; action: AccessAction; from_approval: ApprovalStatus | null; to_approval: ApprovalStatus | null;
  from_locked: boolean; to_locked: boolean; pinned_revision: number | null; note: string;
  actor_user_id: string | null; created_at: string; action_label?: string;
};

export type AccessState = {
  object_id: string; object_kind: string; label: string | null;
  approval: ApprovalStatus | null; approval_label?: string; locked: boolean;
  current_revision: number | null; approved_revision: number | null;
  approved_by: string | null; approved_at: string | null; changed_since_approval: boolean;
  locked_at: string | null; locked_by: string | null; lock_reason: string;
  decisions: AccessDecisionRecord[];
  note: string; changed_line?: string; lock_line?: string; rule?: string;
};

export type AccessHistory = {
  object_id: string; object_kind: string; total: number; items: AccessDecisionRecord[]; note: string;
};

export type AccessDecision = {
  object_id: string; object_kind: string; label: string | null; action: AccessAction;
  action_label?: string; approval: ApprovalStatus | null; approval_label?: string;
  revision: number | null; approved_revision: number | null; locked: boolean;
  note: string; actor_user_id: string | null; decided_at: string; meaning: string;
};

export type LockResult = {
  object_id: string; object_kind: string; label: string | null; task: 'lock' | 'unlock';
  action_label?: string; locked: boolean; revision: number | null; was_locked: boolean;
  note: string; actor_user_id: string | null; decided_at: string; meaning: string;
};

function base(workspaceId: string, productionId: string) {
  return `/api/v1/workspaces/${workspaceId}/productions/${productionId}`;
}

export const productionReadinessService = {
  async vocabulary(workspaceId: string, productionId: string): Promise<ReadinessVocabulary> {
    return authenticatedRequest<ReadinessVocabulary>(`${base(workspaceId, productionId)}/readiness/vocabulary`);
  },

  /** What prevents us from moving forward, as a category with navigable blockers. */
  async readiness(workspaceId: string, productionId: string): Promise<ReadinessReport> {
    return authenticatedRequest<ReadinessReport>(`${base(workspaceId, productionId)}/readiness`);
  },

  /** The approval and lock state of one object, and the revision the approval named. */
  async state(workspaceId: string, productionId: string, objectId: string): Promise<AccessState> {
    return authenticatedRequest<AccessState>(`${base(workspaceId, productionId)}/access/${objectId}`);
  },

  /** The append-only record of approval, lock and unlock decisions on one object. */
  async history(workspaceId: string, productionId: string, objectId: string, options: {
    limit?: number; offset?: number;
  } = {}): Promise<AccessHistory> {
    const params = new URLSearchParams({
      limit: String(options.limit ?? 50), offset: String(options.offset ?? 0),
    });
    return authenticatedRequest<AccessHistory>(`${base(workspaceId, productionId)}/access/${objectId}/history?${params}`);
  },

  /** Approve a specific revision, request a review, or reopen it. A creator decision. */
  async decide(workspaceId: string, productionId: string, objectId: string, input: {
    decision: 'approve' | 'request_review' | 'reopen'; expectedRevision?: number | null; note?: string;
  }): Promise<AccessDecision> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/access/${objectId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        decision: input.decision, expected_revision: input.expectedRevision ?? null, note: input.note ?? '',
      }),
    });
  },

  /** Lock or unlock an object. Unlock is explicit and needs a reason. */
  async setLock(workspaceId: string, productionId: string, objectId: string, input: {
    locked: boolean; expectedRevision?: number | null; note?: string;
  }): Promise<LockResult> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/access/${objectId}/lock`, {
      method: 'POST',
      body: JSON.stringify({
        locked: input.locked, expected_revision: input.expectedRevision ?? null, note: input.note ?? '',
      }),
    });
  },
};
