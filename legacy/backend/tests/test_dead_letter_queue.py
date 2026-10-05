"""Dead letter queue tests — Prompt A3."""

import pytest

from app.db.collections import AUDIT_LOGS, DEAD_LETTER_QUEUE, SYSTEM_EVENTS
from app.services.dead_letter_service import (
    list_dead_letters,
    mark_dead_letter_ignored,
    mark_dead_letter_resolved,
    move_event_to_dead_letter,
    retry_dead_letter,
)
from app.services.event_service import emit_event, process_event
from models.enums import ValidationEventType


class TestDeadLetterQueue:
    @pytest.mark.asyncio
    async def test_event_moves_to_dlq_after_max_attempts(self, db):
        eid = await emit_event(
            db,
            ValidationEventType.validation_state_changed,
            "validation",
            "val_dlq",
            {"_simulate_failure": True},
            validation_id="val_dlq",
        )
        for _ in range(3):
            await process_event(db, eid)

        dlq_items = await list_dead_letters(db, validation_id="val_dlq")
        assert len(dlq_items) >= 1
        evt = await db[SYSTEM_EVENTS].find_one({"event_id": eid})
        assert evt["status"] == "dead_lettered"

    @pytest.mark.asyncio
    async def test_dlq_includes_original_event_id(self, db):
        eid = await emit_event(
            db,
            ValidationEventType.validation_failed,
            "validation",
            "val_dlq2",
            {"_simulate_failure": True},
        )
        for _ in range(3):
            await process_event(db, eid)
        items = await db[DEAD_LETTER_QUEUE].find({"original_event_id": eid}).to_list(1)
        assert items
        assert items[0]["original_event_id"] == eid

    @pytest.mark.asyncio
    async def test_retry_dead_letter(self, db):
        eid = await emit_event(
            db,
            ValidationEventType.validation_archived,
            "validation",
            "val_dlq3",
            {"_simulate_failure": True},
        )
        for _ in range(3):
            await process_event(db, eid)
        dlq = await db[DEAD_LETTER_QUEUE].find_one({"original_event_id": eid})
        # Remove simulate failure for retry success
        await db[SYSTEM_EVENTS].update_one(
            {"event_id": eid},
            {"$set": {"payload": {}, "status": "pending", "attempts": 0}},
        )
        result = await retry_dead_letter(db, dlq["dead_letter_id"])
        assert result["status"] in ("processed", "pending", "processing")

    @pytest.mark.asyncio
    async def test_mark_resolved(self, db):
        eid = await emit_event(
            db,
            ValidationEventType.validation_created,
            "validation",
            "val_dlq4",
            {},
        )
        await move_event_to_dead_letter(db, {"event_id": eid, "event_type": "test", "entity_type": "validation", "entity_id": "val_dlq4", "payload": {}, "attempts": 3}, "manual")
        dlq = await db[DEAD_LETTER_QUEUE].find_one({"original_event_id": eid})
        await mark_dead_letter_resolved(db, dlq["dead_letter_id"])
        updated = await db[DEAD_LETTER_QUEUE].find_one({"dead_letter_id": dlq["dead_letter_id"]})
        assert updated["status"] == "resolved"

    @pytest.mark.asyncio
    async def test_mark_ignored(self, db):
        eid = await emit_event(
            db,
            ValidationEventType.validation_created,
            "validation",
            "val_dlq5",
            {},
        )
        await move_event_to_dead_letter(db, {"event_id": eid, "event_type": "test", "entity_type": "validation", "entity_id": "val_dlq5", "payload": {}, "attempts": 3}, "ignored test")
        dlq = await db[DEAD_LETTER_QUEUE].find_one({"original_event_id": eid})
        await mark_dead_letter_ignored(db, dlq["dead_letter_id"], "not needed")
        updated = await db[DEAD_LETTER_QUEUE].find_one({"dead_letter_id": dlq["dead_letter_id"]})
        assert updated["status"] == "ignored"

    @pytest.mark.asyncio
    async def test_dlq_writes_audit_log(self, db):
        eid = await emit_event(
            db,
            ValidationEventType.validation_created,
            "validation",
            "val_dlq6",
            {},
        )
        await move_event_to_dead_letter(
            db,
            {"event_id": eid, "event_type": "test", "entity_type": "validation", "entity_id": "val_dlq6", "payload": {}, "attempts": 3},
            "audit test",
        )
        entry = await db[AUDIT_LOGS].find_one({"action": "event.dead_lettered", "entity_id": eid})
        assert entry is not None
