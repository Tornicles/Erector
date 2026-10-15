from __future__ import annotations

from typing import Any, Literal, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.analysis import (
    CapabilityReport,
    QualitativeConfidence,
    ReferenceAnalysis,
    ReferenceRole,
    StyleDNA,
)
from app.domain.director import ProductionConstraints, ProductionIntent
from app.domain.vocabulary import CollaborationMode, ProductionType


class BriefModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


QUESTION_PRIORITY = Literal['blocking', 'high_impact', 'optional']


class RuntimeTarget(BriefModel):
    """Exact, range or approximate runtime. Never silently rounded to a single number."""

    kind: Literal['exact', 'range', 'approximate', 'none'] = 'none'
    exact_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    min_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    max_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    note: str = Field(default='', max_length=300)

    @model_validator(mode='after')
    def consistent(self) -> 'RuntimeTarget':
        if self.kind == 'exact' and self.exact_ms is None:
            raise ValueError('An exact runtime target needs exact milliseconds.')
        if self.kind == 'range':
            if self.min_ms is None or self.max_ms is None or self.max_ms < self.min_ms:
                raise ValueError('A runtime range needs ordered bounds.')
        if self.kind == 'none' and any(value is not None for value in (self.exact_ms, self.min_ms, self.max_ms)):
            raise ValueError('An unresolved runtime target cannot carry milliseconds.')
        return self

    @property
    def planning_ms(self) -> int | None:
        """Deterministic planning value used for structure sizing only."""
        if self.kind == 'exact':
            return self.exact_ms
        if self.kind == 'range' and self.min_ms is not None and self.max_ms is not None:
            return (self.min_ms + self.max_ms) // 2
        if self.kind == 'approximate':
            return self.max_ms if self.max_ms is not None else self.min_ms
        return None

    def label(self) -> str:
        if self.kind == 'exact':
            return f'{self.exact_ms} ms exact'
        if self.kind == 'range':
            return f'{self.min_ms}–{self.max_ms} ms'
        if self.kind == 'approximate':
            return f'approximately {self.planning_ms} ms'
        return 'unresolved'


class BriefConflict(BriefModel):
    topic: str = Field(min_length=1, max_length=160)
    values: list[str] = Field(min_length=2, max_length=6)
    impact: Literal['critical', 'high', 'optional'] = 'high'
    resolution: str = Field(min_length=1, max_length=600)
    resolved_by: Literal['tonde_proposal', 'creator_decision', 'open'] = 'tonde_proposal'


class MissingDecision(BriefModel):
    """One consequential decision the Production depends on."""

    id: str = Field(min_length=1, max_length=80)
    question: str = Field(min_length=1, max_length=400)
    why: str = Field(min_length=1, max_length=500)
    priority: QUESTION_PRIORITY
    impact: Literal['critical', 'high', 'medium', 'low']
    confidence: QualitativeConfidence
    decision_maker: Literal['creator', 'tonde_decides', 'deferred'] = 'creator'
    depends_on: list[str] = Field(default_factory=list, max_length=4)
    options: list[str] = Field(default_factory=list, max_length=8)
    allow_tonde_decides: bool = True
    answered: bool = False
    answer: str | None = Field(default=None, max_length=500)
    would_change: list[str] = Field(default_factory=list, max_length=6)

    @model_validator(mode='after')
    def blocking_is_critical(self) -> 'MissingDecision':
        if self.priority == 'blocking' and self.impact != 'critical':
            raise ValueError('A blocking decision must have critical impact.')
        return self


class BriefAssumption(BriefModel):
    statement: str = Field(min_length=1, max_length=600)
    basis: str = Field(default='', max_length=300)
    status: Literal['assumption', 'creator_confirmed', 'tonde_default'] = 'assumption'


