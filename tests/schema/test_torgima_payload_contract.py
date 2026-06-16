"""
Test Gate 7: TorgimaLaunchPayload contract validation.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))

import pytest
from datetime import datetime, timezone


def _make_payload(**overrides):
    from models.launch import TorgimaLaunchPayload
    defaults = dict(
        erector_validation_id="val-001",
        erector_version="1.0.0",
        launched_at=datetime.now(timezone.utc),
        user_email="founder@example.com",
        goal="Build a logistics SaaS for emerging markets",
        purpose="Reduce supply chain waste by 30%",
        reality_score=7.5,
        validation_confidence=0.82,
        verdict="proceed",
        economy_context={
            "primary_economy": "saas_startup",
            "customer_economy": "rapid_urbanization",
            "difficulty_multiplier": 1.4,
        },
        business_climate="stability",
        reality_framework={
            "framework_id": "fw-001",
            "programs": [],
            "goals": ["Launch MVP"],
        },
        assumptions=[
            {"assumption_id": "a1", "statement": "Customers will pay $50/month"},
            {"assumption_id": "a2", "statement": "Logistics companies lack digital tools"},
        ],
        dependencies=[
            {"dependency_id": "d1", "name": "Payment gateway integration"},
        ],
        risks=[
            {"risk_id": "r1", "name": "Market rejection", "severity": "medium"},
        ],
        team_structure={"departments": [], "hiring_sequence": []},
        launch_package={"launch_date": "2025-06-01", "markets": ["Nigeria"]},
    )
    defaults.update(overrides)
    return TorgimaLaunchPayload(**defaults)


def test_torgima_payload_all_required_fields():
    payload = _make_payload()
    assert payload.erector_validation_id is not None
    assert payload.user_email is not None
    assert payload.goal is not None
    assert payload.purpose is not None
    assert payload.reality_score is not None
    assert payload.validation_confidence is not None
    assert payload.verdict is not None
    assert payload.economy_context is not None
    assert payload.business_climate is not None
    assert payload.reality_framework is not None
    assert len(payload.assumptions) > 0
    assert len(payload.dependencies) > 0
    assert len(payload.risks) > 0
    assert payload.team_structure is not None
    assert payload.launch_package is not None


def test_reality_score_range():
    payload = _make_payload(reality_score=10.0)
    assert 0.0 <= payload.reality_score <= 10.0


def test_reality_score_out_of_range():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        _make_payload(reality_score=11.0)


def test_validation_confidence_range():
    payload = _make_payload(validation_confidence=1.0)
    assert 0.0 <= payload.validation_confidence <= 1.0


def test_launch_package_in_collection():
    from models.launch import LaunchPackage
    from models.enums import TorgimaStatus
    lp = LaunchPackage(
        validation_id="val-001",
        owner_user_id="user-001",
        torgima_status=TorgimaStatus.pending,
    )
    assert lp.launch_id is not None
    assert lp.torgima_status == "pending"


def test_assumptions_non_empty_required():
    """Assumptions list must have at least one entry."""
    payload = _make_payload()
    assert len(payload.assumptions) >= 1


def test_dependencies_non_empty_required():
    payload = _make_payload()
    assert len(payload.dependencies) >= 1


def test_risks_non_empty_required():
    payload = _make_payload()
    assert len(payload.risks) >= 1
