begin;

-- 1. Real Execution Plan body. One Shot has at most one real plan row
-- (unique (shot_id, execution_method) already exists), so these are genuinely
-- per-plan single values rather than another table.
--
-- Exposure values (shutter / aperture / ISO / WB / ND) are RECOMMENDATIONS and
-- STARTING POINTS by contract: they are stored as the bounded text the director
-- produced, and the surface labels them. Nothing here claims measured truth.
alter table tonde.execution_plans add column plan_status text not null default 'draft'
  check (plan_status in ('draft','ready','ready_with_substitution','needs_decision','missing_resource','safety_blocked'));
alter table tonde.execution_plans add column readiness_note text not null default '' check (length(readiness_note) <= 600);
alter table tonde.execution_plans add column complexity text check (complexity in ('quick','moderate','complex'));
alter table tonde.execution_plans add column complexity_is_estimate boolean not null default true;
alter table tonde.execution_plans add column generated_by text not null default 'deterministic'
  check (generated_by in ('deterministic','model','creator'));
alter table tonde.execution_plans add column source_operation_id uuid;
-- Camera and lens geometry.
alter table tonde.execution_plans add column shot_size text not null default '' check (length(shot_size) <= 80);
alter table tonde.execution_plans add column camera_position text not null default '' check (length(camera_position) <= 400);
alter table tonde.execution_plans add column camera_height text not null default '' check (length(camera_height) <= 200);
alter table tonde.execution_plans add column camera_angle text not null default '' check (length(camera_angle) <= 200);
alter table tonde.execution_plans add column framing text not null default '' check (length(framing) <= 300);
alter table tonde.execution_plans add column composition text not null default '' check (length(composition) <= 400);
alter table tonde.execution_plans add column perspective_note text not null default '' check (length(perspective_note) <= 600);
-- Movement.
alter table tonde.execution_plans add column movement text not null default '' check (length(movement) <= 200);
alter table tonde.execution_plans add column movement_purpose text not null default '' check (length(movement_purpose) <= 600);
alter table tonde.execution_plans add column stabilization text not null default '' check (length(stabilization) <= 200);
-- Exposure starting points.
alter table tonde.execution_plans add column capture_fps text not null default '' check (length(capture_fps) <= 80);
alter table tonde.execution_plans add column delivery_fps text not null default '' check (length(delivery_fps) <= 80);
alter table tonde.execution_plans add column shutter text not null default '' check (length(shutter) <= 120);
alter table tonde.execution_plans add column aperture text not null default '' check (length(aperture) <= 120);
alter table tonde.execution_plans add column iso_range text not null default '' check (length(iso_range) <= 120);
alter table tonde.execution_plans add column white_balance text not null default '' check (length(white_balance) <= 160);
alter table tonde.execution_plans add column nd_filter text not null default '' check (length(nd_filter) <= 200);
alter table tonde.execution_plans add column exposure_note text not null default '' check (length(exposure_note) <= 600);
-- Focus.
alter table tonde.execution_plans add column focus_strategy text not null default '' check (length(focus_strategy) <= 600);
alter table tonde.execution_plans add column depth_of_field text not null default '' check (length(depth_of_field) <= 400);
-- Light, blocking, performance, Product.
alter table tonde.execution_plans add column lighting_intent text not null default '' check (length(lighting_intent) <= 400);
alter table tonde.execution_plans add column lighting_plan text not null default '' check (length(lighting_plan) <= 2000);
-- A structured diagram foundation (subject / camera / lights / modifiers / direction /
-- purpose) that can later render visually. Empty object is valid and means "no diagram".
alter table tonde.execution_plans add column lighting_diagram jsonb not null default '{}'::jsonb
  check (jsonb_typeof(lighting_diagram) = 'object');
alter table tonde.execution_plans add column blocking text not null default '' check (length(blocking) <= 2000);
alter table tonde.execution_plans add column performance text not null default '' check (length(performance) <= 2000);
alter table tonde.execution_plans add column product_direction text not null default '' check (length(product_direction) <= 1200);
-- Sound.
alter table tonde.execution_plans add column sound_plan text not null default '' check (length(sound_plan) <= 2000);
alter table tonde.execution_plans add column microphone_plan text not null default '' check (length(microphone_plan) <= 1200);
alter table tonde.execution_plans add column sync_strategy text not null default '' check (length(sync_strategy) <= 600);
-- Crew, solo feasibility, Environment and Location requirements.
alter table tonde.execution_plans add column solo_feasibility text
  check (solo_feasibility in ('solo','solo_with_simplification','second_person_recommended','crew_required'));
