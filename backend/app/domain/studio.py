"""Prompt 5 Studio request contracts and read-model assembly.

Studio edits canonical Production data through revision-checked writes. Nothing here
creates a parallel Scene, Shot or Timeline model: the read model is a projection of
`tonde.scenes`, `tonde.shots`, their Assets, documents and status, and every write
goes through a guarded RPC.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.card_completeness import evaluate_card

StudioScope = Literal['production', 'scene', 'shot']
ApprovalValue = Literal['draft', 'needs_review', 'approved', 'changed_after_approval']
ExecutionMethod = Literal['real', 'ai', 'hybrid']
EXECUTION_METHODS: tuple[str, ...] = ('real', 'ai', 'hybrid')
MAX_SCENES = 200
MAX_SHOTS = 800


class StudioRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')


class SceneWrite(StudioRequest):
    title: str | None = Field(default=None, max_length=160)
    purpose: str | None = Field(default=None, max_length=1200)
    story_beat: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    opening_state: str | None = Field(default=None, max_length=400)
    ending_state: str | None = Field(default=None, max_length=400)
    visual_intent: str | None = Field(default=None, max_length=900)
    dialogue_notes: str | None = Field(default=None, max_length=900)
    environment_asset_id: str | None = Field(default=None, max_length=64)
    duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)


class CreateSceneRequest(SceneWrite):
    expected_production_revision: int | None = Field(default=None, ge=1)

    @field_validator('title')
    @classmethod
    def require_title(cls, value: str | None) -> str:
        if value is None or not value.strip():
            raise ValueError('A Scene needs a title of 1 to 160 characters.')
        return value


class UpdateSceneRequest(SceneWrite):
    expected_revision: int = Field(ge=1)


class ShotWrite(StudioRequest):
    title: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    action: str | None = Field(default=None, max_length=4000)
    purpose: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=200)
    framing: str | None = Field(default=None, max_length=120)
    angle: str | None = Field(default=None, max_length=120)
    movement: str | None = Field(default=None, max_length=160)
    composition: str | None = Field(default=None, max_length=300)
    transition: str | None = Field(default=None, max_length=200)
    story_relationship: str | None = Field(default=None, max_length=300)
    creative_notes: str | None = Field(default=None, max_length=1200)
    story_beat: str | None = Field(default=None, max_length=200)
    execution_method: ExecutionMethod | None = None
    duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)


class CreateShotRequest(ShotWrite):
    scene_id: str | None = Field(default=None, max_length=64)
    expected_production_revision: int | None = Field(default=None, ge=1)

    @field_validator('title')
    @classmethod
    def require_title(cls, value: str | None) -> str:
        if value is None or not value.strip():
            raise ValueError('A Shot needs a title of 1 to 160 characters.')
        return value


class UpdateShotRequest(ShotWrite):
    expected_revision: int = Field(ge=1)


class MoveShotRequest(StudioRequest):
    scene_id: str | None = Field(default=None, max_length=64)
    expected_revision: int = Field(ge=1)


class ReorderRequest(StudioRequest):
    ordered_ids: list[str] = Field(min_length=1, max_length=MAX_SHOTS)
    expected_production_revision: int | None = Field(default=None, ge=1)


class ApprovalRequest(StudioRequest):
    scope: StudioScope
    id: str = Field(min_length=1, max_length=64)
    approval: ApprovalValue
    expected_revision: int | None = Field(default=None, ge=1)


class LockRequest(StudioRequest):
    scope: StudioScope
    id: str = Field(min_length=1, max_length=64)
    locked: bool
    expected_revision: int | None = Field(default=None, ge=1)


class ReconcileRequest(StudioRequest):
    absorb_scene: str = Field(min_length=1, max_length=64)
    expected_production_revision: int | None = Field(default=None, ge=1)


def scene_payload(body: CreateSceneRequest | UpdateSceneRequest) -> dict[str, Any]:
    """Only supplied fields are sent, so an absent field cannot erase content."""

    data = body.model_dump(exclude_unset=True, exclude_none=False)
    for drop in ('expected_revision', 'expected_production_revision'):
        data.pop(drop, None)
    return data


def shot_payload(body: CreateShotRequest | UpdateShotRequest) -> dict[str, Any]:
    data = body.model_dump(exclude_unset=True, exclude_none=False)
    for drop in ('expected_revision', 'expected_production_revision', 'scene_id'):
        data.pop(drop, None)
    return data


def studio_read_model(
    *,
    production: dict[str, Any],
    scene_rows: list[dict[str, Any]],
    shot_rows: list[dict[str, Any]],
    asset_rows: list[dict[str, Any]],
    binding_rows: list[dict[str, Any]],
    participant_rows: list[dict[str, Any]],
    dialogue_rows: list[dict[str, Any]],
    document_rows: list[dict[str, Any]],
    result_rows: list[dict[str, Any]],
    timing: dict[str, Any],
    truncated: bool = False,
    plan_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """One aggregated Studio read model: Scenes, Shots, usage, status and timing."""

    shots_by_scene: dict[str, list[dict[str, Any]]] = {}
    for row in shot_rows:
        if row.get('lifecycle') != 'active':
            continue
        shots_by_scene.setdefault(str(row.get('scene_id')), []).append(row)
    for group in shots_by_scene.values():
        group.sort(key=lambda row: (row.get('sort_order') or 0, str(row.get('id'))))
    plans_by_shot = _plans_by_shot(plan_rows or [])

    participants_by_scene: dict[str, list[str]] = {}
    for row in participant_rows:
        participants_by_scene.setdefault(str(row.get('scene_id')), []).append(str(row.get('asset_id')))
    bindings_by_scope: dict[str, list[dict[str, Any]]] = {}
    for row in binding_rows:
        bindings_by_scope.setdefault(str(row.get('scope_object_id')), []).append(row)
    dialogue_by_scene: dict[str, int] = {}
    for row in dialogue_rows:
        if row.get('scene_id'):
            dialogue_by_scene[str(row['scene_id'])] = dialogue_by_scene.get(str(row['scene_id']), 0) + 1
    results_by_shot: dict[str, int] = {}
    for row in result_rows:
        if row.get('shot_id'):
            results_by_shot[str(row['shot_id'])] = results_by_shot.get(str(row['shot_id']), 0) + 1
    timing_by_scene = {str(item.get('scene_id')): item for item in (timing.get('scene_states') or [])}

    scenes: list[dict[str, Any]] = []
    ordered = sorted((row for row in scene_rows if row.get('lifecycle') == 'active'),
        key=lambda row: (row.get('sort_order') or 0, str(row.get('id'))))
    for index, row in enumerate(ordered, start=1):
        scene_id = str(row.get('id'))
        scene_shots = shots_by_scene.get(scene_id, [])
        scene_timing = timing_by_scene.get(scene_id, {})
        scenes.append({
            'id': scene_id,
            'order': index,
            'sort_order': row.get('sort_order'),
            'title': row.get('title'),
            'purpose': row.get('purpose'),
            'story_beat': row.get('story_beat'),
            'description': row.get('description'),
            'action_lines': row.get('action_lines') or [],
            'opening_state': row.get('opening_state'),
            'ending_state': row.get('ending_state'),
            'visual_intent': row.get('visual_intent'),
            'dialogue_notes': row.get('dialogue_notes'),
            'environment_asset_id': row.get('environment_asset_id'),
            'planned_duration_ms': row.get('planned_duration_ms'),
            'duration_ms': scene_timing.get('duration_ms', row.get('planned_duration_ms') or 0),
            'timing': scene_timing.get('timing', 'planned'),
            'approval': row.get('approval'),
            'locked_at': row.get('locked_at'),
            'revision': row.get('revision'),
            'updated_at': row.get('updated_at'),
            'character_asset_ids': participants_by_scene.get(scene_id, []),
            'dialogue_lines': dialogue_by_scene.get(scene_id, 0),
            'shot_count': len(scene_shots),
            'bindings': [binding_view(item) for item in bindings_by_scope.get(scene_id, [])],
            'shots': [shot_view(item, results_by_shot, bindings_by_scope,
                plans_by_shot.get(str(item.get('id')))) for item in scene_shots],
        })
        scene_entry = scenes[-1]
        scene_entry['completeness'] = evaluate_card(
            {'id': scene_id, 'order': scene_entry['order'], 'purpose': scene_entry['purpose'],
                'description': scene_entry['description'],
                'opening_state': row.get('opening_state'), 'ending_state': row.get('ending_state')},
            [{'id': str(item.get('id')), 'execution_method': item.get('execution_method') or 'real'}
                for item in scene_shots],
            plans_by_shot).model_dump(mode='json')
    orphan_shots = [shot_view(item, results_by_shot, bindings_by_scope,
        plans_by_shot.get(str(item.get('id')))) for item in shots_by_scene.get('None', [])]
    assets = [{
        'id': str(row.get('id')), 'asset_type': row.get('asset_type'), 'name': row.get('name'),
        'description': row.get('description'), 'approval': row.get('approval'),
        'locked_at': row.get('locked_at'), 'revision': row.get('revision'),
        'metadata': row.get('metadata') or {},
        'used_by_scenes': [scene['id'] for scene in scenes
            if scene['environment_asset_id'] == str(row.get('id')) or str(row.get('id')) in scene['character_asset_ids']],
    } for row in asset_rows]
    documents = {
        str(row.get('document_type')): {
            'title': row.get('title'), 'content': row.get('content'),
            'revision': row.get('revision'), 'updated_at': row.get('updated_at'),
            'approval': row.get('approval'), 'locked_at': row.get('locked_at'),
        }
        for row in document_rows if row.get('document_type')
    }
    runtime_conflict = timing.get('status') in ('over', 'under')
    return {
        'production': {
            'id': str(production.get('id')),
            'workspace_id': str(production.get('workspace_id')),
            'title': production.get('title'),
            'production_type': production.get('production_type'),
            'custom_type': production.get('custom_type'),
            'execution_method': production.get('execution_method'),
            'planned_duration_ms': production.get('planned_duration_ms'),
            'calculated_duration_ms': production.get('calculated_duration_ms'),
            'approval': production.get('approval'),
            'locked_at': production.get('locked_at'),
            'revision': production.get('revision'),
            'lifecycle': production.get('lifecycle'),
            'updated_at': production.get('updated_at'),
        },
        'scenes': scenes,
        'orphan_shots': orphan_shots,
        'assets': assets,
        'documents': documents,
        'timing': timing,
        'runtime_conflict': runtime_conflict,
        'timeline': [{
            'scene_id': scene['id'], 'order': scene['order'], 'title': scene['title'],
            'duration_ms': scene['duration_ms'], 'timing': scene['timing'], 'approval': scene['approval'],
            'locked': scene['locked_at'] is not None, 'execution_methods': sorted({shot['execution_method'] for shot in scene['shots']}),
            'shots': [{
                'shot_id': shot['id'], 'order': shot['order'], 'title': shot['title'],
                'duration_ms': shot['planned_duration_ms'], 'execution_method': shot['execution_method'],
                'approval': shot['approval'], 'locked': shot['locked_at'] is not None,
            } for shot in scene['shots']],
        } for scene in scenes],
        'status_summary': status_summary(production, scenes, orphan_shots),
        'truncated': truncated,
    }


def binding_view(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row.get('id')), 'binding_role': row.get('binding_role'),
        'asset_id': str(row['asset_id']) if row.get('asset_id') else None,
        'reference_id': str(row['reference_id']) if row.get('reference_id') else None,
        'inheritance': row.get('inheritance'), 'locked_at': row.get('locked_at'),
    }


def _plans_by_shot(plan_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Latest plan per Shot, merging the real and AI sides of hybrid coverage.

    `execution_plans` holds at most one row per (shot, method); the higher revision wins when
    history overlaps. A hybrid Shot needs both sides, so its real and AI rows merge with the
    stricter plan status carried forward."""

    from app.domain.card_completeness import DECISION_STATUSES

    latest: dict[tuple[str, str], dict[str, Any]] = {}
    for row in plan_rows:
        key = (str(row.get('shot_id')), str(row.get('execution_method') or 'real'))
        current = latest.get(key)
        if current is None or int(row.get('revision') or 0) >= int(current.get('revision') or 0):
            latest[key] = row
    merged: dict[str, dict[str, Any]] = {}
    shot_ids = {shot_id for shot_id, _ in latest}
    for shot_id in shot_ids:
        real = latest.get((shot_id, 'real'), {})
        ai = latest.get((shot_id, 'ai'), {})
        plan = {**real, **ai}
        statuses = [str(real.get('plan_status') or ''), str(ai.get('plan_status') or '')]
        if any(status in DECISION_STATUSES for status in statuses):
            plan['plan_status'] = next(status for status in statuses if status in DECISION_STATUSES)
            notes = '; '.join(note for note in
                (str(real.get('readiness_note') or ''), str(ai.get('readiness_note') or '')) if note.strip())
            plan['readiness_note'] = notes[:600]
        elif 'ready' in statuses:
            plan['plan_status'] = 'ready'
        merged[shot_id] = plan
    return merged


