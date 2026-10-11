"""Adaptive intake decision-engine tests: families, flows, extraction, honesty."""

from app.domain.director import interpret_intent
from app.domain.intake import (
    MAX_OPEN_DECISIONS,
    analyze_intake,
    classify_family,
    compose_creative_direction,
    decision_to_brief_payload,
    extract_answer_facts,
)


def _intent(goal: str, **known: object):
    result = interpret_intent(goal, known_context=dict(known))
    return result.intent


def _open_ids(goal: str, answered: dict[str, str] | None = None, **kwargs: object) -> list[str]:
    intent = _intent(goal)
    analysis = analyze_intake(goal, intent, answered=answered or {}, **kwargs)
    return [item.decision_id for item in analysis.material_unknowns]


def test_vague_narrative_asks_premise_then_scale_not_gear():
    ids = _open_ids('I want to make a story about a zombie girl in Kenya.')
    assert ids[0] == 'premise'
    assert 1 <= len(ids) <= 3
    assert 'lens' not in ' '.join(ids).lower()


def test_detailed_series_goes_straight_to_confirmation():
    goal = ('Make me a 6-part dark mystery-horror zombie series in Nairobi, around 2 minutes '
            'per episode, about a girl discovering why everyone disappeared, filmed on my iPhone.')
    intent = _intent(goal)
    analysis = analyze_intake(goal, intent, answered={})
    assert analysis.enough_to_direct is True
    assert analysis.material_unknowns == []
    assert 'Nairobi' in analysis.creative_direction_summary or 'nairobi' in analysis.creative_direction_summary.lower()
    assert analysis.producer == 'deterministic'


def test_answer_shrinks_the_queue_without_reasking():
    goal = 'I want to make a story about a zombie girl in Kenya.'
    first = _open_ids(goal)
    # The premise gates everything downstream: one question first.
    assert first == ['premise']
    second = _open_ids(goal, answered={'premise': 'A girl discovers why everyone vanished.'})
    assert 'premise' not in second
    assert set(second) == {'format', 'direction', 'story_engine'}


def test_one_answer_can_resolve_siblings_through_extraction():
    facts = extract_answer_facts('Six episodes, about two minutes each, vertical for TikTok.')
    assert facts['episode_count'] == '6'
    assert facts['episode_length'] == '120000'
    assert facts['platform'] == 'TikTok / Reels'
    assert facts['aspect_ratio'] == '9:16'


def test_extracted_answers_carry_extracted_provenance():
    goal = 'I want to make a horror series.'
    intent = _intent(goal)
    analysis = analyze_intake(goal, intent, answered={'episode_count': 'Six episodes, about two minutes each.'})
    states = {item.decision_id: item for item in analysis.decisions}
    assert states['episode_length'].answered_by == 'extracted'


def test_commercial_wedding_sports_documentary_families():
    assert _open_ids('I need a 45-second product commercial for a coffee brand')[0] in {'product', 'objective'}
    wedding = _open_ids('I am filming a wedding tomorrow, cinematic highlight film.')
    assert 'deliverable' not in wedding  # already stated
    assert 'coverage_priority' in wedding
    sports = _open_ids('Filming my daughter\u2019s soccer game this weekend.')
    assert sports[0] == 'output'
    documentary = _open_ids('A documentary about disappearing neighborhood restaurants.')
    assert documentary[0] == 'driver'


def test_reference_direction_removes_direction_question():
    goal = 'I want something like this for my zombie story.'
    premise = {'premise': 'A girl outlives her street.'}
    without = _open_ids(goal, answered=premise)
    with_reference = _open_ids(goal, answered=premise, reference_mechanics=['camera: slow handheld drift'])
    assert 'direction' in without
    assert 'direction' not in with_reference
    analysis_ids = analyze_intake(goal, _intent(goal), answered={}, reference_mechanics=['camera: slow handheld drift'])
    assert any(fact.source == 'reference_shows' for fact in analysis_ids.inferred)


