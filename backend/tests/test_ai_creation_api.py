"""Prompt 7 AI Creation API coverage: routing, capability truth, prompts, Attempts, callbacks.

The platform is mocked with httpx.MockTransport. Semantic SQL behaviour (capability
verdicts, locks, readiness, idempotency, batch rules, RLS) is proven against real embedded
PostgreSQL in tests/database/prompt7-ai-creation.test.mjs; these tests prove the HTTP path —
routing, authorization, the exact RPC payload contract, error translation, and that TONDE
never claims a capability, a price or a connection it does not have.
"""

from __future__ import annotations

import hashlib
import hmac
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
SHOT_REAL = '00000000-0000-4000-8000-000000000043'
SHOT_LOCKED = '00000000-0000-4000-8000-000000000044'
CHARACTER = '00000000-0000-4000-8000-000000000051'
PRODUCT = '00000000-0000-4000-8000-000000000052'
ATTEMPT_ONE = '00000000-0000-4000-8000-000000000201'
ATTEMPT_TWO = '00000000-0000-4000-8000-000000000202'
BATCH = '00000000-0000-4000-8000-000000000301'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

REF_MODEL = '00000000-0000-4000-8000-000000000401'
CHEAP_MODEL = '00000000-0000-4000-8000-000000000402'
MANUAL_MODEL = '00000000-0000-4000-8000-000000000403'


def ai_shot(shot_id: str, title: str, **overrides) -> dict:
    row = {'shot_id': shot_id, 'scene_id': SCENE_ONE, 'scene_order': 1, 'scene_title': 'Dark kitchen',
        'order': 1024, 'title': title, 'purpose': 'product', 'subject': 'Mara and the coffee bag',
        'framing': 'medium', 'execution_method': 'ai', 'approval': 'draft', 'locked': False,
        'planned_duration_ms': 5000, 'movement': 'slow push in', 'lighting_intent': 'single soft window',
        'readiness': 'needs_reference', 'plan_status': None, 'plan_revision': None,
        'character_lock': 'unlocked', 'world_lock': 'unlocked', 'product_lock': 'unlocked',
        'attempts': 0, 'selected_attempt_id': None, 'revision': 3}
    row.update(overrides)
    return row


def declared(model_profile_id: str, provider_key: str, model_key: str, **overrides) -> dict:
    row = {'model_profile_id': model_profile_id, 'provider_key': provider_key, 'model_key': model_key,
        'label': f'{provider_key} {model_key}', 'operation': 'video', 'capability_state': 'SUPPORTED',
        'supports_image_reference': False, 'max_reference_images': None, 'supports_first_frame': False,
        'supports_last_frame': False, 'supports_seed': False, 'supports_negative_prompt': False,
        'supports_camera_control': False, 'supports_audio': False, 'max_duration_ms': None,
        'aspect_ratios': [], 'resolutions': [], 'cost_unit': '', 'cost_known': False, 'cost_amount': None,
        'cost_currency': '', 'speed_note': '', 'identity_note': '', 'product_fidelity_note': '',
        'availability': 'available', 'connected': True}
    row.update(overrides)
    return row


