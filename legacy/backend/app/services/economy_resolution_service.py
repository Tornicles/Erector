"""
Economy Resolution Service (Prompt A2)
Resolves a country name/code to its primary and secondary economy types.
All resolution logic is deterministic — no AI.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.collections import COUNTRY_ECONOMY_MAPPINGS, ECONOMIES
from app.models.economy import EconomyResolveResponse, EconomySummary
from app.services.economy_service import _economy_doc_to_summary, get_economy_summary_by_id

logger = logging.getLogger(__name__)


def _normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


async def _find_mapping(db: AsyncIOMotorDatabase, country_input: str) -> Optional[dict]:
    """
    Look up a country mapping by:
    1. Exact country_code match (ISO alpha-2 or alpha-3)
    2. Exact country_name match (case-insensitive)
    3. Aliases match
    4. Partial text match on country_name
    """
    norm = _normalize(country_input)
    upper = country_input.strip().upper()

    # 1. ISO alpha-2 code (2 chars)
    if len(upper) == 2:
        doc = await db[COUNTRY_ECONOMY_MAPPINGS].find_one(
            {"country_code": upper}, {"_id": 0}
        )
        if doc:
            return doc

    # 2. ISO alpha-3 code (3 chars)
    if len(upper) == 3:
        doc = await db[COUNTRY_ECONOMY_MAPPINGS].find_one(
            {"country_code_alpha3": upper}, {"_id": 0}
        )
        if doc:
            return doc

    # 3. Case-insensitive name match
    doc = await db[COUNTRY_ECONOMY_MAPPINGS].find_one(
        {"country_name": {"$regex": f"^{re.escape(country_input.strip())}$", "$options": "i"}},
        {"_id": 0},
    )
    if doc:
        return doc

    # 4. Aliases match
    doc = await db[COUNTRY_ECONOMY_MAPPINGS].find_one(
        {"aliases": {"$regex": f"^{re.escape(country_input.strip())}$", "$options": "i"}},
        {"_id": 0},
    )
    if doc:
        return doc

    # 5. Partial text match on country_name
    doc = await db[COUNTRY_ECONOMY_MAPPINGS].find_one(
        {"country_name": {"$regex": re.escape(norm), "$options": "i"}},
        {"_id": 0},
    )
    return doc


async def resolve_country(
    db: AsyncIOMotorDatabase,
    country_input: str,
) -> Optional[EconomyResolveResponse]:
    """
    Resolve a country input (name or ISO code) to its primary and secondary economies.
    Returns None if the country cannot be matched.
    """
    mapping = await _find_mapping(db, country_input)
    if not mapping:
        logger.info(f"[Resolution] No mapping found for: {country_input!r}")
        return None

    primary_eco_id = mapping.get("primary_economy_id")
    primary_doc = await db[ECONOMIES].find_one({"economy_id": primary_eco_id}, {"_id": 0})
    if not primary_doc:
        logger.warning(f"[Resolution] Primary economy not found: {primary_eco_id}")
        return None

    primary_summary = _economy_doc_to_summary(primary_doc)

    # Secondary economies
    secondary_summaries: list[EconomySummary] = []
    for sec_id in mapping.get("secondary_economy_ids", []):
        sec_doc = await db[ECONOMIES].find_one({"economy_id": sec_id}, {"_id": 0})
        if sec_doc:
            secondary_summaries.append(_economy_doc_to_summary(sec_doc))

    confidence = float(mapping.get("confidence", 0.8))

    # Build deterministic reasoning string from DNA top signals
    dna = primary_doc.get("civilization_dna", {})
    top_dims = sorted(dna.items(), key=lambda x: x[1], reverse=True)[:3]
    top_str = ", ".join(f"{k}={v}" for k, v in top_dims)
    reasoning = (
        f"{mapping['country_name']} maps to {primary_doc.get('display_name', primary_eco_id)} "
        f"(confidence={confidence}). "
        f"Top DNA signals: {top_str}. "
        f"{mapping.get('notes', '')}"
    )

    return EconomyResolveResponse(
        country_name=mapping["country_name"],
        country_code=mapping["country_code"],
        primary_economy=primary_summary,
        secondary_economies=secondary_summaries,
        confidence=confidence,
        reasoning=reasoning,
    )
