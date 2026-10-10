"""Capability-based Camera, Device and Scene request contracts."""

from __future__ import annotations
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

DEVICE_SOURCES = ("manufacturer", "creator", "reference", "import")
SCENE_REQUIREMENTS = ("lighting", "movement", "framing", "environment", "time_of_day", "audio", "permission", "safety", "cast", "prop", "wardrobe", "location")


class CapabilityDeclaration(BaseModel):
    model_config = ConfigDict(extra="ignore")
    resource_id: str
    facts: dict[str, Any]
    source: str = "creator"
    source_label: str | None = None
    notes: str | None = None


class CapabilityVerification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    resource_id: str
    note: str = ""


class CameraSettingsProposal(BaseModel):
    model_config = ConfigDict(extra="ignore")
    shot_id: str
    camera_resource_id: str
    lens_resource_id: str | None = None
    intent: dict[str, Any] = Field(default_factory=dict)


class CameraSettingsDecision(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str
    note: str = ""


class SceneRequirementCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    production_id: str
    kind: str
    detail: str = Field(min_length=1, max_length=600)
    scene_id: str | None = None
    shot_id: str | None = None
    mandatory: bool = True
    source: str = "creator"


class SceneRequirementDecision(BaseModel):
    model_config = ConfigDict(extra="ignore")
    state: str
    note: str = ""
