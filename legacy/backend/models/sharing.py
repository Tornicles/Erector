"""
Report Sharing schemas.
Collection: report_shares
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import ShareExpiry


class ReportAccessLog(BaseSchema):
    """Audit trail for report share accesses."""
    access_log_id: str = Field(default_factory=new_id)
    accessed_at: datetime = Field(default_factory=utcnow)
    ip_hash: Optional[str] = None
    user_agent: Optional[str] = None
    downloaded: bool = False
    format: Optional[str] = None


class ReportShare(OwnedDocument):
    """
    A public share link for a report.
    Access must only resolve through share token, expiry, password, and revoked_at checks.
    Collection: report_shares
    """
    share_id: str = Field(default_factory=new_id)
    report_id: str
    validation_id: str
    share_url_token_hash: str   # hashed — never store plaintext token
    expiry: ShareExpiry = ShareExpiry.seven_days
    expires_at: Optional[datetime] = None
    password_hash: Optional[str] = None   # optional password protection
    revoked_at: Optional[datetime] = None
    access_logs: list[ReportAccessLog] = Field(default_factory=list)
