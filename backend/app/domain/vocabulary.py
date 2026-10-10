# Generated from PostgreSQL migrations and product/vocabulary.json; do not hand-edit.
from enum import StrEnum

class ExecutionMethod(StrEnum):
    real = "real"
    ai = "ai"
    hybrid = "hybrid"


class ProductionType(StrEnum):
    social_video = "social_video"
    commercial = "commercial"
    advertisement = "advertisement"
    youtube = "youtube"
    interview = "interview"
    documentary = "documentary"
    music_video = "music_video"
    photography = "photography"
    portrait = "portrait"
    product_photography = "product_photography"
    fashion = "fashion"
    food = "food"
    automotive = "automotive"
    architecture = "architecture"
    campaign = "campaign"
    thumbnail = "thumbnail"
    poster = "poster"
    short_film = "short_film"
    long_form_film = "long_form_film"
    series = "series"
    recurring_content = "recurring_content"
    custom = "custom"
    product_film = "product_film"
    trailer = "trailer"


class Lifecycle(StrEnum):
    active = "active"
    archived = "archived"
    deleted = "deleted"


class ApprovalStatus(StrEnum):
    draft = "draft"
    needs_review = "needs_review"
    approved = "approved"
    changed_after_approval = "changed_after_approval"


class ResultStatus(StrEnum):
    raw = "raw"
    needs_review = "needs_review"
    approved = "approved"
    rejected = "rejected"
    final = "final"


class AssetCategory(StrEnum):
    character = "character"
    voice = "voice"
    product = "product"
    environment = "environment"
    wardrobe = "wardrobe"
    prop = "prop"
    vehicle = "vehicle"
    style_bible = "style_bible"
    brand = "brand"


class ResourceCategory(StrEnum):
    camera = "camera"
    phone_camera = "phone_camera"
    lens = "lens"
    light = "light"
    modifier = "modifier"
    stand = "stand"
    microphone = "microphone"
    recorder = "recorder"
    wireless_audio = "wireless_audio"
    gimbal = "gimbal"
    tripod = "tripod"
    monopod = "monopod"
    slider = "slider"
    drone = "drone"
    action_camera = "action_camera"
    filter = "filter"
    monitor = "monitor"
    rigging = "rigging"
    accessory = "accessory"
    editing_software = "editing_software"
    photo_software = "photo_software"
    ai_tool = "ai_tool"


class ReferenceRights(StrEnum):
    user_owned = "user_owned"
    licensed = "licensed"
    brand_owned = "brand_owned"
    authorized_identity = "authorized_identity"
    public_reference = "public_reference"
    third_party_inspiration = "third_party_inspiration"
    unknown = "unknown"


class ReferenceState(StrEnum):
    received = "received"
    metadata_available = "metadata_available"
    media_available = "media_available"
    processing = "processing"
    analyzed = "analyzed"
    partially_analyzed = "partially_analyzed"
    inaccessible = "inaccessible"
    failed = "failed"


class ReferenceSource(StrEnum):
    upload = "upload"
    url = "url"
    social_url = "social_url"
    cloud_import = "cloud_import"
    recording = "recording"
    asset = "asset"
    movie = "movie"
    description = "description"
    generated_result = "generated_result"
    previous_production = "previous_production"


class DialogueKind(StrEnum):
    dialogue = "dialogue"
    voiceover = "voiceover"
    narration = "narration"
    pause = "pause"
    reaction = "reaction"


class ScopeInheritance(StrEnum):
    inherit = "inherit"
    override = "override"
    exclude = "exclude"


class ProposalState(StrEnum):
    proposed = "proposed"
    applied = "applied"
    rejected = "rejected"


class SeriesKind(StrEnum):
    narrative = "narrative"
    recurring = "recurring"


class PlanningDepth(StrEnum):
    idea = "idea"
    outlined = "outlined"
    story_defined = "story_defined"
    scripted = "scripted"
    scenes_planned = "scenes_planned"
    shots_planned = "shots_planned"
    execution_planned = "execution_planned"
    in_progress = "in_progress"


class SequenceKind(StrEnum):
    narrative = "narrative"
    mission = "mission"
    location = "location"
    topic = "topic"
    montage = "montage"
    action = "action"
    documentary = "documentary"
    thematic = "thematic"
    custom = "custom"


class StructureLevel(StrEnum):
    production = "production"
    act = "act"
    sequence = "sequence"
    scene = "scene"
    shot = "shot"


