"""Prompt 10 integrations backend coverage (§3-14, §20, §63, §86, §88).

What is proven here, and how:

* the route-level laws — truthful provider status, hash-only OAuth state, single-use state, workspace and
  subject binding, replay refusal, connect-verify-connect, disconnect, reauthorize, scope explanations,
  rate limiting — over the mock platform, asserting the exact RPC and REST calls the backend makes;
* the adapter-driven laws — credential expiry, timeout, normalized failure taxonomy, the exchange
  refusals — against injected adapters that obey the same interface and raise the same named errors.

What is *not* claimed here: that the database refuses a client write to the credential or OAuth-state
tables, that a CONNECTED row is impossible without a verified adapter, or that scopes are a subset of what
was requested. Those are database laws, proven over real embedded PostgreSQL in
`tests/database/prompt10-integrations.test.mjs`. And nothing here claims a real provider accepted
anything: no real provider credential exists in this environment, which is why the adapters that do make
a real call are the ones reported as unconfigured.
"""

from __future__ import annotations

import asyncio
import hashlib
from typing import Any

from app.services.integration_adapters import (DeterministicTestAdapter, ProviderCallFailed, ProviderTimeout,
    Verification)
from app.services.integrations import IntegrationService
from tests.prompt10_harness import (CONNECTION, PROVIDER, TOKEN_A, TOKEN_B, USER, USER_B, USER_HEADERS, Platform,
    WORKSPACE, WORKSPACE_B, seed_connection)

def ASH(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def base(workspace: str = WORKSPACE) -> str:
    return f'/api/v1/workspaces/{workspace}/integrations'


class FailingAdapter:
    """An adapter that obeys the interface and fails in one named way. It makes no network call."""

    key = PROVIDER
    categories = ('social_publishing',)

    def __init__(self, failure: str, *, scopes: list[str] | None = None) -> None:
        self.failure = failure
        self.scopes = scopes or ['publish.video']

    def configured(self) -> bool:
        return True

    def unconfigured_reasons(self) -> list[str]:
        return []

    def _raise(self) -> None:
        if self.failure == 'timeout':
            raise ProviderTimeout('The provider did not answer.')
        raise ProviderCallFailed('authentication_failed', 'The provider refused the credential.',
            provider_code='invalid_grant')

    def authorize_url(self, **_: Any) -> Any:
        from app.services.integration_adapters import Authorization
        return Authorization('https://failing.invalid/authorize', [], '')

    async def exchange_code(self, **_: Any) -> Verification:
        self._raise()

    async def verify(self, **_: Any) -> Verification:
        self._raise()

    async def revoke(self, **_: Any) -> bool:
        self._raise()

    async def submit(self, request: Any) -> Any:
        self._raise()

    async def remote_state(self, **_: Any) -> Any:
        self._raise()


# ------------------------------------------------------------------ catalog truth


def test_vocabulary_states_the_credential_law_and_the_retry_classifications() -> None:
    platform = Platform()
    with platform.client() as client:
        data = client.get(f'{base()}/vocabulary', headers=USER_HEADERS).json()['data']
        assert 'stores no provider credential' in data['credential_law']
        assert 'does not refresh provider tokens' in data['token_refresh_boundary']
        assert 'only their hashes' in data['oauth_state_law']
        assert data['retry']['oauth_exchange'] == 'MUST_NOT_RETRY'
        assert data['retry']['provider_verify'] == 'SAFE_TO_RETRY'
        assert data['connection_states']['connected'].startswith('The provider confirmed')


def test_provider_status_reports_this_deployment_truthfully() -> None:
    platform = Platform()
    with platform.client() as client:
        data = client.get(f'{base()}/providers', headers=USER_HEADERS).json()['data']
        by_key = {item['key']: item for item in data['items']}
        assert by_key[PROVIDER]['adapter']['adapter_present'] is True
        assert by_key[PROVIDER]['adapter']['configured'] is True
        assert by_key[PROVIDER]['connection_available'] is True
        # A provider whose adapter exists but was never exercised against the real provider: the
        # deployment has no credentials, so the adapter is named as unconfigured rather than omitted.
        youtube = by_key['youtube']
        assert youtube['adapter']['adapter_present'] is True
        assert youtube['adapter']['configured'] is False
        assert youtube['adapter']['unconfigured_dependencies'] == ['provider_credentials']
        assert youtube['adapter_state'] == 'implemented'
        assert data['vocabulary']['adapter_states']['implemented'].endswith('real provider.')


# ------------------------------------------------------------------ OAuth boundary


def test_oauth_initiation_stores_only_hashes_and_returns_the_state_once() -> None:
    platform = Platform()
    with platform.client() as client:
        response = client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json={
            'provider': PROVIDER, 'redirect_uri': 'https://tonde-test.app/studio/integrations/callback',
            'requested_scopes': ['publish.video']})
        data = response.json()['data']
        assert response.status_code == 200 and data['initiated'] is True
        state, verifier = data['state'], data['verifier']
        assert state and verifier and data['authorize_url'].startswith('https://test-adapter.invalid/authorize')
        assert data['retry'] == 'MUST_NOT_RETRY'
        assert data['expires_in_minutes'] == 15
        stored = platform.tables['integration_oauth_states']
        assert len(stored) == 1
        row = stored[0]
        assert row['state_hash'] == ASH(state) and len(row['state_hash']) == 64
        assert row['verifier_hash'] == ASH(verifier)
        # The raw state and verifier are never persisted: a database leak cannot replay a flow.
        flattened = ' '.join(str(value) for value in row.values())
        assert state not in flattened and verifier not in flattened
        assert row['requested_scopes'] == ['publish.video']
        assert row['user_id'] == USER and row['workspace_id'] == WORKSPACE
        assert row['expires_at'] > row['created_at'] if row.get('created_at') else True
        assert data['credential_storage'].startswith('TONDE stores no provider credential')


