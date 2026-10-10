"""Prompt 10 integrations HTTP surface (§3-14, §50, §63, §86).

What a creator can see and do here:

* the provider catalog with **truthful** status: a provider whose adapter was never verified against the
  real provider says so, and a provider this deployment has no credentials for says that instead of
  looking connected;
* their workspace's destination accounts with status, granted scopes, missing scopes, last verification
  and last error;
* connect, verify, reauthorize and disconnect.

What this surface never does: hand out a credential, a token or an authorization code, or report a
connection as CONNECTED because a configuration field exists. `CONNECTED` comes from a recorded
verification, and the database refuses to store anything else.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor
from app.domain.commercial import RETRY_CLASSIFICATION
from app.domain.integrations import ConnectRequest, DisconnectRequest, OAuthCallbackRequest, OAuthInitiateRequest, ReauthorizeRequest
from app.services.integrations import IntegrationService
from app.services.rate_limit import RateLimiter

Envelope = Any

INTEGRATION_VOCABULARY: dict[str, Any] = {
    'connection_states': {
        'disconnected': 'No account is connected for this provider.',
        'pending': 'An authorization was recorded but the provider has not confirmed it yet.',
        'connected': 'The provider confirmed this account; this is the only state that authorizes publishing.',
        'reauth_required': 'The provider stopped accepting the authorization; a creator must reauthorize.',
        'expired': 'The authorization expired.',
        'revoked': 'A creator disconnected this account.',
        'error': 'The last attempt to reach the provider failed. The provider code is recorded.',
        'disabled': 'This deployment disabled the connection.',
    },
    'adapter_states': {
        'absent': 'No adapter exists for this provider, so nothing can be attempted.',
        'implemented': 'An adapter exists but has never been exercised against the real provider.',
        'verified': 'A real call to the provider succeeded and was recorded.',
    },
    'capability_states': ['UNKNOWN_PROVIDER', 'PROVIDER_NOT_IMPLEMENTED', 'UNKNOWN_CAPABILITY',
        'CAPABILITY_DISABLED', 'CONNECTION_NOT_READY', 'MISSING_SCOPE', 'AVAILABLE'],
    'credential_law': ('TONDE stores no provider credential. A connection names the vault reference that holds it; '
        'a literal secret is refused.'),
    'token_refresh_boundary': ('TONDE does not refresh provider tokens. The deployment vault owns refresh; when a '
        'provider stops accepting a credential the connection moves to reauth_required.'),
    'retry': {action: RETRY_CLASSIFICATION[action] for action in ('provider_connect', 'provider_verify',
        'provider_disconnect', 'provider_reauthorize', 'oauth_exchange')},
    'oauth_state_law': ('The raw authorization state and verifier are never stored; only their hashes are. A state is '
        'single-use, bound to one workspace and one creator, and expires in minutes.'),
}


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_INTEGRATION_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def register_integration_routes(application: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}'
    limiter = RateLimiter()
    service = IntegrationService

    @application.get(f'{base}/integrations/vocabulary')
    async def integration_vocabulary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        return envelope(request, INTEGRATION_VOCABULARY)

    @application.get(f'{base}/integrations/providers')
    async def list_providers(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The provider catalog, decorated only with what the deployment really has."""

        integration = service(gateway, config)
        providers = await integration.list_providers(request.state.access_token)
        capabilities = await integration.list_capabilities(request.state.access_token)
        by_provider: dict[str, list[dict[str, Any]]] = {}
        for capability in capabilities:
            by_provider.setdefault(str(capability.get('provider_key')), []).append(capability)
        items = []
        for row in providers:
            provider_key = str(row.get('key'))
            adapter = integration.registry.describe(provider_key)
            items.append({**row, 'capabilities': by_provider.get(provider_key, []), 'adapter': adapter,
                'connection_available': bool(row.get('enabled')) and row.get('adapter_state') != 'absent',
                'note': row.get('note') or (
                    'No adapter has been verified against this provider, so it cannot be connected yet.'
                    if row.get('adapter_state') != 'verified' else '')})
        return envelope(request, {'items': items, 'count': len(items),
            'unconfigured_dependencies': integration.registry.describe('youtube')['unconfigured_dependencies']
            if items else [], 'vocabulary': INTEGRATION_VOCABULARY})

    @application.get(f'{base}/integrations/providers/{{provider}}/capabilities')
    async def provider_capabilities(workspace_id: UUID, provider: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Every declared capability of one provider, its answer, and the scopes that are missing."""

        matrix = await service(gateway, config).capability_matrix(workspace_id, provider, request.state.access_token)
        return envelope(request, matrix)

    @application.get(f'{base}/integrations/connections')
    async def list_connections(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Destination accounts of this workspace, with what was granted and what is missing."""

        integration = service(gateway, config)
        rows = await integration.list_connections(workspace_id, request.state.access_token)
        items = []
        for row in rows:
            provider = str(row.get('provider'))
            adapter = integration.registry.describe(provider)
            granted = set(row.get('scopes') or [])
            requested = list(row.get('requested_scopes') or [])
            items.append({**row, 'adapter': adapter,
                'granted_scopes': sorted(granted), 'missing_requested_scopes': [scope for scope in requested if scope not in granted],
                'verified': row.get('status') == 'connected' and bool(row.get('verified_at')),
                'credential_reference_recorded': bool((row.get('metadata') or {}).get('credential_reference')),
                'note': INTEGRATION_VOCABULARY['connection_states'].get(str(row.get('status')), '')})
        return envelope(request, {'items': items, 'count': len(items), 'vocabulary': INTEGRATION_VOCABULARY})

    @application.get(f'{base}/integrations/connections/{{connection_id}}')
    async def connection_detail(workspace_id: UUID, connection_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        row = await service(gateway, config).connection(workspace_id, connection_id, request.state.access_token)
        return envelope(request, {**row, 'credential_storage': 'reference_only',
            'note': INTEGRATION_VOCABULARY['connection_states'].get(str(row.get('status')), '')})

    @application.post(f'{base}/integrations/oauth/initiate')
    async def initiate_oauth(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Start an authorization flow. The state is returned once; only its hash is stored."""

        limiter.enforce('oauth.initiate', str(user.id))
        body = _validated(OAuthInitiateRequest, await request.json(), 'Check the authorization request fields.')
        result = await service(gateway, config).initiate(workspace_id, user.id, request.state.access_token,
            provider=body.provider, redirect_uri=body.redirect_uri, requested_scopes=body.requested_scopes)
        logger.info('oauth_initiated', extra={'context': {'event': 'oauth_initiated',
            'workspace_id': str(workspace_id), 'provider': body.provider, 'initiated': result.get('initiated')}})
        result['retry'] = RETRY_CLASSIFICATION['oauth_exchange']
        return envelope(request, result)

    @application.post(f'{base}/integrations/oauth/callback')
    async def oauth_callback(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Answer an authorization flow with the provider's code. A replay is refused by the database."""

        limiter.enforce('oauth.callback', str(user.id))
        body = _validated(OAuthCallbackRequest, await request.json(), 'Check the authorization answer fields.')
        result = await service(gateway, config).callback(workspace_id, user.id, request.state.access_token, body)
        result['retry'] = RETRY_CLASSIFICATION['oauth_exchange']
        logger.info('oauth_callback', extra={'context': {'event': 'oauth_callback', 'workspace_id': str(workspace_id),
            'provider': result.get('provider'), 'connected': result.get('connected')}})
        return envelope(request, result)

    @application.post(f'{base}/integrations/connections')
    async def connect(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record a destination account and verify it immediately. No verification, no CONNECTED."""

        limiter.enforce('provider.connect', str(user.id))
        body = _validated(ConnectRequest, await request.json(), 'Check the connection fields.')
        result = await service(gateway, config).connect(workspace_id, user.id, request.state.access_token, body)
        result['retry'] = RETRY_CLASSIFICATION['provider_connect']
        return envelope(request, result)

    @application.post(f'{base}/integrations/connections/{{connection_id}}/verify')
    async def verify_connection(workspace_id: UUID, connection_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Re-establish that the credential still works. This is the token-refresh boundary."""

        limiter.enforce('provider.verify', str(user.id))
        payload = await request.json() if await request.body() else {}
        result = await service(gateway, config).verify(workspace_id, user.id, request.state.access_token,
            connection_id, credential_reference=str(payload.get('credential_reference') or '')[:200],
            note=str(payload.get('note') or '')[:600])
        result['retry'] = RETRY_CLASSIFICATION['provider_verify']
        return envelope(request, result)

    @application.post(f'{base}/integrations/connections/{{connection_id}}/reauthorize')
    async def reauthorize_connection(workspace_id: UUID, connection_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Replace an authorization. The connection waits for a fresh verification before it is CONNECTED."""

        body = _validated(ReauthorizeRequest, await request.json() if await request.body() else {},
            'Check the reauthorization fields.')
        result = await service(gateway, config).reauthorize(workspace_id, user.id, request.state.access_token,
            connection_id, credential_reference=body.credential_reference, requested_scopes=body.requested_scopes)
        result['retry'] = RETRY_CLASSIFICATION['provider_reauthorize']
        return envelope(request, result)

    @application.post(f'{base}/integrations/connections/{{connection_id}}/disconnect')
    async def disconnect_connection(workspace_id: UUID, connection_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Revoke a destination account and record why. Publishing stops being available for it."""

        limiter.enforce('provider.disconnect', str(user.id))
        body = _validated(DisconnectRequest, await request.json() if await request.body() else {},
            'Check the disconnect fields.')
        result = await service(gateway, config).disconnect(workspace_id, user.id, request.state.access_token,
            connection_id, reason=body.reason)
        logger.info('provider_disconnected', extra={'context': {'event': 'provider_disconnected',
            'workspace_id': str(workspace_id), 'connection_id': str(connection_id)}})
        return envelope(request, result)
