"""Validation API integration tests — Prompt A3."""

import pytest

from conftest import make_validation_payload


LIFECYCLE_PATH = [
    ("context_collected", "Context collected"),
    ("economic_stack_built", "Economic stack built"),
    ("engines_running", "Engines running"),
    ("partial_results", "Partial results"),
    ("scoring", "Scoring"),
    ("recursive_challenge", "Recursive challenge"),
    ("path_generation", "Path generation"),
    ("report_ready", "Report ready"),
    ("completed", "Completed"),
]


class TestValidationAPI:
    def test_create_validation(self, client, auth_headers):
        resp = client.post(
            "/api/v1/validations",
            json=make_validation_payload(),
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()["data"]
        assert data["validation_id"].startswith("val_")
        assert data["created"] is True

    def test_envelope_shape(self, client, auth_headers):
        resp = client.post(
            "/api/v1/validations",
            json=make_validation_payload(raw_goal="Unique goal for envelope test"),
            headers=auth_headers,
        )
        body = resp.json()
        assert body["success"] is True
        assert "metadata" in body

    def test_created_status_is_draft_or_collecting(self, client, auth_headers):
        resp = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Minimal goal only"},
            headers=auth_headers,
        )
        status = resp.json()["data"]["status"]
        assert status in ("draft", "context_collecting")

    def test_get_validation(self, client, auth_headers):
        created = client.post(
            "/api/v1/validations",
            json=make_validation_payload(raw_goal="Get validation test goal"),
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        resp = client.get(f"/api/v1/validations/{vid}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["validation"]["validation_id"] == vid

    def test_list_user_validations(self, client, auth_headers):
        client.post(
            "/api/v1/validations",
            json=make_validation_payload(raw_goal="List test goal alpha"),
            headers=auth_headers,
        )
        resp = client.get("/api/v1/validations", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["total"] >= 1

    def test_patch_state_valid_transition(self, client, auth_headers):
        created = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Transition test goal"},
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        resp = client.patch(
            f"/api/v1/validations/{vid}/state",
            json={"next_status": "context_collected", "reason": "Manual test"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["current_status"] == "context_collected"

    def test_patch_state_invalid_transition(self, client, auth_headers):
        created = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Invalid transition test"},
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        resp = client.patch(
            f"/api/v1/validations/{vid}/state",
            json={"next_status": "scoring", "reason": "Should fail"},
            headers=auth_headers,
        )
        assert resp.status_code == 409
        assert resp.json()["success"] is False

    def test_fail_validation(self, client, auth_headers):
        created = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Fail test goal"},
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        resp = client.post(
            f"/api/v1/validations/{vid}/fail",
            json={"reason": "Test failure", "error_code": "TEST_FAIL"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "failed"

    def test_archive_validation(self, client, auth_headers):
        created = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Archive test goal"},
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        client.post(
            f"/api/v1/validations/{vid}/fail",
            json={"reason": "Archive prep"},
            headers=auth_headers,
        )
        resp = client.post(f"/api/v1/validations/{vid}/archive", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "archived"

    def test_get_events(self, client, auth_headers):
        created = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Events test goal"},
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        resp = client.get(f"/api/v1/validations/{vid}/events", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["total"] >= 1

    def test_get_health(self, client, auth_headers):
        created = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Health test goal"},
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        resp = client.get(f"/api/v1/validations/{vid}/health", headers=auth_headers)
        assert resp.status_code == 200
        assert "is_stuck" in resp.json()["data"]

    def test_unauthenticated_rejected(self, client):
        resp = client.post("/api/v1/validations", json={"raw_goal": "No auth"})
        assert resp.status_code == 401

    def test_cross_user_returns_404(self, client, auth_headers, auth_headers_user2):
        created = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Cross user test"},
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        resp = client.get(f"/api/v1/validations/{vid}", headers=auth_headers_user2)
        assert resp.status_code == 404

    def test_full_lifecycle_manual_gate(self, client, auth_headers):
        created = client.post(
            "/api/v1/validations",
            json={"raw_goal": "Full lifecycle gate test"},
            headers=auth_headers,
        ).json()["data"]
        vid = created["validation_id"]
        for status, reason in LIFECYCLE_PATH:
            resp = client.patch(
                f"/api/v1/validations/{vid}/state",
                json={"next_status": status, "reason": reason},
                headers=auth_headers,
            )
            assert resp.status_code == 200, f"Failed at {status}: {resp.text}"
        final = client.get(f"/api/v1/validations/{vid}", headers=auth_headers).json()["data"]
        assert final["validation"]["status"] == "completed"
