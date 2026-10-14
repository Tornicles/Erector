-- Forward repair: a Director operation is identified by its idempotency key, not only by the
-- process-local UUID the caller happened to generate.
--
-- Reproduced on the linked project through the deployed API (2026-10-14): pressing DIRECT twice with
-- unchanged intake returned HTTP 503
--   duplicate key value violates unique constraint "director_operations_workspace_id_idempotency_key_key"
-- The deterministic envelopes (OperationEnvelope.with_idempotency_key: intent_interpretation,
-- story_generation, ...) derive a stable key from the operation type, the Production revision, the
-- intake revision and a payload digest, so an identical repeat request carries the same key. Migration
-- 012 reconciled only by operation_id, so the repeat request found no row, inserted, and failed the
-- unique (workspace_id, idempotency_key) constraint instead of returning the operation already
-- recorded. The creator's own retry path ("DIRECT THIS again to retry the plan") was therefore broken
-- after the first press, and a page reload that replays a saved intake failed the same way.
--
-- The product rule is unchanged and the database stays the authority for idempotency: the same key
-- means the same operation. A repeat with the same key returns the recorded row (idempotent true) and
-- updates the still-open fields exactly as an operation_id match does. A repeat that carries a
-- different payload hash for a completed, hashed operation is a genuine conflict and is refused with
-- PT409 (maps to HTTP 409). The two operations-id integrity rules already refused in 012 (an operation
-- id reused with a different key, or a completed operation rewritten with different content) now use
-- the same mapped PT409 instead of returning an opaque class-23 failure as HTTP 503.
--
-- Access is unchanged: create or replace keeps the existing owner, security definer mode, search_path
-- and grants from migration 012 (authenticated EXECUTE, revoked from anon and service_role).
--
-- Rollback note: forward-only. Reverting means dropping this reconciliation from a NEW migration;
-- applied history is never rewritten.
begin;

