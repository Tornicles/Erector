"""Camera/device capability and reusable Scene-intelligence HTTP surface."""

from __future__ import annotations
import logging
from typing import Any
from uuid import UUID
from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError
from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor, require_workspace_admin
from app.domain.device_scene import (
    DEVICE_SOURCES,
    SCENE_REQUIREMENTS,
    CameraSettingsDecision,
    CameraSettingsProposal,
    CapabilityDeclaration,
    CapabilityVerification,
    SceneRequirementCreate,
    SceneRequirementDecision,
)
from app.services.device_scene import DeviceSceneRepository, decorate_capability

Envelope = Any


def _body(model: type[Any], raw: Any) -> Any:
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", str(e.errors()[0].get("msg", "Check the fields.")), 422) from e


def _uuid(v: str, msg: str) -> UUID:
    try:
        return UUID(v)
    except (ValueError, TypeError, AttributeError) as e:
        raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", msg, 422) from e


def register_device_scene_routes(app: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    base = "/api/v1/workspaces/{workspace_id}"
    repo = DeviceSceneRepository

    @app.put(base + "/resources/{resource_id}/device-capability")
    async def declare_device(
        workspace_id: UUID, resource_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(CapabilityDeclaration, await request.json())
        if p.source not in DEVICE_SOURCES:
            raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", "Capability must name its source.", 422)
        return envelope(
            request,
            decorate_capability(
                await repo(gateway).declare("device_capability_declare", workspace_id, _uuid(resource_id, "Invalid resource id."), request.state.access_token, p.model_dump())
            ),
        )

    @app.put(base + "/resources/{resource_id}/lens-capability")
    async def declare_lens(
        workspace_id: UUID, resource_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(CapabilityDeclaration, await request.json())
        if p.source not in DEVICE_SOURCES:
            raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", "Capability must name its source.", 422)
        return envelope(
            request,
            decorate_capability(
                await repo(gateway).declare("lens_capability_declare", workspace_id, _uuid(resource_id, "Invalid resource id."), request.state.access_token, p.model_dump())
            ),
        )

    @app.post(base + "/resources/{resource_id}/capability-verify")
    async def verify(workspace_id: UUID, resource_id: str, request: Request, user: CurrentUser = Depends(require_workspace_admin), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(CapabilityVerification, {"resource_id": resource_id, **(await request.json())})
        return envelope(request, await repo(gateway).verify(workspace_id, _uuid(resource_id, "Invalid resource id."), request.state.access_token, p.note))

    @app.post(base + "/productions/{production_id}/camera-settings/proposals")
    async def propose(
        workspace_id: UUID, production_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(CameraSettingsProposal, await request.json())
        data = await repo(gateway).propose(workspace_id, _uuid(production_id, "Invalid Production id."), request.state.access_token, p.model_dump())
        data["interpretation"] = {
            "hard_capability": "Declared device/lens facts and explicit refusals",
            "starting_point": "Settings are a revisable start, not an exposure guarantee",
            "adjustment_rule": "Adjust from observed meter/histogram and image review",
            "creative_tradeoff": "Creator intent determines the trade-off",
        }
        return envelope(request, data)

    @app.post(base + "/camera-settings/proposals/{proposal_id}/decision")
    async def decide(
        workspace_id: UUID, proposal_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(CameraSettingsDecision, await request.json())
        if p.decision not in ("accept", "reject"):
            raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", "Decision is accept or reject.", 422)
        if p.decision == "reject" and not p.note.strip():
            raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", "A rejection says why.", 422)
        return envelope(request, await repo(gateway).decide(workspace_id, _uuid(proposal_id, "Invalid proposal id."), request.state.access_token, p.model_dump()))

    @app.post(base + "/productions/{production_id}/scene-requirements")
    async def add_requirement(
        workspace_id: UUID, production_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(SceneRequirementCreate, {"production_id": production_id, **(await request.json())})
        if p.kind not in SCENE_REQUIREMENTS:
            raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", "Unknown Scene requirement kind.", 422)
        if not p.scene_id and not p.shot_id:
            raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", "A Scene requirement needs a Scene or Shot scope.", 422)
        for val, msg in ((p.scene_id, "Invalid Scene id."), (p.shot_id, "Invalid Shot id.")):
            if val:
                _uuid(val, msg)
        return envelope(request, await repo(gateway).requirement(workspace_id, request.state.access_token, p.model_dump()))

    @app.post(base + "/scene-requirements/{requirement_id}/decision")
    async def settle(
        workspace_id: UUID, requirement_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(SceneRequirementDecision, await request.json())
        if p.state not in ("met", "waived", "open") or (p.state == "waived" and not p.note.strip()):
            raise AppError("INVALID_DEVICE_SCENE_INPUT", "validation", "Choose met/open, or give a reason for waiving.", 422)
        return envelope(request, await repo(gateway).settle(workspace_id, _uuid(requirement_id, "Invalid requirement id."), request.state.access_token, p.model_dump()))

    @app.get(base + "/productions/{production_id}/scene-intelligence")
    async def scene(
        workspace_id: UUID, production_id: str, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        scene_id = request.query_params.get("scene_id")
        if scene_id:
            _uuid(scene_id, "Invalid Scene id.")
        return envelope(request, await repo(gateway).scene(workspace_id, _uuid(production_id, "Invalid Production id."), request.state.access_token, scene_id))

    @app.get(base + "/productions/{production_id}/device-readiness")
    async def readiness(
        workspace_id: UUID, production_id: str, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        return envelope(request, await repo(gateway).readiness(workspace_id, _uuid(production_id, "Invalid Production id."), request.state.access_token))