class IntelligentBrief(BriefModel):
    """First-class Production Brief. Every field is either creator-stated or explicitly marked inferred."""

    production_goal: str = Field(min_length=1, max_length=10000)
    audience: str | None = Field(default=None, max_length=500)
    core_message: str | None = Field(default=None, max_length=600)
    desired_response: str | None = Field(default=None, max_length=400)
    production_type: ProductionType = ProductionType.custom
    format: str | None = Field(default=None, max_length=120)
    platform: str | None = Field(default=None, max_length=100)
    runtime: RuntimeTarget = Field(default_factory=RuntimeTarget)
    aspect_ratio: str | None = Field(default=None, max_length=20)
    tone: list[str] = Field(default_factory=list, max_length=12)
    creative_concept: str = Field(default='', max_length=1600)
    story_approach: str = Field(default='', max_length=1600)
    dialogue_mode: Literal['full', 'minimal', 'visual', 'voiceover', 'narration', 'host', 'interview', 'music_only', 'silent'] | None = None
    dialogue_approach: str | None = Field(default=None, max_length=600)
    voiceover_approach: str | None = Field(default=None, max_length=600)
    product_brand: str | None = Field(default=None, max_length=500)
    product_category: str | None = Field(default=None, max_length=500)
    call_to_action: str | None = Field(default=None, max_length=400)
    style_direction: list[str] = Field(default_factory=list, max_length=20)
    style_dna: StyleDNA | None = None
    execution_preference: Literal['real', 'ai', 'hybrid'] | None = None
    resources: list[str] = Field(default_factory=list, max_length=30)
    crew_size: int | None = Field(default=None, ge=1, le=100)
    available_hours: float | None = Field(default=None, ge=0)
    deadline: str | None = Field(default=None, max_length=80)
    budget_amount: float | None = Field(default=None, ge=0)
    cast: list[str] = Field(default_factory=list, max_length=20)
    environments: list[str] = Field(default_factory=list, max_length=20)
    reference_ids: list[UUID] = Field(default_factory=list, max_length=12)
    reference_roles: dict[str, ReferenceRole] = Field(default_factory=dict, max_length=12)
    deliverables: list[str] = Field(default_factory=list, max_length=20)
    hard_constraints: list[str] = Field(default_factory=list, max_length=30)
    soft_preferences: list[str] = Field(default_factory=list, max_length=30)
    assumptions: list[BriefAssumption] = Field(default_factory=list, max_length=20)
    open_decisions: list[MissingDecision] = Field(default_factory=list, max_length=20)
    conflicts: list[BriefConflict] = Field(default_factory=list, max_length=10)
    reference_capabilities: dict[str, CapabilityReport] = Field(default_factory=dict, max_length=12)
    collaboration_mode: CollaborationMode = CollaborationMode.stop_at_major_decisions
    producer: Literal['deterministic', 'model'] = 'deterministic'
    revision: int = Field(default=1, ge=1)

    def answered(self, decision_id: str) -> bool:
        return any(item.id == decision_id and (item.answered or item.answer) for item in self.open_decisions)

    def blocking_decisions(self) -> list[MissingDecision]:
        return [item for item in self.open_decisions if item.priority == 'blocking' and not item.answered]


def runtime_target(runtime_ms: int | None, *, kind: Literal['exact', 'range', 'approximate', 'none'] | None = None) -> RuntimeTarget:
    if runtime_ms is None:
        return RuntimeTarget(kind='none')
    return RuntimeTarget(kind=kind or 'exact', exact_ms=runtime_ms)


STORY_APPROACH: dict[ProductionType, str] = {
    ProductionType.commercial: 'Hook the viewer, earn the Product moment, prove the promise, then close on one call to action.',
    ProductionType.advertisement: 'Open on the tension the Product resolves, demonstrate the promise, then invite the response.',
    ProductionType.product_film: 'Withhold the hero Product detail, build sensory desire around it, then reveal it at full strength.',
    ProductionType.social_video: 'Win the first two seconds, deliver one clear value, end on a repeatable payoff.',
    ProductionType.youtube: 'Promise something specific, deliver it in visible sections, then pay it off and invite the next step.',
    ProductionType.trailer: 'Establish the world, introduce the disruption, escalate the stakes, withhold resolution, land the title.',
    ProductionType.short_film: 'Place a character under pressure, let the choice cost something, resolve on a changed state.',
    ProductionType.long_form_film: 'Build an act structure where each turning point removes an easier option.',
    ProductionType.documentary: 'Pose the central question, weigh evidence from more than one perspective, end on what the evidence supports.',
    ProductionType.interview: 'Set context, arc the questions from concrete to revealing, close on the future.',
    ProductionType.music_video: 'Let the track drive the visual arc; performance, story or abstraction can carry it.',
    ProductionType.recurring_content: 'Repeat a recognisable format so the audience can predict the shape and stay for the value.',
    ProductionType.photography: 'Resolve one visual idea: subject, light and composition carrying a single message.',
    ProductionType.portrait: 'Resolve one honest moment of a person: expression, light and framing carrying who they are.',
    ProductionType.product_photography: 'Make one visual claim about the Product: form, material and light doing the selling.',
    ProductionType.fashion: 'Build a look and an attitude; the wardrobe carries the story before any words do.',
    ProductionType.food: 'Make the food the event: texture, steam and the first bite are the payoff.',
    ProductionType.automotive: 'Let the machine move through a world that shows what it is for.',
    ProductionType.architecture: 'Reveal the space in the order a person would actually experience it.',
    ProductionType.campaign: 'One idea expressed across several deliverables, each one standing alone.',
    ProductionType.thumbnail: 'One readable subject, one contrast, one reason to click.',
    ProductionType.poster: 'One image and one line carrying the whole promise.',
    ProductionType.series: 'Establish the recurring shape so each instalment can vary inside a recognisable format.',
    ProductionType.custom: 'Tell one clear story: a beginning, a turn and a resolution that carries the creator intent.',
}


