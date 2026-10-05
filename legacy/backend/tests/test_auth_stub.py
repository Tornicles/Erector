"""
test_auth_stub.py — Magic link authentication flow tests (mock mode).

Tests:
1. POST /api/v1/auth/magic-link returns 200 with API envelope
2. Response includes mock_token in debug mode
3. GET /api/v1/auth/verify with valid token returns JWT pair
4. GET /api/v1/auth/verify with invalid token returns 401
5. GET /api/v1/auth/verify with same token twice returns 401 (consumed)
6. POST /api/v1/auth/refresh with valid refresh token works
7. GET /api/v1/auth/me without token returns 401
8. GET /api/v1/auth/me with valid token returns user profile
9. POST /api/v1/auth/logout revokes session
"""

import pytest

TEST_EMAIL = "scaffold_test@erector.dev"


class TestMagicLink:
    def test_magic_link_returns_200(self, client):
        resp = client.post(
            "/api/v1/auth/magic-link",
            json={"email": TEST_EMAIL},
        )
        assert resp.status_code == 200, resp.text

    def test_magic_link_envelope(self, client):
        resp = client.post(
            "/api/v1/auth/magic-link",
            json={"email": TEST_EMAIL},
        )
        body = resp.json()
        assert body["success"] is True
        assert body["data"] is not None
        assert body["errors"] is None

    def test_magic_link_mock_token_present(self, client):
        """In debug/mock mode, mock_token must be returned."""
        resp = client.post(
            "/api/v1/auth/magic-link",
            json={"email": TEST_EMAIL},
        )
        data = resp.json()["data"]
        assert data.get("mock_token"), "mock_token expected in debug mode"

    def test_magic_link_invalid_email(self, client):
        resp = client.post(
            "/api/v1/auth/magic-link",
            json={"email": "not-an-email"},
        )
        assert resp.status_code == 422


class TestVerify:
    def _get_mock_token(self, client) -> str:
        resp = client.post(
            "/api/v1/auth/magic-link",
            json={"email": TEST_EMAIL},
        )
        return resp.json()["data"]["mock_token"]

    def test_verify_returns_200(self, client):
        token = self._get_mock_token(client)
        resp = client.get(f"/api/v1/auth/verify?token={token}")
        assert resp.status_code == 200, resp.text

    def test_verify_returns_jwt_pair(self, client):
        token = self._get_mock_token(client)
        resp = client.get(f"/api/v1/auth/verify?token={token}")
        data = resp.json()["data"]
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "Bearer"
        assert data["expires_in"] > 0

    def test_verify_invalid_token(self, client):
        resp = client.get("/api/v1/auth/verify?token=invalid-token-xyz")
        assert resp.status_code in (400, 401)
        assert resp.json()["success"] is False

    def test_verify_consumed_token(self, client):
        """Using the same token twice must fail."""
        token = self._get_mock_token(client)
        client.get(f"/api/v1/auth/verify?token={token}")  # first use
        resp = client.get(f"/api/v1/auth/verify?token={token}")  # second use
        assert resp.status_code in (400, 401)

    def test_verify_missing_token_param(self, client):
        resp = client.get("/api/v1/auth/verify")
        assert resp.status_code == 422


class TestProtectedRoutes:
    def _auth_headers(self, client) -> dict:
        """Helper: get auth headers via full magic-link flow."""
        token = client.post(
            "/api/v1/auth/magic-link",
            json={"email": TEST_EMAIL},
        ).json()["data"]["mock_token"]
        access = client.get(
            f"/api/v1/auth/verify?token={token}"
        ).json()["data"]["access_token"]
        return {"Authorization": f"Bearer {access}"}

    def test_me_without_token_returns_401(self, client):
        resp = client.get("/api/v1/auth/me")
        assert resp.status_code == 401

    def test_me_with_token_returns_user(self, client):
        headers = self._auth_headers(client)
        resp = client.get("/api/v1/auth/me", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["email"] == TEST_EMAIL
        assert data["user_id"]

    def test_me_with_invalid_bearer(self, client):
        resp = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer totally.fake.token"},
        )
        assert resp.status_code in (400, 401)


class TestRefreshAndLogout:
    def _full_token_pair(self, client) -> dict:
        token = client.post(
            "/api/v1/auth/magic-link",
            json={"email": TEST_EMAIL},
        ).json()["data"]["mock_token"]
        return client.get(
            f"/api/v1/auth/verify?token={token}"
        ).json()["data"]

    def test_refresh_returns_new_tokens(self, client):
        pair = self._full_token_pair(client)
        resp = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": pair["refresh_token"]},
        )
        assert resp.status_code == 200, resp.text
        new_pair = resp.json()["data"]
        assert "access_token" in new_pair
        # New access token should differ from the old one
        assert new_pair["access_token"] != pair["access_token"]

    def test_refresh_with_invalid_token(self, client):
        resp = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": "not.a.valid.jwt"},
        )
        assert resp.status_code in (400, 401)

    def test_logout_revokes_session(self, client):
        pair = self._full_token_pair(client)
        headers = {"Authorization": f"Bearer {pair['access_token']}"}
        resp = client.post(
            "/api/v1/auth/logout",
            json={},
            headers=headers,
        )
        assert resp.status_code == 200
        # After logout, /me should fail
        resp2 = client.get("/api/v1/auth/me", headers=headers)
        assert resp2.status_code in (400, 401)
