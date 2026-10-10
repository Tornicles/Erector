"""Prompt 9E approval, lock and Production readiness service.

Deterministic software owns this layer. Whether a revision is stale, whether a creator is allowed
to approve, what an object's current approval and lock are, and which blockers a Production has are
all decided in the database (migration 023). This module attaches the human vocabulary and
recomputes none of it and consults no model.

The boundary this module exists to protect:

* approval is a creator decision about a specific revision, so it is shown with the revision it
  named, the person who made it and the time - and newer content is shown as changed, not approved;
* lock and approval stay independent, and an unlock is shown with its reason;
* readiness is a category derived from real criteria with actionable, navigable blockers - never an
  arbitrary score, and never a claim about external provider availability.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.domain.readiness import ACCESS_ACTIONS, READINESS_DIMENSIONS, READINESS_STATES

LAYER = 'Production readiness'

ACCESS_ACTION_LABELS: dict[str, str] = {
    'approve': 'Approved', 'request_review': 'Waiting for review', 'reopen': 'Reopened for editing',
    'lock': 'Locked', 'unlock': 'Unlocked',
}

READINESS_STATE_LABELS: dict[str, str] = {
    'ready': 'Ready', 'ready_with_warnings': 'Ready with warnings', 'needs_review': 'Needs review',
    'blocked': 'Blocked', 'unknown': 'Not enough planned state',
}

DIMENSION_LABELS: dict[str, str] = {
    'decisions': 'Decisions', 'story': 'Story', 'script': 'Script', 'scene_plan': 'Scene plan',
    'shots': 'Shots', 'continuity': 'Continuity', 'resources': 'Resources',
    'real_execution': 'Real execution', 'ai_execution': 'AI execution', 'approvals': 'Approvals',
    'dependencies': 'Dependencies', 'results': 'Results', 'delivery': 'Delivery',
}

SEVERITY_LABELS: dict[str, str] = {
    'blocking': 'Blocks progress', 'review': 'Needs review', 'warning': 'Warning',
}

APPROVAL_LABELS: dict[str, str] = {
    'draft': 'Draft', 'needs_review': 'Needs review', 'approved': 'Approved',
    'changed_after_approval': 'Changed after approval',
}

RULE = ('Approval means a creator accepted this specific revision. It is not a generation result, '
    'a validation pass or a model opinion. Lock and approval are independent.')
LIMITATION = ('Readiness is a category derived from real production state, not a score or a '
    'percentage. AI provider availability is an external dependency and is not guessed here.')


def vocabulary() -> dict[str, Any]:
    """The approval/lock/readiness vocabulary: the actions, states and dimensions that exist."""

    return {
        'access_actions': [{'action': key, 'label': ACCESS_ACTION_LABELS[key]} for key in ACCESS_ACTIONS],
        'approval_states': [{'state': key, 'label': value} for key, value in APPROVAL_LABELS.items()],
        'readiness_states': [{'state': key, 'label': READINESS_STATE_LABELS[key]} for key in READINESS_STATES],
        'readiness_dimensions': [{'dimension': key, 'label': DIMENSION_LABELS[key]}
            for key in READINESS_DIMENSIONS],
        'severities': [{'severity': key, 'label': value} for key, value in SEVERITY_LABELS.items()],
        'rule': RULE,
        'limitation': LIMITATION,
    }


def decorate_decision(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to an approval or lock decision."""

    action = str(data.get('action') or data.get('task') or '')
    data['action_label'] = ACCESS_ACTION_LABELS.get(action, 'Recorded')
    if data.get('approval') is not None:
        data['approval_label'] = APPROVAL_LABELS.get(str(data['approval']), 'Unknown')
    data.setdefault('rule', RULE)
    return data


def decorate_state(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to one object's approval and lock state."""

    data['approval_label'] = APPROVAL_LABELS.get(str(data.get('approval')), 'Draft')
    if data.get('changed_since_approval'):
        data['changed_line'] = ('This content changed after it was approved. The earlier approval '
            'still names the revision it accepted, not this one.')
    elif data.get('approval') == 'approved':
        data['changed_line'] = 'This is the revision the creator approved.'
    else:
        data['changed_line'] = 'This revision has not been approved.'
    data['lock_line'] = ('Locked. The lock protects this decision from incidental change; approval '
        'is separate.' if data.get('locked') else 'Unlocked.')
    for entry in data.get('decisions') or []:
        entry['action_label'] = ACCESS_ACTION_LABELS.get(str(entry.get('action')), 'Recorded')
    data.setdefault('rule', RULE)
    return data


def decorate_history(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a page of access decisions."""

    for entry in data.get('items') or []:
        entry['action_label'] = ACCESS_ACTION_LABELS.get(str(entry.get('action')), 'Recorded')
    data.setdefault('note', 'This is a record of creator decisions. It is append-only.')
    return data


def decorate_readiness(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a Production readiness report."""

    data['state_label'] = READINESS_STATE_LABELS.get(str(data.get('state')), 'Unknown')
    for dimension in data.get('dimensions') or []:
        dimension['label'] = DIMENSION_LABELS.get(str(dimension.get('dimension')), 'Dimension')
        dimension['state_label'] = READINESS_STATE_LABELS.get(str(dimension.get('state')), 'Unknown')
    for blocker in data.get('blockers') or []:
        blocker['severity_label'] = SEVERITY_LABELS.get(str(blocker.get('severity')), 'Note')
        blocker['dimension_label'] = DIMENSION_LABELS.get(str(blocker.get('dimension')), 'Production')
    data.setdefault('limitation', LIMITATION)
    return data


class ReadinessRepository:
    """Every call goes through the shared RPC helper with this layer's name attached."""

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def readiness(self, workspace_id: UUID, production_id: UUID, token: str, *,
        expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('production_readiness', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': expected_revision})

    async def state(self, workspace_id: UUID, production_id: UUID, token: str, *,
        object_id: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('access_state', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id)})

    async def history(self, workspace_id: UUID, production_id: UUID, token: str, *, object_id: UUID,
        limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('access_history', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id), 'max_rows': limit, 'skip_rows': offset})

    async def decide(self, workspace_id: UUID, production_id: UUID, token: str, *, object_id: UUID,
        decision: str, expected_revision: int | None, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('approval_decide', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id), 'decision': decision,
            'expected_revision': expected_revision, 'note_text': note})

    async def set_lock(self, workspace_id: UUID, production_id: UUID, token: str, *, object_id: UUID,
        locked: bool, expected_revision: int | None, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('lock_set', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id), 'locked': locked,
            'expected_revision': expected_revision, 'note_text': note})
