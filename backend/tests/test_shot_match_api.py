"""Prompt 9F API coverage: Results, Shot Match and FIX THIS SHOT.

The platform is mocked with httpx.MockTransport. Semantic behaviour (a Result is what was actually
created and always starts as Needs review, media capability is verified from real media rows so a
visual comparison cannot be claimed without frames, a finding keeps the evidence discipline and never
invents a measured lens or identifies a person, a Real mismatch recommends a pickup and an AI
mismatch recommends regeneration without launching anything, Shot Match never approves a Result, and
a FIX THIS SHOT correction is scoped, previewed, reversible and becomes memory only when a later
analysis confirmed it) is proven against real embedded PostgreSQL in
tests/database/prompt9f-shot-match.test.mjs.

These tests prove the HTTP path: authorization, the exact RPC payload contract, error translation,
and the boundaries this feature must never cross - no similarity score, no fabricated media
capability, no approval produced by Shot Match, and no generation launched by a recommendation.
"""

from __future__ import annotations

import json

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000011'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
DENIED_PRODUCTION = '00000000-0000-4000-8000-000000000099'
SHOT_ONE = '00000000-0000-4000-8000-000000000201'
RESULT_ONE = '00000000-0000-4000-8000-000000000f01'
REPORT_ONE = '00000000-0000-4000-8000-000000000f02'
CORRECTION_ONE = '00000000-0000-4000-8000-000000000f03'
PLAN_ONE = '00000000-0000-4000-8000-000000000f04'

HEADERS = {'Authorization': 'Bearer verified-test-session'}

RULE = ('A Result is what was actually created, not the plan. Shot Match diagnoses what is different '
    'and how to fix it: it is not a similarity score, it never approves a Result, and it launches no '
    'generation. Approval and Final stay creator decisions.')
LIMITATION = ('Comparison only uses the modalities verified from real media rows. No visual claim is '
    'made without extracted frames or an image, no audio claim without an audio track, and no lens, '
    'person or identity is ever measured or identified from imagery.')

CAPABILITIES = {'metadata': True, 'thumbnail': True, 'image': True, 'video_frames': True,
    'audio': False, 'text': False, 'media_state': 'uploaded/ready', 'file_category': 'video',
    'mime_type': 'video/mp4',
    'notes': ['No audio track was extracted, so audio comparison is not claimed.']}


def base(production: str = PRODUCTION) -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/productions/{production}'


def result_payload(**overrides) -> dict:
    payload = {
        'result_id': RESULT_ONE, 'shot_id': SHOT_ONE, 'state': 'needs_review', 'approval': 'draft',
        'revision': 1, 'origin': 'real_take',
        'provenance': {'origin': 'real_take', 'take_id': PLAN_ONE, 'take_number': 1,
            'take_status': 'preferred', 'media_state': 'uploaded/ready'},
        'capabilities': CAPABILITIES,
        'links': {'shot_id': SHOT_ONE, 'execution_plan_method': 'real', 'execution_plan_revision': 1,
            'media_id': PLAN_ONE},
        'match_reports': 1, 'match_worst_severity': 'critical', 'match_recommendation': 'pickup_required',
        'note': 'A new Result starts as Needs review.',
    }
    payload.update(overrides)
    return payload