def make_client(*, role: str | None = 'owner', models: list[dict] | None = None,
    shot: dict | None = None, locks: list[dict] | None = None, references: list[dict] | None = None,
    attempts: list[dict] | None = None, no_migration: bool = False, callback_secret: str | None = None,
    batch_error: str | None = None):
    detail_shot = shot or ai_shot(SHOT_ONE, 'Bag reveal')
    state: dict = {
        'production': {'id': PRODUCTION, 'workspace_id': WORKSPACE, 'title': 'Ridgeway coffee',
            'production_type': 'commercial', 'execution_method': 'hybrid', 'planned_duration_ms': 30000,
            'aspect_ratio': '9:16', 'approval': 'draft', 'locked_at': None, 'revision': 7,
            'lifecycle': 'active', 'updated_at': '2026-10-05T00:00:00Z'},
        'scene': {'scene_id': SCENE_ONE, 'title': 'Dark kitchen', 'purpose': 'Earn attention'},
        'shot': detail_shot,
        'brief': None, 'script_line': None, 'real_plan': None,
        'locks': locks or [], 'references': references or [],
        'attempts': attempts or [], 'selected_attempt_id': None,
        'models': models if models is not None else [],
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
        state['rpc_calls'].append({'name': name, 'payload': payload})
        if payload.get('target_workspace') not in (WORKSPACE, None):
            return fail('42501', 'You do not have access to that workspace.')
        if no_migration:
            return fail('PGRST202', name)
        if name in ('ai_creation_surface',):
            return httpx.Response(200, json={'production': deepcopy(state['production']),
                'shots': [deepcopy(state['shot'])], 'setup': [], 'locks': deepcopy(state['locks']),
                'capabilities': {'live_generation': False, 'declared_models': len(state['models'])},
                'truthfulness': 'Capability is what you declared.'})
        if name == 'ai_shot_detail':
            return httpx.Response(200, json={'shot': deepcopy(state['shot']), 'scene': deepcopy(state['scene']),
                'production': deepcopy(state['production']), 'brief': state['brief'],
                'script_line': state['script_line'], 'real_plan': state['real_plan'],
                'locks': deepcopy(state['locks']), 'references': deepcopy(state['references']),
                'attempts': deepcopy(state['attempts']), 'selected_attempt_id': state['selected_attempt_id'],
                'plan': None, 'readiness': state['shot'].get('readiness')})
        if name == 'ai_model_catalog':
            return httpx.Response(200, json={'providers': [{'provider_key': 'runway', 'label': 'Runway'}],
                'models': deepcopy(state['models'])})
        if name in ('declare_ai_model', 'set_ai_connection', 'set_ai_lock', 'set_ai_plan_approval',
                'set_ai_plan_lock', 'confirm_ai_cost', 'save_ai_plan', 'select_ai_result',
                'record_ai_batch_item'):
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'applied': True, 'rpc': name})
        if name == 'create_ai_attempt':
            state['writes'].append({'name': name, 'payload': payload})
            if payload.get('payload', {}).get('idempotency_key') == 'retry-key-0001':
                return httpx.Response(200, json={'attempt_id': ATTEMPT_ONE, 'status': 'submitted',
                    'idempotent': True, 'billed': False})
            return httpx.Response(200, json={'attempt_id': ATTEMPT_ONE, 'status': 'submitted',
                'idempotent': False, 'billed': True})
        if name == 'update_ai_attempt':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'attempt_id': payload.get('target_attempt'), 'updated': True})
        if name == 'ai_batch_preview':
            return httpx.Response(200, json={'scope': 'scene', 'shots': 5, 'blocked': 2,
                'estimated_cost': None, 'cost_state': 'unknown', 'confirmation_required': True,
                'shots_ready': 3})
        if name == 'create_ai_batch':
            if batch_error:
                return fail(batch_error, 'This batch needs your confirmation before paid generation.')
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'batch_id': BATCH, 'state': 'open', 'items': 5})
        if name == 'update_studio_shot':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'shot_id': payload.get('target_shot'),
                'execution_method': payload.get('patch', {}).get('execution_method'),
                'revision': 4, 'identifier_unchanged': True})
        return fail('PGRST202', name)

    settings = Settings(supabase_url='https://platform.test', supabase_publishable_key=SecretStr('publishable'),
        director_provider='unconfigured',
        ai_callback_secrets={'runway': SecretStr(callback_secret)} if callback_secret else {})
    application = create_app(settings=settings, transport=httpx.MockTransport(platform))
    client = TestClient(application)
    client.__enter__()
    return client, state


def body_of(response) -> dict:
    return response.json()['data']


def error_code(response) -> str:
    """The envelope carries a list of curated errors; the code is what the UI switches on."""

    return response.json()['errors'][0]['code']


