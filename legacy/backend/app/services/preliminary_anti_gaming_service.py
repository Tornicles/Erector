"""
Preliminary Anti-Gaming Service — Prompt A4
Early intake filter (not full Engine 24).
"""

from __future__ import annotations

import re
from typing import Any

from app.core.config import get_settings
from app.models.context import AntiGamingFlag, AntiGamingReport, ValidationContext
from app.services.question_branching_service import evaluate_branch_conditions
from models.enums import AntiGamingFlagType


def _am(context: ValidationContext) -> dict[str, Any]:
    return {a.question_id: a.value for a in context.answers}


def run_preliminary_anti_gaming_scan(
    context: ValidationContext,
    validation: dict,
) -> AntiGamingReport:
    if not get_settings().preliminary_anti_gaming_enabled:
        return AntiGamingReport(integrity_score=8.0, blocks_progress=False, summary="Disabled")

    flags: list[AntiGamingFlag] = []
    branches = evaluate_branch_conditions(context, validation)

    flags.extend(detect_unrealistic_timeline(context, branches))
    flags.extend(detect_inflated_budget_claims(context, branches))
    flags.extend(detect_missing_legal_constraints(context, branches))
    flags.extend(detect_no_customer_evidence(context, branches))
    flags.extend(detect_no_competitors_claim(context, branches))
    flags.extend(detect_vague_customer_definition(context, branches))
    flags.extend(detect_impossible_execution_scope(context, branches))
    flags.extend(detect_suspiciously_perfect_answers(context))

    blocks = any(f.blocks_progress for f in flags)
    score = round(max(0.0, 10.0 - len(flags) * 1.2 - (2.0 if blocks else 0)), 1)
    clarifications = [f.required_clarification for f in flags if f.required_clarification]

    return AntiGamingReport(
        integrity_score=score,
        flags=flags,
        blocks_progress=blocks,
        required_clarifications=[c for c in clarifications if c],
        summary=f"{len(flags)} anti-gaming flag(s) detected",
    )


def detect_unrealistic_timeline(context: ValidationContext, branches: dict) -> list[AntiGamingFlag]:
    if not branches.get("aggressive_timeline"):
        return []
    regulated = branches.get("regulated", False)
    blocks = regulated or "insurance" in (context.raw_goal or "").lower()
    return [AntiGamingFlag(
        flag_type=AntiGamingFlagType.inflated_timeline,
        severity="high",
        description="The timeline appears unrealistic for the stated scope.",
        triggered_by="basic_timeline",
        affected_fields=["basic_timeline"],
        required_clarification="Explain dependencies already resolved or adjust the launch timeline.",
        blocks_progress=blocks,
    )]


def detect_inflated_budget_claims(context: ValidationContext, branches: dict) -> list[AntiGamingFlag]:
    if not branches.get("low_budget"):
        return []
    regulated = branches.get("regulated", False)
    return [AntiGamingFlag(
        flag_type=AntiGamingFlagType.unrealistic_budget,
        severity="high",
        description="Budget appears insufficient for the stated scope.",
        triggered_by="basic_resources",
        affected_fields=["basic_resources", "risk_limits"],
        required_clarification="Identify unavoidable costs or reduce scope.",
        blocks_progress=regulated,
    )]


def detect_missing_legal_constraints(context: ValidationContext, branches: dict) -> list[AntiGamingFlag]:
    if not branches.get("regulated"):
        return []
    am = _am(context)
    legal = str(am.get("risk_legal_constraints", "")).lower()
    if legal not in ("none", "no", "nothing", "n/a", ""):
        return []
    return [AntiGamingFlag(
        flag_type=AntiGamingFlagType.missing_legal_constraints,
        severity="critical",
        description="Regulated industry context without legal/compliance answers.",
        triggered_by="risk_legal_constraints",
        affected_fields=["risk_legal_constraints", "industry_license"],
        required_clarification="Explain the legal approval path or licensing requirements.",
        blocks_progress=True,
    )]


def detect_no_customer_evidence(context: ValidationContext, branches: dict) -> list[AntiGamingFlag]:
    if not branches.get("no_evidence"):
        return []
    blob = (context.raw_goal or "").lower()
    strong_claim = any(w in blob for w in ("million", "everyone", "1 million", "fast"))
    if not strong_claim:
        return []
    return [AntiGamingFlag(
        flag_type=AntiGamingFlagType.no_customer_evidence,
        severity="high",
        description="Strong demand claim without customer evidence.",
        triggered_by="evidence_customer_proof",
        affected_fields=["evidence_customer_proof"],
        required_clarification="Provide customer interviews, tests, or observed demand proof.",
        blocks_progress=True,
    )]


def detect_no_competitors_claim(context: ValidationContext, branches: dict) -> list[AntiGamingFlag]:
    if not branches.get("no_competitors"):
        return []
    return [AntiGamingFlag(
        flag_type=AntiGamingFlagType.no_competitors_claim,
        severity="medium",
        description="No-competitors claim is unrealistic for most markets.",
        triggered_by="industry_competitors",
        affected_fields=["industry_competitors"],
        required_clarification="Name existing alternatives customers use today.",
        blocks_progress=True,
    )]


def detect_vague_customer_definition(context: ValidationContext, branches: dict) -> list[AntiGamingFlag]:
    if not branches.get("everyone_customer"):
        return []
    return [AntiGamingFlag(
        flag_type=AntiGamingFlagType.vague_customer_definition,
        severity="high",
        description="Customer definition is too vague or universal.",
        triggered_by="basic_target_customer",
        affected_fields=["basic_target_customer"],
        required_clarification="Name one specific segment with the strongest pain.",
        blocks_progress=True,
    )]


def detect_impossible_execution_scope(context: ValidationContext, branches: dict) -> list[AntiGamingFlag]:
    blob = (context.raw_goal or "").lower()
    if "globally" in blob and branches.get("aggressive_timeline"):
        return [AntiGamingFlag(
            flag_type=AntiGamingFlagType.impossible_execution_scope,
            severity="high",
            description="Global launch with aggressive timeline exceeds realistic execution scope.",
            triggered_by="raw_goal",
            affected_fields=["basic_timeline", "basic_target_customer"],
            required_clarification="Narrow geography and define MVP scope.",
            blocks_progress=True,
        )]
    return []


def detect_suspiciously_perfect_answers(context: ValidationContext) -> list[AntiGamingFlag]:
    perfect_phrases = ["no risk", "no competitors", "everyone needs", "guaranteed", "no legal"]
    hits = []
    for a in context.answers:
        val = str(a.value).lower()
        if any(p in val for p in perfect_phrases):
            hits.append(a.question_id)
    if len(hits) >= 3:
        return [AntiGamingFlag(
            flag_type=AntiGamingFlagType.suspiciously_perfect_answers,
            severity="medium",
            description="Multiple answers appear unrealistically perfect.",
            triggered_by="multiple",
            affected_fields=hits,
            required_clarification="Add specificity, constraints, and evidence to answers.",
            blocks_progress=False,
        )]
    return []
