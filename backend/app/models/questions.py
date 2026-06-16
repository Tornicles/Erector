"""
Question Engine Models — Prompt A4
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models.base import BaseSchema, utcnow
from models.enums import QuestionCategory, QuestionPriority, QuestionType


class QuestionOption(BaseModel):
    label: str
    value: str
    description: Optional[str] = None
    risk_hint: Optional[str] = None


class BranchCondition(BaseModel):
    field: str
    operator: str = "eq"
    value: Any = None
    additional_conditions: list[dict] = Field(default_factory=list)
    explanation: Optional[str] = None


class QuestionValidationRule(BaseModel):
    rule_type: str
    parameters: dict = Field(default_factory=dict)
    error_message: str = "Invalid answer"
    warning_message: Optional[str] = None


class QuestionDefinition(BaseSchema):
    question_id: str
    category: QuestionCategory
    question_type: QuestionType = QuestionType.text
    priority: QuestionPriority = QuestionPriority.required
    prompt: str
    help_text: Optional[str] = None
    placeholder: Optional[str] = None
    options: list[QuestionOption] = Field(default_factory=list)
    required: bool = True
    branch_condition: Optional[BranchCondition] = None
    validation_rules: list[QuestionValidationRule] = Field(default_factory=list)
    blocks_progress_if_missing: bool = True
    order: int = 0
    depends_on_question_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class QuestionBatch(BaseModel):
    validation_id: str
    context_id: str
    questions: list[QuestionDefinition]
    required_count: int = 0
    answered_required_count: int = 0
    next_batch_reason: str = ""
    can_submit_context: bool = False


class QuestionProgress(BaseModel):
    total_required_questions: int = 0
    answered_required_questions: int = 0
    total_answered: int = 0
    categories_completed: list[str] = Field(default_factory=list)
    categories_remaining: list[str] = Field(default_factory=list)
    percent_complete: float = 0.0


class GetQuestionsResponse(BaseModel):
    validation_id: str
    context_id: str
    batch: QuestionBatch
    progress: QuestionProgress
    blockers: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
