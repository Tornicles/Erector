import { authenticatedRequest } from './api';
import type { Database } from '../types/database';

/**
 * Prompt 9F surface: Results, Shot Match and FIX THIS SHOT.
 *
 * Four things this client must never blur together.
 *
 * A Result is WHAT WAS ACTUALLY CREATED - not the plan. It links to its Production, Scene, Shot,
 * execution plan, Take or AI Attempt and media, and it keeps the provenance of where it came from.
 * A new Result starts as Needs review; Final is always an explicit creator decision.
 *
 * Shot Match is a DIAGNOSIS, not a score. It reports what is different per dimension, with an
 * epistemic state, a confidence and the evidence each observed difference was seen on. It compares
 * only the modalities the database verified from real media rows: no visual claim without extracted
 * frames or an image, no audio claim without a track, and it never measures a lens or identifies a
 * person from imagery.
 *
 * A mismatch produces a RECOMMENDATION, not an action: a Real Result recommends a pickup and an AI
 * Result recommends regeneration, and recommending regeneration launches nothing.
 *
 * FIX THIS SHOT is a SCOPED correction: one object, one validated patch, a recorded root cause and a
 * previewed impact. Applying it creates a new revision and preserves the previous plan, the Result
 * and every earlier analysis. A correction becomes reusable memory only when a later analysis
 * confirmed it helped, and nothing becomes memory from a single Shot.
 */

export type ResultState = Database['tonde']['Enums']['result_state'];
export type MatchVerdict = Database['tonde']['Enums']['match_verdict'];
export type CorrectionState = Database['tonde']['Enums']['correction_state'];
export type CorrectionRecommendation = Database['tonde']['Enums']['correction_recommendation'];
export type MatchOrigin = Database['tonde']['Enums']['match_origin'];

export type ResultOrigin = 'real_take' | 'ai_generation' | 'hybrid' | 'manual_import';
export type MatchSeverity = 'info' | 'warning' | 'critical';
export type EpistemicState = 'observed' | 'estimated' | 'recommended' | 'unknown';
export type MatchConfidence = 'high' | 'medium' | 'low';

export const RESULT_STATES: ResultState[] = ['raw', 'needs_review', 'approved', 'rejected', 'final'];
export const RESULT_ORIGINS: ResultOrigin[] = ['real_take', 'ai_generation', 'hybrid', 'manual_import'];
export const MATCH_VERDICTS: MatchVerdict[] = ['matches_intent', 'acceptable_variation',
  'needs_attention', 'mismatch', 'unknown'];
export const CORRECTION_STATES: CorrectionState[] = ['proposed', 'applied', 'rejected'];
export const CORRECTION_RECOMMENDATIONS: CorrectionRecommendation[] = ['none', 'pickup_required',
  'regeneration_recommended', 'both'];
export const MATCH_ORIGINS: MatchOrigin[] = ['deterministic', 'creator', 'ai_proposal'];
export const MATCH_DECISIONS = ['pickup', 'regeneration', 'accepted', 'dismiss'] as const;
export const PROPAGATION_MODES = ['change_only_this', 'review_changes', 'update_all'] as const;

/** The modalities a comparison may use. Everything here is verified by the database, never assumed. */
export const MEDIA_MODALITIES = ['metadata', 'thumbnail', 'image', 'video_frames', 'audio', 'text'] as const;

export type MediaCapabilities = {
  metadata?: boolean; thumbnail?: boolean; image?: boolean; video_frames?: boolean; audio?: boolean;
  text?: boolean; media_state?: string; file_category?: string; mime_type?: string; notes?: string[];
};

export type ResultProvenance = {
  origin?: ResultOrigin; take_id?: string | null; take_number?: number | null;
  take_status?: string | null; attempt_id?: string | null; attempt_number?: number | null;
  provider?: string | null; model?: string | null; media_state?: string | null; note?: string;
  registered_at?: string;
};

