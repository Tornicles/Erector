"""
Auth Dependencies — FastAPI Depends() helpers for protected routes.
"""

from __future__ import annotations

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import AuthenticationError, SessionRevokedError
from app.db.client import get_database
from app.db.collections import ERECTOR_SESSIONS, ERECTOR_USERS
from app.models.auth import CurrentUser
from app.models.enums import SubscriptionTier, UserType
from app.services.token_service import decode_access_token

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> CurrentUser:
    """
    Extract and validate a Bearer access token from the Authorization header.
    Returns a CurrentUser or raises AuthenticationError.
    """
    if not credentials or not credentials.credentials:
        raise AuthenticationError("No Bearer token provided.")

    token = credentials.credentials
    claims = decode_access_token(token)  # raises TokenExpiredError / TokenInvalidError

    user_id: str = claims["sub"]
    session_id: str = claims["sid"]

    db = get_database()

    # Verify session is active
    session_doc = await db[ERECTOR_SESSIONS].find_one({"session_id": session_id})
    if not session_doc:
        raise AuthenticationError("Session not found.")
    if session_doc.get("revoked_at") is not None:
        raise SessionRevokedError()

    # Fetch user
    user_doc = await db[ERECTOR_USERS].find_one({"user_id": user_id})
    if not user_doc:
        raise AuthenticationError("User not found.")

    return CurrentUser(
        user_id=user_id,
        email=user_doc["email"],
        user_type=UserType(user_doc.get("user_type", UserType.individual.value)),
        subscription_tier=SubscriptionTier(
            user_doc.get("subscription_tier", SubscriptionTier.free.value)
        ),
        team_ids=user_doc.get("team_ids", []),
        is_admin=user_doc.get("is_admin", False),
        session_id=session_id,
    )
