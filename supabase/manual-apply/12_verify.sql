select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, n as name, to_regclass('tonde.' || n) is not null as present
  from unnest(array['memory_policies','memory_candidates','memory_items']) as n
  union all
  select 'enum', n, to_regtype('tonde.' || n) is not null
  from unnest(array['memory_scope','memory_kind','memory_source','memory_origin']) as n
  union all
  select 'column', 'tonde.memory_policies.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'memory_policies' and column_name = c)
  from unnest(array['id','workspace_id','scope','production_id','series_id','candidate_capture',
                    'auto_accept_candidates','note','revision','created_by','created_at','updated_at']) as c
  union all
  select 'column', 'tonde.memory_candidates.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'memory_candidates' and column_name = c)
  from unnest(array['id','workspace_id','production_id','scope','kind','subject_key','statement',
                    'proposed_source','basis','observed_count','source_object_id','source_revision',
                    'state','decided_by','decided_at','decision_note','revision','created_by',
                    'created_at','updated_at']) as c
  union all
  select 'column', 'tonde.memory_items.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'memory_items' and column_name = c)
  from unnest(array['id','workspace_id','production_id','series_id','scope','kind','subject_key',
                    'statement','source','origin','rationale','evidence','source_object_id',
                    'source_revision','candidate_id','confirmed_by','confirmed_at','state',
                    'supersedes_id','retired_at','retired_by','retire_reason','revision','created_by',
                    'created_at','updated_at']) as c
  union all
  select 'constraint', 'memory_policies scope is coherent', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_policies'::regclass
      and pg_get_constraintdef(oid) like '%scope =%production%')
  union all
  select 'constraint', 'memory_items scope is coherent', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_items'::regclass
      and pg_get_constraintdef(oid) like '%scope =%series%')
  union all
  select 'constraint', 'memory_items a past statement is retired by link', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_items'::regclass
      and pg_get_constraintdef(oid) like '%supersedes_id%memory_items%')
  union all
  select 'constraint', 'memory_items confirmed knowledge names its confirmer', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_items'::regclass
      and pg_get_constraintdef(oid) like '%confirmed_by IS NOT NULL%')
  union all
  select 'constraint', 'memory_items an inference discloses its basis', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_items'::regclass
      and pg_get_constraintdef(oid) like '%jsonb_array_length(evidence) > 0%')
  union all
  select 'constraint', 'memory_items an inference cannot claim human authority', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_items'::regclass
      and pg_get_constraintdef(oid) like '%saved_preference%historical_pattern%inference%')
  union all
  select 'constraint', 'memory_items a pinned version names its object', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_items'::regclass
      and pg_get_constraintdef(oid) like '%source_revision IS NULL%')
  union all
  select 'constraint', 'memory_candidates rejects creator authority', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_candidates'::regclass
      and pg_get_constraintdef(oid) like '%proposed_source <>%creator_instruction%')
  union all
  select 'constraint', 'memory_candidates cites a real basis', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_candidates'::regclass
      and pg_get_constraintdef(oid) like '%jsonb_array_length(basis)%')
  union all
  select 'constraint', 'memory_candidates a decision records its time', exists (
    select 1 from pg_constraint where conrelid = 'tonde.memory_candidates'::regclass
      and pg_get_constraintdef(oid) like '%decided_at IS NOT NULL%')
  union all
  select 'rls_enabled', n, coalesce((select relrowsecurity from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'tonde' and c.relname = n), false)
  from unnest(array['memory_policies','memory_candidates','memory_items']) as n
  union all
  select 'policy', 'tonde.' || t || '.' || p, exists(
    select 1 from pg_policies where schemaname = 'tonde' and tablename = t and policyname = p)
  from unnest(array['memory_policies','memory_candidates','memory_items']) as t
  cross join unnest(array['tenant_read','tenant_insert','tenant_update']) as p
  union all
  select 'trigger', 'tonde.' || t || '.guard_mutation', exists(
    select 1 from pg_trigger where tgname = 'guard_mutation' and not tgisinternal
      and tgrelid = ('tonde.' || t)::regclass)
  from unnest(array['memory_policies','memory_candidates','memory_items']) as t
  union all
  select 'index', n, exists(select 1 from pg_indexes where schemaname = 'tonde' and indexname = n)
  from unnest(array['memory_policies_identity','memory_candidates_open','memory_candidates_recent',
                    'memory_items_live_identity','memory_items_by_subject','memory_items_by_scope',
                    'memory_items_history','memory_items_by_source']) as n
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.memory_policy_set(uuid,uuid,jsonb)',
    'tonde.memory_policy_get(uuid,uuid)',
    'tonde.memory_item_set(uuid,uuid,jsonb)',
    'tonde.memory_item_retire(uuid,uuid,uuid,text)',
    'tonde.memory_item_list(uuid,uuid,text,text,text,text,integer,integer)',
    'tonde.memory_resolve(uuid,uuid,text,text)',
    'tonde.memory_candidate_record(uuid,uuid,jsonb)',
    'tonde.memory_candidate_list(uuid,uuid,text,integer,integer)',
    'tonde.memory_candidate_decide(uuid,uuid,uuid,text,text)',
    'tonde.memory_summary(uuid,uuid)',
    'tonde.production_search(uuid,uuid,jsonb)']) as s
  union all
  select 'private_helper', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.mi_rank(tonde.memory_source)',
    'tonde_private.mi_uuid(jsonb,text,boolean)',
    'tonde_private.mi_patterns(text)',
    'tonde_private.mi_series_of(uuid,uuid)',
    'tonde_private.mi_policy(uuid,tonde.memory_scope,uuid,uuid)',
    'tonde_private.mi_search_lane(uuid,uuid,text,jsonb)']) as s
  union all
  select 'private_helper_locked', s, not exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde_private' and rp.routine_name = split_part(s, '(', 1)
      and rp.grantee in ('authenticated','anon','service_role','PUBLIC'))
  from unnest(array['mi_rank','mi_uuid','mi_patterns','mi_series_of','mi_policy','mi_search_lane']) as s
  union all
  select 'public_rpc_grant', s, exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde' and rp.routine_name = s and rp.grantee = 'authenticated')
  from unnest(array[
    'memory_policy_set','memory_policy_get','memory_item_set','memory_item_retire','memory_item_list',
    'memory_resolve','memory_candidate_record','memory_candidate_list','memory_candidate_decide',
    'memory_summary','production_search']) as s
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 12_202610050021_production_memory.sql did
-- not apply: fix the reported error and re-run only that file. Do not re-run 009-020.
