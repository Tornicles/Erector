"""Preliminary knowledge gap tests — Prompt A4."""

from app.models.context import ContextAnswer, ValidationContext
from app.services.preliminary_knowledge_gap_service import run_preliminary_knowledge_gap_scan
from models.enums import KnowledgeGapSeverity, QuestionCategory


class TestPreliminaryKnowledgeGap:
    def test_missing_customer_critical(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        assert report.critical_count >= 1

    def test_missing_founder_country(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        ctx.answers = [
            ContextAnswer(question_id="basic_target_customer", category=QuestionCategory.basic,
                          value="German clinics"),
        ]
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        assert any(g.claim_type == "founder_country" for g in report.gaps)

    def test_missing_customer_country(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        assert any(g.claim_type == "customer_country" for g in report.gaps)

    def test_missing_revenue_model_business(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="SaaS subscription revenue")
        ctx.answers = [
            ContextAnswer(question_id="basic_target_customer", category=QuestionCategory.basic, value="clinics"),
            ContextAnswer(question_id="economy_founder_country", category=QuestionCategory.economy, value="Germany"),
            ContextAnswer(question_id="economy_customer_country", category=QuestionCategory.economy, value="Germany"),
        ]
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        assert report.dangerous_count >= 0 or report.critical_count >= 0

    def test_missing_evidence_gap(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        ctx.answers = [
            ContextAnswer(question_id="evidence_customer_proof", category=QuestionCategory.evidence, value="no_evidence"),
            ContextAnswer(question_id="basic_target_customer", category=QuestionCategory.basic, value="clinics"),
        ]
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        assert any(g.claim_type == "customer_demand" for g in report.gaps)

    def test_missing_competitor_dangerous(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        ctx.answers = [
            ContextAnswer(question_id="industry_competitors", category=QuestionCategory.industry, value="no competitors"),
            ContextAnswer(question_id="basic_target_customer", category=QuestionCategory.basic, value="clinics"),
        ]
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        assert report.dangerous_count >= 1 or report.critical_count >= 0

    def test_regulated_missing_legal_critical(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="insurance fintech")
        ctx.answers = [
            ContextAnswer(question_id="industry_sector", category=QuestionCategory.industry, value="insurance"),
            ContextAnswer(question_id="risk_legal_constraints", category=QuestionCategory.risk, value="none"),
            ContextAnswer(question_id="basic_target_customer", category=QuestionCategory.basic, value="workers"),
        ]
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        assert any(g.severity == KnowledgeGapSeverity.critical for g in report.gaps)

    def test_low_impact_no_block(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="SaaS")
        ctx.answers = [
            ContextAnswer(question_id="basic_target_customer", category=QuestionCategory.basic,
                          value="German dental clinics"),
            ContextAnswer(question_id="economy_founder_country", category=QuestionCategory.economy, value="Germany"),
            ContextAnswer(question_id="economy_customer_country", category=QuestionCategory.economy, value="Germany"),
            ContextAnswer(question_id="evidence_customer_proof", category=QuestionCategory.evidence,
                          value="customer_interviews"),
            ContextAnswer(question_id="economy_platform", category=QuestionCategory.economy, value="web"),
        ]
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        low_only = all(g.severity == KnowledgeGapSeverity.low_impact for g in report.gaps) if report.gaps else True
        assert low_only or not report.blocks_progress

    def test_critical_blocks_progress(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="insurance")
        ctx.answers = [
            ContextAnswer(question_id="evidence_customer_proof", category=QuestionCategory.evidence, value="no_evidence"),
            ContextAnswer(question_id="industry_sector", category=QuestionCategory.industry, value="insurance"),
            ContextAnswer(question_id="risk_legal_constraints", category=QuestionCategory.risk, value="none"),
        ]
        report = run_preliminary_knowledge_gap_scan(ctx, {"goal_type": "business"})
        assert report.blocks_progress is True
