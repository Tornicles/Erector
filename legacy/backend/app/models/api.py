"""
API response helpers — thin wrappers over PROMPT 0 envelope.
All routes must use success_response() or error_response().
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from models.base import ApiError, ApiMetadata, ApiResponse, new_id
from models.enums import ErrorType


def success_response(
    data: Any,
    request_id: Optional[str] = None,
    processing_time_ms: int = 0,
    pagination=None,
) -> ApiResponse:
    meta = ApiMetadata(
        request_id=request_id or new_id(),
        version="1.0.0",
        timestamp=datetime.now(timezone.utc),
        processing_time_ms=processing_time_ms,
        pagination=pagination,
    )
    return ApiResponse(success=True, data=data, errors=None, metadata=meta)


def error_response(
    code: str,
    message: str,
    error_type: ErrorType = ErrorType.unknown_error,
    request_id: Optional[str] = None,
    processing_time_ms: int = 0,
    field: Optional[str] = None,
    details: Optional[dict] = None,
) -> ApiResponse:
    err = ApiError(
        code=code,
        type=error_type,
        message=message,
        field=field,
        details=details,
    )
    meta = ApiMetadata(
        request_id=request_id or new_id(),
        version="1.0.0",
        timestamp=datetime.now(timezone.utc),
        processing_time_ms=processing_time_ms,
    )
    return ApiResponse(success=False, data=None, errors=[err], metadata=meta)


def errors_response(
    errors: list[ApiError],
    request_id: Optional[str] = None,
    processing_time_ms: int = 0,
) -> ApiResponse:
    meta = ApiMetadata(
        request_id=request_id or new_id(),
        version="1.0.0",
        timestamp=datetime.now(timezone.utc),
        processing_time_ms=processing_time_ms,
    )
    return ApiResponse(success=False, data=None, errors=errors, metadata=meta)


__all__ = ["success_response", "error_response", "errors_response",
           "ApiError", "ApiMetadata", "ApiResponse", "PaginationMeta"]

from models.base import PaginationMeta  # noqa: F401, E402
