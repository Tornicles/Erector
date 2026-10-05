"""
Analytics Event schemas.
Collection: analytics_events
"""

from __future__ import annotations
from typing import Any, Optional
from pydantic import Field
from .base import BaseSchema, new_id


class AnalyticsEvent(BaseSchema):
    """
    Tracks user and system events for product analytics.
    Collection: analytics_events
    """
    analytics_event_id: str = Field(default_factory=new_id)
    owner_user_id: Optional[str] = None
    team_id: Optional[str] = None
    event_name: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    properties: dict = Field(default_factory=dict)
