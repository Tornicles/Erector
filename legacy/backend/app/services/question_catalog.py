"""
Question Catalog — Prompt A4
Structured reusable question definitions for all 8 categories.
"""

from __future__ import annotations

from models.enums import QuestionCategory, QuestionPriority, QuestionType
from app.models.questions import QuestionDefinition, QuestionOption


def _q(
    qid: str,
    category: QuestionCategory,
    prompt: str,
    *,
    qtype: QuestionType = QuestionType.text,
    priority: QuestionPriority = QuestionPriority.required,
    help_text: str | None = None,
    options: list[QuestionOption] | None = None,
    order: int = 0,
    tags: list[str] | None = None,
    blocks: bool = True,
) -> QuestionDefinition:
    return QuestionDefinition(
        question_id=qid,
        category=category,
        question_type=qtype,
        priority=priority,
        prompt=prompt,
        help_text=help_text,
        options=options or [],
        required=priority == QuestionPriority.required,
        blocks_progress_if_missing=blocks,
        order=order,
        tags=tags or [],
    )


EVIDENCE_OPTIONS = [
    QuestionOption(label="No evidence", value="no_evidence"),
    QuestionOption(label="Opinion only", value="opinion"),
    QuestionOption(label="Anecdotal", value="anecdotal"),
    QuestionOption(label="Observed behavior", value="observed_behavior"),
    QuestionOption(label="Customer interviews", value="customer_interviews"),
    QuestionOption(label="Paid tests", value="paid_tests"),
    QuestionOption(label="Transaction data", value="transaction_data"),
    QuestionOption(label="Market data", value="market_data"),
    QuestionOption(label="Operational history", value="operational_history"),
    QuestionOption(label="Longitudinal evidence", value="longitudinal_evidence"),
]

BASE_QUESTIONS: list[QuestionDefinition] = [
    _q("basic_raw_goal", QuestionCategory.basic, "What are you trying to build or achieve?", order=1, tags=["basic"]),
    _q("basic_problem", QuestionCategory.basic, "What problem are you solving?", order=2, tags=["basic"]),
    _q("basic_target_customer", QuestionCategory.basic,
       "Who is the first specific customer segment this is for?",
       help_text="Avoid 'everyone'. Choose the group with the strongest pain.",
       order=3, tags=["basic", "customer"]),
    _q("basic_success", QuestionCategory.basic, "What does success look like?", order=4, tags=["basic"]),
    _q("basic_timeline", QuestionCategory.basic, "What is your target timeline?", order=5, tags=["basic", "timeline"]),
    _q("basic_resources", QuestionCategory.basic, "What resources do you currently have?", order=6, tags=["basic"]),
    _q("basic_smallest_proof", QuestionCategory.basic,
       "What is the smallest proof that would show this is working?", order=7, tags=["basic"]),
]

INDUSTRY_QUESTIONS: list[QuestionDefinition] = [
    _q("industry_sector", QuestionCategory.industry, "What industry or sector is this in?",
       qtype=QuestionType.industry, order=10, tags=["industry"]),
    _q("industry_alternatives", QuestionCategory.industry,
       "What existing alternatives do customers use today?", order=11, tags=["industry"]),
    _q("industry_regulation", QuestionCategory.industry,
       "How regulated is this industry?", qtype=QuestionType.single_select,
       options=[
           QuestionOption(label="Low", value="low"),
           QuestionOption(label="Medium", value="medium"),
           QuestionOption(label="High", value="high"),
           QuestionOption(label="Heavily regulated", value="heavily_regulated"),
       ], order=12, tags=["industry"]),
    _q("industry_risks", QuestionCategory.industry,
       "What industry-specific risks do you already know?", order=13, tags=["industry"]),
    _q("industry_competitors", QuestionCategory.industry,
       "Who are the strongest incumbents or competitors?", order=14, tags=["industry", "competitors"]),
    _q("industry_license", QuestionCategory.industry,
       "What license, permit, or approval is required?", priority=QuestionPriority.conditional,
       order=15, tags=["industry", "legal", "regulated"]),
    _q("industry_compliance_owner", QuestionCategory.industry,
       "Who is responsible for compliance?", priority=QuestionPriority.conditional,
       order=16, tags=["industry", "legal", "regulated"]),
    _q("industry_approval_delay", QuestionCategory.industry,
       "What happens if approval is delayed?", priority=QuestionPriority.conditional,
       order=17, tags=["industry", "legal", "regulated"]),
    _q("industry_legal_confirmed", QuestionCategory.industry,
       "Have you confirmed this is legally allowed?", priority=QuestionPriority.conditional,
       qtype=QuestionType.boolean, order=18, tags=["industry", "legal", "regulated"]),
]

