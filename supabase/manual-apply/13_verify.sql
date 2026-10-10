select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, n as name, to_regclass('tonde.' || n) is not null as present
  from unnest(array['object_branches','branch_changes','merge_proposals']) as n
  union all
  select 'enum', n, to_regtype('tonde.' || n) is not null
  from unnest(array['branch_state','branch_change_state','merge_state']) as n
  union all
  select 'column', 'tonde.object_branches.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'object_branches' and column_name = c)
  from unnest(array['id','workspace_id','production_id','scope_object_id','scope','name','source_version_id',
                    'source_revision','reason','state','merged_at','merged_by','merged_proposal_id','revision',
                    'created_by','created_at','updated_at']) as c
  union all
  select 'column', 'tonde.branch_changes.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'branch_changes' and column_name = c)
  from unnest(array['id','workspace_id','production_id','branch_id','target_object_id','base_version_id',
                    'base_revision','patch','changed_fields','note','state','applied_version_id',
                    'applied_revision','revision','created_by','created_at','updated_at']) as c
  union all
  select 'column', 'tonde.merge_proposals.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'merge_proposals' and column_name = c)
  from unnest(array['id','workspace_id','production_id','branch_id','items','conflicts','counts',
                    'structure_revision','state','decided_by','decided_at','decision_note','applied','impact',
                    'revision','created_by','created_at','updated_at']) as c
  union all
  select 'constraint', 'object_branches scope is a real scope', exists (
    select 1 from pg_constraint where conrelid = 'tonde.object_branches'::regclass
      and pg_get_constraintdef(oid) like '%scope%execution_plan%asset%')
  union all
  select 'constraint', 'branch_changes holds one change per object per branch', exists (
    select 1 from pg_constraint where conrelid = 'tonde.branch_changes'::regclass
      and pg_get_constraintdef(oid) like '%workspace_id, branch_id, target_object_id%')
  union all
  select 'constraint', 'branch_changes a patch is an object of fields', exists (
    select 1 from pg_constraint where conrelid = 'tonde.branch_changes'::regclass
      and pg_get_constraintdef(oid) like '%jsonb_typeof(patch)%')
  union all
  select 'constraint', 'merge_proposals items stay a list', exists (
    select 1 from pg_constraint where conrelid = 'tonde.merge_proposals'::regclass
      and pg_get_constraintdef(oid) like '%jsonb_typeof(items)%')
  union all
  select 'constraint', 'a branch originates from a real version', exists (
    select 1 from pg_constraint where conrelid = 'tonde.object_branches'::regclass
      and pg_get_constraintdef(oid) like '%source_version_id%object_versions%')
  union all
  select 'rls_enabled', n, coalesce((select relrowsecurity from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'tonde' and c.relname = n), false)
  from unnest(array['object_branches','branch_changes','merge_proposals']) as n
  union all
  select 'policy', 'tonde.' || t || '.' || p, exists(
    select 1 from pg_policies where schemaname = 'tonde' and tablename = t and policyname = p)
  from unnest(array['object_branches','branch_changes','merge_proposals']) as t
  cross join unnest(array['tenant_read','tenant_insert','tenant_update']) as p
  union all
  select 'trigger', 'tonde.' || t || '.guard_mutation', exists(
    select 1 from pg_trigger where tgname = 'guard_mutation' and not tgisinternal
      and tgrelid = ('tonde.' || t)::regclass)
  from unnest(array['object_branches','branch_changes','merge_proposals']) as t
  union all
  select 'trigger', 'tonde.object_versions.versions_immutable', exists(
    select 1 from pg_trigger where tgname = 'versions_immutable' and not tgisinternal
      and tgrelid = 'tonde.object_versions'::regclass)
  union all
  select 'version_action_hook', 'capture_revision records restore and merge honestly', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde_private' and p.proname = 'capture_revision'
      and pg_get_functiondef(p.oid) like '%tonde.version_action%')
  union all
  select 'index', n, exists(select 1 from pg_indexes where schemaname = 'tonde' and indexname = n)
  from unnest(array['object_branches_open','object_branches_by_production','branch_changes_by_branch',
                    'merge_proposals_recent']) as n
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.version_list(uuid,uuid,uuid,text,integer,integer)',
    'tonde.version_get(uuid,uuid,uuid)',
    'tonde.version_compare(uuid,uuid,uuid,uuid)',
    'tonde.version_restore(uuid,uuid,uuid,text)',
    'tonde.branch_create(uuid,uuid,uuid,jsonb)',
    'tonde.branch_list(uuid,uuid,text,integer,integer)',
    'tonde.branch_detail(uuid,uuid,uuid)',
    'tonde.branch_change_set(uuid,uuid,uuid,jsonb)',
    'tonde.branch_change_clear(uuid,uuid,uuid,uuid,text)',
    'tonde.branch_state_set(uuid,uuid,uuid,text,text)',
    'tonde.merge_preview(uuid,uuid,uuid)',
    'tonde.merge_decide(uuid,uuid,uuid,text,uuid[],text,text)']) as s
  union all
  select 'private_helper', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.versions_immutable()',
    'tonde_private.vb_fields(text)',
    'tonde_private.vb_field_label(text)',
    'tonde_private.vb_version(uuid,uuid)',
    'tonde_private.vb_object(uuid,uuid,uuid)',
    'tonde_private.vb_latest_version(uuid,uuid)',
    'tonde_private.vb_diff(uuid,text,jsonb,jsonb)',
    'tonde_private.vb_patch_apply(uuid,uuid,uuid,jsonb,integer,text)',
    'tonde_private.vb_structure_revision(uuid,uuid)']) as s
  union all
  select 'private_helper_locked', s, not exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde_private' and rp.routine_name = split_part(s, '(', 1)
      and rp.grantee in ('authenticated','anon','service_role','PUBLIC'))
  from unnest(array['versions_immutable','vb_fields','vb_field_label','vb_version','vb_object',
                    'vb_latest_version','vb_diff','vb_patch_apply','vb_structure_revision']) as s
  union all
  select 'public_rpc_grant', s, exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde' and rp.routine_name = s and rp.grantee = 'authenticated')
  from unnest(array[
    'version_list','version_get','version_compare','version_restore','branch_create','branch_list',
    'branch_detail','branch_change_set','branch_change_clear','branch_state_set','merge_preview',
    'merge_decide']) as s
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 13_202610050022_versioning_branches.sql did
-- not apply: fix the reported error and re-run only that file. Do not re-run 009-021.
