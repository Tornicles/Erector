"""
Erector Centralized Enum Registry
All enums are defined here and mirrored to frontend/mobile TypeScript types.
"""

from enum import Enum


class UserType(str, Enum):
    individual = "individual"
    team = "team"
    developer = "developer"
    consultant = "consultant"
    enterprise = "enterprise"
    admin = "admin"


class ExperienceLevel(str, Enum):
    first_venture = "first_venture"
    experienced = "experienced"
    expert = "expert"


class GoalType(str, Enum):
    business = "business"
    project = "project"
    career = "career"
    side_income = "side_income"
    creator = "creator"
    startup = "startup"
    team_execution = "team_execution"
    market_entry = "market_entry"
    fundraising = "fundraising"
    crisis_recovery = "crisis_recovery"


class ValidationDepth(str, Enum):
    quick_overview = "quick_overview"
    full_deep_validation = "full_deep_validation"
    enterprise_depth = "enterprise_depth"
    api_depth = "api_depth"


class SubscriptionTier(str, Enum):
    free = "free"
    starter = "starter"
    growth = "growth"
    premium = "premium"
    team = "team"
    enterprise = "enterprise"
    api = "api"


class TeamRole(str, Enum):
    owner = "owner"
    admin = "admin"
    contributor = "contributor"
    analyst = "analyst"
    viewer = "viewer"
    client = "client"


class ValidationStatus(str, Enum):
    draft = "draft"
    context_collecting = "context_collecting"
    context_collected = "context_collected"
    economic_stack_built = "economic_stack_built"
    engines_queued = "engines_queued"
    engines_running = "engines_running"
    partial_results = "partial_results"
    scoring = "scoring"
    recursive_challenge = "recursive_challenge"
    path_generation = "path_generation"
    simulation_ready = "simulation_ready"
    report_ready = "report_ready"
    completed = "completed"
    failed = "failed"
    launched = "launched"
    archived = "archived"


# Legal state machine transitions (A3 lifecycle control layer)
VALIDATION_STATE_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["context_collecting", "context_collected", "failed", "archived"],
    "context_collecting": ["context_collected", "failed", "archived"],
    "context_collected": ["economic_stack_built", "failed", "archived"],
    "economic_stack_built": ["engines_queued", "engines_running", "failed", "archived"],
    "engines_queued": ["engines_running", "failed", "archived"],
    "engines_running": ["partial_results", "scoring", "failed", "archived"],
    "partial_results": ["scoring", "failed", "archived"],
    "scoring": ["recursive_challenge", "path_generation", "failed", "archived"],
    "recursive_challenge": ["path_generation", "failed", "archived"],
    "path_generation": ["simulation_ready", "report_ready", "completed", "failed", "archived"],
    "simulation_ready": ["report_ready", "failed", "archived"],
    "report_ready": ["completed", "failed", "archived"],
    "completed": ["launched", "archived"],
    "failed": ["archived"],
    "launched": ["archived"],
    "archived": [],
}


class ValidationEventType(str, Enum):
    validation_created = "validation_created"
    validation_started = "validation_started"
    validation_state_changed = "validation_state_changed"
    validation_completed = "validation_completed"
    validation_failed = "validation_failed"
    validation_archived = "validation_archived"
    context_submitted = "context_submitted"
    economic_stack_built = "economic_stack_built"
    engine_started = "engine_started"
    engine_completed = "engine_completed"
    engine_failed = "engine_failed"
    engine_fallback = "engine_fallback"
    score_updated = "score_updated"
    report_generated = "report_generated"
    climate_changed = "climate_changed"
    launch_ready = "launch_ready"
    launch_completed = "launch_completed"
    revalidation_required = "revalidation_required"


