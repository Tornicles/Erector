from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    app_env: Literal['development', 'test', 'production'] = 'development'
    app_version: str = '0.1.0'
    supabase_url: str | None = None
    supabase_publishable_key: SecretStr | None = None
    supabase_service_role_key: SecretStr | None = None
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
        return self


@lru_cache

def get_settings() -> Settings:
    return Settings()
