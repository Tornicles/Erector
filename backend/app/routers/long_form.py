"""Prompt 8 long-form, Movie Mode, Series and Production Line HTTP surface.

Reads are workspace-member scoped and paginated by level, so a 120-minute Production is
never loaded as one giant card graph. Every write goes through a guarded security-definer
RPC against an explicit revision, so ordering, locking, approval, idempotency and
structural conflict detection are decided in the database rather than here.

Generate Ahead always previews first and requires explicit confirmation before it creates
anything, and it only ever creates Production shells and Episode associations.
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
from app.domain.long_form import (
    ActRequest,
    CollectionRequest,
    CreateSeriesRequest,
    DirectorScopeRequest,
    EpisodePatch,
    EpisodeRequest,
    GenerateAheadRequest,
    MoveSceneRequest,
    MoveSequenceRequest,
    ReorderRequest,
    SequenceRequest,
    SeriesDirectorRequest,
    SplitRequest,
    StructureApprovalRequest,
    StructureLockRequest,
    StructurePatch,
    SummaryRequest,
    UpdateSeriesRequest,
)
from app.services.long_form import (
    LongFormRepository,
    StructureIndex,
    depth_label,
    interpret_long_form_direction,
    line_state_label,
    legacy_requested_depth_label,
    readiness_is_criteria_based,
    resolve_long_form_scope,
    resolve_series_scope,
    structure_summary_line,
)

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise AppError('INVALID_LONG_FORM_INPUT', 'validation', message, 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_LONG_FORM_INPUT', 'validation', message, 422) from exc


def _optional_uuid(value: str | None, message: str) -> UUID | None:
    if value is None or str(value).strip() == '':
        return None
    return _uuid(value, message)


def _optional_int(request: Request, name: str) -> int | None:
    raw = request.query_params.get(name)
    if raw is None or raw == '':
        return None
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_LONG_FORM_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    if parsed < 1:
        raise AppError('INVALID_LONG_FORM_INPUT', 'validation', f'{name} must be a whole number.', 422)
    return parsed


def _bounded_int(request: Request, name: str, default: int, *, low: int = 1, high: int = 200) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == '':
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_LONG_FORM_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def _decorate_structure(data: dict[str, Any]) -> dict[str, Any]:
    """Attach the display vocabulary to a structure page without inventing any value."""

    scope = data.get('scope') or {}
    if isinstance(scope, dict):
        scope['depth_label'] = depth_label(scope.get('depth'))
        summary = scope.get('summary')
        if isinstance(summary, dict):
            summary['stale_label'] = ('STALE — the object changed since this summary was derived'
                if summary.get('stale') else 'CURRENT')
    for item in data.get('items') or []:
        item['depth_label'] = depth_label(item.get('depth'))
        summary = item.get('summary')
        if isinstance(summary, dict):
            summary['stale_label'] = ('STALE — the object changed since this summary was derived'
                if summary.get('stale') else 'CURRENT')
    data['breadcrumb_line'] = structure_summary_line(scope, data.get('breadcrumb') or [])
    data['lazy'] = 'One level at a time: a large Production is paged, never expanded eagerly.'
    return data


def _decorate_episode(item: dict[str, Any]) -> dict[str, Any]:
    item['depth_label'] = depth_label(item.get('depth'))
    item['line_state_label'] = line_state_label(item.get('line_state'))
    item['requested_depth_label'] = legacy_requested_depth_label(item.get('requested_depth'))
    return item


def register_long_form_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    structure_base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/long-form'
    series_base = '/api/v1/workspaces/{workspace_id}'
    repository = LongFormRepository

    # ------------------------------------------------------------------ long-form structure

    @application.get(f'{structure_base}/structure')
    async def long_form_structure(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One hierarchical level at a time: Acts, then Sequences/Scenes of an Act, then Shots."""

        level = request.query_params.get('level') or 'production'
        data = await repository(gateway).structure(workspace_id, production_id, request.state.access_token,
            level=level, scope_id=_optional_uuid(request.query_params.get('scope_id'), 'That scope identifier is invalid.'),
            limit=_bounded_int(request, 'limit', 50), offset=max(0, int(request.query_params.get('offset') or 0)),
            expected_revision=_optional_int(request, 'expected_revision'))
        return envelope(request, _decorate_structure(data))

    @application.get(f'{structure_base}/timing')
    async def long_form_timing(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Planned target and calculated child runtime, reported separately with the real gap."""

        data = await repository(gateway).timing(workspace_id, production_id, request.state.access_token,
            expected_revision=_optional_int(request, 'expected_revision'))
        data['rule'] = ('A planned target is never overwritten by a calculated child total. Shots feed a Scene only '
            'when every Shot has an exact duration.')
        return envelope(request, data)

    @application.get(f'{structure_base}/search')
    async def long_form_search(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Structured search over real objects: Acts, Sequences, Scenes, Shots and documents."""

        query = request.query_params.get('q') or ''
        levels = [value for value in (request.query_params.get('levels') or '').split(',') if value]
        filters: dict[str, Any] = {}
        if levels:
            filters['levels'] = levels
        for name in ('character_asset_id', 'environment_asset_id', 'execution_method', 'approval'):
            value = request.query_params.get(name)
            if value:
                filters[name] = value
        data = await repository(gateway).search(workspace_id, production_id, request.state.access_token,
            query=query, filters=filters, limit=_bounded_int(request, 'limit', 40),
            offset=max(0, int(request.query_params.get('offset') or 0)))
        return envelope(request, data)

    @application.get(f'{structure_base}/script')
    async def long_form_script(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Script navigation by scope with measured length and a bounded excerpt."""

        return envelope(request, await repository(gateway).script_index(workspace_id, production_id,
            request.state.access_token, limit=_bounded_int(request, 'limit', 50),
            offset=max(0, int(request.query_params.get('offset') or 0))))

    @application.get(f'{structure_base}/context')
    async def long_form_context(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Bounded scope context for Director reasoning, never the whole Production."""

        level = request.query_params.get('level') or 'production'
        scope_id = _uuid(request.query_params.get('scope_id'), 'That scope identifier is invalid.')
        return envelope(request, await repository(gateway).context(workspace_id, production_id,
            request.state.access_token, level=level, scope_id=scope_id,
            budget_chars=_bounded_int(request, 'budget_chars', 4000, low=400, high=20000)))

    @application.get(f'{structure_base}/summaries')
    async def long_form_summaries(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Derived summaries with explicit staleness against the revision they came from."""

        return envelope(request, await repository(gateway).summaries(workspace_id, production_id,
            request.state.access_token, limit=_bounded_int(request, 'limit', 100),
            offset=max(0, int(request.query_params.get('offset') or 0))))

    @application.post(f'{structure_base}/summaries')
    async def save_long_form_summary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Store a derived summary pinned to the revision it describes."""

        body = _validated(SummaryRequest, await request.json(), 'Check the summary fields.')
        context = await repository(gateway).context(workspace_id, production_id, request.state.access_token,
            level=body.level, scope_id=_uuid(body.id, 'That scope identifier is invalid.'), budget_chars=400)
        data = await repository(gateway).save_summary(workspace_id, production_id, request.state.access_token,
            level=body.level, scope_id=_uuid(body.id, 'That scope identifier is invalid.'),
            content={'text': body.text, 'depth': (context or {}).get('depth')},
            note=body.note, generated_by=body.generated_by, expected_revision=body.expected_production_revision)
        return envelope(request, data)

    # ------------------------------------------------------------------ structure writes

    @application.post(f'{structure_base}/acts')
    async def create_long_form_act(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Create an Act. Acts are optional: a Production may have none."""

        body = _validated(ActRequest, await request.json(), 'Check the Act fields.')
        data = await repository(gateway).create_act(workspace_id, production_id, request.state.access_token,
            body.model_dump(), _optional_int(request, 'expected_revision'))
        logger.info('long_form_act_created', extra={'context': {'event': 'long_form_act_created',
            'workspace_id': str(workspace_id), 'production_id': str(production_id)}})
        return envelope(request, data)

    @application.patch(f'{structure_base}/acts/{{act_id}}')
    async def update_long_form_act(workspace_id: UUID, production_id: UUID, act_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Edit an Act, including archiving it. Nothing is deleted."""

        body = _validated(StructurePatch, await request.json(), 'Check the Act patch.')
        return envelope(request, await repository(gateway).update_act(workspace_id, production_id,
            _uuid(act_id, 'That Act identifier is invalid.'), request.state.access_token,
            body.model_dump(exclude_none=True), _optional_int(request, 'expected_revision')))

    @application.post(f'{structure_base}/sequences')
    async def create_long_form_sequence(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Create a Sequence, optionally inside an Act."""

        body = _validated(SequenceRequest, await request.json(), 'Check the Sequence fields.')
        return envelope(request, await repository(gateway).create_sequence(workspace_id, production_id,
            request.state.access_token, body.model_dump(), _optional_int(request, 'expected_revision')))

    @application.patch(f'{structure_base}/sequences/{{sequence_id}}')
    async def update_long_form_sequence(workspace_id: UUID, production_id: UUID, sequence_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Edit a Sequence. Moving it to an Act is an explicit structural operation."""

        body = _validated(StructurePatch, await request.json(), 'Check the Sequence patch.')
        return envelope(request, await repository(gateway).update_sequence(workspace_id, production_id,
            _uuid(sequence_id, 'That Sequence identifier is invalid.'), request.state.access_token,
            body.model_dump(exclude_none=True), _optional_int(request, 'expected_revision')))

    @application.post(f'{structure_base}/scenes/{{scene_id}}/move')
    async def move_long_form_scene(workspace_id: UUID, production_id: UUID, scene_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Move a Scene between Sequences or Acts. The Scene UUID and its Shots are preserved."""

        body = _validated(MoveSceneRequest, await request.json(), 'Check the move fields.')
        return envelope(request, await repository(gateway).move_scene(workspace_id, production_id,
            _uuid(scene_id, 'That Scene identifier is invalid.'), request.state.access_token,
            sequence_id=_optional_uuid(body.sequence_id, 'That Sequence identifier is invalid.'),
            act_id=_optional_uuid(body.act_id, 'That Act identifier is invalid.'),
            expected_revision=body.expected_revision))

    @application.post(f'{structure_base}/sequences/{{sequence_id}}/move')
    async def move_long_form_sequence(workspace_id: UUID, production_id: UUID, sequence_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Move a Sequence between Acts. Child Scene identities are preserved."""

        body = _validated(MoveSequenceRequest, await request.json(), 'Check the move fields.')
        return envelope(request, await repository(gateway).move_sequence(workspace_id, production_id,
            _uuid(sequence_id, 'That Sequence identifier is invalid.'), request.state.access_token,
            act_id=_optional_uuid(body.act_id, 'That Act identifier is invalid.'),
            expected_revision=body.expected_revision))

    @application.post(f'{structure_base}/split')
    async def split_long_form_structure(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Split an Act or Sequence at a declared order. No Scene or Shot is duplicated."""

        body = _validated(SplitRequest, await request.json(), 'Check the split fields.')
        return envelope(request, await repository(gateway).split(workspace_id, production_id,
            request.state.access_token, level=body.level,
            scope_id=_uuid(body.id, 'That identifier is invalid.'), split_order=body.split_order,
            expected_revision=body.expected_revision, title=body.title))

    @application.post(f'{structure_base}/reorder')
    async def reorder_long_form(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Reorder Acts, or the Sequences of one Act, against the structure revision."""

        body = _validated(ReorderRequest, await request.json(), 'Check the reorder fields.')
        data = await repository(gateway).reorder(workspace_id, production_id, request.state.access_token,
            level=body.level, ordered_ids=body.ordered_ids,
            expected_structure_revision=body.expected_structure_revision,
            parent_id=_optional_uuid(body.parent_id, 'That Act identifier is invalid.'))
        return envelope(request, data)

    @application.post(f'{structure_base}/approval')
    async def long_form_approval(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Approve or reopen an Act or Sequence. Approval is explicit creator acceptance."""

        body = _validated(StructureApprovalRequest, await request.json(), 'Check the approval fields.')
        return envelope(request, await repository(gateway).set_approval(workspace_id, production_id,
            request.state.access_token, level=body.level, scope_id=_uuid(body.id, 'That identifier is invalid.'),
            approval=body.approval, expected_revision=body.expected_revision))

    @application.post(f'{structure_base}/lock')
    async def long_form_lock(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Lock or explicitly unlock an Act or Sequence. Lock is independent of approval."""

        body = _validated(StructureLockRequest, await request.json(), 'Check the lock fields.')
        return envelope(request, await repository(gateway).set_lock(workspace_id, production_id,
            request.state.access_token, level=body.level, scope_id=_uuid(body.id, 'That identifier is invalid.'),
            locked=body.locked, expected_revision=body.expected_revision))

    # ------------------------------------------------------------------ Director scope

    @application.post(f'{structure_base}/director/scope')
    async def long_form_director_scope(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Resolve a long-form Director command to one explicit scope, with bounded context."""

        body = _validated(DirectorScopeRequest, await request.json(), 'Check the Director command.')
        direction = interpret_long_form_direction(body.text)
        client = repository(gateway)
        parent = await client.structure(workspace_id, production_id, request.state.access_token,
            level='production', limit=200)
        index = StructureIndex.from_structure(parent)
        # The command may name a numbered Act, Sequence or Scene, so the level the creator is
        # looking at is loaded (bounded) alongside the Production level.
        if body.level in ('act', 'sequence', 'scene'):
            scoped = await client.structure(workspace_id, production_id, request.state.access_token,
                level=body.level, scope_id=_optional_uuid(body.id, 'That scope identifier is invalid.'), limit=200)
            index.merge(StructureIndex.from_structure(scoped))
            data_extra = _decorate_structure(scoped)
        else:
            data_extra = _decorate_structure(parent)
        resolution = resolve_long_form_scope(body.text, index,
            {'production_id': str(production_id), 'level': body.level, 'id': body.id})
        data = {'resolution': resolution.as_dict(), 'direction': direction,
            'structure_revision': parent.get('structure_revision'), 'loaded_scope': data_extra.get('scope'),
            'breadcrumb': data_extra.get('breadcrumb'), 'breadcrumb_line': data_extra.get('breadcrumb_line')}
        if resolution.identifier:
            context = await client.context(workspace_id, production_id, request.state.access_token,
                level=resolution.level, scope_id=_uuid(resolution.identifier, 'That scope identifier is invalid.'),
                budget_chars=2000)
            data['context'] = context
            # The database returns the ancestry only, so the resolved scope is appended as the
            # breadcrumb's leaf: a Director answer always names Production -> Act 2, never just the Act.
            resolved_scope = context.get('scope') or {}
            ancestry = [item for item in (context.get('path') or []) if item]
            data['breadcrumb_line'] = structure_summary_line(resolved_scope, [*ancestry, resolved_scope])
        data['rule'] = ('Scope is explicit. A command that names no scope is reported as ambiguous instead of being '
            'widened to the whole Production, and no other Act is rewritten.')
        return envelope(request, data)

    # ------------------------------------------------------------------ Series

    @application.post(f'{series_base}/projects/{{project_id}}/series')
    async def create_series(workspace_id: UUID, project_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Create a Series. Season/Collection stays optional."""

        body = _validated(CreateSeriesRequest, await request.json(), 'Check the Series fields.')
        data = await repository(gateway).create_series(workspace_id,
            _uuid(project_id, 'That Project identifier is invalid.'), request.state.access_token, body.payload())
        logger.info('series_created', extra={'context': {'event': 'series_created',
            'workspace_id': str(workspace_id), 'series_kind': body.series_kind}})
        return envelope(request, data)

    @application.patch(f'{series_base}/series/{{series_id}}')
    async def update_series(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Edit a Series, its cadence or its reusable format references."""

        body = _validated(UpdateSeriesRequest, await request.json(), 'Check the Series patch.')
        return envelope(request, await repository(gateway).update_series(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token,
            body.payload(), body.expected_revision))

    @application.post(f'{series_base}/series/{{series_id}}/collections')
    async def save_series_collection(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Create or edit an optional Season/Collection inside a Series."""

        body = _validated(CollectionRequest, await request.json(), 'Check the Collection fields.')
        return envelope(request, await repository(gateway).save_collection(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token, body.model_dump()))

    @application.get(f'{series_base}/series/{{series_id}}')
    async def series_overview(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Series overview: cadence, format, reused canonical Assets and upcoming Episodes."""

        data = await repository(gateway).overview(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token)
        return envelope(request, data)

    @application.post(f'{series_base}/series/{{series_id}}/episodes')
    async def create_series_episode(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Create one Episode association, idempotent by slot. The Production stays canonical."""

        body = _validated(EpisodeRequest, await request.json(), 'Check the Episode fields.')
        data = await repository(gateway).create_episode(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token, body.payload())
        return envelope(request, data)

    @application.patch(f'{series_base}/series/{{series_id}}/episodes/{{episode_id}}')
    async def update_series_episode(workspace_id: UUID, series_id: str, episode_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Edit Episode association fields. Creative content stays on the Production."""

        body = _validated(EpisodePatch, await request.json(), 'Check the Episode patch.')
        return envelope(request, await repository(gateway).update_episode(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'),
            _uuid(episode_id, 'That Episode identifier is invalid.'), request.state.access_token,
            body.payload(), body.expected_revision))

    @application.get(f'{series_base}/series/{{series_id}}/slots')
    async def series_slots(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Deterministic future slots from the Series cadence and timezone, without creating anything."""

        horizon = request.query_params.get('horizon') or 'next_7'
        return envelope(request, await repository(gateway).slots(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token, horizon=horizon,
            count=_bounded_int(request, 'count', 0, low=0, high=400),
            base_date=request.query_params.get('base_date'),
            hold_slots=[value for value in (request.query_params.get('hold_slots') or '').split(',') if value]))

    @application.post(f'{series_base}/series/{{series_id}}/generate-ahead/preview')
    async def generate_ahead_preview(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Preview exactly what Generate Ahead would create, and what it would preserve."""

        body = _validated(GenerateAheadRequest, await request.json(), 'Check the Generate Ahead fields.')
        payload = body.payload()
        payload.pop('confirm', None)
        data = await repository(gateway).preview(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token, payload)
        return envelope(request, data)

    @application.post(f'{series_base}/series/{{series_id}}/generate-ahead')
    async def generate_ahead(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Create the previewed future Episodes as Production shells. Never overwrites."""

        body = _validated(GenerateAheadRequest, await request.json(), 'Check the Generate Ahead fields.')
        data = await repository(gateway).generate(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token, body.payload())
        logger.info('generate_ahead_applied', extra={'context': {'event': 'generate_ahead_applied',
            'workspace_id': str(workspace_id), 'horizon': body.horizon,
            'created': (data.get('counts') or {}).get('created')}})
        return envelope(request, data)

    @application.post(f'{series_base}/generate-ahead/jobs/{{job_id}}/retry')
    async def retry_generate_ahead(workspace_id: UUID, job_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Retry only the blocked or failed slots of one job. Created Episodes are untouched."""

        return envelope(request, await repository(gateway).retry(workspace_id, request.state.access_token,
            _uuid(job_id, 'That job identifier is invalid.')))

    @application.get(f'{series_base}/series/{{series_id}}/jobs')
    async def generate_ahead_jobs(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Durable Generate Ahead jobs with per-slot items and partial-success state."""

        return envelope(request, await repository(gateway).jobs(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token,
            limit=_bounded_int(request, 'limit', 10, low=1, high=50)))

    @application.get(f'{series_base}/series/{{series_id}}/production-line')
    async def series_production_line(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Where each Episode really is, with its real blockers. No completion percentage."""

        data = await repository(gateway).production_line(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token,
            limit=_bounded_int(request, 'limit', 30), offset=max(0, int(request.query_params.get('offset') or 0)))
        data['items'] = [_decorate_episode(item) for item in (data.get('items') or [])]
        data['readiness_is_criteria_based'] = readiness_is_criteria_based(data['items'])
        return envelope(request, data)

    @application.post(f'{series_base}/series/{{series_id}}/director/scope')
    async def series_director_scope(workspace_id: UUID, series_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Resolve a Series command with bounded Series context, never full historical Scripts."""

        body = _validated(SeriesDirectorRequest, await request.json(), 'Check the Director command.')
        resolved = resolve_series_scope(body.text)
        context = await repository(gateway).director_context(workspace_id,
            _uuid(series_id, 'That Series identifier is invalid.'), request.state.access_token, limit=body.limit)
        return envelope(request, {'resolution': resolved.as_dict(),
            'context': {key: value for key, value in context.items() if key != 'note'},
            'next_horizon_label': resolved.horizon,
            'rule': ('Series context is bounded: titles, dates, states and the avoid list only. '
                'Nothing was created by resolving the command.')})
