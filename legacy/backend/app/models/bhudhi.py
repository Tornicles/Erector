"""
Bhudhi Integration Models — Prompt A5
Bhudhi is advisory-only: interpret/structure/draft/explain/suggest.
All outputs are untrusted until validated against prompt contracts.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.base import BaseSchema, utcnow
from models.enums import (
    BhudhiForbiddenAction,
    BhudhiMode,
    BhudhiRiskLevel,
    BhudhiSource,
    BhudhiStatus,
    BhudhiTriggerType,
    PromptInjectionRiskType,
)


def new_bhudhi_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4()}"


class PromptInjectionFlag(BaseModel):
    flag_id: str = Field(default_factory=lambda: new_bhudhi_id("pif"))
    risk_type: PromptInjectionRiskType
    risk_level: BhudhiRiskLevel = BhudhiRiskLevel.medium
    description: str
    matched_text: Optional[str] = None
    action_taken: str = "flagged"
    blocks_request: bool = False


class AuthorityViolation(BaseModel):
    violation_id: str = Field(default_factory=lambda: new_bhudhi_id("authv"))
    forbidden_action: BhudhiForbiddenAction
    field: Optional[str] = None
    description: str
    source: str = "output"
    blocks_request: bool = True


class BhudhiAuthorityContext(BaseModel):
    allowed_mode: BhudhiMode
    forbidden_actions: list[BhudhiForbiddenAction] = Field(default_factory=lambda: list(BhudhiForbiddenAction))
    allowed_fields: list[str] = Field(default_factory=list)
    forbidden_fields: list[str] = Field(default_factory=list)
    deterministic_owner: str = "deterministic_system"
    can_modify_state: bool = False
    can_write_database: bool = False
    can_generate_user_text: bool = True
    can_generate_structured_output: bool = True
    max_risk_level: BhudhiRiskLevel = BhudhiRiskLevel.medium


class BhudhiTrigger(BaseModel):
    trigger_id: str = Field(default_factory=lambda: new_bhudhi_id("trg"))
    validation_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    team_id: Optional[str] = None
    trigger_type: BhudhiTriggerType
    source: BhudhiSource = BhudhiSource.user_request
    mode: BhudhiMode
    input_payload: dict = Field(default_factory=dict)
    requested_output_schema: Optional[str] = None
    authority_context: Optional[BhudhiAuthorityContext] = None
    priority: str = "normal"
    idempotency_key: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    metadata: dict = Field(default_factory=dict)


class BhudhiPromptContract(BaseSchema):
    contract_id: str
    mode: BhudhiMode
    trigger_type: BhudhiTriggerType
    name: str
    description: str
    system_instructions: str
    input_schema: dict
    output_schema: dict
    allowed_outputs: list[str]
    forbidden_outputs: list[str]
    fallback_strategy: str = "deterministic"
    max_tokens: int = 1500
    temperature: float = 0.2
    version: str = "1.0"
    active: bool = True


class BhudhiRequest(BaseModel):
    request_id: str = Field(default_factory=lambda: new_bhudhi_id("req"))
    trigger: BhudhiTrigger
    contract: BhudhiPromptContract
    sanitized_input: dict
    model: str
    max_tokens: int
    temperature: float
    created_at: datetime = Field(default_factory=utcnow)


class BhudhiResponse(BaseModel):
    response_id: str = Field(default_factory=lambda: new_bhudhi_id("resp"))
    request_id: str
    validation_id: Optional[str] = None
    mode: BhudhiMode
    trigger_type: BhudhiTriggerType
    status: BhudhiStatus = BhudhiStatus.pending
    output: Optional[dict] = None
    raw_output: Optional[str] = None  # only in development when enabled
    validated_output: Optional[dict] = None
    rejected_reason: Optional[str] = None
    fallback_used: bool = False
    fallback_reason: Optional[str] = None
    prompt_injection_flags: list[PromptInjectionFlag] = Field(default_factory=list)
    authority_flags: list[AuthorityViolation] = Field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost: float = 0.0
    latency_ms: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class BhudhiLog(BaseSchema):
    bhudhi_log_id: str = Field(default_factory=lambda: new_bhudhi_id("blog"))
    validation_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    team_id: Optional[str] = None
    trigger_type: str
    mode: str
    prompt_contract: str
    model: str
    input_hash: str
    output_hash: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost: float = 0.0
    status: str = "pending"
    rejected_reason: Optional[str] = None
    fallback_used: bool = False
    fallback_reason: Optional[str] = None
    prompt_injection_flags: list[dict] = Field(default_factory=list)
    authority_flags: list[dict] = Field(default_factory=list)
    latency_ms: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    metadata: dict = Field(default_factory=dict)


class BhudhiUsageSummary(BaseModel):
    owner_user_id: Optional[str] = None
    date: date
    total_calls: int = 0
    successful_calls: int = 0
    rejected_calls: int = 0
    fallback_calls: int = 0
    failed_calls: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost: float = 0.0
    budget_limit: int = 0
    budget_remaining: int = 0