def _inferred(subject: str | None, production_type: ProductionType) -> tuple[str | None, str | None, str | None]:
    """Derived message/response/CTA. Always recorded as an assumption, never as creator fact."""

    commercial_types = {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film, ProductionType.social_video}
    if production_type not in commercial_types:
        return None, None, None
    if not subject:
        return None, None, None
    return (
        f'{subject} is the better choice for the people this Production is for.',
        'The viewer should feel that choice is obvious.',
        f'Invite the viewer to choose {subject} now.',
    )


def _role_for(capability: CapabilityReport, index: int) -> ReferenceRole:
    if capability.modalities.image == 'available' and capability.modalities.audio != 'available':
        return ReferenceRole.composition
    if capability.modalities.video_frames == 'available':
        return ReferenceRole.camera if index == 0 else ReferenceRole.lighting
    if capability.modalities.text == 'available':
        return ReferenceRole.story
    return ReferenceRole.style


def build_brief(
    intent: ProductionIntent,
    *,
    analyses: list[ReferenceAnalysis] | None = None,
    setups: list[dict[str, Any]] | None = None,
    answered: dict[str, str] | None = None,
    include_optional: bool = False,
) -> IntelligentBrief:
    """Compose the structured Brief. Deterministic domain logic, explicitly labelled as such."""

    answers = dict(answered or intent.answered_decisions or {})
    analyses = analyses or []
    setups = setups or []
    stated_product = answers.get('product') if answers.get('product') not in {None, 'TONDE decides'} else None
    subject = stated_product or intent.subject
    # A named Product is creator-stated; an implied category is only a creative subject. Never conflate them.
    named = bool(stated_product) or (intent.product_named and intent.subject is not None)
    message, response, cta = _inferred(subject, intent.primary_type)
    if answered_value := answers.get('call_to_action'):
        cta = answered_value
    dialogue_map = {
        'full': 'Scripted dialogue carries the story; write it for real performance timing.',
        'minimal': 'Sparse, purposeful dialogue with generous visual room.',
        'visual': 'No spoken dialogue; the story is carried visually and through sound.',
        'voiceover': 'A single voiceover narrates and guides the viewer.',
        'narration': 'Narration frames the story; keep it lean.',
        'host': 'A presenter speaks to camera and drives the structure.',
        'interview': 'Subject answers arc from context to revelation.',
        'music_only': 'No dialogue; the track carries the emotional arc.',
        'silent': 'No dialogue and no music; sound design and image only.',
    }
    cast_mode: Literal['full', 'minimal', 'visual', 'voiceover', 'narration', 'host', 'interview', 'music_only', 'silent'] | None = None
    if intent.dialogue_mode in {'full', 'minimal', 'visual', 'voiceover', 'narration', 'host', 'interview', 'music_only', 'silent'}:
        cast_mode = cast(Literal['full', 'minimal', 'visual', 'voiceover', 'narration', 'host', 'interview', 'music_only', 'silent'], intent.dialogue_mode)
    dialogue_approach = dialogue_map.get(intent.dialogue_mode or '', None)
    voiceover_approach = dialogue_map['voiceover'] if intent.dialogue_mode in {'voiceover', 'narration'} else None
    capabilities = {str(analysis.reference_id): analysis.capability for analysis in analyses if analysis.reference_id is not None}
    roles = {str(analysis.reference_id): analysis.role for analysis in analyses if analysis.reference_id is not None}
    style_sections: list[str] = []
    style_dna: StyleDNA | None = None
    adaptation_notes: list[str] = []
    for index, analysis in enumerate(analyses):
        style_sections.extend(f'{section.section}: {section.description}' for section in analysis.style.sections)
        adaptation_notes.extend(analysis.adaptation_notes)
        if style_dna is None and analysis.style.sections:
            style_dna = analysis.style
    resources = [str(item.get('name')) for item in setups if item.get('name')]
    constraints: ProductionConstraints = intent.constraints
    conflicts = detect_conflicts(intent, analyses)
    assumptions: list[BriefAssumption] = []
    for note in intent.provenance:
        assumptions.append(BriefAssumption(statement=note, basis='Director intake', status='creator_confirmed'))
    if message and not answers.get('core_message'):
        assumptions.append(BriefAssumption(statement=f'Core message inferred from the Product and Production type: "{message}".', basis='Production type grammar', status='assumption'))
    if cta and not answers.get('cta'):
        assumptions.append(BriefAssumption(statement=f'Closing invitation inferred: "{cta}".', basis='Commercial structure', status='assumption'))
    if not named and intent.primary_type in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film, ProductionType.social_video}:
        assumptions.append(BriefAssumption(
            statement=(f'The Product category reads as "{subject}", but no brand or Product name was supplied, so Product identity stays unresolved.'
                       if subject else 'No Product was named, so the message and hero moments stay unresolved.'),
            basis='Missing Product decision', status='assumption',
        ))
    if subject and not named:
        assumptions.append(BriefAssumption(
            statement=f'Creative direction is built around the implied Product category "{subject}", not a named brand.',
            basis='Goal wording', status='assumption',
        ))
    if intent.aspect_ratio:
        assumptions.append(BriefAssumption(statement=f'Aspect ratio {intent.aspect_ratio} follows the stated platform, not a creator instruction.', basis='Platform default', status='assumption'))
    if intent.execution_authority == 'tonde_decides' and intent.execution is not None:
        assumptions.append(BriefAssumption(statement=f'Execution method {intent.execution.value} was chosen by TONDE and can be changed.', basis='Collaboration mode', status='tonde_default'))
    for analysis in analyses:
        if analysis.capability.capability.value != 'full_media_available':
            assumptions.append(BriefAssumption(statement=f'Reference {analysis.reference_id} analysis is limited: {analysis.capability.note}', basis='Reference capability', status='assumption'))
    open_decisions = plan_questions(intent, answered=answers, analyses=analyses, include_optional=include_optional)
    return IntelligentBrief(
        production_goal=intent.goal,
        audience=intent.audience or answers.get('audience') or None,
        core_message=answers.get('core_message') or message,
        desired_response=answers.get('desired_response') or response,
        production_type=intent.primary_type,
        format=answers.get('format') or ('still image' if intent.primary_type == ProductionType.photography else 'moving image'),
        platform=intent.platform or answers.get('platform') or None,
        runtime=runtime_target(intent.runtime_ms),
        aspect_ratio=intent.aspect_ratio,
        tone=intent.tone or ([answers['tone']] if answers.get('tone') else []),
        creative_concept=(
            f'{subject}: {intent.goal.strip()[:600]}' if subject else intent.goal.strip()[:600]
        ),
        story_approach=STORY_APPROACH.get(intent.primary_type) or STORY_APPROACH[ProductionType.custom],
        dialogue_mode=cast_mode,
        dialogue_approach=dialogue_approach,
        voiceover_approach=voiceover_approach,
        product_brand=subject if named else None,
        product_category=subject if subject and not named else None,
        call_to_action=answers.get('cta') or cta,
        style_direction=[*style_sections[:12], *adaptation_notes[:4]],
        style_dna=style_dna,
        execution_preference=intent.execution.value if intent.execution is not None else None,
        resources=resources[:30],
        crew_size=constraints.crew_size,
        available_hours=constraints.available_hours,
        deadline=constraints.deadline,
        budget_amount=constraints.budget_amount,
        cast=[answers['cast']] if answers.get('cast') else [],
        environments=[answers['environment']] if answers.get('environment') else [],
        reference_ids=list(intent.selected_reference_ids),
        reference_roles=roles,
        deliverables=intent.deliverables or ([answers['deliverable']] if answers.get('deliverable') else []),
        hard_constraints=constraints.hard_constraints,
        soft_preferences=constraints.soft_preferences,
        assumptions=assumptions,
        open_decisions=open_decisions,
        conflicts=conflicts,
        reference_capabilities=capabilities,
        collaboration_mode=intent.collaboration_mode,
    )