def report_payload(**overrides) -> dict:
    payload = {
        'report_id': REPORT_ONE, 'shot_id': SHOT_ONE, 'shot_label': 'Shot 1 Marcus enters',
        'result_id': RESULT_ONE, 'result_state': 'needs_review', 'state': 'complete',
        'severity': 'critical', 'approval': 'draft', 'decision': None, 'origin': 'creator',
        'recommendation': 'pickup_required', 'capabilities': CAPABILITIES,
        'findings': [
            {'category': 'product_fidelity', 'verdict': 'mismatch', 'epistemic': 'observed',
             'confidence': 'high', 'severity': 'critical', 'evidence': ['frame 12-40'],
             'difference': 'The Product logo cannot be read',
             'suggested_correction': 'Rotate the Product toward camera',
             'continuity_finding_id': '00000000-0000-4000-8000-000000000f05'},
            {'category': 'color', 'verdict': 'acceptable_variation', 'epistemic': 'observed',
             'confidence': 'medium', 'severity': 'info', 'evidence': ['frame 4'],
             'difference': 'Background colour is slightly cooler than planned'}],
        'dimensions': [{'dimension': 'product_fidelity', 'verdict': 'mismatch', 'findings': 1, 'weight': 95},
            {'dimension': 'color', 'verdict': 'acceptable_variation', 'findings': 1, 'weight': 25}],
        'summary': {
            'what_worked': [{'category': 'color', 'verdict': 'acceptable_variation'}],
            'what_drifted': [{'category': 'product_fidelity', 'verdict': 'mismatch', 'severity': 'critical'}],
            'what_matters_most': [{'category': 'product_fidelity', 'weight': 95,
                'difference': 'The Product logo cannot be read', 'verdict': 'mismatch'}],
            'what_to_fix_next': [{'category': 'product_fidelity', 'fix': 'Rotate the Product toward camera'}],
            'note': 'Ordered by production impact, not by a similarity score.'},
        'limitations': ['No audio track was extracted, so audio comparison is not claimed.'],
        'corrections': [], 'corrected_plan_id': None,
        'iteration_chain': [{'report_id': REPORT_ONE, 'severity': 'critical',
            'recommendation': 'pickup_required', 'decision': None}],
        'note': 'The iteration history is preserved.',
    }
    payload.update(overrides)
    return payload


def correction_payload(**overrides) -> dict:
    payload = {'correction_id': CORRECTION_ONE, 'report_id': REPORT_ONE, 'shot_id': SHOT_ONE,
        'state': 'proposed', 'target_object_id': PLAN_ONE, 'target_kind': 'execution_plan',
        'target_label': 'Real plan', 'source_revision': 1,
        'patch': {'camera_height': 'low, at product level'},
        'root_cause': 'The camera was higher than planned, so the Product read as secondary',
        'why': 'Current Result makes the Product secondary to the Character',
        'affected': 'Shot 1 Real Execution Plan only', 'recommendation': 'pickup_required',
        'preview': {'analysis_id': '00000000-0000-4000-8000-000000000f06',
            'counts': {'direct': 1, 'downstream': 2, 'potential': 0, 'total': 3},
            'note': 'Impact is computed by this proposal.'},
        'note': 'The correction is a proposal.'}
    payload.update(overrides)
    return payload


