"""Prompt 9D versioning, branches, restore and merge HTTP surface.

Versioning answers: what version am I looking at, what changed, can I try an alternative without
losing the mainline, and what will happen if I accept it. This surface exposes exactly that:

* version history is history - immutable, pinned, and never rewritten. A restore creates a new
  current revision instead of rewinding;
* compare shows the meaningful creative fields that differ, not a raw JSON diff;
* a branch is an object-level alternative. Its edits are proposals on the branch and change nothing
  on the mainline until an explicit, reviewed merge;
* a merge is a proposal: a conflict is shown rather than resolved automatically, and accepting one
  propagates through the Prompt 9A dependency-aware impact engine instead of rewriting approved
  content silently.

Every write goes through a guarded security-definer RPC, so tenant isolation, editor authority,
revision handling and staleness are decided in the database rather than here.
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
from app.domain.versioning import (
    BRANCH_STATES,
    BranchChangeClearRequest,
    BranchChangeRequest,
    BranchCreateRequest,
    BranchStateRequest,
    MergeDecideRequest,
    VersionRestoreRequest,
)
from app.services.versioning import (
    VersionRepository,
    decorate_branch,
    decorate_branches,
    decorate_change,
    decorate_comparison,
    decorate_decision,
    decorate_preview,
    decorate_restore,
    decorate_version,
    decorate_versions,
    vocabulary,
)

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    """Validate a request and, when it fails, say *why* rather than only that something is wrong."""

    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_VERSION_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_VERSION_INPUT', 'validation', message, 422) from exc


def _query_param(request: Request, name: str) -> str | None:
    value = request.query_params.get(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _required_param(request: Request, name: str, message: str) -> str:
    value = _query_param(request, name)
    if value is None:
        raise AppError('INVALID_VERSION_INPUT', 'validation', message, 422)
    return value


def _bounded_int(request: Request, name: str, default: int, *, low: int = 1, high: int = 200) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == '':
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_VERSION_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def _offset(request: Request) -> int:
    raw = request.query_params.get('offset') or '0'
    try:
        return max(0, int(raw))
    except ValueError as exc:
        raise AppError('INVALID_VERSION_INPUT', 'validation', 'offset must be a whole number.', 422) from exc


def register_production_versioning_routes(application: FastAPI, config: Settings,
    logger: logging.Logger, envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/versions'
    repository = VersionRepository

    # ------------------------------------------------------------------ vocabulary

    @application.get(f'{base}/vocabulary')
    async def versioning_vocabulary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The branch scopes, states, branchable fields and propagation modes."""

        return envelope(request, vocabulary())

    # ------------------------------------------------------------------ history

    @application.get(base)
    async def list_versions(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """What version am I looking at: the immutable history of one object."""

        object_id = _uuid(_required_param(request, 'object_id', 'A version list needs the object it belongs to.'),
            'That object identifier is invalid.')
        branch = _query_param(request, 'branch') or 'main'
        if len(branch) > 100:
            raise AppError('INVALID_VERSION_INPUT', 'validation', 'That branch name is too long.', 422)
        data = await repository(gateway).versions(workspace_id, production_id, request.state.access_token,
            object_id=object_id, branch=branch, limit=_bounded_int(request, 'limit', 50), offset=_offset(request))
        return envelope(request, decorate_versions(data))

    @application.get(f'{base}/compare')
    async def compare_versions(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Compare two versions of the same object and show the meaningful fields that differ."""

        left = _uuid(_required_param(request, 'left_version_id', 'Name the version you are comparing from.'),
            'That version identifier is invalid.')
        right = _uuid(_required_param(request, 'right_version_id', 'Name the version you are comparing to.'),
            'That version identifier is invalid.')
        if left == right:
            raise AppError('INVALID_VERSION_INPUT', 'validation',
                'Compare two different versions.', 422)
        data = await repository(gateway).compare(workspace_id, production_id, request.state.access_token,
            left=left, right=right)
        return envelope(request, decorate_comparison(data))

    # ------------------------------------------------------------------ branches

    @application.get(f'{base}/branches')
    async def list_branches(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The creative alternatives of this Production."""

        state = _query_param(request, 'state')
        if state is not None and state not in BRANCH_STATES:
            raise AppError('INVALID_VERSION_INPUT', 'validation', 'Unsupported branch state filter.', 422)
        data = await repository(gateway).branches(workspace_id, production_id, request.state.access_token,
            state=state, limit=_bounded_int(request, 'limit', 50), offset=_offset(request))
        return envelope(request, decorate_branches(data))

    @application.post(f'{base}/branches')
    async def create_branch(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Open an alternative from a known version. Nothing on the mainline changes."""

        body = _validated(BranchCreateRequest, await request.json(), 'Check the branch fields.')
        scope_object_id = _uuid(body.scope_object_id, 'That scope object identifier is invalid.')
        data = await repository(gateway).create_branch(workspace_id, production_id, request.state.access_token,
            scope_object_id=scope_object_id, branch={'name': body.name.strip(), 'scope': body.scope,
                'source_version_id': body.source_version_id or None, 'reason': body.reason})
        logger.info('branch_created', extra={'context': {'event': 'branch_created',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'branch_id': str(data.get('branch_id')), 'scope': body.scope}})
        return envelope(request, data)

    @application.get(f'{base}/branches/{{branch_id}}')
    async def branch_detail(workspace_id: UUID, production_id: UUID, branch_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One branch, its origin, and the changes it proposes."""

        data = await repository(gateway).branch(workspace_id, production_id, request.state.access_token,
            branch_id=_uuid(branch_id, 'That branch identifier is invalid.'))
        return envelope(request, decorate_branch(data))

    @application.post(f'{base}/branches/{{branch_id}}/changes')
    async def set_branch_change(workspace_id: UUID, production_id: UUID, branch_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Propose a field patch on a branch. The mainline is not touched."""

        body = _validated(BranchChangeRequest, await request.json(), 'Check the branch change fields.')
        target = _uuid(body.target_object_id, 'That target object identifier is invalid.')
        data = await repository(gateway).set_change(workspace_id, production_id, request.state.access_token,
            branch_id=_uuid(branch_id, 'That branch identifier is invalid.'),
            change={'target_object_id': str(target), 'patch': body.patch, 'note': body.note})
        logger.info('branch_change_recorded', extra={'context': {'event': 'branch_change_recorded',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'branch_id': str(branch_id), 'target_object_id': str(target),
            'fields': list(body.patch)}})
        return envelope(request, decorate_change(data))

    @application.post(f'{base}/branches/{{branch_id}}/changes/{{change_id}}/clear')
    async def clear_branch_change(workspace_id: UUID, production_id: UUID, branch_id: str, change_id: str,
        request: Request, user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Discard a proposed change. It stays readable as branch history."""

        body = _validated(BranchChangeClearRequest, await request.json(), 'Check the discard fields.')
        data = await repository(gateway).clear_change(workspace_id, production_id, request.state.access_token,
            branch_id=_uuid(branch_id, 'That branch identifier is invalid.'),
            change_id=_uuid(change_id, 'That change identifier is invalid.'), note=body.note)
        logger.info('branch_change_cleared', extra={'context': {'event': 'branch_change_cleared',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'branch_id': str(branch_id), 'change_id': str(change_id)}})
        return envelope(request, data)

    @application.post(f'{base}/branches/{{branch_id}}/state')
    async def set_branch_state(workspace_id: UUID, production_id: UUID, branch_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Abandon or reopen a branch. Merging happens only through a merge decision."""

        body = _validated(BranchStateRequest, await request.json(), 'Check the branch state fields.')
        data = await repository(gateway).set_branch_state(workspace_id, production_id, request.state.access_token,
            branch_id=_uuid(branch_id, 'That branch identifier is invalid.'), state=body.state, note=body.note)
        logger.info('branch_state_set', extra={'context': {'event': 'branch_state_set',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'branch_id': str(branch_id), 'state': body.state}})
        return envelope(request, data)

    @application.post(f'{base}/branches/{{branch_id}}/merge-preview')
    async def preview_merge(workspace_id: UUID, production_id: UUID, branch_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Classify every proposed change as clean or conflicted and record a real proposal."""

        data = await repository(gateway).preview(workspace_id, production_id, request.state.access_token,
            branch_id=_uuid(branch_id, 'That branch identifier is invalid.'))
        logger.info('merge_previewed', extra={'context': {'event': 'merge_previewed',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'branch_id': str(branch_id), 'proposal_id': str(data.get('proposal_id')),
            'counts': data.get('counts')}})
        return envelope(request, decorate_preview(data))

    @application.post(f'{base}/merges/{{proposal_id}}/decide')
    async def decide_merge(workspace_id: UUID, production_id: UUID, proposal_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Accept or reject a merge. Only clean, selected changes become new mainline revisions."""

        body = _validated(MergeDecideRequest, await request.json(), 'Check the merge decision fields.')
        selected = [_uuid(value, 'That change identifier is invalid.') for value in body.selected_change_ids]
        data = await repository(gateway).decide(workspace_id, production_id, request.state.access_token,
            proposal_id=_uuid(proposal_id, 'That merge proposal identifier is invalid.'),
            decision=body.decision, selected=[str(value) for value in selected],
            propagation=body.propagation, note=body.note)
        logger.info('merge_decided', extra={'context': {'event': 'merge_decided',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'proposal_id': str(proposal_id), 'decision': body.decision, 'propagation': body.propagation,
            'applied_count': data.get('applied_count')}})
        return envelope(request, decorate_decision(data))

    # ------------------------------------------------------------------ one version

    @application.get(f'{base}/{{version_id}}')
    async def get_version(workspace_id: UUID, production_id: UUID, version_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """What one version was, exactly as it was recorded."""

        data = await repository(gateway).version(workspace_id, production_id, request.state.access_token,
            version_id=_uuid(version_id, 'That version identifier is invalid.'))
        return envelope(request, decorate_version(data))

    @application.post(f'{base}/{{version_id}}/restore')
    async def restore_version(workspace_id: UUID, production_id: UUID, version_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Create a new current revision from an older version. Nothing is rewound or deleted."""

        body = _validated(VersionRestoreRequest, await request.json(), 'Check the restore fields.')
        data = await repository(gateway).restore(workspace_id, production_id, request.state.access_token,
            version_id=_uuid(version_id, 'That version identifier is invalid.'), note=body.note)
        logger.info('version_restored', extra={'context': {'event': 'version_restored',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'version_id': str(version_id), 'new_revision': data.get('new_revision')}})
        return envelope(request, decorate_restore(data))
