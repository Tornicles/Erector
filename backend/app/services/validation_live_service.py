"""
Validation live adapter — Prompt A6
Builds user-safe titles/messages for lifecycle events.
"""

from __future__ import annotations

from models.enums import LiveFeedEventLevel, LiveFeedEventType


def build_validation_created_event(validation: dict) -> dict:
    return {
        "event_type": LiveFeedEventType.validation_created,
        "level": LiveFeedEventLevel.info,
        "title": "Validation created",
        "message": "Your validation session is ready for context collection.",
    }


def build_validation_state_changed_event(previous: str, current: str, reason: str) -> dict:
    return {
        "event_type": LiveFeedEventType.validation_state_changed,
        "level": LiveFeedEventLevel.info,
        "title": "Validation state changed",
        "message": f"{previous} → {current}. {reason}",
    }


def build_context_collected_event() -> dict:
    return {
        "event_type": LiveFeedEventType.context_collected,
        "level": LiveFeedEventLevel.success,
        "title": "Context collected",
        "message": "Your required context has passed the intake gate.",
    }


def build_economic_stack_built_event() -> dict:
    return {
        "event_type": LiveFeedEventType.economic_stack_built,
        "level": LiveFeedEventLevel.success,
        "title": "Economic Stack built",
        "message": "Founder, customer, revenue, platform, talent, and regulatory economies have been resolved.",
    }


def build_validation_failed_event(reason: str) -> dict:
    return {
        "event_type": LiveFeedEventType.validation_failed,
        "level": LiveFeedEventLevel.error,
        "title": "Validation failed",
        "message": reason,
    }


def build_validation_archived_event() -> dict:
    return {
        "event_type": LiveFeedEventType.validation_archived,
        "level": LiveFeedEventLevel.warning,
        "title": "Validation archived",
        "message": "This validation has been archived.",
    }

