"""Bhudhi model tests — Prompt A5."""

import json

from app.models.bhudhi import BhudhiAuthorityContext, BhudhiPromptContract, BhudhiResponse, BhudhiTrigger
from models.enums import BhudhiMode, BhudhiSource, BhudhiStatus, BhudhiTriggerType, PromptInjectionRiskType


def test_trigger_validates_allowed_modes():
    trg = BhudhiTrigger(trigger_type=BhudhiTriggerType.goal_decomposition, source=BhudhiSource.test_harness, mode=BhudhiMode.interpret)
    assert trg.mode == BhudhiMode.interpret


def test_authority_context_defaults_safe():
    ctx = BhudhiAuthorityContext(allowed_mode=BhudhiMode.interpret)
    assert ctx.can_modify_state is False
    assert ctx.can_write_database is False


def test_prompt_contract_requires_core_fields():
    c = BhudhiPromptContract(
        contract_id="c1",
        mode=BhudhiMode.interpret,
        trigger_type=BhudhiTriggerType.goal_decomposition,
        name="n",
        description="d",
        system_instructions="s",
        input_schema={},
        output_schema={"type": "object", "required": ["problem_claim"]},
        allowed_outputs=["problem_claim"],
        forbidden_outputs=["verdict"],
    )
    assert c.contract_id == "c1"


def test_response_supports_fallback_status():
    r = BhudhiResponse(
        request_id="r1",
        mode=BhudhiMode.interpret,
        trigger_type=BhudhiTriggerType.goal_decomposition,
        status=BhudhiStatus.fallback,
        output={},
        validated_output={},
        fallback_used=True,
    )
    assert r.fallback_used is True


def test_models_serialize_no_objectid_leakage():
    trg = BhudhiTrigger(trigger_type=BhudhiTriggerType.goal_decomposition, source=BhudhiSource.test_harness, mode=BhudhiMode.interpret)
    text = json.dumps(trg.model_dump(mode="json"))
    assert "ObjectId" not in text

