"""Prompt 7 AI Creation & Hybrid Director HTTP surface.

Reads are workspace-member scoped. Every write goes through a guarded security-definer
RPC against an explicit revision, so membership, locks, approval state, capability truth,
idempotency and staleness are decided in the database rather than here.

The engine decides what to recommend; the database decides what is allowed. When they
disagree the database wins, because capability truth is a stored fact.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.ai import get_ai_provider
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor
from app.domain.ai_creation import (
    AiPlanRequest,
    AttemptRequest,
    AttemptUpdateRequest,
    BatchItemRequest,
    BatchRequest,
    ConnectionRequest,
    HybridOverrideRequest,
    LockRequest,
    ModelDeclarationRequest,
    ProviderPayloadError,
    attempt_payload,
    declaration_payload,
    plan_payload,
    reference_payloads,
    validate_provider_payload,
    verify_webhook_signature,
)
from app.services.ai_creation import (
    AiCreationRepository,
    HybridAdvisor,
    ModelProfile,
    ModelRouter,
    PromptCompiler,
    ShotContext,
    build_requirements,
    interpret_direction,
)
from app.services.intelligence import provider_status

Envelope = Any

FIDELITY_TYPES = ('critical', 'high', 'flexible')


def _validated(model: type[Any], body: Any, message: str) -> Any:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise AppError('INVALID_AI_INPUT', 'validation', message, 422) from exc


def _uuid(value: str, message: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise AppError('INVALID_AI_INPUT', 'validation', message, 422) from exc


def _fidelity(value: Any) -> Any:
    return value if isinstance(value, str) and value in FIDELITY_TYPES else 'flexible'


def _context_from(detail: dict[str, Any], surface: dict[str, Any], body: Any) -> ShotContext:
    """Everything the engine may use, taken from the same Master Production."""

    shot = detail.get('shot') or {}
    scene = detail.get('scene') or {}
    references = [
        {'reference_id': item.get('reference_id'), 'role': item.get('role'), 'priority': item.get('priority'),
         'asset_id': item.get('asset_id'), 'media_id': item.get('media_id'), 'origin': item.get('origin'),
         'note': item.get('note')}
        for item in (detail.get('references') or [])
    ]
    return ShotContext(
        shot=shot, scene=scene, production=surface.get('production') or {}, brief=detail.get('brief'),
        script_line=detail.get('script_line'), real_plan=detail.get('real_plan'),
        locks=detail.get('locks') or [], references=references,
        techniques=(detail.get('brief') or {}).get('techniques') or [],
        continuity_changes=[change.model_dump() for change in body.continuity_changes],
        audio_intent=body.audio or None, declared_negatives=list(body.negative_constraints),
        first_frame=body.first_frame, last_frame=body.last_frame,
        temporal_state=str(body.continuity.get('temporal_state') or ''),
        framing_relationship=str(body.continuity.get('framing_relationship') or ''),
        key_props=[str(item) for item in (body.continuity.get('key_props') or [])],
    )


def register_ai_creation_routes(application: FastAPI, config: Settings, logger: logging.Logger,
    envelope: Envelope) -> None:
    base = '/api/v1/workspaces/{workspace_id}/productions/{production_id}/ai'
    repository = AiCreationRepository

    @application.get(f'{base}/surface')
    async def ai_surface(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """The AI Creation read model for a whole Production, on the same Shots."""

        data = await repository(gateway).surface(workspace_id, production_id, request.state.access_token)
        data['provider'] = provider_status(get_ai_provider(request))
        data['live_generation'] = bool(data.get('capabilities', {}).get('live_generation'))
        data['truthfulness'] = ('Provider-neutral. TONDE knows no vendor capability it was not told, and reports '
            'COST UNKNOWN rather than a number it does not have.')
        return envelope(request, data)

    @application.get(f'{base}/shots/{{shot_id}}')
    async def ai_shot_detail(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """One Shot's AI plan, prompt, references, locks, Attempts and selected Result."""

        data = await repository(gateway).detail(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token)
        return envelope(request, data)

    @application.get(f'{base}/models')
    async def ai_models(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """What TONDE knows, what you declared, and what you are connected to."""

        return envelope(request, await repository(gateway).catalog(workspace_id, request.state.access_token))

    @application.post(f'{base}/models')
    async def declare_model(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Declare what one of your models can do. TONDE never guesses it for you."""

        body = _validated(ModelDeclarationRequest, await request.json(), 'Check the model capability fields.')
        result = await repository(gateway).declare_model(workspace_id, request.state.access_token,
            declaration_payload(body), body.expected_revision)
        logger.info('ai_model_declared', extra={'context': {'event': 'ai_model_declared',
            'workspace_id': str(workspace_id), 'provider': body.provider_key}})
        return envelope(request, result)

    @application.post(f'{base}/connections')
    async def set_connection(workspace_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record a provider connection state. A reference is stored, never a credential."""

        body = _validated(ConnectionRequest, await request.json(), 'Check the connection fields.')
        result = await repository(gateway).set_connection(workspace_id, request.state.access_token,
            body.provider_key, body.state, body.credential_reference, body.note, body.expected_revision)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/direct')
    async def direct_shot(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Answer 'how do I generate this Shot?' — requirements, model, prompt, advice."""

        body = _validated(AiPlanRequest, await request.json() or {}, 'Check the AI plan fields and revision.')
        target = _uuid(shot_id, 'That Shot identifier is invalid.')
        repo = repository(gateway)
        token = request.state.access_token
        detail = await repo.detail(workspace_id, production_id, target, token)
        shot = detail.get('shot') or {}
        if shot.get('locked'):
            raise AppError('SHOT_LOCKED', 'conflict',
                'That Shot is locked. Unlock it before the Director can change its AI plan.', 409)
        if shot.get('execution_method') == 'real':
            raise AppError('INVALID_AI_INPUT', 'validation',
                'This Shot is assigned to real capture, so it has no AI plan. Switch it to AI or Hybrid first.', 422)
        surface = await repo.surface(workspace_id, production_id, token)
        catalog = await repo.catalog(workspace_id, token)
        profiles = [ModelProfile.from_catalog(row) for row in (catalog.get('models') or [])]
        context = _context_from(detail, surface, body)
        identity = _fidelity((body.continuity or {}).get('identity_importance'))
        product = _fidelity((body.continuity or {}).get('product_importance'))
        # The creator's own direction is honoured where TONDE can actually change the plan (§71).
        intent = interpret_direction(body.text)
        if intent.identity_critical:
            identity = 'critical'
        if intent.product_visible:
            product = 'critical'
        requirements = build_requirements(context, operation=intent.operation
            or body.continuity.get('operation') or None,
            product_importance=product, identity_importance=identity)
        routing = ModelRouter().route(requirements, profiles,
            {'only_connected': bool((body.routing or {}).get('only_connected')) or intent.only_connected,
             'prefer_lower_cost': intent.prefer_lower_cost})
        chosen = _resolve_profile(body, routing, profiles)
        # The declared model profile carries its own prompt format; a per-plan note may override it.
        notes = {**(chosen.capability_notes if chosen is not None else {}),
            **((body.routing or {}).get('capability_notes') or {})}
        compiled = PromptCompiler().compile(context, requirements, chosen,
            capability_notes=notes, audio_intent=body.audio or None,
            simplify_motion=intent.simplify_motion)
        hybrid = HybridAdvisor().advise(context, requirements, routing,
            setup=surface.get('setup') if isinstance(surface.get('setup'), dict) else
                {'resources': surface.get('setup') or []},
            environment_achievable=(body.hybrid or {}).get('environment_achievable'),
            product_reflective=bool((body.hybrid or {}).get('product_reflective')),
            creator_choice=(body.hybrid or {}).get('creator_choice'))
        answer = _answer(compiled, routing, hybrid, requirements, intent=intent)
        payload = _plan_body(body, chosen, routing, compiled, hybrid, requirements,
            shot=shot, aspect_ratio=compiled.aspect_ratio, intent=intent)
        if not body.hybrid.get('apply', False) and not body.continuity.get('apply', False):
            return envelope(request, {'applied': None, 'answer': answer, 'plan': payload,
                'requirements': _requirements_body(requirements), 'routing': _routing_body(routing),
                'hybrid': _hybrid_body(hybrid), 'references': reference_payloads(body),
                'scope': 'shot', 'shot_id': str(target)})
        saved = await repo.save_plan(workspace_id, production_id, target, token, plan=payload,
            references=reference_payloads(body), expected_shot_revision=body.expected_shot_revision,
            expected_plan_revision=body.expected_plan_revision)
        logger.info('ai_plan_applied', extra={'context': {'event': 'ai_plan_applied',
            'production_id': str(production_id), 'shot_id': str(target)}})
        return envelope(request, {'applied': saved, 'answer': answer, 'plan': payload,
            'requirements': _requirements_body(requirements), 'routing': _routing_body(routing),
            'hybrid': _hybrid_body(hybrid), 'references': reference_payloads(body),
            'scope': 'shot', 'shot_id': str(target)})

    @application.post(f'{base}/shots/{{shot_id}}/plan')
    async def save_plan(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(AiPlanRequest, await request.json(), 'Check the AI plan fields and revision.')
        result = await repository(gateway).save_plan(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token,
            plan=plan_payload(body), references=reference_payloads(body),
            expected_shot_revision=body.expected_shot_revision,
            expected_plan_revision=body.expected_plan_revision)
        logger.info('ai_plan_saved', extra={'context': {'event': 'ai_plan_saved',
            'production_id': str(production_id), 'shot_id': str(shot_id)}})
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/plan/approval')
    async def set_plan_approval(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json() or {}
        approval = body.get('approval')
        if approval not in ('draft', 'needs_review', 'approved'):
            raise AppError('INVALID_AI_INPUT', 'validation', 'That approval state is not valid.', 422)
        result = await repository(gateway).set_plan_approval(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, approval,
            body.get('expected_revision'))
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/plan/lock')
    async def set_plan_lock(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json() or {}
        if not isinstance(body.get('locked'), bool):
            raise AppError('INVALID_AI_INPUT', 'validation', 'Check the lock state.', 422)
        result = await repository(gateway).set_plan_lock(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body['locked'],
            body.get('expected_revision'))
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/cost/confirm')
    async def confirm_cost(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = await request.json() or {}
        result = await repository(gateway).confirm_cost(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token,
            str(body.get('note') or '')[:400])
        return envelope(request, result)

    @application.post(f'{base}/locks')
    async def set_lock(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Lock what must stay true across Shots, and say what may vary."""

        body = _validated(LockRequest, await request.json(), 'Check the continuity lock fields.')
        payload = body.model_dump()
        expected = payload.pop('expected_revision', None)
        result = await repository(gateway).set_lock(workspace_id, production_id, request.state.access_token,
            payload, expected)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/attempts')
    async def create_attempt(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(AttemptRequest, await request.json(), 'Check the generation request.')
        result = await repository(gateway).create_attempt(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, attempt_payload(body))
        logger.info('ai_attempt_created', extra={'context': {'event': 'ai_attempt_created',
            'production_id': str(production_id), 'shot_id': str(shot_id), 'idempotent': result.get('idempotent')}})
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/attempts/{{attempt_id}}')
    async def update_attempt(workspace_id: UUID, production_id: UUID, shot_id: str, attempt_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(AttemptUpdateRequest, await request.json(), 'Check the attempt update fields.')
        payload = {key: value for key, value in body.model_dump().items() if value is not None}
        result = await repository(gateway).update_attempt(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'),
            _uuid(attempt_id, 'That attempt identifier is invalid.'), request.state.access_token, payload)
        return envelope(request, result)

    @application.post(f'{base}/shots/{{shot_id}}/results/{{attempt_id}}/select')
    async def select_result(workspace_id: UUID, production_id: UUID, shot_id: str, attempt_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Choose the current output. This is not a Shot approval."""

        result = await repository(gateway).select_result(workspace_id, production_id,
            _uuid(shot_id, 'That Shot identifier is invalid.'),
            _uuid(attempt_id, 'That attempt identifier is invalid.'), request.state.access_token)
        return envelope(request, result)

    @application.post(f'{base}/batches/preview')
    async def batch_preview(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(BatchRequest, await request.json() or {}, 'Check the batch scope.')
        result = await repository(gateway).batch_preview(workspace_id, production_id,
            _uuid(body.shot_id, 'That Shot identifier is invalid.') if body.shot_id
            else UUID(int=0), request.state.access_token, _batch_payload(body))
        return envelope(request, result)

    @application.post(f'{base}/batches')
    async def create_batch(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        body = _validated(BatchRequest, await request.json(), 'Check the batch scope and confirmation.')
        result = await repository(gateway).create_batch(workspace_id, production_id,
            _uuid(body.shot_id, 'That Shot identifier is invalid.') if body.shot_id
            else UUID(int=0), request.state.access_token, _batch_payload(body))
        logger.info('ai_batch_created', extra={'context': {'event': 'ai_batch_created',
            'production_id': str(production_id), 'scope': body.scope}})
        return envelope(request, result)

    @application.post(f'{base}/batches/{{batch_id}}/shots/{{shot_id}}')
    async def record_batch_item(workspace_id: UUID, production_id: UUID, batch_id: str, shot_id: str,
        request: Request, user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Record one Shot's progress, so eight of ten successes are never thrown away."""

        body = _validated(BatchItemRequest, await request.json(), 'Check the batch item state.')
        result = await repository(gateway).record_batch_item(workspace_id, production_id,
            _uuid(batch_id, 'That batch identifier is invalid.'),
            _uuid(shot_id, 'That Shot identifier is invalid.'), request.state.access_token, body.model_dump())
        return envelope(request, result)

    @application.post(f'{base}/callbacks/{{provider_key}}')
    async def provider_callback(workspace_id: UUID, production_id: UUID, provider_key: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """Provider-neutral completion report. A payload is validated before it is believed.

        TONDE verifies the callback signature when this deployment is configured with a
        secret for that provider. Without one, the payload is validated and reported but
        never applied, because an unverified callback is not evidence.
        """

        raw = await request.body()
        provided = request.headers.get('x-tonde-signature', '')
        expected = _expected_signature(config, provider_key, raw)
        verified = verify_webhook_signature(provided, expected) if expected else False
        try:
            payload = validate_provider_payload(await request.json())
        except ProviderPayloadError as exc:
            raise AppError('AI_PROVIDER_PAYLOAD_INVALID', 'validation', str(exc), 422) from exc
        except Exception as exc:  # malformed JSON from an external caller
            raise AppError('AI_PROVIDER_PAYLOAD_INVALID', 'validation',
                'A provider callback must carry a JSON body.', 422) from exc
        if not verified:
            return envelope(request, {'provider_key': provider_key, 'accepted': False, 'applied': None,
                'signature_verified': False,
                'reason': ('No callback secret is configured for this provider, so TONDE will not apply an '
                    'unverified callback. Poll the provider or record the Attempt update explicitly.')})
        job_status = payload.get('status')
        attempt_id = payload.get('attempt_id')
        if not attempt_id:
            return envelope(request, {'provider_key': provider_key, 'accepted': False, 'applied': None,
                'signature_verified': True, 'job_id': payload.get('job_id'),
                'reason': 'The callback did not identify the Attempt it belongs to.'})
        update: dict[str, Any] = {'status': job_status}
        if payload.get('job_id'):
            update['external_job_id'] = payload['job_id']
        output = payload.get('output') or {}
        if output.get('media_id'):
            update['output_media_id'] = output['media_id']
        if payload.get('failure_code'):
            update['failure_code'] = payload['failure_code']
        if payload.get('failure_message'):
            update['failure_message'] = payload['failure_message']
        result = await repository(gateway).update_attempt(workspace_id, production_id,
            UUID(int=0), _uuid(str(attempt_id), 'The callback named an invalid Attempt.'),
            request.state.access_token, {key: value for key, value in update.items() if value is not None})
        return envelope(request, {'provider_key': provider_key, 'accepted': True, 'applied': result,
            'signature_verified': True})

    @application.post(f'{base}/shots/{{shot_id}}/hybrid')
    async def hybrid_decision(workspace_id: UUID, production_id: UUID, shot_id: str, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)) -> Any:
        """SHOOT / GENERATE / SHOOT + AI, advisory, with the creator's word final."""

        body = _validated(HybridOverrideRequest, await request.json(), 'Check the execution method.')
        target = _uuid(shot_id, 'That Shot identifier is invalid.')
        repo = repository(gateway)
        token = request.state.access_token
        detail = await repo.detail(workspace_id, production_id, target, token)
        surface = await repo.surface(workspace_id, production_id, token)
        catalog = await repo.catalog(workspace_id, token)
        profiles = [ModelProfile.from_catalog(row) for row in (catalog.get('models') or [])]
        context = ShotContext(shot=detail.get('shot') or {}, scene=detail.get('scene') or {},
            production=surface.get('production') or {}, locks=detail.get('locks') or [],
            references=detail.get('references') or [])
        requirements = build_requirements(context)
        routing = ModelRouter().route(requirements, profiles)
        rationale = None
        if body.reason:
            # The creator's reason is recorded with the override, so Prompt 9 can judge the plan.
            rationale = body.reason
        decision = HybridAdvisor().advise(context, requirements, routing,
            setup={'resources': surface.get('setup') or []},
            creator_choice=_method_for(body.execution_method))
        current_method = str((detail.get('shot') or {}).get('execution_method') or '')
        stored: Any = None
        already = False
        if body.execution_method == current_method:
            already = True
        elif body.expected_shot_revision is None:
            stored = None
        else:
            # The creator's choice is written to the same canonical Shot through the Studio guard,
            # so the timeline shows SHOOT / GENERATE / SHOOT + AI without a second Shot existing.
            stored = await repo.switch_execution_method(workspace_id, production_id, target, token,
                method=body.execution_method, expected_revision=body.expected_shot_revision)
            logger.info('ai_execution_method_switched', extra={'context': {'event': 'ai_execution_method_switched',
                'production_id': str(production_id), 'shot_id': str(target), 'method': body.execution_method}})
        note = ('This Shot already has that execution method.' if already else (
            'Recorded on the same Shot. The Production and Shot identifiers are unchanged.' if stored is not None
            else 'Pass the Shot revision to record this method on the Shot; advice alone changes nothing.'))
        return envelope(request, {'advisory': True, 'recommended': _hybrid_body(decision),
            'creator_choice': body.execution_method, 'creator_reason': rationale,
            'override_recorded': stored, 'already': already, 'note': note,
            'shot_id': str(target),
            'truthfulness': 'TONDE advises; you decide. A warning is not a refusal.'})


def _method_for(method: str) -> str | None:
    mapping = {'shoot': 'shoot', 'generate': 'generate', 'hybrid': 'hybrid'}
    return mapping.get(method)


def _expected_signature(config: Settings, provider_key: str, raw: bytes) -> str:
    """The signature TONDE expects for this provider, or '' when this deployment cannot verify."""

    secrets = config.ai_callback_secrets or {}
    entry = secrets.get(provider_key)
    value = entry.get_secret_value() if entry is not None else ''
    if not value:
        return ''
    import hashlib
    import hmac

    return hmac.new(value.encode('utf-8'), raw, hashlib.sha256).hexdigest()


def _resolve_profile(body: AiPlanRequest, routing: Any, profiles: list[ModelProfile]) -> ModelProfile | None:
    wanted = body.model_profile_id
    if not wanted and body.routing.get('model_profile_id'):
        wanted = str(body.routing['model_profile_id'])
    if wanted:
        for profile in profiles:
            if profile.model_profile_id == wanted:
                return profile
        raise AppError('INVALID_AI_INPUT', 'validation',
            'That model is not declared for this workspace. Declare it in Setup first.', 422)
    if body.routing.get('use_recommendation') is False:
        return None
    return _profile_for(routing, profiles)


def _profile_for(routing: Any, profiles: list[ModelProfile]) -> ModelProfile | None:
    """Resolve the router's choice back onto the declared profile the engine compiled against."""

    choice = routing.recommended
    if choice is None or not choice.model_profile_id:
        return None
    for profile in profiles:
        if profile.model_profile_id == choice.model_profile_id:
            return profile
    return None


def _requirements_body(requirements: Any) -> dict[str, Any]:
    return {
        'operation': requirements.operation, 'reference_count': requirements.reference_count,
        'must_reference_count': requirements.must_reference_count,
        'needs_first_frame': requirements.needs_first_frame, 'needs_last_frame': requirements.needs_last_frame,
        'needs_audio': requirements.needs_audio, 'needs_camera_control': requirements.needs_camera_control,
        'needs_negative_prompt': requirements.needs_negative_prompt,
        'duration_ms': requirements.duration_ms, 'aspect_ratio': requirements.aspect_ratio,
        'identity_importance': requirements.identity_importance,
        'product_importance': requirements.product_importance,
        'motion_complexity': requirements.motion_complexity,
    }


def _routing_body(routing: Any) -> dict[str, Any]:
    def choice(item: Any) -> dict[str, Any] | None:
        if item is None:
            return None
        return {'kind': item.kind, 'model_profile_id': item.model_profile_id, 'provider_key': item.provider_key,
            'model_key': item.model_key, 'label': item.label, 'reason': item.reason,
            'cost_state': item.cost_state, 'cost_amount': item.cost_amount, 'cost_currency': item.cost_currency}

    return {
        'recommended': choice(routing.recommended), 'fallback': choice(routing.fallback),
        'alternatives': [choice(item) for item in routing.alternatives],
        'excluded': list(routing.excluded), 'reasoning': list(routing.reasoning),
        'manual_export': choice(routing.manual_export), 'connection_required': routing.connection_required,
    }


def _hybrid_body(decision: Any) -> dict[str, Any]:
    return {'method': decision.method, 'reasons': list(decision.reasons),
        'shoot_component': decision.shoot_component, 'generate_component': decision.generate_component,
        'combine': list(decision.combine), 'matching': list(decision.matching),
        'limitations': list(decision.limitations), 'plate_requirements': list(decision.plate_requirements),
        'factors': decision.factors, 'advisory': True}


def _answer(compiled: Any, routing: Any, hybrid: Any, requirements: Any, intent: Any = None) -> dict[str, Any]:
    """The concise, explainable answer the creator actually reads (§17)."""

    recommended = routing.recommended
    return {
        'direction_applied': list(getattr(intent, 'applied', ()) or ()),
        'direction_note': getattr(intent, 'note', '') or '',
        'summary': (f"{compiled.sections.get('CAMERA', 'the planned camera')} on "
            f"{compiled.sections.get('SUBJECT', 'the subject')}. "
            f"{len(compiled.sections)} prompt sections, "
            f"{'provider prompt compiled' if compiled.provider_prompt else 'no provider prompt yet'}."),
        'why': ' '.join(routing.reasoning),
        'model': None if recommended is None else {
            'provider_key': recommended.provider_key, 'model_key': recommended.model_key,
            'label': recommended.label, 'reason': recommended.reason,
            'cost_state': recommended.cost_state, 'cost_amount': recommended.cost_amount,
            'cost_currency': recommended.cost_currency},
        'method': hybrid.method, 'method_reasons': list(hybrid.reasons),
        'needs_reference': requirements.must_reference_count > 0,
        'limitations': list(compiled.limitations) + list(hybrid.limitations),
        'truthfulness': ('Identity is preserved as closely as the selected model supports; TONDE never promises '
            'exact identity reproduction.'),
    }


def _plan_body(body: AiPlanRequest, profile: ModelProfile | None, routing: Any, compiled: Any, hybrid: Any,
    requirements: Any, *, shot: dict[str, Any], aspect_ratio: str, intent: Any = None) -> dict[str, Any]:
    choice = routing.recommended
    payload = plan_payload(body)
    payload.update({
        'provider_target': (body.provider_target or (choice.provider_key if choice else None)),
        'model_profile_id': body.model_profile_id or (choice.model_profile_id if choice else None),
        'fallback_model_profile_id': body.fallback_model_profile_id
            or (routing.fallback.model_profile_id if routing.fallback else None),
        'model_key': body.model_key or (choice.model_key if choice else ''),
        'canonical_prompt': body.canonical_prompt or compiled.sections,
        'provider_prompt': body.provider_prompt or compiled.provider_prompt,
        'routing': {**body.routing, **_routing_body(routing), 'format': compiled.provider_format},
        'first_frame': body.first_frame or compiled.first_frame,
        'last_frame': body.last_frame or compiled.last_frame,
        'motion': body.motion or compiled.motion,
        'audio': body.audio or compiled.audio,
        'continuity': {**(body.continuity or {}), **compiled.continuity,
            'creator_direction': body.text, 'direction_applied': list(getattr(intent, 'applied', ()) or ())},
        'hybrid': {**(body.hybrid or {}), **_hybrid_body(hybrid)},
        'negative_constraints': body.negative_constraints or list(compiled.negative),
        'limitations': body.limitations or list(compiled.limitations) + list(hybrid.limitations),
        'aspect_ratio': aspect_ratio or body.aspect_ratio,
        'expected_duration_ms': body.expected_duration_ms if body.expected_duration_ms is not None
            else shot.get('planned_duration_ms'),
        'source_versions': body.source_versions or compiled.source_versions,
        # A plan is only 'ready' when a model was actually resolved for it. No model — whether
        # because none was declared or because the one you own is not connected — needs a decision.
        'plan_status': body.plan_status if body.plan_status != 'draft' else (
            'ready' if profile is not None else 'needs_decision'),
    })
    if profile is not None and profile.cost_known and payload.get('cost_currency') in (None, ''):
        payload['cost_amount'] = profile.cost_amount
        payload['cost_currency'] = profile.cost_currency
        payload['cost_note'] = payload.get('cost_note') or f'From the pricing you declared for {profile.label or profile.model_key}.'
    return payload


def _batch_payload(body: BatchRequest) -> dict[str, Any]:
    payload: dict[str, Any] = {'scope': body.scope, 'confirmed': body.confirmed, 'note': body.note}
    if body.scene_id:
        payload['scene_id'] = body.scene_id
    if body.shot_id:
        payload['shot_id'] = body.shot_id
    if body.shot_ids:
        payload['shot_ids'] = body.shot_ids
    return payload
