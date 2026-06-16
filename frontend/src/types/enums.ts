/**
 * Erector Centralized Enum Registry — TypeScript Mirror
 * Mirrors backend/models/enums.py exactly.
 * Auto-generated — do not edit manually.
 */

export enum UserType {
  individual = "individual",
  team = "team",
  developer = "developer",
  consultant = "consultant",
  enterprise = "enterprise",
  admin = "admin",
}

export enum ExperienceLevel {
  first_venture = "first_venture",
  experienced = "experienced",
  expert = "expert",
}

export enum GoalType {
  business = "business",
  project = "project",
  career = "career",
  side_income = "side_income",
  creator = "creator",
  startup = "startup",
  team_execution = "team_execution",
  market_entry = "market_entry",
  fundraising = "fundraising",
  crisis_recovery = "crisis_recovery",
}

export enum ValidationDepth {
  quick_overview = "quick_overview",
  full_deep_validation = "full_deep_validation",
  enterprise_depth = "enterprise_depth",
  api_depth = "api_depth",
}

export enum SubscriptionTier {
  free = "free",
  starter = "starter",
  growth = "growth",
  premium = "premium",
  team = "team",
  enterprise = "enterprise",
  api = "api",
}

export enum TeamRole {
  owner = "owner",
  admin = "admin",
  contributor = "contributor",
  analyst = "analyst",
  viewer = "viewer",
  client = "client",
}

export enum ValidationStatus {
  draft = "draft",
  context_collecting = "context_collecting",
  context_collected = "context_collected",
  economic_stack_built = "economic_stack_built",
  engines_queued = "engines_queued",
  engines_running = "engines_running",
  partial_results = "partial_results",
  scoring = "scoring",
  recursive_challenge = "recursive_challenge",
  path_generation = "path_generation",
  simulation_ready = "simulation_ready",
  report_ready = "report_ready",
  completed = "completed",
  failed = "failed",
  launched = "launched",
  archived = "archived",
}

export enum ValidationEventType {
  validation_created = "validation_created",
  context_submitted = "context_submitted",
  economic_stack_built = "economic_stack_built",
  engine_started = "engine_started",
  engine_completed = "engine_completed",
  engine_failed = "engine_failed",
  engine_fallback = "engine_fallback",
  score_updated = "score_updated",
  validation_completed = "validation_completed",
  validation_failed = "validation_failed",
  report_generated = "report_generated",
  climate_changed = "climate_changed",
  launch_ready = "launch_ready",
  launch_completed = "launch_completed",
  revalidation_required = "revalidation_required",
}

export enum EngineName {
  economy_resolution = "economy_resolution",
  purpose_decomposition = "purpose_decomposition",
  industry_intelligence = "industry_intelligence",
  market_analysis = "market_analysis",
  competitor_reality = "competitor_reality",
  economy_location_intelligence = "economy_location_intelligence",
  customer_pain = "customer_pain",
  execution_difficulty_timing = "execution_difficulty_timing",
  scoring = "scoring",
  evidence_quality = "evidence_quality",
  knowledge_gap = "knowledge_gap",
  decision_intelligence = "decision_intelligence",
  recursive_validation = "recursive_validation",
  multi_perspective_reality = "multi_perspective_reality",
  second_order_consequence = "second_order_consequence",
  systemic_risk = "systemic_risk",
  institutional_reality = "institutional_reality",
  narrative_intelligence = "narrative_intelligence",
  cognitive_bias = "cognitive_bias",
  learning_velocity = "learning_velocity",
  motivation = "motivation",
  counterfactual = "counterfactual",
  survivor_pattern = "survivor_pattern",
  anti_gaming = "anti_gaming",
  civilization_evolution = "civilization_evolution",
  reality_compression = "reality_compression",
  meta_validation = "meta_validation",
}

export enum EngineStatus {
  pending = "pending",
  queued = "queued",
  running = "running",
  completed = "completed",
  failed = "failed",
  fallback = "fallback",
  skipped = "skipped",
  timed_out = "timed_out",
}

export enum BhudhiMode {
  interpret = "interpret",
  structure = "structure",
  draft = "draft",
  explain = "explain",
  suggest = "suggest",
}

export enum BhudhiForbiddenAction {
  decide = "decide",
  calculate = "calculate",
  override = "override",
  score = "score",
  verdict = "verdict",
  alter_economy_profile = "alter_economy_profile",
  determine_climate = "determine_climate",
  approve_assumption = "approve_assumption",
  reject_assumption = "reject_assumption",
}

