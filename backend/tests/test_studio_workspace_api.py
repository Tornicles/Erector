"""Prompt 5 Studio API coverage: shell read model, Scene/Shot writes, locks and errors.

The platform is mocked with httpx.MockTransport. Semantic SQL behaviour (ordering
namespace, guards, reconciliation) is proven against real embedded PostgreSQL in
tests/database/prompt5-studio.test.mjs; these tests prove the HTTP path — routing,
authorization, the exact RPC payload contract, error translation and the aggregated
read model.
"""

from __future__ import annotations

import json
from copy import deepcopy

import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000011'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
SCENE_ONE = '00000000-0000-4000-8000-000000000031'
SCENE_TWO = '00000000-0000-4000-8000-000000000032'
SHOT_ONE = '00000000-0000-4000-8000-000000000041'
SHOT_TWO = '00000000-0000-4000-8000-000000000042'
NEW_ID = '00000000-0000-4000-8000-000000000099'
CHARACTER = '00000000-0000-4000-8000-000000000051'
ENVIRONMENT = '00000000-0000-4000-8000-000000000052'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

TIMING = {
    'total_ms': 30000, 'target_ms': 30000, 'delta_ms': 0, 'status': 'fits',
    'scene_states': [
        {'scene_id': SCENE_ONE, 'order': 1024, 'duration_ms': 12000, 'shots': 1, 'timing': 'derived'},
        {'scene_id': SCENE_TWO, 'order': 2048, 'duration_ms': 18000, 'shots': 1, 'timing': 'derived'},
    ],
}


def scene_row(scene_id: str, title: str, order: int, duration: int) -> dict:
    return {
        'id': scene_id, 'workspace_id': WORKSPACE, 'production_id': PRODUCTION, 'title': title,
        'purpose': 'Earn attention', 'story_beat': 'Hook', 'description': 'A dark kitchen.',
        'action_lines': ['The kettle clicks off.'], 'opening_state': 'Empty counter.', 'ending_state': 'Kettle silent.',
        'visual_intent': 'Single soft source.', 'dialogue_notes': '', 'environment_asset_id': ENVIRONMENT,
        'sort_order': order, 'planned_duration_ms': duration, 'calculated_duration_ms': duration,
        'approval': 'draft', 'locked_at': None, 'lifecycle': 'active', 'revision': 1,
        'updated_at': '2026-10-05T00:00:00Z',
    }


def shot_row(shot_id: str, scene_id: str, title: str, order: int, duration: int | None) -> dict:
    return {
        'id': shot_id, 'workspace_id': WORKSPACE, 'production_id': PRODUCTION, 'scene_id': scene_id,
        'title': title, 'description': 'Macro on the scale.', 'action': '', 'purpose': 'establish',
        'subject': 'Scale', 'framing': 'wide', 'angle': 'eye level', 'movement': 'slow push in',
        'composition': 'centred', 'transition': 'cut', 'story_relationship': 'proves the promise',
        'story_beat': 'Hook', 'creative_notes': '', 'execution_method': 'real', 'sort_order': order,
        'planned_duration_ms': duration, 'calculated_duration_ms': duration, 'approval': 'draft',
        'locked_at': None, 'lifecycle': 'active', 'revision': 1, 'updated_at': '2026-10-05T00:00:00Z',
    }


