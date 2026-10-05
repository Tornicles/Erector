begin;
-- Keep durations exact AND representable in browser Number arithmetic.
do $$ declare entity text; field text; begin
  foreach entity in array array['productions','acts','sequences','scenes','shots'] loop
    foreach field in array array['planned_duration_ms','calculated_duration_ms','start_ms','end_ms'] loop
      execute format('alter table tonde.%I add constraint %I check (%I <= 9007199254740991)',entity,entity || '_' || field || '_safe_integer',field);
    end loop;
  end loop;
end $$;
alter table tonde.media_files add check (duration_ms <= 9007199254740991);
alter table tonde.dialogue_lines add check (start_ms <= 9007199254740991 and duration_ms <= 9007199254740991 - start_ms);
alter table tonde.series_episodes add check (runtime_target_ms <= 9007199254740991);
alter table tonde.media_files drop constraint media_files_mime_type_check;
alter table tonde.media_files add check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/wav','audio/mp4','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/zip','application/json'));
alter table tonde.media_files add check (file_category <> 'export' or bucket = 'tonde-exports');
alter table tonde.media_files add check (retention_policy = 'persistent' or expires_at is not null);
alter table tonde.media_files add check (bucket <> 'tonde-avatars' or bytes <= 5242880);

create function tonde_private.validate_semantic_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare data jsonb := to_jsonb(new); parent_id uuid; related_scene uuid; related_shot uuid; related_prod uuid; asset_kind tonde.asset_type; scope_kind text;
begin
  if tg_table_name = 'series_episodes' then
    select project_id into parent_id from tonde.series where id = new.series_id;
    if parent_id is distinct from (select project_id from tonde.productions where id = new.production_id) then
      raise exception 'Series and episode must share a project' using errcode = '23514';
    end if;
  elsif tg_table_name = 'scenes' and data->>'environment_asset_id' is not null then
    select asset_type into asset_kind from tonde.assets where id = (data->>'environment_asset_id')::uuid;
    if asset_kind <> 'environment' then raise exception 'Scene environment must be an environment asset' using errcode = '23514'; end if;
  elsif tg_table_name = 'scene_participants' then
    select asset_type into asset_kind from tonde.assets where id = new.asset_id;
    if asset_kind <> 'character' then raise exception 'Scene participant must be a character asset' using errcode = '23514'; end if;
  elsif tg_table_name in ('dialogue_lines','results') then
    if data->>'shot_id' is not null and data->>'scene_id' is not null then
      select scene_id into related_scene from tonde.shots where id = (data->>'shot_id')::uuid;
      if related_scene is distinct from (data->>'scene_id')::uuid then raise exception 'Shot belongs to another scene' using errcode = '23514'; end if;
    end if;
    if tg_table_name = 'results' and data->>'execution_plan_id' is not null and data->>'shot_id' is not null then
      select shot_id into related_shot from tonde.execution_plans where id = (data->>'execution_plan_id')::uuid;
      if related_shot is distinct from (data->>'shot_id')::uuid then raise exception 'Execution plan belongs to another shot' using errcode = '23514'; end if;
    end if;
  elsif tg_table_name = 'shot_match_reports' then
    select shot_id into related_shot from tonde.results where id = new.result_id;
    if related_shot is distinct from new.shot_id then raise exception 'Result belongs to another shot' using errcode = '23514'; end if;
    if new.corrected_plan_id is not null then
      select shot_id into related_shot from tonde.execution_plans where id = new.corrected_plan_id;
      if related_shot is distinct from new.shot_id then raise exception 'Corrected plan belongs to another shot' using errcode = '23514'; end if;
    end if;
  elsif tg_table_name = 'exports' then
    select object_id into parent_id from tonde.object_versions where id = new.production_version_id;
    if parent_id is distinct from new.production_id then raise exception 'Export version belongs to another production' using errcode = '23514'; end if;
    select production_id into related_prod from tonde.jobs where id = new.job_id and job_type = 'export';
    if related_prod is distinct from new.production_id then raise exception 'Export job belongs to another production' using errcode = '23514'; end if;
  elsif tg_table_name = 'director_threads' then
    select kind into scope_kind from tonde.objects where id = new.scope_object_id;
    if new.scope_type in ('production','act','sequence','scene','shot') and new.scope_type <> scope_kind then
      raise exception 'Conversation scope type does not match target' using errcode = '23514';
    end if;
  elsif tg_table_name = 'director_messages' and data->>'related_object_id' is not null then
    select production_id into related_prod from tonde.objects where id = new.related_object_id;
    select production_id into parent_id from tonde.director_threads where id = new.thread_id;
    if related_prod is distinct from parent_id then raise exception 'Message object belongs to another production' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
do $$ declare entity text; begin
  foreach entity in array array['series_episodes','scenes','scene_participants','dialogue_lines','results','shot_match_reports','exports','director_threads','director_messages'] loop
    execute format('create trigger validate_semantic_links before insert or update on tonde.%I for each row execute function tonde_private.validate_semantic_links()',entity);
  end loop;
end $$;
revoke all on function tonde_private.validate_semantic_links() from public, anon, authenticated;
commit;
