"""Media ingestion HTTP surface.

Creators open upload intents, obtain single-object signed Storage tokens, abandon intents, and read
whether their media is verified and usable. Paths are derived by the database and the service-role
credential is never returned to the browser. A trusted deployment server independently inspects the
stored object before verification; it does not accept client claims about observed bytes or MIME type.

The optional server seam records scanning/probing/derivation facts it actually observed. No route
claims a scan happened when no scanner is configured; the database records `not_configured` and the
surface says so.
"""

from __future__ import annotations

import hmac
import logging
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_current_user, get_gateway, require_workspace_access, require_workspace_editor
from app.domain.media import (
    DERIVATION_TYPES,
    PROCESSING_STATES,
    SCAN_STATES,
    DerivationFailureRequest,
    DerivationOutputRequest,
    DerivationRequest,
    ProbeRecordRequest,
    ProcessingStateRequest,
    ScanRecordRequest,
    UploadAbortRequest,
    UploadIntentCreateRequest,
    UploadPartRequest,
)
from app.services.media_ingestion import (
    MediaRepository,
    decorate_limits,
    decorate_status,
    vocabulary,
)

Envelope = Any
SERVER_TOKEN_HEADER = 'x-tonde-server-token'


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_MEDIA_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_MEDIA_INPUT', 'validation', message, 422) from exc


