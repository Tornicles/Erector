"""Prompt 4 API coverage: plan, commit, commands, reference analysis and Studio surfaces.

The platform is mocked with httpx.MockTransport, so these tests exercise the whole
request path — authorization, revision guards, persistence payloads — without network.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import wave
from copy import deepcopy

import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
OTHER_USER = '00000000-0000-4000-8000-000000000002'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000011'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
REFERENCE = '00000000-0000-4000-8000-0000000000aa'
OPERATION = '00000000-0000-4000-8000-000000000040'
SECOND_OPERATION = '00000000-0000-4000-8000-000000000041'

HEADERS = {'Authorization': 'Bearer verified-test-session'}


def build_wav(samples: list[float], sample_rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b''.join(struct.pack('<h', max(-32768, min(32767, int(value * 32767)))) for value in samples))
    return buffer.getvalue()


def make_client(*, member: bool = True, revision: int = 1, references: list[dict] | None = None):
    """A platform mock that also records what TONDE actually persisted."""
    state: dict = {
        'production': {
            'id': PRODUCTION, 'workspace_id': WORKSPACE, 'title': 'Coffee', 'production_type': 'commercial',
            'execution_method': 'real', 'planned_duration_ms': None, 'approval': 'draft', 'locked_at': None,
            'revision': revision,
        },
        'references': references if references is not None else [],
        'applied': [],
        'operations': [],
        'analyses': [],
        'findings': [],
        'techniques': [],
        'decisions': [],
        'briefs': [],
        'stories': [],
        'scenes': [],
        'dialogue': [],
        'reality': [],
        'documents': [],
        'claims': [],
        'rpc_calls': [],
        'source_revision_seen': [],
    }

    def platform(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        assert request.headers.get('accept-profile') == 'tonde', path
        if path == '/rest/v1/workspace_members':
            role = 'owner' if member else None
            return httpx.Response(200, json=[{'role': role}] if role else [])
        if path == '/rest/v1/productions':
            allowed = request.url.params.get('workspace_id') == f'eq.{WORKSPACE}'
            return httpx.Response(200, json=[deepcopy(state['production'])] if allowed else [])
        if path == '/rest/v1/production_references':
            if request.method == 'POST':
                payload = json.loads(request.content)
                created = {**payload, 'id': REFERENCE, 'state': 'active', 'created_at': '2026-01-01T00:00:00Z'}
                state['references'].append(created)
                return httpx.Response(201, json=[created])
            return httpx.Response(200, json=deepcopy(state['references']))
        if path == '/rest/v1/production_resources':
            return httpx.Response(200, json=[{
                'resource_type': 'camera', 'name': 'Sony FX3', 'manufacturer': 'Sony', 'model': 'FX3',
                'mount': None, 'metadata': {},
            }])
        if path == '/rest/v1/director_intakes':
            return httpx.Response(200, json=[])
        if path == '/rest/v1/director_briefs':
            return httpx.Response(200, json=deepcopy(state['briefs']))
        if path == '/rest/v1/creative_stories':
            return httpx.Response(200, json=deepcopy(state['stories']))
        if path == '/rest/v1/scenes':
            return httpx.Response(200, json=deepcopy(state['scenes']))
        if path == '/rest/v1/dialogue_lines':
            return httpx.Response(200, json=deepcopy(state['dialogue']))
        if path == '/rest/v1/director_reality_checks':
            return httpx.Response(200, json=deepcopy(state['reality']))
        if path == '/rest/v1/creative_documents':
            return httpx.Response(200, json=deepcopy(state['documents']))
        if path == '/rest/v1/reference_analyses':
            return httpx.Response(200, json=[])
        if path in {'/rest/v1/reference_findings', '/rest/v1/creative_techniques', '/rest/v1/reference_technique_links'}:
            return httpx.Response(200, json=[])
        if path == '/rest/v1/director_decisions':
            return httpx.Response(200, json=deepcopy(state['decisions']))
        if path == '/rest/v1/director_operations':
            return httpx.Response(200, json=deepcopy(state['operations']))
        if path == '/rest/v1/rpc/record_director_operation':
            payload = json.loads(request.content)
            record = payload['operation_record']
            assert payload['target_workspace'] == WORKSPACE
            assert payload['target_production'] == PRODUCTION
            state['operations'].append(record)
            return httpx.Response(200, json={'operation_id': record['operation_id'], 'status': record['status']})
        if path == '/rest/v1/rpc/claim_reference_analysis':
            payload = json.loads(request.content)
            state['claims'].append(payload)
            return httpx.Response(200, json={'reference_id': payload['target_reference'], 'status': payload['stage_status']})
        if path == '/rest/v1/rpc/save_reference_analysis':
            payload = json.loads(request.content)
            state['analyses'].append(payload['analysis'])
            state['findings'].extend(payload['findings'])
            state['techniques'].extend(payload['techniques'])
            return httpx.Response(200, json={
                'analysis_id': '00000000-0000-4000-8000-0000000000bb',
                'findings': len(payload['findings']), 'techniques': len(payload['techniques']),
            })
        if path == '/rest/v1/rpc/save_director_brief':
            payload = json.loads(request.content)
            assert payload['target_workspace'] == WORKSPACE
            state['briefs'].append({'id': 'brief-1', 'revision': 1, 'brief': payload['brief_content'], 'producer': payload['producer_kind']})
            return httpx.Response(200, json={'revision': 1, 'producer': payload['producer_kind']})
        if path == '/rest/v1/rpc/record_director_decisions':
            payload = json.loads(request.content)
            state['decisions'].extend(payload['decision_list'])
            return httpx.Response(200, json={'stored': len(payload['decision_list']), 'source': payload['decision_source']})
        if path == '/rest/v1/rpc/apply_director_operation':
            payload = json.loads(request.content)
            state['applied'].append(payload)
            state['source_revision_seen'].append(payload['expected_production_revision'])
            if payload['expected_production_revision'] != state['production']['revision']:
                return httpx.Response(400, json={'code': '40001', 'message': 'revision conflict'})
            if payload['target_operation'] in {applied['target_operation'] for applied in state['applied'][:-1]}:
                # Idempotent replay: the platform returns the stored result without duplicating content.
                return httpx.Response(200, json={'production_id': PRODUCTION, 'idempotent': True})
            persist_bundle(state, payload['bundle'])
            state['production'].update({
                'planned_duration_ms': payload['bundle']['production']['planned_duration_ms'],
                'production_type': payload['bundle']['production']['production_type'],
                'revision': state['production']['revision'] + 1,
            })
            return httpx.Response(200, json={'production_id': PRODUCTION, 'scenes': len(payload['bundle']['scenes'])})
        raise AssertionError(f'Unexpected platform request: {request.method} {request.url}')

    settings = Settings(
        app_env='test', supabase_url='https://test.supabase.co',
        supabase_publishable_key=SecretStr('sb_publishable_test'),
    )
    return TestClient(create_app(settings, httpx.MockTransport(platform))), state


def root(workspace: str = WORKSPACE) -> str:
    return f'/api/v1/workspaces/{workspace}/productions/{PRODUCTION}/director'


def persist_bundle(state: dict, bundle: dict) -> None:
    """Mirror apply_director_operation: canonical rows replace the previous plan."""

    state['scenes'] = []
    state['dialogue'] = []
    scene_ids: dict[int, str] = {}
    for scene in bundle['scenes']:
        scene_ids[scene['order']] = f'00000000-0000-4000-8000-0000000001{scene["order"]:02d}'
    state['scenes'] = [
        {
            'id': scene_ids[scene['order']],
            'title': scene['title'], 'purpose': scene['purpose'], 'description': scene['description'],
            'story_beat': scene['story_beat'], 'opening_state': scene['opening_state'], 'ending_state': scene['ending_state'],
            'visual_intent': scene['visual_intent'], 'dialogue_notes': scene['dialogue_notes'],
            'action_lines': scene['action_lines'],
            'scene_detail': {
                'plan_order': scene['order'], 'environment': scene['environment'], 'characters': scene['characters'],
                'products': scene['products'], 'techniques': scene['techniques'], 'shots': scene['shots'],
            },
            'sort_order': scene['order'], 'planned_duration_ms': scene['duration_ms'],
            'environment_asset_id': None, 'revision': 1, 'lifecycle': 'active',
        }
        for scene in bundle['scenes']
    ]
    for script_scene in (bundle['script'] or {}).get('scenes', []):
        for line in script_scene['lines']:
            state['dialogue'].append({
                'id': f'00000000-0000-4000-8000-0000000002{line["order"]:02d}{script_scene["scene_order"]:02d}',
                'scene_id': scene_ids.get(script_scene['scene_order']),
                'line_type': line['kind'], 'speaker': line['speaker'], 'content': line['content'],
                'sort_order': (script_scene['scene_order'] * 1000) + line['order'],
                'start_ms': None, 'duration_ms': line['estimated_ms'], 'intention': line['intention'],
                'delivery': line['delivery'], 'subtext': line['subtext'], 'pause_after_ms': line['pause_after_ms'],
                'line_flags': {},
            })
    if bundle.get('story'):
        state['stories'] = [{'id': 'story-1', 'revision': 1, 'story': bundle['story'], 'variation': bundle['story']['variation'], 'producer': bundle['story']['producer']}]
    if bundle.get('brief'):
        state['briefs'] = [{'id': 'brief-1', 'revision': 1, 'brief': bundle['brief'], 'producer': 'deterministic'}]
    if bundle.get('reality'):
        state['reality'] = [{'id': 'reality-1', 'revision': 1, 'report': bundle['reality'], 'feasibility': bundle['reality']['feasibility']}]
    state['documents'] = []
    if bundle.get('brief'):
        state['documents'].append({
            'document_type': 'brief', 'title': 'Production Brief', 'revision': 1, 'updated_at': '2026-01-01T00:00:00Z',
            'content': f"PRODUCTION GOAL: {bundle['brief'].get('production_goal', '')}",
        })
    if bundle.get('story'):
        story = bundle['story']
        beats = '\n\n'.join(f"{beat['order']}. {beat['name']}\n{beat['content']}" for beat in story['beats'])
        state['documents'].append({
            'document_type': 'story', 'title': story['title'], 'revision': 1, 'updated_at': '2026-01-01T00:00:00Z',
            'content': f"LOGLINE: {story['logline']}\n\n{beats}",
        })
    script = bundle.get('script')
    if script:
        blocks: list[str] = []
        for script_scene in script['scenes']:
            body = '\n'.join(script_scene['action'])
            for line in script_scene['lines']:
                if line['kind'] == 'dialogue' and line['speaker']:
                    body += f"\n{line['speaker'].upper()}\n  {line['content']}"
                else:
                    body += f"\n[{line['kind'].upper()}] {line['content']}"
            blocks.append(f"{script_scene['heading']}\n\n{body}")
        state['documents'].append({
            'document_type': 'script', 'title': script['title'], 'revision': 1, 'updated_at': '2026-01-01T00:00:00Z',
            'content': script['title'] + '\n\n' + '\n\n'.join(blocks),
        })


# --------------------------------------------------------------------------------------
# Provider status and Studio surfaces
# --------------------------------------------------------------------------------------


def test_provider_status_is_honest_about_absence_and_ffmpeg():
    client, _ = make_client()
    with client:
        response = client.get(f'{root()}/provider', headers=HEADERS)
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['provider'] == 'unconfigured'
    assert data['configured'] is False
    assert data['ffmpeg_available'] is False
    assert data['ffmpeg_note']


def test_studio_surface_reports_the_five_prompt_4_canvases():
    client, _ = make_client(references=[{
        'id': REFERENCE, 'source_type': 'upload', 'source_url': None, 'source_description': 'Coffee reel',
        'media_id': None, 'rights_classification': 'user_owned', 'state': 'active', 'created_at': '2026-01-01T00:00:00Z',
    }])
    with client:
        response = client.get(f'{root()}/studio', headers=HEADERS)
    assert response.status_code == 200, response.text
    data = response.json()['data']
    for surface in ('brief', 'story', 'scenes', 'reality', 'references', 'techniques', 'operations', 'runtime_fit', 'documents'):
        assert surface in data
    assert data['documents'] == {}
    assert data['references'][0]['reference_id'] == REFERENCE
    assert data['references'][0]['capability']['capability'] in {
        'full_media_available', 'partial_media_available', 'metadata_only', 'text_only', 'unavailable',
    }
    assert data['provider']['configured'] is False
    assert data['setup_listed'] == ['Sony FX3']


# --------------------------------------------------------------------------------------
# Plan → commit (prompt §113: Home → Studio)
# --------------------------------------------------------------------------------------


def test_studio_script_surface_exposes_the_persisted_readable_documents_after_commit():
    client, _ = make_client()
    with client:
        planned = client.post(f'{root()}/plan', headers=HEADERS, json={
            'goal': 'Create a 30-second premium coffee commercial I can shoot with one camera, one light and myself.',
            'operation_id': OPERATION,
        })
        bundle = planned.json()['data']['bundle']
        committed = client.post(f'{root()}/commit', headers=HEADERS, json={
            'operation_id': OPERATION, 'expected_production_revision': 1, 'bundle': bundle, 'explicit_confirmation': True,
        })
        assert committed.status_code == 200, committed.text
        response = client.get(f'{root()}/studio', headers=HEADERS)
    assert response.status_code == 200, response.text
    documents = response.json()['data']['documents']
    script_scene = bundle['script']['scenes'][0]
    assert documents['brief']['content'].startswith('PRODUCTION GOAL: ')
    assert bundle['story']['logline'] in documents['story']['content']
    assert script_scene['heading'] in documents['script']['content']
    if script_scene['lines']:
        assert script_scene['lines'][0]['content'] in documents['script']['content']
    assert documents['script']['content'].startswith(bundle['script']['title'])


def test_plan_builds_a_complete_master_production_without_a_provider():
    client, state = make_client()
    with client:
        response = client.post(f'{root()}/plan', headers=HEADERS, json={
            'goal': 'Create a 30-second premium coffee commercial I can shoot with one camera, one light and myself.',
            'collaboration_mode': 'stop_at_major_decisions',
            'operation_id': OPERATION,
        })
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['producer'] == 'deterministic'
    assert data['intent']['primary_type'] == 'commercial'
    assert data['intent']['runtime_ms'] == 30000
    assert data['brief']['runtime']['exact_ms'] == 30000
    assert data['story']['beats']
    assert data['script']['scenes']
    assert sum(scene['duration_ms'] for scene in data['scenes']) == 30000
    assert data['characters'] and data['products'] and data['style_bible']
    assert data['reality']['summary']
    assert data['runtime_fit']['status'] == 'fits'
    assert data['questions'] and any(question['blocking'] for question in data['questions'])
    assert data['bundle']['production']['planned_duration_ms'] == 30000
    # Both the intent interpretation and the plan are recorded with their envelopes.
    kinds = [record['operation_type'] for record in state['operations']]
    assert kinds == ['intent_interpretation', 'production_plan'], kinds
    assert all(record['source_revision'] == 1 for record in state['operations'])
    assert all(record['idempotency_key'] for record in state['operations'])


def test_commit_requires_confirmation_then_applies_with_a_revision_guard():
    client, state = make_client()
    with client:
        planned = client.post(f'{root()}/plan', headers=HEADERS, json={
            'goal': 'Create a 30-second premium coffee commercial I can shoot with one camera, one light and myself.',
            'operation_id': OPERATION,
        })
        bundle = planned.json()['data']['bundle']

        refused = client.post(f'{root()}/commit', headers=HEADERS, json={
            'operation_id': OPERATION, 'bundle': bundle, 'expected_production_revision': 1,
            'explicit_confirmation': False,
        })
        stale = client.post(f'{root()}/commit', headers=HEADERS, json={
            'operation_id': OPERATION, 'bundle': bundle, 'expected_production_revision': 9,
            'explicit_confirmation': True,
        })
        assert state['applied'] == [], 'a refused or stale commit must not write anything'
        applied = client.post(f'{root()}/commit', headers=HEADERS, json={
            'operation_id': OPERATION, 'bundle': bundle, 'expected_production_revision': 1,
            'explicit_confirmation': True,
        })
    assert refused.status_code == 409
    assert refused.json()['errors'][0]['code'] == 'DIRECTOR_CONFIRMATION_REQUIRED'
    assert stale.status_code == 409
    assert stale.json()['errors'][0]['code'] in {'DIRECTOR_REVISION_CONFLICT', 'DIRECTOR_REVISION_STALE'}
    assert applied.status_code == 200, applied.text
    assert state['applied'][0]['explicit_confirmation'] is True
    assert state['production']['planned_duration_ms'] == 30000
    assert sum(scene['duration_ms'] for scene in state['applied'][0]['bundle']['scenes']) == 30000


def test_replaying_a_commit_does_not_duplicate_production_content():
    client, state = make_client()
    with client:
        planned = client.post(f'{root()}/plan', headers=HEADERS, json={
            'goal': 'Create a 30-second premium coffee commercial I can shoot with one camera, one light and myself.',
        })
        bundle = planned.json()['data']['bundle']
        first = client.post(f'{root()}/commit', headers=HEADERS, json={
            'operation_id': OPERATION, 'bundle': bundle, 'expected_production_revision': 1, 'explicit_confirmation': True,
        })
        scene_count = len(state['scenes'])
        line_count = len(state['dialogue'])
        second = client.post(f'{root()}/commit', headers=HEADERS, json={
            'operation_id': OPERATION, 'bundle': bundle, 'expected_production_revision': 2, 'explicit_confirmation': True,
        })
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    assert second.json()['data'].get('idempotent') is True
    assert len(state['scenes']) == scene_count
    assert len(state['dialogue']) == line_count
    assert len(state['stories']) == 1


# --------------------------------------------------------------------------------------
# Director commands (prompt §11, §68, §98, §99)
# --------------------------------------------------------------------------------------


def test_command_preview_and_proposal_are_revision_safe():
    client, state = make_client()
    with client:
        planned = client.post(f'{root()}/plan', headers=HEADERS, json={
            'goal': 'Create a 30-second premium coffee commercial I can shoot with one camera, one light and myself.',
        })
        committed = client.post(f'{root()}/commit', headers=HEADERS, json={
            'operation_id': OPERATION, 'bundle': planned.json()['data']['bundle'],
            'expected_production_revision': 1, 'explicit_confirmation': True,
        })
        applied_before = len(state['applied'])
        preview = client.post(f'{root()}/command/preview', headers=HEADERS, json={'text': 'Make Scene 1 more intense.'})
        proposal = client.post(f'{root()}/command', headers=HEADERS, json={'text': 'Make Scene 1 more intense.'})
        assert len(state['applied']) == applied_before, 'a proposal must never apply itself'
        applied = client.post(f'{root()}/command', headers=HEADERS, json={
            'text': 'Make Scene 1 more intense.', 'apply': True,
            'operation_id': OPERATION, 'expected_production_revision': 2,
        })
        replayed = client.post(f'{root()}/command', headers=HEADERS, json={
            'text': 'Make Scene 1 more intense.', 'apply': True,
            'operation_id': OPERATION, 'expected_production_revision': 2,
        })
        stale = client.post(f'{root()}/command', headers=HEADERS, json={
            'text': 'Make Scene 1 more intense.', 'apply': True,
            'operation_id': SECOND_OPERATION, 'expected_production_revision': 1,
        })
    assert committed.status_code == 200, committed.text
    assert preview.status_code == 200, preview.text
    assert preview.json()['data']['kind'] == 'scene_intensity'
    assert preview.json()['data']['scene_order'] == 1

    assert proposal.status_code == 200, proposal.text
    body = proposal.json()['data']
    assert body['command']['kind'] == 'scene_intensity'
    assert body['plan'] is not None
    assert body['rationale']
    assert body['applied'] is None
    assert body['plan']['runtime_fit']['status'] == 'fits'

    assert applied.status_code == 200, applied.text
    assert state['applied'][-1]['operation_type'] == 'director_command'
    assert replayed.status_code == 200, replayed.text
    assert replayed.json()['data']['applied'].get('idempotent') is True, 'a replayed operation is idempotent, not duplicated'
    assert stale.status_code == 409, 'a stale revision must not apply'
    assert stale.json()['errors'][0]['code'] in {'DIRECTOR_REVISION_CONFLICT', 'DIRECTOR_REVISION_STALE'}
    assert state['applied'][-1]['target_operation'] == OPERATION, 'the stale apply must not have been written'


def test_why_does_this_feel_expensive_returns_causal_analysis_not_a_copy():
    client, _ = make_client()
    with client:
        response = client.post(f'{root()}/command', headers=HEADERS, json={'text': 'Why does this commercial feel expensive?'})
    assert response.status_code == 200, response.text
    body = response.json()['data']
    assert body['command']['kind'] == 'reference_causal'
    assert body['plan'] is None
    assert body['answer'], 'TONDE must answer even when no analysed reference exists'


def test_unsupported_command_does_not_change_the_plan():
    client, state = make_client()
    with client:
        response = client.post(f'{root()}/command', headers=HEADERS, json={'text': 'Sketch me a trombone'})
    assert response.status_code == 200
    body = response.json()['data']
    assert body['command']['kind'] == 'unresolved'
    assert body['plan'] is None
    assert state['applied'] == []


def test_story_alternatives_never_replace_the_selected_story():
    client, _ = make_client()
    with client:
        response = client.post(f'{root()}/story/alternatives', headers=HEADERS, json={'count': 3})
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['alternatives']
    assert 'never overwrite' in data['note']
    assert data['selected_story'] is None


def test_brief_can_be_viewed_saved_and_asked_about():
    client, state = make_client()
    with client:
        planned = client.post(f'{root()}/plan', headers=HEADERS, json={
            'goal': 'Create a 30-second premium coffee commercial I can shoot with one camera, one light and myself.',
        })
        brief = planned.json()['data']['brief']
        brief['audience'] = 'Home espresso drinkers'
        brief['core_message'] = 'Ridgeway coffee is worth the extra minute.'
        saved = client.post(f'{root()}/brief', headers=HEADERS, json={
            'expected_brief_revision': None, 'brief': brief,
        })
        invalid = client.post(f'{root()}/brief', headers=HEADERS, json={
            'expected_brief_revision': None, 'brief': {'production_goal': ''},
        })
    assert saved.status_code == 200, saved.text
    assert saved.json()['data']['brief']['audience'] == 'Home espresso drinkers'
    assert state['briefs'][0]['brief']['core_message'].startswith('Ridgeway')
    assert invalid.status_code == 422


def test_answered_decisions_are_persisted_and_not_re_asked():
    client, state = make_client()
    with client:
        response = client.post(f'{root()}/decisions', headers=HEADERS, json={
            'source': 'studio',
            'questions': {'product': 'Which product is this for?'},
            'decisions': {'product': 'Ridgeway coffee', 'platform': 'YouTube'},
        })
        planned = client.post(f'{root()}/plan', headers=HEADERS, json={
            'goal': 'Create a 30-second premium coffee commercial',
            'answered_decisions': {'product': 'Ridgeway coffee', 'platform': 'YouTube'},
            'include_optional_questions': True,
        })
    assert response.status_code == 200, response.text
    assert response.json()['data']['stored'] == 2
    assert {decision['decision_id'] for decision in state['decisions']} == {'product', 'platform'}
    question_ids = {question['id'] for question in planned.json()['data']['questions']}
    assert 'product' not in question_ids
    assert planned.json()['data']['brief']['product_brand'] == 'Ridgeway coffee'


def test_line_operation_returns_alternatives_without_applying_them():
    client, state = make_client()
    with client:
        response = client.post(f'{root()}/dialogue/operation', headers=HEADERS, json={'operation': 'shorter'})
    assert response.status_code == 200, response.text
    assert response.json()['data']['operation'] == 'shorter'
    assert state['applied'] == []


# --------------------------------------------------------------------------------------
# Reference analysis (prompt §18, §87, §89, §100, §101)
# --------------------------------------------------------------------------------------


SEEDED_REFERENCE = {
    'id': REFERENCE, 'source_type': 'upload', 'source_url': None, 'source_description': 'Creator voice take',
    'media_id': None, 'rights_classification': 'user_owned', 'state': 'active', 'created_at': '2026-01-01T00:00:00Z',
}


def test_uploaded_audio_reference_is_preprocessed_analysed_and_persisted():
    client, state = make_client(references=[dict(SEEDED_REFERENCE)])
    payload = base64.b64encode(build_wav([0.6] * 3200 + [0.0] * 4800 + [0.6] * 3200)).decode()
    with client:
        response = client.post(f'{root()}/reference/analyze', headers=HEADERS, json={
            'reference_id': REFERENCE, 'source_type': 'upload', 'data_base64': payload,
            'mime': 'audio/wav', 'filename': 'voice.wav', 'role': 'sound',
            'goal': 'Analyse the delivery pacing.',
        })
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['status'] in {'complete', 'partial'}
    assert data['producer'] == 'deterministic'
    assert data['capability']['capability'] in {'full_media_available', 'partial_media_available'}
    assert data['findings'], 'a real upload must produce measured findings'
    assert data['stages']
    assert data['findings_saved'] == len(data['findings'])
    # Progress is reported through real stages, not a fake percentage.
    assert [claim['stage_status'] for claim in state['claims']][:2] == ['preprocessing', 'analyzing']
    assert state['analyses'][0]['status'] in {'complete', 'partial'}
    assert state['techniques'] == [] or state['techniques'][0]['technique_source'] == 'reference'


def test_reference_analysis_of_unavailable_media_fails_without_fabricating_analysis():
    client, state = make_client()
    with client:
        response = client.post(f'{root()}/reference/analyze', headers=HEADERS, json={
            'reference_id': '00000000-0000-4000-8000-0000000000cc', 'source_type': 'upload',
        })
    assert response.status_code == 404
    assert response.json()['errors'][0]['code'] == 'REFERENCE_NOT_FOUND'
    assert state['analyses'] == []


def test_metadata_only_reference_records_limited_capability():
    client, state = make_client(references=[dict(SEEDED_REFERENCE)])
    with client:
        response = client.post(f'{root()}/reference/analyze', headers=HEADERS, json={
            'reference_id': REFERENCE, 'source_type': 'social_url',
        })
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['capability']['capability'] in {'metadata_only', 'unavailable'}
    assert data['capability']['modalities']['image'] == 'unavailable'
    assert data['capability']['modalities']['video_frames'] == 'unavailable'
    assert data['limitations'], 'a reference with no media must say what could not be analysed'
    assert not [
        finding for finding in data['findings']
        if finding['epistemic'] == 'observed' and finding['category'] in {'camera', 'lighting', 'composition'}
    ]


def test_creating_a_reference_requires_workspace_membership_and_is_scoped():
    client, state = make_client()
    with client:
        response = client.post(f'{root()}/reference/analyze', headers=HEADERS, json={
            'source_type': 'upload', 'data_base64': base64.b64encode(build_wav([0.4] * 1600)).decode(),
            'mime': 'audio/wav', 'filename': 'voice.wav',
        })
    assert response.status_code == 200, response.text
    assert state['references'][0]['workspace_id'] == WORKSPACE
    assert state['references'][0]['production_id'] == PRODUCTION
    assert response.json()['data']['reference_id'] == REFERENCE


def test_reference_media_that_is_not_decodable_is_rejected_before_analysis():
    client, state = make_client(references=[dict(SEEDED_REFERENCE)])
    with client:
        response = client.post(f'{root()}/reference/analyze', headers=HEADERS, json={
            'reference_id': REFERENCE, 'source_type': 'upload', 'data_base64': 'not-base64!!',
        })
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'REFERENCE_MEDIA_INVALID'
    assert state['analyses'] == []


# --------------------------------------------------------------------------------------
# Security / RLS behaviour at the API boundary (prompt §80, §104)
# --------------------------------------------------------------------------------------


def test_another_workspace_cannot_touch_this_production():
    client, state = make_client()
    with client:
        studio = client.get(f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/director/studio', headers=HEADERS)
        plan = client.post(f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/director/plan', headers=HEADERS, json={'goal': 'Take over'})
        command = client.post(f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/director/command', headers=HEADERS, json={'text': 'Remove all dialogue.'})
        commit = client.post(f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/director/commit', headers=HEADERS, json={
            'operation_id': OPERATION, 'bundle': {'production': {}, 'scenes': []}, 'expected_production_revision': 1,
            'explicit_confirmation': True,
        })
    for response in (studio, plan, command, commit):
        assert response.status_code == 404
        assert response.json()['errors'][0]['code'] == 'PRODUCTION_NOT_FOUND'
    assert state['applied'] == []


def test_a_non_member_is_denied_access_and_is_not_told_the_production_exists():
    client, _ = make_client(member=False)
    with client:
        studio = client.get(f'{root()}/studio', headers=HEADERS)
        plan = client.post(f'{root()}/plan', headers=HEADERS, json={'goal': 'Make something'})
    for response in (studio, plan):
        assert response.status_code == 403
        assert response.json()['errors'][0]['code'] == 'WORKSPACE_ACCESS_DENIED'


def test_anonymous_requests_are_rejected():
    client, _ = make_client()
    with client:
        response = client.get(f'{root()}/studio')
    assert response.status_code == 401
    assert response.json()['errors'][0]['code'] == 'AUTHENTICATION_REQUIRED'
