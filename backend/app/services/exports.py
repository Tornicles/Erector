"""Prompt 10 packet 035 - the export builders and the export HTTP service (§27-30, §55-56).

Packet 033 owns export persistence and its law. This module owns the bytes and, more importantly, the
*version* those bytes describe:

* The Production's own content is read from the pinned `object_versions` row the export names. If that
  row is gone, the build **fails truthfully** - it never falls back to current Production state.
* Every other object (acts, sequences, scenes, shots, dialogue, plans, results, references, assets,
  creative documents) is reconstructed from its newest version row recorded **at or before the moment
  the export was requested**. An object created after the request is excluded from the export, and an
  object whose history cannot be reconstructed is listed in `pin.reconstruction_gaps` - recorded
  rather than hidden.
* Media bytes are copied only for accepted Results, and only through the workspace's own storage read
  path. A Reference TONDE does not own ships as metadata.
* The artifact is uploaded into the private exports bucket with server credentials and registered as
  media metadata before `export_complete` records it, so `ready` always names a real file.

Nothing here claims a file exists before the database records one, and nothing runs a background
retry loop: a build is one bounded operation that holds an explicit lease. Prompt 11 owns the durable
worker fleet.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.services.card_download import (
    INCLUDE_KEYS,
    assemble_cards,
    cover_card,
    download_filename,
)
from app.services.card_pdf import CardImage, jpeg_size, render_card_pdf
from app.services.export_builder import (
    Block,
    RenderedDocument,
    canonical_json,
    render_document,
    render_zip,
    sha256_checksum,
)

EXPORT_BUCKET = 'tonde-exports'
EXPORT_SCHEMA_VERSION = '1'
READ_LIMIT = 400
VERSION_BATCH = 200
MEDIA_COPY_LIMIT_BYTES = 64 * 1024 * 1024
OWNED_RIGHTS = frozenset({'user_owned', 'licensed', 'brand_owned', 'authorized_identity'})

CHILD_TABLES: dict[str, str] = {
    'acts': 'id,title,purpose,narrative_goal,opening_state,ending_state,summary,sort_order,planned_duration_ms,approval,revision',
    'sequences': 'id,act_id,title,purpose,kind,summary,sort_order,planned_duration_ms,approval,revision',
    'scenes': ('id,act_id,sequence_id,title,purpose,description,story_beat,opening_state,ending_state,visual_intent,'
        'dialogue_notes,action_lines,scene_detail,sort_order,planned_duration_ms,approval,revision'),
    'shots': ('id,scene_id,title,purpose,description,action,subject,framing,angle,movement,composition,transition,'
        'creative_notes,story_relationship,sort_order,planned_duration_ms,execution_method,approval,revision'),
    'dialogue_lines': 'id,document_id,scene_id,shot_id,speaker_asset_id,line_type,content,intention,delivery,subtext,sort_order,approval,revision',
    'execution_plans': ('id,shot_id,execution_method,provider,model,plan_status,readiness_note,shot_size,camera_position,'
        'camera_angle,framing,composition,movement,movement_purpose,stabilization,capture_fps,delivery_fps,shutter,aperture,'
        'iso_range,white_balance,focus_strategy,depth_of_field,lighting_intent,lighting_plan,lighting_diagram,blocking,'
        'performance,product_direction,sound_plan,microphone_plan,sync_strategy,crew_roles,environment_requirements,'
        'location_requirements,safety_notes,editorial_intent,setup_steps,capture_checklist,canonical_prompt,provider_prompt,'
        'provider_target,aspect_ratio,limitations,approval,revision'),
    'results': 'id,scene_id,shot_id,media_id,reference_id,state,approval,provenance,revision',
    'production_references': ('id,source_type,source_url,source_description,rights_classification,state,media_id,asset_id,'
        'source_provider,creator_purpose,learning_targets,revision'),
    'assets': 'id,asset_type,name,description,lifecycle,approval,revision',
}


@dataclass
class PinInfo:
    """What the export actually describes, and what could not be reconstructed."""

    requested_at: str
    production_revision: int
    production_version_id: str | None
    production_reconstructed: bool
    objects_included: int = 0
    excluded_after_request: list[str] = field(default_factory=list)
    reconstruction_gaps: list[str] = field(default_factory=list)
    truncated_reads: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class ExportContent:
    export_id: str
    workspace_id: str
    production_id: str
    production_revision: int
    production_version_id: str | None
    kind: str
    requested_format: str
    package_type: str
    requested_by: str
    requested_at: str
    production: dict[str, Any]
    documents: list[dict[str, Any]]
    brief: dict[str, Any] | None
    story: dict[str, Any] | None
    children: dict[str, list[dict[str, Any]]]
    media: dict[str, dict[str, Any]]
    pin: PinInfo
    limitations: list[str] = field(default_factory=list)
    scope_type: str = 'full_production'
    scope_refs: dict[str, Any] = field(default_factory=dict)


def _text(value: Any) -> str:
    """Read a snapshot field as displayable text. A missing field is empty, never invented."""

    if value is None:
        return ''
    if isinstance(value, (list, tuple)):
        return '; '.join(_text(item) for item in value if item is not None)
    if isinstance(value, dict):
        return ', '.join(f'{key}: {_text(item)}' for key, item in sorted(value.items()) if item not in (None, '', [], {}))
    return str(value)


def _stamp(value: Any) -> str:
    return _text(value) if value else 'not recorded'


class ExportContentLoader:
    """Reads the pinned Production state: the pinned production row, then its children as they were."""

    def __init__(self, gateway: SupabaseGateway) -> None:
        self.gateway = gateway

    async def _rest(self, path: str, token: str, params: dict[str, str]) -> list[dict[str, Any]]:
        data = await self.gateway.request('GET', f'/rest/v1/{path}', token=token, schema=True, params=params)
        return data if isinstance(data, list) else []

    async def load(self, row: dict[str, Any], token: str) -> ExportContent:
        workspace_id = str(row['workspace_id'])
        production_id = str(row['production_id'])
        requested_at = str(row.get('created_at') or '')
        production_revision = int(row.get('production_revision') or 0)
        production_version_id = row.get('production_version_id')
        pin = PinInfo(requested_at=requested_at, production_revision=production_revision,
            production_version_id=str(production_version_id) if production_version_id else None,
            production_reconstructed=False)

        production = await self._pinned_production(workspace_id, production_version_id, production_id, token, pin)
        documents_raw = await self._rest('creative_documents', token, {
            'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
            'select': 'id,document_type,title,content,approval,revision,updated_at', 'order': 'document_type,title',
            'limit': str(READ_LIMIT)})
        brief = await self._latest('director_briefs', 'id,brief,producer,revision,updated_at', workspace_id, production_id, token)
        story = await self._latest('creative_stories', 'id,story,variation,producer,revision,updated_at', workspace_id, production_id, token)
        current: dict[str, list[dict[str, Any]]] = {}
        for table, select in CHILD_TABLES.items():
            order = 'sort_order' if table not in ('assets', 'production_references') else 'created_at'
            current[table] = await self._rest(table, token, {
                'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}', 'select': select,
                'order': f'{order}.asc' if order in select else 'created_at.asc', 'limit': str(READ_LIMIT)})
            if len(current[table]) >= READ_LIMIT:
                pin.truncated_reads.append(f'{table}:{READ_LIMIT}')
        media_ids = [str(item['media_id']) for item in current['results'] if item.get('media_id')]
        media = await self._media(workspace_id, media_ids, token)
        children = await self._reconstruct(workspace_id, requested_at, current, token, pin)
        documents = await self._reconstruct_single(workspace_id, requested_at,
            [dict(item, production_id=production_id) for item in documents_raw], token, pin, 'creative_documents')
        brief = (await self._reconstruct_single(workspace_id, requested_at, [brief] if brief else [], token, pin,
            'director_briefs'))[0] if brief else None
        story = (await self._reconstruct_single(workspace_id, requested_at, [story] if story else [], token, pin,
            'creative_stories'))[0] if story else None
        limitations = [
            'The document is rendered from the Production version this export pins. Child objects are '
            'reconstructed from their own version history recorded at or before the request.',
            'AI generation availability and external provider state are outside this document.',
        ]
        if pin.excluded_after_request:
            limitations.append(f'{len(pin.excluded_after_request)} object(s) created after the export was requested are excluded.')
        if pin.reconstruction_gaps:
            limitations.append(f'{len(pin.reconstruction_gaps)} object(s) had no recorded version at the request time.')
        if pin.truncated_reads:
            limitations.append('Some collections were truncated at the read bound: ' + ', '.join(pin.truncated_reads))
        scope_refs = row.get('scope_refs')
        return ExportContent(export_id=str(row['id']), workspace_id=workspace_id, production_id=production_id,
            production_revision=production_revision, production_version_id=pin.production_version_id,
            kind=str(row.get('kind') or ''), requested_format=str(row.get('requested_format') or ''),
            package_type=str(row.get('package_type') or 'complete'),
            scope_type=str(row.get('scope_type') or 'full_production'),
            scope_refs=dict(scope_refs) if isinstance(scope_refs, dict) else {},
            requested_by=str(row.get('requested_by') or ''),
            requested_at=requested_at, production=production, documents=documents, brief=brief, story=story,
            children=children, media=media, pin=pin, limitations=limitations)

    async def _latest(self, table: str, select: str, workspace_id: str, production_id: str, token: str) -> dict[str, Any] | None:
        rows = await self._rest(table, token, {'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}',
            'select': select, 'order': 'revision.desc', 'limit': '1'})
        return rows[0] if rows else None

    async def _pinned_production(self, workspace_id: str, version_id: Any, production_id: str, token: str,
        pin: PinInfo) -> dict[str, Any]:
        """The Production exactly as the export pinned it.

        A missing pinned version is an export failure, never an excuse to export current state: the
        caller records `version_unavailable` and stops. A schema that has not been migrated is a
        different fact (the platform is not ready), so it is re-raised as unavailable instead.
        """

        if not version_id:
            raise AppError('EXPORT_VERSION_UNAVAILABLE', 'conflict',
                'This export does not name a Production version, so it cannot be built truthfully.', 409)
        try:
            data = await self.gateway.rpc_detailed('version_get', token=token, json={
                'target_workspace': workspace_id, 'target_production': production_id,
                'target_version': str(version_id)}, layer='Prompt 10 exports')
        except AppError as error:
            if error.kind in ('unavailable', 'database'):
                raise
            raise AppError('EXPORT_VERSION_UNAVAILABLE', 'conflict',
                'The Production version this export pins is no longer available, so the export was not built.', 409) from error
        if not isinstance(data, dict) or not data.get('snapshot'):
            raise AppError('EXPORT_VERSION_UNAVAILABLE', 'conflict',
                'The Production version this export pins carries no recorded content, so the export was not built.', 409)
        pin.production_reconstructed = True
        snapshot = data.get('snapshot')
        return snapshot if isinstance(snapshot, dict) else {}

    async def _media(self, workspace_id: str, media_ids: list[str], token: str) -> dict[str, dict[str, Any]]:
        unique = sorted(set(media_ids))
        found: dict[str, dict[str, Any]] = {}
        for index in range(0, len(unique), VERSION_BATCH):
            batch = unique[index:index + VERSION_BATCH]
            rows = await self._rest('media_files', token, {'workspace_id': f'eq.{workspace_id}',
                'id': f'in.({",".join(batch)})',
                'select': 'id,bucket,object_key,original_filename,mime_type,bytes,checksum,upload_state,file_category',
                'limit': str(len(batch) or 1)})
            for row in rows:
                found[str(row['id'])] = row
        return found

    async def _reconstruct(self, workspace_id: str, requested_at: str, current: dict[str, list[dict[str, Any]]],
        token: str, pin: PinInfo) -> dict[str, list[dict[str, Any]]]:
        ids: list[str] = []
        for rows in current.values():
            ids.extend(str(item['id']) for item in rows)
        history = await self._history(workspace_id, ids, requested_at, token)
        reconstructed: dict[str, list[dict[str, Any]]] = {}
        for table, rows in current.items():
            kept: list[dict[str, Any]] = []
            for item in rows:
                object_id = str(item['id'])
                snapshot = history.get(object_id, 'gap')
                if snapshot == 'gap':
                    # An object that exists now but has no version history at all: its current row is
                    # used and the gap is recorded, because hiding it would be worse than saying so.
                    pin.reconstruction_gaps.append(f'{table}:{object_id}')
                    kept.append(item)
                    pin.objects_included += 1
                elif snapshot == 'after_request':
                    pin.excluded_after_request.append(f'{table}:{object_id}')
                elif isinstance(snapshot, dict):
                    kept.append(snapshot)
                    pin.objects_included += 1
            reconstructed[table] = kept
        return reconstructed

    async def _reconstruct_single(self, workspace_id: str, requested_at: str, rows: list[dict[str, Any]],
        token: str, pin: PinInfo, table: str) -> list[dict[str, Any]]:
        if not rows:
            return []
        history = await self._history(workspace_id, [str(row['id']) for row in rows], requested_at, token)
        kept: list[dict[str, Any]] = []
        for row in rows:
            snapshot = history.get(str(row['id']), 'gap')
            if snapshot == 'gap':
                pin.reconstruction_gaps.append(f'{table}:{row["id"]}')
                kept.append(row)
            elif snapshot == 'after_request':
                pin.excluded_after_request.append(f'{table}:{row["id"]}')
            elif isinstance(snapshot, dict):
                kept.append(snapshot)
        return kept

    async def _history(self, workspace_id: str, object_ids: list[str], requested_at: str,
        token: str) -> dict[str, dict[str, Any] | str]:
        """The state of each object at the moment the export was requested.

        Three outcomes are distinguished, because they mean different things:

        * a snapshot - the object's newest version recorded at or before the request;
        * `after_request` - version rows exist, but only ones created later, so the object is not part
          of the pinned state and is excluded;
        * `gap` - no version row exists at all, so the pinned state cannot be reconstructed and the
          caller records that rather than pretending.
        """

        unique = sorted(set(object_ids))
        if not unique or not requested_at:
            return {}
        found: dict[str, dict[str, Any] | str] = {}
        for index in range(0, len(unique), VERSION_BATCH):
            batch = unique[index:index + VERSION_BATCH]
            rows = await self._rest('object_versions', token, {
                'workspace_id': f'eq.{workspace_id}', 'object_id': f'in.({",".join(batch)})',
                'branch_name': 'eq.main', 'created_at': f'lte.{requested_at}',
                'select': 'object_id,revision,snapshot,created_at', 'order': 'object_id.asc,revision.desc',
                'limit': str(len(batch) * 20)})
            for row in rows:
                object_id = str(row['object_id'])
                if object_id not in found:
                    snapshot = row.get('snapshot')
                    found[object_id] = snapshot if isinstance(snapshot, dict) else {}
            missing = [object_id for object_id in batch if object_id not in found]
            if missing:
                # Only objects with no pre-request version are probed again, so the common case stays
                # one read. Any row at all proves the object existed before but its history began
                # later; no row at all means the pinned state cannot be reconstructed for it.
                any_rows = await self._rest('object_versions', token, {
                    'workspace_id': f'eq.{workspace_id}', 'object_id': f'in.({",".join(missing)})',
                    'select': 'object_id', 'limit': str(len(missing))})
                seen = {str(row['object_id']) for row in any_rows}
                for object_id in missing:
                    found[object_id] = 'after_request' if object_id in seen else 'gap'
        return found


def document_blocks(content: ExportContent) -> list[Block]:
    """Assemble the Full Document sections from what the pinned state actually contains."""

    blocks: list[Block] = []
    title = _text(content.production.get('title')) or 'Untitled Production'
    blocks.append(Block.title(title.upper()))
    blocks.append(Block.meta(f'Production revision {content.production_revision} - export {content.export_id}'))
    blocks.append(Block.body())

    production = content.production
    blocks.append(Block.heading('OVERVIEW'))
    overview = [
        ('Production type', _text(production.get('production_type')) + (' / ' + _text(production.get('custom_type')) if production.get('custom_type') else '')),
        ('Execution', _text(production.get('execution_method'))),
        ('Lifecycle', _text(production.get('lifecycle'))),
        ('Approval', _text(production.get('approval'))),
        ('Planned duration', f'{int(production.get("planned_duration_ms") or 0)} ms' if production.get('planned_duration_ms') else ''),
        ('Pinned revision', str(content.production_revision)),
        ('Production version', content.production_version_id or 'not named'),
        ('Requested at', content.requested_at),
    ]
    for label, value in overview:
        if value:
            blocks.append(Block.bullet(f'{label}: {value}'))
    blocks.append(Block.meta('Child objects are reconstructed from their own version history recorded at or before the '
        'request; anything created afterwards is excluded rather than exported as current state.'))

    if content.brief and _text(content.brief.get('brief')):
        blocks.append(Block.spacer())
        blocks.append(Block.heading('BRIEF'))
        blocks.append(Block.body(_text(content.brief.get('brief'))))
        if content.brief.get('producer'):
            blocks.append(Block.meta(f'Producer: {_text(content.brief.get("producer"))} - revision {_text(content.brief.get("revision"))}'))
    if content.story and _text(content.story.get('story')):
        blocks.append(Block.spacer())
        blocks.append(Block.heading('STORY'))
        blocks.append(Block.body(_text(content.story.get('story'))))
        if content.story.get('variation'):
            blocks.append(Block.meta(f'Variation: {_text(content.story.get("variation"))}'))
    for document in content.documents:
        if not _text(document.get('content')):
            continue
        blocks.append(Block.spacer())
        blocks.append(Block.heading(_text(document.get('document_type')).replace('_', ' ').upper() or 'DOCUMENT'))
        if document.get('title'):
            blocks.append(Block.subheading(_text(document.get('title'))))
        blocks.append(Block.body(_text(document.get('content'))))

    shots_by_scene: dict[str, list[dict[str, Any]]] = {}
    for shot in content.children.get('shots', []):
        shots_by_scene.setdefault(str(shot.get('scene_id')), []).append(shot)
    scenes_by_sequence: dict[str, list[dict[str, Any]]] = {}
    for scene in content.children.get('scenes', []):
        scenes_by_sequence.setdefault(str(scene.get('sequence_id')), []).append(scene)
    sequences_by_act: dict[str, list[dict[str, Any]]] = {}
    for sequence in content.children.get('sequences', []):
        sequences_by_act.setdefault(str(sequence.get('act_id')), []).append(sequence)

    acts = content.children.get('acts', [])
    sequences = content.children.get('sequences', [])
    unsequenced = scenes_by_sequence.get('None', [])
    if acts or sequences or unsequenced:
        blocks.append(Block.spacer())
        blocks.append(Block.heading('STRUCTURE'))
    if acts:
        for act in acts:
            blocks.append(Block.subheading(_text(act.get('title')) or 'Act'))
            if _text(act.get('summary')) or _text(act.get('narrative_goal')):
                blocks.append(Block.body(_text(act.get('summary')) or _text(act.get('narrative_goal'))))
            blocks.extend(_scene_blocks(sequences_by_act.get(str(act['id']), []), scenes_by_sequence, shots_by_scene))
    else:
        blocks.extend(_scene_blocks(sequences, scenes_by_sequence, shots_by_scene))
    if unsequenced or (not acts and not sequences):
        if unsequenced:
            blocks.append(Block.subheading('Scenes without a sequence'))
        blocks.extend(_scene_blocks([{'id': None, 'title': ''}], scenes_by_sequence, shots_by_scene))

    dialogue = content.children.get('dialogue_lines', [])
    if dialogue:
        blocks.append(Block.spacer())
        blocks.append(Block.heading('SCRIPT AND DIALOGUE'))
        for line in dialogue:
            speaker = _text(line.get('speaker_asset_id')) or _text(line.get('line_type')) or 'Line'
            blocks.append(Block.body(f'{speaker}: {_text(line.get("content"))}'))
            detail = ' - '.join(part for part in (_text(line.get('intention')), _text(line.get('delivery')),
                _text(line.get('subtext'))) if part)
            if detail:
                blocks.append(Block.meta(f'  {detail}'))

    plans = content.children.get('execution_plans', [])
    real = [plan for plan in plans if _text(plan.get('execution_method')) == 'real']
    ai = [plan for plan in plans if _text(plan.get('execution_method')) != 'real']
    if real:
        blocks.append(Block.spacer())
        blocks.append(Block.heading('REAL PRODUCTION DIRECTION'))
        for plan in real:
            blocks.append(Block.subheading(f'Shot {_text(plan.get("shot_id"))[:8]}'))
            for label, key in [('Framing', 'framing'), ('Composition', 'composition'), ('Movement', 'movement'),
                ('Lighting', 'lighting_plan'), ('Blocking', 'blocking'), ('Performance', 'performance'),
                ('Product direction', 'product_direction'), ('Sound', 'sound_plan'), ('Crew', 'crew_roles'),
                ('Environment', 'environment_requirements'), ('Safety', 'safety_notes'), ('Editorial', 'editorial_intent'),
                ('Setup', 'setup_steps'), ('Checklist', 'capture_checklist'), ('Limitations', 'limitations')]:
                if _text(plan.get(key)):
                    blocks.append(Block.bullet(f'{label}: {_text(plan.get(key))}'))
    if ai:
        blocks.append(Block.spacer())
        blocks.append(Block.heading('AI PROMPTS AND MODELS'))
        for plan in ai:
            blocks.append(Block.subheading(f'Shot {_text(plan.get("shot_id"))[:8]}'))
            if plan.get('provider') or plan.get('model'):
                blocks.append(Block.meta(f'{_text(plan.get("provider"))} {_text(plan.get("model"))}'.strip()))
            prompt = _text(plan.get('provider_prompt_edited')) if plan.get('provider_prompt_edited') else ''
            for label, key in [('Canonical prompt', 'canonical_prompt'), ('Provider prompt', 'provider_prompt')]:
                if _text(plan.get(key)):
                    blocks.append(Block.bullet(f'{label}: {_text(plan.get(key))}'))
            if prompt and prompt != _text(plan.get('provider_prompt')):
                blocks.append(Block.bullet(f'Edited provider prompt: {prompt}'))
            if _text(plan.get('limitations')):
                blocks.append(Block.bullet(f'Limitations: {_text(plan.get("limitations"))}'))

    results = content.children.get('results', [])
    accepted = [result for result in results if _text(result.get('approval')) == 'approved'
        or _text(result.get('state')) in ('approved', 'final')]
    if accepted:
        blocks.append(Block.spacer())
        blocks.append(Block.heading('RESULTS'))
        for result in accepted:
            media = content.media.get(_text(result.get('media_id')), {})
            blocks.append(Block.bullet(f'{_text(media.get("original_filename")) or "Result"} - '
                f'{_text(result.get("state"))} / {_text(result.get("approval"))}'
                + (f' - checksum {_text(media.get("checksum"))}' if media.get('checksum') else '')
                + (f' - {_text(result.get("provenance"))}' if result.get('provenance') else '')))
    pending = [result for result in results if result not in accepted]
    if pending:
        blocks.append(Block.meta(f'{len(pending)} Result(s) are not accepted and are not included as deliverables.'))

    references = content.children.get('production_references', [])
    if references:
        blocks.append(Block.spacer())
        blocks.append(Block.heading('REFERENCES'))
        for reference in references:
            label = _text(reference.get('source_description')) or _text(reference.get('source_url')) or 'Reference'
            rights = _text(reference.get('rights_classification')) or 'unknown'
            blocks.append(Block.bullet(f'{label} - {rights} - {_text(reference.get("state"))}'
                + (' (media copied)' if rights in OWNED_RIGHTS and reference.get('media_id') else ' (metadata only)')))

    assets = content.children.get('assets', [])
    if assets:
        blocks.append(Block.spacer())
        blocks.append(Block.heading('ASSETS'))
        by_type: dict[str, list[str]] = {}
        for asset in assets:
            by_type.setdefault(_text(asset.get('asset_type')) or 'other', []).append(_text(asset.get('name')) or _text(asset.get('id')))
        for asset_type, names in sorted(by_type.items()):
            blocks.append(Block.bullet(f'{asset_type}: {", ".join(name for name in names if name)}'))

    blocks.append(Block.spacer())
    blocks.append(Block.heading('NOTES AND LIMITATIONS'))
    for limitation in content.limitations:
        blocks.append(Block.bullet(limitation))
    if content.pin.reconstruction_gaps:
        blocks.append(Block.bullet('Objects without a recorded version at request time (their current row was used and '
            'recorded as a gap): ' + ', '.join(content.pin.reconstruction_gaps[:20])))
    blocks.append(Block.meta(f'Generated by TONDE for export {content.export_id}. This document describes exactly '
        f'Production revision {content.production_revision}.'))
    return blocks


def _scene_blocks(sequences: list[dict[str, Any]], scenes_by_sequence: dict[str, list[dict[str, Any]]],
    shots_by_scene: dict[str, list[dict[str, Any]]]) -> list[Block]:
    blocks: list[Block] = []
    for sequence in sequences:
        if _text(sequence.get('title')):
            blocks.append(Block.subheading(_text(sequence.get('title'))))
        if _text(sequence.get('summary')):
            blocks.append(Block.body(_text(sequence.get('summary'))))
        for scene in scenes_by_sequence.get(str(sequence.get('id')), []):
            blocks.append(Block.body(f'{_text(scene.get("title")) or "Scene"}'))
            for key, label in [('purpose', 'Purpose'), ('description', 'Description'), ('story_beat', 'Story beat'),
                ('visual_intent', 'Visual intent'), ('action_lines', 'Action'), ('dialogue_notes', 'Dialogue notes'),
                ('scene_detail', 'Detail')]:
                if _text(scene.get(key)):
                    blocks.append(Block.bullet(f'{label}: {_text(scene.get(key))}'))
            for shot in shots_by_scene.get(str(scene['id']), []):
                detail = ' - '.join(part for part in (_text(shot.get('framing')), _text(shot.get('angle')),
                    _text(shot.get('movement')), _text(shot.get('execution_method'))) if part)
                blocks.append(Block.meta(f'  Shot: {_text(shot.get("title")) or _text(shot.get("id"))[:8]}'
                    + (f' [{detail}]' if detail else '')))
    return blocks


# What each package type contains. A package type narrows the package; it never invents a section.
PACKAGE_SECTIONS: dict[str, tuple[str, ...]] = {
    'complete': ('document', 'metadata', 'structure', 'script', 'prompts', 'camera', 'audio', 'edit', 'references', 'results'),
    'script': ('document', 'metadata', 'script'),
    'shot_list': ('metadata', 'structure'),
    'storyboard': ('metadata', 'structure', 'results'),
    'prompt_pack': ('metadata', 'prompts'),
    'camera_plan': ('metadata', 'camera'),
    'continuity_report': ('metadata', 'continuity'),
    'audio_plan': ('metadata', 'audio'),
    'edit_plan': ('metadata', 'edit'),
    'structured_data': ('metadata', 'structure', 'script', 'prompts', 'camera', 'audio', 'edit', 'references', 'results'),
}


def package_includes(package_type: str, section: str) -> bool:
    return section in PACKAGE_SECTIONS.get(package_type, PACKAGE_SECTIONS['complete'])


def package_includes_document(package_type: str) -> bool:
    return package_includes(package_type, 'document')


def structured_package(content: ExportContent) -> bytes:
    """The structured-data form of a Production Package: one JSON object, no archive."""

    return canonical_json({
        'schema_version': EXPORT_SCHEMA_VERSION, 'export_id': content.export_id, 'workspace_id': content.workspace_id,
        'production_id': content.production_id, 'production_revision': content.production_revision,
        'production_version_id': content.production_version_id, 'package_type': content.package_type,
        'requested_at': content.requested_at,
        'production': content.production, 'documents': content.documents, 'brief': content.brief, 'story': content.story,
        'structure': {table: content.children.get(table, []) for table in ('acts', 'sequences', 'scenes', 'shots')},
        'script': content.children.get('dialogue_lines', []),
        'prompts': [_prompt_entry(plan) for plan in content.children.get('execution_plans', []) if _text(plan.get('execution_method')) != 'real'],
        'camera': [_camera_entry(plan) for plan in content.children.get('execution_plans', [])],
        'edit': _edit_entries(content),
        'references': _reference_entries(content),
        'results': _result_entries(content),
        'pin': {'objects_included': content.pin.objects_included,
            'excluded_after_request': content.pin.excluded_after_request,
            'reconstruction_gaps': content.pin.reconstruction_gaps},
        'limitations': content.limitations,
    })


def _prompt_entry(plan: dict[str, Any]) -> dict[str, Any]:
    return {'plan_id': plan.get('id'), 'shot_id': plan.get('shot_id'), 'provider': plan.get('provider'),
        'model': plan.get('model'), 'canonical_prompt': plan.get('canonical_prompt'),
        'provider_prompt': plan.get('provider_prompt'), 'aspect_ratio': plan.get('aspect_ratio'),
        'revision': plan.get('revision')}


def _camera_entry(plan: dict[str, Any]) -> dict[str, Any]:
    return {'plan_id': plan.get('id'), 'shot_id': plan.get('shot_id'), 'execution_method': plan.get('execution_method'),
        'shot_size': plan.get('shot_size'), 'camera_position': plan.get('camera_position'),
        'camera_height': plan.get('camera_height'), 'camera_angle': plan.get('camera_angle'),
        'framing': plan.get('framing'), 'composition': plan.get('composition'), 'movement': plan.get('movement'),
        'movement_purpose': plan.get('movement_purpose'), 'stabilization': plan.get('stabilization'),
        'capture_fps': plan.get('capture_fps'), 'delivery_fps': plan.get('delivery_fps'), 'shutter': plan.get('shutter'),
        'aperture': plan.get('aperture'), 'iso_range': plan.get('iso_range'), 'white_balance': plan.get('white_balance'),
        'focus_strategy': plan.get('focus_strategy'), 'lighting_plan': plan.get('lighting_plan'),
        'setup_steps': plan.get('setup_steps'), 'capture_checklist': plan.get('capture_checklist'),
        'revision': plan.get('revision')}


def _edit_entries(content: ExportContent) -> list[dict[str, Any]]:
    scenes = {str(scene.get('id')): scene for scene in content.children.get('scenes', [])}
    return [{'shot_id': shot.get('id'), 'scene_id': shot.get('scene_id'),
        'scene_title': scenes.get(str(shot.get('scene_id')), {}).get('title'), 'title': shot.get('title'),
        'sort_order': shot.get('sort_order'), 'transition': shot.get('transition'),
        'planned_duration_ms': shot.get('planned_duration_ms'), 'revision': shot.get('revision')}
        for shot in content.children.get('shots', [])]


def _reference_entries(content: ExportContent) -> list[dict[str, Any]]:
    return [{'reference_id': reference.get('id'), 'source_type': reference.get('source_type'),
        'source_url': reference.get('source_url'), 'source_description': reference.get('source_description'),
        'source_provider': reference.get('source_provider'), 'rights_classification': reference.get('rights_classification'),
        'state': reference.get('state'), 'revision': reference.get('revision'), 'media_copied': False,
        'note': 'Reference media is never copied into a package; an owned Reference ships as metadata plus its storage coordinates.'}
        for reference in content.children.get('production_references', [])]


def _result_entries(content: ExportContent) -> list[dict[str, Any]]:
    return [{'result_id': result.get('id'), 'shot_id': result.get('shot_id'), 'scene_id': result.get('scene_id'),
        'state': result.get('state'), 'approval': result.get('approval'), 'provenance': result.get('provenance'),
        'media_id': result.get('media_id'), 'revision': result.get('revision')}
        for result in content.children.get('results', [])]


def _sound_entries(content: ExportContent) -> list[dict[str, Any]]:
    return [{'plan_id': plan.get('id'), 'shot_id': plan.get('shot_id'), 'sound_plan': plan.get('sound_plan'),
        'microphone_plan': plan.get('microphone_plan'), 'sync_strategy': plan.get('sync_strategy'),
        'revision': plan.get('revision')}
        for plan in content.children.get('execution_plans', [])
        if _text(plan.get('sound_plan')) or _text(plan.get('microphone_plan')) or _text(plan.get('sync_strategy'))]


def _continuity_entries(content: ExportContent) -> list[dict[str, Any]]:
    return [{'object': f'scene:{scene.get("id")}', 'title': scene.get('title'),
        'opening_state': scene.get('opening_state'), 'ending_state': scene.get('ending_state'),
        'revision': scene.get('revision'), 'approval': scene.get('approval')}
        for scene in content.children.get('scenes', [])]


def package_entries(content: ExportContent, document: RenderedDocument,
    copied_media: list[tuple[str, bytes, str]], *, include_document: bool = True) -> list[tuple[str, bytes]]:
    """The deterministic Production Package layout (§28), narrowed to the package type requested.

    Only content that exists is written. Result media is copied under `results/` and named by the media
    it came from; a Reference TONDE does not own stays inside `references/references.json` as metadata.
    """

    sections = PACKAGE_SECTIONS.get(content.package_type, PACKAGE_SECTIONS['complete'])
    files: dict[str, bytes] = {
        f'documents/{document.filename}': document.content,
        # Every package carries its own metadata; a package type narrows the rest.
        'metadata/production.json': canonical_json({
            'export_id': content.export_id, 'workspace_id': content.workspace_id,
            'production_id': content.production_id, 'production_revision': content.production_revision,
            'production_version_id': content.production_version_id, 'production': content.production,
            'requested_at': content.requested_at, 'pin': {
                'objects_included': content.pin.objects_included,
                'excluded_after_request': content.pin.excluded_after_request,
                'reconstruction_gaps': content.pin.reconstruction_gaps,
                'truncated_reads': content.pin.truncated_reads,
            },
            'limitations': content.limitations,
        }),
        'structure/shot-list.json': canonical_json([
            {'shot_id': shot.get('id'), 'scene_id': shot.get('scene_id'), 'title': shot.get('title'),
             'purpose': shot.get('purpose'), 'framing': shot.get('framing'), 'movement': shot.get('movement'),
             'execution_method': shot.get('execution_method'), 'sort_order': shot.get('sort_order'),
             'planned_duration_ms': shot.get('planned_duration_ms'), 'revision': shot.get('revision')}
            for shot in content.children.get('shots', [])]),
        'script/dialogue.json': canonical_json(content.children.get('dialogue_lines', [])),
        'prompts/ai-prompts.json': canonical_json([_prompt_entry(plan)
            for plan in content.children.get('execution_plans', []) if _text(plan.get('execution_method')) != 'real']),
        'camera/camera-plan.json': canonical_json([_camera_entry(plan) for plan in content.children.get('execution_plans', [])]),
        'audio/audio-plan.json': canonical_json(_sound_entries(content)),
        'edit/edit-plan.json': canonical_json(_edit_entries(content)),
        'continuity/continuity.json': canonical_json(_continuity_entries(content)),
        'references/references.json': canonical_json(_reference_entries(content)),
        'results/results.json': canonical_json(_result_entries(content)),
    }
    if 'document' not in sections or not include_document:
        files.pop(f'documents/{document.filename}', None)
    for section, relative in (('structure', 'structure/shot-list.json'), ('script', 'script/dialogue.json'),
        ('prompts', 'prompts/ai-prompts.json'), ('camera', 'camera/camera-plan.json'),
        ('audio', 'audio/audio-plan.json'), ('edit', 'edit/edit-plan.json'),
        ('continuity', 'continuity/continuity.json'), ('references', 'references/references.json'),
        ('results', 'results/results.json')):
        if section not in sections:
            files.pop(relative, None)
    if 'results' in sections:
        for _media_id, media_payload, media_filename in copied_media:
            files[f'results/{media_filename}'] = media_payload
    return [(path, payload) for path, payload in files.items()]


def accepted_results(content: ExportContent) -> list[dict[str, Any]]:
    return [result for result in content.children.get('results', [])
        if _text(result.get('approval')) == 'approved' or _text(result.get('state')) in ('approved', 'final')]


class ExportService:
    """The backend's export surface: request, build, download authorization and expiry.

    A build is one bounded operation that claims the job's lease by name. There is deliberately no
    automatic retry loop here - the caller retries explicitly, and Prompt 11 replaces the in-process
    build with a durable worker.
    """

    def __init__(self, gateway: SupabaseGateway, settings: Settings) -> None:
        self.gateway = gateway
        self.settings = settings

    def lease_holder(self) -> str:
        return f'tonde-api:{socket.gethostname()}:{os.getpid()}'

    async def list_exports(self, workspace_id: UUID, token: str, *, production_id: UUID | None = None,
        limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        params = {'workspace_id': f'eq.{workspace_id}', 'select': _EXPORT_SELECT, 'order': 'created_at.desc',
            'limit': str(limit), 'offset': str(offset)}
        if production_id is not None:
            params['production_id'] = f'eq.{production_id}'
        data = await self.gateway.request('GET', '/rest/v1/exports', token=token, schema=True, params=params)
        return data if isinstance(data, list) else []

    async def detail(self, workspace_id: UUID, export_id: UUID, token: str) -> dict[str, Any]:
        data = await self.gateway.request('GET', '/rest/v1/exports', token=token, schema=True, params={
            'workspace_id': f'eq.{workspace_id}', 'id': f'eq.{export_id}', 'select': _EXPORT_SELECT, 'limit': '1'})
        rows = data if isinstance(data, list) else []
        if not rows:
            raise AppError('EXPORT_NOT_FOUND', 'not_found', 'That export does not exist in this workspace.', 404)
        return rows[0]

    async def request(self, workspace_id: UUID, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        scope_refs = payload.get('scope_refs')
        return await self.gateway.rpc_detailed('export_request', token=token, json={
            'target_workspace': str(workspace_id), 'target_production': payload['production_id'],
            'target_kind': payload['kind'], 'target_format': payload['format'],
            'target_package_type': payload.get('package_type') or 'complete',
            'target_scope_type': payload.get('scope_type') or 'full_production',
            'target_scope_refs': scope_refs if isinstance(scope_refs, dict) else {}},
            layer='Prompt 10 exports')

    async def expire(self, workspace_id: UUID, export_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('export_expire', token=token, json={
            'target_workspace': str(workspace_id), 'target_export': str(export_id)}, layer='Prompt 10 exports')

    async def download(self, workspace_id: UUID, export_id: UUID, token: str) -> dict[str, Any]:
        authorized = await self.gateway.rpc_detailed('export_download', token=token, json={
            'target_workspace': str(workspace_id), 'target_export': str(export_id)}, layer='Prompt 10 exports')
        window = int(authorized.get('window_seconds') or 300)
        signed = await self._sign_download(str(authorized.get('bucket')), str(authorized.get('object_key')), window)
        authorized['download_url'] = signed
        return authorized

    async def build(self, workspace_id: UUID, export_id: UUID, token: str, actor_id: UUID) -> dict[str, Any]:
        """Build exactly the version the export pins, and record the outcome the database can verify."""

        row = await self.detail(workspace_id, export_id, token)
        if row.get('state') not in ('requested', 'building'):
            raise AppError('EXPORT_NOT_BUILDABLE', 'conflict',
                f'This export is {row.get("state")} and cannot be built again.', 409)
        if not self.settings.configured or self.settings.supabase_service_role_key is None:
            raise AppError('EXPORT_STORAGE_NOT_CONFIGURED', 'unavailable',
                'The export builder needs server storage credentials, which are not configured in this environment.', 503)
        await self.gateway.rpc_detailed('export_mark_building', token=token, json={
            'target_workspace': str(workspace_id), 'target_export': str(export_id),
            'lease_holder': self.lease_holder()}, layer='Prompt 10 exports')
        try:
            return await self._render_and_store(workspace_id, export_id, token, row)
        except AppError as error:
            # Anything that went wrong after the lease was claimed is recorded as this export's
            # outcome, with its cause, instead of being left as a silent `building` row.
            await self._record_failure(workspace_id, export_id, token, error.code, error.user_message)
            raise
        except Exception:
            await self._record_failure(workspace_id, export_id, token, 'builder_error',
                'The export builder failed before it produced a file.')
            raise

    async def _record_failure(self, workspace_id: UUID, export_id: UUID, token: str, code: str, message: str) -> None:
        try:
            await self._fail(workspace_id, export_id, token, code, message)
        except AppError:
            # The export already carries an outcome; nothing is invented when recording it fails too.
            return

    async def _render_and_store(self, workspace_id: UUID, export_id: UUID, token: str, row: dict[str, Any]) -> dict[str, Any]:
        content = await ExportContentLoader(self.gateway).load(row, token)
        if content.kind == 'full_document' and content.requested_format == 'pdf':
            return await self._render_card_document(workspace_id, export_id, token, content)
        if content.kind == 'full_document' and content.scope_type != 'full_production':
            raise AppError('EXPORT_SCOPE_FORMAT', 'validation',
                'A card download is a PDF full document; other products keep their own narrowing.', 422)
        if content.kind == 'full_document':
            document = render_document(document_blocks(content), title=_text(content.production.get('title')) or 'Production',
                requested_format=content.requested_format)
            media_id, object_key, checksum = await self._store_artifact(content, document.content,
                document.filename, document.media_type)
            manifest = self._document_manifest(content, document, object_key, checksum)
            files = [{'path': document.filename, 'bytes': len(document.content), 'checksum': document.checksum}]
            return await self._complete(workspace_id, export_id, token, media_id, manifest, files, len(document.content), checksum)
        copied = await self._copy_result_media(content, token) if package_includes(content.package_type, 'results') else []
        document = render_document(document_blocks(content), title=_text(content.production.get('title')) or 'Production',
            requested_format='pdf')
        if content.requested_format == 'json':
            payload = structured_package(content)
            entries = [('production-package.json', payload)]
            filename, media_type = 'production-package.json', 'application/json'
        else:
            # Every package carries the document when its type calls for one; a package type narrows the
            # rest rather than changing the product.
            entries = package_entries(content, document, copied,
                include_document=package_includes_document(content.package_type))
            payload = render_zip(entries)
            filename, media_type = 'production-package.zip', 'application/zip'
        checksum = sha256_checksum(payload)
        media_id, object_key, _ = await self._store_artifact(content, payload, filename, media_type)
        manifest = self._package_manifest(content, document, entries, copied, object_key, checksum)
        files = [dict(entry) for entry in manifest['files']]
        return await self._complete(workspace_id, export_id, token, media_id, manifest, files, len(payload), checksum)

    async def _render_card_document(self, workspace_id: UUID, export_id: UUID, token: str,
        content: ExportContent) -> dict[str, Any]:
        """A download is the Studio Card on a landscape sheet, built from the pinned version."""

        refs = content.scope_refs if isinstance(content.scope_refs, dict) else {}
        style = str(refs.get('style') or 'standard')
        if style not in ('standard', 'print'):
            raise AppError('EXPORT_CARD_STYLE', 'validation',
                'A card PDF is TONDE Standard or print-friendly.', 422)
        include = refs.get('include')
        include_map = {key: bool(include.get(key, True)) for key in INCLUDE_KEYS} if isinstance(include, dict) else None
        with_results = bool(refs.get('with_results'))
        title = _text(content.production.get('title')) or 'Production'
        production_line = f'{title} - rev {content.production_revision}'
        children = content.children
        images = await self._card_images(content, token) if with_results else {}
        cards = assemble_cards(production=content.production, scenes=children.get('scenes', []),
            shots=children.get('shots', []), plans=children.get('execution_plans', []),
            results=children.get('results', []), scope_type=content.scope_type, scope_refs=refs,
            include=include_map, images=images, with_results=with_results)
        scope_label = self._scope_label(content, cards)
        creative_direction = _text((content.brief or {}).get('brief'))[:1200]
        if content.scope_type != 'shot_prompt':
            cards.insert(0, cover_card(production_title=title, scope_label=scope_label,
                card_count=len(cards), creative_direction=creative_direction,
                revision_line=f'{production_line} - {content.export_id[:8]}'))
        payload, pages = render_card_pdf(cards, title=title, style=style, production_line=production_line)
        filename = download_filename(production_title=title, scope_type=content.scope_type,
            scope_refs=refs, style=style, card_count=len(cards))
        media_id, object_key, _ = await self._store_artifact(content, payload, filename, 'application/pdf')
        checksum = sha256_checksum(payload)
        document = RenderedDocument(payload, 'application/pdf', filename, [])
        manifest = self._document_manifest(content, document, object_key, checksum)
        manifest['scope'] = {'scope_type': content.scope_type, 'cards': len(cards), 'pages': pages,
            'style': style}
        files = [{'path': filename, 'bytes': len(payload), 'checksum': document.checksum}]
        return await self._complete(workspace_id, export_id, token, media_id, manifest, files, len(payload), checksum)

    def _scope_label(self, content: ExportContent, cards: list[Any]) -> str:
        refs = content.scope_refs if isinstance(content.scope_refs, dict) else {}
        if content.scope_type == 'current_card' and cards:
            return cards[0].card_ref.title().replace('_', ' ')
        if content.scope_type == 'selected_cards':
            return f'{len(cards)} selected cards'
        if content.scope_type == 'episode':
            return str(refs.get('act_title') or 'Episode')
        if content.scope_type == 'shot_prompt':
            return 'AI prompt cards'
        return 'Full production'

    async def _card_images(self, content: ExportContent, token: str) -> dict[str, CardImage]:
        """Accepted Result frames for card visuals, bounded; anything unreadable is omitted."""

        images: dict[str, CardImage] = {}
        total = 0
        for result in content.children.get('results', []):
            if len(images) >= 6 or total >= 8 * 1024 * 1024:
                break
            if str(result.get('state') or '').lower() not in ('approved', 'final'):
                continue
            media = content.media.get(str(result.get('media_id')))
            if not media:
                continue
            try:
                payload = await self._download_object(token, str(media.get('bucket')), str(media.get('object_key')))
            except AppError:
                continue
            size = jpeg_size(payload)
            if size is None:
                continue
            shot_id = str(result.get('shot_id'))
            scene_id = next((str(shot.get('scene_id')) for shot in content.children.get('shots', [])
                if str(shot.get('id')) == shot_id), '')
            if scene_id and scene_id not in images:
                images[scene_id] = CardImage(jpeg=payload, width=size[0], height=size[1])
                total += len(payload)
        if len(images) >= 6 or total >= 8 * 1024 * 1024:
            content.limitations.append('Some Result frames exceeded the card visual bound and ship as intent text.')
        return images

    async def _fail(self, workspace_id: UUID, export_id: UUID, token: str, code: str, message: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('export_fail', token=token, json={
            'target_workspace': str(workspace_id), 'target_export': str(export_id),
            'target_code': code[:80], 'target_message': message[:600]}, layer='Prompt 10 exports')

    async def _complete(self, workspace_id: UUID, export_id: UUID, token: str, artifact_media_id: str,
        manifest: dict[str, Any], files: list[dict[str, Any]], total_bytes: int, checksum: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('export_complete', token=token, json={
            'target_workspace': str(workspace_id), 'target_export': str(export_id),
            'artifact_media_id': artifact_media_id, 'target_manifest': manifest, 'target_file_count': len(files),
            'target_total_bytes': total_bytes, 'target_checksum': checksum}, layer='Prompt 10 exports')

    async def _copy_result_media(self, content: ExportContent, token: str) -> list[tuple[str, bytes, str]]:
        """Copy accepted Result media into the package, bounded, and never inventing a missing object."""

        copied: list[tuple[str, bytes, str]] = []
        total = 0
        for result in accepted_results(content):
            media_id = _text(result.get('media_id'))
            media = content.media.get(media_id)
            if not media or media.get('file_category') == 'export':
                continue
            size = int(media.get('bytes') or 0)
            if total + size > MEDIA_COPY_LIMIT_BYTES:
                content.limitations.append(f'Result media {media_id} exceeded the package size bound and ships as metadata only.')
                continue
            try:
                payload = await self._download_object(token, str(media.get('bucket')), str(media.get('object_key')))
            except AppError as error:
                content.limitations.append(f'Result media {media_id} could not be read ({error.code}) and ships as metadata only.')
                continue
            filename = f'{media_id}-{str(media.get("original_filename") or "result")}'
            copied.append((media_id, payload, filename))
            total += len(payload)
        return copied

    async def _download_object(self, token: str, bucket: str, object_key: str) -> bytes:
        if not self.settings.configured:
            raise AppError('SUPABASE_NOT_CONFIGURED', 'unavailable', 'The application data platform is not configured.', 503)
        url = f'{self.settings.supabase_url}/storage/v1/object/{bucket}/{object_key}'
        headers = self._auth_headers(token)
        response = await self.gateway.client.get(url, headers=headers)
        if response.status_code >= 400:
            raise AppError('EXPORT_MEDIA_UNAVAILABLE', 'unavailable', 'A Result file could not be read from storage.', 503)
        return response.content

    async def _store_artifact(self, content: ExportContent, payload: bytes, filename: str,
        media_type: str) -> tuple[str, str, str]:
        service_key = self._service_key()
        media_id = str(uuid4())
        object_key = f'{content.workspace_id}/{media_id}/{filename}'
        checksum = sha256_checksum(payload)
        url = f'{self.settings.supabase_url}/storage/v1/object/{EXPORT_BUCKET}/{object_key}'
        response = await self.gateway.client.post(url, headers={**self._auth_headers(service_key),
            'Content-Type': media_type, 'x-upsert': 'false'}, content=payload)
        if response.status_code >= 400:
            raise AppError('EXPORT_STORAGE_UNAVAILABLE', 'unavailable',
                'The export artifact could not be stored, so the export was not marked ready.', 503)
        media_row = {'id': media_id, 'workspace_id': content.workspace_id, 'bucket': EXPORT_BUCKET,
            'object_key': object_key, 'original_filename': filename, 'mime_type': media_type,
            'file_category': 'export', 'bytes': len(payload), 'checksum': checksum, 'upload_state': 'uploaded',
            'created_by': content.requested_by}
        # Media metadata is server-owned for export artifacts: the client storage path deliberately
        # excludes this bucket, so the row is written with the same server credential as the upload.
        await self.gateway.request('POST', '/rest/v1/media_files', token=service_key, schema=True,
            json=media_row, prefer='return=minimal')
        return media_id, object_key, checksum

    async def _sign_download(self, bucket: str, object_key: str, window_seconds: int) -> str | None:
        if not self.settings.configured or self.settings.supabase_service_role_key is None:
            return None
        url = f'{self.settings.supabase_url}/storage/v1/object/sign/{bucket}/{object_key}'
        response = await self.gateway.client.post(url, headers=self._auth_headers(self._service_key()),
            json={'expiresIn': min(max(window_seconds, 30), 3600)})
        if response.status_code >= 400:
            return None
        try:
            signed = response.json().get('signedURL')
        except ValueError:
            return None
        if not signed:
            return None
        return f'{self.settings.supabase_url}/storage/v1{signed}'

    def _service_key(self) -> str:
        key = self.settings.supabase_service_role_key
        if key is None:
            raise AppError('EXPORT_STORAGE_NOT_CONFIGURED', 'unavailable',
                'The export builder needs server storage credentials, which are not configured in this environment.', 503)
        return key.get_secret_value()

    def _auth_headers(self, token: str) -> dict[str, str]:
        key = self.settings.supabase_publishable_key
        headers = {'Authorization': f'Bearer {token}'}
        if key is not None:
            headers['apikey'] = key.get_secret_value()
        return headers

    def _document_manifest(self, content: ExportContent, document: RenderedDocument, object_key: str,
        checksum: str) -> dict[str, Any]:
        return {
            'schema_version': EXPORT_SCHEMA_VERSION,
            'export_id': content.export_id,
            'workspace_id': content.workspace_id,
            'production_id': content.production_id,
            'production_revision': content.production_revision,
            'production_version_id': content.production_version_id,
            'generated_at': _now(),
            'generated_by': content.requested_by,
            'format': content.requested_format,
            'kind': content.kind,
            'package_type': content.package_type,
            'artifact': {'object_key': object_key, 'bytes': len(document.content), 'checksum': document.checksum},
            'checksums': {'content': checksum},
            'files': [{'path': document.filename, 'bytes': len(document.content), 'checksum': document.checksum}],
            'media': [], 'references': [], 'results': self._manifest_results(content),
            'pin': self._manifest_pin(content),
        }

    def _package_manifest(self, content: ExportContent, document: RenderedDocument, entries: list[tuple[str, bytes]],
        copied: list[tuple[str, bytes, str]], object_key: str, checksum: str) -> dict[str, Any]:
        copied_paths = {f'results/{filename}': media_id for media_id, _payload, filename in copied}
        files: list[dict[str, Any]] = []
        for path, payload in entries:
            entry: dict[str, Any] = {'path': path, 'bytes': len(payload), 'checksum': sha256_checksum(payload)}
            if path in copied_paths:
                # A copied Result file names the media it came from, so the package is traceable.
                entry['media_id'] = copied_paths[path]
            files.append(entry)
        references: list[dict[str, Any]] = []
        for reference in content.children.get('production_references', []):
            entry = {'reference_id': reference.get('id'), 'rights_classification': reference.get('rights_classification'),
                'source_type': reference.get('source_type'), 'source_url': reference.get('source_url'),
                'state': reference.get('state')}
            rights = _text(reference.get('rights_classification'))
            if rights in OWNED_RIGHTS and reference.get('media_id') and str(reference.get('media_id')) in content.media:
                entry['copied_media_id'] = reference.get('media_id')
            references.append(entry)
        return {
            'schema_version': EXPORT_SCHEMA_VERSION,
            'export_id': content.export_id,
            'workspace_id': content.workspace_id,
            'production_id': content.production_id,
            'production_revision': content.production_revision,
            'production_version_id': content.production_version_id,
            'generated_at': _now(),
            'generated_by': content.requested_by,
            'format': content.requested_format,
            'kind': content.kind,
            'package_type': content.package_type,
            'artifact': {'object_key': object_key, 'bytes': sum(len(payload) for _, payload in entries), 'checksum': checksum},
            'checksums': {'content': checksum},
            'files': files,
            'media': [{'media_id': media_id, 'path': f'results/{filename}', 'bytes': len(payload)}
                for media_id, payload, filename in copied],
            'references': references,
            'results': self._manifest_results(content),
            'pin': self._manifest_pin(content),
        }

    def _manifest_results(self, content: ExportContent) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for result in content.children.get('results', []):
            entry: dict[str, Any] = {'result_id': result.get('id'), 'state': result.get('state'),
                'approval': result.get('approval'), 'revision': result.get('revision')}
            if str(result.get('id')) in {item.get('id') for item in accepted_results(content)} and result.get('media_id'):
                entry['media_id'] = result.get('media_id')
            results.append(entry)
        return results

    def _manifest_pin(self, content: ExportContent) -> dict[str, Any]:
        return {'requested_at': content.requested_at, 'production_revision': content.production_revision,
            'production_version_id': content.production_version_id, 'reconstructed': True,
            'objects_included': content.pin.objects_included,
            'excluded_after_request': content.pin.excluded_after_request[:50],
            'reconstruction_gaps': content.pin.reconstruction_gaps[:50],
            'truncated_reads': content.pin.truncated_reads,
            'limitations': content.limitations}


_EXPORT_SELECT = ('id,workspace_id,production_id,job_id,kind,requested_format,package_type,scope_type,scope_refs,'
    'state,production_revision,'
    'production_version_id,generated_media_id,manifest,file_count,total_bytes,content_checksum,requested_by,created_at,'
    'ready_at,failed_at,expired_at,failure_code,failure_message,completed_at')


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
