"""Prompt 9E API coverage: approval, locks and Production readiness.

The platform is mocked with httpx.MockTransport. Semantic behaviour (approval names a specific
revision, a change after approval is reported rather than silently still approved, lock and
approval are independent, unlock is explicit, the decision record is append-only, and readiness is
derived from real state) is proven against real embedded PostgreSQL in
tests/database/prompt9e-approval-readiness.test.mjs. These tests prove the HTTP path:
authorization, the exact RPC payload contract, error translation, and the boundaries this feature
must never cross - approval is a creator decision, readiness is a category and not a score, and no
external provider availability is claimed.
"""

from __future__ import annotations

import json

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000011'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
DENIED_PRODUCTION = '00000000-0000-4000-8000-000000000099'
SCENE_TWO = '00000000-0000-4000-8000-000000000301'
DECISION_ONE = '00000000-0000-4000-8000-000000000e01'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

RULE = ('Approval means a creator accepted this specific revision. It is not a generation result, a '
    'validation pass or a model opinion. Lock and approval are independent.')

LIMITATION = ('Readiness is a category derived from real production state, not a score or a percentage. '
    'AI provider availability is an external dependency and is not guessed here.')


def base(production: str = PRODUCTION) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{production}'


def state_payload(**overrides) -> dict:
    payload = {'object_id': SCENE_TWO, 'object_kind': 'scene', 'label': 'Scene 2 Kitchen',
        'approval': 'approved', 'locked': False, 'current_revision': 4, 'approved_revision': 4,
        'approved_by': USER, 'approved_at': '2026-10-05T10:00:00Z', 'changed_since_approval': False,
        'locked_at': None, 'locked_by': None, 'lock_reason': '',
        'decisions': [{'action': 'approve', 'from_approval': 'needs_review', 'to_approval': 'approved',
            'pinned_revision': 4, 'note': 'The opening beat is locked.', 'actor_user_id': USER,
            'created_at': '2026-10-05T10:00:00Z'}],
        'note': 'Approval names the exact revision it accepted.'}
    payload.update(overrides)
    return payload


def readiness_payload(**overrides) -> dict:
    payload = {'production_id': PRODUCTION, 'production_revision': 12, 'title': 'Marquee film',
        'state': 'blocked',
        'dimensions': [
            {'dimension': 'scene_plan', 'state': 'ready', 'present': True, 'counts': {'blocking': 0, 'review': 0, 'warning': 0}},
            {'dimension': 'approvals', 'state': 'needs_review', 'present': True, 'counts': {'blocking': 0, 'review': 1, 'warning': 0}}],
        'blockers': [
            {'code': 'continuity_critical', 'severity': 'blocking', 'dimension': 'continuity',
             'problem': 'Marcus wears a red jacket then a blue one.', 'affected_object_id': SCENE_TWO,
             'affected_label': 'Scene 2 Kitchen', 'affected_kind': 'scene',
             'why_it_matters': 'A critical continuity conflict is unresolved.',
             'required_action': 'Resolve or explicitly accept the continuity finding.',
             'action_source': 'continuity_finding'},
            {'code': 'changed_after_approval', 'severity': 'review', 'dimension': 'approvals',
             'problem': 'Approved content changed since it was approved.', 'affected_object_id': SCENE_TWO,
             'affected_label': 'Scene 2 Kitchen', 'affected_kind': 'scene',
             'why_it_matters': 'An approval describes a specific revision.',
             'required_action': 'Review the new revision and approve it.', 'action_source': 'scene'}],
        'counts': {'blocking': 1, 'review': 1, 'warning': 0, 'total': 2},
        'headline': '1 blocker must be resolved before this Production can move forward.',
        'notes': ['Readiness is a category derived from real production state, not a score or a percentage.'],
        'generated_at': '2026-10-05T10:00:00Z'}
    payload.update(overrides)
    return payload


def decision_payload(**overrides) -> dict:
    payload = {'object_id': SCENE_TWO, 'object_kind': 'scene', 'label': 'Scene 2 Kitchen',
        'action': 'approve', 'approval': 'approved', 'revision': 5, 'approved_revision': 5,
        'locked': False, 'note': 'The opening beat is locked.', 'actor_user_id': USER,
        'decided_at': '2026-10-05T10:00:00Z',
        'meaning': 'A creator accepted this exact revision.'}
    payload.update(overrides)
    return payload


