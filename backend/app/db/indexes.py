"""
MongoDB Index Creation — A1 Foundation Indexes.
Only creates indexes for A1 collections. Future prompt indexes are added incrementally.
"""

from __future__ import annotations

import logging
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from .collections import (
    ERECTOR_USERS, ERECTOR_SESSIONS, MAGIC_LINK_ATTEMPTS,
    AUDIT_LOGS, SYSTEM_ERRORS, SYSTEM_EVENTS, DEAD_LETTER_QUEUE,
    ECONOMIES, COUNTRY_ECONOMY_MAPPINGS,
    VALIDATION_SESSIONS, VALIDATION_IDEMPOTENCY_KEYS,
    VALIDATION_CONTEXTS, QUESTION_DEFINITIONS, CONTEXT_ANSWERS,
)

logger = logging.getLogger(__name__)

A1_INDEX_SPECS = [
    # ── erector_users ────────────────────────────────────────────────────────
    (ERECTOR_USERS, [("email", ASCENDING)],
     {"unique": True, "name": "idx_users_email_unique"}),
    (ERECTOR_USERS, [("user_id", ASCENDING)],
     {"unique": True, "name": "idx_users_user_id_unique"}),
    (ERECTOR_USERS, [("status", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_users_status_created"}),

    # ── erector_sessions ─────────────────────────────────────────────────────
    (ERECTOR_SESSIONS, [("session_id", ASCENDING)],
     {"unique": True, "name": "idx_sessions_session_id_unique"}),
    (ERECTOR_SESSIONS, [("user_id", ASCENDING), ("expires_at", ASCENDING)],
     {"name": "idx_sessions_user_expires"}),
    (ERECTOR_SESSIONS, [("refresh_expires_at", ASCENDING)],
     {"name": "idx_sessions_refresh_expires",
      "expireAfterSeconds": 0}),   # TTL index

    # ── magic_link_attempts ──────────────────────────────────────────────────
    (MAGIC_LINK_ATTEMPTS, [("token_hash", ASCENDING)],
     {"unique": True, "name": "idx_magic_token_hash_unique"}),
    (MAGIC_LINK_ATTEMPTS, [("email_hash", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_magic_email_created"}),
    (MAGIC_LINK_ATTEMPTS, [("expires_at", ASCENDING)],
     {"name": "idx_magic_expires", "expireAfterSeconds": 0}),  # TTL index

    # ── audit_logs ───────────────────────────────────────────────────────────
    (AUDIT_LOGS, [("owner_user_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_audit_owner_created"}),
    (AUDIT_LOGS, [("actor_user_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_audit_actor_created"}),
    (AUDIT_LOGS, [("entity_type", ASCENDING), ("entity_id", ASCENDING)],
     {"name": "idx_audit_entity"}),

    # ── system_errors ────────────────────────────────────────────────────────
    (SYSTEM_ERRORS, [("severity", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_syserr_severity_created"}),
    (SYSTEM_ERRORS, [("error_type", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_syserr_type_created"}),
    (SYSTEM_ERRORS, [("request_id", ASCENDING)],
     {"name": "idx_syserr_request_id", "sparse": True}),

    # ── system_events ────────────────────────────────────────────────────────
    (SYSTEM_EVENTS, [("event_type", ASCENDING), ("emitted_at", DESCENDING)],
     {"name": "idx_sysevt_type_emitted"}),
    (SYSTEM_EVENTS, [("status", ASCENDING), ("emitted_at", ASCENDING)],
     {"name": "idx_sysevt_status_emitted"}),

    # ── dead_letter_queue ────────────────────────────────────────────────────
    (DEAD_LETTER_QUEUE, [("status", ASCENDING), ("next_retry_at", ASCENDING)],
     {"name": "idx_dlq_status_retry"}),
    (DEAD_LETTER_QUEUE, [("original_event_id", ASCENDING)],
     {"name": "idx_dlq_original_event"}),

    # ── economies (A2) ───────────────────────────────────────────────────────
    (ECONOMIES, [("economy_id", ASCENDING)],
     {"unique": True, "name": "idx_economies_economy_id_unique"}),
    (ECONOMIES, [("economy_type", ASCENDING)],
     {"name": "idx_economies_economy_type"}),

    # ── country_economy_mappings (A2) ─────────────────────────────────────────
    (COUNTRY_ECONOMY_MAPPINGS, [("country_code", ASCENDING)],
     {"unique": True, "name": "idx_cem_country_code_unique"}),
    (COUNTRY_ECONOMY_MAPPINGS, [("country_code_alpha3", ASCENDING)],
     {"name": "idx_cem_country_code_alpha3", "sparse": True}),
    (COUNTRY_ECONOMY_MAPPINGS, [("primary_economy_id", ASCENDING)],
     {"name": "idx_cem_primary_economy_id"}),
    (COUNTRY_ECONOMY_MAPPINGS, [("primary_economy_type", ASCENDING)],
     {"name": "idx_cem_primary_economy_type"}),

    # ── validation_sessions (A3) ───────────────────────────────────────────
    (VALIDATION_SESSIONS, [("validation_id", ASCENDING)],
     {"unique": True, "name": "idx_val_validation_id_unique"}),
    (VALIDATION_SESSIONS, [("owner_user_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)],
     {"name": "idx_val_owner_status_updated"}),
    (VALIDATION_SESSIONS, [("owner_user_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_val_owner_created"}),
    (VALIDATION_SESSIONS, [("team_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)],
     {"name": "idx_val_team_status_updated", "sparse": True}),
    (VALIDATION_SESSIONS, [("status", ASCENDING), ("last_activity_at", ASCENDING)],
     {"name": "idx_val_status_last_activity"}),
    (VALIDATION_SESSIONS, [("idempotency_key", ASCENDING), ("owner_user_id", ASCENDING)],
     {"name": "idx_val_idempotency_owner", "sparse": True}),
    (VALIDATION_SESSIONS, [("current_score_id", ASCENDING)],
     {"name": "idx_val_current_score_id", "sparse": True}),
    (VALIDATION_SESSIONS, [("economic_stack_id", ASCENDING)],
     {"name": "idx_val_economic_stack_id", "sparse": True}),

    # ── validation_idempotency_keys (A3) ─────────────────────────────────────
    (VALIDATION_IDEMPOTENCY_KEYS, [("owner_user_id", ASCENDING), ("idempotency_key", ASCENDING)],
     {"unique": True, "name": "idx_idem_owner_key_unique"}),
    (VALIDATION_IDEMPOTENCY_KEYS, [("anonymous_fingerprint", ASCENDING), ("idempotency_key", ASCENDING)],
     {"name": "idx_idem_anon_key", "sparse": True}),
    (VALIDATION_IDEMPOTENCY_KEYS, [("validation_id", ASCENDING)],
     {"name": "idx_idem_validation_id", "sparse": True}),
    (VALIDATION_IDEMPOTENCY_KEYS, [("expires_at", ASCENDING)],
     {"name": "idx_idem_expires_ttl", "expireAfterSeconds": 0, "sparse": True}),

    # ── system_events (A3 extensions) ────────────────────────────────────────
    (SYSTEM_EVENTS, [("event_id", ASCENDING)],
     {"unique": True, "name": "idx_sysevt_event_id_unique"}),
    (SYSTEM_EVENTS, [("validation_id", ASCENDING), ("emitted_at", DESCENDING)],
     {"name": "idx_sysevt_validation_emitted", "sparse": True}),
    (SYSTEM_EVENTS, [("owner_user_id", ASCENDING), ("emitted_at", DESCENDING)],
     {"name": "idx_sysevt_owner_emitted", "sparse": True}),
    (SYSTEM_EVENTS, [("status", ASCENDING), ("next_retry_at", ASCENDING)],
     {"name": "idx_sysevt_status_retry", "sparse": True}),

    # ── dead_letter_queue (A3 extensions) ──────────────────────────────────
    (DEAD_LETTER_QUEUE, [("dead_letter_id", ASCENDING)],
     {"unique": True, "name": "idx_dlq_dead_letter_id_unique"}),
    (DEAD_LETTER_QUEUE, [("validation_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_dlq_validation_created", "sparse": True}),
    (DEAD_LETTER_QUEUE, [("event_type", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_dlq_event_type_created"}),

    # ── audit_logs (A3 extensions) ───────────────────────────────────────────
    (AUDIT_LOGS, [("audit_id", ASCENDING)],
     {"unique": True, "name": "idx_audit_audit_id_unique", "sparse": True}),
    (AUDIT_LOGS, [("action", ASCENDING), ("created_at", DESCENDING)],
     {"name": "idx_audit_action_created"}),

    # ── validation_contexts (A4) ───────────────────────────────────────────
    (VALIDATION_CONTEXTS, [("context_id", ASCENDING)],
     {"unique": True, "name": "idx_vctx_context_id_unique"}),
    (VALIDATION_CONTEXTS, [("validation_id", ASCENDING)],
     {"unique": True, "name": "idx_vctx_validation_id_unique"}),
    (VALIDATION_CONTEXTS, [("owner_user_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)],
     {"name": "idx_vctx_owner_status_updated"}),
    (VALIDATION_CONTEXTS, [("team_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)],
     {"name": "idx_vctx_team_status_updated", "sparse": True}),
    (VALIDATION_CONTEXTS, [("status", ASCENDING), ("updated_at", DESCENDING)],
     {"name": "idx_vctx_status_updated"}),

    # ── context_answers (A4) ─────────────────────────────────────────────────
    (CONTEXT_ANSWERS, [("answer_id", ASCENDING)],
     {"unique": True, "name": "idx_cans_answer_id_unique", "sparse": True}),
    (CONTEXT_ANSWERS, [("validation_id", ASCENDING), ("question_id", ASCENDING)],
     {"name": "idx_cans_validation_question", "sparse": True}),
    (CONTEXT_ANSWERS, [("context_id", ASCENDING), ("category", ASCENDING)],
     {"name": "idx_cans_context_category", "sparse": True}),
    (CONTEXT_ANSWERS, [("owner_user_id", ASCENDING), ("submitted_at", DESCENDING)],
     {"name": "idx_cans_owner_submitted", "sparse": True}),

    # ── question_definitions (A4) ────────────────────────────────────────────
    (QUESTION_DEFINITIONS, [("question_id", ASCENDING)],
     {"unique": True, "name": "idx_qdef_question_id_unique", "sparse": True}),
    (QUESTION_DEFINITIONS, [("category", ASCENDING), ("order", ASCENDING)],
     {"name": "idx_qdef_category_order", "sparse": True}),
]


async def create_indexes(db: AsyncIOMotorDatabase) -> dict:
    """
    Apply all A1 foundation indexes. Idempotent — safe to call on every startup.
    Returns a summary dict with created and error counts.
    """
    created, errors = [], []

    for collection_name, keys, options in A1_INDEX_SPECS:
        try:
            name = await db[collection_name].create_index(keys, **options)
            created.append(f"{collection_name}.{name}")
        except Exception as exc:
            # Ignore DuplicateKeyError from index already existing
            if "already exists" in str(exc).lower() or "IndexKeySpecsConflict" in str(exc):
                logger.debug(f"Index already exists: {collection_name} {options.get('name')}")
            else:
                errors.append(f"{collection_name}: {exc}")
                logger.warning(f"Index creation warning: {collection_name} — {exc}")

    logger.info(
        f"A1 indexes: {len(created)} created/confirmed, {len(errors)} errors"
    )
    return {"created": created, "errors": errors}
