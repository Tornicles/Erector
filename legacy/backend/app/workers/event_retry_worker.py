"""
Event Retry Worker — Prompt A3
Retries failed system events that are due for reprocessing.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.core.config import get_settings
from app.db.client import get_database
from app.db.collections import SYSTEM_EVENTS
from app.services.event_service import process_event
from models.enums import SystemEventStatus

logger = logging.getLogger(__name__)


async def run_event_retry_once() -> dict:
    """Process events that are failed and due for retry."""
    db = get_database()
    now = datetime.now(timezone.utc)
    cursor = db[SYSTEM_EVENTS].find(
        {
            "status": SystemEventStatus.failed.value,
            "next_retry_at": {"$lte": now},
        }
    ).limit(50)
    events = await cursor.to_list(length=50)
    processed = 0
    for evt in events:
        await process_event(db, evt["event_id"])
        processed += 1
    return {"retried": processed}


async def run_event_retry_loop(interval_seconds: int = 30) -> None:
    """Background loop for event retry processing."""
    while True:
        try:
            await run_event_retry_once()
        except Exception as exc:
            logger.exception("Event retry worker error: %s", exc)
        await asyncio.sleep(interval_seconds)
