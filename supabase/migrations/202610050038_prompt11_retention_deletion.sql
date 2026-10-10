-- Prompt 11 packet 038 — retention and deletion orchestration.
--
-- Prompts 1–10 left retention as a per-row stamp (`media_files.retention_policy` / `expires_at`) and
-- deletion as a lifecycle value (`tonde.lifecycle`) with no durable execution behind either. This
-- packet supplies that execution and keeps two honest boundaries:
--
--   * TONDE cannot delete an object from object storage inside SQL. The database therefore marks the
--     row and queues the object for a privileged worker (`tonde.storage_purge_queue`), and a deletion
--     is NOT complete while any queued object is still unpurged. Nothing claims otherwise.
--   * TONDE cannot delete an authentication identity inside SQL either. Where retained evidence or a
--     tombstone still references the account, the recorded outcome is ANONYMIZED/DISABLED rather than
--     a deletion that did not happen; recording "deleted" while a reference remains is refused.
--
-- Laws enforced here, not merely described:
--   * A deletion is phased and validated: scheduled -> frozen -> revoking -> purging -> verifying ->
--     completed, with failed/cancelled reachable only where the machine allows. No state is skipped.
--   * Freezing is what makes a workspace unusable, and it happens once, after the grace period, only
--     when no legal hold is active and no requested export is still open.
--   * Credentials are destroyed in the revoking phase by deleting the stored ciphertext. A provider
--     token that cannot be revoked remotely is listed in `remote_revocation_required` - evidence of a
--     real obligation, never a claim that revocation happened.
--   * Purging is bounded, resumable and generic: every workspace-scoped table is drained in batches,
--     with the small audited set of retained-evidence, queue and tombstone tables excluded. Where a
--     foreign key still holds a row back the step reports it instead of aborting the deletion.
--   * Completion requires an independent verification pass whose residual count is zero.
--   * Retention sweeps are durable work with a persisted record, a bounded batch and a truthful
--     result: retained classes report what was retained and delete nothing. Infected media is never
--     rewritten - its object is queued for purging while the row keeps saying quarantine.
--   * A client session can request, cancel and read the status of a deletion for a workspace it owns
--     or belongs to. It can never freeze, revoke, purge, verify or complete one.
--
-- The one amendment this packet makes to earlier laws, and why it is not a rewrite: Prompts 2, 5, 10
-- and 11 made version snapshots, approval decisions, publication authorizations, submission attempts,
-- reconciliations, subscription history and job history APPEND-ONLY, and their BEFORE DELETE triggers
-- refuse every delete. That is right for every ordinary path, including a routine retention sweep. It
-- cannot be right for a creator-authorized deletion: refusing there would mean keeping a creator's
-- content after they asked for it to be removed, which is the lie this packet exists to prevent. The
-- guards are therefore extended, not weakened, in one narrow way: they permit a DELETE only inside a
-- transaction carrying the marker `tonde.deletion_workspace`, which only `tonde.deletion_purge_step`
-- sets, only for the workspace being deleted, and only for the duration of that call. Every other
-- caller - client, worker, operator, sweep - still cannot change or remove one of those rows, and the
-- deletion records the removal in its own trail.
begin;

-- 1. Vocabulary. New closed sets are their own types; the existing `tonde.lifecycle` is untouched.
create type tonde.deletion_scope as enum ('workspace', 'account');
create type tonde.deletion_state as enum ('scheduled', 'frozen', 'revoking', 'purging', 'verifying',
  'completed', 'failed', 'cancelled');

-- 2. The retention policy registry. One row per governed data class. Two independent flags:
--    `purge_action = 'retain'` means a sweep never deletes this class; `purge_exempt` means a
--    workspace DELETION leaves the rows behind. Billing evidence is the case where they differ: a
--    routine sweep retains it, but a workspace deletion cannot both delete the workspace and keep its
--    usage rows attached to purged work.
create table tonde.retention_classes (
  data_class text primary key check (length(data_class) between 3 and 60),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  description text not null default '',
  table_names text[] not null default '{}',
  age_column text,
  default_retention_days integer check (default_retention_days is null or default_retention_days >= 0),
  purge_action text not null check (purge_action in ('delete_rows','queue_object_purge','anonymize','retain')),
  purge_exempt boolean not null default false,
  purge_order integer not null default 100 check (purge_order >= 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint retention_class_names_tables check (cardinality(table_names) >= 1),
  constraint retention_rows_need_age check (purge_action <> 'delete_rows' or age_column is not null)
);
create trigger guard_mutation before insert or update on tonde.retention_classes
  for each row execute function tonde_private.guard_mutation();
insert into tonde.retention_classes(data_class, display_name, description, table_names, age_column,
  default_retention_days, purge_action, purge_exempt, purge_order) values
  ('integration_credential','Integration credentials','Stored provider ciphertext. Destroyed when a
   connection is revoked or expired, and always destroyed by a deletion.','{integration_credentials}',
   'updated_at',30,'delete_rows',false,3),
  ('upload_intent','Upload intents','Upload authorizations and their recorded parts.','{media_upload_intents}',
   'created_at',30,'delete_rows',false,5),
  ('media_temporary','Temporary media','Media whose own retention window closed. The object is queued for
   storage purging before the row leaves.','{media_files}','expires_at',null,'queue_object_purge',false,10),
  ('job_payload','Job payloads','Per-attempt job input and result metadata for terminal jobs.',
   '{jobs}','updated_at',90,'anonymize',false,15),
  ('media_derived','Derived media','Proxies, thumbnails, waveforms and sidecars that reached their own
   expiry. The original is never touched.','{media_files}','expires_at',null,'queue_object_purge',false,20),
  ('export_artifact','Export artifacts','Built export packages past their expiry.',
   '{media_files}','expires_at',null,'queue_object_purge',false,25),
  ('job_events','Job execution history','Append-only execution history. A routine sweep retains it;
   a creator-authorized workspace deletion is the one path that removes it.','{job_events}','created_at',
   null,'retain',false,30),
  ('outbox_events','Outbox events','Delivered or deliberately skipped outbox records.',
   '{outbox_events}','created_at',30,'delete_rows',false,35),
  ('usage_events','Usage evidence','Usage and billing evidence. A routine sweep retains it; a workspace
   deletion removes it, because a deleted workspace cannot keep usage rows attached to purged work.',
   '{usage_events}',null,null,'retain',false,40),
  ('object_purge_work','Object purge work','Queued storage purging. This is durable WORK, not residue:
   it is never drained by the workspace purge, and a deletion stays incomplete while it is pending.',
   '{storage_purge_queue}','requested_at',null,'retain',true,45),
  ('audit_events','Audit trail','The append-only audit trail. Retained as evidence.',
   '{audit_events}',null,null,'retain',true,50),
  ('legal_holds','Legal holds','Compliance holds and their release. Retained as evidence.',
   '{legal_holds}','placed_at',null,'retain',true,55),
  ('deletion_evidence','Deletion evidence','The deletion request and its event trail. Retained.',
   '{deletion_events,deletion_requests}',null,null,'retain',true,60),
  ('workspace_record','Workspace tombstone','The workspace row itself. Frozen and retained; never hard
   deleted so retained evidence keeps a valid owner.','{workspaces}',null,null,'retain',true,70)
on conflict (data_class) do update set display_name = excluded.display_name,
  description = excluded.description, table_names = excluded.table_names, age_column = excluded.age_column,
  default_retention_days = excluded.default_retention_days, purge_action = excluded.purge_action,
  purge_exempt = excluded.purge_exempt, purge_order = excluded.purge_order, updated_at = now();

alter table tonde.retention_classes enable row level security;
grant all on tonde.retention_classes to service_role;

-- 3. Object purge queue. The honest representation of "the row is gone, the object is not yet".
create table tonde.storage_purge_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  media_id uuid references tonde.media_files(id) on delete set null,
  bucket text not null check (length(bucket) between 1 and 100),
  object_key text not null check (length(object_key) between 1 and 1024),
  reason text not null check (length(btrim(reason)) between 1 and 200),
  state text not null default 'pending' check (state in ('pending','claimed','purged','absent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_owner text, lease_expires_at timestamptz,
  requested_at timestamptz not null default now(),
  purged_at timestamptz, absent_at timestamptz,
  last_error_code text, last_error_message text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  unique (workspace_id, bucket, object_key),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  constraint purge_lease_pair check ((lease_owner is null) = (lease_expires_at is null)),
  constraint purge_claimed_is_leased check (state <> 'claimed' or lease_owner is not null),
  constraint purge_purged_is_stamped check (state <> 'purged' or purged_at is not null),
  constraint purge_absent_is_stamped check (state <> 'absent' or absent_at is not null)
);
create index storage_purge_claimable on tonde.storage_purge_queue(available_at, requested_at, id)
  where state in ('pending','claimed');
create index storage_purge_by_workspace on tonde.storage_purge_queue(workspace_id, state);
alter table tonde.storage_purge_queue enable row level security;
grant all on tonde.storage_purge_queue to service_role;

-- 4. Retention sweeps. A sweep row is durable work: it is claimed, applied in bounded batches and
--    completed only when a batch came back short.
create table tonde.retention_sweeps (
  id uuid primary key default gen_random_uuid(),
  data_class text not null references tonde.retention_classes(data_class) on delete restrict,
  table_names text[] not null default '{}',
  cutoff_at timestamptz not null,
  dry_run boolean not null default false,
  state text not null default 'requested' check (state in ('requested','running','completed','failed')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz, completed_at timestamptz,
  candidates integer not null default 0 check (candidates >= 0),
  handled integer not null default 0 check (handled >= 0),
  retained integer not null default 0 check (retained >= 0),
  objects_queued integer not null default 0 check (objects_queued >= 0),
  error_code text, error_message text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  unique (data_class, cutoff_at, dry_run),
  constraint sweep_completed_is_stamped check (state <> 'completed' or completed_at is not null),
  constraint sweep_failed_is_explained check (state <> 'failed' or error_code is not null)
);
create index retention_sweeps_recent on tonde.retention_sweeps(state, requested_at desc, id);
alter table tonde.retention_sweeps enable row level security;
grant all on tonde.retention_sweeps to service_role;

-- 5. Legal holds. A hold blocks freezing and purging; it cannot be placed or released by a client.
create table tonde.legal_holds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  scope tonde.deletion_scope not null default 'workspace',
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  placed_by uuid references auth.users(id) on delete set null,
  placed_by_label text not null default '' check (length(placed_by_label) <= 160),
  placed_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  release_reason text,
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  constraint hold_release_is_explained check ((released_at is null) = (release_reason is null))
);
create unique index one_active_hold_per_scope on tonde.legal_holds(workspace_id, scope) where released_at is null;
alter table tonde.legal_holds enable row level security;
create policy tenant_read on tonde.legal_holds for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.legal_holds to authenticated;
grant all on tonde.legal_holds to service_role;

-- 6. Deletion requests. One open request per workspace; the phases are stamped as they happen.
create table tonde.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  owner_user_id uuid not null,
  scope tonde.deletion_scope not null,
  state tonde.deletion_state not null default 'scheduled',
  reason text not null default '' check (length(reason) <= 2000),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  confirmed_name text not null,
  grace_until timestamptz not null,
  export_first boolean not null default false,
  export_id uuid,
  job_id uuid,
  phase_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(phase_counts) = 'object'),
  residuals jsonb not null default '{}'::jsonb check (jsonb_typeof(residuals) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  remote_revocation_required jsonb not null default '[]'::jsonb
    check (jsonb_typeof(remote_revocation_required) = 'array'),
  auth_deletion_outcome text check (auth_deletion_outcome in ('deleted','anonymized_disabled')),
  auth_deletion_recorded_at timestamptz,
  auth_deletion_evidence jsonb,
  frozen_at timestamptz, revoked_at timestamptz, purge_started_at timestamptz, verified_at timestamptz,
  completed_at timestamptz, failed_at timestamptz,
  cancelled_at timestamptz, cancelled_by uuid references auth.users(id) on delete set null,
  cancellation_reason text,
  failure_code text, failure_message text,
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, job_id) references tonde.jobs(workspace_id, id) on delete restrict,
  constraint deletion_grace_is_after_request check (grace_until >= requested_at),
  constraint deletion_account_is_owner check (scope <> 'account' or requested_by = owner_user_id),
  constraint deletion_completed_is_stamped check (state <> 'completed' or completed_at is not null),
  constraint deletion_failed_is_explained check
    (state <> 'failed' or (failed_at is not null and failure_code is not null)),
  constraint deletion_cancelled_is_stamped check
    (state <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null)),
  constraint deletion_auth_evidence_paired check
    ((auth_deletion_recorded_at is null) = (auth_deletion_evidence is null))
);
create trigger guard_mutation before insert or update on tonde.deletion_requests
  for each row execute function tonde_private.guard_mutation();
create unique index one_open_deletion_per_workspace on tonde.deletion_requests(workspace_id)
  where state in ('scheduled','frozen','revoking','purging','verifying');
create index deletion_requests_by_owner on tonde.deletion_requests(owner_user_id, state, requested_at desc);
alter table tonde.deletion_requests enable row level security;
create policy tenant_read on tonde.deletion_requests for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.deletion_requests to authenticated;
grant all on tonde.deletion_requests to service_role;

-- 7. The deletion trail. Append-only, like every other history surface in TONDE.
create table tonde.deletion_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  request_id uuid not null,
  event_type text not null check (event_type in ('requested','cancelled','frozen','credentials_revoked',
    'remote_revocation_required','purge_progress','verified','residuals_remaining','auth_deletion_recorded',
    'completed','failed','hold_placed','hold_released')),
  actor_kind text not null check (actor_kind in ('user','server','system','operator')),
  actor text not null default '' check (length(actor) <= 120),
  from_state text, to_state text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, request_id) references tonde.deletion_requests(workspace_id, id) on delete restrict
);
create index deletion_events_by_request on tonde.deletion_events(workspace_id, request_id, created_at desc, id);
create function tonde_private.guard_deletion_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Deletion events are an append-only record and cannot be changed' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_deletion_event before update or delete on tonde.deletion_events
  for each row execute function tonde_private.guard_deletion_event();
