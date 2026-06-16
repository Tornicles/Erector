"""
test_config.py — Settings configuration contract tests.

Tests:
1. Settings load without errors
2. Effective MongoDB URI is set
3. Effective DB name is set
4. JWT algorithm is HS256
5. Mock auth is enabled in development (no Supabase keys)
6. cors_origins_list returns a list
7. is_development returns True for default env
"""

import pytest


def test_settings_load():
    from app.core.config import get_settings
    settings = get_settings()
    assert settings is not None


def test_effective_mongodb_uri(client):
    from app.core.config import get_settings
    settings = get_settings()
    uri = settings.effective_mongodb_uri
    assert uri.startswith("mongodb://"), f"Unexpected URI: {uri}"


def test_effective_db_name():
    from app.core.config import get_settings
    settings = get_settings()
    db_name = settings.effective_db_name
    assert db_name and len(db_name) > 0


def test_jwt_algorithm():
    from app.core.config import get_settings
    settings = get_settings()
    assert settings.jwt_algorithm == "HS256"


def test_mock_auth_enabled_without_supabase():
    from app.core.config import get_settings
    settings = get_settings()
    # No Supabase keys set → mock auth must be on
    if not settings.supabase_url:
        assert settings.mock_auth_enabled is True


def test_cors_origins_list_is_list():
    from app.core.config import get_settings
    settings = get_settings()
    origins = settings.cors_origins_list
    assert isinstance(origins, list)
    assert len(origins) > 0


def test_is_development_by_default():
    from app.core.config import get_settings
    settings = get_settings()
    # APP_ENV defaults to "development"
    assert settings.is_development or settings.app_env in ("development", "dev", "test")


def test_jwt_secret_available():
    from app.core.config import get_settings
    settings = get_settings()
    # Should not raise in dev mode
    secret = settings.effective_jwt_secret
    assert len(secret) > 0


def test_app_name_set():
    from app.core.config import get_settings
    settings = get_settings()
    assert settings.app_name


def test_app_version_set():
    from app.core.config import get_settings
    settings = get_settings()
    assert settings.app_version
