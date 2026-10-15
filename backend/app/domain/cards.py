"""The Production Card content contract: planning rules, direction fields, validation.

A Card is a canonical Scene. This module owns the *contract* the Card system is held to, so the
same rules are enforced wherever a Card is planned, written, validated or read:

    planning        a Production is planned into Card shells before any Card is written, and the
                    number of Cards is bounded by the finished runtime (1 minute -> at most 3,
                    10 minutes -> at most 25). Cards are normally 20+ seconds of finished
                    production; camera cuts, inserts and generator clip limits never create a Card.
    direction       the Card-level fields, with the word-length contract from the product rules.
    validation      length, emptiness, vague filler, cross-section repetition, contradictions and
                    missing-for-READY. Word count is a guardrail; operational usefulness is the gate.
    provenance      every material value knows where it came from, and a creator-locked fact or an
                    approved Result outranks anything TONDE decided or inferred.
    impact          which Card/Shot fields a change is allowed to touch, and which are protected.

Nothing here talks to a provider or a database: it is deterministic, testable product law. Real
reasoning stays server-side in the Director APIs; this module only decides what is allowed to be
called a Card, READY, or a consequence of a change.
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from pydantic import Field

from app.domain.director import DirectorModel

CardMode = Literal['REAL', 'AI', 'HYBRID']
CardStatus = Literal['DRAFT', 'BUILDING', 'NEEDS YOU', 'READY', 'RESULT READY', 'COMPLETE']
CARD_MODES: tuple[str, ...] = ('REAL', 'AI', 'HYBRID')
CARD_STATUSES: tuple[str, ...] = ('DRAFT', 'BUILDING', 'NEEDS YOU', 'READY', 'RESULT READY', 'COMPLETE')

#: The canonical Card-level direction fields, in the order the expanded Card presents them.
CARD_DIRECTION_FIELDS: tuple[str, ...] = (
    'title', 'summary', 'what_happens', 'director_direction', 'audience_feeling',
    'subject_direction', 'camera_direction', 'look_direction', 'audio_direction',
    'location_direction', 'continuity', 'resources', 'next_action',
)
#: Structural Card fields: they exist before direction is written (stage 1 of progressive population).
CARD_STRUCTURE_FIELDS: tuple[str, ...] = ('title', 'purpose', 'starts_from', 'ends_with', 'story_change')

#: Card duration guidance from the product rules: 20+ seconds is the normal floor.
MIN_CARD_DURATION_MS = 20_000
MAX_CARDS = 25
CARDS_PER_MINUTE = 2.5
MAX_CARDS_AT_ONE_MINUTE = 3


class FieldSpec(DirectorModel):
    """One field's word-length contract and whether READY requires it."""

    name: str
    target_min: int
    target_max: int
    hard_max: int
    required_for_ready: bool = True


CARD_FIELD_SPECS: dict[str, FieldSpec] = {
    'title': FieldSpec(name='title', target_min=2, target_max=6, hard_max=8),
    'summary': FieldSpec(name='summary', target_min=35, target_max=60, hard_max=80),
    'what_happens': FieldSpec(name='what_happens', target_min=70, target_max=120, hard_max=150),
    'director_direction': FieldSpec(name='director_direction', target_min=50, target_max=90, hard_max=120),
    'audience_feeling': FieldSpec(name='audience_feeling', target_min=10, target_max=20, hard_max=30),
    'subject_direction': FieldSpec(name='subject_direction', target_min=80, target_max=140, hard_max=180),
    'camera_direction': FieldSpec(name='camera_direction', target_min=80, target_max=140, hard_max=180),
    'look_direction': FieldSpec(name='look_direction', target_min=60, target_max=100, hard_max=130),
    'audio_direction': FieldSpec(name='audio_direction', target_min=50, target_max=90, hard_max=120),
    'location_direction': FieldSpec(name='location_direction', target_min=40, target_max=70, hard_max=100),
    'continuity': FieldSpec(name='continuity', target_min=40, target_max=80, hard_max=100),
    'resources': FieldSpec(name='resources', target_min=20, target_max=50, hard_max=70),
    'next_action': FieldSpec(name='next_action', target_min=8, target_max=20, hard_max=25),
}

SHOT_FIELD_SPECS: dict[str, FieldSpec] = {
    'purpose': FieldSpec(name='purpose', target_min=15, target_max=30, hard_max=40),
    'start_state': FieldSpec(name='start_state', target_min=20, target_max=40, hard_max=60),
    'action': FieldSpec(name='action', target_min=60, target_max=110, hard_max=140),
    'timing': FieldSpec(name='timing', target_min=10, target_max=40, hard_max=70, required_for_ready=False),
    'camera': FieldSpec(name='camera', target_min=50, target_max=90, hard_max=120),
    'performance': FieldSpec(name='performance', target_min=35, target_max=70, hard_max=90),
    'lighting': FieldSpec(name='lighting', target_min=25, target_max=50, hard_max=70),
    'audio': FieldSpec(name='audio', target_min=25, target_max=50, hard_max=70),
    'takes': FieldSpec(name='takes', target_min=20, target_max=40, hard_max=60),
    'success_criteria': FieldSpec(name='success_criteria', target_min=30, target_max=60, hard_max=80),
    'retake_if': FieldSpec(name='retake_if', target_min=20, target_max=50, hard_max=70),
}

