"""
Economy Models — Prompt A2
Full A2 economy model layer. Imports CivilizationDnaProfile from Prompt 0.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import Field, field_validator, model_validator

from models.economy import CivilizationDnaProfile  # re-use Prompt 0 base
from models.base import new_id
from app.models.enums import (
    EconomyType,
    EconomicStackLayerType,
    EconomyComparisonDimension,
    CivilizationDnaDimension,
)

try:
    from pydantic import BaseModel
except ImportError:
    from pydantic.v1 import BaseModel  # type: ignore


# ── Pattern object ────────────────────────────────────────────────────────────

class EconomyPattern(BaseModel):
    """Structured economy pattern with metadata for engine integration."""
    name: str
    description: str
    severity_or_strength: str = "medium"   # low | medium | high | critical
    examples: list[str] = Field(default_factory=list)
    affected_engines: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


# ── Full Economy document ─────────────────────────────────────────────────────

class Economy(BaseModel):
    """
    Full economy document stored in the `economies` collection.
    This is the A2 version (richer than Prompt 0 stub).
    """
    economy_id: str
    economy_type: EconomyType
    name: str
    display_name: str
    short_description: str
    long_description: str
    core_characteristic: str
    example_countries: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)
    civilization_dna: CivilizationDnaProfile
    resistance_patterns: list[EconomyPattern] = Field(default_factory=list)
    opportunity_patterns: list[EconomyPattern] = Field(default_factory=list)
    trust_mechanisms: list[EconomyPattern] = Field(default_factory=list)
    payment_patterns: list[EconomyPattern] = Field(default_factory=list)
    institutional_patterns: list[EconomyPattern] = Field(default_factory=list)
    narrative_patterns: list[EconomyPattern] = Field(default_factory=list)
    platform_patterns: list[EconomyPattern] = Field(default_factory=list)
    regulatory_patterns: list[EconomyPattern] = Field(default_factory=list)
    customer_behavior_patterns: list[EconomyPattern] = Field(default_factory=list)
    business_model_fit: dict[str, Any] = Field(default_factory=dict)
    common_failure_modes: list[EconomyPattern] = Field(default_factory=list)
    common_success_patterns: list[EconomyPattern] = Field(default_factory=list)
    recommended_entry_strategies: list[EconomyPattern] = Field(default_factory=list)
    source_notes: Optional[str] = None
    schema_version: str = "A2"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_validator("resistance_patterns", "opportunity_patterns", mode="before")
    @classmethod
    def at_least_three(cls, v: list) -> list:
        return v  # validation enforced in seeder, not here

    def dna_average(self) -> float:
        dna = self.civilization_dna
        vals = [
            dna.trust_index, dna.authority_index, dna.corruption_index,
            dna.innovation_index, dna.digital_adoption_index, dna.education_index,
            dna.social_mobility_index, dna.bureaucracy_index, dna.stability_index,
            dna.information_freedom_index, dna.risk_tolerance_index,
            dna.community_dependence_index, dna.crime_pressure_index,
            dna.payment_reliability_index, dna.infrastructure_reliability_index,
            dna.institutional_strength_index, dna.media_volatility_index,
            dna.legal_predictability_index, dna.labor_reliability_index,
            dna.crisis_exposure_index, dna.adoption_friction_index,
            dna.social_proof_dependence_index, dna.reputation_fragility_index,
            dna.informal_network_strength_index, dna.future_change_velocity_index,
        ]
        return round(sum(vals) / len(vals), 1)


# ── Country Mapping ───────────────────────────────────────────────────────────

class CountryEconomyMapping(BaseModel):
    """Maps a country to its primary and secondary economy types."""
    mapping_id: str = Field(default_factory=new_id)
    country_name: str
    country_code: str                           # ISO alpha-2
    country_code_alpha3: Optional[str] = None   # ISO alpha-3
    aliases: list[str] = Field(default_factory=list)
    primary_economy_id: str
    primary_economy_type: EconomyType
    secondary_economy_ids: list[str] = Field(default_factory=list)
    secondary_economy_types: list[EconomyType] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.85)
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ── Summary / Detail ──────────────────────────────────────────────────────────

class EconomySummary(BaseModel):
    """Lightweight economy card for list views."""
    economy_id: str
    economy_type: EconomyType
    display_name: str
    short_description: str
    core_characteristic: str
    example_countries: list[str]
    top_dna_signals: dict[str, int]    # top 5 most distinctive dimensions
    primary_resistance_patterns: list[str]
    primary_opportunity_patterns: list[str]
    dna_average: float


class EconomyDetail(BaseModel):
    """Full economy profile for detail views."""
    economy: Economy
    dna_average: float
    top_dna_signals: dict[str, int]
    country_mappings: list[CountryEconomyMapping] = Field(default_factory=list)
    recommended_use_cases: list[str] = Field(default_factory=list)


# ── Resolution ────────────────────────────────────────────────────────────────

class EconomyResolveResponse(BaseModel):
    country_name: str
    country_code: str
    primary_economy: EconomySummary
    secondary_economies: list[EconomySummary] = Field(default_factory=list)
    confidence: float
    reasoning: str


# ── Comparison ────────────────────────────────────────────────────────────────

class EconomyCompareRequest(BaseModel):
    goal_summary: str
    industry: str
    business_model: str
    target_customer: str
    economies_to_compare: list[str] = Field(default_factory=list)
    founder_country: Optional[str] = None
    customer_country: Optional[str] = None
    revenue_model: Optional[str] = None
    platform: Optional[str] = None
    budget_range: Optional[str] = None


class EconomyComparisonResult(BaseModel):
    economy_id: str
    economy_type: EconomyType
    display_name: str
    fit_score: float               # 0-100
    dimension_scores: dict[str, float]   # EconomyComparisonDimension → score
    advantages: list[str]
    disadvantages: list[str]
    major_risks: list[str]
    major_opportunities: list[str]
    recommended_entry_strategy: str
    difficulty_multiplier: float


class EconomyCompareResponse(BaseModel):
    goal_summary: str
    ranked_results: list[EconomyComparisonResult]
    best_fit_economy_id: str
    worst_fit_economy_id: str
    comparison_notes: str


# ── Economic Stack ────────────────────────────────────────────────────────────

class EconomicStackBuildRequest(BaseModel):
    validation_id: Optional[str] = None
    founder_country: str = Field(..., min_length=1)
    customer_country: str = Field(..., min_length=1)
    revenue_country: Optional[str] = None
    platform: Optional[str] = None
    revenue_model: Optional[str] = None
    team_locations: list[str] = Field(default_factory=list)
    regulatory_country: Optional[str] = None
    industry: Optional[str] = None
    business_model: Optional[str] = None
    target_customer: Optional[str] = None


class DifficultyMultipliers(BaseModel):
    """
    Deterministic difficulty multipliers derived from Civilization DNA.
    All bounded 0.75–1.75 (higher = harder).
    """
    execution_difficulty: float = Field(ge=0.5, le=2.0)
    trust_difficulty: float = Field(ge=0.5, le=2.0)
    payment_difficulty: float = Field(ge=0.5, le=2.0)
    infrastructure_difficulty: float = Field(ge=0.5, le=2.0)
    regulatory_difficulty: float = Field(ge=0.5, le=2.0)
    narrative_volatility: float = Field(ge=0.5, le=2.0)
    adoption_friction: float = Field(ge=0.5, le=2.0)
    crisis_exposure: float = Field(ge=0.5, le=2.0)
    talent_reliability: float = Field(ge=0.5, le=2.0)

    @property
    def composite(self) -> float:
        vals = [
            self.execution_difficulty, self.trust_difficulty, self.payment_difficulty,
            self.infrastructure_difficulty, self.regulatory_difficulty,
            self.narrative_volatility, self.adoption_friction,
            self.crisis_exposure, self.talent_reliability,
        ]
        return round(sum(vals) / len(vals), 3)


class EconomicStackLayer(BaseModel):
    """One resolved layer of the multi-economy stack."""
    layer_type: EconomicStackLayerType
    economy_id: str
    economy_type: EconomyType
    country: Optional[str] = None
    country_code: Optional[str] = None
    layer_reason: str
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    dna_snapshot: Optional[CivilizationDnaProfile] = None
    difficulty_multiplier: float = Field(ge=0.1, le=5.0, default=1.0)
    notes: Optional[str] = None


class EconomicStack(BaseModel):
    """
    The resolved six-layer economic stack for a validation.
    Stored in `economic_stacks` collection.
    """
    stack_id: str = Field(default_factory=new_id)
    validation_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    founder_economy: Optional[EconomicStackLayer] = None
    customer_economy: Optional[EconomicStackLayer] = None
    revenue_economy: Optional[EconomicStackLayer] = None
    platform_economy: Optional[EconomicStackLayer] = None
    talent_economy: Optional[EconomicStackLayer] = None
    regulatory_economy: Optional[EconomicStackLayer] = None
    primary_economy: Optional[EconomicStackLayer] = None
    secondary_economies: list[EconomicStackLayer] = Field(default_factory=list)
    stack_confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    difficulty_multipliers: Optional[DifficultyMultipliers] = None
    resolved_from: Optional[dict] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