class GenerateHorizon(StrEnum):
    tomorrow = "tomorrow"
    next_7 = "next_7"
    next_14 = "next_14"
    next_30 = "next_30"
    entire_series = "entire_series"
    custom = "custom"


class GenerateDepth(StrEnum):
    ideas_only = "ideas_only"
    briefs = "briefs"
    story = "story"
    script = "script"
    complete_plan = "complete_plan"


class DependencyStrength(StrEnum):
    hard = "hard"
    soft = "soft"
    advisory = "advisory"


class DependencyOrigin(StrEnum):
    explicit = "explicit"
    derived = "derived"
    inferred = "inferred"


class ImpactClass(StrEnum):
    direct = "direct"
    downstream = "downstream"
    potential = "potential"
    unaffected = "unaffected"
    unknown = "unknown"


class ImpactMode(StrEnum):
    preview = "preview"
    update_all = "update_all"
    review_changes = "review_changes"
    change_only_this = "change_only_this"


class ArtifactKind(StrEnum):
    real_plan = "real_plan"
    ai_plan = "ai_plan"
    prompt = "prompt"
    first_frame = "first_frame"
    last_frame = "last_frame"
    generation_context = "generation_context"
    result_comparison = "result_comparison"
    derived_summary = "derived_summary"
    continuity_state = "continuity_state"
    continuity_analysis = "continuity_analysis"
    deliverable = "deliverable"
    dependent_object = "dependent_object"
    other = "other"


class StaleState(StrEnum):
    current = "current"
    stale = "stale"
    conflicted = "conflicted"


class ContinuityDomain(StrEnum):
    character = "character"
    wardrobe = "wardrobe"
    prop = "prop"
    product = "product"
    vehicle = "vehicle"
    injury = "injury"
    hair_makeup = "hair_makeup"
    weather = "weather"
    time_of_day = "time_of_day"
    environment = "environment"
    lighting = "lighting"
    story_knowledge = "story_knowledge"
    dialogue_fact = "dialogue_fact"
    screen_direction = "screen_direction"
    eyeline = "eyeline"
    camera_geography = "camera_geography"
    position = "position"
    product_condition = "product_condition"
    other = "other"


class ContinuityAnchor(StrEnum):
    production = "production"
    scene_opening = "scene_opening"
    scene_ending = "scene_ending"
    shot = "shot"


class ContinuityTransition(StrEnum):
    baseline = "baseline"
    continuous = "continuous"
    changed = "changed"


class ContinuityOrigin(StrEnum):
    declared = "declared"
    derived = "derived"
    inferred = "inferred"


class ContinuityFindingKind(StrEnum):
    unexplained_change = "unexplained_change"
    boundary_break = "boundary_break"
    missing_reason = "missing_reason"
    lock_conflict = "lock_conflict"
    unverified_after = "unverified_after"


class ContinuityFindingState(StrEnum):
    open = "open"
    acknowledged = "acknowledged"
    resolved = "resolved"
    waived = "waived"


class MemoryScope(StrEnum):
    production = "production"
    series = "series"
    workspace = "workspace"


class MemoryKind(StrEnum):
    preference = "preference"
    decision = "decision"
    pattern = "pattern"
    technique = "technique"
    setup_fact = "setup_fact"
    asset_usage = "asset_usage"
    model_outcome = "model_outcome"
    series_rule = "series_rule"
    correction = "correction"
    other = "other"


class MemorySource(StrEnum):
    creator_instruction = "creator_instruction"
    production_decision = "production_decision"
    saved_preference = "saved_preference"
    historical_pattern = "historical_pattern"
    inference = "inference"


class MemoryOrigin(StrEnum):
    declared = "declared"
    accepted = "accepted"
    inferred = "inferred"


class BranchState(StrEnum):
    open = "open"
    merged = "merged"
    abandoned = "abandoned"


class BranchChangeState(StrEnum):
    pending = "pending"
    applied = "applied"
    conflicted = "conflicted"
    rejected = "rejected"


class MergeState(StrEnum):
    proposed = "proposed"
    merged = "merged"
    rejected = "rejected"


class AccessAction(StrEnum):
    approve = "approve"
    request_review = "request_review"
    reopen = "reopen"
    lock = "lock"
    unlock = "unlock"


