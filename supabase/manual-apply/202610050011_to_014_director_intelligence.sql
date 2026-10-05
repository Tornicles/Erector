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
begin;

-- Scene-level creative detail. Canonical Scenes stay the single Scene model.
alter table tonde.scenes add column story_beat text not null default '' check (length(story_beat) <= 200);
alter table tonde.scenes add column opening_state text not null default '' check (length(opening_state) <= 400);
alter table tonde.scenes add column ending_state text not null default '' check (length(ending_state) <= 400);
alter table tonde.scenes add column visual_intent text not null default '' check (length(visual_intent) <= 900);
alter table tonde.scenes add column dialogue_notes text not null default '' check (length(dialogue_notes) <= 900);
alter table tonde.scenes add column action_lines jsonb not null default '[]' check (jsonb_typeof(action_lines) = 'array' and jsonb_array_length(action_lines) <= 16);
alter table tonde.scenes add column scene_detail jsonb not null default '{}' check (jsonb_typeof(scene_detail) = 'object' and pg_column_size(scene_detail) <= 40000);
alter table tonde.scenes add column source_operation_id uuid;

-- Dialogue lines keep first-class delivery direction, not only the spoken text.
alter table tonde.dialogue_lines add column intention text not null default '' check (length(intention) <= 300);
alter table tonde.dialogue_lines add column delivery text not null default '' check (length(delivery) <= 300);
alter table tonde.dialogue_lines add column subtext text not null default '' check (length(subtext) <= 300);
alter table tonde.dialogue_lines add column pause_after_ms bigint not null default 0 check (pause_after_ms between 0 and 60000);
alter table tonde.dialogue_lines add column line_flags jsonb not null default '{}' check (jsonb_typeof(line_flags) = 'object');

-- Every Director operation carries the full operation contract and its provenance.
create table tonde.director_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  operation_id uuid not null,
  operation_type text not null check (operation_type in (
    'intent_interpretation','brief_generation','question_planning','reference_preprocessing','reference_analysis',
    'transcription','technique_extraction','style_extraction','story_generation','story_alternative','script_generation',
    'dialogue_operation','domain_content_generation','scene_generation','runtime_validation','reality_check',
    'production_plan','apply_production_plan','director_command','causal_explanation','reference_role_assignment'
  )),
  scope text not null default 'production' check (scope in ('production','brief','reference','story','script','dialogue','scene','reality')),
  schema_version text not null default 'tonde.director.1' check (length(schema_version) between 1 and 40),
  source_revision integer not null check (source_revision > 0),
  source_intake_revision integer check (source_intake_revision is null or source_intake_revision > 0),
  status text not null default 'queued' check (status in ('queued','preprocessing','analyzing','synthesizing','succeeded','partial','failed','cancelled')),
  producer text not null default 'deterministic' check (producer in ('deterministic','model','domain')),
  provider text check (provider is null or length(provider) <= 80),
  model text check (model is null or length(model) <= 120),
  model_profile text not null default 'default' check (length(model_profile) <= 120),
  attempts integer not null default 0 check (attempts between 0 and 10),
  repaired boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  collaboration_mode text not null default 'stop_at_major_decisions'
    check (collaboration_mode in ('guide_step_by_step','stop_at_major_decisions','complete_first_draft')),
  reference_ids uuid[] not null default '{}',
  constraint_summary jsonb not null default '{}' check (jsonb_typeof(constraint_summary) = 'object'),
  rationale text not null default '' check (length(rationale) <= 1200),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array' and jsonb_array_length(limitations) <= 12),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 400000),
  payload_hash text check (payload_hash is null or length(payload_hash) = 32),
  error_code text check (error_code is null or length(error_code) <= 80),
  error_message text check (error_message is null or length(error_message) <= 600),
  started_at timestamptz, completed_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, operation_id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);
create index director_operations_recent on tonde.director_operations(workspace_id, production_id, created_at desc);
create index director_operations_status on tonde.director_operations(workspace_id, status, updated_at desc);

-- One current structured Brief per Production, versioned by revision.
create table tonde.director_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  brief jsonb not null check (jsonb_typeof(brief) = 'object' and pg_column_size(brief) <= 200000),
  producer text not null default 'deterministic' check (producer in ('deterministic','model')),
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, production_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);

