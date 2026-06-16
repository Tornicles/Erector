"""
Erector FastAPI Application — Prompt A1 Scaffold
Full entry point: middleware, routers, DB lifecycle, error handling.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.cors import setup_cors
from app.core.errors import AppError
from app.core.logging import setup_logging
from app.db.client import close_mongo_connection, connect_to_mongo, get_database
from app.db.indexes import create_indexes
from app.middleware.request_id import RequestIDMiddleware
from app.models.api import error_response
from app.routers import auth, health, schema
from app.routers import economies as economies_router
from app.routers import stack as stack_router
from app.routers import validations as validations_router
from app.routers import context as context_router
from app.routers import bhudhi as bhudhi_router
from app.seeders.seed_economies import seed_economies
from app.seeders.seed_country_mappings import seed_country_mappings

settings = get_settings()
setup_logging(settings.log_level)
logger = logging.getLogger(__name__)


# ── DB Lifecycle ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"[Erector] Starting up — env={settings.app_env}, version={settings.app_version}")

    await connect_to_mongo(
        uri=settings.effective_mongodb_uri,
        db_name=settings.effective_db_name,
        timeout_ms=settings.mongodb_connect_timeout_ms,
    )

    db = get_database()
    index_result = await create_indexes(db)
    logger.info(
        f"[Erector] A1+A2 indexes: {len(index_result['created'])} created, "
        f"{len(index_result['errors'])} errors"
    )

    # A2 seeders — idempotent, safe on every startup
    eco_result = await seed_economies(db)
    logger.info(
        f"[Erector] Economies seeded: {eco_result['upserted']} new, "
        f"{eco_result['skipped']} existing, {eco_result['total']} total"
    )
    map_result = await seed_country_mappings(db)
    logger.info(
        f"[Erector] Country mappings seeded: {map_result['upserted']} new, "
        f"{map_result['skipped']} existing, {map_result['total']} total"
    )

    if settings.mock_auth_enabled:
        logger.warning("[Erector] MOCK AUTH ENABLED — do not use in production")

    yield

    await close_mongo_connection()
    logger.info("[Erector] Shutdown complete")


# ── App Factory ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Erector API",
    description=(
        "Reality Simulation, Validation & Execution Intelligence Platform. "
        "Prompt A1 scaffold — auth stub, health, schema."
    ),
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.enable_openapi else None,
    redoc_url="/api/redoc" if settings.enable_openapi else None,
    openapi_url="/api/openapi.json" if settings.enable_openapi else None,
)


# ── Middleware ────────────────────────────────────────────────────────────────

setup_cors(app, settings.cors_origins_list)
app.add_middleware(RequestIDMiddleware)


@app.middleware("http")
async def add_process_time(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    response.headers["X-Process-Time-Ms"] = str(elapsed_ms)
    return response


# ── Global Error Handler ──────────────────────────────────────────────────────

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    request_id = getattr(request.state, "request_id", None)
    body = error_response(
        code=exc.code,
        message=exc.user_facing_message,
        error_type=exc.error_type,
        request_id=request_id,
    ).model_dump(mode='json')
    return JSONResponse(status_code=exc.status_code, content=body)


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error on {request.url.path}: {exc}")
    from app.models.enums import ErrorType
    request_id = getattr(request.state, "request_id", None)
    body = error_response(
        code="INTERNAL_ERROR",
        message="An unexpected error occurred.",
        error_type=ErrorType.unknown_error,
        request_id=request_id,
    ).model_dump(mode='json')
    return JSONResponse(status_code=500, content=body)


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(schema.router, prefix="/api")
app.include_router(economies_router.router, prefix="/api")
app.include_router(stack_router.router, prefix="/api")
app.include_router(validations_router.router, prefix="/api")
app.include_router(context_router.router, prefix="/api")
app.include_router(bhudhi_router.router, prefix="/api")
