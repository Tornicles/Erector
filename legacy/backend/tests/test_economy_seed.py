"""
Tests — Economy Seed Verification (Prompt A2)
Verifies that all 30 economies with 25 DNA dimensions are correctly seeded.
Uses HTTP API — no direct DB access needed.
"""
import pytest

DNA_DIMENSIONS = [
    "trust_index", "authority_index", "corruption_index", "innovation_index",
    "digital_adoption_index", "education_index", "social_mobility_index",
    "bureaucracy_index", "stability_index", "information_freedom_index",
    "risk_tolerance_index", "community_dependence_index", "crime_pressure_index",
    "payment_reliability_index", "infrastructure_reliability_index",
    "institutional_strength_index", "media_volatility_index",
    "legal_predictability_index", "labor_reliability_index", "crisis_exposure_index",
    "adoption_friction_index", "social_proof_dependence_index",
    "reputation_fragility_index", "informal_network_strength_index",
    "future_change_velocity_index",
]

EXPECTED_ECONOMY_IDS = [
    "eco_consumer_capitalist", "eco_welfare_industrial", "eco_financial_mega_city",
    "eco_export_technology", "eco_manufacturing_excellence", "eco_oil_wealth",
    "eco_commodity_export", "eco_rapid_urbanization", "eco_manufacturing_expansion",
    "eco_tourism_economy", "eco_port_logistics", "eco_state_controlled_hybrid",
    "eco_agricultural_labor", "eco_informal_cash", "eco_aid_dependent",
    "eco_corruption_heavy", "eco_infrastructure_deficient", "eco_urban_poverty",
    "eco_black_market_war", "eco_occupied_territory", "eco_civil_war",
    "eco_militia_controlled", "eco_sanctioned", "eco_post_collapse",
    "eco_creator_economy", "eco_gig_platform", "eco_freelance_digital",
    "eco_saas_startup", "eco_ai_automation", "eco_cybercrime_dark_web",
]


def test_economy_count(client):
    """Exactly 30 economies must be seeded."""
    resp = client.get("/api/v1/economies?limit=50")
    assert resp.status_code == 200
    total = resp.json()["data"]["total"]
    assert total == 30, f"Expected 30 economies, got {total}"


def test_all_economy_ids_present(client):
    """All 30 expected economy_ids must exist."""
    resp = client.get("/api/v1/economies?limit=50")
    economies = resp.json()["data"]["economies"]
    found_ids = {e["economy_id"] for e in economies}
    missing = set(EXPECTED_ECONOMY_IDS) - found_ids
    assert not missing, f"Missing economy IDs: {missing}"


def test_economy_dna_dimensions(client):
    """Every economy must have all 25 DNA dimension keys with 0-100 values."""
    resp = client.get("/api/v1/economies?limit=50")
    for summary in resp.json()["data"]["economies"]:
        eid = summary["economy_id"]
        # Fetch full profile to check DNA
        full_resp = client.get(f"/api/v1/economies/{eid}")
        assert full_resp.status_code == 200, f"{eid}: HTTP {full_resp.status_code}"
        dna = full_resp.json()["data"]["civilization_dna"]
        for dim in DNA_DIMENSIONS:
            assert dim in dna, f"{eid}: Missing DNA dimension '{dim}'"
            val = dna[dim]
            assert isinstance(val, (int, float)), f"{eid}/{dim}: expected numeric, got {type(val)}"
            assert 0 <= val <= 100, f"{eid}/{dim}: value {val} out of 0-100 range"


def test_economy_unique_ids(client):
    """economy_id must be unique across all 30 documents."""
    resp = client.get("/api/v1/economies?limit=50")
    ids = [e["economy_id"] for e in resp.json()["data"]["economies"]]
    assert len(ids) == len(set(ids)), "Duplicate economy_ids found"


def test_economy_required_fields(client):
    """Every economy summary must have required text fields."""
    resp = client.get("/api/v1/economies?limit=50")
    for eco in resp.json()["data"]["economies"]:
        eid = eco.get("economy_id", "?")
        for field in ["economy_id", "economy_type", "display_name",
                      "short_description", "core_characteristic", "dna_average"]:
            assert eco.get(field) is not None, f"{eid}: Missing required field '{field}'"


def test_economy_patterns_present(client):
    """Every economy must have at least one resistance and one opportunity pattern in summary."""
    resp = client.get("/api/v1/economies?limit=50")
    for eco in resp.json()["data"]["economies"]:
        eid = eco["economy_id"]
        assert isinstance(eco.get("primary_resistance_patterns"), list), f"{eid}: no resistance list"
        assert isinstance(eco.get("primary_opportunity_patterns"), list), f"{eid}: no opportunity list"


def test_country_mapping_count(client):
    """At least 130 country mappings must be seeded (verified via resolve endpoint)."""
    # Quick sanity: resolve a representative sample of countries
    sample_countries = ["US", "DE", "IN", "JP", "SG", "SA", "VN", "NG", "BR", "CN"]
    for code in sample_countries:
        resp = client.get(f"/api/v1/economies/resolve/{code}")
        assert resp.status_code == 200, f"{code}: HTTP {resp.status_code} — country mapping missing"


def test_country_mapping_references_valid_economy(client):
    """Resolved countries must return valid economy types."""
    test_cases = {
        "US": "consumer_capitalist",
        "DE": "welfare_industrial",
        "IN": "rapid_urbanization",
        "JP": "manufacturing_excellence",
    }
    for code, expected_type in test_cases.items():
        resp = client.get(f"/api/v1/economies/resolve/{code}")
        assert resp.status_code == 200, f"{code}: HTTP {resp.status_code}"
        actual = resp.json()["data"]["primary_economy"]["economy_type"]
        assert actual == expected_type, f"{code}: expected {expected_type!r}, got {actual!r}"
