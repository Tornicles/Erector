from __future__ import annotations

import re
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AnalysisModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ReferenceCapability(StrEnum):
    """Formal capability states. A linked media ID is never full-media availability."""

    full_media = 'full_media_available'
    partial_media = 'partial_media_available'
    metadata_only = 'metadata_only'
    text_only = 'text_only'
    unavailable = 'unavailable'


class CapabilityState(StrEnum):
    available = 'available'
    partial = 'partial'
    unverified = 'unverified'
    unavailable = 'unavailable'


class AnalysisStage(StrEnum):
    queued = 'queued'
    preprocessing = 'preprocessing'
    analyzing = 'analyzing'
    synthesizing = 'synthesizing'
    complete = 'complete'
    partial = 'partial'
    failed = 'failed'
    cancelled = 'cancelled'


class AnalysisStatus(StrEnum):
    not_started = 'not_started'
    queued = 'queued'
    preprocessing = 'preprocessing'
    analyzing = 'analyzing'
    synthesizing = 'synthesizing'
    complete = 'complete'
    partial = 'partial'
    failed = 'failed'


class EpistemicClass(StrEnum):
    observed = 'observed'
    estimated = 'estimated'
    recommended = 'recommended'
    unknown = 'unknown'


class QualitativeConfidence(StrEnum):
    high = 'high'
    medium = 'medium'
    low = 'low'


class FindingCategory(StrEnum):
    camera = 'camera'
    composition = 'composition'
    lighting = 'lighting'
    blocking = 'blocking'
    performance = 'performance'
    product = 'product'
    edit = 'edit'
    transition = 'transition'
    sound = 'sound'
    color = 'color'
    story = 'story'
    typography = 'typography'
    text = 'text'
    music = 'music'
    dialogue = 'dialogue'
    voice = 'voice'
    pacing = 'pacing'
    environment = 'environment'


class TechniqueCategory(StrEnum):
    camera = 'camera'
    composition = 'composition'
    lighting = 'lighting'
    blocking = 'blocking'
    performance = 'performance'
    product = 'product'
    edit = 'edit'
    transition = 'transition'
    sound = 'sound'
    color = 'color'
    story = 'story'
    typography = 'typography'


class TechniqueImportance(StrEnum):
    essential = 'essential'
    supporting = 'supporting'
    optional = 'optional'


class ReferenceRole(StrEnum):
    camera = 'camera'
    lighting = 'lighting'
    pacing = 'pacing'
    character = 'character'
    product = 'product'
    color = 'color'
    edit = 'edit'
    sound = 'sound'
    style = 'style'
    story = 'story'
    composition = 'composition'
    environment = 'environment'


class MediaModalityState(AnalysisModel):
    image: CapabilityState = CapabilityState.unavailable
    video: CapabilityState = CapabilityState.unavailable
    video_frames: CapabilityState = CapabilityState.unavailable
    audio: CapabilityState = CapabilityState.unavailable
    transcript: CapabilityState = CapabilityState.unavailable
    text: CapabilityState = CapabilityState.unavailable
    metadata: CapabilityState = CapabilityState.unverified


class CapabilityReport(AnalysisModel):
    """Truthful modality report. Analysis may only claim what this allows."""

    capability: ReferenceCapability
    modalities: MediaModalityState
    media_bytes: CapabilityState = CapabilityState.unavailable
    producer: Literal['verified', 'unverified'] = 'unverified'
    note: str = Field(min_length=1, max_length=600)

    @property
    def may_claim_visual_observation(self) -> bool:
        return self.modalities.image == CapabilityState.available or self.modalities.video_frames == CapabilityState.available

    @property
    def may_claim_audio_observation(self) -> bool:
        return self.modalities.audio == CapabilityState.available

    @property
    def may_claim_composition_analysis(self) -> bool:
        return self.modalities.image == CapabilityState.available or self.modalities.video_frames == CapabilityState.available


