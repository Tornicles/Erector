"""The Card system HTTP surface: plan the Production, write and validate Card direction.

A Card is the canonical Scene, so this surface adds no second Card object: it plans Card shells,
writes Card-level direction through the guarded RPC, validates direction (Card *and* Shot level),
asks TONDE for a validated proposal, and reports what a change is allowed to affect.

Reads require workspace membership. Every write requires an editor. Generation returns a proposal
that only a creator can apply.
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
from app.dependencies.ai import get_ai_provider
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor
from app.domain.card_system import (
    PlanCardsRequest,
    ProposeCardDirectionRequest,
    ValidateCardRequest,
    WriteCardDirectionRequest,
)
from app.services.card_direction import CardDirectionService

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise AppError('INVALID_CARD_INPUT', 'validation', message, 422) from exc


def _uuid(value: str, message: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_CARD_INPUT', 'validation', message, 422) from exc


def register_card_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/cards'

    @application.get(base)
    async def list_cards(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Every Card with its direction, derived status and last stored validation."""

        cards = await CardDirectionService(gateway).list_cards(workspace_id, production_id,
            request.state.access_token)
        return envelope(request, {'cards': cards, 'count': len(cards)})

    @application.post(f'{base}/plan')
    async def plan_cards(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Plan the Production structure. Exceeding the Card cap needs the creator's explicit say-so."""

        body = _validated(PlanCardsRequest, await request.json(),
            'Check the beats, the target runtime and try again.')
        result = await CardDirectionService(gateway).plan(workspace_id, production_id,
            request.state.access_token, body)
        logger.info('cards_planned', extra={'context': {'event': 'cards_planned',
            'production_id': str(production_id), 'cards': result['plan']['card_count'],
            'persisted': result['persist_requested']}})
        return envelope(request, result)

    @application.put(f'{base}/{{scene_id}}/direction')
    async def write_card_direction(workspace_id: UUID, production_id: UUID, scene_id: str,
        request: Request, user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Persist this Card's whole direction. A locked Card or a stale revision is refused."""

        body = _validated(WriteCardDirectionRequest, await request.json(),
            'Check the Card direction, the mode and the expected revision.')
        result = await CardDirectionService(gateway).write(workspace_id, production_id,
            _uuid(scene_id, 'That Card identifier is invalid.'), request.state.access_token, body)
        logger.info('card_direction_written', extra={'context': {'event': 'card_direction_written',
            'production_id': str(production_id), 'scene_id': scene_id,
            'generated_by': body.generated_by}})
        return envelope(request, result)

    @application.post(f'{base}/{{scene_id}}/validate')
    async def validate_card(workspace_id: UUID, production_id: UUID, scene_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Validate the Card's direction and its Shots against the content contract."""

        body = _validated(ValidateCardRequest, await request.json() or {},
            'Check the validation request and try again.')
        result = await CardDirectionService(gateway).validate(workspace_id, production_id,
            _uuid(scene_id, 'That Card identifier is invalid.'), request.state.access_token,
            persist=body.persist, direction=body.direction)
        return envelope(request, result)

    @application.post(f'{base}/{{scene_id}}/direction/propose')
    async def propose_card_direction(workspace_id: UUID, production_id: UUID, scene_id: str,
        request: Request, user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Ask TONDE to write this Card. Nothing is written until the creator applies the proposal."""

        body = _validated(ProposeCardDirectionRequest, await request.json() or {},
            'Check the focus and try again.')
        result = await CardDirectionService(gateway).propose(get_ai_provider(request),
            workspace_id, production_id, _uuid(scene_id, 'That Card identifier is invalid.'),
            request.state.access_token, body)
        logger.info('card_direction_proposed', extra={'context': {'event': 'card_direction_proposed',
            'production_id': str(production_id), 'scene_id': scene_id, 'focus': body.focus,
            'producer': result['provider']['producer']}})
        return envelope(request, result)

    @application.get(f'{base}/{{scene_id}}/impact')
    async def card_impact(workspace_id: UUID, production_id: UUID, scene_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Which fields a change may touch, and which production truth it must leave alone."""

        change = (request.query_params.get('change') or '').strip()
        if not change:
            raise AppError('INVALID_CARD_INPUT', 'validation',
                'Name the change to scope, for example ?change=location.', 422)
        scope = (request.query_params.get('scope') or 'card').strip().lower()
        if scope not in ('card', 'shot'):
            raise AppError('INVALID_CARD_INPUT', 'validation',
                'The scope must be card or shot.', 422)
        downstream = (request.query_params.get('downstream') or '').lower() in ('1', 'true', 'yes')
        _uuid(scene_id, 'That Card identifier is invalid.')
        result = await CardDirectionService(gateway).impact(workspace_id, production_id,
            request.state.access_token, change=change, scope=scope, downstream_cards=downstream)
        return envelope(request, result)
