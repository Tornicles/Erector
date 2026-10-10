import json
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.core.logging import JsonFormatter
from app.core.security import generate_secure_token, hash_token, verify_token_hash
from app.main import create_app
from app.services.contracts import IntelligenceOperation, OperationRequest

A = '00000000-0000-4000-8000-000000000001'
B = '00000000-0000-4000-8000-000000000002'
WORKSPACE = '00000000-0000-4000-8000-000000000010'


def settings(**kwargs):
    return Settings(_env_file=None, app_env='test', supabase_url='https://test.supabase.co',
        supabase_publishable_key=SecretStr('sb_publishable_test'), **kwargs)


def platform(request: httpx.Request) -> httpx.Response:
    assert request.headers['apikey'] == 'sb_publishable_test'
    token = request.headers.get('authorization')
    if token not in ('Bearer user-a', 'Bearer user-b'):
        return httpx.Response(401, json={'message': 'secret-internal-error'})
    if request.url.path == '/auth/v1/user':
        return httpx.Response(200, json={'id': A if token == 'Bearer user-a' else B})
    assert request.headers['accept-profile'] == 'tonde'
    if request.url.path == '/rest/v1/workspace_members':
        assert request.url.params['limit'] == '1'
        return httpx.Response(200, json=[{'role': 'owner'}] if token == 'Bearer user-a' else [])
    return httpx.Response(200, json=[{'user_id': A}])


@pytest.fixture

def client():
    with TestClient(create_app(settings(), httpx.MockTransport(platform))) as client:
        yield client


def test_boot_without_database_secrets_or_provider_keys():
    with TestClient(create_app(Settings(_env_file=None, app_env='test'))) as client:
        response = client.get('/api/health')
        assert response.status_code == 200
        assert response.json()['data'] == {'status': 'alive', 'platform': 'supabase', 'configured': False}
        assert response.headers['x-request-id']
        assert response.headers['x-process-time-ms']
        assert client.get('/api/v1/me', headers={'Authorization': 'Bearer not-real'}).status_code == 503


def test_auth_required_and_no_mock_login(client):
    assert client.get('/api/v1/me').status_code == 401
    response = client.get('/api/v1/me', headers={'Authorization': 'Bearer forged'})
    assert response.status_code == 401
    assert 'secret-internal-error' not in response.text
    assert client.post('/api/v1/auth/magic-link', json={'email': 'test@example.com'}).status_code == 404
    assert client.get('/api/validations').status_code == 404


def test_verified_supabase_session_and_readiness(client):
    response = client.get('/api/v1/me', headers={'Authorization': 'Bearer user-a'})
    assert response.status_code == 200
    assert response.json()['data']['user_id'] == A
    assert client.get('/api/ready').status_code == 401
    ready = client.get('/api/ready', headers={'Authorization': 'Bearer user-a'})
    assert ready.status_code == 200
    assert ready.json()['data']['auth'] == 'verified'


def test_server_workspace_authorization_two_identities(client):
    assert client.get(f'/api/v1/workspaces/{WORKSPACE}/access', headers={'Authorization': 'Bearer user-a'}).status_code == 200
    response = client.get(f'/api/v1/workspaces/{WORKSPACE}/access', headers={'Authorization': 'Bearer user-b'})
    assert response.status_code == 403
    assert response.json()['errors'][0]['type'] == 'authorization'


def test_platform_read_failures_name_their_cause():
    def missing_table(request):
        if request.url.path == '/auth/v1/user':
            return httpx.Response(200, json={'id': A})
        return httpx.Response(404, json={'code': '42P01', 'message': 'relation "tonde.director_briefs" does not exist'})
    with TestClient(create_app(settings(), httpx.MockTransport(missing_table))) as client:
        response = client.get(f'/api/v1/workspaces/{WORKSPACE}/access', headers={'Authorization': 'Bearer user-a'})
        assert response.status_code == 503
        assert 'migration' in response.json()['errors'][0]['message'].lower()

    def denied(request):
        if request.url.path == '/auth/v1/user':
            return httpx.Response(200, json={'id': A})
        return httpx.Response(400, json={'code': '42501', 'message': 'permission denied for table productions'})
    with TestClient(create_app(settings(), httpx.MockTransport(denied))) as client:
        response = client.get(f'/api/v1/workspaces/{WORKSPACE}/access', headers={'Authorization': 'Bearer user-a'})
        assert response.status_code == 403
        assert response.json()['errors'][0]['type'] == 'authorization'


def test_openai_api_key_falls_back_to_director_credential(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-fallback-credential')
    monkeypatch.delenv('DIRECTOR_API_KEY', raising=False)
    assert Settings(_env_file=None).director_api_key is not None
    assert Settings(_env_file=None).director_api_key.get_secret_value() == 'sk-fallback-credential'
    monkeypatch.setenv('DIRECTOR_API_KEY', 'sk-direct-credential')
    assert Settings(_env_file=None).director_api_key.get_secret_value() == 'sk-direct-credential'


def test_provider_network_failure_is_safe():
    def unavailable(request):
        raise httpx.ConnectError('sensitive-provider-url-and-key', request=request)
    with TestClient(create_app(settings(), httpx.MockTransport(unavailable))) as client:
        response = client.get('/api/v1/me', headers={'Authorization': 'Bearer user-a'})
        assert response.status_code == 503
        assert 'sensitive' not in response.text
        assert response.json()['errors'][0]['type'] == 'unavailable'


def test_validation_and_request_id_contract(client):
    response = client.get('/api/v1/workspaces/not-a-uuid/access', headers={'Authorization': 'Bearer user-a', 'X-Request-ID': 'x' * 200})
    assert response.status_code == 422
    UUID(response.headers['x-request-id'])
    assert 'input' not in response.json()['errors'][0]
    response = client.get('/api/health', headers={'X-Request-ID': 'request-123'})
    assert response.headers['x-request-id'] == 'request-123'
    assert response.json()['metadata']['request_id'] == 'request-123'


def test_cors_explicit_origins(client):
    allowed = client.options('/api/v1/me', headers={'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'GET'})
    assert allowed.headers['access-control-allow-origin'] == 'http://localhost:5173'
    denied = client.options('/api/v1/me', headers={'Origin': 'https://attacker.example', 'Access-Control-Request-Method': 'GET'})
    assert 'access-control-allow-origin' not in denied.headers
    with pytest.raises(ValidationError):
        settings(cors_allowed_origins='*')


def test_structured_logs_allowlist_omits_secrets():
    import logging
    record = logging.LogRecord('test', logging.ERROR, '', 0, 'password-secret', (), None)
    record.context = {'event': 'auth_failure', 'request_id': 'safe', 'access_token': 'secret', 'raw_prompt': 'private'}
    value = JsonFormatter().format(record)
    assert 'secret' not in value and 'private' not in value
    assert json.loads(value)['request_id'] == 'safe'


def test_portable_security_utility_and_intelligence_contract():
    token = generate_secure_token()
    assert verify_token_hash(token, hash_token(token))
    assert not verify_token_hash('wrong', hash_token(token))
    assert len(IntelligenceOperation) == 13
    request = OperationRequest(workspace_id=A, production_id=B, scope_object_id=WORKSPACE,
        expected_revision=1, operation='story_script', output_schema={'type': 'object'})
    assert request.operation == IntelligenceOperation.story_script
    with pytest.raises(ValidationError):
        OperationRequest(workspace_id=A, production_id=B, scope_object_id=WORKSPACE,
            expected_revision=0, operation='story_script', output_schema={})
