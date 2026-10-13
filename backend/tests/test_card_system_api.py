"""Card system HTTP coverage: planning, Card direction, validation, generation and impact scope.

The platform is mocked with httpx.MockTransport; the SQL behaviour itself (guards, locks, stale
revisions, tenant isolation) is proven against real embedded PostgreSQL in
tests/database/prompt12-card-system.test.mjs. These tests prove the HTTP path: routing,
authorization, the exact RPC payload, the Card-count rule, refusal of invalid direction, truthful
behaviour with no provider configured, and the impact scope.
"""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app
from app.services.ai.provider import (
    GenerationRequest,
    GenerationResult,
    ProviderCapabilities,
    ProviderCapability,
)

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
CARD_ONE = '00000000-0000-4000-8000-000000000031'
CARD_TWO = '00000000-0000-4000-8000-000000000032'
SHOT_ONE = '00000000-0000-4000-8000-000000000041'
SHOT_TWO = '00000000-0000-4000-8000-000000000042'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

DIRECTION = {
    'title': 'The Empty Street',
    'purpose': 'Maya discovers the city is empty.',
    'starts_from': 'Maya exits the apartment building.',
    'ends_with': 'Maya hears a metallic sound and turns.',
    'story_change': 'ordinary quiet to undeniable danger',
    'summary': ('Maya exits into a street that should be busy but is empty. She walks, notices there '
        'are no people and no moving cars, slows, stops and turns toward a metallic sound behind her.'),
    'what_happens': ('She exits and takes four normal steps before the absence registers. She slows, '
        'stops near the centre-right of frame and holds for a full beat, then looks across the street '
        'as a metallic sound arrives from behind-left and her eyes react before her head turns.'),
    'director_direction': ('Confusion first, then fear. Keep the environment as the pressure and do '
        'not let Maya lead it: her body stays ordinary for the first half of the Card, so the '
        'emptiness is what the audience notices. Do not play the turn as a scare.'),
    'audience_feeling': 'Exposed, uneasy, suddenly alert.',
    'subject_direction': ('Walk normally for four steps, then slow without looking around. Stop near '
        'the centre-right mark and hold for a full beat with normal breathing before the sound. When '
        'the metallic tone arrives, move the eyes first and let the head and shoulders follow.'),
    'camera_direction': ('Phone main 1x camera, vertical 9:16, seven metres from the final mark at eye '
        'level. Mostly locked wide frames with Maya small in frame, and one slow push only as the beat '
        'changes from observation to concern.'),
    'look_direction': ('Muted early-morning daylight with a soft key from behind-right and slightly '
        'cold contrast. Wet pavement if the street is wet, large negative space, no horror light.'),
    'audio_direction': ('Capture footsteps, clothing and clean street tone with 20 to 30 seconds of '
        'wild ambience after each take. Record the metallic cue separately so it enters late.'),
    'location_direction': ('Long street with real depth, a clear exit behind Maya and low pedestrian '
        'traffic. Shoot along the long axis so the emptiness reads.'),
    'continuity': ('Dark green jacket closed, backpack on the right shoulder, hair tied back, morning '
        'light and wet pavement. Maya ends facing camera-left.'),
    'resources': 'Maya, phone camera, backpack, jacket, quiet street, optional tripod.',
    'next_action': 'Open Shot 03A and capture the street master.',
}

REAL_PLAN = {
    'shot_id': SHOT_ONE, 'execution_method': 'real', 'plan_status': 'ready',
    'performance': 'Walk four steps, stop, hold.', 'blocking': 'Cross left to right.',
    'camera_position': 'Across the street.', 'framing': 'Wide.', 'lighting_plan': 'Morning light only.',
    'sound_plan': 'Footsteps plus room tone.', 'movement': 'Locked.', 'purpose': 'Establish emptiness.',
    'start_state': 'Alone in the stairwell.', 'action': 'Enter and walk four steps before slowing.',
    'timing': '0-2s hold, 2-5s walk.', 'takes': 'Three takes.', 'success_criteria': 'Street reads empty.',
    'retake_if': 'A pedestrian enters frame.', 'revision': 2,
    'setup_steps': ['Scout the street.', 'Lock the tripod at eye level.'],
}


