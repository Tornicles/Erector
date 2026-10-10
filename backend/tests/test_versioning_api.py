"""Prompt 9D API coverage: version history, branches, restore and merge decisions.

The platform is mocked with httpx.MockTransport. Semantic behaviour (immutable versions, a new
revision for a restore, a branch edit that touches nothing on the mainline, a conflict that is shown
rather than resolved, and an accepted merge that propagates through the 9A impact engine) is proven
against real embedded PostgreSQL in tests/database/prompt9d-versioning.test.mjs. These tests prove
the HTTP path: authorization, the exact RPC payload contract, error translation, and the boundaries
this feature must never cross - a version is never edited, a branch is never a silent copy into the
mainline, a conflicted change is never applied on the creator's behalf, and a merge is not an
approval.
"""

from __future__ import annotations

import json
from copy import deepcopy

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000011'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
DENIED_PRODUCTION = '00000000-0000-4000-8000-000000000099'
SHOT_TWELVE = '00000000-0000-4000-8000-000000000401'
SCENE_TWO = '00000000-0000-4000-8000-000000000301'
STORY = '00000000-0000-4000-8000-000000000601'
VERSION_ONE = '00000000-0000-4000-8000-000000000c01'
VERSION_TWO = '00000000-0000-4000-8000-000000000c02'
VERSION_THREE = '00000000-0000-4000-8000-000000000c03'
BRANCH_ONE = '00000000-0000-4000-8000-000000000d01'
CHANGE_ONE = '00000000-0000-4000-8000-000000000d02'
PROPOSAL_ONE = '00000000-0000-4000-8000-000000000e01'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

RULE = ('A branch is an object-level alternative, not a duplicate Production. Mainline history is never '
    'overwritten: a restore and a merge both create a new current revision.')

LIMITATION = ('Compare shows the meaningful creative fields that differ. It is not a raw JSON diff and it '
    'does not judge which version is better.')


def versions(production: str = PRODUCTION) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{production}/versions'


def version_row(revision: int = 2, identifier: str = VERSION_TWO, **overrides) -> dict:
    row = {'version_id': identifier, 'object_id': SHOT_TWELVE, 'revision': revision, 'branch': 'main',
        'parent_version_id': VERSION_ONE if revision > 1 else None, 'actor_type': 'user',
        'actor_user_id': USER, 'source_action': 'update', 'created_at': '2026-10-05T10:00:00Z',
        'is_current': revision == 2}
    row.update(overrides)
    return row


def history_payload(**overrides) -> dict:
    payload = {'object_id': SHOT_TWELVE, 'object_kind': 'shot', 'object_label': 'Marcus close-up',
        'branch': 'main', 'current_revision': 2,
        'items': [version_row(2), version_row(1, VERSION_ONE, parent_version_id=None, source_action='insert',
            is_current=False)],
        'total': 2, 'limit': 50, 'offset': 0, 'truncated': False,
        'note': 'Versions are immutable records of what the object was. Historical versions are never edited.'}
    payload.update(overrides)
    return payload


def compare_payload(**overrides) -> dict:
    payload = {'object_id': SHOT_TWELVE, 'object_kind': 'shot', 'object_label': 'Marcus close-up',
        'left_version_id': VERSION_ONE, 'left_revision': 1, 'right_version_id': VERSION_TWO, 'right_revision': 2,
        'changes': [{'field': 'title', 'label': 'Title', 'before': 'Marcus enters', 'after': 'Marcus enters, slower'}],
        'change_count': 1,
        'note': 'Only meaningful creative fields are shown, not a raw JSON diff.'}
    payload.update(overrides)
    return payload


def branch_row(**overrides) -> dict:
    row = {'branch_id': BRANCH_ONE, 'name': 'Product-first opening', 'scope': 'scene',
        'scope_object_id': SCENE_TWO, 'scope_object_label': 'Scene 2 Kitchen', 'source_version_id': VERSION_ONE,
        'source_revision': 1, 'state': 'open', 'reason': 'Try the product earlier.',
        'merged_at': None, 'merged_proposal_id': None, 'changes': 1,
        'created_at': '2026-10-05T10:00:00Z', 'updated_at': '2026-10-05T10:00:00Z'}
    row.update(overrides)
    return row


