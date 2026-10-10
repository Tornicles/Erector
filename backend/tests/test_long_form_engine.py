"""Prompt 8 engine coverage: long-form scope resolution, Series planning, depth vocabulary.

Deterministic scope resolution is the safety property here: a command that names no scope
must be reported as ambiguous rather than silently widened to the whole Production, and a
Series command must resolve to a finite, explicit horizon. Real SQL behaviour (ordering,
rollups, locks, RLS, idempotency, partial success) is proven against embedded PostgreSQL in
tests/database/prompt8-long-form.test.mjs.
"""

from __future__ import annotations

from app.services.long_form import (
    StructureIndex,
    depth_label,
    interpret_long_form_direction,
    legacy_requested_depth_label,
    line_state_label,
    readiness_is_criteria_based,
    resolve_long_form_scope,
    resolve_series_scope,
    structure_summary_line,
)

ACT_TWO = '00000000-0000-4000-8000-000000000101'
SEQ_FOUR = '00000000-0000-4000-8000-000000000201'
SCENE_EIGHTEEN = '00000000-0000-4000-8000-000000000301'
SHOT_THREE = '00000000-0000-4000-8000-000000000401'
PRODUCTION = '00000000-0000-4000-8000-000000000020'


def index(*, acts: int = 3, sequences: int = 4, scenes: int = 18, shots: int = 3) -> StructureIndex:
    built = StructureIndex()
    for number in range(1, acts + 1):
        built.acts.append(_node('act', ACT_TWO if number == 2 else f'act-{number}', f'Act {number}', number))
    for number in range(1, sequences + 1):
        built.sequences.append(_node('sequence', SEQ_FOUR if number == 4 else f'seq-{number}', f'Sequence {number}', number))
    for number in range(1, scenes + 1):
        built.scenes.append(_node('scene', SCENE_EIGHTEEN if number == 18 else f'scene-{number}', f'Scene {number}', number))
    for number in range(1, shots + 1):
        built.shots.append(_node('shot', SHOT_THREE if number == 3 else f'shot-{number}', f'Shot {number}', number))
    return built


def _node(level: str, identifier: str, title: str, number: int):
    from app.services.long_form import StructureNode

    return StructureNode(level=level, identifier=identifier, title=title, display_index=number)


def test_numbered_act_resolves_against_the_loaded_structure() -> None:
    resolution = resolve_long_form_scope('Make Act 2 shorter.', index(), {})
    assert resolution.level == 'act'
    assert resolution.identifier == ACT_TWO
    assert resolution.display_number == 2
    assert resolution.operation == 'shorten_scope'
    assert resolution.ambiguous is False
    assert resolution.as_dict()['scope_is_explicit'] is True


def test_numbered_act_that_is_not_loaded_is_reported_not_widened() -> None:
    resolution = resolve_long_form_scope('Rewrite Act 7', index(acts=3), {'production_id': PRODUCTION})
    assert resolution.identifier is None
    assert resolution.ambiguous is True
    assert 'No Act 7' in resolution.note


def test_sequence_scene_and_shot_numbers_resolve() -> None:
    sequence = resolve_long_form_scope('Replace Sequence 4 with a more suspenseful approach', index(), {})
    assert (sequence.level, sequence.identifier) == ('sequence', SEQ_FOUR)
    assert sequence.operation == 'raise_tension'
    scene = resolve_long_form_scope('Add three alternative Scenes at Scene 18', index(), {})
    assert (scene.level, scene.identifier) == ('scene', SCENE_EIGHTEEN)
    assert scene.operation == 'propose_alternatives'
    shot = resolve_long_form_scope('Give Shot 3 a stronger hook', index(), {})
    assert (shot.level, shot.identifier) == ('shot', SHOT_THREE)
    assert shot.operation == 'strengthen_hook'


def test_word_numbers_are_understood() -> None:
    resolution = resolve_long_form_scope('Shorten Act two', index(), {})
    assert resolution.display_number == 2
    assert resolution.identifier == ACT_TWO


def test_demonstrative_scope_uses_the_studio_selection() -> None:
    resolution = resolve_long_form_scope('Replace this Sequence with a more suspenseful approach', index(),
        {'sequence_id': SEQ_FOUR})
    assert (resolution.level, resolution.identifier) == ('sequence', SEQ_FOUR)
    assert resolution.ambiguous is False


def test_demonstrative_scope_without_a_selection_is_ambiguous() -> None:
    resolution = resolve_long_form_scope('Replace this Sequence', index(), {})
    assert resolution.identifier is None
    assert resolution.ambiguous is True
    assert 'more than one scope' in resolution.note


def test_a_command_naming_no_scope_never_becomes_production_wide() -> None:
    resolution = resolve_long_form_scope('Make it shorter', index(), {'production_id': PRODUCTION})
    assert resolution.ambiguous is True
    assert resolution.level == 'production'
    assert 'did not widen' in resolution.note


def test_production_wide_only_when_the_creator_says_so() -> None:
    resolution = resolve_long_form_scope('Shorten the whole Production', index(), {'production_id': PRODUCTION})
    assert resolution.level == 'production'
    assert resolution.ambiguous is False
    assert resolution.identifier == PRODUCTION