class EvidenceRef(AnalysisModel):
    """Machine-checkable grounding for a finding. Timecodes are integer milliseconds."""

    kind: Literal['timecode', 'time_range', 'frame', 'transcript_range', 'document', 'source', 'measurement']
    reference_id: UUID | None = None
    start_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    end_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    frame_id: str | None = Field(default=None, max_length=120)
    transcript_start: int | None = Field(default=None, ge=0, le=1000000)
    transcript_end: int | None = Field(default=None, ge=0, le=1000000)
    document_span: str | None = Field(default=None, max_length=200)
    detail: str = Field(default='', max_length=600)

    @model_validator(mode='after')
    def ordered_range(self) -> 'EvidenceRef':
        if self.start_ms is not None and self.end_ms is not None and self.end_ms < self.start_ms:
            raise ValueError('Evidence range end precedes its start.')
        if self.transcript_start is not None and self.transcript_end is not None and self.transcript_end < self.transcript_start:
            raise ValueError('Transcript range end precedes its start.')
        if self.kind == 'time_range' and (self.start_ms is None or self.end_ms is None):
            raise ValueError('A time range evidence item needs both bounds.')
        if self.kind == 'timecode' and self.start_ms is None:
            raise ValueError('A timecode evidence item needs a start.')
        return self


def format_timecode(milliseconds: int) -> str:
    if not isinstance(milliseconds, int) or milliseconds < 0:
        raise ValueError('Timecode requires non-negative integer milliseconds.')
    return f'{milliseconds // 60000:02d}:{(milliseconds // 1000) % 60:02d}.{milliseconds % 1000 // 100}'


class Finding(AnalysisModel):
    id: str = Field(min_length=1, max_length=120)
    category: FindingCategory
    statement: str = Field(min_length=1, max_length=1200)
    epistemic: EpistemicClass
    confidence: QualitativeConfidence
    evidence: list[EvidenceRef] = Field(default_factory=list, max_length=8)
    technique_id: str | None = Field(default=None, max_length=120)
    limitations: list[str] = Field(default_factory=list, max_length=6)

    @model_validator(mode='after')
    def observation_needs_evidence(self) -> 'Finding':
        if self.epistemic == EpistemicClass.observed and self.category != FindingCategory.story and not self.evidence:
            raise ValueError('An observed finding must cite evidence.')
        return self


