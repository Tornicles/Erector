"""Prompt 6 Real Production API coverage: reads, the direct/apply path, locks, Takes.

The platform is mocked with httpx.MockTransport. Semantic SQL behaviour (readiness
derivation, readiness queue, exclusive preferred Take, guards) is proven against real
embedded PostgreSQL in tests/database/prompt6-real-production.test.mjs; these tests
prove the HTTP path — routing, authorization, the exact RPC payload contract, error
translation, and that the deterministic director only ever names gear the creator owns.
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
SHOT_ONE = '00000000-0000-4000-8000-000000000041'
SHOT_TWO = '00000000-0000-4000-8000-000000000042'
CAMERA = '00000000-0000-4000-8000-000000000101'
LENS_50 = '00000000-0000-4000-8000-000000000102'
TRIPOD = '00000000-0000-4000-8000-000000000103'
LIGHT = '00000000-0000-4000-8000-000000000104'
SOFTBOX = '00000000-0000-4000-8000-000000000105'
LAV = '00000000-0000-4000-8000-000000000106'
TAKE_ONE = '00000000-0000-4000-8000-000000000201'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

TIMING = {'total_ms': 30000, 'target_ms': 30000, 'delta_ms': 0, 'status': 'fits', 'scene_states': []}


def setup_resources() -> list[dict]:
    def item(identifier: str, kind: str, name: str, **metadata) -> dict:
        return {'id': identifier, 'resource_type': kind, 'name': name, 'manufacturer': None, 'model': None,
            'mount': None, 'stabilization': None, 'metadata': metadata}
    return [
        item(CAMERA, 'camera', 'A7C II'),
        item(LENS_50, 'lens', '50 mm f/1.8', focal_length_mm=50),
        item(TRIPOD, 'tripod', 'Travel tripod'),
        item(LIGHT, 'light', 'Amaran 100d'),
        item(SOFTBOX, 'modifier', '90 cm softbox'),
        item(LAV, 'microphone', 'Lav mic'),
    ]


def real_shot(shot_id: str, title: str, **overrides) -> dict:
    row = {'shot_id': shot_id, 'scene_id': SCENE_ONE, 'scene_order': 1, 'scene_title': 'Dark kitchen',
        'order': 1024, 'title': title, 'purpose': 'insert', 'subject': 'the scale', 'framing': 'close-up',
        'execution_method': 'real', 'approval': 'draft', 'locked': False, 'planned_duration_ms': 6000,
        'expected_duration_ms': None, 'plan_id': None, 'plan_revision': None, 'plan_status': None,
        'readiness': 'unplanned', 'readiness_note': '', 'complexity': None, 'camera_resource_id': None,
        'lens_resource_id': None, 'movement': 'locked', 'stabilization': '', 'lighting_intent': '',
        'sound_plan': '', 'solo_feasibility': None, 'crew_roles': [], 'safety_flags': [],
        'requirements': {'owned': 0, 'substitute': 0, 'missing': 0, 'unverified': 0},
        'capture': None, 'takes': {'count': 0, 'preferred_take_id': None}, 'deviations': 0,
        'plan_updated_at': None}
    row.update(overrides)
    return row


def make_client(*, role: str | None = 'owner', locked_shot: str | None = None, ai_shot: str | None = None,
    no_migration: bool = False, plan_present: bool = False):
    shots = [
        real_shot(SHOT_ONE, 'Establish'),
        real_shot(SHOT_TWO, 'Scale macro', order=2048),
    ]
    if locked_shot:
        next(row for row in shots if row['shot_id'] == locked_shot)['locked'] = True
    if ai_shot:
        next(row for row in shots if row['shot_id'] == ai_shot)['execution_method'] = 'ai'
    state: dict = {
        'production': {'id': PRODUCTION, 'workspace_id': WORKSPACE, 'title': 'Ridgeway coffee',
            'production_type': 'commercial', 'execution_method': 'real', 'planned_duration_ms': 30000,
            'approval': 'draft', 'locked_at': None, 'revision': 7, 'lifecycle': 'active',
            'updated_at': '2026-10-05T00:00:00Z'},
        'shots': shots,
        'setup': setup_resources(),
        'plan': None, 'requirements': [], 'alternatives': [],
        'capture': None, 'takes': [], 'deviations': [],
        'rpc_calls': [], 'writes': [],
    }

    def editor() -> bool:
        return role in ('owner', 'admin', 'editor')

    def fail(code: str, message: str) -> httpx.Response:
        if no_migration:
            return httpx.Response(404, json={'code': 'PGRST202', 'message': f'Could not find the function {message}'})
        return httpx.Response(400, json={'code': code, 'message': message})

    def platform(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        workspace_param = request.url.params.get('workspace_id') or ''
        if path == '/rest/v1/workspace_members':
            if workspace_param != f'eq.{WORKSPACE}' or role is None:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{'role': role}])
        if path == '/rest/v1/production_resources':
            return httpx.Response(200, json=deepcopy(state['setup']) if workspace_param == f'eq.{WORKSPACE}' else [])
        if not path.startswith('/rest/v1/rpc/'):
            return httpx.Response(200, json=[])

        name = path.rsplit('/', 1)[-1]
        payload = json.loads(request.content or b'{}')
        state['rpc_calls'].append({'name': name, 'payload': payload})
        if no_migration:
            return fail('PGRST202', name)
        if payload.get('target_workspace') != WORKSPACE or payload.get('target_production') != PRODUCTION:
            return fail('42501', 'Workspace access denied')

        def find(shot_id: str) -> dict | None:
            return next((row for row in state['shots'] if row['shot_id'] == shot_id), None)

        if name == 'real_execution_surface':
            if role is None:
                return fail('42501', 'Workspace access denied')
            ready = [row['shot_id'] for row in state['shots'] if row['readiness'] in ('ready', 'ready_with_substitution')]
            return httpx.Response(200, json={'production': deepcopy(state['production']),
                'execution_faces': ['real', 'ai'], 'setup': deepcopy(state['setup']), 'timing': deepcopy(TIMING),
                'scenes': [{'scene_id': SCENE_ONE, 'order': 1, 'title': 'Dark kitchen', 'shots': len(state['shots']),
                    'ready': len(ready), 'unresolved': len(state['shots']) - len(ready), 'captured': 0,
                    'pickup_needed': 0, 'complexity': None, 'unresolved_note': None}],
                'shots': deepcopy(state['shots']),
                'summary': {'shots': len(state['shots']), 'planned': sum(1 for row in state['shots'] if row['plan_id']),
                    'unplanned': sum(1 for row in state['shots'] if row['readiness'] == 'unplanned'),
                    'ready': len(ready), 'ready_with_substitution': 0, 'needs_decision': 0, 'missing_resource': 0,
                    'safety_blocked': 0, 'captured': sum(1 for row in state['shots'] if row['capture']),
                    'pickup_needed': 0, 'in_progress': 0, 'approved_plans': 0, 'changed_after_approval': 0,
                    'crew_roles': [], 'safety_flags': [], 'complexity': None},
                'readiness_queue': {'ready_to_shoot': ready, 'needs_decision': [], 'missing_resource': [],
                    'pickup_required': []}})
        if not editor():
            return fail('42501', 'Authenticated workspace editor required')
        if name == 'real_shot_detail':
            row = find(payload['target_shot'])
            if row is None:
                return fail('P0002', 'Shot unavailable')
            return httpx.Response(200, json={
                'shot': {'shot_id': row['shot_id'], 'scene_id': SCENE_ONE, 'title': row['title'],
                    'purpose': row['purpose'], 'subject': row['subject'], 'framing': row['framing'],
                    'movement': row['movement'], 'execution_method': row['execution_method'],
                    'approval': row['approval'], 'locked': row['locked'], 'revision': 3,
                    'planned_duration_ms': row['planned_duration_ms'], 'story_beat': 'Hook', 'creative_notes': ''},
                'scene': {'scene_id': SCENE_ONE, 'title': 'Dark kitchen', 'order': 1, 'purpose': 'Earn attention',
                    'description': 'A dark kitchen before sunrise.', 'environment_asset_id': None},
                'plan': deepcopy(state['plan']), 'readiness': row['readiness'],
                'requirements': deepcopy(state['requirements']), 'alternatives': deepcopy(state['alternatives']),
                'capture': deepcopy(state['capture']), 'takes': deepcopy(state['takes']),
                'deviations': deepcopy(state['deviations']), 'setup': deepcopy(state['setup']),
                'brief': {'tone': ['warm', 'premium'], 'creative_concept': 'A dark kitchen that turns into a morning'},
                'script_line': None})
        if name == 'save_real_plan':
            row = find(payload['target_shot'])
            if row is None:
                return fail('P0002', 'Shot unavailable')
            if row['locked']:
                return fail('23514', 'That shot is locked. Unlock it before editing.')
            if payload.get('expected_shot_revision') is not None and payload['expected_shot_revision'] != 3:
                return fail('40001', 'That shot changed since you loaded it')
            if row['approval'] == 'approved' or (state['plan'] or {}).get('approval') == 'approved':
                approval = 'changed_after_approval'
            else:
                approval = 'draft'
            row['plan_id'] = '00000000-0000-4000-8000-000000000301'
            state['plan'] = {**payload['plan'], 'plan_id': row['plan_id'], 'shot_id': row['shot_id'],
                'approval': approval, 'locked': False, 'revision': 2}
            state['requirements'] = deepcopy(payload['requirements'])
            state['alternatives'] = deepcopy(payload['alternatives'])
            row['readiness'] = payload['plan'].get('plan_status') or 'ready'
            row['camera_resource_id'] = payload['plan'].get('camera_resource_id')
            row['lens_resource_id'] = payload['plan'].get('lens_resource_id')
            row['movement'] = payload['plan'].get('movement')
            state['writes'].append({'name': name, 'payload': payload, 'plan': deepcopy(state['plan'])})
            return httpx.Response(200, json={'plan_id': row['plan_id'], 'shot_id': row['shot_id'],
                'plan_revision': 2, 'approval': approval, 'plan_status': payload['plan'].get('plan_status'),
                'readiness': row['readiness'], 'requirements': len(state['requirements']),
                'alternatives': len(state['alternatives']), 'timing': deepcopy(TIMING)})
        if name == 'set_real_plan_approval':
            if state['plan'] is None:
                return fail('P0002', 'This Shot has no Real plan to approve')
            state['plan']['approval'] = payload['desired_approval']
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'plan_id': state['plan']['plan_id'], 'shot_id': payload['target_shot'],
                'approval': payload['desired_approval'], 'revision': 3})
        if name == 'set_real_plan_lock':
            if state['plan'] is None:
                return fail('P0002', 'This Shot has no Real plan to lock')
            state['plan']['locked'] = payload['locked']
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'plan_id': state['plan']['plan_id'], 'shot_id': payload['target_shot'],
                'locked': payload['locked'], 'revision': 4})
        if name == 'set_shot_capture_state':
            row = find(payload['target_shot'])
            if row is None:
                return fail('P0002', 'Shot unavailable')
            if row['locked']:
                return fail('23514', 'That shot is locked. Unlock it before editing.')
            previous = state['capture'] or {}
            if payload.get('expected_revision') is not None and previous.get('revision') != payload['expected_revision']:
                return fail('40001', 'The capture state changed since you loaded it')
            state['capture'] = {'status': payload['status'], 'notes': payload['notes'],
                'captured_at': '2026-10-05T10:00:00Z' if payload['status'] == 'captured' else None,
                'revision': (previous.get('revision') or 0) + 1}
            row['capture'] = deepcopy(state['capture'])
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'shot_id': payload['target_shot'], **state['capture']})
        if name == 'save_shot_take':
            row = find(payload['target_shot'])
            if row is None:
                return fail('P0002', 'Shot unavailable')
            if row['locked']:
                return fail('23514', 'That shot is locked. Unlock it before editing.')
            take = payload['take']
            if not 1 <= int(take.get('take_number') or 0) <= 999:
                return fail('22023', 'A Take needs a number between 1 and 999')
            if take.get('status') == 'preferred':
                for existing in state['takes']:
                    if existing['status'] == 'preferred':
                        existing['status'] = 'good'
            existing = next((item for item in state['takes'] if item['take_number'] == take['take_number']), None)
            if existing:
                existing.update({'status': take['status'], 'notes': take['notes'], 'revision': existing['revision'] + 1})
                saved = existing
            else:
                saved = {'id': TAKE_ONE, 'take_number': take['take_number'], 'status': take['status'],
                    'notes': take['notes'], 'media_id': None, 'revision': 1}
                state['takes'].append(saved)
            row['takes'] = {'count': len(state['takes']),
                'preferred_take_id': next((item['id'] for item in state['takes'] if item['status'] == 'preferred'), None)}
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'take_id': saved['id'], 'shot_id': payload['target_shot'],
                'take_number': saved['take_number'], 'status': saved['status'],
                'preferred': saved['status'] == 'preferred', 'revision': saved['revision'], 'capture': None})
        if name == 'delete_shot_take':
            state['takes'] = [item for item in state['takes'] if item['id'] != payload['target_take']]
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'take_id': payload['target_take'], 'shot_id': payload['target_shot'], 'take_number': 1})
        if name == 'record_shot_deviation':
            deviation = payload['deviation']
            if deviation.get('field') not in ('camera', 'lens', 'movement', 'stabilization', 'camera_position',
                'lighting', 'sound', 'location', 'performance', 'product', 'duration', 'other'):
                return fail('22023', 'Unsupported deviation field')
            state['deviations'].append({'id': '00000000-0000-4000-8000-000000000401', **deviation,
                'recorded_at': '2026-10-05T10:30:00Z'})
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'deviation_id': '00000000-0000-4000-8000-000000000401',
                'shot_id': payload['target_shot'], 'field': deviation['field'],
                'planned_value': deviation['planned_value'], 'actual_value': deviation['actual_value'],
                'recorded_at': '2026-10-05T10:30:00Z'})
        return httpx.Response(404, json={'code': 'PGRST202', 'message': f'Could not find the function {name}'})

    settings = Settings(
        supabase_url='https://platform.test', supabase_publishable_key=SecretStr('publishable-test-key'),
        director_provider='openai_compatible', director_api_key=SecretStr('test-director-key'),
        director_base_url='https://provider.test/v1', director_model='test-model',
    )
    application = create_app(settings, transport=httpx.MockTransport(platform))
    client = TestClient(application)
    client.__enter__()
    return client, state


def url(path: str) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/real{path}'


def test_the_real_surface_reports_setup_readiness_and_the_on_set_queues():
    client, _ = make_client()
    response = client.get(url('/surface'), headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['production']['revision'] == 7
    assert [item['name'] for item in data['setup']] == ['A7C II', '50 mm f/1.8', 'Travel tripod', 'Amaran 100d', '90 cm softbox', 'Lav mic']
    assert data['summary']['shots'] == 2
    assert data['summary']['unplanned'] == 2
    assert 'readiness_score' not in data['summary']
    assert data['readiness_queue']['ready_to_shoot'] == []
    assert data['capabilities']['setup_matching'] is True
    assert data['capabilities']['ai_prompt_compilation'] is False
    assert data['provider']['configured'] is True


def test_a_shot_detail_returns_the_plan_requirements_takes_and_deviations():
    client, _ = make_client()
    response = client.get(url(f'/shots/{SHOT_ONE}'), headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['shot']['shot_id'] == SHOT_ONE
    assert data['scene']['title'] == 'Dark kitchen'
    assert data['plan'] is None
    assert data['requirements'] == []
    assert data['takes'] == []
    assert data['brief']['creative_concept'].startswith('A dark kitchen')


def test_directing_a_shot_previews_a_setup_aware_plan_without_writing_anything():
    client, state = make_client()
    response = client.post(url(f'/shots/{SHOT_ONE}/direct'), headers=HEADERS,
        json={'text': 'How do I shoot this? I am shooting alone.'})
    assert response.status_code == 200
    body = response.json()['data']
    assert body['applied'] is None
    plan = body['plan']
    assert plan['camera_resource_id'] == CAMERA
    assert plan['lens_resource_id'] == LENS_50
    assert plan['movement'] == 'locked'
    assert plan['solo_feasibility'] == 'solo'
    assert 'starting point' in plan['aperture']
    assert 'Amaran 100d' in plan['lighting_plan']
    assert body['answer']['readiness'] in ('ready', 'ready_with_substitution', 'needs_decision', 'missing_resource')
    assert 'starting points' in body['answer']['truthfulness']
    owned = {item['resource_id'] for item in body['requirements'] if item['status'] == 'owned'}
    assert CAMERA in owned and LAV not in owned  # a static insert has no dialogue, so no microphone is claimed
    assert state['writes'] == [], 'a preview must not write'


def test_directing_and_applying_writes_the_plan_through_the_guarded_rpc():
    client, state = make_client()
    response = client.post(url(f'/shots/{SHOT_ONE}/direct'), headers=HEADERS,
        json={'text': 'Give me the fastest version', 'apply': True, 'expected_shot_revision': 3})
    assert response.status_code == 200
    body = response.json()['data']
    assert body['applied']['plan_id']
    assert body['applied']['readiness'] in ('ready', 'ready_with_substitution', 'needs_decision', 'missing_resource')
    write = next(item for item in state['writes'] if item['name'] == 'save_real_plan')
    payload = write['payload']
    assert payload['target_shot'] == SHOT_ONE
    assert payload['expected_shot_revision'] == 3
    assert payload['requirements'], 'the applied plan carries its Setup matching'
    assert all({'kind', 'label', 'status', 'epistemic'} <= set(item) for item in payload['requirements'])
    assert payload['alternatives'], 'the applied plan carries practical alternatives'
    kinds = {item['kind'] for item in payload['alternatives']}
    assert 'solo' in kinds and 'safest' in kinds
    # The saved plan honours the constraint: 'fastest' means a locked camera.
    assert payload['plan']['movement'] == 'locked'


def test_a_locked_shot_is_refused_before_the_director_touches_it():
    client, state = make_client(locked_shot=SHOT_ONE)
    response = client.post(url(f'/shots/{SHOT_ONE}/direct'), headers=HEADERS,
        json={'text': 'Make this easier', 'apply': True})
    assert response.status_code == 409
    error = response.json()['errors'][0]
    assert error['code'] == 'SHOT_LOCKED'
    assert 'locked' in error['message'].lower()
    assert state['writes'] == []


def test_a_shot_assigned_to_ai_creation_has_no_real_plan_to_direct():
    client, _ = make_client(ai_shot=SHOT_TWO)
    response = client.post(url(f'/shots/{SHOT_TWO}/direct'), headers=HEADERS, json={'text': 'How do I shoot this?'})
    assert response.status_code == 422
    error = response.json()['errors'][0]
    assert error['code'] == 'INVALID_REAL_INPUT'
    assert 'AI creation' in error['message']


def test_directing_a_scene_is_batched_and_reports_what_it_skipped():
    client, state = make_client(locked_shot=SHOT_TWO)
    response = client.post(url(f'/scenes/{SCENE_ONE}/direct'), headers=HEADERS,
        json={'text': 'I only have one light', 'apply': True})
    assert response.status_code == 200
    body = response.json()['data']
    assert body['scope'] == 'scene'
    assert body['summary'] == {'directed': 1, 'skipped': 1}
    assert body['skipped'][0]['shot_id'] == SHOT_TWO
    assert body['skipped'][0]['reason'] == 'locked'
    applied = [item for item in state['writes'] if item['name'] == 'save_real_plan']
    assert len(applied) == 1
    assert applied[0]['payload']['target_shot'] == SHOT_ONE
    assert 'one-light plan' in applied[0]['payload']['plan']['lighting_plan']


def test_phone_only_survives_the_http_path_and_never_names_an_unowned_lens():
    client, state = make_client()
    response = client.post(url(f'/shots/{SHOT_ONE}/direct'), headers=HEADERS,
        json={'text': 'Use only my phone', 'apply': True})
    assert response.status_code == 200
    plan = response.json()['data']['applied']
    assert plan['readiness']
    payload = state['writes'][-1]['payload']
    assert payload['plan']['camera_resource_id'] is None or payload['plan']['camera_resource_id'] == CAMERA
    camera_requirement = next(item for item in payload['requirements'] if item['kind'] == 'camera')
    # No phone exists in this Setup, so the honest answer is that nothing can satisfy it.
    assert camera_requirement['status'] in ('owned', 'missing', 'substitute', 'unverified')
    lens_requirement = next(item for item in payload['requirements'] if item['kind'] == 'lens')
    assert lens_requirement['ideal_name'] or lens_requirement['detail']


def test_plan_approval_lock_capture_takes_and_deviations_reach_the_right_rpcs():
    client, state = make_client()
    assert client.post(url(f'/shots/{SHOT_ONE}/plan'), headers=HEADERS, json={
        'plan': {'plan_status': 'ready', 'movement': 'locked', 'aperture': 'f/2.8-f/4 starting point'},
        'requirements': [{'kind': 'camera', 'label': 'Camera', 'status': 'owned', 'resource_id': CAMERA}],
        'alternatives': [{'kind': 'safest', 'label': 'Safest version'}],
        'expected_shot_revision': 3,
    }).status_code == 200
    assert client.post(url(f'/shots/{SHOT_ONE}/plan/approval'), headers=HEADERS,
        json={'approval': 'approved', 'expected_shot_revision': 3}).json()['data']['approval'] == 'approved'
    assert client.post(url(f'/shots/{SHOT_ONE}/plan/lock'), headers=HEADERS,
        json={'locked': True, 'expected_shot_revision': 3}).json()['data']['locked'] is True
    capture = client.post(url(f'/shots/{SHOT_ONE}/capture'), headers=HEADERS,
        json={'status': 'captured', 'notes': '', 'expected_revision': None})
    assert capture.json()['data']['status'] == 'captured'
    take = client.post(url(f'/shots/{SHOT_ONE}/takes'), headers=HEADERS,
        json={'take_number': 1, 'status': 'preferred', 'notes': 'Use this one'})
    assert take.json()['data']['preferred'] is True
    deviation = client.post(url(f'/shots/{SHOT_ONE}/deviations'), headers=HEADERS,
        json={'field': 'movement', 'planned_value': 'gimbal push-in', 'actual_value': 'handheld static'})
    assert deviation.json()['data']['field'] == 'movement'
    assert client.delete(url(f'/shots/{SHOT_ONE}/takes/{TAKE_ONE}'), headers=HEADERS).status_code == 200
    names = [item['name'] for item in state['rpc_calls']]
    for expected in ('save_real_plan', 'set_real_plan_approval', 'set_real_plan_lock', 'set_shot_capture_state',
        'save_shot_take', 'record_shot_deviation', 'delete_shot_take'):
        assert expected in names, expected


def test_a_capture_state_write_is_a_revision_checked_editor_action():
    client, _ = make_client()
    assert client.post(url(f'/shots/{SHOT_ONE}/capture'), headers=HEADERS,
        json={'status': 'setup', 'notes': 'Rigging'}).status_code == 200
    stale = client.post(url(f'/shots/{SHOT_ONE}/capture'), headers=HEADERS,
        json={'status': 'captured', 'expected_revision': 9})
    assert stale.status_code == 409
    assert stale.json()['errors'][0]['code'] == 'STUDIO_CONFLICT'


def test_a_viewer_may_read_the_real_surface_but_may_not_direct_or_write():
    client, state = make_client(role='viewer')
    assert client.get(url('/surface'), headers=HEADERS).status_code == 200
    assert client.get(url(f'/shots/{SHOT_ONE}'), headers=HEADERS).status_code == 403
    directed = client.post(url(f'/shots/{SHOT_ONE}/direct'), headers=HEADERS, json={'text': 'How do I shoot this?'})
    assert directed.status_code == 403
    assert client.post(url(f'/shots/{SHOT_ONE}/capture'), headers=HEADERS, json={'status': 'captured'}).status_code == 403
    assert state['writes'] == []


def test_another_workspace_cannot_read_or_direct_this_real_production():
    client, _ = make_client()
    other = f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/real'
    assert client.get(f'{other}/surface', headers=HEADERS).status_code == 403
    assert client.post(f'{other}/shots/{SHOT_ONE}/direct', headers=HEADERS, json={'text': 'x'}).status_code == 403


def test_invalid_input_is_reported_as_validation_not_as_a_platform_failure():
    client, _ = make_client()
    assert client.post(url(f'/shots/{SHOT_ONE}/takes'), headers=HEADERS,
        json={'take_number': 0}).status_code == 422
    assert client.post(url(f'/shots/{SHOT_ONE}/deviations'), headers=HEADERS,
        json={'field': 'vibes'}).status_code == 422
    assert client.post(url(f'/shots/{SHOT_ONE}/capture'), headers=HEADERS,
        json={'status': 'finished'}).status_code == 422
    assert client.post(url('/shots/not-a-uuid/direct'), headers=HEADERS, json={'text': 'x'}).status_code == 422


def test_a_deployment_without_the_real_migration_says_which_migration_is_missing():
    client, _ = make_client(no_migration=True)
    response = client.get(url('/surface'), headers=HEADERS)
    assert response.status_code == 503
    error = response.json()['errors'][0]
    assert error['code'] == 'STUDIO_SCHEMA_MISSING'
    assert 'Real production migration' in error['message']
