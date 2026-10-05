"""
Token budget enforcement — Prompt A5
Provides best-effort estimates and budget checks.
"""

from __future__ import annotations

from datetime import date

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.core.errors import BhudhiBudgetExceededError
from app.db.collections import BHUDHI_USAGE_DAILY


def estimate_tokens(text_or_payload) -> int:
    # Very rough: ~4 chars/token
    s = str(text_or_payload)
    return max(1, int(len(s) / 4))


async def check_user_daily_budget(db: AsyncIOMotorDatabase, owner_user_id: str) -> None:
    settings = get_settings()
    today = date.today().isoformat()
    doc = await db[BHUDHI_USAGE_DAILY].find_one({"owner_user_id": owner_user_id, "date": today})
    used = int(doc.get("total_tokens", 0)) if doc else 0
    if used >= settings.bhudhi_per_user_daily_token_limit:
        raise BhudhiBudgetExceededError(
            "Per-user Bhudhi daily token limit exceeded.",
            details={"limit": settings.bhudhi_per_user_daily_token_limit, "used": used},
        )


async def check_validation_budget(db: AsyncIOMotorDatabase, validation_id: str) -> None:
    settings = get_settings()
    today = date.today().isoformat()
    doc = await db[BHUDHI_USAGE_DAILY].find_one({"validation_id": validation_id, "date": today})
    used = int(doc.get("total_tokens", 0)) if doc else 0
    if used >= settings.bhudhi_per_validation_token_limit:
        raise BhudhiBudgetExceededError(
            "Per-validation Bhudhi token limit exceeded.",
            details={"limit": settings.bhudhi_per_validation_token_limit, "used": used},
        )

