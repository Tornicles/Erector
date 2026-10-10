"""Prompt 10 publishing backend coverage (§15-23, §52-53, §87-88).

The properties proven here are the ones a surface could quietly get wrong:

* **the creator's authority is a separate, recorded act** — a creative approval cannot be posted in its
  place, and the request model has no field through which one could travel;
* **refusal happens before claiming** — an unusable capability, a non-empty blocker list or an
  unconfigured adapter means no attempt is recorded and no provider is called;
* **the attempt carries the publication's own idempotency identity**, so a retry reproduces the same
  operation rather than creating a second post;
* **the destination's answer is recorded as it was** — including `unknown`, which is never dressed up as
  a success or as a failure;
* **only the trusted server performs the call and records the outcome** — every submission and result
  record uses the service credential, never a creator's session.

The database's own laws — the fingerprint comparison, remote-resource uniqueness, the escape from
`unknown_remote_state`, `CONNECTED` requiring a verified adapter — are proven over real embedded
PostgreSQL in `tests/database/prompt10-publishing.test.mjs`. Nothing here claims a real destination
accepted anything: no real provider credential exists in this environment, which is why provider-driven
cases use adapters that make no network call.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

from app.services.integration_adapters import (Authorization, ProviderCallFailed,
    ProviderTimeout, PublicationOutcome, PublicationRequest, UnconfiguredAdapter)
from app.services.publishing import PublishingService
from tests.prompt10_harness import (ATTEMPT, CONNECTION, MEDIA, PRODUCTION, PROVIDER, PUBLICATION, RESULT,
    TOKEN_A, TOKEN_B, USER_HEADERS, WORKSPACE, WORKSPACE_B, Platform, seed_authorization, seed_connection,
    seed_publication)

DEFAULT_PREVIEW: dict[str, Any] = {'publication_id': PUBLICATION, 'state': 'ready',
    'production': {'id': PRODUCTION, 'pinned_revision': 3, 'current_revision': 3},
    'result': {'id': RESULT, 'approval': 'approved', 'pinned_revision': 4, 'current_revision': 4},
    'media': {'id': MEDIA, 'pinned_checksum': 'sha256:media-one', 'current_checksum': 'sha256:media-one'},
    'destination': {'provider': PROVIDER, 'account_id': CONNECTION, 'target': 'channel-1'},
    'content': {'title': 'Marquee Film', 'caption': 'A keeper loses the light.', 'fingerprint': 'fp-1'},
    'provider_constraints': {'max_caption': 5000}, 'capability': 'AVAILABLE', 'missing_scopes': [],
    'authorization': {'authorization_id': seed_authorization()['id'], 'decision': 'authorize',
        'actor_user_id': '00000000-0000-4000-8000-000000000001', 'authorized_at': '2026-10-08T10:00:00+00:00'},
    'retry_safety': 'requires_idempotency_key', 'can_submit': True, 'blocked_by': [],
    'note': 'Everything this publication needs is present; a creator action may submit it.'}

DEFAULT_SUBMIT: dict[str, Any] = {'publication_id': PUBLICATION, 'attempt_id': ATTEMPT, 'attempt_number': 1,
    'operation_id': 'op-1', 'idempotency_key': 'idem-1', 'request_fingerprint': 'fp-1', 'state': 'submitting',
    'capability': 'AVAILABLE', 'destination': {'provider': PROVIDER, 'account_id': CONNECTION, 'target': 'channel-1'},
    'payload': {'media_id': MEDIA, 'media_checksum': 'sha256:media-one', 'media_type': 'video',
        'title': 'Marquee Film', 'caption': 'A keeper loses the light.', 'visibility': 'public',
        'scheduled_for': None, 'settings': {'category': 'film'}},
    'note': 'No provider call has been made yet. The adapter performs it and records the outcome.'}

OUTCOME_STATES = {'accepted': 'submitted', 'processing': 'processing', 'succeeded': 'published', 'failed': 'failed',
    'unknown': 'unknown_remote_state'}


def app_path(workspace: str = WORKSPACE) -> str:
    return f'/api/v1/workspaces/{workspace}/publications'


def outcome_response(payload: dict[str, Any]) -> dict[str, Any]:
    outcome = str(payload.get('target_outcome'))
    state = OUTCOME_STATES[outcome]
    return {'publication_id': payload.get('target_publication'), 'attempt_id': payload.get('target_attempt'),
        'outcome': outcome, 'state': state, 'remote_resource_id': payload.get('target_remote_resource_id'),
        'remote_url': payload.get('target_remote_url'), 'remote_state': payload.get('target_remote_state'),
        'failure_category': payload.get('target_failure_category'), 'recorded_at': '2026-10-08T10:05:00+00:00',
        'meaning': {'submitted': 'The destination accepted the submission; publication is not yet confirmed.',
            'processing': 'The destination is still processing.', 'published': 'The destination confirmed this exact publication.',
            'failed': 'The destination reported a failure.', 'unknown_remote_state': 'The destination answer was ambiguous.'}[state]}


def publishing_handlers(**overrides: Any) -> dict[str, Any]:
    """Default RPC behaviour for the publishing surface, overridable per test."""

    handlers: dict[str, Any] = {
        'publication_preview': lambda payload, token, service: dict(DEFAULT_PREVIEW),
        'publication_retry_safety': lambda payload, token, service: 'requires_idempotency_key',
        'publication_submit': lambda payload, token, service: dict(DEFAULT_SUBMIT),
        'publication_record_result': lambda payload, token, service: outcome_response(payload),
        'publication_reconcile': lambda payload, token, service: {
            'publication_id': payload.get('target_publication'), 'previous_state': 'unknown_remote_state',
            'state': payload.get('target_observed'), 'source': 'provider_api' if service else 'manual_operator',
            'remote_resource_id': payload.get('target_remote_resource_id'),
            'remote_state': payload.get('target_remote_state'),
            'failure_category': payload.get('target_failure_category'),
            'observed_at': '2026-10-08T10:10:00+00:00', 'note': payload.get('note_text'),
            'meaning': 'The destination really holds this publication.'},
        'publication_authorize': lambda payload, token, service: {
            'publication_id': payload.get('target_publication'), 'authorization_id': seed_authorization()['id'],
            'decision': payload.get('decision'), 'state': 'ready',
            'authorized_version': {'production_revision': 3, 'result_revision': 4},
            'destination': {'provider': PROVIDER, 'target': 'channel-1'},
            'meaning': 'A creator authorized publishing this exact version to this exact destination.'},
        'publication_create': lambda payload, token, service: {'publication_id': PUBLICATION, 'state': 'draft',
            'production_revision': 3, 'result_revision': 4, 'media_id': MEDIA,
            'destination_provider': payload.get('target_provider'), 'visibility': payload.get('target_visibility'),
            'note': 'Nothing was submitted.'},
        'publication_update': lambda payload, token, service: {'publication_id': payload.get('target_publication'),
            'state': 'awaiting_authorization', 'title': payload.get('target_title'),
            'note': 'The earlier authorization named different content and is refused at submission.'},
        'publication_set_state': lambda payload, token, service: {'publication_id': payload.get('target_publication'),
            'previous_state': 'draft', 'state': payload.get('desired')},
    }
    handlers.update(overrides)
    return handlers


def platform(**overrides: Any) -> Platform:
    tables = {'publications': [seed_publication()], 'integration_connections': [seed_connection()],
        'publication_authorizations': [seed_authorization()]}
    tables.update(overrides.pop('tables', {}))
    return Platform(tables=tables, rpc=publishing_handlers(**overrides.pop('rpc', {})), **overrides)


def only_call(platform_instance: Platform, name: str) -> dict[str, Any]:
    matches = platform_instance.rpc_calls(name)
    assert matches, f'{name} was never called'
    return matches[-1]


class StubAdapter:
    """An adapter that answers in exactly one named way, using no network."""

    key = PROVIDER
    categories = ('social_publishing',)

    def __init__(self, answer: str) -> None:
        self.answer = answer
        self.requests: list[PublicationRequest] = []

    def configured(self) -> bool:
        return True

    def unconfigured_reasons(self) -> list[str]:
        return []

    def authorize_url(self, **_: Any) -> Authorization:
        return Authorization('https://stub.invalid/authorize', [], '')

    async def exchange_code(self, **_: Any) -> Any:
        raise ProviderCallFailed('unknown', 'not used')

    async def verify(self, **_: Any) -> Any:
        raise ProviderCallFailed('unknown', 'not used')

    async def revoke(self, **_: Any) -> bool:
        return True

    async def submit(self, request: PublicationRequest) -> PublicationOutcome:
        self.requests.append(request)
        if self.answer == 'timeout':
            raise ProviderTimeout('The destination did not answer inside the bounded window.')
        if self.answer == 'rejected':
            raise ProviderCallFailed('policy_violation',
                'The destination refused the content under its own rules.', provider_code='community_guidelines')
        if self.answer == 'ambiguous':
            return PublicationOutcome(outcome='unknown', detail='The answer could not be interpreted.')
        if self.answer == 'accepted':
            return PublicationOutcome(outcome='accepted', remote_resource_type='post', remote_state='queued')
        return PublicationOutcome(outcome='succeeded', remote_resource_type='post', remote_resource_id='remote-1',
            remote_url='https://destination.invalid/p/remote-1', remote_state='published')

    async def remote_state(self, *, remote_resource_id: str) -> PublicationOutcome:
        return PublicationOutcome(outcome='succeeded', remote_resource_id=remote_resource_id, remote_state='published')


class StubRegistry:
    def __init__(self, adapter: Any, *, unconfigured: bool = False) -> None:
        self.adapter = adapter
        self.unconfigured = unconfigured

    def get(self, provider_key: str) -> Any:
        if self.unconfigured:
            return UnconfiguredAdapter(provider_key)
        return self.adapter

    def describe(self, provider_key: str) -> dict[str, Any]:
        return {'provider': provider_key, 'adapter_present': True, 'configured': not self.unconfigured,
            'unconfigured_dependencies': ['provider_credentials'] if self.unconfigured else [],
            'network_calls': not self.unconfigured}

    def keys(self) -> list[str]:
        return [PROVIDER]


def service_for(app: Platform, adapter: Any, *, unconfigured: bool = False) -> PublishingService:
    """A real service over the running application's gateway, with an injected adapter."""

    return PublishingService(app.gateway, app.settings, registry=StubRegistry(adapter, unconfigured=unconfigured))


