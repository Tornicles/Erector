"""
Seeder — Economies (Prompt A2)
Idempotent upsert of 30 economy profiles from economies.json into MongoDB.
"""
from __future__ import annotations

import json
import logging
import pathlib
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.collections import ECONOMIES

logger = logging.getLogger(__name__)

_DATA_FILE = pathlib.Path(__file__).parent.parent.parent.parent / "economy-data" / "economies.json"


def _load_json() -> list[dict]:
    if not _DATA_FILE.exists():
        raise FileNotFoundError(f"economies.json not found at {_DATA_FILE}")
    with open(_DATA_FILE) as f:
        return json.load(f)


async def seed_economies(db: AsyncIOMotorDatabase) -> dict:
    """
    Idempotent upsert of economies into the `economies` collection.
    Uses economy_id as the upsert key — safe to call on every startup.
    """
    raw = _load_json()
    upserted, skipped, errors = 0, 0, []
    now = datetime.now(timezone.utc)

    for doc in raw:
        economy_id = doc.get("economy_id")
        if not economy_id:
            errors.append("Missing economy_id in record")
            continue

        # Check DNA dimensions present
        dna = doc.get("civilization_dna", {})
        if len(dna) != 25:
            errors.append(f"{economy_id}: expected 25 DNA dims, got {len(dna)}")
            continue

        doc_to_save = {k: v for k, v in doc.items() if k != "created_at"}
        doc_to_save["updated_at"] = now

        try:
            result = await db[ECONOMIES].update_one(
                {"economy_id": economy_id},
                {"$set": doc_to_save, "$setOnInsert": {"created_at": now}},
                upsert=True,
            )
            if result.upserted_id:
                upserted += 1
            else:
                skipped += 1
        except Exception as exc:
            errors.append(f"{economy_id}: {exc}")
            logger.warning(f"[SeedEconomies] Failed to upsert {economy_id}: {exc}")

    logger.info(
        f"[SeedEconomies] Done — {upserted} inserted, {skipped} updated/skipped, {len(errors)} errors"
    )
    return {"upserted": upserted, "skipped": skipped, "errors": errors, "total": len(raw)}
