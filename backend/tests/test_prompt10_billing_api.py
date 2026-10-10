"""Prompt 10 billing, usage and webhook backend coverage (§31-47, §54, §74-76, §88).

The properties proven here are the ones where a mistake would become a commercial lie:

* **an unverified payload is never evidence.** A missing, malformed, stale or wrong signature is refused
  before a receipt exists, and the verification that *was* performed is recorded with the receipt;
* **a verified event moves a subscription, and only a verified event does.** The receipt must exist, and
  the subscription RPC is called with the service credential — never with a creator's session;
* **duplicates and out-of-order delivery change nothing.** A repeated provider event returns the receipt
  that already exists; an event describing an older provider state is recorded without being applied;
* **the four cost kinds stay apart.** Actual provider cost, estimated cost, what the creator was charged
  and credits consumed are summed separately and never combined into one number;
* **a browser cannot subscribe, grant an entitlement or record usage.** Those calls are server-to-server
  and are refused without the deployment's server token.

The database's own laws — the overspending constraint, the response of a reservation under a row lock,
`STALE_EVENT` recording, and `billing_apply_subscription` refusing an unsigned receipt — are proven over
real embedded PostgreSQL in `tests/database/prompt10-billing.test.mjs`. Nothing here claims a live payment
provider processed anything: no payment-provider account exists in this environment, which is exactly what
the checkout and portal answers state.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from tests.prompt10_harness import (BILLING_PROVIDER, PLAN, SERVER_HEADERS, SERVER_TOKEN, TOKEN_A, USER_HEADERS,
    WH_SECRET, WORKSPACE, Platform, sign_webhook, usage_row)

EVENT_ID = 'evt_test_0001'
PERIOD_END = 1790000000


def billing_path(suffix: str = '') -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/billing{suffix}'


def workspace_path(suffix: str) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}{suffix}'


def webhook_path(provider: str = BILLING_PROVIDER) -> str:
    return f'/api/v1/billing/webhooks/{provider}'


def event_payload(*, event_id: str = EVENT_ID, status: str = 'active', type_: str = 'customer.subscription.updated',
    customer: str = 'cus_test_0001', created: int | None = None, state_at: int | None = None,
    cancel_at_period_end: bool = False, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    moment = int(datetime.now(timezone.utc).timestamp()) if created is None else created
    payload: dict[str, Any] = {'id': event_id, 'type': type_, 'created': moment,
        'data': {'status': status, 'customer': customer, 'subscription': 'sub_test_1',
            'current_period_end': PERIOD_END, 'plan_key': PLAN, 'cancel_at_period_end': cancel_at_period_end,
            'provider_state_at': state_at if state_at is not None else moment}}
    if extra:
        payload.update(extra)
    return payload


def signed(payload: dict[str, Any], *, secret: str = WH_SECRET, timestamp: int | None = None) -> tuple[bytes, dict[str, str]]:
    body = json.dumps(payload).encode('utf-8')
    _header, headers = sign_webhook(body, secret, timestamp=timestamp)
    return body, headers


def billing_handlers(**overrides: Any) -> dict[str, Any]:
    """Default RPC behaviour for the commercial surface, overridable per test."""

    handlers: dict[str, Any] = {
        'billing_checkout_start': lambda payload, token, service: {'intent_id': '00000000-0000-4000-8000-00000000c001',
            'plan_key': payload.get('target_plan'), 'state': 'started', 'provider': BILLING_PROVIDER,
            'provider_price_id': 'price_test_1',
            'note': 'The provider session is created by the backend from this intent.'},
        'billing_status': lambda payload, token, service: {
            'workspace_id': WORKSPACE,
            'subscription': {'state': 'active', 'plan_key': PLAN, 'plan_name': 'Studio',
                'cancel_at_period_end': False, 'current_period_end': '2026-11-08T10:00:00+00:00',
                'provider_state_at': '2026-10-08T10:00:00+00:00', 'grants_entitlements': True},
            'provider': {'name': BILLING_PROVIDER, 'configured': True},
            'entitlements': [{'key': 'exports.packages', 'name': 'Packages', 'kind': 'feature', 'unit': '',
                'source': 'plan', 'limit_amount': None, 'consumed_amount': 0, 'reserved_amount': 0,
                'remaining': None, 'valid_until': None}],
            'open_checkouts': [], 'note': 'Commercial facts come from verified provider events.'},
        'billing_webhook_receive': lambda payload, token, service: {'event_id': '00000000-0000-4000-8000-00000000e001',
            'duplicate': False, 'state': 'received', 'note': 'The receipt is recorded.'},
        'billing_apply_subscription': lambda payload, token, service: {'applied': True,
            'state': payload.get('target_state'), 'previous_state': 'none',
            'provider_state_at': payload.get('target_provider_state_at'),
            'entitlements': {'granted': ['exports.packages'], 'revoked': []},
            'note': 'The subscription moved because a verified provider event said so.'},
        'billing_webhook_finish': lambda payload, token, service: {'event_id': payload.get('target_event'),
            'state': payload.get('target_state'), 'audited': payload.get('target_workspace') is not None,
            'note': 'The receipt records what happened.'},
        'usage_record': lambda payload, token, service: {'usage_event_id': '00000000-0000-4000-8000-00000000f001',
            'recorded': True, 'duplicate': False, 'metric': payload.get('target_metric'),
            'cost_basis': payload.get('target_cost_basis'), 'quantity': payload.get('target_quantity')},
        'usage_reserve': lambda payload, token, service: {'reservation_id': '00000000-0000-4000-8000-00000000a001',
            'workspace_id': WORKSPACE, 'entitlement': payload.get('target_key'),
            'amount': payload.get('target_amount'), 'state': 'reserved', 'remaining_after_reservation': 7.5},
        'usage_commit': lambda payload, token, service: {'reservation_id': payload.get('target_reservation'),
            'state': 'committed', 'reserved_amount': 2.5, 'consumed_amount': payload.get('actual_amount') or 2.5,
            'entitlement': 'generation.credits', 'note': 'The reservation was settled at the amount actually used.'},
        'usage_release': lambda payload, token, service: {'reservation_id': payload.get('target_reservation'),
            'state': 'released', 'released_amount': 2.5, 'entitlement': 'generation.credits',
            'note': 'The reserved amount is available again.'},
    }
    handlers.update(overrides)
    return handlers


def platform(**overrides: Any) -> Platform:
    tables = {'billing_accounts': [{'workspace_id': WORKSPACE, 'provider': BILLING_PROVIDER,
        'provider_customer_id': 'cus_test_0001', 'provider_subscription_id': 'sub_test_1', 'plan_reference': PLAN,
        'subscription_status': 'active', 'current_period_end': '2026-11-08T10:00:00+00:00',
        'cancel_at_period_end': False, 'provider_state_at': '2026-10-08T10:00:00+00:00',
        'entitlements_synced_at': None, 'created_at': '2026-10-01T10:00:00+00:00',
        'updated_at': '2026-10-08T10:00:00+00:00'}]}
    tables.update(overrides.pop('tables', {}))
    return Platform(tables=tables, rpc=billing_handlers(**overrides.pop('rpc', {})), **overrides)


def only_call(app: Platform, name: str) -> dict[str, Any]:
    matches = app.rpc_calls(name)
    assert matches, f'{name} was never called'
    return matches[-1]


# ------------------------------------------------------------------ vocabulary and reads


def test_vocabulary_separates_the_cost_kinds_and_states_the_authority_law() -> None:
    with platform().client() as client:
        data = client.get(billing_path('/vocabulary'), headers=USER_HEADERS).json()['data']
        assert set(data['cost_kinds']) == {'actual_provider_cost', 'estimated_provider_cost',
            'charged_to_creator', 'credits_consumed'}
        assert 'Never presented as a charge' in data['cost_kinds']['actual_provider_cost']
        assert 'server-authoritative' in data['authority_law']
        assert 'cannot subscribe, grant an entitlement or record usage' in data['authority_law']
        assert 'never commercial evidence' in data['webhook_law']
        assert data['retry']['billing_webhook'] == 'REQUIRES_RECONCILIATION'


def test_billing_status_is_an_administrator_view_and_reports_entitlements() -> None:
    app = platform()
    with app.client() as client:
        data = client.get(billing_path('/status'), headers=USER_HEADERS).json()['data']
        assert data['subscription']['state'] == 'active' and data['subscription']['grants_entitlements'] is True
        assert data['entitlements'][0]['key'] == 'exports.packages'
        assert data['vocabulary']['subscription_states']['active'] == 'Active'
        editor = platform(role='editor')
        with editor.client() as editor_client:
            refused = editor_client.get(billing_path('/status'), headers=USER_HEADERS)
            assert refused.status_code == 403
            assert refused.json()['errors'][0]['code'] == 'WORKSPACE_BILLING_ACCESS_DENIED'
            assert not editor.rpc_calls('billing_status')


def test_the_account_read_says_plainly_when_there_is_no_subscription() -> None:
    with platform(tables={'billing_accounts': []}).client() as client:
        data = client.get(billing_path('/account'), headers=USER_HEADERS).json()['data']
        assert data['account'] is None and data['has_subscription'] is False
        assert data['note'] == 'No billing account exists for this workspace yet.'


def test_entitlement_state_is_returned_with_its_reason_and_marks_the_server_as_authoritative() -> None:
    with platform(entitlement='NOT_INCLUDED').client() as client:
        data = client.get(workspace_path('/entitlements/generation.credits'), headers=USER_HEADERS).json()['data']
        assert data['state'] == 'NOT_INCLUDED' and data['available'] is False and data['enforced'] is True
        assert data['meaning'] == 'The current plan does not include this entitlement.'
        assert data['server_authoritative'] is True and data['frontend_role'].startswith('UX only')
    with platform(entitlement='UNKNOWN_ENTITLEMENT').client() as client:
        data = client.get(workspace_path('/entitlements/exports.documents'), headers=USER_HEADERS).json()['data']
        assert data['enforced'] is False and data['available'] is True
        assert data['meaning'].startswith('No definition exists')


def test_entitlement_evaluation_stays_ungated_when_the_billing_migration_is_absent() -> None:
    with platform(entitlement=None).client() as client:
        data = client.get(workspace_path('/entitlements/exports.packages'), headers=USER_HEADERS).json()['data']
        assert data['state'] == 'UNKNOWN_ENTITLEMENT' and data['enforced'] is False and data['available'] is True


# ------------------------------------------------------------------ checkout and portal


def test_checkout_records_an_intent_and_reports_the_provider_session_truthfully() -> None:
    app = platform()
    with app.client() as client:
        data = client.post(billing_path('/checkout'), headers=USER_HEADERS,
            json={'plan_key': PLAN, 'note': 'Upgrade for packages.'}).json()['data']
        assert data['intent_id'] and data['state'] == 'started' and data['plan_key'] == PLAN
        assert data['checkout_url'] == 'https://test-billing.invalid/checkout?intent=00000000-0000-4000-8000-00000000c001&price=price_test_1'
        assert data['provider_configured'] is True
        assert data['retry'] == 'REQUIRES_IDEMPOTENCY_KEY'
        assert data['authority'] == 'Only a verified provider event can move a subscription; this call cannot.'
        start = only_call(app, 'billing_checkout_start')
        assert start['service'] is False and start['payload'] == {'target_workspace': WORKSPACE,
            'target_plan': PLAN, 'note_text': 'Upgrade for packages.'}

    unconfigured = platform(whsec=None)
    with unconfigured.client() as client:
        data = client.post(billing_path('/checkout'), headers=USER_HEADERS, json={'plan_key': PLAN}).json()['data']
        assert data['checkout_url'] is None and data['provider_configured'] is False
        assert data['unconfigured'] == ['payment_provider_credentials']
        assert 'no provider session was created' in data['note'].lower()
        assert 'nothing was subscribed' in data['note']


def test_only_an_administrator_can_open_a_checkout() -> None:
    for role, status in (('editor', 403), ('viewer', 403)):
        app = platform(role=role)
        with app.client() as client:
            response = client.post(billing_path('/checkout'), headers=USER_HEADERS, json={'plan_key': PLAN})
            assert response.status_code == status
            assert not app.rpc_calls('billing_checkout_start')


def test_the_portal_is_reported_and_never_invented() -> None:
    with platform().client() as client:
        data = client.post(billing_path('/portal'), headers=USER_HEADERS, json={}).json()['data']
        assert data['portal_url'] == 'https://test-billing.invalid/portal?customer=cus_test_0001'
        assert data['has_account'] is True
        assert data['plan_changes_happen_at'].startswith('The payment provider')
    with platform(whsec=None).client() as client:
        data = client.post(billing_path('/portal'), headers=USER_HEADERS, json={}).json()['data']
        assert data['portal_url'] is None
        assert 'no payment provider credentials' in data['note']


# ------------------------------------------------------------------ webhook verification


def test_a_verified_provider_event_moves_the_subscription_and_grants_entitlements() -> None:
    app = platform()
    body, headers = signed(event_payload(status='active'))
    with app.client() as client:
        response = client.post(webhook_path(), content=body, headers=headers)
        data = response.json()['data']
        assert response.status_code == 200 and data['received'] is True and data['duplicate'] is False
        assert data['state'] == 'processed' and data['applied'] is True
        assert data['subscription']['state'] == 'active'
        assert data['entitlements'] == {'granted': ['exports.packages'], 'revoked': []}
        assert data['retry'] == 'REQUIRES_RECONCILIATION'

        receipt = only_call(app, 'billing_webhook_receive')
        assert receipt['service'] is True
        assert receipt['payload']['target_signature_scheme'] == 'hmac-sha256'
        assert receipt['payload']['target_signature_verified_at']
        assert receipt['payload']['target_provider'] == BILLING_PROVIDER
        assert receipt['payload']['target_event_id'] == EVENT_ID
        # The provider's own clock is what ordering depends on, so it is carried through unchanged.
        assert receipt['payload']['target_event_created_at'].startswith(
            datetime.fromtimestamp(int(json.loads(body)['created']), tz=timezone.utc).isoformat()[:16])
        # Nothing secret-shaped is stored with the receipt.
        flattened = json.dumps(receipt['payload']['target_payload']).lower()
        assert 'signature' not in flattened and WH_SECRET not in json.dumps(receipt['payload'])

        applied = only_call(app, 'billing_apply_subscription')
        assert applied['service'] is True
        assert applied['payload']['target_workspace'] == WORKSPACE
        assert applied['payload']['target_state'] == 'active'
        assert applied['payload']['target_event'] == '00000000-0000-4000-8000-00000000e001'
        assert applied['payload']['target_provider_customer_id'] == 'cus_test_0001'
        assert applied['payload']['target_provider_state_at']

        finish = only_call(app, 'billing_webhook_finish')
        assert finish['payload'] == {'target_event': '00000000-0000-4000-8000-00000000e001',
            'target_state': 'processed', 'target_message': 'The provider reported status "active" for this customer.',
            'target_workspace': WORKSPACE}
        assert finish['service'] is True


def test_a_past_due_and_a_cancellation_event_are_applied_as_their_own_states() -> None:
    for status, expected in (('past_due', 'past_due'), ('canceled', 'cancelled')):
        app = platform()
        body, headers = signed(event_payload(status=status))
        with app.client() as client:
            data = client.post(webhook_path(), content=body, headers=headers).json()['data']
        assert data['applied'] is True
        assert only_call(app, 'billing_apply_subscription')['payload']['target_state'] == expected

    cancel_at_end = platform()
    body, headers = signed(event_payload(status='active', cancel_at_period_end=True))
    with cancel_at_end.client() as client:
        client.post(webhook_path(), content=body, headers=headers)
    assert only_call(cancel_at_end, 'billing_apply_subscription')['payload']['target_state'] == 'cancel_at_period_end'


def test_an_invalid_signature_is_refused_before_any_receipt_exists() -> None:
    app = platform()
    body, headers = signed(event_payload(), secret='a-completely-different-secret')
    with app.client() as client:
        response = client.post(webhook_path(), content=body, headers=headers)
        assert response.status_code == 401
        assert response.json()['errors'][0]['code'] == 'WEBHOOK_REFUSED'
        assert response.json()['errors'][0]['message'] == 'The signature did not match the payload.'
        assert not app.rpc_calls('billing_webhook_receive')
        assert not app.rpc_calls('billing_apply_subscription')


def test_a_missing_malformed_or_stale_signature_is_refused() -> None:
    app = platform()
    body, _headers = signed(event_payload())
    with app.client() as client:
        missing = client.post(webhook_path(), content=body, headers={'content-type': 'application/json'})
        assert missing.status_code == 401
        assert 'carried no signature' in missing.json()['errors'][0]['message']
        malformed = client.post(webhook_path(), content=body, headers={'x-tonde-signature': 'not-a-signature'})
        assert malformed.status_code == 401
        assert 'not in the expected form' in malformed.json()['errors'][0]['message']
        stale_body, stale_headers = signed(event_payload(),
            timestamp=int((datetime.now(timezone.utc) - timedelta(hours=2)).timestamp()))
        stale = client.post(webhook_path(), content=stale_body, headers=stale_headers)
        assert stale.status_code == 401
        assert 'outside the' in stale.json()['errors'][0]['message']
        assert not app.rpc_calls('billing_webhook_receive')


def test_a_payload_without_a_provider_creation_time_is_refused_rather_than_dated_by_tonde() -> None:
    app = platform()
    payload = event_payload()
    payload.pop('created')
    body, headers = signed(payload)
    with app.client() as client:
        response = client.post(webhook_path(), content=body, headers=headers)
        assert response.status_code == 401
        assert 'will not invent one' in response.json()['errors'][0]['message']
        assert not app.rpc_calls('billing_webhook_receive')


def test_a_webhook_for_an_unconfigured_provider_is_refused_outright() -> None:
    app = platform()
    body, headers = signed(event_payload())
    with app.client() as client:
        response = client.post(webhook_path('stripe'), content=body, headers=headers)
        assert response.status_code == 503
        assert response.json()['errors'][0]['code'] == 'WEBHOOK_PROVIDER_UNCONFIGURED'
        assert 'no payload can be accepted' in response.json()['errors'][0]['message']
        assert not app.rpc_calls('billing_webhook_receive')


def test_an_empty_body_is_refused_before_verification() -> None:
    with platform().client() as client:
        response = client.post(webhook_path(), content=b'', headers={'x-tonde-signature': 't=1,v1=x'})
        assert response.status_code == 422
        assert response.json()['errors'][0]['code'] == 'WEBHOOK_EMPTY'


# ------------------------------------------------------------------ deduplication and ordering


def test_a_duplicate_event_is_deduplicated_and_never_reapplied() -> None:
    app = platform(rpc={'billing_webhook_receive': lambda payload, token, service: {
        'event_id': '00000000-0000-4000-8000-00000000e001', 'duplicate': True, 'state': 'processed',
        'note': 'This provider event was already received.'}})
    body, headers = signed(event_payload())
    with app.client() as client:
        data = client.post(webhook_path(), content=body, headers=headers).json()['data']
        assert data['duplicate'] is True and data['applied'] is False and data['state'] == 'processed'
        assert 'double-count' in data['note']
        assert not app.rpc_calls('billing_apply_subscription')
        assert only_call(app, 'billing_webhook_receive')['payload']['target_event_id'] == EVENT_ID


def test_an_out_of_order_event_is_recorded_without_being_applied() -> None:
    app = platform(rpc={'billing_apply_subscription': lambda payload, token, service: {'applied': False,
        'reason': 'STALE_EVENT', 'state': 'active', 'provider_state_at': '2026-10-08T10:00:00+00:00',
        'note': 'This event describes an older provider state and was recorded without applying it.'}})
    older = int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp())
    body, headers = signed(event_payload(status='past_due', created=older, state_at=older))
    with app.client() as client:
        data = client.post(webhook_path(), content=body, headers=headers).json()['data']
    assert data['state'] == 'processed' and data['applied'] is False
    assert data['reason'] == 'STALE_EVENT'
    assert data['subscription']['state'] == 'active', 'an older provider state never restores an earlier subscription'
    assert 'recorded without applying it' in data['note']
    assert only_call(app, 'billing_webhook_finish')['payload']['target_state'] == 'processed'


def test_an_event_naming_no_tonde_workspace_is_recorded_without_attribution() -> None:
    app = platform()
    body, headers = signed(event_payload(customer='cus_someone_else'))
    with app.client() as client:
        data = client.post(webhook_path(), content=body, headers=headers).json()['data']
        assert data['state'] == 'ignored' and data['applied'] is False
        assert data['provider_customer_id'] == 'cus_someone_else'
        assert 'will not guess which workspace' in data['note']
        finish = only_call(app, 'billing_webhook_finish')
        assert finish['payload']['target_workspace'] is None
        assert finish['payload']['target_state'] == 'ignored'
        assert not app.rpc_calls('billing_apply_subscription')


def test_a_provider_event_tonde_cannot_read_is_ignored_rather_than_guessed_at() -> None:
    app = platform()
    body, headers = signed(event_payload(status='some_status_tonde_never_saw'))
    with app.client() as client:
        data = client.post(webhook_path(), content=body, headers=headers).json()['data']
    assert data['state'] == 'ignored' and data['applied'] is False
    assert 'not a subscription change' in data['note']
    assert not app.rpc_calls('billing_apply_subscription')
    assert only_call(app, 'billing_webhook_finish')['payload']['target_state'] == 'ignored'


def test_a_refused_subscription_change_marks_the_receipt_failed_and_does_not_swallow_the_error() -> None:
    app = platform(rpc={'billing_apply_subscription': lambda payload, token, service: httpx.Response(409, json={
        'code': 'PT409', 'message': 'A webhook receipt in failed cannot move a subscription'})})
    body, headers = signed(event_payload())
    with app.client() as client:
        response = client.post(webhook_path(), content=body, headers=headers)
        assert response.status_code == 409
        assert 'cannot move a subscription' in response.json()['errors'][0]['message']
    finish = only_call(app, 'billing_webhook_finish')
    assert finish['payload']['target_state'] == 'failed'
    assert finish['payload']['target_workspace'] == WORKSPACE
    assert finish['payload']['target_message'] == 'STUDIO_CONFLICT'


def test_the_webhook_route_needs_no_session_because_the_signature_is_the_authorization() -> None:
    app = platform()
    body, headers = signed(event_payload())
    with app.client() as client:
        assert client.post(webhook_path(), content=body, headers=headers).status_code == 200
        # The same payload without a session AND without a signature is refused, which is the point.
        assert client.post(webhook_path(), content=body).status_code == 401


# ------------------------------------------------------------------ usage ingestion and quota


def test_usage_ingestion_is_server_only() -> None:
    app = platform()
    body = {'metric': 'generation.credit', 'quantity': 2.5, 'unit': 'credit', 'cost_basis': 'estimated',
        'estimated_cost': 0.25, 'price_amount': 0.4, 'credit_units': 2.5}
    with app.client() as client:
        assert client.post(workspace_path('/usage/record'), headers=USER_HEADERS, json=body).status_code in (401, 503)
        assert client.post(workspace_path('/usage/record'), headers=SERVER_HEADERS, json=body).status_code == 200
        assert not [call for call in app.rpc_calls('usage_record') if not call['service']]
        disabled = platform(server_token=None)
        with disabled.client() as client:
            refused = client.post(workspace_path('/usage/record'), headers=SERVER_HEADERS, json=body)
            assert refused.status_code == 503
            assert refused.json()['errors'][0]['code'] == 'SERVER_TOKENS_DISABLED'
            assert not disabled.rpc_calls('usage_record')
        wrong = platform()
        with wrong.client() as client:
            refused = client.post(workspace_path('/usage/record'),
                headers={'x-tonde-server-token': 'not-the-token'}, json=body)
            assert refused.status_code == 401
            assert refused.json()['errors'][0]['code'] == 'SERVER_TOKEN_INVALID'
            assert not wrong.rpc_calls('usage_record')


def test_usage_ingestion_carries_the_cost_kind_and_is_idempotent() -> None:
    app = platform()
    body = {'metric': 'generation.credit', 'quantity': 2.5, 'unit': 'credit', 'idempotency_key': 'job-1',
        'operation': 'ai.generate', 'provider': 'test_ai', 'model': 'test-model', 'provider_cost': 1.25,
        'cost_basis': 'actual', 'currency': 'USD'}
    with app.client() as client:
        data = client.post(workspace_path('/usage/record'), headers=SERVER_HEADERS, json=body).json()['data']
        assert data['recorded'] is True and data['duplicate'] is False
        assert data['retry'] == 'REQUIRES_IDEMPOTENCY_KEY'
        record = only_call(app, 'usage_record')
        assert record['service'] is True
        assert record['payload']['target_idempotency_key'] == 'job-1'
        assert record['payload']['target_provider_cost'] == 1.25
        assert record['payload']['target_cost_basis'] == 'actual'
        assert record['payload']['target_estimated_cost'] is None

    duplicate = platform(rpc={'usage_record': lambda payload, token, service: {'usage_event_id': 'e-1',
        'recorded': False, 'duplicate': True, 'metric': payload.get('target_metric'),
        'note': 'This exact usage was already recorded; nothing was counted twice.'}})
    with duplicate.client() as client:
        data = client.post(workspace_path('/usage/record'), headers=SERVER_HEADERS, json=body).json()['data']
        assert data['duplicate'] is True and data['recorded'] is False
        assert 'nothing was counted twice' in data['note']


def test_an_actual_cost_without_an_amount_and_an_unknown_basis_with_a_cost_are_both_refused() -> None:
    app = platform()
    with app.client() as client:
        missing = client.post(workspace_path('/usage/record'), headers=SERVER_HEADERS,
            json={'metric': 'generation.credit', 'quantity': 1, 'cost_basis': 'actual'})
        assert missing.status_code == 422
        assert 'must carry the amount the provider reported' in missing.json()['errors'][0]['message']
        invented = client.post(workspace_path('/usage/record'), headers=SERVER_HEADERS,
            json={'metric': 'generation.credit', 'quantity': 1, 'cost_basis': 'unknown', 'estimated_cost': 0.5})
        assert invented.status_code == 422
        assert 'carries no cost at all' in invented.json()['errors'][0]['message']
        assert not app.rpc_calls('usage_record')


def test_quota_reservation_commit_and_release_are_server_side_and_reported() -> None:
    app = platform()
    with app.client() as client:
        reserved = client.post(workspace_path('/usage/reserve'), headers=SERVER_HEADERS, json={
            'key': 'generation.credits', 'amount': 2.5, 'operation': 'ai.generate'}).json()['data']
        assert reserved['state'] == 'reserved' and reserved['remaining_after_reservation'] == 7.5
        reserve = only_call(app, 'usage_reserve')
        assert reserve['service'] is True and reserve['payload']['target_amount'] == 2.5
        committed = client.post(workspace_path('/usage/commit'), headers=SERVER_HEADERS, json={
            'reservation_id': reserved['reservation_id'], 'actual_amount': 1.5}).json()['data']
        assert committed['state'] == 'committed' and committed['consumed_amount'] == 1.5
        assert 'settled at the amount actually used' in committed['note']
        released = client.post(workspace_path('/usage/release'), headers=SERVER_HEADERS, json={
            'reservation_id': reserved['reservation_id']}).json()['data']
        assert released['state'] == 'released'
        assert 'available again' in released['note']
        assert client.post(workspace_path('/usage/reserve'), headers=USER_HEADERS,
            json={'key': 'generation.credits', 'amount': 1}).status_code in (401, 503)


def test_a_quota_that_cannot_be_reserved_is_refused_with_the_database_reason() -> None:
    # The row lock and the overspending constraint live in the database; what is proven here is that the
    # backend surfaces the refusal instead of retrying or letting the work proceed.
    app = platform(rpc={'usage_reserve': lambda payload, token, service: httpx.Response(409, json={
        'code': 'PT409', 'message': 'ENTITLEMENT_EXHAUSTED: 1.0 of generation.credits remains and 2.5 was requested'})})
    with app.client() as client:
        response = client.post(workspace_path('/usage/reserve'), headers=SERVER_HEADERS,
            json={'key': 'generation.credits', 'amount': 2.5})
        assert response.status_code == 409
        assert '1.0 of generation.credits remains' in response.json()['errors'][0]['message']
        assert len(app.rpc_calls('usage_reserve')) == 1, 'a refused reservation is not retried inside one request'


# ------------------------------------------------------------------ cost separation


def test_cost_summary_keeps_the_four_kinds_apart() -> None:
    events = [usage_row(cost_basis='actual', provider_cost=1.25, estimated_cost=None, price_amount=None,
        credit_units=0, idempotency_key='a'),
        usage_row(cost_basis='estimated', provider_cost=None, estimated_cost=0.25, price_amount=0.4,
            credit_units=2.5, idempotency_key='b'),
        usage_row(cost_basis='unknown', provider_cost=None, estimated_cost=None, price_amount=None,
            credit_units=0, idempotency_key='c')]
    with platform(tables={'usage_events': events}).client() as client:
        data = client.get(workspace_path('/costs'), headers=USER_HEADERS).json()['data']
        assert data['actual_provider_cost'] == 1.25
        assert data['estimated_provider_cost'] == 0.25
        assert data['charged_to_creator'] == 0.4
        assert data['credits_consumed'] == 2.5
        assert data['rows'] == {'actual': 1, 'estimated': 1, 'unknown': 1}
        assert data['meaning']['estimated_provider_cost'].startswith('A cost TONDE estimated')
        assert data['meaning']['charged_to_creator'].startswith('What this workspace was charged')
        assert 'not a revenue figure' in data['note']


def test_usage_summary_groups_by_metric_without_merging_cost_kinds() -> None:
    events = [usage_row(metric='generation.credit', quantity=2.5, credit_units=2.5, estimated_cost=0.25,
        price_amount=0.4, cost_basis='estimated', idempotency_key='a'),
        usage_row(metric='generation.credit', quantity=1.5, credit_units=1.5, estimated_cost=0.15,
            price_amount=0.2, cost_basis='estimated', idempotency_key='b'),
        usage_row(metric='export.build', quantity=1, unit='export', credit_units=0, estimated_cost=None,
            price_amount=None, cost_basis='unknown', idempotency_key='c')]
    with platform(tables={'usage_events': events}).client() as client:
        data = client.get(workspace_path('/usage/summary'), headers=USER_HEADERS).json()['data']
        by_metric = {item['metric']: item for item in data['metrics']}
        assert by_metric['generation.credit']['quantity'] == 4.0
        assert by_metric['generation.credit']['estimated_provider_cost'] == 0.4
        assert by_metric['generation.credit']['charges'] == 0.6
        assert by_metric['generation.credit']['actual_provider_cost'] == 0.0
        assert by_metric['export.build']['basis_counts']['unknown'] == 1
        assert data['events'] == 3
        assert 'does not estimate a provider price it was not told' in data['note']
        rows = client.get(workspace_path('/usage'), headers=USER_HEADERS).json()['data']
        assert rows['count'] == 3


def test_usage_reads_refuse_an_unparseable_window_and_a_non_administrator() -> None:
    with platform().client() as client:
        bad = client.get(workspace_path('/usage/summary?since=yesterday'), headers=USER_HEADERS)
        assert bad.status_code == 422
        assert 'ISO-8601' in bad.json()['errors'][0]['message']
        assert client.get(workspace_path('/usage/summary?metric=generation.credit'), headers=USER_HEADERS).status_code == 200
    editor = platform(role='editor')
    with editor.client() as client:
        assert client.get(workspace_path('/usage/summary'), headers=USER_HEADERS).status_code == 403
        assert client.get(workspace_path('/costs'), headers=USER_HEADERS).status_code == 403


# ------------------------------------------------------------------ server-authority boundary


def test_there_is_no_browser_route_that_subscribes_or_grants_an_entitlement() -> None:
    app = platform()
    with app.client() as client:
        for path in ('/billing/subscription', '/billing/entitlements', '/billing/grant'):
            assert client.post(workspace_path(path), headers=USER_HEADERS, json={}).status_code in (404, 405)
        assert client.post(workspace_path('/usage/commit'), headers=USER_HEADERS,
            json={'reservation_id': '00000000-0000-4000-8000-00000000a001'}).status_code in (401, 503)
    # No RPC that moves commercial state was ever called with a creator's session.
    for name in ('billing_apply_subscription', 'billing_grant_entitlement', 'billing_revoke_entitlement',
        'usage_record', 'usage_reserve', 'usage_commit', 'usage_release'):
        assert not [call for call in app.rpc_calls(name) if not call['service']]
    assert SERVER_TOKEN not in json.dumps([call['payload'] for call in app.calls['rpc']])
    assert TOKEN_A not in json.dumps([call['payload'] for call in app.calls['rpc']])


def test_an_unauthenticated_caller_reaches_no_administrator_surface() -> None:
    with platform().client() as client:
        assert client.get(billing_path('/status')).status_code == 401
        assert client.post(billing_path('/checkout'), json={'plan_key': PLAN}).status_code == 401
        assert client.get(workspace_path('/costs')).status_code == 401
