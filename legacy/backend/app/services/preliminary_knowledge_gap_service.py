"""
Preliminary Knowledge Gap Service — Prompt A4
Intake scan (not full Engine 11).
"""

from __future__ import annotations

from typing import Any

from app.core.config import get_settings
from app.models.context import KnowledgeGap, PreliminaryKnowledgeGapReport, ValidationContext
from app.services.question_branching_service import evaluate_branch_conditions
from models.enums import EvidenceClaimType, KnowledgeGapSeverity


def _am(context: ValidationContext) -> dict[str, Any]:
    return {a.question_id: a.normalized_value or a.value for a in context.answers}


def run_preliminary_knowledge_gap_scan(
    context: ValidationContext,
    validation: dict,
) -> PreliminaryKnowledgeGapReport:
    if not get_settings().preliminary_knowledge_gap_enabled:
        return PreliminaryKnowledgeGapReport(summary="Disabled")

    gaps: list[KnowledgeGap] = []
    gaps.extend(identify_missing_customer_gap(context))
    gaps.extend(identify_missing_payment_gap(context, validation))
    gaps.extend(identify_missing_legal_gap(context, validation))
    gaps.extend(identify_missing_distribution_gap(context))
    gaps.extend(identify_missing_competitor_gap(context))
    gaps.extend(identify_missing_evidence_gap(context))
    gaps.extend(identify_missing_team_capability_gap(context, validation))
    gaps.extend(identify_missing_timeline_gap(context))
    gaps.extend(identify_missing_economy_gap(context, validation))

    critical = sum(1 for g in gaps if g.severity == KnowledgeGapSeverity.critical)
    dangerous = sum(1 for g in gaps if g.severity == KnowledgeGapSeverity.dangerous)
    low = sum(1 for g in gaps if g.severity == KnowledgeGapSeverity.low_impact)
    blocks = any(g.blocks_progress for g in gaps)

    return PreliminaryKnowledgeGapReport(
        gaps=gaps,
        critical_count=critical,
        dangerous_count=dangerous,
        low_impact_count=low,
        blocks_progress=blocks,
        summary=f"{critical} critical, {dangerous} dangerous, {low} low-impact gap(s)",
    )


def identify_missing_customer_gap(context: ValidationContext) -> list[KnowledgeGap]:
    am = _am(context)
    cust = str(am.get("basic_target_customer", "")).strip()
    if not cust or len(cust) < 5 or "everyone" in cust.lower():
        return [_gap(
            KnowledgeGapSeverity.critical, EvidenceClaimType.customer_demand.value,
            "Target customer is missing or too vague.",
            "Engines cannot validate demand without a specific customer.",
            blocks=True, qid="basic_target_customer",
        )]
    return []


def identify_missing_economy_gap(context: ValidationContext, validation: dict) -> list[KnowledgeGap]:
    am = _am(context)
    gaps = []
    founder = am.get("economy_founder_country") or validation.get("founder_country")
    customer = am.get("economy_customer_country") or validation.get("customer_country")
    if not founder:
        gaps.append(_gap(KnowledgeGapSeverity.critical, "founder_country",
                         "Founder country is missing.", "Economy resolution requires founder location.",
                         blocks=True, qid="economy_founder_country"))
    if not customer:
        gaps.append(_gap(KnowledgeGapSeverity.critical, "customer_country",
                         "Customer country is missing.", "Economy resolution requires customer location.",
                         blocks=True, qid="economy_customer_country"))
    return gaps


def identify_missing_payment_gap(context: ValidationContext, validation: dict) -> list[KnowledgeGap]:
    am = _am(context)
    payment = am.get("economy_payment_method")
    branches = evaluate_branch_conditions(context, validation)
    if branches.get("regulated") and not payment:
        return [_gap(
            KnowledgeGapSeverity.critical, EvidenceClaimType.willingness_to_pay.value,
            "Payment method unknown in regulated context.",
            "Payment rails affect feasibility in regulated markets.",
            blocks=True, qid="economy_payment_method",
        )]
    if payment:
        return []
    return [_gap(
        KnowledgeGapSeverity.dangerous, EvidenceClaimType.willingness_to_pay.value,
        "Payment method not specified.", "Revenue feasibility depends on payment path.",
        blocks=False, qid="economy_payment_method",
    )]