def test_initiation_reports_an_unconfigured_provider_and_records_no_state() -> None:
    platform = Platform()
    with platform.client() as client:
        data = client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json={
            'provider': 'youtube', 'redirect_uri': 'https://tonde-test.app/callback'}).json()['data']
        assert data['initiated'] is False and data['authorize_url'] is None and data['state'] is None
        assert data['unconfigured'] == ['provider_credentials']
        assert data['note'] == 'The authorization URL cannot be produced: provider_credentials.'
        assert platform.tables['integration_oauth_states'] == []


def test_initiation_without_a_callback_address_starts_nothing() -> None:
    platform = Platform(redirect_base='')
    with platform.client() as client:
        data = client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json={'provider': PROVIDER}).json()['data']
        assert data['initiated'] is False and data['unconfigured'] == ['integration_callback_url']
        assert platform.tables['integration_oauth_states'] == []


def test_callback_connects_only_after_the_state_is_validated_and_consumed() -> None:
    platform = Platform()
    with platform.client() as client:
        initiated = client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json={
            'provider': PROVIDER, 'redirect_uri': 'https://tonde-test.app/callback',
            'requested_scopes': ['publish.video', 'publish.image']}).json()['data']
        response = client.post(f'{base()}/oauth/callback', headers=USER_HEADERS, json={
            'state': initiated['state'], 'code': 'provider-code-1', 'account_label': 'Studio channel',
            'credential_reference': 'vault/test-publisher'})
        data = response.json()['data']
        assert response.status_code == 200 and data['connected'] is True and data['verified'] is True
        assert data['status'] == 'connected' and data['via'] == 'oauth_callback'
        assert data['granted_scopes'] == ['publish.video'] or set(data['granted_scopes']) <= {'publish.video', 'publish.image'}
        assert data['credential_reference_recorded'] is True
        assert data['credential_storage'] == 'reference_only'
        assert 'does not refresh provider tokens' in data['token_refresh_boundary']
        # The state is consumed by the caller's own identity, and the connection is written with the
        # server credential, never with the creator's session.
        consumed = platform.tables['integration_oauth_states'][0]
        assert consumed['consumed_at'] and consumed['consumed_by'] == USER
        connection_writes = [call for call in platform.calls['rest']
            if call['table'] == 'integration_connections' and call['method'] in ('POST', 'PATCH')]
        assert connection_writes and all(call['service'] for call in connection_writes)
        state_calls = [call for call in platform.calls['rest'] if call['table'] == 'integration_oauth_states']
        assert state_calls and all(call['service'] for call in state_calls), \
            'OAuth state is server-only; a creator session never touches it'
        # No credential is stored: only the reference the deployment vault owns.
        stored_metadata = platform.tables['integration_connections'][0]['metadata']
        assert stored_metadata['credential_reference'] == 'vault/test-publisher'
        assert stored_metadata['credential_storage'] == 'reference_only'


