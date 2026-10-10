import { authenticatedRequest } from './api';
import type { Database } from '../types/database';

/**
 * Prompt 9B surface: continuity as temporal state, its deterministic checks, and the findings a
 * creator decides about.
 *
 * Three things this client must never blur together. A statement is a *declaration* at a point in
 * Production order, so a different value at the same point supersedes the older statement instead
 * of overwriting it - the history stays readable. Running a check *records* what the declarations
 * say and changes no statement. And a finding is a statement about declarations: resolving one is
 * a creator decision, there is no `approved` finding state, and an inferred proposal must carry
 * its own basis rather than claiming an observation.
 */

export type ContinuityDomain = Database['tonde']['Enums']['continuity_domain'];
export type ContinuityAnchor = Database['tonde']['Enums']['continuity_anchor'];
export type ContinuityTransition = Database['tonde']['Enums']['continuity_transition'];
export type ContinuityOrigin = Database['tonde']['Enums']['continuity_origin'];
export type ContinuityFindingKind = Database['tonde']['Enums']['continuity_finding_kind'];
export type ContinuityFindingState = Database['tonde']['Enums']['continuity_finding_state'];

export type ContinuitySeverity = 'info' | 'warning' | 'critical';
export type ContinuityEpistemic = 'observed' | 'estimated' | 'recommended' | 'unknown';

/** A proposal is an estimate, a recommendation or an honest unknown. Never an observation. */
export const PROPOSAL_EPISTEMICS: Array<Exclude<ContinuityEpistemic, 'observed'>> =
  ['estimated', 'recommended', 'unknown'];

export const FINDING_STATES: ContinuityFindingState[] = ['open', 'acknowledged', 'resolved', 'waived'];

export type ContinuityVocabulary = {
  domains: Array<{ domain: ContinuityDomain; label: string }>;
  anchors: Array<{ anchor: ContinuityAnchor; label: string }>;
  transitions: Array<{ transition: ContinuityTransition; label: string }>;
  finding_kinds: Array<{ kind: ContinuityFindingKind; label: string }>;
  finding_states: Array<{ state: ContinuityFindingState; label: string }>;
  severities: Array<{ severity: ContinuitySeverity; label: string }>;
  rules: Array<{ kind: ContinuityFindingKind; severity: ContinuitySeverity; description: string }>;
  rule: string;
  limitation: string;
};

export type ContinuityStatement = {
  state_id: string; domain: ContinuityDomain; subject_object_id: string | null; subject_label: string | null;
  subject_kind?: string | null; trait: string; anchor: ContinuityAnchor;
  scene_id: string | null; shot_id: string | null; scene_label: string | null; shot_label: string | null;
  value: string; transition: ContinuityTransition; origin: ContinuityOrigin;
  epistemic: ContinuityEpistemic; confidence: 'high' | 'medium' | 'low';
  reason: string; note?: string; retired: boolean; retire_reason?: string; revision: number; created_at: string;
  domain_label?: string; anchor_label?: string; transition_label?: string; origin_label?: string; epistemic_label?: string;
};

export type ContinuityStatementList = {
  items: ContinuityStatement[]; total: number; live: number; limit: number; offset: number;
  truncated: boolean; limitation: string;
};

export type ContinuityChainItem = {
  state_id: string; domain: ContinuityDomain; trait: string; anchor: ContinuityAnchor; position_label: string;
  scene_id: string | null; shot_id: string | null; value: string; transition: ContinuityTransition;
  origin: ContinuityOrigin; epistemic: ContinuityEpistemic; confidence: 'high' | 'medium' | 'low'; reason: string;
  domain_label?: string; anchor_label?: string; transition_label?: string; epistemic_label?: string;
};

export type ContinuityChain = {
  subject_object_id: string; subject_label: string | null; statements: ContinuityChainItem[];
  statement_count: number; note: string; limitation: string;
};