-- Answered decisions are persisted so the Director never re-asks a settled question.
create table tonde.director_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  decision_id text not null check (length(decision_id) between 1 and 80),
  question text not null default '' check (length(question) <= 400),
  answer text not null default '' check (length(answer) <= 500),
  priority text not null default 'high_impact' check (priority in ('blocking','high_impact','optional')),
  impact text not null default 'high' check (impact in ('critical','high','medium','low')),
  decided_by text not null default 'creator' check (decided_by in ('creator','tonde')),
  decision_source text not null default 'intake' check (decision_source in ('intake','studio','correction','tonde_default')),
  is_correction boolean not null default false,
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (production_id, decision_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);
create index director_decisions_production on tonde.director_decisions(workspace_id, production_id, priority);

-- Reference capability, staged progress and analysis output.
create table tonde.reference_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  reference_id uuid not null,
  role text not null default 'style' check (role in ('camera','lighting','pacing','character','product','color','edit','sound','style','story','composition','environment')),
  capability text not null default 'metadata_only'
    check (capability in ('full_media_available','partial_media_available','metadata_only','text_only','unavailable')),
  status text not null default 'not_started'
    check (status in ('not_started','queued','preprocessing','analyzing','synthesizing','complete','partial','failed')),
  stages text[] not null default '{}',
  progress integer not null default 0 check (progress between 0 and 100),
  summary text not null default '' check (length(summary) <= 1600),
  capabilities jsonb not null default '{}' check (jsonb_typeof(capabilities) = 'object'),
  style jsonb not null default '{}' check (jsonb_typeof(style) = 'object'),
  causal jsonb not null default '[]' check (jsonb_typeof(causal) = 'array'),
  adaptation_notes jsonb not null default '[]' check (jsonb_typeof(adaptation_notes) = 'array'),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),
  media_metadata jsonb not null default '{}' check (jsonb_typeof(media_metadata) = 'object'),
  producer text not null default 'deterministic' check (producer in ('deterministic','model')),
  model_profile text not null default 'default' check (length(model_profile) <= 120),
  producer_note text not null default '' check (length(producer_note) <= 600),
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reference_id) references tonde.production_references(workspace_id, id) on delete restrict
);
create index reference_analyses_status on tonde.reference_analyses(workspace_id, production_id, status);

create table tonde.reference_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  analysis_id uuid not null,
  finding_id text not null check (length(finding_id) between 1 and 120),
  category text not null check (category in ('camera','composition','lighting','blocking','performance','product','edit','transition','sound','color','story','typography','text','music','dialogue','voice','pacing','environment')),
  statement text not null check (length(statement) between 1 and 1200),
  epistemic text not null check (epistemic in ('observed','estimated','recommended','unknown')),
  confidence text not null check (confidence in ('high','medium','low')),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 8),
  technique_id text check (technique_id is null or length(technique_id) <= 120),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),
  sort_order bigint not null default 1024 check (sort_order >= 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (analysis_id, finding_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, analysis_id) references tonde.reference_analyses(workspace_id, id) on delete restrict,
  constraint observed_findings_cite_evidence check (epistemic <> 'observed' or jsonb_array_length(evidence) > 0 or category = 'story')
);
create index reference_findings_analysis on tonde.reference_findings(workspace_id, analysis_id, sort_order);

-- Reusable technique catalogue: workspace-scoped, never a copy of one reference.
create table tonde.creative_techniques (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  canonical_id text not null check (canonical_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(canonical_id) between 3 and 120),
  name text not null check (length(name) between 1 and 160),
  category text not null check (category in ('camera','composition','lighting','blocking','performance','product','edit','transition','sound','color','story','typography')),
  description text not null check (length(description) between 1 and 1200),
  purpose text not null check (length(purpose) between 1 and 600),
  effect text not null check (length(effect) between 1 and 600),
  conditions jsonb not null default '[]' check (jsonb_typeof(conditions) = 'array'),
  practical_concept text not null default '' check (length(practical_concept) <= 900),
  ai_concept text not null default '' check (length(ai_concept) <= 900),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),
  importance text not null default 'supporting' check (importance in ('essential','supporting','optional')),
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  technique_source text not null default 'reference' check (technique_source in ('reference','creator','story','style')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, canonical_id)
);
create index creative_techniques_category on tonde.creative_techniques(workspace_id, category, importance);

