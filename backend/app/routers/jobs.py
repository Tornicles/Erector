"""Prompt 11 durable job HTTP surface.

This surface answers the creator's questions about asynchronous work:

* *Did my work start, and what is it doing?* - one job's durable state, attempt count and history;
* *What is queued, running or stuck?* - the workspace job list and its honest counts;
* *Stop it.* - a cancellation request that the database honours only when it can be honoured.

A worker claim, a lease extension and a retry are server-owned operations. No route here lets a
client claim work, choose a worker, set an attempt count, or mark its own job complete. Enqueueing is
an editor action; reading is a member action.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor
from app.domain.jobs import JOB_STATES, JOB_TYPES, JobCancelRequest, JobEnqueueRequest, JobRequeueRequest
from app.services.jobs import JobRepository, decorate_job, decorate_list, decorate_summary, vocabulary

Envelope = Any


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        reason = str(exc.errors()[0].get('msg', '')) if exc.errors() else ''
        raise AppError('INVALID_JOB_INPUT', 'validation', f'{message} {reason}'.strip(), 422) from exc


def _uuid(value: str | None, message: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_JOB_INPUT', 'validation', message, 422) from exc


def register_job_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}'
    repository = JobRepository

    @application.get(f'{base}/jobs/vocabulary')
    async def job_vocabulary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        """The durable states, termination reasons, retry classes and job types that exist."""

        return envelope(request, vocabulary())

    @application.get(f'{base}/jobs/summary')
    async def job_summary(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Honest counts of queued, running, retrying, failed and stuck work for the workspace."""

        data = await repository(gateway).summary(workspace_id, request.state.access_token)
        return envelope(request, decorate_summary(data))

    @application.get(f'{base}/jobs')
    async def job_list(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The workspace's durable work, newest first, with an optional state or type filter."""

        raw_limit = request.query_params.get('limit') or '50'
        try:
            limit = max(1, min(200, int(raw_limit)))
        except ValueError as exc:
            raise AppError('INVALID_JOB_INPUT', 'validation', 'limit must be a whole number.', 422) from exc
        state = request.query_params.get('state') or None
        if state is not None and state not in JOB_STATES:
            raise AppError('INVALID_JOB_INPUT', 'validation',
                'That job state does not exist. Ask for one of the eleven durable states.', 422)
        job_type = request.query_params.get('job_type') or None
        if job_type is not None and job_type not in JOB_TYPES:
            raise AppError('INVALID_JOB_INPUT', 'validation',
                'That job type is not in the durable registry.', 422)
        include_terminal = (request.query_params.get('include_terminal') or 'true').lower() != 'false'
        data = await repository(gateway).listing(workspace_id, request.state.access_token, limit=limit,
            state=state, job_type=job_type, include_terminal=include_terminal)
        return envelope(request, decorate_list(data))

    @application.post(f'{base}/jobs')
    async def job_enqueue(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record a durable work intent. Repeating the same idempotency key returns the same job."""

        body = _validated(JobEnqueueRequest, await request.json(), 'Check the job request fields.')
        if body.job_type not in JOB_TYPES:
            raise AppError('INVALID_JOB_INPUT', 'validation',
                'That job type is not in the durable registry.', 422)
        data = await repository(gateway).enqueue(workspace_id, request.state.access_token,
            job_type=body.job_type,
            production_id=_uuid(body.production_id, 'That Production identifier is invalid.')
                if body.production_id else None,
            payload=body.payload, idempotency_key=body.idempotency_key, priority=body.priority,
            parent_job_id=_uuid(body.parent_job_id, 'That parent job identifier is invalid.')
                if body.parent_job_id else None,
            timeout_seconds=body.timeout_seconds)
        logger.info('job_enqueued', extra={'context': {'event': 'job_enqueued',
            'workspace_id': str(workspace_id), 'job_type': body.job_type,
            'job_id': str(data.get('job_id') or ''), 'idempotent': bool(data.get('idempotent'))}})
        return envelope(request, decorate_job(data))

    @application.get(f'{base}/jobs/{{job_id}}')
    async def job_status(workspace_id: UUID, job_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One job's durable state, attempt count and append-only history."""

        data = await repository(gateway).status(workspace_id, request.state.access_token,
            job_id=_uuid(job_id, 'That job identifier is invalid.'))
        return envelope(request, decorate_job(data))

    @application.post(f'{base}/jobs/{{job_id}}/cancel')
    async def job_cancel(workspace_id: UUID, job_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Request cancellation. Work whose external effect is unknown is reconciled, not abandoned."""

        body = _validated(JobCancelRequest, await request.json(), 'Check the cancellation fields.')
        data = await repository(gateway).cancel_request(workspace_id, request.state.access_token,
            job_id=_uuid(job_id, 'That job identifier is invalid.'), reason=body.reason)
        logger.info('job_cancel_requested', extra={'context': {'event': 'job_cancel_requested',
            'workspace_id': str(workspace_id), 'job_id': job_id}})
        return envelope(request, decorate_job(data))

    @application.post(f'{base}/jobs/{{job_id}}/requeue')
    async def job_requeue(workspace_id: UUID, job_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Reprocess a terminal failure. The database rejects work that still needs reconciliation."""

        body = _validated(JobRequeueRequest, await request.json(), 'Explain why this work is being reprocessed.')
        parsed_job_id = _uuid(job_id, 'That job identifier is invalid.')
        # The service-role-only state transition has no workspace parameter by design. Prove
        # membership-scoped ownership of this exact job before invoking it, so an ID from another
        # workspace can never cross the privileged boundary.
        await repository(gateway).status(workspace_id, request.state.access_token, job_id=parsed_job_id)
        service_secret = gateway.settings.supabase_service_role_key
        if service_secret is None:
            raise AppError('JOB_REQUEUE_UNAVAILABLE', 'unavailable',
                'This deployment has not enabled the server-side reprocessing path.', 503)
        data = await repository(gateway).requeue(workspace_id, service_secret.get_secret_value(),
            job_id=parsed_job_id, actor_id=user.id, note=body.note)
        logger.info('job_requeued', extra={'context': {'event': 'job_requeued',
            'workspace_id': str(workspace_id), 'job_id': job_id}})
        return envelope(request, decorate_job(data))
