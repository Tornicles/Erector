"""
Bhudhi logging service — Prompt A5
Writes bhudhi_logs records without storing raw sensitive IO (hashes only).
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.collections import BHUDHI_LOGS, BHUDHI_USAGE_DAILY
from app.models.bhudhi import BhudhiLog, BhudhiTrigger


def _hash_output(output: Optional[dict]) -> Optional[str]:
    if output is None:
        return None
    canonical = json.dumps(output, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def write_bhudhi_log(
    *,
    db: AsyncIOMotorDatabase,
    trigger: BhudhiTrigger,
    contract,
    model: str,
    input_hash: str,
    output_hash: Optional[str],
    status: str,
    rejected_reason: Optional[str],
    fallback_used: bool,
    fallback_reason: Optional[str],
    prompt_injection_flags: list[dict],
    authority_flags: list[dict],
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    estimated_cost: float,
    latency_ms: int,
) -> str:
    log = BhudhiLog(
        validation_id=trigger.validation_id,
        owner_user_id=trigger.owner_user_id,
        team_id=trigger.team_id,
        trigger_type=trigger.trigger_type.value,
        mode=trigger.mode.value,
        prompt_contract=contract.contract_id,
        model=model,
        input_hash=input_hash,
        output_hash=output_hash,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        estimated_cost=estimated_cost,
        status=status,
        rejected_reason=rejected_reason,
        fallback_used=fallback_used,
        fallback_reason=fallback_reason,
        prompt_injection_flags=prompt_injection_flags,
        authority_flags=authority_flags,
        latency_ms=latency_ms,
        metadata=trigger.metadata or {},
    )
    await db[BHUDHI_LOGS].insert_one(log.model_dump(mode="json"))

    # Update usage daily (per owner and per validation)
    today = date.today().isoformat()
    if trigger.owner_user_id:
        await db[BHUDHI_USAGE_DAILY].update_one(
            {"owner_user_id": trigger.owner_user_id, "date": today},
            {
                "$inc": {
                    "total_calls": 1,
                    "total_input_tokens": input_tokens,
                    "total_output_tokens": output_tokens,
                    "total_tokens": total_tokens,
                    "estimated_cost": estimated_cost,
                    "fallback_calls": 1 if fallback_used else 0,
                    "rejected_calls": 1 if status == "rejected" else 0,
                    "failed_calls": 1 if status == "failed" else 0,
                    "successful_calls": 1 if status == "completed" else 0,
                },
                "$setOnInsert": {"owner_user_id": trigger.owner_user_id, "date": today},
            },
            upsert=True,
        )

    if trigger.validation_id:
        await db[BHUDHI_USAGE_DAILY].update_one(
            {"validation_id": trigger.validation_id, "date": today},
            {
                "$inc": {"total_tokens": total_tokens, "estimated_cost": estimated_cost},
                "$setOnInsert": {"validation_id": trigger.validation_id, "date": today},
            },
            upsert=True,
        )

    return log.bhudhi_log_id


async def list_bhudhi_logs_for_validation(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    owner_user_id: str,
    limit: int = 50,
) -> list[dict]:
    cursor = (
        db[BHUDHI_LOGS]
        .find({"validation_id": validation_id, "owner_user_id": owner_user_id})
        .sort("created_at", -1)
        .limit(limit)
    )
    items = await cursor.to_list(length=limit)
    for i in items:
        i.pop("_id", None)
    return items


async def get_usage_summary(db: AsyncIOMotorDatabase, owner_user_id: str) -> dict:
    today = date.today().isoformat()
    doc = await db[BHUDHI_USAGE_DAILY].find_one({"owner_user_id": owner_user_id, "date": today})
    doc = doc or {"owner_user_id": owner_user_id, "date": today}
    doc.pop("_id", None)
    return doc

