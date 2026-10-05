"""Validation model unit tests — Prompt A3."""

import json

import pytest

from app.models.enums import ValidationStatus
from app.models.validation import (
    EngineRunSummary,
    ValidationProgress,
    ValidationSession,
    ValidationStateHistoryEntry,
    new_validation_id,
)


class TestValidationModel:
    def test_validation_session_required_fields(self):
        session = ValidationSession(
            owner_user_id="usr_test",
            raw_goal="Build a clinic SaaS",
        )
        assert session.validation_id.startswith("val_")
        assert session.owner_user_id == "usr_test"
        assert session.status == ValidationStatus.draft

    def test_validation_id_present(self):
        vid = new_validation_id()
        assert vid.startswith("val_")

    def test_status_valid_enum(self):
        session = ValidationSession(
            owner_user_id="usr_test",
            raw_goal="goal",
            status=ValidationStatus.scoring,
        )
        assert session.status == ValidationStatus.scoring

    def test_state_history_entries(self):
        entry = ValidationStateHistoryEntry(
            from_status=ValidationStatus.draft,
            to_status=ValidationStatus.context_collected,
            reason="test",
        )
        session = ValidationSession(
            owner_user_id="usr_test",
            raw_goal="goal",
            state_history=[entry],
        )
        assert len(session.state_history) == 1
        assert session.state_history[0].to_status == ValidationStatus.context_collected

    def test_progress_percent_bounds(self):
        progress = ValidationProgress(percent_complete=50.0)
        assert 0 <= progress.percent_complete <= 100

    def test_terminal_timestamps_nullable(self):
        session = ValidationSession(owner_user_id="usr_test", raw_goal="goal")
        assert session.completed_at is None
        assert session.launched_at is None
        assert session.archived_at is None

    def test_failed_fields(self):
        session = ValidationSession(
            owner_user_id="usr_test",
            raw_goal="goal",
            status=ValidationStatus.failed,
            failed_reason="Engine timeout",
            failure_code="ENGINE_TIMEOUT",
        )
        assert session.failed_reason == "Engine timeout"
        assert session.failure_code == "ENGINE_TIMEOUT"

    def test_serialization_no_objectid(self):
        session = ValidationSession(owner_user_id="usr_test", raw_goal="goal")
        dumped = session.model_dump(mode="json")
        text = json.dumps(dumped)
        assert "ObjectId" not in text
        assert dumped["validation_id"].startswith("val_")
