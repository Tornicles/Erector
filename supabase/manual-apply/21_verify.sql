select kind, name, case when present then 'OK' else 'MISSING' end as result from (
  select 'conflict' as kind, 'no applied function raises SQLSTATE 40001' as name,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('tonde','tonde_private') and p.prosrc ~ 'errcode[[:space:]]*=[[:space:]]*''40001''') = 0 as present
  union all
  select 'conflict', 'functions raising the transport-safe PT409 conflict code',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('tonde','tonde_private') and p.prosrc ~ 'PT409') >= 44
  union all
  select 'acl', 'tonde.approval_decide stays authenticated-only',
    has_function_privilege('authenticated','tonde.approval_decide(uuid,uuid,uuid,text,integer,text)','execute')
      and not has_function_privilege('anon','tonde.approval_decide(uuid,uuid,uuid,text,integer,text)','execute')
      and not has_function_privilege('service_role','tonde.approval_decide(uuid,uuid,uuid,text,integer,text)','execute')
  union all
  select 'guard', 'guard functions remain security definer',
    (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'tonde_private' and p.proname in ('guard_mutation','guard_human_acceptance'))
  union all
  select 'authority', 'human acceptance still rejects the server role',
    (select prosrc ~ 'auth.uid\(\) is null' from pg_proc p where p.oid = to_regprocedure('tonde_private.guard_human_acceptance()'))
) checks order by kind, name;
