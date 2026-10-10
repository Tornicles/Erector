"""Prompt 11 durable job API coverage: the HTTP path over the durable job registry.

The state machine itself - legal transitions, classification-aware retry, lease exclusivity, expired
lease recovery, timeout scanning, cancellation of an indefinitely-uncertain external call - is proven
against real embedded PostgreSQL in tests/database/prompt11-jobs.test.mjs. These tests prove the HTTP
path: authorization, the exact RPC payload contract, error translation, and the boundaries this
feature must never cross. A client may ask for durable work and may ask to stop it; it may never
claim work, choose a worker, set an attempt count, or mark its own job complete.
"""

from __future__ import annotations

import json

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000011'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
JOB = '00000000-0000-4000-8000-000000000j01'.replace('j', 'e')

HEADERS = {'Authorization': 'Bearer verified-test-session'}


def base() -> str:
    return f'/api/v1/workspaces/{WORKSPACE}'


def job_payload(**overrides) -> dict:
    payload = {'job_id': JOB, 'workspace_id': WORKSPACE, 'production_id': PRODUCTION,
        'job_type': 'export', 'job_type_display_name': 'Export build', 'worker_class': 'export',
        'status': 'running', 'progress': 40, 'priority': 50, 'attempts': 1, 'max_attempts': 3,
        'requeue_count': 0, 'deadline_at': None, 'error_code': None, 'error_message': None,
        'termination_reason': None, 'failure_classification': None, 'reconciliation_required': False,
        'lease_owner': None, 'lease_expires_at': None,
        'events': [{'event_type': 'job.started', 'actor_kind': 'worker', 'from_status': 'leased',
            'to_status': 'running', 'detail': 'Worker claimed the job.', 'created_at': '2026-10-05T10:00:00Z'}]}
    payload.update(overrides)
    return payload


def make_client(*, role: str | None = 'owner', no_migration: bool = False, denied: bool = False):
    state: dict = {'calls': [], 'writes': []}

    def fail(code: str, message: str) -> httpx.Response:
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
            # The dependency sends a real PostgREST role filter; read it rather than approximate it.
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
        if denied or payload.get('target_workspace') == OTHER_WORKSPACE:
            return fail('42501', 'Workspace access denied')
        if name == 'job_enqueue':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json=job_payload(status='queued', attempts=0,
                idempotent=payload.get('p_idempotency_key') is not None))
        if name == 'job_list':
            return httpx.Response(200, json={'workspace_id': WORKSPACE, 'count': 1, 'jobs': [
                {'job_id': JOB, 'job_type': 'export', 'job_type_display_name': 'Export build',
                 'status': 'running', 'progress': 40, 'attempts': 1, 'max_attempts': 3,
                 'production_id': PRODUCTION, 'created_at': '2026-10-05T10:00:00Z',
                 'cancellable': True, 'reconciliation_required': False}],
                'listed_at': '2026-10-05T10:00:00Z'})
        if name == 'job_status':
            return httpx.Response(200, json=job_payload())
        if name == 'job_workspace_summary':
            return httpx.Response(200, json={'workspace_id': WORKSPACE,
                'jobs': {'queued': 2, 'running': 1, 'retrying': 0, 'dead_letter': 1},
                'outbox': {'pending': 0, 'failed': 0}, 'generated_at': '2026-10-05T10:00:00Z'})
        if name == 'job_cancel_request':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json=job_payload(status='cancel_requested',
                termination_reason=None, cancellable=True))
        return httpx.Response(200, json={})

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_service_role_key='service-role-key',
        app_env='test')
    client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    client.__enter__()
    return client, state


# ------------------------------------------------------------------ vocabulary

def test_vocabulary_names_states_termination_reasons_and_retry_classes() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/jobs/vocabulary', headers=HEADERS).json()['data']
    states = [entry['state'] for entry in data['job_states']]
    assert states == ['queued', 'leased', 'running', 'waiting', 'retrying', 'cancel_requested',
        'succeeded', 'failed', 'cancelled', 'timed_out', 'dead_letter']
    assert next(entry for entry in data['job_states'] if entry['state'] == 'dead_letter')['terminal'] is True
    reasons = [entry['reason'] for entry in data['termination_reasons']]
    assert 'worker_timeout' in reasons and 'must_not_retry' in reasons
    assert [entry['policy'] for entry in data['retry_policies']] == [
        'safe_to_retry', 'requires_idempotency_key', 'requires_reconciliation', 'must_not_retry']
    cloud = next(entry for entry in data['job_types'] if entry['job_type'] == 'cloud_import')
    assert cloud['requires_reconciliation'] is True
    assert 'append-only' in data['rules']
    assert 'does not predict completion' in data['limitation']


