"""AI Creation domain vocabulary and request models.

TONDE is the production Director. In AI Creation it writes the playbook for a Shot, compiles the
tool-specific prompt the creator runs in the external tool they already own, and judges the Result
the creator uploads. It does not generate media and needs no media-generation credential.

These closed vocabularies come from the database (migration 043); the module names them so a request
is refused with a creator-readable message before an invalid value reaches the platform. The database
remains authoritative.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

CAPABILITY_TYPES: tuple[str, ...] = (
    'video_generation', 'image_generation', 'audio_generation', 'editing', 'compositing',
    'upscaling', 'other',
)

MEDIA_KINDS: tuple[str, ...] = ('video', 'image', 'audio', 'other')

INPUT_TYPES: tuple[str, ...] = ('text', 'image', 'video', 'audio')

SOURCE_KINDS: tuple[str, ...] = (
    'creator', 'tutorial', 'import', 'manufacturer', 'external_publication', 'standards_body',
)

REVIEW_STATES: tuple[str, ...] = ('draft', 'reviewed', 'retired')

# A librarian submits or returns a profile for review; an administrator reviews or retires it.
REVIEW_DECISIONS: tuple[str, ...] = ('review', 'retire', 'return_to_draft')

# A Result check returns exactly one of two verdicts. There is no "probably fine".
CHECK_VERDICTS: tuple[str, ...] = ('accept', 'fix')

# The closed criteria a check may judge. A check that names anything else is refused.
CHECK_CRITERIA: tuple[str, ...] = (
    'shot_objective', 'subject_identity', 'continuity', 'composition', 'lighting', 'camera_movement',
    'environment', 'wardrobe', 'props', 'performance', 'timing', 'reference_relationship',
)

CRITERION_SEVERITIES: tuple[str, ...] = ('material', 'info')


class ToolProfileSaveRequest(BaseModel):
    """A documented capability profile for one external tool.

    `payload` is passed to the database, which validates every field it documents. The surface only
    insists that it is a JSON object and that the tool key is the closed shape the schema requires.
    """

    model_config = ConfigDict(extra='ignore')
    tool_key: str = Field(min_length=2, max_length=60, pattern=r'^[a-z][a-z0-9_]*$')
    payload: dict[str, Any] = Field(default_factory=dict)


class ToolProfileReviewRequest(BaseModel):
    """A review decision on a tool profile. Only an administrator may make one."""

    model_config = ConfigDict(extra='ignore')
    decision: str
    note: str = Field(default='', max_length=1000)


class ProductionToolSetRequest(BaseModel):
    """Name an external tool in this Production's kit, or remove it.

    A kit entry needs no credential: TONDE adapts its direction to the tool and never calls it.
    """

    model_config = ConfigDict(extra='ignore')
    tool_key: str = Field(min_length=2, max_length=60, pattern=r'^[a-z][a-z0-9_]*$')
    display_name: str | None = Field(default=None, max_length=120)
    tool_profile_id: str | None = None
    note: str = Field(default='', max_length=1000)
    remove: bool = False
    sort_order: int | None = Field(default=None, ge=0, le=1000)


class PlaybookPromptRequest(BaseModel):
    """Compile the prompt for the chosen tool against the Shot's current AI plan revision."""

    model_config = ConfigDict(extra='ignore')
    tool_key: str | None = Field(default=None, max_length=60)
    expected_plan_revision: int | None = Field(default=None, ge=1)


class ResultCheckRequest(BaseModel):
    """The creator's judgement of an uploaded Result, criterion by criterion.

    `verdict` distinguishes the two honest outcomes: the Result satisfies every criterion the check
    judged, or it needs a correction described in `instructions`.
    """

    model_config = ConfigDict(extra='ignore')
    verdict: str
    criteria: list[dict[str, Any]] = Field(default_factory=list)
    instructions: str | None = Field(default=None, max_length=4000)
    findings: list[Any] = Field(default_factory=list)
    recommendations: list[Any] = Field(default_factory=list)
    prompt_text: str | None = Field(default=None, max_length=20000)
    tool_key: str | None = Field(default=None, max_length=60)
