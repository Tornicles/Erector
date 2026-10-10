"""Prompt 8 API coverage: long-form structure, Series, Generate Ahead and Director scope.

The platform is mocked with httpx.MockTransport. Semantic SQL behaviour (ordering, runtime
rollups, moves, splits, locks, RLS, slot idempotency, partial success) is proven against real
embedded PostgreSQL in tests/database/prompt8-long-form.test.mjs; these tests prove the HTTP
path - authorization, the exact RPC payload contract, error translation, and that Generate
Ahead never applies without confirmation and never invents creative content.
"""

from __future__ import annotations

import json
from copy import deepcopy

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000011'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
PROJECT = '00000000-0000-4000-8000-000000000030'
ACT_ONE = '00000000-0000-4000-8000-000000000101'
ACT_TWO = '00000000-0000-4000-8000-000000000102'
SEQUENCE_FOUR = '00000000-0000-4000-8000-000000000201'
SCENE_EIGHTEEN = '00000000-0000-4000-8000-000000000301'
SHOT_THREE = '00000000-0000-4000-8000-000000000401'
SERIES = '00000000-0000-4000-8000-000000000501'
EPISODE = '00000000-0000-4000-8000-000000000601'
JOB = '00000000-0000-4000-8000-000000000701'
CHARACTER = '00000000-0000-4000-8000-000000000801'

HEADERS = {'Authorization': 'Bearer verified-test-session'}


def act_item(identifier: str, title: str, number: int, **overrides) -> dict:
    row = {'id': identifier, 'level': 'act', 'title': title, 'display': f'Act {number}', 'display_index': number,
        'order': number * 1024, 'purpose': 'Raise the stakes', 'narrative_goal': 'Marcus commits',
        'planned_duration_ms': 1860000, 'calculated_duration_ms': 1900000, 'label': '31:40',
        'delta_ms': 40000, 'status': 'over', 'depth': 'scenes_planned', 'depth_label': 'Scenes Planned',
        'approval': 'draft', 'locked': False, 'revision': 3, 'summary': None,
        'documents': [], 'child_counts': {'sequences': 4, 'scenes': 9}}
    row.update(overrides)
    return row


def scene_item(identifier: str, title: str, number: int, **overrides) -> dict:
    row = {'id': identifier, 'level': 'scene', 'title': title, 'display': f'Scene {number}',
        'display_index': number, 'order': number * 1024, 'purpose': 'Confrontation', 'planned_duration_ms': 60000,
        'calculated_duration_ms': 60000, 'label': '1:00', 'delta_ms': 0, 'status': 'fits',
        'depth': 'shots_planned', 'approval': 'approved', 'locked': False, 'revision': 5,
        'summary': {'text': 'Marcus decides to stay.', 'stale': True, 'source_revision': 4, 'revision': 2},
        'documents': [{'document_id': 'doc-1', 'document_type': 'script', 'revision': 2}],
        'child_counts': {'shots': 4}}
    row.update(overrides)
    return row


def structure_payload(**overrides) -> dict:
    payload = {
        'production_id': PRODUCTION, 'production_revision': 7, 'structure_revision': 41, 'level': 'production',
        'scope': {'level': 'production', 'id': PRODUCTION, 'title': 'Ninety minute film', 'display': 'Production',
            'orphan_sequences': 0, 'orphan_scenes': 0, 'depth': 'scenes_planned',
            'summary': {'text': 'A film about leaving.', 'stale': False, 'source_revision': 7, 'revision': 1}},
        'breadcrumb': [{'level': 'production', 'id': PRODUCTION, 'title': 'Ninety minute film'}],
        'items': [act_item(ACT_ONE, 'Act 1 - Ordinary world', 1), act_item(ACT_TWO, 'Act 2 - The break', 2)],
        'total': 2, 'limit': 50, 'offset': 0, 'truncated': False,
        'timing': {'production': {'target_ms': 5400000, 'calculated_ms': 5500000, 'delta_ms': 100000,
            'status': 'over', 'target_label': '1:30:00', 'calculated_label': '1:31:40', 'delta_label': '1:40'},
            'counts': {'acts': 2, 'sequences': 4, 'scenes': 9, 'shots': 22}},
    }
    payload.update(overrides)
    return payload