def change_row(**overrides) -> dict:
    row = {'change_id': CHANGE_ONE, 'target_object_id': SCENE_TWO, 'target_label': 'Scene 2 Kitchen',
        'target_kind': 'scene', 'base_version_id': VERSION_ONE, 'base_revision': 1,
        'patch': {'title': 'Scene 2 Kitchen, product first'}, 'changed_fields': ['title'], 'note': 'Lead with it.',
        'state': 'pending', 'applied_version_id': None, 'applied_revision': None, 'current_revision': 1,
        'created_at': '2026-10-05T10:00:00Z'}
    row.update(overrides)
    return row


def preview_payload(**overrides) -> dict:
    payload = {'proposal_id': PROPOSAL_ONE, 'branch_id': BRANCH_ONE, 'branch_name': 'Product-first opening',
        'structure_revision': 42,
        'items': [{'change_id': CHANGE_ONE, 'target_object_id': SCENE_TWO, 'target_label': 'Scene 2 Kitchen',
            'target_kind': 'scene', 'base_revision': 1, 'current_revision': 1, 'changed_fields': ['title'],
            'status': 'clean', 'conflicts': []}],
        'conflicts': [],
        'counts': {'clean': 1, 'conflicted': 0, 'total': 1},
        'impact': {'targets': {SCENE_TWO: {'direct': 2, 'downstream': 3, 'potential': 0, 'total': 5,
            'truncated': False}}, 'note': 'Impact is computed, never applied, by this preview.'},
        'state': 'proposed',
        'note': 'Merge is a proposal. Conflicted changes are never resolved automatically.'}
    payload.update(overrides)
    return payload


def decision_payload(**overrides) -> dict:
    payload = {'proposal_id': PROPOSAL_ONE, 'branch_id': BRANCH_ONE, 'state': 'merged',
        'applied': [{'change_id': CHANGE_ONE, 'target_object_id': SCENE_TWO, 'target_label': 'Scene 2 Kitchen',
            'revision': 2, 'changed_fields': ['title']}],
        'applied_count': 1, 'skipped': [], 'propagation': 'review_changes',
        'impact': [{'object_id': SCENE_TWO, 'analysis_id': '00000000-0000-4000-8000-000000000f01',
            'mode': 'review_changes', 'counts': {'direct': 2, 'downstream': 3, 'total': 5}, 'marked': 2,
            'requiring_review': [{'object_id': SHOT_TWELVE, 'label': 'Marcus close-up', 'reason': 'Approved content is never rewritten silently.'}],
            'locked_skipped': [], 'unresolved_count': 0}],
        'note': 'New mainline revisions were created. Branch history is preserved.'}
    payload.update(overrides)
    return payload


