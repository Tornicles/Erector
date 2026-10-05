"""Bhudhi output validator tests — Prompt A5."""

import pytest

from app.bhudhi.contract_registry import get_contract
from app.bhudhi.output_validator import parse_json_response, validate_against_contract
from app.core.errors import BhudhiOutputValidationError
from models.enums import BhudhiMode, BhudhiTriggerType


def test_valid_interpret_json_passes():
    c = get_contract(BhudhiMode.interpret, BhudhiTriggerType.goal_decomposition)
    output = {k: "" for k in c.allowed_outputs}
    output["unclear_terms"] = []
    output["hidden_assumptions"] = []
    output["contradictions"] = []
    output["clarification_questions"] = []
    output["interpretation_confidence"] = 0.5
    validate_against_contract(output, c)


def test_malformed_json_rejected():
    with pytest.raises(BhudhiOutputValidationError):
        parse_json_response("{not-json")


def test_missing_required_fields_rejected():
    c = get_contract(BhudhiMode.interpret, BhudhiTriggerType.goal_decomposition)
    with pytest.raises(BhudhiOutputValidationError):
        validate_against_contract({}, c)


def test_confidence_bounds_rejected():
    c = get_contract(BhudhiMode.interpret, BhudhiTriggerType.goal_decomposition)
    output = {k: "" for k in c.allowed_outputs}
    output["unclear_terms"] = []
    output["hidden_assumptions"] = []
    output["contradictions"] = []
    output["clarification_questions"] = []
    output["interpretation_confidence"] = 2.0
    with pytest.raises(BhudhiOutputValidationError):
        validate_against_contract(output, c)