def make_client(*, role: str | None = 'owner', structure: dict | None = None, no_migration: bool = False,
    episode_duplicate: bool = False, timing_error: str | None = None):
    state: dict = {
        'structure': structure or structure_payload(),
        'calls': [], 'writes': [],
    }

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
            wanted = request.url.params.get('role') or ''
            if workspace_param != f'eq.{WORKSPACE}' or role is None:
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
        if payload.get('target_workspace') == OTHER_WORKSPACE:
            return fail('42501', 'You do not have access to that workspace.')
        if name == 'long_form_structure':
            level = payload.get('target_level')
            if level == 'production':
                return httpx.Response(200, json=deepcopy(state['structure']))
            if level == 'act':
                return httpx.Response(200, json=deepcopy(state['structure']) | {
                    'level': 'act', 'items': [scene_item(SCENE_EIGHTEEN, 'Scene 18', 18)],
                    'breadcrumb': [{'level': 'production', 'id': PRODUCTION, 'title': 'Ninety minute film'},
                        {'level': 'act', 'id': ACT_TWO, 'title': 'Act 2 - The break'}]})
            return httpx.Response(200, json=deepcopy(state['structure']) | {'level': level})
        if name == 'long_form_timing':
            if timing_error:
                return fail(timing_error, 'The Production changed since you loaded it')
            return httpx.Response(200, json=deepcopy(state['structure']['timing']) | {
                'status': 'over', 'conflicts': [{'level': 'act', 'id': ACT_TWO, 'title': 'Act 2 - The break',
                    'target_ms': 1860000, 'calculated_ms': 2060000, 'over_by_ms': 200000, 'over_by_label': '3:20',
                    'status': 'over', 'reason': 'Act target and current child total differ.'}]})
        if name == 'long_form_search':
            return httpx.Response(200, json={'query': payload.get('search_query'), 'total': 1,
                'items': [{'level': 'shot', 'id': SHOT_THREE, 'title': 'Marcus holds the phone',
                    'snippet': 'weapon lower third', 'match_field': 'shot', 'scene_id': SCENE_EIGHTEEN,
                    'shot_id': SHOT_THREE, 'approval': 'draft', 'locked': False, 'depth': 'shots_planned',
                    'takes': 1, 'results': 0, 'attempts': 0, 'execution_method': 'real'}],
                'limit': 40, 'offset': 0, 'truncated': False, 'filters': payload.get('filters') or {},
                'binding_filter': None, 'note': 'Structured relational matches.'})
        if name == 'long_form_context':
            return httpx.Response(200, json={'scope': {'level': payload.get('target_level'), 'id': payload.get('target_id'),
                'title': 'Act 2 - The break', 'depth': 'scenes_planned'},
                'path': [{'level': 'production', 'id': PRODUCTION, 'title': 'Ninety minute film'}],
                'siblings': [{'level': 'sequence', 'id': SEQUENCE_FOUR, 'title': 'Sequence 4'}],
                'assets': [{'role': 'style', 'asset_id': CHAR_ID, 'name': 'Slow craft'}],
                'documents': [], 'dialogue': [], 'characters': 'Marcus',
                'timing': deepcopy(state['structure']['timing']), 'depth': 'scenes_planned',
                'summary': None, 'budget_chars': payload.get('budget_chars'), 'truncated': True,
                'note': 'Scoped context only.'})
        if name in ('create_long_form_act', 'update_long_form_act', 'create_long_form_sequence',
                'update_long_form_sequence', 'move_long_form_scene', 'move_long_form_sequence',
                'split_long_form_structure', 'reorder_long_form', 'set_long_form_approval',
                'set_long_form_lock', 'save_structure_summary'):
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'applied': True, 'rpc': name,
                'structure_revision': 42, 'timing': deepcopy(state['structure']['timing'])})
        if name == 'long_form_summaries':
            return httpx.Response(200, json={'items': [{'summary_id': 's-1', 'scope_level': 'act',
                'scope_object_id': ACT_TWO, 'source_revision': 3, 'current_revision': 4, 'stale': True,
                'generated_by': 'creator', 'note': 'first pass', 'text': 'Marcus decides to stay.'}],
                'total': 1, 'limit': 100, 'offset': 0, 'truncated': False})
        if name == 'long_form_script_index':
            return httpx.Response(200, json={'items': [{'document_id': 'doc-1', 'document_type': 'script',
                'title': 'Scene 18 script', 'scope_object_id': SCENE_EIGHTEEN, 'scope_level': 'scene',
                'revision': 2, 'approval': 'draft', 'locked': False, 'characters': 1200, 'lines': 14,
                'line_duration_ms': 22000, 'excerpt': 'MARCUS: I am not leaving.'}],
                'total': 1, 'limit': 50, 'offset': 0, 'truncated': False, 'note': 'measured'})
        if name == 'create_series':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'series_id': SERIES, 'title': 'Daily Personal Finance',
                'series_kind': 'recurring', 'timezone': 'Europe/London', 'revision': 1,
                'cadence_metadata': {'kind': 'daily'}, 'format': {'title_pattern': 'Money minute {n}'}})
        if name == 'update_series':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'series_id': SERIES, 'revision': 2, 'title': 'Daily Personal Finance'})
        if name == 'save_series_collection':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'collection_id': 'c-1', 'title': 'Season 1', 'sort_order': 1024,
                'lifecycle': 'active', 'revision': 1})
        if name == 'series_overview':
            return httpx.Response(200, json={'series_id': SERIES, 'title': 'Daily Personal Finance',
                'series_kind': 'recurring', 'timezone': 'Europe/London', 'revision': 2,
                'cadence_metadata': {'kind': 'daily'}, 'format': {'planned_episodes': 10},
                'collections': [], 'counts': {'episodes_active': 7, 'episodes_archived': 0, 'collections': 0,
                    'planned_episodes': '10', 'next_episode_number': 8},
                'reuse': [{'asset_id': CHAR_ID, 'name': 'Host', 'asset_type': 'character', 'missing': False}],
                'upcoming': [], 'last_generate_ahead': None, 'note': 'referenced, never copied'})
        if name == 'create_series_episode':
            state['writes'].append({'name': name, 'payload': payload})
            if episode_duplicate:
                return httpx.Response(200, json={'episode_id': EPISODE, 'created': False, 'state': 'preserved',
                    'production_id': PRODUCTION, 'episode_number': 3,
                    'note': 'An Episode already occupies this slot, so nothing was overwritten.'})
            return httpx.Response(200, json={'episode_id': EPISODE, 'created': True, 'state': 'created',
                'production_id': PRODUCTION, 'episode_number': 8, 'title': 'Money minute 8',
                'planned_date': '2026-10-14', 'requested_depth': 'ideas_only'})
        if name == 'update_series_episode':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'episode_id': EPISODE, 'revision': 3, 'episode_number': 8,
                'production_line_state': 'scene_plan'})
        if name == 'series_slots':
            return httpx.Response(200, json={'horizon': payload.get('target_horizon'), 'timezone': 'Europe/London',
                'today': '2026-10-05', 'cadence_metadata': {'kind': 'daily'},
                'slots': [{'slot_key': '2026-10-06', 'planned_date': '2026-10-06', 'episode_number': 1,
                    'state': 'open', 'existing_episode_id': None}],
                'counts': {'open': 1, 'preserved': 0, 'held': 0, 'total': 1},
                'note': 'Slot dates come from the Series timezone and cadence.'})
        if name == 'generate_ahead_preview':
            state['calls'].append({'name': 'preview_payload', 'payload': payload})
            return httpx.Response(200, json={'horizon': payload['request']['horizon'],
                'depth': payload['request']['depth'], 'depth_label': 'Ideas Only', 'timezone': 'Europe/London',
                'today': '2026-10-05',
                'slots': [{'slot_key': '2026-10-06', 'planned_date': '2026-10-06', 'episode_number': 1,
                    'state': 'open', 'existing_episode_id': None}],
                'counts': {'open': 7, 'preserved': 0, 'held': 0, 'total': 7},
                'reuse': [], 'recent_titles': [], 'requires_confirmation': True,
                'reuse_note': 'Series-level Assets are referenced through inheriting bindings.',
                'depth_note': 'Generate Ahead records the requested depth and creates the Production shell.',
                'do_not_overwrite': 'Existing Episodes at these slots are preserved and never overwritten.',
                'recent_jobs': [], 'series_revision': 2,
                'note': 'Preview only: nothing was created.'})
        if name == 'generate_ahead':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'job_id': JOB, 'shared_job_id': 'shared-1', 'state': 'succeeded',
                'horizon': payload['request']['horizon'], 'depth': payload['request']['depth'],
                'timezone': 'Europe/London',
                'counts': {'created': 7, 'preserved': 0, 'blocked': 0, 'failed': 0, 'planned': 7},
                'created_episodes': [{'episode_id': EPISODE, 'episode_number': 1, 'production_id': PRODUCTION,
                    'title': 'Money minute 1', 'planned_date': '2026-10-06', 'slot_key': '2026-10-06',
                    'topic_source': 'title_pattern'}],
                'blocked_slots': [], 'preview': {}, 'note': 'Existing Episodes and approved work were preserved.'})
        if name == 'retry_generate_ahead':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'job_id': payload.get('target_job'), 'state': 'retrying',
                'counts': {'created': 1, 'preserved': 0, 'blocked': 1, 'failed': 0},
                'note': 'Only blocked and failed slots were retried.'})
        if name == 'generate_ahead_jobs':
            return httpx.Response(200, json={'jobs': [{'job_id': JOB, 'shared_job_id': 'shared-1',
                'state': 'retrying', 'horizon': 'next_14', 'depth': 'briefs', 'timezone': 'Europe/London',
                'created_count': 12, 'preserved_count': 7, 'blocked_count': 2, 'failed_count': 0,
                'note': 'Some slots are held by the creator and were skipped.',
                'items': [{'slot_key': '2026-10-06', 'planned_date': '2026-10-06', 'episode_number': 1,
                    'state': 'blocked', 'created_production_id': None, 'created_episode_id': None,
                    'error_message': 'This slot is held by the creator.'}]}]})
        if name == 'series_production_line':
            return httpx.Response(200, json={'total': 1, 'limit': 30, 'offset': 0, 'truncated': False,
                'items': [{'episode_id': EPISODE, 'episode_number': 3, 'title': 'Money minute 3',
                    'planned_date': '2026-10-08', 'production_id': PRODUCTION, 'production_title': 'Money minute 3',
                    'lifecycle': 'active', 'production_lifecycle': 'active', 'requested_depth': 'complete_plan',
                    'depth': 'idea', 'line_state': 'idea', 'approval': 'draft', 'locked': False,
                    'production_revision': 1, 'episode_revision': 1, 'collection_id': None,
                    'execution_summary': {'real': 0, 'ai': 0, 'hybrid': 0},
                    'timing': {'production': {'target_ms': 45000, 'calculated_ms': 0, 'status': 'under'},
                        'counts': {'scenes': 0, 'shots': 0}},
                    'blockers': [{'code': 'requested_depth_missing',
                        'severity': 'blocking', 'message': 'The Story is not written yet.',
                        'action': 'Write or generate the Story for this Episode.'}],
                    'readiness': {'blocking': 1, 'warnings': 0, 'state': 'BLOCKED'}}],
                'note': 'States come from real domain state (documents, Scenes, Shots, plans, captures, Results, approval). No percentage is invented.'})
        if name == 'series_director_context':
            return httpx.Response(200, json={'series_id': SERIES, 'title': 'Daily Personal Finance',
                'series_kind': 'recurring', 'timezone': 'Europe/London', 'cadence_metadata': {'kind': 'daily'},
                'format_metadata_keys': ['title_pattern'], 'recent_titles': [{'episode_number': 3,
                    'title': 'Money minute 3', 'planned_date': '2026-10-08', 'line_state': 'idea'}],
                'upcoming': [], 'avoid_list': ['Money minute 3'],
                'note': 'Bounded Series context: titles, dates and states only.'})
        return httpx.Response(200, json={'applied': True, 'rpc': name})

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_secret_key='service-role-key',
        environment='test', ai_provider='none', ai_provider_api_key=None)
    test_client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    test_client.__enter__()
    return test_client, state