def test_surface_reports_truth_and_no_fake_live_generation():
    client, _ = make_client()
    response = client.get(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/surface', headers=HEADERS)
    assert response.status_code == 200
    data = body_of(response)
    assert data['live_generation'] is False
    assert data['provider']['configured'] is False
    assert 'COST UNKNOWN' in data['truthfulness']
    assert data['production']['id'] == PRODUCTION


def test_surface_denies_a_non_member():
    client, _ = make_client(role=None)
    response = client.get(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/surface', headers=HEADERS)
    assert response.status_code in (403, 404)


def test_direct_shot_answers_without_any_declared_model():
    client, _ = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/direct',
        headers=HEADERS, json={'continuity': {'key_props': ['coffee bag']}})
    assert response.status_code == 200
    data = body_of(response)
    assert data['applied'] is None
    assert data['routing']['recommended'] is None
    assert data['routing']['manual_export'] is not None
    assert data['plan']['plan_status'] == 'needs_decision'
    assert data['answer']['why']
    assert data['plan']['provider_prompt']
    assert len(data['plan']['canonical_prompt']) >= 8
    assert 'COST UNKNOWN' not in json.dumps(data['plan'].get('cost_note')) or not data['plan'].get('cost_amount')


def test_manual_export_is_always_offered():
    client, _ = make_client(models=[declared(REF_MODEL, 'runway', 'gen-4', supports_image_reference=True)])
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/direct',
        headers=HEADERS, json={})
    data = body_of(response)
    kinds = [item['kind'] for item in data['routing']['alternatives']]
    assert 'MANUAL EXPORT OPTION' in kinds
    assert data['routing']['manual_export']['reason']


def test_character_heavy_shot_does_not_route_to_the_cheapest_text_only_model():
    models = [
        declared(CHEAP_MODEL, 'runway', 'fast-cheap', cost_known=True, cost_amount=0.05, cost_currency='USD'),
        declared(REF_MODEL, 'runway', 'gen-4-reference', supports_image_reference=True, max_reference_images=3,
            identity_note='strong identity adherence', cost_known=True, cost_amount=0.9, cost_currency='USD'),
    ]
    client, _ = make_client(models=models)
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/direct',
        headers=HEADERS, json={'continuity': {'identity_importance': 'critical'},
            'references': [{'role': 'face', 'priority': 'MUST PRESERVE', 'asset_id': CHARACTER}]})
    data = body_of(response)
    assert data['routing']['recommended']['model_key'] == 'gen-4-reference'
    assert data['routing']['recommended']['cost_state'] == 'known'
    reasons = data['routing']['recommended']['reason'] + ' ' + data['answer']['why']
    assert 'reference' in reasons.lower() or 'identity' in reasons.lower()


def test_requires_connection_is_reported_as_connection_required():
    models = [declared(MANUAL_MODEL, 'kling', 'kling-2', capability_state='REQUIRES CONNECTION',
        connected=False, supports_image_reference=True)]
    client, _ = make_client(models=models)
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/direct',
        headers=HEADERS, json={})
    data = body_of(response)
    assert data['routing']['recommended'] is None
    assert data['routing']['connection_required'] is True
    assert data['plan']['plan_status'] == 'needs_decision'


def test_direct_applies_through_the_guarded_plan_rpc():
    models = [declared(REF_MODEL, 'runway', 'gen-4-reference', supports_image_reference=True,
        supports_first_frame=True, max_duration_ms=10000)]
    client, state = make_client(models=models)
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/direct',
        headers=HEADERS, json={'expected_shot_revision': 3,
            'hybrid': {'apply': True},
            'references': [{'role': 'product', 'priority': 'MUST PRESERVE', 'asset_id': PRODUCT}]})
    assert response.status_code == 200
    data = body_of(response)
    assert data['applied'] is not None
    write = next(item for item in state['writes'] if item['name'] == 'save_ai_plan')
    assert write['payload']['expected_shot_revision'] == 3
    assert write['payload']['plan']['provider_target'] == 'runway'
    assert write['payload']['plan']['canonical_prompt']['SUBJECT']
    assert write['payload']['references_json'][0]['role'] == 'product'


def test_save_plan_rpc_contract():
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/plan',
        headers=HEADERS, json={'expected_shot_revision': 5, 'expected_plan_revision': 2,
            'plan_status': 'ready', 'aspect_ratio': '9:16', 'expected_duration_ms': 5000,
            'canonical_prompt': {'SUBJECT': 'Mara'}, 'provider_prompt': 'A slow push in on Mara.'})
    assert response.status_code == 200
    write = state['writes'][-1]
    assert write['name'] == 'save_ai_plan'
    assert write['payload']['expected_plan_revision'] == 2
    assert write['payload']['plan']['aspect_ratio'] == '9:16'
    assert write['payload']['plan']['expected_duration_ms'] == 5000


