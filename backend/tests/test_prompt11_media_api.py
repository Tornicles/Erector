"""Media ingestion HTTP coverage for the creator upload path and trusted server verification."""

from __future__ import annotations

import json

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
INTENT = '00000000-0000-4000-8000-000000000d01'
MEDIA = '00000000-0000-4000-8000-000000000c01'
DERIVATION = '00000000-0000-4000-8000-000000000b01'
OBJECT_KEY = f'{WORKSPACE}/{MEDIA}/original.mp4'

HEADERS = {'Authorization': 'Bearer verified-test-session'}
SERVER_HEADERS = {'x-tonde-server-token': 'server-secret'}


def base(workspace: str = WORKSPACE) -> str:
    return f'/api/v1/workspaces/{workspace}'


def make_client(*, role: str | None = 'owner', server_token: str | None = 'server-secret',
    service_key: str | None = 'service-role-key', object_exists: bool = True):
    state: dict = {'calls': [], 'writes': [], 'storage': []}

    def platform(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        if path == '/rest/v1/workspace_members':
            if request.url.params.get('workspace_id') != f'eq.{WORKSPACE}' or role is None:
                return httpx.Response(200, json=[])
            wanted = request.url.params.get('role') or ''
            if wanted.startswith('in.(') and wanted.endswith(')') and role not in wanted[4:-1].split(','):
                return httpx.Response(200, json=[])
            if wanted and not wanted.startswith('in.(') and wanted != role:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{'role': role}])
        if path == '/storage/v1/bucket/tonde-results':
            state['storage'].append({'method': request.method, 'path': path, 'headers': dict(request.headers)})
            return httpx.Response(200, json={'id': 'tonde-results', 'file_size_limit': 52428800,
                'allowed_mime_types': ['video/mp4', 'image/jpeg']})
        if path == '/storage/v1/bucket/tonde-asset-references':
            state['storage'].append({'method': request.method, 'path': path, 'headers': dict(request.headers)})
            return httpx.Response(200, json={'id': 'tonde-asset-references', 'file_size_limit': 52428800,
                'allowed_mime_types': ['video/mp4', 'image/jpeg']})
        if path == '/storage/v1/bucket/tonde-production-media':
            state['storage'].append({'method': request.method, 'path': path, 'headers': dict(request.headers)})
            return httpx.Response(200, json={'id': 'tonde-production-media', 'file_size_limit': 52428800,
                'allowed_mime_types': ['video/mp4', 'image/jpeg']})
        if path == '/storage/v1/bucket/tonde-exports':
            state['storage'].append({'method': request.method, 'path': path, 'headers': dict(request.headers)})
            return httpx.Response(200, json={'id': 'tonde-exports', 'file_size_limit': 52428800,
                'allowed_mime_types': ['video/mp4', 'image/jpeg']})
        if path.startswith('/storage/v1/object/upload/sign/'):
            state['storage'].append({'method': request.method, 'path': path, 'headers': dict(request.headers),
                'body': json.loads(request.content or b'{}')})
            return httpx.Response(200, json={'url': path.removeprefix('/storage/v1') + '?token=opaque-signed-token'})
        if path.startswith('/storage/v1/object/info/'):
            state['storage'].append({'method': request.method, 'path': path, 'headers': dict(request.headers)})
            if not object_exists:
                return httpx.Response(404, json={'message': 'Object not found'})
            return httpx.Response(200, json={'id': 'storage-object', 'name': OBJECT_KEY,
                'bucket_id': 'tonde-results', 'size': 4096, 'content_type': 'video/mp4',
                'etag': 'opaque-etag', 'metadata': {'size': 4096, 'mimetype': 'video/mp4'}})
        if not path.startswith('/rest/v1/rpc/'):
            return httpx.Response(200, json=[])
        name = path.rsplit('/', 1)[-1]
        payload = json.loads(request.content or b'{}')
        state['calls'].append({'name': name, 'payload': payload, 'headers': dict(request.headers)})
        if name == 'media_upload_limits':
            return httpx.Response(200, json={'schema_version': '1', 'scanner_configured': False,
                'absolute_max_bytes': 137438953472, 'resumable_threshold_bytes': 8388608,
                'supported_mime_types': ['video/mp4', 'image/jpeg'], 'purposes': [
                    {'purpose': 'result', 'max_bytes': 34359738368, 'supported_mime_types': ['video/mp4']},
                    {'purpose': 'reference', 'max_bytes': 2147483648, 'supported_mime_types': ['video/mp4']}]})
        if name == 'media_upload_intent_create':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'intent_id': INTENT, 'media_id': MEDIA, 'state': 'created',
                'bucket': 'tonde-results', 'object_key': OBJECT_KEY, 'max_bytes': 52428800,
                'expected_bytes': 4096, 'expires_at': '2026-10-10T12:00:00Z',
                'storage_path_is_server_owned': True})
        if name == 'media_upload_signed_request':
            return httpx.Response(200, json={'intent_id': INTENT, 'media_id': MEDIA, 'bucket': 'tonde-results',
                'object_key': OBJECT_KEY, 'expected_mime_type': 'video/mp4', 'max_bytes': 52428800,
                'expected_bytes': 4096, 'expires_at': '2026-10-10T12:00:00Z'})
        if name == 'media_upload_part':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'intent_id': INTENT, 'state': 'uploading',
                'received_bytes': payload.get('p_bytes'), 'parts': 1})
        if name == 'media_upload_abort':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'intent_id': INTENT, 'state': 'aborted', 'note': 'A closed intent never reopens.'})
        if name == 'media_upload_intent_status':
            return httpx.Response(200, json={'intent_id': INTENT, 'state': 'created', 'media_id': MEDIA,
                'bucket': 'tonde-results', 'object_key': OBJECT_KEY, 'upload_state': 'pending'})
        if name == 'media_status':
            return httpx.Response(200, json={'media_id': MEDIA, 'media_kind': 'video',
                'processing_state': 'ready', 'scan_state': 'not_configured',
                'original_media_id': None, 'derivations': [], 'probe': {'duration_ms': 6000}})
        if name == 'media_upload_verify':
            state['writes'].append({'name': name, 'payload': payload, 'headers': dict(request.headers)})
            return httpx.Response(200, json={'intent_id': INTENT, 'state': 'verified', 'media_id': MEDIA,
                'rejection': None, 'job_id': 'job-verify'})
        if name == 'media_scan_record':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'media_id': MEDIA, 'scan_state': payload.get('p_state'), 'scanner': payload.get('p_scanner')})
        if name == 'media_probe_record':
            return httpx.Response(200, json={'media_id': MEDIA, 'duration_ms': 6000})
        if name == 'media_processing_state':
            return httpx.Response(200, json={'media_id': MEDIA, 'processing_state': payload.get('p_state')})
        if name == 'media_derivation_request':
            return httpx.Response(200, json={'derivation_id': DERIVATION, 'state': 'requested', 'job': {'job_id': 'job-1', 'status': 'queued'}})
        if name == 'media_derivation_complete':
            return httpx.Response(200, json={'derivation_id': DERIVATION, 'state': 'ready', 'output_media_id': payload.get('p_output_media_id')})
        return httpx.Response(200, json={})

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_service_role_key=service_key,
        tonde_server_token=server_token, app_env='test')
    client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    client.__enter__()
    return client, state