CHAR_ID = '00000000-0000-4000-8000-000000000801'


def long_form(production: str = PRODUCTION) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{production}/long-form'


def series_base(series: str = SERIES) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/series/{series}'


def test_structure_read_requires_membership() -> None:
    client, _ = make_client(role=None)
    response = client.get(f'{long_form()}/structure', headers=HEADERS)
    assert response.status_code == 403


def test_structure_read_returns_a_bounded_page_with_display_vocabulary() -> None:
    client, _ = make_client()
    response = client.get(f'{long_form()}/structure', headers=HEADERS, params={'limit': 2})
    assert response.status_code == 200
    body = response.json()
    assert body['success'] is True
    data = body['data']
    assert data['items'][0]['display'] == 'Act 1'
    assert data['items'][0]['depth_label'] == 'Scenes Planned'
    assert data['breadcrumb_line'] == 'Ninety minute film'
    assert 'never expanded eagerly' in data['lazy']
    assert data['structure_revision'] == 41


def test_structure_read_marks_a_stale_summary_as_stale() -> None:
    client, _ = make_client(structure=structure_payload(level='sequence', items=[
        scene_item(SCENE_EIGHTEEN, 'Scene 18', 18)]))
    response = client.get(f'{long_form()}/structure', headers=HEADERS,
        params={'level': 'sequence', 'scope_id': SEQUENCE_FOUR})
    body = response.json()['data']
    assert body['items'][0]['summary']['stale'] is True
    assert body['items'][0]['summary']['stale_label'].startswith('STALE')


