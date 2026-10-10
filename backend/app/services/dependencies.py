"""Prompt 9A dependency graph, impact engine and stale-artifact service.

Deterministic software owns this whole layer. Traversal, classification, depth bounds,
locking, approval protection and revision staleness are decided in the database (migration
019) and are surfaced here with human labels, never recalculated. No model is consulted:
an ``inferred`` edge arrives with its own rationale and confidence and is always reported as
a *potential* dependency, because a proposal is not certainty.

The one rule this module exists to protect: impact is computed and *never* applied by
computing it. Applying is a separate, explicitly confirmed creator decision.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

LAYER = 'Production intelligence'

DIRECTION_LABELS: dict[str, str] = {'forward': 'What this affects', 'reverse': 'What this depends on'}

CLASSIFICATION_LABELS: dict[str, str] = {
    'direct': 'Direct', 'downstream': 'Downstream', 'potential': 'Potential',
    'unaffected': 'Unaffected', 'unknown': 'Unknown',
}

RELATION_LABELS: dict[str, str] = {
    'creative': 'Creative', 'continuity': 'Continuity', 'execution': 'Execution', 'reference': 'Reference',
    'derived_from': 'Derived from', 'runtime': 'Runtime', 'asset': 'Asset binding', 'result': 'Result',
    'state': 'State',
}

STRENGTH_LABELS: dict[str, str] = {'hard': 'Hard', 'soft': 'Soft', 'advisory': 'Advisory'}

ORIGIN_LABELS: dict[str, str] = {
    'explicit': 'Declared by you', 'derived': 'Derived from your Production', 'inferred': 'Inferred (proposal)',
}

MODE_LABELS: dict[str, str] = {
    'update_all': 'UPDATE ALL', 'review_changes': 'REVIEW CHANGES', 'change_only_this': 'CHANGE ONLY THIS',
}

MODE_DESCRIPTIONS: dict[str, str] = {
    'update_all': 'Mark every affected derived artifact. Locked objects are reported and approved content is flagged for review rather than rewritten.',
    'review_changes': 'Mark only the dependents you selected. Nothing else is touched.',
    'change_only_this': 'Keep the change local. Direct dependents stop claiming to be current and the remaining downstream impact is recorded as unresolved.',
}

ARTIFACT_KIND_LABELS: dict[str, str] = {
    'real_plan': 'Real Production plan', 'ai_plan': 'AI Generation plan', 'prompt': 'Compiled prompt',
    'first_frame': 'First frame', 'last_frame': 'Last frame', 'generation_context': 'Generation context',
    'result_comparison': 'Result comparison', 'derived_summary': 'Derived summary',
    'continuity_state': 'Continuity state', 'continuity_analysis': 'Continuity analysis',
    'deliverable': 'Deliverable', 'dependent_object': 'Dependent object', 'other': 'Other',
}

STALE_STATE_LABELS: dict[str, str] = {'current': 'Current', 'stale': 'Stale', 'conflicted': 'Conflicted'}

LEVEL_LABELS: dict[str, str] = {
    'production': 'Production', 'act': 'Act', 'sequence': 'Sequence', 'scene': 'Scene', 'shot': 'Shot',
    'asset': 'Asset', 'reference': 'Reference', 'execution_plan': 'Execution plan', 'result': 'Result',
    'creative_document': 'Document',
}


def label_for(mapping: dict[str, str], value: Any, fallback: str = 'Unknown') -> str:
    """Return the display label for a stored code without inventing one that does not exist."""

    if value is None:
        return fallback
    return mapping.get(str(value), fallback)


def object_status(node: dict[str, Any]) -> str:
    """Describe a dependent's protection state honestly, from real flags only."""

    if node.get('locked'):
        return 'Locked'
    if node.get('approved'):
        return 'Approved'
    return 'Open'


def impact_modes() -> list[dict[str, str]]:
    """The three constitutional propagation choices, in the order the creator should read them."""

    return [{'mode': mode, 'label': MODE_LABELS[mode], 'description': MODE_DESCRIPTIONS[mode]} for mode in
        ('update_all', 'review_changes', 'change_only_this')]


