"""Prompt 10 commercial request contracts (§27-47).

Two things live here and nothing else:

* the request bodies the Prompt 10 routes accept, validated before any database or provider call;
* the retry classification every external operation must state, and the normalized failure taxonomy
  provider adapters translate into. Neither is inferred from an HTTP status at call time - a caller
  must be able to see whether an operation may be retried, needs an idempotency key, needs
  reconciliation, or must never be repeated.

Prompt 11 owns the durable retry orchestration that these classifications feed. Prompt 10 owns
stating them truthfully.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

RetryClassification = Literal['SAFE_TO_RETRY', 'REQUIRES_IDEMPOTENCY_KEY', 'REQUIRES_RECONCILIATION', 'MUST_NOT_RETRY']
NormalizedFailure = Literal['authentication_failed', 'insufficient_scope', 'rate_limited', 'invalid_media',
    'invalid_metadata', 'provider_unavailable', 'quota_exceeded', 'remote_processing_failed', 'destination_rejected',
    'policy_violation', 'unknown']

# What may be repeated, and what may never be guessed at, per external operation. These are statements
# about the world, not configuration: submitting a publication twice can create two remote posts, so it
# needs an idempotency key; a request whose response was lost can neither be called failed nor retried
# blindly, so it needs reconciliation.
RETRY_CLASSIFICATION: dict[str, RetryClassification] = {
    'provider_connect': 'SAFE_TO_RETRY',
    'provider_verify': 'SAFE_TO_RETRY',
    'provider_disconnect': 'SAFE_TO_RETRY',
    'provider_reauthorize': 'MUST_NOT_RETRY',
    'oauth_exchange': 'MUST_NOT_RETRY',
    'publication_submit': 'REQUIRES_IDEMPOTENCY_KEY',
    'publication_status': 'SAFE_TO_RETRY',
    'publication_reconcile': 'SAFE_TO_RETRY',
    'export_build': 'REQUIRES_IDEMPOTENCY_KEY',
    'export_download': 'SAFE_TO_RETRY',
    'billing_checkout': 'REQUIRES_IDEMPOTENCY_KEY',
    'billing_portal': 'REQUIRES_IDEMPOTENCY_KEY',
    'billing_webhook': 'REQUIRES_RECONCILIATION',
    'billing_subscription_apply': 'REQUIRES_RECONCILIATION',
    'usage_record': 'REQUIRES_IDEMPOTENCY_KEY',
    'usage_reserve': 'REQUIRES_IDEMPOTENCY_KEY',
    'usage_commit': 'REQUIRES_IDEMPOTENCY_KEY',
    'usage_release': 'REQUIRES_IDEMPOTENCY_KEY',
    'unknown_remote_state': 'REQUIRES_RECONCILIATION',
}

# A dependency the deployment has to supply before an external capability can be exercised. Both are
# reported as unconfigured rather than as failures, because nothing was attempted.
UNCONFIGURED_DEPENDENCIES = ('provider_credentials', 'payment_provider_credentials', 'credential_store',
    'integration_callback_url')


def retry_safety(action: str) -> RetryClassification:
    """Every external action states how it may be repeated. An unclassified action is never guessed at."""

    return RETRY_CLASSIFICATION.get(action, 'REQUIRES_RECONCILIATION')

HTTP_FAILURE_TAXONOMY: dict[int, NormalizedFailure] = {
    400: 'invalid_metadata',
    401: 'authentication_failed',
    403: 'insufficient_scope',
    404: 'destination_rejected',
    409: 'destination_rejected',
    413: 'invalid_media',
    415: 'invalid_media',
    422: 'invalid_metadata',
    429: 'rate_limited',
    500: 'provider_unavailable',
    502: 'provider_unavailable',
    503: 'provider_unavailable',
    504: 'provider_unavailable',
}

TRANSIENT_FAILURES = frozenset({'rate_limited', 'provider_unavailable'})


def classify_provider_failure(status_code: int | None, error_code: str | None = None) -> NormalizedFailure:
    """Translate a provider response into TONDE's taxonomy. An unrecognised cause stays `unknown`.

    Nothing here guesses: a cause TONDE cannot establish is reported as unknown and the operation is
    treated as needing reconciliation rather than being retried or declared failed.
    """

    if status_code is not None and status_code in HTTP_FAILURE_TAXONOMY:
        return HTTP_FAILURE_TAXONOMY[status_code]
    if error_code:
        candidate = error_code.strip().lower()
        if candidate in ('rate_limited', 'provider_unavailable', 'quota_exceeded', 'policy_violation',
            'authentication_failed', 'insufficient_scope', 'invalid_media', 'invalid_metadata',
            'remote_processing_failed', 'destination_rejected'):
            return candidate  # type: ignore[return-value]
    return 'unknown'


class CommercialModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


# The package types the export law accepts, in the same vocabulary the database enforces.
ExportPackageType = Literal['complete', 'script', 'shot_list', 'storyboard', 'prompt_pack', 'camera_plan',
    'continuity_report', 'audio_plan', 'edit_plan', 'structured_data']


class ExportRequestBody(CommercialModel):
    production_id: UUID
    kind: Literal['full_document', 'production_package']
    format: Literal['pdf', 'docx', 'zip', 'json']
    package_type: ExportPackageType = 'complete'

    @model_validator(mode='after')
    def validate_product_pairing(self) -> 'ExportRequestBody':
        """The two products are distinct before the database is asked anything."""

        if self.kind == 'full_document' and self.format not in ('pdf', 'docx'):
            raise ValueError('A full document is PDF or DOCX; a ZIP is the production package.')
        if self.kind == 'production_package' and self.format not in ('zip', 'json'):
            raise ValueError('A production package is a ZIP (or its structured-data JSON); a PDF is the full document.')
        if self.kind == 'full_document' and self.package_type != 'complete':
            raise ValueError('A package type only applies to a production package.')
        return self


class ExportQuery(CommercialModel):
    production_id: UUID | None = None
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


# The publishing destination capability key the database evaluates. Named once so the route and the
# service cannot drift.
PUBLISH_CAPABILITY = 'publish'

# The lifecycle labels the product vocabulary exposes, mapped to the stored codes. Labels are for the
# surface; the codes are what the database holds and what a caller may reason about.
PUBLICATION_STATE_LABELS: dict[str, str] = {
    'draft': 'Draft', 'ready': 'Ready to publish', 'awaiting_authorization': 'Awaiting authorization',
    'submitting': 'Submitting', 'submitted': 'Submitted', 'processing': 'Processing',
    'published': 'Published', 'failed': 'Failed', 'cancelled': 'Cancelled', 'removed': 'Removed',
    'unknown_remote_state': 'Destination state unknown',
}

# Provider failures TONDE considers worth trying again *after* the classification above allowed a
# retry at all. Everything else must be resolved by a creator before another attempt.
RESOLVABLE_BY_CREATOR = frozenset({'authentication_failed', 'insufficient_scope', 'invalid_media',
    'invalid_metadata', 'policy_violation', 'quota_exceeded'})
