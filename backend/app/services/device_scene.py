"""Capability-based device, lens, camera-settings and scene-intelligence service."""

from __future__ import annotations
from typing import Any
from uuid import UUID

LAYER = "Camera & Scene Intelligence"
RULE = "A declared capability is not verified. Recommendations label hard device limits, starting points, adjustment rules and creative trade-offs separately; unknown specifications stay unknown."


def decorate_capability(data: dict[str, Any]) -> dict[str, Any]:
    state = data.get("capability_state", "declared")
    data["capability_state_label"] = {"verified": "Verified from a named source", "declared": "Creator-declared; not independently verified", "missing": "Not declared"}.get(
        state, "Unknown"
    )
    data.setdefault("rule", RULE)
    return data


class DeviceSceneRepository:
    def __init__(self, gateway: Any):
        self.gateway = gateway

    async def rpc(self, name: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed(name, token=token, layer=LAYER, json=payload)

    async def declare(self, name: str, w: UUID, r: UUID, token: str, p: dict):
        return await self.rpc(
            name,
            token,
            {"target_workspace": str(w), "target_resource": str(r), "p_facts": p["facts"], "p_source": p["source"], "p_source_label": p["source_label"], "p_notes": p["notes"]},
        )

    async def verify(self, w: UUID, r: UUID, token: str, note: str):
        return await self.rpc("device_capability_verify", token, {"target_workspace": str(w), "target_resource": str(r), "p_note": note})

    async def propose(self, w: UUID, pid: UUID, token: str, p: dict):
        return await self.rpc(
            "camera_settings_propose",
            token,
            {
                "target_workspace": str(w),
                "target_production": str(pid),
                "target_shot": p["shot_id"],
                "target_camera": p["camera_resource_id"],
                "target_lens": p["lens_resource_id"],
                "p_intent": p["intent"],
            },
        )

    async def decide(self, w: UUID, i: UUID, token: str, p: dict):
        return await self.rpc("camera_settings_decide", token, {"target_workspace": str(w), "target_proposal": str(i), "p_decision": p["decision"], "p_note": p["note"]})

    async def requirement(self, w: UUID, token: str, p: dict):
        return await self.rpc(
            "scene_requirement_add",
            token,
            {
                "target_workspace": str(w),
                "target_production": p["production_id"],
                "requirement_kind": p["kind"],
                "detail": p["detail"],
                "target_scene": p["scene_id"],
                "target_shot": p["shot_id"],
                "p_mandatory": p["mandatory"],
                "p_source": p["source"],
            },
        )

    async def settle(self, w: UUID, i: UUID, token: str, p: dict):
        return await self.rpc("scene_requirement_settle", token, {"target_workspace": str(w), "target_requirement": str(i), "p_state": p["state"], "p_note": p["note"]})

    async def scene(self, w: UUID, pid: UUID, token: str, scene_id: str | None):
        return await self.rpc("scene_intelligence", token, {"target_workspace": str(w), "target_production": str(pid), "target_scene": scene_id})

    async def readiness(self, w: UUID, pid: UUID, token: str):
        return await self.rpc("device_readiness", token, {"target_workspace": str(w), "target_production": str(pid)})