def detect_conflicts(intent: ProductionIntent, analyses: list[ReferenceAnalysis]) -> list[BriefConflict]:
    """Contradictory inputs are detected, not silently flattened."""

    conflicts: list[BriefConflict] = []
    style_values: dict[str, set[str]] = {}
    for analysis in analyses:
        for section in analysis.style.sections:
            if section.section in {'editing', 'movement', 'lighting', 'palette', 'contrast'}:
                style_values.setdefault(section.section, set()).add(section.description.lower())
    pacing = style_values.get('editing', set())
    if any('slow' in value or 'contemplative' in value for value in pacing) and any('fast' in value or 'rapid' in value or 'energetic' in value for value in pacing):
        conflicts.append(BriefConflict(
            topic='Pacing', values=sorted(pacing)[:2], impact='high',
            resolution='Assign each Reference a role (for example pacing versus lighting) or choose one pacing register for the Story.',
            resolved_by='creator_decision',
        ))
    constraints = intent.constraints
    if constraints.available_hours is not None and intent.runtime_ms is not None:
        if constraints.available_hours < 0.5 and (intent.runtime_ms >= 120000 or len(constraints.required_locations) > 2):
            conflicts.append(BriefConflict(
                topic='Available time versus planned scope', values=[f'{constraints.available_hours:g} working hours', f'{intent.runtime_ms} ms with {len(constraints.required_locations)} location requirement(s)'],
                impact='critical',
                resolution='Reduce locations and Scene count, or extend the shoot window before the Story is written.',
                resolved_by='open',
            ))
    if intent.primary_type == ProductionType.photography and intent.runtime_ms is not None:
        conflicts.append(BriefConflict(
            topic='Runtime on a still Production', values=['photography', f'{intent.runtime_ms} ms'], impact='optional',
            resolution='Still photography has no runtime; the runtime target is ignored for structure sizing.',
            resolved_by='tonde_proposal',
        ))
    return conflicts


