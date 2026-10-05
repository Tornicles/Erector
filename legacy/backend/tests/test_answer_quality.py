"""Answer quality tests — Prompt A4."""

from app.models.context import ContextAnswer, ValidationContext
from app.models.questions import QuestionDefinition
from app.services.answer_quality_service import (
    detect_vague_answer,
    evaluate_answer_quality,
    evaluate_context_quality,
)
from app.services.question_catalog import QUESTION_BY_ID
from models.enums import AnswerQualityFlag, QuestionCategory


class TestAnswerQuality:
    def test_everyone_vague(self):
        assert detect_vague_answer("Everyone needs this")

    def test_no_competitors_flagged(self):
        q = QUESTION_BY_ID["industry_competitors"]
        ans = ContextAnswer(question_id=q.question_id, category=QuestionCategory.industry, value="no competitors")
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        flags = evaluate_answer_quality(ans, q, ctx)
        assert AnswerQualityFlag.no_competitor_claim.value in flags

    def test_viral_unsupported(self):
        q = QUESTION_BY_ID["basic_success"]
        ans = ContextAnswer(question_id=q.question_id, category=QuestionCategory.basic, value="It will go viral")
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        flags = evaluate_answer_quality(ans, q, ctx)
        assert AnswerQualityFlag.unsupported_claim.value in flags or AnswerQualityFlag.inflated.value in flags

    def test_regulated_no_legal_flagged(self):
        q = QUESTION_BY_ID["risk_legal_constraints"]
        ans = ContextAnswer(question_id=q.question_id, category=QuestionCategory.risk, value="none")
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="insurance fintech")
        from app.services.goal_interpretation_service import interpret_goal_deterministically
        ctx.structured_goal = interpret_goal_deterministically(ctx.raw_goal)
        flags = evaluate_answer_quality(ans, q, ctx)
        assert AnswerQualityFlag.missing_legal_constraint.value in flags

    def test_specific_customer_passes(self):
        q = QUESTION_BY_ID["basic_target_customer"]
        ans = ContextAnswer(
            question_id=q.question_id, category=QuestionCategory.basic,
            value="Independent dental clinics in Munich with 3-10 staff",
        )
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        flags = evaluate_answer_quality(ans, q, ctx)
        assert AnswerQualityFlag.acceptable.value in flags

    def test_interviews_improve_score(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="SaaS")
        ctx.answers = [
            ContextAnswer(
                question_id="evidence_customer_proof", category=QuestionCategory.evidence,
                value="customer_interviews", quality_flags=[AnswerQualityFlag.acceptable.value],
            ),
            ContextAnswer(
                question_id="basic_target_customer", category=QuestionCategory.basic,
                value="German clinics", quality_flags=[AnswerQualityFlag.acceptable.value],
            ),
        ]
        report = evaluate_context_quality(ctx)
        assert report.overall_quality_score >= 6

    def test_contradiction_detected(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="million users fast")
        ctx.answers = [
            ContextAnswer(question_id="evidence_customer_proof", category=QuestionCategory.evidence, value="no_evidence"),
        ]
        q = QUESTION_BY_ID["basic_success"]
        ans = ContextAnswer(question_id=q.question_id, category=QuestionCategory.basic, value="1 million users in a month")
        flags = evaluate_answer_quality(ans, q, ctx)
        assert AnswerQualityFlag.contradictory.value in flags

    def test_low_score_blocks(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        ctx.answers = [
            ContextAnswer(
                question_id="basic_target_customer", category=QuestionCategory.basic,
                value="everyone", quality_flags=[AnswerQualityFlag.everyone_needs_this.value, AnswerQualityFlag.vague.value],
            ),
        ]
        for a in ctx.answers:
            a.quality_flags = evaluate_answer_quality(a, QUESTION_BY_ID[a.question_id], ctx)
        report = evaluate_context_quality(ctx)
        assert report.can_continue is False or report.overall_quality_score < 6
