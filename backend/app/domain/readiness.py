"""Prompt 9E approval, lock and readiness request contracts.

Approval and readiness are product decisions with a fixed vocabulary, not free-form writes. These
contracts bound what a caller may ask for and turn a product-rule mistake into a clean 422 before
the database sees it. The database stays authoritative: `guard_human_acceptance` refuses an
approval that no authenticated creator made, revisions are validated for staleness, and readiness
is derived from real state in migration 023.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

ACCESS_ACTIONS = ('approve', 'request_review', 'reopen', 'lock', 'unlock')
APPROVAL_DECISIONS = ('approve', 'request_review', 'reopen')
READINESS_STATES = ('ready', 'ready_with_warnings', 'needs_review', 'blocked', 'unknown')
READINESS_DIMENSIONS = ('decisions', 'story', 'script', 'scene_plan', 'shots', 'continuity',
    'resources', 'real_execution', 'ai_execution', 'approvals', 'dependencies', 'results', 'delivery')
READINESS_SEVERITIES = ('blocking', 'review', 'warning')

# Only kinds that actually carry approval and lock columns may be decided through this surface.
REVIEWABLE_KINDS = ('production', 'act', 'sequence', 'scene', 'shot', 'execution_plan',
    'dialogue_line', 'creative_document', 'result')


class ApprovalDecideRequest(BaseModel):
    """A creator decision on one revision: approve it, request a review, or reopen it."""

    model_config = ConfigDict(extra='forbid')

    decision: str = Field(min_length=1, max_length=20)
    expected_revision: int | None = Field(default=None, ge=1)
    note: str = Field(default='', max_length=800)

    @model_validator(mode='after')
    def decision_is_supported(self) -> 'ApprovalDecideRequest':
        if self.decision not in APPROVAL_DECISIONS:
            raise ValueError('A review decision is approve, request_review or reopen.')
        return self


class LockRequest(BaseModel):
    """Lock an object to protect a decision, or unlock it deliberately with a reason."""

    model_config = ConfigDict(extra='forbid')

    locked: bool
    expected_revision: int | None = Field(default=None, ge=1)
    note: str = Field(default='', max_length=800)

    @model_validator(mode='after')
    def unlock_carries_a_reason(self) -> 'LockRequest':
        if not self.locked and not self.note.strip():
            raise ValueError('Record why you are unlocking this object.')
        return self
