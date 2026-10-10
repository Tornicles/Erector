import { authenticatedRequest } from './api';
import type { Database } from '../types/database';

/**
 * Prompt 9C surface: inspectable production memory, the authority that decides what is in force,
 * pattern candidates under an explicit policy, and structured search over real production state.
 *
 * Four things this client must never blur together. Memory has provenance: what it says, what kind
 * of knowledge it is, where it came from - which is also its authority tier - and which object and
 * revision it was drawn from. A remembered item that a stronger or newer item outranks is returned
 * as outranked rather than hidden. A successful-pattern candidate is a *proposal* drawn from real
 * evidence: it becomes memory only under the scope's policy or through an explicit creator
 * decision, and `accepted` provenance cannot be typed into a form. And search is structured: every
 * filter is a real column or relationship, it returns real object references, and it never presents
 * itself as semantic search or as media analysis.
 */

export type MemoryScope = Database['tonde']['Enums']['memory_scope'];
export type MemoryKind = Database['tonde']['Enums']['memory_kind'];
export type MemorySource = Database['tonde']['Enums']['memory_source'];
export type MemoryOrigin = Database['tonde']['Enums']['memory_origin'];

export type MemoryStateFilter = 'active' | 'archived' | 'all';
export type CandidateState = 'proposed' | 'applied' | 'rejected';

/** What a candidate may propose. A candidate never proposes creator authority. */
export const CANDIDATE_SOURCES: Array<Exclude<MemorySource, 'creator_instruction' | 'production_decision'>> =
  ['saved_preference', 'historical_pattern', 'inference'];

/** Origins a caller may claim directly. `accepted` comes from accepting a candidate. */
export const WRITABLE_ORIGINS: Array<Extract<MemoryOrigin, 'declared' | 'inferred'>> = ['declared', 'inferred'];

export type SearchKind = 'shot' | 'scene' | 'plan' | 'result' | 'continuity_finding'
  | 'continuity_state' | 'memory' | 'asset';

export const SEARCH_KINDS: SearchKind[] = ['shot', 'scene', 'plan', 'result', 'continuity_finding',
  'continuity_state', 'memory', 'asset'];

export type MemoryVocabulary = {
  scopes: Array<{ scope: MemoryScope; label: string }>;
  kinds: Array<{ kind: MemoryKind; label: string }>;
  sources: Array<{ source: MemorySource; label: string; authority_rank: number; strength: number }>;
  origins: Array<{ origin: MemoryOrigin; label: string }>;
  item_states: Array<{ state: string; label: string }>;
  candidate_states: Array<{ state: CandidateState; label: string }>;
  search_kinds: Array<{ kind: SearchKind; label: string }>;
  authority_rule: string;
  rule: string;
  limitation: string;
  search_limitation: string;
};

export type MemoryItem = {
  item_id: string; scope: MemoryScope; kind: MemoryKind; subject_key: string; statement: string;
  source: MemorySource; origin: MemoryOrigin; authority_rank: number; rationale: string;
  evidence: Array<Record<string, unknown>>;
  source_object_id: string | null; source_object_label?: string | null;
  source_revision: number | null; source_object_revision?: number | null; source_changed?: boolean | null;
  candidate_id: string | null; confirmed_by: string | null; confirmed_at: string | null;
  state: string; retired_at: string | null; retire_reason: string;
  supersedes_id: string | null; superseded_by: string | null; in_force: boolean;
  production_id: string | null; series_id: string | null;
  created_at: string; updated_at: string; created_by: string;
  scope_label?: string; kind_label?: string; source_label?: string; origin_label?: string;
  state_label?: string; authority_line?: string; force_line?: string; source_line?: string;
};

export type MemoryItemList = {
  items: MemoryItem[]; total: number; limit: number; offset: number; truncated: boolean;
  note: string; authority_rule?: string;
};

