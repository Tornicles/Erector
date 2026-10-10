"""Media ingestion domain vocabulary and request models.

The database owns the pipeline: an upload intent is the only sanctioned way to reach a private
storage path, verification compares what was observed against what was declared, a rejected or
expired intent never reopens, and a derived asset keeps its provenance. This module names those
states so a creator reads them, and validates request shape before the platform sees it.

A scanner is a deployment requirement, not a product claim: when no scanner is configured the
database records `not_configured` and never reports a scan that did not happen.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

UPLOAD_INTENT_STATES: tuple[str, ...] = (
    'created', 'uploading', 'completing', 'verified', 'rejected', 'expired', 'aborted',
)

PROCESSING_STATES: tuple[str, ...] = ('pending', 'blocked', 'processing', 'ready', 'failed', 'skipped')

SCAN_STATES: tuple[str, ...] = ('not_configured', 'unscanned', 'scanning', 'clean', 'infected', 'error')

DERIVATION_STATES: tuple[str, ...] = ('requested', 'building', 'ready', 'failed', 'cancelled')

# The derivations the registry knows. A proxy never replaces its source, and a derived asset always
# names the media it came from.
DERIVATION_TYPES: tuple[str, ...] = (
    'thumbnail', 'proxy', 'waveform', 'contact_sheet', 'subtitle', 'audio_extract', 'edit_proxy',
)


class UploadIntentCreateRequest(BaseModel):
    """Ask for the one storage path this upload may use."""

    model_config = ConfigDict(extra='ignore')
    purpose: str = Field(min_length=2, max_length=60)
    original_filename: str = Field(min_length=1, max_length=300)
    mime_type: str = Field(min_length=3, max_length=120)
    expected_bytes: int | None = Field(default=None, ge=1)
    production_id: str | None = None
    resumable: bool = True
    checksum_expected: str | None = Field(default=None, max_length=200)


class UploadPartRequest(BaseModel):
    """Report one uploaded part. The path is derived server-side and never chosen by the client."""

    model_config = ConfigDict(extra='ignore')
    part_number: int = Field(ge=1, le=100000)
    bytes: int = Field(ge=0)
    etag: str | None = Field(default=None, max_length=200)


class UploadAbortRequest(BaseModel):
    """Abandon an upload intent, with a reason that is recorded."""

    model_config = ConfigDict(extra='ignore')
    reason: str = Field(default='', max_length=400)


class ProcessingStateRequest(BaseModel):
    """Move a media object's processing state, with the note that explains it."""

    model_config = ConfigDict(extra='ignore')
    state: str
    note: str = Field(default='', max_length=400)


class ScanRecordRequest(BaseModel):
    """Record what a scanner did. `not_configured` is the honest state for a deployment with none."""

    model_config = ConfigDict(extra='ignore')
    scanner: str = Field(min_length=1, max_length=120)
    state: str
    scanner_version: str = Field(default='', max_length=120)
    findings: list = Field(default_factory=list)
    recorded_by: str = Field(default='tonde-server', min_length=1, max_length=120)


class ProbeRecordRequest(BaseModel):
    """The technical facts a probe measured: duration, dimensions, codecs, and nothing invented."""

    model_config = ConfigDict(extra='ignore')
    facts: dict = Field(default_factory=dict)
    probe_tool: str = Field(default='tonde-probe', min_length=1, max_length=120)
    probe_version: str = Field(default='1', min_length=1, max_length=60)


class DerivationRequest(BaseModel):
    """Ask for a derived asset from an immutable source."""

    model_config = ConfigDict(extra='ignore')
    source_media_id: str
    derivation_type: str
    transform_key: str = Field(min_length=1, max_length=120)
    transform_version: str = Field(default='1', min_length=1, max_length=60)
    priority: int | None = Field(default=None, ge=0, le=100)


class DerivationOutputRequest(BaseModel):
    """The media object a derivation produced, and its measured facts."""

    model_config = ConfigDict(extra='ignore')
    output_media_id: str
    bytes: int | None = Field(default=None, ge=0)
    checksum: str | None = Field(default=None, max_length=200)


class DerivationFailureRequest(BaseModel):
    """Why a derivation failed. A derivation that is already finished refuses this."""

    model_config = ConfigDict(extra='ignore')
    code: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=400)
