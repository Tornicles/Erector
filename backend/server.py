"""
Erector — FastAPI Server
Schema foundation layer. No business logic or UI yet.
"""

import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
APP_VERSION = os.environ.get("APP_VERSION", "1.0.0")

# Import all models to verify schema integrity on startup
from models import *  # noqa: F401, F403
from db.collections import ALL_COLLECTIONS
from db.indexes import apply_indexes
from db.migrations import run_migrations


# ---------------------------------------------------------------------------
# Database lifecycle
# ---------------------------------------------------------------------------

class Database:
    client: AsyncIOMotorClient = None
    db = None


db_state = Database()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    db_state.client = AsyncIOMotorClient(MONGO_URL)
    db_state.db = db_state.client[DB_NAME]
    print(f"[Erector] Connected to MongoDB: {DB_NAME}")

    # Apply indexes
    index_results = await apply_indexes(db_state.db)
    print(f"[Erector] Indexes applied: {len(index_results['created'])} created, "
          f"{len(index_results['errors'])} errors")
    if index_results["errors"]:
        for err in index_results["errors"]:
            print(f"[Erector] Index error: {err}")

    # Run migrations
    migration_results = await run_migrations(db_state.db)
    print(f"[Erector] Migrations: {migration_results}")

    yield

    # Shutdown
    if db_state.client:
        db_state.client.close()
        print("[Erector] MongoDB connection closed")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Erector",
    description="Reality Simulation, Validation & Execution Intelligence Platform",
    version=APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request timing middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def add_process_time(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    process_ms = int((time.time() - start) * 1000)
    response.headers["X-Process-Time-Ms"] = str(process_ms)
    return response


# ---------------------------------------------------------------------------
# Health endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {
        "success": True,
        "data": {
            "status": "healthy",
            "version": APP_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "collections": len(ALL_COLLECTIONS),
            "schema_version": "1.0",
        },
        "errors": None,
        "metadata": {
            "request_id": "health",
            "version": APP_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "processing_time_ms": 0,
            "pagination": None,
        },
    }


@app.get("/api/schema/collections")
async def list_collections():
    """List all registered MongoDB collections."""
    return {
        "success": True,
        "data": {
            "collections": sorted(ALL_COLLECTIONS),
            "total": len(ALL_COLLECTIONS),
        },
        "errors": None,
        "metadata": {
            "request_id": "schema_collections",
            "version": APP_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "processing_time_ms": 0,
            "pagination": None,
        },
    }


@app.get("/api/schema/enums")
async def list_enums():
    """List all registered enums and their values."""
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

    return {
        "success": True,
        "data": {
            "enums": enums,
            "total_enums": len(enums),
            "economy_types_count": len(enums["EconomyType"]),
            "engine_names_count": len(enums["EngineName"]),
            "dna_dimensions_count": len(enums["CivilizationDnaDimension"]),
        },
        "errors": None,
        "metadata": {
            "request_id": "schema_enums",
            "version": APP_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "processing_time_ms": 0,
            "pagination": None,
        },
    }


@app.get("/api/schema/indexes")
async def list_indexes():
    """List all registered MongoDB indexes."""
    from db.indexes import get_index_registry
    registry = get_index_registry()
    return {
        "success": True,
        "data": {
            "indexes": registry,
            "total": len(registry),
        },
        "errors": None,
        "metadata": {
            "request_id": "schema_indexes",
            "version": APP_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "processing_time_ms": 0,
            "pagination": None,
        },
    }
