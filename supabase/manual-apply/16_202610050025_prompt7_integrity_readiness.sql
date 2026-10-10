begin;

-- 1. Tenant-safe model-profile integrity on execution plans.
alter table tonde.execution_plans
  add constraint execution_plans_model_profile_fk
  foreign key (workspace_id, model_profile_id)
  references tonde.ai_model_profiles(workspace_id, id) on delete restrict;
alter table tonde.execution_plans
  add constraint execution_plans_fallback_model_profile_fk
  foreign key (workspace_id, fallback_model_profile_id)
  references tonde.ai_model_profiles(workspace_id, id) on delete restrict;
create index execution_plans_by_model_profile on tonde.execution_plans(workspace_id, model_profile_id)
  where model_profile_id is not null;
create index execution_plans_by_fallback_model_profile on tonde.execution_plans(workspace_id, fallback_model_profile_id)
  where fallback_model_profile_id is not null;

-- 2. One readiness evaluation per Shot, reused across the document.
create or replace function tonde.ai_creation_surface(target_workspace uuid, target_production uuid,
  expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare prod tonde.productions; result jsonb;
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into prod from tonde.productions where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and prod.revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = '40001';
  end if;
  -- Each active Shot's readiness and selected Attempt are computed exactly once here and reused
  -- by the scene rollup, the Shot list and the summary.
  with base as (
    select h.id, h.workspace_id, h.production_id, h.scene_id, h.sort_order, h.title, h.purpose,
      h.execution_method, h.approval, h.locked_at, h.revision, h.planned_duration_ms,
      tonde_private.ai_readiness_state(target_workspace, target_production, h.id) as readiness,
      tonde_private.ai_selected_attempt(target_workspace, h.id) as selected_attempt_id
    from tonde.shots h
    where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active'
  )
  select jsonb_build_object(
    'production', jsonb_build_object('id', prod.id, 'workspace_id', prod.workspace_id, 'title', prod.title,
      'production_type', prod.production_type, 'execution_method', prod.execution_method,
      'planned_duration_ms', prod.planned_duration_ms, 'approval', prod.approval,
      'locked_at', prod.locked_at, 'revision', prod.revision, 'lifecycle', prod.lifecycle),
    'execution_faces', to_jsonb(array['real','ai']),
    'connections', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider_key', p.key, 'label', p.label, 'connection_required', p.connection_required,
        'manual_export_supported', p.manual_export_supported,
        'state', coalesce(c.state, 'not_connected'),
        'credential_reference', coalesce(c.credential_reference, ''),
        'connected_at', c.connected_at)
        order by p.key), '[]'::jsonb)
      from tonde.ai_providers p
      left join tonde.ai_provider_connections c on c.workspace_id = target_workspace and c.provider_key = p.key),
    'models', (select coalesce(jsonb_agg(jsonb_build_object(
        'model_profile_id', m.id, 'provider_key', m.provider_key, 'model_key', m.model_key,
        'label', m.label, 'operation', m.operation, 'capability_state', m.capability_state,
        'availability', m.availability, 'cost_known', m.cost_known, 'cost_unit', m.cost_unit,
        'cost_amount', m.cost_amount, 'cost_currency', m.cost_currency,
        'supports_image_reference', m.supports_image_reference,
        'supports_first_frame', m.supports_first_frame, 'supports_last_frame', m.supports_last_frame,
        'max_duration_ms', m.max_duration_ms, 'source', m.source)
        order by m.provider_key, m.model_key, m.operation), '[]'::jsonb)
      from tonde.ai_model_profiles m
      where m.workspace_id = target_workspace and m.lifecycle = 'active'),
    'known_models', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider_key', m.provider_key, 'model_key', m.model_key, 'operation', m.operation,
        'declared', false, 'capability_state', m.capability_state)
        order by m.provider_key, m.model_key), '[]'::jsonb)
      from tonde.ai_model_profiles m where m.workspace_id is null),
    'locks', tonde_private.ai_locks_document(target_workspace, target_production),
    'scenes', (select coalesce(jsonb_agg(jsonb_build_object(
        'scene_id', s.id, 'order', s.sort_order, 'title', s.title, 'shots', s.shot_count,
        'ready', s.ready, 'blocked', s.blocked, 'unplanned', s.unplanned, 'selected', s.selected)
        order by s.sort_order, s.id), '[]'::jsonb)
      from (select sc.id, sc.sort_order, sc.title,
          count(h.id) as shot_count,
          count(h.id) filter (where h.readiness = 'ready_to_generate') as ready,
          count(h.id) filter (where h.readiness not in ('ready_to_generate','manual_export') and h.execution_method <> 'real') as blocked,
          count(h.id) filter (where h.execution_method in ('ai','hybrid') and h.readiness = 'unplanned') as unplanned,
          count(h.id) filter (where h.selected_attempt_id is not null) as selected
        from tonde.scenes sc
        left join base h on h.scene_id = sc.id
        where sc.workspace_id = target_workspace and sc.production_id = target_production and sc.lifecycle = 'active'
        group by sc.id, sc.sort_order, sc.title) s),
    'shots', (select coalesce(jsonb_agg(jsonb_build_object(
        'shot_id', h.id, 'scene_id', h.scene_id, 'title', h.title, 'purpose', h.purpose,
        'order', h.sort_order, 'execution_method', h.execution_method, 'approval', h.approval,
        'locked', h.locked_at is not null, 'revision', h.revision,
        'planned_duration_ms', h.planned_duration_ms,
        'readiness', h.readiness,
        'plan_id', p.id, 'plan_revision', p.revision, 'plan_status', p.plan_status,
        'prompt_version', p.prompt_version, 'prompt_stale', p.source_shot_revision is not null and p.source_shot_revision <> h.revision,
        'provider_target', p.provider_target, 'model_profile_id', p.model_profile_id,
        'model_label', coalesce(m.label, m.model_key), 'model_key', m.model_key,
        'capability_state', m.capability_state,
        'cost_state', coalesce(p.cost_state, 'unknown'), 'cost_amount', p.cost_amount,
        'cost_currency', p.cost_currency,
        'aspect_ratio', coalesce(nullif(p.aspect_ratio, ''), ''),
        'expected_duration_ms', coalesce(p.expected_duration_ms, h.planned_duration_ms),
        'hybrid', p.hybrid)
        order by h.sort_order, h.id), '[]'::jsonb)
      from base h
      left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
        and p.execution_method = 'ai'
      left join tonde.ai_model_profiles m on m.id = p.model_profile_id),
    'summary', (select jsonb_build_object(
        'shots', count(*),
        'ai_or_hybrid', count(*) filter (where h.execution_method in ('ai','hybrid')),
        'real', count(*) filter (where h.execution_method = 'real'),
        'planned', count(*) filter (where p.id is not null),
        'ready', count(*) filter (where h.readiness = 'ready_to_generate'),
        'manual_export', count(*) filter (where h.readiness = 'manual_export'),
        'blocked', count(*) filter (where h.execution_method in ('ai','hybrid')
          and h.readiness not in ('ready_to_generate','manual_export')),
        'stale', count(*) filter (where p.source_shot_revision is not null and p.source_shot_revision <> h.revision),
        'with_selected_result', count(*) filter (where h.selected_attempt_id is not null),
        'connected_providers', (select count(*) from tonde.ai_provider_connections c
          where c.workspace_id = target_workspace and c.state = 'connected'),
        'declared_models', (select count(*) from tonde.ai_model_profiles m
          where m.workspace_id = target_workspace and m.lifecycle = 'active'))
      from base h
      left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
        and p.execution_method = 'ai'),
    'capabilities', jsonb_build_object(
      'prompt_compilation', true,
      'model_routing', true,
      'live_generation', exists (select 1 from tonde.ai_provider_connections c
        where c.workspace_id = target_workspace and c.state = 'connected'),
      'manual_export', true,
      'note', 'Provider-neutral. TONDE ranks only the models you have declared, and holds no vendor capability facts of its own.'))
  into result;
  return result;
end $$;
-- The ACLs are re-asserted exactly as migration 017 established them: authenticated only.
revoke all on function tonde.ai_creation_surface(uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function tonde.ai_creation_surface(uuid,uuid,integer) to authenticated;

commit;
