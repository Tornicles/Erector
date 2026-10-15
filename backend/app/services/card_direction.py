"""Card direction: planning, validation, structured generation and guarded persistence.

A Card is the canonical Scene, so reads here are RLS-filtered selects on `tonde.scenes` and the only
write path is the guarded `card_direction_write` RPC. A locked Card, a stale revision, a non-member
and a viewer are refused by the database, not by a frontend assumption.

Generation goes through the existing Director provider abstraction (`run_operation`), so the
provider hardening, structured-output validation, repair attempts and the "no provider configured"
truthfulness come from one place. A generated Card is always a *proposal*: the creator applies it,
and the write is a separate, authorised call.

The Card-count rule is enforced here because this is the only path that creates Cards for TONDE.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.domain.card_completeness import evaluate_card
from app.domain.card_system import (
    CardDirectionDraft,
    PlanCardsRequest,
    ProposeCardDirectionRequest,
    WriteCardDirectionRequest,
    validation_view,
)
from app.domain.cards import (
    CARD_DIRECTION_FIELDS,
    MAX_CARDS,
    FieldProvenance,
    card_status,
    card_summary_words,
    contradictions,
    impact_for,
    plan_card_shells,
    resolve_provenance,
    status_detail,
    validate_card_direction,
    validate_shot_direction,
)
from app.domain.studio import CreateSceneRequest, UpdateSceneRequest
from app.services.ai.orchestration import (
    OperationEnvelope,
    OperationOutcome,
    OperationScope,
    json_schema,
    run_operation,
)
from app.services.ai.provider import DirectorModelProvider, GenerationRequest
from app.services.studio_workspace import StudioWorkspaceRepository

#: Card columns live on the canonical Scene row, read with the Scene.
CARD_FIELDS = ('id,revision,title,purpose,description,story_beat,opening_state,ending_state,'
    'sort_order,approval,locked_at,card_mode,card_direction,card_provenance,card_validation,'
    'card_generated_by,planned_duration_ms')
SHOT_DIRECTION_FIELDS = ('id,scene_id,title,execution_method,planned_duration_ms')
PLAN_DIRECTION_FIELDS = ('shot_id,execution_method,plan_status,performance,blocking,camera_position,'
    'framing,lighting_plan,sound_plan,microphone_plan,canonical_prompt,provider_prompt,provider_prompt_edited,'
    'accept_provider_prompt,motion,continuity,negative_constraints,hybrid,movement')
MAX_CARDS_READ = 200
MAX_SHOTS_READ = 800

CARD_SYSTEM_PROMPT = (
    'You are TONDE, the AI Production Director for one specific Production. You write Card-level '
    'direction for one beat of that Production. Every sentence must change what the creator does: '
    'say what to frame, hold, move, light, record or perform. Never write aspiration such as '
    '"cinematic", "immersive" or "compelling". Never repeat the same passage under two headings; '
    'each section has a different job. Respect the word-length contract for each section. Use only '
    'the equipment and locations the Production actually has. Output the requested JSON schema.'
)


def card_operation_context(card: dict[str, Any], *, production: dict[str, Any],
    shots: list[dict[str, Any]], plans: dict[str, dict[str, Any]],
    continuity: list[dict[str, Any]], focus: str, instruction: str | None) -> dict[str, Any]:
    """The scoped Production truth a Card generation is allowed to reason from."""

    return {
        'production': {
            'title': production.get('title'),
            'production_type': production.get('production_type'),
            'custom_type': production.get('custom_type'),
            'execution_method': production.get('execution_method'),
            'planned_duration_ms': production.get('planned_duration_ms'),
        },
        'card': {
            'order': card.get('sort_order'),
            'title': card.get('title'),
            'purpose': card.get('purpose'),
            'description': card.get('description'),
            'opening_state': card.get('opening_state'),
            'ending_state': card.get('ending_state'),
            'planned_duration_ms': card.get('planned_duration_ms'),
            'mode': card.get('card_mode'),
            'direction': card.get('card_direction') or {},
        },
        'shots': [{
            'id': str(shot.get('id')),
            'title': shot.get('title'),
            'execution_method': shot.get('execution_method'),
            'planned_duration_ms': shot.get('planned_duration_ms'),
            'direction': {key: value for key, value in (plans.get(str(shot.get('id'))) or {}).items()
                if key not in ('shot_id', 'execution_method')},
        } for shot in shots],
        'continuity': continuity[:40],
        'focus': focus,
        'instruction': (instruction or '').strip()[:1200],
    }


def card_status_for(card: dict[str, Any], *, shots: list[dict[str, Any]],
    plans: dict[str, dict[str, Any]], results: int) -> str:
    """Derive the Card's real status from persisted state, never from the browser's opinion."""

    completeness = evaluate_card(
        {'id': str(card.get('id')), 'order': card.get('sort_order'), 'purpose': card.get('purpose'),
            'description': card.get('description'), 'opening_state': card.get('opening_state'),
            'ending_state': card.get('ending_state')},
        [{'id': str(shot.get('id')), 'execution_method': shot.get('execution_method') or 'real'}
            for shot in shots],
        plans)
    return card_status(has_structure=bool(str(card.get('purpose') or card.get('title') or '').strip()),
        direction=card.get('card_direction') or {}, completeness=completeness.state,
        approval=card.get('approval'), results=results)


class CardDirectionService:
    def __init__(self, gateway: SupabaseGateway) -> None:
        self.gateway = gateway
        self.studio = StudioWorkspaceRepository(gateway)

    async def _rows(self, path: str, token: str, params: dict[str, str], limit: int) -> list[dict[str, Any]]:
        rows = await self.gateway.request('GET', path, token=token, schema=True, params=params)
        if not isinstance(rows, list):
            return []
        return rows[:limit]

    async def _production(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, Any]:
        rows = await self._rows('/rest/v1/productions', token, {
            'id': f'eq.{production_id}', 'workspace_id': f'eq.{workspace_id}',
            'select': 'id,workspace_id,title,production_type,custom_type,execution_method,'
                      'planned_duration_ms,calculated_duration_ms,revision,lifecycle,approval',
            'limit': '1'}, 1)
        if not rows:
            raise AppError('STUDIO_NOT_FOUND', 'not_found', 'That Production is not available to you.', 404)
        return rows[0]

    async def _card(self, workspace_id: UUID, production_id: UUID, scene_id: UUID, token: str) -> dict[str, Any]:
        rows = await self._rows('/rest/v1/scenes', token, {
            'id': f'eq.{scene_id}', 'workspace_id': f'eq.{workspace_id}',
            'production_id': f'eq.{production_id}', 'select': CARD_FIELDS, 'limit': '1'}, 1)
        card = next((row for row in rows if str(row.get('id')) == str(scene_id)), None)
        if card is None:
            raise AppError('STUDIO_NOT_FOUND', 'not_found', 'That Card is not available to you.', 404)
        return card

    async def _shots(self, workspace_id: UUID, production_id: UUID, token: str,
        scene_id: UUID) -> list[dict[str, Any]]:
        rows = await self._rows('/rest/v1/shots', token, {
            'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
            'scene_id': f'eq.{scene_id}', 'lifecycle': 'eq.active',
            'select': SHOT_DIRECTION_FIELDS, 'order': 'sort_order,id', 'limit': str(MAX_SHOTS_READ)},
            MAX_SHOTS_READ)
        return [row for row in rows if str(row.get('scene_id')) == str(scene_id)]

    async def _plans(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, dict[str, Any]]:
        rows = await self._rows('/rest/v1/execution_plans', token, {
            'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
            'select': PLAN_DIRECTION_FIELDS, 'order': 'revision.desc', 'limit': str(MAX_SHOTS_READ)},
            MAX_SHOTS_READ)
        latest: dict[str, dict[str, Any]] = {}
        for row in rows:
            key = str(row.get('shot_id'))
            current = latest.get(key)
            if current is None or str(row.get('execution_method')) == 'ai':
                latest[key] = {**(current or {}), **row}
        return latest

    async def _continuity(self, workspace_id: UUID, production_id: UUID, token: str) -> list[dict[str, Any]]:
        """Live continuity statements, newest first: the same truth every Card and prompt reads."""

        return await self._rows('/rest/v1/continuity_states', token, {
            'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
            'retired_at': 'is.null', 'select': 'domain,trait,value,anchor,scene_id,shot_id,transition,origin',
            'order': 'created_at.desc', 'limit': '200'}, 200)

    async def list_cards(self, workspace_id: UUID, production_id: UUID, token: str) -> list[dict[str, Any]]:
        """Every Card with its direction, derived status and last stored validation."""

        cards = await self._rows('/rest/v1/scenes', token, {
            'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
            'lifecycle': 'eq.active', 'select': CARD_FIELDS, 'order': 'sort_order,id',
            'limit': str(MAX_CARDS_READ)}, MAX_CARDS_READ)
        shots = await self._rows('/rest/v1/shots', token, {
            'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
            'lifecycle': 'eq.active', 'select': SHOT_DIRECTION_FIELDS, 'limit': str(MAX_SHOTS_READ)},
            MAX_SHOTS_READ)
        plans = await self._plans(workspace_id, production_id, token)
        result_rows = await self._rows('/rest/v1/results', token, {
            'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
            'select': 'id,shot_id,state', 'limit': '400'}, 400)
        active_results_by_shot: dict[str, int] = {}
        for result in result_rows:
            if result.get('state') in ('raw', 'needs_review') and result.get('shot_id'):
                shot_id = str(result['shot_id'])
                active_results_by_shot[shot_id] = active_results_by_shot.get(shot_id, 0) + 1
        view: list[dict[str, Any]] = []
        for index, card in enumerate(cards, start=1):
            card_shots = [shot for shot in shots if str(shot.get('scene_id')) == str(card.get('id'))]
            result_count = sum(active_results_by_shot.get(str(shot.get('id')), 0) for shot in card_shots)
            status = card_status_for(card, shots=card_shots, plans=plans, results=result_count)
            validation = card.get('card_validation') or {}
            view.append({
                'card_id': str(card.get('id')),
                'order': index,
                'title': card.get('title'),
                'mode': str(card.get('card_mode') or 'real'),
                'status': status,
                'status_detail': status_detail(status),  # type: ignore[arg-type]
                'direction': card.get('card_direction') or {},
                'provenance': card.get('card_provenance') or {},
                'generated_by': card.get('card_generated_by') or 'deterministic',
                'revision': card.get('revision'),
                'approval': card.get('approval'),
                'locked': card.get('locked_at') is not None,
                'validation': validation or None,
                'shot_count': len(card_shots),
            })
        return view

    async def write(self, workspace_id: UUID, production_id: UUID, scene_id: UUID, token: str,
        body: WriteCardDirectionRequest) -> dict[str, Any]:
        """Persist a Card's whole direction through the guarded RPC, with its validation report."""

        direction = body.direction.model_dump(mode='json')
        report = validate_card_direction(direction)
        if report.blocking():
            raise AppError('CARD_DIRECTION_INVALID', 'validation',
                f'This Card direction is not valid yet: {report.blocking()[0].detail}', 422)
        provenance = body.provenance or {
            field: FieldProvenance(value=str(direction.get(field))[:400],
                source_type='creator_locked' if body.generated_by == 'creator' else 'director',
                confidence=1.0 if body.generated_by == 'creator' else 0.8,
                locked=body.generated_by == 'creator').model_dump(mode='json')
            for field in CARD_DIRECTION_FIELDS if str(direction.get(field) or '').strip()
        }
        if body.instruction:
            provenance['instruction'] = {'value': body.instruction[:400], 'source_type': 'creator_locked',
                'confidence': 1.0, 'locked': True}
        saved = await self.gateway.rpc_detailed('card_direction_write', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_scene': str(scene_id), 'direction': direction, 'mode_input': body.mode,
            'provenance': provenance,
            'validation': report.model_dump(mode='json'), 'generated_by': body.generated_by,
            'expected_revision': body.expected_revision,
        }, layer='Card direction')
        return {'card': saved, 'validation': validation_view(report).model_dump(mode='json'),
            'status': card_status(has_structure=True, direction=direction, completeness='DRAFT',
                approval=(saved or {}).get('approval'))}

    async def validate(self, workspace_id: UUID, production_id: UUID, scene_id: UUID, token: str,
        *, persist: bool, direction: CardDirectionDraft | None = None) -> dict[str, Any]:
        """Validate a Card's direction *and* its Shots, so a Card is never READY with vague Shots."""

        card = await self._card(workspace_id, production_id, scene_id, token)
        shots = await self._shots(workspace_id, production_id, token, scene_id)
        plans = await self._plans(workspace_id, production_id, token)
        continuity = await self._continuity(workspace_id, production_id, token)
        content = direction.model_dump(mode='json') if direction else (card.get('card_direction') or {})
        report = validate_card_direction(content, for_ready=bool(content.get('title')))
        findings = list(report.findings)
        shot_rows: list[dict[str, Any]] = []
        for shot in shots:
            plan = plans.get(str(shot.get('id'))) or {}
            merged = {
                'id': str(shot.get('id')),
                'purpose': plan.get('purpose') or shot.get('purpose') or '',
                'start_state': plan.get('start_state') or '',
                'action': plan.get('action') or plan.get('movement') or '',
                'timing': plan.get('timing') or '',
                'camera': plan.get('camera_position') or plan.get('movement') or '',
                'camera_motion': plan.get('movement') or '',
                'performance': plan.get('performance') or '',
                'lighting': plan.get('lighting_plan') or '',
                'audio': plan.get('sound_plan') or plan.get('microphone_plan') or '',
                'takes': plan.get('takes') or '',
                'success_criteria': plan.get('success_criteria') or '',
                'retake_if': plan.get('retake_if') or '',
                'prompt': _prompt_text(plan),
                'avoid': _list_text(plan.get('negative_constraints')),
                'expected_result': plan.get('expected_result') or '',
                'environment': plan.get('environment') or '',
                'character_lock': plan.get('character_lock') or '',
                'world_lock': plan.get('world_lock') or '',
                'start_frame': plan.get('start_frame') or '',
                'end_frame': plan.get('end_frame') or '',
                'subject_action': plan.get('performance') or '',
                'duration_seconds': (shot.get('planned_duration_ms') or 0) / 1000,
            }
            mode = 'AI' if str(shot.get('execution_method')) == 'ai' else 'REAL'
            shot_rows.append(merged)
            findings.extend(validate_shot_direction(merged, mode=mode, for_ready=False))
        findings.extend(contradictions(content, shot_rows,
            continuity={'locked': _locked_continuity(continuity)},
            target_duration_ms=card.get('planned_duration_ms') or None))
        blocking = [item for item in findings if item.severity == 'blocking']
        merged_report = report.model_copy(update={
            'findings': findings[:60], 'ready': not blocking,
            'missing': report.missing[:12], 'word_total': card_summary_words(content)})
        stored = None
        if persist and card.get('card_direction'):
            stored = await self.gateway.rpc_detailed('card_direction_write', token=token, json={
                'target_workspace': str(workspace_id), 'target_production': str(production_id),
                'target_scene': str(scene_id), 'direction': content,
                'mode_input': str(card.get('card_mode') or 'real'),
                'provenance': card.get('card_provenance') or {},
                'validation': merged_report.model_dump(mode='json'),
                'generated_by': str(card.get('card_generated_by') or 'deterministic'),
                'expected_revision': None,
            }, layer='Card direction')
        return {'validation': validation_view(merged_report).model_dump(mode='json'),
            'shots_validated': len(shot_rows),
            'stored': stored is not None}

    async def plan(self, workspace_id: UUID, production_id: UUID, token: str,
        body: PlanCardsRequest) -> dict[str, Any]:
        """Plan the Production structure, and only then let Cards be written."""

        if len(body.beats) > MAX_CARDS:
            raise AppError('INVALID_CARD_INPUT', 'validation',
                f'A plan can contain at most {MAX_CARDS} beats. Nothing was truncated or written.', 422)
        plan = plan_card_shells(body.target_runtime_ms, body.beats)
        blocking = [rule for rule in plan.rules if rule.severity == 'blocking']
        if any(rule.code == 'card_count_exceeds_cap' for rule in blocking) and body.acknowledge_card_cap:
            # Creator acknowledgement overrides only the runtime-based cap; the plan itself
            # records that explicit exception as a warning and still reconciles exact timing.
            plan = plan_card_shells(body.target_runtime_ms, body.beats, acknowledge_card_cap=True)
            blocking = [rule for rule in plan.rules if rule.severity == 'blocking']
        if blocking:
            code = 'CARD_COUNT_EXCEEDS_CAP' if blocking[0].code == 'card_count_exceeds_cap' else 'CARD_PLAN_INVALID'
            raise AppError(code, 'validation', blocking[0].detail, 422)
        # Over-cap plans need a separate review/confirmation request before any Scene changes.
        if body.persist and any(rule.code == 'card_count_cap_acknowledged' for rule in plan.rules):
            raise AppError('CARD_CAP_PERSIST_CONFIRMATION_REQUIRED', 'authorization',
                'Review the over-cap preview first. Applying this exception requires a separate, explicit confirmation.', 409)
        # Explicit creator acknowledgement can accept the published cap exception, never invalid
        # timing or a structure with no executable Cards.
        production = await self._production(workspace_id, production_id, token)
        persisted: list[dict[str, Any]] = []
        if body.persist:
            if body.expected_production_revision is None:
                raise AppError('CARD_PLAN_REVISION_REQUIRED', 'validation',
                    'Persisting a Card plan requires the current Production revision. Reload Studio and try again.', 422)
            production_revision = int(production.get('revision') or 1)
            if body.expected_production_revision != production_revision:
                raise AppError('STUDIO_CONFLICT', 'conflict',
                    'The Production changed since you started this Card plan. Reload Studio before applying it.', 409)
            existing = await self._rows('/rest/v1/scenes', token, {
                'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
                'lifecycle': 'eq.active', 'select': 'id,title,purpose,description,story_beat,opening_state,ending_state,visual_intent,dialogue_notes,sort_order,revision',
                'order': 'sort_order,id', 'limit': str(MAX_CARDS_READ)}, MAX_CARDS_READ)
            if len(existing) > len(plan.shells):
                active_shots = await self._rows('/rest/v1/shots', token, {
                    'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
                    'lifecycle': 'eq.active', 'select': 'id,scene_id', 'limit': str(MAX_SHOTS_READ)}, MAX_SHOTS_READ)
                owned_scenes = {str(shot.get('scene_id')) for shot in active_shots}
                proposed_archives = existing[len(plan.shells):]
                if any(str(row.get('id')) in owned_scenes for row in proposed_archives):
                    raise AppError('CARD_PLAN_HAS_COVERAGE', 'conflict',
                        'This shorter plan would leave Shots behind. Move or archive those Shots explicitly before applying it.', 409)
            for position, shell in enumerate(plan.shells):
                # Existing Scenes carry production material that should not disappear when the
                # structure is replanned. Changing Card count is not authorization to archive a
                # Card that still owns Shots, dialogue, Assets, Results or direction.
                # `duration_ms` is the Studio Scene write contract for the planned runtime; the
                # Card shell also records where it starts, where it ends and what it changes.
                patch: dict[str, Any] = {'title': shell.title, 'purpose': shell.purpose,
                    'story_beat': shell.story_change or shell.title,
                    'description': shell.story_change or shell.purpose or shell.title,
                    'opening_state': shell.starts_from, 'ending_state': shell.ends_with,
                    'duration_ms': shell.target_duration_ms}
                if position < len(existing):
                    current = existing[position]
                    saved = await self.studio.update_scene(workspace_id, production_id,
                        UUID(str(current['id'])), token,
                        UpdateSceneRequest(expected_revision=int(current.get('revision') or 1), **patch))
                else:
                    saved = await self.studio.create_scene(workspace_id, production_id, token,
                        CreateSceneRequest(expected_production_revision=production_revision,
                            **patch))
                persisted.append({'card_id': str((saved or {}).get('id')) if isinstance(saved, dict) else None,
                    'revision': (saved or {}).get('revision') if isinstance(saved, dict) else None,
                    'order': position + 1, 'title': shell.title,
                    'target_duration_ms': shell.target_duration_ms})
            # Preserve all existing Scene identities and their history. Added planned shells are
            # appended by the canonical Scene RPC; existing Cards are not archived or reordered
            # implicitly because that would invalidate references and downstream object links.
        return {
            'production_id': str(production_id),
            'production_title': production.get('title'),
            'plan': plan.model_dump(mode='json'),
            'persisted': persisted,
            'persist_requested': body.persist,
            'cap': plan.card_cap,
        }

    async def propose(self, provider: DirectorModelProvider, workspace_id: UUID, production_id: UUID,
        scene_id: UUID, token: str, body: ProposeCardDirectionRequest) -> dict[str, Any]:
        """Ask TONDE to write this Card. The result is a validated proposal, never a write."""

        production = await self._production(workspace_id, production_id, token)
        card = await self._card(workspace_id, production_id, scene_id, token)
        if body.expected_revision is not None and body.expected_revision != int(card.get('revision') or 1):
            raise AppError('STUDIO_CONFLICT', 'conflict',
                'This Card changed since you selected the focus. Reload it before asking TONDE to revise it.', 409)
        shots = await self._shots(workspace_id, production_id, token, scene_id)
        plans = await self._plans(workspace_id, production_id, token)
        continuity = await self._continuity(workspace_id, production_id, token)
        context = card_operation_context(card, production=production, shots=shots, plans=plans,
            continuity=continuity, focus=body.focus, instruction=body.instruction)
        envelope = OperationEnvelope(
            workspace_id=workspace_id, production_id=production_id, scope_object_id=scene_id,
            scope=OperationScope.scene, operation_type='card_direction',
            source_revision=int(card.get('revision') or 1), constraints={'focus': body.focus},
            model_profile='card-direction')
        outcome: OperationOutcome = await run_operation(
            provider, envelope,
            GenerationRequest(operation='card_direction',
                system=CARD_SYSTEM_PROMPT,
                prompt=_generation_prompt(context),
                response_schema=json_schema(CardDirectionDraft),
                schema_name='card_direction', max_output_tokens=4000),
            CardDirectionDraft, max_repair_attempts=1, require_model=True)
        draft = CardDirectionDraft.model_validate(outcome.payload)
        direction = draft.model_dump(mode='json')
        report = validate_card_direction(direction)
        return {
            'proposal': direction,
            'mode': str(card.get('card_mode') or 'real'),
            'card_id': str(scene_id),
            'card_revision': int(card.get('revision') or 1),
            'expected_revision': body.expected_revision,
            'focus': body.focus,
            'validation': validation_view(report).model_dump(mode='json'),
            'provider': {'producer': outcome.producer, 'provider': outcome.provider, 'model': outcome.model,
                'attempts': outcome.attempts, 'repaired': outcome.repaired},
            'limitations': outcome.limitations,
        }

    async def impact(self, workspace_id: UUID, production_id: UUID, token: str, *, change: str,
        scope: str = 'card', downstream_cards: bool = False) -> dict[str, Any]:
        """What a change is allowed to touch, and which production truth it must preserve."""

        plan = impact_for(change, scope=scope, downstream_cards=downstream_cards)
        return {'plan': plan.model_dump(mode='json'),
            'detail': (f'Changing {change} regenerates {len(plan.card_fields)} Card field(s) and '
                       f'{len(plan.shot_fields)} Shot field(s). It leaves {len(plan.protected)} field(s) '
                       f'untouched, including the Card\u2019s story. {plan.note}')}