def plan_questions(
    intent: ProductionIntent,
    *,
    answered: dict[str, str] | None = None,
    analyses: list[ReferenceAnalysis] | None = None,
    include_optional: bool = False,
    requested: list[str] | None = None,
) -> list[MissingDecision]:
    """Adaptive question engine: impact, confidence, dependency, collaboration mode, dedup."""

    answers = dict(answered or intent.answered_decisions or {})
    kind = intent.primary_type
    commercial_types = {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film, ProductionType.social_video}
    decisions: list[MissingDecision] = []

    def answer_for(decision_id: str) -> str | None:
        value = answers.get(decision_id)
        if value is None:
            return None
        return value

    def add(**kwargs: Any) -> None:
        value = answer_for(kwargs['id'])
        decisions.append(MissingDecision(
            **kwargs,
            answered=value is not None,
            answer=value,
            decision_maker='tonde_decides' if value == 'TONDE decides' else ('creator' if value is None else 'creator'),
        ))

    subject = intent.subject or answers.get('product')
    product_named = intent.product_named or bool(answers.get('product'))
    if kind in commercial_types and not product_named:
        add(id='product', question=(f'Which {subject} brand or Product is this for?' if subject else 'What product or service is this for?'),
            why=('The Product category is implied but the brand is not; identity changes the message, proof and hero moments.'
                 if subject else 'The product determines the message, proof and hero moments.'),
            priority='blocking', impact='critical', confidence=QualitativeConfidence.low,
            would_change=['Story', 'Product requirements', 'Script', 'Call to action'] + (['Brand fidelity'] if subject else []))
    if kind in {ProductionType.short_film, ProductionType.long_form_film} and not intent.subject and not answers.get('premise') and 'short film' in intent.goal.lower():
        add(id='premise', question='What is the central idea or premise?', why='A premise gives the first story structure a clear dramatic direction.',
            priority='blocking', impact='critical', confidence=QualitativeConfidence.low,
            would_change=['Story', 'Characters', 'Scenes'])
    if kind in commercial_types | {ProductionType.youtube} and not intent.platform and not answers.get('platform'):
        add(id='platform', question='Where will this Production be used?', why='Platform changes framing, pacing and delivery format.',
            priority='high_impact', impact='high', confidence=QualitativeConfidence.medium,
            options=['TikTok / Reels', 'YouTube', 'Website', 'TONDE decides'],
            would_change=['Format', 'Pacing', 'Runtime distribution'])
    if kind in {ProductionType.short_film, ProductionType.long_form_film, ProductionType.trailer, ProductionType.music_video} and intent.dialogue_mode is None and not answers.get('dialogue_mode'):
        add(id='dialogue_mode', question='Should this rely on dialogue, minimal dialogue, or mostly visual storytelling?', why='Dialogue changes script, scene timing and audio requirements.',
            priority='high_impact', impact='high', confidence=QualitativeConfidence.low,
            options=['Full dialogue', 'Minimal dialogue', 'Mostly visual', 'TONDE decides'],
            would_change=['Script', 'Dialogue timing', 'Audio requirements'])
    if kind == ProductionType.recurring_content and not answers.get('series_horizon'):
        add(id='series_horizon', question='Should TONDE outline the full 90-day Series or prepare a smaller first batch?', why='The initial structure should establish the cadence without generating dozens of complete Productions.',
            priority='high_impact', impact='high', confidence=QualitativeConfidence.medium,
            options=['Outline the 90-day Series', 'Prepare the first 7', 'TONDE decides'],
            would_change=['Series structure', 'Episode count'])
    if kind != ProductionType.photography and intent.runtime_ms is None and not answers.get('runtime'):
        add(id='runtime', question='What target runtime should this fit?', why='Runtime determines how much structure can fit.',
            priority='high_impact', impact='high', confidence=QualitativeConfidence.medium,
            options=['15 seconds', '30 seconds', '60 seconds', 'TONDE decides'],
            would_change=['Scene count', 'Scene durations', 'Script length'])
    if include_optional:
        analysis_list = analyses or []
        if kind in commercial_types and not answers.get('cta'):
            add(id='cta', question='What should the closing invitation say?', why='A commercial needs one clear response; this is the last thing the viewer keeps.',
                priority='optional', impact='medium', confidence=QualitativeConfidence.medium,
                depends_on=['product'], options=['Buy now', 'Learn more', 'Visit the shop', 'TONDE decides'])
        if not answers.get('audience') and intent.audience is None:
            add(id='audience', question='Who should this speak to?', why='Audience changes tone, casting and reference choice.',
                priority='optional', impact='medium', confidence=QualitativeConfidence.low)
        if not answers.get('tone') and not intent.tone:
            add(id='tone', question='What tone should this hold?', why='Tone governs performance, palette and sound direction.',
                priority='optional', impact='medium', confidence=QualitativeConfidence.low,
                options=['Warm', 'Premium', 'Playful', 'Tense', 'Documentary-neutral'])
        if kind in commercial_types and not analysis_list and not answers.get('deliverable'):
            add(id='reference', question='Do you want to bring a Reference for direction?', why='A Reference gives TONDE real observed evidence instead of assumptions.',
                priority='optional', impact='medium', confidence=QualitativeConfidence.medium)

    if intent.collaboration_mode == CollaborationMode.complete_first_draft:
        decisions = [item for item in decisions if item.priority == 'blocking' and not item.answered]
    elif intent.collaboration_mode == CollaborationMode.guide_step_by_step:
        decisions = [item for item in decisions if item.priority != 'optional'] + [item for item in decisions if item.priority == 'optional'][:2]
    else:
        decisions = [item for item in decisions if item.priority != 'optional']
    if requested is not None:
        decisions = [item for item in decisions if item.id in set(requested)]
    return decisions


