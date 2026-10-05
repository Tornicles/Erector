from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.vocabulary import CollaborationMode, ExecutionMethod, ProductionType


class DirectorModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class EvidenceItem(DirectorModel):
    kind: Literal['description', 'upload', 'url', 'asset', 'document', 'audio', 'video', 'image']
    access: Literal['available', 'metadata_only', 'unavailable']
    source_id: UUID | None = None
    label: str = Field(max_length=500)


class ProductionConstraints(DirectorModel):
    crew_size: int | None = Field(default=None, ge=1, le=100)
    max_locations: int | None = Field(default=None, ge=1, le=100)
    locations: list[str] = Field(default_factory=list, max_length=30)
    required_locations: list[str] = Field(default_factory=list, max_length=30)
    budget_amount: float | None = Field(default=None, ge=0)
    available_hours: float | None = Field(default=None, ge=0)
    deadline: str | None = Field(default=None, max_length=80)
    production_requirements: list[str] = Field(default_factory=list, max_length=30)
    hard_constraints: list[str] = Field(default_factory=list, max_length=30)
    soft_preferences: list[str] = Field(default_factory=list, max_length=30)


class ProductionIntent(DirectorModel):
    goal: str = Field(min_length=1, max_length=10000)
    collaboration_mode: CollaborationMode = CollaborationMode.stop_at_major_decisions
    primary_type: ProductionType = ProductionType.custom
    secondary_types: list[ProductionType] = Field(default_factory=list, max_length=5)
    subject: str | None = Field(default=None, max_length=500)
    audience: str | None = Field(default=None, max_length=500)
    platform: str | None = Field(default=None, max_length=100)
    runtime_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    aspect_ratio: str | None = Field(default=None, max_length=20)
    execution: ExecutionMethod = ExecutionMethod.real
    execution_authority: Literal['creator', 'tonde_decides'] = 'creator'
    answered_decisions: dict[str, str] = Field(default_factory=dict, max_length=12)
    tonde_decided: list[str] = Field(default_factory=list, max_length=12)
    tone: list[str] = Field(default_factory=list, max_length=12)
    dialogue_mode: Literal['full', 'minimal', 'visual', 'voiceover', 'host', 'interview', 'music_only', 'silent', 'tonde_decides'] | None = None
    constraints: ProductionConstraints = Field(default_factory=ProductionConstraints)
    deliverables: list[str] = Field(default_factory=list, max_length=20)
    product_named: bool = False
    provenance: list[str] = Field(default_factory=list, max_length=12)
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=12)
    selected_reference_ids: list[UUID] = Field(default_factory=list, max_length=12)
    confidence: Literal['high', 'medium', 'low'] = 'low'


class BriefDecision(DirectorModel):
    id: str
    question: str
    why: str
    impact: Literal['critical', 'high', 'medium', 'low']
    options: list[str] = Field(default_factory=list, max_length=8)
    blocking: bool = False
    allow_tonde_decides: bool = True


class IntentResult(DirectorModel):
    intent: ProductionIntent
    questions: list[BriefDecision] = Field(default_factory=list, max_length=12)
    assumptions: list[str] = Field(default_factory=list, max_length=12)
    capability_notes: list[str] = Field(default_factory=list, max_length=12)


class InterpretRequest(DirectorModel):
    goal: str = Field(min_length=1, max_length=10000)
    collaboration_mode: CollaborationMode = CollaborationMode.stop_at_major_decisions
    answered_decisions: dict[str, str] = Field(default_factory=dict, max_length=12)


class SaveIntakeRequest(DirectorModel):
    expected_intake_revision: int | None = Field(default=None, ge=1)
    intent: ProductionIntent


class SceneDraft(DirectorModel):
    title: str = Field(min_length=1, max_length=160)
    purpose: str = Field(default='', max_length=2000)
    description: str = Field(default='', max_length=4000)
    duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)


class StoryDraft(DirectorModel):
    structure: list[str] = Field(default_factory=list, max_length=12)
    summary: str = Field(min_length=1, max_length=10000)
    dialogue_mode: str | None = None


