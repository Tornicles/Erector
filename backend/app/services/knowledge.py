"""Production Knowledge Engine repository and honest display vocabulary."""

from __future__ import annotations
from typing import Any
from uuid import UUID
from app.domain.knowledge import CATEGORIES, KNOWLEDGE_CLASSES, SOURCE_KINDS

LAYER = "Production Knowledge"
RULE = "Source knowledge and TONDE adaptation are separate records. An import or tutorial is not usable guidance until a different reviewer approves it; a source citation is preserved, not republished."
SOURCE_LABELS = {
    "creator": "Creator assertion",
    "reference": "Reference",
    "tutorial": "Tutorial",
    "import": "Import",
    "external_publication": "External publication",
    "standards_body": "Standards body",
    "tonde_canon": "TONDE canon",
    "manufacturer": "Manufacturer",
}


def vocabulary() -> dict[str, Any]:
    return {"knowledge_classes": list(KNOWLEDGE_CLASSES), "categories": list(CATEGORIES), "source_kinds": list(SOURCE_KINDS), "source_labels": SOURCE_LABELS, "rule": RULE}


def decorate_item(item: dict[str, Any]) -> dict[str, Any]:
    sources = item.get("sources") or []
    for source in sources:
        source["source_kind_label"] = SOURCE_LABELS.get(source.get("source_kind"), "Source")
    item["sources"] = sources
    item["usable_for_guidance"] = bool(item.get("usable_for_guidance"))
    item["source_adaptation_boundary"] = "Source knowledge" if item.get("source_kind") in ("import", "tutorial", "reference") else "Creator knowledge"
    item["adaptation_label"] = "TONDE adaptation for this Production Kit" if item.get("adaptation") else "No TONDE adaptation recorded"
    item.setdefault("rule", RULE)
    return item


def decorate_search(data: dict[str, Any]) -> dict[str, Any]:
    data["items"] = [decorate_item(x) for x in data.get("items", [])]
    data.setdefault("rule", RULE)
    return data


class KnowledgeRepository:
    def __init__(self, gateway: Any):
        self.gateway = gateway

    async def rpc(self, name: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed(name, token=token, layer=LAYER, json=payload)

    async def search(self, w: UUID, token: str, *, query: str | None, category: str | None, knowledge_class: str | None, include_unreviewed: bool, limit: int):
        return await self.rpc(
            "knowledge_search",
            token,
            {
                "target_workspace": str(w),
                "p_query": query,
                "p_category": category,
                "p_knowledge_class": knowledge_class,
                "p_include_unreviewed": include_unreviewed,
                "p_limit": limit,
            },
        )

    async def status(self, w: UUID, i: UUID, token: str):
        return await self.rpc("knowledge_item_status", token, {"target_workspace": str(w), "target_item": str(i)})

    async def create(self, w: UUID, token: str, p: dict[str, Any]):
        return await self.rpc(
            "knowledge_item_create",
            token,
            {
                "target_workspace": str(w),
                "p_canonical_id": p["canonical_id"],
                "p_name": p["name"],
                "p_category": p["category"],
                "p_description": p["description"],
                "p_purpose": p["purpose"],
                "p_effect": p["effect"],
                "p_knowledge_class": p["knowledge_class"],
                "p_source_kind": p["source_kind"],
                "p_guidance": p["tonde_guidance"],
                "p_applicability": p["applicability"],
                "p_adaptation": p["adaptation"],
                "p_sources": p["sources"],
                "p_pending_review": p["pending_review"],
            },
        )

    async def item_action(self, name: str, w: UUID, i: UUID, token: str, **values):
        return await self.rpc(name, token, {"target_workspace": str(w), "target_item": str(i), **values})

    async def source_add(self, w: UUID, i: UUID, token: str, source: dict):
        return await self.rpc("knowledge_source_add", token, {"target_workspace": str(w), "target_item": str(i), "p_source": source})

    async def conflict_open(self, w: UUID, token: str, p: dict):
        return await self.rpc(
            "knowledge_conflict_open",
            token,
            {
                "target_workspace": str(w),
                "p_subject": p["subject"],
                "p_kind": p["kind"],
                "p_primary_claim": p["primary_claim"],
                "p_secondary_claim": p["secondary_claim"],
                "p_severity": p["severity"],
                "p_primary_item": p["primary_item_id"],
                "p_secondary_item": p["secondary_item_id"],
                "p_evidence": p["evidence"],
                "p_detected_by": p["detected_by"],
            },
        )

    async def conflict_resolve(self, w: UUID, i: UUID, token: str, p: dict):
        return await self.rpc("knowledge_conflict_resolve", token, {"target_workspace": str(w), "target_conflict": str(i), "p_resolution": p["resolution"], "p_note": p["note"]})

    async def tutorial_register(self, w: UUID, token: str, p: dict):
        return await self.rpc(
            "tutorial_register",
            token,
            {
                "target_workspace": str(w),
                "p_title": p["title"],
                "p_source_kind": p["source_kind"],
                "p_media": p["media_id"],
                "p_locator": p["locator"],
                "p_attribution": p["attribution"],
                "p_license": p["license"],
                "p_language": p["language"],
                "p_notes": p["notes"],
            },
        )

    async def tutorial_step(self, w: UUID, t: UUID, token: str, p: dict):
        return await self.rpc(
            "tutorial_step_add",
            token,
            {
                "target_workspace": str(w),
                "target_tutorial": str(t),
                "p_ordinal": p["ordinal"],
                "p_title": p["title"],
                "p_instruction": p["instruction"],
                "p_technique": p["technique_id"],
                "p_settings": p["settings"],
                "p_evidence": p["evidence"],
            },
        )

    async def tutorial_action(self, name: str, w: UUID, i: UUID, token: str, **values):
        return await self.rpc(name, token, {"target_workspace": str(w), "target_tutorial": str(i), **values})

    async def tutorial_promote(self, w: UUID, s: UUID, token: str, p: dict):
        return await self.rpc(
            "tutorial_step_promote",
            token,
            {
                "target_workspace": str(w),
                "target_step": str(s),
                "p_canonical_id": p["canonical_id"],
                "p_name": p["name"],
                "p_category": p["category"],
                "p_guidance": p["guidance"],
                "p_adaptation": p["adaptation"],
                "p_applicability": p["applicability"],
            },
        )

    async def import_request(self, w: UUID, token: str, p: dict):
        return await self.rpc(
            "knowledge_import_request",
            token,
            {
                "target_workspace": str(w),
                "p_format": p["format"],
                "p_source_label": p["source_label"],
                "p_payload": p["payload"],
                "p_source_locator": p["source_locator"],
                "p_license": p["license"],
                "p_attribution": p["attribution"],
                "p_dry_run": p["dry_run"],
            },
        )
