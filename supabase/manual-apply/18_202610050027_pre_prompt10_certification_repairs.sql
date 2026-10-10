begin;
-- References acquired revisions in 026 but never acquired the matching history trigger.
create trigger b_capture_revision after insert or update on tonde.production_references
  for each row execute function tonde_private.capture_revision();
-- Retain current legacy state honestly; do not invent earlier historical revisions.
insert into tonde.object_versions(workspace_id,object_id,revision,actor_type,actor_user_id,source_action,snapshot)
  select r.workspace_id,r.id,r.revision,'system',null,'snapshot_backfill',to_jsonb(r)
  from tonde.production_references r
  where not exists(select 1 from tonde.object_versions v
    where v.workspace_id=r.workspace_id and v.object_id=r.id and v.branch_name='main' and v.revision=r.revision);

-- Enclosing hierarchy is distinct from a derived artifact's source relationship.
create or replace function tonde_private.pi_is_locked(target_workspace uuid,target_object uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare kind text; locked boolean := false; parent_id uuid; scene_ref uuid; sequence_ref uuid; act_ref uuid;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id=target_workspace and o.id=target_object;
  case kind
    when 'production' then select locked_at is not null into locked from tonde.productions where workspace_id=target_workspace and id=target_object;
    when 'act' then select locked_at is not null,production_id into locked,parent_id from tonde.acts where workspace_id=target_workspace and id=target_object;
    when 'sequence' then
      select locked_at is not null,act_id,production_id into locked,act_ref,parent_id from tonde.sequences where workspace_id=target_workspace and id=target_object;
    when 'scene' then
      select locked_at is not null,sequence_id,act_id,production_id into locked,sequence_ref,act_ref,parent_id from tonde.scenes where workspace_id=target_workspace and id=target_object;
    when 'shot' then
      select locked_at is not null,scene_id,production_id into locked,scene_ref,parent_id from tonde.shots where workspace_id=target_workspace and id=target_object;
    when 'asset' then select locked_at is not null into locked from tonde.assets where workspace_id=target_workspace and id=target_object;
    when 'reference' then locked := false;
    -- These relationships point to SOURCES, not enclosing editable scopes. Always report
    -- their staleness even if the source is locked; their own locks still protect content.
    when 'execution_plan' then select locked_at is not null into locked from tonde.execution_plans where workspace_id=target_workspace and id=target_object;
    when 'creative_document' then select locked_at is not null into locked from tonde.creative_documents where workspace_id=target_workspace and id=target_object;
    when 'dialogue_line' then select locked_at is not null into locked from tonde.dialogue_lines where workspace_id=target_workspace and id=target_object;
    when 'result' then select locked_at is not null into locked from tonde.results where workspace_id=target_workspace and id=target_object;
    when 'audio_plan' then select locked_at is not null,production_id into locked,parent_id from tonde.production_audio_plans where workspace_id=target_workspace and id=target_object;
    when 'scene_audio_direction' then select locked_at is not null,scene_id,production_id into locked,scene_ref,parent_id from tonde.scene_audio_directions where workspace_id=target_workspace and id=target_object;
    else locked := false;
  end case;
  if not coalesce(locked,false) and scene_ref is not null then locked := tonde_private.pi_is_locked(target_workspace,scene_ref); end if;
  if not coalesce(locked,false) and sequence_ref is not null then locked := tonde_private.pi_is_locked(target_workspace,sequence_ref); end if;
  if not coalesce(locked,false) and act_ref is not null then locked := tonde_private.pi_is_locked(target_workspace,act_ref); end if;
  if not coalesce(locked,false) and parent_id is not null then locked := tonde_private.pi_is_locked(target_workspace,parent_id); end if;
  return coalesce(locked,false);
end $$;
revoke all on function tonde_private.pi_is_locked(uuid,uuid) from public,anon,authenticated,service_role;

-- Row enforcement covers direct authenticated CRUD and first-time Audio insertion too.
-- Approval and explicit own-lock decisions remain independent from content edits.
create function tonde_private.guard_enclosing_scope_mutation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare row_data jsonb := to_jsonb(new); parent_field text; parent_id uuid;
begin
  if tg_op='UPDATE' and (to_jsonb(new)-array['revision','updated_at','locked_at','approval'])
    is not distinct from (to_jsonb(old)-array['revision','updated_at','locked_at','approval']) then return new; end if;
  foreach parent_field in array array['production_id','act_id','sequence_id','scene_id'] loop
    parent_id := nullif(row_data->>parent_field,'')::uuid;
    if parent_id is not null and tonde_private.pi_is_locked(new.workspace_id,parent_id) then
      raise exception 'Unlock the enclosing scope before editing this object' using errcode='23514';
    end if;
    if tg_op='UPDATE' then
      parent_id := nullif(to_jsonb(old)->>parent_field,'')::uuid;
      if parent_id is not null and tonde_private.pi_is_locked(old.workspace_id,parent_id) then
        raise exception 'Unlock the enclosing scope before moving this object' using errcode='23514';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function tonde_private.guard_enclosing_scope_mutation() from public,anon,authenticated,service_role;
do $$ declare entity text; begin
  foreach entity in array array['acts','sequences','scenes','shots','production_audio_plans','scene_audio_directions'] loop
    execute format('create trigger guard_enclosing_scope before insert or update on tonde.%I for each row execute function tonde_private.guard_enclosing_scope_mutation()',entity);
  end loop;
end $$;

-- Client-callable analysis persistence must enforce the same evidence floor as Python.
-- A citation alone does not turn unavailable media into an observed visual/audio claim.
create function tonde_private.guard_reference_observation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare modalities jsonb;
begin
  if new.epistemic <> 'observed' then return new; end if;
  if jsonb_typeof(new.evidence) is distinct from 'array' or jsonb_array_length(new.evidence)=0 then
    raise exception 'An observed finding must cite evidence' using errcode='23514';
  end if;
  select a.capabilities->'modalities' into modalities from tonde.reference_analyses a
    where a.workspace_id=new.workspace_id and a.id=new.analysis_id;
  if new.category in ('camera','composition','lighting','color','blocking','performance','environment','product','typography')
    and coalesce(modalities->>'image','unavailable') <> 'available'
    and coalesce(modalities->>'video_frames','unavailable') <> 'available' then
    raise exception 'Visual observations require available analyzed media' using errcode='23514';
  end if;
  if new.category in ('sound','music','voice','dialogue')
    and coalesce(modalities->>'audio','unavailable') <> 'available' then
    raise exception 'Audio observations require an available analyzed audio track' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_reference_observation() from public,anon,authenticated,service_role;
create trigger guard_reference_observation before insert or update on tonde.reference_findings
  for each row execute function tonde_private.guard_reference_observation();
commit;
