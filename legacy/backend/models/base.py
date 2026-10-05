"""
Erector Base Schema Layer
Core base models, PyObjectId, utility functions, and generic ApiResponse envelope.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Generic, Optional, TypeVar

from bson import ObjectId
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from .enums import TeamRole, VisibilityType


# ---------------------------------------------------------------------------
# PyObjectId – coerce ObjectId ↔ str
# ---------------------------------------------------------------------------

def _validate_object_id(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, str):
        return v
    raise ValueError(f"Invalid ObjectId value: {v!r}")


PyObjectId = Annotated[str, BeforeValidator(_validate_object_id)]


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def new_id() -> str:
    """Generate a new UUID4 string id."""
    return str(uuid.uuid4())


def utcnow() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Access Control
# ---------------------------------------------------------------------------

class AccessControl(BaseModel):
    """Defines who can access a document."""
    model_config = ConfigDict(populate_by_name=True, use_enum_values=True)

    owner_user_id: str
    team_id: Optional[str] = None
    allowed_user_ids: list[str] = Field(default_factory=list)
    allowed_roles: list[str] = Field(default_factory=list)
    public_share_enabled: bool = False
    public_share_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Source Reference
# ---------------------------------------------------------------------------

class SourceRef(BaseModel):
    """Tracks origin of generated/computed content."""
    model_config = ConfigDict(populate_by_name=True, use_enum_values=True)

    source_type: str  # user | engine | bhudhi | system | admin | webhook | import
    source_id: Optional[str] = None
    source_engine: Optional[str] = None   # EngineName value
    source_validation_id: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# API Error
# ---------------------------------------------------------------------------

class ApiError(BaseModel):
    """Structured API error object."""
    model_config = ConfigDict(populate_by_name=True, use_enum_values=True)

    code: str
    type: str  # ErrorType value
    message: str
    field: Optional[str] = None
    details: Optional[dict] = None


# ---------------------------------------------------------------------------
# Pagination Meta
# ---------------------------------------------------------------------------

class PaginationMeta(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    page: int = 1
    page_size: int = 20
    total_items: int = 0
    total_pages: int = 0
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None


# ---------------------------------------------------------------------------
# API Metadata
# ---------------------------------------------------------------------------

class ApiMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    request_id: str = Field(default_factory=new_id)
    version: str = "1.0.0"
    timestamp: datetime = Field(default_factory=utcnow)
    processing_time_ms: int = 0
    pagination: Optional[PaginationMeta] = None


# ---------------------------------------------------------------------------
# Generic API Response Envelope
# ---------------------------------------------------------------------------

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """Standard API response envelope. All endpoints must return this shape."""
    model_config = ConfigDict(populate_by_name=True)

    success: bool
    data: Optional[T] = None
    errors: Optional[list[ApiError]] = None
    metadata: ApiMetadata = Field(default_factory=ApiMetadata)

    @classmethod
    def ok(cls, data: T, request_id: str = None, processing_time_ms: int = 0) -> "ApiResponse[T]":
        meta = ApiMetadata(
            request_id=request_id or new_id(),
            processing_time_ms=processing_time_ms,
        )
        return cls(success=True, data=data, metadata=meta)

    @classmethod
    def fail(cls, errors: list[ApiError], request_id: str = None) -> "ApiResponse[None]":
        meta = ApiMetadata(request_id=request_id or new_id())
        return cls(success=False, errors=errors, metadata=meta)


# ---------------------------------------------------------------------------
# Base Schema (every MongoDB document)
# ---------------------------------------------------------------------------

class BaseSchema(BaseModel):
    """
    Root base for every Erector document.
    Provides schema_version, audit timestamps, soft-delete, and Mongo helpers.
    """
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        use_enum_values=True,
    )

    schema_version: str = Field(default="1.0")
    metadata: dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    def to_mongo(self) -> dict:
        """Serialize for MongoDB insertion/update."""
        d = self.model_dump(by_alias=True)
        # Map id → _id for MongoDB
        if "id" in d and d["id"] is not None:
            d["_id"] = d.pop("id")
        return d

    @classmethod
    def from_mongo(cls, data: dict) -> "BaseSchema":
        """Deserialize from a raw MongoDB document."""
        if data is None:
            return None
        data = dict(data)
        if "_id" in data:
            data["id"] = str(data.pop("_id"))
        return cls(**data)


# ---------------------------------------------------------------------------
# Owned Document (user/team scoped)
# ---------------------------------------------------------------------------

class OwnedDocument(BaseSchema):
    """
    Base for all user-owned documents.
    Every query MUST scope by owner_user_id or valid team membership.
    """
    owner_user_id: str
    team_id: Optional[str] = None
    visibility: VisibilityType = VisibilityType.private
    access_control: Optional[AccessControl] = None