def test_structure_write_requires_editor() -> None:
    client, _ = make_client(role='viewer')
    response = client.post(f'{long_form()}/acts', headers=HEADERS, json={'title': 'Act 3 - Coda'})
    assert response.status_code == 403
    client, _ = make_client(role='editor')
    response = client.post(f'{long_form()}/acts', headers=HEADERS, json={'title': 'Act 3 - Coda'})
    assert response.status_code == 200


def test_create_act_sends_the_exact_rpc_payload() -> None:
    client, state = make_client()
    response = client.post(f'{long_form()}/acts', headers=HEADERS, params={'expected_revision': 7},
        json={'title': '  Act 3 - Coda  ', 'purpose': 'Land the ending', 'narrative_goal': 'Acceptance',
              'opening_state': 'Marcus alone', 'ending_state': 'Marcus leaves', 'duration_ms': 900000})
    assert response.status_code == 200
    call = state['writes'][-1]
    assert call['name'] == 'create_long_form_act'
    assert call['payload']['target_workspace'] == WORKSPACE
    assert call['payload']['target_production'] == PRODUCTION
    assert call['payload']['expected_production_revision'] == 7
    assert call['payload']['act']['title'] == 'Act 3 - Coda'
    assert call['payload']['act']['duration_ms'] == 900000