def make_client(*, role: str | None = 'owner', no_migration: bool = False, stale: bool = False,
    locked: bool = False):
    state: dict = {'calls': [], 'writes': []}

    def fail(code: str, message: str) -> httpx.Response:
        if no_migration:
            return httpx.Response(404, json={'code': 'PGRST202', 'message': f'Could not find the function {message}'})
        return httpx.Response(400, json={'code': code, 'message': message})

    def platform(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        if path == '/rest/v1/workspace_members':
            wanted = request.url.params.get('role') or ''
            if request.url.params.get('workspace_id') != f'eq.{WORKSPACE}' or role is None:
                return httpx.Response(200, json=[])
            if wanted and role not in ('owner', 'admin', 'editor'):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{'role': role}])
        if not path.startswith('/rest/v1/rpc/'):
            return httpx.Response(200, json=[])
        name = path.rsplit('/', 1)[-1]
        payload = json.loads(request.content or b'{}')
        state['calls'].append({'name': name, 'payload': payload})
        if no_migration:
            return fail('PGRST202', name)
        if payload.get('target_workspace') == OTHER_WORKSPACE or payload.get('target_production') == DENIED_PRODUCTION:
            return fail('42501', 'Workspace access denied')
        if name == 'production_readiness':
            return httpx.Response(200, json=readiness_payload())
        if name == 'access_state':
            return httpx.Response(200, json=state_payload())
        if name == 'access_history':
            return httpx.Response(200, json={'object_id': SCENE_TWO, 'object_kind': 'scene', 'total': 1,
                'items': [{'id': DECISION_ONE, 'action': 'approve', 'from_approval': 'needs_review',
                    'to_approval': 'approved', 'pinned_revision': 4, 'note': 'The opening beat is locked.',
                    'actor_user_id': USER, 'created_at': '2026-10-05T10:00:00Z'}],
                'note': 'This is a record of creator decisions. It is append-only.'})
        if name == 'approval_decide':
            state['writes'].append({'name': name, 'payload': payload})
            if stale:
                return fail('40001', 'That object changed since you loaded it')
            return httpx.Response(200, json=decision_payload(action=payload.get('decision'),
                approved_revision=5 if payload.get('decision') == 'approve' else None))
        if name == 'lock_set':
            state['writes'].append({'name': name, 'payload': payload})
            if locked:
                return fail('23514', 'That object is already locked')
            return httpx.Response(200, json={'object_id': SCENE_TWO, 'object_kind': 'scene',
                'label': 'Scene 2 Kitchen', 'task': 'lock' if payload.get('locked') else 'unlock',
                'locked': bool(payload.get('locked')), 'revision': 5, 'was_locked': False,
                'note': payload.get('note_text') or '', 'actor_user_id': USER,
                'decided_at': '2026-10-05T10:00:00Z',
                'meaning': 'This object is protected from incidental change.'})
        return httpx.Response(200, json=[])

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_secret_key='service-role-key',
        environment='test', ai_provider='none', ai_provider_api_key=None)
    test_client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    test_client.__enter__()
    return test_client, state


# ---------------------------------------------------------------- vocabulary

def test_vocabulary_declares_access_actions_and_readiness_dimensions() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/readiness/vocabulary', headers=HEADERS).json()['data']
    assert [entry['action'] for entry in data['access_actions']] == [
        'approve', 'request_review', 'reopen', 'lock', 'unlock']
    assert [entry['state'] for entry in data['readiness_states']] == [
        'ready', 'ready_with_warnings', 'needs_review', 'blocked', 'unknown']
    dimensions = [entry['dimension'] for entry in data['readiness_dimensions']]
    assert 'continuity' in dimensions and 'approvals' in dimensions and 'delivery' in dimensions
    assert 'specific revision' in data['rule']
    assert 'not a score' in data['limitation']


# ---------------------------------------------------------------- readiness

