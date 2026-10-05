"""
Stack Router (Prompt A2)
POST /api/v1/stack/build
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Request

from app.db.client import get_database
from app.models.api import success_response
from app.models.economy import EconomicStackBuildRequest
from app.services.economic_stack_service import build_economic_stack

router = APIRouter(prefix="/v1/stack", tags=["stack"])


@router.post("/build")
async def build_stack(
    payload: EconomicStackBuildRequest,
    request: Request,
):
    """
    Build a 6-layer Economic Stack from founder/customer country inputs.
    Returns fully resolved stack with difficulty multipliers.

    Required:
    - founder_country: where the team operates
    - customer_country: where the target customer is located

    Optional:
    - revenue_country, platform, team_locations, regulatory_country
    """
    start = time.perf_counter()
    db = get_database()
    stack = await build_economic_stack(db, payload)
    elapsed = int((time.perf_counter() - start) * 1000)
    request_id = getattr(request.state, "request_id", None)

    response = success_response(
        data=stack.model_dump(),
        request_id=request_id,
        processing_time_ms=elapsed,
    )
    return response.model_dump(mode="json")
