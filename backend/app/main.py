import logging
import time
from contextlib import asynccontextmanager
from typing import Literal
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.core.config import Settings, get_settings
from app.core.cors import setup_cors
from app.core.errors import AppError
from app.core.logging import setup_logging
from app.db.client import SupabaseGateway
from app.domain.director import ApplyPlanRequest, EvidenceItem, InterpretRequest, ProductionDraft, ProductionIntent, ProposePlanRequest, SaveIntakeRequest
from app.dependencies.auth import CurrentUser, get_current_user, get_gateway, require_workspace_access, require_workspace_editor
from app.services.director import DirectorRepository, draft_and_check, interpret, reference_capability
from app.services.ai.provider import DirectorModelProvider, build_provider
from app.services.media.frames import FrameExtractor, build_frame_extractor
from app.middleware.request_id import RequestIDMiddleware
from app.routers.director_intelligence import register_director_intelligence_routes



def create_app(
    settings: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    ai_provider: DirectorModelProvider | None = None,
    frame_extractor: FrameExtractor | None = None,
) -> FastAPI:
    config = settings or get_settings()
    setup_logging(config.log_level)
    logger = logging.getLogger('tonde.api')

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        provider = ai_provider or build_provider(config)
        application.state.ai_provider = provider
        application.state.frame_extractor = frame_extractor or build_frame_extractor(config.ffmpeg_path)
        async with httpx.AsyncClient(timeout=10, transport=transport, follow_redirects=False) as client:
            application.state.gateway = SupabaseGateway(config, client)
            logger.info('startup', extra={'context': {'event': 'application_started'}})
            yield
        close = getattr(provider, 'aclose', None)
        if callable(close):
            await close()

    application = FastAPI(title='TONDE Services', version=config.app_version, lifespan=lifespan,
        docs_url='/api/docs' if config.app_env != 'production' else None,
        openapi_url='/api/openapi.json' if config.app_env != 'production' else None, redoc_url=None)
    setup_cors(application, config.cors_origins_list)
    application.add_middleware(RequestIDMiddleware)

    def envelope(request: Request, data: Any = None, error: AppError | None = None) -> dict[str, Any]:
        return {'success': error is None, 'data': data if error is None else None,
            'errors': None if error is None else [{'code': error.code, 'type': error.kind, 'message': error.user_message}],
            'metadata': {'request_id': getattr(request.state, 'request_id', str(uuid4())), 'timestamp': datetime.now(timezone.utc).isoformat(), 'version': config.app_version}}

    @application.middleware('http')
    async def request_metrics(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        elapsed = round((time.perf_counter() - started) * 1000)
        response.headers['X-Process-Time-Ms'] = str(elapsed)
        logger.info('request', extra={'context': {'event': 'http_request', 'request_id': getattr(request.state, 'request_id', None), 'method': request.method, 'status': response.status_code, 'elapsed_ms': elapsed}})
        return response

    @application.exception_handler(AppError)
    async def application_error(request: Request, exc: AppError):
        logger.warning('application_error', extra={'context': {'event': 'application_error', 'error_code': exc.code, 'request_id': getattr(request.state, 'request_id', None)}})
        return JSONResponse(status_code=exc.status_code, content=envelope(request, error=exc))

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content=envelope(request, error=AppError('INVALID_INPUT', 'validation', 'Check the request fields and try again.', 422)))

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        error = AppError('NOT_FOUND' if exc.status_code == 404 else 'REQUEST_FAILED', 'not_found' if exc.status_code == 404 else 'validation', 'The requested resource is unavailable.', exc.status_code)
        return JSONResponse(status_code=exc.status_code, content=envelope(request, error=error))

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        logger.error('unexpected_error', extra={'context': {'event': 'backend_exception', 'exception_type': type(exc).__name__, 'request_id': getattr(request.state, 'request_id', None)}})
        return JSONResponse(status_code=500, content=envelope(request, error=AppError('INTERNAL_ERROR', 'internal', 'An unexpected error occurred. Retry or contact support.', 500)))

    @application.get('/api/health')
    async def health(request: Request):
        # Liveness is not database readiness. Never claim a connection from environment presence.
        return envelope(request, {'status': 'alive', 'platform': 'supabase', 'configured': config.configured})

    @application.get('/api/v1/me')
    async def me(request: Request, user: CurrentUser = Depends(get_current_user)):
        return envelope(request, {'user_id': str(user.id)})

    @application.get('/api/v1/workspaces/{workspace_id}/access')
    async def workspace_access(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_access)):
        return envelope(request, {'workspace_id': str(workspace_id), 'user_id': str(user.id)})

    @application.get('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director')
    async def director_context(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)):
        context = await DirectorRepository(gateway).context(workspace_id, production_id, user.id, request.state.access_token)
        context['references'] = [dict(reference, capability=reference_capability(reference)) for reference in context['references']]
        context['draft'] = None
        context['reality'] = None
        if context['intake'] and context['intake'].get('plan'):
            try:
                saved_intent = ProductionIntent.model_validate(context['intake']['intent'])
                saved_plan = ProductionDraft.model_validate(context['intake']['plan'])
                context['draft'] = saved_plan.model_dump(mode='json')
                context['reality'] = draft_and_check(saved_intent, context['setup'])[1].model_dump(mode='json')
            except Exception:
                # Persisted output is revalidated before being shown; malformed/stale data is never treated as a proposal.
                logger.error('director_saved_output_invalid', extra={'context': {'event': 'director_saved_output_invalid', 'production_id': str(production_id)}})
                context['draft'] = None
                context['reality'] = None
        return envelope(request, context)

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/interpret')
    async def director_interpret(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        body = await request.json()
        try:
            payload = InterpretRequest.model_validate(body)
            context = await DirectorRepository(gateway).context(workspace_id, production_id, user.id, request.state.access_token)
            known_context = {
                'production_type': context['production']['production_type'],
                'runtime_ms': context['production']['planned_duration_ms'],
                'execution': context['production']['execution_method'],
                'answered_decisions': payload.answered_decisions,
            }
            evidence: list[EvidenceItem] = []
            for reference in context['references']:
                source_type = reference['source_type']
                kind: Literal['description', 'upload', 'url', 'asset', 'document', 'audio', 'video', 'image'] = source_type if source_type in {'description', 'url', 'audio', 'video', 'image', 'asset', 'document'} else 'upload'
                evidence.append(EvidenceItem(
                    kind=kind, access='available' if reference.get('media_id') else ('metadata_only' if source_type in {'url', 'social_url'} else 'available'),
                    source_id=reference['id'], label=(reference.get('source_description') or reference.get('source_url') or 'Saved reference')[:500],
                ))
            result = interpret(payload.goal, known_context=known_context, evidence=evidence,
                collaboration_mode=payload.collaboration_mode)
        except (ValueError, TypeError) as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the Director input and try again.', 422) from exc
        return envelope(request, result.model_dump(mode='json'))

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/intake')
    async def save_director_intake(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        body = await request.json()
        try:
            payload = SaveIntakeRequest.model_validate(body)
        except Exception as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'Check the structured Production brief and revision.', 422) from exc
        result = await DirectorRepository(gateway).save_intent(
            workspace_id, production_id, payload.expected_intake_revision, payload.intent, request.state.access_token,
        )
        return envelope(request, result)

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/propose')
    async def propose_director_plan(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        body = await request.json()
        try:
            payload = ProposePlanRequest.model_validate(body)
        except Exception as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'A valid plan operation identifier is required.', 422) from exc
        repository = DirectorRepository(gateway)
        context = await repository.context(workspace_id, production_id, user.id, request.state.access_token)
        if not context['intake']:
            raise AppError('DIRECTOR_INTAKE_MISSING', 'validation', 'Save the brief before building a Studio draft.', 409)
        if context['intake']['status'] == 'ready_for_studio':
            raise AppError('DIRECTOR_REVISION_REVIEW_REQUIRED', 'validation', 'A Studio plan already exists; reviewed regeneration is not available in this intake flow.', 409)
        intent = ProductionIntent.model_validate(context['intake']['intent'])
        draft, reality = draft_and_check(intent, context['setup'])
        proposed = await repository.propose(
            workspace_id, production_id, context['production']['revision'],
            context['intake']['revision'], payload.operation_id, draft, request.state.access_token,
        )
        return envelope(request, {'draft': draft.model_dump(mode='json'), 'reality': reality.model_dump(mode='json'), 'proposal': proposed})

    @application.post('/api/v1/workspaces/{workspace_id}/productions/{production_id}/director/apply')
    async def apply_director_plan(workspace_id: UUID, production_id: UUID, request: Request,
        user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        body = await request.json()
        try:
            payload = ApplyPlanRequest.model_validate(body)
        except Exception as exc:
            raise AppError('INVALID_DIRECTOR_INPUT', 'validation', 'The application confirmation and operation are invalid.', 422) from exc
        if not payload.explicit_confirmation:
            raise AppError('DIRECTOR_CONFIRMATION_REQUIRED', 'authorization', 'Confirm BUILD PRODUCTION to apply this Draft plan.', 409)
        repository = DirectorRepository(gateway)
        context = await repository.context(workspace_id, production_id, user.id, request.state.access_token)
        if not context['intake']:
            raise AppError('DIRECTOR_INTAKE_MISSING', 'validation', 'Save the brief before applying a Studio draft.', 409)
        if context['intake']['status'] == 'ready_for_studio' and context['intake']['applied_operation_id'] == str(payload.operation_id):
            return envelope(request, {'production_id': str(production_id), 'intake_id': context['intake']['id'], 'idempotent': True})
        result = await repository.apply(
            workspace_id, production_id, context['production']['revision'],
            context['intake']['revision'], payload.operation_id, request.state.access_token,
        )
        return envelope(request, result)

    register_director_intelligence_routes(application, config, logger, envelope)

    @application.get('/api/ready')
    async def readiness(request: Request, user: CurrentUser = Depends(get_current_user), gateway: SupabaseGateway = Depends(get_gateway)):
        await gateway.request('GET', '/rest/v1/profiles', token=request.state.access_token, schema=True,
            params={'user_id': f'eq.{user.id}', 'select': 'user_id', 'limit': '1'})
        return envelope(request, {'status': 'ready', 'database': 'reachable', 'auth': 'verified', 'schema': 'tonde'})

    return application


app = create_app()
