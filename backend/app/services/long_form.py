"""Prompt 8 long-form, Movie Mode, Series and Production Line engine.

Deterministic software owns identity, ordering, exact duration arithmetic, cadence dates,
planning depth, readiness and job state. Nothing here invents creative content: Generate
Ahead records a requested depth and creates a Production shell, and every derived number
is computed from real domain state rather than declared.

The Director half of this module resolves long-form and Series scope so a command such as
"Make Act 2 shorter" never silently becomes a Production-wide rewrite, and so a Series
command receives bounded context (titles, dates, states) instead of entire historical
Scripts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.domain.long_form import DEPTHS, HORIZONS, STRUCTURE_LEVELS

LAYER = 'Long-form & Series'

DEPTH_LABELS: dict[str, str] = {
    'idea': 'Idea',
    'outlined': 'Outlined',
    'story_defined': 'Story Defined',
    'scripted': 'Scripted',
    'scenes_planned': 'Scenes Planned',
    'shots_planned': 'Shots Planned',
    'execution_planned': 'Execution Planned',
    'in_progress': 'Capture / Generation In Progress',
}

LINE_STATE_LABELS: dict[str, str] = {
    'idea': 'Idea',
    'brief': 'Brief',
    'story': 'Story',
    'script': 'Script',
    'scene_plan': 'Scene Plan',
    'shot_plan': 'Shot Plan',
    'ready_to_execute': 'Ready to Execute',
    'in_production': 'In Production',
    'review': 'Review',
    'approved': 'Approved',
    'complete': 'Complete',
}

REQUESTED_DEPTH_LABELS: dict[str, str] = {
    'ideas_only': 'Ideas Only',
    'briefs': 'Briefs',
    'story': 'Story',
    'script': 'Script',
    'complete_plan': 'Complete Production Plan',
}

HORIZON_LABELS: dict[str, str] = {
    'tomorrow': 'Tomorrow',
    'next_7': 'Next 7',
    'next_14': 'Next 14',
    'next_30': 'Next 30',
    'entire_series': 'Entire Series',
    'custom': 'Custom',
}

# Direction vocabulary. A phrase maps to one deterministic operation; nothing is inferred
# from a model, so a command either applies exactly or says it did not map.
DIRECTION_OPERATIONS: dict[str, str] = {
    'shorter': 'shorten_scope',
    'shorten': 'shorten_scope',
    'tighten': 'shorten_scope',
    'condense': 'shorten_scope',
    'longer': 'lengthen_scope',
    'extend': 'lengthen_scope',
    'more tense': 'raise_tension',
    'tenser': 'raise_tension',
    'more suspense': 'raise_tension',
    'more suspenseful': 'raise_tension',
    'calmer': 'lower_tension',
    'less tense': 'lower_tension',
    'move this reveal': 'move_reveal',
    'move the reveal': 'move_reveal',
    'reorder': 'reorder_scope',
    'alternative': 'propose_alternatives',
    'alternatives': 'propose_alternatives',
    'another version': 'propose_alternatives',
    'stronger hook': 'strengthen_hook',
    'better hook': 'strengthen_hook',
    'stronger arc': 'strengthen_arc',
    'middle section drags': 'tighten_middle',
    'drags': 'tighten_middle',
}

SERIES_OPERATIONS: dict[str, str] = {
    'plan next': 'plan_future_episodes',
    'plan the next': 'plan_future_episodes',
    'plan next week': 'plan_future_episodes',
    'generate the next': 'plan_future_episodes',
    'next seven': 'plan_future_episodes',
    'next 7': 'plan_future_episodes',
    "don't repeat": 'avoid_repetition',
    'do not repeat': 'avoid_repetition',
    'avoid repeating': 'avoid_repetition',
    "yesterday's opening": 'avoid_repetition',
    'advance the mystery': 'advance_arc',
    'advance the story': 'advance_arc',
    'move this reveal': 'move_reveal',
    'stronger hook': 'strengthen_hook',
    'cadence': 'review_cadence',
    'entire series': 'plan_future_episodes',
}

AMBIGUOUS_SCOPE_NOTE = ('That command could apply to more than one scope, so TONDE did not choose for you. '
    'Name the Act, Sequence, Scene or Shot you mean.')


@dataclass(frozen=True)
class LongFormScope:
    """One explicit scope for a long-form command."""

    level: str
    identifier: str | None
    display_number: int | None
    block: str
    operation: str | None
    applied: tuple[str, ...] = ()
    ambiguous: bool = False
    note: str = ''

    def as_dict(self) -> dict[str, Any]:
        return {
            'scope_level': self.level, 'scope_id': self.identifier, 'display_number': self.display_number,
            'block': self.block, 'operation': self.operation, 'applied': list(self.applied),
            'ambiguous': self.ambiguous, 'note': self.note,
            'scope_is_explicit': self.identifier is not None and not self.ambiguous,
        }


@dataclass(frozen=True)
class SeriesScope:
    """A Series command resolved to a deterministic operation and a bounded horizon."""

    operation: str | None
    horizon: str | None
    count: int | None
    depth: str | None
    avoid_recent: bool
    applied: tuple[str, ...] = ()
    note: str = ''

    def as_dict(self) -> dict[str, Any]:
        return {
            'operation': self.operation, 'horizon': self.horizon, 'count': self.count, 'depth': self.depth,
            'avoid_recent_topics': self.avoid_recent, 'applied': list(self.applied), 'note': self.note,
        }


@dataclass(frozen=True)
class StructureNode:
    """The minimum a client or the Director needs to identify one structural node."""

    level: str
    identifier: str
    title: str
    display_index: int | None = None
    children: tuple[str, ...] = ()


@dataclass
class StructureIndex:
    """A deterministic index of one Production's structure, built from the read model."""

    acts: list[StructureNode] = field(default_factory=list)
    sequences: list[StructureNode] = field(default_factory=list)
    scenes: list[StructureNode] = field(default_factory=list)
    shots: list[StructureNode] = field(default_factory=list)

    @classmethod
    def from_structure(cls, payload: dict[str, Any] | None) -> 'StructureIndex':
        index = cls()
        items = (payload or {}).get('items') or []
        for position, item in enumerate(items, start=1):
            identifier = str(item.get('id') or '')
            if not identifier:
                continue
            node = StructureNode(level=str(item.get('level') or ''), identifier=identifier,
                title=str(item.get('title') or ''),
                display_index=int(item.get('display_index') or position))
            getattr(index, f'{node.level}s').append(node) if node.level in STRUCTURE_LEVELS else None
        return index

    def merge(self, other: 'StructureIndex | None') -> 'StructureIndex':
        """Add one loaded page (a level inside an Act, Sequence or Scene) to this index."""

        if other is None:
            return self
        seen = {(node.level, node.identifier) for nodes in
            (self.acts, self.sequences, self.scenes, self.shots) for node in nodes}
        for level in ('acts', 'sequences', 'scenes', 'shots'):
            target = getattr(self, level)
            for node in getattr(other, level):
                if (node.level, node.identifier) not in seen:
                    target.append(node)
                    seen.add((node.level, node.identifier))
        return self

    def nodes(self, level: str) -> list[StructureNode]:
        return {
            'act': self.acts, 'sequence': self.sequences, 'scene': self.scenes, 'shot': self.shots,
        }.get(level, [])

    def by_number(self, level: str, number: int) -> StructureNode | None:
        for node in self.nodes(level):
            if node.display_index == number:
                return node
        return None

    def by_title(self, level: str, fragment: str) -> StructureNode | None:
        lowered = fragment.lower()
        for node in self.nodes(level):
            if lowered in node.title.lower():
                return node
        return None


