"""
Validation Health Monitor Worker — Prompt A3
Periodic stuck-validation detection (async worker-ready).
"""

from __future__ import annotations

import asyncio
import logging

from app.core.config import get_settings
from app.db.client import get_database
from app.services.validation_health_service import find_stuck_validations, flag_stuck_validation

logger = logging.getLogger(__name__)


async def run_validation_health_check_once() -> dict:
    """Run a single health check pass and flag stuck validations."""
    db = get_database()
    stuck = await find_stuck_validations(db, idle_minutes=5)
    flagged = 0
    for item in stuck:
        reason = item.get("health", {}).get("stuck_reason", "Idle beyond threshold")
        await flag_stuck_validation(db, item["validation_id"], reason)
        flagged += 1
    logger.info("Validation health check: %d stuck, %d flagged", len(stuck), flagged)
    return {"checked": len(stuck), "flagged": flagged}


async def run_validation_health_monitor_loop(interval_seconds: int = 60) -> None:
    """Background loop for stuck validation monitoring."""
    settings = get_settings()
    interval = interval_seconds or settings.validation_health_monitor_interval_seconds
    while True:
        try:
            if settings.validation_health_monitor_enabled:
                await run_validation_health_check_once()
        except Exception as exc:
            logger.exception("Validation health monitor error: %s", exc)
        await asyncio.sleep(interval)
