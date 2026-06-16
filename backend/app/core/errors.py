"""
Erector Application Errors
Typed error classes that convert cleanly to ApiError / HTTP responses.
"""

from __future__ import annotations

from typing import Any, Optional
from app.models.enums import ErrorType


class AppError(Exception):
    """Base class for all Erector application errors."""

    code: str = "APP_ERROR"
    error_type: ErrorType = ErrorType.unknown_error
    status_code: int = 500
    user_facing_message: str = "An unexpected error occurred."

    def __init__(
        self,
        message: str,
        code: Optional[str] = None,
        details: Optional[dict] = None,
        field: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.details = details or {}
        self.field = field

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "type": self.error_type.value,
            "message": self.user_facing_message or self.message,
            "field": self.field,
            "details": self.details,
        }


class DatabaseUnavailableError(AppError):
    code = "DATABASE_UNAVAILABLE"
    error_type = ErrorType.database_error
    status_code = 503
    user_facing_message = "The database is currently unavailable. Please try again."

    def __init__(self, details: Optional[dict] = None) -> None:
        super().__init__(
            message="MongoDB connection is unavailable.",
            details=details or {"service": "mongodb"},
        )


class AuthenticationError(AppError):
    code = "AUTHENTICATION_FAILED"
    error_type = ErrorType.authentication_error
    status_code = 401
    user_facing_message = "Authentication failed. Please sign in again."

    def __init__(self, message: str = "Authentication failed.", **kwargs: Any) -> None:
        super().__init__(message=message, **kwargs)


class AuthorizationError(AppError):
    code = "UNAUTHORIZED"
    error_type = ErrorType.authorization_error
    status_code = 403
    user_facing_message = "You do not have permission to perform this action."

    def __init__(self, message: str = "Insufficient permissions.", **kwargs: Any) -> None:
        super().__init__(message=message, **kwargs)


class ValidationAppError(AppError):
    code = "VALIDATION_FAILED"
    error_type = ErrorType.validation_error
    status_code = 422
    user_facing_message = "Validation failed. Please check your input."

    def __init__(self, message: str, field: Optional[str] = None, **kwargs: Any) -> None:
        super().__init__(message=message, field=field, **kwargs)


class NotFoundAppError(AppError):
    code = "NOT_FOUND"
    error_type = ErrorType.unknown_error
    status_code = 404
    user_facing_message = "The requested resource was not found."

    def __init__(self, resource: str = "Resource", **kwargs: Any) -> None:
        super().__init__(message=f"{resource} not found.", **kwargs)


class RateLimitAppError(AppError):
    code = "RATE_LIMIT_EXCEEDED"
    error_type = ErrorType.rate_limit_error
    status_code = 429
    user_facing_message = "Too many requests. Please slow down."

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(message="Rate limit exceeded.", **kwargs)


class TokenExpiredError(AuthenticationError):
    code = "TOKEN_EXPIRED"
    user_facing_message = "Your session has expired. Please sign in again."

    def __init__(self) -> None:
        super().__init__(message="JWT token has expired.")


class TokenInvalidError(AuthenticationError):
    code = "TOKEN_INVALID"
    user_facing_message = "Invalid authentication token."

    def __init__(self) -> None:
        super().__init__(message="JWT token is invalid or malformed.")


class SessionRevokedError(AuthenticationError):
    code = "SESSION_REVOKED"
    user_facing_message = "Your session has been revoked. Please sign in again."

    def __init__(self) -> None:
        super().__init__(message="Session has been revoked.")


class InvalidStateTransitionError(AppError):
    code = "INVALID_STATE_TRANSITION"
    error_type = ErrorType.validation_error
    status_code = 409
    user_facing_message = "This state transition is not allowed."

    def __init__(
        self,
        message: str,
        current_status: str,
        requested_status: str,
        allowed_statuses: list[str],
    ) -> None:
        super().__init__(
            message=message,
            field="next_status",
            details={
                "current_status": current_status,
                "requested_status": requested_status,
                "allowed_statuses": allowed_statuses,
            },
        )


class ValidationNotFoundError(AppError):
    code = "VALIDATION_NOT_FOUND"
    error_type = ErrorType.validation_error
    status_code = 404
    user_facing_message = "Validation not found."

    def __init__(self, validation_id: str) -> None:
        super().__init__(message=f"Validation not found: {validation_id}")


class ValidationAccessDeniedAsNotFound(ValidationNotFoundError):
    """Return 404 to avoid existence disclosure for unauthorized access."""

    def __init__(self, validation_id: str) -> None:
        super().__init__(validation_id=validation_id)


class IdempotencyConflictError(AppError):
    code = "IDEMPOTENCY_CONFLICT"
    error_type = ErrorType.validation_error
    status_code = 409
    user_facing_message = "Idempotency key was already used with a different request."

    def __init__(self, idempotency_key: str) -> None:
        super().__init__(
            message=f"Idempotency key conflict: {idempotency_key}",
            field="idempotency_key",
        )


class EventProcessingError(AppError):
    code = "EVENT_PROCESSING_FAILED"
    error_type = ErrorType.unknown_error
    status_code = 500
    user_facing_message = "Event processing failed."

    def __init__(self, event_id: str, reason: str) -> None:
        super().__init__(
            message=f"Event {event_id} processing failed: {reason}",
            details={"event_id": event_id, "reason": reason},
        )
