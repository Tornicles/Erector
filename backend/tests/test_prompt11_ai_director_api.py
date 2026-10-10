"""AI Creation API coverage: the playbook, the compiled prompt and the Result check.

The product law this surface must not break: TONDE is the Director. It documents what an external
tool can do, compiles a prompt for the tool the creator owns, and judges the Result the creator
uploads. It never generates media, never presents an external tool's output as TONDE's own, and
never needs a media-generation credential. The semantic behaviour - the deterministic prompt
compilation, the closed criteria, the self-contradiction refusal, the attempt-to-attempt diff - is
proven against real embedded PostgreSQL in tests/database/prompt11-ai-director.test.mjs. These tests
prove the HTTP path: authorization, the RPC payload contract, and error translation.
"""

from __future__ import annotations

import json

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
SHOT = '00000000-0000-4000-8000-000000000301'
RESULT = '00000000-0000-4000-8000-000000000f01'
PROFILE = '00000000-0000-4000-8000-000000000a01'

HEADERS = {'Authorization': 'Bearer verified-test-session'}
CRITERIA = ['shot_objective', 'subject_identity', 'continuity', 'composition', 'lighting',
    'camera_movement', 'environment', 'wardrobe', 'props', 'performance', 'timing',
    'reference_relationship']


def base() -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}'


def make_client(*, role: str | None = 'owner', no_migration: bool = False, plan_missing: bool = False,
    plan_stale: bool = False, contradictory: bool = False):
    state: dict = {'calls': [], 'writes': []}

    def fail(code: str, message: str = 'Refused') -> httpx.Response:
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
            # The dependency sends a real PostgREST role filter. Reading it, rather than approximating
            # it, is what makes a viewer/editor/admin distinction provable here.
            wanted = request.url.params.get('role') or ''
            if wanted.startswith('in.(') and wanted.endswith(')'):
                if role not in wanted[4:-1].split(','):
                    return httpx.Response(200, json=[])
            elif wanted and wanted != role:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{'role': role}])
        if not path.startswith('/rest/v1/rpc/'):
            return httpx.Response(200, json=[])
        name = path.rsplit('/', 1)[-1]
        payload = json.loads(request.content or b'{}')
        state['calls'].append({'name': name, 'payload': payload})
        if no_migration:
            return fail('PGRST202', name)
        if name == 'ai_director_boundary':
            return httpx.Response(200, json={'product_role': 'director', 'direct_media_generation': False,
                'generation_provider_required': False,
                'ai_creation': 'external tool playbook plus result checking',
                'tonde_generates_final_media': False, 'results_return_to_tonde': True})
        if name == 'ai_tool_catalog':
            return httpx.Response(200, json={'profiles': [
                {'id': PROFILE, 'tool_key': 'veo', 'display_name': 'Veo', 'capability_type': 'video_generation',
                 'media_kind': 'video', 'review_state': 'reviewed'}]})
        if name == 'ai_tool_profile_save':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'id': PROFILE, 'tool_key': payload.get('p_tool_key'),
                'capability_type': 'video_generation', 'review_state': 'draft', 'created': True})
        if name == 'ai_tool_profile_review':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'id': PROFILE, 'tool_key': 'veo',
                'capability_type': 'video_generation', 'review_state': 'reviewed',
                'review_note': payload.get('p_note')})
        if name == 'production_ai_tool_set':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'tool_key': payload.get('p_tool_key'),
                'removed': bool(payload.get('p_remove')), 'kit': []})
        if name == 'ai_playbook_for_shot':
            return httpx.Response(200, json={'shot_id': SHOT, 'shot_title': 'Marcus enters',
                'tool_key': 'veo', 'recommended_tool_key': 'veo',
                'evaluation_criteria': [{'criterion': key} for key in CRITERIA],
                'prompt': 'Camera: slow push in.\nSubject: Marcus, red jacket.',
                'adaptations': [{'tool_key': 'veo', 'adaptation': 'Veo reads duration first.'}],
                'known_gaps': ['Do not claim Veo keeps the jacket red across cuts.'],
                'cost': {'external_tool_estimate': 'single generated clip', 'tonde_cost': 'included',
                    'is_estimate': True}})
        if name == 'ai_playbook_prompt_compile':
            if plan_missing:
                return fail('PT404', "PLAYBOOK_NEEDS_PLAN: this Shot has no AI plan to direct from.")
            if plan_stale:
                return fail('PT409', "The Shot's AI plan changed since you loaded it")
            return httpx.Response(200, json={'shot_id': SHOT, 'tool_key': 'veo',
                'prompt': 'Camera: slow push in.\nDuration: 6s.',
                'prompt_version': 2, 'adaptations': [{'tool_key': 'veo',
                    'adaptation': 'Duration is stated in seconds for Veo.'}],
                'compiled_from_plan_revision': payload.get('p_expected_plan_revision')})
        if name == 'ai_result_check':
            state['writes'].append({'name': name, 'payload': payload})
            if contradictory:
                return fail('PT409', 'CHECK_CONTRADICTS_ITSELF: a material criterion is failing.')
            inner = payload.get('p_payload') or {}
            return httpx.Response(200, json={'check_id': 'check-1', 'shot_id': SHOT, 'result_id': RESULT,
                'verdict': inner.get('verdict'),
                'criteria': [{'criterion': entry.get('criterion'), 'result': entry.get('result'),
                    'severity': entry.get('severity') or 'info'} for entry in inner.get('criteria') or []],
                'instructions': inner.get('instructions'), 'next_prompt': 'Next: keep the jacket red.',
                'what_changed': {'previous_verdict': 'fix'},
                'next_step': 'Run the next prompt in your external tool, then upload the new Result.'})
        if name == 'ai_playbook_history':
            return httpx.Response(200, json={'shot_id': SHOT, 'checks': [
                {'id': 'check-1', 'verdict': 'fix', 'checked_at': '2026-10-05T10:00:00Z'}], 'attempts': []})
        return httpx.Response(200, json={})

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_service_role_key='service-role-key',
        app_env='test')
    client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    client.__enter__()
    return client, state


