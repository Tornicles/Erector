"""Request and generation contracts for the Card system.

A Card is written as a *whole* direction or not at all: the write carries every Card-level section,
so a partially applied generation cannot leave a Card that reads like a finished one. The response
contracts carry the validation report beside the content, because a Card that fails the content
contract must never be presented as READY.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.cards import BeatPlan, CardValidationReport, FieldFinding, ImpactPlan

CardModeValue = Literal['real', 'ai', 'hybrid']
CardFocus = Literal['card', 'subject', 'camera', 'look', 'audio', 'location']
GeneratedBy = Literal['deterministic', 'director', 'creator']
MAX_BEATS = 25
MAX_SECTION_CHARS = 6000


class CardSystemModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class CardDirectionDraft(CardSystemModel):
    """The complete Card-level direction. Generation returns this shape and nothing looser."""

    title: str = Field(min_length=2, max_length=160)
    purpose: str = Field(min_length=2, max_length=400)
    starts_from: str = Field(min_length=2, max_length=400)
    ends_with: str = Field(min_length=2, max_length=400)
    story_change: str = Field(min_length=2, max_length=400)
    summary: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    what_happens: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    director_direction: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    audience_feeling: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    subject_direction: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    camera_direction: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    look_direction: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    audio_direction: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    location_direction: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    continuity: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    resources: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)
    next_action: str = Field(min_length=2, max_length=MAX_SECTION_CHARS)

    @field_validator('*')
    @classmethod
    def strip_sections(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class WriteCardDirectionRequest(CardSystemModel):
    direction: CardDirectionDraft
    mode: CardModeValue = 'real'
    #: Provenance per section, kept internal: it is what lets a locked fact outrank a later guess.
    provenance: dict[str, Any] = Field(default_factory=dict)
    generated_by: GeneratedBy = 'creator'
    expected_revision: int | None = Field(default=None, ge=1)
    #: When a creator applies generated direction they may record the instruction that produced it.
    instruction: str | None = Field(default=None, max_length=1200)


class PlanCardsRequest(CardSystemModel):
    """Plan the Production structure. The Card count cap is enforced here, not in the browser."""

    target_runtime_ms: int = Field(ge=1_000, le=900_719_925_474_099)
    beats: list[BeatPlan] = Field(min_length=1, max_length=MAX_BEATS)
    #: Persist the planned Card shells as real Cards. Planning without persisting is a preview.
    persist: bool = False
    #: The creator may knowingly exceed the cap; TONDE never does it silently.
    acknowledge_card_cap: bool = False
    expected_production_revision: int | None = Field(default=None, ge=1)


class ValidateCardRequest(CardSystemModel):
    #: Store the report on the Card so the Studio shows the same verdict the server reached.
    persist: bool = True
    #: Validate direction that has not been saved yet (the preview before applying).
    direction: CardDirectionDraft | None = None


class ProposeCardDirectionRequest(CardSystemModel):
    """Ask TONDE to write the focused part of this Card. Everything returned is a proposal."""

    focus: CardFocus = 'card'
    instruction: str | None = Field(default=None, max_length=1200)
    #: The Card revision the proposal was written against, so applying it cannot silently apply
    #: direction written for an older Card.
    expected_revision: int | None = Field(default=None, ge=1)


class CardValidationView(CardSystemModel):
    card_id: str
    ready: bool
    missing: list[str] = []
    findings: list[FieldFinding] = []
    word_total: int = 0


class CardDirectionView(CardSystemModel):
    card_id: str
    order: int | None = None
    title: str | None = None
    mode: str = 'real'
    status: str = 'DRAFT'
    status_detail: str = ''
    direction: dict[str, Any] = {}
    provenance: dict[str, Any] = {}
    generated_by: str = 'deterministic'
    revision: int | None = None
    approval: str | None = None
    locked: bool = False
    validation: CardValidationView | None = None
    shot_count: int = 0


class ImpactView(CardSystemModel):
    plan: ImpactPlan
    detail: str = ''


def validation_view(report: CardValidationReport) -> CardValidationView:
    return CardValidationView(card_id=report.card_id, ready=report.ready, missing=report.missing,
        findings=report.findings, word_total=report.word_total)
