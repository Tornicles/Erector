"""
Engine Output Contract schemas — EngineOutput, Risk, Opportunity, Source.
Collection: engine_outputs
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, SourceRef, new_id, utcnow
from .enums import EngineName, EngineStatus, RiskSeverity


class Source(BaseSchema):
    """Evidence source referenced by an engine."""
    source_id: str = Field(default_factory=new_id)
    source_type: str  # web | paper | database | primary_research | internal
    title: str
    url: Optional[str] = None
    citation: Optional[str] = None
    freshness: Optional[str] = None  # current | recent | dated | unknown
    reliability_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    accessed_at: Optional[datetime] = None


class Risk(BaseSchema):
    """A risk identified by an engine."""
    risk_id: str = Field(default_factory=new_id)
    name: str
    category: str
    severity: RiskSeverity = RiskSeverity.medium
    probability: float = Field(ge=0.0, le=1.0, default=0.5)
    impact: float = Field(ge=0.0, le=10.0, default=5.0)
    timeframe: Optional[str] = None  # immediate | near_term | medium_term | long_term
    description: str
    mitigation: Optional[str] = None
    cascade_potential: bool = False
    source_engine: Optional[str] = None   # EngineName value
    evidence_refs: list[str] = Field(default_factory=list)


class Opportunity(BaseSchema):
    """An opportunity identified by an engine."""
    opportunity_id: str = Field(default_factory=new_id)
    name: str
    category: str
    size_score: float = Field(ge=0.0, le=10.0, default=5.0)
    timing: Optional[str] = None
    effort_required: Optional[str] = None  # low | medium | high | very_high
    competition_level: Optional[str] = None  # low | medium | high | saturated
    expiration_window: Optional[str] = None
    capture_action: Optional[str] = None
    source_engine: Optional[str] = None   # EngineName value
    evidence_refs: list[str] = Field(default_factory=list)


class EngineOutput(OwnedDocument):
    """
    Output contract for all 27 Erector engines.
    Every engine MUST produce this shape.
    Bhudhi CANNOT write score, verdict, or economy profile.
    Collection: engine_outputs
    """
    engine_output_id: str = Field(default_factory=new_id)
    validation_id: str
    engine_name: EngineName
    engine_number: int = Field(ge=1, le=27)
    status: EngineStatus = EngineStatus.pending

    # Core deterministic outputs — must NOT be written by Bhudhi
    score: float = Field(ge=0.0, le=10.0, default=0.0)
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)

    # Structured findings
    findings: list[str] = Field(default_factory=list)
    risks: list[Risk] = Field(default_factory=list)
    opportunities: list[Opportunity] = Field(default_factory=list)
    assumptions_created: list[str] = Field(default_factory=list)   # assumption_ids
    dependencies_created: list[str] = Field(default_factory=list)  # dependency_ids
    recommendations: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    economy_context: Optional[dict] = None

    # Execution metadata
    input_snapshot: Optional[dict] = None
    output_payload: Optional[dict] = None
    fallback_used: bool = False
    fallback_reason: Optional[str] = None
    execution_time_ms: int = 0
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None

    # Source tracking
    source_ref: Optional[SourceRef] = None