alter table tonde.execution_plans add column crew_roles text[] not null default '{}';
alter table tonde.execution_plans add column environment_requirements text[] not null default '{}';
alter table tonde.execution_plans add column location_requirements text[] not null default '{}';
-- Safety and purpose.
alter table tonde.execution_plans add column safety_notes text[] not null default '{}';
alter table tonde.execution_plans add column safety_flags text[] not null default '{}';
alter table tonde.execution_plans add column editorial_intent text not null default '' check (length(editorial_intent) <= 300);
alter table tonde.execution_plans add column setup_steps text[] not null default '{}';
alter table tonde.execution_plans add column capture_checklist text[] not null default '{}';
alter table tonde.execution_plans add column expected_duration_ms bigint check (expected_duration_ms >= 0);
create index execution_plans_real_by_shot on tonde.execution_plans(workspace_id, production_id, shot_id)
  where execution_method = 'real';

-- 2. Setup matching. One row per thing a Shot needs. This is where "owned",
-- "owned substitute" and "missing" are recorded as separate facts instead of a
-- single optimistic assumption that the creator owns everything.
create type tonde.requirement_kind as enum ('camera','lens','stabilization','light','modifier','stand',
  'microphone','recorder','wireless_audio','filter','monitor','rigging','accessory','power','space',
  'sound','talent','crew','product','prop','wardrobe','environment','runtime');
create type tonde.requirement_status as enum ('owned','substitute','missing','unverified','not_required');
create type tonde.epistemic as enum ('REQUIRED','RECOMMENDED','STARTING POINT','OPTIONAL','UNKNOWN');
create table tonde.real_plan_requirements (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  shot_id uuid not null, plan_id uuid not null,
  requirement_kind tonde.requirement_kind not null,
  label text not null check (length(btrim(label)) between 1 and 160),
  ideal_name text not null default '' check (length(ideal_name) <= 200),
  detail text not null default '' check (length(detail) <= 1200),
  setup_note text not null default '' check (length(setup_note) <= 600),
  alternative text not null default '' check (length(alternative) <= 600),
  status tonde.requirement_status not null,
  epistemic tonde.epistemic not null default 'REQUIRED',
  resource_type tonde.resource_type, resource_id uuid, substitute_resource_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (plan_id, requirement_kind, label),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict,
  foreign key (workspace_id, resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  foreign key (workspace_id, substitute_resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  -- Two NULLs are both "not named" and must be allowed; only naming the same
  -- resource twice is contradictory.
  check (resource_id is null or substitute_resource_id is null or resource_id <> substitute_resource_id),
  check (status <> 'owned' or resource_id is not null)
);
create index real_plan_requirements_by_plan on tonde.real_plan_requirements(workspace_id, plan_id);

-- 3. Practical alternatives for a Shot (best quality / fastest / solo / lowest
-- equipment / safest / available light / substitute / AI foundation).
create type tonde.alternative_kind as enum ('best_quality','fastest','solo','lowest_equipment','safest',
  'available_light','substitute','ai_foundation');
create table tonde.real_plan_alternatives (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  shot_id uuid not null, plan_id uuid not null,
  kind tonde.alternative_kind not null,
  label text not null check (length(btrim(label)) between 1 and 160),
  description text not null default '' check (length(description) <= 1200),
  expected_impact text not null default '' check (length(expected_impact) <= 600),
  tradeoffs text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (plan_id, kind),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict
);

-- 4. Capture state. "Captured" is explicitly NOT "approved final"; approval stays
-- on the plan and the Shot.
create type tonde.capture_status as enum ('not_started','setup','shooting','captured','pickup_needed');
create table tonde.shot_capture_state (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  shot_id uuid not null, status tonde.capture_status not null default 'not_started',
  notes text not null default '' check (length(notes) <= 1200),
  captured_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, production_id, shot_id),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict
);

-- 5. Take log. A Take is a field record, not a Result: it may point at the media
-- abstraction once a file exists, and it may exist with no media at all.
create type tonde.take_status as enum ('recorded','review','good','preferred','unusable','pickup_required');
create table tonde.shot_takes (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  shot_id uuid not null, plan_id uuid,
  take_number integer not null check (take_number between 1 and 999),
  status tonde.take_status not null default 'recorded',
  notes text not null default '' check (length(notes) <= 1200),
  media_id uuid,
  recorded_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, shot_id, take_number),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict
);
-- At most one preferred Take per Shot, enforced by the database rather than the UI.
create unique index shot_takes_one_preferred on tonde.shot_takes(workspace_id, shot_id) where status = 'preferred';

