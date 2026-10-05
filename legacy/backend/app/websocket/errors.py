"""WebSocket error types — Prompt A6."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class WebSocketError(Exception):
    code: str
    message: str
    close_code: int = 1008
    recoverable: bool = False
    details: Optional[dict] = None

