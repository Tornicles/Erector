"""Discover Content Engine and Create This HTTP surface tests."""

from __future__ import annotations
import json
import httpx
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app

USER = "00000000-0000-4000-8000-000000000001"
WORK = "00000000-0000-4000-8000-000000000010"
PROD = "00000000-0000-4000-8000-000000000020"
ITEM = "00000000-0000-4000-8000-000000000030"
APP = "00000000-0000-4000-8000-000000000040"
H = {"Authorization": "Bearer session"}


def base():
    return f"/api/v1/workspaces/{WORK}/discover"


def client_for(role="owner"):
    state = {"calls": []}

    def handler(req):
        if req.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": USER})
        if req.url.path == "/rest/v1/workspace_members":
            if req.url.params.get("workspace_id") != f"eq.{WORK}":
                return httpx.Response(200, json=[])
            wanted = req.url.params.get("role", "")
            if wanted.startswith("in.(") and role not in wanted[4:-1].split(","):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{"role": role}])
        name = req.url.path.rsplit("/", 1)[-1]
        p = json.loads(req.content or b"{}")
        state["calls"].append((name, p))
        item = {
            "item_id": ITEM,
            "canonical_id": "slow-dolly",
            "item_kind": "technique",
            "title": "Slow dolly",
            "summary": "Move laterally",
            "visibility": "global",
            "review_state": "curated",
            "source_state": "usable",
            "usable": True,
            "provenance": {"source_label": "TONDE library", "rights_classification": "third_party_inspiration"},
            "applicability": {"category": "camera"},
        }
        if name == "discover_index":
            return httpx.Response(200, json={"items": [item], "count": 1})
        if name == "discover_item_status":
            return httpx.Response(200, json={**item, "support": {"direct_this": {"available": True}}, "saved_by_you": False, "applications": []})
        if name == "discover_save":
            return httpx.Response(200, json={"item_id": ITEM, "idempotent": False})
        if name == "discover_unsave":
            return httpx.Response(200, json={"item_id": ITEM, "removed": 1})
        if name == "discover_preview":
            return httpx.Response(
                200,
                json={
                    "application_id": APP,
                    "state": "previewed",
                    "impact": {"confirmation": "slow-dolly", "changes": [{"object": "Production reference"}], "creates_nothing": True},
                },
            )
        if name == "discover_apply":
            return httpx.Response(
                200,
                json={
                    "application_id": APP,
                    "state": "applied",
                    "idempotent": False,
                    "applied_object_kind": "production_reference",
                    "applied_object_id": "reference-1",
                    "production_id": PROD,
                },
            )
        if name == "discover_application_status":
            return httpx.Response(200, json={"application_id": APP, "state": "applied", "canonical_id": "slow-dolly", "applied_object_kind": "production_reference"})
        if name == "discover_withdraw":
            return httpx.Response(200, json={"application_id": APP, "state": "withdrawn", "idempotent": False})
        if name == "discover_collection_create":
            return httpx.Response(200, json={"collection_id": "collection-1", "idempotent": False})
        return httpx.Response(200, json={"ok": True})

    settings = Settings(_env_file=None, supabase_url="https://demo.supabase.co", supabase_publishable_key="anon", app_env="test")
    c = TestClient(create_app(settings, httpx.MockTransport(handler)))
    c.__enter__()
    return c, state


def test_discover_index_searches_content_and_preserves_rights_state():
    c, s = client_for()
    r = c.get(base() + "?kind=technique&q=dolly", headers=H)
    assert r.status_code == 200
    item = r.json()["data"]["items"][0]
    assert item["rights_state_label"] == "Third-party inspiration"
    assert item["usable_label"].startswith("Available")
    assert s["calls"][0][1]["p_query"] == "dolly"


def test_discover_saves_are_creator_authorized_and_unsave_is_scoped():
    # Any workspace member can save to their own list; an outsider cannot cross the tenant boundary.
    c, s = client_for()
    outsider = f"/api/v1/workspaces/00000000-0000-4000-8000-000000000099/discover/{ITEM}/save"
    assert c.post(outsider, headers=H, json={"note": "Try this"}).status_code == 403
    c, s = client_for()
    assert c.post(base() + f"/{ITEM}/save", headers=H, json={"note": "Try this"}).status_code == 200
    assert c.delete(base() + f"/{ITEM}/save", headers=H).status_code == 200
    assert [x[0] for x in s["calls"]] == ["discover_save", "discover_unsave"]


def test_creators_cannot_publish_curated_global_discover_items():
    c, s = client_for()
    r = c.post(
        base() + "/curate",
        headers=H,
        json={"visibility": "global", "item": {"canonical_id": "fake-item", "item_kind": "technique", "source_kind": "tonde_canon", "provenance": {"source_label": "fake"}}},
    )
    assert r.status_code == 403
    assert s["calls"] == []


def test_workspace_discover_item_requires_provenance():
    c, s = client_for()
    r = c.post(
        base() + "/curate", headers=H, json={"visibility": "workspace", "item": {"canonical_id": "my-item", "item_kind": "inspiration", "source_kind": "creator", "provenance": {}}}
    )
    assert r.status_code == 422
    assert s["calls"] == []


def test_create_this_previews_first_and_confirms_the_canonical_id():
    c, s = client_for()
    r = c.post(base() + "/create-this/previews", headers=H, json={"item_id": ITEM, "kind": "direct_this", "production_id": PROD})
    assert r.status_code == 200
    impact = r.json()["data"]["impact"]
    assert impact["creates_nothing"] is True
    assert impact["confirmation"] == "slow-dolly"
    applied = c.post(base() + f"/create-this/applications/{APP}/apply", headers=H, json={"confirmation": "slow-dolly"})
    assert applied.status_code == 200
    assert applied.json()["data"]["applied_object_kind"] == "production_reference"
    assert s["calls"][0][1]["p_kind"] == "direct_this"
    assert s["calls"][1][1]["p_confirmation"] == "slow-dolly"


def test_create_this_rejects_invalid_kind_and_bad_ids_before_rpc():
    c, s = client_for()
    r = c.post(base() + "/create-this/previews", headers=H, json={"item_id": "not-id", "kind": "clone_whole_scene", "production_id": PROD})
    assert r.status_code == 422
    assert s["calls"] == []


def test_collection_create_is_editor_scoped():
    c, s = client_for("viewer")
    assert c.post(base() + "/collections", headers=H, json={"name": "Ideas"}).status_code == 403
    c, s = client_for()
    assert c.post(base() + "/collections", headers=H, json={"name": "Ideas"}).status_code == 200
    assert s["calls"][0][1]["p_name"] == "Ideas"