ECONOMY_QUESTIONS: list[QuestionDefinition] = [
    _q("economy_founder_country", QuestionCategory.economy, "Where are you located?",
       qtype=QuestionType.country, order=20, tags=["economy", "founder_country"]),
    _q("economy_customer_country", QuestionCategory.economy, "Where are your target customers located?",
       qtype=QuestionType.country, order=21, tags=["economy", "customer_country"]),
    _q("economy_revenue_country", QuestionCategory.economy, "Where will revenue be collected?",
       qtype=QuestionType.country, order=22, tags=["economy"]),
    _q("economy_platform", QuestionCategory.economy,
       "What platforms does distribution depend on?", order=23, tags=["economy", "platform"]),
    _q("economy_payment_method", QuestionCategory.economy,
       "What payment method will customers use?", order=24, tags=["economy", "payment"]),
    _q("economy_regulatory_jurisdiction", QuestionCategory.economy,
       "Which legal or regulatory jurisdiction controls the activity?", order=25, tags=["economy", "legal"]),
    _q("economy_cross_border_payment", QuestionCategory.economy,
       "How will cross-border payments and support work?", priority=QuestionPriority.conditional,
       order=26, tags=["economy", "cross_border"]),
    _q("economy_payment_fallback", QuestionCategory.economy,
       "What payment fallback exists if primary method fails?", priority=QuestionPriority.conditional,
       order=27, tags=["economy", "payment"]),
]

TEAM_QUESTIONS: list[QuestionDefinition] = [
    _q("team_size", QuestionCategory.team, "How many people are on the team?",
       qtype=QuestionType.number, priority=QuestionPriority.conditional, order=30, tags=["team"]),
    _q("team_roles", QuestionCategory.team, "What roles exist today?",
       priority=QuestionPriority.conditional, order=31, tags=["team"]),
    _q("team_execution_owner", QuestionCategory.team, "Who owns execution?",
       priority=QuestionPriority.conditional, order=32, tags=["team"]),
    _q("team_skill_gaps", QuestionCategory.team, "What skill gaps exist?",
       priority=QuestionPriority.conditional, order=33, tags=["team"]),
    _q("team_hours_per_week", QuestionCategory.team, "How many hours per week can the team commit?",
       qtype=QuestionType.number, order=34, tags=["team", "capacity"]),
    _q("team_worked_together", QuestionCategory.team, "Has this team worked together before?",
       qtype=QuestionType.boolean, priority=QuestionPriority.conditional, order=35, tags=["team"]),
    _q("team_bottleneck", QuestionCategory.team, "Who is the bottleneck?",
       priority=QuestionPriority.conditional, order=36, tags=["team"]),
    _q("team_key_person_risk", QuestionCategory.team, "What happens if the key person leaves?",
       priority=QuestionPriority.conditional, order=37, tags=["team"]),
    _q("individual_skills", QuestionCategory.team, "What skills do you already have?",
       order=38, tags=["individual", "capacity"]),
    _q("individual_missing_skills", QuestionCategory.team, "What skills are missing?",
       order=39, tags=["individual", "capacity"]),
    _q("individual_constraints", QuestionCategory.team, "What constraints could stop you?",
       order=40, tags=["individual", "capacity"]),
]

REVENUE_QUESTIONS: list[QuestionDefinition] = [
    _q("revenue_model", QuestionCategory.revenue, "How will this make money?", order=50, tags=["revenue"]),
    _q("revenue_who_pays", QuestionCategory.revenue, "Who pays?", order=51, tags=["revenue"]),
    _q("revenue_price", QuestionCategory.revenue, "How much will they pay?",
       qtype=QuestionType.currency, order=52, tags=["revenue"]),
    _q("revenue_frequency", QuestionCategory.revenue, "How often will they pay?", order=53, tags=["revenue"]),
    _q("revenue_paid_already", QuestionCategory.revenue, "Have they paid already?",
       qtype=QuestionType.boolean, order=54, tags=["revenue"]),
    _q("revenue_payment_proof", QuestionCategory.revenue, "What payment proof exists?", order=55, tags=["revenue", "evidence"]),
    _q("revenue_major_costs", QuestionCategory.revenue, "What are the major costs?", order=56, tags=["revenue"]),
    _q("revenue_first_revenue", QuestionCategory.revenue, "How long until first revenue?", order=57, tags=["revenue"]),
    _q("revenue_refusal_reason", QuestionCategory.revenue,
       "What would make the customer refuse to pay?", order=58, tags=["revenue"]),
]