-- 6. Field deviation: what was planned vs what actually happened on set.
create table tonde.shot_deviations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  shot_id uuid not null, plan_id uuid,
  field text not null check (field in ('camera','lens','movement','stabilization','camera_position','lighting',
    'sound','location','performance','product','duration','other')),
  planned_value text not null default '' check (length(planned_value) <= 600),
  actual_value text not null default '' check (length(actual_value) <= 600),
  reason text not null default '' check (length(reason) <= 600),
  recorded_at timestamptz not null default now(),
  carried boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict
);

-- 7. Row guards for the new tables: the shared mutation guard (identity immutability,
-- revision management, lock enforcement, approval invalidation) plus the field-level
-- validators the existing tables already receive.
do $$ declare item text; begin
  foreach item in array array['real_plan_requirements','real_plan_alternatives','shot_capture_state','shot_takes','shot_deviations'] loop
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', item);
  end loop;
end $$;

-- 8. RLS: identical membership/editor model as every other Production entity.
-- Enabling RLS is not optional: policies are inert without it.
do $$ declare item text; begin
  foreach item in array array['real_plan_requirements','real_plan_alternatives','shot_capture_state','shot_takes','shot_deviations'] loop
    execute format('alter table tonde.%I enable row level security', item);
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', item);
    execute format('create policy tenant_insert on tonde.%I for insert to authenticated with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('create policy tenant_update on tonde.%I for update to authenticated using (tonde_private.can_edit_workspace(workspace_id)) with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('grant select, insert, update on tonde.%I to authenticated', item);
  end loop;
end $$;
-- A Take is a log entry, so a genuinely mis-tapped Take may be removed by an editor.
create policy tenant_delete on tonde.shot_takes for delete to authenticated using (tonde_private.can_edit_workspace(workspace_id));
grant delete on tonde.shot_takes to authenticated;

-- 9. Shared helpers. Not user-facing: revoked from every role and reachable only
-- through the security-definer RPCs below.
create function tonde_private.json_text_array(source jsonb, key text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(source -> key, '[]'::jsonb))), '{}'::text[]);
$$;
create function tonde_private.json_text(source jsonb, key text, max_length integer) returns text
language sql immutable set search_path = '' as $$
  select left(coalesce(btrim(source ->> key), ''), max_length);
$$;
revoke all on function tonde_private.json_text_array(jsonb,text), tonde_private.json_text(jsonb,text,integer)
  from public, anon, authenticated, service_role;

-- Read-only Setup inventory projection: what the creator actually owns.
create function tonde_private.real_setup_inventory(target_workspace uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'resource_type', r.resource_type, 'name', r.name, 'manufacturer', r.manufacturer,
      'model', r.model, 'mount', r.mount, 'stabilization', r.stabilization, 'metadata', r.metadata)
      order by r.resource_type, r.name), '[]'::jsonb)
  from tonde.production_resources r
  where r.workspace_id = target_workspace and r.lifecycle = 'active';
$$;
revoke all on function tonde_private.real_setup_inventory(uuid) from public, anon, authenticated, service_role;

-- Deterministic readiness. Explicit requirement facts only; no arbitrary score.
create function tonde_private.real_readiness_state(target_workspace uuid, target_production uuid, target_shot uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from tonde.execution_plans p where p.workspace_id = target_workspace
      and p.production_id = target_production and p.shot_id = target_shot and p.execution_method = 'real') then 'unplanned'
    when exists (select 1 from tonde.execution_plans p where p.workspace_id = target_workspace
      and p.production_id = target_production and p.shot_id = target_shot and p.execution_method = 'real'
      and cardinality(p.safety_flags) > 0) then 'safety_blocked'
    when exists (select 1 from tonde.real_plan_requirements r join tonde.execution_plans p on p.id = r.plan_id
      where r.workspace_id = target_workspace and p.shot_id = target_shot and r.status = 'missing') then 'missing_resource'
    when exists (select 1 from tonde.real_plan_requirements r join tonde.execution_plans p on p.id = r.plan_id
      where r.workspace_id = target_workspace and p.shot_id = target_shot and r.status = 'unverified')
      or exists (select 1 from tonde.execution_plans p where p.workspace_id = target_workspace
        and p.production_id = target_production and p.shot_id = target_shot and p.execution_method = 'real'
        and p.plan_status = 'needs_decision') then 'needs_decision'
    when exists (select 1 from tonde.real_plan_requirements r join tonde.execution_plans p on p.id = r.plan_id
      where r.workspace_id = target_workspace and p.shot_id = target_shot and r.status = 'substitute') then 'ready_with_substitution'
    else 'ready'
  end;
