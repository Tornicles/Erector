"""
Prompt contract registry — Prompt A5
All Bhudhi calls must use a registered, active contract.
"""

from __future__ import annotations

from app.bhudhi.contracts import ALL_CONTRACTS
from app.core.errors import BhudhiContractError
from models.enums import BhudhiMode, BhudhiTriggerType


def list_contracts():
    return ALL_CONTRACTS


def get_contract(mode: BhudhiMode, trigger_type: BhudhiTriggerType):
    for c in ALL_CONTRACTS:
        if c.mode == mode and c.trigger_type == trigger_type and c.active:
            return c
    raise BhudhiContractError(
        "No active prompt contract for requested mode/trigger.",
        details={"mode": mode.value, "trigger_type": trigger_type.value},
    )


def assert_contract_active(contract_id: str) -> None:
    for c in ALL_CONTRACTS:
        if c.contract_id == contract_id and c.active:
            return
    raise BhudhiContractError("Contract is missing or inactive.", details={"contract_id": contract_id})


def validate_contract(contract) -> None:
    if not contract.contract_id or not contract.output_schema or not contract.allowed_outputs:
        raise BhudhiContractError("Invalid contract definition.", details={"contract_id": contract.contract_id})


def get_fallback_strategy(contract) -> str:
    return getattr(contract, "fallback_strategy", "deterministic")