def test_callback_refuses_an_unknown_state() -> None:
    platform = Platform()
    with platform.client() as client:
        response = client.post(f'{base()}/oauth/callback', headers=USER_HEADERS, json={
            'state': 'a-state-tonde-never-issued', 'code': 'x'})
        assert response.status_code == 409
        assert response.json()['errors'][0]['code'] == 'OAUTH_STATE_UNKNOWN'
        assert 'does not match a flow this deployment started' in response.json()['errors'][0]['message']
        assert platform.tables['integration_connections'] == []


def test_callback_refuses_a_replayed_state() -> None:
    platform = Platform()
    state = 'replayed-state-value'
    platform.tables['integration_oauth_states'] = [{'id': 'state-1', 'workspace_id': WORKSPACE, 'user_id': USER,
        'provider_key': PROVIDER, 'state_hash': ASH(state), 'verifier_hash': ASH('verifier'),
        'redirect_uri': 'https://tonde-test.app/callback', 'requested_scopes': ['publish.video'],
        'created_at': '2026-10-08T09:00:00+00:00', 'expires_at': '2026-10-08T09:15:00+00:00',
        'consumed_at': '2026-10-08T09:05:00+00:00', 'consumed_by': USER}]
    with platform.client() as client:
        response = client.post(f'{base()}/oauth/callback', headers=USER_HEADERS, json={'state': state, 'code': 'c'})
        assert response.status_code == 409
        assert response.json()['errors'][0]['code'] == 'OAUTH_STATE_REPLAYED'
        assert platform.tables['integration_connections'] == []


def test_callback_refuses_an_expired_state() -> None:
    platform = Platform()
    state = 'expired-state-value-1'
    platform.tables['integration_oauth_states'] = [{'id': 'state-2', 'workspace_id': WORKSPACE, 'user_id': USER,
        'provider_key': PROVIDER, 'state_hash': ASH(state), 'verifier_hash': ASH('verifier'),
        'redirect_uri': 'https://tonde-test.app/callback', 'requested_scopes': [], 'consumed_at': None,
        'created_at': '2026-10-01T09:00:00+00:00', 'expires_at': '2026-10-01T09:15:00+00:00'}]
    with platform.client() as client:
        response = client.post(f'{base()}/oauth/callback', headers=USER_HEADERS, json={'state': state, 'code': 'c'})
        assert response.status_code == 409
        assert response.json()['errors'][0]['code'] == 'OAUTH_STATE_EXPIRED'


def test_callback_refuses_a_state_that_belongs_to_another_workspace_or_user() -> None:
    platform = Platform(tables={'workspace_members': [
        {'workspace_id': WORKSPACE, 'user_id': USER, 'role': 'owner'},
        {'workspace_id': WORKSPACE, 'user_id': USER_B, 'role': 'editor'},
        {'workspace_id': WORKSPACE_B, 'user_id': USER, 'role': 'editor'}]})
    with platform.client() as client:
        initiated = client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json={
            'provider': PROVIDER, 'redirect_uri': 'https://tonde-test.app/callback'}).json()['data']
        wrong_workspace = client.post(f'{base(WORKSPACE_B)}/oauth/callback', headers=USER_HEADERS, json={
            'state': initiated['state'], 'code': 'c'})
        assert wrong_workspace.status_code == 403
        assert wrong_workspace.json()['errors'][0]['code'] == 'OAUTH_STATE_WORKSPACE_MISMATCH'
        wrong_user = client.post(f'{base()}/oauth/callback',
            headers={'Authorization': f'Bearer {TOKEN_B}'}, json={'state': initiated['state'], 'code': 'c'})
        assert wrong_user.status_code == 403
        assert wrong_user.json()['errors'][0]['code'] == 'OAUTH_STATE_SUBJECT_MISMATCH'
        assert platform.tables['integration_connections'] == []


# ------------------------------------------------------------------ connect / verify / revoke


