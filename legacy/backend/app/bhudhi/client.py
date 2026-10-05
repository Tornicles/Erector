"""
Claude client wrapper — Prompt A5
All provider calls must go through trigger_router.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

import httpx

from app.core.config import get_settings
from app.core.errors import BhudhiProviderUnavailableError
from app.bhudhi.token_budget import estimate_tokens


def is_configured() -> bool:
    settings = get_settings()
    return bool(settings.anthropic_api_key)


def estimate_cost(input_tokens: int, output_tokens: int, model: str) -> float:
    # Conservative placeholder pricing (USD per 1k tokens)
    # Keep deterministic and adjustable later.
    per_1k = 0.003 if "sonnet" in model.lower() else 0.01
    return round(((input_tokens + output_tokens) / 1000.0) * per_1k, 6)


async def call_with_timeout(payload: dict, timeout_seconds: int) -> dict:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise BhudhiProviderUnavailableError("Anthropic API key not configured.")

    headers = {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        r = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
        if r.status_code >= 400:
            raise BhudhiProviderUnavailableError(
                "Anthropic provider error.",
                details={"status_code": r.status_code, "body": r.text[:500]},
            )
        return r.json()


def normalize_claude_response(resp: dict) -> str:
    # Messages API returns list in "content", typically [{"type":"text","text":"..."}]
    content = resp.get("content") or []
    if isinstance(content, list) and content:
        first = content[0]
        if isinstance(first, dict) and "text" in first:
            return str(first["text"])
    # Fallback
    return str(resp)


async def call_claude(*, model: str, system: str, user: str, max_tokens: int, temperature: float) -> dict:
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    timeout = get_settings().bhudhi_timeout_seconds
    start = time.perf_counter()
    resp = await call_with_timeout(payload, timeout_seconds=timeout)
    latency_ms = int((time.perf_counter() - start) * 1000)

    raw_text = normalize_claude_response(resp)
    usage = resp.get("usage") or {}
    input_tokens = int(usage.get("input_tokens", estimate_tokens(system + user)))
    output_tokens = int(usage.get("output_tokens", estimate_tokens(raw_text)))
    return {
        "raw_text": raw_text,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "latency_ms": latency_ms,
    }