def make_client(*, role: str | None = 'owner', no_migration: bool = False):
    state: dict = {'calls': [], 'writes': [], 'branches': {'items': [branch_row()], 'total': 1, 'limit': 50,
        'offset': 0, 'truncated': False}}

    def fail(code: str, message: str) -> httpx.Response:
        if no_migration:
            return httpx.Response(404, json={'code': 'PGRST202', 'message': f'Could not find the function {message}'})
        return httpx.Response(400, json={'code': code, 'message': message})

    def platform(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        if path == '/rest/v1/workspace_members':
            wanted = request.url.params.get('role') or ''
            if request.url.params.get('workspace_id') != f'eq.{WORKSPACE}' or role is None:
                return httpx.Response(200, json=[])
            if wanted and role not in ('owner', 'admin', 'editor'):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{'role': role}])
        if not path.startswith('/rest/v1/rpc/'):
            return httpx.Response(200, json=[])
        name = path.rsplit('/', 1)[-1]
        payload = json.loads(request.content or b'{}')
        state['calls'].append({'name': name, 'payload': payload})
        if no_migration:
            return fail('PGRST202', name)
        if payload.get('target_workspace') == OTHER_WORKSPACE or payload.get('target_production') == DENIED_PRODUCTION:
            return fail('42501', 'Workspace access denied')
        if name == 'version_list':
            return httpx.Response(200, json=history_payload())
        if name == 'version_get':
            return httpx.Response(200, json={'version_id': VERSION_ONE, 'object_id': SHOT_TWELVE,
                'object_kind': 'shot', 'object_label': 'Marcus close-up', 'revision': 1, 'branch': 'main',
                'parent_version_id': None, 'actor_type': 'user', 'actor_user_id': USER,
                'source_action': 'insert', 'snapshot': {'title': 'Marcus enters', 'revision': 1},
                'created_at': '2026-10-05T09:00:00Z', 'is_current': False,
                'note': 'This is what the object was at revision 1. It cannot be edited.'})
        if name == 'version_compare':
            return httpx.Response(200, json=compare_payload())
        if name == 'version_restore':
            state['writes'].append({'name': name, 'payload': payload})
            if payload.get('target_version') == VERSION_THREE:
                return fail('40001', 'The object changed since you loaded it')
            return httpx.Response(200, json={'object_id': SHOT_TWELVE, 'restored_from_version_id': payload.get('target_version'),
                'restored_from_revision': 1, 'new_revision': 3, 'changed_fields': ['title'],
                'note': 'A new current revision was created from an older version. Nothing was rewound and no history was deleted.'})
        if name == 'branch_list':
            return httpx.Response(200, json=deepcopy(state['branches']))
        if name == 'branch_detail':
            return httpx.Response(200, json={'branch_id': BRANCH_ONE, 'name': 'Product-first opening', 'scope': 'scene',
                'scope_object_id': SCENE_TWO, 'scope_object_label': 'Scene 2 Kitchen', 'source_version_id': VERSION_ONE,
                'source_revision': 1, 'reason': 'Try the product earlier.', 'state': 'open', 'merged_at': None,
                'merged_proposal_id': None, 'changes': [change_row()], 'change_count': 1,
                'note': 'Branch edits never change the mainline. Only an accepted merge does.'})
        if name == 'branch_create':
            state['writes'].append({'name': name, 'payload': payload})
            branch = payload.get('branch') or {}
            return httpx.Response(200, json={'branch_id': BRANCH_ONE, 'name': branch.get('name'),
                'scope': branch.get('scope'), 'scope_object_id': payload.get('scope_object'),
                'source_version_id': branch.get('source_version_id'), 'source_revision': 1, 'state': 'open',
                'note': 'The branch is an alternative. Nothing on the mainline changed.'})
        if name == 'branch_change_set':
            state['writes'].append({'name': name, 'payload': payload})
            change = payload.get('change') or {}
            if change.get('patch', {}).get('sort_order') is not None:
                return fail('22023', 'The field sort_order cannot change on a branch')
            return httpx.Response(200, json={'change_id': CHANGE_ONE, 'branch_id': BRANCH_ONE,
                'target_object_id': change.get('target_object_id'), 'target_label': 'Scene 2 Kitchen',
                'target_kind': 'scene', 'base_revision': 1, 'changed_fields': list(change.get('patch') or {}),
                'state': 'pending', 'note': 'Recorded on the branch. The mainline is unchanged until a merge is accepted.'})
        if name == 'branch_change_clear':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'change_id': payload.get('target_change'), 'state': 'rejected',
                'note': 'The proposed change was discarded. It stays readable as branch history.'})
        if name == 'branch_state_set':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json={'branch_id': payload.get('target_branch'),
                'state': payload.get('desired_state'),
                'note': 'The branch was abandoned. Its history stays readable.'})
        if name == 'merge_preview':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json=preview_payload())
        if name == 'merge_decide':
            state['writes'].append({'name': name, 'payload': payload})
            if payload.get('decision') == 'reject':
                return httpx.Response(200, json={'proposal_id': payload.get('target_proposal'), 'branch_id': BRANCH_ONE,
                    'state': 'rejected', 'applied': [],
                    'note': 'The merge was rejected. The mainline and the branch are unchanged.'})
            return httpx.Response(200, json=decision_payload(propagation=payload.get('propagation')))
        return httpx.Response(200, json=[])

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_secret_key='service-role-key',
        environment='test', ai_provider='none', ai_provider_api_key=None)
    test_client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    test_client.__enter__()
    return test_client, state


# ---------------------------------------------------------------- vocabulary

