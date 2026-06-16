"""
API helpers — convenience factories for ApiResponse and error construction.
"""

from .base import ApiError, ApiMetadata, ApiResponse, new_id
from .enums import ErrorType


def success_response(data, request_id: str = None, processing_time_ms: int = 0):
    """Return a successful ApiResponse."""
    return ApiResponse.ok(data=data, request_id=request_id, processing_time_ms=processing_time_ms)


def error_response(
    code: str,
    message: str,
    error_type: ErrorType = ErrorType.unknown_error,
    field: str = None,
    details: dict = None,
    request_id: str = None,
):
    """Return an error ApiResponse with a single error."""
    err = ApiError(code=code, type=error_type, message=message, field=field, details=details)
    return ApiResponse.fail(errors=[err], request_id=request_id)


def validation_error_response(errors: list[dict], request_id: str = None):
    """Return a validation error ApiResponse from a list of field error dicts."""
    api_errors = [
        ApiError(
            code="VALIDATION_ERROR",
            type=ErrorType.validation_error,
            message=e.get("msg", "Validation failed"),
            field=e.get("loc", [None])[-1],
            details=e,
        )
        for e in errors
    ]
    return ApiResponse.fail(errors=api_errors, request_id=request_id)
