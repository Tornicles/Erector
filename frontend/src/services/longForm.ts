import { requireSupabase } from '../lib/supabase';
import { safeError } from './errors';
import { authenticatedRequest } from './api';
import type { Database } from '../types/database';

/**
 * Prompt 8 surface: long-form structure (Movie Mode), Series Studio, Production Line and
 * Generate Ahead.
 *
 * Reads are one bounded level at a time; writes go through the guarded RPCs, so ordering,
 * conflict detection, locks and idempotency are decided in the database. Generate Ahead is
 * always previewed before it is applied, and it only ever creates Production shells.
 */

export type StructureLevel = 'production' | 'act' | 'sequence' | 'scene' | 'shot';
export const STRUCTURE_LEVELS: StructureLevel[] = ['production', 'act', 'sequence', 'scene', 'shot'];
/** The semantic timeline zooms: the planning hierarchy, not a video-editing timeline. */
export const TIMELINE_ZOOMS: Exclude<StructureLevel, 'production'>[] = ['act', 'sequence', 'scene', 'shot'];

export type GenerateHorizon = Database['tonde']['Enums']['generate_horizon'];
export type GenerateDepth = Database['tonde']['Enums']['generate_depth'];
export type SequenceKind = Database['tonde']['Enums']['sequence_kind'];
export type SeriesKind = Database['tonde']['Enums']['series_kind'];
export type PlanningDepth = Database['tonde']['Enums']['planning_depth'];

export type StructureSummary = {
  text?: string | null; stale?: boolean; stale_label?: string; source_revision?: number | null; revision?: number | null;
};

export type StructureScope = {
  level: StructureLevel; id: string | null; title: string | null; display?: string;
  depth?: PlanningDepth | string | null; depth_label?: string;
  orphan_sequences?: number; orphan_scenes?: number; summary?: StructureSummary | null;
};

export type StructureItem = {
  id: string; level: StructureLevel; title: string; display: string; display_index: number | null;
  order: number; purpose?: string | null; narrative_goal?: string | null; kind?: string | null;
  opening_state?: string | null; ending_state?: string | null;
  planned_duration_ms?: number | null; calculated_duration_ms?: number | null;
  label?: string | null; delta_ms?: number | null; status?: 'fits' | 'over' | 'under' | 'unresolved' | string;
  depth?: PlanningDepth | string | null; depth_label?: string;
  approval: Database['tonde']['Enums']['approval']; locked?: boolean | null; locked_at?: string | null;
  revision: number; summary?: StructureSummary | null;
  documents?: Array<{ document_id: string; document_type: string; revision?: number | null }>;
  child_counts?: Record<string, number>;
  production_id?: string | null; act_id?: string | null; sequence_id?: string | null; scene_id?: string | null;
};

export type TimingNode = {
  target_ms?: number | null; calculated_ms?: number | null; delta_ms?: number | null;
  status?: string; target_label?: string | null; calculated_label?: string | null; delta_label?: string | null;
};

export type LongFormTiming = {
  production?: TimingNode; counts?: Record<string, number>; rule?: string;
  conflicts?: Array<{ level: StructureLevel; id: string; title: string; target_ms: number | null; calculated_ms: number | null;
    over_by_ms?: number | null; over_by_label?: string | null; status?: string; reason: string }>;
};

export type StructurePage = {
  production_id: string; production_revision: number; structure_revision: number;
  level: StructureLevel; scope: StructureScope; breadcrumb: Array<{ level: StructureLevel; id: string | null; title: string | null }>;
  breadcrumb_line: string; items: StructureItem[]; total: number; limit: number; offset: number; truncated: boolean;
  lazy: string; timing: LongFormTiming;
};

export type SearchItem = {
  level: StructureLevel; id: string; title: string; snippet: string; match_field: string;
  scene_id?: string | null; shot_id?: string | null; act_id?: string | null; sequence_id?: string | null;
  approval?: string | null; locked?: boolean | null; depth?: string | null;
  takes?: number; results?: number; attempts?: number; execution_method?: string | null;
};

export type SearchResult = {
  query: string; total: number; items: SearchItem[]; limit: number; offset: number; truncated: boolean;
  filters: Record<string, unknown>; binding_filter?: unknown; note: string;
};

export type ScriptIndexItem = {
  document_id: string; document_type: string; title: string; scope_level: StructureLevel;
  scope_object_id: string | null; revision: number | null; approval: string | null; locked: boolean | null;
  characters: number; lines: number; line_duration_ms: number; excerpt: string;
};