def test_vocabulary_declares_scopes_states_and_the_modes_a_merge_can_propagate() -> None:
    client, _ = make_client()
    data = client.get(f'{versions()}/vocabulary', headers=HEADERS).json()['data']
    assert [entry['state'] for entry in data['branch_states']] == ['open', 'merged', 'abandoned']
    assert [entry['state'] for entry in data['change_states']] == ['pending', 'applied', 'conflicted', 'rejected']
    assert [entry['mode'] for entry in data['propagation_modes']] == [
        'update_all', 'review_changes', 'change_only_this']
    assert data['scopes'][0]['scope'] == 'story'
    actions = [entry['action'] for entry in data['source_actions']]
    assert 'restore' in actions and 'merge' in actions
    kinds = {entry['kind']: entry for entry in data['branchable_kinds']}
    assert 'shot' in kinds and 'creative_document' in kinds
    assert {'field': 'title', 'label': 'Title'} in kinds['shot']['fields']
    assert 'not a duplicate Production' in data['rule']
    assert 'not a raw JSON diff' in data['limitation']


# ---------------------------------------------------------------- history

def test_a_version_list_needs_the_object_it_belongs_to() -> None:
    client, _ = make_client()
    response = client.get(versions(), headers=HEADERS)
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_VERSION_INPUT'
    response = client.get(f'{versions()}?object_id=not-a-uuid', headers=HEADERS)
    assert response.status_code == 422


def test_listing_versions_reports_history_and_which_revision_is_current() -> None:
    client, state = make_client()
    data = client.get(f'{versions()}?object_id={SHOT_TWELVE}', headers=HEADERS).json()['data']
    latest = data['items'][0]
    assert latest['source_action_label'] == 'Edited'
    assert latest['current_line'] == 'This is the current revision.'
    assert data['items'][1]['source_action_label'] == 'Created'
    assert data['items'][1]['current_line'] == 'History: this is not the current revision.'
    payload = state['calls'][-1]['payload']
    assert payload['target_object'] == SHOT_TWELVE
    assert payload['target_branch'] == 'main' and payload['target_limit'] == 50 and payload['target_offset'] == 0
    assert 'never edited' in data['note']


def test_one_version_shows_what_it_was_and_that_it_cannot_be_edited() -> None:
    client, _ = make_client()
    data = client.get(f'{versions()}/{VERSION_ONE}', headers=HEADERS).json()['data']
    assert data['revision'] == 1
    assert data['snapshot']['title'] == 'Marcus enters'
    assert 'cannot be edited' in data['note']


# ---------------------------------------------------------------- compare

def test_compare_needs_two_different_versions() -> None:
    client, _ = make_client()
    assert client.get(f'{versions()}/compare', headers=HEADERS).status_code == 422
    assert client.get(f'{versions()}/compare?left_version_id={VERSION_ONE}', headers=HEADERS).status_code == 422
    same = client.get(f'{versions()}/compare?left_version_id={VERSION_ONE}&right_version_id={VERSION_ONE}',
        headers=HEADERS)
    assert same.status_code == 422
    assert same.json()['errors'][0]['message'] == 'Compare two different versions.'


def test_compare_shows_meaningful_fields_and_says_what_it_is_not() -> None:
    client, state = make_client()
    data = client.get(f'{versions()}/compare?left_version_id={VERSION_ONE}&right_version_id={VERSION_TWO}',
        headers=HEADERS).json()['data']
    assert data['change_count'] == 1
    assert data['changes'][0]['label'] == 'Title'
    assert data['changes'][0]['before'] == 'Marcus enters'
    assert 'not a raw JSON diff' in data['limitation']
    payload = state['calls'][-1]['payload']
    assert payload['left_version'] == VERSION_ONE and payload['right_version'] == VERSION_TWO


# ---------------------------------------------------------------- restore

def test_restore_posts_the_version_and_reports_the_new_revision() -> None:
    client, state = make_client()
    data = client.post(f'{versions()}/{VERSION_ONE}/restore', headers=HEADERS,
        json={'note': 'Back to the original beat'}).json()['data']
    assert data['new_revision'] == 3
    assert data['restored_from_revision'] == 1
    assert data['changed_field_labels'] == ['Title']
    assert 'Nothing was rewound' in data['note']
    payload = state['writes'][-1]['payload']
    assert payload['target_version'] == VERSION_ONE and payload['note_text'] == 'Back to the original beat'


