from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domain.analysis import ReferenceRole
from app.domain.commands import DirectorCommandKind
from app.domain.vocabulary import CollaborationMode


class RequestModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class GeneratePlanRequest(RequestModel):
    operation_id: UUID | None = None
    goal: str | None = Field(default=None, max_length=10000)
    collaboration_mode: CollaborationMode = CollaborationMode.stop_at_major_decisions
    answered_decisions: dict[str, str] = Field(default_factory=dict, max_length=20)
    variation: str = Field(default='original', max_length=40)
    include_optional_questions: bool = True


class CommitPlanRequest(RequestModel):
    operation_id: UUID
    expected_production_revision: int = Field(ge=1)
    bundle: dict[str, Any]
    explicit_confirmation: bool


class ReferenceAnalysisRequest(RequestModel):
    reference_id: UUID | None = None
    source_type: str = Field(default='upload', max_length=40)
    role: ReferenceRole = ReferenceRole.style
    mime: str = Field(default='application/octet-stream', max_length=120)
    filename: str = Field(default='reference', max_length=255)
    data_base64: str | None = Field(default=None, max_length=90_000_000)
    media_id: UUID | None = None
    goal: str = Field(default='', max_length=2000)


class BriefUpdateRequest(RequestModel):
    expected_brief_revision: int | None = Field(default=None, ge=1)
    brief: dict[str, Any]


class DecisionRequest(RequestModel):
    decisions: dict[str, str] = Field(min_length=1, max_length=20)
    source: Literal['intake', 'studio', 'correction', 'tonde_default'] = 'studio'
    questions: dict[str, str] = Field(default_factory=dict, max_length=20)


class DirectorCommandRequest(RequestModel):
    text: str = Field(min_length=1, max_length=1000)
    apply: bool = False
    expected_production_revision: int | None = Field(default=None, ge=1)
    operation_id: UUID | None = None


class DialogueOperationRequest(RequestModel):
    operation: str = Field(default='rewrite', max_length=40)
    scene_order: int | None = Field(default=None, ge=1, le=200)


class StoryAlternativeRequest(RequestModel):
    count: int = Field(default=3, ge=1, le=4)
    variation: str | None = Field(default=None, max_length=40)


class CommandPreviewRequest(RequestModel):
    text: str = Field(min_length=1, max_length=1000)


class DirectorCommandSummary(RequestModel):
    kind: DirectorCommandKind
    scope: str
    confidence: Literal['high', 'medium', 'low']
    rationale: str
    operations: list[str] = Field(default_factory=list)
    scene_order: int | None = None
    reference_role: str | None = None
    target_runtime_ms: int | None = None