#: The AI Generation Unit is a Shot plus generation locks, and its prompt is itself a deliverable.
AI_UNIT_FIELD_SPECS: dict[str, FieldSpec] = {
    'purpose': FieldSpec(name='purpose', target_min=15, target_max=30, hard_max=40),
    'start_frame': FieldSpec(name='start_frame', target_min=20, target_max=40, hard_max=60),
    'end_frame': FieldSpec(name='end_frame', target_min=20, target_max=40, hard_max=60),
    'subject_action': FieldSpec(name='subject_action', target_min=40, target_max=80, hard_max=110),
    'camera_motion': FieldSpec(name='camera_motion', target_min=40, target_max=80, hard_max=110),
    'environment': FieldSpec(name='environment', target_min=35, target_max=70, hard_max=100),
    'character_lock': FieldSpec(name='character_lock', target_min=30, target_max=60, hard_max=90),
    'world_lock': FieldSpec(name='world_lock', target_min=30, target_max=60, hard_max=90),
    'avoid': FieldSpec(name='avoid', target_min=25, target_max=60, hard_max=90),
    'expected_result': FieldSpec(name='expected_result', target_min=30, target_max=60, hard_max=90),
    'prompt': FieldSpec(name='prompt', target_min=150, target_max=300, hard_max=400),
}

#: Language that describes an aspiration instead of a production decision.
VAGUE_PHRASES: tuple[str, ...] = (
    'make it cinematic', 'cinematic look', 'cinematic feel', 'immersive', 'compelling',
    'authentic emotion', 'beautiful lighting', 'moody', 'epic', 'stunning', 'dynamic energy',
    'capture the emotion', 'artistic', 'make it pop', 'film-like', 'emotionally resonant',
    'visually striking', 'engaging', 'atmospheric', 'professional quality',
)
#: Tokens that show a sentence tells the creator something they can actually do.
CONCRETE_TERMS: tuple[str, ...] = (
    'frame', 'framing', 'static', 'locked', 'lens', 'camera', 'phone', 'handheld', 'tripod',
    'movement', 'push', 'pan', 'tilt', 'track', 'dolly', 'zoom', 'gimbal', 'eye level', 'height',
    'hold', 'steps', 'step', 'seconds', 'sec', 'minute', 'close', 'wide', 'medium', 'insert',
    'light', 'key', 'practical', 'contrast', 'palette', 'exposure', 'mic', 'lavalier', 'ambience',
    'tone', 'footstep', 'zip', 'dialogue', 'line', 'walk', 'enter', 'exit', 'turn', 'sit', 'stand',
    'reach', 'open', 'door', 'shoulder', 'jacket', 'hair', 'wardrobe', 'prop', 'location', 'street',
    'room', 'corridor', 'resolve', 'shot', 'take', 'aspect', '4k', '24', '30', '60', '1x', '2x',
)
MOTION_TERMS: tuple[str, ...] = ('handheld', 'push', 'pan', 'tilt', 'track', 'tracking', 'dolly',
    'zoom', 'gimbal', 'steadicam', 'whip', 'swish', 'crane', 'follow')
STATIC_TERMS: tuple[str, ...] = ('static', 'locked', 'lock off', 'no movement', 'do not move')

FieldSeverity = Literal['blocking', 'review', 'warning']


class FieldFinding(DirectorModel):
    """One validation result, named by field and code, with the reason in plain language."""

    field: str
    code: str
    severity: FieldSeverity
    detail: str


class CardValidationReport(DirectorModel):
    """The validation of one Card's direction (and optionally its Shots)."""

    card_id: str = ''
    ready: bool = False
    missing: list[str] = []
    findings: list[FieldFinding] = []
    word_total: int = 0

    def blocking(self) -> list[FieldFinding]:
        return [item for item in self.findings if item.severity == 'blocking']


def word_count(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (list, tuple)):
        return sum(word_count(item) for item in value)
    return len([token for token in re.split(r'\s+', str(value).strip()) if token])


def _concreteness(text: str) -> int:
    lowered = f' {text.lower()} '
    signals = sum(1 for term in CONCRETE_TERMS if term in lowered)
    digits = len(re.findall(r'\d', text))
    return signals + (1 if digits else 0)


def vague_phrases(text: str) -> list[str]:
    lowered = text.lower()
    return [phrase for phrase in VAGUE_PHRASES if phrase in lowered]


