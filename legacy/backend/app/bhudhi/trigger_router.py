"""
Bhudhi trigger router — Prompt A5
The ONLY entrypoint for Bhudhi calls. Enforces contracts, sanitization, injection checks,
authority guard, output validation, budgeting, logging, and fallback.
"""

from __future__ import annotations

import time
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.bhudhi import client as claude_client
from app.bhudhi.authority_guard import (
    assert_mode_allowed,
    assert_no_authority_violations,
    assert_no_forbidden_output,
    detect_forbidden_intent,
)
from app.bhudhi.contract_registry import get_contract
from app.bhudhi.fallbacks import get_fallback_for_contract
from app.bhudhi.input_sanitizer import build_input_hash, sanitize_payload
from app.bhudhi.output_validator import parse_json_response, validate_against_contract
from app.bhudhi.prompt_injection import scan_for_prompt_injection
from app.bhudhi.token_budget import check_user_daily_budget, check_validation_budget, estimate_tokens
from app.core.config import get_settings
from app.core.errors import BhudhiPromptInjectionError
from app.models.bhudhi import BhudhiAuthorityContext, BhudhiRequest, BhudhiResponse, BhudhiTrigger
from app.services.bhudhi_cost_service import estimate_cost_usd
from app.services.bhudhi_log_service import write_bhudhi_log
from models.enums import BhudhiStatus


async def route_bhudhi_trigger(db: AsyncIOMotorDatabase, trigger: BhudhiTrigger) -> BhudhiResponse:
    settings = get_settings()
    start = time.perf_counter()

    assert_mode_allowed(trigger.mode)
    contract = get_contract(trigger.mode, trigger.trigger_type)

    authority = trigger.authority_context or BhudhiAuthorityContext(allowed_mode=trigger.mode)
    sanitized_input = sanitize_payload(trigger.input_payload)
    input_hash = build_input_hash(sanitized_input)

    injection_flags = scan_for_prompt_injection(
        sanitized_input, blocking=settings.bhudhi_prompt_injection_blocking
    )
    if any(f.blocks_request for f in injection_flags):
        # safe fallback instead of hard failure when possible
        fallback_output, reason = get_fallback_for_contract(contract, sanitized_input, "prompt_injection_blocked")
        latency = int((time.perf_counter() - start) * 1000)
        resp = BhudhiResponse(
            request_id="n/a",
            validation_id=trigger.validation_id,
            mode=trigger.mode,
            trigger_type=trigger.trigger_type,
            status=BhudhiStatus.fallback,
            output=fallback_output,
            validated_output=fallback_output,
            rejected_reason="Prompt injection blocked; fallback used.",
            fallback_used=True,
            fallback_reason=reason,
            prompt_injection_flags=injection_flags,
            input_tokens=estimate_tokens(sanitized_input),
            output_tokens=estimate_tokens(fallback_output),
            total_tokens=estimate_tokens(sanitized_input) + estimate_tokens(fallback_output),
            estimated_cost=0.0,
            latency_ms=latency,
        )
        await write_bhudhi_log(
            db=db,
            trigger=trigger,
            contract=contract,
            model=settings.bhudhi_model,
            input_hash=input_hash,
            output_hash=None,
            status=resp.status.value,
            rejected_reason=resp.rejected_reason,
            fallback_used=True,
            fallback_reason=reason,
            prompt_injection_flags=[f.model_dump() for f in injection_flags],
            authority_flags=[],
            input_tokens=resp.input_tokens,
            output_tokens=resp.output_tokens,
            total_tokens=resp.total_tokens,
            estimated_cost=resp.estimated_cost,
            latency_ms=latency,
        )
        return resp

    # Authority guard on intent
    intent_violations = detect_forbidden_intent(sanitized_input)
    assert_no_authority_violations(intent_violations)

    # Budgets
    if trigger.owner_user_id:
        await check_user_daily_budget(db, trigger.owner_user_id)
    if trigger.validation_id:
        await check_validation_budget(db, trigger.validation_id)

    req = BhudhiRequest(
        trigger=trigger,
        contract=contract,
        sanitized_input=sanitized_input,
        model=settings.bhudhi_model,
        max_tokens=min(settings.bhudhi_max_tokens_default, contract.max_tokens),
        temperature=contract.temperature,
    )

    provider_available = settings.bhudhi_enabled and claude_client.is_configured()
    raw_text: Optional[str] = None
    output: dict
    fallback_used = False
    fallback_reason = None

    if provider_available:
        try:
            system = contract.system_instructions
            user = (
                f"CONTRACT: {contract.name}\n"
                f"TRIGGER_TYPE: {trigger.trigger_type.value}\n"
                f"MODE: {trigger.mode.value}\n"
                f"INPUT_JSON: {req.sanitized_input}\n"
                f"Return only JSON.\n"
            )
            result = await claude_client.call_claude(
                model=req.model,
                system=system,
                user=user,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
            )
            raw_text = result["raw_text"]
            output = parse_json_response(raw_text)
            validate_against_contract(output, contract)
        except Exception:
            output, fallback_reason = get_fallback_for_contract(contract, sanitized_input, "provider_failed_or_malformed")
            fallback_used = True
    else:
        output, fallback_reason = get_fallback_for_contract(contract, sanitized_input, "provider_unavailable")
        fallback_used = True

    # Authority guard on output
    out_violations = assert_no_forbidden_output(output)
    assert_no_authority_violations(out_violations)

    # Output validator again for fallback outputs
    validate_against_contract(output, contract)

    latency = int((time.perf_counter() - start) * 1000)
    in_tokens = estimate_tokens(sanitized_input)
    out_tokens = estimate_tokens(output)
    cost = estimate_cost_usd(in_tokens, out_tokens, settings.bhudhi_model)

    resp = BhudhiResponse(
        request_id=req.request_id,
        validation_id=trigger.validation_id,
        mode=trigger.mode,
        trigger_type=trigger.trigger_type,
        status=BhudhiStatus.fallback if fallback_used else BhudhiStatus.completed,
        output=output,
        raw_output=raw_text if (settings.debug and settings.bhudhi_store_raw_io) else None,
        validated_output=output,
        rejected_reason=None,
        fallback_used=fallback_used,
        fallback_reason=fallback_reason,
        prompt_injection_flags=injection_flags,
        authority_flags=out_violations,
        input_tokens=in_tokens,
        output_tokens=out_tokens,
        total_tokens=in_tokens + out_tokens,
        estimated_cost=cost,
        latency_ms=latency,
    )

    await write_bhudhi_log(
        db=db,
        trigger=trigger,
        contract=contract,
        model=settings.bhudhi_model,
        input_hash=input_hash,
        output_hash=None,
        status=resp.status.value,
        rejected_reason=resp.rejected_reason,
        fallback_used=resp.fallback_used,
        fallback_reason=resp.fallback_reason,
        prompt_injection_flags=[f.model_dump() for f in injection_flags],
        authority_flags=[v.model_dump() for v in out_violations],
        input_tokens=resp.input_tokens,
        output_tokens=resp.output_tokens,
        total_tokens=resp.total_tokens,
        estimated_cost=resp.estimated_cost,
        latency_ms=resp.latency_ms,
    )
    return resp

