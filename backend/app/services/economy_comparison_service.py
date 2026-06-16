"""
Economy Comparison Service (Prompt A2)
Compares economies deterministically using Civilization DNA dimensions.
No AI. All scoring is heuristic and formula-driven.
"""
from __future__ import annotations

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.collections import ECONOMIES
from app.models.economy import (
    Economy,
    EconomyCompareRequest,
    EconomyCompareResponse,
    EconomyComparisonResult,
)
from app.services.economic_stack_service import _compute_multipliers

logger = logging.getLogger(__name__)

# ── Dimension scoring formulas ─────────────────────────────────────────────────
# Each formula maps a raw DNA dict to a 0-100 score for that dimension.
# Higher score = better fit for that dimension.

def _score_market_fit(dna: dict) -> float:
    return round((dna.get("innovation_index", 50) + dna.get("digital_adoption_index", 50)) / 2.0, 1)

def _score_trust_fit(dna: dict) -> float:
    return round(
        (dna.get("trust_index", 50) + dna.get("institutional_strength_index", 50) +
         dna.get("legal_predictability_index", 50)) / 3.0, 1
    )

def _score_payment_fit(dna: dict) -> float:
    return round(float(dna.get("payment_reliability_index", 50)), 1)

def _score_infrastructure_fit(dna: dict) -> float:
    return round(float(dna.get("infrastructure_reliability_index", 50)), 1)

def _score_regulatory_fit(dna: dict) -> float:
    # Invert: high corruption/bureaucracy = low regulatory fit
    raw = (100 - dna.get("corruption_index", 50) + 100 - dna.get("bureaucracy_index", 50)) / 2.0
    return round(raw, 1)

def _score_adoption_fit(dna: dict) -> float:
    return round(100 - float(dna.get("adoption_friction_index", 50)), 1)

def _score_execution_fit(dna: dict) -> float:
    return round(
        (dna.get("stability_index", 50) + dna.get("labor_reliability_index", 50)) / 2.0, 1
    )

def _score_narrative_fit(dna: dict) -> float:
    return round(
        (dna.get("information_freedom_index", 50) + (100 - dna.get("media_volatility_index", 50))) / 2.0, 1
    )

def _score_platform_fit(dna: dict) -> float:
    return round(float(dna.get("digital_adoption_index", 50)), 1)

def _score_talent_fit(dna: dict) -> float:
    return round(
        (dna.get("education_index", 50) + dna.get("labor_reliability_index", 50)) / 2.0, 1
    )

def _score_risk_fit(dna: dict) -> float:
    return round(
        (100 - dna.get("crisis_exposure_index", 50) + 100 - dna.get("crime_pressure_index", 50)) / 2.0, 1
    )

def _score_opportunity_fit(dna: dict) -> float:
    return round(
        (dna.get("innovation_index", 50) + dna.get("future_change_velocity_index", 50)) / 2.0, 1
    )


_DIMENSION_SCORERS = {
    "market_fit": _score_market_fit,
    "trust_fit": _score_trust_fit,
    "payment_fit": _score_payment_fit,
    "infrastructure_fit": _score_infrastructure_fit,
    "regulatory_fit": _score_regulatory_fit,
    "adoption_fit": _score_adoption_fit,
    "execution_fit": _score_execution_fit,
    "narrative_fit": _score_narrative_fit,
    "platform_fit": _score_platform_fit,
    "talent_fit": _score_talent_fit,
    "risk_fit": _score_risk_fit,
    "opportunity_fit": _score_opportunity_fit,
}

# Weights for overall fit_score (must sum to ~1.0)
_DIMENSION_WEIGHTS = {
    "market_fit": 0.12,
    "trust_fit": 0.10,
    "payment_fit": 0.10,
    "infrastructure_fit": 0.08,
    "regulatory_fit": 0.10,
    "adoption_fit": 0.10,
    "execution_fit": 0.10,
    "narrative_fit": 0.08,
    "platform_fit": 0.08,
    "talent_fit": 0.08,
    "risk_fit": 0.08,
    "opportunity_fit": 0.08,
}


def _compute_fit_score(dimension_scores: dict[str, float]) -> float:
    total = sum(
        dimension_scores.get(dim, 50.0) * weight
        for dim, weight in _DIMENSION_WEIGHTS.items()
    )
    return round(total, 1)


