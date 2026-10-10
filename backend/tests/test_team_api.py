"""Team workspace invitation API coverage: the HTTP path over the invite registry.

Membership writes are never client-side in this product: the database grants
no membership or invite writes to client roles. These tests prove the HTTP
path honours that boundary: owner/admin-only creation and revocation, exact
RPC payload contracts (hashes, never raw tokens, cross the wire), single-use
acceptance, and error translation. Token single-use and expiry races are
enforced by the guarded RPCs in migration 049, not here.
"""

from __future__ import annotations

import hashlib
import json
import re

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000011'
INVITE = '00000000-0000-4000-8000-000000000031'
OTHER_INVITE = '00000000-0000-4000-8000-000000000032'

HEADERS = {'Authorization': 'Bearer verified-test-session'}


def base() -> str:
    return f'/api/v1/workspaces/{WORKSPACE}'


def invite_row(**overrides) -> dict:
    row = {'id': INVITE, 'role': 'editor', 'expires_at': '2026-10-20T00:00:00Z',
        'accepted_at': None, 'revoked_at': None, 'created_at': '2026-10-10T00:00:00Z'}
    row.update(overrides)
    return row


def make_client(*, role: str | None = 'owner', no_migration: bool = False, denied: bool = False):
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
            if request.url.params.get('workspace_id') != f'eq.{WORKSPACE}' or role is None:
                return httpx.Response(200, json=[])
            wanted = request.url.params.get('role') or ''
            if wanted.startswith('in.(') and wanted.endswith(')'):
                if role not in wanted[4:-1].split(','):
                    return httpx.Response(200, json=[])
            elif wanted and wanted != role:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{'user_id': USER, 'role': role,
                'created_at': '2026-10-10T00:00:00Z'}])
        if path == '/rest/v1/workspace_invites':
            params = request.url.params
            if params.get('workspace_id') != f'eq.{WORKSPACE}':
                return httpx.Response(200, json=[])
            if params.get('id') == f'eq.{OTHER_INVITE}':
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[invite_row()])
        if not path.startswith('/rest/v1/rpc/'):
            return httpx.Response(200, json=[])
        name = path.rsplit('/', 1)[-1]
        payload = json.loads(request.content or b'{}')
        state['calls'].append({'name': name, 'payload': payload})
        if no_migration:
            return fail('PGRST202', name)
        if denied or payload.get('target_workspace') == OTHER_WORKSPACE:
            return fail('42501', 'Workspace access denied')
        if name == 'create_workspace_invite':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json=INVITE)
        if name == 'revoke_workspace_invite':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json=None)
        if name == 'accept_workspace_invite':
            spent_hash = hashlib.sha256(b'spent-link-token').hexdigest()
            if payload.get('p_token_hash') == spent_hash:
                return fail('PT409', 'This invite link is invalid, expired, revoked, or already used.')
            return httpx.Response(200, json=[{'workspace_id': WORKSPACE, 'role': 'editor'}])
        return httpx.Response(200, json={})

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_service_role_key='service-role-key',
        app_env='test')
    client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    client.__enter__()
    return client, state


# ------------------------------------------------------------------ members

