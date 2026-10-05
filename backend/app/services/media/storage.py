"""Object storage fetch for reference media.

Uploads are analysed from bytes supplied by the creator. When only a media ID is
available, TONDE asks the platform for a short-lived signed URL and downloads the
object server-side. A failure here is reported as an unavailable capability, never
as analysed content.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx

from app.core.errors import AppError
from app.db.client import SupabaseGateway

SIGNED_READ_TTL_SECONDS = 120
MAX_ANALYSIS_BYTES = 64 * 1024 * 1024


class StorageMediaUnavailable(Exception):
    """The object could not be read, so no analysis can honestly run."""


class SupabaseMediaFetcher:
    def __init__(self, gateway: SupabaseGateway) -> None:
        self.gateway = gateway

    async def fetch(self, workspace_id: UUID, media_id: UUID, token: str) -> tuple[bytes, str, str]:
        rows = await self.gateway.request(
            'GET', '/rest/v1/media_files', token=token, schema=True,
            params={
                'workspace_id': f'eq.{workspace_id}', 'id': f'eq.{media_id}',
                'select': 'id,bucket,object_key,mime_type,original_filename,bytes,upload_state', 'limit': '1',
            },
        )
        if not rows:
            raise StorageMediaUnavailable('That media file is not available in this workspace.')
        row: dict[str, Any] = rows[0]
        if row.get('upload_state') != 'uploaded':
            raise StorageMediaUnavailable('That upload has not completed, so there is nothing to analyse yet.')
        declared = int(row.get('bytes') or 0)
        if declared > MAX_ANALYSIS_BYTES:
            raise StorageMediaUnavailable('That file is larger than this analysis path supports; no partial file is analysed.')
        bucket = str(row['bucket'])
        object_key = str(row['object_key'])
        signed = await self.gateway.request(
            'POST', f'/storage/v1/object/sign/{bucket}/{object_key}', token=token,
            json={'expiresIn': SIGNED_READ_TTL_SECONDS},
        )
        signed_url = (signed or {}).get('signedURL') if isinstance(signed, dict) else None
        if not signed_url:
            raise StorageMediaUnavailable('A temporary read link could not be created for that file.')
        url = signed_url if str(signed_url).startswith('http') else f'{self.gateway.settings.supabase_url}/storage/v1{str(signed_url).split("storage/v1")[-1]}'
        try:
            response = await self.gateway.client.get(url, timeout=60)
        except httpx.HTTPError as exc:
            raise StorageMediaUnavailable('That file could not be downloaded for analysis.') from exc
        if response.status_code >= 400:
            raise StorageMediaUnavailable(f'The storage provider refused the download ({response.status_code}).')
        payload = response.content
        if not payload:
            raise StorageMediaUnavailable('That file downloaded empty, so nothing can be analysed.')
        if len(payload) > MAX_ANALYSIS_BYTES:
            raise StorageMediaUnavailable('That file is larger than this analysis path supports.')
        return payload, str(row.get('mime_type') or 'application/octet-stream'), str(row.get('original_filename') or 'reference')


def decode_base64_payload(data_base64: str, *, max_bytes: int = MAX_ANALYSIS_BYTES) -> bytes:
    import base64
    import binascii

    if not data_base64:
        raise AppError('REFERENCE_MEDIA_MISSING', 'validation', 'Provide the uploaded media for analysis.', 422)
    if len(data_base64) > max_bytes * 2:
        raise AppError('REFERENCE_MEDIA_TOO_LARGE', 'validation', 'That upload is too large for this analysis path.', 413)
    try:
        payload = base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise AppError('REFERENCE_MEDIA_INVALID', 'validation', 'That upload could not be decoded.', 422) from exc
    if not payload:
        raise AppError('REFERENCE_MEDIA_MISSING', 'validation', 'The uploaded media is empty, so nothing can be analysed.', 422)
    if len(payload) > max_bytes:
        raise AppError('REFERENCE_MEDIA_TOO_LARGE', 'validation', 'That upload is too large for this analysis path.', 413)
    return payload
