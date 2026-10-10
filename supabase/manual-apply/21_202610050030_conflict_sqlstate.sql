-- Forward repair: optimistic-concurrency conflicts were raised with SQLSTATE 40001, which
-- PostgREST treats as a transient serialization failure and retries indefinitely. The request then
-- never returns (reproduced on the linked project: a stale-revision approval did not answer in 60 s
-- while the same statement completed in milliseconds when executed directly), one API call becomes
-- several Postgres transactions, and the project burns CPU. Supabase documents the behaviour and its
-- repair: "SQLSTATE 40001 (serialization_failure) in an RPC function causes infinite retries", last
-- edited 2026-10-08 - present in PostgREST 14, fixed in 16; use a code that maps to the intended HTTP
-- status. The PT prefix maps PTxxx to HTTP xxx, so a conflict becomes PT409 and stays an HTTP 409.
--
-- Nothing else changes: the product rule is identical (a stale revision is refused, nothing is
-- applied, no newer state is overwritten, the caller is told to reload), the messages are unchanged,
-- and each function keeps the body, security mode and search_path it already had. These are
-- re-definitions of 44 applied functions, so migration 029 and every earlier migration stay untouched.
begin;

-- from 202610050026_pre_prompt10_product_amendment.sql
create or replace function tonde_private.bind_reference_analysis_identity_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare current_identity_revision integer; pinned_identity_revision integer;
begin
  select r.identity_revision into current_identity_revision from tonde.production_references r
    where r.workspace_id=new.workspace_id and r.production_id=new.production_id and r.id=new.reference_id;
  if current_identity_revision is null then
    raise exception 'Reference identity revision is unavailable for this analysis' using errcode='P0002';
  end if;
  if tg_op = 'INSERT' then
    select a.identity_revision into pinned_identity_revision from tonde.reference_analyses a
      where a.workspace_id=new.workspace_id and a.reference_id=new.reference_id;
    if new.identity_revision is not null then
      pinned_identity_revision := new.identity_revision;
    elsif pinned_identity_revision is null then
      pinned_identity_revision := current_identity_revision;
    end if;
    new.identity_revision := pinned_identity_revision;
  end if;
  if new.identity_revision is null or new.identity_revision is distinct from current_identity_revision then
    raise exception 'Reference identity changed while this analysis was running' using errcode = 'PT409';
  end if;
  if new.analyzed_at is not null and new.identity_revision is null then
    raise exception 'Analysis must be claimed against a verified Reference identity before completion' using errcode='23514';
  end if;
  return new;
end $$;

