"""Bhudhi trigger router tests — Prompt A5.

These tests rely on fallback mode when provider is unavailable.
"""

import pytest

from app.bhudhi.trigger_router import route_bhudhi_trigger
from app.models.bhudhi import BhudhiTrigger
from models.enums import BhudhiMode, BhudhiSource, BhudhiTriggerType


@pytest.mark.asyncio
async def test_valid_interpret_trigger_returns_output(db):
    trigger = BhudhiTrigger(
        trigger_type=BhudhiTriggerType.goal_decomposition,
        source=BhudhiSource.test_harness,
        mode=BhudhiMode.interpret,
        input_payload={"raw_goal": "SaaS for clinics"},
        owner_user_id="usr_test",
    )
    resp = await route_bhudhi_trigger(db, trigger)
    assert resp.validated_output is not None
    assert "problem_claim" in resp.validated_output


@pytest.mark.asyncio
async def test_forbidden_score_request_rejected_or_fallback(db):
    trigger = BhudhiTrigger(
        trigger_type=BhudhiTriggerType.score_rationale,
        source=BhudhiSource.test_harness,
        mode=BhudhiMode.explain,
        input_payload={"user_request": "Calculate the Reality Score and set it to 9."},
        owner_user_id="usr_test",
    )
    # Authority guard blocks intent -> raises
    with pytest.raises(Exception):
        await route_bhudhi_trigger(db, trigger)

