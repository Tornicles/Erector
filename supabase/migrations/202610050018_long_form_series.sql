-- Additive migration: Prompt 8 long-form, Movie Mode, Series and Production Line.
-- Canonical hierarchy only: Production -> optional Act -> optional Sequence -> Scene -> Shot,
-- and Series -> optional Season/Collection -> Episode/Production.
-- No movie_scenes / series_scenes / episode_shots table exists or ever will: the same
-- canonical Scene and Shot are reused, and every derived number below is COMPUTED at read
-- time so no rollup silently overwrites a creator's planned runtime.
begin;

-- 1. Vocabulary. Storage codes are the generated product vocabulary keys.
create type tonde.series_kind as enum ('narrative','recurring');
create type tonde.planning_depth as enum
  ('idea','outlined','story_defined','scripted','scenes_planned','shots_planned','execution_planned','in_progress');
create type tonde.sequence_kind as enum
  ('narrative','mission','location','topic','montage','action','documentary','thematic','custom');
create type tonde.structure_level as enum ('production','act','sequence','scene','shot');
create type tonde.generate_horizon as enum ('tomorrow','next_7','next_14','next_30','entire_series','custom');
create type tonde.generate_depth as enum ('ideas_only','briefs','story','script','complete_plan');

-- 2. Act: narrative purpose. Acts group lower structure; they are not a second Production.
alter table tonde.acts add column purpose text not null default '' check (length(purpose) <= 1200);
alter table tonde.acts add column narrative_goal text not null default '' check (length(narrative_goal) <= 1200);
alter table tonde.acts add column opening_state text not null default '' check (length(opening_state) <= 600);
alter table tonde.acts add column ending_state text not null default '' check (length(ending_state) <= 600);
alter table tonde.acts add column summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object');
alter table tonde.acts add column lifecycle tonde.lifecycle not null default 'active';
create index acts_live_order on tonde.acts(workspace_id, production_id, lifecycle, sort_order) where lifecycle = 'active';

-- 3. Sequence: related Scenes. Kind covers narrative, documentary, topic and montage use.
alter table tonde.sequences add column purpose text not null default '' check (length(purpose) <= 1200);
alter table tonde.sequences add column kind tonde.sequence_kind not null default 'narrative';
alter table tonde.sequences add column summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object');
alter table tonde.sequences add column lifecycle tonde.lifecycle not null default 'active';
create index sequences_live_order on tonde.sequences(workspace_id, production_id, lifecycle, act_id, sort_order)
  where lifecycle = 'active';

-- 4. A Scene may sit directly inside an Act (Production -> Act -> Scene) without inventing a
-- placeholder Sequence. sequence_id stays the primary parent when both are set, and a
-- consistency guard below keeps act_id equal to the Sequence's Act.
alter table tonde.scenes add column act_id uuid;
alter table tonde.scenes add constraint scenes_act_scope
  foreign key (workspace_id, production_id, act_id) references tonde.acts(workspace_id, production_id, id) on delete restrict;
create index scenes_live_act_order on tonde.scenes(workspace_id, production_id, act_id, lifecycle, sort_order)
  where lifecycle = 'active';

-- 5. Series. Recurring organization around canonical Productions. Season/Collection stays
-- optional and keep its existing `series_collections` home.
alter table tonde.series add column series_kind tonde.series_kind not null default 'recurring';
alter table tonde.series add column format jsonb not null default '{}' check (jsonb_typeof(format) = 'object');
alter table tonde.series add column timezone text not null default 'UTC' check (length(btrim(timezone)) between 1 and 60);
alter table tonde.series add column revision integer not null default 1 check (revision > 0);
alter table tonde.series add column summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object');
alter table tonde.series_collections add column purpose text not null default '' check (length(purpose) <= 1200);
alter table tonde.series_collections add column lifecycle tonde.lifecycle not null default 'active';
alter table tonde.series_collections add column revision integer not null default 1 check (revision > 0);

-- 6. Episode is an association around the same canonical Production, never a second content model.
alter table tonde.series_episodes add column title text not null default '' check (length(title) <= 160);
alter table tonde.series_episodes add column slot_key text check (length(slot_key) between 1 and 80);
alter table tonde.series_episodes add column requested_depth tonde.generate_depth;
alter table tonde.series_episodes add column brief jsonb not null default '{}' check (jsonb_typeof(brief) = 'object');
alter table tonde.series_episodes add column lifecycle tonde.lifecycle not null default 'active';
alter table tonde.series_episodes add column revision integer not null default 1 check (revision > 0);
alter table tonde.series_episodes add constraint series_episodes_workspace_identity unique (workspace_id, id);
create unique index series_episodes_slot_key on tonde.series_episodes(series_id, slot_key) where slot_key is not null;
create index series_episodes_schedule on tonde.series_episodes(workspace_id, series_id, lifecycle, planned_date, episode_number);

-- 7. Derived summaries. A summary records the revision it was derived from; when the object
-- moves on, the summary is reported stale instead of being treated as current truth.
create table tonde.structure_summaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null, scope_object_id uuid not null,
  scope_level tonde.structure_level not null check (scope_level <> 'shot'),
  source_revision integer not null check (source_revision > 0),
  content jsonb not null default '{}' check (jsonb_typeof(content) = 'object'),
  generated_by text not null default 'creator' check (generated_by in ('creator','tonde','system')),
  note text not null default '' check (length(note) <= 400),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, scope_object_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, scope_object_id) references tonde.objects(workspace_id, id) on delete restrict
);

-- 8. Generate Ahead is a durable job with per-slot items so partial success persists and a
-- retry only touches what is missing. The same job also appears in the shared `jobs` surface.
alter table tonde.jobs drop constraint jobs_job_type_check;
alter table tonde.jobs add constraint jobs_job_type_check check (job_type in
  ('media_preprocessing','transcription','reference_analysis','story_generation','production_generation',
   'prompt_compilation','shot_match','export','thumbnail','proxy','cloud_import','long_form_generation'));
create table tonde.generate_ahead_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, series_id uuid not null,
  job_id uuid,
  horizon tonde.generate_horizon not null, depth tonde.generate_depth not null,
  requested_count integer not null default 0 check (requested_count between 0 and 400),
  base_date date, timezone text not null default 'UTC' check (length(btrim(timezone)) between 1 and 60),
  state tonde.job_state not null default 'queued',    preview jsonb not null default '{}' check (jsonb_typeof(preview) = 'object'),
  created_count integer not null default 0 check (created_count >= 0),
  preserved_count integer not null default 0 check (preserved_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  note text not null default '' check (length(note) <= 400),
  revision integer not null default 1 check (revision > 0),
  requested_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, series_id) references tonde.series(workspace_id, id) on delete restrict,
  foreign key (workspace_id, job_id) references tonde.jobs(workspace_id, id) on delete restrict
);
create index generate_ahead_jobs_series on tonde.generate_ahead_jobs(workspace_id, series_id, created_at desc);
create table tonde.generate_ahead_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, job_id uuid not null,
  slot_key text not null check (length(slot_key) between 1 and 80), planned_date date,
  episode_number bigint check (episode_number > 0),
  state text not null default 'pending' check (state in ('pending','created','preserved','blocked','failed')),
  -- Named for what they are: this row is a durable job item, not a Production record, so the
  -- shared mutation guard must never read these as an owner identity.
  created_production_id uuid, created_episode_id uuid,
  error_code text check (length(error_code) <= 40), error_message text check (length(error_message) <= 400),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, job_id, slot_key),
  foreign key (workspace_id, job_id) references tonde.generate_ahead_jobs(workspace_id, id) on delete restrict,
  foreign key (workspace_id, created_production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, created_episode_id) references tonde.series_episodes(workspace_id, id) on delete restrict
);
create index generate_ahead_items_state on tonde.generate_ahead_items(workspace_id, job_id, state);

-- 9. An Episode is an association with real object identity, so continuity, versions and future
-- dependency edges can address it. This extends the existing registry rather than adding a second one.
alter table tonde.objects drop constraint objects_kind_check;
alter table tonde.objects add constraint objects_kind_check check (kind in
  ('project','production','series','collection','episode','act','sequence','scene','shot','asset',
   'reference','creative_document','dialogue_line','execution_plan','result'));
create trigger a_register_object after insert on tonde.series_episodes
  for each row execute function tonde_private.register_object('episode');

-- 9b. Version history for the new history-bearing Series rows, matching Acts/Sequences/Scenes.
create trigger b_capture_revision after insert or update on tonde.series
  for each row execute function tonde_private.capture_revision();
create trigger b_capture_revision after insert or update on tonde.series_collections
  for each row execute function tonde_private.capture_revision();
create trigger b_capture_revision after insert or update on tonde.series_episodes
  for each row execute function tonde_private.capture_revision();
do $$ declare item text; begin
  foreach item in array array['structure_summaries','generate_ahead_jobs','generate_ahead_items'] loop
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', item);
  end loop;
end $$;

-- 10. Semantic link guard: a Scene's Act must be the Act of its Sequence when both are set.
create or replace function tonde_private.lf_scene_parent_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sequence_act uuid;
begin
  if new.sequence_id is not null then
    select act_id into sequence_act from tonde.sequences
      where workspace_id = new.workspace_id and production_id = new.production_id and id = new.sequence_id;
    -- A missing or cross-Production Sequence is left to the canonical foreign key, which reports
    -- it with the standard ownership error. This guard only keeps Act and Sequence consistent.
    if found and new.act_id is distinct from sequence_act then
      raise exception 'A Scene in a Sequence belongs to that Sequence''s Act' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function tonde_private.lf_scene_parent_guard() from public, anon, authenticated, service_role;
create trigger zz_scene_parent_guard before insert or update on tonde.scenes
  for each row execute function tonde_private.lf_scene_parent_guard();

-- 11. Shared helpers (not user-facing).
create function tonde_private.lf_label(total_ms bigint) returns text
language sql immutable set search_path = '' as $$
  select case when total_ms is null then null else
    (case when total_ms < 0 then '-' else '' end) ||
    case when abs(total_ms) >= 3600000
      then (abs(total_ms)/3600000)::text || ':' || lpad(((abs(total_ms)%3600000)/60000)::text,2,'0') || ':' || lpad(((abs(total_ms)%60000)/1000)::text,2,'0')
      else (abs(total_ms)/60000)::text || ':' || lpad(((abs(total_ms)%60000)/1000)::text,2,'0') end
  end;
$$;

