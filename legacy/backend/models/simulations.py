"""
Simulation schemas — SimulationRun, SimulationTimeline, SimulationEvent, SimulationSavepoint, SimulationLog.
Collections: simulation_runs, simulation_savepoints, simulation_logs
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import OwnedDocument, BaseSchema, new_id, utcnow
from .enums import (
    SimulationType, SimulationStatus, ScenarioType,
    TimelineHorizon, LogLevel, RiskSeverity
)


class CurvePoint(BaseSchema):
    offset_days: int
    value: float
    scenario: ScenarioType


class SimulationEvent(BaseSchema):
    """A discrete event in the simulation timeline."""
    event_id: str = Field(default_factory=new_id)
    timestamp_offset: int = 0  # days from simulation start
    scenario: ScenarioType = ScenarioType.expected_case
    title: str
    description: str
    event_type: str
    severity: RiskSeverity = RiskSeverity.medium
    affected_object_ids: list[str] = Field(default_factory=list)
    score_delta: float = 0.0
    climate_delta: float = 0.0
    source_engine: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.7)


class SimulationMilestone(BaseSchema):
    milestone_id: str = Field(default_factory=new_id)
    title: str
    day_offset: int
    scenario: ScenarioType
    success_condition: str
    failure_condition: Optional[str] = None


class SimulationTimeline(BaseSchema):
    horizon: TimelineHorizon = TimelineHorizon.ninety_days
    custom_days: Optional[int] = None
    events: list[SimulationEvent] = Field(default_factory=list)
    milestones: list[SimulationMilestone] = Field(default_factory=list)
    burnout_curve: list[CurvePoint] = Field(default_factory=list)
    revenue_probability_curve: list[CurvePoint] = Field(default_factory=list)
    failure_triggers: list[str] = Field(default_factory=list)


class ScenarioOutcome(BaseSchema):
    scenario: ScenarioType
    probability: float = Field(ge=0.0, le=1.0)
    final_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    key_factors: list[str] = Field(default_factory=list)
    critical_path: list[str] = Field(default_factory=list)
    summary: Optional[str] = None


class SimulationRun(OwnedDocument):
    """
    A simulation run over a validation's economic/goal context.
    Collection: simulation_runs
    """
    simulation_id: str = Field(default_factory=new_id)
    validation_id: str
    simulation_type: SimulationType = SimulationType.business
    scenario: ScenarioType = ScenarioType.expected_case
    status: SimulationStatus = SimulationStatus.idle
    timeline: Optional[SimulationTimeline] = None
    actors: list[dict] = Field(default_factory=list)         # persona/org actor refs
    organizations: list[dict] = Field(default_factory=list)
    events: list[SimulationEvent] = Field(default_factory=list)
    best_case: Optional[ScenarioOutcome] = None
    expected_case: Optional[ScenarioOutcome] = None
    worst_case: Optional[ScenarioOutcome] = None
    collapse_case: Optional[ScenarioOutcome] = None
    aggressive_case: Optional[ScenarioOutcome] = None
    conservative_case: Optional[ScenarioOutcome] = None
    climate_effect: Optional[dict] = None
    canvas_state: Optional[dict] = None
    command_center_state: Optional[dict] = None
    scrum_state: Optional[dict] = None
    logs_count: int = 0
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class SimulationSavepoint(OwnedDocument):
    """
    A named savepoint branching point in a simulation.
    Collection: simulation_savepoints
    """
    savepoint_id: str = Field(default_factory=new_id)
    simulation_id: str
    validation_id: str
    label: str
    description: Optional[str] = None
    state_snapshot: dict = Field(default_factory=dict)
    parent_savepoint_id: Optional[str] = None
    branch_name: Optional[str] = None


class SimulationLog(BaseSchema):
    """
    Individual log entry from a simulation run.
    Collection: simulation_logs
    """
    log_id: str = Field(default_factory=new_id)
    simulation_id: str
    validation_id: str
    timestamp: datetime = Field(default_factory=utcnow)
    level: LogLevel = LogLevel.info
    message: str
    engine_source: Optional[str] = None
    object_id: Optional[str] = None
    event_id: Optional[str] = None
