"""
MongoDB health check utility.
"""

from __future__ import annotations

import logging
from typing import Optional

from .client import ping_mongo, get_database

logger = logging.getLogger(__name__)


async def check_db_health() -> dict:
    """
    Run a MongoDB ping and return a health dict.
    Never raises — always returns a status dict.
    """
    try:
        db = get_database()
        is_up = await ping_mongo()
        return {
            "connected": is_up,
            "name": db.name if is_up else None,
            "error": None,
        }
    except RuntimeError as exc:
        return {"connected": False, "name": None, "error": str(exc)}
    except Exception as exc:
        logger.warning(f"DB health check failed: {exc}")
        return {"connected": False, "name": None, "error": "ping_failed"}