def make_client(*, role: str | None = 'owner', no_migration: bool = False, stale: bool = False,
    locked: bool = False, unavailable: bool = False):
    state: dict = {'calls': [], 'writes': []}

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
        if name == 'result_list':
            return httpx.Response(200, json={'items': [result_payload()], 'total': 1, 'limit': 50, 'offset': 0,
                'note': 'A Result is what was created, not the plan.'})
        if name == 'result_register':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json=result_payload())
        if name == 'result_detail':
            return httpx.Response(200, json=result_payload(plan={'plan_id': PLAN_ONE,
                'execution_method': 'real', 'approval': 'draft', 'revision': 1, 'framing': 'Product lower third'},
                version_count=2, match_reports=[{'report_id': REPORT_ONE, 'severity': 'critical',
                    'recommendation': 'pickup_required', 'decision': None, 'origin': 'creator'}],
                note='The Result keeps its revision history.'))
        if name == 'result_state_set':
            state['writes'].append({'name': name, 'payload': payload})
            if payload.get('desired_state') == 'final' and not payload.get('expected_revision'):
                return fail('23514', 'A Result becomes Final only after a creator approved it')
            return httpx.Response(200, json={'result_id': RESULT_ONE, 'state': payload.get('desired_state'),
                'previous_state': 'needs_review', 'approval': 'approved', 'revision': 4, 'note': '',
                'meaning': 'A creator accepted this Result. Shot Match never approves a Result.'})
        if name == 'match_analyze':
            state['writes'].append({'name': name, 'payload': payload})
            if unavailable:
                return fail('23514', 'A audio difference cannot be observed from the available media')
            return httpx.Response(200, json=report_payload())
        if name == 'match_reports':
            return httpx.Response(200, json={'items': [{'report_id': REPORT_ONE, 'shot_id': SHOT_ONE,
                'result_id': RESULT_ONE, 'state': 'complete', 'severity': 'critical',
                'recommendation': 'pickup_required', 'decision': None, 'origin': 'creator',
                'approval': 'draft', 'capabilities': CAPABILITIES, 'limitations': ['No audio track was extracted.'],
                'created_at': '2026-10-06T10:00:00Z'}], 'total': 1,
                'note': 'Each report is one analysis in the Shot iteration history.'})
        if name == 'match_report_get':
            return httpx.Response(200, json=report_payload())
        if name == 'match_report_decide':
            state['writes'].append({'name': name, 'payload': payload})
            if payload.get('decision_value') == 'nonsense':
                return fail('22023', 'A Shot Match decision is pickup, regeneration, accepted or dismiss')
            return httpx.Response(200, json={'report_id': REPORT_ONE, 'shot_id': SHOT_ONE,
                'decision': payload.get('decision_value'), 'approval': 'approved',
                'recommendation': 'pickup_required',
                'capture_status': 'pickup_needed' if payload.get('decision_value') == 'pickup' else None,
                'note': 'Regeneration is recommended. Nothing was launched: generation still needs the normal '
                    'explicit confirmation.' if payload.get('decision_value') == 'regeneration'
                    else 'The Shot is marked for a pickup in the On-Set capture state. The Result itself is unchanged.',
                'meaning': 'Deciding a Shot Match report is not an approval of the Result.'})
        if name == 'match_correction_propose':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json=correction_payload())
        if name == 'match_correction_apply':
            state['writes'].append({'name': name, 'payload': payload})
            if stale:
                return fail('40001', 'That correction was proposed against a different revision')
            if locked:
                return fail('23514', 'That object is locked. Unlock it deliberately before applying a correction.')
            if payload.get('record_candidate'):
                return fail('23514', 'A correction does not become reusable memory until a later Shot Match '
                    'confirms it helped')
            return httpx.Response(200, json=correction_payload(state='applied', applied_revision=2,
                applied_version_id='00000000-0000-4000-8000-000000000f07',
                changed_fields=['camera_height'],
                propagation=[{'counts': {'direct': 1, 'downstream': 2}, 'marked': 2, 'requiring_review': 0,
                    'locked_skipped': 0, 'unresolved_count': 0}],
                candidate=None, note='A new revision was created.'))
        if name == 'match_correction_reject':
            state['writes'].append({'name': name, 'payload': payload})
            return httpx.Response(200, json=correction_payload(state='rejected',
                note='The correction was rejected. Nothing changed and nothing was overwritten.'))
        return httpx.Response(200, json=[])

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_secret_key='service-role-key',
        environment='test', ai_provider='none', ai_provider_api_key=None)
    test_client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    test_client.__enter__()
    return test_client, state


def all_keys(data: object) -> set[str]:
    """Every key anywhere in a response, so a score cannot hide in a nested object."""

    found: set[str] = set()
    if isinstance(data, dict):
        for key, value in data.items():
            found.add(str(key))
            found |= all_keys(value)
    elif isinstance(data, list):
        for item in data:
            found |= all_keys(item)
    return found


# ---------------------------------------------------------------- vocabulary

def test_vocabulary_declares_result_states_verdicts_and_recommendations() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/shot-match/vocabulary', headers=HEADERS).json()['data']
    assert [entry['state'] for entry in data['result_states']] == [
        'raw', 'needs_review', 'approved', 'rejected', 'final']
    assert [entry['verdict'] for entry in data['match_verdicts']] == [
        'matches_intent', 'acceptable_variation', 'needs_attention', 'mismatch', 'unknown']
    assert [entry['state'] for entry in data['correction_states']] == ['proposed', 'applied', 'rejected']
    assert [entry['recommendation'] for entry in data['correction_recommendations']] == [
        'none', 'pickup_required', 'regeneration_recommended', 'both']
    assert [entry['origin'] for entry in data['result_origins']] == [
        'real_take', 'ai_generation', 'hybrid', 'manual_import']
    assert 'not a similarity score' in data['rule']
    assert 'launches no generation' in data['rule']
    assert 'no lens' in data['limitation']