def test_connect_records_a_reference_verifies_and_never_stores_a_secret() -> None:
    platform = Platform()
    with platform.client() as client:
        data = client.post(f'{base()}/connections', headers=USER_HEADERS, json={
            'provider': PROVIDER, 'credential_reference': 'vault/test-publisher', 'account_label': 'Studio channel',
            'requested_scopes': ['publish.video']}).json()['data']
        assert data['connected'] is True and data['verified'] is True
        assert data['status'] == 'connected' and data['via'] == 'verify'
        row = platform.tables['integration_connections'][0]
        assert row['metadata'] == {'credential_reference': 'vault/test-publisher', 'credential_storage': 'reference_only'}
        assert row['status'] == 'connected' and row['verified_at']
        assert row['connected_by'] == USER
        # A literal secret is refused before any call, so a credential can never be recorded in the open.
        refused = client.post(f'{base()}/connections', headers=USER_HEADERS, json={
            'provider': PROVIDER, 'credential_reference': 'sk-live-abcdef'})
        assert refused.status_code == 422
        assert 'never the credential itself' in refused.json()['errors'][0]['message']
        assert len(platform.tables['integration_connections']) == 1


def test_verifying_an_unknown_connection_is_a_not_found_and_another_workspace_sees_nothing() -> None:
    platform = Platform(tables={'integration_connections': [seed_connection()]})
    with platform.client() as client:
        missing = client.post(f'{base()}/connections/00000000-0000-4000-8000-0000000000ff/verify',
            headers=USER_HEADERS)
        assert missing.status_code == 404
        cross = client.get(f'{base(WORKSPACE_B)}/connections', headers={'Authorization': f'Bearer {TOKEN_B}'})
        assert cross.json()['data']['items'] == []
        detail = client.get(f'{base(WORKSPACE_B)}/connections/{CONNECTION}',
            headers={'Authorization': f'Bearer {TOKEN_B}'})
        assert detail.status_code == 404


def test_disconnect_revokes_records_the_reason_and_keeps_history() -> None:
    platform = Platform(tables={'integration_connections': [seed_connection()]})
    with platform.client() as client:
        data = client.post(f'{base()}/connections/{CONNECTION}/disconnect', headers=USER_HEADERS,
            json={'reason': 'The channel is being retired.'}).json()['data']
        assert data['status'] == 'revoked' and data['revoked_at']
        assert data['previous_status'] == 'connected' and data['remote_revoked'] is True
        assert data['retry'] == 'SAFE_TO_RETRY'
        row = platform.tables['integration_connections'][0]
        assert row['status'] == 'revoked' and row['scopes'] == []
        assert row['metadata']['disconnect_reason'] == 'The channel is being retired.'
        assert 'no longer authorizes publishing' in data['note']


def test_reauthorize_waits_for_a_fresh_verification_before_connected() -> None:
    platform = Platform(tables={'integration_connections': [
        seed_connection(status='reauth_required', scopes=[], verified_at=None, last_error_code='authentication_failed')]})
    with platform.client() as client:
        cleared = client.post(f'{base()}/connections/{CONNECTION}/reauthorize', headers=USER_HEADERS,
            json={}).json()['data']
        assert cleared['status'] == 'pending' and cleared['connected'] is False
        assert cleared['state'] == 'awaiting_verification'
        assert 'waiting for a new one' in cleared['note']
        assert cleared['retry'] == 'MUST_NOT_RETRY'
        row = platform.tables['integration_connections'][0]
        assert row['status'] == 'pending' and row['last_error_code'] is None
        assert row['verified_at'] is None, 'clearing the authorization also clears the verification it carried'

        reauthorized = client.post(f'{base()}/connections/{CONNECTION}/reauthorize', headers=USER_HEADERS,
            json={'credential_reference': 'vault/test-publisher-2',
                'requested_scopes': ['publish.video']}).json()['data']
        assert reauthorized['connected'] is True and reauthorized['reauthorized'] is True
        assert reauthorized['previous_status'] == 'pending'
        row = platform.tables['integration_connections'][0]
        assert row['metadata']['credential_reference'] == 'vault/test-publisher-2'


def test_the_capability_matrix_explains_a_missing_scope_instead_of_hiding_it() -> None:
    platform = Platform(tables={'integration_connections': [seed_connection(scopes=[])]})
    with platform.client() as client:
        data = client.get(f'{base()}/providers/{PROVIDER}/capabilities', headers=USER_HEADERS).json()['data']
        assert data['granted_scopes'] == []
        publish = data['capabilities'][0]
        assert publish['state']['state'] == 'MISSING_SCOPE' and publish['state']['available'] is False
        assert publish['missing_scopes'] == ['publish.video']
        assert 'reauthorize' in publish['state']['meaning']
        connected_only = Platform(tables={'integration_connections': [seed_connection(scopes=['publish.video'])]})
        with connected_only.client() as client:
            data = client.get(f'{base()}/providers/{PROVIDER}/capabilities', headers=USER_HEADERS).json()['data']
            assert data['capabilities'][0]['state']['available'] is True
            assert data['capabilities'][0]['missing_scopes'] == []


