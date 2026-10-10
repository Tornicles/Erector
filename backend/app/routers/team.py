"""Team workspace invitation HTTP surface.

There is no email delivery in this deployment, so inviting means creating a
single-use link the owner/admin shares manually. The raw token is returned
exactly once at creation; only its SHA-256 hash reaches the database. Listing
is an owner/admin read; accepting is any signed-in creator holding a valid
link. Membership writes happen only inside the guarded invite RPCs: the
database grants no membership or invite writes to client roles, so no route
here lets a caller self-promote, grant ownership, or reuse a link.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_current_user, get_gateway, require_team_admin, require_workspace_access
from app.domain.team import (
    TEAM_INVITE_MAX_EXPIRY_DAYS,
    TEAM_INVITE_MIN_EXPIRY_DAYS,
    TEAM_INVITE_ROLES,
    TeamInviteAcceptRequest,
    TeamInviteCreateRequest,
)

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_TEAM_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _invite_uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_TEAM_INPUT', 'validation', message, 422) from exc


def _decorate_invite(row: dict[str, Any]) -> dict[str, Any]:
    return {'invite_id': row.get('id'), 'role': row.get('role'),
        'expires_at': row.get('expires_at'), 'accepted_at': row.get('accepted_at'),
        'revoked_at': row.get('revoked_at'), 'created_at': row.get('created_at')}


def register_team_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}'

    @application.get(f'{base}/team/members')
    async def team_members(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Workspace members and their roles. Any member may read; RLS agrees."""

        rows = await gateway.request('GET', '/rest/v1/workspace_members', token=request.state.access_token,
            schema=True, params={'workspace_id': f'eq.{workspace_id}',
                'select': 'user_id,role,created_at', 'order': 'created_at.asc', 'limit': '100'})
        return envelope(request, [{'user_id': row.get('user_id'), 'role': row.get('role'),
            'created_at': row.get('created_at')} for row in rows or []])

    @application.get(f'{base}/team/invites')
    async def team_invites(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_team_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Pending and past invite links. Owner/admin only; hashes never leave the database."""

        rows = await gateway.request('GET', '/rest/v1/workspace_invites', token=request.state.access_token,
            schema=True, params={'workspace_id': f'eq.{workspace_id}',
                'select': 'id,role,expires_at,accepted_at,revoked_at,created_at',
                'order': 'created_at.desc', 'limit': '100'})
        return envelope(request, [_decorate_invite(row) for row in rows or []])

    @application.post(f'{base}/team/invites')
    async def team_invite_create(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_team_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Create one single-use invite link. The raw token is returned exactly once."""

        body = _validated(TeamInviteCreateRequest, await request.json(), 'Check the invite fields.')
        if body.role not in TEAM_INVITE_ROLES:
            raise AppError('INVALID_TEAM_INPUT', 'validation',
                'Invites grant admin, editor, or viewer. Ownership is never granted by invite.', 422)
        if not TEAM_INVITE_MIN_EXPIRY_DAYS <= body.expires_in_days <= TEAM_INVITE_MAX_EXPIRY_DAYS:
            raise AppError('INVALID_TEAM_INPUT', 'validation',
                'An invite lasts between one and thirty days.', 422)
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
        expires_at = (datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)).isoformat()
        invite_id = await gateway.rpc_detailed('create_workspace_invite', token=request.state.access_token,
            json={'target_workspace': str(workspace_id), 'invite_role': body.role,
                'token_hash': token_hash, 'expires_at': expires_at}, layer='Team invites')
        logger.info('team_invite_created', extra={'context': {'event': 'team_invite_created',
            'workspace_id': str(workspace_id), 'role': body.role}})
        return envelope(request, {'invite_id': invite_id, 'token': raw_token,
            'role': body.role, 'expires_at': expires_at})

    @application.post(f'{base}/team/invites/{{invite_id}}/revoke')
    async def team_invite_revoke(workspace_id: UUID, invite_id: str, request: Request,
        user: CurrentUser = Depends(require_team_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Revoke an unused invite link. Used links stay in history."""

        parsed = _invite_uuid(invite_id, 'That invite identifier is invalid.')
        # Membership scope is proven on the invite record itself: revoking another
        # workspace's invite is refused before the privileged call, never after.
        rows = await gateway.request('GET', '/rest/v1/workspace_invites', token=request.state.access_token,
            schema=True, params={'id': f'eq.{parsed}', 'workspace_id': f'eq.{workspace_id}',
                'select': 'id', 'limit': '1'})
        if not rows:
            raise AppError('TEAM_INVITE_NOT_FOUND', 'not_found', 'That invite does not exist.', 404)
        await gateway.rpc_detailed('revoke_workspace_invite', token=request.state.access_token,
            json={'invite_id': str(parsed)}, layer='Team invites')
        logger.info('team_invite_revoked', extra={'context': {'event': 'team_invite_revoked',
            'workspace_id': str(workspace_id), 'invite_id': str(parsed)}})
        return envelope(request, {'invite_id': str(parsed), 'revoked': True})

    @application.post('/api/v1/invites/accept')
    async def team_invite_accept(request: Request,
        user: CurrentUser = Depends(get_current_user),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Accept a valid invite link. Any signed-in creator holding the link may join once."""

        body = _validated(TeamInviteAcceptRequest, await request.json(), 'That invite link is invalid.')
        token = body.token.strip()
        if not token:
            raise AppError('INVALID_TEAM_INPUT', 'validation', 'That invite link is invalid.', 422)
        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        result = await gateway.rpc_detailed('accept_workspace_invite', token=request.state.access_token,
            json={'p_token_hash': token_hash}, layer='Team invites')
        if isinstance(result, list):
            result = result[0] if result else {}
        logger.info('team_invite_accepted', extra={'context': {'event': 'team_invite_accepted',
            'workspace_id': str((result or {}).get('workspace_id') or '')}})
        return envelope(request, {'workspace_id': (result or {}).get('workspace_id'),
            'role': (result or {}).get('role')})