# ---------------------------------------------------------------- Results

def test_listing_results_reports_provenance_and_verified_capability() -> None:
    client, state = make_client()
    data = client.get(f'{base()}/results?shot_id={SHOT_ONE}&limit=10', headers=HEADERS).json()['data']
    item = data['items'][0]
    assert item['origin_label'] == 'Real Take'
    assert item['state_label'] == 'Needs review'
    assert item['match_recommendation_label'] == 'Pickup required'
    assert item['capability_line'] == 'Compared from metadata, a thumbnail, an image, extracted frames.'
    assert item['provenance']['take_number'] == 1
    assert 'score' not in all_keys(data)
    call = next(entry for entry in state['calls'] if entry['name'] == 'result_list')
    assert call['payload'] == {'target_workspace': WORKSPACE, 'target_production': PRODUCTION,
        'target_shot': SHOT_ONE, 'target_state': None, 'max_rows': 10, 'skip_rows': 0}


def test_a_new_result_is_surfaced_as_needs_review_and_never_as_approved() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/results', headers=HEADERS, json={
        'shot_id': SHOT_ONE, 'origin': 'real_take', 'take_id': PLAN_ONE})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['state'] == 'needs_review' and data['state_label'] == 'Needs review'
    assert data['approval'] == 'draft'
    assert 'Final is explicitly accepted' in data['final_line']
    write = next(entry for entry in state['writes'] if entry['name'] == 'result_register')
    assert write['payload']['payload'] == {'shot_id': SHOT_ONE, 'origin': 'real_take',
        'take_id': PLAN_ONE, 'note': ''}, 'the contract is sent explicitly, not inferred by the view'


def test_registering_a_result_requires_a_real_source() -> None:
    client, _ = make_client()
    missing_take = client.post(f'{base()}/results', headers=HEADERS, json={
        'shot_id': SHOT_ONE, 'origin': 'real_take'})
    assert missing_take.status_code == 422
    assert 'must name the Take' in missing_take.json()['errors'][0]['message']
    missing_attempt = client.post(f'{base()}/results', headers=HEADERS, json={
        'shot_id': SHOT_ONE, 'origin': 'ai_generation'})
    assert missing_attempt.status_code == 422
    assert 'Attempt or its media' in missing_attempt.json()['errors'][0]['message']
    invented = client.post(f'{base()}/results', headers=HEADERS, json={
        'shot_id': SHOT_ONE, 'origin': 'vibes'})
    assert invented.status_code == 422
    assert invented.json()['errors'][0]['code'] == 'INVALID_SHOT_MATCH_INPUT'


def test_an_observed_difference_without_evidence_is_refused_before_the_database() -> None:
    client, _ = make_client()
    response = client.post(f'{base()}/shots/{SHOT_ONE}/shot-match', headers=HEADERS, json={
        'result_id': RESULT_ONE, 'findings': [
            {'category': 'framing', 'epistemic': 'observed', 'confidence': 'high', 'severity': 'warning',
             'difference': 'Product is off frame'}]})
    assert response.status_code == 422
    assert 'cite the evidence' in response.json()['errors'][0]['message']


def test_an_unsupported_finding_field_is_refused() -> None:
    client, _ = make_client()
    response = client.post(f'{base()}/shots/{SHOT_ONE}/shot-match', headers=HEADERS, json={
        'result_id': RESULT_ONE, 'findings': [
            {'category': 'framing', 'epistemic': 'observed', 'confidence': 'high', 'severity': 'warning',
             'evidence': ['frame 1'], 'person_name': 'Marcus'}]})
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_SHOT_MATCH_INPUT'


