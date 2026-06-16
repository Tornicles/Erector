"""
Schema router — migrated from Prompt 0 server.py.
GET /api/schema/collections
GET /api/schema/enums
GET /api/schema/indexes
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.config import get_settings
from app.models.api import success_response

router = APIRouter(prefix="/schema", tags=["schema"])
settings = get_settings()


@router.get("/collections")
async def list_collections():
    """List all registered MongoDB collections (Prompt 0 contract)."""
    from db.collections import ALL_COLLECTIONS
    return success_response(
        data={
            "collections": sorted(ALL_COLLECTIONS),
            "total": len(ALL_COLLECTIONS),
        }
    ).model_dump()


@router.get("/enums")
async def list_enums():
    """List all registered enums and their values (Prompt 0 contract)."""
    from models.enums import (
        UserType, ExperienceLevel, GoalType, ValidationDepth,
        SubscriptionTier, TeamRole, ValidationStatus, EngineName,
        EngineStatus, BhudhiMode, BhudhiForbiddenAction, EconomyType,
        CivilizationDnaDimension, EvidenceType, AssumptionCategory,
        AssumptionStatus, DependencyType, DependencyStatus, BlockerLevel,
        RiskSeverity, PathType, VerdictType, SimulationType, SimulationStatus,
        ScenarioType, SimulationObjectType, SimulationObjectState, FitColor,
        ClimateState, ReportPackageType, ReportFormat, ShareExpiry,
        NotificationType, WorldEventCategory, WebhookEventType,
        ErrorSeverity, ErrorType,
    )
    enums = {
        "UserType": [e.value for e in UserType],
        "ExperienceLevel": [e.value for e in ExperienceLevel],
        "GoalType": [e.value for e in GoalType],
        "ValidationDepth": [e.value for e in ValidationDepth],
        "SubscriptionTier": [e.value for e in SubscriptionTier],
        "TeamRole": [e.value for e in TeamRole],
        "ValidationStatus": [e.value for e in ValidationStatus],
        "EngineName": [e.value for e in EngineName],
        "EngineStatus": [e.value for e in EngineStatus],
        "BhudhiMode": [e.value for e in BhudhiMode],
        "BhudhiForbiddenAction": [e.value for e in BhudhiForbiddenAction],
        "EconomyType": [e.value for e in EconomyType],
        "CivilizationDnaDimension": [e.value for e in CivilizationDnaDimension],
        "EvidenceType": [e.value for e in EvidenceType],
        "AssumptionCategory": [e.value for e in AssumptionCategory],
        "AssumptionStatus": [e.value for e in AssumptionStatus],
        "DependencyType": [e.value for e in DependencyType],
        "DependencyStatus": [e.value for e in DependencyStatus],
        "BlockerLevel": [e.value for e in BlockerLevel],
        "RiskSeverity": [e.value for e in RiskSeverity],
        "PathType": [e.value for e in PathType],
        "VerdictType": [e.value for e in VerdictType],
        "SimulationType": [e.value for e in SimulationType],
        "SimulationStatus": [e.value for e in SimulationStatus],
        "ScenarioType": [e.value for e in ScenarioType],
        "SimulationObjectType": [e.value for e in SimulationObjectType],
        "SimulationObjectState": [e.value for e in SimulationObjectState],
        "FitColor": [e.value for e in FitColor],
        "ClimateState": [e.value for e in ClimateState],
        "ReportPackageType": [e.value for e in ReportPackageType],
        "ReportFormat": [e.value for e in ReportFormat],
        "ShareExpiry": [e.value for e in ShareExpiry],
        "NotificationType": [e.value for e in NotificationType],
        "WorldEventCategory": [e.value for e in WorldEventCategory],
        "WebhookEventType": [e.value for e in WebhookEventType],
        "ErrorSeverity": [e.value for e in ErrorSeverity],
        "ErrorType": [e.value for e in ErrorType],
    }
    return success_response(
        data={
            "enums": enums,
            "total_enums": len(enums),
            "economy_types_count": len(enums["EconomyType"]),
            "engine_names_count": len(enums["EngineName"]),
            "dna_dimensions_count": len(enums["CivilizationDnaDimension"]),
        }
    ).model_dump()


@router.get("/indexes")
async def list_indexes():
    """List all registered MongoDB indexes (Prompt 0 contract)."""
    from db.indexes import get_index_registry
    registry = get_index_registry()
    return success_response(
        data={"indexes": registry, "total": len(registry)}
    ).model_dump()
