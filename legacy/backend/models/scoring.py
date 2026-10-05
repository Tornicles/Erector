"""
Scoring schemas — ValidationScore, ScoreRationale, BlockerFlag.
All 27 deterministic scores. Bhudhi CANNOT write these.
Collection: validation_scores
"""

from __future__ import annotations
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id


def score_field(**kwargs) -> float:
    return Field(ge=0.0, le=10.0, default=0.0, **kwargs)


class ScoreRationale(BaseSchema):
    """Human-readable rationale for a single score."""
    score_name: str
    score_value: float = Field(ge=0.0, le=10.0)
    one_sentence_reason: str
    primary_drivers: list[str] = Field(default_factory=list)
    penalties: list[str] = Field(default_factory=list)
    blockers_applied: list[str] = Field(default_factory=list)


class BlockerFlag(BaseSchema):
    """A condition that can block or heavily penalize a validation score."""
    blocker_id: str = Field(default_factory=new_id)
    condition: str
    triggered: bool = False
    severity: str  # low | medium | high | critical
    affected_scores: list[str] = Field(default_factory=list)
    verdict_effect: Optional[str] = None
    explanation: str


class ValidationScore(OwnedDocument):
    """
    All 27 deterministic scores for a validation run.
    Deterministic — computed by the scoring engine ONLY.
    Bhudhi must NEVER write any score field.
    Collection: validation_scores
    """
    score_id: str = Field(default_factory=new_id)
    validation_id: str
    version: int = 1

    # Core scores (27 total)
    reality_score: float = score_field()
    validation_confidence_score: float = score_field()
    market_score: float = score_field()
    customer_pain_score: float = score_field()
    execution_score: float = score_field()
    timing_score: float = score_field()
    competition_score: float = score_field()
    scalability_score: float = score_field()
    local_economy_score: float = score_field()
    resource_score: float = score_field()
    risk_score: float = score_field()
    trust_score: float = score_field()
    momentum_score: float = score_field()
    evidence_score: float = score_field()
    assumption_risk_score: float = score_field()
    dependency_risk_score: float = score_field()
    institutional_risk_score: float = score_field()
    narrative_risk_score: float = score_field()
    bias_risk_score: float = score_field()
    learning_score: float = score_field()
    commitment_score: float = score_field()
    systemic_risk_score: float = score_field()
    counterfactual_score: float = score_field()
    survivor_pattern_score: float = score_field()
    integrity_score: float = score_field()
    future_alignment_score: float = score_field()
    reliability_score: float = score_field()

    # Meta
    blocker_flags: list[BlockerFlag] = Field(default_factory=list)
    score_rationales: list[ScoreRationale] = Field(default_factory=list)
    score_inputs_snapshot: Optional[dict] = None
    scoring_formula_version: str = "1.0"
    recalculation_reason: Optional[str] = None

    def all_scores_present(self) -> bool:
        """Verify all 27 scores are populated."""
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
        return len(score_fields) == 27
