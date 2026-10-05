from enum import StrEnum
from typing import Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.product import CreativeProposal, GroundedAnalysis


class IntelligenceOperation(StrEnum):
    director = 'director'
    production_planning = 'production_planning'
    story_script = 'story_script'
    real_planning = 'real_planning'
    ai_prompt_compilation = 'ai_prompt_compilation'
    hybrid_planning = 'hybrid_planning'
    continuity = 'continuity'
    impact_analysis = 'impact_analysis'
    media_analysis = 'media_analysis'
    shot_match = 'shot_match'
    export_generation = 'export_generation'
    production_memory = 'production_memory'
    model_routing = 'model_routing'


class OperationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    workspace_id: UUID
    production_id: UUID
    scope_object_id: UUID
    expected_revision: int = Field(ge=1)
    operation: IntelligenceOperation
    input_version_ids: list[UUID] = Field(default_factory=list, max_length=100)
    media_ids: list[UUID] = Field(default_factory=list, max_length=40)
    output_schema: dict[str, Any]


class OperationResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    structured_output: dict[str, Any]
    provider: str
    model: str
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    source_version_ids: list[UUID] = Field(min_length=1, max_length=100)
    workspace_id: UUID
    production_id: UUID
    scope_object_id: UUID
    grounding: GroundedAnalysis
    proposals: list[CreativeProposal] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def validate_proposal_scope(self) -> 'OperationResult':
        for proposal in self.proposals:
            if proposal.workspace_id != self.workspace_id or proposal.production_id != self.production_id:
                raise ValueError('Proposal belongs to another workspace or production.')
            if not set(proposal.source_version_ids).issubset(self.source_version_ids):
                raise ValueError('Proposal cites versions outside operation context.')
        return self


class AIProvider(Protocol):
    """Server-only direct provider adapter. Structured/multimodal operations are explicit.

    Future adapters must validate against output_schema and return proposals, not
    apply creative mutations directly. Provider failures never become fake output.
    """
    async def execute(self, request: OperationRequest) -> OperationResult: ...


class ModelRouter(Protocol):
    def select(self, operation: IntelligenceOperation, *, multimodal: bool) -> AIProvider: ...


class JobDispatcher(Protocol):
    """Publish only committed job IDs to a durable queue; no create_task request work.

    Persist jobs first; workers claim leases atomically, retry with a new lease and
    idempotent output, and verify tenant/production ownership again. A dispatcher
    is intentionally not selected or implemented in Prompt 1.
    """
    async def dispatch(self, job_id: UUID, workspace_id: UUID) -> None: ...
    async def cancel(self, job_id: UUID, workspace_id: UUID) -> None: ...


class IntegrationSecretStore(Protocol):
    """Encrypt with managed server-side keys before private-schema persistence."""
    async def store(self, connection_id: UUID, secret: bytes) -> None: ...
    async def load(self, connection_id: UUID) -> bytes: ...


class MediaStorage(Protocol):
    """Logical media IDs remain stable when object storage providers change."""
    async def signed_read(self, media_id: UUID, workspace_id: UUID, ttl_seconds: int) -> str: ...
    async def prepare_upload(self, media_id: UUID, workspace_id: UUID) -> dict[str, Any]: ...
