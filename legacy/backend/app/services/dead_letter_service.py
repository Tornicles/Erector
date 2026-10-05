"""
Dead Letter Queue Service — Prompt A3
Handles events that exceed max retry attempts.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.collections import DEAD_LETTER_QUEUE, SYSTEM_EVENTS
from app.models.events import DeadLetterQueueItem, new_dead_letter_id
from app.services.audit_service import write_audit_log
from app.services.event_service import process_event
from models.enums import DeadLetterStatus, SystemEventStatus

logger = logging.getLogger(__name__)


async def move_event_to_dead_letter(
    db: AsyncIOMotorDatabase,
    event: dict,
    failure_reason: str,
) -> str:
    """Move a failed event to the dead letter queue. Returns dead_letter_id."""
    item = DeadLetterQueueItem(
        dead_letter_id=new_dead_letter_id(),
        original_event_id=event["event_id"],
        event_type=event["event_type"],
        entity_type=event["entity_type"],
        entity_id=event["entity_id"],
        validation_id=event.get("validation_id"),
        owner_user_id=event.get("owner_user_id"),
        payload=event.get("payload", {}),
        failure_reason=failure_reason,
        attempts=event.get("attempts", 0),
        status=DeadLetterStatus.open,
    )
    doc = item.model_dump(mode="json")
    await db[DEAD_LETTER_QUEUE].insert_one(doc)

    await write_audit_log(
        db,
        action="event.dead_lettered",
        entity_type="system_event",
        entity_id=event["event_id"],
        actor_user_id=event.get("owner_user_id") or "system",
        owner_user_id=event.get("owner_user_id"),
        team_id=event.get("team_id"),
        old_value={"status": event.get("status")},
        new_value={"dead_letter_id": item.dead_letter_id, "failure_reason": failure_reason},
    )

    logger.warning("Event %s moved to dead letter queue: %s", event["event_id"], item.dead_letter_id)
    return item.dead_letter_id


async def list_dead_letters(
    db: AsyncIOMotorDatabase,
    status: Optional[DeadLetterStatus] = None,
    validation_id: Optional[str] = None,
    limit: int = 50,
) -> list[dict]:
    """List dead letter queue items."""
    query: dict = {}
    if status:
        query["status"] = status.value
    if validation_id:
        query["validation_id"] = validation_id
    cursor = db[DEAD_LETTER_QUEUE].find(query).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    for item in items:
        item.pop("_id", None)
    return items


async def retry_dead_letter(db: AsyncIOMotorDatabase, dead_letter_id: str) -> dict:
    """Retry a dead lettered event by resetting and reprocessing."""
    dlq = await db[DEAD_LETTER_QUEUE].find_one({"dead_letter_id": dead_letter_id})
    if not dlq:
        raise ValueError(f"Dead letter not found: {dead_letter_id}")

    now = datetime.now(timezone.utc)
    await db[DEAD_LETTER_QUEUE].update_one(
        {"dead_letter_id": dead_letter_id},
        {"$set": {"status": DeadLetterStatus.retrying.value, "updated_at": now}},
    )

    await db[SYSTEM_EVENTS].update_one(
        {"event_id": dlq["original_event_id"]},
        {
            "$set": {
                "status": SystemEventStatus.pending.value,
                "attempts": 0,
                "next_retry_at": None,
                "failure_reason": None,
                "updated_at": now,
            }
        },
    )

    return await process_event(db, dlq["original_event_id"])


async def mark_dead_letter_resolved(db: AsyncIOMotorDatabase, dead_letter_id: str) -> None:
    """Mark a dead letter item as resolved."""
    await db[DEAD_LETTER_QUEUE].update_one(
        {"dead_letter_id": dead_letter_id},
        {"$set": {"status": DeadLetterStatus.resolved.value, "updated_at": datetime.now(timezone.utc)}},
    )


async def mark_dead_letter_ignored(
    db: AsyncIOMotorDatabase,
    dead_letter_id: str,
    reason: str,
) -> None:
    """Mark a dead letter item as ignored."""
    await db[DEAD_LETTER_QUEUE].update_one(
        {"dead_letter_id": dead_letter_id},
        {
            "$set": {
                "status": DeadLetterStatus.ignored.value,
                "updated_at": datetime.now(timezone.utc),
                "metadata": {"ignore_reason": reason},
            }
        },
    )
