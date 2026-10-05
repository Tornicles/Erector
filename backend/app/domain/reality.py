from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.analysis import QualitativeConfidence
from app.domain.brief import IntelligentBrief
from app.domain.creative import CreativeBundle
from app.domain.vocabulary import ExecutionMethod, ProductionType


class RealityModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RealityDomain(StrEnum):
    camera = 'camera'
    lens = 'lens'
    movement = 'movement'
    lighting = 'lighting'
    audio = 'audio'
    talent = 'talent'
    crew = 'crew'
    environment = 'environment'
    time = 'time'
    budget = 'budget'
    safety = 'safety'
    ai_suitability = 'ai_suitability'


class RealityStatus(StrEnum):
    owned_ready = 'owned_ready'
    missing = 'missing'
    approximate_substitute = 'approximate_substitute'
    rent_buy_option = 'rent_buy_option'
    ai_alternative = 'ai_alternative'
    creative_alternative = 'creative_alternative'
    requires_decision = 'requires_decision'
    not_required = 'not_required'


INVENTORY_TYPES: dict[RealityDomain, set[str]] = {
    RealityDomain.camera: {'camera', 'phone_camera'},
    RealityDomain.lens: {'lens'},
    RealityDomain.movement: {'gimbal', 'tripod', 'monopod', 'slider', 'rigging'},
    RealityDomain.lighting: {'light', 'modifier', 'stand'},
    RealityDomain.audio: {'microphone', 'recorder', 'wireless_audio'},
    RealityDomain.environment: {'accessory'},
    RealityDomain.ai_suitability: {'ai_tool', 'editing_software', 'photo_software'},
}

GAP_STATES = {
    RealityStatus.missing, RealityStatus.approximate_substitute, RealityStatus.rent_buy_option,
    RealityStatus.ai_alternative, RealityStatus.creative_alternative, RealityStatus.requires_decision,
}


class RealityItem(RealityModel):
    domain: RealityDomain
    requirement: str = Field(min_length=1, max_length=300)
    status: RealityStatus
    resource: str | None = Field(default=None, max_length=200)
    evidence: list[str] = Field(default_factory=list, max_length=6)
    recommendation: str = Field(min_length=1, max_length=700)
    confidence: QualitativeConfidence = QualitativeConfidence.medium
    price_claimed: bool = False

    @model_validator(mode='after')
    def never_invents_prices(self) -> 'RealityItem':
        if self.price_claimed:
            raise ValueError('Prompt 4 Reality Check never states prices.')
        return self


class RealityAdaptation(RealityModel):
    """Reality Check must be able to change the plan, not only warn about it."""

    scope: Literal['production', 'story', 'script', 'scene', 'shot']
    target: str = Field(min_length=1, max_length=160)
    change: str = Field(min_length=1, max_length=600)
    reason: str = Field(min_length=1, max_length=400)


class ModeRecommendation(RealityModel):
    method: ExecutionMethod
    rationale: str = Field(min_length=1, max_length=700)
    conditions: list[str] = Field(default_factory=list, max_length=6)


class RealityReport(RealityModel):
    feasibility: Literal['ready', 'adapt', 'blocked'] = 'ready'
    complexity: Literal['simple', 'moderate', 'complex'] = 'simple'
    items: list[RealityItem] = Field(default_factory=list, max_length=60)
    domains: dict[str, str] = Field(default_factory=dict, max_length=12)
    conflicts: list[str] = Field(default_factory=list, max_length=20)
    adaptations: list[RealityAdaptation] = Field(default_factory=list, max_length=20)
    mode: ModeRecommendation | None = None
    summary: str = Field(min_length=1, max_length=900)
    inventory_used: list[str] = Field(default_factory=list, max_length=60)
    notes: list[str] = Field(default_factory=list, max_length=12)

    def items_for(self, domain: RealityDomain) -> list[RealityItem]:
        return [item for item in self.items if item.domain == domain]

    def gaps(self) -> list[RealityItem]:
        return [item for item in self.items if item.status in GAP_STATES]


def _inventory(setup: list[dict[str, Any]], domain: RealityDomain) -> list[str]:
    names: list[str] = []
    for item in setup:
        resource_type = str(item.get('resource_type') or '')
        if resource_type in INVENTORY_TYPES.get(domain, set()):
            name = str(item.get('name') or resource_type).strip()
            if name and name not in names:
                names.append(name)
    return names


