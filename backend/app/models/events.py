"""
System Event and Dead Letter Queue Models — Prompt A3
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from app.models.base import BaseSchema, utcnow
from models.enums import DeadLetterStatus, SystemEventStatus, ValidationEventType


def new_event_id() -> str:
    return f"evt_{uuid.uuid4()}"


def new_dead_letter_id() -> str:
    return f"dlq_{uuid.uuid4()}"


class SystemEvent(BaseSchema):
    """Internal event bus record. Collection: system_events."""

    event_id: str = Field(default_factory=new_event_id)
    event_type: str
    entity_type: str
    entity_id: str
    validation_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    team_id: Optional[str] = None
    payload: dict = Field(default_factory=dict)
    status: SystemEventStatus = SystemEventStatus.pending
    emitted_at: datetime = Field(default_factory=utcnow)
    processed_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    failure_reason: Optional[str] = None
    attempts: int = 0
    next_retry_at: Optional[datetime] = None


class DeadLetterQueueItem(BaseSchema):
    """Failed events for manual investigation. Collection: dead_letter_queue."""

    dead_letter_id: str = Field(default_factory=new_dead_letter_id)
    original_event_id: str
    event_type: str
    entity_type: str
    entity_id: str
    validation_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    payload: dict = Field(default_factory=dict)
    failure_reason: str
    attempts: int = 0
    status: DeadLetterStatus = DeadLetterStatus.open
    next_retry_at: Optional[datetime] = None


# Re-export for convenience
EventStatus = SystemEventStatus

__all__ = [
    "SystemEvent",
    "DeadLetterQueueItem",
    "ValidationEventType",
    "SystemEventStatus",
    "EventStatus",
    "new_event_id",
    "new_dead_letter_id",
]
