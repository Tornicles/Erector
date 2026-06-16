"""
Dependency schemas.
Collection: dependencies
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, SourceRef, new_id
from .enums import DependencyType, DependencyStatus, BlockerLevel


class Dependency(OwnedDocument):
    """
    A dependency that must be resolved for the validation to proceed.
    Collection: dependencies
    """
    dependency_id: str = Field(default_factory=new_id)
    validation_id: str
    framework_id: Optional[str] = None
    name: str
    type: DependencyType = DependencyType.technical
    status: DependencyStatus = DependencyStatus.unresolved
    blocker_level: BlockerLevel = BlockerLevel.medium
    unlock_order: Optional[int] = None
    upstream_dependency_ids: list[str] = Field(default_factory=list)
    downstream_dependency_ids: list[str] = Field(default_factory=list)
    owner: Optional[str] = None   # user_id or external entity name
    cost: Optional[float] = None
    timeline: Optional[str] = None
    risk: Optional[str] = None
    fallback: Optional[str] = None
    source_ref: Optional[SourceRef] = None
    resolved_at: Optional[datetime] = None
