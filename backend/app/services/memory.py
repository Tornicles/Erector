"""Prompt 9C production memory and structured search service.

Deterministic software owns this layer. Which remembered item is in force, whether its source object
has changed since, whether a candidate may be recorded under the current policy, and which real
objects a structured search matches are all decided in the database (migration 021). This module
attaches the human vocabulary and the honest limits; it recomputes none of it and consults no model.

The boundary this module exists to protect:

* memory is inspectable, so every item carries its tier, its confirmation and whether it is in
  force - an outranked item is shown as outranked rather than hidden;
* an inference is labelled an inference everywhere it appears, including when a memory policy
  accepted it automatically;
* search returns real object references. It does not read media and it does not use embeddings, and
  both facts travel with every response.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.domain.memory import AUTHORITY_RANKS

LAYER = 'Production memory'

SCOPE_LABELS: dict[str, str] = {
    'production': 'This Production', 'series': 'This Series', 'workspace': 'Entire workspace',
}

KIND_LABELS: dict[str, str] = {
    'preference': 'Preference', 'decision': 'Production decision', 'pattern': 'Production pattern',
    'technique': 'Successful technique', 'setup_fact': 'Setup fact', 'asset_usage': 'Reusable Asset use',
    'model_outcome': 'Model or provider outcome', 'series_rule': 'Series rule',
    'correction': 'Your correction', 'other': 'Other',
}

SOURCE_LABELS: dict[str, str] = {
    'creator_instruction': 'Your current instruction',
    'production_decision': 'Current Production decision',
    'saved_preference': 'Saved preference',
    'historical_pattern': 'Historical pattern',
    'inference': 'Inferred by TONDE',
}

ORIGIN_LABELS: dict[str, str] = {
    'declared': 'You said it', 'accepted': 'You accepted a candidate', 'inferred': 'Inferred and unconfirmed',
}

ITEM_STATE_LABELS: dict[str, str] = {'active': 'Active', 'archived': 'Archived', 'deleted': 'Deleted'}

CANDIDATE_STATE_LABELS: dict[str, str] = {
    'proposed': 'Waiting for your decision', 'applied': 'Accepted', 'rejected': 'Dismissed',
}

ENTITY_LABELS: dict[str, str] = {
    'shot': 'Shot', 'scene': 'Scene', 'execution_plan': 'Execution plan', 'result': 'Result',
    'continuity_finding': 'Continuity finding', 'continuity_state': 'Continuity statement',
    'memory_item': 'Memory', 'asset': 'Asset',
}

AUTHORITY_RULE = ('A current creator instruction outranks a current Production decision, which '
    'outranks an explicit saved preference, which outranks a historical pattern, which outranks an '
    'inference.')

LIMITATION = ('Memory is what this Production recorded and what you confirmed. An unconfirmed '
    'inference is labelled as an inference, and nothing here is a hidden behavioural profile.')

SEARCH_LIMITATION = ('Search reads structured production state and returns real object references. '
    'It does not use embeddings and it does not read media.')


def label_for(mapping: dict[str, str], value: Any, fallback: str = 'Unknown') -> str:
    """Return the display label for a stored code without inventing one that does not exist."""

    if value is None:
        return fallback
    return mapping.get(str(value), fallback)


def authority_rank(source: Any) -> int:
    """The stored authority tier, falling back to the weakest tier rather than the strongest."""

    return AUTHORITY_RANKS.get(str(source), 5)


def vocabulary() -> dict[str, Any]:
    """The memory vocabulary and the authority rule that decides what is in force."""

    return {
        'scopes': [{'scope': key, 'label': value} for key, value in SCOPE_LABELS.items()],
        'kinds': [{'kind': key, 'label': value} for key, value in KIND_LABELS.items()],
        'sources': [{'source': key, 'label': SOURCE_LABELS.get(key, key),
            'authority_rank': AUTHORITY_RANKS[key], 'strength': 6 - AUTHORITY_RANKS[key]}
            for key in AUTHORITY_RANKS],
        'origins': [{'origin': key, 'label': value} for key, value in ORIGIN_LABELS.items()],
        'item_states': [{'state': key, 'label': value} for key, value in ITEM_STATE_LABELS.items() if key != 'deleted'],
        'candidate_states': [{'state': key, 'label': value} for key, value in CANDIDATE_STATE_LABELS.items()],
        'search_kinds': [{'kind': key, 'label': value} for key, value in ENTITY_LABELS.items()],
        'authority_rule': AUTHORITY_RULE,
        'rule': ('Memory is inspectable production knowledge with real provenance, not hidden '
            'conversational memory. Nothing becomes reusable memory from a single Shot without an '
            'explicit policy or your decision.'),
        'limitation': LIMITATION,
        'search_limitation': SEARCH_LIMITATION,
    }


def _decorate_item(item: dict[str, Any]) -> dict[str, Any]:
    item['scope_label'] = label_for(SCOPE_LABELS, item.get('scope'))
    item['kind_label'] = label_for(KIND_LABELS, item.get('kind'))
    item['source_label'] = label_for(SOURCE_LABELS, item.get('source'))
    item['origin_label'] = label_for(ORIGIN_LABELS, item.get('origin'))
    item['state_label'] = label_for(ITEM_STATE_LABELS, item.get('state'))
    rank = item.get('authority_rank', authority_rank(item.get('source')))
    item['authority_line'] = f'Tier {rank} of 5 - {item["source_label"]}'
    if item.get('in_force') is True:
        item['force_line'] = 'In force: this is what TONDE is using for this subject.'
    elif item.get('in_force') is False:
        item['force_line'] = 'Not in force: a stronger or newer memory outranks it.'
    # `source_label` is the authority tier; the object the memory was drawn from is its own field,
    # because conflating the two would make provenance unreadable.
    if item.get('source_changed') is True:
        item['source_line'] = ('The object this was drawn from has changed since; the remembered '
            'statement may no longer describe it.')
    elif item.get('source_object_label'):
        item['source_line'] = (f'Drawn from {item["source_object_label"]} at revision '
            f'{item.get("source_revision")}')
    return item


def decorate_items(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a page of memory items, including whether they are in force."""

    for item in data.get('items') or []:
        _decorate_item(item)
    data.setdefault('note', LIMITATION)
    data.setdefault('authority_rule', AUTHORITY_RULE)
    return data


