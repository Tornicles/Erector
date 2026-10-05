"""
Pytest fixtures shared across all tests (A1 + A2).
Uses FastAPI's TestClient (sync) for HTTP tests.
Uses Motor directly for DB verification tests.
"""

import asyncio
import os

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorClient


@pytest.fixture(scope="module")
def client():
    """Synchronous ASGI test client with full app lifespan (seeds DB on startup)."""
    from app.main import app
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture(scope="module")
def event_loop():
    """Module-scoped event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="module")
async def db():
    """
    Direct Motor DB fixture for verifying seeded collections.
    Connects to the same MongoDB used by the app.
    """
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "erector_db")
    motor_client = AsyncIOMotorClient(mongo_url)
    database = motor_client[db_name]

    # Ensure economies are seeded for tests
    count = await database["economies"].count_documents({})
    if count == 0:
        from app.seeders.seed_economies import seed_economies
        from app.seeders.seed_country_mappings import seed_country_mappings
        await seed_economies(database)
        await seed_country_mappings(database)

    yield database
    motor_client.close()


VALIDATION_TEST_EMAIL = "validation_test@erector.dev"


@pytest.fixture
def auth_headers(client):
    """Obtain Bearer token via mock magic-link flow."""
    token = client.post(
        "/api/v1/auth/magic-link",
        json={"email": VALIDATION_TEST_EMAIL},
    ).json()["data"]["mock_token"]
    pair = client.get(f"/api/v1/auth/verify?token={token}").json()["data"]
    return {"Authorization": f"Bearer {pair['access_token']}"}


@pytest.fixture
def auth_headers_user2(client):
    """Second user for cross-access tests."""
    token = client.post(
        "/api/v1/auth/magic-link",
        json={"email": "validation_other@erector.dev"},
    ).json()["data"]["mock_token"]
    pair = client.get(f"/api/v1/auth/verify?token={token}").json()["data"]
    return {"Authorization": f"Bearer {pair['access_token']}"}


def make_validation_payload(**overrides):
    base = {
        "raw_goal": "I want to build a SaaS tool for small clinics",
        "industry": "software",
        "founder_country": "Germany",
        "customer_country": "United States",
        "success_definition": "Get 100 paying clinics within 12 months",
    }
    base.update(overrides)
    return base