def test_unknown_cost_stays_unknown_never_zero():
    models = [declared(REF_MODEL, 'runway', 'gen-4', supports_image_reference=True)]
    client, _ = make_client(models=models)
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/direct',
        headers=HEADERS, json={})
    data = body_of(response)
    assert data['routing']['recommended']['cost_state'] == 'unknown'
    assert data['routing']['recommended']['cost_amount'] is None
    assert data['plan']['cost_amount'] is None


def test_declared_cost_is_carried_when_the_workspace_declared_one():
    models = [declared(REF_MODEL, 'runway', 'gen-4', supports_image_reference=True, cost_known=True,
        cost_amount=0.75, cost_currency='USD', cost_unit='generation')]
    client, _ = make_client(models=models)
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/direct',
        headers=HEADERS, json={})
    data = body_of(response)
    assert data['plan']['cost_amount'] == 0.75
    assert data['plan']['cost_currency'] == 'USD'


def test_a_real_shot_has_no_ai_plan_and_says_so():
    client, _ = make_client(shot=ai_shot(SHOT_REAL, 'Practical pour', execution_method='real'))
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_REAL}/direct',
        headers=HEADERS, json={})
    assert response.status_code == 422
    assert error_code(response) == 'INVALID_AI_INPUT'


def test_a_locked_shot_refuses_ai_plan_changes():
    client, _ = make_client(shot=ai_shot(SHOT_LOCKED, 'Locked bag reveal', locked=True))
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_LOCKED}/direct',
        headers=HEADERS, json={})
    assert response.status_code == 409
    assert error_code(response) == 'SHOT_LOCKED'


def test_an_undeclared_model_is_refused_rather_than_imagined():
    client, _ = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/direct',
        headers=HEADERS, json={'model_profile_id': REF_MODEL})
    assert response.status_code == 422
    assert error_code(response) == 'INVALID_AI_INPUT'


def test_invalid_shot_identifier_is_validation_not_a_crash():
    client, _ = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/not-a-uuid/direct',
        headers=HEADERS, json={})
    assert response.status_code == 422


def test_create_attempt_passes_the_idempotency_key_and_reports_dedupe():
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/attempts',
        headers=HEADERS, json={'idempotency_key': 'retry-key-0001', 'provider_key': 'runway',
            'model_key': 'gen-4', 'mode': 'live', 'status': 'submitted', 'operation': 'video'})
    assert response.status_code == 200
    data = body_of(response)
    assert data['idempotent'] is True
    write = state['writes'][-1]
    assert write['payload']['payload']['idempotency_key'] == 'retry-key-0001'
    assert write['payload']['target_shot'] == SHOT_ONE


def test_attempt_update_records_failure_and_retryability():
    client, state = make_client()
    response = client.post(
        f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/attempts/{ATTEMPT_ONE}',
        headers=HEADERS, json={'status': 'failed', 'failure_code': 'rate_limited', 'retryable': True,
            'failure_message': 'Rate limited by the provider.'})
    assert response.status_code == 200
    write = state['writes'][-1]
    assert write['payload']['payload']['failure_code'] == 'rate_limited'
    assert write['payload']['payload']['retryable'] is True
    assert write['payload']['target_attempt'] == ATTEMPT_ONE


def test_select_result_targets_the_same_canonical_shot():
    client, state = make_client()
    response = client.post(
        f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/results/{ATTEMPT_TWO}/select',
        headers=HEADERS)
    assert response.status_code == 200
    write = state['writes'][-1]
    assert write['name'] == 'select_ai_result'
    assert write['payload']['target_shot'] == SHOT_ONE
    assert write['payload']['target_attempt'] == ATTEMPT_TWO


def test_batch_preview_reports_unknown_cost_and_confirmation():
    client, _ = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/batches/preview',
        headers=HEADERS, json={'scope': 'scene', 'scene_id': SCENE_ONE})
    assert response.status_code == 200
    data = body_of(response)
    assert data['cost_state'] == 'unknown'
    assert data['estimated_cost'] is None
    assert data['confirmation_required'] is True
    assert data['blocked'] == 2


def test_batch_creation_without_confirmation_is_refused_by_the_database_rule():
    client, _ = make_client(batch_error='23514')
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/batches',
        headers=HEADERS, json={'scope': 'scene', 'scene_id': SCENE_ONE, 'confirmed': False})
    assert response.status_code == 409
    assert error_code(response) == 'STUDIO_RULE_VIOLATION'


