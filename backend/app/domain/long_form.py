"""Prompt 8 long-form, Series and Generate Ahead request contracts.

Every field is bounded and every structural value is validated here so the guarded RPCs
receive well-formed payloads. Nothing in this module invents creative content: a title
pattern, a creator-supplied topic list and a cadence are the only inputs Generate Ahead
turns into future Episodes.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

STRUCTURE_LEVELS = ('production', 'act', 'sequence', 'scene', 'shot')
SEQUENCE_KINDS = ('narrative', 'mission', 'location', 'topic', 'montage', 'action', 'documentary', 'thematic', 'custom')
HORIZONS = ('tomorrow', 'next_7', 'next_14', 'next_30', 'entire_series', 'custom')
DEPTHS = ('ideas_only', 'briefs', 'story', 'script', 'complete_plan')
CADENCE_KINDS = ('daily', 'weekdays', 'weekly', 'selected_weekdays', 'custom', 'none')
SERIES_KINDS = ('narrative', 'recurring')


class ActRequest(BaseModel):
    """An Act groups lower structure. It is never a second Production."""

    title: str = Field(min_length=1, max_length=160)
    purpose: str = Field(default='', max_length=1200)
    narrative_goal: str = Field(default='', max_length=1200)
    opening_state: str = Field(default='', max_length=600)
    ending_state: str = Field(default='', max_length=600)
    duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)

    @field_validator('title')
    @classmethod
    def _title(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError('An Act needs a title.')
        return stripped


class SequenceRequest(BaseModel):
    """A Sequence groups related Scenes and is optional."""

    title: str = Field(min_length=1, max_length=160)
    act_id: str | None = None
    kind: str = Field(default='narrative')
    purpose: str = Field(default='', max_length=1200)
    duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)

    @field_validator('kind')
    @classmethod
    def _kind(cls, value: str) -> str:
        if value not in SEQUENCE_KINDS:
            raise ValueError('Unsupported Sequence kind.')
        return value

    @field_validator('act_id')
    @classmethod
    def _act(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            return None
        return value


class StructurePatch(BaseModel):
    """A scoped structural patch. Reordering is a separate explicit operation."""

    title: str | None = Field(default=None, max_length=160)
    purpose: str | None = Field(default=None, max_length=1200)
    narrative_goal: str | None = Field(default=None, max_length=1200)
    opening_state: str | None = Field(default=None, max_length=600)
    ending_state: str | None = Field(default=None, max_length=600)
    kind: str | None = None
    duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    lifecycle: str | None = None

    @field_validator('kind')
    @classmethod
    def _kind(cls, value: str | None) -> str | None:
        if value is not None and value not in SEQUENCE_KINDS:
            raise ValueError('Unsupported Sequence kind.')
        return value

    @field_validator('lifecycle')
    @classmethod
    def _lifecycle(cls, value: str | None) -> str | None:
        if value is not None and value not in ('active', 'archived'):
            raise ValueError('Structure objects archive rather than delete.')
        return value


class MoveSceneRequest(BaseModel):
    """Move a Scene between Sequences or Acts. The Scene UUID never changes."""

    expected_revision: int = Field(ge=1)
    sequence_id: str | None = None
    act_id: str | None = None


class MoveSequenceRequest(BaseModel):
    """Move a Sequence between Acts. Child Scene identities are preserved."""

    expected_revision: int = Field(ge=1)
    act_id: str | None = None


class SplitRequest(BaseModel):
    """Split an Act or Sequence at a declared order. No child is duplicated."""

    level: str
    id: str
    split_order: int = Field(ge=0)
    expected_revision: int = Field(ge=1)
    title: str = Field(default='', max_length=160)

    @field_validator('level')
    @classmethod
    def _level(cls, value: str) -> str:
        if value not in ('act', 'sequence'):
            raise ValueError('Split applies to an Act or a Sequence.')
        return value


class ReorderRequest(BaseModel):
    """Reorder Acts, or the Sequences of one Act, against the structure revision."""

    level: str
    ordered_ids: list[str] = Field(min_length=1, max_length=400)
    expected_structure_revision: int | None = Field(default=None, ge=1)
    parent_id: str | None = None

    @field_validator('level')
    @classmethod
    def _level(cls, value: str) -> str:
        if value not in ('act', 'sequence'):
            raise ValueError('Reorder applies to Acts or Sequences.')
        return value


CREATOR_APPROVAL_STATES = ('draft', 'needs_review', 'approved')


class StructureApprovalRequest(BaseModel):
    """Approval is explicit creator acceptance of a specific revision."""

    level: str
    id: str
    approval: str
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator('level')
    @classmethod
    def _level(cls, value: str) -> str:
        if value not in ('act', 'sequence'):
            raise ValueError('Approval scope must be an Act or a Sequence here.')
        return value

    @field_validator('approval')
    @classmethod
    def _approval(cls, value: str) -> str:
        # CHANGED AFTER APPROVAL is derived when an approved object materially changes; a creator
        # can send an object back for review but never declares that state by hand.
        if value not in CREATOR_APPROVAL_STATES:
            raise ValueError('Approval is one of draft, needs_review or approved.')
        return value


class StructureLockRequest(BaseModel):
    """A lock protects a decision; it is independent of approval."""

    level: str
    id: str
    locked: bool = True
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator('level')
    @classmethod
    def _level(cls, value: str) -> str:
        if value not in ('act', 'sequence'):
            raise ValueError('Lock scope must be an Act or a Sequence here.')
        return value


class SummaryRequest(BaseModel):
    """A derived summary records the revision it was derived from."""

    level: str
    id: str
    text: str = Field(default='', max_length=4000)
    note: str = Field(default='', max_length=400)
    generated_by: str = Field(default='creator')
    expected_production_revision: int | None = Field(default=None, ge=1)

    @field_validator('level')
    @classmethod
    def _level(cls, value: str) -> str:
        if value == 'shot':
            raise ValueError('Summaries cover Production, Act, Sequence and Scene.')
        if value not in STRUCTURE_LEVELS:
            raise ValueError('Unsupported structure level.')
        return value

    @field_validator('generated_by')
    @classmethod
    def _author(cls, value: str) -> str:
        if value not in ('creator', 'tonde', 'system'):
            raise ValueError('Unsupported summary author.')
        return value


class CadenceMetadata(BaseModel):
    """Deterministic recurrence. Dates are computed in the Series timezone, never UTC."""

    kind: str = Field(default='daily')
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    every_days: int | None = Field(default=None, ge=1, le=90)
    slot_time: str = Field(default='', max_length=10)
    start_date: str | None = None

    @field_validator('kind')
    @classmethod
    def _kind(cls, value: str) -> str:
        if value not in CADENCE_KINDS:
            raise ValueError('Unsupported cadence kind.')
        return value

    @field_validator('weekdays')
    @classmethod
    def _weekdays(cls, values: list[int]) -> list[int]:
        for value in values:
            if value < 1 or value > 7:
                raise ValueError('Weekdays use ISO numbering 1 (Monday) to 7 (Sunday).')
        if len(set(values)) != len(values):
            raise ValueError('Weekday list contains duplicates.')
        return sorted(values)


class SeriesFormat(BaseModel):
    """Reusable recurring context. Assets are referenced by id, never copied."""

    production_type: str = Field(default='recurring_content', max_length=40)
    execution_method: str = Field(default='real')
    runtime_target_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    title_pattern: str = Field(default='{series} {n}', max_length=160)
    aspect_ratio: str = Field(default='', max_length=20)
    planned_episodes: int | None = Field(default=None, ge=1, le=400)
    style_bible_id: str | None = None
    host_asset_id: str | None = None
    character_ids: list[str] = Field(default_factory=list, max_length=40)
    environment_ids: list[str] = Field(default_factory=list, max_length=40)
    product_ids: list[str] = Field(default_factory=list, max_length=40)
    wardrobe_ids: list[str] = Field(default_factory=list, max_length=40)
    prop_ids: list[str] = Field(default_factory=list, max_length=40)
    voice_ids: list[str] = Field(default_factory=list, max_length=40)

    @field_validator('execution_method', 'production_type')
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('This field cannot be blank.')
        return value.strip()

    @field_validator('execution_method')
    @classmethod
    def _method(cls, value: str) -> str:
        if value not in ('real', 'ai', 'hybrid'):
            raise ValueError('Execution method must be real, ai or hybrid.')
        return value


class CreateSeriesRequest(BaseModel):
    """Series groups recurring Productions. Season is optional."""

    title: str = Field(min_length=1, max_length=160)
    series_kind: str = Field(default='recurring')
    timezone: str = Field(default='UTC', min_length=1, max_length=60)
    cadence_metadata: CadenceMetadata = Field(default_factory=CadenceMetadata)
    format: SeriesFormat = Field(default_factory=SeriesFormat)
    project_id: str | None = None
    summary: dict[str, Any] = Field(default_factory=dict)

    @field_validator('series_kind')
    @classmethod
    def _kind(cls, value: str) -> str:
        if value not in SERIES_KINDS:
            raise ValueError('Series kind must be narrative or recurring.')
        return value

    @field_validator('timezone')
    @classmethod
    def _timezone(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError('A Series needs an explicit timezone.')
        return stripped

    def payload(self) -> dict[str, Any]:
        return {
            'title': self.title.strip(), 'series_kind': self.series_kind, 'timezone': self.timezone.strip(),
            'cadence_metadata': self.cadence_metadata.model_dump(exclude_none=True),
            'format': self.format.model_dump(exclude_none=True), 'summary': self.summary,
        }


class UpdateSeriesRequest(BaseModel):
    """A Series patch. Format references stay canonical Asset ids."""

    expected_revision: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, max_length=160)
    series_kind: str | None = None
    timezone: str | None = Field(default=None, max_length=60)
    cadence_metadata: CadenceMetadata | None = None
    format: SeriesFormat | None = None
    lifecycle: str | None = None
    summary: dict[str, Any] | None = None

    @field_validator('series_kind')
    @classmethod
    def _kind(cls, value: str | None) -> str | None:
        if value is not None and value not in SERIES_KINDS:
            raise ValueError('Series kind must be narrative or recurring.')
        return value

    @field_validator('lifecycle')
    @classmethod
    def _lifecycle(cls, value: str | None) -> str | None:
        if value is not None and value not in ('active', 'archived'):
            raise ValueError('Series archive rather than delete.')
        return value

    def payload(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, exclude={'expected_revision'})


class CollectionRequest(BaseModel):
    """Season or Collection. Optional display language over one canonical grouping."""

    title: str = Field(min_length=1, max_length=160)
    purpose: str = Field(default='', max_length=1200)
    collection_id: str | None = None


class EpisodeRequest(BaseModel):
    """An Episode is an association around the same canonical Production."""

    title: str = Field(default='', max_length=160)
    production_id: str | None = None
    collection_id: str | None = None
    episode_number: int | None = Field(default=None, ge=1, le=100000)
    planned_date: str | None = None
    runtime_target_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    requested_depth: str | None = None
    topic: str = Field(default='', max_length=160)
    note: str = Field(default='', max_length=400)
    slot_key: str | None = Field(default=None, max_length=80)

    @field_validator('requested_depth')
    @classmethod
    def _depth(cls, value: str | None) -> str | None:
        if value is not None and value not in DEPTHS:
            raise ValueError('Unsupported requested depth.')
        return value

    def payload(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class EpisodePatch(BaseModel):
    """Episode association fields only; creative content stays on the Production."""

    expected_revision: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, max_length=160)
    episode_number: int | None = Field(default=None, ge=1, le=100000)
    planned_date: str | None = None
    collection_id: str | None = None
    runtime_target_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    requested_depth: str | None = None
    lifecycle: str | None = None
    brief: dict[str, Any] | None = None
    slot_key: str | None = Field(default=None, max_length=80)

    @field_validator('requested_depth')
    @classmethod
    def _depth(cls, value: str | None) -> str | None:
        if value is not None and value not in DEPTHS:
            raise ValueError('Unsupported requested depth.')
        return value

    @field_validator('lifecycle')
    @classmethod
    def _lifecycle(cls, value: str | None) -> str | None:
        if value is not None and value not in ('active', 'archived'):
            raise ValueError('Episodes archive rather than delete.')
        return value

    def payload(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, exclude={'expected_revision'})


class GenerateAheadRequest(BaseModel):
    """Generate Ahead previews and applies. Applying always needs explicit confirmation."""

    horizon: str
    depth: str
    count: int | None = Field(default=None, ge=1, le=400)
    base_date: str | None = None
    hold_slots: list[str] = Field(default_factory=list, max_length=400)
    topics: list[str] = Field(default_factory=list, max_length=400)
    collection_id: str | None = None
    note: str = Field(default='', max_length=400)
    expected_series_revision: int | None = Field(default=None, ge=1)
    confirm: bool = False

    @field_validator('horizon')
    @classmethod
    def _horizon(cls, value: str) -> str:
        if value not in HORIZONS:
            raise ValueError('Choose a Generate Ahead horizon.')
        return value

    @field_validator('depth')
    @classmethod
    def _depth(cls, value: str) -> str:
        if value not in DEPTHS:
            raise ValueError('Choose a Generate Ahead depth.')
        return value

    @field_validator('topics')
    @classmethod
    def _topics(cls, values: list[str]) -> list[str]:
        for value in values:
            if len(value) > 160:
                raise ValueError('A topic is limited to 160 characters.')
        return [value.strip() for value in values]

    def payload(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class DirectorScopeRequest(BaseModel):
    """A long-form or Series Director command. Scope must be explicit, never guessed broadly."""

    text: str = Field(min_length=1, max_length=2000)
    level: str = Field(default='production')
    id: str | None = None

    @field_validator('level')
    @classmethod
    def _level(cls, value: str) -> str:
        if value not in STRUCTURE_LEVELS:
            raise ValueError('Unsupported structure level.')
        return value


class SeriesDirectorRequest(BaseModel):
    """Series-level Director reasoning, bounded to titles, dates and states."""

    text: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=10, ge=1, le=30)
