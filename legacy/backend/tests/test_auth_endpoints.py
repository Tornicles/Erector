"""
Backend tests for auth endpoints (A1 scaffold).
Tests: magic-link, verify, refresh, logout, me, headers.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

TEST_EMAIL = "testuser_a1@erector-test.com"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ── Health ────────────────────────────────────────────────────────────────────

class TestHealth:
    """GET /api/health"""

    def test_health_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200, r.text

    def test_health_envelope_shape(self, session):
        data = session.get(f"{BASE_URL}/api/health").json()
        assert data["success"] is True
        assert "data" in data
        assert "errors" in data
        assert "metadata" in data

    def test_health_has_x_request_id_header(self, session):
        r = session.get(f"{BASE_URL}/api/health")
        assert "x-request-id" in r.headers or "X-Request-ID" in r.headers

    def test_health_has_x_process_time_header(self, session):
        r = session.get(f"{BASE_URL}/api/health")
        headers_lower = {k.lower(): v for k, v in r.headers.items()}
        assert "x-process-time-ms" in headers_lower


# ── Magic Link ────────────────────────────────────────────────────────────────

class TestMagicLink:
    """POST /api/v1/auth/magic-link"""

    def test_valid_email_returns_200(self, session):
        r = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        assert r.status_code == 200, r.text

    def test_mock_token_present_in_debug_mode(self, session):
        r = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        body = r.json()
        assert body["success"] is True
        mock_token = body["data"].get("mock_token")
        assert mock_token is not None and len(mock_token) > 0, "mock_token missing in debug mode"

    def test_headers_present_on_magic_link(self, session):
        r = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        headers_lower = {k.lower(): v for k, v in r.headers.items()}
        assert "x-request-id" in headers_lower
        assert "x-process-time-ms" in headers_lower


# ── Verify ────────────────────────────────────────────────────────────────────

class TestVerify:
    """GET /api/v1/auth/verify"""

    @pytest.fixture(scope="class")
    def mock_token(self, session):
        r = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        return r.json()["data"]["mock_token"]

    def test_valid_token_returns_200(self, session, mock_token):
        r = session.get(f"{BASE_URL}/api/v1/auth/verify", params={"token": mock_token})
        assert r.status_code == 200, r.text

    def test_valid_token_returns_access_and_refresh(self, session, mock_token):
        # Need a fresh token since verify consumes it
        r2 = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        fresh_token = r2.json()["data"]["mock_token"]
        body = session.get(f"{BASE_URL}/api/v1/auth/verify", params={"token": fresh_token}).json()
        assert body["success"] is True
        assert "access_token" in body["data"]
        assert "refresh_token" in body["data"]

    def test_invalid_token_returns_401(self, session):
        r = session.get(f"{BASE_URL}/api/v1/auth/verify", params={"token": "invalid_token_xyz"})
        assert r.status_code == 401, r.text

    def test_already_consumed_token_returns_401(self, session, mock_token):
        # mock_token was consumed in test_valid_token_returns_200 fixture
        r = session.get(f"{BASE_URL}/api/v1/auth/verify", params={"token": mock_token})
        assert r.status_code == 401, r.text


# ── Me ────────────────────────────────────────────────────────────────────────

class TestMe:
    """GET /api/v1/auth/me"""

    @pytest.fixture(scope="class")
    def access_token(self, session):
        r = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        mock_tok = r.json()["data"]["mock_token"]
        r2 = session.get(f"{BASE_URL}/api/v1/auth/verify", params={"token": mock_tok})
        return r2.json()["data"]["access_token"]

    def test_me_without_token_returns_401(self, session):
        s2 = requests.Session()
        r = s2.get(f"{BASE_URL}/api/v1/auth/me")
        assert r.status_code == 401, r.text

    def test_me_with_valid_token_returns_200(self, session, access_token):
        r = session.get(
            f"{BASE_URL}/api/v1/auth/me",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        assert r.status_code == 200, r.text

    def test_me_returns_user_profile(self, session, access_token):
        r = session.get(
            f"{BASE_URL}/api/v1/auth/me",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        body = r.json()
        assert body["success"] is True
        user = body["data"]
        assert "email" in user
        assert user["email"] == TEST_EMAIL


# ── Refresh ───────────────────────────────────────────────────────────────────

class TestRefresh:
    """POST /api/v1/auth/refresh"""

    @pytest.fixture(scope="class")
    def token_pair(self, session):
        r = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        mock_tok = r.json()["data"]["mock_token"]
        r2 = session.get(f"{BASE_URL}/api/v1/auth/verify", params={"token": mock_tok})
        return r2.json()["data"]

    def test_refresh_returns_200(self, session, token_pair):
        r = session.post(
            f"{BASE_URL}/api/v1/auth/refresh",
            json={"refresh_token": token_pair["refresh_token"]}
        )
        assert r.status_code == 200, r.text

    def test_refresh_returns_new_tokens(self, session, token_pair):
        # Use a fresh token pair
        r = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        mock_tok = r.json()["data"]["mock_token"]
        r2 = session.get(f"{BASE_URL}/api/v1/auth/verify", params={"token": mock_tok})
        fresh_pair = r2.json()["data"]

        r3 = session.post(
            f"{BASE_URL}/api/v1/auth/refresh",
            json={"refresh_token": fresh_pair["refresh_token"]}
        )
        body = r3.json()
        assert "access_token" in body["data"]
        assert "refresh_token" in body["data"]


# ── Logout ────────────────────────────────────────────────────────────────────

class TestLogout:
    """POST /api/v1/auth/logout → subsequent /me returns 401"""

    def test_logout_revokes_session(self, session):
        # Setup: fresh auth
        r = session.post(f"{BASE_URL}/api/v1/auth/magic-link", json={"email": TEST_EMAIL})
        mock_tok = r.json()["data"]["mock_token"]
        r2 = session.get(f"{BASE_URL}/api/v1/auth/verify", params={"token": mock_tok})
        pair = r2.json()["data"]
        access_token = pair["access_token"]

        auth_headers = {"Authorization": f"Bearer {access_token}"}

        # Logout
        r3 = session.post(
            f"{BASE_URL}/api/v1/auth/logout",
            json={},
            headers=auth_headers
        )
        assert r3.status_code == 200, r3.text

        # /me should now return 401
        r4 = session.get(f"{BASE_URL}/api/v1/auth/me", headers=auth_headers)
        assert r4.status_code == 401, f"Expected 401 after logout, got {r4.status_code}"


# ── Schema ────────────────────────────────────────────────────────────────────

class TestSchema:
    """GET /api/schema/collections"""

    def test_collections_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/schema/collections")
        assert r.status_code == 200, r.text

    def test_collections_returns_list(self, session):
        body = session.get(f"{BASE_URL}/api/schema/collections").json()
        assert body["success"] is True
        # data is a dict with "collections" list and "total" count
        data = body["data"]
        collections = data.get("collections") if isinstance(data, dict) else data
        assert isinstance(collections, list) and len(collections) > 0
