"""
Bhudhi prompt contracts — Prompt A5
Exactly 5 governed prompt contracts: INTERPRET, STRUCTURE, DRAFT, EXPLAIN, SUGGEST.
"""

from __future__ import annotations

from app.models.bhudhi import BhudhiPromptContract
from models.enums import BhudhiMode, BhudhiTriggerType


AUTHORITY_BLOCK = (
    "You are Bhudhi, the advisory intelligence layer inside Erector. "
    "You may only perform the requested mode. You must not decide, calculate, override, "
    "write scores, write verdicts, alter economy profiles, determine Business Climate, "
    "approve assumptions, reject assumptions, resolve dependencies, change validation state, "
    "or approve launch. Return only the allowed JSON schema. Do not include forbidden fields."
)

JSON_ONLY_BLOCK = (
    "Return valid JSON only. No markdown. No prose outside JSON. "
    "No extra fields. Null only where schema permits. Confidence must be 0 to 1."
)


def _contract(
    contract_id: str,
    *,
    mode: BhudhiMode,
    trigger_type: BhudhiTriggerType,
    name: str,
    description: str,
    output_required: list[str],
    max_tokens: int = 1500,
    temperature: float = 0.2,
    version: str = "1.0",
) -> BhudhiPromptContract:
    output_schema = {"type": "object", "required": output_required}
    return BhudhiPromptContract(
        contract_id=contract_id,
        mode=mode,
        trigger_type=trigger_type,
        name=name,
        description=description,
        system_instructions=f"{AUTHORITY_BLOCK}\n{JSON_ONLY_BLOCK}",
        input_schema={"type": "object"},
        output_schema=output_schema,
        allowed_outputs=output_required,
        forbidden_outputs=[
            "reality_score",
            "verdict",
            "scores",
            "climate_state",
            "economy_dna",
            "validation_status",
            "assumption_status",
            "dependency_status",
        ],
        fallback_strategy="deterministic",
        max_tokens=max_tokens,
        temperature=temperature,
        version=version,
        active=True,
    )


INTERPRET_GOAL = _contract(
    "contract_interpret_goal_v1",
    mode=BhudhiMode.interpret,
    trigger_type=BhudhiTriggerType.goal_decomposition,
    name="INTERPRET — Goal Decomposition",
    description="Convert raw goal into structured claims and clarifying questions.",
    output_required=[
        "problem_claim",
        "target_user",
        "value_claim",
        "change_claim",
        "success_claim",
        "revenue_claim",
        "timing_claim",
        "resource_claim",
        "unclear_terms",
        "hidden_assumptions",
        "contradictions",
        "clarification_questions",
        "interpretation_confidence",
    ],
)

STRUCTURE_ASSUMPTIONS = _contract(
    "contract_structure_assumptions_v1",
    mode=BhudhiMode.structure,
    trigger_type=BhudhiTriggerType.assumption_extraction,
    name="STRUCTURE — Assumption Extraction",
    description="Extract assumption/dependency candidates and evidence needed.",
    output_required=[
        "assumption_candidates",
        "dependency_candidates",
        "evidence_needed",
        "test_questions",
        "notes",
    ],
)

DRAFT_FRAMEWORK = _contract(
    "contract_draft_framework_v1",
    mode=BhudhiMode.draft,
    trigger_type=BhudhiTriggerType.framework_language,
    name="DRAFT — Framework Language",
    description="Draft user-facing framework/report language without decisions.",
    output_required=[
        "title",
        "summary",
        "sections",
        "action_items",
        "tone_notes",
        "confidence",
    ],
)

EXPLAIN_SCORE = _contract(
    "contract_explain_score_v1",
    mode=BhudhiMode.explain,
    trigger_type=BhudhiTriggerType.score_rationale,
    name="EXPLAIN — Score Rationale",
    description="Explain provided deterministic scores and rationale; do not create new scores.",
    output_required=[
        "explanation",
        "main_drivers",
        "penalties",
        "confidence_caveats",
        "evidence_that_would_change_confidence",
        "user_friendly_summary",
    ],
)

SUGGEST_PATHS = _contract(
    "contract_suggest_paths_v1",
    mode=BhudhiMode.suggest,
    trigger_type=BhudhiTriggerType.path_alternatives,
    name="SUGGEST — Path Alternatives",
    description="Suggest alternative paths and tests (no selection).",
    output_required=[
        "alternatives",
        "tradeoffs",
        "evaluation_questions",
        "suggested_tests",
        "caution_notes",
    ],
)


ALL_CONTRACTS = [
    INTERPRET_GOAL,
    STRUCTURE_ASSUMPTIONS,
    DRAFT_FRAMEWORK,
    EXPLAIN_SCORE,
    SUGGEST_PATHS,
]

