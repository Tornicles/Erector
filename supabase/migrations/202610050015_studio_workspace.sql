-- Additive migration: Prompt 5 Studio workspace.
-- Shots become first-class canonical objects (Prompt 4 stored shot plans inside
-- scenes.scene_detail only). Adds guarded Studio mutation RPCs; no hosted
-- migration is rewritten and no existing column changes meaning.
begin;

-- 1. Shot creative fields (5B). Bounded, defaulted, additive.
alter table tonde.shots add column purpose text not null default '' check (length(purpose) <= 200);
alter table tonde.shots add column subject text not null default '' check (length(subject) <= 200);
alter table tonde.shots add column framing text not null default '' check (length(framing) <= 120);
alter table tonde.shots add column angle text not null default '' check (length(angle) <= 120);
alter table tonde.shots add column movement text not null default '' check (length(movement) <= 160);
alter table tonde.shots add column composition text not null default '' check (length(composition) <= 300);
alter table tonde.shots add column transition text not null default '' check (length(transition) <= 200);
alter table tonde.shots add column story_relationship text not null default '' check (length(story_relationship) <= 300);
alter table tonde.shots add column creative_notes text not null default '' check (length(creative_notes) <= 1200);
alter table tonde.shots add column source_operation_id uuid;
alter table tonde.shots add column story_beat text not null default '' check (length(story_beat) <= 200);
create index shots_live_order on tonde.shots(workspace_id, production_id, scene_id, lifecycle, sort_order)
  where lifecycle = 'active';

-- 2. Scenes and Shots are already registered as scoped objects by the existing
-- a_register_object trigger (migration 002), so Scope bindings, Director threads and
-- documents can address a Scene or Shot by its own id. Prompt 5 relies on that rather
-- than duplicating identity.
create or replace function tonde_private.assert_scope_object(target_workspace uuid, target_production uuid, target_id uuid, target_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from tonde.objects o where o.workspace_id = target_workspace
    and o.id = target_id and o.kind = target_kind and o.production_id is not distinct from target_production) then
    raise exception 'Studio object identity is missing for this %', target_kind using errcode = '23514';
  end if;
end $$;
revoke all on function tonde_private.assert_scope_object(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;

-- 3. One guard for every Studio write: authenticated editor, live Production, revision match.
create function tonde_private.studio_guard(target_workspace uuid, target_production uuid, expected_revision integer)
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
    raise exception 'The Production changed since you loaded it' using errcode = '40001';
  end if;
  return current;
end $$;
revoke all on function tonde_private.studio_guard(uuid,uuid,integer) from public, anon, authenticated, service_role;

-- Scenes and Shots carry their own revision, lock and approval.
create function tonde_private.studio_revision_guard(target_workspace uuid, target_production uuid, target_id uuid, object_kind text, expected_revision integer)
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
    raise exception 'That % changed since you loaded it', object_kind using errcode = '40001';
  end if;
end $$;
revoke all on function tonde_private.studio_revision_guard(uuid,uuid,uuid,text,integer) from public, anon, authenticated, service_role;

-- 4. Timing authority: a Scene's duration is derived from its Shots only when every
-- Shot in that Scene has a duration. Otherwise the Scene keeps its planned value and
-- is reported as incomplete. Derived timing is COMPUTED, never stored: writing derived
-- columns would bump content revisions and invalidate every client revision handle.
create function tonde_private.studio_timing(target_workspace uuid, target_production uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target_ms bigint; total_ms bigint; scene_states jsonb;
begin
  select planned_duration_ms into target_ms from tonde.productions
    where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  with scene_rollup as (
    select s.id, s.sort_order, s.planned_duration_ms,
      count(h.id) as shot_count,
      count(h.id) filter (where h.planned_duration_ms is null) as missing,
      coalesce(sum(h.planned_duration_ms), 0) as shot_total
    from tonde.scenes s
    left join tonde.shots h on h.workspace_id = s.workspace_id and h.production_id = s.production_id
      and h.scene_id = s.id and h.lifecycle = 'active'
    where s.workspace_id = target_workspace and s.production_id = target_production and s.lifecycle = 'active'
    group by s.id, s.sort_order, s.planned_duration_ms
  )
  select coalesce(sum(case when shot_count > 0 and missing = 0 then shot_total else coalesce(planned_duration_ms, 0) end), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'scene_id', id,
      'order', sort_order,
      'duration_ms', case when shot_count > 0 and missing = 0 then shot_total else coalesce(planned_duration_ms, 0) end,
      'shots', shot_count,
      'timing', case when shot_count > 0 and missing = 0 then 'derived' when shot_count > 0 then 'incomplete' else 'planned' end)
      order by sort_order, id), '[]'::jsonb)
  into total_ms, scene_states from scene_rollup;
  return jsonb_build_object(
    'total_ms', total_ms,
    'target_ms', target_ms,
    'delta_ms', case when target_ms is null then null else total_ms - target_ms end,
    'status', case when target_ms is null then 'unresolved' when total_ms = target_ms then 'fits'
      when total_ms > target_ms then 'over' else 'under' end,
    'scene_states', scene_states);
