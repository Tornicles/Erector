select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, n as name, to_regclass('tonde.' || n) is not null as present
  from unnest(array['stale_artifacts','impact_analyses','object_dependencies']) as n
  union all
  select 'enum', n, to_regtype('tonde.' || n) is not null
  from unnest(array['dependency_strength','dependency_origin','impact_class','impact_mode',
                    'artifact_kind','stale_state']) as n
  union all
  select 'column', 'tonde.object_dependencies.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'object_dependencies' and column_name = c)
  from unnest(array['reason','strength','origin','affected_fields','source_version','target_version',
                    'active','note','evidence','created_by','created_at','updated_at','revision']) as c
  union all
  select 'column', 'tonde.stale_artifacts.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'stale_artifacts' and column_name = c)
  from unnest(array['workspace_id','production_id','object_id','artifact_kind','artifact_ref','state','reason',
                    'caused_by_object_id','caused_by_revision','source_revision','current_revision',
                    'resolved_at','resolved_by','note','revision']) as c
  union all
  select 'column', 'tonde.impact_analyses.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'impact_analyses' and column_name = c)
  from unnest(array['workspace_id','production_id','root_object_id','root_label','root_kind','root_revision',
                    'structure_revision','direction','requested_depth','mode','applied_mode','applied_at',
                    'classifications','counts','locked_ids','approved_ids','explanation','unresolved_count',
                    'note','created_by','created_at','revision']) as c
  union all
  select 'relation_check', 'object_dependencies relation', exists (
    select 1 from pg_constraint where conname like 'object_dependencies_relation%'
      and pg_get_constraintdef(oid) like '%derived_from%')
  union all
  select 'rls_enabled', n, coalesce((select relrowsecurity from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'tonde' and c.relname = n), false)
  from unnest(array['stale_artifacts','impact_analyses','object_dependencies']) as n
  union all
  select 'policy', n, exists(select 1 from pg_policies where schemaname = 'tonde' and policyname = n)
  from unnest(array['tenant_read','tenant_insert','tenant_update']) as n
  union all
  select 'trigger', n, exists(select 1 from pg_trigger where tgname = n and not tgisinternal)
  from unnest(array['guard_mutation','zz_stale_on_shot_change','zz_stale_on_scene_change',
                    'zz_stale_on_document_change','zz_stale_on_plan_change']) as n
  union all
  select 'index', n, exists(select 1 from pg_indexes where schemaname = 'tonde' and indexname = n)
  from unnest(array['object_dependencies_source','object_dependencies_target','stale_artifacts_identity',
                    'stale_artifacts_open','impact_analyses_recent']) as n
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.dependency_sync(uuid,uuid)',
    'tonde.dependency_edge(uuid,uuid,uuid,uuid,text,text,text,text,text[],jsonb)',
    'tonde.dependency_active(uuid,uuid,uuid[],boolean,text)',
    'tonde.dependency_graph(uuid,uuid,uuid,text,integer,integer)',
    'tonde.dependency_edges(uuid,uuid,uuid,integer,integer)',
    'tonde.impact_preview(uuid,uuid,uuid,integer,integer)',
    'tonde.impact_history(uuid,uuid,integer,integer)',
    'tonde.apply_impact(uuid,uuid,uuid,text,uuid[],integer,text)',
    'tonde.stale_artifact_list(uuid,uuid,text,integer,integer)',
    'tonde.resolve_stale_artifact(uuid,uuid,uuid,text)',
    'tonde.mark_stale_artifact(uuid,uuid,uuid,text,text,uuid)']) as s
  union all
  select 'private_helper', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.pi_read_guard(uuid)',
    'tonde_private.pi_label(uuid,uuid)',
    'tonde_private.pi_object_revision(uuid,uuid)',
    'tonde_private.pi_is_locked(uuid,uuid)',
    'tonde_private.pi_is_approved(uuid,uuid)',
    'tonde_private.pi_walk(uuid,uuid,integer,text)',
    'tonde_private.pi_explain(uuid,uuid,integer,integer,text)',
    'tonde_private.pi_mark_stale(uuid,uuid,uuid,tonde.artifact_kind,uuid,text,uuid,integer,integer,integer,tonde.stale_state)',
    'tonde_private.pi_stale_on_source_change()']) as s
  union all
  select 'private_helper_locked', s, not exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde_private' and rp.routine_name = split_part(s, '(', 1)
      and rp.grantee in ('authenticated','anon','service_role','PUBLIC'))
  from unnest(array['pi_read_guard','pi_label','pi_object_revision','pi_is_locked','pi_is_approved',
                    'pi_walk','pi_explain','pi_mark_stale','pi_stale_on_source_change']) as s
  union all
  select 'public_rpc_grant', s, exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde' and rp.routine_name = s and rp.grantee = 'authenticated')
  from unnest(array[
    'dependency_sync','dependency_edge','dependency_active','dependency_graph','dependency_edges',
    'impact_preview','impact_history','apply_impact','stale_artifact_list','resolve_stale_artifact',
    'mark_stale_artifact']) as s
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 10_202610050019_dependencies_impact.sql did
-- not apply: fix the reported error and re-run only that file. Do not re-run 009-018.
