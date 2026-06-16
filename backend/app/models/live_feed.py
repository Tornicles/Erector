"""
Live Feed models — Prompt A6
WebSocket and HTTP snapshot/event payloads.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models.base import BaseSchema, utcnow
from models.enums import (
    EngineLiveStatus,
    LiveFeedChannelType,
    LiveFeedEventLevel,
    LiveFeedEventType,
    ValidationStatus,
    WebSocketConnectionStatus,
)


def new_live_event_id() -> str:
    return f"live_{uuid.uuid4()}"


class LiveFeedProgress(BaseModel):
    current_stage: Optional[str] = None
    percent_complete: float = Field(default=0.0, ge=0.0, le=100.0)
    total_engines: int = 27
    engines_pending: int = 0
    engines_running: int = 0
    engines_completed: int = 0
    engines_failed: int = 0
    engines_fallback: int = 0
    current_engine: Optional[str] = None
    message: Optional[str] = None
    updated_at: datetime = Field(default_factory=utcnow)


class EngineLiveFeedItem(BaseModel):
    engine_name: str
    engine_number: int
    status: EngineLiveStatus = EngineLiveStatus.pending
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    execution_time_ms: Optional[int] = None
    fallback_used: bool = False
    error_message: Optional[str] = None
    latest_message: Optional[str] = None
    progress_percent: Optional[float] = Field(default=None, ge=0.0, le=100.0)


class LiveFeedEvent(BaseSchema):
    live_event_id: str = Field(default_factory=new_live_event_id)
    event_type: LiveFeedEventType
    level: LiveFeedEventLevel = LiveFeedEventLevel.info
    validation_id: str
    owner_user_id: str
    team_id: Optional[str] = None
    sequence_number: int = Field(ge=1)
    title: str
    message: str
    payload: dict = Field(default_factory=dict)
    source: str = "system"
    engine_name: Optional[str] = None
    validation_status: Optional[ValidationStatus] = None
    engine_status: Optional[EngineLiveStatus] = None
    progress: Optional[LiveFeedProgress] = None
    timestamp: datetime = Field(default_factory=utcnow)
    replayable: bool = True
    correlation_event_id: Optional[str] = None
    request_id: Optional[str] = None


class ValidationLiveSnapshot(BaseModel):
    validation_id: str
    validation_status: ValidationStatus
    connected_clients: int = 0
    last_sequence_number: int = 0
    progress: LiveFeedProgress = Field(default_factory=LiveFeedProgress)
    engines: list[EngineLiveFeedItem] = Field(default_factory=list)
    latest_events: list[LiveFeedEvent] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=utcnow)


class WebSocketClientInfo(BaseModel):
    connection_id: str
    validation_id: str
    owner_user_id: str
    team_id: Optional[str] = None
    user_agent: Optional[str] = None
    ip_hash: Optional[str] = None
    connected_at: datetime = Field(default_factory=utcnow)
    last_heartbeat_at: datetime = Field(default_factory=utcnow)
    last_sequence_received: Optional[int] = None
    status: WebSocketConnectionStatus = WebSocketConnectionStatus.connected


class WebSocketErrorMessage(BaseModel):
    code: str
    message: str
    details: Optional[dict] = None
    recoverable: bool = True
    close_connection: bool = False


class WebSocketClientMessage(BaseModel):
    type: str
    payload: dict = Field(default_factory=dict)
    client_timestamp: Optional[str] = None


class WebSocketServerMessage(BaseModel):
    type: str
    event: Optional[dict] = None
    snapshot: Optional[dict] = None
    error: Optional[WebSocketErrorMessage] = None
    server_timestamp: datetime = Field(default_factory=utcnow)
    connection_id: str
    sequence_number: Optional[int] = None