def test_limits_state_honestly_that_no_scanner_is_configured_and_clamp_to_storage_bucket() -> None:
    client, state = make_client()
    data = client.get('/api/v1/media/upload-limits', headers=HEADERS).json()['data']
    assert data['scanner_configured'] is False
    assert 'No malware scanner is configured' in data['scan_line']
    assert 'deployment requirement' in data['scanner_rule']
    assert data['purposes'][0]['max_bytes'] == 52428800
    assert data['storage_limits_verified'] is True
    assert data['purposes'][0]['supported_mime_types'] == ['video/mp4']
    assert data['supported_mime_types'] == ['video/mp4']
    assert all(item['headers'].get('authorization') == 'Bearer service-role-key' for item in state['storage'])


def test_media_vocabulary_names_the_states_that_exist() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/media/vocabulary', headers=HEADERS).json()['data']
    assert [entry['state'] for entry in data['upload_intent_states']] == [
        'created', 'uploading', 'completing', 'verified', 'rejected', 'expired', 'aborted']
    assert next(entry for entry in data['scan_states'] if entry['state'] == 'not_configured')['label'].startswith('No scanner')
    assert 'extension is never evidence' in data['rule']


def test_an_upload_intent_is_created_for_an_editor_with_a_server_derived_path() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.post(f'{base()}/media/upload-intents', headers=HEADERS, json={
        'purpose': 'reference', 'original_filename': 'take.mp4', 'mime_type': 'video/mp4'}).status_code == 403
    client, state = make_client()
    data = client.post(f'{base()}/media/upload-intents', headers=HEADERS, json={
        'purpose': 'reference', 'original_filename': 'take.mp4', 'mime_type': 'video/mp4',
        'expected_bytes': 4096, 'production_id': PRODUCTION}).json()['data']
    assert data['object_key'] == OBJECT_KEY
    write = state['writes'][0]['payload']
    assert write['target_workspace'] == WORKSPACE and write['p_mime_type'] == 'video/mp4'
    assert 'object_key' not in write, 'the client never proposes a Storage path'


