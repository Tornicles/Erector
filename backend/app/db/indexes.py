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
