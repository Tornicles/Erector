"""
User schemas — ErectorUser, NotificationPreferences, OnboardingState.
Collection: erector_users
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field, ConfigDict
from .base import BaseSchema, OwnedDocument, new_id, utcnow
from .enums import (
    UserType, ExperienceLevel, GoalType, SubscriptionTier,
    ValidationDepth, UserStatus, NotificationType
)


class NotificationPreferences(BaseSchema):
    model_config = None  # inherit parent config

    email_enabled: bool = True
    push_enabled: bool = True
    sms_enabled: bool = False
    enabled_types: list[str] = Field(default_factory=lambda: [t.value for t in NotificationType])
    quiet_hours_start: Optional[str] = None   # HH:MM UTC
    quiet_hours_end: Optional[str] = None


class OnboardingState(BaseSchema):
    completed_steps: list[str] = Field(default_factory=list)
    current_step: Optional[str] = None
    skipped_steps: list[str] = Field(default_factory=list)


class ErectorUser(BaseSchema):
    """
    Core user document.
    Collection: erector_users
    Protected field: email — encryption_required=True
    """
    user_id: str = Field(default_factory=new_id)
    email: str   # encryption_required=True — never expose raw in public listings
    email_verified: bool = False
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    user_type: UserType = UserType.individual
    experience_level: ExperienceLevel = ExperienceLevel.first_venture
    default_goal_type: GoalType = GoalType.business
    subscription_tier: SubscriptionTier = SubscriptionTier.free
    onboarding_completed: bool = False
    onboarding_state: OnboardingState = Field(default_factory=OnboardingState)
    preferred_founder_country: Optional[str] = None
    preferred_customer_country: Optional[str] = None
    preferred_industry: Optional[str] = None
    default_validation_depth: ValidationDepth = ValidationDepth.full_deep_validation
    notification_preferences: NotificationPreferences = Field(
        default_factory=NotificationPreferences
    )
    billing_customer_id: Optional[str] = None
    active_team_ids: list[str] = Field(default_factory=list)
    last_login_at: Optional[datetime] = None
    status: UserStatus = UserStatus.active
    data_deletion_requested_at: Optional[datetime] = None

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        use_enum_values=True,
        json_schema_extra={"encrypted_fields": ["email"]},
    )
