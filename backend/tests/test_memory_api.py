"""Prompt 9C API coverage: production memory, authority, candidates and structured search.

The platform is mocked with httpx.MockTransport. Semantic behaviour (the authority hierarchy, what
is in force, supersede-not-rewrite, scope isolation, the memory policy, the revision pinning that
refuses a moved candidate, and that search matches real columns) is proven against real embedded
PostgreSQL in tests/database/prompt9c-memory.test.mjs. These tests prove the HTTP path:
authorization, the exact RPC payload contract, error translation, and the boundaries this feature
must never cross - memory has no direct write path, an inference cannot claim creator authority,
``accepted`` provenance cannot be typed into a form, nothing becomes memory from a candidate without
a decision or an explicit policy, and search never presents itself as semantic or media analysis.
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
DENIED_PRODUCTION = '00000000-0000-4000-8000-000000000099'
CHARACTER = '00000000-0000-4000-8000-000000000801'
SHOT_TWELVE = '00000000-0000-4000-8000-000000000401'
PLAN_REAL = '00000000-0000-4000-8000-000000000501'
ITEM_ONE = '00000000-0000-4000-8000-000000000901'
ITEM_TWO = '00000000-0000-4000-8000-000000000902'
CANDIDATE_ONE = '00000000-0000-4000-8000-000000000a01'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

LIMITATION = ('Memory is what this Production recorded and what you confirmed. An unconfirmed inference is '
    'labelled as an inference, and nothing here is a hidden behavioural profile.')

SEARCH_LIMITATION = ('Search reads structured production state and returns real object references. It does not '
    'use embeddings and it does not read media.')


def memory(production: str = PRODUCTION) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{production}/memory'


def item_row(identifier: str = ITEM_ONE, **overrides) -> dict:
    row = {'item_id': identifier, 'scope': 'production', 'kind': 'preference', 'subject_key': 'camera_movement',
        'statement': 'Handheld when the scene is tense.', 'source': 'saved_preference', 'origin': 'declared',
        'authority_rank': 3, 'rationale': 'The last three interviews worked this way.',
        'evidence': [{'kind': 'result', 'object_id': SHOT_TWELVE}], 'source_object_id': CHARACTER,
        'source_object_label': 'Marcus', 'source_revision': 1, 'source_object_revision': 1, 'source_changed': False,
        'candidate_id': None, 'confirmed_by': USER, 'confirmed_at': '2026-10-05T10:00:00Z', 'state': 'active',
        'retired_at': None, 'retire_reason': '', 'supersedes_id': None, 'superseded_by': None, 'in_force': True,
        'production_id': PRODUCTION, 'series_id': None, 'created_at': '2026-10-05T10:00:00Z',
        'updated_at': '2026-10-05T10:00:00Z', 'created_by': USER}
    row.update(overrides)
    return row


def summary_payload(**overrides) -> dict:
    payload = {
        'items': {'active': 5, 'archived': 2, 'subjects': 3, 'creator_confirmed': 4, 'inferred': 1,
            'sources_changed': 1},
        'by_scope': {'production': 3, 'workspace': 2}, 'by_source': {'saved_preference': 3, 'creator_instruction': 1},
        'candidates': {'proposed': 2, 'applied': 1, 'rejected': 0},
        'policy': {'scope': 'production', 'explicit': False, 'candidate_capture': True,
            'auto_accept_candidates': False,
            'note': 'Default: candidates may be recorded for your review, and nothing becomes memory automatically.',
            'updated_at': None},
        'series_id': None, 'limitations': LIMITATION,
    }
    payload.update(overrides)
    return payload


def candidates_payload(**overrides) -> dict:
    payload = {
        'items': [{'candidate_id': CANDIDATE_ONE, 'kind': 'technique', 'subject_key': 'apartment_product_emphasis',
            'statement': 'For this apartment setup, lowering the camera 20-30 cm improved Product emphasis.',
            'proposed_source': 'historical_pattern', 'basis': [{'kind': 'result', 'object_id': SHOT_TWELVE}],
            'observed_count': 2, 'source_object_id': SHOT_TWELVE, 'source_object_label': 'Shot 12', 'source_revision': 4,
            'source_changed': False, 'state': 'proposed', 'decided_by': None, 'decided_at': None,
            'decision_note': '', 'created_at': '2026-10-05T10:00:00Z'}],
        'total': 1, 'limit': 50, 'offset': 0, 'truncated': False,
        'policy': {'scope': 'production', 'explicit': False, 'candidate_capture': True,
            'auto_accept_candidates': False, 'note': 'Default policy.', 'updated_at': None},
        'note': 'A candidate is a proposal drawn from real evidence. It is never a creator preference until you accept it.',
    }
    payload.update(overrides)
    return payload


def search_payload(**overrides) -> dict:
    payload = {
        'interpretation': {'text': 'marcus', 'tokens': ['marcus'], 'kinds': ['shot', 'scene'],
            'facets': [{'facet': 'asset', 'value': 'Marcus', 'meaning':
                'Objects whose Scene includes this Asset, or that bind this Asset directly.'}],
            'limit': 50, 'series_id': None},
        'lanes': [{'lane': 'shot', 'total': 2, 'returned': 2}, {'lane': 'scene', 'total': 1, 'returned': 1}],
        'results': [
            {'entity_type': 'shot', 'entity_id': SHOT_TWELVE, 'label': 'Marcus close-up',
                'context': 'Scene 2 Kitchen', 'detail': 'He turns to leave.', 'approval': 'draft',
                'execution_method': 'real', 'revision': 3, 'locked': False,
                'matched_on': 'Character/Product binding or Scene participant'},
            {'entity_type': 'scene', 'entity_id': '00000000-0000-4000-8000-000000000301',
                'label': 'Scene 2 Kitchen', 'context': 'Apartment Interior', 'detail': 'The reveal.',
                'approval': 'draft', 'revision': 2, 'locked': False, 'matched_on': 'Character/Product binding or Scene participant'}],
        'total': 3, 'returned': 2, 'truncated': True,
        'notes': ['Search reads structured production state and returns real object references. It does not use embeddings and it does not read media.',
            'Memory results say whether the remembered item is currently in force, so what TONDE is reusing is visible rather than implied.',
            'Assets are workspace-wide reusable entities; they are returned for the whole workspace rather than only this Production.'],
    }
    payload.update(overrides)
    return payload


def make_client(*, role: str | None = 'owner', no_migration: bool = False):
    state: dict = {'calls': [], 'writes': [], 'items': {'items': [item_row()], 'total': 1, 'limit': 100,
        'offset': 0, 'truncated': False, 'note': LIMITATION}}

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
        if name == 'memory_summary':
            return httpx.Response(200, json=summary_payload())
        if name == 'memory_item_list':
            return httpx.Response(200, json=deepcopy(state['items']))
        if name == 'memory_item_set':
            state['writes'].append({'name': name, 'payload': payload})
            record = payload.get('item') or {}
            if record.get('source') == 'inference' and record.get('origin') == 'declared':
                return fail('23514', 'An inference cannot claim creator authority')
            return httpx.Response(200, json={'item_id': ITEM_ONE, 'updated': False,
                'superseded_id': ITEM_TWO if record.get('statement') == 'Locked off instead.' else None,
                'authority_rank': 2 if record.get('source') == 'production_decision' else 3,
                'scope': record.get('scope'), 'source': record.get('source'), 'origin': record.get('origin'),
                'in_force': True,
                'note_text': 'Remembered with your authority at tier 3 of 5.'})
        if name == 'memory_item_retire':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'item_id': payload.get('target_item'), 'state': 'archived',
                'retired_at': '2026-10-05T12:00:00Z', 'retire_reason': payload.get('reason_text') or '',
                'note_text': 'The item stays readable as history. Nothing TONDE recorded was deleted.'})
        if name == 'memory_resolve':
            if payload.get('target_subject') == 'unknown_subject':
                return httpx.Response(200, json={'subject_key': 'unknown_subject', 'resolved': None, 'considered': [],
                    'explanation': 'TONDE remembers nothing about this subject. Nothing is being reused.'})
            return httpx.Response(200, json={'subject_key': payload.get('target_subject'),
                'resolved': {'item_id': ITEM_ONE, 'statement': "I don't want handheld anymore.",
                    'kind': 'correction', 'scope': 'production', 'source': 'creator_instruction',
                    'origin': 'declared', 'authority_rank': 1, 'confirmed': True,
                    'created_at': '2026-10-06T09:00:00Z', 'retired_at': None},
                'considered': [
                    {'item_id': ITEM_ONE, 'statement': "I don't want handheld anymore.", 'kind': 'correction',
                        'scope': 'production', 'source': 'creator_instruction', 'origin': 'declared',
                        'authority_rank': 1, 'confirmed': True, 'created_at': '2026-10-06T09:00:00Z',
                        'retired_at': None, 'in_force': True},
                    {'item_id': ITEM_TWO, 'statement': 'Handheld is the house style.', 'kind': 'pattern',
                        'scope': 'production', 'source': 'historical_pattern', 'origin': 'inferred',
                        'authority_rank': 4, 'confirmed': False, 'created_at': '2026-09-01T09:00:00Z',
                        'retired_at': None, 'in_force': False}],
                'explanation': 'Using the creator instruction recorded on 2026-10-06 (creator-confirmed). It outranks: historical_pattern.',
                'note_text': 'A current creator instruction outranks a Production decision, which outranks an explicit saved preference, which outranks a historical pattern, which outranks an inference.'})
        if name == 'memory_policy_get':
            return httpx.Response(200, json={'production_id': PRODUCTION, 'series_id': None,
                'policies': [
                    {'scope': 'production', 'explicit': False, 'candidate_capture': True,
                        'auto_accept_candidates': False, 'note': 'Default policy.', 'updated_at': None},
                    {'scope': 'workspace', 'explicit': True, 'candidate_capture': False,
                        'auto_accept_candidates': False, 'note': 'Never learn across Productions.', 'updated_at': '2026-10-04T09:00:00Z'}],
                'note': 'Memory policy decides whether TONDE may record pattern candidates.'})
        if name == 'memory_policy_set':
            state['writes'].append({'name': name, 'payload': payload})
            policy = payload.get('policy_record') or {}
            return httpx.Response(200, json={'policy_id': '00000000-0000-4000-8000-000000000b01',
                'scope': policy.get('scope'), 'candidate_capture': policy.get('candidate_capture'),
                'auto_accept_candidates': policy.get('auto_accept_candidates'), 'note': policy.get('note'),
                'updated_at': '2026-10-06T09:00:00Z', 'note_text': 'Nothing becomes memory without your explicit decision.'})
        if name == 'memory_candidate_list':
            return httpx.Response(200, json=deepcopy(state.get('candidates') or candidates_payload()))
        if name == 'memory_candidate_record':
            state['writes'].append({'name': name, 'payload': payload})
            candidate = payload.get('candidate') or {}
            if candidate.get('source_revision') == 99:
                return fail('40001', 'The evidence changed before this candidate was recorded')
            return httpx.Response(200, json={'candidate_id': CANDIDATE_ONE, 'state': 'proposed', 'duplicate': False,
                'memory_item_id': None, 'policy': candidates_payload()['policy'],
                'note_text': 'Recorded for review. Nothing becomes memory until you accept it.'})
        if name == 'memory_candidate_decide':
            state['writes'].append({'name': name, 'payload': payload})
            if payload.get('target_candidate') == ITEM_TWO:
                return fail('40001', 'The evidence this candidate was drawn from changed')
            if payload.get('decision') == 'dismiss':
                return httpx.Response(200, json={'candidate_id': payload.get('target_candidate'),
                    'state': 'rejected', 'memory_item_id': None,
                    'note_text': 'Dismissed. Nothing was remembered and the candidate stays readable as history.'})
            return httpx.Response(200, json={'candidate_id': payload.get('target_candidate'), 'state': 'applied',
                'memory_item_id': ITEM_ONE, 'authority_rank': 4,
                'note_text': 'Remembered with your authority. It outranks an inference and any unconfirmed pattern, and a later instruction of yours outranks it.'})
        if name == 'production_search':
            return httpx.Response(200, json=search_payload())
        return httpx.Response(200, json=[])

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_secret_key='service-role-key',
        environment='test', ai_provider='none', ai_provider_api_key=None)
    test_client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    test_client.__enter__()
    return test_client, state


# ---------------------------------------------------------------- vocabulary and summary

def test_vocabulary_publishes_the_authority_tiers_and_the_limits_of_memory_and_search() -> None:
    client, _ = make_client()
    data = client.get(f'{memory()}/vocabulary', headers=HEADERS).json()['data']
    assert [entry['source'] for entry in data['sources']] == [
        'creator_instruction', 'production_decision', 'saved_preference', 'historical_pattern', 'inference']
    assert [entry['authority_rank'] for entry in data['sources']] == [1, 2, 3, 4, 5]
    assert [entry['label'] for entry in data['scopes']] == ['This Production', 'This Series', 'Entire workspace']
    assert data['origins'][2]['origin'] == 'inferred'
    assert 'hidden behavioural profile' in data['limitation']
    assert 'does not use embeddings' in data['search_limitation']
    assert 'current creator instruction outranks' in data['authority_rule']
    assert 'explicit policy or your decision' in data['rule']
    assert [entry['kind'] for entry in data['search_kinds']][0] == 'shot'


def test_summary_says_what_is_remembered_and_what_waits_for_a_decision() -> None:
    client, _ = make_client()
    data = client.get(f'{memory()}/summary', headers=HEADERS).json()['data']
    assert data['summary_line'] == '5 remembered item(s) are active; 4 of them you confirmed.'
    assert data['candidate_line'] == '2 pattern candidate(s) are waiting for your decision.'
    assert 'point at an object that has changed since' in data['changed_line']
    assert data['policy']['explicit_label'] == 'Default policy'
    assert data['policy']['capture_label'] == 'TONDE may record pattern candidates for review.'
    assert data['policy']['accept_label'] == 'Nothing becomes memory without your explicit decision.'
    assert 'hidden behavioural profile' in data['limitations']


# ---------------------------------------------------------------- items

def test_listing_memory_names_the_tier_the_source_and_whether_it_is_in_force() -> None:
    client, state = make_client()
    data = client.get(f'{memory()}/items', headers=HEADERS).json()['data']
    item = data['items'][0]
    assert item['scope_label'] == 'This Production'
    assert item['kind_label'] == 'Preference'
    assert item['source_label'] == 'Saved preference'
    assert item['origin_label'] == 'You said it'
    assert item['authority_line'] == 'Tier 3 of 5 - Saved preference'
    assert item['force_line'] == 'In force: this is what TONDE is using for this subject.'
    assert item['source_line'] == 'Drawn from Marcus at revision 1'
    payload = state['calls'][-1]['payload']
    assert payload['target_state'] == 'active' and payload['target_limit'] == 100 and payload['target_offset'] == 0
    assert payload['target_scope'] is None and payload['target_kind'] is None


def test_an_outranked_item_is_shown_as_outranked_and_a_moved_source_is_stated() -> None:
    client, state = make_client()
    state['items'] = {'items': [item_row(in_force=False), item_row(ITEM_TWO, in_force=False, source_changed=True,
        source_revision=1, source_object_revision=4, superseded_by=ITEM_ONE, statement='Handheld is the house style.',
        source='historical_pattern', origin='inferred', authority_rank=4, confirmed_by=None, confirmed_at=None)],
        'total': 2, 'limit': 100, 'offset': 0, 'truncated': False}
    data = client.get(f'{memory()}/items', headers=HEADERS).json()['data']
    assert data['items'][0]['force_line'] == 'Not in force: a stronger or newer memory outranks it.'
    assert data['items'][1]['force_line'] == 'Not in force: a stronger or newer memory outranks it.'
    assert 'The object this was drawn from has changed since' in data['items'][1]['source_line']
    assert data['items'][1]['origin_label'] == 'Inferred and unconfirmed'
    assert data['items'][1]['superseded_by'] == ITEM_ONE


def test_memory_filters_are_validated_and_history_is_available_on_request() -> None:
    client, state = make_client()
    assert client.get(f'{memory()}/items', headers=HEADERS,
        params={'state': 'archived', 'scope': 'workspace', 'kind': 'series_rule'}).status_code == 200
    payload = state['calls'][-1]['payload']
    assert payload['target_state'] == 'archived' and payload['target_scope'] == 'workspace'
    assert payload['target_kind'] == 'series_rule'
    assert client.get(f'{memory()}/items', headers=HEADERS, params={'scope': 'galaxy'}).status_code == 422
    assert client.get(f'{memory()}/items', headers=HEADERS, params={'kind': 'vibes'}).status_code == 422
    assert client.get(f'{memory()}/items', headers=HEADERS, params={'state': 'deleted'}).status_code == 422
    assert client.get(f'{memory()}/items', headers=HEADERS, params={'subject_key': 'x' * 161}).status_code == 422
    assert client.get(f'{memory()}/items', headers=HEADERS, params={'limit': '5000'}).status_code == 200
    assert state['calls'][-1]['payload']['target_limit'] == 200


def test_remembering_a_statement_sends_its_tier_and_reports_a_supersede() -> None:
    client, state = make_client()
    response = client.post(f'{memory()}/items', headers=HEADERS, json={
        'scope': 'production', 'kind': 'preference', 'subject_key': 'camera_movement',
        'statement': 'Locked off instead.', 'source': 'creator_instruction', 'origin': 'declared',
        'source_object_id': CHARACTER})
    assert response.status_code == 200
    record = state['writes'][-1]['payload']['item']
    assert record['source'] == 'creator_instruction' and record['origin'] == 'declared'
    assert record['subject_key'] == 'camera_movement'
    assert record['source_object_id'] == CHARACTER and record['source_revision'] is None
    assert state['writes'][-1]['payload']['target_production'] == PRODUCTION
    data = response.json()['data']
    assert data['superseded_id'] == ITEM_TWO
    assert data['authority_rank'] == 3
    assert 'Remembered with your authority' in data['note_text']


def test_an_inference_cannot_claim_creator_authority_and_an_accepted_item_cannot_be_typed_in() -> None:
    client, state = make_client()
    before = len(state['writes'])
    claimed = client.post(f'{memory()}/items', headers=HEADERS, json={
        'kind': 'preference', 'subject_key': 'x', 'statement': 'Handheld is required.',
        'source': 'creator_instruction', 'origin': 'inferred', 'evidence': [{'kind': 'result'}]})
    assert claimed.status_code == 422
    assert len(state['writes']) == before, 'an inference claiming creator authority never reaches the database'
    baseless = client.post(f'{memory()}/items', headers=HEADERS, json={
        'kind': 'pattern', 'subject_key': 'x', 'statement': 'Handheld is required.',
        'source': 'historical_pattern', 'origin': 'inferred'})
    assert baseless.status_code == 422
    accepted = client.post(f'{memory()}/items', headers=HEADERS, json={
        'kind': 'preference', 'subject_key': 'x', 'statement': 'Accepted something.',
        'source': 'saved_preference', 'origin': 'accepted'})
    assert accepted.status_code == 422
    assert 'created by accepting a candidate' in json.dumps(accepted.json())
    for body in [
        {'kind': 'nonsense', 'subject_key': 'x', 'statement': 'y'},
        {'kind': 'preference', 'subject_key': '   ', 'statement': 'y'},
        {'kind': 'preference', 'subject_key': 'x', 'statement': 'y' * 601},
        {'kind': 'preference', 'subject_key': 'x', 'statement': 'y', 'source': 'vibes'},
        {'kind': 'preference', 'subject_key': 'x', 'statement': 'y', 'scope': 'galaxy'},
        {'kind': 'preference', 'subject_key': 'x', 'statement': 'y', 'rationale': 'z' * 801},
    ]:
        assert client.post(f'{memory()}/items', headers=HEADERS, json=body).status_code == 422
    assert state['writes'] == [], 'no invalid memory write reached the database'


def test_retiring_memory_keeps_the_record_and_reports_a_missing_item() -> None:
    client, state = make_client()
    response = client.post(f'{memory()}/items/{ITEM_ONE}/retire', headers=HEADERS, json={'reason': 'We sold the gimbal.'})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_item'] == ITEM_ONE and payload['reason_text'] == 'We sold the gimbal.'
    assert 'no' in response.json()['data']['note_text'] or 'stays readable' in response.json()['data']['note_text']
    assert client.post(f'{memory()}/items/not-a-uuid/retire', headers=HEADERS, json={}).status_code == 422
    assert client.post(f'{memory()}/items/{ITEM_ONE}/retire', headers=HEADERS,
        json={'reason': 'x' * 401}).status_code == 422


# ---------------------------------------------------------------- resolution

def test_resolution_explains_why_tonde_is_using_something_and_what_it_outranked() -> None:
    client, state = make_client()
    data = client.get(f'{memory()}/resolve', headers=HEADERS, params={'subject_key': 'camera_movement'}).json()['data']
    assert data['resolved']['source_label'] == 'Your current instruction'
    assert data['resolved']['authority_rank'] == 1
    assert data['considered'][0]['force_line'] == 'In force'
    assert data['considered'][1]['force_line'] == 'Outranked'
    assert data['considered'][1]['authority_line'] == 'Tier 4 of 5 - Historical pattern'
    assert 'outranks' in data['explanation']
    assert 'current creator instruction outranks' in data['authority_rule']
    assert state['calls'][-1]['payload']['target_subject'] == 'camera_movement'
    assert client.get(f'{memory()}/resolve', headers=HEADERS).status_code == 422
    assert client.get(f'{memory()}/resolve', headers=HEADERS,
        params={'subject_key': 'x', 'kind': 'vibes'}).status_code == 422


def test_resolution_about_nothing_says_nothing_is_being_reused() -> None:
    client, _ = make_client()
    data = client.get(f'{memory()}/resolve', headers=HEADERS, params={'subject_key': 'unknown_subject'}).json()['data']
    assert data['resolved'] is None
    assert data['considered'] == []
    assert 'remembers nothing' in data['explanation']


# ---------------------------------------------------------------- policy

def test_the_memory_policy_is_readable_by_a_member_and_writable_only_by_an_editor() -> None:
    client, state = make_client()
    data = client.get(f'{memory()}/policies', headers=HEADERS).json()['data']
    production = next(entry for entry in data['policies'] if entry['scope'] == 'production')
    workspace_policy = next(entry for entry in data['policies'] if entry['scope'] == 'workspace')
    assert production['explicit_label'] == 'Default policy'
    assert workspace_policy['explicit_label'] == 'Set by you'
    assert workspace_policy['capture_label'] == 'TONDE will not record pattern candidates.'
    response = client.put(f'{memory()}/policies', headers=HEADERS, json={
        'scope': 'production', 'candidate_capture': False, 'auto_accept_candidates': False, 'note': 'Ask me first.'})
    assert response.status_code == 200
    assert state['writes'][-1]['payload']['policy_record'] == {
        'scope': 'production', 'series_id': None, 'candidate_capture': False,
        'auto_accept_candidates': False, 'note': 'Ask me first.'}
    assert client.put(f'{memory()}/policies', headers=HEADERS,
        json={'scope': 'galaxy'}).status_code == 422
    assert client.put(f'{memory()}/policies', headers=HEADERS,
        json={'scope': 'production', 'note': 'x' * 601}).status_code == 422


# ---------------------------------------------------------------- candidates

def test_a_candidate_is_listed_as_a_proposal_with_its_evidence_and_the_governing_policy() -> None:
    client, state = make_client()
    data = client.get(f'{memory()}/candidates', headers=HEADERS).json()['data']
    candidate = data['items'][0]
    assert candidate['state_label'] == 'Waiting for your decision'
    assert candidate['kind_label'] == 'Successful technique'
    assert candidate['proposed_source_label'] == 'Historical pattern'
    assert candidate['observed_count'] == 2
    assert data['policy']['accept_label'] == 'Nothing becomes memory without your explicit decision.'
    assert 'never a creator preference until you accept it' in data['note']
    assert state['calls'][-1]['payload']['target_state'] == 'proposed'
    assert client.get(f'{memory()}/candidates', headers=HEADERS, params={'state': 'maybe'}).status_code == 422


def test_a_candidate_whose_evidence_moved_says_so_instead_of_silently_offering_it() -> None:
    client, state = make_client()
    state['candidates'] = candidates_payload(items=[dict(candidates_payload()['items'][0], source_changed=True)])
    data = client.get(f'{memory()}/candidates', headers=HEADERS).json()['data']
    assert 'accepting it is refused' in data['items'][0]['source_line']
    assert data['items'][0]['source_object_label'] == 'Shot 12', 'the evidence is named, not implied'


def test_recording_a_candidate_requires_real_evidence_and_pins_a_revision() -> None:
    client, state = make_client()
    response = client.post(f'{memory()}/candidates', headers=HEADERS, json={
        'kind': 'technique', 'subject_key': 'apartment_product_emphasis',
        'statement': 'Lowering the camera 20-30 cm improved Product emphasis.',
        'proposed_source': 'historical_pattern', 'observed_count': 2, 'source_object_id': SHOT_TWELVE,
        'basis': [{'kind': 'result', 'object_id': SHOT_TWELVE, 'note': 'Two Shots improved.'}]})
    assert response.status_code == 200
    record = state['writes'][-1]['payload']['candidate']
    assert record['source_object_id'] == SHOT_TWELVE and record['observed_count'] == 2
    assert record['proposed_source'] == 'historical_pattern'
    assert record['source_revision'] is None, 'the database pins the current revision when none is supplied'
    assert response.json()['data']['state'] == 'proposed'
    assert 'Nothing becomes memory until you accept it' in response.json()['data']['note_text']
    assert client.post(f'{memory()}/candidates', headers=HEADERS, json={
        'kind': 'technique', 'subject_key': 'x', 'statement': 'y', 'source_object_id': SHOT_TWELVE,
        'basis': []}).status_code == 422
    assert client.post(f'{memory()}/candidates', headers=HEADERS, json={
        'kind': 'technique', 'subject_key': 'x', 'statement': 'y', 'source_object_id': SHOT_TWELVE,
        'proposed_source': 'creator_instruction', 'basis': [{'kind': 'result'}]}).status_code == 422
    assert client.post(f'{memory()}/candidates', headers=HEADERS, json={
        'kind': 'technique', 'subject_key': 'x', 'statement': 'y',
        'basis': [{'kind': 'result'}]}).status_code == 422


def test_accepting_a_candidate_is_the_only_way_a_proposal_becomes_memory() -> None:
    client, state = make_client()
    accepted = client.post(f'{memory()}/candidates/{CANDIDATE_ONE}/decide', headers=HEADERS,
        json={'decision': 'accept', 'note': 'Works for our apartment.'})
    assert accepted.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['decision'] == 'accept' and payload['note_text'] == 'Works for our apartment.'
    assert payload['target_candidate'] == CANDIDATE_ONE
    data = accepted.json()['data']
    assert data['state'] == 'applied' and data['memory_item_id'] == ITEM_ONE
    assert data['state_label'] == 'Accepted'
    assert 'It outranks an inference' in data['note_text']
    dismissed = client.post(f'{memory()}/candidates/{CANDIDATE_ONE}/decide', headers=HEADERS,
        json={'decision': 'dismiss'})
    assert dismissed.status_code == 200
    assert dismissed.json()['data']['state'] == 'rejected'
    assert 'Nothing was remembered' in dismissed.json()['data']['note_text']
    assert client.post(f'{memory()}/candidates/{CANDIDATE_ONE}/decide', headers=HEADERS,
        json={'decision': 'maybe'}).status_code == 422
    assert client.post(f'{memory()}/candidates/not-a-uuid/decide', headers=HEADERS,
        json={'decision': 'accept'}).status_code == 422


def test_a_stale_candidate_cannot_be_accepted_and_the_failure_is_a_conflict_not_a_crash() -> None:
    client, _ = make_client()
    response = client.post(f'{memory()}/candidates/{ITEM_TWO}/decide', headers=HEADERS, json={'decision': 'accept'})
    assert response.status_code == 409
    body = response.json()
    assert body['errors'][0]['code'] == 'STUDIO_CONFLICT'
    assert 'evidence this candidate was drawn from changed' in json.dumps(body)
    recorded = client.post(f'{memory()}/candidates', headers=HEADERS, json={
        'kind': 'pattern', 'subject_key': 'x', 'statement': 'y', 'source_object_id': SHOT_TWELVE,
        'source_revision': 99, 'basis': [{'kind': 'result'}]})
    assert recorded.status_code == 409, 'recording against a moved revision is refused too'


# ---------------------------------------------------------------- structured search

def test_search_sends_only_real_facets_and_returns_real_object_references() -> None:
    client, state = make_client()
    response = client.get(f'{memory()}/search', headers=HEADERS, params={
        'asset_name': 'Marcus', 'kinds': 'shot,scene', 'approval': 'not_approved', 'limit': '25'})
    assert response.status_code == 200
    query = state['calls'][-1]['payload']['query']
    assert query['asset_name'] == 'Marcus'
    assert query['kinds'] == ['shot', 'scene']
    assert query['approval'] == 'not_approved' and query['limit'] == 25
    assert query['text'] is None and query['asset_id'] is None and query['severity'] is None
    data = response.json()['data']
    assert data['results'][0]['entity_type'] == 'shot'
    assert data['results'][0]['entity_id'] == SHOT_TWELVE
    assert data['results'][0]['entity_label'] == 'Shot'
    assert data['total'] == 3 and data['returned'] == 2 and data['truncated'] is True
    assert data['lanes'][0]['label'] == 'Shot'
    assert 'Act on this Asset' not in data['interpretation']['facet_line']
    assert 'Objects whose Scene includes this Asset' in data['interpretation']['facet_line']
    assert 'does not use embeddings' in data['search_limitation']
    assert 'real object references' in data['notes'][0]


def test_search_rejects_an_unknown_facet_and_an_empty_selection_searches_every_kind() -> None:
    client, state = make_client()
    calls = len(state['calls'])
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'kinds': 'shot,galaxy'}).status_code == 422
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'approval': 'maybe'}).status_code == 422
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'severity': 'urgent'}).status_code == 422
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'asset_type': 'camera'}).status_code == 422
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'continuity_state': 'pending'}).status_code == 422
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'result_state': 'maybe'}).status_code == 422
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'memory_kind': 'vibes'}).status_code == 422
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'domain': 'vibes'}).status_code == 422
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'asset_id': 'not-a-uuid'}).status_code == 422
    assert len(state['calls']) == calls, 'a rejected search never reaches the database'
    assert client.get(f'{memory()}/search', headers=HEADERS).status_code == 200
    assert state['calls'][-1]['payload']['query']['kinds'] == []
    assert client.get(f'{memory()}/search', headers=HEADERS, params={'limit': '5000'}).status_code == 200
    assert state['calls'][-1]['payload']['query']['limit'] == 100


def test_search_can_be_asked_for_one_thing_at_a_time() -> None:
    client, state = make_client()
    assert client.get(f'{memory()}/search', headers=HEADERS,
        params={'kinds': 'plan', 'lens': '50mm', 'execution_method': 'real'}).status_code == 200
    query = state['calls'][-1]['payload']['query']
    assert query['kinds'] == ['plan'] and query['lens'] == '50mm' and query['execution_method'] == 'real'
    assert client.get(f'{memory()}/search', headers=HEADERS,
        params={'kinds': 'memory', 'memory_kind': 'technique', 'text': 'lower the camera'}).status_code == 200
    query = state['calls'][-1]['payload']['query']
    assert query['text'] == 'lower the camera' and query['memory_kind'] == 'technique'
    assert client.get(f'{memory()}/search', headers=HEADERS,
        params={'kinds': 'shot', 'provider': 'veo', 'model': 'veo-3'}).status_code == 200
    query = state['calls'][-1]['payload']['query']
    assert query['provider'] == 'veo' and query['model'] == 'veo-3'


# ---------------------------------------------------------------- authorization and failure

def test_reads_need_membership_and_writes_need_an_editor() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.get(f'{memory()}/summary', headers=HEADERS).status_code == 200
    assert viewer.get(f'{memory()}/items', headers=HEADERS).status_code == 200
    assert viewer.get(f'{memory()}/resolve', headers=HEADERS,
        params={'subject_key': 'camera_movement'}).status_code == 200
    assert viewer.get(f'{memory()}/candidates', headers=HEADERS).status_code == 200
    assert viewer.get(f'{memory()}/policies', headers=HEADERS).status_code == 200
    assert viewer.get(f'{memory()}/search', headers=HEADERS).status_code == 200
    assert viewer.post(f'{memory()}/items', headers=HEADERS,
        json={'kind': 'preference', 'subject_key': 'x', 'statement': 'y'}).status_code == 403
    assert viewer.post(f'{memory()}/items/{ITEM_ONE}/retire', headers=HEADERS, json={}).status_code == 403
    assert viewer.put(f'{memory()}/policies', headers=HEADERS, json={'scope': 'production'}).status_code == 403
    assert viewer.post(f'{memory()}/candidates', headers=HEADERS,
        json={'kind': 'pattern', 'subject_key': 'x', 'statement': 'y', 'source_object_id': SHOT_TWELVE,
            'basis': [{'kind': 'result'}]}).status_code == 403
    assert viewer.post(f'{memory()}/candidates/{CANDIDATE_ONE}/decide', headers=HEADERS,
        json={'decision': 'accept'}).status_code == 403
    editor, _ = make_client(role='editor')
    assert editor.post(f'{memory()}/items', headers=HEADERS,
        json={'kind': 'preference', 'subject_key': 'x', 'statement': 'y'}).status_code == 200
    outsider, _ = make_client(role=None)
    assert outsider.get(f'{memory()}/summary', headers=HEADERS).status_code == 403
    assert outsider.get(f'{memory()}/search', headers=HEADERS).status_code == 403


def test_a_cross_workspace_call_becomes_403_and_a_missing_migration_becomes_an_honest_503() -> None:
    client, _ = make_client()
    other_workspace = f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/memory/summary'
    assert client.get(other_workspace, headers=HEADERS).status_code == 403
    # The database guard returns 42501, which is authorization rather than a server fault.
    denied = client.get(f'{memory(production=DENIED_PRODUCTION)}/summary', headers=HEADERS)
    assert denied.status_code == 403
    empty, _ = make_client(no_migration=True)
    response = empty.get(f'{memory()}/summary', headers=HEADERS)
    assert response.status_code == 503
    body = response.json()
    assert body['errors'][0]['code'] == 'STUDIO_SCHEMA_MISSING'
    assert 'Production memory' in json.dumps(body)
    assert empty.get(f'{memory()}/search', headers=HEADERS).status_code == 503


def test_memory_requires_an_authenticated_session() -> None:
    client, _ = make_client()
    assert client.get(f'{memory()}/summary').status_code == 401
    assert client.post(f'{memory()}/items', json={'kind': 'preference', 'subject_key': 'x',
        'statement': 'y'}).status_code == 401
    assert client.get(f'{memory()}/search').status_code == 401


def test_a_memory_write_logs_identifiers_rather_than_the_remembered_text(capsys) -> None:
    client, _ = make_client()
    secret = 'The client name is Project Nightfall and the budget is confidential.'
    response = client.post(f'{memory()}/items', headers=HEADERS, json={
        'kind': 'preference', 'subject_key': 'confidential_thing', 'statement': secret})
    assert response.status_code == 200
    record = response.json()['data']
    assert 'statement' not in record, 'the write response reports identifiers and authority, not payload text'
    logged = capsys.readouterr().out
    assert 'memory_item_recorded' in logged
    assert secret not in logged, 'the log line carries identifiers rather than the remembered text'
    assert 'confidential_thing' not in logged, 'not even the subject key is logged'