create table tonde.reference_technique_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  analysis_id uuid not null,
  technique_id uuid not null,
  reference_id uuid not null,
  importance text not null default 'supporting' check (importance in ('essential','supporting','optional')),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 8),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (analysis_id, technique_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, analysis_id) references tonde.reference_analyses(workspace_id, id) on delete restrict,
  foreign key (workspace_id, technique_id) references tonde.creative_techniques(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reference_id) references tonde.production_references(workspace_id, id) on delete restrict
);

-- The selected Story for a Production. Alternatives never overwrite it.
create table tonde.creative_stories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  story jsonb not null check (jsonb_typeof(story) = 'object' and pg_column_size(story) <= 200000),
  variation text not null default 'original' check (length(variation) <= 60),
  producer text not null default 'deterministic' check (producer in ('deterministic','model')),
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, production_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);

-- Reality Check result against the creator's real Setup.
create table tonde.director_reality_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  report jsonb not null check (jsonb_typeof(report) = 'object' and pg_column_size(report) <= 200000),
  feasibility text not null default 'ready' check (feasibility in ('ready','adapt','blocked')),
  complexity text not null default 'simple' check (complexity in ('simple','moderate','complex')),
  recommended_mode text not null default 'real' check (recommended_mode in ('real','ai','hybrid')),
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, production_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);

-- RLS: clients read their own workspace rows; every write goes through a guarded RPC.
alter table tonde.director_operations enable row level security;
alter table tonde.director_briefs enable row level security;
alter table tonde.director_decisions enable row level security;
alter table tonde.reference_analyses enable row level security;
alter table tonde.reference_findings enable row level security;
alter table tonde.creative_techniques enable row level security;
alter table tonde.reference_technique_links enable row level security;
alter table tonde.creative_stories enable row level security;
alter table tonde.director_reality_checks enable row level security;

do $$ declare table_name text; begin
  foreach table_name in array array['director_operations','director_briefs','director_decisions','reference_analyses',
    'reference_findings','creative_techniques','reference_technique_links','creative_stories','director_reality_checks'] loop
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', table_name);
    execute format('grant select on tonde.%I to authenticated', table_name);
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', table_name);
  end loop;
end $$;

