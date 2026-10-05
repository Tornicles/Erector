"""
Auth request/response models for A1.
SessionDocument extends the PROMPT 0 ErectorSession contract.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from models.base import BaseSchema, new_id, utcnow
from models.enums import Platform, UserType, SubscriptionTier


# ── Request Models ────────────────────────────────────────────────────────────

class MagicLinkRequest(BaseModel):
    email: EmailStr


class VerifyMagicLinkRequest(BaseModel):
    token: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None
    session_id: Optional[str] = None


# ── Response Models ───────────────────────────────────────────────────────────

class MagicLinkResponse(BaseModel):
    message: str
    email: str
    expires_in_minutes: int = 15
    # Only included in DEBUG mode — never in production
    mock_token: Optional[str] = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int          # seconds
    refresh_expires_in: int  # seconds


# ── Document Models ───────────────────────────────────────────────────────────

class SessionDocument(BaseSchema):
    """Stored in erector_sessions collection."""
    session_id: str = Field(default_factory=new_id)
    user_id: str
    access_token_hash: str    # never store plaintext
    refresh_token_hash: str   # never store plaintext
    expires_at: datetime
    refresh_expires_at: datetime
    device_id: Optional[str] = None
    platform: Platform = Platform.web
    ip_hash: Optional[str] = None
    user_agent: Optional[str] = None
    revoked_at: Optional[datetime] = None


class MagicLinkAttemptDocument(BaseSchema):
    """Stored in magic_link_attempts collection."""
    attempt_id: str = Field(default_factory=new_id)
    email_hash: str
    token_hash: str           # sha256 of the raw token
    expires_at: datetime
    consumed_at: Optional[datetime] = None
    ip_hash: Optional[str] = None
    user_agent: Optional[str] = None


# ── Current User (from JWT decode + DB lookup) ────────────────────────────────

class CurrentUser(BaseModel):
    user_id: str
    email: str
    user_type: UserType = UserType.individual
    subscription_tier: SubscriptionTier = SubscriptionTier.free
    team_ids: list[str] = Field(default_factory=list)
    is_admin: bool = False
    session_id: str