class EngineName(str, Enum):
    economy_resolution = "economy_resolution"
    purpose_decomposition = "purpose_decomposition"
    industry_intelligence = "industry_intelligence"
    market_analysis = "market_analysis"
    competitor_reality = "competitor_reality"
    economy_location_intelligence = "economy_location_intelligence"
    customer_pain = "customer_pain"
    execution_difficulty_timing = "execution_difficulty_timing"
    scoring = "scoring"
    evidence_quality = "evidence_quality"
    knowledge_gap = "knowledge_gap"
    decision_intelligence = "decision_intelligence"
    recursive_validation = "recursive_validation"
    multi_perspective_reality = "multi_perspective_reality"
    second_order_consequence = "second_order_consequence"
    systemic_risk = "systemic_risk"
    institutional_reality = "institutional_reality"
    narrative_intelligence = "narrative_intelligence"
    cognitive_bias = "cognitive_bias"
    learning_velocity = "learning_velocity"
    motivation = "motivation"
    counterfactual = "counterfactual"
    survivor_pattern = "survivor_pattern"
    anti_gaming = "anti_gaming"
    civilization_evolution = "civilization_evolution"
    reality_compression = "reality_compression"
    meta_validation = "meta_validation"


class EngineStatus(str, Enum):
    pending = "pending"
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    fallback = "fallback"
    skipped = "skipped"
    timed_out = "timed_out"


class BhudhiMode(str, Enum):
    interpret = "interpret"
    structure = "structure"
    draft = "draft"
    explain = "explain"
    suggest = "suggest"


class BhudhiForbiddenAction(str, Enum):
    decide = "decide"
    calculate = "calculate"
    override = "override"
    score = "score"
    verdict = "verdict"
    alter_economy_profile = "alter_economy_profile"
    determine_climate = "determine_climate"
    approve_assumption = "approve_assumption"
    reject_assumption = "reject_assumption"


class EconomyType(str, Enum):
    consumer_capitalist = "consumer_capitalist"
    welfare_industrial = "welfare_industrial"
    financial_mega_city = "financial_mega_city"
    export_technology = "export_technology"
    manufacturing_excellence = "manufacturing_excellence"
    oil_wealth = "oil_wealth"
    commodity_export = "commodity_export"
    rapid_urbanization = "rapid_urbanization"
    manufacturing_expansion = "manufacturing_expansion"
    tourism_economy = "tourism_economy"
    port_logistics = "port_logistics"
    state_controlled_hybrid = "state_controlled_hybrid"
    agricultural_labor = "agricultural_labor"
    informal_cash = "informal_cash"
    aid_dependent = "aid_dependent"
    corruption_heavy = "corruption_heavy"
    infrastructure_deficient = "infrastructure_deficient"
    urban_poverty = "urban_poverty"
    black_market_war = "black_market_war"
    occupied_territory = "occupied_territory"
    civil_war = "civil_war"
    militia_controlled = "militia_controlled"
    sanctioned = "sanctioned"
    post_collapse = "post_collapse"
    creator_economy = "creator_economy"
    gig_platform = "gig_platform"
    freelance_digital = "freelance_digital"
    saas_startup = "saas_startup"
    ai_automation = "ai_automation"
    cybercrime_dark_web = "cybercrime_dark_web"


class CivilizationDnaDimension(str, Enum):
    trust_index = "trust_index"
    authority_index = "authority_index"
    corruption_index = "corruption_index"
    innovation_index = "innovation_index"
    digital_adoption_index = "digital_adoption_index"
    education_index = "education_index"
    social_mobility_index = "social_mobility_index"
    bureaucracy_index = "bureaucracy_index"
    stability_index = "stability_index"
    information_freedom_index = "information_freedom_index"
    risk_tolerance_index = "risk_tolerance_index"
    community_dependence_index = "community_dependence_index"
    crime_pressure_index = "crime_pressure_index"
    payment_reliability_index = "payment_reliability_index"
    infrastructure_reliability_index = "infrastructure_reliability_index"
    institutional_strength_index = "institutional_strength_index"
    media_volatility_index = "media_volatility_index"
    legal_predictability_index = "legal_predictability_index"
    labor_reliability_index = "labor_reliability_index"
    crisis_exposure_index = "crisis_exposure_index"
    adoption_friction_index = "adoption_friction_index"
    social_proof_dependence_index = "social_proof_dependence_index"
    reputation_fragility_index = "reputation_fragility_index"
    informal_network_strength_index = "informal_network_strength_index"
    future_change_velocity_index = "future_change_velocity_index"