export enum EconomyType {
  consumer_capitalist = "consumer_capitalist",
  welfare_industrial = "welfare_industrial",
  financial_mega_city = "financial_mega_city",
  export_technology = "export_technology",
  manufacturing_excellence = "manufacturing_excellence",
  oil_wealth = "oil_wealth",
  commodity_export = "commodity_export",
  rapid_urbanization = "rapid_urbanization",
  manufacturing_expansion = "manufacturing_expansion",
  tourism_economy = "tourism_economy",
  port_logistics = "port_logistics",
  state_controlled_hybrid = "state_controlled_hybrid",
  agricultural_labor = "agricultural_labor",
  informal_cash = "informal_cash",
  aid_dependent = "aid_dependent",
  corruption_heavy = "corruption_heavy",
  infrastructure_deficient = "infrastructure_deficient",
  urban_poverty = "urban_poverty",
  black_market_war = "black_market_war",
  occupied_territory = "occupied_territory",
  civil_war = "civil_war",
  militia_controlled = "militia_controlled",
  sanctioned = "sanctioned",
  post_collapse = "post_collapse",
  creator_economy = "creator_economy",
  gig_platform = "gig_platform",
  freelance_digital = "freelance_digital",
  saas_startup = "saas_startup",
  ai_automation = "ai_automation",
  cybercrime_dark_web = "cybercrime_dark_web",
}

export enum CivilizationDnaDimension {
  trust_index = "trust_index",
  authority_index = "authority_index",
  corruption_index = "corruption_index",
  innovation_index = "innovation_index",
  digital_adoption_index = "digital_adoption_index",
  education_index = "education_index",
  social_mobility_index = "social_mobility_index",
  bureaucracy_index = "bureaucracy_index",
  stability_index = "stability_index",
  information_freedom_index = "information_freedom_index",
  risk_tolerance_index = "risk_tolerance_index",
  community_dependence_index = "community_dependence_index",
  crime_pressure_index = "crime_pressure_index",
  payment_reliability_index = "payment_reliability_index",
  infrastructure_reliability_index = "infrastructure_reliability_index",
  institutional_strength_index = "institutional_strength_index",
  media_volatility_index = "media_volatility_index",
  legal_predictability_index = "legal_predictability_index",
  labor_reliability_index = "labor_reliability_index",
  crisis_exposure_index = "crisis_exposure_index",
  adoption_friction_index = "adoption_friction_index",
  social_proof_dependence_index = "social_proof_dependence_index",
  reputation_fragility_index = "reputation_fragility_index",
  informal_network_strength_index = "informal_network_strength_index",
  future_change_velocity_index = "future_change_velocity_index",
}

export enum EvidenceType {
  no_evidence = "no_evidence",
  opinion = "opinion",
  anecdotal = "anecdotal",
  observed_behavior = "observed_behavior",
  customer_interviews = "customer_interviews",
  paid_tests = "paid_tests",
  transaction_data = "transaction_data",
  market_data = "market_data",
  operational_history = "operational_history",
  longitudinal_evidence = "longitudinal_evidence",
}

export enum AssumptionCategory {
  customer = "customer",
  market = "market",
  pricing = "pricing",
  trust = "trust",
  legal = "legal",
  technical = "technical",
  operational = "operational",
  distribution = "distribution",
  competition = "competition",
  timing = "timing",
  resource = "resource",
  user_ability = "user_ability",
  institutional = "institutional",
  narrative = "narrative",
  infrastructure = "infrastructure",
}

export enum AssumptionStatus {
  untested = "untested",
  weakly_supported = "weakly_supported",
  supported = "supported",
  proven = "proven",
  failed = "failed",
  contradicted = "contradicted",
  blocked = "blocked",
  needs_retest = "needs_retest",
}

export enum DependencyType {
  legal = "legal",
  financial = "financial",
  technical = "technical",
  customer = "customer",
  distribution = "distribution",
  trust = "trust",
  supply = "supply",
  hiring = "hiring",
  platform = "platform",
  infrastructure = "infrastructure",
  institutional = "institutional",
  data = "data",
  security = "security",
  reputation = "reputation",
}

export enum DependencyStatus {
  unresolved = "unresolved",
  in_progress = "in_progress",
  resolved = "resolved",
  blocked = "blocked",
  failed = "failed",
  replaced = "replaced",
  waived = "waived",
}

export enum BlockerLevel {
  none = "none",
  low = "low",
  medium = "medium",
  high = "high",
  critical = "critical",
}

export enum RiskSeverity {
  low = "low",
  medium = "medium",
  high = "high",
  critical = "critical",
  existential = "existential",
}

export enum PathType {
  current_path = "current_path",
  adjusted_path = "adjusted_path",
  alternative_path = "alternative_path",
  counterfactual_path = "counterfactual_path",
  minimal_proof_path = "minimal_proof_path",
}

