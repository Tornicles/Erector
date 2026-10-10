"""A mock Supabase platform for the Prompt 10 backend suites.

This harness stands in for PostgREST and the guarded RPCs so the *backend's* behaviour can be proven
without a network or a hosted project: which RPC it calls, with which credential, in which order, and
what it does with the answer. It is deliberately not a reimplementation of the database's laws — those
are proven over real embedded PostgreSQL in `tests/database/prompt10-*.test.mjs`. Where a test in these
suites needs a database refusal, it registers that refusal explicitly, so the assertion is about the
backend's handling of a refusal and never pretends to be the refusal itself.

Two properties this harness makes visible that would otherwise be invisible:

* **which credential each call used.** Every recorded call carries `service: bool`, so a test can prove
  that `publication_submit`, `billing_apply_subscription` and the webhook receipt are called with the
  server credential and never with a creator's session.
* **what was asked of a provider.** The adapter boundary is exercised separately, so a test can prove a
  provider call happened only after the database recorded the attempt.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
USER_B = '00000000-0000-4000-8000-000000000002'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
WORKSPACE_B = '00000000-0000-4000-8000-000000000011'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
RESULT = '00000000-0000-4000-8000-000000000030'
MEDIA = '00000000-0000-4000-8000-000000000040'
PUBLICATION = '00000000-0000-4000-8000-000000000050'
ATTEMPT = '00000000-0000-4000-8000-000000000060'
CONNECTION = '00000000-0000-4000-8000-000000000070'
PLAN = 'studio'
CUSTOMER = 'cus_test_0001'
PROVIDER = 'test_publisher'
BILLING_PROVIDER = 'test_billing'
WH_SECRET = 'whsec_test_signing_secret'

TOKEN_A = 'user-a-session'
TOKEN_B = 'user-b-session'
SERVICE_KEY = 'service-role-key'
SERVER_TOKEN = 'server-token'

USER_HEADERS = {'Authorization': f'Bearer {TOKEN_A}'}
SERVER_HEADERS = {'x-tonde-server-token': SERVER_TOKEN}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def provider_row(**overrides: Any) -> dict[str, Any]:
    row = {'key': PROVIDER, 'name': 'Test Publisher', 'category': 'social_publishing', 'auth_type': 'oauth',
        'connection_required': True, 'adapter_state': 'verified', 'enabled': True, 'capability_version': 1,
        'media_types': ['video', 'image'], 'export_types': [], 'scopes': ['publish.video', 'publish.image'],
        'callback_required': True, 'environment': 'sandbox', 'restrictions': {'max_caption': 5000},
        'note': '', 'docs_url': ''}
    row.update(overrides)
    return row


def capability_row(**overrides: Any) -> dict[str, Any]:
    row = {'provider_key': PROVIDER, 'capability_key': 'publish', 'connection_required': True,
        'required_scopes': ['publish.video'], 'media_types': ['video'], 'export_types': [], 'enabled': True,
        'note': ''}
    row.update(overrides)
    return row


def default_tables() -> dict[str, list[dict[str, Any]]]:
    return {
        'integration_providers': [provider_row(), provider_row(key='youtube', name='YouTube',
            adapter_state='implemented', enabled=True, restrictions={})],
        'integration_provider_capabilities': [capability_row(),
            capability_row(provider_key='youtube', required_scopes=['youtube.upload'])],
        'integration_connections': [],
        'integration_oauth_states': [],
        'publications': [],
        'publication_attempts': [],
        'publication_authorizations': [],
        'publication_reconciliations': [],
        'billing_accounts': [],
        'billing_plans': [{'key': PLAN, 'name': 'Studio', 'state': 'active', 'provider': BILLING_PROVIDER,
            'provider_price_id': 'price_test_1', 'billing_interval': 'month', 'note': ''}],
        'entitlement_definitions': [],
        'workspace_entitlements': [],
        'billing_checkout_intents': [],
        'billing_webhook_events': [],
        'usage_events': [],
        'usage_reservations': [],
        'subscription_events': [],
        'media_files': [{'id': MEDIA, 'workspace_id': WORKSPACE, 'bucket': 'tonde-results',
            'object_key': f'{WORKSPACE}/{MEDIA}/result.mp4', 'original_filename': 'result.mp4',
            'mime_type': 'video/mp4', 'bytes': 2048, 'checksum': 'sha256:media-one', 'upload_state': 'uploaded',
            'file_category': 'video'}],
        'results': [{'id': RESULT, 'workspace_id': WORKSPACE, 'production_id': PRODUCTION,
            'media_id': MEDIA, 'state': 'final', 'approval': 'approved', 'revision': 4, 'provenance': 'real'}],
        'productions': [{'id': PRODUCTION, 'workspace_id': WORKSPACE, 'title': 'Marquee Film',
            'lifecycle': 'active', 'approval': 'approved', 'revision': 3}],
    }


def sign_webhook(body: bytes, secret: str = WH_SECRET, *, timestamp: int | None = None) -> tuple[str, dict[str, str]]:
    """Produce the provider's own signature envelope for a payload."""

    moment = int(datetime.now(timezone.utc).timestamp()) if timestamp is None else timestamp
    digest = hmac.new(secret.encode('utf-8'), f'{moment}.'.encode('utf-8') + body, hashlib.sha256).hexdigest()
    return f't={moment},v1={digest}', {'content-type': 'application/json', 'x-tonde-signature': f't={moment},v1={digest}'}


