"""
Question Branching Service — Prompt A4
Deterministic branch logic for dynamic questions.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from app.models.context import ValidationContext
from app.models.questions import QuestionDefinition
from app.services.question_catalog import (
    FOLLOW_UP_TEMPLATES,
    PLATFORM_KEYWORDS,
    QUESTION_BY_ID,
    REGULATED_INDUSTRIES,
    REVENUE_GOAL_TYPES,
    ALL_BASE_CATALOG,
)
from models.enums import GoalType, QuestionCategory, QuestionPriority, UserType


def _answer_map(context: ValidationContext) -> dict[str, Any]:
    return {a.question_id: a.normalized_value or a.value for a in context.answers}


def _text_blob(context: ValidationContext) -> str:
    parts = [context.raw_goal or ""]
    if context.structured_goal:
        sg = context.structured_goal
        parts.extend(filter(None, [sg.problem_claim, sg.target_user, sg.value_claim]))
    for a in context.answers:
        parts.append(str(a.value))
    return " ".join(parts).lower()


def _industry_key(context: ValidationContext) -> str:
    am = _answer_map(context)
    ind = str(am.get("industry_sector", "") or "").lower()
    meta = context.metadata or {}
    return ind or str(meta.get("industry", "")).lower()


def _is_regulated(context: ValidationContext) -> bool:
    ind = _industry_key(context)
    blob = _text_blob(context)
    for r in REGULATED_INDUSTRIES:
        if r in ind or r in blob:
            return True
    reg = str(_answer_map(context).get("industry_regulation", "")).lower()
    return reg in ("high", "heavily_regulated")


def _needs_revenue(context: ValidationContext, validation: dict) -> bool:
    gt = str(validation.get("goal_type", "business")).lower()
    if gt in REVENUE_GOAL_TYPES:
        return True
    blob = _text_blob(context)
    return any(k in blob for k in ("revenue", "saas", "subscription", "paid", "monetize", "sell"))


def _is_team_mode(context: ValidationContext, validation: dict) -> bool:
    if validation.get("team_id"):
        return True
    ut = str(validation.get("user_type", "")).lower()
    return ut == UserType.team.value


def evaluate_branch_conditions(context: ValidationContext, validation: dict) -> dict:
    am = _answer_map(context)
    founder = am.get("economy_founder_country") or validation.get("founder_country")
    customer = am.get("economy_customer_country") or validation.get("customer_country")
    return {
        "regulated": _is_regulated(context),
        "needs_revenue": _needs_revenue(context, validation),
        "team_mode": _is_team_mode(context, validation),
        "cross_border": bool(founder and customer and str(founder).lower() != str(customer).lower()),
        "no_evidence": _is_no_evidence(am),
        "no_competitors": _is_no_competitors(am, context),
        "everyone_customer": _is_everyone_customer(am, context),
        "aggressive_timeline": _is_aggressive_timeline(am, context),
        "low_budget": _is_low_budget(am, context),
        "creator": "creator" in _text_blob(context) or "content" in _text_blob(context),
        "saas": "saas" in _text_blob(context) or "software" in _text_blob(context),
    }


def _is_no_evidence(am: dict) -> bool:
    ev = str(am.get("evidence_customer_proof", "")).lower()
    return ev in ("no_evidence", "none", "none yet", "no evidence", "opinion", "")


def _is_no_competitors(am: dict, context: ValidationContext) -> bool:
    comp = str(am.get("industry_competitors", "") + am.get("risk_competitor_response", "")).lower()
    return "no competitor" in comp or comp.strip() in ("none", "none.")


def _is_everyone_customer(am: dict, context: ValidationContext) -> bool:
    cust = str(am.get("basic_target_customer", "")).lower()
    if any(p in cust for p in ("everyone", "all people", "all businesses", "anyone")):
        return True
    if context.structured_goal and context.structured_goal.target_user:
        tu = context.structured_goal.target_user.lower()
        return "everyone" in tu or "unclear" in tu
    return False


def _is_aggressive_timeline(am: dict, context: ValidationContext) -> bool:
    tl = str(am.get("basic_timeline", "") + " " + (context.structured_goal.timing_claim or "" if context.structured_goal else "")).lower()
    m = re.search(r"(\d+)\s*days?", tl)
    if m and int(m.group(1)) <= 30:
        return True
    if context.structured_goal and context.structured_goal.timing_claim:
        m2 = re.search(r"(\d+)\s*days?", context.structured_goal.timing_claim.lower())
        if m2 and int(m2.group(1)) <= 30:
            return True
    return False


def _is_low_budget(am: dict, context: ValidationContext) -> bool:
    budget = str(am.get("basic_resources", "") + " " + am.get("risk_limits", "")).lower()
    m = re.search(r"\$?\s*(\d+)", budget)
    if m and int(m.group(1)) <= 500:
        return True
    return "$0" in budget or "no budget" in budget or "$100" in budget


def get_required_questions(context: ValidationContext, validation: dict) -> list[QuestionDefinition]:
    branches = evaluate_branch_conditions(context, validation)
    questions: list[QuestionDefinition] = []
    questions.extend(get_basic_questions())
    questions.extend(get_industry_questions(context, branches))
    questions.extend(get_economy_questions(context, branches))
    questions.extend(get_team_questions(context, validation, branches))
    if branches["needs_revenue"]:
        questions.extend(get_revenue_questions())
    questions.extend(get_evidence_questions())
    questions.extend(get_risk_questions())
    questions.extend(get_follow_up_questions(context, branches))
    return dedupe_questions([], questions)


def get_basic_questions() -> list[QuestionDefinition]:
    return [q for q in ALL_BASE_CATALOG if q.category == QuestionCategory.basic]


def get_industry_questions(context: ValidationContext, branches: dict) -> list[QuestionDefinition]:
    qs = [q for q in ALL_BASE_CATALOG if q.category == QuestionCategory.industry and q.priority == QuestionPriority.required]
    if branches["regulated"]:
        qs.extend([
            QUESTION_BY_ID["industry_license"],
            QUESTION_BY_ID["industry_compliance_owner"],
            QUESTION_BY_ID["industry_approval_delay"],
            QUESTION_BY_ID["industry_legal_confirmed"],
        ])
    if branches["saas"]:
        qs.append(_clone(qid_suffix="saas_churn", base=QUESTION_BY_ID["industry_risks"],
                         prompt="What technical complexity, data, security, or churn risks exist?"))
    if branches["creator"]:
        qs.append(_clone(qid_suffix="creator_platform", base=QUESTION_BY_ID["economy_platform"],
                         prompt="Which platform is central to your audience and distribution narrative?"))
    return qs


def get_economy_questions(context: ValidationContext, branches: dict) -> list[QuestionDefinition]:
    qs = [q for q in ALL_BASE_CATALOG if q.category == QuestionCategory.economy and q.priority == QuestionPriority.required]
    if branches["cross_border"]:
        qs.extend([QUESTION_BY_ID["economy_cross_border_payment"], QUESTION_BY_ID["economy_payment_fallback"]])
    blob = _text_blob(context)
    if any(p in blob for p in PLATFORM_KEYWORDS):
        qs.append(QUESTION_BY_ID["economy_platform"])
    return qs


def get_team_questions(context: ValidationContext, validation: dict, branches: dict) -> list[QuestionDefinition]:
    if branches["team_mode"]:
        return [q for q in ALL_BASE_CATALOG if q.category == QuestionCategory.team
                and "individual" not in q.tags and q.priority != QuestionPriority.optional]
    return [q for q in ALL_BASE_CATALOG if q.category == QuestionCategory.team and "individual" in q.tags]


def get_revenue_questions() -> list[QuestionDefinition]:
    return [q for q in ALL_BASE_CATALOG if q.category == QuestionCategory.revenue and q.priority == QuestionPriority.required]


def get_evidence_questions() -> list[QuestionDefinition]:
    return [q for q in ALL_BASE_CATALOG if q.category == QuestionCategory.evidence and q.priority == QuestionPriority.required]


def get_risk_questions() -> list[QuestionDefinition]:
    return [q for q in ALL_BASE_CATALOG if q.category == QuestionCategory.risk and q.priority == QuestionPriority.required]


def get_follow_up_questions(context: ValidationContext, branches: dict) -> list[QuestionDefinition]:
    follow: list[QuestionDefinition] = []
    if branches["everyone_customer"]:
        follow.extend([
            FOLLOW_UP_TEMPLATES["followup_specific_segment"],
            FOLLOW_UP_TEMPLATES["followup_who_not_want"],
            FOLLOW_UP_TEMPLATES["followup_demand_proof"],
            FOLLOW_UP_TEMPLATES["followup_start_country"],
        ])
    if branches["no_evidence"]:
        follow.extend([
            FOLLOW_UP_TEMPLATES["followup_cheapest_test"],
            FOLLOW_UP_TEMPLATES["followup_kill_signal"],
            FOLLOW_UP_TEMPLATES["followup_demand_proof"],
        ])
    if branches["no_competitors"]:
        follow.append(FOLLOW_UP_TEMPLATES["followup_competitor_clarify"])
    if branches["aggressive_timeline"]:
        follow.append(FOLLOW_UP_TEMPLATES["followup_timeline_deps"])
    if branches["low_budget"]:
        follow.append(FOLLOW_UP_TEMPLATES["followup_budget_unavoidable"])
    return follow


def _clone(qid_suffix: str, base: QuestionDefinition, prompt: str) -> QuestionDefinition:
    d = base.model_copy(deep=True)
    d.question_id = f"{base.question_id}_{qid_suffix}"
    d.prompt = prompt
    return d


def dedupe_questions(
    existing_ids: list[str],
    new_questions: list[QuestionDefinition],
) -> list[QuestionDefinition]:
    seen = set(existing_ids)
    result = []
    for q in new_questions:
        if q.question_id not in seen:
            seen.add(q.question_id)
            result.append(q)
    return result


def prioritize_questions(questions: list[QuestionDefinition]) -> list[QuestionDefinition]:
    priority_order = {
        QuestionPriority.required: 0,
        QuestionPriority.conditional: 1,
        QuestionPriority.recommended: 2,
        QuestionPriority.optional: 3,
    }
    return sorted(questions, key=lambda q: (priority_order.get(q.priority, 9), q.order))
