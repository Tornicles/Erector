"""
Event broadcast service — Prompt A6
Converts SystemEvent → LiveFeedEvent and broadcasts to connected clients.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.live_feed import LiveFeedEvent
from app.services.live_feed_service import create_live_event
from app.services.validation_live_service import (
    build_context_collected_event,
    build_economic_stack_built_event,
    build_validation_archived_event,
    build_validation_created_event,
    build_validation_failed_event,
    build_validation_state_changed_event,
)
from app.websocket.broadcaster import LiveEventBroadcaster
from models.enums import LiveFeedEventType, ValidationEventType


def _map_system_event_to_live(system_event: dict) -> dict | None:
    evt_type = system_event.get("event_type")
    if evt_type == ValidationEventType.validation_created.value:
        return build_validation_created_event({})
    if evt_type == ValidationEventType.validation_state_changed.value:
        payload = system_event.get("payload") or {}
        return build_validation_state_changed_event(
            payload.get("from_status", ""),
            payload.get("to_status", ""),
            payload.get("reason", ""),
        )
    if evt_type == ValidationEventType.context_collected.value:
        return build_context_collected_event()
    if evt_type == ValidationEventType.economic_stack_built.value:
        return build_economic_stack_built_event()
    if evt_type == ValidationEventType.validation_failed.value:
        payload = system_event.get("payload") or {}
        return build_validation_failed_event(payload.get("reason", "Validation failed."))
    if evt_type == ValidationEventType.validation_archived.value:
        return build_validation_archived_event()
    return None


async def record_and_broadcast_system_event(
    db: AsyncIOMotorDatabase,
    broadcaster: LiveEventBroadcaster,
    system_event: dict,
) -> None:
    live_template = _map_system_event_to_live(system_event)
    if not live_template:
        return
    validation_id = system_event.get("validation_id")
    owner_user_id = system_event.get("owner_user_id")
    if not validation_id or not owner_user_id:
        return
    live = await create_live_event(
        db,
        validation_id=validation_id,
        owner_user_id=owner_user_id,
        event_type=live_template["event_type"],
        title=live_template["title"],
        message=live_template["message"],
        level=live_template["level"],
        payload={"correlation_event_id": system_event.get("event_id")},
        source="system_event",
        replayable=True,
        correlation_event_id=system_event.get("event_id"),
    )
    await broadcaster.broadcast_live_event(db, live.model_dump(mode="json"))

