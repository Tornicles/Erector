"""
User models for A1.
ErectorUser re-exported from PROMPT 0 + new CreateUserInput and UserPublic.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr

from models.users import ErectorUser  # noqa: F401 — re-export
from models.enums import UserType, SubscriptionTier

__all__ = ["ErectorUser", "CreateUserInput", "UserPublic"]


class CreateUserInput(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    user_type: UserType = UserType.individual


class UserPublic(BaseModel):
    """Safe user object to return in API responses — no sensitive fields."""
    user_id: str
    email: str
    full_name: Optional[str] = None
    user_type: UserType
    subscription_tier: SubscriptionTier
    onboarding_completed: bool
    status: str
