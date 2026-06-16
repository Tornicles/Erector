"""Event service tests — Prompt A3."""

import pytest
import pytest_asyncio

from app.db.collections import SYSTEM_EVENTS
from app.models.events import new_event_id
from app.services.event_service import (
    calculate_next_retry_at,
    emit_event,
    get_events_for_validation,
    process_event,
)
from models.enums import SystemEventStatus, ValidationEventType


@pytest_asyncio.fixture
async def event_db(db):
    yield db


class TestEventService:
    @pytest.mark.asyncio
    async def test_emit_event_creates_pending(self, event_db):
        eid = await emit_event(
            event_db,
            ValidationEventType.validation_created,
            "validation",
            "val_test",
            {"test": True},
            owner_user_id="usr_test",
            validation_id="val_test",
        )
        doc = await event_db[SYSTEM_EVENTS].find_one({"event_id": eid})
        assert doc["status"] == SystemEventStatus.pending.value

    @pytest.mark.asyncio
    async def test_process_event_marks_processed(self, event_db):
        eid = await emit_event(
            event_db,
            ValidationEventType.validation_state_changed,
            "validation",
            "val_proc",
            {},
        )
        result = await process_event(event_db, eid)
        assert result["status"] == SystemEventStatus.processed.value

    @pytest.mark.asyncio
    async def test_failed_processing_increments_attempts(self, event_db):
        eid = await emit_event(
            event_db,
            ValidationEventType.validation_state_changed,
            "validation",
            "val_fail",
            {"_simulate_failure": True},
        )
        await process_event(event_db, eid)
        doc = await event_db[SYSTEM_EVENTS].find_one({"event_id": eid})
        assert doc["attempts"] == 1
        assert doc["status"] == SystemEventStatus.failed.value

    def test_retry_backoff_schedule(self):
        t1 = calculate_next_retry_at(1)
        t2 = calculate_next_retry_at(2)
        t3 = calculate_next_retry_at(3)
        assert t1 is not None
        assert t2 is not None
        assert t3 is not None
        assert (t2 - t1).total_seconds() > 0 or t2 > t1

    @pytest.mark.asyncio
    async def test_get_events_by_validation_id(self, event_db):
        vid = "val_events_list"
        await emit_event(
            event_db,
            ValidationEventType.validation_created,
            "validation",
            vid,
            {},
            validation_id=vid,
        )
        events = await get_events_for_validation(event_db, vid)
        assert len(events) >= 1