def _extract_advantages(economy: Economy, dimension_scores: dict[str, float]) -> list[str]:
    """Top 3 dimensions where this economy scores above 70."""
    high_dims = [(dim, score) for dim, score in dimension_scores.items() if score >= 70]
    high_dims.sort(key=lambda x: x[1], reverse=True)
    advantages = []
    for dim, score in high_dims[:3]:
        advantages.append(f"Strong {dim.replace('_', ' ')}: {score:.0f}/100")
    # Add top opportunity patterns
    for pattern in economy.opportunity_patterns[:2]:
        advantages.append(pattern.name)
    return advantages[:5]


def _extract_disadvantages(economy: Economy, dimension_scores: dict[str, float]) -> list[str]:
    """Dimensions where this economy scores below 40."""
    low_dims = [(dim, score) for dim, score in dimension_scores.items() if score < 40]
    low_dims.sort(key=lambda x: x[1])
    disadvantages = []
    for dim, score in low_dims[:3]:
        disadvantages.append(f"Weak {dim.replace('_', ' ')}: {score:.0f}/100")
    # Add top resistance patterns
    for pattern in economy.resistance_patterns[:2]:
        disadvantages.append(pattern.name)
    return disadvantages[:5]


def _build_comparison_result(economy: Economy) -> EconomyComparisonResult:
    """Build a complete comparison result for one economy."""
    dna = economy.civilization_dna.model_dump()
    dimension_scores = {
        dim: scorer(dna) for dim, scorer in _DIMENSION_SCORERS.items()
    }
    fit_score = _compute_fit_score(dimension_scores)
    multipliers = _compute_multipliers(dna)

    risks = [p.name for p in economy.common_failure_modes[:3]]
    opportunities = [p.name for p in economy.opportunity_patterns[:3]]
    entry_strategy = (
        economy.recommended_entry_strategies[0].description
        if economy.recommended_entry_strategies
        else f"Standard entry into {economy.display_name}."
    )

    return EconomyComparisonResult(
        economy_id=economy.economy_id,
        economy_type=economy.economy_type,
        display_name=economy.display_name,
        fit_score=fit_score,
        dimension_scores=dimension_scores,
        advantages=_extract_advantages(economy, dimension_scores),
        disadvantages=_extract_disadvantages(economy, dimension_scores),
        major_risks=risks,
        major_opportunities=opportunities,
        recommended_entry_strategy=entry_strategy,
        difficulty_multiplier=multipliers.composite,
    )


async def compare_economies(
    db: AsyncIOMotorDatabase,
    request: EconomyCompareRequest,
) -> EconomyCompareResponse:
    """
    Compare economies and return ranked results.
    If request.economies_to_compare is empty, compares all 30.
    """
    if request.economies_to_compare:
        cursor = db[ECONOMIES].find(
            {"economy_id": {"$in": request.economies_to_compare}}, {"_id": 0}
        )
    else:
        cursor = db[ECONOMIES].find({}, {"_id": 0})

    docs = await cursor.to_list(length=30)
    economies = []
    for doc in docs:
        try:
            economies.append(Economy(**doc))
        except Exception as exc:
            logger.warning(f"[ComparisonService] Parse error: {exc}")

    if not economies:
        return EconomyCompareResponse(
            goal_summary=request.goal_summary,
            ranked_results=[],
            best_fit_economy_id="",
            worst_fit_economy_id="",
            comparison_notes="No economies found to compare.",
        )

    results = [_build_comparison_result(eco) for eco in economies]
    results.sort(key=lambda r: r.fit_score, reverse=True)

    best = results[0].economy_id
    worst = results[-1].economy_id

    notes = (
        f"Compared {len(results)} economies for: {request.goal_summary}. "
        f"Best fit: {results[0].display_name} (score={results[0].fit_score}). "
        f"Worst fit: {results[-1].display_name} (score={results[-1].fit_score})."
    )

    return EconomyCompareResponse(
        goal_summary=request.goal_summary,
        ranked_results=results,
        best_fit_economy_id=best,
        worst_fit_economy_id=worst,
        comparison_notes=notes,
    )
