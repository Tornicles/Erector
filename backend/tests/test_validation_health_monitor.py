"""Validation health monitor tests — Prompt A3."""

from datetime import datetime, timedelta, timezone

import pytest

from app.db.collections import SYSTEM_EVENTS, VALIDATION_SESSIONS
from app.models.enums import ValidationStatus
from app.models.validation import ValidationSession, new_validation_id
from app.services.event_service import emit_event
from app.services.validation_health_service import (
    check_validation_health,
    find_stuck_validations,
    mark_validation_activity,
)
from models.enums import ValidationEventType


def _old_time(minutes: int = 6) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


class TestValidationHealthMonitor:
    @pytest.mark.asyncio
    async def test_idle_active_validation_flagged_stuck(self, db):
        session = ValidationSession(
            validation_id=new_validation_id(),
            owner_user_id="usr_health",
            raw_goal="stuck test",
            status=ValidationStatus.engines_running,
            last_activity_at=_old_time(6),
        )
        doc = session.model_dump(mode="json")
        doc["last_activity_at"] = _old_time(6)
        await db[VALIDATION_SESSIONS].insert_one(doc)
        health = await check_validation_health(db, session.validation_id, idle_minutes=5)
        assert health.is_stuck is True
        assert health.idle_seconds >= 300

    @pytest.mark.asyncio
    async def test_draft_not_flagged_stuck(self, db):
        session = ValidationSession(
            validation_id=new_validation_id(),
            owner_user_id="usr_health",
            raw_goal="draft idle",
            status=ValidationStatus.draft,
            last_activity_at=_old_time(10),
        )
        doc = session.model_dump(mode="json")
        doc["last_activity_at"] = _old_time(10)
        await db[VALIDATION_SESSIONS].insert_one(doc)
        health = await check_validation_health(db, session.validation_id, idle_minutes=5)
        assert health.is_stuck is False

    @pytest.mark.asyncio
    async def test_context_collecting_not_stuck(self, db):
        session = ValidationSession(
            validation_id=new_validation_id(),
            owner_user_id="usr_health",
            raw_goal="collecting",
            status=ValidationStatus.context_collecting,
            last_activity_at=_old_time(10),
        )
        doc = session.model_dump(mode="json")
        doc["last_activity_at"] = _old_time(10)
        await db[VALIDATION_SESSIONS].insert_one(doc)
        health = await check_validation_health(db, session.validation_id, idle_minutes=5)
        assert health.is_stuck is False

    @pytest.mark.asyncio
    async def test_engines_running_idle_flagged(self, db):
        session = ValidationSession(
            validation_id=new_validation_id(),
            owner_user_id="usr_health",
            raw_goal="engines idle",
            status=ValidationStatus.engines_running,
            last_activity_at=_old_time(6),
        )
        doc = session.model_dump(mode="json")
        doc["last_activity_at"] = _old_time(6)
        await db[VALIDATION_SESSIONS].insert_one(doc)
        health = await check_validation_health(db, session.validation_id, idle_minutes=5)
        assert health.is_stuck is True

    @pytest.mark.asyncio
    async def test_recent_event_prevents_stuck(self, db):
        session = ValidationSession(
            validation_id=new_validation_id(),
            owner_user_id="usr_health",
            raw_goal="recent event",
            status=ValidationStatus.scoring,
            last_activity_at=_old_time(10),
        )
        doc = session.model_dump(mode="json")
        doc["last_activity_at"] = _old_time(10)
        await db[VALIDATION_SESSIONS].insert_one(doc)
        await emit_event(
            db,
            ValidationEventType.validation_state_changed,
            "validation",
            session.validation_id,
            {},
            validation_id=session.validation_id,
        )
        await db[SYSTEM_EVENTS].update_one(
            {"validation_id": session.validation_id},
            {"$set": {"emitted_at": datetime.now(timezone.utc)}},
        )
        health = await check_validation_health(db, session.validation_id, idle_minutes=5)
        assert health.is_stuck is False

    @pytest.mark.asyncio
    async def test_health_includes_idle_seconds(self, db):
        session = ValidationSession(
            validation_id=new_validation_id(),
            owner_user_id="usr_health",
            raw_goal="idle seconds",
            status=ValidationStatus.path_generation,
            last_activity_at=_old_time(6),
        )
        doc = session.model_dump(mode="json")
        doc["last_activity_at"] = _old_time(6)
        await db[VALIDATION_SESSIONS].insert_one(doc)
        health = await check_validation_health(db, session.validation_id, idle_minutes=5)
        assert health.idle_seconds > 0

    @pytest.mark.asyncio
    async def test_find_stuck_validations(self, db):
        session = ValidationSession(
            validation_id=new_validation_id(),
            owner_user_id="usr_health",
            raw_goal="find stuck",
            status=ValidationStatus.report_ready,
            last_activity_at=_old_time(6),
        )
        doc = session.model_dump(mode="json")
        doc["last_activity_at"] = _old_time(6)
        await db[VALIDATION_SESSIONS].insert_one(doc)
        stuck = await find_stuck_validations(db, idle_minutes=5)
        ids = [s["validation_id"] for s in stuck]
        assert session.validation_id in ids

    @pytest.mark.asyncio
    async def test_mark_activity_updates_last_activity(self, db):
        session = ValidationSession(
            validation_id=new_validation_id(),
            owner_user_id="usr_health",
            raw_goal="activity update",
            status=ValidationStatus.engines_running,
            last_activity_at=_old_time(6),
        )
        doc = session.model_dump(mode="json")
        doc["last_activity_at"] = _old_time(6)
        doc["warnings"] = ["STUCK: test warning"]
        await db[VALIDATION_SESSIONS].insert_one(doc)
        await mark_validation_activity(db, session.validation_id, "Processing resumed")
        updated = await db[VALIDATION_SESSIONS].find_one({"validation_id": session.validation_id})
        assert updated["last_activity_at"] > _old_time(6)
        assert not any(w.startswith("STUCK:") for w in updated.get("warnings", []))