# ------------------------------------------------------------------ the boundary

def test_the_director_boundary_is_read_from_the_database_not_restated() -> None:
    client, state = make_client()
    data = client.get('/api/v1/ai/director-boundary', headers=HEADERS).json()['data']
    assert data['product_role'] == 'director'
    assert data['direct_media_generation'] is False
    assert data['generation_provider_required'] is False
    assert state['calls'][0] == {'name': 'ai_director_boundary', 'payload': {}}


def test_vocabulary_names_the_closed_criteria_and_refuses_to_pretend_about_media() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/ai/vocabulary', headers=HEADERS).json()['data']
    assert [entry['criterion'] for entry in data['criteria']] == CRITERIA
    assert [entry['verdict'] for entry in data['verdicts']] == ['accept', 'fix']
    assert 'does not render' in data['rule']
    assert 'no "probably fine"' in data['check_rule'] or 'There is no "probably fine"' in data['check_rule']
    assert 'not TONDE' in data['cost_rule']


# ------------------------------------------------------------------ documented tool knowledge

def test_the_catalog_hides_drafts_by_default_and_refuses_an_unknown_capability() -> None:
    client, state = make_client()
    data = client.get(f'{base()}/ai/tools', headers=HEADERS).json()['data']
    assert data['profiles'][0]['capability_label'] == 'Video generation'
    assert data['profiles'][0]['review_state_label'] == 'Reviewed'
    call = next(entry for entry in state['calls'] if entry['name'] == 'ai_tool_catalog')
    assert call['payload'] == {'target_workspace': WORKSPACE, 'p_capability_type': None,
        'p_include_drafts': False}
    assert 'Director' in data['rule']

    refused = client.get(f'{base()}/ai/tools?capability_type=media_generation', headers=HEADERS)
    assert refused.status_code == 422
    assert refused.json()['errors'][0]['code'] == 'INVALID_AI_CREATION_INPUT'


