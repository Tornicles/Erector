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

    # ── Validation Lifecycle (A3) ────────────────────────────────────────────
    validation_stuck_after_seconds: int = Field(default=300)
    validation_health_monitor_enabled: bool = Field(default=True)
    validation_health_monitor_interval_seconds: int = Field(default=60)
    event_max_retry_attempts: int = Field(default=3)
    event_retry_backoff_seconds: str = Field(default="30,120,600")
    idempotency_key_ttl_hours: int = Field(default=24)

    # ── Context Collection (A4) ──────────────────────────────────────────────
    context_max_answer_length: int = Field(default=5000)
    context_max_batch_size: int = Field(default=7)
    context_min_quality_score: float = Field(default=6.0)
    context_min_integrity_score: float = Field(default=6.0)
    context_required_categories: str = Field(default="basic,industry,economy,evidence,risk")
    context_allow_development_reset: bool = Field(default=True)
    preliminary_anti_gaming_enabled: bool = Field(default=True)
    preliminary_knowledge_gap_enabled: bool = Field(default=True)

    # ── External Services (placeholders for future prompts) ──────────────────
    anthropic_api_key: Optional[str] = Field(default=None)
    resend_api_key: Optional[str] = Field(default=None)
    torgima_api_base_url: Optional[str] = Field(default=None)

    # ── Bhudhi (A5) ──────────────────────────────────────────────────────────
    bhudhi_enabled: bool = Field(default=True)
    bhudhi_provider: str = Field(default="anthropic")
    bhudhi_model: str = Field(default="claude-3-5-sonnet-latest")
    bhudhi_timeout_seconds: int = Field(default=30)
    bhudhi_max_tokens_default: int = Field(default=1500)
    bhudhi_temperature_default: float = Field(default=0.2)
    bhudhi_allow_dev_fallback: bool = Field(default=True)
    bhudhi_store_raw_io: bool = Field(default=False)
    bhudhi_daily_token_budget: int = Field(default=200000)
    bhudhi_daily_cost_budget_usd: float = Field(default=50.0)
    bhudhi_per_user_daily_token_limit: int = Field(default=25000)
    bhudhi_per_validation_token_limit: int = Field(default=10000)
    bhudhi_rate_limit_per_minute: int = Field(default=20)
    bhudhi_prompt_injection_blocking: bool = Field(default=True)

    # ── WebSocket Live Feed (A6) ─────────────────────────────────────────────
    websocket_enabled: bool = Field(default=True)
    websocket_heartbeat_interval_seconds: int = Field(default=25)
    websocket_heartbeat_timeout_seconds: int = Field(default=60)
    websocket_max_connections_per_validation: int = Field(default=20)
    websocket_max_connections_per_user: int = Field(default=50)
    websocket_event_buffer_size: int = Field(default=100)
    websocket_replay_limit: int = Field(default=100)
    websocket_test_events_enabled: bool = Field(default=False)
    websocket_persist_live_events: bool = Field(default=True)
    websocket_cleanup_interval_seconds: int = Field(default=60)

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

    @property
    def event_retry_backoff_list(self) -> list[int]:
        return [int(s.strip()) for s in self.event_retry_backoff_seconds.split(",") if s.strip()]

    @property
    def context_required_categories_list(self) -> list[str]:
        return [c.strip() for c in self.context_required_categories.split(",") if c.strip()]

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
