"""
Context and Question Engine schemas.
Collection: validation_contexts
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import QuestionCategory, AnswerType


class ValidationRule(BaseSchema):
    rule_type: str  # min_length | max_length | regex | required | min | max
    value: Any
    error_message: str


class BranchCondition(BaseSchema):
    question_id: str
    operator: str  # eq | neq | contains | gt | lt
    value: Any
    show_question_id: str


class Question(BaseSchema):
    """A dynamic question in the context collection flow."""
    question_id: str = Field(default_factory=new_id)
    category: QuestionCategory = QuestionCategory.basic
    prompt: str
    help_text: Optional[str] = None
    required: bool = True
    answer_type: AnswerType = AnswerType.text
    options: list[str] = Field(default_factory=list)
    branch_condition: Optional[BranchCondition] = None
    validation_rules: list[ValidationRule] = Field(default_factory=list)
    order: int = 0


class Answer(BaseSchema):
    """User's answer to a context question."""
    question_id: str
    value: Any
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    submitted_at: datetime = Field(default_factory=utcnow)
    quality_flags: list[str] = Field(default_factory=list)


class AntiGamingFlag(BaseSchema):
    flag_type: str
    description: str
    severity: str  # low | medium | high
    question_ids: list[str] = Field(default_factory=list)
    detected_at: datetime = Field(default_factory=utcnow)


class ValidationContext(OwnedDocument):
    """
    Stores all question/answer state for a validation's context collection phase.
    Collection: validation_contexts
    """
    context_id: str = Field(default_factory=new_id)
    validation_id: str
    question_state: list[Question] = Field(default_factory=list)
    answers: list[Answer] = Field(default_factory=list)
    required_fields_complete: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    anti_gaming_flags: list[AntiGamingFlag] = Field(default_factory=list)
    preliminary_knowledge_gaps: list[str] = Field(default_factory=list)
    input_quality_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    engine_input_object: Optional[dict] = None
