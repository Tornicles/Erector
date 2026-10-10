"""Media ingestion service: the authorized upload path, verification, and derived assets.

The database owns the pipeline. This module attaches the creator-facing vocabulary and states the
honest limits - including that no scanner is configured in this deployment - without ever reporting a
verification, a scan or a derivation that did not happen.

Boundaries this module protects:

* a client never chooses its own protected storage path; the intent derives it;
* a filename extension is never trusted over the observed MIME type and the probed facts;
* the original stays canonical and a proxy never replaces it;
* a derived asset keeps the provenance of the media it came from.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, quote, urlsplit
from uuid import UUID

import httpx

from app.core.config import Settings
from app.core.errors import AppError
from app.domain.media import (
    DERIVATION_STATES,
    PROCESSING_STATES,
    SCAN_STATES,
    UPLOAD_INTENT_STATES,
)

LAYER = 'Media ingestion'

INTENT_STATE_LABELS: dict[str, str] = {
    'created': 'Upload created', 'uploading': 'Uploading', 'completing': 'Completing',
    'verified': 'Verified', 'rejected': 'Rejected', 'expired': 'Expired', 'aborted': 'Abandoned',
}

PROCESSING_STATE_LABELS: dict[str, str] = {
    'pending': 'Waiting to be processed', 'blocked': 'Blocked', 'processing': 'Processing',
    'ready': 'Ready to use', 'failed': 'Processing failed', 'skipped': 'Processing skipped',
}

SCAN_STATE_LABELS: dict[str, str] = {
    'not_configured': 'No scanner is configured in this deployment',
    'unscanned': 'Not scanned', 'scanning': 'Scanning', 'clean': 'Clean',
    'infected': 'Infected and contained', 'error': 'The scan could not complete',
}

DERIVATION_STATE_LABELS: dict[str, str] = {
    'requested': 'Requested', 'building': 'Building', 'ready': 'Ready', 'failed': 'Failed',
    'cancelled': 'Cancelled',
}

RULE = ('An upload reaches storage only through an intent that derives its own path, and it becomes '
    'usable only after verification found what was declared. A filename extension is never evidence '
    'and a derived asset never replaces its original.')
SCANNER_RULE = ('No malware scanner is configured in this deployment. TONDE records that honestly and '
    'does not report a scan that did not happen; connecting a scanner is a deployment requirement.')


def vocabulary() -> dict[str, Any]:
    """The media vocabulary: upload, processing, scan and derivation states."""

    return {
        'upload_intent_states': [{'state': key, 'label': INTENT_STATE_LABELS[key]}
            for key in UPLOAD_INTENT_STATES],
        'processing_states': [{'state': key, 'label': PROCESSING_STATE_LABELS[key]}
            for key in PROCESSING_STATES],
        'scan_states': [{'state': key, 'label': SCAN_STATE_LABELS[key]} for key in SCAN_STATES],
        'derivation_states': [{'state': key, 'label': DERIVATION_STATE_LABELS[key]}
            for key in DERIVATION_STATES],
        'rule': RULE,
        'scanner_rule': SCANNER_RULE,
    }


def decorate_limits(data: dict[str, Any]) -> dict[str, Any]:
    """Attach the honest scanner statement to the published limits."""

    configured = bool(data.get('scanner_configured'))
    data['scanner_configured'] = configured
    data['scan_line'] = ('A scanner is configured for this deployment.' if configured else SCANNER_RULE)
    data.setdefault('scanner_rule', SCANNER_RULE)
    data.setdefault('rule', RULE)
    return data


def decorate_status(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to one media object's status."""

    if data.get('upload_state'):
        data['upload_state_label'] = INTENT_STATE_LABELS.get(str(data['upload_state']), 'Upload')
    if data.get('processing_state'):
        data['processing_state_label'] = PROCESSING_STATE_LABELS.get(str(data['processing_state']), 'Processing')
    if data.get('scan_state'):
        data['scan_state_label'] = SCAN_STATE_LABELS.get(str(data['scan_state']), 'Scan')
    data.setdefault('rule', RULE)
    return data


