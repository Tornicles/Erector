"""Bhudhi prompt contract tests — Prompt A5."""

import pytest

from app.bhudhi.contract_registry import get_contract, list_contracts
from app.bhudhi.contracts import ALL_CONTRACTS
from app.core.errors import BhudhiContractError
from models.enums import BhudhiMode, BhudhiTriggerType


def test_all_5_contracts_exist():
    assert len(ALL_CONTRACTS) == 5


def test_every_contract_has_allowed_and_forbidden():
    for c in ALL_CONTRACTS:
        assert c.allowed_outputs
        assert c.forbidden_outputs
        assert c.output_schema


def test_get_contract_by_mode_trigger():
    c = get_contract(BhudhiMode.interpret, BhudhiTriggerType.goal_decomposition)
    assert c.mode == BhudhiMode.interpret


def test_invalid_mode_trigger_fails():
    with pytest.raises(BhudhiContractError):
        get_contract(BhudhiMode.explain, BhudhiTriggerType.goal_decomposition)


def test_contract_version_and_authority_block_present():
    for c in ALL_CONTRACTS:
        assert c.version
        assert "You are Bhudhi" in c.system_instructions

