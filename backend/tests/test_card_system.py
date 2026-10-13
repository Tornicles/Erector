"""The Card content contract: planning caps, word contracts, authority, impact and status.

These are product rules, so they are tested as rules: the published Card-count anchors, the
word-length contract, the refusal to call an aspiration direction, cross-section repetition,
contradictions that would make a Card unshootable, the provenance hierarchy, scoped impact and
the real status of a Card.
"""

from app.domain.cards import (
    AI_UNIT_FIELD_SPECS,
    CARD_DIRECTION_FIELDS,
    BeatPlan,
    FieldProvenance,
    card_cap_for_runtime,
    card_status,
    card_summary_words,
    contradictions,
    duplicated_sections,
    impact_for,
    is_vague,
    locked_conflicts,
    plan_card_shells,
    resolve_provenance,
    status_detail,
    validate_card_direction,
    validate_field,
    validate_shot_direction,
    word_count,
)

COMPLETE_DIRECTION: dict = {
    'title': 'The Empty Street',
    'purpose': 'Maya discovers the city is empty.',
    'starts_from': 'Maya exits the apartment building.',
    'ends_with': 'Maya hears a metallic sound and turns.',
    'story_change': 'ordinary quiet to undeniable danger',
    'summary': ('Maya exits into a street that should be busy but is empty. She walks, notices '
        'there are no people and no moving cars, slows, stops and turns toward a metallic sound '
        'behind her. The threat stays unseen, so the Card ends on her turn rather than a reveal, '
        'and the audience is left with the same unanswered question she is.'),
    'what_happens': ('She exits the building and takes four normal steps before the absence '
        'registers. She slows, stops near the centre-right of frame, holds for a full beat, then '
        'looks across the street. A metallic sound arrives from behind-left and her eyes react '
        'before her head turns. Nothing else enters the frame and the Card ends on that turn, '
        'with the source of the sound still unknown to the audience.'),
    'director_direction': ('Confusion first, then fear. Keep the environment as the pressure and '
        'do not let Maya lead it: her body stays ordinary for the first half of the Card, so the '
        'emptiness is what the audience notices. Do not play the turn as a scare, do not add a '
        'music sting before it, and do not cut away from her to explain the sound. The Card ends '
        'unresolved on purpose, and that suspension is the whole point of the beat.'),
    'audience_feeling': 'Exposed, uneasy, suddenly alert.',
    'subject_direction': ('Walk normally for four steps, then slow without looking around. Stop '
        'near the centre-right mark and hold for a full beat with normal breathing before the '
        'sound. When the metallic tone arrives, move the eyes first and let the head and shoulders '
        'follow a beat later. Do not scan, scream, run, or look into the lens, and keep the '
        'backpack on the right shoulder throughout the turn.'),
    'camera_direction': ('Phone main 1x camera, vertical 9:16, 4K if available, seven metres from '
        'the final mark at eye level. Mostly locked wide frames with Maya small in frame. Allow '
        'one very slow push that begins only as the beat changes from observation to concern, and '
        'keep the master static whenever there is no stabiliser.'),
    'look_direction': ('Muted early-morning daylight with a soft key from behind-right and slightly '
        'cold contrast. Wet pavement if the street is wet, large negative space in the frame, and '
        'no fog, coloured horror light or fantasy treatment. Keep Maya under the background '
        'brightness rather than lifting her with fill, and hold the same exposure across every '
        'Shot so the wide, detail and reaction coverage cut together without a visible shift.'),
    'audio_direction': ('Capture footsteps, clothing and clean street tone with 20 to 30 seconds '
        'of wild ambience after each take. Keep normal city activity unusually low but never '
        'digitally dead. Record the metallic cue separately so it can enter late and motivate the '
        'turn, with no creature sound and no early music sting.'),
    'location_direction': ('Long street with real depth, a clear exit behind Maya and low '
        'pedestrian traffic. Shoot along the long axis so the emptiness reads, avoid distracting '
        'signage, and keep the operator and the cast out of traffic lanes at all times. Place the '
        'final mark about seven metres from the camera so Maya stays small in frame, and keep the '
        'same pavement colour through the Card.'),
    'continuity': ('Dark green jacket closed, backpack on the right shoulder, hair tied back, '
        'morning light and wet pavement. Maya ends facing camera-left so Card 04 begins on that '
        'same screen direction.'),
    'resources': 'Maya, phone camera, backpack, jacket, quiet street, optional tripod.',
    'next_action': 'Open Shot 03A and capture the street master.',
}


def _direction(**overrides: object) -> dict:
    base = dict(COMPLETE_DIRECTION)
    base.update(overrides)
    return base


