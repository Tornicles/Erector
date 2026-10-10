-- Additive pre-Prompt 10 product amendment: Production Kit is vocabulary only;
-- References gain separate identity/purpose; timed audiovisual work gains a shared,
-- versioned Audio Plan with distinct Scene Music and Sound Direction.
-- Existing rows and IDs are retained. Legacy References remain honestly incomplete.
begin;

-- Reference Truth is not Creator Intent. source_description keeps its historical meaning.
alter table tonde.production_references
  add column source_identity text check (source_identity is null or length(btrim(source_identity)) between 1 and 500),
  add column source_provider text check (source_provider is null or length(btrim(source_provider)) <= 160),
  add column identity_provenance text not null default 'unknown'
    check (identity_provenance in ('source_metadata','creator_supplied','inferred','unknown')),
  add column source_identity_verified_at timestamptz,
  add column creator_purpose text check (creator_purpose is null or length(btrim(creator_purpose)) between 1 and 2000),
  add column learning_targets text[] not null default '{}'
    check (cardinality(learning_targets) <= 20),
  add column identity_revision integer not null default 1 check (identity_revision > 0),
  add column revision integer not null default 1 check (revision > 0);

-- The analysis is current only for the exact verified identity/purpose revision it analyzed.
alter table tonde.reference_analyses
  add column identity_revision integer check (identity_revision is null or identity_revision > 0);
create index production_references_identity_status
  on tonde.production_references(workspace_id, production_id, identity_provenance)
  where source_identity is not null;
-- Preserve the object registry: add the two new canonical, versioned audio object kinds.
alter table tonde.objects drop constraint objects_kind_check;
alter table tonde.objects add constraint objects_kind_check check (kind in
  ('project','production','series','collection','act','sequence','scene','shot','asset','reference',
   'creative_document','dialogue_line','execution_plan','result','episode','audio_plan','scene_audio_direction'));

create table tonde.production_audio_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null,
  overall_intent text not null default '' check (length(overall_intent) <= 2000),
  dialogue_strategy text not null default '' check (length(dialogue_strategy) <= 1600),
  music_strategy text not null default '' check (length(music_strategy) <= 1600),
  sound_design_strategy text not null default '' check (length(sound_design_strategy) <= 2000),
  ambience_strategy text not null default '' check (length(ambience_strategy) <= 1600),
  recording_considerations text not null default '' check (length(recording_considerations) <= 1600),
  silence_strategy text not null default '' check (length(silence_strategy) <= 1200),
  recurring_motifs text[] not null default '{}',
  continuity_considerations text not null default '' check (length(continuity_considerations) <= 1200),
  delivery_considerations text not null default '' check (length(delivery_considerations) <= 1200),
  intentional_silence boolean not null default false,
  master_song_reference_id uuid,
  master_song_provenance text not null default 'unknown'
    check (master_song_provenance in ('creator_supplied','licensed','original','generated','external_reference','unknown')),
  direction_state text not null default 'needs_direction'
    check (direction_state in ('needs_direction','planned','intentional_silence')),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, production_id, id), unique (production_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, master_song_reference_id) references tonde.production_references(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, id) references tonde.objects(workspace_id, production_id, id) deferrable initially deferred,
  check ((intentional_silence and direction_state = 'intentional_silence') or
         (not intentional_silence and direction_state <> 'intentional_silence'))
);

create table tonde.scene_audio_directions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null, scene_id uuid not null,
  music_use text not null default 'undecided'
    check (music_use in ('undecided','use','intentional_silence','not_applicable')),
  music_direction text not null default '' check (length(music_direction) <= 2000),
  cue_start_ms bigint check (cue_start_ms is null or cue_start_ms >= 0),
  cue_end_ms bigint check (cue_end_ms is null or cue_end_ms >= 0),
  cue_duration_ms bigint check (cue_duration_ms is null or cue_duration_ms >= 0),
  music_purpose text not null default '' check (length(music_purpose) <= 1000),
  rhythmic_quality text not null default '' check (length(rhythmic_quality) <= 500),
  instrumentation text not null default '' check (length(instrumentation) <= 800),
  dynamics text not null default '' check (length(dynamics) <= 800),
  diegetic boolean,
  dialogue_relationship text not null default '' check (length(dialogue_relationship) <= 800),
  action_relationship text not null default '' check (length(action_relationship) <= 800),
  motif_relationship text not null default '' check (length(motif_relationship) <= 800),
  master_song_reference_id uuid,
  sound_use text not null default 'undecided'
    check (sound_use in ('undecided','directed','intentional_silence','not_applicable')),
  sound_direction text not null default '' check (length(sound_direction) <= 2400),
  sound_events text[] not null default '{}',
  recording_needs text not null default '' check (length(recording_needs) <= 1200),
  microphone_considerations text not null default '' check (length(microphone_considerations) <= 800),
  voice_treatment text not null default '' check (length(voice_treatment) <= 800),
  continuity_considerations text not null default '' check (length(continuity_considerations) <= 1000),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, production_id, id), unique (scene_id),
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, master_song_reference_id) references tonde.production_references(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, id) references tonde.objects(workspace_id, production_id, id) deferrable initially deferred,
  check (cue_start_ms is null or cue_end_ms is null or cue_end_ms >= cue_start_ms),
  check (cue_duration_ms is null or (cue_start_ms is not null and cue_end_ms is not null and cue_duration_ms = cue_end_ms - cue_start_ms)),
  check (music_use <> 'use' or length(btrim(music_direction)) > 0),
  check (sound_use <> 'directed' or length(btrim(sound_direction)) > 0)
);
create index scene_audio_directions_timeline on tonde.scene_audio_directions(workspace_id, production_id, scene_id);

-- A legacy or newly captured Reference is usable for shaping only when its identity has
-- an honest source and provenance and the creator separately states why it matters.
create function tonde_private.reference_shaping_ready(target_workspace uuid, target_reference uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tonde.production_references r
    where r.workspace_id = target_workspace and r.id = target_reference
      and nullif(btrim(r.source_identity), '') is not null
      and r.identity_provenance in ('source_metadata','creator_supplied')
      and r.source_identity_verified_at is not null
      and nullif(btrim(r.creator_purpose), '') is not null)
