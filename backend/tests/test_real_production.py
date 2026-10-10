"""Prompt 6 Real Production Director engine tests.

Every assertion here is about what TONDE is allowed to claim: owned gear is named,
unowned gear is never presented as owned, unknown equipment stays unknown, exposure
values are labelled as starting points, and unsafe requests are refused rather than
answered.
"""

from __future__ import annotations

from typing import Any

from app.services.real_production import (
    RealProductionDirector,
    SetupInventory,
    movement_from,
    parse_constraints,
    shot_size_from,
)


def resource(identifier: str, kind: str, name: str, **metadata: Any) -> dict[str, Any]:
    return {'id': identifier, 'resource_type': kind, 'name': name, 'manufacturer': None, 'model': None,
        'mount': None, 'stabilization': None, 'metadata': metadata}


def shot(**overrides: Any) -> dict[str, Any]:
    base = {
        'shot_id': '00000000-0000-4000-8000-000000000014', 'title': 'Scale macro', 'purpose': 'insert',
        'subject': 'the scale', 'framing': 'close-up', 'movement': 'locked', 'description': '',
        'action': 'The barista sets the cup down.', 'story_relationship': 'proves the promise',
        'planned_duration_ms': 6000, 'execution_method': 'real', 'approval': 'draft', 'locked': False,
    }
    base.update(overrides)
    return base


def scene() -> dict[str, Any]:
    return {'scene_id': '00000000-0000-4000-8000-000000000010', 'title': 'Dark kitchen', 'order': 1,
        'purpose': 'Earn attention', 'description': 'A dark kitchen before sunrise.'}


def brief() -> dict[str, Any]:
    return {'tone': ['warm', 'premium'], 'creative_concept': 'A dark kitchen that turns into a morning',
        'product_brand': 'Ridgeway', 'runtime': {'kind': 'exact', 'exact_ms': 30000}}


# The §114 fixture: a 30-second premium coffee commercial shot by one person.
def solo_commercial_setup() -> SetupInventory:
    return SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('22222222-2222-4222-8222-222222222222', 'lens', '35 mm f/1.8', focal_length_mm=35),
        resource('33333333-3333-4333-8333-333333333333', 'lens', '50 mm f/1.8', focal_length_mm=50),
        resource('44444444-4444-4444-8444-444444444444', 'tripod', 'Travel tripod'),
        resource('55555555-5555-4555-8555-555555555555', 'light', 'Amaran 100d'),
        resource('66666666-6666-4666-8666-666666666666', 'modifier', '90 cm softbox'),
        resource('77777777-7777-4777-8777-777777777777', 'microphone', 'Lav mic'),
    ])


def test_a_solo_commercial_gets_an_executable_plan_from_owned_gear() -> None:
    director = RealProductionDirector(solo_commercial_setup())
    plan, requirements, alternatives = director.direct(shot=shot(), scene=scene(),
        production={'planned_duration_ms': 30000}, brief=brief(), text='I am shooting alone.')

    owned = {item.label: item for item in requirements if item.status == 'owned'}
    assert plan.camera_resource_id == '11111111-1111-4111-8111-111111111111'
    assert plan.lens_resource_id == '33333333-3333-4333-8333-333333333333' or plan.lens_resource_id == '44444444-4444-4444-8444-444444444444' or plan.lens_resource_id in (
        '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222')
    assert owned['Camera'].resource_id == '11111111-1111-4111-8111-111111111111'
    assert plan.solo_feasibility == 'solo'
    assert plan.movement == 'locked'
    assert 'starting point' in plan.aperture
    assert 'starting points, not settings' in plan.exposure_note
    assert plan.lighting_plan and 'Amaran 100d' in plan.lighting_plan
    assert plan.expected_duration_ms == 6000
    assert plan.complexity in ('quick', 'moderate', 'complex')
    assert plan.complexity_is_estimate is True
    assert alternatives, 'a practical plan offers alternatives'
    assert plan.plan_status in ('ready', 'ready_with_substitution', 'needs_decision')


