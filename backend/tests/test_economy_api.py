"""
Tests — Economy API Endpoints (Prompt A2)
GET  /api/v1/economies
GET  /api/v1/economies/{economy_id}
GET  /api/v1/economies/resolve/{country}
POST /api/v1/economies/compare
"""
import pytest


class TestListEconomies:
    def test_success(self, client):
        resp = client.get("/api/v1/economies")
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["total"] == 30

    def test_returns_economies_list(self, client):
        resp = client.get("/api/v1/economies?limit=5")
        body = resp.json()
        assert len(body["data"]["economies"]) == 5

    def test_pagination(self, client):
        first = client.get("/api/v1/economies?skip=0&limit=10").json()
        second = client.get("/api/v1/economies?skip=10&limit=10").json()
        ids_first = {e["economy_id"] for e in first["data"]["economies"]}
        ids_second = {e["economy_id"] for e in second["data"]["economies"]}
        assert ids_first.isdisjoint(ids_second), "Paginated pages overlap"

    def test_summary_structure(self, client):
        resp = client.get("/api/v1/economies?limit=1")
        eco = resp.json()["data"]["economies"][0]
        assert "economy_id" in eco
        assert "display_name" in eco
        assert "dna_average" in eco
        assert "top_dna_signals" in eco
        assert isinstance(eco["dna_average"], float)

    def test_api_envelope(self, client):
        resp = client.get("/api/v1/economies")
        body = resp.json()
        assert "success" in body
        assert "data" in body
        assert "errors" in body
        assert "metadata" in body


class TestGetEconomy:
    def test_known_economy(self, client):
        resp = client.get("/api/v1/economies/eco_consumer_capitalist")
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        eco = body["data"]
        assert eco["economy_id"] == "eco_consumer_capitalist"
        assert eco["economy_type"] == "consumer_capitalist"

    def test_dna_has_25_dimensions(self, client):
        resp = client.get("/api/v1/economies/eco_welfare_industrial")
        dna = resp.json()["data"]["civilization_dna"]
        dna_keys = {k for k in dna if k.endswith("_index")}
        assert len(dna_keys) == 25, f"Expected 25 DNA dim keys, got {len(dna_keys)}: {dna_keys}"

    def test_patterns_present(self, client):
        resp = client.get("/api/v1/economies/eco_financial_mega_city")
        eco = resp.json()["data"]
        assert len(eco["resistance_patterns"]) >= 1
        assert len(eco["opportunity_patterns"]) >= 1

    def test_unknown_economy_404(self, client):
        resp = client.get("/api/v1/economies/eco_does_not_exist")
        assert resp.status_code == 404

    def test_all_30_economies_retrievable(self, client):
        from tests.test_economy_seed import EXPECTED_ECONOMY_IDS
        for eid in EXPECTED_ECONOMY_IDS:
            resp = client.get(f"/api/v1/economies/{eid}")
            assert resp.status_code == 200, f"{eid}: HTTP {resp.status_code}"


class TestCompareEconomies:
    def test_compare_specific(self, client):
        payload = {
            "goal_summary": "SaaS product for B2B",
            "industry": "SaaS",
            "business_model": "subscription",
            "target_customer": "SMBs",
            "economies_to_compare": ["eco_consumer_capitalist", "eco_welfare_industrial"],
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert len(body["data"]["ranked_results"]) == 2

    def test_compare_all(self, client):
        payload = {
            "goal_summary": "Fintech app",
            "industry": "fintech",
            "business_model": "freemium",
            "target_customer": "consumers",
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["data"]["ranked_results"]) == 30

    def test_ranked_by_fit_score(self, client):
        payload = {
            "goal_summary": "B2B SaaS",
            "industry": "saas",
            "business_model": "subscription",
            "target_customer": "enterprise",
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        results = resp.json()["data"]["ranked_results"]
        scores = [r["fit_score"] for r in results]
        assert scores == sorted(scores, reverse=True), "Results not sorted by fit_score"

    def test_best_worst_fit_present(self, client):
        payload = {
            "goal_summary": "consumer app",
            "industry": "consumer",
            "business_model": "ads",
            "target_customer": "general consumers",
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        data = resp.json()["data"]
        assert data["best_fit_economy_id"]
        assert data["worst_fit_economy_id"]
        assert data["best_fit_economy_id"] != data["worst_fit_economy_id"]

    def test_dimension_scores_keys(self, client):
        payload = {
            "goal_summary": "test",
            "industry": "test",
            "business_model": "test",
            "target_customer": "test",
            "economies_to_compare": ["eco_consumer_capitalist"],
        }
        resp = client.post("/api/v1/economies/compare", json=payload)
        dim_scores = resp.json()["data"]["ranked_results"][0]["dimension_scores"]
        expected_dims = {"market_fit", "trust_fit", "payment_fit", "infrastructure_fit",
                         "regulatory_fit", "adoption_fit", "execution_fit", "narrative_fit",
                         "platform_fit", "talent_fit", "risk_fit", "opportunity_fit"}
        assert set(dim_scores.keys()) == expected_dims
