"""
Auth router — /api/v1/auth/*

Routes:
  POST /magic-link   — request a magic link
  GET  /verify       — verify token from magic link (?token=xxx)
  POST /refresh      — refresh access token
  POST /logout       — revoke session
  GET  /me           — get current user profile (protected)
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.core.errors import AppError
from app.db.client import get_database
from app.dependencies.auth import get_current_user
from app.models.api import error_response, success_response
from app.models.auth import (
    CurrentUser,
    LogoutRequest,
    MagicLinkRequest,
    RefreshTokenRequest,
)
from app.models.enums import ErrorType
from app.models.users import UserPublic
from app.services.auth_service import (
    get_user_by_id,
    logout_session,
    refresh_tokens,
    send_magic_link,
    verify_magic_link,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", None)


# ── POST /magic-link ──────────────────────────────────────────────────────────

@router.post("/magic-link")
async def request_magic_link(
    body: MagicLinkRequest,
    request: Request,
):
    start = time.perf_counter()
    db = get_database()
    ip = request.client.host if request.client else None
    ua = request.headers.get("User-Agent")

    try:
        result = await send_magic_link(db, body.email, ip=ip, user_agent=ua)
        elapsed = int((time.perf_counter() - start) * 1000)
        return success_response(
            data=result.model_dump(),
            request_id=_rid(request),
            processing_time_ms=elapsed,
        ).model_dump()
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        return JSONResponse(
            status_code=exc.status_code,
            content=error_response(
                code=exc.code,
                message=exc.user_facing_message,
                error_type=exc.error_type,
                request_id=_rid(request),
                processing_time_ms=elapsed,
            ).model_dump(mode='json'),
        )


# ── GET /verify ───────────────────────────────────────────────────────────────

@router.get("/verify")
async def verify_token(
    request: Request,
    token: str = Query(..., description="Magic link token from the email/mock response"),
):
    start = time.perf_counter()
    db = get_database()
    ip = request.client.host if request.client else None
    ua = request.headers.get("User-Agent")

    try:
        token_pair = await verify_magic_link(db, token, ip=ip, user_agent=ua)
        elapsed = int((time.perf_counter() - start) * 1000)
        return success_response(
            data=token_pair.model_dump(),
            request_id=_rid(request),
            processing_time_ms=elapsed,
        ).model_dump()
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        return JSONResponse(
            status_code=exc.status_code,
            content=error_response(
                code=exc.code,
                message=exc.user_facing_message,
                error_type=exc.error_type,
                request_id=_rid(request),
                processing_time_ms=elapsed,
            ).model_dump(mode='json'),
        )


# ── POST /refresh ─────────────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_token(
    body: RefreshTokenRequest,
    request: Request,
):
    start = time.perf_counter()
    db = get_database()

    try:
        token_pair = await refresh_tokens(db, body.refresh_token)
        elapsed = int((time.perf_counter() - start) * 1000)
        return success_response(
            data=token_pair.model_dump(),
            request_id=_rid(request),
            processing_time_ms=elapsed,
        ).model_dump()
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        return JSONResponse(
            status_code=exc.status_code,
            content=error_response(
                code=exc.code,
                message=exc.user_facing_message,
                error_type=exc.error_type,
                request_id=_rid(request),
                processing_time_ms=elapsed,
            ).model_dump(mode='json'),
        )


# ── POST /logout ──────────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(
    body: LogoutRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()

    session_id = body.session_id or current_user.session_id
    await logout_session(db, session_id)

    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data={"message": "Logged out successfully.", "session_id": session_id},
        request_id=_rid(request),
        processing_time_ms=elapsed,
    ).model_dump()


# ── GET /me ───────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()

    try:
        user_doc = await get_user_by_id(db, current_user.user_id)
        user_public = UserPublic(
            user_id=user_doc["user_id"],
            email=user_doc["email"],
            full_name=user_doc.get("full_name"),
            user_type=user_doc.get("user_type", "individual"),
            subscription_tier=user_doc.get("subscription_tier", "free"),
            onboarding_completed=user_doc.get("onboarding_completed", False),
            status=user_doc.get("status", "active"),
        )
        elapsed = int((time.perf_counter() - start) * 1000)
        return success_response(
            data=user_public.model_dump(),
            request_id=_rid(request),
            processing_time_ms=elapsed,
        ).model_dump()
    except AppError as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        return JSONResponse(
            status_code=exc.status_code,
            content=error_response(
                code=exc.code,
                message=exc.user_facing_message,
                error_type=exc.error_type,
                request_id=_rid(request),
                processing_time_ms=elapsed,
            ).model_dump(mode='json'),
        )
