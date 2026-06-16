"""
Reality Framework schemas — RealityFramework, FrameworkProgram, FrameworkProject,
FrameworkOrder, IndividualLayers, TeamStructure.
Collection: reality_frameworks
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import ValidationStatus


class FrameworkOrder(BaseSchema):
    """A discrete execution order within a project."""
    order_id: str = Field(default_factory=new_id)
    project_id: str
    instruction: str
    purpose: str
    time_estimate: Optional[str] = None
    dependency_indicator: Optional[str] = None
    status: str = "pending"   # pending | in_progress | completed | blocked
    owner: Optional[str] = None
    due_date: Optional[datetime] = None


class FrameworkProject(BaseSchema):
    """A project within a program."""
    project_id: str = Field(default_factory=new_id)
    program_id: str
    name: str
    objective: str
    deliverables: list[str] = Field(default_factory=list)
    owner: Optional[str] = None
    contributors: list[str] = Field(default_factory=list)
    timeline: Optional[str] = None
    metrics: list[str] = Field(default_factory=list)
    risk_level: str = "medium"  # low | medium | high | critical
    dependencies: list[str] = Field(default_factory=list)
    orders: list[FrameworkOrder] = Field(default_factory=list)


class FrameworkProgram(BaseSchema):
    """A strategic program within the Reality Framework."""
    program_id: str = Field(default_factory=new_id)
    name: str
    purpose: str
    owner: Optional[str] = None
    projects: list[FrameworkProject] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)


class SkillsLayer(BaseSchema):
    current_skills: list[str] = Field(default_factory=list)
    skill_gaps: list[str] = Field(default_factory=list)
    learning_priority: list[str] = Field(default_factory=list)


class HabitsLayer(BaseSchema):
    productive_habits: list[str] = Field(default_factory=list)
    destructive_habits: list[str] = Field(default_factory=list)
    habit_changes_required: list[str] = Field(default_factory=list)


class CapacityLayer(BaseSchema):
    available_hours_per_week: Optional[float] = None
    peak_hours: Optional[str] = None
    capacity_constraints: list[str] = Field(default_factory=list)


class PersonalConstraintsLayer(BaseSchema):
    financial_runway_months: Optional[float] = None
    location_constraints: list[str] = Field(default_factory=list)
    time_constraints: list[str] = Field(default_factory=list)
    legal_constraints: list[str] = Field(default_factory=list)


class EnergyManagementLayer(BaseSchema):
    peak_energy_windows: list[str] = Field(default_factory=list)
    burnout_risk: str = "medium"
    recovery_protocols: list[str] = Field(default_factory=list)


class LearningPathLayer(BaseSchema):
    recommended_resources: list[str] = Field(default_factory=list)
    milestones: list[str] = Field(default_factory=list)
    estimated_days: Optional[int] = None


class IndividualLayers(BaseSchema):
    skills_layer: SkillsLayer = Field(default_factory=SkillsLayer)
    habits_layer: HabitsLayer = Field(default_factory=HabitsLayer)
    capacity_layer: CapacityLayer = Field(default_factory=CapacityLayer)
    personal_constraints_layer: PersonalConstraintsLayer = Field(
        default_factory=PersonalConstraintsLayer
    )
    energy_management_layer: EnergyManagementLayer = Field(
        default_factory=EnergyManagementLayer
    )
    learning_path_layer: LearningPathLayer = Field(default_factory=LearningPathLayer)


class Department(BaseSchema):
    department_id: str = Field(default_factory=new_id)
    name: str
    head_user_id: Optional[str] = None
    members: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)


class TeamStructure(BaseSchema):
    departments: list[Department] = Field(default_factory=list)
    governance: Optional[str] = None
    communication_rules: list[str] = Field(default_factory=list)
    escalation_structure: list[str] = Field(default_factory=list)
    hiring_sequence: list[str] = Field(default_factory=list)
    team_dependencies: list[str] = Field(default_factory=list)


class FrameworkMetric(BaseSchema):
    metric_id: str = Field(default_factory=new_id)
    name: str
    target: str
    current: Optional[str] = None
    frequency: str = "weekly"  # daily | weekly | monthly | quarterly


class DecisionRule(BaseSchema):
    rule_id: str = Field(default_factory=new_id)
    condition: str
    action: str
    priority: int = 1


class ReviewSystem(BaseSchema):
    frequency: str = "weekly"
    participants: list[str] = Field(default_factory=list)
    agenda: list[str] = Field(default_factory=list)
    decision_protocol: Optional[str] = None


class RealityFramework(OwnedDocument):
    """
    The complete 26-layer Reality Framework for execution.
    Generated after scoring and path selection.
    Collection: reality_frameworks
    """
    framework_id: str = Field(default_factory=new_id)
    validation_id: str
    version: int = 1
    path_selected: Optional[str] = None  # path_id
    identity: Optional[str] = None
    goal: Optional[str] = None
    purpose: Optional[str] = None
    reality_laws: list[str] = Field(default_factory=list)
    policies: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)   # assumption_ids
    dependencies: list[str] = Field(default_factory=list)  # dependency_ids
    risks: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    plans: list[str] = Field(default_factory=list)
    programs: list[FrameworkProgram] = Field(default_factory=list)
    projects: list[FrameworkProject] = Field(default_factory=list)
    orders: list[FrameworkOrder] = Field(default_factory=list)
    resources: list[dict] = Field(default_factory=list)
    team_structure: TeamStructure = Field(default_factory=TeamStructure)
    individual_layers: IndividualLayers = Field(default_factory=IndividualLayers)
    metrics: list[FrameworkMetric] = Field(default_factory=list)
    business_climate_id: Optional[str] = None
    milestones: list[dict] = Field(default_factory=list)
    decision_rules: list[DecisionRule] = Field(default_factory=list)
    review_system: ReviewSystem = Field(default_factory=ReviewSystem)
    scenarios: list[dict] = Field(default_factory=list)
    recovery_paths: list[dict] = Field(default_factory=list)
    scaling_paths: list[dict] = Field(default_factory=list)
    ideal_scene: Optional[str] = None
    launch_package: Optional[dict] = None
    status: str = "draft"  # draft | active | archived
