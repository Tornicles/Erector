-- Forward hardening of 053 (already applied): workspace-wide keys must never reconcile another
-- Production's operation, and simultaneous retries must not race the unique constraint.
-- INV-01/26/27/29: one canonical Production, explicit scope, deterministic retry identity, tenant guard.
-- No table, RLS, grant or data changes. The transaction lock serializes operation recording within
-- one workspace only; a hash collision merely serializes unrelated work, never grants access.
begin;

create or replace function tonde.record_director_operation(
  target_workspace uuid, target_production uuid, operation_record jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing tonde.director_operations; saved tonde.director_operations;
  desired_status text;
begin
  perform tonde_private.director_guard(target_workspace);
  if operation_record is null or jsonb_typeof(operation_record) <> 'object'
    or pg_column_size(operation_record) > 500000
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
  perform pg_advisory_xact_lock(hashtextextended('tonde:director-operation:' || target_workspace::text, 0));
  select * into existing from tonde.director_operations
    where workspace_id = target_workspace and operation_id = (operation_record->>'operation_id')::uuid for update;
  if not found then
    select * into existing from tonde.director_operations
      where workspace_id = target_workspace and idempotency_key = operation_record->>'idempotency_key' for update;
  end if;
  if found then
    if existing.production_id <> target_production or existing.operation_type <> operation_record->>'operation_type' then
      raise exception 'An operation identity cannot be reused in a different Production or operation type' using errcode = 'PT409';
    end if;
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
