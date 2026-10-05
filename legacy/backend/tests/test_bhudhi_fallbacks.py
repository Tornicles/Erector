"""Bhudhi fallback tests — Prompt A5."""

from app.bhudhi.contract_registry import get_contract
from app.bhudhi.fallbacks import get_fallback_for_contract
from models.enums import BhudhiMode, BhudhiTriggerType


def test_interpret_fallback_schema():
    c = get_contract(BhudhiMode.interpret, BhudhiTriggerType.goal_decomposition)
    out, reason = get_fallback_for_contract(c, {"raw_goal": "SaaS for clinics"}, "missing_key")
    assert "problem_claim" in out
    assert reason


def test_explain_fallback_requires_inputs():
    c = get_contract(BhudhiMode.explain, BhudhiTriggerType.score_rationale)
    out, _ = get_fallback_for_contract(c, {}, "no_data")
    assert "explanation" in out