create function tonde_private.lf_scene_duration(target_workspace uuid, target_production uuid, target_scene uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when coalesce(agg.shots,0) > 0 and coalesce(agg.missing,0) = 0 then agg.total
    else coalesce(s.planned_duration_ms, 0) end
  from tonde.scenes s
  left join (
    select h.scene_id, count(*) as shots, count(*) filter (where h.planned_duration_ms is null) as missing,
      coalesce(sum(h.planned_duration_ms),0) as total
    from tonde.shots h where h.workspace_id = target_workspace and h.production_id = target_production
      and h.lifecycle = 'active' and h.scene_id is not null group by h.scene_id) agg on agg.scene_id = s.id
  where s.workspace_id = target_workspace and s.production_id = target_production and s.id = target_scene;
$$;

-- Calculated runtime for one structural node. Shots feed a Scene only when every Shot has a
-- duration; a Sequence/Act uses its children when it has any, otherwise its planned value.
create function tonde_private.lf_scope_duration(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare total bigint; children integer; planned bigint;
begin
  if target_level = 'shot' then
    select coalesce(planned_duration_ms,0) into total from tonde.shots
      where workspace_id = target_workspace and production_id = target_production and id = target_id;
    return coalesce(total,0);
  elsif target_level = 'scene' then
    return coalesce(tonde_private.lf_scene_duration(target_workspace, target_production, target_id),0);
  elsif target_level = 'sequence' then
    select coalesce(planned_duration_ms,0) into planned from tonde.sequences
      where workspace_id = target_workspace and production_id = target_production and id = target_id;
    select count(*), coalesce(sum(tonde_private.lf_scene_duration(target_workspace, target_production, s.id)),0)
      into children, total from tonde.scenes s
      where s.workspace_id = target_workspace and s.production_id = target_production
        and s.sequence_id = target_id and s.lifecycle = 'active';
    return case when children > 0 then total else coalesce(planned,0) end;
  elsif target_level = 'act' then
    select coalesce(planned_duration_ms,0) into planned from tonde.acts
      where workspace_id = target_workspace and production_id = target_production and id = target_id;
    select count(*), coalesce(sum(part),0) into children, total from (
      select tonde_private.lf_scope_duration(target_workspace, target_production, 'sequence', q.id) as part
        from tonde.sequences q where q.workspace_id = target_workspace and q.production_id = target_production
          and q.act_id = target_id and q.lifecycle = 'active'
      union all
      select tonde_private.lf_scene_duration(target_workspace, target_production, s.id)
        from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production
          and s.act_id = target_id and s.sequence_id is null and s.lifecycle = 'active') as parts;
    return case when children > 0 then total else coalesce(planned,0) end;
  end if;
  -- Production: Acts, then Sequences with no Act, then Scenes with neither parent.
  select coalesce(sum(part),0) into total from (
    select tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id) as part
      from tonde.acts a where a.workspace_id = target_workspace and a.production_id = target_production
        and a.lifecycle = 'active'
    union all
    select tonde_private.lf_scope_duration(target_workspace, target_production, 'sequence', q.id)
      from tonde.sequences q where q.workspace_id = target_workspace and q.production_id = target_production
        and q.act_id is null and q.lifecycle = 'active'
    union all
    select tonde_private.lf_scene_duration(target_workspace, target_production, s.id)
      from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production
        and s.sequence_id is null and s.act_id is null and s.lifecycle = 'active') as parts;
  return coalesce(total,0);
end $$;

create function tonde_private.lf_status(target_ms bigint, calculated_ms bigint) returns text
language sql immutable set search_path = '' as $$
  select case when target_ms is null then 'unresolved' when calculated_ms = target_ms then 'fits'
    when calculated_ms > target_ms then 'over' else 'under' end;
$$;

-- Planning depth is derived from real content, never declared by hand and never a percentage.
create function tonde_private.lf_depth(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid) returns tonde.planning_depth
language plpgsql stable security definer set search_path = '' as $$
declare depth tonde.planning_depth := 'idea'; doc_kind text; shots integer; planned_shots integer;
  scenes integer; activity integer;
begin
  if target_level = 'shot' then
    select case when cs.status in ('setup','shooting','captured','pickup_needed') then 'in_progress'
      when p.id is not null then 'execution_planned' else 'shots_planned' end into depth
    from tonde.shots h
    left join tonde.shot_capture_state cs on cs.workspace_id = h.workspace_id and cs.shot_id = h.id
    left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
    where h.workspace_id = target_workspace and h.production_id = target_production and h.id = target_id;
    return coalesce(depth,'idea');
  end if;
  -- Story/Script documents are the canonical narrative depth signal.
  select document_type into doc_kind from tonde.creative_documents d
    where d.workspace_id = target_workspace and d.production_id = target_production
      and d.scope_object_id = target_id
      and d.document_type in ('script','treatment','story','brief','scene_description')
    order by case d.document_type when 'script' then 1 when 'scene_description' then 2 when 'treatment' then 3
      when 'story' then 4 else 5 end
    limit 1;
  depth := case doc_kind when 'script' then 'scripted' when 'scene_description' then 'scripted'
    when 'treatment' then 'story_defined' when 'story' then 'story_defined'
    when 'brief' then 'story_defined' else 'idea' end;
  if target_level = 'scene' then
    select count(*), count(*) filter (where p.id is not null) into shots, planned_shots
      from tonde.shots h left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
      where h.workspace_id = target_workspace and h.production_id = target_production
        and h.scene_id = target_id and h.lifecycle = 'active';
    select count(*) into activity from tonde.shots h
      left join tonde.shot_capture_state cs on cs.workspace_id = h.workspace_id and cs.shot_id = h.id
      where h.workspace_id = target_workspace and h.production_id = target_production and h.scene_id = target_id
        and h.lifecycle = 'active' and cs.status in ('setup','shooting','captured','pickup_needed');
    if shots > 0 then depth := greatest(depth, 'shots_planned'::tonde.planning_depth); end if;
    if shots > 0 and planned_shots = shots then depth := greatest(depth, 'execution_planned'::tonde.planning_depth); end if;
    if activity > 0 then depth := 'in_progress'; end if;
    return depth;
  end if;
  -- Act / Sequence / Production aggregate their descendants, plus the production's own documents.
  select count(*) into scenes from tonde.scenes s where s.workspace_id = target_workspace
    and s.production_id = target_production and s.lifecycle = 'active'
    and case target_level when 'production' then true when 'act' then s.act_id = target_id
      else s.sequence_id = target_id end;
  if scenes > 0 then depth := greatest(depth, 'scenes_planned'::tonde.planning_depth); end if;
  select count(*) into shots from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active'
    and case target_level when 'production' then true when 'act' then h.scene_id in (
        select s.id from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production
          and s.act_id = target_id)
      else h.scene_id in (select s.id from tonde.scenes s where s.workspace_id = target_workspace
        and s.production_id = target_production and s.sequence_id = target_id) end;
  if shots > 0 then depth := greatest(depth, 'shots_planned'::tonde.planning_depth); end if;
  select count(*) into planned_shots from tonde.shots h join tonde.execution_plans p
    on p.workspace_id = h.workspace_id and p.shot_id = h.id
    where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active'
    and case target_level when 'production' then true when 'act' then h.scene_id in (
        select s.id from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production
          and s.act_id = target_id)
      else h.scene_id in (select s.id from tonde.scenes s where s.workspace_id = target_workspace
        and s.production_id = target_production and s.sequence_id = target_id) end;
  if shots > 0 and planned_shots = shots then depth := greatest(depth, 'execution_planned'::tonde.planning_depth); end if;
  select count(*) into activity from tonde.shots h
    left join tonde.shot_capture_state cs on cs.workspace_id = h.workspace_id and cs.shot_id = h.id
    where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active'
    and cs.status in ('setup','shooting','captured','pickup_needed')
    and case target_level when 'production' then true when 'act' then h.scene_id in (
        select s.id from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production
          and s.act_id = target_id)
      else h.scene_id in (select s.id from tonde.scenes s where s.workspace_id = target_workspace
        and s.production_id = target_production and s.sequence_id = target_id) end;
  if activity > 0 then depth := 'in_progress'; end if;
  if target_level <> 'production' and exists(
      select 1 from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production
        and s.lifecycle = 'active'
        and case target_level when 'act' then s.act_id = target_id else s.sequence_id = target_id end)
    then depth := greatest(depth, 'outlined'::tonde.planning_depth); end if;
  return depth;
end $$;

create function tonde_private.lf_scope_revision(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare value integer;
begin
  if target_level = 'production' then
    select revision into value from tonde.productions where workspace_id = target_workspace and id = target_id;
  elsif target_level = 'act' then
    select revision into value from tonde.acts where workspace_id = target_workspace and production_id = target_production and id = target_id;
  elsif target_level = 'sequence' then
    select revision into value from tonde.sequences where workspace_id = target_workspace and production_id = target_production and id = target_id;
  elsif target_level = 'scene' then
    select revision into value from tonde.scenes where workspace_id = target_workspace and production_id = target_production and id = target_id;
  else
    select revision into value from tonde.shots where workspace_id = target_workspace and production_id = target_production and id = target_id;
  end if;
  return value;
end $$;

-- One structural handle for the whole Production: any Act/Sequence/Scene/Shot change moves it,
-- so a stale reorder or structural write is rejected instead of silently reordered.
create function tonde_private.lf_structure_revision(target_workspace uuid, target_production uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select revision from tonde.productions where workspace_id = target_workspace and id = target_production), 0)
    + coalesce((select sum(revision) from tonde.acts where workspace_id = target_workspace and production_id = target_production), 0)
    + coalesce((select sum(revision) from tonde.sequences where workspace_id = target_workspace and production_id = target_production), 0)
    + coalesce((select sum(revision) from tonde.scenes where workspace_id = target_workspace and production_id = target_production), 0)
    + coalesce((select sum(revision) from tonde.shots where workspace_id = target_workspace and production_id = target_production), 0);
$$;

-- Documents attached to a scope, with staleness of the stored summary. Bounded excerpt only.
create function tonde_private.lf_documents(target_workspace uuid, target_production uuid, target_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('document_id', d.id, 'document_type', d.document_type,
    'title', d.title, 'revision', d.revision, 'approval', d.approval, 'locked', d.locked_at is not null,
    'length', length(d.content)) order by d.document_type), '[]'::jsonb)
  from tonde.creative_documents d
  where d.workspace_id = target_workspace and d.production_id = target_production and d.scope_object_id = target_id;
$$;

create function tonde_private.lf_summary(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('summary_id', sm.id, 'text', coalesce(sm.content->>'text',''),
      'content', sm.content, 'generated_by', sm.generated_by, 'note', sm.note,
      'source_revision', sm.source_revision, 'current_revision', tonde_private.lf_scope_revision(target_workspace, target_production, target_level, target_id),
      'stale', sm.source_revision <> coalesce(tonde_private.lf_scope_revision(target_workspace, target_production, target_level, target_id), sm.source_revision),
      'revision', sm.revision)
    from tonde.structure_summaries sm where sm.workspace_id = target_workspace
      and sm.production_id = target_production and sm.scope_object_id = target_id), 'null'::jsonb);
$$;

revoke all on function tonde_private.lf_label(bigint),
  tonde_private.lf_scene_duration(uuid,uuid,uuid),
  tonde_private.lf_scope_duration(uuid,uuid,tonde.structure_level,uuid),
  tonde_private.lf_status(bigint,bigint),
  tonde_private.lf_depth(uuid,uuid,tonde.structure_level,uuid),
  tonde_private.lf_scope_revision(uuid,uuid,tonde.structure_level,uuid),
  tonde_private.lf_structure_revision(uuid,uuid),
  tonde_private.lf_documents(uuid,uuid,uuid),
  tonde_private.lf_summary(uuid,uuid,tonde.structure_level,uuid)
  from public, anon, authenticated, service_role;
create function tonde_private.lf_read_guard(target_workspace uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
end $$;

-- Revision/lock guard for Acts and Sequences, matching the Scene/Shot guard from Prompt 5.
create function tonde_private.lf_node_guard(target_workspace uuid, target_production uuid,
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
    raise exception 'That object changed since you loaded it' using errcode = '40001';
  end if;
end $$;

create function tonde_private.lf_bounded(target_limit integer, target_offset integer) returns table(out_limit integer, out_offset integer)
language sql immutable set search_path = '' as $$
  select least(greatest(coalesce(target_limit, 50), 1), 200), greatest(coalesce(target_offset, 0), 0);
$$;
revoke all on function tonde_private.lf_read_guard(uuid), tonde_private.lf_node_guard(uuid,uuid,tonde.structure_level,uuid,integer),
  tonde_private.lf_bounded(integer,integer) from public, anon, authenticated, service_role;

-- Deterministic runtime rollup with truthful conflict reporting. Planned targets are never
-- overwritten by calculated child totals: both are reported, with the real discrepancy.
create function tonde_private.lf_production_timing(target_workspace uuid, target_production uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target_ms bigint; calculated bigint; acts jsonb; conflicts jsonb; overall text;
  counts jsonb;
begin
  select planned_duration_ms into target_ms from tonde.productions
    where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  calculated := tonde_private.lf_scope_duration(target_workspace, target_production, 'production', target_production);
  select coalesce(jsonb_agg(jsonb_build_object(
      'act_id', a.id, 'title', a.title, 'order', a.sort_order,
      'target_ms', a.planned_duration_ms,
      'calculated_ms', tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id),
      'delta_ms', case when a.planned_duration_ms is null then null
        else tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id) - a.planned_duration_ms end,
      'status', tonde_private.lf_status(a.planned_duration_ms, tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id)),
      'sequences', (select count(*) from tonde.sequences q where q.workspace_id = target_workspace
        and q.production_id = target_production and q.act_id = a.id and q.lifecycle = 'active'),
      'scenes', (select count(*) from tonde.scenes s where s.workspace_id = target_workspace
        and s.production_id = target_production and s.act_id = a.id and s.lifecycle = 'active'))
    order by a.sort_order, a.id), '[]'::jsonb) into acts
  from tonde.acts a
  where a.workspace_id = target_workspace and a.production_id = target_production and a.lifecycle = 'active';
  select coalesce(jsonb_agg(jsonb_build_object('level', c.level, 'id', c.id, 'title', c.title,
      'target_ms', c.target_ms, 'calculated_ms', c.calculated_ms,
      'over_by_ms', case when c.target_ms is null then null else c.calculated_ms - c.target_ms end,
      'over_by_label', case when c.target_ms is null then null
        else tonde_private.lf_label(c.calculated_ms - c.target_ms) end,
      'status', tonde_private.lf_status(c.target_ms, c.calculated_ms), 'reason', c.reason)
    order by c.level, c.title), '[]'::jsonb) into conflicts
  from (
    select 'act'::text as level, a.id, a.title, a.planned_duration_ms as target_ms,
      tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id) as calculated_ms,
      'Act target and current child total differ.'::text as reason
    from tonde.acts a where a.workspace_id = target_workspace and a.production_id = target_production
      and a.lifecycle = 'active' and a.planned_duration_ms is not null
      and tonde_private.lf_scope_duration(target_workspace, target_production, 'act', a.id) <> a.planned_duration_ms
    union all
    select 'sequence', q.id, q.title, q.planned_duration_ms,
      tonde_private.lf_scope_duration(target_workspace, target_production, 'sequence', q.id),
      'Sequence target and current child total differ.'
    from tonde.sequences q where q.workspace_id = target_workspace and q.production_id = target_production
      and q.lifecycle = 'active' and q.planned_duration_ms is not null
      and tonde_private.lf_scope_duration(target_workspace, target_production, 'sequence', q.id) <> q.planned_duration_ms
    limit 50) c;
  select jsonb_build_object(
    'acts', (select count(*) from tonde.acts a where a.workspace_id = target_workspace
      and a.production_id = target_production and a.lifecycle = 'active'),
    'sequences', (select count(*) from tonde.sequences q where q.workspace_id = target_workspace
      and q.production_id = target_production and q.lifecycle = 'active'),
    'scenes', (select count(*) from tonde.scenes s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.lifecycle = 'active'),
    'shots', (select count(*) from tonde.shots h where h.workspace_id = target_workspace
      and h.production_id = target_production and h.lifecycle = 'active'),
    'scenes_incomplete_timing', (select count(*) from tonde.scenes s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.lifecycle = 'active' and exists(
        select 1 from tonde.shots h where h.workspace_id = target_workspace and h.production_id = target_production
          and h.scene_id = s.id and h.lifecycle = 'active' and h.planned_duration_ms is null)),
    'scenes_without_shots', (select count(*) from tonde.scenes s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.lifecycle = 'active' and not exists(
        select 1 from tonde.shots h where h.workspace_id = target_workspace and h.production_id = target_production
          and h.scene_id = s.id and h.lifecycle = 'active'))) into counts;
  overall := tonde_private.lf_status(target_ms, calculated);
  return jsonb_build_object('production', jsonb_build_object(
      'target_ms', target_ms, 'calculated_ms', calculated,
      'delta_ms', case when target_ms is null then null else calculated - target_ms end,
      'target_label', tonde_private.lf_label(target_ms), 'calculated_label', tonde_private.lf_label(calculated),
      'delta_label', case when target_ms is null then null else tonde_private.lf_label(calculated - target_ms) end,
      'status', overall),
    'acts', acts, 'conflicts', conflicts, 'counts', counts, 'status', overall,
    'note', case when target_ms is null then 'This Production has no runtime target yet, so total runtime is reported without a fit verdict.'
      else 'Planned target and calculated child runtime are reported separately; nothing was overwritten.' end);
end $$;
revoke all on function tonde_private.lf_production_timing(uuid,uuid) from public, anon, authenticated, service_role;

