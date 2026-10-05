"""
Admin Action schemas.
Collection: admin_actions
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import BaseSchema, new_id


class AdminAction(BaseSchema):
    """
    Audit record for all admin-performed actions.
    Collection: admin_actions
    """
    admin_action_id: str = Field(default_factory=new_id)
    admin_user_id: str
    action: str
    target_user_id: Optional[str] = None
    target_entity_type: Optional[str] = None
    target_entity_id: Optional[str] = None
    reason: Optional[str] = None
