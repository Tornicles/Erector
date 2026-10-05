"""
Torgima Launch schemas — LaunchPackage, TorgimaLaunchPayload.
Collection: launch_packages
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import TorgimaStatus


class TorgimaLaunchPayload(BaseSchema):
    """
    The exact payload sent to Torgima for workspace launch.
    All required fields must be present before launch.
    """
    erector_validation_id: str
    erector_version: str = "1.0.0"
    launched_at: datetime = Field(default_factory=utcnow)
    user_email: str
    goal: str
    purpose: str
    reality_score: float = Field(ge=0.0, le=10.0)
    validation_confidence: float = Field(ge=0.0, le=1.0)
    verdict: str   # VerdictType value — must be present
    economy_context: dict    # must include primary economy details
    business_climate: str    # ClimateState value — must be present
    reality_framework: dict  # must be present
    assumptions: list[dict]  # must be non-empty
    dependencies: list[dict] # must be non-empty
    risks: list[dict]        # must be non-empty
    team_structure: dict
    launch_package: dict     # final launch package details


class LaunchPackage(OwnedDocument):
    """
    The launch record for a validation going to Torgima.
    Collection: launch_packages
    """
    launch_id: str = Field(default_factory=new_id)
    validation_id: str
    framework_id: Optional[str] = None
    payload: Optional[TorgimaLaunchPayload] = None
    torgima_status: TorgimaStatus = TorgimaStatus.pending
    torgima_workspace_id: Optional[str] = None
    sent_at: Optional[datetime] = None
    response: Optional[dict] = None
    error: Optional[str] = None
    retry_count: int = 0
    last_retry_at: Optional[datetime] = None
