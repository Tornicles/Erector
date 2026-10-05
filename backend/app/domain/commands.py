from __future__ import annotations

import re
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CommandModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class DirectorCommandKind(StrEnum):
    strengthen_opening = 'strengthen_opening'
    runtime_change = 'runtime_change'
    remove_dialogue = 'remove_dialogue'
    single_actor = 'single_actor'
    reference_role = 'reference_role'
    reference_causal = 'reference_causal'
    story_alternatives = 'story_alternatives'
    format_change = 'format_change'
    shootable_with_setup = 'shootable_with_setup'
    scene_intensity = 'scene_intensity'
    dialogue_line_operation = 'dialogue_line_operation'
    regenerate_story = 'regenerate_story'
    unresolved = 'unresolved'


class CommandScope(StrEnum):
    production = 'production'
    brief = 'brief'
    reference = 'reference'
    story = 'story'
    script = 'script'
    dialogue = 'dialogue'
    scene = 'scene'
    reality = 'reality'


class DirectorCommand(CommandModel):
    kind: DirectorCommandKind
    raw_text: str = Field(min_length=1, max_length=1000)
    scope: CommandScope
    rationale: str = Field(min_length=1, max_length=600)
    confidence: Literal['high', 'medium', 'low'] = 'medium'
    signals: list[str] = Field(default_factory=list, max_length=12)
    parameters: dict[str, Any] = Field(default_factory=dict)
    scene_order: int | None = Field(default=None, ge=1, le=200)
    reference_index: int | None = Field(default=None, ge=0, le=12)
    reference_role: str | None = Field(default=None, max_length=40)
    target_runtime_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    variation: str | None = Field(default=None, max_length=40)
    line_operation: str | None = Field(default=None, max_length=40)
    producer: Literal['deterministic', 'model'] = 'deterministic'
    operations: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode='after')
    def declares_effects(self) -> 'DirectorCommand':
        if self.kind == DirectorCommandKind.runtime_change and self.target_runtime_ms is None:
            raise ValueError('A runtime command needs a target runtime.')
        return self


SIGNALS: dict[DirectorCommandKind, tuple[tuple[str, float], ...]] = {
    DirectorCommandKind.strengthen_opening: (
        (r'\b(?:opening|hook|start|first (?:shot|scene|seconds?)|intro)\b', 3.0),
        (r'\b(stronger|punchier|bolder|harder|sharper|more attention)\b', 2.0),
        (r'\bmake\b', 0.5),
    ),
    DirectorCommandKind.runtime_change: (
        (r'\b(?:shorten|trim|reduce|longer|extend|stretch|fit (?:it )?(?:in|into)|cut (?:it )?(?:to|down))\b', 3.0),
        (r'\b\d+(?:\.\d+)?[\s-]*(?:seconds?|secs?|minutes?|mins?)\b', 2.5),
        (r'\b(?:runtime|length|duration|target)\b', 1.5),
    ),
    DirectorCommandKind.remove_dialogue: (
        (r'\b(?:remove|cut|delete|drop|kill|strip|lose)\b', 2.0),
        (r'\b(?:all )?(?:the )?dialogue\b', 2.5),
        (r'\b(?:lines?|speech|talking|voiceover|vo)\b', 1.0),
        (r'\b(?:no|without) (?:dialogue|speech|talking)\b', 3.0),
    ),
    DirectorCommandKind.single_actor: (
        (r'\b(?:one|1|single|a single)\s+(?:actor|performer|person|subject|talent)\b', 3.0),
        (r'\b(?:solo|alone|by myself|myself|one-person|one person)\b', 2.5),
        (r'\b(?:possible|make it|make this)\b', 0.5),
    ),
    DirectorCommandKind.reference_role: (
        (r'\b(?:only|just|use (?:this|it))\b', 1.5),
        (r'\bfor (?:the )?(camera|lighting|pacing|colour|color|edit|sound|style|composition|story|character|product|environment)\b', 3.0),
        (r'\b(?:style|look|grade)\b', 0.8),
        (r'\b(?:reference|image|video|clip)\b', 0.6),
        (r'\bkeep\b', 1.0),
    ),
    DirectorCommandKind.reference_causal: (
        (r'\bwhy\b', 2.5),
        (r'\b(?:feel|feels|work|works|effective|expensive|premium|cheap)\b', 2.0),
        (r'\bhow (?:did|does|do)\b', 1.5),
        (r'\b(?:this|that) (?:commercial|ad|reference|video|image|shot)\b', 1.0),
    ),
    DirectorCommandKind.story_alternatives: (
        (r'\b(?:three|3|several|two|2|four|4)\b', 1.5),
        (r'\b(?:endings?|alternatives?|options?|versions?|another|variants?)\b', 3.0),
        (r'\b(?:give me|show me|more like this|darker|funnier|simpler|more emotional|more commercial|more practical)\b', 2.0),
    ),
    DirectorCommandKind.format_change: (
        (r'\b(?:vertical|horizontal|square|portrait|landscape|9:16|16:9|1:1|4:5)\b', 3.0),
        (r'\b(?:tiktok|reels?|shorts?|instagram)\b', 2.0),
        (r'\b(?:turn|convert|make)\b', 0.5),
    ),
    DirectorCommandKind.shootable_with_setup: (
        (r'\b(?:shootable|feasible|achievable|realistic|possible)\b', 2.5),
        (r'\b(?:my setup|my gear|my kit|with what i (?:have|own)|only have|i own)\b', 3.0),
        (r'\byour\b', 0.3),
    ),
    DirectorCommandKind.scene_intensity: (
        (r'\bscene\s*(\d+)\b', 3.0),
        (r'\b(?:more intense|stronger|faster|slower|tighter|tenser|punchier|quieter)\b', 2.5),
    ),
    DirectorCommandKind.dialogue_line_operation: (
        (r'\b(?:line|dialogue|vo|voiceover|speech)\b', 2.0),
        (r'\b(?:rewrite|shorter|sharpen|less expository|more natural|more humorous|funnier|alternatives?)\b', 2.5),
        (r'\b(?:this|that)\b', 0.3),
    ),
    DirectorCommandKind.regenerate_story: (
        (r'\b(?:new|different|another|start over|regenerate|change) (?:the )?(?:story|narrative|approach)\b', 3.0),
        (r'\bkeep\b', 0.5),
    ),
}

