"""
Report schemas.
Collection: validation_reports
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import BaseSchema, OwnedDocument, new_id
from .enums import ReportPackageType, ReportFormat, ReportStatus


class ExportUrl(BaseSchema):
    format: ReportFormat
    url: str
    generated_at: datetime
    expires_at: Optional[datetime] = None


class ValidationReport(OwnedDocument):
    """
    A generated report package for a validation.
    Collection: validation_reports
    """
    report_id: str = Field(default_factory=new_id)
    validation_id: str
    package_type: ReportPackageType
    status: ReportStatus = ReportStatus.queued
    format: ReportFormat = ReportFormat.in_app
    version: int = 1
    title: str
    page_count: Optional[int] = None
    file_url: Optional[str] = None
    export_urls: list[ExportUrl] = Field(default_factory=list)
    generated_from_score_id: Optional[str] = None
    generated_from_framework_id: Optional[str] = None
    generated_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
