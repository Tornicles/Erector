"""Prompt 9B continuity HTTP surface.

Continuity answers: what changes when this changes, is the Production still consistent, what did
we decide before, and what is actually unknown. This surface exposes exactly that and nothing
more:

* statements are declared and retired, never overwritten - a different value at the same point
  supersedes the older statement, which stays readable;
* a check is a recorded analysis. Running it changes no statement, and it never claims to have
  analysed media;
* a finding is a statement about the recorded declarations, and resolving one is a creator
  decision - there is no `approved` finding state;
* an inferred proposal must disclose its basis and can never claim to be an observation.

Every write goes through a guarded security-definer RPC, so tenant isolation, editor authority,
lock protection and revision handling are decided in the database rather than here.
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
from app.domain.continuity import (
    DOMAINS,
    ContinuityCheckRequest,
    ContinuityFindingUpdateRequest,
    ContinuityProposalRequest,
    ContinuityRetireRequest,
    ContinuityStateRequest,
)
from app.services.continuity import (
    ContinuityRepository,
    decorate_chain,
    decorate_check,
    decorate_finding,
    decorate_findings,
    decorate_states,
    decorate_summary,
    vocabulary,
)

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise AppError('INVALID_CONTINUITY_INPUT', 'validation', message, 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_CONTINUITY_INPUT', 'validation', message, 422) from exc


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
        raise AppError('INVALID_CONTINUITY_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def _offset(request: Request) -> int:
    raw = request.query_params.get('offset') or '0'
    try:
        return max(0, int(raw))
    except ValueError as exc:
        raise AppError('INVALID_CONTINUITY_INPUT', 'validation', 'offset must be a whole number.', 422) from exc


def register_production_continuity_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/continuity'
    repository = ContinuityRepository

    # ------------------------------------------------------------------ vocabulary

    @application.get(f'{base}/vocabulary')
    async def continuity_vocabulary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The domains, anchors, transitions, rules and the limitation that bounds every check."""

        return envelope(request, vocabulary())

    # ------------------------------------------------------------------ summary

    @application.get(f'{base}/summary')
    async def continuity_summary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """What the Production records, what the last check found, and whether it is still current."""

        data = await repository(gateway).summary(workspace_id, production_id, request.state.access_token)
        return envelope(request, decorate_summary(data))

    # ------------------------------------------------------------------ statements

    @application.get(f'{base}/states')
    async def list_continuity_states(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Recorded statements, newest first, with retired history available on request."""

        domain = request.query_params.get('domain')
        if domain is not None and domain not in DOMAINS:
            raise AppError('INVALID_CONTINUITY_INPUT', 'validation', 'Unsupported continuity domain.', 422)
        include_retired = (request.query_params.get('include_retired') or '').lower() in ('1', 'true', 'yes')
        data = await repository(gateway).states(workspace_id, production_id, request.state.access_token,
            subject=_optional_uuid(request.query_params.get('subject_object_id'), 'That subject identifier is invalid.'),
            domain=domain, include_retired=include_retired, limit=_bounded_int(request, 'limit', 100),
            offset=_offset(request))
        return envelope(request, decorate_states(data))

    @application.post(f'{base}/states')
    async def set_continuity_state(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record the creator's statement. A different value at the same point supersedes the older one."""

        body = _validated(ContinuityStateRequest, await request.json(), 'Check the continuity statement fields.')
        if not body.anchor_is_coherent():
            raise AppError('INVALID_CONTINUITY_INPUT', 'validation',
                'A Shot statement names a Shot, a Scene statement names a Scene, and a Production statement names neither.', 422)
        data = await repository(gateway).set_state(workspace_id, production_id, request.state.access_token, {
            'domain': body.domain, 'trait': body.trait, 'value': body.value, 'anchor': body.anchor,
            'transition': body.transition, 'epistemic': body.epistemic, 'confidence': body.confidence,
            'reason': body.reason, 'evidence': body.evidence, 'note': body.note,
            'subject_object_id': body.subject_object_id or None,
            'scene_id': body.scene_id or None, 'shot_id': body.shot_id or None})
        logger.info('continuity_state_recorded', extra={'context': {
            'event': 'continuity_state_recorded', 'workspace_id': str(workspace_id),
            'production_id': str(production_id), 'domain': body.domain, 'anchor': body.anchor,
            'superseded': bool(data.get('superseded_state_id'))}})
        return envelope(request, data)

    @application.post(f'{base}/states/{{state_id}}/retire')
    async def retire_continuity_state(workspace_id: UUID, production_id: UUID, state_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Retire a statement without replacing it. The record stays readable as history."""

        body = _validated(ContinuityRetireRequest, await request.json(), 'Check the retirement fields.')
        return envelope(request, await repository(gateway).retire_state(workspace_id, production_id,
            request.state.access_token, state_id=_uuid(state_id, 'That statement identifier is invalid.'),
            reason=body.reason))

    @application.get(f'{base}/chain')
    async def continuity_chain(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The recorded timeline of one subject: what changed, when, and why."""

        subject = _uuid(request.query_params.get('subject_object_id'), 'That subject identifier is invalid.')
        domain = request.query_params.get('domain')
        if domain is not None and domain not in DOMAINS:
            raise AppError('INVALID_CONTINUITY_INPUT', 'validation', 'Unsupported continuity domain.', 422)
        trait = request.query_params.get('trait')
        if trait is not None and len(trait) > 120:
            raise AppError('INVALID_CONTINUITY_INPUT', 'validation', 'That trait name is too long.', 422)
        data = await repository(gateway).chain(workspace_id, production_id, request.state.access_token,
            subject=subject, domain=domain, trait=trait)
        return envelope(request, decorate_chain(data))

    # ------------------------------------------------------------------ checks

    @application.post(f'{base}/check')
    async def run_continuity_check(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Run the deterministic check. It records its findings and changes no statement."""

        body = _validated(ContinuityCheckRequest, await request.json(), 'Check the continuity check fields.')
        data = await repository(gateway).check(workspace_id, production_id, request.state.access_token, note=body.note)
        logger.info('continuity_check_run', extra={'context': {'event': 'continuity_check_run',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'verdict': data.get('verdict'), 'findings': data.get('finding_count')}})
        return envelope(request, decorate_check(data))

    # ------------------------------------------------------------------ findings

    @application.get(f'{base}/findings')
    async def list_continuity_findings(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The recorded check's findings, plus any proposal that belongs to no check."""

        state = request.query_params.get('state')
        if state is not None and state not in ('open', 'acknowledged', 'resolved', 'waived'):
            raise AppError('INVALID_CONTINUITY_INPUT', 'validation', 'Unsupported finding state.', 422)
        severity = request.query_params.get('severity')
        if severity is not None and severity not in ('info', 'warning', 'critical'):
            raise AppError('INVALID_CONTINUITY_INPUT', 'validation', 'Unsupported severity.', 422)
        data = await repository(gateway).findings(workspace_id, production_id, request.state.access_token,
            state=state, severity=severity,
            check_id=_optional_uuid(request.query_params.get('check_id'), 'That check identifier is invalid.'),
            limit=_bounded_int(request, 'limit', 100), offset=_offset(request))
        return envelope(request, decorate_findings(data))

    @application.patch(f'{base}/findings/{{finding_id}}')
    async def update_continuity_finding(workspace_id: UUID, production_id: UUID, finding_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Acknowledge, resolve, waive or reopen a finding. A creator decision, never an approval."""

        body = _validated(ContinuityFindingUpdateRequest, await request.json(), 'Check the finding state fields.')
        data = await repository(gateway).update_finding(workspace_id, production_id, request.state.access_token,
            finding_id=_uuid(finding_id, 'That finding identifier is invalid.'), state=body.state, note=body.note)
        return envelope(request, data)

    @application.post(f'{base}/findings')
    async def record_continuity_proposal(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record an inferred proposal with its basis. It can never claim an observation."""

        body = _validated(ContinuityProposalRequest, await request.json(), 'Check the continuity proposal fields.')
        data = await repository(gateway).record_proposal(workspace_id, production_id, request.state.access_token,
            finding_record={'kind': body.kind, 'domain': body.domain, 'severity': body.severity, 'trait': body.trait,
            'explanation': body.explanation, 'suggested_resolution': body.suggested_resolution,
            'rationale': body.rationale, 'epistemic': body.epistemic, 'confidence': body.confidence,
            'evidence': body.evidence, 'subject_object_id': body.subject_object_id or None,
            'scene_id': body.scene_id or None, 'shot_id': body.shot_id or None})
        logger.info('continuity_proposal_recorded', extra={'context': {
            'event': 'continuity_proposal_recorded', 'workspace_id': str(workspace_id),
            'production_id': str(production_id), 'kind': body.kind, 'epistemic': body.epistemic}})
        return envelope(request, decorate_finding(data))
