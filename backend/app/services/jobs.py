"""Prompt 11 durable job service: creator vocabulary plus the RPC repository.

The database owns the state machine. This layer attaches the human sentence for each state,
termination reason and retry classification so the creator reads *why* a job stopped instead of a
raw enum, and it never recomputes a state the database already decided.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.domain.jobs import (
    ACTIVE_STATES,
    JOB_TYPES,
    RECONCILIATION_REQUIRED_TYPES,
    RETRY_POLICIES,
    TERMINAL_STATES,
    TERMINATION_REASONS,
    WORKER_CLASSES,
)

LAYER = 'Durable jobs'

STATE_LABELS: dict[str, str] = {
    'queued': 'Queued', 'leased': 'Claimed by a worker', 'running': 'Running',
    'waiting': 'Waiting on an external operation', 'retrying': 'Waiting to retry',
    'cancel_requested': 'Cancellation requested', 'succeeded': 'Succeeded', 'failed': 'Failed',
    'cancelled': 'Cancelled', 'timed_out': 'Timed out', 'dead_letter': 'Stopped after repeated failure',
}

TERMINATION_LABELS: dict[str, str] = {
    'completed': 'Completed normally',
    'failed': 'Failed',
    'user_cancelled': 'Cancelled by the creator',
    'worker_timeout': 'The worker stopped heartbeating',
    'provider_timeout': 'The external provider did not answer in time',
    'deadline_exceeded': 'The job deadline passed',
    'lease_expired': 'The worker lost its claim',
    'retry_exhausted': 'Out of retry attempts',
    'must_not_retry': 'Not safe to retry automatically',
    'reconciliation_failed': 'Reconciliation could not establish the real result',
}

RETRY_POLICY_LABELS: dict[str, str] = {
    'safe_to_retry': 'Safe to retry',
    'requires_idempotency_key': 'Retry needs one stable operation identity',
    'requires_reconciliation': 'Retry requires establishing the real result first',
    'must_not_retry': 'Must not be retried',
}

WORKER_CLASS_LABELS: dict[str, str] = {
    'media': 'Media', 'ai': 'Direction and analysis', 'export': 'Export', 'publishing': 'Publishing',
    'reconciliation': 'Reconciliation', 'notification': 'Notification', 'maintenance': 'Maintenance',
    'knowledge': 'Knowledge',
}

RULE = ('A job is a durable intent with an append-only history. A worker claim is a lease with an '
    'expiry, so two workers can never hold the same work, and an operation that already had a '
    'real-world effect is never blindly retried.')
LIMITATION = ('This surface reports the state the database recorded. It does not predict completion, '
    'invent progress or promise that an external provider will answer.')


def vocabulary() -> dict[str, Any]:
    """The job vocabulary: states, termination reasons, retry classes and worker classes."""

    return {
        'job_states': [{'state': key, 'label': STATE_LABELS[key], 'terminal': key in TERMINAL_STATES}
            for key in STATE_LABELS],
        'termination_reasons': [{'reason': key, 'label': TERMINATION_LABELS[key]}
            for key in TERMINATION_REASONS],
        'retry_policies': [{'policy': key, 'label': RETRY_POLICY_LABELS[key]} for key in RETRY_POLICIES],
        'worker_classes': [{'worker_class': key, 'label': WORKER_CLASS_LABELS[key]} for key in WORKER_CLASSES],
        'job_types': [{'job_type': key, 'worker_class': value,
            'requires_reconciliation': key in RECONCILIATION_REQUIRED_TYPES} for key, value in JOB_TYPES.items()],
        'rules': RULE,
        'limitation': LIMITATION,
    }


def decorate_job(data: dict[str, Any]) -> dict[str, Any]:
    """Attach the human sentence and the honest retry meaning to one job."""

    state = str(data.get('status') or '')
    data['status_label'] = STATE_LABELS.get(state, 'Unknown')
    data['is_active'] = state in ACTIVE_STATES
    data['is_terminal'] = state in TERMINAL_STATES
    data['state_line'] = _state_line(state, data)
    reason = data.get('termination_reason')
    if reason:
        data['termination_label'] = TERMINATION_LABELS.get(str(reason), 'Stopped')
    if data.get('failure_classification'):
        data['failure_classification_label'] = RETRY_POLICY_LABELS.get(str(data['failure_classification']),
            'Unknown')
    if data.get('worker_class'):
        data['worker_class_label'] = WORKER_CLASS_LABELS.get(str(data['worker_class']), 'Worker')
    data.setdefault('note', RULE)
    return data


def _state_line(state: str, data: dict[str, Any]) -> str:
    if state == 'succeeded':
        return 'Completed. The result is recorded in its history.'
    if state == 'cancel_requested':
        return ('Cancellation requested. A job whose work cannot be undone is stopped only when the '
            'real state of the external operation is known.')
    if state == 'dead_letter':
        return 'Stopped after its attempts: the recorded failure is final until a creator reprocesses it.'
    if state == 'retrying':
        return 'Waiting to retry with a recorded backoff. The next attempt is scheduled, not immediate.'
    if state == 'waiting':
        return 'Waiting on an external operation whose real result is not yet known.'
    if state in TERMINAL_STATES:
        return STATE_LABELS.get(state, 'Stopped')
    return STATE_LABELS.get(state, 'In progress')


def decorate_list(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a page of jobs."""

    for entry in data.get('jobs') or []:
        entry['status_label'] = STATE_LABELS.get(str(entry.get('status')), 'Unknown')
    data.setdefault('note', 'Recent durable work for this workspace, newest first.')
    return data


def decorate_summary(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a workspace job summary."""

    data.setdefault('note', RULE)
    return data


class JobRepository:
    """Every call goes through the shared RPC helper with this layer's name attached."""

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def enqueue(self, workspace_id: UUID, token: str, *, job_type: str,
        production_id: UUID | None, payload: dict[str, Any], idempotency_key: str | None,
        priority: int | None, parent_job_id: UUID | None, timeout_seconds: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('job_enqueue', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_job_type': job_type,
            'target_production': str(production_id) if production_id else None,
            'p_payload': payload, 'p_idempotency_key': idempotency_key,
            'target_priority': priority,
            'p_parent_job': str(parent_job_id) if parent_job_id else None,
            'target_timeout_seconds': timeout_seconds})

    async def status(self, workspace_id: UUID, token: str, *, job_id: UUID) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('job_status', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_job': str(job_id)})

    async def listing(self, workspace_id: UUID, token: str, *, limit: int, state: str | None,
        job_type: str | None, include_terminal: bool) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('job_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'p_limit': limit, 'p_state': state,
            'p_job_type': job_type, 'p_include_terminal': include_terminal})

    async def summary(self, workspace_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('job_workspace_summary', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id)})

    async def cancel_request(self, workspace_id: UUID, token: str, *, job_id: UUID, reason: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('job_cancel_request', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_job': str(job_id), 'p_reason': reason})

    async def requeue(self, workspace_id: UUID, service_token: str, *, job_id: UUID, actor_id: UUID, note: str) -> dict[str, Any]:
        # `job_requeue` is intentionally service-role-only in migration 036. The HTTP route first
        # checks the creator's live workspace-editor authority and records that creator as actor.
        return await self.gateway.rpc_detailed('job_requeue', token=service_token, layer=LAYER, json={
            'target_job': str(job_id), 'p_actor': str(actor_id), 'p_note': note})