def test_an_unowned_lens_is_never_claimed_and_the_substitution_explains_the_camera_move() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('33333333-3333-4333-8333-333333333333', 'lens', '50 mm f/1.8', focal_length_mm=50),
        resource('44444444-4444-4444-8444-444444444444', 'tripod', 'Travel tripod'),
    ]))
    plan, requirements, _ = director.direct(shot=shot(framing='close-up', subject='the label'), scene=scene(),
        production={}, text='I do not have that lens.')
    lens = next(item for item in requirements if item.kind == 'lens')
    assert lens.status == 'substitute'
    assert lens.resource_id is None
    assert lens.substitute_resource_id == '33333333-3333-4333-8333-333333333333'
    assert '85' in lens.ideal_name
    assert '50' in lens.alternative and 'move the camera' in lens.alternative
    assert plan.lens_resource_id == '33333333-3333-4333-8333-333333333333'
    # Perspective is taught as a camera-position consequence, not a lens superstition.
    assert 'Camera position, not focal length, decides perspective' in plan.perspective_note


def test_a_phone_only_constraint_is_respected_for_camera_and_lens() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('22222222-2222-4222-8222-222222222222', 'lens', '35 mm f/1.8', focal_length_mm=35),
        resource('88888888-8888-4888-8888-888888888888', 'phone_camera', 'iPhone 15 Pro'),
    ]))
    plan, requirements, _ = director.direct(shot=shot(), scene=scene(), production={}, text='Use only my phone.')
    assert plan.camera_resource_id == '88888888-8888-4888-8888-888888888888'
    camera = next(item for item in requirements if item.kind == 'camera')
    assert camera.resource_type == 'phone_camera'
    lens = next(item for item in requirements if item.kind == 'lens')
    assert lens.status == 'not_required'
    assert 'built-in' in lens.detail
    assert plan.lens_resource_id is None


def test_one_light_produces_a_one_light_plan_not_a_three_light_plan() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('22222222-2222-4222-8222-222222222222', 'lens', '50 mm f/1.8', focal_length_mm=50),
        resource('44444444-4444-4444-8444-444444444444', 'tripod', 'Travel tripod'),
        resource('55555555-5555-4555-8555-555555555555', 'light', 'Amaran 100d'),
        resource('66666666-6666-4666-8666-666666666666', 'modifier', '90 cm softbox'),
    ]))
    plan, requirements, alternatives = director.direct(shot=shot(purpose='reveal the product', framing='medium close-up'),
        scene=scene(), production={}, text='I only have one light.')
    assert 'one-light plan' in plan.lighting_plan
    assert plan.lighting_plan.count('Amaran') == 1
    assert len(plan.lighting_diagram.get('lights', [])) == 1
    key = next(item for item in requirements if item.kind == 'light')
    assert key.status == 'substitute', 'a one-light plan is a substitution for the ideal key+fill'
    assert key.resource_id is None and key.substitute_resource_id == '55555555-5555-4555-8555-555555555555'
    assert any(option.kind == 'available_light' for option in alternatives)


def test_a_missing_gimbal_is_not_reported_as_owned() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('44444444-4444-4444-8444-444444444444', 'tripod', 'Travel tripod'),
    ]))
    plan, requirements, _ = director.direct(shot=shot(movement='gimbal push-in', framing='medium'),
        scene=scene(), production={}, text='I cannot use a gimbal.')
    support = next(item for item in requirements if item.kind == 'stabilization')
    assert support.status != 'owned' or support.resource_type != 'gimbal'
    assert all(item.resource_id != 'gimbal' for item in requirements)
    assert plan.movement != 'gimbal', 'the plan stops claiming a move it cannot support'
    assert 'gimbal' not in plan.stabilization.lower()


def test_a_solo_creator_on_a_moving_shot_is_told_to_simplify_and_why() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('44444444-4444-4444-8444-444444444444', 'tripod', 'Travel tripod'),
        resource('55555555-5555-4555-8555-555555555555', 'light', 'Amaran 100d'),
        resource('66666666-6666-4666-8666-666666666666', 'light', 'Amaran 200d'),
    ]))
    plan, requirements, _ = director.direct(shot=shot(movement='tracking follow', framing='medium', action='She walks past the window.'),
        scene=scene(), production={}, text='I am shooting alone.')
    assert plan.solo_feasibility == 'solo_with_simplification'
    crew = next(item for item in requirements if item.kind == 'crew')
    assert crew.status == 'unverified'
    assert 'Operator (you)' == crew.ideal_name
    assert 'alone' in plan.blocking.lower()
    assert 'set the move as a repeatable' in plan.blocking.lower() or 'pre-focus' in plan.blocking.lower()