def test_result_state_is_a_creator_decision_with_a_bounded_vocabulary() -> None:
    client, state = make_client()
    unsupported = client.post(f'{base()}/results/{RESULT_ONE}/state', headers=HEADERS, json={'state': 'approved-ish'})
    assert unsupported.status_code == 422
    refused = client.post(f'{base()}/results/{RESULT_ONE}/state', headers=HEADERS, json={'state': 'final'})
    assert refused.status_code == 409
    assert refused.json()['errors'][0]['code'] == 'STUDIO_RULE_VIOLATION'
    accepted = client.post(f'{base()}/results/{RESULT_ONE}/state', headers=HEADERS,
        json={'state': 'approved', 'expected_revision': 3, 'note': 'The take reads correctly.'})
    assert accepted.status_code == 200
    data = accepted.json()['data']
    assert data['state'] == 'approved'
    assert 'Shot Match never approves a Result' in data['meaning']
    write = state['writes'][-1]
    assert write['name'] == 'result_state_set'
    assert write['payload']['desired_state'] == 'approved' and write['payload']['expected_revision'] == 3


# ---------------------------------------------------------------- Shot Match

def test_an_analysis_reports_impact_ordering_and_what_it_could_not_see() -> None:
    client, state = make_client()
    response = client.post(f'{base()}/shots/{SHOT_ONE}/shot-match', headers=HEADERS, json={
        'result_id': RESULT_ONE, 'origin': 'creator', 'findings': [
            {'category': 'product_fidelity', 'epistemic': 'observed', 'confidence': 'high',
             'severity': 'critical', 'evidence': ['frame 12-40'],
             'difference': 'The Product logo cannot be read',
             'suggested_correction': 'Rotate the Product toward camera',
             'continuity_domain': 'product_condition'}]})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['severity_label'] == 'Critical'
    assert data['recommendation'] == 'pickup_required'
    assert data['recommendation_label'] == 'Pickup required'
    assert data['origin_label'] == 'Creator statement'
    finding = data['findings'][0]
    assert finding['verdict_label'] == 'Mismatch' and finding['epistemic_label'] == 'Observed'
    assert data['dimensions'][0]['verdict_label'] == 'Mismatch'
    assert data['headline'] == 'The Product logo cannot be read', 'the summary leads with production impact'
    assert data['summary']['note'] == 'Ordered by production impact, not by a similarity score.'
    assert data['limitations'], 'the surface states what it could not compare'
    assert 'score' not in all_keys(data)
    assert 'not a similarity score' in data['rule']
    write = next(entry for entry in state['writes'] if entry['name'] == 'match_analyze')
    assert write['payload']['target_shot'] == SHOT_ONE
    assert write['payload']['payload']['findings'][0]['category'] == 'product_fidelity'


def test_a_claimed_modality_the_database_cannot_verify_is_refused_honestly() -> None:
    client, _ = make_client(unavailable=True)
    response = client.post(f'{base()}/shots/{SHOT_ONE}/shot-match', headers=HEADERS, json={
        'result_id': RESULT_ONE, 'findings': [
            {'category': 'audio', 'epistemic': 'observed', 'confidence': 'medium', 'severity': 'warning',
             'evidence': ['00:00-00:02'], 'difference': 'Dialogue is quieter than planned'}]})
    assert response.status_code == 409
    body = response.json()['errors'][0]
    assert body['code'] == 'STUDIO_RULE_VIOLATION'
    assert 'cannot be observed' in body['message']


