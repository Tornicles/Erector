"""Preliminary anti-gaming tests — Prompt A4."""

from app.models.context import ContextAnswer, ValidationContext
from app.services.preliminary_anti_gaming_service import run_preliminary_anti_gaming_scan
from models.enums import AntiGamingFlagType, QuestionCategory


def _gaming_ctx() -> ValidationContext:
    ctx = ValidationContext(
        validation_id="val_ag",
        owner_user_id="u",
        raw_goal="Launch insurance for gig workers in Nigeria in 14 days and get 1 million users fast",
    )
    ctx.answers = [
        ContextAnswer(question_id="basic_target_customer", category=QuestionCategory.basic,
                      value="everyone who works gigs"),
        ContextAnswer(question_id="evidence_customer_proof", category=QuestionCategory.evidence, value="no_evidence"),
        ContextAnswer(question_id="risk_legal_constraints", category=QuestionCategory.risk, value="none"),
        ContextAnswer(question_id="industry_competitors", category=QuestionCategory.industry, value="no competitors"),
        ContextAnswer(question_id="basic_resources", category=QuestionCategory.basic, value="$100"),
        ContextAnswer(question_id="basic_timeline", category=QuestionCategory.basic, value="14 days"),
        ContextAnswer(question_id="industry_sector", category=QuestionCategory.industry, value="insurance"),
    ]
    return ctx


class TestPreliminaryAntiGaming:
    def test_inflated_timeline(self):
        report = run_preliminary_anti_gaming_scan(_gaming_ctx(), {"goal_type": "business"})
        types = [f.flag_type for f in report.flags]
        assert AntiGamingFlagType.inflated_timeline in types

    def test_no_customer_evidence(self):
        report = run_preliminary_anti_gaming_scan(_gaming_ctx(), {"goal_type": "business"})
        types = [f.flag_type for f in report.flags]
        assert AntiGamingFlagType.no_customer_evidence in types

    def test_missing_legal_insurance(self):
        report = run_preliminary_anti_gaming_scan(_gaming_ctx(), {"goal_type": "business"})
        types = [f.flag_type for f in report.flags]
        assert AntiGamingFlagType.missing_legal_constraints in types

    def test_unrealistic_budget(self):
        report = run_preliminary_anti_gaming_scan(_gaming_ctx(), {"goal_type": "business"})
        types = [f.flag_type for f in report.flags]
        assert AntiGamingFlagType.unrealistic_budget in types

    def test_universal_demand(self):
        report = run_preliminary_anti_gaming_scan(_gaming_ctx(), {"goal_type": "business"})
        types = [f.flag_type for f in report.flags]
        assert AntiGamingFlagType.vague_customer_definition in types

    def test_no_competitors(self):
        report = run_preliminary_anti_gaming_scan(_gaming_ctx(), {"goal_type": "business"})
        types = [f.flag_type for f in report.flags]
        assert AntiGamingFlagType.no_competitors_claim in types

    def test_blocking_flags(self):
        report = run_preliminary_anti_gaming_scan(_gaming_ctx(), {"goal_type": "business"})
        assert report.blocks_progress is True

    def test_clean_input_high_integrity(self):
        ctx = ValidationContext(
            validation_id="v", owner_user_id="u",
            raw_goal="Appointment scheduling SaaS for independent dental clinics in Munich",
        )
        ctx.answers = [
            ContextAnswer(question_id="basic_target_customer", category=QuestionCategory.basic,
                            value="Independent dental clinics in Munich with 3-10 staff"),
            ContextAnswer(question_id="evidence_customer_proof", category=QuestionCategory.evidence,
                            value="customer_interviews"),
            ContextAnswer(question_id="risk_legal_constraints", category=QuestionCategory.risk,
                            value="GDPR compliance and medical data handling reviewed with counsel"),
            ContextAnswer(question_id="industry_competitors", category=QuestionCategory.industry,
                            value="Local practice management vendors and Doctolib"),
            ContextAnswer(question_id="basic_timeline", category=QuestionCategory.basic, value="9 months"),
            ContextAnswer(question_id="basic_resources", category=QuestionCategory.basic, value="$25000"),
            ContextAnswer(question_id="industry_sector", category=QuestionCategory.industry, value="healthcare"),
        ]
        report = run_preliminary_anti_gaming_scan(ctx, {"goal_type": "business"})
        assert report.integrity_score >= 6