def test_create_act_rejects_an_empty_title_and_an_unsafe_duration() -> None:
    client, _ = make_client()
    assert client.post(f'{long_form()}/acts', headers=HEADERS, json={'title': '   '}).status_code == 422
    assert client.post(f'{long_form()}/acts', headers=HEADERS,
        json={'title': 'Act 9', 'duration_ms': 9007199254740992}).status_code == 422


def test_update_act_omits_unset_fields() -> None:
    client, state = make_client()
    response = client.patch(f'{long_form()}/acts/{ACT_TWO}', headers=HEADERS, json={'purpose': 'Tighten it'})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_act'] == ACT_TWO
    assert payload['patch'] == {'purpose': 'Tighten it'}
    assert 'title' not in payload['patch']


def test_act_lifecycle_only_archives() -> None:
    client, _ = make_client()
    assert client.patch(f'{long_form()}/acts/{ACT_TWO}', headers=HEADERS,
        json={'lifecycle': 'deleted'}).status_code == 422
    assert client.patch(f'{long_form()}/acts/{ACT_TWO}', headers=HEADERS,
        json={'lifecycle': 'archived'}).status_code == 200


def test_create_sequence_validates_kind_and_act() -> None:
    client, state = make_client()
    response = client.post(f'{long_form()}/sequences', headers=HEADERS,
        json={'title': 'Sequence 5 - Return', 'act_id': ACT_TWO, 'kind': 'documentary', 'duration_ms': 240000})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['sequence']['kind'] == 'documentary'
    assert payload['sequence']['act_id'] == ACT_TWO
    assert client.post(f'{long_form()}/sequences', headers=HEADERS,
        json={'title': 'Sequence 6', 'kind': 'kaleidoscope'}).status_code == 422


def test_move_scene_requires_a_revision_and_passes_both_targets() -> None:
    client, state = make_client()
    missing = client.post(f'{long_form()}/scenes/{SCENE_EIGHTEEN}/move', headers=HEADERS,
        json={'sequence_id': SEQUENCE_FOUR})
    assert missing.status_code == 422
    response = client.post(f'{long_form()}/scenes/{SCENE_EIGHTEEN}/move', headers=HEADERS,
        json={'expected_revision': 5, 'sequence_id': SEQUENCE_FOUR})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_scene'] == SCENE_EIGHTEEN
    assert payload['target_sequence'] == SEQUENCE_FOUR
    assert payload['target_act'] is None
    assert payload['expected_revision'] == 5


def test_move_sequence_to_an_act_only_names_the_child() -> None:
    client, state = make_client()
    response = client.post(f'{long_form()}/sequences/{SEQUENCE_FOUR}/move', headers=HEADERS,
        json={'expected_revision': 4, 'act_id': ACT_ONE})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_sequence'] == SEQUENCE_FOUR
    assert payload['target_act'] == ACT_ONE


def test_split_only_accepts_an_act_or_sequence() -> None:
    client, state = make_client()
    assert client.post(f'{long_form()}/split', headers=HEADERS,
        json={'level': 'production', 'id': ACT_TWO, 'split_order': 0, 'expected_revision': 3}).status_code == 422
    response = client.post(f'{long_form()}/split', headers=HEADERS,
        json={'level': 'act', 'id': ACT_TWO, 'split_order': 2048, 'expected_revision': 3,
              'title': 'Act 2B - Aftermath'})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['split_order'] == 2048
    assert payload['new_title'] == 'Act 2B - Aftermath'


def test_reorder_sends_the_structure_revision_and_the_complete_order() -> None:
    client, state = make_client()
    response = client.post(f'{long_form()}/reorder', headers=HEADERS, json={
        'level': 'act', 'ordered_ids': [ACT_TWO, ACT_ONE], 'expected_structure_revision': 41})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['ordered_ids'] == [ACT_TWO, ACT_ONE]
    assert payload['expected_production_revision'] == 41
    assert payload['parent_id'] is None
    assert client.post(f'{long_form()}/reorder', headers=HEADERS,
        json={'level': 'shot', 'ordered_ids': [SHOT_THREE]}).status_code == 422
    assert client.post(f'{long_form()}/reorder', headers=HEADERS,
        json={'level': 'act', 'ordered_ids': []}).status_code == 422