class Technique(AnalysisModel):
    """Reusable, transferable craft. Not a copy of the reference."""

    canonical_id: str = Field(min_length=3, max_length=120, pattern=r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
    name: str = Field(min_length=1, max_length=160)
    category: TechniqueCategory
    description: str = Field(min_length=1, max_length=1200)
    purpose: str = Field(min_length=1, max_length=600)
    effect: str = Field(min_length=1, max_length=600)
    conditions: list[str] = Field(default_factory=list, max_length=8)
    practical_concept: str = Field(min_length=1, max_length=900)
    ai_concept: str = Field(min_length=1, max_length=900)
    limitations: list[str] = Field(default_factory=list, max_length=8)
    importance: TechniqueImportance = TechniqueImportance.supporting
    confidence: QualitativeConfidence = QualitativeConfidence.medium
    epistemic: EpistemicClass = EpistemicClass.estimated
    evidence: list[EvidenceRef] = Field(default_factory=list, max_length=8)


class StyleSection(AnalysisModel):
    section: Literal['camera', 'composition', 'movement', 'lighting', 'palette', 'contrast', 'texture', 'performance', 'editing', 'sound', 'typography']
    description: str = Field(min_length=1, max_length=900)
    directives: list[str] = Field(default_factory=list, max_length=8)
    epistemic: EpistemicClass = EpistemicClass.estimated
    confidence: QualitativeConfidence = QualitativeConfidence.medium
    evidence: list[EvidenceRef] = Field(default_factory=list, max_length=6)


class StyleDNA(AnalysisModel):
    """Prompt 4 Style foundation. Prompt 7 deepens Style locking."""

    sections: list[StyleSection] = Field(default_factory=list, max_length=11)
    palette: list[str] = Field(default_factory=list, max_length=8)
    producer: Literal['deterministic', 'model'] = 'deterministic'

    def section(self, name: str) -> StyleSection | None:
        return next((item for item in self.sections if item.section == name), None)


class CausalExplanation(AnalysisModel):
    """Answers WHAT MAKES THIS WORK, not merely what is present."""

    question: str = Field(min_length=1, max_length=300)
    explanation: str = Field(min_length=1, max_length=1600)
    drivers: list[str] = Field(default_factory=list, max_length=8)
    evidence: list[EvidenceRef] = Field(default_factory=list, max_length=8)
    confidence: QualitativeConfidence = QualitativeConfidence.medium


class StyleConflict(AnalysisModel):
    topic: str = Field(min_length=1, max_length=120)
    values: list[str] = Field(min_length=2, max_length=6)
    impact: Literal['critical', 'high', 'optional']
    proposal: str = Field(min_length=1, max_length=600)


class ReferenceAnalysis(AnalysisModel):
    reference_id: UUID | None = None
    role: ReferenceRole = ReferenceRole.style
    capability: CapabilityReport
    status: AnalysisStatus = AnalysisStatus.not_started
    stages: list[AnalysisStage] = Field(default_factory=list, max_length=10)
    summary: str = Field(default='', max_length=1600)
    findings: list[Finding] = Field(default_factory=list, max_length=80)
    techniques: list[Technique] = Field(default_factory=list, max_length=40)
    style: StyleDNA = Field(default_factory=StyleDNA)
    causal: list[CausalExplanation] = Field(default_factory=list, max_length=8)
    limitations: list[str] = Field(default_factory=list, max_length=12)
    producer: Literal['deterministic', 'model'] = 'deterministic'
    model_profile: str | None = Field(default=None, max_length=120)
    adaptation_notes: list[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode='after')
    def no_visual_claims_without_media(self) -> 'ReferenceAnalysis':
        if not self.capability.may_claim_visual_observation:
            offenders = [
                finding.category for finding in self.findings
                if finding.epistemic == EpistemicClass.observed
                and finding.category in {
                    FindingCategory.camera, FindingCategory.composition, FindingCategory.lighting,
                    FindingCategory.color, FindingCategory.blocking, FindingCategory.performance,
                    FindingCategory.environment, FindingCategory.product, FindingCategory.typography,
                }
            ]
            if offenders:
                raise ValueError(f'Visual observations require available media; found {sorted({item.value for item in offenders})}.')
        if not self.capability.may_claim_audio_observation:
            offenders = [finding.category for finding in self.findings if finding.epistemic == EpistemicClass.observed and finding.category in {FindingCategory.sound, FindingCategory.music, FindingCategory.voice, FindingCategory.dialogue}]
            if offenders:
                raise ValueError('Audio observations require an available audio track.')
        if self.status in {AnalysisStatus.complete, AnalysisStatus.partial} and not self.summary:
            raise ValueError('A finished analysis needs a summary.')
        return self

    def by_epistemic(self, kind: EpistemicClass) -> list[Finding]:
        return [finding for finding in self.findings if finding.epistemic == kind]

    def essential_techniques(self) -> list[Technique]:
        return [item for item in self.techniques if item.importance == TechniqueImportance.essential]


INJECTION_PATTERNS = (
    r'ignore (?:all|any|previous|prior|the) (?:instructions|prompts|rules)',
    r'disregard (?:all|any|previous|prior|the) (?:instructions|prompts|rules)',
    r'you are now',
    r'system prompt',
    r'change the production',
    r'delete (?:the )?(?:production|scene|shots?)',
    r'reveal (?:your )?(?:system|prompt|instructions)',
)


def contains_prompt_injection(text: str) -> bool:
    """Reference text is untrusted evidence, never instruction. Detection is reported, not obeyed."""

    lowered = text.lower()
    return any(re.search(pattern, lowered) for pattern in INJECTION_PATTERNS)
