"""
Test Gate 4: API response envelope integrity.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))


def test_api_response_shape():
    from models.base import ApiResponse, ApiMetadata, ApiError
    from models.enums import ErrorType

    # Success response
    resp = ApiResponse.ok(data={"hello": "world"})
    assert resp.success is True
    assert resp.data == {"hello": "world"}
    assert resp.errors is None
    assert resp.metadata is not None
    assert resp.metadata.request_id is not None
    assert resp.metadata.version is not None
    assert resp.metadata.timestamp is not None
    assert isinstance(resp.metadata.processing_time_ms, int)


def test_api_error_response_shape():
    from models.base import ApiResponse, ApiError
    from models.enums import ErrorType

    err = ApiError(
        code="TEST_ERROR",
        type=ErrorType.unknown_error,
        message="Test error",
    )
    resp = ApiResponse.fail(errors=[err])
    assert resp.success is False
    assert resp.data is None
    assert len(resp.errors) == 1
    assert resp.errors[0].code == "TEST_ERROR"


def test_api_response_generic():
    """ApiResponse must work with any data type."""
    from models.base import ApiResponse

    # With string
    r1 = ApiResponse.ok(data="test")
    assert r1.data == "test"

    # With list
    r2 = ApiResponse.ok(data=[1, 2, 3])
    assert r2.data == [1, 2, 3]

    # With None
    r3 = ApiResponse.ok(data=None)
    assert r3.data is None


def test_api_response_serializable():
    """ApiResponse must be JSON serializable."""
    from models.base import ApiResponse
    import json

    resp = ApiResponse.ok(data={"key": "value", "number": 42})
    serialized = resp.model_dump()
    # Must be JSON serializable
    json_str = json.dumps(serialized, default=str)
    parsed = json.loads(json_str)
    assert parsed["success"] is True
    assert parsed["data"]["key"] == "value"


def test_pagination_meta():
    from models.base import PaginationMeta, ApiMetadata, ApiResponse

    pagination = PaginationMeta(
        page=1,
        page_size=20,
        total_items=100,
        total_pages=5,
        next_cursor="abc123",
    )
    meta = ApiMetadata(pagination=pagination)
    resp = ApiResponse(success=True, data=[], metadata=meta)
    assert resp.metadata.pagination.total_pages == 5
    assert resp.metadata.pagination.next_cursor == "abc123"


def test_api_error_with_field():
    from models.base import ApiError
    from models.enums import ErrorType

    err = ApiError(
        code="FIELD_REQUIRED",
        type=ErrorType.validation_error,
        message="This field is required",
        field="email",
        details={"validator": "required"},
    )
    assert err.field == "email"
    assert err.details["validator"] == "required"
