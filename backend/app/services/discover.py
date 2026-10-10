"""Discover Content Engine repository: curated knowledge with live provenance."""

from __future__ import annotations
from typing import Any
from uuid import UUID

LAYER = "Discover Content Engine"
RULE = "Discover is a curated production knowledge library, not a stock gallery. Each item carries source and rights state; unusable, draft, review and archived content is not shown as published material."
RIGHTS = {
    "unknown": "Rights unknown",
    "user_owned": "User-owned",
    "licensed": "Licensed",
    "brand_owned": "Brand-owned",
    "authorized_identity": "Authorized identity",
    "public_reference": "Public reference",
    "third_party_inspiration": "Third-party inspiration",
}


def decorate_item(data: dict[str, Any]) -> dict[str, Any]:
    prov = data.get("provenance") or {}
    rights = prov.get("rights_classification", "unknown")
    data["rights_state_label"] = RIGHTS.get(rights, "Rights unknown")
    data["usable_label"] = "Available to use as production knowledge" if data.get("usable") else "Not currently usable"
    data.setdefault("rule", RULE)
    return data


def decorate_index(data: dict[str, Any]) -> dict[str, Any]:
    data["items"] = [decorate_item(x) for x in data.get("items", [])]
    data.setdefault("rule", RULE)
    return data


class DiscoverRepository:
    def __init__(self, gateway: Any):
        self.gateway = gateway

    async def rpc(self, name: str, token: str, p: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed(name, token=token, layer=LAYER, json=p)

    async def index(self, w: UUID, token: str, *, kind: str | None, q: str | None, limit: int):
        return await self.rpc("discover_index", token, {"target_workspace": str(w), "p_kind": kind, "p_query": q, "p_limit": limit})

    async def status(self, w: UUID, i: UUID, token: str):
        return await self.rpc("discover_item_status", token, {"target_workspace": str(w), "target_item": str(i)})

    async def register(self, w: UUID, token: str, p: dict):
        return await self.rpc("discover_register_item", token, {"target_workspace": str(w), "p_item": p["item"], "p_visibility": p["visibility"]})

    async def item_action(self, name: str, w: UUID, i: UUID, token: str, **p):
        return await self.rpc(name, token, {"target_workspace": str(w), "target_item": str(i), **p})

    async def collection_create(self, w: UUID, token: str, p: dict):
        return await self.rpc("discover_collection_create", token, {"target_workspace": str(w), "p_name": p["name"], "p_description": p["description"]})

    async def collection_item(self, name: str, w: UUID, c: UUID, i: UUID, token: str, **p):
        return await self.rpc(name, token, {"target_workspace": str(w), "target_collection": str(c), "target_item": str(i), **p})

    async def preview(self, w: UUID, token: str, p: dict):
        return await self.rpc(
            "discover_preview",
            token,
            {
                "target_workspace": str(w),
                "target_item": p["item_id"],
                "p_kind": p["kind"],
                "target_production": p["production_id"],
                "target_scene": p["scene_id"],
                "target_shot": p["shot_id"],
                "p_note": p["note"],
            },
        )

    async def app_action(self, name: str, w: UUID, a: UUID, token: str, **p):
        return await self.rpc(name, token, {"target_workspace": str(w), "target_application": str(a), **p})

    async def app_status(self, w: UUID, a: UUID, token: str):
        return await self.rpc("discover_application_status", token, {"target_workspace": str(w), "target_application": str(a)})
