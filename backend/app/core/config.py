from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.domain.jobs import WORKER_CLASSES


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    app_env: Literal['development', 'test', 'production'] = 'development'
    app_version: str = '0.1.0'
    supabase_url: str | None = None
    supabase_publishable_key: SecretStr | None = None
    supabase_service_role_key: SecretStr | None = None
    # Supabase Storage signed upload URLs have a fixed two-hour validity window. The server checks
    # the bucket configuration and never advertises a configurable TTL it cannot enforce.
    cors_allowed_origins: str = 'http://localhost:5173,http://127.0.0.1:5173'
    log_level: str = 'INFO'
    # Director model provider is configuration-driven; no model name is hardcoded in application logic.
    director_provider: str = 'unconfigured'
    director_base_url: str | None = None
    director_api_key: SecretStr | None = None
    director_model: str | None = None
    director_long_context_model: str | None = None
    director_transcription_model: str | None = None
    director_model_profile: str = 'default'
    director_timeout_seconds: float = 30
    director_max_timeout_seconds: float = 180
    director_max_repair_attempts: int = 1
    ffmpeg_path: str | None = None
    # Per-provider callback secrets, keyed by provider key. Only a provider with a configured
    # secret can have its completion callback applied; an unverified payload is never evidence.
    ai_callback_secrets: dict[str, SecretStr] = {}
    # Prompt 10 external adapters. Every setting here is optional: an unconfigured integration is
    # reported as unconfigured and its capability stays unavailable, never as a working provider.
    provider_timeout_seconds: float = 15
    provider_max_timeout_seconds: float = 60
    # Where a publishing provider should send the creator back. Empty means the deployment has not
    # told TONDE a callback address, so an OAuth initiation reports that instead of inventing one.
    integration_redirect_uri_base: str = ''
    # Per-provider billing webhook signing secrets, keyed by provider key. A webhook without a
    # configured secret is refused outright: an unverified payload is never commercial evidence.
    billing_webhook_secrets: dict[str, SecretStr] = {}
    # The credential a trusted server presents for the server-to-server Prompt 10 seams (usage
    # ingestion and the durable commercial paths). Unset means those routes answer that this
    # deployment has not enabled server-to-server calls.
    tonde_server_token: SecretStr | None = None
    # Prompt 11 worker runtime. The worker is off unless a deployment enables it, because a worker
    # claims durable work and executes it - an accidental second worker is a real operational act.
    worker_enabled: bool = False
    worker_id: str = ''
    worker_class: str = 'media'
    worker_instance: str = ''
    worker_poll_seconds: float = 2.0
    worker_idle_seconds: float = 5.0
    worker_batch_limit: int = 1
    worker_lease_seconds: int = 300
    worker_heartbeat_seconds: int = 60
    worker_job_timeout_seconds: int = 1800
    worker_shutdown_grace_seconds: float = 20.0
    outbox_enabled: bool = True
    outbox_batch_limit: int = 10
    outbox_lease_seconds: int = 120

    @property
    def configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_publishable_key)

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(',') if origin.strip()]

    @model_validator(mode='after')
    def validate_platform_configuration(self) -> 'Settings':
        for origin in self.cors_origins_list:
            parsed = urlparse(origin)
            if origin == '*' or parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path not in ('', '/'):
                raise ValueError('CORS must contain explicit application origins.')
            if self.app_env == 'production' and parsed.scheme != 'https':
                raise ValueError('Production browser origins must use HTTPS.')
        if self.supabase_url:
            parsed = urlparse(self.supabase_url)
            local = parsed.hostname in ('localhost', '127.0.0.1')
            if parsed.scheme != 'https' and not (self.app_env != 'production' and local and parsed.scheme == 'http'):
                raise ValueError('Supabase requires HTTPS outside local development.')
        if self.app_env == 'production' and not self.configured:
            raise ValueError('Production requires Supabase configuration.')
        if self.director_base_url:
            endpoint = urlparse(self.director_base_url)
            local = endpoint.hostname in ('localhost', '127.0.0.1')
            if endpoint.scheme != 'https' and not (self.app_env != 'production' and local and endpoint.scheme == 'http'):
                raise ValueError('The AI provider endpoint requires HTTPS outside local development.')
        if not 0 <= self.director_max_repair_attempts <= 2:
            raise ValueError('Bounded schema repair allows at most two repair attempts.')
        if not 0 < self.director_timeout_seconds <= self.director_max_timeout_seconds:
            raise ValueError('The Director timeout must be positive and within the maximum timeout.')
        if not 0 < self.provider_timeout_seconds <= self.provider_max_timeout_seconds:
            raise ValueError('The provider timeout must be positive and within the maximum timeout.')
        if self.worker_class not in WORKER_CLASSES:
            raise ValueError('The worker class must be one of the durable worker classes.')
        if not 0 < self.worker_poll_seconds <= self.worker_idle_seconds:
            raise ValueError('The worker poll interval must be positive and no longer than its idle wait.')
        if not 1 <= self.worker_batch_limit <= 25:
            raise ValueError('A worker claims between 1 and 25 jobs at a time.')
        if not 30 <= self.worker_lease_seconds <= 3600:
            raise ValueError('A worker lease is between 30 seconds and one hour.')
        if not 30 <= self.worker_heartbeat_seconds < self.worker_lease_seconds:
            raise ValueError('A heartbeat must be at least 30 seconds and shorter than the lease it renews.')
        if not 30 <= self.worker_job_timeout_seconds <= 86400:
            raise ValueError('A job timeout is between 30 seconds and one day.')
        if self.worker_shutdown_grace_seconds < 0:
            raise ValueError('The shutdown grace period cannot be negative.')
        if not 1 <= self.outbox_batch_limit <= 100:
            raise ValueError('An outbox claim takes between 1 and 100 events.')
        if self.integration_redirect_uri_base:
            callback = urlparse(self.integration_redirect_uri_base)
            local = callback.hostname in ('localhost', '127.0.0.1')
            if callback.scheme not in ('http', 'https') or not callback.netloc:
                raise ValueError('The integration callback base must be an absolute URL.')
            if self.app_env == 'production' and callback.scheme != 'https':
                raise ValueError('Production integration callbacks must use HTTPS.')
            if callback.scheme != 'https' and not (self.app_env != 'production' and local and callback.scheme == 'http'):
                raise ValueError('The integration callback base requires HTTPS outside local development.')
        return self


@lru_cache

def get_settings() -> Settings:
    return Settings()