class EconomicStackLayerType(str, Enum):
    founder_economy = "founder_economy"
    customer_economy = "customer_economy"
    revenue_economy = "revenue_economy"
    platform_economy = "platform_economy"
    talent_economy = "talent_economy"
    regulatory_economy = "regulatory_economy"


class EconomyComparisonDimension(str, Enum):
    market_fit = "market_fit"
    trust_fit = "trust_fit"
    payment_fit = "payment_fit"
    infrastructure_fit = "infrastructure_fit"
    regulatory_fit = "regulatory_fit"
    adoption_fit = "adoption_fit"
    execution_fit = "execution_fit"
    narrative_fit = "narrative_fit"
    platform_fit = "platform_fit"
    talent_fit = "talent_fit"
    risk_fit = "risk_fit"
    opportunity_fit = "opportunity_fit"


class EvidenceType(str, Enum):
    no_evidence = "no_evidence"
    opinion = "opinion"
    anecdotal = "anecdotal"
    observed_behavior = "observed_behavior"
    customer_interviews = "customer_interviews"
    paid_tests = "paid_tests"
    transaction_data = "transaction_data"
    market_data = "market_data"
    operational_history = "operational_history"
    longitudinal_evidence = "longitudinal_evidence"


class AssumptionCategory(str, Enum):
    customer = "customer"
    market = "market"
    pricing = "pricing"
    trust = "trust"
    legal = "legal"
    technical = "technical"
    operational = "operational"
    distribution = "distribution"
    competition = "competition"
    timing = "timing"
    resource = "resource"
    user_ability = "user_ability"
    institutional = "institutional"
    narrative = "narrative"
    infrastructure = "infrastructure"


class AssumptionStatus(str, Enum):
    untested = "untested"
    weakly_supported = "weakly_supported"
    supported = "supported"
    proven = "proven"
    failed = "failed"
    contradicted = "contradicted"
    blocked = "blocked"
    needs_retest = "needs_retest"


class DependencyType(str, Enum):
    legal = "legal"
    financial = "financial"
    technical = "technical"
    customer = "customer"
    distribution = "distribution"
    trust = "trust"
    supply = "supply"
    hiring = "hiring"
    platform = "platform"
    infrastructure = "infrastructure"
    institutional = "institutional"
    data = "data"
    security = "security"
    reputation = "reputation"


class DependencyStatus(str, Enum):
    unresolved = "unresolved"
    in_progress = "in_progress"
    resolved = "resolved"
    blocked = "blocked"
    failed = "failed"
    replaced = "replaced"
    waived = "waived"


class BlockerLevel(str, Enum):
    none = "none"
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class RiskSeverity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"
    existential = "existential"


class PathType(str, Enum):
    current_path = "current_path"
    adjusted_path = "adjusted_path"
    alternative_path = "alternative_path"
    counterfactual_path = "counterfactual_path"
    minimal_proof_path = "minimal_proof_path"


class VerdictType(str, Enum):
    proceed = "proceed"
    adjust = "adjust"
    pivot = "pivot"
    delay = "delay"
    test_first = "test_first"
    blocked = "blocked"


class SimulationType(str, Enum):
    human = "human"
    organization = "organization"
    ego = "ego"
    business = "business"
    time = "time"
    media = "media"
    orchestrated = "orchestrated"


class SimulationStatus(str, Enum):
    idle = "idle"
    preparing = "preparing"
    running = "running"
    partial = "partial"
    complete = "complete"
    savepoint = "savepoint"
    failed = "failed"


class ScenarioType(str, Enum):
    best_case = "best_case"
    expected_case = "expected_case"
    worst_case = "worst_case"
    collapse_case = "collapse_case"
    aggressive_case = "aggressive_case"
    conservative_case = "conservative_case"
    custom = "custom"


