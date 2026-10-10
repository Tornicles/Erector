"""Prompt 11 worker runtime.

The database owns durability: a claim is a lease with an expiry, a completion must present the live
lease, a retry is classification-aware, and a timeout or an expired lease is recorded as a
termination reason. This module is the loop that drives those guarantees from a real process.

What the runtime is responsible for, and nothing more:

* register the worker and heartbeat it, so an operator can see which workers exist;
* claim work **for the class this worker declares**, never for another class;
* renew the lease while a handler runs, so a slow job is not reclaimed mid-flight;
* execute the handler with a bound, then complete, fail, acknowledge a cancellation, or - when this
  deployment has no handler for a type - release the job so another deployment can take it;
* recover expired leases and time out jobs that outlived their deadline, including on startup;
* drain honestly on shutdown: stop claiming, stop heartbeating as online, and release the leases it
  still holds, because a lease held by a dead process is worse than no lease.

A crash between "effect happened" and "job completed" is exactly what the durable design expects: the
lease expires, the job is reclaimed, and the completion carries the operation's stable identity so the
database can refuse or reconcile a duplicate real-world effect.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4

from app.core.errors import AppError
from app.domain.jobs import JOB_TYPES, WORKER_CLASSES

LAYER = 'Durable jobs'

# The retry classifications the database understands. A failure may report one of these; the database
# keeps the more conservative of this and the job type's own policy.
RETRY_CLASSIFICATIONS: frozenset[str] = frozenset({
    'safe_to_retry', 'requires_idempotency_key', 'requires_reconciliation', 'must_not_retry',
})

CANCEL_OUTCOMES: frozenset[str] = frozenset({'cancelled', 'cannot_cancel_remote'})


class JobGateway(Protocol):
    """The gateway shape the runtime needs. The real one is `SupabaseGateway`."""

    async def rpc_detailed(self, name: str, *, token: str, json: Any, layer: str = ...) -> Any: ...


class JobFailure(Exception):
    """A handler's honest report that the work failed.

    `classification` is what the handler believes about retrying this failure; the database keeps the
    more conservative of it and the job type's policy, so an optimistic handler cannot make an
    externally consequential operation retryable.
    """

    def __init__(self, code: str, message: str, *, classification: str | None = None,
        retry_after_seconds: int | None = None, timeout_kind: str | None = None) -> None:
        super().__init__(code)
        if classification is not None and classification not in RETRY_CLASSIFICATIONS:
            raise ValueError(f'Unknown retry classification: {classification}')
        self.code = code
        self.message = message
        self.classification = classification
        self.retry_after_seconds = retry_after_seconds
        self.timeout_kind = timeout_kind


class JobCancelled(Exception):
    """A handler reports that the cancellation request was honoured before it took effect."""


class JobNotCancellable(Exception):
    """A handler reports that the external effect is already in flight and cannot be recalled."""


@dataclass(slots=True)
class JobOutcome:
    """What a successful handler returns. The database records it as the job's result."""

    result: dict[str, Any] = field(default_factory=dict)
    result_reference: str | None = None
    note: str = ''


Handler = Callable[[dict[str, Any]], Awaitable[JobOutcome | dict[str, Any] | None]]


class UnhandledJobType(Exception):
    """This deployment has no handler for a durable job type."""


@dataclass(slots=True)
class WorkerStats:
    claimed: int = 0
    succeeded: int = 0
    failed: int = 0
    released: int = 0
    cancelled: int = 0
    recovered: int = 0
    timed_out: int = 0
    outbox_delivered: int = 0
    lease_lost: int = 0

    def as_dict(self) -> dict[str, int]:
        return {'claimed': self.claimed, 'succeeded': self.succeeded, 'failed': self.failed,
            'released': self.released, 'cancelled': self.cancelled, 'recovered': self.recovered,
            'timed_out': self.timed_out, 'outbox_delivered': self.outbox_delivered,
            'lease_lost': self.lease_lost}