def run_submit(app: Platform, adapter: Any, *, unconfigured: bool = False) -> dict[str, Any]:
    service = service_for(app, adapter, unconfigured=unconfigured)
    return asyncio.run(service.submit(UUID(WORKSPACE), UUID(PUBLICATION), TOKEN_A))


def run_refresh(app: Platform, adapter: Any, *, unconfigured: bool = False) -> dict[str, Any]:
    service = service_for(app, adapter, unconfigured=unconfigured)
    return asyncio.run(service.refresh(UUID(WORKSPACE), UUID(PUBLICATION), TOKEN_A))


# ------------------------------------------------------------------ vocabulary and reads


def test_vocabulary_states_the_authority_and_unknown_state_laws() -> None:
    with platform().client() as client:
        data = client.get(f'/api/v1/workspaces/{WORKSPACE}/publishing/vocabulary', headers=USER_HEADERS).json()['data']
        assert 'creative approval is not publishing authority' in data['authority_law']
        assert 'no service or AI may record one' in data['authority_law']
        assert 'never reported as published or as failed' in data['unknown_state_law']
        assert data['retry']['publication_submit'] == 'REQUIRES_IDEMPOTENCY_KEY'
        assert 'thumbnail_media_id' in data['permitted_settings_keys']
        assert data['failure_categories']['policy_violation'].startswith('The destination refused')


