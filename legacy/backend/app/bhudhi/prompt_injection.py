"""
Prompt injection detection — Prompt A5
Flags/blocks authority escalation and schema evasion attempts.
"""

from __future__ import annotations

import re
from typing import Any

from app.models.bhudhi import PromptInjectionFlag
from models.enums import BhudhiRiskLevel, PromptInjectionRiskType


BLOCKING_PATTERNS: list[tuple[PromptInjectionRiskType, re.Pattern, str]] = [
    (PromptInjectionRiskType.instruction_override, re.compile(r"ignore (?:all|previous) instructions", re.I), "Instruction override attempt"),
    (PromptInjectionRiskType.system_prompt_request, re.compile(r"(reveal|show).*(system prompt|developer message)", re.I), "System prompt request"),
    (PromptInjectionRiskType.secret_extraction, re.compile(r"(api key|jwt|token|password|private key)", re.I), "Secret extraction attempt"),
    (PromptInjectionRiskType.authority_escalation, re.compile(r"(you are now|pretend you are).*(scoring|admin|verdict|engine)", re.I), "Authority escalation"),
    (PromptInjectionRiskType.output_schema_evasion, re.compile(r"(do not follow|ignore).*(json|schema)", re.I), "Schema evasion attempt"),
    (PromptInjectionRiskType.jailbreak_attempt, re.compile(r"jailbreak|dan mode|developer mode", re.I), "Jailbreak attempt"),
]


def _flatten_text(payload: Any) -> str:
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        return " ".join(_flatten_text(v) for v in payload.values())
    if isinstance(payload, list):
        return " ".join(_flatten_text(v) for v in payload)
    return str(payload)


def scan_for_prompt_injection(payload: Any, *, blocking: bool = True) -> list[PromptInjectionFlag]:
    text = _flatten_text(payload)
    flags: list[PromptInjectionFlag] = []
    for risk_type, pat, desc in BLOCKING_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        blocks = blocking and risk_type in (
            PromptInjectionRiskType.authority_escalation,
            PromptInjectionRiskType.system_prompt_request,
            PromptInjectionRiskType.output_schema_evasion,
            PromptInjectionRiskType.instruction_override,
        )
        flags.append(
            PromptInjectionFlag(
                risk_type=risk_type,
                risk_level=BhudhiRiskLevel.blocked if blocks else BhudhiRiskLevel.high,
                description=desc,
                matched_text=m.group(0)[:200],
                action_taken="blocked" if blocks else "flagged",
                blocks_request=blocks,
            )
        )
    return flags

