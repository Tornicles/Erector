import pytest

import pytest_asyncio

from app.websocket.buffer import ValidationLiveEventBuffer


@pytest.mark.asyncio
async def test_buffer_add_and_replay():
    buf = ValidationLiveEventBuffer(max_events_per_validation=3)
    await buf.add_event("val_1", {"sequence_number": 1})
    await buf.add_event("val_1", {"sequence_number": 2})
    await buf.add_event("val_1", {"sequence_number": 3})
    await buf.add_event("val_1", {"sequence_number": 4})  # prunes oldest
    latest = await buf.get_latest_events("val_1", limit=10)
    assert [e["sequence_number"] for e in latest] == [2, 3, 4]

    after2 = await buf.get_events_after("val_1", 2)
    assert [e["sequence_number"] for e in after2] == [3, 4]


@pytest.mark.asyncio
async def test_buffer_clear():
    buf = ValidationLiveEventBuffer()
    await buf.add_event("val_2", {"sequence_number": 1})
    await buf.clear_validation("val_2")
    assert await buf.get_latest_events("val_2") == []

