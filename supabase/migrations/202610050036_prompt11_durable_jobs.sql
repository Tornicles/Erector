-- Prompt 11 packet 036 — the durable job platform.
--
-- Prompts 1–10 already created the persistence foundation this extends and never replaces:
-- `tonde.jobs` from migration 001 (`job_state`, `progress`, `attempts`/`max_attempts`,
-- `available_at`, `lease_owner`/`lease_expires_at`, `input_object_id`/`output_object_id`,
-- `input_metadata`, `requested_by`), the six lease/completion checks added by 005, the widened
-- `jobs_job_type_check` from 018, and the export job written inside the export transaction by 033.
-- This file adds capability to that one canonical job surface. It does not add a second job table.
--
-- Laws enforced here, not merely described:
--   * One job row is one durable request. Enqueue is idempotent by
--     (workspace, job_type, idempotency_key); the same key returns the existing job.
--   * A domain change that requires asynchronous work records the work in the SAME transaction:
--     directly (export_request already does this) and, for event-driven flows, through the outbox,
--     whose emission is a trigger on the domain row. State and work request cannot diverge.
--   * Claiming is atomic: one statement with FOR UPDATE SKIP LOCKED. Two workers cannot own one job,
--     and an unexpired lease cannot be taken away.
--   * Only the lease owner may start, heartbeat, complete, fail or release a job. Heartbeat fails
--     when the lease expired, the job was cancelled, or another worker now owns it.
--   * Retry is classification-aware. The effective classification is the more conservative of the
--     job type's declared policy and the one the worker reports; it is never silently relaxed.
--   * Completion is idempotent: a duplicate completion of a finished job changes nothing and says so.
--     Retry-exhausted and non-retryable work lands in DEAD_LETTER with its error, attempts, timestamps
--     and reconciliation status preserved.
--   * Job state moves only through the validated transition matrix
--     (tonde_private.job_transition_allowed); every state write in this file asserts it.
--   * Claiming is server authority only. A worker executes previously authorized operations and can
--     never manufacture a creator decision; a client session can read its workspace state and request
--     cancellation, nothing more.
--
-- Transactions are split deliberately: PostgreSQL cannot *use* an enum label in the same transaction
-- that adds it, so the new labels commit first and everything that compares against them runs
-- afterwards. This is also what keeps the single-file artifact (which re-emits statements with
-- existence guards) valid on a fresh database.
begin;
alter type tonde.job_state add value 'leased';
alter type tonde.job_state add value 'waiting';
alter type tonde.job_state add value 'cancel_requested';
alter type tonde.job_state add value 'timed_out';
alter type tonde.job_state add value 'dead_letter';
commit;

begin;

-- 1. Job type definitions. The capability map: which worker class understands a job type, how much
--    priority it may ever hold, how long it may run, how a failure may be treated, and whether the
--    work is externally consequential (which is what makes reconciliation mandatory). A job type that
--    is not defined here cannot be enqueued and cannot be claimed.
create table tonde.job_type_definitions (
  job_type text primary key check (length(job_type) between 1 and 60),
  worker_class text not null check (worker_class in ('media','ai','export','publishing',
    'reconciliation','notification','maintenance','knowledge')),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  description text not null default '' check (length(description) <= 600),
  default_priority integer not null default 50 check (default_priority between 0 and 100),
  max_priority integer not null default 50 check (max_priority between 0 and 100),
  default_max_attempts integer not null default 3 check (default_max_attempts between 1 and 10),
  -- The per-attempt bound. A claimed attempt that runs past it is a worker timeout, not a job-wide
  -- deadline: the two clocks are distinct.
  timeout_seconds integer not null default 900 check (timeout_seconds between 30 and 86400),
  -- The end-to-end retry window. A job that has not finished inside it stops instead of retrying for
  -- ever. This is the `deadline_at` every enqueued job receives.
  max_window_seconds integer not null default 3600 check (max_window_seconds between 60 and 604800),
  -- The most optimistic treatment a *reported* failure of this type may ever receive. A worker may be
  -- more conservative, never less. `requires_idempotency_key` means a retry is only acceptable because
  -- the job carries a stable operation identity (operation_id) that the adapter sends to the provider.
  retry_policy text not null default 'safe_to_retry'
    check (retry_policy in ('safe_to_retry','requires_idempotency_key','requires_reconciliation','must_not_retry')),
  -- The separate, stricter law for an *uncertain* outcome: a lost lease, or a deadline that passed
  -- while the work was in flight. Unless this is false, that work is reconciled before it is repeated.
  requires_reconciliation boolean not null default false,
  externally_consequential boolean not null default false,
  cancellable boolean not null default true,
  idempotent_completion boolean not null default true,
  payload_version integer not null default 1 check (payload_version >= 1),
  enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint job_type_priority_ceiling check (max_priority >= default_priority),
  -- Externally consequential work is always reconciled before it is repeated.
  constraint job_type_external_requires_reconciliation
    check (not externally_consequential or requires_reconciliation)
);
alter table tonde.job_type_definitions enable row level security;
create policy job_type_read on tonde.job_type_definitions for select to authenticated using (true);
grant select on tonde.job_type_definitions to authenticated;
grant all on tonde.job_type_definitions to service_role;

-- Seeded definitions. `on conflict ... do update` keeps a definition refreshable by a later migration
-- without rewriting one, and makes the artifact re-runnable.
insert into tonde.job_type_definitions(job_type, worker_class, display_name, description,
  default_priority, max_priority, default_max_attempts, timeout_seconds, retry_policy,
  requires_reconciliation, externally_consequential, cancellable, idempotent_completion)
values
  ('media_preprocessing','media','Media preprocessing',
   'Validate, verify and normalize an uploaded media object before it can be used.',50,60,3,900,
   'safe_to_retry',false,false,true,true),
  ('media_scan','media','Media safety scan',
   'Run the configured content scanner over a stored object, and record honestly when no scanner exists.',55,60,3,600,
   'safe_to_retry',false,false,true,true),
  ('media_derivation','media','Media derivation',
   'Produce a derived asset (proxy, thumbnail, waveform) from an immutable source.',40,50,3,1800,
   'safe_to_retry',false,false,true,true),
  ('proxy','media','Proxy generation',
   'Generate a lower-bandwidth viewing proxy for a source video.',30,40,3,3600,
   'safe_to_retry',false,false,true,true),
  ('thumbnail','media','Thumbnail generation',
   'Generate a poster frame or image thumbnail.',35,40,3,900,
   'safe_to_retry',false,false,true,true),
  ('transcription','ai','Transcription',
   'Transcribe speech into timed text.',45,50,3,1800,
   'safe_to_retry',false,false,true,true),
  ('reference_analysis','ai','Reference analysis',
   'Analyze a reference the creator supplied.',45,50,3,1800,
   'safe_to_retry',false,false,true,true),
  ('story_generation','ai','Story generation',
   'Draft story and script material from the brief and the references. This is TONDE''s own direction
   work: the model is the intelligence API, and no media is produced.',45,50,2,1800,
   'requires_idempotency_key',true,true,false,true),
  ('production_generation','ai','Production generation',
   'Draft production material - the plan, Shot list and playbook - from the brief, the references and
   the Production Kit. Direction work, not media generation.',45,50,2,1800,
   'requires_idempotency_key',true,true,false,true),
  ('prompt_compilation','ai','Prompt compilation',
   'Compile a Shot plan and the documented knowledge of the chosen tool into the playbook prompt the
   creator runs in their own external tool.',50,60,3,600,
   'safe_to_retry',false,false,true,true),
  ('shot_match','ai','Shot match analysis',
   'Compare a captured Result against the plan and propose corrections.',45,50,3,900,
   'safe_to_retry',false,false,true,true),
  ('export','export','Export build',
   'Build the exact pinned Production version into a file and upload it.',50,60,3,1800,
   'safe_to_retry',false,false,true,true),
  ('cloud_import','media','Cloud import',
   'Fetch and ingest media from an external source.',45,55,3,3600,
   'requires_reconciliation',true,true,true,true),
  ('long_form_generation','ai','Long-form generation',
   'Plan a Series horizon of material - arcs, episodes and planned Shots - for later execution.',40,50,2,3600,
   'requires_idempotency_key',true,true,true,true),
  ('publication_submission','publishing','Publication submission',
   'Submit an authorized publication to its destination through an adapter.',60,70,3,600,
   'requires_reconciliation',true,true,true,true),
  ('provider_reconciliation','reconciliation','Provider reconciliation',
   'Establish the real state of an uncertain external operation.',55,65,5,600,
   'safe_to_retry',true,true,false,true),
  ('notification_delivery','notification','Notification delivery',
   'Deliver one notification identified by its stable notification identity.',40,50,3,300,
   'requires_idempotency_key',true,true,true,true),
  ('retention_sweep','maintenance','Retention sweep',
   'Apply the configured retention policy to one data class.',20,30,3,3600,
   'safe_to_retry',false,false,true,true),
  ('deletion_orchestration','maintenance','Deletion orchestration',
   'Advance an account or workspace deletion through its phases.',65,70,5,3600,
   'requires_reconciliation',true,true,false,true),
  ('knowledge_ingestion','knowledge','Knowledge ingestion',
   'Normalize and validate an ingested knowledge package into the library.',40,50,3,1800,
   'safe_to_retry',false,false,true,true)
on conflict (job_type) do update set worker_class = excluded.worker_class,
  display_name = excluded.display_name, description = excluded.description,
  default_priority = excluded.default_priority, max_priority = excluded.max_priority,
  default_max_attempts = excluded.default_max_attempts, timeout_seconds = excluded.timeout_seconds,
  retry_policy = excluded.retry_policy, requires_reconciliation = excluded.requires_reconciliation,
  externally_consequential = excluded.externally_consequential, cancellable = excluded.cancellable,
  idempotent_completion = excluded.idempotent_completion, payload_version = excluded.payload_version,
  updated_at = now();

-- Windows wider than an hour for the job types that genuinely run long; the one-hour default covers
-- the rest. Stated here rather than buried in the insert so the intent is readable.
update tonde.job_type_definitions set max_window_seconds = 10800
  where job_type in ('export','proxy','cloud_import','retention_sweep','long_form_generation');
update tonde.job_type_definitions set max_window_seconds = 21600
  where job_type in ('media_derivation','media_preprocessing');
update tonde.job_type_definitions set max_window_seconds = 86400
  where job_type in ('deletion_orchestration');
update tonde.job_type_definitions set max_window_seconds = 1800
  where job_type in ('publication_submission','notification_delivery','provider_reconciliation',
    'prompt_compilation','shot_match','transcription','reference_analysis','media_scan','thumbnail');
update tonde.job_type_definitions set max_window_seconds = 7200
  where job_type in ('story_generation','production_generation','knowledge_ingestion');
update tonde.job_type_definitions set updated_at = now() where max_window_seconds <> 3600;