def test_batch_item_records_partial_progress_for_one_shot():
    client, state = make_client()
    response = client.post(
        f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/batches/{BATCH}/shots/{SHOT_ONE}',
        headers=HEADERS, json={'state': 'succeeded', 'attempt_id': ATTEMPT_ONE})
    assert response.status_code == 200
    write = state['writes'][-1]
    assert write['name'] == 'record_ai_batch_item'
    assert write['payload']['target_batch'] == BATCH
    assert write['payload']['payload']['state'] == 'succeeded'


def test_hybrid_decision_is_advisory_and_switch_is_the_same_shot():
    client, state = make_client(models=[declared(REF_MODEL, 'runway', 'gen-4', supports_image_reference=True)])
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/hybrid',
        headers=HEADERS, json={'execution_method': 'shoot', 'reason': 'We have the kitchen booked.',
            'expected_shot_revision': 3})
    assert response.status_code == 200
    data = body_of(response)
    assert data['advisory'] is True
    assert data['shot_id'] == SHOT_ONE
    write = state['writes'][-1]
    assert write['name'] == 'update_studio_shot'
    assert write['payload']['patch'] == {'execution_method': 'shoot'}
    assert write['payload']['target_shot'] == SHOT_ONE
    assert data['override_recorded']['identifier_unchanged'] is True


def test_hybrid_advice_without_a_revision_changes_nothing():
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/hybrid',
        headers=HEADERS, json={'execution_method': 'generate'})
    data = body_of(response)
    assert data['override_recorded'] is None
    assert data['recommended']['method'] in ('shoot', 'generate', 'hybrid')
    assert not [item for item in state['writes'] if item['name'] == 'update_studio_shot']


def test_hybrid_recommends_shoot_plus_ai_for_a_reflective_branded_product():
    client, _ = make_client(shot=ai_shot(SHOT_ONE, 'Hero bag', execution_method='hybrid'))
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/hybrid',
        headers=HEADERS, json={'execution_method': 'hybrid'})
    data = body_of(response)
    assert data['recommended']['method'] in ('shoot', 'hybrid')
    assert data['recommended']['reasons']


def test_callback_without_a_configured_secret_is_never_applied():
    client, state = make_client()
    payload = json.dumps({'status': 'succeeded', 'job_id': 'job-1', 'attempt_id': ATTEMPT_ONE,
        'output': {'media_id': None, 'mime_type': 'video/mp4', 'duration_ms': 5000}}).encode()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/callbacks/runway',
        headers={**HEADERS, 'Content-Type': 'application/json', 'x-tonde-signature': 'deadbeef'}, content=payload)
    assert response.status_code == 200
    data = body_of(response)
    assert data['accepted'] is False
    assert data['signature_verified'] is False
    assert data['applied'] is None
    assert not [item for item in state['writes'] if item['name'] == 'update_ai_attempt']


def test_callback_with_a_valid_signature_is_applied():
    client, state = make_client(callback_secret='shared-secret')
    payload = json.dumps({'status': 'succeeded', 'job_id': 'job-1', 'attempt_id': ATTEMPT_ONE,
        'output': {'media_id': None, 'mime_type': 'video/mp4', 'duration_ms': 5000}}).encode()
    signature = hmac.new(b'shared-secret', payload, hashlib.sha256).hexdigest()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/callbacks/runway',
        headers={**HEADERS, 'Content-Type': 'application/json', 'x-tonde-signature': signature}, content=payload)
    assert response.status_code == 200
    data = body_of(response)
    assert data['accepted'] is True
    assert data['signature_verified'] is True
    write = state['writes'][-1]
    assert write['name'] == 'update_ai_attempt'
    assert write['payload']['payload']['status'] == 'succeeded'
    assert write['payload']['payload']['external_job_id'] == 'job-1'


def test_callback_with_a_wrong_signature_is_declined():
    client, _ = make_client(callback_secret='shared-secret')
    payload = json.dumps({'status': 'succeeded', 'job_id': 'job-1', 'attempt_id': ATTEMPT_ONE,
        'output': {'mime_type': 'video/mp4'}}).encode()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/callbacks/runway',
        headers={**HEADERS, 'Content-Type': 'application/json', 'x-tonde-signature': 'nope'}, content=payload)
    assert response.status_code == 200
    assert body_of(response)['accepted'] is False