$$;
revoke all on function tonde_private.reference_shaping_ready(uuid,uuid) from public, anon, authenticated, service_role;

create function tonde_private.validate_reference_identity_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.identity_provenance <> 'unknown' or new.source_identity_verified_at is not null then
    raise exception 'Reference identity can only be verified by the scoped creator-attestation action' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.validate_reference_identity_insert() from public,anon,authenticated,service_role;
create trigger validate_reference_identity_insert before insert on tonde.production_references
  for each row execute function tonde_private.validate_reference_identity_insert();

create function tonde_private.require_reference_shaping_ready() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ref_id uuid; ref_production uuid; target_production uuid; target_kind text;
begin
  if tg_table_name = 'scope_bindings' then
    if tg_op = 'UPDATE' and new.reference_id is null then return new; end if;
    ref_id := new.reference_id;
    if ref_id is null then return new; end if;
    select o.production_id,o.kind into target_production,target_kind from tonde.objects o
      where o.workspace_id=new.workspace_id and o.id=new.scope_object_id;
    if target_kind = 'production' then target_production := new.scope_object_id; end if;
  elsif tg_table_name = 'object_dependencies' then
    if not new.active then return new; end if;
    select o.id into ref_id from tonde.objects o
      where o.workspace_id=new.workspace_id and o.id=new.source_object_id and o.kind='reference';
    if ref_id is null then return new; end if;
    select o.production_id,o.kind into target_production,target_kind from tonde.objects o
      where o.workspace_id=new.workspace_id and o.id=new.target_object_id;
    if target_kind = 'production' then target_production := new.target_object_id; end if;
  elsif tg_table_name = 'reference_analyses' then
    ref_id := new.reference_id;
    target_production := new.production_id;
  end if;
  if ref_id is not null then
    if tg_table_name = 'scope_bindings' and new.production_id is distinct from target_production then
      raise exception 'Reference binding must target its owning Production' using errcode='23514';
    end if;
    select r.production_id into ref_production from tonde.production_references r
      where r.workspace_id=new.workspace_id and r.id=ref_id;
    if ref_production is null or target_production is null or target_production is distinct from ref_production then
      raise exception 'Reference shaping target must belong to the Reference Production' using errcode='23514';
    end if;
    if not tonde_private.reference_shaping_ready(new.workspace_id,ref_id) then
      raise exception 'Complete the Reference identity and creator purpose before using it to shape a Production' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger require_reference_identity_before_scope_binding before insert or update on tonde.scope_bindings
  for each row execute function tonde_private.require_reference_shaping_ready();
create trigger require_reference_identity_before_dependency before insert or update on tonde.object_dependencies
  for each row execute function tonde_private.require_reference_shaping_ready();
create trigger require_reference_identity_before_analysis before insert or update on tonde.reference_analyses
  for each row execute function tonde_private.require_reference_shaping_ready();

create function tonde_private.bind_reference_analysis_identity_revision() returns trigger
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
    raise exception 'Reference identity changed while this analysis was running' using errcode='40001';
  end if;
  if new.analyzed_at is not null and new.identity_revision is null then
    raise exception 'Analysis must be claimed against a verified Reference identity before completion' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.bind_reference_analysis_identity_revision() from public,anon,authenticated,service_role;
create trigger bind_reference_analysis_identity_revision before insert or update on tonde.reference_analyses
  for each row execute function tonde_private.bind_reference_analysis_identity_revision();

-- The first claim pins identity_revision. Later progress writes preserve that pin, and
-- save_reference_analysis can complete only if the Reference identity has not changed.
create function tonde.claim_reference_analysis_pinned(
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
    raise exception 'Reference identity changed before analysis began; reload and verify it again' using errcode='40001';
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
revoke all on function tonde.claim_reference_analysis_pinned(uuid,uuid,uuid,integer,text,text[],integer,text) from public,anon,authenticated,service_role;
grant execute on function tonde.claim_reference_analysis_pinned(uuid,uuid,uuid,integer,text,text[],integer,text) to authenticated;

create or replace function tonde.claim_reference_analysis(
  target_workspace uuid, target_production uuid, target_reference uuid, stage_status text,
  stage_list text[] default '{}', progress_pct integer default 0, producer_note text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.reference_analyses; reference_state text;
begin
  perform tonde_private.director_guard(target_workspace);
  if stage_status not in ('queued','preprocessing','analyzing','synthesizing','partial','failed','cancelled') then
    raise exception 'Unsupported analysis stage status' using errcode='22023';
  end if;
  if not exists(select 1 from tonde.production_references where workspace_id=target_workspace
    and production_id=target_production and id=target_reference) then
    raise exception 'Reference unavailable in this Production' using errcode='P0002';
  end if;
  insert into tonde.reference_analyses as ra (workspace_id,production_id,reference_id,status,stages,progress,producer_note)
  values (target_workspace,target_production,target_reference,stage_status,coalesce(stage_list,'{}'),
    greatest(0,least(100,coalesce(progress_pct,0))),left(coalesce(producer_note,''),600))
  on conflict (workspace_id,reference_id) do update set
    status=excluded.status,stages=excluded.stages,progress=excluded.progress,
    producer_note=case when excluded.producer_note='' then ra.producer_note else excluded.producer_note end
  returning * into saved;
  reference_state := case stage_status when 'failed' then 'failed' when 'partial' then 'partially_analyzed' else 'processing' end;
  update tonde.production_references set state=reference_state::tonde.reference_state where id=target_reference and workspace_id=target_workspace;
  return jsonb_build_object('analysis_id',saved.id,'identity_revision',saved.identity_revision,
    'status',saved.status,'progress',saved.progress,'stages',saved.stages);
end $$;
revoke all on function tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text) from public,anon,authenticated,service_role;
grant execute on function tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text) to authenticated;
create function tonde_private.validate_reference_analysis_identity_pin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.analyzed_at is not null and (old.analyzed_at is null or new.identity_revision is distinct from old.identity_revision) then
    if new.identity_revision is null then
      raise exception 'Analysis must be claimed against a verified Reference identity before completion' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function tonde_private.validate_reference_analysis_identity_pin() from public,anon,authenticated,service_role;