class StubProvider:
    """A configured provider that returns one valid Card direction and records what it was asked."""

    def __init__(self) -> None:
        self.requests: list[GenerationRequest] = []

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(provider='stub', capabilities=[ProviderCapability.structured_text],
            model_profile='stub-model')

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        self.requests.append(request)
        return GenerationResult(output={**DIRECTION, 'title': 'Generated Card Direction'},
            provider='stub', model='stub-model')


def scene_row(scene_id: str, title: str, order: int, *, direction: dict | None = None,
    mode: str = 'real', approval: str = 'draft', locked: bool = False, purpose: str = 'Earn attention',
    validation: dict | None = None) -> dict:
    return {
        'id': scene_id, 'workspace_id': WORKSPACE, 'production_id': PRODUCTION, 'title': title,
        'purpose': purpose, 'description': 'Maya exits into an empty street.',
        'opening_state': 'Alone in the stairwell.', 'ending_state': 'Facing the empty street.',
        'sort_order': order, 'planned_duration_ms': 30000,
        'approval': approval, 'locked_at': '2026-10-05T00:00:00Z' if locked else None,
        'revision': 3, 'card_mode': mode, 'card_direction': direction or {},
        'card_provenance': {}, 'card_validation': validation or {},
        'card_generated_by': 'director' if direction else 'deterministic',
    }


def shot_row(shot_id: str, scene_id: str, title: str, method: str = 'real') -> dict:
    return {'id': shot_id, 'scene_id': scene_id, 'title': title, 'execution_method': method,
        'planned_duration_ms': 7000, 'purpose': 'Establish the emptiness.'}


