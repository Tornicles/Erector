"""
Validation Service — Prompt A3
CRUD and lifecycle orchestration for validation sessions.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.errors import ValidationAccessDeniedAsNotFound, ValidationNotFoundError
from app.db.collections import VALIDATION_SESSIONS
from app.models.auth import CurrentUser
from app.models.enums import GoalType, UserType, ValidationDepth, ValidationStatus
from app.models.validation import (
    CreateValidationRequest,
    CreateValidationResponse,
    RequestContext,
    ValidationDetailResponse,
    ValidationListFilters,
    ValidationSession,
    new_validation_id,
)
from app.services.audit_service import write_audit_log
from app.services.event_service import get_events_for_validation
from app.services.idempotency_service import (
    assert_request_matches_existing,
    complete_idempotency_key,
    generate_server_idempotency_key,
    hash_validation_create_request,
    normalize_idempotency_key,
    reserve_idempotency_key,
)
from app.services.validation_health_service import check_validation_health
from app.services.validation_state_machine import (
    get_allowed_transitions,
    mark_archived,
    mark_failed,
    transition_validation,
)
from models.enums import ValidationEventType
from app.services.event_service import emit_event

logger = logging.getLogger(__name__)


def normalize_raw_goal(raw_goal: str) -> str:
    return re.sub(r"\s+", " ", raw_goal.strip())


def _determine_initial_status(request: CreateValidationRequest) -> ValidationStatus:
    """Draft unless enough context fields are present for context_collecting."""
    context_fields = [
        request.industry,
        request.founder_country,
        request.customer_country,
        request.success_definition,
    ]
    filled = sum(1 for f in context_fields if f)
    if filled >= 3:
        return ValidationStatus.context_collecting
    return ValidationStatus.draft


def _serialize_validation(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


def _assert_access(doc: dict, user: CurrentUser) -> None:
    if doc["owner_user_id"] != user.user_id:
        if doc.get("team_id") and doc["team_id"] in user.team_ids:
            return
        raise ValidationAccessDeniedAsNotFound(doc["validation_id"])


async def create_validation(
    db: AsyncIOMotorDatabase,
    request: CreateValidationRequest,
    current_user: CurrentUser,
    request_context: Optional[RequestContext] = None,
) -> CreateValidationResponse:
    """Create a validation session with idempotency enforcement."""
    ctx = request_context or RequestContext()
    request_hash = hash_validation_create_request(request)

    idem_key = normalize_idempotency_key(
        ctx.idempotency_header or request.idempotency_key
    )
    if not (ctx.idempotency_header or request.idempotency_key):
        idem_key = generate_server_idempotency_key(
            request, current_user.user_id, ctx.request_id
        )

    record = await reserve_idempotency_key(
        db, current_user.user_id, idem_key, request_hash
    )

    if record.get("validation_id"):
        existing = await db[VALIDATION_SESSIONS].find_one(
            {"validation_id": record["validation_id"]}
        )
        if existing:
            assert_request_matches_existing(record, request_hash)
            await write_audit_log(
                db,
                action="idempotency.reused",
                entity_type="validation",
                entity_id=record["validation_id"],
                actor_user_id=current_user.user_id,
                owner_user_id=current_user.user_id,
                request_id=ctx.request_id,
            )
            return CreateValidationResponse(
                validation_id=record["validation_id"],
                status=ValidationStatus(existing["status"]),
                idempotency_key=idem_key,
                created=False,
                existing=True,
                validation=_serialize_validation(existing),
            )

    assert_request_matches_existing(record, request_hash)

    now = datetime.now(timezone.utc)
    initial_status = _determine_initial_status(request)

    session = ValidationSession(
        validation_id=new_validation_id(),
        owner_user_id=current_user.user_id,
        team_id=request.team_id,
        status=initial_status,
        idempotency_key=idem_key,
        title=request.title,
        raw_goal=normalize_raw_goal(request.raw_goal),
        goal_type=request.goal_type or GoalType.business,
        validation_depth=request.validation_depth or ValidationDepth.full_deep_validation,
        user_type=current_user.user_type,
        industry=request.industry,
        founder_country=request.founder_country,
        customer_country=request.customer_country,
        target_launch_date=request.target_launch_date,
        budget_range=request.budget_range,
        currency=request.currency or "USD",
        success_definition=request.success_definition,
        last_activity_at=now,
        metadata=request.metadata or {},
    )

    doc = session.model_dump(mode="json")
    await db[VALIDATION_SESSIONS].insert_one(doc)

    event_id = await emit_event(
        db,
        event_type=ValidationEventType.validation_created,
        entity_type="validation",
        entity_id=session.validation_id,
        payload={"status": initial_status.value, "goal_type": session.goal_type},
        owner_user_id=current_user.user_id,
        validation_id=session.validation_id,
        team_id=request.team_id,
    )

    await db[VALIDATION_SESSIONS].update_one(
        {"validation_id": session.validation_id},
        {"$push": {"event_ids": event_id}},
    )

    await complete_idempotency_key(db, current_user.user_id, idem_key, session.validation_id)

    await write_audit_log(
        db,
        action="validation.created",
        entity_type="validation",
        entity_id=session.validation_id,
        actor_user_id=current_user.user_id,
        owner_user_id=current_user.user_id,
        team_id=request.team_id,
        new_value={"status": initial_status.value, "validation_id": session.validation_id},
        ip_hash=ctx.ip_hash,
        user_agent=ctx.user_agent,
        request_id=ctx.request_id,
    )

    created_doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": session.validation_id})

    return CreateValidationResponse(
        validation_id=session.validation_id,
        status=initial_status,
        idempotency_key=idem_key,
        created=True,
        existing=False,
        validation=_serialize_validation(created_doc),
    )


async def get_validation(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    current_user: CurrentUser,
) -> ValidationDetailResponse:
    """Load validation with allowed transitions, events, and health."""
    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        raise ValidationNotFoundError(validation_id)
    _assert_access(doc, current_user)

    events = await get_events_for_validation(db, validation_id, limit=20)
    health = await check_validation_health(db, validation_id)

    return ValidationDetailResponse(
        validation=_serialize_validation(doc),
        allowed_next_states=get_allowed_transitions(doc["status"]),
        latest_events=events,
        health_status=health,
    )


async def list_validations(
    db: AsyncIOMotorDatabase,
    current_user: CurrentUser,
    filters: ValidationListFilters,
) -> tuple[list[dict], int]:
    """List validations owned by the current user."""
    query: dict = {"owner_user_id": current_user.user_id}

    if filters.status:
        query["status"] = filters.status.value
    if filters.team_id:
        query["team_id"] = filters.team_id
    if filters.created_after:
        query.setdefault("created_at", {})["$gte"] = filters.created_after
    if filters.created_before:
        query.setdefault("created_at", {})["$lte"] = filters.created_before
    if filters.search:
        query["$or"] = [
            {"title": {"$regex": filters.search, "$options": "i"}},
            {"raw_goal": {"$regex": filters.search, "$options": "i"}},
        ]

    total = await db[VALIDATION_SESSIONS].count_documents(query)
    skip = (filters.page - 1) * filters.page_size
    cursor = (
        db[VALIDATION_SESSIONS]
        .find(query)
        .sort("created_at", -1)
        .skip(skip)
        .limit(filters.page_size)
    )
    docs = await cursor.to_list(length=filters.page_size)
    return [_serialize_validation(d) for d in docs], total


async def transition_validation_service(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    next_status: ValidationStatus,
    reason: str,
    actor: CurrentUser,
    metadata: Optional[dict] = None,
    request_id: Optional[str] = None,
) -> tuple[dict, str, str, Optional[str]]:
    """Wrapper that enforces access before state machine transition."""
    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        raise ValidationNotFoundError(validation_id)
    _assert_access(doc, actor)
    return await transition_validation(
        db, validation_id, next_status, reason, actor, metadata, request_id
    )


async def mark_validation_failed(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    reason: str,
    error_code: Optional[str],
    actor: CurrentUser,
    metadata: Optional[dict] = None,
    request_id: Optional[str] = None,
) -> tuple[dict, Optional[str]]:
    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        raise ValidationNotFoundError(validation_id)
    _assert_access(doc, actor)
    return await mark_failed(db, validation_id, reason, error_code, actor, metadata, request_id)


async def delete_or_archive_validation(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    current_user: CurrentUser,
    request_id: Optional[str] = None,
) -> tuple[dict, Optional[str]]:
    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        raise ValidationNotFoundError(validation_id)
    _assert_access(doc, current_user)
    return await mark_archived(
        db, validation_id, "Archived by user", current_user, request_id
    )
