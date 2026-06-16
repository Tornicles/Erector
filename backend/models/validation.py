"""
Validation Session schemas — ValidationSession, ValidationProgress, StructuredGoal.
Collection: validation_sessions
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field, ConfigDict
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import (
    ValidationStatus, GoalType, ValidationDepth, UserType,
    VerdictType, VALIDATION_STATE_TRANSITIONS
)


class ValidationProgress(BaseSchema):
    total_engines: int = 27
    engines_completed: int = 0
    engines_failed: int = 0
    engines_fallback: int = 0
    percent_complete: float = 0.0
    current_stage: Optional[str] = None
    live_message: Optional[str] = None


class StructuredGoal(BaseSchema):
    """AI-structured decomposition of the user's raw goal — output of purpose_decomposition engine."""
    problem_claim: Optional[str] = None
    target_user: Optional[str] = None
    value_claim: Optional[str] = None
    change_claim: Optional[str] = None
    contradictions: list[str] = Field(default_factory=list)
    hidden_assumptions: list[str] = Field(default_factory=list)
    clarity_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)


class EngineRunSummary(BaseSchema):
    engine_name: str
    status: str
    score: Optional[float] = None
    execution_time_ms: Optional[int] = None
    fallback_used: bool = False


class ValidationSession(OwnedDocument):
    """
    The central document for an Erector validation run.
    Collection: validation_sessions
    """
    validation_id: str = Field(default_factory=new_id)
    status: ValidationStatus = ValidationStatus.draft
    idempotency_key: Optional[str] = None

    # User's goal
    title: Optional[str] = None
    raw_goal: Optional[str] = None   # encryption_required=True
    goal_type: GoalType = GoalType.business
    validation_depth: ValidationDepth = ValidationDepth.full_deep_validation
    user_type: UserType = UserType.individual

    # Context
    industry: Optional[str] = None
    founder_country: Optional[str] = None
    customer_country: Optional[str] = None
    target_launch_date: Optional[datetime] = None
    budget_range: Optional[str] = None
    currency: str = "USD"
    success_definition: Optional[str] = None
    context_input: Optional[dict] = None

    # Structured results
    structured_goal: Optional[StructuredGoal] = None
    economic_stack_id: Optional[str] = None
    current_score_id: Optional[str] = None
    current_verdict: Optional[VerdictType] = None
    selected_path_id: Optional[str] = None
    current_framework_id: Optional[str] = None
    current_climate_id: Optional[str] = None
    launch_id: Optional[str] = None
    active_simulation_id: Optional[str] = None

    # Progress tracking
    progress: ValidationProgress = Field(default_factory=ValidationProgress)
    engine_run_summary: list[EngineRunSummary] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    failed_reason: Optional[str] = None

    # Timestamps
    last_activity_at: datetime = Field(default_factory=utcnow)
    completed_at: Optional[datetime] = None
    launched_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None

    def can_transition_to(self, new_status: ValidationStatus) -> bool:
        """Enforce legal state machine transitions."""
        current = self.status if isinstance(self.status, str) else self.status.value
        allowed = VALIDATION_STATE_TRANSITIONS.get(current, [])
        next_val = new_status if isinstance(new_status, str) else new_status.value
        return next_val in allowed

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        use_enum_values=True,
        json_schema_extra={"encrypted_fields": ["raw_goal"]},
    )