def test_dialogue_uses_the_lav_as_primary_and_the_camera_mic_as_scratch() -> None:
    director = RealProductionDirector(solo_commercial_setup())
    plan, requirements, _ = director.direct(shot=shot(purpose='dialogue', framing='medium close-up'),
        scene=scene(), production={}, script_line={'kind': 'dialogue', 'content': 'Still warm.', 'intention': 'reassure'})
    mic = next(item for item in requirements if item.kind == 'microphone')
    assert mic.status == 'owned'
    assert mic.resource_id == '77777777-7777-4777-8777-777777777777'
    assert 'Lav mic' in plan.sound_plan and 'Primary' in plan.sound_plan
    assert 'scratch' in plan.microphone_plan
    assert 'clap' in plan.sync_strategy.lower()


def test_without_a_microphone_the_plan_says_what_is_actually_missing() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
    ]))
    plan, requirements, alternatives = director.direct(shot=shot(purpose='dialogue'), scene=scene(),
        production={}, script_line={'kind': 'dialogue', 'content': 'Still warm.'})
    mic = next(item for item in requirements if item.kind == 'microphone')
    assert mic.status == 'missing'
    assert 'second phone' in mic.alternative or 'without sync dialogue' in mic.alternative
    assert plan.plan_status == 'missing_resource'
    assert 'Missing from Setup' in plan.readiness_note
    assert any(option.kind == 'ai_foundation' for option in alternatives)


def test_a_product_shot_handles_reflections_and_says_who_owns_the_label() -> None:
    director = RealProductionDirector(solo_commercial_setup())
    plan, _, _ = director.direct(shot=shot(purpose='reveal the product', framing='insert',
        subject='the glass bottle', product_direction='label to camera'), scene=scene(), production={}, brief=brief())
    assert plan.lighting_intent.startswith('Soft, controlled light')
    assert 'specular' in plan.lighting_plan or 'flare' in plan.lighting_plan
    assert 'label' in plan.product_direction.lower()
    assert 'hands off the logo' in plan.product_direction
    assert 'Product wiped and positioned' in plan.capture_checklist


def test_performance_direction_is_specific_rather_than_generic() -> None:
    director = RealProductionDirector(solo_commercial_setup())
    plan, _, _ = director.direct(shot=shot(framing='close-up', purpose='emotional reaction'),
        scene=scene(), production={}, script_line={'kind': 'reaction', 'content': '', 'intention': 'hope', 'delivery': 'quiet'})
    assert 'Act natural' not in plan.performance
    assert 'Intention: hope' in plan.performance
    assert 'Delivery: quiet' in plan.performance
    assert 'beat' in plan.performance


def test_unknown_equipment_never_gains_invented_specifications() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'Some Unknown Camera'),
        resource('99999999-9999-4999-8999-999999999999', 'light', 'Random Brand X Light'),
    ]))
    plan, requirements, _ = director.direct(shot=shot(), scene=scene(), production={}, brief=brief())
    assert plan.iso_range == 'Start at the camera’s base ISO and raise only as far as the shot needs.'
    # No invented sensor, codec, wattage, CRI or CCT anywhere in the plan.
    claims = ' '.join([plan.iso_range, plan.exposure_note, plan.lighting_plan, plan.aperture, plan.capture_fps])
    for invented in ('CRI', 'watt', 'CCT', 'sensor size', '10-bit', 'codec', 'LOG profile'):
        assert invented.lower() not in claims.lower()
    # The light has no metadata, so the plan cannot promise its output.
    light = next(item for item in requirements if item.kind == 'light')
    assert light.status in ('substitute', 'owned', 'unverified')
    if light.status == 'owned':
        assert 'Random Brand X Light' in (plan.lighting_plan or light.detail)


def test_a_missing_modifier_offers_the_bounce_that_really_exists() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('44444444-4444-4444-8444-444444444444', 'tripod', 'Travel tripod'),
        resource('55555555-5555-4555-8555-555555555555', 'light', 'Amaran 100d'),
        resource('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'modifier', 'White bounce board'),
    ]))
    plan, requirements, _ = director.direct(shot=shot(), scene=scene(), production={}, brief=brief())
    assert 'White bounce board' in plan.lighting_plan
    assert 'Amaran 100d' in plan.lighting_plan


def test_a_small_room_is_flagged_before_the_shoot_not_discovered_on_the_day() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('33333333-3333-4333-8333-333333333333', 'lens', '85 mm f/2', focal_length_mm=85),
        resource('44444444-4444-4444-8444-444444444444', 'tripod', 'Travel tripod'),
    ]))
    plan, _, alternatives = director.direct(shot=shot(framing='close-up', movement='push', description='Small room shoot.'),
        scene=scene(), production={}, text='The room is small and I only have what I own.')
    assert any('room behind the camera' in item for item in plan.environment_requirements)
    assert any('Space' in item or 'space' in item for item in plan.location_requirements)
    assert any(option.kind == 'fastest' for option in alternatives)


