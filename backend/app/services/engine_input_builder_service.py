"""
Engine Input Builder Service — Prompt A4
Produces stable EngineInputObject for future engines.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.models.context import EngineInputObject, ValidationContext


def build_engine_input_object(
    context: ValidationContext,
    validation: dict,
    economic_stack_preview: Optional[dict] = None,
    *,
    readiness_for_engines: bool = False,
) -> EngineInputObject:
    am = {a.question_id: a.normalized_value or a.value for a in context.answers}
    sg = context.structured_goal.model_dump() if context.structured_goal else {}

    quality = context.answer_quality_report.overall_quality_score if context.answer_quality_report else 0.0
    integrity = context.anti_gaming_report.integrity_score if context.anti_gaming_report else 0.0

    user_context = {
        "user_type": validation.get("user_type"),
        "team_id": validation.get("team_id"),
        "capacity": am.get("team_hours_per_week") or am.get("individual_constraints"),
        "skills": am.get("individual_skills"),
        "missing_skills": am.get("individual_missing_skills"),
    }

    business_context = {
        "raw_goal": context.raw_goal or validation.get("raw_goal"),
        "structured_goal": sg,
        "industry": am.get("industry_sector") or validation.get("industry"),
        "goal_type": validation.get("goal_type"),
        "business_model": am.get("revenue_model"),
        "revenue_model": am.get("revenue_model"),
        "target_customer": am.get("basic_target_customer"),
        "pricing": am.get("revenue_price"),
        "timeline": am.get("basic_timeline"),
        "budget": am.get("basic_resources") or am.get("risk_limits"),
        "success_definition": am.get("basic_success") or validation.get("success_definition"),
    }

    economy_context = {
        "founder_country": am.get("economy_founder_country") or validation.get("founder_country"),
        "customer_country": am.get("economy_customer_country") or validation.get("customer_country"),
        "revenue_country": am.get("economy_revenue_country"),
        "platform": am.get("economy_platform"),
        "payment_method": am.get("economy_payment_method"),
        "regulatory_country": am.get("economy_regulatory_jurisdiction"),
        "economic_stack_preview": economic_stack_preview,
    }

    team_context = {
        "mode": "team" if validation.get("team_id") else "individual",
        "team_size": am.get("team_size"),
        "roles": am.get("team_roles"),
        "gaps": am.get("team_skill_gaps") or am.get("individual_missing_skills"),
        "capacity": am.get("team_hours_per_week"),
    }

    revenue_context = {
        "payer": am.get("revenue_who_pays"),
        "price": am.get("revenue_price"),
        "frequency": am.get("revenue_frequency"),
        "payment_proof": am.get("revenue_payment_proof"),
        "revenue_proof": am.get("evidence_paid_committed"),
        "cost_structure": am.get("revenue_major_costs"),
    }

    evidence_context = {
        "evidence_types": am.get("evidence_customer_proof"),
        "claims_supported": [],
        "claims_unsupported": [],
        "evidence_strength": am.get("evidence_customer_proof"),
        "interviews": am.get("evidence_customer_interviews"),
        "falsification": am.get("evidence_falsification"),
    }

    risk_context = {
        "known_blockers": am.get("risk_blockers"),
        "legal_issues": am.get("risk_legal_constraints"),
        "competitors": am.get("industry_competitors") or am.get("risk_competitor_response"),
        "dependencies": am.get("risk_dependencies"),
        "uncertain_assumptions": am.get("risk_uncertain_assumptions"),
        "limits": am.get("risk_limits"),
    }

    assumptions_seed = [
        {"text": a, "source": "structured_goal"}
        for a in sg.get("hidden_assumptions", [])
    ]
    dependencies_seed = []
    if economy_context.get("platform"):
        dependencies_seed.append({"type": "platform", "value": economy_context["platform"]})
    if economy_context.get("payment_method"):
        dependencies_seed.append({"type": "payment", "value": economy_context["payment_method"]})
    if economy_context.get("regulatory_country"):
        dependencies_seed.append({"type": "legal", "value": economy_context["regulatory_country"]})

    missing_context = []
    if context.preliminary_knowledge_gap_report:
        missing_context = [
            g.description for g in context.preliminary_knowledge_gap_report.gaps
            if not g.blocks_progress
        ]

    return EngineInputObject(
        validation_id=validation["validation_id"],
        raw_goal=context.raw_goal or validation.get("raw_goal", ""),
        structured_goal=sg,
        user_context=user_context,
        business_context=business_context,
        economy_context=economy_context,
        team_context=team_context,
        revenue_context=revenue_context,
        evidence_context=evidence_context,
        risk_context=risk_context,
        assumptions_seed=assumptions_seed,
        dependencies_seed=dependencies_seed,
        missing_context=missing_context,
        input_quality_score=quality,
        integrity_score=integrity,
        readiness_for_engines=readiness_for_engines,
        generated_at=datetime.now(timezone.utc),
    )
