"""Prompt 4 persistence: Studio surfaces and the guarded Director RPCs.

Every read is scoped by workspace and production; every write goes through a
security-definer RPC that re-checks authorization, revision and idempotency.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.domain.analysis import (
    AnalysisStage,
    AnalysisStatus,
    CapabilityReport,
    CapabilityState,
    CausalExplanation,
    EpistemicClass,
    EvidenceRef,
    Finding,
    FindingCategory,
    MediaModalityState,
    QualitativeConfidence,
    ReferenceAnalysis,
    ReferenceCapability,
    ReferenceRole,
    StyleDNA,
    StyleSection,
    Technique,
    TechniqueCategory,
    TechniqueImportance,
)
from app.services.ai.orchestration import OperationOutcome
from app.services.director import reference_is_shaping_ready
from app.services.studio import reference_shaping_is_ready

logger = logging.getLogger('tonde.studio')

MAX_ROWS = 200


class StudioRepository:
    def __init__(self, gateway: SupabaseGateway) -> None:
        self.gateway = gateway

    async def _rows(self, path: str, token: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows = await self.gateway.request('GET', path, token=token, schema=True, params=params)
        if not isinstance(rows, list):
            return []
        return rows[:MAX_ROWS]

    async def production(self, workspace_id: UUID, production_id: UUID, token: str) -> dict[str, Any]:
        rows = await self._rows('/rest/v1/productions', token, {
            'id': f'eq.{production_id}', 'workspace_id': f'eq.{workspace_id}',
            'select': 'id,workspace_id,title,production_type,execution_method,planned_duration_ms,approval,locked_at,revision',
            'limit': '1',
        })
        if not rows:
            raise AppError('PRODUCTION_NOT_FOUND', 'not_found', 'This Production is unavailable.', 404)
        return rows[0]

    async def intelligence_context(
        self, workspace_id: UUID, production_id: UUID, token: str,
    ) -> dict[str, Any]:
        production = await self.production(workspace_id, production_id, token)
        scope = {'workspace_id': f'eq.{workspace_id}', 'production_id': f'eq.{production_id}'}
        references = await self._rows('/rest/v1/production_references', token, {
            **scope, 'select': 'id,source_type,source_url,source_description,media_id,rights_classification,state,created_at,source_identity,source_provider,identity_provenance,source_identity_verified_at,creator_purpose,learning_targets,identity_revision,revision',
            'order': 'created_at.desc', 'limit': '12',
        })
        setup = await self._rows('/rest/v1/production_resources', token, {
            'workspace_id': f'eq.{workspace_id}', 'lifecycle': 'eq.active',
            'select': 'resource_type,name,manufacturer,model,mount,metadata', 'order': 'updated_at.desc', 'limit': '30',
        })
        intake_rows = await self._rows('/rest/v1/director_intakes', token, {
            **scope, 'select': 'id,revision,status,collaboration_mode,intent,plan,applied_operation_id,proposal_operation_id', 'limit': '1',
        })
        brief_rows = await self._rows('/rest/v1/director_briefs', token, {
            **scope, 'select': 'id,revision,brief,producer,source_operation_id,updated_at', 'limit': '1',
        })
        story_rows = await self._rows('/rest/v1/creative_stories', token, {
            **scope, 'select': 'id,revision,story,variation,producer,updated_at', 'limit': '1',
        })
        scene_rows = await self._rows('/rest/v1/scenes', token, {
            **scope, 'lifecycle': 'eq.active',
            'select': 'id,title,purpose,description,story_beat,opening_state,ending_state,visual_intent,dialogue_notes,action_lines,scene_detail,sort_order,planned_duration_ms,environment_asset_id,revision',
            'order': 'sort_order', 'limit': '40',
        })
        dialogue_rows = await self._rows('/rest/v1/dialogue_lines', token, {
            **scope,
            'select': 'id,scene_id,document_id,line_type,content,sort_order,start_ms,duration_ms,intention,delivery,subtext,pause_after_ms,line_flags',
            'order': 'sort_order', 'limit': '200',
        })
        reality_rows = await self._rows('/rest/v1/director_reality_checks', token, {
            **scope, 'select': 'id,revision,report,feasibility,complexity,recommended_mode,updated_at', 'limit': '1',
        })
        analysis_rows = await self._rows('/rest/v1/reference_analyses', token, {
            **scope,
            'select': 'id,reference_id,role,capability,status,stages,progress,summary,capabilities,style,causal,adaptation_notes,limitations,media_metadata,producer,model_profile,producer_note,analyzed_at,identity_revision,revision',
            'order': 'created_at.desc', 'limit': '12',
        })
        analysis_ids = [str(row['id']) for row in analysis_rows]
        findings: list[dict[str, Any]] = []
        if analysis_ids:
            findings = await self._rows('/rest/v1/reference_findings', token, {
                'workspace_id': f'eq.{workspace_id}', 'analysis_id': f'in.({",".join(analysis_ids)})',
                'select': 'id,analysis_id,finding_id,category,statement,epistemic,confidence,evidence,technique_id,limitations,sort_order',
                'order': 'sort_order', 'limit': '200',
            })
        technique_rows = await self._rows('/rest/v1/creative_techniques', token, {
            'workspace_id': f'eq.{workspace_id}',
            'select': 'id,canonical_id,name,category,description,purpose,effect,conditions,practical_concept,ai_concept,limitations,importance,confidence,technique_source',
            'order': 'updated_at.desc', 'limit': '100',
        })
        link_rows: list[dict[str, Any]] = []
        if analysis_ids:
            link_rows = await self._rows('/rest/v1/reference_technique_links', token, {
                'workspace_id': f'eq.{workspace_id}', 'analysis_id': f'in.({",".join(analysis_ids)})',
                'select': 'analysis_id,technique_id,reference_id,importance,evidence', 'limit': '200',
            })
        document_rows = await self._rows('/rest/v1/creative_documents', token, {
            **scope, 'document_type': 'in.(brief,story,script)',
            'select': 'id,document_type,title,content,revision,updated_at', 'order': 'updated_at.desc', 'limit': '12',
        })
        decision_rows = await self._rows('/rest/v1/director_decisions', token, {
            **scope, 'select': 'decision_id,question,answer,priority,impact,decided_by,decision_source,is_correction,updated_at',
            'order': 'created_at', 'limit': '40',
        })
        operation_rows = await self._rows('/rest/v1/director_operations', token, {
            **scope,
            'select': 'operation_id,operation_type,scope,status,producer,provider,model,model_profile,attempts,repaired,rationale,limitations,schema_version,source_revision,idempotency_key,created_at',
            'order': 'created_at.desc', 'limit': '20',
        })
        analyses_by_reference = {str(row['reference_id']): row for row in analysis_rows}
        references_by_id = {str(row['id']): row for row in references}
        shaping_analyses_by_reference = {
            reference_id: row for reference_id, row in analyses_by_reference.items()
            if reference_shaping_is_ready(references_by_id.get(reference_id, {}), row)
        }
        shaping_analysis_ids = {str(row['id']) for row in shaping_analyses_by_reference.values()}
        findings_by_analysis: dict[str, list[dict[str, Any]]] = {}
        for row in findings:
            if str(row['analysis_id']) in shaping_analysis_ids:
                findings_by_analysis.setdefault(str(row['analysis_id']), []).append(row)
        techniques_by_id = {str(row['id']): row for row in technique_rows}
        links_by_analysis: dict[str, list[dict[str, Any]]] = {}
        for row in link_rows:
            if str(row['analysis_id']) in shaping_analysis_ids:
                links_by_analysis.setdefault(str(row['analysis_id']), []).append(row)
        analyses = {
            reference_id: rebuild_analysis(
                row, findings_by_analysis.get(str(row['id']), []),
                [techniques_by_id.get(str(link['technique_id']), {}) | {'importance': link.get('importance'), 'evidence': link.get('evidence')}
                 for link in links_by_analysis.get(str(row['id']), []) if str(link['technique_id']) in techniques_by_id],
            )
            for reference_id, row in shaping_analyses_by_reference.items()
        }
        shaping_technique_ids = {str(link['technique_id']) for rows in links_by_analysis.values() for link in rows}
        shaping_techniques = [
            row for row in technique_rows
            if row.get('technique_source') != 'reference' or str(row.get('id')) in shaping_technique_ids
        ]
        return {
            'production': production, 'references': references,
            'shaping_references': [row for row in references if reference_is_shaping_ready(row)], 'setup': setup,
            'intake': intake_rows[0] if intake_rows else None,
            'brief_row': brief_rows[0] if brief_rows else None,
            'story_row': story_rows[0] if story_rows else None,
            'scene_rows': scene_rows, 'dialogue_rows': dialogue_rows,
            'reality_row': reality_rows[0] if reality_rows else None,
            'analysis_rows': analysis_rows, 'findings_by_analysis': findings_by_analysis,
            'shaping_analyses_by_reference': shaping_analyses_by_reference,
            'technique_rows': shaping_techniques, 'decision_rows': decision_rows, 'operation_rows': operation_rows,
            'document_rows': document_rows,
            'analyses_by_reference': analyses_by_reference, 'analyses': analyses,
        }

    async def rpc(self, name: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        result = await self.gateway.request('POST', f'/rest/v1/rpc/{name}', token=token, schema=True, json=payload)
        return result if isinstance(result, dict) else {'result': result}

    async def record_operation(self, workspace_id: UUID, production_id: UUID, token: str, outcome: OperationOutcome, *, source_revision: int, source_intake_revision: int | None = None, collaboration_mode: str = 'stop_at_major_decisions') -> dict[str, Any]:
        return await self.rpc('record_director_operation', token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'operation_record': {
                'operation_id': str(outcome.operation_id), 'operation_type': outcome.operation_type,
                'scope': outcome.scope.value, 'schema_version': outcome.schema_version,
                'source_revision': source_revision, 'source_intake_revision': source_intake_revision,
                'status': outcome.status, 'producer': outcome.producer, 'provider': outcome.provider, 'model': outcome.model,
                'model_profile': 'default', 'attempts': outcome.attempts, 'repaired': outcome.repaired,
                'idempotency_key': outcome.idempotency_key or str(outcome.operation_id),
                'collaboration_mode': collaboration_mode, 'rationale': outcome.rationale,
                'limitations': outcome.limitations, 'payload': outcome.payload,
            },
        })

    async def save_brief(self, workspace_id: UUID, production_id: UUID, token: str, *, expected_revision: int | None, brief: dict[str, Any], producer: str, operation_id: UUID | None) -> dict[str, Any]:
        return await self.rpc('save_director_brief', token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_brief_revision': expected_revision, 'brief_content': brief,
            'source_operation': str(operation_id) if operation_id else None, 'producer_kind': producer,
        })

    async def record_decisions(self, workspace_id: UUID, production_id: UUID, token: str, decisions: list[dict[str, Any]], *, source: str = 'studio') -> dict[str, Any]:
        return await self.rpc('record_director_decisions', token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'decision_list': decisions, 'decision_source': source,
        })

    async def begin_reference_analysis(self, workspace_id: UUID, production_id: UUID, reference_id: UUID, token: str, *, identity_revision: int) -> dict[str, Any]:
        return await self.rpc('claim_reference_analysis_pinned', token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_reference': str(reference_id),
            'expected_identity_revision': identity_revision, 'stage_status': 'preprocessing',
            'stage_list': ['queued', 'preprocessing'], 'progress_pct': 10,
            'producer_note': 'Preprocessing container metadata, frames and audio.',
        })

    async def claim_reference_analysis(self, workspace_id: UUID, production_id: UUID, reference_id: UUID, token: str, *, status: str, stages: list[str], progress: int, note: str = '') -> dict[str, Any]:
        return await self.rpc('claim_reference_analysis', token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_reference': str(reference_id),
            'stage_status': status, 'stage_list': stages, 'progress_pct': progress, 'producer_note': note[:600],
        })

    async def save_reference_analysis(self, workspace_id: UUID, production_id: UUID, reference_id: UUID, token: str, analysis: ReferenceAnalysis, *, identity_revision: int, techniques: list[Technique] | None = None, operation_id: UUID | None = None) -> dict[str, Any]:
        return await self.rpc('save_reference_analysis', token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id), 'target_reference': str(reference_id),
            'analysis': {
                'identity_revision': identity_revision,
                'role': analysis.role.value, 'capability': analysis.capability.capability.value, 'status': analysis.status.value,
                'stages': [stage.value for stage in analysis.stages], 'progress': 100 if analysis.status == AnalysisStatus.complete else (60 if analysis.status == AnalysisStatus.partial else (0 if analysis.status == AnalysisStatus.failed else 50)),
                'summary': analysis.summary, 'capabilities': analysis.capability.model_dump(mode='json'),
                'style': analysis.style.model_dump(mode='json'), 'causal': [item.model_dump(mode='json') for item in analysis.causal],
                'adaptation_notes': analysis.adaptation_notes, 'limitations': analysis.limitations,
                'producer': analysis.producer, 'model_profile': analysis.model_profile or 'default',
                'producer_note': '; '.join(analysis.limitations[:2])[:600],
            },
            'findings': [
                {
                    'finding_id': finding.id, 'category': finding.category.value, 'statement': finding.statement,
                    'epistemic': finding.epistemic.value, 'confidence': finding.confidence.value,
                    'evidence': [item.model_dump(mode='json') for item in finding.evidence],
                    'technique_id': finding.technique_id, 'limitations': finding.limitations,
                }
                for finding in analysis.findings
            ],
            'techniques': [
                {
                    'canonical_id': technique.canonical_id, 'name': technique.name, 'category': technique.category.value,
                    'description': technique.description, 'purpose': technique.purpose, 'effect': technique.effect,
                    'conditions': technique.conditions, 'practical_concept': technique.practical_concept,
                    'ai_concept': technique.ai_concept, 'limitations': technique.limitations,
                    'importance': technique.importance.value, 'confidence': technique.confidence.value,
                    'technique_source': 'reference', 'evidence': [item.model_dump(mode='json') for item in technique.evidence],
                }
                for technique in (techniques if techniques is not None else analysis.techniques)
            ],
            'source_operation': str(operation_id) if operation_id else None,
        })

    async def apply_operation(self, workspace_id: UUID, production_id: UUID, token: str, *, operation_id: UUID, operation_type: str, bundle: dict[str, Any], expected_revision: int) -> dict[str, Any]:
        return await self.rpc('apply_director_operation', token, {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': expected_revision, 'target_operation': str(operation_id),
            'operation_type': operation_type, 'bundle': bundle, 'explicit_confirmation': True,
        })


def rebuild_analysis(
    row: dict[str, Any], findings: list[dict[str, Any]], techniques: list[dict[str, Any]],
) -> ReferenceAnalysis:
    """Rehydrate a stored analysis so planning can reuse it without a second interpretation."""

    capability_payload = row.get('capabilities') or {}
    try:
        capability = CapabilityReport.model_validate({
            'capability': row.get('capability') or ReferenceCapability.metadata_only.value,
            'modalities': capability_payload.get('modalities') or MediaModalityState().model_dump(mode='json'),
            'media_bytes': capability_payload.get('media_bytes') or CapabilityState.unavailable.value,
            'producer': capability_payload.get('producer') or 'unverified',
            'note': capability_payload.get('note') or 'Stored analysis capability.',
        })
    except ValidationError:
        capability = CapabilityReport(
            capability=ReferenceCapability.metadata_only, modalities=MediaModalityState(), media_bytes=CapabilityState.unavailable,
            producer='unverified', note='Stored analysis capability could not be revalidated.',
        )
    parsed_findings: list[Finding] = []
    for item in findings:
        try:
            parsed_findings.append(Finding(
                id=str(item.get('finding_id'))[:120], category=FindingCategory(item.get('category') or 'story'),
                statement=str(item.get('statement') or '')[:1200], epistemic=EpistemicClass(item.get('epistemic') or 'estimated'),
                confidence=QualitativeConfidence(item.get('confidence') or 'medium'),
                evidence=[EvidenceRef.model_validate(evidence) for evidence in (item.get('evidence') or [])][:8],
                technique_id=item.get('technique_id') or None,
                limitations=[str(value)[:200] for value in (item.get('limitations') or [])][:6],
            ))
        except (ValidationError, ValueError):
            continue
    parsed_techniques: list[Technique] = []
    for item in techniques:
        try:
            parsed_techniques.append(Technique(
                canonical_id=str(item.get('canonical_id'))[:120], name=str(item.get('name') or '')[:160],
                category=TechniqueCategory(item.get('category') or 'composition'),
                description=str(item.get('description') or '')[:1200], purpose=str(item.get('purpose') or '')[:600],
                effect=str(item.get('effect') or '')[:600], conditions=[str(value)[:200] for value in (item.get('conditions') or [])][:8],
                practical_concept=str(item.get('practical_concept') or '')[:900], ai_concept=str(item.get('ai_concept') or '')[:900],
                limitations=[str(value)[:200] for value in (item.get('limitations') or [])][:8],
                importance=TechniqueImportance(item.get('importance') or 'supporting'),
                confidence=QualitativeConfidence(item.get('confidence') or 'medium'),
                evidence=[EvidenceRef.model_validate(evidence) for evidence in (item.get('evidence') or [])][:8],
            ))
        except (ValidationError, ValueError):
            continue
    try:
        style = StyleDNA.model_validate(row.get('style') or {})
    except ValidationError:
        style = StyleDNA(sections=[StyleSection(section='composition', description='Stored Style section could not be revalidated.')])
    try:
        causal = [CausalExplanation.model_validate(item) for item in (row.get('causal') or [])][:8]
    except ValidationError:
        causal = []
    try:
        stages = [AnalysisStage(value) for value in (row.get('stages') or [])][:10]
    except ValueError:
        stages = []
    return ReferenceAnalysis(
        reference_id=UUID(str(row['reference_id'])),
        role=ReferenceRole(row.get('role') or 'style'),
        capability=capability,
        status=AnalysisStatus(row.get('status') or 'not_started'),
        stages=stages,
        summary=str(row.get('summary') or '')[:1600],
        findings=parsed_findings[:80],
        techniques=parsed_techniques[:40],
        style=style,
        causal=causal,
        limitations=[str(value)[:300] for value in (row.get('limitations') or [])][:12],
        producer='model' if row.get('producer') == 'model' else 'deterministic',
        model_profile=row.get('model_profile') or None,
        adaptation_notes=[str(value)[:400] for value in (row.get('adaptation_notes') or [])][:12],
    )
