"""Prompt 10 provider adapter boundary (§20, §29, §63).

An adapter is the only thing in TONDE allowed to speak to an external provider. It is a small,
explicit interface with no hidden state, so the trusted server (and only the trusted server) can:

* decide whether a provider can be exercised at all;
* build an authorization URL and exchange a code, or refuse because this deployment is unconfigured;
* submit a publication and report the destination's own answer;
* ask what a destination currently shows for a remote resource;
* revoke an authorization.

Two things this boundary deliberately cannot do:

* it cannot invent a successful call. An unavailable provider, a missing credential and a timeout are
  all distinct, named outcomes;
* it cannot be reached from a browser. Routes call adapters server-side, and the database records the
  outcome through a service-role RPC.

`adapter_state` in the provider registry is the deployment's declaration of reality: `absent` means
no adapter exists, `implemented` means an adapter exists but was never exercised against the real
provider, `verified` means a real call succeeded. Only a `verified` provider can produce a CONNECTED
connection, because the database guard says so.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from app.core.config import Settings
from app.core.errors import AppError
from app.domain.commercial import NormalizedFailure, classify_provider_failure

# The capability keys migration 031/032 evaluate. Named once so routes and adapters cannot drift.
PUBLISH_CAPABILITY = 'publish'
VERIFY_CAPABILITY = 'verify'


class ProviderUnavailable(AppError):
    """The provider (or its adapter) cannot be exercised here. Nothing was attempted."""

    def __init__(self, message: str, code: str = 'PROVIDER_NOT_IMPLEMENTED') -> None:
        super().__init__(code, 'unavailable', message, 503)


class ProviderCallFailed(AppError):
    """The provider was called and answered with a failure. The category is normalized."""

    def __init__(self, category: NormalizedFailure, message: str, *, status_code: int = 502,
        provider_code: str = '') -> None:
        super().__init__('PROVIDER_CALL_FAILED', 'provider', message, status_code)
        self.category = category
        self.provider_code = provider_code


class ProviderTimeout(AppError):
    """The provider did not answer inside the bounded window. This is NOT a failure of the action."""

    def __init__(self, message: str) -> None:
        super().__init__('PROVIDER_TIMEOUT', 'provider', message, 504)
        self.category: NormalizedFailure = 'provider_unavailable'


@dataclass
class Verification:
    """What a provider said about a connection. No field is required to be optimistic."""

    verified: bool
    account_label: str = ''
    external_account_id: str = ''
    scopes: list[str] = field(default_factory=list)
    detail: str = ''


@dataclass
class Authorization:
    """Where a creator would be sent to authorize, and why that could not be produced."""

    authorize_url: str | None
    unconfigured: list[str] = field(default_factory=list)
    note: str = ''


@dataclass
class PublicationRequest:
    """Exactly what would go out. The fingerprint is what a retry must reproduce."""

    media_id: str
    media_checksum: str
    media_type: str
    title: str
    caption: str
    visibility: str
    destination: str
    settings: dict[str, Any]
    idempotency_key: str
    operation_id: str
    request_fingerprint: str


@dataclass
class PublicationOutcome:
    """A destination's own answer, translated into TONDE's outcome vocabulary."""

    outcome: str  # accepted | processing | succeeded | failed | unknown
    remote_resource_type: str = ''
    remote_resource_id: str | None = None
    remote_url: str | None = None
    remote_state: str = ''
    failure_category: NormalizedFailure | None = None
    failure_code: str = ''
    failure_message: str = ''
    detail: str = ''


@runtime_checkable
class IntegrationAdapter(Protocol):
    """The provider-facing interface. Every method is bounded and side-effect-honest."""

    key: str
    categories: tuple[str, ...]

    def configured(self) -> bool:
        """Whether this deployment has everything the adapter needs to attempt a real call."""

    def unconfigured_reasons(self) -> list[str]:
        """Named dependencies this deployment is missing, for a truthful report."""

    def authorize_url(self, *, workspace_id: str, user_id: str, state: str, redirect_uri: str,
        scopes: list[str]) -> Authorization: ...

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> Verification: ...

    async def verify(self, *, credential_reference: str, scopes: list[str]) -> Verification: ...

    async def revoke(self, *, credential_reference: str) -> bool: ...

    async def submit(self, request: PublicationRequest) -> PublicationOutcome: ...

    async def remote_state(self, *, remote_resource_id: str) -> PublicationOutcome: ...


class UnconfiguredAdapter:
    """The truthful adapter for a provider this deployment cannot reach.

    It implements the whole interface and refuses every call with the named dependency it is missing.
    A route that consults it reports `unconfigured` rather than a failure, because nothing was
    attempted. This is the adapter a provider gets until its real credentials exist.
    """

    categories: tuple[str, ...] = ('social_publishing',)

    def __init__(self, key: str, reasons: list[str] | None = None) -> None:
        self.key = key
        self._reasons = reasons or ['provider_credentials']

    def configured(self) -> bool:
        return False

    def unconfigured_reasons(self) -> list[str]:
        return list(self._reasons)

    def _refuse(self, action: str) -> ProviderUnavailable:
        return ProviderUnavailable(
            f'{action} needs credentials this deployment has not configured '
            f'({", ".join(self._reasons)}); nothing was attempted.', 'PROVIDER_UNCONFIGURED')

    def authorize_url(self, *, workspace_id: str, user_id: str, state: str, redirect_uri: str,
        scopes: list[str]) -> Authorization:
        return Authorization(None, self.unconfigured_reasons(),
            f'The authorization URL cannot be produced: {", ".join(self._reasons)}.')

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> Verification:
        raise self._refuse('Exchanging an authorization code')

    async def verify(self, *, credential_reference: str, scopes: list[str]) -> Verification:
        raise self._refuse('Verifying a connection')

    async def revoke(self, *, credential_reference: str) -> bool:
        raise self._refuse('Revoking an authorization')

    async def submit(self, request: PublicationRequest) -> PublicationOutcome:
        raise self._refuse('Submitting a publication')

    async def remote_state(self, *, remote_resource_id: str) -> PublicationOutcome:
        raise self._refuse('Reading the destination state')


class DeterministicTestAdapter:
    """A controlled adapter that obeys the same interface and failure taxonomy.

    It is a **test adapter**, not a provider: it makes no network call and it is only registered when
    the deployment is not production. Its purpose is to exercise the full path — verified provider,
    authorization, submission, remote confirmation, reconciliation — without any external credential,
    so the internal implementation can be proven while the real provider credentials are deferred.
    """

    categories: tuple[str, ...] = ('social_publishing',)

    def __init__(self, key: str, *, behavior: dict[str, Any] | None = None) -> None:
        self.key = key
        self.behavior = behavior or {}

    def configured(self) -> bool:
        return True

    def unconfigured_reasons(self) -> list[str]:
        return []

    def authorize_url(self, *, workspace_id: str, user_id: str, state: str, redirect_uri: str,
        scopes: list[str]) -> Authorization:
        joined = ' '.join(scopes)
        return Authorization(f'https://test-adapter.invalid/authorize?state={state}&redirect_uri={redirect_uri}&scope={joined}',
            [], 'This authorization URL belongs to the controlled test adapter, not to a real provider.')

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> Verification:
        return Verification(verified=True, account_label=self.behavior.get('account_label', 'Test destination account'),
            external_account_id=self.behavior.get('external_account_id', 'test-account'),
            scopes=list(self.behavior.get('granted_scopes') or []))

    async def verify(self, *, credential_reference: str, scopes: list[str]) -> Verification:
        return Verification(verified=True, account_label=self.behavior.get('account_label', 'Test destination account'),
            external_account_id=self.behavior.get('external_account_id', 'test-account'),
            scopes=list(self.behavior.get('granted_scopes') or scopes))

    async def revoke(self, *, credential_reference: str) -> bool:
        return True

    async def submit(self, request: PublicationRequest) -> PublicationOutcome:
        if self.behavior.get('timeout'):
            raise ProviderTimeout('The destination did not answer inside the bounded window.')
        if self.behavior.get('ambiguous'):
            return PublicationOutcome(outcome='unknown', detail='The destination answer could not be interpreted.')
        if self.behavior.get('fail'):
            status_code = int(self.behavior.get('status_code', 503))
            category = classify_provider_failure(status_code, self.behavior.get('error_code'))
            raise ProviderCallFailed(category, 'The destination reported a failure.', status_code=502,
                provider_code=str(self.behavior.get('error_code', '')))
        remote_id = f'test-{request.operation_id}'
        return PublicationOutcome(outcome='succeeded', remote_resource_type=self.behavior.get('resource_type', 'post'),
            remote_resource_id=remote_id, remote_url=f'https://test-adapter.invalid/p/{remote_id}',
            remote_state='published')

    async def remote_state(self, *, remote_resource_id: str) -> PublicationOutcome:
        if self.behavior.get('removed'):
            return PublicationOutcome(outcome='unknown', remote_resource_id=remote_resource_id, remote_state='removed')
        return PublicationOutcome(outcome='succeeded', remote_resource_id=remote_resource_id, remote_state='published')


class AdapterRegistry:
    """Which provider keys this deployment can actually exercise.

    A provider with no registered adapter is reported as not implemented. Registering an adapter is a
    deployment decision, and it never changes what the database says about `adapter_state`: a provider
    whose adapter has never been exercised against the real provider stays `implemented`, so a
    connection cannot become CONNECTED on the strength of code alone.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._adapters: dict[str, IntegrationAdapter] = {}

    def register(self, adapter: IntegrationAdapter) -> None:
        self._adapters[adapter.key] = adapter

    def get(self, provider_key: str) -> IntegrationAdapter:
        adapter = self._adapters.get(provider_key)
        if adapter is None:
            return UnconfiguredAdapter(provider_key)
        return adapter

    def keys(self) -> list[str]:
        return sorted(self._adapters)

    def describe(self, provider_key: str) -> dict[str, Any]:
        adapter = self.get(provider_key)
        return {'provider': provider_key, 'adapter_present': provider_key in self._adapters,
            'configured': adapter.configured(), 'unconfigured_dependencies': adapter.unconfigured_reasons(),
            'network_calls': isinstance(adapter, DeterministicTestAdapter) is False and provider_key in self._adapters}