def test_documenting_a_tool_requires_an_editor_and_a_valid_tool_key() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.post(f'{base()}/ai/tools/profiles', headers=HEADERS,
        json={'tool_key': 'veo', 'payload': {'display_name': 'Veo'}}).status_code == 403

    client, state = make_client()
    ok = client.post(f'{base()}/ai/tools/profiles', headers=HEADERS, json={
        'tool_key': 'veo', 'payload': {'display_name': 'Veo', 'capability_type': 'video_generation',
            'media_kind': 'video', 'aspect_ratios': ['16:9'], 'source_title': 'Veo documentation'}})
    assert ok.status_code == 200
    assert ok.json()['data']['review_state_label'] == 'Draft'
    assert ok.json()['data']['is_usable'] is False
    assert state['writes'][0]['payload']['p_tool_key'] == 'veo'
    assert state['writes'][0]['payload']['p_payload']['aspect_ratios'] == ['16:9']

    bad = client.post(f'{base()}/ai/tools/profiles', headers=HEADERS,
        json={'tool_key': 'Veo 3.1', 'payload': {}})
    assert bad.status_code == 422
    assert len(state['writes']) == 1, 'the invalid key never reached the database'


def test_only_an_administrator_reviews_a_profile_and_only_with_a_real_decision() -> None:
    editor, state = make_client(role='editor')
    assert editor.post(f'{base()}/ai/tools/profiles/{PROFILE}/review', headers=HEADERS,
        json={'decision': 'review'}).status_code == 403
    assert state['writes'] == []

    admin, admin_state = make_client(role='admin')
    ok = admin.post(f'{base()}/ai/tools/profiles/{PROFILE}/review', headers=HEADERS,
        json={'decision': 'review', 'note': 'Checked against the manufacturer documentation.'})
    assert ok.status_code == 200
    assert admin_state['writes'][0]['payload']['p_decision'] == 'review'

    refused = admin.post(f'{base()}/ai/tools/profiles/{PROFILE}/review', headers=HEADERS,
        json={'decision': 'approve'})
    assert refused.status_code == 422
    assert len(admin_state['writes']) == 1


def test_the_production_kit_can_name_and_remove_a_tool_without_a_credential() -> None:
    client, state = make_client()
    data = client.post(f'{base()}/ai/tools/kit', headers=HEADERS, json={
        'tool_key': 'veo', 'display_name': 'Veo', 'sort_order': 1}).json()['data']
    assert data['removed'] is False
    payload = state['writes'][0]['payload']
    assert payload['target_production'] == PRODUCTION and payload['p_tool_key'] == 'veo'
    assert 'p_credential' not in payload and 'token' not in json.dumps(payload)


# ------------------------------------------------------------------ the playbook

def test_the_playbook_is_direction_with_an_honest_cost_split() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/shots/{SHOT}/playbook', headers=HEADERS).json()['data']
    assert data['product_role'] == 'director'
    assert data['tonde_generates_final_media'] is False
    assert 'does not run it for you' in data['prompt_intent']
    assert data['evaluation_criteria'][0]['label'] == 'Shot objective'
    assert data['cost']['is_estimate'] is True
    assert data['cost']['tonde_cost'] == 'included'
    assert data['adaptations'][0]['adaptation']


def test_compiling_a_prompt_passes_the_plan_revision_and_reports_what_was_adapted() -> None:
    client, state = make_client()
    data = client.post(f'{base()}/shots/{SHOT}/playbook/prompt', headers=HEADERS,
        json={'tool_key': 'veo', 'expected_plan_revision': 4}).json()['data']
    assert data['compiled_from_plan_revision'] == 4
    assert 'Duration' in data['prompt']
    call = next(entry for entry in state['calls'] if entry['name'] == 'ai_playbook_prompt_compile')
    assert call['payload']['target_shot'] == SHOT and call['payload']['p_tool_key'] == 'veo'


def test_a_shot_with_no_ai_plan_is_told_so_instead_of_a_platform_failure() -> None:
    client, _ = make_client(plan_missing=True)
    response = client.post(f'{base()}/shots/{SHOT}/playbook/prompt', headers=HEADERS, json={})
    assert response.status_code == 404, 'PT404 must not degrade to an unmapped 503'
    error = response.json()['errors'][0]
    assert error['code'] == 'STUDIO_NOT_FOUND'
    assert 'no AI plan' in error['message']


