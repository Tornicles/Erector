"""Prompt 10 publishing service (§15-23, §52-53, §63).

The order of operations here is the whole point:

1. **Refuse before claiming.** Capability, adapter configuration and the preview's blockers are checked
   *before* `publication_submit` records an attempt. An unconfigured provider therefore leaves no
   in-flight attempt behind, exactly as the export builder refuses before claiming its lease.
2. **The database records the intent.** `publication_submit` (service-role only) is the only way an
   attempt comes into existence. It re-validates the human authorization against the live fingerprint,
   so a changed version or destination cannot ride an older approval.
3. **The adapter performs the call.** One bounded attempt, reusing the publication's own operation id
   and idempotency key, so a retry cannot become a second real-world post.
4. **The provider's answer is recorded as it was.** Accepted, processing, succeeded, failed with a
   normalized category, or unknown — and an unknown answer is never dressed up as a failure or as a
   success. Only a recorded reconciliation can leave `unknown_remote_state`.

Nothing in this module can manufacture a human authorization, and nothing can mark a publication
published without a remote resource the destination returned.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.domain.commercial import PUBLISH_CAPABILITY, RETRY_CLASSIFICATION
from app.domain.publishing import (ObservedState, PublicationAuthorizeRequest, PublicationCreateRequest,
    PublicationReconcileRequest, PublicationStateRequest, PublicationUpdateRequest)
from app.services.integration_adapters import (AdapterRegistry, ProviderCallFailed, ProviderTimeout,
    ProviderUnavailable, PublicationOutcome, PublicationRequest, build_adapter_registry, with_timeout)

PUBLICATION_SELECT = ('id,workspace_id,production_id,production_revision,result_id,result_revision,media_id,'
    'media_checksum,destination_provider,destination_account_id,destination,destination_config,media_type,'
    'visibility,scheduled_for,title,caption,state,authorization_id,operation_id,idempotency_key,'
    'submission_attempts,last_attempt_at,submitted_at,remote_resource_type,remote_resource_id,remote_url,'
    'remote_state,last_checked_at,published_at,failed_at,failure_category,failure_code,failure_message,'
    'cancelled_at,removed_at,created_by,created_at,updated_at')

ATTEMPT_SELECT = ('id,workspace_id,publication_id,attempt_number,state,operation_id,idempotency_key,'
    'request_fingerprint,remote_resource_id,remote_url,remote_state,failure_category,failure_code,'
    'failure_message,started_at,finished_at')

# An outcome the destination gave us maps to the observation a reconciliation would record. Used only
# for reading the destination again, never for inventing a state.
OBSERVED_FROM_OUTCOME = {'succeeded': 'published', 'processing': 'processing', 'accepted': 'processing',
    'failed': 'failed', 'unknown': 'unknown_remote_state'}


class PublishingService:
    def __init__(self, gateway: SupabaseGateway, settings: Settings,
        registry: AdapterRegistry | None = None) -> None:
        self.gateway = gateway
        self.settings = settings
        self.registry = registry or build_adapter_registry(settings)

    # ------------------------------------------------------------------ credentials

    def _service_key(self) -> str:
        key = self.settings.supabase_service_role_key
        if key is None:
            raise AppError('SERVER_CREDENTIALS_REQUIRED', 'unavailable',
                'This deployment has no server credentials configured, so a publication cannot be submitted.', 503)
        return key.get_secret_value()

    # ------------------------------------------------------------------ reads

    async def list_publications(self, workspace_id: UUID, token: str, *, production_id: UUID | None = None,
        result_id: UUID | None = None, state: str | None = None, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        params = {'workspace_id': f'eq.{workspace_id}', 'select': PUBLICATION_SELECT, 'order': 'created_at.desc',
            'limit': str(limit), 'offset': str(offset)}
        if production_id is not None:
            params['production_id'] = f'eq.{production_id}'
        if result_id is not None:
            params['result_id'] = f'eq.{result_id}'
        if state:
            params['state'] = f'eq.{state}'
        data = await self.gateway.request('GET', '/rest/v1/publications', token=token, schema=True, params=params)
        return data if isinstance(data, list) else []

    async def detail(self, workspace_id: UUID, publication_id: UUID, token: str) -> dict[str, Any]:
        data = await self.gateway.request('GET', '/rest/v1/publications', token=token, schema=True,
            params={'workspace_id': f'eq.{workspace_id}', 'id': f'eq.{publication_id}',
                'select': PUBLICATION_SELECT, 'limit': '1'})
        rows = data if isinstance(data, list) else []
        if not rows:
            raise AppError('PUBLICATION_NOT_FOUND', 'not_found',
                'That publication does not exist in this workspace.', 404)
        return rows[0]

    async def attempts(self, workspace_id: UUID, publication_id: UUID, token: str) -> list[dict[str, Any]]:
        data = await self.gateway.request('GET', '/rest/v1/publication_attempts', token=token, schema=True,
            params={'workspace_id': f'eq.{workspace_id}', 'publication_id': f'eq.{publication_id}',
                'select': ATTEMPT_SELECT, 'order': 'attempt_number.desc', 'limit': '50'})
        return data if isinstance(data, list) else []

    async def authorizations(self, workspace_id: UUID, publication_id: UUID, token: str) -> list[dict[str, Any]]:
        """Every recorded authorization decision, so a creator can see what they approved and when."""

        data = await self.gateway.request('GET', '/rest/v1/publication_authorizations', token=token, schema=True,
            params={'workspace_id': f'eq.{workspace_id}', 'publication_id': f'eq.{publication_id}',
                'select': 'id,decision,actor_user_id,authorized_at,production_revision,result_revision,media_id,'
                    'media_checksum,destination_provider,destination,note',
                'order': 'authorized_at.desc', 'limit': '50'})
        return data if isinstance(data, list) else []

    async def reconciliations(self, workspace_id: UUID, publication_id: UUID, token: str) -> list[dict[str, Any]]:
        data = await self.gateway.request('GET', '/rest/v1/publication_reconciliations', token=token, schema=True,
            params={'workspace_id': f'eq.{workspace_id}', 'publication_id': f'eq.{publication_id}',
                'select': 'id,observed_state,remote_state,remote_resource_id,source,note,observed_at',
                'order': 'observed_at.desc', 'limit': '50'})
        return data if isinstance(data, list) else []

    async def preview(self, workspace_id: UUID, publication_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('publication_preview', token=token, json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id)},
            layer='Prompt 10 publishing')

    async def retry_safety(self, workspace_id: UUID, publication_id: UUID, token: str) -> str:
        value = await self.gateway.rpc_detailed('publication_retry_safety', token=token, json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id)},
            layer='Prompt 10 publishing')
        return str(value or 'requires_reconciliation_before_retry')

    async def capability(self, workspace_id: UUID, provider: str, token: str) -> str:
        try:
            value = await self.gateway.rpc_detailed('integration_capability_state', token=token, json={
                'target_workspace': str(workspace_id), 'target_provider': provider,
                'target_capability': PUBLISH_CAPABILITY}, layer='Prompt 10 integrations')
        except AppError as error:
            if error.kind == 'unavailable':
                return 'PROVIDER_NOT_IMPLEMENTED'
            raise
        return str(value or 'PROVIDER_NOT_IMPLEMENTED')

    async def status(self, workspace_id: UUID, publication_id: UUID, token: str) -> dict[str, Any]:
        """Everything a surface needs about one publication, read from what was recorded."""

        row = await self.detail(workspace_id, publication_id, token)
        try:
            preview = await self.preview(workspace_id, publication_id, token)
        except AppError as error:
            if error.kind == 'unavailable':
                preview = None
            else:
                raise
        return {'publication': row, 'preview': preview,
            'authorizations': await self.authorizations(workspace_id, publication_id, token),
            'attempts': await self.attempts(workspace_id, publication_id, token),
            'reconciliations': await self.reconciliations(workspace_id, publication_id, token),
            'retry_safety': await self.retry_safety(workspace_id, publication_id, token),
            'adapter': self.registry.describe(str(row.get('destination_provider')))}

    # ------------------------------------------------------------------ creator actions

    async def create(self, workspace_id: UUID, token: str, body: PublicationCreateRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('publication_create', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(body.production_id),
            'target_result': str(body.result_id), 'target_provider': body.provider,
            'target_media': str(body.media_id) if body.media_id else None,
            'target_destination': body.destination,
            'target_account': str(body.account_id) if body.account_id else None,
            'target_title': body.title, 'target_caption': body.caption, 'target_visibility': body.visibility,
            'target_scheduled_for': body.scheduled_for.isoformat() if body.scheduled_for else None,
            'target_config': body.config}, layer='Prompt 10 publishing')

    async def update(self, workspace_id: UUID, publication_id: UUID, token: str,
        body: PublicationUpdateRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('publication_update', token=token, json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id),
            'target_title': body.title, 'target_caption': body.caption, 'target_destination': body.destination,
            'target_config': body.config, 'target_visibility': body.visibility,
            'target_scheduled_for': body.scheduled_for.isoformat() if body.scheduled_for else None},
            layer='Prompt 10 publishing')

    async def set_state(self, workspace_id: UUID, publication_id: UUID, token: str,
        body: PublicationStateRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('publication_set_state', token=token, json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id),
            'desired': body.desired, 'note_text': body.note}, layer='Prompt 10 publishing')

    async def authorize(self, workspace_id: UUID, publication_id: UUID, token: str,
        body: PublicationAuthorizeRequest) -> dict[str, Any]:
        """The creator's publishing authority, recorded with the exact version and destination it names."""

        return await self.gateway.rpc_detailed('publication_authorize', token=token, json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id),
            'decision': body.decision, 'note_text': body.note}, layer='Prompt 10 publishing')

    async def reconcile(self, workspace_id: UUID, publication_id: UUID, token: str,
        body: PublicationReconcileRequest) -> dict[str, Any]:
        """A creator who looked at the destination records what it shows. This is a human observation."""

        return await self.gateway.rpc_detailed('publication_reconcile', token=token, json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id),
            'target_observed': body.observed, 'target_remote_resource_id': body.remote_resource_id,
            'target_remote_state': body.remote_state, 'target_failure_category': body.failure_category,
            'note_text': body.note}, layer='Prompt 10 publishing')

    # ------------------------------------------------------------------ submission

    async def submit(self, workspace_id: UUID, publication_id: UUID, token: str) -> dict[str, Any]:
        """Perform the real-world action, once, under the publication's own idempotency identity."""

        row = await self.detail(workspace_id, publication_id, token)
        provider = str(row.get('destination_provider'))
        adapter = self.registry.get(provider)
        if row.get('state') in ('submitting', 'submitted', 'processing', 'unknown_remote_state'):
            raise AppError('PUBLICATION_OUTCOME_PENDING', 'conflict',
                f'This publication is {row.get("state")}. Record the destination outcome or reconcile it before '
                'another attempt; submitting again could create a second real post.', 409)
        if row.get('state') != 'ready':
            raise AppError('PUBLICATION_NOT_READY', 'conflict',
                f'A publication is submitted from READY; this one is {row.get("state")}.', 409)
        capability = await self.capability(workspace_id, provider, token)
        if capability != 'AVAILABLE':
            # Refused before any attempt exists: the destination is not usable, and nothing was attempted.
            raise AppError('PUBLISHING_CAPABILITY_UNAVAILABLE', 'conflict',
                f'Publishing is not available for {provider}: {capability}.', 409)
        if not adapter.configured():
            return {'publication_id': str(publication_id), 'provider': provider, 'submitted': False,
                'state': row.get('state'), 'unconfigured': adapter.unconfigured_reasons(),
                'adapter': self.registry.describe(provider),
                'retry': RETRY_CLASSIFICATION['publication_submit'],
                'note': ('No provider call was made and no submission attempt was recorded, because this '
                    'deployment has not configured the credentials this destination needs.'),
                'idempotency_key': row.get('idempotency_key'), 'operation_id': row.get('operation_id')}
        preview = await self.preview(workspace_id, publication_id, token)
        if preview.get('blocked_by'):
            raise AppError('PUBLICATION_BLOCKED', 'conflict',
                'This publication cannot be submitted yet: ' + ', '.join(str(item) for item in preview['blocked_by']), 409)
        recorded = await self.gateway.rpc_detailed('publication_submit', token=self._service_key(), json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id)},
            layer='Prompt 10 publishing')
        return await self._perform(workspace_id, publication_id, token, row, recorded, adapter)

    async def _perform(self, workspace_id: UUID, publication_id: UUID, token: str, row: dict[str, Any],
        recorded: dict[str, Any], adapter: Any) -> dict[str, Any]:
        attempt_id = str(recorded.get('attempt_id'))
        payload = recorded.get('payload') or {}
        request = PublicationRequest(media_id=str(payload.get('media_id') or row.get('media_id')),
            media_checksum=str(payload.get('media_checksum') or row.get('media_checksum') or ''),
            media_type=str(payload.get('media_type') or row.get('media_type') or ''),
            title=str(payload.get('title') or row.get('title') or ''),
            caption=str(payload.get('caption') or row.get('caption') or ''),
            visibility=str(payload.get('visibility') or row.get('visibility') or 'private'),
            destination=str((recorded.get('destination') or {}).get('target') or row.get('destination') or ''),
            settings=dict(payload.get('settings') or {}),
            idempotency_key=str(recorded.get('idempotency_key') or row.get('idempotency_key') or ''),
            operation_id=str(recorded.get('operation_id') or row.get('operation_id') or ''),
            request_fingerprint=str(recorded.get('request_fingerprint') or ''))
        try:
            outcome = await with_timeout(adapter.submit(request), self.settings, action='Submitting a publication')
        except ProviderTimeout as error:
            # The action may or may not have happened at the destination. Neither claim is made.
            return await self._record(workspace_id, publication_id, attempt_id,
                PublicationOutcome(outcome='unknown', detail=str(error.user_message)))
        except ProviderCallFailed as error:
            return await self._record(workspace_id, publication_id, attempt_id,
                PublicationOutcome(outcome='failed', failure_category=error.category,
                    failure_code=error.provider_code or error.category, failure_message=error.user_message))
        except ProviderUnavailable as error:
            # Nothing was attempted after all: the attempt is recorded as unknown so the pair of facts
            # (attempt recorded, provider unreachable) is visible, and reconciliation is required.
            return await self._record(workspace_id, publication_id, attempt_id,
                PublicationOutcome(outcome='unknown', detail=str(error.user_message)))
        except Exception:
            return await self._record(workspace_id, publication_id, attempt_id,
                PublicationOutcome(outcome='unknown', detail='The provider call ended without an interpretable answer.'))
        return await self._record(workspace_id, publication_id, attempt_id, outcome)

    async def _record(self, workspace_id: UUID, publication_id: UUID, attempt_id: str,
        outcome: PublicationOutcome) -> dict[str, Any]:
        recorded = await self.gateway.rpc_detailed('publication_record_result', token=self._service_key(), json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id),
            'target_attempt': attempt_id, 'target_outcome': outcome.outcome,
            'target_remote_resource_type': outcome.remote_resource_type,
            'target_remote_resource_id': outcome.remote_resource_id, 'target_remote_url': outcome.remote_url,
            'target_remote_state': outcome.remote_state, 'target_failure_category': outcome.failure_category,
            'target_failure_code': outcome.failure_code, 'target_failure_message': outcome.failure_message},
            layer='Prompt 10 publishing')
        return {**recorded, 'attempt_id': attempt_id, 'provider_detail': outcome.detail,
            'retry': RETRY_CLASSIFICATION['publication_submit'] if recorded.get('state') in ('failed', 'draft')
                else ('REQUIRES_RECONCILIATION' if recorded.get('state') == 'unknown_remote_state'
                    else 'MUST_NOT_RETRY')}

    # ------------------------------------------------------------------ destination refresh

    async def refresh(self, workspace_id: UUID, publication_id: UUID, token: str) -> dict[str, Any]:
        """Ask the destination what it currently shows, and record the observation it gives.

        The observation is recorded through `publication_reconcile` with the **service** credential, so
        the recorded source is `provider_api`: a machine read of the destination, not a creator's
        impression of it.
        """

        row = await self.detail(workspace_id, publication_id, token)
        provider = str(row.get('destination_provider'))
        adapter = self.registry.get(provider)
        remote_id = row.get('remote_resource_id')
        if row.get('state') in ('submitting', 'unknown_remote_state') and not remote_id:
            return {'publication_id': str(publication_id), 'provider': provider, 'refreshed': False,
                'state': row.get('state'), 'retry': 'REQUIRES_RECONCILIATION',
                'note': ('This publication has no remote resource to read, so the destination state cannot be '
                    'established by querying it. A creator must record what the destination shows.')}
        if not remote_id:
            return {'publication_id': str(publication_id), 'provider': provider, 'refreshed': False,
                'state': row.get('state'),
                'note': 'This publication was never submitted, so there is no destination state to read.'}
        if not adapter.configured():
            return {'publication_id': str(publication_id), 'provider': provider, 'refreshed': False,
                'state': row.get('state'), 'unconfigured': adapter.unconfigured_reasons(),
                'retry': 'REQUIRES_RECONCILIATION',
                'note': ('The destination could not be queried because this deployment has not configured its '
                    'credentials. A creator may record what the destination shows instead.')}
        try:
            observed = await with_timeout(adapter.remote_state(remote_resource_id=str(remote_id)), self.settings,
                action='Reading the destination state')
        except (ProviderTimeout, ProviderCallFailed) as error:
            raise AppError('PROVIDER_TIMEOUT' if isinstance(error, ProviderTimeout) else 'PROVIDER_CALL_FAILED',
                'provider', 'The destination state could not be read, so nothing was recorded.', 502) from error
        except ProviderUnavailable as error:
            return {'publication_id': str(publication_id), 'provider': provider, 'refreshed': False,
                'state': row.get('state'), 'unconfigured': adapter.unconfigured_reasons(),
                'note': str(error.user_message)}
        observed_state = self._observed_state(observed, bool(row.get('remote_resource_id')))
        recorded = await self.gateway.rpc_detailed('publication_reconcile', token=self._service_key(), json={
            'target_workspace': str(workspace_id), 'target_publication': str(publication_id),
            'target_observed': observed_state, 'target_remote_resource_id': observed.remote_resource_id,
            'target_remote_state': observed.remote_state,
            'target_failure_category': observed.failure_category or ('unknown' if observed_state == 'failed' else None),
            'note_text': 'Destination state read by the trusted server.'}, layer='Prompt 10 publishing')
        return {**recorded, 'refreshed': True, 'provider': provider, 'retry': 'SAFE_TO_RETRY',
            'adapter': self.registry.describe(provider)}

    @staticmethod
    def _observed_state(outcome: PublicationOutcome, had_resource: bool) -> ObservedState:
        """Translate a destination read into an observation. An unclear answer stays unknown."""

        state = OBSERVED_FROM_OUTCOME.get(outcome.outcome, 'unknown_remote_state')
        if state == 'published' and not (outcome.remote_resource_id or had_resource):
            return 'unknown_remote_state'
        return state  # type: ignore[return-value]

    # ------------------------------------------------------------------ vocabulary

    def vocabulary(self) -> dict[str, Any]:
        return {'provider': self.registry.describe('youtube')}
