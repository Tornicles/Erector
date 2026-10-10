"""Discover Content Engine request contracts."""

from __future__ import annotations
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

ITEM_KINDS = ("technique", "knowledge", "tutorial", "reference_example", "movie_reference", "template", "inspiration")
VISIBILITIES = ("workspace", "global")
SOURCES = ("knowledge", "tutorial", "production_reference", "creator", "import", "tonde_canon")
ACTIONS = ("use_technique", "attach_reference", "direct_this")


class DiscoverRegister(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item: dict[str, Any]
    visibility: str = "workspace"


class DiscoverSave(BaseModel):
    model_config = ConfigDict(extra="ignore")
    note: str = Field(default="", max_length=1000)


class CollectionCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=1000)


class CollectionAdd(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item_id: str
    note: str = Field(default="", max_length=1000)


class DiscoverPreview(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item_id: str
    kind: str
    production_id: str
    scene_id: str | None = None
    shot_id: str | None = None
    note: str = Field(default="", max_length=1000)


class DiscoverApply(BaseModel):
    model_config = ConfigDict(extra="ignore")
    confirmation: str
    note: str = Field(default="", max_length=1000)


class DiscoverWithdraw(BaseModel):
    model_config = ConfigDict(extra="ignore")
    note: str = Field(default="", max_length=1000)