def is_vague(text: str) -> bool:
    """True when a section is aspiration rather than direction.

    A single concrete instruction may legitimately use one evocative word ('grounded morning
    realism'), so this only fires when vague language is unbacked: no concrete signal, or vague
    language with almost no execution detail.
    """

    words = word_count(text)
    vague = len(vague_phrases(text))
    concrete = _concreteness(text)
    if words == 0:
        return False
    if vague >= 2 and concrete < 3:
        return True
    if vague >= 1 and concrete <= 1:
        return True
    return False


def validate_field(field: str, value: Any, *, specs: dict[str, FieldSpec] | None = None,
    check_vague: bool = True) -> list[FieldFinding]:
    """Length and usefulness of one field, against its published contract."""

    spec = (specs or CARD_FIELD_SPECS).get(field)
    if spec is None:
        return []
    text = '' if value is None else str(value).strip()
    findings: list[FieldFinding] = []
    if not text:
        if spec.required_for_ready:
            findings.append(FieldFinding(field=field, code='empty', severity='blocking',
                detail=f'{field.replace("_", " ").capitalize()} is empty; this Card cannot be READY without it.'))
        return findings
    words = word_count(text)
    if words > spec.hard_max:
        findings.append(FieldFinding(field=field, code='too_long', severity='review',
            detail=f'{field.replace("_", " ")} is {words} words; the maximum is {spec.hard_max}. '
                   f'Compress it to {spec.target_min}-{spec.target_max} without losing the direction.'))
    elif words < spec.target_min:
        findings.append(FieldFinding(field=field, code='too_short', severity='warning',
            detail=f'{field.replace("_", " ")} is {words} words; the target starts at {spec.target_min}. '
                   f'Add only what changes what the creator does.'))
    if check_vague and is_vague(text):
        findings.append(FieldFinding(field=field, code='vague', severity='review',
            detail=f'{field.replace("_", " ")} describes an aspiration rather than a decision. '
                   'Replace it with what to frame, hold, move or capture.'))
    return findings


def _shingles(text: str, size: int = 6) -> set[str]:
    tokens = [token for token in re.split(r'[^a-z0-9]+', text.lower()) if token]
    return {' '.join(tokens[index:index + size]) for index in range(max(0, len(tokens) - size + 1))}


def duplicated_sections(direction: dict[str, Any], *, size: int = 6) -> list[tuple[str, str, str]]:
    """Sections that repeat the same passage, as (field_a, field_b, repeated span)."""

    seen: dict[str, set[str]] = {}
    for field in CARD_DIRECTION_FIELDS:
        text = str(direction.get(field) or '').strip()
        if word_count(text) >= size:
            seen[field] = _shingles(text, size)
    fields = list(seen)
    duplicates: list[tuple[str, str, str]] = []
    for index, first in enumerate(fields):
        for second in fields[index + 1:]:
            shared = seen[first] & seen[second]
            if shared:
                duplicates.append((first, second, sorted(shared)[0]))
    return duplicates


def validate_card_direction(direction: dict[str, Any], *, for_ready: bool = True) -> CardValidationReport:
    """Validate one Card's full direction against the content contract."""

    findings: list[FieldFinding] = []
    missing: list[str] = []
    for field in CARD_DIRECTION_FIELDS:
        if field not in direction and for_ready:
            missing.append(field)
            findings.append(FieldFinding(field=field, code='missing', severity='blocking',
                detail=f'{field.replace("_", " ")} has not been written for this Card.'))
            continue
        findings.extend(validate_field(field, direction.get(field)))
    if for_ready:
        # Structure the Card cannot be READY without even when the prose exists.
        for field in CARD_STRUCTURE_FIELDS:
            if not str(direction.get(field) or '').strip():
                findings.append(FieldFinding(field=field, code='missing', severity='blocking',
                    detail=f'{field.replace("_", " ")} is part of the Card structure and is still empty.'))
                if field not in missing:
                    missing.append(field)
    for first, second, span in duplicated_sections(direction):
        findings.append(FieldFinding(field=f'{first}/{second}', code='duplicate', severity='review',
            detail=f'{first.replace("_", " ")} and {second.replace("_", " ")} repeat the same passage '
                   f'("{span[:60]}"). Each section has a different job; keep the repetition only where it '
                   'is operationally necessary.'))
    # Quality is the gate, not length: a section that is present but aspirational or repeated keeps
    # the Card out of READY exactly as a missing section does. Warnings stay advisory, because fewer
    # words may be the honest answer.
    needs_work = [item for item in findings if item.severity in ('blocking', 'review')]
    total = sum(word_count(direction.get(field)) for field in CARD_DIRECTION_FIELDS)
    return CardValidationReport(card_id=str(direction.get('id') or ''), ready=not needs_work,
        missing=missing[:12], findings=findings[:40], word_total=total)