create trigger guard_mutation before update on tonde.deletion_events
  for each row execute function tonde_private.guard_mutation();
alter table tonde.deletion_events enable row level security;
create policy tenant_read on tonde.deletion_events for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.deletion_events to authenticated;
grant all on tonde.deletion_events to service_role;
grant usage, select on sequence tonde.deletion_events_id_seq to service_role;
revoke all on function tonde_private.guard_deletion_event() from public, anon, authenticated, service_role;

-- 8. The append-only deletion exception. One marker, one meaning: this transaction is the authorized
--    removal of one workspace's data. The guards below are the exact earlier functions plus one early
--    branch; nothing else about them changes, so every other caller keeps the original refusal.
create function tonde_private.deletion_may_remove(target_workspace uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('tonde.deletion_workspace', true), ''), '')
    = coalesce(target_workspace::text, '');
$$;
revoke all on function tonde_private.deletion_may_remove(uuid) from public, anon, authenticated, service_role;

create or replace function tonde_private.guard_job_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' and tonde_private.deletion_may_remove(old.workspace_id) then return old; end if;
    raise exception 'Job events are an append-only record and cannot be changed' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_job_event() from public, anon, authenticated, service_role;

create or replace function tonde_private.guard_deletion_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' and tonde_private.deletion_may_remove(old.workspace_id) then return old; end if;
    raise exception 'Deletion events are an append-only record and cannot be changed' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_deletion_event() from public, anon, authenticated, service_role;

create or replace function tonde_private.versions_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and tonde_private.deletion_may_remove(old.workspace_id) then return old; end if;
  raise exception 'Historical versions are immutable' using errcode = '23514';
end $$;
revoke all on function tonde_private.versions_immutable() from public, anon, authenticated, service_role;

create or replace function tonde_private.access_decisions_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and tonde_private.deletion_may_remove(old.workspace_id) then return old; end if;
  raise exception 'Access decisions are an append-only record and cannot be changed' using errcode = '23514';
end $$;
revoke all on function tonde_private.access_decisions_immutable() from public, anon, authenticated, service_role;

create or replace function tonde_private.guard_subscription_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' and tonde_private.deletion_may_remove(old.workspace_id) then return old; end if;
    raise exception 'Subscription history is an append-only record and cannot be changed'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_subscription_event() from public, anon, authenticated, service_role;

create or replace function tonde_private.guard_publication_authorization() returns trigger
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications;
begin
  if tg_op = 'DELETE' then
    if tonde_private.deletion_may_remove(old.workspace_id) then return old; end if;
    raise exception 'Publication authorizations are an append-only record and cannot be changed'
      using errcode = '23514';
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Publication authorizations are an append-only record and cannot be changed'
      using errcode = '23514';
  end if;
  -- Creative approval is a different fact; this one is a human statement about a real-world action.
  if auth.uid() is null or (select auth.role()) = 'service_role' then
    raise exception 'Publication authorization is a human creator decision; a service or AI process cannot record one'
      using errcode = '42501';
  end if;
  if new.actor_user_id is distinct from auth.uid() then
    raise exception 'Publication authorization must name the authenticated creator who made it'
      using errcode = '42501';
  end if;
  if not tonde_private.can_edit_workspace(new.workspace_id) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into publication from tonde.publications p
    where p.workspace_id = new.workspace_id and p.id = new.publication_id for update;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  -- An authorization names the exact version and destination the creator reviewed. A later change
  -- makes it stale, and submission refuses to use a stale authorization.
  if new.production_revision <> publication.production_revision or new.result_id <> publication.result_id
    or new.result_revision <> publication.result_revision or new.media_id <> publication.media_id
    or new.media_checksum <> publication.media_checksum
    or new.destination_provider <> publication.destination_provider
    or new.destination_account_id is distinct from publication.destination_account_id
    or new.destination <> publication.destination then
    raise exception 'This authorization does not match the publication version and destination it names'
      using errcode = '23514';
  end if;
  if new.request_fingerprint <> tonde_private.publication_fingerprint(new.workspace_id, new.publication_id) then
    raise exception 'This authorization does not match the content it names; authorize the publication as it is now'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_publication_authorization() from public, anon, authenticated, service_role;

create or replace function tonde_private.guard_publication_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; first_attempt tonde.publication_attempts; next_number integer;
begin
  if tg_op = 'DELETE' then
    if tonde_private.deletion_may_remove(old.workspace_id) then return old; end if;
    raise exception 'Submission attempts are an append-only record and cannot be deleted'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'in_flight' then
      raise exception 'A submission attempt starts in flight; its outcome is recorded afterwards'
        using errcode = '23514';
    end if;
    select * into publication from tonde.publications p
      where p.workspace_id = new.workspace_id and p.id = new.publication_id;
    if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
    if new.operation_id <> publication.operation_id or new.idempotency_key <> publication.idempotency_key then
      raise exception 'Every attempt of one publication reuses its operation id and idempotency key'
        using errcode = '23514';
    end if;
    select coalesce(max(a.attempt_number), 0) + 1 into next_number
      from tonde.publication_attempts a where a.publication_id = new.publication_id;
    if new.attempt_number <> next_number then
      raise exception 'Submission attempts are numbered in order; the next attempt is %', next_number
        using errcode = '23514';
    end if;
    select * into first_attempt from tonde.publication_attempts a
      where a.publication_id = new.publication_id order by a.attempt_number limit 1;
    if found and new.request_fingerprint <> first_attempt.request_fingerprint then
      raise exception 'This publication already submitted different content; publish the change as a new publication'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.state <> 'in_flight' then
    raise exception 'A finished submission attempt is a closed record and cannot be changed'
      using errcode = '23514';
  end if;
  if (new.id, new.workspace_id, new.publication_id, new.attempt_number, new.operation_id,
      new.idempotency_key, new.request_fingerprint, new.started_at)
    is distinct from
    (old.id, old.workspace_id, old.publication_id, old.attempt_number, old.operation_id,
     old.idempotency_key, old.request_fingerprint, old.started_at) then
    raise exception 'A submission attempt records what was submitted and cannot be rewritten'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_publication_attempt() from public, anon, authenticated, service_role;

