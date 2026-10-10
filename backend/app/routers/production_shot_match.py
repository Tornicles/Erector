"""Prompt 9F Result, Shot Match and FIX THIS SHOT HTTP surface.

This surface answers the questions a creator asks after something was actually created:

* *what was actually created, and where did it come from?* - the Result with its provenance, the
  Take or AI Attempt behind it, and the media modalities the database verified;
* *did this Shot match the plan, and what is different?* - the analysis, its per-dimension verdicts,
  the four-part summary ordered by production impact, and what it could not see;
* *how do I fix only this Shot?* - FIX THIS SHOT: one scoped correction on one object, with a
  previewed impact, preserving the previous plan, the Result and every earlier analysis.

Nothing here is a similarity score, nothing here approves a Result, and nothing here launches
generation. Recommending regeneration is a recommendation; the normal explicit confirmation is still
required to spend money. Every write goes through a guarded security-definer RPC and the database
remains authoritative for legality, staleness, locks and verified media capability.
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
from app.domain.shot_match import (
    CorrectionApplyRequest,
    CorrectionProposeRequest,
    CorrectionRejectRequest,
    MatchAnalyzeRequest,
    MatchDecideRequest,
    ResultRegisterRequest,
    ResultStateRequest,
)
from app.services.shot_match import (
    ShotMatchRepository,
    decorate_correction,
    decorate_decision,
    decorate_report,
    decorate_report_list,
    decorate_result,
    decorate_result_list,
    vocabulary,
)

Envelope = Any

RESULT_STATE_FILTERS = ('raw', 'needs_review', 'approved', 'rejected', 'final')


def _validated(model: type[Any], body: Any, message: str) -> Any:
    """Validate a request and, when it fails, say *why* rather than only that something is wrong."""

    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_SHOT_MATCH_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_SHOT_MATCH_INPUT', 'validation', message, 422) from exc


def _optional_uuid(value: str | None, message: str) -> UUID | None:
    if value is None or value == '':
        return None
    return _uuid(value, message)


def _bounded_int(request: Request, name: str, default: int, *, low: int = 1, high: int = 200) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == '':
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise AppError('INVALID_SHOT_MATCH_INPUT', 'validation', f'{name} must be a whole number.', 422) from exc
    return max(low, min(high, parsed))


def _offset(request: Request) -> int:
    raw = request.query_params.get('offset') or '0'
    try:
        return max(0, int(raw))
    except ValueError as exc:
        raise AppError('INVALID_SHOT_MATCH_INPUT', 'validation', 'offset must be a whole number.', 422) from exc


def register_production_shot_match_routes(application: FastAPI, config: Settings,
    logger: logging.Logger, envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}'
    repository = ShotMatchRepository

    # ------------------------------------------------------------------ vocabulary

    @application.get(f'{base}/shot-match/vocabulary')
    async def shot_match_vocabulary(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The canonical Result states, match verdicts, correction states and recommendations."""

        return envelope(request, vocabulary())

    # ------------------------------------------------------------------ Results

    @application.get(f'{base}/results')
    async def list_results(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """What was actually created, with its provenance and verified media capability."""

        state = request.query_params.get('state') or None
        if state is not None and state not in RESULT_STATE_FILTERS:
            raise AppError('INVALID_SHOT_MATCH_INPUT', 'validation',
                'A Result state filter is raw, needs_review, approved, rejected or final.', 422)
        data = await repository(gateway).results(workspace_id, production_id, request.state.access_token,
            shot_id=_optional_uuid(request.query_params.get('shot_id'), 'That Shot identifier is invalid.'),
            state=state, limit=_bounded_int(request, 'limit', 50), offset=_offset(request))
        return envelope(request, decorate_result_list(data))

    @application.post(f'{base}/results')
    async def register_result(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Register what was actually created. It always starts as Needs review."""

        body = _validated(ResultRegisterRequest, await request.json(), 'Check the Result fields.')
        data = await repository(gateway).register_result(workspace_id, production_id,
            request.state.access_token, payload=body.model_dump(exclude_none=True))
        logger.info('result_registered', extra={'context': {'event': 'result_registered',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'result_id': str(data.get('result_id')), 'origin': body.origin}})
        return envelope(request, decorate_result(data))

    @application.get(f'{base}/results/{{result_id}}')
    async def get_result(workspace_id: UUID, production_id: UUID, result_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One Result: its links, verified capabilities, plan, revisions and analyses."""

        data = await repository(gateway).result_detail(workspace_id, production_id,
            request.state.access_token, result_id=_uuid(result_id, 'That Result identifier is invalid.'))
        return envelope(request, decorate_result(data))

    @application.post(f'{base}/results/{{result_id}}/state')
    async def set_result_state(workspace_id: UUID, production_id: UUID, result_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Accept, reject, reopen or finalize a Result. Final always needs a creator approval first."""

        body = _validated(ResultStateRequest, await request.json(), 'Check the Result state fields.')
        data = await repository(gateway).set_result_state(workspace_id, production_id,
            request.state.access_token, result_id=_uuid(result_id, 'That Result identifier is invalid.'),
            state=body.state, expected_revision=body.expected_revision, note=body.note)
        logger.info('result_state_set', extra={'context': {'event': 'result_state_set',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'result_id': result_id, 'state': body.state}})
        return envelope(request, decorate_decision(data))

    # ------------------------------------------------------------------ Shot Match

    @application.get(f'{base}/shot-match')
    async def list_reports(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Every analysis of a Shot, or of a Result, newest first."""

        data = await repository(gateway).reports(workspace_id, production_id, request.state.access_token,
            shot_id=_optional_uuid(request.query_params.get('shot_id'), 'That Shot identifier is invalid.'),
            result_id=_optional_uuid(request.query_params.get('result_id'), 'That Result identifier is invalid.'),
            limit=_bounded_int(request, 'limit', 25), offset=_offset(request))
        return envelope(request, decorate_report_list(data))

    @application.post(f'{base}/shots/{{shot_id}}/shot-match')
    async def analyze_shot(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record what is different between the Plan, the Reference and the Result, and how to fix it."""

        body = _validated(MatchAnalyzeRequest, await request.json(), 'Check the analysis fields.')
        data = await repository(gateway).analyze(workspace_id, production_id, request.state.access_token,
            shot_id=_uuid(shot_id, 'That Shot identifier is invalid.'),
            payload=body.model_dump(exclude_none=True))
        logger.info('shot_match_analyzed', extra={'context': {'event': 'shot_match_analyzed',
            'workspace_id': str(workspace_id), 'production_id': str(production_id), 'shot_id': shot_id,
            'report_id': str(data.get('report_id')), 'severity': data.get('severity'),
            'recommendation': data.get('recommendation'), 'origin': body.origin}})
        return envelope(request, decorate_report(data))

    @application.get(f'{base}/shot-match/{{report_id}}')
    async def get_report(workspace_id: UUID, production_id: UUID, report_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One analysis with its findings, summary and the Shot's whole iteration history."""

        data = await repository(gateway).report_detail(workspace_id, production_id,
            request.state.access_token, report_id=_uuid(report_id, 'That analysis identifier is invalid.'))
        return envelope(request, decorate_report(data))

    @application.post(f'{base}/shot-match/{{report_id}}/decide')
    async def decide_report(workspace_id: UUID, production_id: UUID, report_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Pick up, regenerate, accept or dismiss. Regeneration launches nothing by itself."""

        body = _validated(MatchDecideRequest, await request.json(), 'Check the decision fields.')
        data = await repository(gateway).decide(workspace_id, production_id, request.state.access_token,
            report_id=_uuid(report_id, 'That analysis identifier is invalid.'),
            decision=body.decision, note=body.note)
        logger.info('shot_match_decided', extra={'context': {'event': 'shot_match_decided',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'report_id': report_id, 'decision': body.decision}})
        return envelope(request, decorate_decision(data))

    # ------------------------------------------------------------------ FIX THIS SHOT

    @application.post(f'{base}/shot-match/{{report_id}}/corrections')
    async def propose_correction(workspace_id: UUID, production_id: UUID, report_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Propose a scoped correction: one object, one patch, a recorded cause, a previewed impact."""

        body = _validated(CorrectionProposeRequest, await request.json(), 'Check the correction fields.')
        data = await repository(gateway).propose_correction(workspace_id, production_id,
            request.state.access_token, report_id=_uuid(report_id, 'That analysis identifier is invalid.'),
            payload=body.model_dump(exclude_none=True))
        logger.info('correction_proposed', extra={'context': {'event': 'correction_proposed',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'correction_id': str(data.get('correction_id')), 'target_object_id': body.target_object_id}})
        return envelope(request, decorate_correction(data))

    @application.post(f'{base}/shot-match/corrections/{{correction_id}}/apply')
    async def apply_correction(workspace_id: UUID, production_id: UUID, correction_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Apply the correction: a new revision is created and the earlier plan and Result are kept."""

        body = _validated(CorrectionApplyRequest, await request.json(), 'Check the correction fields.')
        data = await repository(gateway).apply_correction(workspace_id, production_id,
            request.state.access_token, correction_id=_uuid(correction_id, 'That correction identifier is invalid.'),
            expected_revision=body.expected_revision, propagation=body.propagation, note=body.note,
            record_candidate=body.record_candidate)
        logger.info('correction_applied', extra={'context': {'event': 'correction_applied',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'correction_id': correction_id, 'applied_revision': data.get('applied_revision'),
            'propagation': body.propagation}})
        return envelope(request, decorate_correction(data))

    @application.post(f'{base}/shot-match/corrections/{{correction_id}}/reject')
    async def reject_correction(workspace_id: UUID, production_id: UUID, correction_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Reject the correction. Nothing changes and nothing is overwritten."""

        body = _validated(CorrectionRejectRequest, await request.json(), 'Check the correction fields.')
        data = await repository(gateway).reject_correction(workspace_id, production_id,
            request.state.access_token, correction_id=_uuid(correction_id, 'That correction identifier is invalid.'),
            note=body.note)
        logger.info('correction_rejected', extra={'context': {'event': 'correction_rejected',
            'workspace_id': str(workspace_id), 'production_id': str(production_id),
            'correction_id': correction_id}})
        return envelope(request, decorate_correction(data))
