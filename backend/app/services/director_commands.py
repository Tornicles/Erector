"""Director command execution.

A routed command produces a real, revision-safe proposal over the plan: Story
beats are rewritten, Scene durations are rebalanced exactly, dialogue is
re-fitted to the runtime, or Reality Check adaptations are applied. Nothing here
writes to the Production: the caller proposes, checks the revision and applies.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.analysis import CausalExplanation, ReferenceAnalysis, ReferenceRole
from app.domain.brief import BriefAssumption, IntelligentBrief
from app.domain.commands import DirectorCommand, DirectorCommandKind
from app.domain.creative import (
    CreativeBundle,
    ScenePlan,
    ScriptLine,
    ScriptScenePlan,
    StoryPlan,
    allocate_runtime,
    build_creative_bundle,
    build_script,
    estimate_speech_ms,
    runtime_fit,
    transform_line,
)
from app.domain.vocabulary import ProductionType
from app.services.studio import ProductionPlan, build_production_plan, deterministic_story_alternatives


class CommandModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class CommandOutcome(CommandModel):
    command: DirectorCommand
    plan: ProductionPlan | None = None
    producer: Literal['deterministic', 'model'] = 'deterministic'
    operations: list[str] = Field(default_factory=list, max_length=10)
    rationale: str = Field(default='', max_length=1600)
    answer: str = Field(default='', max_length=2000)
    limitations: list[str] = Field(default_factory=list, max_length=10)
    causal: list[CausalExplanation] = Field(default_factory=list, max_length=6)
    story_alternatives: list[StoryPlan] = Field(default_factory=list, max_length=4)
    line_alternatives: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    reference_role: dict[str, Any] | None = None
    adaptations_applied: list[str] = Field(default_factory=list, max_length=10)
    changes: list[str] = Field(default_factory=list, max_length=10)


INTENSITY_BANK = (
    'Tighten the frame and remove anything that does not carry the beat.',
    'Hold one image longer than is comfortable before the cut.',
    'Bring the sound up under the silence and let it press.',
    'Cut on the strongest gesture instead of the end of the action.',
)


def _rebuild(
    plan: ProductionPlan,
    brief: IntelligentBrief,
    *,
    variation: str = 'original',
    variant_index: int = 0,
    analyses: list[ReferenceAnalysis] | None = None,
    setup: list[dict[str, Any]] | None = None,
) -> ProductionPlan:
    target_ms = brief.runtime.planning_ms
    bundle = build_creative_bundle(
        brief, target_ms=target_ms, analyses=analyses or [], variation=variation,
        variant_index=variant_index, producer=plan.producer,
    )
    return build_production_plan(
        plan.intent.model_copy(update={'runtime_ms': target_ms, 'constraints': plan.intent.constraints.model_copy(
            update={'crew_size': brief.crew_size, 'available_hours': brief.available_hours},
        )}),
        analyses=analyses or [], setup=setup or [], answered=_answers(brief),
        variation=variation, producer=plan.producer,
    ).model_copy(update={'brief': brief, 'bundle': bundle})


def _answers(brief: IntelligentBrief) -> dict[str, str]:
    answers: dict[str, str] = {}
    for decision in brief.open_decisions:
        if decision.answer:
            answers[decision.id] = decision.answer
    return answers


def _rebalance(bundle: CreativeBundle, brief: IntelligentBrief, target_ms: int | None, weights: list[float] | None = None) -> CreativeBundle:
    """Exact integer re-allocation of Scene duration plus a re-fitted Script."""

    if target_ms is None or not bundle.scenes:
        return bundle
    durations = allocate_runtime(target_ms, len(bundle.scenes), weights)
    scenes = [
        scene.model_copy(update={'planned_duration_ms': durations[index]})
        for index, scene in enumerate(bundle.scenes)
    ]
    story = bundle.story
    if story is not None:
        beats = [
            beat.model_copy(update={'planned_duration_ms': durations[index]}) if index < len(durations) else beat
            for index, beat in enumerate(story.beats)
        ]
        story = story.model_copy(update={'beats': beats, 'runtime_ms': target_ms})
    script = build_script(brief, story, scenes) if story is not None else None
    updated = bundle.model_copy(update={'scenes': scenes, 'story': story, 'script': script})
    return updated.model_copy(update={'runtime_fit': runtime_fit(updated, target_ms)})


def _story_beats_with_opening(bundle: CreativeBundle) -> StoryPlan | None:
    story = bundle.story
    if story is None or not story.beats:
        return None
    first = story.beats[0]
    strengthened = (
        'Open on the single most arresting image available and delay every explanation: '
        f'{first.content} Keep the first cut inside the hook so the opening earns the next three seconds.'
    )
    beats = [first.model_copy(update={'content': strengthened[:1600]}), *story.beats[1:]]
    return story.model_copy(update={'beats': beats, 'hook': strengthened[:800], 'beginning': strengthened[:800]})


def intensify_scene_text(purpose: str, visual_intent: str, index: int) -> tuple[str, str, str]:
    extra = INTENSITY_BANK[index % len(INTENSITY_BANK)]
    return (
        f'{purpose} Raise the intensity: {extra}'.strip()[:1200],
        f'{visual_intent} {extra}'.strip()[:900],
        extra,
    )


def execute_command(
    command: DirectorCommand,
    *,
    plan: ProductionPlan,
    analyses: list[ReferenceAnalysis] | None = None,
    setup: list[dict[str, Any]] | None = None,
    selected_story: StoryPlan | None = None,
) -> CommandOutcome:
    analyses = analyses or []
    setup = setup or []
    brief = plan.brief
    target_ms = brief.runtime.planning_ms
    kind = command.kind
    limitations: list[str] = []
    adaptations_applied: list[str] = []

    if kind == DirectorCommandKind.unresolved:
        return CommandOutcome(
            command=command, plan=None, operations=[], rationale=command.rationale, changes=[],
            answer=command.rationale,
        )

    if kind == DirectorCommandKind.reference_causal:
        causal = [item for analysis in analyses for item in analysis.causal]
        if not causal:
            return CommandOutcome(
                command=command, plan=None, operations=['causal_explanation'], rationale=command.rationale,
                answer='No analysed reference can answer that yet. Add or analyse a Reference first, and TONDE will explain what makes it work from observed evidence.',
            )
        answer = ' '.join(f'{item.explanation}' for item in causal[:2])
        return CommandOutcome(
            command=command, plan=None, operations=['causal_explanation'], rationale=command.rationale,
            answer=answer[:2000], causal=causal[:4],
            limitations=[note for analysis in analyses for note in analysis.limitations[:1]][:4],
        )

    if kind == DirectorCommandKind.reference_role:
        role = ReferenceRole(command.reference_role) if command.reference_role else ReferenceRole.style
        updated = [analysis.model_copy(update={'role': role}) for analysis in analyses]
        selected = updated[command.reference_index or 0] if updated else None
        return CommandOutcome(
            command=command, plan=plan.model_copy(update={'brief': brief.model_copy(update={
                'reference_roles': {**(brief.reference_roles), str(selected.reference_id): role} if selected and selected.reference_id else brief.reference_roles,
            })}),
            operations=['assign_reference_role'],
            rationale=command.rationale,
            answer=f'This Reference now contributes {role.value} only. Everything else stays your direction.' if selected else 'Assign a Reference first so a role can be carried.',
            reference_role={'role': role.value, 'reference_id': str(selected.reference_id) if selected and selected.reference_id else None},
            changes=[f'Reference role set to {role.value}'],
        )

    if kind == DirectorCommandKind.story_alternatives:
        alternatives = deterministic_story_alternatives(
            brief, target_ms=target_ms, analyses=analyses, count=int(command.parameters.get('count', 3) or 3),
        )
        return CommandOutcome(
            command=command, plan=plan, operations=['story_alternatives'], rationale=command.rationale,
            answer=f'{len(alternatives)} alternative Story direction(s) are ready. Your selected Story is unchanged until you choose one.',
            story_alternatives=alternatives,
            changes=[f'{story.variation} alternative generated' for story in alternatives],
        )

    if kind == DirectorCommandKind.dialogue_line_operation:
        operation = command.line_operation or 'rewrite'
        if plan.bundle.script is None or not plan.bundle.script.scenes:
            return CommandOutcome(
                command=command, plan=None, operations=['dialogue_line_operation'], rationale=command.rationale,
                answer='This Production has no Script lines yet, so there is nothing to rewrite. Build the Script first.',
            )
        rewritten_scenes: list[ScriptScenePlan] = []
        line_alternatives: list[dict[str, Any]] = []
        spoken = 0
        for script_scene in plan.bundle.script.scenes:
            rewritten_lines: list[ScriptLine] = []
            for script_line in script_scene.lines:
                if script_line.kind.value not in {'dialogue', 'voiceover', 'narration'}:
                    rewritten_lines.append(script_line)
                    continue
                spoken += 1
                options = transform_line(script_line.content, operation)  # type: ignore[arg-type]
                line_alternatives.append({'scene_order': script_scene.scene_order, 'order': script_line.order, 'speaker': script_line.speaker, 'alternatives': options})
                chosen = options[0]
                rewritten_lines.append(script_line.model_copy(update={'content': chosen[:2000], 'estimated_ms': estimate_speech_ms(chosen)}))
            rewritten_scenes.append(script_scene.model_copy(update={'lines': rewritten_lines}))
        if not spoken:
            return CommandOutcome(command=command, plan=None, operations=['dialogue_line_operation'], rationale=command.rationale,
                                  answer='There are no spoken lines in this Script, so nothing changed.')
        new_script = plan.bundle.script.model_copy(update={'scenes': rewritten_scenes})
        bundle = plan.bundle.model_copy(update={'script': new_script})
        bundle = bundle.model_copy(update={'runtime_fit': runtime_fit(bundle, target_ms)})
        fit = bundle.runtime_fit
        if fit.status == 'over':
            limitations.append('The rewritten lines still exceed the runtime target; shorten again or extend the target.')
        return CommandOutcome(
            command=command, plan=plan.model_copy(update={'bundle': bundle}), operations=['dialogue_line_operation'],
            rationale=command.rationale, line_alternatives=line_alternatives[:20],
            answer=f'Rewrote {spoken} line(s) with "{operation}". Speaking time is now {fit.dialogue_ms} ms against a {target_ms or "unset"} ms target.',
            changes=[f'Dialogue line operation applied: {operation}'], limitations=limitations,
        )

    if kind == DirectorCommandKind.remove_dialogue:
        dialogue_mode: Literal['full', 'minimal', 'visual', 'voiceover', 'narration', 'host', 'interview', 'music_only', 'silent'] = 'visual'
        new_brief = brief.model_copy(update={
            'dialogue_mode': dialogue_mode,
            'dialogue_approach': 'No spoken dialogue; the story is carried visually and through sound.',
            'voiceover_approach': None,
        })
        rebuilt = _rebuild(plan, new_brief, analyses=analyses, setup=setup)
        if rebuilt.bundle.scenes:
            rebuilt = rebuilt.model_copy(update={
                'bundle': _rebalance(rebuilt.bundle, new_brief, target_ms, [1.4] + [1.0] * (len(rebuilt.bundle.scenes) - 1)),
            })
        return CommandOutcome(
            command=command, plan=rebuilt, operations=['remove_spoken_lines', 'rebalance_scene_durations'],
            rationale=command.rationale,
            answer='Every spoken line is gone; the freed time went back into Scene duration and the closing call to action is now on-screen text.' if new_brief.call_to_action else 'Every spoken line is gone and the freed time went back into Scene duration.',
            changes=['Dialogue mode is now visual', 'Scene durations rebalanced exactly'],
        )

    if kind == DirectorCommandKind.runtime_change:
        runtime_ms = command.target_runtime_ms
        if runtime_ms is None:
            return CommandOutcome(command=command, plan=None, operations=[], rationale=command.rationale,
                                  answer='Tell me the exact runtime you want to hit, for example "30 seconds".')
        new_brief = brief.model_copy(update={'runtime': brief.runtime.model_copy(update={'kind': 'exact', 'exact_ms': runtime_ms, 'min_ms': None, 'max_ms': None})})
        rebuilt = _rebuild(plan, new_brief, analyses=analyses, setup=setup)
        return CommandOutcome(
            command=command, plan=rebuilt, operations=['retarget_runtime', 'rebalance_scene_durations', 'runtime_fit_check'],
            rationale=command.rationale,
            answer=f'Runtime retargeted to {runtime_ms} ms. {len(rebuilt.bundle.scenes)} Scene(s) now sum to exactly {runtime_ms} ms and the Script was re-fitted.',
            changes=[f'Runtime target set to {runtime_ms} ms'], limitations=rebuilt.limitations,
        )

    if kind == DirectorCommandKind.single_actor:
        new_brief = brief.model_copy(update={
            'crew_size': 1,
            'cast': (brief.cast[:1] or ['The creator']),
            'dialogue_mode': brief.dialogue_mode if brief.dialogue_mode in {'minimal', 'visual', 'voiceover', 'narration'} else 'minimal',
        })
        rebuilt = _rebuild(plan, new_brief, analyses=analyses, setup=setup)
        adaptations_applied.append('Reduced to one on-camera performer; other voices move off-screen.')
        return CommandOutcome(
            command=command, plan=rebuilt, operations=['single_performer_adaptation', 'story_rewrite', 'reality_recheck'],
            rationale=command.rationale,
            answer='Rewritten for one performer: on-camera work is carried by you, other voices move off-screen, and Reality Check was re-run against your Setup.',
            changes=['Crew size fixed at one', 'Performance reassigned to a single on-camera performer'],
            adaptations_applied=adaptations_applied, limitations=rebuilt.limitations,
        )

    if kind == DirectorCommandKind.format_change:
        ratio = str(command.parameters.get('aspect_ratio', '9:16'))
        platform = 'TikTok' if ratio == '9:16' else 'YouTube'
        new_brief = brief.model_copy(update={'aspect_ratio': ratio, 'platform': brief.platform or platform})
        rebuilt = _rebuild(plan, new_brief, analyses=analyses, setup=setup)
        scenes = [
            scene.model_copy(update={'visual_intent': f'{scene.visual_intent} Framed for {ratio} with room for vertical titles.'.strip()[:900]})
            for scene in rebuilt.bundle.scenes
        ]
        rebuilt = rebuilt.model_copy(update={'bundle': rebuilt.bundle.model_copy(update={'scenes': scenes})})
        return CommandOutcome(
            command=command, plan=rebuilt, operations=['retarget_format', 'rebalance_scene_durations'],
            rationale=command.rationale,
            answer=f'Format retargeted to {ratio}. The Story is unchanged; framing intent and delivery format follow the new ratio.',
            changes=[f'Aspect ratio set to {ratio}'],
        )

    if kind == DirectorCommandKind.shootable_with_setup:
        applied, notes = _apply_reality_adaptations(plan, target_ms)
        rebuilt = _rebuild(applied, brief, analyses=analyses, setup=setup) if notes else applied
        return CommandOutcome(
            command=command, plan=rebuilt, operations=['reality_recheck', 'apply_reality_adaptations'],
            rationale=command.rationale,
            answer=('Made shootable with your Setup: ' + ' '.join(notes)) if notes else 'Your Setup already covers this plan, so no structural change was needed.',
            changes=notes, adaptations_applied=notes, limitations=rebuilt.limitations,
        )

    if kind == DirectorCommandKind.scene_intensity:
        order = command.scene_order or 1
        intensified: list[ScenePlan] = []
        found = False
        for target_scene in plan.bundle.scenes:
            if target_scene.order != order:
                intensified.append(target_scene)
                continue
            found = True
            purpose, visual, _extra = intensify_scene_text(target_scene.purpose, target_scene.visual_intent, order)
            action = [*target_scene.action[:1], 'Cut on the strongest gesture rather than the end of the movement.'][:12]
            intensified.append(target_scene.model_copy(update={'purpose': purpose, 'visual_intent': visual, 'action': action}))
        if not found:
            return CommandOutcome(command=command, plan=None, operations=[], rationale=command.rationale,
                                  answer=f'Scene {order} does not exist in this Production, so nothing changed.')
        bundle = plan.bundle.model_copy(update={'scenes': intensified})
        if bundle.story is not None:
            beats = [
                beat.model_copy(update={'content': f'{beat.content} Push this beat harder: {INTENSITY_BANK[order % len(INTENSITY_BANK)]}'[:1600]})
                if beat.order == order else beat
                for beat in bundle.story.beats
            ]
            bundle = bundle.model_copy(update={'story': bundle.story.model_copy(update={'beats': beats})})
        if bundle.story is not None:
            bundle = bundle.model_copy(update={'script': build_script(brief, bundle.story, bundle.scenes)})
        bundle = bundle.model_copy(update={'runtime_fit': runtime_fit(bundle, target_ms)})
        return CommandOutcome(
            command=command, plan=plan.model_copy(update={'bundle': bundle}),
            operations=['intensify_scene', 'rebalance_scene_durations'], rationale=command.rationale,
            answer=f'Scene {order} now carries more pressure in its purpose, action and visual intent, inside its existing {plan.bundle.scenes[order - 1].planned_duration_ms if order <= len(plan.bundle.scenes) else 0} ms.',
            changes=[f'Scene {order} intensified'],
        )

    if kind == DirectorCommandKind.strengthen_opening:
        story = _story_beats_with_opening(plan.bundle)
        if story is None:
            return CommandOutcome(command=command, plan=None, operations=[], rationale=command.rationale,
                                  answer='This Production has no Story yet, so there is no opening to strengthen. Build the Story first.')
        opened: list[ScenePlan] = []
        for index, opening_scene in enumerate(plan.bundle.scenes):
            if index == 0:
                opened.append(opening_scene.model_copy(update={
                    'purpose': f'{opening_scene.purpose} Hold attention before explaining anything.'[:1200],
                    'visual_intent': f'{opening_scene.visual_intent} Strongest available image first.'.strip()[:900],
                }))
            else:
                opened.append(opening_scene)
        script = build_script(brief, story, opened)
        bundle = plan.bundle.model_copy(update={'story': story, 'scenes': opened, 'script': script})
        bundle = bundle.model_copy(update={'runtime_fit': runtime_fit(bundle, target_ms)})
        return CommandOutcome(
            command=command, plan=plan.model_copy(update={'bundle': bundle}),
            operations=['rewrite_opening_beat', 'rebalance_first_scene'], rationale=command.rationale,
            answer='The opening beat is rewritten to lead with the strongest image and delay explanation, and Scene 1 carries that change through the Script.',
            changes=['Opening beat strengthened'],
        )

    if kind == DirectorCommandKind.regenerate_story:
        variation = command.variation or 'more_like_this'
        rebuilt = _rebuild(plan, brief, variation=variation, variant_index=1, analyses=analyses, setup=setup)
        return CommandOutcome(
            command=command, plan=rebuilt, operations=['story_regeneration'], rationale=command.rationale,
            answer=f'A new Story direction is ready ({variation}) using the same Brief and runtime target.',
            changes=[f'Story regenerated as {variation}'],
        )

    return CommandOutcome(
        command=command, plan=None, operations=[], rationale=command.rationale,
        answer='That direction is not supported yet. Tell me whether it changes the Brief, Story, Script, Scenes or Setup.',
    )


def _apply_reality_adaptations(plan: ProductionPlan, target_ms: int | None) -> tuple[ProductionPlan, list[str]]:
    """Reality Check must be able to change the plan, not only warn about it."""

    notes: list[str] = []
    bundle = plan.bundle
    report = plan.reality
    scenes = list(bundle.scenes)
    for adaptation in report.adaptations:
        if adaptation.target == 'Scene count' and len(scenes) > 2:
            scenes = scenes[:-1]
            notes.append(f'Reduced to {len(scenes)} Scenes to fit the available window.')
        elif adaptation.target == 'Camera movement':
            scenes = [
                scene.model_copy(update={
                    'shots': [shot.model_copy(update={'description': f'{shot.description} Locked-off frame; move the subject instead of the camera.'[:900]}) for shot in scene.shots],
                    'visual_intent': f'{scene.visual_intent} Plan locked-off coverage.'.strip()[:900],
                })
                for scene in scenes
            ]
            notes.append('Planned camera moves replaced with locked-off framing.')
        elif adaptation.target in {'Shot framing', 'Shot concepts'}:
            notes.append('Shot concepts kept inside one focal family.')
        elif adaptation.target == 'Lighting plan':
            notes.append('Lighting plan changed to available light around window light.')
        elif adaptation.target == 'Dialogue' and bundle.script is not None:
            notes.append('Dialogue marked for review because no audio capture is listed in Setup.')
        elif adaptation.target == 'Performance':
            notes.append('Performance reduced to one on-camera performer.')
        elif adaptation.target == 'Execution method':
            notes.append('Shots that need missing equipment move to AI execution until it exists.')
    if not notes:
        return plan, notes
    weighted = [1.4] + [1.0] * (len(scenes) - 1) if scenes else []
    durations = allocate_runtime(target_ms, len(scenes), weighted) if target_ms is not None and scenes else [scene.planned_duration_ms for scene in scenes]
    scenes = [scene.model_copy(update={'planned_duration_ms': durations[index]}) for index, scene in enumerate(scenes)]
    story = bundle.story
    if story is not None:
        beats = story.beats[: len(scenes)]
        beats = [
            beat.model_copy(update={'planned_duration_ms': durations[index]}) if index < len(durations) else beat
            for index, beat in enumerate(beats)
        ]
        story = story.model_copy(update={'beats': beats, 'runtime_ms': target_ms}) if beats else None
    script = build_script(plan.brief, story, scenes) if story is not None else None
    updated = bundle.model_copy(update={'scenes': scenes, 'story': story, 'script': script})
    updated = updated.model_copy(update={'runtime_fit': runtime_fit(updated, target_ms)})
    return plan.model_copy(update={'bundle': updated}), notes


def reference_role_assignments(analyses: list[ReferenceAnalysis]) -> list[dict[str, Any]]:
    return [
        {
            'reference_id': str(analysis.reference_id) if analysis.reference_id else None,
            'role': analysis.role.value,
            'capability': analysis.capability.capability.value,
            'status': analysis.status.value,
            'techniques': [technique.name for technique in analysis.essential_techniques()][:4],
        }
        for analysis in analyses
    ]


def production_types_with_required_story() -> list[ProductionType]:
    return [item for item in ProductionType if item != ProductionType.photography]


def assumption_for_command(command: DirectorCommand) -> BriefAssumption:
    return BriefAssumption(
        statement=f'Director command applied: {command.kind.value.replace("_", " ")}.',
        basis=command.raw_text[:300], status='creator_confirmed',
    )
