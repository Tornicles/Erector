"""
Seeder — Country Economy Mappings (Prompt A2)
Idempotent upsert of 138 country-to-economy mappings into MongoDB.
"""
from __future__ import annotations

import json
import logging
import pathlib
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.collections import COUNTRY_ECONOMY_MAPPINGS

logger = logging.getLogger(__name__)

_DATA_FILE = (
    pathlib.Path(__file__).parent.parent.parent.parent
    / "economy-data"
    / "country-economy-mappings.json"
)


def _load_json() -> list[dict]:
    if not _DATA_FILE.exists():
        raise FileNotFoundError(f"country-economy-mappings.json not found at {_DATA_FILE}")
    with open(_DATA_FILE) as f:
        return json.load(f)


async def seed_country_mappings(db: AsyncIOMotorDatabase) -> dict:
    """
    Idempotent upsert of country mappings into `country_economy_mappings`.
    Uses country_code (ISO alpha-2) as the upsert key.
    """
    raw = _load_json()
    upserted, skipped, errors = 0, 0, []
    now = datetime.now(timezone.utc)

    for doc in raw:
        country_code = doc.get("country_code")
        if not country_code:
            errors.append("Missing country_code in record")
            continue

        doc_to_save = {k: v for k, v in doc.items() if k != "created_at"}
        doc_to_save["updated_at"] = now

        try:
            result = await db[COUNTRY_ECONOMY_MAPPINGS].update_one(
                {"country_code": country_code},
                {"$set": doc_to_save, "$setOnInsert": {"created_at": now}},
                upsert=True,
            )
            if result.upserted_id:
                upserted += 1
            else:
                skipped += 1
        except Exception as exc:
            errors.append(f"{country_code}: {exc}")
            logger.warning(f"[SeedMappings] Failed to upsert {country_code}: {exc}")

    logger.info(
        f"[SeedMappings] Done — {upserted} inserted, {skipped} updated/skipped, {len(errors)} errors"
    )
    return {"upserted": upserted, "skipped": skipped, "errors": errors, "total": len(raw)}