_NUMBER_WORDS = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
    'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
}


def _number_after(text: str, words: tuple[str, ...]) -> int | None:
    pattern = r'(?:' + '|'.join(words) + r')\s+(\d{1,3}|' + '|'.join(_NUMBER_WORDS) + r')'
    match = re.search(pattern, text)
    if not match:
        return None
    raw = match.group(1)
    return int(raw) if raw.isdigit() else _NUMBER_WORDS.get(raw)


def _count_before_unit(text: str) -> int | None:
    """A count the creator stated with its unit, e.g. 'plan 5 episodes'."""

    pattern = r'(\d{1,3}|' + '|'.join(_NUMBER_WORDS) + r')\s+(?:episodes|videos|shorts|entries|days|slots)'
    match = re.search(pattern, text)
    if not match:
        return None
    raw = match.group(1)
    return int(raw) if raw.isdigit() else _NUMBER_WORDS.get(raw)


def resolve_long_form_scope(text: str, structure: StructureIndex | None = None,
    selected: dict[str, Any] | None = None) -> LongFormScope:
    """Resolve one explicit long-form scope from a creator command.

    A numbered reference resolves against the loaded structure; a demonstrative reference
    ("this Sequence") resolves against the Studio selection. When neither exists the scope
    is reported ambiguous rather than widened to the whole Production.
    """

    lowered = ' '.join(str(text or '').lower().split())
    structure = structure or StructureIndex()
    selected = selected or {}
    applied: list[str] = []
    operation: str | None = None
    for phrase, value in DIRECTION_OPERATIONS.items():
        if phrase in lowered:
            operation = value
            applied.append(f'operation resolved to {value.replace("_", " ")}')
            break

    explicit = _number_after(lowered, ('act',))
    if explicit is not None:
        node = structure.by_number('act', explicit)
        return LongFormScope('act', node.identifier if node else None, explicit, 'act', operation,
            tuple(applied) + (('matched Act against the loaded structure',) if node else ()),
            ambiguous=node is None,
            note='' if node else f'No Act {explicit} is loaded in this Production.')

    sequence_number = _number_after(lowered, ('sequence', 'seq'))
    if sequence_number is not None:
        node = structure.by_number('sequence', sequence_number)
        return LongFormScope('sequence', node.identifier if node else None, sequence_number, 'sequence',
            operation, tuple(applied) + (('matched Sequence against the loaded structure',) if node else ()),
            ambiguous=node is None,
            note='' if node else f'No Sequence {sequence_number} is loaded in this Act.')

    scene_number = _number_after(lowered, ('scene',))
    if scene_number is not None:
        node = structure.by_number('scene', scene_number)
        return LongFormScope('scene', node.identifier if node else None, scene_number, 'scene', operation,
            tuple(applied) + (('matched Scene against the loaded structure',) if node else ()),
            ambiguous=node is None,
            note='' if node else f'No Scene {scene_number} is loaded in this Sequence.')

    shot_number = _number_after(lowered, ('shot',))
    if shot_number is not None:
        node = structure.by_number('shot', shot_number)
        return LongFormScope('shot', node.identifier if node else None, shot_number, 'shot', operation,
            tuple(applied) + (('matched Shot against the loaded structure',) if node else ()),
            ambiguous=node is None,
            note='' if node else f'No Shot {shot_number} is loaded in this Scene.')

    if any(word in lowered for word in ('this act', 'current act')):
        identifier = selected.get('act_id')
        return LongFormScope('act', str(identifier) if identifier else None, None, 'act', operation, tuple(applied),
            ambiguous=identifier is None, note='' if identifier else AMBIGUOUS_SCOPE_NOTE)
    if any(word in lowered for word in ('this sequence', 'current sequence')):
        identifier = selected.get('sequence_id')
        return LongFormScope('sequence', str(identifier) if identifier else None, None, 'sequence', operation,
            tuple(applied), ambiguous=identifier is None,
            note='' if identifier else AMBIGUOUS_SCOPE_NOTE)
    if any(word in lowered for word in ('this scene', 'current scene')):
        identifier = selected.get('scene_id')
        return LongFormScope('scene', str(identifier) if identifier else None, None, 'scene', operation,
            tuple(applied), ambiguous=identifier is None,
            note='' if identifier else AMBIGUOUS_SCOPE_NOTE)
    if any(word in lowered for word in ('this shot', 'current shot')):
        identifier = selected.get('shot_id')
        return LongFormScope('shot', str(identifier) if identifier else None, None, 'shot', operation,
            tuple(applied), ambiguous=identifier is None,
            note='' if identifier else AMBIGUOUS_SCOPE_NOTE)

    whole_production = any(word in lowered for word in
        ('the whole production', 'entire production', 'whole film', 'the whole movie'))
    if whole_production:
        return LongFormScope('production', str(selected.get('production_id') or '') or None, None, 'production',
            operation, tuple(applied),
            note='A Production-wide command applies to the whole Production, exactly as asked.')
    return LongFormScope('production', str(selected.get('production_id') or '') or None, None, 'production',
        operation, tuple(applied), ambiguous=True,
        note=('No explicit Act, Sequence, Scene or Shot was named, so TONDE did not widen this to the whole '
            'Production. Name the scope you mean, or say "the whole Production".'))