def test_direction_operations_map_deterministically() -> None:
    assert interpret_long_form_direction('Make Act 2 more tense')['operation'] == 'raise_tension'
    assert interpret_long_form_direction('This middle section drags')['operation'] == 'tighten_middle'
    assert interpret_long_form_direction('Move this reveal to the next Scene')['operation'] == 'move_reveal'
    assert interpret_long_form_direction('Give this Character a stronger arc across Act 1')['operation'] == 'strengthen_arc'
    unmatched = interpret_long_form_direction('Make it feel more like a Sunday')
    assert unmatched['operation'] is None
    assert 'nothing was changed' in unmatched['note']


def test_structure_index_merges_a_loaded_level_without_duplicates() -> None:
    root = index(acts=2, sequences=0, scenes=0, shots=0)
    inner = index(acts=0, sequences=2, scenes=1, shots=0)
    root.merge(inner)
    assert len(root.acts) == 2
    assert sorted(node.identifier for node in root.sequences) == ['seq-1', 'seq-2']
    assert len(root.scenes) == 1
    root.merge(inner)
    assert len(root.sequences) == 2, 'merging the same page twice adds nothing'


def test_structure_index_lookup_by_title_is_case_insensitive() -> None:
    built = index(acts=0, sequences=0, scenes=1, shots=0)
    built.scenes[0] = _node('scene', SCENE_EIGHTEEN, 'Marcus confronts Maya', 18)
    found = built.by_title('scene', 'confronts')
    assert found is not None and found.identifier == SCENE_EIGHTEEN
    assert built.by_title('scene', 'nothing like this') is None


def test_series_command_resolves_next_seven() -> None:
    resolved = resolve_series_scope("Plan next week's episodes.")
    assert resolved.horizon == 'next_7'
    assert resolved.operation == 'plan_future_episodes'
    assert 'Production shells' in resolved.note


def test_series_command_resolves_tomorrow_and_longer_horizons() -> None:
    assert resolve_series_scope('Give tomorrow a stronger hook').horizon == 'tomorrow'
    assert resolve_series_scope('Plan the next 14 days').horizon == 'next_14'
    assert resolve_series_scope('Fill the next 30 slots').horizon == 'next_30'
    assert resolve_series_scope('Generate the entire series').horizon == 'entire_series'


def test_series_command_resolves_an_explicit_custom_count() -> None:
    resolved = resolve_series_scope('Generate the next seven finance videos.')
    assert resolved.horizon in ('custom', 'next_7')
    assert resolved.operation == 'plan_future_episodes'
    assert resolve_series_scope('Plan 5 episodes about budgeting').count == 5
    assert resolve_series_scope('Plan 5 episodes about budgeting').horizon == 'custom'


def test_series_command_flags_repetition_avoidance() -> None:
    resolved = resolve_series_scope("Plan next seven episodes but don't repeat this week's topics.")
    assert resolved.avoid_recent is True
    assert resolved.horizon == 'next_7'
    assert resolve_series_scope('Plan next seven episodes').avoid_recent is False


def test_series_depth_is_taken_from_the_command_or_left_open() -> None:
    assert resolve_series_scope('Plan 4 episodes, ideas only').depth == 'ideas_only'
    assert resolve_series_scope('Plan 4 episodes with a full script').depth == 'script'
    assert resolve_series_scope('Plan 4 episodes, complete plan').depth == 'complete_plan'
    assert resolve_series_scope('Plan 4 episodes').depth is None


def test_series_command_with_no_planning_meaning_creates_nothing() -> None:
    resolved = resolve_series_scope('What did we decide about the host?')
    assert resolved.horizon is None
    assert resolved.count is None
    assert 'did not map' in resolved.note


def test_cadence_language_that_is_not_a_horizon_stays_empty() -> None:
    resolved = resolve_series_scope('Review the cadence')
    assert resolved.operation == 'review_cadence'
    assert resolved.horizon is None


def test_depth_and_line_state_vocabulary_is_the_product_wording() -> None:
    assert depth_label('story_defined') == 'Story Defined'
    assert depth_label('in_progress') == 'Capture / Generation In Progress'
    assert line_state_label('ready_to_execute') == 'Ready to Execute'
    assert legacy_requested_depth_label('complete_plan') == 'Complete Production Plan'
    assert depth_label('unexpected_value') == 'unexpected value'


def test_breadcrumb_line_reads_like_a_position_not_an_edge_id() -> None:
    line = structure_summary_line({'title': 'Shot 18C', 'level': 'shot'},
        [{'level': 'production', 'title': 'Movie'}, {'level': 'act', 'title': 'Act 2'},
         {'level': 'sequence', 'title': 'Sequence 4'}, {'level': 'scene', 'title': 'Scene 18'}])
    assert line == 'Movie -> Act 2 -> Sequence 4 -> Scene 18'


def test_readiness_guard_rejects_any_percentage_and_unknown_state() -> None:
    good = [{'readiness': {'state': 'BLOCKED', 'blocking': 1, 'warnings': 2}},
        {'readiness': {'state': 'READY WITH WARNINGS', 'blocking': 0, 'warnings': 1}}]
    assert readiness_is_criteria_based(good) is True
    assert readiness_is_criteria_based([{'readiness': {'state': 'BLOCKED', 'percentage': 87}}]) is False
    assert readiness_is_criteria_based([{'readiness': {'state': 'ALMOST'}}]) is False
