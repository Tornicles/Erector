"""
Health router — GET /api/health
Returns API envelope with DB connectivity status.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app.core.config import get_settings
from app.db.health import check_db_health
from app.models.api import success_response

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
async def health_check(request: Request):
    """
    System health check.
    Returns API version, DB status, and uptime metadata.
    """
    start = time.perf_counter()
    db_health = await check_db_health()
    elapsed_ms = int((time.perf_counter() - start) * 1000)

    request_id = getattr(request.state, "request_id", "health")
    data = {
        "status": "healthy" if db_health["connected"] else "degraded",
        "version": settings.app_version,
        "environment": settings.app_env,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_health,
        "mock_auth_enabled": settings.mock_auth_enabled,
    }

    response = success_response(
        data=data,
        request_id=request_id,
        processing_time_ms=elapsed_ms,
    )
    return response.model_dump()
