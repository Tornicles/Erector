-- Prompt 11 repair 048: functions default to PUBLIC execute, and earlier packets granted
-- authenticated/service_role without revoking that default, so anon can route to RPCs
-- (every RPC still denies anonymous in-body with 42501). Strip the default surface while
-- preserving every explicit grant. Idempotent: revoking an absent privilege is a no-op.
begin;
do $$
declare fn record;
begin
  for fn in
    select n.nspname as schema_name, p.proname as fn_name,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('tonde', 'tonde_private') and p.prokind in ('f', 'p')
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon',
      fn.schema_name, fn.fn_name, fn.args);
  end loop;
end $$;
commit;
