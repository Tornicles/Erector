"""
Validation State Machine — Prompt A3
Centralized legal transition rules for validation lifecycle.
"""

from __future__ import annotations

from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.errors import InvalidStateTransitionError
from app.db.collections import VALIDATION_SESSIONS
from app.models.auth import CurrentUser
from app.models.enums import ValidationStatus
from app.models.validation import ValidationStateHistoryEntry
from app.services.audit_service import write_audit_log
from app.services.event_service import emit_event
from models.enums import VALIDATION_STATE_TRANSITIONS, ValidationEventType


TERMINAL_STATES = {
    ValidationStatus.completed,
    ValidationStatus.failed,
    ValidationStatus.launched,
    ValidationStatus.archived,
}

ACTIVE_STATES = {
    ValidationStatus.draft,
    ValidationStatus.context_collecting,
    ValidationStatus.context_collected,
    ValidationStatus.economic_stack_built,
    ValidationStatus.engines_queued,
    ValidationStatus.engines_running,
    ValidationStatus.partial_results,
    ValidationStatus.scoring,
    ValidationStatus.recursive_challenge,
    ValidationStatus.path_generation,
    ValidationStatus.report_ready,
}

STUCK_ELIGIBLE_STATES = {
    ValidationStatus.economic_stack_built,
    ValidationStatus.engines_queued,
    ValidationStatus.engines_running,
    ValidationStatus.partial_results,
    ValidationStatus.scoring,
    ValidationStatus.recursive_challenge,
    ValidationStatus.path_generation,
    ValidationStatus.report_ready,
}


def _status_value(status: ValidationStatus | str) -> str:
    return status.value if isinstance(status, ValidationStatus) else status


def can_transition(current_status: ValidationStatus | str, next_status: ValidationStatus | str) -> bool:
    """Return True if the transition is legal."""
    current = _status_value(current_status)
    nxt = _status_value(next_status)
    return nxt in VALIDATION_STATE_TRANSITIONS.get(current, [])


def assert_transition_allowed(current_status: ValidationStatus | str, next_status: ValidationStatus | str) -> None:
    """Raise InvalidStateTransitionError if transition is not legal."""
    current = _status_value(current_status)
    nxt = _status_value(next_status)
    allowed = get_allowed_transitions(current_status)
    if not can_transition(current_status, next_status):
        raise InvalidStateTransitionError(
            message=f"Validation cannot transition from {current} to {nxt}.",
            current_status=current,
            requested_status=nxt,
            allowed_statuses=allowed,
        )


def get_allowed_transitions(current_status: ValidationStatus | str) -> list[str]:
    """Return list of legal next statuses."""
    return list(VALIDATION_STATE_TRANSITIONS.get(_status_value(current_status), []))


def is_terminal(status: ValidationStatus | str) -> bool:
    val = status if isinstance(status, ValidationStatus) else ValidationStatus(_status_value(status))
    return val in TERMINAL_STATES


def is_active(status: ValidationStatus | str) -> bool:
    val = status if isinstance(status, ValidationStatus) else ValidationStatus(_status_value(status))
    return val in ACTIVE_STATES


def is_stuck_eligible(status: ValidationStatus | str) -> bool:
    val = status if isinstance(status, ValidationStatus) else ValidationStatus(_status_value(status))
    return val in STUCK_ELIGIBLE_STATES


async def transition_validation(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    next_status: ValidationStatus,
    reason: str,
    actor: CurrentUser,
    metadata: Optional[dict] = None,
    request_id: Optional[str] = None,
) -> tuple[dict, str, str, Optional[str]]:
    """
    Perform a legal state transition on a validation session.
    Returns (updated_doc, previous_status, event_id).
    """
    from app.models.base import utcnow

    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        from app.core.errors import ValidationNotFoundError
        raise ValidationNotFoundError(validation_id)

    previous = doc["status"]
    assert_transition_allowed(previous, next_status)

    now = utcnow()
    history_entry = ValidationStateHistoryEntry(
        from_status=ValidationStatus(previous),
        to_status=next_status,
        reason=reason,
        actor_type="user",
        actor_id=actor.user_id,
        metadata=metadata or {},
    )

    update_fields: dict = {
        "status": _status_value(next_status),
        "updated_at": now,
        "last_activity_at": now,
    }

    if next_status == ValidationStatus.completed:
        update_fields["completed_at"] = now
    elif next_status == ValidationStatus.launched:
        update_fields["launched_at"] = now
    elif next_status == ValidationStatus.archived:
        update_fields["archived_at"] = now

    event_id = await emit_event(
        db,
        event_type=ValidationEventType.validation_state_changed,
        entity_type="validation",
        entity_id=validation_id,
        payload={
            "from_status": previous,
            "to_status": _status_value(next_status),
            "reason": reason,
            "metadata": metadata or {},
        },
        owner_user_id=doc["owner_user_id"],
        validation_id=validation_id,
        team_id=doc.get("team_id"),
    )
    history_entry.event_id = event_id

    await db[VALIDATION_SESSIONS].update_one(
        {"validation_id": validation_id},
        {
            "$set": update_fields,
            "$push": {
                "state_history": history_entry.model_dump(mode="json"),
                "event_ids": event_id,
            },
        },
    )

    updated = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})

    await write_audit_log(
        db,
        action="validation.state_changed",
        entity_type="validation",
        entity_id=validation_id,
        actor_user_id=actor.user_id,
        owner_user_id=doc["owner_user_id"],
        team_id=doc.get("team_id"),
        old_value={"status": previous},
        new_value={"status": _status_value(next_status), "reason": reason},
        request_id=request_id,
    )

    return updated, previous, event_id