def test_signed_upload_is_minted_only_after_workspace_scoped_creator_authorization() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/media/upload-intents/{INTENT}/signed-upload', headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['token'] == 'opaque-signed-token'
    assert data['bucket'] == 'tonde-results' and data['object_key'] == OBJECT_KEY
    assert data['upload_url'].startswith('https://tonde-test.supabase.co/storage/v1/object/upload/sign/')
    assert data['max_bytes'] == 52428800 and data['token_expires_in_seconds'] == 7200
    assert data['upsert'] is False
    auth = next(call for call in state['calls'] if call['name'] == 'media_upload_signed_request')
    assert auth['payload'] == {'target_workspace': WORKSPACE, 'target_intent': INTENT}
    assert state['storage'][0]['method'] == 'GET'
    assert state['storage'][0]['headers']['authorization'] == 'Bearer service-role-key'
    assert state['storage'][1]['method'] == 'POST'
    assert 'service-role-key' not in json.dumps(data), 'Only the scoped upload token is returned.'


def test_signed_upload_reports_unavailable_if_service_role_is_missing() -> None:
    client, _ = make_client(service_key=None)
    response = client.post(f'{base()}/media/upload-intents/{INTENT}/signed-upload', headers=HEADERS)
    assert response.status_code == 503
    assert response.json()['errors'][0]['code'] == 'MEDIA_SIGNED_UPLOAD_UNAVAILABLE'


def test_parts_and_abandon_are_recorded_against_the_intent() -> None:
    client, state = make_client()
    part = client.post(f'{base()}/media/upload-intents/{INTENT}/parts', headers=HEADERS,
        json={'part_number': 2, 'bytes': 4096, 'etag': 'abc'}).json()['data']
    assert part['received_bytes'] == 4096
    aborted = client.post(f'{base()}/media/upload-intents/{INTENT}/abort', headers=HEADERS,
        json={'reason': 'Wrong take.'}).json()['data']
    assert aborted['state'] == 'aborted'
    assert [item['name'] for item in state['writes']] == ['media_upload_part', 'media_upload_abort']


def test_intent_and_media_status_are_readable_by_a_member() -> None:
    client, _ = make_client()
    intent = client.get(f'{base()}/media/upload-intents/{INTENT}', headers=HEADERS).json()['data']
    assert intent['state'] == 'created' and intent['media_id'] == MEDIA
    media = client.get(f'{base()}/media/{MEDIA}', headers=HEADERS).json()['data']
    assert media['processing_state_label'] == 'Ready to use'
    assert media['scan_state_label'] == 'No scanner is configured in this deployment'
    assert media['probe']['duration_ms'] == 6000


def test_malformed_media_identifier_is_refused_before_the_rpc() -> None:
    client, state = make_client()
    assert client.get(f'{base()}/media/not-a-uuid', headers=HEADERS).status_code == 422
    assert state['calls'] == []


def test_creator_complete_observes_storage_and_uses_server_observed_facts() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/media/upload-intents/{INTENT}/complete', headers=HEADERS)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['media_id'] == MEDIA and data['state'] == 'verified'
    observed = next(item for item in state['storage'] if item['method'] == 'GET')
    assert OBJECT_KEY in observed['path']
    verify = next(item for item in state['writes'] if item['name'] == 'media_upload_verify')
    assert verify['payload']['p_observed_bytes'] == 4096
    assert verify['payload']['p_observed_mime'] == 'video/mp4'
    assert verify['payload']['p_observed_checksum'] is None, 'An ETag is not mislabeled as a cryptographic checksum.'
    assert verify['payload']['p_verifier'] == 'supabase-storage-info'
    assert verify['headers']['authorization'] == 'Bearer service-role-key'


