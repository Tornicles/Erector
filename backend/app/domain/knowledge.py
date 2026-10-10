"""Production Knowledge Engine and Tutorial Intelligence request contracts.

The database is authoritative for review state, provenance, conflicts, deduplication and versioning.
Source knowledge remains separate from TONDE's own adaptation: neither is copied into the other.
"""

from __future__ import annotations
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

KNOWLEDGE_CLASSES = ("technique", "equipment_guidance", "scene_guidance", "settings_guidance", "workflow", "safety")
KNOWLEDGE_SOURCES = ("creator", "reference", "tutorial", "import")
SOURCE_KINDS = ("creator", "reference", "tutorial", "import", "external_publication", "standards_body", "tonde_canon", "manufacturer")
CATEGORIES = ("camera", "composition", "lighting", "blocking", "performance", "product", "edit", "transition", "sound", "color", "story", "typography")
REVIEW_DECISIONS = ("reviewed", "rejected")
TUTORIAL_SOURCE_KINDS = ("creator_recording", "creator_note", "external_article", "external_video", "tonde_curriculum")
CONFLICT_KINDS = ("fact", "recommendation", "settings", "equipment", "terminology")
CONFLICT_RESOLUTIONS = ("adopt_primary", "adopt_secondary", "synthesize", "needs_expert", "not_a_conflict")


class KnowledgeCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    canonical_id: str = Field(min_length=3, max_length=120, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=160)
    category: str
    description: str = Field(min_length=1, max_length=1200)
    purpose: str = Field(min_length=1, max_length=600)
    effect: str = Field(min_length=1, max_length=600)
    knowledge_class: str = "technique"
    source_kind: str = "creator"
    tonde_guidance: str = Field(default="", max_length=4000)
    applicability: dict[str, Any] = Field(default_factory=dict)
    adaptation: dict[str, Any] = Field(default_factory=dict)
    sources: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    pending_review: bool = False


class KnowledgeRevise(BaseModel):
    model_config = ConfigDict(extra="ignore")
    changes: dict[str, Any]
    reason: str = Field(default="", max_length=1000)


class KnowledgeReview(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str
    note: str = Field(default="", max_length=2000)


class SourceAdd(BaseModel):
    model_config = ConfigDict(extra="ignore")
    source: dict[str, Any]


class ConflictOpen(BaseModel):
    model_config = ConfigDict(extra="ignore")
    subject: str = Field(min_length=1, max_length=300)
    kind: str
    primary_claim: str = Field(min_length=1, max_length=2000)
    secondary_claim: str = Field(min_length=1, max_length=2000)
    severity: str = "material"
    primary_item_id: str | None = None
    secondary_item_id: str | None = None
    evidence: list[Any] = Field(default_factory=list, max_length=10)
    detected_by: str = "creator"


class ConflictResolve(BaseModel):
    model_config = ConfigDict(extra="ignore")
    resolution: str
    note: str = Field(default="", max_length=2000)


class TutorialCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(min_length=1, max_length=200)
    source_kind: str
    media_id: str | None = None
    locator: str | None = None
    attribution: str | None = None
    license: str | None = None
    language: str = "en"
    notes: str = ""


class TutorialStep(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ordinal: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=1, max_length=4000)
    technique_id: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)


class TutorialPublish(BaseModel):
    model_config = ConfigDict(extra="ignore")
    note: str = Field(default="", max_length=2000)


class TutorialPromote(BaseModel):
    model_config = ConfigDict(extra="ignore")
    canonical_id: str
    name: str
    category: str
    guidance: str
    adaptation: dict[str, Any] = Field(default_factory=dict)
    applicability: dict[str, Any] = Field(default_factory=dict)


class KnowledgeImport(BaseModel):
    model_config = ConfigDict(extra="ignore")
    format: str
    source_label: str = Field(min_length=1, max_length=300)
    payload: list[dict[str, Any]] = Field(min_length=1, max_length=500)
    source_locator: str | None = None
    license: str | None = None
    attribution: str | None = None
    dry_run: bool = False