$$;
revoke all on function tonde_private.real_readiness_state(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- One Shot's requirement rollup, used by the Scene and Production summaries.
create function tonde_private.real_requirement_rollup(target_workspace uuid, target_plan uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'owned', count(*) filter (where status = 'owned'),
    'substitute', count(*) filter (where status = 'substitute'),
    'missing', count(*) filter (where status = 'missing'),
    'unverified', count(*) filter (where status = 'unverified'))
  from tonde.real_plan_requirements where workspace_id = target_workspace and plan_id = target_plan;
$$;
revoke all on function tonde_private.real_requirement_rollup(uuid,uuid) from public, anon, authenticated, service_role;

-- The Real plan row for a Shot, as a stable JSON document.
-- jsonb_build_object is variadic but a call may not exceed 100 arguments, so the
-- document is assembled in two halves and concatenated.
create function tonde_private.real_plan_document(target_workspace uuid, target_production uuid, target_shot uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plan_id', p.id, 'shot_id', p.shot_id, 'execution_method', p.execution_method,
    'approval', p.approval, 'locked', p.locked_at is not null, 'revision', p.revision,
    'plan_status', p.plan_status, 'readiness_note', p.readiness_note,
    'complexity', p.complexity, 'complexity_is_estimate', p.complexity_is_estimate,
    'generated_by', p.generated_by, 'source_operation_id', p.source_operation_id,
    'camera_resource_id', p.camera_resource_id, 'lens_resource_id', p.lens_resource_id,
    'shot_size', p.shot_size, 'camera_position', p.camera_position, 'camera_height', p.camera_height,
    'camera_angle', p.camera_angle, 'framing', p.framing, 'composition', p.composition,
    'perspective_note', p.perspective_note,
    'movement', p.movement, 'movement_purpose', p.movement_purpose, 'stabilization', p.stabilization,
    'capture_fps', p.capture_fps, 'delivery_fps', p.delivery_fps, 'shutter', p.shutter,
    'aperture', p.aperture, 'iso_range', p.iso_range, 'white_balance', p.white_balance,
    'nd_filter', p.nd_filter, 'exposure_note', p.exposure_note,
    'focus_strategy', p.focus_strategy, 'depth_of_field', p.depth_of_field,
    'lighting_intent', p.lighting_intent, 'lighting_plan', p.lighting_plan) || jsonb_build_object(
    'lighting_diagram', p.lighting_diagram,
    'blocking', p.blocking, 'performance', p.performance, 'product_direction', p.product_direction,
    'sound_plan', p.sound_plan, 'microphone_plan', p.microphone_plan, 'sync_strategy', p.sync_strategy,
    'solo_feasibility', p.solo_feasibility, 'crew_roles', to_jsonb(p.crew_roles),
    'environment_requirements', to_jsonb(p.environment_requirements),
    'location_requirements', to_jsonb(p.location_requirements),
    'safety_notes', to_jsonb(p.safety_notes), 'safety_flags', to_jsonb(p.safety_flags),
    'editorial_intent', p.editorial_intent, 'setup_steps', to_jsonb(p.setup_steps),
    'capture_checklist', to_jsonb(p.capture_checklist), 'expected_duration_ms', p.expected_duration_ms,
    'updated_at', p.updated_at)
  from tonde.execution_plans p
  where p.workspace_id = target_workspace and p.production_id = target_production
    and p.shot_id = target_shot and p.execution_method = 'real';
$$;
revoke all on function tonde_private.real_plan_document(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- 10. Read model: the Real execution surface for a whole Production. One round trip
-- for the Studio REAL face, On-Set Mode and the readiness queue.
create function tonde.real_execution_surface(target_workspace uuid, target_production uuid,
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
    raise exception 'The Production changed since you loaded it' using errcode = '40001';
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

-- 11. One Shot's full Real plan, including Setup requirements and alternatives.
-- Progressive disclosure: the surface is compact, this is the detail.
create function tonde.real_shot_detail(target_workspace uuid, target_production uuid, target_shot uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare plan jsonb; payload jsonb;
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.id = target_shot) then
    raise exception 'Shot unavailable' using errcode = 'P0002';
  end if;
  plan := tonde_private.real_plan_document(target_workspace, target_production, target_shot);
  select jsonb_build_object(
    'shot', (select jsonb_build_object('shot_id', h.id, 'scene_id', h.scene_id, 'title', h.title,
        'purpose', h.purpose, 'subject', h.subject, 'framing', h.framing, 'movement', h.movement,
        'execution_method', h.execution_method, 'approval', h.approval, 'locked', h.locked_at is not null,
        'revision', h.revision, 'planned_duration_ms', h.planned_duration_ms, 'story_beat', h.story_beat,
        'creative_notes', h.creative_notes)
      from tonde.shots h where h.id = target_shot),
    'scene', (select jsonb_build_object('scene_id', s.id, 'title', s.title, 'order', s.sort_order,
        'purpose', s.purpose, 'description', s.description, 'environment_asset_id', s.environment_asset_id)
      from tonde.scenes s join tonde.shots h on h.scene_id = s.id where h.id = target_shot),
    'plan', plan,
    'readiness', tonde_private.real_readiness_state(target_workspace, target_production, target_shot),
    'requirements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'requirement_kind', r.requirement_kind, 'label', r.label, 'ideal_name', r.ideal_name,
        'detail', r.detail, 'setup_note', r.setup_note, 'alternative', r.alternative, 'status', r.status,
        'epistemic', r.epistemic, 'resource_type', r.resource_type, 'resource_id', r.resource_id,
        'substitute_resource_id', r.substitute_resource_id,
        'resource_name', (select pr.name from tonde.production_resources pr where pr.id = r.resource_id),
        'substitute_name', (select pr.name from tonde.production_resources pr where pr.id = r.substitute_resource_id))
        order by r.sort_order, r.label) from tonde.real_plan_requirements r
        where r.workspace_id = target_workspace and r.shot_id = target_shot), '[]'::jsonb),
    'alternatives', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'label', a.label, 'description', a.description,
        'expected_impact', a.expected_impact, 'tradeoffs', to_jsonb(a.tradeoffs)) order by a.sort_order, a.kind)
        from tonde.real_plan_alternatives a
        where a.workspace_id = target_workspace and a.shot_id = target_shot), '[]'::jsonb),
    'capture', (select jsonb_build_object('id', c.id, 'status', c.status, 'notes', c.notes,
        'captured_at', c.captured_at, 'revision', c.revision)
      from tonde.shot_capture_state c where c.workspace_id = target_workspace and c.shot_id = target_shot),
    'takes', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'take_number', t.take_number,
        'status', t.status, 'notes', t.notes, 'media_id', t.media_id, 'preferred', t.status = 'preferred',
        'recorded_at', t.recorded_at, 'revision', t.revision) order by t.take_number)
      from tonde.shot_takes t where t.workspace_id = target_workspace and t.shot_id = target_shot), '[]'::jsonb),
    'deviations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'field', d.field,
        'planned_value', d.planned_value, 'actual_value', d.actual_value, 'reason', d.reason,
        'recorded_at', d.recorded_at) order by d.recorded_at)
      from tonde.shot_deviations d where d.workspace_id = target_workspace and d.shot_id = target_shot), '[]'::jsonb),
    'setup', tonde_private.real_setup_inventory(target_workspace),
    -- The Brief and the first script line for this Shot, so the Real plan can honour
    -- the creative intent without re-deriving it.
    'brief', (select b.brief from tonde.director_briefs b where b.workspace_id = target_workspace
      and b.production_id = target_production),
    'script_line', (select jsonb_build_object('id', d.id, 'kind', d.line_type, 'content', d.content,
        'duration_ms', d.duration_ms, 'speaker_asset_id', d.speaker_asset_id)
      from tonde.dialogue_lines d where d.workspace_id = target_workspace and d.shot_id = target_shot
      order by d.sort_order, d.id limit 1)
  ) into payload;
  return payload;
