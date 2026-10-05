"""
Live feed service — Prompt A6
Creates live events, allocates sequence numbers, and provides snapshot/replay.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.errors import ValidationAccessDeniedAsNotFound, ValidationNotFoundError
from app.db.collections import VALIDATION_LIVE_EVENTS, VALIDATION_LIVE_SEQUENCES, VALIDATION_SESSIONS
from app.models.auth import CurrentUser
from app.models.live_feed import EngineLiveFeedItem, LiveFeedEvent, LiveFeedProgress, ValidationLiveSnapshot
from app.services.context_service import load_validation
from models.enums import EngineLiveStatus, LiveFeedEventLevel, LiveFeedEventType, ValidationStatus


ENGINE_ORDER = [
    "economy_resolution",
    "purpose_decomposition",
    "industry_intelligence",
    "market_analysis",
    "competitor_reality",
    "economy_location_intelligence",
    "customer_pain",
    "execution_difficulty_timing",
    "scoring",
    "evidence_quality",
    "knowledge_gap",
    "decision_intelligence",
    "recursive_validation",
    "multi_perspective_reality",
    "second_order_consequence",
    "systemic_risk",
    "institutional_reality",
    "narrative_intelligence",
    "cognitive_bias",
    "learning_velocity",
    "motivation",
    "counterfactual",
    "survivor_pattern",
    "anti_gaming",
    "civilization_evolution",
    "reality_compression",
    "meta_validation",
]


async def get_next_sequence_number(db: AsyncIOMotorDatabase, validation_id: str) -> int:
    now = datetime.now(timezone.utc)
    await db[VALIDATION_LIVE_SEQUENCES].update_one(
        {"validation_id": validation_id},
        {"$inc": {"last_sequence_number": 1}, "$set": {"updated_at": now}},
        upsert=True,
    )
    doc = await db[VALIDATION_LIVE_SEQUENCES].find_one({"validation_id": validation_id}) or {}
    return int(doc.get("last_sequence_number", 0))


async def create_live_event(
    db: AsyncIOMotorDatabase,
    *,
    validation_id: str,
    owner_user_id: str,
    event_type: LiveFeedEventType,
    title: str,
    message: str,
    level: LiveFeedEventLevel = LiveFeedEventLevel.info,
    payload: Optional[dict] = None,
    source: str = "system",
    engine_name: Optional[str] = None,
    validation_status: Optional[ValidationStatus] = None,
    engine_status: Optional[EngineLiveStatus] = None,
    replayable: bool = True,
    correlation_event_id: Optional[str] = None,
    request_id: Optional[str] = None,
) -> LiveFeedEvent:
    seq = await get_next_sequence_number(db, validation_id)
    return LiveFeedEvent(
        event_type=event_type,
        level=level,
        validation_id=validation_id,
        owner_user_id=owner_user_id,
        sequence_number=seq,
        title=title,
        message=message,
        payload=payload or {},
        source=source,
        engine_name=engine_name,
        validation_status=validation_status,
        engine_status=engine_status,
        replayable=replayable,
        correlation_event_id=correlation_event_id,
        request_id=request_id,
        timestamp=datetime.now(timezone.utc),
    )


async def get_live_snapshot(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    current_user: CurrentUser,
    *,
    connected_clients: int = 0,
) -> ValidationLiveSnapshot:
    validation = await load_validation(db, validation_id, current_user)
    status = ValidationStatus(validation["status"])
    seq_doc = await db[VALIDATION_LIVE_SEQUENCES].find_one({"validation_id": validation_id}) or {}
    last_seq = int(seq_doc.get("last_sequence_number", 0))

    cursor = (
        db[VALIDATION_LIVE_EVENTS]
        .find({"validation_id": validation_id})
        .sort("sequence_number", -1)
        .limit(20)
    )
    raw = await cursor.to_list(length=20)
    events = []
    for d in reversed(raw):
        d.pop("_id", None)
        events.append(LiveFeedEvent(**d))

    engines = [
        EngineLiveFeedItem(engine_name=name, engine_number=i + 1, status=EngineLiveStatus.pending)
        for i, name in enumerate(ENGINE_ORDER)
    ]
    progress = LiveFeedProgress(
        current_stage=status.value,
        percent_complete=validation.get("progress", {}).get("percent_complete", 0.0) if validation.get("progress") else 0.0,
        total_engines=27,
        engines_completed=validation.get("progress", {}).get("engines_completed", 0) if validation.get("progress") else 0,
        engines_failed=validation.get("progress", {}).get("engines_failed", 0) if validation.get("progress") else 0,
        engines_fallback=validation.get("progress", {}).get("engines_fallback", 0) if validation.get("progress") else 0,
        message=validation.get("progress", {}).get("live_message") if validation.get("progress") else None,
        updated_at=datetime.now(timezone.utc),
    )

    return ValidationLiveSnapshot(
        validation_id=validation_id,
        validation_status=status,
        connected_clients=connected_clients,
        last_sequence_number=last_seq,
        progress=progress,
        engines=engines,
        latest_events=events,
        generated_at=datetime.now(timezone.utc),
    )


async def get_replay_events(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    after_sequence: int,
    current_user: CurrentUser,
    limit: int = 100,
) -> list[dict]:
    await load_validation(db, validation_id, current_user)
    cursor = (
        db[VALIDATION_LIVE_EVENTS]
        .find({"validation_id": validation_id, "sequence_number": {"$gt": after_sequence}})
        .sort("sequence_number", 1)
        .limit(limit)
    )
    items = await cursor.to_list(length=limit)
    for i in items:
        i.pop("_id", None)
    return items