def validate_shot_direction(shot: dict[str, Any], *, mode: str = 'REAL',
    for_ready: bool = True) -> list[FieldFinding]:
    """One Shot / Generation Unit: REAL execution detail, or a copy-ready AI specification."""

    specs = AI_UNIT_FIELD_SPECS if mode == 'AI' else SHOT_FIELD_SPECS
    findings: list[FieldFinding] = []
    for field in specs:
        if field == 'prompt' and mode != 'AI':
            continue
        if field not in shot:
            if for_ready:
                findings.append(FieldFinding(field=f'shot.{field}', code='missing', severity='blocking',
                    detail=f'Shot {field.replace("_", " ")} is missing; the Shot is not executable yet.'))
            continue
        findings.extend(item.model_copy(update={'field': f'shot.{field}'})
            for item in validate_field(field, shot.get(field), specs=specs,
                check_vague=mode != 'AI'))
    if mode == 'AI':
        prompt = str(shot.get('prompt') or '')
        lowered = prompt.lower()
        if prompt and 'avoid' not in lowered and not str(shot.get('avoid') or '').strip():
            findings.append(FieldFinding(field='shot.prompt', code='incomplete_prompt', severity='review',
                detail='The generation prompt carries no avoid/negative instruction, so the generator '
                       'is free to invent people, identity drift or new architecture.'))
        if prompt and (word_count(prompt) < 40 or prompt.count('.') < 2):
            findings.append(FieldFinding(field='shot.prompt', code='incomplete_prompt', severity='review',
                detail='The prompt is too thin to be copy-ready: it needs subject action, camera/motion, '
                       'environment and the locks, not a single cinematic sentence.'))
    return findings


def _side_only(text: str) -> str | None:
    match = re.search(r'\b(left|right)\b', re.sub(r'[^a-z0-9]+', ' ', text.lower()))
    return match.group(1) if match else None


def _side_of(text: str, subject: str) -> str | None:
    # Continuity keys and values are written with underscores (`maya.backpack=right_shoulder`), so
    # they are normalised before looking for a side and a subject in the same statement.
    normalized = text.replace('_', ' ').replace('-', ' ').lower()
    match = re.search(rf'\b(left|right)\b[^.]*\b{subject}\b|\b{subject}\b[^.]*\b(left|right)\b',
        normalized)
    if not match:
        return None
    return match.group(1) or match.group(2)


def contradictions(card: dict[str, Any], shots: list[dict[str, Any]], *,
    continuity: dict[str, Any] | None = None,
    target_duration_ms: int | None = None) -> list[FieldFinding]:
    """Related fields that disagree with each other, in the places that have actually bitten.

    Deliberately narrow: these are the mismatches that make a Card unshootable or a prompt untrue,
    not style opinions.
    """

    findings: list[FieldFinding] = []
    camera = str(card.get('camera_direction') or '').lower()
    static_card = any(term in camera for term in STATIC_TERMS) and not any(
        term in camera for term in MOTION_TERMS)
    if static_card:
        for shot in shots:
            plan_text = ' '.join(str(shot.get(field) or '') for field in
                ('camera', 'camera_position', 'movement', 'camera_motion')).lower()
            moving = [term for term in MOTION_TERMS if term in plan_text]
            if moving and not any(term in plan_text for term in ('no ' + moving[0], 'avoid ' + moving[0])):
                findings.append(FieldFinding(field='camera_direction',
                    code='contradiction', severity='blocking',
                    detail=f'This Card is directed as static, but a Shot asks for {moving[0]}. '
                           'Decide which one the Card actually needs.'))
                break
    for field, text in (('continuity', str(card.get('continuity') or '')),
                        ('camera_direction', str(card.get('camera_direction') or ''))):
        for subject in ('shoulder', 'hand', 'pocket', 'side'):
            side = _side_of(text, subject)
            if side is None:
                continue
            for shot in shots:
                other_text = ' '.join(str(shot.get(key) or '') for key in
                    ('prompt', 'character_lock', 'action', 'start_frame', 'end_frame'))
                other_side = _side_of(other_text, subject)
                if other_side and other_side != side:
                    findings.append(FieldFinding(field=field, code='contradiction', severity='blocking',
                        detail=f'{field.replace("_", " ")} establishes the {subject} on the {side}, but a '
                               f'Shot says {other_side}. Continuity cannot be both.'))
                    break
    if target_duration_ms:
        planned = sum(int(shot.get('duration_seconds') or 0) * 1000 for shot in shots)
        if planned > 0:
            if planned > int(target_duration_ms * 2):
                findings.append(FieldFinding(field='target_duration', code='contradiction',
                    severity='review',
                    detail=f'Planned Shot coverage is {planned // 1000}s for a '
                           f'{target_duration_ms // 1000}s Card. Raw coverage may exceed the finished '
                           'edit, but more than double means the Card is really two Cards.'))
            elif planned < int(target_duration_ms * 0.5):
                findings.append(FieldFinding(field='target_duration', code='contradiction',
                    severity='warning',
                    detail=f'Planned Shot coverage is {planned // 1000}s for a '
                           f'{target_duration_ms // 1000}s Card; the edit has less material than the '
                           'Card needs.'))
    if continuity:
        locked = {str(key): str(value) for key, value in (continuity.get('locked') or {}).items()}
        statement = str(card.get('continuity') or '').lower()
        for key, value in locked.items():
            token = key.split('.')[-1].lower()
            # `maya.backpack = right_shoulder` names the subject in the key and the side in the
            # value. A value that names both sides is a direction along the frame
            # (`screen_direction = left_to_right`), not a side of a subject, so it is never
            # compared as one.
            words = set(re.findall(r'[a-z]+', value.lower()))
            if {'left', 'right'} <= words:
                continue
            value_side = _side_only(value)
            stated_side = _side_of(statement, token)
            if value_side and stated_side and value_side != stated_side:
                findings.append(FieldFinding(field='continuity', code='contradiction', severity='blocking',
                    detail=f'Continuity is locked as {key}={value}, but this Card states the {token} on '
                           f'the {stated_side}. The creator-locked fact wins.'))
    return findings


