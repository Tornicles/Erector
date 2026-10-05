"""
Bhudhi service — Prompt A5
Public service wrapper that always routes through bhudhi.trigger_router.
"""

from __future__ import annotations

from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.bhudhi.trigger_router import route_bhudhi_trigger
from app.models.auth import CurrentUser
from app.models.bhudhi import BhudhiAuthorityContext, BhudhiResponse, BhudhiTrigger
from models.enums import BhudhiMode, BhudhiSource, BhudhiTriggerType


async def run_trigger(db: AsyncIOMotorDatabase, trigger: BhudhiTrigger) -> BhudhiResponse:
    return await route_bhudhi_trigger(db, trigger)


async def interpret_goal(
    db: AsyncIOMotorDatabase,
    raw_goal: str,
    *,
    validation_id: Optional[str] = None,
    context: Optional[dict] = None,
    current_user: Optional[CurrentUser] = None,
) -> BhudhiResponse:
    trigger = BhudhiTrigger(
        validation_id=validation_id,
        owner_user_id=current_user.user_id if current_user else None,
        team_id=None,
        trigger_type=BhudhiTriggerType.goal_decomposition,
        source=BhudhiSource.context_collection,
        mode=BhudhiMode.interpret,
        input_payload={"raw_goal": raw_goal, "context": context or {}},
        authority_context=BhudhiAuthorityContext(allowed_mode=BhudhiMode.interpret),
    )
    return await route_bhudhi_trigger(db, trigger)


async def structure_assumptions(
    db: AsyncIOMotorDatabase,
    *,
    validation_id: str,
    structured_goal: dict,
    context: dict,
    current_user: Optional[CurrentUser] = None,
) -> BhudhiResponse:
    trigger = BhudhiTrigger(
        validation_id=validation_id,
        owner_user_id=current_user.user_id if current_user else None,
        trigger_type=BhudhiTriggerType.assumption_extraction,
        source=BhudhiSource.validation_engine,
        mode=BhudhiMode.structure,
        input_payload={"structured_goal": structured_goal, "context": context},
        authority_context=BhudhiAuthorityContext(allowed_mode=BhudhiMode.structure),
    )
    return await route_bhudhi_trigger(db, trigger)


async def draft_framework_language(
    db: AsyncIOMotorDatabase,
    *,
    payload: dict,
    validation_id: Optional[str] = None,
    current_user: Optional[CurrentUser] = None,
) -> BhudhiResponse:
    trigger = BhudhiTrigger(
        validation_id=validation_id,
        owner_user_id=current_user.user_id if current_user else None,
        trigger_type=BhudhiTriggerType.framework_language,
        source=BhudhiSource.framework_builder,
        mode=BhudhiMode.draft,
        input_payload=payload,
        authority_context=BhudhiAuthorityContext(allowed_mode=BhudhiMode.draft),
    )
    return await route_bhudhi_trigger(db, trigger)


async def explain_score(
    db: AsyncIOMotorDatabase,
    *,
    payload: dict,
    validation_id: Optional[str] = None,
    current_user: Optional[CurrentUser] = None,
) -> BhudhiResponse:
    trigger = BhudhiTrigger(
        validation_id=validation_id,
        owner_user_id=current_user.user_id if current_user else None,
        trigger_type=BhudhiTriggerType.score_rationale,
        source=BhudhiSource.scoring_engine,
        mode=BhudhiMode.explain,
        input_payload=payload,
        authority_context=BhudhiAuthorityContext(allowed_mode=BhudhiMode.explain),
    )
    return await route_bhudhi_trigger(db, trigger)


async def suggest_path_alternatives(
    db: AsyncIOMotorDatabase,
    *,
    payload: dict,
    validation_id: Optional[str] = None,
    current_user: Optional[CurrentUser] = None,
) -> BhudhiResponse:
    trigger = BhudhiTrigger(
        validation_id=validation_id,
        owner_user_id=current_user.user_id if current_user else None,
        trigger_type=BhudhiTriggerType.path_alternatives,
        source=BhudhiSource.path_system,
        mode=BhudhiMode.suggest,
        input_payload=payload,
        authority_context=BhudhiAuthorityContext(allowed_mode=BhudhiMode.suggest),
    )
    return await route_bhudhi_trigger(db, trigger)

