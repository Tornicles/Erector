"""Prompt 4 Director intelligence routes.

Thin HTTP surface over the domain services: intent, plan, apply, commands,
reference analysis and the Studio surfaces. Authorization uses the same
workspace-membership dependencies as the rest of the application, and every
model-backed path goes through the provider orchestration contract.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor
from app.domain.analysis import AnalysisStatus, ReferenceRole
from app.domain.brief import IntelligentBrief, plan_questions
from app.domain.commands import DirectorCommandKind, route_command
from app.domain.creative import StoryPlan
from app.domain.director import EvidenceItem, ProductionIntent
from app.domain.requests import (
    AudioPlanUpdateRequest,
    ReferenceIdentityUpdateRequest,
    BriefUpdateRequest,
    SceneAudioDirectionUpdateRequest,
    CommandPreviewRequest,
    CommitPlanRequest,
    DecisionRequest,
    DialogueOperationRequest,
    DirectorCommandRequest,
    GeneratePlanRequest,
    ReferenceAnalysisRequest,
    StoryAlternativeRequest,
)
from app.domain.vocabulary import CollaborationMode, ProductionType
from app.dependencies.ai import get_ai_provider, get_frame_extractor
from app.services.ai.orchestration import OperationEnvelope, OperationScope, revision_guard
from app.services.director import reference_is_shaping_ready
from app.services.director_commands import execute_command, reference_role_assignments
from app.services.intelligence import generate_story, interpret_goal, provider_status, reference_analyzer
from app.services.media.storage import StorageMediaUnavailable, SupabaseMediaFetcher, decode_base64_payload
from app.services.plan_rebuild import rebuild_plan_from_rows
from app.services.reference import ReferencePreprocessRequest
from app.services.studio import (
    ProductionPlan,
    apply_payload,
    build_production_plan,
    deterministic_story_alternatives,
    plan_influence_summary,
    question_payload,
    studio_surface,
)
from app.services.studio_repository import StudioRepository

Envelope = Callable[..., dict[str, Any]]

REFERENCE_ROLE_VALUES = {role.value for role in ReferenceRole}

EvidenceKind = Literal['description', 'url', 'audio', 'video', 'image', 'asset', 'document', 'upload']
_EVIDENCE_KINDS: dict[str, EvidenceKind] = {
    'description': 'description', 'url': 'url', 'audio': 'audio', 'video': 'video',
    'image': 'image', 'asset': 'asset', 'document': 'document',
}


def _production_intent_from_row(production: dict[str, Any], goal: str, collaboration: CollaborationMode) -> ProductionIntent:
    try:
        primary_type = ProductionType(str(production.get('production_type') or ProductionType.custom.value))
    except ValueError:
        primary_type = ProductionType.custom
    return ProductionIntent(
        goal=goal[:10000] or str(production.get('title') or 'Untitled Production')[:10000],
        collaboration_mode=collaboration,
        primary_type=primary_type,
        runtime_ms=production.get('planned_duration_ms'),
    )


def register_director_intelligence_routes(application: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    def intent_from_context(context: dict[str, Any]) -> ProductionIntent | None:
        intake = context.get('intake')
        if not intake or not isinstance(intake.get('intent'), dict):
            return None
        try:
            return ProductionIntent.model_validate(intake['intent'])
        except ValidationError:
            logger.error('director_intake_intent_invalid', extra={'context': {'event': 'director_intake_intent_invalid'}})
            return None

    async def load_plan(context: dict[str, Any], intent: ProductionIntent) -> ProductionPlan:
        shaping_reference_ids = {str(reference['id']) for reference in context['shaping_references']}
        shaping_analyses = [analysis for reference_id, analysis in context['analyses'].items() if reference_id in shaping_reference_ids]
        return rebuild_plan_from_rows(
            intent=intent,
            brief_row=context['brief_row'],
            story_row=context['story_row'],
            scene_rows=context['scene_rows'],
            dialogue_rows=context['dialogue_rows'],
            reality_row=context['reality_row'],
            analyses=shaping_analyses,
            setup=context['setup'],
        )

    @application.get('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/provider')
    async def director_provider(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access)) -> Any:
        status = provider_status(get_ai_provider(request))
        status['ffmpeg_available'] = get_frame_extractor(request).available()
        status['ffmpeg_note'] = get_frame_extractor(request).reason()
        status['max_repair_attempts'] = config.director_max_repair_attempts
        return envelope(request, status)

    @application.get('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/studio')
    async def director_studio(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        context = await StudioRepository(gateway).intelligence_context(workspace_id, production_id, request.state.access_token)
        surfaces = studio_surface(
            production=context['production'], brief_row=context['brief_row'], story_row=context['story_row'],
            scene_rows=context['scene_rows'], dialogue_rows=context['dialogue_rows'], reality_row=context['reality_row'],
            references=context['references'], analyses_by_reference=context['analyses_by_reference'],
            findings_by_analysis=context['findings_by_analysis'], analyses=context['analyses'],
            shaping_analyses_by_reference=context['shaping_analyses_by_reference'],
            technique_rows=context['technique_rows'], decision_rows=context['decision_rows'],
            operation_rows=context['operation_rows'], setup=context['setup'],
            setup_used_for_reality=bool(context['reality_row']), document_rows=context['document_rows'],
        )
        surfaces['provider'] = provider_status(get_ai_provider(request))
        shaping_analyses = [context['analyses'][reference_id] for reference_id in context['shaping_analyses_by_reference']
            if reference_id in context['analyses']]
        surfaces['reference_roles'] = reference_role_assignments(shaping_analyses)
        return envelope(request, surfaces)

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/plan')
    async def director_plan(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = GeneratePlanRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the Director plan request and try again.', 422) from exc
        repository = StudioRepository(gateway)
        context = await repository.intelligence_context(workspace_id, production_id, request.state.access_token)
        provider = get_ai_provider(request)
        provider_info = provider_status(provider)
        intent = intent_from_context(context)
        if payload.goal and payload.goal.strip():
            known_context: dict[str, Any] = {
                'production_type': context['production']['production_type'],
                'runtime_ms': context['production']['planned_duration_ms'],
                'execution': context['production']['execution_method'],
                'answered_decisions': payload.answered_decisions or (intent.answered_decisions if intent else {}),
            }
            evidence: list[EvidenceItem] = []
            for reference in context['shaping_references']:
                source_type = str(reference.get('source_type') or 'upload')
                evidence_kind: EvidenceKind = _EVIDENCE_KINDS.get(source_type, 'upload')
                evidence.append(EvidenceItem(
                    kind=evidence_kind, access='available' if reference.get('media_id') else ('metadata_only' if source_type in {'url', 'social_url'} else 'available'),
                    source_id=reference['id'], label=(reference.get('source_identity') or reference.get('source_description') or reference.get('source_url') or 'Saved reference')[:500],
                ))
            operation_envelope = OperationEnvelope(
                workspace_id=workspace_id, production_id=production_id, scope_object_id=production_id,
                operation_type='intent_interpretation', scope=OperationScope.production,
                source_revision=int(context['production']['revision']),
                source_intake_revision=int(context['intake']['revision']) if context['intake'] else None,
                collaboration_mode=payload.collaboration_mode.value,
                model_profile=provider_info['model_profile'], reference_ids=[reference['id'] for reference in context['shaping_references'][:12]],
            )
            interpreted, intent_outcome = await interpret_goal(
                payload.goal, known_context=known_context, evidence=evidence, collaboration_mode=payload.collaboration_mode,
                provider=provider, envelope=operation_envelope, max_repair_attempts=config.director_max_repair_attempts,
            )
            intent = interpreted.intent
            await repository.record_operation(
                workspace_id, production_id, request.state.access_token, intent_outcome,
                source_revision=operation_envelope.source_revision, source_intake_revision=operation_envelope.source_intake_revision,
                collaboration_mode=payload.collaboration_mode.value,
            )
        if intent is None:
            raise AppError('DIRECTOR_INTENT_MISSING', 'validation', 'Describe what you want to make before planning.', 409)
        shaping_references = context['shaping_references']
        shaping_reference_ids = {str(reference['id']) for reference in shaping_references}
        analyses = [analysis for reference_id, analysis in context['analyses'].items() if reference_id in shaping_reference_ids]
        plan = build_production_plan(
            intent, analyses=analyses, setup=context['setup'], answered=payload.answered_decisions,
            variation=payload.variation, include_optional_questions=payload.include_optional_questions,
        )
        story_outcome = None
        if plan.bundle.story is not None and provider_info['configured']:
            story_envelope = OperationEnvelope(
                workspace_id=workspace_id, production_id=production_id, scope_object_id=production_id,
                operation_type='story_generation', scope=OperationScope.story,
                source_revision=int(context['production']['revision']), collaboration_mode=intent.collaboration_mode.value,
                model_profile=provider_info['model_profile'], reference_ids=[reference['id'] for reference in context['shaping_references'][:12]],
            )
            story, story_outcome = await generate_story(
                plan.brief, target_ms=plan.brief.runtime.planning_ms, analyses=analyses, provider=provider,
                envelope=story_envelope, deterministic_story=plan.bundle.story, variation=payload.variation,
                max_repair_attempts=config.director_max_repair_attempts,
            )
            if story is not None and story.producer == 'model':
                plan = build_production_plan(
                    intent, analyses=analyses, setup=context['setup'], answered=payload.answered_decisions,
                    variation=payload.variation, include_optional_questions=payload.include_optional_questions, producer='model',
                )
                plan.bundle = build_production_plan(
                    intent, analyses=analyses, setup=context['setup'], answered=payload.answered_decisions,
                    variation=payload.variation, producer='model',
                ).bundle.model_copy(update={'story': story})
                plan.bundle = plan.bundle.model_copy(update={'script': plan.bundle.script})
        if story_outcome is not None:
            await repository.record_operation(
                workspace_id, production_id, request.state.access_token, story_outcome,
                source_revision=story_outcome.source_revision, collaboration_mode=intent.collaboration_mode.value,
            )
        operation_id = payload.operation_id or uuid4()
        bundle = apply_payload(plan, operation={
            'provider': provider_info['provider'], 'model': provider_info['model_profile'],
            'model_profile': provider_info['model_profile'], 'rationale': plan.rationale,
            'limitations': plan.limitations, 'collaboration_mode': intent.collaboration_mode.value,
            'idempotency_key': f'plan:{production_id}:{operation_id}',
        })
        plan_outcome = await repository.rpc('record_director_operation', request.state.access_token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'operation_record': {
                'operation_id': str(operation_id), 'operation_type': 'production_plan', 'scope': 'production',
                'source_revision': int(context['production']['revision']),
                'source_intake_revision': int(context['intake']['revision']) if context['intake'] else None,
                'status': 'succeeded', 'producer': plan.producer, 'provider': provider_info['provider'],
                'model': provider_info['model_profile'], 'model_profile': provider_info['model_profile'],
                'attempts': 1, 'repaired': False, 'idempotency_key': f'plan:{production_id}:{operation_id}',
                'collaboration_mode': intent.collaboration_mode.value, 'rationale': plan.rationale,
                'limitations': plan.limitations,
                'payload': {'brief': bundle['brief'], 'story': bundle['story'], 'runtime_ms': bundle['production']['planned_duration_ms']},
            },
        })
        questions = plan_questions(
            intent, answered=payload.answered_decisions, analyses=analyses,
            include_optional=payload.include_optional_questions,
        )
        return envelope(request, {
            'operation': {'operation_id': str(operation_id), 'status': plan_outcome.get('status'), 'producer': plan.producer},
            'provider': provider_info,
            'intent': intent.model_dump(mode='json'),
            'questions': question_payload(questions),
            'brief': bundle['brief'],
            'story': bundle['story'],
            'script': bundle['script'],
            'scenes': bundle['scenes'],
            'characters': bundle['characters'],
            'environments': bundle['environments'],
            'products': bundle['products'],
            'style_bible': bundle['style_bible'],
            'reality': bundle['reality'],
            'runtime_fit': bundle['runtime_fit'],
            'producer': plan.producer,
            'rationale': plan.rationale,
            'limitations': plan.limitations,
            'reference_influence': plan_influence_summary(analyses),
            'bundle': bundle,
        })

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/commit')
    async def director_commit(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = CommitPlanRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the commit request and try again.', 422) from exc
        if not payload.explicit_confirmation:
            raise AppError('DIRECTOR_CONFIRMATION_REQUIRED', 'authorization', 'Confirm BUILD PRODUCTION to apply this Director plan.', 409)
        repository = StudioRepository(gateway)
        production = await repository.production(workspace_id, production_id, request.state.access_token)
        revision_guard(int(production['revision']), payload.expected_production_revision)
        result = await repository.apply_operation(
            workspace_id, production_id, request.state.access_token,
            operation_id=payload.operation_id, operation_type='apply_production_plan',
            bundle=payload.bundle, expected_revision=payload.expected_production_revision,
        )
        return envelope(request, result)

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/command')
    async def director_command(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = DirectorCommandRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Describe the direction you want.', 422) from exc
        repository = StudioRepository(gateway)
        context = await repository.intelligence_context(workspace_id, production_id, request.state.access_token)
        intent = intent_from_context(context) or _production_intent_from_row(
            context['production'], str(context['production'].get('title') or ''), CollaborationMode.stop_at_major_decisions,
        )
        plan = await load_plan(context, intent)
        command = route_command(payload.text, reference_count=len(context['shaping_references']))
        shaping_reference_ids = {str(reference['id']) for reference in context['shaping_references']}
        shaping_analyses = [analysis for reference_id, analysis in context['analyses'].items() if reference_id in shaping_reference_ids]
        outcome = execute_command(
            command, plan=plan, analyses=shaping_analyses, setup=context['setup'],
            selected_story=plan.bundle.story,
        )
        applied: dict[str, Any] | None = None
        if payload.apply and outcome.plan is not None and command.kind not in {
            DirectorCommandKind.reference_causal, DirectorCommandKind.story_alternatives, DirectorCommandKind.unresolved,
        }:
            expected = payload.expected_production_revision or int(context['production']['revision'])
            revision_guard(int(context['production']['revision']), expected)
            operation_id = payload.operation_id or uuid4()
            bundle = apply_payload(outcome.plan, operation={
                'rationale': outcome.rationale or command.rationale, 'limitations': outcome.limitations,
                'idempotency_key': f'command:{production_id}:{operation_id}',
                'collaboration_mode': intent.collaboration_mode.value,
            })
            applied = await repository.apply_operation(
                workspace_id, production_id, request.state.access_token,
                operation_id=operation_id, operation_type='director_command',
                bundle=bundle, expected_revision=expected,
            )
        return envelope(request, {
            'command': {
                'kind': command.kind.value, 'scope': command.scope.value, 'confidence': command.confidence,
                'rationale': command.rationale, 'operations': command.operations, 'signals': command.signals,
                'scene_order': command.scene_order, 'reference_role': command.reference_role,
                'target_runtime_ms': command.target_runtime_ms, 'parameters': command.parameters,
            },
            'rationale': outcome.rationale,
            'answer': outcome.answer,
            'changes': outcome.changes,
            'operations': outcome.operations,
            'limitations': outcome.limitations,
            'causal': [item.model_dump(mode='json') for item in outcome.causal],
            'story_alternatives': [story.model_dump(mode='json') for story in outcome.story_alternatives],
            'line_alternatives': outcome.line_alternatives,
            'reference_role': outcome.reference_role,
            'adaptations_applied': outcome.adaptations_applied,
            'plan': apply_payload(outcome.plan, operation={'rationale': outcome.rationale, 'limitations': outcome.limitations}) if outcome.plan else None,
            'producer': outcome.producer,
            'applied': applied,
        })

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/command/preview')
    async def director_command_preview(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = CommandPreviewRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Describe the direction you want.', 422) from exc
        context = await StudioRepository(gateway).intelligence_context(workspace_id, production_id, request.state.access_token)
        command = route_command(payload.text, reference_count=len(context['shaping_references']))
        return envelope(request, {
            'kind': command.kind.value, 'scope': command.scope.value, 'confidence': command.confidence,
            'rationale': command.rationale, 'operations': command.operations, 'signals': command.signals,
            'reference_role': command.reference_role, 'target_runtime_ms': command.target_runtime_ms,
            'scene_order': command.scene_order,
        })

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/reference/analyze')
    async def director_analyze_reference(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = ReferenceAnalysisRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the reference analysis request.', 422) from exc
        repository = StudioRepository(gateway)
        context = await repository.intelligence_context(workspace_id, production_id, request.state.access_token)
        reference_id = payload.reference_id
        if reference_id is None:
            created = await gateway.request('POST', '/rest/v1/production_references', token=request.state.access_token, schema=True,
                json={
                    'workspace_id': str(workspace_id), 'production_id': str(production_id),
                    'source_type': payload.source_type if payload.source_type else 'upload',
                    'media_id': str(payload.media_id) if payload.media_id else None,
                    'rights_classification': 'unknown',
                    'source_identity': payload.source_identity,
                    'source_provider': payload.source_provider,
                    'identity_provenance': 'unknown',
                    'source_identity_verified_at': None,
                    'creator_purpose': payload.creator_purpose,
                    'learning_targets': payload.learning_targets,
                }, prefer='return=representation')
            if not created:
                raise AppError('REFERENCE_NOT_CREATED', 'validation', 'The reference could not be recorded.', 409)
            reference_id = UUID(str(created[0]['id']))
            reference_record = created[0]
            if payload.source_identity_verified and payload.source_identity and payload.creator_purpose:
                reference_record = await gateway.rpc_detailed('reference_identity_save', token=request.state.access_token, json={
                    'target_workspace': str(workspace_id), 'target_production': str(production_id),
                    'target_reference': str(reference_id), 'expected_revision': int(created[0].get('revision', 1)),
                    'values_json': {
                        'source_identity': payload.source_identity, 'source_provider': payload.source_provider,
                        'source_identity_verified': True, 'creator_purpose': payload.creator_purpose,
                        'learning_targets': payload.learning_targets,
                    },
                }, layer='pre-Prompt 10 Reference identity')
        elif not any(str(reference.get('id')) == str(reference_id) for reference in context['references']):
            raise AppError('REFERENCE_NOT_FOUND', 'not_found', 'That reference does not belong to this Production.', 404)
        else:
            reference_record = next(reference for reference in context['references'] if str(reference.get('id')) == str(reference_id))
        if not reference_is_shaping_ready(reference_record):
            raise AppError('REFERENCE_IDENTITY_REQUIRED', 'validation', 'Complete and verify this Reference identity and creator purpose before TONDE analyses it.', 409)
        await repository.begin_reference_analysis(
            workspace_id, production_id, reference_id, request.state.access_token,
            identity_revision=int(reference_record['identity_revision']),
        )
        data: bytes | None = None
        if payload.data_base64:
            data = decode_base64_payload(payload.data_base64)
        elif payload.media_id:
            try:
                data, mime, filename = await SupabaseMediaFetcher(gateway).fetch(workspace_id, payload.media_id, request.state.access_token)
                payload = payload.model_copy(update={'mime': mime, 'filename': filename})
            except StorageMediaUnavailable as exc:
                await repository.claim_reference_analysis(
                    workspace_id, production_id, reference_id, request.state.access_token,
                    status='failed', stages=['queued'], progress=0, note=str(exc)[:600],
                )
                raise AppError('REFERENCE_MEDIA_UNAVAILABLE', 'unavailable', f'{exc} Nothing was analysed.', 503) from exc
        analyzer = reference_analyzer(
            get_ai_provider(request), get_frame_extractor(request),
            max_repair_attempts=config.director_max_repair_attempts,
        )
        preprocess_request = ReferencePreprocessRequest(
            source_type=payload.source_type, reference_id=reference_id, role=payload.role,
        )
        preprocess = await analyzer.preprocess(
            preprocess_request, data=data, mime=payload.mime, filename=payload.filename,
        )
        await repository.claim_reference_analysis(
            workspace_id, production_id, reference_id, request.state.access_token,
            status='analyzing', stages=['queued', 'preprocessing', 'analyzing'], progress=45,
            note='Running measured analysis and provider analysis.',
        )
        analysis_goal = payload.goal.strip() or f"Creator purpose: {reference_record.get('creator_purpose') or payload.creator_purpose or ''}. Learning targets: {', '.join(reference_record.get('learning_targets') or payload.learning_targets)}"
        analysis = await analyzer.analyze(
            preprocess_request, data=data, mime=payload.mime, filename=payload.filename, goal=analysis_goal[:2000],
            preprocessed=preprocess,
        )
        await repository.claim_reference_analysis(
            workspace_id, production_id, reference_id, request.state.access_token,
            status='synthesizing' if analysis.status == AnalysisStatus.complete else analysis.status.value,
            stages=[stage.value for stage in analysis.stages], progress=90 if analysis.status == AnalysisStatus.complete else 60,
            note='Synthesising findings, techniques and Style.',
        )
        saved = await repository.save_reference_analysis(
            workspace_id, production_id, reference_id, request.state.access_token, analysis,
            identity_revision=int(reference_record['identity_revision']),
        )
        operation_outcome = await repository.rpc('record_director_operation', request.state.access_token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'operation_record': {
                'operation_id': str(uuid4()), 'operation_type': 'reference_analysis', 'scope': 'reference',
                'source_revision': int(context['production']['revision']), 'status': analysis.status.value,
                'producer': analysis.producer, 'provider': provider_status(get_ai_provider(request))['provider'],
                'model': analysis.model_profile or provider_status(get_ai_provider(request))['model_profile'],
                'model_profile': provider_status(get_ai_provider(request))['model_profile'],
                'idempotency_key': f'reference:{reference_id}:{analysis.producer}:{len(analysis.findings)}:{len(analysis.techniques)}',
                'reference_ids': [str(reference_id)], 'rationale': analysis.summary,
                'limitations': analysis.limitations, 'payload': {'status': analysis.status.value, 'capability': analysis.capability.capability.value},
            },
        })
        return envelope(request, {
            'analysis_id': saved.get('analysis_id'), 'reference_id': str(reference_id), 'status': analysis.status.value,                'capability': analysis.capability.model_dump(mode='json'), 'summary': analysis.summary,
            'producer': analysis.producer, 'techniques': [technique.model_dump(mode='json') for technique in analysis.techniques],
            'findings': [finding.model_dump(mode='json') for finding in analysis.findings],
            'style': analysis.style.model_dump(mode='json'), 'causal': [item.model_dump(mode='json') for item in analysis.causal],
            'adaptation_notes': analysis.adaptation_notes, 'limitations': analysis.limitations,
            'stages': [stage.value for stage in analysis.stages], 'findings_saved': saved.get('findings'),
            'techniques_saved': saved.get('techniques'), 'operation': operation_outcome,
        })

    @application.get('/api/v1/workspaces/{workspace_id}/productions/{production_id}/audio')
    async def production_audio_surface(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        repository = StudioRepository(gateway)
        await repository.production(workspace_id, production_id, request.state.access_token)
        audio_plan = await repository.rpc('audio_plan_get', request.state.access_token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
        })
        scene_directions = await repository.rpc('scene_audio_directions_get', request.state.access_token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
        })
        if isinstance(audio_plan, dict) and 'result' in audio_plan:
            audio_plan = audio_plan['result']
        if isinstance(scene_directions, dict) and 'result' in scene_directions:
            scene_directions = scene_directions['result']
        return envelope(request, {'audio_plan': audio_plan, 'scene_directions': scene_directions or []})

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/references/{reference_id}')
    async def save_reference_identity(workspace_id: UUID, production_id: UUID, reference_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            reference_uuid = UUID(reference_id)
            expected_revision = body.get('expected_revision')
            values = {key: body[key] for key in (
                'source_identity','source_provider','source_identity_verified','creator_purpose','learning_targets'
            ) if key in body}
            payload = ReferenceIdentityUpdateRequest.model_validate({'expected_revision': expected_revision, **values})
        except (ValidationError, ValueError) as exc:
            raise AppError('INVALID_REFERENCE_IDENTITY', 'validation', 'Check the Reference identity, purpose and revision.', 422) from exc
        result = await gateway.rpc_detailed('reference_identity_save', token=request.state.access_token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_reference': str(reference_uuid),
            'expected_revision': payload.expected_revision,
            'values_json': payload.model_dump(exclude={'expected_revision'}, exclude_unset=True),
        }, layer='pre-Prompt 10 Reference identity')
        return envelope(request, result)

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/audio')
    async def save_production_audio_plan(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        try:
            payload = AudioPlanUpdateRequest.model_validate(await request.json())
        except ValidationError as exc:
            raise AppError('INVALID_AUDIO_PLAN', 'validation', 'Check the Audio Plan fields and revision.', 422) from exc
        values = payload.model_dump(exclude={'expected_revision'}, exclude_unset=True)
        result = await gateway.rpc_detailed('audio_plan_save', token=request.state.access_token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_revision': payload.expected_revision, 'values_json': values,
        }, layer='pre-Prompt 10 Audio Plan')
        return envelope(request, result)

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/audio/scenes/{scene_id}')
    async def save_scene_audio_direction(workspace_id: UUID, production_id: UUID, scene_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        try:
            payload = SceneAudioDirectionUpdateRequest.model_validate(await request.json())
        except ValidationError as exc:
            raise AppError('INVALID_SCENE_AUDIO_DIRECTION', 'validation', 'Check the Scene Music and Sound Direction fields and revision.', 422) from exc
        try:
            target_scene = UUID(scene_id)
        except ValueError as exc:
            raise AppError('INVALID_SCENE_AUDIO_DIRECTION', 'validation', 'That Scene identifier is invalid.', 422) from exc
        values = payload.model_dump(exclude={'expected_revision'}, exclude_unset=True)
        result = await gateway.rpc_detailed('scene_audio_direction_save', token=request.state.access_token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_scene': str(target_scene),
            'expected_revision': payload.expected_revision, 'values_json': values,
        }, layer='pre-Prompt 10 Audio Plan')
        return envelope(request, result)

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/brief')
    async def save_brief(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = BriefUpdateRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the Brief fields and revision.', 422) from exc
        try:
            brief = IntelligentBrief.model_validate(payload.brief)
        except ValidationError as exc:
            raise AppError('INVALID_BRIEF', 'validation', 'The Brief is missing required fields.', 422) from exc
        result = await StudioRepository(gateway).save_brief(
            workspace_id, production_id, request.state.access_token,
            expected_revision=payload.expected_brief_revision, brief=brief.model_dump(mode='json'), producer='deterministic',
            operation_id=None,
        )
        return envelope(request, {'brief': brief.model_dump(mode='json'), 'revision': result.get('revision'), 'producer': result.get('producer')})

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/decisions')
    async def record_decisions(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = DecisionRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the decisions you sent.', 422) from exc
        decisions = [
            {
                'decision_id': key[:80], 'question': str(payload.questions.get(key, ''))[:400],
                'answer': str(value)[:500], 'priority': 'high_impact', 'impact': 'high',
                'is_correction': payload.source == 'correction',
            }
            for key, value in payload.decisions.items()
        ]
        result = await StudioRepository(gateway).record_decisions(
            workspace_id, production_id, request.state.access_token, decisions, source=payload.source,
        )
        return envelope(request, {'stored': result.get('stored'), 'source': payload.source})

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/story/alternatives')
    async def story_alternatives(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = StoryAlternativeRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the alternatives request.', 422) from exc
        repository = StudioRepository(gateway)
        context = await repository.intelligence_context(workspace_id, production_id, request.state.access_token)
        intent = intent_from_context(context) or _production_intent_from_row(
            context['production'], str(context['production'].get('title') or ''), CollaborationMode.stop_at_major_decisions,
        )
        plan = await load_plan(context, intent)
        shaping_reference_ids = {str(reference['id']) for reference in context['shaping_references']}
        analyses = [analysis for reference_id, analysis in context['analyses'].items() if reference_id in shaping_reference_ids]
        alternatives: list[StoryPlan] = deterministic_story_alternatives(
            plan.brief, target_ms=plan.brief.runtime.planning_ms, analyses=analyses, count=payload.count,
        )
        if payload.variation:
            alternatives = [
                story for story in alternatives if story.variation == payload.variation
            ] or alternatives
        return envelope(request, {
            'selected_story': plan.bundle.story.model_dump(mode='json') if plan.bundle.story else None,
            'alternatives': [story.model_dump(mode='json') for story in alternatives],
            'note': 'Alternatives never overwrite the selected Story until you choose one.',
        })

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/dialogue/operation')
    async def dialogue_operation(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json()
        try:
            payload = DialogueOperationRequest.model_validate(body)
        except ValidationError as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the line operation.', 422) from exc
        repository = StudioRepository(gateway)
        context = await repository.intelligence_context(workspace_id, production_id, request.state.access_token)
        intent = intent_from_context(context) or _production_intent_from_row(
            context['production'], str(context['production'].get('title') or ''), CollaborationMode.stop_at_major_decisions,
        )
        plan = await load_plan(context, intent)
        command = route_command(f'Reword these lines: {payload.operation} dialogue lines shorter', reference_count=0)
        command = command.model_copy(update={'kind': DirectorCommandKind.dialogue_line_operation, 'line_operation': payload.operation})
        shaping_reference_ids = {str(reference['id']) for reference in context['shaping_references']}
        shaping_analyses = [analysis for reference_id, analysis in context['analyses'].items() if reference_id in shaping_reference_ids]
        outcome = execute_command(command, plan=plan, analyses=shaping_analyses, setup=context['setup'])
        return envelope(request, {
            'operation': payload.operation, 'answer': outcome.answer, 'limitations': outcome.limitations,
            'line_alternatives': outcome.line_alternatives,
            'plan': apply_payload(outcome.plan) if outcome.plan else None,
        })
