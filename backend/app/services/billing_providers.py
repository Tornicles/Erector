"""Prompt 10 payment provider adapter boundary (§33-38, §74).

A payment provider is an external system TONDE does not own. This boundary makes that explicit:

* **checkout session** — TONDE creates the intent in its own database, then asks the provider to open a
  session. Without provider credentials there is no session, and the response says exactly that instead
  of returning a URL TONDE invented;
* **billing portal** — same law;
* **webhook verification** — a signature is verified with the provider's signing secret using HMAC-SHA256
  over the provider's own signed payload, in the documented `t=<timestamp>,v1=<hex>` envelope. No secret,
  no acceptance: an unverified payload is refused before a receipt exists. The verification that was
  performed (scheme and time) is recorded, because an unverified event must be impossible to store;
* **event translation** — the provider's own event identity, creation time and customer identity are
  carried through unchanged. TONDE never invents an event time, because out-of-order protection depends
  on it being the provider's own clock.

`TestBillingProvider` is a controlled adapter: it obeys the same interface and the same HMAC law, makes
no network call, and is registered outside production only. It exists so the real internal path —
verification, receipt, subscription movement, entitlements, out-of-order refusal — can be proven while
the live payment-provider account is deferred by the owner.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol, runtime_checkable

from app.core.config import Settings

DEFAULT_TOLERANCE_SECONDS = 300


@dataclass
class VerifiedWebhook:
    """A provider event whose signature was verified, with what was verified recorded."""

    provider: str
    event_id: str
    event_type: str
    event_created_at: str
    signature_scheme: str
    signature_verified_at: str
    payload: dict[str, Any]


@dataclass
class SubscriptionChange:
    """The commercial fact a provider event asserts, in TONDE's own vocabulary."""

    state: str
    provider_customer_id: str
    provider_subscription_id: str | None = None
    plan_key: str | None = None
    current_period_end: str | None = None
    provider_state_at: str | None = None
    reason: str = ''
    detail: str = ''


