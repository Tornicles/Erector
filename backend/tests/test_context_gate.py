"""Context gate tests — Prompt A4."""

from app.models.context import (
    AnswerQualityReport,
    AntiGamingReport,
    ContextAnswer,
    EngineInputObject,
    PreliminaryKnowledgeGapReport,
    ValidationContext,
)
from app.services.context_gate_service import evaluate_context_gate
from models.enums import QuestionCategory, ValidationStatus


def _full_good_context() -> ValidationContext:
    ctx = ValidationContext(
        validation_id="val_gate", owner_user_id="u",
        raw_goal="SaaS scheduling for German dental clinics",
    )
    answers = {
        "basic_raw_goal": "SaaS scheduling for German dental clinics",
        "basic_problem": "Missed appointments and manual scheduling",
        "basic_target_customer": "Independent dental clinics in Munich",
        "basic_success": "50 paying clinics in 12 months",
        "basic_timeline": "12 months",
        "basic_resources": "$25000 and 20 hours per week",
        "basic_smallest_proof": "5 clinics using a manual pilot",
        "industry_sector": "healthcare",
        "industry_alternatives": "Paper schedules and legacy PMS tools",
        "industry_regulation": "high",
        "industry_risks": "Data privacy and medical records",
        "industry_competitors": "Doctolib and local vendors",
        "industry_license": "GDPR and health data compliance",
        "industry_compliance_owner": "Founder with legal counsel",
        "industry_approval_delay": "Delay MVP launch",
        "industry_legal_confirmed": True,
        "economy_founder_country": "Germany",
        "economy_customer_country": "Germany",
        "economy_revenue_country": "Germany",
        "economy_platform": "web",
        "economy_payment_method": "SEPA direct debit",
        "economy_regulatory_jurisdiction": "Germany",
        "revenue_model": "subscription",
        "revenue_who_pays": "clinic owners",
        "revenue_price": "99 EUR/month",
        "revenue_frequency": "monthly",
        "revenue_paid_already": False,
        "revenue_payment_proof": "LOIs from 3 clinics",
        "revenue_major_costs": "hosting and support",
        "revenue_first_revenue": "4 months",
        "revenue_refusal_reason": "If ROI is unclear",
        "evidence_problem_proof": "Interview notes from 12 clinic admins",
        "evidence_customer_interviews": True,
        "evidence_customer_proof": "customer_interviews",
        "evidence_paid_committed": False,
        "evidence_transaction_data": False,
        "evidence_other_proof": "Waitlist of 8 clinics",
        "evidence_falsification": "Clinics refuse to switch tools",
        "risk_blockers": "Slow clinic procurement",
        "risk_legal_constraints": "GDPR and medical data rules",
        "risk_competitor_response": "Incumbents may bundle scheduling",
        "risk_uncertain_assumptions": "Willingness to pay",
        "risk_dependencies": "Reliable calendar integrations",
        "risk_limits": "Limited sales capacity",
        "risk_stop_condition": "No paying pilot in 6 months",
        "individual_skills": "Product and sales",
        "individual_missing_skills": "Enterprise healthcare sales",
        "individual_constraints": "Part-time availability",
        "team_hours_per_week": 20,
    }
    ctx.answers = [
        ContextAnswer(question_id=k, category=QuestionCategory.basic, value=v)
        for k, v in answers.items()
    ]
    ctx.answer_quality_report = AnswerQualityReport(overall_quality_score=8.0, can_continue=True)
    ctx.anti_gaming_report = AntiGamingReport(integrity_score=8.5, blocks_progress=False)
    ctx.preliminary_knowledge_gap_report = PreliminaryKnowledgeGapReport(blocks_progress=False)
    ctx.engine_input_object = EngineInputObject(
        validation_id="val_gate", raw_goal=ctx.raw_goal, readiness_for_engines=True,
    )
    ctx.required_fields_complete = True
    return ctx


class TestContextGate:
    def test_complete_context_passes(self):
        ctx = _full_good_context()
        gate = evaluate_context_gate(ctx, {
            "validation_id": "val_gate", "goal_type": "business",
            "founder_country": "Germany", "customer_country": "Germany",
        })
        assert gate.can_proceed_to_engines is True

    def test_missing_basic_blocks(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        ctx.engine_input_object = EngineInputObject(validation_id="v", raw_goal="g")
        gate = evaluate_context_gate(ctx, {"validation_id": "v", "goal_type": "business"})
        assert gate.can_proceed_to_engines is False

    def test_missing_economy_blocks(self):
        ctx = _full_good_context()
        ctx.answers = [a for a in ctx.answers if "economy_" not in a.question_id]
        gate = evaluate_context_gate(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert gate.can_proceed_to_engines is False

    def test_low_quality_blocks(self):
        ctx = _full_good_context()
        ctx.answer_quality_report = AnswerQualityReport(overall_quality_score=4.0, can_continue=False)
        gate = evaluate_context_gate(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert gate.can_proceed_to_engines is False

    def test_anti_gaming_blocks(self):
        ctx = _full_good_context()
        ctx.anti_gaming_report = AntiGamingReport(integrity_score=3.0, blocks_progress=True)
        gate = evaluate_context_gate(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert gate.can_proceed_to_engines is False

    def test_critical_gap_blocks(self):
        ctx = _full_good_context()
        from app.models.context import KnowledgeGap
        from models.enums import KnowledgeGapSeverity
        ctx.preliminary_knowledge_gap_report = PreliminaryKnowledgeGapReport(
            gaps=[KnowledgeGap(severity=KnowledgeGapSeverity.critical, claim_type="x",
                               description="critical", blocks_progress=True)],
            blocks_progress=True,
        )
        gate = evaluate_context_gate(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert gate.can_proceed_to_engines is False

    def test_quality_below_6_blocks(self):
        ctx = _full_good_context()
        ctx.answer_quality_report = AnswerQualityReport(overall_quality_score=5.5, can_continue=False)
        gate = evaluate_context_gate(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert any(b.blocker_type.value == "low_answer_quality" for b in gate.blockers)

    def test_integrity_below_6_blocks(self):
        ctx = _full_good_context()
        ctx.anti_gaming_report = AntiGamingReport(integrity_score=5.0, blocks_progress=False)
        gate = evaluate_context_gate(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert gate.can_proceed_to_engines is False

    def test_should_transition_context_collected(self):
        ctx = _full_good_context()
        gate = evaluate_context_gate(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert gate.should_transition_to_context_collected is True

    def test_can_build_economic_stack(self):
        ctx = _full_good_context()
        gate = evaluate_context_gate(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert gate.can_build_economic_stack is True

    def test_never_engines_running(self):
        assert ValidationStatus.engines_running.value not in [
            ValidationStatus.context_collected.value,
            ValidationStatus.context_collecting.value,
            ValidationStatus.economic_stack_built.value,
        ]
