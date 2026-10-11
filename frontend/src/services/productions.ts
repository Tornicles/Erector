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
export type IntakeDecisionOption = { id: string; label: string; description: string };
export type IntakeDecision = {
  id: string; topic: string; question: string; why: string; answer_mode: 'single_select'|'multi_select'|'freeform'|'yes_no'|'duration';
  options: IntakeDecisionOption[]; recommendation: { option_ids: string[]; reason: string };
  state: 'open'|'answered'|'tonde_decided'; impact: 'critical'|'high'|'medium';
  answer: string|null; answered_by: string|null; allow_tonde_decides: boolean;
  blocking: boolean; answered: boolean;
};
export type IntakeFact = { key: string; label: string; value: string; confidence: Confidence; source: string; evidence: string[]; confirmed: boolean };
export type IntakeRawDecision = {
  decision_id: string; topic: string; question: string; why: string; answer_mode: IntakeDecision['answer_mode'];
  options: IntakeDecisionOption[]; recommendation: { option_ids: string[]; reason: string };
  rank?: number; state: IntakeDecision['state']; impact: IntakeDecision['impact'];
  answer: string|null; answered_by: string|null;
};
export function normalizeIntakeDecision(raw: IntakeDecision | IntakeRawDecision): IntakeDecision {
  if ('id' in raw) return raw as IntakeDecision;
  const item = raw as IntakeRawDecision;
  return {
    id: item.decision_id, topic: item.topic, question: item.question, why: item.why,
    answer_mode: item.answer_mode, options: item.options ?? [],
    recommendation: item.recommendation ?? { option_ids: [], reason: '' },
    state: item.state, impact: item.impact, answer: item.answer ?? null,
    answered_by: item.answered_by ?? null, allow_tonde_decides: true,
    blocking: item.impact === 'critical', answered: item.state !== 'open',
  };
}
export function normalizeIntakeDecisions(raw: Array<IntakeDecision | IntakeRawDecision>): IntakeDecision[] {
  return (raw ?? []).map(normalizeIntakeDecision);
}
export type IntakeAnalysisState = {
  production_family: string; known: IntakeFact[]; inferred: IntakeFact[]; deferred: string[];
  material_unknowns: Array<IntakeDecision | IntakeRawDecision>; decisions: Array<IntakeDecision | IntakeRawDecision>; enough_to_direct: boolean;
  blocking_open: number; creative_direction_summary: string; creative_facts: string[]; producer: string;
};
export type DirectorEvidenceRef = { kind: string; start_ms: number|null; end_ms: number|null; frame_id: string|null; detail: string };
export type DirectorFinding = { finding_id: string; category: string; statement: string; epistemic: Epistemic; confidence: Confidence; evidence: DirectorEvidenceRef[]; technique_id: string|null; limitations: string[] };
export type DirectorTechnique = { canonical_id: string; name: string; category: string; description: string; purpose: string; effect: string; importance: string; confidence: Confidence; practical_concept: string; ai_concept: string; conditions: string[]; limitations: string[] };
export type DirectorCausal = { question: string; explanation: string; drivers: string[]; confidence: Confidence };
export type DirectorStyleSection = { section: string; description: string; directives: string[]; epistemic: Epistemic; confidence: Confidence };
export type DirectorStyle = { palette: string[]; sections: DirectorStyleSection[] };
export type DirectorCapability = { capability: string; media_bytes: string; modalities: Record<string, string>; note: string; producer: string };
export type DirectorReferenceSurface = {
  reference_id: string; source_type: string; source_url: string|null; source_description: string; source_identity: string|null;
  source_provider: string|null; identity_provenance: string; source_identity_verified_at: string|null;
  creator_purpose: string|null; learning_targets: string[]; revision: number; shaping_ready: boolean; rights_classification: string;
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
  intake_analysis: IntakeAnalysisState; decisions: IntakeDecision[];
  brief: DirectorBrief; story: DirectorStory|null; script: DirectorScript|null;
  scenes: DirectorBundle['scenes']; characters: DirectorCharacter[]; environments: DirectorEnvironment[]; products: DirectorProduct[];
  style_bible: DirectorBundle['style_bible']; reality: DirectorRealityReport; runtime_fit: DirectorRuntimeFit;
  producer: string; rationale: string[]; limitations: string[]; reference_influence: string[]; bundle: DirectorBundle;
};
export type DirectorCommitResponse = { production_id: string; operation_id: string; idempotent: boolean; production_revision?: number; scenes?: number; dialogue_lines?: number; assets?: unknown; runtime_ms?: number|null; duplicate_applied?: boolean };
export type DirectorStudioDocument = { document_id?: string|null; title: string|null; content: string|null; revision: number|null; updated_at: string|null };
export type ProductionAudioPlan = {
  id: string; workspace_id: string; production_id: string; overall_intent: string; dialogue_strategy: string;
  music_strategy: string; sound_design_strategy: string; ambience_strategy: string; recording_considerations: string;
  silence_strategy: string; recurring_motifs: string[]; continuity_considerations: string; delivery_considerations: string;
  intentional_silence: boolean; master_song_reference_id: string|null; master_song_provenance: string;
  direction_state: 'needs_direction'|'planned'|'intentional_silence'; approval: StudioApproval;
  locked_at: string|null; revision: number;
};
export type SceneAudioDirection = {
  id: string; workspace_id: string; production_id: string; scene_id: string; music_use: string; music_direction: string;
  cue_start_ms: number|null; cue_end_ms: number|null; cue_duration_ms: number|null; music_purpose: string;
  rhythmic_quality: string; instrumentation: string; dynamics: string; diegetic: boolean|null; dialogue_relationship: string;
  action_relationship: string; motif_relationship: string; master_song_reference_id: string|null; sound_use: string;
  sound_direction: string; sound_events: string[]; recording_needs: string; microphone_considerations: string;
  voice_treatment: string; continuity_considerations: string; approval: StudioApproval; locked_at: string|null; revision: number;
};
export type ProductionAudioSurface = { audio_plan: ProductionAudioPlan|null; scene_directions: SceneAudioDirection[] };

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
export type StudioScope = 'production' | 'scene' | 'shot';
export type StudioApproval = Database['tonde']['Enums']['approval'];
export type StudioExecutionContext = Database['tonde']['Enums']['execution_method'];
export type StudioTimingState = 'derived' | 'incomplete' | 'planned';
export type StudioTiming = {
  total_ms: number; target_ms: number|null; delta_ms: number|null;
  status: 'fits'|'over'|'under'|'unresolved';
  scene_states: Array<{ scene_id: string; order: number; duration_ms: number; shots: number; timing: StudioTimingState }>;
};
export type StudioBinding = { id: string; binding_role: string; asset_id: string|null; reference_id: string|null; inheritance: string; locked_at: string|null };
export type StudioShot = {
  id: string; scene_id: string|null; order: number|null; sort_order: number; title: string;
  description: string; action: string; purpose: string; subject: string; framing: string; angle: string;
  movement: string; composition: string; transition: string; story_relationship: string; story_beat: string;
  creative_notes: string; execution_method: StudioExecutionContext; planned_duration_ms: number|null;
  approval: StudioApproval; locked_at: string|null; revision: number; updated_at: string|null;
  result_count: number; bindings: StudioBinding[];
};
export type StudioScene = {
  id: string; order: number; sort_order: number; title: string; purpose: string; story_beat: string;
  description: string; action_lines: string[]; opening_state: string; ending_state: string;
  visual_intent: string; dialogue_notes: string; environment_asset_id: string|null;
  planned_duration_ms: number|null; duration_ms: number; timing: StudioTimingState;
  approval: StudioApproval; locked_at: string|null; revision: number; updated_at: string|null;
  character_asset_ids: string[]; dialogue_lines: number; shot_count: number;
  bindings: StudioBinding[]; shots: StudioShot[];
};
export type StudioAsset = {
  id: string; asset_type: Database['tonde']['Enums']['asset_type']; name: string; description: string;
  approval: StudioApproval; locked_at: string|null; revision: number;
  metadata: Record<string, unknown>; used_by_scenes: string[];
};
export type StudioTimelineShot = {
  shot_id: string; order: number|null; title: string; duration_ms: number|null;
  execution_method: StudioExecutionContext; approval: StudioApproval; locked: boolean;
};
export type StudioTimelineScene = {
  scene_id: string; order: number; title: string; duration_ms: number; timing: StudioTimingState;
  approval: StudioApproval; locked: boolean; execution_methods: string[]; shots: StudioTimelineShot[];
};
export type StudioStatusSummary = {
  production_approval: StudioApproval; production_locked: boolean; scenes: number; shots: number;
  scenes_locked: number; shots_locked: number; approval_counts: Record<string, number>; needs_attention: number;
};
export type StudioReadModel = {
  production: {
    id: string; workspace_id: string; title: string; production_type: string; custom_type: string|null;
    execution_method: StudioExecutionContext; planned_duration_ms: number|null; calculated_duration_ms: number|null;
    approval: StudioApproval; locked_at: string|null; revision: number; lifecycle: string; updated_at: string|null;
  };
  scenes: StudioScene[]; orphan_shots: StudioShot[]; assets: StudioAsset[];
  documents: Record<string, DirectorStudioDocument & { approval?: StudioApproval; locked_at?: string|null }>;
  timing: StudioTiming; runtime_conflict: boolean; timeline: StudioTimelineScene[];
  status_summary: StudioStatusSummary; truncated: boolean;
  provider: DirectorProviderStatus;
  capabilities: { frame_extraction: boolean; frame_extraction_note: string; timeline_editing: boolean; shot_execution: boolean; ai_prompt_compilation: boolean; note: string };
};
export type StudioWriteResult = {
  scene_id?: string; shot_id?: string; title?: string; revision?: number; approval?: StudioApproval;
  sort_order?: number; execution_method?: StudioExecutionContext; scenes?: number; shots?: number;
  archived?: boolean; archived_shots?: number; timing: StudioTiming;
};
// --- Prompt 6 Real Production: how to actually shoot each Shot ------------------
export type RealReadiness = 'unplanned' | 'ready' | 'ready_with_substitution' | 'needs_decision' | 'missing_resource' | 'safety_blocked';
export type RealPlanStatus = 'draft' | 'ready' | 'ready_with_substitution' | 'needs_decision' | 'missing_resource' | 'safety_blocked';
export type RealRequirementStatus = Database['tonde']['Enums']['requirement_status'];
export type RealEpistemic = Database['tonde']['Enums']['epistemic'];
export type RealCaptureStatus = Database['tonde']['Enums']['capture_status'];
export type RealTakeStatus = Database['tonde']['Enums']['take_status'];
export type RealDeviationField = 'camera' | 'lens' | 'movement' | 'stabilization' | 'camera_position' | 'lighting' | 'sound' | 'location' | 'performance' | 'product' | 'duration' | 'other';
export type RealConstraint = 'use_only_owned' | 'phone_only' | 'one_light' | 'no_gimbal' | 'available_light_only' | 'simplify' | 'faster' | 'safer' | 'solo' | 'reduced_time' | 'lost_location' | 'lost_light';
export type RealSoloFeasibility = 'solo' | 'solo_with_simplification' | 'second_person_recommended' | 'crew_required';
export type RealPlan = {
  plan_id?: string; shot_id?: string; approval?: StudioApproval; locked?: boolean; revision?: number;
  plan_status: RealPlanStatus; readiness_note: string; complexity: 'quick'|'moderate'|'complex'|null;
  complexity_is_estimate: boolean; generated_by: string; camera_resource_id: string|null; lens_resource_id: string|null;
  shot_size: string; camera_position: string; camera_height: string; camera_angle: string; framing: string;
  composition: string; perspective_note: string; movement: string; movement_purpose: string; stabilization: string;
  capture_fps: string; delivery_fps: string; shutter: string; aperture: string; iso_range: string;
  white_balance: string; nd_filter: string; exposure_note: string; focus_strategy: string; depth_of_field: string;
  lighting_intent: string; lighting_plan: string; lighting_diagram: Record<string, unknown>; blocking: string;
  performance: string; product_direction: string; sound_plan: string; microphone_plan: string; sync_strategy: string;
  solo_feasibility: RealSoloFeasibility|null; crew_roles: string[]; environment_requirements: string[];
  location_requirements: string[]; safety_notes: string[]; safety_flags: string[]; editorial_intent: string;
  setup_steps: string[]; capture_checklist: string[]; expected_duration_ms: number|null;
};
export type RealRequirement = {
  id?: string; kind: string; label: string; ideal_name: string; detail: string; setup_note?: string;
  alternative: string; status: RealRequirementStatus; epistemic: RealEpistemic; resource_type: string|null;
  resource_id: string|null; substitute_resource_id: string|null; resource_name?: string|null;
  substitute_name?: string|null; sort_order?: number;
};
export type RealAlternative = { id?: string; kind: string; label: string; description: string; expected_impact: string; tradeoffs: string[]; sort_order?: number };
export type RealTake = { take_id?: string; id?: string; shot_id?: string; take_number: number; status: RealTakeStatus; notes: string; preferred?: boolean; media_id?: string|null; recorded_at?: string|null; revision?: number };
export type RealCaptureState = { id?: string; shot_id?: string; status: RealCaptureStatus; notes: string; captured_at: string|null; revision: number };
export type RealDeviation = { id?: string; field: RealDeviationField; planned_value: string; actual_value: string; reason: string; recorded_at: string|null };
export type RealSetupItem = {
  id: string; resource_type: string; name: string; manufacturer: string|null; model: string|null;
  mount: string|null; stabilization: boolean|null; metadata: Record<string, unknown>;
};
export type RealShotSummary = {
  shot_id: string; scene_id: string|null; scene_order: number; scene_title: string|null; order: number;
  title: string; purpose: string; subject: string; framing: string; execution_method: StudioExecutionContext;
  approval: StudioApproval; locked: boolean; planned_duration_ms: number|null; expected_duration_ms: number|null;
  plan_id: string|null; plan_revision: number|null; plan_status: RealPlanStatus|null; readiness: RealReadiness;
  readiness_note: string; complexity: 'quick'|'moderate'|'complex'|null; camera_resource_id: string|null;
  lens_resource_id: string|null; movement: string; stabilization: string; lighting_intent: string;
  sound_plan: string; solo_feasibility: RealSoloFeasibility|null; crew_roles: string[]; safety_flags: string[];
  requirements: { owned: number; substitute: number; missing: number; unverified: number };
  capture: { status: RealCaptureStatus; notes: string; captured_at: string|null; revision: number } | null;
  takes: { count: number; preferred_take_id: string|null }; deviations: number;
};
export type RealSurface = {
  production: { id: string; workspace_id: string; title: string; production_type: string; execution_method: StudioExecutionContext;
    planned_duration_ms: number|null; approval: StudioApproval; locked_at: string|null; revision: number; lifecycle: string };
  execution_faces: string[]; setup: RealSetupItem[]; timing: StudioTiming;
  scenes: Array<{ scene_id: string; order: number; title: string; shots: number; ready: number; unresolved: number;
    captured: number; pickup_needed: number; complexity: string|null; unresolved_note: string|null }>;
  shots: RealShotSummary[];
  summary: { shots: number; planned: number; unplanned: number; ready: number; ready_with_substitution: number;
    needs_decision: number; missing_resource: number; safety_blocked: number; captured: number; pickup_needed: number;
    in_progress: number; approved_plans: number; changed_after_approval: number; crew_roles: string[];
    safety_flags: string[]; complexity: string|null };
  readiness_queue: { ready_to_shoot: string[]; needs_decision: string[]; missing_resource: string[]; pickup_required: string[] };
  provider: DirectorProviderStatus;
  capabilities: { frame_extraction: boolean; frame_extraction_note: string; setup_matching: boolean; take_logging: boolean; on_set_mode: boolean; ai_prompt_compilation: boolean; note: string };
};
export type RealShotDetail = {
  shot: { shot_id: string; scene_id: string|null; title: string; purpose: string; subject: string; framing: string;
    movement: string; execution_method: StudioExecutionContext; approval: StudioApproval; locked: boolean;
    revision: number; planned_duration_ms: number|null; story_beat: string; creative_notes: string };
  scene: { scene_id: string; title: string; order: number; purpose: string; description: string; environment_asset_id: string|null } | null;
  plan: RealPlan | null; readiness: RealReadiness; requirements: RealRequirement[]; alternatives: RealAlternative[];
  capture: RealCaptureState | null; takes: RealTake[]; deviations: RealDeviation[]; setup: RealSetupItem[];
  brief: Record<string, unknown> | null; script_line: Record<string, unknown> | null;
};
export type RealPlanWriteResult = {
  plan_id: string; shot_id: string; plan_revision: number; approval: StudioApproval; plan_status: RealPlanStatus;
  readiness: RealReadiness; requirements: number; alternatives: number; timing: StudioTiming;
};
export type RealDirectionResult = {
  applied: RealPlanWriteResult | null; plan: RealPlan;
  answer: { summary: string; why: string; affected: string[]; readiness: RealPlanStatus; readiness_note: string;
    missing: string[]; substitutes: string[]; unverified: string[]; safety: string[]; truthfulness: string };
  requirements: RealRequirement[]; alternatives: RealAlternative[]; scope: string; shot_id: string;
};
// --- Prompt 7 AI Creation & Hybrid Director: how to generate each Shot ----------------
export type AiCapabilityState = 'SUPPORTED' | 'PARTIALLY SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN' | 'REQUIRES CONNECTION';
export type AiConnectionState = 'not_connected' | 'connected' | 'unavailable';
export type AiOperation = 'image' | 'video' | 'image_to_video' | 'video_to_video' | 'voice' | 'speech' | 'music'
  | 'sound_effect' | 'upscale' | 'background_removal' | 'image_edit' | 'frame_interpolation' | 'lipsync' | 'compositing';
