"""Prompt 9A dependency graph, impact preview/apply and stale-artifact HTTP surface.

Reads are workspace-member scoped and bounded by depth and page size, so a 500-shot
Production never expands its whole dependency graph in one response. Every write goes
through a guarded security-definer RPC, so lock enforcement, approval protection, revision
staleness and tenant isolation are decided in the database rather than here.

The whole point of this surface is visible in its shape: previewing an impact and applying
one are different requests. Computing an impact changes nothing, and applying one requires
the previewed analysis id *and* an explicit creator confirmation plus one of the three
constitutional propagation choices - UPDATE ALL, REVIEW CHANGES or CHANGE ONLY THIS.
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
from app.domain.dependencies import (
    DependencyActiveRequest,
    DependencyEdgeRequest,
    ImpactApplyRequest,
    ImpactPreviewRequest,
    StaleMarkRequest,
    StaleResolveRequest,
)
from app.services.dependencies import (
    DependencyRepository,
    decorate_apply,
    decorate_edges,
    decorate_graph,
    decorate_history,
    decorate_impact,
    decorate_markers,
    impact_modes,
)

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise AppError('INVALID_INTELLIGENCE_INPUT', 'validation', message, 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_INTELLIGENCE_INPUT', 'validation', message, 422) from exc


def _optional_uuid(value: str | None, message: str) -> UUID | None:
    if value is None or str(value).strip() == '':
        return None
    return _uuid(value, message)


def _bounded_int(request: Request, name: str, default: int, *, low: int = 1, high: int = 200) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == '':
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_INTELLIGENCE_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def _offset(request: Request) -> int:
    raw = request.query_params.get('offset') or '0'
    try:
        return max(0, int(raw))
    except ValueError as exc:
        raise AppError('INVALID_INTELLIGENCE_INPUT', 'validation', 'offset must be a whole number.', 422) from exc


def register_production_intelligence_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/intelligence'
    repository = DependencyRepository

    # ------------------------------------------------------------------ vocabulary

    @application.get(f'{base}/modes')
    async def impact_modes_surface(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The three constitutional propagation choices, and the rule that bounds all of them."""

        return envelope(request, {'modes': impact_modes(),
            'rule': 'Impact is computed, never applied by computing it. Applying requires the previewed analysis '
                'and an explicit confirmation. Locked objects are reported, approved content is never rewritten silently.',
            'direction': 'An edge means one thing only: the source is relied upon, the target depends on it.'})

    # ------------------------------------------------------------------ dependencies

    @application.post(f'{base}/dependencies/sync')
    async def sync_dependencies(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Derive the edges the Production already knows: bindings, plans and dialogue runtime."""

        data = await repository(gateway).sync(workspace_id, production_id, request.state.access_token)
        logger.info('dependency_sync', extra={'context': {'event': 'dependency_sync',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'edges_considered': data.get('edges_considered')}})
        return envelope(request, data)

    @application.post(f'{base}/dependencies')
    async def declare_dependency(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Declare one dependency, explicit or inferred-with-rationale. A self-edge is refused."""

        body = _validated(DependencyEdgeRequest, await request.json(), 'Check the dependency fields.')
        data = await repository(gateway).edge(workspace_id, production_id, request.state.access_token,
            source_object_id=_uuid(body.source_object_id, 'That source identifier is invalid.'),
            target_object_id=_uuid(body.target_object_id, 'That target identifier is invalid.'),
            relation=body.relation, strength=body.strength, origin=body.origin, reason=body.reason,
            affected_fields=body.affected_fields, evidence=body.evidence)
        return envelope(request, data)

    @application.patch(f'{base}/dependencies/active')
    async def set_dependencies_active(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Deactivate or reactivate edges. The relationship row is kept as history."""

        body = _validated(DependencyActiveRequest, await request.json(), 'Check the dependency state fields.')
        edge_ids = [str(_uuid(value, 'That dependency identifier is invalid.')) for value in body.edge_ids]
        return envelope(request, await repository(gateway).set_active(workspace_id, production_id,
            request.state.access_token, edge_ids=edge_ids, active=body.active, note=body.note))

    @application.get(f'{base}/dependencies')
    async def list_dependencies(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Every stored edge touching one object, with its rationale and its active state."""

        object_id = _uuid(request.query_params.get('object_id'), 'That object identifier is invalid.')
        data = await repository(gateway).edges(workspace_id, production_id, request.state.access_token,
            object_id=object_id, limit=_bounded_int(request, 'limit', 100), offset=_offset(request))
        return envelope(request, decorate_edges(data))

    @application.get(f'{base}/graph')
    async def dependency_graph(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Bounded, cycle-safe traversal: what this affects, or what it depends on."""

        direction = request.query_params.get('direction') or 'forward'
        if direction not in ('forward', 'reverse'):
            raise AppError('INVALID_INTELLIGENCE_INPUT', 'validation', 'Direction must be forward or reverse.', 422)
        data = await repository(gateway).graph(workspace_id, production_id, request.state.access_token,
            object_id=_uuid(request.query_params.get('object_id'), 'That object identifier is invalid.'),
            direction=direction, depth=_bounded_int(request, 'depth', 2, low=1, high=8),
            limit=_bounded_int(request, 'limit', 200, low=1, high=500))
        return envelope(request, decorate_graph(data))

    # ------------------------------------------------------------------ impact

    @application.post(f'{base}/impact/preview')
    async def preview_impact(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Compute and record an impact. Nothing in the Production changes."""

        body = _validated(ImpactPreviewRequest, await request.json(), 'Check the impact preview fields.')
        data = await repository(gateway).preview(workspace_id, production_id, request.state.access_token,
            object_id=_uuid(body.object_id, 'That object identifier is invalid.'), depth=body.depth, limit=body.limit)
        return envelope(request, decorate_impact(data))

    @application.get(f'{base}/impact/history')
    async def impact_history(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Impact analyses for this Production, newest first. History is never overwritten."""

        data = await repository(gateway).history(workspace_id, production_id, request.state.access_token,
            limit=_bounded_int(request, 'limit', 20, low=1, high=100), offset=_offset(request))
        return envelope(request, decorate_history(data))

    @application.post(f'{base}/impact/apply')
    async def apply_impact(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Apply a previewed impact as UPDATE ALL, REVIEW CHANGES or CHANGE ONLY THIS."""

        body = _validated(ImpactApplyRequest, await request.json(), 'Check the impact application fields.')
        if not body.confirm:
            raise AppError('IMPACT_CONFIRMATION_REQUIRED', 'authorization',
                'Confirm the propagation choice before TONDE applies this impact.', 409)
        if not body.review_selection_is_present():
            raise AppError('IMPACT_REVIEW_SELECTION_REQUIRED', 'validation',
                'REVIEW CHANGES needs the dependents you want to change.', 422)
        selected = [str(_uuid(value, 'That dependent identifier is invalid.')) for value in body.selected_ids]
        data = await repository(gateway).apply(workspace_id, production_id, request.state.access_token,
            analysis_id=_uuid(body.analysis_id, 'That impact analysis identifier is invalid.'), mode=body.mode,
            selected_ids=selected, expected_root_revision=body.expected_root_revision, note=body.note)
        logger.info('impact_applied', extra={'context': {'event': 'impact_applied',
            'workspace_id': str(workspace_id), 'production_id': str(production_id), 'mode': body.mode,
            'marked': data.get('marked')}})
        return envelope(request, decorate_apply(data))

    # ------------------------------------------------------------------ stale artifacts

    @application.get(f'{base}/stale')
    async def stale_artifacts(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Artifacts that may no longer match their source, with the reason and the cause."""

        state = request.query_params.get('state')
        if state is not None and state not in ('current', 'stale', 'conflicted'):
            raise AppError('INVALID_INTELLIGENCE_INPUT', 'validation', 'Unsupported stale state.', 422)
        data = await repository(gateway).stale_artifacts(workspace_id, production_id, request.state.access_token,
            state=state, limit=_bounded_int(request, 'limit', 100), offset=_offset(request))
        return envelope(request, decorate_markers(data))

    @application.post(f'{base}/stale')
    async def mark_stale(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record that an artifact may no longer match its source. The artifact itself is untouched."""

        body = _validated(StaleMarkRequest, await request.json(), 'Check the stale marker fields.')
        data = await repository(gateway).mark_stale(workspace_id, production_id, request.state.access_token,
            object_id=_uuid(body.object_id, 'That object identifier is invalid.'), artifact_kind=body.artifact_kind,
            reason=body.reason, reference=_optional_uuid(body.reference, 'That reference is invalid.'))
        data['note'] = 'The artifact was marked, not rewritten, and the marker stays readable as history.'
        return envelope(request, data)

    @application.post(f'{base}/stale/{{artifact_id}}/resolve')
    async def resolve_stale(workspace_id: UUID, production_id: UUID, artifact_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Resolve one marker. Resolution is a creator decision, never an automatic rewrite."""

        body = _validated(StaleResolveRequest, await request.json(), 'Check the resolution fields.')
        return envelope(request, await repository(gateway).resolve_stale(workspace_id, production_id,
            request.state.access_token, artifact_id=_uuid(artifact_id, 'That artifact identifier is invalid.'),
            note=body.note))
