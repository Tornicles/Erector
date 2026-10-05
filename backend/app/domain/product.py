from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.vocabulary import (
    AccessState, ApprovalStatus, ClaimKind, CollaborationMode, MediaModality,
    MutationAction, OperationOutcome,
)


class ProductContract(BaseModel):
    model_config = ConfigDict(extra='forbid')


class EvidenceAccess(ProductContract):
    evidence_id: UUID
    modality: MediaModality
    access: AccessState
    analyzed: bool = False
    source_version_id: UUID | None = None

    @model_validator(mode='after')
    def honest_access(self) -> 'EvidenceAccess':
        if self.analyzed and self.access != AccessState.available:
            raise ValueError('Inaccessible or unrequested evidence cannot be analyzed.')
        return self


class ProductionClaim(ProductContract):
    kind: ClaimKind
    statement: str = Field(min_length=1, max_length=10000)
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=100)
    required_modalities: list[MediaModality] = Field(default_factory=list)
    basis: str | None = Field(default=None, min_length=1, max_length=10000)
    uncertainty: str | None = Field(default=None, min_length=1, max_length=10000)
    assumptions: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def distinguish_claims(self) -> 'ProductionClaim':
        if self.kind == ClaimKind.observed and (not self.evidence_ids or not self.required_modalities):
            raise ValueError('Observed claims require identified evidence and modalities.')
        if self.kind == ClaimKind.estimated and (not self.basis or not self.uncertainty):
            raise ValueError('Estimates require a basis and explicit uncertainty.')
        if self.kind == ClaimKind.recommended and not self.basis:
            raise ValueError('Recommendations require a context-based rationale.')
        return self


class GroundedAnalysis(ProductContract):
    outcome: OperationOutcome
    evidence: list[EvidenceAccess] = Field(default_factory=list, max_length=100)
    claims: list[ProductionClaim] = Field(default_factory=list, max_length=1000)
    limitations: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def validate_grounding(self) -> 'GroundedAnalysis':
        by_id = {item.evidence_id: item for item in self.evidence}
        if len(by_id) != len(self.evidence):
            raise ValueError('Evidence IDs must be unique.')
        for claim in self.claims:
            if any(evidence_id not in by_id for evidence_id in claim.evidence_ids):
                raise ValueError('Claim cites unknown evidence.')
            for evidence_id in claim.evidence_ids:
                if not by_id[evidence_id].analyzed:
                    raise ValueError('Claim cites evidence that has not been analyzed.')
            if claim.kind == ClaimKind.observed:
                modalities = {by_id[evidence_id].modality for evidence_id in claim.evidence_ids}
                if not set(claim.required_modalities).issubset(modalities):
                    raise ValueError('Observed claim requires modalities that were not analyzed.')
        if any(item.access == AccessState.inaccessible for item in self.evidence) and self.outcome != OperationOutcome.partial:
            raise ValueError('Inaccessible requested evidence requires partial completion.')
        if self.outcome == OperationOutcome.partial and not self.limitations:
            raise ValueError('Partial analysis requires an explanation of limitations.')
        return self


class VoiceUseRequest(ProductContract):
    capability: Literal['direction', 'cloning']
    subject_asset_id: UUID
    workspace_id: UUID
    production_id: UUID
    authorization_id: UUID | None = None
    authorized_by_user_id: UUID | None = None
    consent_expires_at: datetime | None = None
    consent_revoked_at: datetime | None = None
    retain_cloning_asset: bool = False

    @model_validator(mode='after')
    def require_cloning_authorization(self) -> 'VoiceUseRequest':
        if self.capability == 'direction' and self.retain_cloning_asset:
            raise ValueError('Voice direction cannot silently create a retained cloning asset.')
        if self.capability == 'cloning':
            if self.authorization_id is None or self.authorized_by_user_id is None or self.consent_expires_at is None:
                raise ValueError('Voice cloning requires explicit scoped authorization.')
            if self.consent_revoked_at is not None or self.consent_expires_at.tzinfo is None or self.consent_expires_at <= datetime.now(timezone.utc):
                raise ValueError('Voice cloning authorization must be current and unrevoked.')
        # Provider services must verify this evidence against persisted consent;
        # caller-supplied IDs cannot prove legal/identity authorization by themselves.
        return self


class CreativeProposal(ProductContract):
    workspace_id: UUID
    production_id: UUID
    scope_object_ids: list[UUID] = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=1)
    source_version_ids: list[UUID] = Field(min_length=1, max_length=100)
    action: MutationAction
    collaboration_mode: CollaborationMode
    consequential: bool
    changes: dict[str, Any]
    resulting_approval: Literal[ApprovalStatus.draft, ApprovalStatus.needs_review, ApprovalStatus.changed_after_approval] = ApprovalStatus.needs_review
    state: Literal['proposed'] = 'proposed'

    @model_validator(mode='after')
    def no_hidden_acceptance(self) -> 'CreativeProposal':
        forbidden = {'approval', 'approved', 'locked_at', 'state', 'result_state'}

        def check(value: Any) -> None:
            if isinstance(value, dict):
                if forbidden.intersection(value):
                    raise ValueError('Creative changes cannot smuggle approval, lock or result-state transitions.')
                for child in value.values():
                    check(child)
            elif isinstance(value, list):
                for child in value:
                    check(child)

        check(self.changes)
        if len(set(self.scope_object_ids)) != len(self.scope_object_ids):
            raise ValueError('Mutation scope must contain unique object identities.')
        return self


class ProposalApplication(ProductContract):
    proposal: CreativeProposal
    authorized_user_id: UUID
    impact_previewed: bool = False
    explicit_confirmation: bool = False
    state: Literal['applied'] = 'applied'

    @model_validator(mode='after')
    def consequential_decisions_are_explicit(self) -> 'ProposalApplication':
        if self.proposal.consequential and not (self.impact_previewed and self.explicit_confirmation):
            raise ValueError('Consequential changes require impact preview and explicit creator confirmation.')
        if self.proposal.collaboration_mode == CollaborationMode.guide_step_by_step and not self.explicit_confirmation:
            raise ValueError('Step-by-step mode requires a creator decision before application.')
        return self