create or replace function tonde.record_director_operation(
  target_workspace uuid, target_production uuid, operation_record jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing tonde.director_operations; saved tonde.director_operations;
  desired_status text;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(operation_record) <> 'object' or pg_column_size(operation_record) > 500000
    or coalesce(length(operation_record->>'operation_id'), 0) <> 36
    or coalesce(length(btrim(operation_record->>'operation_type')), 0) = 0
    or coalesce(length(btrim(operation_record->>'idempotency_key')), 0) = 0 then
    raise exception 'Invalid Director operation record' using errcode = '22023';
  end if;
  if not exists(select 1 from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production) then
    raise exception 'Production unavailable' using errcode = 'P0002';
  end if;
  desired_status := coalesce(operation_record->>'status', 'queued');
  if desired_status not in ('queued','preprocessing','analyzing','synthesizing','succeeded','partial','failed','cancelled') then
    raise exception 'Unsupported operation status' using errcode = '22023';
  end if;
  -- Same operation id: resume the recorded operation.
  select * into existing from tonde.director_operations
    where workspace_id = target_workspace and operation_id = (operation_record->>'operation_id')::uuid for update;
  if found then
    if existing.idempotency_key <> operation_record->>'idempotency_key' then
      raise exception 'An operation id cannot be reused with a different idempotency key' using errcode = 'PT409';
    end if;
    if existing.status in ('succeeded','partial') and existing.payload_hash is not null
      and operation_record->>'payload_hash' is not null and existing.payload_hash <> operation_record->>'payload_hash' then
      raise exception 'A completed operation cannot be rewritten with different content' using errcode = 'PT409';
    end if;
    update tonde.director_operations set status = desired_status,
      producer = coalesce(operation_record->>'producer', producer),
      provider = coalesce(operation_record->>'provider', provider),
      model = coalesce(operation_record->>'model', model),
      model_profile = coalesce(operation_record->>'model_profile', model_profile),
      attempts = coalesce((operation_record->>'attempts')::integer, attempts),
      repaired = coalesce((operation_record->>'repaired')::boolean, repaired),
      rationale = coalesce(operation_record->>'rationale', rationale),
      limitations = coalesce(operation_record->'limitations', limitations),
      payload = coalesce(operation_record->'payload', payload),
      payload_hash = coalesce(operation_record->>'payload_hash', payload_hash),
      error_code = coalesce(operation_record->>'error_code', error_code),
      error_message = coalesce(operation_record->>'error_message', error_message),
      completed_at = case when desired_status in ('succeeded','partial','failed','cancelled') then now() else completed_at end
      where id = existing.id returning * into saved;
    return jsonb_build_object('id', saved.id, 'status', saved.status, 'operation_id', saved.operation_id,
      'revision', saved.revision, 'idempotent', true);
  end if;
  -- Same idempotency key from an earlier attempt: this is that operation, not a second one.
  select * into existing from tonde.director_operations
    where workspace_id = target_workspace and idempotency_key = operation_record->>'idempotency_key' for update;
  if found then
    if existing.status in ('succeeded','partial') and existing.payload_hash is not null
      and operation_record->>'payload_hash' is not null and existing.payload_hash <> operation_record->>'payload_hash' then
      raise exception 'A completed operation cannot be rewritten with different content' using errcode = 'PT409';
    end if;
    update tonde.director_operations set status = desired_status,
      producer = coalesce(operation_record->>'producer', producer),
      provider = coalesce(operation_record->>'provider', provider),
      model = coalesce(operation_record->>'model', model),
      model_profile = coalesce(operation_record->>'model_profile', model_profile),
      attempts = coalesce((operation_record->>'attempts')::integer, attempts),
      repaired = coalesce((operation_record->>'repaired')::boolean, repaired),
      rationale = coalesce(operation_record->>'rationale', rationale),
      limitations = coalesce(operation_record->'limitations', limitations),
      payload = coalesce(operation_record->'payload', payload),
      payload_hash = coalesce(operation_record->>'payload_hash', payload_hash),
      error_code = coalesce(operation_record->>'error_code', error_code),
      error_message = coalesce(operation_record->>'error_message', error_message),
      completed_at = case when desired_status in ('succeeded','partial','failed','cancelled') then now() else completed_at end
      where id = existing.id returning * into saved;
    return jsonb_build_object('id', saved.id, 'status', saved.status, 'operation_id', saved.operation_id,
      'revision', saved.revision, 'idempotent', true);
  end if;
  insert into tonde.director_operations(workspace_id, production_id, operation_id, operation_type, scope, schema_version,
    source_revision, source_intake_revision, status, producer, provider, model, model_profile, attempts, repaired,
    idempotency_key, collaboration_mode, reference_ids, constraint_summary, rationale, limitations, payload, payload_hash,
    error_code, error_message, started_at, completed_at, created_by)
  values (target_workspace, target_production, (operation_record->>'operation_id')::uuid, operation_record->>'operation_type',
    coalesce(operation_record->>'scope', 'production'), coalesce(operation_record->>'schema_version', 'tonde.director.1'),
    (operation_record->>'source_revision')::integer, nullif(operation_record->>'source_intake_revision','')::integer,
    desired_status, coalesce(operation_record->>'producer', 'deterministic'), operation_record->>'provider', operation_record->>'model',
    coalesce(operation_record->>'model_profile', 'default'), coalesce((operation_record->>'attempts')::integer, 0),
    coalesce((operation_record->>'repaired')::boolean, false), operation_record->>'idempotency_key',
    coalesce(operation_record->>'collaboration_mode', 'stop_at_major_decisions'),
    coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(operation_record->'reference_ids','[]'::jsonb)) as value), '{}'),
    coalesce(operation_record->'constraint_summary','{}'::jsonb), coalesce(operation_record->>'rationale',''),
    coalesce(operation_record->'limitations','[]'::jsonb), coalesce(operation_record->'payload','{}'::jsonb),
    operation_record->>'payload_hash', operation_record->>'error_code', operation_record->>'error_message',
    now(), case when desired_status in ('succeeded','partial','failed','cancelled') then now() else null end, auth.uid())
  returning * into saved;
  return jsonb_build_object('id', saved.id, 'status', saved.status, 'operation_id', saved.operation_id,
    'revision', saved.revision, 'idempotent', false);
end;
$$;

commit;