def test_callback_with_an_unusable_payload_is_rejected_before_it_is_believed():
    client, _ = make_client(callback_secret='shared-secret')
    payload = json.dumps({'status': 'finished', 'job_id': 'job-1'}).encode()
    signature = hmac.new(b'shared-secret', payload, hashlib.sha256).hexdigest()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/callbacks/runway',
        headers={**HEADERS, 'Content-Type': 'application/json', 'x-tonde-signature': signature}, content=payload)
    assert response.status_code == 422
    assert error_code(response) == 'AI_PROVIDER_PAYLOAD_INVALID'


def test_cross_workspace_rpc_denial_is_a_403_not_a_leak():
    client, _ = make_client()
    response = client.get(
        f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/ai/surface', headers=HEADERS)
    assert response.status_code in (403, 404)


def test_missing_migration_is_reported_as_such_not_as_a_generic_failure():
    client, _ = make_client(no_migration=True)
    response = client.get(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/surface', headers=HEADERS)
    assert response.status_code == 503
    assert error_code(response) == 'STUDIO_SCHEMA_MISSING'


def test_editor_is_required_to_declare_a_model():
    client, _ = make_client(role='viewer')
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/models',
        headers=HEADERS, json={'provider_key': 'runway', 'model_key': 'gen-4', 'capability_state': 'SUPPORTED'})
    assert response.status_code == 403
    assert error_code(response) == 'WORKSPACE_ACCESS_DENIED'


def test_declared_model_payload_reaches_the_rpc_exactly():
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/models',
        headers=HEADERS, json={'provider_key': 'runway', 'model_key': 'gen-4', 'label': 'Gen-4',
            'capability_state': 'SUPPORTED', 'supports_image_reference': True, 'max_reference_images': 3,
            'max_duration_ms': 10000, 'expected_revision': 2})
    assert response.status_code == 200
    write = state['writes'][-1]
    assert write['name'] == 'declare_ai_model'
    assert write['payload']['payload']['model_key'] == 'gen-4'
    assert write['payload']['payload']['max_reference_images'] == 3
    assert 'expected_revision' not in write['payload']['payload']
    assert write['payload']['expected_revision'] == 2


def test_connection_rejects_a_literal_credential():
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/connections',
        headers=HEADERS, json={'provider_key': 'runway', 'state': 'connected',
            'credential_reference': 'sk-live-abc123'})
    assert response.status_code == 422
    assert error_code(response) == 'INVALID_AI_INPUT'
    assert not [item for item in state['writes'] if item['name'] == 'set_ai_connection']


def test_connection_accepts_a_reference_to_a_secret():
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/connections',
        headers=HEADERS, json={'provider_key': 'runway', 'state': 'connected',
            'credential_reference': 'vault://studio/runway', 'expected_revision': 4})
    assert response.status_code == 200
    write = state['writes'][-1]
    assert write['name'] == 'set_ai_connection'
    assert write['payload']['credential_reference'] == 'vault://studio/runway'
    assert write['payload']['target_provider'] == 'runway'


def test_lock_request_records_prohibited_changes_and_priorities():
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/locks',
        headers=HEADERS, json={'scope': 'character', 'subject_id': CHARACTER, 'locked': True,
            'priority': 'MUST PRESERVE', 'locked_traits': ['face', 'hairline'],
            'prohibited_changes': ['face', 'age presentation'], 'expected_revision': 3})
    assert response.status_code == 200
    write = state['writes'][-1]
    assert write['name'] == 'set_ai_lock'
    assert write['payload']['payload']['prohibited_changes'] == ['face', 'age presentation']
    assert write['payload']['expected_revision'] == 3


def test_cost_confirmation_is_explicit_and_named():
    client, state = make_client()
    response = client.post(f'/api/v1/workspaces/{WORKSPACE}/productions/{PRODUCTION}/ai/shots/{SHOT_ONE}/cost/confirm',
        headers=HEADERS, json={'note': 'Three takes at the declared unit price.'})
    assert response.status_code == 200
    assert state['writes'][-1]['name'] == 'confirm_ai_cost'
    assert 'Three takes' in state['writes'][-1]['payload']['note']
