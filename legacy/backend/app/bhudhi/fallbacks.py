"""
Deterministic fallbacks — Prompt A5
Every contract must have a safe deterministic fallback.
"""

from __future__ import annotations

from typing import Any

from app.services.goal_interpretation_service import interpret_goal_deterministically


def fallback_interpret_goal(input_payload: dict) -> dict:
    raw_goal = str(input_payload.get("raw_goal") or input_payload.get("goal") or "")
    sg = interpret_goal_deterministically(raw_goal)
    return {
        "problem_claim": sg.problem_claim or "",
        "target_user": sg.target_user or "",
        "value_claim": sg.value_claim or "",
        "change_claim": sg.change_claim or "",
        "success_claim": sg.success_claim,
        "revenue_claim": sg.revenue_claim,
        "timing_claim": sg.timing_claim,
        "resource_claim": sg.resource_claim,
        "unclear_terms": sg.unclear_terms,
        "hidden_assumptions": sg.hidden_assumptions,
        "contradictions": sg.contradictions,
        "clarification_questions": [
            "What is the first specific customer segment?",
            "What evidence do you already have?",
            "What is your realistic launch timeline?",
        ],
        "interpretation_confidence": float(sg.interpretation_confidence),
    }


def fallback_structure_assumptions(input_payload: dict) -> dict:
    sg = input_payload.get("structured_goal") or {}
    assumptions = sg.get("hidden_assumptions") or []
    return {
        "assumption_candidates": [
            {
                "statement": a,
                "category": "general",
                "why_it_matters": "Assumption impacts feasibility and demand.",
                "suggested_proof_method": "Customer interview or paid test",
                "suggested_kill_threshold": "No conversion / no willingness to pay",
                "confidence": 0.5,
            }
            for a in assumptions[:15]
        ],
        "dependency_candidates": [],
        "evidence_needed": [],
        "test_questions": ["What would prove this assumption wrong in 7 days?"],
        "notes": ["Deterministic fallback used (no provider call)."],
    }


def fallback_draft_framework_language(input_payload: dict) -> dict:
    title = str(input_payload.get("title") or "Framework draft")
    summary = "Deterministic fallback draft. Replace with Bhudhi output when available."
    return {
        "title": title,
        "summary": summary,
        "sections": [],
        "action_items": [],
        "tone_notes": ["neutral", "caveated"],
        "confidence": 0.4,
    }


def fallback_explain_score(input_payload: dict) -> dict:
    score = input_payload.get("deterministic_score")
    rationale = input_payload.get("deterministic_rationale")
    if score is None or rationale is None:
        return {
            "explanation": "Insufficient deterministic score data to explain.",
            "main_drivers": [],
            "penalties": [],
            "confidence_caveats": ["Provide deterministic_score and deterministic_rationale."],
            "evidence_that_would_change_confidence": [],
            "user_friendly_summary": "Cannot explain score without deterministic inputs.",
        }
    return {
        "explanation": f"The deterministic score is {score}. Rationale: {rationale}",
        "main_drivers": input_payload.get("score_drivers") or [],
        "penalties": input_payload.get("penalties") or [],
        "confidence_caveats": ["This explanation does not change the score."],
        "evidence_that_would_change_confidence": ["Better evidence or updated deterministic drivers."],
        "user_friendly_summary": "Score explanation provided from deterministic rationale.",
    }


def fallback_suggest_paths(input_payload: dict) -> dict:
    return {
        "alternatives": [
            {
                "name": "Narrow initial segment",
                "description": "Start with one niche customer segment and one geography.",
                "potential_upside": "Faster proof and clearer positioning.",
                "potential_risk": "Smaller short-term market.",
                "what_must_be_true": "Segment has urgent pain and willingness to pay.",
                "proof_needed": "Customer interviews or paid pilot.",
            }
        ],
        "tradeoffs": ["Narrow scope improves learning speed but reduces breadth."],
        "evaluation_questions": ["Which segment has the strongest pain today?"],
        "suggested_tests": ["Run a 7-day landing page + outreach test."],
        "caution_notes": ["These are suggestions only; deterministic systems decide later."],
    }


def get_fallback_for_contract(contract, input_payload: dict, reason: str) -> tuple[dict, str]:
    cid = getattr(contract, "contract_id", "")
    if "interpret_goal" in cid:
        return fallback_interpret_goal(input_payload), reason
    if "structure_assumptions" in cid:
        return fallback_structure_assumptions(input_payload), reason
    if "draft_framework" in cid:
        return fallback_draft_framework_language(input_payload), reason
    if "explain_score" in cid:
        return fallback_explain_score(input_payload), reason
    if "suggest_paths" in cid:
        return fallback_suggest_paths(input_payload), reason
    return {"notes": ["No fallback available"]}, reason

