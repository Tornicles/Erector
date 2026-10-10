"""Prompt 9D version, branch and merge service.

Deterministic software owns this layer. Whether a version is current, which fields meaningfully
changed, whether a restore is allowed, whether a branch change is clean or conflicted against the
mainline, and which propagation an accepted merge used are all decided in the database (migration
022). This module attaches the human vocabulary and recomputes none of it and consults no model.

The boundary this module exists to protect:

* a version is history, so it is shown as history - immutable, pinned and never rewritten;
* a branch is an alternative, so it is labelled as an alternative and its edits are reported as
  proposals rather than as changes to the Production;
* a merge is a reviewed decision, so a conflicted change is shown as conflicted and never resolved
  on the creator's behalf.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.domain.versioning import BRANCH_SCOPES, PROPAGATION_MODES, WRITABLE_FIELDS

LAYER = 'Production versioning'

BRANCH_STATE_LABELS: dict[str, str] = {
    'open': 'Open alternative', 'merged': 'Merged', 'abandoned': 'Abandoned',
}

CHANGE_STATE_LABELS: dict[str, str] = {
    'pending': 'Ready to merge', 'applied': 'Merged', 'conflicted': 'Conflicted, needs your edit',
    'rejected': 'Discarded',
}

MERGE_STATE_LABELS: dict[str, str] = {
    'proposed': 'Waiting for your decision', 'merged': 'Merged', 'rejected': 'Rejected',
}

SCOPE_LABELS: dict[str, str] = {
    'story': 'Story', 'script': 'Script', 'act': 'Act', 'sequence': 'Sequence', 'scene': 'Scene',
    'shot': 'Shot', 'execution_plan': 'Execution plan', 'asset': 'Asset', 'production': 'Production',
}

SOURCE_ACTION_LABELS: dict[str, str] = {
    'insert': 'Created', 'update': 'Edited', 'delete': 'Removed', 'restore': 'Restored from an older version',
    'merge': 'Merged from a branch',
}

KIND_LABELS: dict[str, str] = {
    'creative_document': 'Story or Script', 'scene': 'Scene', 'shot': 'Shot',
    'execution_plan': 'Execution plan', 'asset': 'Asset',
}

PROPAGATION_LABELS: dict[str, str] = {
    'update_all': 'Update every affected dependent',
    'review_changes': 'Only the dependents I select',
    'change_only_this': 'Change only this and record the rest as unresolved',
}

FIELD_LABELS: dict[str, str] = {
    'title': 'Title', 'content': 'Content', 'description': 'Description', 'purpose': 'Purpose',
    'action': 'Action', 'subject': 'Subject', 'planned_duration_ms': 'Planned duration',
    'shot_size': 'Shot size', 'movement': 'Movement', 'framing': 'Framing', 'composition': 'Composition',
    'camera_position': 'Camera position', 'camera_height': 'Camera height', 'camera_angle': 'Camera angle',
    'lighting_intent': 'Lighting intent', 'plan_metadata': 'Plan metadata', 'name': 'Name',
    'search_metadata': 'Search metadata', 'consistency_metadata': 'Consistency metadata',
}

RULE = ('A branch is an object-level alternative, not a duplicate Production. Mainline history is '
    'never overwritten: a restore and a merge both create a new current revision.')
LIMITATION = ('Compare shows the meaningful creative fields that differ. It is not a raw JSON diff '
    'and it does not judge which version is better.')


def field_label(field_name: Any) -> str:
    """The product name of a changed field, without inventing a name that does not exist."""

    if field_name is None:
        return 'Field'
    return FIELD_LABELS.get(str(field_name), str(field_name).replace('_', ' ').capitalize())


def vocabulary() -> dict[str, Any]:
    """The versioning vocabulary: branch scopes, states and the modes a merge can propagate."""

    return {
        'scopes': [{'scope': key, 'label': SCOPE_LABELS.get(key, key)} for key in BRANCH_SCOPES],
        'branch_states': [{'state': key, 'label': value} for key, value in BRANCH_STATE_LABELS.items()],
        'change_states': [{'state': key, 'label': value} for key, value in CHANGE_STATE_LABELS.items()],
        'merge_states': [{'state': key, 'label': value} for key, value in MERGE_STATE_LABELS.items()],
        'source_actions': [{'action': key, 'label': value} for key, value in SOURCE_ACTION_LABELS.items()],
        'propagation_modes': [{'mode': key, 'label': value} for key, value in PROPAGATION_LABELS.items()
            if key in PROPAGATION_MODES],
        'branchable_kinds': [{'kind': key, 'label': KIND_LABELS.get(key, key),
            'fields': [{'field': field, 'label': field_label(field)} for field in fields]}
            for key, fields in WRITABLE_FIELDS.items()],
        'rule': RULE,
        'limitation': LIMITATION,
    }


def _decorate_version(entry: dict[str, Any]) -> dict[str, Any]:
    entry['source_action_label'] = SOURCE_ACTION_LABELS.get(str(entry.get('source_action')), 'Recorded')
    if entry.get('is_current'):
        entry['current_line'] = 'This is the current revision.'
    else:
        entry['current_line'] = 'History: this is not the current revision.'
    return entry


def decorate_versions(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a page of version history."""

    for entry in data.get('items') or []:
        _decorate_version(entry)
    data.setdefault('note', RULE)
    return data


