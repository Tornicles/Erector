from __future__ import annotations

import re
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.analysis import QualitativeConfidence, ReferenceAnalysis
from app.domain.brief import IntelligentBrief
from app.domain.vocabulary import DialogueKind, ProductionType


class CreativeModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


WORDS_PER_MINUTE = 155


def estimate_speech_ms(text: str, *, words_per_minute: int = WORDS_PER_MINUTE) -> int:
    """Deterministic speech-duration estimate. Pauses and reactions are added separately."""

    words = [word for word in re.split(r'\s+', text.strip()) if word]
    if not words:
        return 0
    return round(len(words) / words_per_minute * 60000)


class StoryBeat(CreativeModel):
    id: str = Field(min_length=1, max_length=80)
    order: int = Field(ge=1, le=40)
    name: str = Field(min_length=1, max_length=80)
    story_function: str = Field(min_length=1, max_length=400)
    content: str = Field(min_length=1, max_length=1600)
    emotion: str = Field(default='', max_length=200)
    visual_idea: str = Field(default='', max_length=600)
    techniques: list[str] = Field(default_factory=list, max_length=6)
    planned_duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)


class StoryPlan(CreativeModel):
    title: str = Field(min_length=1, max_length=160)
    logline: str = Field(min_length=1, max_length=800)
    premise: str = Field(min_length=1, max_length=1200)
    central_question: str = Field(min_length=1, max_length=400)
    protagonist: str = Field(default='', max_length=400)
    desire: str = Field(default='', max_length=400)
    conflict: str = Field(default='', max_length=400)
    stakes: str = Field(default='', max_length=400)
    hook: str = Field(default='', max_length=800)
    payoff: str = Field(default='', max_length=800)
    call_to_action: str | None = Field(default=None, max_length=400)
    beats: list[StoryBeat] = Field(min_length=1, max_length=20)
    emotional_progression: list[str] = Field(default_factory=list, max_length=12)
    beginning: str = Field(default='', max_length=800)
    middle: str = Field(default='', max_length=800)
    ending: str = Field(default='', max_length=800)
    theme: str | None = Field(default=None, max_length=300)
    grammar: str = Field(default='generic', max_length=60)
    variation: str = Field(default='original', max_length=60)
    dialogue_mode: str | None = Field(default=None, max_length=40)
    dialogue_approach: str | None = Field(default=None, max_length=600)
    runtime_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    producer: Literal['deterministic', 'model'] = 'deterministic'
    assumptions: list[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode='after')
    def beats_are_ordered(self) -> 'StoryPlan':
        orders = [beat.order for beat in self.beats]
        if orders != sorted(orders) or len(set(orders)) != len(orders):
            raise ValueError('Story beats need unique ascending order.')
        return self

    def substance_score(self) -> int:
        """Guards against generic beat labels presented as a Story."""

        generic = {'opening', 'middle', 'ending', 'beginning', 'intro', 'setup', 'conclusion'}
        score = 0
        for beat in self.beats:
            if beat.name.strip().lower() not in generic:
                score += 1
            if len(beat.content.split()) >= 12:
                score += 1
            if beat.visual_idea:
                score += 1
        return score


class ShotConcept(CreativeModel):
    """Execution-neutral initial Shot idea. Prompts 6/7 attach real execution."""

    order: int = Field(ge=1, le=200)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=900)
    intent: str = Field(min_length=1, max_length=400)
    subject: str = Field(default='', max_length=200)


class ScenePlan(CreativeModel):
    order: int = Field(ge=1, le=200)
    title: str = Field(min_length=1, max_length=160)
    purpose: str = Field(min_length=1, max_length=1200)
    story_beat: str = Field(default='', max_length=200)
    action: list[str] = Field(min_length=1, max_length=12)
    characters: list[str] = Field(default_factory=list, max_length=8)
    environment: str = Field(default='', max_length=200)
    products: list[str] = Field(default_factory=list, max_length=6)
    dialogue_notes: str = Field(default='', max_length=500)
    planned_duration_ms: int = Field(ge=0, le=9007199254740991)
    opening_state: str = Field(default='', max_length=300)
    ending_state: str = Field(default='', max_length=300)
    visual_intent: str = Field(default='', max_length=600)
    shots: list[ShotConcept] = Field(default_factory=list, max_length=12)
    techniques: list[str] = Field(default_factory=list, max_length=6)

    @model_validator(mode='after')
    def functional_purpose(self) -> 'ScenePlan':
        if len(self.purpose.split()) < 3:
            raise ValueError('Every Scene needs a functional purpose, not a label.')
        return self


class ScriptLine(CreativeModel):
    order: int = Field(ge=1, le=400)
    kind: DialogueKind = DialogueKind.dialogue
    speaker: str | None = Field(default=None, max_length=120)
    content: str = Field(default='', max_length=2000)
    estimated_ms: int = Field(default=0, ge=0, le=9007199254740991)
    intention: str = Field(default='', max_length=300)
    delivery: str = Field(default='', max_length=300)
    pause_after_ms: int = Field(default=0, ge=0, le=60000)
    interruption: bool = False
    overlap: bool = False
    reaction_to: int | None = Field(default=None, ge=1, le=400)
    subtext: str = Field(default='', max_length=300)
    scene_order: int = Field(default=1, ge=1, le=200)

    @model_validator(mode='after')
    def spoken_lines_need_content(self) -> 'ScriptLine':
        if self.kind in {DialogueKind.dialogue, DialogueKind.voiceover, DialogueKind.narration} and not self.content.strip():
            raise ValueError('A spoken line needs content.')
        if self.kind == DialogueKind.dialogue and self.content.strip() and self.estimated_ms == 0:
            raise ValueError('A spoken line needs an estimated duration.')
        return self


class ScriptScenePlan(CreativeModel):
    scene_order: int = Field(ge=1, le=200)
    scene_title: str = Field(min_length=1, max_length=160)
    heading: str = Field(min_length=1, max_length=200)
    action: list[str] = Field(min_length=1, max_length=16)
    lines: list[ScriptLine] = Field(default_factory=list, max_length=60)
    product_direction: str = Field(default='', max_length=500)
    transition: str = Field(default='', max_length=200)
    notes: str = Field(default='', max_length=500)
    planned_duration_ms: int = Field(ge=0, le=9007199254740991)

    @model_validator(mode='after')
    def lines_belong_to_scene(self) -> 'ScriptScenePlan':
        for line in self.lines:
            if line.scene_order != self.scene_order:
                raise ValueError('Script lines must belong to their Scene.')
        return self

    def dialogue_ms(self) -> int:
        return sum(line.estimated_ms + line.pause_after_ms for line in self.lines)


