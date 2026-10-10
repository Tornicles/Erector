select kind, name, case when present then 'OK' else 'MISSING' end as result from (
  select 'guard' as kind, p.proname||' is security definer' as name, p.prosecdef as present
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde_private' and p.proname in ('guard_mutation','guard_human_acceptance')
  union all
  select 'guard', 'no client role may execute '||p.proname,
    not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde_private' and p.proname in ('guard_mutation','guard_human_acceptance')
  union all
  select 'coverage', 'every guard_mutation / a_human_acceptance trigger is still installed',
    (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'tonde' and not tg.tgisinternal
         and tg.tgname in ('guard_mutation','a_human_acceptance')) >= 81
  union all
  select 'privilege', 'service_role may insert the durable-jobs foundation',
    has_table_privilege('service_role','tonde.jobs','insert')
  union all
  select 'privilege', 'authenticated still holds SELECT alone on tonde.jobs',
    has_table_privilege('authenticated','tonde.jobs','select')
      and not has_table_privilege('authenticated','tonde.jobs','insert')
) checks order by kind, name;
