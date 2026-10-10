"""Prompt 9A dependency, impact and stale-artifact request contracts.

Every value here is bounded and validated before it reaches a guarded RPC, so a malformed
request is rejected by the application rather than by the database. Nothing in this module
infers a creative relationship: an ``inferred`` edge is written explicitly by a caller that
supplies its own rationale and confidence, and it is always reported as a *potential*
dependency, never as canonical certainty.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

# Canonical dependency relations. One direction only: the SOURCE is relied upon and the
# TARGET depends on it.
RELATIONS = ('creative', 'continuity', 'execution', 'reference', 'derived_from', 'runtime', 'asset', 'result', 'state')

# hard   - the target cannot be correct without the source
# soft   - the target is affected but can still hold
# advisory - worth knowing, never blocking
STRENGTHS = ('hard', 'soft', 'advisory')

# explicit - a creator declared it
# derived  - the database computed it from real Production state
# inferred - a proposal that carries its own rationale and confidence
ORIGINS = ('explicit', 'derived', 'inferred')

# The three constitutional propagation choices. There is no fourth, and there is no
# "apply everything silently" mode.
IMPACT_MODES = ('update_all', 'review_changes', 'change_only_this')

ARTIFACT_KINDS = ('real_plan', 'ai_plan', 'prompt', 'first_frame', 'last_frame', 'generation_context',
    'result_comparison', 'derived_summary', 'continuity_state', 'continuity_analysis', 'deliverable',
    'dependent_object', 'other')

STALE_STATES = ('current', 'stale', 'conflicted')
DIRECTIONS = ('forward', 'reverse')


class DependencyEdgeRequest(BaseModel):
    """Declare one dependency. A self-edge is rejected here and again in the database."""

    source_object_id: str
    target_object_id: str
    relation: str
    strength: str = 'soft'
    origin: str = 'explicit'
    reason: str = Field(default='', max_length=600)
    affected_fields: list[str] = Field(default_factory=list, max_length=40)
    evidence: dict[str, Any] = Field(default_factory=dict)

    @field_validator('relation')
    @classmethod
    def _relation(cls, value: str) -> str:
        if value not in RELATIONS:
            raise ValueError('Unsupported dependency relation.')
        return value

    @field_validator('strength')
    @classmethod
    def _strength(cls, value: str) -> str:
        if value not in STRENGTHS:
            raise ValueError('Unsupported dependency strength.')
        return value

    @field_validator('origin')
    @classmethod
    def _origin(cls, value: str) -> str:
        if value not in ORIGINS:
            raise ValueError('Unsupported dependency origin.')
        return value

    @field_validator('affected_fields')
    @classmethod
    def _fields(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            text = str(item).strip()
            if text and text not in cleaned:
                cleaned.append(text[:80])
        return cleaned


class DependencyActiveRequest(BaseModel):
    """Activate or deactivate edges. Deactivation keeps the relationship as readable history."""

    edge_ids: list[str] = Field(min_length=1, max_length=400)
    active: bool
    note: str = Field(default='', max_length=400)


class ImpactPreviewRequest(BaseModel):
    """Compute the downstream impact of one object. Computing never changes anything."""

    object_id: str
    depth: int = Field(default=2, ge=1, le=8)
    limit: int = Field(default=200, ge=1, le=500)


class ImpactApplyRequest(BaseModel):
    """Apply a previewed impact using one of the three creator decisions.

    ``confirm`` is the creator's explicit authority: a preview id alone is not consent, so an
    unconfirmed apply is refused by the route rather than performed.
    """

    analysis_id: str
    mode: str
    selected_ids: list[str] = Field(default_factory=list, max_length=500)
    expected_root_revision: int | None = Field(default=None, ge=1)
    note: str = Field(default='', max_length=400)
    confirm: bool = False

    @field_validator('mode')
    @classmethod
    def _mode(cls, value: str) -> str:
        if value not in IMPACT_MODES:
            raise ValueError('Unsupported impact mode.')
        return value

    @field_validator('selected_ids')
    @classmethod
    def _selected(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for item in value:
            text = str(item).strip()
            if text and text not in seen:
                seen.append(text)
        return seen

    def review_selection_is_present(self) -> bool:
        """REVIEW CHANGES means the creator picked what changes, so an empty selection is invalid."""

        return self.mode != 'review_changes' or bool(self.selected_ids)


class StaleMarkRequest(BaseModel):
    """Record that an artifact may no longer match its source. Nothing is rewritten."""

    object_id: str
    artifact_kind: str
    reason: str = Field(min_length=1, max_length=600)
    reference: str | None = None

    @field_validator('artifact_kind')
    @classmethod
    def _kind(cls, value: str) -> str:
        if value not in ARTIFACT_KINDS:
            raise ValueError('Unsupported artifact kind.')
        return value

    @field_validator('reason')
    @classmethod
    def _reason(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError('A stale marker needs a real reason.')
        return stripped

    @field_validator('reference')
    @classmethod
    def _reference(cls, value: str | None) -> str | None:
        if value is None or not str(value).strip():
            return None
        return value


class StaleResolveRequest(BaseModel):
    """Resolve one artifact marker. The historical marker stays readable."""

    note: str = Field(default='', max_length=400)