create trigger require_reference_analysis_identity_pin before update on tonde.reference_analyses
  for each row execute function tonde_private.validate_reference_analysis_identity_pin();

create function tonde_private.advance_reference_identity_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.source_identity,new.source_provider,new.identity_provenance,new.source_identity_verified_at,new.creator_purpose,new.learning_targets)
    is distinct from
     (old.source_identity,old.source_provider,old.identity_provenance,old.source_identity_verified_at,old.creator_purpose,old.learning_targets) then
    new.identity_revision := old.identity_revision+1;
  else
    new.identity_revision := old.identity_revision;
  end if;
  return new;
end $$;
revoke all on function tonde_private.advance_reference_identity_revision() from public,anon,authenticated,service_role;
create trigger advance_reference_identity_revision before update on tonde.production_references
  for each row execute function tonde_private.advance_reference_identity_revision();

create function tonde_private.prevent_reference_shaping_downgrade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (nullif(btrim(new.source_identity), '') is null
      or new.identity_provenance not in ('source_metadata','creator_supplied')
      or new.source_identity_verified_at is null
      or nullif(btrim(new.creator_purpose), '') is null)
     and ((exists(select 1 from tonde.scope_bindings b where b.workspace_id=new.workspace_id and b.reference_id=new.id)
       or exists(select 1 from tonde.object_dependencies d where d.workspace_id=new.workspace_id and d.source_object_id=new.id and d.active)
       or exists(select 1 from tonde.reference_analyses a where a.workspace_id=new.workspace_id and a.reference_id=new.id)
       or exists(select 1 from tonde.reference_technique_links l where l.workspace_id=new.workspace_id and l.reference_id=new.id))) then
    raise exception 'A Reference already used for analysis or Production-shaping must retain verified identity and creator purpose' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.prevent_reference_shaping_downgrade() from public,anon,authenticated,service_role;
create trigger prevent_reference_shaping_downgrade before update of source_identity,identity_provenance,source_identity_verified_at,creator_purpose
  on tonde.production_references for each row execute function tonde_private.prevent_reference_shaping_downgrade();

create function tonde_private.validate_audio_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
declare reference_production uuid;
begin
  if tg_table_name = 'production_audio_plans' then
    if not exists(select 1 from tonde.productions p where p.workspace_id=new.workspace_id and p.id=new.production_id
      and tonde_private.audio_applies(p.production_type,p.planned_duration_ms)) then
      raise exception 'Audio Plan is available only for relevant timed audiovisual Productions' using errcode='23514';
    end if;
    if new.master_song_reference_id is not null then
      select production_id into reference_production from tonde.production_references
        where workspace_id = new.workspace_id and id = new.master_song_reference_id;
      if reference_production is distinct from new.production_id then
        raise exception 'Master song Reference belongs to another Production' using errcode = '23514';
      end if;
      if not tonde_private.reference_shaping_ready(new.workspace_id, new.master_song_reference_id) then
        raise exception 'Complete the master song Reference identity and creator purpose before mapping it' using errcode = '23514';
      end if;
      if new.master_song_provenance not in ('creator_supplied','licensed','external_reference','unknown') then
        raise exception 'A linked Reference must retain supplied, licensed, external, or unknown audio provenance' using errcode = '23514';
      end if;
    end if;
    if new.intentional_silence then new.direction_state := 'intentional_silence';
    elsif length(btrim(new.overall_intent)) > 0 or length(btrim(new.dialogue_strategy)) > 0
      or length(btrim(new.music_strategy)) > 0 or length(btrim(new.sound_design_strategy)) > 0
      or length(btrim(new.ambience_strategy)) > 0 or length(btrim(new.silence_strategy)) > 0
      then new.direction_state := 'planned';
    else new.direction_state := 'needs_direction'; end if;
  else
    if not exists(select 1 from tonde.productions p where p.workspace_id=new.workspace_id and p.id=new.production_id
      and tonde_private.audio_applies(p.production_type,p.planned_duration_ms))
      or not exists(select 1 from tonde.production_audio_plans p where p.workspace_id=new.workspace_id and p.production_id=new.production_id) then
      raise exception 'Scene audio direction requires an applicable Production Audio Plan' using errcode='23514';
    end if;
    if new.master_song_reference_id is not null then
    select production_id into reference_production from tonde.production_references
      where workspace_id = new.workspace_id and id = new.master_song_reference_id;
    if reference_production is distinct from new.production_id then
      raise exception 'Music Reference belongs to another Production' using errcode = '23514';
    end if;
    if not tonde_private.reference_shaping_ready(new.workspace_id, new.master_song_reference_id) then
      raise exception 'Complete the music Reference identity and creator purpose before mapping it' using errcode = '23514';
    end if;
    if not exists(select 1 from tonde.production_audio_plans p where p.workspace_id=new.workspace_id and p.production_id=new.production_id
      and p.master_song_reference_id=new.master_song_reference_id) then
      raise exception 'Scene Music Direction must use the master song Reference declared by this Audio Plan' using errcode = '23514';
    end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function tonde_private.validate_audio_reference() from public, anon, authenticated, service_role;
create trigger validate_audio_plan_reference before insert or update on tonde.production_audio_plans
  for each row execute function tonde_private.validate_audio_reference();
create trigger validate_scene_audio_reference before insert or update on tonde.scene_audio_directions
  for each row execute function tonde_private.validate_audio_reference();

-- Update the shared object registry and history triggers, not a parallel subsystem.
do $$ begin
  create trigger a_register_object after insert on tonde.production_audio_plans
    for each row execute function tonde_private.register_object('audio_plan');
  create trigger b_capture_revision after insert or update on tonde.production_audio_plans
    for each row execute function tonde_private.capture_revision();
  create trigger a_register_object after insert on tonde.scene_audio_directions
    for each row execute function tonde_private.register_object('scene_audio_direction');
  create trigger b_capture_revision after insert or update on tonde.scene_audio_directions
    for each row execute function tonde_private.capture_revision();
  create trigger guard_mutation before insert or update on tonde.production_audio_plans
    for each row execute function tonde_private.guard_mutation();
  create trigger guard_mutation before insert or update on tonde.scene_audio_directions
    for each row execute function tonde_private.guard_mutation();
  create trigger a_human_acceptance before insert or update on tonde.production_audio_plans
    for each row execute function tonde_private.guard_human_acceptance();
  create trigger a_human_acceptance before insert or update on tonde.scene_audio_directions
    for each row execute function tonde_private.guard_human_acceptance();