-- One authorization gate for every Director write path.
create function tonde_private.director_guard(target_workspace uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (select auth.role()) <> 'authenticated' or not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Authenticated workspace editor required' using errcode = '42501';
  end if;
end;
$$;

-- 1. AI operation ledger: idempotent claim and completion of one Director operation.
create function tonde.record_director_operation(
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
  select * into existing from tonde.director_operations
    where workspace_id = target_workspace and operation_id = (operation_record->>'operation_id')::uuid for update;
  if found then
    if existing.idempotency_key <> operation_record->>'idempotency_key' then
      raise exception 'An operation id cannot be reused with a different idempotency key' using errcode = '23505';
    end if;
    if existing.status in ('succeeded','partial') and existing.payload_hash is not null
      and operation_record->>'payload_hash' is not null and existing.payload_hash <> operation_record->>'payload_hash' then
      raise exception 'A completed operation cannot be rewritten with different content' using errcode = '23505';
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

-- 2. Structured Brief version with optimistic revision.
create function tonde.save_director_brief(
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
      raise exception 'The Brief changed; reload before saving' using errcode = '40001';
    end if;
    update tonde.director_briefs set brief = brief_content, producer = producer_kind,
      source_operation_id = coalesce(source_operation, source_operation_id)
      where id = existing.id returning * into saved;
  else
    if expected_brief_revision is not null then
      raise exception 'The Brief changed; reload before saving' using errcode = '40001';
    end if;
    insert into tonde.director_briefs(workspace_id, production_id, brief, producer, source_operation_id)
      values(target_workspace, target_production, brief_content, producer_kind, source_operation) returning * into saved;
  end if;
  return jsonb_build_object('id', saved.id, 'revision', saved.revision, 'producer', saved.producer);
end;
$$;

-- 3. Decision ledger: settled decisions are recorded once and re-used, never re-asked.
create function tonde.record_director_decisions(
  target_workspace uuid, target_production uuid, decision_list jsonb, decision_source text default 'studio'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item jsonb; stored integer := 0;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(decision_list) <> 'array' or jsonb_array_length(decision_list) > 40 then
    raise exception 'Invalid decision list' using errcode = '22023';
  end if;
  if decision_source not in ('intake','studio','correction','tonde_default') then
    raise exception 'Unsupported decision source' using errcode = '22023';
  end if;
  if not exists(select 1 from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production) then
    raise exception 'Production unavailable' using errcode = 'P0002';
  end if;
  for item in select value from jsonb_array_elements(decision_list) loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'decision_id')), 0) = 0
      or length(item->>'decision_id') > 80 or length(coalesce(item->>'answer','')) > 500 then
      raise exception 'Invalid decision' using errcode = '22023';
    end if;
    insert into tonde.director_decisions as d (workspace_id, production_id, decision_id, question, answer, priority, impact, decided_by, decision_source, is_correction)
      values (target_workspace, target_production, item->>'decision_id', coalesce(item->>'question',''), coalesce(item->>'answer',''),
        coalesce(item->>'priority','high_impact'), coalesce(item->>'impact','high'),
        case when item->>'answer' = 'TONDE decides' then 'tonde' else coalesce(item->>'decided_by','creator') end,
        decision_source, coalesce((item->>'is_correction')::boolean, false))
      on conflict (production_id, decision_id) do update set
        answer = excluded.answer,
        question = case when excluded.question = '' then d.question else excluded.question end,
        priority = excluded.priority,
        impact = excluded.impact,
        decided_by = excluded.decided_by,
        decision_source = excluded.decision_source,
        is_correction = excluded.is_correction or d.is_correction;
    stored := stored + 1;
  end loop;
  return jsonb_build_object('stored', stored, 'decision_source', decision_source);
end;
$$;

revoke all on function tonde_private.director_guard(uuid) from public, anon, authenticated;
revoke all on function tonde.record_director_operation(uuid,uuid,jsonb),
  tonde.save_director_brief(uuid,uuid,integer,jsonb,uuid,text),
  tonde.record_director_decisions(uuid,uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function tonde.record_director_operation(uuid,uuid,jsonb),
  tonde.save_director_brief(uuid,uuid,integer,jsonb,uuid,text),
  tonde.record_director_decisions(uuid,uuid,jsonb,text) to authenticated;
commit;

-- Additive migration: Prompt 4 Director intelligence persistence.
-- Never rewrites an applied migration. Migrations 009/010 were applied manually by
-- the creator; this migration is additive only and does not touch them.

-- ---------------------------------------------------------------------------
-- 202610050012_202610050012_director_intelligence
-- Director intelligence: director_operations, director_briefs, director_decisions, reference_analyses, reference_findings, creative_techniques, reference_technique_links, creative_stories, director_reality_checks, plus tonde_private.director_guard and the record/save RPCs.
--
-- Run this file ONCE, after everything that precedes it in supabase/manual-apply/README.md.
-- It is intentionally not idempotent: running it twice fails with "already exists",
-- which means it was already applied, not that the file is broken.
-- ---------------------------------------------------------------------------
begin;

-- 4. Reference analysis: capability, staged status, findings and technique links.
create function tonde.save_reference_analysis(
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

-- 5. Staged progress for long media work without touching finished findings.
create function tonde.claim_reference_analysis(
  target_workspace uuid, target_production uuid, target_reference uuid, stage_status text,
  stage_list text[] default '{}', progress_pct integer default 0, producer_note text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved tonde.reference_analyses; reference_state text;
begin
  perform tonde_private.director_guard(target_workspace);
  if stage_status not in ('queued','preprocessing','analyzing','synthesizing','partial','failed','cancelled') then
    raise exception 'Unsupported analysis stage status' using errcode = '22023';
  end if;
  if not exists(select 1 from tonde.production_references r where r.workspace_id = target_workspace
    and r.production_id = target_production and r.id = target_reference) then
    raise exception 'Reference unavailable in this Production' using errcode = 'P0002';
  end if;
  insert into tonde.reference_analyses as ra (workspace_id, production_id, reference_id, status, stages, progress, producer_note)
  values (target_workspace, target_production, target_reference, stage_status, coalesce(stage_list, '{}'),
    greatest(0, least(100, coalesce(progress_pct, 0))), left(coalesce(producer_note,''),600))
  on conflict (workspace_id, reference_id) do update set
    status = excluded.status, stages = excluded.stages, progress = excluded.progress,
    producer_note = case when excluded.producer_note = '' then ra.producer_note else excluded.producer_note end
  returning * into saved;
  reference_state := case stage_status when 'failed' then 'failed' when 'partial' then 'partially_analyzed' else 'processing' end;
  update tonde.production_references set state = reference_state::tonde.reference_state where id = target_reference and workspace_id = target_workspace;
  return jsonb_build_object('analysis_id', saved.id, 'status', saved.status, 'progress', saved.progress, 'stages', saved.stages);
end;
$$;

-- Creative domain content becomes canonical Assets and scope bindings, never a second entity model.
create function tonde_private.director_apply_assets(
  target_workspace uuid, target_production uuid, operation_id uuid, bundle jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
-- The block is labelled so the asset_id variable can be qualified against the
-- asset_id column of scope_bindings inside the existence checks below.
<<assets>>
declare item jsonb; asset_id uuid; binding text; asset_kind tonde.asset_type;
  environment_ids jsonb := '{}'::jsonb;
  character_ids jsonb := '{}'::jsonb;
  scene_row record; character_name text; environment_name text;
  characters integer := 0; environments integer := 0; products integer := 0; wardrobe integer := 0;
begin
  for item in select value from jsonb_array_elements(coalesce(bundle->'characters','[]'::jsonb)) loop
    characters := characters + 1;
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = 'character'
      and name = left(item->>'name',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, 'character', left(item->>'name',160), left(coalesce(item->>'story_function',''),10000),
        jsonb_build_object('role', item->>'role', 'story_function', item->>'story_function', 'objective', item->>'objective',
          'visual_description', item->>'visual_description', 'performance_direction', item->>'performance_direction',
          'relationships', coalesce(item->'relationships','[]'::jsonb), 'recurring', coalesce((item->>'recurring')::boolean, false)),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set metadata = jsonb_build_object('role', item->>'role', 'story_function', item->>'story_function',
          'objective', item->>'objective', 'visual_description', item->>'visual_description',
          'performance_direction', item->>'performance_direction', 'relationships', coalesce(item->'relationships','[]'::jsonb),
          'recurring', coalesce((item->>'recurring')::boolean, false)),
        provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    character_ids := character_ids || jsonb_build_object(lower(left(item->>'name',160)), asset_id::text);
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = 'character' and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, 'character', 'inherit');
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(bundle->'environments','[]'::jsonb)) loop
    environments := environments + 1;
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = 'environment'
      and name = left(item->>'name',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, 'environment', left(item->>'name',160), left(coalesce(item->>'story_purpose',''),10000),
        jsonb_build_object('visual_requirements', coalesce(item->'visual_requirements','[]'::jsonb),
          'story_purpose', item->>'story_purpose', 'spatial_needs', coalesce(item->'spatial_needs','[]'::jsonb),
          'lighting_context', item->>'lighting_context', 'scene_usage', coalesce(item->'scene_usage','[]'::jsonb)),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set metadata = jsonb_build_object('visual_requirements', coalesce(item->'visual_requirements','[]'::jsonb),
          'story_purpose', item->>'story_purpose', 'spatial_needs', coalesce(item->'spatial_needs','[]'::jsonb),
          'lighting_context', item->>'lighting_context', 'scene_usage', coalesce(item->'scene_usage','[]'::jsonb)),
        provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    environment_ids := environment_ids || jsonb_build_object(lower(left(item->>'name',160)), asset_id::text);
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = 'world' and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, 'world', 'inherit');
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(bundle->'products','[]'::jsonb)) loop
    products := products + 1;
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = 'product'
      and name = left(item->>'name',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, 'product', left(item->>'name',160), left(coalesce(item->>'role',''),10000),
        jsonb_build_object('role', item->>'role', 'required_visibility', item->>'required_visibility',
          'hero_moments', coalesce(item->'hero_moments','[]'::jsonb), 'fidelity_importance', item->>'fidelity_importance',
          'interactions', coalesce(item->'interactions','[]'::jsonb), 'packaging_notes', coalesce(item->'packaging_notes','[]'::jsonb)),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set metadata = jsonb_build_object('role', item->>'role', 'required_visibility', item->>'required_visibility',
          'hero_moments', coalesce(item->'hero_moments','[]'::jsonb), 'fidelity_importance', item->>'fidelity_importance',
          'interactions', coalesce(item->'interactions','[]'::jsonb), 'packaging_notes', coalesce(item->'packaging_notes','[]'::jsonb)),
        provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = 'product' and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, 'product', 'inherit');
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(bundle->'wardrobe_props','[]'::jsonb)) loop
    wardrobe := wardrobe + 1;
    asset_kind := case when item->>'kind' = 'wardrobe' then 'wardrobe' else 'prop' end;
    binding := case when item->>'kind' = 'wardrobe' then 'wardrobe' else 'prop' end;
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = asset_kind
      and name = left(item->>'name',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, asset_kind, left(item->>'name',160), left(coalesce(item->>'requirement',''),10000),
        jsonb_build_object('requirement', item->>'requirement', 'scene_usage', coalesce(item->'scene_usage','[]'::jsonb),
          'content_source', coalesce(item->>'source','derived')),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set metadata = jsonb_build_object('requirement', item->>'requirement',
          'scene_usage', coalesce(item->'scene_usage','[]'::jsonb), 'content_source', coalesce(item->>'source','derived')),
        provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = binding::tonde.binding_role and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, binding::tonde.binding_role, 'inherit');
    end if;
  end loop;
  if jsonb_typeof(bundle->'style_bible') = 'object' and coalesce(length(btrim(bundle->'style_bible'->>'title')),0) > 0 then
    -- The Style Bible is deduplicated by name like every other creative Asset: re-applying a plan
    -- updates the existing Style record instead of accumulating a new one per operation.
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = 'style_bible'
      and name = left(bundle->'style_bible'->>'title',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, 'style_bible', left(bundle->'style_bible'->>'title',160),
        left(coalesce(bundle->'style_bible'->>'summary',''),10000),
        jsonb_build_object('sections', coalesce(bundle->'style_bible'->'sections','[]'::jsonb),
          'producer', coalesce(bundle->'style_bible'->>'producer','deterministic')),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set description = left(coalesce(bundle->'style_bible'->>'summary',''),10000),
          metadata = jsonb_build_object('sections', coalesce(bundle->'style_bible'->'sections','[]'::jsonb),
            'producer', coalesce(bundle->'style_bible'->>'producer','deterministic')),
          provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = 'style' and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, 'style', 'inherit');
    end if;
  end if;
  -- Link Scenes to their creative Environment and register on-camera participants.
  for scene_row in select id, sort_order, scene_detail from tonde.scenes
    where workspace_id = target_workspace and production_id = target_production and lifecycle = 'active' loop
    environment_name := lower(coalesce(scene_row.scene_detail->>'environment',''));
    if environment_name <> '' and environment_ids ? environment_name then
      update tonde.scenes set environment_asset_id = (environment_ids->>environment_name)::uuid where id = scene_row.id;
    end if;
    for character_name in select value from jsonb_array_elements_text(coalesce(scene_row.scene_detail->'characters','[]'::jsonb)) loop
      if character_ids ? lower(character_name)
        and not exists(select 1 from tonde.scene_participants sp
          where sp.scene_id = scene_row.id and sp.asset_id = (character_ids->>lower(character_name))::uuid) then
        insert into tonde.scene_participants(workspace_id, production_id, scene_id, asset_id, role)
          values (target_workspace, target_production, scene_row.id, (character_ids->>lower(character_name))::uuid, 'participant');
      end if;
    end loop;
  end loop;
  return jsonb_build_object('characters', characters, 'environments', environments, 'products', products, 'wardrobe_props', wardrobe,
    'character_assets', character_ids, 'environment_assets', environment_ids);
end;
$$;

revoke all on function tonde_private.director_apply_assets(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid),
  tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text) from public, anon, authenticated, service_role;
grant execute on function tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid),
  tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text) to authenticated;
