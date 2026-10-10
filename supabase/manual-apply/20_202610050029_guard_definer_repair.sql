-- Package 20 = migration 029, verbatim: the two platform guards were the only trigger functions still SECURITY
-- INVOKER while calling `tonde_private` helpers, and only `authenticated` holds EXECUTE on
-- those helpers. Because PostgreSQL may evaluate an `AND` operand out of order, the helper was
-- reached even for rows the guard's own condition excluded, so every write by any other role
-- (the server role included) failed with `permission denied for function ...` before the guard
-- could decide anything: `guard_mutation` on 69 tables and `guard_human_acceptance` on the 13
-- approval-bearing tables. Every other TONDE guard (validate_job_links, validate_semantic_links,
-- register_object, capture_revision, guard_reference_observation, ...) already runs SECURITY
-- DEFINER, and the private helper is itself DEFINER, so the truthful decision is unchanged.
--
-- Nothing else moves: both guards keep search_path = '', keep their exact bodies, keep their
-- revokes, and the approval guard still rejects an approval whose actor has no authenticated
-- identity, so no AI/system/service-role write can manufacture approved work.
begin;

alter function tonde_private.guard_mutation() security definer;
alter function tonde_private.guard_human_acceptance() security definer;

-- The guards remain callable only by the trigger machinery, never by a client role.
revoke all on function tonde_private.guard_mutation(),
  tonde_private.guard_human_acceptance() from public, anon, authenticated, service_role;

commit;