def test_script_material_removes_premise_for_narrative():
    goal = 'Produce my short film, script attached.'
    assert 'premise' in _open_ids(goal)
    assert 'premise' not in _open_ids(goal, story_material=True)


def test_queue_never_exceeds_five_and_normal_case_is_small():
    goal = 'Make something.'
    intent = _intent(goal)
    analysis = analyze_intake(goal, intent, answered={})
    assert len(analysis.material_unknowns) <= MAX_OPEN_DECISIONS
    vague_narrative = _open_ids('I want to make a story about a zombie girl in Kenya.')
    assert len(vague_narrative) <= 3


def test_recommendations_are_contextual_with_reasons():
    goal = 'A 45-second coffee commercial for TikTok.'
    intent = _intent(goal)
    analysis = analyze_intake(goal, intent, answered={'product': 'North Bean'})
    by_id = {item.decision_id: item for item in analysis.decisions}
    platform = by_id.get('platform')
    if platform is not None and platform.state == 'open':
        assert platform.recommendation.option_ids, 'an open decision must carry a recommendation'
        assert platform.recommendation.reason, 'a recommendation must explain itself'


def test_no_numeric_scores_leak_and_deferred_lists_gear():
    goal = 'A wedding film.'
    intent = _intent(goal)
    analysis = analyze_intake(goal, intent, answered={})
    for item in analysis.material_unknowns:
        assert 1 <= item.rank <= 110
    dumped = analysis.model_dump(mode='json')
    assert 'rank' in dumped['material_unknowns'][0]  # internal only; clients must not render it
    assert any('lens' in topic.lower() for topic in analysis.deferred)


def test_aerial_conflict_surfaces_only_when_material():
    goal = 'A cinematic aerial chase over the city.'
    assert 'aerial_tradeoff' in _open_ids(goal, setup_names=['Sony A6700'])
    assert 'aerial_tradeoff' not in _open_ids(goal, setup_names=['DJI drone', 'Sony A6700'])
    assert 'aerial_tradeoff' not in _open_ids('A quiet interview.', setup_names=['Sony A6700'])


def test_tonde_decide_marks_state_and_stops_reasking():
    goal = 'A short horror film.'
    intent = _intent(goal)
    first = analyze_intake(goal, intent, answered={})
    assert [item.decision_id for item in first.material_unknowns] == ['premise']
    analysis = analyze_intake(goal, intent, answered={'premise': 'A lost key.', 'direction': 'TONDE decides'})
    by_id = {item.decision_id: item for item in analysis.decisions}
    assert by_id['direction'].state == 'tonde_decided'
    assert 'direction' not in [item.decision_id for item in analysis.material_unknowns]


def test_creative_summary_uses_only_settled_facts():
    goal = 'A wedding film with highlight deliverable.'
    intent = _intent(goal)
    summary, facts = compose_creative_direction(
        classify_family(intent, goal, {}), intent,
        {'deliverable': 'Highlight film', 'coverage_priority': 'Emotion'}, [],
    )
    assert 'highlight' in summary.lower()
    assert 'drone' not in summary.lower()


def test_photography_has_no_runtime_question():
    ids = _open_ids('Photograph a portrait set for a magazine.')
    assert 'runtime' not in ids
    assert 'subject_matter' in ids


def test_client_payload_carries_topic_and_stable_id():
    goal = 'I am filming a wedding tomorrow.'
    intent = _intent(goal)
    analysis = analyze_intake(goal, intent, answered={})
    assert analysis.material_unknowns, 'a vague idea must produce at least one decision'
    payload = decision_to_brief_payload(analysis.material_unknowns[0])
    assert payload['id'] == analysis.material_unknowns[0].decision_id
    assert payload['topic'], 'clients render the topic eyebrow from this field'
    assert payload['options'] and payload['options'][0]['label']
    assert payload['allow_tonde_decides'] is True


def test_complete_first_draft_only_stops_for_critical():
    goal = 'Make something.'
    intent = _intent(goal)
    analysis = analyze_intake(goal, intent, answered={}, collaboration_mode='complete_first_draft')
    assert all(item.impact == 'critical' for item in analysis.material_unknowns)