def make_client(*, role: str | None = 'owner', timing: dict | None = None, scenes: list[dict] | None = None,
    shots: list[dict] | None = None, no_migration: bool = False):
    state: dict = {
        'production': {
            'id': PRODUCTION, 'workspace_id': WORKSPACE, 'title': 'Ridgeway coffee', 'production_type': 'commercial',
            'custom_type': None, 'execution_method': 'real', 'planned_duration_ms': 30000,
            'calculated_duration_ms': 30000, 'approval': 'draft', 'locked_at': None, 'revision': 7,
            'lifecycle': 'active', 'updated_at': '2026-10-05T00:00:00Z',
        },
        'scenes': scenes if scenes is not None else [
            scene_row(SCENE_ONE, 'Dark kitchen', 1024, 12000),
            scene_row(SCENE_TWO, 'Weighing', 2048, 18000),
        ],
        'shots': shots if shots is not None else [
            shot_row(SHOT_ONE, SCENE_ONE, 'Establish', 1024, 12000),
            shot_row(SHOT_TWO, SCENE_TWO, 'Scale macro', 2048, 18000),
        ],
        'timing': timing or deepcopy(TIMING),
        'rpc_calls': [],
    }

    def editor() -> bool:
        return role in ('owner', 'admin', 'editor')

    def fail(code: str, message: str) -> httpx.Response:
        if no_migration:
            return httpx.Response(404, json={'code': 'PGRST202', 'message': f'Could not find the function {message}'})
        return httpx.Response(400, json={'code': code, 'message': message})

    def find_scene(scene_id: str) -> dict | None:
        return next((row for row in state['scenes'] if row['id'] == scene_id and row['lifecycle'] == 'active'), None)

    def find_shot(shot_id: str) -> dict | None:
        return next((row for row in state['shots'] if row['id'] == shot_id and row['lifecycle'] == 'active'), None)

    def platform(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        assert request.headers.get('accept-profile') == 'tonde', path
        workspace_param = request.url.params.get('workspace_id') or ''
        if path == '/rest/v1/workspace_members':
            if workspace_param != f'eq.{WORKSPACE}' or role is None:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{'role': role}])
        in_workspace = workspace_param == f'eq.{WORKSPACE}'
        if path == '/rest/v1/productions':
            return httpx.Response(200, json=[deepcopy(state['production'])] if in_workspace else [])
        if path == '/rest/v1/scenes':
            return httpx.Response(200, json=deepcopy(state['scenes']) if in_workspace else [])
        if path == '/rest/v1/shots':
            return httpx.Response(200, json=deepcopy(state['shots']) if in_workspace else [])
        if path == '/rest/v1/assets':
            return httpx.Response(200, json=[
                {'id': CHARACTER, 'asset_type': 'character', 'name': 'Barista', 'description': 'Hands only.',
                 'metadata': {}, 'approval': 'draft', 'locked_at': None, 'lifecycle': 'active', 'revision': 1},
                {'id': ENVIRONMENT, 'asset_type': 'environment', 'name': 'Kitchen', 'description': 'Small and dark.',
                 'metadata': {}, 'approval': 'draft', 'locked_at': None, 'lifecycle': 'active', 'revision': 1},
                {'id': '00000000-0000-4000-8000-000000000053', 'asset_type': 'product', 'name': 'Ridgeway coffee',
                 'description': 'Matte bag.', 'metadata': {}, 'approval': 'draft', 'locked_at': None,
                 'lifecycle': 'active', 'revision': 1},
            ])
        if path == '/rest/v1/scope_bindings':
            return httpx.Response(200, json=[{
                'id': '00000000-0000-4000-8000-000000000061', 'scope_object_id': SCENE_ONE,
                'asset_id': ENVIRONMENT, 'reference_id': None, 'binding_role': 'world',
                'inheritance': 'inherit', 'locked_at': None,
            }])
        if path == '/rest/v1/scene_participants':
            return httpx.Response(200, json=[{'scene_id': SCENE_ONE, 'asset_id': CHARACTER, 'role': 'principal'}])
        if path == '/rest/v1/dialogue_lines':
            return httpx.Response(200, json=[{'id': '00000000-0000-4000-8000-000000000071', 'scene_id': SCENE_TWO,
                'shot_id': SHOT_TWO, 'line_type': 'narration'}])
        if path == '/rest/v1/creative_documents':
            return httpx.Response(200, json=[{'document_type': 'script', 'title': 'Worth the minute',
                'content': 'INT. KITCHEN - NIGHT', 'revision': 3, 'updated_at': '2026-10-05T00:00:00Z',
                'approval': 'draft', 'locked_at': None}])
        if path == '/rest/v1/results':
            return httpx.Response(200, json=[{'id': '00000000-0000-4000-8000-000000000081', 'shot_id': SHOT_ONE, 'state': 'raw'}])
        if not path.startswith('/rest/v1/rpc/'):
            return httpx.Response(200, json=[])

        name = path.rsplit('/', 1)[-1]
        payload = json.loads(request.content or b'{}')
        state['rpc_calls'].append({'name': name, 'payload': payload})
        if no_migration:
            # PostgREST cannot resolve a function this deployment never created.
            return fail('PGRST202', name)
        if payload.get('target_workspace') != WORKSPACE or payload.get('target_production') != PRODUCTION:
            return fail('42501', 'Authenticated workspace editor required')
        # studio_timing is member-level in SQL: a viewer may read timing, nobody may write it.
        if name == 'studio_timing':
            if role is None:
                return fail('42501', 'Workspace access denied')
            return httpx.Response(200, json=deepcopy(state['timing']))
        if not editor():
            return fail('42501', 'Authenticated workspace editor required')
        if name == 'create_studio_scene':
            title = (payload['scene'].get('title') or '').strip()
            if not title:
                return fail('22023', 'A Scene needs a title of 1 to 160 characters')
            created = scene_row(NEW_ID, title, 3072, payload['scene'].get('duration_ms') or 0)
            state['scenes'].append(created)
            return httpx.Response(200, json={'scene_id': NEW_ID, 'title': title, 'sort_order': 3072,
                'revision': 1, 'approval': 'draft', 'timing': deepcopy(state['timing'])})
        if name == 'update_studio_scene':
            scene = find_scene(payload['target_scene'])
            if scene is None:
                return fail('P0002', 'That scene is unavailable in this Production')
            if scene['locked_at'] is not None:
                return fail('23514', 'That scene is locked. Unlock it before editing.')
            if payload['expected_revision'] != scene['revision']:
                return fail('40001', 'That scene changed since you loaded it')
            for field, value in payload['patch'].items():
                if field == 'duration_ms':
                    scene['planned_duration_ms'] = value
                elif field in scene:
                    scene[field] = value
            scene['revision'] += 1
            if scene['approval'] == 'approved' and any(k != 'duration_ms' for k in payload['patch']):
                scene['approval'] = 'changed_after_approval'
            return httpx.Response(200, json={'scene_id': scene['id'], 'revision': scene['revision'],
                'approval': scene['approval'], 'timing': deepcopy(state['timing'])})
        if name == 'reorder_studio_scenes':
            ordered = payload['ordered_ids']
            live = [row['id'] for row in state['scenes'] if row['lifecycle'] == 'active']
            if sorted(ordered) != sorted(live):
                return fail('22023', 'The Scene order must list exactly the live Scenes of this Production')
            for position, scene_id in enumerate(ordered, start=1):
                find_scene(scene_id)['sort_order'] = position * 1024
            return httpx.Response(200, json={'scenes': len(ordered), 'timing': deepcopy(state['timing'])})
        if name == 'archive_studio_scene':
            scene = find_scene(payload['target_scene'])
            if scene is None:
                return fail('P0002', 'That scene is unavailable in this Production')
            live_shots = [row for row in state['shots'] if row['scene_id'] == scene['id'] and row['lifecycle'] == 'active']
            if live_shots and not payload.get('cascade'):
                return fail('23514', 'This Scene still has Shots. Archive them too, or move them first.')
            for row in live_shots:
                row['lifecycle'] = 'archived'
            scene['lifecycle'] = 'archived'
            return httpx.Response(200, json={'scene_id': scene['id'], 'archived_shots': len(live_shots),
                'timing': deepcopy(state['timing'])})
        if name == 'create_studio_shot':
            title = (payload['shot'].get('title') or '').strip()
            if not title:
                return fail('22023', 'A Shot needs a title of 1 to 160 characters')
            created = shot_row(NEW_ID, payload.get('target_scene'), title, 3072, payload['shot'].get('duration_ms'))
            created['execution_method'] = payload['shot'].get('execution_method') or 'real'
            created['framing'] = payload['shot'].get('framing') or ''
            state['shots'].append(created)
            return httpx.Response(200, json={'shot_id': NEW_ID, 'title': title, 'sort_order': 3072, 'revision': 1,
                'approval': 'draft', 'execution_method': created['execution_method'], 'timing': deepcopy(state['timing'])})
        if name == 'update_studio_shot':
            shot = find_shot(payload['target_shot'])
            if shot is None:
                return fail('P0002', 'That shot is unavailable in this Production')
            if shot['locked_at'] is not None:
                return fail('23514', 'That shot is locked. Unlock it before editing.')
            if payload['expected_revision'] != shot['revision']:
                return fail('40001', 'That shot changed since you loaded it')
            for field, value in payload['patch'].items():
                if field == 'duration_ms':
                    shot['planned_duration_ms'] = value
                elif field in shot:
                    shot[field] = value
            shot['revision'] += 1
            if shot['approval'] == 'approved':
                shot['approval'] = 'changed_after_approval'
            return httpx.Response(200, json={'shot_id': shot['id'], 'revision': shot['revision'],
                'approval': shot['approval'], 'execution_method': shot['execution_method'],
                'scene_id': shot['scene_id'], 'timing': deepcopy(state['timing'])})
        if name == 'move_studio_shot':
            shot = find_shot(payload['target_shot'])
            if shot is None:
                return fail('P0002', 'That shot is unavailable in this Production')
            if payload['expected_revision'] != shot['revision']:
                return fail('40001', 'That shot changed since you loaded it')
            if find_scene(payload['target_scene']) is None:
                return fail('P0002', 'Target Scene is unavailable in this Production')
            shot['scene_id'] = payload['target_scene']
            shot['sort_order'] = 4096
            shot['revision'] += 1
            return httpx.Response(200, json={'shot_id': shot['id'], 'scene_id': shot['scene_id'],
                'sort_order': shot['sort_order'], 'revision': shot['revision'], 'timing': deepcopy(state['timing'])})
        if name == 'reorder_studio_shots':
            ordered = payload['ordered_ids']
            scene_id = payload.get('target_scene')
            live = [row['id'] for row in state['shots']
                if row['scene_id'] == scene_id and row['lifecycle'] == 'active']
            if sorted(ordered) != sorted(live):
                return fail('22023', 'The Shot order must list exactly the live Shots of this Scene')
            for position, shot_id in enumerate(ordered, start=1):
                find_shot(shot_id)['sort_order'] = position * 1024
            return httpx.Response(200, json={'shots': len(ordered), 'timing': deepcopy(state['timing'])})
        if name == 'archive_studio_shot':
            shot = find_shot(payload['target_shot'])
            if shot is None:
                return fail('P0002', 'That shot is unavailable in this Production')
            if payload['expected_revision'] != shot['revision']:
                return fail('40001', 'That shot changed since you loaded it')
            shot['lifecycle'] = 'archived'
            return httpx.Response(200, json={'shot_id': shot['id'], 'archived': True, 'timing': deepcopy(state['timing'])})
        if name == 'set_studio_approval':
            if payload['desired_approval'] not in ('draft', 'needs_review', 'approved', 'changed_after_approval'):
                return fail('22023', 'Unsupported approval state')
            if payload['target_scope'] == 'shot':
                shot = find_shot(payload['target_id'])
                if shot is None:
                    return fail('P0002', 'That shot is unavailable in this Production')
                shot['approval'] = payload['desired_approval']
                shot['revision'] += 1
                return httpx.Response(200, json={'scope': 'shot', 'id': shot['id'],
                    'approval': shot['approval'], 'revision': shot['revision']})
            return httpx.Response(200, json={'scope': payload['target_scope'], 'id': payload['target_id'],
                'approval': payload['desired_approval'], 'revision': 8})
        if name == 'set_studio_lock':
            if payload['target_scope'] == 'shot':
                shot = find_shot(payload['target_id'])
                if shot is None:
                    return fail('P0002', 'That shot is unavailable in this Production')
                shot['locked_at'] = '2026-10-05T00:00:00Z' if payload['locked'] else None
                shot['revision'] += 1
                return httpx.Response(200, json={'scope': 'shot', 'id': shot['id'], 'locked': bool(payload['locked']),
                    'revision': shot['revision']})
            return httpx.Response(200, json={'scope': payload['target_scope'], 'id': payload['target_id'],
                'locked': bool(payload['locked']), 'revision': 8})
        if name == 'reconcile_studio_runtime':
            if find_scene(payload['absorb_scene']) is None:
                return fail('P0002', 'The absorbing Scene is unavailable')
            adjusted = deepcopy(state['timing'])
            adjusted['status'] = 'fits'
            adjusted['delta_ms'] = 0
            adjusted['total_ms'] = adjusted['target_ms']
            state['timing'] = adjusted
            return httpx.Response(200, json={'adjusted_ms': -2000, 'shot_id': SHOT_TWO,
                'scene_id': payload['absorb_scene'], 'shot_duration_ms': 16000, 'timing': deepcopy(adjusted)})
        return httpx.Response(404, json={'code': 'PGRST202', 'message': f'Could not find the function {name}'})

    settings = Settings(
        supabase_url='https://platform.test', supabase_publishable_key=SecretStr('publishable-test-key'),
        director_provider='openai_compatible', director_api_key=SecretStr('test-director-key'),
        director_base_url='https://provider.test/v1', director_model='test-model',
    )
    application = create_app(settings, transport=httpx.MockTransport(platform))
    client = TestClient(application)
    # Enter the app lifespan so the gateway exists, exactly as `with client:` does.
    client.__enter__()
    return client, state