def test_an_ai_mismatch_recommends_regeneration_and_launches_nothing() -> None:
    client, state = make_client()
    client.post(f'{base()}/shots/{SHOT_ONE}/shot-match', headers=HEADERS, json={
        'result_id': RESULT_ONE, 'findings': [
            {'category': 'subject_position', 'epistemic': 'observed', 'confidence': 'high',
             'severity': 'critical', 'evidence': ['image'], 'difference': 'Product is off its mark'}]})
    decided = client.post(f'{base()}/shot-match/{REPORT_ONE}/decide', headers=HEADERS,
        json={'decision': 'regeneration', 'note': 'Try a tighter product lock.'})
    assert decided.status_code == 200
    data = decided.json()['data']
    assert data['decision'] == 'regeneration' and data['decision_label'] == 'Regeneration recommended'
    assert 'Nothing was launched' in data['note']
    assert 'not an approval of the Result' in data['meaning']
    write = next(entry for entry in state['writes'] if entry['name'] == 'match_report_decide')
    assert write['payload']['decision_value'] == 'regeneration'
    refused = client.post(f'{base()}/shot-match/{REPORT_ONE}/decide', headers=HEADERS, json={'decision': 'nonsense'})
    assert refused.status_code == 422
    assert 'pickup, regeneration, accepted or dismiss' in refused.json()['errors'][0]['message']


def test_a_pickup_decision_touches_the_on_set_capture_state_only() -> None:
    client, _ = make_client()
    data = client.post(f'{base()}/shot-match/{REPORT_ONE}/decide', headers=HEADERS,
        json={'decision': 'pickup', 'note': 'Pick up the product read.'}).json()['data']
    assert data['capture_status'] == 'pickup_needed'
    assert 'On-Set capture state' in data['note']


def test_one_shot_match_report_is_readable_with_its_iteration_history() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/shot-match/{REPORT_ONE}', headers=HEADERS).json()['data']
    assert data['result_state'] == 'needs_review', 'the analysis never changes the Result state'
    assert data['iteration_chain'] and data['iteration_chain'][0]['report_id'] == REPORT_ONE
    assert data['findings'][0]['continuity_finding_id'], 'a continuity finding links into continuity'
    assert data['capability_line'].startswith('Compared from')
    listing = client.get(f'{base()}/shot-match?result_id={RESULT_ONE}', headers=HEADERS).json()['data']
    assert listing['items'][0]['recommendation_label'] == 'Pickup required'


# ---------------------------------------------------------------- FIX THIS SHOT

def test_a_correction_requires_a_cause_and_returns_a_previewed_impact() -> None:
    client, state = make_client()
    vague = client.post(f'{base()}/shot-match/{REPORT_ONE}/corrections', headers=HEADERS, json={
        'target_object_id': PLAN_ONE, 'patch': {'framing': 'Lower'}, 'root_cause': 'mismatch'})
    assert vague.status_code == 422
    assert 'Explain the production cause' in vague.json()['errors'][0]['message']
    empty = client.post(f'{base()}/shot-match/{REPORT_ONE}/corrections', headers=HEADERS, json={
        'target_object_id': PLAN_ONE, 'patch': {}, 'root_cause': 'The camera was higher than planned'})
    assert empty.status_code == 422
    response = client.post(f'{base()}/shot-match/{REPORT_ONE}/corrections', headers=HEADERS, json={
        'target_object_id': PLAN_ONE, 'patch': {'camera_height': 'low, at product level'},
        'root_cause': 'The camera was higher than planned, so the Product read as secondary',
        'why': 'Current Result makes the Product secondary to the Character',
        'affected': 'Shot 1 Real Execution Plan only'})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['state'] == 'proposed' and data['state_label'] == 'Proposed'
    assert data['preview']['analysis_id']
    assert 'applied only when you accept' in data['impact_line']
    assert data['target_label'] == 'Real plan'
    write = next(entry for entry in state['writes'] if entry['name'] == 'match_correction_propose')
    assert write['payload']['target_report'] == REPORT_ONE


