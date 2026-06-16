"""Idempotency tests — Prompt A3."""

import concurrent.futures

import pytest

from conftest import make_validation_payload


class TestIdempotency:
    def test_same_key_same_payload_returns_existing(self, client, auth_headers):
        key = "test-idem-same-payload-001"
        payload = make_validation_payload(raw_goal="Idempotent goal same payload")
        h = {**auth_headers, "Idempotency-Key": key}
        first = client.post("/api/v1/validations", json=payload, headers=h)
        second = client.post("/api/v1/validations", json=payload, headers=h)
        assert first.status_code == 201
        assert second.status_code == 200
        assert second.json()["data"]["existing"] is True
        assert second.json()["data"]["created"] is False
        assert first.json()["data"]["validation_id"] == second.json()["data"]["validation_id"]

    def test_same_key_different_payload_returns_409(self, client, auth_headers):
        key = "test-idem-conflict-002"
        h = {**auth_headers, "Idempotency-Key": key}
        client.post(
            "/api/v1/validations",
            json=make_validation_payload(raw_goal="First payload version"),
            headers=h,
        )
        resp = client.post(
            "/api/v1/validations",
            json=make_validation_payload(raw_goal="Different payload version"),
            headers=h,
        )
        assert resp.status_code == 409
        assert resp.json()["success"] is False

    def test_different_keys_create_different_validations(self, client, auth_headers):
        r1 = client.post(
            "/api/v1/validations",
            json=make_validation_payload(raw_goal="Different keys goal A"),
            headers={**auth_headers, "Idempotency-Key": "key-a-003"},
        )
        r2 = client.post(
            "/api/v1/validations",
            json=make_validation_payload(raw_goal="Different keys goal B"),
            headers={**auth_headers, "Idempotency-Key": "key-b-003"},
        )
        assert r1.json()["data"]["validation_id"] != r2.json()["data"]["validation_id"]

    def test_idempotency_scoped_by_owner(self, client, auth_headers, auth_headers_user2):
        key = "shared-key-scope-004"
        payload = make_validation_payload(raw_goal="Scoped idempotency goal")
        r1 = client.post(
            "/api/v1/validations",
            json=payload,
            headers={**auth_headers, "Idempotency-Key": key},
        )
        r2 = client.post(
            "/api/v1/validations",
            json=payload,
            headers={**auth_headers_user2, "Idempotency-Key": key},
        )
        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r1.json()["data"]["validation_id"] != r2.json()["data"]["validation_id"]

    def test_concurrent_duplicate_requests(self, client, auth_headers):
        key = "concurrent-key-005"
        payload = make_validation_payload(raw_goal="Concurrent idempotency goal")
        headers = {**auth_headers, "Idempotency-Key": key}

        def _post():
            return client.post("/api/v1/validations", json=payload, headers=headers)

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: _post(), range(4)))

        ids = {r.json()["data"]["validation_id"] for r in results if r.status_code in (200, 201)}
        assert len(ids) == 1

    def test_idempotency_record_links_validation(self, client, auth_headers, db):
        import asyncio

        key = "link-record-006"
        payload = make_validation_payload(raw_goal="Link record goal")
        resp = client.post(
            "/api/v1/validations",
            json=payload,
            headers={**auth_headers, "Idempotency-Key": key},
        )
        vid = resp.json()["data"]["validation_id"]

        async def _check():
            return await db["validation_idempotency_keys"].find_one({"idempotency_key": key})

        loop = asyncio.get_event_loop()
        rec = loop.run_until_complete(_check())
        assert rec is not None
        assert rec["validation_id"] == vid

    def test_idempotency_reuse_writes_audit(self, client, auth_headers, db):
        import asyncio

        key = "audit-reuse-007"
        payload = make_validation_payload(raw_goal="Audit reuse goal")
        h = {**auth_headers, "Idempotency-Key": key}
        client.post("/api/v1/validations", json=payload, headers=h)
        client.post("/api/v1/validations", json=payload, headers=h)

        async def _check():
            return await db["audit_logs"].find_one({"action": "idempotency.reused"})

        loop = asyncio.get_event_loop()
        entry = loop.run_until_complete(_check())
        assert entry is not None
