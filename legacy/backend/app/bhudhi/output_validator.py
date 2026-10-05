"""
Output validator — Prompt A5
Parses JSON-only provider output and validates required schema keys.
"""

from __future__ import annotations

import json
from typing import Any

from app.core.errors import BhudhiOutputValidationError


def parse_json_response(raw_response: str) -> dict:
    try:
        data = json.loads(raw_response)
    except Exception as exc:
        raise BhudhiOutputValidationError("Malformed JSON from provider.", details={"error": str(exc)}) from exc
    if not isinstance(data, dict):
        raise BhudhiOutputValidationError("Provider output must be a JSON object.")
    return data


def _required_keys(output_schema: dict) -> set[str]:
    required = output_schema.get("required", [])
    return set(required) if isinstance(required, list) else set()


def validate_against_contract(output: dict, contract: Any) -> None:
    schema = getattr(contract, "output_schema", None) or {}
    required = _required_keys(schema)
    missing = [k for k in required if k not in output]
    if missing:
        raise BhudhiOutputValidationError(
            "Missing required fields in Bhudhi output.",
            details={"missing_fields": missing, "contract_id": getattr(contract, "contract_id", None)},
        )
    # Enforce confidence bounds if present
    if "interpretation_confidence" in output:
        c = output["interpretation_confidence"]
        if not (isinstance(c, (int, float)) and 0 <= float(c) <= 1):
            raise BhudhiOutputValidationError("interpretation_confidence must be 0–1.")