def test_a_stale_restore_is_a_conflict_rather_than_a_blind_write() -> None:
    client, _ = make_client()
    response = client.post(f'{versions()}/{VERSION_THREE}/restore', headers=HEADERS, json={})
    assert response.status_code == 409
    assert 'STUDIO_CONFLICT' == response.json()['errors'][0]['code']


# ---------------------------------------------------------------- branches

def test_branch_listing_rejects_an_unknown_state_filter() -> None:
    client, _ = make_client()
    response = client.get(f'{versions()}/branches?state=nonsense', headers=HEADERS)
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_VERSION_INPUT'


def test_branch_listing_names_an_alternative_and_what_it_proposes() -> None:
    client, _ = make_client()
    data = client.get(f'{versions()}/branches', headers=HEADERS).json()['data']
    branch = data['items'][0]
    assert branch['state_label'] == 'Open alternative'
    assert branch['scope_label'] == 'Scene'
    assert branch['changes_line'] == '1 proposed change(s) are waiting to be merged.'
    assert 'not a duplicate Production' in data['rule']


def test_creating_a_branch_posts_the_origin_and_refuses_an_unsupported_scope() -> None:
    client, state = make_client()
    created = client.post(f'{versions()}/branches', headers=HEADERS, json={
        'scope_object_id': SCENE_TWO, 'scope': 'scene', 'name': 'Product-first opening',
        'source_version_id': VERSION_ONE, 'reason': 'Try the product earlier.'}).json()['data']
    assert created['state'] == 'open'
    assert 'Nothing on the mainline changed' in created['note']
    payload = state['writes'][-1]['payload']
    assert payload['scope_object'] == SCENE_TWO
    assert payload['branch'] == {'name': 'Product-first opening', 'scope': 'scene',
        'source_version_id': VERSION_ONE, 'reason': 'Try the product earlier.'}
    bad = client.post(f'{versions()}/branches', headers=HEADERS,
        json={'scope_object_id': SCENE_TWO, 'scope': 'kitchen', 'name': 'Nope'})
    assert bad.status_code == 422
    blank = client.post(f'{versions()}/branches', headers=HEADERS,
        json={'scope_object_id': SCENE_TWO, 'scope': 'scene', 'name': '   '})
    assert blank.status_code == 422


def test_a_branch_names_its_proposed_changes_and_keeps_them_as_proposals() -> None:
    client, _ = make_client()
    data = client.get(f'{versions()}/branches/{BRANCH_ONE}', headers=HEADERS).json()['data']
    assert data['change_count'] == 1
    change = data['changes'][0]
    assert change['state_label'] == 'Ready to merge'
    assert change['changed_field_labels'] == ['Title']
    assert 'never change the mainline' in data['note']


def test_recording_a_branch_change_posts_a_field_patch_and_refuses_an_empty_one() -> None:
    client, state = make_client()
    data = client.post(f'{versions()}/branches/{BRANCH_ONE}/changes', headers=HEADERS, json={
        'target_object_id': SCENE_TWO, 'patch': {'title': 'Scene 2 Kitchen, product first'},
        'note': 'Lead with it.'}).json()['data']
    assert data['state_label'] == 'Ready to merge'
    payload = state['writes'][-1]['payload']
    assert payload['change'] == {'target_object_id': SCENE_TWO,
        'patch': {'title': 'Scene 2 Kitchen, product first'}, 'note': 'Lead with it.'}
    empty = client.post(f'{versions()}/branches/{BRANCH_ONE}/changes', headers=HEADERS,
        json={'target_object_id': SCENE_TWO, 'patch': {}})
    assert empty.status_code == 422


def test_an_unsupported_branch_field_is_a_clean_rejection_from_the_database() -> None:
    client, _ = make_client()
    response = client.post(f'{versions()}/branches/{BRANCH_ONE}/changes', headers=HEADERS,
        json={'target_object_id': SCENE_TWO, 'patch': {'sort_order': 5}})
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'STUDIO_INVALID_INPUT'


