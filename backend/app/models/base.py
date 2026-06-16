"""
Base models — re-exports from PROMPT 0 schema contract.
Do not redefine. Use these imports everywhere in app/.
"""
from models.base import (    # noqa: F401
    BaseSchema,
    OwnedDocument,
    AccessControl,
    SourceRef,
    PyObjectId,
    ApiError,
    PaginationMeta,
    ApiMetadata,
    ApiResponse,
    new_id,
    utcnow,
)

__all__ = [
    "BaseSchema", "OwnedDocument", "AccessControl", "SourceRef",
    "PyObjectId", "ApiError", "PaginationMeta", "ApiMetadata",
    "ApiResponse", "new_id", "utcnow",
]
