"""Prompt 5 Studio persistence: aggregated reads and guarded canonical writes.

Every write goes through a security-definer RPC that re-checks the authenticated
editor, the Production scope, locks and the object revision. Nothing is written
directly to a table, and no write invents a second Scene/Shot model.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.domain.studio import (
    MAX_SCENES,
    MAX_SHOTS,
    ApprovalRequest,
    CreateSceneRequest,
    CreateShotRequest,
    LockRequest,
    MoveShotRequest,
    ReconcileRequest,
    ReorderRequest,
    UpdateSceneRequest,
    UpdateShotRequest,
    scene_payload,
    shot_payload,
    studio_read_model,
)

SCENE_FIELDS = ('id,workspace_id,production_id,title,purpose,story_beat,description,action_lines,opening_state,'
    'ending_state,visual_intent,dialogue_notes,environment_asset_id,sort_order,planned_duration_ms,'
    'calculated_duration_ms,approval,locked_at,lifecycle,revision,updated_at')
SHOT_FIELDS = ('id,workspace_id,production_id,scene_id,title,description,action,purpose,subject,framing,angle,'
    'movement,composition,transition,story_relationship,story_beat,creative_notes,execution_method,sort_order,'
    'planned_duration_ms,calculated_duration_ms,approval,locked_at,lifecycle,revision,updated_at')
PLAN_FIELDS = ('shot_id,execution_method,plan_status,readiness_note,performance,blocking,camera_position,'
    'framing,lighting_plan,sound_plan,microphone_plan,setup_steps,capture_checklist,canonical_prompt,'
    'provider_prompt,provider_prompt_edited,motion,continuity,negative_constraints,hybrid,revision')
PRODUCTION_FIELDS = ('id,workspace_id,title,production_type,custom_type,execution_method,planned_duration_ms,'
    'calculated_duration_ms,approval,locked_at,revision,lifecycle,updated_at')


class StudioWorkspaceRepository:
    def __init__(self, gateway: SupabaseGateway) -> None:
        self.gateway = gateway

    async def _rows(self, path: str, token: str, params: dict[str, str], limit: int) -> tuple[list[dict[str, Any]], bool]:
        rows = await self.gateway.request('GET', path, token=token, schema=True, params=params)
        if not isinstance(rows, list):
            return [], False
        return rows[:limit], len(rows) > limit

    async def studio(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, Any]:
        scope = {'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}'}
        production_rows, _ = await self._rows('/rest/v1/productions', token, {
            'id': f'eq.{production_id}', 'workspace_id': f'eq.{workspace_id}', 'select': PRODUCTION_FIELDS, 'limit': '1',
        }, 1)
        if not production_rows:
            raise AppError('PRODUCTION_NOT_FOUND', 'not_found', 'This Production is unavailable.', 404)
        production = production_rows[0]

        scene_rows, scenes_truncated = await self._rows('/rest/v1/scenes', token, {
            **scope, 'lifecycle': 'eq.active', 'select': SCENE_FIELDS, 'order': 'sort_order,id', 'limit': str(MAX_SCENES),
        }, MAX_SCENES)
        shot_rows, shots_truncated = await self._rows('/rest/v1/shots', token, {
            **scope, 'lifecycle': 'eq.active', 'select': SHOT_FIELDS, 'order': 'sort_order,id', 'limit': str(MAX_SHOTS),
        }, MAX_SHOTS)
        asset_rows, assets_truncated = await self._rows('/rest/v1/assets', token, {
            'workspace_id': f'eq.{workspace_id}', 'lifecycle': 'eq.active',
            'select': 'id,asset_type,name,description,metadata,approval,locked_at,lifecycle,revision',
            'order': 'asset_type,name', 'limit': '200',
        }, 200)
        binding_rows, _ = await self._rows('/rest/v1/scope_bindings', token, {
            **scope, 'select': 'id,scope_object_id,asset_id,reference_id,binding_role,inheritance,locked_at', 'limit': '400',
        }, 400)
        participant_rows, _ = await self._rows('/rest/v1/scene_participants', token, {
            **scope, 'select': 'scene_id,asset_id,role', 'limit': '600',
        }, 600)
        dialogue_rows, _ = await self._rows('/rest/v1/dialogue_lines', token, {
            **scope, 'select': 'id,scene_id,shot_id,line_type', 'limit': '600',
        }, 600)
        document_rows, _ = await self._rows('/rest/v1/creative_documents', token, {
            **scope, 'document_type': 'in.(brief,story,script,treatment,creative_note)',
            'select': 'id,document_type,title,content,revision,updated_at,approval,locked_at',
            'order': 'updated_at.desc', 'limit': '12',
        }, 12)
        result_rows, _ = await self._rows('/rest/v1/results', token, {
            **scope, 'select': 'id,shot_id,state', 'limit': '400',
        }, 400)
        # Execution direction for card completeness: one bounded read, latest revision per Shot wins.
        # A Shot without a plan row is reported as unplanned, never assumed.
        plan_rows, _ = await self._rows('/rest/v1/execution_plans', token, {
            **scope, 'select': PLAN_FIELDS, 'order': 'revision.desc', 'limit': '400',
        }, 400)
        timing = await self.timing(workspace_id, production_id, token)
        return studio_read_model(
            production=production, scene_rows=scene_rows, shot_rows=shot_rows, asset_rows=asset_rows,
            binding_rows=binding_rows, participant_rows=participant_rows, dialogue_rows=dialogue_rows,
            document_rows=document_rows, result_rows=result_rows, timing=timing,
            truncated=scenes_truncated or shots_truncated or assets_truncated,
            plan_rows=plan_rows,
        )

    async def timing(self, workspace_id: UUID, production_id: UUID, token: str, *, expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('studio_timing', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': expected_revision,
        })

    async def create_scene(self, workspace_id: UUID, production_id: UUID, token: str, body: CreateSceneRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('create_studio_scene', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': body.expected_production_revision, 'scene': scene_payload(body),
        })

    async def update_scene(self, workspace_id: UUID, production_id: UUID, scene_id: UUID, token: str, body: UpdateSceneRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('update_studio_scene', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_scene': str(scene_id),
            'expected_revision': body.expected_revision, 'patch': scene_payload(body),
        })

    async def reorder_scenes(self, workspace_id: UUID, production_id: UUID, token: str, body: ReorderRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('reorder_studio_scenes', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': body.expected_production_revision, 'ordered_ids': body.ordered_ids,
        })

    async def archive_scene(self, workspace_id: UUID, production_id: UUID, scene_id: UUID, token: str, *, expected_revision: int | None, cascade: bool) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('archive_studio_scene', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_scene': str(scene_id),
            'expected_revision': expected_revision, 'cascade': cascade,
        })

    async def create_shot(self, workspace_id: UUID, production_id: UUID, token: str, body: CreateShotRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('create_studio_shot', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_scene': body.scene_id, 'expected_production_revision': body.expected_production_revision,
            'shot': shot_payload(body),
        })

    async def update_shot(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str, body: UpdateShotRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('update_studio_shot', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_shot': str(shot_id),
            'expected_revision': body.expected_revision, 'patch': shot_payload(body),
        })

    async def move_shot(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str, body: MoveShotRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('move_studio_shot', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_shot': str(shot_id),
            'target_scene': body.scene_id, 'expected_revision': body.expected_revision,
        })

    async def reorder_shots(self, workspace_id: UUID, production_id: UUID, scene_id: UUID | None, token: str, body: ReorderRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('reorder_studio_shots', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_scene': str(scene_id) if scene_id else None,
            'expected_production_revision': body.expected_production_revision, 'ordered_ids': body.ordered_ids,
        })

    async def archive_shot(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str, *, expected_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('archive_studio_shot', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_shot': str(shot_id),
            'expected_revision': expected_revision,
        })

    async def set_approval(self, workspace_id: UUID, production_id: UUID, token: str, body: ApprovalRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_studio_approval', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_scope': body.scope,
            'target_id': body.id, 'desired_approval': body.approval, 'expected_revision': body.expected_revision,
        })

    async def set_lock(self, workspace_id: UUID, production_id: UUID, token: str, body: LockRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_studio_lock', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_scope': body.scope,
            'target_id': body.id, 'locked': body.locked, 'expected_revision': body.expected_revision,
        })

    async def reconcile(self, workspace_id: UUID, production_id: UUID, token: str, body: ReconcileRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('reconcile_studio_runtime', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'absorb_scene': body.absorb_scene, 'expected_production_revision': body.expected_production_revision,
        })