def test_discarding_a_change_keeps_it_as_history() -> None:
    client, state = make_client()
    data = client.post(f'{versions()}/branches/{BRANCH_ONE}/changes/{CHANGE_ONE}/clear', headers=HEADERS,
        json={'note': 'Drop this idea'}).json()['data']
    assert data['state'] == 'rejected'
    assert 'stays readable' in data['note']
    assert state['writes'][-1]['payload']['target_change'] == CHANGE_ONE


def test_a_branch_is_opened_or_abandoned_here_never_merged() -> None:
    client, _ = make_client()
    refused = client.post(f'{versions()}/branches/{BRANCH_ONE}/state', headers=HEADERS, json={'state': 'merged'})
    assert refused.status_code == 422
    accepted = client.post(f'{versions()}/branches/{BRANCH_ONE}/state', headers=HEADERS,
        json={'state': 'abandoned', 'note': 'Not this one.'}).json()['data']
    assert accepted['state'] == 'abandoned'


# ---------------------------------------------------------------- merge

def test_merge_preview_reports_clean_and_conflicted_changes_and_why() -> None:
    client, state = make_client()
    data = client.post(f'{versions()}/branches/{BRANCH_ONE}/merge-preview', headers=HEADERS).json()['data']
    assert data['counts'] == {'clean': 1, 'conflicted': 0, 'total': 1}
    assert data['counts_line'] == '1 change(s) can merge cleanly.'
    assert data['conflict_line'] == 'No conflict: the mainline has not moved since these changes were written.'
    assert data['items'][0]['state_label'] == 'Ready to merge'
    assert 'Merge is a proposal' in data['note']
    assert 'computed, never applied' in data['impact']['note']
    assert state['writes'][-1]['payload']['target_branch'] == BRANCH_ONE


def test_merge_preview_states_a_conflict_instead_of_hiding_it() -> None:
    client, state = make_client()
    state['branches']['items'][0]['state'] = 'open'
    conflicted = preview_payload(counts={'clean': 0, 'conflicted': 1, 'total': 1}, items=[
        {'change_id': CHANGE_ONE, 'target_object_id': SCENE_TWO, 'target_label': 'Scene 2 Kitchen',
            'target_kind': 'scene', 'base_revision': 1, 'current_revision': 2, 'changed_fields': ['title'],
            'status': 'conflict', 'conflicts': [{'field': 'title', 'label': 'Title',
                'branch_value': 'Scene 2 Kitchen, product first', 'main_value': 'Scene 2 Kitchen, rewritten',
                'base_value': 'Scene 2 Kitchen'}]}],
        conflicts=[{'change_id': CHANGE_ONE, 'target_object_id': SCENE_TWO, 'target_label': 'Scene 2 Kitchen',
            'base_revision': 1, 'current_revision': 2, 'reason': 'The mainline moved after this branch change was written.',
            'fields': [{'field': 'title', 'label': 'Title', 'branch_value': 'a', 'main_value': 'b', 'base_value': 'c'}]}])

    def with_conflict(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        if path == '/rest/v1/workspace_members':
            return httpx.Response(200, json=[{'role': 'owner'}])
        if path.endswith('/merge_preview'):
            return httpx.Response(200, json=conflicted)
        return httpx.Response(200, json={})

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_secret_key='service-role-key',
        environment='test', ai_provider='none', ai_provider_api_key=None)
    client = TestClient(create_app(settings, httpx.MockTransport(with_conflict)))
    client.__enter__()
    data = client.post(f'{versions()}/branches/{BRANCH_ONE}/merge-preview', headers=HEADERS).json()['data']
    assert data['counts_line'] == '0 change(s) can merge cleanly and 1 conflict(s) need your decision.'
    assert 'shown, never resolved automatically' in data['conflict_line']
    assert data['items'][0]['state_label'] == 'Conflicted'
    assert data['conflicts'][0]['fields'][0]['label'] == 'Title'


