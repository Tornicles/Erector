"""Prompt 9C production memory and structured search HTTP surface.

Memory answers: what did we decide before, why is TONDE using this, and what can I find. This
surface exposes exactly that and nothing more:

* a memory item is inspectable - statement, kind, scope, source, authority tier, pinned source
  object and revision, creator-confirmation, and whether it is in force. An outranked item is
  returned as outranked, never hidden;
* ``memory_resolve`` answers "why is TONDE using this" with the considered set and the reason the
  winner won;
* a successful-pattern candidate is a proposal drawn from real evidence. It pins a revision, it
  honours the scope's memory policy, and it changes no behaviour until a creator decision;
* structured search returns real object references from real columns and relationships. It never
  uses embeddings and it never reads media, and both facts travel with every response.

Every write goes through a guarded security-definer RPC, so tenant isolation, editor authority and
revision handling are decided in the database rather than here. Memory tables have no direct write
path at all: the RPC is the only way in.
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
from app.domain.memory import (
    CANDIDATE_STATES,
    ITEM_STATES,
    KINDS,
    SCOPES,
    MemoryCandidateDecisionRequest,
    MemoryCandidateRequest,
    MemoryItemRequest,
    MemoryPolicyRequest,
    MemoryRetireRequest,
    ProductionSearchQuery,
)
from app.services.memory import (
    MemoryRepository,
    decorate_candidate,
    decorate_candidates,
    decorate_item,
    decorate_items,
    decorate_policies,
    decorate_policy,
    decorate_resolve,
    decorate_search,
    decorate_summary,
    vocabulary,
)

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    """Validate a request and, when it fails, say *why* rather than only that something is wrong.

    The rules this endpoint enforces are product rules (an inference cannot claim creator
    authority, an accepted item is created by accepting a candidate, a candidate needs real
    evidence). A creator who trips one of them deserves the reason, not a generic rejection.
    """

    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_MEMORY_INPUT', 'validation',
            f'{message} {reason}'.strip(), 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_MEMORY_INPUT', 'validation', message, 422) from exc


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
        raise AppError('INVALID_MEMORY_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def _offset(request: Request) -> int:
    raw = request.query_params.get('offset') or '0'
    try:
        return max(0, int(raw))
    except ValueError as exc:
        raise AppError('INVALID_MEMORY_INPUT', 'validation', 'offset must be a whole number.', 422) from exc


def _query_param(request: Request, name: str) -> str | None:
    value = request.query_params.get(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _query_values(request: Request, name: str) -> list[str]:
    raw = request.query_params.get(name)
    if raw is None or raw.strip() == '':
        return []
    return [part.strip() for part in raw.split(',') if part.strip()]


def _search_query(request: Request) -> ProductionSearchQuery:
    """Build a validated structured-search request from the query string."""

    asset_id = _query_param(request, 'asset_id')
    if asset_id is not None:
        _uuid(asset_id, 'That Asset identifier is invalid.')
    body = {
        'text': _query_param(request, 'text'),
        'kinds': _query_values(request, 'kinds'),
        'asset_id': asset_id,
        'asset_name': _query_param(request, 'asset_name'),
        'asset_type': _query_param(request, 'asset_type'),
        'environment': _query_param(request, 'environment'),
        'approval': _query_param(request, 'approval'),
        'execution_method': _query_param(request, 'execution_method'),
        'provider': _query_param(request, 'provider'),
        'model': _query_param(request, 'model'),
        'lens': _query_param(request, 'lens'),
        'continuity_state': _query_param(request, 'continuity_state'),
        'severity': _query_param(request, 'severity'),
        'domain': _query_param(request, 'domain'),
        'result_state': _query_param(request, 'result_state'),
        'memory_kind': _query_param(request, 'memory_kind'),
        'limit': _bounded_int(request, 'limit', 50, low=1, high=100),
    }
    return _validated(ProductionSearchQuery, body, 'Check the search filters; one of them is not a real filter value.')


def register_production_memory_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/memory'
    repository = MemoryRepository

    # ------------------------------------------------------------------ vocabulary

    @application.get(f'{base}/vocabulary')
    async def memory_vocabulary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The scopes, kinds, authority tiers and the limits that bound memory and search."""

        return envelope(request, vocabulary())

    # ------------------------------------------------------------------ summary

    @application.get(f'{base}/summary')
    async def memory_summary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """What this Production remembers, and what is waiting for a creator decision."""

        data = await repository(gateway).summary(workspace_id, production_id, request.state.access_token)
        return envelope(request, decorate_summary(data))

    # ------------------------------------------------------------------ items

    @application.get(f'{base}/items')
    async def list_memory_items(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Remembered items that apply here, with their provenance and whether they are in force."""

        scope = _query_param(request, 'scope')
        if scope is not None and scope not in SCOPES:
            raise AppError('INVALID_MEMORY_INPUT', 'validation', 'Unsupported memory scope.', 422)
        kind = _query_param(request, 'kind')
        if kind is not None and kind not in KINDS:
            raise AppError('INVALID_MEMORY_INPUT', 'validation', 'Unsupported memory kind.', 422)
        state = _query_param(request, 'state') or 'active'
        if state not in ITEM_STATES:
            raise AppError('INVALID_MEMORY_INPUT', 'validation', 'Unsupported memory state filter.', 422)
        subject = _query_param(request, 'subject_key')
        if subject is not None and len(subject) > 160:
            raise AppError('INVALID_MEMORY_INPUT', 'validation', 'That subject key is too long.', 422)
        data = await repository(gateway).items(workspace_id, production_id, request.state.access_token,
            scope=scope, kind=kind, subject=subject, state=state, limit=_bounded_int(request, 'limit', 100),
            offset=_offset(request))
        return envelope(request, decorate_items(data))

    @application.post(f'{base}/items')
    async def set_memory_item(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Remember a statement with its authority tier. Restating the same tier supersedes it."""

        body = _validated(MemoryItemRequest, await request.json(), 'Check the memory item fields.')
        data = await repository(gateway).set_item(workspace_id, production_id, request.state.access_token,
            item={'scope': body.scope, 'kind': body.kind, 'subject_key': body.subject_key,
                'statement': body.statement, 'source': body.source, 'origin': body.origin,
                'series_id': body.series_id or None, 'source_object_id': body.source_object_id or None,
                'source_revision': body.source_revision, 'rationale': body.rationale,
                'evidence': body.evidence})
        logger.info('memory_item_recorded', extra={'context': {'event': 'memory_item_recorded',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'scope': body.scope, 'kind': body.kind, 'source': body.source, 'origin': body.origin,
            'superseded': bool(data.get('superseded_id'))}})
        return envelope(request, decorate_item(data))

    @application.post(f'{base}/items/{{item_id}}/retire')
    async def retire_memory_item(workspace_id: UUID, production_id: UUID, item_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Retire a remembered item. It stays readable as history and is never deleted."""

        body = _validated(MemoryRetireRequest, await request.json(), 'Check the retirement fields.')
        data = await repository(gateway).retire_item(workspace_id, production_id, request.state.access_token,
            item_id=_uuid(item_id, 'That memory item identifier is invalid.'), reason=body.reason)
        logger.info('memory_item_retired', extra={'context': {'event': 'memory_item_retired',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'item_id': str(item_id)}})
        return envelope(request, data)

    @application.get(f'{base}/resolve')
    async def resolve_memory(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Why TONDE is using this: the item in force, what it outranked, and on what authority."""

        subject = _query_param(request, 'subject_key')
        if subject is None:
            raise AppError('INVALID_MEMORY_INPUT', 'validation', 'A subject key is required.', 422)
        if len(subject) > 160:
            raise AppError('INVALID_MEMORY_INPUT', 'validation', 'That subject key is too long.', 422)
        kind = _query_param(request, 'kind')
        if kind is not None and kind not in KINDS:
            raise AppError('INVALID_MEMORY_INPUT', 'validation', 'Unsupported memory kind filter.', 422)
        data = await repository(gateway).resolve(workspace_id, production_id, request.state.access_token,
            subject=subject, kind=kind)
        return envelope(request, decorate_resolve(data))

    # ------------------------------------------------------------------ policy

    @application.get(f'{base}/policies')
    async def list_memory_policies(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The effective memory policy for each applicable scope, and whether it is explicit."""

        data = await repository(gateway).policies(workspace_id, production_id, request.state.access_token)
        return envelope(request, decorate_policies(data))

    @application.put(f'{base}/policies')
    async def set_memory_policy(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Decide whether TONDE may record candidates here, and whether they become memory alone."""

        body = _validated(MemoryPolicyRequest, await request.json(), 'Check the memory policy fields.')
        data = await repository(gateway).set_policy(workspace_id, production_id, request.state.access_token,
            policy={'scope': body.scope, 'series_id': body.series_id or None,
                'candidate_capture': body.candidate_capture,
                'auto_accept_candidates': body.auto_accept_candidates, 'note': body.note})
        logger.info('memory_policy_set', extra={'context': {'event': 'memory_policy_set',
            'workspace_id': str(workspace_id), 'production_id': str(production_id), 'scope': body.scope,
            'candidate_capture': body.candidate_capture, 'auto_accept': body.auto_accept_candidates}})
        return envelope(request, decorate_policy(data))

    # ------------------------------------------------------------------ candidates

    @application.get(f'{base}/candidates')
    async def list_memory_candidates(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Successful-pattern candidates drawn from real evidence, and the policy that governs them."""

        state = _query_param(request, 'state') or 'proposed'
        if state not in CANDIDATE_STATES:
            raise AppError('INVALID_MEMORY_INPUT', 'validation', 'Unsupported candidate state filter.', 422)
        data = await repository(gateway).candidates(workspace_id, production_id, request.state.access_token,
            state=state, limit=_bounded_int(request, 'limit', 50), offset=_offset(request))
        return envelope(request, decorate_candidates(data))

    @application.post(f'{base}/candidates')
    async def record_memory_candidate(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record a candidate from real evidence. It becomes memory only under the policy or a decision."""

        body = _validated(MemoryCandidateRequest, await request.json(), 'Check the pattern candidate fields.')
        data = await repository(gateway).record_candidate(workspace_id, production_id, request.state.access_token,
            candidate={'kind': body.kind, 'subject_key': body.subject_key, 'statement': body.statement,
                'proposed_source': body.proposed_source, 'observed_count': body.observed_count,
                'source_object_id': body.source_object_id, 'source_revision': body.source_revision,
                'basis': body.basis})
        logger.info('memory_candidate_recorded', extra={'context': {'event': 'memory_candidate_recorded',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'kind': body.kind, 'state': data.get('state'), 'duplicate': data.get('duplicate')}})
        return envelope(request, decorate_candidate(data))

    @application.post(f'{base}/candidates/{{candidate_id}}/decide')
    async def decide_memory_candidate(workspace_id: UUID, production_id: UUID, candidate_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Accept a candidate as memory, or dismiss it. Nothing else turns a proposal into memory."""

        body = _validated(MemoryCandidateDecisionRequest, await request.json(), 'Check the candidate decision fields.')
        data = await repository(gateway).decide_candidate(workspace_id, production_id, request.state.access_token,
            candidate_id=_uuid(candidate_id, 'That candidate identifier is invalid.'),
            decision=body.decision, note=body.note)
        logger.info('memory_candidate_decided', extra={'context': {'event': 'memory_candidate_decided',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'candidate_id': str(candidate_id), 'decision': body.decision, 'state': data.get('state')}})
        return envelope(request, decorate_candidate(data))

    # ------------------------------------------------------------------ structured search

    @application.get(f'{base}/search')
    async def production_search(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Structured search over real Production state, returning real object references."""

        query = _search_query(request)
        data = await repository(gateway).search(workspace_id, production_id, request.state.access_token,
            query=query.rpc_body())
        logger.info('production_search_run', extra={'context': {'event': 'production_search_run',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'kinds': list(query.kinds), 'facets': len((data.get('interpretation') or {}).get('facets') or []),
            'total': data.get('total')}})
        return envelope(request, decorate_search(data))
