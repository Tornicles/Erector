"""Prompt 6 Real Production Director domain.

The Real Execution Plan is a per-Shot document whose technical values are
RECOMMENDATIONS and STARTING POINTS, not measured truth. This module defines the
bounded shapes the API accepts and the honest vocabulary the director uses.

Nothing here invents equipment facts. A Setup resource is described only by what
the creator entered plus any metadata they supplied.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# --- Honest claim strength. Every technical statement carries one of these. -----

Epistemic = Literal['REQUIRED', 'RECOMMENDED', 'STARTING POINT', 'OPTIONAL', 'UNKNOWN']

RequirementKind = Literal['camera', 'lens', 'stabilization', 'light', 'modifier', 'stand', 'microphone',
    'recorder', 'wireless_audio', 'filter', 'monitor', 'rigging', 'accessory', 'power', 'space',
    'sound', 'talent', 'crew', 'product', 'prop', 'wardrobe', 'environment', 'runtime']

RequirementStatus = Literal['owned', 'substitute', 'missing', 'unverified', 'not_required']

AlternativeKind = Literal['best_quality', 'fastest', 'solo', 'lowest_equipment', 'safest',
    'available_light', 'substitute', 'ai_foundation']

CaptureStatus = Literal['not_started', 'setup', 'shooting', 'captured', 'pickup_needed']

TakeStatus = Literal['recorded', 'review', 'good', 'preferred', 'unusable', 'pickup_required']

DeviationField = Literal['camera', 'lens', 'movement', 'stabilization', 'camera_position', 'lighting',
    'sound', 'location', 'performance', 'product', 'duration', 'other']

PlanStatus = Literal['draft', 'ready', 'ready_with_substitution', 'needs_decision', 'missing_resource', 'safety_blocked']

Readiness = Literal['unplanned', 'ready', 'ready_with_substitution', 'needs_decision', 'missing_resource',
    'safety_blocked']

PlanComplexity = Literal['quick', 'moderate', 'complex']

SoloFeasibility = Literal['solo', 'solo_with_simplification', 'second_person_recommended', 'crew_required']

Edit = Literal['establishing', 'master', 'coverage', 'cutaway', 'reaction', 'insert', 'transition']

MAX_REQUIREMENTS = 60
MAX_ALTERNATIVES = 12
MAX_TAKES_PER_SHOT = 200

# --- Director constraints the creator can impose in words. ---------------------

Constraint = Literal['use_only_owned', 'phone_only', 'one_light', 'no_gimbal', 'available_light_only',
    'simplify', 'faster', 'safer', 'solo', 'reduced_time', 'lost_location', 'lost_light']


class RequirementDraft(BaseModel):
    """One thing a Shot needs, and whether the creator actually has it."""

    model_config = ConfigDict(extra='forbid')

    kind: RequirementKind
    label: str = Field(min_length=1, max_length=160)
    ideal_name: str = Field(default='', max_length=200)
    detail: str = Field(default='', max_length=1200)
    setup_note: str = Field(default='', max_length=600)
    alternative: str = Field(default='', max_length=600)
    status: RequirementStatus
    epistemic: Epistemic = 'REQUIRED'
    resource_type: str | None = Field(default=None, max_length=40)
    resource_id: str | None = None
    substitute_resource_id: str | None = None
    sort_order: int = Field(default=0, ge=0, le=9999)


class AlternativeDraft(BaseModel):
    """A practical alternative way to get the Shot."""

    model_config = ConfigDict(extra='forbid')

    kind: AlternativeKind
    label: str = Field(min_length=1, max_length=160)
    description: str = Field(default='', max_length=1200)
    expected_impact: str = Field(default='', max_length=600)
    tradeoffs: list[str] = Field(default_factory=list, max_length=12)
    sort_order: int = Field(default=0, ge=0, le=9999)


class RealPlanDraft(BaseModel):
    """The Real Execution Plan body. All technical values are labelled claims."""

    model_config = ConfigDict(extra='forbid')

    plan_status: PlanStatus = 'draft'
    readiness_note: str = Field(default='', max_length=600)
    complexity: PlanComplexity | None = None
    complexity_is_estimate: bool = True
    generated_by: Literal['deterministic', 'model', 'creator'] = 'deterministic'
    camera_resource_id: str | None = None
    lens_resource_id: str | None = None

    shot_size: str = Field(default='', max_length=80)
    camera_position: str = Field(default='', max_length=400)
    camera_height: str = Field(default='', max_length=200)
    camera_angle: str = Field(default='', max_length=200)
    framing: str = Field(default='', max_length=300)
    composition: str = Field(default='', max_length=400)
    perspective_note: str = Field(default='', max_length=600)

    movement: str = Field(default='', max_length=200)
    movement_purpose: str = Field(default='', max_length=600)
    stabilization: str = Field(default='', max_length=200)

    capture_fps: str = Field(default='', max_length=80)
    delivery_fps: str = Field(default='', max_length=80)
    shutter: str = Field(default='', max_length=120)
    aperture: str = Field(default='', max_length=120)
    iso_range: str = Field(default='', max_length=120)
    white_balance: str = Field(default='', max_length=160)
    nd_filter: str = Field(default='', max_length=200)
    exposure_note: str = Field(default='', max_length=600)

    focus_strategy: str = Field(default='', max_length=600)
    depth_of_field: str = Field(default='', max_length=400)

    lighting_intent: str = Field(default='', max_length=400)
    lighting_plan: str = Field(default='', max_length=2000)
    lighting_diagram: dict[str, Any] = Field(default_factory=dict)

    blocking: str = Field(default='', max_length=2000)
    performance: str = Field(default='', max_length=2000)
    product_direction: str = Field(default='', max_length=1200)

    sound_plan: str = Field(default='', max_length=2000)
    microphone_plan: str = Field(default='', max_length=1200)
    sync_strategy: str = Field(default='', max_length=600)

    solo_feasibility: SoloFeasibility | None = None
    crew_roles: list[str] = Field(default_factory=list, max_length=12)
    environment_requirements: list[str] = Field(default_factory=list, max_length=16)
    location_requirements: list[str] = Field(default_factory=list, max_length=16)

    safety_notes: list[str] = Field(default_factory=list, max_length=12)
    safety_flags: list[str] = Field(default_factory=list, max_length=12)

    editorial_intent: str = Field(default='', max_length=300)
    setup_steps: list[str] = Field(default_factory=list, max_length=20)
    capture_checklist: list[str] = Field(default_factory=list, max_length=20)
    expected_duration_ms: int | None = Field(default=None, ge=0, le=3_600_000)


class SaveRealPlanRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    expected_shot_revision: int | None = Field(default=None, ge=1)
    plan: RealPlanDraft
    requirements: list[RequirementDraft] = Field(default_factory=list, max_length=MAX_REQUIREMENTS)
    alternatives: list[AlternativeDraft] = Field(default_factory=list, max_length=MAX_ALTERNATIVES)
    operation_id: str | None = None


class DirectShotRequest(BaseModel):
    """Direct a Shot, a Scene or the whole Production with explicit constraints."""

    model_config = ConfigDict(extra='forbid')

    text: str = Field(default='', max_length=1000)
    constraints: list[Constraint] = Field(default_factory=list, max_length=12)
    apply: bool = False
    expected_shot_revision: int | None = Field(default=None, ge=1)


class CaptureStateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: CaptureStatus
    notes: str = Field(default='', max_length=1200)
    expected_revision: int | None = Field(default=None, ge=1)


class TakeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    take_number: int = Field(ge=1, le=999)
    status: TakeStatus = 'recorded'
    notes: str = Field(default='', max_length=1200)
    media_id: str | None = None
    take_id: str | None = None
    expected_revision: int | None = Field(default=None, ge=1)


class DeviationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    field: DeviationField
    planned_value: str = Field(default='', max_length=600)
    actual_value: str = Field(default='', max_length=600)
    reason: str = Field(default='', max_length=600)


class PlanApprovalRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    approval: Literal['draft', 'needs_review', 'approved']
    expected_shot_revision: int | None = Field(default=None, ge=1)


class PlanLockRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    locked: bool
    expected_shot_revision: int | None = Field(default=None, ge=1)


# --- Payload builders: bounded, and never wider than the schema. --------------


def real_plan_payload(draft: RealPlanDraft) -> dict[str, Any]:
    body = draft.model_dump()
    body['lighting_diagram'] = draft.lighting_diagram or {}
    return body


def requirement_payload(draft: RequirementDraft) -> dict[str, Any]:
    return draft.model_dump()


def alternative_payload(draft: AlternativeDraft) -> dict[str, Any]:
    return draft.model_dump()


def take_payload(body: TakeRequest) -> dict[str, Any]:
    payload: dict[str, Any] = {
        'take_number': body.take_number, 'status': body.status, 'notes': body.notes,
    }
    if body.take_id:
        payload['id'] = body.take_id
    if body.media_id:
        payload['media_id'] = body.media_id
    return payload


def deviation_payload(body: DeviationRequest) -> dict[str, Any]:
    return {'field': body.field, 'planned_value': body.planned_value,
        'actual_value': body.actual_value, 'reason': body.reason}
