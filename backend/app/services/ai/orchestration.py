from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
from collections.abc import Callable
from enum import StrEnum
from typing import Any, TypeVar
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.errors import AppError
from app.services.ai.provider import (
    DirectorModelProvider,
    GenerationRequest,
    GenerationResult,
    ProviderFailed,
    ProviderMalformedOutput,
    ProviderUnavailable,
)

logger = logging.getLogger('tonde.ai')

SCHEMA_VERSION = 'tonde.director.1'
T = TypeVar('T', bound=BaseModel)


class OperationScope(StrEnum):
    production = 'production'
    brief = 'brief'
    reference = 'reference'
    story = 'story'
    script = 'script'
    dialogue = 'dialogue'
    scene = 'scene'
    reality = 'reality'


class OperationEnvelope(BaseModel):
    """Every Director operation carries this contract. Nothing is applied without it."""

    model_config = ConfigDict(extra='forbid')
    operation_id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    production_id: UUID
    scope_object_id: UUID
    scope: OperationScope = OperationScope.production
    operation_type: str = Field(min_length=1, max_length=80)
    schema_version: str = Field(default=SCHEMA_VERSION, max_length=40)
    source_revision: int = Field(ge=1)
    source_intake_revision: int | None = Field(default=None, ge=1)
    collaboration_mode: str = Field(default='stop_at_major_decisions', max_length=40)
    model_profile: str = Field(default='default', max_length=120)
    reference_ids: list[UUID] = Field(default_factory=list, max_length=12)
    constraints: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(default='', max_length=200)
    producer_requested: str = Field(default='auto', max_length=20)

    def with_idempotency_key(self, extra: dict[str, Any] | None = None) -> 'OperationEnvelope':
        if self.idempotency_key:
            return self
        payload = json.dumps(extra or {}, sort_keys=True, default=str)[:4000]
        digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()[:24]
        key = f'{self.operation_type}:{self.production_id}:{self.source_revision}:{self.source_intake_revision}:{digest}'
        return self.model_copy(update={'idempotency_key': key})


