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
    source_identity: str | None = Field(default=None, max_length=500)
    source_provider: str | None = Field(default=None, max_length=160)
    identity_provenance: Literal['source_metadata', 'creator_supplied', 'inferred', 'unknown'] = 'unknown'
    source_identity_verified: bool = False
    creator_purpose: str | None = Field(default=None, max_length=2000)
    learning_targets: list[str] = Field(default_factory=list, max_length=20)
    role: ReferenceRole = ReferenceRole.style
    mime: str = Field(default='application/octet-stream', max_length=120)
    filename: str = Field(default='reference', max_length=255)
    data_base64: str | None = Field(default=None, max_length=90_000_000)
    media_id: UUID | None = None
    goal: str = Field(default='', max_length=2000)


class ReferenceIdentityUpdateRequest(RequestModel):
    expected_revision: int = Field(ge=1)
    source_identity: str | None = Field(default=None, max_length=500)
    source_provider: str | None = Field(default=None, max_length=160)
    source_identity_verified: bool = False
    creator_purpose: str | None = Field(default=None, max_length=2000)
    learning_targets: list[str] = Field(default_factory=list, max_length=20)


class AudioPlanUpdateRequest(RequestModel):
    expected_revision: int | None = Field(default=None, ge=1)
    overall_intent: str | None = Field(default=None, max_length=2000)
    dialogue_strategy: str | None = Field(default=None, max_length=1600)
    music_strategy: str | None = Field(default=None, max_length=1600)
    sound_design_strategy: str | None = Field(default=None, max_length=2000)
    ambience_strategy: str | None = Field(default=None, max_length=1600)
    recording_considerations: str | None = Field(default=None, max_length=1600)
    silence_strategy: str | None = Field(default=None, max_length=1200)
    recurring_motifs: list[str] | None = Field(default=None, max_length=20)
    continuity_considerations: str | None = Field(default=None, max_length=1200)
    delivery_considerations: str | None = Field(default=None, max_length=1200)
    intentional_silence: bool | None = None
    master_song_reference_id: UUID | None = None
    master_song_provenance: Literal['creator_supplied', 'licensed', 'original', 'generated', 'external_reference', 'unknown'] | None = None


class SceneAudioDirectionUpdateRequest(RequestModel):
    expected_revision: int | None = Field(default=None, ge=1)
    music_use: Literal['undecided', 'use', 'intentional_silence', 'not_applicable'] | None = None
    music_direction: str | None = Field(default=None, max_length=2000)
    cue_start_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    cue_end_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    cue_duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    music_purpose: str | None = Field(default=None, max_length=1000)
    rhythmic_quality: str | None = Field(default=None, max_length=500)
    instrumentation: str | None = Field(default=None, max_length=800)
    dynamics: str | None = Field(default=None, max_length=800)
    diegetic: bool | None = None
    dialogue_relationship: str | None = Field(default=None, max_length=800)
    action_relationship: str | None = Field(default=None, max_length=800)
    motif_relationship: str | None = Field(default=None, max_length=800)
    master_song_reference_id: UUID | None = None
    sound_use: Literal['undecided', 'directed', 'intentional_silence', 'not_applicable'] | None = None
    sound_direction: str | None = Field(default=None, max_length=2400)
    sound_events: list[str] | None = Field(default=None, max_length=30)
    recording_needs: str | None = Field(default=None, max_length=1200)
    microphone_considerations: str | None = Field(default=None, max_length=800)
    voice_treatment: str | None = Field(default=None, max_length=800)
    continuity_considerations: str | None = Field(default=None, max_length=1000)


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