class SimulationObjectType(str, Enum):
    goal = "goal"
    economy = "economy"
    customer = "customer"
    competitor = "competitor"
    budget = "budget"
    team_member = "team_member"
    product = "product"
    platform = "platform"
    risk = "risk"
    opportunity = "opportunity"
    resistance = "resistance"
    dependency = "dependency"
    assumption = "assumption"
    organization = "organization"
    persona = "persona"
    program = "program"
    project = "project"
    order = "order"
    resource = "resource"
    milestone = "milestone"


class SimulationObjectState(str, Enum):
    idle = "idle"
    testing = "testing"
    active = "active"
    blocked = "blocked"
    unstable = "unstable"
    stable = "stable"
    scaling = "scaling"
    collapsed = "collapsed"


class FitColor(str, Enum):
    green = "green"
    yellow = "yellow"
    red = "red"


class ClimateState(str, Enum):
    blank = "blank"
    pressure = "pressure"
    stability = "stability"
    growth = "growth"
    control = "control"
    abundance = "abundance"
    saturation = "saturation"
    decline = "decline"
    collapse = "collapse"
    reinvention = "reinvention"


class ReportPackageType(str, Enum):
    executive_reality_report = "executive_reality_report"
    simulation_report = "simulation_report"
    reality_framework = "reality_framework"
    business_climate_guide = "business_climate_guide"
    launch_package = "launch_package"
    team_architecture_report = "team_architecture_report"
    team_simulation_report = "team_simulation_report"
    team_climate_analysis = "team_climate_analysis"
    investor_version = "investor_version"
    client_version = "client_version"


class ReportFormat(str, Enum):
    pdf = "pdf"
    docx = "docx"
    in_app = "in_app"
    zip = "zip"


class ReportStatus(str, Enum):
    queued = "queued"
    generating = "generating"
    ready = "ready"
    failed = "failed"
    expired = "expired"


class ShareExpiry(str, Enum):
    twenty_four_hours = "twenty_four_hours"
    seven_days = "seven_days"
    thirty_days = "thirty_days"
    permanent = "permanent"


class NotificationType(str, Enum):
    validation_complete = "validation_complete"
    report_ready = "report_ready"
    assumption_failed = "assumption_failed"
    climate_changed = "climate_changed"
    revalidation_needed = "revalidation_needed"
    world_event_detected = "world_event_detected"
    launch_status_update = "launch_status_update"
    team_member_joined = "team_member_joined"
    payment_failed = "payment_failed"


class WorldEventCategory(str, Enum):
    economy = "economy"
    political = "political"
    industry = "industry"
    platform = "platform"
    technology = "technology"
    regulation = "regulation"
    competitor = "competitor"
    crisis = "crisis"
    market = "market"
    infrastructure = "infrastructure"


class WebhookEventType(str, Enum):
    validation_completed = "validation_completed"
    simulation_completed = "simulation_completed"
    report_generated = "report_generated"
    climate_changed = "climate_changed"
    launch_ready = "launch_ready"
    revalidation_required = "revalidation_required"
    payment_failed = "payment_failed"


class ErrorSeverity(str, Enum):
    info = "info"
    warning = "warning"
    error = "error"
    critical = "critical"


class ErrorType(str, Enum):
    validation_error = "validation_error"
    authentication_error = "authentication_error"
    authorization_error = "authorization_error"
    rate_limit_error = "rate_limit_error"
    engine_timeout = "engine_timeout"
    engine_failure = "engine_failure"
    ai_provider_unavailable = "ai_provider_unavailable"
    report_generation_failure = "report_generation_failure"
    payment_failure = "payment_failure"
    torgima_launch_failure = "torgima_launch_failure"
    database_error = "database_error"
    unknown_error = "unknown_error"


class VisibilityType(str, Enum):
    private = "private"
    team = "team"
    shared = "shared"
    public_link = "public_link"


class SourceType(str, Enum):
    user = "user"
    engine = "engine"
    bhudhi = "bhudhi"
    system = "system"
    admin = "admin"
    webhook = "webhook"
    import_ = "import"