-- 2. Worker registry. Worker identity is server authority: a worker row exists only because the
--    trusted server registered it, and it is never a human decision. Workers are global
--    infrastructure, so this table carries no client grant and no tenant policy.
create table tonde.workers (
  worker_id text primary key check (length(worker_id) between 1 and 120),
  worker_class text not null check (worker_class in ('media','ai','export','publishing',
    'reconciliation','notification','maintenance','knowledge')),
  instance text not null default '' check (length(instance) <= 200),
  version text not null default '' check (length(version) <= 60),
  status text not null default 'online' check (status in ('online','draining','offline')),
  capabilities text[] not null default '{}',
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  last_claimed_at timestamptz,
  shutdown_requested_at timestamptz,
  shutdown_completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table tonde.workers enable row level security;
grant all on tonde.workers to service_role;

-- 3. Job events. An append-only operational history: every state move, lease change, retry decision,
--    reconciliation and cancellation is recorded with who/what caused it. Tenant-readable, never
--    writable by a client.
create table tonde.job_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  job_id uuid not null,
  event_type text not null check (event_type in ('enqueued','leased','started','heartbeat',
    'completed','failed','retry_scheduled','reconciliation_required','reconciled','cancelled',
    'cancel_requested','cancel_acknowledged','cancel_not_possible_remote','lease_expired',
    'released','dead_lettered','requeued','timed_out')),
  actor_kind text not null check (actor_kind in ('worker','user','server','system')),
  actor text not null default '' check (length(actor) <= 120),
  from_status text, to_status text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, job_id) references tonde.jobs(workspace_id, id) on delete restrict
);
create index job_events_by_job on tonde.job_events(workspace_id, job_id, created_at desc, id);
create index job_events_by_type on tonde.job_events(event_type, created_at desc);
create function tonde_private.guard_job_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Job events are an append-only record and cannot be changed' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_job_event before update or delete on tonde.job_events
  for each row execute function tonde_private.guard_job_event();
create trigger guard_mutation before update on tonde.job_events
  for each row execute function tonde_private.guard_mutation();
alter table tonde.job_events enable row level security;
create policy tenant_read on tonde.job_events for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.job_events to authenticated;
grant all on tonde.job_events to service_role;
-- The identity column is fed by its own sequence; the service-role write path needs it, clients never do.
grant usage, select on sequence tonde.job_events_id_seq to service_role;

-- 4. Transactional outbox. A domain row that requires asynchronous work emits an event here in the
--    same transaction. The dispatcher claims events atomically, turns each into a durable job (or
--    records truthfully that there is nothing to do), and marks it delivered. `dedupe_key` makes
--    repeated processing harmless.
create table tonde.outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_type text not null check (length(event_type) between 1 and 120),
  resource_kind text not null check (length(resource_kind) between 1 and 60),
  resource_id uuid,
  dedupe_key text not null check (length(dedupe_key) between 8 and 300),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  payload_version integer not null default 1 check (payload_version >= 1),
  state text not null default 'pending' check (state in ('pending','processing','delivered','skipped','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_owner text, lease_expires_at timestamptz,
  job_id uuid,
  last_error_code text, last_error_message text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz, processed_at timestamptz, delivered_at timestamptz,
  unique (workspace_id, dedupe_key),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, job_id) references tonde.jobs(workspace_id, id) on delete restrict,
  constraint outbox_lease_pair check ((lease_owner is null) = (lease_expires_at is null)),
  constraint outbox_processing_leased check (state <> 'processing' or lease_owner is not null),
  constraint outbox_delivered_needs_time check (state <> 'delivered' or delivered_at is not null)
);
create index outbox_scan on tonde.outbox_events(available_at, created_at, id)
  where state in ('pending','processing');
create index outbox_by_resource on tonde.outbox_events(workspace_id, resource_kind, resource_id);
alter table tonde.outbox_events enable row level security;
grant all on tonde.outbox_events to service_role;

-- 5. Extend tonde.jobs. The single canonical job row gains the durable-execution columns.
alter table tonde.jobs
  add column priority integer not null default 50,
  add column operation_id uuid not null default gen_random_uuid(),
  add column idempotency_key text,
  add column worker_class text,
  add column parent_job_id uuid,
  add column payload_version integer not null default 1,
  add column timeout_seconds integer,
  add column deadline_at timestamptz,
  add column attempt_deadline_at timestamptz,
  add column lease_acquired_at timestamptz,
  add column heartbeat_at timestamptz,
  add column last_attempt_at timestamptz,
  add column cancel_requested_at timestamptz,
  add column cancel_requested_by uuid,
  add column cancel_reason text,
  add column cancelled_at timestamptz,
  add column failed_at timestamptz,
  add column timed_out_at timestamptz,
  add column dead_lettered_at timestamptz,
  add column dead_letter_reason text,
  add column requeue_count integer not null default 0,
  add column reconciliation_required boolean not null default false,
  add column reconciled_at timestamptz,
  add column retry_policy text,
  add column failure_classification text,
  add column termination_reason text,
  add column result_reference text,
  add column result_metadata jsonb not null default '{}'::jsonb;

alter table tonde.jobs add constraint jobs_priority_range check (priority between 0 and 100);
alter table tonde.jobs add constraint jobs_payload_version_positive check (payload_version >= 1);
alter table tonde.jobs add constraint jobs_timeout_bounds
  check (timeout_seconds is null or timeout_seconds between 30 and 86400);
alter table tonde.jobs add constraint jobs_leased_has_lease
  check (status <> 'leased' or (lease_owner is not null and lease_expires_at is not null));
alter table tonde.jobs add constraint jobs_running_has_lease
  check (status <> 'running' or (lease_owner is not null and lease_expires_at is not null));
alter table tonde.jobs add constraint jobs_cancel_requested_stamped
  check (status <> 'cancel_requested' or cancel_requested_at is not null);
alter table tonde.jobs add constraint jobs_dead_letter_explained
  check (status <> 'dead_letter' or (dead_lettered_at is not null and dead_letter_reason is not null));
alter table tonde.jobs add constraint jobs_parent_not_self
  check (parent_job_id is null or parent_job_id <> id);
alter table tonde.jobs add constraint jobs_result_metadata_object
  check (jsonb_typeof(result_metadata) = 'object');
alter table tonde.jobs add constraint jobs_retry_policy_valid check (retry_policy is null or retry_policy in
  ('safe_to_retry','requires_idempotency_key','requires_reconciliation','must_not_retry'));
alter table tonde.jobs add constraint jobs_failure_classification_valid check (failure_classification is null or
  failure_classification in ('safe_to_retry','requires_idempotency_key','requires_reconciliation','must_not_retry'));
alter table tonde.jobs add constraint jobs_termination_reason_valid check (termination_reason is null or
  termination_reason in ('completed','failed','user_cancelled','worker_timeout','provider_timeout',
    'deadline_exceeded','lease_expired','retry_exhausted','must_not_retry','reconciliation_failed'));
alter table tonde.jobs add constraint jobs_timeout_is_completed check
  (status not in ('timed_out','dead_letter') or completed_at is not null);
alter table tonde.jobs add constraint jobs_parent_fk foreign key (workspace_id, parent_job_id)
  references tonde.jobs(workspace_id, id) on delete restrict;

-- The closed job-type vocabulary stays closed, now with the Prompt 11 executor types.
alter table tonde.jobs drop constraint if exists jobs_job_type_check;
alter table tonde.jobs add constraint jobs_job_type_check check (job_type in
  ('media_preprocessing','transcription','reference_analysis','story_generation','production_generation',
   'prompt_compilation','shot_match','export','thumbnail','proxy','cloud_import','long_form_generation',
   'media_scan','media_derivation','publication_submission','provider_reconciliation',
   'notification_delivery','retention_sweep','deletion_orchestration','knowledge_ingestion'));
-- Every job names a defined type. A new job type must be defined before it can be used.
alter table tonde.jobs add constraint jobs_job_type_defined foreign key (job_type)
  references tonde.job_type_definitions(job_type) on delete restrict;

-- Idempotent enqueue identity, and the claim/scan indexes the real query patterns use.
create unique index jobs_idempotency on tonde.jobs(workspace_id, job_type, idempotency_key)
  where idempotency_key is not null;
drop index if exists tonde.jobs_claimable;
create index jobs_claimable on tonde.jobs(priority desc, available_at, created_at)
  where status in ('queued','retrying');
create index jobs_lease_expiry on tonde.jobs(lease_expires_at)
  where status in ('leased','running','cancel_requested');
create index jobs_deadline on tonde.jobs(deadline_at)
  where deadline_at is not null and status in ('queued','leased','running','waiting','retrying');
create index jobs_attempt_deadline on tonde.jobs(attempt_deadline_at)
  where attempt_deadline_at is not null and status in ('leased','running','cancel_requested');
create index jobs_reconciliation on tonde.jobs(available_at, created_at)
  where reconciliation_required and status = 'waiting';
create index jobs_workspace_open on tonde.jobs(workspace_id, status, created_at desc)
  where status not in ('succeeded','failed','cancelled','timed_out','dead_letter');

-- 6. Private helpers.

