"""
Context Gate Service — Prompt A4
Determines whether context is sufficient to proceed.
"""

from __future__ import annotations

from app.core.config import get_settings
from app.models.context import ContextBlocker, ContextGateResult, ValidationContext
from app.services.question_branching_service import get_required_questions
from models.enums import ContextBlockerType, ContextStatus


def evaluate_context_gate(
    context: ValidationContext,
    validation: dict,
) -> ContextGateResult:
    settings = get_settings()
    blockers: list[ContextBlocker] = []
    warnings: list[str] = list(context.context_warnings)
    required_actions: list[str] = []

    quality_score = context.answer_quality_report.overall_quality_score if context.answer_quality_report else 0.0
    integrity_score = context.anti_gaming_report.integrity_score if context.anti_gaming_report else 0.0

    answered_ids = {a.question_id for a in context.answers}
    required_qs = [q for q in get_required_questions(context, validation) if q.required]
    missing = [q.question_id for q in required_qs if q.question_id not in answered_ids]

    if missing:
        blockers.append(ContextBlocker(
            blocker_type=ContextBlockerType.missing_required_answer,
            message=f"Missing required answers: {', '.join(missing[:5])}",
            field=missing[0] if missing else None,
            question_id=missing[0] if missing else None,
            resolution_action="Answer all required context questions.",
            blocks_engine_start=True,
        ))

    am = {a.question_id: a.normalized_value or a.value for a in context.answers}
    founder = am.get("economy_founder_country") or validation.get("founder_country")
    customer = am.get("economy_customer_country") or validation.get("customer_country")
    if not founder or not customer:
        blockers.append(ContextBlocker(
            blocker_type=ContextBlockerType.missing_economy_input,
            message="Founder and customer countries are required.",
            resolution_action="Provide founder and customer country answers.",
            blocks_engine_start=True,
        ))

    if quality_score < settings.context_min_quality_score:
        blockers.append(ContextBlocker(
            blocker_type=ContextBlockerType.low_answer_quality,
            message=f"Answer quality score {quality_score} is below minimum {settings.context_min_quality_score}.",
            resolution_action="Clarify vague or unsupported answers.",
            blocks_engine_start=True,
        ))

    if integrity_score < settings.context_min_integrity_score:
        blockers.append(ContextBlocker(
            blocker_type=ContextBlockerType.anti_gaming_flag,
            message=f"Integrity score {integrity_score} is below minimum {settings.context_min_integrity_score}.",
            resolution_action="Address anti-gaming flags and provide evidence.",
            blocks_engine_start=True,
        ))

    if context.anti_gaming_report and context.anti_gaming_report.blocks_progress:
        for flag in context.anti_gaming_report.flags:
            if flag.blocks_progress:
                blockers.append(ContextBlocker(
                    blocker_type=ContextBlockerType.anti_gaming_flag,
                    message=flag.description,
                    field=flag.affected_fields[0] if flag.affected_fields else None,
                    resolution_action=flag.required_clarification or "Clarify flagged answers.",
                    blocks_engine_start=True,
                ))

    if context.preliminary_knowledge_gap_report:
        for gap in context.preliminary_knowledge_gap_report.gaps:
            if gap.blocks_progress:
                blockers.append(ContextBlocker(
                    blocker_type=ContextBlockerType.critical_knowledge_gap,
                    message=gap.description,
                    question_id=gap.source_question_id,
                    resolution_action=gap.recommended_test or gap.recommended_research or "Fill knowledge gap.",
                    blocks_engine_start=True,
                ))
            elif gap.severity.value == "dangerous":
                warnings.append(gap.description)

    if context.answer_quality_report and context.answer_quality_report.contradictory_answers:
        blockers.append(ContextBlocker(
            blocker_type=ContextBlockerType.contradictory_context,
            message="Contradictory answers detected in core business logic.",
            resolution_action="Resolve contradictions between evidence and claims.",
            blocks_engine_start=True,
        ))

    # Deduplicate blockers by message
    seen = set()
    unique_blockers = []
    for b in blockers:
        if b.message not in seen:
            seen.add(b.message)
            unique_blockers.append(b)

    can_proceed = (
        not unique_blockers
        and quality_score >= settings.context_min_quality_score
        and integrity_score >= settings.context_min_integrity_score
        and not missing
        and bool(founder)
        and bool(customer)
        and context.engine_input_object is not None
    )

    can_build_stack = bool(founder) and bool(customer) and not any(
        b.blocker_type == ContextBlockerType.missing_economy_input for b in unique_blockers
    )

    gap_summary = ""
    if context.preliminary_knowledge_gap_report:
        gap_summary = context.preliminary_knowledge_gap_report.summary

    return ContextGateResult(
        can_proceed_to_engines=can_proceed,
        can_build_economic_stack=can_build_stack,
        should_transition_to_context_collected=can_proceed,
        should_transition_to_economic_stack_built=can_proceed and can_build_stack,
        blockers=unique_blockers,
        warnings=warnings,
        required_actions=required_actions,
        quality_score=quality_score,
        integrity_score=integrity_score,
        knowledge_gap_summary=gap_summary,
    )
