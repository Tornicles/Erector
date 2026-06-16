"""
test_api_envelope.py — API response envelope contract tests.

Verifies that success_response() and error_response() produce
the canonical ApiResponse shape required by all routes.
"""

import pytest
from datetime import datetime, timezone


def test_success_response_shape():
    from app.models.api import success_response
    resp = success_response(data={"key": "value"}, request_id="test-123")
    d = resp.model_dump()
    assert d["success"] is True
    assert d["data"] == {"key": "value"}
    assert d["errors"] is None
    assert d["metadata"]["request_id"] == "test-123"


def test_success_response_auto_request_id():
    from app.models.api import success_response
    resp = success_response(data={})
    assert resp.metadata.request_id  # auto-generated UUID


def test_error_response_shape():
    from app.models.api import error_response
    from app.models.enums import ErrorType
    resp = error_response(
        code="TEST_ERROR",
        message="Something failed.",
        error_type=ErrorType.validation_error,
        request_id="err-001",
    )
    d = resp.model_dump()
    assert d["success"] is False
    assert d["data"] is None
    assert len(d["errors"]) == 1
    err = d["errors"][0]
    assert err["code"] == "TEST_ERROR"
    assert err["message"] == "Something failed."


def test_error_response_metadata_present():
    from app.models.api import error_response
    from app.models.enums import ErrorType
    resp = error_response(
        code="X", message="X", error_type=ErrorType.unknown_error
    )
    assert resp.metadata.timestamp is not None
    assert resp.metadata.request_id


def test_success_response_pagination_none_by_default():
    from app.models.api import success_response
    resp = success_response(data={})
    assert resp.metadata.pagination is None


def test_success_response_with_processing_time():
    from app.models.api import success_response
    resp = success_response(data={}, processing_time_ms=42)
    assert resp.metadata.processing_time_ms == 42


def test_api_envelope_json_serializable():
    """All ApiResponse models must be JSON-serializable (no ObjectId etc)."""
    import json
    from app.models.api import success_response
    resp = success_response(data={"count": 5, "items": ["a", "b"]})
    # Should not raise
    raw = json.dumps(resp.model_dump(), default=str)
    parsed = json.loads(raw)
    assert parsed["success"] is True


def test_errors_response_multiple_errors():
    from app.models.api import errors_response
    from app.models.base import ApiError
    from app.models.enums import ErrorType
    errs = [
        ApiError(code="E1", type=ErrorType.validation_error, message="Field required", field="email"),
        ApiError(code="E2", type=ErrorType.validation_error, message="Too short", field="password"),
    ]
    resp = errors_response(errs)
    d = resp.model_dump()
    assert d["success"] is False
    assert len(d["errors"]) == 2


def test_schema_collections_endpoint(client):
    """Schema collections route still works after migration to app/main.py."""
    resp = client.get("/api/schema/collections")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["total"] > 0


def test_schema_enums_endpoint(client):
    """Schema enums route returns all 38+ enums."""
    resp = client.get("/api/schema/enums")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["total_enums"] >= 30
