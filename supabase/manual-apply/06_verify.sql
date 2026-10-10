select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'column' as kind, 'tonde.shots.' || c as name,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'shots' and column_name = c) as present
  from unnest(array['purpose', 'subject', 'framing', 'angle', 'movement', 'composition',
                    'transition', 'story_relationship', 'creative_notes', 'story_beat',
                    'source_operation_id']) as c
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.studio_timing(uuid,uuid,integer)',
    'tonde.create_studio_scene(uuid,uuid,integer,jsonb)',
    'tonde.update_studio_scene(uuid,uuid,uuid,integer,jsonb)',
    'tonde.reorder_studio_scenes(uuid,uuid,integer,uuid[])',
    'tonde.archive_studio_scene(uuid,uuid,uuid,integer,boolean)',
    'tonde.create_studio_shot(uuid,uuid,uuid,integer,jsonb)',
    'tonde.update_studio_shot(uuid,uuid,uuid,integer,jsonb)',
    'tonde.move_studio_shot(uuid,uuid,uuid,uuid,integer)',
    'tonde.reorder_studio_shots(uuid,uuid,uuid,integer,uuid[])',
    'tonde.archive_studio_shot(uuid,uuid,uuid,integer)',
    'tonde.set_studio_approval(uuid,uuid,text,uuid,text,integer)',
    'tonde.set_studio_lock(uuid,uuid,text,uuid,boolean,integer)',
    'tonde.reconcile_studio_runtime(uuid,uuid,uuid,integer)']) as s
  union all
  select 'pay_backend_private', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.studio_guard(uuid,uuid,integer)',
    'tonde_private.studio_revision_guard(uuid,uuid,uuid,text,integer)',
    'tonde_private.studio_timing(uuid,uuid)',
    'tonde_private.assert_scope_object(uuid,uuid,uuid,text)']) as s
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 06_202610050015_studio_workspace.sql
-- did not apply: fix the reported error and re-run only that file. Do not re-run 009-014.
