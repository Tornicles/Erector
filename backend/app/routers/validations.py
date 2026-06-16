"""
Validations Router — Prompt A3
Lifecycle control API for validation sessions.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from app.core.errors import AppError
from app.db.client import get_database
from app.db.collections import VALIDATION_SESSIONS
from app.dependencies.auth import get_current_user
from app.models.api import error_response, success_response
from app.models.auth import CurrentUser
from app.models.enums import ErrorType, ValidationStatus
from app.models.validation import (
    CreateValidationRequest,
    FailValidationRequest,
    RequestContext,
    TransitionValidationRequest,
    TransitionValidationResponse,
    ValidationListFilters,
)
from app.services.event_service import get_events_for_validation
from app.services.validation_health_service import check_validation_health
from app.services.validation_service import (
    _assert_access,
    create_validation,
    delete_or_archive_validation,
    get_validation,
    list_validations,
    mark_validation_failed,
    transition_validation_service,
)
from models.base import PaginationMeta

router = APIRouter(prefix="/v1/validations", tags=["validations"])


def _request_context(
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
) -> RequestContext:
    return RequestContext(
        request_id=getattr(request.state, "request_id", None),
        idempotency_header=idempotency_key,
    )


@router.post("")
async def create_validation_endpoint(
    payload: CreateValidationRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    ctx: RequestContext = Depends(_request_context),
):
    """Create a validation session with idempotency enforcement."""
    start = time.perf_counter()
    db = get_database()
    try:
        result = await create_validation(db, payload, current_user, ctx)
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        request_id = getattr(request.state, "request_id", None)
        body = error_response(
            code=exc.code,
            message=exc.user_facing_message or exc.message,
            error_type=exc.error_type,
            request_id=request_id,
            processing_time_ms=elapsed,
            field=exc.field,
            details=exc.details,
        )
        raise HTTPException(status_code=exc.status_code, detail=body.model_dump(mode="json"))

    elapsed = int((time.perf_counter() - start) * 1000)
    request_id = getattr(request.state, "request_id", None)
    status_code = 201 if result.created else 200
    response = success_response(
        data=result.model_dump(mode="json"),
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=status_code,
        content=response.model_dump(mode="json"),
    )


@router.get("")
async def list_validations_endpoint(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    status: Optional[ValidationStatus] = Query(None),
    team_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    created_after: Optional[datetime] = Query(None),
    created_before: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List validations owned by the current user."""
    start = time.perf_counter()
    db = get_database()
    filters = ValidationListFilters(
        status=status,
        team_id=team_id,
        search=search,
        created_after=created_after,
        created_before=created_before,
        page=page,
        page_size=page_size,
    )
    validations, total = await list_validations(db, current_user, filters)
    elapsed = int((time.perf_counter() - start) * 1000)
    request_id = getattr(request.state, "request_id", None)
    total_pages = (total + page_size - 1) // page_size if page_size else 1
    pagination = PaginationMeta(
        page=page,
        page_size=page_size,
        total_items=total,
        total_pages=total_pages,
    )
    response = success_response(
        data={"validations": validations, "total": total},
        request_id=request_id,
        processing_time_ms=elapsed,
        pagination=pagination,
    )
    return response.model_dump(mode="json")


