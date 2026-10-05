"""
Test Gate 2: Enum integrity checks.
- No duplicate values
- All 30 economy types exist
- All 25 DNA dimensions exist
- All 27 engine names exist
- All 6 verdicts exist
- All 5 paths exist
- All 10 climate states exist
- All 10 report packages exist
- All 7 subscription tiers match product model
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))


def test_no_duplicate_enum_values():
    """Every enum must have unique values."""
    from models.enums import (
        UserType, ExperienceLevel, GoalType, ValidationDepth,
        SubscriptionTier, TeamRole, ValidationStatus, EngineName,
        EngineStatus, BhudhiMode, BhudhiForbiddenAction, EconomyType,
        CivilizationDnaDimension, EvidenceType, AssumptionCategory,
        AssumptionStatus, DependencyType, DependencyStatus,
        BlockerLevel, RiskSeverity, PathType, VerdictType,
        SimulationType, SimulationStatus, ScenarioType,
        SimulationObjectType, SimulationObjectState, FitColor,
        ClimateState, ReportPackageType, ReportFormat, ShareExpiry,
        NotificationType, WorldEventCategory, WebhookEventType,
        ErrorSeverity, ErrorType,
    )
    all_enums = [
        UserType, ExperienceLevel, GoalType, ValidationDepth,
        SubscriptionTier, TeamRole, ValidationStatus, EngineName,
        EngineStatus, BhudhiMode, BhudhiForbiddenAction, EconomyType,
        CivilizationDnaDimension, EvidenceType, AssumptionCategory,
        AssumptionStatus, DependencyType, DependencyStatus,
        BlockerLevel, RiskSeverity, PathType, VerdictType,
        SimulationType, SimulationStatus, ScenarioType,
        SimulationObjectType, SimulationObjectState, FitColor,
        ClimateState, ReportPackageType, ReportFormat, ShareExpiry,
        NotificationType, WorldEventCategory, WebhookEventType,
        ErrorSeverity, ErrorType,
    ]
    for enum_class in all_enums:
        values = [e.value for e in enum_class]
        assert len(values) == len(set(values)), (
            f"Duplicate values in {enum_class.__name__}: {values}"
        )


def test_30_economy_types():
    from models.enums import EconomyType
    values = [e.value for e in EconomyType]
    assert len(values) == 30, f"Expected 30 economy types, got {len(values)}: {values}"
    required = [
        "consumer_capitalist", "welfare_industrial", "financial_mega_city",
        "export_technology", "manufacturing_excellence", "oil_wealth",
        "commodity_export", "rapid_urbanization", "manufacturing_expansion",
        "tourism_economy", "port_logistics", "state_controlled_hybrid",
        "agricultural_labor", "informal_cash", "aid_dependent",
        "corruption_heavy", "infrastructure_deficient", "urban_poverty",
        "black_market_war", "occupied_territory", "civil_war",
        "militia_controlled", "sanctioned", "post_collapse",
        "creator_economy", "gig_platform", "freelance_digital",
        "saas_startup", "ai_automation", "cybercrime_dark_web",
    ]
    for economy in required:
        assert economy in values, f"Missing economy type: {economy}"


def test_25_dna_dimensions():
    from models.enums import CivilizationDnaDimension
    values = [e.value for e in CivilizationDnaDimension]
    assert len(values) == 25, f"Expected 25 DNA dimensions, got {len(values)}"
    required = [
        "trust_index", "authority_index", "corruption_index", "innovation_index",
        "digital_adoption_index", "education_index", "social_mobility_index",
        "bureaucracy_index", "stability_index", "information_freedom_index",
        "risk_tolerance_index", "community_dependence_index", "crime_pressure_index",
        "payment_reliability_index", "infrastructure_reliability_index",
        "institutional_strength_index", "media_volatility_index",
        "legal_predictability_index", "labor_reliability_index",
        "crisis_exposure_index", "adoption_friction_index",
        "social_proof_dependence_index", "reputation_fragility_index",
        "informal_network_strength_index", "future_change_velocity_index",
    ]
    for dim in required:
        assert dim in values, f"Missing DNA dimension: {dim}"


def test_27_engine_names():
    from models.enums import EngineName
    values = [e.value for e in EngineName]
    assert len(values) == 27, f"Expected 27 engines, got {len(values)}: {values}"
    required = [
        "economy_resolution", "purpose_decomposition", "industry_intelligence",
        "market_analysis", "competitor_reality", "economy_location_intelligence",
        "customer_pain", "execution_difficulty_timing", "scoring",
        "evidence_quality", "knowledge_gap", "decision_intelligence",
        "recursive_validation", "multi_perspective_reality", "second_order_consequence",
        "systemic_risk", "institutional_reality", "narrative_intelligence",
        "cognitive_bias", "learning_velocity", "motivation", "counterfactual",
        "survivor_pattern", "anti_gaming", "civilization_evolution",
        "reality_compression", "meta_validation",
    ]
    for engine in required:
        assert engine in values, f"Missing engine: {engine}"


def test_6_verdict_types():
    from models.enums import VerdictType
    values = [e.value for e in VerdictType]
    assert len(values) == 6, f"Expected 6 verdicts, got {len(values)}"
    required = ["proceed", "adjust", "pivot", "delay", "test_first", "blocked"]
    for v in required:
        assert v in values, f"Missing verdict: {v}"


def test_5_path_types():
    from models.enums import PathType
    values = [e.value for e in PathType]
    assert len(values) == 5, f"Expected 5 path types, got {len(values)}"
    required = [
        "current_path", "adjusted_path", "alternative_path",
        "counterfactual_path", "minimal_proof_path"
    ]
    for p in required:
        assert p in values, f"Missing path type: {p}"


def test_10_climate_states():
    from models.enums import ClimateState
    values = [e.value for e in ClimateState]
    assert len(values) == 10, f"Expected 10 climate states, got {len(values)}"
    required = [
        "blank", "pressure", "stability", "growth", "control",
        "abundance", "saturation", "decline", "collapse", "reinvention"
    ]
    for state in required:
        assert state in values, f"Missing climate state: {state}"


def test_10_report_packages():
    from models.enums import ReportPackageType
    values = [e.value for e in ReportPackageType]
    assert len(values) == 10, f"Expected 10 report packages, got {len(values)}"
    # Must include 5 main packages
    main_packages = [
        "executive_reality_report", "simulation_report", "reality_framework",
        "business_climate_guide", "launch_package"
    ]
    for pkg in main_packages:
        assert pkg in values, f"Missing main report package: {pkg}"
    # Must include Team Mode packages
    team_packages = ["team_architecture_report", "team_simulation_report", "team_climate_analysis"]
    for pkg in team_packages:
        assert pkg in values, f"Missing team report package: {pkg}"


def test_7_subscription_tiers():
    from models.enums import SubscriptionTier
    values = [e.value for e in SubscriptionTier]
    assert len(values) == 7, f"Expected 7 subscription tiers, got {len(values)}"
    required = ["free", "starter", "growth", "premium", "team", "enterprise", "api"]
    for tier in required:
        assert tier in values, f"Missing subscription tier: {tier}"


def test_7_simulation_types():
    from models.enums import SimulationType
    values = [e.value for e in SimulationType]
    assert len(values) == 7, f"Expected 7 simulation types, got {len(values)}"


def test_bhudhi_modes_are_not_forbidden():
    """BhudhiMode values must NOT overlap with BhudhiForbiddenAction values."""
    from models.enums import BhudhiMode, BhudhiForbiddenAction
    allowed = {e.value for e in BhudhiMode}
    forbidden = {e.value for e in BhudhiForbiddenAction}
    overlap = allowed.intersection(forbidden)
    assert not overlap, f"BhudhiMode overlaps with forbidden actions: {overlap}"


def test_validation_state_machine_coverage():
    """All ValidationStatus values must appear in the state machine."""
    from models.enums import ValidationStatus, VALIDATION_STATE_TRANSITIONS
    all_states = {e.value for e in ValidationStatus}
    machine_states = set(VALIDATION_STATE_TRANSITIONS.keys())
    missing = all_states - machine_states
    assert not missing, f"States missing from transition table: {missing}"
