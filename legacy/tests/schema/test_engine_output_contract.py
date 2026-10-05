"""
Test Gate 5: EngineOutput contract — required fields present and validated.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))

import pytest


def _make_engine_output(**overrides):
    from models.engines import EngineOutput
    from models.enums import EngineName, EngineStatus
    defaults = dict(
        validation_id="val-001",
        owner_user_id="user-001",
        engine_name=EngineName.market_analysis,
        engine_number=4,
        status=EngineStatus.completed,
        score=7.5,
        confidence=0.82,
        findings=["Finding 1", "Finding 2"],
        risks=[],
        opportunities=[],
        assumptions_created=[],
        dependencies_created=[],
        recommendations=["Do X"],
        sources=[],
        economy_context={"economy_type": "saas_startup"},
        execution_time_ms=1200,
    )
    defaults.update(overrides)
    return EngineOutput(**defaults)


def test_engine_output_all_required_fields():
    out = _make_engine_output()
    assert out.engine_name is not None
    assert out.score is not None
    assert out.confidence is not None
    assert out.findings is not None
    assert out.risks is not None
    assert out.opportunities is not None
    assert out.assumptions_created is not None
    assert out.dependencies_created is not None
    assert out.recommendations is not None
    assert out.sources is not None
    assert out.economy_context is not None
    assert out.execution_time_ms is not None


def test_engine_output_score_range():
    out = _make_engine_output(score=10.0)
    assert 0.0 <= out.score <= 10.0


def test_engine_output_score_out_of_range():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        _make_engine_output(score=11.0)


def test_engine_output_confidence_range():
    out = _make_engine_output(confidence=1.0)
    assert 0.0 <= out.confidence <= 1.0


def test_engine_output_confidence_out_of_range():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        _make_engine_output(confidence=1.1)


def test_engine_number_range():
    out = _make_engine_output(engine_number=27)
    assert 1 <= out.engine_number <= 27


def test_engine_number_out_of_range():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        _make_engine_output(engine_number=28)


def test_all_27_engine_names_valid():
    from models.enums import EngineName
    from models.engines import EngineOutput
    from models.enums import EngineStatus
    for i, engine in enumerate(EngineName, start=1):
        out = EngineOutput(
            validation_id="val-001",
            owner_user_id="user-001",
            engine_name=engine,
            engine_number=i,
            status=EngineStatus.completed,
            score=5.0,
            confidence=0.7,
            findings=[],
            risks=[],
            opportunities=[],
            assumptions_created=[],
            dependencies_created=[],
            recommendations=[],
            sources=[],
            execution_time_ms=100,
        )
        assert out.engine_name == engine.value


def test_risk_fields():
    from models.engines import Risk
    from models.enums import RiskSeverity
    risk = Risk(
        name="Market rejection",
        category="market",
        severity=RiskSeverity.high,
        probability=0.4,
        impact=8.0,
        description="Customers may not want this product",
    )
    assert risk.probability == 0.4
    assert risk.impact == 8.0


def test_opportunity_fields():
    from models.engines import Opportunity
    opp = Opportunity(
        name="First mover advantage",
        category="market",
        size_score=8.0,
    )
    assert opp.size_score == 8.0
