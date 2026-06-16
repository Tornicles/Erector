"""
Audit Log Models — Prompt A3
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from app.models.base import BaseSchema, utcnow


def new_audit_id() -> str:
    return f"aud_{uuid.uuid4()}"


class AuditLog(BaseSchema):
    """Immutable audit trail. Collection: audit_logs."""

    audit_id: str = Field(default_factory=new_audit_id)
    owner_user_id: Optional[str] = None
    actor_user_id: str
    team_id: Optional[str] = None
    action: str
    entity_type: str
    entity_id: str
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    ip_hash: Optional[str] = None
    user_agent: Optional[str] = None
    request_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