commit;

-- Additive migration: Prompt 4 reference analysis persistence and atomic creative apply.

-- ---------------------------------------------------------------------------
-- 202610050013_202610050013_director_reference_and_apply
-- Reference analysis persistence and atomic creative apply: save_reference_analysis, claim_reference_analysis and tonde_private.director_apply_assets.
--
-- Run this file ONCE, after everything that precedes it in supabase/manual-apply/README.md.
-- It is intentionally not idempotent: running it twice fails with "already exists",
-- which means it was already applied, not that the file is broken.
-- ---------------------------------------------------------------------------
begin;

-- The operation parameter is named target_operation so it can never be ambiguous with the
-- director_operations.operation_id column inside the upsert and its conflict target.
create function tonde.apply_director_operation(
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
    raise exception 'Production changed; reload before applying this operation' using errcode = '40001';
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

revoke all on function tonde.apply_director_operation(uuid,uuid,integer,uuid,text,jsonb,boolean) from public, anon, authenticated, service_role;
grant execute on function tonde.apply_director_operation(uuid,uuid,integer,uuid,text,jsonb,boolean) to authenticated;
commit;

-- Additive migration: the atomic Director apply path for one creative bundle.

-- ---------------------------------------------------------------------------
-- 202610050014_202610050014_director_apply_operation
-- The atomic Director apply path: tonde.apply_director_operation.
--
-- Run this file ONCE, after everything that precedes it in supabase/manual-apply/README.md.
-- It is intentionally not idempotent: running it twice fails with "already exists",
-- which means it was already applied, not that the file is broken.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- TONDE Prompt 4 - Director Intelligence: hosted migrations 011 to 014
-- This file is the exact concatenation of 01, 02, 03 and 04 in this folder.
-- It is safe to paste as one script or to run with psql -f.
--
-- WHY THIS FILE STARTS WITH SQL AND NOT WITH A COMMENT
-- Some clipboard/editor paths drop the first character when pasting, which turned
-- a leading "-- ..." comment into "- ..." and failed with
-- "syntax error at or near \"-\"". Starting with "begin;" removes that failure mode.
--
-- PREREQUISITES
--   Migrations 001 through 010 are already applied to the hosted project.
--   Do NOT re-run 009 (202610050009_revoke_public_rls_admin.sql) or
--   010 (202610050010_hide_policy_helpers.sql): both were applied by hand already.
--   011-014 depend on tonde_private.is_workspace_member, tonde_private.can_edit_workspace
--   and tonde_private.guard_mutation, which migration 010 created.
--
-- HOW TO APPLY (choose ONE)
--   A. Supabase CLI, which records migration history for you (most reliable):
--        supabase link --project-ref <ref>
--        supabase db push
--   B. psql with the connection string from Dashboard > Project Settings > Database:
--        psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/manual-apply/01_202610050011_director_intake.sql
--        psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/manual-apply/02_202610050012_director_intelligence.sql
--        psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/manual-apply/03_202610050013_director_reference_and_apply.sql
--        psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/manual-apply/04_202610050014_director_apply_operation.sql
--        psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/manual-apply/05_verify.sql
--   C. Dashboard SQL Editor: paste this whole file once and Run, then run 05_verify.sql.
--      Each migration is self-contained (begin; ... commit;), so it runs as four
--      sequential transactions in the order written. Do not reorder statements.
--
-- IMPORTANT
--   * Run this bundle ONCE. Re-running fails with "already exists": that means it was
--     already applied, not that the file is broken.
--   * Applying it through the SQL Editor does NOT record it in
--     supabase_migrations.schema_migrations. If you then use the CLI, run the commented
--     INSERT below first, or the CLI will try to apply 011-014 a second time.
--
-- MIGRATION HISTORY (SQL Editor users who also use the CLI)
-- insert into supabase_migrations.schema_migrations (version, name) values
--   ('202610050011', 'director_intake'),
--   ('202610050012', 'director_intelligence'),
--   ('202610050013', 'director_reference_and_apply'),
--   ('202610050014', 'director_apply_operation')
-- on conflict (version) do nothing;
--
-- Source of truth: supabase/migrations/202610050011..014 (keep these files in sync).
-- =============================================================================

select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, n as name, to_regclass(n) is not null as present
  from unnest(array[
    'tonde.director_intakes', 'tonde.director_plan_proposals', 'tonde.director_operations',
    'tonde.director_briefs', 'tonde.director_decisions', 'tonde.reference_analyses',
    'tonde.reference_findings', 'tonde.creative_techniques', 'tonde.reference_technique_links',
    'tonde.creative_stories', 'tonde.director_reality_checks']) as n
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.save_director_intake(uuid,uuid,integer,jsonb)',
    'tonde.save_director_plan_proposal(uuid,uuid,integer,integer,uuid,jsonb)',
    'tonde.apply_director_plan(uuid,uuid,integer,integer,uuid,boolean)',
    'tonde.record_director_operation(uuid,uuid,jsonb)',
    'tonde.save_director_brief(uuid,uuid,integer,jsonb,uuid,text)',
    'tonde.record_director_decisions(uuid,uuid,jsonb,text)',
    'tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)',
    'tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text)',
    'tonde.apply_director_operation(uuid,uuid,integer,uuid,text,jsonb,boolean)']) as s
  union all
  select 'pay_backend_private', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.director_guard(uuid)',
    'tonde_private.director_apply_assets(uuid,uuid,uuid,jsonb)']) as s
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means the matching file in this folder
-- did not apply: fix the reported error and re-run only that file.