end $$;

-- 12. Save a Real plan. Upsert the plan row, then replace its Setup requirements and
-- alternatives in the same transaction. Locks and approvals are enforced by the
-- existing guards, not re-implemented here.
create function tonde.save_real_plan(target_workspace uuid, target_production uuid, target_shot uuid,
  expected_shot_revision integer, plan jsonb, requirements jsonb default '[]'::jsonb,
  alternatives jsonb default '[]'::jsonb, operation_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.execution_plans; item jsonb; shot_duration bigint; plan_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', expected_shot_revision);
  if plan is null or jsonb_typeof(plan) <> 'object' then
    raise exception 'A Real plan must be a JSON object' using errcode = '22023';
  end if;

  insert into tonde.execution_plans(workspace_id, production_id, shot_id, execution_method,
    camera_resource_id, lens_resource_id, plan_status, readiness_note, complexity, complexity_is_estimate,
    generated_by, source_operation_id,
    shot_size, camera_position, camera_height, camera_angle, framing, composition, perspective_note,
    movement, movement_purpose, stabilization,
    capture_fps, delivery_fps, shutter, aperture, iso_range, white_balance, nd_filter, exposure_note,
    focus_strategy, depth_of_field,
    lighting_intent, lighting_plan, lighting_diagram, blocking, performance, product_direction,
    sound_plan, microphone_plan, sync_strategy,
    solo_feasibility, crew_roles, environment_requirements, location_requirements,
    safety_notes, safety_flags, editorial_intent, setup_steps, capture_checklist, expected_duration_ms)
  values (target_workspace, target_production, target_shot, 'real',
    nullif(plan->>'camera_resource_id','')::uuid, nullif(plan->>'lens_resource_id','')::uuid,
    coalesce(nullif(plan->>'plan_status',''), 'draft'),
    tonde_private.json_text(plan, 'readiness_note', 600),
    nullif(plan->>'complexity',''),
    coalesce((plan->>'complexity_is_estimate')::boolean, true),
    coalesce(nullif(plan->>'generated_by',''), 'deterministic'), operation_id,
    tonde_private.json_text(plan,'shot_size',80), tonde_private.json_text(plan,'camera_position',400),
    tonde_private.json_text(plan,'camera_height',200), tonde_private.json_text(plan,'camera_angle',200),
    tonde_private.json_text(plan,'framing',300), tonde_private.json_text(plan,'composition',400),
    tonde_private.json_text(plan,'perspective_note',600),
    tonde_private.json_text(plan,'movement',200), tonde_private.json_text(plan,'movement_purpose',600),
    tonde_private.json_text(plan,'stabilization',200),
    tonde_private.json_text(plan,'capture_fps',80), tonde_private.json_text(plan,'delivery_fps',80),
    tonde_private.json_text(plan,'shutter',120), tonde_private.json_text(plan,'aperture',120),
    tonde_private.json_text(plan,'iso_range',120), tonde_private.json_text(plan,'white_balance',160),
    tonde_private.json_text(plan,'nd_filter',200), tonde_private.json_text(plan,'exposure_note',600),
    tonde_private.json_text(plan,'focus_strategy',600), tonde_private.json_text(plan,'depth_of_field',400),
    tonde_private.json_text(plan,'lighting_intent',400), tonde_private.json_text(plan,'lighting_plan',2000),
    coalesce(plan->'lighting_diagram', '{}'::jsonb), tonde_private.json_text(plan,'blocking',2000),
    tonde_private.json_text(plan,'performance',2000), tonde_private.json_text(plan,'product_direction',1200),
    tonde_private.json_text(plan,'sound_plan',2000), tonde_private.json_text(plan,'microphone_plan',1200),
    tonde_private.json_text(plan,'sync_strategy',600),
    nullif(plan->>'solo_feasibility',''), tonde_private.json_text_array(plan,'crew_roles'),
    tonde_private.json_text_array(plan,'environment_requirements'),
    tonde_private.json_text_array(plan,'location_requirements'),
    tonde_private.json_text_array(plan,'safety_notes'), tonde_private.json_text_array(plan,'safety_flags'),
    tonde_private.json_text(plan,'editorial_intent',300), tonde_private.json_text_array(plan,'setup_steps'),
    tonde_private.json_text_array(plan,'capture_checklist'),
    nullif(plan->>'expected_duration_ms','')::bigint)
  on conflict (shot_id, execution_method) do update set
    camera_resource_id = excluded.camera_resource_id, lens_resource_id = excluded.lens_resource_id,
    plan_status = excluded.plan_status, readiness_note = excluded.readiness_note,
    complexity = excluded.complexity, complexity_is_estimate = excluded.complexity_is_estimate,
    generated_by = excluded.generated_by,
    source_operation_id = coalesce(excluded.source_operation_id, tonde.execution_plans.source_operation_id),
    shot_size = excluded.shot_size, camera_position = excluded.camera_position,
    camera_height = excluded.camera_height, camera_angle = excluded.camera_angle,
    framing = excluded.framing, composition = excluded.composition, perspective_note = excluded.perspective_note,
    movement = excluded.movement, movement_purpose = excluded.movement_purpose,
    stabilization = excluded.stabilization,
    capture_fps = excluded.capture_fps, delivery_fps = excluded.delivery_fps, shutter = excluded.shutter,
    aperture = excluded.aperture, iso_range = excluded.iso_range, white_balance = excluded.white_balance,
    nd_filter = excluded.nd_filter, exposure_note = excluded.exposure_note,
    focus_strategy = excluded.focus_strategy, depth_of_field = excluded.depth_of_field,
    lighting_intent = excluded.lighting_intent, lighting_plan = excluded.lighting_plan,
    lighting_diagram = excluded.lighting_diagram, blocking = excluded.blocking,
    performance = excluded.performance, product_direction = excluded.product_direction,
    sound_plan = excluded.sound_plan, microphone_plan = excluded.microphone_plan,
    sync_strategy = excluded.sync_strategy, solo_feasibility = excluded.solo_feasibility,
    crew_roles = excluded.crew_roles, environment_requirements = excluded.environment_requirements,
    location_requirements = excluded.location_requirements, safety_notes = excluded.safety_notes,
    safety_flags = excluded.safety_flags, editorial_intent = excluded.editorial_intent,
    setup_steps = excluded.setup_steps, capture_checklist = excluded.capture_checklist,
    expected_duration_ms = excluded.expected_duration_ms
  returning * into saved;

  delete from tonde.real_plan_requirements where workspace_id = target_workspace and plan_id = saved.id;
  for item in select * from jsonb_array_elements(coalesce(requirements, '[]'::jsonb)) loop
    insert into tonde.real_plan_requirements(workspace_id, production_id, shot_id, plan_id,
      requirement_kind, label, ideal_name, detail, setup_note, alternative, status, epistemic,
      resource_type, resource_id, substitute_resource_id, sort_order)
    values (target_workspace, target_production, target_shot, saved.id,
      (item->>'kind')::tonde.requirement_kind, left(btrim(coalesce(item->>'label','')), 160),
      tonde_private.json_text(item,'ideal_name',200), tonde_private.json_text(item,'detail',1200),
      tonde_private.json_text(item,'setup_note',600), tonde_private.json_text(item,'alternative',600),
      (item->>'status')::tonde.requirement_status,
      coalesce(nullif(item->>'epistemic',''), 'REQUIRED')::tonde.epistemic,
      nullif(item->>'resource_type','')::tonde.resource_type,
      nullif(item->>'resource_id','')::uuid, nullif(item->>'substitute_resource_id','')::uuid,
      coalesce((item->>'sort_order')::integer, 0));
  end loop;

  delete from tonde.real_plan_alternatives where workspace_id = target_workspace and plan_id = saved.id;
  for item in select * from jsonb_array_elements(coalesce(alternatives, '[]'::jsonb)) loop
    insert into tonde.real_plan_alternatives(workspace_id, production_id, shot_id, plan_id, kind, label,
      description, expected_impact, tradeoffs, sort_order)
    values (target_workspace, target_production, target_shot, saved.id,
      (item->>'kind')::tonde.alternative_kind, left(btrim(coalesce(item->>'label','')), 160),
      tonde_private.json_text(item,'description',1200), tonde_private.json_text(item,'expected_impact',600),
      tonde_private.json_text_array(item,'tradeoffs'), coalesce((item->>'sort_order')::integer, 0));
  end loop;

  -- §123: a Real plan may change how long the Shot actually takes. The Shot keeps
  -- timing authority, so the plan writes the Shot's planned duration and returns the
  -- recomputed runtime rather than storing a second, competing duration.
  shot_duration := nullif(plan->>'expected_duration_ms','')::bigint;
  if shot_duration is not null then
    update tonde.shots set planned_duration_ms = shot_duration
      where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  end if;

  select revision into plan_revision from tonde.execution_plans where id = saved.id;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'plan_revision', plan_revision,
    'approval', (select approval from tonde.execution_plans where id = saved.id),
    'plan_status', saved.plan_status,
    'readiness', tonde_private.real_readiness_state(target_workspace, target_production, target_shot),
    'requirements', (select count(*) from tonde.real_plan_requirements where plan_id = saved.id),
    'alternatives', (select count(*) from tonde.real_plan_alternatives where plan_id = saved.id),
    'timing', tonde_private.studio_timing(target_workspace, target_production));