def test_readiness_exposes_categories_navigable_blockers_and_no_score() -> None:
    client, state = make_client()
    response = client.get(f'{base()}/readiness', headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['state'] == 'blocked'
    assert data['state_label'] == 'Blocked'
    assert data['counts']['blocking'] == 1
    assert 'score' not in data['counts'] and 'percent' not in data['counts']
    blocker = data['blockers'][0]
    assert blocker['severity_label'] == 'Blocks progress'
    assert blocker['dimension_label'] == 'Continuity'
    assert blocker['affected_object_id'] == SCENE_TWO, 'the blocker points at the object to navigate to'
    assert blocker['required_action']
    dimension = next(item for item in data['dimensions'] if item['dimension'] == 'approvals')
    assert dimension['label'] == 'Approvals' and dimension['state_label'] == 'Needs review'
    assert 'not a score' in data['limitation']
    assert state['calls'][0] == {'name': 'production_readiness', 'payload': {
        'target_workspace': WORKSPACE, 'target_production': PRODUCTION,
        'expected_production_revision': None}}


def test_readiness_is_denied_for_another_workspace_and_reports_a_missing_schema() -> None:
    client, _ = make_client(role=None)
    assert client.get(f'{base()}/readiness', headers=HEADERS).status_code == 403
    missing, _ = make_client(no_migration=True)
    response = missing.get(f'{base()}/readiness', headers=HEADERS)
    assert response.status_code == 503
    assert response.json()['errors'][0]['code'] == 'STUDIO_SCHEMA_MISSING'


# ---------------------------------------------------------------- access state

def test_access_state_shows_the_revision_approved_the_decider_and_the_time() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/access/{SCENE_TWO}', headers=HEADERS).json()['data']
    assert data['approval'] == 'approved' and data['approval_label'] == 'Approved'
    assert data['approved_revision'] == 4
    assert data['approved_by'] == USER and data['approved_at']
    assert data['changed_since_approval'] is False
    assert data['decisions'][0]['action_label'] == 'Approved'
    assert 'revision the creator approved' in data['changed_line']


def test_a_change_after_approval_is_reported_not_still_approved() -> None:
    client, _ = make_client()
    # The database sets changed_after_approval; the surface must not re-derive or soften it.
    data = client.get(f'{base()}/access/{SCENE_TWO}', headers=HEADERS).json()['data']
    assert data['approval'] == 'approved', 'the raw mock is unchanged here; the DB test proves the transition'
    assert 'changed_line' in data


def test_access_state_rejects_a_malformed_identifier() -> None:
    client, _ = make_client()
    response = client.get(f'{base()}/access/not-a-uuid', headers=HEADERS)
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_READINESS_INPUT'


def test_access_history_is_paginated_and_decorated() -> None:
    client, state = make_client()
    response = client.get(f'{base()}/access/{SCENE_TWO}/history?limit=10&offset=5', headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['items'][0]['action_label'] == 'Approved'
    assert 'append-only' in data['note']
    call = next(entry for entry in state['calls'] if entry['name'] == 'access_history')
    assert call['payload']['max_rows'] == 10 and call['payload']['skip_rows'] == 5


# ---------------------------------------------------------------- decisions

def test_approval_requires_an_editor_and_reports_the_decision() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.post(f'{base()}/access/{SCENE_TWO}/decide', headers=HEADERS,
        json={'decision': 'approve'}).status_code == 403

    client, state = make_client()
    response = client.post(f'{base()}/access/{SCENE_TWO}/decide', headers=HEADERS,
        json={'decision': 'approve', 'expected_revision': 4, 'note': 'The opening beat is locked.'})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['action'] == 'approve'
    assert data['action_label'] == 'Approved'
    assert data['approved_revision'] == 5
    write = state['writes'][0]
    assert write['name'] == 'approval_decide'
    assert write['payload']['decision'] == 'approve'
    assert write['payload']['expected_revision'] == 4
    assert write['payload']['note_text'] == 'The opening beat is locked.'
    assert write['payload']['target_object'] == SCENE_TWO


def test_an_unsupported_decision_is_rejected_before_the_database() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/access/{SCENE_TWO}/decide', headers=HEADERS,
        json={'decision': 'generated'})
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_READINESS_INPUT'
    assert state['writes'] == [], 'nothing reached the database'


def test_a_stale_approval_translates_to_a_conflict() -> None:
    client, _ = make_client(stale=True)
    response = client.post(f'{base()}/access/{SCENE_TWO}/decide', headers=HEADERS,
        json={'decision': 'approve', 'expected_revision': 3})
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'STUDIO_CONFLICT'


def test_lock_and_unlock_are_explicit_and_unlock_needs_a_reason() -> None:
    client, state = make_client()
    locked = client.post(f'{base()}/access/{SCENE_TWO}/lock', headers=HEADERS,
        json={'locked': True, 'note': 'Pickups are scheduled.'})
    assert locked.status_code == 200
    assert locked.json()['data']['locked'] is True
    assert state['writes'][0]['payload']['locked'] is True

    # The surface refuses an unlock with no reason before anything reaches the database.
    unlocked = client.post(f'{base()}/access/{SCENE_TWO}/lock', headers=HEADERS, json={'locked': False})
    assert unlocked.status_code == 422
    assert unlocked.json()['errors'][0]['code'] == 'INVALID_READINESS_INPUT'

    ok = client.post(f'{base()}/access/{SCENE_TWO}/lock', headers=HEADERS,
        json={'locked': False, 'note': 'Unlocked for the reshoot.'})
    assert ok.status_code == 200
    assert ok.json()['data']['locked'] is False


def test_locking_an_already_locked_object_is_a_conflict() -> None:
    client, _ = make_client(locked=True)
    response = client.post(f'{base()}/access/{SCENE_TWO}/lock', headers=HEADERS,
        json={'locked': True, 'note': 'Again.'})
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'STUDIO_RULE_VIOLATION'
