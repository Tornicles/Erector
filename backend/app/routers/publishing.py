"""Prompt 10 publishing HTTP surface (§15-23, §52, §87).

The surface is deliberately shaped so the creator's authority is visible at every step:

* choose an approved Result, a destination provider and an authorized account;
* review the **exact pinned revision, checksum and destination** and every reason a submission is
  blocked, before anything leaves;
* edit only the permitted publication metadata;
* preview, then **explicitly authorize** — a separate, recorded act with its own actor;
* submit, then inspect the attempt, the destination's answer and the remote resource;
* reconcile an ambiguous destination state.

A creative approval of a Result is never accepted here as publishing authority. There is no route that
turns `approval = approved` into `authorization_id`, and none that lets an AI or a service create one.
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
from app.domain.commercial import PUBLICATION_STATE_LABELS, RETRY_CLASSIFICATION
from app.domain.publishing import (PERMITTED_SETTINGS_KEYS, PublicationAuthorizeRequest, PublicationCreateRequest,
    PublicationReconcileRequest, PublicationStateRequest, PublicationUpdateRequest)
from app.services.entitlements import PUBLISHING_ENTITLEMENT, ensure_entitlement
from app.services.publishing import PublishingService
from app.services.rate_limit import RateLimiter

Envelope = Any

PUBLISHING_VOCABULARY: dict[str, Any] = {
    'states': PUBLICATION_STATE_LABELS,
    'failure_categories': {
        'authentication_failed': 'The destination rejected the credential; reauthorize the account.',
        'insufficient_scope': 'The connected account did not grant a scope this destination requires.',
        'rate_limited': 'The destination asked TONDE to slow down. The same operation may be retried.',
        'invalid_media': 'The destination refused the file itself.',
        'invalid_metadata': 'The destination refused the title, caption or settings.',
        'provider_unavailable': 'The destination was unreachable. Nothing was changed there.',
        'quota_exceeded': 'The destination account has no remaining allowance.',
        'remote_processing_failed': 'The destination took the upload and then failed to process it.',
        'destination_rejected': 'The destination refused the placement.',
        'policy_violation': 'The destination refused the content under its own rules.',
        'unknown': 'TONDE could not establish the cause. Reconcile before another attempt.',
    },
    'permitted_settings_keys': list(PERMITTED_SETTINGS_KEYS),
    'authority_law': ('Publishing requires an explicit recorded creator authorization naming the exact Production '
        'revision, Result revision, media checksum and destination. A creative approval is not publishing '
        'authority, and no service or AI may record one.'),
    'retry': {action: RETRY_CLASSIFICATION[action] for action in ('publication_submit', 'publication_status',
        'publication_reconcile')},
    'unknown_state_law': ('An ambiguous destination answer becomes unknown_remote_state and is never reported as '
        'published or as failed; only a recorded reconciliation leaves it.'),
    'provider_boundary': 'The provider call is made by the trusted server through a bounded adapter. The browser never holds a provider token.',
}


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_PUBLICATION_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _bounded_int(request: Request, name: str, default: int, *, low: int = 1, high: int = 200) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == '':
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_PUBLICATION_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def register_publishing_routes(application: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}'
    limiter = RateLimiter()
    service = PublishingService

    @application.get(f'{base}/publishing/vocabulary')
    async def publishing_vocabulary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        return envelope(request, PUBLISHING_VOCABULARY)

    @application.get(f'{base}/publications')
    async def list_publications(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Publications of this workspace with the state label a surface shows."""

        query = request.query_params
        try:
            production_id = UUID(query['production_id']) if query.get('production_id') else None
            result_id = UUID(query['result_id']) if query.get('result_id') else None
        except ValueError as exc:
            raise AppError('INVALID_PUBLICATION_INPUT', 'validation',
                'That Production or Result identifier is invalid.', 422) from exc
        rows = await service(gateway, config).list_publications(workspace_id, request.state.access_token,
            production_id=production_id, result_id=result_id, state=query.get('state') or None,
            limit=_bounded_int(request, 'limit', 50), offset=_bounded_int(request, 'offset', 0, low=0, high=100000))
        items = [{**row, 'state_label': PUBLICATION_STATE_LABELS.get(str(row.get('state')), ''),
            'remote_url': row.get('remote_url'), 'failure_category': row.get('failure_category')} for row in rows]
        return envelope(request, {'items': items, 'count': len(items), 'vocabulary': PUBLISHING_VOCABULARY})

    @application.post(f'{base}/publications')
    async def create_publication(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Describe an intended placement. Nothing is submitted and nothing is authorized yet."""

        body = _validated(PublicationCreateRequest, await request.json(), 'Check the publication fields.')
        decision = await ensure_entitlement(gateway, workspace_id, PUBLISHING_ENTITLEMENT,
            request.state.access_token, 'Publishing to a destination')
        result = await service(gateway, config).create(workspace_id, request.state.access_token, body)
        result['entitlement'] = decision
        result['retry'] = RETRY_CLASSIFICATION['publication_submit']
        return envelope(request, result)

    @application.get(f'{base}/publications/{{publication_id}}')
    async def publication_status(workspace_id: UUID, publication_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Status, pins, blockers, attempts, authorizations and reconciliations — all from what was recorded."""

        limiter.enforce('publication.preview', str(user.id))
        status = await service(gateway, config).status(workspace_id, publication_id, request.state.access_token)
        status['vocabulary'] = PUBLISHING_VOCABULARY
        return envelope(request, status)

    @application.get(f'{base}/publications/{{publication_id}}/preview')
    async def preview_publication(workspace_id: UUID, publication_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The exact content a creator is about to place, plus every reason it cannot go out yet."""

        limiter.enforce('publication.preview', str(user.id))
        preview = await service(gateway, config).preview(workspace_id, publication_id, request.state.access_token)
        preview['permitted_settings_keys'] = list(PERMITTED_SETTINGS_KEYS)
        preview['vocabulary'] = PUBLISHING_VOCABULARY
        return envelope(request, preview)

    @application.patch(f'{base}/publications/{{publication_id}}')
    async def update_publication(workspace_id: UUID, publication_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Edit the permitted publication metadata while the publication is still editable."""

        body = _validated(PublicationUpdateRequest, await request.json(), 'Check the publication fields.')
        result = await service(gateway, config).update(workspace_id, publication_id, request.state.access_token, body)
        result['retry'] = RETRY_CLASSIFICATION['publication_submit']
        return envelope(request, result)

    @application.post(f'{base}/publications/{{publication_id}}/state')
    async def set_publication_state(workspace_id: UUID, publication_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """A creator moves a publication between the states a creator owns."""

        body = _validated(PublicationStateRequest, await request.json(), 'Check the publication state fields.')
        return envelope(request, await service(gateway, config).set_state(workspace_id, publication_id,
            request.state.access_token, body))

    @application.post(f'{base}/publications/{{publication_id}}/authorize')
    async def authorize_publication(workspace_id: UUID, publication_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The creator's explicit publishing authority, naming this exact version and destination."""

        body = _validated(PublicationAuthorizeRequest, await request.json(), 'Check the authorization fields.')
        result = await service(gateway, config).authorize(workspace_id, publication_id, request.state.access_token, body)
        logger.info('publication_authorized', extra={'context': {'event': 'publication_authorized',
            'workspace_id': str(workspace_id), 'publication_id': str(publication_id), 'decision': body.decision}})
        result['creative_approval_used_as_authority'] = False
        return envelope(request, result)

    @application.post(f'{base}/publications/{{publication_id}}/submit')
    async def submit_publication(workspace_id: UUID, publication_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Submit. The adapter performs one bounded call; the destination's own answer is recorded."""

        limiter.enforce('publication.submit', str(user.id))
        decision = await ensure_entitlement(gateway, workspace_id, PUBLISHING_ENTITLEMENT,
            request.state.access_token, 'Publishing to a destination')
        result = await service(gateway, config).submit(workspace_id, publication_id, request.state.access_token)
        result['entitlement'] = decision
        result['verified_by_tonde'] = 'the trusted server performed the call through this destination adapter'
        logger.info('publication_submitted', extra={'context': {'event': 'publication_submitted',
            'workspace_id': str(workspace_id), 'publication_id': str(publication_id), 'state': result.get('state')}})
        return envelope(request, result)

    @application.post(f'{base}/publications/{{publication_id}}/refresh')
    async def refresh_publication(workspace_id: UUID, publication_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Read the destination and record what it actually shows, as a `provider_api` observation."""

        limiter.enforce('publication.refresh', str(user.id))
        result = await service(gateway, config).refresh(workspace_id, publication_id, request.state.access_token)
        return envelope(request, result)

    @application.post(f'{base}/publications/{{publication_id}}/reconcile')
    async def reconcile_publication(workspace_id: UUID, publication_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """A creator records what the destination shows. This is the documented way out of an unknown state."""

        limiter.enforce('publication.reconcile', str(user.id))
        body = _validated(PublicationReconcileRequest, await request.json(), 'Check the reconciliation fields.')
        result = await service(gateway, config).reconcile(workspace_id, publication_id, request.state.access_token, body)
        logger.info('publication_reconciled', extra={'context': {'event': 'publication_reconciled',
            'workspace_id': str(workspace_id), 'publication_id': str(publication_id), 'observed': body.observed}})
        return envelope(request, result)
