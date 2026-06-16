"""
Event Service — Prompt A3
System event bus with retry policy and dead letter integration.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Union

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.core.errors import EventProcessingError
from app.db.collections import SYSTEM_EVENTS
from app.models.events import SystemEvent, new_event_id
from models.enums import SystemEventStatus, ValidationEventType

logger = logging.getLogger(__name__)


def calculate_next_retry_at(attempts: int) -> Optional[datetime]:
    """
    Calculate next retry time based on attempt count.
    attempt 1 → 30s, attempt 2 → 2min, attempt 3 → 10min.
  After max attempts, returns None.
    """
    settings = get_settings()
    backoff = settings.event_retry_backoff_list
    if attempts <= 0 or attempts > len(backoff):
        return None
    seconds = backoff[attempts - 1]
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


async def emit_event(
    db: AsyncIOMotorDatabase,
    event_type: Union[ValidationEventType, str],
    entity_type: str,
    entity_id: str,
    payload: dict,
    owner_user_id: Optional[str] = None,
    validation_id: Optional[str] = None,
    team_id: Optional[str] = None,
) -> str:
    """
    Create a pending system event. Never raises on non-critical failures.
    Returns event_id.
    """
    evt_type = event_type.value if isinstance(event_type, ValidationEventType) else event_type
    event = SystemEvent(
        event_id=new_event_id(),
        event_type=evt_type,
        entity_type=entity_type,
        entity_id=entity_id,
        validation_id=validation_id,
        owner_user_id=owner_user_id,
        team_id=team_id,
        payload=payload,
        status=SystemEventStatus.pending,
    )
    doc = event.model_dump(mode="json")
    try:
        await db[SYSTEM_EVENTS].insert_one(doc)
        logger.info("Event emitted: %s %s/%s", evt_type, entity_type, entity_id)
    except Exception as exc:
        logger.error("Failed to emit event %s: %s", evt_type, exc)
        return event.event_id
    return event.event_id


async def process_event(db: AsyncIOMotorDatabase, event_id: str) -> dict:
    """
    Process a pending event. Marks processed on success.
    On failure, increments attempts and schedules retry or dead letters.
    """
    from app.services.dead_letter_service import move_event_to_dead_letter

    settings = get_settings()
    doc = await db[SYSTEM_EVENTS].find_one({"event_id": event_id})
    if not doc:
        raise EventProcessingError(event_id, "Event not found")

    now = datetime.now(timezone.utc)
    await db[SYSTEM_EVENTS].update_one(
        {"event_id": event_id},
        {"$set": {"status": SystemEventStatus.processing.value, "updated_at": now}},
    )

    try:
        if doc.get("payload", {}).get("_simulate_failure"):
            raise RuntimeError("Simulated event processing failure")

        await db[SYSTEM_EVENTS].update_one(
            {"event_id": event_id},
            {
                "$set": {
                    "status": SystemEventStatus.processed.value,
                    "processed_at": now,
                    "updated_at": now,
                }
            },
        )
    except Exception as exc:
        attempts = doc.get("attempts", 0) + 1
        failure_reason = str(exc)
        next_retry = calculate_next_retry_at(attempts)

        if attempts >= settings.event_max_retry_attempts:
            updated = await db[SYSTEM_EVENTS].find_one({"event_id": event_id})
            updated["attempts"] = attempts
            updated["failure_reason"] = failure_reason
            await move_event_to_dead_letter(db, updated, failure_reason)
            await db[SYSTEM_EVENTS].update_one(
                {"event_id": event_id},
                {
                    "$set": {
                        "status": SystemEventStatus.dead_lettered.value,
                        "failed_at": now,
                        "failure_reason": failure_reason,
                        "attempts": attempts,
                        "updated_at": now,
                    }
                },
            )
        else:
            await db[SYSTEM_EVENTS].update_one(
                {"event_id": event_id},
                {
                    "$set": {
                        "status": SystemEventStatus.failed.value,
                        "failed_at": now,
                        "failure_reason": failure_reason,
                        "attempts": attempts,
                        "next_retry_at": next_retry,
                        "updated_at": now,
                    }
                },
            )

    return await db[SYSTEM_EVENTS].find_one({"event_id": event_id})


async def get_events_for_validation(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    limit: int = 50,
) -> list[dict]:
    """Return latest events for a validation."""
    cursor = (
        db[SYSTEM_EVENTS]
        .find({"validation_id": validation_id})
        .sort("emitted_at", -1)
        .limit(limit)
    )
    events = await cursor.to_list(length=limit)
    for evt in events:
        evt.pop("_id", None)
    return events
