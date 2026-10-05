"""
Business Climate schemas.
Collection: business_climates
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import ClimateState


class ClimateFormula(BaseSchema):
    formula_id: str = Field(default_factory=new_id)
    condition: str
    action: str
    expected_outcome: str
    time_to_effect_days: Optional[int] = None


class ClimateMetricsSnapshot(BaseSchema):
    """Snapshot of key metrics at the time of climate assessment."""
    reality_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    execution_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    resource_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    trust_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    momentum_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    risk_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    snapshotted_at: datetime = Field(default_factory=utcnow)


class BusinessClimate(OwnedDocument):
    """
    The current Business Climate state for a validation/framework.
    Deterministic — computed by the climate engine ONLY.
    Bhudhi CANNOT determine climate state.
    Collection: business_climates
    """
    climate_id: str = Field(default_factory=new_id)
    framework_id: Optional[str] = None
    validation_id: str
    # Deterministic state — not set by Bhudhi
    current_climate: ClimateState = ClimateState.blank
    reason: Optional[str] = None
    next_climate: Optional[ClimateState] = None
    transition_probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    transition_timeline: Optional[str] = None
    forecast_30d: Optional[ClimateState] = None
    forecast_90d: Optional[ClimateState] = None
    forecast_180d: Optional[ClimateState] = None
    forecast_365d: Optional[ClimateState] = None
    warnings: list[str] = Field(default_factory=list)
    recovery_formulas: list[ClimateFormula] = Field(default_factory=list)
    advancement_formulas: list[ClimateFormula] = Field(default_factory=list)
    learning_explanation: Optional[str] = None
    metrics_snapshot: Optional[ClimateMetricsSnapshot] = None
