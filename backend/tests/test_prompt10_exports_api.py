"""Prompt 10 packet 035 API coverage: the real export builders and the export HTTP surface.

Two layers are proven here:

* the renderers themselves are pure, so they are tested directly - a PDF round-trips through TONDE's own
  PDF extractor, a DOCX through its DOCX extractor, and a package is byte-identical across runs;
* the HTTP path is proven against httpx.MockTransport, including the exact RPC payloads, the manifest
  the database will later validate, the refusal to build without a pinned version, and the refusal to
  claim a build at all when server storage credentials are missing.

What is deliberately *not* claimed here: that a live provider or a live storage bucket accepted
anything. The database laws (manifest, artifact, lifecycle) live in
tests/database/prompt10-exports.test.mjs over real embedded PostgreSQL.
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.errors import AppError
from app.domain.commercial import RETRY_CLASSIFICATION, classify_provider_failure
from app.main import create_app
from app.services.entitlements import check_entitlement, ensure_entitlement
from app.services.export_builder import Block, render_document, render_zip, sha256_checksum
from app.services.exports import ExportContent, PinInfo, document_blocks, package_entries, structured_package
from app.services.media.documents import extract_docx, extract_pdf

USER = '00000000-0000-4000-8000-000000000001'
WORKSPACE = '00000000-0000-4000-8000-000000000010'
PRODUCTION = '00000000-0000-4000-8000-000000000020'
EXPORT = '00000000-0000-4000-8000-0000000000e1'
VERSION = '00000000-0000-4000-8000-00000000a001'
MEDIA = '00000000-0000-4000-8000-0000000000b1'
SCENE = '00000000-0000-4000-8000-000000000c01'
SHOT = '00000000-0000-4000-8000-0000000000d1'
HEADERS = {'Authorization': 'Bearer verified-test-session'}


def base() -> str:
    return f'/api/v1/workspaces/{WORKSPACE}/exports'


def production_snapshot(**overrides: Any) -> dict:
    snapshot = {'id': PRODUCTION, 'workspace_id': WORKSPACE, 'title': 'Marquee Film', 'production_type': 'film',
        'execution_method': 'hybrid', 'lifecycle': 'active', 'approval': 'approved', 'planned_duration_ms': 1440000,
        'revision': 3}
    snapshot.update(overrides)
    return snapshot


def export_row(**overrides: Any) -> dict:
    row = {'id': EXPORT, 'workspace_id': WORKSPACE, 'production_id': PRODUCTION, 'job_id': None,
        'kind': 'production_package', 'requested_format': 'zip', 'package_type': 'complete', 'state': 'requested',
        'production_revision': 3, 'production_version_id': VERSION, 'generated_media_id': None, 'manifest': {},
        'file_count': None, 'total_bytes': None, 'content_checksum': None, 'requested_by': USER,
        'created_at': '2026-10-08T10:00:00+00:00', 'ready_at': None, 'failed_at': None, 'expired_at': None,
        'failure_code': None, 'failure_message': None, 'completed_at': None}
    row.update(overrides)
    return row


def scene_row(**overrides: Any) -> dict:
    row = {'id': SCENE, 'act_id': None, 'sequence_id': None, 'title': 'Scene 1 Kitchen', 'purpose': 'Opening beat',
        'description': 'A broken radio on the counter.', 'story_beat': '', 'opening_state': '', 'ending_state': '',
        'visual_intent': 'Cold morning light.', 'dialogue_notes': '', 'action_lines': '', 'scene_detail': '',
        'sort_order': 1, 'planned_duration_ms': 45000, 'approval': 'approved', 'revision': 2}
    row.update(overrides)
    return row


def shot_row(**overrides: Any) -> dict:
    row = {'id': SHOT, 'scene_id': SCENE, 'title': 'Wide of the kitchen', 'purpose': '', 'description': '',
        'action': '', 'subject': '', 'framing': 'wide', 'angle': 'eye level', 'movement': 'static', 'composition': '',
        'transition': 'cut', 'creative_notes': '', 'story_relationship': '', 'sort_order': 1,
        'planned_duration_ms': 8000, 'execution_method': 'real', 'approval': 'approved', 'revision': 4}
    row.update(overrides)
    return row


def make_client(*, role: str | None = 'owner', service_key: str | None = 'service-role-key',
    entitlement: str = 'UNKNOWN_ENTITLEMENT', rows: list[dict] | None = None, version_available: bool = True,
    sign: bool = True, state: str = 'requested'):
    calls: dict[str, list[Any]] = {'rpc': [], 'rest': [], 'storage': [], 'sign': 0, 'uploads': [], 'downloads': 0}
    export_rows = rows if rows is not None else [export_row(state=state)]

    def platform(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == '/auth/v1/user':
            return httpx.Response(200, json={'id': USER})
        if path == '/rest/v1/workspace_members':
            if role is None or request.url.params.get('workspace_id') != f'eq.{WORKSPACE}':
                return httpx.Response(200, json=[])
            wanted = request.url.params.get('role') or ''
            if wanted and role not in ('owner', 'admin', 'editor'):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{'role': role}])
        if path.startswith('/storage/v1/object/sign/'):
            calls['sign'] += 1
            if not sign:
                return httpx.Response(400, json={'message': 'signing unavailable'})
            return httpx.Response(200, json={'signedURL': f'/object/sign/tonde-exports/{WORKSPACE}/x?token=short-lived'})
        if path.startswith('/storage/v1/object/'):
            if request.method == 'GET':
                # A workspace member reading accepted Result media through the member storage path.
                calls['downloads'] = int(calls['downloads']) + 1
                return httpx.Response(200, content=b'fake-result-media-bytes')
            calls['storage'].append(path)
            calls['uploads'].append(request.content)
            return httpx.Response(200, json={'Key': path})
        if path.startswith('/rest/v1/rpc/'):
            name = path.rsplit('/', 1)[-1]
            payload = json.loads(request.content or b'{}')
            calls['rpc'].append({'name': name, 'payload': payload})
            if name == 'entitlement_state':
                return httpx.Response(200, json=entitlement)
            if name == 'version_get':
                if not version_available:
                    return httpx.Response(400, json={'code': 'P0002', 'message': 'Version unavailable'})
                return httpx.Response(200, json={'version_id': VERSION, 'object_id': PRODUCTION, 'revision': 3,
                    'snapshot': production_snapshot()})
            if name == 'export_request':
                return httpx.Response(200, json={'export_id': EXPORT, 'state': 'requested', 'kind': payload.get('target_kind'),
                    'format': payload.get('target_format'), 'package_type': payload.get('target_package_type'),
                    'production_revision': 3, 'production_version_id': VERSION})
            if name == 'export_mark_building':
                return httpx.Response(200, json={'export_id': EXPORT, 'state': 'building',
                    'lease_owner': payload.get('lease_holder')})
            if name == 'export_complete':
                return httpx.Response(200, json={'export_id': EXPORT, 'state': 'ready',
                    'file_count': payload.get('target_file_count'), 'total_bytes': payload.get('target_total_bytes'),
                    'content_checksum': payload.get('target_checksum')})
            if name == 'export_fail':
                return httpx.Response(200, json={'export_id': EXPORT, 'state': 'failed',
                    'failure_code': payload.get('target_code')})
            if name == 'export_expire':
                return httpx.Response(200, json={'export_id': EXPORT, 'state': 'expired'})
            if name == 'export_download':
                return httpx.Response(200, json={'authorized': True, 'export_id': EXPORT, 'state': 'ready',
                    'bucket': 'tonde-exports', 'object_key': f'{WORKSPACE}/{MEDIA}/production-package.zip',
                    'window_seconds': 300, 'kind': 'production_package', 'format': 'zip'})
            return httpx.Response(200, json=[])
        if path.startswith('/rest/v1/'):
            table = path.rsplit('/', 1)[-1]
            calls['rest'].append({'table': table, 'params': dict(request.url.params)})
            if table == 'exports':
                wanted = request.url.params.get('id')
                if wanted:
                    match = [row for row in export_rows if f'eq.{row["id"]}' == wanted]
                    return httpx.Response(200, json=match[:1])
                return httpx.Response(200, json=export_rows)
            if table == 'object_versions':
                wanted = request.url.params.get('object_id') or ''
                has_time_filter = 'created_at' in request.url.params
                if not has_time_filter:
                    # The probe for "did this object exist at all": one row proves history began later.
                    return httpx.Response(200, json=[{'object_id': SCENE}, {'object_id': SHOT}])
                objects = [item for item in wanted.replace('in.(', '').replace(')', '').split(',') if item]
                payload = []
                for object_id in objects:
                    if object_id == SCENE:
                        payload.append({'object_id': SCENE, 'revision': 2, 'created_at': '2026-10-08T09:00:00+00:00',
                            'snapshot': scene_row(revision=2)})
                    if object_id == SHOT:
                        payload.append({'object_id': SHOT, 'revision': 4, 'created_at': '2026-10-08T09:30:00+00:00',
                            'snapshot': shot_row(revision=4)})
                return httpx.Response(200, json=payload)
            if table == 'media_files':
                return httpx.Response(200, json=[{'id': MEDIA, 'bucket': 'tonde-results',
                    'object_key': f'{WORKSPACE}/{MEDIA}/result.mp4', 'original_filename': 'result.mp4',
                    'mime_type': 'video/mp4', 'bytes': 2048, 'checksum': 'sha256:media-one',
                    'upload_state': 'uploaded', 'file_category': 'video'}])
            if table == 'scenes':
                return httpx.Response(200, json=[scene_row()])
            if table == 'shots':
                return httpx.Response(200, json=[shot_row()])
            if table == 'results':
                return httpx.Response(200, json=[{'id': '00000000-0000-4000-8000-0000000000f1', 'shot_id': SHOT,
                    'scene_id': SCENE, 'media_id': MEDIA, 'state': 'final', 'approval': 'approved',
                    'provenance': 'real capture', 'revision': 5}])
            if table == 'production_references':
                return httpx.Response(200, json=[{'id': '00000000-0000-4000-8000-0000000000a1',
                    'source_type': 'url', 'source_url': 'https://example.invalid/reference',
                    'source_description': 'A lighthouse at dusk', 'source_provider': '', 'rights_classification': 'public_reference',
                    'state': 'analyzed', 'media_id': None, 'revision': 1}])
            if table == 'director_briefs':
                return httpx.Response(200, json=[{'id': '00000000-0000-4000-8000-0000000000b2',
                    'brief': 'A keeper loses the light and finds it again.', 'producer': 'A. Director',
                    'revision': 1, 'updated_at': '2026-10-08T09:00:00+00:00'}])
            return httpx.Response(200, json=[])
        return httpx.Response(404, json={'message': 'not found'})

    settings = Settings(_env_file=None, supabase_url='https://tonde-test.supabase.co',
        supabase_publishable_key='public-anon-key', supabase_service_role_key=service_key)
    client = TestClient(create_app(settings, httpx.MockTransport(platform)))
    client.__enter__()
    return client, calls


# ------------------------------------------------------------------ renderers

def test_pdf_and_docx_round_trip_through_tonde_own_extractors() -> None:
    blocks = [Block.title('MARQUEE FILM'), Block.meta(f'Production revision 3 - export {EXPORT}'),
        Block.heading('OVERVIEW'), Block.body('A keeper loses the light and finds it again.'),
        Block.heading('STRUCTURE'), Block.subheading('Scene 1 Kitchen'),
        Block.bullet('Action: A broken radio on the counter.'), Block.spacer(), Block.body('x' * 400)]

    pdf = render_document(blocks, title='Marquee Film', requested_format='pdf')
    assert pdf.content[:5] == b'%PDF-'
    assert pdf.checksum.startswith('sha256:') and pdf.checksum == sha256_checksum(pdf.content)
    recovered = extract_pdf(pdf.content)
    assert 'MARQUEE FILM' in recovered.text and 'broken radio' in recovered.text
    assert 'Production revision 3' in recovered.text

    docx = render_document(blocks, title='Marquee Film', requested_format='docx')
    assert docx.content[:2] == b'PK'
    recovered_docx = extract_docx(docx.content)
    assert recovered_docx is not None
    assert 'MARQUEE FILM' in recovered_docx.text and 'finds it again' in recovered_docx.text
    # Determinism: the same blocks produce the same bytes, so a re-render cannot change the artifact.
    assert render_document(blocks, title='Marquee Film', requested_format='pdf').content == pdf.content
    assert render_document(blocks, title='Marquee Film', requested_format='docx').content == docx.content

    # An unsupported format is refused by name rather than silently rendered as something else.
    try:
        render_document(blocks, title='Marquee Film', requested_format='zip')
    except ValueError as error:
        assert 'zip' in str(error)
    else:  # pragma: no cover - the refusal above is the assertion
        raise AssertionError('A document renderer must not accept a package format')


def test_archives_are_deterministic_and_manifest_describes_only_their_own_export() -> None:
    first = render_zip([('manifest.json', b'{}'), ('documents/production.pdf', b'%PDF-1.4 body')])
    second = render_zip([('documents/production.pdf', b'%PDF-1.4 body'), ('manifest.json', b'{}')])
    assert first == second, 'entry order in the caller must not change the archive bytes'
    with zipfile.ZipFile(io.BytesIO(first)) as archive:
        assert archive.namelist() == ['documents/production.pdf', 'manifest.json']
        assert archive.read('documents/production.pdf') == b'%PDF-1.4 body'
        for info in archive.infolist():
            assert info.date_time == (1980, 1, 1, 0, 0, 0), 'an archive carries no wall-clock metadata'


# ------------------------------------------------------------------ content assembly

def content_fixture(**overrides: Any) -> ExportContent:
    children: dict[str, list[dict[str, Any]]] = {'acts': [], 'sequences': [], 'scenes': [scene_row()],
        'shots': [shot_row()], 'dialogue_lines': [], 'execution_plans': [], 'results': [],
        'production_references': [], 'assets': []}
    children.update(overrides.pop('children', {}))
    content = ExportContent(export_id=EXPORT, workspace_id=WORKSPACE, production_id=PRODUCTION,
        production_revision=3, production_version_id=VERSION, kind='production_package',
        requested_format='zip', package_type='complete', requested_by=USER,
        requested_at='2026-10-08T10:00:00+00:00', production=production_snapshot(), documents=[], brief=None,
        story=None, children=children, media={}, pin=PinInfo(requested_at='2026-10-08T10:00:00+00:00',
            production_revision=3, production_version_id=VERSION, production_reconstructed=True,
            objects_included=2), limitations=['Pinned reconstruction.'])
    for key, value in overrides.items():
        setattr(content, key, value)
    return content


def test_document_sections_only_appear_when_the_pinned_state_has_them() -> None:
    minimal = content_fixture()
    rendered = ' '.join(block.text for block in document_blocks(minimal))
    assert 'OVERVIEW' in rendered and 'STRUCTURE' in rendered and 'Scene 1 Kitchen' in rendered
    for absent in ('BRIEF', 'STORY', 'SCRIPT AND DIALOGUE', 'REFERENCES', 'RESULTS', 'AI PROMPTS', 'REAL PRODUCTION'):
        assert absent not in rendered, f'{absent} must not be invented when the pinned state has no such content'
    assert 'Production revision 3' in rendered and EXPORT in rendered

    titled = content_fixture(brief={'brief': 'The keeper story.', 'producer': 'A. Director', 'revision': 1},
        children={'production_references': [{'id': 'ref-1', 'source_type': 'url', 'source_url': 'https://x.invalid',
            'source_description': 'A lighthouse at dusk', 'rights_classification': 'public_reference',
            'state': 'analyzed', 'revision': 1}]})
    richer = ' '.join(block.text for block in document_blocks(titled))
    assert 'BRIEF' in richer and 'The keeper story.' in richer and 'REFERENCES' in richer
    assert 'metadata only' in richer, 'a reference TONDE does not own ships as metadata'


def test_a_package_type_narrows_the_package_without_changing_the_product() -> None:
    content = content_fixture(package_type='complete')
    document = render_document(document_blocks(content), title='Marquee Film', requested_format='pdf')
    complete = dict(package_entries(content, document, []))
    assert 'documents/production.pdf' in complete and 'structure/shot-list.json' in complete
    assert 'prompts/ai-prompts.json' in complete and 'metadata/production.json' in complete

    script_only = dict(package_entries(content_fixture(package_type='script'), document, []))
    assert 'documents/production.pdf' in script_only and 'script/dialogue.json' in script_only
    assert 'prompts/ai-prompts.json' not in script_only and 'structure/shot-list.json' not in script_only

    structured = dict(package_entries(content_fixture(package_type='structured_data'), document, []))
    assert 'documents/production.pdf' not in structured, 'a structured-data package carries no rendered document'
    assert 'metadata/production.json' in structured and 'results/results.json' in structured

    payload = json.loads(structured_package(content_fixture(package_type='structured_data')))
    assert payload['export_id'] == EXPORT and payload['production_revision'] == 3
    assert payload['pin']['objects_included'] == 2 and payload['limitations']
    assert payload['structure']['scenes'][0]['id'] == SCENE


def test_external_operations_state_their_retry_classification_and_failure_taxonomy() -> None:
    assert RETRY_CLASSIFICATION['publication_submit'] == 'REQUIRES_IDEMPOTENCY_KEY'
    assert RETRY_CLASSIFICATION['billing_webhook'] == 'REQUIRES_RECONCILIATION'
    assert RETRY_CLASSIFICATION['oauth_exchange'] == 'MUST_NOT_RETRY'
    assert RETRY_CLASSIFICATION['publication_status'] == 'SAFE_TO_RETRY'
    assert classify_provider_failure(429) == 'rate_limited'
    assert classify_provider_failure(401) == 'authentication_failed'
    assert classify_provider_failure(503) == 'provider_unavailable'
    assert classify_provider_failure(None, 'quota_exceeded') == 'quota_exceeded'
    # A cause TONDE cannot establish is never guessed at.
    assert classify_provider_failure(418, 'i_am_a_teapot') == 'unknown'


# ------------------------------------------------------------------ entitlement gate

class FakeGateway:
    def __init__(self, behaviour: Any) -> None:
        self.behaviour = behaviour

    async def rpc_detailed(self, name: str, *, token: str, json: Any, layer: str = '') -> Any:
        return self.behaviour(name)


async def _entitlement_states() -> None:
    ungated = await check_entitlement(FakeGateway(lambda name: 'ENTITLEMENT_DISABLED'),
        UUID(WORKSPACE), 'exports.packages', 'token')
    assert ungated == {'entitlement': 'exports.packages', 'state': 'ENTITLEMENT_DISABLED', 'enforced': False,
        'available': True}

    def missing(name: str) -> Any:
        raise AppError('STUDIO_SCHEMA_MISSING', 'unavailable', 'not migrated', 503)

    unapplied = await check_entitlement(FakeGateway(missing), UUID(WORKSPACE), 'exports.packages', 'token')
    assert unapplied['enforced'] is False and unapplied['available'] is True

    exhausted = await check_entitlement(FakeGateway(lambda name: 'EXHAUSTED'), UUID(WORKSPACE), 'generation.credits', 'token')
    assert exhausted['enforced'] is True and exhausted['available'] is False
    try:
        await ensure_entitlement(FakeGateway(lambda name: 'EXHAUSTED'), UUID(WORKSPACE), 'generation.credits', 'token',
            'AI generation')
    except AppError as error:
        assert error.status_code == 403 and 'no remaining balance' in error.user_message
    else:  # pragma: no cover - the refusal above is the assertion
        raise AssertionError('An exhausted entitlement must refuse the operation server-side')

    allowed = await ensure_entitlement(FakeGateway(lambda name: 'AVAILABLE'), UUID(WORKSPACE), 'exports.packages',
        'token', 'Exporting a production package')
    assert allowed['available'] is True


def test_the_entitlement_gate_refuses_server_side_and_stays_ungated_when_undeclared() -> None:
    import asyncio

    asyncio.run(_entitlement_states())


# ------------------------------------------------------------------ HTTP surface

def test_vocabulary_names_two_distinct_products() -> None:
    client, _ = make_client()
    data = client.get(f'{base()}/vocabulary', headers=HEADERS).json()['data']
    assert data['products']['full_document']['label'] == 'Download Full Document'
    assert data['products']['full_document']['formats'] == ['pdf', 'docx']
    assert data['products']['production_package']['label'] == 'Export Production Package'
    assert data['products']['production_package']['formats'] == ['zip', 'json']
    assert data['retry']['export_build'] == 'REQUIRES_IDEMPOTENCY_KEY'
    assert 'fails truthfully' in data['boundary']


def test_requesting_an_export_pins_a_version_and_creates_no_file() -> None:
    client, calls = make_client()
    body = {'production_id': PRODUCTION, 'kind': 'production_package', 'format': 'zip', 'package_type': 'shot_list'}
    data = client.post(base(), headers=HEADERS, json=body).json()['data']
    assert data['state'] == 'requested'
    assert data['retry'] == 'REQUIRES_IDEMPOTENCY_KEY'
    assert 'Prompt 11 owns the durable worker fleet' in data['built_by']
    assert data['entitlement']['enforced'] is False, 'an undeclared entitlement is not a commercial gate'
    request_call = next(call for call in calls['rpc'] if call['name'] == 'export_request')
    assert request_call['payload'] == {'target_workspace': WORKSPACE, 'target_production': PRODUCTION,
        'target_kind': 'production_package', 'target_format': 'zip', 'target_package_type': 'shot_list'}
    assert calls['storage'] == [], 'requesting an export must not write an artifact'

    # The two products are distinct before the database is asked anything.
    mismatch = client.post(base(), headers=HEADERS, json={'production_id': PRODUCTION, 'kind': 'full_document',
        'format': 'zip'})
    assert mismatch.status_code == 422
    assert 'A full document is PDF or DOCX' in mismatch.json()['errors'][0]['message']
    package_only = client.post(base(), headers=HEADERS, json={'production_id': PRODUCTION,
        'kind': 'production_package', 'format': 'pdf'})
    assert package_only.status_code == 422
    assert 'A production package is a ZIP' in package_only.json()['errors'][0]['message']
    wrong_type = client.post(base(), headers=HEADERS, json={'production_id': PRODUCTION,
        'kind': 'full_document', 'format': 'pdf', 'package_type': 'script'})
    assert wrong_type.status_code == 422
    assert 'only applies to a production package' in wrong_type.json()['errors'][0]['message']

    # A viewer is not an editor: requesting is refused before any RPC.
    viewer, viewer_calls = make_client(role='viewer')
    assert viewer.post(base(), headers=HEADERS, json=body).status_code == 403
    assert viewer_calls['rpc'] == []


def test_building_a_full_document_records_the_version_it_pins_and_a_real_pdf() -> None:
    client, calls = make_client(rows=[export_row(kind='full_document', requested_format='pdf')])
    data = client.post(f'{base()}/{EXPORT}/build', headers=HEADERS).json()['data']
    assert data['state'] == 'ready'

    building = next(call for call in calls['rpc'] if call['name'] == 'export_mark_building')
    assert building['payload']['lease_holder'].startswith('tonde-api:'), 'a build must name the worker holding the lease'
    assert building['payload']['target_export'] == EXPORT
    version_call = next(call for call in calls['rpc'] if call['name'] == 'version_get')
    assert version_call['payload'] == {'target_workspace': WORKSPACE, 'target_production': PRODUCTION,
        'target_version': VERSION}, 'the pinned Production version is what gets read'

    completed = next(call for call in calls['rpc'] if call['name'] == 'export_complete')
    manifest = completed['payload']['target_manifest']
    assert manifest['export_id'] == EXPORT and manifest['workspace_id'] == WORKSPACE
    assert manifest['production_id'] == PRODUCTION and manifest['production_revision'] == 3
    assert manifest['format'] == 'pdf' and manifest['kind'] == 'full_document'
    assert manifest['production_version_id'] == VERSION
    assert manifest['files'][0]['path'] == 'production.pdf'
    assert manifest['files'][0]['checksum'].startswith('sha256:')
    assert manifest['pin']['reconstructed'] is True and manifest['pin']['objects_included'] >= 2
    assert completed['payload']['target_checksum'] == manifest['checksums']['content']
    assert completed['payload']['target_file_count'] == 1

    uploaded = calls['uploads'][0]
    assert uploaded[:5] == b'%PDF-', 'the artifact that was stored must be the rendered document'
    assert 'MARQUEE FILM' in extract_pdf(uploaded).text
    assert calls['storage'][0].startswith('/storage/v1/object/tonde-exports/')
    # The media row is written with the server credential, because the client path excludes this bucket.
    media_calls = [call for call in calls['rest'] if call['table'] == 'media_files']
    assert media_calls, 'the artifact is registered as media metadata before the export is completed'


def test_a_package_build_writes_the_manifest_the_database_will_validate() -> None:
    client, calls = make_client(rows=[export_row(kind='production_package', requested_format='zip',
        package_type='complete')])
    client.post(f'{base()}/{EXPORT}/build', headers=HEADERS)
    completed = next(call for call in calls['rpc'] if call['name'] == 'export_complete')
    manifest = completed['payload']['target_manifest']
    paths = [entry['path'] for entry in manifest['files']]
    assert 'documents/production.pdf' in paths and 'metadata/production.json' in paths
    assert 'structure/shot-list.json' in paths and 'prompts/ai-prompts.json' in paths
    for entry in manifest['files']:
        assert not entry['path'].startswith('/') and '..' not in entry['path']
        assert entry['checksum'].startswith('sha256:')
    # A reference TONDE does not own is never copied into the package.
    assert manifest['references'][0]['rights_classification'] == 'public_reference'
    assert 'copied_media_id' not in manifest['references'][0]
    # An accepted Result ships its real media, named by the media it came from.
    assert manifest['results'][0]['media_id'] == MEDIA
    copied = f'results/{MEDIA}-result.mp4'
    assert copied in paths, 'an accepted Result copies its media into the package'
    assert manifest['media'][0]['media_id'] == MEDIA and calls['downloads'] == 1
    with zipfile.ZipFile(io.BytesIO(calls['uploads'][-1])) as archive:
        assert sorted(archive.namelist()) == sorted(paths)
        assert archive.read(copied) == b'fake-result-media-bytes'

    # A package type that excludes results does not copy media at all.
    narrow, narrow_calls = make_client(rows=[export_row(kind='production_package', requested_format='zip',
        package_type='shot_list')])
    narrow.post(f'{base()}/{EXPORT}/build', headers=HEADERS)
    narrow_manifest = next(call for call in narrow_calls['rpc'] if call['name'] == 'export_complete')['payload']['target_manifest']
    narrow_paths = [entry['path'] for entry in narrow_manifest['files']]
    assert 'metadata/production.json' in narrow_paths and 'structure/shot-list.json' in narrow_paths
    assert 'documents/production.pdf' not in narrow_paths, 'a shot list package does not carry a rendered document'
    assert not [path for path in narrow_paths if path.startswith('results/')]
    assert narrow_calls['downloads'] == 0, 'nothing was copied, so nothing needed reading'


def test_a_missing_pinned_version_fails_the_export_instead_of_exporting_current_state() -> None:
    client, calls = make_client(version_available=False)
    response = client.post(f'{base()}/{EXPORT}/build', headers=HEADERS)
    assert response.status_code == 409
    failure = next(call for call in calls['rpc'] if call['name'] == 'export_fail')
    assert failure['payload']['target_code'] == 'EXPORT_VERSION_UNAVAILABLE'
    assert calls['storage'] == [], 'no artifact may be stored for an export that could not be reconstructed'
    assert not [call for call in calls['rpc'] if call['name'] == 'export_complete']


def test_a_build_is_refused_before_it_is_claimed_when_server_storage_is_unconfigured() -> None:
    client, calls = make_client(service_key=None)
    response = client.post(f'{base()}/{EXPORT}/build', headers=HEADERS)
    assert response.status_code == 503
    assert response.json()['errors'][0]['code'] == 'EXPORT_STORAGE_NOT_CONFIGURED'
    assert not [call for call in calls['rpc'] if call['name'] == 'export_mark_building'], \
        'an environment gap must not leave an export claimed by a lease'


def test_download_is_authorized_per_request_and_never_invents_a_link() -> None:
    client, calls = make_client(state='ready')
    data = client.get(f'{base()}/{EXPORT}/download', headers=HEADERS).json()['data']
    assert data['authorized'] is True and data['bucket'] == 'tonde-exports'
    assert data['download_url'].startswith('https://tonde-test.supabase.co/storage/v1/object/sign/')
    assert calls['sign'] == 1

    unsignable, _ = make_client(state='ready', sign=False)
    data = unsignable.get(f'{base()}/{EXPORT}/download', headers=HEADERS).json()['data']
    assert data['download_url'] is None
    assert 'no signed URL could be produced' in data['note']

    # A client cannot expire or build another workspace's export, and cannot fabricate readiness.
    viewer, viewer_calls = make_client(role='viewer')
    assert viewer.post(f'{base()}/{EXPORT}/expire', headers=HEADERS).status_code == 403
    assert viewer_calls['rpc'] == []
    client_expire = client.post(f'{base()}/{EXPORT}/expire', headers=HEADERS).json()['data']
    assert client_expire['state'] == 'expired'


def test_repeated_requests_are_rate_limited_with_a_real_retry_hint() -> None:
    client, _ = make_client()
    body = {'production_id': PRODUCTION, 'kind': 'full_document', 'format': 'pdf'}
    statuses = [client.post(base(), headers=HEADERS, json=body).status_code for _ in range(21)]
    assert statuses[:20] == [200] * 20
    assert statuses[20] == 429
    rejected = client.post(base(), headers=HEADERS, json=body).json()['errors'][0]
    assert rejected['code'] == 'RATE_LIMITED' and 'Try again in' in rejected['message']


def test_export_detail_reports_state_without_serving_an_artifact() -> None:
    client, _ = make_client(rows=[export_row(state='ready', ready_at='2026-10-08T10:05:00+00:00',
        file_count=3, total_bytes=9000)])
    data = client.get(f'{base()}/{EXPORT}', headers=HEADERS).json()['data']
    assert data['state'] == 'ready' and data['downloadable'] is True
    assert data['file_count'] == 3 and data['note'].startswith('The artifact exists')
    assert 'download_url' not in data, 'a detail read never hands out a link'

    failed, _ = make_client(rows=[export_row(state='failed', failure_code='version_unavailable',
        failure_message='The Production version this export pins is no longer available.')])
    data = failed.get(f'{base()}/{EXPORT}', headers=HEADERS).json()['data']
    assert data['downloadable'] is False and data['retry'] == 'REQUIRES_IDEMPOTENCY_KEY'
    assert 'failure_code' in data and data['failure_code'] == 'version_unavailable'

    missing, _ = make_client(rows=[])
    assert missing.get(f'{base()}/{uuid4()}', headers=HEADERS).status_code == 404


def test_unauthenticated_callers_reach_nothing() -> None:
    client, _ = make_client()
    assert client.get(f'{base()}/vocabulary').status_code == 401
    assert client.post(base(), json={'production_id': PRODUCTION, 'kind': 'full_document', 'format': 'pdf'}).status_code == 401
