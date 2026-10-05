"""
Context Collection Models — Prompt A4
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.base import BaseSchema, utcnow
from models.base import OwnedDocument
from models.enums import (
    AntiGamingFlagType,
    ContextBlockerType,
    ContextStatus,
    KnowledgeGapSeverity,
    QuestionCategory,
)


def new_context_id() -> str:
    return f"ctx_{uuid.uuid4()}"


def new_answer_id() -> str:
    return f"ans_{uuid.uuid4()}"


def new_blocker_id() -> str:
    return f"blk_{uuid.uuid4()}"


def new_flag_id() -> str:
    return f"agf_{uuid.uuid4()}"


def new_gap_id() -> str:
    return f"gap_{uuid.uuid4()}"


class StructuredGoal(BaseSchema):
    problem_claim: Optional[str] = None
    target_user: Optional[str] = None
    value_claim: Optional[str] = None
    change_claim: Optional[str] = None
    success_claim: Optional[str] = None
    revenue_claim: Optional[str] = None
    timing_claim: Optional[str] = None
    resource_claim: Optional[str] = None
    contradictions: list[str] = Field(default_factory=list)
    hidden_assumptions: list[str] = Field(default_factory=list)
    unclear_terms: list[str] = Field(default_factory=list)
    clarity_score: float = Field(default=5.0, ge=0.0, le=10.0)
    interpretation_confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    source: str = "deterministic"


class ContextAnswer(BaseSchema):
    answer_id: str = Field(default_factory=new_answer_id)
    question_id: str
    category: QuestionCategory
    value: Any
    normalized_value: Optional[Any] = None
    confidence: Optional[float] = None
    quality_flags: list[str] = Field(default_factory=list)
    submitted_at: datetime = Field(default_factory=utcnow)
    updated_at: Optional[datetime] = None
    source: str = "user"
    evidence_refs: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


class QuestionState(BaseSchema):
    asked_question_ids: list[str] = Field(default_factory=list)
    answered_question_ids: list[str] = Field(default_factory=list)
    skipped_question_ids: list[str] = Field(default_factory=list)
    blocked_question_ids: list[str] = Field(default_factory=list)
    current_batch_number: int = 0
    completed_categories: list[str] = Field(default_factory=list)
    required_categories_remaining: list[str] = Field(default_factory=list)
    branch_memory: dict = Field(default_factory=dict)
    last_question_generated_at: Optional[datetime] = None


class AnswerQualityReport(BaseSchema):
    overall_quality_score: float = Field(default=5.0, ge=0.0, le=10.0)
    flags: list[str] = Field(default_factory=list)
    vague_answers: list[str] = Field(default_factory=list)
    contradictory_answers: list[str] = Field(default_factory=list)
    inflated_answers: list[str] = Field(default_factory=list)
    missing_specificity: list[str] = Field(default_factory=list)
    required_clarifications: list[str] = Field(default_factory=list)
    can_continue: bool = False


class AntiGamingFlag(BaseSchema):
    flag_id: str = Field(default_factory=new_flag_id)
    flag_type: AntiGamingFlagType
    severity: str = "high"
    description: str
    triggered_by: str = ""
    affected_fields: list[str] = Field(default_factory=list)
    required_clarification: Optional[str] = None
    blocks_progress: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class AntiGamingReport(BaseSchema):
    integrity_score: float = Field(default=8.0, ge=0.0, le=10.0)
    flags: list[AntiGamingFlag] = Field(default_factory=list)
    blocks_progress: bool = False
    required_clarifications: list[str] = Field(default_factory=list)
    summary: str = ""


class KnowledgeGap(BaseSchema):
    gap_id: str = Field(default_factory=new_gap_id)
    severity: KnowledgeGapSeverity
    claim_type: str
    description: str
    why_it_matters: str = ""
    recommended_research: Optional[str] = None
    recommended_test: Optional[str] = None
    blocks_progress: bool = False
    source_question_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class PreliminaryKnowledgeGapReport(BaseSchema):
    gaps: list[KnowledgeGap] = Field(default_factory=list)
    critical_count: int = 0
    dangerous_count: int = 0
    low_impact_count: int = 0
    blocks_progress: bool = False
    summary: str = ""


class ContextBlocker(BaseSchema):
    blocker_id: str = Field(default_factory=new_blocker_id)
    blocker_type: ContextBlockerType
    severity: str = "high"
    message: str
    field: Optional[str] = None
    question_id: Optional[str] = None
    resolution_action: str
    blocks_engine_start: bool = True


class EngineInputObject(BaseSchema):
    validation_id: str
    raw_goal: str
    structured_goal: dict = Field(default_factory=dict)
    user_context: dict = Field(default_factory=dict)
    business_context: dict = Field(default_factory=dict)
    economy_context: dict = Field(default_factory=dict)
    team_context: dict = Field(default_factory=dict)
    revenue_context: dict = Field(default_factory=dict)
    evidence_context: dict = Field(default_factory=dict)
    risk_context: dict = Field(default_factory=dict)
    assumptions_seed: list[dict] = Field(default_factory=list)
    dependencies_seed: list[dict] = Field(default_factory=list)
    missing_context: list[str] = Field(default_factory=list)
    input_quality_score: float = 0.0
    integrity_score: float = 0.0
    readiness_for_engines: bool = False
    generated_at: datetime = Field(default_factory=utcnow)


class ValidationContext(OwnedDocument):
    context_id: str = Field(default_factory=new_context_id)
    validation_id: str
    status: ContextStatus = ContextStatus.not_started
    raw_goal: Optional[str] = None
    structured_goal: Optional[StructuredGoal] = None
    question_state: QuestionState = Field(default_factory=QuestionState)
    answers: list[ContextAnswer] = Field(default_factory=list)
    required_fields_complete: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    answer_quality_report: Optional[AnswerQualityReport] = None
    anti_gaming_report: Optional[AntiGamingReport] = None
    preliminary_knowledge_gap_report: Optional[PreliminaryKnowledgeGapReport] = None
    context_blockers: list[ContextBlocker] = Field(default_factory=list)
    context_warnings: list[str] = Field(default_factory=list)
    engine_input_object: Optional[EngineInputObject] = None
    economic_stack_preview: Optional[dict] = None
    submitted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ContextAnswerInput(BaseModel):
    question_id: str
    value: Any
    notes: Optional[str] = None


class ContextSubmissionRequest(BaseModel):
    answers: list[ContextAnswerInput]
    submit_final: bool = False
    metadata: Optional[dict] = None


class ContextSubmissionResponse(BaseModel):
    validation_id: str
    context_id: str
    context_status: ContextStatus
    accepted_answers: list[str] = Field(default_factory=list)
    rejected_answers: list[dict] = Field(default_factory=list)
    missing_required_fields: list[str] = Field(default_factory=list)
    blockers: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    next_questions: list[dict] = Field(default_factory=list)
    can_proceed_to_engines: bool = False
    engine_input_object: Optional[dict] = None


class ContextGateResult(BaseModel):
    can_proceed_to_engines: bool = False
    can_build_economic_stack: bool = False
    should_transition_to_context_collected: bool = False
    should_transition_to_economic_stack_built: bool = False
    blockers: list[ContextBlocker] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    required_actions: list[str] = Field(default_factory=list)
    quality_score: float = 0.0
    integrity_score: float = 0.0
    knowledge_gap_summary: str = ""
