"""Prompt 5 Studio HTTP surface: one Master Production, many Studio views.

Reads are workspace-member scoped; every write requires an editor and an explicit
object revision. Destructive-free: archiving replaces deletion.
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
from app.dependencies.ai import get_ai_provider, get_frame_extractor
from app.domain.studio import (
    ApprovalRequest,
    CreateSceneRequest,
    CreateShotRequest,
    LockRequest,
    MoveShotRequest,
    ReconcileRequest,
    ReorderRequest,
    UpdateSceneRequest,
    UpdateShotRequest,
)
from app.services.intelligence import provider_status
from app.services.studio_workspace import StudioWorkspaceRepository

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise AppError('INVALID_STUDIO_INPUT', 'validation', message, 422) from exc


def _uuid(value: str, message: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_STUDIO_INPUT', 'validation', message, 422) from exc


def _optional_revision(request: Request) -> int | None:
    raw = request.query_params.get('expected_revision')
    if raw is None or raw == '':
        return None
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_STUDIO_INPUT', 'validation', 'The expected revision must be a whole number.', 422) from exc
    if parsed < 1:
        raise AppError('INVALID_STUDIO_INPUT', 'validation', 'The expected revision must be a whole number.', 422)
    return parsed


def register_studio_routes(application: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/studio'
    repository = StudioWorkspaceRepository

    @application.get(f'{base}')
    async def studio_surface(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The aggregated Studio read model: Production, Scenes, Shots, Assets, status, timing."""

        data = await repository(gateway).studio(workspace_id, production_id, request.state.access_token)
        data['provider'] = provider_status(get_ai_provider(request))
        data['capabilities'] = {
            'frame_extraction': get_frame_extractor(request).available(),
            'frame_extraction_note': get_frame_extractor(request).reason(),
            'timeline_editing': True,
            'shot_execution': False,
            'ai_prompt_compilation': False,
            'note': 'Real execution planning arrives with Prompt 6 and AI creation with Prompt 7.',
        }
        return envelope(request, data)

    @application.get(f'{base}/timing')
    async def studio_timing(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        timing = await repository(gateway).timing(workspace_id, production_id, request.state.access_token,
            expected_revision=_optional_revision(request))
        return envelope(request, timing)

    @application.post(f'{base}/scenes')
    async def create_scene(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(CreateSceneRequest, await request.json(), 'Check the Scene fields and try again.')
        result = await repository(gateway).create_scene(workspace_id, production_id, request.state.access_token, body)
        logger.info('studio_scene_created', extra={'context': {'event': 'studio_scene_created', 'production_id': str(production_id)}})
        return envelope(request, result)

    @application.patch(f'{base}/scenes/{{scene_id}}')
    async def update_scene(workspace_id: UUID, production_id: UUID, scene_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(UpdateSceneRequest, await request.json(), 'Check the Scene fields and revision.')
        result = await repository(gateway).update_scene(workspace_id, production_id,
            _uuid(scene_id, 'That Scene identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/scenes/reorder')
    async def reorder_scenes(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(ReorderRequest, await request.json(), 'Provide the complete Scene order and revision.')
        result = await repository(gateway).reorder_scenes(workspace_id, production_id, request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/scenes/{{scene_id}}/archive')
    async def archive_scene(workspace_id: UUID, production_id: UUID, scene_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json() if await request.body() else {}
        cascade = bool((body or {}).get('cascade', False)) if isinstance(body, dict) else False
        expected = (body or {}).get('expected_revision') if isinstance(body, dict) else None
        if expected is not None and (not isinstance(expected, int) or expected < 1):
            raise AppError('INVALID_STUDIO_INPUT', 'validation', 'The expected revision must be a whole number.', 422)
        result = await repository(gateway).archive_scene(workspace_id, production_id,
            _uuid(scene_id, 'That Scene identifier is invalid.'), request.state.access_token,
            expected_revision=expected, cascade=cascade)
        logger.info('studio_scene_archived', extra={'context': {'event': 'studio_scene_archived', 'production_id': str(production_id)}})
        return envelope(request, result)

    @application.post(f'{base}/shots')
    async def create_shot(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(CreateShotRequest, await request.json(), 'Check the Shot fields and try again.')
        if body.scene_id is not None:
            _uuid(body.scene_id, 'That Scene identifier is invalid.')
        result = await repository(gateway).create_shot(workspace_id, production_id, request.state.access_token, body)
        logger.info('studio_shot_created', extra={'context': {'event': 'studio_shot_created', 'production_id': str(production_id)}})
        return envelope(request, result)

    @application.patch(f'{base}/shots/{{shot_id}}')
    async def update_shot(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(UpdateShotRequest, await request.json(), 'Check the Shot fields and revision.')
        result = await repository(gateway).update_shot(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/move')
    async def move_shot(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(MoveShotRequest, await request.json(), 'Check the target Scene and revision.')
        if body.scene_id is not None:
            _uuid(body.scene_id, 'That Scene identifier is invalid.')
        result = await repository(gateway).move_shot(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/scenes/{{scene_id}}/shots/reorder')
    async def reorder_shots(workspace_id: UUID, production_id: UUID, scene_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(ReorderRequest, await request.json(), 'Provide the complete Shot order and revision.')
        result = await repository(gateway).reorder_shots(workspace_id, production_id,
            _uuid(scene_id, 'That Scene identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/archive')
    async def archive_shot(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json() if await request.body() else {}
        expected = (body or {}).get('expected_revision') if isinstance(body, dict) else None
        if expected is not None and (not isinstance(expected, int) or expected < 1):
            raise AppError('INVALID_STUDIO_INPUT', 'validation', 'The expected revision must be a whole number.', 422)
        result = await repository(gateway).archive_shot(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, expected_revision=expected)
        logger.info('studio_shot_archived', extra={'context': {'event': 'studio_shot_archived', 'production_id': str(production_id)}})
        return envelope(request, result)

    @application.post(f'{base}/approval')
    async def set_approval(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(ApprovalRequest, await request.json(), 'Check the approval scope and state.')
        if body.scope != 'production':
            _uuid(body.id, 'That object identifier is invalid.')
        result = await repository(gateway).set_approval(workspace_id, production_id, request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/lock')
    async def set_lock(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(LockRequest, await request.json(), 'Check the lock scope and state.')
        if body.scope != 'production':
            _uuid(body.id, 'That object identifier is invalid.')
        result = await repository(gateway).set_lock(workspace_id, production_id, request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/runtime/reconcile')
    async def reconcile_runtime(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(ReconcileRequest, await request.json(), 'Choose the Scene that should absorb the timing change.')
        _uuid(body.absorb_scene, 'That Scene identifier is invalid.')
        result = await repository(gateway).reconcile(workspace_id, production_id, request.state.access_token, body)
        return envelope(request, result)
