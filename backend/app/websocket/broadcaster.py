"""
Event broadcaster — Prompt A6
Persists replayable live events, adds to buffer, broadcasts to WS clients.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.db.collections import VALIDATION_LIVE_EVENTS
from app.websocket.buffer import ValidationLiveEventBuffer
from app.websocket.connection_manager import ConnectionManager


class LiveEventBroadcaster:
    def __init__(self, manager: ConnectionManager, buffer: ValidationLiveEventBuffer) -> None:
        self.manager = manager
        self.buffer = buffer

    async def broadcast_live_event(self, db: AsyncIOMotorDatabase, event: dict) -> dict:
        settings = get_settings()
        validation_id = event["validation_id"]

        if settings.websocket_persist_live_events and event.get("replayable", True):
            await db[VALIDATION_LIVE_EVENTS].insert_one(dict(event))

        await self.buffer.add_event(validation_id, event)
        summary = await self.manager.broadcast_to_validation(
            validation_id,
            {
                "type": "event",
                "connection_id": "broadcast",
                "sequence_number": event.get("sequence_number"),
                "event": event,
            },
        )
        summary["live_event_id"] = event.get("live_event_id")
        return summary

