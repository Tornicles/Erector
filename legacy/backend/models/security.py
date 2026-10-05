"""
System Error schemas.
Collection: system_errors
"""

from __future__ import annotations
from typing import Optional
from pydantic import Field
from .base import BaseSchema, new_id
from .enums import ErrorSeverity, ErrorType


class SystemError(BaseSchema):
    """
    Server-side error record for monitoring and debugging.
    Collection: system_errors
    """
    error_id: str = Field(default_factory=new_id)
    severity: ErrorSeverity = ErrorSeverity.error
    error_type: ErrorType = ErrorType.unknown_error
    message: str
    user_facing_message: Optional[str] = None
    stack_trace_hash: Optional[str] = None
    route: Optional[str] = None
    method: Optional[str] = None
    request_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    validation_id: Optional[str] = None
    resolved: bool = False
