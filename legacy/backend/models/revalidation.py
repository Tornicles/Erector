"""
Revalidation and Execution Readiness schemas.
Collections: revalidation_events, execution_readiness
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import RevalidationTrigger, RevalidationStatus, ReadinessStatus


class RevalidationChange(BaseSchema):
    field_changed: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    impact: str  # description of change impact


class RevalidationEvent(OwnedDocument):
    """
    Triggered when a validation needs to be re-run due to external changes.
    Collection: revalidation_events
    """
    event_id: str = Field(default_factory=new_id)
    validation_id: str
    trigger_type: RevalidationTrigger
    trigger_source: str
    old_score_id: Optional[str] = None
    new_score_id: Optional[str] = None
    changes: list[RevalidationChange] = Field(default_factory=list)
    impact_analysis: Optional[str] = None
    status: RevalidationStatus = RevalidationStatus.pending


class ReadinessCheck(BaseSchema):
    name: str
    status: ReadinessStatus = ReadinessStatus.not_started
    score: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    required: bool = True
    blocker: bool = False
    notes: Optional[str] = None


class ExecutionReadiness(OwnedDocument):
    """
    Pre-launch readiness checklist for a validation.
    Collection: execution_readiness
    """
    readiness_id: str = Field(default_factory=new_id)
    validation_id: str
    framework_id: Optional[str] = None
    score_percent: float = Field(ge=0.0, le=100.0, default=0.0)
    customer_proof: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="customer_proof"))
    pricing_proof: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="pricing_proof"))
    legal_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="legal_readiness"))
    technical_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="technical_readiness"))
    operational_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="operational_readiness"))
    trust_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="trust_readiness"))
    support_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="support_readiness"))
    security_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="security_readiness"))
    financial_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="financial_readiness"))
    team_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="team_readiness"))
    distribution_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="distribution_readiness"))
    crisis_readiness: ReadinessCheck = Field(default_factory=lambda: ReadinessCheck(name="crisis_readiness"))
    critical_requirements_met: bool = False
    launch_blocked: bool = True
    block_reasons: list[str] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utcnow)
