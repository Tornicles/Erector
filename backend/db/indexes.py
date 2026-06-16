"""
MongoDB Index Registry.
All unique and compound indexes are defined here.
Apply with: await apply_indexes(db)
"""

from motor.motor_asyncio import AsyncIOMotorDatabase
from . import collections as C


# Index definitions: (collection, keys, options)
# keys: list of (field, direction) tuples — 1=ASC, -1=DESC
# options: dict of pymongo index options

UNIQUE_INDEXES = [
    (C.USERS, [("email", 1)], {"unique": True, "name": "unique_user_email"}),
    (C.USERS, [("user_id", 1)], {"unique": True, "name": "unique_user_id"}),
    (C.SESSIONS, [("session_id", 1)], {"unique": True, "name": "unique_session_id"}),
    (C.TEAMS, [("team_id", 1)], {"unique": True, "name": "unique_team_id"}),
    (C.ECONOMIES, [("economy_id", 1)], {"unique": True, "name": "unique_economy_id"}),
    (C.ECONOMIES, [("economy_type", 1)], {"unique": True, "name": "unique_economy_type"}),
    (C.COUNTRY_MAPPINGS, [("country_code", 1)], {"unique": True, "name": "unique_country_code"}),
    (C.COUNTRY_MAPPINGS, [("mapping_id", 1)], {"unique": True, "name": "unique_mapping_id"}),
    (C.VALIDATIONS, [("validation_id", 1)], {"unique": True, "name": "unique_validation_id"}),
    (C.ECONOMIC_STACKS, [("stack_id", 1)], {"unique": True, "name": "unique_stack_id"}),
    (C.ENGINE_OUTPUTS, [("engine_output_id", 1)], {"unique": True, "name": "unique_engine_output_id"}),
    (C.VALIDATION_SCORES, [("score_id", 1)], {"unique": True, "name": "unique_score_id"}),
    (C.ASSUMPTIONS, [("assumption_id", 1)], {"unique": True, "name": "unique_assumption_id"}),
    (C.DEPENDENCIES, [("dependency_id", 1)], {"unique": True, "name": "unique_dependency_id"}),
    (C.SIMULATION_RUNS, [("simulation_id", 1)], {"unique": True, "name": "unique_simulation_id"}),
    (C.SIMULATION_SAVEPOINTS, [("savepoint_id", 1)], {"unique": True, "name": "unique_savepoint_id"}),
    (C.REALITY_FRAMEWORKS, [("framework_id", 1)], {"unique": True, "name": "unique_framework_id"}),
    (C.BUSINESS_CLIMATES, [("climate_id", 1)], {"unique": True, "name": "unique_climate_id"}),
    (C.VALIDATION_REPORTS, [("report_id", 1)], {"unique": True, "name": "unique_report_id"}),
    (C.LAUNCH_PACKAGES, [("launch_id", 1)], {"unique": True, "name": "unique_launch_id"}),
    (C.API_KEYS, [("api_key_id", 1)], {"unique": True, "name": "unique_api_key_id"}),
    (C.DEVELOPER_WEBHOOKS, [("webhook_id", 1)], {"unique": True, "name": "unique_webhook_id"}),
]

# Idempotency key scoped by owner
IDEMPOTENCY_INDEX = (
    C.VALIDATIONS,
    [("owner_user_id", 1), ("idempotency_key", 1)],
    {"unique": True, "sparse": True, "name": "unique_idempotency_per_user"},
)

