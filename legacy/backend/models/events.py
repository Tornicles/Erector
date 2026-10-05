"""
World Events and System Event Bus schemas.
Collections: world_events, system_events, dead_letter_queue
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import BaseSchema, OwnedDocument, new_id, utcnow
from .enums import WorldEventCategory, WebhookEventType, SystemEventStatus, DeadLetterStatus


class WorldEvent(BaseSchema):
    """
    An external world event detected that may affect validations.
    Global reference — no owner_user_id.
    Collection: world_events
    """
    event_id: str = Field(default_factory=new_id)
    economy_id: Optional[str] = None
    category: WorldEventCategory
    title: str
    description: str
    impact_score: float = Field(ge=0.0, le=10.0, default=5.0)
    relevance_score: float = Field(ge=0.0, le=1.0, default=0.5)
    affected_engines: list[str] = Field(default_factory=list)
    affected_validations: list[str] = Field(default_factory=list)
    source: Optional[str] = None
    detected_at: datetime = Field(default_factory=utcnow)


class SystemEvent(BaseSchema):
    """
    Internal event bus record for async processing.
    Collection: system_events
    """
    event_id: str = Field(default_factory=new_id)
    event_type: str  # ValidationEventType or WebhookEventType value
    entity_type: str
    entity_id: str
    owner_user_id: Optional[str] = None
    payload: dict = Field(default_factory=dict)
    status: SystemEventStatus = SystemEventStatus.pending
    emitted_at: datetime = Field(default_factory=utcnow)
    processed_at: Optional[datetime] = None


class DeadLetterQueue(BaseSchema):
    """
    Failed events that need manual investigation or retry.
    Collection: dead_letter_queue
    """
    dead_letter_id: str = Field(default_factory=new_id)
    original_event_id: str
    event_type: str
    payload: dict = Field(default_factory=dict)
    failure_reason: str
    attempts: int = 0
    next_retry_at: Optional[datetime] = None
    status: DeadLetterStatus = DeadLetterStatus.pending
