"""Prompt 11 durable job domain vocabulary and request models.

The database (migration 036) owns every decision: which transitions are legal, what a retry
classification means, how long a lease lasts, when a job is a dead letter, and which job types are
externally consequential. This module only names those decisions so the creator reads them, and
validates the shape of a request before it reaches the database.

Two boundaries this module protects:

* a job is a durable intent with an append-only history, not a progress bar the client can invent;
* a client never chooses its own worker, lease or attempt count - those are server-owned.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# The eleven durable states a job can be in. Terminal states are final.
JOB_STATES: tuple[str, ...] = (
    'queued', 'leased', 'running', 'waiting', 'retrying', 'cancel_requested',
    'succeeded', 'failed', 'cancelled', 'timed_out', 'dead_letter',
)

TERMINAL_STATES: frozenset[str] = frozenset({'succeeded', 'failed', 'cancelled', 'timed_out', 'dead_letter'})
ACTIVE_STATES: frozenset[str] = frozenset({'queued', 'leased', 'running', 'waiting', 'retrying', 'cancel_requested'})

# Why a job stopped being active. A termination reason is recorded; it is never inferred.
TERMINATION_REASONS: tuple[str, ...] = (
    'completed', 'failed', 'user_cancelled', 'worker_timeout', 'provider_timeout',
    'deadline_exceeded', 'lease_expired', 'retry_exhausted', 'must_not_retry',
    'reconciliation_failed',
)

# Retry classifications. The effective classification of a job is the more conservative of the job
# type's policy and the failure's own classification - never the more optimistic one.
RETRY_POLICIES: tuple[str, ...] = (
    'safe_to_retry', 'requires_idempotency_key', 'requires_reconciliation', 'must_not_retry',
)

WORKER_CLASSES: tuple[str, ...] = (
    'media', 'ai', 'export', 'publishing', 'reconciliation', 'notification', 'maintenance', 'knowledge',
)

WORKER_STATUSES: tuple[str, ...] = ('online', 'draining', 'offline')

# The twenty durable job types the registry defines. The worker runtime dispatches on these keys and
# refuses to execute a type the registry does not define.
JOB_TYPES: dict[str, str] = {
    'media_preprocessing': 'media',
    'media_scan': 'media',
    'media_derivation': 'media',
    'proxy': 'media',
    'thumbnail': 'media',
    'transcription': 'ai',
    'reference_analysis': 'ai',
    'story_generation': 'ai',
    'production_generation': 'ai',
    'prompt_compilation': 'ai',
    'shot_match': 'ai',
    'export': 'export',
    'cloud_import': 'media',
    'long_form_generation': 'ai',
    'publication_submission': 'publishing',
    'provider_reconciliation': 'reconciliation',
    'notification_delivery': 'notification',
    'retention_sweep': 'maintenance',
    'deletion_orchestration': 'maintenance',
    'knowledge_ingestion': 'knowledge',
}

# Types that must never be blindly retried: the real-world effect has to be established first.
RECONCILIATION_REQUIRED_TYPES: frozenset[str] = frozenset({
    'cloud_import', 'publication_submission', 'deletion_orchestration',
})

OUTBOX_STATES: tuple[str, ...] = ('pending', 'claimed', 'delivered', 'skipped', 'failed', 'dead_letter')


class JobEnqueueRequest(BaseModel):
    """A durable work intent. The caller names the type and the workspace; nothing else is trusted."""

    model_config = ConfigDict(extra='ignore')
    job_type: str = Field(min_length=3, max_length=60)
    production_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, max_length=200)
    priority: int | None = Field(default=None, ge=0, le=100)
    parent_job_id: str | None = None
    timeout_seconds: int | None = Field(default=None, ge=30, le=86400)


class JobCancelRequest(BaseModel):
    """A creator asks for a cancellation. The database decides whether it can be honoured."""

    model_config = ConfigDict(extra='ignore')
    reason: str = Field(default='', max_length=400)


class JobRequeueRequest(BaseModel):
    """An editor reprocesses a finished failure after its real state is understood."""

    model_config = ConfigDict(extra='ignore')
    note: str = Field(min_length=1, max_length=400)
