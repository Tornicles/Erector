"""Prompt 10 export HTTP surface (§27-30, §51-54).

Two products, never one:

* `Download Full Document` - a PDF or DOCX rendered from the Production version this export pins;
* `Export Production Package` - a ZIP (or its structured-data JSON) narrowed by package type.

What this surface must never do:

* claim a file exists before the database records one, so `state`, `ready_at` and the manifest are the
  only sources of truth a caller reads;
* serve an export artifact directly - there is no client read path into the private exports bucket, so
  a download is authorized per request and returned as a short-lived signed URL (or, when no server
  storage credential is configured, explicitly as `download_url: null` rather than a fake link);
* let a client drive the lifecycle: requesting is an authenticated editor RPC, and building,
  completing, failing and expiring are server outcomes recorded with evidence.

Building here is one bounded operation that claims the job's lease by name. It is not a worker fleet:
Prompt 11 owns durable execution, and this route says so in its own response.
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
from app.domain.commercial import RETRY_CLASSIFICATION, ExportRequestBody
from app.services.entitlements import EXPORT_DOCUMENT_ENTITLEMENT, EXPORT_PACKAGE_ENTITLEMENT, ensure_entitlement
from app.services.exports import EXPORT_SCHEMA_VERSION, ExportService
from app.services.rate_limit import RateLimiter

Envelope = Any

EXPORT_VOCABULARY: dict[str, Any] = {
    'products': {
        'full_document': {'label': 'Download Full Document', 'formats': ['pdf', 'docx'],
            'note': 'Rendered from the exact Production version this export pins.'},
        'production_package': {'label': 'Export Production Package', 'formats': ['zip', 'json'],
            'note': 'A ZIP described file by file by its manifest, or its structured-data JSON.'},
    },
    'states': {'requested': 'Requested', 'building': 'Building', 'ready': 'Ready to download',
        'failed': 'Failed', 'expired': 'Expired'},
    'package_types': ['complete', 'script', 'shot_list', 'storyboard', 'prompt_pack', 'camera_plan',
        'continuity_report', 'audio_plan', 'edit_plan', 'structured_data'],
    'retry': {action: RETRY_CLASSIFICATION[action] for action in ('export_build', 'export_download')},
    'boundary': ('An export is built from the Production version it pins. If that version cannot be '
        'reconstructed the export fails truthfully instead of exporting current state.'),
}


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_EXPORT_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _bounded_int(request: Request, name: str, default: int, *, low: int = 1, high: int = 200) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == '':
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_EXPORT_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def _decorate(row: dict[str, Any], *, download_url: str | None = None) -> dict[str, Any]:
    """Add only what the database does not already know: what the creator may do next."""

    state = str(row.get('state') or '')
    decorated = dict(row)
    decorated['downloadable'] = state == 'ready'
    decorated['retry'] = RETRY_CLASSIFICATION['export_build'] if state == 'failed' else None
    if download_url is not None:
        decorated['download_url'] = download_url
    decorated['note'] = {
        'requested': 'The export is requested and pinned to a Production version. No file exists yet.',
        'building': 'A build is underway under an explicit lease.',
        'ready': 'The artifact exists in the private exports bucket; downloads are authorized per request.',
        'failed': 'The build recorded a failure and its cause. A new export must be requested.',
        'expired': 'This export expired and no longer authorizes downloads.',
    }.get(state, '')
    decorated['schema_version'] = EXPORT_SCHEMA_VERSION
    return decorated


def register_export_routes(application: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}'
    limiter = RateLimiter()
    service = ExportService

    @application.get(f'{base}/exports/vocabulary')
    async def export_vocabulary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The two products, their formats, lifecycle labels and the build boundary."""

        return envelope(request, EXPORT_VOCABULARY)

    @application.get(f'{base}/exports')
    async def list_exports(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Exports of this workspace, newest first, optionally narrowed to one Production."""

        production_id = request.query_params.get('production_id') or None
        try:
            parsed_production = UUID(production_id) if production_id else None
        except ValueError as exc:
            raise AppError('INVALID_EXPORT_INPUT', 'validation', 'That Production identifier is invalid.', 422) from exc
        rows = await service(gateway, config).list_exports(workspace_id, request.state.access_token,
            production_id=parsed_production, limit=_bounded_int(request, 'limit', 50),
            offset=_bounded_int(request, 'offset', 0, low=0, high=100000))
        return envelope(request, {'items': [_decorate(row) for row in rows], 'count': len(rows),
            'vocabulary': EXPORT_VOCABULARY})

    @application.post(f'{base}/exports')
    async def request_export(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Request an export. This creates durable work and pins a Production version - nothing else."""

        limiter.enforce('export.request', str(user.id))
        body = _validated(ExportRequestBody, await request.json(), 'Check the export request fields.')
        entitlement = EXPORT_DOCUMENT_ENTITLEMENT if body.kind == 'full_document' else EXPORT_PACKAGE_ENTITLEMENT
        capability = 'Downloading a full document' if body.kind == 'full_document' else 'Exporting a production package'
        decision = await ensure_entitlement(gateway, workspace_id, entitlement, request.state.access_token, capability)
        result = await service(gateway, config).request(workspace_id, request.state.access_token, {
            'production_id': str(body.production_id), 'kind': body.kind, 'format': body.format,
            'package_type': body.package_type})
        logger.info('export_requested', extra={'context': {'event': 'export_requested',
            'workspace_id': str(workspace_id), 'export_id': str(result.get('export_id')), 'kind': body.kind,
            'format': body.format}})
        result['entitlement'] = decision
        result['retry'] = RETRY_CLASSIFICATION['export_build']
        result['built_by'] = 'tonde-api process (Prompt 11 owns the durable worker fleet)'
        return envelope(request, result)

    @application.get(f'{base}/exports/{{export_id}}')
    async def export_detail(workspace_id: UUID, export_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One export: its pinned version, state, manifest and failure cause. No artifact is served."""

        row = await service(gateway, config).detail(workspace_id, export_id, request.state.access_token)
        return envelope(request, _decorate(row))

    @application.post(f'{base}/exports/{{export_id}}/build')
    async def build_export(workspace_id: UUID, export_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Build exactly the pinned version, in this process, under an explicit lease.

        A failure after the lease is claimed is recorded as the export's outcome, with its cause. A
        missing server storage credential is refused *before* the lease so no export is left claimed.
        """

        limiter.enforce('export.build', str(user.id))
        result = await service(gateway, config).build(workspace_id, export_id, request.state.access_token, user.id)
        logger.info('export_built', extra={'context': {'event': 'export_built', 'workspace_id': str(workspace_id),
            'export_id': str(export_id), 'state': result.get('state') if isinstance(result, dict) else None}})
        return envelope(request, result)

    @application.get(f'{base}/exports/{{export_id}}/download')
    async def download_export(workspace_id: UUID, export_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Authorize one download and return a short-lived URL, or say plainly why there is none."""

        limiter.enforce('export.download', str(user.id))
        authorized = await service(gateway, config).download(workspace_id, export_id, request.state.access_token)
        if not authorized.get('download_url'):
            authorized['note'] = ('Download authorized for this request, but no signed URL could be produced: '
                'server storage credentials are not configured in this environment.')
        authorized['retry'] = RETRY_CLASSIFICATION['export_download']
        return envelope(request, authorized)

    @application.post(f'{base}/exports/{{export_id}}/expire')
    async def expire_export(workspace_id: UUID, export_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Expire an export so it stops authorizing downloads. A system decision, recorded."""

        result = await service(gateway, config).expire(workspace_id, export_id, request.state.access_token)
        return envelope(request, result)
