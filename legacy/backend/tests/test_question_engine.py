"""Question engine tests — Prompt A4."""

import pytest

from app.models.context import ValidationContext
from app.services.question_branching_service import get_required_questions
from app.services.question_catalog import BASE_QUESTIONS
from app.services.question_engine_service import calculate_question_progress, determine_context_status
from models.enums import ContextStatus


class TestQuestionEngine:
    def test_basic_questions_in_catalog(self):
        basic = [q for q in BASE_QUESTIONS if q.category.value == "basic"]
        assert len(basic) >= 5

    def test_required_categories_included(self):
        ctx = ValidationContext(
            validation_id="val_q", owner_user_id="u",
            raw_goal="SaaS for clinics",
        )
        validation = {"goal_type": "business", "user_type": "individual"}
        qs = get_required_questions(ctx, validation)
        cats = {q.category.value for q in qs}
        for c in ("basic", "industry", "economy", "evidence", "risk"):
            assert c in cats

    def test_batch_size_config(self):
        from app.core.config import get_settings
        assert get_settings().context_max_batch_size <= 7

    def test_answered_not_repeated_in_batch_logic(self):
        from app.services.question_branching_service import dedupe_questions
        from app.services.question_catalog import QUESTION_BY_ID
        q = QUESTION_BY_ID["basic_problem"]
        result = dedupe_questions(["basic_problem"], [q])
        assert len(result) == 0

    def test_progress_updates(self):
        from app.models.context import ContextAnswer
        from models.enums import QuestionCategory
        ctx = ValidationContext(validation_id="val_p", owner_user_id="u", raw_goal="goal")
        ctx.answers = [
            ContextAnswer(question_id="basic_problem", category=QuestionCategory.basic, value="pain"),
        ]
        progress = calculate_question_progress(ctx, {"goal_type": "business"})
        assert progress.total_answered == 1

    def test_status_in_progress(self):
        from app.models.context import ContextAnswer
        from models.enums import QuestionCategory
        ctx = ValidationContext(validation_id="val_s", owner_user_id="u", raw_goal="g")
        ctx.answers = [ContextAnswer(question_id="x", category=QuestionCategory.basic, value="y")]
        assert determine_context_status(ctx) == ContextStatus.in_progress

    def test_missing_required_prevents_complete(self):
        ctx = ValidationContext(validation_id="val_m", owner_user_id="u", raw_goal="g")
        ctx.missing_fields = ["basic_target_customer"]
        assert determine_context_status(ctx) == ContextStatus.missing_required_fields

    def test_question_state_persists_fields(self):
        ctx = ValidationContext(validation_id="val_qs", owner_user_id="u", raw_goal="g")
        ctx.question_state.asked_question_ids.append("basic_problem")
        assert "basic_problem" in ctx.question_state.asked_question_ids