def interpret_long_form_direction(text: str) -> dict[str, Any]:
    """The deterministic direction half of a long-form command, with no structure loaded."""

    lowered = ' '.join(str(text or '').lower().split())
    applied: list[str] = []
    operation: str | None = None
    for phrase, value in DIRECTION_OPERATIONS.items():
        if phrase in lowered:
            operation = value
            applied.append(value.replace('_', ' '))
            break
    wants_alternatives = operation == 'propose_alternatives'
    return {
        'operation': operation, 'applied': applied, 'wants_alternatives': wants_alternatives,
        'note': '' if operation else ('That direction did not map to a structural operation, so nothing was '
            'changed. TONDE can shorten, lengthen, retarget tension, move a reveal or propose alternatives.'),
    }


def resolve_series_scope(text: str, horizon: str | None = None, count: int | None = None,
    depth: str | None = None) -> SeriesScope:
    """Resolve a Series command to a deterministic operation and a finite horizon."""

    lowered = ' '.join(str(text or '').lower().split())
    applied: list[str] = []
    operation: str | None = None
    for phrase, value in SERIES_OPERATIONS.items():
        if phrase in lowered:
            operation = value
            applied.append(value.replace('_', ' '))
            break
    resolved_horizon = horizon if horizon in HORIZONS else None
    if resolved_horizon is None:
        if 'tomorrow' in lowered:
            resolved_horizon = 'tomorrow'
        elif any(word in lowered for word in ('next 7', 'next seven', 'plan next week', 'this week')):
            resolved_horizon = 'next_7'
        elif any(word in lowered for word in ('next 14', 'next fourteen', 'two weeks')):
            resolved_horizon = 'next_14'
        elif any(word in lowered for word in ('next 30', 'next thirty', 'a month', '30 days')):
            resolved_horizon = 'next_30'
        elif 'entire series' in lowered or 'whole series' in lowered:
            resolved_horizon = 'entire_series'
    resolved_count = count if isinstance(count, int) and 1 <= count <= 400 else None
    if resolved_count is None:
        resolved_count = _count_before_unit(lowered)
        if resolved_count is not None and resolved_horizon is None and resolved_count <= 400:
            resolved_horizon = 'custom'
    if resolved_count is None and any(word in lowered for word in ('episodes', 'videos')):
        resolved_count = _number_after(lowered, ('next',)) or _number_after(lowered, ('generate',))
        if resolved_count is not None and resolved_horizon is None and resolved_count <= 400:
            resolved_horizon = 'custom'
    if resolved_count is not None and resolved_count > 400:
        resolved_count = None
    resolved_depth = depth if depth in DEPTHS else None
    if resolved_depth is None:
        if 'idea' in lowered:
            resolved_depth = 'ideas_only'
        elif 'brief' in lowered:
            resolved_depth = 'briefs'
        elif 'script' in lowered:
            resolved_depth = 'script'
        elif 'story' in lowered:
            resolved_depth = 'story'
        elif any(word in lowered for word in ('complete', 'ready to shoot', 'ready to generate')):
            resolved_depth = 'complete_plan'
    avoid_recent = operation == 'avoid_repetition' or any(word in lowered for word in
        ("don't repeat", 'do not repeat', 'avoid repeating', 'not the same'))
    note = ''
    if resolved_horizon in ('next_7', 'next_14', 'next_30', 'tomorrow', 'entire_series') or resolved_count:
        note = ('Generate Ahead records the requested depth and creates the Production shells it needs. '
            'Existing Episodes are preserved and nothing deeper is fabricated.')
    if operation is None and resolved_horizon is None and resolved_count is None:
        note = 'That Series command did not map to a planning operation, so nothing was created.'
    return SeriesScope(operation, resolved_horizon, resolved_count, resolved_depth, avoid_recent,
        tuple(applied), note)


