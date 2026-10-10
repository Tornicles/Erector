"""Prompt 9D version, branch and merge request contracts.

Versioning is practical creative history, not a database git clone. These contracts bound what a
caller may ask for and reject a product-rule mistake as a clean 422 before the database sees it. The
database stays authoritative: which fields a branch change may set, whether an object is writable at
all, whether a merge is clean or conflicted and whether an apply is stale are all decided in
migration 022.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

BRANCH_STATES = ('open', 'merged', 'abandoned')
BRANCH_CHANGE_STATES = ('pending', 'applied', 'conflicted', 'rejected')
MERGE_STATES = ('proposed', 'merged', 'rejected')
BRANCH_SCOPES = ('story', 'script', 'act', 'sequence', 'scene', 'shot', 'execution_plan', 'asset')
PROPAGATION_MODES = ('update_all', 'review_changes', 'change_only_this')
MERGE_DECISIONS = ('merge', 'reject')
SOURCE_ACTIONS = ('insert', 'update', 'delete', 'restore', 'merge')

# The fields a branch change may set, by object kind. This mirrors the database whitelist so the
# surface can explain a refusal instead of letting an unsupported field reach the write.
WRITABLE_FIELDS: dict[str, tuple[str, ...]] = {
    'creative_document': ('title', 'content'),
    'scene': ('title', 'description', 'purpose', 'planned_duration_ms'),
    'shot': ('title', 'description', 'action', 'purpose', 'subject', 'planned_duration_ms'),
    'execution_plan': ('shot_size', 'movement', 'framing', 'composition', 'camera_position',
        'camera_height', 'camera_angle', 'lighting_intent', 'plan_metadata'),
    'asset': ('name', 'description', 'search_metadata', 'consistency_metadata'),
}

BRANCHABLE_KINDS = tuple(WRITABLE_FIELDS)


class VersionRestoreRequest(BaseModel):
    """Restore an older version as a new current revision. It never rewinds history."""

    model_config = ConfigDict(extra='forbid')

    note: str = Field(default='', max_length=400)


class BranchCreateRequest(BaseModel):
    """Create a named alternative anchored at a known version of a scope object."""

    model_config = ConfigDict(extra='forbid')

    scope_object_id: str = Field(min_length=1, max_length=64)
    scope: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=160)
    source_version_id: str | None = Field(default=None, max_length=64)
    reason: str = Field(default='', max_length=600)

    @model_validator(mode='after')
    def scope_is_supported(self) -> 'BranchCreateRequest':
        if self.scope not in BRANCH_SCOPES:
            raise ValueError('Unsupported branch scope.')
        if not self.name.strip():
            raise ValueError('A branch needs a name.')
        return self


class BranchChangeRequest(BaseModel):
    """A proposed field patch on a branch. It changes nothing until an accepted merge."""

    model_config = ConfigDict(extra='forbid')

    target_object_id: str = Field(min_length=1, max_length=64)
    patch: dict[str, Any] = Field(default_factory=dict)
    note: str = Field(default='', max_length=600)

    @model_validator(mode='after')
    def patch_is_real(self) -> 'BranchChangeRequest':
        if not self.patch:
            raise ValueError('Provide at least one field to change.')
        if any(value is not None and not isinstance(value, (str, int, float, bool, dict, list))
            for value in self.patch.values()):
            raise ValueError('A branch change patch holds plain values.')
        return self


class BranchChangeClearRequest(BaseModel):
    """Discard a proposed change. It stays readable as branch history."""

    model_config = ConfigDict(extra='forbid')

    note: str = Field(default='', max_length=600)


class BranchStateRequest(BaseModel):
    """Open or abandon a branch. Merging happens only through a merge decision."""

    model_config = ConfigDict(extra='forbid')

    state: str = Field(min_length=1, max_length=20)
    note: str = Field(default='', max_length=600)

    @model_validator(mode='after')
    def state_is_decidable_here(self) -> 'BranchStateRequest':
        if self.state not in ('open', 'abandoned'):
            raise ValueError('A branch is opened or abandoned here; merging is a merge decision.')
        return self


class MergeDecideRequest(BaseModel):
    """Decide a merge proposal. Conflicted changes are never applied automatically."""

    model_config = ConfigDict(extra='forbid')

    decision: str = Field(min_length=1, max_length=20)
    selected_change_ids: list[str] = Field(default_factory=list)
    propagation: str = Field(default='change_only_this', max_length=40)
    note: str = Field(default='', max_length=800)

    @model_validator(mode='after')
    def decision_is_supported(self) -> 'MergeDecideRequest':
        if self.decision not in MERGE_DECISIONS:
            raise ValueError('A merge decision is merge or reject.')
        if self.propagation not in PROPAGATION_MODES:
            raise ValueError('Unsupported propagation mode.')
        if len(self.selected_change_ids) > 200:
            raise ValueError('Select at most 200 changes.')
        return self