def _list_text(value: Any) -> str:
    if isinstance(value, list):
        return ' '.join(str(item) for item in value)
    return str(value or '')


def _prompt_text(plan: dict[str, Any]) -> str:
    canonical = plan.get('canonical_prompt')
    if isinstance(canonical, dict):
        parts = [str(item) for item in canonical.values() if isinstance(item, (str, int, float))]
        if parts:
            return ' '.join(parts)
    if isinstance(canonical, str) and canonical.strip():
        return canonical
    provider_prompt = plan.get('provider_prompt')
    return provider_prompt if isinstance(provider_prompt, str) else ''


def _locked_continuity(rows: list[dict[str, Any]]) -> dict[str, str]:
    locked: dict[str, str] = {}
    for row in rows:
        if str(row.get('origin')) == 'declared':
            locked[f'{row.get("trait")}'] = str(row.get('value'))
    return locked


def _generation_prompt(context: dict[str, Any]) -> str:
    import json

    shots = context.get('shots') or []
    continuity = context.get('continuity') or []
    return (
        'Write the Card-level direction for this beat of the Production.\n'
        f'Production: {json.dumps(context.get("production"), ensure_ascii=False)}\n'
        f'Card structure: {json.dumps(context.get("card"), ensure_ascii=False)}\n'
        f'Card focus requested: {context.get("focus")}\n'
        f'Creator instruction: {context.get("instruction") or "none"}\n'
        f'Existing Shots to respect: {json.dumps(shots, ensure_ascii=False)}\n'
        f'Canonical continuity statements (these win): {json.dumps(continuity, ensure_ascii=False)}\n'
        'Rules: use only equipment the Production has; keep creator-locked facts exactly; do not '
        'invent people, places or gear; keep every section within its word contract; never repeat a '
        'passage across sections; put exact framing, movement, light and sound decisions in the '
        'Card-level sections and leave per-Shot execution detail to the Shots.'
    )


def provenance_preview(direction: dict[str, Any]) -> FieldProvenance | None:
    """The authority a value would carry if it were written now (used by tests and the Studio)."""

    return resolve_provenance([FieldProvenance(value=str(value), source_type='director')
        for value in direction.values() if str(value).strip()])
