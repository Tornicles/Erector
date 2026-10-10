from __future__ import annotations

import asyncio
import logging
import random
from typing import Any, Protocol
from uuid import UUID

from pydantic import ValidationError

from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.domain.director import (
    EvidenceItem,
    IntentResult,
    ProductionDraft,
    ProductionIntent,
    RealityAssessment,
    assess_reality,
    build_draft,
    interpret_intent,
)
from app.domain.vocabulary import CollaborationMode

logger = logging.getLogger('tonde.director')


class DirectorProvider(Protocol):
    async def propose(self, operation: str, context: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]: ...


class UnconfiguredDirectorProvider:
    async def propose(self, operation: str, context: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
        raise AppError(
            'DIRECTOR_PROVIDER_UNAVAILABLE', 'provider',
            'Director AI is not configured. You can save this brief and continue with the transparent deterministic draft.', 503,
        )


def reference_is_shaping_ready(reference: dict[str, Any]) -> bool:
    return (
        bool(str(reference.get('source_identity') or '').strip())
        and reference.get('identity_provenance') in {'source_metadata', 'creator_supplied'}
        and bool(reference.get('source_identity_verified_at'))
        and bool(str(reference.get('creator_purpose') or '').strip())
    )


def reference_capability(reference: dict[str, Any]) -> dict[str, Any]:
    source = reference.get('source_type')
    if reference.get('media_id'):
        return {
            'metadata': 'available', 'media_bytes': 'unverified', 'image': 'unverified',
            'video_frames': 'unverified', 'audio': 'unverified', 'transcript': 'unavailable',
            'analysis': 'not_started', 'note': 'Media is linked, but no preprocessing or analysis has run.',
        }
    if source in {'url', 'social_url'}:
        return {
            'metadata': 'unverified', 'thumbnail': 'unverified', 'media_bytes': 'unavailable',
            'image': 'unavailable', 'video_frames': 'unavailable', 'audio': 'unavailable',
            'transcript': 'unavailable', 'analysis': 'not_started',
            'note': 'No URL fetch or provider access is configured; content has not been inspected.',
        }
    if source == 'description':
        return {
            'metadata': 'available', 'text': 'available', 'media_bytes': 'unavailable',
            'video_frames': 'unavailable', 'audio': 'unavailable', 'analysis': 'partial',
            'note': 'Only the creator-provided description is available.',
        }
    return {
        'metadata': 'unverified', 'media_bytes': 'unavailable', 'video_frames': 'unavailable',
        'audio': 'unavailable', 'analysis': 'not_started', 'note': 'Media capability is not established.',
    }


def build_operation_context(
    operation: str,
    intent: ProductionIntent,
    *,
    references: list[dict[str, Any]] | None = None,
    setup: list[dict[str, Any]] | None = None,
    brief: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if operation == 'intent':
        return {
            'goal': intent.goal,
            'production_type': intent.primary_type.value,
            'platform': intent.platform,
            'runtime_ms': intent.runtime_ms,
        }
    if operation == 'reference':
        shaping_references = [reference for reference in (references or []) if reference_is_shaping_ready(reference)]
        return {
            'goal': intent.goal[:1200],
            'references': [
                {
                    'source_type': reference.get('source_type'),
                    'source_identity': str(reference.get('source_identity') or '')[:500],
                    'identity_provenance': reference.get('identity_provenance'),
                    'creator_purpose': str(reference.get('creator_purpose') or '')[:1200],
                    'learning_targets': [str(value)[:200] for value in reference.get('learning_targets', [])[:20]],
                    'source_description': str(reference.get('source_description') or '')[:2000],
                    'capability': reference_capability(reference),
                }
                for reference in shaping_references[:8]
            ],
        }
    if operation == 'reality':
        return {
            'goal': intent.goal[:1200],
            'requirements': brief or {},
            'setup': [
                {key: item.get(key) for key in ('resource_type', 'name', 'manufacturer', 'model', 'mount')}
                for item in (setup or [])[:30]
            ],
            'constraints': intent.constraints,
        }
    if operation in {'story', 'script'}:
        return {
            'goal': intent.goal[:1200], 'brief': brief or {}, 'runtime_ms': intent.runtime_ms,
            'platform': intent.platform, 'dialogue_mode': intent.dialogue_mode,
            'tone': intent.tone[:8], 'constraints': intent.constraints,
        }
    raise ValueError('Unknown Director operation.')


def validate_provider_intent(value: dict[str, Any]) -> IntentResult:
    try:
        return IntentResult.model_validate(value)
    except ValidationError as exc:
        raise AppError(
            'DIRECTOR_OUTPUT_INVALID', 'provider',
            'Director returned an invalid structured interpretation. Nothing was applied.', 502,
        ) from exc


async def call_provider(
    provider: DirectorProvider,
    operation: str,
    context: dict[str, Any],
    schema: dict[str, Any],
    *,
    attempts: int = 3,
) -> dict[str, Any]:
    if not 1 <= attempts <= 3:
        raise ValueError('Retry limit must be between one and three.')
    for attempt in range(attempts):
        try:
            result = await asyncio.wait_for(provider.propose(operation, context, schema), timeout=25)
            if not isinstance(result, dict):
                raise ValueError('Provider output must be an object.')
            return result
        except AppError:
            raise
        except (TimeoutError, OSError) as exc:
            if attempt + 1 == attempts:
                logger.warning('director_provider_failed', extra={
                    'context': {'operation': operation, 'attempts': attempt + 1, 'error_type': type(exc).__name__},
                })
                raise AppError(
                    'DIRECTOR_PROVIDER_FAILED', 'provider',
                    'Director could not complete this operation. Your saved brief is unchanged; retry or continue without analysis.', 503,
                ) from exc
            await asyncio.sleep((0.2 * (2 ** attempt)) + random.uniform(0, 0.1))
        except Exception as exc:
            logger.warning('director_provider_failed', extra={
                'context': {'operation': operation, 'attempts': attempt + 1, 'error_type': type(exc).__name__},
            })
            raise AppError(
                'DIRECTOR_PROVIDER_FAILED', 'provider',
                'Director could not complete this operation. Your saved brief is unchanged; retry or continue without analysis.', 503,
            ) from exc
    raise AppError('DIRECTOR_PROVIDER_FAILED', 'provider', 'Director could not complete this operation.', 503)


def interpret(
    goal: str,
    *,
    known_context: dict[str, Any],
    evidence: list[EvidenceItem],
    collaboration_mode: CollaborationMode,
) -> IntentResult:
    # No provider is configured: return deterministic extraction without claiming model analysis.
    return interpret_intent(
        goal, known_context=known_context, evidence=evidence, collaboration_mode=collaboration_mode,
    )


def draft_and_check(
    intent: ProductionIntent, setup: list[dict[str, Any]],
) -> tuple[ProductionDraft, RealityAssessment]:
    draft = build_draft(intent)
    return draft, assess_reality(draft, setup, intent.constraints)


class DirectorRepository:
    def __init__(self, gateway: SupabaseGateway):
        self.gateway = gateway

    async def _production(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, Any]:
        rows = await self.gateway.request(
            'GET', '/rest/v1/productions', token=token, schema=True,
            params={
                'id': f'eq.{production_id}', 'workspace_id': f'eq.{workspace_id}',
                'select': 'id,workspace_id,title,production_type,execution_method,planned_duration_ms,approval,locked_at,revision',
                'limit': '1',
            },
        )
        if not rows:
            raise AppError('PRODUCTION_NOT_FOUND', 'not_found', 'This Production is unavailable.', 404)
        return rows[0]

    async def context(
        self, workspace_id: UUID, production_id: UUID, user_id: UUID, token: str,
    ) -> dict[str, Any]:
        del user_id  # The authenticated JWT and workspace-membership dependency are the authorization boundary.
        production = await self._production(workspace_id, production_id, token)
        references = await self.gateway.request(
            'GET', '/rest/v1/production_references', token=token, schema=True,
            params={
                'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
                'select': 'id,source_type,source_url,source_description,media_id,provenance,source_identity,source_provider,identity_provenance,source_identity_verified_at,creator_purpose,learning_targets,revision',
                'order': 'created_at.desc', 'limit': '8',
            },
        )
        setup = await self.gateway.request(
            'GET', '/rest/v1/production_resources', token=token, schema=True,
            params={
                'workspace_id': f'eq.{workspace_id}', 'lifecycle': 'eq.active',
                'select': 'resource_type,name,manufacturer,model,mount,metadata',
                'order': 'updated_at.desc', 'limit': '30',
            },
        )
        rows = await self.gateway.request(
            'GET', '/rest/v1/director_intakes', token=token, schema=True,
            params={
                'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
                'select': 'id,revision,status,collaboration_mode,intent,plan,applied_operation_id,proposal_operation_id',
                'limit': '1',
            },
        )
        shaping_references = [reference for reference in references if reference_is_shaping_ready(reference)]
        return {'production': production, 'references': references, 'shaping_references': shaping_references,
            'setup': setup, 'intake': rows[0] if rows else None}

    async def save_intent(
        self, workspace_id: UUID, production_id: UUID, revision: int | None,
        intent: ProductionIntent, token: str,
    ) -> dict[str, Any]:
        production = await self.gateway.request(
            'GET', '/rest/v1/productions', token=token, schema=True,
            params={
                'id': f'eq.{production_id}', 'workspace_id': f'eq.{workspace_id}',
                'select': 'id', 'limit': '1',
            },
        )
        if not production:
            raise AppError('PRODUCTION_NOT_FOUND', 'not_found', 'This Production is unavailable.', 404)
        return await self.gateway.request(
            'POST', '/rest/v1/rpc/save_director_intake', token=token, schema=True,
            json={
                'target_workspace': str(workspace_id), 'target_production': str(production_id),
                'expected_intake_revision': revision, 'intake': intent.model_dump(mode='json'),
            },
        )

    async def propose(
        self, workspace_id: UUID, production_id: UUID, production_revision: int,
        intake_revision: int, operation_id: UUID, draft: ProductionDraft, token: str,
    ) -> dict[str, Any]:
        return await self.gateway.request(
            'POST', '/rest/v1/rpc/save_director_plan_proposal', token=token, schema=True,
            json={
                'target_workspace': str(workspace_id), 'target_production': str(production_id),
                'expected_production_revision': production_revision,
                'expected_intake_revision': intake_revision, 'operation_id': str(operation_id),
                'proposal_plan': draft.model_dump(mode='json'),
            },
        )

    async def apply(
        self, workspace_id: UUID, production_id: UUID, production_revision: int,
        intake_revision: int, operation_id: UUID, token: str,
    ) -> dict[str, Any]:
        return await self.gateway.request(
            'POST', '/rest/v1/rpc/apply_director_plan', token=token, schema=True,
            json={
                'target_workspace': str(workspace_id), 'target_production': str(production_id),
                'expected_production_revision': production_revision,
                'expected_intake_revision': intake_revision, 'operation_id': str(operation_id),
                'explicit_confirmation': True,
            },
        )
