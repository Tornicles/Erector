"""Context API integration tests — Prompt A4."""

import pytest

from conftest import auth_headers, make_validation_payload


GAMING_ANSWERS = [
    {"question_id": "basic_target_customer", "value": "everyone who works gigs"},
    {"question_id": "evidence_customer_proof", "value": "no_evidence"},
    {"question_id": "risk_legal_constraints", "value": "none"},
    {"question_id": "industry_competitors", "value": "no competitors"},
    {"question_id": "basic_resources", "value": "$100"},
    {"question_id": "economy_payment_method", "value": "bank transfer"},
    {"question_id": "basic_timeline", "value": "14 days"},
    {"question_id": "industry_sector", "value": "insurance"},
    {"question_id": "basic_problem", "value": "gig workers lack insurance"},
    {"question_id": "basic_raw_goal", "value": "insurance platform for gig workers"},
    {"question_id": "basic_success", "value": "1 million users"},
    {"question_id": "economy_founder_country", "value": "Nigeria"},
    {"question_id": "economy_customer_country", "value": "Nigeria"},
]


class TestContextAPI:
    def _create_validation(self, client, headers, goal):
        return client.post(
            "/api/v1/validations",
            json={"raw_goal": goal},
            headers=headers,
        ).json()["data"]["validation_id"]

    def test_get_questions_envelope(self, client, auth_headers):
        vid = self._create_validation(client, auth_headers, "SaaS for clinics")
        resp = client.get(f"/api/v1/validations/{vid}/questions", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert "batch" in body["data"]

    def test_get_questions_transitions_to_collecting(self, client, auth_headers):
        vid = self._create_validation(client, auth_headers, "Minimal goal for collecting")
        client.get(f"/api/v1/validations/{vid}/questions", headers=auth_headers)
        val = client.get(f"/api/v1/validations/{vid}", headers=auth_headers).json()["data"]["validation"]
        assert val["status"] in ("context_collecting", "draft")

    def test_post_context_accepts_answers(self, client, auth_headers):
        vid = self._create_validation(client, auth_headers, "Context accept test")
        resp = client.post(
            f"/api/v1/validations/{vid}/context",
            json={"answers": [{"question_id": "basic_problem", "value": "Scheduling pain"}], "submit_final": False},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert len(resp.json()["data"]["accepted_answers"]) >= 1

    def test_post_context_blocks_gaming_input(self, client, auth_headers):
        goal = "Launch insurance for gig workers in Nigeria in 14 days and get 1 million users fast"
        vid = self._create_validation(client, auth_headers, goal)
        resp = client.post(
            f"/api/v1/validations/{vid}/context",
            json={"answers": GAMING_ANSWERS, "submit_final": True},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["can_proceed_to_engines"] is False
        assert len(data["blockers"]) >= 1
        val = client.get(f"/api/v1/validations/{vid}", headers=auth_headers).json()["data"]["validation"]
        assert val["status"] not in ("engines_running", "engines_queued", "scoring", "completed")

    def test_official_gate_manipulated_input(self, client, auth_headers):
        goal = "I want to launch an insurance platform for gig workers in Nigeria in 14 days and get 1 million users fast"
        vid = self._create_validation(client, auth_headers, goal)
        resp = client.post(
            f"/api/v1/validations/{vid}/context",
            json={"answers": GAMING_ANSWERS, "submit_final": True},
            headers=auth_headers,
        )
        data = resp.json()["data"]
        assert data["can_proceed_to_engines"] is False
        assert data["context_status"] in ("blocked_by_anti_gaming", "blocked_by_quality", "missing_required_fields")
        assert len(data["blockers"]) >= 1

    def test_get_context_returns_saved(self, client, auth_headers):
        vid = self._create_validation(client, auth_headers, "Get context test")
        client.post(
            f"/api/v1/validations/{vid}/context",
            json={"answers": [{"question_id": "basic_problem", "value": "Pain"}], "submit_final": False},
            headers=auth_headers,
        )
        resp = client.get(f"/api/v1/validations/{vid}/context", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["validation_id"] == vid

    def test_reset_context_dev(self, client, auth_headers):
        vid = self._create_validation(client, auth_headers, "Reset test")
        client.get(f"/api/v1/validations/{vid}/questions", headers=auth_headers)
        resp = client.post(f"/api/v1/validations/{vid}/context/reset", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["reset"] is True

    def test_cross_user_404(self, client, auth_headers, auth_headers_user2):
        vid = self._create_validation(client, auth_headers, "Cross user context")
        resp = client.get(f"/api/v1/validations/{vid}/questions", headers=auth_headers_user2)
        assert resp.status_code == 404

    def test_envelope_on_all_routes(self, client, auth_headers):
        vid = self._create_validation(client, auth_headers, "Envelope test")
        for method, path, body in [
            ("GET", f"/api/v1/validations/{vid}/questions", None),
            ("GET", f"/api/v1/validations/{vid}/context", None),
        ]:
            if method == "GET":
                r = client.get(path, headers=auth_headers)
            else:
                r = client.post(path, json=body, headers=auth_headers)
            assert "metadata" in r.json()

    def test_context_events_emitted(self, client, auth_headers, db):
        import asyncio
        vid = self._create_validation(client, auth_headers, "Events context test")
        client.get(f"/api/v1/validations/{vid}/questions", headers=auth_headers)

        async def _check():
            return await db["system_events"].count_documents({
                "validation_id": vid,
                "event_type": {"$in": ["context_started", "context_questions_generated"]},
            })

        loop = asyncio.get_event_loop()
        count = loop.run_until_complete(_check())
        assert count >= 1
