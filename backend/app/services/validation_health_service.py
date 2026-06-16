"""
Validation Health Service — Prompt A3
Stuck validation detection and health monitoring.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.db.collections import SYSTEM_EVENTS, VALIDATION_SESSIONS
from app.models.enums import ValidationStatus
from app.models.validation import ValidationHealthStatus
from app.services.validation_state_machine import is_stuck_eligible

logger = logging.getLogger(__name__)

NON_STUCK_STATES = {
    ValidationStatus.draft,
    ValidationStatus.context_collecting,
    ValidationStatus.context_collected,
}


async def _latest_event_time(
    db: AsyncIOMotorDatabase,
    validation_id: str,
) -> Optional[datetime]:
    evt = await db[SYSTEM_EVENTS].find_one(
        {"validation_id": validation_id},
        sort=[("emitted_at", -1)],
    )
    if not evt:
        return None
    emitted = evt.get("emitted_at")
    if isinstance(emitted, datetime) and emitted.tzinfo is None:
        return emitted.replace(tzinfo=timezone.utc)
    return emitted


def _parse_dt(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    return None


async def check_validation_health(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    idle_minutes: int = 5,
) -> ValidationHealthStatus:
    """Check if a validation is stuck based on idle time and recent events."""
    settings = get_settings()
    idle_seconds_threshold = idle_minutes * 60 or settings.validation_stuck_after_seconds

    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        from app.core.errors import ValidationNotFoundError
        raise ValidationNotFoundError(validation_id)

    status = ValidationStatus(doc["status"])
    now = datetime.now(timezone.utc)
    last_activity = _parse_dt(doc.get("last_activity_at")) or _parse_dt(doc.get("created_at")) or now
    latest_event = await _latest_event_time(db, validation_id)

    reference_time = last_activity
    if latest_event and latest_event > reference_time:
        reference_time = latest_event

    idle_seconds = int((now - reference_time).total_seconds())
    is_stuck = False
    stuck_reason = None

    if status in NON_STUCK_STATES:
        is_stuck = False
    elif is_stuck_eligible(status) and idle_seconds >= idle_seconds_threshold:
        is_stuck = True
        stuck_reason = (
            f"Validation in '{status.value}' has been idle for {idle_seconds}s "
            f"(threshold: {idle_seconds_threshold}s)"
        )

    return ValidationHealthStatus(
        status=status,
        is_stuck=is_stuck,
        stuck_reason=stuck_reason,
        idle_seconds=idle_seconds,
        last_activity_at=last_activity,
        checked_at=now,
    )


async def find_stuck_validations(
    db: AsyncIOMotorDatabase,
    idle_minutes: int = 5,
) -> list[dict]:
    """Find validations that appear stuck."""
    settings = get_settings()
    threshold = idle_minutes * 60 or settings.validation_stuck_after_seconds
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=threshold)

    from app.services.validation_state_machine import STUCK_ELIGIBLE_STATES
    stuck_statuses = [s.value for s in STUCK_ELIGIBLE_STATES]

    cursor = db[VALIDATION_SESSIONS].find(
        {
            "status": {"$in": stuck_statuses},
            "last_activity_at": {"$lt": cutoff},
        }
    )
    candidates = await cursor.to_list(length=200)
    results = []
    for doc in candidates:
        health = await check_validation_health(db, doc["validation_id"], idle_minutes=idle_minutes)
        if health.is_stuck:
            results.append({**doc, "health": health.model_dump(mode="json")})
    return results


async def flag_stuck_validation(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    reason: str,
) -> None:
    """Add stuck warning to validation without auto-failing."""
    warning = f"STUCK: {reason}"
    await db[VALIDATION_SESSIONS].update_one(
        {"validation_id": validation_id},
        {"$addToSet": {"warnings": warning}},
    )


async def recover_stuck_validation(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    strategy: str = "flag_only",
) -> dict:
    """
    Recovery hook for stuck validations. A3 only flags; future prompts may restart engines.
    """
    if strategy == "flag_only":
        health = await check_validation_health(db, validation_id)
        if health.is_stuck and health.stuck_reason:
            await flag_stuck_validation(db, validation_id, health.stuck_reason)
        return {"validation_id": validation_id, "strategy": strategy, "recovered": False}
    return {"validation_id": validation_id, "strategy": strategy, "recovered": False}


async def mark_validation_activity(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    message: Optional[str] = None,
) -> None:
    """Update last_activity_at and optionally progress message."""
    now = datetime.now(timezone.utc)
    update: dict = {"last_activity_at": now, "updated_at": now}
    if message:
        update["progress.live_message"] = message
        update["progress.updated_at"] = now

    await db[VALIDATION_SESSIONS].update_one(
        {"validation_id": validation_id},
        {"$set": update},
    )

    # Remove stuck warnings on activity
    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if doc and doc.get("warnings"):
        cleaned = [w for w in doc["warnings"] if not w.startswith("STUCK:")]
        if len(cleaned) != len(doc["warnings"]):
            await db[VALIDATION_SESSIONS].update_one(
                {"validation_id": validation_id},
                {"$set": {"warnings": cleaned}},
            )