export type MemoryResolutionEntry = {
  item_id: string; statement: string; kind: MemoryKind; scope: MemoryScope; source: MemorySource;
  origin: MemoryOrigin; authority_rank: number; confirmed: boolean; created_at: string;
  retired_at: string | null; in_force: boolean;
  source_label?: string; scope_label?: string; authority_line?: string; force_line?: string;
};

export type MemoryResolution = {
  subject_key: string; resolved: MemoryResolutionEntry | null; considered: MemoryResolutionEntry[];
  explanation: string; note_text?: string; authority_rule?: string;
};

export type MemoryPolicy = {
  scope: MemoryScope; explicit: boolean; candidate_capture: boolean; auto_accept_candidates: boolean;
  note: string; updated_at: string | null;
  scope_label?: string; explicit_label?: string; capture_label?: string; accept_label?: string;
};

export type MemoryPolicyList = {
  production_id: string; series_id: string | null; policies: MemoryPolicy[]; note: string;
  authority_rule?: string;
};

export type MemoryCandidate = {
  candidate_id: string; kind: MemoryKind; subject_key: string; statement: string;
  proposed_source: MemorySource; basis: Array<Record<string, unknown>>; observed_count: number;
  source_object_id: string; source_object_label?: string | null; source_revision: number;
  source_changed: boolean; state: CandidateState; decided_by: string | null; decided_at: string | null;
  decision_note: string; created_at: string;
  state_label?: string; kind_label?: string; proposed_source_label?: string; source_line?: string;
};

export type MemoryCandidateList = {
  items: MemoryCandidate[]; total: number; limit: number; offset: number; truncated: boolean;
  policy: MemoryPolicy; note: string;
};

export type MemorySummary = {
  items: { active: number; archived: number; subjects: number; creator_confirmed: number; inferred: number;
    sources_changed: number };
  by_scope: Record<string, number>; by_source: Record<string, number>;
  candidates: { proposed: number; applied: number; rejected: number };
  policy: MemoryPolicy; series_id: string | null; limitations: string;
  summary_line?: string; candidate_line?: string; changed_line?: string;
};

export type SearchResultItem = {
  entity_type: string; entity_id: string; label: string; context?: string | null; detail?: string | null;
  matched_on?: string; approval?: string; execution_method?: string; revision?: number; locked?: boolean;
  state?: string; severity?: string; domain?: string; source?: MemorySource; origin?: MemoryOrigin;
  in_force?: boolean; authority_rank?: number; scope?: MemoryScope; memory_kind?: MemoryKind;
  asset_type?: string; provider?: string | null; model?: string | null; has_plan?: boolean; has_media?: boolean;
  entity_label?: string; source_label?: string; state_label?: string;
};

export type ProductionSearchResult = {
  interpretation: {
    text: string | null; tokens: string[]; kinds: SearchKind[]; limit: number; series_id?: string | null;
    facets: Array<{ facet: string; value: string; meaning: string }>;
    kind_labels?: string[]; facet_line?: string;
  };
  lanes: Array<{ lane: SearchKind; total: number; returned: number; label?: string }>;
  results: SearchResultItem[];
  total: number; returned: number; truncated: boolean; notes: string[];
  search_limitation?: string; authority_rule?: string;
};

export type MemoryItemInput = {
  scope?: MemoryScope; kind?: MemoryKind; subjectKey: string; statement: string;
  source?: MemorySource; origin?: 'declared' | 'inferred'; seriesId?: string | null;
  sourceObjectId?: string | null; sourceRevision?: number | null; rationale?: string;
  evidence?: Array<Record<string, unknown>>;
};

export type MemoryCandidateInput = {
  kind?: MemoryKind; subjectKey: string; statement: string;
  proposedSource?: Exclude<MemorySource, 'creator_instruction' | 'production_decision'>;
  observedCount?: number; sourceObjectId: string; sourceRevision?: number | null;
  basis: Array<Record<string, unknown>>;
};