-- from 202610050018_long_form_series.sql
create or replace function tonde_private.lf_node_guard(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid, expected_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare row_revision integer; row_locked timestamptz; row_lifecycle tonde.lifecycle;
begin
  if target_level = 'act' then
    select revision, locked_at, lifecycle into row_revision, row_locked, row_lifecycle from tonde.acts
      where workspace_id = target_workspace and production_id = target_production and id = target_id;
  elsif target_level = 'sequence' then
    select revision, locked_at, lifecycle into row_revision, row_locked, row_lifecycle from tonde.sequences
      where workspace_id = target_workspace and production_id = target_production and id = target_id;
  else
    raise exception 'Unsupported structure level' using errcode = '22023';
  end if;
  if not found then raise exception 'That structure object is unavailable in this Production' using errcode = 'P0002'; end if;
  if row_lifecycle <> 'active' then raise exception 'That structure object is archived' using errcode = '23514'; end if;
  if row_locked is not null then raise exception 'That object is locked. Unlock it before editing.' using errcode = '23514'; end if;
  if expected_revision is not null and row_revision <> expected_revision then
    raise exception 'That object changed since you loaded it' using errcode = 'PT409';
  end if;
end $$;

-- from 202610050018_long_form_series.sql
create or replace function tonde_private.lf_series_revision_guard(target_workspace uuid, target_series uuid, expected_revision integer)
returns tonde.series language plpgsql security definer set search_path = '' as $$
declare row_value tonde.series;
begin
  perform tonde_private.director_guard(target_workspace);
  row_value := tonde_private.lf_series_for(target_workspace, target_series);
  if row_value.lifecycle <> 'active' then raise exception 'This Series is archived' using errcode = '23514'; end if;
  if expected_revision is not null and row_value.revision <> expected_revision then
    raise exception 'The Series changed since you loaded it' using errcode = 'PT409';
  end if;
  return row_value;
end $$;

-- from 202610050015_studio_workspace.sql
create or replace function tonde_private.studio_guard(target_workspace uuid, target_production uuid, expected_revision integer)
returns tonde.productions language plpgsql security definer set search_path = '' as $$
declare current tonde.productions;
begin
  perform tonde_private.director_guard(target_workspace);
  select * into current from tonde.productions
    where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if current.lifecycle <> 'active' then
    raise exception 'This Production is archived' using errcode = '23514';
  end if;
  if expected_revision is not null and current.revision <> expected_revision then
    raise exception 'The Production changed since you loaded it' using errcode = 'PT409';
  end if;
  return current;
end $$;

-- from 202610050015_studio_workspace.sql
create or replace function tonde_private.studio_revision_guard(target_workspace uuid, target_production uuid, target_id uuid, object_kind text, expected_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare row_revision integer; row_locked timestamptz; row_lifecycle tonde.lifecycle;
begin
  if object_kind = 'scene' then
    select revision, locked_at, lifecycle into row_revision, row_locked, row_lifecycle from tonde.scenes
      where workspace_id = target_workspace and production_id = target_production and id = target_id;
  elsif object_kind = 'shot' then
    select revision, locked_at, lifecycle into row_revision, row_locked, row_lifecycle from tonde.shots
      where workspace_id = target_workspace and production_id = target_production and id = target_id;
  else
    raise exception 'Unsupported Studio object kind' using errcode = '22023';
  end if;
  if not found then raise exception 'That % is unavailable in this Production', object_kind using errcode = 'P0002'; end if;
  if row_lifecycle <> 'active' then raise exception 'That % is archived', object_kind using errcode = '23514'; end if;
  if row_locked is not null then raise exception 'That % is locked. Unlock it before editing.', object_kind using errcode = '23514'; end if;
  if expected_revision is not null and row_revision <> expected_revision then
    raise exception 'That % changed since you loaded it', object_kind using errcode = 'PT409';
  end if;
end $$;

-- from 202610050022_versioning_branches.sql
create or replace function tonde_private.vb_patch_apply(target_workspace uuid, target_production uuid, target_object uuid,
  patch jsonb, expected_revision integer default null, action text default 'update')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare object_row tonde.objects; map jsonb; field_name text; field_type text; assignments text := '';
  scope_kind text; new_revision integer; changed text[] := '{}'; value_text text;
begin
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  map := tonde_private.vb_fields(object_row.kind);
  if map is null then raise exception 'That object kind cannot be changed by a version operation' using errcode = '22023'; end if;
  if jsonb_typeof(patch) <> 'object' then raise exception 'A change is an object of fields' using errcode = '22023'; end if;
  for field_name in select jsonb_object_keys(patch) order by 1 loop
    if not (map->'fields' ? field_name) then
      raise exception 'The field % cannot be changed this way', field_name using errcode = '22023';
    end if;
    field_type := map->'fields'->>field_name;
    if patch->field_name = 'null'::jsonb then
      assignments := assignments || format(', %I = null', field_name);
    else
      value_text := case when field_type = 'jsonb' then (patch->field_name)::text else patch->>field_name end;
      assignments := assignments || format(', %I = %L::%s', field_name, value_text, field_type);
    end if;
    changed := changed || field_name;
  end loop;
  if assignments = '' then
    raise exception 'Provide at least one field to change' using errcode = '22023';
  end if;
  assignments := ltrim(assignments, ', ');
  scope_kind := map->>'scope';
  perform set_config('tonde.version_action', coalesce(nullif(action, ''), 'update'), true);
  if scope_kind = 'workspace' then
    execute format('update tonde.%I set %s where workspace_id = $1 and id = $2 and ($3 is null or revision = $3) returning revision',
      map->>'table', assignments) using target_workspace, target_object, expected_revision into new_revision;
  else
    execute format('update tonde.%I set %s where workspace_id = $1 and production_id = $2 and id = $3 and ($4 is null or revision = $4) returning revision',
      map->>'table', assignments) using target_workspace, target_production, target_object, expected_revision into new_revision;
  end if;
  perform set_config('tonde.version_action', '', true);
  if new_revision is null then
    raise exception 'That object changed since this change was written. Preview the merge again.' using errcode = 'PT409';
  end if;
  return jsonb_build_object('object_id', target_object, 'kind', object_row.kind, 'revision', new_revision,
    'changed_fields', to_jsonb(changed), 'action', coalesce(nullif(action,''),'update'));
end $$;

-- from 202610050025_prompt7_integrity_readiness.sql
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
    raise exception 'The Production changed since you loaded it' using errcode = 'PT409';
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

-- from 202610050014_director_apply_operation.sql
create or replace function tonde.apply_director_operation(
  target_workspace uuid, target_production uuid, expected_production_revision integer,
  target_operation uuid, operation_type text, bundle jsonb, explicit_confirmation boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare production_row tonde.productions;
  existing tonde.director_operations;
  plan jsonb;
  brief jsonb;
  story jsonb;
  script jsonb;
  target_duration bigint;
  scene jsonb;
  scene_index integer := 0;
  scene_count integer := 0;
  scene_total bigint := 0;
  scene_duration bigint;
  scene_order bigint := 1024;
  scene_id uuid;
  scene_ids jsonb := '{}'::jsonb;
  scene_id_text text;
  assets_result jsonb;
  character_assets jsonb := '{}'::jsonb;
  document_row tonde.creative_documents;
  document_id uuid;
  script_scene jsonb;
  line jsonb;
  script_scene_index integer := 0;
  line_order bigint;
  dialogue_count integer := 0;
  speaker_id uuid;
  item jsonb;
  production_revision_out integer;
  bundle_hash text := md5(bundle::text);
  brief_content text;
  story_content text;
  script_content text;
  producer_kind text;
begin
  perform tonde_private.director_guard(target_workspace);
  if explicit_confirmation is not true then
    raise exception 'Creator confirmation is required to apply this Director operation' using errcode = '42501';
  end if;
  if operation_type not in ('apply_production_plan','director_command','story_generation','script_generation',
    'scene_generation','domain_content_generation','runtime_validation','reality_check') then
    raise exception 'Unsupported Director operation type' using errcode = '22023';
  end if;
  if jsonb_typeof(bundle) <> 'object' or pg_column_size(bundle) > 4000000 then
    raise exception 'Invalid Director operation bundle' using errcode = '22023';
  end if;
  plan := coalesce(bundle->'production','{}'::jsonb);
  brief := coalesce(bundle->'brief','{}'::jsonb);
  story := case when jsonb_typeof(bundle->'story') = 'object' then bundle->'story' else null end;
  script := case when jsonb_typeof(bundle->'script') = 'object' then bundle->'script' else null end;
  select * into production_row from tonde.productions
    where workspace_id = target_workspace and id = target_production for update;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  -- Idempotency first: a retried operation with identical content never duplicates content.
  select * into existing from tonde.director_operations
    where workspace_id = target_workspace and operation_id = target_operation for update;
  if found and existing.status in ('succeeded','partial') and existing.payload_hash is not null then
    if existing.payload_hash is distinct from bundle_hash then
      raise exception 'This operation id was already applied with different content' using errcode = '23505';
    end if;
    return jsonb_build_object('production_id', target_production, 'operation_id', target_operation, 'idempotent', true,
      'production_revision', production_row.revision, 'duplicate_applied', true);
  end if;
  if production_row.revision <> expected_production_revision then
    raise exception 'Production changed; reload before applying this operation' using errcode = 'PT409';
  end if;
  if production_row.locked_at is not null or production_row.approval <> 'draft' then
    raise exception 'Apply Director operations to an unlocked Draft Production' using errcode = '55000';
  end if;
  producer_kind := case when bundle->>'producer' = 'model' then 'model' else 'deterministic' end;
  if coalesce(length(btrim(plan->>'title')),0) = 0 or length(plan->>'title') > 160
    or coalesce(length(btrim(brief->>'production_goal')),0) = 0 or length(brief->>'production_goal') > 10000 then
    raise exception 'Invalid Director production plan' using errcode = '22023';
  end if;
  if not exists(select 1 from unnest(enum_range(null::tonde.production_type)) t where t::text = plan->>'production_type')
    or not exists(select 1 from unnest(enum_range(null::tonde.execution_method)) t where t::text = plan->>'execution_method') then
    raise exception 'Unsupported Production classification or execution method' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(bundle->'scenes','[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(bundle->'scenes','[]'::jsonb)) > 40 then
    raise exception 'Invalid Scene list' using errcode = '22023';
  end if;
  if plan->>'planned_duration_ms' is not null then
    if plan->>'planned_duration_ms' !~ '^[0-9]{1,16}$' then raise exception 'Runtime must use integer milliseconds' using errcode = '22023'; end if;
    target_duration := (plan->>'planned_duration_ms')::bigint;
    if target_duration > 9007199254740991 then raise exception 'Runtime exceeds the safe integer range' using errcode = '22023'; end if;
    if jsonb_array_length(coalesce(bundle->'scenes','[]'::jsonb)) = 0 then raise exception 'A timed Production needs at least one Scene' using errcode = '22023'; end if;
  else
    target_duration := null;
  end if;
  for scene in select value from jsonb_array_elements(coalesce(bundle->'scenes','[]'::jsonb)) loop
    scene_index := scene_index + 1;
    if jsonb_typeof(scene) <> 'object' or coalesce(length(btrim(scene->>'title')),0) = 0 or length(scene->>'title') > 160
      or length(coalesce(scene->>'purpose','')) > 1200 or length(coalesce(scene->>'story_beat','')) > 200
      or jsonb_typeof(coalesce(scene->'action_lines','[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(scene->'action_lines','[]'::jsonb)) > 16 then
      raise exception 'Invalid planned Scene' using errcode = '22023';
    end if;
    if target_duration is not null then
      if scene->>'duration_ms' is null or scene->>'duration_ms' !~ '^[0-9]{1,16}$' then
        raise exception 'Every timed Scene needs integer milliseconds' using errcode = '22023';
      end if;
      scene_duration := (scene->>'duration_ms')::bigint;
      if scene_duration > 9007199254740991 then raise exception 'Scene duration exceeds the safe integer range' using errcode = '22023'; end if;
      if scene_total > 9007199254740991 - scene_duration then raise exception 'Scene duration sum exceeds the safe integer range' using errcode = '22003'; end if;
      scene_total := scene_total + scene_duration;
    elsif scene->>'duration_ms' is not null then
      raise exception 'Scene durations require a Production runtime target' using errcode = '22023';
    end if;
  end loop;
  if target_duration is not null and scene_total <> target_duration then
    raise exception 'Scene durations must equal the Production target exactly' using errcode = '23514';
  end if;
  -- Prior Scenes are archived (never hard-deleted) and moved out of the live ordering range.
  update tonde.scenes s set lifecycle = 'archived',
    sort_order = (select coalesce(max(x.sort_order), 0) from tonde.scenes x
      where x.workspace_id = target_workspace and x.production_id = target_production) + 1000000 + s.sort_order
    where s.workspace_id = target_workspace and s.production_id = target_production and s.lifecycle = 'active';
  for scene in select value from jsonb_array_elements(coalesce(bundle->'scenes','[]'::jsonb)) loop
    scene_count := scene_count + 1;
    insert into tonde.scenes(workspace_id, production_id, title, purpose, description, story_beat, opening_state,
      ending_state, visual_intent, dialogue_notes, action_lines, scene_detail, sort_order, planned_duration_ms, source_operation_id)
    values (target_workspace, target_production, left(scene->>'title',160), left(coalesce(scene->>'purpose',''),1200),
      left(coalesce(scene->>'description',''),4000), left(coalesce(scene->>'story_beat',''),200),
      left(coalesce(scene->>'opening_state',''),400), left(coalesce(scene->>'ending_state',''),400),
      left(coalesce(scene->>'visual_intent',''),900), left(coalesce(scene->>'dialogue_notes',''),900),
      coalesce(scene->'action_lines','[]'::jsonb),
      jsonb_build_object('environment', coalesce(scene->>'environment',''), 'characters', coalesce(scene->'characters','[]'::jsonb),
        'products', coalesce(scene->'products','[]'::jsonb), 'techniques', coalesce(scene->'techniques','[]'::jsonb),
        'shots', coalesce(scene->'shots','[]'::jsonb), 'plan_order', scene_count),
      scene_order, case when target_duration is null then null else (scene->>'duration_ms')::bigint end, target_operation)
    returning id into scene_id;
    scene_ids := scene_ids || jsonb_build_object(coalesce(nullif(scene->>'order',''), scene_count::text), scene_id::text);
    scene_order := scene_order + 1024;
  end loop;
  assets_result := tonde_private.director_apply_assets(target_workspace, target_production, target_operation, bundle);
  character_assets := coalesce(assets_result->'character_assets','{}'::jsonb);
  -- Creative documents are the readable record of the same structured content.
  delete from tonde.dialogue_lines where workspace_id = target_workspace and production_id = target_production;
  delete from tonde.creative_documents where workspace_id = target_workspace and production_id = target_production
    and document_type in ('brief','story','script');
  brief_content := concat_ws(E'\n\n', 'PRODUCTION GOAL: ' || (brief->>'production_goal'),
    case when coalesce(brief->>'audience','') <> '' then 'AUDIENCE: ' || (brief->>'audience') end,
    case when coalesce(brief->>'core_message','') <> '' then 'CORE MESSAGE: ' || (brief->>'core_message') end,
    case when coalesce(brief->>'call_to_action','') <> '' then 'CALL TO ACTION: ' || (brief->>'call_to_action') end,
    case when coalesce(brief->>'story_approach','') <> '' then 'STORY APPROACH: ' || (brief->>'story_approach') end,
    case when coalesce(brief->>'dialogue_approach','') <> '' then 'DIALOGUE: ' || (brief->>'dialogue_approach') end,
    case when jsonb_typeof(brief->'hard_constraints') = 'array' and jsonb_array_length(brief->'hard_constraints') > 0
      then 'HARD CONSTRAINTS: ' || (select string_agg(value, '; ') from jsonb_array_elements_text(brief->'hard_constraints') as value) end,
    case when jsonb_typeof(brief->'assumptions') = 'array' and jsonb_array_length(brief->'assumptions') > 0
      then 'ASSUMPTIONS: ' || (select string_agg(value->>'statement', '; ') from jsonb_array_elements(brief->'assumptions') as value) end);
  insert into tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type, title, content)
    values (target_workspace, target_production, target_production, 'brief', 'Production Brief', left(brief_content, 1000000));
  if story is not null then
    story_content := concat_ws(E'\n\n', 'LOGLINE: ' || coalesce(story->>'logline',''),
      case when coalesce(story->>'premise','') <> '' then 'PREMISE: ' || (story->>'premise') end,
      case when coalesce(story->>'central_question','') <> '' then 'CENTRAL QUESTION: ' || (story->>'central_question') end,
      case when jsonb_typeof(story->'beats') = 'array' then (select string_agg((value->>'order') || '. ' || (value->>'name') || E'\n' || (value->>'content'), E'\n\n')
        from jsonb_array_elements(story->'beats') as value) end,
      case when coalesce(story->>'call_to_action','') <> '' then 'CTA: ' || (story->>'call_to_action') end);
    insert into tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type, title, content)
      values (target_workspace, target_production, target_production, 'story', left(coalesce(story->>'title','Story'),160), left(story_content, 1000000));
    insert into tonde.creative_stories as cs (workspace_id, production_id, story, variation, producer, source_operation_id)
      values (target_workspace, target_production, story, left(coalesce(story->>'variation','original'),60), producer_kind, target_operation)
      on conflict (workspace_id, production_id) do update set story = excluded.story, variation = excluded.variation,
        producer = excluded.producer, source_operation_id = excluded.source_operation_id;
  end if;
  if script is not null then
    script_content := coalesce(script->>'title','Script') || E'\n\n' ||
      coalesce((select string_agg(
        (value->>'heading') || E'\n\n' ||
        coalesce((select string_agg(action, E'\n') from jsonb_array_elements_text(coalesce(value->'action','[]'::jsonb)) as action), '') ||
        E'\n\n' ||
        coalesce((select string_agg(
          case when coalesce(script_line->>'speaker','') = '' then '' else upper(script_line->>'speaker') || E'\n' end ||
          case when coalesce(script_line->>'kind','') = 'dialogue' then '  ' || coalesce(script_line->>'content','')
            else '[' || upper(coalesce(script_line->>'kind','dialogue')) || '] ' || coalesce(script_line->>'content','') end,
          E'\n') from jsonb_array_elements(coalesce(value->'lines','[]'::jsonb)) as script_line), '') ||
        E'\n\n' ||
        case when coalesce(value->>'transition','') = '' then '' else '>> ' || (value->>'transition') end,
        E'\n\n') from jsonb_array_elements(coalesce(script->'scenes','[]'::jsonb)) as value), '');
    insert into tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type, title, content)
      values (target_workspace, target_production, target_production, 'script', left(coalesce(script->>'title','Script'),160), left(script_content, 1000000))
      returning * into document_row;
    document_id := document_row.id;
    for script_scene in select value from jsonb_array_elements(coalesce(script->'scenes','[]'::jsonb)) loop
      script_scene_index := script_scene_index + 1;
      scene_id_text := nullif(script_scene->>'scene_order','');
      scene_id := null;
      if scene_id_text is not null and scene_ids ? scene_id_text then
        scene_id := (scene_ids->>scene_id_text)::uuid;
      end if;
      line_order := 1;
      for line in select value from jsonb_array_elements(coalesce(script_scene->'lines','[]'::jsonb)) loop
        if jsonb_typeof(line) <> 'object'
          or not exists(select 1 from unnest(enum_range(null::tonde.dialogue_kind)) k where k::text = coalesce(line->>'kind','dialogue')) then
          raise exception 'Unsupported dialogue line kind' using errcode = '22023';
        end if;
        dialogue_count := dialogue_count + 1;
        speaker_id := null;
        if coalesce(line->>'speaker','') <> '' and character_assets ? lower(line->>'speaker') then
          speaker_id := (character_assets->>lower(line->>'speaker'))::uuid;
        end if;
        insert into tonde.dialogue_lines(workspace_id, production_id, document_id, scene_id, speaker_asset_id,
          line_type, content, sort_order, start_ms, duration_ms, intention, delivery, subtext, pause_after_ms, line_flags)
        values (target_workspace, target_production, document_id, scene_id, speaker_id,
          coalesce(line->>'kind','dialogue')::tonde.dialogue_kind, left(coalesce(line->>'content',''),4000),
          (coalesce(nullif(scene_id_text,'')::bigint, script_scene_index::bigint) * 1000) + line_order,
          0, greatest(0, least(9007199254740991, coalesce((line->>'estimated_ms')::bigint, 0))),
          left(coalesce(line->>'intention',''),300), left(coalesce(line->>'delivery',''),300),
          left(coalesce(line->>'subtext',''),300), greatest(0, least(60000, coalesce((line->>'pause_after_ms')::bigint, 0))),
          jsonb_build_object('interruption', coalesce((line->>'interruption')::boolean, false),
            'overlap', coalesce((line->>'overlap')::boolean, false),
            'reaction_to', line->'reaction_to', 'order', line->'order'));
        line_order := line_order + 1;
      end loop;
    end loop;
  end if;
  insert into tonde.director_briefs as db (workspace_id, production_id, brief, producer, source_operation_id)
    values (target_workspace, target_production, brief, producer_kind, target_operation)
    on conflict (workspace_id, production_id) do update set brief = excluded.brief, producer = excluded.producer,
      source_operation_id = excluded.source_operation_id;
  for item in select value from jsonb_array_elements(coalesce(bundle->'decisions','[]'::jsonb)) loop
    if jsonb_typeof(item) = 'object' and coalesce(length(btrim(item->>'decision_id')),0) > 0 then
      insert into tonde.director_decisions as d (workspace_id, production_id, decision_id, question, answer, priority, impact, decided_by, decision_source)
        values (target_workspace, target_production, left(item->>'decision_id',80), left(coalesce(item->>'question',''),400),
          left(coalesce(item->>'answer',''),500), coalesce(item->>'priority','high_impact'), coalesce(item->>'impact','high'),
          case when item->>'answer' = 'TONDE decides' then 'tonde' else coalesce(item->>'decided_by','creator') end, 'studio')
        on conflict (production_id, decision_id) do update set answer = excluded.answer, priority = excluded.priority,
          impact = excluded.impact, decided_by = excluded.decided_by, decision_source = excluded.decision_source;
    end if;
  end loop;
  if jsonb_typeof(bundle->'reality') = 'object' then
    insert into tonde.director_reality_checks as rc (workspace_id, production_id, report, feasibility, complexity, recommended_mode, source_operation_id)
      values (target_workspace, target_production, bundle->'reality',
        coalesce(bundle->'reality'->>'feasibility','ready'), coalesce(bundle->'reality'->>'complexity','simple'),
        coalesce(bundle->'reality'->'mode'->>'method','real'), target_operation)
      on conflict (workspace_id, production_id) do update set report = excluded.report, feasibility = excluded.feasibility,
        complexity = excluded.complexity, recommended_mode = excluded.recommended_mode, source_operation_id = excluded.source_operation_id;
  end if;
  update tonde.productions set title = left(plan->>'title',160),
    production_type = (plan->>'production_type')::tonde.production_type,
    execution_method = (plan->>'execution_method')::tonde.execution_method,
    planned_duration_ms = target_duration
    where workspace_id = target_workspace and id = target_production;
  insert into tonde.director_operations(workspace_id, production_id, operation_id, operation_type, scope, source_revision,
    source_intake_revision, status, producer, provider, model, model_profile, idempotency_key, collaboration_mode, rationale,
    limitations, payload, payload_hash, started_at, completed_at, created_by)
  values (target_workspace, target_production, target_operation, operation_type, 'production', expected_production_revision,
    null, 'succeeded', producer_kind, bundle->'operation'->>'provider', bundle->'operation'->>'model',
    coalesce(bundle->'operation'->>'model_profile','default'),
    coalesce(bundle->'operation'->>'idempotency_key', 'apply:' || target_operation::text),
    coalesce(bundle->'operation'->>'collaboration_mode','stop_at_major_decisions'),
    left(coalesce(bundle->'operation'->>'rationale',''),1200),
    coalesce(bundle->'operation'->'limitations','[]'::jsonb),
    jsonb_build_object('scenes', scene_count, 'dialogue_lines', dialogue_count, 'assets', assets_result),
    bundle_hash, now(), now(), auth.uid())
  on conflict (workspace_id, operation_id) do update set
    status = 'succeeded', producer = excluded.producer, provider = excluded.provider, model = excluded.model,
    model_profile = excluded.model_profile, rationale = excluded.rationale, limitations = excluded.limitations,
    payload = excluded.payload, payload_hash = excluded.payload_hash, completed_at = now(),
    error_code = null, error_message = null;
  select revision into production_revision_out from tonde.productions
    where workspace_id = target_workspace and id = target_production;
  return jsonb_build_object('production_id', target_production, 'operation_id', target_operation, 'idempotent', false,
    'production_revision', production_revision_out, 'scenes', scene_count, 'dialogue_lines', dialogue_count,
    'assets', assets_result, 'runtime_ms', target_duration);
end;
$$;

-- from 202610050011_director_intake.sql
create or replace function tonde.apply_director_plan(
  target_workspace uuid, target_production uuid, expected_production_revision integer,
  expected_intake_revision integer, operation_id uuid, explicit_confirmation boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare production_row tonde.productions;
  intake_row tonde.director_intakes;
  proposal_row tonde.director_plan_proposals;
  scene jsonb;
  scene_count integer := 0;
  scene_total bigint := 0;
  target_duration bigint;
  scene_duration bigint;
  scene_order bigint := 1024;
  story_content text;
begin
  if auth.uid() is null or (select auth.role()) <> 'authenticated'
    or not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Authenticated workspace editor required' using errcode = '42501';
  end if;
  if explicit_confirmation is not true then
    raise exception 'Creator confirmation is required to build this Production' using errcode = '42501';
  end if;
  select * into production_row from tonde.productions
    where workspace_id=target_workspace and id=target_production for update;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  select * into intake_row from tonde.director_intakes
    where workspace_id=target_workspace and production_id=target_production for update;
  if not found then
    raise exception 'Director intake unavailable' using errcode = 'P0002';
  end if;
  if intake_row.status='ready_for_studio' and intake_row.applied_operation_id=operation_id then
    return jsonb_build_object('production_id',target_production,'intake_id',intake_row.id,'idempotent',true);
  end if;
  if production_row.revision <> expected_production_revision or intake_row.revision <> expected_intake_revision then
    raise exception 'Production or Director intake changed; reload before applying this draft' using errcode = 'PT409';
  end if;
  if production_row.approval <> 'draft' or production_row.locked_at is not null then
    raise exception 'Only an unlocked Draft Production can receive its initial Director plan' using errcode = '55000';
  end if;
  if intake_row.status='ready_for_studio' then
    raise exception 'An initial plan already exists; regeneration must be a reviewed proposal' using errcode = '55000';
  end if;
  if intake_row.status <> 'draft_ready' or intake_row.proposal_operation_id is distinct from operation_id then
    raise exception 'Review the current plan proposal before applying it' using errcode = '55000';
  end if;
  select * into proposal_row from tonde.director_plan_proposals p
    where p.workspace_id=target_workspace and p.production_id=target_production
      and p.operation_id=apply_director_plan.operation_id for update;
  if not found or proposal_row.state <> 'proposed'
    or proposal_row.source_production_revision <> production_row.revision
    or proposal_row.source_intake_revision + 1 <> intake_row.revision then
    raise exception 'This plan proposal is stale or no longer current' using errcode = 'PT409';
  end if;
  if production_row.approval <> 'draft' or production_row.locked_at is not null then
    raise exception 'Only an unlocked Draft Production can receive its initial Director plan' using errcode = '55000';
  end if;
  if jsonb_typeof(intake_row.plan) <> 'object' or pg_column_size(intake_row.plan) > 100000
    or coalesce(length(btrim(intake_row.plan->>'title')),0)=0 or length(intake_row.plan->>'title') > 160
    or coalesce(length(btrim(intake_row.plan->>'creative_objective')),0)=0
    or not (intake_row.plan ? 'scenes') or jsonb_typeof(intake_row.plan->'scenes') <> 'array'
    or jsonb_array_length(intake_row.plan->'scenes') > 40 then
    raise exception 'Invalid Director production plan' using errcode = '22023';
  end if;
  if not exists (select 1 from unnest(enum_range(null::tonde.production_type)) t where t::text=intake_row.plan->>'production_type')
    or not exists (select 1 from unnest(enum_range(null::tonde.execution_method)) t where t::text=intake_row.plan->>'execution_method') then
    raise exception 'Unsupported Production classification or execution method' using errcode = '22023';
  end if;
  target_duration := case when intake_row.plan->>'planned_duration_ms' is null then null else (intake_row.plan->>'planned_duration_ms')::bigint end;
  if intake_row.plan->>'planned_duration_ms' is not null then
    if intake_row.plan->>'planned_duration_ms' !~ '^[0-9]{1,16}$' or target_duration > 9007199254740991 then
      raise exception 'Runtime must use safe integer milliseconds' using errcode = '22023';
    end if;
  end if;
  for scene in select value from jsonb_array_elements(intake_row.plan->'scenes') loop
    scene_count := scene_count + 1;
    if jsonb_typeof(scene) <> 'object' or coalesce(length(btrim(scene->>'title')),0)=0
      or length(scene->>'title') > 160 or coalesce(length(scene->>'purpose'),0) > 2000 then
      raise exception 'Invalid planned Scene' using errcode = '22023';
    end if;
    if target_duration is not null then
      if scene->>'duration_ms' is null or scene->>'duration_ms' !~ '^[0-9]{1,16}$' then
        raise exception 'Every timed Scene needs integer milliseconds' using errcode = '22023';
      end if;
      scene_duration := (scene->>'duration_ms')::bigint;
      if scene_duration > 9007199254740991 then raise exception 'Scene duration exceeds safe integer range' using errcode = '22023'; end if;
      if scene_total > 9007199254740991 - scene_duration then
        raise exception 'Scene duration sum exceeds safe integer range' using errcode = '22003';
      end if;
      scene_total := scene_total + scene_duration;
    end if;
  end loop;
  if target_duration is not null and scene_total <> target_duration then
    raise exception 'Scene durations must equal the Production target exactly' using errcode = '23514';
  end if;
  if scene_total > 9007199254740991 then
    raise exception 'Scene duration sum exceeds safe integer range' using errcode = '22003';
  end if;
  if target_duration is null and exists(select 1 from jsonb_array_elements(intake_row.plan->'scenes') s where s->>'duration_ms' is not null) then
    raise exception 'Scene durations require a Production target runtime' using errcode = '22023';
  end if;
  if exists(select 1 from tonde.scenes where workspace_id=target_workspace and production_id=target_production and lifecycle='active') then
    raise exception 'Production already contains Scenes; initial plan cannot replace existing work' using errcode = '55000';
  end if;

  update tonde.productions set title=intake_row.plan->>'title', production_type=(intake_row.plan->>'production_type')::tonde.production_type,
    execution_method=(intake_row.plan->>'execution_method')::tonde.execution_method,
    planned_duration_ms=target_duration where id=target_production and workspace_id=target_workspace;
  update tonde.director_plan_proposals p set state='applied' where p.id=proposal_row.id;
  update tonde.director_intakes set status='ready_for_studio',
    applied_operation_id=apply_director_plan.operation_id, updated_at=now()
      where id=intake_row.id;
  if scene_count > 0 then
    for scene in select value from jsonb_array_elements(intake_row.plan->'scenes') loop
      insert into tonde.scenes(workspace_id,production_id,title,purpose,description,sort_order,planned_duration_ms)
      values(target_workspace,target_production,scene->>'title',coalesce(scene->>'purpose',''),
        coalesce(scene->>'description',''),scene_order,
        case when scene->>'duration_ms' is null then null else (scene->>'duration_ms')::bigint end);
      scene_order := scene_order + 1024;
    end loop;
  end if;
  insert into tonde.creative_documents(workspace_id,production_id,scope_object_id,document_type,title,content)
    values(target_workspace,target_production,target_production,'brief','Production Brief',intake_row.plan->>'creative_objective');
  if intake_row.plan->'story' is not null and intake_row.plan->'story' <> 'null'::jsonb then
    story_content := coalesce(intake_row.plan->'story'->>'summary','');
    insert into tonde.creative_documents(workspace_id,production_id,scope_object_id,document_type,title,content)
      values(target_workspace,target_production,target_production,'story','Director Structure',story_content);
  end if;
  return jsonb_build_object('production_id',target_production,'intake_id',intake_row.id,'idempotent',false);
end;
$$;

-- from 202610050019_dependencies_impact.sql
create or replace function tonde.apply_impact(target_workspace uuid, target_production uuid, target_analysis uuid,
  desired_mode text, selected_ids uuid[] default '{}', expected_root_revision integer default null, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare analysis tonde.impact_analyses; current_revision integer; node jsonb; target uuid; marked integer := 0;
  locked_skipped jsonb := '[]'::jsonb; requiring_review jsonb := '[]'::jsonb; direct_ids uuid[] := '{}';
  downstream_count integer := 0; unresolved integer := 0; kinds text[] := array['real_plan','ai_plan','prompt','first_frame',
  'last_frame','generation_context','result_comparison','derived_summary','continuity_state'];
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into analysis from tonde.impact_analyses
    where workspace_id = target_workspace and production_id = target_production and id = target_analysis;
  if not found then raise exception 'That impact analysis is unavailable' using errcode = 'P0002'; end if;
  if analysis.applied_mode is not null then
    raise exception 'That impact analysis was already applied' using errcode = '23514';
  end if;
  current_revision := tonde_private.pi_object_revision(target_workspace, analysis.root_object_id);
  if current_revision is distinct from analysis.root_revision
    or (expected_root_revision is not null and expected_root_revision <> analysis.root_revision) then
    raise exception 'The source changed since this impact was computed. Preview the impact again.' using errcode = 'PT409';
  end if;
  if desired_mode not in ('update_all','review_changes','change_only_this') then
    raise exception 'Unsupported impact mode' using errcode = '22023';
  end if;
  for node in select * from jsonb_array_elements(analysis.classifications->'nodes') loop
    target := (node->>'object_id')::uuid;
    -- Every proposal pins the revisions it was computed from: if a dependent moved on since the
    -- preview, this operation is stale and is rejected instead of applied against newer content.
    if (node->>'revision') is not null
      and tonde_private.pi_object_revision(target_workspace, target) is distinct from (node->>'revision')::integer then
      raise exception 'A dependent object changed since this impact was computed. Preview the impact again.' using errcode = 'PT409';
    end if;
    if coalesce((node->>'depth')::integer, 1) > 1 then downstream_count := downstream_count + 1; end if;
    if node->>'classification' = 'direct' then direct_ids := direct_ids || target; end if;
    if desired_mode = 'review_changes' and not (target = any(selected_ids)) then continue; end if;
    if desired_mode = 'change_only_this' then
      -- The direct dependents keep their artifacts (nothing is rewritten) but they stop claiming
      -- to be current; everything further downstream stays explicitly unresolved.
      if node->>'classification' <> 'direct' then continue; end if;
      if tonde_private.pi_is_locked(target_workspace, target) then
        locked_skipped := locked_skipped || to_jsonb(jsonb_build_object('object_id', target, 'label', node->>'label',
          'reason', 'locked')); continue;
      end if;
      marked := marked + 1;
      perform tonde_private.pi_mark_stale(target_workspace, target_production, target, 'dependent_object', null,
        'CHANGE ONLY THIS: the source changed and this dependent was intentionally left as it was.', analysis.root_object_id,
        analysis.root_revision, analysis.root_revision, tonde_private.pi_object_revision(target_workspace, target), 'stale');
      continue;
    end if;
    if tonde_private.pi_is_locked(target_workspace, target) then
      locked_skipped := locked_skipped || to_jsonb(jsonb_build_object('object_id', target, 'label', node->>'label',
        'reason', 'The dependent object is locked. Unlock it before TONDE updates it.'));
      continue;
    end if;
    if tonde_private.pi_is_approved(target_workspace, target) then
      requiring_review := requiring_review || to_jsonb(jsonb_build_object('object_id', target, 'label', node->>'label',
        'revision', tonde_private.pi_object_revision(target_workspace, target),
        'reason', 'Approved content is never rewritten silently.'));
      perform tonde_private.pi_mark_stale(target_workspace, target_production, target, 'dependent_object', null,
        'Approved content depends on a changed source and needs review.', analysis.root_object_id, analysis.root_revision,
        analysis.root_revision, tonde_private.pi_object_revision(target_workspace, target), 'conflicted');
      marked := marked + 1;
      continue;
    end if;
    marked := marked + 1;
    perform tonde_private.pi_mark_stale(target_workspace, target_production, target, 'dependent_object', null,
      'The source ' || coalesce(analysis.root_label,'object') || ' changed after this artifact was derived.',
      analysis.root_object_id, analysis.root_revision, analysis.root_revision,
      tonde_private.pi_object_revision(target_workspace, target), 'stale');
  end loop;
  unresolved := case when desired_mode = 'change_only_this' then greatest(downstream_count, 0) else 0 end;
  update tonde.impact_analyses a set mode = desired_mode::tonde.impact_mode,
    applied_mode = desired_mode::tonde.impact_mode, applied_at = now(),
    unresolved_count = unresolved, note = left(coalesce(note_text,''), 400)
  where a.id = analysis.id;
  return jsonb_build_object('analysis_id', analysis.id, 'mode', desired_mode, 'marked', marked,
    'locked_skipped', locked_skipped, 'requiring_review', requiring_review,
    'direct_count', coalesce(array_length(direct_ids, 1), 0), 'downstream_count', downstream_count,
    'unresolved_count', unresolved,
    'note', case when desired_mode = 'update_all'
        then 'Affected derived artifacts were marked. Approved content and locked objects were reported, not rewritten.'
      when desired_mode = 'review_changes'
        then 'Only the selected dependents were marked.'
      else 'CHANGE ONLY THIS: the change stayed local and the remaining downstream impact is recorded as unresolved.' end);
end $$;

-- from 202610050023_approval_lock_readiness.sql
create or replace function tonde.approval_decide(target_workspace uuid, target_production uuid, target_object uuid,
  decision text, expected_revision integer default null, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare object_row tonde.objects; current_rev integer; from_approval text; from_locked boolean;
  desired tonde.approval; new_rev integer; approval_after text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  if decision not in ('approve','request_review','reopen') then
    raise exception 'A review decision is approve, request_review or reopen' using errcode = '22023';
  end if;
  current_rev := tonde_private.pi_object_revision(target_workspace, target_object);
  if current_rev is null then raise exception 'That object cannot be reviewed' using errcode = '22023'; end if;
  -- Stale operations are rejected: an approval never lands on content the creator did not see.
  if expected_revision is not null and current_rev <> expected_revision then
    raise exception 'That object changed since you loaded it. Review the current revision.' using errcode = 'PT409';
  end if;
  from_approval := tonde_private.ax_approval(target_workspace, target_object);
  from_locked := tonde_private.pi_is_locked(target_workspace, target_object);
  desired := case decision when 'approve' then 'approved'::tonde.approval
    when 'request_review' then 'needs_review'::tonde.approval else 'draft'::tonde.approval end;
  new_rev := tonde_private.ax_set_approval(target_workspace, target_production, target_object, desired);
  if new_rev is null then raise exception 'That object is unavailable in this Production' using errcode = 'P0002'; end if;
  approval_after := tonde_private.ax_approval(target_workspace, target_object);
  insert into tonde.access_decisions(workspace_id, production_id, object_id, object_kind, action,
    from_approval, to_approval, from_locked, to_locked, pinned_revision, note, actor_user_id)
  values (target_workspace, target_production, target_object, object_row.kind, decision::tonde.access_action,
    from_approval::tonde.approval, approval_after::tonde.approval, coalesce(from_locked,false), coalesce(from_locked,false),
    case when decision = 'approve' then new_rev else null end, left(coalesce(note_text,''), 800), auth.uid());
  return jsonb_build_object('object_id', target_object, 'object_kind', object_row.kind,
    'label', tonde_private.pi_label(target_workspace, target_object),
    'action', decision, 'approval', approval_after, 'revision', new_rev,
    'approved_revision', case when decision = 'approve' then new_rev else null end,
    'locked', coalesce(from_locked,false), 'note', left(coalesce(note_text,''), 800),
    'actor_user_id', auth.uid(), 'decided_at', now(),
    'meaning', case when decision = 'approve'
        then 'A creator accepted this exact revision. Approval is a human decision, not a generation result.'
      when decision = 'request_review' then 'This revision is waiting for a creator review.'
      else 'This revision is back to draft.' end);
end $$;

-- from 202610050026_pre_prompt10_product_amendment.sql
create or replace function tonde.audio_plan_save(target_workspace uuid,target_production uuid,expected_revision integer,values_json jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare old_row tonde.production_audio_plans; incoming tonde.production_audio_plans; saved tonde.production_audio_plans;
begin
  perform tonde_private.studio_guard(target_workspace,target_production,null);
  if not exists(select 1 from tonde.productions p where p.workspace_id=target_workspace and p.id=target_production
    and tonde_private.audio_applies(p.production_type,p.planned_duration_ms)) then
    raise exception 'This Production does not require an Audio Plan' using errcode='23514';
  end if;
  if tonde_private.pi_is_locked(target_workspace,target_production) then raise exception 'Unlock the Production before editing its Audio Plan' using errcode='23514'; end if;
  if jsonb_typeof(values_json) is distinct from 'object' then raise exception 'Audio Plan must be an object' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(values_json) as keys(key) where key not in (
    'overall_intent','dialogue_strategy','music_strategy','sound_design_strategy','ambience_strategy',
    'recording_considerations','silence_strategy','recurring_motifs','continuity_considerations',
    'delivery_considerations','intentional_silence','master_song_reference_id','master_song_provenance')) then
    raise exception 'Audio Plan contains unsupported fields' using errcode='22023';
  end if;
  select * into old_row from tonde.production_audio_plans where workspace_id=target_workspace and production_id=target_production for update;
  if found then
    if expected_revision is null or old_row.revision <> expected_revision then raise exception 'Audio Plan changed since it was loaded' using errcode = 'PT409'; end if;
    if tonde_private.pi_is_locked(target_workspace,old_row.id) then raise exception 'Unlock the Audio Plan before editing' using errcode='23514'; end if;
  elsif expected_revision is not null then raise exception 'Audio Plan no longer exists' using errcode = 'PT409'; end if;
  incoming := jsonb_populate_record(old_row,values_json);
  incoming.master_song_provenance := coalesce(incoming.master_song_provenance,'unknown');
  if incoming.master_song_provenance not in ('creator_supplied','licensed','original','generated','external_reference','unknown') then
    raise exception 'Unsupported master song provenance' using errcode='22023';
  end if;
  if incoming.master_song_reference_id is not null and incoming.master_song_provenance not in ('creator_supplied','licensed','external_reference','unknown') then
    raise exception 'A linked master song Reference must remain identified as supplied, licensed, external, or unknown' using errcode='23514';
  end if;
  if old_row.id is null then
    insert into tonde.production_audio_plans(workspace_id,production_id,overall_intent,dialogue_strategy,music_strategy,sound_design_strategy,
      ambience_strategy,recording_considerations,silence_strategy,recurring_motifs,continuity_considerations,delivery_considerations,
      intentional_silence,master_song_reference_id,master_song_provenance,created_by)
    values(target_workspace,target_production,coalesce(incoming.overall_intent,''),coalesce(incoming.dialogue_strategy,''),coalesce(incoming.music_strategy,''),
      coalesce(incoming.sound_design_strategy,''),coalesce(incoming.ambience_strategy,''),coalesce(incoming.recording_considerations,''),
      coalesce(incoming.silence_strategy,''),coalesce(incoming.recurring_motifs,'{}'),coalesce(incoming.continuity_considerations,''),
      coalesce(incoming.delivery_considerations,''),coalesce(incoming.intentional_silence,false),incoming.master_song_reference_id,
      coalesce(incoming.master_song_provenance,'unknown'),auth.uid()) returning * into saved;
  else
    update tonde.production_audio_plans set overall_intent=coalesce(incoming.overall_intent,''),dialogue_strategy=coalesce(incoming.dialogue_strategy,''),
      music_strategy=coalesce(incoming.music_strategy,''),sound_design_strategy=coalesce(incoming.sound_design_strategy,''),
      ambience_strategy=coalesce(incoming.ambience_strategy,''),recording_considerations=coalesce(incoming.recording_considerations,''),
      silence_strategy=coalesce(incoming.silence_strategy,''),recurring_motifs=coalesce(incoming.recurring_motifs,'{}'),
      continuity_considerations=coalesce(incoming.continuity_considerations,''),delivery_considerations=coalesce(incoming.delivery_considerations,''),
      intentional_silence=coalesce(incoming.intentional_silence,false),master_song_reference_id=incoming.master_song_reference_id,
      master_song_provenance=coalesce(incoming.master_song_provenance,'unknown')
      where workspace_id=target_workspace and production_id=target_production returning * into saved;
  end if;
  return to_jsonb(saved);
end $$;

-- from 202610050026_pre_prompt10_product_amendment.sql
create or replace function tonde.claim_reference_analysis_pinned(
  target_workspace uuid, target_production uuid, target_reference uuid, expected_identity_revision integer,
  stage_status text, stage_list text[] default '{}', progress_pct integer default 0, producer_note text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.reference_analyses; reference_row tonde.production_references;
begin
  perform tonde_private.director_guard(target_workspace);
  if stage_status not in ('queued','preprocessing') then
    raise exception 'A pinned analysis claim must begin at queued or preprocessing' using errcode='22023';
  end if;
  select * into reference_row from tonde.production_references
    where workspace_id=target_workspace and production_id=target_production and id=target_reference for update;
  if not found then raise exception 'Reference unavailable in this Production' using errcode='P0002'; end if;
  if expected_identity_revision is null or reference_row.identity_revision <> expected_identity_revision then
    raise exception 'Reference identity changed before analysis began; reload and verify it again' using errcode = 'PT409';
  end if;
  insert into tonde.reference_analyses as ra (workspace_id,production_id,reference_id,status,stages,progress,producer_note,identity_revision,analyzed_at)
  values (target_workspace,target_production,target_reference,stage_status,coalesce(stage_list,'{}'),
    greatest(0,least(100,coalesce(progress_pct,0))),left(coalesce(producer_note,''),600),reference_row.identity_revision,null)
  on conflict (workspace_id,reference_id) do update set
    status=excluded.status,stages=excluded.stages,progress=excluded.progress,
    producer_note=case when excluded.producer_note='' then ra.producer_note else excluded.producer_note end,
    identity_revision=excluded.identity_revision,analyzed_at=null
  returning * into saved;
  update tonde.production_references set state='processing'::tonde.reference_state
    where workspace_id=target_workspace and production_id=target_production and id=target_reference;
  return jsonb_build_object('analysis_id',saved.id,'identity_revision',saved.identity_revision,'status',saved.status,
    'progress',saved.progress,'stages',saved.stages);
end $$;

-- from 202610050017_ai_creation.sql
create or replace function tonde.declare_ai_model(target_workspace uuid, payload jsonb,
  expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.ai_model_profiles; provider text; model_name text; op tonde.ai_operation;
begin
  perform tonde_private.director_guard(target_workspace);
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'A model declaration must be a JSON object' using errcode = '22023';
  end if;
  provider := coalesce(nullif(btrim(payload ->> 'provider_key'), ''), '');
  model_name := coalesce(nullif(btrim(payload ->> 'model_key'), ''), '');
  if not exists (select 1 from tonde.ai_providers p where p.key = provider) then
    raise exception 'That provider is not one TONDE recognises' using errcode = '22023';
  end if;
  if model_name = '' then raise exception 'A model identifier is required' using errcode = '22023'; end if;
  op := coalesce(nullif(payload ->> 'operation', ''), 'video')::tonde.ai_operation;
  insert into tonde.ai_model_profiles(workspace_id, provider_key, model_key, label, operation,
    capability_state, modalities, supports_image_reference, max_reference_images,
    supports_first_frame, supports_last_frame, supports_seed, supports_negative_prompt,
    supports_camera_control, supports_audio, supports_image_edit, supports_lipsync,
    max_duration_ms, aspect_ratios, resolutions, cost_unit, cost_amount, cost_currency, cost_known,
    speed_note, identity_note, product_fidelity_note, availability, safety_note, capability_notes,
    source, declared_by)
  values (target_workspace, provider, model_name,
    left(coalesce(payload ->> 'label', ''), 160), op,
    coalesce(nullif(payload ->> 'capability_state',''), 'UNKNOWN')::tonde.ai_capability_state,
    tonde_private.ai_json_text_array(payload, 'modalities'),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_image_reference', false), false),
    tonde_private.ai_json_int(payload, 'max_reference_images'),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_first_frame', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_last_frame', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_seed', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_negative_prompt', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_camera_control', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_audio', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_image_edit', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_lipsync', false), false),
    case when payload ? 'max_duration_ms' and jsonb_typeof(payload -> 'max_duration_ms') = 'number'
      then (payload ->> 'max_duration_ms')::bigint end,
    tonde_private.ai_json_text_array(payload, 'aspect_ratios'), tonde_private.ai_json_text_array(payload, 'resolutions'),
    left(coalesce(payload ->> 'cost_unit', ''), 80),
    case when payload ? 'cost_amount' and jsonb_typeof(payload -> 'cost_amount') = 'number'
      then (payload ->> 'cost_amount')::numeric(12,4) end,
    left(coalesce(payload ->> 'cost_currency', ''), 8),
    -- Cost is known only when an amount and a currency were actually given.
    (payload ? 'cost_amount' and jsonb_typeof(payload -> 'cost_amount') = 'number'
      and coalesce(payload ->> 'cost_currency','') <> ''),
    left(coalesce(payload ->> 'speed_note', ''), 300), left(coalesce(payload ->> 'identity_note', ''), 300),
    left(coalesce(payload ->> 'product_fidelity_note', ''), 300),
    coalesce(nullif(payload ->> 'availability',''), 'unknown'), left(coalesce(payload ->> 'safety_note', ''), 600),
    coalesce(payload -> 'capability_notes', '{}'::jsonb),
    coalesce(nullif(payload ->> 'source',''), 'declared'), auth.uid())
  on conflict do nothing
  returning * into saved;
  if saved.id is null then
    select * into saved from tonde.ai_model_profiles m
      where m.workspace_id = target_workspace and m.provider_key = provider
        and m.model_key = model_name and m.operation = op;
    if expected_revision is not null and saved.revision <> expected_revision then
      raise exception 'That model declaration changed since you loaded it' using errcode = 'PT409';
    end if;
    update tonde.ai_model_profiles m set
      label = left(coalesce(payload ->> 'label', m.label), 160),
      capability_state = coalesce(nullif(payload ->> 'capability_state','')::tonde.ai_capability_state,
        m.capability_state),
      modalities = case when payload ? 'modalities' then tonde_private.ai_json_text_array(payload,'modalities') else m.modalities end,
      supports_image_reference = coalesce(tonde_private.ai_json_bool(payload,'supports_image_reference', m.supports_image_reference), m.supports_image_reference),
      supports_first_frame = coalesce(tonde_private.ai_json_bool(payload,'supports_first_frame', m.supports_first_frame), m.supports_first_frame),
      supports_last_frame = coalesce(tonde_private.ai_json_bool(payload,'supports_last_frame', m.supports_last_frame), m.supports_last_frame),
      supports_seed = coalesce(tonde_private.ai_json_bool(payload,'supports_seed', m.supports_seed), m.supports_seed),
      supports_negative_prompt = coalesce(tonde_private.ai_json_bool(payload,'supports_negative_prompt', m.supports_negative_prompt), m.supports_negative_prompt),
      supports_camera_control = coalesce(tonde_private.ai_json_bool(payload,'supports_camera_control', m.supports_camera_control), m.supports_camera_control),
      supports_audio = coalesce(tonde_private.ai_json_bool(payload,'supports_audio', m.supports_audio), m.supports_audio),
      -- Every declared capability must be correctable, or a wrong fact could never be fixed.
      supports_image_edit = coalesce(tonde_private.ai_json_bool(payload,'supports_image_edit', m.supports_image_edit), m.supports_image_edit),
      supports_lipsync = coalesce(tonde_private.ai_json_bool(payload,'supports_lipsync', m.supports_lipsync), m.supports_lipsync),
      max_duration_ms = case when payload ? 'max_duration_ms' and jsonb_typeof(payload -> 'max_duration_ms') = 'number'
        then (payload ->> 'max_duration_ms')::bigint else m.max_duration_ms end,
      aspect_ratios = case when payload ? 'aspect_ratios' then tonde_private.ai_json_text_array(payload,'aspect_ratios') else m.aspect_ratios end,
      cost_unit = left(coalesce(payload ->> 'cost_unit', m.cost_unit), 80),
      cost_amount = case when payload ? 'cost_amount' and jsonb_typeof(payload -> 'cost_amount') = 'number'
        then (payload ->> 'cost_amount')::numeric(12,4) else m.cost_amount end,
      cost_currency = left(coalesce(payload ->> 'cost_currency', m.cost_currency), 8),
      availability = coalesce(nullif(payload ->> 'availability',''), m.availability),
      speed_note = left(coalesce(payload ->> 'speed_note', m.speed_note), 300),
      identity_note = left(coalesce(payload ->> 'identity_note', m.identity_note), 300),
      product_fidelity_note = left(coalesce(payload ->> 'product_fidelity_note', m.product_fidelity_note), 300),
      capability_notes = coalesce(payload -> 'capability_notes', m.capability_notes),
      -- Cost is known only when both an amount and a currency are present. Computed in the same
      -- statement as the rest of the declaration, so one edit is exactly one revision.
      cost_known = (case when payload ? 'cost_amount' and jsonb_typeof(payload -> 'cost_amount') = 'number'
          then (payload ->> 'cost_amount')::numeric(12,4) else m.cost_amount end is not null
        and left(coalesce(payload ->> 'cost_currency', m.cost_currency), 8) <> '')
    where m.id = saved.id returning * into saved;
  end if;
  return jsonb_build_object('model_profile_id', saved.id, 'provider_key', saved.provider_key,
    'model_key', saved.model_key, 'operation', saved.operation, 'capability_state', saved.capability_state,
    'cost_known', saved.cost_known, 'cost_amount', saved.cost_amount, 'cost_currency', saved.cost_currency,
    'revision', saved.revision);
end $$;

-- from 202610050018_long_form_series.sql
create or replace function tonde.generate_ahead(target_workspace uuid, target_series uuid, request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare series_row tonde.series; plan jsonb; horizon tonde.generate_horizon; depth tonde.generate_depth;
  holds text[]; topics text[]; slot record; item_id uuid; prod uuid; episode uuid; title_value text;
  topic_value text; made integer := 0; kept integer := 0; held integer := 0;
  broke integer := 0; index_value integer := 0; job uuid; shared_job uuid; tz_value text;
  base date; count_value integer; created_episodes jsonb := '[]'::jsonb; blocked_slots jsonb := '[]'::jsonb;
  state_value tonde.job_state; progress_value integer;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(request) <> 'object' then raise exception 'Invalid Generate Ahead request' using errcode = '22023'; end if;
  if not coalesce((request->>'confirm')::boolean, false) then
    raise exception 'Generate Ahead needs explicit creator confirmation' using errcode = '22023';
  end if;
  series_row := tonde_private.lf_series_for(target_workspace, target_series);
  if series_row.lifecycle <> 'active' then raise exception 'This Series is archived' using errcode = '23514'; end if;
  if series_row.revision <> coalesce((request->>'expected_series_revision')::integer, series_row.revision) then
    raise exception 'The Series changed since you loaded it' using errcode = 'PT409';
  end if;
  plan := tonde_private.lf_generate_plan(target_workspace, series_row, request);
  horizon := (plan->>'horizon')::tonde.generate_horizon;
  depth := (plan->>'depth')::tonde.generate_depth;
  holds := coalesce(array(select jsonb_array_elements_text(coalesce(request->'hold_slots','[]'::jsonb))), '{}'::text[]);
  topics := coalesce(array(select jsonb_array_elements_text(coalesce(request->'topics','[]'::jsonb))), '{}'::text[]);
  tz_value := series_row.timezone;
  base := nullif(request->>'base_date','')::date;
  count_value := coalesce(nullif(request->>'count','')::integer, 0);
  insert into tonde.jobs(workspace_id, job_type, status, progress, input_metadata, requested_by,
    started_at, lease_owner, lease_expires_at)
  values (target_workspace, 'long_form_generation', 'running', 0,
    jsonb_build_object('series_id', target_series, 'horizon', horizon, 'depth', depth), auth.uid(),
    now(), 'tonde:long_form_generation', now() + interval '1 hour')
  returning id into shared_job;
  insert into tonde.generate_ahead_jobs(workspace_id, series_id, job_id, horizon, depth, requested_count,
    base_date, timezone, state, preview)
  values (target_workspace, target_series, shared_job, horizon, depth, count_value, base, tz_value, 'running', plan)
  returning id into job;
  for slot in select * from tonde_private.lf_slots(target_workspace, target_series, horizon, count_value, base)
    order by out_planned_date nulls last, out_episode_number
  loop
    insert into tonde.generate_ahead_items(workspace_id, job_id, slot_key, planned_date, episode_number, state)
    values (target_workspace, job, slot.out_slot_key, slot.out_planned_date, slot.out_episode_number, 'pending')
    returning id into item_id;
    if slot.out_occupancy = 'occupied' then
      update tonde.generate_ahead_items set state = 'preserved', created_episode_id = slot.out_existing_episode_id
        where id = item_id;
      kept := kept + 1;
      continue;
    end if;
    if slot.out_slot_key = any(holds) then
      update tonde.generate_ahead_items set state = 'blocked', error_code = 'held_by_creator',
        error_message = 'This slot is held by the creator.' where id = item_id;
      held := held + 1;
      blocked_slots := blocked_slots || jsonb_build_array(slot.out_slot_key);
      continue;
    end if;
    begin
      index_value := index_value + 1;
      topic_value := case when coalesce(array_length(topics, 1), 0) >= index_value then topics[index_value] else null end;
      title_value := tonde_private.lf_episode_title(series_row, slot.out_planned_date, slot.out_episode_number, topic_value);
      prod := tonde_private.lf_new_shell(target_workspace, series_row, title_value,
        tonde_private.lf_ms(coalesce(series_row.format,'{}'::jsonb), 'runtime_target_ms'));
      insert into tonde.series_episodes(workspace_id, series_id, collection_id, production_id, episode_number,
        planned_date, runtime_target_ms, title, slot_key, requested_depth, brief)
      values (target_workspace, target_series, nullif(coalesce(request->>'collection_id',''),'')::uuid, prod,
        slot.out_episode_number, slot.out_planned_date,
        tonde_private.lf_ms(coalesce(series_row.format,'{}'::jsonb), 'runtime_target_ms'), title_value,
        slot.out_slot_key, depth,
        jsonb_build_object('topic', topic_value, 'note', left(coalesce(request->>'note',''),400),
          'source', 'generate_ahead'))
      returning id into episode;
      update tonde.generate_ahead_items set state = 'created', created_production_id = prod,
        created_episode_id = episode where id = item_id;
      made := made + 1;
      created_episodes := created_episodes || jsonb_build_array(jsonb_build_object('episode_id', episode,
        'episode_number', slot.out_episode_number, 'production_id', prod, 'title', title_value,
        'planned_date', slot.out_planned_date, 'slot_key', slot.out_slot_key, 'topic_source',
        case when topic_value is null then 'title_pattern' else 'creator_topic' end));
    exception when others then
      update tonde.generate_ahead_items set state = 'failed', error_code = left(sqlstate, 40),
        error_message = left(sqlerrm, 400) where id = item_id;
      broke := broke + 1;
    end;
  end loop;
  state_value := (case when broke > 0 or held > 0 then 'retrying' else 'succeeded' end)::tonde.job_state;
  progress_value := least(100, ((made + kept + held + broke) * 100)
    / greatest((plan->'counts'->>'total')::integer, 1));
  update tonde.generate_ahead_jobs set state = state_value, created_count = made,
    preserved_count = kept, blocked_count = held, failed_count = broke,
    note = case when broke > 0 then 'Some slots failed and can be retried without touching created Episodes.'
      when held > 0 then 'Some slots are held by the creator and were skipped.'
      else 'Every open slot was created.' end
    where id = job;
  update tonde.jobs set status = (case when broke > 0 then 'failed' else 'succeeded' end)::tonde.job_state,
    progress = case when broke > 0 then progress_value else 100 end,
    completed_at = now(), lease_owner = null, lease_expires_at = null where id = shared_job;
  return jsonb_build_object('job_id', job, 'shared_job_id', shared_job, 'state', state_value,
    'horizon', horizon, 'depth', depth, 'timezone', tz_value,
    'counts', jsonb_build_object('created', made, 'preserved', kept, 'blocked', held,
      'failed', broke, 'planned', (plan->'counts'->>'total')::integer),
    'created_episodes', created_episodes, 'blocked_slots', blocked_slots,
    'preview', plan,
    'note', 'Existing Episodes and approved work were preserved. Retry only touches blocked or failed slots.');
end $$;

-- from 202610050023_approval_lock_readiness.sql
create or replace function tonde.lock_set(target_workspace uuid, target_production uuid, target_object uuid,
  locked boolean, expected_revision integer default null, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare object_row tonde.objects; current_rev integer; was_locked boolean; new_rev integer; is_locked boolean;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  current_rev := tonde_private.pi_object_revision(target_workspace, target_object);
  if current_rev is null then raise exception 'That object cannot be locked' using errcode = '22023'; end if;
  if expected_revision is not null and current_rev <> expected_revision then
    raise exception 'That object changed since you loaded it' using errcode = 'PT409';
  end if;
  was_locked := coalesce(tonde_private.pi_is_locked(target_workspace, target_object), false);
  if coalesce(locked,false) = was_locked then
    raise exception 'That object is already %', case when was_locked then 'locked' else 'unlocked' end using errcode = '23514';
  end if;
  new_rev := tonde_private.ax_set_lock(target_workspace, target_production, target_object, coalesce(locked,false));
  if new_rev is null then raise exception 'That object is unavailable in this Production' using errcode = 'P0002'; end if;
  is_locked := coalesce(tonde_private.pi_is_locked(target_workspace, target_object), false);
  insert into tonde.access_decisions(workspace_id, production_id, object_id, object_kind, action,
    from_approval, to_approval, from_locked, to_locked, pinned_revision, note, actor_user_id)
  values (target_workspace, target_production, target_object, object_row.kind,
    case when coalesce(locked,false) then 'lock' else 'unlock' end::tonde.access_action,
    tonde_private.ax_approval(target_workspace, target_object)::tonde.approval,
    tonde_private.ax_approval(target_workspace, target_object)::tonde.approval,
    was_locked, is_locked, current_rev, left(coalesce(note_text,''), 800), auth.uid());
  return jsonb_build_object('object_id', target_object, 'object_kind', object_row.kind,
    'label', tonde_private.pi_label(target_workspace, target_object),
    'task', case when coalesce(locked,false) then 'lock' else 'unlock' end,
    'locked', is_locked, 'revision', new_rev, 'was_locked', was_locked,
    'note', left(coalesce(note_text,''), 800), 'actor_user_id', auth.uid(), 'decided_at', now(),
    'meaning', case when is_locked
        then 'This object is protected from incidental change. Approval is unaffected.'
        else 'This object is unlocked. The unlock and its reason are on record.' end);
end $$;

-- from 202610050018_long_form_series.sql
create or replace function tonde.long_form_structure(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level default 'production', target_id uuid default null,
  target_limit integer default 50, target_offset integer default 0, expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer; revision integer; scope_title text;
  breadcrumb jsonb; scope_id uuid; scope jsonb;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  select b.out_limit, b.out_offset into lim, off from tonde_private.lf_bounded(target_limit, target_offset) b;
  select p.revision, p.title into revision, scope_title from tonde.productions p
    where p.workspace_id = target_workspace and p.id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = 'PT409';
  end if;
  if target_level = 'production' then
    scope_id := target_production;
    select jsonb_agg(item order by ord, ord_id), count(*) into items, total from (
      select a.sort_order as ord, a.id as ord_id, jsonb_build_object(
        'id', a.id, 'level', 'act', 'title', a.title, 'display', 'Act ' || ranked.position,
        'display_index', ranked.position, 'order', a.sort_order, 'purpose', a.purpose,
        'narrative_goal', a.narrative_goal, 'planned_duration_ms', a.planned_duration_ms,
        'calculated_duration_ms', tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id),
        'label', tonde_private.lf_label(tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id)),
        'delta_ms', case when a.planned_duration_ms is null then null
          else tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id) - a.planned_duration_ms end,
        'status', tonde_private.lf_status(a.planned_duration_ms, tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id)),
        'depth', tonde_private.lf_depth(target_workspace, target_production, 'act', a.id),
        'approval', a.approval, 'locked', a.locked_at is not null, 'revision', a.revision,
        'summary', tonde_private.lf_summary(target_workspace, target_production, 'act', a.id),
        'documents', tonde_private.lf_documents(target_workspace, target_production, a.id),
        'child_counts', jsonb_build_object(
          'sequences', (select count(*) from tonde.sequences q where q.workspace_id = target_workspace
            and q.production_id = target_production and q.act_id = a.id and q.lifecycle = 'active'),
          'scenes', (select count(*) from tonde.scenes s where s.workspace_id = target_workspace
            and s.production_id = target_production and s.act_id = a.id and s.lifecycle = 'active'))
      ) as item
      from tonde.acts a
      join (select id, row_number() over (order by sort_order, id) as position from tonde.acts
        where workspace_id = target_workspace and production_id = target_production and lifecycle = 'active') ranked
        on ranked.id = a.id
      where a.workspace_id = target_workspace and a.production_id = target_production and a.lifecycle = 'active'
      order by a.sort_order, a.id limit lim offset off) t;
    select count(*) into total from tonde.acts a where a.workspace_id = target_workspace
      and a.production_id = target_production and a.lifecycle = 'active';
    scope := jsonb_build_object('level', 'production', 'id', target_production, 'title', scope_title,
      'display', 'Production', 'orphan_sequences', (select count(*) from tonde.sequences q where q.workspace_id = target_workspace
        and q.production_id = target_production and q.act_id is null and q.lifecycle = 'active'),
      'orphan_scenes', (select count(*) from tonde.scenes s where s.workspace_id = target_workspace
        and s.production_id = target_production and s.sequence_id is null and s.act_id is null and s.lifecycle = 'active'),
      'depth', tonde_private.lf_depth(target_workspace, target_production, 'production', target_production),
      'summary', tonde_private.lf_summary(target_workspace, target_production, 'production', target_production));
    breadcrumb := jsonb_build_array(jsonb_build_object('level','production','id',target_production,'title',scope_title));
  elsif target_level = 'act' then
    scope_id := target_id;
    select a.title into scope_title from tonde.acts a where a.workspace_id = target_workspace
      and a.production_id = target_production and a.id = target_id;
    if not found then raise exception 'Act unavailable' using errcode = 'P0002'; end if;
    select jsonb_agg(item order by ord, ord_id), count(*) into items, total from (
      select part.sort_order as ord, part.id as ord_id, part.item from (
        select q.sort_order, q.id, jsonb_build_object(
          'id', q.id, 'level', 'sequence', 'title', q.title, 'kind', q.kind::text,
          'display', 'Sequence ' || ranked.position, 'display_index', ranked.position, 'order', q.sort_order,
          'purpose', q.purpose, 'planned_duration_ms', q.planned_duration_ms,
          'calculated_duration_ms', tonde_private.lf_scope_duration(target_workspace, target_production, 'sequence', q.id),
          'label', tonde_private.lf_label(tonde_private.lf_scope_duration(target_workspace, target_production, 'sequence', q.id)),
          'delta_ms', case when q.planned_duration_ms is null then null
            else tonde_private.lf_scope_duration(target_workspace, target_production, 'sequence', q.id) - q.planned_duration_ms end,
          'status', tonde_private.lf_status(q.planned_duration_ms, tonde_private.lf_scope_duration(target_workspace, target_production, 'sequence', q.id)),
          'depth', tonde_private.lf_depth(target_workspace, target_production, 'sequence', q.id),
          'approval', q.approval, 'locked', q.locked_at is not null, 'revision', q.revision,
          'summary', tonde_private.lf_summary(target_workspace, target_production, 'sequence', q.id),
          'documents', tonde_private.lf_documents(target_workspace, target_production, q.id),
          'child_counts', jsonb_build_object('scenes', (select count(*) from tonde.scenes s
            where s.workspace_id = target_workspace and s.production_id = target_production
              and s.sequence_id = q.id and s.lifecycle = 'active'))) as item
        from tonde.sequences q
        join (select id, row_number() over (order by sort_order, id) as position from tonde.sequences
          where workspace_id = target_workspace and production_id = target_production and act_id = target_id
            and lifecycle = 'active') ranked on ranked.id = q.id
        where q.workspace_id = target_workspace and q.production_id = target_production and q.act_id = target_id
          and q.lifecycle = 'active'
        union all
        select s.sort_order, s.id, jsonb_build_object(
          'id', s.id, 'level', 'scene', 'title', s.title, 'display', 'Scene ' || ranked.position,
          'display_index', ranked.position, 'order', s.sort_order, 'purpose', s.purpose,
          'planned_duration_ms', s.planned_duration_ms,
          'calculated_duration_ms', tonde_private.lf_scene_duration(target_workspace, target_production, s.id),
          'label', tonde_private.lf_label(tonde_private.lf_scene_duration(target_workspace, target_production, s.id)),
          'delta_ms', case when s.planned_duration_ms is null then null
            else tonde_private.lf_scene_duration(target_workspace, target_production, s.id) - s.planned_duration_ms end,
          'status', tonde_private.lf_status(s.planned_duration_ms, tonde_private.lf_scene_duration(target_workspace, target_production, s.id)),
          'depth', tonde_private.lf_depth(target_workspace, target_production, 'scene', s.id),
          'approval', s.approval, 'locked', s.locked_at is not null, 'revision', s.revision,
          'summary', tonde_private.lf_summary(target_workspace, target_production, 'scene', s.id),
          'documents', tonde_private.lf_documents(target_workspace, target_production, s.id),
          'child_counts', jsonb_build_object('shots', (select count(*) from tonde.shots h
            where h.workspace_id = target_workspace and h.production_id = target_production
              and h.scene_id = s.id and h.lifecycle = 'active'))) as item
        from tonde.scenes s
        join (select id, row_number() over (order by sort_order, id) as position from tonde.scenes
          where workspace_id = target_workspace and production_id = target_production and act_id = target_id
            and sequence_id is null and lifecycle = 'active') ranked on ranked.id = s.id
        where s.workspace_id = target_workspace and s.production_id = target_production and s.act_id = target_id
          and s.sequence_id is null and s.lifecycle = 'active') part
      order by part.sort_order, part.id limit lim offset off) t;
    select (select count(*) from tonde.sequences q where q.workspace_id = target_workspace
        and q.production_id = target_production and q.act_id = target_id and q.lifecycle = 'active')
      + (select count(*) from tonde.scenes s where s.workspace_id = target_workspace
        and s.production_id = target_production and s.act_id = target_id and s.sequence_id is null
        and s.lifecycle = 'active') into total;
    scope := jsonb_build_object('level', 'act', 'id', target_id, 'title', scope_title, 'display', 'Act',
      'depth', tonde_private.lf_depth(target_workspace, target_production, 'act', target_id),
      'summary', tonde_private.lf_summary(target_workspace, target_production, 'act', target_id));
    breadcrumb := jsonb_build_array(
      jsonb_build_object('level','production','id',target_production,'title',
        (select title from tonde.productions where id = target_production)),
      jsonb_build_object('level','act','id',target_id,'title',scope_title));
  elsif target_level = 'sequence' then
    scope_id := target_id;
    select q.title, q.act_id into scope_title, scope_id from tonde.sequences q where q.workspace_id = target_workspace
      and q.production_id = target_production and q.id = target_id;
    if not found then raise exception 'Sequence unavailable' using errcode = 'P0002'; end if;
    select jsonb_agg(item order by ord, ord_id), count(*) into items, total from (
      select s.sort_order as ord, s.id as ord_id, jsonb_build_object(
        'id', s.id, 'level', 'scene', 'title', s.title, 'display', 'Scene ' || ranked.position,
        'display_index', ranked.position, 'order', s.sort_order, 'purpose', s.purpose,
        'planned_duration_ms', s.planned_duration_ms,
        'calculated_duration_ms', tonde_private.lf_scene_duration(target_workspace, target_production, s.id),
        'label', tonde_private.lf_label(tonde_private.lf_scene_duration(target_workspace, target_production, s.id)),
        'delta_ms', case when s.planned_duration_ms is null then null
          else tonde_private.lf_scene_duration(target_workspace, target_production, s.id) - s.planned_duration_ms end,
        'status', tonde_private.lf_status(s.planned_duration_ms, tonde_private.lf_scene_duration(target_workspace, target_production, s.id)),
        'depth', tonde_private.lf_depth(target_workspace, target_production, 'scene', s.id),
        'approval', s.approval, 'locked', s.locked_at is not null, 'revision', s.revision,
        'summary', tonde_private.lf_summary(target_workspace, target_production, 'scene', s.id),
        'documents', tonde_private.lf_documents(target_workspace, target_production, s.id),
        'child_counts', jsonb_build_object('shots', (select count(*) from tonde.shots h
          where h.workspace_id = target_workspace and h.production_id = target_production
            and h.scene_id = s.id and h.lifecycle = 'active'))) as item
      from tonde.scenes s
      join (select id, row_number() over (order by sort_order, id) as position from tonde.scenes
        where workspace_id = target_workspace and production_id = target_production and sequence_id = target_id
          and lifecycle = 'active') ranked on ranked.id = s.id
      where s.workspace_id = target_workspace and s.production_id = target_production and s.sequence_id = target_id
        and s.lifecycle = 'active'
      order by s.sort_order, s.id limit lim offset off) t;
    select count(*) into total from tonde.scenes s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.sequence_id = target_id and s.lifecycle = 'active';
    scope := jsonb_build_object('level', 'sequence', 'id', target_id, 'title', scope_title, 'display', 'Sequence',
      'depth', tonde_private.lf_depth(target_workspace, target_production, 'sequence', target_id),
      'summary', tonde_private.lf_summary(target_workspace, target_production, 'sequence', target_id));
    breadcrumb := jsonb_build_array(
      jsonb_build_object('level','production','id',target_production,'title',
        (select title from tonde.productions where id = target_production)),
      jsonb_build_object('level','act','id',scope_id,'title',(select title from tonde.acts where id = scope_id)),
      jsonb_build_object('level','sequence','id',target_id,'title',scope_title));
  else
    select s.title into scope_title from tonde.scenes s
      where s.workspace_id = target_workspace and s.production_id = target_production and s.id = target_id;
    if not found then raise exception 'Scene unavailable' using errcode = 'P0002'; end if;
    select jsonb_agg(item order by ord, ord_id), count(*) into items, total from (
      select h.sort_order as ord, h.id as ord_id, jsonb_build_object(
        'id', h.id, 'level', 'shot', 'title', h.title, 'display', 'Shot ' || ranked.position,
        'display_index', ranked.position, 'order', h.sort_order, 'purpose', h.purpose,
        'planned_duration_ms', h.planned_duration_ms, 'calculated_duration_ms', coalesce(h.planned_duration_ms,0),
        'label', tonde_private.lf_label(coalesce(h.planned_duration_ms,0)),
        'delta_ms', null, 'status', case when h.planned_duration_ms is null then 'unresolved' else 'fits' end,
        'depth', tonde_private.lf_depth(target_workspace, target_production, 'shot', h.id),
        'execution_method', h.execution_method, 'approval', h.approval, 'locked', h.locked_at is not null,
        'revision', h.revision, 'summary', 'null'::jsonb, 'documents', tonde_private.lf_documents(target_workspace, target_production, h.id),
        'child_counts', jsonb_build_object('takes', (select count(*) from tonde.shot_takes t
          where t.workspace_id = target_workspace and t.shot_id = h.id),
          'attempts', (select count(*) from tonde.ai_generation_attempts at where at.workspace_id = target_workspace
            and at.shot_id = h.id),
          'results', (select count(*) from tonde.results r where r.workspace_id = target_workspace and r.shot_id = h.id))) as item
      from tonde.shots h
      join (select id, row_number() over (order by sort_order, id) as position from tonde.shots
        where workspace_id = target_workspace and production_id = target_production and scene_id = target_id
          and lifecycle = 'active') ranked on ranked.id = h.id
      where h.workspace_id = target_workspace and h.production_id = target_production and h.scene_id = target_id
        and h.lifecycle = 'active'
      order by h.sort_order, h.id limit lim offset off) t;
    select count(*) into total from tonde.shots h where h.workspace_id = target_workspace
      and h.production_id = target_production and h.scene_id = target_id and h.lifecycle = 'active';
    scope := jsonb_build_object('level', 'scene', 'id', target_id, 'title', scope_title, 'display', 'Scene',
      'depth', tonde_private.lf_depth(target_workspace, target_production, 'scene', target_id),
      'summary', tonde_private.lf_summary(target_workspace, target_production, 'scene', target_id),
      'opening_state', (select opening_state from tonde.scenes where id = target_id),
      'ending_state', (select ending_state from tonde.scenes where id = target_id));
    breadcrumb := jsonb_build_array(
      jsonb_build_object('level','production','id',target_production,'title',
        (select title from tonde.productions where id = target_production)),
      jsonb_build_object('level','act','id',(select act_id from tonde.scenes where id = target_id),
        'title',(select a.title from tonde.acts a where a.id = (select act_id from tonde.scenes where id = target_id))),
      jsonb_build_object('level','sequence','id',(select sequence_id from tonde.scenes where id = target_id),
        'title',(select q.title from tonde.sequences q where q.id = (select sequence_id from tonde.scenes where id = target_id))),
      jsonb_build_object('level','scene','id',target_id,'title',scope_title));
  end if;
  return jsonb_build_object('production_id', target_production, 'production_revision', revision,
    'structure_revision', tonde_private.lf_structure_revision(target_workspace, target_production),
    'level', target_level, 'scope', scope, 'breadcrumb', breadcrumb,
    'items', coalesce(items, '[]'::jsonb), 'total', coalesce(total, 0),
    'limit', lim, 'offset', off,
    'truncated', coalesce(total, 0) > off + jsonb_array_length(coalesce(items, '[]'::jsonb)),
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

-- from 202610050018_long_form_series.sql
create or replace function tonde.long_form_timing(target_workspace uuid, target_production uuid, expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare revision integer;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  select p.revision into revision from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = 'PT409';
  end if;
  return tonde_private.lf_production_timing(target_workspace, target_production)
    || jsonb_build_object('production_revision', revision,
      'structure_revision', tonde_private.lf_structure_revision(target_workspace, target_production));
end $$;

-- from 202610050024_results_shot_match.sql
create or replace function tonde.match_correction_apply(target_workspace uuid, target_production uuid, target_correction uuid,
  expected_revision integer default null, propagation text default 'change_only_this', note_text text default '',
  record_candidate boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare correction tonde.match_corrections; applied jsonb; analysis jsonb; propagation_result jsonb;
  target_object tonde.objects; later integer; candidate jsonb; report tonde.shot_match_reports;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if coalesce(propagation,'') not in ('update_all','review_changes','change_only_this') then
    raise exception 'Unsupported propagation mode' using errcode = '22023';
  end if;
  select * into correction from tonde.match_corrections c where c.workspace_id = target_workspace
    and c.production_id = target_production and c.id = target_correction;
  if not found then raise exception 'That correction is unavailable' using errcode = 'P0002'; end if;
  if correction.state <> 'proposed' then raise exception 'That correction was already decided' using errcode = '23514'; end if;
  if expected_revision is not null and correction.source_revision <> expected_revision then
    raise exception 'That correction was proposed against a different revision' using errcode = 'PT409';
  end if;
  target_object := tonde_private.vb_object(target_workspace, target_production, correction.target_object_id);
  -- 93. A locked decision is never changed incidentally: unlock it deliberately first.
  if tonde_private.pi_is_locked(target_workspace, correction.target_object_id) then
    raise exception 'That object is locked. Unlock it deliberately before applying a correction.' using errcode = '23514';
  end if;
  select * into report from tonde.shot_match_reports m where m.workspace_id = target_workspace and m.id = correction.report_id;
  -- 140/141. Reusable memory needs a LATER analysis that confirmed the fix helped. The refusal happens
  -- before anything is applied, so a refused memory request never changes the plan.
  if record_candidate then
    select count(*) into later from tonde.shot_match_reports m where m.workspace_id = target_workspace
      and m.shot_id = correction.shot_id and m.created_at > report.created_at;
    if later = 0 then
      raise exception 'A correction does not become reusable memory until a later Shot Match confirms it helped' using errcode = '23514';
    end if;
  end if;
  applied := tonde_private.vb_patch_apply(target_workspace, target_production, correction.target_object_id,
    correction.patch, correction.source_revision, 'correction');
  -- Propagate the consequence through the Prompt 9A impact engine.
  analysis := tonde.impact_preview(target_workspace, target_production, correction.target_object_id, 2, 200);
  propagation_result := tonde.apply_impact(target_workspace, target_production, (analysis->>'analysis_id')::uuid,
    propagation, '{}'::uuid[], null, 'FIX THIS SHOT correction approved by the creator');
  if target_object.kind = 'execution_plan' then
    update tonde.shot_match_reports m set corrected_plan_id = correction.target_object_id where m.id = report.id;
  end if;
  -- 140/141. The correction becomes reusable memory ONLY through the existing memory policy, and only
  -- because a later analysis confirmed it helped. Nothing is remembered from a single Shot.
  if record_candidate then
    candidate := tonde.memory_candidate_record(target_workspace, target_production, jsonb_build_object(
      'kind', 'technique', 'proposed_source', 'historical_pattern',
      'subject_key', 'Fix for ' || correction.target_label,
      'statement', left('For ' || correction.target_label || ': ' || coalesce(nullif(correction.why,''), correction.root_cause), 600),
      'basis', jsonb_build_array(jsonb_build_object('kind', 'shot_match_correction',
        'correction_id', correction.id, 'report_id', correction.report_id, 'shot_id', correction.shot_id,
        'target_object_id', correction.target_object_id, 'applied_revision', (applied->>'revision')::integer,
        'confirmed_by_later_report', true)),
      'observed_count', 1,
      'source_object_id', correction.target_object_id,
      'source_revision', (applied->>'revision')::integer));
  end if;
  update tonde.match_corrections c set state = 'applied', applied_revision = (applied->>'revision')::integer,
    applied_version_id = tonde_private.vb_latest_version(target_workspace, correction.target_object_id),
    propagation = jsonb_build_array(jsonb_build_object('counts', analysis->'counts',
      'marked', propagation_result->'marked', 'requiring_review', propagation_result->'requiring_review',
      'locked_skipped', propagation_result->'locked_skipped', 'unresolved_count', propagation_result->'unresolved_count')),
    decided_by = auth.uid(), decided_at = now(), note = left(coalesce(note_text,''), 800)
    where c.id = correction.id returning * into correction;
  return jsonb_build_object('correction_id', correction.id, 'report_id', correction.report_id,
    'shot_id', correction.shot_id, 'state', 'applied', 'target_object_id', correction.target_object_id,
    'target_kind', target_object.kind, 'applied_revision', correction.applied_revision,
    'applied_version_id', correction.applied_version_id,
    'changed_fields', applied->'changed_fields', 'propagation', correction.propagation,
    'candidate', case when record_candidate then candidate else null end,
    'note', 'A new revision was created. The previous plan, the Result and every earlier analysis are preserved; approved content is reported for review rather than rewritten silently.');
end $$;

-- from 202610050021_production_memory.sql
create or replace function tonde.memory_candidate_decide(target_workspace uuid, target_production uuid, target_candidate uuid,
  decision text, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare candidate tonde.memory_candidates; created_item tonde.memory_items; saved tonde.memory_candidates;
  current_rev integer; decision_note_value text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if decision not in ('accept','dismiss') then
    raise exception 'Unsupported candidate decision' using errcode = '22023';
  end if;
  select * into candidate from tonde.memory_candidates c
    where c.workspace_id = target_workspace and c.production_id = target_production and c.id = target_candidate;
  if not found then raise exception 'That memory candidate is unavailable' using errcode = 'P0002'; end if;
  if candidate.state <> 'proposed' then
    return jsonb_build_object('candidate_id', candidate.id, 'state', candidate.state, 'memory_item_id', null,
      'note_text', 'This candidate was already decided.');
  end if;
  decision_note_value := tonde_private.ci_text(jsonb_build_object('note', note_text), 'note', 800, false);
  if decision = 'dismiss' then
    update tonde.memory_candidates c set state = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = coalesce(nullif(decision_note_value,''), 'Dismissed by the creator')
      where c.id = candidate.id returning * into saved;
    return jsonb_build_object('candidate_id', saved.id, 'state', saved.state, 'memory_item_id', null,
      'note_text', 'Dismissed. Nothing was remembered and the candidate stays readable as history.');
  end if;
  -- Section 163: accepting pins the revision the candidate was drawn from. A changed source rejects.
  current_rev := tonde_private.pi_object_revision(target_workspace, candidate.source_object_id);
  if current_rev is distinct from candidate.source_revision then
    raise exception 'The evidence this candidate was drawn from changed; record a new candidate from the current revision' using errcode = 'PT409';
  end if;
  insert into tonde.memory_items(workspace_id, production_id, scope, kind, subject_key, statement,
      source, origin, rationale, evidence, source_object_id, source_revision, candidate_id,
      confirmed_by, confirmed_at)
    values (target_workspace, target_production, candidate.scope, candidate.kind, candidate.subject_key,
      candidate.statement, candidate.proposed_source, 'accepted',
      'Accepted from a pattern candidate observed on ' || to_char(candidate.created_at, 'YYYY-MM-DD') || '.',
      candidate.basis, candidate.source_object_id, candidate.source_revision, candidate.id, auth.uid(), now())
    returning * into created_item;
  update tonde.memory_candidates c set state = 'applied', decided_by = auth.uid(), decided_at = now(),
    decision_note = coalesce(nullif(decision_note_value,''), 'Accepted by the creator')
    where c.id = candidate.id returning * into saved;
  return jsonb_build_object('candidate_id', saved.id, 'state', saved.state, 'memory_item_id', created_item.id,
    'authority_rank', tonde_private.mi_rank(created_item.source),
    'note_text', 'Remembered with your authority. It outranks an inference and any unconfirmed pattern, and a later instruction of yours outranks it.');
end $$;

-- from 202610050021_production_memory.sql
create or replace function tonde.memory_candidate_record(target_workspace uuid, target_production uuid, candidate jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  desired_kind tonde.memory_kind; subject_text text; statement_text text; proposed text;
  basis_value jsonb; observed integer; source_ref uuid; source_rev integer; current_rev integer;
  policy jsonb; saved tonde.memory_candidates; existing tonde.memory_candidates; created_item tonde.memory_items;
  auto_origin tonde.memory_origin;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(candidate) <> 'object' then
    raise exception 'A memory candidate must be a JSON object' using errcode = '22023';
  end if;
  if coalesce(nullif(candidate ->> 'kind',''), 'other') not in
      ('preference','decision','pattern','technique','setup_fact','asset_usage','model_outcome','series_rule','correction','other') then
    raise exception 'Unsupported memory kind' using errcode = '22023';
  end if;
  desired_kind := coalesce(nullif(candidate ->> 'kind',''), 'other')::tonde.memory_kind;
  proposed := coalesce(nullif(candidate ->> 'proposed_source',''), 'historical_pattern');
  if proposed not in ('saved_preference','historical_pattern','inference') then
    raise exception 'A candidate may only propose saved preference, historical pattern or inference' using errcode = '22023';
  end if;
  subject_text := tonde_private.ci_text(candidate, 'subject_key', 160, true);
  statement_text := tonde_private.ci_text(candidate, 'statement', 600, true);
  basis_value := coalesce(candidate -> 'basis', '[]'::jsonb);
  if jsonb_typeof(basis_value) <> 'array' or jsonb_array_length(basis_value) = 0 then
    raise exception 'A candidate must cite the evidence it was observed on' using errcode = '23514';
  end if;
  observed := greatest(coalesce((candidate ->> 'observed_count')::integer, 1), 1);
  source_ref := tonde_private.mi_uuid(candidate, 'source_object_id', false);
  if source_ref is null or not exists (select 1 from tonde.objects o
      where o.workspace_id = target_workspace and o.id = source_ref) then
    raise exception 'A candidate must name the object it was observed on' using errcode = '22023';
  end if;
  source_rev := nullif(candidate ->> 'source_revision','')::integer;
  current_rev := tonde_private.pi_object_revision(target_workspace, source_ref);
  if source_rev is null then source_rev := current_rev; end if;
  -- Section 163: a proposal pins the revision it was drawn from.
  if source_rev is null or current_rev is null or source_rev <> current_rev then
    raise exception 'The evidence changed before this candidate was recorded; record it from the current revision' using errcode = 'PT409';
  end if;
  policy := tonde_private.mi_policy(target_workspace, 'production', target_production, null);
  if not (policy ->> 'candidate_capture')::boolean then
    raise exception 'The memory policy for this scope does not allow recording candidates' using errcode = '23514';
  end if;
  auto_origin := case when (policy ->> 'auto_accept_candidates')::boolean then 'inferred'::tonde.memory_origin else null end;
  -- Retrying the same observation must not duplicate it, and a candidate whose evidence has moved on
  -- must not silently block the current revision from being proposed. The old candidate is retired
  -- as superseded - kept as history - and a new one is recorded against the revision that is real now.
  select * into existing from tonde.memory_candidates c
    where c.workspace_id = target_workspace and c.production_id = target_production and c.state = 'proposed'
      and c.subject_key = subject_text and c.kind = desired_kind and c.source_object_id = source_ref;
  if existing.id is not null then
    if existing.source_revision = source_rev then
      return jsonb_build_object('candidate_id', existing.id, 'state', existing.state, 'duplicate', true,
        'observed_count', existing.observed_count, 'policy', policy,
        'note_text', 'This candidate was already recorded from the same evidence. Nothing new was created.');
    end if;
    update tonde.memory_candidates c set state = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = 'Superseded: the object it was observed on moved from revision ' || existing.source_revision
        || ' to revision ' || source_rev || '.'
      where c.id = existing.id;
  end if;
  insert into tonde.memory_candidates(workspace_id, production_id, scope, kind, subject_key, statement,
      proposed_source, basis, observed_count, source_object_id, source_revision)
    values (target_workspace, target_production, 'production', desired_kind, subject_text, statement_text,
      proposed::tonde.memory_source, basis_value, observed, source_ref, source_rev)
    returning * into saved;
  if auto_origin is not null then
    insert into tonde.memory_items(workspace_id, production_id, scope, kind, subject_key, statement,
        source, origin, rationale, evidence, source_object_id, source_revision, candidate_id)
      values (target_workspace, target_production, 'production', desired_kind, subject_text, statement_text,
        proposed::tonde.memory_source, auto_origin,
        'Recorded automatically under the memory policy for this Production scope.',
        basis_value, source_ref, source_rev, saved.id)
      returning * into created_item;
    update tonde.memory_candidates c set state = 'applied', decided_by = auth.uid(), decided_at = now(),
      decision_note = 'Accepted automatically by the memory policy for this Production scope.'
      where c.id = saved.id returning * into saved;
    return jsonb_build_object('candidate_id', saved.id, 'state', saved.state, 'duplicate', false,
      'memory_item_id', created_item.id, 'policy', policy,
      'note_text', 'The memory policy for this scope accepts candidates automatically, so this one is remembered as an inference until you confirm or retire it.');
  end if;
  return jsonb_build_object('candidate_id', saved.id, 'state', saved.state, 'duplicate', false,
    'memory_item_id', null, 'policy', policy,
    'note_text', 'Recorded for review. Nothing becomes memory until you accept it.');
end $$;

-- from 202610050022_versioning_branches.sql
create or replace function tonde.merge_decide(target_workspace uuid, target_production uuid, target_proposal uuid,
  decision text, selected_ids uuid[] default '{}', propagation text default 'change_only_this', note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare proposal tonde.merge_proposals; b tonde.object_branches; change_row tonde.branch_changes; applied_items jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb; result jsonb; analysis jsonb; propagation_result jsonb; impact_summary jsonb := '[]'::jsonb;
  applied_count integer := 0; current_rev integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if decision not in ('merge','reject') then raise exception 'A merge decision is merge or reject' using errcode = '22023'; end if;
  if coalesce(propagation,'') not in ('update_all','review_changes','change_only_this') then
    raise exception 'Unsupported propagation mode' using errcode = '22023';
  end if;
  select * into proposal from tonde.merge_proposals
    where workspace_id = target_workspace and production_id = target_production and id = target_proposal;
  if not found then raise exception 'That merge proposal is unavailable' using errcode = 'P0002'; end if;
  if proposal.state <> 'proposed' then raise exception 'That merge proposal was already decided' using errcode = '23514'; end if;
  if proposal.structure_revision is distinct from tonde_private.vb_structure_revision(target_workspace, target_production) then
    raise exception 'The Production changed since this merge was previewed. Preview the merge again.' using errcode = 'PT409';
  end if;
  select * into b from tonde.object_branches where workspace_id = target_workspace and id = proposal.branch_id;
  if decision = 'reject' then
    update tonde.merge_proposals p set state = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = left(coalesce(note_text,''), 800) where p.id = proposal.id;
    return jsonb_build_object('proposal_id', proposal.id, 'branch_id', b.id, 'state', 'rejected',
      'applied', '[]'::jsonb, 'note', 'The merge was rejected. The mainline and the branch are unchanged.');
  end if;
  for change_row in select * from tonde.branch_changes c
    where c.workspace_id = target_workspace and c.branch_id = b.id and c.state = 'pending'
    order by c.created_at loop
    if coalesce(array_length(selected_ids, 1), 0) > 0 and not (change_row.id = any(selected_ids)) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('change_id', change_row.id,
        'target_object_id', change_row.target_object_id, 'reason', 'not selected'));
      continue;
    end if;
    result := tonde_private.vb_patch_apply(target_workspace, target_production, change_row.target_object_id,
      change_row.patch, change_row.base_revision, 'merge');
    update tonde.branch_changes c set state = 'applied', applied_revision = (result->>'revision')::integer,
      applied_version_id = tonde_private.vb_latest_version(target_workspace, change_row.target_object_id)
      where c.id = change_row.id;
    applied_count := applied_count + 1;
    applied_items := applied_items || jsonb_build_array(jsonb_build_object('change_id', change_row.id,
      'target_object_id', change_row.target_object_id,
      'target_label', tonde_private.pi_label(target_workspace, change_row.target_object_id),
      'revision', (result->>'revision')::integer, 'changed_fields', result->'changed_fields'));
    -- Propagate the consequence through the dependency-aware impact engine.
    analysis := tonde.impact_preview(target_workspace, target_production, change_row.target_object_id, 2, 200);
    propagation_result := tonde.apply_impact(target_workspace, target_production, (analysis->>'analysis_id')::uuid,
      propagation, '{}'::uuid[], null, 'Merged from branch ' || b.name);
    impact_summary := impact_summary || jsonb_build_array(jsonb_build_object(
      'object_id', change_row.target_object_id, 'analysis_id', analysis->>'analysis_id',
      'mode', propagation, 'counts', analysis->'counts', 'marked', propagation_result->'marked',
      'requiring_review', propagation_result->'requiring_review', 'locked_skipped', propagation_result->'locked_skipped',
      'unresolved_count', propagation_result->'unresolved_count'));
  end loop;
  update tonde.merge_proposals p set state = 'merged', decided_by = auth.uid(), decided_at = now(),
    decision_note = left(coalesce(note_text,''), 800), applied = applied_items,
    impact = jsonb_set(p.impact, '{propagation}', to_jsonb(impact_summary), true)
    where p.id = proposal.id;
  update tonde.object_branches br set state = 'merged', merged_at = now(), merged_by = auth.uid(),
    merged_proposal_id = proposal.id where br.id = b.id;
  return jsonb_build_object('proposal_id', proposal.id, 'branch_id', b.id, 'state', 'merged',
    'applied', applied_items, 'applied_count', applied_count, 'skipped', skipped, 'propagation', propagation,
    'impact', impact_summary,
    'note', case when applied_count = 0
        then 'Nothing was merged: no clean change was selected.'
      else 'New mainline revisions were created. Branch history is preserved.' end);
end $$;

-- from 202610050023_approval_lock_readiness.sql
create or replace function tonde.production_readiness(target_workspace uuid, target_production uuid,
  expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current tonde.productions; blockers jsonb := '[]'::jsonb; dims jsonb := '[]'::jsonb;
  blocking_count integer := 0; review_count integer := 0; warning_count integer := 0;
  state_value tonde.readiness_state; dim_state tonde.readiness_state;
  db integer; dr integer; dw integer; present boolean; dim_name text;
  has_story boolean; has_script boolean; has_scenes boolean; has_shots boolean; has_continuity boolean;
  has_resources boolean; has_real boolean; has_ai boolean; has_decisions boolean; has_dependencies boolean;
  has_results boolean; has_delivery boolean; rec record; headline text;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  select * into current from tonde.productions where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and current.revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = 'PT409';
  end if;
  if current.lifecycle <> 'active' then
    return jsonb_build_object('production_id', target_production, 'production_revision', current.revision,
      'title', current.title, 'state', 'unknown', 'dimensions', '[]'::jsonb, 'blockers', '[]'::jsonb,
      'counts', jsonb_build_object('blocking', 0, 'review', 0, 'warning', 0, 'total', 0),
      'headline', 'This Production is archived, so readiness is not evaluated.',
      'notes', jsonb_build_array('Archived Productions are not scored or judged.'),
      'generated_at', now());
  end if;

  has_story := exists (select 1 from tonde.creative_documents d where d.workspace_id = target_workspace
    and d.production_id = target_production and d.document_type in ('story','treatment') and length(btrim(d.content)) > 0);
  has_script := exists (select 1 from tonde.creative_documents d where d.workspace_id = target_workspace
    and d.production_id = target_production and d.document_type = 'script' and length(btrim(d.content)) > 0);
  has_scenes := exists (select 1 from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production and s.lifecycle = 'active');
  has_shots := exists (select 1 from tonde.shots h where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active');
  has_continuity := exists (select 1 from tonde.continuity_findings f where f.workspace_id = target_workspace and f.production_id = target_production);
  has_resources := exists (select 1 from tonde.real_plan_requirements r where r.workspace_id = target_workspace and r.production_id = target_production);
  has_real := exists (select 1 from tonde.execution_plans p where p.workspace_id = target_workspace and p.production_id = target_production and p.execution_method = 'real');
  has_ai := exists (select 1 from tonde.execution_plans p where p.workspace_id = target_workspace and p.production_id = target_production and p.execution_method = 'ai');
  has_decisions := exists (select 1 from tonde.director_decisions d where d.workspace_id = target_workspace and d.production_id = target_production);
  has_dependencies := exists (select 1 from tonde.stale_artifacts a where a.workspace_id = target_workspace and a.production_id = target_production and a.state <> 'current');
  has_results := exists (select 1 from tonde.results r where r.workspace_id = target_workspace and r.production_id = target_production);
  has_delivery := exists (select 1 from tonde.exports e where e.workspace_id = target_workspace and e.production_id = target_production);

  -- Unresolved blocking decisions the Director defaulted on and no creator has answered.
  for rec in select d.id, d.decision_id, d.question from tonde.director_decisions d
    where d.workspace_id = target_workspace and d.production_id = target_production
      and d.priority = 'blocking' and d.decided_by = 'tonde' order by d.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('unresolved_decision','blocking','decisions',
      'An open blocking decision has no creator answer', current.id, current.title, 'production',
      'A blocking intake decision is still on a TONDE default instead of a creator answer.',
      'Answer it, or record the decision, in Director intake.', 'director_decision');
  end loop;

  -- Story and script.
  if not has_story then
    blockers := blockers || tonde_private.rd_blocker('missing_story','review','story',
      'No story or treatment has been written yet', current.id, current.title, 'production',
      'There is no narrative foundation to plan scenes and shots against.',
      'Write a story or treatment, or record why none is needed.', 'creative_document');
  end if;
  if not has_script and has_scenes then
    blockers := blockers || tonde_private.rd_blocker('missing_script','warning','script',
      'No script exists for a production that already has scenes', current.id, current.title, 'production',
      'Dialogue and action cannot be checked against a script.',
      'Write a script, or accept that this production is planned without one.', 'creative_document');
  end if;

  -- Scene plan.
  if not has_scenes then
    blockers := blockers || tonde_private.rd_blocker('no_scenes','blocking','scene_plan',
      'No scenes have been planned', current.id, current.title, 'production',
      'Shots, timing and execution all depend on a scene plan.',
      'Plan the first Scene in Studio.', 'scene');
  end if;
  for rec in select s.id, s.title from tonde.scenes s where s.workspace_id = target_workspace
    and s.production_id = target_production and s.lifecycle = 'active'
    and not exists (select 1 from tonde.shots h where h.workspace_id = s.workspace_id and h.scene_id = s.id and h.lifecycle = 'active')
    order by s.sort_order, s.title limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('scene_without_shots','warning','scene_plan',
      'A Scene has no Shots yet', rec.id, rec.title, 'scene',
      'A Scene with no Shots has no executable coverage.',
      'Add the Shots for this Scene.', 'scene');
  end loop;

  -- Shots.
  for rec in select h.id, h.title from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active'
    and coalesce(h.planned_duration_ms, 0) = 0 order by h.sort_order limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('shot_without_duration','warning','shots',
      'A Shot has no planned duration', rec.id, rec.title, 'shot',
      'The Scene and Production runtime cannot be reconciled without it.',
      'Set the Shot duration.', 'shot');
  end loop;
  for rec in select h.id, h.title from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active'
    and not exists (select 1 from tonde.execution_plans p where p.workspace_id = h.workspace_id and p.shot_id = h.id)
    order by h.sort_order limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('shot_unplanned','warning','shots',
      'A Shot has no execution plan', rec.id, rec.title, 'shot',
      'Without a Real or AI plan there is no way to execute this Shot.',
      'Choose Real or AI for this Shot and plan it.', 'shot');
  end loop;
  -- A Scene participant that names an archived Asset.
  for rec in select distinct h.id, h.title, a.name as asset_name from tonde.scene_participants sp
    join tonde.scenes s on s.workspace_id = sp.workspace_id and s.id = sp.scene_id
    join tonde.shots h on h.workspace_id = sp.workspace_id and h.scene_id = sp.scene_id and h.lifecycle = 'active'
    join tonde.assets a on a.workspace_id = sp.workspace_id and a.id = sp.asset_id
    where sp.workspace_id = target_workspace and sp.production_id = target_production and a.lifecycle <> 'active'
    limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('missing_asset','warning','scene_plan',
      'A Scene participant Asset is archived: ' || rec.asset_name, rec.id, rec.title, 'shot',
      'A Shot in this Scene expects an Asset that is no longer active.',
      'Restore the Asset or remove it from the Scene.', 'asset');
  end loop;

  -- Continuity.
  for rec in select f.id, f.explanation, f.severity from tonde.continuity_findings f
    where f.workspace_id = target_workspace and f.production_id = target_production and f.state = 'open'
      and f.severity = 'critical' order by f.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('continuity_critical','blocking','continuity',
      rec.explanation, rec.id, 'Continuity finding', 'continuity_finding',
      'A critical continuity conflict is unresolved.',
      'Resolve or explicitly accept the continuity finding.', 'continuity_finding');
  end loop;
  for rec in select f.id, f.explanation from tonde.continuity_findings f
    where f.workspace_id = target_workspace and f.production_id = target_production and f.state = 'open'
      and f.severity = 'warning' order by f.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('continuity_warning','review','continuity',
      rec.explanation, rec.id, 'Continuity finding', 'continuity_finding',
      'A continuity warning is unresolved.',
      'Review the finding and decide.', 'continuity_finding');
  end loop;

  -- References and media availability.
  for rec in select r.id, r.source_description, r.state from tonde.production_references r
    where r.workspace_id = target_workspace and r.production_id = target_production
      and r.state in ('inaccessible','failed') order by r.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('reference_unavailable','review','resources',
      'A Production Reference could not be read', rec.id, coalesce(nullif(rec.source_description, ''), 'Reference'),
      'reference', 'A reference that cannot be read cannot inform the production.',
      'Re-import or replace the reference.', 'reference');
  end loop;
  for rec in select r.id, r.source_description from tonde.production_references r
    where r.workspace_id = target_workspace and r.production_id = target_production
      and r.state = 'received' order by r.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('reference_media_unavailable','warning','resources',
      'A Production Reference has no available media yet', rec.id,
      coalesce(nullif(rec.source_description, ''), 'Reference'), 'reference',
      'Media that is not available cannot be analysed here.',
      'Upload the media, or record the reference as description-only.', 'reference');
  end loop;

  -- Resources and Real execution.
  for rec in select r.id, r.label, r.shot_id from tonde.real_plan_requirements r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.status = 'missing'
    order by r.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('missing_resource','blocking','resources',
      'A required resource is missing: ' || rec.label, rec.shot_id,
      tonde_private.pi_label(target_workspace, rec.shot_id), 'shot',
      'A Real Shot cannot be executed without its required resource.',
      'Assign a resource, a substitute, or switch the Shot to AI.', 'real_plan_requirement');
  end loop;
  for rec in select r.id, r.label, r.shot_id from tonde.real_plan_requirements r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.status = 'unverified'
    order by r.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('unverified_resource','review','resources',
      'A required resource is unverified: ' || rec.label, rec.shot_id,
      tonde_private.pi_label(target_workspace, rec.shot_id), 'shot',
      'An unverified resource may or may not be available on the day.',
      'Confirm the resource or its substitute.', 'real_plan_requirement');
  end loop;
  for rec in select h.id, h.title from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active' and h.execution_method = 'real'
    and not exists (select 1 from tonde.execution_plans p where p.workspace_id = h.workspace_id
      and p.shot_id = h.id and p.execution_method = 'real')
    order by h.sort_order limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('real_shot_unplanned','review','real_execution',
      'A Real Shot has no Real plan', rec.id, rec.title, 'shot',
      'The Shot is marked Real but has no plan to shoot it.',
      'Plan the Real execution, or switch the Shot.', 'shot');
  end loop;
  for rec in select p.id, p.shot_id from tonde.execution_plans p where p.workspace_id = target_workspace
    and p.production_id = target_production and p.execution_method = 'real'
    and cardinality(p.safety_flags) > 0 order by p.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('safety_blocked','blocking','real_execution',
      'A Real plan carries an unresolved safety flag', rec.shot_id,
      tonde_private.pi_label(target_workspace, rec.shot_id), 'shot',
      'A safety flag must be resolved before this Shot is executed.',
      'Resolve the safety flag or replace the setup.', 'execution_plan');
  end loop;

  -- AI execution. Provider availability is external and is never guessed here: this reports only
  -- local, real state - an AI plan that is not yet approved.
  select count(*) into dw from tonde.execution_plans p where p.workspace_id = target_workspace
    and p.production_id = target_production and p.execution_method = 'ai'
    and p.approval in ('draft','needs_review');
  if dw > 0 then
    blockers := blockers || tonde_private.rd_blocker('ai_plan_unapproved','warning','ai_execution',
      dw || ' AI plan' || case when dw = 1 then ' is' else 's are' end || ' not approved yet', current.id,
      current.title, 'production', 'AI generation should not start from an unapproved plan.',
      'Approve the AI plan before generating.', 'execution_plan');
  end if;

  -- Approvals. Content that moved after approval needs a fresh review. Nothing is called
  -- "critical" without a real signal.
  for rec in select o.id, o.kind from tonde.objects o where o.workspace_id = target_workspace
    and o.production_id = target_production
    and tonde_private.ax_approval(target_workspace, o.id) = 'changed_after_approval'
    order by o.kind, o.id limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('changed_after_approval','review','approvals',
      'Approved content changed since it was approved', rec.id,
      tonde_private.pi_label(target_workspace, rec.id), rec.kind,
      'An approval describes a specific revision; it does not silently cover newer content.',
      'Review the new revision and approve it, or restore the approved revision.', rec.kind);
  end loop;
  select count(*) into dw from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active' and h.approval <> 'approved'
    and exists (select 1 from tonde.execution_plans p where p.workspace_id = h.workspace_id and p.shot_id = h.id);
  if dw > 0 then
    blockers := blockers || tonde_private.rd_blocker('planned_shots_unapproved','warning','approvals',
      dw || ' planned Shot' || case when dw = 1 then ' is' else 's are' end || ' not approved', current.id,
      current.title, 'production', 'Planned Shots that are not approved are not cleared to execute.',
      'Review and approve the planned Shots.', 'shot');
  end if;

  -- Dependencies: stale artifacts and locked objects that need review.
  for rec in select a.id, a.object_id, a.reason from tonde.stale_artifacts a
    where a.workspace_id = target_workspace and a.production_id = target_production and a.state = 'conflicted'
    order by a.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('stale_conflicted','review','dependencies',
      rec.reason, rec.object_id, tonde_private.pi_label(target_workspace, rec.object_id), 'stale_artifact',
      'Approved content depends on a changed source and needs review.',
      'Review the dependent work against the new source.', 'stale_artifact');
  end loop;
  for rec in select a.id, a.object_id, a.reason from tonde.stale_artifacts a
    where a.workspace_id = target_workspace and a.production_id = target_production and a.state = 'stale'
    order by a.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('stale_artifact','warning','dependencies',
      rec.reason, rec.object_id, tonde_private.pi_label(target_workspace, rec.object_id), 'stale_artifact',
      'Derived work no longer matches the source it came from.',
      'Refresh or re-derive the affected work.', 'stale_artifact');
  end loop;
  for rec in select distinct a.object_id from tonde.stale_artifacts a
    where a.workspace_id = target_workspace and a.production_id = target_production and a.state <> 'current'
      and tonde_private.pi_is_locked(target_workspace, a.object_id)
    limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('locked_needs_review','review','dependencies',
      'A locked object needs review', rec.object_id, tonde_private.pi_label(target_workspace, rec.object_id),
      'locked', 'Locked content was left untouched and needs an explicit unlock before it can change.',
      'Unlock it deliberately, or resolve the review without changing it.', 'locked');
  end loop;

  -- Results, when any exist.
  select count(*) filter (where r.state in ('raw','needs_review')), count(*) filter (where r.state = 'rejected')
    into dr, dw from tonde.results r where r.workspace_id = target_workspace and r.production_id = target_production;
  if dr > 0 then
    blockers := blockers || tonde_private.rd_blocker('result_needs_review','warning','results',
      dr || ' Result' || case when dr = 1 then ' needs' else 's need' end || ' review', current.id,
      current.title, 'production', 'A Result that is still raw or needs review is not final.',
      'Review the Result and accept or reject it.', 'result');
  end if;
  if dw > 0 then
    blockers := blockers || tonde_private.rd_blocker('result_rejected','warning','results',
      dw || ' Result' || case when dw = 1 then ' was' else 's were' end || ' rejected', current.id,
      current.title, 'production', 'A rejected Result means the Shot still needs a usable take.',
      'Re-plan or re-shoot the affected Shot.', 'result');
  end if;
  -- Shot Match pickup: only reported when a completed report actually requires it.
  select count(*) into dr from tonde.shot_match_reports m where m.workspace_id = target_workspace
    and m.production_id = target_production and m.state = 'complete'
    and m.severity in ('warning','critical') and m.approval in ('draft','needs_review');
  if dr > 0 then
    blockers := blockers || tonde_private.rd_blocker('shot_match_pickup','review','results',
      dr || ' completed Shot Match report' || case when dr = 1 then ' needs' else 's need' end || ' a decision',
      current.id, current.title, 'production', 'A shot match finding has not been picked up or dismissed.',
      'Open FIX THIS SHOT and accept or dismiss the recommendation.', 'shot_match_report');
  end if;

  -- Delivery, when any export exists.
  select count(*) into dw from tonde.exports e where e.workspace_id = target_workspace
    and e.production_id = target_production and e.completed_at is null;
  if dw > 0 then
    blockers := blockers || tonde_private.rd_blocker('export_incomplete','warning','delivery',
      dw || ' export' || case when dw = 1 then ' is' else 's are' end || ' not finished', current.id,
      current.title, 'production', 'An unfinished export is not a delivered package.',
      'Finish or re-run the export.', 'export');
  end if;

  -- Aggregate the category. Readiness is the worst category present; it is never a percentage.
  select count(*) filter (where b->>'severity' = 'blocking'), count(*) filter (where b->>'severity' = 'review'),
    count(*) filter (where b->>'severity' = 'warning')
    into blocking_count, review_count, warning_count from jsonb_array_elements(blockers) b;
  state_value := case when blocking_count > 0 then 'blocked'::tonde.readiness_state
    when review_count > 0 then 'needs_review'::tonde.readiness_state
    when warning_count > 0 then 'ready_with_warnings'::tonde.readiness_state
    else 'ready'::tonde.readiness_state end;

  for dim_name in select unnest(array['decisions','story','script','scene_plan','shots','continuity',
      'resources','real_execution','ai_execution','approvals','dependencies','results','delivery']) loop
    select count(*) filter (where b->>'severity' = 'blocking'), count(*) filter (where b->>'severity' = 'review'),
      count(*) filter (where b->>'severity' = 'warning')
      into db, dr, dw from jsonb_array_elements(blockers) b where b->>'dimension' = dim_name;
    present := case dim_name
      when 'decisions' then has_decisions when 'story' then has_story when 'script' then has_script
      when 'scene_plan' then has_scenes when 'shots' then has_shots when 'continuity' then has_continuity
      when 'resources' then has_resources when 'real_execution' then has_real when 'ai_execution' then has_ai
      when 'approvals' then (has_scenes or has_shots) when 'dependencies' then has_dependencies
      when 'results' then has_results when 'delivery' then has_delivery else false end;
    if present or (db + dr + dw) > 0 then
      dim_state := case when db > 0 then 'blocked'::tonde.readiness_state
        when dr > 0 then 'needs_review'::tonde.readiness_state
        when dw > 0 then 'ready_with_warnings'::tonde.readiness_state
        else 'ready'::tonde.readiness_state end;
      dims := dims || jsonb_build_array(jsonb_build_object('dimension', dim_name, 'state', dim_state,
        'present', present, 'counts', jsonb_build_object('blocking', db, 'review', dr, 'warning', dw)));
    end if;
  end loop;

  headline := case state_value
    when 'blocked' then blocking_count || ' blocker' || case when blocking_count = 1 then '' else 's' end
      || ' must be resolved before this Production can move forward.'
    when 'needs_review' then review_count || ' item' || case when review_count = 1 then '' else 's' end
      || ' need review before this Production can move forward.'
    when 'ready_with_warnings' then warning_count || ' warning' || case when warning_count = 1 then '' else 's' end
      || ' to consider. Nothing blocks moving forward.'
    when 'ready' then 'No blockers or warnings were found for this Production.'
    else 'There is not enough planned state to judge readiness yet.' end;

  return jsonb_build_object('production_id', target_production, 'production_revision', current.revision,
    'title', current.title, 'state', state_value, 'dimensions', dims, 'blockers', blockers,
    'counts', jsonb_build_object('blocking', blocking_count, 'review', review_count,
      'warning', warning_count, 'total', blocking_count + review_count + warning_count),
    'headline', headline,
    'notes', jsonb_build_array(
      'Readiness is a category derived from real production state, not a score or a percentage.',
      'AI provider availability is an external dependency and is not guessed here.',
      'Shot Match pickup is only reported when a completed report actually requires a decision.'),
    'generated_at', now());
end $$;

-- from 202610050016_real_production.sql
create or replace function tonde.real_execution_surface(target_workspace uuid, target_production uuid,
  expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current tonde.productions; payload jsonb;
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into current from tonde.productions where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and current.revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = 'PT409';
  end if;
  with live_shot as (
    select h.id as shot_id, h.scene_id, h.title, h.purpose, h.subject, h.framing as shot_framing,
      h.execution_method, h.approval, h.locked_at, h.planned_duration_ms, h.sort_order,
      s.title as scene_title, s.sort_order as scene_order,
      p.id as plan_id, p.revision as plan_revision, p.plan_status, p.readiness_note, p.complexity,
      p.expected_duration_ms, p.camera_resource_id, p.lens_resource_id, p.solo_feasibility,
      p.crew_roles, p.safety_flags, p.movement, p.stabilization, p.lighting_intent,
      p.sound_plan, p.updated_at as plan_updated_at,
      tonde_private.real_readiness_state(target_workspace, target_production, h.id) as readiness,
      cs.status as capture_status, cs.notes as capture_notes, cs.captured_at, cs.revision as capture_revision
    from tonde.shots h
    join tonde.scenes s on s.workspace_id = h.workspace_id and s.id = h.scene_id
    left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
      and p.execution_method = 'real'
    left join tonde.shot_capture_state cs on cs.workspace_id = h.workspace_id and cs.shot_id = h.id
    where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active'
  ), shot_row as (
    select live_shot.*,
      (select tonde_private.real_requirement_rollup(target_workspace, live_shot.plan_id)) as requirements,
      (select count(*) from tonde.shot_takes t where t.workspace_id = target_workspace and t.shot_id = live_shot.shot_id) as take_count,
      (select t.id from tonde.shot_takes t where t.workspace_id = target_workspace
        and t.shot_id = live_shot.shot_id and t.status = 'preferred') as preferred_take_id,
      (select count(*) from tonde.shot_deviations d where d.workspace_id = target_workspace
        and d.shot_id = live_shot.shot_id) as deviation_count
    from live_shot
  ),
  -- Each aggregate lives in its own CTE. Nesting an aggregate inside another
  -- aggregate is not legal at one query level, so the rollups are kept separate.
  scene_notes as (
    select scene_id, string_agg(distinct readiness_note, ' · ') as note
    from shot_row where readiness in ('missing_resource','safety_blocked','needs_decision') and readiness_note <> ''
    group by scene_id
  ), scene_rollup as (
    select scene_id, scene_order, scene_title, count(*) as shots,
      count(*) filter (where readiness in ('ready','ready_with_substitution')) as ready,
      count(*) filter (where readiness in ('needs_decision','missing_resource','safety_blocked','unplanned')) as unresolved,
      count(*) filter (where capture_status = 'captured') as captured,
      count(*) filter (where capture_status = 'pickup_needed') as pickup_needed,
      case when count(*) filter (where complexity = 'complex') > 0 then 'complex'
        when count(*) filter (where complexity = 'moderate') > 0 then 'moderate'
        when count(*) filter (where complexity is not null) > 0 then 'quick' end as complexity
    from shot_row group by scene_id, scene_order, scene_title
  ), scenes_json as (
    select coalesce(jsonb_agg(jsonb_build_object('scene_id', r.scene_id, 'order', r.scene_order,
        'title', r.scene_title, 'shots', r.shots, 'ready', r.ready, 'unresolved', r.unresolved,
        'captured', r.captured, 'pickup_needed', r.pickup_needed, 'complexity', r.complexity,
        'unresolved_note', n.note) order by r.scene_order), '[]'::jsonb) as value
    from scene_rollup r left join scene_notes n on n.scene_id = r.scene_id
  ), shots_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'shot_id', shot_id, 'scene_id', scene_id, 'scene_order', scene_order, 'scene_title', scene_title,
        'order', sort_order, 'title', title, 'purpose', purpose, 'subject', subject, 'framing', shot_framing,
        'execution_method', execution_method, 'approval', approval, 'locked', locked_at is not null,
        'planned_duration_ms', planned_duration_ms, 'expected_duration_ms', expected_duration_ms,
        'plan_id', plan_id, 'plan_revision', plan_revision, 'plan_status', plan_status,
        'readiness', readiness, 'readiness_note', readiness_note, 'complexity', complexity,
        'camera_resource_id', camera_resource_id, 'lens_resource_id', lens_resource_id,
        'movement', movement, 'stabilization', stabilization, 'lighting_intent', lighting_intent,
        'sound_plan', sound_plan, 'solo_feasibility', solo_feasibility, 'crew_roles', to_jsonb(crew_roles),
        'safety_flags', to_jsonb(safety_flags),
        'requirements', requirements,
        'capture', case when capture_status is null then null else jsonb_build_object(
          'status', capture_status, 'notes', capture_notes, 'captured_at', captured_at, 'revision', capture_revision) end,
        'takes', jsonb_build_object('count', take_count, 'preferred_take_id', preferred_take_id),
        'deviations', deviation_count,
        'plan_updated_at', plan_updated_at)
        order by scene_order, sort_order, shot_id), '[]'::jsonb) as value
    from shot_row
  ), crew_json as (
    select coalesce(jsonb_agg(distinct role), '[]'::jsonb) as value from shot_row, unnest(crew_roles) as role
  ), safety_json as (
    select coalesce(jsonb_agg(distinct flag), '[]'::jsonb) as value from shot_row, unnest(safety_flags) as flag
  ), summary_json as (
    select jsonb_build_object(
        'shots', count(*),
        'planned', count(*) filter (where plan_id is not null),
        'unplanned', count(*) filter (where readiness = 'unplanned'),
        'ready', count(*) filter (where readiness = 'ready'),
        'ready_with_substitution', count(*) filter (where readiness = 'ready_with_substitution'),
        'needs_decision', count(*) filter (where readiness = 'needs_decision'),
        'missing_resource', count(*) filter (where readiness = 'missing_resource'),
        'safety_blocked', count(*) filter (where readiness = 'safety_blocked'),
        'captured', count(*) filter (where capture_status = 'captured'),
        'pickup_needed', count(*) filter (where capture_status = 'pickup_needed'),
        'in_progress', count(*) filter (where capture_status in ('setup','shooting')),
        'approved_plans', count(*) filter (where approval = 'approved' and plan_id is not null),
        'changed_after_approval', count(*) filter (where approval = 'changed_after_approval' and plan_id is not null),
        'crew_roles', (select value from crew_json),
        'safety_flags', (select value from safety_json),
        'complexity', case
          when count(*) filter (where complexity = 'complex') > 0 then 'complex'
          when count(*) filter (where complexity = 'moderate') > 0 then 'moderate'
          when count(*) filter (where complexity is not null) > 0 then 'quick' end) as value
    from shot_row
  ), queue_json as (
    select jsonb_build_object(
      'ready_to_shoot', coalesce(jsonb_agg(shot_id order by scene_order, sort_order) filter (where readiness in ('ready','ready_with_substitution')), '[]'::jsonb),
      'needs_decision', coalesce(jsonb_agg(shot_id order by scene_order, sort_order) filter (where readiness in ('needs_decision','unplanned')), '[]'::jsonb),
      'missing_resource', coalesce(jsonb_agg(shot_id order by scene_order, sort_order) filter (where readiness = 'missing_resource'), '[]'::jsonb),
      'pickup_required', coalesce(jsonb_agg(shot_id order by scene_order, sort_order) filter (where capture_status = 'pickup_needed'
        or exists (select 1 from tonde.shot_takes t where t.workspace_id = target_workspace
          and t.shot_id = shot_row.shot_id and t.status = 'pickup_required')), '[]'::jsonb)) as value
    from shot_row
  )
  select jsonb_build_object(
    'production', jsonb_build_object('id', current.id, 'workspace_id', current.workspace_id, 'title', current.title,
      'production_type', current.production_type, 'execution_method', current.execution_method,
      'planned_duration_ms', current.planned_duration_ms, 'approval', current.approval,
      'locked_at', current.locked_at, 'revision', current.revision, 'lifecycle', current.lifecycle,
      'updated_at', current.updated_at),
    'execution_faces', jsonb_build_array('real','ai'),
    'setup', tonde_private.real_setup_inventory(target_workspace),
    'timing', tonde_private.studio_timing(target_workspace, target_production),
    'scenes', (select value from scenes_json),
    'shots', (select value from shots_json),
    'summary', (select value from summary_json),
    'readiness_queue', (select value from queue_json)
  ) into payload;
  return payload;
end $$;

-- from 202610050026_pre_prompt10_product_amendment.sql
create or replace function tonde.reference_identity_save(target_workspace uuid,target_production uuid,target_reference uuid,
  expected_revision integer,values_json jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old_row tonde.production_references; saved tonde.production_references; verified boolean;
begin
  perform tonde_private.studio_guard(target_workspace,target_production,null);
  if jsonb_typeof(values_json) is distinct from 'object' or exists(
    select 1 from jsonb_object_keys(values_json) as keys(key)
    where key not in ('source_identity','source_provider','source_identity_verified','creator_purpose','learning_targets')) then
    raise exception 'Reference identity payload contains unsupported fields' using errcode='22023';
  end if;
  select * into old_row from tonde.production_references
    where workspace_id=target_workspace and production_id=target_production and id=target_reference for update;
  if not found then raise exception 'Reference unavailable in this Production' using errcode='P0002'; end if;
  if expected_revision is null or old_row.revision <> expected_revision then
    raise exception 'Reference changed since it was loaded' using errcode = 'PT409';
  end if;
  if jsonb_typeof(coalesce(values_json->'learning_targets','[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(values_json->'learning_targets','[]'::jsonb)) > 20 then
    raise exception 'Reference learning targets must be an array of at most 20 items' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(values_json->'learning_targets','[]'::jsonb)) = 'array'
    and exists(select 1 from jsonb_array_elements(coalesce(values_json->'learning_targets','[]'::jsonb)) item
      where jsonb_typeof(item) <> 'string' or length(btrim(item#>>'{}')) > 500) then
    raise exception 'Reference learning targets must be strings of at most 500 characters' using errcode='22023';
  end if;
  verified := coalesce((values_json->>'source_identity_verified')::boolean,false)
    and nullif(btrim(coalesce(values_json->>'source_identity',old_row.source_identity)), '') is not null;
  update tonde.production_references set
    source_identity=case when values_json ? 'source_identity' then nullif(btrim(values_json->>'source_identity'),'') else old_row.source_identity end,
    source_provider=case when values_json ? 'source_provider' then nullif(btrim(values_json->>'source_provider'),'') else old_row.source_provider end,
    identity_provenance=case when verified then 'creator_supplied' else 'unknown' end,
    source_identity_verified_at=case when verified then coalesce(old_row.source_identity_verified_at,now()) else null end,
    creator_purpose=case when values_json ? 'creator_purpose' then nullif(btrim(values_json->>'creator_purpose'),'') else old_row.creator_purpose end,
    learning_targets=case when values_json ? 'learning_targets'
      then coalesce(array(select jsonb_array_elements_text(coalesce(values_json->'learning_targets','[]'::jsonb))), '{}')
      else old_row.learning_targets end
    where workspace_id=target_workspace and production_id=target_production and id=target_reference returning * into saved;
  return to_jsonb(saved);
end $$;

-- from 202610050018_long_form_series.sql
create or replace function tonde.reorder_long_form(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, ordered_ids uuid[], expected_production_revision integer,
  parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare live_count integer; provided_count integer; base_order bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_level not in ('act','sequence') then raise exception 'Reorder applies to Acts or Sequences' using errcode = '22023'; end if;
  if expected_production_revision is not null
    and tonde_private.lf_structure_revision(target_workspace, target_production) <> expected_production_revision then
    raise exception 'The structure changed since you loaded it' using errcode = 'PT409';
  end if;
  if ordered_ids is null or array_length(ordered_ids, 1) is null then
    raise exception 'Provide the complete order' using errcode = '22023';
  end if;
  select count(distinct value) into provided_count from unnest(ordered_ids) as value;
  if provided_count <> array_length(ordered_ids, 1) then raise exception 'The order contains duplicates' using errcode = '22023'; end if;
  if target_level = 'act' then
    select count(*) into live_count from tonde.acts a where a.workspace_id = target_workspace
      and a.production_id = target_production and a.lifecycle = 'active';
    if provided_count <> live_count or exists(select 1 from unnest(ordered_ids) as value
      where not exists(select 1 from tonde.acts a where a.workspace_id = target_workspace
        and a.production_id = target_production and a.id = value and a.lifecycle = 'active')) then
      raise exception 'The order must list exactly the live Acts of this Production' using errcode = '22023';
    end if;
    select coalesce(max(a.sort_order), 0) + 1024 into base_order from tonde.acts a
      where a.workspace_id = target_workspace and a.production_id = target_production;
    set constraints all deferred;
    update tonde.acts a set sort_order = base_order + ranked.position * 1024
      from (select value as id, row_number() over () as position from unnest(ordered_ids) as value) ranked
      where a.workspace_id = target_workspace and a.production_id = target_production and a.id = ranked.id;
  else
    select count(*) into live_count from tonde.sequences q where q.workspace_id = target_workspace
      and q.production_id = target_production and q.lifecycle = 'active' and q.act_id is not distinct from parent_id;
    if provided_count <> live_count or exists(select 1 from unnest(ordered_ids) as value
      where not exists(select 1 from tonde.sequences q where q.workspace_id = target_workspace
        and q.production_id = target_production and q.id = value and q.lifecycle = 'active'
        and q.act_id is not distinct from parent_id)) then
      raise exception 'The order must list exactly the live Sequences of this Act' using errcode = '22023';
    end if;
    select coalesce(max(q.sort_order), 0) + 1024 into base_order from tonde.sequences q
      where q.workspace_id = target_workspace and q.production_id = target_production;
    set constraints all deferred;
    update tonde.sequences q set sort_order = base_order + ranked.position * 1024
      from (select value as id, row_number() over () as position from unnest(ordered_ids) as value) ranked
      where q.workspace_id = target_workspace and q.production_id = target_production and q.id = ranked.id;
  end if;
  return jsonb_build_object('level', target_level, 'items', live_count,
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

-- from 202610050024_results_shot_match.sql
create or replace function tonde.result_state_set(target_workspace uuid, target_production uuid, target_result uuid,
  desired_state text, expected_revision integer default null, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result_row tonde.results; current_state text; allowed boolean := false; new_revision integer;
  approval_now text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  result_row := tonde_private.ms_result(target_workspace, target_production, target_result);
  if desired_state not in ('raw','needs_review','approved','rejected','final') then
    raise exception 'Unsupported Result state' using errcode = '22023';
  end if;
  current_state := result_row.state::text;
  if expected_revision is not null and result_row.revision <> expected_revision then
    raise exception 'That Result changed since you loaded it' using errcode = 'PT409';
  end if;
  -- Final is answered first: a creator asking for Final before accepting the Result is told what is
  -- actually missing instead of only that the move is unavailable.
  approval_now := tonde_private.ax_approval(target_workspace, target_result);
  if desired_state = 'final' and approval_now <> 'approved' then
    raise exception 'A Result becomes Final only after a creator approved it' using errcode = '23514';
  end if;
  allowed := case current_state
    when 'raw' then desired_state in ('needs_review','approved','rejected')
    when 'needs_review' then desired_state in ('approved','rejected')
    when 'approved' then desired_state in ('needs_review','final')
    when 'rejected' then desired_state = 'needs_review'
    when 'final' then desired_state = 'needs_review'
    else false end;
  if not allowed then
    raise exception 'A Result cannot move from % to %', current_state, desired_state using errcode = '23514';
  end if;
  update tonde.results set state = desired_state::tonde.result_state
    where workspace_id = target_workspace and id = target_result returning revision into new_revision;
  if new_revision is null then raise exception 'That Result is unavailable' using errcode = 'P0002'; end if;
  -- An explicit creator decision to accept a Result IS the approval. Shot Match itself never approves,
  -- and moving an accepted Result forward must not report it as merely changed after approval: the
  -- approval is written against the exact revision the creator just decided on.
  if desired_state in ('approved', 'final')
    and tonde_private.ax_approval(target_workspace, target_result) is distinct from 'approved' then
    new_revision := tonde_private.ax_set_approval(target_workspace, target_production, target_result, 'approved');
    if desired_state = 'approved' then
      insert into tonde.access_decisions(workspace_id, production_id, object_id, object_kind, action,
        from_approval, to_approval, from_locked, to_locked, pinned_revision, note, actor_user_id)
      values (target_workspace, target_production, target_result, 'result', 'approve',
        coalesce(approval_now, 'draft')::tonde.approval, 'approved',
        coalesce(tonde_private.pi_is_locked(target_workspace, target_result), false),
        coalesce(tonde_private.pi_is_locked(target_workspace, target_result), false), new_revision,
        left(coalesce(note_text,''), 800), auth.uid());
    end if;
  end if;
  return jsonb_build_object('result_id', target_result, 'state', desired_state, 'previous_state', current_state,
    'approval', tonde_private.ax_approval(target_workspace, target_result), 'revision', new_revision,
    'note', left(coalesce(note_text,''), 800),
    'meaning', case when desired_state = 'final'
        then 'Final is explicitly accepted evidence or deliverable state; generation completion never sets it.'
      when desired_state = 'approved' then 'A creator accepted this Result. Shot Match never approves a Result.'
      when desired_state = 'rejected' then 'This Result is rejected. The Shot still needs a usable take.'
      else 'This Result is waiting for a creator review.' end);
end $$;

-- from 202610050017_ai_creation.sql
create or replace function tonde.save_ai_plan(target_workspace uuid, target_production uuid, target_shot uuid,
  expected_shot_revision integer, plan jsonb, references_json jsonb default '[]'::jsonb,
  expected_plan_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous tonde.execution_plans; saved tonde.execution_plans; item jsonb; change_item jsonb;
  lock_row tonde.ai_continuity_locks; shot_row tonde.shots; capability jsonb; next_version integer;
  profile tonde.ai_model_profiles; reference_count integer := 0; duration_ms bigint; aspect text;
  conflict_fields text[] := '{}'; effective_shot_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', expected_shot_revision);
  if plan is null or jsonb_typeof(plan) <> 'object' then
    raise exception 'An AI plan must be a JSON object' using errcode = '22023';
  end if;
  select * into shot_row from tonde.shots
    where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  select * into previous from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if previous.id is not null then
    if previous.locked_at is not null then
      raise exception 'This AI plan is locked. Unlock it before editing.' using errcode = '23514';
    end if;
    if expected_plan_revision is not null and previous.revision <> expected_plan_revision then
      raise exception 'That AI plan changed since you loaded it' using errcode = 'PT409';
    end if;
    if previous.provider_prompt_edited and plan ? 'provider_prompt'
      and coalesce(plan ->> 'accept_provider_prompt', 'false') <> 'true' then
      raise exception 'This provider prompt was edited by hand. Confirm the replacement before TONDE overwrites it.'
        using errcode = '23514';
    end if;
  end if;

  -- Continuity locks: a locked trait is not changed without an explicit proposal.
  if jsonb_typeof(plan -> 'continuity') = 'object' and jsonb_typeof(plan -> 'continuity' -> 'changes') = 'array' then
    for change_item in select jsonb_array_elements(plan -> 'continuity' -> 'changes') loop
      if coalesce(change_item ->> 'scope','') in ('character','world','product','style') then
        select * into lock_row from tonde.ai_continuity_locks l
          where l.workspace_id = target_workspace and l.production_id = target_production
            and l.scope = (change_item ->> 'scope')::tonde.ai_lock_scope and l.locked
            and (change_item ->> 'subject_id' is null or l.subject_id = (change_item ->> 'subject_id')::uuid)
          order by l.priority limit 1;
        if lock_row.id is not null then
          if coalesce(change_item ->> 'field','') = any(lock_row.prohibited_changes)
            or (lock_row.priority = 'MUST PRESERVE'
              and not (coalesce(change_item ->> 'field','') = any(lock_row.allowed_variations))) then
            conflict_fields := conflict_fields || (lock_row.scope::text || ' - ' || coalesce(change_item ->> 'field',''));
          end if;
        end if;
      end if;
    end loop;
  end if;
  if cardinality(conflict_fields) > 0 then
    raise exception 'These changes touch a locked continuity trait: %. Propose the change explicitly or unlock the scope first.',
      array_to_string(conflict_fields, ', ') using errcode = '23514';
  end if;

  -- The selected model must be one this workspace declared. The capability verdict itself
  -- is taken after the plan is stored, so it judges exactly the plan being saved rather
  -- than the one it replaces.
  if plan ? 'model_profile_id' and coalesce(plan ->> 'model_profile_id','') <> '' then
    select * into profile from tonde.ai_model_profiles m
      where m.id = (plan ->> 'model_profile_id')::uuid and m.workspace_id = target_workspace and m.lifecycle = 'active';
    if profile.id is null then
      raise exception 'That model is not declared for this workspace' using errcode = '23514';
    end if;
  end if;

  duration_ms := case when plan ? 'expected_duration_ms' and jsonb_typeof(plan -> 'expected_duration_ms') = 'number'
    then (plan ->> 'expected_duration_ms')::bigint end;
  aspect := left(coalesce(plan ->> 'aspect_ratio', ''), 20);
  -- Duration authority: the Shot carries the timing, exactly as the Real plan does. The
  -- write happens before the plan so the revision the prompt records is the Shot state
  -- the compiled plan actually describes -- otherwise the timing write alone would mark
  -- every compiled prompt stale.
  effective_shot_revision := shot_row.revision;
  if duration_ms is not null and duration_ms is distinct from shot_row.planned_duration_ms then
    update tonde.shots set planned_duration_ms = duration_ms
      where workspace_id = target_workspace and production_id = target_production and id = target_shot;
    select revision into effective_shot_revision from tonde.shots
      where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  end if;
  next_version := coalesce(tonde_private.ai_json_int(plan, 'prompt_version'), coalesce(previous.prompt_version, 0) + 1);
  if next_version < 1 then next_version := coalesce(previous.prompt_version, 0) + 1; end if;

  insert into tonde.execution_plans(workspace_id, production_id, shot_id, execution_method,
    plan_status, readiness_note, generated_by, provider, model, model_version,
    provider_target, model_profile_id, fallback_model_profile_id,
    prompt_version, source_shot_revision, source_versions, canonical_prompt, provider_prompt,
    provider_prompt_edited, provider_prompt_edited_at, routing, first_frame, last_frame, motion, audio,
    continuity, hybrid, negative_constraints, limitations, aspect_ratio, expected_duration_ms,
    cost_state, cost_amount, cost_currency, cost_note,
    shot_size, framing, composition, movement, movement_purpose, lighting_intent, performance,
    product_direction, sound_plan, editorial_intent)
  values (target_workspace, target_production, target_shot, 'ai',
    coalesce(nullif(plan ->> 'plan_status',''), 'draft'), tonde_private.json_text(plan, 'readiness_note', 600),
    coalesce(nullif(plan ->> 'generated_by',''), 'deterministic'),
    nullif(plan ->> 'provider_target',''), nullif(plan ->> 'model_key',''),
    left(coalesce(plan ->> 'model_version',''), 120),
    nullif(plan ->> 'provider_target',''),
    nullif(plan ->> 'model_profile_id','')::uuid, nullif(plan ->> 'fallback_model_profile_id','')::uuid,
    next_version, effective_shot_revision,
    coalesce(plan -> 'source_versions', jsonb_build_object('shot_revision', effective_shot_revision)),
    coalesce(plan -> 'canonical_prompt', '{}'::jsonb), left(coalesce(plan ->> 'provider_prompt',''), 8000),
    coalesce(tonde_private.ai_json_bool(plan, 'provider_prompt_edited', false), false),
    case when coalesce(tonde_private.ai_json_bool(plan, 'provider_prompt_edited', false), false) then now() end,
    coalesce(plan -> 'routing', '{}'::jsonb), coalesce(plan -> 'first_frame','{}'::jsonb),
    coalesce(plan -> 'last_frame','{}'::jsonb), coalesce(plan -> 'motion','{}'::jsonb),
    coalesce(plan -> 'audio','{}'::jsonb), coalesce(plan -> 'continuity','{}'::jsonb),
    coalesce(plan -> 'hybrid','{}'::jsonb), tonde_private.ai_json_text_array(plan, 'negative_constraints'),
    tonde_private.ai_json_text_array(plan, 'limitations'), aspect, duration_ms,
    case when left(coalesce(plan ->> 'cost_currency',''),8) <> '' and plan ? 'cost_amount'
      and jsonb_typeof(plan -> 'cost_amount') = 'number' then 'known' else 'unknown' end,
    case when left(coalesce(plan ->> 'cost_currency',''),8) <> '' and plan ? 'cost_amount'
      and jsonb_typeof(plan -> 'cost_amount') = 'number' then (plan ->> 'cost_amount')::numeric(12,4) end,
    left(coalesce(plan ->> 'cost_currency',''), 8), left(coalesce(plan ->> 'cost_note',''), 400),
    tonde_private.json_text(plan,'shot_size',80), tonde_private.json_text(plan,'framing',300),
    tonde_private.json_text(plan,'composition',400), tonde_private.json_text(plan,'movement',200),
    tonde_private.json_text(plan,'movement_purpose',600), tonde_private.json_text(plan,'lighting_intent',400),
    tonde_private.json_text(plan,'performance',2000), tonde_private.json_text(plan,'product_direction',1200),
    tonde_private.json_text(plan,'sound_plan',2000), tonde_private.json_text(plan,'editorial_intent',300))
  on conflict (shot_id, execution_method) do update set
    plan_status = excluded.plan_status, readiness_note = excluded.readiness_note,
    generated_by = excluded.generated_by, provider = excluded.provider, model = excluded.model,
    model_version = excluded.model_version, provider_target = excluded.provider_target,
    model_profile_id = excluded.model_profile_id, fallback_model_profile_id = excluded.fallback_model_profile_id,
    prompt_version = excluded.prompt_version, source_shot_revision = excluded.source_shot_revision,
    source_versions = excluded.source_versions, canonical_prompt = excluded.canonical_prompt,
    provider_prompt = excluded.provider_prompt, provider_prompt_edited = excluded.provider_prompt_edited,
    provider_prompt_edited_at = coalesce(excluded.provider_prompt_edited_at, tonde.execution_plans.provider_prompt_edited_at),
    routing = excluded.routing, first_frame = excluded.first_frame, last_frame = excluded.last_frame,
    motion = excluded.motion, audio = excluded.audio, continuity = excluded.continuity,
    hybrid = excluded.hybrid, negative_constraints = excluded.negative_constraints,
    limitations = excluded.limitations, aspect_ratio = excluded.aspect_ratio,
    expected_duration_ms = excluded.expected_duration_ms, cost_state = excluded.cost_state,
    cost_amount = excluded.cost_amount, cost_currency = excluded.cost_currency, cost_note = excluded.cost_note,
    shot_size = excluded.shot_size, framing = excluded.framing, composition = excluded.composition,
    movement = excluded.movement, movement_purpose = excluded.movement_purpose,
    lighting_intent = excluded.lighting_intent, performance = excluded.performance,
    product_direction = excluded.product_direction, sound_plan = excluded.sound_plan,
    editorial_intent = excluded.editorial_intent
  returning * into saved;

  -- References are replaced wholesale: the plan's reference set is one decision.
  delete from tonde.ai_shot_references r where r.workspace_id = target_workspace and r.plan_id = saved.id;
  if jsonb_typeof(references_json) = 'array' then
    for item in select jsonb_array_elements(references_json) loop
      insert into tonde.ai_shot_references(workspace_id, production_id, shot_id, plan_id, reference_role,
        priority, asset_id, media_id, origin, source_attempt_id, note, sort_order)
      values (target_workspace, target_production, target_shot, saved.id,
        (item ->> 'role')::tonde.ai_reference_role,
        coalesce(nullif(item ->> 'priority',''), 'SHOULD PRESERVE')::tonde.ai_continuity_priority,
        nullif(item ->> 'asset_id','')::uuid, nullif(item ->> 'media_id','')::uuid,
        coalesce(nullif(item ->> 'origin',''), 'asset'), nullif(item ->> 'source_attempt_id','')::uuid,
        left(coalesce(item ->> 'note',''), 400), coalesce(tonde_private.ai_json_int(item, 'sort_order'), 1024));
      reference_count := reference_count + 1;
    end loop;
  end if;

  -- Capability truth, judged on what was actually stored. A blocking mismatch is refused
  -- and nothing is written; anything else is reported through readiness and limitations.
  if saved.model_profile_id is not null then
    capability := tonde_private.ai_capability_check(target_workspace, saved.model_profile_id, target_production, target_shot);
    if jsonb_array_length(coalesce(capability -> 'blocking', '[]'::jsonb)) > 0 then
      raise exception 'The selected model cannot do this: %',
        array_to_string(array(select jsonb_array_elements_text(capability -> 'blocking')), ' ') using errcode = '23514';
    end if;
  end if;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'prompt_version', saved.prompt_version,
    'source_shot_revision', saved.source_shot_revision, 'references', reference_count,
    'revision', saved.revision, 'approval', saved.approval,
    'readiness', tonde_private.ai_readiness_state(target_workspace, target_production, target_shot),
    'plan', tonde_private.ai_plan_document(target_workspace, target_production, target_shot));
end $$;

-- from 202610050012_director_intelligence.sql
create or replace function tonde.save_director_brief(
  target_workspace uuid, target_production uuid, expected_brief_revision integer, brief_content jsonb,
  source_operation uuid default null, producer_kind text default 'deterministic'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing tonde.director_briefs; saved tonde.director_briefs; production_row tonde.productions;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(brief_content) <> 'object' or pg_column_size(brief_content) > 200000
    or coalesce(length(btrim(brief_content->>'production_goal')), 0) = 0 or length(brief_content->>'production_goal') > 10000 then
    raise exception 'Invalid structured Brief' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(brief_content->'assumptions','[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(brief_content->'open_decisions','[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(brief_content->'conflicts','[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(brief_content->'runtime','{}'::jsonb)) <> 'object' then
    raise exception 'Invalid Brief structure' using errcode = '22023';
  end if;
  if producer_kind not in ('deterministic','model') then
    raise exception 'Unsupported Brief producer' using errcode = '22023';
  end if;
  select * into production_row from tonde.productions where workspace_id = target_workspace and id = target_production for update;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if production_row.locked_at is not null or production_row.approval <> 'draft' then
    raise exception 'This Production is protected; unlock a draft revision before editing the Brief' using errcode = '55000';
  end if;
  select * into existing from tonde.director_briefs where workspace_id = target_workspace and production_id = target_production for update;
  if found then
    if expected_brief_revision is null or existing.revision <> expected_brief_revision then
      raise exception 'The Brief changed; reload before saving' using errcode = 'PT409';
    end if;
    update tonde.director_briefs set brief = brief_content, producer = producer_kind,
      source_operation_id = coalesce(source_operation, source_operation_id)
      where id = existing.id returning * into saved;
  else
    if expected_brief_revision is not null then
      raise exception 'The Brief changed; reload before saving' using errcode = 'PT409';
    end if;
    insert into tonde.director_briefs(workspace_id, production_id, brief, producer, source_operation_id)
      values(target_workspace, target_production, brief_content, producer_kind, source_operation) returning * into saved;
  end if;
  return jsonb_build_object('id', saved.id, 'revision', saved.revision, 'producer', saved.producer);
end;
$$;

-- from 202610050011_director_intake.sql
create or replace function tonde.save_director_intake(
  target_workspace uuid, target_production uuid, expected_intake_revision integer, intake jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_row tonde.director_intakes;
  reference_id_text text;
begin
  if auth.uid() is null or (select auth.role()) <> 'authenticated'
    or not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Authenticated workspace editor required' using errcode = '42501';
  end if;
  if jsonb_typeof(intake) <> 'object' or pg_column_size(intake) > 40000
    or coalesce(length(btrim(intake->>'goal')),0) = 0 or length(intake->>'goal') > 10000
    or intake->>'collaboration_mode' not in ('guide_step_by_step','stop_at_major_decisions','complete_first_draft') then
    raise exception 'Invalid Director intake' using errcode = '22023';
  end if;
  if jsonb_typeof(intake->'constraints') <> 'object' or pg_column_size(intake)>40000
    or jsonb_typeof(intake->'answered_decisions') <> 'object'
    or (intake ? 'selected_reference_ids' and (jsonb_typeof(intake->'selected_reference_ids') <> 'array' or jsonb_array_length(intake->'selected_reference_ids') > 12)) then
    raise exception 'Invalid Director structured intent' using errcode = '22023';
  end if;
  if intake ? 'selected_reference_ids' then
    if jsonb_typeof(intake->'selected_reference_ids') <> 'array' or jsonb_array_length(intake->'selected_reference_ids') > 12 then
      raise exception 'Invalid Director reference selection' using errcode = '22023';
    end if;
    for reference_id_text in select jsonb_array_elements_text(intake->'selected_reference_ids') loop
      if not exists (select 1 from tonde.production_references r where r.workspace_id=target_workspace
        and r.production_id=target_production and r.id=reference_id_text::uuid) then
        raise exception 'Reference is unavailable in this Production' using errcode = '42501';
      end if;
    end loop;
  end if;
  select * into current_row from tonde.director_intakes
    where workspace_id=target_workspace and production_id=target_production for update;
  if found then
    if expected_intake_revision is null or current_row.revision <> expected_intake_revision then
      raise exception 'Director intake changed; reload before saving' using errcode = 'PT409';
    end if;
    if current_row.status='ready_for_studio' then
      raise exception 'A Studio draft already exists; start a reviewed revision instead' using errcode = '55000';
    end if;
    update tonde.director_plan_proposals set state='superseded'
      where workspace_id=target_workspace and intake_id=current_row.id and state='proposed';
    update tonde.director_intakes set intent=intake, plan='{}'::jsonb, status='intake', proposal_operation_id=null,
      collaboration_mode=intake->>'collaboration_mode', updated_at=now()
      where id=current_row.id;
    select * into current_row from tonde.director_intakes where id=current_row.id;
  else
    if expected_intake_revision is not null then
      raise exception 'Director intake changed; reload before saving' using errcode = 'PT409';
    end if;
    insert into tonde.director_intakes(workspace_id,production_id,intent,collaboration_mode)
      values(target_workspace,target_production,intake,intake->>'collaboration_mode') returning * into current_row;
  end if;
  return jsonb_build_object('id',current_row.id,'revision',current_row.revision,'status',current_row.status);
end;
$$;

-- from 202610050011_director_intake.sql
create or replace function tonde.save_director_plan_proposal(
  target_workspace uuid, target_production uuid, expected_production_revision integer,
  expected_intake_revision integer, operation_id uuid, proposal_plan jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare production_row tonde.productions;
  intake_row tonde.director_intakes;
  existing_proposal tonde.director_plan_proposals;
  target_duration bigint;
  scene jsonb;
  scene_total bigint := 0;
  duration bigint;
begin
  if auth.uid() is null or (select auth.role()) <> 'authenticated'
    or not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Authenticated workspace editor required' using errcode = '42501';
  end if;
  select * into existing_proposal from tonde.director_plan_proposals p
    where p.workspace_id=target_workspace and p.operation_id=save_director_plan_proposal.operation_id;
  if found then
    if existing_proposal.production_id <> target_production or existing_proposal.plan <> proposal_plan then
      raise exception 'An idempotency key cannot be reused for different plan content' using errcode = '23505';
    end if;
    return jsonb_build_object('intake_id',existing_proposal.intake_id,'status',
      case when existing_proposal.state='applied' then 'ready_for_studio' else 'draft_ready' end,
      'revision', (select revision from tonde.director_intakes where id=existing_proposal.intake_id),
      'idempotent',true);
  end if;
  select * into production_row from tonde.productions where workspace_id=target_workspace and id=target_production for update;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if production_row.revision <> expected_production_revision or production_row.approval <> 'draft' or production_row.locked_at is not null then
    raise exception 'Production changed or is protected; reload before planning' using errcode = 'PT409';
  end if;
  select * into intake_row from tonde.director_intakes where workspace_id=target_workspace and production_id=target_production for update;
  if not found or intake_row.revision <> expected_intake_revision or intake_row.status='ready_for_studio' then
    raise exception 'Director intake changed; reload before planning' using errcode = 'PT409';
  end if;
  select * into existing_proposal from tonde.director_plan_proposals p
    where p.workspace_id=target_workspace and p.production_id=target_production and p.state='proposed' for update;
  if found then raise exception 'A plan proposal is already pending; retry its operation or create a revised brief' using errcode = '55000'; end if;
  if jsonb_typeof(proposal_plan) <> 'object' or pg_column_size(proposal_plan)>100000
    or coalesce(length(btrim(proposal_plan->>'title')),0)=0 or length(proposal_plan->>'title')>160
    or coalesce(length(btrim(proposal_plan->>'creative_objective')),0)=0
    or jsonb_typeof(proposal_plan->'scenes') <> 'array' or jsonb_array_length(proposal_plan->'scenes')>40 then
    raise exception 'Invalid Director production plan' using errcode = '22023';
  end if;
  if not exists(select 1 from unnest(enum_range(null::tonde.production_type)) as v(value) where v::text=proposal_plan->>'production_type')
    or not exists(select 1 from unnest(enum_range(null::tonde.execution_method)) as v(value) where v::text=proposal_plan->>'execution_method') then
    raise exception 'Unsupported Production classification or execution method' using errcode = '22023';
  end if;
  if proposal_plan->>'planned_duration_ms' is not null then
    if proposal_plan->>'planned_duration_ms' !~ '^[0-9]{1,16}$' then raise exception 'Runtime must use integer milliseconds' using errcode = '22023'; end if;
    target_duration := (proposal_plan->>'planned_duration_ms')::bigint;    if target_duration > 9007199254740991 or jsonb_array_length(proposal_plan->'scenes')=0 then raise exception 'Invalid timed plan' using errcode = '22023'; end if;
  end if;
  for scene in select value from jsonb_array_elements(proposal_plan->'scenes') loop
    if jsonb_typeof(scene)<>'object' or coalesce(length(btrim(scene->>'title')),0)=0 or length(scene->>'title')>160 then
      raise exception 'Invalid planned Scene' using errcode = '22023';
    end if;
    if target_duration is not null then
      if scene->>'duration_ms' is null or scene->>'duration_ms' !~ '^[0-9]{1,16}$' then raise exception 'Timed Scene required' using errcode = '22023'; end if;
      duration := (scene->>'duration_ms')::bigint;
      if duration>9007199254740991 then raise exception 'Scene duration exceeds safe integer range' using errcode = '22023'; end if;
      if scene_total > 9007199254740991 - duration then raise exception 'Scene duration sum exceeds safe integer range' using errcode = '22003'; end if;
      scene_total := scene_total+duration;
    end if;
  end loop;
  if target_duration is not null and scene_total<>target_duration then raise exception 'Scene durations must equal the Production target exactly' using errcode = '23514'; end if;
  if scene_total > 9007199254740991 then raise exception 'Scene duration sum exceeds safe integer range' using errcode = '22003'; end if;
  if target_duration is null and exists(select 1 from jsonb_array_elements(proposal_plan->'scenes') s where s->>'duration_ms' is not null) then
    raise exception 'Scene durations require a Production target runtime' using errcode = '22023';
  end if;
  update tonde.director_plan_proposals p set state='superseded'
    where p.workspace_id=target_workspace and p.production_id=target_production and p.state='proposed';
  insert into tonde.director_plan_proposals(workspace_id,production_id,intake_id,operation_id,
    source_production_revision,source_intake_revision,plan)
    values(target_workspace,target_production,intake_row.id,save_director_plan_proposal.operation_id,
      expected_production_revision,expected_intake_revision,proposal_plan);
  update tonde.director_intakes set plan=proposal_plan,status='draft_ready',
    proposal_operation_id=save_director_plan_proposal.operation_id,updated_at=now()
    where id=intake_row.id;
  select * into intake_row from tonde.director_intakes where id=intake_row.id;
  return jsonb_build_object('intake_id',intake_row.id,'revision',intake_row.revision,'status',intake_row.status,'idempotent',false);
end;
$$;

-- from 202610050028_reference_completion_pin.sql
create or replace function tonde.save_reference_analysis(
  target_workspace uuid, target_production uuid, target_reference uuid, analysis jsonb,
  findings jsonb, techniques jsonb, source_operation uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare reference_row tonde.production_references;
  saved tonde.reference_analyses;
  item jsonb;
  linked_technique_id uuid;
  technique_count integer := 0;
  finding_count integer := 0;
  desired_capability text := coalesce(analysis->>'capability', 'metadata_only');
  desired_status text := coalesce(analysis->>'status', 'not_started');
  desired_progress integer;
  reference_state text;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(analysis) <> 'object' or jsonb_typeof(findings) <> 'array' or jsonb_typeof(techniques) <> 'array'
    or jsonb_array_length(findings) > 80 or jsonb_array_length(techniques) > 40 then
    raise exception 'Invalid reference analysis payload' using errcode = '22023';
  end if;
  if desired_capability not in ('full_media_available','partial_media_available','metadata_only','text_only','unavailable')
    or desired_status not in ('not_started','queued','preprocessing','analyzing','synthesizing','complete','partial','failed') then
    raise exception 'Unsupported reference capability or analysis state' using errcode = '22023';
  end if;
  select * into reference_row from tonde.production_references
    where workspace_id = target_workspace and production_id = target_production and id = target_reference for update;
  if not found then raise exception 'Reference unavailable in this Production' using errcode = 'P0002'; end if;
  if nullif(analysis->>'identity_revision','')::integer is distinct from reference_row.identity_revision
    or not exists(select 1 from tonde.reference_analyses a where a.workspace_id=target_workspace
      and a.reference_id=target_reference and a.identity_revision=reference_row.identity_revision) then
    raise exception 'Reference identity revision changed before analysis completion; analyze the current revision' using errcode = 'PT409';
  end if;
  desired_progress := greatest(0, least(100, coalesce((analysis->>'progress')::integer, case when desired_status = 'complete' then 100 else 0 end)));
  -- An observed finding must cite evidence, exactly as the domain model requires.
  for item in select value from jsonb_array_elements(findings) loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'statement')), 0) = 0 or length(item->>'statement') > 1200
      or coalesce(item->>'epistemic','') not in ('observed','estimated','recommended','unknown')
      or coalesce(item->>'confidence','') not in ('high','medium','low')
      or jsonb_typeof(coalesce(item->'evidence','[]'::jsonb)) <> 'array' then
      raise exception 'Invalid reference finding' using errcode = '22023';
    end if;
    if item->>'epistemic' = 'observed' and jsonb_array_length(coalesce(item->'evidence','[]'::jsonb)) = 0
      and item->>'category' <> 'story' then
      raise exception 'An observed finding must cite evidence' using errcode = '23514';
    end if;
  end loop;
  insert into tonde.reference_analyses as ra (workspace_id, production_id, reference_id, role, capability, status, stages,
    progress, summary, capabilities, style, causal, adaptation_notes, limitations, media_metadata, producer, model_profile,
    producer_note, source_operation_id, analyzed_at)
  values (target_workspace, target_production, target_reference,
    coalesce(analysis->>'role','style'), desired_capability, desired_status,
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(analysis->'stages','[]'::jsonb)) as value), '{}'),
    desired_progress, left(coalesce(analysis->>'summary',''),1600),
    coalesce(analysis->'capabilities','{}'::jsonb), coalesce(analysis->'style','{}'::jsonb),
    coalesce(analysis->'causal','[]'::jsonb), coalesce(analysis->'adaptation_notes','[]'::jsonb),
    coalesce(analysis->'limitations','[]'::jsonb), coalesce(analysis->'media_metadata','{}'::jsonb),
    coalesce(analysis->>'producer','deterministic'), coalesce(analysis->>'model_profile','default'),
    left(coalesce(analysis->>'producer_note',''),600), source_operation,
    case when desired_status in ('complete','partial','failed') then now() else null end)
  on conflict (workspace_id, reference_id) do update set
    role = excluded.role, capability = excluded.capability, status = excluded.status, stages = excluded.stages,
    progress = excluded.progress, summary = excluded.summary, capabilities = excluded.capabilities, style = excluded.style,
    causal = excluded.causal, adaptation_notes = excluded.adaptation_notes, limitations = excluded.limitations,
    media_metadata = excluded.media_metadata, producer = excluded.producer, model_profile = excluded.model_profile,
    producer_note = excluded.producer_note, source_operation_id = coalesce(excluded.source_operation_id, ra.source_operation_id),
    analyzed_at = coalesce(excluded.analyzed_at, ra.analyzed_at)
  returning * into saved;
  delete from tonde.reference_findings where workspace_id = target_workspace and analysis_id = saved.id;
  for item in select value from jsonb_array_elements(findings) loop
    finding_count := finding_count + 1;
    insert into tonde.reference_findings(workspace_id, production_id, analysis_id, finding_id, category, statement,
      epistemic, confidence, evidence, technique_id, limitations, sort_order)
    values (target_workspace, target_production, saved.id, left(item->>'finding_id',120),
      coalesce(item->>'category','story'), left(item->>'statement',1200), item->>'epistemic', item->>'confidence',
      coalesce(item->'evidence','[]'::jsonb), nullif(left(coalesce(item->>'technique_id',''),120),''),
      coalesce(item->'limitations','[]'::jsonb), finding_count * 1024);
  end loop;
  delete from tonde.reference_technique_links where workspace_id = target_workspace and analysis_id = saved.id;
  for item in select value from jsonb_array_elements(techniques) loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'canonical_id')),0) < 3
      or coalesce(length(btrim(item->>'name')),0) = 0 or coalesce(length(btrim(item->>'description')),0) = 0
      or coalesce(length(btrim(item->>'purpose')),0) = 0 or coalesce(length(btrim(item->>'effect')),0) = 0
      or coalesce(item->>'category','') not in ('camera','composition','lighting','blocking','performance','product','edit','transition','sound','color','story','typography') then
      raise exception 'Invalid technique payload' using errcode = '22023';
    end if;
    insert into tonde.creative_techniques as ct (workspace_id, canonical_id, name, category, description, purpose, effect,
      conditions, practical_concept, ai_concept, limitations, importance, confidence, technique_source, created_by)
    values (target_workspace, left(item->>'canonical_id',120), left(item->>'name',160), item->>'category',
      left(item->>'description',1200), left(item->>'purpose',600), left(item->>'effect',600),
      coalesce(item->'conditions','[]'::jsonb), left(coalesce(item->>'practical_concept',''),900),
      left(coalesce(item->>'ai_concept',''),900), coalesce(item->'limitations','[]'::jsonb),
      coalesce(item->>'importance','supporting'), coalesce(item->>'confidence','medium'),
      coalesce(item->>'technique_source','reference'), auth.uid())
    on conflict (workspace_id, canonical_id) do update set
      name = excluded.name, category = excluded.category, description = excluded.description, purpose = excluded.purpose,
      effect = excluded.effect, conditions = excluded.conditions, practical_concept = excluded.practical_concept,
      ai_concept = excluded.ai_concept, limitations = excluded.limitations, importance = excluded.importance,
      confidence = excluded.confidence
    returning id into linked_technique_id;
    technique_count := technique_count + 1;
    insert into tonde.reference_technique_links(workspace_id, production_id, analysis_id, technique_id, reference_id, importance, evidence)
      values (target_workspace, target_production, saved.id, linked_technique_id, target_reference,
        coalesce(item->>'importance','supporting'), coalesce(item->'evidence','[]'::jsonb))
      on conflict (analysis_id, technique_id) do update set importance = excluded.importance, evidence = excluded.evidence;
  end loop;
  reference_state := case desired_status
    when 'complete' then 'analyzed'
    when 'partial' then 'partially_analyzed'
    when 'failed' then 'failed'
    when 'unavailable' then 'inaccessible'
    else 'processing' end;
  if desired_status = 'complete' and desired_capability <> 'full_media_available' then
    reference_state := 'partially_analyzed';
  end if;
  update tonde.production_references set state = reference_state::tonde.reference_state where id = target_reference and workspace_id = target_workspace;
  return jsonb_build_object('analysis_id', saved.id, 'revision', saved.revision, 'status', saved.status,
    'capability', saved.capability, 'findings', finding_count, 'techniques', technique_count, 'reference_state', reference_state);
end;
$$;

-- from 202610050016_real_production.sql
create or replace function tonde.save_shot_take(target_workspace uuid, target_production uuid, target_shot uuid,
  take jsonb, expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.shot_takes; target_plan uuid; take_id uuid; wanted_number integer; current_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', null);
  if take is null or jsonb_typeof(take) <> 'object' then
    raise exception 'A Take must be a JSON object' using errcode = '22023';
  end if;
  wanted_number := (take->>'take_number')::integer;
  if wanted_number is null or wanted_number < 1 or wanted_number > 999 then
    raise exception 'A Take needs a number between 1 and 999' using errcode = '22023';
  end if;
  if coalesce(take->>'status','recorded') not in ('recorded','review','good','preferred','unusable','pickup_required') then
    raise exception 'Unsupported Take status' using errcode = '22023';
  end if;
  if length(coalesce(take->>'notes','')) > 1200 then raise exception 'Take note is too long' using errcode = '22001'; end if;
  select id into target_plan from tonde.execution_plans where workspace_id = target_workspace
    and production_id = target_production and shot_id = target_shot and execution_method = 'real';
  take_id := nullif(take->>'id','')::uuid;
  if take_id is not null then
    select revision into current_revision from tonde.shot_takes
      where workspace_id = target_workspace and id = take_id and shot_id = target_shot;
    if not found then raise exception 'That Take is unavailable' using errcode = 'P0002'; end if;
    if expected_revision is not null and current_revision <> expected_revision then
      raise exception 'That Take changed since you loaded it' using errcode = 'PT409';
    end if;
  end if;
  -- Clear the previous preferred Take first so the exclusive index is never violated.
  if coalesce(take->>'status','recorded') = 'preferred' then
    update tonde.shot_takes set status = 'good'
      where workspace_id = target_workspace and shot_id = target_shot and status = 'preferred'
        and (take_id is null or id <> take_id);
  end if;
  insert into tonde.shot_takes(workspace_id, production_id, shot_id, plan_id, take_number, status, notes, media_id, recorded_at)
  values (target_workspace, target_production, target_shot, target_plan, wanted_number,
    coalesce(take->>'status','recorded')::tonde.take_status, coalesce(take->>'notes',''),
    nullif(take->>'media_id','')::uuid, coalesce((take->>'recorded_at')::timestamptz, now()))
  on conflict (workspace_id, shot_id, take_number) do update set
    status = excluded.status, notes = excluded.notes, media_id = excluded.media_id,
    plan_id = coalesce(excluded.plan_id, tonde.shot_takes.plan_id)
  returning * into saved;
  return jsonb_build_object('take_id', saved.id, 'shot_id', target_shot, 'take_number', saved.take_number,
    'status', saved.status, 'preferred', saved.status = 'preferred', 'revision', saved.revision,
    'capture', (select jsonb_build_object('status', c.status, 'revision', c.revision)
      from tonde.shot_capture_state c where c.workspace_id = target_workspace and c.shot_id = target_shot));
end $$;

-- from 202610050026_pre_prompt10_product_amendment.sql
create or replace function tonde.scene_audio_direction_save(target_workspace uuid,target_production uuid,target_scene uuid,
  expected_revision integer,values_json jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old_row tonde.scene_audio_directions; incoming tonde.scene_audio_directions; saved tonde.scene_audio_directions;
begin
  perform tonde_private.studio_guard(target_workspace,target_production,null);
  if not exists(select 1 from tonde.production_audio_plans p join tonde.productions production
    on production.workspace_id=p.workspace_id and production.id=p.production_id
    where p.workspace_id=target_workspace and p.production_id=target_production
      and tonde_private.audio_applies(production.production_type,production.planned_duration_ms)) then
    raise exception 'This Production does not currently require an Audio Plan' using errcode='23514';
  end if;
  if tonde_private.pi_is_locked(target_workspace,target_production) then raise exception 'Unlock the Production before editing Scene audio direction' using errcode='23514'; end if;
  if jsonb_typeof(values_json) is distinct from 'object' then raise exception 'Scene audio direction must be an object' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(values_json) as keys(key) where key not in (
    'music_use','music_direction','cue_start_ms','cue_end_ms','cue_duration_ms','music_purpose','rhythmic_quality',
    'instrumentation','dynamics','diegetic','dialogue_relationship','action_relationship','motif_relationship',
    'master_song_reference_id','sound_use','sound_direction','sound_events','recording_needs',
    'microphone_considerations','voice_treatment','continuity_considerations')) then
    raise exception 'Scene audio direction contains unsupported fields' using errcode='22023';
  end if;
  if not exists(select 1 from tonde.scenes s where s.workspace_id=target_workspace and s.production_id=target_production and s.id=target_scene) then
    raise exception 'Scene is unavailable in this Production' using errcode='P0002'; end if;
  select * into old_row from tonde.scene_audio_directions where workspace_id=target_workspace and production_id=target_production and scene_id=target_scene for update;
  if found then
    if expected_revision is null or old_row.revision <> expected_revision then raise exception 'Scene audio direction changed since it was loaded' using errcode = 'PT409'; end if;
    if tonde_private.pi_is_locked(target_workspace,old_row.id) then raise exception 'Unlock the Scene audio direction before editing' using errcode='23514'; end if;
  elsif expected_revision is not null then raise exception 'Scene audio direction no longer exists' using errcode = 'PT409'; end if;
  incoming := jsonb_populate_record(old_row,values_json);
  if incoming.master_song_reference_id is not null then
    if not exists(select 1 from tonde.production_audio_plans p where p.workspace_id=target_workspace and p.production_id=target_production and p.master_song_reference_id=incoming.master_song_reference_id) then
      raise exception 'Scene music must use the master song Reference declared by the Production Audio Plan' using errcode='23514';
    end if;
  end if;
  if old_row.id is null then
    insert into tonde.scene_audio_directions(workspace_id,production_id,scene_id,music_use,music_direction,cue_start_ms,cue_end_ms,cue_duration_ms,
      music_purpose,rhythmic_quality,instrumentation,dynamics,diegetic,dialogue_relationship,action_relationship,motif_relationship,
      master_song_reference_id,sound_use,sound_direction,sound_events,recording_needs,microphone_considerations,voice_treatment,continuity_considerations,created_by)
    values(target_workspace,target_production,target_scene,coalesce(incoming.music_use,'undecided'),coalesce(incoming.music_direction,''),incoming.cue_start_ms,
      incoming.cue_end_ms,incoming.cue_duration_ms,coalesce(incoming.music_purpose,''),coalesce(incoming.rhythmic_quality,''),coalesce(incoming.instrumentation,''),
      coalesce(incoming.dynamics,''),incoming.diegetic,coalesce(incoming.dialogue_relationship,''),coalesce(incoming.action_relationship,''),coalesce(incoming.motif_relationship,''),
      incoming.master_song_reference_id,coalesce(incoming.sound_use,'undecided'),coalesce(incoming.sound_direction,''),coalesce(incoming.sound_events,'{}'),
      coalesce(incoming.recording_needs,''),coalesce(incoming.microphone_considerations,''),coalesce(incoming.voice_treatment,''),coalesce(incoming.continuity_considerations,''),auth.uid())
      returning * into saved;
  else
    update tonde.scene_audio_directions set music_use=coalesce(incoming.music_use,'undecided'),music_direction=coalesce(incoming.music_direction,''),
      cue_start_ms=incoming.cue_start_ms,cue_end_ms=incoming.cue_end_ms,cue_duration_ms=incoming.cue_duration_ms,music_purpose=coalesce(incoming.music_purpose,''),
      rhythmic_quality=coalesce(incoming.rhythmic_quality,''),instrumentation=coalesce(incoming.instrumentation,''),dynamics=coalesce(incoming.dynamics,''),diegetic=incoming.diegetic,
      dialogue_relationship=coalesce(incoming.dialogue_relationship,''),action_relationship=coalesce(incoming.action_relationship,''),motif_relationship=coalesce(incoming.motif_relationship,''),
      master_song_reference_id=incoming.master_song_reference_id,sound_use=coalesce(incoming.sound_use,'undecided'),sound_direction=coalesce(incoming.sound_direction,''),
      sound_events=coalesce(incoming.sound_events,'{}'),recording_needs=coalesce(incoming.recording_needs,''),microphone_considerations=coalesce(incoming.microphone_considerations,''),
      voice_treatment=coalesce(incoming.voice_treatment,''),continuity_considerations=coalesce(incoming.continuity_considerations,'')
      where workspace_id=target_workspace and production_id=target_production and scene_id=target_scene returning * into saved;
  end if;
  return to_jsonb(saved);
end $$;

-- from 202610050017_ai_creation.sql
create or replace function tonde.set_ai_connection(target_workspace uuid, target_provider text,
  target_state text, credential_reference text default '', note text default '', expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.ai_provider_connections;
begin
  perform tonde_private.director_guard(target_workspace);
  if not exists (select 1 from tonde.ai_providers p where p.key = target_provider) then
    raise exception 'That provider is not one TONDE recognises' using errcode = '22023';
  end if;
  if target_state not in ('not_connected','connected','unavailable') then
    raise exception 'That connection state is not valid' using errcode = '22023';
  end if;
  if length(coalesce(credential_reference, '')) > 0 and credential_reference ~* '(sk-|secret|password|bearer )' then
    raise exception 'Store only a reference to the credential, never the credential itself' using errcode = '22023';
  end if;
  insert into tonde.ai_provider_connections(workspace_id, provider_key, state, credential_reference, note,
    last_checked_at, connected_at)
  values (target_workspace, target_provider, target_state::tonde.ai_connection_state,
    left(coalesce(credential_reference,''), 200), left(coalesce(note,''), 600), now(),
    case when target_state = 'connected' then now() end)
  on conflict (workspace_id, provider_key) do update set
    state = excluded.state, credential_reference = excluded.credential_reference, note = excluded.note,
    last_checked_at = now(),
    connected_at = case when excluded.state = 'connected' then coalesce(tonde.ai_provider_connections.connected_at, now()) end
  returning * into saved;
  if expected_revision is not null and saved.revision <> expected_revision + 1 then
    raise exception 'That connection changed since you loaded it' using errcode = 'PT409';
  end if;
  return jsonb_build_object('provider_key', saved.provider_key, 'state', saved.state,
    'credential_reference', saved.credential_reference, 'note', saved.note,
    'connected_at', saved.connected_at, 'revision', saved.revision);
end $$;

-- from 202610050017_ai_creation.sql
create or replace function tonde.set_ai_lock(target_workspace uuid, target_production uuid, payload jsonb,
  expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.ai_continuity_locks; scope_value tonde.ai_lock_scope; subject uuid; existing_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'A continuity lock must be a JSON object' using errcode = '22023';
  end if;
  scope_value := coalesce(nullif(payload ->> 'scope',''), 'character')::tonde.ai_lock_scope;
  subject := nullif(payload ->> 'subject_id','')::uuid;
  if subject is not null and not exists (select 1 from tonde.assets a
    where a.workspace_id = target_workspace and a.id = subject) then
    raise exception 'That locked subject is not an Asset in this workspace' using errcode = '23514';
  end if;
  select l.revision into existing_revision from tonde.ai_continuity_locks l
    where l.workspace_id = target_workspace and l.production_id = target_production
      and l.scope = scope_value and l.subject_id is not distinct from subject;
  if existing_revision is not null then
    if expected_revision is not null and existing_revision <> expected_revision then
      raise exception 'That lock changed since you loaded it' using errcode = 'PT409';
    end if;
    update tonde.ai_continuity_locks l set
      label = left(coalesce(payload ->> 'label', l.label), 200),
      locked = coalesce(tonde_private.ai_json_bool(payload, 'locked', l.locked), l.locked),
      priority = coalesce(nullif(payload ->> 'priority',''), l.priority::text)::tonde.ai_continuity_priority,
      locked_traits = case when payload ? 'locked_traits' then tonde_private.ai_json_text_array(payload,'locked_traits') else l.locked_traits end,
      allowed_variations = case when payload ? 'allowed_variations' then tonde_private.ai_json_text_array(payload,'allowed_variations') else l.allowed_variations end,
      prohibited_changes = case when payload ? 'prohibited_changes' then tonde_private.ai_json_text_array(payload,'prohibited_changes') else l.prohibited_changes end,
      identity_truth = left(coalesce(payload ->> 'identity_truth', l.identity_truth), 400),
      consent_note = left(coalesce(payload ->> 'consent_note', l.consent_note), 400),
      note = left(coalesce(payload ->> 'note', l.note), 600),
      locked_at = case when coalesce(tonde_private.ai_json_bool(payload, 'locked', l.locked), l.locked) then now() end
    where l.id = (select l2.id from tonde.ai_continuity_locks l2
        where l2.workspace_id = target_workspace and l2.production_id = target_production
          and l2.scope = scope_value and l2.subject_id is not distinct from subject)
    returning * into saved;
  else
    insert into tonde.ai_continuity_locks(workspace_id, production_id, scope, subject_id, label, locked,
      priority, locked_traits, allowed_variations, prohibited_changes, identity_truth, consent_note, note, locked_at)
    values (target_workspace, target_production, scope_value, subject,
      left(coalesce(payload ->> 'label',''), 200),
      coalesce(tonde_private.ai_json_bool(payload, 'locked', true), true),
      coalesce(nullif(payload ->> 'priority',''), 'MUST PRESERVE')::tonde.ai_continuity_priority,
      tonde_private.ai_json_text_array(payload,'locked_traits'),
      tonde_private.ai_json_text_array(payload,'allowed_variations'),
      tonde_private.ai_json_text_array(payload,'prohibited_changes'),
      left(coalesce(payload ->> 'identity_truth',''), 400), left(coalesce(payload ->> 'consent_note',''), 400),
      left(coalesce(payload ->> 'note',''), 600),
      case when coalesce(tonde_private.ai_json_bool(payload, 'locked', true), true) then now() end)
    returning * into saved;
  end if;
  return jsonb_build_object('lock_id', saved.id, 'scope', saved.scope, 'subject_id', saved.subject_id,
    'label', saved.label, 'locked', saved.locked, 'priority', saved.priority,
    'locked_traits', to_jsonb(saved.locked_traits), 'allowed_variations', to_jsonb(saved.allowed_variations),
    'prohibited_changes', to_jsonb(saved.prohibited_changes), 'revision', saved.revision);
end $$;

-- from 202610050017_ai_creation.sql
create or replace function tonde.set_ai_plan_approval(target_workspace uuid, target_production uuid, target_shot uuid,
  target_approval text, expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.execution_plans;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_approval not in ('draft','needs_review','approved','changed_after_approval') then
    raise exception 'That approval state is not valid' using errcode = '22023';
  end if;
  select * into saved from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if saved.id is null then raise exception 'There is no AI plan for that Shot' using errcode = 'P0002'; end if;
  if expected_revision is not null and saved.revision <> expected_revision then
    raise exception 'That AI plan changed since you loaded it' using errcode = 'PT409';
  end if;
  update tonde.execution_plans set approval = target_approval::tonde.approval
    where id = saved.id returning * into saved;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'approval', saved.approval,
    'revision', saved.revision);
end $$;

-- from 202610050017_ai_creation.sql
create or replace function tonde.set_ai_plan_lock(target_workspace uuid, target_production uuid, target_shot uuid,
  target_locked boolean, expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.execution_plans;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into saved from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if saved.id is null then raise exception 'There is no AI plan for that Shot' using errcode = 'P0002'; end if;
  if expected_revision is not null and saved.revision <> expected_revision then
    raise exception 'That AI plan changed since you loaded it' using errcode = 'PT409';
  end if;
  update tonde.execution_plans set locked_at = case when target_locked then now() end
    where id = saved.id returning * into saved;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'locked', saved.locked_at is not null,
    'revision', saved.revision);
end $$;

-- from 202610050018_long_form_series.sql
create or replace function tonde.set_long_form_lock(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid, locked boolean, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare resulting_revision integer; resulting_locked timestamptz;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_level not in ('act','sequence') then raise exception 'Lock scope must be act or sequence here' using errcode = '22023'; end if;
  if expected_revision is not null and tonde_private.lf_scope_revision(target_workspace, target_production, target_level, target_id) <> expected_revision then
    raise exception 'That object changed since you loaded it' using errcode = 'PT409';
  end if;
  if target_level = 'act' then
    update tonde.acts set locked_at = case when coalesce(locked,false) then now() else null end
      where workspace_id = target_workspace and production_id = target_production and id = target_id
      returning revision, locked_at into resulting_revision, resulting_locked;
  else
    update tonde.sequences set locked_at = case when coalesce(locked,false) then now() else null end
      where workspace_id = target_workspace and production_id = target_production and id = target_id
      returning revision, locked_at into resulting_revision, resulting_locked;
  end if;
  if resulting_revision is null then raise exception 'That object is unavailable in this Production' using errcode = 'P0002'; end if;
  return jsonb_build_object('level', target_level, 'id', target_id, 'locked', resulting_locked is not null,
    'revision', resulting_revision);
end $$;

-- from 202610050016_real_production.sql
create or replace function tonde.set_shot_capture_state(target_workspace uuid, target_production uuid, target_shot uuid,
  status text, notes text default '', expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.shot_capture_state; current_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', null);
  if status not in ('not_started','setup','shooting','captured','pickup_needed') then
    raise exception 'Unsupported capture status' using errcode = '22023';
  end if;
  if length(coalesce(notes,'')) > 1200 then raise exception 'Capture note is too long' using errcode = '22001'; end if;
  select revision into current_revision from tonde.shot_capture_state
    where workspace_id = target_workspace and shot_id = target_shot;
  if found and expected_revision is not null and current_revision <> expected_revision then
    raise exception 'The capture state changed since you loaded it' using errcode = 'PT409';
  end if;
  insert into tonde.shot_capture_state(workspace_id, production_id, shot_id, status, notes, captured_at)
  values (target_workspace, target_production, target_shot, status::tonde.capture_status, coalesce(notes,''),
    case when status = 'captured' then now() else null end)
  on conflict (workspace_id, production_id, shot_id) do update set
    status = excluded.status, notes = excluded.notes,
    captured_at = case when excluded.status = 'captured'
      then coalesce(tonde.shot_capture_state.captured_at, now()) else null end
  returning * into saved;
  return jsonb_build_object('shot_id', target_shot, 'status', saved.status, 'notes', saved.notes,
    'captured_at', saved.captured_at, 'revision', saved.revision);
end $$;

-- from 202610050015_studio_workspace.sql
create or replace function tonde.set_studio_approval(target_workspace uuid, target_production uuid, target_scope text,
  target_id uuid, desired_approval text, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare resulting_revision integer; resulting_approval tonde.approval;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_scope not in ('production','scene','shot') then
    raise exception 'Approval scope must be production, scene or shot' using errcode = '22023';
  end if;
  if desired_approval not in ('draft','needs_review','approved','changed_after_approval') then
    raise exception 'Unsupported approval state' using errcode = '22023';
  end if;
  if target_scope = 'production' then
    update tonde.productions set approval = desired_approval::tonde.approval
      where workspace_id = target_workspace and id = target_production
        and (expected_revision is null or revision = expected_revision)
      returning revision, approval into resulting_revision, resulting_approval;
  elsif target_scope = 'scene' then
    perform tonde_private.studio_revision_guard(target_workspace, target_production, target_id, 'scene', expected_revision);
    update tonde.scenes set approval = desired_approval::tonde.approval
      where workspace_id = target_workspace and production_id = target_production and id = target_id
      returning revision, approval into resulting_revision, resulting_approval;
  else
    perform tonde_private.studio_revision_guard(target_workspace, target_production, target_id, 'shot', expected_revision);
    update tonde.shots set approval = desired_approval::tonde.approval
      where workspace_id = target_workspace and production_id = target_production and id = target_id
      returning revision, approval into resulting_revision, resulting_approval;
  end if;
  if resulting_revision is null then
    raise exception 'That object changed since you loaded it' using errcode = 'PT409';
  end if;
  return jsonb_build_object('scope', target_scope, 'id', target_id, 'approval', resulting_approval, 'revision', resulting_revision);
end $$;

-- from 202610050015_studio_workspace.sql
create or replace function tonde.set_studio_lock(target_workspace uuid, target_production uuid, target_scope text,
  target_id uuid, locked boolean, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare resulting_revision integer; resulting_locked timestamptz;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_scope not in ('production','scene','shot') then
    raise exception 'Lock scope must be production, scene or shot' using errcode = '22023';
  end if;
  if target_scope = 'production' then
    update tonde.productions set locked_at = case when coalesce(locked,false) then now() else null end
      where workspace_id = target_workspace and id = target_production
        and (expected_revision is null or revision = expected_revision)
      returning revision, locked_at into resulting_revision, resulting_locked;
  elsif target_scope = 'scene' then
    update tonde.scenes set locked_at = case when coalesce(locked,false) then now() else null end
      where workspace_id = target_workspace and production_id = target_production and id = target_id
        and (expected_revision is null or revision = expected_revision)
      returning revision, locked_at into resulting_revision, resulting_locked;
  else
    update tonde.shots set locked_at = case when coalesce(locked,false) then now() else null end
      where workspace_id = target_workspace and production_id = target_production and id = target_id
        and (expected_revision is null or revision = expected_revision)
      returning revision, locked_at into resulting_revision, resulting_locked;
  end if;
  if resulting_revision is null then
    raise exception 'That object changed since you loaded it' using errcode = 'PT409';
  end if;
  return jsonb_build_object('scope', target_scope, 'id', target_id, 'locked', resulting_locked is not null, 'revision', resulting_revision);
end $$;

-- from 202610050015_studio_workspace.sql
create or replace function tonde.studio_timing(target_workspace uuid, target_production uuid, expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_revision integer;
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select revision into current_revision from tonde.productions where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and current_revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = 'PT409';
  end if;
  return tonde_private.studio_timing(target_workspace, target_production);
end $$;

-- from 202610050018_long_form_series.sql
create or replace function tonde.update_series_episode(target_workspace uuid, target_series uuid, target_episode uuid,
  expected_revision integer, patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare series_row tonde.series; current tonde.series_episodes; updated tonde.series_episodes; title_value text;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(patch) <> 'object' then raise exception 'Invalid Episode patch' using errcode = '22023'; end if;
  series_row := tonde_private.lf_series_for(target_workspace, target_series);
  select * into current from tonde.series_episodes where workspace_id = target_workspace and series_id = target_series
    and id = target_episode;
  if not found then raise exception 'Episode unavailable' using errcode = 'P0002'; end if;
  if current.locked_at is not null then raise exception 'Unlock this Episode before editing' using errcode = '23514'; end if;
  if expected_revision is not null and current.revision <> expected_revision then
    raise exception 'The Episode changed since you loaded it' using errcode = 'PT409';
  end if;
  title_value := current.title;
  if patch ? 'title' then
    title_value := btrim(coalesce(patch->>'title',''));
    if length(title_value) = 0 or length(title_value) > 160 then
      raise exception 'An Episode title is 1 to 160 characters' using errcode = '22023';
    end if;
  end if;
  update tonde.series_episodes set title = title_value,
    planned_date = case when patch ? 'planned_date' then nullif(coalesce(patch->>'planned_date',''),'')::date else planned_date end,
    runtime_target_ms = case when patch ? 'runtime_target_ms' then tonde_private.lf_ms(patch, 'runtime_target_ms') else runtime_target_ms end,
    collection_id = case when patch ? 'collection_id' then nullif(coalesce(patch->>'collection_id',''),'')::uuid else collection_id end,
    slot_key = case when patch ? 'slot_key' then nullif(btrim(coalesce(patch->>'slot_key','')),'') else slot_key end,
    requested_depth = case when patch ? 'requested_depth' then
      case when coalesce(patch->>'requested_depth','') = '' then null else (patch->>'requested_depth')::tonde.generate_depth end
      else requested_depth end,
    brief = case when patch ? 'brief' then coalesce(patch->'brief','{}'::jsonb) else brief end,
    episode_number = case when patch ? 'episode_number' then coalesce(nullif(patch->>'episode_number','')::bigint, episode_number) else episode_number end,
    lifecycle = case when patch ? 'lifecycle' then coalesce(nullif(patch->>'lifecycle',''),'active')::tonde.lifecycle else lifecycle end
  where workspace_id = target_workspace and series_id = target_series and id = target_episode
  returning * into updated;
  return jsonb_build_object('episode_id', updated.id, 'revision', updated.revision, 'title', updated.title,
    'episode_number', updated.episode_number, 'planned_date', updated.planned_date,
    'requested_depth', updated.requested_depth, 'lifecycle', updated.lifecycle,
    'production_line_state', tonde_private.lf_line_state(target_workspace, updated.production_id));
end $$;

commit;