def identify_missing_legal_gap(context: ValidationContext, validation: dict) -> list[KnowledgeGap]:
    branches = evaluate_branch_conditions(context, validation)
    if not branches.get("regulated"):
        return []
    am = _am(context)
    legal = str(am.get("risk_legal_constraints", "")).lower()
    if legal in ("none", "nothing", ""):
        return [_gap(
            KnowledgeGapSeverity.critical, EvidenceClaimType.legal_readiness.value,
            "Legal readiness unknown for regulated industry.",
            "Regulated products can fail entirely without legal path.",
            blocks=True, qid="risk_legal_constraints",
        )]
    return []


def identify_missing_distribution_gap(context: ValidationContext) -> list[KnowledgeGap]:
    am = _am(context)
    if not am.get("economy_platform"):
        return [_gap(
            KnowledgeGapSeverity.dangerous, EvidenceClaimType.distribution_access.value,
            "Distribution channel unclear.", "Go-to-market depends on reachable channels.",
            blocks=False, qid="economy_platform",
        )]
    return []


def identify_missing_competitor_gap(context: ValidationContext) -> list[KnowledgeGap]:
    branches = evaluate_branch_conditions(context, {"goal_type": "business"})
    if branches.get("no_competitors"):
        return [_gap(
            KnowledgeGapSeverity.dangerous, EvidenceClaimType.competitor_awareness.value,
            "Competitor landscape unclear.", "Market reality requires known alternatives.",
            blocks=False, qid="industry_competitors",
        )]
    return []


def identify_missing_evidence_gap(context: ValidationContext) -> list[KnowledgeGap]:
    am = _am(context)
    ev = str(am.get("evidence_customer_proof", "")).lower()
    if ev in ("no_evidence", "none", "none yet", ""):
        return [_gap(
            KnowledgeGapSeverity.critical, EvidenceClaimType.customer_demand.value,
            "No customer evidence provided.", "Strong claims require proof before engines run.",
            blocks=True, qid="evidence_customer_proof",
        )]
    return []


def identify_missing_team_capability_gap(context: ValidationContext, validation: dict) -> list[KnowledgeGap]:
    branches = evaluate_branch_conditions(context, validation)
    if branches.get("team_mode"):
        am = _am(context)
        if not am.get("team_skill_gaps") and not am.get("team_roles"):
            return [_gap(
                KnowledgeGapSeverity.dangerous, EvidenceClaimType.team_capability.value,
                "Team capability gaps not described.", "Execution risk depends on team capacity.",
                blocks=False, qid="team_skill_gaps",
            )]
    return []


def identify_missing_timeline_gap(context: ValidationContext) -> list[KnowledgeGap]:
    branches = evaluate_branch_conditions(context, {"goal_type": "business"})
    if branches.get("aggressive_timeline"):
        return [_gap(
            KnowledgeGapSeverity.dangerous, EvidenceClaimType.timeline_reality.value,
            "Timeline may be unrealistic.", "Schedule risk can invalidate launch plans.",
            blocks=False, qid="basic_timeline",
        )]
    return []


def _gap(
    severity: KnowledgeGapSeverity,
    claim_type: str,
    description: str,
    why: str,
    *,
    blocks: bool,
    qid: str,
) -> KnowledgeGap:
    return KnowledgeGap(
        severity=severity,
        claim_type=claim_type,
        description=description,
        why_it_matters=why,
        recommended_research=f"Research: {description}",
        recommended_test=f"Run a small test related to: {description}",
        blocks_progress=blocks,
        source_question_id=qid,
    )