-- 12. Hierarchical reads. Children of one scope only: a 120-minute Production is never
-- rendered as one giant card graph, and every level is paginated and bounded.
create function tonde.long_form_structure(target_workspace uuid, target_production uuid,
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
    raise exception 'The Production changed since you loaded it' using errcode = '40001';
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
create function tonde_private.lf_ms(source jsonb, target_key text) returns bigint
language plpgsql immutable set search_path = '' as $$
declare value bigint;
begin
  if not source ? target_key or source->>target_key is null or source->>target_key = '' then return null; end if;
  if source->>target_key !~ '^[0-9]{1,16}$' then
    raise exception 'Durations must be whole milliseconds' using errcode = '22023';
  end if;
  value := (source->>target_key)::bigint;
  if value > 9007199254740991 then raise exception 'Duration exceeds the safe integer range' using errcode = '22023'; end if;
  return value;
end $$;
revoke all on function tonde_private.lf_ms(jsonb,text) from public, anon, authenticated, service_role;

-- 13. Public reads.
create function tonde.long_form_timing(target_workspace uuid, target_production uuid, expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare revision integer;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  select p.revision into revision from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = '40001';
  end if;
  return tonde_private.lf_production_timing(target_workspace, target_production)
    || jsonb_build_object('production_revision', revision,
      'structure_revision', tonde_private.lf_structure_revision(target_workspace, target_production));
end $$;

-- Structured search: relational filters first, actual object references returned, never prose.
create function tonde.long_form_search(target_workspace uuid, target_production uuid, search_query text,
  filters jsonb default '{}'::jsonb, target_limit integer default 40, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare term text; lim integer; off integer; items jsonb; total integer; levels text[];
  character_filter uuid; environment_filter uuid; method_filter text; approval_filter text;
  text_only boolean; bound_only boolean;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  term := lower(btrim(coalesce(search_query, '')));
  if length(term) < 2 then raise exception 'Search needs at least two characters' using errcode = '22023'; end if;
  if not exists(select 1 from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production) then
    raise exception 'Production unavailable' using errcode = 'P0002';
  end if;
  select b.out_limit, b.out_offset into lim, off from tonde_private.lf_bounded(target_limit, target_offset) b;
  levels := case when filters ? 'levels'
    then coalesce(array(select jsonb_array_elements_text(filters->'levels')), '{}'::text[]) else null end;
  character_filter := nullif(coalesce(filters->>'character_asset_id',''),'')::uuid;
  environment_filter := nullif(coalesce(filters->>'environment_asset_id',''),'')::uuid;
  method_filter := nullif(coalesce(filters->>'execution_method',''),'');
  approval_filter := nullif(coalesce(filters->>'approval',''),'');
  bound_only := character_filter is not null or environment_filter is not null or method_filter is not null;
  with matches as (
    select 'act'::text as level, a.id, a.title, a.purpose as snippet, 'act purpose'::text as match_field,
      null::uuid as scene_id, null::uuid as shot_id, a.approval, a.locked_at is not null as locked, a.sort_order as ord
    from tonde.acts a where a.workspace_id = target_workspace and a.production_id = target_production
      and a.lifecycle = 'active' and (position(term in lower(a.title || ' ' || a.purpose || ' ' || a.narrative_goal)) > 0)
    union all
    select 'sequence', q.id, q.title, q.purpose, 'sequence purpose', null, null, q.approval, q.locked_at is not null, q.sort_order
    from tonde.sequences q where q.workspace_id = target_workspace and q.production_id = target_production
      and q.lifecycle = 'active' and position(term in lower(q.title || ' ' || q.purpose)) > 0
    union all
    select 'scene', s.id, s.title, s.description, 'scene', s.id, null, s.approval, s.locked_at is not null, s.sort_order
    from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production
      and s.lifecycle = 'active' and position(term in lower(s.title || ' ' || s.purpose || ' ' || s.description || ' ' || s.story_beat)) > 0
    union all
    select 'shot', h.id, h.title, h.description, 'shot', h.scene_id, h.id, h.approval, h.locked_at is not null, h.sort_order
    from tonde.shots h where h.workspace_id = target_workspace and h.production_id = target_production
      and h.lifecycle = 'active' and position(term in lower(h.title || ' ' || h.description || ' ' || h.action || ' ' || h.subject || ' ' || h.purpose)) > 0
    union all
    select 'document', d.id, d.title, left(d.content, 200), 'document', null, null, d.approval, d.locked_at is not null, 0
    from tonde.creative_documents d where d.workspace_id = target_workspace and d.production_id = target_production
      and position(term in lower(d.title || ' ' || left(d.content, 200000))) > 0),
  resolved as (
    select m.*, case when m.level = 'shot' then tonde_private.lf_depth(target_workspace, target_production, 'shot', m.id)
      when m.level = 'scene' then tonde_private.lf_depth(target_workspace, target_production, 'scene', m.id)
      when m.level = 'sequence' then tonde_private.lf_depth(target_workspace, target_production, 'sequence', m.id)
      when m.level = 'act' then tonde_private.lf_depth(target_workspace, target_production, 'act', m.id)
      else null end as depth,
      case when m.scene_id is not null then (select s.title from tonde.scenes s where s.id = m.scene_id) end as scene_title,
      case when m.level = 'shot' then (select count(*) from tonde.shot_takes t where t.workspace_id = target_workspace and t.shot_id = m.id) end as take_count,
      case when m.level = 'shot' then (select count(*) from tonde.results r where r.workspace_id = target_workspace and r.shot_id = m.id) end as result_count,
      case when m.level = 'shot' then (select count(*) from tonde.ai_generation_attempts at where at.workspace_id = target_workspace and at.shot_id = m.id) end as attempt_count,
      case when m.level = 'shot' then (select h.execution_method::text from tonde.shots h where h.id = m.id) end as execution_method
    from matches m),
  filtered as (
    select r.* from resolved r
    where (levels is null or r.level = any(levels))
      and (approval_filter is null or r.approval::text = approval_filter)
      and (method_filter is null or r.execution_method = method_filter)
      and (character_filter is null or (r.level in ('scene','shot') and r.scene_id is not null
        and exists(select 1 from tonde.scene_participants sp where sp.scene_id = r.scene_id and sp.asset_id = character_filter)))
      and (environment_filter is null or (r.level = 'scene'
        and exists(select 1 from tonde.scenes s where s.id = r.id and s.environment_asset_id = environment_filter))))
  select coalesce(jsonb_agg(jsonb_build_object('level', r.level, 'id', r.id, 'title', r.title,
      'snippet', left(coalesce(r.snippet,''), 240), 'match_field', r.match_field,
      'scene_id', r.scene_id, 'shot_id', r.shot_id, 'scene_title', r.scene_title,
      'approval', r.approval, 'locked', r.locked, 'depth', r.depth, 'execution_method', r.execution_method,
      'takes', r.take_count, 'results', r.result_count, 'attempts', r.attempt_count)
      order by r.level, r.ord, r.id), '[]'::jsonb), count(*) into items, total
  from filtered r;
  total := coalesce(total, 0);
  return jsonb_build_object('query', btrim(search_query), 'items', items, 'total', total,
    'limit', lim, 'offset', off, 'truncated', total > off + jsonb_array_length(items),
    'binding_filter', case when bound_only then jsonb_build_object('character_asset_id', character_filter,
      'environment_asset_id', environment_filter, 'execution_method', method_filter, 'scoped_to', 'scenes/shots')
      else 'null'::jsonb end,
    'filters', coalesce(filters, '{}'::jsonb),
    'note', 'Structured relational matches on the canonical Production, never a semantic guess.');
end $$;

-- 14. Summaries are derived, versioned and explicitly stale rather than silently current.
create function tonde.save_structure_summary(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid, content jsonb, expected_production_revision integer,
  note text default '', generated_by text default 'creator')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare revision integer; scope_revision integer; saved tonde.structure_summaries;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, expected_production_revision);
  if target_level = 'shot' then raise exception 'Summaries cover Production, Act, Sequence and Scene' using errcode = '22023'; end if;
  if jsonb_typeof(content) <> 'object' then raise exception 'Invalid summary payload' using errcode = '22023'; end if;
  if length(coalesce(content->>'text','')) > 4000 then
    raise exception 'A summary text is limited to 4000 characters' using errcode = '22023';
  end if;
  if generated_by not in ('creator','tonde','system') then raise exception 'Unsupported summary author' using errcode = '22023'; end if;
  if not exists(select 1 from tonde.objects o where o.workspace_id = target_workspace and o.id = target_id
    and o.kind = target_level::text and o.production_id = target_production) then
    raise exception 'That scope is unavailable in this Production' using errcode = 'P0002';
  end if;
  revision := tonde_private.lf_scope_revision(target_workspace, target_production, target_level, target_id);
  scope_revision := revision;
  insert into tonde.structure_summaries(workspace_id, production_id, scope_object_id, scope_level,
    source_revision, content, generated_by, note)
  values (target_workspace, target_production, target_id, target_level, scope_revision, content, generated_by,
    left(coalesce(note,''), 400))
  on conflict (workspace_id, scope_object_id) do update
    set source_revision = excluded.source_revision, content = excluded.content,
      generated_by = excluded.generated_by, note = excluded.note
  returning * into saved;
  return jsonb_build_object('summary_id', saved.id, 'scope_level', saved.scope_level, 'scope_object_id', saved.scope_object_id,
    'source_revision', saved.source_revision, 'revision', saved.revision, 'stale', false,
    'note', 'Derived summary stored against the revision it was derived from.');
end $$;

create function tonde.long_form_summaries(target_workspace uuid, target_production uuid,
  target_limit integer default 100, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  select b.out_limit, b.out_offset into lim, off from tonde_private.lf_bounded(target_limit, target_offset) b;
  select coalesce(jsonb_agg(jsonb_build_object('summary_id', sm.id, 'scope_level', sm.scope_level,
      'scope_object_id', sm.scope_object_id, 'generated_by', sm.generated_by, 'note', sm.note,
      'source_revision', sm.source_revision, 'current_revision',
        tonde_private.lf_scope_revision(target_workspace, target_production, sm.scope_level, sm.scope_object_id),
      'stale', sm.source_revision <> coalesce(tonde_private.lf_scope_revision(target_workspace, target_production, sm.scope_level, sm.scope_object_id), sm.source_revision),
      'text', left(coalesce(sm.content->>'text',''), 400)) order by sm.scope_level, sm.id), '[]'::jsonb), count(*)
    into items, total
  from tonde.structure_summaries sm where sm.workspace_id = target_workspace and sm.production_id = target_production;
  return jsonb_build_object('items', items, 'total', coalesce(total,0), 'limit', lim, 'offset', off,
    'truncated', coalesce(total,0) > off + jsonb_array_length(items));
end $$;

-- Script navigation by scope, with measured length and a bounded excerpt. One giant Script
-- text area is never required, and no prose is parsed to invent structure.
create function tonde.long_form_script_index(target_workspace uuid, target_production uuid,
  target_limit integer default 50, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  select b.out_limit, b.out_offset into lim, off from tonde_private.lf_bounded(target_limit, target_offset) b;
  select coalesce(jsonb_agg(jsonb_build_object('document_id', d.id, 'document_type', d.document_type,
      'title', d.title, 'scope_object_id', d.scope_object_id, 'scope_level', o.kind,
      'revision', d.revision, 'approval', d.approval, 'locked', d.locked_at is not null,
      'characters', length(d.content), 'lines', (select count(*) from tonde.dialogue_lines l
        where l.workspace_id = target_workspace and l.document_id = d.id),
      'line_duration_ms', (select coalesce(sum(l.duration_ms),0) from tonde.dialogue_lines l
        where l.workspace_id = target_workspace and l.document_id = d.id),
      'excerpt', left(d.content, 400)) order by d.document_type, d.title), '[]'::jsonb), count(*)
    into items, total
  from tonde.creative_documents d join tonde.objects o on o.workspace_id = d.workspace_id and o.id = d.scope_object_id
  where d.workspace_id = target_workspace and d.production_id = target_production;
  return jsonb_build_object('items', items, 'total', coalesce(total,0), 'limit', lim, 'offset', off,
    'truncated', coalesce(total,0) > off + jsonb_array_length(items),
    'note', 'Dialogue stays first-class: line durations are measured, never inferred from paragraphs.');
end $$;

-- Bounded hierarchical context for AI/ Director reasoning. Never the whole Production.
create function tonde.long_form_context(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid, budget_chars integer default 4000)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare budget integer; scope jsonb; path jsonb; siblings jsonb; assets jsonb; documents jsonb;
  timing jsonb; character_names text; world_name uuid; dialogue jsonb; production_title text;
  parent_act uuid; parent_sequence uuid; parent_scene uuid; shot_ref uuid; scope_title text;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  budget := least(greatest(coalesce(budget_chars, 4000), 400), 20000);
  select p.title into production_title from tonde.productions p
    where p.workspace_id = target_workspace and p.id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  -- Resolve the scope's place in the hierarchy once, then build the breadcrumb from it.
  if target_level = 'production' then
    scope_title := production_title;
  elsif target_level = 'act' then
    select a.title into scope_title from tonde.acts a where a.workspace_id = target_workspace and a.id = target_id;
    parent_act := target_id;
  elsif target_level = 'sequence' then
    select q.title, q.act_id into scope_title, parent_act from tonde.sequences q
      where q.workspace_id = target_workspace and q.id = target_id;
    parent_sequence := target_id;
  elsif target_level = 'scene' then
    select s.title, s.act_id, s.sequence_id into scope_title, parent_act, parent_sequence from tonde.scenes s
      where s.workspace_id = target_workspace and s.id = target_id;
    parent_scene := target_id;
  else
    select h.title, s.act_id, s.sequence_id, s.id into scope_title, parent_act, parent_sequence, parent_scene
      from tonde.shots h join tonde.scenes s on s.workspace_id = h.workspace_id and s.id = h.scene_id
      where h.workspace_id = target_workspace and h.id = target_id;
    shot_ref := target_id;
  end if;
  if scope_title is null and target_level <> 'production' then
    raise exception 'That scope is unavailable in this Production' using errcode = 'P0002';
  end if;
  scope := jsonb_build_object('level', target_level::text, 'id', target_id, 'title', scope_title);
  path := (case when target_level <> 'production' then jsonb_build_array(jsonb_build_object(
      'level','production','id',target_production,'title',production_title)) else '[]'::jsonb end)
    || (case when parent_act is not null then jsonb_build_array(jsonb_build_object('level','act','id',parent_act,
      'title',(select a.title from tonde.acts a where a.id = parent_act))) else '[]'::jsonb end)
    || (case when parent_sequence is not null then jsonb_build_array(jsonb_build_object('level','sequence','id',parent_sequence,
      'title',(select q.title from tonde.sequences q where q.id = parent_sequence))) else '[]'::jsonb end)
    || (case when parent_scene is not null then jsonb_build_array(jsonb_build_object('level','scene','id',parent_scene,
      'title',(select s.title from tonde.scenes s where s.id = parent_scene))) else '[]'::jsonb end)
    || (case when shot_ref is not null then jsonb_build_array(jsonb_build_object('level','shot','id',shot_ref,
      'title',(select h.title from tonde.shots h where h.id = shot_ref))) else '[]'::jsonb end);
  -- Siblings: titles only, bounded, so a 100-Scene Act never enters the model call wholesale.
  siblings := case target_level
    when 'production' then (select coalesce(jsonb_agg(jsonb_build_object('level','act','id',a.id,'title',a.title)),'[]'::jsonb)
      from (select id, title from tonde.acts where workspace_id = target_workspace and production_id = target_production
        and lifecycle = 'active' order by sort_order limit 12) a)
    when 'act' then (select coalesce(jsonb_agg(jsonb_build_object('level','sequence','id',q.id,'title',q.title)),'[]'::jsonb)
      from (select id, title from tonde.sequences where workspace_id = target_workspace and production_id = target_production
        and act_id = target_id and lifecycle = 'active' order by sort_order limit 12) q)
    when 'sequence' then (select coalesce(jsonb_agg(jsonb_build_object('level','scene','id',s.id,'title',s.title)),'[]'::jsonb)
      from (select id, title from tonde.scenes where workspace_id = target_workspace and production_id = target_production
        and sequence_id = target_id and lifecycle = 'active' order by sort_order limit 12) s)
    else (select coalesce(jsonb_agg(jsonb_build_object('level','shot','id',h.id,'title',h.title)),'[]'::jsonb)
      from (select id, title from tonde.shots where workspace_id = target_workspace and production_id = target_production
        and scene_id = (select scene_id from tonde.shots where id = target_id) and lifecycle = 'active'
        order by sort_order limit 12) h) end;
  select coalesce(jsonb_agg(jsonb_build_object('role', b.binding_role, 'asset_id', b.asset_id,
      'name', a.name, 'asset_type', a.asset_type, 'inheritance', b.inheritance)), '[]'::jsonb)
    into assets
  from tonde.scope_bindings b join tonde.assets a on a.workspace_id = b.workspace_id and a.id = b.asset_id
  where b.workspace_id = target_workspace and b.production_id = target_production
    and b.scope_object_id in (target_id, target_production) limit 12;
  select coalesce(jsonb_agg(jsonb_build_object('document_type', d.document_type, 'title', d.title,
      'revision', d.revision, 'approval', d.approval, 'locked', d.locked_at is not null,
      'excerpt', left(d.content, greatest(budget / 8, 200)))), '[]'::jsonb) into documents
  from tonde.creative_documents d where d.workspace_id = target_workspace and d.production_id = target_production
    and d.scope_object_id in (target_id, target_production)
    and d.document_type in ('brief','story','treatment','script','scene_description','series_bible') limit 6;
  select coalesce(jsonb_agg(jsonb_build_object('speaker_asset_id', l.speaker_asset_id, 'line_type', l.line_type,
      'content', left(l.content, 200), 'start_ms', l.start_ms, 'duration_ms', l.duration_ms)), '[]'::jsonb)
    into dialogue
  from (select * from tonde.dialogue_lines l where l.workspace_id = target_workspace and l.production_id = target_production
    and l.scene_id = parent_scene order by l.start_ms limit 20) l;
  select string_agg(distinct a.name, ', ') into character_names from tonde.scene_participants sp
    join tonde.assets a on a.workspace_id = sp.workspace_id and a.id = sp.asset_id
  where sp.workspace_id = target_workspace and sp.scene_id = parent_scene;
  select s.environment_asset_id into world_name from tonde.scenes s
    where s.workspace_id = target_workspace and s.id = parent_scene;
  timing := tonde_private.lf_production_timing(target_workspace, target_production);
  return jsonb_build_object('scope', scope, 'path', path, 'siblings', siblings, 'assets', assets,
    'documents', documents, 'dialogue', dialogue, 'characters', coalesce(character_names, ''),
    'environment', (select jsonb_build_object('asset_id', w.id, 'name', w.name) from tonde.assets w where w.id = world_name),
    'timing', jsonb_build_object('production', timing->'production', 'counts', timing->'counts'),
    'depth', tonde_private.lf_depth(target_workspace, target_production, target_level, target_id),
    'summary', tonde_private.lf_summary(target_workspace, target_production, target_level, target_id),
    'budget_chars', budget, 'truncated', true,
    'note', 'Scoped context only: parent chain, bounded siblings, bound assets and relevant documents.');
end $$;

-- 15. Structure writes. Act/Sequence are real structural objects with revision, approval and
-- lock, and Scenes/Shots keep their existing identity through every move.
create function tonde.create_long_form_act(target_workspace uuid, target_production uuid,
  expected_production_revision integer, act jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created tonde.acts; next_order bigint; title_value text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, expected_production_revision);
  if jsonb_typeof(act) <> 'object' then raise exception 'Invalid Act payload' using errcode = '22023'; end if;
  title_value := btrim(coalesce(act->>'title',''));
  if length(title_value) = 0 or length(title_value) > 160 then
    raise exception 'An Act needs a title of 1 to 160 characters' using errcode = '22023';
  end if;
  select coalesce(max(a.sort_order), 0) + 1024 into next_order from tonde.acts a
    where a.workspace_id = target_workspace and a.production_id = target_production;
  insert into tonde.acts(workspace_id, production_id, title, purpose, narrative_goal, opening_state, ending_state,
    sort_order, planned_duration_ms)
  values (target_workspace, target_production, left(title_value,160), left(coalesce(act->>'purpose',''),1200),
    left(coalesce(act->>'narrative_goal',''),1200), left(coalesce(act->>'opening_state',''),600),
    left(coalesce(act->>'ending_state',''),600), next_order,
    tonde_private.lf_ms(act, 'duration_ms'))
  returning * into created;
  return jsonb_build_object('act_id', created.id, 'title', created.title, 'sort_order', created.sort_order,
    'revision', created.revision, 'approval', created.approval, 'planned_duration_ms', created.planned_duration_ms,
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

create function tonde.update_long_form_act(target_workspace uuid, target_production uuid, target_act uuid,
  expected_revision integer, patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare updated tonde.acts; current tonde.acts; title_value text; lifecycle_value text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(patch) <> 'object' then raise exception 'Invalid Act patch' using errcode = '22023'; end if;
  perform tonde_private.lf_node_guard(target_workspace, target_production, 'act', target_act, expected_revision);
  select * into current from tonde.acts where workspace_id = target_workspace and production_id = target_production and id = target_act;
  title_value := current.title;
  if patch ? 'title' then
    title_value := btrim(coalesce(patch->>'title',''));
    if length(title_value) = 0 or length(title_value) > 160 then
      raise exception 'An Act needs a title of 1 to 160 characters' using errcode = '22023';
    end if;
  end if;
  lifecycle_value := current.lifecycle::text;
  if patch ? 'lifecycle' then
    lifecycle_value := coalesce(nullif(patch->>'lifecycle',''), 'active');
    if lifecycle_value not in ('active','archived') then raise exception 'Acts archive rather than delete' using errcode = '22023'; end if;
    if lifecycle_value = 'archived' and exists(select 1 from tonde.sequences q where q.workspace_id = target_workspace
      and q.production_id = target_production and q.act_id = target_act and q.lifecycle = 'active') then
      raise exception 'This Act still has live Sequences. Archive or move them first.' using errcode = '23514';
    end if;
  end if;
  update tonde.acts set title = title_value,
    purpose = case when patch ? 'purpose' then left(coalesce(patch->>'purpose',''),1200) else purpose end,
    narrative_goal = case when patch ? 'narrative_goal' then left(coalesce(patch->>'narrative_goal',''),1200) else narrative_goal end,
    opening_state = case when patch ? 'opening_state' then left(coalesce(patch->>'opening_state',''),600) else opening_state end,
    ending_state = case when patch ? 'ending_state' then left(coalesce(patch->>'ending_state',''),600) else ending_state end,
    planned_duration_ms = case when patch ? 'duration_ms' then tonde_private.lf_ms(patch, 'duration_ms') else planned_duration_ms end,
    lifecycle = lifecycle_value::tonde.lifecycle
  where workspace_id = target_workspace and production_id = target_production and id = target_act
  returning * into updated;
  return jsonb_build_object('act_id', updated.id, 'revision', updated.revision, 'approval', updated.approval,
    'lifecycle', updated.lifecycle, 'planned_duration_ms', updated.planned_duration_ms,
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

create function tonde.create_long_form_sequence(target_workspace uuid, target_production uuid,
  expected_production_revision integer, sequence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created tonde.sequences; next_order bigint; title_value text; act_value uuid; kind_value text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, expected_production_revision);
  if jsonb_typeof(sequence) <> 'object' then raise exception 'Invalid Sequence payload' using errcode = '22023'; end if;
  title_value := btrim(coalesce(sequence->>'title',''));
  if length(title_value) = 0 or length(title_value) > 160 then
    raise exception 'A Sequence needs a title of 1 to 160 characters' using errcode = '22023';
  end if;
  act_value := nullif(coalesce(sequence->>'act_id',''),'')::uuid;
  if act_value is not null and not exists(select 1 from tonde.acts a where a.workspace_id = target_workspace
    and a.production_id = target_production and a.id = act_value and a.lifecycle = 'active') then
    raise exception 'Sequence Act is unavailable in this Production' using errcode = 'P0002';
  end if;
  kind_value := coalesce(nullif(sequence->>'kind',''), 'narrative');
  if not (kind_value = any(enum_range(null::tonde.sequence_kind)::text[])) then
    raise exception 'Unsupported Sequence kind' using errcode = '22023';
  end if;
  select coalesce(max(q.sort_order), 0) + 1024 into next_order from tonde.sequences q
    where q.workspace_id = target_workspace and q.production_id = target_production;
  insert into tonde.sequences(workspace_id, production_id, act_id, title, purpose, kind, sort_order, planned_duration_ms)
  values (target_workspace, target_production, act_value, left(title_value,160),
    left(coalesce(sequence->>'purpose',''),1200), kind_value::tonde.sequence_kind, next_order,
    tonde_private.lf_ms(sequence, 'duration_ms'))
  returning * into created;
  return jsonb_build_object('sequence_id', created.id, 'title', created.title, 'act_id', created.act_id,
    'sort_order', created.sort_order, 'revision', created.revision, 'approval', created.approval,
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

create function tonde.update_long_form_sequence(target_workspace uuid, target_production uuid, target_sequence uuid,
  expected_revision integer, patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare updated tonde.sequences; current tonde.sequences; title_value text; lifecycle_value text; act_value uuid;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(patch) <> 'object' then raise exception 'Invalid Sequence patch' using errcode = '22023'; end if;
  perform tonde_private.lf_node_guard(target_workspace, target_production, 'sequence', target_sequence, expected_revision);
  select * into current from tonde.sequences where workspace_id = target_workspace and production_id = target_production and id = target_sequence;
  title_value := current.title;
  if patch ? 'title' then
    title_value := btrim(coalesce(patch->>'title',''));
    if length(title_value) = 0 or length(title_value) > 160 then
      raise exception 'A Sequence needs a title of 1 to 160 characters' using errcode = '22023';
    end if;
  end if;
  lifecycle_value := current.lifecycle::text;
  if patch ? 'lifecycle' then
    lifecycle_value := coalesce(nullif(patch->>'lifecycle',''), 'active');
    if lifecycle_value not in ('active','archived') then raise exception 'Sequences archive rather than delete' using errcode = '22023'; end if;
    if lifecycle_value = 'archived' and exists(select 1 from tonde.scenes s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.sequence_id = target_sequence and s.lifecycle = 'active') then
      raise exception 'This Sequence still has live Scenes. Move or archive them first.' using errcode = '23514';
    end if;
  end if;
  act_value := current.act_id;
  if patch ? 'act_id' then
    act_value := nullif(coalesce(patch->>'act_id',''),'')::uuid;
    if act_value is not null and not exists(select 1 from tonde.acts a where a.workspace_id = target_workspace
      and a.production_id = target_production and a.id = act_value and a.lifecycle = 'active') then
      raise exception 'Sequence Act is unavailable in this Production' using errcode = 'P0002';
    end if;
    if exists(select 1 from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production
      and s.sequence_id = target_sequence and s.lifecycle = 'active' and s.act_id is distinct from act_value) then
      raise exception 'This Sequence holds Scenes in another Act. Move the Sequence instead of its Act.' using errcode = '23514';
    end if;
  end if;
  update tonde.sequences set title = title_value,
    purpose = case when patch ? 'purpose' then left(coalesce(patch->>'purpose',''),1200) else purpose end,
    kind = case when patch ? 'kind' then coalesce(nullif(patch->>'kind',''),'narrative')::tonde.sequence_kind else kind end,
    act_id = act_value,
    planned_duration_ms = case when patch ? 'duration_ms' then tonde_private.lf_ms(patch, 'duration_ms') else planned_duration_ms end,
    lifecycle = lifecycle_value::tonde.lifecycle
  where workspace_id = target_workspace and production_id = target_production and id = target_sequence
  returning * into updated;
  return jsonb_build_object('sequence_id', updated.id, 'revision', updated.revision, 'approval', updated.approval,
    'act_id', updated.act_id, 'lifecycle', updated.lifecycle,
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

-- Moving a Scene between Sequences or Acts preserves the Scene UUID and every Shot in it.
create function tonde.move_long_form_scene(target_workspace uuid, target_production uuid, target_scene uuid,
  expected_revision integer, target_sequence uuid default null, target_act uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare moved tonde.scenes; next_order bigint; sequence_act uuid; desired_act uuid;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_scene, 'scene', expected_revision);
  desired_act := target_act;
  if target_sequence is not null then
    select q.act_id into sequence_act from tonde.sequences q where q.workspace_id = target_workspace
      and q.production_id = target_production and q.id = target_sequence and q.lifecycle = 'active';
    if not found then raise exception 'Target Sequence is unavailable in this Production' using errcode = 'P0002'; end if;
    if desired_act is not null and desired_act is distinct from sequence_act then
      raise exception 'The Scene moves with its Sequence''s Act' using errcode = '23514';
    end if;
    desired_act := sequence_act;
  elsif desired_act is not null and not exists(select 1 from tonde.acts a where a.workspace_id = target_workspace
    and a.production_id = target_production and a.id = desired_act and a.lifecycle = 'active') then
    raise exception 'Target Act is unavailable in this Production' using errcode = 'P0002';
  end if;
  select coalesce(max(s.sort_order), 0) + 1024 into next_order from tonde.scenes s
    where s.workspace_id = target_workspace and s.production_id = target_production;
  update tonde.scenes set sequence_id = target_sequence, act_id = desired_act, sort_order = next_order
    where workspace_id = target_workspace and production_id = target_production and id = target_scene
  returning * into moved;
  return jsonb_build_object('scene_id', moved.id, 'sequence_id', moved.sequence_id, 'act_id', moved.act_id,
    'sort_order', moved.sort_order, 'revision', moved.revision, 'shots_unchanged',
      (select count(*) from tonde.shots h where h.workspace_id = target_workspace and h.production_id = target_production
        and h.scene_id = target_scene),
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

create function tonde.move_long_form_sequence(target_workspace uuid, target_production uuid, target_sequence uuid,
  expected_revision integer, target_act uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare moved tonde.sequences; next_order bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.lf_node_guard(target_workspace, target_production, 'sequence', target_sequence, expected_revision);
  if target_act is not null and not exists(select 1 from tonde.acts a where a.workspace_id = target_workspace
    and a.production_id = target_production and a.id = target_act and a.lifecycle = 'active') then
    raise exception 'Target Act is unavailable in this Production' using errcode = 'P0002';
  end if;
  select coalesce(max(q.sort_order), 0) + 1024 into next_order from tonde.sequences q
    where q.workspace_id = target_workspace and q.production_id = target_production;
  update tonde.sequences set act_id = target_act, sort_order = next_order
    where workspace_id = target_workspace and production_id = target_production and id = target_sequence
  returning * into moved;
  update tonde.scenes set act_id = target_act where workspace_id = target_workspace
    and production_id = target_production and sequence_id = target_sequence and lifecycle = 'active';
  return jsonb_build_object('sequence_id', moved.id, 'act_id', moved.act_id, 'sort_order', moved.sort_order,
    'revision', moved.revision, 'scenes_moved', (select count(*) from tonde.scenes s
      where s.workspace_id = target_workspace and s.production_id = target_production and s.sequence_id = target_sequence),
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

-- Explicit split: children at or after the split order move into a NEW Act/Sequence. No Scene
-- or Shot is duplicated, and the split point is the creator's declared order.
create function tonde.split_long_form_structure(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid, split_order bigint, expected_revision integer,
  new_title text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source_title text; created_id uuid; next_order bigint; moved_sequences integer := 0;
  moved_scenes integer := 0; source_act uuid; title_value text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_level not in ('act','sequence') then
    raise exception 'Split applies to an Act or a Sequence' using errcode = '22023';
  end if;
  perform tonde_private.lf_node_guard(target_workspace, target_production, target_level, target_id, expected_revision);
  if target_level = 'act' then
    select a.title into source_title from tonde.acts a where a.workspace_id = target_workspace
      and a.production_id = target_production and a.id = target_id;
    title_value := left(coalesce(nullif(btrim(new_title),''), source_title || ' - part 2'), 160);
    select coalesce(max(a.sort_order), 0) + 1024 into next_order from tonde.acts a
      where a.workspace_id = target_workspace and a.production_id = target_production;
    insert into tonde.acts(workspace_id, production_id, title, purpose, sort_order)
    values (target_workspace, target_production, title_value, '', next_order) returning id into created_id;
    update tonde.sequences set act_id = created_id where workspace_id = target_workspace
      and production_id = target_production and act_id = target_id and lifecycle = 'active' and sort_order >= split_order;
    get diagnostics moved_sequences = row_count;
    update tonde.scenes set act_id = created_id where workspace_id = target_workspace
      and production_id = target_production and act_id = target_id and sequence_id is null
      and lifecycle = 'active' and sort_order >= split_order;
    get diagnostics moved_scenes = row_count;
  else
    select q.title, q.act_id into source_title, source_act from tonde.sequences q where q.workspace_id = target_workspace
      and q.production_id = target_production and q.id = target_id;
    title_value := left(coalesce(nullif(btrim(new_title),''), source_title || ' - part 2'), 160);
    select coalesce(max(q.sort_order), 0) + 1024 into next_order from tonde.sequences q
      where q.workspace_id = target_workspace and q.production_id = target_production;
    insert into tonde.sequences(workspace_id, production_id, act_id, title, purpose, sort_order)
    values (target_workspace, target_production, source_act, title_value, '', next_order) returning id into created_id;
    update tonde.scenes set sequence_id = created_id where workspace_id = target_workspace
      and production_id = target_production and sequence_id = target_id and lifecycle = 'active' and sort_order >= split_order;
    get diagnostics moved_scenes = row_count;
  end if;
  return jsonb_build_object('level', target_level, 'source_id', target_id, 'created_id', created_id,
    'title', title_value, 'moved_sequences', moved_sequences, 'moved_scenes', moved_scenes,
    'timing', tonde_private.lf_production_timing(target_workspace, target_production));
end $$;

create function tonde.reorder_long_form(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, ordered_ids uuid[], expected_production_revision integer,
  parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare live_count integer; provided_count integer; base_order bigint;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_level not in ('act','sequence') then raise exception 'Reorder applies to Acts or Sequences' using errcode = '22023'; end if;
  if expected_production_revision is not null
    and tonde_private.lf_structure_revision(target_workspace, target_production) <> expected_production_revision then
    raise exception 'The structure changed since you loaded it' using errcode = '40001';
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

create function tonde.set_long_form_approval(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid, desired_approval text, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare resulting tonde.approval; resulting_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_level not in ('act','sequence') then raise exception 'Approval scope must be act or sequence here' using errcode = '22023'; end if;
  if desired_approval not in ('draft','needs_review','approved','changed_after_approval') then
    raise exception 'Unsupported approval state' using errcode = '22023';
  end if;
  perform tonde_private.lf_node_guard(target_workspace, target_production, target_level, target_id, expected_revision);
  if target_level = 'act' then
    update tonde.acts set approval = desired_approval::tonde.approval
      where workspace_id = target_workspace and production_id = target_production and id = target_id
      returning approval, revision into resulting, resulting_revision;
  else
    update tonde.sequences set approval = desired_approval::tonde.approval
      where workspace_id = target_workspace and production_id = target_production and id = target_id
      returning approval, revision into resulting, resulting_revision;
  end if;
  return jsonb_build_object('level', target_level, 'id', target_id, 'approval', resulting, 'revision', resulting_revision);
end $$;

create function tonde.set_long_form_lock(target_workspace uuid, target_production uuid,
  target_level tonde.structure_level, target_id uuid, locked boolean, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare resulting_revision integer; resulting_locked timestamptz;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_level not in ('act','sequence') then raise exception 'Lock scope must be act or sequence here' using errcode = '22023'; end if;
  if expected_revision is not null and tonde_private.lf_scope_revision(target_workspace, target_production, target_level, target_id) <> expected_revision then
    raise exception 'That object changed since you loaded it' using errcode = '40001';
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

-- 16. Series helpers. Series context is REFERENCED, never copied into every Episode row.
create function tonde_private.lf_series_for(target_workspace uuid, target_series uuid) returns tonde.series
language plpgsql stable security definer set search_path = '' as $$
declare row_value tonde.series;
begin
  select * into row_value from tonde.series where workspace_id = target_workspace and id = target_series;
  if not found then raise exception 'Series unavailable' using errcode = 'P0002'; end if;
  return row_value;
end $$;

create function tonde_private.lf_series_revision_guard(target_workspace uuid, target_series uuid, expected_revision integer)
returns tonde.series language plpgsql security definer set search_path = '' as $$
declare row_value tonde.series;
begin
  perform tonde_private.director_guard(target_workspace);
  row_value := tonde_private.lf_series_for(target_workspace, target_series);
  if row_value.lifecycle <> 'active' then raise exception 'This Series is archived' using errcode = '23514'; end if;
  if expected_revision is not null and row_value.revision <> expected_revision then
    raise exception 'The Series changed since you loaded it' using errcode = '40001';
  end if;
  return row_value;
end $$;

create function tonde_private.lf_bind_asset(target_workspace uuid, target_production uuid, target_asset uuid,
  role_value text, expected_type tonde.asset_type) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if target_asset is null then return false; end if;
  if not exists(select 1 from tonde.assets a where a.workspace_id = target_workspace and a.id = target_asset
    and a.asset_type = expected_type and a.lifecycle = 'active') then return false; end if;
  if exists(select 1 from tonde.scope_bindings b where b.workspace_id = target_workspace
    and b.production_id = target_production and b.scope_object_id = target_production
    and b.asset_id = target_asset and b.binding_role = role_value::tonde.binding_role) then return true; end if;
  insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
  values (target_workspace, target_production, target_production, target_asset, role_value::tonde.binding_role, 'inherit');
  return true;
end $$;

-- Episode inheritance: series-level reusable context flows into the Episode Production as an
-- inheriting binding on the canonical Asset. A production-specific override adds its own
-- binding later and never mutates the Series row.
create function tonde_private.lf_inherit_series_context(target_workspace uuid, series_row tonde.series, target_production uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare format jsonb := coalesce(series_row.format, '{}'::jsonb); item text; bound integer := 0;
begin
  if tonde_private.lf_bind_asset(target_workspace, target_production,
      nullif(format->>'style_bible_id','')::uuid, 'style', 'style_bible') then bound := bound + 1; end if;
  if tonde_private.lf_bind_asset(target_workspace, target_production,
      nullif(format->>'host_asset_id','')::uuid, 'character', 'character') then bound := bound + 1; end if;
  for item in select jsonb_array_elements_text(coalesce(format->'character_ids','[]'::jsonb)) loop
    if tonde_private.lf_bind_asset(target_workspace, target_production, item::uuid, 'character', 'character')
      then bound := bound + 1; end if;
  end loop;
  for item in select jsonb_array_elements_text(coalesce(format->'environment_ids','[]'::jsonb)) loop
    if tonde_private.lf_bind_asset(target_workspace, target_production, item::uuid, 'world', 'environment')
      then bound := bound + 1; end if;
  end loop;
  for item in select jsonb_array_elements_text(coalesce(format->'product_ids','[]'::jsonb)) loop
    if tonde_private.lf_bind_asset(target_workspace, target_production, item::uuid, 'product', 'product')
      then bound := bound + 1; end if;
  end loop;
  for item in select jsonb_array_elements_text(coalesce(format->'wardrobe_ids','[]'::jsonb)) loop
    if tonde_private.lf_bind_asset(target_workspace, target_production, item::uuid, 'wardrobe', 'wardrobe')
      then bound := bound + 1; end if;
  end loop;
  for item in select jsonb_array_elements_text(coalesce(format->'prop_ids','[]'::jsonb)) loop
    if tonde_private.lf_bind_asset(target_workspace, target_production, item::uuid, 'prop', 'prop')
      then bound := bound + 1; end if;
  end loop;
  for item in select jsonb_array_elements_text(coalesce(format->'voice_ids','[]'::jsonb)) loop
    if tonde_private.lf_bind_asset(target_workspace, target_production, item::uuid, 'voice', 'voice')
      then bound := bound + 1; end if;
  end loop;
  return jsonb_build_object('bound', bound, 'note', 'Canonical Assets are referenced through inheriting bindings, not copied.');
end $$;

-- Deterministic slot calculation. Dates come from the Series' own timezone and cadence, never
-- from server UTC, and an occupied slot is always reported instead of being reused.
create function tonde_private.lf_slots(target_workspace uuid, target_series uuid,
  target_horizon tonde.generate_horizon, requested_count integer, base_date date)
returns table(out_slot_key text, out_planned_date date, out_episode_number bigint, out_occupancy text,
  out_existing_episode_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare series_row tonde.series; cadence jsonb; kind text; step_days integer; weekdays integer[];
  wanted integer; produced integer := 0; cursor_date date; next_number bigint;
  key_value text; date_value date; number_value bigint; state_value text; existing_value uuid;
begin
  series_row := tonde_private.lf_series_for(target_workspace, target_series);
  cadence := coalesce(series_row.cadence_metadata, '{}'::jsonb);
  kind := coalesce(nullif(cadence->>'kind',''), 'daily');
  if kind not in ('daily','weekdays','weekly','selected_weekdays','custom','none') then
    raise exception 'Unsupported cadence kind' using errcode = '22023';
  end if;
  step_days := greatest(coalesce(nullif(cadence->>'every_days','')::integer, case when kind = 'weekly' then 7 else 1 end), 1);
  weekdays := coalesce((select array_agg(value::integer order by value::integer)
    from jsonb_array_elements_text(coalesce(cadence->'weekdays','[]'::jsonb)) as value), '{}'::integer[]);
  if kind in ('weekdays','selected_weekdays') and coalesce(array_length(weekdays,1), 0) = 0 then
    if kind = 'weekdays' then weekdays := array[1,2,3,4,5];
    else raise exception 'This cadence needs at least one weekday' using errcode = '23514'; end if;
  end if;
  if target_horizon = 'tomorrow' then wanted := 1;
  elsif target_horizon = 'next_7' then wanted := 7;
  elsif target_horizon = 'next_14' then wanted := 14;
  elsif target_horizon = 'next_30' then wanted := 30;
  elsif target_horizon = 'custom' then wanted := requested_count;
  else
    wanted := nullif(coalesce(nullif(series_row.format->>'planned_episodes','')::integer, 0), 0);
    if wanted is null then
      raise exception 'This Series is open-ended. Choose a finite horizon or a custom count instead.' using errcode = '23514';
    end if;
  end if;
  if wanted is null or wanted < 1 or wanted > 400 then
    raise exception 'Generate Ahead needs between 1 and 400 slots' using errcode = '22023';
  end if;
  select coalesce(max(e.episode_number), 0) into number_value from tonde.series_episodes e
    where e.series_id = target_series;
  next_number := number_value + 1;
  if kind = 'none' then
    cursor_date := null;
  else
    cursor_date := coalesce(base_date, (now() at time zone series_row.timezone)::date + 1);
  end if;
  while produced < wanted loop
    if kind = 'none' then
      key_value := 'count:' || next_number::text;
      date_value := null;
    else
      if kind in ('weekdays','selected_weekdays') then
        while not (extract(isodow from cursor_date)::integer = any(weekdays)) loop
          cursor_date := cursor_date + 1;
        end loop;
      end if;
      key_value := to_char(cursor_date, 'YYYY-MM-DD');
      date_value := cursor_date;
    end if;
    select e.id into existing_value from tonde.series_episodes e
      where e.series_id = target_series and e.workspace_id = target_workspace
        and (e.slot_key = key_value or (e.planned_date is not null and e.planned_date = date_value))
      order by e.episode_number limit 1;
    if existing_value is not null then
      select e.episode_number into number_value from tonde.series_episodes e where e.id = existing_value;
      state_value := 'occupied';
    else
      number_value := next_number;
      next_number := next_number + 1;
      state_value := 'open';
    end if;
    out_slot_key := key_value; out_planned_date := date_value; out_episode_number := number_value;
    out_occupancy := state_value; out_existing_episode_id := existing_value;
    produced := produced + 1;
    return next;
    if kind <> 'none' then cursor_date := cursor_date + step_days; end if;
  end loop;
end $$;

create function tonde_private.lf_episode_title(series_row tonde.series, slot_date date, slot_number bigint, topic text)
returns text language plpgsql immutable set search_path = '' as $$
declare pattern text; value text;
begin
  if coalesce(btrim(topic), '') <> '' then return left(btrim(topic), 160); end if;
  pattern := coalesce(nullif(series_row.format->>'title_pattern',''), '{series} {n}');
  value := replace(replace(replace(pattern, '{series}', series_row.title), '{n}', slot_number::text),
    '{date}', coalesce(to_char(slot_date, 'YYYY-MM-DD'), 'entry ' || slot_number::text));
  if value = pattern then value := value || ' ' || slot_number::text; end if;
  return left(value, 160);
end $$;

create function tonde_private.lf_line_state(target_workspace uuid, target_production uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare live_shots integer; planned_shots integer; scene_count integer; activity integer; reviewed integer;
  complete_plan boolean; approved_result integer;
begin
  select count(*) into scene_count from tonde.scenes s where s.workspace_id = target_workspace
    and s.production_id = target_production and s.lifecycle = 'active';
  select count(*), count(*) filter (where p.id is not null) into live_shots, planned_shots
    from tonde.shots h left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
    where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active';
  select count(*) into reviewed from tonde.results r where r.workspace_id = target_workspace
    and r.production_id = target_production and r.state in ('raw','needs_review');
  select count(*) into approved_result from tonde.results r where r.workspace_id = target_workspace
    and r.production_id = target_production and r.state in ('approved','final');
  select count(*) into activity from tonde.shots h
    left join tonde.shot_capture_state cs on cs.workspace_id = h.workspace_id and cs.shot_id = h.id
    where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active'
      and cs.status in ('setup','shooting','captured','pickup_needed');
  if scene_count = 0 and live_shots = 0 then
    if exists(select 1 from tonde.creative_documents d where d.workspace_id = target_workspace and d.production_id = target_production
      and d.document_type = 'brief') then return 'brief'; end if;
    if exists(select 1 from tonde.creative_documents d where d.workspace_id = target_workspace and d.production_id = target_production
      and d.document_type in ('story','treatment')) then return 'story'; end if;
    return 'idea';
  end if;
  if scene_count > 0 and live_shots = 0 then
    if exists(select 1 from tonde.creative_documents d where d.workspace_id = target_workspace and d.production_id = target_production
      and d.document_type = 'script') and scene_count > 0 then return 'script'; end if;
    return 'scene_plan';
  end if;
  complete_plan := live_shots > 0 and planned_shots = live_shots;
  if reviewed > 0 then return 'review'; end if;
  if complete_plan and exists(select 1 from tonde.productions p where p.workspace_id = target_workspace
    and p.id = target_production and p.approval = 'approved') and live_shots > 0
    and approved_result >= live_shots then return 'complete'; end if;
  if exists(select 1 from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production
    and p.approval = 'approved') then return 'approved'; end if;
  if activity > 0 or exists(select 1 from tonde.ai_generation_attempts a where a.workspace_id = target_workspace
    and a.production_id = target_production and a.status in ('planned','submitted','succeeded')) then return 'in_production'; end if;
  if complete_plan then return 'ready_to_execute'; end if;
  return 'shot_plan';
end $$;

revoke all on function tonde_private.lf_series_for(uuid,uuid), tonde_private.lf_series_revision_guard(uuid,uuid,integer),
  tonde_private.lf_bind_asset(uuid,uuid,uuid,text,tonde.asset_type),
  tonde_private.lf_inherit_series_context(uuid,tonde.series,uuid),
  tonde_private.lf_slots(uuid,uuid,tonde.generate_horizon,integer,date),
  tonde_private.lf_episode_title(tonde.series,date,bigint,text),
  tonde_private.lf_line_state(uuid,uuid) from public, anon, authenticated, service_role;

create function tonde_private.lf_blockers(target_workspace uuid, target_production uuid, requested tonde.generate_depth)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb := '[]'::jsonb; depth tonde.planning_depth; timing jsonb; scenes integer;
  shots integer; unplanned integer; planned_ms bigint;
begin
  depth := tonde_private.lf_depth(target_workspace, target_production, 'production', target_production);
  timing := tonde_private.lf_production_timing(target_workspace, target_production);
  select count(*) into scenes from tonde.scenes s where s.workspace_id = target_workspace
    and s.production_id = target_production and s.lifecycle = 'active';
  select count(*), count(*) filter (where p.id is null) into shots, unplanned
    from tonde.shots h left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
    where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active';
  select planned_duration_ms into planned_ms from tonde.productions
    where workspace_id = target_workspace and id = target_production;
  if scenes = 0 then
    items := items || jsonb_build_array(jsonb_build_object('code','no_scenes','severity',
      case when requested in ('story','script','complete_plan') then 'blocking' else 'warning' end,
      'message','This Episode has no Scenes yet.','action','Build or generate the Scene plan.'));
  end if;
  if requested in ('story','script','complete_plan') and depth < 'story_defined' then
    items := items || jsonb_build_array(jsonb_build_object('code','requested_depth_missing','severity','blocking',
      'message','Generate Ahead recorded ' || requested::text || ' as the requested depth, but the Story is not written yet.',
      'action','Write or generate the Story for this Episode.'));
  end if;
  if requested in ('script','complete_plan') and depth < 'scripted' and scenes > 0 then
    items := items || jsonb_build_array(jsonb_build_object('code','script_missing','severity','warning',
      'message','No Script document exists for this Episode yet.','action','Write or generate the Script.'));
  end if;
  if scenes > 0 and planned_ms is null then
    items := items || jsonb_build_array(jsonb_build_object('code','runtime_target_missing','severity','warning',
      'message','This Episode has no runtime target, so its fit cannot be judged.','action','Set a planned runtime.'));
  end if;
  if (timing->'production'->>'status') = 'over' then
    items := items || jsonb_build_array(jsonb_build_object('code','runtime_conflict','severity','blocking',
      'message','Planned runtime is ' || coalesce(timing->'production'->>'target_label','?') || ' but the current child total is '
        || coalesce(timing->'production'->>'calculated_label','?') || ' (' || coalesce(timing->'production'->>'delta_label','?') || ').',
      'action','Shorten or reassign runtime in the affected Scenes.'));
  end if;
  if (timing->'counts'->>'scenes_without_shots')::integer > 0 then
    items := items || jsonb_build_array(jsonb_build_object('code','scenes_without_shots','severity','warning',
      'message',(timing->'counts'->>'scenes_without_shots') || ' Scene(s) still have no Shots.',
      'action','Plan the Shots for those Scenes.'));
  end if;
  if shots > 0 and unplanned > 0 then
    items := items || jsonb_build_array(jsonb_build_object('code','shots_without_execution_plan','severity','warning',
      'message',unplanned || ' Shot(s) have no execution plan.',
      'action','Direct those Shots in Real Production or AI Creation.'));
  end if;
  if (timing->'counts'->>'scenes_incomplete_timing')::integer > 0 then
    items := items || jsonb_build_array(jsonb_build_object('code','timing_incomplete','severity','warning',
      'message',(timing->'counts'->>'scenes_incomplete_timing') || ' Scene(s) have Shots without durations, so their runtime is planned rather than derived.',
      'action','Give every Shot an exact duration.'));
  end if;
  if exists(select 1 from tonde.shots h join tonde.shot_capture_state cs
      on cs.workspace_id = h.workspace_id and cs.shot_id = h.id
      where h.workspace_id = target_workspace and h.production_id = target_production
        and h.lifecycle = 'active' and cs.status = 'pickup_needed') then
    items := items || jsonb_build_array(jsonb_build_object('code','pickup_required','severity','blocking',
      'message','A Shot is marked pickup required.','action','Schedule the pickup or record a new take.'));
  end if;
  return items;
end $$;

-- One shared planner for preview and apply, so the preview cannot disagree with the result.
create function tonde_private.lf_generate_plan(target_workspace uuid, series_row tonde.series, request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare horizon tonde.generate_horizon; depth tonde.generate_depth; slots jsonb; counts jsonb;
  holds text[]; reuse jsonb; recent jsonb; depth_label text;
begin
  horizon := coalesce(nullif(request->>'horizon',''), '')::tonde.generate_horizon;
  if horizon is null or not (horizon::text = any(enum_range(null::tonde.generate_horizon)::text[])) then
    raise exception 'Choose a Generate Ahead horizon' using errcode = '22023';
  end if;
  depth := coalesce(nullif(request->>'depth',''), '')::tonde.generate_depth;
  if depth is null or not (depth::text = any(enum_range(null::tonde.generate_depth)::text[])) then
    raise exception 'Choose a Generate Ahead depth' using errcode = '22023';
  end if;
  holds := coalesce(array(select jsonb_array_elements_text(coalesce(request->'hold_slots','[]'::jsonb))), '{}'::text[]);
  select coalesce(jsonb_agg(jsonb_build_object('slot_key', s.out_slot_key, 'planned_date', s.out_planned_date,
      'episode_number', s.out_episode_number,
      'state', case when s.out_occupancy = 'occupied' then 'preserved'
        when s.out_slot_key = any(holds) then 'held' else 'open' end,
      'existing_episode_id', s.out_existing_episode_id)
      order by s.out_planned_date nulls last, s.out_episode_number), '[]'::jsonb),
    jsonb_build_object(
      'open', count(*) filter (where s.out_occupancy = 'open' and not (s.out_slot_key = any(holds))),
      'preserved', count(*) filter (where s.out_occupancy = 'occupied'),
      'held', count(*) filter (where s.out_occupancy = 'open' and s.out_slot_key = any(holds)),
      'total', count(*))
    into slots, counts
  from tonde_private.lf_slots(target_workspace, series_row.id, horizon,
    coalesce(nullif(request->>'count','')::integer, 0), nullif(request->>'base_date','')::date) s;
  select coalesce(jsonb_agg(jsonb_build_object('asset_id', b.asset_id, 'name', a.name, 'asset_type', a.asset_type,
      'role', b.binding_role) order by a.name), '[]'::jsonb) into reuse
  from tonde.scope_bindings b join tonde.assets a on a.workspace_id = b.workspace_id and a.id = b.asset_id
  where b.workspace_id = target_workspace and b.asset_id in (
    select nullif(series_row.format->>'style_bible_id','')::uuid
    union all select nullif(series_row.format->>'host_asset_id','')::uuid
    union all select jsonb_array_elements_text(coalesce(series_row.format->'character_ids','[]'::jsonb))::uuid
    union all select jsonb_array_elements_text(coalesce(series_row.format->'environment_ids','[]'::jsonb))::uuid
    union all select jsonb_array_elements_text(coalesce(series_row.format->'product_ids','[]'::jsonb))::uuid);
  select coalesce(jsonb_agg(jsonb_build_object('episode_number', e.episode_number, 'title', e.title,
      'planned_date', e.planned_date) order by e.episode_number desc), '[]'::jsonb) into recent
  from (select * from tonde.series_episodes e where e.workspace_id = target_workspace and e.series_id = series_row.id
    and e.lifecycle = 'active' order by e.episode_number desc limit 5) e;
  depth_label := case depth when 'ideas_only' then 'Ideas Only' when 'briefs' then 'Briefs' when 'story' then 'Story'
    when 'script' then 'Script' else 'Complete Production Plan' end;
  return jsonb_build_object('horizon', horizon, 'depth', depth, 'depth_label', depth_label,
    'timezone', series_row.timezone, 'today', (now() at time zone series_row.timezone)::date,
    'slots', slots, 'counts', counts, 'reuse', reuse, 'recent_titles', recent,
    'requires_confirmation', (counts->>'open')::integer > 0,
    'reuse_note', 'Series-level Assets are referenced through inheriting bindings; this Episode is a new Production.',
    'depth_note', 'Generate Ahead records the requested depth and creates the Production shell. It never fabricates Story, Script, Scenes, Shots or paid generation attempts.',
    'do_not_overwrite', 'Existing Episodes at these slots are preserved and never overwritten.');
end $$;
revoke all on function tonde_private.lf_blockers(uuid,uuid,tonde.generate_depth),
  tonde_private.lf_generate_plan(uuid,tonde.series,jsonb) from public, anon, authenticated, service_role;

-- 17. Series RPCs.
create function tonde.create_series(target_workspace uuid, target_project uuid, series jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created tonde.series; title_value text; kind_value text; tz_value text;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(series) <> 'object' then raise exception 'Invalid Series payload' using errcode = '22023'; end if;
  if not exists(select 1 from tonde.projects p where p.workspace_id = target_workspace and p.id = target_project
    and p.lifecycle = 'active') then raise exception 'Project unavailable' using errcode = 'P0002'; end if;
  title_value := btrim(coalesce(series->>'title',''));
  if length(title_value) = 0 or length(title_value) > 160 then
    raise exception 'A Series needs a title of 1 to 160 characters' using errcode = '22023';
  end if;
  kind_value := coalesce(nullif(series->>'series_kind',''), 'recurring');
  if kind_value not in ('narrative','recurring') then raise exception 'Series kind must be narrative or recurring' using errcode = '22023'; end if;
  tz_value := btrim(coalesce(nullif(series->>'timezone',''), 'UTC'));
  if length(tz_value) = 0 or length(tz_value) > 60 then raise exception 'A Series needs a timezone' using errcode = '22023'; end if;
  if coalesce(series->'format','{}'::jsonb) is not null and jsonb_typeof(coalesce(series->'format','{}'::jsonb)) <> 'object' then
    raise exception 'Invalid Series format' using errcode = '22023';
  end if;
  insert into tonde.series(workspace_id, project_id, title, series_kind, format, timezone, cadence_metadata)
  values (target_workspace, target_project, left(title_value,160), kind_value::tonde.series_kind,
    coalesce(series->'format','{}'::jsonb), tz_value, coalesce(series->'cadence_metadata','{}'::jsonb))
  returning * into created;
  return jsonb_build_object('series_id', created.id, 'title', created.title, 'series_kind', created.series_kind,
    'timezone', created.timezone, 'revision', created.revision,
    'cadence_metadata', created.cadence_metadata, 'format', created.format);
end $$;

create function tonde.update_series(target_workspace uuid, target_series uuid, expected_revision integer, patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current tonde.series; updated tonde.series; title_value text; tz_value text; lifecycle_value text;
begin
  if jsonb_typeof(patch) <> 'object' then raise exception 'Invalid Series patch' using errcode = '22023'; end if;
  current := tonde_private.lf_series_revision_guard(target_workspace, target_series, expected_revision);
  title_value := current.title;
  if patch ? 'title' then
    title_value := btrim(coalesce(patch->>'title',''));
    if length(title_value) = 0 or length(title_value) > 160 then
      raise exception 'A Series needs a title of 1 to 160 characters' using errcode = '22023';
    end if;
  end if;
  tz_value := current.timezone;
  if patch ? 'timezone' then
    tz_value := btrim(coalesce(nullif(patch->>'timezone',''), 'UTC'));
    if length(tz_value) = 0 or length(tz_value) > 60 then raise exception 'A Series needs a timezone' using errcode = '22023'; end if;
  end if;
  lifecycle_value := current.lifecycle::text;
  if patch ? 'lifecycle' then
    lifecycle_value := coalesce(nullif(patch->>'lifecycle',''), 'active');
    if lifecycle_value not in ('active','archived') then raise exception 'Series archive rather than delete' using errcode = '22023'; end if;
  end if;
  if patch ? 'series_kind' and coalesce(nullif(patch->>'series_kind',''),'recurring') not in ('narrative','recurring') then
    raise exception 'Series kind must be narrative or recurring' using errcode = '22023';
  end if;
  update tonde.series set title = title_value, timezone = tz_value, lifecycle = lifecycle_value::tonde.lifecycle,
    series_kind = case when patch ? 'series_kind' then coalesce(nullif(patch->>'series_kind',''),'recurring')::tonde.series_kind else series_kind end,
    format = case when patch ? 'format' then coalesce(patch->'format','{}'::jsonb) else format end,
    cadence_metadata = case when patch ? 'cadence_metadata' then coalesce(patch->'cadence_metadata','{}'::jsonb) else cadence_metadata end,
    summary = case when patch ? 'summary' then coalesce(patch->'summary','{}'::jsonb) else summary end,
    bible_document_id = case when patch ? 'bible_document_id' then nullif(coalesce(patch->>'bible_document_id',''),'')::uuid else bible_document_id end
  where workspace_id = target_workspace and id = target_series returning * into updated;
  return jsonb_build_object('series_id', updated.id, 'revision', updated.revision, 'title', updated.title,
    'series_kind', updated.series_kind, 'timezone', updated.timezone, 'lifecycle', updated.lifecycle,
    'cadence_metadata', updated.cadence_metadata, 'format', updated.format);
end $$;

create function tonde.save_series_collection(target_workspace uuid, target_series uuid, collection jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created tonde.series_collections; title_value text; target uuid; next_order bigint;
begin
  perform tonde_private.director_guard(target_workspace);
  perform tonde_private.lf_series_for(target_workspace, target_series);
  if jsonb_typeof(collection) <> 'object' then raise exception 'Invalid Collection payload' using errcode = '22023'; end if;
  title_value := btrim(coalesce(collection->>'title',''));
  if length(title_value) = 0 or length(title_value) > 160 then
    raise exception 'A Season or Collection needs a title of 1 to 160 characters' using errcode = '22023';
  end if;
  target := nullif(coalesce(collection->>'collection_id',''),'')::uuid;
  if target is null then
    select coalesce(max(c.sort_order), 0) + 1024 into next_order from tonde.series_collections c
      where c.workspace_id = target_workspace and c.series_id = target_series;
    insert into tonde.series_collections(workspace_id, series_id, title, purpose, sort_order)
    values (target_workspace, target_series, left(title_value,160), left(coalesce(collection->>'purpose',''),1200), next_order)
    returning * into created;
  else
    update tonde.series_collections set title = left(title_value,160),
      purpose = case when collection ? 'purpose' then left(coalesce(collection->>'purpose',''),1200) else purpose end,
      lifecycle = case when collection ? 'lifecycle' then coalesce(nullif(collection->>'lifecycle',''),'active')::tonde.lifecycle else lifecycle end
    where workspace_id = target_workspace and series_id = target_series and id = target
    returning * into created;
    if not found then raise exception 'Collection unavailable' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('collection_id', created.id, 'title', created.title, 'sort_order', created.sort_order,
    'lifecycle', created.lifecycle, 'revision', created.revision);
end $$;

create function tonde.series_overview(target_workspace uuid, target_series uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare series_row tonde.series; collections jsonb; counts jsonb; reuse jsonb; upcoming jsonb; last_job jsonb;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  series_row := tonde_private.lf_series_for(target_workspace, target_series);
  select coalesce(jsonb_agg(jsonb_build_object('collection_id', c.id, 'title', c.title, 'purpose', c.purpose,
      'sort_order', c.sort_order, 'lifecycle', c.lifecycle,
      'episodes', (select count(*) from tonde.series_episodes e where e.workspace_id = target_workspace
        and e.collection_id = c.id and e.lifecycle = 'active')) order by c.sort_order, c.id), '[]'::jsonb)
    into collections from tonde.series_collections c
  where c.workspace_id = target_workspace and c.series_id = target_series;
  select jsonb_build_object(
    'episodes_active', (select count(*) from tonde.series_episodes e where e.workspace_id = target_workspace
      and e.series_id = target_series and e.lifecycle = 'active'),
    'episodes_archived', (select count(*) from tonde.series_episodes e where e.workspace_id = target_workspace
      and e.series_id = target_series and e.lifecycle <> 'active'),
    'collections', (select count(*) from tonde.series_collections c where c.workspace_id = target_workspace
      and c.series_id = target_series),
    'planned_episodes', nullif(series_row.format->>'planned_episodes',''),
    'next_episode_number', (select coalesce(max(e.episode_number), 0) + 1 from tonde.series_episodes e
      where e.workspace_id = target_workspace and e.series_id = target_series)) into counts;
  select coalesce(jsonb_agg(jsonb_build_object('asset_id', a.id, 'name', a.name, 'asset_type', a.asset_type,
      'missing', false) order by a.name), '[]'::jsonb) into reuse
  from tonde.assets a where a.workspace_id = target_workspace and a.id in (
    select nullif(series_row.format->>'style_bible_id','')::uuid
    union all select nullif(series_row.format->>'host_asset_id','')::uuid
    union all select jsonb_array_elements_text(coalesce(series_row.format->'character_ids','[]'::jsonb))::uuid
    union all select jsonb_array_elements_text(coalesce(series_row.format->'environment_ids','[]'::jsonb))::uuid
    union all select jsonb_array_elements_text(coalesce(series_row.format->'product_ids','[]'::jsonb))::uuid
    union all select jsonb_array_elements_text(coalesce(series_row.format->'wardrobe_ids','[]'::jsonb))::uuid
    union all select jsonb_array_elements_text(coalesce(series_row.format->'prop_ids','[]'::jsonb))::uuid);
  select coalesce(jsonb_agg(jsonb_build_object('episode_id', e.id, 'episode_number', e.episode_number,
      'title', e.title, 'planned_date', e.planned_date, 'production_id', e.production_id,
      'production_line_state', tonde_private.lf_line_state(target_workspace, e.production_id),
      'depth', tonde_private.lf_depth(target_workspace, e.production_id, 'production', e.production_id))
      order by e.planned_date nulls last, e.episode_number), '[]'::jsonb) into upcoming
  from (select * from tonde.series_episodes e where e.workspace_id = target_workspace and e.series_id = target_series
    and e.lifecycle = 'active' order by coalesce(e.planned_date, '9999-12-31'::date), e.episode_number limit 10) e;
  select jsonb_build_object('job_id', j.id, 'state', j.state, 'horizon', j.horizon, 'depth', j.depth,
      'created_count', j.created_count, 'preserved_count', j.preserved_count, 'blocked_count', j.blocked_count,
      'failed_count', j.failed_count, 'created_at', j.created_at)
    into last_job from tonde.generate_ahead_jobs j
    where j.workspace_id = target_workspace and j.series_id = target_series order by j.created_at desc limit 1;
  return jsonb_build_object('series_id', series_row.id, 'title', series_row.title, 'series_kind', series_row.series_kind,
    'timezone', series_row.timezone, 'lifecycle', series_row.lifecycle, 'revision', series_row.revision,
    'cadence_metadata', series_row.cadence_metadata, 'format', series_row.format, 'summary', series_row.summary,
    'bible_document_id', series_row.bible_document_id, 'collections', collections, 'counts', counts,
    'reuse', reuse, 'upcoming', upcoming, 'last_generate_ahead', last_job,
    'note', 'Recurring context is referenced, never copied: each Episode stays its own canonical Production.');
end $$;

create function tonde_private.lf_new_shell(target_workspace uuid, series_row tonde.series, title text,
  runtime_target_ms bigint) returns uuid language plpgsql security definer set search_path = '' as $$
declare prod uuid; type_value text; method_value text; format jsonb := coalesce(series_row.format, '{}'::jsonb);
begin
  type_value := coalesce(nullif(format->>'production_type',''), 'recurring_content');
  if not (type_value = any(enum_range(null::tonde.production_type)::text[])) then
    raise exception 'Unsupported Series production type' using errcode = '22023';
  end if;
  method_value := coalesce(nullif(format->>'execution_method',''), 'real');
  if method_value not in ('real','ai','hybrid') then
    raise exception 'Series execution method must be real, ai or hybrid' using errcode = '22023';
  end if;
  if runtime_target_ms is null then
    runtime_target_ms := tonde_private.lf_ms(format, 'runtime_target_ms');
  end if;
  insert into tonde.productions(workspace_id, project_id, title, production_type, execution_method,
    planned_duration_ms, created_by)
  values (target_workspace, series_row.project_id, left(title,160), type_value::tonde.production_type,
    method_value::tonde.execution_method, runtime_target_ms, auth.uid()) returning id into prod;
  perform tonde_private.lf_inherit_series_context(target_workspace, series_row, prod);
  return prod;
end $$;
revoke all on function tonde_private.lf_new_shell(uuid,tonde.series,text,bigint) from public, anon, authenticated, service_role;

create function tonde.create_series_episode(target_workspace uuid, target_series uuid, episode jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare series_row tonde.series; created tonde.series_episodes; prod uuid; title_value text;
  number_value bigint; slot_value text; existing uuid; runtime_value bigint; topic text; note text;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(episode) <> 'object' then raise exception 'Invalid Episode payload' using errcode = '22023'; end if;
  series_row := tonde_private.lf_series_for(target_workspace, target_series);
  if series_row.lifecycle <> 'active' then raise exception 'This Series is archived' using errcode = '23514'; end if;
  slot_value := nullif(btrim(coalesce(episode->>'slot_key','')), '');
  if slot_value is not null then
    select e.id into existing from tonde.series_episodes e where e.workspace_id = target_workspace
      and e.series_id = target_series and e.slot_key = slot_value limit 1;
    if existing is not null then
      select * into created from tonde.series_episodes where id = existing;
      return jsonb_build_object('episode_id', created.id, 'created', false, 'state', 'preserved',
        'production_id', created.production_id, 'episode_number', created.episode_number,
        'note', 'An Episode already occupies this slot, so nothing was overwritten.');
    end if;
  end if;
  topic := nullif(btrim(coalesce(episode->>'topic','')), '');
  note := left(coalesce(episode->>'note',''), 400);
  runtime_value := tonde_private.lf_ms(episode, 'runtime_target_ms');
  prod := nullif(coalesce(episode->>'production_id',''),'')::uuid;
  if prod is null then
    title_value := tonde_private.lf_episode_title(series_row, nullif(coalesce(episode->>'planned_date',''),'')::date,
      coalesce(nullif(coalesce(episode->>'episode_number',''),'')::bigint,
        (select coalesce(max(e.episode_number), 0) + 1 from tonde.series_episodes e
          where e.workspace_id = target_workspace and e.series_id = target_series)), topic);
    if coalesce(episode->>'title','') <> '' then title_value := left(btrim(episode->>'title'), 160); end if;
    prod := tonde_private.lf_new_shell(target_workspace, series_row, title_value, runtime_value);
  else
    if not exists(select 1 from tonde.productions p where p.workspace_id = target_workspace and p.id = prod
      and p.project_id = series_row.project_id) then
      raise exception 'Episode Production must belong to the Series project' using errcode = '23514';
    end if;
    title_value := left(coalesce(nullif(btrim(coalesce(episode->>'title','')),''), series_row.title), 160);
  end if;
  number_value := nullif(coalesce(episode->>'episode_number',''),'')::bigint;
  if number_value is null then
    select coalesce(max(e.episode_number), 0) + 1 into number_value from tonde.series_episodes e
      where e.workspace_id = target_workspace and e.series_id = target_series;
  end if;
  insert into tonde.series_episodes(workspace_id, series_id, collection_id, production_id, episode_number,
    planned_date, runtime_target_ms, title, slot_key, requested_depth, brief)
  values (target_workspace, target_series, nullif(coalesce(episode->>'collection_id',''),'')::uuid, prod,
    number_value, nullif(coalesce(episode->>'planned_date',''),'')::date, runtime_value, title_value, slot_value,
    case when coalesce(episode->>'requested_depth','') = '' then null
      else (episode->>'requested_depth')::tonde.generate_depth end,
    jsonb_build_object('topic', topic, 'note', note))
  returning * into created;
  return jsonb_build_object('episode_id', created.id, 'created', true, 'state', 'created',
    'production_id', created.production_id, 'episode_number', created.episode_number, 'title', created.title,
    'planned_date', created.planned_date, 'requested_depth', created.requested_depth);
end $$;

create function tonde.update_series_episode(target_workspace uuid, target_series uuid, target_episode uuid,
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
    raise exception 'The Episode changed since you loaded it' using errcode = '40001';
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

create function tonde.series_slots(target_workspace uuid, target_series uuid, target_horizon tonde.generate_horizon,
  requested_count integer default 0, base_date date default null, hold_slots text[] default '{}'::text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare series_row tonde.series; slots jsonb; counts jsonb;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  series_row := tonde_private.lf_series_for(target_workspace, target_series);
  select coalesce(jsonb_agg(jsonb_build_object('slot_key', s.out_slot_key, 'planned_date', s.out_planned_date,
      'episode_number', s.out_episode_number,
      'state', case when s.out_occupancy = 'occupied' then 'preserved'
        when s.out_slot_key = any(coalesce(hold_slots,'{}'::text[])) then 'held' else 'open' end,
      'existing_episode_id', s.out_existing_episode_id)
      order by s.out_planned_date nulls last, s.out_episode_number), '[]'::jsonb),
    jsonb_build_object('open', count(*) filter (where s.out_occupancy = 'open'
        and not (s.out_slot_key = any(coalesce(hold_slots,'{}'::text[])))),
      'preserved', count(*) filter (where s.out_occupancy = 'occupied'),
      'held', count(*) filter (where s.out_occupancy = 'open' and s.out_slot_key = any(coalesce(hold_slots,'{}'::text[]))),
      'total', count(*)) into slots, counts
  from tonde_private.lf_slots(target_workspace, target_series, target_horizon, requested_count, base_date) s;
  return jsonb_build_object('horizon', target_horizon, 'timezone', series_row.timezone,
    'today', (now() at time zone series_row.timezone)::date, 'slots', slots, 'counts', counts,
    'cadence_metadata', series_row.cadence_metadata,
    'note', 'Slot dates come from the Series timezone and cadence, never from server UTC.');
end $$;

create function tonde.generate_ahead_preview(target_workspace uuid, target_series uuid, request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare series_row tonde.series; plan jsonb; jobs jsonb;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  series_row := tonde_private.lf_series_for(target_workspace, target_series);
  plan := tonde_private.lf_generate_plan(target_workspace, series_row, coalesce(request, '{}'::jsonb));
  select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'state', j.state, 'created_count', j.created_count,
      'preserved_count', j.preserved_count, 'blocked_count', j.blocked_count, 'failed_count', j.failed_count,
      'created_at', j.created_at) order by j.created_at desc), '[]'::jsonb) into jobs
  from (select * from tonde.generate_ahead_jobs j where j.workspace_id = target_workspace and j.series_id = target_series
    order by j.created_at desc limit 3) j;
  return plan || jsonb_build_object('recent_jobs', jobs,
    'series_revision', series_row.revision,
    'note', 'Preview only: nothing was created. Existing Episodes are preserved, held slots are skipped.');
end $$;

create function tonde.generate_ahead(target_workspace uuid, target_series uuid, request jsonb)
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
    raise exception 'The Series changed since you loaded it' using errcode = '40001';
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

create function tonde.retry_generate_ahead(target_workspace uuid, target_job uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job_row tonde.generate_ahead_jobs; series_row tonde.series; item record; prod uuid; episode uuid;
  title_value text; made integer := 0; kept integer := 0;
  broke integer := 0; held integer := 0; state_value tonde.job_state;
begin
  perform tonde_private.director_guard(target_workspace);
  select * into job_row from tonde.generate_ahead_jobs where workspace_id = target_workspace and id = target_job;
  if not found then raise exception 'Generate Ahead job unavailable' using errcode = 'P0002'; end if;
  series_row := tonde_private.lf_series_for(target_workspace, job_row.series_id);
  for item in select * from tonde.generate_ahead_items i where i.workspace_id = target_workspace
    and i.job_id = target_job and i.state in ('blocked','failed') order by i.planned_date nulls last, i.episode_number
  loop
    if exists(select 1 from tonde.series_episodes e where e.workspace_id = target_workspace
      and e.series_id = job_row.series_id and (e.slot_key = item.slot_key
        or (item.planned_date is not null and e.planned_date = item.planned_date))) then
      update tonde.generate_ahead_items set state = 'preserved', error_code = null, error_message = null
        where id = item.id;
      kept := kept + 1;
      continue;
    end if;
    if item.state = 'blocked' then
      held := held + 1;
      continue;
    end if;
    begin
      -- A retry rebuilds the title from the Series title pattern: the original topic is not
      -- re-invented, and nothing about the already-created Episodes is touched.
      title_value := tonde_private.lf_episode_title(series_row, item.planned_date, item.episode_number, null);
      prod := tonde_private.lf_new_shell(target_workspace, series_row, title_value,
        tonde_private.lf_ms(coalesce(series_row.format,'{}'::jsonb), 'runtime_target_ms'));
      insert into tonde.series_episodes(workspace_id, series_id, production_id, episode_number, planned_date,
        runtime_target_ms, title, slot_key, requested_depth, brief)
      values (target_workspace, job_row.series_id, prod, item.episode_number, item.planned_date,
        tonde_private.lf_ms(coalesce(series_row.format,'{}'::jsonb), 'runtime_target_ms'), title_value,
        item.slot_key, job_row.depth, jsonb_build_object('source','generate_ahead_retry'))
      returning id into episode;
      update tonde.generate_ahead_items set state = 'created', created_production_id = prod,
        created_episode_id = episode, error_code = null, error_message = null where id = item.id;
      made := made + 1;
    exception when others then
      update tonde.generate_ahead_items set state = 'failed', error_code = left(sqlstate, 40),
        error_message = left(sqlerrm, 400) where id = item.id;
      broke := broke + 1;
    end;
  end loop;
  state_value := (case when broke > 0 or held > 0 then 'retrying' else 'succeeded' end)::tonde.job_state;
  update tonde.generate_ahead_jobs set state = state_value,
    created_count = (select count(*) from tonde.generate_ahead_items i
      where i.job_id = target_job and i.state = 'created'),
    preserved_count = (select count(*) from tonde.generate_ahead_items i
      where i.job_id = target_job and i.state = 'preserved'),
    blocked_count = (select count(*) from tonde.generate_ahead_items i where i.job_id = target_job and i.state = 'blocked'),
    failed_count = (select count(*) from tonde.generate_ahead_items i where i.job_id = target_job and i.state = 'failed')
    where id = target_job;
  return jsonb_build_object('job_id', target_job, 'state', state_value,
    'counts', jsonb_build_object('created', made, 'preserved', kept,
      'blocked', held, 'failed', broke),
    'note', 'Only blocked and failed slots were retried. Already created Episodes were untouched.');
end $$;

create function tonde.generate_ahead_jobs(target_workspace uuid, target_series uuid, target_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  perform tonde_private.lf_series_for(target_workspace, target_series);
  select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'shared_job_id', j.job_id, 'state', j.state,
      'horizon', j.horizon, 'depth', j.depth, 'timezone', j.timezone, 'created_at', j.created_at,
      'created_count', j.created_count, 'preserved_count', j.preserved_count, 'blocked_count', j.blocked_count,
      'failed_count', j.failed_count, 'note', j.note,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('slot_key', i.slot_key, 'planned_date', i.planned_date,
          'episode_number', i.episode_number, 'state', i.state, 'created_production_id', i.created_production_id,
          'created_episode_id', i.created_episode_id, 'error_message', i.error_message)
          order by i.planned_date nulls last, i.episode_number), '[]'::jsonb)
        from tonde.generate_ahead_items i where i.workspace_id = target_workspace and i.job_id = j.id))
      order by j.created_at desc), '[]'::jsonb) into items
  from (select * from tonde.generate_ahead_jobs j where j.workspace_id = target_workspace and j.series_id = target_series
    order by j.created_at desc limit least(greatest(coalesce(target_limit, 10), 1), 50)) j;
  return jsonb_build_object('jobs', items);
end $$;

-- Production Line: real production stages from real domain state, and no vanity percentage.
create function tonde.series_production_line(target_workspace uuid, target_series uuid,
  target_limit integer default 30, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  perform tonde_private.lf_series_for(target_workspace, target_series);
  select b.out_limit, b.out_offset into lim, off from tonde_private.lf_bounded(target_limit, target_offset) b;
  select coalesce(jsonb_agg(jsonb_build_object('episode_id', e.id, 'episode_number', e.episode_number,
      'title', e.title, 'planned_date', e.planned_date, 'production_id', e.production_id,
      'production_title', p.title, 'lifecycle', e.lifecycle, 'production_lifecycle', p.lifecycle,
      'requested_depth', e.requested_depth, 'depth', tonde_private.lf_depth(target_workspace, e.production_id, 'production', e.production_id),
      'line_state', tonde_private.lf_line_state(target_workspace, e.production_id),
      'approval', p.approval, 'locked', p.locked_at is not null, 'production_revision', p.revision,
      'episode_revision', e.revision,
      'collection_id', e.collection_id,
      'execution_summary', jsonb_build_object(
        'real', (select count(*) from tonde.shots h where h.workspace_id = target_workspace
          and h.production_id = e.production_id and h.lifecycle = 'active' and h.execution_method = 'real'),
        'ai', (select count(*) from tonde.shots h where h.workspace_id = target_workspace
          and h.production_id = e.production_id and h.lifecycle = 'active' and h.execution_method = 'ai'),
        'hybrid', (select count(*) from tonde.shots h where h.workspace_id = target_workspace
          and h.production_id = e.production_id and h.lifecycle = 'active' and h.execution_method = 'hybrid')),
      'timing', jsonb_build_object('production', tonde_private.lf_production_timing(target_workspace, e.production_id)->'production',
        'counts', tonde_private.lf_production_timing(target_workspace, e.production_id)->'counts'),
      'blockers', tonde_private.lf_blockers(target_workspace, e.production_id, e.requested_depth),
      'readiness', jsonb_build_object(
        'blocking', (select count(*) from jsonb_array_elements(tonde_private.lf_blockers(target_workspace, e.production_id, e.requested_depth)) b
          where b->>'severity' = 'blocking'),
        'warnings', (select count(*) from jsonb_array_elements(tonde_private.lf_blockers(target_workspace, e.production_id, e.requested_depth)) b
          where b->>'severity' = 'warning'),
        'state', case
          when (select count(*) from jsonb_array_elements(tonde_private.lf_blockers(target_workspace, e.production_id, e.requested_depth)) b
            where b->>'severity' = 'blocking') > 0 then 'BLOCKED'
          when p.approval in ('needs_review','changed_after_approval') then 'NEEDS REVIEW'
          when (select count(*) from jsonb_array_elements(tonde_private.lf_blockers(target_workspace, e.production_id, e.requested_depth)) b
            where b->>'severity' = 'warning') > 0 then 'READY WITH WARNINGS'
          else 'READY' end))
      order by e.planned_date nulls last, e.episode_number), '[]'::jsonb), count(*)
    into items, total
  from (select * from tonde.series_episodes e where e.workspace_id = target_workspace and e.series_id = target_series
    and e.lifecycle = 'active' order by coalesce(e.planned_date, '9999-12-31'::date), e.episode_number
    limit lim offset off) e
  join tonde.productions p on p.workspace_id = e.workspace_id and p.id = e.production_id;
  return jsonb_build_object('items', items, 'total', coalesce(total,0), 'limit', lim, 'offset', off,
    'truncated', coalesce(total,0) > off + jsonb_array_length(items),
    'note', 'States come from real domain state (documents, Scenes, Shots, plans, captures, Results, approval). No percentage is invented.');
end $$;

create function tonde.series_director_context(target_workspace uuid, target_series uuid, target_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare series_row tonde.series; recent jsonb; upcoming jsonb; lim integer;
begin
  perform tonde_private.lf_read_guard(target_workspace);
  series_row := tonde_private.lf_series_for(target_workspace, target_series);
  lim := least(greatest(coalesce(target_limit, 10), 1), 30);
  select coalesce(jsonb_agg(jsonb_build_object('episode_number', e.episode_number, 'title', e.title,
      'planned_date', e.planned_date, 'line_state', tonde_private.lf_line_state(target_workspace, e.production_id))
      order by e.episode_number desc), '[]'::jsonb) into recent
  from (select * from tonde.series_episodes e where e.workspace_id = target_workspace and e.series_id = target_series
    order by e.episode_number desc limit lim) e;
  select coalesce(jsonb_agg(jsonb_build_object('episode_number', e.episode_number, 'title', e.title,
      'planned_date', e.planned_date, 'state', tonde_private.lf_line_state(target_workspace, e.production_id))
      order by e.episode_number), '[]'::jsonb) into upcoming
  from (select * from tonde.series_episodes e where e.workspace_id = target_workspace and e.series_id = target_series
    and e.planned_date >= (now() at time zone series_row.timezone)::date order by e.planned_date limit lim) e;
  return jsonb_build_object('series_id', series_row.id, 'title', series_row.title,
    'series_kind', series_row.series_kind, 'timezone', series_row.timezone,
    'cadence_metadata', series_row.cadence_metadata, 'format_metadata_keys',
      coalesce((select jsonb_agg(key) from jsonb_object_keys(coalesce(series_row.format,'{}'::jsonb)) as key), '[]'::jsonb),
    'recent_titles', recent, 'upcoming', upcoming,
    'avoid_list', coalesce((select jsonb_agg(value->>'title') from jsonb_array_elements(recent) as value), '[]'::jsonb),
    'note', 'Bounded Series context: titles, dates and states only. No full historical Scripts or Story text.');
end $$;

-- 18. RLS. Every new workspace-owned table is isolated; enabling RLS is not optional.
do $$ declare item text; begin
  foreach item in array array['structure_summaries','generate_ahead_jobs','generate_ahead_items'] loop
    execute format('alter table tonde.%I enable row level security', item);
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', item);
    execute format('create policy tenant_insert on tonde.%I for insert to authenticated with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('create policy tenant_update on tonde.%I for update to authenticated using (tonde_private.can_edit_workspace(workspace_id)) with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('grant select, insert, update on tonde.%I to authenticated', item);
  end loop;
end $$;

-- 19. Privileges: authenticated only, and the private helpers stay unreachable.
revoke all on function
  tonde.long_form_structure(uuid,uuid,tonde.structure_level,uuid,integer,integer,integer),
  tonde.long_form_timing(uuid,uuid,integer),
  tonde.long_form_search(uuid,uuid,text,jsonb,integer,integer),
  tonde.long_form_summaries(uuid,uuid,integer,integer),
  tonde.long_form_script_index(uuid,uuid,integer,integer),
  tonde.long_form_context(uuid,uuid,tonde.structure_level,uuid,integer),
  tonde.save_structure_summary(uuid,uuid,tonde.structure_level,uuid,jsonb,integer,text,text),
  tonde.create_long_form_act(uuid,uuid,integer,jsonb),
  tonde.update_long_form_act(uuid,uuid,uuid,integer,jsonb),
  tonde.create_long_form_sequence(uuid,uuid,integer,jsonb),
  tonde.update_long_form_sequence(uuid,uuid,uuid,integer,jsonb),
  tonde.move_long_form_scene(uuid,uuid,uuid,integer,uuid,uuid),
  tonde.move_long_form_sequence(uuid,uuid,uuid,integer,uuid),
  tonde.split_long_form_structure(uuid,uuid,tonde.structure_level,uuid,bigint,integer,text),
  tonde.reorder_long_form(uuid,uuid,tonde.structure_level,uuid[],integer,uuid),
  tonde.set_long_form_approval(uuid,uuid,tonde.structure_level,uuid,text,integer),
  tonde.set_long_form_lock(uuid,uuid,tonde.structure_level,uuid,boolean,integer),
  tonde.create_series(uuid,uuid,jsonb),
  tonde.update_series(uuid,uuid,integer,jsonb),
  tonde.save_series_collection(uuid,uuid,jsonb),
  tonde.series_overview(uuid,uuid),
  tonde.create_series_episode(uuid,uuid,jsonb),
  tonde.update_series_episode(uuid,uuid,uuid,integer,jsonb),
  tonde.series_slots(uuid,uuid,tonde.generate_horizon,integer,date,text[]),
  tonde.generate_ahead_preview(uuid,uuid,jsonb),
  tonde.generate_ahead(uuid,uuid,jsonb),
  tonde.retry_generate_ahead(uuid,uuid),
  tonde.generate_ahead_jobs(uuid,uuid,integer),
  tonde.series_production_line(uuid,uuid,integer,integer),
  tonde.series_director_context(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  tonde.long_form_structure(uuid,uuid,tonde.structure_level,uuid,integer,integer,integer),
  tonde.long_form_timing(uuid,uuid,integer),
  tonde.long_form_search(uuid,uuid,text,jsonb,integer,integer),
  tonde.long_form_summaries(uuid,uuid,integer,integer),
  tonde.long_form_script_index(uuid,uuid,integer,integer),
  tonde.long_form_context(uuid,uuid,tonde.structure_level,uuid,integer),
  tonde.save_structure_summary(uuid,uuid,tonde.structure_level,uuid,jsonb,integer,text,text),
  tonde.create_long_form_act(uuid,uuid,integer,jsonb),
  tonde.update_long_form_act(uuid,uuid,uuid,integer,jsonb),
  tonde.create_long_form_sequence(uuid,uuid,integer,jsonb),
  tonde.update_long_form_sequence(uuid,uuid,uuid,integer,jsonb),
  tonde.move_long_form_scene(uuid,uuid,uuid,integer,uuid,uuid),
  tonde.move_long_form_sequence(uuid,uuid,uuid,integer,uuid),
  tonde.split_long_form_structure(uuid,uuid,tonde.structure_level,uuid,bigint,integer,text),
  tonde.reorder_long_form(uuid,uuid,tonde.structure_level,uuid[],integer,uuid),
  tonde.set_long_form_approval(uuid,uuid,tonde.structure_level,uuid,text,integer),
  tonde.set_long_form_lock(uuid,uuid,tonde.structure_level,uuid,boolean,integer),
  tonde.create_series(uuid,uuid,jsonb),
  tonde.update_series(uuid,uuid,integer,jsonb),
  tonde.save_series_collection(uuid,uuid,jsonb),
  tonde.series_overview(uuid,uuid),
  tonde.create_series_episode(uuid,uuid,jsonb),
  tonde.update_series_episode(uuid,uuid,uuid,integer,jsonb),
  tonde.series_slots(uuid,uuid,tonde.generate_horizon,integer,date,text[]),
  tonde.generate_ahead_preview(uuid,uuid,jsonb),
  tonde.generate_ahead(uuid,uuid,jsonb),
  tonde.retry_generate_ahead(uuid,uuid),
  tonde.generate_ahead_jobs(uuid,uuid,integer),
  tonde.series_production_line(uuid,uuid,integer,integer),
  tonde.series_director_context(uuid,uuid,integer)
  to authenticated;
commit;
