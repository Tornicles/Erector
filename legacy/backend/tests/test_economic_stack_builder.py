"""
Tests — Economic Stack Builder (Prompt A2)
POST /api/v1/stack/build
"""
import pytest


class TestBuildEconomicStack:
    def test_basic_stack_build(self, client):
        """Minimum required fields produce a valid stack."""
        payload = {
            "founder_country": "United States",
            "customer_country": "India",
        }
        resp = client.post("/api/v1/stack/build", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True

    def test_stack_has_6_layers(self, client):
        """Stack must include all 6 layer fields (some may be None for optional)."""
        payload = {
            "founder_country": "Germany",
            "customer_country": "Nigeria",
            "revenue_country": "Germany",
            "regulatory_country": "Germany",
            "team_locations": ["Germany"],
        }
        resp = client.post("/api/v1/stack/build", json=payload)
        stack = resp.json()["data"]
        layer_keys = ["founder_economy", "customer_economy", "revenue_economy",
                      "platform_economy", "talent_economy", "regulatory_economy"]
        for key in layer_keys:
            assert key in stack, f"Missing layer key: {key}"

    def test_founder_economy_resolved(self, client):
        payload = {"founder_country": "Japan", "customer_country": "South Korea"}
        stack = client.post("/api/v1/stack/build", json=payload).json()["data"]
        assert stack["founder_economy"]["economy_type"] == "manufacturing_excellence"

    def test_customer_economy_resolved(self, client):
        payload = {"founder_country": "US", "customer_country": "Vietnam"}
        stack = client.post("/api/v1/stack/build", json=payload).json()["data"]
        assert stack["customer_economy"]["economy_type"] == "manufacturing_expansion"

    def test_difficulty_multipliers_present(self, client):
        payload = {"founder_country": "US", "customer_country": "US"}
        stack = client.post("/api/v1/stack/build", json=payload).json()["data"]
        mults = stack["difficulty_multipliers"]
        assert mults is not None
        expected_keys = ["execution_difficulty", "trust_difficulty", "payment_difficulty",
                         "infrastructure_difficulty", "regulatory_difficulty"]
        for key in expected_keys:
            assert key in mults, f"Missing multiplier: {key}"
            assert 0.5 <= mults[key] <= 1.5, f"{key}={mults[key]} out of range"

    def test_stack_confidence_in_range(self, client):
        payload = {"founder_country": "Singapore", "customer_country": "US"}
        stack = client.post("/api/v1/stack/build", json=payload).json()["data"]
        assert 0.0 <= stack["stack_confidence"] <= 1.0

    def test_stack_id_generated(self, client):
        payload = {"founder_country": "US", "customer_country": "US"}
        stack = client.post("/api/v1/stack/build", json=payload).json()["data"]
        assert stack["stack_id"], "stack_id must not be empty"

    def test_unique_stack_ids(self, client):
        """Two identical requests generate different stack_ids."""
        payload = {"founder_country": "US", "customer_country": "Germany"}
        stack1 = client.post("/api/v1/stack/build", json=payload).json()["data"]
        stack2 = client.post("/api/v1/stack/build", json=payload).json()["data"]
        assert stack1["stack_id"] != stack2["stack_id"]

    def test_resolved_from_recorded(self, client):
        payload = {
            "founder_country": "France",
            "customer_country": "Brazil",
            "revenue_country": "Brazil",
        }
        stack = client.post("/api/v1/stack/build", json=payload).json()["data"]
        rf = stack["resolved_from"]
        assert rf["founder_country"] == "France"
        assert rf["customer_country"] == "Brazil"

    def test_unknown_country_layer_is_none(self, client):
        payload = {
            "founder_country": "US",
            "customer_country": "FakeCountryThatDoesNotExist",
        }
        resp = client.post("/api/v1/stack/build", json=payload)
        assert resp.status_code == 200
        stack = resp.json()["data"]
        # customer_economy should be None since country cannot be resolved
        assert stack["customer_economy"] is None


class TestDifficultyMultiplierValues:
    """Verify that difficulty multipliers follow the DNA-formula invariants."""

    def test_high_trust_economy_lower_trust_difficulty(self, client):
        """High-trust economy (welfare_industrial) should have lower trust difficulty."""
        welfare = client.post("/api/v1/stack/build", json={
            "founder_country": "Sweden", "customer_country": "Sweden"
        }).json()["data"]["difficulty_multipliers"]["trust_difficulty"]

        civil_war = client.post("/api/v1/stack/build", json={
            "founder_country": "Yemen", "customer_country": "Yemen"
        }).json()["data"]["difficulty_multipliers"]["trust_difficulty"]

        assert welfare < civil_war, (
            f"Sweden trust_difficulty ({welfare}) should be < Yemen ({civil_war})"
        )
