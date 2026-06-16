"""
Auth schemas — ErectorSession, MagicLinkAttempt.
Collection: erector_sessions, magic_link_attempts
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import BaseSchema, new_id, utcnow
from .enums import Platform


class ErectorSession(BaseSchema):
    """Represents an authenticated user session."""
    session_id: str = Field(default_factory=new_id)
    user_id: str
    access_token_hash: str
    refresh_token_hash: str
    expires_at: datetime
    refresh_expires_at: datetime
    device_id: Optional[str] = None
    platform: Platform = Platform.web
    ip_hash: Optional[str] = None
    user_agent: Optional[str] = None
    revoked_at: Optional[datetime] = None


class MagicLinkAttempt(BaseSchema):
    """Tracks magic link email send attempts for rate limiting and security."""
    attempt_id: str = Field(default_factory=new_id)
    email_hash: str
    destination_email: str  # encryption_required=True
    token_hash: str
    expires_at: datetime
    consumed_at: Optional[datetime] = None
    ip_hash: Optional[str] = None
    user_agent: Optional[str] = None
    # encryption_required marker for sensitive field
    encryption_required: bool = Field(default=True, exclude=True)