export type ScriptIndex = { items: ScriptIndexItem[]; total: number; limit: number; offset: number; truncated: boolean; note: string };

export type StructureSummaryRow = {
  summary_id: string; scope_level: StructureLevel; scope_object_id: string; source_revision: number;
  current_revision: number; stale: boolean; generated_by: string; note: string | null; text: string | null;
};

export type ScopeContext = {
  scope: StructureScope; path: Array<{ level: StructureLevel; id: string | null; title: string | null }>;
  siblings: Array<{ level: StructureLevel; id: string; title: string }>;
  assets?: Array<{ role: string; asset_id: string; name: string }>;
  documents?: Array<{ document_id: string; document_type: string; revision?: number | null }>;
  dialogue?: Array<{ id: string; scene_id: string | null; speaker: string | null; content: string; duration_ms: number | null }>;
  characters?: string | null; timing?: LongFormTiming; depth?: string | null;
  summary?: StructureSummary | null; budget_chars?: number; truncated?: boolean;
};

export type DirectorScopeResolution = {
  level: StructureLevel; identifier: string | null; operation: string | null; ambiguous: boolean;
  scope_is_explicit: boolean; note: string; signals?: string[]; title?: string | null;
};

export type LongFormDirectorAnswer = {
  resolution: DirectorScopeResolution; direction: Record<string, unknown>; structure_revision: number;
  loaded_scope?: StructureScope; breadcrumb?: StructurePage['breadcrumb']; breadcrumb_line?: string;
  context?: ScopeContext; rule: string;
};

export type SeriesRow = Database['tonde']['Tables']['series']['Row'];

export type SeriesOverview = {
  series_id: string; title: string; series_kind: SeriesKind; timezone: string; lifecycle: string; revision: number;
  cadence_metadata: Record<string, unknown>; format: Record<string, unknown>; summary: Record<string, unknown> | null;
  collections: Array<{ collection_id: string; title: string; purpose: string; sort_order: number; lifecycle: string; episodes: number }>;
  counts: { episodes_active: number; episodes_archived: number; collections: number; planned_episodes: string | null; next_episode_number: number };
  reuse: Array<{ asset_id: string; name: string; asset_type: string; missing: boolean }>;
  upcoming: Array<{ episode_id: string; episode_number: number | null; title: string; planned_date: string | null;
    production_id: string | null; production_line_state: string; depth: string }>;
  last_generate_ahead: { job_id: string; state: string; horizon: string; depth: string; created_count: number;
    preserved_count: number; blocked_count: number; failed_count: number; created_at: string } | null;
  note: string;
};

export type ProductionLineItem = {
  episode_id: string; episode_number: number | null; title: string; planned_date: string | null;
  production_id: string | null; production_title: string | null; lifecycle: string; production_lifecycle: string | null;
  requested_depth: GenerateDepth | null; requested_depth_label?: string;
  depth: PlanningDepth; depth_label?: string; line_state: string; line_state_label?: string;
  approval: string | null; locked: boolean | null; production_revision: number | null; episode_revision: number;
  collection_id: string | null; execution_summary?: Record<string, number>;
  timing?: LongFormTiming;
  blockers: Array<{ code: string; severity: 'blocking' | 'warning' | string; message: string; action: string }>;
  readiness: { blocking: number; warnings: number; state: 'READY' | 'READY WITH WARNINGS' | 'NEEDS REVIEW' | 'BLOCKED' | 'UNKNOWN' };
};

export type ProductionLine = {
  total: number; limit: number; offset: number; truncated: boolean; items: ProductionLineItem[];
  readiness_is_criteria_based?: boolean; note: string;
};

export type SeriesSlot = {
  slot_key: string; planned_date: string | null; episode_number: number | null; state: 'open' | 'preserved' | 'held' | 'blocked';
  existing_episode_id: string | null; note?: string | null;
};

export type SlotSet = {
  horizon: GenerateHorizon; timezone: string; today: string; cadence_metadata: Record<string, unknown>;
  slots: SeriesSlot[]; counts: { open: number; preserved: number; held: number; total: number }; note: string;
};

export type GenerateAheadPreview = SlotSet & {
  depth: GenerateDepth; depth_label: string; reuse: Array<{ asset_id: string; name: string }>;
  recent_titles: Array<{ episode_number: number | null; title: string }>; requires_confirmation: boolean;
  reuse_note: string; depth_note: string; do_not_overwrite: string;
  recent_jobs: Array<{ job_id: string; state: string; created_at: string }>; series_revision: number; note: string;
};