def test_an_unavailable_provider_is_reported_and_never_recorded_as_connected() -> None:
    platform = Platform()
    with platform.client() as client:
        data = client.post(f'{base()}/connections', headers=USER_HEADERS,
            json={'provider': 'youtube', 'credential_reference': 'vault/youtube'}).json()['data']
        assert data['connected'] is False and data['verified'] is False
        assert data['unconfigured'] == ['provider_credentials']
        assert 'nothing was attempted' in data['note']
        assert all(row.get('status') != 'connected' for row in platform.tables['integration_connections'])
        assert 'no provider credential' in data['note'].lower() or 'has not configured' in data['note']


def test_a_revoked_connection_cannot_be_verified_back_into_service() -> None:
    platform = Platform(tables={'integration_connections': [seed_connection(status='revoked', revoked_at='2026-10-08T09:00:00+00:00')]})
    with platform.client() as client:
        data = client.post(f'{base()}/connections/{CONNECTION}/verify', headers=USER_HEADERS).json()['data']
        assert data['connected'] is False and data['status'] == 'revoked'
        assert 'Reauthorize it before verifying' in data['note']


# ------------------------------------------------------------------ adapter-driven failures


def _service(platform: Platform, registry: Any) -> tuple[IntegrationService, Any]:
    settings = platform.settings
    return IntegrationService(platform.gateway, settings, registry=registry), settings


def test_an_expired_credential_moves_the_connection_to_reauth_required() -> None:
    platform = Platform(tables={'integration_connections': [seed_connection(status='connected')]})
    with platform.client():
        service = IntegrationService(platform.gateway, platform.settings,
            registry=_Registry({PROVIDER: FailingAdapter('invalid_grant')}))
        try:
            asyncio.run(service.verify(WORKSPACE, USER, TOKEN_A, CONNECTION))
        except Exception as error:  # the refusal is the assertion below
            assert getattr(error, 'code', '') == 'PROVIDER_VERIFICATION_FAILED'
            assert getattr(error, 'status_code', 0) == 502
        else:  # pragma: no cover - the refusal above is the assertion
            raise AssertionError('A refused verification must not report the connection as connected')
        row = platform.tables['integration_connections'][0]
        assert row['status'] == 'reauth_required'
        assert row['last_error_code'] == 'invalid_grant' and row['last_error_at']
        # The current verification witness is cleared, so CONNECTED cannot ride an older verification…
        assert row['verified_at'] is None and row['scopes'] == []
        # …while when it last worked is kept, because erasing that would destroy the history.
        assert row['last_success_at'] is not None


def test_a_provider_timeout_is_a_timeout_and_marks_the_connection_for_attention() -> None:
    platform = Platform(tables={'integration_connections': [seed_connection(status='connected')]})
    with platform.client():
        service = IntegrationService(platform.gateway, platform.settings,
            registry=_Registry({PROVIDER: FailingAdapter('timeout')}))
        try:
            asyncio.run(service.verify(WORKSPACE, USER, TOKEN_A, CONNECTION))
        except Exception as error:
            assert getattr(error, 'code', '') == 'PROVIDER_TIMEOUT'
            assert getattr(error, 'status_code', 0) == 504
        else:  # pragma: no cover - the refusal above is the assertion
            raise AssertionError('A provider timeout must be reported as a timeout')
        row = platform.tables['integration_connections'][0]
        assert row['status'] == 'error' and row['last_error_code'] == 'provider_timeout'