def url(path: str) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/studio{path}'


def other_url(path: str) -> str:
    return f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/studio{path}'


def test_the_studio_read_model_aggregates_one_master_production():
    client, _ = make_client()
    response = client.get(url(''), headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['production']['id'] == PRODUCTION
    assert data['production']['revision'] == 7
    assert [scene['title'] for scene in data['scenes']] == ['Dark kitchen', 'Weighing']
    first = data['scenes'][0]
    assert [shot['title'] for shot in first['shots']] == ['Establish']
    assert first['character_asset_ids'] == [CHARACTER]
    assert first['environment_asset_id'] == ENVIRONMENT
    assert first['bindings'][0]['binding_role'] == 'world'
    assert first['shot_count'] == 1
    assert data['scenes'][1]['dialogue_lines'] == 1
    assert data['documents']['script']['revision'] == 3
    assert data['timing']['status'] == 'fits'
    assert data['runtime_conflict'] is False
    assert [block['scene_id'] for block in data['timeline']] == [SCENE_ONE, SCENE_TWO]
    assert data['timeline'][0]['shots'][0]['execution_method'] == 'real'
    assert data['status_summary']['scenes'] == 2 and data['status_summary']['shots'] == 2
    assert data['capabilities']['shot_execution'] is False
    assert data['capabilities']['timeline_editing'] is True
    assert data['truncated'] is False


def test_the_read_model_reports_a_runtime_conflict_without_faking_readiness():
    timing = deepcopy(TIMING)
    timing.update({'total_ms': 34000, 'delta_ms': 4000, 'status': 'over'})
    timing['scene_states'][1]['duration_ms'] = 22000
    client, _ = make_client(timing=timing)
    data = client.get(url(''), headers=HEADERS).json()['data']
    assert data['runtime_conflict'] is True
    assert data['timing']['status'] == 'over'
    assert data['timing']['delta_ms'] == 4000


def test_creating_a_scene_and_a_shot_persists_into_the_next_read():
    client, state = make_client()
    created = client.post(url('/scenes'), headers=HEADERS,
        json={'title': 'Cold open', 'purpose': 'Earn attention', 'duration_ms': 4000})
    assert created.status_code == 200
    assert created.json()['data']['scene_id'] == NEW_ID
    call = state['rpc_calls'][-1]
    assert call['name'] == 'create_studio_scene'
    assert call['payload']['target_workspace'] == WORKSPACE and call['payload']['target_production'] == PRODUCTION
    shot = client.post(url('/shots'), headers=HEADERS,
        json={'scene_id': NEW_ID, 'title': 'Kettle clicks', 'framing': 'close', 'duration_ms': 2000})
    assert shot.status_code == 200
    call = state['rpc_calls'][-1]
    assert call['name'] == 'create_studio_shot'
    assert call['payload']['target_scene'] == NEW_ID
    assert call['payload']['shot']['framing'] == 'close'
    model = client.get(url(''), headers=HEADERS).json()['data']
    assert [scene['title'] for scene in model['scenes']][-1] == 'Cold open'
    assert model['scenes'][-1]['shots'][0]['title'] == 'Kettle clicks'
    assert model['scenes'][-1]['shots'][0]['framing'] == 'close'


def test_a_scene_rename_sends_only_supplied_fields_and_persists():
    client, state = make_client()
    response = client.patch(url(f'/scenes/{SCENE_ONE}'), headers=HEADERS,
        json={'expected_revision': 1, 'title': 'Cold open'})
    assert response.status_code == 200
    assert response.json()['data']['revision'] == 2
    payload = state['rpc_calls'][-1]['payload']
    assert payload['patch'] == {'title': 'Cold open'}, 'no unsupplied field may be sent'
    assert payload['expected_revision'] == 1
    model = client.get(url(''), headers=HEADERS).json()['data']
    assert model['scenes'][0]['title'] == 'Cold open'


def test_reorder_move_and_archive_send_the_exact_contract():
    client, state = make_client()
    reordered = client.post(url('/scenes/reorder'), headers=HEADERS,
        json={'ordered_ids': [SCENE_TWO, SCENE_ONE], 'expected_production_revision': 7})
    assert reordered.status_code == 200
    assert state['rpc_calls'][-1]['payload']['ordered_ids'] == [SCENE_TWO, SCENE_ONE]
    shots = client.post(url(f'/scenes/{SCENE_ONE}/shots/reorder'), headers=HEADERS,
        json={'ordered_ids': [SHOT_ONE]})
    assert shots.status_code == 200
    assert state['rpc_calls'][-1]['payload']['target_scene'] == SCENE_ONE
    moved = client.post(url(f'/shots/{SHOT_ONE}/move'), headers=HEADERS,
        json={'scene_id': SCENE_TWO, 'expected_revision': 1})
    assert moved.status_code == 200
    assert moved.json()['data']['scene_id'] == SCENE_TWO
    archived = client.post(url(f'/shots/{SHOT_TWO}/archive'), headers=HEADERS, json={'expected_revision': 1})
    assert archived.status_code == 200
    assert archived.json()['data']['archived'] is True
    model = client.get(url(''), headers=HEADERS).json()['data']
    assert all(shot['id'] != SHOT_TWO for scene in model['scenes'] for shot in scene['shots']), 'archived Shot leaves the live view'
    with_shot = client.post(url(f'/scenes/{SCENE_TWO}/archive'), headers=HEADERS, json={'expected_revision': 1, 'cascade': True})
    assert with_shot.status_code == 200
    assert state['rpc_calls'][-1]['payload']['cascade'] is True


def test_duration_change_and_reconciliation_keep_the_runtime_honest():
    client, _ = make_client()
    edited = client.patch(url(f'/shots/{SHOT_ONE}'), headers=HEADERS,
        json={'expected_revision': 1, 'duration_ms': 9000})
    assert edited.status_code == 200
    reconcile = client.post(url('/runtime/reconcile'), headers=HEADERS,
        json={'absorb_scene': SCENE_TWO, 'expected_production_revision': 7})
    assert reconcile.status_code == 200
    data = reconcile.json()['data']
    assert data['shot_duration_ms'] == 16000 and data['adjusted_ms'] == -2000
    assert data['timing']['status'] == 'fits'
    timing = client.get(url('/timing'), headers=HEADERS).json()['data']
    assert timing['status'] == 'fits' and timing['total_ms'] == timing['target_ms']


def test_approval_marks_changed_after_approval_and_locks_block_edits():
    client, _ = make_client()
    approved = client.post(url('/approval'), headers=HEADERS,
        json={'scope': 'shot', 'id': SHOT_ONE, 'approval': 'approved', 'expected_revision': 1})
    assert approved.status_code == 200
    assert approved.json()['data']['approval'] == 'approved'
    modified = client.patch(url(f'/shots/{SHOT_ONE}'), headers=HEADERS,
        json={'expected_revision': 2, 'title': 'Tighter'})
    assert modified.status_code == 200
    assert modified.json()['data']['approval'] == 'changed_after_approval'
    locked = client.post(url('/lock'), headers=HEADERS,
        json={'scope': 'shot', 'id': SHOT_ONE, 'locked': True, 'expected_revision': 3})
    assert locked.status_code == 200 and locked.json()['data']['locked'] is True
    blocked = client.patch(url(f'/shots/{SHOT_ONE}'), headers=HEADERS,
        json={'expected_revision': 4, 'title': 'Not allowed'})
    assert blocked.status_code == 409
    assert blocked.json()['errors'][0]['type'] == 'conflict'
    assert 'locked' in blocked.json()['errors'][0]['message'].lower()
    production_lock = client.post(url('/lock'), headers=HEADERS,
        json={'scope': 'production', 'id': PRODUCTION, 'locked': True})
    assert production_lock.status_code == 200


def test_stale_revisions_are_conflicts_not_silent_overwrites():
    client, _ = make_client()
    stale = client.patch(url(f'/scenes/{SCENE_ONE}'), headers=HEADERS,
        json={'expected_revision': 99, 'title': 'Stale'})
    assert stale.status_code == 409
    assert stale.json()['errors'][0]['code'] == 'STUDIO_CONFLICT'
    model = client.get(url(''), headers=HEADERS).json()['data']
    assert model['scenes'][0]['title'] == 'Dark kitchen', 'the newer work survived'


def test_invalid_input_is_a_422_and_an_unknown_object_is_a_404():
    client, _ = make_client()
    blank = client.post(url('/scenes'), headers=HEADERS, json={'title': '   '})
    assert blank.status_code == 422
    unknown_field = client.post(url('/scenes'), headers=HEADERS, json={'title': 'Fine', 'nonsense': True})
    assert unknown_field.status_code == 422
    bad_id = client.patch(url('/scenes/not-a-uuid'), headers=HEADERS, json={'expected_revision': 1, 'title': 'x'})
    assert bad_id.status_code == 422
    missing = client.patch(url('/scenes/00000000-0000-4000-8000-00000000dead'), headers=HEADERS,
        json={'expected_revision': 1, 'title': 'x'})
    assert missing.status_code == 404
    assert missing.json()['errors'][0]['type'] == 'not_found'


def test_a_viewer_can_read_the_studio_but_not_change_it():
    client, _ = make_client(role='viewer')
    assert client.get(url(''), headers=HEADERS).status_code == 200
    denied = client.post(url('/scenes'), headers=HEADERS, json={'title': 'Viewer scene'})
    assert denied.status_code == 403
    assert denied.json()['errors'][0]['type'] == 'authorization'


def test_another_workspace_cannot_read_or_write_this_studio():
    client, _ = make_client()
    assert client.get(other_url(''), headers=HEADERS).status_code == 403
    denied = client.post(other_url('/shots'), headers=HEADERS, json={'title': 'Intruder'})
    assert denied.status_code == 403


def test_a_deployment_without_the_studio_migration_reports_it_truthfully():
    client, _ = make_client(no_migration=True)
    response = client.post(url('/scenes'), headers=HEADERS, json={'title': 'Cold open'})
    assert response.status_code == 503
    error = response.json()['errors'][0]
    assert error['code'] == 'STUDIO_SCHEMA_MISSING'
    assert 'migration' in error['message'].lower()
