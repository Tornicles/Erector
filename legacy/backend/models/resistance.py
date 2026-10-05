"""
Resistance Force schemas.
Collection: resistance_forces
"""

from __future__ import annotations
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, new_id
from .enums import ResistanceCategory


class ResistanceForce(OwnedDocument):
    """
    A systemic resistance force against a validation/execution.
    Collection: resistance_forces
    """
    resistance_id: str = Field(default_factory=new_id)
    validation_id: str
    category: ResistanceCategory = ResistanceCategory.market
    name: str
    severity_score: float = Field(ge=0.0, le=10.0, default=5.0)
    timing_estimate: Optional[str] = None  # immediate | near_term | medium_term | long_term
    mitigation_strategy: Optional[str] = None
    cost_to_overcome: Optional[float] = None
    canvas_object_id: Optional[str] = None
    source_engine: Optional[str] = None   # EngineName value
