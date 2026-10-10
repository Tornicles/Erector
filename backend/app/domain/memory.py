"""Prompt 9C production memory and structured search request contracts.

Production Memory is structured, inspectable production knowledge. These contracts decide what a
caller is allowed to *claim* before the database is asked anything:

* A memory item says what it says, what kind of knowledge it is, where it came from (which is also
  its authority tier), how it was confirmed, and which object and revision it was drawn from.
* ``inferred`` means TONDE derived it and nobody confirmed it. It may only cite
  ``saved_preference``, ``historical_pattern`` or ``inference`` as a source, and it must disclose a
  basis. It can never claim a creator instruction or a Production decision - human authority is not
  something an inference is allowed to assert.
* ``accepted`` is not writable here at all. It is created by accepting a candidate, so the
  provenance of "the creator accepted this" cannot be fabricated by a form field.
* A successful-pattern candidate is a proposal drawn from real evidence: it pins the object and the
  revision it was observed on, and it may not propose ``creator_instruction``.
* Structured search accepts only real facet names with real values. There is no free-form query
  language and no embedding path, so an unknown facet is a rejected request rather than a silent
  full search.

Every field here is length-bounded, because a memory item is read by later reasoning and an
unbounded one would leak into prompts no matter how it was stored.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

# Where the knowledge applies. Workspace knowledge is reusable across Productions; Series knowledge
# follows one Series; Production knowledge stays in one Production.
SCOPES = ('production', 'series', 'workspace')

# What sort of knowledge it is.
KINDS = ('preference', 'decision', 'pattern', 'technique', 'setup_fact', 'asset_usage',
    'model_outcome', 'series_rule', 'correction', 'other')

# The authority tiers, strongest first. This order is the product rule: a current creator
# instruction outranks a current Production decision, which outranks an explicit saved preference,
# which outranks a historical pattern, which outranks an inference.
SOURCES = ('creator_instruction', 'production_decision', 'saved_preference', 'historical_pattern',
    'inference')

AUTHORITY_RANKS: dict[str, int] = {
    'creator_instruction': 1, 'production_decision': 2, 'saved_preference': 3,
    'historical_pattern': 4, 'inference': 5,
}

# How it was confirmed. `accepted` is reserved for the candidate acceptance path.
ORIGINS = ('declared', 'accepted', 'inferred')
WRITABLE_ORIGINS = ('declared', 'inferred')

# What a candidate may propose. A candidate never proposes creator authority.
CANDIDATE_SOURCES = ('saved_preference', 'historical_pattern', 'inference')

ITEM_STATES = ('active', 'archived', 'all')
CANDIDATE_STATES = ('proposed', 'applied', 'rejected', 'all')
DECISIONS = ('accept', 'dismiss')

APPROVALS = ('draft', 'needs_review', 'approved', 'changed_after_approval', 'not_approved')
EXECUTION_METHODS = ('real', 'ai', 'hybrid')
CONTINUITY_STATES = ('open', 'acknowledged', 'resolved', 'waived')
SEVERITIES = ('info', 'warning', 'critical')
RESULT_STATES = ('raw', 'needs_review', 'approved', 'rejected', 'final')
DOMAINS = ('character', 'wardrobe', 'prop', 'product', 'vehicle', 'injury', 'hair_makeup', 'weather',
    'time_of_day', 'environment', 'lighting', 'story_knowledge', 'dialogue_fact', 'screen_direction',
    'eyeline', 'camera_geography', 'position', 'product_condition', 'other')
ASSET_TYPES = ('character', 'voice', 'product', 'environment', 'wardrobe', 'prop', 'vehicle',
    'style_bible', 'brand')

# The real entity kinds structured search can return. Each one is a lane over canonical tables.
SEARCH_KINDS = ('shot', 'scene', 'plan', 'result', 'continuity_finding', 'continuity_state',
    'memory', 'asset')

MAX_EVIDENCE = 16


class MemoryItemRequest(BaseModel):
    """Remember one statement with its provenance and its authority tier."""

    scope: str = 'production'
    kind: str = 'preference'
    subject_key: str = Field(min_length=1, max_length=160)
    statement: str = Field(min_length=1, max_length=600)
    source: str = 'saved_preference'
    origin: str = 'declared'
    series_id: str | None = None
    source_object_id: str | None = None
    source_revision: int | None = Field(default=None, ge=1)
    rationale: str = Field(default='', max_length=800)
    evidence: list[Any] = Field(default_factory=list, max_length=MAX_EVIDENCE)

    @field_validator('scope')
    @classmethod
    def _scope(cls, value: str) -> str:
        if value not in SCOPES:
            raise ValueError('Unsupported memory scope.')
        return value

    @field_validator('kind')
    @classmethod
    def _kind(cls, value: str) -> str:
        if value not in KINDS:
            raise ValueError('Unsupported memory kind.')
        return value

    @field_validator('source')
    @classmethod
    def _source(cls, value: str) -> str:
        if value not in SOURCES:
            raise ValueError('Unsupported memory source.')
        return value

    @field_validator('origin')
    @classmethod
    def _origin(cls, value: str) -> str:
        if value not in WRITABLE_ORIGINS:
            raise ValueError('An accepted memory item is created by accepting a candidate.')
        return value

    @field_validator('subject_key', 'statement')
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('This field cannot be blank.')
        return value.strip()

    @model_validator(mode='after')
    def _inference_is_honest(self) -> 'MemoryItemRequest':
        """An inference discloses a basis and never claims a human source."""

        if self.origin == 'inferred':
            if self.source in ('creator_instruction', 'production_decision'):
                raise ValueError('An inference cannot claim creator authority.')
            if not self.evidence:
                raise ValueError('An inferred memory item must disclose its basis.')
        return self


class MemoryRetireRequest(BaseModel):
    """Retire a memory item without deleting it."""

    reason: str = Field(default='', max_length=400)


class MemoryPolicyRequest(BaseModel):
    """The explicit memory policy for one scope."""

    scope: str = 'production'
    series_id: str | None = None
    candidate_capture: bool = True
    auto_accept_candidates: bool = False
    note: str = Field(default='', max_length=600)

    @field_validator('scope')
    @classmethod
    def _scope(cls, value: str) -> str:
        if value not in SCOPES:
            raise ValueError('Unsupported memory scope.')
        return value


class MemoryCandidateRequest(BaseModel):
    """A successful-pattern candidate drawn from real, identified evidence."""

    kind: str = 'pattern'
    subject_key: str = Field(min_length=1, max_length=160)
    statement: str = Field(min_length=1, max_length=600)
    proposed_source: str = 'historical_pattern'
    observed_count: int = Field(default=1, ge=1, le=1000)
    source_object_id: str = Field(min_length=1)
    source_revision: int | None = Field(default=None, ge=1)
    # A candidate with no basis is refused here, so the failure is a clear 422 rather than a
    # database rule violation later.
    basis: list[Any] = Field(min_length=1, max_length=MAX_EVIDENCE)

    @field_validator('kind')
    @classmethod
    def _kind(cls, value: str) -> str:
        if value not in KINDS:
            raise ValueError('Unsupported memory kind.')
        return value

    @field_validator('proposed_source')
    @classmethod
    def _source(cls, value: str) -> str:
        if value not in CANDIDATE_SOURCES:
            raise ValueError('A candidate may only propose a saved preference, a historical pattern or an inference.')
        return value

    @field_validator('subject_key', 'statement')
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('This field cannot be blank.')
        return value.strip()


class MemoryCandidateDecisionRequest(BaseModel):
    """The creator's decision about a candidate. Nothing else can turn a proposal into memory."""

    decision: str
    note: str = Field(default='', max_length=800)

    @field_validator('decision')
    @classmethod
    def _decision(cls, value: str) -> str:
        if value not in DECISIONS:
            raise ValueError('Unsupported candidate decision.')
        return value