export type GenerateAheadResult = {
  job_id: string; shared_job_id: string | null; state: string; horizon: GenerateHorizon; depth: GenerateDepth;
  timezone: string; counts: { created: number; preserved: number; blocked: number; failed: number; planned: number };
  created_episodes: Array<{ episode_id: string; episode_number: number | null; production_id: string | null; title: string;
    planned_date: string | null; slot_key: string | null; topic_source?: string }>;
  blocked_slots: Array<{ slot_key: string; state: string; note?: string }>; preview: Record<string, unknown>; note: string;
};

export type GenerateAheadJob = {
  job_id: string; shared_job_id: string | null; state: string; horizon: GenerateHorizon; depth: GenerateDepth;
  timezone: string; created_count: number; preserved_count: number; blocked_count: number; failed_count: number;
  note?: string | null;
  items: Array<{ slot_key: string | null; planned_date: string | null; episode_number: number | null; state: string;
    created_production_id: string | null; created_episode_id: string | null; error_message: string | null }>;
};

export type SeriesDirectorAnswer = {
  resolution: { horizon: GenerateHorizon | null; avoid_recent_topics: boolean; ambiguous: boolean; note: string; signals?: string[] };
  context: { series_id: string; title: string; series_kind: SeriesKind; timezone: string; cadence_metadata: Record<string, unknown>;
    format_metadata_keys: string[]; recent_titles: Array<{ episode_number: number | null; title: string; planned_date: string | null; line_state: string }>;
    upcoming: Array<{ episode_id: string; episode_number: number | null; title: string; planned_date: string | null; production_line_state: string }>;
    avoid_list: string[] };
  next_horizon_label: GenerateHorizon | null; rule: string;
};

function structurePath(workspaceId: string, productionId: string) {
  return `/api/v1/workspaces/${workspaceId}/productions/${productionId}/long-form`;
}

function seriesPath(workspaceId: string, seriesId: string) {
  return `/api/v1/workspaces/${workspaceId}/series/${seriesId}`;
}

