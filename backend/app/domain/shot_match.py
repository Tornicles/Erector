"""Prompt 9F Result and Shot Match request contracts.

These contracts bound what a caller may ask for and turn a product mistake into a clean 422 before
the database sees it. The database stays authoritative for everything that is a fact: which
modalities were verified from real media rows, whether a Plan's field may be corrected, whether a
transition is legal, whether an object is locked, and whether a correction has been confirmed by a
later analysis.

Two rules are enforced here as well as in SQL, because they are product rules and not preferences:

* a Shot Match finding carries a real epistemic state (observed / estimated / recommended /
  unknown) and a confidence, and an observed difference must cite the evidence it was seen on;
* a correction explains its root cause instead of only naming a mismatch.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RESULT_ORIGINS = ('real_take', 'ai_generation', 'hybrid', 'manual_import')
RESULT_STATES = ('raw', 'needs_review', 'approved', 'rejected', 'final')
MATCH_VERDICTS = ('matches_intent', 'acceptable_variation', 'needs_attention', 'mismatch', 'unknown')
EPISTEMIC_STATES = ('observed', 'estimated', 'recommended', 'unknown')
CONFIDENCES = ('high', 'medium', 'low')
SEVERITIES = ('info', 'warning', 'critical')
MATCH_DECISIONS = ('pickup', 'regeneration', 'accepted', 'dismiss')
CORRECTION_STATES = ('proposed', 'applied', 'rejected')
CORRECTION_RECOMMENDATIONS = ('none', 'pickup_required', 'regeneration_recommended', 'both')
MATCH_ORIGINS = ('deterministic', 'creator', 'ai_proposal')
PROPAGATION_MODES = ('update_all', 'review_changes', 'change_only_this')

# The continuity domains a finding may raise an issue in. Kept in step with tonde.continuity_domain.
CONTINUITY_DOMAINS = ('character', 'wardrobe', 'prop', 'product', 'vehicle', 'injury', 'hair_makeup',
    'weather', 'time_of_day', 'environment', 'lighting', 'story_knowledge', 'dialogue_fact',
    'screen_direction', 'eyeline', 'camera_geography', 'position', 'product_condition', 'other')


class ResultRegisterRequest(BaseModel):
    """Register what was actually created, with the Take, Attempt or media it came from."""

    model_config = ConfigDict(extra='forbid')

    shot_id: str = Field(min_length=1)
    origin: str = Field(default='manual_import', max_length=20)
    take_id: str | None = None
    attempt_id: str | None = None
    media_id: str | None = None
    execution_plan_id: str | None = None
    reference_id: str | None = None
    note: str = Field(default='', max_length=600)

    @model_validator(mode='after')
    def a_result_names_where_it_came_from(self) -> 'ResultRegisterRequest':
        if self.origin not in RESULT_ORIGINS:
            raise ValueError('A Result comes from a Real Take, an AI Attempt, a Hybrid process or a manual import.')
        if self.origin == 'real_take' and not self.take_id:
            raise ValueError('A Real Take Result must name the Take it came from.')
        if self.origin == 'ai_generation' and not (self.attempt_id or self.media_id):
            raise ValueError('An AI Result must name its Attempt or its media.')
        return self


class ResultStateRequest(BaseModel):
    """Move a Result through its review states. Final is always an explicit creator decision."""

    model_config = ConfigDict(extra='forbid')

    state: str = Field(min_length=1, max_length=20)
    expected_revision: int | None = Field(default=None, ge=1)
    note: str = Field(default='', max_length=800)

    @model_validator(mode='after')
    def state_is_canonical(self) -> 'ResultStateRequest':
        if self.state not in RESULT_STATES:
            raise ValueError('A Result is raw, needs review, approved, rejected or final.')
        return self


class MatchFinding(BaseModel):
    """One compared dimension. Never a score: a verdict, an epistemic state and its evidence."""

    model_config = ConfigDict(extra='forbid')

    category: str = Field(min_length=1, max_length=60)
    expected: str = Field(default='', max_length=600)
    observed: str = Field(default='', max_length=600)
    difference: str = Field(default='', max_length=600)
    epistemic: str = Field(default='observed', max_length=20)
    confidence: str = Field(default='medium', max_length=20)
    severity: str = Field(default='info', max_length=20)
    verdict: str | None = Field(default=None, max_length=30)
    evidence: list[str] = Field(default_factory=list, max_length=40)
    suggested_correction: str = Field(default='', max_length=600)
    continuity_domain: str | None = Field(default=None, max_length=40)
    subject_asset_id: str | None = None
    region: str = Field(default='', max_length=120)
    time_range: str = Field(default='', max_length=120)

    @field_validator('evidence')
    @classmethod
    def evidence_is_quoted(cls, value: list[str]) -> list[str]:
        cleaned = [str(item)[:120] for item in value if str(item).strip()]
        return cleaned

    @model_validator(mode='after')
    def the_finding_keeps_the_evidence_discipline(self) -> 'MatchFinding':
        if self.epistemic not in EPISTEMIC_STATES:
            raise ValueError('A finding carries a real epistemic state: observed, estimated, recommended or unknown.')
        if self.confidence not in CONFIDENCES:
            raise ValueError('A finding carries a confidence of high, medium or low.')
        if self.severity not in SEVERITIES:
            raise ValueError('A finding severity is info, warning or critical.')
        if self.verdict is not None and self.verdict not in MATCH_VERDICTS:
            raise ValueError('A match verdict is matches_intent, acceptable_variation, needs_attention, mismatch or unknown.')
        if self.epistemic == 'observed' and not self.evidence:
            raise ValueError('An observed difference must cite the evidence it was seen on.')
        if self.continuity_domain and self.continuity_domain not in CONTINUITY_DOMAINS:
            raise ValueError('That continuity domain is not part of the production vocabulary.')
        return self


class MatchAnalyzeRequest(BaseModel):
    """Record an analysis of what is different between the Plan, the Reference and the Result."""

    model_config = ConfigDict(extra='forbid')

    result_id: str = Field(min_length=1)
    origin: str = Field(default='deterministic', max_length=20)
    reference_id: str | None = None
    findings: list[MatchFinding] = Field(min_length=1, max_length=60)
    capabilities: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode='after')
    def the_analysis_is_honest_about_itself(self) -> 'MatchAnalyzeRequest':
        if self.origin not in MATCH_ORIGINS:
            raise ValueError('An analysis origin is deterministic, creator or ai_proposal.')
        claimed = {key: value for key, value in self.capabilities.items() if value}
        unsupported = [key for key in claimed if key not in ('thumbnail', 'image', 'video_frames', 'audio', 'text')]
        if unsupported:
            raise ValueError('A modality is metadata, thumbnail, image, video frames, audio or text.')
        return self


class MatchDecideRequest(BaseModel):
    """The creator's decision on an analysis. It is not an approval of the Result."""

    model_config = ConfigDict(extra='forbid')

    decision: str = Field(min_length=1, max_length=20)
    note: str = Field(default='', max_length=800)

    @model_validator(mode='after')
    def decision_is_supported(self) -> 'MatchDecideRequest':
        if self.decision not in MATCH_DECISIONS:
            raise ValueError('A Shot Match decision is pickup, regeneration, accepted or dismiss.')
        return self


