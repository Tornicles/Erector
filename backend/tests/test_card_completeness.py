"""Card completeness: READY means executable, gaps are named, never invented."""

from app.domain.card_completeness import evaluate_card, evaluate_shot


def _scene(**overrides: object) -> dict:
    base: dict = {'id': 'scene-1', 'order': 3, 'purpose': 'Prove the city is empty.',
        'description': 'Maya enters the street.', 'opening_state': 'Alone in the stairwell.',
        'ending_state': 'Facing the empty street.'}
    base.update(overrides)
    return base


def _real_plan(**overrides: object) -> dict:
    base: dict = {'plan_status': 'ready', 'performance': 'Walk four steps, stop, hold.',
        'blocking': 'Cross from left to right.', 'camera_position': 'Across the street.',
        'framing': 'Wide.', 'lighting_plan': 'Morning light only.',
        'sound_plan': 'Footsteps plus room tone.', 'setup_steps': ['Scout the street.']}
    base.update(overrides)
    return base


def _ai_plan(**overrides: object) -> dict:
    base: dict = {'plan_status': 'ready',
        'canonical_prompt': {'subject': 'Empty Nairobi street.'},
        'motion': {'camera': 'Slow push.'}, 'continuity': {'handoff': 'Keep Maya.'},
        'negative_constraints': ['No extra people.']}
    base.update(overrides)
    return base


def test_real_card_is_ready_when_every_unit_has_direction():
    scene = _scene()
    shots = [{'id': 'shot-a', 'execution_method': 'real'}, {'id': 'shot-b', 'execution_method': 'real'}]
    result = evaluate_card(scene, shots, {'shot-a': _real_plan(), 'shot-b': _real_plan()})
    assert result.state == 'READY'
    assert result.missing == []
    assert result.next_action_label == 'START THIS CARD'


def test_card_without_shots_is_draft_not_ready():
    result = evaluate_card(_scene(), [], {})
    assert result.state == 'DRAFT'
    assert result.missing == ['shots / generation units']
    assert result.next_action_label == 'PLAN COVERAGE'


def test_missing_plan_is_named_not_invented():
    result = evaluate_shot({'id': 'shot-a', 'execution_method': 'real'}, None)
    assert result.state == 'DRAFT'
    assert result.missing == ['execution plan']


def test_real_gaps_name_actor_camera_light_sound_and_steps():
    plan = _real_plan(performance='', blocking='', camera_position='', framing='',
        lighting_plan='', sound_plan='', microphone_plan='', setup_steps=[], capture_checklist=[])
    result = evaluate_shot({'id': 'shot-a', 'execution_method': 'real'}, plan)
    assert result.state == 'DRAFT'
    assert any('actor' in gap for gap in result.missing)
    assert any('camera' in gap for gap in result.missing)
    assert any('lighting' in gap for gap in result.missing)
    assert any('sound' in gap for gap in result.missing)


def test_ai_card_requires_prompt_motion_continuity_and_avoid():
    plan = _ai_plan(canonical_prompt={}, provider_prompt='', motion={}, continuity={},
        negative_constraints=[])
    result = evaluate_shot({'id': 'shot-c', 'execution_method': 'ai'}, plan)
    assert result.state == 'DRAFT'
    assert len(result.missing) == 4
    ready = evaluate_shot({'id': 'shot-c', 'execution_method': 'ai'}, _ai_plan())
    assert ready.state == 'READY'


def test_hybrid_requires_both_sides_plus_combine_direction():
    plan = {**_real_plan(), **_ai_plan()}
    assert evaluate_shot({'id': 's', 'execution_method': 'hybrid'}, plan).state == 'DRAFT'
    plan['hybrid'] = {'combine': 'Preserve Maya; extend the street.'}
    assert evaluate_shot({'id': 's', 'execution_method': 'hybrid'}, plan).state == 'READY'


def test_blocked_or_undecided_plan_needs_you_with_its_reason():
    plan = _real_plan(plan_status='missing_resource', readiness_note='No drone in Setup.')
    result = evaluate_card(_scene(), [{'id': 'shot-a', 'execution_method': 'real'}], {'shot-a': plan})
    assert result.state == 'NEEDS YOU'
    assert 'missing resource' in result.missing[0]
    assert 'No drone' in result.missing[0]


def test_card_without_purpose_or_continuity_is_draft():
    scene = _scene(purpose='', description='', opening_state='', ending_state='')
    result = evaluate_card(scene, [{'id': 'shot-a', 'execution_method': 'real'}], {'shot-a': _real_plan()})
    assert result.state == 'DRAFT'
    assert 'what happens and why this card exists' in result.missing
    assert 'continuity into/out of this card' in result.missing


def test_ai_card_next_action_runs_the_playbook():
    result = evaluate_card(_scene(), [{'id': 'shot-c', 'execution_method': 'ai'}], {'shot-c': _ai_plan()})
    assert result.state == 'READY'
    assert result.next_action_label == 'RUN THE PLAYBOOK'
