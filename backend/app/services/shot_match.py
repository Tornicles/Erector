"""Prompt 9F Result and Shot Match service.

Deterministic software owns this layer. What was actually created, which media modalities were
verified, whether a comparison may be claimed, how much production impact a difference has, whether
a transition is legal, and whether a correction becomes reusable memory are all decided in the
database (migration 024). This module attaches the human vocabulary and recomputes none of it, and
it launches no generation and consults no model.

The boundaries this module exists to protect:

* a Result is what was actually created, with its provenance - it is not the plan, and a new Result
  is never created approved or Final;
* Shot Match is a diagnosis with evidence, not a similarity score, and it never approves a Result;
* a mismatch recommends a pickup for Real and regeneration for AI, and recommending regeneration
  launches nothing;
* FIX THIS SHOT is scoped to one object, preserves the previous plan and Result, and becomes
  reusable memory only when a later analysis confirmed it helped.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.domain.shot_match import (
    CORRECTION_RECOMMENDATIONS,
    CORRECTION_STATES,
    MATCH_ORIGINS,
    MATCH_VERDICTS,
    RESULT_ORIGINS,
    RESULT_STATES,
    SEVERITIES,
)

LAYER = 'Shot match'

RESULT_STATE_LABELS: dict[str, str] = {
    'raw': 'Raw', 'needs_review': 'Needs review', 'approved': 'Approved', 'rejected': 'Rejected',
    'final': 'Final',
}

RESULT_ORIGIN_LABELS: dict[str, str] = {
    'real_take': 'Real Take', 'ai_generation': 'AI Attempt', 'hybrid': 'Hybrid process',
    'manual_import': 'Manual import',
}

MATCH_VERDICT_LABELS: dict[str, str] = {
    'matches_intent': 'Matches intent', 'acceptable_variation': 'Acceptable variation',
    'needs_attention': 'Needs attention', 'mismatch': 'Mismatch', 'unknown': 'Not enough evidence',
}

CORRECTION_STATE_LABELS: dict[str, str] = {
    'proposed': 'Proposed', 'applied': 'Applied', 'rejected': 'Rejected',
}

RECOMMENDATION_LABELS: dict[str, str] = {
    'none': 'No fix required', 'pickup_required': 'Pickup required',
    'regeneration_recommended': 'Regeneration recommended', 'both': 'Pickup and regeneration',
}

MATCH_ORIGIN_LABELS: dict[str, str] = {
    'deterministic': 'Deterministic comparison', 'creator': 'Creator statement',
    'ai_proposal': 'AI proposal',
}

SEVERITY_LABELS: dict[str, str] = {
    'info': 'Note', 'warning': 'Warning', 'critical': 'Critical',
}

EPISTEMIC_LABELS: dict[str, str] = {
    'observed': 'Observed', 'estimated': 'Estimated', 'recommended': 'Recommended',
    'unknown': 'Unknown',
}

CONFIDENCE_LABELS: dict[str, str] = {'high': 'High', 'medium': 'Medium', 'low': 'Low'}

MODALITY_LABELS: dict[str, str] = {
    'metadata': 'metadata', 'thumbnail': 'a thumbnail', 'image': 'an image',
    'video_frames': 'extracted frames', 'audio': 'an audio track', 'text': 'text',
}

RULE = ('A Result is what was actually created, not the plan. Shot Match diagnoses what is different '
    'and how to fix it: it is not a similarity score, it never approves a Result, and it launches no '
    'generation. Approval and Final stay creator decisions.')
LIMITATION = ('Comparison only uses the modalities verified from real media rows. No visual claim is '
    'made without extracted frames or an image, no audio claim without an audio track, and no lens, '
    'person or identity is ever measured or identified from imagery.')
FINAL_LINE = ('Final is explicitly accepted evidence or deliverable state. Generation completion '
    'never sets it.')


def vocabulary() -> dict[str, Any]:
    """The Result/Shot Match vocabulary: canonical states, verdicts and recommendations."""

    return {
        'result_states': [{'state': key, 'label': RESULT_STATE_LABELS[key]} for key in RESULT_STATES],
        'result_origins': [{'origin': key, 'label': RESULT_ORIGIN_LABELS[key]} for key in RESULT_ORIGINS],
        'match_verdicts': [{'verdict': key, 'label': MATCH_VERDICT_LABELS[key]} for key in MATCH_VERDICTS],
        'correction_states': [{'state': key, 'label': CORRECTION_STATE_LABELS[key]} for key in CORRECTION_STATES],
        'correction_recommendations': [{'recommendation': key, 'label': RECOMMENDATION_LABELS[key]}
            for key in CORRECTION_RECOMMENDATIONS],
        'match_origins': [{'origin': key, 'label': MATCH_ORIGIN_LABELS[key]} for key in MATCH_ORIGINS],
        'severities': [{'severity': key, 'label': SEVERITY_LABELS[key]} for key in SEVERITIES],
        'rule': RULE,
        'limitation': LIMITATION,
    }


def _capability_line(capabilities: dict[str, Any] | None) -> str:
    """Say plainly what could and could not be compared, from the verified modalities alone."""

    data = capabilities or {}
    available = [MODALITY_LABELS[key] for key in
        ('metadata', 'thumbnail', 'image', 'video_frames', 'audio', 'text') if data.get(key)]
    if not available:
        return 'No modality was verified for this media, so nothing was compared.'
    return 'Compared from ' + ', '.join(available) + '.'


def decorate_result(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary and the capability truth to one Result."""

    data['state_label'] = RESULT_STATE_LABELS.get(str(data.get('state')), 'Needs review')
    origin = str(data.get('origin') or (data.get('provenance') or {}).get('origin') or '')
    data['origin_label'] = RESULT_ORIGIN_LABELS.get(origin, 'Unrecorded source')
    if data.get('match_worst_severity') is not None:
        data['match_severity_label'] = SEVERITY_LABELS.get(str(data['match_worst_severity']), 'Note')
    if data.get('match_recommendation') is not None:
        data['match_recommendation_label'] = RECOMMENDATION_LABELS.get(
            str(data['match_recommendation']), 'No fix required')
    if isinstance(data.get('capabilities'), dict):
        data['capability_line'] = _capability_line(data['capabilities'])
    data.setdefault('final_line', FINAL_LINE)
    return data