end $$;

-- 13. Plan approval and locks. Approval requires a creator decision and an unchanged
-- version, which the existing human-acceptance guard enforces.
create function tonde.set_real_plan_approval(target_workspace uuid, target_production uuid, target_shot uuid,
  desired_approval text, expected_shot_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_plan tonde.execution_plans; saved tonde.execution_plans;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', expected_shot_revision);
  if desired_approval not in ('draft','needs_review','approved') then
    raise exception 'Unsupported approval state' using errcode = '22023';
  end if;
  select * into target_plan from tonde.execution_plans where workspace_id = target_workspace
    and production_id = target_production and shot_id = target_shot and execution_method = 'real';
  if not found then raise exception 'This Shot has no Real plan to approve' using errcode = 'P0002'; end if;
  if target_plan.locked_at is not null then
    raise exception 'That plan is locked. Unlock it before changing approval.' using errcode = '23514';
  end if;
  update tonde.execution_plans set approval = desired_approval::tonde.approval where id = target_plan.id
    returning * into saved;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'approval', saved.approval,
    'revision', saved.revision);
end $$;

create function tonde.set_real_plan_lock(target_workspace uuid, target_production uuid, target_shot uuid,
  locked boolean, expected_shot_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.execution_plans;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', expected_shot_revision);
  update tonde.execution_plans set locked_at = case when locked then now() else null end
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'real'
    returning * into saved;
  if saved is null then raise exception 'This Shot has no Real plan to lock' using errcode = 'P0002'; end if;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'locked', saved.locked_at is not null,
    'revision', saved.revision);
