from app.models.live_feed import (
    EngineLiveFeedItem,
    LiveFeedEvent,
    LiveFeedProgress,
    ValidationLiveSnapshot,
    WebSocketErrorMessage,
    WebSocketServerMessage,
)
from models.enums import EngineLiveStatus, LiveFeedEventLevel, LiveFeedEventType, ValidationStatus


def test_live_feed_event_requires_sequence_positive():
    evt = LiveFeedEvent(
        event_type=LiveFeedEventType.validation_created,
        level=LiveFeedEventLevel.info,
        validation_id="val_123",
        owner_user_id="usr_123",
        sequence_number=1,
        title="t",
        message="m",
    )
    assert evt.sequence_number == 1


def test_live_feed_progress_percent_bounds():
    p = LiveFeedProgress(percent_complete=50.0)
    assert p.percent_complete == 50.0


def test_engine_live_feed_item_status():
    item = EngineLiveFeedItem(engine_name="market_analysis", engine_number=4, status=EngineLiveStatus.pending)
    assert item.status == EngineLiveStatus.pending


def test_validation_snapshot_serializes():
    snap = ValidationLiveSnapshot(
        validation_id="val_1",
        validation_status=ValidationStatus.draft,
        engines=[],
        latest_events=[],
    )
    data = snap.model_dump(mode="json")
    assert data["validation_id"] == "val_1"


def test_server_message_with_error():
    msg = WebSocketServerMessage(
        type="error",
        connection_id="ws_1",
        error=WebSocketErrorMessage(
            code="WS_INVALID_MESSAGE",
            message="bad",
            recoverable=True,
            close_connection=False,
        ),
    )
    assert msg.error and msg.error.code == "WS_INVALID_MESSAGE"