class ScriptPlan(CreativeModel):
    title: str = Field(min_length=1, max_length=160)
    scenes: list[ScriptScenePlan] = Field(default_factory=list, max_length=40)
    dialogue_mode: str | None = Field(default=None, max_length=40)
    dialogue_approach: str | None = Field(default=None, max_length=600)
    estimated_runtime_ms: int = Field(default=0, ge=0, le=9007199254740991)
    producer: Literal['deterministic', 'model'] = 'deterministic'

    @model_validator(mode='after')
    def ordered_scenes(self) -> 'ScriptPlan':
        orders = [scene.scene_order for scene in self.scenes]
        if orders != sorted(orders) or len(set(orders)) != len(orders):
            raise ValueError('Script Scenes need unique ascending order.')
        return self

    def is_structured(self) -> bool:
        return bool(self.scenes) and all(scene.action for scene in self.scenes)


class Character(CreativeModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=120)
    story_function: str = Field(min_length=1, max_length=500)
    objective: str = Field(default='', max_length=500)
    visual_description: str = Field(default='', max_length=800)
    performance_direction: str = Field(default='', max_length=800)
    relationships: list[str] = Field(default_factory=list, max_length=8)
    recurring: bool = False
    discovered_from_reference: bool = False

    @model_validator(mode='after')
    def never_identifies_unknown_people(self) -> 'Character':
        if self.discovered_from_reference and re.search(r'\b(?:is|looks like)\s+[A-Z][a-z]+ [A-Z][a-z]+\b', self.visual_description):
            raise ValueError('A Reference cannot identify a real person.')
        return self


class Environment(CreativeModel):
    """Creative Environment. Distinct from a physical shooting Location."""

    name: str = Field(min_length=1, max_length=160)
    visual_requirements: list[str] = Field(min_length=1, max_length=10)
    story_purpose: str = Field(min_length=1, max_length=500)
    spatial_needs: list[str] = Field(default_factory=list, max_length=8)
    lighting_context: str = Field(default='', max_length=400)
    scene_usage: list[int] = Field(default_factory=list, max_length=20)


class ProductRequirement(CreativeModel):
    name: str = Field(min_length=1, max_length=160)
    role: str = Field(min_length=1, max_length=120)
    required_visibility: Literal['hero', 'featured', 'supporting', 'background']
    hero_moments: list[str] = Field(default_factory=list, max_length=8)
    fidelity_importance: Literal['high', 'medium', 'low'] = 'high'
    interactions: list[str] = Field(default_factory=list, max_length=8)
    packaging_notes: list[str] = Field(default_factory=list, max_length=6)


class WardrobeProp(CreativeModel):
    name: str = Field(min_length=1, max_length=160)
    kind: Literal['wardrobe', 'prop'] = 'prop'
    requirement: str = Field(min_length=1, max_length=500)
    scene_usage: list[int] = Field(default_factory=list, max_length=20)
    source: Literal['creator_supplied', 'derived'] = 'derived'


class StyleBibleSection(CreativeModel):
    section: Literal['camera', 'composition', 'movement', 'lighting', 'color', 'texture', 'performance', 'edit', 'sound']
    description: str = Field(min_length=1, max_length=900)
    directives: list[str] = Field(default_factory=list, max_length=8)
    confidence: QualitativeConfidence = QualitativeConfidence.medium


class StyleBible(CreativeModel):
    title: str = Field(min_length=1, max_length=160)
    sections: list[StyleBibleSection] = Field(min_length=1, max_length=9)
    producer: Literal['deterministic', 'model'] = 'deterministic'
    revision: int = Field(default=1, ge=1)

    def section(self, name: str) -> StyleBibleSection | None:
        return next((item for item in self.sections if item.section == name), None)


class RuntimeFitFinding(CreativeModel):
    kind: Literal['dialogue_too_long', 'too_many_scenes', 'pacing_too_dense', 'insufficient_material', 'assigned_over', 'assigned_under', 'fits']
    statement: str = Field(min_length=1, max_length=600)
    severity: Literal['info', 'warning', 'critical'] = 'warning'
    fix: str = Field(min_length=1, max_length=600)


class RuntimeFit(CreativeModel):
    target_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    assigned_ms: int = Field(default=0, ge=0, le=9007199254740991)
    dialogue_ms: int = Field(default=0, ge=0, le=9007199254740991)
    action_ms: int = Field(default=0, ge=0, le=9007199254740991)
    slack_ms: int = Field(default=0, le=9007199254740991)
    status: Literal['fits', 'over', 'under', 'unresolved'] = 'unresolved'
    findings: list[RuntimeFitFinding] = Field(default_factory=list, max_length=12)


class CreativeBundle(CreativeModel):
    title: str = Field(min_length=1, max_length=160)
    story: StoryPlan | None = None
    scenes: list[ScenePlan] = Field(default_factory=list, max_length=40)
    script: ScriptPlan | None = None
    characters: list[Character] = Field(default_factory=list, max_length=20)
    environments: list[Environment] = Field(default_factory=list, max_length=20)
    products: list[ProductRequirement] = Field(default_factory=list, max_length=10)
    wardrobe_props: list[WardrobeProp] = Field(default_factory=list, max_length=20)
    style_bible: StyleBible | None = None
    runtime_fit: RuntimeFit = Field(default_factory=RuntimeFit)
    producer: Literal['deterministic', 'model'] = 'deterministic'
    assumptions: list[str] = Field(default_factory=list, max_length=20)


def allocate_runtime(target_ms: int, count: int, weights: list[float] | None = None) -> list[int]:
    """Exact integer allocation. Scene durations must sum to the target exactly."""

    if not 1 <= count <= 40 or not 0 <= target_ms <= 9007199254740991:
        raise ValueError('Runtime and scene count are outside supported bounds.')
    if not weights:
        quotient, remainder = divmod(target_ms, count)
        return [quotient + (1 if index < remainder else 0) for index in range(count)]
    if len(weights) != count or any(weight <= 0 for weight in weights):
        raise ValueError('Scene weights must be positive and match the scene count.')
    total_weight = sum(weights)
    exact = [target_ms * weight / total_weight for weight in weights]
    floors = [int(value) for value in exact]
    remainder = target_ms - sum(floors)
    order = sorted(range(count), key=lambda index: (-(exact[index] - floors[index]), index))
    for index in order[:remainder]:
        floors[index] += 1
    return floors


BEAT_GRAMMAR: dict[ProductionType, list[tuple[str, str, str]]] = {
    ProductionType.commercial: [
        ('Hook', 'Earn the next three seconds', 'attention'),
        ('Desire', 'Make the viewer want the outcome', 'want'),
        ('Product entry', 'Introduce the Product as the answer', 'recognition'),
        ('Proof and payoff', 'Prove the promise in a visible moment', 'belief'),
        ('Call to action', 'Convert the feeling into one action', 'resolve'),
    ],
    ProductionType.advertisement: [
        ('Tension', 'Name the friction the viewer already feels', 'recognition'),
        ('Promise', 'Show what changes when the Product arrives', 'hope'),
        ('Proof', 'Make the benefit visible, not claimed', 'belief'),
        ('Call to action', 'Ask for one specific response', 'resolve'),
    ],
    ProductionType.product_film: [
        ('Sensory opening', 'Set a mood before the Product appears', 'anticipation'),
        ('Withholding', 'Delay the hero detail on purpose', 'longing'),
        ('Hero reveal', 'Give the Product its full visual weight', 'desire'),
        ('Craft detail', 'Show the making or the material', 'trust'),
        ('Signature close', 'Leave a single lasting image', 'satisfaction'),
    ],
    ProductionType.social_video: [
        ('Hook', 'Win the first two seconds', 'curiosity'),
        ('Value', 'Deliver one clear, usable idea', 'interest'),
        ('Payoff', 'Resolve the tension you opened', 'satisfaction'),
        ('Invitation', 'Offer a reason to come back', 'intent'),
    ],
    ProductionType.youtube: [
        ('Promise', 'State exactly what the viewer gets', 'curiosity'),
        ('Context', 'Give the minimum setup needed', 'orientation'),
        ('Main value', 'Deliver the substance in visible sections', 'progress'),
        ('Proof', 'Show the result, not the claim', 'belief'),
        ('Payoff and next step', 'Close the loop and invite the next action', 'resolve'),
    ],
    ProductionType.trailer: [
        ('World', 'Establish a place that feels lived in', 'unease'),
        ('Character', 'Show someone whose normal is about to break', 'sympathy'),
        ('Disruption', 'Introduce the rupture without explaining it', 'alarm'),
        ('Escalation', 'Raise the cost with each new image', 'dread'),
        ('Withholding', 'Refuse the answer; imply a larger mystery', 'anticipation'),
        ('Title beat', 'Land the title as the final promise', 'resolve'),
    ],
    ProductionType.short_film: [
        ('Setup', 'Place a specific person inside a specific pressure', 'familiarity'),
        ('Inciting incident', 'Break the normal and force a move', 'alarm'),
        ('Escalation', 'Make the easier option disappear', 'dread'),
        ('Turn', 'Reveal what the pressure is really about', 'recognition'),
        ('Resolution', 'End on a changed state, not an explanation', 'release'),
    ],
    ProductionType.long_form_film: [
        ('Act I opening', 'Establish the world and the wound', 'familiarity'),
        ('Act I turn', 'Commit the protagonist to a course', 'resolve'),
        ('Act II pressure', 'Escalate consequence and cost', 'dread'),
        ('Midpoint reversal', 'Change what the story is about', 'recognition'),
        ('Act III climax', 'Force the final choice', 'release'),
        ('Act III resolution', 'Land the changed world', 'release'),
    ],
    ProductionType.documentary: [
        ('Central question', 'Ask the question the Production exists to answer', 'curiosity'),
        ('Context', 'Establish stakes with real detail', 'orientation'),
        ('Evidence', 'Weigh what the material actually shows', 'belief'),
        ('Counterpoint', 'Hold the strongest opposing view fairly', 'tension'),
        ('Conclusion', 'State only what the evidence supports', 'resolve'),
    ],
    ProductionType.interview: [
        ('Context', 'Frame who is speaking and why it matters', 'orientation'),
        ('Concrete arc', 'Move from specific experience to meaning', 'interest'),
        ('Revelation', 'Reach the one answer the interview exists for', 'recognition'),
        ('Closing', 'Point forward without overstating', 'resolve'),
    ],
    ProductionType.music_video: [
        ('Statement', 'Establish the visual register of the track', 'immersion'),
        ('Performance', 'Let the artist own the frame', 'energy'),
        ('Narrative turn', 'Give the images a second meaning', 'recognition'),
        ('Abstraction', 'Break realism at the emotional peak', 'release'),
        ('Return', 'Land back on the defining image', 'resolve'),
    ],
    ProductionType.recurring_content: [
        ('Recognisable open', 'Repeat the format the audience knows', 'familiarity'),
        ('Core value', 'Deliver the promise of this episode', 'interest'),
        ('Payoff', 'Close the loop cleanly', 'satisfaction'),
    ],
    ProductionType.photography: [],
}

VARIATION_TONE = {
    'more_emotional': 'warmer, closer, less explained',
    'darker': 'colder, tighter, withheld',
    'funnier': 'wry, self-aware, lighter on its feet',
    'more_commercial': 'clearer promise, stronger invitation',
    'simpler': 'plainer language, fewer moving parts',
    'more_practical': 'achievable with the stated Setup',
    'more_like_this': 'same shape, new surface images',
    'original': 'original direction for the stated intent',
}

VARIANT_IMAGES = (
    'the first seconds before the day starts',
    'a hand reaching for the ordinary object that matters',
    'a doorway held open for one beat too long',
    'surface detail seen closer than the eye expects',
    'the quiet moment right before the decision',
)


