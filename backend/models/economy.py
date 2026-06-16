"""
Economy schemas — Economy, CivilizationDnaProfile, CountryEconomyMapping, EconomyStackLayer, EconomicStack.
Collections: economies, country_economy_mappings, economic_stacks
Global reference collections: economies, country_economy_mappings (no owner_user_id required)
"""

from __future__ import annotations
from typing import Optional
from pydantic import Field, field_validator
from .base import BaseSchema, OwnedDocument, new_id
from .enums import EconomyType, CivilizationDnaDimension


class CivilizationDnaProfile(BaseSchema):
    """
    All 25 Civilization DNA dimensions — each integer 0-100.
    This is the core quantitative fingerprint of an economy type.
    """
    trust_index: int = Field(ge=0, le=100)
    authority_index: int = Field(ge=0, le=100)
    corruption_index: int = Field(ge=0, le=100)
    innovation_index: int = Field(ge=0, le=100)
    digital_adoption_index: int = Field(ge=0, le=100)
    education_index: int = Field(ge=0, le=100)
    social_mobility_index: int = Field(ge=0, le=100)
    bureaucracy_index: int = Field(ge=0, le=100)
    stability_index: int = Field(ge=0, le=100)
    information_freedom_index: int = Field(ge=0, le=100)
    risk_tolerance_index: int = Field(ge=0, le=100)
    community_dependence_index: int = Field(ge=0, le=100)
    crime_pressure_index: int = Field(ge=0, le=100)
    payment_reliability_index: int = Field(ge=0, le=100)
    infrastructure_reliability_index: int = Field(ge=0, le=100)
    institutional_strength_index: int = Field(ge=0, le=100)
    media_volatility_index: int = Field(ge=0, le=100)
    legal_predictability_index: int = Field(ge=0, le=100)
    labor_reliability_index: int = Field(ge=0, le=100)
    crisis_exposure_index: int = Field(ge=0, le=100)
    adoption_friction_index: int = Field(ge=0, le=100)
    social_proof_dependence_index: int = Field(ge=0, le=100)
    reputation_fragility_index: int = Field(ge=0, le=100)
    informal_network_strength_index: int = Field(ge=0, le=100)
    future_change_velocity_index: int = Field(ge=0, le=100)

    def all_dimensions_present(self) -> bool:
        return len(CivilizationDnaDimension) == 25  # must always be true


class Economy(BaseSchema):
    """
    Global reference collection — no owner_user_id.
    Defines an economy type with its full Civilization DNA profile.
    Collection: economies
    """
    economy_id: str = Field(default_factory=new_id)
    economy_type: EconomyType
    name: str
    display_name: str
    description: str
    core_characteristic: str
    example_countries: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)
    country_codes: list[str] = Field(default_factory=list)
    civilization_dna: CivilizationDnaProfile
    resistance_patterns: list[str] = Field(default_factory=list)
    opportunity_patterns: list[str] = Field(default_factory=list)
    trust_mechanisms: list[str] = Field(default_factory=list)
    payment_patterns: list[str] = Field(default_factory=list)
    institutional_patterns: list[str] = Field(default_factory=list)
    narrative_patterns: list[str] = Field(default_factory=list)
    platform_patterns: list[str] = Field(default_factory=list)
    regulatory_patterns: list[str] = Field(default_factory=list)
    source_notes: Optional[str] = None


class CountryEconomyMapping(BaseSchema):
    """
    Global reference — maps countries to economy types.
    Collection: country_economy_mappings
    """
    mapping_id: str = Field(default_factory=new_id)
    country_name: str
    country_code: str  # ISO-3166 alpha-2
    primary_economy_id: str
    secondary_economy_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    notes: Optional[str] = None


class EconomyStackLayer(BaseSchema):
    """One layer of the multi-economy stack for a validation."""
    economy_id: str
    economy_type: EconomyType
    country: Optional[str] = None
    country_code: Optional[str] = None
    layer_reason: str  # why this economy applies (founder, customer, revenue, etc.)
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    dna_snapshot: Optional[CivilizationDnaProfile] = None
    difficulty_multiplier: float = Field(default=1.0, ge=0.1, le=5.0)


class EconomicStack(OwnedDocument):
    """
    The resolved multi-economy stack for a validation run.
    Collection: economic_stacks
    """
    stack_id: str = Field(default_factory=new_id)
    validation_id: str
    founder_economy: Optional[EconomyStackLayer] = None
    customer_economy: Optional[EconomyStackLayer] = None
    revenue_economy: Optional[EconomyStackLayer] = None
    platform_economy: Optional[EconomyStackLayer] = None
    talent_economy: Optional[EconomyStackLayer] = None
    regulatory_economy: Optional[EconomyStackLayer] = None
    primary_economy: Optional[EconomyStackLayer] = None
    secondary_economies: list[EconomyStackLayer] = Field(default_factory=list)
    stack_confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    difficulty_multipliers: dict = Field(default_factory=dict)
    resolved_from: Optional[str] = None  # engine output id
