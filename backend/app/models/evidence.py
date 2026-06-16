"""
Evidence stub models — Prompt A4 (intake references only).
"""

from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.models.base import BaseSchema
from models.enums import EvidenceClaimType, EvidenceType


class EvidenceStub(BaseSchema):
    evidence_id: Optional[str] = None
    claim_type: EvidenceClaimType
    evidence_type: EvidenceType = EvidenceType.anecdotal
    description: str
    source_url: Optional[str] = None
    file_reference: Optional[str] = None
    freshness: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