def test_members_are_listed_for_any_workspace_member():
    client, _ = make_client(role='viewer')
    response = client.get(f'{base()}/team/members', headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data == [{'user_id': USER, 'role': 'viewer', 'created_at': '2026-10-10T00:00:00Z'}]


def test_members_are_hidden_without_membership():
    client, _ = make_client(role=None)
    response = client.get(f'{base()}/team/members', headers=HEADERS)
    assert response.status_code == 403


# ------------------------------------------------------------------ invites

def test_invites_are_listed_without_token_hashes():
    client, _ = make_client(role='admin')
    response = client.get(f'{base()}/team/invites', headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data == [{'invite_id': INVITE, 'role': 'editor', 'expires_at': '2026-10-20T00:00:00Z',
        'accepted_at': None, 'revoked_at': None, 'created_at': '2026-10-10T00:00:00Z'}]


def test_invites_are_hidden_from_non_admins():
    client, _ = make_client(role='editor')
    response = client.get(f'{base()}/team/invites', headers=HEADERS)
    assert response.status_code == 403
    assert 'invite' in response.json()['errors'][0]['message'].lower()


def test_create_returns_a_single_use_token_once():
    client, state = make_client(role='owner')
    response = client.post(f'{base()}/team/invites', headers=HEADERS,
        json={'role': 'editor', 'expires_in_days': 7})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['invite_id'] == INVITE
    assert isinstance(data['token'], str) and len(data['token']) >= 43
    (write,) = [call for call in state['writes'] if call['name'] == 'create_workspace_invite']
    assert write['payload']['target_workspace'] == WORKSPACE
    assert write['payload']['invite_role'] == 'editor'
    assert re.fullmatch(r'[0-9a-f]{64}', write['payload']['token_hash'])
    assert write['payload']['token_hash'] == hashlib.sha256(data['token'].encode('utf-8')).hexdigest()
    assert data['token'] not in json.dumps(write['payload'])


def test_create_rejects_ownership_and_bad_expiry():
    client, state = make_client(role='owner')
    assert client.post(f'{base()}/team/invites', headers=HEADERS,
        json={'role': 'owner'}).status_code == 422
    assert client.post(f'{base()}/team/invites', headers=HEADERS,
        json={'role': 'editor', 'expires_in_days': 99}).status_code == 422
    assert client.post(f'{base()}/team/invites', headers=HEADERS,
        json={'role': 'superadmin'}).status_code == 422
    assert state['writes'] == []


def test_create_is_refused_for_editors_and_viewers():
    for role in ('editor', 'viewer', None):
        client, state = make_client(role=role)
        response = client.post(f'{base()}/team/invites', headers=HEADERS, json={'role': 'viewer'})
        assert response.status_code == 403
        assert state['writes'] == []


def test_revoke_scopes_the_invite_to_its_workspace():
    client, state = make_client(role='admin')
    response = client.post(f'{base()}/team/invites/{INVITE}/revoke', headers=HEADERS)
    assert response.status_code == 200
    assert response.json()['data'] == {'invite_id': INVITE, 'revoked': True}
    assert state['writes'][0]['payload'] == {'invite_id': INVITE}


def test_revoke_refuses_another_workspaces_invite():
    client, state = make_client(role='admin')
    response = client.post(f'{base()}/team/invites/{OTHER_INVITE}/revoke', headers=HEADERS)
    assert response.status_code == 404
    assert state['writes'] == []


def test_accept_joins_the_workspace_once():
    client, _ = make_client(role=None)
    response = client.post('/api/v1/invites/accept', headers=HEADERS, json={'token': 'shared-link-token'})
    assert response.status_code == 200
    assert response.json()['data'] == {'workspace_id': WORKSPACE, 'role': 'editor'}


def test_accept_rejects_blank_tokens():
    client, _ = make_client(role=None)
    assert client.post('/api/v1/invites/accept', headers=HEADERS, json={'token': ''}).status_code == 422
    assert client.post('/api/v1/invites/accept', headers=HEADERS, json={'token': '   '}).status_code == 422


def test_accept_reports_a_spent_link_as_a_conflict():
    # A used, expired, or revoked link is a conflict with invite state, never a platform outage.
    client, _ = make_client(role=None)
    response = client.post('/api/v1/invites/accept', headers=HEADERS, json={'token': 'spent-link-token'})
    assert response.status_code == 409
    assert 'invite' in response.json()['errors'][0]['message'].lower()


def test_missing_migration_is_reported_as_undeployed():
    client, _ = make_client(no_migration=True)
    response = client.post(f'{base()}/team/invites', headers=HEADERS, json={'role': 'editor'})
    assert response.status_code == 503
    assert 'migration' in response.json()['errors'][0]['message'].lower()
