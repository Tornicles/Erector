"""
Audit Service — Prompt A3
Immutable audit trail for lifecycle operations.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.collections import AUDIT_LOGS
from app.models.audit import AuditLog, new_audit_id

logger = logging.getLogger(__name__)


async def write_audit_log(
    db: AsyncIOMotorDatabase,
    action: str,
    entity_type: str,
    entity_id: str,
    actor_user_id: str,
    owner_user_id: Optional[str] = None,
    team_id: Optional[str] = None,
    old_value: Optional[Any] = None,
    new_value: Optional[Any] = None,
    ip_hash: Optional[str] = None,
    user_agent: Optional[str] = None,
    request_id: Optional[str] = None,
) -> str:
    """Write an immutable audit log entry. Returns audit_id."""
    entry = AuditLog(
        audit_id=new_audit_id(),
        owner_user_id=owner_user_id,
        actor_user_id=actor_user_id,
        team_id=team_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        ip_hash=ip_hash,
        user_agent=user_agent,
        request_id=request_id,
    )
    doc = entry.model_dump(mode="json")
    try:
        await db[AUDIT_LOGS].insert_one(doc)
    except Exception as exc:
        logger.error("Failed to write audit log for %s/%s: %s", entity_type, entity_id, exc)
    return entry.audit_id


async def get_audit_logs_for_entity(
    db: AsyncIOMotorDatabase,
    entity_type: str,
    entity_id: str,
    limit: int = 50,
) -> list[dict]:
    """Retrieve audit logs for an entity."""
    cursor = (
        db[AUDIT_LOGS]
        .find({"entity_type": entity_type, "entity_id": entity_id})
        .sort("created_at", -1)
        .limit(limit)
    )
    return await cursor.to_list(length=limit)