SCOPE_BY_KIND: dict[DirectorCommandKind, CommandScope] = {
    DirectorCommandKind.strengthen_opening: CommandScope.story,
    DirectorCommandKind.runtime_change: CommandScope.production,
    DirectorCommandKind.remove_dialogue: CommandScope.script,
    DirectorCommandKind.single_actor: CommandScope.production,
    DirectorCommandKind.reference_role: CommandScope.reference,
    DirectorCommandKind.reference_causal: CommandScope.reference,
    DirectorCommandKind.story_alternatives: CommandScope.story,
    DirectorCommandKind.format_change: CommandScope.production,
    DirectorCommandKind.shootable_with_setup: CommandScope.reality,
    DirectorCommandKind.scene_intensity: CommandScope.scene,
    DirectorCommandKind.dialogue_line_operation: CommandScope.dialogue,
    DirectorCommandKind.regenerate_story: CommandScope.story,
    DirectorCommandKind.unresolved: CommandScope.production,
}

ROLE_ALIASES = {
    'camera': 'camera', 'light': 'lighting', 'lighting': 'lighting', 'pace': 'pacing', 'pacing': 'pacing',
    'story': 'story', 'character': 'character', 'product': 'product', 'color': 'color', 'colour': 'color',
    'edit': 'edit', 'sound': 'sound', 'style': 'style', 'composition': 'composition', 'environment': 'environment',
}

VARIATION_ALIASES = {
    'darker': 'darker', 'funnier': 'funnier', 'simpler': 'simpler', 'more emotional': 'more_emotional',
    'more commercial': 'more_commercial', 'more practical': 'more_practical', 'more like this': 'more_like_this',
}

LINE_OPERATIONS = {
    'shorter': 'shorter', 'sharpen': 'more_intense', 'less expository': 'less_expository',
    'more natural': 'more_natural', 'more humorous': 'more_humorous', 'funnier': 'more_humorous',
    'rewrite': 'rewrite', 'alternatives': 'three_alternatives',
}

RUNTIME_PATTERN = re.compile(r'(?<!\d)(\d+(?:\.\d+)?)[\s-]*(minutes?|mins?|min|seconds?|secs?|sec)\b', re.I)


def parse_runtime_ms(text: str) -> int | None:
    match = RUNTIME_PATTERN.search(text)
    if not match:
        return None
    amount = float(match.group(1))
    unit = match.group(2).lower()
    milliseconds = round(amount * (60000 if unit.startswith('min') else 1000))
    return milliseconds if 0 <= milliseconds <= 9007199254740991 else None