export enum VerdictType {
  proceed = "proceed",
  adjust = "adjust",
  pivot = "pivot",
  delay = "delay",
  test_first = "test_first",
  blocked = "blocked",
}

export enum SimulationType {
  human = "human",
  organization = "organization",
  ego = "ego",
  business = "business",
  time = "time",
  media = "media",
  orchestrated = "orchestrated",
}

export enum SimulationStatus {
  idle = "idle",
  preparing = "preparing",
  running = "running",
  partial = "partial",
  complete = "complete",
  savepoint = "savepoint",
  failed = "failed",
}

export enum ScenarioType {
  best_case = "best_case",
  expected_case = "expected_case",
  worst_case = "worst_case",
  collapse_case = "collapse_case",
  aggressive_case = "aggressive_case",
  conservative_case = "conservative_case",
  custom = "custom",
}

export enum SimulationObjectType {
  goal = "goal",
  economy = "economy",
  customer = "customer",
  competitor = "competitor",
  budget = "budget",
  team_member = "team_member",
  product = "product",
  platform = "platform",
  risk = "risk",
  opportunity = "opportunity",
  resistance = "resistance",
  dependency = "dependency",
  assumption = "assumption",
  organization = "organization",
  persona = "persona",
  program = "program",
  project = "project",
  order = "order",
  resource = "resource",
  milestone = "milestone",
}

export enum SimulationObjectState {
  idle = "idle",
  testing = "testing",
  active = "active",
  blocked = "blocked",
  unstable = "unstable",
  stable = "stable",
  scaling = "scaling",
  collapsed = "collapsed",
}

export enum FitColor {
  green = "green",
  yellow = "yellow",
  red = "red",
}

export enum ClimateState {
  blank = "blank",
  pressure = "pressure",
  stability = "stability",
  growth = "growth",
  control = "control",
  abundance = "abundance",
  saturation = "saturation",
  decline = "decline",
  collapse = "collapse",
  reinvention = "reinvention",
}

export enum ReportPackageType {
  executive_reality_report = "executive_reality_report",
  simulation_report = "simulation_report",
  reality_framework = "reality_framework",
  business_climate_guide = "business_climate_guide",
  launch_package = "launch_package",
  team_architecture_report = "team_architecture_report",
  team_simulation_report = "team_simulation_report",
  team_climate_analysis = "team_climate_analysis",
  investor_version = "investor_version",
  client_version = "client_version",
}

export enum ReportFormat {
  pdf = "pdf",
  docx = "docx",
  in_app = "in_app",
  zip = "zip",
}

export enum ShareExpiry {
  twenty_four_hours = "twenty_four_hours",
  seven_days = "seven_days",
  thirty_days = "thirty_days",
  permanent = "permanent",
}

export enum NotificationType {
  validation_complete = "validation_complete",
  report_ready = "report_ready",
  assumption_failed = "assumption_failed",
  climate_changed = "climate_changed",
  revalidation_needed = "revalidation_needed",
  world_event_detected = "world_event_detected",
  launch_status_update = "launch_status_update",
  team_member_joined = "team_member_joined",
  payment_failed = "payment_failed",
}

export enum WorldEventCategory {
  economy = "economy",
  political = "political",
  industry = "industry",
  platform = "platform",
  technology = "technology",
  regulation = "regulation",
  competitor = "competitor",
  crisis = "crisis",
  market = "market",
  infrastructure = "infrastructure",
}

export enum WebhookEventType {
  validation_completed = "validation_completed",
  simulation_completed = "simulation_completed",
  report_generated = "report_generated",
  climate_changed = "climate_changed",
  launch_ready = "launch_ready",
  revalidation_required = "revalidation_required",
  payment_failed = "payment_failed",
}

export enum ErrorSeverity {
  info = "info",
  warning = "warning",
  error = "error",
  critical = "critical",
}

export enum ErrorType {
  validation_error = "validation_error",
  authentication_error = "authentication_error",
  authorization_error = "authorization_error",
  rate_limit_error = "rate_limit_error",
  engine_timeout = "engine_timeout",
  engine_failure = "engine_failure",
  ai_provider_unavailable = "ai_provider_unavailable",
  report_generation_failure = "report_generation_failure",
  payment_failure = "payment_failure",
  torgima_launch_failure = "torgima_launch_failure",
  database_error = "database_error",
  unknown_error = "unknown_error",
}

export enum VisibilityType {
  private = "private",
  team = "team",
  shared = "shared",
  public_link = "public_link",
}

export enum Platform {
  web = "web",
  ios = "ios",
  android = "android",
  api = "api",
}

export enum TorgimaStatus {
  pending = "pending",
  sent = "sent",
  accepted = "accepted",
  failed = "failed",
  retrying = "retrying",
}