class ProductionDraft(DirectorModel):
    title: str = Field(min_length=1, max_length=160)
    production_type: ProductionType
    execution_method: ExecutionMethod
    planned_duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    creative_objective: str = Field(min_length=1, max_length=10000)
    scenes: list[SceneDraft] = Field(default_factory=list, max_length=40)
    story: StoryDraft | None = None
    assumptions: list[str] = Field(default_factory=list, max_length=12)
    requirements: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode='after')
    def exact_runtime(self) -> 'ProductionDraft':
        if self.planned_duration_ms is not None:
            if not self.scenes or any(scene.duration_ms is None for scene in self.scenes):
                raise ValueError('Timed plans require timed Scenes.')
            if sum(scene.duration_ms or 0 for scene in self.scenes) != self.planned_duration_ms:
                raise ValueError('Scene durations must equal the target runtime exactly.')
        return self


class ProposePlanRequest(DirectorModel):
    operation_id: UUID


class ApplyPlanRequest(DirectorModel):
    operation_id: UUID
    explicit_confirmation: bool


class ResourceMatch(DirectorModel):
    requirement: str
    status: Literal['owned', 'approximate', 'missing', 'optional', 'ai_substitute', 'simplify']
    resource: str | None = None
    recommendation: str
    confidence: Literal['high', 'medium', 'low']


class RealityAssessment(DirectorModel):
    feasibility: Literal['ready', 'adapt', 'blocked']
    complexity: Literal['simple', 'moderate', 'complex']
    matches: list[ResourceMatch] = Field(default_factory=list, max_length=40)
    conflicts: list[str] = Field(default_factory=list, max_length=20)
    summary: str


def _runtime_context_score(text: str, match: re.Match[str]) -> int:
    before = text[max(0, match.start() - 60):match.start()].lower()
    after = text[match.end():match.end() + 60].lower()
    score = 0
    if re.search(r"\b(make|create|produce|video|film|commercial|ad|trailer|runtime|duration|length)\b", before):
        score += 2
    if re.search(r"\b(video|film|commercial|ad|trailer|runtime|duration|long|short)\b", after):
        score += 5
    if re.search(r"\b(?:i have|available|only)\s*$", before) or re.match(r"\s*(?:to shoot|for shooting|of shoot)", after):
        score -= 10
    elif re.search(r"\b(?:to shoot|shooting|available|budget|deadline)\b", before):
        score -= 2
    return score


def _runtime(text: str) -> int | None:
    pattern = r"(?<!\d)(\d+(?:\.\d+)?)[\s-]*(minutes?|mins?|min|seconds?|secs?|sec|hours?|hrs?|hr)\b"
    matches = list(re.finditer(pattern, text, re.I))
    if not matches:
        return None
    match = max(matches, key=lambda item: (_runtime_context_score(text, item), -item.start()))
    amount = float(match.group(1))
    unit = match.group(2).lower()
    multiplier = 3600000 if unit.startswith('h') else 60000 if unit.startswith('min') else 1000
    value = round(amount * multiplier)
    return value if value <= 9007199254740991 else None


def _extract_constraints(text: str) -> ProductionConstraints:
    lower = text.lower()
    hours = re.search(r"\b(?:i have|available|only)\s+(\d+(?:\.\d+)?)\s*hours?\b", lower)
    minutes = re.search(r"\b(?:i have|available|only)\s+(\d+(?:\.\d+)?)\s*minutes?\b", lower)
    available_hours = float(hours.group(1)) if hours else (float(minutes.group(1)) / 60 if minutes else None)
    solo = bool(re.search(
        r"\b(by myself|just me|myself|on my own|alone|solo|one-person|one person|one-man|one man|single-handed)\b",
        lower,
    ))
    single_camera = bool(re.search(r"\b(?:one|1|single|a single)\s*-?\s*cameras?\b", lower)) or 'one-man band' in lower
    single_light = bool(re.search(r"\b(?:one|1|single)\s*-?\s*lights?\b", lower))
    if 'one camera' in lower or '1 camera' in lower or 'single camera' in lower:
        single_camera = True
    if 'one light' in lower or '1 light' in lower or 'single light' in lower:
        single_light = True
    requirements: list[str] = []
    if 'drone' in lower or 'aerial' in lower:
        requirements.append('Drone / aerial capture')
    if 'crowd' in lower or re.search(r"\b\d+\s+(actors|performers|talent)\b", lower):
        requirements.append('Multiple on-camera performers')
    if 'three-camera' in lower or 'three camera' in lower:
        requirements.append('Three-camera interview coverage')
    if single_camera:
        requirements.append('Single-camera coverage')
    if single_light:
        requirements.append('Single-light setup')
    # A creator who names a camera and a light and describes shooting it themselves is a crew of one.
    if not solo and single_camera and re.search(r"\b(i can|i'll|ill|i will|shoot it|film it)\b", lower):
        solo = True
    hard = ['Solo creator / crew of one'] if solo else []
    if single_camera:
        hard.append('Single-camera coverage')
    if single_light:
        hard.append('Single-light setup')
    if available_hours is not None:
        hard.append(f'Available shoot time: {available_hours:g} hours')
    return ProductionConstraints(
        crew_size=1 if solo else None,
        available_hours=available_hours,
        production_requirements=requirements,
        hard_constraints=hard,
    )

