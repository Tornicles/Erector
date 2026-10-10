"""Prompt 6 Real Production Director HTTP surface.

Reads are workspace-member scoped. Every write is an editor action against an
explicit revision and goes through a guarded security-definer RPC, so the lock,
production and membership checks happen in the database rather than here.
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
from app.dependencies.ai import get_ai_provider, get_frame_extractor
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor
from app.domain.real_production import (
    CaptureStateRequest,
    DeviationRequest,
    DirectShotRequest,
    PlanApprovalRequest,
    PlanLockRequest,
    SaveRealPlanRequest,
    TakeRequest,
)
from app.services.intelligence import provider_status
from app.services.real_production import RealProductionDirector, RealProductionRepository, SetupInventory

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise AppError('INVALID_REAL_INPUT', 'validation', message, 422) from exc


def _uuid(value: str, message: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_REAL_INPUT', 'validation', message, 422) from exc


def register_real_production_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/real'
    repository = RealProductionRepository

    @application.get(f'{base}/surface')
    async def real_surface(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The Real execution read model: Setup, Shots, readiness, capture, queue."""

        data = await repository(gateway).surface(workspace_id, production_id, request.state.access_token)
        data['provider'] = provider_status(get_ai_provider(request))
        data['capabilities'] = {
            'frame_extraction': get_frame_extractor(request).available(),
            'frame_extraction_note': get_frame_extractor(request).reason(),
            'setup_matching': True,
            'take_logging': True,
            'on_set_mode': True,
            'ai_prompt_compilation': False,
            'note': 'Real execution planning is deterministic and Setup-aware. AI creation arrives with Prompt 7.',
        }
        return envelope(request, data)

    @application.get(f'{base}/shots/{{shot_id}}')
    async def real_shot_detail(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One Shot's Real plan, Setup requirements, alternatives, Takes and deviations."""

        data = await repository(gateway).detail(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token)
        return envelope(request, data)

    @application.post(f'{base}/shots/{{shot_id}}/direct')
    async def direct_shot(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Answer 'how do I shoot this?' for one Shot, and optionally apply the plan."""

        body = _validated(DirectShotRequest, await request.json() or {}, 'Check the direction and try again.')
        target = _uuid(shot_id, 'That Shot identifier is invalid.')
        repo = repository(gateway)
        token = request.state.access_token
        detail = await repo.detail(workspace_id, production_id, target, token)
        shot = detail.get('shot') or {}
        scene = detail.get('scene') or {}
        if shot.get('locked'):
            raise AppError('SHOT_LOCKED', 'conflict',
                'That Shot is locked. Unlock it before the Director can change its plan.', 409)
        if shot.get('execution_method') == 'ai':
            raise AppError('INVALID_REAL_INPUT', 'validation',
                'This Shot is assigned to AI creation, so it has no Real execution plan. Switch it to Real first.', 422)
        setup = SetupInventory(await repo.setup_resources(workspace_id, token))
        director = RealProductionDirector(setup)
        plan, requirements, alternatives = director.direct(
            shot=shot, scene=scene,
            production=(await repo.surface(workspace_id, production_id, token)).get('production') or {},
            brief=detail.get('brief'), script_line=detail.get('script_line'),
            text=body.text, declared_constraints=list(body.constraints))
        answer = _answer(plan, requirements, shot)
        if not body.apply:
            return envelope(request, {'applied': None, 'plan': plan.model_dump(), 'answer': answer,
                'requirements': [item.model_dump() for item in requirements],
                'alternatives': [item.model_dump() for item in alternatives],
                'scope': 'shot', 'shot_id': str(target)})
        saved = await repo.save_plan(workspace_id, production_id, target, token, SaveRealPlanRequest(
            expected_shot_revision=body.expected_shot_revision, plan=plan,
            requirements=requirements, alternatives=alternatives))
        logger.info('real_plan_applied', extra={'context': {'event': 'real_plan_applied',
            'production_id': str(production_id), 'shot_id': str(target)}})
        return envelope(request, {'applied': saved, 'plan': plan.model_dump(), 'answer': answer,
            'requirements': [item.model_dump() for item in requirements],
            'alternatives': [item.model_dump() for item in alternatives],
            'scope': 'shot', 'shot_id': str(target)})

    @application.post(f'{base}/scenes/{{scene_id}}/direct')
    async def direct_scene(workspace_id: UUID, production_id: UUID, scene_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Direct every Real Shot in one Scene. Batched, and each Shot keeps its own plan."""

        body = _validated(DirectShotRequest, await request.json() or {}, 'Check the direction and try again.')
        target_scene = _uuid(scene_id, 'That Scene identifier is invalid.')
        repo = repository(gateway)
        token = request.state.access_token
        surface = await repo.surface(workspace_id, production_id, token)
        production = surface.get('production') or {}
        candidates = [item for item in surface.get('shots') or []
            if item.get('scene_id') == str(target_scene) and item.get('execution_method') == 'real']
        if not candidates:
            raise AppError('SCENE_EMPTY', 'not_found', 'That Scene has no Real Shots to direct.', 404)
        setup = SetupInventory(await repo.setup_resources(workspace_id, token))
        director = RealProductionDirector(setup)
        directed: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        for item in candidates:
            shot_id = str(item['shot_id'])
            if item.get('locked'):
                skipped.append({'shot_id': shot_id, 'reason': 'locked'})
                continue
            detail = await repo.detail(workspace_id, production_id, UUID(shot_id), token)
            plan, requirements, alternatives = director.direct(
                shot=detail.get('shot') or {}, scene=detail.get('scene') or {}, production=production,
                brief=detail.get('brief'), script_line=detail.get('script_line'),
                text=body.text, declared_constraints=list(body.constraints))
            if not body.apply:
                directed.append({'shot_id': shot_id, 'plan': plan.model_dump(), 'answer': _answer(plan, requirements, detail.get('shot') or {})})
                continue
            saved = await repo.save_plan(workspace_id, production_id, UUID(shot_id), token, SaveRealPlanRequest(
                expected_shot_revision=None, plan=plan, requirements=requirements, alternatives=alternatives))
            directed.append({'shot_id': shot_id, 'applied': saved, 'plan': plan.model_dump()})
        return envelope(request, {'scope': 'scene', 'scene_id': str(target_scene), 'applied': bool(body.apply),
            'shots': directed, 'skipped': skipped,
            'summary': {'directed': len(directed), 'skipped': len(skipped)}})

    @application.post(f'{base}/shots/{{shot_id}}/plan')
    async def save_plan(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(SaveRealPlanRequest, await request.json(), 'Check the Real plan fields and revision.')
        result = await repository(gateway).save_plan(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body)
        logger.info('real_plan_saved', extra={'context': {'event': 'real_plan_saved',
            'production_id': str(production_id), 'shot_id': str(shot_id)}})
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/plan/approval')
    async def set_plan_approval(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(PlanApprovalRequest, await request.json(), 'Check the approval state.')
        result = await repository(gateway).set_approval(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/plan/lock')
    async def set_plan_lock(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(PlanLockRequest, await request.json(), 'Check the lock state.')
        result = await repository(gateway).set_lock(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/capture')
    async def set_capture_state(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(CaptureStateRequest, await request.json(), 'Check the capture state.')
        result = await repository(gateway).set_capture(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/takes')
    async def save_take(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(TakeRequest, await request.json(), 'Check the Take number and status.')
        result = await repository(gateway).save_take(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)

    @application.delete(f'{base}/shots/{{shot_id}}/takes/{{take_id}}')
    async def delete_take(workspace_id: UUID, production_id: UUID, shot_id: str, take_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        result = await repository(gateway).delete_take(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'),
            _uuid(take_id, 'That Take identifier is invalid.'), request.state.access_token)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/deviations')
    async def record_deviation(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(DeviationRequest, await request.json(), 'Check the deviation field and values.')
        result = await repository(gateway).record_deviation(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body)
        return envelope(request, result)


def _answer(plan: Any, requirements: list[Any], shot: dict[str, Any]) -> dict[str, Any]:
    """What changed / why / what is affected — without exposing hidden reasoning."""
    missing = [item.label for item in requirements if item.status == 'missing']
    substitutes = [item.label for item in requirements if item.status == 'substitute']
    unverified = [item.label for item in requirements if item.status == 'unverified']
    return {
        'summary': (f"{plan.shot_size or 'Shot'} on {plan.stabilization or 'the support in the plan'}, "
            f"{plan.movement or 'locked'} camera, {plan.aperture or 'an exposure starting point'}. "
            f"{plan.lighting_intent}"),
        'why': plan.movement_purpose or plan.perspective_note or 'Derived from the Shot and the Setup you actually own.',
        'affected': [item for item in (shot.get('title'), plan.editorial_intent) if item],
        'readiness': plan.plan_status,
        'readiness_note': plan.readiness_note,
        'missing': missing, 'substitutes': substitutes, 'unverified': unverified,
        'safety': plan.safety_notes,
        'truthfulness': 'Exposure values are starting points, not measurements.',
    }