-- The transition matrix. Kept as a function so a test can pin it: no caller may move a job between
-- two states this does not allow.
create function tonde_private.job_transition_allowed(from_status text, to_status text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce((from_status, to_status) in (
    ('queued','leased'),('queued','cancelled'),('queued','timed_out'),('queued','dead_letter'),
    ('leased','running'),('leased','succeeded'),('leased','failed'),('leased','cancelled'),
    ('leased','cancel_requested'),('leased','retrying'),('leased','waiting'),('leased','timed_out'),
    ('leased','dead_letter'),
    ('running','succeeded'),('running','failed'),('running','cancelled'),('running','cancel_requested'),
    ('running','retrying'),('running','waiting'),('running','timed_out'),('running','dead_letter'),
    ('cancel_requested','running'),('cancel_requested','succeeded'),('cancel_requested','failed'),
    ('cancel_requested','cancelled'),('cancel_requested','retrying'),('cancel_requested','waiting'),
    ('cancel_requested','timed_out'),('cancel_requested','dead_letter'),
    ('waiting','retrying'),('waiting','leased'),('waiting','succeeded'),('waiting','failed'),
    ('waiting','cancelled'),('waiting','timed_out'),('waiting','dead_letter'),
    ('retrying','leased'),('retrying','cancelled'),('retrying','timed_out'),('retrying','dead_letter'),
    ('failed','queued'),('dead_letter','queued'),('timed_out','queued')
  ), false);
$$;
revoke all on function tonde_private.job_transition_allowed(text,text) from public, anon, authenticated, service_role;

-- Retry ranks. A worker's classification can only make the treatment more conservative.
create function tonde_private.job_retry_rank(classification text) returns integer
language sql immutable set search_path = '' as $$
  select case classification when 'safe_to_retry' then 0 when 'requires_idempotency_key' then 1
    when 'requires_reconciliation' then 2 when 'must_not_retry' then 3 else null end;
$$;
revoke all on function tonde_private.job_retry_rank(text) from public, anon, authenticated, service_role;

-- Deterministic bounded exponential backoff with jitter derived from the job identity and attempt
-- (never from mutable random state), plus an honoured provider Retry-After.
create function tonde_private.job_retry_backoff(target_job uuid, p_attempts integer,
  p_retry_after integer default null, p_base_seconds integer default 30, p_cap_seconds integer default 1800)
returns interval language plpgsql immutable set search_path = '' as $$
declare backoff numeric; jitter numeric;
begin
  backoff := least(p_cap_seconds, p_base_seconds * power(2::numeric, greatest(coalesce(p_attempts, 1) - 1, 0)));
  jitter := (abs(hashtextextended(target_job::text, coalesce(p_attempts, 0))) % 21) / 100.0;
  backoff := backoff * (1 + jitter);
  if p_retry_after is not null and p_retry_after > 0 then
    backoff := greatest(backoff, least(p_retry_after, p_cap_seconds)::numeric);
  end if;
  return make_interval(secs => backoff::double precision);
end $$;
revoke all on function tonde_private.job_retry_backoff(uuid,integer,integer,integer,integer)
  from public, anon, authenticated, service_role;

create function tonde_private.record_job_event(target_workspace uuid, target_job uuid, event_name text,
  actor_kind text, actor text, from_state text, to_state text, detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into tonde.job_events(workspace_id, job_id, event_type, actor_kind, actor, from_status,
    to_status, detail)
  values (target_workspace, target_job, event_name, actor_kind, left(coalesce(actor, ''), 120),
    from_state, to_state, coalesce(detail, '{}'::jsonb));
$$;
revoke all on function tonde_private.record_job_event(uuid,uuid,text,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;

-- The one place a bare state change happens. It validates the transition, so any mistake elsewhere in
-- this file is refused by the database rather than silently accepted.
create function tonde_private.job_apply(target_job uuid, to_state text, actor_kind text, actor text,
  event_name text, detail jsonb default '{}'::jsonb) returns tonde.jobs
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; previous_status text;
begin
  select * into job from tonde.jobs j where j.id = target_job for update;
  if not found then raise exception 'That job does not exist' using errcode = 'P0002'; end if;
  previous_status := job.status::text;
  if not tonde_private.job_transition_allowed(previous_status, to_state) then
    raise exception 'JOB_TRANSITION_INVALID: a job in % cannot become %', previous_status, to_state
      using errcode = 'PT409';
  end if;
  update tonde.jobs set status = to_state::tonde.job_state where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job, event_name, actor_kind, actor,
    previous_status, to_state, coalesce(detail, '{}'::jsonb));
  return job;
end $$;
revoke all on function tonde_private.job_apply(uuid,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;

-- Asserts one transition without writing it, for functions that perform their own multi-column update.
create function tonde_private.assert_job_transition(target_job uuid, from_status text, to_state text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if not tonde_private.job_transition_allowed(from_status, to_state) then
    raise exception 'JOB_TRANSITION_INVALID: a job in % cannot become %', from_status, to_state
      using errcode = 'PT409';
  end if;
end $$;
revoke all on function tonde_private.assert_job_transition(uuid,text,text)
  from public, anon, authenticated, service_role;

create function tonde_private.require_job_lease(target_job uuid, p_worker text) returns tonde.jobs
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs;
begin
  select * into job from tonde.jobs j where j.id = target_job for update;
  if not found then raise exception 'That job does not exist' using errcode = 'P0002'; end if;
  if job.lease_owner is distinct from p_worker then
    raise exception 'JOB_LEASE_NOT_OWNED: worker % does not hold the lease on this job', p_worker
      using errcode = '42501';
  end if;
  if job.lease_expires_at is null or job.lease_expires_at <= now() then
    raise exception 'JOB_LEASE_EXPIRED: the lease on this job expired at %; recovery decides what happens next',
      job.lease_expires_at using errcode = 'PT409';
  end if;
  return job;
end $$;
revoke all on function tonde_private.require_job_lease(uuid,text) from public, anon, authenticated, service_role;

create function tonde_private.require_job_worker(target_worker text, p_class text default null) returns tonde.workers
language plpgsql security definer set search_path = '' as $$
declare worker tonde.workers;
begin
  select * into worker from tonde.workers w where w.worker_id = target_worker;
  if not found then
    raise exception 'WORKER_NOT_REGISTERED: worker % is not a registered TONDE worker', target_worker
      using errcode = '42501';
  end if;
  if p_class is not null and worker.worker_class <> p_class then
    raise exception 'WORKER_CLASS_MISMATCH: worker % is a % worker, not %', target_worker,
      worker.worker_class, p_class using errcode = '42501';
  end if;
  if worker.status <> 'online' then
    raise exception 'WORKER_NOT_ACCEPTING_WORK: worker % is %', target_worker, worker.status
      using errcode = 'PT409';
  end if;
  update tonde.workers set heartbeat_at = now(), updated_at = now() where worker_id = target_worker;
  return worker;
end $$;
revoke all on function tonde_private.require_job_worker(text,text) from public, anon, authenticated, service_role;

-- 7. Enqueue. Service-role only: a durable work request is always made by the trusted server (or by a
--    database trigger inside the domain transaction), never by a browser.
create function tonde.job_enqueue(target_workspace uuid, target_job_type text, target_production uuid default null,
  p_payload jsonb default '{}'::jsonb, p_idempotency_key text default null, target_priority integer default null,
  p_parent_job uuid default null, p_requested_by uuid default null, target_timeout_seconds integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare definition tonde.job_type_definitions; job_id uuid; existing uuid; effective_priority integer;
  effective_timeout integer; requester uuid; key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  select * into definition from tonde.job_type_definitions d where d.job_type = target_job_type;
  if not found then
    raise exception 'JOB_TYPE_UNKNOWN: % is not a defined job type', target_job_type using errcode = '22023';
  end if;
  if not definition.enabled then
    raise exception 'JOB_TYPE_DISABLED: % is not currently accepted', target_job_type using errcode = 'PT409';
  end if;
  if not exists (select 1 from tonde.workspaces w where w.id = target_workspace) then
    raise exception 'That workspace does not exist' using errcode = 'P0002';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A job payload is a JSON object' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 65536 then
    raise exception 'A job payload must stay under 64 KiB; large media travels by reference' using errcode = '22023';
  end if;
  if key is not null and (length(key) < 8 or length(key) > 200) then
    raise exception 'An idempotency key is 8 to 200 characters' using errcode = '22023';
  end if;
  if p_parent_job is not null and not exists (select 1 from tonde.jobs p
    where p.workspace_id = target_workspace and p.id = p_parent_job) then
    raise exception 'That parent job does not exist in this workspace' using errcode = 'P0002';
  end if;
  if target_production is not null and not exists (select 1 from tonde.productions p
    where p.workspace_id = target_workspace and p.id = target_production) then
    raise exception 'That Production does not exist in this workspace' using errcode = 'P0002';
  end if;
  if target_timeout_seconds is not null and (target_timeout_seconds < 30 or target_timeout_seconds > 86400) then
    raise exception 'A job timeout is between 30 seconds and 24 hours' using errcode = '22023';
  end if;
  -- Priority is clamped to the ceiling the job type declares: nothing can promote its own work.
  effective_priority := greatest(0, least(coalesce(target_priority, definition.default_priority),
    definition.max_priority));
  effective_timeout := coalesce(target_timeout_seconds, definition.timeout_seconds);
  -- The job is always requested on behalf of a real identity: the trusted caller, the authenticated
  -- creator, or (for a server-side follow-up) the workspace owner.
  requester := coalesce(p_requested_by, auth.uid(),
    (select owner_user_id from tonde.workspaces w where w.id = target_workspace));
  if key is not null then
    select j.id into existing from tonde.jobs j
      where j.workspace_id = target_workspace and j.job_type = target_job_type
        and j.idempotency_key = key;
    if found then
      return jsonb_build_object('job_id', existing, 'idempotent', true, 'job_type', target_job_type,
        'status', (select j.status::text from tonde.jobs j where j.id = existing),
        'meaning', 'This durable request already exists; the same idempotency key returns it instead of queueing the work twice.');
    end if;
  end if;
  insert into tonde.jobs(workspace_id, production_id, job_type, requested_by, input_metadata, priority,
    idempotency_key, worker_class, parent_job_id, timeout_seconds, deadline_at, payload_version,
    retry_policy, max_attempts)
  values (target_workspace, target_production, target_job_type, requester, p_payload, effective_priority,
    key, definition.worker_class, p_parent_job, effective_timeout,
    now() + make_interval(secs => definition.max_window_seconds), definition.payload_version,
    definition.retry_policy, definition.default_max_attempts)
  on conflict (workspace_id, job_type, idempotency_key) where idempotency_key is not null do nothing
  returning id into job_id;
  if job_id is null then
    select j.id into job_id from tonde.jobs j
      where j.workspace_id = target_workspace and j.job_type = target_job_type and j.idempotency_key = key;
    return jsonb_build_object('job_id', job_id, 'idempotent', true, 'job_type', target_job_type,
      'status', (select j.status::text from tonde.jobs j where j.id = job_id),
      'meaning', 'This durable request already exists; the same idempotency key returns it instead of queueing the work twice.');
  end if;
  perform tonde_private.record_job_event(target_workspace, job_id, 'enqueued', 'server',
    coalesce(p_requested_by, auth.uid())::text, null, 'queued',
    jsonb_build_object('job_type', target_job_type, 'priority', effective_priority,
      'worker_class', definition.worker_class, 'idempotency_key', key));
  return jsonb_build_object('job_id', job_id, 'idempotent', false, 'job_type', target_job_type,
    'status', 'queued', 'worker_class', definition.worker_class, 'priority', effective_priority,
    'max_priority', definition.max_priority, 'timeout_seconds', effective_timeout,
    'max_attempts', definition.default_max_attempts, 'available_at', now(),
    'retry_policy', definition.retry_policy,
    'deadline_at', now() + make_interval(secs => definition.max_window_seconds),
    'max_window_seconds', definition.max_window_seconds,
    'meaning', 'The durable work request is recorded and commits with the caller''s transaction.');
end $$;

-- 8. Claiming. One atomic statement; a worker claims only job types of its own class.
create function tonde.job_claim(p_worker_id text, p_worker_class text, p_limit integer default 1,
  p_lease_seconds integer default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare claimed jsonb := '[]'::jsonb; job_row tonde.jobs; lease interval;
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception 'A claim takes between 1 and 25 jobs' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'A lease is between 30 seconds and one hour' using errcode = '22023';
  end if;
  perform tonde_private.require_job_worker(p_worker_id, p_worker_class);
  lease := make_interval(secs => p_lease_seconds);
  for job_row in
    select j.* from tonde.jobs j
      where j.worker_class = p_worker_class
        and j.status in ('queued','retrying')
        and j.available_at <= now()
        and (j.deadline_at is null or j.deadline_at > now())
        and exists (select 1 from tonde.job_type_definitions d
          where d.job_type = j.job_type and d.enabled)
      order by j.priority desc, j.available_at, j.created_at
      for update skip locked
      limit p_limit
  loop
    update tonde.jobs set status = 'leased', lease_owner = p_worker_id, lease_acquired_at = now(),
      lease_expires_at = now() + lease, heartbeat_at = now(), last_attempt_at = now(),
      attempts = job_row.attempts + 1, started_at = coalesce(job_row.started_at, now()),
      -- The per-attempt bound is separate from the job's end-to-end deadline set at enqueue.
      attempt_deadline_at = now() + make_interval(secs => coalesce(job_row.timeout_seconds, 900))
      where workspace_id = job_row.workspace_id and id = job_row.id;
    perform tonde_private.record_job_event(job_row.workspace_id, job_row.id, 'leased', 'worker',
      p_worker_id, job_row.status::text, 'leased',
      jsonb_build_object('attempt', job_row.attempts + 1, 'max_attempts', job_row.max_attempts,
        'lease_seconds', p_lease_seconds, 'lease_expires_at', now() + lease));
    claimed := claimed || jsonb_build_object('job_id', job_row.id, 'workspace_id', job_row.workspace_id,
      'job_type', job_row.job_type, 'production_id', job_row.production_id,
      'payload', job_row.input_metadata, 'attempt', job_row.attempts + 1,
      'max_attempts', job_row.max_attempts, 'priority', job_row.priority,
      'operation_id', job_row.operation_id, 'payload_version', job_row.payload_version,
      'retry_policy', job_row.retry_policy,
      'externally_consequential', (select d.externally_consequential from tonde.job_type_definitions d
        where d.job_type = job_row.job_type),
      'cancellable', (select d.cancellable from tonde.job_type_definitions d
        where d.job_type = job_row.job_type),
      'deadline_at', job_row.deadline_at,
      'attempt_deadline_at', now() + make_interval(secs => coalesce(job_row.timeout_seconds, 900)),
      'lease_expires_at', now() + lease);
  end loop;
  if jsonb_array_length(claimed) > 0 then
    update tonde.workers set last_claimed_at = now(), heartbeat_at = now(), updated_at = now()
      where worker_id = p_worker_id;
  end if;
  return jsonb_build_object('worker_id', p_worker_id, 'worker_class', p_worker_class,
    'claimed', claimed, 'count', jsonb_array_length(claimed), 'claimed_at', now());
end $$;

create function tonde.job_start(target_job uuid, p_worker text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; started tonde.jobs;
begin
  job := tonde_private.require_job_lease(target_job, p_worker);
  if job.status = 'running' then
    return jsonb_build_object('job_id', target_job, 'status', 'running', 'idempotent', true,
      'lease_expires_at', job.lease_expires_at);
  end if;
  started := tonde_private.job_apply(target_job, 'running', 'worker', p_worker, 'started',
    jsonb_build_object('attempt', job.attempts));
  return jsonb_build_object('job_id', target_job, 'status', 'running',
    'started_at', coalesce(started.started_at, now()), 'lease_expires_at', started.lease_expires_at,
    'cancel_requested', started.cancel_requested_at is not null);
end $$;

create function tonde.job_heartbeat(target_job uuid, p_worker text, p_seconds integer default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs;
begin
  if p_seconds is null or p_seconds < 30 or p_seconds > 3600 then
    raise exception 'A lease extension is between 30 seconds and one hour' using errcode = '22023';
  end if;
  job := tonde_private.require_job_lease(target_job, p_worker);
  if job.status not in ('leased','running','cancel_requested') then
    raise exception 'JOB_NOT_LEASED: a job in % holds no work to heartbeat', job.status using errcode = 'PT409';
  end if;
  update tonde.jobs set lease_expires_at = now() + make_interval(secs => p_seconds),
    heartbeat_at = now()
    where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job, 'heartbeat', 'worker', p_worker,
    job.status::text, job.status::text, jsonb_build_object('lease_expires_at', job.lease_expires_at));
  return jsonb_build_object('job_id', target_job, 'status', job.status, 'owned', true,
    'lease_expires_at', job.lease_expires_at,
    'cancel_requested', job.cancel_requested_at is not null, 'cancel_reason', job.cancel_reason,
    'deadline_at', job.deadline_at,
    'meaning', case when job.cancel_requested_at is not null
      then 'A creator asked for cancellation; stop if the operation can be stopped safely, then acknowledge.'
      else 'The lease is extended and this worker still owns the job.' end);
end $$;

-- 9. Completion. Idempotent: repeating a completion of a finished job changes nothing.
create function tonde.job_complete(target_job uuid, p_worker text, p_result jsonb default '{}'::jsonb,
  p_result_reference text default null, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; race text := null; definition tonde.job_type_definitions; previous_status text;
begin
  select * into job from tonde.jobs j where j.id = target_job for update;
  if not found then raise exception 'That job does not exist' using errcode = 'P0002'; end if;
  if job.status = 'succeeded' then
    return jsonb_build_object('job_id', job.id, 'status', 'succeeded', 'idempotent', true,
      'result_reference', job.result_reference, 'completed_at', job.completed_at,
      'meaning', 'This job already succeeded; the duplicate completion was recognised and changed nothing.');
  end if;
  if job.status in ('cancelled','failed','timed_out','dead_letter') then
    raise exception 'JOB_TERMINAL: a job in % cannot be completed', job.status using errcode = 'PT409';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'A job result is a JSON object' using errcode = '22023';
  end if;
  previous_status := job.status::text;
  perform tonde_private.assert_job_transition(target_job, previous_status, 'succeeded');
  select * into definition from tonde.job_type_definitions d where d.job_type = job.job_type;
  job := tonde_private.require_job_lease(target_job, p_worker);
  -- A cancellation request that arrived while the work was finishing cannot undo a real effect. The
  -- completion is recorded and the race is reported instead of pretending the work was cancelled.
  if job.cancel_requested_at is not null then
    race := 'completion_after_cancel_request';
  end if;
  update tonde.jobs set status = 'succeeded', progress = 100, completed_at = now(),
    lease_owner = null, lease_expires_at = null, heartbeat_at = now(),
    result_reference = left(coalesce(p_result_reference, job.result_reference), 400),
    result_metadata = p_result, termination_reason = 'completed',
    error_code = null, error_message = null, reconciliation_required = false,
    reconciled_at = case when job.reconciliation_required then now() else job.reconciled_at end
    where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job, 'completed', 'worker', p_worker,
    previous_status, 'succeeded',
    jsonb_build_object('attempts', job.attempts, 'result_reference', job.result_reference,
      'note', left(coalesce(p_note, ''), 400), 'cancel_race', race,
      'externally_consequential', definition.externally_consequential));
  return jsonb_build_object('job_id', target_job, 'status', 'succeeded', 'idempotent', false,
    'result_reference', job.result_reference, 'completed_at', job.completed_at, 'attempts', job.attempts,
    'cancel_race', race,
    'meaning', case when race is not null
      then 'The work finished after a cancellation was requested; the real effect exists and is recorded as completed.'
      else 'The work is complete and the lease is released.' end);
end $$;

-- 10. Failure, retry and dead-letter. The decision is explicit and classification-aware.
create function tonde.job_fail(target_job uuid, p_worker text, p_error_code text, p_error_message text,
  p_classification text default null, p_retry_after_seconds integer default null,
  p_timeout_kind text default null, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; definition tonde.job_type_definitions; effective text; rank integer;
  next_state text; reason text := null; backoff interval; was_cancelled boolean; previous_status text;
begin
  if p_timeout_kind is not null and p_timeout_kind not in ('worker_timeout','provider_timeout') then
    raise exception 'A timeout kind is worker_timeout or provider_timeout' using errcode = '22023';
  end if;
  if p_classification is not null and tonde_private.job_retry_rank(p_classification) is null then
    raise exception 'A retry classification is safe_to_retry, requires_idempotency_key, requires_reconciliation or must_not_retry'
      using errcode = '22023';
  end if;
  select * into job from tonde.jobs j where j.id = target_job for update;
  if not found then raise exception 'That job does not exist' using errcode = 'P0002'; end if;
  if job.status in ('succeeded','failed','cancelled','timed_out','dead_letter') then
    return jsonb_build_object('job_id', target_job, 'status', job.status, 'idempotent', true,
      'meaning', 'This job is already finished; the duplicate failure report was recognised and changed nothing.');
  end if;
  select * into definition from tonde.job_type_definitions d where d.job_type = job.job_type;
  if job.status in ('queued','retrying','waiting') then
    raise exception 'JOB_NOT_LEASED: a job in % has no attempt to report a failure for', job.status
      using errcode = 'PT409';
  end if;
  previous_status := job.status::text;
  job := tonde_private.require_job_lease(target_job, p_worker);
  was_cancelled := job.cancel_requested_at is not null or job.status = 'cancel_requested';
  -- The effective treatment is never more optimistic than the job type allows.
  rank := greatest(coalesce(tonde_private.job_retry_rank(p_classification), 0),
    coalesce(tonde_private.job_retry_rank(definition.retry_policy), 0));
  effective := case rank when 0 then 'safe_to_retry' when 1 then 'requires_idempotency_key'
    when 2 then 'requires_reconciliation' else 'must_not_retry' end;
  backoff := tonde_private.job_retry_backoff(target_job, job.attempts + 1, p_retry_after_seconds);
  if was_cancelled then
    next_state := 'cancelled'; reason := 'user_cancelled';
  elsif effective = 'must_not_retry' then
    next_state := 'dead_letter'; reason := 'must_not_retry';
  elsif effective = 'requires_reconciliation' then
    next_state := 'waiting';
  elsif job.attempts >= job.max_attempts then
    next_state := 'dead_letter'; reason := 'retry_exhausted';
  elsif job.deadline_at is not null and now() + backoff > job.deadline_at then
    next_state := 'dead_letter'; reason := 'retry_exhausted';
  else
    next_state := 'retrying';
  end if;
  if next_state = 'dead_letter' and p_timeout_kind is not null and reason = 'retry_exhausted' then
    reason := p_timeout_kind;
  end if;
  perform tonde_private.assert_job_transition(target_job, previous_status, next_state);
  update tonde.jobs set status = next_state::tonde.job_state,
    lease_owner = null, lease_expires_at = null,
    error_code = left(coalesce(p_error_code, ''), 120),
    error_message = left(coalesce(p_error_message, ''), 2000),
    failure_classification = effective,
    available_at = case when next_state in ('retrying','waiting') then now() + backoff else available_at end,
    reconciliation_required = (effective = 'requires_reconciliation'),
    termination_reason = case when next_state in ('cancelled','dead_letter') then reason else null end,
    failed_at = case when next_state = 'dead_letter' then now() else failed_at end,
    dead_lettered_at = case when next_state = 'dead_letter' then now() else dead_lettered_at end,
    dead_letter_reason = case when next_state = 'dead_letter' then reason else dead_letter_reason end,
    timed_out_at = case when p_timeout_kind is not null and next_state = 'dead_letter' then now()
      else timed_out_at end,
    cancelled_at = case when next_state = 'cancelled' then now() else cancelled_at end,
    completed_at = case when next_state in ('cancelled','dead_letter') then now() else completed_at end
    where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job,
    case when next_state = 'retrying' then 'retry_scheduled'
      when next_state = 'waiting' then 'reconciliation_required'
      when next_state = 'cancelled' then 'cancelled' else 'dead_lettered' end,
    'worker', p_worker, previous_status, next_state,
    jsonb_build_object('attempts', job.attempts, 'max_attempts', job.max_attempts,
      'effective_classification', effective, 'reported_classification', p_classification,
      'job_type_policy', definition.retry_policy, 'error_code', p_error_code,
      'timeout_kind', p_timeout_kind, 'reason', reason,
      'backoff_seconds', extract(epoch from backoff), 'note', left(coalesce(p_note, ''), 400)));
  return jsonb_build_object('job_id', target_job, 'status', next_state, 'idempotent', false,
    'effective_classification', effective, 'reported_classification', p_classification,
    'job_type_policy', definition.retry_policy, 'attempts', job.attempts,
    'max_attempts', job.max_attempts, 'reason', reason, 'available_at', job.available_at,
    'backoff_seconds', extract(epoch from backoff), 'reconciliation_required', job.reconciliation_required,
    'termination_reason', job.termination_reason, 'timeout_kind', p_timeout_kind,
    'meaning', case next_state
      when 'retrying' then 'The failure is retryable; the next attempt is scheduled and survives a worker restart.'
      when 'waiting' then 'The external state is uncertain; reconciliation must establish it before this work is repeated.'
      when 'cancelled' then 'A creator requested cancellation; the attempt stopped and the job is cancelled.'
      when 'dead_letter' then 'The work will not be retried; it is preserved in the dead letter with its cause.' end);
end $$;

-- 11. Cancellation. A creator decision is recorded; the worker observes it and reports what was
--     actually possible. A remote effect that already happened is never reported as cancelled.
create function tonde.job_cancel_request(target_workspace uuid, target_job uuid, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; definition tonde.job_type_definitions; next_state text; irreversible boolean;
  previous_status text; by_service boolean := (select auth.role()) = 'service_role';
begin
  if not by_service and (auth.uid() is null or not tonde_private.can_edit_workspace(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into job from tonde.jobs j
    where j.workspace_id = target_workspace and j.id = target_job for update;
  if not found then raise exception 'That job does not exist in this workspace' using errcode = 'P0002'; end if;
  select * into definition from tonde.job_type_definitions d where d.job_type = job.job_type;
  if job.status in ('succeeded','failed','cancelled','timed_out','dead_letter') then
    raise exception 'JOB_TERMINAL: a job in % cannot be cancelled', job.status using errcode = 'PT409';
  end if;
  irreversible := definition.externally_consequential;
  next_state := case when job.status in ('queued','retrying','waiting') then 'cancelled'
    else 'cancel_requested' end;
  previous_status := job.status::text;
  perform tonde_private.assert_job_transition(target_job, previous_status, next_state);
  update tonde.jobs set status = next_state::tonde.job_state,
    cancel_requested_at = coalesce(cancel_requested_at, now()),
    cancel_requested_by = coalesce(cancel_requested_by, auth.uid()),
    cancel_reason = left(coalesce(nullif(btrim(p_reason), ''),
      'Cancellation requested by a workspace editor'), 400),
    cancelled_at = case when next_state = 'cancelled' then now() else cancelled_at end,
    termination_reason = case when next_state = 'cancelled' then 'user_cancelled' else termination_reason end,
    completed_at = case when next_state = 'cancelled' then now() else completed_at end,
    lease_owner = case when next_state = 'cancelled' then null else lease_owner end,
    lease_expires_at = case when next_state = 'cancelled' then null else lease_expires_at end
    where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job,
    case when next_state = 'cancelled' then 'cancelled' else 'cancel_requested' end,
    case when by_service then 'server' else 'user' end,
    coalesce(auth.uid()::text, 'service'), previous_status, next_state,
    jsonb_build_object('reason', job.cancel_reason, 'irreversible', irreversible,
      'cancellable', definition.cancellable));
  return jsonb_build_object('job_id', target_job, 'status', next_state,
    'cancel_requested_at', job.cancel_requested_at, 'cancel_reason', job.cancel_reason,
    'irreversible', irreversible, 'cancellable', definition.cancellable,
    'meaning', case
      when next_state = 'cancelled' then 'The job is cancelled; it had not started, so nothing ran.'
      when irreversible then 'Cancellation was requested, but this operation may already have taken effect externally; the worker will report what was actually possible.'
      else 'Cancellation was requested; the worker that holds the lease will stop and acknowledge.' end);
end $$;

create function tonde.job_cancel_acknowledge(target_job uuid, p_worker text, p_outcome text,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs;
begin
  if p_outcome not in ('cancelled','cannot_cancel_remote') then
    raise exception 'A cancellation outcome is cancelled or cannot_cancel_remote' using errcode = '22023';
  end if;
  job := tonde_private.require_job_lease(target_job, p_worker);
  if job.cancel_requested_at is null and job.status <> 'cancel_requested' then
    raise exception 'JOB_NO_CANCELLATION_PENDING: no cancellation was requested for this job'
      using errcode = 'PT409';
  end if;
  if p_outcome = 'cancelled' then
    perform tonde_private.assert_job_transition(target_job, job.status::text, 'cancelled');
    update tonde.jobs set status = 'cancelled', cancelled_at = now(), completed_at = now(),
      lease_owner = null, lease_expires_at = null, termination_reason = 'user_cancelled',
      reconciliation_required = false
      where id = target_job returning * into job;
    perform tonde_private.record_job_event(job.workspace_id, target_job, 'cancel_acknowledged', 'worker',
      p_worker, 'cancel_requested', 'cancelled', jsonb_build_object('note', left(coalesce(p_note, ''), 400)));
    return jsonb_build_object('job_id', target_job, 'status', 'cancelled', 'outcome', 'cancelled',
      'cancelled_at', job.cancelled_at,
      'meaning', 'The worker stopped the operation and confirmed it; nothing further will run.');
  end if;
  -- The remote operation cannot be stopped. TONDE does not pretend otherwise: the request stays on the
  -- record as evidence and the job continues to a real outcome.
  perform tonde_private.assert_job_transition(target_job, job.status::text, 'running');
  update tonde.jobs set status = 'running', heartbeat_at = now()
    where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job, 'cancel_not_possible_remote',
    'worker', p_worker, 'cancel_requested', 'running',
    jsonb_build_object('note', left(coalesce(p_note, ''), 400)));
  return jsonb_build_object('job_id', target_job, 'status', 'running',
    'outcome', 'cannot_cancel_remote', 'cancel_requested_at', job.cancel_requested_at,
    'meaning', 'The destination already accepted the operation, so it cannot be cancelled. The cancellation request is retained as evidence and the real outcome will be recorded.');
end $$;

-- 12. Recovery. Expired leases and expired deadlines are resolved without blind re-execution.
create function tonde.job_recover_expired_leases(p_limit integer default 100, p_grace_seconds integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job_row tonde.jobs; definition tonde.job_type_definitions; next_state text; reason text;
  backoff interval; outcomes jsonb := '{}'::jsonb; affected text[] := '{}'; recovered integer := 0;
  previous_owner text; previous_status text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'A recovery batch takes between 1 and 500 jobs' using errcode = '22023';
  end if;
  for job_row in
    select j.* from tonde.jobs j
      where j.status in ('leased','running','cancel_requested')
        and j.lease_expires_at is not null
        and j.lease_expires_at <= now() - make_interval(secs => greatest(coalesce(p_grace_seconds, 0), 0))
      order by j.lease_expires_at
      for update skip locked
      limit p_limit
  loop
    select * into definition from tonde.job_type_definitions d where d.job_type = job_row.job_type;
    backoff := tonde_private.job_retry_backoff(job_row.id, job_row.attempts + 1);
    previous_owner := job_row.lease_owner;
    previous_status := job_row.status::text;
    if job_row.cancel_requested_at is not null then
      next_state := 'cancelled'; reason := 'user_cancelled';
    elsif job_row.attempts >= job_row.max_attempts then
      next_state := 'dead_letter'; reason := 'lease_expired';
    elsif definition.requires_reconciliation then
      -- Never repeat an externally consequential operation blindly after a crash.
      next_state := 'waiting'; reason := null;
    else
      next_state := 'retrying'; reason := null;
    end if;
    perform tonde_private.assert_job_transition(job_row.id, previous_status, next_state);
    update tonde.jobs set status = next_state::tonde.job_state, lease_owner = null, lease_expires_at = null,
      available_at = case when next_state in ('retrying','waiting') then now() + backoff else available_at end,
      reconciliation_required = (next_state = 'waiting'),
      dead_lettered_at = case when next_state = 'dead_letter' then now() else dead_lettered_at end,
      dead_letter_reason = case when next_state = 'dead_letter' then 'lease_expired' else dead_letter_reason end,
      failed_at = case when next_state = 'dead_letter' then now() else failed_at end,
      cancelled_at = case when next_state = 'cancelled' then now() else cancelled_at end,
      completed_at = case when next_state in ('dead_letter','cancelled') then now() else completed_at end,
      termination_reason = case when next_state = 'dead_letter' then 'lease_expired'
        when next_state = 'cancelled' then 'user_cancelled' else termination_reason end
      where id = job_row.id returning * into job_row;
    perform tonde_private.record_job_event(job_row.workspace_id, job_row.id, 'lease_expired', 'system',
      'recovery', previous_status, next_state,
      jsonb_build_object('previous_lease_owner', previous_owner, 'attempts', job_row.attempts,
        'max_attempts', job_row.max_attempts, 'reconciliation_required', job_row.reconciliation_required,
        'backoff_seconds', extract(epoch from backoff), 'reason', reason));
    affected := affected || job_row.id::text;
    recovered := recovered + 1;
    outcomes := jsonb_set(outcomes, array[next_state],
      to_jsonb(coalesce((outcomes ->> next_state)::integer, 0) + 1));
  end loop;
  return jsonb_build_object('recovered', recovered, 'by_state', outcomes, 'job_ids', affected,
    'recovered_at', now(),
    'meaning', 'Leases whose owner stopped reporting are no longer held. Externally consequential work waits for reconciliation instead of being repeated.');
end $$;

-- Two clocks, two answers. `attempt_deadline_at` is the per-attempt bound (a worker timeout);
-- `deadline_at` is the job's end-to-end window (a job deadline exceeded). Neither is the same as an
-- operator or provider cancellation, and none of them is reported as a generic failure.
create function tonde.job_timeout_scan(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job_row tonde.jobs; definition tonde.job_type_definitions; next_state text; reason text;
  outcomes jsonb := '{}'::jsonb; affected text[] := '{}'; attempts_expired integer := 0;
  deadlines_expired integer := 0; previous_status text; kind text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'A timeout scan takes between 1 and 500 jobs' using errcode = '22023';
  end if;
  for job_row in
    select j.* from tonde.jobs j
      where ((j.attempt_deadline_at is not null and j.attempt_deadline_at <= now()
              and j.status in ('leased','running','cancel_requested'))
          or (j.deadline_at is not null and j.deadline_at <= now()
              and j.status in ('queued','retrying','leased','running','waiting','cancel_requested')))
      order by coalesce(j.deadline_at, j.attempt_deadline_at), j.created_at
      for update skip locked
      limit p_limit
  loop
    select * into definition from tonde.job_type_definitions d where d.job_type = job_row.job_type;
    previous_status := job_row.status::text;
    -- The end-to-end window is the stronger fact; otherwise the attempt bound is what expired.
    if job_row.deadline_at is not null and job_row.deadline_at <= now() then
      kind := 'deadline_exceeded';
      deadlines_expired := deadlines_expired + 1;
    else
      kind := 'worker_timeout';
      attempts_expired := attempts_expired + 1;
    end if;
    if job_row.cancel_requested_at is not null then
      next_state := 'cancelled'; reason := 'user_cancelled';
    elsif definition.requires_reconciliation
      and job_row.status in ('leased','running','cancel_requested') then
      -- The bound passed while the work was in flight: the external effect may exist, so the state is
      -- established by reconciliation rather than assumed.
      next_state := 'waiting'; reason := kind;
    elsif job_row.attempts >= job_row.max_attempts or kind = 'deadline_exceeded' then
      next_state := 'timed_out'; reason := kind;
    else
      next_state := 'retrying'; reason := null;
    end if;
    perform tonde_private.assert_job_transition(job_row.id, previous_status, next_state);
    update tonde.jobs set status = next_state::tonde.job_state, lease_owner = null, lease_expires_at = null,
      reconciliation_required = (next_state = 'waiting'),
      available_at = case when next_state = 'retrying' then now() else available_at end,
      timed_out_at = case when next_state = 'timed_out' then now() else timed_out_at end,
      completed_at = case when next_state in ('timed_out','cancelled') then now() else completed_at end,
      cancelled_at = case when next_state = 'cancelled' then now() else cancelled_at end,
      termination_reason = case when next_state in ('timed_out','cancelled','waiting') then reason
        else termination_reason end
      where id = job_row.id returning * into job_row;
    perform tonde_private.record_job_event(job_row.workspace_id, job_row.id,
      case when next_state = 'timed_out' then 'timed_out'
        when next_state = 'cancelled' then 'cancelled'
        when next_state = 'retrying' then 'retry_scheduled' else 'reconciliation_required' end,
      'system', 'timeout-scan', previous_status, next_state,
      jsonb_build_object('expired_clock', kind, 'deadline_at', job_row.deadline_at,
        'attempt_deadline_at', job_row.attempt_deadline_at, 'attempts', job_row.attempts,
        'max_attempts', job_row.max_attempts, 'reason', reason,
        'reconciliation_required', job_row.reconciliation_required));
    affected := affected || job_row.id::text;
    outcomes := jsonb_set(outcomes, array[next_state],
      to_jsonb(coalesce((outcomes ->> next_state)::integer, 0) + 1));
  end loop;
  return jsonb_build_object('expired', attempts_expired + deadlines_expired,
    'attempt_expired', attempts_expired, 'deadline_expired', deadlines_expired,
    'by_state', outcomes, 'job_ids', affected, 'scanned_at', now(),
    'meaning', 'An attempt that ran past its own bound is a worker timeout; a job that ran past its window is a deadline exceeded. Either way an operation that may already have taken effect externally waits for reconciliation instead of being marked merely failed.');
end $$;

-- 13. Reconciliation and requeue. An uncertain external state is established, then decided.
create function tonde.job_reconcile(target_job uuid, p_actor text, p_outcome text, p_note text default '',
  p_result jsonb default '{}'::jsonb, p_result_reference text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; next_state text; definition tonde.job_type_definitions; previous_status text;
begin
  if p_outcome not in ('requeue','complete','fail','cancel') then
    raise exception 'A reconciliation outcome is requeue, complete, fail or cancel' using errcode = '22023';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'A job result is a JSON object' using errcode = '22023';
  end if;
  select * into job from tonde.jobs j where j.id = target_job for update;
  if not found then raise exception 'That job does not exist' using errcode = 'P0002'; end if;
  select * into definition from tonde.job_type_definitions d where d.job_type = job.job_type;
  if not job.reconciliation_required and job.status <> 'waiting' then
    raise exception 'JOB_NOT_AWAITING_RECONCILIATION: this job has no uncertain external state to reconcile'
      using errcode = 'PT409';
  end if;
  previous_status := job.status::text;
  next_state := case p_outcome when 'requeue' then 'retrying' when 'complete' then 'succeeded'
    when 'fail' then 'dead_letter' else 'cancelled' end;
  perform tonde_private.assert_job_transition(target_job, previous_status, next_state);
  update tonde.jobs set status = next_state::tonde.job_state, lease_owner = null, lease_expires_at = null,
    reconciliation_required = false, reconciled_at = now(),
    available_at = case when next_state = 'retrying' then now() else available_at end,
    termination_reason = case when p_outcome = 'fail' then 'reconciliation_failed'
      when p_outcome = 'complete' then 'completed'
      when p_outcome = 'cancel' then 'user_cancelled' else null end,
    dead_letter_reason = case when p_outcome = 'fail' then 'reconciliation_failed' else dead_letter_reason end,
    dead_lettered_at = case when p_outcome = 'fail' then now() else dead_lettered_at end,
    failed_at = case when p_outcome = 'fail' then now() else failed_at end,
    cancelled_at = case when p_outcome = 'cancel' then now() else cancelled_at end,
    completed_at = case when p_outcome in ('fail','complete','cancel') then now() else completed_at end,
    progress = case when p_outcome = 'complete' then 100 else progress end,
    result_reference = coalesce(left(p_result_reference, 400), result_reference),
    result_metadata = case when p_outcome = 'complete' then p_result else result_metadata end
    where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job, 'reconciled', 'server',
    left(coalesce(p_actor, 'operator'), 120), previous_status, next_state,
    jsonb_build_object('outcome', p_outcome, 'note', left(coalesce(p_note, ''), 800),
      'externally_consequential', definition.externally_consequential));
  return jsonb_build_object('job_id', target_job, 'status', next_state, 'outcome', p_outcome,
    'reconciled_at', job.reconciled_at, 'note', left(coalesce(p_note, ''), 800),
    'meaning', 'The real external state was established before the work was repeated, finished or abandoned.');
end $$;

create function tonde.job_requeue(target_job uuid, p_actor text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; previous_status text;
begin
  select * into job from tonde.jobs j where j.id = target_job for update;
  if not found then raise exception 'That job does not exist' using errcode = 'P0002'; end if;
  if job.status not in ('failed','dead_letter','timed_out') then
    raise exception 'JOB_NOT_REQUEUEABLE: a job in % is not a finished failure', job.status using errcode = 'PT409';
  end if;
  previous_status := job.status::text;
  perform tonde_private.assert_job_transition(target_job, previous_status, 'queued');
  update tonde.jobs set status = 'queued', attempts = 0, requeue_count = requeue_count + 1,
    available_at = now(), dead_lettered_at = null, dead_letter_reason = null, failed_at = null,
    timed_out_at = null, completed_at = null, termination_reason = null,
    reconciliation_required = false, reconciled_at = null, lease_owner = null, lease_expires_at = null,
    deadline_at = null, error_code = null, error_message = null
    where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job, 'requeued', 'server',
    left(coalesce(p_actor, 'operator'), 120), previous_status, 'queued',
    jsonb_build_object('note', left(coalesce(p_note, ''), 800), 'requeue_count', job.requeue_count));
  return jsonb_build_object('job_id', target_job, 'status', 'queued', 'attempts', 0,
    'requeue_count', job.requeue_count, 'available_at', job.available_at,
    'meaning', 'The finished failure is queued again as a new attempt. Its history is preserved.');
end $$;

-- 14. Graceful release. A worker that must stop hands its unfinished lease back with a recorded
--     decision instead of abandoning it in an ambiguous running state.
create function tonde.job_release(target_job uuid, p_worker text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; definition tonde.job_type_definitions; next_state text; backoff interval;
  previous_status text;
begin
  job := tonde_private.require_job_lease(target_job, p_worker);
  if job.status not in ('leased','running','cancel_requested') then
    raise exception 'JOB_NOT_LEASED: a job in % holds no lease to release', job.status using errcode = 'PT409';
  end if;
  select * into definition from tonde.job_type_definitions d where d.job_type = job.job_type;
  backoff := tonde_private.job_retry_backoff(target_job, job.attempts + 1);
  next_state := case when job.cancel_requested_at is not null then 'cancelled'
    when definition.requires_reconciliation then 'waiting'
    when job.attempts >= job.max_attempts then 'dead_letter'
    else 'retrying' end;
  previous_status := job.status::text;
  perform tonde_private.assert_job_transition(target_job, previous_status, next_state);
  update tonde.jobs set status = next_state::tonde.job_state, lease_owner = null, lease_expires_at = null,
    reconciliation_required = (next_state = 'waiting'),
    available_at = case when next_state in ('retrying','waiting') then now() + backoff else available_at end,
    completed_at = case when next_state in ('cancelled','dead_letter') then now() else completed_at end,
    dead_lettered_at = case when next_state = 'dead_letter' then now() else dead_lettered_at end,
    dead_letter_reason = case when next_state = 'dead_letter' then 'retry_exhausted' else dead_letter_reason end,
    cancelled_at = case when next_state = 'cancelled' then now() else cancelled_at end,
    termination_reason = case when next_state = 'cancelled' then 'user_cancelled'
      when next_state = 'dead_letter' then 'retry_exhausted' else termination_reason end
    where id = target_job returning * into job;
  perform tonde_private.record_job_event(job.workspace_id, target_job, 'released', 'worker', p_worker,
    previous_status, next_state,
    jsonb_build_object('note', left(coalesce(p_note, ''), 400),
      'reconciliation_required', job.reconciliation_required));
  return jsonb_build_object('job_id', target_job, 'status', next_state,
    'reconciliation_required', job.reconciliation_required,
    'meaning', 'The worker stopped safely and the lease was handed back with the honest next state.');
end $$;

-- 15. Worker registry API. Service-role only; worker identity is never a client statement.
create function tonde.worker_register(p_worker_id text, p_worker_class text, p_instance text default '',
  p_version text default '', p_capabilities text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare worker tonde.workers;
begin
  if p_worker_id is null or length(btrim(p_worker_id)) < 1 or length(p_worker_id) > 120 then
    raise exception 'A worker id is 1 to 120 characters' using errcode = '22023';
  end if;
  if p_worker_class not in ('media','ai','export','publishing','reconciliation','notification',
    'maintenance','knowledge') then
    raise exception 'That is not a TONDE worker class' using errcode = '22023';
  end if;
  insert into tonde.workers(worker_id, worker_class, instance, version, capabilities, status, started_at,
    heartbeat_at, shutdown_requested_at, shutdown_completed_at)
  values (btrim(p_worker_id), p_worker_class, left(coalesce(p_instance, ''), 200),
    left(coalesce(p_version, ''), 60), coalesce(p_capabilities, '{}'), 'online', now(), now(), null, null)
  on conflict (worker_id) do update set worker_class = excluded.worker_class,
    instance = excluded.instance, version = excluded.version, capabilities = excluded.capabilities,
    status = 'online', started_at = now(), heartbeat_at = now(),
    shutdown_requested_at = null, shutdown_completed_at = null, updated_at = now()
  returning * into worker;
  return jsonb_build_object('worker_id', worker.worker_id, 'worker_class', worker.worker_class,
    'status', worker.status, 'registered_at', worker.started_at,
    'meaning', 'This worker may claim work for its class. It cannot authorize anything a creator has not already authorized.');
end $$;

create function tonde.worker_heartbeat(p_worker_id text, p_status text default 'online',
  p_seconds integer default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare worker tonde.workers; leases jsonb;
begin
  if p_status not in ('online','draining','offline') then
    raise exception 'A worker status is online, draining or offline' using errcode = '22023';
  end if;
  update tonde.workers set status = p_status, heartbeat_at = now(),
    shutdown_requested_at = case when p_status = 'draining'
      then coalesce(shutdown_requested_at, now()) else shutdown_requested_at end,
    shutdown_completed_at = case when p_status = 'offline' then now() else shutdown_completed_at end,
    updated_at = now()
    where worker_id = p_worker_id returning * into worker;
  if not found then
    raise exception 'WORKER_NOT_REGISTERED: worker % is not registered', p_worker_id using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'status', j.status,
    'job_type', j.job_type, 'lease_expires_at', j.lease_expires_at)), '[]'::jsonb) into leases
    from tonde.jobs j where j.lease_owner = p_worker_id
      and j.status in ('leased','running','cancel_requested');
  return jsonb_build_object('worker_id', worker.worker_id, 'status', worker.status,
    'heartbeat_at', worker.heartbeat_at, 'active_leases', leases,
    'active_lease_count', jsonb_array_length(leases),
    'shutdown_advised', worker.status = 'draining',
    'meaning', case when worker.status = 'draining'
      then 'This worker should stop claiming, finish or release what it holds, then shut down.'
      else 'The worker registry considers this worker alive.' end);
end $$;

create function tonde.worker_release_leases(p_worker_id text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job_row tonde.jobs; released jsonb := '[]'::jsonb;
begin
  for job_row in select j.* from tonde.jobs j where j.lease_owner = p_worker_id
    and j.status in ('leased','running','cancel_requested') order by j.created_at for update skip locked
  loop
    released := released || tonde.job_release(job_row.id, p_worker_id, p_note);
  end loop;
  return jsonb_build_object('worker_id', p_worker_id, 'released', released,
    'released_count', jsonb_array_length(released), 'released_at', now(),
    'meaning', 'Every unfinished lease this worker held was handed back with its honest next state.');
end $$;

-- 16. Outbox API. Service-role only, except that domain triggers call it inside their transaction.
create function tonde.outbox_enqueue(target_workspace uuid, p_event_type text, p_resource_kind text,
  p_resource_id uuid, p_dedupe_key text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare event_id uuid; existing uuid;
begin
  if p_event_type is null or length(btrim(p_event_type)) < 3 then
    raise exception 'An outbox event needs an event type' using errcode = '22023';
  end if;
  if p_dedupe_key is null or length(p_dedupe_key) < 8 or length(p_dedupe_key) > 300 then
    raise exception 'An outbox dedupe key is 8 to 300 characters' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'An outbox payload is a JSON object' using errcode = '22023';
  end if;
  insert into tonde.outbox_events(workspace_id, event_type, resource_kind, resource_id, dedupe_key, payload)
  values (target_workspace, btrim(p_event_type), btrim(p_resource_kind), p_resource_id, p_dedupe_key, p_payload)
  on conflict (workspace_id, dedupe_key) do nothing
  returning id into event_id;
  if event_id is null then
    select e.id into existing from tonde.outbox_events e
      where e.workspace_id = target_workspace and e.dedupe_key = p_dedupe_key;
    return jsonb_build_object('event_id', existing, 'idempotent', true, 'state',
      (select e.state from tonde.outbox_events e where e.id = existing),
      'meaning', 'This event was already recorded; the durable work request is the one that already exists.');
  end if;
  return jsonb_build_object('event_id', event_id, 'idempotent', false, 'state', 'pending',
    'event_type', btrim(p_event_type), 'resource_kind', btrim(p_resource_kind),
    'resource_id', p_resource_id,
    'meaning', 'The event and the domain change it describes commit together.');
end $$;

create function tonde.outbox_claim(p_worker text, p_limit integer default 25, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare event_row tonde.outbox_events; claimed jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'An outbox claim takes between 1 and 100 events' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'An outbox lease is between 30 seconds and one hour' using errcode = '22023';
  end if;
  for event_row in
    select e.* from tonde.outbox_events e
      where (e.state = 'pending' and e.available_at <= now())
         or (e.state = 'processing' and e.lease_expires_at is not null and e.lease_expires_at <= now())
      order by e.available_at, e.created_at
      for update skip locked
      limit p_limit
  loop
    update tonde.outbox_events set state = 'processing', lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds), attempts = event_row.attempts + 1,
      last_attempt_at = now()
      where id = event_row.id returning * into event_row;
    claimed := claimed || jsonb_build_object('event_id', event_row.id, 'workspace_id', event_row.workspace_id,
      'event_type', event_row.event_type, 'resource_kind', event_row.resource_kind,
      'resource_id', event_row.resource_id, 'payload', event_row.payload,
      'payload_version', event_row.payload_version, 'attempt', event_row.attempts,
      'max_attempts', event_row.max_attempts, 'dedupe_key', event_row.dedupe_key);
  end loop;
  return jsonb_build_object('worker', p_worker, 'claimed', claimed,
    'count', jsonb_array_length(claimed), 'claimed_at', now());
end $$;

create function tonde.outbox_deliver(target_event uuid, p_worker text, p_job_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare event_row tonde.outbox_events;
begin
  select * into event_row from tonde.outbox_events e where e.id = target_event for update;
  if not found then raise exception 'That outbox event does not exist' using errcode = 'P0002'; end if;
  if event_row.state = 'delivered' then
    return jsonb_build_object('event_id', target_event, 'state', 'delivered', 'idempotent', true,
      'job_id', event_row.job_id,
      'meaning', 'This event was already delivered; nothing was queued twice.');
  end if;
  if event_row.lease_owner is distinct from p_worker then
    raise exception 'OUTBOX_LEASE_NOT_OWNED: worker % does not hold this outbox lease', p_worker
      using errcode = '42501';
  end if;
  if p_job_id is not null and not exists (select 1 from tonde.jobs j
    where j.workspace_id = event_row.workspace_id and j.id = p_job_id) then
    raise exception 'That job is not part of this workspace' using errcode = '22023';
  end if;
  update tonde.outbox_events set state = 'delivered', delivered_at = now(), processed_at = now(),
    job_id = p_job_id, lease_owner = null, lease_expires_at = null
    where id = target_event returning * into event_row;
  return jsonb_build_object('event_id', target_event, 'state', 'delivered', 'idempotent', false,
    'job_id', event_row.job_id, 'delivered_at', event_row.delivered_at,
    'meaning', 'The durable work request exists; this event will not be processed again.');
end $$;

create function tonde.outbox_skip(target_event uuid, p_worker text, p_reason_code text,
  p_reason_message text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare event_row tonde.outbox_events;
begin
  select * into event_row from tonde.outbox_events e where e.id = target_event for update;
  if not found then raise exception 'That outbox event does not exist' using errcode = 'P0002'; end if;
  if event_row.state = 'skipped' then
    return jsonb_build_object('event_id', target_event, 'state', 'skipped', 'idempotent', true,
      'reason_code', event_row.last_error_code);
  end if;
  if event_row.lease_owner is distinct from p_worker then
    raise exception 'OUTBOX_LEASE_NOT_OWNED: worker % does not hold this outbox lease', p_worker
      using errcode = '42501';
  end if;
  update tonde.outbox_events set state = 'skipped', processed_at = now(), lease_owner = null,
    lease_expires_at = null, last_error_code = left(coalesce(p_reason_code, 'NOT_APPLICABLE'), 120),
    last_error_message = left(coalesce(p_reason_message, ''), 2000)
    where id = target_event returning * into event_row;
  return jsonb_build_object('event_id', target_event, 'state', 'skipped', 'idempotent', false,
    'reason_code', event_row.last_error_code, 'reason_message', event_row.last_error_message,
    'meaning', 'There is nothing to execute for this event and the reason is recorded; it is not silently dropped.');
end $$;

create function tonde.outbox_fail(target_event uuid, p_worker text, p_error_code text, p_error_message text,
  p_retriable boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare event_row tonde.outbox_events; next_state text; backoff interval;
begin
  select * into event_row from tonde.outbox_events e where e.id = target_event for update;
  if not found then raise exception 'That outbox event does not exist' using errcode = 'P0002'; end if;
  if event_row.state in ('delivered','skipped') then
    return jsonb_build_object('event_id', target_event, 'state', event_row.state, 'idempotent', true);
  end if;
  if event_row.lease_owner is distinct from p_worker then
    raise exception 'OUTBOX_LEASE_NOT_OWNED: worker % does not hold this outbox lease', p_worker
      using errcode = '42501';
  end if;
  backoff := tonde_private.job_retry_backoff(target_event, event_row.attempts, null, 15, 600);
  next_state := case when p_retriable and event_row.attempts < event_row.max_attempts
    then 'pending' else 'failed' end;
  update tonde.outbox_events set state = next_state,
    available_at = case when next_state = 'pending' then now() + backoff else available_at end,
    processed_at = case when next_state = 'failed' then now() else processed_at end,
    lease_owner = null, lease_expires_at = null,
    last_error_code = left(coalesce(p_error_code, ''), 120),
    last_error_message = left(coalesce(p_error_message, ''), 2000)
    where id = target_event returning * into event_row;
  return jsonb_build_object('event_id', target_event, 'state', next_state, 'attempts', event_row.attempts,
    'max_attempts', event_row.max_attempts, 'retriable', p_retriable,
    'available_at', event_row.available_at, 'last_error_code', event_row.last_error_code,
    'meaning', case when next_state = 'pending'
      then 'The event is still pending and will be attempted again; nothing was lost.'
      else 'The event could not be delivered and is preserved as failed with its cause.' end);
end $$;

create function tonde.outbox_reprocess(target_event uuid, p_actor text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare event_row tonde.outbox_events;
begin
  select * into event_row from tonde.outbox_events e where e.id = target_event for update;
  if not found then raise exception 'That outbox event does not exist' using errcode = 'P0002'; end if;
  if event_row.state <> 'failed' then
    raise exception 'OUTBOX_NOT_FAILED: this event is % and does not need reprocessing', event_row.state
      using errcode = 'PT409';
  end if;
  update tonde.outbox_events set state = 'pending', available_at = now(), attempts = 0, processed_at = null,
    last_error_message = concat(last_error_message, case when coalesce(p_note, '') = '' then ''
      else ' | reprocessed by ' || left(p_note, 200) end)
    where id = target_event returning * into event_row;
  return jsonb_build_object('event_id', target_event, 'state', 'pending', 'attempts', 0,
    'actor', left(coalesce(p_actor, 'operator'), 120),
    'meaning', 'The failed event is pending again. Delivery stays idempotent through the dedupe key.');
end $$;

-- The domain trigger that makes the outbox guarantee real for publishing: recording a creator's
-- publishing authorization and recording the asynchronous work it requires are one transaction.
create function tonde_private.publication_authorization_outbox() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.decision = 'authorize' then
    perform tonde.outbox_enqueue(new.workspace_id, 'publication.authorized', 'publication',
      new.publication_id, 'publication.authorized:' || new.id::text,
      jsonb_build_object('publication_id', new.publication_id, 'production_id', new.production_id,
        'authorization_id', new.id, 'destination_provider', new.destination_provider,
        'destination_account_id', new.destination_account_id, 'media_id', new.media_id,
        'production_revision', new.production_revision, 'result_revision', new.result_revision));
  end if;
  return new;
end $$;
revoke all on function tonde_private.publication_authorization_outbox()
  from public, anon, authenticated, service_role;
create trigger publication_authorization_outbox after insert on tonde.publication_authorizations
  for each row execute function tonde_private.publication_authorization_outbox();

-- 17. Reading state. A workspace member can see what is happening; nobody can move a job by hand.
create function tonde.job_status(target_workspace uuid, target_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tonde.jobs; definition tonde.job_type_definitions; events jsonb;
  by_service boolean := (select auth.role()) = 'service_role';
begin
  if not by_service and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into job from tonde.jobs j where j.workspace_id = target_workspace and j.id = target_job;
  if not found then raise exception 'That job does not exist in this workspace' using errcode = 'P0002'; end if;
  select * into definition from tonde.job_type_definitions d where d.job_type = job.job_type;
  select coalesce(jsonb_agg(jsonb_build_object('event_type', e.event_type, 'actor_kind', e.actor_kind,
    'from_status', e.from_status, 'to_status', e.to_status, 'detail', e.detail,
    'created_at', e.created_at) order by e.created_at desc, e.id desc), '[]'::jsonb) into events
    from (select * from tonde.job_events ev where ev.workspace_id = target_workspace
      and ev.job_id = target_job order by ev.created_at desc, ev.id desc limit 50) e;
  return jsonb_build_object('job_id', job.id, 'workspace_id', job.workspace_id,
    'production_id', job.production_id, 'job_type', job.job_type,
    'job_type_display_name', definition.display_name, 'worker_class', job.worker_class,
    'operation_id', job.operation_id, 'idempotency_key', job.idempotency_key,
    'payload', job.input_metadata, 'payload_version', job.payload_version,
    'status', job.status, 'progress', job.progress, 'priority', job.priority,
    'attempts', job.attempts, 'max_attempts', job.max_attempts, 'requeue_count', job.requeue_count,
    'available_at', job.available_at, 'created_at', job.created_at, 'started_at', job.started_at,
    'completed_at', job.completed_at, 'failed_at', job.failed_at, 'cancelled_at', job.cancelled_at,
    'timed_out_at', job.timed_out_at, 'dead_lettered_at', job.dead_lettered_at,
    'dead_letter_reason', job.dead_letter_reason, 'deadline_at', job.deadline_at,
    'lease_owner', case when by_service then job.lease_owner else null end,
    'lease_expires_at', case when by_service then job.lease_expires_at else null end,
    'error_code', job.error_code, 'error_message', job.error_message,
    'failure_classification', job.failure_classification, 'retry_policy', job.retry_policy,
    'termination_reason', job.termination_reason,
    'reconciliation_required', job.reconciliation_required,
    'result_reference', job.result_reference, 'result_metadata', job.result_metadata,
    'cancel_requested_at', job.cancel_requested_at, 'cancel_reason', job.cancel_reason,
    'cancellable', definition.cancellable and job.status not in
      ('succeeded','failed','cancelled','timed_out','dead_letter'),
    'externally_consequential', definition.externally_consequential,
    'cancellation_meaning', case when not definition.cancellable then 'This operation cannot be cancelled.'
      when definition.externally_consequential then 'Cancellation may not be possible once the destination has accepted the operation.'
      else 'Cancellation can be requested; the worker stops and confirms.' end,
    'events', events);
end $$;

create function tonde.job_list(target_workspace uuid, p_limit integer default 50, p_state text default null,
  p_job_type text default null, p_include_terminal boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare items jsonb;
begin
  if (select auth.role()) <> 'service_role'
    and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'A job list takes between 1 and 200 jobs' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'job_type', j.job_type,
    'status', j.status, 'progress', j.progress, 'attempts', j.attempts, 'max_attempts', j.max_attempts,
    'production_id', j.production_id, 'created_at', j.created_at, 'updated_at', j.updated_at,
    'completed_at', j.completed_at, 'error_code', j.error_code, 'error_message', j.error_message,
    'termination_reason', j.termination_reason, 'dead_letter_reason', j.dead_letter_reason,
    'reconciliation_required', j.reconciliation_required,
    'cancellable', (select d.cancellable from tonde.job_type_definitions d where d.job_type = j.job_type)
      and j.status not in ('succeeded','failed','cancelled','timed_out','dead_letter'),
    'job_type_display_name', (select d.display_name from tonde.job_type_definitions d
      where d.job_type = j.job_type)) order by j.created_at desc), '[]'::jsonb) into items
    from (select * from tonde.jobs jb where jb.workspace_id = target_workspace
      and (p_state is null or jb.status::text = p_state)
      and (p_job_type is null or jb.job_type = p_job_type)
      and (p_include_terminal or jb.status not in
        ('succeeded','failed','cancelled','timed_out','dead_letter'))
      order by jb.created_at desc limit p_limit) j;
  return jsonb_build_object('workspace_id', target_workspace, 'jobs', items,
    'count', jsonb_array_length(items), 'listed_at', now());
end $$;

create function tonde.job_workspace_summary(target_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job_counts jsonb; outbox_counts jsonb;
begin
  if (select auth.role()) <> 'service_role'
    and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(status, total), '{}'::jsonb) into job_counts
    from (select j.status::text as status, count(*) as total from tonde.jobs j
      where j.workspace_id = target_workspace group by 1) c;
  select coalesce(jsonb_object_agg(state, total), '{}'::jsonb) into outbox_counts
    from (select e.state as state, count(*) as total from tonde.outbox_events e
      where e.workspace_id = target_workspace group by 1) c;
  return jsonb_build_object('workspace_id', target_workspace, 'jobs_by_state', job_counts,
    'outbox_by_state', outbox_counts,
    'dead_letters', coalesce((job_counts ->> 'dead_letter')::bigint, 0),
    'needs_attention', coalesce((job_counts ->> 'dead_letter')::bigint, 0)
      + coalesce((job_counts ->> 'waiting')::bigint, 0)
      + coalesce((outbox_counts ->> 'failed')::bigint, 0),
    'summarized_at', now());
end $$;

-- 18. Operational metrics. Service-role only: these are infrastructure numbers, not tenant data.
create function tonde.job_metrics() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare by_type jsonb; by_state jsonb; lease_expiries bigint; outbox_backlog jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('job_type', job_type, 'total', total,
    'succeeded', succeeded, 'failed', failed, 'dead_letter', dead_letter, 'retrying', retrying,
    'waiting_for_reconciliation', awaiting, 'avg_duration_seconds', avg_duration,
    'max_duration_seconds', max_duration)), '[]'::jsonb) into by_type
    from (select j.job_type, count(*) as total,
        count(*) filter (where j.status = 'succeeded') as succeeded,
        count(*) filter (where j.status = 'failed') as failed,
        count(*) filter (where j.status = 'dead_letter') as dead_letter,
        count(*) filter (where j.status = 'retrying') as retrying,
        count(*) filter (where j.reconciliation_required) as awaiting,
        round(avg(extract(epoch from (j.completed_at - j.started_at)))
          filter (where j.completed_at is not null and j.started_at is not null), 2) as avg_duration,
        round(max(extract(epoch from (j.completed_at - j.started_at)))
          filter (where j.completed_at is not null and j.started_at is not null), 2) as max_duration
      from tonde.jobs j group by j.job_type) t;
  select coalesce(jsonb_object_agg(status, total), '{}'::jsonb) into by_state
    from (select j.status::text as status, count(*) as total from tonde.jobs j group by 1) c;
  select count(*) into lease_expiries from tonde.job_events e where e.event_type = 'lease_expired';
  select jsonb_build_object('pending', count(*) filter (where state = 'pending'),
    'processing', count(*) filter (where state = 'processing'),
    'delivered', count(*) filter (where state = 'delivered'),
    'skipped', count(*) filter (where state = 'skipped'),
    'failed', count(*) filter (where state = 'failed'),
    'oldest_pending_seconds', round(extract(epoch from (now() - min(available_at)
      filter (where state = 'pending'))), 0)) into outbox_backlog
    from tonde.outbox_events;
  return jsonb_build_object('jobs_by_type', by_type, 'jobs_by_state', by_state,
    'queue_depth', coalesce((by_state ->> 'queued')::bigint, 0)
      + coalesce((by_state ->> 'retrying')::bigint, 0) + coalesce((by_state ->> 'leased')::bigint, 0),
    'dead_letter_count', coalesce((by_state ->> 'dead_letter')::bigint, 0),
    'reconciliation_pending', coalesce((by_state ->> 'waiting')::bigint, 0),
    'lease_expiry_events', lease_expiries, 'outbox', outbox_backlog,
    'online_workers', (select count(*) from tonde.workers w where w.status = 'online'),
    'stale_workers', (select count(*) from tonde.workers w where w.status = 'online'
      and w.heartbeat_at < now() - interval '5 minutes'),
    'measured_at', now());
end $$;

-- 19. Function grants. Claiming, completing and every worker outcome are trusted-server APIs; a client
--     session can read its workspace's jobs and ask for cancellation, nothing more.
revoke all on function tonde.job_enqueue(uuid,text,uuid,jsonb,text,integer,uuid,uuid,integer)
  from public, anon, authenticated, service_role;
revoke all on function tonde.job_claim(text,text,integer,integer) from public, anon, authenticated, service_role;
revoke all on function tonde.job_start(uuid,text) from public, anon, authenticated, service_role;
revoke all on function tonde.job_heartbeat(uuid,text,integer) from public, anon, authenticated, service_role;
revoke all on function tonde.job_complete(uuid,text,jsonb,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.job_fail(uuid,text,text,text,text,integer,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.job_cancel_acknowledge(uuid,text,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.job_recover_expired_leases(integer,integer) from public, anon, authenticated, service_role;
revoke all on function tonde.job_timeout_scan(integer) from public, anon, authenticated, service_role;
revoke all on function tonde.job_reconcile(uuid,text,text,text,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function tonde.job_requeue(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.job_release(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.worker_register(text,text,text,text,text[]) from public, anon, authenticated, service_role;
revoke all on function tonde.worker_heartbeat(text,text,integer) from public, anon, authenticated, service_role;
revoke all on function tonde.worker_release_leases(text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.outbox_enqueue(uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function tonde.outbox_claim(text,integer,integer) from public, anon, authenticated, service_role;
revoke all on function tonde.outbox_deliver(uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.outbox_skip(uuid,text,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.outbox_fail(uuid,text,text,text,boolean) from public, anon, authenticated, service_role;
revoke all on function tonde.outbox_reprocess(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.job_status(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.job_list(uuid,integer,text,text,boolean) from public, anon, authenticated, service_role;
revoke all on function tonde.job_workspace_summary(uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.job_metrics() from public, anon, authenticated, service_role;

grant execute on function tonde.job_enqueue(uuid,text,uuid,jsonb,text,integer,uuid,uuid,integer) to service_role;
grant execute on function tonde.job_claim(text,text,integer,integer) to service_role;
grant execute on function tonde.job_start(uuid,text) to service_role;
grant execute on function tonde.job_heartbeat(uuid,text,integer) to service_role;
grant execute on function tonde.job_complete(uuid,text,jsonb,text,text) to service_role;
grant execute on function tonde.job_fail(uuid,text,text,text,text,integer,text,text) to service_role;
grant execute on function tonde.job_cancel_acknowledge(uuid,text,text,text) to service_role;
grant execute on function tonde.job_recover_expired_leases(integer,integer) to service_role;
grant execute on function tonde.job_timeout_scan(integer) to service_role;
grant execute on function tonde.job_reconcile(uuid,text,text,text,jsonb,text) to service_role;
grant execute on function tonde.job_requeue(uuid,text,text) to service_role;
grant execute on function tonde.job_release(uuid,text,text) to service_role;
grant execute on function tonde.worker_register(text,text,text,text,text[]) to service_role;
grant execute on function tonde.worker_heartbeat(text,text,integer) to service_role;
grant execute on function tonde.worker_release_leases(text,text) to service_role;
grant execute on function tonde.outbox_enqueue(uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function tonde.outbox_claim(text,integer,integer) to service_role;
grant execute on function tonde.outbox_deliver(uuid,text,uuid) to service_role;
grant execute on function tonde.outbox_skip(uuid,text,text,text) to service_role;
grant execute on function tonde.outbox_fail(uuid,text,text,text,boolean) to service_role;
grant execute on function tonde.outbox_reprocess(uuid,text,text) to service_role;
grant execute on function tonde.job_metrics() to service_role;
grant execute on function tonde.job_cancel_request(uuid,uuid,text) to authenticated, service_role;
grant execute on function tonde.job_status(uuid,uuid) to authenticated, service_role;
grant execute on function tonde.job_list(uuid,integer,text,text,boolean) to authenticated, service_role;
grant execute on function tonde.job_workspace_summary(uuid) to authenticated, service_role;

alter default privileges in schema tonde revoke execute on functions from public;
commit;