end $$;
revoke all on function tonde_private.studio_timing(uuid,uuid) from public, anon, authenticated, service_role;
create function tonde.studio_timing(target_workspace uuid, target_production uuid, expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_revision integer;
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select revision into current_revision from tonde.productions where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and current_revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = '40001';
  end if;
  return tonde_private.studio_timing(target_workspace, target_production);
end $$;

-- 5. Scene operations.
create function tonde.create_studio_scene(target_workspace uuid, target_production uuid, expected_production_revision integer, scene jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created tonde.scenes; next_order bigint; scene_title text; env_id uuid; desired_duration bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, expected_production_revision);
  if jsonb_typeof(scene) <> 'object' then raise exception 'Invalid Scene payload' using errcode = '22023'; end if;
  scene_title := btrim(coalesce(scene->>'title',''));
  if length(scene_title) = 0 or length(scene_title) > 160 then
    raise exception 'A Scene needs a title of 1 to 160 characters' using errcode = '22023';
  end if;
  if coalesce(scene->>'environment_asset_id','') <> '' then
    env_id := (scene->>'environment_asset_id')::uuid;
    if not exists(select 1 from tonde.assets a where a.workspace_id = target_workspace and a.id = env_id
      and a.asset_type = 'environment' and a.lifecycle = 'active') then
      raise exception 'A Scene environment must be an active environment asset' using errcode = '23514';
    end if;
  end if;
  if scene->>'duration_ms' is not null then
    if scene->>'duration_ms' !~ '^[0-9]{1,16}$' then
      raise exception 'Scene duration must be whole milliseconds' using errcode = '22023';
    end if;
    desired_duration := (scene->>'duration_ms')::bigint;
    if desired_duration > 9007199254740991 then raise exception 'Scene duration exceeds the safe integer range' using errcode = '22023'; end if;
  end if;
  select coalesce(max(s.sort_order), 0) + 1024 into next_order from tonde.scenes s
    where s.workspace_id = target_workspace and s.production_id = target_production;
  insert into tonde.scenes(workspace_id, production_id, title, purpose, description, story_beat, opening_state,
    ending_state, visual_intent, dialogue_notes, action_lines, scene_detail, environment_asset_id, sort_order, planned_duration_ms)
  values (target_workspace, target_production, left(scene_title,160), left(coalesce(scene->>'purpose',''),1200),
    left(coalesce(scene->>'description',''),4000), left(coalesce(scene->>'story_beat',''),200),
    left(coalesce(scene->>'opening_state',''),400), left(coalesce(scene->>'ending_state',''),400),
    left(coalesce(scene->>'visual_intent',''),900), left(coalesce(scene->>'dialogue_notes',''),900),
    '[]'::jsonb, '{}'::jsonb, env_id, next_order, desired_duration)
  returning * into created;
  perform tonde_private.assert_scope_object(target_workspace, target_production, created.id, 'scene');
  return jsonb_build_object(
    'scene_id', created.id, 'title', created.title, 'sort_order', created.sort_order,
    'revision', created.revision, 'approval', created.approval,
    'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

create function tonde.update_studio_scene(target_workspace uuid, target_production uuid, target_scene uuid, expected_revision integer, patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare updated tonde.scenes; current tonde.scenes; desired_duration bigint; title_value text; env_value text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(patch) <> 'object' then raise exception 'Invalid Scene patch' using errcode = '22023'; end if;
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_scene, 'scene', expected_revision);
  select * into current from tonde.scenes where workspace_id = target_workspace and production_id = target_production and id = target_scene;
  title_value := current.title;
  if patch ? 'title' then
    title_value := btrim(coalesce(patch->>'title',''));
    if length(title_value) = 0 or length(title_value) > 160 then
      raise exception 'A Scene needs a title of 1 to 160 characters' using errcode = '22023';
    end if;
  end if;
  env_value := current.environment_asset_id::text;
  if patch ? 'environment_asset_id' then
    env_value := nullif(coalesce(patch->>'environment_asset_id',''), '');
    if env_value is not null and not exists(select 1 from tonde.assets a where a.workspace_id = target_workspace
      and a.id = env_value::uuid and a.asset_type = 'environment' and a.lifecycle = 'active') then
      raise exception 'A Scene environment must be an active environment asset' using errcode = '23514';
    end if;
  end if;
  desired_duration := current.planned_duration_ms;
  if patch ? 'duration_ms' then
    if patch->>'duration_ms' is null then
      desired_duration := null;
    elsif patch->>'duration_ms' !~ '^[0-9]{1,16}$' then
      raise exception 'Scene duration must be whole milliseconds' using errcode = '22023';
    else
      desired_duration := (patch->>'duration_ms')::bigint;
      if desired_duration > 9007199254740991 then raise exception 'Scene duration exceeds the safe integer range' using errcode = '22023'; end if;
    end if;
  end if;
  update tonde.scenes set
    title = title_value,
    purpose = case when patch ? 'purpose' then left(coalesce(patch->>'purpose',''),1200) else purpose end,
    description = case when patch ? 'description' then left(coalesce(patch->>'description',''),4000) else description end,
    story_beat = case when patch ? 'story_beat' then left(coalesce(patch->>'story_beat',''),200) else story_beat end,
    opening_state = case when patch ? 'opening_state' then left(coalesce(patch->>'opening_state',''),400) else opening_state end,
    ending_state = case when patch ? 'ending_state' then left(coalesce(patch->>'ending_state',''),400) else ending_state end,
    visual_intent = case when patch ? 'visual_intent' then left(coalesce(patch->>'visual_intent',''),900) else visual_intent end,
    dialogue_notes = case when patch ? 'dialogue_notes' then left(coalesce(patch->>'dialogue_notes',''),900) else dialogue_notes end,
    environment_asset_id = env_value::uuid,
    planned_duration_ms = desired_duration
  where workspace_id = target_workspace and production_id = target_production and id = target_scene
  returning * into updated;
  return jsonb_build_object(
    'scene_id', updated.id, 'revision', updated.revision, 'approval', updated.approval,
    'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

create function tonde.reorder_studio_scenes(target_workspace uuid, target_production uuid, expected_production_revision integer, ordered_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare live_count integer; provided_count integer; base_order bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, expected_production_revision);
  if ordered_ids is null or array_length(ordered_ids, 1) is null then
    raise exception 'Provide the complete Scene order' using errcode = '22023';
  end if;
  select count(*) into live_count from tonde.scenes
    where workspace_id = target_workspace and production_id = target_production and lifecycle = 'active';
  select count(distinct value) into provided_count from unnest(ordered_ids) as value;
  if provided_count <> array_length(ordered_ids, 1) then
    raise exception 'Scene order contains duplicates' using errcode = '22023';
  end if;
  if provided_count <> live_count or exists(
    select 1 from unnest(ordered_ids) as value
    where not exists(select 1 from tonde.scenes s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.id = value and s.lifecycle = 'active')) then
    raise exception 'The Scene order must list exactly the live Scenes of this Production' using errcode = '22023';
  end if;
  select coalesce(max(s.sort_order), 0) + 1024 into base_order from tonde.scenes s
    where s.workspace_id = target_workspace and s.production_id = target_production;
  set constraints all deferred;
  update tonde.scenes s set sort_order = base_order + ranked.position * 1024
    from (select value as id, row_number() over () as position from unnest(ordered_ids) as value) as ranked
    where s.workspace_id = target_workspace and s.production_id = target_production and s.id = ranked.id;
  return jsonb_build_object('scenes', live_count, 'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

create function tonde.archive_studio_scene(target_workspace uuid, target_production uuid, target_scene uuid, expected_revision integer, cascade boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare next_order bigint; live_shots integer; shot_floor bigint; archived_shots integer := 0;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_scene, 'scene', expected_revision);
  select count(*) into live_shots from tonde.shots
    where workspace_id = target_workspace and production_id = target_production and scene_id = target_scene and lifecycle = 'active';
  if live_shots > 0 and not coalesce(cascade, false) then
    raise exception 'This Scene still has % Shot(s). Archive them too, or move them first.', live_shots using errcode = '23514';
  end if;
  -- Scenes and Shots each own a production-wide ordering namespace; never mix them.
  select coalesce(max(s.sort_order), 0) + 1024 into next_order from tonde.scenes s
    where s.workspace_id = target_workspace and s.production_id = target_production;
  if coalesce(cascade, false) and live_shots > 0 then
    select coalesce(max(h.sort_order), 0) + 1024 into shot_floor from tonde.shots h
      where h.workspace_id = target_workspace and h.production_id = target_production;
    set constraints all deferred;
    update tonde.shots h set lifecycle = 'archived', sort_order = shot_floor + ranked.position * 1024
      from (select id, row_number() over (order by sort_order, id) as position from tonde.shots
        where workspace_id = target_workspace and production_id = target_production
          and scene_id = target_scene and lifecycle = 'active') as ranked
      where h.workspace_id = target_workspace and h.production_id = target_production and h.id = ranked.id;
    archived_shots := live_shots;
  end if;
  update tonde.scenes set lifecycle = 'archived', sort_order = next_order, planned_duration_ms = null
    where workspace_id = target_workspace and production_id = target_production and id = target_scene;
  return jsonb_build_object('scene_id', target_scene, 'archived_shots', archived_shots,
    'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

-- 6. Shot operations.
create function tonde.create_studio_shot(target_workspace uuid, target_production uuid, target_scene uuid,
  expected_production_revision integer, shot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created tonde.shots; next_order bigint; shot_title text; desired_duration bigint; desired_method text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, expected_production_revision);
  if jsonb_typeof(shot) <> 'object' then raise exception 'Invalid Shot payload' using errcode = '22023'; end if;
  if target_scene is not null and not exists(select 1 from tonde.scenes s where s.workspace_id = target_workspace
    and s.production_id = target_production and s.id = target_scene and s.lifecycle = 'active') then
    raise exception 'Shot target Scene is unavailable in this Production' using errcode = 'P0002';
  end if;
  shot_title := btrim(coalesce(shot->>'title',''));
  if length(shot_title) = 0 or length(shot_title) > 160 then
    raise exception 'A Shot needs a title of 1 to 160 characters' using errcode = '22023';
  end if;
  if shot->>'duration_ms' is not null then
    if shot->>'duration_ms' !~ '^[0-9]{1,16}$' then raise exception 'Shot duration must be whole milliseconds' using errcode = '22023'; end if;
    desired_duration := (shot->>'duration_ms')::bigint;
    if desired_duration > 9007199254740991 then raise exception 'Shot duration exceeds the safe integer range' using errcode = '22023'; end if;
  end if;
  desired_method := coalesce(nullif(shot->>'execution_method',''), 'real');
  if desired_method not in ('real','ai','hybrid') then
    raise exception 'Shot execution method must be real, ai or hybrid' using errcode = '22023';
  end if;
  -- sort_order is unique per Production (not per Scene), so the next free slot is
  -- computed across the whole Production including archived rows.
  select coalesce(max(h.sort_order), 0) + 1024 into next_order from tonde.shots h
    where h.workspace_id = target_workspace and h.production_id = target_production;
  insert into tonde.shots(workspace_id, production_id, scene_id, title, description, action, purpose, subject,
    framing, angle, movement, composition, transition, story_relationship, creative_notes, story_beat,
    execution_method, sort_order, planned_duration_ms)
  values (target_workspace, target_production, target_scene, left(shot_title,160),
    left(coalesce(shot->>'description',''),4000), left(coalesce(shot->>'action',''),4000),
    left(coalesce(shot->>'purpose',''),200), left(coalesce(shot->>'subject',''),200),
    left(coalesce(shot->>'framing',''),120), left(coalesce(shot->>'angle',''),120),
    left(coalesce(shot->>'movement',''),160), left(coalesce(shot->>'composition',''),300),
    left(coalesce(shot->>'transition',''),200), left(coalesce(shot->>'story_relationship',''),300),
    left(coalesce(shot->>'creative_notes',''),1200), left(coalesce(shot->>'story_beat',''),200),
    desired_method::tonde.execution_method, next_order, desired_duration)
  returning * into created;
  perform tonde_private.assert_scope_object(target_workspace, target_production, created.id, 'shot');
  return jsonb_build_object(
    'shot_id', created.id, 'title', created.title, 'sort_order', created.sort_order,
    'revision', created.revision, 'approval', created.approval, 'execution_method', created.execution_method,
    'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

create function tonde.update_studio_shot(target_workspace uuid, target_production uuid, target_shot uuid, expected_revision integer, patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare updated tonde.shots; current tonde.shots; desired_duration bigint; title_value text; method_value text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(patch) <> 'object' then raise exception 'Invalid Shot patch' using errcode = '22023'; end if;
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', expected_revision);
  select * into current from tonde.shots where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  title_value := current.title;
  if patch ? 'title' then
    title_value := btrim(coalesce(patch->>'title',''));
    if length(title_value) = 0 or length(title_value) > 160 then
      raise exception 'A Shot needs a title of 1 to 160 characters' using errcode = '22023';
    end if;
  end if;
  method_value := current.execution_method::text;
  if patch ? 'execution_method' then
    method_value := coalesce(nullif(patch->>'execution_method',''), 'real');
    if method_value not in ('real','ai','hybrid') then
      raise exception 'Shot execution method must be real, ai or hybrid' using errcode = '22023';
    end if;
  end if;
  desired_duration := current.planned_duration_ms;
  if patch ? 'duration_ms' then
    if patch->>'duration_ms' is null then
      desired_duration := null;
    elsif patch->>'duration_ms' !~ '^[0-9]{1,16}$' then
      raise exception 'Shot duration must be whole milliseconds' using errcode = '22023';
    else
      desired_duration := (patch->>'duration_ms')::bigint;
      if desired_duration > 9007199254740991 then raise exception 'Shot duration exceeds the safe integer range' using errcode = '22023'; end if;
    end if;
  end if;
  update tonde.shots set
    title = title_value,
    description = case when patch ? 'description' then left(coalesce(patch->>'description',''),4000) else description end,
    action = case when patch ? 'action' then left(coalesce(patch->>'action',''),4000) else action end,
    purpose = case when patch ? 'purpose' then left(coalesce(patch->>'purpose',''),200) else purpose end,
    subject = case when patch ? 'subject' then left(coalesce(patch->>'subject',''),200) else subject end,
    framing = case when patch ? 'framing' then left(coalesce(patch->>'framing',''),120) else framing end,
    angle = case when patch ? 'angle' then left(coalesce(patch->>'angle',''),120) else angle end,
    movement = case when patch ? 'movement' then left(coalesce(patch->>'movement',''),160) else movement end,
    composition = case when patch ? 'composition' then left(coalesce(patch->>'composition',''),300) else composition end,
    transition = case when patch ? 'transition' then left(coalesce(patch->>'transition',''),200) else transition end,
    story_relationship = case when patch ? 'story_relationship' then left(coalesce(patch->>'story_relationship',''),300) else story_relationship end,
    creative_notes = case when patch ? 'creative_notes' then left(coalesce(patch->>'creative_notes',''),1200) else creative_notes end,
    story_beat = case when patch ? 'story_beat' then left(coalesce(patch->>'story_beat',''),200) else story_beat end,
    execution_method = method_value::tonde.execution_method,
    planned_duration_ms = desired_duration
  where workspace_id = target_workspace and production_id = target_production and id = target_shot
  returning * into updated;
  return jsonb_build_object(
    'shot_id', updated.id, 'revision', updated.revision, 'approval', updated.approval,
    'execution_method', updated.execution_method, 'scene_id', updated.scene_id,
    'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

create function tonde.move_studio_shot(target_workspace uuid, target_production uuid, target_shot uuid, target_scene uuid, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare moved tonde.shots; next_order bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', expected_revision);
  if target_scene is not null and not exists(select 1 from tonde.scenes s where s.workspace_id = target_workspace
    and s.production_id = target_production and s.id = target_scene and s.lifecycle = 'active') then
    raise exception 'Target Scene is unavailable in this Production' using errcode = 'P0002';
  end if;
  select coalesce(max(h.sort_order), 0) + 1024 into next_order from tonde.shots h
    where h.workspace_id = target_workspace and h.production_id = target_production;
  update tonde.shots set scene_id = target_scene, sort_order = next_order
    where workspace_id = target_workspace and production_id = target_production and id = target_shot
    returning * into moved;
  return jsonb_build_object('shot_id', moved.id, 'scene_id', moved.scene_id, 'sort_order', moved.sort_order,
    'revision', moved.revision, 'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

create function tonde.reorder_studio_shots(target_workspace uuid, target_production uuid, target_scene uuid, expected_production_revision integer, ordered_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare live_count integer; provided_count integer; base_order bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, expected_production_revision);
  if ordered_ids is null or array_length(ordered_ids, 1) is null then
    raise exception 'Provide the complete Shot order' using errcode = '22023';
  end if;
  select count(*) into live_count from tonde.shots
    where workspace_id = target_workspace and production_id = target_production
      and scene_id is not distinct from target_scene and lifecycle = 'active';
  select count(distinct value) into provided_count from unnest(ordered_ids) as value;
  if provided_count <> array_length(ordered_ids, 1) then
    raise exception 'Shot order contains duplicates' using errcode = '22023';
  end if;
  if provided_count <> live_count or exists(
    select 1 from unnest(ordered_ids) as value
    where not exists(select 1 from tonde.shots h where h.workspace_id = target_workspace
      and h.production_id = target_production and h.id = value and h.lifecycle = 'active'
      and h.scene_id is not distinct from target_scene)) then
    raise exception 'The Shot order must list exactly the live Shots of this Scene' using errcode = '22023';
  end if;
  -- Reassign above every existing row so the shared Production-wide ordering never collides.
  select coalesce(max(h.sort_order), 0) + 1024 into base_order from tonde.shots h
    where h.workspace_id = target_workspace and h.production_id = target_production;
  set constraints all deferred;
  update tonde.shots h set sort_order = base_order + ranked.position * 1024
    from (select value as id, row_number() over () as position from unnest(ordered_ids) as value) as ranked
    where h.workspace_id = target_workspace and h.production_id = target_production and h.id = ranked.id;
  return jsonb_build_object('shots', live_count, 'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

create function tonde.archive_studio_shot(target_workspace uuid, target_production uuid, target_shot uuid, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare next_order bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', expected_revision);
  select coalesce(max(h.sort_order), 0) + 1024 into next_order from tonde.shots h
    where h.workspace_id = target_workspace and h.production_id = target_production;
  -- Archive over hard delete: the Shot leaves the live order but remains readable.
  update tonde.shots set lifecycle = 'archived', sort_order = next_order
    where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  return jsonb_build_object('shot_id', target_shot, 'archived', true,
    'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

-- 7. Approval and lock. Approval stays the canonical enum; a changed approved row
-- already reports changed_after_approval through the integrity guard.
create function tonde.set_studio_approval(target_workspace uuid, target_production uuid, target_scope text,
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
    raise exception 'That object changed since you loaded it' using errcode = '40001';
  end if;
  return jsonb_build_object('scope', target_scope, 'id', target_id, 'approval', resulting_approval, 'revision', resulting_revision);
end $$;

create function tonde.set_studio_lock(target_workspace uuid, target_production uuid, target_scope text,
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
    raise exception 'That object changed since you loaded it' using errcode = '40001';
  end if;
  return jsonb_build_object('scope', target_scope, 'id', target_id, 'locked', resulting_locked is not null, 'revision', resulting_revision);
end $$;

-- 8. Runtime reconciliation: the creator names the Scene that absorbs the delta and
-- its trailing Shot takes the exact adjustment. Nothing is redistributed silently.
create function tonde.reconcile_studio_runtime(target_workspace uuid, target_production uuid, absorb_scene uuid, expected_production_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare timing jsonb; delta bigint; scene_row tonde.scenes; trailing_shot tonde.shots; new_duration bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, expected_production_revision);
  timing := tonde_private.studio_timing(target_workspace, target_production);
  delta := coalesce((timing->>'delta_ms')::bigint, 0);
  if timing->>'target_ms' is null then
    raise exception 'Set a Production runtime target before reconciling timing' using errcode = '23514';
  end if;
  if delta = 0 then
    return jsonb_build_object('adjusted_ms', 0, 'timing', timing);
  end if;
  select * into scene_row from tonde.scenes where workspace_id = target_workspace and production_id = target_production
    and id = absorb_scene and lifecycle = 'active';
  if not found then raise exception 'The absorbing Scene is unavailable' using errcode = 'P0002'; end if;
  if scene_row.locked_at is not null then raise exception 'That Scene is locked. Unlock it before editing.' using errcode = '23514'; end if;
  select * into trailing_shot from tonde.shots where workspace_id = target_workspace and production_id = target_production
    and scene_id = absorb_scene and lifecycle = 'active' and planned_duration_ms is not null
    order by sort_order desc, id desc limit 1;
  if not found then
    raise exception 'The absorbing Scene needs at least one Shot with a duration' using errcode = '23514';
  end if;
  if trailing_shot.locked_at is not null then raise exception 'That Shot is locked. Unlock it before editing.' using errcode = '23514'; end if;
  new_duration := trailing_shot.planned_duration_ms - delta;
  if new_duration < 0 then
    raise exception 'That adjustment would make the last Shot of the absorbing Scene negative. Choose a different Scene.' using errcode = '23514';
  end if;
  update tonde.shots set planned_duration_ms = new_duration
    where workspace_id = target_workspace and production_id = target_production and id = trailing_shot.id;
  return jsonb_build_object('adjusted_ms', -delta, 'shot_id', trailing_shot.id, 'scene_id', absorb_scene,
    'shot_duration_ms', new_duration, 'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

-- 9. Privileges: authenticated only, never anon or service_role, private helper hidden.
revoke all on function tonde.studio_timing(uuid,uuid,integer),
  tonde.create_studio_scene(uuid,uuid,integer,jsonb),
  tonde.update_studio_scene(uuid,uuid,uuid,integer,jsonb),
  tonde.reorder_studio_scenes(uuid,uuid,integer,uuid[]),
  tonde.archive_studio_scene(uuid,uuid,uuid,integer,boolean),
  tonde.create_studio_shot(uuid,uuid,uuid,integer,jsonb),
  tonde.update_studio_shot(uuid,uuid,uuid,integer,jsonb),
  tonde.move_studio_shot(uuid,uuid,uuid,uuid,integer),
  tonde.reorder_studio_shots(uuid,uuid,uuid,integer,uuid[]),
  tonde.archive_studio_shot(uuid,uuid,uuid,integer),
  tonde.set_studio_approval(uuid,uuid,text,uuid,text,integer),
  tonde.set_studio_lock(uuid,uuid,text,uuid,boolean,integer),
  tonde.reconcile_studio_runtime(uuid,uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.studio_timing(uuid,uuid,integer),
  tonde.create_studio_scene(uuid,uuid,integer,jsonb),
  tonde.update_studio_scene(uuid,uuid,uuid,integer,jsonb),
  tonde.reorder_studio_scenes(uuid,uuid,integer,uuid[]),
  tonde.archive_studio_scene(uuid,uuid,uuid,integer,boolean),
  tonde.create_studio_shot(uuid,uuid,uuid,integer,jsonb),
  tonde.update_studio_shot(uuid,uuid,uuid,integer,jsonb),
  tonde.move_studio_shot(uuid,uuid,uuid,uuid,integer),
  tonde.reorder_studio_shots(uuid,uuid,uuid,integer,uuid[]),
  tonde.archive_studio_shot(uuid,uuid,uuid,integer),
  tonde.set_studio_approval(uuid,uuid,text,uuid,text,integer),
  tonde.set_studio_lock(uuid,uuid,text,uuid,boolean,integer),
  tonde.reconcile_studio_runtime(uuid,uuid,uuid,integer)
  to authenticated;
commit;