def register_media_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}'
    server = '/api/v1/media'
    repository = MediaRepository

    def require_server_token(request: Request) -> str:
        """The server ingest seam, and the service credential it calls the database with."""

        expected = config.tonde_server_token
        if expected is None or config.supabase_service_role_key is None:
            raise AppError('MEDIA_SERVER_SEAM_DISABLED', 'unavailable',
                'This deployment has not enabled the server media-ingest seam.', 503)
        provided = request.headers.get(SERVER_TOKEN_HEADER, '')
        if not provided or not hmac.compare_digest(provided, expected.get_secret_value()):
            raise AppError('SERVER_TOKEN_INVALID', 'authentication',
                'That server credential was not accepted.', 401)
        return config.supabase_service_role_key.get_secret_value()

    @application.get(f'{server}/upload-limits')
    async def upload_limits(request: Request, user: CurrentUser = Depends(get_current_user),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        data = await repository(gateway).limits(request.state.access_token)
        return envelope(request, decorate_limits(data))

    @application.get(f'{base}/media/vocabulary')
    async def media_vocabulary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        return envelope(request, vocabulary())

    @application.post(f'{base}/media/upload-intents')
    async def create_upload_intent(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Open the one protected path this upload may use, and state its limits."""

        body = _validated(UploadIntentCreateRequest, await request.json(), 'Check the upload fields.')
        data = await repository(gateway).create_intent(workspace_id, request.state.access_token,
            purpose=body.purpose, filename=body.original_filename, mime_type=body.mime_type,
            expected_bytes=body.expected_bytes,
            production_id=_uuid(body.production_id, 'That Production identifier is invalid.')
                if body.production_id else None,
            resumable=body.resumable, checksum_expected=body.checksum_expected)
        logger.info('media_upload_intent_created', extra={'context': {
            'event': 'media_upload_intent_created', 'workspace_id': str(workspace_id),
            'mime_type': body.mime_type}})
        return envelope(request, data)

    @application.post(f'{base}/media/upload-intents/{{intent_id}}/signed-upload')
    async def signed_upload(workspace_id: UUID, intent_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Mint a Storage token only after the database authorizes the creator-owned open intent."""

        data = await repository(gateway).signed_upload(
            workspace_id, request.state.access_token,
            intent_id=_uuid(intent_id, 'That upload identifier is invalid.'), settings=config)
        return envelope(request, data)

    @application.post(f'{base}/media/upload-intents/{{intent_id}}/parts')
    async def record_upload_part(workspace_id: UUID, intent_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(UploadPartRequest, await request.json(), 'Check the part fields.')
        data = await repository(gateway).record_part(workspace_id, request.state.access_token,
            intent_id=_uuid(intent_id, 'That upload identifier is invalid.'),
            part_number=body.part_number, part_bytes=body.bytes, etag=body.etag)
        return envelope(request, data)

    @application.post(f'{base}/media/upload-intents/{{intent_id}}/abort')
    async def abort_upload_intent(workspace_id: UUID, intent_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(UploadAbortRequest, await request.json(), 'Check the abort fields.')
        data = await repository(gateway).abort(workspace_id, request.state.access_token,
            intent_id=_uuid(intent_id, 'That upload identifier is invalid.'), reason=body.reason)
        logger.info('media_upload_intent_aborted', extra={'context': {
            'event': 'media_upload_intent_aborted', 'workspace_id': str(workspace_id),
            'intent_id': intent_id}})
        return envelope(request, data)

    @application.get(f'{base}/media/upload-intents/{{intent_id}}')
    async def upload_intent_status(workspace_id: UUID, intent_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        data = await repository(gateway).intent_status(workspace_id, request.state.access_token,
            intent_id=_uuid(intent_id, 'That upload identifier is invalid.'))
        return envelope(request, data)

    @application.post(f'{base}/media/upload-intents/{{intent_id}}/complete')
    async def complete_upload(workspace_id: UUID, intent_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Have the server inspect Storage and finish this creator's upload without client-supplied facts."""

        service_key = config.supabase_service_role_key
        if service_key is None:
            raise AppError('MEDIA_SIGNED_UPLOAD_UNAVAILABLE', 'unavailable',
                'This deployment has not enabled private Storage verification.', 503)
        parsed_intent_id = _uuid(intent_id, 'That upload identifier is invalid.')
        intent = await repository(gateway).intent_status(workspace_id, request.state.access_token,
            intent_id=parsed_intent_id)
        bucket = str(intent.get('bucket') or '')
        object_key = str(intent.get('object_key') or '')
        if not bucket or not object_key:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'The upload intent did not return its server-owned Storage location.', 503)
        observed = await repository(gateway).observe_storage_object(bucket=bucket, object_key=object_key)
        if not observed['object_verified']:
            raise AppError('MEDIA_OBJECT_NOT_FOUND', 'conflict',
                'Storage does not yet contain this upload. Finish uploading, then retry verification.', 409)
        data = await repository(gateway).verify(workspace_id, service_key.get_secret_value(),
            intent_id=parsed_intent_id, observed_bytes=observed['observed_bytes'],
            observed_mime=observed['observed_mime'], observed_checksum=observed['observed_checksum'],
            object_verified=True, probe={}, verifier='supabase-storage-info')
        logger.info('media_upload_verified', extra={'context': {
            'event': 'media_upload_verified', 'workspace_id': str(workspace_id),
            'intent_id': intent_id, 'state': data.get('state')}})
        return envelope(request, data)

    @application.get(f'{base}/media/{{media_id}}')
    async def media_status(workspace_id: UUID, media_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        data = await repository(gateway).media_status(workspace_id, request.state.access_token,
            media_id=_uuid(media_id, 'That media identifier is invalid.'))
        return envelope(request, decorate_status(data))

    @application.post(f'{base}/media/upload-intents/{{intent_id}}/verify')
    async def verify_upload(workspace_id: UUID, intent_id: str, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Inspect the exact stored object before recording verification; browser facts are ignored."""

        token = require_server_token(request)
        # Do not parse or accept reported bytes, MIME type, checksum, or probe facts from this seam.
        parsed_intent_id = _uuid(intent_id, 'That upload identifier is invalid.')
        intent = await repository(gateway).intent_status(workspace_id, token, intent_id=parsed_intent_id)
        bucket = str(intent.get('bucket') or '')
        object_key = str(intent.get('object_key') or '')
        if not bucket or not object_key:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'The upload intent did not return its server-owned Storage location.', 503)
        observed = await repository(gateway).observe_storage_object(bucket=bucket, object_key=object_key)
        if not observed['object_verified']:
            raise AppError('MEDIA_OBJECT_NOT_FOUND', 'conflict',
                'Storage does not yet contain this upload. Finish uploading, then retry verification.', 409)
        data = await repository(gateway).verify(workspace_id, token,
            intent_id=parsed_intent_id, observed_bytes=observed['observed_bytes'],
            observed_mime=observed['observed_mime'], observed_checksum=observed['observed_checksum'],
            object_verified=True, probe={}, verifier='supabase-storage-info')
        logger.info('media_upload_verified', extra={'context': {'event': 'media_upload_verified',
            'workspace_id': str(workspace_id), 'intent_id': intent_id, 'state': data.get('state')}})
        return envelope(request, data)

    @application.post(f'{base}/media/{{media_id}}/scan')
    async def record_scan(workspace_id: UUID, media_id: str, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        token = require_server_token(request)
        body = _validated(ScanRecordRequest, await request.json(), 'Check the scan fields.')
        if body.state not in SCAN_STATES:
            raise AppError('INVALID_MEDIA_INPUT', 'validation', 'That scan state does not exist.', 422)
        data = await repository(gateway).record_scan(token,
            media_id=_uuid(media_id, 'That media identifier is invalid.'), scanner=body.scanner,
            state=body.state, scanner_version=body.scanner_version, findings=body.findings,
            recorded_by=body.recorded_by)
        logger.info('media_scan_recorded', extra={'context': {
            'event': 'media_scan_recorded', 'workspace_id': str(workspace_id), 'media_id': media_id, 'state': body.state}})
        return envelope(request, data)

    @application.post(f'{base}/media/{{media_id}}/probe')
    async def record_probe(workspace_id: UUID, media_id: str, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        token = require_server_token(request)
        body = _validated(ProbeRecordRequest, await request.json(), 'Check the probe fields.')
        data = await repository(gateway).record_probe(token,
            media_id=_uuid(media_id, 'That media identifier is invalid.'), facts=body.facts,
            probe_tool=body.probe_tool, probe_version=body.probe_version)
        return envelope(request, data)

    @application.post(f'{base}/media/{{media_id}}/processing')
    async def record_processing_state(workspace_id: UUID, media_id: str, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        token = require_server_token(request)
        body = _validated(ProcessingStateRequest, await request.json(), 'Check the processing fields.')
        if body.state not in PROCESSING_STATES:
            raise AppError('INVALID_MEDIA_INPUT', 'validation', 'That processing state does not exist.', 422)
        data = await repository(gateway).set_processing_state(token,
            media_id=_uuid(media_id, 'That media identifier is invalid.'), state=body.state, note=body.note)
        return envelope(request, data)

    @application.post(f'{base}/media/derivations')
    async def request_derivation(workspace_id: UUID, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        token = require_server_token(request)
        body = _validated(DerivationRequest, await request.json(), 'Check the derivation fields.')
        if body.derivation_type not in DERIVATION_TYPES:
            raise AppError('INVALID_MEDIA_INPUT', 'validation', 'That derivation type does not exist.', 422)
        data = await repository(gateway).request_derivation(token,
            source_media_id=_uuid(body.source_media_id, 'That source media identifier is invalid.'),
            derivation_type=body.derivation_type, transform_key=body.transform_key,
            transform_version=body.transform_version, priority=body.priority)
        return envelope(request, data)

    @application.post(f'{base}/media/derivations/{{derivation_id}}/building')
    async def derivation_building(workspace_id: UUID, derivation_id: str, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        token = require_server_token(request)
        data = await repository(gateway).derivation_building(token,
            derivation_id=_uuid(derivation_id, 'That derivation identifier is invalid.'))
        return envelope(request, data)

    @application.post(f'{base}/media/derivations/{{derivation_id}}/complete')
    async def derivation_complete(workspace_id: UUID, derivation_id: str, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        token = require_server_token(request)
        body = _validated(DerivationOutputRequest, await request.json(), 'Check the output fields.')
        data = await repository(gateway).derivation_complete(token,
            derivation_id=_uuid(derivation_id, 'That derivation identifier is invalid.'),
            output_media_id=_uuid(body.output_media_id, 'That output media identifier is invalid.'),
            output_bytes=body.bytes, checksum=body.checksum)
        return envelope(request, data)

    @application.post(f'{base}/media/derivations/{{derivation_id}}/fail')
    async def derivation_fail(workspace_id: UUID, derivation_id: str, request: Request,
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        token = require_server_token(request)
        body = _validated(DerivationFailureRequest, await request.json(), 'Check the failure fields.')
        data = await repository(gateway).derivation_fail(token,
            derivation_id=_uuid(derivation_id, 'That derivation identifier is invalid.'),
            code=body.code, message=body.message)
        return envelope(request, data)


__all__ = ['register_media_routes', 'SERVER_TOKEN_HEADER']
