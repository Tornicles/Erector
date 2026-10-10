"""The durable job handlers this deployment can genuinely execute.

Only work TONDE can actually perform is registered here. A registered handler either completes the
work or reports the failure it observed; it never marks work complete that did not happen.

Two deliberate omissions, both honest:

* **Media generation.** TONDE is the Director, not the renderer. There is no handler that calls a
  media-generation provider, because TONDE does not generate media - the creator runs the compiled
  playbook prompt in their own tool and uploads the Result, which TONDE then checks.
* **Work whose implementation is not in this build.** Types such as `export`, `publication_submission`
  and `transcription` are defined in the durable registry but have no handler here yet. The runtime
  releases them rather than faking a result, so they are visibly unclaimed instead of falsely done.
"""

from __future__ import annotations

from typing import Any, Callable

from app.worker.runtime import Handler, JobFailure, JobOutcome

LAYER = 'Durable jobs'


class HandlerContext:
    """The transport a handler uses. The worker's credential is read through a provider, not stored.

    A provider rather than a value means a credential that is missing stays missing until a handler
    actually needs it, so an unconfigured worker fails loudly at the point of use instead of
    silently holding an empty secret.
    """

    def __init__(self, gateway: Any, token_provider: Callable[[], str]) -> None:
        self.gateway = gateway
        self._token_provider = token_provider

    @property
    def token(self) -> str:
        return self._token_provider()

    async def rpc(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed(name, token=self.token, json=payload, layer=LAYER)


def build_handlers(context: HandlerContext) -> dict[str, Handler]:
    """The registry. Keys are durable job type names from the migration 036 registry."""

    return {
        'prompt_compilation': _prompt_compilation(context),
        'shot_match': _shot_match(context),
        'knowledge_ingestion': _knowledge_ingestion(context),
    }


def _prompt_compilation(context: HandlerContext) -> Handler:
    """Compile a Shot's playbook prompt for the external tool the creator chose.

    This is TONDE's own direction work: it reads the planned Shot and the documented tool
    knowledge and produces the prompt the creator runs elsewhere. No media is produced.
    """

    async def handler(job: dict[str, Any]) -> JobOutcome:
        payload = job.get('payload') or {}
        workspace_id = payload.get('workspace_id') or job.get('workspace_id')
        production_id = payload.get('production_id') or job.get('production_id')
        shot_id = payload.get('shot_id')
        if not workspace_id or not production_id or not shot_id:
            raise JobFailure('PROMPT_COMPILATION_INPUT_MISSING',
                'A prompt compilation needs its workspace, Production and Shot.', classification=None)
        result = await context.rpc('ai_playbook_prompt_compile', {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'p_tool_key': payload.get('tool_key'),
            'p_expected_plan_revision': payload.get('expected_plan_revision')})
        return JobOutcome(result=result, result_reference=str(shot_id),
            note='The compiled playbook prompt is ready to copy into the chosen tool.')

    return handler


def _shot_match(context: HandlerContext) -> Handler:
    """Check an uploaded Result against the planned Shot and the playbook criteria."""

    async def handler(job: dict[str, Any]) -> JobOutcome:
        payload = job.get('payload') or {}
        workspace_id = payload.get('workspace_id') or job.get('workspace_id')
        production_id = payload.get('production_id') or job.get('production_id')
        shot_id = payload.get('shot_id')
        result_id = payload.get('result_id')
        if not workspace_id or not production_id or not shot_id or not result_id:
            raise JobFailure('RESULT_CHECK_INPUT_MISSING',
                'A Result check needs its workspace, Production, Shot and Result.', classification=None)
        checked = await context.rpc('ai_result_check', {
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'target_result': str(result_id),
            'p_payload': payload.get('check') or {}})
        return JobOutcome(result=checked, result_reference=str(result_id),
            note='The Result was checked against the criteria the product names.')

    return handler


def _knowledge_ingestion(context: HandlerContext) -> Handler:
    """Normalize and validate one ingested knowledge package into the library."""

    async def handler(job: dict[str, Any]) -> JobOutcome:
        payload = job.get('payload') or {}
        workspace_id = payload.get('workspace_id') or job.get('workspace_id')
        if not workspace_id:
            raise JobFailure('KNOWLEDGE_INGESTION_INPUT_MISSING',
                'A knowledge import needs the workspace it belongs to.', classification=None)
        imported = await context.rpc('knowledge_import_request', {
            'target_workspace': str(workspace_id), 'p_format': payload.get('format') or 'json',
            'p_source_label': payload.get('source_label') or 'Ingested knowledge package',
            'p_payload': payload.get('package') or {},
            'p_source_locator': payload.get('source_locator'),
            'p_license': payload.get('license'), 'p_attribution': payload.get('attribution'),
            'p_dry_run': bool(payload.get('dry_run'))})
        return JobOutcome(result=imported,
            note='Accepted items are validated and carry their provenance; rejections are recorded.')

    return handler


# Job types defined in the durable registry that this build has no handler for. Declared here so the
# gap is a documented fact rather than an assumption, and so operations can see what is unclaimable.
UNIMPLEMENTED_JOB_TYPES: frozenset[str] = frozenset({
    'media_preprocessing', 'media_scan', 'media_derivation', 'proxy', 'thumbnail', 'transcription',
    'reference_analysis', 'story_generation', 'production_generation', 'export', 'cloud_import',
    'long_form_generation', 'publication_submission', 'provider_reconciliation',
    'notification_delivery', 'retention_sweep', 'deletion_orchestration',
})
