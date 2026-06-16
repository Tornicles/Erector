"""
Bhudhi cost service — Prompt A5
Deterministic token/cost estimation utilities.
"""

from __future__ import annotations

from app.bhudhi.client import estimate_cost


def estimate_cost_usd(input_tokens: int, output_tokens: int, model: str) -> float:
    return estimate_cost(input_tokens, output_tokens, model)

