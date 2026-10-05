"""
Bhudhi Router — Prompt A5
Internal/dev endpoints for governed AI calls.
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.errors import AppError, BhudhiContractError, ValidationAccessDeniedAsNotFound
from app.db.client import get_database
from app.dependencies.auth import get_current_user
from app.models.api import error_response, success_response
from app.models.auth import CurrentUser
from app.models.bhudhi import BhudhiTrigger
from app.services.bhudhi_log_service import get_usage_summary, list_bhudhi_logs_for_validation
from app.services.bhudhi_service import (
    explain_score,
    interpret_goal,
    run_trigger,
    structure_assumptions,
)
from app.services.context_service import load_validation

router = APIRouter(prefix="/v1/bhudhi", tags=["bhudhi"])


@router.post("/trigger")
async def trigger_bhudhi(
    payload: BhudhiTrigger,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    payload.owner_user_id = current_user.user_id
    try:
        resp = await run_trigger(db, payload)
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        raise HTTPException(
            status_code=exc.status_code,
            detail=error_response(
                code=exc.code,
                message=exc.user_facing_message or exc.message,
                error_type=exc.error_type,
                request_id=getattr(request.state, "request_id", None),
                processing_time_ms=elapsed,
                field=exc.field,
                details=exc.details,
            ).model_dump(mode="json"),
        )
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=resp.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.post("/interpret-goal")
async def interpret_goal_endpoint(
    payload: dict,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    raw_goal = payload.get("raw_goal")
    if not raw_goal:
        raise HTTPException(status_code=422, detail="raw_goal required")
    resp = await interpret_goal(db, raw_goal, validation_id=payload.get("validation_id"), context=payload.get("context"), current_user=current_user)
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=resp.validated_output or resp.output,
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.post("/structure-assumptions")
async def structure_assumptions_endpoint(
    payload: dict,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    validation_id = payload.get("validation_id")
    if not validation_id:
        raise HTTPException(status_code=422, detail="validation_id required")
    await load_validation(db, validation_id, current_user)
    resp = await structure_assumptions(
        db,
        validation_id=validation_id,
        structured_goal=payload.get("structured_goal") or {},
        context=payload.get("context") or {},
        current_user=current_user,
    )
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=resp.validated_output or resp.output,
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.post("/explain-score")
async def explain_score_endpoint(
    payload: dict,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    if payload.get("deterministic_score") is None:
        raise HTTPException(status_code=422, detail="deterministic_score required")
    if payload.get("deterministic_rationale") is None:
        raise HTTPException(status_code=422, detail="deterministic_rationale required")
    resp = await explain_score(db, payload=payload, validation_id=payload.get("validation_id"), current_user=current_user)
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=resp.validated_output or resp.output,
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.get("/logs/{validation_id}")
async def get_bhudhi_logs(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    # Enforce ownership via validation lookup (404 on cross-user)
    await load_validation(db, validation_id, current_user)
    logs = await list_bhudhi_logs_for_validation(db, validation_id, current_user.user_id)
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data={"logs": logs, "total": len(logs)},
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.get("/usage")
async def get_bhudhi_usage(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    usage = await get_usage_summary(db, current_user.user_id)
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=usage,
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")

