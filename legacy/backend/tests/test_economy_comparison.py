"""
Tests — Economy Comparison Service (Prompt A2)
POST /api/v1/economies/compare
"""
import pytest


class TestEconomyComparison:
    def test_comparison_returns_valid_structure(self, client):
        payload = {
            "goal_summary": "SaaS B2B product",
            "industry": "SaaS",
            "business_model": "subscription",
            "target_customer": "SMBs",
            "economies_to_compare": ["eco_consumer_capitalist", "eco_rapid_urbanization"],
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert "ranked_results" in data
        assert "best_fit_economy_id" in data
        assert "worst_fit_economy_id" in data
        assert "comparison_notes" in data

    def test_fit_scores_0_to_100(self, client):
        payload = {
            "goal_summary": "test",
            "industry": "tech",
            "business_model": "saas",
            "target_customer": "enterprises",
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        for result in resp.json()["data"]["ranked_results"]:
            score = result["fit_score"]
            assert 0 <= score <= 100, f"{result['economy_id']}: fit_score {score} out of range"

    def test_difficulty_multiplier_range(self, client):
        payload = {
            "goal_summary": "test",
            "industry": "fintech",
            "business_model": "marketplace",
            "target_customer": "consumers",
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        for result in resp.json()["data"]["ranked_results"]:
            dm = result["difficulty_multiplier"]
            assert 0.5 <= dm <= 1.5, f"{result['economy_id']}: difficulty_multiplier {dm} out of range"

    def test_high_trust_economies_score_higher_trust_fit(self, client):
        """Welfare industrial should score higher trust_fit than civil war economy."""
        payload = {
            "goal_summary": "test trust",
            "industry": "fintech",
            "business_model": "subscription",
            "target_customer": "consumers",
            "economies_to_compare": ["eco_welfare_industrial", "eco_civil_war"],
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        results = {r["economy_id"]: r for r in resp.json()["data"]["ranked_results"]}
        welfare_trust = results["eco_welfare_industrial"]["dimension_scores"]["trust_fit"]
        civil_war_trust = results["eco_civil_war"]["dimension_scores"]["trust_fit"]
        assert welfare_trust > civil_war_trust

    def test_consumer_capitalist_ranks_top_for_saas(self, client):
        """Consumer capitalist should rank highly for SaaS subscription businesses."""
        payload = {
            "goal_summary": "SaaS subscription product",
            "industry": "SaaS",
            "business_model": "subscription",
            "target_customer": "businesses",
            "economies_to_compare": [
                "eco_consumer_capitalist", "eco_civil_war", "eco_militia_controlled",
                "eco_post_collapse"
            ],
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        best = resp.json()["data"]["best_fit_economy_id"]
        assert best == "eco_consumer_capitalist", f"Expected consumer_capitalist as best, got {best}"

    def test_comparison_notes_nonempty(self, client):
        payload = {
            "goal_summary": "test notes",
            "industry": "retail",
            "business_model": "ecommerce",
            "target_customer": "general consumers",
            "economies_to_compare": ["eco_welfare_industrial"],
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        notes = resp.json()["data"]["comparison_notes"]
        assert notes and len(notes) > 10

    def test_each_result_has_advantages_and_risks(self, client):
        payload = {
            "goal_summary": "test",
            "industry": "tech",
            "business_model": "saas",
            "target_customer": "SMBs",
            "economies_to_compare": ["eco_consumer_capitalist", "eco_aid_dependent"],
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        for result in resp.json()["data"]["ranked_results"]:
            assert isinstance(result["advantages"], list)
            assert isinstance(result["major_risks"], list)
            assert isinstance(result["major_opportunities"], list)
