"""Prompt 10 billing service (§31-47, §54, §74-76).

Billing is server-authoritative, and this module is where that is implemented rather than described:

* **A subscription moves only because a verified provider event says so.** The receipt must exist, carry
  a recorded signature verification and not be failed or ignored; `billing_apply_subscription` enforces
  it. This service cannot move a subscription on its own authority.
* **Deduplication and ordering are structural.** A provider event identity is unique, so a redelivery
  returns the receipt that already exists; a provider state older than the applied one is recorded as
  `STALE_EVENT` and is not applied.
* **Cost kinds never collapse.** Provider cost (actual), estimated cost, the creator's price and credit
  consumption are separate columns with separate sums, and `cost_basis` says what each row carries.
* **A missing payment provider is reported, not faked.** Checkout returns the recorded intent with no
  session URL and the missing dependency named; the portal says the same. Nothing that would look like a
  successful subscription or a successful payment is ever produced here.

Prompt 11 owns the durable retry orchestration and the retention/observability layers around all of this.
Prompt 10 owns the authority, the evidence and the honest answers.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.domain.billing import (CheckoutRequest, PortalRequest, UsageCommitRequest, UsageQuery, UsageRecordRequest,
    UsageReleaseRequest, UsageReserveRequest)
from app.domain.commercial import RETRY_CLASSIFICATION
from app.services.billing_providers import (BillingProviderAdapter, WebhookRefused,
    build_billing_registry, unconfigured_provider)

USAGE_SELECT = ('id,workspace_id,metric,quantity,unit,idempotency_key,operation,provider,model,production_id,'
    'actor_user_id,provider_cost,estimated_cost,price_amount,credit_units,currency,cost_basis,source_event_id,'
    'attempt_id,created_at')
ACCOUNT_SELECT = ('workspace_id,provider,provider_customer_id,provider_subscription_id,plan_reference,'
    'subscription_status,current_period_end,cancel_at_period_end,provider_state_at,entitlements_synced_at,'
    'created_at,updated_at')
# The cost kinds this surface reports separately. Summing them together would be the lie; keeping them
# apart is the point.
COST_KINDS = ('actual', 'estimated', 'unknown')


def _sum(rows: list[dict[str, Any]], field: str) -> float:
    total = 0.0
    for row in rows:
        value = row.get(field)
        if isinstance(value, (int, float)):
            total += float(value)
    return round(total, 4)


class BillingService:
    def __init__(self, gateway: SupabaseGateway, settings: Settings,
        registry: dict[str, BillingProviderAdapter] | None = None) -> None:
        self.gateway = gateway
        self.settings = settings
        self.registry = registry if registry is not None else build_billing_registry(settings)

    # ------------------------------------------------------------------ credentials

    def _service_key(self) -> str:
        key = self.settings.supabase_service_role_key
        if key is None:
            raise AppError('SERVER_CREDENTIALS_REQUIRED', 'unavailable',
                'This deployment has no server credentials configured, so commercial state cannot be written.', 503)
        return key.get_secret_value()

    def provider(self, key: str) -> BillingProviderAdapter:
        return self.registry.get(key) or unconfigured_provider(key)

    def _redirect(self, path: str) -> str:
        base = (self.settings.integration_redirect_uri_base or '').rstrip('/')
        return f'{base}{path}' if base else ''

    # ------------------------------------------------------------------ checkout / portal

    async def checkout(self, workspace_id: UUID, token: str, body: CheckoutRequest) -> dict[str, Any]:
        """Open a checkout intent, then ask the provider for a session. The intent is the durable record."""

        intent = await self.gateway.rpc_detailed('billing_checkout_start', token=token, json={
            'target_workspace': str(workspace_id), 'target_plan': body.plan_key, 'note_text': body.note},
            layer='Prompt 10 billing')
        provider_key = str(intent.get('provider') or '')
        adapter = self.provider(provider_key) if provider_key else unconfigured_provider('unconfigured')
        account = await self.account(workspace_id, token)
        session_url: str | None = None
        if adapter.configured():
            session_url = adapter.checkout_url(intent_id=str(intent.get('intent_id')),
                plan_key=body.plan_key, price_id=str(intent.get('provider_price_id') or ''),
                customer_id=(account or {}).get('provider_customer_id'),
                success_url=self._redirect('/studio/billing?checkout=complete'),
                cancel_url=self._redirect('/studio/billing?checkout=cancelled'))
        return {**intent, 'checkout_url': session_url,
            'provider_configured': adapter.configured(),
            'unconfigured': adapter.unconfigured_reasons(),
            'retry': RETRY_CLASSIFICATION['billing_checkout'],
            'note': (intent.get('note') if session_url else
                'The checkout intent is recorded. No provider session was created because this deployment has '
                'not configured the payment provider credentials, so nothing was subscribed.'),
            'authority': 'Only a verified provider event can move a subscription; this call cannot.'}

    async def portal(self, workspace_id: UUID, token: str, body: PortalRequest) -> dict[str, Any]:
        """Ask the provider for its billing portal. Without credentials there is no portal, and it says so."""

        account = await self.account(workspace_id, token)
        provider_key = str((account or {}).get('provider') or '')
        adapter = self.provider(provider_key) if provider_key else unconfigured_provider('unconfigured')
        url: str | None = None
        if adapter.configured():
            url = adapter.portal_url(customer_id=(account or {}).get('provider_customer_id'),
                return_url=self._redirect('/studio/billing'))
        return {'workspace_id': str(workspace_id), 'portal_url': url,
            'provider': provider_key or None, 'provider_configured': adapter.configured(),
            'unconfigured': adapter.unconfigured_reasons(),
            'has_account': account is not None,
            'retry': RETRY_CLASSIFICATION['billing_portal'],
            'note': (left_note(body.note) if url else
                'No billing portal session was created: this deployment has no payment provider credentials, '
                'and TONDE will not invent a portal URL.')}

    async def account(self, workspace_id: UUID, token: str) -> dict[str, Any] | None:
        data = await self.gateway.request('GET', '/rest/v1/billing_accounts', token=token, schema=True,
            params={'workspace_id': f'eq.{workspace_id}', 'select': ACCOUNT_SELECT, 'limit': '1'})
        rows = data if isinstance(data, list) else []
        return rows[0] if rows else None

    async def status(self, workspace_id: UUID, token: str) -> dict[str, Any]:
        """The administrator view: subscription, plan, entitlements, open checkouts, provider identity."""

        return await self.gateway.rpc_detailed('billing_status', token=token, json={
            'target_workspace': str(workspace_id)}, layer='Prompt 10 billing')

    async def entitlement(self, workspace_id: UUID, key: str, token: str) -> dict[str, Any]:
        """The single authoritative answer for one entitlement key, with its reason."""

        try:
            state = await self.gateway.rpc_detailed('entitlement_state', token=token, json={
                'target_workspace': str(workspace_id), 'target_key': key}, layer='Prompt 10 billing')
        except AppError as error:
            if error.kind == 'unavailable':
                return {'entitlement': key, 'state': 'UNKNOWN_ENTITLEMENT', 'enforced': False, 'available': True,
                    'meaning': 'This deployment declares no entitlement for that key, so it is not gated.'}
            raise
        state_text = str(state or 'UNKNOWN_ENTITLEMENT')
        return {'entitlement': key, 'state': state_text, 'enforced': state_text not in ('UNKNOWN_ENTITLEMENT',
            'ENTITLEMENT_DISABLED'), 'available': state_text in ('AVAILABLE', 'UNKNOWN_ENTITLEMENT', 'ENTITLEMENT_DISABLED'),
            'meaning': {
                'UNKNOWN_ENTITLEMENT': 'No definition exists for this key, so it is not a commercial gate.',
                'ENTITLEMENT_DISABLED': 'The definition exists but is disabled, so it is not a gate.',
                'NO_SUBSCRIPTION': 'This workspace has no subscription.',
                'SUBSCRIPTION_NOT_ACTIVE': 'The subscription is not in a state that grants entitlements.',
                'NOT_INCLUDED': 'The current plan does not include this entitlement.',
                'EXPIRED': 'The entitlement has expired.',
                'EXHAUSTED': 'The entitlement has no remaining balance in this period.',
                'AVAILABLE': 'The workspace holds this entitlement.',
            }.get(state_text, f'The entitlement answer is {state_text}.')}

    # ------------------------------------------------------------------ usage

    async def usage_events(self, workspace_id: UUID, token: str, query: UsageQuery) -> list[dict[str, Any]]:
        params = {'workspace_id': f'eq.{workspace_id}', 'select': USAGE_SELECT, 'order': 'created_at.desc',
            'limit': str(query.limit)}
        if query.metric:
            params['metric'] = f'eq.{query.metric}'
        if query.provider:
            params['provider'] = f'eq.{query.provider}'
        if query.since is not None:
            params['created_at'] = f'gte.{query.since.isoformat()}'
        data = await self.gateway.request('GET', '/rest/v1/usage_events', token=token, schema=True, params=params)
        return data if isinstance(data, list) else []

    async def usage_summary(self, workspace_id: UUID, token: str, query: UsageQuery) -> dict[str, Any]:
        """What was consumed, grouped by metric, with the cost kinds kept apart."""

        rows = await self.usage_events(workspace_id, token, query)
        by_metric: dict[str, dict[str, Any]] = {}
        for row in rows:
            metric = str(row.get('metric') or 'unspecified')
            entry = by_metric.setdefault(metric, {'metric': metric, 'unit': row.get('unit'),
                'quantity': 0.0, 'events': 0, 'credits': 0.0, 'actual_provider_cost': 0.0,
                'estimated_provider_cost': 0.0, 'charges': 0.0, 'basis_counts': dict.fromkeys(COST_KINDS, 0)})
            entry['quantity'] = round(entry['quantity'] + float(row.get('quantity') or 0), 4)
            entry['credits'] = round(entry['credits'] + float(row.get('credit_units') or 0), 4)
            entry['charges'] = round(entry['charges'] + float(row.get('price_amount') or 0), 4)
            if row.get('cost_basis') == 'actual':
                entry['actual_provider_cost'] = round(entry['actual_provider_cost'] + float(row.get('provider_cost') or 0), 4)
            elif row.get('cost_basis') == 'estimated':
                entry['estimated_provider_cost'] = round(entry['estimated_provider_cost'] + float(row.get('estimated_cost') or 0), 4)
            entry['events'] += 1
            basis = str(row.get('cost_basis') or 'unknown')
            if basis in entry['basis_counts']:
                entry['basis_counts'][basis] += 1
        return {'workspace_id': str(workspace_id), 'metrics': sorted(by_metric.values(), key=lambda item: item['metric']),
            'events': len(rows), 'window': {'since': query.since.isoformat() if query.since else None,
                'limit': query.limit},
            'cost_separation': ('Provider cost (actual), estimated cost and the creator charge are separate '
                'numbers; credit consumption is separate again.'),
            'note': ('Cost figures come only from recorded usage events. TONDE does not estimate a provider '
                'price it was not told and does not present an estimate as a charge.')}

    async def cost_summary(self, workspace_id: UUID, token: str, query: UsageQuery) -> dict[str, Any]:
        """The four cost kinds, each summed on its own, plus how many rows carry no cost at all."""

        rows = await self.usage_events(workspace_id, token, query)
        actual = [row for row in rows if row.get('cost_basis') == 'actual']
        estimated = [row for row in rows if row.get('cost_basis') == 'estimated']
        unknown = [row for row in rows if row.get('cost_basis') == 'unknown']
        currencies = sorted({str(row.get('currency') or 'USD') for row in rows})
        return {'workspace_id': str(workspace_id),
            'actual_provider_cost': _sum(actual, 'provider_cost'),
            'estimated_provider_cost': _sum(estimated, 'estimated_cost'),
            'charged_to_creator': _sum(rows, 'price_amount'),
            'credits_consumed': _sum(rows, 'credit_units'),
            'currency': currencies[0] if len(currencies) == 1 else currencies,
            'rows': {'actual': len(actual), 'estimated': len(estimated), 'unknown': len(unknown)},
            'meaning': {
                'actual_provider_cost': 'What the provider reported it cost. Only rows with cost_basis "actual".',
                'estimated_provider_cost': 'A cost TONDE estimated, labelled as an estimate and never presented as a charge.',
                'charged_to_creator': 'What this workspace was charged, as recorded. Not derived from provider cost.',
                'credits_consumed': 'Entitlement credits consumed, as recorded by the quota ledger.',
            },
            'note': ('A row with an unknown basis carries no cost because the provider never reported one. The '
                'totals above are not a revenue figure and are not a provider invoice.')}

    async def record_usage(self, workspace_id: UUID, body: UsageRecordRequest) -> dict[str, Any]:
        """Server-to-server usage ingestion. Idempotent by key and by provider event identity."""

        result = await self.gateway.rpc_detailed('usage_record', token=self._service_key(), json={
            'target_workspace': str(workspace_id), 'target_metric': body.metric, 'target_quantity': body.quantity,
            'target_unit': body.unit, 'target_idempotency_key': body.idempotency_key, 'target_operation': body.operation,
            'target_provider': body.provider, 'target_model': body.model,
            'target_production': str(body.production_id) if body.production_id else None,
            'target_actor': str(body.actor_user_id) if body.actor_user_id else None,
            'target_provider_cost': body.provider_cost, 'target_estimated_cost': body.estimated_cost,
            'target_price': body.price_amount, 'target_credit_units': body.credit_units,
            'target_currency': body.currency, 'target_cost_basis': body.cost_basis,
            'target_source_event_id': body.source_event_id,
            'target_attempt': str(body.attempt_id) if body.attempt_id else None}, layer='Prompt 10 billing')
        result['retry'] = RETRY_CLASSIFICATION['usage_record']
        return result

    async def reserve(self, workspace_id: UUID, body: UsageReserveRequest) -> dict[str, Any]:
        result = await self.gateway.rpc_detailed('usage_reserve', token=self._service_key(), json={
            'target_workspace': str(workspace_id), 'target_key': body.key, 'target_amount': body.amount,
            'target_operation': body.operation, 'note_text': body.note}, layer='Prompt 10 billing')
        result['retry'] = RETRY_CLASSIFICATION['usage_reserve']
        return result

    async def commit(self, workspace_id: UUID, body: UsageCommitRequest) -> dict[str, Any]:
        result = await self.gateway.rpc_detailed('usage_commit', token=self._service_key(), json={
            'target_workspace': str(workspace_id), 'target_reservation': str(body.reservation_id),
            'actual_amount': body.actual_amount, 'note_text': body.note}, layer='Prompt 10 billing')
        result['retry'] = RETRY_CLASSIFICATION['usage_commit']
        return result

    async def release(self, workspace_id: UUID, body: UsageReleaseRequest) -> dict[str, Any]:
        result = await self.gateway.rpc_detailed('usage_release', token=self._service_key(), json={
            'target_workspace': str(workspace_id), 'target_reservation': str(body.reservation_id),
            'note_text': body.note}, layer='Prompt 10 billing')
        result['retry'] = RETRY_CLASSIFICATION['usage_release']
        return result

    # ------------------------------------------------------------------ webhooks

    async def receive_webhook(self, provider: str, headers: dict[str, str], raw_body: bytes) -> dict[str, Any]:
        """Verify, record, deduplicate, apply, finish. Every step is separately visible in the answer."""

        adapter = self.provider(provider)
        if not adapter.configured():
            raise AppError('WEBHOOK_PROVIDER_UNCONFIGURED', 'unavailable',
                f'No webhook signing secret is configured for {provider}, so no payload can be accepted.', 503)
        try:
            event = adapter.verify_webhook(headers, raw_body)
        except WebhookRefused as refusal:
            raise AppError('WEBHOOK_REFUSED', 'authorization', refusal.message, 401) from refusal
        receipt = await self.gateway.rpc_detailed('billing_webhook_receive', token=self._service_key(), json={
            'target_provider': event.provider, 'target_event_id': event.event_id,
            'target_event_type': event.event_type, 'target_event_created_at': event.event_created_at,
            'target_signature_scheme': event.signature_scheme,
            'target_signature_verified_at': event.signature_verified_at,
            'target_payload': self._safe_payload(event.payload)}, layer='Prompt 10 billing')
        if receipt.get('duplicate'):
            return {'provider': provider, 'received': True, 'duplicate': True, 'event_id': receipt.get('event_id'),
                'state': receipt.get('state'), 'applied': False,
                'note': 'This provider event was already received; processing it again would double-count it.'}
        event_id = str(receipt.get('event_id'))
        change = adapter.subscription_change(event)
        if change is None:
            await self._finish(event_id, 'ignored', 'This event asserts no subscription change TONDE can act on.', None)
            return {'provider': provider, 'received': True, 'duplicate': False, 'event_id': event_id,
                'state': 'ignored', 'applied': False, 'event_type': event.event_type,
                'note': 'The receipt is recorded and nothing was changed: this event is not a subscription change.'}
        workspace = await self._workspace_for_customer(change.provider_customer_id)
        if workspace is None:
            await self._finish(event_id, 'ignored',
                'No workspace in this deployment is linked to that provider customer identity.', None)
            return {'provider': provider, 'received': True, 'duplicate': False, 'event_id': event_id,
                'state': 'ignored', 'applied': False, 'event_type': event.event_type,
                'provider_customer_id': change.provider_customer_id,
                'note': ('The receipt is recorded with no workspace attribution: TONDE will not guess which '
                    'workspace a provider customer identity belongs to.')}
        try:
            applied = await self.gateway.rpc_detailed('billing_apply_subscription', token=self._service_key(), json={
                'target_workspace': workspace, 'target_event': event_id, 'target_state': change.state,
                'target_plan_key': change.plan_key, 'target_provider_customer_id': change.provider_customer_id,
                'target_provider_subscription_id': change.provider_subscription_id,
                'target_current_period_end': change.current_period_end,
                'target_provider_state_at': change.provider_state_at, 'reason_text': change.reason},
                layer='Prompt 10 billing')
        except AppError as error:
            await self._finish(event_id, 'failed', error.code, workspace)
            raise
        await self._finish(event_id, 'processed', change.detail, workspace)
        return {'provider': provider, 'received': True, 'duplicate': False, 'event_id': event_id,
            'state': 'processed', 'event_type': event.event_type, 'workspace_id': workspace,
            'applied': bool(applied.get('applied')), 'subscription': {'state': applied.get('state'),
                'previous_state': applied.get('previous_state'), 'provider_state_at': applied.get('provider_state_at')},
            'reason': applied.get('reason'),
            'entitlements': applied.get('entitlements'),
            'retry': RETRY_CLASSIFICATION['billing_webhook'],
            'note': (applied.get('note') or ('The subscription moved because a verified provider event said so.'
                if applied.get('applied') else 'The event was recorded without being applied.'))}

    async def _finish(self, event_id: str, state: str, message: str | None, workspace: str | None) -> None:
        await self.gateway.rpc_detailed('billing_webhook_finish', token=self._service_key(), json={
            'target_event': event_id, 'target_state': state, 'target_message': message,
            'target_workspace': workspace}, layer='Prompt 10 billing')

    async def _workspace_for_customer(self, provider_customer_id: str) -> str | None:
        """Resolve the workspace a provider customer identity belongs to. No identity, no attribution."""

        if not provider_customer_id:
            return None
        rows = await self.gateway.request('GET', '/rest/v1/billing_accounts', token=self._service_key(),
            schema=True, params={'provider_customer_id': f'eq.{provider_customer_id}', 'select': 'workspace_id',
                'limit': '1'})
        found = rows if isinstance(rows, list) else []
        return str(found[0]['workspace_id']) if found else None

    @staticmethod
    def _safe_payload(payload: dict[str, Any]) -> dict[str, Any]:
        """Keep the receipt, drop anything secret-shaped. A payment secret must never be stored or logged."""

        def scrub(value: Any) -> Any:
            if isinstance(value, dict):
                cleaned = {}
                for key, item in value.items():
                    lowered = str(key).lower()
                    if any(marker in lowered for marker in ('secret', 'signature', 'card', 'cvc', 'authorization',
                        'token', 'password')):
                        continue
                    cleaned[str(key)] = scrub(item)
                return cleaned
            if isinstance(value, list):
                return [scrub(item) for item in value]
            return value

        scrubbed = scrub(payload)
        return scrubbed if isinstance(scrubbed, dict) else {}


def left_note(note: str) -> str:
    return note.strip()[:600] or 'The billing portal session is ready.'
