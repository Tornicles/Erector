"""
Bhudhi AI Governance schemas — BhudhiLog, BhudhiPromptContract.
Bhudhi can ONLY: interpret, structure, draft, explain, suggest.
Bhudhi CANNOT: decide, calculate, override, score, verdict, alter_economy_profile,
               determine_climate, approve_assumption, reject_assumption.
Collection: bhudhi_logs
"""

from __future__ import annotations
from typing import Any, Optional
from pydantic import Field, field_validator
from .base import BaseSchema, new_id
from .enums import BhudhiMode, BhudhiForbiddenAction, BhudhiStatus


class BhudhiPromptContract(BaseSchema):
    """
    Enforced contract for every Bhudhi prompt.
    Defines allowed/forbidden outputs and output schema.
    """
    contract_id: str = Field(default_factory=new_id)
    mode: BhudhiMode
    allowed_outputs: list[str] = Field(default_factory=list)
    forbidden_outputs: list[str] = Field(default_factory=list)
    output_schema: Optional[dict] = None
    fallback_schema: Optional[dict] = None
    max_tokens: int = Field(ge=1, le=32000, default=4096)
    version: str = "1.0"

    @field_validator("mode")
    @classmethod
    def validate_mode_not_forbidden(cls, v):
        """Ensure Bhudhi mode is never a forbidden action."""
        forbidden_modes = {a.value for a in BhudhiForbiddenAction}
        mode_val = v.value if hasattr(v, "value") else v
        if mode_val in forbidden_modes:
            raise ValueError(
                f"Bhudhi mode '{mode_val}' is a forbidden action. "
                f"Bhudhi can only: {[m.value for m in BhudhiMode]}"
            )
        return v

    @field_validator("forbidden_outputs")
    @classmethod
    def forbidden_outputs_must_include_score_verdict(cls, v):
        """Score and verdict must always be in forbidden outputs."""
        required_forbidden = {"score", "verdict", "climate", "economy_profile"}
        missing = required_forbidden - set(v)
        for item in missing:
            v.append(item)
        return v


class BhudhiLog(BaseSchema):
    """
    Complete audit trail for every Bhudhi AI interaction.
    Collection: bhudhi_logs
    """
    bhudhi_log_id: str = Field(default_factory=new_id)
    validation_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    trigger_type: str   # user_request | engine_hook | report_generation | explain
    mode: BhudhiMode    # must be one of BhudhiMode — enforced
    prompt_contract: Optional[BhudhiPromptContract] = None
    input_hash: Optional[str] = None    # sha256 of input — never store raw input
    output_hash: Optional[str] = None   # sha256 of output
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    status: BhudhiStatus = BhudhiStatus.pending
    rejected_reason: Optional[str] = None
    fallback_used: bool = False

    @field_validator("mode")
    @classmethod
    def mode_must_not_be_forbidden(cls, v):
        forbidden = {a.value for a in BhudhiForbiddenAction}
        mode_val = v.value if hasattr(v, "value") else v
        if mode_val in forbidden:
            raise ValueError(
                f"BhudhiLog mode '{mode_val}' is forbidden. "
                f"Bhudhi governance violation detected."
            )
        return v
