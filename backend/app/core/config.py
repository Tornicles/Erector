"""
Erector Configuration Management
Pydantic Settings with support for both legacy (PROMPT 0) and new env var names.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ─────────────────────────────────────────────────────────────────
    app_name: str = Field(default="Erector API")
    app_version: str = Field(default="1.0.0")
    app_env: str = Field(default="development")
    api_prefix: str = Field(default="/api")
    api_version: str = Field(default="v1")
    debug: bool = Field(default=True)

    # ── Server ───────────────────────────────────────────────────────────────
    backend_host: str = Field(default="0.0.0.0")
    backend_port: int = Field(default=8001)   # Emergent platform uses 8001

    # ── MongoDB (support both legacy PROMPT 0 names and new names) ───────────
    mongo_url: Optional[str] = Field(default=None)            # legacy
    mongodb_uri: Optional[str] = Field(default=None)          # new
    db_name: Optional[str] = Field(default=None)              # legacy
    mongodb_database: Optional[str] = Field(default=None)     # new
    mongodb_connect_timeout_ms: int = Field(default=5000)
    mongodb_server_selection_timeout_ms: int = Field(default=5000)

    # ── JWT (support both legacy SECRET_KEY and new JWT_SECRET) ─────────────
    secret_key: Optional[str] = Field(default=None)           # legacy
    jwt_secret: Optional[str] = Field(default=None)           # new
    jwt_algorithm: str = Field(default="HS256")
    jwt_access_token_expire_minutes: int = Field(default=60)
    jwt_refresh_token_expire_days: int = Field(default=30)

    # ── Supabase ─────────────────────────────────────────────────────────────
    supabase_url: Optional[str] = Field(default=None)
    supabase_anon_key: Optional[str] = Field(default=None)
    supabase_service_role_key: Optional[str] = Field(default=None)
    supabase_jwt_secret: Optional[str] = Field(default=None)

    # ── CORS ─────────────────────────────────────────────────────────────────
    cors_allowed_origins: str = Field(
        default="http://localhost:3000,http://localhost:5173,http://localhost:19006"
    )
    cors_allowed_methods: str = Field(default="GET,POST,PUT,PATCH,DELETE,OPTIONS")
    cors_allowed_headers: str = Field(default="Authorization,Content-Type,X-Request-ID")

    # ── Logging ──────────────────────────────────────────────────────────────
    log_level: str = Field(default="INFO")
    enable_openapi: bool = Field(default=True)

    # ── Features ─────────────────────────────────────────────────────────────
    rate_limit_enabled: bool = Field(default=False)

    # ── External Services (placeholders for future prompts) ──────────────────
    anthropic_api_key: Optional[str] = Field(default=None)
    resend_api_key: Optional[str] = Field(default=None)
    torgima_api_base_url: Optional[str] = Field(default=None)

    # ── Derived Properties ───────────────────────────────────────────────────

    @property
    def effective_mongodb_uri(self) -> str:
        return self.mongodb_uri or self.mongo_url or "mongodb://localhost:27017"

    @property
    def effective_db_name(self) -> str:
        return self.mongodb_database or self.db_name or "erector_db"

    @property
    def effective_jwt_secret(self) -> str:
        secret = self.jwt_secret or self.secret_key
        if secret:
            return secret
        if self.debug or self.is_testing:
            return "dev-secret-please-change-in-production"
        raise ValueError(
            "JWT_SECRET or SECRET_KEY must be set in non-development environments."
        )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]

    @property
    def is_development(self) -> bool:
        return self.app_env in ("development", "dev")

    @property
    def is_production(self) -> bool:
        return self.app_env in ("production", "prod")

    @property
    def is_testing(self) -> bool:
        return self.app_env in ("testing", "test")

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def mock_auth_enabled(self) -> bool:
        """True when Supabase is not configured OR debug mode is on."""
        return not self.supabase_configured or self.debug

    def __repr__(self) -> str:
        # Never expose secrets in repr
        return (
            f"Settings(app_name={self.app_name!r}, "
            f"app_env={self.app_env!r}, "
            f"debug={self.debug}, "
            f"mock_auth={self.mock_auth_enabled})"
        )


@lru_cache()
def get_settings() -> Settings:
    """Cached settings singleton. Call get_settings() everywhere."""
    return Settings()
