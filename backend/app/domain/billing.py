"""Prompt 10 billing request contracts (§31-47, §54, §75-76).

Three separations are encoded here, because collapsing any of them would be a product lie:

* **estimated provider cost / actual provider cost / what the creator is charged / credits consumed** are
  distinct fields with distinct meanings, and `cost_basis` says which kind of number a row carries. An
  `actual` cost must carry the amount the provider reported; an `unknown` basis may carry no cost at all.
* **What a client may do** is one thing: open a checkout intent and read its own status. Subscribing,
  applying a provider event, granting an entitlement and consuming quota are server-to-server.
* **What a webhook may assert** is bounded by its signature. A payload without a verified signature is
  not commercial evidence and is refused before anything is recorded.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

CostBasis = Literal['actual', 'estimated', 'unknown']


class BillingModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class CheckoutRequest(BillingModel):
    """A workspace administrator opens a checkout intent. Nothing is subscribed by this call."""

    plan_key: str = Field(min_length=1, max_length=80)
    note: str = Field(default='', max_length=600)


class PortalRequest(BillingModel):
    """A workspace administrator asks for the provider's billing portal."""

    note: str = Field(default='', max_length=600)


class UsageRecordRequest(BillingModel):
    """Server-to-server usage ingestion. Idempotent by the caller's key or the provider event it came from."""

    metric: str = Field(min_length=1, max_length=120)
    quantity: float = Field(ge=0)
    unit: str = Field(default='operation', max_length=40)
    idempotency_key: str | None = Field(default=None, max_length=200)
    operation: str = Field(default='', max_length=120)
    provider: str = Field(default='', max_length=60)
    model: str = Field(default='', max_length=120)
    production_id: UUID | None = None
    actor_user_id: UUID | None = None
    provider_cost: float | None = None
    estimated_cost: float | None = None
    price_amount: float | None = None
    credit_units: float = 0
    currency: str = Field(default='USD', min_length=3, max_length=3)
    cost_basis: CostBasis = 'unknown'
    source_event_id: str | None = Field(default=None, max_length=200)
    attempt_id: UUID | None = None

    @model_validator(mode='after')
    def cost_matches_basis(self) -> 'UsageRecordRequest':
        if self.cost_basis == 'actual' and self.provider_cost is None:
            raise ValueError('An actual provider cost must carry the amount the provider reported.')
        if self.cost_basis == 'unknown' and (self.provider_cost is not None or self.estimated_cost is not None):
            raise ValueError('An unknown cost basis carries no cost at all.')
        if self.provider_cost is not None and self.provider_cost < 0:
            raise ValueError('A provider cost cannot be negative.')
        if self.estimated_cost is not None and self.estimated_cost < 0:
            raise ValueError('An estimated cost cannot be negative.')
        if self.price_amount is not None and self.price_amount < 0:
            raise ValueError('A price cannot be negative.')
        if self.credit_units < 0:
            raise ValueError('Credit consumption cannot be negative.')
        return self


class UsageReserveRequest(BillingModel):
    key: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0)
    operation: str = Field(default='', max_length=200)
    note: str = Field(default='', max_length=600)


class UsageCommitRequest(BillingModel):
    reservation_id: UUID
    actual_amount: float | None = Field(default=None, ge=0)
    note: str = Field(default='', max_length=600)


class UsageReleaseRequest(BillingModel):
    reservation_id: UUID
    note: str = Field(default='', max_length=600)


class UsageQuery(BillingModel):
    metric: str | None = Field(default=None, max_length=120)
    provider: str | None = Field(default=None, max_length=60)
    since: datetime | None = None
    limit: int = Field(default=200, ge=1, le=1000)


SubscriptionState = Literal['none', 'trialing', 'active', 'past_due', 'incomplete', 'cancel_at_period_end',
    'cancelled', 'suspended']

# The vocabulary a billing surface shows. A plan that does not exist is never described as if it did.
SUBSCRIPTION_LABELS: dict[str, str] = {
    'none': 'No subscription', 'trialing': 'Trial', 'active': 'Active', 'past_due': 'Past due',
    'incomplete': 'Incomplete', 'cancel_at_period_end': 'Cancels at period end', 'cancelled': 'Cancelled',
    'suspended': 'Suspended',
}