export type ContinuityFinding = {
  finding_id: string; kind: ContinuityFindingKind; severity: ContinuitySeverity; domain: ContinuityDomain;
  trait: string; subject_object_id: string | null; subject_label: string | null;
  earlier_state_id: string | null; later_state_id: string | null;
  scene_id: string | null; shot_id: string | null; scene_label?: string | null; shot_label?: string | null;
  explanation: string; suggested_resolution: string; origin: ContinuityOrigin; rationale?: string;
  epistemic: ContinuityEpistemic; confidence: 'high' | 'medium' | 'low';
  evidence: Array<Record<string, unknown>>; state: ContinuityFindingState;
  resolution_note?: string; resolved_at?: string | null; check_id: string | null; created_at: string;
  severity_label?: string; kind_label?: string; state_label?: string; origin_label?: string;
  domain_label?: string; epistemic_label?: string; subject_line?: string;
};

export type ContinuityCheckSummary = {
  check_id: string; verdict: 'consistent' | 'needs_review' | 'conflict'; verdict_label?: string;
  counts: Record<string, number>; explanation: string; limitations: string; created_at: string;
  is_current?: boolean; freshness?: string; summary?: string; state_count?: number; state_watermark?: string | null;
};

export type ContinuityFindingList = {
  items: ContinuityFinding[]; total: number; limit: number; offset: number; truncated: boolean;
  check: ContinuityCheckSummary | null; checks_available: number; open_count: number; note: string;
  open_label?: string; limitation: string;
};

export type ContinuityCheckResult = {
  check_id: string; verdict: 'consistent' | 'needs_review' | 'conflict'; verdict_label?: string;
  counts: Record<string, number>; finding_count: number; state_count: number; production_revision: number;
  state_watermark: string | null; explanation: string; limitations: string; created_at: string;
  findings: ContinuityFinding[]; rule: string; limitation: string;
};

export type ContinuitySummary = {
  live_states: number; retired_states: number; subject_count: number;
  domains: Array<{ domain: ContinuityDomain; count: number; label?: string }>;
  check: ContinuityCheckSummary | null;
  findings: { open: number; acknowledged: number; critical_open: number };
  analysis_stale: boolean; stale_label?: string; limitations: string;
};

export type ContinuityStateInput = {
  domain: ContinuityDomain; trait: string; value: string;
  anchor?: ContinuityAnchor; subjectObjectId?: string | null;
  sceneId?: string | null; shotId?: string | null;
  transition?: ContinuityTransition; epistemic?: ContinuityEpistemic;
  confidence?: 'high' | 'medium' | 'low'; reason?: string; note?: string;
  evidence?: Array<Record<string, unknown>>;
};

export type ContinuityProposalInput = {
  kind?: ContinuityFindingKind; domain?: ContinuityDomain; severity?: ContinuitySeverity;
  trait?: string; subjectObjectId?: string | null; sceneId?: string | null; shotId?: string | null;
  explanation: string; suggestedResolution?: string; rationale: string;
  epistemic?: Exclude<ContinuityEpistemic, 'observed'>; confidence?: 'high' | 'medium' | 'low';
  evidence: Array<Record<string, unknown>>;
};

function base(workspaceId: string, productionId: string) {
  return `/api/v1/workspaces/${workspaceId}/productions/${productionId}/continuity`;
}

