"""
Developer API schemas — ErectorApiKey, DeveloperWebhook, WebhookDelivery.
Collections: erector_api_keys, developer_webhooks, webhook_deliveries
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import BaseSchema, OwnedDocument, new_id
from .enums import WebhookEventType, DeliveryStatus


class ErectorApiKey(OwnedDocument):
    """
    Developer API key. Key hash stored — never plaintext.
    Collection: erector_api_keys
    """
    api_key_id: str = Field(default_factory=new_id)
    key_hash: str   # bcrypt/sha256 hash — never store plaintext
    name: str
    scopes: list[str] = Field(default_factory=list)
    rate_limit_tier: str = "standard"  # standard | premium | enterprise
    monthly_credit_limit: Optional[int] = None
    usage_count: int = 0
    active: bool = True
    last_used_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class DeveloperWebhook(OwnedDocument):
    """
    A webhook endpoint registered by a developer.
    Collection: developer_webhooks
    """
    webhook_id: str = Field(default_factory=new_id)
    url: str
    event_filters: list[str] = Field(default_factory=list)  # WebhookEventType values
    secret_hash: str   # HMAC secret — never store plaintext
    active: bool = True
    failure_count: int = 0
    last_delivery_at: Optional[datetime] = None


class WebhookDelivery(BaseSchema):
    """
    Record of a webhook delivery attempt.
    Collection: webhook_deliveries
    """
    delivery_id: str = Field(default_factory=new_id)
    webhook_id: str
    event_type: str  # WebhookEventType value
    payload: dict = Field(default_factory=dict)
    signature: Optional[str] = None
    status: DeliveryStatus = DeliveryStatus.pending
    attempt_count: int = 0
    next_retry_at: Optional[datetime] = None
    response_status: Optional[int] = None
    response_body: Optional[str] = None
