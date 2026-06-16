"""
Evidence schemas.
Collection: evidences
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, new_id
from .enums import EvidenceType


class Evidence(OwnedDocument):
    """
    Evidence that supports or contradicts an assumption.
    Collection: evidences
    """
    evidence_id: str = Field(default_factory=new_id)
    validation_id: str
    assumption_id: Optional[str] = None
    evidence_type: EvidenceType = EvidenceType.anecdotal
    title: str
    description: Optional[str] = None
    file_url: Optional[str] = None
    external_url: Optional[str] = None
    freshness: Optional[str] = None  # current | recent | dated | unknown
    reliability_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    confidence_impact: Optional[float] = Field(default=None, ge=-1.0, le=1.0)
    submitted_by: str  # user_id
    reviewed_by_engine: Optional[str] = None  # EngineName value
