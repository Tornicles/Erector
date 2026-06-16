"""
Async Motor MongoDB client management.
Single global client instance — never create per-request.
"""

from __future__ import annotations

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None


async def connect_to_mongo(uri: str, db_name: str, timeout_ms: int = 5000) -> None:
    """Create the Motor client and verify connectivity."""
    global _client, _db
    _client = AsyncIOMotorClient(
        uri,
        connectTimeoutMS=timeout_ms,
        serverSelectionTimeoutMS=timeout_ms,
    )
    _db = _client[db_name]
    # Verify connection
    await _db.command("ping")
    logger.info(f"MongoDB connected: {db_name}")


async def close_mongo_connection() -> None:
    """Gracefully close the Motor client."""
    global _client, _db
    if _client:
        _client.close()
        _client = None
        _db = None
        logger.info("MongoDB connection closed.")


def get_database() -> AsyncIOMotorDatabase:
    """Return the active database instance. Raises if not connected."""
    if _db is None:
        raise RuntimeError("MongoDB not connected. Call connect_to_mongo() first.")
    return _db


def get_collection(name: str):
    """Return a named collection from the active database."""
    return get_database()[name]


async def ping_mongo() -> bool:
    """Return True if MongoDB responds to ping, False otherwise."""
    try:
        db = get_database()
        result = await db.command("ping")
        return result.get("ok") == 1
    except Exception as exc:
        logger.warning(f"MongoDB ping failed: {exc}")
        return False
