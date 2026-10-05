begin;

create table tonde.director_intakes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  collaboration_mode text not null default 'stop_at_major_decisions'
    check (collaboration_mode in ('guide_step_by_step','stop_at_major_decisions','complete_first_draft')),
  status text not null default 'intake'
    check (status in ('intake','draft_ready','ready_for_studio')),
  intent jsonb not null check (jsonb_typeof(intent) = 'object'),
  plan jsonb not null default '{}' check (jsonb_typeof(plan) = 'object'),
  applied_operation_id uuid,
  proposal_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, production_id),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);
create index director_intakes_status on tonde.director_intakes(workspace_id, status, updated_at desc);
alter table tonde.director_intakes enable row level security;
create policy director_intakes_read on tonde.director_intakes for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.director_intakes to authenticated;
create trigger guard_director_intake before insert or update on tonde.director_intakes
  for each row execute function tonde_private.guard_mutation();

create table tonde.director_plan_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  intake_id uuid not null,
  operation_id uuid not null,
  source_production_revision integer not null check (source_production_revision > 0),
  source_intake_revision integer not null check (source_intake_revision > 0),
  state text not null default 'proposed' check (state in ('proposed','applied','superseded')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  created_at timestamptz not null default now(),
  unique (workspace_id, operation_id),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, intake_id) references tonde.director_intakes(workspace_id, id) on delete restrict
);
create index director_plan_proposals_current on tonde.director_plan_proposals(workspace_id, production_id, created_at desc);
alter table tonde.director_plan_proposals enable row level security;
create policy director_plan_proposals_read on tonde.director_plan_proposals for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.director_plan_proposals to authenticated;

create function tonde.save_director_intake(
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
      raise exception 'Director intake changed; reload before saving' using errcode = '40001';
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
      raise exception 'Director intake changed; reload before saving' using errcode = '40001';
    end if;
    insert into tonde.director_intakes(workspace_id,production_id,intent,collaboration_mode)
      values(target_workspace,target_production,intake,intake->>'collaboration_mode') returning * into current_row;
  end if;
  return jsonb_build_object('id',current_row.id,'revision',current_row.revision,'status',current_row.status);
end;
$$;

create function tonde.save_director_plan_proposal(
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
    raise exception 'Production changed or is protected; reload before planning' using errcode = '40001';
  end if;
  select * into intake_row from tonde.director_intakes where workspace_id=target_workspace and production_id=target_production for update;
  if not found or intake_row.revision <> expected_intake_revision or intake_row.status='ready_for_studio' then
    raise exception 'Director intake changed; reload before planning' using errcode = '40001';
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

create function tonde.apply_director_plan(
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
    raise exception 'Production or Director intake changed; reload before applying this draft' using errcode = '40001';
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
    raise exception 'This plan proposal is stale or no longer current' using errcode = '40001';
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

grant usage on schema tonde_private to authenticated;
revoke all on function tonde.save_director_intake(uuid,uuid,integer,jsonb),
  tonde.save_director_plan_proposal(uuid,uuid,integer,integer,uuid,jsonb),
  tonde.apply_director_plan(uuid,uuid,integer,integer,uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function tonde.save_director_intake(uuid,uuid,integer,jsonb),
  tonde.save_director_plan_proposal(uuid,uuid,integer,integer,uuid,jsonb),  tonde.apply_director_plan(uuid,uuid,integer,integer,uuid,boolean)
 to authenticated;
commit;

-- ---------------------------------------------------------------------------
-- 202610050011_202610050011_director_intake
-- Director intake: tonde.director_intakes and tonde.director_plan_proposals plus save_director_intake, save_director_plan_proposal and apply_director_plan.
--
-- Run this file ONCE, after everything that precedes it in supabase/manual-apply/README.md.
-- It is intentionally not idempotent: running it twice fails with "already exists",
-- which means it was already applied, not that the file is broken.
-- ---------------------------------------------------------------------------
