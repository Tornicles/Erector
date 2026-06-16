"""
MongoDB Migration Registry.
Tracks schema migrations and provides migration scaffolding.
"""

from datetime import datetime, timezone
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorDatabase


MIGRATIONS: list[dict] = [
    {
        "version": "1.0.0",
        "description": "Initial schema — all collections and indexes created",
        "created_at": "2025-01-01T00:00:00Z",
        "applied": False,
    },
]

MIGRATIONS_COLLECTION = "erector_migrations"


async def get_applied_migrations(db: AsyncIOMotorDatabase) -> list[str]:
    """Return list of applied migration versions."""
    cursor = db[MIGRATIONS_COLLECTION].find({"applied": True})
    docs = await cursor.to_list(length=None)
    return [d["version"] for d in docs]


async def apply_migration(db: AsyncIOMotorDatabase, version: str) -> bool:
    """Mark a migration as applied."""
    result = await db[MIGRATIONS_COLLECTION].update_one(
        {"version": version},
        {
            "$set": {
                "applied": True,
                "applied_at": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )
    return result.modified_count > 0 or result.upserted_id is not None


async def run_migrations(db: AsyncIOMotorDatabase) -> dict:
    """
    Run all pending migrations.
    Returns summary of applied migrations.
    """
    applied = await get_applied_migrations(db)
    results = {"applied": [], "skipped": [], "errors": []}

    for migration in MIGRATIONS:
        version = migration["version"]
        if version in applied:
            results["skipped"].append(version)
            continue
        try:
            success = await apply_migration(db, version)
            if success:
                results["applied"].append(version)
        except Exception as e:
            results["errors"].append(f"{version}: {str(e)}")

    return results