def test_an_authorization_exchange_timeout_and_refusal_are_distinct_outcomes() -> None:
    platform = Platform()
    with platform.client() as client:
        initiated = client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json={
            'provider': PROVIDER, 'redirect_uri': 'https://tonde-test.app/callback'}).json()['data']
        timed_out = IntegrationService(platform.gateway, platform.settings,
            registry=_Registry({PROVIDER: FailingAdapter('timeout')}))
        try:
            asyncio.run(timed_out.callback(WORKSPACE, USER, TOKEN_A, _callback_body(initiated['state'])))
        except Exception as error:
            assert getattr(error, 'code', '') == 'OAUTH_EXCHANGE_TIMEOUT'
            assert getattr(error, 'status_code', 0) == 504
        else:  # pragma: no cover - the refusal above is the assertion
            raise AssertionError('A timed-out exchange must be reported as a timeout')
        # The state was consumed before the exchange, so the same code cannot be presented again.
        assert platform.tables['integration_oauth_states'][0]['consumed_at'] is not None
        assert platform.tables['integration_connections'] == []

    second = Platform()
    with second.client() as client:
        initiated = client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json={
            'provider': PROVIDER, 'redirect_uri': 'https://tonde-test.app/callback'}).json()['data']
        refused = IntegrationService(second.gateway, second.settings,
            registry=_Registry({PROVIDER: FailingAdapter('invalid_grant')}))
        try:
            asyncio.run(refused.callback(WORKSPACE, USER, TOKEN_A, _callback_body(initiated['state'])))
        except Exception as error:
            assert getattr(error, 'code', '') == 'OAUTH_EXCHANGE_REFUSED'
            assert getattr(error, 'status_code', 0) == 502
            assert 'authentication_failed' in getattr(error, 'user_message', '')
        else:  # pragma: no cover - the refusal above is the assertion
            raise AssertionError('A refused exchange must be reported as a refusal')
        assert second.tables['integration_connections'] == []


def test_an_unrequested_grant_is_not_recorded_as_if_it_had_been_requested() -> None:
    platform = Platform()
    with platform.client():
        adapter = DeterministicTestAdapter(PROVIDER, behavior={'granted_scopes': ['publish.video', 'admin.everything']})
        service = IntegrationService(platform.gateway, platform.settings, registry=_Registry({PROVIDER: adapter}))
        result = asyncio.run(service.connect(WORKSPACE, USER, TOKEN_A, _connect_request(['publish.video'])))
        assert result['connected'] is True
        assert result['unrequested_scopes_ignored'] == ['admin.everything']
        assert platform.tables['integration_connections'][0]['scopes'] == ['publish.video']


# ------------------------------------------------------------------ rate limiting


def test_repeated_authorization_initiations_are_rate_limited_with_a_real_hint() -> None:
    platform = Platform()
    with platform.client() as client:
        body = {'provider': PROVIDER, 'redirect_uri': 'https://tonde-test.app/callback'}
        statuses = [client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json=body).status_code
            for _ in range(21)]
        assert statuses[:20] == [200] * 20
        assert statuses[20] == 429
        rejected = client.post(f'{base()}/oauth/initiate', headers=USER_HEADERS, json=body).json()['errors'][0]
        assert rejected['code'] == 'RATE_LIMITED' and 'Try again in' in rejected['message']


def test_unauthenticated_and_viewer_callers_reach_nothing() -> None:
    platform = Platform(role='viewer')
    # A viewer is a workspace member but not an editor: reads work, writes are refused before any RPC.
    with platform.client() as client:
        assert client.get(f'{base()}/providers').status_code == 401
        assert client.post(f'{base()}/connections', headers=USER_HEADERS, json={'provider': PROVIDER}).status_code == 403
        assert platform.tables['integration_connections'] == []
        assert platform.calls['rpc'] == []


class _Registry:
    """A registry that returns one injected adapter and the truthful fallback for anything else."""

    def __init__(self, adapters: dict[str, Any]) -> None:
        self.adapters = adapters

    def get(self, provider_key: str) -> Any:
        if provider_key in self.adapters:
            return self.adapters[provider_key]
        from app.services.integration_adapters import UnconfiguredAdapter
        return UnconfiguredAdapter(provider_key)

    def describe(self, provider_key: str) -> dict[str, Any]:
        adapter = self.adapters.get(provider_key)
        return {'provider': provider_key, 'adapter_present': adapter is not None,
            'configured': bool(adapter and adapter.configured()),
            'unconfigured_dependencies': adapter.unconfigured_reasons() if adapter else ['provider_credentials'],
            'network_calls': False}

    def keys(self) -> list[str]:
        return sorted(self.adapters)


def _connect_request(scopes: list[str]) -> Any:
    from app.domain.integrations import ConnectRequest
    return ConnectRequest(provider=PROVIDER, credential_reference='vault/test-publisher',
        account_label='Studio channel', requested_scopes=scopes)


def _callback_body(state: str) -> Any:
    from app.domain.integrations import OAuthCallbackRequest
    return OAuthCallbackRequest(state=state, code='provider-code-1', credential_reference='vault/test-publisher')
