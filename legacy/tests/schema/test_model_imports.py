"""
Test Gate 1: All model imports succeed.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))


def test_enums_import():
    from models.enums import (
        UserType, ExperienceLevel, GoalType, ValidationDepth,
        SubscriptionTier, TeamRole, ValidationStatus, ValidationEventType,
        EngineName, EngineStatus, BhudhiMode, BhudhiForbiddenAction,
        EconomyType, CivilizationDnaDimension, EvidenceType,
        AssumptionCategory, AssumptionStatus, DependencyType, DependencyStatus,
        BlockerLevel, RiskSeverity, PathType, VerdictType, SimulationType,
        SimulationStatus, ScenarioType, SimulationObjectType, SimulationObjectState,
        FitColor, ClimateState, ReportPackageType, ReportFormat, ShareExpiry,
        NotificationType, WorldEventCategory, WebhookEventType,
        ErrorSeverity, ErrorType,
    )
    assert UserType is not None
    assert EngineName is not None


def test_base_import():
    from models.base import (
        PyObjectId, BaseSchema, OwnedDocument, AccessControl,
        SourceRef, ApiError, PaginationMeta, ApiMetadata, ApiResponse,
        new_id, utcnow
    )
    assert BaseSchema is not None
    assert ApiResponse is not None


def test_auth_import():
    from models.auth import ErectorSession, MagicLinkAttempt
    assert ErectorSession is not None


def test_users_import():
    from models.users import ErectorUser, NotificationPreferences, OnboardingState
    assert ErectorUser is not None


def test_teams_import():
    from models.teams import Team, TeamMember, TeamInvitation, Skill
    assert Team is not None


def test_economy_import():
    from models.economy import (
        Economy, CivilizationDnaProfile, CountryEconomyMapping,
        EconomyStackLayer, EconomicStack
    )
    assert Economy is not None
    assert CivilizationDnaProfile is not None


def test_validation_import():
    from models.validation import (
        ValidationSession, ValidationProgress, StructuredGoal
    )
    assert ValidationSession is not None


def test_context_import():
    from models.context import ValidationContext, Question, Answer
    assert ValidationContext is not None


def test_engines_import():
    from models.engines import EngineOutput, Risk, Opportunity, Source
    assert EngineOutput is not None


def test_scoring_import():
    from models.scoring import ValidationScore, ScoreRationale, BlockerFlag
    assert ValidationScore is not None


def test_assumptions_import():
    from models.assumptions import Assumption
    assert Assumption is not None


def test_dependencies_import():
    from models.dependencies import Dependency
    assert Dependency is not None


def test_evidence_import():
    from models.evidence import Evidence
    assert Evidence is not None


def test_simulations_import():
    from models.simulations import (
        SimulationRun, SimulationTimeline, SimulationEvent,
        SimulationSavepoint, SimulationLog
    )
    assert SimulationRun is not None


def test_canvas_import():
    from models.canvas import (
        CanvasState, SimulationObject, ObjectRelationship,
        BranchPreview, BranchNode, CommandCenterState, ScrumBoardState
    )
    assert CanvasState is not None


def test_worlds_import():
    from models.worlds import OrganizationWorldEntity, HumanWorldPersona
    assert OrganizationWorldEntity is not None


def test_resistance_import():
    from models.resistance import ResistanceForce
    assert ResistanceForce is not None


def test_failure_import():
    from models.failure import FailureArchitecture, FailureNode
    assert FailureArchitecture is not None


def test_paths_import():
    from models.paths import ValidationPath, MinimalProofPlan, MinimalProofDay
    assert ValidationPath is not None


def test_verdicts_import():
    from models.verdicts import Verdict
    assert Verdict is not None


def test_frameworks_import():
    from models.frameworks import (
        RealityFramework, FrameworkProgram, FrameworkProject,
        FrameworkOrder, IndividualLayers, TeamStructure
    )
    assert RealityFramework is not None


def test_climates_import():
    from models.climates import BusinessClimate
    assert BusinessClimate is not None


def test_reports_import():
    from models.reports import ValidationReport
    assert ValidationReport is not None


def test_sharing_import():
    from models.sharing import ReportShare, ReportAccessLog
    assert ReportShare is not None


def test_launch_import():
    from models.launch import LaunchPackage, TorgimaLaunchPayload
    assert LaunchPackage is not None


def test_revalidation_import():
    from models.revalidation import RevalidationEvent, ExecutionReadiness
    assert RevalidationEvent is not None


def test_events_import():
    from models.events import WorldEvent, SystemEvent, DeadLetterQueue
    assert WorldEvent is not None


def test_notifications_import():
    from models.notifications import Notification, NotificationToken
    assert Notification is not None


def test_developer_import():
    from models.developer import ErectorApiKey, DeveloperWebhook, WebhookDelivery
    assert ErectorApiKey is not None


def test_billing_import():
    from models.billing import ErectorSubscription, ErectorPayment, UsageCounter
    assert ErectorSubscription is not None


def test_admin_import():
    from models.admin import AdminAction
    assert AdminAction is not None


def test_analytics_import():
    from models.analytics import AnalyticsEvent
    assert AnalyticsEvent is not None


def test_audit_import():
    from models.audit import AuditLog
    assert AuditLog is not None


def test_bhudhi_import():
    from models.bhudhi import BhudhiLog, BhudhiPromptContract
    assert BhudhiLog is not None


def test_security_import():
    from models.security import SystemError
    assert SystemError is not None


def test_db_collections_import():
    from db.collections import ALL_COLLECTIONS, PROTECTED_COLLECTIONS
    assert len(ALL_COLLECTIONS) > 0


def test_db_indexes_import():
    from db.indexes import ALL_INDEXES, get_index_registry
    assert len(ALL_INDEXES) > 0


def test_db_validators_import():
    from db.validators import validate_owned_document, validate_bhudhi_output
    assert validate_owned_document is not None


def test_db_migrations_import():
    from db.migrations import MIGRATIONS, run_migrations
    assert len(MIGRATIONS) > 0
