"""Prompt 9B continuity service.

Deterministic software owns this layer. The order of the Production, the comparison of declared
statements, the finding lifecycle, the lock interaction and the staleness of a recorded check are
all decided in the database (migration 020) and are only surfaced here with human labels; nothing
is recalculated and no model is consulted.

The honest boundary this module exists to protect: a continuity check compares *declarations*. It
does not analyse media, so a clean check does not mean the footage is consistent. That limitation
travels with every response instead of being left for the reader to assume.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

LAYER = 'Production continuity'

DOMAIN_LABELS: dict[str, str] = {
    'character': 'Character', 'wardrobe': 'Wardrobe', 'prop': 'Prop', 'product': 'Product',
    'vehicle': 'Vehicle', 'injury': 'Injury', 'hair_makeup': 'Hair and makeup', 'weather': 'Weather',
    'time_of_day': 'Time of day', 'environment': 'Environment or World', 'lighting': 'Lighting',
    'story_knowledge': 'Story knowledge', 'dialogue_fact': 'Dialogue fact',
    'screen_direction': 'Screen direction', 'eyeline': 'Eyeline', 'camera_geography': 'Camera geography',
    'position': 'Physical position', 'product_condition': 'Product condition', 'other': 'Other',
}

ANCHOR_LABELS: dict[str, str] = {
    'production': 'Whole Production', 'scene_opening': 'Scene opening', 'scene_ending': 'Scene ending',
    'shot': 'Shot',
}

TRANSITION_LABELS: dict[str, str] = {
    'baseline': 'First statement', 'continuous': 'Continues unchanged', 'changed': 'Declared change',
}

ORIGIN_LABELS: dict[str, str] = {
    'declared': 'Declared by you', 'derived': 'Derived from your statements', 'inferred': 'Inferred (proposal)',
}

KIND_LABELS: dict[str, str] = {
    'unexplained_change': 'Unexplained change', 'boundary_break': 'Break across a Scene boundary',
    'missing_reason': 'Change without a reason', 'lock_conflict': 'Touches a locked trait',
    'unverified_after': 'Unknown after this point',
}

SEVERITY_LABELS: dict[str, str] = {'info': 'Note', 'warning': 'Caution', 'critical': 'Conflict'}

FINDING_STATE_LABELS: dict[str, str] = {
    'open': 'Open', 'acknowledged': 'Acknowledged', 'resolved': 'Resolved', 'waived': 'Waived',
}

VERDICT_LABELS: dict[str, str] = {
    'consistent': 'Consistent', 'needs_review': 'Needs review', 'conflict': 'Conflict',
}

EPISTEMIC_LABELS: dict[str, str] = {
    'observed': 'Observed', 'estimated': 'Estimated', 'recommended': 'Recommended', 'unknown': 'Unknown',
}

LIMITATION = ('Continuity here is what the Production records. It does not analyse media, '
    'and an unrecorded trait is unknown rather than consistent.')

RULES: list[dict[str, str]] = [
    {'kind': 'boundary_break', 'severity': 'critical',
     'description': 'A trait changes across a Scene boundary without a declared change.'},
    {'kind': 'unexplained_change', 'severity': 'warning',
     'description': 'A trait changes inside one Scene while the statement says it continues unchanged.'},
    {'kind': 'lock_conflict', 'severity': 'critical',
     'description': 'A declared change touches a subject the creator protected with a continuity lock.'},
    {'kind': 'missing_reason', 'severity': 'warning',
     'description': 'A change was declared with no reason, so later Shots cannot be checked against it.'},
    {'kind': 'unverified_after', 'severity': 'info',
     'description': 'The last statement for a trait is a declared change and later work has none: continuity there is unknown.'},
]


def label_for(mapping: dict[str, str], value: Any, fallback: str = 'Unknown') -> str:
    """Return the display label for a stored code without inventing one that does not exist."""

    if value is None:
        return fallback
    return mapping.get(str(value), fallback)


def vocabulary() -> dict[str, Any]:
    """The continuity vocabulary, the deterministic rules, and the limitation that bounds them."""

    return {
        'domains': [{'domain': key, 'label': value} for key, value in DOMAIN_LABELS.items()],
        'anchors': [{'anchor': key, 'label': value} for key, value in ANCHOR_LABELS.items()],
        'transitions': [{'transition': key, 'label': value} for key, value in TRANSITION_LABELS.items()],
        'finding_kinds': [{'kind': key, 'label': value} for key, value in KIND_LABELS.items()],
        'finding_states': [{'state': key, 'label': value} for key, value in FINDING_STATE_LABELS.items()],
        'severities': [{'severity': key, 'label': value} for key, value in SEVERITY_LABELS.items()],
        'rules': RULES,
        'rule': ('Continuity is temporal: a statement records what one trait of one subject is at one point in '
            'Production order, and a change is declared rather than inferred.'),
        'limitation': LIMITATION,
    }


def _decorate_finding(finding: dict[str, Any]) -> dict[str, Any]:
    finding['severity_label'] = label_for(SEVERITY_LABELS, finding.get('severity'))
    finding['kind_label'] = label_for(KIND_LABELS, finding.get('kind'))
    finding['state_label'] = label_for(FINDING_STATE_LABELS, finding.get('state'))
    finding['origin_label'] = label_for(ORIGIN_LABELS, finding.get('origin'))
    finding['domain_label'] = label_for(DOMAIN_LABELS, finding.get('domain'))
    finding['epistemic_label'] = label_for(EPISTEMIC_LABELS, finding.get('epistemic'))
    subject = finding.get('subject_label')
    finding['subject_line'] = f'{subject} - {finding.get("trait")}' if subject else (finding.get('trait') or '')
    return finding


def _verdict_line(check: dict[str, Any]) -> str:
    counts = check.get('counts') or {}
    critical = int(counts.get('critical') or 0)
    warning = int(counts.get('warning') or 0)
    info = int(counts.get('info') or 0)
    verdict = str(check.get('verdict') or 'consistent')
    if verdict == 'conflict':
        return f'{critical} continuity conflict(s) need a creator decision.'
    if verdict == 'needs_review':
        return f'{warning} statement(s) should be confirmed.'
    if info:
        return f'{info} trait(s) are unknown after a declared change.'
    return 'The recorded continuity statements agree at every point they describe.'


def decorate_states(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to stored statements. No value is recalculated here."""

    for item in data.get('items') or []:
        item['domain_label'] = label_for(DOMAIN_LABELS, item.get('domain'))
        item['anchor_label'] = label_for(ANCHOR_LABELS, item.get('anchor'))
        item['transition_label'] = label_for(TRANSITION_LABELS, item.get('transition'))
        item['origin_label'] = label_for(ORIGIN_LABELS, item.get('origin'))
        item['epistemic_label'] = label_for(EPISTEMIC_LABELS, item.get('epistemic'))
    data.setdefault('limitation', LIMITATION)
    return data


