"""
Context Service — Prompt A4
Persistence helpers for validation contexts.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.errors import ContextNotFoundError, ValidationAccessDeniedAsNotFound, ValidationNotFoundError
from app.db.collections import VALIDATION_CONTEXTS, VALIDATION_SESSIONS
from app.models.auth import CurrentUser
from app.models.context import ValidationContext


def sanitize_text(value: str, max_length: int = 5000) -> str:
    """Remove control characters and enforce length."""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)
    return cleaned[:max_length].strip()


async def load_validation(db: AsyncIOMotorDatabase, validation_id: str, user: CurrentUser) -> dict:
    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        raise ValidationNotFoundError(validation_id)
    if doc["owner_user_id"] != user.user_id:
        if not (doc.get("team_id") and doc["team_id"] in user.team_ids):
            raise ValidationAccessDeniedAsNotFound(validation_id)
    doc.pop("_id", None)
    return doc


async def get_context_by_validation(
    db: AsyncIOMotorDatabase,
    validation_id: str,
) -> Optional[dict]:
    return await db[VALIDATION_CONTEXTS].find_one({"validation_id": validation_id})


async def save_context(db: AsyncIOMotorDatabase, context: ValidationContext) -> None:
    context.updated_at = datetime.now(timezone.utc)
    doc = context.model_dump(mode="json")
    await db[VALIDATION_CONTEXTS].update_one(
        {"context_id": context.context_id},
        {"$set": doc},
        upsert=True,
    )


def doc_to_context(doc: dict) -> ValidationContext:
    doc = dict(doc)
    doc.pop("_id", None)
    return ValidationContext(**doc)
