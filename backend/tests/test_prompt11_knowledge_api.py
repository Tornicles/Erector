"""Knowledge Engine HTTP contract, authorization and truthfulness tests."""

from __future__ import annotations
import json
import httpx
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app

USER = "00000000-0000-4000-8000-000000000001"
WORK = "00000000-0000-4000-8000-000000000010"
ITEM = "00000000-0000-4000-8000-000000000021"
TUTORIAL = "00000000-0000-4000-8000-000000000031"
STEP = "00000000-0000-4000-8000-000000000041"
H = {"Authorization": "Bearer session"}


def base():
    return f"/api/v1/workspaces/{WORK}/knowledge"


def client_for(role="owner"):
    state = {"calls": [], "writes": []}

    def handler(req):
        if req.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": USER})
        if req.url.path == "/rest/v1/workspace_members":
            wanted = req.url.params.get("role", "")
            if wanted.startswith("in.(") and role not in wanted[4:-1].split(","):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{"role": role}])
        if "/rpc/" not in req.url.path:
            return httpx.Response(200, json=[])
        name = req.url.path.rsplit("/", 1)[-1]
        p = json.loads(req.content or b"{}")
        state["calls"].append((name, p))
        if name == "knowledge_search":
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "item_id": ITEM,
                            "canonical_id": "dolly-zoom",
                            "name": "Dolly zoom",
                            "source_kind": "import",
                            "review_state": "pending_review",
                            "usable_for_guidance": False,
                            "sources": [{"source_kind": "manufacturer", "label": "Camera manual", "locator": "https://example.test/manual"}],
                            "adaptation": {"closest_kit_match": "handheld dolly-like move"},
                        }
                    ],
                    "open_conflicts": [],
                },
            )
        if name == "knowledge_item_create":
            state["writes"].append((name, p))
            return httpx.Response(200, json={"item_id": ITEM, "review_state": "pending_review", "usable_for_guidance": False})
        if name == "knowledge_item_status":
            return httpx.Response(
                200,
                json={
                    "item_id": ITEM,
                    "source_kind": "import",
                    "review_state": "pending_review",
                    "sources": [{"source_kind": "external_publication", "label": "Article", "locator": "https://example.test"}],
                    "adaptation": {"closest_kit_match": "handheld"},
                },
            )
        if name == "knowledge_import_request":
            state["writes"].append((name, p))
            return httpx.Response(
                200, json={"import_id": "import-1", "state": "partial", "accepted_count": 1, "rejected_count": 1, "rejections": [{"index": 2, "reason": "MISSING_PROVENANCE"}]}
            )
        if name == "tutorial_register":
            state["writes"].append((name, p))
            return httpx.Response(200, json={"tutorial_id": TUTORIAL, "state": "registered"})
        if name == "tutorial_step_add":
            state["writes"].append((name, p))
            return httpx.Response(200, json={"step_id": STEP, "tutorial_id": TUTORIAL, "ordinal": 1, "state": "ready_for_review"})
        if name == "tutorial_publish":
            return httpx.Response(200, json={"tutorial_id": TUTORIAL, "state": "published"})
        if name == "tutorial_step_promote":
            return httpx.Response(200, json={"item_id": ITEM, "review_state": "pending_review", "usable_for_guidance": False})
        if name == "knowledge_item_review" and p["p_decision"] == "reviewed":
            return httpx.Response(200, json={"item_id": ITEM, "review_state": "reviewed", "usable_for_guidance": True})
        if name == "knowledge_conflict_open":
            return httpx.Response(200, json={"conflict_id": "conflict-1", "state": "open"})
        return httpx.Response(200, json={"item_id": ITEM, "state": "ok"})

    settings = Settings(_env_file=None, supabase_url="https://demo.supabase.co", supabase_publishable_key="anon", app_env="test")
    c = TestClient(create_app(settings, httpx.MockTransport(handler)))
    c.__enter__()
    return c, state