# ---------------------------------------------------------------- planning: card count and runtime

class BeatPlan(DirectorModel):
    """One meaningful production beat the planner must express as a Card."""

    title: str
    purpose: str = ''
    weight: float = Field(default=1.0, allow_inf_nan=False)
    mode: CardMode = 'REAL'
    starts_from: str = ''
    ends_with: str = ''
    story_change: str = ''


class PlannedShell(DirectorModel):
    order: int
    title: str
    mode: CardMode
    target_duration_ms: int
    purpose: str = ''
    starts_from: str = ''
    ends_with: str = ''
    story_change: str = ''


class CardPlanRule(DirectorModel):
    code: str
    severity: FieldSeverity
    detail: str


class CardPlan(DirectorModel):
    """A planned Production structure: every Card shell, before any Card is written."""

    target_runtime_ms: int
    card_cap: int
    card_count: int
    shells: list[PlannedShell] = []
    rules: list[CardPlanRule] = []
    accepted: bool = False

    @property
    def planned_runtime_ms(self) -> int:
        return sum(shell.target_duration_ms for shell in self.shells)


def card_cap_for_runtime(target_runtime_ms: int) -> int:
    """The maximum number of Cards a finished runtime supports.

    The two published anchors are exact (1 minute -> 3 Cards, 10 minutes -> 25 Cards) and the rule
    between them is monotone, so a 2-minute piece gets 5 and a 30-second piece gets 2.
    """

    if target_runtime_ms <= 0:
        return 1
    minutes = target_runtime_ms / 60_000
    # Card count grows with runtime but stays well under one Card per 20 seconds of finished cut.
    return max(1, min(MAX_CARDS, math.ceil(minutes * CARDS_PER_MINUTE)))


def allocate_runtime_ms(target_runtime_ms: int, weights: list[float]) -> list[int]:
    """Allocate an exact nonnegative millisecond total in proportion to positive weights."""

    count = len(weights)
    if target_runtime_ms < 0 or not count or any(not math.isfinite(weight) or weight <= 0 for weight in weights):
        raise ValueError('Runtime and beat weights are outside supported bounds.')
    total_weight = math.fsum(weights)
    if not math.isfinite(total_weight) or total_weight <= 0:
        raise ValueError('Beat weights exceed the supported numeric range.')
    exact = [target_runtime_ms * weight / total_weight for weight in weights]
    durations = [int(value) for value in exact]
    remainder = target_runtime_ms - sum(durations)
    order = sorted(range(count), key=lambda index: (-(exact[index] - durations[index]), index))
    for index in order[:remainder]:
        durations[index] += 1
    return durations


def normalized_plan_weights(beats: list[BeatPlan]) -> list[float]:
    """Convert validated beat weights to bounded deterministic proportions."""

    positive = [float(beat.weight) if beat.weight > 0 else 0.1 for beat in beats]
    scale = max(positive, default=0.1)
    return [weight / scale for weight in positive]


def card_plan_rule(code: str, detail: str) -> CardPlanRule:
    return CardPlanRule(code=code, severity='blocking', detail=detail)


def plan_rejection(target_runtime_ms: int, beats: list[BeatPlan]) -> CardPlanRule | None:
    """Return the first non-overrideable structure/timing constraint for a Card plan."""

    if target_runtime_ms <= 0:
        return card_plan_rule('invalid_runtime', 'A Card plan needs a positive finished-runtime target.')
    if not beats:
        return card_plan_rule('no_beats', 'No production beats were supplied, so no Cards can be planned. TONDE plans the Production structure before writing any Card.')
    cap = card_cap_for_runtime(target_runtime_ms)
    if len(beats) > cap:
        return card_plan_rule('card_count_exceeds_cap',
            f'{len(beats)} Cards were requested for a finished runtime of {target_runtime_ms // 1000} seconds, which supports at most {cap}. '
            'Cards represent meaningful production beats, not camera cuts: merge the beats that share one objective, place or story change.')
    return None