def build(role: str | None = 'owner', provider: Any = None, scenes: list[dict] | None = None):
    state: dict[str, Any] = {'rpc_calls': []}
    state['scenes'] = scenes if scenes is not None else [
        scene_row(CARD_ONE, 'The Empty Street', 1024, direction=DIRECTION, mode='hybrid',
            validation={'ready': True, 'missing': [], 'findings': [], 'word_total': 540}),
        scene_row(CARD_TWO, 'The Signal', 2048, purpose='Maya finds a signal.'),
    ]
    state['shots'] = [shot_row(SHOT_ONE, CARD_ONE, 'Street master'), shot_row(SHOT_TWO, CARD_TWO, 'Listen')]
    state['plans'] = [deepcopy(REAL_PLAN)]

    def fail(code: str, message: str) -> httpx.Response:
        if code in ('PGRST202', '42883'):
            return httpx.Response(404, json={'code': 'PGRST202', 'message': f'Could not find the function {message}'})
        return httpx.Response(400, json={'code': code, 'message': message})

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
            return httpx.Response(200, json=[{'id': PRODUCTION, 'workspace_id': WORKSPACE,
                'title': 'The Morning', 'production_type': 'short_film', 'custom_type': None,
                'execution_method': 'hybrid', 'planned_duration_ms': 60000,
                'calculated_duration_ms': 60000, 'revision': 4, 'lifecycle': 'active',
                'approval': 'draft'}] if in_workspace else [])
        if path == '/rest/v1/scenes':
            return httpx.Response(200, json=deepcopy(state['scenes']) if in_workspace else [])
        if path == '/rest/v1/shots':
            return httpx.Response(200, json=deepcopy(state['shots']) if in_workspace else [])
        if path == '/rest/v1/execution_plans':
            return httpx.Response(200, json=deepcopy(state['plans']) if in_workspace else [])
        if path == '/rest/v1/continuity_states':
            return httpx.Response(200, json=[{'domain': 'wardrobe', 'trait': 'backpack',
                'value': 'right_shoulder', 'anchor': 'production', 'scene_id': None, 'shot_id': None,
                'transition': 'baseline', 'origin': 'declared'}] if in_workspace else [])
        if not path.startswith('/rest/v1/rpc/'):
            return httpx.Response(200, json=[])

        name = path.rsplit('/', 1)[-1]
        payload = json.loads(request.content or b'{}')
        state['rpc_calls'].append({'name': name, 'payload': payload})
        if payload.get('target_workspace') != WORKSPACE or payload.get('target_production') != PRODUCTION:
            return fail('42501', 'Authenticated workspace editor required')
        if role != 'owner':
            return fail('42501', 'Authenticated workspace editor required')
        if name == 'card_direction_write':
            scene = next((row for row in state['scenes'] if row['id'] == payload['target_scene']), None)
            if scene is None:
                return fail('P0002', 'Card unavailable')
            if scene['locked_at'] is not None:
                return fail('PT409', 'This Card is locked. Unlock it before changing its direction')
            if payload.get('expected_revision') is not None and payload['expected_revision'] != scene['revision']:
                return fail('PT409', 'This Card changed since you loaded it')
            scene['card_direction'] = payload['direction']
            scene['card_mode'] = payload['mode_input']
            scene['card_validation'] = payload['validation']
            scene['card_generated_by'] = payload['generated_by']
            scene['revision'] += 1
            if scene['approval'] == 'approved':
                scene['approval'] = 'changed_after_approval'
            return httpx.Response(200, json={'id': scene['id'], 'revision': scene['revision'],
                'card_mode': scene['card_mode'], 'card_direction': scene['card_direction'],
                'card_validation': scene['card_validation'], 'card_provenance': payload['provenance'],
                'card_generated_by': scene['card_generated_by'], 'approval': scene['approval'],
                'updated_at': '2026-10-05T00:00:00Z'})
        if name == 'create_studio_scene':
            scene = scene_row(f'00000000-0000-4000-8000-00000000009{len(state["scenes"])}',
                (payload['scene'].get('title') or '').strip(), 4096,
                purpose=payload['scene'].get('purpose') or '')
            state['scenes'].append(scene)
            return httpx.Response(200, json={'id': scene['id'], 'title': scene['title'],
                'revision': 1, 'approval': 'draft'})
        if name == 'update_studio_scene':
            scene = next((row for row in state['scenes'] if row['id'] == payload['target_scene']), None)
            if scene is None:
                return fail('P0002', 'That scene is unavailable in this Production')
            if payload['expected_revision'] != scene['revision']:
                return fail('PT409', 'That scene changed since you loaded it')
            for field, value in payload['patch'].items():
                if field == 'duration_ms':
                    scene['planned_duration_ms'] = value
                elif field in scene:
                    scene[field] = value
            scene['revision'] += 1
            return httpx.Response(200, json={'id': scene['id'], 'revision': scene['revision']})
        return httpx.Response(200, json={})

    settings = Settings(supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key=SecretStr('sb_publishable_test_only'),
        supabase_service_role_key=SecretStr('service-role-test-only'), director_provider='unconfigured')
    application = create_app(settings, transport=httpx.MockTransport(platform), ai_provider=provider)
    client = TestClient(application)
    client.__enter__()
    return client, state


def url(path: str) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/cards{path}'


def test_cards_are_listed_with_server_derived_status():
    client, _ = build()
    response = client.get(url(''), headers=HEADERS)
    assert response.status_code == 200
    body = response.json()['data']
    assert body['count'] == 2
    first = body['cards'][0]
    # Fully directed, every execution unit complete, no approval pending: READY, not a guess.
    assert first['status'] == 'READY'
    assert first['mode'] == 'hybrid'
    assert first['validation']['ready'] is True
    assert first['shot_count'] == 1
    second = body['cards'][1]
    assert second['status'] == 'DRAFT'
    assert 'not written this Card' in second['status_detail'] or 'Structure exists' in second['status_detail']


def test_planning_refuses_more_cards_than_the_finished_runtime_supports():
    client, state = build()
    response = client.post(url('/plan'), headers=HEADERS, json={'target_runtime_ms': 60000,
        'beats': [{'title': f'Beat {index}'} for index in range(12)]})
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'CARD_COUNT_EXCEEDS_CAP'
    assert 'at most 3' in response.json()['errors'][0]['message']
    assert state['rpc_calls'] == []