def test_applying_a_correction_is_scoped_and_reports_staleness_and_locks() -> None:
    client, state = make_client()
    applied = client.post(f'{base()}/shot-match/corrections/{CORRECTION_ONE}/apply', headers=HEADERS,
        json={'expected_revision': 1, 'propagation': 'change_only_this', 'note': 'Apply the fix.'})
    assert applied.status_code == 200
    data = applied.json()['data']
    assert data['state'] == 'applied' and data['state_label'] == 'Applied'
    assert data['applied_revision'] == 2 and data['applied_version_id']
    assert data['changed_fields'] == ['camera_height']
    assert data['propagation'][0]['marked'] == 2
    assert 'preserved' in data['preserved_line']
    write = next(entry for entry in state['writes'] if entry['name'] == 'match_correction_apply')
    assert write['payload']['propagation'] == 'change_only_this'
    assert write['payload']['record_candidate'] is False
    bad_mode = client.post(f'{base()}/shot-match/corrections/{CORRECTION_ONE}/apply', headers=HEADERS,
        json={'propagation': 'change_everything'})
    assert bad_mode.status_code == 422

    stale, _ = make_client(stale=True)
    conflict = stale.post(f'{base()}/shot-match/corrections/{CORRECTION_ONE}/apply', headers=HEADERS, json={})
    assert conflict.status_code == 409
    assert conflict.json()['errors'][0]['code'] == 'STUDIO_CONFLICT'

    locked_client, _ = make_client(locked=True)
    locked = locked_client.post(f'{base()}/shot-match/corrections/{CORRECTION_ONE}/apply', headers=HEADERS, json={})
    assert locked.status_code == 409
    assert 'Unlock it deliberately' in locked.json()['errors'][0]['message']


def test_memory_capture_is_refused_until_a_later_analysis_confirmed_the_fix() -> None:
    client, _ = make_client()
    refused = client.post(f'{base()}/shot-match/corrections/{CORRECTION_ONE}/apply', headers=HEADERS,
        json={'record_candidate': True})
    assert refused.status_code == 409
    assert 'later Shot Match' in refused.json()['errors'][0]['message']


def test_rejecting_a_correction_changes_nothing() -> None:
    client, _ = make_client()
    data = client.post(f'{base()}/shot-match/corrections/{CORRECTION_ONE}/reject', headers=HEADERS,
        json={'note': 'Not this time.'}).json()['data']
    assert data['state'] == 'rejected' and data['state_label'] == 'Rejected'
    assert 'Nothing changed' in data['note']


# ---------------------------------------------------------------- boundaries

def test_shot_match_writes_require_an_editor_and_another_workspace_is_denied() -> None:
    viewer, _ = make_client(role='viewer')
    assert viewer.post(f'{base()}/results', headers=HEADERS, json={
        'shot_id': SHOT_ONE, 'origin': 'real_take', 'take_id': PLAN_ONE}).status_code == 403
    assert viewer.post(f'{base()}/shots/{SHOT_ONE}/shot-match', headers=HEADERS, json={
        'result_id': RESULT_ONE, 'findings': [{'category': 'framing', 'evidence': ['frame 1']}]}).status_code == 403
    assert viewer.get(f'{base()}/results', headers=HEADERS).status_code == 200, 'a viewer may read results'

    outsider, _ = make_client(role=None)
    assert outsider.get(f'{base()}/results', headers=HEADERS).status_code == 403

    denied, _ = make_client()
    response = denied.post(f'{base(DENIED_PRODUCTION)}/results', headers=HEADERS, json={
        'shot_id': SHOT_ONE, 'origin': 'real_take', 'take_id': PLAN_ONE})
    assert response.status_code == 403
    assert response.json()['errors'][0]['code'] == 'DIRECTOR_ACCESS_DENIED'


def test_a_deployment_without_the_migration_reports_it_plainly() -> None:
    client, _ = make_client(no_migration=True)
    response = client.get(f'{base()}/results', headers=HEADERS)
    assert response.status_code == 503
    assert response.json()['errors'][0]['code'] == 'STUDIO_SCHEMA_MISSING'
    assert 'Shot match' in response.json()['errors'][0]['message']


def test_a_malformed_identifier_is_refused_without_touching_the_database() -> None:
    client, state = make_client()
    response = client.get(f'{base()}/results/not-a-uuid', headers=HEADERS)
    assert response.status_code == 422
    assert response.json()['errors'][0]['code'] == 'INVALID_SHOT_MATCH_INPUT'
    assert state['calls'] == [], 'a malformed identifier never reaches the database'
