"""Prompt 11 worker runtime coverage.

The durable guarantees themselves - a lease cannot be stolen, two workers cannot hold the same job,
an expired lease is recoverable, a stale owner cannot complete, duplicate completion is harmless, a
duplicate enqueue with one idempotency key does not duplicate work, and a reconciliation-required
operation is never blindly retried - are enforced in the database and proven against real embedded
PostgreSQL in tests/database/prompt11-jobs.test.mjs. These tests prove the *runtime* honours them:
the call sequence it makes, that a lost lease is never reported as a completion, that a handler's
failure classification is passed through rather than decided here, that this deployment releases work
it has no handler for instead of faking it, and that shutdown drains honestly.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import AppError
from app.worker.handlers import UNIMPLEMENTED_JOB_TYPES, HandlerContext, build_handlers
from app.worker.runtime import (
    JobCancelled,
    JobFailure,
    JobNotCancellable,
    JobOutcome,
    UnhandledJobType,
    WorkerRuntime,
    build_worker,
)

WORKSPACE = '00000000-0000-4000-8000-000000000010'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
SHOT = '00000000-0000-4000-8000-000000000301'
JOB = '00000000-0000-4000-8000-000000000e01'


def stub_settings(**overrides: Any) -> SimpleNamespace:
    values: dict[str, Any] = {
        'worker_id': 'test-worker', 'worker_class': 'ai', 'worker_instance': 'test',
        'worker_poll_seconds': 0.01, 'worker_idle_seconds': 0.02, 'worker_batch_limit': 1,
        'worker_lease_seconds': 300, 'worker_heartbeat_seconds': 30,
        'worker_job_timeout_seconds': 1800, 'worker_shutdown_grace_seconds': 1.0,
        'outbox_enabled': True, 'outbox_batch_limit': 10, 'outbox_lease_seconds': 120,
        'app_version': '0.1.0', 'supabase_service_role_key': SecretStr('service-role-key'),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class FakeGateway:
    """Records every RPC and answers from a script.

    An entry may be a value, a callable (given the payload) or an exception to raise, which is how
    the tests reproduce a lost lease and a provider failure without a real database.
    """

    def __init__(self, script: dict[str, Any] | None = None) -> None:
        self.script = dict(script or {})
        self.calls: list[dict[str, Any]] = []

    async def rpc_detailed(self, name: str, *, token: str, json: Any, layer: str = 'Durable jobs') -> Any:
        self.calls.append({'name': name, 'payload': json, 'token': token, 'layer': layer})
        answer = self.script.get(name, {})
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(json)
        return answer

    def names(self) -> list[str]:
        return [call['name'] for call in self.calls]

    def payload_for(self, name: str) -> dict[str, Any]:
        for call in self.calls:
            if call['name'] == name:
                return call['payload']
        raise AssertionError(f'{name} was never called: {self.names()}')


def claimed_job(job_type: str = 'prompt_compilation', **overrides: Any) -> dict[str, Any]:
    job = {'job_id': JOB, 'workspace_id': WORKSPACE, 'job_type': job_type,
        'production_id': PRODUCTION, 'attempt': 1, 'max_attempts': 3, 'priority': 50,
        'operation_id': 'op-1', 'payload_version': 1,
        'payload': {'workspace_id': WORKSPACE, 'production_id': PRODUCTION, 'shot_id': SHOT,
            'tool_key': 'veo', 'expected_plan_revision': 4}}
    job.update(overrides)
    return job


def runtime_with(handlers: dict[str, Any], script: dict[str, Any] | None = None,
    **settings: Any) -> tuple[WorkerRuntime, FakeGateway]:
    gateway = FakeGateway(script)
    runtime = build_worker(stub_settings(**settings), gateway, handlers)
    return runtime, gateway


# ------------------------------------------------------------------ the happy path

async def test_a_handler_runs_through_claim_start_and_complete() -> None:
    compiled = {'shot_id': SHOT, 'prompt': 'Camera: slow push in. Subject: Marcus.'}
    gateway = FakeGateway({'job_claim': {'claimed': [claimed_job()]},
        'ai_playbook_prompt_compile': compiled})
    # The real registered handler, wired to the same transport, so the whole path is exercised.
    runtime = build_worker(stub_settings(), gateway,
        build_handlers(HandlerContext(gateway, lambda: 'service-role-key')))

    await runtime.run_once()

    assert gateway.names() == ['job_recover_expired_leases', 'job_timeout_scan', 'job_claim',
        'job_start', 'ai_playbook_prompt_compile', 'job_complete', 'outbox_claim']
    assert runtime.stats.as_dict()['succeeded'] == 1
    complete = gateway.payload_for('job_complete')
    assert complete['target_job'] == JOB and complete['p_worker'] == 'test-worker'
    assert complete['p_result'] == compiled
    # The worker calls the database as the service role, never as the creator.
    assert all(call['token'] == 'service-role-key' for call in gateway.calls)
    # Prompt compilation reads the plan and the documented tool knowledge; it produces no media.
    assert 'prompt' in compiled and 'video' not in complete['p_result']


async def test_the_prompt_compilation_handler_is_a_direction_step_not_generation() -> None:
    gateway = FakeGateway({'ai_playbook_prompt_compile': {'shot_id': SHOT, 'prompt': 'x'}})
    handlers = build_handlers(HandlerContext(gateway, lambda: 'service-role-key'))
    outcome = await handlers['prompt_compilation'](claimed_job())
    assert isinstance(outcome, JobOutcome)
    assert outcome.result_reference == SHOT
    assert gateway.payload_for('ai_playbook_prompt_compile')['p_tool_key'] == 'veo'


async def test_a_handler_with_missing_input_fails_without_guessing_a_classification() -> None:
    gateway = FakeGateway({})
    handlers = build_handlers(HandlerContext(gateway, lambda: 'service-role-key'))
    job = claimed_job()
    job['payload'] = {}
    with pytest.raises(JobFailure) as failure:
        await handlers['prompt_compilation'](job)
    assert failure.value.code == 'PROMPT_COMPILATION_INPUT_MISSING'
    assert failure.value.classification is None
    assert gateway.calls == [], 'no request is made with incomplete input'


# ------------------------------------------------------------------ honest failure reporting

async def test_a_lost_lease_is_never_reported_as_a_completion() -> None:
    runtime, gateway = runtime_with(
        {'prompt_compilation': _recording_handler(JobOutcome())},
        {'job_claim': {'claimed': [claimed_job()]},
         'job_complete': AppError('JOB_LEASE_EXPIRED', 'conflict', 'The lease expired.', 409)})

    result = await runtime.process(claimed_job())

    assert result['outcome'] == 'lease_lost'
    assert runtime.stats.lease_lost == 1
    assert runtime.stats.succeeded == 0
    assert 'job_complete' in gateway.names()


async def test_a_handler_failure_reports_its_classification_and_never_upgrades_retryability() -> None:
    def failing(job: dict[str, Any]) -> Any:
        async def handler(_: dict[str, Any]) -> JobOutcome:
            raise JobFailure('PROVIDER_UNCERTAIN', 'The provider did not answer.',
                classification='requires_reconciliation', retry_after_seconds=45)
        return handler

    runtime, gateway = runtime_with(
        {'prompt_compilation': failing(claimed_job())},
        {'job_claim': {'claimed': [claimed_job()]}})

    result = await runtime.process(claimed_job())

    assert result['outcome'] == 'failed'
    assert runtime.stats.failed == 1
    fail = gateway.payload_for('job_fail')
    assert fail['p_classification'] == 'requires_reconciliation'
    assert fail['p_retry_after_seconds'] == 45
    assert fail['p_error_code'] == 'PROVIDER_UNCERTAIN'


async def test_an_unknown_retry_classification_is_refused_at_construction() -> None:
    with pytest.raises(ValueError):
        JobFailure('PROVIDER_UNCERTAIN', 'Bad class', classification='try_again_quickly')


async def test_a_handler_that_outlives_its_bound_is_reported_as_a_timeout() -> None:
    async def hanging(_: dict[str, Any]) -> JobOutcome:
        await asyncio.sleep(5)
        return JobOutcome()

    runtime, gateway = runtime_with({'prompt_compilation': hanging},
        {'job_claim': {'claimed': [claimed_job()]}}, worker_job_timeout_seconds=1800)

    # The bound is the settings value. The deadline is shortened here so the test stays fast; the
    # recorded failure keeps exactly the shape a real one-hour timeout produces.
    runtime.settings.worker_job_timeout_seconds = 1
    result = await runtime.process(claimed_job())

    assert result['outcome'] == 'timed_out'
    fail = gateway.payload_for('job_fail')
    assert fail['p_error_code'] == 'JOB_TIMEOUT'
    assert fail['p_timeout_kind'] == 'worker_timeout'
    # The runtime never asserts retryability for work it interrupted.
    assert fail['p_classification'] is None


async def test_a_cancellation_the_handler_honoured_is_acknowledged() -> None:
    async def cancelling(_: dict[str, Any]) -> JobOutcome:
        raise JobCancelled('The creator cancelled before the work took effect.')

    runtime, gateway = runtime_with({'prompt_compilation': cancelling},
        {'job_claim': {'claimed': [claimed_job()]}})
    result = await runtime.process(claimed_job())

    assert result['outcome'] == 'cancelled'
    assert gateway.payload_for('job_cancel_acknowledge')['p_outcome'] == 'cancelled'


async def test_an_irreversible_external_effect_is_reported_as_not_cancellable() -> None:
    async def in_flight(_: dict[str, Any]) -> JobOutcome:
        raise JobNotCancellable('publication_submission')

    runtime, gateway = runtime_with({'prompt_compilation': in_flight},
        {'job_claim': {'claimed': [claimed_job()]}})
    result = await runtime.process(claimed_job())

    assert result['outcome'] == 'cannot_cancel_remote'
    ack = gateway.payload_for('job_cancel_acknowledge')
    assert ack['p_outcome'] == 'cannot_cancel_remote'
    assert runtime.stats.cancelled == 1


# ------------------------------------------------------------------ unimplemented work

async def test_work_this_deployment_cannot_execute_is_released_not_faked() -> None:
    runtime, gateway = runtime_with({'prompt_compilation': _recording_handler(JobOutcome())},
        {'job_claim': {'claimed': [claimed_job('proxy')]}})

    await runtime.run_once()

    assert 'job_start' not in gateway.names()
    assert 'job_complete' not in gateway.names()
    assert gateway.payload_for('job_release')['target_job'] == JOB
    assert runtime.stats.released == 1


def test_unimplemented_job_types_are_declared_not_assumed() -> None:
    # Media generation is absent by design: TONDE is the Director, not the renderer. The remaining
    # absences are work whose implementation is not in this build.
    assert 'proxy' in UNIMPLEMENTED_JOB_TYPES
    assert 'media_derivation' in UNIMPLEMENTED_JOB_TYPES
    assert not any('generation' in job_type and job_type.startswith('media')
        for job_type in UNIMPLEMENTED_JOB_TYPES)


def test_capabilities_are_limited_to_the_declared_class() -> None:
    runtime, _ = runtime_with({'prompt_compilation': _recording_handler(JobOutcome())})
    assert runtime.capabilities() == ['prompt_compilation']
    assert runtime.handler_for('prompt_compilation') is not None
    with pytest.raises(UnhandledJobType):
        runtime.handler_for('export')


# ------------------------------------------------------------------ lifecycle

async def test_registration_declares_identity_and_capabilities() -> None:
    runtime, gateway = runtime_with({'prompt_compilation': _recording_handler(JobOutcome())})
    await runtime.register()
    payload = gateway.payload_for('worker_register')
    assert payload['p_worker_id'] == 'test-worker'
    assert payload['p_worker_class'] == 'ai'
    assert payload['p_capabilities'] == ['prompt_compilation']


async def test_recovery_reclaims_expired_leases_and_times_out_overdue_jobs() -> None:
    runtime, gateway = runtime_with({}, {
        'job_recover_expired_leases': {'recovered': 2},
        'job_timeout_scan': {'timed_out': 1}})
    await runtime.recover()
    assert gateway.payload_for('job_recover_expired_leases') == {'p_limit': 100, 'p_grace_seconds': 0}
    assert runtime.stats.recovered == 2 and runtime.stats.timed_out == 1


async def test_shutdown_drains_stops_being_online_and_releases_its_leases() -> None:
    runtime, gateway = runtime_with({}, {'worker_release_leases': {'released': ['job-1']}})
    await runtime.register()
    released = await runtime.shutdown()

    assert released == {'released': ['job-1']}
    heartbeats = [call['payload']['p_status'] for call in gateway.calls if call['name'] == 'worker_heartbeat']
    assert heartbeats == ['draining', 'offline']
    assert gateway.payload_for('worker_release_leases')['p_worker_id'] == 'test-worker'


async def test_run_forever_registers_works_and_drains_on_stop() -> None:
    runtime, gateway = runtime_with({'prompt_compilation': _recording_handler(JobOutcome())},
        {'job_claim': {'claimed': [claimed_job()]}})
    stop = asyncio.Event()
    task = asyncio.create_task(runtime.run_forever(stop))
    for _ in range(200):
        if runtime.stats.succeeded:
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, timeout=5)

    assert 'worker_register' in gateway.names()
    assert 'worker_release_leases' in gateway.names()
    assert gateway.names()[-1] == 'worker_heartbeat'
    assert gateway.calls[-1]['payload']['p_status'] == 'offline'


async def test_a_worker_without_a_service_credential_refuses_to_claim() -> None:
    runtime, _ = runtime_with({}, supabase_service_role_key=None)
    with pytest.raises(AppError) as error:
        await runtime.claim()
    assert error.value.code == 'WORKER_NOT_CONFIGURED'


# ------------------------------------------------------------------ outbox

async def test_the_outbox_is_claimed_and_every_event_is_marked_with_its_outcome() -> None:
    runtime, gateway = runtime_with({}, {'outbox_claim': {'claimed': [
        {'event_id': 'ev-1', 'event_type': 'publication.authorized', 'job_id': JOB},
        {'event_id': 'ev-2', 'event_type': 'export.requested', 'job_id': None}]}})

    delivered = await runtime.deliver_outbox()

    assert delivered == 2
    assert runtime.stats.outbox_delivered == 2
    assert gateway.names() == ['outbox_claim', 'outbox_deliver', 'outbox_deliver']
    assert gateway.payload_for('outbox_deliver')['p_worker'] == 'test-worker'


# ------------------------------------------------------------------ settings validation

def test_configuration_rejects_a_worker_that_could_not_be_trusted() -> None:
    base = dict(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', app_env='test', worker_enabled=True)
    Settings(**base)  # defaults are valid
    for broken in ({'worker_class': 'rendering'}, {'worker_lease_seconds': 5},
        {'worker_heartbeat_seconds': 900}, {'worker_batch_limit': 40},
        {'worker_poll_seconds': 10.0, 'worker_idle_seconds': 1.0},
        {'outbox_batch_limit': 0}, {'worker_job_timeout_seconds': 5}):
        with pytest.raises(ValueError):
            Settings(**base, **broken)


def _recording_handler(outcome: JobOutcome) -> Any:
    async def handler(_: dict[str, Any]) -> JobOutcome:
        return outcome
    return handler