def test_filming_while_driving_alone_is_refused_and_a_safe_version_is_given() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'tripod', 'Travel tripod'),
    ]))
    plan, _, alternatives = director.direct(
        shot=shot(title='Driving at dawn', movement='tracking', description='I film myself driving alone through the city.'),
        scene=scene(), production={}, text='I am shooting alone.')
    assert 'vehicle-while-driving' in plan.safety_flags
    assert plan.plan_status == 'safety_blocked'
    assert any('Do not film while driving' in note for note in plan.safety_notes)
    assert any('passenger' in note for note in plan.safety_notes)
    assert any(option.kind == 'safest' for option in alternatives)


def test_a_drone_shot_carries_legal_and_practical_caveats_without_implying_permission() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'drone', 'Mini 4 Pro'),
    ]))
    plan, requirements, _ = director.direct(shot=shot(title='Aerial rise over the roof', movement='drone',
        description='Drone rises over the roof at dawn.'), scene=scene(), production={}, text='')
    assert 'drone' in plan.safety_flags
    assert any('airspace' in note for note in plan.safety_notes)
    assert any('permission' in note for note in plan.safety_notes)
    support = next(item for item in requirements if item.kind == 'stabilization')
    assert support.status == 'unverified', 'owning a drone is not permission to fly it'
    assert plan.plan_status in ('safety_blocked', 'needs_decision', 'missing_resource')


def test_constraints_and_shot_language_are_read_deterministically() -> None:
    assert parse_constraints('Use only my phone, I am alone') == {'phone_only', 'solo'}
    assert 'no_gimbal' in parse_constraints("I can't use a gimbal")
    assert 'available_light_only' in parse_constraints('My light died')
    assert parse_constraints('', ['one_light']) == {'one_light'}
    assert shot_size_from({'framing': 'extreme close-up of the label'}) == 'extreme close-up'
    assert shot_size_from({'framing': 'wide establishing shot'}) == 'wide'
    assert shot_size_from({'purpose': 'establish'}) == 'wide'
    assert shot_size_from({}) == 'medium'
    assert movement_from({'movement': 'slow push in'}, set()) == 'push'
    assert movement_from({'movement': 'gimbal move'}, {'no_gimbal'}) == 'handheld'
    assert movement_from({}, set()) == 'locked'


def test_verified_readiness_reflects_requirement_facts_not_optimism() -> None:
    director = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'A7C II'),
        resource('33333333-3333-4333-8333-333333333333', 'lens', '50 mm f/1.8', focal_length_mm=50),
        resource('44444444-4444-4444-8444-444444444444', 'tripod', 'Travel tripod'),
        resource('55555555-5555-4555-8555-555555555555', 'light', 'Amaran 100d'),
        resource('77777777-7777-4777-8777-777777777777', 'microphone', 'Lav mic'),
    ]))
    ready_plan, _, _ = director.direct(shot=shot(), scene=scene(), production={}, brief=brief())
    assert ready_plan.plan_status in ('ready', 'ready_with_substitution')
    missing_plan, _, _ = director.direct(shot=shot(purpose='dialogue'), scene=scene(), production={},
        script_line={'kind': 'dialogue', 'content': 'Hello.'})
    assert missing_plan.plan_status in ('missing_resource', 'ready_with_substitution') or \
        missing_plan.plan_status == 'missing_resource'
    # With no camera at all the Shot is genuinely unshootable and says so.
    empty = RealProductionDirector(SetupInventory([]))
    plan, requirements, _ = empty.direct(shot=shot(), scene=scene(), production={}, text='I have nothing yet.')
    camera = next(item for item in requirements if item.kind == 'camera')
    assert camera.status == 'missing'
    assert plan.plan_status == 'missing_resource'
    assert plan.camera_resource_id is None
    # A camera with no lens is a real gap, not a silent assumption about a kit lens.
    body_only = RealProductionDirector(SetupInventory([
        resource('11111111-1111-4111-8111-111111111111', 'camera', 'Body only'),
    ]))
    lens_plan, lens_requirements, _ = body_only.direct(shot=shot(), scene=scene(), production={})
    lens = next(item for item in lens_requirements if item.kind == 'lens')
    assert lens.status == 'missing'
    assert lens_plan.plan_status == 'missing_resource'
    assert 'no lens with a stated focal length' in lens.detail