def route_command(text: str, *, reference_count: int = 0) -> DirectorCommand:
    """Semantic routing by weighted signal, not a single phrase match."""

    if not text.strip():
        raise ValueError('Describe the direction you want.')
    lowered = text.lower()
    scores: dict[DirectorCommandKind, float] = {}
    matched: dict[DirectorCommandKind, list[str]] = {}
    for kind, patterns in SIGNALS.items():
        total = 0.0
        hits: list[str] = []
        for pattern, weight in patterns:
            if re.search(pattern, lowered):
                total += weight
                hits.append(pattern)
        if total:
            scores[kind] = total
            matched[kind] = hits
    runtime_ms = parse_runtime_ms(lowered)
    if runtime_ms is not None and DirectorCommandKind.runtime_change in scores:
        scores[DirectorCommandKind.runtime_change] += 2.0
    scene_match = re.search(r'\bscene\s*(\d+)\b', lowered)
    if scene_match:
        scores[DirectorCommandKind.scene_intensity] = scores.get(DirectorCommandKind.scene_intensity, 0.0) + 1.5
    if not scores:
        return DirectorCommand(
            kind=DirectorCommandKind.unresolved, raw_text=text[:1000], scope=CommandScope.production,
            rationale='I could not map that direction to a Production operation yet. Tell me which part of the Production it changes: Story, Script, Scenes, References or Setup.',
            confidence='low', signals=[],
        )
    kind = max(sorted(scores, key=lambda item: item.value), key=lambda item: scores[item])
    signals = matched.get(kind, [])
    parameters: dict[str, Any] = {}
    scene_order = int(scene_match.group(1)) if scene_match else None
    reference_index = 0 if reference_count else None
    reference_role: str | None = None
    for alias, role in ROLE_ALIASES.items():
        if re.search(rf'\bfor (?:the )?{alias}\b|\b{alias} only\b|\b{alias} style\b', lowered):
            reference_role = role
            break
    variation: str | None = None
    for alias, name in VARIATION_ALIASES.items():
        if alias in lowered:
            variation = name
            break
    line_operation: str | None = None
    for alias, name in LINE_OPERATIONS.items():
        if alias in lowered:
            line_operation = name
            break
    operations: list[str] = []
    rationale = ''
    if kind == DirectorCommandKind.strengthen_opening:
        operations = ['rewrite_opening_beat', 'rebalance_first_scene']
        rationale = 'I will rewrite the opening beat of the Story and give Scene 1 the time it needs, without touching the later beats.'
    elif kind == DirectorCommandKind.runtime_change:
        if runtime_ms is None:
            runtime_ms = parse_runtime_ms(text)
        parameters['target_runtime_ms'] = runtime_ms
        operations = ['retarget_runtime', 'rebalance_scene_durations', 'runtime_fit_check']
        rationale = f'I will retarget the Production to {runtime_ms} ms, rebalance Scene durations to sum exactly, and re-check dialogue fit.' if runtime_ms else 'Tell me the exact runtime you want to hit.'
    elif kind == DirectorCommandKind.remove_dialogue:
        operations = ['remove_spoken_lines', 'rebalance_scene_durations']
        rationale = 'I will remove every spoken line, keep the remaining action and reactions, and rebalance the freed time.'
    elif kind == DirectorCommandKind.single_actor:
        operations = ['single_performer_adaptation', 'story_rewrite', 'reality_recheck']
        rationale = 'I will rewrite performance so one person can carry it, move other voices off-screen, and re-run Reality Check against your Setup.'
    elif kind == DirectorCommandKind.reference_role:
        operations = ['assign_reference_role']
        rationale = f'I will keep this Reference as {reference_role or "the stated role"} only and leave the rest of the direction to TONDE.'
    elif kind == DirectorCommandKind.reference_causal:
        operations = ['causal_explanation']
        rationale = 'I will answer from the observed evidence and extracted techniques in that Reference analysis, and mark anything I cannot verify.'
    elif kind == DirectorCommandKind.story_alternatives:
        operations = ['story_alternatives']
        parameters['count'] = 3
        rationale = 'I will produce alternative Story directions without replacing the Story you already selected.'
    elif kind == DirectorCommandKind.format_change:
        target = '9:16' if re.search(r'vertical|9:16|tiktok|reels?|shorts?', lowered) else '16:9'
        parameters['aspect_ratio'] = target
        operations = ['retarget_format', 'rebalance_scene_durations']
        rationale = f'I will retarget the Production to {target}, keep the Story, and adjust framing intent and timing.'
    elif kind == DirectorCommandKind.shootable_with_setup:
        operations = ['reality_recheck', 'apply_reality_adaptations']
        rationale = 'I will compare the plan with your listed Setup and propose the changes that make it shootable, using substitutes rather than new purchases.'
    elif kind == DirectorCommandKind.scene_intensity:
        operations = ['intensify_scene', 'rebalance_scene_durations']
        parameters['scene_order'] = scene_order or 1
        rationale = f'I will intensify Scene {scene_order or 1} within the runtime it already has, and leave other Scenes alone.'
    elif kind == DirectorCommandKind.dialogue_line_operation:
        operations = ['dialogue_line_operation']
        parameters['line_operation'] = line_operation or 'rewrite'
        rationale = f'I will apply "{line_operation or "rewrite"}" to the affected lines and re-check speaking time against the runtime.'
    else:
        operations = ['story_regeneration']
        rationale = 'I will write a new Story direction from the same Brief, keeping the Production, Scenes framework and runtime target.'
    if 'keep' in lowered and reference_role and 'assign_reference_role' not in operations:
        operations.append('assign_reference_role')
        rationale = f'{rationale} The Reference stays pinned to {reference_role} only.'
    return DirectorCommand(
        kind=kind, raw_text=text[:1000], scope=SCOPE_BY_KIND[kind], rationale=rationale,
        confidence='high' if scores[kind] >= 4 else 'medium', signals=signals, parameters=parameters,
        scene_order=scene_order, reference_index=reference_index if kind == DirectorCommandKind.reference_role else None,
        reference_role=reference_role, target_runtime_ms=runtime_ms if kind == DirectorCommandKind.runtime_change else None,
        variation=variation, line_operation=line_operation, operations=operations,
    )
