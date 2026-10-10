"""Prompt 9A API coverage: dependency graph, impact preview/apply and stale artifacts.

The platform is mocked with httpx.MockTransport. Semantic behaviour (edge direction, derived
edges, bounded/cycle-safe traversal, classification, lock and approval protection, stale
markers) is proven against real embedded PostgreSQL in tests/database/prompt9a-dependencies
.test.mjs; these tests prove the HTTP path - authorization, the exact RPC payload contract,
error translation, and above all that computing an impact and applying one are different
acts: a preview changes nothing, and an apply needs a confirmation plus one of the three
constitutional propagation choices.
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
SHOT_ONE = '00000000-0000-4000-8000-000000000401'
SHOT_TWO = '00000000-0000-4000-8000-000000000402'
SHOT_LOCKED = '00000000-0000-4000-8000-000000000403'
PLAN = '00000000-0000-4000-8000-000000000901'
DOCUMENT = '00000000-0000-4000-8000-000000000a01'
ANALYSIS = '00000000-0000-4000-8000-000000000b01'
MARKER = '00000000-0000-4000-8000-000000000c01'
EDGE_ONE = '00000000-0000-4000-8000-000000000d01'
EDGE_TWO = '00000000-0000-4000-8000-000000000d02'

HEADERS = {'Authorization': 'Bearer verified-test-session'}


def intelligence(production: str = PRODUCTION) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{production}/intelligence'


def node(identifier: str, kind: str, label: str, *, classification: str = 'direct', depth: int = 1,
    relation: str = 'asset', locked: bool = False, approved: bool = False, revision: int = 2) -> dict:
    return {'object_id': identifier, 'level': kind, 'label': label, 'depth': depth, 'relation': relation,
        'classification': classification, 'locked': locked, 'approved': approved, 'revision': revision}


def graph_payload(**overrides) -> dict:
    payload = {
        'root_object_id': CHARACTER, 'root_kind': 'asset', 'root_label': 'Marcus', 'direction': 'forward',
        'depth': 2, 'total': 3, 'truncated': False, 'cycles_safe': True,
        'nodes': [
            node(SHOT_ONE, 'shot', 'Shot 12'),
            node(SHOT_TWO, 'shot', 'Shot 13'),
            node(PLAN, 'execution_plan', 'AI plan for Shot 12', classification='downstream', depth=2,
                relation='execution'),
        ],
        'edges': [{'source_object_id': CHARACTER, 'target_object_id': SHOT_ONE, 'relation': 'asset',
            'strength': 'hard', 'origin': 'derived', 'reason': 'This character binding references the source directly.',
            'affected_fields': ['character'], 'active': True, 'revision': 1}],
        'note': ('Traversal is bounded and cycle-safe. Edges only ever mean: the source is relied upon, '
            'the target depends on it.'),
    }
    payload.update(overrides)
    return payload


def impact_payload(**overrides) -> dict:
    payload = {
        'analysis_id': ANALYSIS, 'root_object_id': CHARACTER, 'root_kind': 'asset', 'root_label': 'Marcus',
        'root_revision': 4, 'structure_revision': 41, 'depth': 2,
        'nodes': [
            node(SHOT_ONE, 'shot', 'Shot 12', revision=4),
            node(SHOT_LOCKED, 'shot', 'Shot 14', locked=True, revision=2),
            node(PLAN, 'execution_plan', 'AI plan for Shot 12', classification='downstream', depth=2,
                relation='execution', revision=3),
        ],
        'counts': {'direct': 2, 'downstream': 1, 'potential': 0, 'locked': 1, 'approved': 0,
            'by_level': {'shot': 2, 'execution_plan': 1}, 'total': 3},
        'locked_ids': [SHOT_LOCKED], 'approved_ids': [],
        'explanation': 'Marcus affects 2 direct objects and 1 downstream object.',
        'applied': False,
        'rule': 'Impact is computed, never applied. Nothing in this Production changed yet.',
    }
    payload.update(overrides)
    return payload


def apply_payload(**overrides) -> dict:
    payload = {
        'analysis_id': ANALYSIS, 'mode': 'update_all', 'marked': 2,
        'locked_skipped': [{'object_id': SHOT_LOCKED, 'label': 'Shot 14',
            'reason': 'The dependent object is locked. Unlock it before TONDE updates it.'}],
        'requiring_review': [{'object_id': DOCUMENT, 'label': 'Scene 18 script', 'revision': 3,
            'reason': 'Approved content is never rewritten silently.'}],
        'direct_count': 2, 'downstream_count': 1, 'unresolved_count': 0,
        'note': 'Affected derived artifacts were marked. Approved content and locked objects were reported, not rewritten.',
    }
    payload.update(overrides)
    return payload


def markers_payload(**overrides) -> dict:
    payload = {
        'items': [
            {'artifact_id': MARKER, 'artifact_kind': 'dependent_object', 'artifact_ref': None,
                'object_id': PLAN, 'object_label': 'AI plan for Shot 12', 'object_kind': 'execution_plan',
                'state': 'stale', 'reason': 'The source Marcus changed after this artifact was derived.',
                'caused_by_object_id': CHARACTER, 'caused_by_label': 'Marcus', 'caused_by_revision': 4,
                'source_revision': 3, 'current_revision': 4, 'resolved_at': None, 'created_at': '2026-10-05T10:00:00Z'},
        ],
        'total': 1, 'open': 1, 'limit': 100, 'offset': 0,
        'note': 'Stale means the artifact may no longer match its source. Nothing was deleted.',
    }
    payload.update(overrides)
    return payload


def edges_payload(**overrides) -> dict:
    payload = {
        'object_id': CHARACTER, 'limit': 100, 'offset': 0,
        'items': [
            {'source_object_id': CHARACTER, 'target_object_id': SHOT_ONE, 'relation': 'asset', 'strength': 'hard',
                'origin': 'derived', 'reason': 'This character binding references the source directly.',
                'affected_fields': ['character'], 'active': True, 'note': '', 'evidence': {}, 'revision': 1,
                'updated_at': '2026-10-05T10:00:00Z', 'source_label': 'Marcus', 'target_label': 'Shot 12'},
            {'source_object_id': CHARACTER, 'target_object_id': SHOT_TWO, 'relation': 'creative', 'strength': 'advisory',
                'origin': 'inferred', 'reason': 'The same wardrobe may matter here too.',
                'affected_fields': ['wardrobe'], 'active': False, 'note': 'Excluded by the creator.', 'evidence': {'confidence': 'low'},
                'revision': 2, 'updated_at': '2026-10-05T10:05:00Z', 'source_label': 'Marcus', 'target_label': 'Shot 13'},
        ],
    }
    payload.update(overrides)
    return payload


def make_client(*, role: str | None = 'owner', no_migration: bool = False, apply_error: tuple[str, str] | None = None,
    audit_analysis_id: str = ANALYSIS):
    state: dict = {'calls': [], 'writes': [], 'graph': graph_payload(), 'impact': impact_payload(),
        'markers': markers_payload(), 'edges': edges_payload()}

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
        if payload.get('target_workspace') == OTHER_WORKSPACE:
            return fail('42501', 'You do not have access to that workspace.')
        if name == 'dependency_sync':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'production_id': PRODUCTION, 'edges_considered': 7,
                'note': 'Derived edges come from real bindings, plans and dialogue. Nothing was inferred here.'})
        if name == 'dependency_edge':
            state['writes'].append({'name': name, 'payload': payload})
            if payload.get('source_object') == payload.get('target_object'):
                return fail('22023', 'An object cannot depend on itself')
            return httpx.Response(200, json={'source_object_id': payload.get('source_object'),
                'target_object_id': payload.get('target_object'), 'relation': payload.get('relation_value'),
                'strength': payload.get('strength_value'), 'origin': payload.get('origin_value'), 'active': True,
                'revision': 1, 'note': 'An inferred edge is a proposal with its rationale, not canonical certainty.'})
        if name == 'dependency_active':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'changed': len(payload.get('edge_ids') or []),
                'active': payload.get('desired_active'),
                'note': 'Edges are deactivated, never deleted: the history of a relationship stays readable.'})
        if name == 'dependency_graph':
            return httpx.Response(200, json=deepcopy(state['graph']) | {
                'direction': payload.get('direction'), 'depth': payload.get('target_depth')})
        if name == 'dependency_edges':
            return httpx.Response(200, json=deepcopy(state['edges']))
        if name == 'impact_preview':
            return httpx.Response(200, json=deepcopy(state['impact']))
        if name == 'impact_history':
            return httpx.Response(200, json={'items': [{'analysis_id': audit_analysis_id, 'root_object_id': CHARACTER,
                'root_label': 'Marcus', 'root_kind': 'asset', 'root_revision': 4, 'structure_revision': 41,
                'mode': 'preview', 'applied_mode': None, 'applied_at': None,
                'counts': {'direct': 2, 'downstream': 1, 'potential': 0, 'locked': 1, 'approved': 0},
                'explanation': 'Marcus affects 2 direct objects and 1 downstream object.', 'unresolved_count': 0,
                'created_at': '2026-10-05T10:00:00Z'}],
                'total': 1, 'limit': 20, 'offset': 0, 'truncated': False})
        if name == 'apply_impact':
            state['writes'].append({'name': name, 'payload': payload})
            if apply_error:
                return fail(*apply_error)
            mode = payload.get('desired_mode')
            body = apply_payload(mode=mode)
            if mode == 'change_only_this':
                body.update({'mode': mode, 'marked': 2, 'locked_skipped': [], 'requiring_review': [],
                    'unresolved_count': 1,
                    'note': 'CHANGE ONLY THIS: the change stayed local and the remaining downstream impact is recorded as unresolved.'})
            if mode == 'review_changes':
                body.update({'mode': mode, 'marked': len(payload.get('selected_ids') or []),
                    'requiring_review': [], 'locked_skipped': [],
                    'note': 'Only the selected dependents were marked.'})
            return httpx.Response(200, json=body)
        if name == 'stale_artifact_list':
            return httpx.Response(200, json=deepcopy(state['markers']))
        if name == 'resolve_stale_artifact':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'artifact_id': payload.get('target_artifact'), 'state': 'current',
                'note': 'The creator resolved this artifact. Historical markers stay readable.'})
        if name == 'mark_stale_artifact':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'artifact_id': MARKER, 'state': 'stale'})
        return httpx.Response(200, json={'applied': True, 'rpc': name})

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_secret_key='service-role-key',
        environment='test', ai_provider='none', ai_provider_api_key=None)
    test_client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    test_client.__enter__()
    return test_client, state


# ---------------------------------------------------------------- authorization

def test_reads_require_workspace_membership() -> None:
    client, _ = make_client(role=None)
    assert client.get(f'{intelligence()}/graph', headers=HEADERS, params={'object_id': CHARACTER}).status_code == 403
    assert client.get(f'{intelligence()}/stale', headers=HEADERS).status_code == 403


def test_writes_require_an_editor_and_reads_do_not() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.get(f'{intelligence()}/stale', headers=HEADERS).status_code == 200
    assert viewer.post(f'{intelligence()}/dependencies/sync', headers=HEADERS).status_code == 403
    assert viewer.post(f'{intelligence()}/impact/preview', headers=HEADERS,
        json={'object_id': CHARACTER}).status_code == 403
    assert viewer.post(f'{intelligence()}/impact/apply', headers=HEADERS,
        json={'analysis_id': ANALYSIS, 'mode': 'update_all', 'confirm': True}).status_code == 403

    editor, _ = make_client(role='editor')
    assert editor.post(f'{intelligence()}/dependencies/sync', headers=HEADERS).status_code == 200


def test_cross_workspace_is_refused_by_the_guard_not_leaked() -> None:
    client, _ = make_client()
    response = client.get(f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/intelligence/stale',
        headers=HEADERS)
    assert response.status_code == 403


def test_unapplied_migration_names_the_production_intelligence_layer() -> None:
    client, _ = make_client(no_migration=True)
    response = client.get(f'{intelligence()}/stale', headers=HEADERS)
    assert response.status_code == 503
    error = response.json()['errors'][0]
    assert error['code'] == 'STUDIO_SCHEMA_MISSING'
    assert 'Production intelligence' in error['message']


# ---------------------------------------------------------------- vocabulary + graph

def test_modes_endpoint_returns_exactly_the_three_constitutional_choices() -> None:
    client, _ = make_client()
    data = client.get(f'{intelligence()}/modes', headers=HEADERS).json()['data']
    assert [item['mode'] for item in data['modes']] == ['update_all', 'review_changes', 'change_only_this']
    assert [item['label'] for item in data['modes']] == ['UPDATE ALL', 'REVIEW CHANGES', 'CHANGE ONLY THIS']
    assert 'computed, never applied' in data['rule']
    assert 'source is relied upon' in data['direction']


def test_graph_read_adds_display_vocabulary_without_recomputing_a_value() -> None:
    client, _ = make_client()
    data = client.get(f'{intelligence()}/graph', headers=HEADERS,
        params={'object_id': CHARACTER, 'direction': 'reverse', 'depth': 3}).json()['data']
    assert data['direction_label'] == 'What this depends on'
    assert data['total_label'] == '3 reachable object(s)'
    first = data['nodes'][0]
    assert first['classification_label'] == 'Direct'
    assert first['level_label'] == 'Shot'
    assert first['relation_label'] == 'Asset binding'
    assert first['status'] == 'Open'
    assert data['nodes'][2]['classification_label'] == 'Downstream'
    assert data['edges'][0]['origin_label'] == 'Derived from your Production'
    assert data['edges'][0]['strength_label'] == 'Hard'
    assert data['cycles_safe'] is True


def test_graph_marks_a_locked_or_approved_dependent_honestly() -> None:
    client, state = make_client()
    state['graph']['nodes'].append(node(DOCUMENT, 'creative_document', 'Scene 18 script', approved=True))
    data = client.get(f'{intelligence()}/graph', headers=HEADERS, params={'object_id': CHARACTER}).json()['data']
    assert [item['status'] for item in data['nodes']] == ['Open', 'Open', 'Open', 'Approved']


def test_graph_rejects_an_unknown_direction_and_bad_identifiers() -> None:
    client, _ = make_client()
    assert client.get(f'{intelligence()}/graph', headers=HEADERS,
        params={'object_id': CHARACTER, 'direction': 'sideways'}).status_code == 422
    assert client.get(f'{intelligence()}/graph', headers=HEADERS,
        params={'object_id': 'not-a-uuid'}).status_code == 422
    assert client.get(f'{intelligence()}/graph', headers=HEADERS).status_code == 422


def test_graph_depth_is_bounded_before_it_reaches_the_database() -> None:
    client, state = make_client()
    client.get(f'{intelligence()}/graph', headers=HEADERS, params={'object_id': CHARACTER, 'depth': 99})
    assert state['calls'][-1]['payload']['target_depth'] == 8
    client.get(f'{intelligence()}/graph', headers=HEADERS, params={'object_id': CHARACTER, 'depth': 0})
    assert state['calls'][-1]['payload']['target_depth'] == 1


# ---------------------------------------------------------------- edges

def test_dependency_sync_sends_the_exact_payload_and_reports_the_edge_count() -> None:
    client, state = make_client()
    response = client.post(f'{intelligence()}/dependencies/sync', headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['edges_considered'] == 7
    assert 'Nothing was inferred here' in data['note']
    payload = state['writes'][-1]['payload']
    assert payload['target_workspace'] == WORKSPACE
    assert payload['target_production'] == PRODUCTION


def test_declared_dependency_sends_relation_strength_origin_and_evidence() -> None:
    client, state = make_client()
    response = client.post(f'{intelligence()}/dependencies', headers=HEADERS, json={
        'source_object_id': CHARACTER, 'target_object_id': SHOT_TWO, 'relation': 'creative', 'strength': 'advisory',
        'origin': 'inferred', 'reason': 'The same wardrobe may matter in the second film.',
        'affected_fields': ['wardrobe', 'wardrobe', ' props '], 'evidence': {'confidence': 'low'}})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['source_object'] == CHARACTER and payload['target_object'] == SHOT_TWO
    assert payload['relation_value'] == 'creative' and payload['strength_value'] == 'advisory'
    assert payload['origin_value'] == 'inferred'
    assert payload['fields_value'] == ['wardrobe', 'props'], 'duplicates are dropped and values trimmed'
    assert payload['evidence_value'] == {'confidence': 'low'}
    assert 'not canonical certainty' in response.json()['data']['note']


def test_declared_dependency_rejects_unsupported_vocabulary_and_a_self_edge() -> None:
    client, _ = make_client()
    base = {'source_object_id': CHARACTER, 'target_object_id': SHOT_TWO}
    assert client.post(f'{intelligence()}/dependencies', headers=HEADERS,
        json=base | {'relation': 'vibes'}).status_code == 422
    assert client.post(f'{intelligence()}/dependencies', headers=HEADERS,
        json=base | {'relation': 'creative', 'strength': 'absolute'}).status_code == 422
    assert client.post(f'{intelligence()}/dependencies', headers=HEADERS,
        json=base | {'relation': 'creative', 'origin': 'guessed'}).status_code == 422
    # A self-edge is a real rule violation, and the curated database message is surfaced as 422.
    self_edge = client.post(f'{intelligence()}/dependencies', headers=HEADERS,
        json={'source_object_id': CHARACTER, 'target_object_id': CHARACTER, 'relation': 'creative'})
    assert self_edge.status_code == 422
    assert self_edge.json()['errors'][0]['message'] == 'An object cannot depend on itself'


def test_deactivating_edges_keeps_the_relationship_as_history() -> None:
    client, state = make_client()
    response = client.patch(f'{intelligence()}/dependencies/active', headers=HEADERS,
        json={'edge_ids': [EDGE_ONE, EDGE_TWO], 'active': False, 'note': 'Shot 13 excluded the wardrobe.'})
    assert response.status_code == 200
    assert response.json()['data']['changed'] == 2
    assert 'deactivated, never deleted' in response.json()['data']['note']
    payload = state['writes'][-1]['payload']
    assert payload['edge_ids'] == [EDGE_ONE, EDGE_TWO] and payload['desired_active'] is False
    assert client.patch(f'{intelligence()}/dependencies/active', headers=HEADERS,
        json={'edge_ids': [], 'active': False}).status_code == 422


def test_edge_list_keeps_an_inactive_edge_readable_with_its_labels() -> None:
    client, _ = make_client()
    data = client.get(f'{intelligence()}/dependencies', headers=HEADERS,
        params={'object_id': CHARACTER}).json()['data']
    active, inactive = data['items']
    assert active['state_label'] == 'Active'
    assert active['relation_label'] == 'Asset binding' and active['strength_label'] == 'Hard'
    assert inactive['state_label'] == 'Inactive (kept as history)'
    assert inactive['origin_label'] == 'Inferred (proposal)'
    assert inactive['evidence'] == {'confidence': 'low'}, 'the rationale survives deactivation'
    assert 'never deleted' in data['note']


# ---------------------------------------------------------------- impact preview

def test_preview_computes_and_records_but_never_applies() -> None:
    client, state = make_client()
    response = client.post(f'{intelligence()}/impact/preview', headers=HEADERS,
        json={'object_id': CHARACTER, 'depth': 3})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['applied'] is False
    assert data['requires_confirmation'] is True
    assert data['analysis_id'] == ANALYSIS
    assert data['total_label'] == '3 affected object(s)'
    assert 'never applied' in data['rule']
    assert [item['label'] for item in data['modes']] == ['UPDATE ALL', 'REVIEW CHANGES', 'CHANGE ONLY THIS']
    payload = state['calls'][-1]['payload']
    assert payload['target_object'] == CHARACTER and payload['target_depth'] == 3
    # Computing an impact must not write a single Production object.
    assert state['writes'] == []


def test_preview_summary_counts_protected_dependents_without_a_percentage() -> None:
    client, _ = make_client()
    data = client.post(f'{intelligence()}/impact/preview', headers=HEADERS,
        json={'object_id': CHARACTER}).json()['data']
    assert data['summary_line'].startswith('Marcus affects 2 direct objects, 1 downstream object.')
    assert '1 locked' in data['summary_line']
    assert data['locked_ids'] == [SHOT_LOCKED]
    assert data['explanation'] == 'Marcus affects 2 direct objects and 1 downstream object.'
    # Readiness-style reporting here is criteria based: real counts, never a vanity score.
    assert '%' not in json.dumps(data)
    assert 'percent' not in json.dumps(data).lower()


def test_preview_validates_its_bounds_and_rejects_a_missing_object_id() -> None:
    client, state = make_client()
    # A body is an explicit request, so an out-of-range depth is refused rather than
    # silently clamped the way a URL query parameter is.
    assert client.post(f'{intelligence()}/impact/preview', headers=HEADERS,
        json={'object_id': CHARACTER, 'depth': 50}).status_code == 422
    assert client.post(f'{intelligence()}/impact/preview', headers=HEADERS,
        json={'object_id': CHARACTER, 'depth': 0}).status_code == 422
    assert client.post(f'{intelligence()}/impact/preview', headers=HEADERS, json={}).status_code == 422
    assert state['writes'] == [], 'a rejected preview records nothing'
    assert client.post(f'{intelligence()}/impact/preview', headers=HEADERS,
        json={'object_id': CHARACTER, 'depth': 8}).status_code == 200
    assert state['calls'][-1]['payload']['target_depth'] == 8


# ---------------------------------------------------------------- impact apply

def test_apply_refuses_an_unconfirmed_propagation_and_never_reaches_the_database() -> None:
    client, state = make_client()
    for mode in ('update_all', 'review_changes', 'change_only_this'):
        response = client.post(f'{intelligence()}/impact/apply', headers=HEADERS,
            json={'analysis_id': ANALYSIS, 'mode': mode, 'selected_ids': [SHOT_ONE]})
        assert response.status_code == 409
        assert response.json()['errors'][0]['code'] == 'IMPACT_CONFIRMATION_REQUIRED'
    assert state['writes'] == [], 'an unconfirmed apply must not call apply_impact at all'


def test_review_changes_needs_the_selected_dependents() -> None:
    client, state = make_client()
    response = client.post(f'{intelligence()}/impact/apply', headers=HEADERS,
        json={'analysis_id': ANALYSIS, 'mode': 'review_changes', 'confirm': True})
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'IMPACT_REVIEW_SELECTION_REQUIRED'
    assert state['writes'] == []


def test_update_all_passes_the_pinned_revision_and_reports_protected_dependents() -> None:
    client, state = make_client()
    response = client.post(f'{intelligence()}/impact/apply', headers=HEADERS,
        json={'analysis_id': ANALYSIS, 'mode': 'update_all', 'confirm': True, 'expected_root_revision': 4,
              'note': 'Marcus is injured from Scene 4.'})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['mode_label'] == 'UPDATE ALL'
    assert data['applied'] is True
    assert data['marked'] == 2
    assert data['locked_skipped'][0]['reason_label'] == 'Protected by a lock'
    assert data['requiring_review'][0]['reason_label'] == 'Needs creator review'
    assert '2 locked dependent(s) were reported instead of changed' not in data['summary_line']
    assert '1 locked dependent(s) were reported instead of changed' in data['summary_line']
    payload = state['writes'][-1]['payload']
    assert payload['target_analysis'] == ANALYSIS
    assert payload['desired_mode'] == 'update_all'
    assert payload['expected_root_revision'] == 4
    assert payload['selected_ids'] == []
    assert payload['note_text'] == 'Marcus is injured from Scene 4.'


def test_review_changes_sends_only_the_selected_dependents() -> None:
    client, state = make_client()
    response = client.post(f'{intelligence()}/impact/apply', headers=HEADERS,
        json={'analysis_id': ANALYSIS, 'mode': 'review_changes', 'selected_ids': [SHOT_ONE, SHOT_ONE],
              'confirm': True})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['selected_ids'] == [SHOT_ONE], 'duplicate selections collapse to one dependent'
    assert response.json()['data']['summary_line'].startswith('1 artifact(s) marked for REVIEW CHANGES')


def test_change_only_this_records_the_unresolved_downstream_impact() -> None:
    client, _ = make_client()
    data = client.post(f'{intelligence()}/impact/apply', headers=HEADERS,
        json={'analysis_id': ANALYSIS, 'mode': 'change_only_this', 'confirm': True}).json()['data']
    assert data['mode_label'] == 'CHANGE ONLY THIS'
    assert data['unresolved_count'] == 1
    assert 'remain unresolved' in data['summary_line']
    assert 'stayed local' in data['note']


def test_apply_rejects_an_unknown_mode_locally() -> None:
    client, state = make_client()
    assert client.post(f'{intelligence()}/impact/apply', headers=HEADERS,
        json={'analysis_id': ANALYSIS, 'mode': 'update_everything', 'confirm': True}).status_code == 422
    assert state['writes'] == []


def test_a_preview_is_single_use_and_is_reported_as_such() -> None:
    client, _ = make_client(apply_error=('23514', 'That impact analysis was already applied'))
    response = client.post(f'{intelligence()}/impact/apply', headers=HEADERS,
        json={'analysis_id': ANALYSIS, 'mode': 'update_all', 'confirm': True})
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'STUDIO_RULE_VIOLATION'
    assert response.json()['errors'][0]['message'] == 'That impact analysis was already applied'


def test_a_stale_analysis_cannot_be_applied_and_asks_for_a_new_preview() -> None:
    client, _ = make_client(apply_error=(
        '40001', 'A dependent object changed since this impact was computed. Preview the impact again.'))
    response = client.post(f'{intelligence()}/impact/apply', headers=HEADERS,
        json={'analysis_id': ANALYSIS, 'mode': 'update_all', 'confirm': True})
    assert response.status_code == 409
    error = response.json()['errors'][0]
    assert error['code'] == 'STUDIO_CONFLICT'
    assert 'changed since this impact was computed' in error['message']


def test_impact_history_reports_snapshots_and_says_they_are_never_overwritten() -> None:
    client, _ = make_client()
    data = client.get(f'{intelligence()}/impact/history', headers=HEADERS).json()['data']
    item = data['items'][0]
    assert item['mode_label'] == 'Preview'
    assert item['applied_mode_label'] == 'Not applied'
    assert item['affected_label'] == '2 direct, 1 downstream'
    assert 'never overwrites this record' in data['note']


# ---------------------------------------------------------------- stale artifacts

def test_stale_list_names_the_kind_the_state_and_the_cause() -> None:
    client, _ = make_client()
    data = client.get(f'{intelligence()}/stale', headers=HEADERS, params={'state': 'stale'}).json()['data']
    item = data['items'][0]
    assert item['artifact_kind_label'] == 'Dependent object'
    assert item['state_label'] == 'Stale'
    assert item['caused_by_label'] == 'Marcus'
    assert data['open_label'] == '1 artifact(s) may no longer match their source.'
    assert 'Nothing was deleted' in data['note']


def test_stale_list_rejects_an_unknown_state_and_maps_an_empty_list_truthfully() -> None:
    client, state = make_client()
    assert client.get(f'{intelligence()}/stale', headers=HEADERS, params={'state': 'nearly'}).status_code == 422
    state['markers'] = markers_payload(items=[], total=0, open=0)
    data = client.get(f'{intelligence()}/stale', headers=HEADERS).json()['data']
    assert data['items'] == []
    assert data['open_label'] == 'Nothing is stale.'


def test_manual_stale_marker_sends_its_kind_reason_and_reference() -> None:
    client, state = make_client()
    response = client.post(f'{intelligence()}/stale', headers=HEADERS, json={
        'object_id': PLAN, 'artifact_kind': 'continuity_state', 'reason': 'Marcus is injured from Scene 4.',
        'reference': SHOT_ONE})
    assert response.status_code == 200
    payload = state['writes'][-1]['payload']
    assert payload['kind_value'] == 'continuity_state'
    assert payload['reason_text'] == 'Marcus is injured from Scene 4.'
    assert payload['reference'] == SHOT_ONE
    assert 'not rewritten' in response.json()['data']['note']
    assert client.post(f'{intelligence()}/stale', headers=HEADERS,
        json={'object_id': PLAN, 'artifact_kind': 'guess', 'reason': 'x'}).status_code == 422
    assert client.post(f'{intelligence()}/stale', headers=HEADERS,
        json={'object_id': PLAN, 'artifact_kind': 'prompt', 'reason': '   '}).status_code == 422


def test_resolving_a_marker_records_the_creator_decision() -> None:
    client, state = make_client()
    response = client.post(f'{intelligence()}/stale/{MARKER}/resolve', headers=HEADERS,
        json={'note': 'Re-derived after the change.'})
    assert response.status_code == 200
    assert response.json()['data']['state'] == 'current'
    payload = state['writes'][-1]['payload']
    assert payload['target_artifact'] == MARKER and payload['note_text'] == 'Re-derived after the change.'
    assert client.post(f'{intelligence()}/stale/{MARKER}/resolve', headers=HEADERS,
        json={'note': 'x' * 500}).status_code == 422