class _StartedApplication:
    """A context manager that starts the application exactly once and hands back the TestClient.

    The lifespan is what creates the gateway, so the application is entered on `with`, and the platform
    exposes the settings and gateway the running application uses — which lets a suite drive a service
    directly, for instance to inject an adapter that fails in one named way.
    """

    def __init__(self, platform: 'Platform') -> None:
        self.platform = platform
        self.client: TestClient | None = None

    def __enter__(self) -> TestClient:
        platform = self.platform
        settings = Settings(_env_file=None, app_env=platform.app_env,
            supabase_url='https://tonde-test.supabase.co', supabase_publishable_key='public-anon-key',
            supabase_service_role_key=platform.service_key, tonde_server_token=platform.server_token,
            billing_webhook_secrets=({BILLING_PROVIDER: platform.whsec} if platform.whsec else {}),
            integration_redirect_uri_base=platform.redirect_base)
        application = create_app(settings, httpx.MockTransport(platform.handler))
        client = TestClient(application)
        client.__enter__()
        platform.settings = settings
        platform.gateway = application.state.gateway
        self.client = client
        return client

    def __exit__(self, *exc: Any) -> None:
        if self.client is not None:
            self.client.__exit__(None, None, None)


class Platform:
    """A mock PostgREST + guarded-RPC endpoint with per-call evidence."""

    def __init__(self, *, role: str | None = 'owner', role_b: str | None = 'owner',
        service_key: str | None = SERVICE_KEY, server_token: str | None = SERVER_TOKEN,
        whsec: str | None = WH_SECRET, app_env: str = 'test', tables: dict[str, list[dict[str, Any]]] | None = None,
        rpc: dict[str, Callable[..., Any]] | None = None, entitlement: str | None = 'UNKNOWN_ENTITLEMENT',
        redirect_base: str = 'https://tonde-test.app') -> None:
        self.calls: dict[str, list[dict[str, Any]]] = {'rpc': [], 'rest': [], 'storage': []}
        members: list[dict[str, Any]] = []
        if role:
            members.append({'workspace_id': WORKSPACE, 'user_id': USER, 'role': role})
        if role_b:
            members.append({'workspace_id': WORKSPACE_B, 'user_id': USER_B, 'role': role_b})
        self.tables = {**default_tables(), 'workspace_members': members, **(tables or {})}
        self.rpc_handlers: dict[str, Callable[..., Any]] = {
            'entitlement_state': self._entitlement_state,
            'integration_capability_state': self._capability_state,
            **(rpc or {})}
        self.role = role
        self.role_b = role_b
        self.service_key = service_key
        self.server_token = server_token
        self.whsec = whsec
        self.app_env = app_env
        self.entitlement = entitlement
        self.redirect_base = redirect_base
        self.sequence: list[str] = []
        self.settings: Settings | None = None
        self.gateway: Any = None

    # ------------------------------------------------------------------ RPC emulation

    def _entitlement_state(self, payload: dict[str, Any], token: str, service: bool) -> Any:
        if self.entitlement is None:
            return httpx.Response(404, json={'code': 'PGRST202',
                'message': 'Could not find the function public.entitlement_state'})
        return self.entitlement

    def _capability_state(self, payload: dict[str, Any], token: str, service: bool) -> Any:
        """Mirror the shape of the database's answer from the rows this platform holds."""

        provider_key = str(payload.get('target_provider'))
        capability_key = str(payload.get('target_capability'))
        workspace = str(payload.get('target_workspace'))
        providers = [row for row in self.tables['integration_providers'] if row['key'] == provider_key]
        if not providers:
            return 'UNKNOWN_PROVIDER'
        provider = providers[0]
        if not provider.get('enabled') or provider.get('adapter_state') != 'verified':
            return 'PROVIDER_NOT_IMPLEMENTED'
        capabilities = [row for row in self.tables['integration_provider_capabilities']
            if row['provider_key'] == provider_key and row['capability_key'] == capability_key]
        if not capabilities:
            return 'UNKNOWN_CAPABILITY'
        capability = capabilities[0]
        if not capability.get('enabled'):
            return 'CAPABILITY_DISABLED'
        if not capability.get('connection_required'):
            return 'AVAILABLE'
        connections = [row for row in self.tables['integration_connections']
            if row.get('workspace_id') == workspace and row.get('provider') == provider_key]
        connected = [row for row in connections if row.get('status') == 'connected']
        if not connected:
            return 'CONNECTION_NOT_READY'
        granted = set(connected[0].get('scopes') or [])
        missing = [scope for scope in (capability.get('required_scopes') or []) if scope not in granted]
        return 'MISSING_SCOPE' if missing else 'AVAILABLE'

    # ------------------------------------------------------------------ REST emulation

    def _rest(self, request: httpx.Request, table: str) -> httpx.Response:
        header = request.headers.get('authorization', '')
        service = bool(self.service_key) and header.endswith(str(self.service_key))
        token = header.replace('Bearer ', '')
        user = {TOKEN_A: USER, TOKEN_B: USER_B}.get(token)
        rows = self.tables.setdefault(table, [])
        params = dict(request.url.params)
        self.calls['rest'].append({'table': table, 'method': request.method, 'params': params,
            'service': service, 'token': token, 'sequence': len(self.calls['rest'])})
        self.sequence.append(f'{request.method} {table}')
        if not service and user is None:
            return httpx.Response(401, json={'message': 'no session'})
        if request.method == 'GET':
            matched = [row for row in rows if self._matches(row, params)]
            order = params.get('order') or ''
            if order:
                field, _, direction = order.partition('.')
                matched = sorted(matched, key=lambda row: str(row.get(field) or ''),
                    reverse=direction == 'desc')
            limit = params.get('limit')
            if limit:
                matched = matched[:int(limit)]
            return httpx.Response(200, json=matched)
        if request.method == 'POST':
            payload = json.loads(request.content or b'{}')
            created = payload if isinstance(payload, list) else [payload]
            for row in created:
                row.setdefault('id', str(uuid4()))
                row.setdefault('created_at', now())
                row.setdefault('updated_at', row['created_at'])
                rows.append(row)
            if 'return=minimal' in (request.headers.get('prefer') or ''):
                return httpx.Response(201)
            return httpx.Response(201, json=created)
        if request.method == 'PATCH':
            payload = json.loads(request.content or b'{}')
            matched = [row for row in rows if self._matches(row, params)]
            for row in matched:
                row.update(payload)
                row['updated_at'] = now()
            if 'return=minimal' in (request.headers.get('prefer') or ''):
                return httpx.Response(204)
            return httpx.Response(200, json=matched)
        if request.method == 'DELETE':
            matched = [row for row in rows if self._matches(row, params)]
            for row in matched:
                rows.remove(row)
            return httpx.Response(200, json=matched)
        return httpx.Response(405, json={'message': 'unsupported'})

    @staticmethod
    def _matches(row: dict[str, Any], params: dict[str, str]) -> bool:
        for key, value in params.items():
            if key in ('select', 'order', 'limit', 'offset', 'on_conflict'):
                continue
            actual = row.get(key)
            if value.startswith('eq.'):
                if actual is None or str(actual) != value[3:]:
                    return False
            elif value.startswith('in.('):
                wanted = value[4:-1].split(',')
                if str(actual) not in wanted:
                    return False
            elif value.startswith('is.'):
                expected = value[3:]
                if expected == 'null' and actual is not None:
                    return False
                if expected == 'true' and actual is not True:
                    return False
            elif value.startswith('lte.'):
                if actual is None or str(actual) > value[4:]:
                    return False
            elif value.startswith('gte.'):
                if actual is None or str(actual) < value[4:]:
                    return False
            elif value.startswith('not.is.'):
                if actual is None:
                    return False
        return True

    # ------------------------------------------------------------------ routing

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            token = request.headers.get('authorization', '').replace('Bearer ', '')
            user = {TOKEN_A: USER, TOKEN_B: USER_B}.get(token)
            if user is None:
                return httpx.Response(401, json={'message': 'invalid session'})
            return httpx.Response(200, json={'id': user})
        if path == '/rest/v1/workspace_members':
            # Membership reads are RLS-scoped in the real database; the mock mirrors only the filter the
            # backend asks for, so a test proves the backend asked for the right workspace and user.
            return self._rest(request, 'workspace_members')
        if path.startswith('/rest/v1/rpc/'):
            name = path.rsplit('/', 1)[-1]
            payload = json.loads(request.content or b'{}')
            header = request.headers.get('authorization', '')
            service = bool(self.service_key) and header.endswith(str(self.service_key))
            self.calls['rpc'].append({'name': name, 'payload': payload, 'service': service,
                'token': header.replace('Bearer ', '')})
            self.sequence.append(f'RPC {name}')
            handler = self.rpc_handlers.get(name)
            if handler is None:
                return httpx.Response(404, json={'code': 'PGRST202',
                    'message': f'Could not find the function public.{name}'})
            result = handler(payload, header.replace('Bearer ', ''), service)
            if isinstance(result, httpx.Response):
                return result
            return httpx.Response(200, json=result)
        if path.startswith('/rest/v1/'):
            return self._rest(request, path.rsplit('/', 1)[-1])
        if path.startswith('/storage/v1/'):
            self.calls['storage'].append({'method': request.method, 'path': path})
            return httpx.Response(200, json={'signedURL': '/object/sign/x?token=short-lived'})
        return httpx.Response(404, json={'message': 'not found'})

    # ------------------------------------------------------------------ helpers

    def rpc_calls(self, name: str) -> list[dict[str, Any]]:
        return [call for call in self.calls['rpc'] if call['name'] == name]

    def client(self) -> '_StartedApplication':
        return _StartedApplication(self)