class MediaRepository:
    """Every call goes through the shared RPC helper with this layer's name attached."""

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def rpc(self, name: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed(name, token=token, json=payload, layer=LAYER)

    async def signed_upload(self, workspace_id: UUID, token: str, *, intent_id: UUID,
        settings: Settings) -> dict[str, Any]:
        """Authorize an exact open intent before the service credential mints its opaque upload token."""

        intent = await self.rpc('media_upload_signed_request', token, {
            'target_workspace': str(workspace_id), 'target_intent': str(intent_id)})
        service_key = settings.supabase_service_role_key
        if service_key is None or not settings.supabase_url:
            raise AppError('MEDIA_SIGNED_UPLOAD_UNAVAILABLE', 'unavailable',
                'This deployment has not enabled the private Storage upload service.', 503)

        bucket = str(intent.get('bucket') or '')
        object_key = str(intent.get('object_key') or '')
        if not bucket or not object_key:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'The upload authorization did not return its server-owned Storage location.', 503)

        path = '/'.join(quote(segment, safe='') for segment in object_key.split('/'))
        url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/upload/sign/{quote(bucket, safe='')}/{path}"
        headers = {
            'apikey': service_key.get_secret_value(),
            'Authorization': f'Bearer {service_key.get_secret_value()}',
            'Content-Type': 'application/json',
        }
        raw_authorized_max = intent.get('max_bytes')
        if raw_authorized_max is None:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'The upload authorization did not return a valid Storage size ceiling.', 503)
        try:
            authorized_max = int(raw_authorized_max)
        except (TypeError, ValueError) as exc:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'The upload authorization did not return a valid Storage size ceiling.', 503) from exc
        try:
            bucket_response = await self.gateway.client.get(
                f"{settings.supabase_url.rstrip('/')}/storage/v1/bucket/{quote(bucket, safe='')}",
                headers={'apikey': service_key.get_secret_value(),
                    'Authorization': f'Bearer {service_key.get_secret_value()}'}, timeout=15)
        except httpx.HTTPError as exc:
            raise AppError('MEDIA_STORAGE_UNAVAILABLE', 'unavailable',
                'Private Storage could not confirm this bucket’s upload limit.', 503) from exc
        if bucket_response.status_code >= 400:
            raise AppError('MEDIA_STORAGE_UNAVAILABLE', 'unavailable',
                'Private Storage could not confirm this bucket’s upload limit.', 503)
        try:
            bucket_info = bucket_response.json()
            bucket_max = int(bucket_info.get('file_size_limit'))
        except (ValueError, TypeError, AttributeError) as exc:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage returned an invalid bucket upload limit.', 503) from exc
        if bucket_max < 1:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage has no usable per-bucket upload size limit.', 503)
        effective_max = min(authorized_max, bucket_max)
        expected_bytes = intent.get('expected_bytes')
        if expected_bytes is not None and int(expected_bytes) > effective_max:
            raise AppError('MEDIA_BUCKET_LIMIT_CHANGED', 'validation',
                'This upload is larger than the current Storage bucket limit. Start a new upload within the published limit.', 413)
        allowed_mimes = bucket_info.get('allowed_mime_types')
        if allowed_mimes is not None and (not isinstance(allowed_mimes, list)
            or intent.get('expected_mime_type') not in allowed_mimes):
            raise AppError('MEDIA_BUCKET_MIME_UNAVAILABLE', 'validation',
                'This file type is no longer allowed by the current Storage bucket configuration.', 415)
        try:
            response = await self.gateway.client.post(url, headers=headers, json={}, timeout=15)
        except httpx.HTTPError as exc:
            raise AppError('MEDIA_STORAGE_UNAVAILABLE', 'unavailable',
                'Private Storage could not create a signed upload token. Retry the upload.', 503) from exc
        if response.status_code >= 400:
            raise AppError('MEDIA_STORAGE_UNAVAILABLE', 'unavailable',
                'Private Storage could not create a signed upload token. Retry the upload.', 503)
        try:
            signed = response.json()
        except ValueError as exc:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage returned an invalid signed upload response.', 503) from exc
        storage_path = signed.get('url') if isinstance(signed, dict) else None
        supplied_token = signed.get('token') if isinstance(signed, dict) else None
        if not isinstance(storage_path, str) or not storage_path:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage did not return the signed upload path.', 503)
        expected_path = f"/storage/v1/object/upload/sign/{quote(bucket, safe='')}/{path}"
        parsed_path = urlsplit(storage_path)
        expected_storage_base = urlsplit(settings.supabase_url.rstrip('/'))
        if parsed_path.scheme or parsed_path.netloc:
            if parsed_path.scheme != expected_storage_base.scheme or parsed_path.netloc != expected_storage_base.netloc:
                raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                    'Private Storage returned an upload URL for an unexpected host.', 503)
            returned_path = parsed_path.path
        else:
            returned_path = parsed_path.path
            if returned_path.startswith('/object/'):
                returned_path = f'/storage/v1{returned_path}'
        if returned_path != expected_path:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage returned an upload URL for an unexpected object path.', 503)
        token_candidates = parse_qs(parsed_path.query).get('token', [])
        token_value = token_candidates[0] if token_candidates else supplied_token
        if not isinstance(token_value, str) or not token_value:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage did not return the signed upload token.', 503)
        storage_upload_url = f"{settings.supabase_url.rstrip('/')}{expected_path}"
        return {
            'intent_id': str(intent_id), 'media_id': intent.get('media_id'), 'bucket': bucket,
            'object_key': object_key, 'token': token_value, 'upload_url': storage_upload_url,
            'mime_type': intent.get('expected_mime_type'),
            'max_bytes': effective_max, 'expected_bytes': expected_bytes,
            'expires_at': intent.get('expires_at'),
            'token_expires_in_seconds': 7200,
            'upsert': False,
            'meaning': 'A one-object Storage upload token was issued for this still-open creator-owned intent. The object is not usable until the independent server verifier checks it.',
        }

    async def observe_storage_object(self, *, bucket: str, object_key: str) -> dict[str, Any]:
        """Read server-controlled Storage metadata and derive only directly observed file facts."""

        service_key = self.gateway.settings.supabase_service_role_key
        if service_key is None or not self.gateway.settings.supabase_url:
            raise AppError('MEDIA_SERVER_SEAM_DISABLED', 'unavailable',
                'This deployment has not enabled private Storage verification.', 503)
        path = '/'.join(quote(segment, safe='') for segment in object_key.split('/'))
        url = f"{self.gateway.settings.supabase_url.rstrip('/')}/storage/v1/object/info/{quote(bucket, safe='')}/{path}"
        headers = {
            'apikey': service_key.get_secret_value(),
            'Authorization': f'Bearer {service_key.get_secret_value()}',
        }
        try:
            response = await self.gateway.client.get(url, headers=headers, timeout=15)
        except httpx.HTTPError as exc:
            raise AppError('MEDIA_STORAGE_UNAVAILABLE', 'unavailable',
                'Private Storage could not inspect this upload. Retry verification.', 503) from exc
        if response.status_code == 404:
            return {'object_verified': False}
        if response.status_code >= 400:
            raise AppError('MEDIA_STORAGE_UNAVAILABLE', 'unavailable',
                'Private Storage could not inspect this upload. Retry verification.', 503)
        try:
            info = response.json()
        except ValueError as exc:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage returned invalid object metadata.', 503) from exc
        if not isinstance(info, dict):
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage returned invalid object metadata.', 503)
        try:
            size = int(info.get('size') or info.get('metadata', {}).get('size') or 0)
        except (TypeError, ValueError) as exc:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage returned an invalid object size.', 503) from exc
        content_type = info.get('content_type') or info.get('metadata', {}).get('mimetype')
        if size < 1 or not isinstance(content_type, str) or not content_type:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'Private Storage did not return the uploaded object size and MIME type.', 503)
        return {
            'object_verified': True,
            'observed_bytes': size,
            'observed_mime': content_type,
            # ETag is not represented as a cryptographic content checksum unless Storage explicitly
            # says the object was checksummed. Do not upgrade an opaque etag to sha256.
            'observed_checksum': info.get('checksum') if isinstance(info.get('checksum'), str) else None,
            'etag': info.get('etag') or info.get('metadata', {}).get('eTag'),
            'storage_version': info.get('version'),
        }

    async def limits(self, token: str) -> dict[str, Any]:
        data = await self.rpc('media_upload_limits', token, {})
        service_key = self.gateway.settings.supabase_service_role_key
        if service_key is None or not self.gateway.settings.supabase_url:
            raise AppError('MEDIA_STORAGE_LIMIT_UNAVAILABLE', 'unavailable',
                'The deployment cannot confirm its private Storage bucket limits.', 503)
        purposes = data.get('purposes')
        if not isinstance(purposes, list):
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                'The application data platform returned invalid upload limits.', 503)
        bucket_ids = {
            'result': 'tonde-results', 'reference': 'tonde-asset-references',
            'asset': 'tonde-asset-references', 'attachment': 'tonde-production-media',
            'export_artifact': 'tonde-exports',
        }
        path = f"{self.gateway.settings.supabase_url.rstrip('/')}/storage/v1/bucket/"
        headers = {'apikey': service_key.get_secret_value(),
            'Authorization': f'Bearer {service_key.get_secret_value()}'}
        bucket_limits: dict[str, dict[str, Any]] = {}
        for item in purposes:
            bucket = bucket_ids.get(item.get('purpose'))
            if bucket is None:
                continue
            if bucket not in bucket_limits:
                try:
                    response = await self.gateway.client.get(f'{path}{quote(bucket, safe="")}',
                        headers=headers, timeout=15)
                except httpx.HTTPError as exc:
                    raise AppError('MEDIA_STORAGE_LIMIT_UNAVAILABLE', 'unavailable',
                        'The deployment cannot confirm its private Storage bucket limits.', 503) from exc
                if response.status_code >= 400:
                    raise AppError('MEDIA_STORAGE_LIMIT_UNAVAILABLE', 'unavailable',
                        'The deployment cannot confirm its private Storage bucket limits.', 503)
                try:
                    info = response.json()
                    limit = int(info.get('file_size_limit'))
                    mimes = info.get('allowed_mime_types')
                except (ValueError, TypeError, AttributeError) as exc:
                    raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                        'Private Storage returned invalid bucket upload limits.', 503) from exc
                if limit < 1 or (mimes is not None and not isinstance(mimes, list)):
                    raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable',
                        'Private Storage returned incomplete bucket upload limits.', 503)
                bucket_limits[bucket] = {'max_bytes': limit,
                    'allowed_mime_types': set(mimes) if mimes is not None else None}
            limits = bucket_limits[bucket]
            item['max_bytes'] = min(int(item['max_bytes']), limits['max_bytes'])
            if limits['allowed_mime_types'] is not None:
                item['supported_mime_types'] = sorted(
                    set(item.get('supported_mime_types', [])) & limits['allowed_mime_types'])
            item['bucket'] = bucket
        effective_mimes = sorted({mime for item in purposes
            for mime in item.get('supported_mime_types', [])})
        data['purposes'] = purposes
        data['supported_mime_types'] = effective_mimes
        data['storage_limits_verified'] = True
        return data

    async def create_intent(self, workspace_id: UUID, token: str, *, purpose: str, filename: str,
        mime_type: str, expected_bytes: int | None, production_id: UUID | None, resumable: bool,
        checksum_expected: str | None) -> dict[str, Any]:
        return await self.rpc('media_upload_intent_create', token, {
            'target_workspace': str(workspace_id), 'p_purpose': purpose,
            'p_original_filename': filename, 'p_mime_type': mime_type,
            'p_expected_bytes': expected_bytes,
            'target_production': str(production_id) if production_id else None,
            'p_resumable': resumable, 'p_checksum_expected': checksum_expected})

    async def record_part(self, workspace_id: UUID, token: str, *, intent_id: UUID, part_number: int,
        part_bytes: int, etag: str | None) -> dict[str, Any]:
        return await self.rpc('media_upload_part', token, {
            'target_workspace': str(workspace_id), 'target_intent': str(intent_id),
            'p_part_number': part_number, 'p_bytes': part_bytes, 'p_etag': etag})

    async def verify(self, workspace_id: UUID, token: str, *, intent_id: UUID, observed_bytes: int,
        observed_mime: str, observed_checksum: str | None, object_verified: bool, probe: dict,
        verifier: str) -> dict[str, Any]:
        return await self.rpc('media_upload_verify', token, {
            'target_workspace': str(workspace_id), 'target_intent': str(intent_id),
            'p_observed_bytes': observed_bytes, 'p_observed_mime': observed_mime,
            'p_observed_checksum': observed_checksum, 'p_object_verified': object_verified,
            'p_probe': probe, 'p_verifier': verifier})

    async def abort(self, workspace_id: UUID, token: str, *, intent_id: UUID, reason: str) -> dict[str, Any]:
        return await self.rpc('media_upload_abort', token, {
            'target_workspace': str(workspace_id), 'target_intent': str(intent_id), 'p_reason': reason})

    async def intent_status(self, workspace_id: UUID, token: str, *, intent_id: UUID) -> dict[str, Any]:
        return await self.rpc('media_upload_intent_status', token, {
            'target_workspace': str(workspace_id), 'target_intent': str(intent_id)})

    async def media_status(self, workspace_id: UUID, token: str, *, media_id: UUID) -> dict[str, Any]:
        return await self.rpc('media_status', token, {
            'target_workspace': str(workspace_id), 'target_media': str(media_id)})

    async def expire_intents(self, token: str, *, limit: int) -> dict[str, Any]:
        return await self.rpc('media_intent_expire', token, {'p_limit': limit})

    async def record_scan(self, token: str, *, media_id: UUID, scanner: str, state: str,
        scanner_version: str, findings: list, recorded_by: str) -> dict[str, Any]:
        return await self.rpc('media_scan_record', token, {
            'target_media': str(media_id), 'p_scanner': scanner, 'p_state': state,
            'p_scanner_version': scanner_version, 'p_findings': findings, 'p_recorded_by': recorded_by})

    async def record_probe(self, token: str, *, media_id: UUID, facts: dict, probe_tool: str,
        probe_version: str) -> dict[str, Any]:
        return await self.rpc('media_probe_record', token, {
            'target_media': str(media_id), 'p_facts': facts, 'p_probe_tool': probe_tool,
            'p_probe_version': probe_version})

    async def set_processing_state(self, token: str, *, media_id: UUID, state: str,
        note: str) -> dict[str, Any]:
        return await self.rpc('media_processing_state', token, {
            'target_media': str(media_id), 'p_state': state, 'p_note': note})

    async def request_derivation(self, token: str, *, source_media_id: UUID, derivation_type: str,
        transform_key: str, transform_version: str, priority: int | None) -> dict[str, Any]:
        return await self.rpc('media_derivation_request', token, {
            'target_source': str(source_media_id), 'p_derivation_type': derivation_type,
            'p_transform_key': transform_key, 'p_transform_version': transform_version,
            'target_priority': priority})

    async def derivation_building(self, token: str, *, derivation_id: UUID) -> dict[str, Any]:
        return await self.rpc('media_derivation_building', token, {'target_derivation': str(derivation_id)})

    async def derivation_complete(self, token: str, *, derivation_id: UUID, output_media_id: UUID,
        output_bytes: int | None, checksum: str | None) -> dict[str, Any]:
        return await self.rpc('media_derivation_complete', token, {
            'target_derivation': str(derivation_id), 'p_output_media_id': str(output_media_id),
            'p_bytes': output_bytes, 'p_checksum': checksum})

    async def derivation_fail(self, token: str, *, derivation_id: UUID, code: str,
        message: str) -> dict[str, Any]:
        return await self.rpc('media_derivation_fail', token, {
            'target_derivation': str(derivation_id), 'p_code': code, 'p_message': message})


__all__ = ['MediaRepository', 'LAYER', 'RULE', 'SCANNER_RULE', 'decorate_limits', 'decorate_status',
    'vocabulary']