def test_status_reports_pins_attempts_authorizations_and_reconciliations() -> None:
    app = platform(tables={
        'publication_attempts': [{'id': ATTEMPT, 'workspace_id': WORKSPACE, 'publication_id': PUBLICATION,
            'attempt_number': 1, 'state': 'in_flight', 'operation_id': 'op-1', 'idempotency_key': 'idem-1',
            'request_fingerprint': 'fp-1', 'remote_resource_id': None, 'remote_url': None, 'remote_state': '',
            'failure_category': None, 'failure_code': None, 'failure_message': None,
            'started_at': '2026-10-08T10:00:00+00:00', 'finished_at': None}],
        'publication_reconciliations': [{'id': '00000000-0000-4000-8000-0000000000c1', 'workspace_id': WORKSPACE,
            'publication_id': PUBLICATION, 'observed_state': 'published', 'source': 'manual_operator',
            'remote_resource_id': 'remote-1', 'remote_state': 'published', 'note': '',
            'observed_at': '2026-10-08T10:10:00+00:00'}]})
    with app.client() as client:
        data = client.get(f'{app_path()}/{PUBLICATION}', headers=USER_HEADERS).json()['data']
        assert data['publication']['state'] == 'ready'
        assert data['preview']['blocked_by'] == []
        assert data['attempts'][0]['state'] == 'in_flight'
        assert data['authorizations'][0]['decision'] == 'authorize'
        assert data['reconciliations'][0]['source'] == 'manual_operator'
        assert data['retry_safety'] == 'requires_idempotency_key'
        assert data['vocabulary']['states']['ready'] == 'Ready to publish'