export type AiReadiness = 'unplanned' | 'stale' | 'needs_reference' | 'needs_model' | 'needs_decision' | 'unsupported'
  | 'provider_not_connected' | 'cost_confirmation' | 'ready_to_generate' | 'manual_export';
export type AiPlanStatus = 'draft' | 'ready' | 'needs_decision';
export type AiAttemptStatus = 'planned' | 'queued' | 'submitted' | 'processing' | 'succeeded' | 'partial' | 'failed'
  | 'cancelled' | 'expired';
export type AiAttemptMode = 'live' | 'manual';
export type AiContinuityPriority = 'MUST PRESERVE' | 'SHOULD PRESERVE' | 'FLEXIBLE';
export type AiLockScope = 'character' | 'world' | 'product' | 'style';
export type AiFidelity = 'critical' | 'high' | 'flexible';
export type AiBatchScope = 'shot' | 'scene' | 'selection' | 'production';
export type AiBatchItemState = 'pending' | 'blocked' | 'submitted' | 'succeeded' | 'failed' | 'skipped';
export type AiCostState = 'known' | 'unknown';
export type AiReference = {
  reference_id: string; role: string; priority: AiContinuityPriority; asset_id: string | null;
  media_id: string | null; origin: string; source_attempt_id?: string | null; note: string;
  sort_order: number; asset_name?: string | null; asset_type?: string | null;
};
export type AiLock = {
  lock_id: string; scope: AiLockScope; subject_id: string | null; label: string; locked: boolean;
  priority: AiContinuityPriority; locked_traits: string[]; allowed_variations: string[];
  prohibited_changes: string[]; identity_truth: string; consent_note: string; note: string;
  locked_at: string | null; revision: number;
};
export type AiModelOption = {
  model_profile_id: string; provider_key: string; model_key: string; label: string; operation: AiOperation;
  capability_state: AiCapabilityState; availability: string; cost_known: boolean; cost_unit: string;
  cost_amount: number | null; cost_currency: string; supports_image_reference: boolean;
  supports_first_frame: boolean; supports_last_frame: boolean; max_duration_ms: number | null; source: string;
};
export type AiModelCatalogRow = AiModelOption & {
  modalities: string[]; max_reference_images: number | null; supports_seed: boolean;
  supports_negative_prompt: boolean; supports_camera_control: boolean; supports_audio: boolean;
  supports_image_edit: boolean; supports_lipsync: boolean; aspect_ratios: string[]; resolutions: string[];
  speed_note: string; identity_note: string; product_fidelity_note: string; safety_note: string;
  capability_notes: Record<string, unknown>; declared: boolean; known: boolean; connected: boolean;
};
export type AiConnection = {
  provider_key: string; label: string; connection_required: boolean; manual_export_supported: boolean;
  state: AiConnectionState; credential_reference: string; connected_at: string | null;
};
export type AiAttempt = {
  attempt_id: string; attempt_number: number; operation: AiOperation; provider_key: string; model_key: string;
  model_version: string; model_profile_id: string | null; prompt_version: number | null;
  source_shot_revision: number | null; mode: AiAttemptMode; status: AiAttemptStatus;
  external_job_id: string | null; seed: number | null; settings: Record<string, unknown>;
  input_references: Array<Record<string, unknown>>; cost_state: AiCostState; cost_amount: number | null;
  cost_currency: string; retryable: boolean | null; retry_of: string | null; started_at: string | null;
  completed_at: string | null; failure_code: string; failure_message: string; output_media_id: string | null;
  result_id: string | null; result_state: string | null; selected: boolean; creator_rating: number | null;
  creator_decision: string; idempotency_key: string; created_at: string | null; revision: number;
};
export type AiSelectedResult = {
  attempt_id: string; attempt_number: number; status: AiAttemptStatus; provider_key: string; model_key: string;
  result_id: string | null; output_media_id: string | null; result_state: string | null; selected: boolean;
  completed_at: string | null;
};
export type AiBatchItem = {
  batch_id: string; state: AiBatchItemState; blocked_reason: string; attempt_id: string | null;
  failure_code: string; failure_message: string; created_at: string | null;
};
export type AiRoutingChoice = {
  kind: string; model_profile_id: string | null; provider_key: string; model_key: string; label: string;
  reason: string; cost_state: AiCostState; cost_amount: number | null; cost_currency: string;
};
export type AiRouting = {
  recommended: AiRoutingChoice | null; fallback: AiRoutingChoice | null; alternatives: AiRoutingChoice[];
  excluded: Array<{ model_profile_id: string; provider_key: string; model_key: string; state: string; reasons: string[] }>;
  reasoning: string[]; manual_export: AiRoutingChoice | null; connection_required: boolean;
  format?: string; only_connected?: boolean; capability_notes?: Record<string, unknown>;
};
export type AiPrompt = {
  plan_id?: string; shot_id?: string; execution_method?: string; approval?: StudioApproval; locked?: boolean;
  revision?: number; plan_status: AiPlanStatus; readiness_note: string; generated_by: string;
  prompt_version: number | null; source_shot_revision: number | null; shot_revision: number | null;
  prompt_stale: boolean; source_versions: Record<string, unknown>;
  canonical_prompt: Record<string, string>; provider_prompt: string; provider_prompt_edited: boolean;
  provider_prompt_edited_at: string | null;
  provider_target: string | null; model_profile_id: string | null; fallback_model_profile_id: string | null;
  model_version: string; model: string; provider: string; routing: AiRouting | Record<string, unknown>;
  first_frame: Record<string, unknown>; last_frame: Record<string, unknown>;
  motion: Record<string, unknown>; audio: Record<string, unknown>; continuity: Record<string, unknown>;
  hybrid: Record<string, unknown>; negative_constraints: string[]; limitations: string[];
  aspect_ratio: string; expected_duration_ms: number | null; cost_state: AiCostState;
  cost_amount: number | null; cost_currency: string; cost_note: string;
  shot_size: string; framing: string; composition: string; movement: string; movement_purpose: string;
  lighting_intent: string; performance: string; product_direction: string; sound_plan: string;
  editorial_intent: string; updated_at: string | null;
  model_profile: Record<string, unknown> | null; connection: Record<string, unknown> | null;
};
export type AiAnswer = {
  summary: string; why: string; model: { provider_key: string; model_key: string; label: string; reason: string;
    cost_state: AiCostState; cost_amount: number | null; cost_currency: string } | null;
  method: string; method_reasons: string[]; needs_reference: boolean; limitations: string[]; truthfulness: string;
  direction_applied: string[]; direction_note: string;
};
export type AiHybridDecision = {
  method: string; reasons: string[]; shoot_component: string; generate_component: string; combine: string[];
  matching: string[]; limitations: string[]; plate_requirements: string[];
  factors: Record<string, unknown>; advisory: boolean;
};
export type AiShotSummary = {
  shot_id: string; scene_id: string | null; title: string; purpose: string; order: number | null;
  execution_method: StudioExecutionContext; approval: StudioApproval; locked: boolean; revision: number;
  planned_duration_ms: number | null; readiness: AiReadiness; plan_id: string | null;
  plan_revision: number | null; plan_status: AiPlanStatus | null; prompt_version: number | null;
  prompt_stale: boolean; provider_target: string | null; model_profile_id: string | null;
  model_label: string | null; model_key: string | null; capability_state: AiCapabilityState | null;
  cost_state: AiCostState; cost_amount: number | null; cost_currency: string; aspect_ratio: string;
  expected_duration_ms: number | null; hybrid: Record<string, unknown> | null;
};
export type AiSurface = {
  production: { id: string; workspace_id: string; title: string; production_type: string;
    execution_method: StudioExecutionContext; planned_duration_ms: number | null; approval: StudioApproval;
    locked_at: string | null; revision: number; lifecycle: string };
  execution_faces: string[]; connections: AiConnection[]; models: AiModelOption[];
  known_models: Array<{ provider_key: string; model_key: string; operation: AiOperation; declared: boolean; capability_state: AiCapabilityState }>;
  locks: AiLock[];
  scenes: Array<{ scene_id: string; order: number; title: string; shots: number; ready: number; blocked: number;
    unplanned: number; selected: number }>;
  shots: AiShotSummary[];
  summary: { shots: number; ai_or_hybrid: number; real: number; planned: number; ready: number; manual_export: number;
    blocked: number; stale: number; with_selected_result: number; connected_providers: number; declared_models: number };
  capabilities: { prompt_compilation: boolean; model_routing: boolean; live_generation: boolean;
    manual_export: boolean; note: string };
  provider: DirectorProviderStatus;
  live_generation: boolean;
  truthfulness: string;
};
export type AiShotDetail = {
  shot: { shot_id: string; scene_id: string | null; title: string; description: string; action: string;
    purpose: string; subject: string; framing: string; angle: string; movement: string; composition: string;
    transition: string; story_relationship: string; story_beat: string; creative_notes: string;
    execution_method: StudioExecutionContext; approval: StudioApproval; locked: boolean; revision: number;
    planned_duration_ms: number | null };
  scene: { scene_id: string; title: string; order: number; purpose: string; description: string;
    environment_asset_id: string | null } | null;
  readiness: AiReadiness; plan: AiPrompt | null; real_plan: Record<string, unknown> | null;
  references: AiReference[]; locks: AiLock[]; attempts: AiAttempt[]; selected_result: AiSelectedResult | null;
  batch_items: AiBatchItem[];
  script_line: { dialogue_id: string; line_type: string; speaker: string | null; content: string;
    duration_ms: number | null } | null;
};
export type AiDirectionResult = {
  applied: { plan_id?: string; plan_revision?: number; approval?: StudioApproval; plan_status?: AiPlanStatus; readiness?: AiReadiness } | null;
  answer: AiAnswer; plan: AiPrompt; routing: AiRouting; hybrid: AiHybridDecision;
  references: Array<Record<string, unknown>>; scope: string; shot_id: string;
};
export type AiAttemptWrite = {
  attempt_id: string; shot_id?: string; attempt_number?: number; status: AiAttemptStatus;
  idempotent?: boolean; billed?: boolean; operation?: AiOperation;
};
export type AiBatchPreview = {
  scope: string; shots?: number; ready?: number; blocked?: number; blocked_shots?: string[];
  estimated_cost?: number | null; cost_state?: AiCostState; confirmation_required?: boolean;
  required_references?: string[]; note?: string;
};
export type AiBatchWrite = { batch_id: string; state: string; items?: number; created?: number; skipped?: number };
export type AiHybridOverrideResult = {
  advisory: boolean; recommended: AiHybridDecision; creator_choice: string; creator_reason: string | null;
  override_recorded: Record<string, unknown> | null; already: boolean; note: string; shot_id: string;
  truthfulness: string;
};
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
    source_identity?: string | null;
    source_provider?: string | null;
    identity_provenance?: Row<'production_references'>['identity_provenance'];
    source_identity_verified?: boolean;
    creator_purpose?: string | null;
    learning_targets?: string[];
    provenance?: Row<'production_references'>['provenance'];
  }) {
    const { source_identity_verified, identity_provenance: _provenance, ...fields } = reference;
    const { data, error } = await requireSupabase().from('production_references').insert({
      ...fields, workspace_id: workspaceId, production_id: productionId,
      rights_classification: 'unknown', identity_provenance: 'unknown',
    }).select('id,revision').single();
    if (error) throw safeError(error);
    if (source_identity_verified) {
      await authenticatedRequest(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/references/${data.id}`, {
        method: 'POST', body: JSON.stringify({ expected_revision: data.revision,
          source_identity: reference.source_identity, source_provider: reference.source_provider,
          source_identity_verified: true, creator_purpose: reference.creator_purpose,
          learning_targets: reference.learning_targets ?? [] }),
      });
    }
    return data.id;
  },
  async updateReference(workspaceId: string, productionId: string, referenceId: string, expectedRevision: number, values: {
    source_identity: string | null; source_provider: string | null; identity_provenance: Row<'production_references'>['identity_provenance'];
    source_identity_verified: boolean; creator_purpose: string | null; learning_targets: string[];
  }): Promise<void> {
    const { identity_provenance: _provenance, ...attestation } = values;
    await authenticatedRequest(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/references/${referenceId}`, {
      method: 'POST', body: JSON.stringify({ expected_revision: expectedRevision, ...attestation }),
    });
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
  async productionAudioSurface(workspaceId: string, productionId: string) {
    return authenticatedRequest<ProductionAudioSurface>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/audio`);
  },
  async saveProductionAudioPlan(workspaceId: string, productionId: string, expectedRevision: number|null, values: Partial<Omit<ProductionAudioPlan, 'id'|'workspace_id'|'production_id'|'direction_state'|'approval'|'locked_at'|'revision'>>) {
    return authenticatedRequest<ProductionAudioPlan>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/audio`, { method: 'POST', body: JSON.stringify({ expected_revision: expectedRevision, ...values }) });
  },
  async saveSceneAudioDirection(workspaceId: string, productionId: string, sceneId: string, expectedRevision: number|null, values: Partial<Omit<SceneAudioDirection, 'id'|'workspace_id'|'production_id'|'scene_id'|'approval'|'locked_at'|'revision'>>) {
    return authenticatedRequest<SceneAudioDirection>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/audio/scenes/${sceneId}`, { method: 'POST', body: JSON.stringify({ expected_revision: expectedRevision, ...values }) });
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
  // Prompt 5 Studio: one Master Production, canonical Scenes and Shots, revision-checked writes.
  async studioSurface(workspaceId: string, productionId: string) {
    return authenticatedRequest<StudioReadModel>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio`);
  },
  async studioTiming(workspaceId: string, productionId: string, expectedRevision?: number) {
    const query = expectedRevision ? `?expected_revision=${expectedRevision}` : '';
    return authenticatedRequest<StudioTiming>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/timing${query}`);
  },
  async createStudioScene(workspaceId: string, productionId: string, input: Record<string, unknown>) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/scenes`, { method: 'POST', body: JSON.stringify(input) });
  },
  async updateStudioScene(workspaceId: string, productionId: string, sceneId: string, input: Record<string, unknown>) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/scenes/${sceneId}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  async reorderStudioScenes(workspaceId: string, productionId: string, orderedIds: string[], expectedRevision?: number) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/scenes/reorder`, { method: 'POST', body: JSON.stringify({ ordered_ids: orderedIds, expected_production_revision: expectedRevision ?? null }) });
  },
  async archiveStudioScene(workspaceId: string, productionId: string, sceneId: string, expectedRevision: number|null, cascade: boolean) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/scenes/${sceneId}/archive`, { method: 'POST', body: JSON.stringify({ expected_revision: expectedRevision, cascade }) });
  },
  async createStudioShot(workspaceId: string, productionId: string, input: Record<string, unknown>) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/shots`, { method: 'POST', body: JSON.stringify(input) });
  },
  async updateStudioShot(workspaceId: string, productionId: string, shotId: string, input: Record<string, unknown>) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/shots/${shotId}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  async moveStudioShot(workspaceId: string, productionId: string, shotId: string, sceneId: string|null, expectedRevision: number) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/shots/${shotId}/move`, { method: 'POST', body: JSON.stringify({ scene_id: sceneId, expected_revision: expectedRevision }) });
  },
  async reorderStudioShots(workspaceId: string, productionId: string, sceneId: string, orderedIds: string[], expectedRevision?: number) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/scenes/${sceneId}/shots/reorder`, { method: 'POST', body: JSON.stringify({ ordered_ids: orderedIds, expected_production_revision: expectedRevision ?? null }) });
  },
  async archiveStudioShot(workspaceId: string, productionId: string, shotId: string, expectedRevision: number|null) {
    return authenticatedRequest<StudioWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/shots/${shotId}/archive`, { method: 'POST', body: JSON.stringify({ expected_revision: expectedRevision }) });
  },
  async setStudioApproval(workspaceId: string, productionId: string, scope: StudioScope, id: string, approval: StudioApproval, expectedRevision: number|null) {
    return authenticatedRequest<{ scope: string; id: string; approval: StudioApproval; revision: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/approval`, { method: 'POST', body: JSON.stringify({ scope, id, approval, expected_revision: expectedRevision }) });
  },
  async setStudioLock(workspaceId: string, productionId: string, scope: StudioScope, id: string, locked: boolean, expectedRevision: number|null) {
    return authenticatedRequest<{ scope: string; id: string; locked: boolean; revision: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/lock`, { method: 'POST', body: JSON.stringify({ scope, id, locked, expected_revision: expectedRevision }) });
  },
  async reconcileStudioRuntime(workspaceId: string, productionId: string, absorbScene: string, expectedRevision?: number) {
    return authenticatedRequest<{ adjusted_ms: number; shot_id?: string; scene_id?: string; shot_duration_ms?: number; timing: StudioTiming }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/studio/runtime/reconcile`, { method: 'POST', body: JSON.stringify({ absorb_scene: absorbScene, expected_production_revision: expectedRevision ?? null }) });
  },
  // Prompt 6 Real Production: how to actually shoot each Shot with what you own.
  async realSurface(workspaceId: string, productionId: string) {
    return authenticatedRequest<RealSurface>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/surface`);
  },
  async realShotDetail(workspaceId: string, productionId: string, shotId: string) {
    return authenticatedRequest<RealShotDetail>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}`);
  },
  async directRealShot(workspaceId: string, productionId: string, shotId: string, input: { text?: string; constraints?: RealConstraint[]; apply?: boolean; expected_shot_revision?: number|null }) {
    return authenticatedRequest<RealDirectionResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}/direct`, { method: 'POST', body: JSON.stringify({ text: input.text ?? '', constraints: input.constraints ?? [], apply: input.apply ?? false, expected_shot_revision: input.expected_shot_revision ?? null }) });
  },
  async directRealScene(workspaceId: string, productionId: string, sceneId: string, input: { text?: string; constraints?: RealConstraint[]; apply?: boolean }) {
    return authenticatedRequest<{ scope: string; scene_id: string; applied: boolean; shots: Array<{ shot_id: string; plan?: RealPlan; applied?: RealPlanWriteResult }>; skipped: Array<{ shot_id: string; reason: string }>; summary: { directed: number; skipped: number } }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/scenes/${sceneId}/direct`, { method: 'POST', body: JSON.stringify({ text: input.text ?? '', constraints: input.constraints ?? [], apply: input.apply ?? false }) });
  },
  async saveRealPlan(workspaceId: string, productionId: string, shotId: string, input: { plan: RealPlan; requirements?: RealRequirement[]; alternatives?: RealAlternative[]; expected_shot_revision?: number|null }) {
    return authenticatedRequest<RealPlanWriteResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}/plan`, { method: 'POST', body: JSON.stringify({ expected_shot_revision: input.expected_shot_revision ?? null, plan: input.plan, requirements: input.requirements ?? [], alternatives: input.alternatives ?? [] }) });
  },
  async setRealPlanApproval(workspaceId: string, productionId: string, shotId: string, approval: StudioApproval, expectedShotRevision: number|null) {
    return authenticatedRequest<{ plan_id: string; shot_id: string; approval: StudioApproval; revision: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}/plan/approval`, { method: 'POST', body: JSON.stringify({ approval, expected_shot_revision: expectedShotRevision }) });
  },
  async setRealPlanLock(workspaceId: string, productionId: string, shotId: string, locked: boolean, expectedShotRevision: number|null) {
    return authenticatedRequest<{ plan_id: string; shot_id: string; locked: boolean; revision: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}/plan/lock`, { method: 'POST', body: JSON.stringify({ locked, expected_shot_revision: expectedShotRevision }) });
  },
  async setShotCaptureState(workspaceId: string, productionId: string, shotId: string, status: RealCaptureStatus, notes = '', expectedRevision: number|null = null) {
    return authenticatedRequest<RealCaptureState>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}/capture`, { method: 'POST', body: JSON.stringify({ status, notes, expected_revision: expectedRevision }) });
  },
  async saveShotTake(workspaceId: string, productionId: string, shotId: string, input: { take_number: number; status?: RealTakeStatus; notes?: string; take_id?: string|null; expected_revision?: number|null }) {
    return authenticatedRequest<RealTake>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}/takes`, { method: 'POST', body: JSON.stringify({ take_number: input.take_number, status: input.status ?? 'recorded', notes: input.notes ?? '', take_id: input.take_id ?? null, expected_revision: input.expected_revision ?? null }) });
  },
  async deleteShotTake(workspaceId: string, productionId: string, shotId: string, takeId: string) {
    return authenticatedRequest<{ take_id: string; shot_id: string; take_number: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}/takes/${takeId}`, { method: 'DELETE' });
  },
  async recordShotDeviation(workspaceId: string, productionId: string, shotId: string, input: { field: RealDeviationField; planned_value?: string; actual_value?: string; reason?: string }) {
    return authenticatedRequest<{ deviation_id: string; shot_id: string; field: RealDeviationField; planned_value: string; actual_value: string; recorded_at: string }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/real/shots/${shotId}/deviations`, { method: 'POST', body: JSON.stringify({ field: input.field, planned_value: input.planned_value ?? '', actual_value: input.actual_value ?? '', reason: input.reason ?? '' }) });
  },
  // Prompt 7 AI Creation: the same Shots, planned for generation. Nothing here invents a
  // capability, a price or a connection, and nothing generates without a connected provider.
  async aiSurface(workspaceId: string, productionId: string) {
    return authenticatedRequest<AiSurface>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/surface`);
  },
  async aiShotDetail(workspaceId: string, productionId: string, shotId: string) {
    return authenticatedRequest<AiShotDetail>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}`);
  },
  async aiModels(workspaceId: string) {
    return authenticatedRequest<{ providers: Array<{ provider_key: string; label: string; connection_required: boolean; manual_export_supported: boolean; connection: Record<string, unknown> }>; models: AiModelCatalogRow[]; known_models: AiModelCatalogRow[] }>(`/api/v1/workspaces/${workspaceId}/ai/models`);
  },
  async declareAiModel(workspaceId: string, input: { provider_key: string; model_key: string } & Record<string, unknown>) {
    return authenticatedRequest<{ model_profile_id?: string; declared?: boolean }>(`/api/v1/workspaces/${workspaceId}/ai/models`, { method: 'POST', body: JSON.stringify(input) });
  },
  async setAiConnection(workspaceId: string, input: { provider_key: string; state: AiConnectionState; credential_reference?: string; note?: string; expected_revision?: number | null }) {
    return authenticatedRequest<{ provider_key: string; state: AiConnectionState; note?: string }>(`/api/v1/workspaces/${workspaceId}/ai/connections`, { method: 'POST', body: JSON.stringify({ credential_reference: '', note: '', ...input }) });
  },
  async directAiShot(workspaceId: string, productionId: string, shotId: string, input: { apply?: boolean; text?: string; expected_shot_revision?: number | null; expected_plan_revision?: number | null; model_profile_id?: string | null; references?: Array<Record<string, unknown>>; continuity?: Record<string, unknown>; routing?: Record<string, unknown>; hybrid?: Record<string, unknown>; audio?: Record<string, unknown>; first_frame?: Record<string, unknown>; last_frame?: Record<string, unknown>; negative_constraints?: string[] }) {
    // 'apply' belongs to the hybrid block in the plan body: asking the Director for an answer and
    // writing it to the Shot are two different requests, and the plan schema does not accept both.
    const { apply, hybrid, ...rest } = input;
    return authenticatedRequest<AiDirectionResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/direct`, { method: 'POST', body: JSON.stringify({ ...rest, hybrid: { ...(hybrid ?? {}), apply: apply ?? false } }) });
  },
  async saveAiPlan(workspaceId: string, productionId: string, shotId: string, input: Record<string, unknown>) {
    return authenticatedRequest<{ plan_id: string; plan_revision: number; plan_status: AiPlanStatus; readiness: AiReadiness; prompt_version: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/plan`, { method: 'POST', body: JSON.stringify(input) });
  },
  async setAiPlanApproval(workspaceId: string, productionId: string, shotId: string, approval: StudioApproval, expectedRevision: number | null) {
    return authenticatedRequest<{ plan_id: string; approval: StudioApproval; revision: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/plan/approval`, { method: 'POST', body: JSON.stringify({ approval, expected_revision: expectedRevision }) });
  },
  async setAiPlanLock(workspaceId: string, productionId: string, shotId: string, locked: boolean, expectedRevision: number | null) {
    return authenticatedRequest<{ plan_id: string; locked: boolean; revision: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/plan/lock`, { method: 'POST', body: JSON.stringify({ locked, expected_revision: expectedRevision }) });
  },
  async confirmAiCost(workspaceId: string, productionId: string, shotId: string, note = '') {
    return authenticatedRequest<{ confirmed: boolean; note?: string }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/cost/confirm`, { method: 'POST', body: JSON.stringify({ note }) });
  },
  async setAiLock(workspaceId: string, productionId: string, input: { scope: AiLockScope; locked: boolean } & Record<string, unknown>) {
    return authenticatedRequest<{ lock_id: string; scope: AiLockScope; locked: boolean; revision: number }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/locks`, { method: 'POST', body: JSON.stringify(input) });
  },
  async createAiAttempt(workspaceId: string, productionId: string, shotId: string, input: { idempotency_key: string } & Record<string, unknown>) {
    return authenticatedRequest<AiAttemptWrite>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/attempts`, { method: 'POST', body: JSON.stringify(input) });
  },
  async updateAiAttempt(workspaceId: string, productionId: string, shotId: string, attemptId: string, input: Record<string, unknown>) {
    return authenticatedRequest<{ attempt_id: string; updated: boolean }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/attempts/${attemptId}`, { method: 'POST', body: JSON.stringify(input) });
  },
  async selectAiResult(workspaceId: string, productionId: string, shotId: string, attemptId: string) {
    return authenticatedRequest<{ attempt_id: string; selected: boolean; result_state: string | null; note?: string }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/results/${attemptId}/select`, { method: 'POST', body: JSON.stringify({}) });
  },
  async aiBatchPreview(workspaceId: string, productionId: string, input: { scope: AiBatchScope; scene_id?: string | null; shot_id?: string | null; shot_ids?: string[] }) {
    return authenticatedRequest<AiBatchPreview>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/batches/preview`, { method: 'POST', body: JSON.stringify(input) });
  },
  async createAiBatch(workspaceId: string, productionId: string, input: { scope: AiBatchScope; confirmed: boolean } & Record<string, unknown>) {
    return authenticatedRequest<AiBatchWrite>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/batches`, { method: 'POST', body: JSON.stringify(input) });
  },
  async recordAiBatchItem(workspaceId: string, productionId: string, batchId: string, shotId: string, input: { state: AiBatchItemState } & Record<string, unknown>) {
    return authenticatedRequest<{ batch_id: string; shot_id: string; state: AiBatchItemState }>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/batches/${batchId}/shots/${shotId}`, { method: 'POST', body: JSON.stringify(input) });
  },
  async aiHybridDecision(workspaceId: string, productionId: string, shotId: string, input: { execution_method: 'shoot' | 'generate' | 'hybrid'; reason?: string; expected_shot_revision?: number | null }) {
    return authenticatedRequest<AiHybridOverrideResult>(`/api/v1/workspaces/${workspaceId}/productions/${productionId}/ai/shots/${shotId}/hybrid`, { method: 'POST', body: JSON.stringify({ reason: '', expected_shot_revision: null, ...input }) });
  },
};
