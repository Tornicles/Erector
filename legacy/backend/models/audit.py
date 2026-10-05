"""
Audit Log schemas.
All create/update/delete operations must produce an audit log.
Collection: audit_logs
"""

from __future__ import annotations
from typing import Any, Optional
from pydantic import Field
from .base import BaseSchema, new_id


class AuditLog(BaseSchema):
    """
    Immutable audit trail for all mutable operations.
    Required for every create, update, delete action.
    Collection: audit_logs
    """
    audit_id: str = Field(default_factory=new_id)
    owner_user_id: Optional[str] = None   # the data owner
    actor_user_id: str                     # who performed the action
    team_id: Optional[str] = None
    action: str   # create | update | delete | view | export | share | revoke
    entity_type: str
    entity_id: str
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    ip_hash: Optional[str] = None
    user_agent: Optional[str] = None