export type ShotMatchedResult = {
  result_id: string; shot_id: string; shot_label?: string | null;
  state: ResultState; state_label?: string; approval: Database['tonde']['Enums']['approval'];
  locked: boolean; revision: number;
  origin?: ResultOrigin | null; origin_label?: string; provenance: ResultProvenance;
  links?: Record<string, unknown>; capabilities: MediaCapabilities; capability_line?: string;
  match_reports?: number; match_worst_severity?: MatchSeverity | null; match_severity_label?: string;
  match_recommendation?: CorrectionRecommendation; match_recommendation_label?: string;
  match_decision?: string | null; created_at?: string;
  note?: string; final_line?: string; rule?: string;
};

export type ResultList = {
  items: ShotMatchedResult[]; total: number; limit: number; offset: number; note: string; rule?: string;
};

export type MatchFinding = {
  category: string; verdict: MatchVerdict; verdict_label?: string;
  expected: string; observed: string; difference: string;
  epistemic: EpistemicState; epistemic_label?: string;
  confidence: MatchConfidence; confidence_label?: string;
  severity: MatchSeverity; severity_label?: string;
  evidence: string[]; suggested_correction: string; region: string; time_range: string;
  continuity_finding_id?: string | null; subject_asset_id?: string | null;
};

export type MatchDimension = { dimension: string; verdict: MatchVerdict; verdict_label?: string; findings: number; weight: number };

export type MatchSummary = {
  what_worked: Array<{ category: string; verdict: MatchVerdict; observed?: string }>;
  what_drifted: Array<{ category: string; verdict: MatchVerdict; severity?: MatchSeverity; difference?: string }>;
  what_matters_most: Array<{ category: string; weight: number; difference: string; verdict: MatchVerdict }>;
  what_to_fix_next: Array<{ category: string; fix: string }>;
  note: string;
};

export type MatchCorrection = {
  correction_id: string; report_id: string; shot_id: string;
  state: CorrectionState; state_label?: string;
  target_object_id: string; target_kind: string; target_label: string;
  source_revision: number; patch: Record<string, unknown>;
  root_cause: string; why: string; affected: string;
  recommendation?: CorrectionRecommendation; recommendation_label?: string;
  continuity_finding_id?: string | null;
  preview?: { analysis_id?: string; counts?: Record<string, number>; note?: string };
  applied_revision?: number | null; applied_version_id?: string | null;
  changed_fields?: string[];
  candidate?: { state?: string; statement?: string } | null;
  propagation?: Array<Record<string, unknown>>; decided_by?: string | null; decided_at?: string | null;
  note?: string; created_at?: string; impact_line?: string; preserved_line?: string; rule?: string;
};

export type MatchReport = {
  report_id: string; shot_id: string; shot_label?: string | null;
  result_id: string; result_state: ResultState;
  state: string; severity: MatchSeverity; severity_label?: string;
  approval: Database['tonde']['Enums']['approval'];
  decision: string | null; decision_note: string; decided_by: string | null; decided_at: string | null;
  origin: MatchOrigin; origin_label?: string;
  recommendation: CorrectionRecommendation; recommendation_label?: string;
  capabilities: MediaCapabilities; capability_line?: string;
  findings: MatchFinding[]; dimensions: MatchDimension[]; summary: MatchSummary;
  recommendations: Array<{ category: string; correction: string; severity: MatchSeverity }>;
  limitations: string[]; corrected_plan_id?: string | null; corrections: MatchCorrection[];
  iteration_chain: Array<{ report_id: string; created_at: string; severity: MatchSeverity;
    recommendation: CorrectionRecommendation; decision: string | null }>;
  headline?: string; note: string; rule?: string; limitation?: string;
};

export type MatchReportList = {
  items: Array<Omit<MatchReport, 'findings' | 'dimensions' | 'summary' | 'recommendations' | 'corrections' | 'iteration_chain'>>;
  total: number; note: string; rule?: string;
};

