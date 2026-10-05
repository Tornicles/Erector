"""Context model unit tests — Prompt A4."""

import json

import pytest

from app.models.context import (
    AntiGamingFlag,
    ContextAnswer,
    ContextBlocker,
    EngineInputObject,
    KnowledgeGap,
    StructuredGoal,
    ValidationContext,
)
from models.enums import AntiGamingFlagType, ContextBlockerType, KnowledgeGapSeverity, QuestionCategory


class TestContextModels:
    def test_validation_context_required_fields(self):
        ctx = ValidationContext(
            validation_id="val_test",
            owner_user_id="usr_test",
            raw_goal="Build a SaaS tool",
        )
        assert ctx.context_id.startswith("ctx_")
        assert ctx.validation_id == "val_test"

    def test_structured_goal_clarity_bounds(self):
        sg = StructuredGoal(clarity_score=7.5)
        assert 0 <= sg.clarity_score <= 10

    def test_context_answer_normalized_value(self):
        ans = ContextAnswer(
            question_id="basic_target_customer",
            category=QuestionCategory.basic,
            value="Everyone",
            normalized_value="gig workers in lagos",
        )
        assert ans.value == "Everyone"
        assert ans.normalized_value == "gig workers in lagos"

    def test_anti_gaming_flag(self):
        flag = AntiGamingFlag(
            flag_type=AntiGamingFlagType.no_customer_evidence,
            description="No evidence",
            blocks_progress=True,
        )
        assert flag.blocks_progress is True

    def test_knowledge_gap_severity(self):
        gap = KnowledgeGap(
            severity=KnowledgeGapSeverity.critical,
            claim_type="customer_demand",
            description="Missing customer",
        )
        assert gap.severity == KnowledgeGapSeverity.critical

    def test_engine_input_object(self):
        obj = EngineInputObject(
            validation_id="val_test",
            raw_goal="goal",
            readiness_for_engines=False,
        )
        assert obj.validation_id == "val_test"
        assert obj.readiness_for_engines is False

    def test_context_blocker_resolution_action(self):
        blocker = ContextBlocker(
            blocker_type=ContextBlockerType.anti_gaming_flag,
            message="Blocked",
            resolution_action="Clarify timeline",
        )
        assert blocker.resolution_action == "Clarify timeline"

    def test_serialization_no_objectid(self):
        ctx = ValidationContext(validation_id="val_x", owner_user_id="u", raw_goal="g")
        text = json.dumps(ctx.model_dump(mode="json"))
        assert "ObjectId" not in text