def decorate_chain(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to one subject's timeline, in Production order."""

    for item in data.get('statements') or []:
        item['domain_label'] = label_for(DOMAIN_LABELS, item.get('domain'))
        item['anchor_label'] = label_for(ANCHOR_LABELS, item.get('anchor'))
        item['transition_label'] = label_for(TRANSITION_LABELS, item.get('transition'))
        item['epistemic_label'] = label_for(EPISTEMIC_LABELS, item.get('epistemic'))
    data.setdefault('limitation', LIMITATION)
    return data


def decorate_check(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a recorded check and its findings."""

    data['verdict_label'] = label_for(VERDICT_LABELS, data.get('verdict'))
    for finding in data.get('findings') or []:
        _decorate_finding(finding)
    data.setdefault('limitation', LIMITATION)
    data['rule'] = ('A check compares the continuity statements recorded for this Production. It changes no '
        'statement, and it does not analyse media.')
    return data


def decorate_findings(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a findings page and describe the recorded check honestly."""

    for finding in data.get('items') or []:
        _decorate_finding(finding)
    check = data.get('check')
    if isinstance(check, dict):
        check['verdict_label'] = label_for(VERDICT_LABELS, check.get('verdict'))
        check['summary'] = _verdict_line(check)
        check['freshness'] = ('This check matches the recorded statements.' if check.get('is_current')
            else 'The statements changed after this check ran, so it is out of date.')
    data['open_label'] = (f"{data.get('open_count', 0)} finding(s) are still open."
        if data.get('open_count') else 'Nothing is open.')
    data.setdefault('limitation', LIMITATION)
    return data


def decorate_summary(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to the readiness summary, including what is unknown."""

    check = data.get('check')
    if isinstance(check, dict):
        check['verdict_label'] = label_for(VERDICT_LABELS, check.get('verdict'))
        check['summary'] = _verdict_line(check)
        check['freshness'] = ('This check matches the recorded statements.' if check.get('is_current')
            else 'The statements changed after this check ran, so it is out of date.')
    for item in data.get('domains') or []:
        item['label'] = label_for(DOMAIN_LABELS, item.get('domain'))
    data['stale_label'] = ('The recorded continuity analysis is out of date.' if data.get('analysis_stale')
        else 'The recorded continuity analysis matches the statements.')
    data.setdefault('limitations', LIMITATION)
    return data


def decorate_finding(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a single proposal response."""

    _decorate_finding(data)
    return data


class ContinuityRepository:
    """Every call goes through the shared RPC helper with this layer's name attached."""

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def set_state(self, workspace_id: UUID, production_id: UUID, token: str,
        state_record: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_state_set', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'state_record': state_record})

    async def retire_state(self, workspace_id: UUID, production_id: UUID, token: str, *, state_id: UUID,
        reason: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_state_retire', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_state': str(state_id), 'reason_text': reason})

    async def states(self, workspace_id: UUID, production_id: UUID, token: str, *, subject: UUID | None,
        domain: str | None, include_retired: bool, limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_state_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_subject': str(subject) if subject else None, 'target_domain': domain,
            'include_retired': include_retired, 'target_limit': limit, 'target_offset': offset})

    async def chain(self, workspace_id: UUID, production_id: UUID, token: str, *, subject: UUID,
        domain: str | None, trait: str | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_chain', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_subject': str(subject), 'target_domain': domain, 'target_trait': trait})

    async def check(self, workspace_id: UUID, production_id: UUID, token: str, *, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_check', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'note_text': note})

    async def findings(self, workspace_id: UUID, production_id: UUID, token: str, *, state: str | None,
        severity: str | None, check_id: UUID | None, limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_finding_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_state': state, 'target_severity': severity,
            'target_check': str(check_id) if check_id else None, 'target_limit': limit, 'target_offset': offset})

    async def update_finding(self, workspace_id: UUID, production_id: UUID, token: str, *, finding_id: UUID,
        state: str, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_finding_update', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_finding': str(finding_id), 'desired_state': state, 'note_text': note})

    async def record_proposal(self, workspace_id: UUID, production_id: UUID, token: str, *,
        finding_record: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_finding_record', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'finding_record': finding_record})

    async def summary(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('continuity_summary', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id)})
