"""
Billing schemas — ErectorSubscription, ErectorPayment, UsageCounter.
Collections: erector_subscriptions, erector_payments, usage_counters
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import BaseSchema, OwnedDocument, new_id
from .enums import SubscriptionTier, BillingCycle, SubscriptionStatus, PaymentStatus


class SubscriptionFeatures(BaseSchema):
    validations_per_month: int = 3
    economies_compared: int = 5
    report_packages: int = 1
    api_calls: int = 0
    team_members: int = 1
    simulation_runs: int = 1
    revalidation_enabled: bool = False
    developer_api_enabled: bool = False
    torgima_launch_enabled: bool = False


class SubscriptionLimits(BaseSchema):
    max_validations: int = 3
    max_team_members: int = 1
    max_api_keys: int = 0
    max_webhooks: int = 0
    max_storage_mb: int = 100


class ErectorSubscription(OwnedDocument):
    """
    User subscription record.
    Collection: erector_subscriptions
    """
    subscription_id: str = Field(default_factory=new_id)
    tier: SubscriptionTier = SubscriptionTier.free
    features: SubscriptionFeatures = Field(default_factory=SubscriptionFeatures)
    limits: SubscriptionLimits = Field(default_factory=SubscriptionLimits)
    billing_cycle: BillingCycle = BillingCycle.monthly
    status: SubscriptionStatus = SubscriptionStatus.active
    provider_customer_id: Optional[str] = None
    provider_subscription_id: Optional[str] = None
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None


class ErectorPayment(OwnedDocument):
    """
    Payment record.
    Collection: erector_payments
    """
    payment_id: str = Field(default_factory=new_id)
    amount: float = Field(ge=0.0)
    currency: str = "USD"
    status: PaymentStatus = PaymentStatus.pending
    provider_payment_id: Optional[str] = None
    invoice_url: Optional[str] = None


class UsageCounter(OwnedDocument):
    """
    Tracks usage within a billing period.
    Collection: usage_counters
    """
    usage_id: str = Field(default_factory=new_id)
    period_start: datetime
    period_end: datetime
    validations_used: int = 0
    economies_compared: int = 0
    report_packages_generated: int = 0
    api_calls_used: int = 0
    credits_used: float = 0.0
