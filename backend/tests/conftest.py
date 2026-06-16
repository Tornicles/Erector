"""
Pytest fixtures shared across all A1 tests.
Uses FastAPI's TestClient so lifespan is executed (connects to MongoDB).
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    """Synchronous ASGI test client with full app lifespan."""
    from app.main import app
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
