"""Prompt 9B API coverage: continuity statements, checks, findings and proposals.

The platform is mocked with httpx.MockTransport. Semantic behaviour (temporal ordering, the five
deterministic rules, lock interaction, supersede-not-rewrite, the staleness of a recorded check,
workspace isolation) is proven against real embedded PostgreSQL in
tests/database/prompt9b-continuity.test.mjs. These tests prove the HTTP path: authorization, the
exact RPC payload contract, error translation, and the boundary the feature must never cross -
a check changes no statement, a finding has no `approved` state, and an inferred proposal cannot
claim to be an observation.
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
CHARACTER = '00000000-0000-4000-8000-000000000801'
SCENE_FOUR = '00000000-0000-4000-8000-000000000301'
SCENE_FIVE = '00000000-0000-4000-8000-000000000302'
SHOT_TWELVE = '00000000-0000-4000-8000-000000000401'
DENIED_PRODUCTION = '00000000-0000-4000-8000-000000000099'
STATE_ONE = '00000000-0000-4000-8000-000000000e01'
STATE_TWO = '00000000-0000-4000-8000-000000000e02'
CHECK_ONE = '00000000-0000-4000-8000-000000000f01'
FINDING_ONE = '00000000-0000-4000-8000-000000000f11'
FINDING_PROPOSAL = '00000000-0000-4000-8000-000000000f12'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

LIMITATION = ('Continuity here is what the Production records. It is not a claim about analysed media, '
    'and an unrecorded trait is unknown rather than consistent.')


def continuity(production: str = PRODUCTION) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{production}/continuity'


def state_item(identifier: str = STATE_ONE, **overrides) -> dict:
    item = {'state_id': identifier, 'domain': 'wardrobe', 'subject_object_id': CHARACTER,
        'subject_label': 'Marcus', 'subject_kind': 'asset', 'trait': 'shirt condition', 'anchor': 'scene_ending',
        'scene_id': SCENE_FOUR, 'shot_id': None, 'scene_label': 'Scene 4 Kitchen', 'shot_label': None,
        'value': 'blood on the left shoulder', 'transition': 'changed', 'origin': 'declared',
        'epistemic': 'observed', 'confidence': 'high', 'reason': 'Marcus is injured in the kitchen.',
        'note': '', 'retired': False, 'retire_reason': '', 'revision': 1, 'created_at': '2026-10-05T10:00:00Z'}
    item.update(overrides)
    return item


def findings_payload(**overrides) -> dict:
    payload = {
        'items': [
            {'finding_id': FINDING_ONE, 'kind': 'boundary_break', 'severity': 'critical', 'domain': 'character',
                'trait': 'shirt condition', 'subject_object_id': CHARACTER, 'subject_label': 'Marcus',
                'earlier_state_id': STATE_ONE, 'later_state_id': STATE_TWO, 'scene_id': SCENE_FIVE, 'shot_id': None,
                'scene_label': 'Scene 5 Street', 'shot_label': None,
                'explanation': 'The trait "shirt condition" was "blood on the left shoulder" at Scene 4 Kitchen ending '
                    'and is "shirt clean" at Scene 5 Street opening across a Scene boundary, and no change was declared.',
                'suggested_resolution': 'Confirm the state actually carries over, or declare the change and the reason for it.',
                'origin': 'derived', 'rationale': '', 'epistemic': 'observed', 'confidence': 'high',
                'evidence': [{'kind': 'continuity_state', 'object_id': STATE_ONE}], 'state': 'open',
                'resolution_note': '', 'resolved_at': None, 'check_id': CHECK_ONE,
                'created_at': '2026-10-05T10:00:00Z'},
        ],
        'total': 1, 'limit': 100, 'offset': 0, 'truncated': False,
        'check': {'check_id': CHECK_ONE, 'verdict': 'conflict', 'counts': {'critical': 1, 'warning': 0, 'info': 0},
            'explanation': '1 continuity conflict needs a creator decision.', 'limitations': LIMITATION,
            'created_at': '2026-10-05T10:00:00Z', 'state_count': 2, 'state_watermark': '2026-10-05T10:00:00Z',
            'is_current': True},
        'checks_available': 2, 'open_count': 1,
        'note': 'A finding describes the recorded statements. Resolving it is a creator decision and does not change the statements.',
    }
    payload.update(overrides)
    return payload


def make_client(*, role: str | None = 'owner', no_migration: bool = False):
    state: dict = {'calls': [], 'writes': [], 'findings': findings_payload()}

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
        if name == 'continuity_state_set':
            state['writes'].append({'name': name, 'payload': payload})
            record = payload.get('state_record') or {}
            if record.get('domain') == 'vibes':
                return fail('22023', 'Unsupported continuity domain')
            return httpx.Response(200, json={'state_id': STATE_ONE, 'updated': False,
                'superseded_state_id': STATE_TWO if record.get('value') == 'torn shirt' else None,
                'anchor': record.get('anchor'), 'trait': record.get('trait'), 'value': record.get('value'),
                'transition': record.get('transition'),
                'note': 'The previous statement at this point was kept and marked as superseded.'})
        if name == 'continuity_state_retire':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'state_id': payload.get('target_state'), 'retired': True,
                'note': 'The statement is retired, not deleted: its history stays readable.'})
        if name == 'continuity_state_list':
            return httpx.Response(200, json={'items': [state_item()], 'total': 1, 'live': 1, 'limit': 100,
                'offset': 0, 'truncated': False})
        if name == 'continuity_chain':
            return httpx.Response(200, json={'subject_object_id': payload.get('target_subject'),
                'subject_label': 'Marcus', 'statement_count': 2,
                'statements': [
                    {'state_id': STATE_ONE, 'domain': 'character', 'trait': 'shirt condition', 'anchor': 'scene_opening',
                        'position_label': 'Scene 4 Kitchen opening', 'scene_id': SCENE_FOUR, 'shot_id': None,
                        'value': 'torn shirt', 'transition': 'baseline', 'origin': 'declared',
                        'epistemic': 'observed', 'confidence': 'high', 'reason': 'First appearance.'},
                    {'state_id': STATE_TWO, 'domain': 'character', 'trait': 'shirt condition', 'anchor': 'scene_ending',
                        'position_label': 'Scene 4 Kitchen ending', 'scene_id': SCENE_FOUR, 'shot_id': None,
                        'value': 'blood on the left shoulder', 'transition': 'changed', 'origin': 'declared',
                        'epistemic': 'observed', 'confidence': 'high', 'reason': 'Marcus is injured.'}],
                'note': 'This is the recorded timeline of the subject. It lists declared statements in Production order.'})
        if name == 'continuity_check':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'check_id': CHECK_ONE, 'verdict': 'conflict',
                'counts': {'critical': 1, 'warning': 0, 'info': 0, 'live_states': 2, 'retired_states': 1},
                'finding_count': 1, 'state_count': 2, 'production_revision': 9,
                'state_watermark': '2026-10-05T10:00:00Z',
                'explanation': '1 continuity conflict needs a creator decision.', 'limitations': LIMITATION,
                'created_at': '2026-10-05T10:00:00Z',
                'findings': deepcopy(findings_payload()['items'])})
        if name == 'continuity_finding_list':
            return httpx.Response(200, json=deepcopy(state['findings']))
        if name == 'continuity_finding_update':
            state['writes'].append({'name': name, 'payload': payload})
            desired = payload.get('desired_state')
            if desired not in ('open', 'acknowledged', 'resolved', 'waived'):
                return fail('22023', 'Unsupported finding state')
            return httpx.Response(200, json={'finding_id': payload.get('target_finding'), 'state': desired,
                'resolution_note': payload.get('note_text'), 'resolved_at': '2026-10-05T11:00:00Z',
                'note': 'The finding was recorded. The continuity statements and any approval are unchanged.'})
        if name == 'continuity_finding_record':
            state['writes'].append({'name': name, 'payload': payload})
            record = payload.get('finding_record') or {}
            if record.get('epistemic') == 'observed':
                return fail('23514', 'A proposal cannot claim an observation')
            return httpx.Response(200, json={'finding_id': FINDING_PROPOSAL, 'state': 'open', 'origin': 'inferred',
                'epistemic': record.get('epistemic'), 'confidence': record.get('confidence'),
                'note': 'This is a proposal, not a finding of fact. It does not change any continuity statement.'})
        if name == 'continuity_summary':
            return httpx.Response(200, json={'live_states': 2, 'retired_states': 1, 'subject_count': 1,
                'domains': [{'domain': 'character', 'count': 2}],
                'check': {'check_id': CHECK_ONE, 'verdict': 'conflict', 'counts': {'critical': 1, 'warning': 0, 'info': 0},
                    'explanation': '1 continuity conflict needs a creator decision.', 'limitations': LIMITATION,
                    'created_at': '2026-10-05T10:00:00Z', 'is_current': True, 'state_count_at_check': 2},
                'findings': {'open': 1, 'acknowledged': 0, 'critical_open': 1},
                'analysis_stale': False, 'limitations': LIMITATION})
        return httpx.Response(200, json=[])

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_secret_key='service-role-key',
        environment='test', ai_provider='none', ai_provider_api_key=None)
    test_client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    test_client.__enter__()
    return test_client, state


# ---------------------------------------------------------------- vocabulary and summary

def test_vocabulary_publishes_the_rules_and_the_limitation_that_bounds_them() -> None:
    client, _ = make_client()
    data = client.get(f'{continuity()}/vocabulary', headers=HEADERS).json()['data']
    kinds = [rule['kind'] for rule in data['rules']]
    assert kinds == ['boundary_break', 'unexplained_change', 'lock_conflict', 'missing_reason', 'unverified_after']
    assert data['rules'][0]['severity'] == 'critical'
    assert 'does not analyse media' in data['limitation']
    assert 'declared rather than inferred' in data['rule']
    assert [item['domain'] for item in data['domains']][:3] == ['character', 'wardrobe', 'prop']
    assert [item['anchor'] for item in data['anchors']] == ['production', 'scene_opening', 'scene_ending', 'shot']


def test_summary_says_whether_the_recorded_check_is_still_current() -> None:
    client, _ = make_client()
    data = client.get(f'{continuity()}/summary', headers=HEADERS).json()['data']
    assert data['check']['verdict_label'] == 'Conflict'
    assert data['check']['freshness'] == 'This check matches the recorded statements.'
    assert data['stale_label'] == 'The recorded continuity analysis matches the statements.'
    assert data['domains'][0]['label'] == 'Character'
    assert data['findings']['critical_open'] == 1
    assert 'unrecorded trait is unknown' in data['limitations']


# ---------------------------------------------------------------- statements

def test_states_list_names_the_domain_the_anchor_and_the_transition() -> None:
    client, state = make_client()
    data = client.get(f'{continuity()}/states', headers=HEADERS).json()['data']
    item = data['items'][0]
    assert item['domain_label'] == 'Wardrobe'
    assert item['anchor_label'] == 'Scene ending'
    assert item['transition_label'] == 'Declared change'
    assert item['origin_label'] == 'Declared by you'
    payload = state['calls'][-1]['payload']
    assert payload['include_retired'] is False and payload['target_limit'] == 100
    assert 'does not analyse media' in data['limitation']


def test_states_list_rejects_an_unknown_domain_and_bounds_the_page() -> None:
    client, _ = make_client()
    assert client.get(f'{continuity()}/states', headers=HEADERS, params={'domain': 'vibes'}).status_code == 422
    assert client.get(f'{continuity()}/states', headers=HEADERS,
        params={'include_retired': 'true', 'limit': '5000', 'offset': '12'}).status_code == 200


def test_recording_a_statement_sends_the_declaration_and_reports_a_supersede() -> None:
    client, state = make_client()
    response = client.post(f'{continuity()}/states', headers=HEADERS, json={
        'domain': 'wardrobe', 'trait': 'shirt condition', 'value': 'torn shirt', 'anchor': 'scene_ending',
        'scene_id': SCENE_FOUR, 'transition': 'changed', 'reason': 'The shirt tore in the kitchen.',
        'subject_object_id': CHARACTER})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['state_record']['trait'] == 'shirt condition'
    assert payload['state_record']['anchor'] == 'scene_ending'
    assert payload['state_record']['scene_id'] == SCENE_FOUR
    assert payload['state_record']['shot_id'] is None
    assert payload['target_workspace'] == WORKSPACE and payload['target_production'] == PRODUCTION
    data = response.json()['data']
    assert data['superseded_state_id'] == STATE_TWO
    assert 'kept and marked as superseded' in data['note']


def test_a_shot_statement_must_name_a_shot_and_a_scene_statement_a_scene() -> None:
    client, state = make_client()
    incoherent = client.post(f'{continuity()}/states', headers=HEADERS, json={
        'domain': 'wardrobe', 'trait': 'cap', 'value': 'cap on', 'anchor': 'shot'})
    assert incoherent.status_code == 422
    assert state['writes'] == [], 'an incoherent anchor never reaches the database'
    production_scoped = client.post(f'{continuity()}/states', headers=HEADERS, json={
        'domain': 'weather', 'trait': 'weather', 'value': 'overcast'})
    assert production_scoped.status_code == 200
    assert client.post(f'{continuity()}/states', headers=HEADERS, json={
        'domain': 'vibes', 'trait': 'x', 'value': 'y'}).status_code == 422
    assert client.post(f'{continuity()}/states', headers=HEADERS, json={
        'domain': 'prop', 'trait': '   ', 'value': 'y'}).status_code == 422
    assert client.post(f'{continuity()}/states', headers=HEADERS, json={
        'domain': 'prop', 'trait': 'x', 'value': 'y' * 401}).status_code == 422
    assert client.post(f'{continuity()}/states', headers=HEADERS,
        json={'domain': 'prop', 'trait': 'x', 'value': 'y', 'epistemic': 'certain'}).status_code == 422


def test_retiring_a_statement_keeps_the_record_instead_of_deleting_it() -> None:
    client, state = make_client()
    response = client.post(f'{continuity()}/states/{STATE_ONE}/retire', headers=HEADERS,
        json={'reason': 'The scene was cut.'})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_state'] == STATE_ONE and payload['reason_text'] == 'The scene was cut.'
    assert 'not deleted' in response.json()['data']['note']
    assert client.post(f'{continuity()}/states/not-a-uuid/retire', headers=HEADERS, json={}).status_code == 422
    assert client.post(f'{continuity()}/states/{STATE_ONE}/retire', headers=HEADERS,
        json={'reason': 'x' * 401}).status_code == 422


def test_chain_returns_the_timeline_in_production_order() -> None:
    client, state = make_client()
    data = client.get(f'{continuity()}/chain', headers=HEADERS,
        params={'subject_object_id': CHARACTER, 'domain': 'character', 'trait': 'shirt condition'}).json()['data']
    assert [item['position_label'] for item in data['statements']] == [
        'Scene 4 Kitchen opening', 'Scene 4 Kitchen ending']
    assert data['statements'][0]['transition_label'] == 'First statement'
    assert state['calls'][-1]['payload']['target_trait'] == 'shirt condition'
    assert client.get(f'{continuity()}/chain', headers=HEADERS, params={'domain': 'character'}).status_code == 422
    assert client.get(f'{continuity()}/chain', headers=HEADERS,
        params={'subject_object_id': CHARACTER, 'domain': 'vibes'}).status_code == 422


# ---------------------------------------------------------------- checks

def test_running_a_check_records_its_findings_and_changes_no_statement() -> None:
    client, state = make_client()
    response = client.post(f'{continuity()}/check', headers=HEADERS, json={'note': 'After the injury.'})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['note_text'] == 'After the injury.'
    assert 'state_record' not in payload, 'a check carries no statement'
    data = response.json()['data']
    assert data['verdict'] == 'conflict'
    assert data['verdict_label'] == 'Conflict'
    finding = data['findings'][0]
    assert finding['kind_label'] == 'Break across a Scene boundary'
    assert finding['severity_label'] == 'Conflict'
    assert finding['state_label'] == 'Open'
    assert 'does not analyse media' in data['limitation']
    assert 'changes no statement' in data['rule']


def test_a_check_note_is_bounded_and_a_findings_page_filters_honestly() -> None:
    client, _ = make_client()
    assert client.post(f'{continuity()}/check', headers=HEADERS, json={'note': 'x' * 401}).status_code == 422
    listed = client.get(f'{continuity()}/findings', headers=HEADERS,
        params={'severity': 'critical', 'state': 'open'}).json()['data']
    assert listed['items'][0]['subject_line'] == 'Marcus - shirt condition'
    assert listed['open_label'] == '1 finding(s) are still open.'
    assert listed['check']['verdict_label'] == 'Conflict'
    assert 'out of date' not in listed['check']['freshness']
    assert client.get(f'{continuity()}/findings', headers=HEADERS, params={'severity': 'urgent'}).status_code == 422
    assert client.get(f'{continuity()}/findings', headers=HEADERS, params={'state': 'approved'}).status_code == 422
    assert client.get(f'{continuity()}/findings', headers=HEADERS, params={'check_id': 'nope'}).status_code == 422


def test_an_out_of_date_check_says_so_instead_of_pretending_to_be_current() -> None:
    client, state = make_client()
    state['findings'] = findings_payload(check={'check_id': CHECK_ONE, 'verdict': 'consistent',
        'counts': {'critical': 0, 'warning': 0, 'info': 0}, 'explanation': 'The recorded continuity statements agree.',
        'limitations': LIMITATION, 'created_at': '2026-10-05T10:00:00Z', 'state_count': 1,
        'state_watermark': '2026-10-05T09:00:00Z', 'is_current': False},
        items=[], total=0, open_count=0)
    data = client.get(f'{continuity()}/findings', headers=HEADERS).json()['data']
    assert data['items'] == []
    assert data['check']['freshness'] == 'The statements changed after this check ran, so it is out of date.'
    assert data['check']['summary'] == 'The recorded continuity statements agree at every point they describe.'
    assert data['open_label'] == 'Nothing is open.'


# ---------------------------------------------------------------- findings and proposals

def test_a_finding_decision_is_recorded_without_approving_anything() -> None:
    client, state = make_client()
    response = client.patch(f'{continuity()}/findings/{FINDING_ONE}', headers=HEADERS,
        json={'state': 'resolved', 'note': 'Reshot the pick-up on Friday.'})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['target_finding'] == FINDING_ONE and payload['desired_state'] == 'resolved'
    assert payload['note_text'] == 'Reshot the pick-up on Friday.'
    assert 'approval are unchanged' in response.json()['data']['note']
    assert client.patch(f'{continuity()}/findings/{FINDING_ONE}', headers=HEADERS,
        json={'state': 'approved'}).status_code == 422
    assert client.patch(f'{continuity()}/findings/{FINDING_ONE}', headers=HEADERS,
        json={'state': 'resolved', 'note': 'x' * 801}).status_code == 422
    assert client.patch(f'{continuity()}/findings/not-a-uuid', headers=HEADERS,
        json={'state': 'resolved'}).status_code == 422


def test_an_inferred_proposal_discloses_its_basis_and_cannot_claim_an_observation() -> None:
    client, state = make_client()
    response = client.post(f'{continuity()}/findings', headers=HEADERS, json={
        'kind': 'unexplained_change', 'domain': 'wardrobe', 'severity': 'warning', 'trait': 'shirt condition',
        'subject_object_id': CHARACTER, 'scene_id': SCENE_FIVE,
        'explanation': 'The wardrobe may not match the injury across the cut.',
        'suggested_resolution': 'Check the Scene 5 continuity photograph.',
        'rationale': 'Two statements disagree and no change is declared.',
        'epistemic': 'estimated', 'confidence': 'low', 'evidence': [{'kind': 'continuity_state', 'object_id': SHOT_TWELVE}]})
    assert response.status_code == 200
    record = state['writes'][-1]['payload']['finding_record']
    assert record['epistemic'] == 'estimated' and record['confidence'] == 'low'
    data = response.json()['data']
    assert data['origin'] == 'inferred'
    assert data['epistemic_label'] == 'Estimated'
    assert 'not a finding of fact' in data['note']
    assert client.post(f'{continuity()}/findings', headers=HEADERS, json={
        'domain': 'wardrobe', 'explanation': 'Fabricated certainty.', 'rationale': 'x',
        'epistemic': 'observed', 'evidence': [{'kind': 'note'}]}).status_code == 422
    assert client.post(f'{continuity()}/findings', headers=HEADERS, json={
        'domain': 'wardrobe', 'explanation': 'No basis.', 'rationale': 'x',
        'epistemic': 'estimated', 'evidence': []}).status_code == 422
    assert client.post(f'{continuity()}/findings', headers=HEADERS, json={
        'domain': 'wardrobe', 'explanation': 'No rationale.', 'epistemic': 'estimated'}).status_code == 422


# ---------------------------------------------------------------- authorization and failure

def test_reads_need_membership_and_writes_need_an_editor() -> None:
    # A viewer is a member: reading is allowed and every write is denied.
    viewer, _ = make_client(role='viewer')
    assert viewer.get(f'{continuity()}/summary', headers=HEADERS).status_code == 200
    assert viewer.get(f'{continuity()}/states', headers=HEADERS).status_code == 200
    assert viewer.get(f'{continuity()}/findings', headers=HEADERS).status_code == 200
    assert viewer.get(f'{continuity()}/chain', headers=HEADERS,
        params={'subject_object_id': CHARACTER}).status_code == 200
    assert viewer.post(f'{continuity()}/check', headers=HEADERS, json={}).status_code == 403
    assert viewer.post(f'{continuity()}/states', headers=HEADERS,
        json={'domain': 'prop', 'trait': 'x', 'value': 'y'}).status_code == 403
    assert viewer.patch(f'{continuity()}/findings/{FINDING_ONE}', headers=HEADERS,
        json={'state': 'resolved'}).status_code == 403
    editor, _ = make_client(role='editor')
    assert editor.post(f'{continuity()}/check', headers=HEADERS, json={}).status_code == 200
    assert editor.post(f'{continuity()}/states', headers=HEADERS,
        json={'domain': 'prop', 'trait': 'x', 'value': 'y'}).status_code == 200
    outsider, _ = make_client(role=None)
    assert outsider.get(f'{continuity()}/summary', headers=HEADERS).status_code == 403


def test_a_cross_workspace_call_becomes_403_and_a_missing_migration_becomes_an_honest_503() -> None:
    client, _ = make_client()
    # Knowing a workspace id is not membership.
    other_workspace = f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/continuity/summary'
    assert client.get(other_workspace, headers=HEADERS).status_code == 403
    # A guard inside the database returns 42501, which is authorization, not a server fault.
    denied = client.get(f'{continuity(production=DENIED_PRODUCTION)}/summary', headers=HEADERS)
    assert denied.status_code == 403
    empty, _ = make_client(no_migration=True)
    response = empty.get(f'{continuity()}/summary', headers=HEADERS)
    assert response.status_code == 503
    body = response.json()
    assert body['errors'][0]['code'] == 'STUDIO_SCHEMA_MISSING'
    assert 'Production continuity' in json.dumps(body)


def test_continuity_requires_an_authenticated_session() -> None:
    client, _ = make_client()
    assert client.get(f'{continuity()}/summary').status_code == 401
    assert client.post(f'{continuity()}/check', json={}).status_code == 401
