"""
Connection manager — Prompt A6
Tracks active WS connections per validation and supports broadcasting.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import WebSocket

from app.core.config import get_settings
from models.enums import WebSocketConnectionStatus, WebSocketDisconnectReason


def new_connection_id() -> str:
    return f"ws_{uuid.uuid4()}"


@dataclass
class ManagedConnection:
    connection_id: str
    websocket: WebSocket
    validation_id: str
    owner_user_id: str
    connected_at: datetime
    last_heartbeat_at: datetime
    last_sequence_sent: int = 0
    status: WebSocketConnectionStatus = WebSocketConnectionStatus.connected


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: Dict[str, Dict[str, ManagedConnection]] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        websocket: WebSocket,
        *,
        validation_id: str,
        owner_user_id: str,
    ) -> ManagedConnection:
        settings = get_settings()
        await websocket.accept()
        conn = ManagedConnection(
            connection_id=new_connection_id(),
            websocket=websocket,
            validation_id=validation_id,
            owner_user_id=owner_user_id,
            connected_at=datetime.now(timezone.utc),
            last_heartbeat_at=datetime.now(timezone.utc),
        )
        async with self._lock:
            per_val = self.active_connections.setdefault(validation_id, {})
            if len(per_val) >= settings.websocket_max_connections_per_validation:
                raise RuntimeError("WS_CONNECTION_LIMIT_EXCEEDED")
            per_val[conn.connection_id] = conn
        return conn

    async def disconnect(self, connection_id: str, reason: WebSocketDisconnectReason = WebSocketDisconnectReason.client_closed) -> None:
        async with self._lock:
            for vid, conns in list(self.active_connections.items()):
                if connection_id in conns:
                    conns.pop(connection_id, None)
                    if not conns:
                        self.active_connections.pop(vid, None)
                    return

    async def broadcast_to_validation(self, validation_id: str, message: dict) -> dict:
        delivered = 0
        failed = 0
        failed_ids: list[str] = []
        async with self._lock:
            conns = list(self.active_connections.get(validation_id, {}).values())
        for conn in conns:
            try:
                await conn.websocket.send_json(message)
                delivered += 1
            except Exception:
                failed += 1
                failed_ids.append(conn.connection_id)
        # cleanup failed
        for cid in failed_ids:
            await self.disconnect(cid, WebSocketDisconnectReason.unknown_error)
        return {
            "validation_id": validation_id,
            "active_connections": len(conns),
            "delivered_count": delivered,
            "failed_count": failed,
            "failed_connection_ids": failed_ids,
        }

    async def get_connection_count(self, validation_id: str) -> int:
        async with self._lock:
            return len(self.active_connections.get(validation_id, {}))

    async def mark_heartbeat(self, connection_id: str) -> None:
        async with self._lock:
            for conns in self.active_connections.values():
                if connection_id in conns:
                    conns[connection_id].last_heartbeat_at = datetime.now(timezone.utc)
                    return

    async def cleanup_idle_connections(self) -> int:
        settings = get_settings()
        now = datetime.now(timezone.utc)
        timeout = settings.websocket_heartbeat_timeout_seconds
        removed = 0
        async with self._lock:
            for vid, conns in list(self.active_connections.items()):
                for cid, conn in list(conns.items()):
                    idle = (now - conn.last_heartbeat_at).total_seconds()
                    if idle > timeout:
                        conns.pop(cid, None)
                        removed += 1
                if not conns:
                    self.active_connections.pop(vid, None)
        return removed

