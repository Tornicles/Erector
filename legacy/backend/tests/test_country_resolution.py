"""
Tests — Country Resolution (Prompt A2)
Verifies the economy resolution service against known country → economy mappings.
"""
import pytest

RESOLUTION_CASES = [
    # (input, expected_primary_economy_type)
    ("United States", "consumer_capitalist"),
    ("US", "consumer_capitalist"),
    ("USA", "consumer_capitalist"),
    ("Germany", "welfare_industrial"),
    ("DE", "welfare_industrial"),
    ("DEU", "welfare_industrial"),
    ("India", "rapid_urbanization"),
    ("IN", "rapid_urbanization"),
    ("Singapore", "financial_mega_city"),
    ("SG", "financial_mega_city"),
    ("Japan", "manufacturing_excellence"),
    ("JP", "manufacturing_excellence"),
    ("Saudi Arabia", "oil_wealth"),
    ("SA", "oil_wealth"),
    ("South Korea", "export_technology"),
    ("KR", "export_technology"),
    ("Vietnam", "manufacturing_expansion"),
    ("VN", "manufacturing_expansion"),
    ("Nigeria", "rapid_urbanization"),
    ("NG", "rapid_urbanization"),
]

NEGATIVE_CASES = [
    "FakeCountryXYZ",
    "Narnia",
    "ZZZ",  # invalid ISO code
]


@pytest.mark.parametrize("country_input,expected_type", RESOLUTION_CASES)
def test_resolution_by_name(client, country_input, expected_type):
    """Countries resolve to correct primary economy via name or ISO code."""
    resp = client.get(f"/api/v1/economies/resolve/{country_input}")
    assert resp.status_code == 200, f"{country_input}: HTTP {resp.status_code}"
    data = resp.json()
    assert data["success"], f"{country_input}: success=False"
    actual = data["data"]["primary_economy"]["economy_type"]
    assert actual == expected_type, (
        f"{country_input!r}: expected {expected_type!r}, got {actual!r}"
    )


def test_resolution_returns_confidence(client):
    """Resolved economies must include confidence score 0-1."""
    resp = client.get("/api/v1/economies/resolve/Germany")
    assert resp.status_code == 200
    result = resp.json()["data"]
    assert 0.0 <= result["confidence"] <= 1.0


def test_resolution_returns_reasoning(client):
    """Resolved economies must include non-empty reasoning string."""
    resp = client.get("/api/v1/economies/resolve/India")
    assert resp.status_code == 200
    result = resp.json()["data"]
    assert result["reasoning"], "reasoning must be non-empty"


@pytest.mark.parametrize("fake", NEGATIVE_CASES)
def test_resolution_404_unknown_country(client, fake):
    """Unknown countries must return 404."""
    resp = client.get(f"/api/v1/economies/resolve/{fake}")
    assert resp.status_code == 404, f"{fake!r}: expected 404, got {resp.status_code}"


def test_resolution_secondary_economies(client):
    """Countries with secondaries must return them in secondary_economies list."""
    # Norway has secondary: oil_wealth
    resp = client.get("/api/v1/economies/resolve/NO")
    assert resp.status_code == 200
    result = resp.json()["data"]
    secondary_types = [e["economy_type"] for e in result["secondary_economies"]]
    assert "oil_wealth" in secondary_types, f"Norway: expected oil_wealth secondary, got {secondary_types}"


def test_resolution_aliases(client):
    """Country aliases must resolve correctly."""
    for alias in ["USA", "America"]:
        resp = client.get(f"/api/v1/economies/resolve/{alias}")
        assert resp.status_code == 200, f"{alias!r}: HTTP {resp.status_code}"
        assert resp.json()["data"]["primary_economy"]["economy_type"] == "consumer_capitalist"
