"""AI Creation HTTP surface: the playbook, the prompt for the tool the creator owns, and the check.

This surface answers the creator's questions in AI Creation:

* *What is this Shot actually asking for?* - the playbook compiled from the approved AI plan;
* *What do I paste into my tool?* - the deterministic, tool-specific prompt, with every adaptation
  to that tool named rather than silent;
* *Is what came back right?* - a check of the uploaded Result against the criteria the product names,
  and the next prompt when it is not.

Nothing here generates media. There is no route that calls a generation provider, because TONDE does
not render: the creator runs the prompt in the tool they own and uploads the Result. A Shot without
an approved AI plan has no playbook, and TONDE says so instead of inventing a prompt.
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
from app.dependencies.auth import CurrentUser, get_current_user, get_gateway, require_workspace_access, require_workspace_admin, require_workspace_editor
from app.domain.ai_director import (
    CAPABILITY_TYPES,
    CHECK_CRITERIA,
    CHECK_VERDICTS,
    REVIEW_DECISIONS,
    PlaybookPromptRequest,
    ResultCheckRequest,
    ToolProfileReviewRequest,
    ToolProfileSaveRequest,
    ProductionToolSetRequest,
)
from app.services.ai_director import (
    AiDirectorRepository,
    decorate_catalog,
    decorate_check,
    decorate_history,
    decorate_playbook,
    decorate_profile,
    vocabulary,
)

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_AI_CREATION_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_AI_CREATION_INPUT', 'validation', message, 422) from exc


def register_ai_director_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}'
    repository = AiDirectorRepository

    # ------------------------------------------------------------------ the Director boundary

    @application.get('/api/v1/ai/director-boundary')
    async def director_boundary(request: Request, user: CurrentUser = Depends(get_current_user),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The product law, read from the database rather than restated here."""

        return envelope(request, await repository(gateway).boundary(request.state.access_token))

    @application.get(f'{base}/ai/vocabulary')
    async def ai_vocabulary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The AI Creation vocabulary: capabilities, review states, verdicts and criteria."""

        return envelope(request, vocabulary())

    # ------------------------------------------------------------------ the tool library

    @application.get(f'{base}/ai/tools')
    async def ai_tool_catalog(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The documented tool knowledge this workspace may rely on, drafts excluded by default."""

        capability = request.query_params.get('capability_type') or None
        if capability is not None and capability not in CAPABILITY_TYPES:
            raise AppError('INVALID_AI_CREATION_INPUT', 'validation',
                'That capability type does not exist.', 422)
        include_drafts = (request.query_params.get('include_drafts') or 'false').lower() == 'true'
        data = await repository(gateway).catalog(workspace_id, request.state.access_token,
            capability_type=capability, include_drafts=include_drafts)
        return envelope(request, decorate_catalog(data))

    @application.post(f'{base}/ai/tools/profiles')
    async def save_ai_tool_profile(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Document what one external tool can do. A profile is knowledge, not a credential."""

        body = _validated(ToolProfileSaveRequest, await request.json(),
            'Check the tool profile fields.')
        data = await repository(gateway).save_profile(workspace_id, request.state.access_token,
            tool_key=body.tool_key, payload=body.payload)
        logger.info('ai_tool_profile_saved', extra={'context': {'event': 'ai_tool_profile_saved',
            'workspace_id': str(workspace_id), 'tool_key': body.tool_key,
            'created': bool(data.get('created'))}})
        return envelope(request, decorate_profile(data))

    @application.post(f'{base}/ai/tools/profiles/{{profile_id}}/review')
    async def review_ai_tool_profile(workspace_id: UUID, production_id: UUID, profile_id: str,
        request: Request, user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Review, retire or return a profile to draft. Only a reviewed profile is relied on."""

        body = _validated(ToolProfileReviewRequest, await request.json(), 'Check the review fields.')
        if body.decision not in REVIEW_DECISIONS:
            raise AppError('INVALID_AI_CREATION_INPUT', 'validation',
                'A review decision is review, retire or return_to_draft.', 422)
        data = await repository(gateway).review_profile(workspace_id, request.state.access_token,
            profile_id=_uuid(profile_id, 'That profile identifier is invalid.'),
            decision=body.decision, note=body.note)
        logger.info('ai_tool_profile_reviewed', extra={'context': {'event': 'ai_tool_profile_reviewed',
            'workspace_id': str(workspace_id), 'profile_id': profile_id, 'decision': body.decision}})
        return envelope(request, decorate_profile(data))

    @application.post(f'{base}/ai/tools/kit')
    async def set_production_tool(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Name an external tool in this Production's kit, or remove it. No credential is involved."""

        body = _validated(ProductionToolSetRequest, await request.json(), 'Check the kit fields.')
        data = await repository(gateway).set_production_tool(workspace_id, production_id,
            request.state.access_token, tool_key=body.tool_key, display_name=body.display_name,
            tool_profile_id=_uuid(body.tool_profile_id, 'That profile identifier is invalid.')
                if body.tool_profile_id else None,
            note=body.note, remove=body.remove, sort_order=body.sort_order)
        logger.info('production_ai_tool_set', extra={'context': {'event': 'production_ai_tool_set',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'tool_key': body.tool_key, 'removed': body.remove}})
        return envelope(request, data)

    # ------------------------------------------------------------------ the playbook

    @application.get(f'{base}/shots/{{shot_id}}/playbook')
    async def shot_playbook(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The playbook for one Shot: what the Shot asks for, and how the chosen tool is used."""

        data = await repository(gateway).playbook(workspace_id, production_id,
            request.state.access_token,
            shot_id=_uuid(shot_id, 'That Shot identifier is invalid.'),
            tool_key=request.query_params.get('tool_key') or None)
        return envelope(request, decorate_playbook(data))

    @application.post(f'{base}/shots/{{shot_id}}/playbook/prompt')
    async def compile_playbook_prompt(workspace_id: UUID, production_id: UUID, shot_id: str,
        request: Request, user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Compile the prompt for the creator's tool. Nothing is executed here."""

        body = _validated(PlaybookPromptRequest, await request.json(), 'Check the prompt request fields.')
        data = await repository(gateway).compile_prompt(workspace_id, production_id,
            request.state.access_token, shot_id=_uuid(shot_id, 'That Shot identifier is invalid.'),
            tool_key=body.tool_key, expected_plan_revision=body.expected_plan_revision)
        logger.info('playbook_prompt_compiled', extra={'context': {'event': 'playbook_prompt_compiled',
            'workspace_id': str(workspace_id), 'shot_id': shot_id, 'tool_key': body.tool_key}})
        return envelope(request, decorate_playbook(data))

    @application.get(f'{base}/shots/{{shot_id}}/playbook/history')
    async def playbook_history(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Every attempt and check on this Shot, newest first."""

        raw_limit = request.query_params.get('limit') or '50'
        try:
            limit = max(1, min(200, int(raw_limit)))
        except ValueError as exc:
            raise AppError('INVALID_AI_CREATION_INPUT', 'validation', 'limit must be a whole number.', 422) from exc
        data = await repository(gateway).history(workspace_id, production_id,
            request.state.access_token, shot_id=_uuid(shot_id, 'That Shot identifier is invalid.'),
            limit=limit)
        return envelope(request, decorate_history(data))

    # ------------------------------------------------------------------ the Result check

    @application.post(f'{base}/shots/{{shot_id}}/results/{{result_id}}/check')
    async def check_result(workspace_id: UUID, production_id: UUID, shot_id: str, result_id: str,
        request: Request, user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Judge an uploaded Result against the criteria the product names.

        The surface refuses an invented criterion and a FIX with nothing to change before the
        database sees it; the database is still the authority on what a check can mean.
        """

        body = _validated(ResultCheckRequest, await request.json(), 'Check the Result check fields.')
        if body.verdict not in CHECK_VERDICTS:
            raise AppError('INVALID_AI_CREATION_INPUT', 'validation',
                'A Director check returns accept or fix.', 422)
        if not body.criteria:
            raise AppError('INVALID_AI_CREATION_INPUT', 'validation',
                'A Director check names the criteria it judged.', 422)
        unknown = sorted({str(entry.get('criterion') or '') for entry in body.criteria}
            .difference(set(CHECK_CRITERIA)))
        if unknown:
            raise AppError('INVALID_AI_CREATION_INPUT', 'validation',
                'A check judges only the criteria the product names: ' + ', '.join(unknown) + '.', 422)
        if body.verdict == 'fix' and not (body.instructions or '').strip():
            raise AppError('INVALID_AI_CREATION_INPUT', 'validation', 'A FIX says what to change.', 422)
        payload = {'verdict': body.verdict, 'criteria': body.criteria,
            'findings': body.findings, 'recommendations': body.recommendations}
        if body.instructions:
            payload['instructions'] = body.instructions
        if body.prompt_text:
            payload['prompt_text'] = body.prompt_text
        if body.tool_key:
            payload['tool_key'] = body.tool_key
        data = await repository(gateway).check_result(workspace_id, production_id,
            request.state.access_token, shot_id=_uuid(shot_id, 'That Shot identifier is invalid.'),
            result_id=_uuid(result_id, 'That Result identifier is invalid.'), payload=payload)
        logger.info('ai_result_checked', extra={'context': {'event': 'ai_result_checked',
            'workspace_id': str(workspace_id), 'shot_id': shot_id, 'result_id': result_id,
            'verdict': body.verdict}})
        return envelope(request, decorate_check(data))