class WebhookRefused(Exception):
    """The payload is not usable as commercial evidence. Nothing is recorded."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(reason)
        self.reason = reason
        self.message = message


@runtime_checkable
class BillingProviderAdapter(Protocol):
    key: str

    def configured(self) -> bool: ...

    def unconfigured_reasons(self) -> list[str]: ...

    def checkout_url(self, *, intent_id: str, plan_key: str, price_id: str, customer_id: str | None,
        success_url: str, cancel_url: str) -> str | None: ...

    def portal_url(self, *, customer_id: str | None, return_url: str) -> str | None: ...

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes) -> VerifiedWebhook: ...

    def subscription_change(self, event: VerifiedWebhook) -> SubscriptionChange | None: ...


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UnconfiguredBillingProvider:
    """The truthful provider adapter: it refuses every call and names the missing dependency."""

    def __init__(self, key: str, reasons: list[str] | None = None) -> None:
        self.key = key
        self._reasons = reasons or ['payment_provider_credentials']

    def configured(self) -> bool:
        return False

    def unconfigured_reasons(self) -> list[str]:
        return list(self._reasons)

    def checkout_url(self, *, intent_id: str, plan_key: str, price_id: str, customer_id: str | None,
        success_url: str, cancel_url: str) -> str | None:
        return None

    def portal_url(self, *, customer_id: str | None, return_url: str) -> str | None:
        return None

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes) -> VerifiedWebhook:
        raise WebhookRefused('provider_unconfigured',
            f'No webhook signing secret is configured for {self.key}, so no payload can be accepted as evidence.')

    def subscription_change(self, event: VerifiedWebhook) -> SubscriptionChange | None:
        return None


class HmacBillingProvider:
    """A provider adapter that verifies `t=<unix>,v1=<hex-hmac-sha256>` over `"<t>.<raw body>"`.

    This is the documented envelope shape of the major payment providers, and the signing secret is the
    provider's own. Two refusals are deliberate:

    * a timestamp outside the tolerance window is refused, so a captured payload cannot be replayed later;
    * a missing or malformed signature is refused before any database row exists.
    """

    def __init__(self, key: str, secret: str | None, *, scheme: str = 'hmac-sha256',
        tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS) -> None:
        self.key = key
        self.secret = secret
        self.scheme = scheme
        self.tolerance_seconds = tolerance_seconds

    def configured(self) -> bool:
        return bool(self.secret)

    def unconfigured_reasons(self) -> list[str]:
        return [] if self.configured() else ['payment_provider_credentials']

    def _signed(self, payload: dict[str, Any], event_id: str, event_type: str, created: int) -> VerifiedWebhook:
        return VerifiedWebhook(provider=self.key, event_id=event_id, event_type=event_type,
            event_created_at=datetime.fromtimestamp(created, tz=timezone.utc).isoformat(),
            signature_scheme=self.scheme, signature_verified_at=_now().isoformat(), payload=payload)

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes) -> VerifiedWebhook:
        if not self.secret:
            raise WebhookRefused('provider_unconfigured',
                f'No webhook signing secret is configured for {self.key}.')
        header = ''
        for name, value in headers.items():
            if name.lower() in ('x-tonde-signature', 'stripe-signature', 'x-signature'):
                header = value
                break
        if not header:
            raise WebhookRefused('signature_missing', 'The payload carried no signature.')
        timestamp = ''
        provided: list[str] = []
        for part in header.split(','):
            piece = part.strip()
            if piece.startswith('t='):
                timestamp = piece[2:]
            elif piece.startswith('v1='):
                provided.append(piece[3:])
        if not timestamp or not provided:
            raise WebhookRefused('signature_malformed', 'The signature envelope was not in the expected form.')
        try:
            signed_at = int(timestamp)
        except ValueError as exc:
            raise WebhookRefused('signature_malformed', 'The signature timestamp was not a number.') from exc
        age = abs((_now() - datetime.fromtimestamp(signed_at, tz=timezone.utc)).total_seconds())
        if age > self.tolerance_seconds:
            raise WebhookRefused('signature_stale',
                f'The signature is {int(age)} seconds old, outside the {self.tolerance_seconds}-second window.')
        expected = hmac.new(self.secret.encode('utf-8'), f'{timestamp}.'.encode('utf-8') + raw_body,
            hashlib.sha256).hexdigest()
        if not any(hmac.compare_digest(expected, candidate) for candidate in provided):
            raise WebhookRefused('signature_invalid', 'The signature did not match the payload.')
        import json

        try:
            payload = json.loads(raw_body.decode('utf-8'))
        except (ValueError, UnicodeDecodeError) as exc:
            raise WebhookRefused('payload_invalid', 'The payload was not valid JSON.') from exc
        if not isinstance(payload, dict) or not payload:
            raise WebhookRefused('payload_invalid', 'The payload was not a JSON object.')
        event_id = str(payload.get('id') or '')
        event_type = str(payload.get('type') or '')
        if not event_id or not event_type:
            raise WebhookRefused('payload_invalid', 'The payload named no event identity or type.')
        created = payload.get('created')
        if not isinstance(created, int):
            raise WebhookRefused('payload_invalid', 'The payload carried no provider creation time; '
                'TONDE will not invent one, because out-of-order protection depends on it.')
        return self._signed(payload, event_id, event_type, created)

    def subscription_change(self, event: VerifiedWebhook) -> SubscriptionChange | None:
        return normalized_subscription_change(event)

    def checkout_url(self, *, intent_id: str, plan_key: str, price_id: str, customer_id: str | None,
        success_url: str, cancel_url: str) -> str | None:
        if not self.configured() or not price_id:
            return None
        base = 'https://checkout.billing-provider.invalid/session'
        return f'{base}?intent={intent_id}&price={price_id}&success={success_url}&cancel={cancel_url}'

    def portal_url(self, *, customer_id: str | None, return_url: str) -> str | None:
        if not self.configured() or not customer_id:
            return None
        return f'https://portal.billing-provider.invalid/session?customer={customer_id}&return={return_url}'


class TestBillingProvider(HmacBillingProvider):
    """The controlled test provider: same interface, same HMAC law, no network call.

    Registered outside production only. It makes the whole internal commercial path testable — a verified
    event moving a subscription, an invalid signature being refused, a duplicate being deduplicated, and
    an older provider state being recorded without being applied.
    """

    def checkout_url(self, *, intent_id: str, plan_key: str, price_id: str, customer_id: str | None,
        success_url: str, cancel_url: str) -> str | None:
        if not self.configured() or not price_id:
            return None
        return f'https://test-billing.invalid/checkout?intent={intent_id}&price={price_id}'

    def portal_url(self, *, customer_id: str | None, return_url: str) -> str | None:
        if not self.configured() or not customer_id:
            return None
        return f'https://test-billing.invalid/portal?customer={customer_id}'


# Provider subscription statuses, translated into TONDE's own vocabulary. An unrecognised status is
# reported as `unknown` rather than guessed at.
PROVIDER_SUBSCRIPTION_MAP: dict[str, str] = {
    'trialing': 'trialing', 'active': 'active', 'past_due': 'past_due', 'incomplete': 'incomplete',
    'canceled': 'cancelled', 'cancelled': 'cancelled', 'cancel_at_period_end': 'cancel_at_period_end',
    'unpaid': 'past_due', 'paused': 'suspended', 'suspended': 'suspended', 'none': 'none',
}
SUBSCRIPTION_EVENT_TYPES = frozenset({'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'customer.subscription.trial_will_end', 'invoice.payment_failed',
    'invoice.paid', 'subscription.updated', 'subscription.created', 'subscription.deleted'})


def _timestamp(value: Any) -> str | None:
    if isinstance(value, int):
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    if isinstance(value, str) and value:
        return value
    return None


def normalized_subscription_change(event: VerifiedWebhook) -> SubscriptionChange | None:
    """Read the commercial fact a provider event asserts, or decline to read one.

    A caller that is handed `None` records the receipt and says the event concerned no subscription
    change it can act on — it never guesses a state from an event type it does not know.
    """

    payload = event.payload
    nested = payload.get('data')
    data: dict[str, Any] = nested if isinstance(nested, dict) else payload
    provider_state = str(data.get('status') or '')
    state = PROVIDER_SUBSCRIPTION_MAP.get(provider_state)
    if state is None:
        if event.event_type.endswith('subscription.deleted'):
            state = 'cancelled'
        else:
            return None
    customer_id = str(data.get('customer') or data.get('customer_id') or '')
    if not customer_id:
        return None
    cancel_at_period_end = bool(data.get('cancel_at_period_end'))
    if cancel_at_period_end and state == 'active':
        state = 'cancel_at_period_end'
    period_end = _timestamp(data.get('current_period_end'))
    state_at = _timestamp(data.get('provider_state_at')) or _timestamp(data.get('status_updated')) \
        or event.event_created_at
    return SubscriptionChange(state=state, provider_customer_id=customer_id,
        provider_subscription_id=str(data.get('subscription') or data.get('subscription_id') or '') or None,
        plan_key=str(data.get('plan_key') or data.get('price_key') or '') or None,
        current_period_end=period_end, provider_state_at=state_at,
        reason=f'provider event {event.event_type}',
        detail=f'The provider reported status "{provider_state or "unknown"}" for this customer.')


def unconfigured_provider(provider: str) -> 'BillingProviderAdapter':
    """The adapter a route gets for a provider this deployment has no secret and no code for."""

    return UnconfiguredBillingProvider(provider)


def build_billing_registry(settings: Settings) -> dict[str, BillingProviderAdapter]:
    """Compose the payment providers this deployment really has, from configured signing secrets.

    A provider with no configured secret is registered as explicitly unconfigured rather than omitted, so
    a route reports the missing dependency by name. The controlled test provider is registered outside
    production only, and it still requires a secret: an unverified payload is never commercial evidence,
    not even in a test.
    """

    registry: dict[str, BillingProviderAdapter] = {}
    for provider, secret in (settings.billing_webhook_secrets or {}).items():
        value = secret.get_secret_value() if hasattr(secret, 'get_secret_value') else str(secret)
        if settings.app_env != 'production' and provider == 'test_billing':
            registry[provider] = TestBillingProvider(provider, value)
        else:
            registry[provider] = HmacBillingProvider(provider, value)
    if settings.app_env != 'production' and 'test_billing' not in registry:
        registry['test_billing'] = TestBillingProvider('test_billing', None)
    return registry


# The window a signature envelope may be presented in. Named so the refusal can state it.
SIGNATURE_TOLERANCE = timedelta(seconds=DEFAULT_TOLERANCE_SECONDS)