def seed_publication(**overrides: Any) -> dict[str, Any]:
    row = {'id': PUBLICATION, 'workspace_id': WORKSPACE, 'production_id': PRODUCTION, 'production_revision': 3,
        'result_id': RESULT, 'result_revision': 4, 'media_id': MEDIA, 'media_checksum': 'sha256:media-one',
        'destination_provider': PROVIDER, 'destination_account_id': CONNECTION, 'destination': 'channel-1',
        'destination_config': {}, 'media_type': 'video', 'visibility': 'public', 'scheduled_for': None,
        'title': 'Marquee Film', 'caption': 'A keeper loses the light.', 'state': 'ready',
        'authorization_id': '00000000-0000-4000-8000-00000000008a', 'operation_id': 'op-1', 'idempotency_key': 'idem-1',
        'submission_attempts': 0, 'last_attempt_at': None, 'submitted_at': None, 'remote_resource_type': '',
        'remote_resource_id': None, 'remote_url': None, 'remote_state': '', 'last_checked_at': None,
        'published_at': None, 'failed_at': None, 'failure_category': None, 'failure_code': None,
        'failure_message': None, 'cancelled_at': None, 'removed_at': None, 'created_by': USER,
        'created_at': '2026-10-08T10:00:00+00:00', 'updated_at': '2026-10-08T10:00:00+00:00'}
    row.update(overrides)
    return row