def test_a_publication_of_another_workspace_is_not_visible_and_cannot_be_submitted() -> None:
    with platform(role_b='owner').client() as client:
        other = {'Authorization': f'Bearer {TOKEN_B}'}
        assert client.get(f'{app_path(WORKSPACE_B)}', headers=other).json()['data']['items'] == []
        assert client.get(f'{app_path(WORKSPACE_B)}/{PUBLICATION}', headers=other).status_code == 404
        assert client.post(f'{app_path(WORKSPACE_B)}/{PUBLICATION}/submit', headers=other).status_code == 404


# ------------------------------------------------------------------ creator actions


def test_a_creative_approval_cannot_be_posted_as_publishing_authority() -> None:
    with platform().client() as client:
        refused = client.post(app_path(), headers=USER_HEADERS, json={'production_id': PRODUCTION,
            'result_id': RESULT, 'provider': PROVIDER, 'approval': 'approved'})
        assert refused.status_code == 422
        secret_setting = client.post(app_path(), headers=USER_HEADERS, json={'production_id': PRODUCTION,
            'result_id': RESULT, 'provider': PROVIDER, 'config': {'access_token': 'x'}})
        assert secret_setting.status_code == 422
        assert 'must not contain secrets' in secret_setting.json()['errors'][0]['message']


def test_describing_a_publication_records_it_without_submitting_or_authorizing() -> None:
    app = platform()
    with app.client() as client:
        data = client.post(app_path(), headers=USER_HEADERS, json={'production_id': PRODUCTION,
            'result_id': RESULT, 'provider': PROVIDER, 'account_id': CONNECTION, 'destination': 'channel-1',
            'title': 'Marquee Film', 'caption': 'A keeper loses the light.', 'visibility': 'public',
            'config': {'category': 'film'}}).json()['data']
        assert data['state'] == 'draft' and data['publication_id'] == PUBLICATION
        assert data['entitlement']['enforced'] is False, 'an undeclared entitlement is not a commercial gate'
        assert data['retry'] == 'REQUIRES_IDEMPOTENCY_KEY'
        create = only_call(app, 'publication_create')
        assert create['payload'] == {'target_workspace': WORKSPACE, 'target_production': PRODUCTION,
            'target_result': RESULT, 'target_provider': PROVIDER, 'target_media': None,
            'target_destination': 'channel-1', 'target_account': CONNECTION, 'target_title': 'Marquee Film',
            'target_caption': 'A keeper loses the light.', 'target_visibility': 'public',
            'target_scheduled_for': None, 'target_config': {'category': 'film'}}
        assert create['service'] is False
        assert not app.rpc_calls('publication_submit'), 'describing a publication never submits it'
        assert not app.rpc_calls('publication_authorize'), 'and never authorizes it'


