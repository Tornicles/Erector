"""
World Library schemas — OrganizationWorldEntity, HumanWorldPersona.
Global reference collections — no owner_user_id.
Collections: organization_world_entities, human_world_personas
"""

from __future__ import annotations
from typing import Optional
from pydantic import Field
from .base import BaseSchema, new_id
from .enums import EconomyType, OrganizationLeadershipStyle


class BehaviorPattern(BaseSchema):
    context: str
    reaction: str
    probability: float = Field(ge=0.0, le=1.0)


class TrustProfile(BaseSchema):
    baseline_trust: float = Field(ge=0.0, le=10.0)
    trust_drivers: list[str] = Field(default_factory=list)
    distrust_triggers: list[str] = Field(default_factory=list)
    recovery_time_days: Optional[int] = None


class InfluenceNetwork(BaseSchema):
    connectors: list[str] = Field(default_factory=list)
    gatekeepers: list[str] = Field(default_factory=list)
    influencers: list[str] = Field(default_factory=list)
    community_nodes: list[str] = Field(default_factory=list)


class OrganizationWorldEntity(BaseSchema):
    """
    Archetype organization actor for simulations.
    Global reference — no owner_user_id required.
    Collection: organization_world_entities
    """
    organization_id: str = Field(default_factory=new_id)
    economy_id: str
    organization_type: str
    name: str
    mission: Optional[str] = None
    leadership_style: Optional[OrganizationLeadershipStyle] = None
    culture: Optional[str] = None
    bureaucracy_level: float = Field(ge=0.0, le=10.0, default=5.0)
    corruption_exposure: float = Field(ge=0.0, le=10.0, default=3.0)
    market_position: Optional[str] = None
    reputation_score: float = Field(ge=0.0, le=10.0, default=5.0)
    execution_capacity: float = Field(ge=0.0, le=10.0, default=5.0)
    crisis_resilience: float = Field(ge=0.0, le=10.0, default=5.0)
    behavior_patterns: list[BehaviorPattern] = Field(default_factory=list)
    influence_network: Optional[InfluenceNetwork] = None


class PersonaEconomics(BaseSchema):
    income_range: Optional[str] = None
    debt_level: Optional[str] = None
    spending_patterns: list[str] = Field(default_factory=list)
    savings_rate: Optional[float] = None


class PersonaPsychology(BaseSchema):
    risk_appetite: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    trust_baseline: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    social_influence_susceptibility: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    loss_aversion: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    primary_motivation: Optional[str] = None


class HumanWorldPersona(BaseSchema):
    """
    Archetype human persona for simulations.
    Global reference — no owner_user_id required.
    Collection: human_world_personas
    """
    persona_id: str = Field(default_factory=new_id)
    economy_id: str
    persona_type: str
    name: str
    age: Optional[int] = None
    profession: Optional[str] = None
    income_range: Optional[str] = None
    debt_level: Optional[str] = None
    education: Optional[str] = None
    family_context: Optional[str] = None
    social_class: Optional[str] = None
    psychology: Optional[PersonaPsychology] = None
    economics: Optional[PersonaEconomics] = None
    behavior: list[BehaviorPattern] = Field(default_factory=list)
    trust_profile: Optional[TrustProfile] = None
    adoption_threshold: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    reaction_patterns: list[dict] = Field(default_factory=list)
    influence_network: Optional[InfluenceNetwork] = None