end $$;

-- 14. Capture state. Marking a Shot captured never approves it.
create function tonde.set_shot_capture_state(target_workspace uuid, target_production uuid, target_shot uuid,
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
    raise exception 'The capture state changed since you loaded it' using errcode = '40001';
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

-- 15. Take logging. Preferred is exclusive per Shot, enforced by index and upheld here.
create function tonde.save_shot_take(target_workspace uuid, target_production uuid, target_shot uuid,
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
      raise exception 'That Take changed since you loaded it' using errcode = '40001';
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

create function tonde.delete_shot_take(target_workspace uuid, target_production uuid, target_shot uuid, target_take uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare removed tonde.shot_takes;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', null);
  delete from tonde.shot_takes where workspace_id = target_workspace and production_id = target_production
    and shot_id = target_shot and id = target_take returning * into removed;
  if removed is null then raise exception 'That Take is unavailable' using errcode = 'P0002'; end if;
  return jsonb_build_object('take_id', removed.id, 'shot_id', target_shot, 'take_number', removed.take_number);
end $$;

-- 16. Field deviations: the original plan is never destroyed by recording what
-- actually happened on set.
create function tonde.record_shot_deviation(target_workspace uuid, target_production uuid, target_shot uuid,
  deviation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.shot_deviations; target_plan uuid;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', null);
  if deviation is null or jsonb_typeof(deviation) <> 'object' then
    raise exception 'A deviation must be a JSON object' using errcode = '22023';
  end if;
  if coalesce(deviation->>'field','') not in ('camera','lens','movement','stabilization','camera_position',
    'lighting','sound','location','performance','product','duration','other') then
    raise exception 'Unsupported deviation field' using errcode = '22023';
  end if;
  select id into target_plan from tonde.execution_plans where workspace_id = target_workspace
    and production_id = target_production and shot_id = target_shot and execution_method = 'real';
  insert into tonde.shot_deviations(workspace_id, production_id, shot_id, plan_id, field, planned_value,
    actual_value, reason)
  values (target_workspace, target_production, target_shot, target_plan, deviation->>'field',
    tonde_private.json_text(deviation,'planned_value',600), tonde_private.json_text(deviation,'actual_value',600),
    tonde_private.json_text(deviation,'reason',600))
  returning * into saved;
  return jsonb_build_object('deviation_id', saved.id, 'shot_id', target_shot, 'field', saved.field,
    'planned_value', saved.planned_value, 'actual_value', saved.actual_value, 'recorded_at', saved.recorded_at);
end $$;

-- 17. Privileges: authenticated only, never anon or service_role. Private helpers
-- stay unreachable from the API.
revoke all on function tonde.real_execution_surface(uuid,uuid,integer),
  tonde.real_shot_detail(uuid,uuid,uuid),
  tonde.save_real_plan(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,uuid),
  tonde.set_real_plan_approval(uuid,uuid,uuid,text,integer),
  tonde.set_real_plan_lock(uuid,uuid,uuid,boolean,integer),
  tonde.set_shot_capture_state(uuid,uuid,uuid,text,text,integer),
  tonde.save_shot_take(uuid,uuid,uuid,jsonb,integer),
  tonde.delete_shot_take(uuid,uuid,uuid,uuid),
  tonde.record_shot_deviation(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.real_execution_surface(uuid,uuid,integer),
  tonde.real_shot_detail(uuid,uuid,uuid),
  tonde.save_real_plan(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,uuid),
  tonde.set_real_plan_approval(uuid,uuid,uuid,text,integer),
  tonde.set_real_plan_lock(uuid,uuid,uuid,boolean,integer),
  tonde.set_shot_capture_state(uuid,uuid,uuid,text,text,integer),
  tonde.save_shot_take(uuid,uuid,uuid,jsonb,integer),
  tonde.delete_shot_take(uuid,uuid,uuid,uuid),
  tonde.record_shot_deviation(uuid,uuid,uuid,jsonb)
  to authenticated;
commit;