EVIDENCE_QUESTIONS: list[QuestionDefinition] = [
    _q("evidence_problem_proof", QuestionCategory.evidence,
       "What proof do you already have that the problem exists?", order=60, tags=["evidence"]),
    _q("evidence_customer_interviews", QuestionCategory.evidence,
       "Have you spoken to potential customers?", qtype=QuestionType.boolean, order=61, tags=["evidence"]),
    _q("evidence_customer_proof", QuestionCategory.evidence,
       "What customer evidence do you have?", qtype=QuestionType.single_select,
       options=EVIDENCE_OPTIONS, order=62, tags=["evidence", "customer_evidence"]),
    _q("evidence_paid_committed", QuestionCategory.evidence,
       "Have people paid or committed money?", qtype=QuestionType.boolean, order=63, tags=["evidence"]),
    _q("evidence_transaction_data", QuestionCategory.evidence,
       "Do you have transaction data?", qtype=QuestionType.boolean, order=64, tags=["evidence"]),
    _q("evidence_other_proof", QuestionCategory.evidence,
       "Do you have waitlists, signups, LOIs, contracts, interviews, or observed behavior?",
       order=65, tags=["evidence"]),
    _q("evidence_falsification", QuestionCategory.evidence,
       "What evidence would prove this idea wrong?", order=66, tags=["evidence"]),
]

RISK_QUESTIONS: list[QuestionDefinition] = [
    _q("risk_blockers", QuestionCategory.risk, "What could stop this from working?", order=70, tags=["risk"]),
    _q("risk_legal_constraints", QuestionCategory.risk,
       "What legal or compliance issues may exist?", order=71, tags=["risk", "legal_constraints"]),
    _q("risk_competitor_response", QuestionCategory.risk,
       "What competitors could respond?", order=72, tags=["risk", "competitors"]),
    _q("risk_uncertain_assumptions", QuestionCategory.risk,
       "What assumptions are you least sure about?", order=73, tags=["risk"]),
    _q("risk_dependencies", QuestionCategory.risk,
       "What dependencies must be true?", order=74, tags=["risk"]),
    _q("risk_limits", QuestionCategory.risk,
       "What budget, time, or skill limits exist?", order=75, tags=["risk", "budget"]),
    _q("risk_stop_condition", QuestionCategory.risk,
       "What would force you to stop?", order=76, tags=["risk"]),
]

FOLLOW_UP_TEMPLATES: dict[str, QuestionDefinition] = {
    "followup_specific_segment": _q(
        "followup_specific_segment", QuestionCategory.follow_up,
        "Which specific customer segment feels the pain most urgently?",
        order=80, tags=["follow_up", "customer"],
    ),
    "followup_who_not_want": _q(
        "followup_who_not_want", QuestionCategory.follow_up,
        "Who would not want this?", order=81, tags=["follow_up"],
    ),
    "followup_demand_proof": _q(
        "followup_demand_proof", QuestionCategory.follow_up,
        "What proof shows this group wants the solution?", order=82, tags=["follow_up", "evidence"],
    ),
    "followup_cheapest_test": _q(
        "followup_cheapest_test", QuestionCategory.follow_up,
        "What is the cheapest test you can run in 7 days?", order=83, tags=["follow_up", "evidence"],
    ),
    "followup_kill_signal": _q(
        "followup_kill_signal", QuestionCategory.follow_up,
        "What result would kill the idea?", order=84, tags=["follow_up"],
    ),
    "followup_competitor_clarify": _q(
        "followup_competitor_clarify", QuestionCategory.follow_up,
        "What existing alternative do customers use today?", order=85, tags=["follow_up", "competitors"],
    ),
    "followup_timeline_deps": _q(
        "followup_timeline_deps", QuestionCategory.follow_up,
        "What dependencies are already resolved to launch this quickly?", order=86, tags=["follow_up", "timeline"],
    ),
    "followup_budget_unavoidable": _q(
        "followup_budget_unavoidable", QuestionCategory.follow_up,
        "Which costs are unavoidable even with a minimal budget?", order=87, tags=["follow_up", "budget"],
    ),
    "followup_start_country": _q(
        "followup_start_country", QuestionCategory.follow_up,
        "What country will you start in?", qtype=QuestionType.country,
        order=88, tags=["follow_up", "economy"],
    ),
}

ALL_BASE_CATALOG: list[QuestionDefinition] = (
    BASE_QUESTIONS + INDUSTRY_QUESTIONS + ECONOMY_QUESTIONS
    + TEAM_QUESTIONS + REVENUE_QUESTIONS + EVIDENCE_QUESTIONS + RISK_QUESTIONS
)

QUESTION_BY_ID: dict[str, QuestionDefinition] = {
    q.question_id: q for q in ALL_BASE_CATALOG
}
QUESTION_BY_ID.update(FOLLOW_UP_TEMPLATES)

REGULATED_INDUSTRIES = {
    "banking", "fintech", "insurance", "healthcare", "education", "legal",
    "security", "transportation", "real_estate", "food", "alcohol",
    "pharmaceuticals", "government_contracting", "childcare", "construction",
    "data_privacy", "ai_automation",
}

REVENUE_GOAL_TYPES = {
    "business", "startup", "side_income", "creator", "market_entry", "fundraising",
}

PLATFORM_KEYWORDS = {
    "linkedin", "tiktok", "youtube", "instagram", "upwork", "fiverr",
    "stripe", "shopify", "app store", "google play", "openai",
}