export const productionContinuityService = {
  async vocabulary(workspaceId: string, productionId: string): Promise<ContinuityVocabulary> {
    return authenticatedRequest<ContinuityVocabulary>(`${base(workspaceId, productionId)}/vocabulary`);
  },

  async summary(workspaceId: string, productionId: string): Promise<ContinuitySummary> {
    return authenticatedRequest<ContinuitySummary>(`${base(workspaceId, productionId)}/summary`);
  },

  async states(workspaceId: string, productionId: string, options: {
    subjectObjectId?: string | null; domain?: ContinuityDomain | null; includeRetired?: boolean;
    limit?: number; offset?: number;
  } = {}): Promise<ContinuityStatementList> {
    const params = new URLSearchParams({
      limit: String(options.limit ?? 100), offset: String(options.offset ?? 0),
      include_retired: String(Boolean(options.includeRetired)),
    });
    if (options.subjectObjectId) params.set('subject_object_id', options.subjectObjectId);
    if (options.domain) params.set('domain', options.domain);
    return authenticatedRequest<ContinuityStatementList>(`${base(workspaceId, productionId)}/states?${params}`);
  },

  /**
   * Record the creator's current statement for one trait at one point. A different value at the
   * same point supersedes the older statement: the response names what was kept.
   */
  async recordStatement(workspaceId: string, productionId: string, input: ContinuityStateInput): Promise<{
    state_id: string; updated: boolean; superseded_state_id: string | null; note: string;
  }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/states`, {
      method: 'POST',
      body: JSON.stringify({
        domain: input.domain, trait: input.trait, value: input.value, anchor: input.anchor ?? 'production',
        subject_object_id: input.subjectObjectId ?? null, scene_id: input.sceneId ?? null,
        shot_id: input.shotId ?? null, transition: input.transition ?? 'baseline',
        epistemic: input.epistemic ?? 'observed', confidence: input.confidence ?? 'high',
        reason: input.reason ?? '', note: input.note ?? '', evidence: input.evidence ?? [],
      }),
    });
  },

  /** Retire a statement without replacing it. The record stays readable as history. */
  async retireStatement(workspaceId: string, productionId: string, stateId: string, reason = '') {
    return authenticatedRequest<{ state_id: string; retired: boolean; note: string }>(
      `${base(workspaceId, productionId)}/states/${stateId}/retire`, {
        method: 'POST', body: JSON.stringify({ reason }),
      });
  },

  /** The recorded timeline of one subject, in Production order. */
  async chain(workspaceId: string, productionId: string, subjectObjectId: string, options: {
    domain?: ContinuityDomain | null; trait?: string | null;
  } = {}): Promise<ContinuityChain> {
    const params = new URLSearchParams({ subject_object_id: subjectObjectId });
    if (options.domain) params.set('domain', options.domain);
    if (options.trait) params.set('trait', options.trait);
    return authenticatedRequest<ContinuityChain>(`${base(workspaceId, productionId)}/chain?${params}`);
  },

  /** Run the deterministic check. It records its findings and changes no statement. */
  async check(workspaceId: string, productionId: string, note = ''): Promise<ContinuityCheckResult> {
    return authenticatedRequest<ContinuityCheckResult>(`${base(workspaceId, productionId)}/check`, {
      method: 'POST', body: JSON.stringify({ note }),
    });
  },

  async findings(workspaceId: string, productionId: string, options: {
    state?: ContinuityFindingState | null; severity?: ContinuitySeverity | null; checkId?: string | null;
    limit?: number; offset?: number;
  } = {}): Promise<ContinuityFindingList> {
    const params = new URLSearchParams({
      limit: String(options.limit ?? 100), offset: String(options.offset ?? 0),
    });
    if (options.state) params.set('state', options.state);
    if (options.severity) params.set('severity', options.severity);
    if (options.checkId) params.set('check_id', options.checkId);
    return authenticatedRequest<ContinuityFindingList>(`${base(workspaceId, productionId)}/findings?${params}`);
  },

  /** Acknowledge, resolve, waive or reopen a finding. A creator decision, never an approval. */
  async updateFinding(workspaceId: string, productionId: string, findingId: string, input: {
    state: ContinuityFindingState; note?: string;
  }) {
    return authenticatedRequest<{ finding_id: string; state: ContinuityFindingState; resolution_note: string; note: string }>(
      `${base(workspaceId, productionId)}/findings/${findingId}`, {
        method: 'PATCH', body: JSON.stringify({ state: input.state, note: input.note ?? '' }),
      });
  },

  /** Record an inferred proposal with its basis. It can never claim an observation. */
  async recordProposal(workspaceId: string, productionId: string, input: ContinuityProposalInput) {
    return authenticatedRequest<ContinuityFinding>(`${base(workspaceId, productionId)}/findings`, {
      method: 'POST',
      body: JSON.stringify({
        kind: input.kind ?? 'unexplained_change', domain: input.domain ?? 'other',
        severity: input.severity ?? 'info', trait: input.trait ?? '',
        subject_object_id: input.subjectObjectId ?? null, scene_id: input.sceneId ?? null,
        shot_id: input.shotId ?? null, explanation: input.explanation,
        suggested_resolution: input.suggestedResolution ?? '', rationale: input.rationale,
        epistemic: input.epistemic ?? 'estimated', confidence: input.confidence ?? 'low',
        evidence: input.evidence,
      }),
    });
  },
};
