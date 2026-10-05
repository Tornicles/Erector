"""
Assumption seed models — Prompt A4 (extracted from context, not full engine).
"""

from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.models.base import BaseSchema


class AssumptionSeed(BaseSchema):
    assumption_text: str
    category: str = "general"
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    source: str = "context"
    question_id: Optional[str] = None
