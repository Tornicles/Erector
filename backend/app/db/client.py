from typing import Any

import httpx

from app.core.config import Settings
from app.core.errors import AppError


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
        if response.status_code >= 400:
            raise AppError('SUPABASE_REQUEST_FAILED', 'database', 'The application data request could not be completed.', 503)
        try:
            return response.json()
        except ValueError as exc:
            raise AppError('INVALID_PLATFORM_RESPONSE', 'unavailable', 'The application data platform returned an invalid response.', 503) from exc