def _rules_for_card_plan(target_runtime_ms: int, beats: list[BeatPlan], durations: list[int], cap: int) -> list[CardPlanRule]:
    rules: list[CardPlanRule] = []
    short = sum(duration < MIN_CARD_DURATION_MS for duration in durations)
    if short:
        rules.append(CardPlanRule(code='card_below_20s', severity='warning',
            detail=f'{short} Card(s) are planned below the {MIN_CARD_DURATION_MS // 1000}-second guidance. '
                   'Confirm each is a coherent production beat, not a camera cut.'))
    if len(beats) < cap:
        rules.append(CardPlanRule(code='fewer_cards_than_cap', severity='warning',
            detail=f'{len(beats)} Cards planned; this runtime allows up to {cap}. Using fewer is '
                   'correct when each Card still directs one coherent beat.'))
    return rules


def build_card_plan(target_runtime_ms: int, beats: list[BeatPlan], *, max_beats: int = MAX_CARDS) -> CardPlan:
    """Build the accepted Card shells for the bounded creator-facing plan contract."""

    cap = card_cap_for_runtime(target_runtime_ms)
    if target_runtime_ms <= 0:
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=0,
            rules=[card_plan_rule('invalid_runtime', 'A Card plan needs a positive finished-runtime target.')])
    if not beats:
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=0,
            rules=[card_plan_rule('no_beats', 'No production beats were supplied, so no Cards can be planned. TONDE plans the Production structure before writing any Card.')])
    if not 1 <= max_beats <= MAX_CARDS:
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=len(beats),
            rules=[card_plan_rule('invalid_card_limit', 'The Card planner limit is outside supported bounds.')])
    if len(beats) > MAX_CARDS:
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=len(beats),
            rules=[card_plan_rule('beat_count_exceeds_limit', f'A plan can contain at most {MAX_CARDS} beats.')])
    rejection = plan_rejection(target_runtime_ms, beats)
    if rejection is not None:
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=len(beats), rules=[rejection])
    considered = beats
    weights = normalized_plan_weights(considered)
    durations = allocate_runtime_ms(target_runtime_ms, weights)
    shells = [PlannedShell(order=index + 1, title=beat.title, mode=beat.mode,
        target_duration_ms=durations[index], purpose=beat.purpose,
        starts_from=beat.starts_from, ends_with=beat.ends_with,
        story_change=beat.story_change or beat.ends_with)
        for index, beat in enumerate(considered)]
    rules = _rules_for_card_plan(target_runtime_ms, considered, durations, cap)
    return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=len(shells),
        shells=shells, rules=rules, accepted=True)


def plan_card_shells(target_runtime_ms: int, beats: list[BeatPlan], *, acknowledge_card_cap: bool = False) -> CardPlan:
    """Plan the Production structure: one shell per meaningful beat, bounded by the runtime.

    The planner never silently merges beats into fewer Cards: when the requested beats exceed the
    cap it refuses, names the cap and the count, and reports how many Cards the runtime supports.
    Durations reconcile exactly to the target runtime.
    """

    cap = card_cap_for_runtime(target_runtime_ms)
    if target_runtime_ms <= 0:
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=0,
            rules=[card_plan_rule('invalid_runtime', 'A Card plan needs a positive finished-runtime target.')])
    if not beats:
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=0,
            rules=[card_plan_rule('no_beats', 'No production beats were supplied, so no Cards can be planned. TONDE plans the Production structure before writing any Card.')])
    if len(beats) > MAX_CARDS:
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=len(beats),
            rules=[card_plan_rule('beat_count_exceeds_limit', f'A plan can contain at most {MAX_CARDS} beats.')])
    over_cap = len(beats) > cap
    if over_cap and not acknowledge_card_cap:
        rejection = plan_rejection(target_runtime_ms, beats)
        return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=len(beats), rules=[rejection] if rejection else [])

    # The 20-second rule is guidance rather than a minimum-runtime law. Allocate exact
    # integer milliseconds by largest remainder, so no Card goes negative and the sum
    # always equals the Production target even for sub-second runtimes or skewed weights.
    weights = normalized_plan_weights(beats)
    durations = allocate_runtime_ms(target_runtime_ms, weights)
    shells = [PlannedShell(order=index + 1, title=beat.title, mode=beat.mode,
        target_duration_ms=durations[index], purpose=beat.purpose,
        starts_from=beat.starts_from, ends_with=beat.ends_with,
        story_change=beat.story_change or beat.ends_with)
        for index, beat in enumerate(beats)]
    rules = _rules_for_card_plan(target_runtime_ms, beats, durations, cap)
    if over_cap:
        rules.append(CardPlanRule(code='card_count_cap_acknowledged', severity='warning',
            detail=f'The creator explicitly acknowledged {len(beats)} Cards for a runtime that normally supports at most {cap}.'))
    return CardPlan(target_runtime_ms=target_runtime_ms, card_cap=cap, card_count=len(shells),
        shells=shells, rules=rules, accepted=True)


