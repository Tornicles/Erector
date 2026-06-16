"""
Question Engine Service — Prompt A4
Orchestrates context collection, dynamic questions, and submission flow.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.core.errors import InvalidAnswerError, QuestionNotFoundError
from app.db.collections import VALIDATION_SESSIONS
from app.models.auth import CurrentUser
from app.models.context import (
    ContextAnswer,
    ContextAnswerInput,
    ContextSubmissionRequest,
    ContextSubmissionResponse,
    ValidationContext,
)
from app.models.economy import EconomicStackBuildRequest
from app.models.questions import GetQuestionsResponse, QuestionBatch, QuestionProgress
from app.services.answer_quality_service import evaluate_answer_quality, evaluate_context_quality
from app.services.audit_service import write_audit_log
from app.services.context_gate_service import evaluate_context_gate
from app.services.context_service import (
    doc_to_context,
    get_context_by_validation,
    load_validation,
    sanitize_text,
    save_context,
)
from app.services.economic_stack_service import build_economic_stack
from app.services.engine_input_builder_service import build_engine_input_object
from app.services.event_service import emit_event
from app.services.goal_interpretation_service import interpret_goal_deterministically
from app.services.preliminary_anti_gaming_service import run_preliminary_anti_gaming_scan
from app.services.preliminary_knowledge_gap_service import run_preliminary_knowledge_gap_scan
from app.services.question_branching_service import get_required_questions, prioritize_questions
from app.services.question_catalog import QUESTION_BY_ID
from app.services.validation_state_machine import assert_transition_allowed, transition_validation
from models.enums import ContextStatus, QuestionCategory, ValidationEventType, ValidationStatus

logger = logging.getLogger(__name__)


async def get_or_create_context(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    current_user: CurrentUser,
) -> ValidationContext:
    validation = await load_validation(db, validation_id, current_user)
    existing = await get_context_by_validation(db, validation_id)
    if existing:
        return doc_to_context(existing)
    return await initialize_context_from_validation(db, validation, current_user)


async def initialize_context_from_validation(
    db: AsyncIOMotorDatabase,
    validation: dict,
    current_user: CurrentUser,
) -> ValidationContext:
    raw_goal = validation.get("raw_goal") or ""
    structured = interpret_goal_deterministically(raw_goal) if raw_goal else None
    settings = get_settings()
    required_cats = settings.context_required_categories_list

    context = ValidationContext(
        validation_id=validation["validation_id"],
        owner_user_id=current_user.user_id,
        team_id=validation.get("team_id"),
        status=ContextStatus.in_progress,
        raw_goal=raw_goal,
        structured_goal=structured,
        metadata={"industry": validation.get("industry")},
    )
    context.question_state.required_categories_remaining = [
        c for c in required_cats if c not in context.question_state.completed_categories
    ]
    await save_context(db, context)

    await emit_event(
        db,
        ValidationEventType.context_started,
        "validation_context",
        context.context_id,
        {"validation_id": validation["validation_id"]},
        owner_user_id=current_user.user_id,
        validation_id=validation["validation_id"],
    )
    return context


async def _maybe_transition_to_collecting(
    db: AsyncIOMotorDatabase,
    validation: dict,
    current_user: CurrentUser,
) -> dict:
    status = validation.get("status")
    if status == ValidationStatus.draft.value:
        try:
            assert_transition_allowed(status, ValidationStatus.context_collecting)
            updated, _, _ = await transition_validation(
                db,
                validation["validation_id"],
                ValidationStatus.context_collecting,
                "Context collection started",
                current_user,
            )
            return updated
        except Exception as exc:
            logger.warning("Could not transition to context_collecting: %s", exc)
    return validation


def calculate_question_progress(
    context: ValidationContext,
    validation: dict,
) -> QuestionProgress:
    required_qs = [q for q in get_required_questions(context, validation) if q.required]
    answered_ids = {a.question_id for a in context.answers}
    answered_required = sum(1 for q in required_qs if q.question_id in answered_ids)
    total_required = len(required_qs)
    pct = (answered_required / total_required * 100) if total_required else 0.0

    settings = get_settings()
    all_cats = settings.context_required_categories_list
    completed = []
    remaining = []
    for cat in all_cats:
        cat_qs = [q for q in required_qs if q.category.value == cat]
        if cat_qs and all(q.question_id in answered_ids for q in cat_qs):
            completed.append(cat)
        elif cat_qs:
            remaining.append(cat)

    return QuestionProgress(
        total_required_questions=total_required,
        answered_required_questions=answered_required,
        total_answered=len(context.answers),
        categories_completed=completed,
        categories_remaining=remaining,
        percent_complete=round(pct, 1),
    )


def determine_context_status(context: ValidationContext, gate_passed: bool = False) -> ContextStatus:
    if gate_passed:
        return ContextStatus.context_collected
    if context.anti_gaming_report and context.anti_gaming_report.blocks_progress:
        return ContextStatus.blocked_by_anti_gaming
    if context.answer_quality_report and not context.answer_quality_report.can_continue:
        return ContextStatus.blocked_by_quality
    if context.missing_fields:
        return ContextStatus.missing_required_fields
    if context.answers:
        return ContextStatus.in_progress
    return ContextStatus.not_started


async def get_next_question_batch(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    current_user: CurrentUser,
) -> GetQuestionsResponse:
    validation = await load_validation(db, validation_id, current_user)
    validation = await _maybe_transition_to_collecting(db, validation, current_user)
    context = await get_or_create_context(db, validation_id, current_user)

    answered_ids = {a.question_id for a in context.answers}
    asked_ids = set(context.question_state.asked_question_ids)
    all_required = get_required_questions(context, validation)
    pending = [q for q in all_required if q.question_id not in answered_ids]
    pending = prioritize_questions(pending)

    settings = get_settings()
    batch_size = settings.context_max_batch_size
    batch_qs = pending[:batch_size]

    for q in batch_qs:
        if q.question_id not in asked_ids:
            context.question_state.asked_question_ids.append(q.question_id)
    context.question_state.current_batch_number += 1
    context.question_state.last_question_generated_at = datetime.now(timezone.utc)
    await save_context(db, context)

    progress = calculate_question_progress(context, validation)
    required_in_batch = sum(1 for q in batch_qs if q.required)
    answered_required = progress.answered_required_questions

    batch = QuestionBatch(
        validation_id=validation_id,
        context_id=context.context_id,
        questions=batch_qs,
        required_count=progress.total_required_questions,
        answered_required_count=answered_required,
        next_batch_reason="Basic context is required before validation engines can run.",
        can_submit_context=answered_required >= progress.total_required_questions and progress.total_required_questions > 0,
    )

    await emit_event(
        db,
        ValidationEventType.context_questions_generated,
        "validation_context",
        context.context_id,
        {"count": len(batch_qs), "validation_id": validation_id},
        owner_user_id=current_user.user_id,
        validation_id=validation_id,
    )

    return GetQuestionsResponse(
        validation_id=validation_id,
        context_id=context.context_id,
        batch=batch,
        progress=progress,
        blockers=[b.model_dump(mode="json") for b in context.context_blockers],
        warnings=context.context_warnings,
    )


async def _normalize_answer(
    db: AsyncIOMotorDatabase,
    question_id: str,
    value: Any,
) -> Any:
    qdef = QUESTION_BY_ID.get(question_id)
    if qdef and qdef.question_type.value == "country" and isinstance(value, str):
        from app.services.economy_resolution_service import resolve_country
        result = await resolve_country(db, value)
        if result:
            return {"input": value, "country_code": result.country_code, "country_name": result.country_name}
        return value.strip()
    if qdef and qdef.question_type.value == "industry" and isinstance(value, str):
        return value.strip().lower().replace(" ", "_")
    if isinstance(value, str):
        return sanitize_text(value)
    return value


async def submit_context_answers(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    request: ContextSubmissionRequest,
    current_user: CurrentUser,
    request_id: Optional[str] = None,
) -> ContextSubmissionResponse:
    settings = get_settings()
    validation = await load_validation(db, validation_id, current_user)
    validation = await _maybe_transition_to_collecting(db, validation, current_user)
    context = await get_or_create_context(db, validation_id, current_user)

    accepted: list[str] = []
    rejected: list[dict] = []
    answers_by_id = {a.question_id: a for a in context.answers}

    for item in request.answers:
        if item.question_id not in QUESTION_BY_ID:
            rejected.append({"question_id": item.question_id, "reason": "Unknown question"})
            continue
        qdef = QUESTION_BY_ID[item.question_id]
        if isinstance(item.value, str) and len(item.value) > settings.context_max_answer_length:
            raise InvalidAnswerError(
                f"Answer exceeds max length for {item.question_id}",
                field=item.question_id,
            )
        normalized = await _normalize_answer(db, item.question_id, item.value)
        answer = ContextAnswer(
            question_id=item.question_id,
            category=qdef.category,
            value=item.value,
            normalized_value=normalized,
            notes=item.notes,
            updated_at=datetime.now(timezone.utc),
        )
        answer.quality_flags = evaluate_answer_quality(answer, qdef, context)
        answers_by_id[item.question_id] = answer
        accepted.append(item.question_id)
        if item.question_id not in context.question_state.answered_question_ids:
            context.question_state.answered_question_ids.append(item.question_id)

    context.answers = list(answers_by_id.values())
    context.answer_quality_report = evaluate_context_quality(context)
    context.anti_gaming_report = run_preliminary_anti_gaming_scan(context, validation)
    context.preliminary_knowledge_gap_report = run_preliminary_knowledge_gap_scan(context, validation)

    required_qs = [q for q in get_required_questions(context, validation) if q.required]
    answered_ids = {a.question_id for a in context.answers}
    context.missing_fields = [q.question_id for q in required_qs if q.question_id not in answered_ids]
    context.required_fields_complete = len(context.missing_fields) == 0

    economic_stack_preview = None
    gate = evaluate_context_gate(context, validation)

    # Build engine input (readiness flag set after gate)
    engine_input = build_engine_input_object(
        context, validation, economic_stack_preview, readiness_for_engines=False
    )
    context.engine_input_object = engine_input

    if request.submit_final and gate.can_proceed_to_engines:
        engine_input = build_engine_input_object(
            context, validation, economic_stack_preview, readiness_for_engines=True
        )
        context.engine_input_object = engine_input

    context.context_blockers = gate.blockers
    context.context_warnings = gate.warnings
    context.status = determine_context_status(context, gate.can_proceed_to_engines)

    can_proceed = False
    next_batch: list[dict] = []

    if request.submit_final:
        if gate.can_proceed_to_engines:
            can_proceed = True
            status = validation.get("status")
            if status in (ValidationStatus.draft.value, ValidationStatus.context_collecting.value):
                await transition_validation(
                    db, validation_id, ValidationStatus.context_collected,
                    "Context gate passed", current_user, request_id=request_id,
                )
            if gate.can_build_economic_stack:
                am = {a.question_id: a.normalized_value or a.value for a in context.answers}
                founder = _country_str(am.get("economy_founder_country") or validation.get("founder_country"))
                customer = _country_str(am.get("economy_customer_country") or validation.get("customer_country"))
                if founder and customer:
                    try:
                        stack_req = EconomicStackBuildRequest(
                            validation_id=validation_id,
                            founder_country=founder,
                            customer_country=customer,
                            revenue_country=_country_str(am.get("economy_revenue_country")),
                            platform=str(am.get("economy_platform") or ""),
                            regulatory_country=_country_str(am.get("economy_regulatory_jurisdiction")),
                            industry=str(am.get("industry_sector") or validation.get("industry") or ""),
                            target_customer=str(am.get("basic_target_customer") or ""),
                        )
                        stack = await build_economic_stack(db, stack_req)
                        economic_stack_preview = stack.model_dump(mode="json")
                        context.economic_stack_preview = economic_stack_preview
                        context.engine_input_object = build_engine_input_object(
                            context, validation, economic_stack_preview, readiness_for_engines=True,
                        )
                        await db[VALIDATION_SESSIONS].update_one(
                            {"validation_id": validation_id},
                            {"$set": {"economic_stack_id": stack.stack_id, "updated_at": datetime.now(timezone.utc)}},
                        )
                        cur = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
                        if cur["status"] == ValidationStatus.context_collected.value:
                            await transition_validation(
                                db, validation_id, ValidationStatus.economic_stack_built,
                                "Economic stack built from context", current_user, request_id=request_id,
                            )
                        await emit_event(
                            db, ValidationEventType.economic_stack_built,
                            "validation", validation_id,
                            {"stack_id": stack.stack_id},
                            owner_user_id=current_user.user_id,
                            validation_id=validation_id,
                        )
                    except Exception as exc:
                        logger.warning("Economic stack build failed: %s", exc)
                        context.context_warnings.append(f"Economic stack build deferred: {exc}")

            context.status = ContextStatus.context_collected
            context.completed_at = datetime.now(timezone.utc)
            await emit_event(
                db, ValidationEventType.context_collected,
                "validation_context", context.context_id,
                {"validation_id": validation_id},
                owner_user_id=current_user.user_id,
                validation_id=validation_id,
            )
        else:
            context.status = (
                ContextStatus.blocked_by_anti_gaming
                if context.anti_gaming_report and context.anti_gaming_report.blocks_progress
                else ContextStatus.blocked_by_quality
            )
            await emit_event(
                db, ValidationEventType.context_blocked,
                "validation_context", context.context_id,
                {"blockers": [b.model_dump(mode="json") for b in gate.blockers]},
                owner_user_id=current_user.user_id,
                validation_id=validation_id,
            )
            batch_resp = await get_next_question_batch(db, validation_id, current_user)
            next_batch = [q.model_dump(mode="json") for q in batch_resp.batch.questions]
    else:
        batch_resp = await get_next_question_batch(db, validation_id, current_user)
        next_batch = [q.model_dump(mode="json") for q in batch_resp.batch.questions]

    context.submitted_at = datetime.now(timezone.utc)
    await save_context(db, context)

    await emit_event(
        db, ValidationEventType.context_answers_submitted,
        "validation_context", context.context_id,
        {"accepted": len(accepted), "submit_final": request.submit_final},
        owner_user_id=current_user.user_id,
        validation_id=validation_id,
    )
    await write_audit_log(
        db,
        action="validation.context_submitted",
        entity_type="validation_context",
        entity_id=context.context_id,
        actor_user_id=current_user.user_id,
        owner_user_id=current_user.user_id,
        new_value={"accepted_count": len(accepted), "can_proceed": can_proceed},
        request_id=request_id,
    )

    return ContextSubmissionResponse(
        validation_id=validation_id,
        context_id=context.context_id,
        context_status=context.status,
        accepted_answers=accepted,
        rejected_answers=rejected,
        missing_required_fields=context.missing_fields,
        blockers=[b.model_dump(mode="json") for b in gate.blockers],
        warnings=context.context_warnings,
        next_questions=next_batch,
        can_proceed_to_engines=can_proceed,
        engine_input_object=context.engine_input_object.model_dump(mode="json") if context.engine_input_object else None,
    )


def _country_str(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, dict):
        return val.get("country_name") or val.get("input") or val.get("country_code")
    return str(val)


async def reset_context(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    current_user: CurrentUser,
    request_id: Optional[str] = None,
) -> dict:
    settings = get_settings()
    if not settings.context_allow_development_reset:
        raise InvalidAnswerError("Context reset is disabled")

    validation = await load_validation(db, validation_id, current_user)
    context = await get_or_create_context(db, validation_id, current_user)

    context.answers = []
    context.question_state.answered_question_ids = []
    context.question_state.asked_question_ids = []
    context.question_state.current_batch_number = 0
    context.missing_fields = []
    context.context_blockers = []
    context.context_warnings = []
    context.engine_input_object = None
    context.economic_stack_preview = None
    context.status = ContextStatus.in_progress
    context.answer_quality_report = None
    context.anti_gaming_report = None
    context.preliminary_knowledge_gap_report = None
    await save_context(db, context)

    if validation.get("status") in (
        ValidationStatus.draft.value,
        ValidationStatus.context_collected.value,
        ValidationStatus.economic_stack_built.value,
    ):
        await db[VALIDATION_SESSIONS].update_one(
            {"validation_id": validation_id},
            {"$set": {"status": ValidationStatus.context_collecting.value, "updated_at": datetime.now(timezone.utc)}},
        )

    await emit_event(
        db, ValidationEventType.context_reset,
        "validation_context", context.context_id,
        {"validation_id": validation_id},
        owner_user_id=current_user.user_id,
        validation_id=validation_id,
    )
    await write_audit_log(
        db, action="validation.context_reset",
        entity_type="validation_context", entity_id=context.context_id,
        actor_user_id=current_user.user_id, owner_user_id=current_user.user_id,
        request_id=request_id,
    )
    return {"validation_id": validation_id, "context_id": context.context_id, "reset": True}