def test_a_stale_plan_is_a_conflict_not_a_retry_forever() -> None:
    client, _ = make_client(plan_stale=True)
    response = client.post(f'{base()}/shots/{SHOT}/playbook/prompt', headers=HEADERS,
        json={'expected_plan_revision': 3})
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'STUDIO_CONFLICT'


def test_history_reports_attempts_and_checks_as_an_append_only_record() -> None:
    client, state = make_client()
    data = client.get(f'{base()}/shots/{SHOT}/playbook/history?limit=10', headers=HEADERS).json()['data']
    assert data['checks'][0]['verdict_label'].startswith('Needs a fix')
    assert 'append-only' in data['note']
    call = next(entry for entry in state['calls'] if entry['name'] == 'ai_playbook_history')
    assert call['payload']['p_limit'] == 10


# ------------------------------------------------------------------ the Result check

def test_a_check_judges_only_the_named_criteria_and_refuses_an_invented_one() -> None:
    client, state = make_client()
    refused = client.post(f'{base()}/shots/{SHOT}/results/{RESULT}/check', headers=HEADERS,
        json={'verdict': 'fix', 'criteria': [{'criterion': 'vibe', 'result': 'fail'}],
            'instructions': 'Less sparkle.'})
    assert refused.status_code == 422
    assert state['writes'] == [], 'nothing reached the database'

    ok = client.post(f'{base()}/shots/{SHOT}/results/{RESULT}/check', headers=HEADERS, json={
        'verdict': 'fix', 'instructions': 'Keep Marcus\u2019s jacket red across the cut.',
        'criteria': [{'criterion': 'continuity', 'result': 'fail', 'severity': 'material',
            'note': 'Jacket changes colour at 00:02.'}]})
    assert ok.status_code == 200
    data = ok.json()['data']
    assert data['verdict_label'].startswith('Needs a fix')
    assert data['criteria'][0]['label'] == 'Continuity'
    assert data['next_step'].startswith('Run the next prompt')
    written = state['writes'][0]['payload']
    assert written['target_result'] == RESULT
    assert written['p_payload']['verdict'] == 'fix'
    assert written['p_payload']['criteria'][0]['severity'] == 'material'


def test_a_fix_with_nothing_to_change_is_refused_before_the_database() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/shots/{SHOT}/results/{RESULT}/check', headers=HEADERS,
        json={'verdict': 'fix', 'criteria': [{'criterion': 'continuity', 'result': 'fail'}]})
    assert response.status_code == 422
    assert response.json()['errors'][0]['message'] == 'A FIX says what to change.'
    assert state['writes'] == []


def test_an_accept_that_contradicts_its_own_material_failure_is_a_conflict() -> None:
    client, _ = make_client(contradictory=True)
    response = client.post(f'{base()}/shots/{SHOT}/results/{RESULT}/check', headers=HEADERS, json={
        'verdict': 'accept', 'criteria': [{'criterion': 'continuity', 'result': 'fail',
            'severity': 'material'}]})
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'STUDIO_CONFLICT'


def test_an_accept_with_no_criteria_is_refused() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/shots/{SHOT}/results/{RESULT}/check', headers=HEADERS,
        json={'verdict': 'accept', 'criteria': []})
    assert response.status_code == 422
    assert state['writes'] == []


def test_a_check_needs_an_editor_and_valid_identifiers() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.post(f'{base()}/shots/{SHOT}/results/{RESULT}/check', headers=HEADERS,
        json={'verdict': 'accept', 'criteria': [{'criterion': 'timing', 'result': 'pass'}]}).status_code == 403

    client, _ = make_client()
    assert client.post(f'{base()}/shots/not-a-uuid/results/{RESULT}/check', headers=HEADERS,
        json={'verdict': 'accept', 'criteria': [{'criterion': 'timing', 'result': 'pass'}]}).status_code == 422


def test_a_deployment_without_the_migration_says_which_layer_is_missing() -> None:
    client, _ = make_client(no_migration=True)
    response = client.get(f'{base()}/ai/tools', headers=HEADERS)
    assert response.status_code == 503
    assert response.json()['errors'][0]['code'] == 'STUDIO_SCHEMA_MISSING'