def _first(setup: list[dict[str, Any]], resource_types: set[str]) -> str | None:
    for item in setup:
        if str(item.get('resource_type') or '') in resource_types:
            return str(item.get('name') or item.get('resource_type'))
    return None


def estimate_shoot_minutes(bundle: CreativeBundle, brief: IntelligentBrief) -> int:
    """Deterministic planning estimate from Scene count, environment count and dialogue load."""

    setup_minutes = 25
    per_environment = 45
    per_scene = 30
    dialogue_minutes = 0
    if bundle.script:
        for scene in bundle.script.scenes:
            for _line in scene.lines:
                dialogue_minutes += 6
    scenes = max(1, len(bundle.scenes))
    environments = max(1, len({scene.environment for scene in bundle.scenes}) or 1)
    shots = sum(len(scene.shots) for scene in bundle.scenes) or scenes
    baseline = setup_minutes + per_environment * environments + per_scene * scenes + dialogue_minutes + max(0, shots - scenes) * 5
    if brief.execution_preference == 'ai':
        baseline = max(45, baseline // 3)
    return baseline


def recommend_mode(
    brief: IntelligentBrief, *, setup: list[dict[str, Any]], gaps: list[RealityItem], target_ms: int | None,
) -> ModeRecommendation:
    has_camera = bool(_inventory(setup, RealityDomain.camera))
    physical_gaps = [item for item in gaps if item.domain in {RealityDomain.camera, RealityDomain.lighting, RealityDomain.environment, RealityDomain.safety}]
    generation_tools = _inventory(setup, RealityDomain.ai_suitability)
    conditions: list[str] = []
    if brief.execution_preference == 'ai':
        conditions.append('Creator asked for AI execution.')
        return ModeRecommendation(method=ExecutionMethod.ai, rationale='The creator selected AI creation; keep the same Story and Shots.', conditions=conditions)
    if has_camera and not physical_gaps:
        return ModeRecommendation(
            method=ExecutionMethod.real,
            rationale='Your Setup covers the physical requirements of this plan, so Real Production stays the default face.',
            conditions=conditions,
        )
    if has_camera and physical_gaps:
        conditions.append('Shots that depend on missing equipment are the hybrid candidates.')
        return ModeRecommendation(
            method=ExecutionMethod.hybrid,
            rationale='You can shoot most of this, but ' + ', '.join(sorted({item.domain.value for item in physical_gaps})) + ' needs an AI or creative substitute.',
            conditions=conditions,
        )
    if generation_tools:
        conditions.append('Assign generation per Shot; Prompt 7 makes this Shot-level.')
        return ModeRecommendation(
            method=ExecutionMethod.ai,
            rationale='No camera is listed in Setup, and generation tools are. Build the same Story with AI execution where it is honest to do so.',
            conditions=conditions,
        )
    conditions.append('Add a camera or generation tool to Setup, or reduce the plan.')
    return ModeRecommendation(
        method=ExecutionMethod.hybrid,
        rationale='Neither an owned camera nor a generation tool is listed, so this plan cannot be committed to Real or AI yet.',
        conditions=conditions,
    )


def assess_full_reality(
    bundle: CreativeBundle,
    setup: list[dict[str, Any]],
    brief: IntelligentBrief,
    *,
    target_ms: int | None,
) -> RealityReport:
    """Complete Setup comparison across every production domain. Prices are never invented."""

    items: list[RealityItem] = []
    conflicts: list[str] = []
    adaptations: list[RealityAdaptation] = []
    notes: list[str] = []
    ai_execution = brief.execution_preference == 'ai'

    camera = _first(setup, INVENTORY_TYPES[RealityDomain.camera])
    if ai_execution:
        items.append(RealityItem(domain=RealityDomain.camera, requirement='Camera for physical capture', status=RealityStatus.not_required,
                                 recommendation='AI execution was chosen, so no camera is required.', confidence=QualitativeConfidence.high))
    elif camera:
        items.append(RealityItem(domain=RealityDomain.camera, requirement='Camera for the planned physical production', status=RealityStatus.owned_ready,
                                 resource=camera, evidence=[camera], recommendation=f'Shoot on the listed {camera}.', confidence=QualitativeConfidence.high))
    else:
        items.append(RealityItem(domain=RealityDomain.camera, requirement='Camera for the planned physical production', status=RealityStatus.requires_decision,
                                 recommendation='No camera is listed in Setup. Confirm one, rent/buy on your own terms, or move these Scenes to AI execution. TONDE does not quote prices.',
                                 confidence=QualitativeConfidence.high))
        adaptations.append(RealityAdaptation(scope='production', target='Execution method', change='Move the shots that need a camera to AI execution until a camera is available.',
                                             reason='Setup lists no camera.'))

    lens = _first(setup, INVENTORY_TYPES[RealityDomain.lens])
    if not ai_execution:
        if lens:
            items.append(RealityItem(domain=RealityDomain.lens, requirement='Lens coverage for the planned framing', status=RealityStatus.owned_ready,
                                     resource=lens, evidence=[lens], recommendation=f'Use {lens} and check the widest framing you need before shooting.',
                                     confidence=QualitativeConfidence.medium))
        elif camera:
            items.append(RealityItem(domain=RealityDomain.lens, requirement='Lens coverage for the planned framing', status=RealityStatus.approximate_substitute,
                                     resource=camera, recommendation='No lens is listed; the camera body alone must cover every framing, so keep the Shot concepts inside one focal family.',
                                     confidence=QualitativeConfidence.medium))
            adaptations.append(RealityAdaptation(scope='shot', target='Shot framing', change='Keep every initial Shot inside a single focal family.',
                                                 reason='No lens is listed in Setup.'))

    movement_items = _inventory(setup, RealityDomain.movement)
    if not ai_execution and any(len(scene.shots) > 1 for scene in bundle.scenes):
        if movement_items:
            items.append(RealityItem(domain=RealityDomain.movement, requirement='Stabilisation for moving coverage', status=RealityStatus.owned_ready,
                                     resource=movement_items[0], evidence=movement_items, recommendation=f'Use {movement_items[0]}; a locked-off alternative is always available.',
                                     confidence=QualitativeConfidence.medium))
        else:
            items.append(RealityItem(domain=RealityDomain.movement, requirement='Stabilisation for moving coverage', status=RealityStatus.creative_alternative,
                                     recommendation='No support is listed. Make the movement depend on a locked-off frame or an in-frame subject move instead.',
                                     confidence=QualitativeConfidence.medium))
            adaptations.append(RealityAdaptation(scope='shot', target='Camera movement', change='Replace planned moves with locked-off frames and subject movement.',
                                                 reason='No stabilisation is listed in Setup.'))

    lights = _inventory(setup, RealityDomain.lighting)
    if not ai_execution:
        if lights:
            items.append(RealityItem(domain=RealityDomain.lighting, requirement='Controlled key lighting', status=RealityStatus.owned_ready,
                                     resource=lights[0], evidence=lights, recommendation=f'Key on {lights[0]} and use ambient as fill only.', confidence=QualitativeConfidence.high))
        else:
            items.append(RealityItem(domain=RealityDomain.lighting, requirement='Controlled key lighting', status=RealityStatus.creative_alternative,
                                     recommendation='No light is listed, so the plan must lean on available window light and practicals — or move those Scenes to AI execution.',
                                     confidence=QualitativeConfidence.medium))
            adaptations.append(RealityAdaptation(scope='scene', target='Lighting plan', change='Shoot available-light only and schedule around window light.',
                                                 reason='No lighting equipment is listed in Setup.'))

    speaking = bool(bundle.script and any(scene.lines for scene in bundle.script.scenes))
    if speaking:
        audio = _inventory(setup, RealityDomain.audio)
        if audio:
            items.append(RealityItem(domain=RealityDomain.audio, requirement='Dialogue capture', status=RealityStatus.owned_ready,
                                     resource=audio[0], evidence=audio, recommendation=f'Record dialogue on {audio[0]} and keep one room tone per environment.',
                                     confidence=QualitativeConfidence.high))
        else:
            items.append(RealityItem(domain=RealityDomain.audio, requirement='Dialogue capture', status=RealityStatus.requires_decision,
                                     recommendation='Scripted lines exist but no microphone is listed. Either record with the best available device, or cut the lines and go visual.',
                                     confidence=QualitativeConfidence.high))
            adaptations.append(RealityAdaptation(scope='script', target='Dialogue', change='Cut or replace spoken lines with visual beats until audio capture exists.',
                                                 reason='No audio equipment is listed in Setup.'))

    performers = [character for character in bundle.characters if character.role.lower() not in {'product handler'}]
    crew_size = brief.crew_size if isinstance(brief.crew_size, int) else None
    if performers and crew_size == 1:
        items.append(RealityItem(domain=RealityDomain.talent, requirement=f'{len(performers)} on-camera performance(s)', status=RealityStatus.creative_alternative,
                                 recommendation='With a crew of one, keep performance on the creator: off-screen voices, reaction-only coverage, or an object-led Story.',
                                 confidence=QualitativeConfidence.medium))
        adaptations.append(RealityAdaptation(scope='story', target='Performance', change='Reduce to one on-camera performer and move other dialogue off-screen.',
                                             reason='The creator is working alone.'))
    elif performers:
        items.append(RealityItem(domain=RealityDomain.talent, requirement=f'{len(performers)} on-camera performance(s)', status=RealityStatus.requires_decision,
                                 recommendation='Confirm who performs each character before Scene timing is locked.', confidence=QualitativeConfidence.medium))
    else:
        items.append(RealityItem(domain=RealityDomain.talent, requirement='On-camera performance', status=RealityStatus.not_required,
                                 recommendation='No on-camera performance is required by this plan.', confidence=QualitativeConfidence.high))

    if not ai_execution:
        items.append(RealityItem(domain=RealityDomain.crew, requirement='Crew for the planned coverage', status=RealityStatus.owned_ready if crew_size else RealityStatus.requires_decision,
                                 resource=f'crew of {crew_size}' if crew_size else None,
                                 recommendation=f'Plan for a crew of {crew_size}.' if crew_size else 'Crew size is unstated; a one-person crew changes how many Scenes can be covered in a session.',
                                 confidence=QualitativeConfidence.medium))

    environment_names = [environment.name for environment in bundle.environments]
    if environment_names:
        items.append(RealityItem(domain=RealityDomain.environment, requirement=f'{len(environment_names)} creative environment(s)', status=RealityStatus.requires_decision,
                                 recommendation='Creative Environments are not shooting Locations. Confirm a real place for each Environment before shooting; none is assumed.',
                                 evidence=environment_names[:4], confidence=QualitativeConfidence.medium))

    shoot_minutes = estimate_shoot_minutes(bundle, brief)
    if brief.available_hours is not None:
        available_minutes = int(brief.available_hours * 60)
        if shoot_minutes > available_minutes:
            items.append(RealityItem(domain=RealityDomain.time, requirement=f'{shoot_minutes} minutes of planned shooting', status=RealityStatus.creative_alternative,
                                     evidence=[f'{brief.available_hours:g} available hours', f'{shoot_minutes} planned minutes'],
                                     recommendation='Trim Scene count or coverage until the plan fits the available window; the estimate is planning logic, not a promise.',
                                     confidence=QualitativeConfidence.medium))
            adaptations.append(RealityAdaptation(scope='scene', target='Scene count', change=f'Reduce coverage to fit roughly {brief.available_hours:g} hours.',
                                                 reason='Planned shooting time exceeds the available window.'))
            conflicts.append(f'Available time ({brief.available_hours:g}h) is below the planning estimate ({shoot_minutes} min).')
        else:
            items.append(RealityItem(domain=RealityDomain.time, requirement=f'{shoot_minutes} minutes of planned shooting', status=RealityStatus.owned_ready,
                                     evidence=[f'{brief.available_hours:g} available hours'],
                                     recommendation='The planning estimate fits the stated window, with no margin claimed.', confidence=QualitativeConfidence.medium))
    else:
        items.append(RealityItem(domain=RealityDomain.time, requirement=f'{shoot_minutes} minutes of planned shooting', status=RealityStatus.requires_decision,
                                 recommendation='No shoot window was stated. This estimate is planning logic; confirm your real availability.', confidence=QualitativeConfidence.low))

    if brief.budget_amount is not None:
        items.append(RealityItem(domain=RealityDomain.budget, requirement='Budget for the stated setup gaps', status=RealityStatus.requires_decision,
                                 recommendation='A budget figure was provided, but Prompt 4 does not estimate costs. Decide rent/buy yourself against the gaps above.',
                                 confidence=QualitativeConfidence.low))
    else:
        items.append(RealityItem(domain=RealityDomain.budget, requirement='Budget', status=RealityStatus.not_required,
                                 recommendation='No budget was provided and no price is estimated.', confidence=QualitativeConfidence.high))

    safety_flags: list[str] = []
    if any('night' in scene.environment.lower() for scene in bundle.scenes):
        safety_flags.append('night exterior')
    if any('drone' in item.lower() or 'aerial' in item.lower() for item in brief.hard_constraints + brief.soft_preferences):
        safety_flags.append('aerial work')
    if safety_flags:
        items.append(RealityItem(domain=RealityDomain.safety, requirement='Safety review', status=RealityStatus.requires_decision,
                                 evidence=safety_flags, recommendation='Plan ' + ', '.join(safety_flags) + ' with a second person and a check of local permissions before shooting.',
                                 confidence=QualitativeConfidence.medium))
    else:
        items.append(RealityItem(domain=RealityDomain.safety, requirement='Safety review', status=RealityStatus.not_required,
                                 recommendation='No elevated safety requirement was identified from the plan.', confidence=QualitativeConfidence.low))

    ai_candidates = [scene.title for scene in bundle.scenes if 'withhold' in scene.story_beat.lower() or 'abstraction' in scene.story_beat.lower()]
    items.append(RealityItem(
        domain=RealityDomain.ai_suitability,
        requirement='Scenes that are better generated than shot',
        status=RealityStatus.ai_alternative if ai_candidates else RealityStatus.not_required,
        evidence=ai_candidates[:4],
        recommendation=('These Scenes depend on imagery that is hard to produce physically: ' + ', '.join(ai_candidates[:3]) + '.') if ai_candidates else 'Every Scene is achievable physically with the stated Setup.',
        confidence=QualitativeConfidence.low,
    ))
    if brief.production_type == ProductionType.photography:
        notes.append('Still photography has no runtime, so the time estimate covers shot setup only.')

    domains: dict[str, str] = {}
    for domain in RealityDomain:
        domain_items = [item for item in items if item.domain == domain]
        if not domain_items:
            continue
        if any(item.status == RealityStatus.requires_decision for item in domain_items):
            domains[domain.value] = RealityStatus.requires_decision.value
        elif any(item.status == RealityStatus.missing for item in domain_items):
            domains[domain.value] = RealityStatus.missing.value
        elif any(item.status in {RealityStatus.approximate_substitute, RealityStatus.creative_alternative, RealityStatus.ai_alternative, RealityStatus.rent_buy_option} for item in domain_items):
            domains[domain.value] = RealityStatus.approximate_substitute.value
        else:
            domains[domain.value] = RealityStatus.owned_ready.value

    gaps = [item for item in items if item.status in GAP_STATES]
    blocking = any(item.status == RealityStatus.requires_decision for item in items if item.domain in {RealityDomain.camera, RealityDomain.environment})
    feasibility: Literal['ready', 'adapt', 'blocked'] = 'blocked' if blocking else ('adapt' if gaps else 'ready')
    complexity: Literal['simple', 'moderate', 'complex'] = 'simple' if len(bundle.scenes) <= 2 else ('moderate' if len(bundle.scenes) <= 6 else 'complex')
    if feasibility == 'blocked':
        summary = 'A required resource decision is unresolved before this plan can be shot as written.'
    elif gaps:
        summary = f'{len(gaps)} Setup gap(s) need a decision; the plan can proceed with the listed adaptations.'
    else:
        summary = 'Your Setup covers this plan; no physical gap was identified from the listed inventory.'
    mode = recommend_mode(brief, setup=setup, gaps=gaps, target_ms=target_ms)
    return RealityReport(
        feasibility=feasibility, complexity=complexity, items=items, domains=domains, conflicts=conflicts,
        adaptations=adaptations, mode=mode, summary=summary,
        inventory_used=[str(item.get('name')) for item in setup if item.get('name')][:30], notes=notes,
    )