def test_a_merge_decision_posts_the_scope_and_the_propagation_it_chose() -> None:
    client, state = make_client()
    data = client.post(f'{versions()}/merges/{PROPOSAL_ONE}/decide', headers=HEADERS, json={
        'decision': 'merge', 'selected_change_ids': [CHANGE_ONE], 'propagation': 'review_changes',
        'note': 'Ship it.'}).json()['data']
    assert data['state_label'] == 'Merged'
    assert data['applied_line'] == '1 new mainline revision(s) were created. Branch history is preserved.'
    assert data['impact'][0]['mode_label'] == 'Only the dependents I select'
    assert '2 direct and 3 downstream object(s) depend on this' in data['impact'][0]['impact_line']
    assert 'Approved content was flagged for review' in data['impact'][0]['review_line']
    payload = state['writes'][-1]['payload']
    assert payload['target_proposal'] == PROPOSAL_ONE and payload['decision'] == 'merge'
    assert payload['selected_ids'] == [CHANGE_ONE] and payload['propagation'] == 'review_changes'
    assert payload['note_text'] == 'Ship it.'


def test_a_merge_decision_refuses_an_unknown_decision_or_propagation() -> None:
    client, _ = make_client()
    bad_decision = client.post(f'{versions()}/merges/{PROPOSAL_ONE}/decide', headers=HEADERS,
        json={'decision': 'force'})
    assert bad_decision.status_code == 422
    bad_mode = client.post(f'{versions()}/merges/{PROPOSAL_ONE}/decide', headers=HEADERS,
        json={'decision': 'merge', 'propagation': 'rewrite_everything'})
    assert bad_mode.status_code == 422
    bad_change = client.post(f'{versions()}/merges/{PROPOSAL_ONE}/decide', headers=HEADERS,
        json={'decision': 'merge', 'selected_change_ids': ['nope']})
    assert bad_change.status_code == 422


def test_rejecting_a_merge_says_nothing_changed() -> None:
    client, _ = make_client()
    data = client.post(f'{versions()}/merges/{PROPOSAL_ONE}/decide', headers=HEADERS,
        json={'decision': 'reject', 'note': 'Not yet.'}).json()['data']
    assert data['state'] == 'rejected'
    assert data['applied_line'] == 'No change was merged.'
    assert 'unchanged' in data['note']


def test_no_merge_decision_is_an_approval() -> None:
    client, _ = make_client()
    data = client.post(f'{versions()}/merges/{PROPOSAL_ONE}/decide', headers=HEADERS,
        json={'decision': 'merge'}).json()['data']
    assert 'approval' not in data
    assert 'approved' not in json.dumps(data).lower() or 'flagged for review' in json.dumps(data)


# ---------------------------------------------------------------- authorization and errors

def test_a_viewer_may_read_history_but_may_not_change_it() -> None:
    client, _ = make_client(role='viewer')
    listing = client.get(f'{versions()}?object_id={SHOT_TWELVE}', headers=HEADERS)
    assert listing.status_code == 200
    assert client.get(f'{versions()}/branches', headers=HEADERS).status_code == 200
    created = client.post(f'{versions()}/branches', headers=HEADERS,
        json={'scope_object_id': SCENE_TWO, 'scope': 'scene', 'name': 'Nope'})
    assert created.status_code == 403
    decided = client.post(f'{versions()}/merges/{PROPOSAL_ONE}/decide', headers=HEADERS, json={'decision': 'merge'})
    assert decided.status_code == 403
    restored = client.post(f'{versions()}/{VERSION_ONE}/restore', headers=HEADERS, json={})
    assert restored.status_code == 403


def test_a_workspace_that_is_not_mine_is_forbidden() -> None:
    client, _ = make_client()
    other = f'/api/v1/workspaces/{OTHER_WORKSPACE}/productions/{PRODUCTION}/versions'
    response = client.get(f'{other}?object_id={SHOT_TWELVE}', headers=HEADERS)
    assert response.status_code == 403
    assert response.json()['errors'][0]['code'] == 'WORKSPACE_ACCESS_DENIED'
    denied = client.get(f'{versions(DENIED_PRODUCTION)}?object_id={SHOT_TWELVE}', headers=HEADERS)
    assert denied.status_code == 403


def test_a_missing_migration_is_reported_as_unavailable_not_as_a_client_error() -> None:
    client, _ = make_client(no_migration=True)
    response = client.get(f'{versions()}?object_id={SHOT_TWELVE}', headers=HEADERS)
    assert response.status_code == 503
    body = response.json()
    assert body['errors'][0]['code'] == 'STUDIO_SCHEMA_MISSING'
    assert 'Production versioning' in body['errors'][0]['message']