def interpret_intent(goal: str, *, known_context: dict[str, Any] | None = None,
                     evidence: list[EvidenceItem] | None = None,
                     collaboration_mode: CollaborationMode = CollaborationMode.stop_at_major_decisions) -> IntentResult:
    """Deterministic conservative baseline; AI adapter is optional and currently unconfigured."""
    if not goal.strip():
        raise ValueError('Describe what you want to make.')
    text = goal.strip()[:10000]
    lower = text.lower()
    known = known_context or {}
    kind = ProductionType.custom
    if 'product photography' in lower:
        kind = ProductionType.product_photography
    elif 'music video' in lower:
        kind = ProductionType.music_video
    elif any(word in lower for word in ('photo', 'photograph', 'portrait', 'still image')):
        kind = ProductionType.photography
    elif 'documentary' in lower:
        kind = ProductionType.documentary
    elif 'interview' in lower:
        kind = ProductionType.interview
    elif 'trailer' in lower:
        kind = ProductionType.trailer
    elif 'movie' in lower or 'film' in lower:
        kind = ProductionType.long_form_film if (_runtime(lower) or 0) >= 15 * 60 * 1000 else ProductionType.short_film
    elif any(word in lower for word in ('series', 'every day', 'every weekday', 'each weekday', 'daily', 'weekly', '90 tiktok', '90 finance')):
        kind = ProductionType.recurring_content
    if re.search(r'\d+\s+(?:finance\s+)?tiktoks?', lower) or 'videos every day' in lower or re.search(r'(?:video|videos|content|episode|episodes).{0,35}(?:every|each)\s+(?:weekday|week|day|monday|tuesday|wednesday|thursday|friday)', lower) or re.search(r'(?:every|each)\s+(?:weekday|week|day|monday|tuesday|wednesday|thursday|friday).{0,35}(?:video|videos|content|episode|episodes)', lower):
        kind = ProductionType.recurring_content
    elif 'youtube' in lower and not any(word in lower for word in ('ad', 'advertisement', 'commercial')):
        kind = ProductionType.youtube
    elif any(word in lower for word in ('ad', 'advertisement', 'commercial')):
        kind = ProductionType.commercial
    elif any(word in lower for word in ('tiktok', 'reel', 'short-form', 'short form')):
        kind = ProductionType.social_video
    if any(word in lower for word in ('ad', 'advertisement', 'commercial')) and kind in {ProductionType.social_video, ProductionType.youtube}:
        ad_type = ProductionType.social_video if kind == ProductionType.social_video else ProductionType.commercial
    else:
        ad_type = None
    if 'trailer' in lower:
        secondary_types = [ProductionType.trailer, ProductionType.short_film]
    elif ad_type == ProductionType.social_video:
        secondary_types = [ProductionType.commercial, ProductionType.product_film]
    elif kind == ProductionType.commercial and 'product' in lower:
        secondary_types = [ProductionType.advertisement, ProductionType.product_film]
    else:
        secondary_types = []

    platform = next((name for name in ('TikTok', 'Instagram Reels', 'YouTube Shorts', 'YouTube', 'cinema') if name.lower() in lower), None)
    runtime = _runtime(text)
    ratio = '9:16' if platform and platform.lower() in ('tiktok', 'instagram reels', 'youtube shorts') else None
    execution = ExecutionMethod.ai if re.search(r'\b(ai creation|generate with ai|ai only)\b', lower) else ExecutionMethod.real
    if 'hybrid' in lower:
        execution = ExecutionMethod.hybrid
    elif 'tonde decides' in lower:
        execution = ExecutionMethod.real
    subject = None
    if any(word in lower for word in ('ad', 'advertisement', 'commercial')) and not re.search(r'\b(?:ad|advertisement|commercial)\s+for\b', lower):
        kind = ProductionType.commercial if kind != ProductionType.social_video else kind
    product_named = False
    for pattern in (r'commercial for (?:my )?(.+?)(?:[,.]|$)', r'ad for (?:my )?(.+?)(?:[,.]|$)', r'documentary about (.+?)(?:[,.]|$)', r'interview with (.+?)(?:[,.]|$)'):
        found = re.search(pattern, text, re.I)
        if found:
            candidate = found.group(1).strip()[:500]
            if candidate.lower() not in {'company', 'business', 'brand', 'my company', 'my business', 'my brand'}:
                subject = candidate
                product_named = True
            break
    if subject is None:
        # A Product category was implied ("a premium coffee commercial") without naming a brand.
        # The category is used as the creative subject; the brand stays an open creator decision.
        implied = re.search(r'([\w-]+(?:\s+[\w-]+){0,2})\s+(?:commercial|ad|advertisement)\b', lower)
        if implied:
            tokens = [
                token for token in implied.group(1).split()
                if token not in {'a', 'an', 'the', 'my', 'our', 'your', 'this', 'that', 'some', 'another', 'second', 'new'}
                and not re.fullmatch(r'\d+(?:\s*-\s*\d+)?\s*-?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|hr|hrs)?', token)
            ]
            if tokens:
                subject = ' '.join(tokens)[:500]
    if not known.get('constraints'):
        known = known | {'constraints': _extract_constraints(text)}
    supplied_type = known.get('production_type')
    if isinstance(supplied_type, str) and supplied_type in ProductionType.__members__ and (supplied_type != 'custom' or kind == ProductionType.custom):
        kind = ProductionType(supplied_type)
    answered = known.get('answered_decisions', {})
    if not isinstance(answered, dict):
        answered = {}
    if answered.get('dialogue_mode'):
        known = known | {'dialogue_mode': answered['dialogue_mode']}
    if answered.get('runtime') and known.get('runtime_ms') is None:
        answer_runtime = _runtime(str(answered['runtime']))
        if answer_runtime is not None:
            known = known | {'runtime_ms': answer_runtime}
    if answered.get('product') and not known.get('subject'):
        known = known | {'subject': str(answered['product'])[:500]}
    if ad_type is not None:
        kind = ad_type
    if kind in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film, ProductionType.social_video} and any(word in lower for word in ('ad', 'advertisement', 'commercial')) and not subject and answered.get('product'):
        subject = str(answered['product'])[:500]
    if kind == ProductionType.short_film and not subject and answered.get('premise'):
        subject = str(answered['premise'])[:500]
    runtime_value = known.get('runtime_ms', runtime)
    runtime = runtime_value if isinstance(runtime_value, int) and not isinstance(runtime_value, bool) else runtime
    tonde_chosen_runtime = answered.get('runtime') == 'TONDE decides'
    if runtime is None and kind != ProductionType.photography and (tonde_chosen_runtime or collaboration_mode == CollaborationMode.complete_first_draft):
        runtime = 30000
    platform = known.get('platform', platform)
    if platform is None and runtime is not None and kind != ProductionType.photography:
        # Still an assumption, never silently persist as creator fact.
        pass
    if kind == ProductionType.photography:
        runtime = None
    if answered.get('platform'):
        platform = str(answered['platform'])[:100]
    resolved_subject = known.get('subject', subject)
    if resolved_subject is None and answered.get('product'):
        resolved_subject = str(answered['product'])[:500]
    if resolved_subject is None and answered.get('subject'):
        resolved_subject = str(answered['subject'])[:500]
    if resolved_subject is not None and answered.get('product'):
        product_named = True
    if resolved_subject is None:
        product_named = False
    intent = ProductionIntent(goal=text, collaboration_mode=collaboration_mode, primary_type=kind, secondary_types=secondary_types, subject=resolved_subject,
        audience=known.get('audience'), platform=platform, runtime_ms=runtime,
        aspect_ratio=known.get('aspect_ratio', ratio), execution=ExecutionMethod(known.get('execution', execution)),
        execution_authority='tonde_decides' if re.search(r'\btonde decides\b', lower) else 'creator',
        answered_decisions={str(key): str(value)[:500] for key, value in answered.items() if isinstance(key, str) and isinstance(value, (str, int, float, bool))},
        tonde_decided=[str(key) for key, value in answered.items() if isinstance(key, str) and str(value).lower() == 'tonde decides'],
        dialogue_mode=known.get('dialogue_mode') or ('visual' if kind == ProductionType.photography else ('interview' if kind == ProductionType.interview else None)),
        confidence='medium' if kind != ProductionType.custom else 'low', evidence=evidence or [],
        product_named=product_named,
        selected_reference_ids=known.get('selected_reference_ids', []), constraints=known.get('constraints', _extract_constraints(text)))
    questions: list[BriefDecision] = []
    if kind in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film, ProductionType.social_video} and any(word in lower for word in ('ad','advertisement','commercial')) and not intent.product_named and not answered.get('product'):
        questions.append(BriefDecision(
            id='product',
            question=(f'Which {intent.subject} brand or Product is this for?' if intent.subject else 'What product or service is this for?'),
            why='The Product determines the message, proof and hero moments.', impact='critical', options=[], blocking=True,
        ))
    if kind in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film, ProductionType.social_video, ProductionType.youtube} and not intent.platform and not answered.get('platform'):
        questions.append(BriefDecision(id='platform', question='Where will this Production be used?', why='Platform changes framing, pacing and delivery format.', impact='high', options=['TikTok / Reels','YouTube','Website','TONDE decides'], blocking=False))
    if kind == ProductionType.short_film and re.search(r'\b(short film|original movie)\b', lower) and not intent.subject and not answered.get('premise'):
        questions.append(BriefDecision(id='premise', question='What is the central idea or premise?', why='A premise gives the first story structure a clear dramatic direction.', impact='critical', options=[], blocking=True))
    if kind == ProductionType.recurring_content and not (isinstance(answered,dict) and answered.get('series_horizon')):
        questions.append(BriefDecision(id='series_horizon', question='Should TONDE outline the full 90-day Series or prepare a smaller first batch?', why='The initial structure should establish the cadence without generating dozens of complete Productions.', impact='high', options=['Outline the 90-day Series','Prepare the first 7','TONDE decides']))
    if kind in {ProductionType.short_film, ProductionType.long_form_film, ProductionType.trailer} and intent.dialogue_mode is None and not (isinstance(answered,dict) and answered.get('dialogue_mode')):
        questions.append(BriefDecision(id='dialogue_mode', question='Should this rely on dialogue, minimal dialogue, or mostly visual storytelling?', why='Dialogue changes script, scene timing and audio requirements.', impact='high', options=['Full dialogue','Minimal dialogue','Mostly visual','TONDE decides']))
    if runtime is None and kind != ProductionType.photography and not (isinstance(answered,dict) and answered.get('runtime')) and not (collaboration_mode == CollaborationMode.complete_first_draft and tonde_chosen_runtime):
        questions.append(BriefDecision(id='runtime', question='What target runtime should this fit?', why='Runtime determines how much structure can fit.', impact='high', options=['15 seconds','30 seconds','60 seconds','TONDE decides']))
    notes = []
    for item in evidence or []:
        if item.kind in {'url', 'video'} and item.access != 'available':
            notes.append(f'{item.label}: metadata/media access is not verified; no frame or audio analysis is available.')
        elif item.kind in {'image','video','audio','upload'}:
            notes.append(f'{item.label}: uploaded, but no analysis has been run; do not treat it as observed evidence.')
    assumptions = []
    if tonde_chosen_runtime or (runtime == 30000 and known.get('runtime_ms') is None and collaboration_mode == CollaborationMode.complete_first_draft):
        assumptions.append('TONDE selected a provisional 30-second runtime because no target was supplied; revise it before detailed planning.')
    if ratio and not known.get('aspect_ratio'):
        assumptions.append(f'Recommended format {ratio} based on {platform}; editable, not user-stated.')
    if collaboration_mode == CollaborationMode.complete_first_draft:
        questions = [q for q in questions if q.blocking]
    return IntentResult(intent=intent, questions=questions, assumptions=assumptions, capability_notes=notes)


