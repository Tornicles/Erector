"""Prompt 10 billing, usage and webhook HTTP surface (§31-47, §54, §74-76, §89).

Who may do what, and why:

* **A workspace administrator** may open a checkout intent, ask for the provider portal and read the
  commercial status, entitlements, usage and costs. None of those calls can subscribe the workspace,
  grant an entitlement or write a usage row.
* **A trusted server** (holding the deployment's server token, or the service credential PostgREST sees)
  may ingest usage, reserve/commit/release quota and receive provider webhooks. These routes are the
  documented server-to-server seam; they are not reachable from a browser session.
* **A provider** may deliver a webhook, but only a payload whose signature verifies against the
  provider's configured signing secret is accepted at all. There is no path that records an unverified
  event, and no path that applies a provider state older than the one already applied.

Numbers are reported in the four kinds they actually are — actual provider cost, estimated provider
cost, what the creator was charged, and credits consumed — and are never summed together as if they were
the same quantity.
"""

from __future__ import annotations

import hmac
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_admin, require_workspace_editor
from app.domain.billing import (CheckoutRequest, PortalRequest, SUBSCRIPTION_LABELS, UsageCommitRequest, UsageQuery,
    UsageRecordRequest, UsageReleaseRequest, UsageReserveRequest)
from app.domain.commercial import RETRY_CLASSIFICATION
from app.services.billing import BillingService
from app.services.rate_limit import RateLimiter

Envelope = Any

BILLING_VOCABULARY: dict[str, Any] = {
    'subscription_states': SUBSCRIPTION_LABELS,
    'cost_kinds': {
        'actual_provider_cost': 'What the provider reported it cost. Never presented as a charge.',
        'estimated_provider_cost': 'A labelled estimate. Never presented as a charge.',
        'charged_to_creator': 'What this workspace was charged, as recorded.',
        'credits_consumed': 'Entitlement credits consumed, from the quota ledger.',
    },
    'authority_law': ('Billing is server-authoritative. A subscription moves only because a verified provider '
        'event says so; a browser can open a checkout intent and read status, and cannot subscribe, grant an '
        'entitlement or record usage.'),
    'webhook_law': ('An unverified payload is never commercial evidence. A payload whose signature does not '
        'verify against the provider signing secret is refused before a receipt exists, and a provider state '
        'older than the applied one is recorded without being applied.'),
    'retry': {action: RETRY_CLASSIFICATION[action] for action in ('billing_checkout', 'billing_portal',
        'billing_webhook', 'usage_record', 'usage_reserve', 'usage_commit', 'usage_release')},
}

SERVER_TOKEN_HEADER = 'x-tonde-server-token'


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_BILLING_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def require_server_token(request: Request, config: Settings) -> None:
    """The server-to-server seam. Unset token means the deployment has not enabled these routes."""

    expected = config.tonde_server_token
    if expected is None:
        raise AppError('SERVER_TOKENS_DISABLED', 'unavailable',
            'This deployment has not enabled server-to-server commercial calls.', 503)
    provided = request.headers.get(SERVER_TOKEN_HEADER, '')
    if not provided or not hmac.compare_digest(provided, expected.get_secret_value()):
        raise AppError('SERVER_TOKEN_INVALID', 'authentication',
            'That server credential was not accepted.', 401)


