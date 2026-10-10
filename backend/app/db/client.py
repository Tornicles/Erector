from typing import Any

import httpx

from app.core.config import Settings
from app.core.errors import AppError, ErrorKind

# Guarded RPCs raise curated SQLSTATEs. Only these curated messages are surfaced to
# the creator; every unmapped failure stays a generic platform error so internal
# schema detail is never leaked.
RPC_ERROR_MAP: dict[str, tuple[str, ErrorKind, int]] = {
    '42501': ('DIRECTOR_ACCESS_DENIED', 'authorization', 403),
    # Optimistic-concurrency conflicts use the PostgREST PT prefix (PT409 -> HTTP 409). The plain
    # 40001 (serialization_failure) told PostgREST the failure was transient, so it retried the
    # transaction forever and the request never returned; migration 030 replaced it. The historical
    # code is still mapped so an older database cannot surface an unmapped platform error.
    'PT409': ('STUDIO_CONFLICT', 'conflict', 409),
    # The other two curated statuses the PostgREST PT prefix maps. Prompt 11 raises PT404 when a
    # Shot has no approved AI plan to compile a playbook from, and PT400 when a deletion was not
    # confirmed by naming the workspace. Without these two entries both arrived as an unmapped
    # 503, which told the creator the platform was broken instead of what to do next.
    'PT404': ('STUDIO_NOT_FOUND', 'not_found', 404),
    'PT400': ('STUDIO_INVALID_INPUT', 'validation', 400),
    '40001': ('STUDIO_CONFLICT', 'conflict', 409),
    '23514': ('STUDIO_RULE_VIOLATION', 'conflict', 409),
    '23505': ('STUDIO_CONFLICT', 'conflict', 409),
    '22023': ('STUDIO_INVALID_INPUT', 'validation', 422),
    '22001': ('STUDIO_INVALID_INPUT', 'validation', 422),
    'P0002': ('STUDIO_NOT_FOUND', 'not_found', 404),
}
FAILED_RPC_FALLBACK = AppError('SUPABASE_REQUEST_FAILED', 'database', 'The application data request could not be completed.', 503)


class SupabaseGateway:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    async def request(self, method: str, path: str, *, token: str, schema: bool = False, params: dict[str, str] | None = None, json: Any = None, prefer: str | None = None) -> Any:
        if not self.settings.configured or self.settings.supabase_publishable_key is None:
            raise AppError('SUPABASE_NOT_CONFIGURED', 'unavailable', 'The application data platform is not configured.', 503)
        headers = {'apikey': self.settings.supabase_publishable_key.get_secret_value(), 'Authorization': f'Bearer {token}'}
        if schema:
            headers['Accept-Profile'] = 'tonde'
            headers['Content-Profile'] = 'tonde'
        if prefer:
            headers['Prefer'] = prefer
        try:
            response = await self.client.request(method, f'{self.settings.supabase_url}{path}', headers=headers, params=params, json=json)
        except httpx.HTTPError as exc:
            raise AppError('SUPABASE_UNAVAILABLE', 'unavailable', 'The application data platform is temporarily unavailable.', 503) from exc
        if response.status_code in (401, 403):
            raise AppError('AUTHENTICATION_REQUIRED', 'authentication', 'Your session is invalid or expired. Please sign in again.', 401)
        if response.status_code == 404:
            raise AppError('SUPABASE_SCHEMA_MISSING', 'unavailable',
                'The application data platform has not applied the required database migration for this request.', 503)
        if response.status_code >= 400:
            detail: Any = None
            try:
                detail = response.json()
            except ValueError:
                detail = None
            code = str((detail or {}).get('code') or '') if isinstance(detail, dict) else ''
            message = str((detail or {}).get('message') or '') if isinstance(detail, dict) else ''
            if code in ('PGRST202', 'PGRST204', '42883', '42P01'):
                raise AppError('SUPABASE_SCHEMA_MISSING', 'unavailable',
                    'The application data platform has not applied the required database migration for this request.', 503)
            if code == '42501' or response.status_code == 401:
                raise AppError('DIRECTOR_ACCESS_DENIED', 'authorization',
                    'You do not have access to this workspace.', 403)
            raise AppError('SUPABASE_REQUEST_FAILED', 'database',
                message[:400] or 'The application data request could not be completed.', 503)
        try:
            return response.json()
        except ValueError as exc:
            # A write that asked for no representation answers with an empty body on success. That is a
            # completed request, not an unreadable response, and reporting it as a failure would make a
            # successful server-owned write look like an outage.
            if not response.content:
                return None
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable', 'The application data platform returned an invalid response.', 503) from exc

    async def rpc_detailed(self, name: str, *, token: str, json: Any, layer: str = 'Studio workspace') -> Any:
        """Call a guarded RPC and translate its curated SQLSTATE into a real error kind.

        A missing function means this deployment has not applied the migration that
        defines it, which must be reported as such rather than as a generic failure.
        The layer names which migration is missing, so the report is not misleading.
        """
        if not self.settings.configured or self.settings.supabase_publishable_key is None:
            raise AppError('SUPABASE_NOT_CONFIGURED', 'unavailable', 'The application data platform is not configured.', 503)
        headers = {'apikey': self.settings.supabase_publishable_key.get_secret_value(), 'Authorization': f'Bearer {token}',
            'Accept-Profile': 'tonde', 'Content-Profile': 'tonde'}
        try:
            response = await self.client.request('POST', f'{self.settings.supabase_url}/rest/v1/rpc/{name}', headers=headers, json=json)
        except httpx.HTTPError as exc:
            raise AppError('SUPABASE_UNAVAILABLE', 'unavailable', 'The application data platform is temporarily unavailable.', 503) from exc
        # 403 inside the RPC means a workspace guard rejected the caller; a 401 means no session.
        if response.status_code == 401:
            raise AppError('AUTHENTICATION_REQUIRED', 'authentication', 'Your session is invalid or expired. Please sign in again.', 401)
        body: Any = None
        try:
            body = response.json()
        except ValueError:
            body = None
        if response.status_code >= 400:
            sqlstate = str((body or {}).get('code') or '') if isinstance(body, dict) else ''
            message = str((body or {}).get('message') or '') if isinstance(body, dict) else ''
            if sqlstate in ('PGRST202', '42883'):
                raise AppError('STUDIO_SCHEMA_MISSING', 'unavailable',
                    f'This deployment has not applied the {layer} migration yet.', 503)
            mapping = RPC_ERROR_MAP.get(sqlstate)
            if mapping is None:
                raise FAILED_RPC_FALLBACK
            code, kind, status = mapping
            raise AppError(code, kind, message[:400] or f'The {layer} change could not be applied.', status)
        return body