def depth_label(value: str | None) -> str:
    return DEPTH_LABELS.get(str(value or ''), str(value or '').replace('_', ' '))


def legacy_requested_depth_label(value: str | None) -> str:
    return REQUESTED_DEPTH_LABELS.get(str(value or ''), '')


def line_state_label(value: str | None) -> str:
    return LINE_STATE_LABELS.get(str(value or ''), str(value or '').replace('_', ' '))


def structure_summary_line(scope: dict[str, Any], breadcrumb: list[dict[str, Any]] | None = None) -> str:
    """The breadcrumb sentence a creator reads, e.g. Production -> Act 2 -> Sequence 4."""

    parts = [str(item.get('title') or item.get('level') or '') for item in (breadcrumb or []) if item]
    if not parts:
        parts = [str(scope.get('title') or scope.get('level') or '')]
    return ' -> '.join(part for part in parts if part)


def readiness_is_criteria_based(items: list[dict[str, Any]]) -> bool:
    """Guard helper: readiness is counts of real blockers, never an invented percentage."""

    for item in items:
        readiness = item.get('readiness') or {}
        if 'percent' in readiness or 'percentage' in readiness:
            return False
        if readiness.get('state') not in ('READY', 'READY WITH WARNINGS', 'NEEDS REVIEW', 'BLOCKED', 'UNKNOWN', None):
            return False
    return True