async def mark_failed(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    reason: str,
    error_code: Optional[str],
    actor: CurrentUser,
    metadata: Optional[dict] = None,
    request_id: Optional[str] = None,
) -> tuple[dict, Optional[str]]:
    """Transition validation to failed from any active state."""
    from app.models.base import utcnow
    from app.core.errors import ValidationNotFoundError

    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        raise ValidationNotFoundError(validation_id)

    current = doc["status"]
    if current == ValidationStatus.archived.value:
        assert_transition_allowed(current, ValidationStatus.failed)

    if current != ValidationStatus.failed.value:
        assert_transition_allowed(current, ValidationStatus.failed)

    now = utcnow()
    previous = current

    event_id = await emit_event(
        db,
        event_type=ValidationEventType.validation_failed,
        entity_type="validation",
        entity_id=validation_id,
        payload={
            "reason": reason,
            "error_code": error_code,
            "metadata": metadata or {},
            "from_status": previous,
        },
        owner_user_id=doc["owner_user_id"],
        validation_id=validation_id,
        team_id=doc.get("team_id"),
    )

    history_entry = ValidationStateHistoryEntry(
        from_status=ValidationStatus(previous),
        to_status=ValidationStatus.failed,
        reason=reason,
        actor_type="user",
        actor_id=actor.user_id,
        event_id=event_id,
        metadata=metadata or {},
    )

    await db[VALIDATION_SESSIONS].update_one(
        {"validation_id": validation_id},
        {
            "$set": {
                "status": ValidationStatus.failed.value,
                "failed_reason": reason,
                "failure_code": error_code,
                "updated_at": now,
                "last_activity_at": now,
            },
            "$push": {
                "state_history": history_entry.model_dump(mode="json"),
                "event_ids": event_id,
            },
        },
    )

    updated = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})

    await write_audit_log(
        db,
        action="validation.failed",
        entity_type="validation",
        entity_id=validation_id,
        actor_user_id=actor.user_id,
        owner_user_id=doc["owner_user_id"],
        team_id=doc.get("team_id"),
        old_value={"status": previous},
        new_value={"status": "failed", "failure_code": error_code},
        request_id=request_id,
    )

    return updated, event_id


async def mark_archived(
    db: AsyncIOMotorDatabase,
    validation_id: str,
    reason: str,
    actor: CurrentUser,
    request_id: Optional[str] = None,
) -> tuple[dict, Optional[str]]:
    """Archive a validation if legal."""
    from app.models.base import utcnow
    from app.core.errors import ValidationNotFoundError

    doc = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})
    if not doc:
        raise ValidationNotFoundError(validation_id)

    previous = doc["status"]
    assert_transition_allowed(previous, ValidationStatus.archived)

    now = utcnow()
    event_id = await emit_event(
        db,
        event_type=ValidationEventType.validation_archived,
        entity_type="validation",
        entity_id=validation_id,
        payload={"reason": reason, "from_status": previous},
        owner_user_id=doc["owner_user_id"],
        validation_id=validation_id,
        team_id=doc.get("team_id"),
    )

    history_entry = ValidationStateHistoryEntry(
        from_status=ValidationStatus(previous),
        to_status=ValidationStatus.archived,
        reason=reason,
        actor_type="user",
        actor_id=actor.user_id,
        event_id=event_id,
    )

    await db[VALIDATION_SESSIONS].update_one(
        {"validation_id": validation_id},
        {
            "$set": {
                "status": ValidationStatus.archived.value,
                "archived_at": now,
                "updated_at": now,
                "last_activity_at": now,
            },
            "$push": {
                "state_history": history_entry.model_dump(mode="json"),
                "event_ids": event_id,
            },
        },
    )

    updated = await db[VALIDATION_SESSIONS].find_one({"validation_id": validation_id})

    await write_audit_log(
        db,
        action="validation.archived",
        entity_type="validation",
        entity_id=validation_id,
        actor_user_id=actor.user_id,
        owner_user_id=doc["owner_user_id"],
        team_id=doc.get("team_id"),
        old_value={"status": previous},
        new_value={"status": "archived"},
        request_id=request_id,
    )

    return updated, event_id
