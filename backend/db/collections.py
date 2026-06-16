"""
MongoDB Collection Names Registry.
All collection names are defined here as constants.
"""

# User & Auth
USERS = "erector_users"
SESSIONS = "erector_sessions"
MAGIC_LINKS = "magic_link_attempts"

# Teams
TEAMS = "teams"

# Economy & Stack
ECONOMIES = "economies"
COUNTRY_MAPPINGS = "country_economy_mappings"
ECONOMIC_STACKS = "economic_stacks"

# Validation
VALIDATIONS = "validation_sessions"
VALIDATION_CONTEXTS = "validation_contexts"

# Engines & Scoring
ENGINE_OUTPUTS = "engine_outputs"
VALIDATION_SCORES = "validation_scores"

# Assumptions, Evidence, Dependencies
ASSUMPTIONS = "assumptions"
EVIDENCES = "evidences"
DEPENDENCIES = "dependencies"

# Simulations & Canvas
SIMULATION_RUNS = "simulation_runs"
SIMULATION_SAVEPOINTS = "simulation_savepoints"
SIMULATION_LOGS = "simulation_logs"

# World Library (global reference)
ORGANIZATIONS = "organization_world_entities"
PERSONAS = "human_world_personas"

# Resistance & Failure
RESISTANCE_FORCES = "resistance_forces"
FAILURE_ARCHITECTURES = "failure_architectures"

# Paths, Verdicts
VALIDATION_PATHS = "validation_paths"
VERDICTS = "verdicts"

# Frameworks & Climate
REALITY_FRAMEWORKS = "reality_frameworks"
BUSINESS_CLIMATES = "business_climates"

# Reports & Sharing
VALIDATION_REPORTS = "validation_reports"
REPORT_SHARES = "report_shares"

# Launch
LAUNCH_PACKAGES = "launch_packages"

# Revalidation & Readiness
REVALIDATION_EVENTS = "revalidation_events"
EXECUTION_READINESS = "execution_readiness"

# Events & Notifications
WORLD_EVENTS = "world_events"
NOTIFICATIONS = "notifications"
NOTIFICATION_TOKENS = "notification_tokens"
SYSTEM_EVENTS = "system_events"
DEAD_LETTER_QUEUE = "dead_letter_queue"

# Developer API
API_KEYS = "erector_api_keys"
DEVELOPER_WEBHOOKS = "developer_webhooks"
WEBHOOK_DELIVERIES = "webhook_deliveries"

# Billing
SUBSCRIPTIONS = "erector_subscriptions"
PAYMENTS = "erector_payments"
USAGE_COUNTERS = "usage_counters"

# Governance & Admin
BHUDHI_LOGS = "bhudhi_logs"
AUDIT_LOGS = "audit_logs"
ANALYTICS_EVENTS = "analytics_events"
SYSTEM_ERRORS = "system_errors"
ADMIN_ACTIONS = "admin_actions"

# Global reference collections (no owner_user_id required)
GLOBAL_REFERENCE_COLLECTIONS = {
    ECONOMIES,
    COUNTRY_MAPPINGS,
    ORGANIZATIONS,
    PERSONAS,
    WORLD_EVENTS,
}

# Protected collections that require owner_user_id
PROTECTED_COLLECTIONS = {
    VALIDATIONS, VALIDATION_CONTEXTS, ENGINE_OUTPUTS, VALIDATION_SCORES,
    ASSUMPTIONS, EVIDENCES, DEPENDENCIES, SIMULATION_RUNS, SIMULATION_SAVEPOINTS,
    RESISTANCE_FORCES, FAILURE_ARCHITECTURES, VALIDATION_PATHS, VERDICTS,
    REALITY_FRAMEWORKS, BUSINESS_CLIMATES, VALIDATION_REPORTS, REPORT_SHARES,
    LAUNCH_PACKAGES, REVALIDATION_EVENTS, EXECUTION_READINESS, NOTIFICATIONS,
    NOTIFICATION_TOKENS, API_KEYS, DEVELOPER_WEBHOOKS, SUBSCRIPTIONS,
    PAYMENTS, USAGE_COUNTERS, BHUDHI_LOGS, ECONOMIC_STACKS,
}

# Collections that require audit logging on mutation
AUDITABLE_COLLECTIONS = {
    USERS, TEAMS, VALIDATIONS, VALIDATION_SCORES, ASSUMPTIONS, DEPENDENCIES,
    REALITY_FRAMEWORKS, BUSINESS_CLIMATES, LAUNCH_PACKAGES, SUBSCRIPTIONS,
    API_KEYS, DEVELOPER_WEBHOOKS, REPORT_SHARES,
}

# All collection names as a set (for validation)
ALL_COLLECTIONS = {
    USERS, SESSIONS, MAGIC_LINKS, TEAMS, ECONOMIES, COUNTRY_MAPPINGS,
    ECONOMIC_STACKS, VALIDATIONS, VALIDATION_CONTEXTS, ENGINE_OUTPUTS,
    VALIDATION_SCORES, ASSUMPTIONS, EVIDENCES, DEPENDENCIES, SIMULATION_RUNS,
    SIMULATION_SAVEPOINTS, SIMULATION_LOGS, ORGANIZATIONS, PERSONAS,
    RESISTANCE_FORCES, FAILURE_ARCHITECTURES, VALIDATION_PATHS, VERDICTS,
    REALITY_FRAMEWORKS, BUSINESS_CLIMATES, VALIDATION_REPORTS, REPORT_SHARES,
    LAUNCH_PACKAGES, REVALIDATION_EVENTS, EXECUTION_READINESS, WORLD_EVENTS,
    NOTIFICATIONS, NOTIFICATION_TOKENS, SYSTEM_EVENTS, DEAD_LETTER_QUEUE,
    API_KEYS, DEVELOPER_WEBHOOKS, WEBHOOK_DELIVERIES, SUBSCRIPTIONS,
    PAYMENTS, USAGE_COUNTERS, BHUDHI_LOGS, AUDIT_LOGS, ANALYTICS_EVENTS,
    SYSTEM_ERRORS, ADMIN_ACTIONS,
}
