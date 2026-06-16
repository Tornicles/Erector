"""
Answer Quality Service — Prompt A4
"""

from __future__ import annotations

import re
from typing import Any, Optional

from app.models.context import AnswerQualityReport, ContextAnswer, ValidationContext
from app.models.questions import QuestionDefinition
from models.enums import AnswerQualityFlag

VAGUE_PATTERNS = [
    r"\beveryone\b", r"\ball businesses\b", r"\ball people\b",
    r"\bpeople will love\b", r"\bgo viral\b", r"\bi just know\b",
    r"\bglobally\b", r"\bno risk\b", r"\bno competitor",
]
INFLATED_PATTERNS = [
    r"\bmillion\b", r"\b1m\b", r"\bviral\b", r"\bdominate\b",
    r"\bno budget\b", r"\$0\b",
]
NO_LEGAL_PATTERNS = [r"\bnone\b", r"\bno legal\b", r"\bnot a problem\b", r"\bnothing\b"]


def detect_vague_answer(text: str) -> bool:
    lower = text.lower().strip()
    return any(re.search(p, lower) for p in VAGUE_PATTERNS)


def detect_inflated_answer(text: str) -> bool:
    lower = text.lower().strip()
    return any(re.search(p, lower) for p in INFLATED_PATTERNS)


def detect_missing_specificity(text: str) -> bool:
    lower = text.lower().strip()
    if len(lower) < 8:
        return True
    if lower in ("yes", "no", "maybe", "not sure", "idk"):
        return True
    return False


def detect_unsupported_claim(text: str) -> bool:
    lower = text.lower()
    triggers = ["will pay because", "useful", "love it", "obviously", "definitely will"]
    return any(t in lower for t in triggers)


def detect_contradiction(
    answer_value: str,
    previous_answers: dict[str, Any],
    structured_goal: Optional[dict],
) -> Optional[str]:
    lower = answer_value.lower()
    ev = str(previous_answers.get("evidence_customer_proof", "")).lower()
    if "no evidence" in ev or ev in ("none", "none yet"):
        if any(w in lower for w in ("million", "everyone wants", "huge demand", "1 million")):
            return "Strong demand claim without evidence"
    legal = str(previous_answers.get("risk_legal_constraints", "")).lower()
    if legal in ("none", "no", "nothing") and structured_goal:
        assumptions = structured_goal.get("hidden_assumptions", [])
        if any("regulat" in str(a).lower() for a in assumptions):
            return "Regulated context but no legal constraints acknowledged"
    return None


def evaluate_answer_quality(
    answer: ContextAnswer,
    question: QuestionDefinition,
    context: ValidationContext,
) -> list[str]:
    flags: list[str] = []
    text = str(answer.value)
    lower = text.lower()

    if detect_vague_answer(text):
        flags.append(AnswerQualityFlag.vague.value)
        if "everyone" in lower or "all people" in lower:
            flags.append(AnswerQualityFlag.everyone_needs_this.value)
    if detect_inflated_answer(text):
        flags.append(AnswerQualityFlag.inflated.value)
    if detect_missing_specificity(text) and question.required:
        flags.append(AnswerQualityFlag.incomplete.value)
    if detect_unsupported_claim(text):
        flags.append(AnswerQualityFlag.unsupported_claim.value)
    if "no competitor" in lower:
        flags.append(AnswerQualityFlag.no_competitor_claim.value)
    if question.question_id in ("risk_legal_constraints", "industry_license") and any(
        re.search(p, lower) for p in NO_LEGAL_PATTERNS
    ):
        flags.append(AnswerQualityFlag.missing_legal_constraint.value)
    if question.tags and "timeline" in question.tags and re.search(r"\d+\s*days?", lower):
        days = int(re.search(r"(\d+)", lower).group(1))
        if days <= 14:
            flags.append(AnswerQualityFlag.unrealistic_timeline.value)
    if "budget" in question.tags or question.question_id == "basic_resources":
        m = re.search(r"\$?\s*(\d+)", lower)
        if m and int(m.group(1)) <= 500:
            flags.append(AnswerQualityFlag.unrealistic_budget.value)

    prev = {a.question_id: a.value for a in context.answers if a.question_id != answer.question_id}
    sg = context.structured_goal.model_dump() if context.structured_goal else None
    contradiction = detect_contradiction(text, prev, sg)
    if contradiction:
        flags.append(AnswerQualityFlag.contradictory.value)

    if not flags and len(text.strip()) > 15:
        flags.append(AnswerQualityFlag.acceptable.value)
    return list(dict.fromkeys(flags))


def evaluate_context_quality(context: ValidationContext) -> AnswerQualityReport:
    vague, inflated, contradictory, missing = [], [], [], []
    all_flags: list[str] = []
    clarifications: list[str] = []

    for answer in context.answers:
        flags = answer.quality_flags
        all_flags.extend(flags)
        if AnswerQualityFlag.vague.value in flags or AnswerQualityFlag.everyone_needs_this.value in flags:
            vague.append(answer.question_id)
        if AnswerQualityFlag.inflated.value in flags:
            inflated.append(answer.question_id)
        if AnswerQualityFlag.contradictory.value in flags:
            contradictory.append(answer.question_id)
        if AnswerQualityFlag.incomplete.value in flags:
            missing.append(answer.question_id)

    penalty = len(set(all_flags)) * 0.4
    bonus = sum(1 for f in all_flags if f == AnswerQualityFlag.acceptable.value) * 0.2
    score = round(max(0.0, min(10.0, 7.5 - penalty + bonus)), 1)

    if vague:
        clarifications.append("Define a specific customer segment instead of a universal audience.")
    if inflated:
        clarifications.append("Provide realistic scope, budget, and timeline assumptions.")
    if contradictory:
        clarifications.append("Resolve contradictions between evidence and demand claims.")

    from app.core.config import get_settings
    settings = get_settings()
    can_continue = score >= settings.context_min_quality_score and not contradictory

    return AnswerQualityReport(
        overall_quality_score=score,
        flags=list(dict.fromkeys(all_flags)),
        vague_answers=vague,
        contradictory_answers=contradictory,
        inflated_answers=inflated,
        missing_specificity=missing,
        required_clarifications=clarifications,
        can_continue=can_continue,
    )
