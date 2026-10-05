"""In-memory missed-event buffer — Prompt A6."""

from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from typing import Deque, Dict, List


class ValidationLiveEventBuffer:
    def __init__(self, max_events_per_validation: int = 100):
        self.max_events_per_validation = max_events_per_validation
        self._buffers: Dict[str, Deque[dict]] = defaultdict(lambda: deque(maxlen=max_events_per_validation))
        self._lock = asyncio.Lock()

    async def add_event(self, validation_id: str, event: dict) -> None:
        async with self._lock:
            self._buffers[validation_id].append(event)

    async def get_events_after(self, validation_id: str, sequence_number: int) -> List[dict]:
        async with self._lock:
            buf = list(self._buffers.get(validation_id, []))
        return [e for e in buf if int(e.get("sequence_number", 0)) > sequence_number]

    async def get_latest_events(self, validation_id: str, limit: int = 50) -> List[dict]:
        async with self._lock:
            buf = list(self._buffers.get(validation_id, []))
        return buf[-limit:]

    async def clear_validation(self, validation_id: str) -> None:
        async with self._lock:
            self._buffers.pop(validation_id, None)

    async def get_buffer_size(self, validation_id: str) -> int:
        async with self._lock:
            return len(self._buffers.get(validation_id, []))