def test_approval_and_lock_are_separate_explicit_operations() -> None:
    client, state = make_client()
    approval = client.post(f'{long_form()}/approval', headers=HEADERS,
        json={'level': 'act', 'id': ACT_TWO, 'approval': 'approved', 'expected_revision': 3})
    assert approval.status_code == 200
    assert state['writes'][-1]['payload']['desired_approval'] == 'approved'
    lock = client.post(f'{long_form()}/lock', headers=HEADERS,
        json={'level': 'act', 'id': ACT_TWO, 'locked': True})
    assert lock.status_code == 200
    assert state['writes'][-1]['payload']['locked'] is True
    assert client.post(f'{long_form()}/approval', headers=HEADERS,
        json={'level': 'act', 'id': ACT_TWO, 'approval': 'final'}).status_code == 422


def test_summary_saves_against_the_scope_revision_and_is_never_a_shot() -> None:
    client, state = make_client()
    response = client.post(f'{long_form()}/summaries', headers=HEADERS,
        json={'level': 'act', 'id': ACT_TWO, 'text': 'Marcus decides to stay.', 'note': 'first pass'})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_level'] == 'act'
    assert payload['content']['text'] == 'Marcus decides to stay.'
    assert payload['generated_by'] == 'creator'
    assert client.post(f'{long_form()}/summaries', headers=HEADERS,
        json={'level': 'shot', 'id': SHOT_THREE, 'text': 'nope'}).status_code == 422


def test_summary_list_exposes_staleness_and_current_revision() -> None:
    client, _ = make_client()
    response = client.get(f'{long_form()}/summaries', headers=HEADERS)
    body = response.json()['data']
    assert body['items'][0]['stale'] is True
    assert body['items'][0]['current_revision'] > body['items'][0]['source_revision']


def test_timing_reports_the_real_gap_between_target_and_children() -> None:
    client, _ = make_client()
    response = client.get(f'{long_form()}/timing', headers=HEADERS)
    data = response.json()['data']
    assert data['conflicts'][0]['over_by_label'] == '3:20'
    assert data['production']['status'] == 'over'
    assert 'never overwritten' in data['rule']


def test_timing_translates_a_stale_revision_conflict() -> None:
    client, _ = make_client(timing_error='40001')
    response = client.get(f'{long_form()}/timing', headers=HEADERS)
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'STUDIO_CONFLICT'


def test_search_forwards_structured_filters_and_returns_object_references() -> None:
    client, state = make_client()
    response = client.get(f'{long_form()}/search', headers=HEADERS, params={
        'q': 'phone', 'levels': 'shot,scene', 'execution_method': 'real', 'character_asset_id': CHARACTER})
    assert response.status_code == 200
    payload = state['calls'][-1]['payload']
    assert payload['filters'] == {'levels': ['shot', 'scene'], 'character_asset_id': CHARACTER,
        'execution_method': 'real'}
    item = response.json()['data']['items'][0]
    assert item['id'] == SHOT_THREE
    assert item['shot_id'] == SHOT_THREE


def test_script_navigation_is_paginated_and_measured() -> None:
    client, _ = make_client()
    body = client.get(f'{long_form()}/script', headers=HEADERS).json()['data']
    assert body['items'][0]['scope_level'] == 'scene'
    assert body['items'][0]['line_duration_ms'] == 22000
    assert body['items'][0]['lines'] == 14


def test_context_requires_an_explicit_scope() -> None:
    client, _ = make_client()
    assert client.get(f'{long_form()}/context', headers=HEADERS,
        params={'level': 'act', 'budget_chars': 1200}).status_code == 422
    response = client.get(f'{long_form()}/context', headers=HEADERS,
        params={'level': 'act', 'scope_id': ACT_TWO, 'budget_chars': 1200})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['scope']['id'] == ACT_TWO
    assert data['budget_chars'] == 1200


def test_director_scope_resolves_act_two_without_widening() -> None:
    client, _ = make_client()
    response = client.post(f'{long_form()}/director/scope', headers=HEADERS,
        json={'text': 'Make Act 2 shorter.'})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['resolution']['scope_level'] == 'act'
    assert data['resolution']['scope_id'] == ACT_TWO
    assert data['resolution']['operation'] == 'shorten_scope'
    assert data['resolution']['scope_is_explicit'] is True
    assert data['breadcrumb_line'] == 'Ninety minute film -> Act 2 - The break'
    assert 'no other Act is rewritten' in data['rule']


def test_director_scope_reports_ambiguity_instead_of_guessing() -> None:
    client, _ = make_client(structure=structure_payload(items=[]))
    response = client.post(f'{long_form()}/director/scope', headers=HEADERS, json={'text': 'Make it shorter.'})
    data = response.json()['data']
    assert data['resolution']['ambiguous'] is True
    assert data['resolution']['scope_is_explicit'] is False
    assert 'did not widen' in data['resolution']['note']