class UserStatus(str, Enum):
    active = "active"
    suspended = "suspended"
    deleted = "deleted"


class Platform(str, Enum):
    web = "web"
    ios = "ios"
    android = "android"
    api = "api"


class BillingCycle(str, Enum):
    monthly = "monthly"
    annual = "annual"


class SubscriptionStatus(str, Enum):
    active = "active"
    trialing = "trialing"
    past_due = "past_due"
    canceled = "canceled"
    unpaid = "unpaid"


class PaymentStatus(str, Enum):
    pending = "pending"
    succeeded = "succeeded"
    failed = "failed"
    refunded = "refunded"


class TorgimaStatus(str, Enum):
    pending = "pending"
    sent = "sent"
    accepted = "accepted"
    failed = "failed"
    retrying = "retrying"


class DeliveryStatus(str, Enum):
    pending = "pending"
    delivered = "delivered"
    failed = "failed"
    retrying = "retrying"


class SystemEventStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    processed = "processed"
    failed = "failed"
    dead_lettered = "dead_lettered"
    ignored = "ignored"


class DeadLetterStatus(str, Enum):
    pending = "pending"
    open = "open"
    retrying = "retrying"
    resolved = "resolved"
    ignored = "ignored"
    abandoned = "abandoned"


class ReadinessStatus(str, Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    ready = "ready"
    blocked = "blocked"


class TimelineHorizon(str, Enum):
    seven_days = "7_days"
    thirty_days = "30_days"
    ninety_days = "90_days"
    six_months = "6_months"
    one_year = "1_year"
    custom = "custom"


class RelationshipType(str, Enum):
    depends_on = "depends_on"
    blocks = "blocks"
    influences = "influences"
    competes_with = "competes_with"
    enables = "enables"
    requires = "requires"
    risks = "risks"
    supports = "supports"


class QuestionCategory(str, Enum):
    basic = "basic"
    industry = "industry"
    economy = "economy"
    team = "team"
    revenue = "revenue"
    evidence = "evidence"
    risk = "risk"
    follow_up = "follow_up"


class AnswerType(str, Enum):
    text = "text"
    number = "number"
    boolean = "boolean"
    select = "select"
    multi_select = "multi_select"
    date = "date"
    range = "range"
    country = "country"


class InvitationStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    expired = "expired"
    revoked = "revoked"


class MemberStatus(str, Enum):
    active = "active"
    inactive = "inactive"
    removed = "removed"


class RevalidationTrigger(str, Enum):
    world_event = "world_event"
    assumption_failed = "assumption_failed"
    climate_change = "climate_change"
    user_requested = "user_requested"
    scheduled = "scheduled"
    dependency_resolved = "dependency_resolved"
    score_degradation = "score_degradation"


class RevalidationStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class BhudhiStatus(str, Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"
    rejected = "rejected"


class LogLevel(str, Enum):
    debug = "debug"
    info = "info"
    warning = "warning"
    error = "error"


class OrganizationLeadershipStyle(str, Enum):
    autocratic = "autocratic"
    democratic = "democratic"
    laissez_faire = "laissez_faire"
    transformational = "transformational"
    transactional = "transactional"
    servant = "servant"


class ResistanceCategory(str, Enum):
    market = "market"
    regulatory = "regulatory"
    cultural = "cultural"
    technical = "technical"
    financial = "financial"
    competitive = "competitive"
    institutional = "institutional"
    behavioral = "behavioral"
    trust = "trust"
    infrastructure = "infrastructure"


class FailureCategory(str, Enum):
    cash_flow = "cash_flow"
    market_rejection = "market_rejection"
    regulatory_block = "regulatory_block"
    technical_failure = "technical_failure"
    team_collapse = "team_collapse"
    competition = "competition"
    trust_collapse = "trust_collapse"
    dependency_failure = "dependency_failure"
    assumption_collapse = "assumption_collapse"
    timing = "timing"
