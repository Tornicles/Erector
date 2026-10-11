"""Card completeness: is a Production Card executable, and if not, what is missing.

A Card maps 1:1 onto a canonical Scene; its Shots are the execution units and its execution
plans (Real/AI, per Shot) carry the direction. This module evaluates, from real persisted state
only, whether a Card is a complete directing package::

    DRAFT        direction is still developing (no shots, or shots without plans)
    NEEDS YOU    a material gap needs a creator decision (missing resource, safety, undecided plan)
    READY        every execution unit has its direction, continuity is stated, next action is known

Approval and locks are deliberately NOT evaluated here: they are human authority over a version
(constitution section 11), while completeness is executability of the direction. Callers combine
both (approved -> COMPLETE, needs_review -> NEEDS YOU) exactly as before.

For REAL units the evaluator requires, per Shot plan: performance/blocking direction, camera
position/framing, lighting, and sound; plus capture guidance (setup steps or checklist). For AI
units: a ready-to-use prompt (canonical or accepted provider prompt), motion, continuity handoff,
and avoid rules. HYBRID shots require both sides. A card-level WHAT/WHY (purpose/description),
continuity states, and a derivable next action complete the package.

Nothing is invented: a missing plan, an empty field, or an undecided status is reported as the
named gap it is. No percentages are produced.
"""

from __future__ import annotations

from typing import Any, Literal

from app.domain.director import DirectorModel

CardCompletenessState = Literal['READY', 'DRAFT', 'NEEDS YOU']

#: Plan statuses that can never be READY without a creator decision first.
DECISION_STATUSES = frozenset({'needs_decision', 'missing_resource', 'safety_blocked'})


class ShotCompleteness(DirectorModel):
    """Executability of one Shot / Generation Unit inside its Card."""

    shot_id: str
    execution_method: str = 'real'
    state: CardCompletenessState = 'DRAFT'
    missing: list[str] = []


class CardCompleteness(DirectorModel):
    """Executability of one Production Card (Scene) as a directing package."""

    scene_id: str
    state: CardCompletenessState = 'READY'
    missing: list[str] = []
    shots: list[ShotCompleteness] = []
    next_action_label: str = ''
    next_action_detail: str = ''


def _has(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set)):
        return any(_has(item) for item in value)
    if isinstance(value, dict):
        return any(_has(item) for item in value.values())
    return True


def _real_gaps(plan: dict[str, Any]) -> list[str]:
    gaps: list[str] = []
    if not (_has(plan.get('performance')) or _has(plan.get('blocking'))):
        gaps.append('actor/subject direction and blocking')
    if not (_has(plan.get('camera_position')) or _has(plan.get('framing'))):
        gaps.append('camera position and framing')
    if not _has(plan.get('lighting_plan')):
        gaps.append('lighting plan')
    if not (_has(plan.get('sound_plan')) or _has(plan.get('microphone_plan'))):
        gaps.append('sound plan')
    if not (_has(plan.get('setup_steps')) or _has(plan.get('capture_checklist'))):
        gaps.append('capture steps')
    return gaps


def _ai_gaps(plan: dict[str, Any]) -> list[str]:
    gaps: list[str] = []
    prompt_ready = _has(plan.get('canonical_prompt')) or (
        _has(plan.get('provider_prompt'))
        and bool(plan.get('provider_prompt_edited') or plan.get('accept_provider_prompt')))
    if not prompt_ready:
        gaps.append('ready-to-use generation prompt')
    if not _has(plan.get('motion')):
        gaps.append('camera motion')
    if not _has(plan.get('continuity')):
        gaps.append('continuity handoff')
    if not _has(plan.get('negative_constraints')):
        gaps.append('avoid rules')
    return gaps