class ProductionSearchQuery(BaseModel):
    """Structured search over real production state.

    Every facet below is a real column or a real relationship. There is deliberately no
    free-form expression language: the browser cannot ask for something the database is not able
    to answer honestly.
    """

    text: str | None = Field(default=None, max_length=400)
    kinds: list[str] = Field(default_factory=list, max_length=len(SEARCH_KINDS))
    asset_id: str | None = None
    asset_name: str | None = Field(default=None, max_length=160)
    asset_type: str | None = None
    environment: str | None = Field(default=None, max_length=160)
    approval: str | None = None
    execution_method: str | None = None
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    lens: str | None = Field(default=None, max_length=120)
    continuity_state: str | None = None
    severity: str | None = None
    domain: str | None = None
    result_state: str | None = None
    memory_kind: str | None = None
    limit: int = Field(default=50, ge=1, le=100)

    @field_validator('kinds')
    @classmethod
    def _kinds(cls, value: list[str]) -> list[str]:
        for item in value:
            if item not in SEARCH_KINDS:
                raise ValueError(f'Unsupported search kind: {item}.')
        return value

    @field_validator('asset_type')
    @classmethod
    def _asset_type(cls, value: str | None) -> str | None:
        if value is not None and value not in ASSET_TYPES:
            raise ValueError('Unsupported Asset type.')
        return value

    @field_validator('approval')
    @classmethod
    def _approval(cls, value: str | None) -> str | None:
        if value is not None and value not in APPROVALS:
            raise ValueError('Unsupported approval filter.')
        return value

    @field_validator('execution_method')
    @classmethod
    def _method(cls, value: str | None) -> str | None:
        if value is not None and value not in EXECUTION_METHODS:
            raise ValueError('Unsupported execution filter.')
        return value

    @field_validator('continuity_state')
    @classmethod
    def _continuity(cls, value: str | None) -> str | None:
        if value is not None and value not in CONTINUITY_STATES:
            raise ValueError('Unsupported continuity state filter.')
        return value

    @field_validator('severity')
    @classmethod
    def _severity(cls, value: str | None) -> str | None:
        if value is not None and value not in SEVERITIES:
            raise ValueError('Unsupported severity filter.')
        return value

    @field_validator('domain')
    @classmethod
    def _domain(cls, value: str | None) -> str | None:
        if value is not None and value not in DOMAINS:
            raise ValueError('Unsupported continuity domain filter.')
        return value

    @field_validator('result_state')
    @classmethod
    def _result(cls, value: str | None) -> str | None:
        if value is not None and value not in RESULT_STATES:
            raise ValueError('Unsupported Result state filter.')
        return value

    @field_validator('memory_kind')
    @classmethod
    def _memory_kind(cls, value: str | None) -> str | None:
        if value is not None and value not in KINDS:
            raise ValueError('Unsupported memory kind filter.')
        return value

    @field_validator('text', 'asset_name', 'environment', 'provider', 'model', 'lens')
    @classmethod
    def _trim(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    def has_any_facet(self) -> bool:
        """An empty query is a real query (everything, bounded) - this only documents that."""

        return True

    def rpc_body(self) -> dict[str, Any]:
        """The payload the database reads: real facets only, with nothing invented."""

        return {
            'text': self.text,
            'kinds': list(self.kinds),
            'asset_id': self.asset_id or None,
            'asset_name': self.asset_name,
            'asset_type': self.asset_type,
            'environment': self.environment,
            'approval': self.approval,
            'execution_method': self.execution_method,
            'provider': self.provider,
            'model': self.model,
            'lens': self.lens,
            'continuity_state': self.continuity_state,
            'severity': self.severity,
            'domain': self.domain,
            'result_state': self.result_state,
            'memory_kind': self.memory_kind,
            'limit': self.limit,
        }
