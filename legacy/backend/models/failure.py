"""
Failure Architecture schemas.
Collection: failure_architectures
"""

from __future__ import annotations
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id
from .enums import FailureCategory, RiskSeverity


class FailureNode(BaseSchema):
    """A node in the failure cascade tree."""
    node_id: str = Field(default_factory=new_id)
    title: str
    description: str
    trigger: str
    probability: float = Field(ge=0.0, le=1.0)
    impact: float = Field(ge=0.0, le=10.0)
    parent_node_ids: list[str] = Field(default_factory=list)
    child_node_ids: list[str] = Field(default_factory=list)
    recovery_action: Optional[str] = None


class CascadePath(BaseSchema):
    path_id: str = Field(default_factory=new_id)
    trigger_node_id: str
    cascade_sequence: list[str] = Field(default_factory=list)  # ordered node_ids
    probability: float = Field(ge=0.0, le=1.0)
    terminal_outcome: str
    recovery_window_days: Optional[int] = None


class RecoveryPath(BaseSchema):
    recovery_id: str = Field(default_factory=new_id)
    title: str
    required_resources: list[str] = Field(default_factory=list)
    timeline_days: int = 30
    success_probability: float = Field(ge=0.0, le=1.0)
    steps: list[str] = Field(default_factory=list)


class FailureArchitecture(OwnedDocument):
    """
    Maps how a validation could fail — root causes, cascades, outcomes, recovery.
    Collection: failure_architectures
    """
    failure_architecture_id: str = Field(default_factory=new_id)
    validation_id: str
    root_causes: list[FailureNode] = Field(default_factory=list)
    failure_events: list[FailureNode] = Field(default_factory=list)
    cascade_paths: list[CascadePath] = Field(default_factory=list)
    outcomes: list[str] = Field(default_factory=list)
    recovery_paths: list[RecoveryPath] = Field(default_factory=list)
    probability_score: float = Field(ge=0.0, le=1.0, default=0.3)
    timeline: Optional[str] = None
