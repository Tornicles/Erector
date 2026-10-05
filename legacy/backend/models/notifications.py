"""
Notification schemas.
Collections: notifications, notification_tokens
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import BaseSchema, OwnedDocument, new_id, utcnow
from .enums import NotificationType, Platform


class Notification(OwnedDocument):
    """
    A notification sent to a user.
    Collection: notifications
    """
    notification_id: str = Field(default_factory=new_id)
    type: NotificationType
    title: str
    body: str
    data: dict = Field(default_factory=dict)
    channels: list[str] = Field(default_factory=list)  # email | push | sms | in_app
    read_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    delivery_status: str = "pending"  # pending | sent | failed


class NotificationToken(OwnedDocument):
    """
    Push notification device token.
    Collection: notification_tokens
    """
    token_id: str = Field(default_factory=new_id)
    platform: Platform
    push_token: str
    device_id: Optional[str] = None
    active: bool = True