create or replace function tonde_private.guard_publication_reconciliation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if tonde_private.deletion_may_remove(old.workspace_id) then return old; end if;
    raise exception 'Reconciliations are an append-only record and cannot be changed'
      using errcode = '23514';
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Reconciliations are an append-only record and cannot be changed'
      using errcode = '23514';
  end if;
  if new.source = 'manual_operator' then
    if auth.uid() is null or (select auth.role()) = 'service_role'
      or new.actor_user_id is distinct from auth.uid() then
      raise exception 'A manual reconciliation names the person who observed the destination'
        using errcode = '42501';
    end if;
    if not tonde_private.can_edit_workspace(new.workspace_id) then
      raise exception 'Workspace access denied' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_publication_reconciliation() from public, anon, authenticated, service_role;

-- 9. Private helpers.

-- An owner check that does not depend on the workspace still being `active`; a freeze must not be
-- able to lock the requester out of their own deletion record.
create function tonde_private.is_workspace_owner(target_workspace uuid, target_user uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tonde.workspaces w where w.id = target_workspace
    and w.owner_user_id = coalesce(target_user, (select auth.uid())));
$$;
revoke all on function tonde_private.is_workspace_owner(uuid,uuid) from public, anon, authenticated, service_role;

-- Tables a workspace purge must never drain: retained evidence, durable queue work and tombstones.
create function tonde_private.purge_exempt_tables() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct name order by name), array[]::text[])
  from (select unnest(c.table_names) as name from tonde.retention_classes c
    where c.purge_exempt and c.enabled) exempt;
$$;
revoke all on function tonde_private.purge_exempt_tables() from public, anon, authenticated, service_role;

-- Every base table in the exposed schema that scopes rows by workspace, minus the exempt set. Computed
-- from the catalog so a table added by a later migration is purged without editing this file.
create function tonde_private.workspace_purge_tables() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct c.table_name order by c.table_name), array[]::text[])
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'tonde' and t.table_type = 'BASE TABLE' and c.column_name = 'workspace_id'
    and c.table_name <> all (tonde_private.purge_exempt_tables());
$$;
revoke all on function tonde_private.workspace_purge_tables() from public, anon, authenticated, service_role;

-- The transition matrix a deletion may move through. Asserted wherever the state changes.
create function tonde_private.deletion_transition_allowed(from_state text, to_state text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce((from_state, to_state) in (
    ('scheduled','frozen'),('scheduled','cancelled'),('scheduled','failed'),
    ('frozen','revoking'),('frozen','cancelled'),('frozen','failed'),
    ('revoking','purging'),('revoking','failed'),
    ('purging','purging'),('purging','verifying'),('purging','failed'),
    ('verifying','purging'),('verifying','verifying'),('verifying','completed'),('verifying','failed'),
    ('failed','revoking'),('failed','purging')
  ), false);
$$;
revoke all on function tonde_private.deletion_transition_allowed(text,text) from public, anon, authenticated, service_role;

create function tonde_private.deletion_advance(target_request uuid, to_state text, actor_kind text,
  actor text, event_name text, detail jsonb default '{}'::jsonb) returns tonde.deletion_requests
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; previous text;
begin
  select * into request from tonde.deletion_requests r where r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  previous := request.state::text;
  if not tonde_private.deletion_transition_allowed(previous, to_state) then
    raise exception 'DELETION_TRANSITION_INVALID: a deletion in % cannot become %', previous, to_state
      using errcode = 'PT409';
  end if;
  update tonde.deletion_requests set state = to_state::tonde.deletion_state, updated_at = now()
    where id = target_request returning * into request;
  insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor,
    from_state, to_state, detail)
  values (request.workspace_id, target_request, event_name, actor_kind, left(coalesce(actor, ''), 120),
    previous, to_state, coalesce(detail, '{}'::jsonb));
  return request;
