import { requireSupabase } from '../lib/supabase';
import { AppError, safeError } from './errors';
import type { Database } from '../types/database';
import type { Production, Row } from '../types/domain';
import { authenticatedRequest } from './api';
export const PAGE_SIZE = 40;
export type Confidence = 'high' | 'medium' | 'low';
export type Epistemic = 'observed' | 'estimated' | 'recommended' | 'unknown';
export type DirectorCollaborationMode = 'guide_step_by_step' | 'stop_at_major_decisions' | 'complete_first_draft';
export type DirectorIntent = { goal: string; collaboration_mode: DirectorCollaborationMode; secondary_types: Array<Database['tonde']['Enums']['production_type']>; primary_type: Database['tonde']['Enums']['production_type']; subject: string|null; audience?:string|null; platform: string|null; runtime_ms: number|null; aspect_ratio: string|null; execution: Database['tonde']['Enums']['execution_method']; execution_authority:'creator'|'tonde_decides'; tonde_decided:string[]; answered_decisions:Record<string,string>; dialogue_mode: string|null; constraints: Record<string, unknown>; tone:string[]; deliverables:string[]; provenance:string[]; confidence: Confidence; product_named?: boolean };
export type DirectorQuestion = { id: string; question: string; why: string; priority: string; impact: 'critical'|'high'|'medium'|'low'; confidence: Confidence; depends_on: string[]; options: string[]; allow_tonde_decides: boolean; blocking: boolean; answered: boolean; answer: string|null; would_change: string[] };
export type DirectorEvidenceRef = { kind: string; start_ms: number|null; end_ms: number|null; frame_id: string|null; detail: string };
export type DirectorFinding = { finding_id: string; category: string; statement: string; epistemic: Epistemic; confidence: Confidence; evidence: DirectorEvidenceRef[]; technique_id: string|null; limitations: string[] };
export type DirectorTechnique = { canonical_id: string; name: string; category: string; description: string; purpose: string; effect: string; importance: string; confidence: Confidence; practical_concept: string; ai_concept: string; conditions: string[]; limitations: string[] };
export type DirectorCausal = { question: string; explanation: string; drivers: string[]; confidence: Confidence };
export type DirectorStyleSection = { section: string; description: string; directives: string[]; epistemic: Epistemic; confidence: Confidence };
export type DirectorStyle = { palette: string[]; sections: DirectorStyleSection[] };
export type DirectorCapability = { capability: string; media_bytes: string; modalities: Record<string, string>; note: string; producer: string };
export type DirectorReferenceSurface = {
  reference_id: string; source_type: string; source_url: string|null; source_description: string; rights_classification: string;
  state: string; role: string; capability: DirectorCapability; status: string; stages: string[]; summary: string; producer: string;
  findings: DirectorFinding[]; techniques: DirectorTechnique[]; style: DirectorStyle | Record<string, never>; causal: DirectorCausal[];
  adaptation_notes: string[]; limitations: string[];
};
export type DirectorStoryBeat = { id: string; order: number; name: string; story_function: string; content: string; emotion: string; visual_idea: string; techniques: string[]; planned_duration_ms: number|null };
export type DirectorStory = { title: string; logline: string; premise: string; central_question: string; protagonist: string; desire: string; conflict: string; stakes: string; hook: string; payoff: string; call_to_action: string|null; beats: DirectorStoryBeat[]; emotional_progression: string[]; beginning: string; middle: string; ending: string; theme: string|null; grammar: string; variation: string; dialogue_mode: string|null; dialogue_approach: string|null; runtime_ms: number|null; producer: string; assumptions: string[] };
export type DirectorScriptLine = { order: number; kind: string; speaker: string|null; content: string; estimated_ms: number; intention: string; delivery: string; pause_after_ms: number; interruption: boolean; overlap: boolean; reaction_to: number|null; subtext: string; scene_order: number };
export type DirectorScriptScene = { scene_order: number; scene_title: string; heading: string; action: string[]; lines: DirectorScriptLine[]; product_direction: string; transition: string; notes: string; planned_duration_ms: number };
export type DirectorScript = { title: string; scenes: DirectorScriptScene[]; dialogue_mode: string|null; dialogue_approach: string|null; estimated_runtime_ms: number; producer: string };
export type DirectorDialogueLine = { id: string; scene_id: string|null; kind: string; speaker: string|null; content: string; duration_ms: number|null; intention: string; delivery: string; subtext: string; pause_after_ms: number|null; flags: Record<string, unknown> };
export type DirectorSceneSurface = { id: string; order: number|null; title: string; purpose: string; story_beat: string; description: string; action_lines: string[]; characters: string[]; environment: string; products: string[]; techniques: string[]; shots: Array<{order:number;title:string;description:string;intent:string;subject:string}>; dialogue_notes: string; planned_duration_ms: number|null; opening_state: string; ending_state: string; visual_intent: string; dialogue: DirectorDialogueLine[] };
export type DirectorRuntimeFit = { target_ms: number|null; assigned_ms: number; dialogue_ms: number; action_ms: number; slack_ms: number; status: 'fits'|'over'|'under'|'unresolved' };
export type DirectorRealityItem = { domain: string; requirement: string; status: string; resource: string|null; evidence: string[]; recommendation: string; confidence: Confidence };
export type DirectorRealityReport = { feasibility: 'ready'|'adapt'|'blocked'; complexity: 'simple'|'moderate'|'complex'; items: DirectorRealityItem[]; domains: Record<string, string>; conflicts: string[]; adaptations: Array<{scope:string;target:string;change:string;reason:string}>; summary: string; inventory_used: string[]; notes: string[] };
export type DirectorDecisionRecord = { decision_id: string; question: string; answer: string; priority: string; impact: string; decided_by: string; is_correction: boolean; decision_source: string|null };
export type DirectorOperationRecord = { operation_id: string; operation_type: string; scope: string; status: string; producer: string; provider: string|null; model: string|null; model_profile: string|null; repaired: boolean|null; attempts: number|null; rationale: string|null; limitations: string[]; schema_version: number|null; source_revision: number|null; idempotency_key: string|null; created_at: string|null };
export type DirectorProviderStatus = { provider: string; configured: boolean; model_profile: string; capabilities: string[]; notes: string[]; ffmpeg_available?: boolean; ffmpeg_note?: string; max_repair_attempts?: number };
export type DirectorBriefAssumption = { statement: string; basis: string; status: string };
export type DirectorBrief = {
  production_goal: string; audience: string|null; core_message: string|null; desired_response: string|null;
  production_type: string; format: string|null; platform: string|null; aspect_ratio: string|null;
  tone: string[]; creative_concept: string; story_approach: string; dialogue_mode: string|null; dialogue_approach: string|null;
  voiceover_approach: string|null; product_brand: string|null; product_category: string|null; call_to_action: string|null;
  style_direction: string[]; execution_preference: string; resources: string[]; crew_size: number|null; available_hours: number|null;
  deadline: string|null; budget_amount: number|null; cast: string[]; environments: string[]; deliverables: string[];
  hard_constraints: string[]; soft_preferences: string[]; collaboration_mode: string; producer: string; revision: number;
  runtime: { kind: string; exact_ms: number|null; min_ms: number|null; max_ms: number|null; note: string };
  style_dna: { sections: DirectorStyleSection[]; palette: string[]; producer: string } | null;
  assumptions: DirectorBriefAssumption[]; open_decisions: DirectorQuestion[];
  conflicts: Array<{ topic: string; values: string[]; impact: string; resolution: string; resolved_by: string }>;
};
export type DirectorCharacter = { name: string; role: string; story_function: string; objective: string; visual_description: string; performance_direction: string; relationships: string[]; recurring: boolean; discovered_from_reference: boolean };
export type DirectorEnvironment = { name: string; visual_requirements: string[]; story_purpose: string; spatial_needs: string[]; lighting_context: string; scene_usage: number[] };
export type DirectorProduct = { name: string; role: string; required_visibility: string; hero_moments: string[]; fidelity_importance: string; interactions: string[]; packaging_notes: string[] };
export type DirectorBundle = {
  production: { title: string; production_type: string; execution_method: string; planned_duration_ms: number|null };
  brief: DirectorBrief; story: DirectorStory|null;
  scenes: Array<{ order: number; title: string; purpose: string; story_beat: string; description: string; action_lines: string[]; planned_duration_ms: number; opening_state: string; ending_state: string; visual_intent: string }>;
  script: DirectorScript|null; characters: DirectorCharacter[]; environments: DirectorEnvironment[]; products: DirectorProduct[];
  wardrobe_props: Array<{ name: string; kind: string; requirement: string; scene_usage: number[]; source: string }>;
  style_bible: { title: string; summary: string; sections: DirectorStyleSection[]; producer: string } | null;
  reality: DirectorRealityReport; runtime_fit: DirectorRuntimeFit; techniques: DirectorTechnique[];
  decisions: Array<{ decision_id: string; question: string; answer: string; priority: string; impact: string; decided_by: string }>;
  producer: string; operation: Record<string, unknown>;
};
export type DirectorPlanResponse = {
  operation: { operation_id: string; status: string|null; producer: string };
  provider: DirectorProviderStatus; intent: DirectorIntent; questions: DirectorQuestion[];
  brief: DirectorBrief; story: DirectorStory|null; script: DirectorScript|null;
  scenes: DirectorBundle['scenes']; characters: DirectorCharacter[]; environments: DirectorEnvironment[]; products: DirectorProduct[];
  style_bible: DirectorBundle['style_bible']; reality: DirectorRealityReport; runtime_fit: DirectorRuntimeFit;
  producer: string; rationale: string[]; limitations: string[]; reference_influence: string[]; bundle: DirectorBundle;
};
export type DirectorCommitResponse = { production_id: string; operation_id: string; idempotent: boolean; production_revision?: number; scenes?: number; dialogue_lines?: number; assets?: unknown; runtime_ms?: number|null; duplicate_applied?: boolean };
export type DirectorStudioDocument = { title: string|null; content: string|null; revision: number|null; updated_at: string|null };
export type DirectorStudio = {
  production: { id: string; title: string; production_type: string; execution_method: string; planned_duration_ms: number|null; approval: string; locked_at: string|null; revision: number };
  brief: DirectorBrief|null; brief_revision: number|null; brief_producer: string|null;
  story: DirectorStory|null; story_variation: string|null; story_producer: string|null;
  scenes: DirectorSceneSurface[]; runtime_fit: DirectorRuntimeFit;
  documents: { brief?: DirectorStudioDocument; story?: DirectorStudioDocument; script?: DirectorStudioDocument };
  reality: DirectorRealityReport|null; reality_source_revision: number|null;
  setup_listed: string[]; reality_used_setup: boolean;
  references: DirectorReferenceSurface[]; techniques: DirectorTechnique[];
  decisions: DirectorDecisionRecord[]; operations: DirectorOperationRecord[];
  provider: DirectorProviderStatus; reference_roles: Record<string, string>;
};
export type DirectorCommandResult = {
  command: { kind: string; scope: string; confidence: Confidence; rationale: string; operations: string[]; signals: string[]; scene_order: number|null; reference_role: string|null; target_runtime_ms: number|null; parameters: Record<string, unknown> };
  rationale: string; answer: string|null; changes: string[]; operations: string[];
  limitations: string[]; causal: DirectorCausal[]; story_alternatives: DirectorStory[];
  line_alternatives: Record<string, string[]>; reference_role: string|null; adaptations_applied: string[];
  plan: DirectorBundle|null; producer: string; applied: DirectorCommitResponse|null;
};
export type DirectorCommandPreview = { kind: string; scope: string; confidence: Confidence; rationale: string; operations: string[]; signals: string[]; reference_role: string|null; target_runtime_ms: number|null; scene_order: number|null };
export type DirectorReferenceAnalysis = {
  analysis_id: string; reference_id: string; status: string; capability: DirectorCapability; summary: string; producer: string;
  techniques: DirectorTechnique[]; findings: DirectorFinding[]; style: DirectorStyle;
  causal: DirectorCausal[]; adaptation_notes: string[]; limitations: string[]; stages: string[];
  findings_saved: number|null; techniques_saved: number|null;
};
export type DirectorReferenceAnalysisSaved = { analysis_id: string; status: string; progress: number; stages: string[] };
export type DirectorStoryAlternatives = { selected_story: DirectorStory|null; alternatives: DirectorStory[]; note: string };
export type ProductionListOptions = {
  search?: string;
  lifecycle?: Database['tonde']['Enums']['lifecycle'];
  approval?: Database['tonde']['Enums']['approval'];
  approvals?: Database['tonde']['Enums']['approval'][];
};
export const productionService = {
  async list(workspaceId: string, offset = 0, options: ProductionListOptions = {}) {
    const client = requireSupabase();
    let query = client.from('productions').select('*').eq('workspace_id', workspaceId).eq('lifecycle', options.lifecycle ?? 'active').order('updated_at', { ascending: false }).order('id');
    if (options.approvals?.length) query = query.in('approval', options.approvals);
    else if (options.approval) query = query.eq('approval', options.approval);
    const search = options.search?.trim().replace(/[\\%_]/g, '\\$&');
    if (search) query = query.ilike('title', `%${search}%`);
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw safeError(error);
    return data;
  },
  async getArchived(workspaceId: string, offset = 0, options: Omit<ProductionListOptions, 'lifecycle'> = {}) {
    return this.list(workspaceId, offset, { ...options, lifecycle: 'archived' });
  },
  async getReferences(workspaceId: string, productionId: string) {
    const { data, error } = await requireSupabase().from('production_references').select('*').eq('workspace_id', workspaceId).eq('production_id', productionId).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    if (error) throw safeError(error);
    return data;
  },
  async listReferences(workspaceId: string) {
    const { data, error } = await requireSupabase().from('production_references').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    if (error) throw safeError(error);
    return data;
  },
  async get(workspaceId: string, id: string): Promise<Production> {
    const { data, error } = await requireSupabase().from('productions').select('*').eq('workspace_id', workspaceId).eq('id', id).neq('lifecycle', 'deleted').single();
    if (error) throw safeError(error);
    return data;
  },
  async create(workspaceId: string, title: string, kind: Database['tonde']['Enums']['production_type'] = 'custom') {
    const { data, error } = await requireSupabase().rpc('create_project_with_production', { target_workspace: workspaceId, production_title: title.trim(), kind });
    if (error) throw safeError(error);
    return data;
  },
  async saveTitle(production: Production, title: string): Promise<Production> {
    const { data, error } = await requireSupabase().from('productions').update({ title: title.trim() }).eq('workspace_id', production.workspace_id).eq('id', production.id).eq('revision', production.revision).select().maybeSingle();
    if (error) throw safeError(error);
    if (!data) throw new AppError('conflict', 'This production changed elsewhere. Reload the latest version before saving.');
    return data;
  },
  async archive(production: Production) {
    await this.setLifecycle(production, 'archived');
  },
  async restore(production: Production) {
    await this.setLifecycle(production, 'active');
  },
  async setLifecycle(production: Production, lifecycle: Database['tonde']['Enums']['lifecycle']) {
    const { data, error } = await requireSupabase().from('productions').update({ lifecycle }).eq('workspace_id', production.workspace_id).eq('id', production.id).eq('revision', production.revision).select('id').maybeSingle();
    if (error) throw safeError(error);
    if (!data) throw new AppError('conflict', 'This production changed elsewhere. Refresh and retry.');
  },
  async addReference(workspaceId: string, productionId: string, reference: {
    source_type: Database['tonde']['Enums']['reference_source'];
    source_url?: string | null;
    source_description?: string | null;
    media_id?: string | null;
    state?: Database['tonde']['Enums']['reference_state'];
    provenance?: Row<'production_references'>['provenance'];
  }) {
    const { data, error } = await requireSupabase().from('production_references').insert({
      workspace_id: workspaceId, production_id: productionId, rights_classification: 'unknown', ...reference,
    }).select('id').single();
    if (error) throw safeError(error);
    return data.id;
  },
  async scenes(workspaceId: string, productionId: string, offset = 0) {
    const { data, error } = await requireSupabase().from('scenes').select('*').eq('workspace_id', workspaceId).eq('production_id', productionId).eq('lifecycle', 'active').order('sort_order').range(offset, offset + PAGE_SIZE - 1);
    if (error) throw safeError(error);
    return data;
  },
  async shots(workspaceId: string, productionId: string, sceneId: string, offset = 0) {
    const { data, error } = await requireSupabase().from('shots').select('*').eq('workspace_id', workspaceId).eq('production_id', productionId).eq('scene_id', sceneId).eq('lifecycle', 'active').order('sort_order').range(offset, offset + PAGE_SIZE - 1);
    if (error) throw safeError(error);
    return data;
  },
  async directorProviderStatus(workspaceId: string, productionId: string) {
    return authenticatedRequest<DirectorProviderStatus>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/provider`);
  },
  async directorStudioSurface(workspaceId: string, productionId: string) {
    return authenticatedRequest<DirectorStudio>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/studio`);
  },
  async directorPlan(workspaceId: string, productionId: string, input: { goal?: string; collaboration_mode?: DirectorCollaborationMode; answered_decisions?: Record<string,string>; variation?: string; include_optional_questions?: boolean }) {
    return authenticatedRequest<DirectorPlanResponse>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/plan`, { method: 'POST', body: JSON.stringify(input) });
  },
  async directorCommit(workspaceId: string, productionId: string, input: { operation_id: string; expected_production_revision: number; bundle: DirectorBundle; explicit_confirmation: true }) {
    return authenticatedRequest<DirectorCommitResponse>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/commit`, { method: 'POST', body: JSON.stringify(input) });
  },
  async directorCommand(workspaceId: string, productionId: string, input: { text: string; apply?: boolean; expected_production_revision?: number; operation_id?: string }) {
    return authenticatedRequest<DirectorCommandResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/command`, { method: 'POST', body: JSON.stringify(input) });
  },
  async directorCommandPreview(workspaceId: string, productionId: string, text: string) {
    return authenticatedRequest<DirectorCommandPreview>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/command/preview`, { method: 'POST', body: JSON.stringify({ text }) });
  },
  async analyzeDirectorReference(workspaceId: string, productionId: string, input: { reference_id?: string; source_type?: string; role?: string; media_id?: string; goal?: string; mime?: string; filename?: string; data_base64?: string }) {
    return authenticatedRequest<DirectorReferenceAnalysis>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/reference/analyze`, { method: 'POST', body: JSON.stringify(input) });
  },
  async saveDirectorBrief(workspaceId: string, productionId: string, expectedBriefRevision: number|null, brief: DirectorBrief) {
    return authenticatedRequest<{ brief: DirectorBrief; revision: number; producer: string }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/brief`, { method: 'POST', body: JSON.stringify({ expected_brief_revision: expectedBriefRevision, brief }) });
  },
  async recordDirectorDecisions(workspaceId: string, productionId: string, decisions: Record<string, string>, source: 'intake'|'studio'|'correction'|'tonde_default', questions: Record<string, string>) {
    return authenticatedRequest<{ stored: number; source: string }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/decisions`, { method: 'POST', body: JSON.stringify({ decisions, source, questions }) });
  },
  async directorStoryAlternatives(workspaceId: string, productionId: string, count = 3, variation?: string) {
    return authenticatedRequest<DirectorStoryAlternatives>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/story/alternatives`, { method: 'POST', body: JSON.stringify({ count, variation: variation ?? null }) });
  },
  async directorDialogueOperation(workspaceId: string, productionId: string, operation: string, sceneOrder?: number) {
    return authenticatedRequest<{ operation: string; answer: string|null; limitations: string[]; line_alternatives: Record<string, string[]>; plan: DirectorBundle|null }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/director/dialogue/operation`, { method: 'POST', body: JSON.stringify({ operation, scene_order: sceneOrder ?? null }) });
  },
};