def apply_corrections(brief: IntelligentBrief, corrections: dict[str, str]) -> IntelligentBrief:
    """A creator correction becomes settled context; the Director must not re-ask or re-infer it."""

    updated = brief.model_copy(deep=True)
    for decision_id, value in corrections.items():
        for index, decision in enumerate(updated.open_decisions):
            if decision.id == decision_id:
                updated.open_decisions[index] = decision.model_copy(update={'answered': True, 'answer': value, 'confidence': QualitativeConfidence.high})
    if 'product' in corrections:
        updated.product_brand = corrections['product']
    if 'audience' in corrections:
        updated.audience = corrections['audience']
    if 'platform' in corrections:
        updated.platform = corrections['platform']
    if 'core_message' in corrections:
        updated.core_message = corrections['core_message']
    if 'cta' in corrections:
        updated.call_to_action = corrections['cta']
    if 'tone' in corrections:
        updated.tone = [corrections['tone']]
    corrected = {key.lower() for key in corrections}
    subject_terms = {value.lower() for value in corrections.values() if value}
    updated.assumptions = [
        item for item in updated.assumptions
        if item.status != 'assumption' or not any(
            token in item.statement.lower() or any(term and term in item.statement.lower() for term in subject_terms if len(term) > 2)
            for token in corrected
        )
    ]
    return updated
