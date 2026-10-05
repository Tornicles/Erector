"""Engine input builder tests — Prompt A4."""

from app.models.context import ValidationContext
from app.services.engine_input_builder_service import build_engine_input_object
from test_context_gate import _full_good_context


class TestEngineInputBuilder:
    def test_builds_from_complete_context(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert obj.validation_id == "val_gate"

    def test_includes_user_context(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate", "user_type": "individual"})
        assert "user_type" in obj.user_context

    def test_includes_business_context(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate", "goal_type": "business"})
        assert obj.business_context.get("target_customer")

    def test_includes_economy_context(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate"})
        assert obj.economy_context.get("founder_country")

    def test_includes_revenue_context(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate"})
        assert obj.revenue_context.get("payer")

    def test_includes_evidence_context(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate"})
        assert obj.evidence_context.get("evidence_types")

    def test_includes_risk_context(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate"})
        assert obj.risk_context.get("legal_issues")

    def test_seeds_assumptions(self):
        from app.services.goal_interpretation_service import interpret_goal_deterministically
        ctx = _full_good_context()
        ctx.structured_goal = interpret_goal_deterministically(ctx.raw_goal)
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate"})
        assert isinstance(obj.assumptions_seed, list)

    def test_seeds_dependencies(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate"})
        assert isinstance(obj.dependencies_seed, list)

    def test_readiness_false_with_blockers(self):
        ctx = ValidationContext(validation_id="v", owner_user_id="u", raw_goal="g")
        obj = build_engine_input_object(ctx, {"validation_id": "v"}, readiness_for_engines=False)
        assert obj.readiness_for_engines is False

    def test_readiness_true_when_passed(self):
        ctx = _full_good_context()
        obj = build_engine_input_object(ctx, {"validation_id": "val_gate"}, readiness_for_engines=True)
        assert obj.readiness_for_engines is True