export type MatchDecision = {
  report_id: string; shot_id: string; decision: string; decision_label?: string;
  approval: Database['tonde']['Enums']['approval']; recommendation: CorrectionRecommendation;
  recommendation_label?: string; capture_status: string | null; note: string; meaning: string; rule?: string;
};

export type ResultStateChange = {
  result_id: string; state: ResultState; state_label?: string; previous_state: ResultState;
  approval: Database['tonde']['Enums']['approval']; revision: number; note: string; meaning: string;
};

// A Result's detail replaces the list-level analysis count with the analyses themselves.
export type ResultDetail = Omit<ShotMatchedResult, 'match_reports'> & {
  scene_id: string | null; media_id: string;
  plan: null | { plan_id: string; execution_method: string; approval: string; revision: number;
    framing: string; lighting_intent?: string; camera_position?: string };
  version_count: number;
  match_reports: Array<{ report_id: string; state: string; severity: MatchSeverity;
    recommendation: CorrectionRecommendation; decision: string | null; origin: MatchOrigin;
    approval: string; created_at: string }>;
  corrections: Array<{ correction_id: string; state: CorrectionState; target_label: string;
    target_kind: string; root_cause: string; patch: Record<string, unknown>;
    applied_revision: number | null; note: string; created_at: string }>;
};

export type MatchVocabulary = {
  result_states: Array<{ state: ResultState; label: string }>;
  result_origins: Array<{ origin: ResultOrigin; label: string }>;
  match_verdicts: Array<{ verdict: MatchVerdict; label: string }>;
  correction_states: Array<{ state: CorrectionState; label: string }>;
  correction_recommendations: Array<{ recommendation: CorrectionRecommendation; label: string }>;
  match_origins: Array<{ origin: MatchOrigin; label: string }>;
  severities: Array<{ severity: MatchSeverity; label: string }>;
  rule: string;
  limitation: string;
};

function base(workspaceId: string, productionId: string) {
  return `/api/v1/workspaces/${workspaceId}/productions/${productionId}`;
}