export const longFormService = {
  /** Series are workspace-owned rows; the tenant RLS policy is the access boundary. */
  async listSeries(workspaceId: string, projectId: string): Promise<SeriesRow[]> {
    const { data, error } = await requireSupabase().from('series').select('*')
      .eq('workspace_id', workspaceId).eq('project_id', projectId).eq('lifecycle', 'active')
      .order('updated_at', { ascending: false }).order('id');
    if (error) throw safeError(error);
    return data;
  },
  async structure(workspaceId: string, productionId: string, options: {
    level?: StructureLevel; scopeId?: string | null; limit?: number; offset?: number; expectedRevision?: number | null;
  } = {}): Promise<StructurePage> {
    const params = new URLSearchParams({ level: options.level ?? 'production', limit: String(options.limit ?? 50) });
    if (options.scopeId) params.set('scope_id', options.scopeId);
    if (options.offset) params.set('offset', String(options.offset));
    if (options.expectedRevision) params.set('expected_revision', String(options.expectedRevision));
    return authenticatedRequest<StructurePage>(`${structurePath(workspaceId, productionId)}/structure?${params}`);
  },
  async timing(workspaceId: string, productionId: string, expectedRevision?: number | null): Promise<LongFormTiming> {
    const params = new URLSearchParams();
    if (expectedRevision) params.set('expected_revision', String(expectedRevision));
    const suffix = params.toString();
    return authenticatedRequest<LongFormTiming>(`${structurePath(workspaceId, productionId)}/timing${suffix ? `?${suffix}` : ''}`);
  },
  async search(workspaceId: string, productionId: string, query: string, filters: {
    levels?: StructureLevel[]; characterAssetId?: string | null; environmentAssetId?: string | null;
    executionMethod?: string | null; approval?: string | null; limit?: number; offset?: number;
  } = {}): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query, limit: String(filters.limit ?? 40) });
    if (filters.levels?.length) params.set('levels', filters.levels.join(','));
    if (filters.characterAssetId) params.set('character_asset_id', filters.characterAssetId);
    if (filters.environmentAssetId) params.set('environment_asset_id', filters.environmentAssetId);
    if (filters.executionMethod) params.set('execution_method', filters.executionMethod);
    if (filters.approval) params.set('approval', filters.approval);
    if (filters.offset) params.set('offset', String(filters.offset));
    return authenticatedRequest<SearchResult>(`${structurePath(workspaceId, productionId)}/search?${params}`);
  },
  async scriptIndex(workspaceId: string, productionId: string, offset = 0): Promise<ScriptIndex> {
    return authenticatedRequest<ScriptIndex>(`${structurePath(workspaceId, productionId)}/script?limit=50&offset=${offset}`);
  },
  async context(workspaceId: string, productionId: string, level: StructureLevel, scopeId: string, budgetChars = 4000): Promise<ScopeContext> {
    const params = new URLSearchParams({ level, scope_id: scopeId, budget_chars: String(budgetChars) });
    return authenticatedRequest<ScopeContext>(`${structurePath(workspaceId, productionId)}/context?${params}`);
  },
  async summaries(workspaceId: string, productionId: string, offset = 0): Promise<{ items: StructureSummaryRow[]; total: number; truncated: boolean }> {
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/summaries?limit=100&offset=${offset}`);
  },
  async saveSummary(workspaceId: string, productionId: string, input: {
    level: Exclude<StructureLevel, 'shot'>; id: string; text: string; note?: string; expectedProductionRevision?: number | null;
  }) {
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/summaries`, {
      method: 'POST', body: JSON.stringify({ level: input.level, id: input.id, text: input.text, note: input.note ?? '',
        expected_production_revision: input.expectedProductionRevision ?? null }),
    });
  },
  async createAct(workspaceId: string, productionId: string, input: Record<string, unknown>, expectedRevision?: number | null) {
    const suffix = expectedRevision ? `?expected_revision=${expectedRevision}` : '';
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/acts${suffix}`, { method: 'POST', body: JSON.stringify(input) });
  },
  async updateAct(workspaceId: string, productionId: string, actId: string, patch: Record<string, unknown>, expectedRevision?: number | null) {
    const suffix = expectedRevision ? `?expected_revision=${expectedRevision}` : '';
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/acts/${actId}${suffix}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async createSequence(workspaceId: string, productionId: string, input: Record<string, unknown>, expectedRevision?: number | null) {
    const suffix = expectedRevision ? `?expected_revision=${expectedRevision}` : '';
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/sequences${suffix}`, { method: 'POST', body: JSON.stringify(input) });
  },
  async updateSequence(workspaceId: string, productionId: string, sequenceId: string, patch: Record<string, unknown>, expectedRevision?: number | null) {
    const suffix = expectedRevision ? `?expected_revision=${expectedRevision}` : '';
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/sequences/${sequenceId}${suffix}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async moveScene(workspaceId: string, productionId: string, sceneId: string, input: {
    expectedRevision: number; sequenceId?: string | null; actId?: string | null;
  }) {
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/scenes/${sceneId}/move`, {
      method: 'POST', body: JSON.stringify({ expected_revision: input.expectedRevision,
        sequence_id: input.sequenceId ?? null, act_id: input.actId ?? null }),
    });
  },
  async moveSequence(workspaceId: string, productionId: string, sequenceId: string, input: {
    expectedRevision: number; actId?: string | null;
  }) {
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/sequences/${sequenceId}/move`, {
      method: 'POST', body: JSON.stringify({ expected_revision: input.expectedRevision, act_id: input.actId ?? null }),
    });
  },
  async split(workspaceId: string, productionId: string, input: {
    level: 'act' | 'sequence'; id: string; splitOrder: number; expectedRevision: number; title?: string;
  }) {
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/split`, {
      method: 'POST', body: JSON.stringify({ level: input.level, id: input.id, split_order: input.splitOrder,
        expected_revision: input.expectedRevision, title: input.title ?? '' }),
    });
  },
  async reorder(workspaceId: string, productionId: string, input: {
    level: 'act' | 'sequence'; orderedIds: string[]; expectedStructureRevision?: number | null; parentId?: string | null;
  }) {
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/reorder`, {
      method: 'POST', body: JSON.stringify({ level: input.level, ordered_ids: input.orderedIds,
        expected_structure_revision: input.expectedStructureRevision ?? null, parent_id: input.parentId ?? null }),
    });
  },
  async setApproval(workspaceId: string, productionId: string, input: {
    level: 'act' | 'sequence'; id: string; approval: 'draft' | 'needs_review' | 'approved'; expectedRevision?: number | null;
  }) {
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/approval`, {
      method: 'POST', body: JSON.stringify({ level: input.level, id: input.id, approval: input.approval,
        expected_revision: input.expectedRevision ?? null }),
    });
  },
  async setLock(workspaceId: string, productionId: string, input: {
    level: 'act' | 'sequence'; id: string; locked: boolean; expectedRevision?: number | null;
  }) {
    return authenticatedRequest(`${structurePath(workspaceId, productionId)}/lock`, {
      method: 'POST', body: JSON.stringify({ level: input.level, id: input.id, locked: input.locked,
        expected_revision: input.expectedRevision ?? null }),
    });
  },
  async directorScope(workspaceId: string, productionId: string, text: string, level: StructureLevel = 'production', id?: string | null) {
    return authenticatedRequest<LongFormDirectorAnswer>(`${structurePath(workspaceId, productionId)}/director/scope`, {
      method: 'POST', body: JSON.stringify({ text, level, id: id ?? null }),
    });
  },
  async createSeries(workspaceId: string, projectId: string, input: Record<string, unknown>) {
    return authenticatedRequest<{ series_id: string; title: string; revision: number }>(
      `/api/v1/workspaces/${workspaceId}/projects/${projectId}/series`, { method: 'POST', body: JSON.stringify(input) });
  },
  async updateSeries(workspaceId: string, seriesId: string, patch: Record<string, unknown>) {
    return authenticatedRequest(seriesPath(workspaceId, seriesId), { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async overview(workspaceId: string, seriesId: string): Promise<SeriesOverview> {
    return authenticatedRequest<SeriesOverview>(seriesPath(workspaceId, seriesId));
  },
  async saveCollection(workspaceId: string, seriesId: string, input: { title: string; purpose?: string; collection_id?: string | null }) {
    return authenticatedRequest(`${seriesPath(workspaceId, seriesId)}/collections`, { method: 'POST', body: JSON.stringify(input) });
  },
  async createEpisode(workspaceId: string, seriesId: string, input: Record<string, unknown>) {
    return authenticatedRequest<{ episode_id: string; created: boolean; state: string; production_id: string | null;
      episode_number: number | null; title?: string; note?: string }>(`${seriesPath(workspaceId, seriesId)}/episodes`,
      { method: 'POST', body: JSON.stringify(input) });
  },
  async updateEpisode(workspaceId: string, seriesId: string, episodeId: string, patch: Record<string, unknown>) {
    return authenticatedRequest(`${seriesPath(workspaceId, seriesId)}/episodes/${episodeId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async slots(workspaceId: string, seriesId: string, options: {
    horizon?: GenerateHorizon; count?: number; baseDate?: string | null; holdSlots?: string[];
  } = {}): Promise<SlotSet> {
    const params = new URLSearchParams({ horizon: options.horizon ?? 'next_7' });
    if (options.count) params.set('count', String(options.count));
    if (options.baseDate) params.set('base_date', options.baseDate);
    if (options.holdSlots?.length) params.set('hold_slots', options.holdSlots.join(','));
    return authenticatedRequest<SlotSet>(`${seriesPath(workspaceId, seriesId)}/slots?${params}`);
  },
  async previewGenerateAhead(workspaceId: string, seriesId: string, input: Record<string, unknown>): Promise<GenerateAheadPreview> {
    return authenticatedRequest<GenerateAheadPreview>(`${seriesPath(workspaceId, seriesId)}/generate-ahead/preview`,
      { method: 'POST', body: JSON.stringify(input) });
  },
  async generateAhead(workspaceId: string, seriesId: string, input: Record<string, unknown>): Promise<GenerateAheadResult> {
    return authenticatedRequest<GenerateAheadResult>(`${seriesPath(workspaceId, seriesId)}/generate-ahead`,
      { method: 'POST', body: JSON.stringify({ ...input, confirm: true }) });
  },
  async jobs(workspaceId: string, seriesId: string, limit = 10): Promise<{ jobs: GenerateAheadJob[] }> {
    return authenticatedRequest<{ jobs: GenerateAheadJob[] }>(`${seriesPath(workspaceId, seriesId)}/jobs?limit=${limit}`);
  },
  async retry(workspaceId: string, jobId: string) {
    return authenticatedRequest(`/api/v1/workspaces/${workspaceId}/generate-ahead/jobs/${jobId}/retry`, { method: 'POST' });
  },
  async productionLine(workspaceId: string, seriesId: string, offset = 0): Promise<ProductionLine> {
    return authenticatedRequest<ProductionLine>(`${seriesPath(workspaceId, seriesId)}/production-line?limit=30&offset=${offset}`);
  },
  async seriesDirectorScope(workspaceId: string, seriesId: string, text: string, limit = 10): Promise<SeriesDirectorAnswer> {
    return authenticatedRequest<SeriesDirectorAnswer>(`${seriesPath(workspaceId, seriesId)}/director/scope`,
      { method: 'POST', body: JSON.stringify({ text, limit }) });
  },
};