class PlanningSequence(DirectorModel):
    """One directed story turn used to plan coherent Cards."""

    id: str = Field(min_length=1, max_length=80)
    order: int = Field(ge=1, le=40)
    title: str = Field(min_length=2, max_length=160)
    story_change: str = Field(min_length=2, max_length=400)
    starts_from: str = Field(default='', max_length=400)
    ends_with: str = Field(default='', max_length=400)
    causality: str = Field(min_length=2, max_length=400)


class SequencePlan(DirectorModel):
    """Runtime allocation over the creator's chosen sequence of story turns."""

    target_runtime_ms: int = Field(ge=1, le=9007199254740991)
    sequences: list[PlanningSequence] = Field(min_length=1, max_length=MAX_CARDS)
    accepted: bool = True
    reason: str = ''
    expected_production_revision: int | None = Field(default=None, ge=1)


def plan_sequence_runtime(body: SequencePlan) -> SequencePlan:
    weights = [max(0.1, float(item.order)) for item in body.sequences]
    durations = allocate_runtime_ms(body.target_runtime_ms, weights)
    return body.model_copy(update={'sequences': [item.model_copy(update={'duration_ms': duration})
        for item, duration in zip(body.sequences, durations)]})


class ResultStateList(DirectorModel):
    result_ids: list[str] = Field(min_length=1, max_length=200)
    state: str


class ExecutionReference(DirectorModel):
    mode: Literal['real', 'ai', 'hybrid']


# ---------------------------------------------------------------- provenance and authority

SourceType = Literal['creator_locked', 'approved_result', 'intake', 'reference', 'continuity',
    'director', 'inference']

#: The trust hierarchy. Lower rank wins. A creator-locked fact outranks an approved Result, which
#: outranks Intake, references, existing continuity, TONDE's own decisions and, last, inference.
SOURCE_TRUST: dict[str, int] = {
    'creator_locked': 1,
    'approved_result': 2,
    'intake': 3,
    'reference': 4,
    'continuity': 5,
    'director': 6,
    'inference': 7,
}


class FieldProvenance(DirectorModel):
    """Where a value came from, so revisions, continuity and conflicts can be reasoned about."""

    value: str
    source_type: SourceType
    source_id: str | None = None
    confidence: float = 1.0
    locked: bool = False


def authority_rank(entry: FieldProvenance) -> tuple[int, float]:
    """Sort key: trust first, then confidence, then the longest value as a tie-breaker."""

    return (SOURCE_TRUST.get(entry.source_type, 99), -entry.confidence)


def resolve_provenance(entries: list[FieldProvenance]) -> FieldProvenance | None:
    """The value the system must believe, given everything it knows about a field."""

    if not entries:
        return None
    return sorted(entries, key=lambda entry: (authority_rank(entry), -len(entry.value)))[0]


def locked_conflicts(entries: list[FieldProvenance]) -> list[FieldFinding]:
    """A locked fact that another source disagrees with is a conflict, never a silent edit."""

    locked = [entry for entry in entries if entry.locked]
    if not locked:
        return []
    findings: list[FieldFinding] = []
    for fact in locked:
        for entry in entries:
            if entry is fact:
                continue
            if _normalize_value(entry.value) == _normalize_value(fact.value):
                continue
            findings.append(FieldFinding(field='provenance', code='lock_conflict', severity='blocking',
                detail=f'{fact.value!r} is locked by the creator, but {entry.source_type} would provide '
                       f'{entry.value!r}. Ask before changing a locked fact.'))
    return findings


def _normalize_value(value: str) -> str:
    return ' '.join(re.findall(r'[a-z0-9]+', value.lower()))


# ---------------------------------------------------------------- dependency and impact scoping

CHANGE_KINDS: tuple[str, ...] = ('location', 'camera', 'look', 'audio', 'subject', 'continuity',
    'duration', 'mode', 'purpose', 'shot_camera', 'shot_timing', 'prompt')

