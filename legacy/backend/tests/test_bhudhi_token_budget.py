"""Bhudhi token budget tests — Prompt A5."""

import pytest

from app.bhudhi.token_budget import estimate_tokens


def test_estimate_tokens_positive():
    assert estimate_tokens("hello world") > 0

