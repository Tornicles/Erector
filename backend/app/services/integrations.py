"""Prompt 10 integration connection service (§3-14, §20, §63, §86).

This service owns everything between a creator's decision and a provider's answer:

* the provider catalog and capability answer a surface reads;
* OAuth initiation, state validation, callback, replay refusal and reauthorization;
* connection verification, connection state and disconnection;
* the credential law, the bounded timeout, the normalized failure and the audit trail.

Laws it enforces rather than merely describes:

* **No credential is stored.** A connection carries a *reference* to where a deployment's own vault
  keeps the token. The literal-secret refusal is enforced in the request model and again here.
* **CONNECTED is evidence, not intent.** The database guard requires a recorded verification *and* a
  provider whose adapter is `verified`; this service cannot produce a CONNECTED row without a real
  successful adapter call.
* **An unconfigured provider is unconfigured.** The adapter boundary raises a named
  `PROVIDER_UNCONFIGURED` outcome carrying the missing dependency, and nothing is attempted.
* **OAuth state is single-use and bound.** The raw state and verifier are never stored; only their
  hashes. The state row is consumed with the caller's own identity, and a second callback on the same
  state is refused by the database, not by this process.

The token-refresh boundary is explicit: TONDE does not refresh provider tokens. The deployment's vault
refreshes them, and `verify` re-establishes that the credential still works. Where a provider needs a
refreshed token, the connection state moves to `reauth_required` and says so.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.domain.integrations import ConnectRequest, OAuthCallbackRequest
from app.services.integration_adapters import (
    AdapterRegistry,
    ProviderCallFailed,
    ProviderTimeout,
    ProviderUnavailable,
    Verification,
    build_adapter_registry,
    with_timeout,
)

OAUTH_STATE_TTL_MINUTES = 15
CONNECTION_SELECT = ('id,workspace_id,provider,provider_account_id,status,scopes,connected_by,created_at,updated_at,'
    'auth_type,external_account_label,requested_scopes,verified_at,last_success_at,last_error_at,last_error_code,'
    'revoked_at,metadata')
PROVIDER_SELECT = ('key,name,category,auth_type,connection_required,adapter_state,enabled,capability_version,'
    'media_types,export_types,scopes,callback_required,environment,restrictions,note,docs_url')
CAPABILITY_SELECT = 'provider_key,capability_key,connection_required,required_scopes,media_types,export_types,enabled,note'

# The status a failed verification moves a connection to, per normalized failure. A creator has to act
# on all of these; none of them is allowed to look like a working connection.
ATTENTION_STATUS = {'authentication_failed': 'reauth_required', 'insufficient_scope': 'reauth_required',
    'provider_unavailable': 'error', 'rate_limited': 'error', 'unknown': 'error', 'invalid_metadata': 'error',
    'invalid_media': 'error', 'destination_rejected': 'error', 'policy_violation': 'error',
    'remote_processing_failed': 'error', 'quota_exceeded': 'error'}


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class IntegrationService:
    def __init__(self, gateway: SupabaseGateway, settings: Settings,
        registry: AdapterRegistry | None = None) -> None:
        self.gateway = gateway
        self.settings = settings
        self.registry = registry or build_adapter_registry(settings)

    # ------------------------------------------------------------------ reads

    async def list_providers(self, token: str) -> list[dict[str, Any]]:
        data = await self.gateway.request('GET', '/rest/v1/integration_providers', token=token, schema=True,
            params={'select': PROVIDER_SELECT, 'order': 'category.asc,key.asc'})
        return data if isinstance(data, list) else []

    async def list_capabilities(self, token: str) -> list[dict[str, Any]]:
        data = await self.gateway.request('GET', '/rest/v1/integration_provider_capabilities', token=token,
            schema=True, params={'select': CAPABILITY_SELECT, 'order': 'provider_key.asc,capability_key.asc'})
        return data if isinstance(data, list) else []

    async def list_connections(self, workspace_id: UUID, token: str) -> list[dict[str, Any]]:
        data = await self.gateway.request('GET', '/rest/v1/integration_connections', token=token, schema=True,
            params={'workspace_id': f'eq.{workspace_id}', 'select': CONNECTION_SELECT,
                'order': 'created_at.desc', 'limit': '200'})
        return data if isinstance(data, list) else []

    async def connection(self, workspace_id: UUID, connection_id: UUID, token: str) -> dict[str, Any]:
        data = await self.gateway.request('GET', '/rest/v1/integration_connections', token=token, schema=True,
            params={'workspace_id': f'eq.{workspace_id}', 'id': f'eq.{connection_id}',
                'select': CONNECTION_SELECT, 'limit': '1'})
        rows = data if isinstance(data, list) else []
        if not rows:
            raise AppError('CONNECTION_NOT_FOUND', 'not_found',
                'That destination account does not exist in this workspace.', 404)
        return rows[0]

    async def capability(self, workspace_id: UUID, provider: str, capability_key: str, token: str) -> dict[str, Any]:
        """Ask the database — the single authority — whether a capability is available and why."""

        try:
            state = await self.gateway.rpc_detailed('integration_capability_state', token=token,
                json={'target_workspace': str(workspace_id), 'target_provider': provider,
                    'target_capability': capability_key}, layer='Prompt 10 integrations')
        except AppError as error:
            if error.kind == 'unavailable':
                return {'provider': provider, 'capability': capability_key, 'state': 'PROVIDER_NOT_IMPLEMENTED',
                    'available': False, 'adapter': self.registry.describe(provider)}
            raise
        state_text = str(state or 'PROVIDER_NOT_IMPLEMENTED')
        return {'provider': provider, 'capability': capability_key, 'state': state_text,
            'available': state_text == 'AVAILABLE', 'adapter': self.registry.describe(provider),
            'meaning': self._capability_meaning(state_text)}

    async def capability_matrix(self, workspace_id: UUID, provider: str, token: str) -> dict[str, Any]:
        """Every declared capability of one provider with its answer, plus the missing scopes."""

        capabilities = await self.list_capabilities(token)
        declared = [row for row in capabilities if row.get('provider_key') == provider and row.get('enabled')]
        connections = await self.list_connections(workspace_id, token)
        connected = [row for row in connections if row.get('provider') == provider and row.get('status') == 'connected']
        granted: set[str] = set()
        for row in connected:
            granted.update(row.get('scopes') or [])
        answers = []
        for row in declared:
            required = list(row.get('required_scopes') or [])
            answers.append({'capability': row.get('capability_key'), 'connection_required': row.get('connection_required'),
                'required_scopes': required,
                'missing_scopes': [scope for scope in required if scope not in granted],
                'state': await self.capability(workspace_id, provider, str(row.get('capability_key')), token)})
        return {'provider': provider, 'capabilities': answers, 'granted_scopes': sorted(granted),
            'connected_accounts': [{'id': row.get('id'), 'label': row.get('external_account_label'),
                'verified_at': row.get('verified_at')} for row in connected],
            'adapter': self.registry.describe(provider)}

    @staticmethod
    def _capability_meaning(state: str) -> str:
        return {
            'UNKNOWN_PROVIDER': 'This provider is not registered in this deployment.',
            'PROVIDER_NOT_IMPLEMENTED': 'No adapter for this provider has been verified against the real provider, so the capability is not available.',
            'UNKNOWN_CAPABILITY': 'This provider does not declare that capability.',
            'CAPABILITY_DISABLED': 'The provider declares the capability but it is disabled.',
            'CONNECTION_NOT_READY': 'A connected destination account is required and none is connected.',
            'MISSING_SCOPE': 'The connected account did not grant a scope this capability requires; reauthorize and grant it.',
            'AVAILABLE': 'Everything this capability needs is present.',
        }.get(state, f'The capability answer is {state}.')

    # ------------------------------------------------------------------ OAuth

    def _service_key(self) -> str:
        key = self.settings.supabase_service_role_key
        if key is None:
            raise AppError('SERVER_CREDENTIALS_REQUIRED', 'unavailable',
                'This deployment has no server credentials configured, so provider connection state cannot be written.', 503)
        return key.get_secret_value()

    async def _service_request(self, method: str, path: str, *, params: dict[str, str] | None = None,
        json: Any = None, prefer: str | None = None) -> Any:
        return await self.gateway.request(method, path, token=self._service_key(), schema=True, params=params,
            json=json, prefer=prefer)

    async def _provider(self, provider: str, token: str) -> dict[str, Any]:
        rows = await self.gateway.request('GET', '/rest/v1/integration_providers', token=token, schema=True,
            params={'key': f'eq.{provider}', 'select': PROVIDER_SELECT, 'limit': '1'})
        found = rows if isinstance(rows, list) else []
        if not found:
            raise AppError('PROVIDER_UNKNOWN', 'not_found', 'That provider is not registered in this deployment.', 404)
        return found[0]

    async def initiate(self, workspace_id: UUID, user_id: UUID, token: str, *, provider: str,
        redirect_uri: str, requested_scopes: list[str]) -> dict[str, Any]:
        """Open an authorization flow: one single-use state, stored as a hash, returned once."""

        row = await self._provider(provider, token)
        adapter = self.registry.get(provider)
        callback = redirect_uri or self.settings.integration_redirect_uri_base
        scopes = list(requested_scopes or row.get('scopes') or [])
        if not callback:
            return {'provider': provider, 'initiated': False, 'authorize_url': None, 'state': None,
                'unconfigured': ['integration_callback_url'],
                'note': 'This deployment has no callback address configured, so an authorization flow was not started.'}
        if row.get('adapter_state') == 'absent' or not row.get('enabled'):
            return {'provider': provider, 'initiated': False, 'authorize_url': None, 'state': None,
                'unconfigured': ['provider_adapter'],
                'adapter_state': row.get('adapter_state'), 'enabled': bool(row.get('enabled')),
                'note': 'No adapter for this provider is enabled, so an authorization flow was not started.'}
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(32)
        authorization = adapter.authorize_url(workspace_id=str(workspace_id), user_id=str(user_id), state=state,
            redirect_uri=callback, scopes=scopes)
        reasons = list(dict.fromkeys(list(authorization.unconfigured) + adapter.unconfigured_reasons()))
        if authorization.authorize_url is None:
            return {'provider': provider, 'initiated': False, 'authorize_url': None, 'state': None,
                'unconfigured': reasons, 'adapter': self.registry.describe(provider),
                'note': authorization.note or ('The authorization URL could not be produced, so no state was created.')}
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=OAUTH_STATE_TTL_MINUTES)
        inserted = await self._service_request('POST', '/rest/v1/integration_oauth_states', json={
            'workspace_id': str(workspace_id), 'user_id': str(user_id), 'provider_key': provider,
            'state_hash': _hash(state), 'verifier_hash': _hash(verifier), 'redirect_uri': callback,
            'requested_scopes': scopes, 'expires_at': expires_at.isoformat()}, prefer='return=representation')
        state_row = inserted[0] if isinstance(inserted, list) and inserted else {'id': None}
        return {'provider': provider, 'initiated': True, 'authorize_url': authorization.authorize_url,
            'state': state, 'verifier': verifier, 'state_id': state_row.get('id'),
            'redirect_uri': callback, 'requested_scopes': scopes,
            'expires_at': expires_at.isoformat(), 'expires_in_minutes': OAUTH_STATE_TTL_MINUTES,
            'credential_storage': ('TONDE stores no provider credential. After the callback the connection names the '
                'vault reference that holds the token.'),
            'note': ('The raw state and verifier are returned once and are never stored; only their hashes are. '
                'A callback that does not present this state is refused.')}

    async def callback(self, workspace_id: UUID, user_id: UUID, token: str, body: OAuthCallbackRequest) -> dict[str, Any]:
        """Answer an authorization flow.

        The presented state is hashed and resolved server-side. A state that does not exist, has
        expired, was already consumed, or belongs to another workspace or user is refused by name.
        """

        rows = await self._service_request('GET', '/rest/v1/integration_oauth_states',
            params={'state_hash': f'eq.{_hash(body.state)}',
                'select': 'id,workspace_id,user_id,provider_key,redirect_uri,requested_scopes,created_at,expires_at,consumed_at',
                'limit': '1'})
        found = rows if isinstance(rows, list) else []
        if not found:
            raise AppError('OAUTH_STATE_UNKNOWN', 'authorization',
                'That authorization answer does not match a flow this deployment started.', 409)
        state_row = found[0]
        if state_row.get('consumed_at'):
            raise AppError('OAUTH_STATE_REPLAYED', 'conflict',
                'That authorization answer was already used. Start a new authorization flow.', 409)
        expires_at = str(state_row.get('expires_at') or '')
        if expires_at and datetime.fromisoformat(expires_at.replace('Z', '+00:00')) <= datetime.now(timezone.utc):
            raise AppError('OAUTH_STATE_EXPIRED', 'conflict',
                'That authorization flow expired before it was answered. Start a new one.', 409)
        if str(state_row.get('workspace_id')) != str(workspace_id):
            raise AppError('OAUTH_STATE_WORKSPACE_MISMATCH', 'authorization',
                'That authorization answer belongs to a different workspace.', 403)
        if str(state_row.get('user_id')) != str(user_id):
            raise AppError('OAUTH_STATE_SUBJECT_MISMATCH', 'authorization',
                'That authorization answer belongs to a different user. The creator who started the flow must finish it.', 403)
        provider = str(state_row.get('provider_key'))
        adapter = self.registry.get(provider)
        # The state is consumed before the exchange: a provider code is single-use at the provider too,
        # so a repeat must fail here rather than look like new work.
        consumed = await self._service_request('PATCH', '/rest/v1/integration_oauth_states',
            params={'id': f'eq.{state_row.get("id")}'}, json={'consumed_at': _now(), 'consumed_by': str(user_id)},
            prefer='return=representation')
        consumed_rows = consumed if isinstance(consumed, list) else []
        if not consumed_rows:
            raise AppError('OAUTH_STATE_REPLAYED', 'conflict',
                'That authorization answer was already used. Start a new authorization flow.', 409)
        try:
            verification = await with_timeout(adapter.exchange_code(code=body.code, state=body.state,
                redirect_uri=str(state_row.get('redirect_uri') or '')), self.settings, action='Exchanging the authorization code')
        except ProviderUnavailable as error:
            return {'provider': provider, 'connected': False, 'unconfigured': adapter.unconfigured_reasons(),
                'state_consumed': True, 'note': error.user_message}
        except ProviderTimeout as error:
            raise AppError('OAUTH_EXCHANGE_TIMEOUT', 'provider',
                'The provider did not answer the authorization exchange in time. A new flow must be started.', 504) from error
        except ProviderCallFailed as error:
            raise AppError('OAUTH_EXCHANGE_REFUSED', 'provider',
                f'The provider refused the authorization exchange ({error.category}).', 502) from error
        return await self._record_connection(workspace_id, user_id, token, provider, verification,
            requested_scopes=list(state_row.get('requested_scopes') or []),
            credential_reference=body.credential_reference, account_label=body.account_label,
            connected_by=user_id, via='oauth_callback')

    # ------------------------------------------------------------------ connect / verify / revoke

    async def connect(self, workspace_id: UUID, user_id: UUID, token: str, body: ConnectRequest) -> dict[str, Any]:
        """Connect a non-interactive destination, then verify it. Nothing is CONNECTED without a live check."""

        row = await self._provider(body.provider, token)
        if row.get('adapter_state') == 'absent' or not row.get('enabled'):
            return {'provider': body.provider, 'connected': False, 'unconfigured': ['provider_adapter'],
                'adapter_state': row.get('adapter_state'), 'enabled': bool(row.get('enabled')),
                'note': 'No adapter for this provider is enabled, so no connection was recorded.'}
        connection = await self._upsert_connection(workspace_id, user_id, body.provider, {
            'status': 'pending', 'auth_type': row.get('auth_type') or 'api_key',
            'requested_scopes': body.requested_scopes or list(row.get('scopes') or []),
            'external_account_label': body.account_label,
            'metadata': self._metadata(body.credential_reference)}, token)
        result = await self.verify(workspace_id, user_id, token, UUID(str(connection['id'])),
            credential_reference=body.credential_reference, note='Initial verification after connecting.')
        result['connection_id'] = connection['id']
        return result

    async def verify(self, workspace_id: UUID, user_id: UUID, token: str, connection_id: UUID, *,
        credential_reference: str = '', note: str = '') -> dict[str, Any]:
        """Ask the provider whether this connection works. The answer decides the state."""

        connection = await self.connection(workspace_id, connection_id, token)
        if connection.get('status') == 'revoked':
            return {'connection_id': str(connection_id), 'provider': connection.get('provider'), 'connected': False,
                'status': 'revoked', 'verified': False,
                'note': 'This connection was revoked. Reauthorize it before verifying.'}
        adapter = self.registry.get(str(connection.get('provider')))
        reference = credential_reference or str((connection.get('metadata') or {}).get('credential_reference') or '')
        requested = list(connection.get('requested_scopes') or [])
        try:
            verification = await with_timeout(adapter.verify(credential_reference=reference, scopes=requested),
                self.settings, action='Verifying a destination connection')
        except ProviderUnavailable as error:
            # Nothing was attempted, so the connection keeps its state and the missing dependency is named.
            return {'connection_id': str(connection_id), 'provider': connection.get('provider'), 'connected': False,
                'verified': False, 'status': connection.get('status'),
                'unconfigured': adapter.unconfigured_reasons(), 'note': error.user_message}
        except ProviderTimeout as error:
            await self._mark_attention(workspace_id, connection_id, 'provider_unavailable', 'provider_timeout')
            raise AppError('PROVIDER_TIMEOUT', 'provider',
                'The provider did not answer the verification in time, so the connection was not confirmed.', 504) from error
        except ProviderCallFailed as error:
            await self._mark_attention(workspace_id, connection_id, error.category, error.provider_code or error.category)
            raise AppError('PROVIDER_VERIFICATION_FAILED', 'provider',
                f'The provider rejected the verification ({error.category}).', 502) from error
        return await self._record_connection(workspace_id, user_id, token, str(connection.get('provider')),
            verification, requested_scopes=requested, credential_reference=reference,
            account_label=str(connection.get('external_account_label') or ''), connected_by=user_id,
            via='verify', connection_id=connection_id, note=note)

    async def reauthorize(self, workspace_id: UUID, user_id: UUID, token: str, connection_id: UUID, *,
        credential_reference: str, requested_scopes: list[str]) -> dict[str, Any]:
        """Replace an authorization. The connection waits for a fresh verification before it is CONNECTED again."""

        connection = await self.connection(workspace_id, connection_id, token)
        provider = str(connection.get('provider'))
        scopes = requested_scopes or list(connection.get('requested_scopes') or [])
        if not credential_reference:
            await self._patch_connection(workspace_id, connection_id, {
                'status': 'pending', 'requested_scopes': scopes, 'last_error_code': None})
            return {'connection_id': str(connection_id), 'provider': provider, 'connected': False,
                'status': 'pending', 'state': 'awaiting_verification',
                'note': ('The previous authorization is cleared and the connection is waiting for a new one. '
                    'Run the authorization flow or record the vault reference that holds the new credential.')}
        updated = await self._patch_connection(workspace_id, connection_id, {
            'status': 'pending', 'requested_scopes': scopes,
            'metadata': self._metadata(credential_reference, dict(connection.get('metadata') or {})),
            'last_error_code': None, 'scopes': []})
        result = await self.verify(workspace_id, user_id, token, connection_id,
            credential_reference=credential_reference, note='Reauthorization verification.')
        result['reauthorized'] = True
        result['previous_status'] = connection.get('status')
        result.update({'requested_scopes': updated.get('requested_scopes')})
        return result

    async def disconnect(self, workspace_id: UUID, user_id: UUID, token: str, connection_id: UUID,
        *, reason: str = '') -> dict[str, Any]:
        """Revoke a connection. The row keeps its history; the provider is asked to revoke too, best-effort."""

        connection = await self.connection(workspace_id, connection_id, token)
        provider = str(connection.get('provider'))
        adapter = self.registry.get(provider)
        reference = str((connection.get('metadata') or {}).get('credential_reference') or '')
        revoked_at_provider: bool | None = None
        provider_note = ''
        try:
            revoked_at_provider = await with_timeout(adapter.revoke(credential_reference=reference), self.settings,
                action='Revoking the provider authorization')
        except ProviderUnavailable as error:
            provider_note = f'The provider authorization was not revoked remotely: {error.user_message}'
        except (ProviderTimeout, ProviderCallFailed) as error:
            # The TONDE-side revocation still happens; the remote result is reported honestly.
            provider_note = f'The provider did not confirm the revocation ({type(error).__name__}).'
            revoked_at_provider = None
        updated = await self._patch_connection(workspace_id, connection_id, {
            'status': 'revoked', 'revoked_at': _now(), 'scopes': [],
            'metadata': {**dict(connection.get('metadata') or {}), 'disconnect_reason': reason[:600],
                'remote_revocation_confirmed': revoked_at_provider if revoked_at_provider is not None else None}})
        return {'connection_id': str(connection_id), 'provider': provider, 'status': updated.get('status'),
            'revoked_at': updated.get('revoked_at'), 'previous_status': connection.get('status'),
            'remote_revoked': revoked_at_provider, 'note': provider_note or
                'The connection is revoked in TONDE and no longer authorizes publishing.',
            'retry': 'SAFE_TO_RETRY', 'actor_user_id': str(user_id)}

    # ------------------------------------------------------------------ writes

    def _metadata(self, credential_reference: str, existing: dict[str, Any] | None = None) -> dict[str, Any]:
        metadata = dict(existing or {})
        if credential_reference:
            metadata['credential_reference'] = credential_reference
        metadata['credential_storage'] = 'reference_only'
        return metadata

    async def _upsert_connection(self, workspace_id: UUID, user_id: UUID, provider: str,
        fields: dict[str, Any], token: str) -> dict[str, Any]:
        existing = await self.gateway.request('GET', '/rest/v1/integration_connections', token=token, schema=True,
            params={'workspace_id': f'eq.{workspace_id}', 'provider': f'eq.{provider}',
                'select': CONNECTION_SELECT, 'order': 'created_at.desc', 'limit': '1'})
        rows = existing if isinstance(existing, list) else []
        if rows:
            return await self._patch_connection(workspace_id, rows[0]['id'], fields)
        created = await self._service_request('POST', '/rest/v1/integration_connections', json={
            'workspace_id': str(workspace_id), 'provider': provider, 'connected_by': str(user_id), **fields},
            prefer='return=representation')
        created_rows = created if isinstance(created, list) else []
        if not created_rows:
            raise AppError('CONNECTION_WRITE_FAILED', 'database',
                'The connection could not be recorded in this workspace.', 503)
        return created_rows[0]

    async def _patch_connection(self, workspace_id: UUID, connection_id: Any, fields: dict[str, Any]) -> dict[str, Any]:
        updated = await self._service_request('PATCH', '/rest/v1/integration_connections',
            params={'workspace_id': f'eq.{workspace_id}', 'id': f'eq.{connection_id}'}, json=fields,
            prefer='return=representation')
        rows = updated if isinstance(updated, list) else []
        if not rows:
            raise AppError('CONNECTION_NOT_FOUND', 'not_found',
                'That destination account does not exist in this workspace.', 404)
        return rows[0]

    async def _mark_attention(self, workspace_id: UUID, connection_id: UUID, category: str, code: str) -> None:
        try:
            # A failed verification clears the CURRENT verification witness, so CONNECTED can never ride
            # an older successful verification. `last_success_at` keeps when it last worked, so the history
            # is preserved rather than erased.
            await self._patch_connection(workspace_id, connection_id, {
                'status': ATTENTION_STATUS.get(category, 'error'), 'verified_at': None, 'scopes': [],
                'last_error_at': _now(), 'last_error_code': code[:120]})
        except AppError:
            # The connection already carries a state; a failed bookkeeping write invents nothing.
            return

    async def _record_connection(self, workspace_id: UUID, user_id: UUID, token: str, provider: str,
        verification: Verification, *, requested_scopes: list[str], credential_reference: str,
        account_label: str, connected_by: UUID, via: str, connection_id: UUID | None = None,
        note: str = '') -> dict[str, Any]:
        """Write what the provider actually said, enforcing scope minimization here as well as in the schema."""

        granted = [scope for scope in dict.fromkeys(verification.scopes or [])]
        requested = list(dict.fromkeys(requested_scopes))
        unrequested = [scope for scope in granted if scope not in requested]
        if unrequested:
            # A grant TONDE never requested is not silently accepted as if it had been asked for.
            granted = [scope for scope in granted if scope in requested]
        fields: dict[str, Any] = {
            'status': 'connected' if verification.verified else 'error',
            'scopes': granted if verification.verified else [],
            'external_account_label': (verification.account_label or account_label)[:200],
            'requested_scopes': requested,
            'provider_account_id': (verification.external_account_id or None),
            'metadata': self._metadata(credential_reference),
        }
        if verification.verified:
            fields.update({'verified_at': _now(), 'last_success_at': _now(), 'last_error_at': None,
                'last_error_code': None})
        else:
            # The current verification witness is cleared, so no caller can read an old verification as a
            # working connection; `last_success_at` is deliberately left alone so the history survives.
            fields.update({'verified_at': None, 'last_error_at': _now(), 'last_error_code': 'verification_failed'})
        if connection_id is not None:
            row = await self._patch_connection(workspace_id, connection_id, fields)
        else:
            row = await self._upsert_connection(workspace_id, connected_by, provider, fields, token)
        return {'connection_id': row.get('id'), 'provider': provider, 'status': row.get('status'),
            'connected': row.get('status') == 'connected', 'verified': bool(verification.verified),
            'verified_at': row.get('verified_at'), 'last_success_at': row.get('last_success_at'),
            'account_label': row.get('external_account_label'),
            'granted_scopes': list(row.get('scopes') or []), 'requested_scopes': requested,
            'unrequested_scopes_ignored': unrequested,
            'credential_reference_recorded': bool(credential_reference),
            'credential_storage': 'reference_only',
            'via': via, 'note': note or (verification.detail or
                ('The provider confirmed this connection.' if verification.verified
                    else 'The provider did not confirm this connection, so it is not connected.')),
            'token_refresh_boundary': ('TONDE does not refresh provider tokens; the deployment vault does, and a '
                'provider that stops accepting the credential moves this connection to reauth_required.')}