def decorate_version(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to one version, including that it can never be edited."""

    _decorate_version(data)
    data.setdefault('note', 'Historical versions are immutable. Restoring one creates a new revision.')
    return data


def decorate_comparison(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a version comparison and describe what is shown."""

    for change in data.get('changes') or []:
        change['label'] = field_label(change.get('field'))
    data.setdefault('limitation', LIMITATION)
    return data


def decorate_restore(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a restore, naming the revision it produced."""

    data['changed_field_labels'] = [field_label(field) for field in data.get('changed_fields') or []]
    return data


def _decorate_branch(branch: dict[str, Any]) -> dict[str, Any]:
    branch['state_label'] = BRANCH_STATE_LABELS.get(str(branch.get('state')), 'Unknown')
    branch['scope_label'] = SCOPE_LABELS.get(str(branch.get('scope')), 'Alternative')
    pending = branch.get('changes')
    if pending is not None:
        branch['changes_line'] = (f'{pending} proposed change(s) are waiting to be merged.'
            if pending else 'No change is proposed on this branch yet.')
    return branch


def decorate_branches(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a page of creative branches."""

    for branch in data.get('items') or []:
        _decorate_branch(branch)
    data.setdefault('rule', RULE)
    return data


def decorate_branch(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to one branch and its proposed changes."""

    _decorate_branch(data)
    for change in data.get('changes') or []:
        change['state_label'] = CHANGE_STATE_LABELS.get(str(change.get('state')), 'Unknown')
        change['changed_field_labels'] = [field_label(field) for field in change.get('changed_fields') or []]
        if change.get('state') == 'conflicted':
            change['conflict_line'] = ('The mainline moved after this change was written. Edit it on '
                'the branch and preview the merge again.')
    data.setdefault('note', 'Branch edits never change the mainline. Only an accepted merge does.')
    return data


def decorate_change(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a recorded or discarded branch change."""

    data['state_label'] = CHANGE_STATE_LABELS.get(str(data.get('state')), 'Unknown')
    data['changed_field_labels'] = [field_label(field) for field in data.get('changed_fields') or []]
    return data


def decorate_preview(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a merge preview, including why each conflict exists."""

    counts = data.get('counts') or {}
    clean = int(counts.get('clean') or 0)
    conflicted = int(counts.get('conflicted') or 0)
    for item in data.get('items') or []:
        item['state_label'] = ('Ready to merge' if item.get('status') == 'clean' else 'Conflicted')
        for conflict in item.get('conflicts') or []:
            conflict['label'] = field_label(conflict.get('field'))
    for conflict in data.get('conflicts') or []:
        for field in conflict.get('fields') or []:
            field['label'] = field_label(field.get('field'))
    data['counts_line'] = (f'{clean} change(s) can merge cleanly and {conflicted} conflict(s) need '
        'your decision.' if conflicted else f'{clean} change(s) can merge cleanly.')
    data['conflict_line'] = ('A conflict is shown, never resolved automatically: the mainline and '
        'this branch both changed the same field.' if conflicted
        else 'No conflict: the mainline has not moved since these changes were written.')
    data.setdefault('note', 'Merge is a proposal. Nothing is copied into the mainline until you decide.')
    return data


def decorate_decision(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a merge decision and what its propagation did."""

    applied = data.get('applied') or []
    data['state_label'] = MERGE_STATE_LABELS.get(str(data.get('state')), 'Unknown')
    for item in applied:
        item['changed_field_labels'] = [field_label(field) for field in item.get('changed_fields') or []]
    for entry in data.get('impact') or []:
        entry['mode_label'] = PROPAGATION_LABELS.get(str(entry.get('mode')), 'Propagated')
        counts = entry.get('counts') or {}
        entry['impact_line'] = (f"{counts.get('direct', 0)} direct and {counts.get('downstream', 0)} "
            f"downstream object(s) depend on this; {entry.get('marked', 0)} artifact marker(s) were recorded.")
        if entry.get('requiring_review'):
            entry['review_line'] = ('Approved content was flagged for review instead of being '
                'rewritten silently.')
    data['applied_line'] = ('No change was merged.' if not applied
        else f'{len(applied)} new mainline revision(s) were created. Branch history is preserved.')
    data.setdefault('note', RULE)
    return data


class VersionRepository:
    """Every call goes through the shared RPC helper with this layer's name attached."""

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def versions(self, workspace_id: UUID, production_id: UUID, token: str, *, object_id: UUID,
        branch: str, limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('version_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id), 'target_branch': branch, 'target_limit': limit,
            'target_offset': offset})

    async def version(self, workspace_id: UUID, production_id: UUID, token: str, *,
        version_id: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('version_get', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_version': str(version_id)})

    async def compare(self, workspace_id: UUID, production_id: UUID, token: str, *, left: UUID,
        right: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('version_compare', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'left_version': str(left), 'right_version': str(right)})

    async def restore(self, workspace_id: UUID, production_id: UUID, token: str, *, version_id: UUID,
        note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('version_restore', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_version': str(version_id), 'note_text': note})

    async def branches(self, workspace_id: UUID, production_id: UUID, token: str, *, state: str | None,
        limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('branch_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_state': state, 'target_limit': limit, 'target_offset': offset})

    async def branch(self, workspace_id: UUID, production_id: UUID, token: str, *,
        branch_id: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('branch_detail', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_branch': str(branch_id)})

    async def create_branch(self, workspace_id: UUID, production_id: UUID, token: str, *,
        scope_object_id: UUID, branch: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('branch_create', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'scope_object': str(scope_object_id), 'branch': branch})

    async def set_change(self, workspace_id: UUID, production_id: UUID, token: str, *, branch_id: UUID,
        change: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('branch_change_set', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_branch': str(branch_id), 'change': change})

    async def clear_change(self, workspace_id: UUID, production_id: UUID, token: str, *, branch_id: UUID,
        change_id: UUID, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('branch_change_clear', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_branch': str(branch_id), 'target_change': str(change_id), 'note_text': note})

    async def set_branch_state(self, workspace_id: UUID, production_id: UUID, token: str, *,
        branch_id: UUID, state: str, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('branch_state_set', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_branch': str(branch_id), 'desired_state': state, 'note_text': note})

    async def preview(self, workspace_id: UUID, production_id: UUID, token: str, *,
        branch_id: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('merge_preview', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_branch': str(branch_id)})

    async def decide(self, workspace_id: UUID, production_id: UUID, token: str, *, proposal_id: UUID,
        decision: str, selected: list[str], propagation: str, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('merge_decide', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_proposal': str(proposal_id), 'decision': decision, 'selected_ids': selected or None,
            'propagation': propagation, 'note_text': note})