def test_a_scheduled_publication_needs_a_future_time_and_only_a_scheduled_one_carries_one() -> None:
    with platform().client() as client:
        missing = client.post(app_path(), headers=USER_HEADERS, json={'production_id': PRODUCTION,
            'result_id': RESULT, 'provider': PROVIDER, 'visibility': 'scheduled'})
        assert missing.status_code == 422
        assert 'needs the time it is scheduled for' in missing.json()['errors'][0]['message']
        spurious = client.post(app_path(), headers=USER_HEADERS, json={'production_id': PRODUCTION,
            'result_id': RESULT, 'provider': PROVIDER, 'visibility': 'public',
            'scheduled_for': '2030-01-01T00:00:00+00:00'})
        assert spurious.status_code == 422
        assert 'Only a scheduled publication carries a scheduled time' in spurious.json()['errors'][0]['message']


def test_authorizing_is_a_separate_recorded_creator_act() -> None:
    app = platform()
    with app.client() as client:
        data = client.post(f'{app_path()}/{PUBLICATION}/authorize', headers=USER_HEADERS,
            json={'decision': 'authorize', 'note': 'Approved for the public channel.'}).json()['data']
        assert data['decision'] == 'authorize' and data['state'] == 'ready'
        assert data['creative_approval_used_as_authority'] is False
        authorize = only_call(app, 'publication_authorize')
        assert authorize['payload'] == {'target_workspace': WORKSPACE, 'target_publication': PUBLICATION,
            'decision': 'authorize', 'note_text': 'Approved for the public channel.'}
        assert authorize['service'] is False, 'the authorization is a creator decision, not a server one'
        withdrawn = client.post(f'{app_path()}/{PUBLICATION}/authorize', headers=USER_HEADERS,
            json={'decision': 'withdraw'}).json()['data']
        assert withdrawn['decision'] == 'withdraw'


def test_an_edit_that_changes_authorized_content_returns_the_publication_for_authorization() -> None:
    with platform().client() as client:
        data = client.patch(f'{app_path()}/{PUBLICATION}', headers=USER_HEADERS, json={'title': 'A new title',
            'caption': 'A different caption.', 'destination': 'channel-1', 'visibility': 'public',
            'config': {}}).json()['data']
        assert data['state'] == 'awaiting_authorization'
        assert 'different content' in data['note']


def test_a_creator_owned_state_change_is_recorded() -> None:
    app = platform()
    with app.client() as client:
        data = client.post(f'{app_path()}/{PUBLICATION}/state', headers=USER_HEADERS,
            json={'desired': 'cancelled', 'note': 'Not this week.'}).json()['data']
        assert data['state'] == 'cancelled' and data['previous_state'] == 'draft'
        assert only_call(app, 'publication_set_state')['payload'] == {'target_workspace': WORKSPACE,
            'target_publication': PUBLICATION, 'desired': 'cancelled', 'note_text': 'Not this week.'}


# ------------------------------------------------------------------ submission


def test_a_confirmed_publication_records_the_remote_resource_the_destination_returned() -> None:
    app = platform()
    with app.client() as client:
        data = client.post(f'{app_path()}/{PUBLICATION}/submit', headers=USER_HEADERS).json()['data']
        assert data['state'] == 'published' and data['outcome'] == 'succeeded'
        # The remote identity is the destination's own: the controlled adapter names it after the
        # operation, so a retry of the same operation would carry the same remote identity.
        assert data['remote_resource_id'] == 'test-op-1'
        assert data['remote_url'] == 'https://test-adapter.invalid/p/test-op-1'
        assert data['retry'] == 'MUST_NOT_RETRY'
        assert data['entitlement']['enforced'] is False
        submit = only_call(app, 'publication_submit')
        assert submit['service'] is True
        assert submit['payload'] == {'target_workspace': WORKSPACE, 'target_publication': PUBLICATION}
        record = only_call(app, 'publication_record_result')
        assert record['service'] is True
        assert record['payload']['target_outcome'] == 'succeeded'
        assert record['payload']['target_attempt'] == ATTEMPT
        assert record['payload']['target_remote_resource_id'] == 'test-op-1'
        assert record['payload']['target_remote_resource_type'] == 'post'
        assert app.rpc_calls('publication_preview'), 'blockers are consulted before the attempt exists'


