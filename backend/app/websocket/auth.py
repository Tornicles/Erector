"""
WebSocket authentication — Prompt A6
Supports token via query param (?token=JWT).
"""

from __future__ import annotations

from fastapi import WebSocket

from app.core.errors import AuthenticationError
from app.db.client import get_database
from app.db.collections import ERECTOR_SESSIONS, ERECTOR_USERS
from app.models.auth import CurrentUser
from app.services.context_service import load_validation
from app.services.token_service import decode_access_token
from models.enums import SubscriptionTier, UserType


async def authenticate_websocket(websocket: WebSocket, validation_id: str) -> CurrentUser:
    token = websocket.query_params.get("token")
    if not token:
        raise AuthenticationError("No token provided for WebSocket.")

    claims = decode_access_token(token)
    user_id = claims["sub"]
    session_id = claims["sid"]

    db = get_database()
    session_doc = await db[ERECTOR_SESSIONS].find_one({"session_id": session_id})
    if not session_doc or session_doc.get("revoked_at") is not None:
        raise AuthenticationError("Session invalid.")
    user_doc = await db[ERECTOR_USERS].find_one({"user_id": user_id})
    if not user_doc:
        raise AuthenticationError("User not found.")

    user = CurrentUser(
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

    # Enforce validation access (404 on cross-user)
    await load_validation(db, validation_id, user)
    return user