def test_create_series_maps_cadence_format_and_timezone() -> None:
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/projects/{PROJECT}/series', headers=HEADERS, json={
        'title': 'Daily Personal Finance', 'series_kind': 'recurring', 'timezone': 'Europe/London',
        'cadence_metadata': {'kind': 'selected_weekdays', 'weekdays': [5, 1, 3]},
        'format': {'runtime_target_ms': 45000, 'title_pattern': 'Money minute {n}', 'planned_episodes': 10,
                   'character_ids': [CHARACTER]}})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_project'] == PROJECT
    assert payload['series']['timezone'] == 'Europe/London'
    assert payload['series']['cadence_metadata']['weekdays'] == [1, 3, 5]
    assert payload['series']['format']['runtime_target_ms'] == 45000
    assert payload['series']['format']['character_ids'] == [CHARACTER]
    # A duplicated weekday is an ambiguity, not something to normalise away silently.
    assert client.post(f'/api/v1/workspaces/{WORKSPACE}/projects/{PROJECT}/series', headers=HEADERS,
        json={'title': 'Show', 'cadence_metadata': {'kind': 'selected_weekdays', 'weekdays': [1, 1]}}).status_code == 422


def test_create_series_rejects_a_blank_timezone_and_bad_weekdays() -> None:
    client, _ = make_client()
    base = {'title': 'Show', 'cadence_metadata': {'kind': 'daily'}, 'format': {}}
    assert client.post(f'/api/v1/workspaces/{WORKSPACE}/projects/{PROJECT}/series', headers=HEADERS,
        json=base | {'timezone': '  '}).status_code == 422
    assert client.post(f'/api/v1/workspaces/{WORKSPACE}/projects/{PROJECT}/series', headers=HEADERS,
        json=base | {'cadence_metadata': {'kind': 'selected_weekdays', 'weekdays': [9]}}).status_code == 422
    assert client.post(f'/api/v1/workspaces/{WORKSPACE}/projects/{PROJECT}/series', headers=HEADERS,
        json=base | {'series_kind': 'serial'}).status_code == 422


def test_update_series_sends_a_revision_and_omits_unset_fields() -> None:
    client, state = make_client()
    assert client.patch(series_base(), headers=HEADERS, json={'timezone': 'UTC'}).status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_series'] == SERIES
    assert payload['patch'] == {'timezone': 'UTC'}
    assert payload['expected_revision'] is None


def test_save_collection_creates_or_updates_a_season() -> None:
    client, state = make_client()
    response = client.post(f'{series_base()}/collections', headers=HEADERS,
        json={'title': 'Season 1', 'purpose': 'Ten episode run'})
    assert response.status_code == 200
    assert state['writes'][-1]['payload']['collection']['title'] == 'Season 1'


def test_series_overview_reports_counts_and_reused_assets() -> None:
    client, _ = make_client()
    data = client.get(series_base(), headers=HEADERS).json()['data']
    assert data['counts']['episodes_active'] == 7
    assert data['reuse'][0]['asset_id'] == CHAR_ID
    assert 'never copied' in data['note']


def test_episode_creation_is_idempotent_by_slot() -> None:
    client, state = make_client()
    response = client.post(f'{series_base()}/episodes', headers=HEADERS,
        json={'slot_key': '2026-10-14', 'planned_date': '2026-10-14', 'topic': 'Emergency fund',
              'requested_depth': 'ideas_only'})
    assert response.status_code == 200
    assert response.json()['data']['state'] == 'created'
    payload = state['writes'][-1]['payload']
    assert payload['episode']['topic'] == 'Emergency fund'
    repeated, _ = make_client(episode_duplicate=True)
    again = repeated.post(f'{series_base()}/episodes', headers=HEADERS,
        json={'slot_key': '2026-10-14', 'planned_date': '2026-10-14'}).json()['data']
    assert again['created'] is False
    assert again['state'] == 'preserved'
    assert 'nothing was overwritten' in again['note']


def test_episode_patch_keeps_creative_content_on_the_production() -> None:
    client, state = make_client()
    assert client.patch(f'{series_base()}/episodes/{EPISODE}', headers=HEADERS,
        json={'requested_depth': 'complete_plan', 'expected_revision': 2}).status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_episode'] == EPISODE
    assert payload['patch'] == {'requested_depth': 'complete_plan'}
    assert payload['expected_revision'] == 2
    assert client.patch(f'{series_base()}/episodes/{EPISODE}', headers=HEADERS,
        json={'requested_depth': 'blockbuster'}).status_code == 422


def test_slots_use_the_cadence_horizon_without_creating_anything() -> None:
    client, state = make_client()
    response = client.get(f'{series_base()}/slots', headers=HEADERS,
        params={'horizon': 'next_14', 'hold_slots': '2026-10-06,2026-10-07'})
    data = response.json()['data']
    assert data['horizon'] == 'next_14'
    assert data['slots'][0]['state'] == 'open'
    assert state['writes'] == [], 'a slot read never writes'