def test_the_provider_call_reuses_the_publications_own_idempotency_identity() -> None:
    app = platform()
    adapter = StubAdapter('succeeded')
    with app.client():
        result = run_submit(app, adapter)
    assert result['state'] == 'published'
    assert adapter.requests and adapter.requests[0].idempotency_key == 'idem-1'
    assert adapter.requests[0].operation_id == 'op-1'
    assert adapter.requests[0].request_fingerprint == 'fp-1'
    assert adapter.requests[0].media_checksum == 'sha256:media-one'
    # The recorded attempt reused the row's identity rather than minting a new one, which is what makes a
    # retry reproduce the same real-world operation.
    submit = only_call(app, 'publication_submit')
    assert submit['payload'] == {'target_workspace': WORKSPACE, 'target_publication': PUBLICATION}
    assert only_call(app, 'publication_record_result')['service'] is True


def test_submitting_something_that_is_not_ready_is_refused_without_a_new_attempt() -> None:
    app = platform(tables={'publications': [seed_publication(state='submitted',
        submitted_at='2026-10-08T10:00:00+00:00')]})
    with app.client() as client:
        response = client.post(f'{app_path()}/{PUBLICATION}/submit', headers=USER_HEADERS)
        assert response.status_code == 409
        assert response.json()['errors'][0]['code'] == 'PUBLICATION_OUTCOME_PENDING'
        assert 'could create a second real post' in response.json()['errors'][0]['message']
        assert not app.rpc_calls('publication_submit')
        assert not app.rpc_calls('publication_record_result')


def test_a_publication_that_is_blocked_is_refused_from_the_preview_before_any_attempt() -> None:
    blocked = dict(DEFAULT_PREVIEW, can_submit=False, blocked_by=['MISSING_SCOPE', 'AUTHORIZATION_STALE'],
        note='This publication cannot be submitted yet; blocked_by lists every reason.')
    app = platform(rpc={'publication_preview': lambda payload, token, service: blocked})
    with app.client() as client:
        response = client.post(f'{app_path()}/{PUBLICATION}/submit', headers=USER_HEADERS)
        assert response.status_code == 409
        assert response.json()['errors'][0]['code'] == 'PUBLICATION_BLOCKED'
        assert 'MISSING_SCOPE' in response.json()['errors'][0]['message']
        assert not app.rpc_calls('publication_submit')


def test_a_destination_that_is_not_usable_refuses_before_the_attempt_is_recorded() -> None:
    app = platform(tables={'integration_connections': []})
    with app.client() as client:
        response = client.post(f'{app_path()}/{PUBLICATION}/submit', headers=USER_HEADERS)
        assert response.status_code == 409
        assert response.json()['errors'][0]['code'] == 'PUBLISHING_CAPABILITY_UNAVAILABLE'
        assert 'CONNECTION_NOT_READY' in response.json()['errors'][0]['message']
        assert not app.rpc_calls('publication_submit')


def test_an_unconfigured_destination_is_reported_without_recorded_work() -> None:
    app = platform()
    with app.client():
        result = run_submit(app, None, unconfigured=True)
    assert result['submitted'] is False and result['state'] == 'ready'
    assert result['unconfigured'] == ['provider_credentials']
    assert 'No provider call was made' in result['note']
    assert result['idempotency_key'] == 'idem-1' and result['operation_id'] == 'op-1'
    assert not app.rpc_calls('publication_submit')


def test_a_provider_timeout_becomes_an_unknown_remote_state_not_a_failure() -> None:
    app = platform()
    with app.client():
        result = run_submit(app, StubAdapter('timeout'))
    assert result['outcome'] == 'unknown' and result['state'] == 'unknown_remote_state'
    assert result['retry'] == 'REQUIRES_RECONCILIATION'
    assert 'did not answer' in result['provider_detail']
    record = only_call(app, 'publication_record_result')
    assert record['payload']['target_outcome'] == 'unknown'
    # Nothing is claimed about a failure that was never established.
    assert record['payload']['target_failure_category'] is None


