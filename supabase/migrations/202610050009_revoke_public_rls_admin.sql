-- Supabase platform event-trigger helper discovered during hosted review.
-- Keep it external to the clean TONDE schema lineage, but remove inherited/client
-- EXECUTE rights wherever it exists. It is absent in isolated local installs.
begin;
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role';
  end if;
end
$$;
commit;