def test_planning_allocates_the_runtime_across_the_planned_cards():
    client, state = build()
    response = client.post(url('/plan'), headers=HEADERS, json={'target_runtime_ms': 60000,
        'beats': [{'title': 'Arrival', 'purpose': 'Establish the routine.'},
            {'title': 'Discovery', 'purpose': 'The city is empty.'},
            {'title': 'Decision', 'purpose': 'She moves toward the signal.'}]})
    assert response.status_code == 200
    plan = response.json()['data']['plan']
    assert plan['accepted'] is True
    assert plan['card_count'] == 3
    assert sum(shell['target_duration_ms'] for shell in plan['shells']) == 60000
    assert [shell['title'] for shell in plan['shells']] == ['Arrival', 'Discovery', 'Decision']
    # Previewing a plan writes nothing.
    assert state['rpc_calls'] == []


def test_persisting_a_plan_creates_the_card_shells():
    client, state = build()
    response = client.post(url('/plan'), headers=HEADERS, json={'target_runtime_ms': 60000,
        'persist': True, 'beats': [{'title': 'Arrival'}, {'title': 'Discovery'}, {'title': 'Decision'}]})
    assert response.status_code == 200
    # The plan reconciles with the Cards that already exist rather than duplicating them: the two
    # existing Cards become the first two planned shells and only the third is created.
    created = [call for call in state['rpc_calls'] if call['name'] == 'create_studio_scene']
    updated = [call for call in state['rpc_calls'] if call['name'] == 'update_studio_scene']
    assert len(created) == 1
    assert len(updated) == 2
    assert [call['payload']['patch']['title'] for call in updated] == ['Arrival', 'Discovery']
    assert created[0]['payload']['scene']['title'] == 'Decision'
    assert created[0]['payload']['scene']['duration_ms'] == response.json()['data']['plan']['shells'][2]['target_duration_ms']
    assert [item['title'] for item in response.json()['data']['persisted']] == ['Arrival', 'Discovery', 'Decision']


def test_writing_card_direction_sends_the_whole_direction_and_its_validation():
    client, state = build()
    response = client.put(url(f'/{CARD_TWO}/direction'), headers=HEADERS,
        json={'direction': DIRECTION, 'mode': 'hybrid', 'generated_by': 'creator'})
    assert response.status_code == 200
    call = next(call for call in state['rpc_calls'] if call['name'] == 'card_direction_write')
    assert call['payload']['direction']['camera_direction'] == DIRECTION['camera_direction']
    assert call['payload']['mode_input'] == 'hybrid'
    assert call['payload']['validation']['ready'] is True
    # Creator-authored direction is recorded as a locked fact, so a later guess cannot overwrite it.
    assert call['payload']['provenance']['title']['source_type'] == 'creator_locked'
    assert response.json()['data']['validation']['ready'] is True


def test_vague_direction_saves_but_can_never_be_ready():
    # A creator may save direction while it is still developing (progressive population), so the
    # write is allowed. What must never happen is that aspirational text is treated as READY.
    client, _ = build()
    vague = {**DIRECTION, 'camera_direction': 'Make it cinematic and immersive with compelling framing.'}
    response = client.put(url(f'/{CARD_TWO}/direction'), headers=HEADERS,
        json={'direction': vague, 'mode': 'real'})
    assert response.status_code == 200
    body = response.json()['data']
    assert body['validation']['ready'] is False
    findings = body['validation']['findings']
    assert any(item['code'] == 'vague' and item['field'] == 'camera_direction' for item in findings)


def test_missing_direction_section_is_refused_because_it_is_not_a_direction():
    client, state = build()
    incomplete = {key: value for key, value in DIRECTION.items() if key != 'camera_direction'}
    response = client.put(url(f'/{CARD_TWO}/direction'), headers=HEADERS,
        json={'direction': incomplete, 'mode': 'real'})
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_CARD_INPUT'
    assert [call for call in state['rpc_calls'] if call['name'] == 'card_direction_write'] == []


def test_a_locked_card_refuses_a_direction_change():
    locked = [scene_row(CARD_ONE, 'The Empty Street', 1024, direction=DIRECTION, locked=True)]
    client, _ = build(scenes=locked)
    response = client.put(url(f'/{CARD_ONE}/direction'), headers=HEADERS,
        json={'direction': DIRECTION, 'mode': 'real'})
    assert response.status_code == 409
    assert 'locked' in response.json()['errors'][0]['message'].lower()