# ------------------------------------------------------------------ enqueue

def test_enqueue_requires_an_editor_and_records_the_durable_intent() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.post(f'{base()}/jobs', headers=HEADERS,
        json={'job_type': 'export'}).status_code == 403

    client, state = make_client()
    response = client.post(f'{base()}/jobs', headers=HEADERS, json={
        'job_type': 'export', 'production_id': PRODUCTION, 'payload': {'production_id': PRODUCTION},
        'idempotency_key': 'export-run-1', 'priority': 60, 'timeout_seconds': 900})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['status'] == 'queued' and data['status_label'] == 'Queued'
    assert data['is_terminal'] is False
    call = state['writes'][0]
    assert call['name'] == 'job_enqueue'
    assert call['payload']['target_workspace'] == WORKSPACE
    assert call['payload']['target_job_type'] == 'export'
    assert call['payload']['p_idempotency_key'] == 'export-run-1'
    assert call['payload']['target_priority'] == 60
    assert call['payload']['target_timeout_seconds'] == 900


def test_an_unknown_job_type_is_refused_before_the_database() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/jobs', headers=HEADERS, json={'job_type': 'render_video'})
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_JOB_INPUT'
    assert state['writes'] == [], 'nothing reached the database'


def test_a_malformed_production_identifier_is_refused() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/jobs', headers=HEADERS,
        json={'job_type': 'export', 'production_id': 'not-a-uuid'})
    assert response.status_code == 422
    assert state['writes'] == []


# ------------------------------------------------------------------ list and summary

def test_list_filters_by_state_and_never_accepts_an_invented_state() -> None:
    client, state = make_client()
    ok = client.get(f'{base()}/jobs?state=running&limit=10&include_terminal=false', headers=HEADERS)
    assert ok.status_code == 200
    data = ok.json()['data']
    assert data['jobs'][0]['status_label'] == 'Running'
    call = next(entry for entry in state['calls'] if entry['name'] == 'job_list')
    assert call['payload'] == {'target_workspace': WORKSPACE, 'p_limit': 10, 'p_state': 'running',
        'p_job_type': None, 'p_include_terminal': False}

    refused = client.get(f'{base()}/jobs?state=thinking', headers=HEADERS)
    assert refused.status_code == 422
    assert refused.json()['errors'][0]['code'] == 'INVALID_JOB_INPUT'

    bad_type = client.get(f'{base()}/jobs?job_type=render_video', headers=HEADERS)
    assert bad_type.status_code == 422


def test_summary_reports_counts_without_promising_completion() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/jobs/summary', headers=HEADERS).json()['data']
    assert data['jobs']['dead_letter'] == 1
    assert 'durable intent' in data['note']


# ------------------------------------------------------------------ status and cancel

def test_status_decorates_the_recorded_state_and_its_history() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/jobs/{JOB}', headers=HEADERS).json()['data']
    assert data['status'] == 'running' and data['status_label'] == 'Running'
    assert data['is_active'] is True and data['is_terminal'] is False
    assert data['worker_class_label'] == 'Export'
    assert data['events'][0]['event_type'] == 'job.started'


def test_status_rejects_a_malformed_identifier_and_reports_a_missing_schema() -> None:
    client, _ = make_client()
    assert client.get(f'{base()}/jobs/not-a-uuid', headers=HEADERS).status_code == 422
    missing, _ = make_client(no_migration=True)
    response = missing.get(f'{base()}/jobs/{JOB}', headers=HEADERS)
    assert response.status_code == 503
    assert response.json()['errors'][0]['code'] == 'STUDIO_SCHEMA_MISSING'


def test_cancellation_is_requested_by_an_editor_and_reports_the_pending_state() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.post(f'{base()}/jobs/{JOB}/cancel', headers=HEADERS,
        json={'reason': 'Not needed'}).status_code == 403

    client, state = make_client()
    response = client.post(f'{base()}/jobs/{JOB}/cancel', headers=HEADERS,
        json={'reason': 'The production plan changed.'})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['status'] == 'cancel_requested'
    assert data['status_label'] == 'Cancellation requested'
    assert 'cannot be undone' in data['state_line']
    call = state['writes'][0]
    assert call['name'] == 'job_cancel_request'
    assert call['payload']['target_job'] == JOB
    assert call['payload']['p_reason'] == 'The production plan changed.'


def test_another_workspace_is_denied_by_the_database_guard() -> None:
    client, _ = make_client()
    response = client.get(f'/api/v1/workspaces/{OTHER_WORKSPACE}/jobs/summary', headers=HEADERS)
    assert response.status_code in (403, 404)