def decorate_item(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a single memory write or retirement response."""

    sourced = dict(data)
    sourced.setdefault('source', None)
    sourced.setdefault('origin', 'inferred' if data.get('origin') == 'inferred' else 'declared')
    sourced.setdefault('in_force', True)
    _decorate_item(sourced)
    for key in ('source_label', 'origin_label', 'authority_line', 'force_line'):
        if key in sourced and sourced[key] is not None:
            data[key] = sourced[key]
    data.setdefault('authority_rule', AUTHORITY_RULE)
    return data


def decorate_resolve(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to the authority resolution and name what was outranked."""

    for item in data.get('considered') or []:
        item['source_label'] = label_for(SOURCE_LABELS, item.get('source'))
        item['scope_label'] = label_for(SCOPE_LABELS, item.get('scope'))
        item['authority_line'] = f'Tier {item.get("authority_rank")} of 5 - {item["source_label"]}'
        item['force_line'] = ('In force' if item.get('in_force') else 'Outranked')
    resolved = data.get('resolved')
    if isinstance(resolved, dict):
        resolved['source_label'] = label_for(SOURCE_LABELS, resolved.get('source'))
        resolved['scope_label'] = label_for(SCOPE_LABELS, resolved.get('scope'))
    data.setdefault('authority_rule', AUTHORITY_RULE)
    return data


def decorate_candidates(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a candidate page and to the policy that governs it."""

    for item in data.get('items') or []:
        item['state_label'] = label_for(CANDIDATE_STATE_LABELS, item.get('state'))
        item['kind_label'] = label_for(KIND_LABELS, item.get('kind'))
        item['proposed_source_label'] = label_for(SOURCE_LABELS, item.get('proposed_source'))
        if item.get('source_changed') is True:
            item['source_line'] = ('The evidence moved on after this was recorded, so accepting it '
                'is refused. Record a fresh candidate from the current revision.')
    policy = data.get('policy')
    if isinstance(policy, dict):
        data['policy'] = decorate_policy(policy)
    data.setdefault('note', ('A candidate is a proposal drawn from real evidence. It is never a '
        'creator preference until you accept it.'))
    return data


def decorate_policy(policy: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a memory policy, naming whether it is explicit or the default."""

    decorated = dict(policy)
    decorated['scope_label'] = label_for(SCOPE_LABELS, policy.get('scope'))
    decorated['explicit_label'] = ('Set by you' if policy.get('explicit') else 'Default policy')
    decorated['capture_label'] = ('TONDE may record pattern candidates for review.'
        if policy.get('candidate_capture') else 'TONDE will not record pattern candidates.')
    decorated['accept_label'] = ('Accepted candidates become memory automatically.'
        if policy.get('auto_accept_candidates')
        else 'Nothing becomes memory without your explicit decision.')
    return decorated


def decorate_policies(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to the effective policies for each applicable scope."""

    data['policies'] = [decorate_policy(policy) for policy in data.get('policies') or []]
    data.setdefault('note', ('Memory policy decides whether TONDE may record pattern candidates and '
        'whether an accepted candidate becomes memory automatically. It never decides what you are '
        'allowed to instruct.'))
    data.setdefault('authority_rule', AUTHORITY_RULE)
    return data


def decorate_candidate(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to a candidate write or decision response."""

    decorated = dict(data)
    decorated['state_label'] = label_for(CANDIDATE_STATE_LABELS, data.get('state'))
    policy = data.get('policy')
    if isinstance(policy, dict):
        decorated['policy'] = decorate_policy(policy)
    return decorated


def decorate_summary(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to the memory summary, including what is waiting on a decision."""

    candidates = data.get('candidates') or {}
    proposed = int(candidates.get('proposed') or 0)
    items = data.get('items') or {}
    data['summary_line'] = (f"{items.get('active', 0)} remembered item(s) are active; "
        f"{items.get('creator_confirmed', 0)} of them you confirmed.")
    data['candidate_line'] = (f'{proposed} pattern candidate(s) are waiting for your decision.'
        if proposed else 'No pattern candidate is waiting for a decision.')
    data['changed_line'] = (f"{items.get('sources_changed', 0)} remembered item(s) point at an object "
        'that has changed since.' if items.get('sources_changed') else
        'Every remembered item still points at the revision it was drawn from.')
    policy = data.get('policy')
    if isinstance(policy, dict):
        data['policy'] = decorate_policy(policy)
    data.setdefault('limitations', LIMITATION)
    return data


def decorate_search(data: dict[str, Any]) -> dict[str, Any]:
    """Attach display vocabulary to structured search results and describe how they were matched."""

    for item in data.get('results') or []:
        item['entity_label'] = label_for(ENTITY_LABELS, item.get('entity_type'))
        if item.get('source'):
            item['source_label'] = label_for(SOURCE_LABELS, item.get('source'))
        if item.get('state') and item.get('entity_type') == 'memory_item':
            item['state_label'] = label_for(ITEM_STATE_LABELS, item.get('state'))
    for lane in data.get('lanes') or []:
        lane['label'] = label_for(ENTITY_LABELS, lane.get('lane'))
    interpretation = data.get('interpretation')
    if isinstance(interpretation, dict):
        interpretation['kind_labels'] = [label_for(ENTITY_LABELS, kind) for kind in interpretation.get('kinds') or []]
        interpretation['facet_line'] = ('; '.join(
            f"{facet.get('meaning', '')}".strip() for facet in interpretation.get('facets') or [])
            or 'No facet was used: every supported kind was searched within this Production.')
    data.setdefault('search_limitation', SEARCH_LIMITATION)
    data.setdefault('authority_rule', AUTHORITY_RULE)
    return data


class MemoryRepository:
    """Every call goes through the shared RPC helper with this layer's name attached."""

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def summary(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_summary', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id)})

    async def items(self, workspace_id: UUID, production_id: UUID, token: str, *, scope: str | None,
        kind: str | None, subject: str | None, state: str, limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_item_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_scope': scope, 'target_kind': kind, 'target_subject': subject, 'target_state': state,
            'target_limit': limit, 'target_offset': offset})

    async def set_item(self, workspace_id: UUID, production_id: UUID, token: str, *,
        item: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_item_set', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'item': item})

    async def retire_item(self, workspace_id: UUID, production_id: UUID, token: str, *, item_id: UUID,
        reason: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_item_retire', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_item': str(item_id), 'reason_text': reason})

    async def resolve(self, workspace_id: UUID, production_id: UUID, token: str, *, subject: str,
        kind: str | None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_resolve', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_subject': subject, 'target_kind': kind})

    async def policies(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_policy_get', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id)})

    async def set_policy(self, workspace_id: UUID, production_id: UUID, token: str, *,
        policy: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_policy_set', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'policy_record': policy})

    async def candidates(self, workspace_id: UUID, production_id: UUID, token: str, *, state: str,
        limit: int, offset: int) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_candidate_list', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_state': state, 'target_limit': limit, 'target_offset': offset})

    async def record_candidate(self, workspace_id: UUID, production_id: UUID, token: str, *,
        candidate: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_candidate_record', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'candidate': candidate})

    async def decide_candidate(self, workspace_id: UUID, production_id: UUID, token: str, *,
        candidate_id: UUID, decision: str, note: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('memory_candidate_decide', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_candidate': str(candidate_id), 'decision': decision, 'note_text': note})

    async def search(self, workspace_id: UUID, production_id: UUID, token: str, *,
        query: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('production_search', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'query': query})
