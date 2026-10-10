"""Camera capability, Settings Engine and reusable Scene requirements API tests."""

from __future__ import annotations
import json
import httpx
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app

USER = "00000000-0000-4000-8000-000000000001"
WORK = "00000000-0000-4000-8000-000000000010"
PROD = "00000000-0000-4000-8000-000000000020"
SHOT = "00000000-0000-4000-8000-000000000030"
CAM = "00000000-0000-4000-8000-000000000040"
LENS = "00000000-0000-4000-8000-000000000050"
PROP = "00000000-0000-4000-8000-000000000060"
H = {"Authorization": "Bearer session"}


def base():
    return f"/api/v1/workspaces/{WORK}"


def client_for(role="owner"):
    state = {"calls": []}

    def handler(req):
        if req.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": USER})
        if req.url.path == "/rest/v1/workspace_members":
            wanted = req.url.params.get("role", "")
            if wanted.startswith("in.(") and role not in wanted[4:-1].split(","):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{"role": role}])
        name = req.url.path.rsplit("/", 1)[-1]
        p = json.loads(req.content or b"{}")
        state["calls"].append((name, p))
        if name == "device_capability_declare":
            return httpx.Response(200, json={"resource_id": CAM, "capability_state": "declared", "sensor_format": "unknown", "crop_factor": 1, "sensor_diagonal_mm": 28.3})
        if name == "lens_capability_declare":
            return httpx.Response(200, json={"resource_id": LENS, "capability_state": "declared", "mount": "E", "focal_range": [24, 70]})
        if name == "device_capability_verify":
            return httpx.Response(200, json={"capability_state": "verified"})
        if name == "camera_settings_propose":
            return httpx.Response(
                200,
                json={
                    "proposal_id": PROP,
                    "satisfied": False,
                    "settings": {"frame_rate": 24, "shutter_seconds": 0.008333, "aperture": "starting_point", "iso": "starting_point"},
                    "refusals": [{"reason": "MOUNT_MISMATCH"}],
                },
            )
        if name == "camera_settings_decide":
            return httpx.Response(200, json={"proposal_id": PROP, "state": "accepted", "applied_plan_id": "plan-1"})
        if name == "scene_requirement_add":
            return httpx.Response(200, json={"requirement_id": "req-1", "state": "open", "mandatory": True})
        if name == "scene_requirement_settle":
            return httpx.Response(200, json={"requirement_id": "req-1", "state": p["p_state"]})
        if name == "scene_intelligence":
            return httpx.Response(
                200,
                json={
                    "requirements": [{"kind": "movement", "detail": "slow dolly"}],
                    "devices": [{"name": "Phone camera", "capability_state": "declared"}],
                    "gaps": [{"reason": "NO_DEVICE_DECLARED"}],
                    "shots": [],
                },
            )
        if name == "device_readiness":
            return httpx.Response(
                200, json={"devices": [{"name": "Phone", "capability_state": "declared"}], "shots": [{"shot_id": SHOT, "has_real_plan": False}], "unsatisfied_proposals": []}
            )
        return httpx.Response(200, json={})

    settings = Settings(_env_file=None, supabase_url="https://demo.supabase.co", supabase_publishable_key="anon", app_env="test")
    c = TestClient(create_app(settings, httpx.MockTransport(handler)))
    c.__enter__()
    return c, state


def test_device_and_lens_capabilities_are_declared_not_fabricated():
    c, s = client_for()
    r = c.put(
        base() + f"/resources/{CAM}/device-capability",
        headers=H,
        json={"resource_id": CAM, "facts": {"device_kind": "phone_camera", "frame_rates": [24, 30]}, "source": "creator", "source_label": "Creator entry"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["capability_state"] == "declared"
    assert r.json()["data"]["capability_state_label"].startswith("Creator-declared")
    assert s["calls"][0][1]["p_facts"]["frame_rates"] == [24, 30]


def test_capability_writes_require_editor_and_verification_requires_admin():
    c, s = client_for("viewer")
    assert c.put(base() + f"/resources/{CAM}/device-capability", headers=H, json={"facts": {}}).status_code == 403
    c, s = client_for("editor")
    assert c.post(base() + f"/resources/{CAM}/capability-verify", headers=H, json={"note": "Checked"}).status_code == 403


def test_settings_are_proposed_as_starting_points_and_only_applied_by_decision():
    c, s = client_for()
    r = c.post(
        base() + f"/productions/{PROD}/camera-settings/proposals",
        headers=H,
        json={"shot_id": SHOT, "camera_resource_id": CAM, "lens_resource_id": LENS, "intent": {"frame_rate": 24, "lighting": "low", "desired_look": "shallow depth"}},
    )
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["interpretation"]["starting_point"].startswith("Settings are a revisable start")
    assert data["refusals"][0]["reason"] == "MOUNT_MISMATCH"
    name, p = s["calls"][0]
    assert name == "camera_settings_propose" and p["p_intent"]["desired_look"] == "shallow depth"


def test_scene_requirements_are_reusable_and_scene_intelligence_states_unknowns():
    c, s = client_for()
    r = c.post(
        base() + f"/productions/{PROD}/scene-requirements",
        headers=H,
        json={"kind": "movement", "detail": "slow lateral push", "scene_id": "00000000-0000-4000-8000-000000000070", "mandatory": True},
    )
    assert r.status_code == 200
    intelligence = c.get(base() + f"/productions/{PROD}/scene-intelligence", headers=H).json()["data"]
    assert intelligence["devices"][0]["capability_state"] == "declared"
    assert intelligence["gaps"][0]["reason"] == "NO_DEVICE_DECLARED"
    assert s["calls"][0][1]["requirement_kind"] == "movement"


def test_scene_requirement_waiver_needs_reason_and_settings_enforce_closed_decisions():
    c, s = client_for()
    bad = c.post(base() + "/scene-requirements/00000000-0000-4000-8000-000000000080/decision", headers=H, json={"state": "waived"})
    assert bad.status_code == 422
    good = c.post(base() + "/scene-requirements/00000000-0000-4000-8000-000000000080/decision", headers=H, json={"state": "waived", "note": "No practical option in this scene"})
    assert good.status_code == 200
    assert s["calls"][0][1]["p_state"] == "waived"


def test_device_readiness_reports_capability_state_and_plan_coverage():
    c, _ = client_for()
    data = c.get(base() + f"/productions/{PROD}/device-readiness", headers=H).json()["data"]
    assert data["devices"][0]["capability_state"] == "declared"
    assert data["shots"][0]["has_real_plan"] is False
