"""Prompt 9E approval, lock and Production readiness HTTP surface.

This surface answers three creator questions:

* *Is this approved, and is it still the same thing I approved?* - one object's approval and lock
  state, the revision the approval named, whether content moved since, and who decided when;
* *What did I decide, and why?* - the append-only record of approval, lock and unlock decisions;
* *What prevents us from moving forward?* - the derived readiness category with actionable,
  navigable blockers instead of a score.

Approval is a creator decision. The write routes require a workspace editor and the database's own
`guard_human_acceptance` refuses an approval that no authenticated creator made, so an AI or
service-role operation cannot manufacture one here. Every write goes through a guarded
security-definer RPC.
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
from app.domain.readiness import ApprovalDecideRequest, LockRequest
from app.services.readiness import (
    ReadinessRepository,
    decorate_decision,
    decorate_history,
    decorate_readiness,
    decorate_state,
    vocabulary,
)

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    """Validate a request and, when it fails, say *why* rather than only that something is wrong."""

    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_READINESS_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_READINESS_INPUT', 'validation', message, 422) from exc


def _bounded_int(request: Request, name: str, default: int, *, low: int = 1, high: int = 200) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == '':
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_READINESS_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def _offset(request: Request) -> int:
    raw = request.query_params.get('offset') or '0'
    try:
        return max(0, int(raw))
    except ValueError as exc:
        raise AppError('INVALID_READINESS_INPUT', 'validation', 'offset must be a whole number.', 422) from exc


def register_production_readiness_routes(application: FastAPI, config: Settings,
    logger: logging.Logger, envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}'
    repository = ReadinessRepository

    # ------------------------------------------------------------------ vocabulary

    @application.get(f'{base}/readiness/vocabulary')
    async def readiness_vocabulary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The approval/lock action labels, readiness states and dimensions."""

        return envelope(request, vocabulary())

    # ------------------------------------------------------------------ readiness

    @application.get(f'{base}/readiness')
    async def production_readiness(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """What prevents us from moving forward, as a category with navigable blockers."""

        data = await repository(gateway).readiness(workspace_id, production_id, request.state.access_token,
            expected_revision=None)
        return envelope(request, decorate_readiness(data))

    # ------------------------------------------------------------------ one object's state

    @application.get(f'{base}/access/{{object_id}}')
    async def access_state(workspace_id: UUID, production_id: UUID, object_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The approval and lock state of one object, and the revision the approval named."""

        data = await repository(gateway).state(workspace_id, production_id, request.state.access_token,
            object_id=_uuid(object_id, 'That object identifier is invalid.'))
        return envelope(request, decorate_state(data))

    @application.get(f'{base}/access/{{object_id}}/history')
    async def access_history(workspace_id: UUID, production_id: UUID, object_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The append-only record of approval, lock and unlock decisions on one object."""

        data = await repository(gateway).history(workspace_id, production_id, request.state.access_token,
            object_id=_uuid(object_id, 'That object identifier is invalid.'),
            limit=_bounded_int(request, 'limit', 50), offset=_offset(request))
        return envelope(request, decorate_history(data))

    # ------------------------------------------------------------------ decisions

    @application.post(f'{base}/access/{{object_id}}/decide')
    async def decide_access(workspace_id: UUID, production_id: UUID, object_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Approve a specific revision, request a review, or reopen it. A creator decision."""

        body = _validated(ApprovalDecideRequest, await request.json(), 'Check the review decision fields.')
        data = await repository(gateway).decide(workspace_id, production_id, request.state.access_token,
            object_id=_uuid(object_id, 'That object identifier is invalid.'), decision=body.decision,
            expected_revision=body.expected_revision, note=body.note)
        logger.info('access_decided', extra={'context': {'event': 'access_decided',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'object_id': str(object_id), 'decision': body.decision, 'revision': data.get('revision')}})
        return envelope(request, decorate_decision(data))

    @application.post(f'{base}/access/{{object_id}}/lock')
    async def set_access_lock(workspace_id: UUID, production_id: UUID, object_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Lock or unlock an object. Unlock is explicit and records its reason."""

        body = _validated(LockRequest, await request.json(), 'Check the lock fields.')
        data = await repository(gateway).set_lock(workspace_id, production_id, request.state.access_token,
            object_id=_uuid(object_id, 'That object identifier is invalid.'), locked=body.locked,
            expected_revision=body.expected_revision, note=body.note)
        logger.info('access_lock_set', extra={'context': {'event': 'access_lock_set',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'object_id': str(object_id), 'locked': body.locked}})
        return envelope(request, decorate_decision(data))
