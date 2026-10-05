from uuid import UUID

import pytest
from pydantic import ValidationError

from app.domain.director import (
    ProductionConstraints,
    ProductionDraft,
    ProductionIntent,
    SceneDraft,
    assess_reality,
    build_draft,
    interpret_intent,
)
from app.domain.vocabulary import CollaborationMode, ExecutionMethod, ProductionType
from app.services.director import reference_capability


CAMERA = {"resource_type": "camera", "name": "Sony A6700"}
LENS = {"resource_type": "lens", "name": "24–70mm zoom", "mount": "E"}
LIGHT = {"resource_type": "light", "name": "Amaran 60x"}
LAV = {"resource_type": "wireless_audio", "name": "Wireless lav kit"}
GIMBAL = {"resource_type": "gimbal", "name": "Travel gimbal"}


def test_intent_classifies_production_types_and_recurring_weekday_schedule():
    cases = [
        ("Make a 30-second commercial for my coffee shop", ProductionType.commercial),
        ("Create an original short film about a lost key", ProductionType.short_film),
        ("Create a 45-second crime trailer", ProductionType.trailer),
        ("Photograph a portrait for a magazine", ProductionType.photography),
        ("Make a host-led YouTube video about lighting", ProductionType.youtube),
        ("Make a music video for this song", ProductionType.music_video),
        ("Publish a finance video every weekday", ProductionType.recurring_content),
        ("Make a 30-minute long-form film", ProductionType.long_form_film),
    ]
    for goal, expected in cases:
        assert interpret_intent(goal).intent.primary_type == expected, goal


def test_ambiguous_commercial_asks_for_product_and_platform_without_repeating_answers():
    first = interpret_intent("Make an ad for my company")
    assert "product" in {question.id for question in first.questions}
    assert "platform" in {question.id for question in first.questions}
    answered = interpret_intent(
        "Make an ad for my company",
        known_context={"answered_decisions": {"product": "Coffee", "platform": "Instagram Reels"}},
    )
    assert "product" not in {question.id for question in answered.questions}
    assert "platform" not in {question.id for question in answered.questions}
    assert answered.intent.subject == "Coffee"
    assert answered.intent.platform == "Instagram Reels"


def test_question_planner_avoids_dialogue_and_runtime_for_photography():
    result = interpret_intent("Create a product photograph for my bakery")
    question_ids = {question.id for question in result.questions}
    assert "dialogue_mode" not in question_ids
    assert "runtime" not in question_ids
    assert result.intent.runtime_ms is None
    assert result.intent.primary_type == ProductionType.photography


def test_first_draft_mode_labels_runtime_and_non_creator_choices_as_assumptions():
    result = interpret_intent("Make an original crime trailer", collaboration_mode=CollaborationMode.complete_first_draft)
    assert result.intent.runtime_ms == 30000
    assert result.assumptions
    assert result.questions == []
    draft = build_draft(result.intent)
    assert draft.planned_duration_ms == 30000
    assert sum(scene.duration_ms or 0 for scene in draft.scenes) == 30000


def test_timed_production_draft_requires_exact_integer_child_sum():
    with pytest.raises(ValidationError, match="equal the target runtime"):
        ProductionDraft(
            title="Coffee", production_type="commercial", execution_method="real", planned_duration_ms=30000,
            creative_objective="A coffee ad", scenes=[SceneDraft(title="Hero", duration_ms=29999)],
        )
    with pytest.raises(ValidationError):
        SceneDraft(title="Negative duration", duration_ms=-1)


def test_reference_capability_does_not_treat_linked_media_id_as_analyzed_bytes():
    capability = reference_capability({"source_type": "upload", "media_id": str(UUID(int=1))})
    assert capability["analysis"] == "not_started"
    assert capability["media_bytes"] != "available"
    assert capability["image"] == "unverified"
    url = reference_capability({"source_type": "social_url", "source_url": "https://example.test/video"})
    assert url["media_bytes"] == "unavailable"
    assert url["video_frames"] == "unavailable"
    assert "not been inspected" in url["note"]


def test_reality_check_uses_owned_setup_and_does_not_call_it_a_gap():
    intent = ProductionIntent(
        goal="Make a 30-second coffee commercial with dialogue and a slow push-in",
        primary_type="commercial", runtime_ms=30000, dialogue_mode="minimal",
        constraints=ProductionConstraints(crew_size=1),
    )
    plan = build_draft(intent)
    owned = assess_reality(plan, [CAMERA, LENS, LIGHT, LAV, GIMBAL], intent.constraints)
    assert owned.feasibility == "ready"
    assert all(item.status == "owned" for item in owned.matches if item.status != "optional")
    missing = assess_reality(plan, [], intent.constraints)
    assert missing.feasibility == "adapt"
    assert any(item.status == "missing" for item in missing.matches)
    ai_intent = intent.model_copy(update={"execution": ExecutionMethod.ai})
    ai_plan = build_draft(ai_intent)
    ai = assess_reality(ai_plan, [], ai_intent.constraints)
    assert not any("Camera" in item.requirement for item in ai.matches)


def test_resource_and_time_constraints_are_not_misread_as_production_runtime():
    result = interpret_intent("I have 90 minutes to shoot a 30-second coffee ad by myself")
    assert result.intent.runtime_ms == 30000
    assert result.intent.constraints.available_hours == 1.5
    assert result.intent.constraints.crew_size == 1
