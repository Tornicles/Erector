"""
Economies Router (Prompt A2)
GET  /api/v1/economies
GET  /api/v1/economies/{economy_id}
GET  /api/v1/economies/resolve/{country}
POST /api/v1/economies/compare
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from app.db.client import get_database
from app.models.api import error_response, success_response
from app.models.economy import EconomyCompareRequest
from app.models.enums import ErrorType
from app.services.economy_comparison_service import compare_economies
from app.services.economy_resolution_service import resolve_country
from app.services.economy_service import (
    get_economy_by_id,
    list_economies,
)

router = APIRouter(prefix="/v1/economies", tags=["economies"])


@router.get("")
async def get_economies(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=50),
):
    """
    List all economy summaries (paginated).
    Returns lightweight cards — use /{id} for full profiles.
    """
    start = time.perf_counter()
    db = get_database()
    summaries, total = await list_economies(db, skip=skip, limit=limit)
    elapsed = int((time.perf_counter() - start) * 1000)
    request_id = getattr(request.state, "request_id", None)

    from models.base import PaginationMeta
    pagination = PaginationMeta(total=total, skip=skip, limit=limit)

    response = success_response(
        data={"economies": [s.model_dump() for s in summaries], "total": total},
        request_id=request_id,
        processing_time_ms=elapsed,
        pagination=pagination,
    )
    return response.model_dump(mode="json")


@router.get("/resolve/{country}")
async def resolve_country_endpoint(country: str, request: Request):
    """
    Resolve a country name or ISO code to its primary and secondary economies.
    Example: /v1/economies/resolve/Germany  or  /v1/economies/resolve/DE
    """
    start = time.perf_counter()
    db = get_database()
    result = await resolve_country(db, country)
    elapsed = int((time.perf_counter() - start) * 1000)
    request_id = getattr(request.state, "request_id", None)

    if not result:
        body = error_response(
            code="COUNTRY_NOT_FOUND",
            message=f"Could not resolve country: {country!r}. Try an ISO-2 code (e.g. DE) or full name.",
            error_type=ErrorType.validation_error,
            request_id=request_id,
            processing_time_ms=elapsed,
        )
        raise HTTPException(status_code=404, detail=body.model_dump(mode="json"))

    response = success_response(
        data=result.model_dump(),
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")


@router.get("/{economy_id}")
async def get_economy(economy_id: str, request: Request):
    """
    Get a full economy profile by economy_id.
    Example: /v1/economies/eco_consumer_capitalist
    """
    start = time.perf_counter()
    db = get_database()
    economy = await get_economy_by_id(db, economy_id)
    elapsed = int((time.perf_counter() - start) * 1000)
    request_id = getattr(request.state, "request_id", None)

    if not economy:
        body = error_response(
            code="ECONOMY_NOT_FOUND",
            message=f"Economy not found: {economy_id!r}",
            error_type=ErrorType.validation_error,
            request_id=request_id,
            processing_time_ms=elapsed,
        )
        raise HTTPException(status_code=404, detail=body.model_dump(mode="json"))

    response = success_response(
        data=economy.model_dump(),
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")


@router.post("/compare")
async def compare_economies_endpoint(
    payload: EconomyCompareRequest,
    request: Request,
):
    """
    Compare economies based on a business goal and context.
    Returns ranked list with dimension scores and difficulty multipliers.
    """
    start = time.perf_counter()
    db = get_database()
    result = await compare_economies(db, payload)
    elapsed = int((time.perf_counter() - start) * 1000)
    request_id = getattr(request.state, "request_id", None)

    response = success_response(
        data=result.model_dump(),
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")