def seed_connection(**overrides: Any) -> dict[str, Any]:
    row = {'id': CONNECTION, 'workspace_id': WORKSPACE, 'provider': PROVIDER, 'provider_account_id': 'acct-1',
        'status': 'connected', 'scopes': ['publish.video'], 'connected_by': USER, 'created_at': now(),
        'updated_at': now(), 'auth_type': 'oauth', 'external_account_label': 'Test destination account',
        'requested_scopes': ['publish.video', 'publish.image'], 'verified_at': now(), 'last_success_at': now(),
        'last_error_at': None, 'last_error_code': None, 'revoked_at': None,
        'metadata': {'credential_reference': 'vault/test-publisher'}}
    row.update(overrides)
    return row


def seed_authorization(**overrides: Any) -> dict[str, Any]:
    row = {'id': '00000000-0000-4000-8000-00000000008a', 'workspace_id': WORKSPACE, 'publication_id': PUBLICATION,
        'decision': 'authorize', 'actor_user_id': USER, 'authorized_at': now(), 'production_revision': 3,
        'result_revision': 4, 'media_id': MEDIA, 'media_checksum': 'sha256:media-one',
        'destination_provider': PROVIDER, 'destination': 'channel-1', 'note': ''}
    row.update(overrides)
    return row


def usage_row(**overrides: Any) -> dict[str, Any]:
    row = {'id': str(uuid4()), 'workspace_id': WORKSPACE, 'metric': 'generation.credit', 'quantity': 2.5,
        'unit': 'credit', 'idempotency_key': 'k-1', 'operation': 'ai.generate', 'provider': 'test_ai',
        'model': 'test-model', 'production_id': None, 'actor_user_id': None, 'provider_cost': None,
        'estimated_cost': 0.25, 'price_amount': 0.4, 'credit_units': 2.5, 'currency': 'USD',
        'cost_basis': 'estimated', 'source_event_id': None, 'attempt_id': None,
        'created_at': '2026-10-08T10:00:00+00:00'}
    row.update(overrides)
    return row