COMPOUND_INDEXES = [
    # Validation sessions
    (
        C.VALIDATIONS,
        [("owner_user_id", 1), ("status", 1), ("updated_at", -1)],
        {"name": "idx_validations_owner_status_updated"},
    ),
    (
        C.VALIDATIONS,
        [("team_id", 1), ("status", 1), ("updated_at", -1)],
        {"name": "idx_validations_team_status_updated", "sparse": True},
    ),
    # Engine outputs
    (
        C.ENGINE_OUTPUTS,
        [("validation_id", 1), ("engine_name", 1)],
        {"name": "idx_engine_outputs_validation_engine"},
    ),
    # Scores
    (
        C.VALIDATION_SCORES,
        [("validation_id", 1), ("version", -1)],
        {"name": "idx_scores_validation_version"},
    ),
    # Assumptions
    (
        C.ASSUMPTIONS,
        [("validation_id", 1), ("status", 1), ("category", 1)],
        {"name": "idx_assumptions_validation_status_category"},
    ),
    # Dependencies
    (
        C.DEPENDENCIES,
        [("validation_id", 1), ("status", 1), ("blocker_level", 1)],
        {"name": "idx_dependencies_validation_status_blocker"},
    ),
    # Simulation runs
    (
        C.SIMULATION_RUNS,
        [("validation_id", 1), ("simulation_type", 1), ("scenario", 1)],
        {"name": "idx_simulations_validation_type_scenario"},
    ),
    # Simulation logs
    (
        C.SIMULATION_LOGS,
        [("simulation_id", 1), ("timestamp", 1)],
        {"name": "idx_simulation_logs_sim_timestamp"},
    ),
    # Reality Frameworks
    (
        C.REALITY_FRAMEWORKS,
        [("validation_id", 1), ("version", -1)],
        {"name": "idx_frameworks_validation_version"},
    ),
    # Business Climates
    (
        C.BUSINESS_CLIMATES,
        [("validation_id", 1), ("current_climate", 1)],
        {"name": "idx_climates_validation_climate"},
    ),
    # Validation Reports
    (
        C.VALIDATION_REPORTS,
        [("validation_id", 1), ("package_type", 1), ("version", -1)],
        {"name": "idx_reports_validation_type_version"},
    ),
    # Report shares — token lookup
    (
        C.REPORT_SHARES,
        [("share_url_token_hash", 1), ("expires_at", 1)],
        {"name": "idx_shares_token_expiry"},
    ),
    # Audit logs
    (
        C.AUDIT_LOGS,
        [("owner_user_id", 1), ("created_at", -1)],
        {"name": "idx_audit_owner_created"},
    ),
    (
        C.AUDIT_LOGS,
        [("entity_type", 1), ("entity_id", 1), ("created_at", -1)],
        {"name": "idx_audit_entity_created"},
    ),
    # Analytics
    (
        C.ANALYTICS_EVENTS,
        [("event_name", 1), ("created_at", -1)],
        {"name": "idx_analytics_event_created"},
    ),
    (
        C.ANALYTICS_EVENTS,
        [("owner_user_id", 1), ("event_name", 1), ("created_at", -1)],
        {"name": "idx_analytics_owner_event"},
    ),
    # World events
    (
        C.WORLD_EVENTS,
        [("economy_id", 1), ("category", 1), ("created_at", -1)],
        {"name": "idx_world_events_economy_category"},
    ),
    # Notifications
    (
        C.NOTIFICATIONS,
        [("owner_user_id", 1), ("read_at", 1), ("created_at", -1)],
        {"name": "idx_notifications_owner_read_created"},
    ),
    # Usage counters
    (
        C.USAGE_COUNTERS,
        [("owner_user_id", 1), ("period_start", 1), ("period_end", 1)],
        {"name": "idx_usage_owner_period"},
    ),
    # Bhudhi logs
    (
        C.BHUDHI_LOGS,
        [("validation_id", 1), ("created_at", -1)],
        {"name": "idx_bhudhi_validation_created"},
    ),
]

ALL_INDEXES = UNIQUE_INDEXES + [IDEMPOTENCY_INDEX] + COMPOUND_INDEXES


async def apply_indexes(db: AsyncIOMotorDatabase) -> dict:
    """
    Apply all defined indexes to MongoDB.
    Returns a summary of created indexes.
    """
    results = {"created": [], "errors": []}

    for collection_name, keys, options in ALL_INDEXES:
        try:
            collection = db[collection_name]
            index_name = await collection.create_index(keys, **options)
            results["created"].append(f"{collection_name}.{index_name}")
        except Exception as e:
            results["errors"].append(f"{collection_name}: {str(e)}")

    return results


def get_index_registry() -> list[dict]:
    """Return all index definitions as a list of dicts for introspection."""
    registry = []
    for collection_name, keys, options in ALL_INDEXES:
        registry.append({
            "collection": collection_name,
            "keys": keys,
            "unique": options.get("unique", False),
            "sparse": options.get("sparse", False),
            "name": options.get("name", ""),
        })
    return registry