def test_a_remote_rejection_is_recorded_with_its_normalized_category() -> None:
    app = platform()
    with app.client():
        result = run_submit(app, StubAdapter('rejected'))
    assert result['state'] == 'failed' and result['outcome'] == 'failed'
    assert result['failure_category'] == 'policy_violation'
    assert result['retry'] == 'REQUIRES_IDEMPOTENCY_KEY'
    record = only_call(app, 'publication_record_result')
    assert record['payload'] == {'target_workspace': WORKSPACE, 'target_publication': PUBLICATION,
        'target_attempt': ATTEMPT, 'target_outcome': 'failed', 'target_remote_resource_type': '',
        'target_remote_resource_id': None, 'target_remote_url': None, 'target_remote_state': '',
        'target_failure_category': 'policy_violation', 'target_failure_code': 'community_guidelines',
        'target_failure_message': 'The destination refused the content under its own rules.'}
    assert record['service'] is True


def test_an_accepted_answer_is_not_reported_as_published() -> None:
    app = platform()
    with app.client():
        result = run_submit(app, StubAdapter('accepted'))
    assert result['outcome'] == 'accepted' and result['state'] == 'submitted'
    assert 'not yet confirmed' in result['meaning']
    assert result['retry'] == 'MUST_NOT_RETRY'


def test_an_ambiguous_answer_is_recorded_as_unknown_and_reconcilable() -> None:
    app = platform()
    with app.client():
        result = run_submit(app, StubAdapter('ambiguous'))
    assert result['state'] == 'unknown_remote_state' and result['outcome'] == 'unknown'
    assert result['retry'] == 'REQUIRES_RECONCILIATION'


def test_a_changed_pinned_result_stops_the_submission_before_the_attempt() -> None:
    # The database refuses the submission when the pinned revision no longer matches (PT409); the backend
    # must surface that refusal rather than retrying or recording an attempt of its own.
    import httpx

    app = platform(rpc={'publication_submit': lambda payload, token, service: httpx.Response(409, json={
        'code': 'PT409', 'message': 'The Result changed since this publication was pinned; review the current version and authorize it again'})})
    with app.client() as client:
        response = client.post(f'{app_path()}/{PUBLICATION}/submit', headers=USER_HEADERS)
        assert response.status_code == 409
        assert 'changed since this publication was pinned' in response.json()['errors'][0]['message']
        assert not app.rpc_calls('publication_record_result'), \
            'a submission the database refused must not be recorded as an outcome'
        assert app.rpc_calls('publication_submit')[0]['service'] is True


# ------------------------------------------------------------------ reconciliation and refresh


def test_a_creator_reconciliation_is_recorded_as_a_human_observation() -> None:
    app = platform(tables={'publications': [seed_publication(state='unknown_remote_state',
        last_checked_at='2026-10-08T10:00:00+00:00')]})
    with app.client() as client:
        data = client.post(f'{app_path()}/{PUBLICATION}/reconcile', headers=USER_HEADERS, json={
            'observed': 'published', 'remote_resource_id': 'remote-9', 'remote_state': 'published',
            'note': 'I checked the channel.'}).json()['data']
        assert data['state'] == 'published'
        reconcile = only_call(app, 'publication_reconcile')
        assert reconcile['service'] is False, 'a manual observation is a creator act, recorded as one'
        assert reconcile['payload']['target_observed'] == 'published'
        assert reconcile['payload']['target_remote_resource_id'] == 'remote-9'
        assert reconcile['payload']['note_text'] == 'I checked the channel.'


def test_refreshing_the_destination_records_a_provider_api_observation() -> None:
    app = platform(tables={'publications': [seed_publication(state='submitted', remote_resource_id='remote-1',
        submitted_at='2026-10-08T10:00:00+00:00')]})
    with app.client() as client:
        data = client.post(f'{app_path()}/{PUBLICATION}/refresh', headers=USER_HEADERS).json()['data']
        assert data['refreshed'] is True and data['state'] == 'published'
        assert data['retry'] == 'SAFE_TO_RETRY'
        reconcile = only_call(app, 'publication_reconcile')
        assert reconcile['service'] is True
        assert reconcile['payload']['note_text'] == 'Destination state read by the trusted server.'


