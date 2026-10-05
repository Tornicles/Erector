"""
JWT Token Service — create, decode, and refresh access/refresh tokens.
Uses python-jose[cryptography]. No Supabase dependency.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt

from app.core.config import get_settings
from app.core.errors import TokenExpiredError, TokenInvalidError

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    user_id: str,
    session_id: str,
    extra_claims: Optional[dict] = None,
) -> tuple[str, datetime]:
    """
    Create a signed JWT access token.
    Returns (raw_token, expires_at).
    """
    settings = get_settings()
    expires_at = _utcnow() + timedelta(minutes=settings.jwt_access_token_expire_minutes)

    claims: dict[str, Any] = {
        "sub": user_id,
        "sid": session_id,
        "type": "access",
        "iat": _utcnow(),
        "exp": expires_at,
    }
    if extra_claims:
        claims.update(extra_claims)

    token = jwt.encode(
        claims,
        settings.effective_jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return token, expires_at


def create_refresh_token(
    user_id: str,
    session_id: str,
) -> tuple[str, datetime]:
    """
    Create a signed JWT refresh token.
    Returns (raw_token, expires_at).
    """
    settings = get_settings()
    expires_at = _utcnow() + timedelta(days=settings.jwt_refresh_token_expire_days)

    claims: dict[str, Any] = {
        "sub": user_id,
        "sid": session_id,
        "type": "refresh",
        "iat": _utcnow(),
        "exp": expires_at,
    }

    token = jwt.encode(
        claims,
        settings.effective_jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return token, expires_at


def decode_token(token: str) -> dict:
    """
    Decode and validate a JWT. Raises TokenExpiredError or TokenInvalidError.
    Returns the raw claims dict.
    """
    settings = get_settings()
    try:
        claims = jwt.decode(
            token,
            settings.effective_jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        return claims
    except JWTError as exc:
        msg = str(exc).lower()
        if "expired" in msg:
            raise TokenExpiredError() from exc
        raise TokenInvalidError() from exc


def decode_access_token(token: str) -> dict:
    """Decode and validate an access token. Raises if wrong type."""
    claims = decode_token(token)
    if claims.get("type") != "access":
        raise TokenInvalidError()
    return claims


def decode_refresh_token(token: str) -> dict:
    """Decode and validate a refresh token. Raises if wrong type."""
    claims = decode_token(token)
    if claims.get("type") != "refresh":
        raise TokenInvalidError()
    return claims