def register_billing_routes(application: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}'
    limiter = RateLimiter()
    service = BillingService

    # ------------------------------------------------------------------ reads

    @application.get(f'{base}/billing/vocabulary')
    async def billing_vocabulary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor)) -> Any:
        return envelope(request, BILLING_VOCABULARY)

    @application.get(f'{base}/billing/status')
    async def billing_status(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The administrator view. The database refuses a non-administrator before this returns anything."""

        limiter.enforce('billing.status', str(user.id))
        status = await service(gateway, config).status(workspace_id, request.state.access_token)
        status['vocabulary'] = BILLING_VOCABULARY
        return envelope(request, status)

    @application.get(f'{base}/billing/account')
    async def billing_account(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The provider account identity this workspace is linked to, or plainly nothing."""

        account = await service(gateway, config).account(workspace_id, request.state.access_token)
        return envelope(request, {'workspace_id': str(workspace_id), 'account': account,
            'has_subscription': bool(account and account.get('subscription_status') not in (None, 'none')),
            'note': ('No billing account exists for this workspace yet.' if account is None
                else 'The subscription state comes from verified provider events; this read never edits it.')})

    @application.get(f'{base}/entitlements/{{key}}')
    async def entitlement_state(workspace_id: UUID, key: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One entitlement's authoritative answer and reason, so a surface can explain an unavailable feature."""

        decision = await service(gateway, config).entitlement(workspace_id, key, request.state.access_token)
        decision['server_authoritative'] = True
        decision['frontend_role'] = 'UX only: the same check is repeated server-side before any paid operation runs.'
        return envelope(request, decision)

    @application.get(f'{base}/usage')
    async def usage_events(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Recorded usage rows for this workspace, newest first."""

        limiter.enforce('usage.read', str(user.id))
        query = _usage_query(request)
        rows = await service(gateway, config).usage_events(workspace_id, request.state.access_token, query)
        return envelope(request, {'items': rows, 'count': len(rows),
            'note': 'Every row records the quantity, the unit and what kind of cost number it carries.'})

    @application.get(f'{base}/usage/summary')
    async def usage_summary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        limiter.enforce('usage.read', str(user.id))
        summary = await service(gateway, config).usage_summary(workspace_id, request.state.access_token, _usage_query(request))
        summary['vocabulary'] = BILLING_VOCABULARY
        return envelope(request, summary)

    @application.get(f'{base}/costs')
    async def cost_summary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        limiter.enforce('usage.read', str(user.id))
        costs = await service(gateway, config).cost_summary(workspace_id, request.state.access_token, _usage_query(request))
        costs['vocabulary'] = BILLING_VOCABULARY
        return envelope(request, costs)

    # ------------------------------------------------------------------ administrator actions

    @application.post(f'{base}/billing/checkout')
    async def start_checkout(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Open a checkout intent. The database gates this on workspace administration, not membership."""

        limiter.enforce('billing.checkout', str(user.id))
        body = _validated(CheckoutRequest, await request.json(), 'Check the checkout fields.')
        result = await service(gateway, config).checkout(workspace_id, request.state.access_token, body)
        logger.info('checkout_initiated', extra={'context': {'event': 'billing_checkout_initiated',
            'workspace_id': str(workspace_id), 'plan_key': body.plan_key,
            'provider_configured': result.get('provider_configured')}})
        return envelope(request, result)

    @application.post(f'{base}/billing/portal')
    async def open_portal(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Ask the provider for the billing portal. Cancellation and plan changes happen at the provider."""

        limiter.enforce('billing.portal', str(user.id))
        body = _validated(PortalRequest, await request.json() if await request.body() else {},
            'Check the portal fields.')
        result = await service(gateway, config).portal(workspace_id, request.state.access_token, body)
        result['plan_changes_happen_at'] = 'The payment provider: TONDE never edits a subscription itself.'
        return envelope(request, result)

    # ------------------------------------------------------------------ server-to-server seam

    @application.post(f'{base}/usage/record')
    async def record_usage(workspace_id: UUID, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Ingest usage. Idempotent by the caller's key or the provider event identity it came from."""

        require_server_token(request, config)
        limiter.enforce('usage.record', str(workspace_id))
        body = _validated(UsageRecordRequest, await request.json(), 'Check the usage fields.')
        result = await service(gateway, config).record_usage(workspace_id, body)
        return envelope(request, result)

    @application.post(f'{base}/usage/reserve')
    async def reserve_usage(workspace_id: UUID, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Reserve part of a consumable entitlement before the work starts. Overspending is impossible."""

        require_server_token(request, config)
        body = _validated(UsageReserveRequest, await request.json(), 'Check the reservation fields.')
        return envelope(request, await service(gateway, config).reserve(workspace_id, body))

    @application.post(f'{base}/usage/commit')
    async def commit_usage(workspace_id: UUID, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Settle a reservation at the amount that was actually used."""

        require_server_token(request, config)
        body = _validated(UsageCommitRequest, await request.json(), 'Check the commit fields.')
        return envelope(request, await service(gateway, config).commit(workspace_id, body))

    @application.post(f'{base}/usage/release')
    async def release_usage(workspace_id: UUID, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Release a reservation that was not used."""

        require_server_token(request, config)
        body = _validated(UsageReleaseRequest, await request.json(), 'Check the release fields.')
        return envelope(request, await service(gateway, config).release(workspace_id, body))

    # ------------------------------------------------------------------ provider webhook

    @application.post('/api/v1/billing/webhooks/{provider}')
    async def billing_webhook(provider: str, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Receive a payment provider event.

        No session, no API key, no administrator: the signature is the whole authorization. A payload
        without a configured signing secret or without a valid signature is refused before anything is
        recorded, and the raw body is what the signature covers, so it is read exactly as delivered.
        """

        limiter.enforce('webhook.receive', provider)
        raw_body = await request.body()
        if not raw_body:
            raise AppError('WEBHOOK_EMPTY', 'validation', 'The webhook body was empty.', 422)
        if len(raw_body) > 512 * 1024:
            raise AppError('WEBHOOK_TOO_LARGE', 'validation', 'The webhook body exceeded the accepted size.', 413)
        result = await service(gateway, config).receive_webhook(provider, dict(request.headers), raw_body)
        logger.info('billing_webhook', extra={'context': {'event': 'billing_webhook_received', 'provider': provider,
            'state': result.get('state'), 'duplicate': result.get('duplicate'), 'applied': result.get('applied')}})
        return envelope(request, result)


def _usage_query(request: Request) -> UsageQuery:
    params = request.query_params
    try:
        limit = int(params.get('limit') or 200)
    except ValueError as exc:
        raise AppError('INVALID_BILLING_INPUT', 'validation', 'limit must be a whole number.', 422) from exc
    # A window is expressed as an instant; an unparseable instant is refused rather than ignored,
    # because silently reading a wider window would misreport usage.
    since: datetime | None = None
    raw_since = params.get('since') or ''
    if raw_since:
        try:
            since = datetime.fromisoformat(raw_since.replace('Z', '+00:00'))
        except ValueError as exc:
            raise AppError('INVALID_BILLING_INPUT', 'validation',
                'The usage window must be an ISO-8601 instant.', 422) from exc
    return UsageQuery(metric=params.get('metric') or None, provider=params.get('provider') or None,
        since=since, limit=max(1, min(1000, limit)))
