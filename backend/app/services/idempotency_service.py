"""
Idempotency Service — Prompt A3
Concurrency-safe duplicate prevention for validation creation.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.errors import IdempotencyConflictError
from app.db.collections import VALIDATION_IDEMPOTENCY_KEYS
from app.models.validation import CreateValidationRequest, IdempotencyRecord, new_idempotency_record_id


def normalize_idempotency_key(key: Optional[str]) -> str:
    """Normalize client-provided idempotency key."""
    if not key or not key.strip():
        return f"idem_{uuid.uuid4()}"
    normalized = re.sub(r"\s+", "_", key.strip().lower())
    return normalized[:128]


def hash_validation_create_request(request: CreateValidationRequest) -> str:
    """Deterministic hash of create request body (excludes idempotency_key)."""
    payload = request.model_dump(
        exclude={"idempotency_key", "metadata"},
        mode="json",
    )
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def generate_server_idempotency_key(
    request: CreateValidationRequest,
    owner_user_id: str,
    request_id: Optional[str] = None,
) -> str:
    """Generate server-side idempotency key when client does not provide one."""
    normalized_goal = re.sub(r"\s+", " ", request.raw_goal.strip().lower())
    base = f"{owner_user_id}:{normalized_goal}"
    if request_id:
        base = f"{base}:{request_id}"
    digest = hashlib.sha256(base.encode("utf-8")).hexdigest()[:16]
    return f"idem_srv_{digest}"


async def get_existing_idempotent_result(
    db: AsyncIOMotorDatabase,
    owner_user_id: str,
    key: str,
) -> Optional[dict]:
    """Look up existing idempotency record."""
    return await db[VALIDATION_IDEMPOTENCY_KEYS].find_one(
        {"owner_user_id": owner_user_id, "idempotency_key": key}
    )


def assert_request_matches_existing(existing_record: dict, request_hash: str) -> None:
    """Raise 409 if same key was used with different payload."""
    if existing_record.get("request_hash") != request_hash:
        raise IdempotencyConflictError(existing_record["idempotency_key"])


async def reserve_idempotency_key(
    db: AsyncIOMotorDatabase,
    owner_user_id: str,
    key: str,
    request_hash: str,
    anonymous_fingerprint: Optional[str] = None,
) -> dict:
    """
    Reserve an idempotency key. Returns existing record if already reserved.
    Uses unique index for concurrency safety.
    """
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.idempotency_key_ttl_hours)

    existing = await get_existing_idempotent_result(db, owner_user_id, key)
    if existing:
        return existing

    record = IdempotencyRecord(
        idempotency_record_id=new_idempotency_record_id(),
        idempotency_key=key,
        owner_user_id=owner_user_id,
        anonymous_fingerprint=anonymous_fingerprint,
        request_hash=request_hash,
        status="pending",
        expires_at=expires_at,
    )
    doc = record.model_dump(mode="json")

    try:
        await db[VALIDATION_IDEMPOTENCY_KEYS].insert_one(doc)
        return doc
    except DuplicateKeyError:
        existing = await get_existing_idempotent_result(db, owner_user_id, key)
        if existing:
            return existing
        raise


async def complete_idempotency_key(
    db: AsyncIOMotorDatabase,
    owner_user_id: str,
    key: str,
    validation_id: str,
) -> None:
    """Link reserved idempotency key to created validation."""
    await db[VALIDATION_IDEMPOTENCY_KEYS].update_one(
        {"owner_user_id": owner_user_id, "idempotency_key": key},
        {"$set": {"validation_id": validation_id, "status": "completed", "updated_at": datetime.now(timezone.utc)}},
    )