def _grammar_for(production_type: ProductionType) -> tuple[str, list[tuple[str, str, str]]]:
    if production_type in BEAT_GRAMMAR and BEAT_GRAMMAR[production_type]:
        return production_type.value, BEAT_GRAMMAR[production_type]
    return 'generic', [
        ('Opening', 'Establish the subject and its central tension', 'attention'),
        ('Development', 'Show what changes under pressure', 'interest'),
        ('Payoff', 'Resolve on the clearest version of the idea', 'resolve'),
    ]


def _subject_phrase(brief: IntelligentBrief) -> str:
    """A named Product wins; an implied category is used as the creative subject; otherwise stay generic."""

    return brief.product_brand or brief.product_category or 'the subject'


def build_story(
    brief: IntelligentBrief,
    *,
    runtime_ms: int | None,
    analyses: list[ReferenceAnalysis] | None = None,
    variation: str = 'original',
    variant_index: int = 0,
    duration_weights: list[float] | None = None,
) -> StoryPlan | None:
    """Type-aware Story generation from the Brief, References and constraints. Deterministic grammar."""

    if brief.production_type == ProductionType.photography:
        return None
    analyses = analyses or []
    grammar_name, grammar = _grammar_for(brief.production_type)
    beats_spec = list(grammar)
    if variation == 'simpler' and len(beats_spec) > 3:
        beats_spec = [beats_spec[0], beats_spec[len(beats_spec) // 2], beats_spec[-1]]
    tone_note = VARIATION_TONE.get(variation, VARIATION_TONE['original'])
    techniques = [technique.name for analysis in analyses for technique in analysis.essential_techniques()][:6]
    subject = _subject_phrase(brief)
    audience = brief.audience or 'the intended viewer'
    platform = brief.platform or 'the delivery platform'
    cta = brief.call_to_action or 'take the next step'
    counts = len(beats_spec)
    allocated = allocate_runtime(runtime_ms, counts, duration_weights) if runtime_ms is not None else []
    durations: list[int | None] = list(allocated) if allocated else [None] * counts
    images = [VARIANT_IMAGES[(variant_index + index) % len(VARIANT_IMAGES)] for index in range(counts)]
    beats: list[StoryBeat] = []
    for index, (name, function, emotion) in enumerate(beats_spec):
        name_lower = name.lower()
        if 'hook' in name_lower or 'opening' in name_lower or 'statement' in name_lower:
            content = (
                f'Open on {images[index]}, framed so {subject} is present but not yet explained to {audience}. '
                f'The image asks one question: what changes if this matters?'
            )
            visual = f'One composed image that reads instantly on {platform}.'
        elif 'desire' in name_lower or 'promise' in name_lower or 'tension' in name_lower:
            content = (
                f'Show the state {audience} recognises before {subject}: the small friction that makes the outcome worth wanting. '
                f'{tone_note.capitalize()}.'
            )
            visual = 'Human-scale detail held long enough to register.'
        elif 'product' in name_lower or 'reveal' in name_lower or 'hero' in name_lower:
            content = (
                f'Give {subject} its entrance as the answer rather than the interruption: clean surface, controlled light, '
                f'and one unmistakable detail that separates it from everything similar.'
            )
            visual = f'{subject} treated as the hero object of the frame.'
        elif 'withhold' in name_lower or 'disruption' in name_lower or 'mystery' in name_lower:
            content = (
                f'Withhold the explanation. Show consequence before cause so {audience} leans in and does the work of the story.'
            )
            visual = 'An incomplete image that implies a larger world off-frame.'
        elif 'proof' in name_lower or 'payoff' in name_lower or 'value' in name_lower or 'craft' in name_lower:
            content = (
                f'Prove the promise with something visible: a real result, a real texture, a real moment with {subject}, '
                f'not a claim about it.'
            )
            visual = 'Evidence the viewer can point at.'
        elif 'cta' in name_lower or 'invitation' in name_lower or 'next step' in name_lower or 'closing' in name_lower:
            content = f'Close on {cta}. One action, one image, no second idea competing for attention.'
            visual = f'{subject} in its final state with room for the closing line.'
        elif 'escalation' in name_lower or 'pressure' in name_lower or 'turn' in name_lower or 'inciting' in name_lower:
            content = 'Raise the cost. Remove the easier option so the pressure comes from the situation rather than from exposition.'
            visual = 'Shorter, tighter images as the pressure rises.'
        elif 'resolution' in name_lower or 'return' in name_lower or 'world' in name_lower or 'character' in name_lower:
            content = (
                f'Land on a changed state: the same image as the opening, carrying a different meaning for {audience}.'
            )
            visual = 'A callback image that closes the loop.'
        else:
            content = (
                f'{function}: make {subject} matter to {audience} through one concrete, observable moment. {tone_note.capitalize()}.'
            )
            visual = 'One clear image per idea.'
        beats.append(StoryBeat(
            id=f'beat-{index + 1}', order=index + 1, name=name, story_function=function, content=content,
            emotion=emotion, visual_idea=visual, techniques=techniques[:2] if index in {0, len(beats_spec) - 1} else [],
            planned_duration_ms=durations[index],
        ))
    emotional = [beat.emotion for beat in beats if beat.emotion]
    premise = brief.core_message or f'{subject} changes something for {audience}'
    central_question = {
        ProductionType.commercial: f'Why does {subject} deserve the choice?',
        ProductionType.advertisement: f'What does life look like after {subject}?',
        ProductionType.product_film: f'What makes {subject} worth desiring, not just buying?',
        ProductionType.trailer: 'What is the question this world refuses to answer yet?',
        ProductionType.short_film: 'What will this person risk, and what will it cost them?',
        ProductionType.long_form_film: 'What will the protagonist give up to get what they need?',
        ProductionType.documentary: 'What can the evidence actually support?',
        ProductionType.music_video: 'What do these images say that the song cannot?',
        ProductionType.youtube: 'What does the viewer walk away able to do?',
        ProductionType.social_video: 'Why should anyone keep watching past the first two seconds?',
        ProductionType.recurring_content: 'Why return to this format next time?',
        ProductionType.interview: 'What does this person know that changes how the audience sees this?',
    }.get(brief.production_type, f'What does {subject} need to show?')
    logline = f'{brief.production_goal.strip()[:220]} — {len(beats)} beats, {tone_note}, ending on "{cta}".'
    assumptions: list[str] = []
    if not brief.product_brand and not brief.product_category:
        assumptions.append('No Product or subject was named, so the Story speaks about "the subject" generically.')
    elif not brief.product_brand:
        assumptions.append(f'The Story speaks about the implied category "{brief.product_category}"; no brand was supplied.')
    if not brief.audience:
        assumptions.append('Audience was not supplied; the Story is written for a broad intended viewer.')
    if variation != 'original':
        assumptions.append(f'This is a "{variation}" variant of the selected Story; the selected Story is unchanged.')
    return StoryPlan(
        title=brief.production_goal.strip()[:80] or 'Untitled Production',
        logline=logline,
        premise=premise,
        central_question=central_question,
        protagonist=subject if brief.production_type in {ProductionType.commercial, ProductionType.product_film, ProductionType.advertisement} else (brief.cast[0] if brief.cast else 'The central figure'),
        desire=brief.desired_response or f'{audience} wants the better outcome',
        conflict=brief.conflicts[0].topic if brief.conflicts else 'The distance between the promise and the proof',
        stakes=f'If the promise is not proven, {audience} stops believing it.',
        hook=beats[0].content if beats else '',
        payoff=beats[-1].content if beats else '',
        call_to_action=brief.call_to_action,
        beats=beats,
        emotional_progression=emotional,
        beginning=beats[0].content if beats else '',
        middle=beats[len(beats) // 2].content if beats else '',
        ending=beats[-1].content if beats else '',
        grammar=grammar_name,
        variation=variation,
        dialogue_mode=brief.dialogue_mode,
        dialogue_approach=brief.dialogue_approach,
        runtime_ms=runtime_ms,
        assumptions=assumptions,
    )


def build_characters(brief: IntelligentBrief, story: StoryPlan | None) -> list[Character]:
    characters: list[Character] = []
    subject = _subject_phrase(brief)
    commercial = brief.production_type in {
        ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film, ProductionType.social_video,
    }
    if commercial:
        characters.append(Character(
            name='Product handler', role='On-camera hands',
            story_function=f'Shows {subject} being used at human scale so the Product reads as real, not staged.',
            objective='Make the Product moment feel unforced.',
            visual_description='Hands only; clean, neutral wardrobe so attention stays on the Product.',
            performance_direction='Relaxed, economical movement. No acting to camera.',
        ))
    if brief.production_type == ProductionType.trailer or brief.production_type in {ProductionType.short_film, ProductionType.long_form_film}:
        characters.append(Character(
            name=brief.cast[0] if brief.cast else 'The central figure',
            role='Protagonist',
            story_function='Carries the cost of the story so the escalation lands on a person, not a concept.',
            objective='Hold control of a situation that is already slipping.',
            visual_description='Everyday, specific, unglamorous in a way that reads true on camera.',
            performance_direction='Stillness and small reactions. Withhold until the final beat.',
            relationships=['Supporting voice (off-screen)' if brief.production_type == ProductionType.trailer else 'Antagonist presence'],
        ))
    if brief.production_type == ProductionType.interview:
        characters.append(Character(
            name=brief.cast[0] if brief.cast else 'Interviewee',
            role='Subject of the interview',
            story_function='Provides the lived detail the Story depends on.',
            objective='Say the one thing only they can say.',
            performance_direction='Conversational, unperformed; let pauses stay in.',
            visual_description='Creator-supplied. No identity is inferred from any Reference.',
        ))
    if not characters:
        characters.append(Character(
            name='Primary subject', role='Central presence',
            story_function=f'Gives the idea of {subject} a human anchor.',
            objective='Make the central idea visible through behaviour.',
            visual_description='Derived from the Brief only; no identity inferred from References.',
            performance_direction='Natural, unforced, specific.',
        ))
    return characters


def build_environments(brief: IntelligentBrief, scenes: list[ScenePlan]) -> list[Environment]:
    names = [scene.environment for scene in scenes if scene.environment]
    if not names:
        names = brief.environments or ['Primary environment']
    unique: list[str] = []
    for name in names:
        if name not in unique:
            unique.append(name)
    environments: list[Environment] = []
    for name in unique[:6]:
        usage = [scene.order for scene in scenes if scene.environment == name]
        environments.append(Environment(
            name=name,
            visual_requirements=[f'Background that supports {brief.tone[0] if brief.tone else "the stated tone"} without competing'],
            story_purpose=f'Host the action for Scene {", ".join(str(item) for item in usage) or "1"} so the story has somewhere specific to happen.',
            spatial_needs=['Room for the camera position the Story needs', 'Controllable ambient light', 'Workable sound floor'],
            lighting_context='Creator-controlled source available; ambient light is the fallback, not the plan.',
            scene_usage=usage,
        ))
    return environments


def build_products(brief: IntelligentBrief, scenes: list[ScenePlan]) -> list[ProductRequirement]:
    """A named Product is creator-stated; an implied category still needs a structured requirement."""

    name = brief.product_brand or brief.product_category
    if not name:
        return []
    named = bool(brief.product_brand)
    hero_moments = [
        f'Scene {scene.order}: {scene.title}'
        for scene in scenes if name.lower() in ' '.join(scene.products).lower()
    ][:4]
    notes: list[str] = []
    if not named:
        notes.append('No brand or Product name was supplied, so Product identity must be confirmed before its detail is planned.')
    notes.append('Packaging and label detail were not supplied by the creator; packaging fidelity cannot be planned yet.')
    return [ProductRequirement(
        name=name,
        role='Product' if brief.production_type != ProductionType.product_film else 'Hero Product',
        required_visibility='hero',
        hero_moments=hero_moments or [f'Scene {scene.order}: {scene.title}' for scene in scenes[:2]],
        fidelity_importance='high' if named else 'medium',
        interactions=['Handled at human scale', 'Shown in its real environment'],
        packaging_notes=notes,
    )]


def build_wardrobe_props(brief: IntelligentBrief, scenes: list[ScenePlan]) -> list[WardrobeProp]:
    items: list[WardrobeProp] = []
    if brief.production_type in {ProductionType.trailer, ProductionType.short_film, ProductionType.long_form_film}:
        items.append(WardrobeProp(name='Protagonist wardrobe', kind='wardrobe', requirement='One consistent outfit across Scenes 1–3; muted so light reads on the face.', source='derived'))
    if brief.product_brand or brief.product_category:
        product_label = brief.product_brand or brief.product_category or ''
        items.append(WardrobeProp(name=f'{product_label} hero unit', kind='prop', requirement='Physically present, clean, one spare for continuity.', source='derived'))
    return items


def build_style_bible(brief: IntelligentBrief, analyses: list[ReferenceAnalysis] | None = None) -> StyleBible:
    analyses = analyses or []
    source = brief.style_dna or next((analysis.style for analysis in analyses if analysis.style.sections), None)
    sections: list[StyleBibleSection] = []

    def descriptor(name: str, fallback: str) -> tuple[str, list[str], QualitativeConfidence]:
        if source is not None:
            found = source.section(name if name != 'edit' else 'editing')
            if found is not None:
                return found.description, found.directives, found.confidence
        return fallback, [], QualitativeConfidence.low

    plan = {
        'camera': 'Locked-off, considered framing with one deliberate move per Scene.',
        'composition': 'Centred or slightly off-centre subjects with clean negative space for titles.',
        'movement': 'Only motivated movement: push, follow or hold — never unmotivated drift.',
        'lighting': 'One controlled key with soft falloff; ambient light used as fill only.',
        'color': 'Restrained palette; two dominant colours plus the Product accent.',
        'texture': 'Skin and surface detail preserved; avoid over-smoothing.',
        'performance': 'Understated, truthful reactions; no presentational delivery.',
        'edit': 'Cut on emotional change rather than on beat; hold the hero image.',
        'sound': 'Clean dialogue, real ambience, one music bed that resolves on the payoff.',
    }
    for name, fallback in plan.items():
        description, directives, confidence = descriptor(name, fallback)
        sections.append(StyleBibleSection(section=cast(Any, name), description=description, directives=directives, confidence=confidence))
    if source is not None:
        for extra in source.sections:
            mapped = {'palette': 'color', 'contrast': 'color', 'typography': 'composition'}.get(extra.section)
            if mapped is None or any(section.section == mapped for section in sections):
                continue
            sections = [section for section in sections if section.section != mapped]
            sections.append(StyleBibleSection(section=cast(Any, mapped), description=extra.description, directives=extra.directives, confidence=extra.confidence))
    ordered = ['camera', 'composition', 'movement', 'lighting', 'color', 'texture', 'performance', 'edit', 'sound']
    sections.sort(key=lambda section: ordered.index(section.section))
    return StyleBible(title=f'{brief.production_type.value.replace("_", " ").title()} Style Bible', sections=sections)


def build_scenes(brief: IntelligentBrief, story: StoryPlan, *, target_ms: int | None, depth: Literal['short_form', 'long_form'] = 'short_form') -> list[ScenePlan]:
    """Substantive canonical Scenes with functional purpose, action and states."""

    beats = story.beats
    count = len(beats)
    if depth == 'long_form' and target_ms is not None:
        count = min(len(beats), max(4, min(12, target_ms // 300000 or 6)))
        beats = story.beats[:count]
    weights = [1.6 if index == 0 else 1.0 for index in range(count)]
    durations = allocate_runtime(target_ms, count, weights) if target_ms is not None else [0 for _ in range(count)]
    environments = brief.environments or _default_environments(brief)
    characters = [character.name for character in build_characters(brief, story)]
    subject = _subject_phrase(brief)
    scenes: list[ScenePlan] = []
    for index, beat in enumerate(beats):
        environment = environments[index % len(environments)]
        purpose = f'{beat.story_function}. {beat.name} carries the {beat.emotion or "story"} turn for {brief.audience or "the viewer"}.'
        action = [
            beat.content.strip(),
            f'End the Scene on {beat.visual_idea.lower() or "one clear image"}.',
        ]
        if index == count - 1 and brief.call_to_action:
            action.append(f'Leave room for the closing line: "{brief.call_to_action}".')
        scene = ScenePlan(
            order=index + 1,
            title=beat.name,
            purpose=purpose,
            story_beat=beat.name,
            action=action,
            characters=characters[:2],
            environment=environment,
            products=[subject] if brief.product_brand and brief.production_type in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film} else [],
            dialogue_notes=brief.dialogue_approach or 'Dialogue approach is not resolved yet.',
            planned_duration_ms=durations[index],
            opening_state=f'State before {beat.name.lower()}: unresolved.',
            ending_state=f'State after {beat.name.lower()}: {beat.emotion or "advanced"}.',
            visual_intent=beat.visual_idea,
            techniques=beat.techniques,
        )
        if depth == 'short_form':
            scene = scene.model_copy(update={'shots': _initial_shots(scene, brief)})
        scenes.append(scene)
    return scenes


def _default_environments(brief: IntelligentBrief) -> list[str]:
    mapping = {
        ProductionType.commercial: ['Styled interior with controlled light', 'Product close-up surface'],
        ProductionType.advertisement: ['Recognisable everyday interior'],
        ProductionType.product_film: ['Dark seamless backdrop', 'Detail surface'],
        ProductionType.trailer: ['Exterior night street', 'Interior room with one practical'],
        ProductionType.short_film: ['Interior room with one practical'],
        ProductionType.youtube: ['Presenter frame with clean background'],
        ProductionType.social_video: ['Compact, well-lit frame'],
        ProductionType.music_video: ['Statement location', 'Abstract lighting set'],
    }
    return mapping.get(brief.production_type, ['Primary environment'])


def _initial_shots(scene: ScenePlan, brief: IntelligentBrief) -> list[ShotConcept]:
    subject = _subject_phrase(brief)
    return [
        ShotConcept(order=1, title=f'{scene.title} — establishing', description=f'Set the space for {scene.title.lower()} before any detail.', intent=scene.visual_intent or 'Establish place and mood.', subject=subject),
        ShotConcept(order=2, title=f'{scene.title} — core action', description=scene.action[0][:400], intent=scene.purpose[:200], subject=subject),
    ]


def build_script(brief: IntelligentBrief, story: StoryPlan, scenes: list[ScenePlan]) -> ScriptPlan:
    """Structured Script: Scene headings, action, dialogue/VO, on-screen text and Product direction."""

    mode = (brief.dialogue_approach or '').lower()
    dialogic_modes = {
        'full', 'minimal', 'voiceover', 'narration', 'host', 'interview',
    }
    speaks = brief.dialogue_mode in dialogic_modes
    if brief.dialogue_mode is None:
        speaks = any(token in mode for token in ('dialogue', 'voiceover', 'narration', 'presenter', 'subject answers'))
    subject = _subject_phrase(brief)
    script_scenes: list[ScriptScenePlan] = []
    for scene in scenes:
        interior = 'INT.' if 'interior' in scene.environment.lower() or 'room' in scene.environment.lower() or 'kitchen' in scene.environment.lower() else 'EXT.'
        heading = f'{interior} {scene.environment.upper()} — {"DAY" if "night" not in scene.environment.lower() else "NIGHT"}'
        action = [line[:900] for line in scene.action]
        lines: list[ScriptLine] = []
        order = 1
        if speaks:
            for candidate in _scene_lines(brief, scene, order):
                order = candidate.order + 1
                lines.append(candidate)
        if brief.call_to_action and scene.order == len(scenes):
            if speaks:
                text_ms = estimate_speech_ms(brief.call_to_action)
                lines.append(ScriptLine(
                    order=order, kind=DialogueKind.narration, content=brief.call_to_action, estimated_ms=text_ms,
                    intention='Close the Production on one action.', delivery='Calm, direct, unhurried.', scene_order=scene.order,
                ))
            else:
                action = [*action, f'ON SCREEN TEXT: "{brief.call_to_action}"']
        script_scenes.append(ScriptScenePlan(
            scene_order=scene.order, scene_title=scene.title, heading=heading, action=action, lines=lines,
            product_direction=(f'Frame {subject} so its defining detail reads without explanation.' if scene.products else ''),
            transition='Cut on the emotional change.' if scene.order < len(scenes) else 'Hold the final image.',
            notes=scene.dialogue_notes,
            planned_duration_ms=scene.planned_duration_ms,
        ))
    estimated = sum(scene.planned_duration_ms for scene in script_scenes)
    return ScriptPlan(
        title=story.title, scenes=script_scenes, dialogue_mode=brief.dialogue_mode,
        dialogue_approach=brief.dialogue_approach, estimated_runtime_ms=estimated,
    )


def _scene_lines(brief: IntelligentBrief, scene: ScenePlan, start_order: int) -> list[ScriptLine]:
    subject = _subject_phrase(brief)
    mode = brief.dialogue_mode
    approach = (brief.dialogue_approach or '').lower()
    lines: list[ScriptLine] = []
    order = start_order
    if mode in {'voiceover', 'narration'} or (mode is None and ('voiceover' in approach or 'narration' in approach)):
        content = f'{scene.title}: {scene.purpose}'[:400]
        lines.append(ScriptLine(order=order, kind=DialogueKind.voiceover, content=content, estimated_ms=estimate_speech_ms(content),
                                 intention=scene.purpose[:300], delivery='Measured, warm, never salesy.', scene_order=scene.order))
        order += 1
    elif mode == 'host' or (mode is None and ('presenter' in approach or 'host' in approach)):
        content = f'So here is the part that actually matters about {subject}: {scene.story_beat.lower()}.'[:400]
        lines.append(ScriptLine(order=order, kind=DialogueKind.dialogue, speaker=brief.cast[0] if brief.cast else 'Presenter', content=content,
                                 estimated_ms=estimate_speech_ms(content), intention='Hold attention by being specific.',
                                 delivery='Conversational, direct to camera.', scene_order=scene.order))
        order += 1
    elif mode == 'interview' or (mode is None and 'subject answers' in approach) or brief.production_type == ProductionType.interview:
        content = f'[Answer] What I keep coming back to is {scene.story_beat.lower()} — that is where it changed for me.'[:400]
        lines.append(ScriptLine(order=order, kind=DialogueKind.dialogue, speaker=brief.cast[0] if brief.cast else 'Interviewee', content=content,
                                 estimated_ms=estimate_speech_ms(content), intention='Sound like a person, not a spokesperson.',
                                 delivery='Plain speech; keep the pause before answering.', pause_after_ms=400, scene_order=scene.order))
        order += 1
    elif (mode in {'full', 'minimal'} or (mode is None and 'dialogue' in approach)) and (mode != 'minimal' or scene.order % 2 == 1):
        speaker = brief.cast[0] if brief.cast else (scene.characters[0] if scene.characters else 'Speaker')
        content = _dialogue_for(scene, subject)
        lines.append(ScriptLine(order=order, kind=DialogueKind.dialogue, speaker=speaker, content=content,
                                 estimated_ms=estimate_speech_ms(content), intention=f'Serve the {scene.story_beat.lower()} beat without explaining it.',
                                 delivery='Low and specific; let the pause carry the meaning.', subtext='They are not saying what they fear.', scene_order=scene.order))
        order += 1
        if scene.order > 1:
            lines.append(ScriptLine(order=order, kind=DialogueKind.reaction, speaker=None, content='[reaction hold, no line]',
                                     estimated_ms=900, intention='Let the previous line land before moving.', delivery='Silence.', reaction_to=order - 1, scene_order=scene.order))
            order += 1
    return lines


def _dialogue_for(scene: ScenePlan, subject: str) -> str:
    if scene.order == 1:
        return f'It was never about {subject}. It was about the part of the day nobody sees.'
    if 'product' in scene.title.lower() or 'reveal' in scene.title.lower():
        return f'This is the part I did not want to explain — you just have to see what {subject} does.'
    return 'I kept waiting for it to feel like a decision. Then it just felt obvious.'


def runtime_fit(bundle: CreativeBundle, target_ms: int | None) -> RuntimeFit:
    assigned = sum(scene.planned_duration_ms for scene in bundle.scenes)
    dialogue = sum(scene.dialogue_ms() for scene in (bundle.script.scenes if bundle.script else []))
    action = max(0, assigned - dialogue)
    findings: list[RuntimeFitFinding] = []
    status: Literal['fits', 'over', 'under', 'unresolved'] = 'unresolved'
    if target_ms is None:
        findings.append(RuntimeFitFinding(kind='fits', statement='No runtime target is set, so fit cannot be judged yet.', severity='info', fix='Set an exact, ranged or approximate runtime in the Brief.'))
        slack = 0
    else:
        slack = target_ms - assigned
        if dialogue > max(assigned, target_ms):
            findings.append(RuntimeFitFinding(
                kind='dialogue_too_long',
                statement=f'Spoken lines estimate {dialogue} ms against a {target_ms} ms Production.',
                severity='critical',
                fix='Shorten or remove lines, or extend the runtime target before applying this Script.',
            ))
        if bundle.script and bundle.script.scenes and len(bundle.script.scenes) > max(2, target_ms // 6000):
            findings.append(RuntimeFitFinding(
                kind='too_many_scenes',
                statement=f'{len(bundle.script.scenes)} Scenes for {target_ms} ms gives each Scene less than six seconds.',
                severity='warning',
                fix='Merge Scenes that share an environment and purpose.',
            ))
        if assigned > target_ms:
            status = 'over'
            findings.append(RuntimeFitFinding(kind='assigned_over', statement=f'Assigned Scene time exceeds the target by {assigned - target_ms} ms.', severity='critical', fix='Rebalance or remove Scene duration.'))
        elif assigned < target_ms:
            status = 'under'
            findings.append(RuntimeFitFinding(kind='assigned_under', statement=f'Assigned Scene time is {target_ms - assigned} ms short of the target.', severity='warning', fix='Give the hero Scene the remaining time rather than spreading it thinly.'))
        else:
            status = 'fits'
        if dialogue > 0 and dialogue > assigned:
            # Speaking time longer than the Production itself cannot fit, whatever the Scene sums say.
            status = 'over'
        if action < 400 and len(bundle.scenes) > 0 and dialogue > 0 and dialogue >= assigned:
            findings.append(RuntimeFitFinding(kind='pacing_too_dense', statement='No room is left for action or silence around the dialogue.', severity='warning', fix='Add breathing room or reduce the line count.'))
        if len(bundle.scenes) <= 1 and target_ms > 45000:
            findings.append(RuntimeFitFinding(kind='insufficient_material', statement='One Scene cannot carry this runtime without repetition.', severity='warning', fix='Add Story material before extending durations.'))
        if status == 'fits' and not findings:
            findings.append(RuntimeFitFinding(kind='fits', statement='Scene durations, speaking time and pauses fit the target runtime.', severity='info', fix='No change needed.'))
    return RuntimeFit(target_ms=target_ms, assigned_ms=assigned, dialogue_ms=dialogue, action_ms=action, slack_ms=slack, status=status, findings=findings)


def build_creative_bundle(
    brief: IntelligentBrief,
    *,
    target_ms: int | None,
    analyses: list[ReferenceAnalysis] | None = None,
    variation: str = 'original',
    variant_index: int = 0,
    producer: Literal['deterministic', 'model'] = 'deterministic',
    story_override: StoryPlan | None = None,
) -> CreativeBundle:
    long_form = brief.production_type in {ProductionType.long_form_film} or (target_ms is not None and target_ms >= 600000)
    story = story_override or build_story(brief, runtime_ms=target_ms, analyses=analyses, variation=variation, variant_index=variant_index)
    scenes = build_scenes(brief, story, target_ms=target_ms, depth='long_form' if long_form else 'short_form') if story else []
    script = build_script(brief, story, scenes) if story else None
    bundle = CreativeBundle(
        title=story.title if story else brief.production_goal.strip()[:80],
        story=story,
        scenes=scenes,
        script=script,
        characters=build_characters(brief, story),
        environments=build_environments(brief, scenes),
        products=build_products(brief, scenes),
        wardrobe_props=build_wardrobe_props(brief, scenes),
        style_bible=build_style_bible(brief, analyses),
        producer=producer,
        assumptions=story.assumptions if story else [],
    )
    return bundle.model_copy(update={'runtime_fit': runtime_fit(bundle, target_ms)})


LINE_OPERATIONS = Literal['rewrite', 'shorter', 'more_natural', 'more_intense', 'less_expository', 'more_humorous', 'three_alternatives']


def transform_line(content: str, operation: LINE_OPERATIONS) -> list[str]:
    """Deterministic line-level rewrites. Three alternatives are returned for every operation."""

    text = content.strip()
    hedges = ('I think ', 'maybe ', 'kind of ', 'sort of ', 'just ', 'actually ', 'really ')
    shortened = text
    for hedge in hedges:
        shortened = re.sub(rf'\b{re.escape(hedge)}\b\s*', '', shortened, flags=re.I)
    clauses = [clause.strip() for clause in re.split(r'(?<=[.!?])\s+|,\s+', shortened) if clause.strip()]
    compact = clauses[0] if clauses else shortened
    natural = re.sub(r'\bIt is\b', "It's", text)
    natural = re.sub(r'\bdo not\b', "don't", natural)
    natural = re.sub(r'\bthat is\b', "that's", natural)
    intense = re.sub(r'\b(is|was)\b', 'is', text)
    intense = re.sub(r'\bwant\b', 'need', intense, flags=re.I)
    intense = f'{intense.rstrip(".!?")}. No hesitation.' if intense else intense
    expository_markers = ("you can see", "as you can see", "it is important to note", "what this means is", "this shows that")
    lean = text
    for marker in expository_markers:
        lean = re.sub(rf'\b{re.escape(marker)}\b[,:]?\s*', '', lean, flags=re.I)
    lean = lean[0].upper() + lean[1:] if lean else lean
    humorous = f'{compact.rstrip(".!?")} — which is exactly the sort of plan that survives contact with a Tuesday.' if compact else compact
    if operation == 'shorter':
        return [compact, compact[: max(20, len(compact) // 2)].rstrip(' ,') + '.', ' '.join(clauses[:1]) or compact]
    if operation == 'more_natural':
        return [natural, natural.replace('—', ' - '), f'{natural.rstrip(".!?")}, honestly.']
    if operation == 'more_intense':
        return [intense, intense.replace('No hesitation.', 'Say it like you mean it.'), f'{compact.rstrip(".!?")}. Now.']
    if operation == 'less_expository':
        return [lean, lean.split('.')[0] + '.' if '.' in lean else lean, compact]
    if operation == 'more_humorous':
        return [humorous, f'{compact.rstrip(".!?")} — and yet, here we are.', f'{compact.rstrip(".!?")}. Charming.']
    if operation == 'three_alternatives':
        return [compact, natural, intense]
    return [f'{text}', f'{compact}', natural]
