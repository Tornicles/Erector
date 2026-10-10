select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, n as name, to_regclass('tonde.' || n) is not null as present
  from unnest(array['continuity_states','continuity_checks','continuity_findings']) as n
  union all
  select 'enum', n, to_regtype('tonde.' || n) is not null
  from unnest(array['continuity_domain','continuity_anchor','continuity_transition','continuity_origin',
                    'continuity_finding_kind','continuity_finding_state']) as n
  union all
  select 'column', 'tonde.continuity_states.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'continuity_states' and column_name = c)
  from unnest(array['workspace_id','production_id','domain','subject_object_id','trait','anchor','scene_id','shot_id',
                    'value','transition','origin','epistemic','confidence','reason','evidence','note','supersedes_id',
                    'retired_at','retired_by','retire_reason','revision','created_by','created_at','updated_at']) as c
  union all
  select 'column', 'tonde.continuity_checks.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'continuity_checks' and column_name = c)
  from unnest(array['workspace_id','production_id','production_revision','state_count','state_watermark',
                    'finding_count','critical_count','warning_count','info_count','counts','verdict','explanation',
                    'limitations','note','revision','created_by','created_at','updated_at']) as c
  union all
  select 'column', 'tonde.continuity_findings.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'continuity_findings' and column_name = c)
  from unnest(array['workspace_id','production_id','check_id','kind','severity','domain','subject_object_id','trait',
                    'earlier_state_id','later_state_id','at_scene_id','at_shot_id','explanation',
                    'suggested_resolution','origin','rationale','epistemic','confidence','evidence','state',
                    'resolution_note','resolved_by','resolved_at','revision','created_by','created_at','updated_at']) as c
  union all
  select 'constraint', 'continuity_states one live statement per trait per point', exists (
    select 1 from pg_indexes where schemaname = 'tonde' and indexname = 'continuity_states_live_identity'
      and indexdef like '%WHERE (retired_at IS NULL)%' and indexdef like '%UNIQUE%')
  union all
  select 'constraint', 'continuity_states anchor coherence', exists (
    select 1 from pg_constraint where conrelid = 'tonde.continuity_states'::regclass
      and pg_get_constraintdef(oid) like '%anchor%shot_id IS NOT NULL%')
  union all
  select 'constraint', 'continuity_findings observed findings cite evidence', exists (
    select 1 from pg_constraint where conrelid = 'tonde.continuity_findings'::regclass
      and pg_get_constraintdef(oid) like '%jsonb_array_length(evidence) > 0%')
  union all
  select 'constraint', 'continuity_findings a proposal is not an observation', exists (
    select 1 from pg_constraint where conrelid = 'tonde.continuity_findings'::regclass
      and pg_get_constraintdef(oid) like '%inferred%observed%')
  union all
  select 'rls_enabled', n, coalesce((select relrowsecurity from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'tonde' and c.relname = n), false)
  from unnest(array['continuity_states','continuity_checks','continuity_findings']) as n
  union all
  select 'policy', n, exists(select 1 from pg_policies where schemaname = 'tonde' and policyname = n)
  from unnest(array['tenant_read','tenant_insert','tenant_update']) as n
  union all
  select 'trigger', n, exists(select 1 from pg_trigger where tgname = n and not tgisinternal)
  from unnest(array['guard_mutation','zz_continuity_on_scene_change','zz_continuity_on_shot_change']) as n
  union all
  select 'index', n, exists(select 1 from pg_indexes where schemaname = 'tonde' and indexname = n)
  from unnest(array['continuity_states_live_identity','continuity_states_by_subject','continuity_states_by_production',
                    'continuity_checks_recent','continuity_findings_by_check','continuity_findings_open',
                    'continuity_findings_identity']) as n
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.continuity_state_set(uuid,uuid,jsonb)',
    'tonde.continuity_state_retire(uuid,uuid,uuid,text)',
    'tonde.continuity_state_list(uuid,uuid,uuid,text,boolean,integer,integer)',
    'tonde.continuity_chain(uuid,uuid,uuid,text,text)',
    'tonde.continuity_check(uuid,uuid,text)',
    'tonde.continuity_finding_list(uuid,uuid,text,text,uuid,integer,integer)',
    'tonde.continuity_finding_update(uuid,uuid,uuid,text,text)',
    'tonde.continuity_finding_record(uuid,uuid,jsonb)',
    'tonde.continuity_summary(uuid,uuid)']) as s
  union all
  select 'private_helper', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.ci_text(jsonb,text,integer,boolean)',
    'tonde_private.ci_scene_rank(uuid,uuid)',
    'tonde_private.ci_shot_rank(uuid,uuid)',
    'tonde_private.ci_timeline(uuid,uuid)',
    'tonde_private.ci_mark_stale(uuid,uuid,text,uuid)',
    'tonde_private.ci_stale_on_change()']) as s
  union all
  select 'private_helper_locked', s, not exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde_private' and rp.routine_name = split_part(s, '(', 1)
      and rp.grantee in ('authenticated','anon','service_role','PUBLIC'))
  from unnest(array['ci_text','ci_scene_rank','ci_shot_rank','ci_timeline','ci_mark_stale','ci_stale_on_change']) as s
  union all
  select 'public_rpc_grant', s, exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde' and rp.routine_name = s and rp.grantee = 'authenticated')
  from unnest(array[
    'continuity_state_set','continuity_state_retire','continuity_state_list','continuity_chain',
    'continuity_check','continuity_finding_list','continuity_finding_update','continuity_finding_record',
    'continuity_summary']) as s
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 11_202610050020_continuity_engine.sql did
-- not apply: fix the reported error and re-run only that file. Do not re-run 009-019.
