"""
Economic Stack Service (Prompt A2)
Builds the 6-layer Economic Stack from country inputs.
All multiplier calculations are deterministic — no AI.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.base import new_id
from app.models.economy import (
    DifficultyMultipliers,
    EconomicStack,
    EconomicStackBuildRequest,
    EconomicStackLayer,
)
from app.models.enums import EconomicStackLayerType
from app.services.economy_resolution_service import resolve_country

logger = logging.getLogger(__name__)


def _compute_multipliers(dna: dict) -> DifficultyMultipliers:
    """
    Compute deterministic difficulty multipliers from a Civilization DNA dict.
    All inputs are 0-100 integers. Output range: 0.5–1.5.

    Convention:
    - For "favorable when HIGH" dims (e.g. trust), difficulty = 0.5 + (100 - score) / 100
    - For "adverse when HIGH" dims (e.g. corruption), difficulty = 0.5 + score / 100
    - Composite dims average multiple inputs.
    """
    def inv(val: float) -> float:
        """Unfavorable direction: high score → hard."""
        return round(0.5 + min(max(val, 0), 100) / 100.0, 3)

    def fav(val: float) -> float:
        """Favorable direction: high score → easy."""
        return round(0.5 + (100 - min(max(val, 0), 100)) / 100.0, 3)

    def avg_fav(*vals: float) -> float:
        return round(0.5 + (100 - sum(vals) / len(vals)) / 100.0, 3)

    def avg_inv(*vals: float) -> float:
        return round(0.5 + (sum(vals) / len(vals)) / 100.0, 3)

    return DifficultyMultipliers(
        execution_difficulty=avg_fav(
            dna.get("stability_index", 50),
            dna.get("infrastructure_reliability_index", 50),
            dna.get("labor_reliability_index", 50),
        ),
        trust_difficulty=avg_fav(
            dna.get("trust_index", 50),
            dna.get("institutional_strength_index", 50),
            dna.get("legal_predictability_index", 50),
        ),
        payment_difficulty=fav(dna.get("payment_reliability_index", 50)),
        infrastructure_difficulty=fav(dna.get("infrastructure_reliability_index", 50)),
        regulatory_difficulty=avg_inv(
            dna.get("bureaucracy_index", 50),
            dna.get("corruption_index", 50),
        ),
        narrative_volatility=avg_inv(
            dna.get("media_volatility_index", 50),
            dna.get("reputation_fragility_index", 50),
        ),
        adoption_friction=inv(dna.get("adoption_friction_index", 50)),
        crisis_exposure=inv(dna.get("crisis_exposure_index", 50)),
        talent_reliability=fav(dna.get("labor_reliability_index", 50)),
    )


async def _resolve_to_layer(
    db: AsyncIOMotorDatabase,
    country_input: str,
    layer_type: EconomicStackLayerType,
    layer_reason: str,
) -> Optional[EconomicStackLayer]:
    """Resolve a country to an EconomicStackLayer."""
    if not country_input:
        return None

    resolved = await resolve_country(db, country_input)
    if not resolved:
        logger.info(f"[StackService] Could not resolve {country_input!r} for layer {layer_type}")
        return None

    # Fetch full DNA for this layer
    from app.db.collections import ECONOMIES
    eco_doc = await db[ECONOMIES].find_one(
        {"economy_id": resolved.primary_economy.economy_id}, {"_id": 0}
    )
    dna_dict = eco_doc.get("civilization_dna", {}) if eco_doc else {}
    multipliers = _compute_multipliers(dna_dict)

    # Build dna_snapshot from dict
    from models.economy import CivilizationDnaProfile
    try:
        dna_snapshot = CivilizationDnaProfile(**dna_dict) if dna_dict else None
    except Exception:
        dna_snapshot = None

    return EconomicStackLayer(
        layer_type=layer_type,
        economy_id=resolved.primary_economy.economy_id,
        economy_type=resolved.primary_economy.economy_type,
        country=resolved.country_name,
        country_code=resolved.country_code,
        layer_reason=layer_reason,
        confidence=resolved.confidence,
        dna_snapshot=dna_snapshot,
        difficulty_multiplier=multipliers.composite,
        notes=resolved.reasoning,
    )


def _stack_confidence(layers: list[Optional[EconomicStackLayer]]) -> float:
    """Average confidence of non-null layers."""
    valid = [la.confidence for la in layers if la is not None]
    if not valid:
        return 0.5
    return round(sum(valid) / len(valid), 3)


async def build_economic_stack(
    db: AsyncIOMotorDatabase,
    request: EconomicStackBuildRequest,
) -> EconomicStack:
    """
    Build a 6-layer Economic Stack from a build request.
    Each layer is resolved independently using deterministic country → economy mapping.
    """
    now = datetime.now(timezone.utc)

    # Resolve all 6 layers
    founder_layer = await _resolve_to_layer(
        db, request.founder_country,
        EconomicStackLayerType.founder_economy,
        "Country where the founding team operates and makes primary decisions.",
    )

    customer_layer = await _resolve_to_layer(
        db, request.customer_country,
        EconomicStackLayerType.customer_economy,
        "Country/region where the target customer base resides.",
    )

    revenue_country = request.revenue_country or request.customer_country
    revenue_layer = await _resolve_to_layer(
        db, revenue_country,
        EconomicStackLayerType.revenue_economy,
        "Country where revenue transactions are executed.",
    ) if revenue_country else None

    platform_layer = await _resolve_to_layer(
        db, request.platform or "United States",  # platform infra defaults to US
        EconomicStackLayerType.platform_economy,
        "Economy governing the platform/infrastructure layer (app stores, cloud, payments).",
    ) if request.platform else await _resolve_to_layer(
        db, "United States",
        EconomicStackLayerType.platform_economy,
        "Default platform economy — US (Apple App Store, Google Play, AWS).",
    )

    # Talent economy: first team location or founder country
    talent_country = (
        request.team_locations[0] if request.team_locations else request.founder_country
    )
    talent_layer = await _resolve_to_layer(
        db, talent_country,
        EconomicStackLayerType.talent_economy,
        "Economy governing where the primary talent pool is hired.",
    )

    regulatory_country = request.regulatory_country or request.founder_country
    regulatory_layer = await _resolve_to_layer(
        db, regulatory_country,
        EconomicStackLayerType.regulatory_economy,
        "Economy where the business is legally incorporated and primarily regulated.",
    )

    layers_list = [
        founder_layer, customer_layer, revenue_layer,
        platform_layer, talent_layer, regulatory_layer,
    ]

    # Primary economy = customer economy (where market validation happens)
    primary = customer_layer or founder_layer

    # Build composite difficulty multipliers from all non-null layers
    all_dna: dict[str, float] = {}
    layer_dnas = [la.dna_snapshot for la in layers_list if la and la.dna_snapshot]
    if layer_dnas:
        # Use only the 25 integer DNA dimensions (not BaseSchema metadata fields)
        from app.models.enums import CivilizationDnaDimension
        dna_keys = [dim.value for dim in CivilizationDnaDimension]
        for k in dna_keys:
            vals = [getattr(ld, k) for ld in layer_dnas if hasattr(ld, k)]
            if vals:
                all_dna[k] = round(sum(v for v in vals if isinstance(v, (int, float))) / len(vals), 1)
    composite_multipliers = _compute_multipliers(all_dna) if all_dna else _compute_multipliers(
        {k: 50 for k in ["stability_index", "trust_index", "payment_reliability_index",
                          "infrastructure_reliability_index", "bureaucracy_index",
                          "corruption_index", "media_volatility_index", "reputation_fragility_index",
                          "adoption_friction_index", "crisis_exposure_index", "labor_reliability_index",
                          "institutional_strength_index", "legal_predictability_index"]}
    )

    return EconomicStack(
        stack_id=new_id(),
        validation_id=request.validation_id,
        founder_economy=founder_layer,
        customer_economy=customer_layer,
        revenue_economy=revenue_layer,
        platform_economy=platform_layer,
        talent_economy=talent_layer,
        regulatory_economy=regulatory_layer,
        primary_economy=primary,
        secondary_economies=[la for la in layers_list if la and la != primary],
        stack_confidence=_stack_confidence(layers_list),
        difficulty_multipliers=composite_multipliers,
        resolved_from={
            "founder_country": request.founder_country,
            "customer_country": request.customer_country,
            "revenue_country": request.revenue_country,
            "platform": request.platform,
            "team_locations": request.team_locations,
            "regulatory_country": request.regulatory_country,
        },
        created_at=now,
        updated_at=now,
    )
