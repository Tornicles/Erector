"""
Goal Interpretation Service — Prompt A4
Deterministic rule-based goal parsing. A5 will swap in Bhudhi INTERPRET mode.
"""

from __future__ import annotations

import re
from typing import Optional

from app.core.config import get_settings
from app.models.context import StructuredGoal


EVERYONE_PATTERNS = [
    r"\beveryone\b", r"\ball people\b", r"\ball businesses\b", r"\bglobally\b",
    r"\bthe world\b", r"\bmillion users\b", r"\b1 million\b",
]
TIMELINE_PATTERNS = [
    (r"\b(\d+)\s*days?\b", "days"),
    (r"\b(\d+)\s*weeks?\b", "weeks"),
    (r"\b(\d+)\s*months?\b", "months"),
]
REGULATED_KEYWORDS = {
    "insurance": "insurance", "fintech": "fintech", "banking": "banking",
    "healthcare": "healthcare", "clinic": "healthcare", "medical": "healthcare",
    "legal": "legal", "crypto": "fintech",
}
REVENUE_KEYWORDS = ["saas", "subscription", "marketplace", "revenue", "monetize", "paid", "sell"]


def interpret_goal_deterministically(raw_goal: str) -> StructuredGoal:
    """
    Extract structured claims from raw goal using keyword heuristics.
    Extension point: replace with Bhudhi INTERPRET in A5.
    """
    settings = get_settings()
    goal = raw_goal.strip()
    if not goal:
        raise ValueError("raw_goal cannot be empty")
    if len(goal) > settings.context_max_answer_length * 2:
        goal = goal[: settings.context_max_answer_length * 2]

    lower = goal.lower()
    hidden_assumptions: list[str] = []
    contradictions: list[str] = []
    unclear_terms: list[str] = []

    problem_claim = _extract_problem(goal, lower)
    target_user = _extract_target_user(goal, lower)
    value_claim = _extract_value(goal, lower)
    change_claim = _extract_change(goal, lower)
    success_claim = _extract_success(goal, lower)
    revenue_claim = _extract_revenue(goal, lower)
    timing_claim = _extract_timing(goal, lower)
    resource_claim = _extract_resources(goal, lower)

    for pat in EVERYONE_PATTERNS:
        if re.search(pat, lower):
            unclear_terms.append("universal_audience")
            hidden_assumptions.append("Assumes broad universal demand without segment focus")
            if not target_user or "everyone" in (target_user or "").lower():
                target_user = "unclear — universal audience claimed"

    for industry_kw, industry in REGULATED_KEYWORDS.items():
        if industry_kw in lower:
            hidden_assumptions.append(f"Regulatory approval may be required for {industry}")
            hidden_assumptions.append(f"Target users in regulated {industry} context may have affordability constraints")

    if timing_claim and _is_aggressive_timeline(timing_claim, lower):
        hidden_assumptions.append("Aggressive timeline may underestimate legal, technical, or distribution work")

    if "insurance" in lower and "gig" in lower:
        problem_claim = problem_claim or "Gig workers lack accessible insurance coverage"
        target_user = target_user or "Gig workers"
        hidden_assumptions.extend([
            "Gig workers want insurance products",
            "They can afford premiums",
            "Insurance regulation allows this product",
            "Distribution can reach gig workers",
            "Payment rails support recurring premiums",
        ])

    if "saas" in lower or "software" in lower:
        if "clinic" in lower or "healthcare" in lower:
            target_user = target_user or "Healthcare clinics (likely small practices)"
            hidden_assumptions.append("Clinics have budget and willingness to adopt new software")

    clarity = _compute_clarity(
        problem_claim, target_user, value_claim, success_claim, unclear_terms
    )
    confidence = min(0.9, 0.3 + clarity / 15.0)

    return StructuredGoal(
        problem_claim=problem_claim,
        target_user=target_user,
        value_claim=value_claim,
        change_claim=change_claim,
        success_claim=success_claim,
        revenue_claim=revenue_claim,
        timing_claim=timing_claim,
        resource_claim=resource_claim,
        contradictions=contradictions,
        hidden_assumptions=list(dict.fromkeys(hidden_assumptions)),
        unclear_terms=unclear_terms,
        clarity_score=clarity,
        interpretation_confidence=confidence,
        source="deterministic",
    )


def _extract_problem(goal: str, lower: str) -> Optional[str]:
    m = re.search(r"(?:solve|help|address|fix)\s+(.{10,120}?)(?:\.|,|for|by)", lower)
    if m:
        return m.group(1).strip()
    if "problem" in lower:
        return goal[:200]
    return None


def _extract_target_user(goal: str, lower: str) -> Optional[str]:
    for pat in [r"for\s+(.{5,80}?)(?:\.|,|in|who)", r"target(?:ing)?\s+(.{5,80}?)(?:\.|,|in)"]:
        m = re.search(pat, lower)
        if m:
            return m.group(1).strip()
    return None


def _extract_value(goal: str, lower: str) -> Optional[str]:
    if "help" in lower:
        m = re.search(r"help\s+(.{5,80}?)(?:\.|,|by)", lower)
        if m:
            return f"Help {m.group(1).strip()}"
    return None


def _extract_change(goal: str, lower: str) -> Optional[str]:
    if "launch" in lower or "build" in lower:
        return f"Create and launch: {goal[:120]}"
    return None


def _extract_success(goal: str, lower: str) -> Optional[str]:
    m = re.search(r"(\d+[\d,]*)\s+(users|customers|clinics|paying)", lower)
    if m:
        return f"Reach {m.group(1)} {m.group(2)}"
    return None


def _extract_revenue(goal: str, lower: str) -> Optional[str]:
    if any(k in lower for k in REVENUE_KEYWORDS):
        return "Revenue-generating venture implied"
    return None


def _extract_timing(goal: str, lower: str) -> Optional[str]:
    for pat, unit in TIMELINE_PATTERNS:
        m = re.search(pat, lower)
        if m:
            return f"{m.group(1)} {unit}"
    if "fast" in lower or "quickly" in lower:
        return "fast launch implied"
    return None


def _extract_resources(goal: str, lower: str) -> Optional[str]:
    m = re.search(r"\$[\d,]+", goal)
    if m:
        return m.group(0)
    return None


def _is_aggressive_timeline(timing: str, lower: str) -> bool:
    m = re.search(r"(\d+)\s*days?", timing.lower())
    if m and int(m.group(1)) <= 30:
        return True
    if "globally" in lower and m and int(m.group(1)) <= 90:
        return True
    return False


def _compute_clarity(
    problem: Optional[str],
    target: Optional[str],
    value: Optional[str],
    success: Optional[str],
    unclear: list[str],
) -> float:
    score = 5.0
    if problem:
        score += 1.5
    if target and "unclear" not in (target or "").lower() and "everyone" not in (target or "").lower():
        score += 2.0
    elif not target:
        score -= 2.0
    if value:
        score += 0.5
    if success:
        score += 1.0
    score -= len(unclear) * 1.5
    return round(max(0.0, min(10.0, score)), 1)