def test_preview_is_read_only_and_strips_confirmation() -> None:
    client, state = make_client()
    response = client.post(f'{series_base()}/generate-ahead/preview', headers=HEADERS,
        json={'horizon': 'next_7', 'depth': 'ideas_only', 'confirm': True})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['requires_confirmation'] is True
    assert 'nothing was created' in data['note']
    assert state['writes'] == []
    preview_call = [call for call in state['calls'] if call['name'] == 'generate_ahead_preview'][-1]
    assert 'confirm' not in preview_call['payload']['request']


def test_generate_ahead_requires_confirmation_and_never_overwrites() -> None:
    client, state = make_client()
    unconfirmed = client.post(series_base(), headers=HEADERS)  # status/wrong route guard
    assert unconfirmed.status_code == 401 or unconfirmed.status_code == 405
    response = client.post(f'{series_base()}/generate-ahead', headers=HEADERS, json={
        'horizon': 'next_7', 'depth': 'ideas_only', 'confirm': True, 'hold_slots': ['2026-10-08'],
        'topics': ['Emergency fund'], 'note': 'week one'})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['counts']['created'] == 7
    assert data['created_episodes'][0]['topic_source'] == 'title_pattern'
    payload = state['writes'][-1]['payload']
    assert payload['request']['confirm'] is True
    assert payload['request']['hold_slots'] == ['2026-10-08']
    assert payload['request']['topics'] == ['Emergency fund']


def test_generate_ahead_rejects_an_unknown_horizon_or_depth() -> None:
    client, _ = make_client()
    assert client.post(f'{series_base()}/generate-ahead', headers=HEADERS,
        json={'horizon': 'eventually', 'depth': 'ideas_only', 'confirm': True}).status_code == 422
    assert client.post(f'{series_base()}/generate-ahead', headers=HEADERS,
        json={'horizon': 'next_7', 'depth': 'everything', 'confirm': True}).status_code == 422
    assert client.post(f'{series_base()}/generate-ahead', headers=HEADERS,
        json={'horizon': 'custom', 'depth': 'ideas_only', 'count': 500, 'confirm': True}).status_code == 422


def test_retry_targets_one_job_and_reports_partial_state() -> None:
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/generate-ahead/jobs/{JOB}/retry', headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['state'] == 'retrying'
    assert data['counts']['blocked'] == 1
    assert state['writes'][-1]['payload']['target_job'] == JOB


def test_jobs_expose_per_slot_items_for_partial_success() -> None:
    client, _ = make_client()
    data = client.get(f'{series_base()}/jobs', headers=HEADERS).json()['data']
    assert data['jobs'][0]['state'] == 'retrying'
    assert data['jobs'][0]['items'][0]['state'] == 'blocked'
    assert data['jobs'][0]['blocked_count'] == 2


def test_production_line_reports_depth_blockers_and_no_percentage() -> None:
    client, _ = make_client()
    data = client.get(f'{series_base()}/production-line', headers=HEADERS).json()['data']
    item = data['items'][0]
    assert item['depth_label'] == 'Idea'
    assert item['line_state_label'] == 'Idea'
    assert item['requested_depth_label'] == 'Complete Production Plan'
    assert item['blockers'][0]['code'] == 'requested_depth_missing'
    assert item['readiness'] == {'blocking': 1, 'warnings': 0, 'state': 'BLOCKED'}
    assert data['readiness_is_criteria_based'] is True
    # Criteria-based readiness: counts of real blockers, never a numeric completion score.
    assert '%' not in json.dumps(data)
    assert 'readiness_percent' not in data and 'percent_ready' not in data


def test_series_director_scope_resolves_a_finite_horizon_with_bounded_context() -> None:
    client, _ = make_client()
    response = client.post(f'{series_base()}/director/scope', headers=HEADERS,
        json={'text': "Plan next seven episodes but don't repeat this week's topics.", 'limit': 5})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['resolution']['horizon'] == 'next_7'
    assert data['resolution']['avoid_recent_topics'] is True
    assert data['next_horizon_label'] == 'next_7'
    assert 'avoid_list' in data['context']
    assert data['context']['avoid_list'] == ['Money minute 3']
    assert 'note' not in data['context'], 'the raw database note is not echoed as Series context'
    assert 'Nothing was created' in data['rule']


def test_unapplied_migration_reports_the_long_form_layer_as_missing() -> None:
    client, _ = make_client(no_migration=True)
    response = client.get(f'{long_form()}/structure', headers=HEADERS)
    assert response.status_code == 503
    error = response.json()['errors'][0]
    assert error['code'] == 'STUDIO_SCHEMA_MISSING'
    assert 'Long-form & Series' in error['message']


def test_cross_workspace_access_is_refused_with_the_guard_code() -> None:
    client, _ = make_client(role='owner')
    response = client.get(f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/long-form/structure',
        headers=HEADERS)
    assert response.status_code == 403
