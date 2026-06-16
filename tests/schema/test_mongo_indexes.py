"""
Test Gate 3: MongoDB index registry integrity.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))


def test_index_registry_not_empty():
    from db.indexes import ALL_INDEXES, get_index_registry
    assert len(ALL_INDEXES) > 0
    registry = get_index_registry()
    assert len(registry) == len(ALL_INDEXES)


def test_required_unique_indexes_exist():
    from db.indexes import get_index_registry
    from db import collections as C

    registry = get_index_registry()
    unique_indexes = [(r["collection"], r["keys"][0][0]) for r in registry if r["unique"]]

    required_unique = [
        (C.USERS, "email"),
        (C.SESSIONS, "session_id"),
        (C.TEAMS, "team_id"),
        (C.ECONOMIES, "economy_id"),
        (C.COUNTRY_MAPPINGS, "country_code"),
        (C.VALIDATIONS, "validation_id"),
        (C.ECONOMIC_STACKS, "stack_id"),
        (C.ENGINE_OUTPUTS, "engine_output_id"),
        (C.VALIDATION_SCORES, "score_id"),
        (C.ASSUMPTIONS, "assumption_id"),
        (C.DEPENDENCIES, "dependency_id"),
        (C.SIMULATION_RUNS, "simulation_id"),
        (C.SIMULATION_SAVEPOINTS, "savepoint_id"),
        (C.REALITY_FRAMEWORKS, "framework_id"),
        (C.BUSINESS_CLIMATES, "climate_id"),
        (C.VALIDATION_REPORTS, "report_id"),
        (C.LAUNCH_PACKAGES, "launch_id"),
        (C.API_KEYS, "api_key_id"),
        (C.DEVELOPER_WEBHOOKS, "webhook_id"),
    ]

    for col, field in required_unique:
        assert (col, field) in unique_indexes, (
            f"Missing unique index on {col}.{field}"
        )


def test_required_compound_indexes_exist():
    from db.indexes import get_index_registry
    from db import collections as C

    registry = get_index_registry()
    compound = [(r["collection"], tuple(k[0] for k in r["keys"])) for r in registry]

    required_compound = [
        (C.VALIDATIONS, ("owner_user_id", "status", "updated_at")),
        (C.ENGINE_OUTPUTS, ("validation_id", "engine_name")),
        (C.VALIDATION_SCORES, ("validation_id", "version")),
        (C.ASSUMPTIONS, ("validation_id", "status", "category")),
        (C.DEPENDENCIES, ("validation_id", "status", "blocker_level")),
        (C.SIMULATION_RUNS, ("validation_id", "simulation_type", "scenario")),
        (C.SIMULATION_LOGS, ("simulation_id", "timestamp")),
        (C.REALITY_FRAMEWORKS, ("validation_id", "version")),
        (C.BUSINESS_CLIMATES, ("validation_id", "current_climate")),
        (C.VALIDATION_REPORTS, ("validation_id", "package_type", "version")),
        (C.REPORT_SHARES, ("share_url_token_hash", "expires_at")),
        (C.AUDIT_LOGS, ("owner_user_id", "created_at")),
        (C.ANALYTICS_EVENTS, ("event_name", "created_at")),
        (C.WORLD_EVENTS, ("economy_id", "category", "created_at")),
        (C.NOTIFICATIONS, ("owner_user_id", "read_at", "created_at")),
        (C.USAGE_COUNTERS, ("owner_user_id", "period_start", "period_end")),
    ]

    for col, fields in required_compound:
        assert (col, fields) in compound, (
            f"Missing compound index on {col}: {fields}"
        )


def test_all_collections_registered():
    from db.collections import ALL_COLLECTIONS
    assert len(ALL_COLLECTIONS) >= 40, (
        f"Expected at least 40 collections, got {len(ALL_COLLECTIONS)}"
    )


def test_global_reference_collections():
    from db.collections import GLOBAL_REFERENCE_COLLECTIONS
    required = {
        "economies", "country_economy_mappings",
        "organization_world_entities", "human_world_personas"
    }
    assert required.issubset(GLOBAL_REFERENCE_COLLECTIONS), (
        f"Missing global reference collections: {required - GLOBAL_REFERENCE_COLLECTIONS}"
    )