#: Which Card-level fields a change is allowed to touch. Everything named here is regenerated;
#: everything absent is protected production truth that must survive the edit.
CARD_FIELD_DEPENDENCIES: dict[str, tuple[str, ...]] = {
    'location': ('location_direction', 'look_direction', 'camera_direction', 'audio_direction',
        'resources', 'continuity', 'next_action'),
    'camera': ('camera_direction', 'look_direction', 'next_action'),
    'look': ('look_direction', 'continuity'),
    'audio': ('audio_direction',),
    'subject': ('subject_direction', 'continuity', 'next_action'),
    'continuity': ('continuity',),
    'duration': ('summary', 'what_happens', 'next_action'),
    'mode': ('camera_direction', 'look_direction', 'audio_direction', 'resources', 'next_action'),
    'purpose': ('title', 'summary', 'what_happens', 'director_direction', 'audience_feeling',
        'next_action'),
    'shot_camera': (),
    'shot_timing': (),
    'prompt': (),
}
#: Fields a scoped change may never rewrite, whatever the command says.
PROTECTED_CARD_FIELDS: tuple[str, ...] = ('title', 'purpose', 'what_happens', 'director_direction',
    'audience_feeling', 'subject_direction')
#: Shot fields touched by a Card-level change, so a location change reaches the coverage it should.
SHOT_FIELD_DEPENDENCIES: dict[str, tuple[str, ...]] = {
    'location': ('camera', 'lighting', 'audio'),
    'camera': ('camera',),
    'look': ('lighting',),
    'audio': ('audio',),
    'shot_camera': ('camera',),
    'shot_timing': ('timing', 'action'),
    'prompt': ('prompt', 'avoid', 'expected_result'),
}


class ImpactPlan(DirectorModel):
    """What a proposed change may touch, and what it must leave alone."""

    change_kind: str
    card_fields: list[str] = []
    shot_fields: list[str] = []
    protected: list[str] = []
    downstream_cards: bool = False
    note: str = ''


def impact_for(change_kind: str, *, scope: str = 'card', downstream_cards: bool = False) -> ImpactPlan:
    """Scope a change: affected fields only, protected truth preserved, downstream cards flagged.

    A Card-level change reaches the Card fields that depend on it plus the Shot fields that inherit
    it. A Shot-level change stays inside the Shot and never rewrites Card direction.
    """

    shot_fields = list(SHOT_FIELD_DEPENDENCIES.get(change_kind, ()))
    card_fields = [] if scope == 'shot' else list(CARD_FIELD_DEPENDENCIES.get(change_kind, ()))
    protected = [field for field in PROTECTED_CARD_FIELDS if field not in card_fields]
    note = ('This changes only the focused Card unless continuity changes.'
        if not downstream_cards else
        'Continuity changes here, so later Cards that inherit it are affected.')
    return ImpactPlan(change_kind=change_kind, card_fields=card_fields, shot_fields=shot_fields,
        protected=protected, downstream_cards=downstream_cards, note=note)


# ---------------------------------------------------------------- Card status

def card_status(*, has_structure: bool, direction: dict[str, Any] | None,
    completeness: str | None, approval: str | None, results: int = 0) -> CardStatus:
    """The Card's real status, from state rather than from the frontend's opinion.

    COMPLETE        the creator approved this version
    RESULT READY    execution evidence exists and is waiting for inspection
    NEEDS YOU       a material decision or review is outstanding
    READY           the direction validates and every execution unit is executable
    BUILDING        direction has started and is still being written
    DRAFT           only the structure exists

    A lock is human authority over a version, not executability, so it never changes this status;
    callers present it separately rather than letting a lock look like progress.
    """

    direction = direction or {}
    written = sum(1 for field in CARD_DIRECTION_FIELDS if str(direction.get(field) or '').strip())
    if approval == 'approved':
        return 'COMPLETE'
    if approval in ('needs_review', 'changed_after_approval') or completeness == 'NEEDS YOU':
        return 'NEEDS YOU'
    if results > 0 and completeness != 'READY':
        return 'RESULT READY'
    if completeness == 'READY':
        return 'RESULT READY' if results > 0 else 'READY'
    if written >= len(CARD_DIRECTION_FIELDS):
        # Every field carries text, but validation has not cleared it (length, duplication or
        # contradiction). That is still the creator's problem, not a finished Card.
        return 'NEEDS YOU'
    if written > 0:
        return 'BUILDING'
    if has_structure:
        return 'DRAFT'
    return 'DRAFT'


def status_detail(status: CardStatus) -> str:
    """One truthful sentence for the status, never a progress claim."""

    return {
        'DRAFT': 'Structure exists. TONDE has not written this Card\u2019s direction yet.',
        'BUILDING': 'TONDE is writing this Card\u2019s direction.',
        'NEEDS YOU': 'This Card needs a decision from you before it can be executed.',
        'READY': 'The direction is complete: a creator could shoot or generate this Card now.',
        'RESULT READY': 'A Result is waiting for inspection against the direction.',
        'COMPLETE': 'Approved. This Card is production truth.',
    }[status]


def card_summary_words(direction: dict[str, Any]) -> int:
    """Visible word total of the expanded Card, used to keep it a Card rather than a manual."""

    return sum(word_count(direction.get(field)) for field in CARD_DIRECTION_FIELDS)