def evaluate_shot(shot: dict[str, Any], plan: dict[str, Any] | None) -> ShotCompleteness:
    """Evaluate one execution unit. A missing plan is the named gap it is."""

    method = str(shot.get('execution_method') or 'real')
    shot_id = str(shot.get('id') or '')
    if plan is None:
        return ShotCompleteness(shot_id=shot_id, execution_method=method,
            state='DRAFT', missing=['execution plan'])
    status = str(plan.get('plan_status') or 'draft')
    if status in DECISION_STATUSES:
        note = str(plan.get('readiness_note') or '').strip()
        gap = f'creator decision ({status.replace("_", " ")})'
        if note:
            gap += f': {note[:140]}'
        return ShotCompleteness(shot_id=shot_id, execution_method=method,
            state='NEEDS YOU', missing=[gap])
    if method == 'ai':
        gaps = _ai_gaps(plan)
    elif method == 'hybrid':
        gaps = [f'real capture: {gap}' for gap in _real_gaps(plan)]
        gaps += [f'AI work: {gap}' for gap in _ai_gaps(plan)]
        if not _has(plan.get('hybrid')):
            gaps.append('real/AI combine direction')
    else:
        gaps = _real_gaps(plan)
    if status != 'ready' and status != 'ready_with_substitution' and gaps:
        # A non-ready plan with content gaps is still developing, not decided.
        return ShotCompleteness(shot_id=shot_id, execution_method=method,
            state='DRAFT', missing=gaps)
    if gaps:
        return ShotCompleteness(shot_id=shot_id, execution_method=method,
            state='DRAFT', missing=gaps)
    return ShotCompleteness(shot_id=shot_id, execution_method=method, state='READY')


def evaluate_card(scene: dict[str, Any], shots: list[dict[str, Any]],
    plans_by_shot: dict[str, dict[str, Any]]) -> CardCompleteness:
    """Evaluate one Production Card as a complete directing package."""

    scene_id = str(scene.get('id') or '')
    missing: list[str] = []
    if not (_has(scene.get('purpose')) or _has(scene.get('description'))):
        missing.append('what happens and why this card exists')
    if not (_has(scene.get('opening_state')) or _has(scene.get('ending_state'))):
        missing.append('continuity into/out of this card')
    if not shots:
        missing.append('shots / generation units')
    evaluated = [evaluate_shot(shot, plans_by_shot.get(str(shot.get('id')))) for shot in shots]
    for item in evaluated:
        missing.extend(f'Shot {item.shot_id[:8]}: {gap}' for gap in item.missing)
    if any(item.state == 'NEEDS YOU' for item in evaluated):
        state: CardCompletenessState = 'NEEDS YOU'
    elif missing:
        state = 'DRAFT'
    else:
        state = 'READY'
    label, detail = _next_action(scene, evaluated, state)
    return CardCompleteness(scene_id=scene_id, state=state, missing=missing[:12],
        shots=evaluated, next_action_label=label, next_action_detail=detail)


def _next_action(scene: dict[str, Any], shots: list[ShotCompleteness],
    state: CardCompletenessState) -> tuple[str, str]:
    order = scene.get('order')
    card_ref = f'Card {order}' if order is not None else 'This card'
    if state == 'NEEDS YOU':
        return ('RESOLVE OPEN DECISION',
            f'{card_ref} has a decision only you can make. Resolve it before shooting or generating.')
    if state == 'DRAFT':
        if not shots:
            return ('PLAN COVERAGE',
                f'{card_ref} has no Shots yet. Ask TONDE to plan its coverage.')
        first_gap = next((gap for item in shots for gap in item.missing), 'direction')
        return ('COMPLETE DIRECTION',
            f'{card_ref} still needs: {first_gap}.')
    methods = {str(item.execution_method) for item in shots}
    if methods == {'ai'}:
        return ('RUN THE PLAYBOOK',
            'TONDE prepared the AI playbook for this card. Run it in your external tool, then upload the Result.')
    if 'ai' in methods or 'hybrid' in methods:
        return ('SHOOT, THEN GENERATE',
            'Shoot the real coverage first, then run the AI playbook for the generated beats.')
    return ('START THIS CARD',
        'Shoot the first Shot. Real execution starts with the camera you actually have.')
