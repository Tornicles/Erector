"""
Validation Lifecycle Models — Prompt A3
API request/response models and ValidationSession document for lifecycle control.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.base import BaseSchema, utcnow
from app.models.enums import (
    GoalType,
    UserType,
    ValidationDepth,
    ValidationStatus,
    VerdictType,
)
from models.base import OwnedDocument


def new_validation_id() -> str:
    """Stable domain ID: val_<uuid>."""
    return f"val_{uuid.uuid4()}"


def new_idempotency_record_id() -> str:
    return f"idem_rec_{uuid.uuid4()}"


# ── Nested structures ─────────────────────────────────────────────────────────

class ValidationProgress(BaseSchema):
    total_engines: int = 27
    engines_completed: int = 0
    engines_failed: int = 0
    engines_fallback: int = 0
    percent_complete: float = Field(default=0.0, ge=0.0, le=100.0)
    current_stage: Optional[str] = None
    live_message: Optional[str] = None
    updated_at: Optional[datetime] = None


class EngineRunSummary(BaseSchema):
    queued_count: int = 0
    running_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    fallback_count: int = 0
    skipped_count: int = 0
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ValidationStateHistoryEntry(BaseSchema):
    from_status: ValidationStatus
    to_status: ValidationStatus
    reason: str
    actor_type: str = "user"
    actor_id: Optional[str] = None
    event_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=utcnow)
    metadata: dict = Field(default_factory=dict)


class ValidationHealthStatus(BaseSchema):
    status: ValidationStatus
    is_stuck: bool = False
    stuck_reason: Optional[str] = None
    idle_seconds: int = 0
    last_activity_at: Optional[datetime] = None
    checked_at: datetime = Field(default_factory=utcnow)


# ── Document models ───────────────────────────────────────────────────────────

class ValidationSession(OwnedDocument):
    """Central validation run document. Collection: validation_sessions."""

    validation_id: str = Field(default_factory=new_validation_id)
    status: ValidationStatus = ValidationStatus.draft
    idempotency_key: Optional[str] = None

    title: Optional[str] = None
    raw_goal: Optional[str] = None
    goal_type: GoalType = GoalType.business
    validation_depth: ValidationDepth = ValidationDepth.full_deep_validation
    user_type: UserType = UserType.individual

    industry: Optional[str] = None
    founder_country: Optional[str] = None
    customer_country: Optional[str] = None
    target_launch_date: Optional[datetime] = None
    budget_range: Optional[str] = None
    currency: str = "USD"
    success_definition: Optional[str] = None
    context_input: Optional[dict] = None
    structured_goal: Optional[dict] = None

    economic_stack_id: Optional[str] = None
    current_score_id: Optional[str] = None
    current_verdict: Optional[VerdictType] = None
    selected_path_id: Optional[str] = None
    current_framework_id: Optional[str] = None
    current_climate_id: Optional[str] = None
    launch_id: Optional[str] = None
    active_simulation_id: Optional[str] = None

    progress: ValidationProgress = Field(default_factory=ValidationProgress)
    engine_run_summary: EngineRunSummary = Field(default_factory=EngineRunSummary)
    blockers: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    failed_reason: Optional[str] = None
    failure_code: Optional[str] = None

    state_history: list[ValidationStateHistoryEntry] = Field(default_factory=list)
    event_ids: list[str] = Field(default_factory=list)
    last_activity_at: datetime = Field(default_factory=utcnow)
    completed_at: Optional[datetime] = None
    launched_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None


class IdempotencyRecord(BaseSchema):
    """Stored in validation_idempotency_keys collection."""

    idempotency_record_id: str = Field(default_factory=new_idempotency_record_id)
    idempotency_key: str
    owner_user_id: str
    anonymous_fingerprint: Optional[str] = None
    request_hash: str
    validation_id: Optional[str] = None
    status: str = "pending"
    expires_at: Optional[datetime] = None


# ── API request/response models ───────────────────────────────────────────────

class CreateValidationRequest(BaseModel):
    raw_goal: str
    title: Optional[str] = None
    goal_type: Optional[GoalType] = None
    validation_depth: Optional[ValidationDepth] = None
    industry: Optional[str] = None
    founder_country: Optional[str] = None
    customer_country: Optional[str] = None
    target_launch_date: Optional[datetime] = None
    budget_range: Optional[str] = None
    currency: Optional[str] = None
    success_definition: Optional[str] = None
    idempotency_key: Optional[str] = None
    team_id: Optional[str] = None
    metadata: Optional[dict] = None

    @field_validator("raw_goal")
    @classmethod
    def raw_goal_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("raw_goal is required")
        return v.strip()


class CreateValidationResponse(BaseModel):
    validation_id: str
    status: ValidationStatus
    idempotency_key: str
    created: bool
    existing: bool
    validation: dict


class ValidationDetailResponse(BaseModel):
    validation: dict
    allowed_next_states: list[str]
    latest_events: list[dict]
    health_status: ValidationHealthStatus


class TransitionValidationRequest(BaseModel):
    next_status: ValidationStatus
    reason: str
    metadata: Optional[dict] = None


class TransitionValidationResponse(BaseModel):
    validation_id: str
    previous_status: ValidationStatus
    current_status: ValidationStatus
    transitioned: bool
    reason: str
    event_id: Optional[str] = None


class FailValidationRequest(BaseModel):
    reason: str
    error_code: Optional[str] = None
    metadata: Optional[dict] = None


class ValidationListFilters(BaseModel):
    status: Optional[ValidationStatus] = None
    team_id: Optional[str] = None
    search: Optional[str] = None
    created_after: Optional[datetime] = None
    created_before: Optional[datetime] = None
    page: int = 1
    page_size: int = 20


class RequestContext(BaseModel):
    """HTTP request context for audit and idempotency."""

    request_id: Optional[str] = None
    ip_hash: Optional[str] = None
    user_agent: Optional[str] = None
    idempotency_header: Optional[str] = None
