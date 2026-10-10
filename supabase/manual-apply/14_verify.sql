select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, t as name, to_regclass('tonde.' || t) is not null as present
  from unnest(array['access_decisions']) as x(t)
  union all
  select 'enum', t, to_regtype('tonde.' || t) is not null
  from unnest(array['access_action','readiness_state','readiness_dimension']) as x(t)
  union all
  select 'enum_labels', 'tonde.' || labels.name, (
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) = labels.expected
    from pg_enum e join pg_type ty on ty.oid = e.enumtypid join pg_namespace ns on ns.oid = ty.typnamespace
    where ns.nspname = 'tonde' and ty.typname = labels.name)
  from (values
    ('access_action', 'approve,request_review,reopen,lock,unlock'),
    ('readiness_state', 'ready,ready_with_warnings,needs_review,blocked,unknown'),
    ('readiness_dimension', 'decisions,story,script,scene_plan,shots,continuity,resources,real_execution,ai_execution,approvals,dependencies,results,delivery')
  ) as labels(name, expected)
  union all
  select 'column', 'tonde.access_decisions.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'access_decisions' and column_name = c)
  from unnest(array['id','workspace_id','production_id','object_id','object_kind','action','from_approval',
                    'to_approval','from_locked','to_locked','pinned_revision','note','actor_user_id',
                    'created_at']) as x(c)
  union all
  select 'column', 'tonde.access_decisions.action uses the access_action enum', exists (
    select 1 from information_schema.columns where table_schema = 'tonde' and table_name = 'access_decisions'
      and column_name = 'action' and udt_name = 'access_action')
  union all
  select 'constraint', 'a decision pins a positive revision only', exists (
    select 1 from pg_constraint where conrelid = 'tonde.access_decisions'::regclass
      and pg_get_constraintdef(oid) like '%pinned_revision%')
  union all
  select 'constraint', 'a decision note stays bounded', exists (
    select 1 from pg_constraint where conrelid = 'tonde.access_decisions'::regclass
      and pg_get_constraintdef(oid) like '%note%')
  union all
  select 'constraint', 'a decision belongs to one workspace row', exists (
    select 1 from pg_constraint where conrelid = 'tonde.access_decisions'::regclass
      and pg_get_constraintdef(oid) like '%UNIQUE (workspace_id, id)%')
  union all
  select 'constraint', 'a decision names its Production', exists (
    select 1 from pg_constraint where conrelid = 'tonde.access_decisions'::regclass
      and pg_get_constraintdef(oid) like '%productions%')
  union all
  select 'constraint', 'a decision names a real object', exists (
    select 1 from pg_constraint where conrelid = 'tonde.access_decisions'::regclass
      and pg_get_constraintdef(oid) like '%objects%')
  union all
  select 'rls_enabled', t, coalesce((select relrowsecurity from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'tonde' and c.relname = t), false)
  from unnest(array['access_decisions']) as x(t)
  union all
  select 'policy', 'tonde.access_decisions.' || p, exists(
    select 1 from pg_policies where schemaname = 'tonde' and tablename = 'access_decisions' and policyname = p)
  from unnest(array['tenant_read']) as x(p)
  union all
  -- The decision record is read-only to clients: only the guarded RPCs write it.
  select 'policy_absent', 'tonde.access_decisions has no ' || wanted.cmd || ' policy', not exists(
    select 1 from pg_policies pol
    where pol.schemaname = 'tonde' and pol.tablename = 'access_decisions' and pol.cmd = wanted.cmd)
  from unnest(array['UPDATE','DELETE']) as wanted(cmd)
  union all
  select 'trigger', 'tonde.access_decisions.access_decisions_immutable', exists(
    select 1 from pg_trigger where tgname = 'access_decisions_immutable' and not tgisinternal
      and tgrelid = 'tonde.access_decisions'::regclass)
  union all
  select 'trigger', 'tonde.' || rel || '.a_human_acceptance is still mounted', exists(
    select 1 from pg_trigger where tgname = 'a_human_acceptance' and not tgisinternal
      and tgrelid = ('tonde.' || rel)::regclass)
  from unnest(array['scenes','shots','results','execution_plans']) as x(rel)
  union all
  select 'hook', 'a human approval is still enforced in the database', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde_private' and p.proname = 'guard_human_acceptance'
      and pg_get_functiondef(p.oid) like '%creator decision%')
  union all
  select 'hook', 'capture_revision still records its source action honestly', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde_private' and p.proname = 'capture_revision'
      and pg_get_functiondef(p.oid) like '%tonde.version_action%')
  union all
  -- 9E must not weaken the Prompt 9A rule that locked dependents are reported, never rewritten.
  select 'hook', 'the impact engine still reports locked dependents instead of rewriting them', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde' and p.proname = 'apply_impact'
      and pg_get_functiondef(p.oid) like '%locked_skipped%')
  union all
  select 'hook', 'locked and approved dependents are still detected', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde_private' and p.proname = 'pi_is_locked')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'tonde_private' and p.proname = 'pi_is_approved')
  union all
  select 'index', i, exists(select 1 from pg_indexes where schemaname = 'tonde' and indexname = i)
  from unnest(array['access_decisions_by_object','access_decisions_recent']) as x(i)
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.approval_decide(uuid,uuid,uuid,text,integer,text)',
    'tonde.lock_set(uuid,uuid,uuid,boolean,integer,text)',
    'tonde.access_state(uuid,uuid,uuid)',
    'tonde.access_history(uuid,uuid,uuid,integer,integer)',
    'tonde.production_readiness(uuid,uuid,integer)']) as x(s)
  union all
  select 'private_helper', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.access_decisions_immutable()',
    'tonde_private.ax_approval(uuid,uuid)',
    'tonde_private.ax_locked_at(uuid,uuid)',
    'tonde_private.ax_set_approval(uuid,uuid,uuid,tonde.approval)',
    'tonde_private.ax_set_lock(uuid,uuid,uuid,boolean)',
    'tonde_private.rd_blocker(text,text,text,text,uuid,text,text,text,text,text)']) as x(s)
  union all
  select 'private_helper_locked', s, not exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde_private' and rp.routine_name = split_part(s, '(', 1)
      and rp.grantee in ('authenticated','anon','service_role','PUBLIC'))
  from unnest(array['access_decisions_immutable','ax_approval','ax_locked_at','ax_set_approval','ax_set_lock',
                    'rd_blocker']) as x(s)
  union all
  select 'public_rpc_grant', s, exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde' and rp.routine_name = s and rp.grantee = 'authenticated')
  from unnest(array[
    'approval_decide','lock_set','access_state','access_history','production_readiness']) as x(s)
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 14_202610050023_approval_lock_readiness.sql did
-- not apply: fix the reported error and re-run only that file. Do not re-run 009-022.