def _ai_shot(**overrides: object) -> dict:
    base = {
        'id': '03E',
        'mode': 'AI',
        'purpose': 'Extend the empty street while the threat stays unseen.',
        'start_frame': 'Maya finished the turn, facing camera-left, mid-street.',
        'end_frame': 'Same framing with the street extending deeper behind her.',
        'subject_action': ('Preserve the practical Maya exactly: same body position, same breath, '
            'no new facial motion beyond the source plate.'),
        'camera_motion': ('Slow forward movement already established, eye level, no new angle and '
            'no lens change.'),
        'environment': ('Same Nairobi street extends into the distance with sparse abandoned '
            'vehicles, empty sidewalks and wet pavement.'),
        'character_lock': ('Preserve Maya face, hair, skin tone, dark green jacket and backpack on '
            'the right shoulder exactly.'),
        'world_lock': ('Keep the same buildings, street perspective, weather and early-morning '
            'direction as the practical plates.'),
        'avoid': ('No extra people, readable text, identity drift, fantasy debris, new '
            'architecture, lens changes or dramatic fog.'),
        'expected_result': ('A larger empty street that is unmistakably the same place with the '
            'same Maya, same light and same screen direction, so it cuts against the practical '
            'plates without the audience noticing a join.'),
        'prompt': ('Extend the existing street deeper into the distance while preserving the '
            'practical foreground exactly. Add sparse abandoned vehicles, empty sidewalks, muted '
            'early-morning natural light, subtle wind movement, wet pavement and grounded '
            'photoreal realism. Preserve the established eye-level camera geometry, lens feel and '
            'slow forward movement. Do not alter the face, hair, skin tone, jacket, backpack, body '
            'position, proportions, lighting direction or screen position. Keep the same '
            'buildings, street perspective, weather and time of day. Avoid extra people, readable '
            'text, identity drift, fantasy debris, new architecture, lens changes, camera-angle '
            'changes, dramatic fog or supernatural light.'),
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------- card count / density rules

def test_published_card_count_anchors_are_exact():
    assert card_cap_for_runtime(60_000) == 3
    assert card_cap_for_runtime(600_000) == 25


def test_card_cap_is_monotone_and_scales_with_runtime():
    assert card_cap_for_runtime(30_000) == 2
    assert card_cap_for_runtime(120_000) == 5
    assert card_cap_for_runtime(0) == 1
    assert card_cap_for_runtime(900_000) == 25


def test_twelve_micro_cards_for_one_minute_are_refused_not_merged():
    beats = [BeatPlan(title=f'Beat {index}', purpose='One camera cut.') for index in range(12)]
    plan = plan_card_shells(60_000, beats)
    assert plan.accepted is False
    assert plan.shells == []
    assert plan.card_cap == 3
    codes = [rule.code for rule in plan.rules]
    assert 'card_count_exceeds_cap' in codes
    detail = next(rule.detail for rule in plan.rules if rule.code == 'card_count_exceeds_cap')
    assert 'at most 3' in detail


def test_planned_shell_durations_reconcile_to_the_finished_runtime():
    beats = [BeatPlan(title='Arrival', purpose='Establish the routine.'),
        BeatPlan(title='Discovery', purpose='The city is empty.'),
        BeatPlan(title='Decision', purpose='She moves toward the signal.')]
    plan = plan_card_shells(60_000, beats)
    assert plan.accepted is True
    assert plan.card_count == 3
    assert plan.planned_runtime_ms == 60_000
    assert [shell.order for shell in plan.shells] == [1, 2, 3]
    assert all(shell.target_duration_ms >= 1_000 for shell in plan.shells)


def test_weighted_beats_get_proportional_durations_summing_exactly():
    beats = [BeatPlan(title='Long beat', weight=3), BeatPlan(title='Short beat', weight=1)]
    plan = plan_card_shells(120_000, beats)
    assert plan.accepted is True
    assert plan.planned_runtime_ms == 120_000
    assert plan.shells[0].target_duration_ms > plan.shells[1].target_duration_ms


def test_short_planned_cards_are_flagged_against_the_twenty_second_guidance():
    generous = [BeatPlan(title=f'Beat {index}') for index in range(3)]
    plan = plan_card_shells(600_000, generous)  # 3 cards for 10 minutes: 200s each
    assert plan.accepted is True
    assert 'card_below_20s' not in [rule.code for rule in plan.rules]
    tight = plan_card_shells(30_000, [BeatPlan(title='Arrival'), BeatPlan(title='Decision')])
    assert tight.accepted is True
    assert 'card_below_20s' in [rule.code for rule in tight.rules]


def test_planning_without_beats_reports_the_missing_structure():
    plan = plan_card_shells(60_000, [])
    assert plan.accepted is False
    assert plan.card_count == 0
    assert [rule.code for rule in plan.rules] == ['no_beats']


# ---------------------------------------------------------------- word contract

def test_word_contract_enforces_hard_maximum_and_target_floor():
    long_camera = ' '.join(['frame'] * 200)
    findings = validate_field('camera_direction', long_camera)
    assert [item.code for item in findings] == ['too_long']
    short = validate_field('camera_direction', 'Use the phone.')
    assert 'too_short' in [item.code for item in short]


def test_required_field_left_empty_blocks_ready():
    findings = validate_field('subject_direction', '   ')
    assert findings[0].code == 'empty'
    assert findings[0].severity == 'blocking'


def test_aspiration_language_is_rejected_as_vague():
    assert is_vague('Make it cinematic and immersive with compelling framing.')
    assert not is_vague(COMPLETE_DIRECTION['camera_direction'])
    assert not is_vague(COMPLETE_DIRECTION['look_direction'])


def test_complete_card_direction_validates_ready_with_no_blocking_findings():
    report = validate_card_direction(_direction())
    assert report.ready is True
    assert report.blocking() == []
    assert report.missing == []
    assert 500 <= report.word_total <= 750
    assert card_summary_words(_direction()) == report.word_total


def test_missing_section_is_named_rather_than_assumed():
    direction = _direction()
    direction.pop('audio_direction')
    report = validate_card_direction(direction)
    assert report.ready is False
    assert 'audio_direction' in report.missing


def test_structure_fields_are_required_even_when_prose_exists():
    direction = _direction(ends_with='')
    report = validate_card_direction(direction)
    assert report.ready is False
    assert any(item.field == 'ends_with' and item.code == 'missing' for item in report.findings)


def test_section_repetition_is_detected_across_the_card():
    paragraph = ('She walks four steps then slows and stops near the centre of the frame before '
        'the sound arrives and her eyes react.')
    direction = _direction(what_happens=paragraph, subject_direction=paragraph)
    duplicates = duplicated_sections(direction)
    assert ('what_happens', 'subject_direction') in [(a, b) for a, b, _ in duplicates]
    report = validate_card_direction(direction)
    assert any(item.code == 'duplicate' for item in report.findings)


def test_field_specs_cover_every_card_direction_field():
    from app.domain.cards import CARD_FIELD_SPECS
    assert set(CARD_FIELD_SPECS) == set(CARD_DIRECTION_FIELDS)


# ---------------------------------------------------------------- shot and AI unit contracts

def test_real_shot_without_camera_direction_is_not_executable():
    shot = {'id': '03A', 'purpose': 'Establish the emptiness.', 'action': 'Walk into frame.'}
    findings = validate_shot_direction(shot, mode='REAL')
    codes = {item.code for item in findings}
    assert 'missing' in codes
    assert any(item.field == 'shot.camera' for item in findings)


def test_complete_ai_unit_is_copy_ready_and_passes():
    picture = _ai_shot()
    findings = validate_shot_direction(picture, mode='AI')
    assert [item for item in findings if item.severity == 'blocking'] == []
    assert word_count(picture['prompt']) <= AI_UNIT_FIELD_SPECS['prompt'].hard_max


def test_ai_unit_without_a_prompt_is_blocked():
    shot = _ai_shot()
    shot.pop('prompt')
    findings = validate_shot_direction(shot, mode='AI')
    assert any(item.field == 'shot.prompt' and item.code == 'missing' for item in findings)


def test_thin_generation_prompt_is_refused_as_not_copy_ready():
    shot = _ai_shot(prompt='Generate a cinematic abandoned city.')
    findings = validate_shot_direction(shot, mode='AI')
    assert any(item.code == 'incomplete_prompt' for item in findings)


# ---------------------------------------------------------------- contradictions

def test_static_card_with_a_moving_shot_is_a_contradiction():
    card = _direction(camera_direction=('Locked static frames only. Keep the phone on the tripod '
        'at eye level and never move the camera during this Card.'))
    shots = [{'id': '03A', 'camera': 'Fast handheld push toward Maya.'}]
    findings = contradictions(card, shots)
    assert [item.code for item in findings] == ['contradiction']
    assert findings[0].severity == 'blocking'


def test_continuity_side_disagreeing_with_a_prompt_is_a_contradiction():
    card = _direction()
    shots = [_ai_shot(character_lock='Preserve the backpack on the left shoulder.')]
    findings = contradictions(card, shots)
    assert any(item.code == 'contradiction' for item in findings)


def test_locked_continuity_fact_beats_a_contradicting_card_statement():
    card = _direction(continuity='The backpack stays on the left shoulder through this Card.')
    findings = contradictions(card, [], continuity={'locked': {'maya.backpack': 'right_shoulder'}})
    assert any('creator-locked fact wins' in item.detail for item in findings)


def test_shot_coverage_duration_may_exceed_the_finished_edit_but_not_double_it():
    card = _direction()
    reasonable = [{'id': 'a', 'duration_seconds': 35}]
    assert contradictions(card, reasonable, target_duration_ms=30_000) == []
    excessive = [{'id': 'a', 'duration_seconds': 45}, {'id': 'b', 'duration_seconds': 30}]
    findings = contradictions(card, excessive, target_duration_ms=30_000)
    assert any(item.field == 'target_duration' for item in findings)


# ---------------------------------------------------------------- provenance and authority

def test_creator_lock_outranks_director_decisions_and_inference():
    entries = [
        FieldProvenance(value='black jacket', source_type='director', confidence=0.9),
        FieldProvenance(value='red dress', source_type='creator_locked', locked=True),
        FieldProvenance(value='dark red dress', source_type='inference', confidence=0.4),
    ]
    winner = resolve_provenance(entries)
    assert winner is not None
    assert winner.value == 'red dress'


def test_approved_result_outranks_continuity_and_director():
    entries = [
        FieldProvenance(value='planned right shoulder', source_type='director'),
        FieldProvenance(value='observed left shoulder', source_type='approved_result',
            source_id='result-239', confidence=1.0),
        FieldProvenance(value='prior card right shoulder', source_type='continuity'),
    ]
    winner = resolve_provenance(entries)
    assert winner is not None
    assert winner.source_type == 'approved_result'
    assert winner.source_id == 'result-239'


def test_attempting_to_overwrite_a_locked_fact_is_reported_not_applied():
    entries = [
        FieldProvenance(value='red dress', source_type='creator_locked', locked=True),
        FieldProvenance(value='black jacket', source_type='director', confidence=0.8),
    ]
    conflicts = locked_conflicts(entries)
    assert conflicts
    assert conflicts[0].code == 'lock_conflict'
    assert 'Ask before changing a locked fact' in conflicts[0].detail


# ---------------------------------------------------------------- impact scoping

def test_location_change_reaches_only_its_dependents_and_protects_story():
    impact = impact_for('location')
    assert 'location_direction' in impact.card_fields
    assert 'look_direction' in impact.card_fields
    assert 'title' not in impact.card_fields
    assert 'title' in impact.protected
    assert 'what_happens' in impact.protected
    assert impact.downstream_cards is False


def test_shot_level_change_does_not_rewrite_card_fields():
    impact = impact_for('shot_camera', scope='shot')
    assert impact.card_fields == []
    assert impact.shot_fields == ['camera']
    assert 'title' in impact.protected


def test_continuity_change_is_reported_as_affecting_later_cards():
    impact = impact_for('continuity', downstream_cards=True)
    assert impact.downstream_cards is True
    assert 'later Cards' in impact.note


def test_prompt_change_touches_only_the_prompt_and_avoid_rules():
    impact = impact_for('prompt', scope='shot')
    assert impact.shot_fields == ['prompt', 'avoid', 'expected_result']
    assert impact.card_fields == []


# ---------------------------------------------------------------- status

def test_status_reflects_real_state_not_frontend_opinion():
    assert card_status(has_structure=True, direction=None, completeness='DRAFT',
        approval='draft') == 'DRAFT'
    assert card_status(has_structure=True, direction={'title': 'The Empty Street'},
        completeness='DRAFT', approval='draft') == 'BUILDING'
    assert card_status(has_structure=True, direction=_direction(), completeness='READY',
        approval='draft') == 'READY'
    assert card_status(has_structure=True, direction=_direction(), completeness='READY',
        approval='draft', results=2) == 'RESULT READY'
    assert card_status(has_structure=True, direction=_direction(), completeness='READY',
        approval='needs_review') == 'NEEDS YOU'
    assert card_status(has_structure=True, direction=_direction(), completeness='READY',
        approval='approved') == 'COMPLETE'
    # A lock is authority over a version, not executability: it never makes a Card look finished.
    empty = {'title': 'The Empty Street'}
    assert card_status(has_structure=True, direction=empty, completeness='DRAFT',
        approval='draft') == 'BUILDING'


def test_status_never_claims_readiness_when_validation_has_not_cleared():
    direction = _direction(audio_direction='Make it cinematic.')
    assert card_status(has_structure=True, direction=direction, completeness='DRAFT',
        approval='draft') == 'NEEDS YOU'


def test_every_status_has_an_honest_detail_line():
    for status in ('DRAFT', 'BUILDING', 'NEEDS YOU', 'READY', 'RESULT READY', 'COMPLETE'):
        detail = status_detail(status)  # type: ignore[arg-type]
        assert detail and not detail.endswith('...')
