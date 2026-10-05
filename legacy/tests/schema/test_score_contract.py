"""
Test Gate 6: ValidationScore — all 27 scores present and validated 0–10.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))

import pytest


def _make_score(**overrides):
    from models.scoring import ValidationScore
    defaults = dict(
        validation_id="val-001",
        owner_user_id="user-001",
        version=1,
        reality_score=7.5,
        validation_confidence_score=8.0,
        market_score=6.5,
        customer_pain_score=7.0,
        execution_score=6.0,
        timing_score=7.5,
        competition_score=5.5,
        scalability_score=8.0,
        local_economy_score=6.0,
        resource_score=5.0,
        risk_score=4.5,
        trust_score=7.0,
        momentum_score=6.5,
        evidence_score=5.0,
        assumption_risk_score=4.0,
        dependency_risk_score=3.5,
        institutional_risk_score=4.0,
        narrative_risk_score=3.0,
        bias_risk_score=4.5,
        learning_score=7.0,
        commitment_score=8.0,
        systemic_risk_score=4.0,
        counterfactual_score=6.0,
        survivor_pattern_score=5.5,
        integrity_score=7.5,
        future_alignment_score=7.0,
        reliability_score=6.5,
    )
    defaults.update(overrides)
    return ValidationScore(**defaults)


def test_all_27_scores_present():
    score = _make_score()
    score_fields = [
        "reality_score", "validation_confidence_score", "market_score",
        "customer_pain_score", "execution_score", "timing_score",
        "competition_score", "scalability_score", "local_economy_score",
        "resource_score", "risk_score", "trust_score", "momentum_score",
        "evidence_score", "assumption_risk_score", "dependency_risk_score",
        "institutional_risk_score", "narrative_risk_score", "bias_risk_score",
        "learning_score", "commitment_score", "systemic_risk_score",
        "counterfactual_score", "survivor_pattern_score", "integrity_score",
        "future_alignment_score", "reliability_score",
    ]
    assert len(score_fields) == 27
    for field in score_fields:
        assert hasattr(score, field), f"Missing score field: {field}"
        val = getattr(score, field)
        assert val is not None, f"Score field {field} is None"
        assert 0.0 <= val <= 10.0, f"Score {field}={val} out of range [0,10]"


def test_score_out_of_range_raises():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        _make_score(reality_score=11.0)


def test_score_negative_raises():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        _make_score(market_score=-1.0)


def test_blocker_flag():
    from models.scoring import BlockerFlag
    flag = BlockerFlag(
        condition="No evidence for customer pain",
        triggered=True,
        severity="critical",
        affected_scores=["customer_pain_score", "evidence_score"],
        explanation="No direct customer interviews conducted.",
    )
    assert flag.triggered is True
    assert "customer_pain_score" in flag.affected_scores


def test_score_rationale():
    from models.scoring import ScoreRationale
    rationale = ScoreRationale(
        score_name="market_score",
        score_value=6.5,
        one_sentence_reason="Market shows moderate demand with high fragmentation.",
        primary_drivers=["large TAM", "growing segment"],
        penalties=["high competition"],
        blockers_applied=[],
    )
    assert rationale.score_value == 6.5


def test_all_scores_present_method():
    score = _make_score()
    assert score.all_scores_present() is True
