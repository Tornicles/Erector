"""Bhudhi API tests — Prompt A5."""

import pytest


class TestBhudhiAPI:
    def test_trigger_requires_auth(self, client):
        resp = client.post("/api/v1/bhudhi/trigger", json={})
        assert resp.status_code == 401

    def test_interpret_goal_returns_envelope(self, client, auth_headers):
        resp = client.post(
            "/api/v1/bhudhi/interpret-goal",
            json={"raw_goal": "SaaS for clinics in Germany"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True

    def test_explain_score_rejects_missing_score(self, client, auth_headers):
        resp = client.post(
            "/api/v1/bhudhi/explain-score",
            json={"deterministic_rationale": "x"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