def test_knowledge_search_keeps_source_and_tonde_adaptation_separate():
    c, _ = client_for()
    r = c.get(base() + "?q=dolly&include_unreviewed=false", headers=H)
    assert r.status_code == 200
    item = r.json()["data"]["items"][0]
    assert item["usable_for_guidance"] is False
    assert item["sources"][0]["locator"].startswith("https:")
    assert item["adaptation"]["closest_kit_match"] == "handheld dolly-like move"
    assert item["source_adaptation_boundary"] == "Source knowledge"


def test_creator_knowledge_creation_is_editor_gated_and_maps_fields():
    c, s = client_for("viewer")
    assert c.post(base(), headers=H, json={"canonical_id": "dolly-zoom"}).status_code == 403
    c, s = client_for()
    r = c.post(
        base(),
        headers=H,
        json={
            "canonical_id": "dolly-zoom",
            "name": "Dolly zoom",
            "category": "camera",
            "description": "Perspective change",
            "purpose": "Tension",
            "effect": "Background expands",
            "knowledge_class": "technique",
            "source_kind": "import",
            "tonde_guidance": "Use handheld slide only if kit permits",
            "applicability": {"movement": "push"},
            "adaptation": {"closest_kit_match": "slider"},
            "sources": [{"label": "Manual", "source_kind": "manufacturer", "locator": "https://example.test"}],
        },
    )
    assert r.status_code == 200
    name, p = s["writes"][0]
    assert name == "knowledge_item_create" and p["p_source_kind"] == "import" and p["p_adaptation"]["closest_kit_match"] == "slider" and p["p_sources"][0]["label"] == "Manual"


def test_knowledge_review_is_admin_only():
    c, s = client_for("editor")
    r = c.post(base() + f"/{ITEM}/review", headers=H, json={"decision": "reviewed"})
    assert r.status_code == 403 and not s["writes"]
    c, s = client_for("admin")
    assert c.post(base() + f"/{ITEM}/review", headers=H, json={"decision": "reviewed", "note": "Source checked"}).status_code == 200


def test_import_is_partial_and_provenance_is_not_inferred():
    c, s = client_for()
    r = c.post(
        base() + "/imports", headers=H, json={"format": "json", "source_label": "captured lessons", "payload": [{"canonical_id": "dolly-zoom"}], "attribution": "Creator notes"}
    )
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["state"] == "partial" and data["rejected_count"] == 1
    assert s["writes"][0][1]["p_attribution"] == "Creator notes"


def test_external_tutorial_needs_attribution_or_license():
    c, s = client_for()
    r = c.post(base() + "/tutorials", headers=H, json={"title": "Camera lesson", "source_kind": "external_video", "locator": "https://example.test"})
    assert r.status_code == 422
    assert not s["writes"]


def test_tutorial_ingestion_tracks_source_steps_and_promotion():
    c, s = client_for()
    r = c.post(base() + "/tutorials", headers=H, json={"title": "Creator camera notes", "source_kind": "creator_note"})
    assert r.status_code == 200
    tid = r.json()["data"]["tutorial_id"]
    step = c.post(
        base() + f"/tutorials/{tid}/steps",
        headers=H,
        json={"ordinal": 1, "title": "Frame subject", "instruction": "Begin with a wide frame", "settings": {"focal": "50mm"}, "evidence": {"provenance": "creator_note"}},
    )
    assert step.status_code == 200
    assert s["writes"][0][1]["p_source_kind"] == "creator_note"
    assert s["writes"][1][1]["p_evidence"]["provenance"] == "creator_note"


def test_missing_or_incomplete_sources_never_become_tonde_claims():
    c, _ = client_for()
    item = c.get(base() + f"/{ITEM}", headers=H).json()["data"]
    assert item["source_kind"] == "import"
    assert item["sources"][0]["source_kind_label"] == "External publication"
    assert item["adaptation"]["closest_kit_match"] == "handheld"
