"""AI Creation service: the playbook, the compiled prompt and the Result check.

The database owns every decision - whether a Shot has an approved AI plan to direct from, which tool
knowledge is reviewed and citable, what the deterministic compilation produces, whether a check
contradicts itself, and what changed between two attempts. This module attaches the creator-facing
vocabulary and recomputes nothing.

The boundary this module exists to protect: TONDE writes direction and compiles prompts for tools the
creator owns, and it judges the Result that comes back. It never claims to have produced the media,
and it never presents an external tool's output as TONDE's own.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.domain.ai_director import CHECK_CRITERIA, CRITERION_SEVERITIES

LAYER = 'AI Creation'

CAPABILITY_LABELS: dict[str, str] = {
    'video_generation': 'Video generation', 'image_generation': 'Image generation',
    'audio_generation': 'Audio generation', 'editing': 'Editing', 'compositing': 'Compositing',
    'upscaling': 'Upscaling', 'other': 'Other capability',
}

REVIEW_STATE_LABELS: dict[str, str] = {
    'draft': 'Draft', 'reviewed': 'Reviewed', 'retired': 'Retired',
}

REVIEW_DECISION_LABELS: dict[str, str] = {
    'review': 'Marked reviewed', 'retire': 'Retired', 'return_to_draft': 'Returned to draft',
}

VERDICT_LABELS: dict[str, str] = {
    'accept': 'Accepted: every checked criterion is satisfied',
    'fix': 'Needs a fix: the next prompt says what to change',
}

CRITERION_LABELS: dict[str, str] = {
    'shot_objective': 'Shot objective', 'subject_identity': 'Subject identity',
    'continuity': 'Continuity', 'composition': 'Composition', 'lighting': 'Lighting',
    'camera_movement': 'Camera movement', 'environment': 'Environment', 'wardrobe': 'Wardrobe',
    'props': 'Props', 'performance': 'Performance', 'timing': 'Timing',
    'reference_relationship': 'Relationship to the Reference',
}

RULE = ('TONDE is the production Director. It analyses, plans, writes the playbook and compiles the '
    'prompt for the tool the creator owns, then checks the Result the creator uploads. It does not '
    'render image or video and needs no credential for one.')
CHECK_RULE = ('A check judges the criteria the product names and nothing else. ACCEPT means every '
    'checked criterion is satisfied; FIX names what to change in the next prompt. There is no '
    '"probably fine".')
COST_RULE = ('The estimate is what the external tool is likely to charge for this Shot. It is the '
    'tool\'s cost, not TONDE\'s, and it is an estimate until the creator\'s own tool reports the '
    'actual charge.')


def vocabulary() -> dict[str, Any]:
    """The AI Creation vocabulary: capabilities, review states, verdicts and the closed criteria."""

    return {
        'capability_types': [{'capability_type': key, 'label': label}
            for key, label in CAPABILITY_LABELS.items()],
        'review_states': [{'review_state': key, 'label': label} for key, label in REVIEW_STATE_LABELS.items()],
        'review_decisions': [{'decision': key, 'label': label}
            for key, label in REVIEW_DECISION_LABELS.items()],
        'verdicts': [{'verdict': key, 'label': label} for key, label in VERDICT_LABELS.items()],
        'criteria': [{'criterion': key, 'label': CRITERION_LABELS[key]} for key in CHECK_CRITERIA],
        'criterion_severities': list(CRITERION_SEVERITIES),
        'rule': RULE,
        'check_rule': CHECK_RULE,
        'cost_rule': COST_RULE,
    }


def decorate_profile(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to one tool profile."""

    data['capability_label'] = CAPABILITY_LABELS.get(str(data.get('capability_type')), 'Capability')
    state = str(data.get('review_state') or 'draft')
    data['review_state_label'] = REVIEW_STATE_LABELS.get(state, 'Draft')
    data['is_usable'] = state == 'reviewed'
    data.setdefault('note', RULE)
    return data


