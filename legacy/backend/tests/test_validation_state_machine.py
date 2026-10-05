"""Validation state machine tests — Prompt A3."""

import pytest

from app.core.errors import InvalidStateTransitionError
from app.models.enums import ValidationStatus
from app.services.validation_state_machine import (
    assert_transition_allowed,
    can_transition,
    get_allowed_transitions,
    is_active,
    is_terminal,
)


class TestValidationStateMachine:
    def test_draft_to_context_collected(self):
        assert can_transition(ValidationStatus.draft, ValidationStatus.context_collected)

    def test_context_collected_to_economic_stack_built(self):
        assert can_transition(ValidationStatus.context_collected, ValidationStatus.economic_stack_built)

    def test_economic_stack_built_to_engines_running(self):
        assert can_transition(ValidationStatus.economic_stack_built, ValidationStatus.engines_running)

    def test_engines_running_to_partial_results(self):
        assert can_transition(ValidationStatus.engines_running, ValidationStatus.partial_results)

    def test_partial_results_to_scoring(self):
        assert can_transition(ValidationStatus.partial_results, ValidationStatus.scoring)

    def test_scoring_to_recursive_challenge(self):
        assert can_transition(ValidationStatus.scoring, ValidationStatus.recursive_challenge)

    def test_recursive_challenge_to_path_generation(self):
        assert can_transition(ValidationStatus.recursive_challenge, ValidationStatus.path_generation)

    def test_path_generation_to_report_ready(self):
        assert can_transition(ValidationStatus.path_generation, ValidationStatus.report_ready)

    def test_report_ready_to_completed(self):
        assert can_transition(ValidationStatus.report_ready, ValidationStatus.completed)

    def test_active_to_failed(self):
        for status in [
            ValidationStatus.draft,
            ValidationStatus.engines_running,
            ValidationStatus.scoring,
        ]:
            assert can_transition(status, ValidationStatus.failed)

    def test_completed_to_launched(self):
        assert can_transition(ValidationStatus.completed, ValidationStatus.launched)

    def test_failed_to_archived(self):
        assert can_transition(ValidationStatus.failed, ValidationStatus.archived)

    def test_draft_to_scoring_rejected(self):
        assert not can_transition(ValidationStatus.draft, ValidationStatus.scoring)
        with pytest.raises(InvalidStateTransitionError):
            assert_transition_allowed(ValidationStatus.draft, ValidationStatus.scoring)

    def test_completed_to_engines_running_rejected(self):
        assert not can_transition(ValidationStatus.completed, ValidationStatus.engines_running)

    def test_archived_to_draft_rejected(self):
        assert not can_transition(ValidationStatus.archived, ValidationStatus.draft)
        assert get_allowed_transitions(ValidationStatus.archived) == []

    def test_get_allowed_transitions_draft(self):
        allowed = get_allowed_transitions(ValidationStatus.draft)
        assert "context_collected" in allowed
        assert "failed" in allowed

    def test_is_terminal(self):
        assert is_terminal(ValidationStatus.completed)
        assert is_terminal(ValidationStatus.failed)
        assert not is_terminal(ValidationStatus.draft)

    def test_is_active(self):
        assert is_active(ValidationStatus.engines_running)
        assert not is_active(ValidationStatus.completed)