end $$;

-- Approval, lock, version comparison and impact helpers recognize the new canonical objects.
create or replace function tonde_private.pi_label(target_workspace uuid, target_object uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare kind text; label text;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id=target_workspace and o.id=target_object;
  if kind is null then return null; end if;
  case kind
    when 'production' then select title into label from tonde.productions where workspace_id=target_workspace and id=target_object;
    when 'act' then select title into label from tonde.acts where workspace_id=target_workspace and id=target_object;
    when 'sequence' then select title into label from tonde.sequences where workspace_id=target_workspace and id=target_object;
    when 'scene' then select title into label from tonde.scenes where workspace_id=target_workspace and id=target_object;
    when 'shot' then select title into label from tonde.shots where workspace_id=target_workspace and id=target_object;
    when 'asset' then select name into label from tonde.assets where workspace_id=target_workspace and id=target_object;
    when 'reference' then select coalesce(nullif(source_identity,''),source_url,'Reference') into label from tonde.production_references where workspace_id=target_workspace and id=target_object;
    when 'execution_plan' then select case when execution_method='ai' then 'AI plan' else 'Real plan' end into label from tonde.execution_plans where workspace_id=target_workspace and id=target_object;
    when 'creative_document' then select coalesce(nullif(title,''),'Document') into label from tonde.creative_documents where workspace_id=target_workspace and id=target_object;
    when 'dialogue_line' then select left(coalesce(content,''),60) into label from tonde.dialogue_lines where workspace_id=target_workspace and id=target_object;
    when 'result' then label := 'Result';
    when 'episode' then select title into label from tonde.series_episodes where workspace_id=target_workspace and id=target_object;
    when 'series' then select title into label from tonde.series where workspace_id=target_workspace and id=target_object;
    when 'project' then select title into label from tonde.projects where workspace_id=target_workspace and id=target_object;
    when 'audio_plan' then label := 'Audio Plan';
    when 'scene_audio_direction' then select 'Scene audio direction' into label from tonde.scene_audio_directions where workspace_id=target_workspace and id=target_object;
    else label := kind;
  end case;
  return coalesce(nullif(btrim(coalesce(label,'')),''),kind);
end $$;

create or replace function tonde_private.pi_object_revision(target_workspace uuid, target_object uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare kind text; value integer;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id=target_workspace and o.id=target_object;
  case kind
    when 'production' then select revision into value from tonde.productions where workspace_id=target_workspace and id=target_object;
    when 'act' then select revision into value from tonde.acts where workspace_id=target_workspace and id=target_object;
    when 'sequence' then select revision into value from tonde.sequences where workspace_id=target_workspace and id=target_object;
    when 'scene' then select revision into value from tonde.scenes where workspace_id=target_workspace and id=target_object;
    when 'shot' then select revision into value from tonde.shots where workspace_id=target_workspace and id=target_object;
    when 'asset' then select revision into value from tonde.assets where workspace_id=target_workspace and id=target_object;
    when 'reference' then select revision into value from tonde.production_references where workspace_id=target_workspace and id=target_object;
    when 'execution_plan' then select revision into value from tonde.execution_plans where workspace_id=target_workspace and id=target_object;
    when 'creative_document' then select revision into value from tonde.creative_documents where workspace_id=target_workspace and id=target_object;
    when 'dialogue_line' then select revision into value from tonde.dialogue_lines where workspace_id=target_workspace and id=target_object;
    when 'result' then select revision into value from tonde.results where workspace_id=target_workspace and id=target_object;
    when 'episode' then select revision into value from tonde.series_episodes where workspace_id=target_workspace and id=target_object;
    when 'series' then select revision into value from tonde.series where workspace_id=target_workspace and id=target_object;
    when 'audio_plan' then select revision into value from tonde.production_audio_plans where workspace_id=target_workspace and id=target_object;
    when 'scene_audio_direction' then select revision into value from tonde.scene_audio_directions where workspace_id=target_workspace and id=target_object;
    else value := null;
  end case;
  return value;
end $$;

create or replace function tonde_private.pi_is_locked(target_workspace uuid, target_object uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare kind text; locked boolean := false; parent_id uuid; scene_ref uuid; sequence_ref uuid; act_ref uuid;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id=target_workspace and o.id=target_object;
  case kind
    when 'production' then select locked_at is not null into locked from tonde.productions where workspace_id=target_workspace and id=target_object;
    when 'act' then select locked_at is not null into locked from tonde.acts where workspace_id=target_workspace and id=target_object;
    when 'sequence' then
      select locked_at is not null,act_id into locked,act_ref from tonde.sequences where workspace_id=target_workspace and id=target_object;
      if not locked and act_ref is not null then locked := tonde_private.pi_is_locked(target_workspace,act_ref); end if;
    when 'scene' then
      select locked_at is not null,sequence_id,production_id into locked,sequence_ref,parent_id from tonde.scenes where workspace_id=target_workspace and id=target_object;
      if not locked and sequence_ref is not null then locked := tonde_private.pi_is_locked(target_workspace,sequence_ref); end if;
      if not locked and parent_id is not null then locked := tonde_private.pi_is_locked(target_workspace,parent_id); end if;
    when 'shot' then
      select locked_at is not null,scene_id into locked,scene_ref from tonde.shots where workspace_id=target_workspace and id=target_object;
      if not locked and scene_ref is not null then locked := tonde_private.pi_is_locked(target_workspace,scene_ref); end if;
    when 'asset' then select locked_at is not null into locked from tonde.assets where workspace_id=target_workspace and id=target_object;
    when 'reference' then locked := false;
    -- A derived artifact is locked only by its own lock. It must never inherit the lock of the
    -- object it was derived from: impact propagation has to be able to MARK a locked source's
    -- artifact stale and report it, instead of silently skipping it and hiding real staleness.
    -- Enclosing-scope locks still reach a Shot through its Scene, and an Audio Plan through its
    -- Production, because those are scopes the object lives inside rather than sources it derives from.
    when 'execution_plan' then select locked_at is not null into locked from tonde.execution_plans where workspace_id=target_workspace and id=target_object;
    when 'creative_document' then select locked_at is not null into locked from tonde.creative_documents where workspace_id=target_workspace and id=target_object;
    when 'dialogue_line' then select locked_at is not null into locked from tonde.dialogue_lines where workspace_id=target_workspace and id=target_object;
    when 'result' then select locked_at is not null into locked from tonde.results where workspace_id=target_workspace and id=target_object;
    when 'audio_plan' then select locked_at is not null,production_id into locked,parent_id from tonde.production_audio_plans where workspace_id=target_workspace and id=target_object;
    when 'scene_audio_direction' then
      select locked_at is not null,scene_id into locked,scene_ref from tonde.scene_audio_directions where workspace_id=target_workspace and id=target_object;
      if not locked and scene_ref is not null then locked := tonde_private.pi_is_locked(target_workspace,scene_ref); end if;
    else locked := false;
  end case;
  if not locked and parent_id is not null then locked := tonde_private.pi_is_locked(target_workspace,parent_id); end if;
  if not locked and kind='scene_audio_direction' and scene_ref is not null then
    select sequence_id,production_id into sequence_ref,parent_id from tonde.scenes where workspace_id=target_workspace and id=scene_ref;
    if sequence_ref is not null then locked := tonde_private.pi_is_locked(target_workspace,sequence_ref); end if;
    if not locked and parent_id is not null then locked := tonde_private.pi_is_locked(target_workspace,parent_id); end if;
  end if;
  return coalesce(locked,false);
end $$;

create or replace function tonde_private.pi_is_approved(target_workspace uuid, target_object uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare kind text; status text;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id=target_workspace and o.id=target_object;
  case kind
    when 'production' then select approval::text into status from tonde.productions where workspace_id=target_workspace and id=target_object;
    when 'act' then select approval::text into status from tonde.acts where workspace_id=target_workspace and id=target_object;
    when 'sequence' then select approval::text into status from tonde.sequences where workspace_id=target_workspace and id=target_object;
    when 'scene' then select approval::text into status from tonde.scenes where workspace_id=target_workspace and id=target_object;
    when 'shot' then select approval::text into status from tonde.shots where workspace_id=target_workspace and id=target_object;
    when 'asset' then select approval::text into status from tonde.assets where workspace_id=target_workspace and id=target_object;
    when 'execution_plan' then select approval::text into status from tonde.execution_plans where workspace_id=target_workspace and id=target_object;
    when 'creative_document' then select approval::text into status from tonde.creative_documents where workspace_id=target_workspace and id=target_object;
    when 'dialogue_line' then select approval::text into status from tonde.dialogue_lines where workspace_id=target_workspace and id=target_object;
    when 'result' then select approval::text into status from tonde.results where workspace_id=target_workspace and id=target_object;
    when 'audio_plan' then select approval::text into status from tonde.production_audio_plans where workspace_id=target_workspace and id=target_object;
    when 'scene_audio_direction' then select approval::text into status from tonde.scene_audio_directions where workspace_id=target_workspace and id=target_object;
    else status := null;
  end case;
  return status in ('approved','changed_after_approval');
end $$;

create or replace function tonde_private.ax_approval(target_workspace uuid, target_object uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare kind_value text; value text;
begin
  select o.kind into kind_value from tonde.objects o where o.workspace_id=target_workspace and o.id=target_object;
  case kind_value
    when 'production' then select approval::text into value from tonde.productions where id=target_object and workspace_id=target_workspace;
    when 'act' then select approval::text into value from tonde.acts where id=target_object and workspace_id=target_workspace;
    when 'sequence' then select approval::text into value from tonde.sequences where id=target_object and workspace_id=target_workspace;
    when 'scene' then select approval::text into value from tonde.scenes where id=target_object and workspace_id=target_workspace;
    when 'shot' then select approval::text into value from tonde.shots where id=target_object and workspace_id=target_workspace;
    when 'execution_plan' then select approval::text into value from tonde.execution_plans where id=target_object and workspace_id=target_workspace;
    when 'dialogue_line' then select approval::text into value from tonde.dialogue_lines where id=target_object and workspace_id=target_workspace;
    when 'creative_document' then select approval::text into value from tonde.creative_documents where id=target_object and workspace_id=target_workspace;
    when 'result' then select approval::text into value from tonde.results where id=target_object and workspace_id=target_workspace;
    when 'asset' then select approval::text into value from tonde.assets where id=target_object and workspace_id=target_workspace;
    when 'audio_plan' then select approval::text into value from tonde.production_audio_plans where id=target_object and workspace_id=target_workspace;
    when 'scene_audio_direction' then select approval::text into value from tonde.scene_audio_directions where id=target_object and workspace_id=target_workspace;
    else value := null;
  end case;
  return value;
end $$;

create or replace function tonde_private.ax_locked_at(target_workspace uuid, target_object uuid) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare kind_value text; value timestamptz;
begin
  select o.kind into kind_value from tonde.objects o where o.workspace_id=target_workspace and o.id=target_object;
  case kind_value
    when 'production' then select locked_at into value from tonde.productions where id=target_object and workspace_id=target_workspace;
    when 'act' then select locked_at into value from tonde.acts where id=target_object and workspace_id=target_workspace;
    when 'sequence' then select locked_at into value from tonde.sequences where id=target_object and workspace_id=target_workspace;
    when 'scene' then select locked_at into value from tonde.scenes where id=target_object and workspace_id=target_workspace;
    when 'shot' then select locked_at into value from tonde.shots where id=target_object and workspace_id=target_workspace;
    when 'execution_plan' then select locked_at into value from tonde.execution_plans where id=target_object and workspace_id=target_workspace;
    when 'dialogue_line' then select locked_at into value from tonde.dialogue_lines where id=target_object and workspace_id=target_workspace;
    when 'creative_document' then select locked_at into value from tonde.creative_documents where id=target_object and workspace_id=target_workspace;
    when 'result' then select locked_at into value from tonde.results where id=target_object and workspace_id=target_workspace;
    when 'asset' then select locked_at into value from tonde.assets where id=target_object and workspace_id=target_workspace;
    when 'audio_plan' then select locked_at into value from tonde.production_audio_plans where id=target_object and workspace_id=target_workspace;
    when 'scene_audio_direction' then select locked_at into value from tonde.scene_audio_directions where id=target_object and workspace_id=target_workspace;
    else value := null;
  end case;
  return value;
end $$;

create or replace function tonde_private.ax_set_approval(target_workspace uuid, target_production uuid,
  target_object uuid, approval_value tonde.approval) returns integer
language plpgsql security definer set search_path = '' as $$
declare kind_value text; new_rev integer;
begin
  select o.kind into kind_value from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object
    and (o.production_id is null or o.production_id = target_production);
  case kind_value
    when 'production' then update tonde.productions set approval = approval_value where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'act' then update tonde.acts set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'sequence' then update tonde.sequences set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'scene' then update tonde.scenes set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'shot' then update tonde.shots set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'execution_plan' then update tonde.execution_plans set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'dialogue_line' then update tonde.dialogue_lines set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'creative_document' then update tonde.creative_documents set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'result' then update tonde.results set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'asset' then update tonde.assets set approval = approval_value where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'audio_plan' then update tonde.production_audio_plans set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'scene_audio_direction' then update tonde.scene_audio_directions set approval = approval_value where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    else raise exception 'That object cannot be approved in this Production' using errcode = '22023';
  end case;
  return new_rev;
end $$;

create or replace function tonde_private.ax_set_lock(target_workspace uuid, target_production uuid,
  target_object uuid, locked_value boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare kind_value text; new_rev integer; stamp timestamptz;
begin
  stamp := case when coalesce(locked_value, false) then now() else null end;
  select o.kind into kind_value from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object
    and (o.production_id is null or o.production_id = target_production);
  case kind_value
    when 'production' then update tonde.productions set locked_at = stamp where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'act' then update tonde.acts set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'sequence' then update tonde.sequences set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'scene' then update tonde.scenes set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'shot' then update tonde.shots set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'execution_plan' then update tonde.execution_plans set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'dialogue_line' then update tonde.dialogue_lines set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'creative_document' then update tonde.creative_documents set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'result' then update tonde.results set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'asset' then update tonde.assets set locked_at = stamp where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'audio_plan' then update tonde.production_audio_plans set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'scene_audio_direction' then update tonde.scene_audio_directions set locked_at = stamp where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    else raise exception 'That object cannot be locked in this Production' using errcode = '22023';
  end case;
  return new_rev;
end $$;

create or replace function tonde_private.vb_fields(kind_value text) returns jsonb
language sql immutable set search_path = '' as $$
 select case kind_value
  when 'creative_document' then jsonb_build_object('table','creative_documents','scope','production','fields',jsonb_build_object('title','text','content','text'))
  when 'scene' then jsonb_build_object('table','scenes','scope','production','fields',jsonb_build_object('title','text','description','text','purpose','text','planned_duration_ms','bigint'))
  when 'shot' then jsonb_build_object('table','shots','scope','production','fields',jsonb_build_object('title','text','description','text','action','text','purpose','text','subject','text','planned_duration_ms','bigint'))
  when 'execution_plan' then jsonb_build_object('table','execution_plans','scope','production','fields',jsonb_build_object(
    'shot_size','text','movement','text','framing','text','composition','text','camera_position','text','camera_height','text','camera_angle','text','lighting_intent','text','plan_metadata','jsonb',
    'performance','text','blocking','text','product_direction','text','provider_prompt','text','canonical_prompt','jsonb','first_frame','jsonb','last_frame','jsonb','motion','jsonb'))
  when 'asset' then jsonb_build_object('table','assets','scope','workspace','fields',jsonb_build_object('name','text','description','text','search_metadata','jsonb','consistency_metadata','jsonb'))
  when 'result' then jsonb_build_object('table','results','scope','production','fields',jsonb_build_object('provenance','jsonb'))
  when 'audio_plan' then jsonb_build_object('table','production_audio_plans','scope','production','fields',jsonb_build_object(
    'overall_intent','text','dialogue_strategy','text','music_strategy','text','sound_design_strategy','text','ambience_strategy','text',
    'recording_considerations','text','silence_strategy','text','recurring_motifs','text[]','continuity_considerations','text','delivery_considerations','text','intentional_silence','boolean'))
  when 'scene_audio_direction' then jsonb_build_object('table','scene_audio_directions','scope','production','fields',jsonb_build_object(
    'music_use','text','music_direction','text','cue_start_ms','bigint','cue_end_ms','bigint','cue_duration_ms','bigint','music_purpose','text','rhythmic_quality','text',
    'instrumentation','text','dynamics','text','diegetic','boolean','dialogue_relationship','text','action_relationship','text','motif_relationship','text',
    'sound_use','text','sound_direction','text','sound_events','text[]','recording_needs','text','microphone_considerations','text',
    'voice_treatment','text','continuity_considerations','text'))
  else null end
$$;

-- Relationship edges are part of the existing dependency graph. Supplied music is a source,
-- not a recommendation, and all edge changes are revision/history guarded by migration 019.
create function tonde_private.sync_audio_dependencies() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_id uuid := new.id; source_prod uuid := new.production_id; song_id uuid; scene_ref uuid; audio_plan_id uuid; existing_song uuid;
begin
  if tg_table_name = 'production_audio_plans' then
    song_id := new.master_song_reference_id;
    if tg_op = 'UPDATE' then
      select master_song_reference_id into existing_song from tonde.production_audio_plans
        where workspace_id=new.workspace_id and id=new.id;
    end if;
  else
    song_id := new.master_song_reference_id;
    scene_ref := new.scene_id;
    select p.id into audio_plan_id from tonde.production_audio_plans p
      where p.workspace_id=new.workspace_id and p.production_id=new.production_id;
  end if;
  insert into tonde.object_dependencies(workspace_id,source_object_id,target_object_id,relation,reason,strength,origin,affected_fields,created_by)
    values(new.workspace_id,source_prod,target_id,'execution','Audio direction depends on this canonical Production state.','hard','derived',array['audio'],auth.uid())
    on conflict (source_object_id,target_object_id,relation) do update set active=true,updated_at=now();
  if scene_ref is not null then
    insert into tonde.object_dependencies(workspace_id,source_object_id,target_object_id,relation,reason,strength,origin,affected_fields,created_by)
      values(new.workspace_id,scene_ref,target_id,'creative','Scene audio direction belongs to this canonical Scene.','hard','derived',array['music','sound'],auth.uid())
      on conflict (source_object_id,target_object_id,relation) do update set active=true,updated_at=now();
    if audio_plan_id is not null then
      insert into tonde.object_dependencies(workspace_id,source_object_id,target_object_id,relation,reason,strength,origin,affected_fields,created_by)
        values(new.workspace_id,audio_plan_id,target_id,'execution','Scene direction follows the Production Audio Plan.','hard','derived',array['music','sound','audio'],auth.uid())
        on conflict (source_object_id,target_object_id,relation) do update set active=true,updated_at=now();
    end if;
  end if;
  if song_id is not null then
    insert into tonde.object_dependencies(workspace_id,source_object_id,target_object_id,relation,reason,strength,origin,affected_fields,created_by)
      values(new.workspace_id,song_id,target_id,'reference','This direction is timed to the creator-supplied master song Reference.','hard','explicit',array['timing','music'],auth.uid())
      on conflict (source_object_id,target_object_id,relation) do update set active=true,updated_at=now();
  end if;
  update tonde.object_dependencies set active=false,updated_at=now()
    where workspace_id=new.workspace_id and target_object_id=target_id and relation='reference'
      and source_object_id is distinct from song_id and active;
  return new;
end $$;
revoke all on function tonde_private.sync_audio_dependencies() from public,anon,authenticated,service_role;
create trigger sync_audio_plan_dependencies after insert or update on tonde.production_audio_plans
  for each row execute function tonde_private.sync_audio_dependencies();
create trigger sync_scene_audio_dependencies after insert or update on tonde.scene_audio_directions
  for each row execute function tonde_private.sync_audio_dependencies();

create function tonde_private.validate_reference_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.revision <> 1 then
    raise exception 'Initial Reference revision must be one' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' and new.revision <> old.revision + 1 then
    raise exception 'Reference revision must advance exactly once' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.validate_reference_revision() from public,anon,authenticated,service_role;
create trigger validate_reference_revision before insert on tonde.production_references
  for each row execute function tonde_private.validate_reference_revision();

-- Timed audiovisual Productions receive an explicit, initially-unplanned Audio Plan.
-- Photography and non-timed work do not. No creative direction is fabricated.
create function tonde_private.audio_applies(target_type tonde.production_type,target_duration bigint) returns boolean
language sql immutable set search_path = '' as $$
 select target_duration is not null and (
   target_type in ('social_video','commercial','advertisement','product_film','youtube','interview','documentary','music_video','short_film','long_form_film','trailer')
   or target_type in ('campaign','series','recurring_content'))
$$;
create function tonde_private.ensure_audio_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tonde_private.audio_applies(new.production_type,new.planned_duration_ms) and
     not exists(select 1 from tonde.production_audio_plans p where p.workspace_id=new.workspace_id and p.production_id=new.id) then
    insert into tonde.production_audio_plans(workspace_id,production_id,created_by)
      values(new.workspace_id,new.id,coalesce(auth.uid(),new.created_by));
  end if;
  return new;
end $$;
revoke all on function tonde_private.audio_applies(tonde.production_type,bigint) from public,anon,authenticated,service_role;
revoke all on function tonde_private.ensure_audio_plan() from public,anon,authenticated,service_role;
create trigger ensure_production_audio_plan after insert or update of production_type,planned_duration_ms on tonde.productions
  for each row execute function tonde_private.ensure_audio_plan();

-- Reference identity attestation is an explicit creator action. Direct row updates are removed;
-- the scoped RPC writes a revision and timestamp only after the creator confirms the identity.
revoke update on tonde.production_references from authenticated;
create function tonde.reference_identity_save(target_workspace uuid,target_production uuid,target_reference uuid,
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
    raise exception 'Reference changed since it was loaded' using errcode='40001';
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
revoke all on function tonde.reference_identity_save(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function tonde.reference_identity_save(uuid,uuid,uuid,integer,jsonb) to authenticated;

-- Only members may read these rows; all writes are through scoped, revision-checked RPCs.
alter table tonde.production_audio_plans enable row level security;
alter table tonde.scene_audio_directions enable row level security;
create policy tenant_read on tonde.production_audio_plans for select to authenticated using (tonde_private.is_workspace_member(workspace_id));
create policy tenant_read on tonde.scene_audio_directions for select to authenticated using (tonde_private.is_workspace_member(workspace_id));
revoke all on tonde.production_audio_plans,tonde.scene_audio_directions from public,anon,authenticated;
grant select on tonde.production_audio_plans,tonde.scene_audio_directions to authenticated;
grant all on tonde.production_audio_plans,tonde.scene_audio_directions to service_role;

create function tonde.audio_plan_get(target_workspace uuid,target_production uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result_row tonde.production_audio_plans;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  if not exists(select 1 from tonde.productions p where p.workspace_id=target_workspace and p.id=target_production) then
    raise exception 'Production unavailable' using errcode='P0002';
  end if;
  select * into result_row from tonde.production_audio_plans where workspace_id=target_workspace and production_id=target_production;
  if not found or not tonde_private.audio_applies(
      (select production_type from tonde.productions where workspace_id=target_workspace and id=target_production),
      (select planned_duration_ms from tonde.productions where workspace_id=target_workspace and id=target_production)) then
    return null;
  end if;
  return to_jsonb(result_row);
end $$;

create function tonde.scene_audio_directions_get(target_workspace uuid,target_production uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result_rows jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  if not exists(select 1 from tonde.productions p where p.workspace_id=target_workspace and p.id=target_production) then
    raise exception 'Production unavailable' using errcode='P0002';
  end if;
  select coalesce(jsonb_agg(to_jsonb(d) order by s.sort_order,s.id),'[]'::jsonb) into result_rows
    from tonde.scene_audio_directions d join tonde.scenes s on s.workspace_id=d.workspace_id and s.id=d.scene_id
    join tonde.productions p on p.workspace_id=d.workspace_id and p.id=d.production_id
    where d.workspace_id=target_workspace and d.production_id=target_production
      and tonde_private.audio_applies(p.production_type,p.planned_duration_ms)
      and exists(select 1 from tonde.production_audio_plans ap where ap.workspace_id=d.workspace_id and ap.production_id=d.production_id);
  return result_rows;
end $$;

create function tonde.audio_plan_save(target_workspace uuid,target_production uuid,expected_revision integer,values_json jsonb)
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
    if expected_revision is null or old_row.revision <> expected_revision then raise exception 'Audio Plan changed since it was loaded' using errcode='40001'; end if;
    if tonde_private.pi_is_locked(target_workspace,old_row.id) then raise exception 'Unlock the Audio Plan before editing' using errcode='23514'; end if;
  elsif expected_revision is not null then raise exception 'Audio Plan no longer exists' using errcode='40001'; end if;
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

create function tonde.scene_audio_direction_save(target_workspace uuid,target_production uuid,target_scene uuid,
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
    if expected_revision is null or old_row.revision <> expected_revision then raise exception 'Scene audio direction changed since it was loaded' using errcode='40001'; end if;
    if tonde_private.pi_is_locked(target_workspace,old_row.id) then raise exception 'Unlock the Scene audio direction before editing' using errcode='23514'; end if;
  elsif expected_revision is not null then raise exception 'Scene audio direction no longer exists' using errcode='40001'; end if;
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
revoke all on function tonde.audio_plan_get(uuid,uuid),tonde.scene_audio_directions_get(uuid,uuid),
  tonde.audio_plan_save(uuid,uuid,integer,jsonb),tonde.scene_audio_direction_save(uuid,uuid,uuid,integer,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function tonde.audio_plan_get(uuid,uuid),tonde.scene_audio_directions_get(uuid,uuid),
  tonde.audio_plan_save(uuid,uuid,integer,jsonb),tonde.scene_audio_direction_save(uuid,uuid,uuid,integer,jsonb)
  to authenticated;

-- New forward branch scopes share the existing practical versioning engine.
alter table tonde.object_branches drop constraint object_branches_scope_check;
alter table tonde.object_branches add constraint object_branches_scope_check check (scope in
  ('story','script','act','sequence','scene','shot','execution_plan','asset','audio_plan','scene_audio_direction'));

create or replace function tonde.branch_create(target_workspace uuid,target_production uuid,scope_object uuid,branch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare object_row tonde.objects; created tonde.object_branches; scope_value text; name_value text;
  source_version uuid; source_rev integer; version_row tonde.object_versions;
begin
  perform tonde_private.studio_guard(target_workspace,target_production,null);
  if jsonb_typeof(branch) <> 'object' then raise exception 'Invalid branch payload' using errcode='22023'; end if;
  object_row := tonde_private.vb_object(target_workspace,target_production,scope_object);
  name_value := btrim(coalesce(branch->>'name',''));
  if length(name_value) not between 1 and 160 then raise exception 'A branch needs a name of 1 to 160 characters' using errcode='22023'; end if;
  scope_value := coalesce(nullif(branch->>'scope',''),'production');
  if scope_value not in ('story','script','act','sequence','scene','shot','execution_plan','asset','audio_plan','scene_audio_direction') then
    raise exception 'Unsupported branch scope' using errcode='22023'; end if;
  if not ((object_row.kind='creative_document' and scope_value in ('story','script'))
    or (object_row.kind='scene' and scope_value='scene') or (object_row.kind='shot' and scope_value='shot')
    or (object_row.kind='execution_plan' and scope_value='execution_plan') or (object_row.kind='act' and scope_value='act')
    or (object_row.kind='sequence' and scope_value='sequence') or (object_row.kind='asset' and scope_value='asset')
    or (object_row.kind='audio_plan' and scope_value='audio_plan')
    or (object_row.kind='scene_audio_direction' and scope_value='scene_audio_direction')) then
    raise exception 'The branch scope must match the object it branches' using errcode='22023'; end if;
  if coalesce(branch->>'source_version_id','') <> '' then
    source_version := (branch->>'source_version_id')::uuid;
    select * into version_row from tonde.object_versions where workspace_id=target_workspace and id=source_version;
    if not found then raise exception 'That version is unavailable' using errcode='P0002'; end if;
    if version_row.object_id <> scope_object then raise exception 'A branch must originate from a version of its scope object' using errcode='22023'; end if;
    source_rev := version_row.revision;
  else
    select (array_agg(v.id order by v.revision desc,v.created_at desc))[1] into source_version from tonde.object_versions v
      where v.workspace_id=target_workspace and v.object_id=scope_object and v.branch_name='main';
    source_rev := tonde_private.pi_object_revision(target_workspace,scope_object);
  end if;
  insert into tonde.object_branches(workspace_id,production_id,scope_object_id,scope,name,source_version_id,source_revision,reason)
    values(target_workspace,target_production,scope_object,scope_value,left(name_value,160),source_version,source_rev,left(coalesce(branch->>'reason',''),600))
    returning * into created;
  return jsonb_build_object('branch_id',created.id,'name',created.name,'scope',created.scope,'scope_object_id',created.scope_object_id,
    'source_version_id',created.source_version_id,'source_revision',created.source_revision,'state',created.state,
    'note','The branch is an alternative. Nothing on the mainline changed.');
end $$;
revoke all on function tonde.branch_create(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function tonde.branch_create(uuid,uuid,uuid,jsonb) to authenticated;

-- Backfill AFTER all table DDL/grants: deferred object-registry FK events from these
-- inserts otherwise make PostgreSQL reject subsequent ALTER/GRANT with 55006.
-- 026 is not applied hosted; no historical applied migration is rewritten.
-- Legacy timed audiovisual Productions get needs-direction, never guessed intent.
insert into tonde.production_audio_plans(workspace_id,production_id,created_by)
  select p.workspace_id,p.id,p.created_by from tonde.productions p
  where tonde_private.audio_applies(p.production_type,p.planned_duration_ms)
    and not exists(select 1 from tonde.production_audio_plans a where a.workspace_id=p.workspace_id and a.production_id=p.id);

commit;