def build_adapter_registry(settings: Settings) -> AdapterRegistry:
    """Compose the adapters this deployment really has.

    In production only real adapters are registered, so an unconfigured provider is reported as
    unconfigured. Outside production the controlled test adapter is registered for the provider key
    `test_publisher`, which exists in no production catalog and makes no network call.
    """

    registry = AdapterRegistry(settings)
    if settings.app_env != 'production':
        registry.register(DeterministicTestAdapter('test_publisher'))
    # Providers the deployment knows about but cannot reach are registered as explicitly unconfigured
    # rather than omitted, so a route reports the missing dependency by name.
    for provider, reasons in (
        ('youtube', ['provider_credentials']),
        ('instagram', ['provider_credentials']),
    ):
        registry.register(UnconfiguredAdapter(provider, reasons))
    return registry


async def with_timeout(coroutine: Any, settings: Settings, *, action: str) -> Any:
    """Bound every provider call. A timeout is reported as a timeout, never as a failure."""

    seconds = min(max(settings.provider_timeout_seconds, 1), settings.provider_max_timeout_seconds)
    try:
        return await asyncio.wait_for(coroutine, timeout=seconds)
    except asyncio.TimeoutError as exc:
        raise ProviderTimeout(f'{action} did not complete within {seconds:.0f} seconds.') from exc
