import logging
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, ValidationError

from app.core.errors import AppError
from app.db.client import SupabaseGateway

logger = logging.getLogger('tonde.auth')
bearer = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: UUID


def get_gateway(request: Request) -> SupabaseGateway:
    return request.app.state.gateway


async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer), gateway: SupabaseGateway = Depends(get_gateway)) -> CurrentUser:
    if credentials is None or len(credentials.credentials) > 16384:
        raise AppError('AUTHENTICATION_REQUIRED', 'authentication', 'Sign in to continue.', 401)
    try:
        data = await gateway.request('GET', '/auth/v1/user', token=credentials.credentials)
        user = CurrentUser.model_validate(data)
    except ValidationError as exc:
        raise AppError('AUTHENTICATION_REQUIRED', 'authentication', 'Your session is invalid. Please sign in again.', 401) from exc
    except AppError:
        logger.warning('auth_failure', extra={'context': {'event': 'authentication_failure', 'request_id': getattr(request.state, 'request_id', None)}})
        raise
    request.state.access_token = credentials.credentials
    return user


async def require_workspace_access(workspace_id: UUID, request: Request, user: CurrentUser = Depends(get_current_user), gateway: SupabaseGateway = Depends(get_gateway)) -> CurrentUser:
    rows = await gateway.request('GET', '/rest/v1/workspace_members', token=request.state.access_token, schema=True,
        params={'workspace_id': f'eq.{workspace_id}', 'user_id': f'eq.{user.id}', 'select': 'role', 'limit': '1'})
    if not rows:
        raise AppError('WORKSPACE_ACCESS_DENIED', 'authorization', 'You do not have access to this workspace.', 403)
    return user


async def require_workspace_editor(workspace_id: UUID, request: Request, user: CurrentUser = Depends(get_current_user), gateway: SupabaseGateway = Depends(get_gateway)) -> CurrentUser:
    rows = await gateway.request('GET', '/rest/v1/workspace_members', token=request.state.access_token, schema=True,
        params={'workspace_id': f'eq.{workspace_id}', 'user_id': f'eq.{user.id}', 'role': 'in.(owner,admin,editor)', 'select': 'role', 'limit': '1'})
    if not rows:
        raise AppError('WORKSPACE_ACCESS_DENIED', 'authorization', 'You do not have permission to direct this Production.', 403)
    return user
