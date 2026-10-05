from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.domain.product import (
    CreativeProposal, EvidenceAccess, GroundedAnalysis, ProductionClaim,
    ProposalApplication, VoiceUseRequest,
)
from app.domain.vocabulary import DEFAULT_EXECUTION_FACE, ExecutionMethod
from app.services.contracts import OperationResult

USER = UUID('00000000-0000-4000-8000-000000000001')
WORKSPACE = UUID('00000000-0000-4000-8000-000000000002')
PRODUCTION = UUID('00000000-0000-4000-8000-000000000003')
VERSION = UUID('00000000-0000-4000-8000-000000000004')
EVIDENCE = UUID('00000000-0000-4000-8000-000000000005')


def proposal(**overrides):
    value = dict(workspace_id=WORKSPACE, production_id=PRODUCTION, scope_object_ids=[PRODUCTION], expected_revision=1,
        source_version_ids=[VERSION], action='revise', collaboration_mode='stop_at_major_decisions',
        consequential=True, changes={'dialogue': 'A new line'})
    return CreativeProposal.model_validate(value | overrides)


def test_real_is_default_hybrid_is_assignment_not_another_face():
    assert DEFAULT_EXECUTION_FACE == ExecutionMethod.real
    assert set(ExecutionMethod) == {'real', 'ai', 'hybrid'}


def test_observation_requires_accessed_and_analyzed_modality():
    evidence = EvidenceAccess(evidence_id=EVIDENCE, modality='video_frames', access='available', analyzed=True)
    claim = ProductionClaim(kind='observed', statement='Camera moves left.', evidence_ids=[EVIDENCE], required_modalities=['video_frames'])
    assert GroundedAnalysis(outcome='complete', evidence=[evidence], claims=[claim]).claims[0] == claim
    metadata = EvidenceAccess(evidence_id=EVIDENCE, modality='metadata', access='available', analyzed=True)
    with pytest.raises(ValidationError, match='modalities'):
        GroundedAnalysis(outcome='complete', evidence=[metadata], claims=[claim])
    unseen = EvidenceAccess(evidence_id=EVIDENCE, modality='video_frames', access='available', analyzed=False)
    with pytest.raises(ValidationError, match='not been analyzed'):
        GroundedAnalysis(outcome='complete', evidence=[unseen], claims=[claim])
    with pytest.raises(ValidationError, match='cannot be analyzed'):
        EvidenceAccess(evidence_id=EVIDENCE, modality='audio', access='inaccessible', analyzed=True)


def test_partial_analysis_has_useful_truthful_limitations():
    metadata = EvidenceAccess(evidence_id=EVIDENCE, modality='metadata', access='available', analyzed=True)
    audio = EvidenceAccess(evidence_id=VERSION, modality='audio', access='inaccessible')
    partial = GroundedAnalysis(outcome='partial', evidence=[metadata, audio], limitations=['Upload authorized audio for sound analysis.'])
    assert not partial.evidence[1].analyzed
    with pytest.raises(ValidationError, match='partial completion'):
        GroundedAnalysis(outcome='complete', evidence=[audio])
    with pytest.raises(ValidationError, match='limitations'):
        GroundedAnalysis(outcome='partial')
    with pytest.raises(ValidationError, match='unknown evidence'):
        GroundedAnalysis(outcome='complete', evidence=[metadata], claims=[ProductionClaim(kind='observed', statement='Title is known.', evidence_ids=[USER], required_modalities=['metadata'])])


def test_estimates_recommendations_and_observations_are_distinct():
    with pytest.raises(ValidationError, match='uncertainty'):
        ProductionClaim(kind='estimated', statement='52.7mm lens.')
    estimate = ProductionClaim(kind='estimated', statement='Moderate telephoto look.', basis='Visible compression.', uncertainty='Exact lens is unknown.')
    recommendation = ProductionClaim(kind='recommended', statement='Start with your 50mm.', basis='Matches your Setup and intended framing.', assumptions=['Adjust distance after framing.'])
    assert estimate.kind != recommendation.kind
    with pytest.raises(ValidationError, match='rationale'):
        ProductionClaim(kind='recommended', statement='Use ISO 812.')


def test_voice_direction_does_not_require_cloning_or_create_cloning_assets():
    value = dict(subject_asset_id=USER, workspace_id=WORKSPACE, production_id=PRODUCTION)
    assert VoiceUseRequest(capability='direction', **value).authorization_id is None
    with pytest.raises(ValidationError, match='silently'):
        VoiceUseRequest(capability='direction', retain_cloning_asset=True, **value)
    with pytest.raises(ValidationError, match='authorization'):
        VoiceUseRequest(capability='cloning', **value)
    consent = dict(authorization_id=VERSION, authorized_by_user_id=USER, consent_expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
    assert VoiceUseRequest(capability='cloning', **value, **consent).authorization_id == VERSION
    with pytest.raises(ValidationError, match='current'):
        VoiceUseRequest(capability='cloning', **value, **(consent | {'consent_expires_at': datetime.now(timezone.utc) - timedelta(hours=1)}))
    with pytest.raises(ValidationError, match='unrevoked'):
        VoiceUseRequest(capability='cloning', consent_revoked_at=datetime.now(timezone.utc), **value, **consent)


def test_ai_proposes_never_approves_or_applies_silently():
    p = proposal()
    assert p.state == 'proposed' and p.resulting_approval == 'needs_review'
    with pytest.raises(ValidationError):
        proposal(resulting_approval='approved')
    with pytest.raises(ValidationError):
        proposal(state='applied')
    with pytest.raises(ValidationError, match='smuggle'):
        proposal(changes={'nested': [{'approval': 'approved'}]})
    with pytest.raises(ValidationError, match='smuggle'):
        proposal(changes={'locked_at': None})
    with pytest.raises(ValidationError):
        proposal(scope_object_ids=[])
    with pytest.raises(ValidationError, match='unique'):
        proposal(scope_object_ids=[PRODUCTION, PRODUCTION])


def test_consequential_application_requires_creator_and_impact():
    p = proposal()
    with pytest.raises(ValidationError, match='impact preview'):
        ProposalApplication(proposal=p, authorized_user_id=USER)
    accepted = ProposalApplication(proposal=p, authorized_user_id=USER, impact_previewed=True, explicit_confirmation=True)
    assert accepted.state == 'applied'
    routine = proposal(consequential=False, collaboration_mode='guide_step_by_step')
    with pytest.raises(ValidationError, match='creator decision'):
        ProposalApplication(proposal=routine, authorized_user_id=USER)


def test_provider_output_is_attributed_versioned_and_scope_validated():
    data = dict(structured_output={'direction': 'A proposed scene.'}, provider='unconfigured', model='future',
        input_tokens=1, output_tokens=1, source_version_ids=[VERSION], workspace_id=WORKSPACE,
        production_id=PRODUCTION, scope_object_id=PRODUCTION, grounding=GroundedAnalysis(outcome='complete'))
    assert OperationResult(**data, proposals=[proposal()]).production_id == PRODUCTION
    with pytest.raises(ValidationError, match='another workspace'):
        OperationResult(**data, proposals=[proposal(workspace_id=USER)])
    with pytest.raises(ValidationError, match='outside operation'):
        OperationResult(**data, proposals=[proposal(source_version_ids=[USER])])
    with pytest.raises(ValidationError):
        OperationResult(**(data | {'source_version_ids': []}))