def test_creator_cannot_complete_before_storage_object_is_present() -> None:
    client, state = make_client(object_exists=False)
    response = client.post(f'{base()}/media/upload-intents/{INTENT}/complete', headers=HEADERS)
    assert response.status_code == 409
    assert response.json()['errors'][0]['code'] == 'MEDIA_OBJECT_NOT_FOUND'
    assert not any(write['name'] == 'media_upload_verify' for write in state['writes'])


def test_legacy_server_verification_route_rejects_client_supplied_facts_and_observes_storage() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/media/upload-intents/{INTENT}/verify', headers=SERVER_HEADERS,
        json={'observed_bytes': 999999, 'observed_mime': 'image/jpeg', 'observed_checksum': 'sha256:forged',
            'object_verified': False, 'verifier': 'client'})
    assert response.status_code == 200
    write = state['writes'][0]
    assert write['payload']['p_observed_bytes'] == 4096
    assert write['payload']['p_observed_mime'] == 'video/mp4'
    assert write['payload']['p_observed_checksum'] is None
    assert write['payload']['p_object_verified'] is True
    assert write['payload']['p_verifier'] == 'supabase-storage-info'


def test_invalid_server_token_cannot_verify_media() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/media/upload-intents/{INTENT}/verify', headers={**SERVER_HEADERS, 'x-tonde-server-token': 'wrong'}, json={})
    assert response.status_code == 401
    assert not any(write['name'] == 'media_upload_verify' for write in state['writes'])


def test_unconfigured_server_seam_says_so_instead_of_accepting_a_payload() -> None:
    client, _ = make_client(server_token=None)
    response = client.post(f'{base()}/media/upload-intents/{INTENT}/verify', headers=SERVER_HEADERS, json={})
    assert response.status_code == 503
    assert response.json()['errors'][0]['code'] == 'MEDIA_SERVER_SEAM_DISABLED'


def test_a_client_cannot_declare_its_own_media_verified() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/media/upload-intents/{INTENT}/verify', headers=HEADERS, json={})
    assert response.status_code == 401
    assert response.json()['errors'][0]['code'] == 'SERVER_TOKEN_INVALID'
    assert state['writes'] == []


def test_a_scan_is_recorded_with_the_state_the_scanner_reported() -> None:
    client, state = make_client()
    ok = client.post(f'{base()}/media/{MEDIA}/scan', headers=SERVER_HEADERS, json={
        'scanner': 'none', 'state': 'not_configured', 'recorded_by': 'tonde-server'})
    assert ok.status_code == 200 and ok.json()['data']['scan_state'] == 'not_configured'
    assert state['writes'][0]['payload']['p_state'] == 'not_configured'
    invented = client.post(f'{base()}/media/{MEDIA}/scan', headers=SERVER_HEADERS, json={
        'scanner': 'clamav', 'state': 'definitely_clean'})
    assert invented.status_code == 422


def test_a_derivation_is_requested_and_output_provenance_stays_server_controlled() -> None:
    client, state = make_client()
    requested = client.post(f'{base()}/media/derivations', headers=SERVER_HEADERS, json={
        'source_media_id': MEDIA, 'derivation_type': 'proxy', 'transform_key': 'h264-540p'}).json()['data']
    assert requested['state'] == 'requested'
    assert state['calls'][0]['payload']['target_source'] == MEDIA
    output = client.post(f'{base()}/media/derivations/{DERIVATION}/complete', headers=SERVER_HEADERS,
        json={'output_media_id': MEDIA, 'bytes': 2048, 'checksum': 'sha256:def'}).json()['data']
    assert output['state'] == 'ready' and output['output_media_id'] == MEDIA
    invalid = client.post(f'{base()}/media/derivations', headers=SERVER_HEADERS, json={
        'source_media_id': MEDIA, 'derivation_type': 'full_generation', 'transform_key': 'x'})
    assert invalid.status_code == 422
