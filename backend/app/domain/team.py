"""Team workspace invitation contracts.

An invitation is a single-use token link, never an email: this deployment has
no mail delivery, so the owner/admin shares the link manually and the raw
token is shown exactly once at creation. Ownership is never granted by
invite; only admin, editor, or viewer.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

TEAM_INVITE_ROLES = ('admin', 'editor', 'viewer')
TEAM_INVITE_DEFAULT_EXPIRY_DAYS = 7
TEAM_INVITE_MIN_EXPIRY_DAYS = 1
TEAM_INVITE_MAX_EXPIRY_DAYS = 30


class TeamInviteCreateRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    role: str = 'editor'
    expires_in_days: int = TEAM_INVITE_DEFAULT_EXPIRY_DAYS


class TeamInviteAcceptRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    token: str = Field(min_length=1, max_length=256)
