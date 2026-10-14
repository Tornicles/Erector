"""Production planning and Studio surface assembly.

Turns a Production intent (plus analysed references and the creator's real Setup)
into one coherent Master Production plan, and serializes that plan for the atomic
apply path. Nothing here contacts a model: model-backed producers are injected by
the API layer through the orchestration contract.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domain.analysis import (
    AnalysisStatus,
    CausalExplanation,
    CapabilityReport,
    EvidenceRef,
    EpistemicClass,
    Finding,
    QualitativeConfidence,
    ReferenceAnalysis,
    Technique,
)
from app.domain.brief import IntelligentBrief, MissingDecision, build_brief, plan_questions
from app.domain.creative import (
    CreativeBundle,
    RuntimeFit,
    ScenePlan,
    StoryPlan,
    build_creative_bundle,
)
from app.domain.director import ProductionIntent
from app.domain.reality import RealityReport, assess_full_reality
from app.domain.vocabulary import CollaborationMode, ProductionType
from app.services.reference import capability_report_from_reference


class StudioModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ProductionPlan(StudioModel):
    intent: ProductionIntent
    brief: IntelligentBrief
    bundle: CreativeBundle
    reality: RealityReport
    producer: Literal['deterministic', 'model'] = 'deterministic'
    rationale: str = Field(default='', max_length=1600)
    limitations: list[str] = Field(default_factory=list, max_length=12)


def build_production_plan(
    intent: ProductionIntent,
    *,
    analyses: list[ReferenceAnalysis] | None = None,
    setup: list[dict[str, Any]] | None = None,
    answered: dict[str, str] | None = None,
    variation: str = 'original',
    producer: Literal['deterministic', 'model'] = 'deterministic',
    include_optional_questions: bool = True,
) -> ProductionPlan:
    """One coherent Master Production plan: Brief, Story, Script, domain content, runtime, Reality Check."""

    analyses = analyses or []
    setup = setup or []
    answers = dict(answered or intent.answered_decisions or {})
    brief = build_brief(intent, analyses=analyses, setups=setup, answered=answers, include_optional=include_optional_questions)
    target_ms = brief.runtime.planning_ms
    bundle = build_creative_bundle(brief, target_ms=target_ms, analyses=analyses, variation=variation, producer=producer)
    reality = assess_full_reality(bundle, setup, brief, target_ms=target_ms)
    limitations: list[str] = []
    if brief.runtime.kind == 'range':
        limitations.append(f'The runtime target is a range ({brief.runtime.label()}); Scene durations use the midpoint for planning until one bound is chosen.')
    if brief.runtime.kind == 'approximate':
        limitations.append('The runtime target is approximate, so Scene durations are a planning allocation rather than a delivery guarantee.')
    if not setup:
        limitations.append('Setup lists no equipment, so Reality Check reports gaps rather than substitutions.')
    for analysis in analyses:
        if analysis.status in {AnalysisStatus.partial, AnalysisStatus.failed}:
            limitations.append(f'Reference analysis is {analysis.status.value}: {analysis.capability.note}')
    return ProductionPlan(
        intent=intent, brief=brief, bundle=bundle, reality=reality, producer=producer,
        rationale=plan_rationale(brief, bundle, reality), limitations=limitations,
    )


def plan_rationale(brief: IntelligentBrief, bundle: CreativeBundle, reality: RealityReport) -> str:
    """User-facing reasoning. Never hidden chain-of-thought."""

    parts: list[str] = []
    if bundle.story is not None:
        parts.append(
            f'I built {len(bundle.story.beats)} Story beats on the {bundle.story.grammar.replace("_", " ")} grammar'
            + (f' around {brief.product_brand}' if brief.product_brand else '')
            + '.'
        )
    if bundle.scenes and brief.runtime.planning_ms is not None:
        parts.append(
            f'Scene durations sum to exactly {brief.runtime.planning_ms} ms across {len(bundle.scenes)} Scenes'
            + (' with the opening Scene weighted heavier.' if len(bundle.scenes) > 1 else '.')
        )
    fit = bundle.runtime_fit
    if fit.status == 'over':
        parts.append('The Script currently exceeds the runtime target, so I flagged it before anything was applied.')
    elif fit.dialogue_ms:
        parts.append(f'Spoken lines and pauses estimate {fit.dialogue_ms} ms, leaving {max(0, fit.assigned_ms - fit.dialogue_ms)} ms for action.')
    if brief.call_to_action:
        parts.append(f'The closing beat carries the call to action: "{brief.call_to_action}".')
    if reality.gaps():
        domains = ', '.join(sorted({item.domain.value for item in reality.gaps()}))
        parts.append(f'Reality Check found gaps in {domains} and proposed {len(reality.adaptations)} adaptation(s) rather than inventing prices.')
    elif reality.mode is not None:
        parts.append(f'Reality Check recommends {reality.mode.method.value} execution.')
    quality_notes = [note for note in (reality.notes or []) if note]
    if quality_notes:
        parts.append(quality_notes[0])
    return ' '.join(parts)[:1600]


def scene_payload(scene: ScenePlan) -> dict[str, Any]:
    return {
        'order': scene.order,
        'title': scene.title,
        'purpose': scene.purpose,
        'story_beat': scene.story_beat,
        'description': ' '.join(scene.action)[:4000],
        'action_lines': scene.action[:16],
        'characters': scene.characters[:8],
        'environment': scene.environment,
        'products': scene.products[:6],
        'dialogue_notes': scene.dialogue_notes[:900],
        'duration_ms': scene.planned_duration_ms,
        'opening_state': scene.opening_state[:400],
        'ending_state': scene.ending_state[:400],
        'visual_intent': scene.visual_intent[:900],
        'techniques': scene.techniques[:6],
        'shots': [shot.model_dump(mode='json') for shot in scene.shots[:12]],
    }


def script_payload(bundle: CreativeBundle) -> dict[str, Any] | None:
    if bundle.script is None:
        return None
    return {
        'title': bundle.script.title,
        'dialogue_mode': bundle.script.dialogue_mode,
        'estimated_runtime_ms': bundle.script.estimated_runtime_ms,
        'producer': bundle.script.producer,
        'scenes': [
            {
                'scene_order': scene.scene_order,
                'scene_title': scene.scene_title,
                'heading': scene.heading,
                'action': scene.action[:16],
                'product_direction': scene.product_direction,
                'transition': scene.transition,
                'notes': scene.notes,
                'planned_duration_ms': scene.planned_duration_ms,
                'lines': [line.model_dump(mode='json') for line in scene.lines[:60]],
            }
            for scene in bundle.script.scenes[:40]
        ],
    }


def timed_scenes_without_target(bundle: Any) -> bool:
    """True when a bundle claims Scene durations while the Production has no runtime target.

    ``apply_director_operation`` refuses exactly that combination ('Scene durations require a
    Production runtime target'), and an untimed Scene therefore has to carry a null duration instead of
    claiming zero milliseconds (``apply_payload`` does that below). The database stays the authority;
    this only lets the API answer with the decision that is actually missing rather than forwarding a
    raw database refusal as an HTTP 503 the creator cannot act on.
    """

    if not isinstance(bundle, dict):
        return False
    scenes = bundle.get('scenes')
    if not isinstance(scenes, list) or not any(
        isinstance(scene, dict) and scene.get('duration_ms') is not None for scene in scenes
    ):
        return False
    production = bundle.get('production')
    target = production.get('planned_duration_ms') if isinstance(production, dict) else None
    return not is_runtime_target(target)


def is_runtime_target(value: Any) -> bool:
    """A runtime target is a positive integer count of milliseconds; nothing else counts."""

    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def apply_payload(
    plan: ProductionPlan,
    *,
    operation: dict[str, Any] | None = None,
    decisions: list[MissingDecision] | None = None,
    techniques: list[Technique] | None = None,
) -> dict[str, Any]:
    """The exact JSONB bundle consumed by apply_director_operation."""

    bundle = plan.bundle
    brief_json = plan.brief.model_dump(mode='json')
    decision_payload = [
        {
            'decision_id': item.id, 'question': item.question, 'answer': item.answer or '',
            'priority': item.priority, 'impact': item.impact,
            'decided_by': 'tonde' if item.answer == 'TONDE decides' else 'creator',
        }
        for item in (decisions if decisions is not None else plan.brief.open_decisions)
        if item.answer
    ]
    return {
        'production': {
            'title': bundle.title[:160],
            'production_type': plan.intent.primary_type.value,
            'execution_method': plan.brief.execution_preference,
            'planned_duration_ms': plan.brief.runtime.planning_ms if plan.brief.runtime.kind != 'none' else None,
        },
        'brief': brief_json,
        'story': bundle.story.model_dump(mode='json') if bundle.story else None,
        # An unresolved runtime target has no durations to fit, so every Scene is untimed: the bundle
        # sends duration_ms=null rather than claiming 0 ms (the Studio read
        # model shows 'untimed' with a runtime-fit status of 'unresolved').
        'scenes': (
            [scene_payload(scene) for scene in bundle.scenes[:40]]
            if plan.brief.runtime.planning_ms is not None
            else [{**scene_payload(scene), 'duration_ms': None} for scene in bundle.scenes[:40]]
        ),
        'script': script_payload(bundle),
        'characters': [character.model_dump(mode='json') for character in bundle.characters[:20]],
        'environments': [environment.model_dump(mode='json') for environment in bundle.environments[:20]],
        'products': [product.model_dump(mode='json') for product in bundle.products[:10]],
        'wardrobe_props': [item.model_dump(mode='json') for item in bundle.wardrobe_props[:20]],
        'style_bible': (
            {
                'title': bundle.style_bible.title,
                'summary': ' ; '.join(f'{section.section}: {section.description}' for section in bundle.style_bible.sections)[:10000],
                'sections': [section.model_dump(mode='json') for section in bundle.style_bible.sections],
                'producer': bundle.style_bible.producer,
            }
            if bundle.style_bible
            else None
        ),
        'reality': plan.reality.model_dump(mode='json'),
        'runtime_fit': bundle.runtime_fit.model_dump(mode='json'),
        'techniques': [technique.model_dump(mode='json') for technique in (techniques or [])][:40],
        'decisions': decision_payload,
        'producer': plan.producer,
        'operation': operation or {},
    }


def _capability_dict(report: CapabilityReport) -> dict[str, Any]:
    return {
        'capability': report.capability.value,
        'media_bytes': report.media_bytes.value,
        'modalities': report.modalities.model_dump(mode='json'),
        'note': report.note,
        'producer': report.producer,
    }

def reference_shaping_is_ready(reference: dict[str, Any], analysis: dict[str, Any] | None = None) -> bool:
    ready = (
        bool(str(reference.get('source_identity') or '').strip())
        and reference.get('identity_provenance') in {'source_metadata', 'creator_supplied'}
        and bool(reference.get('source_identity_verified_at'))
        and bool(str(reference.get('creator_purpose') or '').strip())
    )
    if not ready or analysis is None:
        return ready
    return (
        analysis.get('analyzed_at') is not None
        and analysis.get('identity_revision') is not None
        and analysis.get('identity_revision') == reference.get('identity_revision')
    )


def analyzed_reference_payload(
    reference: dict[str, Any], analysis: ReferenceAnalysis | None, findings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Studio reference surface. Capability and limitations are always visible."""

    capability = analysis.capability if analysis is not None else capability_report_from_reference(reference, analysis_status='not_started')
    payload: dict[str, Any] = {
        'reference_id': str(reference.get('id')),
        'source_type': reference.get('source_type'),
        'source_url': reference.get('source_url'),
        'source_description': (reference.get('source_description') or '')[:600],
        'source_identity': reference.get('source_identity'),
        'source_provider': reference.get('source_provider'),
        'identity_provenance': reference.get('identity_provenance') or 'unknown',
        'source_identity_verified_at': reference.get('source_identity_verified_at'),
        'creator_purpose': reference.get('creator_purpose'),
        'learning_targets': reference.get('learning_targets') or [],
        'revision': reference.get('revision', 1),
        'shaping_ready': bool(str(reference.get('source_identity') or '').strip())
            and reference.get('identity_provenance') in {'source_metadata', 'creator_supplied'}
            and bool(reference.get('source_identity_verified_at'))
            and bool(str(reference.get('creator_purpose') or '').strip()),
        'rights_classification': reference.get('rights_classification'),
        'state': reference.get('state'),
        'role': (analysis.role.value if analysis and reference_shaping_is_ready(reference) else 'style'),
        # Availability and saved-analysis status are reported only after shaping eligibility.
        'capability': _capability_dict(capability),
    'status': analysis.status.value if analysis and reference_shaping_is_ready(reference) else 'not_started',
    'stages': [stage.value for stage in analysis.stages] if analysis and reference_shaping_is_ready(reference) else [],
    'summary': analysis.summary if analysis and reference_shaping_is_ready(reference) else '',
        'producer': analysis.producer if analysis and reference_shaping_is_ready(reference) else 'deterministic',
        'producer_note': '',
        'findings': [],
        'techniques': [],
        'style': {},
        'causal': [],
        'adaptation_notes': analysis.adaptation_notes if analysis and reference_shaping_is_ready(reference) else [],
        'limitations': analysis.limitations if analysis and reference_shaping_is_ready(reference) else [],
        'analyzed_at': None,
    }
    if findings and reference_shaping_is_ready(reference):
        payload['findings'] = [
            {
                'finding_id': row.get('finding_id'),
                'category': row.get('category'),
                'statement': row.get('statement'),
                'epistemic': row.get('epistemic'),
                'confidence': row.get('confidence'),
                'evidence': [
                    {
                        'kind': item.get('kind'),
                        'start_ms': item.get('start_ms'),
                        'end_ms': item.get('end_ms'),
                        'frame_id': item.get('frame_id'),
                        'detail': item.get('detail'),
                    }
                    for item in (row.get('evidence') or [])
                ],
                'technique_id': row.get('technique_id'),
                'limitations': row.get('limitations') or [],
            }
            for row in findings
        ]
    if analysis is not None and reference_shaping_is_ready(reference):
        payload['techniques'] = [
            {
                'canonical_id': technique.canonical_id,
                'name': technique.name,
                'category': technique.category.value,
                'description': technique.description,
                'purpose': technique.purpose,
                'effect': technique.effect,
                'importance': technique.importance.value,
                'confidence': technique.confidence.value,
                'practical_concept': technique.practical_concept,
                'ai_concept': technique.ai_concept,
                'conditions': technique.conditions,
                'limitations': technique.limitations,
            }
            for technique in analysis.techniques
        ]
        payload['style'] = {
            'palette': analysis.style.palette,
            'sections': [
                {
                    'section': section.section, 'description': section.description,
                    'directives': section.directives, 'epistemic': section.epistemic.value,
                    'confidence': section.confidence.value,
                }
                for section in analysis.style.sections
            ],
        }
        payload['causal'] = [item.model_dump(mode='json') for item in analysis.causal]
    return payload


def studio_surface(
    *,
    production: dict[str, Any],
    brief_row: dict[str, Any] | None,
    story_row: dict[str, Any] | None,
    scene_rows: list[dict[str, Any]],
    dialogue_rows: list[dict[str, Any]],
    reality_row: dict[str, Any] | None,
    references: list[dict[str, Any]],
    analyses_by_reference: dict[str, dict[str, Any]],
    findings_by_analysis: dict[str, list[dict[str, Any]]],
    analyses: dict[str, ReferenceAnalysis],
    shaping_analyses_by_reference: dict[str, dict[str, Any]] | None = None,
    technique_rows: list[dict[str, Any]],
    decision_rows: list[dict[str, Any]],
    operation_rows: list[dict[str, Any]],
    setup: list[dict[str, Any]],
    setup_used_for_reality: bool,
    document_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Assemble the Brief / Reference / Story / Script / Reality Check Studio surfaces."""

    shaping_analysis_rows = shaping_analyses_by_reference if shaping_analyses_by_reference is not None else analyses_by_reference
    eligible_reference_ids = {
        str(reference.get('id')) for reference in references
        if reference_shaping_is_ready(reference, shaping_analysis_rows.get(str(reference.get('id'))))
    }
    current_techniques = {technique.canonical_id for reference_id, analysis in analyses.items()
                          if reference_id in eligible_reference_ids for technique in analysis.techniques}
    safe_technique_rows = [row for row in technique_rows
                          if row.get('technique_source') != 'reference' or row.get('canonical_id') in current_techniques]
    scene_payloads: list[dict[str, Any]] = []
    for row in scene_rows:
        detail = row.get('scene_detail') or {}
        scene_payloads.append({
            'id': str(row.get('id')),
            'order': detail.get('plan_order'),
            'title': row.get('title'),
            'purpose': row.get('purpose'),
            'story_beat': row.get('story_beat'),
            'description': row.get('description'),
            'action_lines': row.get('action_lines') or [],
            'characters': detail.get('characters') or [],
            'environment': detail.get('environment') or '',
            'products': detail.get('products') or [],
            'techniques': detail.get('techniques') or [],
            'shots': detail.get('shots') or [],
            'dialogue_notes': row.get('dialogue_notes'),
            'planned_duration_ms': row.get('planned_duration_ms'),
            'opening_state': row.get('opening_state'),
            'ending_state': row.get('ending_state'),
            'visual_intent': row.get('visual_intent'),
            'dialogue': [
                {
                    'id': str(line.get('id')),
                    'scene_id': str(line['scene_id']) if line.get('scene_id') else None,
                    'kind': line.get('line_type'),
                    'speaker': line.get('speaker'),
                    'content': line.get('content'),
                    'duration_ms': line.get('duration_ms'),
                    'intention': line.get('intention'),
                    'delivery': line.get('delivery'),
                    'subtext': line.get('subtext'),
                    'pause_after_ms': line.get('pause_after_ms'),
                    'flags': line.get('line_flags') or {},
                }
                for line in dialogue_rows if line.get('scene_id') == row.get('id')
            ],
        })
    assigned = [scene['planned_duration_ms'] or 0 for scene in scene_payloads]
    dialogue_ms = sum(
        (line.get('duration_ms') or 0) + (line.get('pause_after_ms') or 0) for line in dialogue_rows
    )
    target = production.get('planned_duration_ms')
    fit = RuntimeFit(
        target_ms=target, assigned_ms=sum(assigned), dialogue_ms=dialogue_ms,
        action_ms=max(0, sum(assigned) - dialogue_ms), slack_ms=(target - sum(assigned)) if target is not None else 0,
        status='fits' if target is not None and sum(assigned) == target else ('over' if target is not None and sum(assigned) > target else ('under' if target is not None else 'unresolved')),
    )
    return {
        'production': {
            'id': str(production.get('id')),
            'title': production.get('title'),
            'production_type': production.get('production_type'),
            'execution_method': production.get('execution_method'),
            'planned_duration_ms': target,
            'approval': production.get('approval'),
            'locked_at': production.get('locked_at'),
            'revision': production.get('revision'),
        },
        'brief': (brief_row or {}).get('brief'),
        'brief_revision': (brief_row or {}).get('revision'),
        'brief_producer': (brief_row or {}).get('producer'),
        'story': (story_row or {}).get('story'),
        'story_variation': (story_row or {}).get('variation'),
        'story_producer': (story_row or {}).get('producer'),
        'scenes': scene_payloads,
        # The readable record persisted by the apply operation: Brief, Story and Script text.
        'documents': {
            str(row.get('document_type')): {
                'document_id': (str(row.get('id')) if row.get('id') else None),
                'title': row.get('title'), 'content': row.get('content'),
                'revision': row.get('revision'), 'updated_at': row.get('updated_at'),
            }
            for row in (document_rows or [])
            if row.get('document_type')
        },
        'runtime_fit': fit.model_dump(mode='json'),
        'reality': (reality_row or {}).get('report'),
        'reality_source_revision': (reality_row or {}).get('revision'),
        'setup_listed': [str(item.get('name')) for item in setup if item.get('name')][:30],
        'reality_used_setup': setup_used_for_reality,
        'references': [
            analyzed_reference_payload(
                reference,
                analyses.get(str(reference.get('id'))) if str(reference.get('id')) in eligible_reference_ids else None,
                findings_by_analysis.get(str(shaping_analysis_rows[str(reference.get('id'))]['id']), [])
                if str(reference.get('id')) in shaping_analysis_rows else [],
            )
            for reference in references
        ],
        'techniques': [
            {
                'canonical_id': row.get('canonical_id'),
                'name': row.get('name'),
                'category': row.get('category'),
                'description': row.get('description'),
                'purpose': row.get('purpose'),
                'effect': row.get('effect'),
                'importance': row.get('importance'),
                'confidence': row.get('confidence'),
                'practical_concept': row.get('practical_concept'),
                'ai_concept': row.get('ai_concept'),
                'conditions': row.get('conditions') or [],
                'limitations': row.get('limitations') or [],
            }
            for row in safe_technique_rows
        ],
        'decisions': [
            {
                'decision_id': row.get('decision_id'), 'question': row.get('question'), 'answer': row.get('answer'),
                'priority': row.get('priority'), 'impact': row.get('impact'), 'decided_by': row.get('decided_by'),
                'is_correction': row.get('is_correction'), 'decision_source': row.get('decision_source'),
            }
            for row in decision_rows
        ],
        'operations': [
            {
                'operation_id': str(row.get('operation_id')), 'operation_type': row.get('operation_type'),
                'scope': row.get('scope'), 'status': row.get('status'), 'producer': row.get('producer'),
                'provider': row.get('provider'), 'model': row.get('model'), 'model_profile': row.get('model_profile'),
                'repaired': row.get('repaired'), 'attempts': row.get('attempts'), 'rationale': row.get('rationale'),
                'limitations': row.get('limitations') or [], 'schema_version': row.get('schema_version'),
                'source_revision': row.get('source_revision'), 'idempotency_key': row.get('idempotency_key'),
                'created_at': row.get('created_at'),
            }
            for row in operation_rows
        ],
    }


def deterministic_story_alternatives(
    brief: IntelligentBrief, *, target_ms: int | None, analyses: list[ReferenceAnalysis] | None = None, count: int = 3,
) -> list[StoryPlan]:
    """Alternatives never overwrite the selected Story."""

    variations = ['original', 'darker', 'funnier', 'simpler', 'more_emotional', 'more_commercial', 'more_practical']
    stories: list[StoryPlan] = []
    for index in range(max(1, min(count, 4))):
        variation = variations[index % len(variations)] if index else 'more_like_this'
        story = build_creative_bundle(
            brief, target_ms=target_ms, analyses=analyses, variation=variation, variant_index=index + 1,
        ).story
        if story is not None:
            stories.append(story)
    return stories


def question_payload(decisions: list[MissingDecision]) -> list[dict[str, Any]]:
    return [
        {
            'id': item.id, 'question': item.question, 'why': item.why, 'priority': item.priority, 'impact': item.impact,
            'confidence': item.confidence.value, 'depends_on': item.depends_on, 'options': item.options,
            'allow_tonde_decides': item.allow_tonde_decides, 'blocking': item.priority == 'blocking',
            'answered': item.answered, 'answer': item.answer, 'would_change': item.would_change,
        }
        for item in decisions
    ]


def merged_questions(
    intent: ProductionIntent, *, answered: dict[str, str], analyses: list[ReferenceAnalysis] | None, include_optional: bool,
) -> list[MissingDecision]:
    return plan_questions(intent, answered=answered, analyses=analyses, include_optional=include_optional)


def make_finding(
    *, finding_id: str, category: str, statement: str, epistemic: EpistemicClass,
    confidence: QualitativeConfidence, evidence: list[EvidenceRef] | None = None,
) -> Finding:
    from app.domain.analysis import FindingCategory
    return Finding(
        id=finding_id, category=FindingCategory(category), statement=statement, epistemic=epistemic,
        confidence=confidence, evidence=evidence or [],
    )


def causal_for_plan(analyses: list[ReferenceAnalysis]) -> list[CausalExplanation]:
    return [item for analysis in analyses for item in analysis.causal][:6]


def plan_influence_summary(analyses: list[ReferenceAnalysis]) -> list[str]:
    notes: list[str] = []
    for analysis in analyses:
        techniques = analysis.essential_techniques()
        if techniques:
            notes.append(f'{analysis.role.value}: using {", ".join(technique.name for technique in techniques[:3])} from this reference.')
        elif analysis.status != AnalysisStatus.complete:
            notes.append(f'{analysis.role.value}: analysis is {analysis.status.value}, so no craft was carried into the Story or Style.')
    return notes[:8]


def requires_creator_authority(production_type: ProductionType, collaboration_mode: CollaborationMode) -> bool:
    """Consequential application always needs artist authority; mode only changes question pressure."""

    if collaboration_mode == CollaborationMode.complete_first_draft:
        return True
    return production_type != ProductionType.custom


def reference_ids_from_rows(rows: list[dict[str, Any]]) -> list[UUID]:
    return [UUID(str(row['id'])) for row in rows if row.get('id')]
