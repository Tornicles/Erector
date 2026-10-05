"""Question branching tests — Prompt A4."""

from app.models.context import ContextAnswer, ValidationContext
from app.services.question_branching_service import (
    evaluate_branch_conditions,
    get_follow_up_questions,
    get_industry_questions,
    get_revenue_questions,
    get_team_questions,
)
from models.enums import QuestionCategory, UserType


def _ctx(**answers) -> ValidationContext:
    ctx = ValidationContext(
        validation_id="val_b", owner_user_id="u",
        raw_goal="Insurance fintech SaaS for everyone",
    )
    ctx.answers = [
        ContextAnswer(question_id=k, category=QuestionCategory.basic, value=v)
        for k, v in answers.items()
    ]
    return ctx


class TestQuestionBranching:
    def test_fintech_legal_followup(self):
        ctx = _ctx(industry_sector="fintech")
        branches = evaluate_branch_conditions(ctx, {"goal_type": "business"})
        qs = get_industry_questions(ctx, branches)
        ids = [q.question_id for q in qs]
        assert "industry_license" in ids

    def test_insurance_branch(self):
        ctx = ValidationContext(
            validation_id="v", owner_user_id="u",
            raw_goal="Insurance platform for gig workers",
        )
        ctx.answers = [ContextAnswer(
            question_id="industry_sector", category=QuestionCategory.industry, value="insurance",
        )]
        branches = evaluate_branch_conditions(ctx, {"goal_type": "business"})
        assert branches["regulated"]
        qs = get_industry_questions(ctx, branches)
        assert any("legal" in q.question_id for q in qs)

    def test_creator_platform(self):
        ctx = ValidationContext(
            validation_id="v", owner_user_id="u",
            raw_goal="Creator content platform on YouTube",
        )
        branches = evaluate_branch_conditions(ctx, {"goal_type": "creator"})
        assert branches["creator"]

    def test_saas_technical_risk(self):
        ctx = ValidationContext(
            validation_id="v", owner_user_id="u",
            raw_goal="B2B SaaS software product",
        )
        branches = evaluate_branch_conditions(ctx, {"goal_type": "business"})
        assert branches["saas"]

    def test_team_mode_questions(self):
        ctx = _ctx()
        qs = get_team_questions(ctx, {"team_id": "team_1", "user_type": UserType.team.value}, {"team_mode": True})
        ids = [q.question_id for q in qs]
        assert "team_size" in ids

    def test_individual_capacity_questions(self):
        ctx = _ctx()
        qs = get_team_questions(ctx, {"user_type": UserType.individual.value}, {"team_mode": False})
        ids = [q.question_id for q in qs]
        assert "individual_skills" in ids

    def test_no_evidence_followup(self):
        ctx = _ctx(evidence_customer_proof="no_evidence")
        branches = evaluate_branch_conditions(ctx, {"goal_type": "business"})
        follow = get_follow_up_questions(ctx, branches)
        assert any(q.question_id == "followup_cheapest_test" for q in follow)

    def test_no_competitors_followup(self):
        ctx = _ctx(industry_competitors="no competitors")
        branches = evaluate_branch_conditions(ctx, {"goal_type": "business"})
        assert branches["no_competitors"]

    def test_cross_border_economy(self):
        ctx = _ctx(
            economy_founder_country="Germany",
            economy_customer_country="United States",
        )
        branches = evaluate_branch_conditions(ctx, {"goal_type": "business"})
        assert branches["cross_border"]

    def test_revenue_for_business_goal(self):
        ctx = _ctx()
        qs = get_revenue_questions()
        assert len(qs) >= 5
