"""
MongoDB Collection Name Registry (A1 Foundation).
Foundational collections are wired now. Future collections are reserved as constants.
"""

# ── Foundational (wired in A1) ───────────────────────────────────────────────
ERECTOR_USERS = "erector_users"
ERECTOR_SESSIONS = "erector_sessions"
MAGIC_LINK_ATTEMPTS = "magic_link_attempts"
AUDIT_LOGS = "audit_logs"
SYSTEM_ERRORS = "system_errors"
SYSTEM_EVENTS = "system_events"
DEAD_LETTER_QUEUE = "dead_letter_queue"

# ── Economy (PROMPT A2+) ─────────────────────────────────────────────────────
ECONOMIES = "economies"
COUNTRY_ECONOMY_MAPPINGS = "country_economy_mappings"

# ── Validation (PROMPT A3+) ──────────────────────────────────────────────────
VALIDATION_SESSIONS = "validation_sessions"
VALIDATION_IDEMPOTENCY_KEYS = "validation_idempotency_keys"
VALIDATION_CONTEXTS = "validation_contexts"
QUESTION_DEFINITIONS = "question_definitions"
CONTEXT_ANSWERS = "context_answers"

# ── Bhudhi (PROMPT A5+) ──────────────────────────────────────────────────────
BHUDHI_LOGS = "bhudhi_logs"
BHUDHI_PROMPT_CONTRACTS = "bhudhi_prompt_contracts"
BHUDHI_USAGE_DAILY = "bhudhi_usage_daily"
ECONOMIC_STACKS = "economic_stacks"

# ── Engines & Scoring (PROMPT B+) ────────────────────────────────────────────
ENGINE_OUTPUTS = "engine_outputs"
VALIDATION_SCORES = "validation_scores"

# ── Assumptions / Evidence / Dependencies (PROMPT B+) ────────────────────────
ASSUMPTIONS = "assumptions"
EVIDENCES = "evidences"
DEPENDENCIES = "dependencies"

# ── Simulation (PROMPT D+) ───────────────────────────────────────────────────
SIMULATION_RUNS = "simulation_runs"
SIMULATION_SAVEPOINTS = "simulation_savepoints"
SIMULATION_LOGS = "simulation_logs"

# ── Reality Framework / Climate (PROMPT E/F+) ────────────────────────────────
REALITY_FRAMEWORKS = "reality_frameworks"
BUSINESS_CLIMATES = "business_climates"
RESISTANCE_FORCES = "resistance_forces"
FAILURE_ARCHITECTURES = "failure_architectures"
VALIDATION_PATHS = "validation_paths"
VERDICTS = "verdicts"

# ── Reports & Launch (PROMPT G/H+) ───────────────────────────────────────────
VALIDATION_REPORTS = "validation_reports"
REPORT_SHARES = "report_shares"
LAUNCH_PACKAGES = "launch_packages"

# ── Teams (PROMPT J3+) ───────────────────────────────────────────────────────
TEAMS = "teams"

# ── Revalidation & Events (PROMPT I+) ────────────────────────────────────────
REVALIDATION_EVENTS = "revalidation_events"
WORLD_EVENTS = "world_events"
NOTIFICATIONS = "notifications"
NOTIFICATION_TOKENS = "notification_tokens"

# ── Developer API & Billing (PROMPT J+) ──────────────────────────────────────
ERECTOR_API_KEYS = "erector_api_keys"
DEVELOPER_WEBHOOKS = "developer_webhooks"
WEBHOOK_DELIVERIES = "webhook_deliveries"
ERECTOR_SUBSCRIPTIONS = "erector_subscriptions"
ERECTOR_PAYMENTS = "erector_payments"
USAGE_COUNTERS = "usage_counters"

# ── AI Governance (PROMPT B+) ────────────────────────────────────────────────
BHUDHI_LOGS = "bhudhi_logs"

# ── Analytics & Admin ────────────────────────────────────────────────────────
ANALYTICS_EVENTS = "analytics_events"
ADMIN_ACTIONS = "admin_actions"

# ── World Library (global ref) ───────────────────────────────────────────────
ORGANIZATION_WORLD_ENTITIES = "organization_world_entities"
HUMAN_WORLD_PERSONAS = "human_world_personas"

# ── A1 Foundational Set ──────────────────────────────────────────────────────
A1_COLLECTIONS = {
    ERECTOR_USERS,
    ERECTOR_SESSIONS,
    MAGIC_LINK_ATTEMPTS,
    AUDIT_LOGS,
    SYSTEM_ERRORS,
    SYSTEM_EVENTS,
    DEAD_LETTER_QUEUE,
}
