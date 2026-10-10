"""Prompt 7 AI Creation & Hybrid Director domain.

AI Creation is a face of the same Master Production, and SHOOT / GENERATE /
SHOOT + AI are execution methods of one canonical Shot. Nothing here creates a second
Production, Scene or Shot.

Two rules shape every type in this module:

* Capability truth. A model is described only by what was declared for the workspace,
  and a capability is never inferred from a model name. Anything unknown stays UNKNOWN.
* Untrusted input. Reference transcripts, notes and provider payloads are data. They are
  never instructions, and no field here lets them become instructions.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# --- Capability truth (§11/§12). TONDE's own states, in its own words. ------------

CapabilityState = Literal['SUPPORTED', 'PARTIALLY SUPPORTED', 'UNSUPPORTED', 'UNKNOWN', 'REQUIRES CONNECTION']

AiOperation = Literal['image', 'video', 'image_to_video', 'video_to_video', 'voice', 'speech', 'music',
    'sound_effect', 'upscale', 'background_removal', 'image_edit', 'frame_interpolation', 'lipsync', 'compositing']

ConnectionState = Literal['not_connected', 'connected', 'unavailable']

AiReadiness = Literal['unplanned', 'stale', 'needs_reference', 'needs_model', 'needs_decision', 'unsupported',
    'provider_not_connected', 'cost_confirmation', 'ready_to_generate', 'manual_export']

AttemptStatus = Literal['planned', 'queued', 'submitted', 'processing', 'succeeded', 'partial', 'failed',
    'cancelled', 'expired']

AttemptMode = Literal['live', 'manual']

LockScope = Literal['character', 'world', 'product', 'style']

ContinuityPriority = Literal['MUST PRESERVE', 'SHOULD PRESERVE', 'FLEXIBLE']

ReferenceRole = Literal['face', 'full_body', 'profile', 'wardrobe', 'expression', 'pose', 'lighting_neutral',
    'environment', 'product', 'style', 'first_frame', 'last_frame', 'storyboard', 'plate', 'voice']

FidelityImportance = Literal['critical', 'high', 'flexible']

ExecutionMethod = Literal['shoot', 'generate', 'hybrid']

BatchScope = Literal['shot', 'scene', 'selection', 'production']

# The canonical prompt sections (§21). One paragraph is not a prompt.
PromptSection = Literal['SUBJECT', 'ACTION', 'ENVIRONMENT', 'COMPOSITION', 'CAMERA', 'MOVEMENT', 'LIGHTING',
    'COLOR / STYLE', 'PERFORMANCE', 'PRODUCT', 'CONTINUITY', 'TIMING', 'AUDIO', 'NEGATIVE / AVOID', 'REFERENCES']

PROMPT_SECTION_ORDER: tuple[str, ...] = ('SUBJECT', 'ACTION', 'ENVIRONMENT', 'COMPOSITION', 'CAMERA', 'MOVEMENT',
    'LIGHTING', 'COLOR / STYLE', 'PERFORMANCE', 'PRODUCT', 'CONTINUITY', 'TIMING', 'AUDIO', 'NEGATIVE / AVOID',
    'REFERENCES')

# Sections a provider format may drop first when the target has a tight length budget.
DROPPABLE_SECTIONS: tuple[str, ...] = ('REFERENCES', 'AUDIO', 'NEGATIVE / AVOID', 'COLOR / STYLE', 'COMPOSITION')

MAX_REFERENCES = 24
MAX_LIMITATIONS = 16
MAX_PROMPT_LENGTH = 8000

# The identity promise (§29). Never "exact identity preservation".
IDENTITY_TRUTH = ('Preserve key identity traits as closely as the selected generation model supports.')

CONSENT_TRUTH = ('A real person may only be used as a reference where the creator holds authorization, '
    'and voice or identity cloning is never assumed.')

# The same markers the schema refuses. A connection stores a reference, never a credential.
CREDENTIAL_MARKERS: tuple[str, ...] = ('sk-', 'secret', 'password', 'bearer ')


class ModelDeclarationRequest(BaseModel):
    """Declaring what a model can do, for one workspace. Never a vendor claim."""

    model_config = ConfigDict(extra='forbid')

    provider_key: str = Field(min_length=1, max_length=60)
    model_key: str = Field(min_length=1, max_length=120)
    label: str = Field(default='', max_length=160)
    operation: AiOperation = 'video'
    capability_state: CapabilityState = 'UNKNOWN'
    modalities: list[str] = Field(default_factory=list, max_length=12)
    supports_image_reference: bool = False
    max_reference_images: int | None = Field(default=None, ge=0, le=64)
    supports_first_frame: bool = False
    supports_last_frame: bool = False
    supports_seed: bool = False
    supports_negative_prompt: bool = False
    supports_camera_control: bool = False
    supports_audio: bool = False
    supports_image_edit: bool = False
    supports_lipsync: bool = False
    max_duration_ms: int | None = Field(default=None, gt=0, le=3_600_000)
    aspect_ratios: list[str] = Field(default_factory=list, max_length=12)
    resolutions: list[str] = Field(default_factory=list, max_length=12)
    cost_unit: str = Field(default='', max_length=80)
    cost_amount: float | None = Field(default=None, ge=0, le=1_000_000)
    cost_currency: str = Field(default='', max_length=8)
    speed_note: str = Field(default='', max_length=300)
    identity_note: str = Field(default='', max_length=300)
    product_fidelity_note: str = Field(default='', max_length=300)
    availability: Literal['available', 'deprecated', 'unknown'] = 'unknown'
    safety_note: str = Field(default='', max_length=600)
    capability_notes: dict[str, Any] = Field(default_factory=dict)
    expected_revision: int | None = Field(default=None, ge=0)


class ConnectionRequest(BaseModel):
    """A connection state and, at most, a reference to where a credential lives.

    TONDE stores no provider credential. A literal secret is refused here as well as in the
    database, so a key can never be written into the schema by accident.
    """

    model_config = ConfigDict(extra='forbid')

    provider_key: str = Field(min_length=1, max_length=60)
    state: ConnectionState
    credential_reference: str = Field(default='', max_length=200)
    note: str = Field(default='', max_length=600)
    expected_revision: int | None = Field(default=None, ge=0)

    @field_validator('credential_reference')
    @classmethod
    def reference_is_not_a_secret(cls, value: str) -> str:
        lowered = value.lower()
        if any(marker in lowered for marker in CREDENTIAL_MARKERS):
            raise ValueError('Store a reference to your credential (a vault or secret name), never the credential itself.')
        return value


class ReferenceDraft(BaseModel):
    """A reference the plan actually uses, with the role it serves (§28/§35)."""

    model_config = ConfigDict(extra='forbid')

    role: ReferenceRole
    priority: ContinuityPriority = 'SHOULD PRESERVE'
    asset_id: str | None = None
    media_id: str | None = None
    origin: Literal['asset', 'upload', 'generated_result', 'storyboard', 'captured_frame', 'composite'] = 'asset'
    source_attempt_id: str | None = None
    note: str = Field(default='', max_length=400)
    sort_order: int = Field(default=0, ge=0, le=9999)


class ContinuityChange(BaseModel):
    """An intentional change to a locked scope. Allowed only where the lock permits it."""

    model_config = ConfigDict(extra='forbid')

    scope: LockScope
    subject_id: str | None = None
    field: str = Field(min_length=1, max_length=120)
    to: str = Field(default='', max_length=300)
    reason: str = Field(default='', max_length=400)


class AiPlanRequest(BaseModel):
    """The AI Execution Plan body: canonical prompt, routing, frames, motion, audio, cost."""

    model_config = ConfigDict(extra='forbid')

    expected_shot_revision: int | None = Field(default=None, ge=1)
    expected_plan_revision: int | None = Field(default=None, ge=1)
    # The creator's own direction for this Shot (§71). Deterministically interpreted, and never
    # allowed to widen what the plan may claim about capability.
    text: str = Field(default='', max_length=600)

    plan_status: Literal['draft', 'ready', 'needs_decision'] = 'draft'
    readiness_note: str = Field(default='', max_length=600)
    generated_by: Literal['deterministic', 'model', 'creator'] = 'deterministic'

    provider_target: str | None = Field(default=None, max_length=60)
    model_profile_id: str | None = None
    fallback_model_profile_id: str | None = None
    model_key: str = Field(default='', max_length=120)
    model_version: str = Field(default='', max_length=120)

    canonical_prompt: dict[str, Any] = Field(default_factory=dict)
    provider_prompt: str = Field(default='', max_length=MAX_PROMPT_LENGTH)
    provider_prompt_edited: bool = False
    accept_provider_prompt: bool = False

    routing: dict[str, Any] = Field(default_factory=dict)
    first_frame: dict[str, Any] = Field(default_factory=dict)
    last_frame: dict[str, Any] = Field(default_factory=dict)
    motion: dict[str, Any] = Field(default_factory=dict)
    audio: dict[str, Any] = Field(default_factory=dict)
    continuity: dict[str, Any] = Field(default_factory=dict)
    hybrid: dict[str, Any] = Field(default_factory=dict)

    negative_constraints: list[str] = Field(default_factory=list, max_length=24)
    limitations: list[str] = Field(default_factory=list, max_length=MAX_LIMITATIONS)
    aspect_ratio: str = Field(default='', max_length=20)
    expected_duration_ms: int | None = Field(default=None, ge=0, le=3_600_000)
    cost_amount: float | None = Field(default=None, ge=0, le=1_000_000)
    cost_currency: str = Field(default='', max_length=8)
    cost_note: str = Field(default='', max_length=400)

    references: list[ReferenceDraft] = Field(default_factory=list, max_length=MAX_REFERENCES)
    continuity_changes: list[ContinuityChange] = Field(default_factory=list, max_length=12)
    source_versions: dict[str, Any] = Field(default_factory=dict)


class AttemptRequest(BaseModel):
    """Creating an Attempt. The idempotency key is what stops a retry spending twice."""

    model_config = ConfigDict(extra='forbid')

    expected_shot_revision: int | None = Field(default=None, ge=1)
    idempotency_key: str = Field(min_length=8, max_length=200)
    operation: AiOperation = 'video'
    provider_key: str = Field(default='manual', min_length=1, max_length=60)
    model_profile_id: str | None = None
    model_key: str = Field(default='', max_length=120)
    model_version: str = Field(default='', max_length=120)
    mode: AttemptMode = 'live'
    status: AttemptStatus = 'planned'
    external_job_id: str | None = Field(default=None, max_length=200)
    seed: int | None = None
    settings: dict[str, Any] = Field(default_factory=dict)
    input_references: list[dict[str, Any]] = Field(default_factory=list, max_length=MAX_REFERENCES)
    prompt_version: int | None = Field(default=None, ge=0)
    cost_amount: float | None = Field(default=None, ge=0, le=1_000_000)
    cost_currency: str = Field(default='', max_length=8)
    retry_of: str | None = None
    failure_code: str = Field(default='', max_length=80)
    failure_message: str = Field(default='', max_length=800)


class AttemptUpdateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: AttemptStatus | None = None
    external_job_id: str | None = Field(default=None, max_length=200)
    seed: int | None = None
    settings: dict[str, Any] | None = None
    output_media_id: str | None = None
    cost_amount: float | None = Field(default=None, ge=0, le=1_000_000)
    cost_currency: str = Field(default='', max_length=8)
    failure_code: str = Field(default='', max_length=80)
    failure_message: str = Field(default='', max_length=800)
    retryable: bool | None = None
    creator_rating: int | None = Field(default=None, ge=1, le=5)
    creator_decision: Literal['', 'keep', 'reject', 'needs_review'] = ''


class LockRequest(BaseModel):
    """What must stay true across Shots, and what may vary."""

    model_config = ConfigDict(extra='forbid')

    scope: LockScope
    subject_id: str | None = None
    label: str = Field(default='', max_length=200)
    locked: bool = True
    priority: ContinuityPriority = 'MUST PRESERVE'
    locked_traits: list[str] = Field(default_factory=list, max_length=24)
    allowed_variations: list[str] = Field(default_factory=list, max_length=24)
    prohibited_changes: list[str] = Field(default_factory=list, max_length=24)
    identity_truth: str = Field(default='', max_length=400)
    consent_note: str = Field(default='', max_length=400)
    note: str = Field(default='', max_length=600)
    expected_revision: int | None = Field(default=None, ge=1)


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    scope: BatchScope = 'shot'
    scene_id: str | None = None
    shot_id: str | None = None
    shot_ids: list[str] = Field(default_factory=list, max_length=240)
    confirmed: bool = False
    note: str = Field(default='', max_length=600)


class BatchItemRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    state: Literal['pending', 'blocked', 'submitted', 'succeeded', 'failed', 'skipped']
    blocked_reason: str = Field(default='', max_length=200)
    attempt_id: str | None = None
    failure_code: str = Field(default='', max_length=80)
    failure_message: str = Field(default='', max_length=800)


class HybridOverrideRequest(BaseModel):
    """The creator is authoritative. TONDE advises and warns, and stores the override."""

    model_config = ConfigDict(extra='forbid')

    execution_method: ExecutionMethod
    reason: str = Field(default='', max_length=400)
    expected_shot_revision: int | None = Field(default=None, ge=1)


# --- Provider-neutral payload shapes (§102). Validated, never trusted. ------------

PROVIDER_TERMINAL_STATES = frozenset({'succeeded', 'partial', 'failed', 'cancelled', 'expired'})

ALLOWED_OUTPUT_MIME = frozenset({'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime',
    'audio/mpeg', 'audio/wav', 'audio/mp4'})

RETRYABLE_FAILURE_CODES = frozenset({'provider_5xx', 'rate_limited', 'network_timeout', 'provider_unavailable',
    'expired_job'})

HARD_FAILURE_CODES = frozenset({'invalid_prompt', 'unsupported_media', 'insufficient_credits',
    'policy_rejection', 'invalid_reference'})


class ProviderPayloadError(ValueError):
    """A provider payload that cannot be trusted, with the exact reason."""


def retryable_for(failure_code: str) -> bool:
    """Transient infrastructure only (§105). An unknown code is not retried blindly."""

    return failure_code in RETRYABLE_FAILURE_CODES


def validate_provider_payload(payload: Any) -> dict[str, Any]:
    """Validate a provider job payload before any of it is stored (§102).

    Shape, status, job identifier and output metadata are checked explicitly. A payload
    that does not match is rejected with a reason rather than partially believed.
    """

    if not isinstance(payload, dict):
        raise ProviderPayloadError('A provider payload must be an object.')
    status = payload.get('status')
    if not isinstance(status, str) or status not in PROVIDER_TERMINAL_STATES | {'queued', 'submitted', 'processing'}:
        raise ProviderPayloadError(f'Unknown provider status: {status!r}')
    job_id = payload.get('job_id')
    if status != 'queued' and not isinstance(job_id, str):
        raise ProviderPayloadError('A submitted provider job must carry a job identifier.')
    if isinstance(job_id, str) and len(job_id) > 200:
        raise ProviderPayloadError('The provider job identifier is longer than TONDE stores.')
    if status in ('succeeded', 'partial'):
        output = payload.get('output')
        if not isinstance(output, dict):
            raise ProviderPayloadError('A finished job must report the media it produced.')
        mime = output.get('mime_type')
        if mime not in ALLOWED_OUTPUT_MIME:
            raise ProviderPayloadError(f'Unsupported output media type: {mime!r}')
        duration = output.get('duration_ms')
        if duration is not None and (not isinstance(duration, int) or duration < 0):
            raise ProviderPayloadError('The reported duration is not a valid duration.')
    if status == 'failed' and not isinstance(payload.get('failure_code'), str):
        raise ProviderPayloadError('A failed job must report why it failed.')
    return payload


def verify_webhook_signature(provided: str, expected: str) -> bool:
    """Constant-time comparison for a provider callback signature (§104/§154)."""

    import hmac

    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.strip().lower(), expected.strip().lower())


# --- Payload builders: bounded, and never wider than the schema. -----------------


def declaration_payload(body: ModelDeclarationRequest) -> dict[str, Any]:
    payload = body.model_dump()
    payload.pop('expected_revision', None)
    return payload


def plan_payload(body: AiPlanRequest) -> dict[str, Any]:
    """Assemble the stored plan body, including the continuity changes to guard."""

    continuity = dict(body.continuity)
    if body.continuity_changes:
        continuity['changes'] = [change.model_dump() for change in body.continuity_changes]
    return {
        'plan_status': body.plan_status,
        'readiness_note': body.readiness_note,
        'generated_by': body.generated_by,
        'provider_target': body.provider_target,
        'model_profile_id': body.model_profile_id,
        'fallback_model_profile_id': body.fallback_model_profile_id,
        'model_key': body.model_key,
        'model_version': body.model_version,
        'canonical_prompt': body.canonical_prompt,
        'provider_prompt': body.provider_prompt,
        'provider_prompt_edited': body.provider_prompt_edited,
        'accept_provider_prompt': body.accept_provider_prompt,
        'routing': body.routing,
        'first_frame': body.first_frame,
        'last_frame': body.last_frame,
        'motion': body.motion,
        'audio': body.audio,
        'continuity': continuity,
        'hybrid': body.hybrid,
        'negative_constraints': body.negative_constraints,
        'limitations': body.limitations,
        'aspect_ratio': body.aspect_ratio,
        'expected_duration_ms': body.expected_duration_ms,
        'cost_amount': body.cost_amount,
        'cost_currency': body.cost_currency,
        'cost_note': body.cost_note,
        'source_versions': body.source_versions,
    }


def reference_payloads(body: AiPlanRequest) -> list[dict[str, Any]]:
    return [reference.model_dump() for reference in body.references]


def attempt_payload(body: AttemptRequest) -> dict[str, Any]:
    payload = body.model_dump()
    payload.pop('expected_shot_revision', None)
    return payload