class OperationOutcome(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation_id: UUID
    operation_type: str
    scope: OperationScope
    status: str = Field(default='succeeded', pattern=r'^(succeeded|failed|unavailable)$')
    producer: str = Field(default='deterministic', pattern=r'^(deterministic|model)$')
    provider: str = Field(default='deterministic', max_length=80)
    model: str = Field(default='deterministic-domain', max_length=120)
    attempts: int = Field(default=1, ge=1, le=10)
    repaired: bool = False
    schema_version: str = SCHEMA_VERSION
    source_revision: int = Field(ge=1)
    idempotency_key: str = Field(default='', max_length=200)
    rationale: str = Field(default='', max_length=1200)
    limitations: list[str] = Field(default_factory=list, max_length=12)
    payload: dict[str, Any] = Field(default_factory=dict)

    @property
    def used_model(self) -> bool:
        return self.producer == 'model'


def revision_guard(current_revision: int, expected_revision: int) -> None:
    if current_revision != expected_revision:
        raise AppError(
            'DIRECTOR_REVISION_CONFLICT', 'conflict',
            'This Production changed while TONDE was working. Reload and retry so nothing is applied to a stale version.',
            409,
        )


def validate_output(model_cls: type[T], value: Any) -> T:
    try:
        return model_cls.model_validate(value)
    except ValidationError as exc:
        problems = '; '.join(f'{".".join(str(part) for part in error["loc"])}: {error["msg"]}' for error in exc.errors()[:4])
        raise ProviderMalformedOutput(f'Structured output failed schema validation ({problems}).') from exc


async def _call_with_transport_retry(
    provider: DirectorModelProvider, request: GenerationRequest, *, attempts: int = 3,
) -> GenerationResult:
    if not 1 <= attempts <= 3:
        raise ValueError('Transport retry limit must be between one and three.')
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return await provider.generate(request)
        except ProviderMalformedOutput:
            raise
        except ProviderFailed as exc:
            last = exc
            if not exc.retryable or attempt + 1 == attempts:
                break
            logger.warning('director_provider_retry', extra={'context': {'operation': request.operation, 'attempt': attempt + 1}})
            await asyncio.sleep((0.2 * (2 ** attempt)) + random.uniform(0, 0.1))
        except ProviderUnavailable as exc:
            raise ProviderUnavailable(str(exc)) from exc
    raise ProviderFailed(str(last) if last else 'The AI provider failed.', retryable=True)


async def generate_validated(
    provider: DirectorModelProvider,
    request: GenerationRequest,
    model_cls: type[T],
    *,
    max_repair_attempts: int = 1,
) -> tuple[T, GenerationResult]:
    """MODEL → PARSE → SCHEMA VALIDATE with bounded structured repair. Malformed data is never inserted."""

    if not 0 <= max_repair_attempts <= 2:
        raise ValueError('Bounded schema repair allows at most two repair attempts.')
    feedback = ''
    last_problem = ''
    for repair_attempt in range(max_repair_attempts + 1):
        attempt_request = request.model_copy(update={'repair_attempt': repair_attempt, 'repair_feedback': feedback})
        result = await _call_with_transport_retry(provider, attempt_request)
        try:
            validated = validate_output(model_cls, result.output)
        except ProviderMalformedOutput as exc:
            last_problem = str(exc)
            if repair_attempt == max_repair_attempts:
                break
            feedback = last_problem
            logger.warning('director_schema_repair', extra={'context': {'operation': request.operation, 'repair_attempt': repair_attempt + 1}})
            continue
        if hasattr(validated, 'producer'):
            validated = validated.model_copy(update={'producer': 'model'})
        return validated, result
    raise AppError(
        'DIRECTOR_OUTPUT_INVALID', 'provider',
        'Director returned structured output that could not be validated, so nothing was applied. Retry, or continue with the deterministic draft.',
        502,
    )


async def run_operation(
    provider: DirectorModelProvider,
    envelope: OperationEnvelope,
    request: GenerationRequest,
    model_cls: type[T],
    *,
    max_repair_attempts: int = 1,
    deterministic: Callable[[], T] | None = None,
    deterministic_rationale: str = '',
    require_model: bool = False,
) -> OperationOutcome:
    """Run one Director operation. Deterministic domain logic is an explicit, labelled producer."""

    keyed = envelope.with_idempotency_key({'operation_type': envelope.operation_type, 'scope': envelope.scope.value})
    request = request.model_copy(update={'idempotency_key': keyed.idempotency_key})
    capabilities = provider.capabilities()
    if not capabilities.configured or capabilities.provider == 'unconfigured':
        if deterministic is not None:
            payload = deterministic()
            return OperationOutcome(
                operation_id=keyed.operation_id, operation_type=keyed.operation_type, scope=keyed.scope,
                status='succeeded', producer='deterministic', provider='deterministic-domain', model='tonde-domain-engine',
                source_revision=keyed.source_revision, idempotency_key=keyed.idempotency_key,
                rationale=deterministic_rationale,
                limitations=['No AI provider is configured, so this result comes from TONDE deterministic domain logic, not from a model.'],
                payload=payload.model_dump(mode='json'),
            )
        if require_model:
            raise AppError(
                'DIRECTOR_PROVIDER_UNAVAILABLE', 'provider',
                'AI analysis is not configured in this deployment. Your saved work is unchanged and manual editing stays available.',
                503,
            )
    try:
        validated, result = await generate_validated(provider, request, model_cls, max_repair_attempts=max_repair_attempts)
    except ProviderUnavailable as exc:
        if deterministic is not None:
            payload = deterministic()
            return OperationOutcome(
                operation_id=keyed.operation_id, operation_type=keyed.operation_type, scope=keyed.scope,
                status='succeeded', producer='deterministic', provider='deterministic-domain', model='tonde-domain-engine',
                source_revision=keyed.source_revision, idempotency_key=keyed.idempotency_key,
                rationale=deterministic_rationale,
                limitations=[f'The configured provider was unavailable ({exc}); this result is deterministic domain logic.'],
                payload=payload.model_dump(mode='json'),
            )
        raise AppError(
            'DIRECTOR_PROVIDER_UNAVAILABLE', 'provider',
            'AI analysis is not configured in this deployment. Your saved work is unchanged and manual editing stays available.',
            503,
        ) from exc
    except ProviderFailed as exc:
        logger.warning('director_provider_failed', extra={'context': {'operation': keyed.operation_type}})
        # The provider names its own failure (bad key, unknown model, rate limit,
        # timeout); surfacing that reason tells the creator which setting to fix
        # instead of one opaque message for five different problems.
        reason = str(exc) or 'The AI provider could not complete this operation.'
        raise AppError(
            'DIRECTOR_PROVIDER_FAILED', 'provider',
            f'{reason} No Production content was changed; retry or continue manually.',
            503,
        ) from exc
    return OperationOutcome(
        operation_id=keyed.operation_id, operation_type=keyed.operation_type, scope=keyed.scope,
        status='succeeded', producer='model', provider=result.provider, model=result.model,
        attempts=result.attempts, repaired=result.repaired, source_revision=keyed.source_revision,
        idempotency_key=keyed.idempotency_key, payload=validated.model_dump(mode='json'),
    )


def json_schema(model_cls: type[BaseModel]) -> dict[str, Any]:
    """Provider-facing JSON schema. Additional properties stay forbidden so malformed output is repaired, not merged."""

    schema = model_cls.model_json_schema()
    schema['additionalProperties'] = False
    return schema
