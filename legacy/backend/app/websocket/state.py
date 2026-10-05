"""Global websocket state singletons — Prompt A6."""

from __future__ import annotations

from app.core.config import get_settings
from app.websocket.buffer import ValidationLiveEventBuffer
from app.websocket.connection_manager import ConnectionManager
from app.websocket.broadcaster import LiveEventBroadcaster


settings = get_settings()
manager = ConnectionManager()
buffer = ValidationLiveEventBuffer(max_events_per_validation=settings.websocket_event_buffer_size)
broadcaster = LiveEventBroadcaster(manager, buffer)