def decorate_catalog(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to the tool catalog and state what TONDE does with it."""

    for entry in data.get('profiles') or data.get('tools') or []:
        entry['capability_label'] = CAPABILITY_LABELS.get(str(entry.get('capability_type')), 'Capability')
        entry['review_state_label'] = REVIEW_STATE_LABELS.get(str(entry.get('review_state') or 'draft'), 'Draft')
    data.setdefault('rule', RULE)
    return data


def decorate_playbook(data: dict[str, Any]) -> dict[str, Any]:
    """Attach the boundary and the copy intent to a Shot playbook."""

    data.setdefault('product_role', 'director')
    data.setdefault('tonde_generates_final_media', False)
    if data.get('prompt'):
        data['prompt_intent'] = ('Copy this into the tool you chose. TONDE does not run it for you.')
    for entry in data.get('evaluation_criteria') or []:
        entry['label'] = CRITERION_LABELS.get(str(entry.get('criterion')), 'Criterion')
    data.setdefault('rule', RULE)
    return data


def decorate_check(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a Result check."""

    verdict = str(data.get('verdict') or '')
    data['verdict_label'] = VERDICT_LABELS.get(verdict, 'Checked')
    for entry in data.get('criteria') or []:
        entry['label'] = CRITERION_LABELS.get(str(entry.get('criterion')), 'Criterion')
    data.setdefault('check_rule', CHECK_RULE)
    return data


def decorate_history(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to the attempts and checks of one Shot."""

    for entry in data.get('checks') or []:
        entry['verdict_label'] = VERDICT_LABELS.get(str(entry.get('verdict')), 'Checked')
    data.setdefault('note', 'Every attempt and check on this Shot, newest first. This record is append-only.')
    return data


class AiDirectorRepository:
    """Every call goes through the shared RPC helper with this layer's name attached."""

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def catalog(self, workspace_id: UUID, token: str, *, capability_type: str | None,
        include_drafts: bool) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_tool_catalog', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'p_capability_type': capability_type,
            'p_include_drafts': include_drafts})

    async def save_profile(self, workspace_id: UUID, token: str, *, tool_key: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_tool_profile_save', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'p_tool_key': tool_key, 'p_payload': payload})

    async def review_profile(self, workspace_id: UUID, token: str, *, profile_id: UUID,
        decision: str, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_tool_profile_review', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_profile': str(profile_id),
            'p_decision': decision, 'p_note': note})

    async def set_production_tool(self, workspace_id: UUID, production_id: UUID, token: str, *,
        tool_key: str, display_name: str | None, tool_profile_id: UUID | None, note: str,
        remove: bool, sort_order: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('production_ai_tool_set', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'p_tool_key': tool_key, 'p_display_name': display_name,
            'p_tool_profile_id': str(tool_profile_id) if tool_profile_id else None,
            'p_note': note, 'p_remove': remove, 'p_sort_order': sort_order})

    async def playbook(self, workspace_id: UUID, production_id: UUID, token: str, *, shot_id: UUID,
        tool_key: str | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_playbook_for_shot', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'p_tool_key': tool_key})

    async def compile_prompt(self, workspace_id: UUID, production_id: UUID, token: str, *, shot_id: UUID,
        tool_key: str | None, expected_plan_revision: int | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_playbook_prompt_compile', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'p_tool_key': tool_key,
            'p_expected_plan_revision': expected_plan_revision})

    async def check_result(self, workspace_id: UUID, production_id: UUID, token: str, *, shot_id: UUID,
        result_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_result_check', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'target_result': str(result_id), 'p_payload': payload})

    async def history(self, workspace_id: UUID, production_id: UUID, token: str, *, shot_id: UUID,
        limit: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_playbook_history', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'p_limit': limit})

    async def boundary(self, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_director_boundary', token=token, layer=LAYER, json={})


__all__ = [
    'AiDirectorRepository', 'CAPABILITY_LABELS', 'CHECK_RULE', 'COST_RULE', 'CRITERION_LABELS',
    'LAYER', 'RULE', 'VERDICT_LABELS', 'decorate_catalog', 'decorate_check', 'decorate_history',
    'decorate_playbook', 'decorate_profile', 'vocabulary',
]