export const productionShotMatchService = {
  async vocabulary(workspaceId: string, productionId: string): Promise<MatchVocabulary> {
    return authenticatedRequest<MatchVocabulary>(`${base(workspaceId, productionId)}/shot-match/vocabulary`);
  },

  /** What was actually created, with its provenance and its verified media capability. */
  async results(workspaceId: string, productionId: string, options: {
    shotId?: string | null; state?: ResultState | null; limit?: number; offset?: number;
  } = {}): Promise<ResultList> {
    const params = new URLSearchParams({
      limit: String(options.limit ?? 50), offset: String(options.offset ?? 0),
    });
    if (options.shotId) params.set('shot_id', options.shotId);
    if (options.state) params.set('state', options.state);
    return authenticatedRequest<ResultList>(`${base(workspaceId, productionId)}/results?${params}`);
  },

  /** Register what was actually created. It always starts as Needs review. */
  async registerResult(workspaceId: string, productionId: string, input: {
    shotId: string; origin: ResultOrigin; takeId?: string | null; attemptId?: string | null;
    mediaId?: string | null; executionPlanId?: string | null; note?: string;
  }): Promise<ShotMatchedResult> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/results`, {
      method: 'POST',
      body: JSON.stringify({
        shot_id: input.shotId, origin: input.origin, take_id: input.takeId ?? null,
        attempt_id: input.attemptId ?? null, media_id: input.mediaId ?? null,
        execution_plan_id: input.executionPlanId ?? null, note: input.note ?? '',
      }),
    });
  },

  /** One Result: its links, verified capabilities, plan, revisions and analyses. */
  async result(workspaceId: string, productionId: string, resultId: string): Promise<ResultDetail> {
    return authenticatedRequest<ResultDetail>(`${base(workspaceId, productionId)}/results/${resultId}`);
  },

  /** Accept, reject, reopen or finalize a Result. Final needs a creator approval first. */
  async setResultState(workspaceId: string, productionId: string, resultId: string, input: {
    state: ResultState; expectedRevision?: number | null; note?: string;
  }): Promise<ResultStateChange> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/results/${resultId}/state`, {
      method: 'POST',
      body: JSON.stringify({
        state: input.state, expected_revision: input.expectedRevision ?? null, note: input.note ?? '',
      }),
    });
  },

  /** Every analysis of a Shot, or of a Result, newest first. */
  async reports(workspaceId: string, productionId: string, options: {
    shotId?: string | null; resultId?: string | null; limit?: number; offset?: number;
  } = {}): Promise<MatchReportList> {
    const params = new URLSearchParams({
      limit: String(options.limit ?? 25), offset: String(options.offset ?? 0),
    });
    if (options.shotId) params.set('shot_id', options.shotId);
    if (options.resultId) params.set('result_id', options.resultId);
    return authenticatedRequest<MatchReportList>(`${base(workspaceId, productionId)}/shot-match?${params}`);
  },

  /** Record what is different between the Plan, the Reference and the Result, and how to fix it. */
  async analyze(workspaceId: string, productionId: string, shotId: string, input: {
    resultId: string; origin?: MatchOrigin; findings: Array<Record<string, unknown>>;
    capabilities?: Record<string, boolean>;
  }): Promise<MatchReport> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/shots/${shotId}/shot-match`, {
      method: 'POST',
      body: JSON.stringify({
        result_id: input.resultId, origin: input.origin ?? 'creator', findings: input.findings,
        capabilities: input.capabilities ?? {},
      }),
    });
  },

  /** One analysis with its findings, summary and the Shot's whole iteration history. */
  async report(workspaceId: string, productionId: string, reportId: string): Promise<MatchReport> {
    return authenticatedRequest<MatchReport>(`${base(workspaceId, productionId)}/shot-match/${reportId}`);
  },

  /** Pick up, regenerate, accept or dismiss. Regeneration launches nothing by itself. */
  async decide(workspaceId: string, productionId: string, reportId: string, input: {
    decision: typeof MATCH_DECISIONS[number]; note?: string;
  }): Promise<MatchDecision> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/shot-match/${reportId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision: input.decision, note: input.note ?? '' }),
    });
  },

  /** Propose a scoped correction: one object, one patch, a recorded cause and a previewed impact. */
  async proposeCorrection(workspaceId: string, productionId: string, reportId: string, input: {
    targetObjectId: string; patch: Record<string, unknown>; rootCause: string;
    why?: string; affected?: string; continuityFindingId?: string | null;
  }): Promise<MatchCorrection> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/shot-match/${reportId}/corrections`, {
      method: 'POST',
      body: JSON.stringify({
        target_object_id: input.targetObjectId, patch: input.patch, root_cause: input.rootCause,
        why: input.why ?? '', affected: input.affected ?? '',
        continuity_finding_id: input.continuityFindingId ?? null,
      }),
    });
  },

  /** Apply the correction. A new revision is created and the earlier plan and Result are kept. */
  async applyCorrection(workspaceId: string, productionId: string, correctionId: string, input: {
    expectedRevision?: number | null; propagation?: typeof PROPAGATION_MODES[number];
    note?: string; recordCandidate?: boolean;
  } = {}): Promise<MatchCorrection> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/shot-match/corrections/${correctionId}/apply`, {
      method: 'POST',
      body: JSON.stringify({
        expected_revision: input.expectedRevision ?? null,
        propagation: input.propagation ?? 'change_only_this', note: input.note ?? '',
        record_candidate: input.recordCandidate ?? false,
      }),
    });
  },

  /** Reject the correction. Nothing changes and nothing is overwritten. */
  async rejectCorrection(workspaceId: string, productionId: string, correctionId: string, input: {
    note?: string;
  } = {}): Promise<MatchCorrection> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/shot-match/corrections/${correctionId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note: input.note ?? '' }),
    });
  },
};
