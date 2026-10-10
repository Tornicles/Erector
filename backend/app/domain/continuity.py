"""Prompt 9B continuity request contracts.

A continuity statement is a bounded declaration: one trait of one subject at one point in
Production order. Everything here is validated before it reaches a guarded RPC, so a malformed
request is rejected by the application rather than by the database.

Two rules are enforced by the shape of this module:

* A declared change is a creator statement, so the creator's own declarations do not have to
  cite evidence - but nothing here can claim an *observation* it cannot support.
* An inferred continuity proposal is an estimate or a recommendation. ``OBSERVED`` is absent
  from the proposal vocabulary on purpose: a proposal may not present itself as a fact.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

# The traits continuity actually tracks. Sourced from the Product Constitution: wardrobe, props,
# vehicles, injuries, hair/makeup, weather, time of day, environment, lighting, story and
# dialogue knowledge, screen direction, eyelines, camera geography, physical position and
# start/end state.
DOMAINS = ('character', 'wardrobe', 'prop', 'product', 'vehicle', 'injury', 'hair_makeup', 'weather',
    'time_of_day', 'environment', 'lighting', 'story_knowledge', 'dialogue_fact', 'screen_direction',
    'eyeline', 'camera_geography', 'position', 'product_condition', 'other')

# Where a statement sits in the timeline. A Scene's opening state sorts before its Shots and its
# ending state sorts after them.
ANCHORS = ('production', 'scene_opening', 'scene_ending', 'shot')

# baseline   - the first statement of a trait
# continuous - asserts the trait is unchanged
# changed    - declares a change, and a change should say why
TRANSITIONS = ('baseline', 'continuous', 'changed')

# Who wrote the statement. `inferred` is a proposal and is always surfaced as one.
ORIGINS = ('declared', 'derived', 'inferred')

EPISTEMICS = ('observed', 'estimated', 'recommended', 'unknown')
CONFIDENCES = ('high', 'medium', 'low')

# The deterministic checks. Each rule compares recorded declarations and nothing else.
FINDING_KINDS = ('unexplained_change', 'boundary_break', 'missing_reason', 'lock_conflict', 'unverified_after')

SEVERITIES = ('info', 'warning', 'critical')
FINDING_STATES = ('open', 'acknowledged', 'resolved', 'waived')

# A proposal may be an estimate, a recommendation, or an honest unknown. Never an observation.
PROPOSAL_EPISTEMICS = ('estimated', 'recommended', 'unknown')


class ContinuityStateRequest(BaseModel):
    """Record the creator's current statement for one trait at one point."""

    domain: str
    trait: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=400)
    anchor: str = 'production'
    subject_object_id: str | None = None
    scene_id: str | None = None
    shot_id: str | None = None
    transition: str = 'baseline'
    epistemic: str = 'observed'
    confidence: str = 'high'
    reason: str = Field(default='', max_length=600)
    evidence: list[Any] = Field(default_factory=list, max_length=16)
    note: str = Field(default='', max_length=400)

    @field_validator('domain')
    @classmethod
    def _domain(cls, value: str) -> str:
        if value not in DOMAINS:
            raise ValueError('Unsupported continuity domain.')
        return value

    @field_validator('anchor')
    @classmethod
    def _anchor(cls, value: str) -> str:
        if value not in ANCHORS:
            raise ValueError('Unsupported continuity anchor.')
        return value

    @field_validator('transition')
    @classmethod
    def _transition(cls, value: str) -> str:
        if value not in TRANSITIONS:
            raise ValueError('Unsupported continuity transition.')
        return value

    @field_validator('epistemic')
    @classmethod
    def _epistemic(cls, value: str) -> str:
        if value not in EPISTEMICS:
            raise ValueError('Unsupported epistemic status.')
        return value

    @field_validator('confidence')
    @classmethod
    def _confidence(cls, value: str) -> str:
        if value not in CONFIDENCES:
            raise ValueError('Unsupported confidence.')
        return value

    @field_validator('trait', 'value')
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('This field cannot be blank.')
        return value.strip()

    def anchor_is_coherent(self) -> bool:
        """A Shot statement names a Shot; a Scene statement names a Scene; the rest name neither."""

        if self.anchor == 'shot':
            return bool(self.shot_id)
        if self.anchor in ('scene_opening', 'scene_ending'):
            return bool(self.scene_id)
        return not self.scene_id and not self.shot_id


class ContinuityRetireRequest(BaseModel):
    """Retire a statement without replacing it. The record stays readable."""

    reason: str = Field(default='', max_length=400)


class ContinuityCheckRequest(BaseModel):
    """A check records its own analysis; it never rewrites a statement."""

    note: str = Field(default='', max_length=400)


class ContinuityFindingUpdateRequest(BaseModel):
    """A creator decision about a finding. There is no `approved` finding state."""

    state: str
    note: str = Field(default='', max_length=800)

    @field_validator('state')
    @classmethod
    def _state(cls, value: str) -> str:
        if value not in FINDING_STATES:
            raise ValueError('Unsupported finding state.')
        return value


class ContinuityProposalRequest(BaseModel):
    """Record an inferred continuity proposal with its basis and its uncertainty."""

    kind: str = 'unexplained_change'
    domain: str = 'other'
    severity: str = 'info'
    trait: str = Field(default='', max_length=120)
    subject_object_id: str | None = None
    scene_id: str | None = None
    shot_id: str | None = None
    explanation: str = Field(min_length=1, max_length=1200)
    suggested_resolution: str = Field(default='', max_length=1200)
    rationale: str = Field(min_length=1, max_length=1200)
    epistemic: str = 'estimated'
    confidence: str = 'low'
    # A proposal that discloses no basis is refused here, so the failure is a clear 422 rather
    # than a database rule violation later.
    evidence: list[Any] = Field(min_length=1, max_length=16)

    @field_validator('kind')
    @classmethod
    def _kind(cls, value: str) -> str:
        if value not in FINDING_KINDS:
            raise ValueError('Unsupported continuity finding kind.')
        return value

    @field_validator('domain')
    @classmethod
    def _domain(cls, value: str) -> str:
        if value not in DOMAINS:
            raise ValueError('Unsupported continuity domain.')
        return value

    @field_validator('severity')
    @classmethod
    def _severity(cls, value: str) -> str:
        if value not in SEVERITIES:
            raise ValueError('Unsupported severity.')
        return value

    @field_validator('epistemic')
    @classmethod
    def _epistemic(cls, value: str) -> str:
        if value not in PROPOSAL_EPISTEMICS:
            raise ValueError('A proposal cannot claim an observation.')
        return value

    @field_validator('confidence')
    @classmethod
    def _confidence(cls, value: str) -> str:
        if value not in CONFIDENCES:
            raise ValueError('Unsupported confidence.')
        return value