def _summarise(analysis: dict[str, Any]) -> str:
    counts = analysis.get('counts') or {}
    root = analysis.get('root_label') or 'This object'
    direct = int(counts.get('direct') or 0)
    downstream = int(counts.get('downstream') or 0)
    potential = int(counts.get('potential') or 0)
    parts = [f"{direct} direct {'object' if direct == 1 else 'objects'}",
        f"{downstream} downstream {'object' if downstream == 1 else 'objects'}"]
    if potential:
        parts.append(f"{potential} potential {'dependency' if potential == 1 else 'dependencies'}")
    locked = int(counts.get('locked') or 0)
    approved = int(counts.get('approved') or 0)
    protection: list[str] = []
    if locked:
        protection.append(f'{locked} locked')
    if approved:
        protection.append(f'{approved} approved')
    line = f'{root} affects ' + ', '.join(parts) + '.'
    if protection:
        line += ' ' + ' and '.join(protection).capitalize() + ' dependent(s) are protected, not rewritten.'
    return line


def decorate_graph(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a bounded graph page. No value is recomputed here."""

    direction = data.get('direction')
    data['direction_label'] = label_for(DIRECTION_LABELS, direction, 'Impact')
    for node in data.get('nodes') or []:
        node['classification_label'] = label_for(CLASSIFICATION_LABELS, node.get('classification'))
        node['level_label'] = label_for(LEVEL_LABELS, node.get('level'))
        node['relation_label'] = label_for(RELATION_LABELS, node.get('relation'))
        node['status'] = object_status(node)
    for edge in data.get('edges') or []:
        edge['relation_label'] = label_for(RELATION_LABELS, edge.get('relation'))
        edge['strength_label'] = label_for(STRENGTH_LABELS, edge.get('strength'))
        edge['origin_label'] = label_for(ORIGIN_LABELS, edge.get('origin'))
    if 'total' in data:
        data['total_label'] = f"{int(data.get('total') or 0)} reachable object(s)"
    return data


def decorate_impact(analysis: dict[str, Any]) -> dict[str, Any]:
    """Decorate a computed impact. It is explicitly still unapplied."""

    counts = analysis.get('counts') or {}
    decorate_graph(analysis)
    analysis['applied'] = False
    analysis['requires_confirmation'] = True
    analysis['summary_line'] = _summarise(analysis)
    analysis['modes'] = impact_modes()
    analysis['locked_ids'] = analysis.get('locked_ids') or []
    analysis['approved_ids'] = analysis.get('approved_ids') or []
    # An impact has no page size, so it must never borrow the graph's "reachable" wording.
    analysis['total_label'] = f"{int(counts.get('total') or 0)} affected object(s)"
    return analysis


def decorate_apply(result: dict[str, Any]) -> dict[str, Any]:
    """Decorate an applied impact: what changed, what was protected, what is unresolved."""

    mode = result.get('mode')
    result['mode_label'] = label_for(MODE_LABELS, mode)
    result['applied'] = True
    for item in result.get('locked_skipped') or []:
        item['reason_label'] = 'Protected by a lock'
    for item in result.get('requiring_review') or []:
        item['reason_label'] = 'Needs creator review'
    marked = int(result.get('marked') or 0)
    skipped = len(result.get('locked_skipped') or [])
    review = len(result.get('requiring_review') or [])
    unresolved = int(result.get('unresolved_count') or 0)
    line = f"{marked} artifact(s) marked for {label_for(MODE_LABELS, mode, 'this change')}."
    if skipped:
        line += f' {skipped} locked dependent(s) were reported instead of changed.'
    if review:
        line += f' {review} approved dependent(s) need your review.'
    if unresolved:
        line += f' {unresolved} downstream change(s) remain unresolved.'
    result['summary_line'] = line
    return result


def decorate_edges(data: dict[str, Any]) -> dict[str, Any]:
    """Decorate the stored edges of one object. A deactivated edge stays readable."""

    for item in data.get('items') or []:
        item['relation_label'] = label_for(RELATION_LABELS, item.get('relation'))
        item['strength_label'] = label_for(STRENGTH_LABELS, item.get('strength'))
        item['origin_label'] = label_for(ORIGIN_LABELS, item.get('origin'))
        item['state_label'] = 'Active' if item.get('active') else 'Inactive (kept as history)'
    data['note'] = ('Edges are deactivated, never deleted: the history of a relationship stays readable, '
        'and an inferred edge is always shown as a proposal with its own rationale.')
    return data


def decorate_history(data: dict[str, Any]) -> dict[str, Any]:
    """Decorate impact history. A historical analysis is never rewritten into a new one."""

    for item in data.get('items') or []:
        item['mode_label'] = label_for(MODE_LABELS, item.get('mode'), 'Preview')
        item['applied_mode_label'] = (label_for(MODE_LABELS, item.get('applied_mode'), 'Not applied')
            if item.get('applied_mode') else 'Not applied')
        counts = item.get('counts') or {}
        item['affected_label'] = (f"{int(counts.get('direct') or 0)} direct, "
            f"{int(counts.get('downstream') or 0)} downstream")
    data['note'] = 'An impact analysis is a snapshot. Regenerating never overwrites this record.'
    return data


def decorate_markers(data: dict[str, Any]) -> dict[str, Any]:
    """Decorate stale markers with readable kind/state labels."""

    for item in data.get('items') or []:
        item['artifact_kind_label'] = label_for(ARTIFACT_KIND_LABELS, item.get('artifact_kind'))
        item['state_label'] = label_for(STALE_STATE_LABELS, item.get('state'))
    open_count = int(data.get('open') or 0)
    data['open_label'] = 'Nothing is stale.' if not open_count else f'{open_count} artifact(s) may no longer match their source.'
    return data


def is_already_applied(analysis: dict[str, Any] | None) -> bool:
    """A preview is single-use: a second apply is refused instead of silently repeated."""

    return bool(analysis and analysis.get('applied_mode'))


class DependencyRepository:
    """Reads and writes the dependency graph through guarded RPCs.

    Depth bounds, cycle safety, lock enforcement, approval protection and revision staleness
    are all decided in the database, so this class cannot bypass one.
    """

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def sync(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('dependency_sync', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id)})

    async def edge(self, workspace_id: UUID, production_id: UUID, token: str, *, source_object_id: UUID,
        target_object_id: UUID, relation: str, strength: str, origin: str, reason: str,
        affected_fields: list[str], evidence: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('dependency_edge', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'source_object': str(source_object_id), 'target_object': str(target_object_id),
            'relation_value': relation, 'strength_value': strength, 'origin_value': origin,
            'reason_value': reason, 'fields_value': affected_fields, 'evidence_value': evidence})

    async def set_active(self, workspace_id: UUID, production_id: UUID, token: str, *, edge_ids: list[str],
        active: bool, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('dependency_active', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'edge_ids': edge_ids, 'desired_active': active, 'note_text': note})

    async def graph(self, workspace_id: UUID, production_id: UUID, token: str, *, object_id: UUID,
        direction: str = 'forward', depth: int = 2, limit: int = 200) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('dependency_graph', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id), 'direction': direction, 'target_depth': depth, 'target_limit': limit})

    async def edges(self, workspace_id: UUID, production_id: UUID, token: str, *, object_id: UUID,
        limit: int = 100, offset: int = 0) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('dependency_edges', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id), 'target_limit': limit, 'target_offset': offset})

    async def preview(self, workspace_id: UUID, production_id: UUID, token: str, *, object_id: UUID,
        depth: int = 2, limit: int = 200) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('impact_preview', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id), 'target_depth': depth, 'target_limit': limit})

    async def history(self, workspace_id: UUID, production_id: UUID, token: str, *,
        limit: int = 20, offset: int = 0) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('impact_history', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_limit': limit, 'target_offset': offset})

    async def apply(self, workspace_id: UUID, production_id: UUID, token: str, *, analysis_id: UUID,
        mode: str, selected_ids: list[str], expected_root_revision: int | None, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('apply_impact', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_analysis': str(analysis_id), 'desired_mode': mode, 'selected_ids': selected_ids,
            'expected_root_revision': expected_root_revision, 'note_text': note})

    async def stale_artifacts(self, workspace_id: UUID, production_id: UUID, token: str, *,
        state: str | None = None, limit: int = 100, offset: int = 0) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('stale_artifact_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_state': state, 'target_limit': limit, 'target_offset': offset})

    async def resolve_stale(self, workspace_id: UUID, production_id: UUID, token: str, *, artifact_id: UUID,
        note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('resolve_stale_artifact', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_artifact': str(artifact_id), 'note_text': note})

    async def mark_stale(self, workspace_id: UUID, production_id: UUID, token: str, *, object_id: UUID,
        artifact_kind: str, reason: str, reference: UUID | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('mark_stale_artifact', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_object': str(object_id), 'kind_value': artifact_kind, 'reason_text': reason,
            'reference': str(reference) if reference else None})
