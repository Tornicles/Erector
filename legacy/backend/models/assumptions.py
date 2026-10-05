"""
Assumption schemas.
Collection: assumptions
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, SourceRef, new_id
from .enums import AssumptionCategory, AssumptionStatus, EvidenceType


class Assumption(OwnedDocument):
    """
    An assumption that underpins a validation.
    Created by engines or the user. Bhudhi cannot approve/reject.
    Collection: assumptions
    """
    assumption_id: str = Field(default_factory=new_id)
    validation_id: str
    framework_id: Optional[str] = None
    statement: str
    category: AssumptionCategory = AssumptionCategory.customer
    confidence: float = Field(ge=0.0, le=1.0, default=0.3)
    proof_method: Optional[str] = None
    test_cost: Optional[float] = None
    kill_threshold: Optional[str] = None   # the condition that would kill this assumption
    status: AssumptionStatus = AssumptionStatus.untested
    evidence_ids: list[str] = Field(default_factory=list)
    dependency_ids: list[str] = Field(default_factory=list)
    risk_if_wrong: Optional[str] = None
    source_engine: Optional[str] = None   # EngineName value
    source_ref: Optional[SourceRef] = None
    resolved_at: Optional[datetime] = None