class ReadinessState(StrEnum):
    ready = "ready"
    ready_with_warnings = "ready_with_warnings"
    needs_review = "needs_review"
    blocked = "blocked"
    unknown = "unknown"


class ReadinessDimension(StrEnum):
    decisions = "decisions"
    story = "story"
    script = "script"
    scene_plan = "scene_plan"
    shots = "shots"
    continuity = "continuity"
    resources = "resources"
    real_execution = "real_execution"
    ai_execution = "ai_execution"
    approvals = "approvals"
    dependencies = "dependencies"
    results = "results"
    delivery = "delivery"


class MatchVerdict(StrEnum):
    matches_intent = "matches_intent"
    acceptable_variation = "acceptable_variation"
    needs_attention = "needs_attention"
    mismatch = "mismatch"
    unknown = "unknown"


class CorrectionState(StrEnum):
    proposed = "proposed"
    applied = "applied"
    rejected = "rejected"


class CorrectionRecommendation(StrEnum):
    none = "none"
    pickup_required = "pickup_required"
    regeneration_recommended = "regeneration_recommended"
    both = "both"


class MatchOrigin(StrEnum):
    deterministic = "deterministic"
    creator = "creator"
    ai_proposal = "ai_proposal"


class PublicationState(StrEnum):
    draft = "draft"
    ready = "ready"
    awaiting_authorization = "awaiting_authorization"
    submitting = "submitting"
    submitted = "submitted"
    processing = "processing"
    published = "published"
    failed = "failed"
    cancelled = "cancelled"
    removed = "removed"
    unknown_remote_state = "unknown_remote_state"


class PublicationFailureCategory(StrEnum):
    authentication_failed = "authentication_failed"
    insufficient_scope = "insufficient_scope"
    rate_limited = "rate_limited"
    invalid_media = "invalid_media"
    invalid_metadata = "invalid_metadata"
    provider_unavailable = "provider_unavailable"
    quota_exceeded = "quota_exceeded"
    remote_processing_failed = "remote_processing_failed"
    destination_rejected = "destination_rejected"
    policy_violation = "policy_violation"
    unknown = "unknown"


class ExportKind(StrEnum):
    full_document = "full_document"
    production_package = "production_package"


class ExportState(StrEnum):
    requested = "requested"
    building = "building"
    ready = "ready"
    failed = "failed"
    expired = "expired"


class SubscriptionState(StrEnum):
    none = "none"
    trialing = "trialing"
    active = "active"
    past_due = "past_due"
    incomplete = "incomplete"
    cancel_at_period_end = "cancel_at_period_end"
    cancelled = "cancelled"
    suspended = "suspended"


class EntitlementKind(StrEnum):
    feature = "feature"
    quota = "quota"


class EntitlementSource(StrEnum):
    plan = "plan"
    grant = "grant"


class UsageCostBasis(StrEnum):
    actual = "actual"
    estimated = "estimated"
    unknown = "unknown"


class ReservationState(StrEnum):
    reserved = "reserved"
    committed = "committed"
    released = "released"


class WebhookState(StrEnum):
    received = "received"
    processing = "processing"
    processed = "processed"
    failed = "failed"
    ignored = "ignored"


class CheckoutState(StrEnum):
    started = "started"
    completed = "completed"
    abandoned = "abandoned"
    expired = "expired"


class CommercialActor(StrEnum):
    webhook = "webhook"
    server = "server"
    admin = "admin"


class ClaimKind(StrEnum):
    observed = "observed"
    estimated = "estimated"
    recommended = "recommended"


class MediaModality(StrEnum):
    metadata = "metadata"
    thumbnail = "thumbnail"
    image = "image"
    video_frames = "video_frames"
    audio = "audio"
    text = "text"


class AccessState(StrEnum):
    available = "available"
    inaccessible = "inaccessible"
    not_requested = "not_requested"


class CollaborationMode(StrEnum):
    guide_step_by_step = "guide_step_by_step"
    stop_at_major_decisions = "stop_at_major_decisions"
    complete_first_draft = "complete_first_draft"


class OperationOutcome(StrEnum):
    complete = "complete"
    partial = "partial"


class MutationAction(StrEnum):
    revise = "revise"
    reorder = "reorder"
    bind = "bind"
    assign_execution = "assign_execution"
    lock = "lock"
    unlock = "unlock"


CONSTITUTION_VERSION = "1.3.0"
DEFAULT_EXECUTION_FACE = ExecutionMethod.real