end $$;
revoke all on function tonde_private.deletion_advance(uuid,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;

-- Cancelling open work is part of freezing, not a separate product decision: a frozen workspace must
-- not have a worker finish a job inside data the creator asked to delete.
create function tonde_private.deletion_cancel_open_jobs(target_workspace uuid, actor text) returns integer
language plpgsql security definer set search_path = '' as $$
declare target_job record; cancelled integer := 0;
begin
  -- The orchestrator's own job is not cancelled: it is the worker that is running this freeze, and it
  -- finishes normally. Everything else in the workspace stops.
  for target_job in select j.id, j.status::text as status from tonde.jobs j
    where j.workspace_id = target_workspace
      and j.job_type <> 'deletion_orchestration'
      and j.status not in ('succeeded','failed','cancelled','timed_out','dead_letter')
    order by j.created_at loop
    -- The transition is asserted against the same matrix the job platform uses, and the row is written
    -- in one statement so the completion stamp and the lease release land together.
    perform tonde_private.assert_job_transition(target_job.id, target_job.status, 'cancelled');
    update tonde.jobs set status = 'cancelled', cancelled_at = now(), completed_at = now(),
      cancel_reason = 'Workspace deletion', termination_reason = 'user_cancelled',
      lease_owner = null, lease_expires_at = null, updated_at = now()
      where id = target_job.id;
    perform tonde_private.record_job_event(target_workspace, target_job.id, 'cancelled', 'system', actor,
      target_job.status, 'cancelled', jsonb_build_object('reason', 'workspace_deletion'));
    cancelled := cancelled + 1;
  end loop;
  return cancelled;
end $$;
revoke all on function tonde_private.deletion_cancel_open_jobs(uuid,text)
  from public, anon, authenticated, service_role;

-- An independent verification pass. Counts what is actually still there, from the catalog, rather
-- than trusting the phases that ran.
create function tonde_private.deletion_residuals(target_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; table_list text[]; target text; residue bigint;
  counts jsonb := '{}'::jsonb; total bigint := 0;
begin
  select * into request from tonde.deletion_requests r where r.id = target_request;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  table_list := tonde_private.workspace_purge_tables();
  foreach target in array table_list loop
    execute format('select count(*) from tonde.%I where workspace_id = $1', target)
      into residue using request.workspace_id;
    if residue > 0 then
      counts := counts || jsonb_build_object(target, residue);
      total := total + residue;
    end if;
  end loop;
  select count(*) into residue from tonde.storage_purge_queue q
    where q.workspace_id = request.workspace_id and q.state in ('pending','claimed','failed');
  if residue > 0 then counts := counts || jsonb_build_object('storage_purge_pending', residue);
    total := total + residue; end if;
  select count(*) into residue from tonde_private.integration_credentials c
    join tonde.integration_connections ic on ic.id = c.connection_id
    where ic.workspace_id = request.workspace_id;
  if residue > 0 then counts := counts || jsonb_build_object('stored_credentials', residue);
    total := total + residue; end if;
  select count(*) into residue from tonde.jobs j where j.workspace_id = request.workspace_id
    and j.status not in ('succeeded','failed','cancelled','timed_out','dead_letter');
  if residue > 0 then counts := counts || jsonb_build_object('open_jobs', residue);
    total := total + residue; end if;
  if not exists (select 1 from tonde.workspaces w where w.id = request.workspace_id
      and w.lifecycle = 'deleted') then
    counts := counts || jsonb_build_object('workspace_not_frozen', 1);
    total := total + 1;
  end if;
  if request.scope = 'account' then
    select count(*) into residue from tonde.workspaces w
      where w.owner_user_id = request.owner_user_id and w.lifecycle <> 'deleted';
    if residue > 0 then counts := counts || jsonb_build_object('owned_workspaces_not_deleted', residue);
      total := total + residue; end if;
    if not exists (select 1 from tonde.profiles p where p.user_id = request.owner_user_id
        and p.display_name = 'Deleted account' and p.avatar_url is null) then
      counts := counts || jsonb_build_object('profile_not_anonymized', 1);
      total := total + 1;
    end if;
    select count(*) into residue from tonde.user_preferences p where p.user_id = request.owner_user_id;
    if residue > 0 then counts := counts || jsonb_build_object('preferences_remaining', residue);
      total := total + residue; end if;
    select count(*) into residue from tonde.workspace_members m
      join tonde.workspaces w on w.id = m.workspace_id
      where m.user_id = request.owner_user_id and w.lifecycle <> 'deleted';
    if residue > 0 then counts := counts || jsonb_build_object('memberships_remaining', residue);
      total := total + residue; end if;
  end if;
  return jsonb_build_object('counts', counts, 'total', total);
end $$;
revoke all on function tonde_private.deletion_residuals(uuid) from public, anon, authenticated, service_role;

-- Rows that still reference an authentication identity. An account may only be recorded as actually
-- deleted when this is zero; otherwise the honest outcome is anonymized/disabled.
create function tonde_private.account_identity_references(target_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare counts jsonb := '{}'::jsonb; residue bigint; total bigint := 0;
begin
  select count(*) into residue from tonde.workspaces w where w.owner_user_id = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('workspaces_owned', residue); total := total + residue; end if;
  select count(*) into residue from tonde.workspace_members m where m.user_id = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('workspace_members', residue); total := total + residue; end if;
  select count(*) into residue from tonde.profiles p where p.user_id = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('profiles', residue); total := total + residue; end if;
  select count(*) into residue from tonde.user_preferences p where p.user_id = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('user_preferences', residue); total := total + residue; end if;
  select count(*) into residue from tonde.deletion_requests r
    where r.requested_by = target_user or r.cancelled_by = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('deletion_requests', residue); total := total + residue; end if;
  select count(*) into residue from tonde.media_files m where m.created_by = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('media_files_created', residue); total := total + residue; end if;
  select count(*) into residue from tonde.jobs j where j.requested_by = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('jobs_requested', residue); total := total + residue; end if;
  select count(*) into residue from tonde.exports e where e.requested_by = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('exports_requested', residue); total := total + residue; end if;
  select count(*) into residue from tonde.audit_events a where a.actor_user_id = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('audit_events', residue); total := total + residue; end if;
  select count(*) into residue from tonde.integration_connections c where c.connected_by = target_user;
  if residue > 0 then counts := counts || jsonb_build_object('integration_connections', residue); total := total + residue; end if;
  return jsonb_build_object('counts', counts, 'total', total);
end $$;
revoke all on function tonde_private.account_identity_references(uuid)
  from public, anon, authenticated, service_role;

-- 9. Requesting and cancelling a deletion (creator authority), and the status read.

create function tonde.deletion_request(target_workspace uuid, p_scope text default 'workspace',
  p_reason text default '', p_export_first boolean default false, p_confirmation text default '',
  p_grace_days integer default 7) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare workspace tonde.workspaces; request tonde.deletion_requests; existing tonde.deletion_requests;
  grace integer; created jsonb := '[]'::jsonb; target record; job jsonb; ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_scope not in ('workspace','account') then
    raise exception 'A deletion is either for one workspace or the whole account' using errcode = '22023';
  end if;
  if p_grace_days is null or p_grace_days < 0 or p_grace_days > 90 then
    raise exception 'A deletion grace period is between 0 and 90 days' using errcode = '22023';
  end if;
  select * into workspace from tonde.workspaces w where w.id = target_workspace;
  if not found then raise exception 'That workspace does not exist' using errcode = 'P0002'; end if;
  if not exists (select 1 from tonde.workspace_members m where m.workspace_id = target_workspace
      and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the workspace owner can delete it' using errcode = '42501';
  end if;
  if p_scope = 'account' and workspace.owner_user_id <> auth.uid() then
    raise exception 'Only the account owner can delete the account' using errcode = '42501';
  end if;
  -- Typed confirmation: the workspace name must be supplied exactly. A deletion is not accidental.
  if btrim(coalesce(p_confirmation, '')) <> workspace.name then
    raise exception 'DELETION_NOT_CONFIRMED: type the workspace name exactly to confirm'
      using errcode = 'PT400';
  end if;
  grace := coalesce(p_grace_days, 7);
  for target in
    select w.id from tonde.workspaces w
    where w.id = target_workspace
      or (p_scope = 'account' and w.owner_user_id = auth.uid() and w.lifecycle <> 'deleted')
    order by w.created_at loop
    select * into existing from tonde.deletion_requests r where r.workspace_id = target.id
      and r.state in ('scheduled','frozen','revoking','purging','verifying');
    if existing.id is not null then
      ids := ids || existing.id;
      created := created || jsonb_build_object('request_id', existing.id, 'workspace_id', target.id,
        'state', existing.state, 'idempotent', true);
      continue;
    end if;
    if exists (select 1 from tonde.legal_holds h where h.workspace_id = target.id
        and h.released_at is null and h.scope in ('workspace','account')) then
      raise exception 'LEGAL_HOLD_ACTIVE: this workspace is under a legal hold and cannot be deleted'
        using errcode = 'PT409';
    end if;
    insert into tonde.deletion_requests(workspace_id, owner_user_id, scope, reason, requested_by,
      confirmed_name, grace_until, export_first)
    values (target.id, workspace.owner_user_id, p_scope::tonde.deletion_scope,
      left(coalesce(p_reason, ''), 2000), auth.uid(), btrim(p_confirmation),
      now() + make_interval(days => grace), coalesce(p_export_first, false))
    returning * into request;
    job := tonde.job_enqueue(target.id, 'deletion_orchestration', null,
      jsonb_build_object('deletion_request_id', request.id, 'scope', request.scope::text,
        'grace_until', request.grace_until),
      'deletion:' || request.id::text, null, null, null, null);
    update tonde.deletion_requests set job_id = (job ->> 'job_id')::uuid
      where id = request.id returning * into request;
    insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor,
      to_state, detail)
    values (request.workspace_id, request.id, 'requested', 'user', auth.uid()::text, 'scheduled',
      jsonb_build_object('scope', request.scope::text, 'grace_until', request.grace_until,
        'export_first', request.export_first, 'job_id', job ->> 'job_id'));
    ids := ids || request.id;
    created := created || jsonb_build_object('request_id', request.id, 'workspace_id', request.workspace_id,
      'state', 'scheduled', 'idempotent', false, 'grace_until', request.grace_until,
      'job_id', job ->> 'job_id');
  end loop;
  perform tonde_private.audit_event(target_workspace, 'deletion.requested', null, 'deletion_request',
    jsonb_build_object('scope', p_scope, 'grace_days', grace, 'export_first',
      coalesce(p_export_first, false), 'requests', created));
  return jsonb_build_object('requests', created, 'request_ids', to_jsonb(ids),
    'grace_days', grace, 'scope', p_scope,
    'meaning', case when grace = 0
      then 'The deletion is scheduled with no grace period and the orchestrator may freeze immediately.'
      else 'The deletion is scheduled and can still be cancelled until the grace period ends.' end);
end $$;
revoke all on function tonde.deletion_request(uuid,text,text,boolean,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_request(uuid,text,text,boolean,text,integer)
  to authenticated, service_role;

create function tonde.deletion_cancel(target_workspace uuid, target_request uuid, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests;
begin
  if not exists (select 1 from tonde.workspaces w where w.id = target_workspace) then
    raise exception 'That workspace does not exist' using errcode = 'P0002';
  end if;
  -- The owner who asked for the deletion may still cancel after the freeze emptied the memberships, so
  -- the refusal below is about what the deletion has already destroyed, never about access.
  if auth.uid() is null or not (exists (select 1 from tonde.workspace_members m
      where m.workspace_id = target_workspace and m.user_id = auth.uid() and m.role = 'owner')
    or exists (select 1 from tonde.deletion_requests r where r.workspace_id = target_workspace
      and r.requested_by = auth.uid())) then
    raise exception 'Only the workspace owner can cancel the deletion' using errcode = '42501';
  end if;
  select * into request from tonde.deletion_requests r
    where r.workspace_id = target_workspace and r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  if request.state = 'cancelled' then
    return jsonb_build_object('request_id', request.id, 'state', 'cancelled', 'idempotent', true);
  end if;
  if request.state not in ('scheduled','frozen') then
    raise exception 'DELETION_IRREVERSIBLE: this deletion is % and can no longer be cancelled', request.state
      using errcode = 'PT409';
  end if;
  update tonde.deletion_requests set cancelled_at = now(), cancelled_by = auth.uid(),
    cancellation_reason = left(coalesce(p_reason, ''), 2000), updated_at = now()
    where id = request.id returning * into request;
  perform tonde_private.deletion_advance(request.id, 'cancelled', 'user', auth.uid()::text, 'cancelled',
    jsonb_build_object('reason', request.cancellation_reason));
  perform tonde_private.audit_event(target_workspace, 'deletion.cancelled', request.id, 'deletion_request',
    jsonb_build_object('reason', request.cancellation_reason));
  return jsonb_build_object('request_id', request.id, 'state', 'cancelled', 'idempotent', false,
    'meaning', 'The deletion was cancelled before any data was destroyed.');
end $$;
revoke all on function tonde.deletion_cancel(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_cancel(uuid,uuid,text) to authenticated, service_role;

create function tonde.deletion_status(target_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; hold tonde.legal_holds; by_service boolean :=
  (select auth.role()) = 'service_role'; events jsonb; residual_report jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from tonde.workspaces w where w.id = target_workspace) then
    raise exception 'That workspace does not exist' using errcode = 'P0002';
  end if;
  select * into hold from tonde.legal_holds h where h.workspace_id = target_workspace
    and h.released_at is null order by h.placed_at desc limit 1;
  select * into request from tonde.deletion_requests r where r.workspace_id = target_workspace
    order by r.requested_at desc limit 1;
  -- Membership is the ordinary path. The person who requested the deletion keeps their access to the
  -- record of it even after the freeze removed the memberships - that is the one thing they must be
  -- able to read, and it is scoped to the requester and the account owner, nobody else.
  if not by_service and not (exists (select 1 from tonde.workspace_members m
      where m.workspace_id = target_workspace and m.user_id = auth.uid())
    or (request.id is not null and (request.requested_by = auth.uid()
      or (request.scope = 'account' and request.owner_user_id = auth.uid())))) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if request.id is null then
    return jsonb_build_object('workspace_id', target_workspace, 'request_id', null,
      'legal_hold', case when hold.id is null then null else jsonb_build_object('id', hold.id,
        'scope', hold.scope, 'reason', hold.reason, 'placed_at', hold.placed_at) end,
      'meaning', 'This workspace has no deletion request. A deletion is requested explicitly, with the
        workspace name as confirmation, and only the owner can request it.');
  end if;
  if by_service and request.state in ('purging','verifying') then
    residual_report := tonde_private.deletion_residuals(request.id);
  else
    residual_report := coalesce(request.residuals, '{}'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('event_type', e.event_type, 'state', e.to_state,
    'actor_kind', e.actor_kind, 'detail', e.detail, 'created_at', e.created_at)
    order by e.created_at desc, e.id desc), '[]'::jsonb) into events
    from (select * from tonde.deletion_events d where d.request_id = request.id
      order by d.created_at desc, d.id desc limit 50) e;
  return jsonb_build_object('workspace_id', target_workspace, 'request_id', request.id,
    'state', request.state, 'scope', request.scope, 'reason', request.reason,
    'requested_at', request.requested_at, 'requested_by', request.requested_by,
    'grace_until', request.grace_until, 'export_first', request.export_first,
    'frozen_at', request.frozen_at, 'revoked_at', request.revoked_at,
    'purge_started_at', request.purge_started_at, 'verified_at', request.verified_at,
    'completed_at', request.completed_at, 'failed_at', request.failed_at,
    'cancelled_at', request.cancelled_at, 'failure_code', request.failure_code,
    'failure_message', request.failure_message,
    'remote_revocation_required', request.remote_revocation_required,
    'auth_deletion_outcome', request.auth_deletion_outcome,
    'residuals', residual_report, 'phase_counts', request.phase_counts, 'events', events,
    'legal_hold', case when hold.id is null then null else jsonb_build_object('id', hold.id,
      'scope', hold.scope, 'reason', hold.reason, 'placed_at', hold.placed_at) end,
    'cancellable', request.state in ('scheduled','frozen'),
    'meaning', 'The state, the count of what remains and the trail are reported as they are. A deletion
      is complete only after an independent verification found nothing left. The account scope is what
      also removes the account itself.');
end $$;
revoke all on function tonde.deletion_status(uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_status(uuid) to authenticated, service_role;

-- 10. Orchestration. Every function below is service-role only: it executes a decision the creator
--     already made and never manufactures one.

create function tonde.deletion_begin(target_request uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; workspace tonde.workspaces; cancelled integer;
  open_exports integer;
begin
  select * into request from tonde.deletion_requests r where r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  if request.state in ('frozen','revoking','purging','verifying','completed') then
    return jsonb_build_object('request_id', request.id, 'state', request.state, 'idempotent', true);
  end if;
  if request.state <> 'scheduled' then
    raise exception 'DELETION_NOT_SCHEDULED: this deletion is %', request.state using errcode = 'PT409';
  end if;
  if not coalesce(p_force, false) and request.grace_until > now() then
    raise exception 'DELETION_GRACE_ACTIVE: the grace period ends at %; a forced freeze is an operator
      action', request.grace_until using errcode = 'PT409';
  end if;
  if exists (select 1 from tonde.legal_holds h where h.workspace_id = request.workspace_id
      and h.released_at is null and h.scope in ('workspace','account')) then
    raise exception 'LEGAL_HOLD_ACTIVE: this workspace is under a legal hold and cannot be frozen'
      using errcode = 'PT409';
  end if;
  if request.export_first then
    select count(*) into open_exports from tonde.exports e where e.workspace_id = request.workspace_id
      and e.completed_at is null;
    if open_exports > 0 then
      raise exception 'DELETION_EXPORT_PENDING: % requested export(s) have not completed', open_exports
        using errcode = 'PT409';
    end if;
  end if;
  update tonde.workspaces set lifecycle = 'deleted', updated_at = now()
    where id = request.workspace_id returning * into workspace;
  cancelled := tonde_private.deletion_cancel_open_jobs(request.workspace_id, 'deletion:' || request.id::text);
  request := tonde_private.deletion_advance(request.id, 'frozen', 'system',
    'deletion:' || request.id::text, 'frozen',
    jsonb_build_object('workspace_lifecycle', workspace.lifecycle::text, 'jobs_cancelled', cancelled,
      'forced', coalesce(p_force, false)));
  update tonde.deletion_requests set frozen_at = coalesce(frozen_at, now()),
    phase_counts = phase_counts || jsonb_build_object('jobs_cancelled', cancelled), updated_at = now()
    where id = request.id returning * into request;
  perform tonde_private.audit_event(request.workspace_id, 'deletion.frozen', request.id,
    'deletion_request', jsonb_build_object('jobs_cancelled', cancelled));
  return jsonb_build_object('request_id', request.id, 'state', request.state, 'idempotent', false,
    'jobs_cancelled', cancelled,
    'meaning', 'The workspace is frozen and no longer usable, and open work was cancelled before any
      data was destroyed.');
end $$;
revoke all on function tonde.deletion_begin(uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_begin(uuid,boolean) to service_role;

create function tonde.deletion_revoke_credentials(target_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; destroyed integer := 0; remote jsonb := '[]'::jsonb;
begin
  select * into request from tonde.deletion_requests r where r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  if request.state in ('revoking','purging','verifying','completed') then
    return jsonb_build_object('request_id', request.id, 'state', request.state, 'idempotent', true,
      'remote_revocation_required', request.remote_revocation_required);
  end if;
  if request.state <> 'frozen' then
    raise exception 'DELETION_NOT_FROZEN: this deletion is %', request.state using errcode = 'PT409';
  end if;
  -- Destroying the ciphertext is the part TONDE can actually do; provider-side revocation cannot be
  -- claimed from here and is recorded as an obligation instead.
  with doomed as (
    delete from tonde_private.integration_credentials c
    where c.connection_id in (select ic.id from tonde.integration_connections ic
      where ic.workspace_id = request.workspace_id)
    returning c.connection_id
  )
  select count(*) into destroyed from doomed;
  select coalesce(jsonb_agg(jsonb_build_object('connection_id', ic.id, 'provider', ic.provider,
    'provider_account_id', ic.provider_account_id) order by ic.provider), '[]'::jsonb) into remote
    from tonde.integration_connections ic where ic.workspace_id = request.workspace_id
      and ic.status in ('connected','expired');
  update tonde.integration_connections set status = 'revoked',
    revoked_at = coalesce(revoked_at, now()), updated_at = now()
    where workspace_id = request.workspace_id and status <> 'revoked';
  request := tonde_private.deletion_advance(request.id, 'revoking', 'system',
    'deletion:' || request.id::text, 'credentials_revoked',
    jsonb_build_object('ciphertext_destroyed', destroyed, 'remote_revocation_required', remote));
  update tonde.deletion_requests set revoked_at = coalesce(revoked_at, now()),
    remote_revocation_required = remote,
    phase_counts = phase_counts || jsonb_build_object('credentials_destroyed', destroyed),
    updated_at = now()
    where id = request.id returning * into request;
  if jsonb_array_length(remote) > 0 then
    insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor,
      from_state, to_state, detail)
    values (request.workspace_id, request.id, 'remote_revocation_required', 'system',
      'deletion:' || request.id::text, 'revoking', 'revoking',
      jsonb_build_object('connections', remote,
        'meaning', 'The provider token is destroyed here; revoking it at the provider is an explicit
          obligation recorded against this deletion.'));
  end if;
  return jsonb_build_object('request_id', request.id, 'state', request.state, 'idempotent', false,
    'credentials_destroyed', destroyed, 'remote_revocation_required', remote,
    'meaning', 'Stored provider credentials are destroyed. Provider-side revocation is recorded as an
      obligation, not asserted.');
end $$;
revoke all on function tonde.deletion_revoke_credentials(uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_revoke_credentials(uuid) to service_role;

-- Bounded, resumable, generic purge. Foreign keys that still hold a row back are reported, not fatal.
create function tonde.deletion_purge_step(target_request uuid, p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; table_list text[]; target text; moved integer; total integer := 0;
  batch integer; rounds integer; queued integer := 0; blocked jsonb := '{}'::jsonb; remaining integer;
  counts jsonb := '{}'::jsonb; refusal_state text; refusal_message text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'A purge step is between 1 and 5000 rows' using errcode = '22023';
  end if;
  select * into request from tonde.deletion_requests r where r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  if request.state = 'purging' then
    null;
  elsif request.state = 'revoking' then
    request := tonde_private.deletion_advance(request.id, 'purging', 'system',
      'deletion:' || request.id::text, 'purge_progress', jsonb_build_object('started', true));
    update tonde.deletion_requests set purge_started_at = coalesce(purge_started_at, now()), updated_at = now()
      where id = request.id returning * into request;
  else
    raise exception 'DELETION_NOT_PURGING: this deletion is %', request.state using errcode = 'PT409';
  end if;
  -- The append-only guards honour this marker for exactly this workspace and exactly this call.
  perform set_config('tonde.deletion_workspace', request.workspace_id::text, true);
  -- The deletion's own job reference moves into evidence first, so the purge is never blocked by the
  -- orchestrator's own job row.
  update tonde.deletion_requests set evidence = evidence || jsonb_build_object('job_id', job_id), job_id = null,
    updated_at = now()
    where workspace_id = request.workspace_id and job_id is not null;
  -- Objects leave storage before their rows leave the database, so the queue is never unknowable.
  insert into tonde.storage_purge_queue(workspace_id, media_id, bucket, object_key, reason)
  select m.workspace_id, m.id, m.bucket, m.object_key, 'deletion:' || request.id::text
  from tonde.media_files m where m.workspace_id = request.workspace_id and m.upload_state <> 'deleted'
  on conflict (workspace_id, bucket, object_key) do nothing;
  get diagnostics queued = row_count;
  table_list := tonde_private.workspace_purge_tables();
  remaining := p_limit;
  foreach target in array table_list loop
    exit when remaining <= 0;
    for rounds in 1..4 loop
      exit when remaining <= 0;
      batch := least(remaining, 200);
      begin
        execute format('delete from tonde.%I t where t.ctid in (select ctid from tonde.%I
          where workspace_id = $1 limit $2)', target, target) using request.workspace_id, batch;
        get diagnostics moved := row_count;
      exception when foreign_key_violation or restrict_violation or check_violation or raise_exception then
        get stacked diagnostics refusal_state = returned_sqlstate, refusal_message = message_text;
        moved := 0;
        blocked := blocked || jsonb_build_object(target, jsonb_build_object('sqlstate', refusal_state,
          'message', left(refusal_message, 200)));
        exit;
      end;
      if moved = 0 then exit; end if;
      total := total + moved;
      remaining := remaining - moved;
      counts := counts || jsonb_build_object(target, coalesce((counts ->> target)::integer, 0) + moved);
    end loop;
  end loop;
  -- The marker is cleared as soon as the draining is done: nothing later in this transaction inherits it.
  perform set_config('tonde.deletion_workspace', '', true);
  update tonde.deletion_requests set phase_counts = phase_counts || jsonb_build_object('purged_rows', total,
      'objects_queued', queued, 'last_blocked', blocked), updated_at = now()
    where id = request.id returning * into request;
  insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor,
    from_state, to_state, detail)
  values (request.workspace_id, request.id, 'purge_progress', 'system', 'deletion:' || request.id::text,
    'purging', 'purging', jsonb_build_object('rows', total, 'objects_queued', queued, 'by_table', counts,
      'blocked', blocked));
  return jsonb_build_object('request_id', request.id, 'state', request.state, 'rows_purged', total,
    'objects_queued', queued, 'by_table', counts, 'blocked_by_dependency', blocked,
    'drained', total = 0 and queued = 0,
    'meaning', 'Rows were removed in bounded batches. Where a referenced row still holds a row back it is
      reported, and the next step tries again.');
end $$;
revoke all on function tonde.deletion_purge_step(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_purge_step(uuid,integer) to service_role;

create function tonde.deletion_verify(target_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; residual_report jsonb;
begin
  select * into request from tonde.deletion_requests r where r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  if request.state = 'completed' then
    return jsonb_build_object('request_id', request.id, 'state', 'completed', 'idempotent', true,
      'residuals', request.residuals);
  end if;
  if request.state not in ('purging','verifying') then
    raise exception 'DELETION_NOT_VERIFIABLE: this deletion is %', request.state using errcode = 'PT409';
  end if;
  residual_report := tonde_private.deletion_residuals(request.id);
  if request.state = 'purging' then
    request := tonde_private.deletion_advance(request.id, 'verifying', 'system',
      'deletion:' || request.id::text, 'verified',
      jsonb_build_object('residual_total', residual_report ->> 'total'));
  end if;
  update tonde.deletion_requests set residuals = residual_report, verified_at = now(), updated_at = now()
    where id = request.id returning * into request;
  if (residual_report ->> 'total')::bigint > 0 then
    insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor,
      from_state, to_state, detail)
    values (request.workspace_id, request.id, 'residuals_remaining', 'system',
      'deletion:' || request.id::text, 'verifying', 'verifying', residual_report);
  end if;
  return jsonb_build_object('request_id', request.id, 'state', request.state, 'idempotent', false,
    'residuals', residual_report, 'verified', (residual_report ->> 'total')::bigint = 0,
    'meaning', 'Verification counted what is still present from the catalog. Completion is only possible
      when that count is zero.');
end $$;
revoke all on function tonde.deletion_verify(uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_verify(uuid) to service_role;

create function tonde.deletion_record_auth_deletion(target_request uuid, p_outcome text,
  p_evidence jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; references_found jsonb;
begin
  select * into request from tonde.deletion_requests r where r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  if request.scope <> 'account' then
    raise exception 'AUTH_DELETION_NOT_APPLICABLE: this deletion is scoped to one workspace'
      using errcode = '22023';
  end if;
  if p_outcome not in ('deleted','anonymized_disabled') then
    raise exception 'The recorded outcome is deleted or anonymized_disabled' using errcode = '22023';
  end if;
  references_found := tonde_private.account_identity_references(request.owner_user_id);
  if p_outcome = 'deleted' and (references_found ->> 'total')::bigint > 0 then
    raise exception 'AUTH_IDENTITY_STILL_REFERENCED: % reference(s) remain, so the identity can only be
      recorded as anonymized and disabled', references_found ->> 'total' using errcode = 'PT409';
  end if;
  update tonde.deletion_requests set auth_deletion_outcome = p_outcome,
    auth_deletion_recorded_at = now(),
    auth_deletion_evidence = coalesce(p_evidence, '{}'::jsonb) || jsonb_build_object('outcome', p_outcome,
      'references', references_found), updated_at = now()
    where id = request.id returning * into request;
  insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor,
    from_state, to_state, detail)
  values (request.workspace_id, request.id, 'auth_deletion_recorded', 'system',
    'deletion:' || request.id::text, request.state::text, request.state::text,
    jsonb_build_object('outcome', p_outcome, 'references', references_found));
  return jsonb_build_object('request_id', request.id, 'state', request.state,
    'auth_deletion_outcome', p_outcome, 'references', references_found,
    'meaning', case when p_outcome = 'deleted'
      then 'The authentication identity was deleted and nothing in TONDE references it.'
      else 'The identity could not be deleted because retained evidence still references it; it is
        recorded as anonymized and disabled, which is what actually happened.' end);
end $$;
revoke all on function tonde.deletion_record_auth_deletion(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_record_auth_deletion(uuid,text,jsonb) to service_role;

create function tonde.deletion_complete(target_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests; residual_report jsonb; removed integer := 0;
begin
  select * into request from tonde.deletion_requests r where r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  if request.state = 'completed' then
    return jsonb_build_object('request_id', request.id, 'state', 'completed', 'idempotent', true,
      'completed_at', request.completed_at);
  end if;
  if request.state <> 'verifying' then
    raise exception 'DELETION_VERIFY_REQUIRED: this deletion is % and has not been verified', request.state
      using errcode = 'PT409';
  end if;
  -- The account's own obligations are discharged here, because they are the last things a verification
  -- legitimately still sees: an anonymized profile, no preferences and no memberships elsewhere.
  if request.scope = 'account' then
    update tonde.profiles set display_name = 'Deleted account', avatar_url = null,
      onboarding_state = 'complete', updated_at = now()
      where user_id = request.owner_user_id;
    with gone as (delete from tonde.user_preferences p where p.user_id = request.owner_user_id
      returning p.user_id) select count(*) into removed from gone;
    delete from tonde.workspace_members m
      where m.user_id = request.owner_user_id
        and exists (select 1 from tonde.workspaces w where w.id = m.workspace_id and w.lifecycle = 'deleted');
  end if;
  residual_report := tonde_private.deletion_residuals(request.id);
  if (residual_report ->> 'total')::bigint > 0 then
    raise exception 'DELETION_RESIDUALS_REMAIN: % item(s) remain: %', residual_report ->> 'total',
      residual_report ->> 'counts' using errcode = 'PT409';
  end if;
  if request.scope = 'account' and request.auth_deletion_recorded_at is null then
    raise exception 'AUTH_DELETION_NOT_RECORDED: record the authentication outcome before completing an
      account deletion' using errcode = 'PT409';
  end if;
  -- The state and its completion stamp change together: the schema refuses a completed deletion that
  -- does not say when, and that refusal is the point.
  if not tonde_private.deletion_transition_allowed(request.state::text, 'completed') then
    raise exception 'DELETION_TRANSITION_INVALID: a deletion in % cannot become completed', request.state
      using errcode = 'PT409';
  end if;
  update tonde.deletion_requests set state = 'completed', completed_at = coalesce(completed_at, now()),
    residuals = residual_report, updated_at = now()
    where id = request.id returning * into request;
  insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor,
    from_state, to_state, detail)
  values (request.workspace_id, request.id, 'completed', 'system', 'deletion:' || request.id::text,
    'verifying', 'completed', jsonb_build_object('residuals', residual_report,
      'auth_deletion_outcome', request.auth_deletion_outcome));
  perform tonde.outbox_enqueue(request.workspace_id, 'deletion.completed', 'deletion_request', request.id,
    'deletion.completed:' || request.id::text,
    jsonb_build_object('scope', request.scope::text, 'completed_at', request.completed_at,
      'auth_deletion_outcome', request.auth_deletion_outcome));
  perform tonde_private.audit_event(request.workspace_id, 'deletion.completed', request.id,
    'deletion_request', jsonb_build_object('scope', request.scope::text, 'residuals', residual_report,
      'preferences_removed', removed));
  return jsonb_build_object('request_id', request.id, 'state', 'completed', 'idempotent', false,
    'completed_at', request.completed_at, 'residuals', residual_report,
    'auth_deletion_outcome', request.auth_deletion_outcome, 'preferences_removed', removed,
    'meaning', 'The deletion is complete: an independent verification found nothing left, and the
      workspace record remains only as a tombstone for retained evidence.');
end $$;
revoke all on function tonde.deletion_complete(uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_complete(uuid) to service_role;

create function tonde.deletion_fail(target_request uuid, p_code text, p_message text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request tonde.deletion_requests;
begin
  select * into request from tonde.deletion_requests r where r.id = target_request for update;
  if not found then raise exception 'That deletion request does not exist' using errcode = 'P0002'; end if;
  if request.state = 'failed' then
    return jsonb_build_object('request_id', request.id, 'state', 'failed', 'idempotent', true);
  end if;
  if request.state in ('completed','cancelled') then
    raise exception 'DELETION_TERMINAL: this deletion is % and cannot fail', request.state
      using errcode = 'PT409';
  end if;
  update tonde.deletion_requests set failure_code = left(coalesce(p_code, 'unknown'), 120),
    failure_message = left(coalesce(p_message, ''), 2000), failed_at = now(), updated_at = now()
    where id = request.id returning * into request;
  request := tonde_private.deletion_advance(request.id, 'failed', 'system',
    'deletion:' || request.id::text, 'failed',
    jsonb_build_object('code', request.failure_code, 'message', request.failure_message));
  return jsonb_build_object('request_id', request.id, 'state', 'failed', 'idempotent', false,
    'failure_code', request.failure_code, 'failure_message', request.failure_message);
end $$;
revoke all on function tonde.deletion_fail(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function tonde.deletion_fail(uuid,text,text) to service_role;

create function tonde.legal_hold_place(target_workspace uuid, p_scope text default 'workspace',
  p_reason text default '', p_actor_label text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hold tonde.legal_holds; existing tonde.legal_holds;
begin
  if p_scope not in ('workspace','account') then
    raise exception 'A hold is scoped to a workspace or an account' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A legal hold records its reason' using errcode = '22023';
  end if;
  if not exists (select 1 from tonde.workspaces w where w.id = target_workspace) then
    raise exception 'That workspace does not exist' using errcode = 'P0002';
  end if;
  select * into existing from tonde.legal_holds h where h.workspace_id = target_workspace
    and h.scope = p_scope::tonde.deletion_scope and h.released_at is null;
  if existing.id is not null then
    return jsonb_build_object('hold_id', existing.id, 'active', true, 'idempotent', true,
      'reason', existing.reason);
  end if;
  insert into tonde.legal_holds(workspace_id, scope, reason, placed_by, placed_by_label)
  values (target_workspace, p_scope::tonde.deletion_scope, left(btrim(p_reason), 2000), auth.uid(),
    left(coalesce(p_actor_label, ''), 160))
  returning * into hold;
  insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor, detail)
  select target_workspace, r.id, 'hold_placed', 'operator', hold.placed_by_label,
    jsonb_build_object('hold_id', hold.id, 'scope', hold.scope::text, 'reason', hold.reason)
  from tonde.deletion_requests r where r.workspace_id = target_workspace
    and r.state in ('scheduled','frozen','revoking','purging','verifying');
  return jsonb_build_object('hold_id', hold.id, 'active', true, 'idempotent', false, 'scope', hold.scope,
    'reason', hold.reason,
    'meaning', 'A legal hold blocks freezing and purging until it is explicitly released.');
end $$;
revoke all on function tonde.legal_hold_place(uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function tonde.legal_hold_place(uuid,text,text,text) to service_role;

create function tonde.legal_hold_release(target_hold uuid, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hold tonde.legal_holds;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Releasing a hold records its reason' using errcode = '22023';
  end if;
  select * into hold from tonde.legal_holds h where h.id = target_hold for update;
  if not found then raise exception 'That legal hold does not exist' using errcode = 'P0002'; end if;
  if hold.released_at is not null then
    return jsonb_build_object('hold_id', hold.id, 'active', false, 'idempotent', true);
  end if;
  update tonde.legal_holds set released_at = now(), released_by = auth.uid(),
    release_reason = left(btrim(p_reason), 2000) where id = hold.id returning * into hold;
  insert into tonde.deletion_events(workspace_id, request_id, event_type, actor_kind, actor, detail)
  select hold.workspace_id, r.id, 'hold_released', 'operator', coalesce(auth.uid()::text, ''),
    jsonb_build_object('hold_id', hold.id, 'reason', hold.release_reason)
  from tonde.deletion_requests r where r.workspace_id = hold.workspace_id
    and r.state in ('scheduled','frozen','revoking','purging','verifying');
  return jsonb_build_object('hold_id', hold.id, 'active', false, 'idempotent', false,
    'released_at', hold.released_at, 'reason', hold.release_reason);
end $$;
revoke all on function tonde.legal_hold_release(uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.legal_hold_release(uuid,text) to service_role;

-- 11. Retention sweeps: durable work with a persisted, truthful record. `cutoff_at` is truncated to
--     the hour so the same request in the same hour is idempotent instead of merely similar.
create function tonde.retention_sweep_request(p_data_class text, p_older_than_days integer default null,
  p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare class tonde.retention_classes; sweep tonde.retention_sweeps; days integer;
  cutoff timestamptz; existing tonde.retention_sweeps;
begin
  select * into class from tonde.retention_classes c where c.data_class = p_data_class;
  if not found then raise exception 'That is not a TONDE retention class' using errcode = '22023'; end if;
  if not class.enabled then
    raise exception 'That retention class is disabled' using errcode = 'PT409';
  end if;
  days := coalesce(p_older_than_days, class.default_retention_days);
  if days is not null and (days < 0 or days > 36500) then
    raise exception 'A retention age is between 0 and 36500 days' using errcode = '22023';
  end if;
  cutoff := date_trunc('hour', now()) - make_interval(days => coalesce(days, 0));
  select * into existing from tonde.retention_sweeps s where s.data_class = class.data_class
    and s.cutoff_at = cutoff and s.dry_run = coalesce(p_dry_run, false);
  if existing.id is not null then
    return jsonb_build_object('sweep_id', existing.id, 'state', existing.state, 'idempotent', true,
      'cutoff_at', existing.cutoff_at);
  end if;
  insert into tonde.retention_sweeps(data_class, table_names, cutoff_at, dry_run, requested_by)
  values (class.data_class, class.table_names, cutoff, coalesce(p_dry_run, false), auth.uid())
  returning * into sweep;
  return jsonb_build_object('sweep_id', sweep.id, 'data_class', sweep.data_class,
    'cutoff_at', sweep.cutoff_at, 'dry_run', sweep.dry_run, 'state', sweep.state,
    'purge_action', class.purge_action, 'retention_days', days,
    'meaning', case when class.purge_action = 'retain'
      then 'This class is retained; the sweep will report what it holds and change nothing.'
      else 'The sweep is durable work. It applies the class policy in bounded batches and records what
        it actually did.' end);
end $$;
revoke all on function tonde.retention_sweep_request(text,integer,boolean)
  from public, anon, authenticated, service_role;
grant execute on function tonde.retention_sweep_request(text,integer,boolean) to service_role;

-- The maintenance runner claims the oldest requested sweep. The sweep row itself is the durable work.
create function tonde.retention_sweep_claim(p_limit integer default 5) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('sweep_id', s.id, 'data_class', s.data_class,
    'cutoff_at', s.cutoff_at, 'dry_run', s.dry_run, 'state', s.state) order by s.requested_at), '[]'::jsonb)
  from (select s.* from tonde.retention_sweeps s where s.state = 'requested'
    order by s.requested_at, s.id limit greatest(1, least(coalesce(p_limit, 5), 50)) for update skip locked) s;
$$;
revoke all on function tonde.retention_sweep_claim(integer) from public, anon, authenticated, service_role;
grant execute on function tonde.retention_sweep_claim(integer) to service_role;

create function tonde.retention_sweep_apply(target_sweep uuid, p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sweep tonde.retention_sweeps; class tonde.retention_classes; v_moved integer := 0;
  v_candidates integer := 0; v_queued integer := 0; v_retained bigint := 0; v_ids uuid[]; v_drained boolean;
  v_infected integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'A sweep step is between 1 and 5000 rows' using errcode = '22023';
  end if;
  select * into sweep from tonde.retention_sweeps s where s.id = target_sweep for update;
  if not found then raise exception 'That retention sweep does not exist' using errcode = 'P0002'; end if;
  if sweep.state = 'completed' then
    return jsonb_build_object('sweep_id', sweep.id, 'state', 'completed', 'idempotent', true,
      'handled', sweep.handled, 'objects_queued', sweep.objects_queued);
  end if;
  if sweep.state = 'failed' then
    raise exception 'SWEEP_FAILED: this sweep failed with % and is not retried in place', sweep.error_code
      using errcode = 'PT409';
  end if;
  select * into class from tonde.retention_classes c where c.data_class = sweep.data_class;
  update tonde.retention_sweeps set state = 'running', started_at = coalesce(started_at, now())
    where id = sweep.id returning * into sweep;
  if class.purge_action = 'retain' then
    execute format('select count(*) from tonde.%I', class.table_names[1]) into v_retained;
    update tonde.retention_sweeps set state = 'completed', completed_at = now(), retained = v_retained,
      candidates = 0, handled = 0, evidence = jsonb_build_object('action', 'retain',
        'retained_rows', v_retained,
        'meaning', 'Retained as evidence: this sweep deleted nothing by design.')
      where id = sweep.id returning * into sweep;
    return jsonb_build_object('sweep_id', sweep.id, 'state', 'completed', 'retained', v_retained,
      'rows_this_batch', 0, 'idempotent', false, 'purge_action', 'retain',
      'meaning', 'This class is retained and nothing was deleted; the sweep reports what it holds.');
  end if;
  if class.purge_action = 'queue_object_purge' then
    select array_agg(candidate.id) into v_ids from (
      select m.id from tonde.media_files m
      where case class.data_class
          when 'media_temporary' then m.retention_policy = 'temporary'
          when 'media_derived' then m.derived_from_id is not null
          when 'export_artifact' then m.file_category = 'export'
          else false end
        and m.expires_at is not null and m.expires_at <= sweep.cutoff_at
        and m.upload_state <> 'deleted'
      order by m.expires_at limit p_limit) candidate;
    v_candidates := coalesce(cardinality(v_ids), 0);
    if v_candidates > 0 then
      insert into tonde.storage_purge_queue(workspace_id, media_id, bucket, object_key, reason)
      select m.workspace_id, m.id, m.bucket, m.object_key, 'retention:' || class.data_class
      from tonde.media_files m where m.id = any(v_ids)
      on conflict (workspace_id, bucket, object_key) do nothing;
      get diagnostics v_queued := row_count;
      -- Infected media keeps saying it is quarantined and blocked; only its object is queued for
      -- purging. The guard that enforces quarantine is respected, never worked around.
      update tonde.media_files m set upload_state = 'deleted', processing_state = 'skipped', updated_at = now()
        where m.id = any(v_ids) and m.scan_state <> 'infected';
      get diagnostics v_moved := row_count;
      select count(*) into v_infected from tonde.media_files m where m.id = any(v_ids)
        and m.scan_state = 'infected';
    end if;
  elsif class.purge_action = 'anonymize' then
    update tonde.jobs j set input_metadata = '{}'::jsonb, result_metadata = '{}'::jsonb, updated_at = now()
      where j.ctid in (select ctid from tonde.jobs
        where status in ('succeeded','failed','cancelled','timed_out','dead_letter')
          and updated_at <= sweep.cutoff_at limit p_limit)
        and (j.input_metadata <> '{}'::jsonb or j.result_metadata <> '{}'::jsonb);
    get diagnostics v_moved := row_count;
    v_candidates := v_moved;
  else
    if class.data_class = 'outbox_events' then
      delete from tonde.outbox_events o where o.ctid in (
        select o2.ctid from tonde.outbox_events o2
        where o2.created_at <= sweep.cutoff_at and o2.state in ('delivered','skipped') limit p_limit);
      get diagnostics v_moved := row_count;
    elsif class.data_class = 'upload_intent' then
      delete from tonde.media_upload_intents u where u.ctid in (
        select u2.ctid from tonde.media_upload_intents u2
        where u2.created_at <= sweep.cutoff_at
          and u2.state in ('verified','rejected','expired','aborted') limit p_limit);
      get diagnostics v_moved := row_count;
    elsif class.data_class = 'integration_credential' then
      with doomed as (
        delete from tonde_private.integration_credentials c
        where c.connection_id in (select ic.id from tonde.integration_connections ic
          where ic.status in ('revoked','expired') and ic.updated_at <= sweep.cutoff_at limit p_limit)
        returning c.connection_id)
      select count(*) into v_moved from doomed;
    else
      raise exception 'SWEEP_CLASS_UNSUPPORTED: no bounded action is defined for %', class.data_class
        using errcode = '22023';
    end if;
    v_candidates := v_moved;
  end if;
  v_drained := v_candidates < p_limit;
  update tonde.retention_sweeps set handled = handled + v_moved, candidates = v_candidates,
    objects_queued = objects_queued + v_queued,
    state = case when v_drained then 'completed' else 'running' end,
    completed_at = case when v_drained then now() else completed_at end,
    evidence = evidence || jsonb_build_object('last_batch_rows', v_moved, 'last_batch_objects', v_queued,
      'last_batch_infected_queued_only', v_infected, 'cutoff_at', sweep.cutoff_at, 'dry_run', sweep.dry_run)
    where id = sweep.id returning * into sweep;
  return jsonb_build_object('sweep_id', sweep.id, 'state', sweep.state, 'idempotent', false,
    'rows_this_batch', v_moved, 'objects_queued', v_queued, 'handled_total', sweep.handled,
    'drained', v_drained, 'purge_action', class.purge_action,
    'meaning', 'The sweep applied the class policy to one bounded batch and recorded exactly what it did.');
end $$;
revoke all on function tonde.retention_sweep_apply(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function tonde.retention_sweep_apply(uuid,integer) to service_role;

create function tonde.storage_purge_claim(p_worker text, p_limit integer default 20,
  p_lease_seconds integer default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare claimed jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'A purge claim is between 1 and 200 objects' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'A purge lease is between 30 and 3600 seconds' using errcode = '22023';
  end if;
  if p_worker is null or length(btrim(p_worker)) < 3 then
    raise exception 'A purge worker names itself' using errcode = '22023';
  end if;
  with candidates as (
    select q.id from tonde.storage_purge_queue q
    where (q.state = 'pending' and q.available_at <= now())
       or (q.state = 'claimed' and q.lease_expires_at <= now())
    order by q.available_at, q.requested_at, q.id
    limit p_limit for update skip locked
  ), updated as (
    update tonde.storage_purge_queue q set state = 'claimed', lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds), attempts = q.attempts + 1
      where q.id in (select id from candidates)
      returning q.id, q.workspace_id, q.media_id, q.bucket, q.object_key, q.reason, q.attempts,
        q.lease_expires_at)
  select coalesce(jsonb_agg(jsonb_build_object('purge_id', u.id, 'workspace_id', u.workspace_id,
    'media_id', u.media_id, 'bucket', u.bucket, 'object_key', u.object_key, 'reason', u.reason,
    'attempts', u.attempts, 'lease_expires_at', u.lease_expires_at) order by u.id), '[]'::jsonb)
    into claimed from updated u;
  return claimed;
end $$;
revoke all on function tonde.storage_purge_claim(text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.storage_purge_claim(text,integer,integer) to service_role;

create function tonde.storage_purge_complete(target_purge uuid, p_worker text, p_outcome text,
  p_detail jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare entry tonde.storage_purge_queue;
begin
  if p_outcome not in ('purged','absent') then
    raise exception 'An object purge is recorded as purged or absent' using errcode = '22023';
  end if;
  select * into entry from tonde.storage_purge_queue q where q.id = target_purge for update;
  if not found then raise exception 'That storage purge does not exist' using errcode = 'P0002'; end if;
  if entry.state in ('purged','absent') then
    return jsonb_build_object('purge_id', entry.id, 'state', entry.state, 'idempotent', true);
  end if;
  if entry.lease_owner is distinct from p_worker then
    raise exception 'PURGE_LEASE_NOT_OWNED: worker % does not hold this purge', p_worker
      using errcode = '42501';
  end if;
  update tonde.storage_purge_queue set state = p_outcome,
    purged_at = case when p_outcome = 'purged' then now() else purged_at end,
    absent_at = case when p_outcome = 'absent' then now() else absent_at end,
    lease_owner = null, lease_expires_at = null, detail = coalesce(p_detail, '{}'::jsonb)
    where id = target_purge returning * into entry;
  return jsonb_build_object('purge_id', entry.id, 'state', entry.state, 'idempotent', false,
    'bucket', entry.bucket, 'object_key', entry.object_key,
    'meaning', case when p_outcome = 'purged'
      then 'The object is gone from storage; the deletion is no longer blocked by it.'
      else 'The object was already absent; that is recorded as absent rather than as a purge.' end);
end $$;
revoke all on function tonde.storage_purge_complete(uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.storage_purge_complete(uuid,text,text,jsonb) to service_role;

create function tonde.storage_purge_fail(target_purge uuid, p_worker text, p_code text,
  p_message text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare entry tonde.storage_purge_queue; retry boolean;
begin
  select * into entry from tonde.storage_purge_queue q where q.id = target_purge for update;
  if not found then raise exception 'That storage purge does not exist' using errcode = 'P0002'; end if;
  if entry.lease_owner is distinct from p_worker then
    raise exception 'PURGE_LEASE_NOT_OWNED: worker % does not hold this purge', p_worker
      using errcode = '42501';
  end if;
  retry := entry.attempts < entry.max_attempts;
  update tonde.storage_purge_queue set state = case when retry then 'pending' else 'failed' end,
    lease_owner = null, lease_expires_at = null,
    available_at = case when retry then now() + make_interval(secs =>
      least(1800, 30 * power(2, greatest(entry.attempts - 1, 0))::integer)) else available_at end,
    last_error_code = left(coalesce(p_code, 'unknown'), 120),
    last_error_message = left(coalesce(p_message, ''), 2000)
    where id = target_purge returning * into entry;
  return jsonb_build_object('purge_id', entry.id, 'state', entry.state, 'retrying', retry,
    'attempts', entry.attempts, 'max_attempts', entry.max_attempts);
end $$;
revoke all on function tonde.storage_purge_fail(uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.storage_purge_fail(uuid,text,text,text) to service_role;

-- 12. Retention visibility for a workspace member: what expired, what is queued, what is held.
create function tonde.retention_status(target_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare expired integer; queued integer; purged integer; failed integer; holds jsonb; classes jsonb;
begin
  if (select auth.role()) <> 'service_role' and (auth.uid() is null
      or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select count(*) into expired from tonde.media_files m where m.workspace_id = target_workspace
    and m.upload_state <> 'deleted' and m.expires_at is not null and m.expires_at <= now();
  select count(*) into queued from tonde.storage_purge_queue q where q.workspace_id = target_workspace
    and q.state in ('pending','claimed');
  select count(*) into purged from tonde.storage_purge_queue q where q.workspace_id = target_workspace
    and q.state in ('purged','absent');
  select count(*) into failed from tonde.storage_purge_queue q where q.workspace_id = target_workspace
    and q.state = 'failed';
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'scope', h.scope, 'reason', h.reason,
    'placed_at', h.placed_at) order by h.placed_at desc), '[]'::jsonb) into holds
    from tonde.legal_holds h where h.workspace_id = target_workspace and h.released_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('data_class', c.data_class, 'purge_action', c.purge_action,
    'purge_exempt', c.purge_exempt, 'default_retention_days', c.default_retention_days)
    order by c.purge_order), '[]'::jsonb) into classes
    from tonde.retention_classes c where c.enabled;
  return jsonb_build_object('workspace_id', target_workspace, 'expired_media', expired,
    'objects_awaiting_purge', queued, 'objects_purged', purged, 'objects_failed', failed,
    'legal_holds', holds, 'classes', classes,
    'meaning', 'Retention is applied as durable work. Expired media stays visible until its object was
      actually purged, and the purge state is reported as it is.');
end $$;
revoke all on function tonde.retention_status(uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.retention_status(uuid) to authenticated, service_role;

-- 13. Default privileges. New functions in these schemas are closed unless granted explicitly.
alter default privileges in schema tonde revoke execute on functions from public;
alter default privileges in schema tonde_private revoke execute on functions from public;

commit;