class WorkerRuntime:
    """One worker process for one worker class."""

    def __init__(self, settings: Any, gateway: JobGateway, handlers: dict[str, Handler], *,
        worker_id: str | None = None, worker_class: str | None = None,
        logger: logging.Logger | None = None) -> None:
        self.settings = settings
        self.gateway = gateway
        self.handlers = dict(handlers)
        self.worker_id = worker_id or settings.worker_id or self._default_worker_id()
        self.worker_class = worker_class or settings.worker_class
        if self.worker_class not in WORKER_CLASSES:
            raise ValueError(f'Unknown worker class: {self.worker_class}')
        self.instance = settings.worker_instance or 'local'
        self.logger = logger or logging.getLogger('tonde.worker')
        self.stats = WorkerStats()
        self.started = False

    # ------------------------------------------------------------------ identity

    @staticmethod
    def _default_worker_id() -> str:
        # Stable per process and per host so a restart is a new worker, not a renamed one.
        return f'{socket.gethostname()}-{uuid4().hex[:8]}'

    @property
    def service_token(self) -> str:
        """The runtime calls the database as the service role. Without it, it refuses to start."""

        secret = getattr(self.settings, 'supabase_service_role_key', None)
        if secret is None:
            raise AppError('WORKER_NOT_CONFIGURED', 'unavailable',
                'The worker has no service credential, so it cannot claim durable work.', 503)
        return secret.get_secret_value()

    def capabilities(self) -> list[str]:
        """The job types this deployment can actually execute, in the class it declares."""

        return sorted(job_type for job_type in self.handlers
            if JOB_TYPES.get(job_type) == self.worker_class)

    def handler_for(self, job_type: str) -> Handler:
        handler = self.handlers.get(job_type)
        if handler is None:
            raise UnhandledJobType(job_type)
        return handler

    # ------------------------------------------------------------------ lifecycle

    async def register(self) -> dict[str, Any]:
        """Announce this worker. Registration is a database record, not a log line."""

        result = await self._rpc('worker_register', {
            'p_worker_id': self.worker_id, 'p_worker_class': self.worker_class,
            'p_instance': self.instance, 'p_version': str(getattr(self.settings, 'app_version', '')),
            'p_capabilities': self.capabilities()})
        self.started = True
        self.logger.info('worker_registered', extra={'context': {'event': 'worker_registered',
            'worker_id': self.worker_id, 'worker_class': self.worker_class,
            'capabilities': self.capabilities()}})
        return result

    async def heartbeat(self, status: str = 'online') -> dict[str, Any]:
        return await self._rpc('worker_heartbeat', {'p_worker_id': self.worker_id,
            'p_status': status, 'p_seconds': self.settings.worker_lease_seconds})

    async def recover(self) -> dict[str, Any]:
        """Reclaim leases a dead worker held, and record jobs that outlived their deadline.

        Both are safe to run from any worker: the database decides what is actually expired.
        """

        recovered = await self._rpc('job_recover_expired_leases', {
            'p_limit': 100, 'p_grace_seconds': 0})
        timed_out = await self._rpc('job_timeout_scan', {'p_limit': 100})
        self.stats.recovered += int(recovered.get('recovered') or 0)
        self.stats.timed_out += int(timed_out.get('timed_out') or 0)
        return {'recovered': recovered, 'timed_out': timed_out}

    async def shutdown(self) -> dict[str, Any]:
        """Drain: stop claiming, stop presenting as online, release the leases still held."""

        released: dict[str, Any] = {}
        try:
            await self.heartbeat('draining')
        except AppError as exc:
            self.logger.warning('worker_drain_failed', extra={'context': {'event': 'worker_drain_failed',
                'worker_id': self.worker_id, 'error_code': exc.code}})
        try:
            released = await self._rpc('worker_release_leases', {'p_worker_id': self.worker_id,
                'p_note': 'Worker shut down and released its claims.'})
        except AppError as exc:
            self.logger.warning('worker_release_failed', extra={'context': {
                'event': 'worker_release_failed', 'worker_id': self.worker_id, 'error_code': exc.code}})
        try:
            await self.heartbeat('offline')
        except AppError:
            pass
        self.started = False
        self.logger.info('worker_stopped', extra={'context': {'event': 'worker_stopped',
            'worker_id': self.worker_id, 'stats': self.stats.as_dict()}})
        return released

    # ------------------------------------------------------------------ work

    async def claim(self) -> list[dict[str, Any]]:
        result = await self._rpc('job_claim', {'p_worker_id': self.worker_id,
            'p_worker_class': self.worker_class, 'p_limit': self.settings.worker_batch_limit,
            'p_lease_seconds': self.settings.worker_lease_seconds})
        return list(result.get('claimed') or [])

    async def run_once(self, *, outbox: bool = True) -> dict[str, int]:
        """One pass: recover, claim, execute the batch, then drain a batch of outbox events."""

        await self.recover()
        claimed = await self.claim()
        self.stats.claimed += len(claimed)
        for job in claimed:
            await self.process(job)
        if outbox and self.settings.outbox_enabled:
            await self.deliver_outbox()
        return self.stats.as_dict()

    async def run_forever(self, stop: asyncio.Event) -> None:
        """Run until `stop` is set. Shutdown is graceful and always releases held leases."""

        await self.register()
        try:
            while not stop.is_set():
                try:
                    await self.heartbeat()
                    processed = await self.run_once()
                except AppError as exc:
                    self.logger.error('worker_pass_failed', extra={'context': {
                        'event': 'worker_pass_failed', 'worker_id': self.worker_id,
                        'error_code': exc.code}})
                    processed = None
                if stop.is_set():
                    break
                # Busy: poll quickly. Idle: wait longer, but stay responsive to shutdown.
                busy = bool(processed and processed.get('claimed')) if processed else False
                wait = self.settings.worker_poll_seconds if busy else self.settings.worker_idle_seconds
                try:
                    await asyncio.wait_for(stop.wait(), timeout=wait)
                except asyncio.TimeoutError:
                    continue
        finally:
            await self.shutdown()

    async def process(self, job: dict[str, Any]) -> dict[str, Any]:
        """Execute one claimed job through the lease, and record exactly what happened."""

        job_id = str(job.get('job_id') or job.get('id') or '')
        job_type = str(job.get('job_type') or '')
        if not job_id or not job_type:
            return {'job_id': job_id, 'outcome': 'ignored'}
        try:
            handler = self.handler_for(job_type)
        except UnhandledJobType:
            # Honest: this deployment cannot execute it. Release rather than fake a result or
            # permanently dead-letter work another deployment is equipped to do.
            self.stats.released += 1
            await self._rpc('job_release', {'target_job': job_id, 'p_worker': self.worker_id,
                'p_note': 'No handler is registered for this job type in this worker deployment.'})
            self.logger.warning('job_handler_missing', extra={'context': {'event': 'job_handler_missing',
                'job_id': job_id, 'job_type': job_type, 'worker_id': self.worker_id}})
            return {'job_id': job_id, 'outcome': 'released'}

        await self._rpc('job_start', {'target_job': job_id, 'p_worker': self.worker_id})
        heartbeat = asyncio.create_task(self._renew_lease(job_id))
        try:
            # A handler is bounded. A job that outlives its bound is reported as a timeout, and the
            # database - not the runtime - decides whether that failure is retryable.
            outcome = await asyncio.wait_for(handler(job),
                timeout=float(self.settings.worker_job_timeout_seconds))
        except JobCancelled:
            self.stats.cancelled += 1
            await self._acknowledge_cancel(job_id, 'cancelled')
            return {'job_id': job_id, 'outcome': 'cancelled'}
        except JobNotCancellable as exc:
            self.stats.cancelled += 1
            await self._acknowledge_cancel(job_id, 'cannot_cancel_remote', str(exc))
            return {'job_id': job_id, 'outcome': 'cannot_cancel_remote'}
        except asyncio.TimeoutError:
            # A bound was reached. Report it as a timeout and let the database choose the policy for
            # this job type; the runtime never claims a timed-out operation was safe to retry.
            self.stats.failed += 1
            await self._fail(job_id, 'JOB_TIMEOUT',
                f'No outcome within {self.settings.worker_job_timeout_seconds} seconds.',
                classification=None, timeout_kind='worker_timeout')
            return {'job_id': job_id, 'outcome': 'timed_out'}
        except JobFailure as exc:
            self.stats.failed += 1
            await self._fail(job_id, exc.code, exc.message, classification=exc.classification,
                retry_after_seconds=exc.retry_after_seconds, timeout_kind=exc.timeout_kind)
            return {'job_id': job_id, 'outcome': 'failed'}
        except Exception as exc:  # noqa: BLE001 - an unexpected handler crash is reported, not hidden
            self.logger.error('job_handler_crashed', extra={'context': {'event': 'job_handler_crashed',
                'job_id': job_id, 'job_type': job_type, 'exception_type': type(exc).__name__}})
            self.stats.failed += 1
            await self._fail(job_id, 'JOB_HANDLER_ERROR', f'The handler raised {type(exc).__name__}.',
                classification=None)
            return {'job_id': job_id, 'outcome': 'failed'}
        finally:
            heartbeat.cancel()
            try:
                await heartbeat
            except (asyncio.CancelledError, AppError):
                pass
        return await self._complete(job_id, outcome)

    async def _complete(self, job_id: str, outcome: JobOutcome | dict[str, Any] | None) -> dict[str, Any]:
        if isinstance(outcome, JobOutcome):
            result, reference, note = outcome.result, outcome.result_reference, outcome.note
        elif isinstance(outcome, dict):
            result, reference, note = outcome, None, ''
        else:
            result, reference, note = {}, None, ''
        try:
            await self._rpc('job_complete', {'target_job': job_id, 'p_worker': self.worker_id,
                'p_result': result, 'p_result_reference': reference, 'p_note': note})
        except AppError as exc:
            # The lease was lost while the handler ran. The effect may exist; completing now would be
            # a lie. Leave it to lease recovery and reconciliation.
            if exc.code == 'JOB_LEASE_EXPIRED':
                self.stats.lease_lost += 1
                self.logger.error('job_lease_lost', extra={'context': {'event': 'job_lease_lost',
                    'job_id': job_id, 'worker_id': self.worker_id}})
                return {'job_id': job_id, 'outcome': 'lease_lost'}
            raise
        self.stats.succeeded += 1
        self.logger.info('job_completed', extra={'context': {'event': 'job_completed',
            'job_id': job_id, 'worker_id': self.worker_id}})
        return {'job_id': job_id, 'outcome': 'succeeded'}

    async def _fail(self, job_id: str, code: str, message: str, *, classification: str | None,
        retry_after_seconds: int | None = None, timeout_kind: str | None = None) -> None:
        payload: dict[str, Any] = {'target_job': job_id, 'p_worker': self.worker_id,
            'p_error_code': code, 'p_error_message': message[:400], 'p_classification': classification}
        if retry_after_seconds is not None:
            payload['p_retry_after_seconds'] = retry_after_seconds
        if timeout_kind is not None:
            payload['p_timeout_kind'] = timeout_kind
        try:
            await self._rpc('job_fail', payload)
        except AppError as exc:
            if exc.code == 'JOB_LEASE_EXPIRED':
                self.stats.lease_lost += 1
                return
            raise

    async def _acknowledge_cancel(self, job_id: str, outcome: str, note: str = '') -> None:
        if outcome not in CANCEL_OUTCOMES:
            raise ValueError(f'Unknown cancellation outcome: {outcome}')
        try:
            await self._rpc('job_cancel_acknowledge', {'target_job': job_id, 'p_worker': self.worker_id,
                'p_outcome': outcome, 'p_note': note or 'Reported by the worker.'})
        except AppError as exc:
            if exc.code == 'JOB_LEASE_EXPIRED':
                self.stats.lease_lost += 1
                return
            raise

    async def _renew_lease(self, job_id: str) -> None:
        """Renew the lease while a handler runs. A lost lease stops the renewals, never the effect."""

        interval = self.settings.worker_heartbeat_seconds
        while True:
            await asyncio.sleep(interval)
            try:
                await self._rpc('job_heartbeat', {'target_job': job_id, 'p_worker': self.worker_id,
                    'p_seconds': self.settings.worker_lease_seconds})
            except AppError as exc:
                self.logger.warning('job_heartbeat_failed', extra={'context': {
                    'event': 'job_heartbeat_failed', 'job_id': job_id, 'error_code': exc.code}})
                return

    # ------------------------------------------------------------------ outbox

    async def deliver_outbox(self) -> int:
        """Claim a batch of committed work intents and mark each one's real outcome.

        The outbox exists so a domain commit and its asynchronous intent are the same transaction.
        A delivery that fails is recorded with its retryability - never silently dropped.
        """

        result = await self._rpc('outbox_claim', {'p_worker': self.worker_id,
            'p_limit': self.settings.outbox_batch_limit, 'p_lease_seconds': self.settings.outbox_lease_seconds})
        events = list(result.get('claimed') or [])
        for event in events:
            event_id = str(event.get('event_id') or event.get('id') or '')
            if not event_id:
                continue
            await self._rpc('outbox_deliver', {'target_event': event_id, 'p_worker': self.worker_id,
                'p_job_id': event.get('job_id')})
            self.stats.outbox_delivered += 1
        return len(events)

    # ------------------------------------------------------------------ transport

    async def _rpc(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed(name, token=self.service_token, json=payload, layer=LAYER)


def build_worker(settings: Any, gateway: JobGateway, handlers: dict[str, Handler], *,
    logger: logging.Logger | None = None) -> WorkerRuntime:
    """Build the runtime this deployment describes. Disabled workers are not started by the app."""

    return WorkerRuntime(settings, gateway, handlers, logger=logger)