@router.get("/{validation_id}")
async def get_validation_endpoint(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get validation detail with allowed transitions, events, and health."""
    start = time.perf_counter()
    db = get_database()
    try:
        detail = await get_validation(db, validation_id, current_user)
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        request_id = getattr(request.state, "request_id", None)
        body = error_response(
            code=exc.code,
            message=exc.user_facing_message or exc.message,
            error_type=exc.error_type,
            request_id=request_id,
            processing_time_ms=elapsed,
        )
        raise HTTPException(status_code=exc.status_code, detail=body.model_dump(mode="json"))

    elapsed = int((time.perf_counter() - start) * 1000)
    request_id = getattr(request.state, "request_id", None)
    response = success_response(
        data=detail.model_dump(mode="json"),
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")


@router.patch("/{validation_id}/state")
async def transition_validation_endpoint(
    validation_id: str,
    payload: TransitionValidationRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Manually transition validation state (development/internal lifecycle control)."""
    start = time.perf_counter()
    db = get_database()
    request_id = getattr(request.state, "request_id", None)
    try:
        updated, previous, event_id = await transition_validation_service(
            db,
            validation_id,
            payload.next_status,
            payload.reason,
            current_user,
            payload.metadata,
            request_id,
        )
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        body = error_response(
            code=exc.code,
            message=exc.user_facing_message or exc.message,
            error_type=exc.error_type,
            request_id=request_id,
            processing_time_ms=elapsed,
            field=exc.field,
            details=exc.details,
        )
        raise HTTPException(status_code=exc.status_code, detail=body.model_dump(mode="json"))

    elapsed = int((time.perf_counter() - start) * 1000)
    result = TransitionValidationResponse(
        validation_id=validation_id,
        previous_status=ValidationStatus(previous),
        current_status=payload.next_status,
        transitioned=True,
        reason=payload.reason,
        event_id=event_id,
    )
    response = success_response(
        data=result.model_dump(mode="json"),
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")


@router.post("/{validation_id}/fail")
async def fail_validation_endpoint(
    validation_id: str,
    payload: FailValidationRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Mark validation as failed."""
    start = time.perf_counter()
    db = get_database()
    request_id = getattr(request.state, "request_id", None)
    try:
        updated, event_id = await mark_validation_failed(
            db,
            validation_id,
            payload.reason,
            payload.error_code,
            current_user,
            payload.metadata,
            request_id,
        )
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        body = error_response(
            code=exc.code,
            message=exc.user_facing_message or exc.message,
            error_type=exc.error_type,
            request_id=request_id,
            processing_time_ms=elapsed,
            field=exc.field,
            details=exc.details,
        )
        raise HTTPException(status_code=exc.status_code, detail=body.model_dump(mode="json"))

    elapsed = int((time.perf_counter() - start) * 1000)
    response = success_response(
        data={
            "validation_id": validation_id,
            "status": updated["status"],
            "event_id": event_id,
            "failed_reason": payload.reason,
        },
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")


@router.post("/{validation_id}/archive")
async def archive_validation_endpoint(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Archive validation (soft-delete)."""
    start = time.perf_counter()
    db = get_database()
    request_id = getattr(request.state, "request_id", None)
    try:
        updated, event_id = await delete_or_archive_validation(
            db, validation_id, current_user, request_id
        )
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        body = error_response(
            code=exc.code,
            message=exc.user_facing_message or exc.message,
            error_type=exc.error_type,
            request_id=request_id,
            processing_time_ms=elapsed,
            field=exc.field,
            details=exc.details,
        )
        raise HTTPException(status_code=exc.status_code, detail=body.model_dump(mode="json"))

    elapsed = int((time.perf_counter() - start) * 1000)
    response = success_response(
        data={
            "validation_id": validation_id,
            "status": updated["status"],
            "archived_at": updated.get("archived_at"),
            "event_id": event_id,
        },
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")


@router.get("/{validation_id}/events")
async def get_validation_events_endpoint(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=100),
):
    """Return latest events for a validation."""
    start = time.perf_counter()
    db = get_database()
    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        from app.core.errors import ValidationNotFoundError as VNF
        raise HTTPException(
            status_code=404,
            detail=error_response(
                code="VALIDATION_NOT_FOUND",
                message=f"Validation not found: {validation_id}",
                error_type=ErrorType.validation_error,
                request_id=getattr(request.state, "request_id", None),
            ).model_dump(mode="json"),
        )
    try:
        _assert_access(doc, current_user)
    except AppError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=error_response(
                code=exc.code,
                message=exc.user_facing_message,
                error_type=exc.error_type,
                request_id=getattr(request.state, "request_id", None),
            ).model_dump(mode="json"),
        )

    events = await get_events_for_validation(db, validation_id, limit=limit)
    elapsed = int((time.perf_counter() - start) * 1000)
    response = success_response(
        data={"events": events, "total": len(events)},
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")


@router.get("/{validation_id}/health")
async def get_validation_health_endpoint(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return validation health status."""
    start = time.perf_counter()
    db = get_database()

    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=error_response(
                code="VALIDATION_NOT_FOUND",
                message=f"Validation not found: {validation_id}",
                error_type=ErrorType.validation_error,
                request_id=getattr(request.state, "request_id", None),
            ).model_dump(mode="json"),
        )
    try:
        _assert_access(doc, current_user)
    except AppError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=error_response(
                code=exc.code,
                message=exc.user_facing_message,
                error_type=exc.error_type,
                request_id=getattr(request.state, "request_id", None),
            ).model_dump(mode="json"),
        )

    health = await check_validation_health(db, validation_id)
    elapsed = int((time.perf_counter() - start) * 1000)
    response = success_response(
        data=health.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")
