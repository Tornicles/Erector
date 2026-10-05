"""
Authority guard — Prompt A5
Blocks forbidden actions/fields from Bhudhi input/output.
"""

from __future__ import annotations

from typing import Any

from app.core.errors import BhudhiAuthorityError
from app.models.bhudhi import AuthorityViolation
from models.enums import BhudhiForbiddenAction, BhudhiMode


FORBIDDEN_FIELDS = {
    "reality_score",
    "validation_confidence_score",
    "validation_confidence",
    "score",
    "scores",
    "verdict",
    "final_verdict",
    "proceed",
    "blocked",
    "blocker_override",
    "climate_state",
    "current_climate",
    "business_climate",
    "economy_dna",
    "civilization_dna",
    "trust_index",
    "corruption_index",
    "institutional_strength_index",
    "assumption_status",
    "dependency_status",
    "validation_status",
    "launch_ready",
    "approval",
    "approved",
    "rejected",
}


def assert_mode_allowed(mode: BhudhiMode) -> None:
    if mode not in list(BhudhiMode):
        raise BhudhiAuthorityError(f"Unsupported Bhudhi mode: {mode}")


def detect_forbidden_fields(payload: Any, *, path: str = "") -> list[AuthorityViolation]:
    violations: list[AuthorityViolation] = []
    if isinstance(payload, dict):
        for k, v in payload.items():
            key = str(k)
            full = f"{path}.{key}" if path else key
            if key in FORBIDDEN_FIELDS:
                violations.append(
                    AuthorityViolation(
                        forbidden_action=BhudhiForbiddenAction.override,
                        field=full,
                        description=f"Forbidden structured field present: {key}",
                        source="output",
                        blocks_request=True,
                    )
                )
            violations.extend(detect_forbidden_fields(v, path=full))
    elif isinstance(payload, list):
        for i, item in enumerate(payload):
            violations.extend(detect_forbidden_fields(item, path=f"{path}[{i}]"))
    return violations


def detect_forbidden_intent(input_payload: dict) -> list[AuthorityViolation]:
    text = " ".join([str(v) for v in input_payload.values() if isinstance(v, (str, int, float))]).lower()
    triggers = {
        "calculate": BhudhiForbiddenAction.calculate,
        "decide": BhudhiForbiddenAction.decide,
        "override": BhudhiForbiddenAction.override,
        "verdict": BhudhiForbiddenAction.verdict,
        "score": BhudhiForbiddenAction.score,
        "climate": BhudhiForbiddenAction.determine_climate,
        "economy dna": BhudhiForbiddenAction.alter_economy_profile,
        "change validation state": BhudhiForbiddenAction.change_validation_state,
    }
    violations: list[AuthorityViolation] = []
    for needle, action in triggers.items():
        if needle in text:
            violations.append(
                AuthorityViolation(
                    forbidden_action=action,
                    description=f"Forbidden intent detected in input: {needle}",
                    source="input",
                    blocks_request=True,
                )
            )
    return violations


def assert_no_forbidden_output(output_payload: dict) -> list[AuthorityViolation]:
    return detect_forbidden_fields(output_payload)


def assert_no_authority_violations(violations: list[AuthorityViolation]) -> None:
    if any(v.blocks_request for v in violations):
        raise BhudhiAuthorityError(
            "Bhudhi request/output violates authority boundaries.",
            details={"violations": [v.model_dump() for v in violations]},
        )

