/**
 * Mobile — Enum Registry (Mirror of frontend/src/types/enums.ts)
 * React Native / Expo compatible.
 */

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

export enum VerdictType {
  proceed = "proceed",
  adjust = "adjust",
  pivot = "pivot",
  delay = "delay",
  test_first = "test_first",
  blocked = "blocked",
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