def test_a_stale_card_revision_is_a_conflict_not_an_overwrite():
    client, _ = build()
    response = client.put(url(f'/{CARD_ONE}/direction'), headers=HEADERS, json={
        'direction': DIRECTION, 'mode': 'real', 'expected_revision': 1})
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'STUDIO_CONFLICT'


def test_validation_names_the_shot_level_gap_as_well_as_the_card_gap():
    thin = [scene_row(CARD_ONE, 'The Empty Street', 1024, direction=DIRECTION, mode='hybrid')]
    client, state = build(scenes=thin)
    state['plans'] = []
    response = client.post(url(f'/{CARD_ONE}/validate'), headers=HEADERS, json={'persist': False})
    assert response.status_code == 200
    body = response.json()['data']
    assert body['shots_validated'] == 1
    assert body['validation']['ready'] is False
    assert any(finding['field'].startswith('shot.') for finding in body['validation']['findings'])


def test_generation_without_a_configured_provider_says_so_and_writes_nothing():
    client, state = build()
    response = client.post(url(f'/{CARD_ONE}/direction/propose'), headers=HEADERS, json={'focus': 'camera'})
    assert response.status_code == 503
    assert response.json()['errors'][0]['code'] == 'DIRECTOR_PROVIDER_UNAVAILABLE'
    assert [call for call in state['rpc_calls'] if call['name'] == 'card_direction_write'] == []


def test_generation_returns_a_validated_proposal_and_never_applies_it():
    provider = StubProvider()
    client, state = build(provider=provider)
    response = client.post(url(f'/{CARD_ONE}/direction/propose'), headers=HEADERS,
        json={'focus': 'camera', 'instruction': 'Make the street feel larger.'})
    assert response.status_code == 200
    body = response.json()['data']
    assert body['proposal']['title'] == 'Generated Card Direction'
    assert body['validation']['ready'] is True
    assert body['provider']['producer'] == 'model'
    assert body['card_revision'] == 3
    # A proposal is not an application: the creator applies it with a separate, authorised write.
    assert [call for call in state['rpc_calls'] if call['name'] == 'card_direction_write'] == []
    assert provider.requests and 'Canonical continuity statements' in provider.requests[0].prompt


def test_impact_scope_protects_the_card_story_and_names_the_shot_fields():
    client, _ = build()
    response = client.get(url(f'/{CARD_ONE}/impact?change=location'), headers=HEADERS)
    assert response.status_code == 200
    plan = response.json()['data']['plan']
    assert 'location_direction' in plan['card_fields']
    assert 'title' in plan['protected']
    assert plan['shot_fields'] == ['camera', 'lighting', 'audio']
    shot_scope = client.get(url(f'/{CARD_ONE}/impact?change=shot_camera&scope=shot'),
        headers=HEADERS).json()['data']['plan']
    assert shot_scope['card_fields'] == []


def test_impact_requires_the_change_to_be_named():
    client, _ = build()
    response = client.get(url(f'/{CARD_ONE}/impact'), headers=HEADERS)
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_CARD_INPUT'


def test_a_viewer_may_read_cards_but_not_write_direction():
    client, _ = build(role='viewer')
    assert client.get(url(''), headers=HEADERS).status_code == 200
    response = client.put(url(f'/{CARD_ONE}/direction'), headers=HEADERS,
        json={'direction': DIRECTION, 'mode': 'real'})
    assert response.status_code == 403


def test_a_non_member_sees_no_cards():
    client, _ = build(role=None)
    assert client.get(url(''), headers=HEADERS).status_code == 403


def test_an_unknown_card_is_reported_as_not_found():
    client, _ = build()
    response = client.post(url('/00000000-0000-4000-8000-0000000000ff/validate'),
        headers=HEADERS, json={'persist': False})
    assert response.status_code == 404
    assert response.json()['errors'][0]['code'] == 'STUDIO_NOT_FOUND'
