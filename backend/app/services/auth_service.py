"""
Auth Service — Magic Link issue/verify + Session management.

MOCK MODE: When Supabase is not configured (debug=True or supabase keys missing),
the magic link token is returned directly in the API response.
In production, Supabase would email the link — wire that in a later prompt.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.core.errors import AuthenticationError, SessionRevokedError
from app.core.security import generate_secure_token, hash_token, hash_ip
from app.db.collections import (
    ERECTOR_USERS,
    ERECTOR_SESSIONS,
    MAGIC_LINK_ATTEMPTS,
)
from app.models.auth import (
    MagicLinkAttemptDocument,
    MagicLinkResponse,
    SessionDocument,
    TokenPair,
    CurrentUser,
)
from app.models.enums import SubscriptionTier, UserType
from app.services.token_service import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from models.base import new_id

logger = logging.getLogger(__name__)
settings = get_settings()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Magic Link ────────────────────────────────────────────────────────────────

async def send_magic_link(
    db: AsyncIOMotorDatabase,
    email: str,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> MagicLinkResponse:
    """
    Issue a magic-link token.
    Mock mode: returns the raw token in `mock_token` for dev use.
    Production: Supabase would email the link (wired in auth prompt).
    """
    raw_token = generate_secure_token(32)
    token_hash = hash_token(raw_token)
    email_hash = hashlib.sha256(email.lower().encode()).hexdigest()
    expires_at = _utcnow() + timedelta(minutes=15)

    attempt = MagicLinkAttemptDocument(
        attempt_id=new_id(),
        email_hash=email_hash,
        token_hash=token_hash,
        expires_at=expires_at,
        ip_hash=hash_ip(ip),
        user_agent=user_agent,
    )
    # Store email alongside the attempt for mock-mode recovery during verify.
    attempt_data = attempt.model_dump()
    attempt_data["email"] = email.lower()

    await db[MAGIC_LINK_ATTEMPTS].insert_one(attempt_data)
    logger.info(f"Magic link issued for email_hash={email_hash[:8]}...")

    return MagicLinkResponse(
        message=(
            "Mock magic link generated (debug mode)."
            if settings.mock_auth_enabled
            else "Magic link sent. Check your email."
        ),
        email=email,
        expires_in_minutes=15,
        mock_token=raw_token if settings.mock_auth_enabled else None,
    )


async def verify_magic_link(
    db: AsyncIOMotorDatabase,
    token: str,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> TokenPair:
    """
    Verify a magic-link token and return a JWT pair.
    1. Look up attempt by token_hash.
    2. Check expiry + not-already-consumed.
    3. Mark as consumed.
    4. Upsert user in erector_users.
    5. Create session + JWT pair.
    """
    token_hash = hash_token(token)
    now = _utcnow()

    attempt_doc = await db[MAGIC_LINK_ATTEMPTS].find_one({"token_hash": token_hash})
    if not attempt_doc:
        raise AuthenticationError("Magic link token not found or expired.")
    if attempt_doc.get("consumed_at") is not None:
        raise AuthenticationError("Magic link token has already been used.")
    if attempt_doc["expires_at"].replace(tzinfo=timezone.utc) < now:
        raise AuthenticationError("Magic link token has expired.")

    email: str = attempt_doc.get("email", "")
    if not email:
        raise AuthenticationError("Cannot determine email from token.")

    # Mark consumed
    await db[MAGIC_LINK_ATTEMPTS].update_one(
        {"token_hash": token_hash},
        {"$set": {"consumed_at": now}},
    )

    # Upsert user
    user_doc = await db[ERECTOR_USERS].find_one({"email": email})
    if not user_doc:
        user_id = new_id()
        new_user = {
            "user_id": user_id,
            "email": email,
            "full_name": None,
            "user_type": UserType.individual.value,
            "status": "active",
            "subscription_tier": SubscriptionTier.free.value,
            "onboarding_completed": False,
            "created_at": now,
            "updated_at": now,
        }
        await db[ERECTOR_USERS].insert_one(new_user)
    else:
        user_id = user_doc["user_id"]

    # Create session
    session_id = new_id()
    access_token, access_expires_at = create_access_token(user_id, session_id)
    refresh_token, refresh_expires_at = create_refresh_token(user_id, session_id)

    session = SessionDocument(
        session_id=session_id,
        user_id=user_id,
        access_token_hash=hash_token(access_token),
        refresh_token_hash=hash_token(refresh_token),
        expires_at=access_expires_at,
        refresh_expires_at=refresh_expires_at,
        ip_hash=hash_ip(ip),
        user_agent=user_agent,
    )
    await db[ERECTOR_SESSIONS].insert_one(session.model_dump())

    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="Bearer",
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        refresh_expires_in=settings.jwt_refresh_token_expire_days * 86400,
    )


# ── Token Refresh ─────────────────────────────────────────────────────────────

async def refresh_tokens(
    db: AsyncIOMotorDatabase,
    refresh_token: str,
) -> TokenPair:
    """Exchange a valid refresh token for a new access + refresh pair."""
    claims = decode_refresh_token(refresh_token)
    user_id: str = claims["sub"]
    old_session_id: str = claims["sid"]

    session_doc = await db[ERECTOR_SESSIONS].find_one({"session_id": old_session_id})
    if not session_doc:
        raise AuthenticationError("Session not found.")
    if session_doc.get("revoked_at") is not None:
        raise SessionRevokedError()

    # Revoke old session
    now = _utcnow()
    await db[ERECTOR_SESSIONS].update_one(
        {"session_id": old_session_id},
        {"$set": {"revoked_at": now}},
    )

    # Create new session
    session_id = new_id()
    new_access, access_exp = create_access_token(user_id, session_id)
    new_refresh, refresh_exp = create_refresh_token(user_id, session_id)

    session = SessionDocument(
        session_id=session_id,
        user_id=user_id,
        access_token_hash=hash_token(new_access),
        refresh_token_hash=hash_token(new_refresh),
        expires_at=access_exp,
        refresh_expires_at=refresh_exp,
    )
    await db[ERECTOR_SESSIONS].insert_one(session.model_dump())

    return TokenPair(
        access_token=new_access,
        refresh_token=new_refresh,
        token_type="Bearer",
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        refresh_expires_in=settings.jwt_refresh_token_expire_days * 86400,
    )


# ── Logout ────────────────────────────────────────────────────────────────────

async def logout_session(
    db: AsyncIOMotorDatabase,
    session_id: str,
) -> None:
    """Revoke a session by ID."""
    await db[ERECTOR_SESSIONS].update_one(
        {"session_id": session_id},
        {"$set": {"revoked_at": _utcnow()}},
    )


# ── User Lookup ───────────────────────────────────────────────────────────────

async def get_user_by_id(
    db: AsyncIOMotorDatabase,
    user_id: str,
) -> dict:
    """Fetch raw user document. Raises NotFoundAppError if missing."""
    from app.core.errors import NotFoundAppError
    doc = await db[ERECTOR_USERS].find_one({"user_id": user_id})
    if not doc:
        raise NotFoundAppError("User")
    return doc
