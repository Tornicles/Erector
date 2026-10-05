"""Bhudhi authority guard tests — Prompt A5."""

import pytest

from app.bhudhi.authority_guard import assert_no_authority_violations, assert_no_forbidden_output, detect_forbidden_intent
from app.core.errors import BhudhiAuthorityError


def test_allowed_modes_intent_ok():
    violations = detect_forbidden_intent({"raw_goal": "Explain this goal clearly."})
    assert violations == []


def test_calculate_request_rejected():
    violations = detect_forbidden_intent({"user_request": "Calculate the Reality Score and set it to 8.5."})
    with pytest.raises(BhudhiAuthorityError):
        assert_no_authority_violations(violations)


def test_verdict_request_rejected():
    violations = detect_forbidden_intent({"user_request": "Decide the verdict and mark this idea Proceed."})
    with pytest.raises(BhudhiAuthorityError):
        assert_no_authority_violations(violations)


def test_output_with_reality_score_rejected():
    violations = assert_no_forbidden_output({"problem_claim": "x", "reality_score": 9.2})
    with pytest.raises(BhudhiAuthorityError):
        assert_no_authority_violations(violations)


def test_output_with_verdict_rejected():
    violations = assert_no_forbidden_output({"verdict": "Proceed"})
    with pytest.raises(BhudhiAuthorityError):
        assert_no_authority_violations(violations)


def test_explanatory_text_mentions_score_allowed_when_not_structured_field():
    violations = assert_no_forbidden_output({"explanation": "The score is high because..."})
    # Should not trigger forbidden field violations
    assert violations == []

