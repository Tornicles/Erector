from __future__ import annotations

from copy import deepcopy
import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
INTAKE = '00000000-0000-4000-8000-000000000030'
OPERATION = '00000000-0000-4000-8000-000000000040'


def director_client():
    state: dict = {'intake': None, 'proposal': None}
    production = {
        'id': PRODUCTION, 'workspace_id': WORKSPACE, 'title': 'New Production',
        'production_type': 'custom', 'execution_method': 'real', 'planned_duration_ms': None,
        'approval': 'draft', 'locked_at': None, 'revision': 1,
    }

    def platform(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        assert request.headers.get('accept-profile') == 'tonde'
        if path == '/rest/v1/workspace_members':
            return httpx.Response(200, json=[{'role': 'owner'}])
        if path == '/rest/v1/productions':
            return httpx.Response(200, json=[deepcopy(production)])
        if path == '/rest/v1/production_references':
            return httpx.Response(200, json=[])
        if path == '/rest/v1/production_resources':
            return httpx.Response(200, json=[])
        if path == '/rest/v1/director_intakes':
            return httpx.Response(200, json=[deepcopy(state['intake'])] if state['intake'] else [])
        if path == '/rest/v1/rpc/save_director_intake':
            import json
            data = json.loads(request.content)
            assert data['target_workspace'] == WORKSPACE
            assert data['target_production'] == PRODUCTION
            assert data['expected_intake_revision'] is None
            state['intake'] = {
                'id': INTAKE, 'revision': 1, 'status': 'intake',
                'collaboration_mode': data['intake']['collaboration_mode'],
                'intent': data['intake'], 'plan': {},
                'applied_operation_id': None, 'proposal_operation_id': None,
            }
            return httpx.Response(200, json={'id': INTAKE, 'revision': 1, 'status': 'intake'})
        if path == '/rest/v1/rpc/save_director_plan_proposal':
            import json
            data = json.loads(request.content)
            assert data['expected_production_revision'] == 1
            assert data['expected_intake_revision'] == 1
            assert data['operation_id'] == OPERATION
            state['proposal'] = data['proposal_plan']
            state['intake'].update({
                'revision': 2, 'status': 'draft_ready', 'plan': data['proposal_plan'],
                'proposal_operation_id': OPERATION,
            })
            return httpx.Response(200, json={'intake_id': INTAKE, 'revision': 2, 'status': 'draft_ready', 'idempotent': False})
        if path == '/rest/v1/rpc/apply_director_plan':
            import json
            data = json.loads(request.content)
            assert data['explicit_confirmation'] is True
            assert data['expected_production_revision'] == 1
            assert data['expected_intake_revision'] == 2
            assert state['intake']['proposal_operation_id'] == data['operation_id']
            state['intake'].update({'revision': 3, 'status': 'ready_for_studio', 'applied_operation_id': data['operation_id']})
            return httpx.Response(200, json={'production_id': PRODUCTION, 'intake_id': INTAKE, 'idempotent': False})
        raise AssertionError(f'Unexpected platform request: {request.method} {request.url}')

    settings = Settings(
        app_env='test', supabase_url='https://test.supabase.co',
        supabase_publishable_key=SecretStr('sb_publishable_test'),
    )
    return TestClient(create_app(settings, httpx.MockTransport(platform))), state


def test_director_api_builds_a_scoped_timed_proposal_then_requires_confirmed_apply():
    client, state = director_client()
    with client:
        headers = {'Authorization': 'Bearer verified-test-session'}
        root = f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/director'
        interpreted = client.post(f'{root}/interpret', headers=headers, json={
            'goal': 'Make a 45-second original crime trailer I can mostly shoot by myself',
            'collaboration_mode': 'stop_at_major_decisions',
        })
        assert interpreted.status_code == 200, interpreted.text
        result = interpreted.json()['data']
        assert result['intent']['primary_type'] == 'trailer'
        assert result['intent']['runtime_ms'] == 45000
        assert result['intent']['constraints']['crew_size'] == 1
        assert 'dialogue_mode' in {question['id'] for question in result['questions']}

        saved = client.post(f'{root}/intake', headers=headers, json={
            'expected_intake_revision': None, 'intent': result['intent'],
        })
        assert saved.status_code == 200, saved.text
        assert saved.json()['data']['revision'] == 1

        proposed = client.post(f'{root}/propose', headers=headers, json={'operation_id': OPERATION})
        assert proposed.status_code == 200, proposed.text
        proposal = proposed.json()['data']
        assert sum(scene['duration_ms'] for scene in proposal['draft']['scenes']) == 45000
        assert proposal['reality']['feasibility'] == 'adapt'
        assert state['intake']['status'] == 'draft_ready'

        applied = client.post(f'{root}/apply', headers=headers, json={
            'operation_id': OPERATION, 'explicit_confirmation': True,
        })
        assert applied.status_code == 200, applied.text
        assert applied.json()['data']['idempotent'] is False
        assert state['intake']['status'] == 'ready_for_studio'


def test_director_apply_rejects_missing_creator_confirmation():
    client, state = director_client()
    state['intake'] = {
        'id': INTAKE, 'revision': 2, 'status': 'draft_ready',
        'collaboration_mode': 'complete_first_draft',
        'intent': {'goal': 'A first draft'}, 'plan': {},
        'applied_operation_id': None, 'proposal_operation_id': OPERATION,
    }
    with client:
        response = client.post(
            f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/director/apply',
            headers={'Authorization': 'Bearer verified-test-session'},
            json={'operation_id': OPERATION, 'explicit_confirmation': False},
        )
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'DIRECTOR_CONFIRMATION_REQUIRED'
    assert state['intake']['status'] == 'draft_ready'