def shot_view(row: dict[str, Any], results_by_shot: dict[str, int],
    bindings_by_scope: dict[str, list[dict[str, Any]]],
    plan: dict[str, Any] | None = None) -> dict[str, Any]:
    shot_id = str(row.get('id'))
    return {
        'id': shot_id,
        'scene_id': str(row['scene_id']) if row.get('scene_id') else None,
        'order': row.get('order'),
        'sort_order': row.get('sort_order'),
        'title': row.get('title'),
        'description': row.get('description'),
        'action': row.get('action'),
        'purpose': row.get('purpose'),
        'subject': row.get('subject'),
        'framing': row.get('framing'),
        'angle': row.get('angle'),
        'movement': row.get('movement'),
        'composition': row.get('composition'),
        'transition': row.get('transition'),
        'story_relationship': row.get('story_relationship'),
        'story_beat': row.get('story_beat'),
        'creative_notes': row.get('creative_notes'),
        'execution_method': row.get('execution_method'),
        'planned_duration_ms': row.get('planned_duration_ms'),
        'approval': row.get('approval'),
        'locked_at': row.get('locked_at'),
        'revision': row.get('revision'),
        'updated_at': row.get('updated_at'),
        'result_count': results_by_shot.get(shot_id, 0),
        'bindings': [binding_view(item) for item in bindings_by_scope.get(shot_id, [])],
        'direction': ({'has_plan': True, 'plan_status': plan.get('plan_status') or 'draft'}
            if plan else {'has_plan': False, 'plan_status': 'unplanned'}),
    }


def status_summary(production: dict[str, Any], scenes: list[dict[str, Any]], orphan_shots: list[dict[str, Any]]) -> dict[str, Any]:
    """Approval, lock and changed-after-approval counts, without inventing readiness scores."""

    shots = [shot for scene in scenes for shot in scene['shots']] + orphan_shots
    counts = {'draft': 0, 'needs_review': 0, 'approved': 0, 'changed_after_approval': 0}
    for item in [*scenes, *shots]:
        key = item.get('approval') or 'draft'
        counts[key] = counts.get(key, 0) + 1
    return {
        'production_approval': production.get('approval'),
        'production_locked': production.get('locked_at') is not None,
        'scenes': len(scenes),
        'shots': len(shots),
        'scenes_locked': sum(1 for scene in scenes if scene['locked_at']),
        'shots_locked': sum(1 for shot in shots if shot['locked_at']),
        'approval_counts': counts,
        'needs_attention': counts.get('changed_after_approval', 0) + counts.get('needs_review', 0),
    }