class LongFormRepository:
    """Reads and writes the long-form layers through guarded RPCs.

    Ordering, revision conflict detection, lock enforcement, idempotency and readiness are
    all decided in the database, so this class cannot bypass one.
    """

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def structure(self, workspace_id: UUID, production_id: UUID, token: str, *, level: str = 'production',
        scope_id: UUID | None = None, limit: int = 50, offset: int = 0,
        expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('long_form_structure', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_level': level, 'target_id': str(scope_id) if scope_id else None,
            'target_limit': limit, 'target_offset': offset, 'expected_production_revision': expected_revision})

    async def timing(self, workspace_id: UUID, production_id: UUID, token: str, *,
        expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('long_form_timing', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': expected_revision})

    async def search(self, workspace_id: UUID, production_id: UUID, token: str, *, query: str,
        filters: dict[str, Any] | None = None, limit: int = 40, offset: int = 0) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('long_form_search', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'search_query': query, 'filters': filters or {}, 'target_limit': limit, 'target_offset': offset})

    async def script_index(self, workspace_id: UUID, production_id: UUID, token: str, *,
        limit: int = 50, offset: int = 0) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('long_form_script_index', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_limit': limit, 'target_offset': offset})

    async def context(self, workspace_id: UUID, production_id: UUID, token: str, *, level: str,
        scope_id: UUID, budget_chars: int = 4000) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('long_form_context', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_level': level, 'target_id': str(scope_id), 'budget_chars': budget_chars})

    async def summaries(self, workspace_id: UUID, production_id: UUID, token: str, *,
        limit: int = 100, offset: int = 0) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('long_form_summaries', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_limit': limit, 'target_offset': offset})

    async def save_summary(self, workspace_id: UUID, production_id: UUID, token: str, *, level: str,
        scope_id: UUID, content: dict[str, Any], note: str, generated_by: str,
        expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('save_structure_summary', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_level': level, 'target_id': str(scope_id), 'content': content,
            'expected_production_revision': expected_revision, 'note': note, 'generated_by': generated_by})

    async def create_act(self, workspace_id: UUID, production_id: UUID, token: str, payload: dict[str, Any],
        expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('create_long_form_act', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': expected_revision, 'act': payload})

    async def update_act(self, workspace_id: UUID, production_id: UUID, act_id: UUID, token: str,
        payload: dict[str, Any], expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('update_long_form_act', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_act': str(act_id), 'expected_revision': expected_revision, 'patch': payload})

    async def create_sequence(self, workspace_id: UUID, production_id: UUID, token: str, payload: dict[str, Any],
        expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('create_long_form_sequence', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': expected_revision, 'sequence': payload})

    async def update_sequence(self, workspace_id: UUID, production_id: UUID, sequence_id: UUID, token: str,
        payload: dict[str, Any], expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('update_long_form_sequence', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_sequence': str(sequence_id), 'expected_revision': expected_revision, 'patch': payload})

    async def move_scene(self, workspace_id: UUID, production_id: UUID, scene_id: UUID, token: str, *,
        sequence_id: UUID | None, act_id: UUID | None, expected_revision: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('move_long_form_scene', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_scene': str(scene_id), 'expected_revision': expected_revision,
            'target_sequence': str(sequence_id) if sequence_id else None,
            'target_act': str(act_id) if act_id else None})

    async def move_sequence(self, workspace_id: UUID, production_id: UUID, sequence_id: UUID, token: str, *,
        act_id: UUID | None, expected_revision: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('move_long_form_sequence', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_sequence': str(sequence_id), 'expected_revision': expected_revision,
            'target_act': str(act_id) if act_id else None})

    async def split(self, workspace_id: UUID, production_id: UUID, token: str, *, level: str, scope_id: UUID,
        split_order: int, expected_revision: int, title: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('split_long_form_structure', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_level': level, 'target_id': str(scope_id), 'split_order': split_order,
            'expected_revision': expected_revision, 'new_title': title})

    async def reorder(self, workspace_id: UUID, production_id: UUID, token: str, *, level: str,
        ordered_ids: list[str], expected_structure_revision: int | None, parent_id: UUID | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('reorder_long_form', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_level': level, 'ordered_ids': ordered_ids,
            'expected_production_revision': expected_structure_revision,
            'parent_id': str(parent_id) if parent_id else None})

    async def set_approval(self, workspace_id: UUID, production_id: UUID, token: str, *, level: str,
        scope_id: UUID, approval: str, expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_long_form_approval', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_level': level, 'target_id': str(scope_id), 'desired_approval': approval,
            'expected_revision': expected_revision})

    async def set_lock(self, workspace_id: UUID, production_id: UUID, token: str, *, level: str,
        scope_id: UUID, locked: bool, expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_long_form_lock', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_level': level, 'target_id': str(scope_id), 'locked': locked,
            'expected_revision': expected_revision})

    async def create_series(self, workspace_id: UUID, project_id: UUID, token: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('create_series', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_project': str(project_id), 'series': payload})

    async def update_series(self, workspace_id: UUID, series_id: UUID, token: str, payload: dict[str, Any],
        expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('update_series', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id),
            'expected_revision': expected_revision, 'patch': payload})

    async def save_collection(self, workspace_id: UUID, series_id: UUID, token: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('save_series_collection', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id), 'collection': payload})

    async def overview(self, workspace_id: UUID, series_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('series_overview', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id)})

    async def create_episode(self, workspace_id: UUID, series_id: UUID, token: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('create_series_episode', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id), 'episode': payload})

    async def update_episode(self, workspace_id: UUID, series_id: UUID, episode_id: UUID, token: str,
        payload: dict[str, Any], expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('update_series_episode', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id),
            'target_episode': str(episode_id), 'expected_revision': expected_revision, 'patch': payload})

    async def slots(self, workspace_id: UUID, series_id: UUID, token: str, *, horizon: str, count: int = 0,
        base_date: str | None = None, hold_slots: list[str] | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('series_slots', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id),
            'target_horizon': horizon, 'requested_count': count, 'base_date': base_date,
            'hold_slots': hold_slots or []})

    async def preview(self, workspace_id: UUID, series_id: UUID, token: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('generate_ahead_preview', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id), 'request': payload})

    async def generate(self, workspace_id: UUID, series_id: UUID, token: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('generate_ahead', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id), 'request': payload})

    async def retry(self, workspace_id: UUID, token: str, job_id: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('retry_generate_ahead', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_job': str(job_id)})

    async def jobs(self, workspace_id: UUID, series_id: UUID, token: str, *, limit: int = 10) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('generate_ahead_jobs', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id), 'target_limit': limit})

    async def production_line(self, workspace_id: UUID, series_id: UUID, token: str, *,
        limit: int = 30, offset: int = 0) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('series_production_line', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id),
            'target_limit': limit, 'target_offset': offset})

    async def director_context(self, workspace_id: UUID, series_id: UUID, token: str, *,
        limit: int = 10) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('series_director_context', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_series': str(series_id), 'target_limit': limit})
