"""
Context Collection Router — Prompt A4
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.errors import AppError
from app.db.client import get_database
from app.dependencies.auth import get_current_user
from app.models.api import error_response, success_response
from app.models.auth import CurrentUser
from app.models.context import ContextSubmissionRequest
from app.models.enums import ErrorType
from app.services.context_service import doc_to_context, get_context_by_validation, load_validation
from app.services.question_engine_service import (
    get_next_question_batch,
    get_or_create_context,
    reset_context,
    submit_context_answers,
)

router = APIRouter(prefix="/v1/validations", tags=["context"])


@router.get("/{validation_id}/questions")
async def get_questions_endpoint(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    try:
        result = await get_next_question_batch(db, validation_id, current_user)
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        raise HTTPException(
            status_code=exc.status_code,
            detail=error_response(
                code=exc.code, message=exc.user_facing_message or exc.message,
                error_type=exc.error_type, request_id=getattr(request.state, "request_id", None),
                processing_time_ms=elapsed, field=exc.field, details=exc.details,
            ).model_dump(mode="json"),
        )
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=result.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.post("/{validation_id}/context")
async def submit_context_endpoint(
    validation_id: str,
    payload: ContextSubmissionRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    request_id = getattr(request.state, "request_id", None)
    try:
        result = await submit_context_answers(
            db, validation_id, payload, current_user, request_id=request_id,
        )
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        raise HTTPException(
            status_code=exc.status_code,
            detail=error_response(
                code=exc.code, message=exc.user_facing_message or exc.message,
                error_type=exc.error_type, request_id=request_id,
                processing_time_ms=elapsed, field=exc.field, details=exc.details,
            ).model_dump(mode="json"),
        )
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=result.model_dump(mode="json"),
        request_id=request_id,
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.get("/{validation_id}/context")
async def get_context_endpoint(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    try:
        await load_validation(db, validation_id, current_user)
        doc = await get_context_by_validation(db, validation_id)
        if not doc:
            context = await get_or_create_context(db, validation_id, current_user)
            data = context.model_dump(mode="json")
        else:
            ctx = doc_to_context(doc)
            data = ctx.model_dump(mode="json")
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        raise HTTPException(
            status_code=exc.status_code,
            detail=error_response(
                code=exc.code, message=exc.user_facing_message or exc.message,
                error_type=exc.error_type, request_id=getattr(request.state, "request_id", None),
                processing_time_ms=elapsed,
            ).model_dump(mode="json"),
        )
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=data,
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.post("/{validation_id}/context/reset")
async def reset_context_endpoint(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    request_id = getattr(request.state, "request_id", None)
    try:
        result = await reset_context(db, validation_id, current_user, request_id)
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        raise HTTPException(
            status_code=exc.status_code,
            detail=error_response(
                code=exc.code, message=exc.user_facing_message or exc.message,
                error_type=exc.error_type, request_id=request_id, processing_time_ms=elapsed,
            ).model_dump(mode="json"),
        )
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=result, request_id=request_id, processing_time_ms=elapsed,
    ).model_dump(mode="json")