def runtime_scenes(target_ms: int, count: int) -> list[int]:
    if not 1 <= count <= 40 or not 0 <= target_ms <= 9007199254740991:
        raise ValueError('Runtime and scene count are outside supported bounds.')
    quotient, remainder = divmod(target_ms, count)
    return [quotient + (1 if index < remainder else 0) for index in range(count)]


def build_draft(intent: ProductionIntent) -> ProductionDraft:
    title = intent.subject or intent.goal.splitlines()[0].strip()
    title = re.sub(r'^(make|create|build|i want to make|i need)\s+', '', title, flags=re.I).strip(' .,:;-') or 'Untitled Production'
    title = title[:160]
    if intent.primary_type == ProductionType.photography:
        return ProductionDraft(title=title, production_type=intent.primary_type, execution_method=intent.execution,
            creative_objective=intent.goal, scenes=[], story=None, assumptions=['Still photography has no runtime; Studio can direct shot concepts without artificial Scenes.'],
            requirements=['Reference image or written composition description','Subject and intended use'])
    seconds = intent.runtime_ms // 1000 if intent.runtime_ms is not None else 30
    count = 1 if seconds < 20 else 3 if seconds < 120 else min(8, max(4, seconds // 240))
    if intent.primary_type in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film}:
        count = min(4, len({ProductionType.commercial: ['Hook', 'Product benefit', 'Proof / hero reveal', 'Call to action'], ProductionType.advertisement: ['Hook', 'Problem / promise', 'Proof', 'Call to action'], ProductionType.product_film: ['Hook', 'Product benefit', 'Proof / hero reveal', 'Call to action']}[intent.primary_type]))
    if intent.primary_type == ProductionType.long_form_film:
        count = min(12, max(6, seconds // 300))
    if intent.primary_type == ProductionType.recurring_content:
        count = 3
    if intent.primary_type == ProductionType.photography:
        count = 0
    durations: list[int | None] = list(runtime_scenes(intent.runtime_ms, count)) if intent.runtime_ms is not None else [None for _ in range(count)]
    structures = {
        ProductionType.recurring_content: ['Series premise and audience','Repeatable episode format','Cadence and initial preparation horizon'],
        ProductionType.long_form_film: ['Act I: premise and inciting event','Act II: escalating conflict and turning point','Act III: climax and resolution'],
        ProductionType.commercial: ['Hook', 'Product benefit', 'Proof / hero reveal', 'Call to action'],
        ProductionType.advertisement: ['Hook', 'Problem / promise', 'Proof', 'Call to action'],
        ProductionType.social_video: ['Hook', 'Context', 'Value / payoff'],
        ProductionType.documentary: ['Central question', 'Context / perspectives', 'Evidence / conclusion'],
        ProductionType.interview: ['Opening', 'Context / question arc', 'Closing'],
        ProductionType.youtube: ['Hook', 'Context', 'Main value', 'Payoff / CTA'],
        ProductionType.trailer: ['Hook', 'World / setup', 'Escalation', 'Title / release beat'],
    }
    beats = structures.get(intent.primary_type, ['Setup', 'Progression', 'Payoff'])
    if intent.primary_type in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film}:
        count = min(count, len(beats))
        # `count` was already bounded by the same four-beat commercial structure.
        # Keep the exact allocation computed above to retain one typed timing source.
    scenes = [SceneDraft(title=beats[min(i, len(beats)-1)], purpose=beats[min(i, len(beats)-1)], duration_ms=durations[i]) for i in range(count)]
    story = None if intent.primary_type == ProductionType.photography else StoryDraft(structure=beats, summary=f'Original {intent.primary_type.value.replace("_", " ")} direction for: {intent.goal}', dialogue_mode=intent.dialogue_mode)
    return ProductionDraft(title=title, production_type=intent.primary_type, execution_method=intent.execution,
        planned_duration_ms=intent.runtime_ms, creative_objective=intent.goal, scenes=scenes, story=story,
        assumptions=(['Routine story choices are provisional and editable.'] if intent.confidence != 'high' else []),
        requirements=['Production requirements will be reconciled against Setup; no equipment is assumed owned.'])


def assess_reality(plan: ProductionDraft, resources: list[dict[str, Any]], constraints: ProductionConstraints | dict[str, Any] | None = None) -> RealityAssessment:
    owned = [str(x.get('name','')).lower() for x in resources]
    constraints = constraints or {}
    constraint_data = constraints.model_dump() if isinstance(constraints, ProductionConstraints) else constraints
    crew = constraint_data.get('crew_size')
    matches: list[ResourceMatch] = []
    if plan.execution_method != ExecutionMethod.ai and plan.production_type != ProductionType.photography:
        camera = next((x.get('name') for x in resources if x.get('resource_type') in {'camera','phone_camera'}), None)
        matches.append(ResourceMatch(requirement='Camera for the planned physical production', status='owned' if camera else 'missing', resource=str(camera) if camera else None,
            recommendation=f'Use the listed {camera}.' if camera else 'No camera is listed in Setup. Confirm a suitable camera or adapt the plan to accessible equipment; no purchase is assumed.', confidence='medium'))
    for requirement in (constraints.production_requirements if isinstance(constraints, ProductionConstraints) else constraint_data.get('production_requirements', [])):
        normalized = str(requirement).lower()
        if 'drone' in normalized or 'aerial' in normalized:
            drone = next((x for x in owned if 'drone' in x), None)
            matches.append(ResourceMatch(requirement='Drone / aerial capture', status='owned' if drone else 'missing', resource=drone,
                recommendation='Use the listed drone and an authorized operator.' if drone else 'Use an establishing shot from an accessible height or an AI alternative; no drone is listed in Setup.', confidence='medium'))
        elif 'performer' in normalized and crew == 1:
            matches.append(ResourceMatch(requirement='Multiple on-camera performers', status='simplify',
                recommendation='Rewrite for one visible performer with off-screen voices, silhouettes, or a single-location interaction.', confidence='medium'))
        elif 'three-camera' in normalized:
            cameras = sum(1 for item in resources if item.get('resource_type') in {'camera','phone_camera'})
            matches.append(ResourceMatch(requirement='Three-camera interview coverage', status='owned' if cameras >= 3 else 'approximate', resource=f'{cameras} camera(s) listed',
                recommendation='Use the listed three-camera kit.' if cameras >= 3 else 'Capture a master and repeatable singles sequentially if the interview can be paused.', confidence='medium'))
    conflicts = []
    max_locations = constraint_data.get('max_locations')
    if isinstance(max_locations,int) and max_locations > 0:
        requested = constraint_data.get('required_locations', [])
        if isinstance(requested, list) and all(isinstance(item, str) for item in requested) and len(set(requested)) > max_locations:
            conflicts.append(f'The plan requires {len(set(requested))} locations but the hard limit is {max_locations}.')
    allowed = constraint_data.get('locations')
    requested_locations = constraint_data.get('required_locations', [])
    if isinstance(allowed, list) and isinstance(requested_locations, list) and all(isinstance(item, str) for item in allowed + requested_locations) and any(item not in allowed for item in requested_locations):
        conflicts.append('A requested location is outside the stated location constraint.')
    complexity: Literal['simple', 'moderate', 'complex'] = 'simple' if len(plan.scenes) <= 2 else 'moderate' if len(plan.scenes) <= 6 else 'complex'
    requires_adaptation = any(match.status in {'approximate', 'missing', 'simplify', 'ai_substitute'} for match in matches)
    feasibility: Literal['ready', 'adapt', 'blocked'] = 'blocked' if conflicts else 'adapt' if requires_adaptation else 'ready'
    summary = 'Resolve the stated constraint before applying this plan.' if conflicts else (
        'Adapt the plan to the listed resource gaps.' if requires_adaptation
        else 'No blocking Setup gap was identified from the available context.'
    )
    return RealityAssessment(feasibility=feasibility, complexity=complexity, matches=matches, conflicts=conflicts, summary=summary)
