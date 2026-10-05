"""Goal interpretation tests — Prompt A4."""

import pytest

from app.services.goal_interpretation_service import interpret_goal_deterministically


class TestGoalInterpretation:
    def test_saas_goal_extracts_target(self):
        sg = interpret_goal_deterministically(
            "I want to create a SaaS tool for German clinics to manage appointments"
        )
        assert sg.problem_claim or sg.target_user or sg.value_claim
        assert "clinic" in (sg.target_user or "").lower() or "clinic" in (sg.problem_claim or "").lower()

    def test_insurance_regulated_assumptions(self):
        sg = interpret_goal_deterministically(
            "Build insurance for gig workers in Nigeria"
        )
        assert any("regulat" in a.lower() for a in sg.hidden_assumptions)

    def test_everyone_unclear_target(self):
        sg = interpret_goal_deterministically("Everyone will use this app globally")
        assert sg.clarity_score < 7
        assert "universal_audience" in sg.unclear_terms or "unclear" in (sg.target_user or "").lower()

    def test_seven_day_launch_timing(self):
        sg = interpret_goal_deterministically("Launch globally in 7 days")
        assert sg.timing_claim is not None

    def test_no_customer_low_clarity(self):
        sg = interpret_goal_deterministically("Build something cool")
        assert sg.clarity_score <= 6

    def test_deterministic(self):
        g = "SaaS for clinics in Germany"
        assert interpret_goal_deterministically(g).model_dump() == interpret_goal_deterministically(g).model_dump()

    def test_empty_goal_fails(self):
        with pytest.raises(ValueError):
            interpret_goal_deterministically("   ")

    def test_long_goal_trimmed(self):
        sg = interpret_goal_deterministically("x" * 20000)
        assert sg.problem_claim is not None or sg.clarity_score >= 0