def test_a_destination_the_server_cannot_query_is_reported_instead_of_guessed() -> None:
    app = platform(tables={'publications': [seed_publication(state='submitted', remote_resource_id='remote-1',
        submitted_at='2026-10-08T10:00:00+00:00')]})
    with app.client():
        result = run_refresh(app, None, unconfigured=True)
    assert result['refreshed'] is False and result['unconfigured'] == ['provider_credentials']
    assert result['retry'] == 'REQUIRES_RECONCILIATION'
    assert 'may record what the destination shows instead' in result['note']
    assert not app.rpc_calls('publication_reconcile')


def test_a_publication_never_submitted_has_no_destination_state_to_read() -> None:
    with platform().client() as client:
        data = client.post(f'{app_path()}/{PUBLICATION}/refresh', headers=USER_HEADERS).json()['data']
        assert data['refreshed'] is False
        assert 'never submitted' in data['note']


def test_an_ambiguous_publication_without_a_remote_resource_requires_a_creator_observation() -> None:
    app = platform(tables={'publications': [seed_publication(state='unknown_remote_state', remote_resource_id=None,
        last_checked_at='2026-10-08T10:00:00+00:00')]})
    with app.client() as client:
        data = client.post(f'{app_path()}/{PUBLICATION}/refresh', headers=USER_HEADERS).json()['data']
        assert data['refreshed'] is False and data['retry'] == 'REQUIRES_RECONCILIATION'
        assert 'no remote resource to read' in data['note']
        assert not app.rpc_calls('publication_reconcile')


# ------------------------------------------------------------------ authority


def test_a_viewer_may_read_but_may_not_authorize_submit_or_reconcile() -> None:
    app = platform(role='viewer')
    with app.client() as client:
        assert client.get(f'{app_path()}/{PUBLICATION}', headers=USER_HEADERS).status_code == 200
        assert client.post(f'{app_path()}/{PUBLICATION}/authorize', headers=USER_HEADERS,
            json={'decision': 'authorize'}).status_code == 403
        assert client.post(f'{app_path()}/{PUBLICATION}/submit', headers=USER_HEADERS).status_code == 403
        assert client.post(f'{app_path()}/{PUBLICATION}/reconcile', headers=USER_HEADERS,
            json={'observed': 'published'}).status_code == 403
        assert not app.rpc_calls('publication_submit')
        assert not app.rpc_calls('publication_authorize')


def test_an_unauthenticated_caller_reaches_nothing() -> None:
    with platform().client() as client:
        assert client.get(app_path()).status_code == 401
        assert client.post(f'{app_path()}/{PUBLICATION}/submit').status_code == 401


def test_the_three_products_and_their_settings_are_distinct_in_the_preview() -> None:
    app = platform()
    with app.client() as client:
        data = client.get(f'{app_path()}/{PUBLICATION}/preview', headers=USER_HEADERS).json()['data']
        assert data['content']['fingerprint'] == 'fp-1'
        assert data['provider_constraints'] == {'max_caption': 5000}
        assert data['permitted_settings_keys'], 'the surface is told which metadata it may edit'
        assert data['can_submit'] is True and data['blocked_by'] == []
        assert data['retry_safety'] == 'requires_idempotency_key'
        assert data['vocabulary']['authority_law'].startswith('Publishing requires an explicit recorded creator')


def test_the_adapter_boundary_never_leaks_a_creator_session_to_a_provider() -> None:
    # The provider-facing adapter registry knows nothing about sessions; every recorded database call that
    # creates or records a real-world attempt uses the server credential instead.
    app = platform()
    with app.client() as client:
        client.post(f'{app_path()}/{PUBLICATION}/submit', headers=USER_HEADERS)
    real_world_writes = [call for call in app.calls['rpc']
        if call['name'] in ('publication_submit', 'publication_record_result')]
    assert real_world_writes and all(call['service'] for call in real_world_writes)
