select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, n as name, to_regclass('tonde.' || n) is not null as present
  from unnest(array['structure_summaries','generate_ahead_jobs','generate_ahead_items']) as n
  union all
  select 'enum', n, to_regtype('tonde.' || n) is not null
  from unnest(array['series_kind','planning_depth','sequence_kind','structure_level',
                    'generate_horizon','generate_depth']) as n
  union all
  select 'column', 'tonde.acts.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'acts' and column_name = c)
  from unnest(array['purpose','narrative_goal','opening_state','ending_state','summary','lifecycle']) as c
  union all
  select 'column', 'tonde.sequences.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'sequences' and column_name = c)
  from unnest(array['purpose','kind','summary','lifecycle']) as c
  union all
  select 'column', 'tonde.scenes.act_id',
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'scenes' and column_name = 'act_id')
  union all
  select 'column', 'tonde.series.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'series' and column_name = c)
  from unnest(array['series_kind','format','timezone','revision','summary']) as c
  union all
  select 'column', 'tonde.series_episodes.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'series_episodes' and column_name = c)
  from unnest(array['title','slot_key','requested_depth','brief','lifecycle','revision']) as c
  union all
  select 'column', 'tonde.generate_ahead_items.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'generate_ahead_items' and column_name = c)
  from unnest(array['created_production_id','created_episode_id','state','error_message']) as c
  union all
  select 'rls_enabled', n, coalesce((select relrowsecurity from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'tonde' and c.relname = n), false)
  from unnest(array['structure_summaries','generate_ahead_jobs','generate_ahead_items',
                    'acts','sequences','scenes','series','series_episodes','series_collections']) as n
  union all
  select 'trigger', n, exists(select 1 from pg_trigger where tgname = n and not tgisinternal)
  from unnest(array['zz_scene_parent_guard','a_register_object','b_capture_revision']) as n
  union all
  select 'index', n, exists(select 1 from pg_indexes where schemaname = 'tonde' and indexname = n)
  from unnest(array['series_episodes_slot_key','series_episodes_schedule','generate_ahead_items_state',
                    'acts_live_order','sequences_live_order','scenes_live_act_order']) as n
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.long_form_structure(uuid,uuid,tonde.structure_level,uuid,integer,integer,integer)',
    'tonde.long_form_timing(uuid,uuid,integer)',
    'tonde.long_form_search(uuid,uuid,text,jsonb,integer,integer)',
    'tonde.long_form_summaries(uuid,uuid,integer,integer)',
    'tonde.long_form_script_index(uuid,uuid,integer,integer)',
    'tonde.long_form_context(uuid,uuid,tonde.structure_level,uuid,integer)',
    'tonde.save_structure_summary(uuid,uuid,tonde.structure_level,uuid,jsonb,integer,text,text)',
    'tonde.create_long_form_act(uuid,uuid,integer,jsonb)',
    'tonde.update_long_form_act(uuid,uuid,uuid,integer,jsonb)',
    'tonde.create_long_form_sequence(uuid,uuid,integer,jsonb)',
    'tonde.update_long_form_sequence(uuid,uuid,uuid,integer,jsonb)',
    'tonde.move_long_form_scene(uuid,uuid,uuid,integer,uuid,uuid)',
    'tonde.move_long_form_sequence(uuid,uuid,uuid,integer,uuid)',
    'tonde.split_long_form_structure(uuid,uuid,tonde.structure_level,uuid,bigint,integer,text)',
    'tonde.reorder_long_form(uuid,uuid,tonde.structure_level,uuid[],integer,uuid)',
    'tonde.set_long_form_approval(uuid,uuid,tonde.structure_level,uuid,text,integer)',
    'tonde.set_long_form_lock(uuid,uuid,tonde.structure_level,uuid,boolean,integer)',
    'tonde.create_series(uuid,uuid,jsonb)',
    'tonde.update_series(uuid,uuid,integer,jsonb)',
    'tonde.save_series_collection(uuid,uuid,jsonb)',
    'tonde.series_overview(uuid,uuid)',
    'tonde.create_series_episode(uuid,uuid,jsonb)',
    'tonde.update_series_episode(uuid,uuid,uuid,integer,jsonb)',
    'tonde.series_slots(uuid,uuid,tonde.generate_horizon,integer,date,text[])',
    'tonde.generate_ahead_preview(uuid,uuid,jsonb)',
    'tonde.generate_ahead(uuid,uuid,jsonb)',
    'tonde.retry_generate_ahead(uuid,uuid)',
    'tonde.generate_ahead_jobs(uuid,uuid,integer)',
    'tonde.series_production_line(uuid,uuid,integer,integer)',
    'tonde.series_director_context(uuid,uuid,integer)']) as s
  union all
  select 'private_helper', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.lf_scope_duration(uuid,uuid,tonde.structure_level,uuid)',
    'tonde_private.lf_production_timing(uuid,uuid)',
    'tonde_private.lf_depth(uuid,uuid,tonde.structure_level,uuid)',
    'tonde_private.lf_structure_revision(uuid,uuid)',
    'tonde_private.lf_slots(uuid,uuid,tonde.generate_horizon,integer,date)',
    'tonde_private.lf_generate_plan(uuid,tonde.series,jsonb)',
    'tonde_private.lf_line_state(uuid,uuid)',
    'tonde_private.lf_blockers(uuid,uuid,tonde.generate_depth)',
    'tonde_private.lf_inherit_series_context(uuid,tonde.series,uuid)']) as s
  union all
  select 'private_helper_locked', s, not exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde_private' and rp.routine_name = split_part(s, '(', 1)
      and rp.grantee in ('authenticated','anon','service_role','PUBLIC'))
  from unnest(array[
    'lf_production_timing',
    'lf_depth',
    'lf_generate_plan',
    'lf_slots',
    'lf_inherit_series_context']) as s
  union all
  select 'public_rpc_grant', s, exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde' and rp.routine_name = s and rp.grantee = 'authenticated')
  from unnest(array[
    'long_form_structure','long_form_timing','long_form_search','long_form_summaries',
    'long_form_script_index','long_form_context','save_structure_summary',
    'create_long_form_act','update_long_form_act','create_long_form_sequence','update_long_form_sequence',
    'move_long_form_scene','move_long_form_sequence','split_long_form_structure','reorder_long_form',
    'set_long_form_approval','set_long_form_lock','create_series','update_series','save_series_collection',
    'series_overview','create_series_episode','update_series_episode','series_slots',
    'generate_ahead_preview','generate_ahead','retry_generate_ahead','generate_ahead_jobs',
    'series_production_line','series_director_context']) as s
  union all
  select 'jobs_job_type', 'long_form_generation', exists(
    select 1 from pg_constraint where conname = 'jobs_job_type_check'
      and pg_get_constraintdef(oid) like '%long_form_generation%')
  union all
  select 'objects_kind', 'episode', exists(
    select 1 from pg_constraint where conname = 'objects_kind_check'
      and pg_get_constraintdef(oid) like '%episode%')
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 09_202610050018_long_form_series.sql did
-- not apply: fix the reported error and re-run only that file. Do not re-run 009-017.