export type ProductionSearchInput = {
  text?: string | null; kinds?: SearchKind[]; assetId?: string | null; assetName?: string | null;
  assetType?: string | null; environment?: string | null; approval?: string | null;
  executionMethod?: string | null; provider?: string | null; model?: string | null; lens?: string | null;
  continuityState?: string | null; severity?: string | null; domain?: string | null;
  resultState?: string | null; memoryKind?: string | null; limit?: number;
};

function base(workspaceId: string, productionId: string) {
  return `/api/v1/workspaces/${workspaceId}/productions/${productionId}/memory`;
}

export const productionMemoryService = {
  async vocabulary(workspaceId: string, productionId: string): Promise<MemoryVocabulary> {
    return authenticatedRequest<MemoryVocabulary>(`${base(workspaceId, productionId)}/vocabulary`);
  },

  async summary(workspaceId: string, productionId: string): Promise<MemorySummary> {
    return authenticatedRequest<MemorySummary>(`${base(workspaceId, productionId)}/summary`);
  },

  async items(workspaceId: string, productionId: string, options: {
    scope?: MemoryScope | null; kind?: MemoryKind | null; subjectKey?: string | null;
    state?: MemoryStateFilter; limit?: number; offset?: number;
  } = {}): Promise<MemoryItemList> {
    const params = new URLSearchParams({
      state: options.state ?? 'active',
      limit: String(options.limit ?? 100), offset: String(options.offset ?? 0),
    });
    if (options.scope) params.set('scope', options.scope);
    if (options.kind) params.set('kind', options.kind);
    if (options.subjectKey) params.set('subject_key', options.subjectKey);
    return authenticatedRequest<MemoryItemList>(`${base(workspaceId, productionId)}/items?${params}`);
  },

  /** Remember a statement with its authority tier. Restating the same tier supersedes it. */
  async recordItem(workspaceId: string, productionId: string, input: MemoryItemInput): Promise<{
    item_id: string; updated: boolean; superseded_id: string | null; authority_rank: number;
    scope: MemoryScope; source: MemorySource; origin: MemoryOrigin; in_force: boolean; note_text: string;
  }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/items`, {
      method: 'POST',
      body: JSON.stringify({
        scope: input.scope ?? 'production', kind: input.kind ?? 'preference',
        subject_key: input.subjectKey, statement: input.statement,
        source: input.source ?? 'saved_preference', origin: input.origin ?? 'declared',
        series_id: input.seriesId ?? null, source_object_id: input.sourceObjectId ?? null,
        source_revision: input.sourceRevision ?? null, rationale: input.rationale ?? '',
        evidence: input.evidence ?? [],
      }),
    });
  },

  /** Retire a remembered item. It stays readable as history and is never deleted. */
  async retireItem(workspaceId: string, productionId: string, itemId: string, reason = '') {
    return authenticatedRequest<{ item_id: string; state: string; retired_at: string | null;
      retire_reason: string; note_text: string }>(`${base(workspaceId, productionId)}/items/${itemId}/retire`, {
        method: 'POST', body: JSON.stringify({ reason }),
      });
  },

  /** Why TONDE is using this: the item in force, what it outranked and on what authority. */
  async resolve(workspaceId: string, productionId: string, subjectKey: string, kind?: MemoryKind | null): Promise<MemoryResolution> {
    const params = new URLSearchParams({ subject_key: subjectKey });
    if (kind) params.set('kind', kind);
    return authenticatedRequest<MemoryResolution>(`${base(workspaceId, productionId)}/resolve?${params}`);
  },

  async policies(workspaceId: string, productionId: string): Promise<MemoryPolicyList> {
    return authenticatedRequest<MemoryPolicyList>(`${base(workspaceId, productionId)}/policies`);
  },

  /** Decide whether TONDE may record candidates here, and whether they become memory alone. */
  async setPolicy(workspaceId: string, productionId: string, input: {
    scope: MemoryScope; candidateCapture: boolean; autoAcceptCandidates: boolean;
    seriesId?: string | null; note?: string;
  }): Promise<MemoryPolicy> {
    return authenticatedRequest<MemoryPolicy>(`${base(workspaceId, productionId)}/policies`, {
      method: 'PUT',
      body: JSON.stringify({
        scope: input.scope, series_id: input.seriesId ?? null,
        candidate_capture: input.candidateCapture,
        auto_accept_candidates: input.autoAcceptCandidates, note: input.note ?? '',
      }),
    });
  },

  async candidates(workspaceId: string, productionId: string, options: {
    state?: CandidateState | 'all'; limit?: number; offset?: number;
  } = {}): Promise<MemoryCandidateList> {
    const params = new URLSearchParams({
      state: options.state ?? 'proposed',
      limit: String(options.limit ?? 50), offset: String(options.offset ?? 0),
    });
    return authenticatedRequest<MemoryCandidateList>(`${base(workspaceId, productionId)}/candidates?${params}`);
  },

  /**
   * Record a candidate drawn from real evidence. It pins the object and the revision it was
   * observed on, and it changes no behaviour until the policy or the creator accepts it.
   */
  async recordCandidate(workspaceId: string, productionId: string, input: MemoryCandidateInput): Promise<{
    candidate_id: string; state: CandidateState; duplicate: boolean; memory_item_id: string | null;
    policy: MemoryPolicy; note_text: string;
  }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/candidates`, {
      method: 'POST',
      body: JSON.stringify({
        kind: input.kind ?? 'pattern', subject_key: input.subjectKey, statement: input.statement,
        proposed_source: input.proposedSource ?? 'historical_pattern',
        observed_count: input.observedCount ?? 1, source_object_id: input.sourceObjectId,
        source_revision: input.sourceRevision ?? null, basis: input.basis,
      }),
    });
  },

  /** Accept a candidate as memory, or dismiss it. Nothing else turns a proposal into memory. */
  async decideCandidate(workspaceId: string, productionId: string, candidateId: string, input: {
    decision: 'accept' | 'dismiss'; note?: string;
  }): Promise<{ candidate_id: string; state: CandidateState; memory_item_id: string | null;
    authority_rank?: number; note_text: string; state_label?: string }> {
    return authenticatedRequest(`${base(workspaceId, productionId)}/candidates/${candidateId}/decide`, {
      method: 'POST', body: JSON.stringify({ decision: input.decision, note: input.note ?? '' }),
    });
  },

  /** Structured search over real production state. Every filter is a real column or relationship. */
  async search(workspaceId: string, productionId: string, input: ProductionSearchInput = {}): Promise<ProductionSearchResult> {
    const params = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.text) params.set('text', input.text);
    if (input.kinds && input.kinds.length > 0) params.set('kinds', input.kinds.join(','));
    if (input.assetId) params.set('asset_id', input.assetId);
    if (input.assetName) params.set('asset_name', input.assetName);
    if (input.assetType) params.set('asset_type', input.assetType);
    if (input.environment) params.set('environment', input.environment);
    if (input.approval) params.set('approval', input.approval);
    if (input.executionMethod) params.set('execution_method', input.executionMethod);
    if (input.provider) params.set('provider', input.provider);
    if (input.model) params.set('model', input.model);
    if (input.lens) params.set('lens', input.lens);
    if (input.continuityState) params.set('continuity_state', input.continuityState);
    if (input.severity) params.set('severity', input.severity);
    if (input.domain) params.set('domain', input.domain);
    if (input.resultState) params.set('result_state', input.resultState);
    if (input.memoryKind) params.set('memory_kind', input.memoryKind);
    return authenticatedRequest<ProductionSearchResult>(`${base(workspaceId, productionId)}/search?${params}`);
  },
};
