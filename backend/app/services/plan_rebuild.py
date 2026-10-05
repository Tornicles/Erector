"""Rehydrate the current Production plan from stored rows.

Director commands must operate on the state the creator is actually looking at,
so the plan is rebuilt from canonical rows rather than from chat history.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.domain.analysis import ReferenceAnalysis
from app.domain.brief import IntelligentBrief, build_brief
from app.domain.creative import (
    CreativeBundle,
    ScenePlan,
    ScriptLine,
    ScriptPlan,
    ScriptScenePlan,
    ShotConcept,
    StoryPlan,
    build_script,
    build_style_bible,
    runtime_fit,
)
from app.domain.director import ProductionIntent
from app.domain.reality import RealityReport, assess_full_reality
from app.domain.vocabulary import DialogueKind
from app.services.studio import ProductionPlan


def scene_from_row(row: dict[str, Any], index: int) -> ScenePlan | None:
    detail = row.get('scene_detail') or {}
    action_lines = [str(line)[:900] for line in (row.get('action_lines') or []) if str(line).strip()]
    if not action_lines:
        description = str(row.get('description') or '').strip()
        action_lines = [description[:900]] if description else ['Direct this Scene from the Story beat.']
    shots = [
        ShotConcept(
            order=int(shot.get('order') or position + 1), title=str(shot.get('title') or f'Shot {position + 1}')[:160],
            description=str(shot.get('description') or 'Shot concept')[:900],
            intent=str(shot.get('intent') or 'Serve the Scene')[:400], subject=str(shot.get('subject') or '')[:200],
        )
        for position, shot in enumerate(detail.get('shots') or []) if isinstance(shot, dict)
    ]
    purpose = str(row.get('purpose') or '').strip()
    if len(purpose.split()) < 3:
        purpose = f'{purpose} Carry the {row.get("story_beat") or "Scene"} beat of the Story.'.strip()
    return ScenePlan(
        order=int(detail.get('plan_order') or index + 1),
        title=str(row.get('title') or f'Scene {index + 1}')[:160],
        purpose=purpose[:1200],
        story_beat=str(row.get('story_beat') or '')[:200],
        action=action_lines[:12],
        characters=[str(value)[:120] for value in (detail.get('characters') or [])][:8],
        environment=str(detail.get('environment') or '')[:200],
        products=[str(value)[:160] for value in (detail.get('products') or [])][:6],
        dialogue_notes=str(row.get('dialogue_notes') or '')[:500],
        planned_duration_ms=int(row.get('planned_duration_ms') or 0),
        opening_state=str(row.get('opening_state') or '')[:300],
        ending_state=str(row.get('ending_state') or '')[:300],
        visual_intent=str(row.get('visual_intent') or '')[:600],
        shots=shots[:12],
        techniques=[str(value)[:120] for value in (detail.get('techniques') or [])][:6],
    )


def script_from_rows(scenes: list[ScenePlan], dialogue_rows: list[dict[str, Any]], *, title: str, dialogue_mode: str | None) -> ScriptPlan | None:
    if not scenes:
        return None
    by_scene: dict[str, list[dict[str, Any]]] = {}
    for row in dialogue_rows:
        by_scene.setdefault(str(row.get('scene_id')), []).append(row)
    script_scenes: list[ScriptScenePlan] = []
    for scene in scenes:
        rows = sorted(by_scene.get(str(scene.order), []), key=lambda row: int(row.get('sort_order') or 0))
        lines: list[ScriptLine] = []
        for position, row in enumerate(rows):
            try:
                kind = DialogueKind(str(row.get('line_type') or 'dialogue'))
            except ValueError:
                kind = DialogueKind.dialogue
            content = str(row.get('content') or '')[:2000]
            estimated = int(row.get('duration_ms') or 0)
            if kind in {DialogueKind.dialogue, DialogueKind.voiceover, DialogueKind.narration} and not content.strip():
                continue
            if kind in {DialogueKind.dialogue, DialogueKind.voiceover, DialogueKind.narration} and estimated <= 0:
                estimated = max(1, len(content.split()) * 400)
            flags = row.get('line_flags') or {}
            lines.append(ScriptLine(
                order=position + 1, kind=kind, speaker=(str(row.get('speaker'))[:120] if row.get('speaker') else None),
                content=content, estimated_ms=estimated, intention=str(row.get('intention') or '')[:300],
                delivery=str(row.get('delivery') or '')[:300], pause_after_ms=int(row.get('pause_after_ms') or 0),
                interruption=bool(flags.get('interruption')), overlap=bool(flags.get('overlap')),
                reaction_to=flags.get('reaction_to') if isinstance(flags.get('reaction_to'), int) else None,
                subtext=str(row.get('subtext') or '')[:300], scene_order=scene.order,
            ))
        script_scenes.append(ScriptScenePlan(
            scene_order=scene.order, scene_title=scene.title,
            heading=f'{"INT." if "interior" in scene.environment.lower() else "EXT."} {scene.environment.upper() or "LOCATION"} — DAY',
            action=[line[:900] for line in scene.action[:16]], lines=lines[:60],
            product_direction='', transition='Cut on the emotional change.',
            notes=scene.dialogue_notes, planned_duration_ms=scene.planned_duration_ms,
        ))
    return ScriptPlan(title=title[:160], scenes=script_scenes, dialogue_mode=dialogue_mode, estimated_runtime_ms=sum(scene.planned_duration_ms for scene in script_scenes))


def rebuild_plan_from_rows(
    *,
    intent: ProductionIntent,
    brief_row: dict[str, Any] | None,
    story_row: dict[str, Any] | None,
    scene_rows: list[dict[str, Any]],
    dialogue_rows: list[dict[str, Any]],
    reality_row: dict[str, Any] | None,
    analyses: list[ReferenceAnalysis] | None = None,
    setup: list[dict[str, Any]] | None = None,
) -> ProductionPlan:
    analyses = analyses or []
    setup = setup or []
    brief: IntelligentBrief | None = None
    if brief_row and isinstance(brief_row.get('brief'), dict):
        try:
            brief = IntelligentBrief.model_validate(brief_row['brief'])
        except ValidationError:
            brief = None
    if brief is None:
        brief = build_brief(intent, analyses=analyses, setups=setup)
    story: StoryPlan | None = None
    if story_row and isinstance(story_row.get('story'), dict):
        try:
            story = StoryPlan.model_validate(story_row['story'])
        except ValidationError:
            story = None
    scenes = [scene for index, row in enumerate(scene_rows) if (scene := scene_from_row(row, index)) is not None]
    scene_ids_by_order = {int((row.get('scene_detail') or {}).get('plan_order') or index + 1): str(row.get('id')) for index, row in enumerate(scene_rows)}
    remapped: list[dict[str, Any]] = []
    for row in dialogue_rows:
        order = next((order for order, scene_id in scene_ids_by_order.items() if scene_id == str(row.get('scene_id'))), None)
        remapped.append(row | {'scene_id': order})
    script = script_from_rows(scenes, remapped, title=brief.production_goal[:80] or 'Production Script', dialogue_mode=brief.dialogue_mode)
    target_ms = brief.runtime.planning_ms
    bundle = CreativeBundle(
        title=str(story.title if story else brief.production_goal[:80]),
        story=story,
        scenes=scenes,
        script=script,
        characters=[],
        environments=[],
        products=[],
        wardrobe_props=[],
        style_bible=build_style_bible(brief, analyses),
        producer=('model' if (story is not None and story.producer == 'model') else 'deterministic'),
    )
    bundle = bundle.model_copy(update={'runtime_fit': runtime_fit(bundle, target_ms)})
    reality: RealityReport | None = None
    if reality_row and isinstance(reality_row.get('report'), dict):
        try:
            reality = RealityReport.model_validate(reality_row['report'])
        except ValidationError:
            reality = None
    if reality is None:
        reality = assess_full_reality(bundle, setup, brief, target_ms=target_ms)
    return ProductionPlan(intent=intent, brief=brief, bundle=bundle, reality=reality, producer=bundle.producer, rationale='', limitations=[])


def resync_script(brief: IntelligentBrief, bundle: CreativeBundle) -> CreativeBundle:
    """Deterministic Script derivation must follow Scene or Story changes."""

    if bundle.story is None:
        return bundle
    return bundle.model_copy(update={'script': build_script(brief, bundle.story, bundle.scenes)})
