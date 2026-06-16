"""
Live feed router — Prompt A6
WebSocket endpoint + HTTP snapshot/event helpers.
"""

from __future__ import annotations

import json
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.client import get_database
from app.dependencies.auth import get_current_user
from app.models.api import error_response, success_response
from app.models.auth import CurrentUser
from app.models.live_feed import WebSocketClientMessage, WebSocketErrorMessage, WebSocketServerMessage
from app.services.live_feed_service import get_live_snapshot, get_replay_events
from app.services.live_feed_service import create_live_event
from app.services.context_service import load_validation
from app.websocket.auth import authenticate_websocket
from app.websocket.state import broadcaster, buffer, manager
from models.enums import LiveFeedEventLevel, LiveFeedEventType, WebSocketDisconnectReason

router = APIRouter(prefix="/v1/validations", tags=["live"])


@router.get("/{validation_id}/live/snapshot")
async def live_snapshot(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    start = time.perf_counter()
    db = get_database()
    await load_validation(db, validation_id, current_user)
    connected = await manager.get_connection_count(validation_id)
    snap = await get_live_snapshot(db, validation_id, current_user, connected_clients=connected)
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=snap.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.get("/{validation_id}/live/events")
async def live_events(
    validation_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    after_sequence: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    start = time.perf_counter()
    db = get_database()
    items = await get_replay_events(
        db, validation_id, after_sequence, current_user, limit=limit
    )
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data=items,
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.post("/{validation_id}/live/test-event")
async def live_test_event(
    validation_id: str,
    payload: dict,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    settings = get_settings()
    if settings.is_production or not settings.websocket_test_events_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    start = time.perf_counter()
    db = get_database()
    validation = await load_validation(db, validation_id, current_user)
    evt = await create_live_event(
        db,
        validation_id=validation_id,
        owner_user_id=current_user.user_id,
        event_type=LiveFeedEventType(payload.get("event_type", "engine_started")),
        title=str(payload.get("title", "Test event")),
        message=str(payload.get("message", "Test broadcast")),
        level=LiveFeedEventLevel(payload.get("level", "info")),
        payload={},
        source="test",
        replayable=True,
    )
    await broadcaster.broadcast_live_event(db, evt.model_dump(mode="json"))
    elapsed = int((time.perf_counter() - start) * 1000)
    return success_response(
        data={"broadcasted": True, "live_event_id": evt.live_event_id, "sequence_number": evt.sequence_number},
        request_id=getattr(request.state, "request_id", None),
        processing_time_ms=elapsed,
    ).model_dump(mode="json")


@router.websocket("/{validation_id}/live")
async def validation_live_ws(websocket: WebSocket, validation_id: str):
    settings = get_settings()
    if not settings.websocket_enabled:
        await websocket.close(code=1008)
        return
    db = get_database()
    try:
        user = await authenticate_websocket(websocket, validation_id)
    except Exception:
        await websocket.close(code=1008)
        return

    try:
        conn = await manager.connect(websocket, validation_id=validation_id, owner_user_id=user.user_id)
    except Exception:
        await websocket.close(code=1008)
        return

    # send established + snapshot + replay
    try:
        connected = await manager.get_connection_count(validation_id)
        snap = await get_live_snapshot(db, validation_id, user, connected_clients=connected)
        last_seq = int(websocket.query_params.get("last_sequence_received") or 0)
        replay = []
        if last_seq:
            replay = await buffer.get_events_after(validation_id, last_seq)
            if not replay:
                replay = await get_replay_events(db, validation_id, last_seq, user, limit=settings.websocket_replay_limit)

        await websocket.send_json(
            WebSocketServerMessage(
                type="connection_established",
                connection_id=conn.connection_id,
                snapshot=snap.model_dump(mode="json"),
            ).model_dump(mode="json")
        )
        # replay events
        for e in replay[: settings.websocket_replay_limit]:
            await websocket.send_json(
                WebSocketServerMessage(
                    type="event",
                    connection_id=conn.connection_id,
                    sequence_number=e.get("sequence_number"),
                    event=e,
                ).model_dump(mode="json")
            )

        while True:
            data = await websocket.receive_text()
            try:
                msg = WebSocketClientMessage(**json.loads(data))
            except Exception:
                await websocket.send_json(
                    WebSocketServerMessage(
                        type="error",
                        connection_id=conn.connection_id,
                        error=WebSocketErrorMessage(
                            code="WS_INVALID_MESSAGE",
                            message="Invalid JSON message.",
                            recoverable=True,
                            close_connection=False,
                        ),
                    ).model_dump(mode="json")
                )
                continue

            if msg.type == "ping":
                await manager.mark_heartbeat(conn.connection_id)
                await websocket.send_json(
                    WebSocketServerMessage(type="pong", connection_id=conn.connection_id).model_dump(mode="json")
                )
            elif msg.type == "get_snapshot":
                connected = await manager.get_connection_count(validation_id)
                snap = await get_live_snapshot(db, validation_id, user, connected_clients=connected)
                await websocket.send_json(
                    WebSocketServerMessage(type="snapshot", connection_id=conn.connection_id, snapshot=snap.model_dump(mode="json")).model_dump(mode="json")
                )
            elif msg.type == "resume":
                last_seq = int(msg.payload.get("last_sequence_received") or 0)
                replay = await buffer.get_events_after(validation_id, last_seq)
                if not replay:
                    replay = await get_replay_events(db, validation_id, last_seq, user, limit=settings.websocket_replay_limit)
                for e in replay[: settings.websocket_replay_limit]:
                    await websocket.send_json(
                        WebSocketServerMessage(
                            type="event",
                            connection_id=conn.connection_id,
                            sequence_number=e.get("sequence_number"),
                            event=e,
                        ).model_dump(mode="json")
                    )
            else:
                await websocket.send_json(
                    WebSocketServerMessage(
                        type="error",
                        connection_id=conn.connection_id,
                        error=WebSocketErrorMessage(
                            code="WS_INVALID_MESSAGE",
                            message="Unsupported message type.",
                            recoverable=True,
                            close_connection=False,
                        ),
                    ).model_dump(mode="json")
                )
    except WebSocketDisconnect:
        await manager.disconnect(conn.connection_id, WebSocketDisconnectReason.client_closed)
    except Exception:
        await manager.disconnect(conn.connection_id, WebSocketDisconnectReason.unknown_error)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass

