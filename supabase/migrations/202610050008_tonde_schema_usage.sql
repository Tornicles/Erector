-- PostgREST introspection requires USAGE on exposed schemas for the anon role:
-- without it, hosted Data API requests with the publishable key returned
-- PGRST205 even after `tonde` was added to exposed schemas. Only schema-level
-- USAGE is granted; no table/sequence/routine privileges are added, so
-- anonymous users still cannot read or mutate TONDE data (RLS and explicit
-- table grants remain the access boundary). Verified: anonymous reads return
-- HTTP 401, and the hosted two-user acceptance suite passes 20/20 with this
-- grant applied.

grant usage on schema tonde to anon;
