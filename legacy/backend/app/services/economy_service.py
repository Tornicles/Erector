"""
Economy Service (Prompt A2)
Retrieves economies from MongoDB. All logic is deterministic — no AI.
"""
from __future__ import annotations

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.collections import ECONOMIES
from app.models.economy import Economy, EconomySummary

logger = logging.getLogger(__name__)


def _get_top_dna_signals(civilization_dna: dict, n: int = 5) -> dict[str, int]:
    """Return the n most distinctive (highest) DNA dimensions."""
    sorted_dims = sorted(civilization_dna.items(), key=lambda x: x[1], reverse=True)
    return {k: v for k, v in sorted_dims[:n]}


def _economy_doc_to_summary(doc: dict) -> EconomySummary:
    """Convert a raw MongoDB document to EconomySummary."""
    dna = doc.get("civilization_dna", {})
    dna_vals = list(dna.values())
    dna_avg = round(sum(dna_vals) / len(dna_vals), 1) if dna_vals else 0.0

    resistance_names = [p["name"] for p in doc.get("resistance_patterns", [])[:3]]
    opportunity_names = [p["name"] for p in doc.get("opportunity_patterns", [])[:3]]

    return EconomySummary(
        economy_id=doc["economy_id"],
        economy_type=doc["economy_type"],
        display_name=doc.get("display_name", doc.get("name", "")),
        short_description=doc.get("short_description", ""),
        core_characteristic=doc.get("core_characteristic", ""),
        example_countries=doc.get("example_countries", []),
        top_dna_signals=_get_top_dna_signals(dna),
        primary_resistance_patterns=resistance_names,
        primary_opportunity_patterns=opportunity_names,
        dna_average=dna_avg,
    )


async def list_economies(
    db: AsyncIOMotorDatabase,
    skip: int = 0,
    limit: int = 50,
) -> tuple[list[EconomySummary], int]:
    """
    Return paginated list of economy summaries with total count.
    """
    total = await db[ECONOMIES].count_documents({})
    cursor = db[ECONOMIES].find({}, {"_id": 0}).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)
    summaries = [_economy_doc_to_summary(d) for d in docs]
    return summaries, total


async def get_economy_by_id(
    db: AsyncIOMotorDatabase,
    economy_id: str,
) -> Optional[Economy]:
    """Fetch a full economy profile by economy_id."""
    doc = await db[ECONOMIES].find_one({"economy_id": economy_id}, {"_id": 0})
    if not doc:
        return None
    try:
        return Economy(**doc)
    except Exception as exc:
        logger.warning(f"[EconomyService] Failed to parse economy {economy_id}: {exc}")
        return None


async def get_economy_summary_by_id(
    db: AsyncIOMotorDatabase,
    economy_id: str,
) -> Optional[EconomySummary]:
    """Fetch a lightweight economy summary by economy_id."""
    doc = await db[ECONOMIES].find_one({"economy_id": economy_id}, {"_id": 0})
    if not doc:
        return None
    return _economy_doc_to_summary(doc)


async def get_economies_by_ids(
    db: AsyncIOMotorDatabase,
    economy_ids: list[str],
) -> list[Economy]:
    """Fetch multiple full economy profiles by a list of economy_ids."""
    cursor = db[ECONOMIES].find({"economy_id": {"$in": economy_ids}}, {"_id": 0})
    docs = await cursor.to_list(length=len(economy_ids))
    result = []
    for doc in docs:
        try:
            result.append(Economy(**doc))
        except Exception as exc:
            logger.warning(f"[EconomyService] Parse error for {doc.get('economy_id')}: {exc}")
    return result


async def get_all_economies(db: AsyncIOMotorDatabase) -> list[Economy]:
    """Fetch all 30 economies as full Economy objects."""
    cursor = db[ECONOMIES].find({}, {"_id": 0})
    docs = await cursor.to_list(length=100)
    result = []
    for doc in docs:
        try:
            result.append(Economy(**doc))
        except Exception as exc:
            logger.warning(f"[EconomyService] Parse error: {exc}")
    return result
