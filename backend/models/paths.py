"""
Validation Path schemas — ValidationPath, MinimalProofPlan, MinimalProofDay.
Collection: validation_paths
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import PathType


class MinimalProofDay(BaseSchema):
    day_number: int = Field(ge=1)
    action: str
    expected_output: str
    proof_required: str
    failure_condition: str
    economy_specific_context: Optional[str] = None
    cost: Optional[float] = None


class MinimalProofPlan(BaseSchema):
    """The cheapest/fastest path to prove/kill the riskiest assumption."""
    plan_id: str = Field(default_factory=new_id)
    target_assumption_id: str
    days: list[MinimalProofDay] = Field(default_factory=list)
    total_cost: Optional[float] = None
    kill_decision: str  # what result means "stop"
    success_decision: str  # what result means "continue"


class ConsequenceAnalysis(BaseSchema):
    first_order: list[str] = Field(default_factory=list)
    second_order: list[str] = Field(default_factory=list)
    third_order: list[str] = Field(default_factory=list)


class ValidationPath(OwnedDocument):
    """
    One of 5 possible execution paths generated for a validation.
    Collection: validation_paths
    """
    path_id: str = Field(default_factory=new_id)
    validation_id: str
    path_type: PathType
    title: str
    description: str
    score_projection: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    consequence_analysis: Optional[ConsequenceAnalysis] = None
    required_changes: list[str] = Field(default_factory=list)
    resources_required: list[str] = Field(default_factory=list)
    timeline: Optional[str] = None
    risks: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    minimal_proof_plan: Optional[MinimalProofPlan] = None
    selected: bool = False
    selected_at: Optional[datetime] = None
