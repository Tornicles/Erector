"""
test_health.py — GET /api/health smoke tests.

Tests:
1. Returns 200
2. Response matches API envelope shape
3. success=True
4. data.status is 'healthy' or 'degraded'
5. data.version is set
6. X-Request-ID header present
7. X-Process-Time-Ms header present
"""

import pytest


def test_health_returns_200(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


def test_health_envelope_shape(client):
    resp = client.get("/api/health")
    body = resp.json()
    assert "success" in body
    assert "data" in body
    assert "errors" in body
    assert "metadata" in body


def test_health_success_true(client):
    resp = client.get("/api/health")
    assert resp.json()["success"] is True


def test_health_status_field(client):
    resp = client.get("/api/health")
    status = resp.json()["data"]["status"]
    assert status in ("healthy", "degraded"), f"Unexpected status: {status}"


def test_health_version_present(client):
    resp = client.get("/api/health")
    assert resp.json()["data"]["version"]


def test_health_database_field(client):
    resp = client.get("/api/health")
    db_info = resp.json()["data"]["database"]
    assert "connected" in db_info


def test_health_mock_auth_field(client):
    resp = client.get("/api/health")
    assert "mock_auth_enabled" in resp.json()["data"]


def test_health_x_request_id_header(client):
    resp = client.get("/api/health")
    assert "x-request-id" in resp.headers or "X-Request-ID" in resp.headers


def test_health_process_time_header(client):
    resp = client.get("/api/health")
    assert "x-process-time-ms" in resp.headers or "X-Process-Time-Ms" in resp.headers


def test_health_metadata_has_request_id(client):
    resp = client.get("/api/health")
    meta = resp.json()["metadata"]
    assert meta.get("request_id")


def test_health_metadata_has_timestamp(client):
    resp = client.get("/api/health")
    meta = resp.json()["metadata"]
    assert meta.get("timestamp")
