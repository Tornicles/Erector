select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'constraint' as kind, c as name,
    exists (select 1 from pg_constraint x
            where x.conrelid = 'tonde.execution_plans'::regclass and x.conname = c and x.contype = 'f') as present
  from unnest(array['execution_plans_model_profile_fk','execution_plans_fallback_model_profile_fk']) as u(c)
  union all
  select 'fk_target', c || ' references ai_model_profiles',
    exists (select 1 from pg_constraint x
      join pg_class r on r.oid = x.confrelid join pg_namespace n on n.oid = r.relnamespace
      where x.conrelid = 'tonde.execution_plans'::regclass and x.conname = c
        and x.contype = 'f' and n.nspname = 'tonde' and r.relname = 'ai_model_profiles')
  from unnest(array['execution_plans_model_profile_fk','execution_plans_fallback_model_profile_fk']) as u(c)
  union all
  select 'delete_rule', c || ' is on delete restrict',
    exists (select 1 from pg_constraint x
            where x.conrelid = 'tonde.execution_plans'::regclass and x.conname = c and x.confdeltype = 'r')
  from unnest(array['execution_plans_model_profile_fk','execution_plans_fallback_model_profile_fk']) as u(c)
  union all
  select 'index', i,
    exists (select 1 from pg_indexes where schemaname = 'tonde' and tablename = 'execution_plans' and indexname = i)
  from unnest(array['execution_plans_by_model_profile','execution_plans_by_fallback_model_profile']) as u(i)
  union all
  select 'function', 'tonde.ai_creation_surface(uuid,uuid,integer)',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'tonde' and p.proname = 'ai_creation_surface'
              and oidvectortypes(p.proargtypes) = 'uuid, uuid, integer')
  union all
  select 'function_body', 'ai_creation_surface computes readiness once per Shot',
    (select array_length(regexp_split_to_array(p.prosrc, 'ai_readiness_state'), 1) - 1 = 1
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tonde' and p.proname = 'ai_creation_surface')
  union all
  select 'acl', 'ai_creation_surface is executable by authenticated only',
    (select has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tonde' and p.proname = 'ai_creation_surface')
  union all
  select 'rls', 'tonde.execution_plans keeps row level security',
    coalesce((select relrowsecurity from pg_class where oid = 'tonde.execution_plans'::regclass), false)
) t
order by kind, name;