def decorate_result_list(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a page of Results."""

    for item in data.get('items') or []:
        decorate_result(item)
    data.setdefault('rule', RULE)
    return data


def _decorate_finding(finding: dict[str, Any]) -> dict[str, Any]:
    finding['verdict_label'] = MATCH_VERDICT_LABELS.get(str(finding.get('verdict')), 'Not enough evidence')
    finding['severity_label'] = SEVERITY_LABELS.get(str(finding.get('severity')), 'Note')
    finding['epistemic_label'] = EPISTEMIC_LABELS.get(str(finding.get('epistemic')), 'Unknown')
    finding['confidence_label'] = CONFIDENCE_LABELS.get(str(finding.get('confidence')), 'Unknown')
    return finding


def decorate_dimensions(dimensions: list[Any]) -> list[Any]:
    """Label each dimension's verdict. Order is the database's: worst first."""

    for dimension in dimensions or []:
        if isinstance(dimension, dict):
            dimension['verdict_label'] = MATCH_VERDICT_LABELS.get(
                str(dimension.get('verdict')), 'Not enough evidence')
    return dimensions


def decorate_report(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to one Shot Match analysis and its iteration history."""

    data['severity_label'] = SEVERITY_LABELS.get(str(data.get('severity')), 'Note')
    data['recommendation_label'] = RECOMMENDATION_LABELS.get(str(data.get('recommendation')), 'No fix required')
    data['origin_label'] = MATCH_ORIGIN_LABELS.get(str(data.get('origin')), 'Deterministic comparison')
    for finding in data.get('findings') or []:
        _decorate_finding(finding)
    decorate_dimensions(data.get('dimensions') or [])
    for correction in data.get('corrections') or []:
        decorate_correction(correction)
    summary = data.get('summary') or {}
    ranked = summary.get('what_matters_most') or []
    if ranked:
        data['headline'] = str(ranked[0].get('difference') or ranked[0].get('category') or '')
    if isinstance(data.get('capabilities'), dict):
        data['capability_line'] = _capability_line(data['capabilities'])
    data.setdefault('rule', RULE)
    data.setdefault('limitation', LIMITATION)
    return data


def decorate_report_list(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a page of analyses."""

    for item in data.get('items') or []:
        item['severity_label'] = SEVERITY_LABELS.get(str(item.get('severity')), 'Note')
        item['recommendation_label'] = RECOMMENDATION_LABELS.get(str(item.get('recommendation')), 'No fix required')
        item['origin_label'] = MATCH_ORIGIN_LABELS.get(str(item.get('origin')), 'Deterministic comparison')
        if isinstance(item.get('capabilities'), dict):
            item['capability_line'] = _capability_line(item['capabilities'])
    data.setdefault('rule', RULE)
    return data


def decorate_correction(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a FIX THIS SHOT correction."""

    data['state_label'] = CORRECTION_STATE_LABELS.get(str(data.get('state')), 'Proposed')
    data['recommendation_label'] = RECOMMENDATION_LABELS.get(str(data.get('recommendation')), 'No fix required')
    preview = data.get('preview') or {}
    if isinstance(preview, dict) and preview:
        data['impact_line'] = ('The impact was computed and is applied only when you accept the '
            'correction. Nothing downstream was changed by proposing it.')
    if data.get('state') == 'applied':
        data['preserved_line'] = ('A new revision was created. The previous plan, the Result and every '
            'earlier analysis are preserved.')
    data.setdefault('rule', RULE)
    return data


def decorate_decision(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a creator's decision on an analysis."""

    data['decision_label'] = {
        'pickup': 'Pickup requested', 'regeneration': 'Regeneration recommended',
        'accepted': 'Diagnosis accepted', 'dismiss': 'Dismissed',
    }.get(str(data.get('decision')), 'Recorded')
    if data.get('recommendation') is not None:
        data['recommendation_label'] = RECOMMENDATION_LABELS.get(str(data['recommendation']), 'No fix required')
    data.setdefault('rule', RULE)
    return data


class ShotMatchRepository:
    """Every call goes through the shared RPC helper with this layer's name attached."""

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def register_result(self, workspace_id: UUID, production_id: UUID, token: str, *,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('result_register', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'payload': payload})

    async def results(self, workspace_id: UUID, production_id: UUID, token: str, *, shot_id: UUID | None,
        state: str | None, limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('result_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id) if shot_id else None, 'target_state': state,
            'max_rows': limit, 'skip_rows': offset})

    async def result_detail(self, workspace_id: UUID, production_id: UUID, token: str, *,
        result_id: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('result_detail', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_result': str(result_id)})

    async def set_result_state(self, workspace_id: UUID, production_id: UUID, token: str, *,
        result_id: UUID, state: str, expected_revision: int | None, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('result_state_set', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_result': str(result_id), 'desired_state': state,
            'expected_revision': expected_revision, 'note_text': note})

    async def analyze(self, workspace_id: UUID, production_id: UUID, token: str, *, shot_id: UUID,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('match_analyze', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'payload': payload})

    async def reports(self, workspace_id: UUID, production_id: UUID, token: str, *, shot_id: UUID | None,
        result_id: UUID | None, limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('match_reports', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id) if shot_id else None,
            'target_result': str(result_id) if result_id else None,
            'max_rows': limit, 'skip_rows': offset})

    async def report_detail(self, workspace_id: UUID, production_id: UUID, token: str, *,
        report_id: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('match_report_get', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_report': str(report_id)})

    async def decide(self, workspace_id: UUID, production_id: UUID, token: str, *, report_id: UUID,
        decision: str, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('match_report_decide', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_report': str(report_id), 'decision_value': decision, 'note_text': note})

    async def propose_correction(self, workspace_id: UUID, production_id: UUID, token: str, *,
        report_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('match_correction_propose', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_report': str(report_id), 'payload': payload})

    async def apply_correction(self, workspace_id: UUID, production_id: UUID, token: str, *,
        correction_id: UUID, expected_revision: int | None, propagation: str, note: str,
        record_candidate: bool) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('match_correction_apply', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_correction': str(correction_id), 'expected_revision': expected_revision,
            'propagation': propagation, 'note_text': note, 'record_candidate': record_candidate})

    async def reject_correction(self, workspace_id: UUID, production_id: UUID, token: str, *,
        correction_id: UUID, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('match_correction_reject', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_correction': str(correction_id), 'note_text': note})