class CorrectionProposeRequest(BaseModel):
    """FIX THIS SHOT: a scoped correction on one object, with its cause and its affected scope."""

    model_config = ConfigDict(extra='forbid')

    target_object_id: str = Field(min_length=1)
    patch: dict[str, Any] = Field(min_length=1)
    root_cause: str = Field(min_length=1, max_length=800)
    why: str = Field(default='', max_length=800)
    affected: str = Field(default='', max_length=400)
    recommendation: str | None = Field(default=None, max_length=40)
    continuity_finding_id: str | None = None

    @model_validator(mode='after')
    def the_correction_explains_itself(self) -> 'CorrectionProposeRequest':
        if len(self.root_cause.strip()) < 12:
            raise ValueError('Explain the production cause, not only which dimension differs.')
        if self.recommendation is not None and self.recommendation not in CORRECTION_RECOMMENDATIONS:
            raise ValueError('A recommendation is none, pickup_required, regeneration_recommended or both.')
        return self


class CorrectionApplyRequest(BaseModel):
    """Apply a proposed correction. The impact was previewed; applying creates a new revision."""

    model_config = ConfigDict(extra='forbid')

    expected_revision: int | None = Field(default=None, ge=1)
    propagation: str = Field(default='change_only_this', max_length=30)
    note: str = Field(default='', max_length=800)
    record_candidate: bool = False

    @model_validator(mode='after')
    def propagation_is_supported(self) -> 'CorrectionApplyRequest':
        if self.propagation not in PROPAGATION_MODES:
            raise ValueError('A propagation mode is update_all, review_changes or change_only_this.')
        return self


class CorrectionRejectRequest(BaseModel):
    """Reject a proposed correction. Nothing changes and nothing is overwritten."""

    model_config = ConfigDict(extra='forbid')

    note: str = Field(default='', max_length=800)
