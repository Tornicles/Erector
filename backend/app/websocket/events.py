"""Helpers for websocket message/event formatting — Prompt A6."""

from __future__ import annotations

from app.models.live_feed import WebSocketServerMessage


def make_event_message(connection_id: str, event: dict) -> dict:
    return WebSocketServerMessage(
        type="event",
        connection_id=connection_id,
        sequence_number=event.get("sequence_number"),
        event=event,
    ).model_dump(mode="json")

