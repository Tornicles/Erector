-- Prompt 10 packet 032 — publishing (§15–23). Version-pinned publications, a DISTINCT human
-- publication authorization, an adapter boundary, normalized failure categories, idempotent
-- submission, remote-resource tracking and honest reconciliation of an unknown destination state.
--
-- Forward-only and additive on the seams that already exist: migration 001 (productions, results,
-- media_files, jobs, exports) and packet 031 (provider registry, capabilities, connections).
--
-- Laws enforced here, not merely described:
--   * A publication pins the exact Production revision, Result revision and media it will publish.
--   * Publishing is a consequential real-world action and requires its own recorded human
--     authorization — never a creative approval, never a service or AI decision.
--   * Submission is idempotent: one publication carries one operation id, one idempotency key and
--     one request fingerprint that every retry reuses, so a retry can never become a second post.
--   * SUBMITTING/SUBMITTED/PROCESSING/PUBLISHED/UNKNOWN_REMOTE_STATE require an authorization;
--     PUBLISHED additionally needs a remote resource and a confirmation time; FAILED needs a
--     normalized cause; an ambiguous provider answer becomes UNKNOWN_REMOTE_STATE and only leaves it
--     through a recorded reconciliation.
--   * One remote resource belongs to exactly one publication in a workspace: a duplicate post in
--     the real world is a bug, not a retry.
--   * Publication content is frozen from the first submission on. A draft that needs different
--     content is edited before it is submitted, and anything else is a new publication.
begin;

-- 1. Truthful vocabulary. Lowercase storage codes; the generated product vocabulary carries labels.
create type tonde.publication_state as enum
  ('draft','ready','awaiting_authorization','submitting','submitted','processing','published',
   'failed','cancelled','removed','unknown_remote_state');
-- Normalized failure categories: the provider's code stays in failure_code, the category is what
-- TONDE can honestly say to a creator.
create type tonde.publication_failure_category as enum
  ('authentication_failed','insufficient_scope','rate_limited','invalid_media','invalid_metadata',
   'provider_unavailable','quota_exceeded','remote_processing_failed','destination_rejected',
   'policy_violation','unknown');
create type tonde.publication_authorization_decision as enum ('authorize','withdraw');
create type tonde.publication_attempt_state as enum
  ('in_flight','accepted','processing','succeeded','failed','unknown');
create type tonde.publication_reconciliation_source as enum ('provider_api','provider_webhook','manual_operator');

-- 2. Publications. One row is one intended real-world placement of one exact artifact.
create table tonde.publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  -- The version context is pinned, not looked up later: history never drifts.
  production_revision integer not null check (production_revision > 0),
  result_id uuid not null,
  result_revision integer not null check (result_revision > 0),
  media_id uuid not null,
  media_checksum text not null default '' check (length(media_checksum) <= 200),
  destination_provider text not null references tonde.integration_providers(key) on delete restrict,
  destination_account_id uuid,
  destination text not null default '' check (length(destination) <= 300),
  destination_config jsonb not null default '{}'::jsonb check (jsonb_typeof(destination_config) = 'object'),
  media_type text not null default 'video' check (media_type in ('video','image','audio','document','text')),
  visibility text not null default 'private' check (visibility in ('private','unlisted','public','scheduled')),
  scheduled_for timestamptz,
  title text not null default '' check (length(title) <= 300),
  caption text not null default '' check (length(caption) <= 5000),
  state tonde.publication_state not null default 'draft',
  -- The effective (latest) authorization decision for this publication.
  authorization_id uuid,
  -- Idempotency identity: created once, reused by every attempt.
  operation_id uuid not null default gen_random_uuid(),
  idempotency_key text not null default gen_random_uuid()::text check (length(idempotency_key) between 8 and 200),
  submission_attempts integer not null default 0 check (submission_attempts >= 0),
  last_attempt_at timestamptz,
  submitted_at timestamptz,
  remote_resource_type text not null default '' check (length(remote_resource_type) <= 120),
  remote_resource_id text,
  remote_url text,
  remote_state text not null default '' check (length(remote_state) <= 200),
  last_checked_at timestamptz,
  published_at timestamptz,
  failed_at timestamptz,
  failure_category tonde.publication_failure_category,
  failure_code text check (length(failure_code) <= 120),
  failure_message text check (length(failure_message) <= 2000),
  cancelled_at timestamptz,
  removed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  constraint publication_schedule_matches_visibility check ((visibility = 'scheduled') = (scheduled_for is not null)),
  constraint publication_schedule_is_ahead check (scheduled_for is null or scheduled_for > created_at),
  -- Nothing leaves for a destination without a recorded human authorization naming this version.
  constraint publication_submission_requires_authorization check (
    state not in ('submitting','submitted','processing','published','unknown_remote_state') or authorization_id is not null),
  constraint publication_submission_records_when check (
    state not in ('submitting','submitted','processing','published','unknown_remote_state') or submitted_at is not null),
  constraint publication_published_has_remote_resource check (
    state <> 'published' or (remote_resource_id is not null and published_at is not null and last_checked_at is not null)),
  constraint publication_removed_records_when check (
    state <> 'removed' or (removed_at is not null and remote_resource_id is not null)),
  constraint publication_unknown_records_when check (state <> 'unknown_remote_state' or last_checked_at is not null),
  constraint publication_failed_records_cause check (
    state <> 'failed' or (failure_category is not null and failed_at is not null)),
  -- Failure details describe the CURRENT failure; the attempt history keeps the rest.
  constraint publication_failure_is_current check (
    state = 'failed' or (failure_category is null and failure_code is null and failure_message is null)),
  constraint publication_cancelled_records_when check (state <> 'cancelled' or cancelled_at is not null),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, result_id) references tonde.results(workspace_id, id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  foreign key (workspace_id, destination_account_id) references tonde.integration_connections(workspace_id, id) on delete restrict
);
create index publications_by_production on tonde.publications(workspace_id, production_id, created_at desc, id);
create index publications_by_state on tonde.publications(workspace_id, state, updated_at desc);
-- One remote resource belongs to exactly one publication: the same post cannot be claimed twice.
create unique index publication_remote_resource_is_unique
  on tonde.publications(workspace_id, destination_provider, remote_resource_id) where remote_resource_id is not null;

-- One fingerprint describes "exactly what would go out": the artifact, the framing text and the
-- destination settings. Authorization, submission and every retry read this SAME value, so a change
-- after authorization cannot ride an older approval and a retry cannot look like new work.
create function tonde_private.publication_fingerprint(target_workspace uuid, target_publication uuid)
returns text language sql stable security definer set search_path = '' as $$
  select md5(concat_ws('|', p.media_id::text, p.media_checksum, p.media_type, p.title, p.caption,
    p.destination_provider, coalesce(p.destination_account_id::text, ''), p.destination, p.visibility,
    coalesce(p.scheduled_for::text, ''), p.destination_config::text))
  from tonde.publications p where p.workspace_id = target_workspace and p.id = target_publication;
$$;
revoke all on function tonde_private.publication_fingerprint(uuid,uuid) from public, anon, authenticated, service_role;

-- The state machine, the content freeze and the no-secrets rule live in the database so no caller
-- can produce a state that did not happen.
create function tonde_private.guard_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
declare allowed text[]; key_name text;
begin
  -- A provider definition may not carry secrets; neither may a publication's destination settings.
  for key_name in select jsonb_object_keys(new.destination_config) loop
    if key_name ~* '(secret|token|password|credential|api[_-]?key|private[_-]?key|client[_-]?secret|refresh)' then
      raise exception 'Publication settings must not contain secrets; credentials live in the private store'
        using errcode = '23514';
    end if;
  end loop;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then
      raise exception 'A publication begins as a draft; its states record what actually happened'
        using errcode = '23514';
    end if;
    return new;
  end if;
  -- Content that has already been submitted is frozen. Retries reuse the same fingerprint, and a
  -- different post is a different publication.
  if old.submission_attempts > 0 and
    (new.production_revision, new.result_id, new.result_revision, new.media_id, new.media_checksum,
     new.destination_provider, new.destination_account_id, new.destination, new.destination_config,
     new.media_type, new.visibility, new.scheduled_for, new.title, new.caption,
     new.operation_id, new.idempotency_key)
    is distinct from
    (old.production_revision, old.result_id, old.result_revision, old.media_id, old.media_checksum,
     old.destination_provider, old.destination_account_id, old.destination, old.destination_config,
     old.media_type, old.visibility, old.scheduled_for, old.title, old.caption,
     old.operation_id, old.idempotency_key) then
    raise exception 'This publication already names the exact content it submitted; change it before submitting or publish something else as a new publication'
      using errcode = '23514';
  end if;
  if new.state = old.state then return new; end if;
  allowed := case old.state
    when 'draft' then array['ready','awaiting_authorization','cancelled']
    when 'ready' then array['draft','awaiting_authorization','submitting','cancelled']
    when 'awaiting_authorization' then array['ready','draft','cancelled']
    when 'submitting' then array['submitted','processing','published','failed','unknown_remote_state']
    when 'submitted' then array['processing','published','failed','unknown_remote_state','cancelled']
    when 'processing' then array['published','failed','unknown_remote_state']
    when 'published' then array['removed','unknown_remote_state']
    when 'failed' then array['ready','awaiting_authorization','cancelled']
    when 'unknown_remote_state' then array['published','removed','failed','processing']
    else array[]::text[] end;
  if not (new.state::text = any(allowed)) then
    raise exception 'A publication in % cannot become %; that transition did not happen', old.state, new.state
      using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_publication() from public, anon, authenticated, service_role;
create trigger guard_publication before insert or update on tonde.publications
  for each row execute function tonde_private.guard_publication();
create trigger guard_mutation before insert or update on tonde.publications
  for each row execute function tonde_private.guard_mutation();

-- 3. Publication authorizations. Append-only, human-only, and naming exactly what was authorized:
--    who, what publication, which Production/Result revision and media, which destination, when.
create table tonde.publication_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  publication_id uuid not null,
  decision tonde.publication_authorization_decision not null,
  production_revision integer not null check (production_revision > 0),
  result_id uuid not null,
  result_revision integer not null check (result_revision > 0),
  media_id uuid not null,
  media_checksum text not null default '' check (length(media_checksum) <= 200),
  -- The exact content fingerprint the creator authorized (title, caption, settings included).
  request_fingerprint text not null check (length(request_fingerprint) between 16 and 200),
  destination_provider text not null,
  destination_account_id uuid,
  destination text not null default '' check (length(destination) <= 300),
  note text not null default '' check (length(note) <= 800),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  authorized_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, publication_id) references tonde.publications(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);
create index publication_authorizations_by_publication
  on tonde.publication_authorizations(workspace_id, publication_id, authorized_at desc, id);

create function tonde_private.guard_publication_authorization() returns trigger
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications;
begin
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
create trigger guard_publication_authorization before insert or update or delete on tonde.publication_authorizations
  for each row execute function tonde_private.guard_publication_authorization();
alter table tonde.publications add constraint publication_effective_authorization
  foreign key (workspace_id, authorization_id) references tonde.publication_authorizations(workspace_id, id) on delete restrict;

-- 4. Submission attempts. Every attempt of one publication reuses the same operation id, idempotency
--    key and request fingerprint, so a retry can never become a duplicate real-world action.
create table tonde.publication_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  publication_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  operation_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  request_fingerprint text not null check (length(request_fingerprint) between 16 and 200),
  state tonde.publication_attempt_state not null default 'in_flight',
  remote_resource_id text,
  remote_url text,
  remote_state text not null default '' check (length(remote_state) <= 200),
  failure_category tonde.publication_failure_category,
  failure_code text check (length(failure_code) <= 120),
  failure_message text check (length(failure_message) <= 2000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workspace_id, id),
  unique (publication_id, attempt_number),
  foreign key (workspace_id, publication_id) references tonde.publications(workspace_id, id) on delete restrict
);
create index publication_attempts_by_publication
  on tonde.publication_attempts(workspace_id, publication_id, attempt_number desc);

create function tonde_private.guard_publication_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; first_attempt tonde.publication_attempts; next_number integer;
begin
  if tg_op = 'DELETE' then
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
create trigger guard_publication_attempt before insert or update or delete on tonde.publication_attempts
  for each row execute function tonde_private.guard_publication_attempt();

-- 5. Reconciliation. What the destination actually shows, recorded as it was observed, with its
--    source. This is how UNKNOWN_REMOTE_STATE leaves the unknown honestly.
create table tonde.publication_reconciliations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  publication_id uuid not null,
  observed_state tonde.publication_state not null
    check (observed_state in ('published','processing','removed','failed','unknown_remote_state')),
  remote_state text not null default '' check (length(remote_state) <= 200),
  remote_resource_id text,
  source tonde.publication_reconciliation_source not null,
  note text not null default '' check (length(note) <= 800),
  actor_user_id uuid references auth.users(id) on delete set null,
  observed_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, publication_id) references tonde.publications(workspace_id, id) on delete restrict
);
create index publication_reconciliations_by_publication
  on tonde.publication_reconciliations(workspace_id, publication_id, observed_at desc, id);

create function tonde_private.guard_publication_reconciliation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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
create trigger guard_publication_reconciliation before insert or update or delete on tonde.publication_reconciliations
  for each row execute function tonde_private.guard_publication_reconciliation();

-- 5b. Consequential actions are audited as semantic events — who, what, which version/destination,
--     when — with no secrets in the payload. This is the Prompt 10 audit trail for integration and
--     publishing operations (export/billing events are added by their own packets).
create function tonde_private.audit_event(target_workspace uuid, event_name text, target_object uuid,
  kind text, payload jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into tonde.audit_events(workspace_id, actor_user_id, event_type, object_id, object_kind, metadata)
  values (target_workspace, auth.uid(), event_name, target_object, kind, coalesce(payload, '{}'::jsonb));
$$;
revoke all on function tonde_private.audit_event(uuid,text,uuid,text,jsonb)
  from public, anon, authenticated, service_role;

-- A provider connection changing state is a real event: connecting and disconnecting are audited
-- with the account label and granted scopes, never with tokens.
create function tonde_private.audit_integration_connection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'connected' and old.status is distinct from 'connected' then
    perform tonde_private.audit_event(new.workspace_id, 'provider.connected', new.id,
      'integration_connection', jsonb_build_object('provider', new.provider,
        'account', new.external_account_label, 'scopes', to_jsonb(new.scopes)));
  elsif new.status in ('revoked','disabled') and old.status is distinct from new.status then
    perform tonde_private.audit_event(new.workspace_id, 'provider.disconnected', new.id,
      'integration_connection', jsonb_build_object('provider', new.provider, 'status', new.status));
  elsif new.status in ('reauth_required','expired','error') and old.status is distinct from new.status then
    perform tonde_private.audit_event(new.workspace_id, 'provider.needs_attention', new.id,
      'integration_connection', jsonb_build_object('provider', new.provider, 'status', new.status,
        'error_code', new.last_error_code));
  end if;
  return new;
end $$;
revoke all on function tonde_private.audit_integration_connection()
  from public, anon, authenticated, service_role;
create trigger audit_integration_connection after insert or update on tonde.integration_connections
  for each row execute function tonde_private.audit_integration_connection();

-- 6. Capability evaluation, factored so both the client-facing answer and the server-side submission
--    path read the SAME rules. 031 created tonde.integration_capability_state; this forward
--    migration replaces its body with a call to the shared helper instead of duplicating the logic.
create function tonde_private.integration_capability_reason(target_workspace uuid, target_provider text,
  target_capability text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare provider tonde.integration_providers; capability tonde.integration_provider_capabilities;
  connection tonde.integration_connections; missing text[];
begin
  select * into provider from tonde.integration_providers p where p.key = target_provider;
  if not found then return 'UNKNOWN_PROVIDER'; end if;
  if not provider.enabled or provider.adapter_state <> 'verified' then return 'PROVIDER_NOT_IMPLEMENTED'; end if;
  select * into capability from tonde.integration_provider_capabilities c
    where c.provider_key = target_provider and c.capability_key = target_capability;
  if not found then return 'UNKNOWN_CAPABILITY'; end if;
  if not capability.enabled then return 'CAPABILITY_DISABLED'; end if;
  if not capability.connection_required then return 'AVAILABLE'; end if;
  -- A workspace may hold several accounts for one provider; the connected one is the evidence that
  -- counts, chosen deterministically rather than by storage order.
  select * into connection from tonde.integration_connections c
    where c.workspace_id = target_workspace and c.provider = target_provider
    order by (c.status = 'connected') desc, c.verified_at desc nulls last, c.created_at desc
    limit 1;
  if not found or connection.status <> 'connected' then return 'CONNECTION_NOT_READY'; end if;
  missing := array(select s from unnest(capability.required_scopes) s where not (s = any(connection.scopes)));
  if array_length(missing, 1) is not null then return 'MISSING_SCOPE'; end if;
  return 'AVAILABLE';
end $$;
revoke all on function tonde_private.integration_capability_reason(uuid,text,text) from public, anon, authenticated, service_role;

create or replace function tonde.integration_capability_state(target_workspace uuid, target_provider text,
  target_capability text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  -- 010 relocated the policy helpers into tonde_private; call the helper where it actually lives.
  if not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  return tonde_private.integration_capability_reason(target_workspace, target_provider, target_capability);
end $$;

-- 7. Creator actions. Each one records exactly what the creator decided; none of them contacts a
--    provider. Content is set when the publication is created (or edited while still unsubmitted);
--    the destination provider and account are chosen once and are never silently retargeted.

create function tonde.publication_create(target_workspace uuid, target_production uuid, target_result uuid,
  target_provider text, target_media uuid default null, target_destination text default '',
  target_account uuid default null, target_title text default '', target_caption text default '',
  target_visibility text default 'private', target_scheduled_for timestamptz default null,
  target_config jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare production tonde.productions; result_row tonde.results; media tonde.media_files;
  new_id uuid; category text;
begin
  if not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into production from tonde.productions p
    where p.workspace_id = target_workspace and p.id = target_production and p.lifecycle = 'active';
  if not found then raise exception 'That Production is not available for publishing' using errcode = 'P0002'; end if;
  select * into result_row from tonde.results r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.id = target_result;
  if not found then raise exception 'That Result is not available in this Production' using errcode = 'P0002'; end if;
  select * into media from tonde.media_files m
    where m.workspace_id = target_workspace and m.id = coalesce(target_media, result_row.media_id);
  if not found then raise exception 'That media file is not available in this workspace' using errcode = 'P0002'; end if;
  if media.upload_state <> 'uploaded' then
    raise exception 'Only an uploaded media file can be published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from tonde.integration_providers p where p.key = target_provider) then
    raise exception 'That destination provider is not registered' using errcode = '22023';
  end if;
  if target_account is not null and not exists (select 1 from tonde.integration_connections c
    where c.workspace_id = target_workspace and c.id = target_account and c.provider = target_provider) then
    raise exception 'That destination account is not connected to this provider' using errcode = '22023';
  end if;
  if target_visibility not in ('private','unlisted','public','scheduled') then
    raise exception 'Visibility is private, unlisted, public or scheduled' using errcode = '22023';
  end if;
  if target_visibility = 'scheduled' and (target_scheduled_for is null or target_scheduled_for <= now()) then
    raise exception 'A scheduled publication needs a future time' using errcode = '22023';
  end if;
  if target_visibility <> 'scheduled' and target_scheduled_for is not null then
    raise exception 'Only a scheduled publication carries a scheduled time' using errcode = '22023';
  end if;
  category := case media.file_category when 'video' then 'video' when 'image' then 'image'
    when 'audio' then 'audio' else 'document' end;
  insert into tonde.publications(workspace_id, production_id, production_revision, result_id, result_revision,
    media_id, media_checksum, destination_provider, destination_account_id, destination, destination_config,
    media_type, visibility, scheduled_for, title, caption, created_by)
  values (target_workspace, target_production, production.revision, target_result, result_row.revision,
    media.id, coalesce(media.checksum, ''), target_provider, target_account,
    left(coalesce(target_destination, ''), 300), coalesce(target_config, '{}'::jsonb),
    category, target_visibility, target_scheduled_for,
    left(coalesce(target_title, ''), 300), left(coalesce(target_caption, ''), 5000), auth.uid())
  returning id into new_id;
  return jsonb_build_object('publication_id', new_id, 'state', 'draft',
    'production_id', target_production, 'production_revision', production.revision,
    'result_id', target_result, 'result_revision', result_row.revision,
    'media_id', media.id, 'media_checksum', coalesce(media.checksum, ''),
    'destination_provider', target_provider, 'destination_account_id', target_account,
    'destination', left(coalesce(target_destination, ''), 300),
    'visibility', target_visibility, 'scheduled_for', target_scheduled_for,
    'created_by', auth.uid(), 'created_at', now(),
    'note', 'Nothing was submitted. A creator must mark this ready and authorize this exact version and destination.');
end $$;

create function tonde.publication_update(target_workspace uuid, target_publication uuid, target_title text,
  target_caption text, target_destination text, target_config jsonb, target_visibility text,
  target_scheduled_for timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; state_after text;
begin
  if not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication for update;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  if publication.submission_attempts > 0 or publication.state not in ('draft','ready','awaiting_authorization') then
    raise exception 'A publication in % cannot be edited; publish the change as a new publication', publication.state
      using errcode = 'PT409';
  end if;
  if target_visibility not in ('private','unlisted','public','scheduled') then
    raise exception 'Visibility is private, unlisted, public or scheduled' using errcode = '22023';
  end if;
  if target_visibility = 'scheduled' and (target_scheduled_for is null or target_scheduled_for <= now()) then
    raise exception 'A scheduled publication needs a future time' using errcode = '22023';
  end if;
  if target_visibility <> 'scheduled' and target_scheduled_for is not null then
    raise exception 'Only a scheduled publication carries a scheduled time' using errcode = '22023';
  end if;
  update tonde.publications set title = left(coalesce(target_title, ''), 300),
    caption = left(coalesce(target_caption, ''), 5000),
    destination = left(coalesce(target_destination, ''), 300),
    destination_config = coalesce(target_config, '{}'::jsonb),
    visibility = target_visibility, scheduled_for = target_scheduled_for
  where workspace_id = target_workspace and id = target_publication;
  state_after := publication.state::text;
  -- An edit invalidates an authorization that named the previous content: the publication returns to
  -- waiting for authorization instead of still looking approved.
  if publication.state = 'ready' and publication.authorization_id is not null and exists (
    select 1 from tonde.publication_authorizations a where a.id = publication.authorization_id
      and a.decision = 'authorize'
      and a.request_fingerprint <> tonde_private.publication_fingerprint(target_workspace, target_publication)) then
    update tonde.publications set state = 'awaiting_authorization'
      where workspace_id = target_workspace and id = target_publication;
    state_after := 'awaiting_authorization';
  end if;
  return jsonb_build_object('publication_id', target_publication, 'state', state_after,
    'title', left(coalesce(target_title, ''), 300), 'destination', left(coalesce(target_destination, ''), 300),
    'visibility', target_visibility, 'scheduled_for', target_scheduled_for, 'edited_at', now(),
    'note', case when state_after = 'awaiting_authorization'
      then 'The earlier authorization named different content and is refused at submission; a creator must authorize this version again.'
      else 'Nothing was submitted.' end);
end $$;

create function tonde.publication_set_state(target_workspace uuid, target_publication uuid, desired text,
  note_text text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; allowed text[]; from_state text;
begin
  if not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication for update;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  from_state := publication.state::text;
  allowed := case from_state
    when 'draft' then array['ready','awaiting_authorization','cancelled']
    when 'ready' then array['draft','awaiting_authorization','cancelled']
    when 'awaiting_authorization' then array['ready','draft','cancelled']
    when 'failed' then array['ready','awaiting_authorization','cancelled']
    when 'published' then array['removed']
    else array[]::text[] end;
  if not (desired = any(allowed)) then
    raise exception 'A creator action cannot move a publication from % to %; destination outcomes are recorded by the provider path',
      from_state, desired using errcode = 'PT409';
  end if;
  update tonde.publications set state = desired::tonde.publication_state,
    cancelled_at = case when desired = 'cancelled' then now() else cancelled_at end,
    removed_at = case when desired = 'removed' then now() else removed_at end,
    failed_at = case when desired = 'failed' then failed_at else null end,
    failure_category = case when desired = 'failed' then failure_category else null end,
    failure_code = case when desired = 'failed' then failure_code else null end,
    failure_message = case when desired = 'failed' then failure_message else null end
  where workspace_id = target_workspace and id = target_publication;
  perform tonde_private.audit_event(target_workspace,
    case desired when 'cancelled' then 'publication.cancelled' when 'removed' then 'publication.removed'
      else 'publication.state_changed' end, target_publication, 'publication',
    jsonb_build_object('from', from_state, 'to', desired, 'actor_user_id', auth.uid()));
  return jsonb_build_object('publication_id', target_publication, 'previous_state', from_state,
    'state', desired, 'note', left(coalesce(note_text, ''), 800), 'actor_user_id', auth.uid(), 'changed_at', now(),
    'meaning', case desired
      when 'ready' then 'This exact version may be submitted.'
      when 'awaiting_authorization' then 'This publication is waiting for a creator to authorize it.'
      when 'draft' then 'This publication is back to draft and is not ready to submit.'
      when 'cancelled' then 'This publication was cancelled and was never submitted.'
      else 'This publication was removed from its destination.' end);
end $$;

create function tonde.publication_authorize(target_workspace uuid, target_publication uuid, decision text,
  note_text text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; authorization_row uuid; state_after tonde.publication_state;
begin
  if not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if decision not in ('authorize','withdraw') then
    raise exception 'A publication authorization decision is authorize or withdraw' using errcode = '22023';
  end if;
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication for update;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  if publication.state not in ('draft','ready','awaiting_authorization','failed') then
    raise exception 'A publication in % cannot be % by a creator decision', publication.state, decision
      using errcode = 'PT409';
  end if;
  -- The database copies the pins server-side, so the recorded authorization always names what the
  -- publication actually holds; the guard then refuses any mismatch.
  insert into tonde.publication_authorizations(workspace_id, production_id, publication_id, decision,
    production_revision, result_id, result_revision, media_id, media_checksum, request_fingerprint,
    destination_provider, destination_account_id, destination, note, actor_user_id)
  values (target_workspace, publication.production_id, target_publication,
    decision::tonde.publication_authorization_decision, publication.production_revision, publication.result_id,
    publication.result_revision, publication.media_id, publication.media_checksum,
    tonde_private.publication_fingerprint(target_workspace, target_publication),
    publication.destination_provider, publication.destination_account_id, publication.destination,
    left(coalesce(note_text, ''), 800), auth.uid())
  returning id into authorization_row;
  state_after := publication.state;
  if decision = 'authorize' and publication.state = 'awaiting_authorization' then state_after := 'ready'; end if;
  update tonde.publications set authorization_id = authorization_row, state = state_after
    where workspace_id = target_workspace and id = target_publication;
  perform tonde_private.audit_event(target_workspace,
    case when decision = 'authorize' then 'publication.authorized' else 'publication.authorization_withdrawn' end,
    target_publication, 'publication',
    jsonb_build_object('authorization_id', authorization_row, 'decision', decision,
      'production_revision', publication.production_revision, 'result_revision', publication.result_revision,
      'media_id', publication.media_id, 'destination_provider', publication.destination_provider,
      'destination', publication.destination, 'actor_user_id', auth.uid()));
  return jsonb_build_object('publication_id', target_publication, 'authorization_id', authorization_row,
    'decision', decision, 'state', state_after, 'actor_user_id', auth.uid(), 'authorized_at', now(),
    'authorized_version', jsonb_build_object('production_revision', publication.production_revision,
      'result_id', publication.result_id, 'result_revision', publication.result_revision,
      'media_id', publication.media_id, 'media_checksum', publication.media_checksum),
    'destination', jsonb_build_object('provider', publication.destination_provider,
      'account_id', publication.destination_account_id, 'target', publication.destination),
    'note', left(coalesce(note_text, ''), 800),
    'meaning', case when decision = 'authorize'
      then 'A creator authorized publishing this exact version to this exact destination.'
      else 'A creator withdrew the authorization; nothing may be submitted until a new one is recorded.' end);
end $$;

-- 8. Submission. Service-role only: the trusted server records the outbound attempt after the
--    creator action. It performs no provider call itself and never claims one succeeded.
create function tonde.publication_submit(target_workspace uuid, target_publication uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; authorization_row tonde.publication_authorizations;
  production tonde.productions; result_row tonde.results; capability text; fingerprint text;
  attempt uuid; attempt_number integer;
begin
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication for update;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  if publication.state <> 'ready' then
    raise exception 'A publication is submitted from READY; this one is %', publication.state using errcode = 'PT409';
  end if;
  if exists (select 1 from tonde.publication_attempts a
    where a.publication_id = target_publication and a.state = 'in_flight') then
    raise exception 'This publication has a submission attempt still in flight; record its outcome first'
      using errcode = 'PT409';
  end if;
  select * into authorization_row from tonde.publication_authorizations a where a.id = publication.authorization_id;
  if not found or authorization_row.decision <> 'authorize' then
    raise exception 'PUBLICATION_AUTHORIZATION_REQUIRED: a creator must authorize this exact version and destination before it can be published'
      using errcode = 'PT409';
  end if;
  if authorization_row.production_revision <> publication.production_revision
    or authorization_row.result_id <> publication.result_id
    or authorization_row.result_revision <> publication.result_revision
    or authorization_row.media_id <> publication.media_id
    or authorization_row.media_checksum <> publication.media_checksum
    or authorization_row.destination_provider <> publication.destination_provider
    or authorization_row.destination_account_id is distinct from publication.destination_account_id
    or authorization_row.destination <> publication.destination
    or authorization_row.request_fingerprint <> tonde_private.publication_fingerprint(target_workspace, target_publication) then
    raise exception 'The recorded authorization names different content, version or destination; authorize this exact publication again'
      using errcode = 'PT409';
  end if;
  select * into production from tonde.productions p
    where p.workspace_id = target_workspace and p.id = publication.production_id and p.lifecycle = 'active';
  if not found then raise exception 'That Production is no longer active' using errcode = 'PT409'; end if;
  -- The pinned artifact must still be the artifact: a publication never silently publishes newer work.
  select * into result_row from tonde.results r
    where r.workspace_id = target_workspace and r.id = publication.result_id;
  if not found or result_row.revision <> publication.result_revision
    or result_row.media_id <> publication.media_id then
    raise exception 'The Result changed since this publication was pinned; review the current version and authorize it again'
      using errcode = 'PT409';
  end if;
  capability := tonde_private.integration_capability_reason(target_workspace,
    publication.destination_provider, 'publish');
  if capability <> 'AVAILABLE' then
    raise exception 'Publishing is not available for this destination: %', capability using errcode = 'PT409';
  end if;
  -- The fingerprint is what a retry must reproduce. Every retry reuses the same operation id and
  -- idempotency key, so the provider can recognize a repeat instead of creating a second post.
  fingerprint := tonde_private.publication_fingerprint(target_workspace, target_publication);
  attempt_number := publication.submission_attempts + 1;
  insert into tonde.publication_attempts(workspace_id, publication_id, attempt_number, operation_id,
    idempotency_key, request_fingerprint)
  values (target_workspace, target_publication, attempt_number, publication.operation_id,
    publication.idempotency_key, fingerprint) returning id into attempt;
  update tonde.publications set state = 'submitting', submission_attempts = attempt_number,
    last_attempt_at = now(), submitted_at = coalesce(submitted_at, now()),
    failed_at = null, failure_category = null, failure_code = null, failure_message = null
  where workspace_id = target_workspace and id = target_publication;
  perform tonde_private.audit_event(target_workspace, 'publication.submitted', target_publication, 'publication',
    jsonb_build_object('attempt_number', attempt_number, 'operation_id', publication.operation_id,
      'destination_provider', publication.destination_provider, 'destination', publication.destination));
  return jsonb_build_object('publication_id', target_publication, 'attempt_id', attempt,
    'attempt_number', attempt_number, 'operation_id', publication.operation_id,
    'idempotency_key', publication.idempotency_key, 'request_fingerprint', fingerprint,
    'state', 'submitting', 'capability', capability,
    'destination', jsonb_build_object('provider', publication.destination_provider,
      'account_id', publication.destination_account_id, 'target', publication.destination),
    'payload', jsonb_build_object('media_id', publication.media_id, 'media_checksum', publication.media_checksum,
      'media_type', publication.media_type, 'title', publication.title, 'caption', publication.caption,
      'visibility', publication.visibility, 'scheduled_for', publication.scheduled_for,
      'settings', publication.destination_config),
    'note', 'No provider call has been made yet. The adapter performs it and records the outcome through publication_record_result.');
end $$;

-- 9. Provider outcome. The only path that can say a destination accepted, published or failed.
create function tonde.publication_record_result(target_workspace uuid, target_publication uuid,
  target_attempt uuid, target_outcome text, target_remote_resource_type text default '',
  target_remote_resource_id text default null, target_remote_url text default null,
  target_remote_state text default '', target_failure_category text default null,
  target_failure_code text default null, target_failure_message text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; attempt tonde.publication_attempts;
  new_state tonde.publication_state; new_attempt_state tonde.publication_attempt_state;
begin
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication for update;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  select * into attempt from tonde.publication_attempts a
    where a.workspace_id = target_workspace and a.publication_id = target_publication and a.id = target_attempt;
  if not found then raise exception 'That submission attempt does not belong to this publication' using errcode = 'P0002'; end if;
  if attempt.state <> 'in_flight' then
    raise exception 'Submission attempt % already recorded its outcome', attempt.attempt_number using errcode = 'PT409';
  end if;
  case target_outcome
    when 'accepted' then new_state := 'submitted'; new_attempt_state := 'accepted';
    when 'processing' then new_state := 'processing'; new_attempt_state := 'processing';
    when 'succeeded' then new_state := 'published'; new_attempt_state := 'succeeded';
    when 'failed' then new_state := 'failed'; new_attempt_state := 'failed';
    when 'unknown' then new_state := 'unknown_remote_state'; new_attempt_state := 'unknown';
    else raise exception 'A submission outcome is accepted, processing, succeeded, failed or unknown'
      using errcode = '22023';
  end case;
  if target_outcome = 'succeeded' and coalesce(btrim(target_remote_resource_id), '') = '' then
    raise exception 'A published publication records the remote resource the destination returned'
      using errcode = '23514';
  end if;
  if target_outcome = 'failed' and target_failure_category is null then
    raise exception 'A failed submission records a normalized failure category' using errcode = '22023';
  end if;
  update tonde.publication_attempts set state = new_attempt_state,
    remote_resource_id = nullif(btrim(target_remote_resource_id), ''), remote_url = target_remote_url,
    remote_state = left(coalesce(target_remote_state, ''), 200),
    failure_category = case when target_outcome = 'failed'
      then target_failure_category::tonde.publication_failure_category end,
    failure_code = case when target_outcome = 'failed' then left(coalesce(target_failure_code, ''), 120) end,
    failure_message = case when target_outcome = 'failed' then left(coalesce(target_failure_message, ''), 2000) end,
    finished_at = now()
  where id = target_attempt;
  update tonde.publications set state = new_state,
    remote_resource_type = left(coalesce(nullif(target_remote_resource_type, ''), publication.remote_resource_type), 120),
    remote_resource_id = coalesce(nullif(btrim(target_remote_resource_id), ''), publication.remote_resource_id),
    remote_url = coalesce(target_remote_url, publication.remote_url),
    remote_state = left(coalesce(nullif(target_remote_state, ''), publication.remote_state), 200),
    last_checked_at = now(),
    published_at = case when new_state = 'published' then now() else publication.published_at end,
    failed_at = case when new_state = 'failed' then now() end,
    failure_category = case when new_state = 'failed'
      then target_failure_category::tonde.publication_failure_category end,
    failure_code = case when new_state = 'failed' then left(coalesce(target_failure_code, ''), 120) end,
    failure_message = case when new_state = 'failed' then left(coalesce(target_failure_message, ''), 2000) end
  where workspace_id = target_workspace and id = target_publication;
  perform tonde_private.audit_event(target_workspace,
    case new_state when 'published' then 'publication.published' when 'failed' then 'publication.failed'
      when 'unknown_remote_state' then 'publication.outcome_unknown' else 'publication.accepted' end,
    target_publication, 'publication',
    jsonb_build_object('outcome', target_outcome, 'state', new_state, 'attempt_number', attempt.attempt_number,
      'remote_resource_id', nullif(btrim(target_remote_resource_id), ''),
      'failure_category', case when target_outcome = 'failed' then target_failure_category end));
  return jsonb_build_object('publication_id', target_publication, 'attempt_id', target_attempt,
    'outcome', target_outcome, 'state', new_state,
    'remote_resource_id', nullif(btrim(target_remote_resource_id), ''),
    'remote_url', target_remote_url, 'remote_state', left(coalesce(target_remote_state, ''), 200),
    'failure_category', case when target_outcome = 'failed' then target_failure_category end,
    'recorded_at', now(),
    'meaning', case new_state
      when 'submitted' then 'The destination accepted the submission; publication is not yet confirmed.'
      when 'processing' then 'The destination is still processing.'
      when 'published' then 'The destination confirmed this exact publication and returned a remote resource.'
      when 'failed' then 'The destination reported a failure; the category is normalized and the provider code is kept.'
      else 'The destination answer was ambiguous. This is not published and not failed; reconcile it before retrying.' end);
end $$;

-- 10. Reconciliation. A human who looked at the destination, or the server that queried it, records
--     what it actually shows. This is the only way out of UNKNOWN_REMOTE_STATE.
create function tonde.publication_reconcile(target_workspace uuid, target_publication uuid, target_observed text,
  target_remote_resource_id text default null, target_remote_state text default '',
  target_failure_category text default null, note_text text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; observed_state tonde.publication_state;
  source_value tonde.publication_reconciliation_source; allowed text[];
begin
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication for update;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  if (select auth.role()) = 'service_role' then
    source_value := 'provider_api';
  else
    if auth.uid() is null or not tonde_private.can_edit_workspace(target_workspace) then
      raise exception 'Workspace access denied' using errcode = '42501';
    end if;
    source_value := 'manual_operator';
  end if;
  if target_observed not in ('published','processing','removed','failed','unknown_remote_state') then
    raise exception 'A reconciliation observes published, processing, removed, failed or unknown_remote_state'
      using errcode = '22023';
  end if;
  allowed := case target_observed
    when 'published' then array['submitting','submitted','processing','published','unknown_remote_state']
    when 'processing' then array['submitting','submitted','unknown_remote_state']
    when 'failed' then array['submitting','submitted','processing','unknown_remote_state']
    when 'removed' then array['submitted','processing','published','unknown_remote_state']
    else array['submitting','submitted','processing','unknown_remote_state'] end;
  if not (publication.state::text = any(allowed)) then
    raise exception 'A publication in % cannot be reconciled to %', publication.state, target_observed
      using errcode = 'PT409';
  end if;
  if target_observed = 'published'
    and coalesce(btrim(target_remote_resource_id), publication.remote_resource_id) is null then
    raise exception 'A reconciliation to published records the remote resource it found' using errcode = '23514';
  end if;
  if target_observed = 'failed' and target_failure_category is null then
    target_failure_category := 'unknown';
  end if;
  observed_state := target_observed::tonde.publication_state;
  insert into tonde.publication_reconciliations(workspace_id, production_id, publication_id, observed_state,
    remote_state, remote_resource_id, source, note, actor_user_id)
  values (target_workspace, publication.production_id, target_publication, observed_state,
    left(coalesce(target_remote_state, ''), 200), nullif(btrim(target_remote_resource_id), ''), source_value,
    left(coalesce(note_text, ''), 800), auth.uid());
  update tonde.publications set state = observed_state,
    remote_resource_id = coalesce(nullif(btrim(target_remote_resource_id), ''), remote_resource_id),
    remote_state = left(coalesce(nullif(target_remote_state, ''), remote_state), 200),
    last_checked_at = now(),
    published_at = case when target_observed = 'published' then coalesce(published_at, now()) else published_at end,
    removed_at = case when target_observed = 'removed' then now() else removed_at end,
    failed_at = case when target_observed = 'failed' then now() end,
    failure_category = case when target_observed = 'failed'
      then target_failure_category::tonde.publication_failure_category end,
    failure_code = case when target_observed = 'failed' then null end,
    failure_message = case when target_observed = 'failed' then null end
  where workspace_id = target_workspace and id = target_publication;
  perform tonde_private.audit_event(target_workspace, 'publication.reconciled', target_publication, 'publication',
    jsonb_build_object('observed', target_observed, 'source', source_value,
      'remote_resource_id', coalesce(nullif(btrim(target_remote_resource_id), ''), publication.remote_resource_id)));
  return jsonb_build_object('publication_id', target_publication, 'previous_state', publication.state,
    'state', target_observed, 'source', source_value, 'remote_resource_id',
    coalesce(nullif(btrim(target_remote_resource_id), ''), publication.remote_resource_id),
    'remote_state', left(coalesce(nullif(target_remote_state, ''), publication.remote_state), 200),
    'failure_category', case when target_observed = 'failed' then target_failure_category end,
    'observed_at', now(), 'note', left(coalesce(note_text, ''), 800),
    'meaning', case target_observed
      when 'published' then 'The destination really holds this publication; published_at is when TONDE established it.'
      when 'processing' then 'The destination is still working on it.'
      when 'removed' then 'The destination no longer holds this publication.'
      when 'failed' then 'The destination has no usable copy and the cause is recorded.'
      else 'The destination state is still unconfirmed; nothing was claimed.' end);
end $$;

-- 10b. Preview and retry classification. The preview is the impact/summary a creator reviews before
--      anything is sent; it names every reason a submission is not possible yet instead of failing
--      mysteriously later. The retry classification is what Prompt 11 will read to decide whether an
--      operation may be retried, must be reconciled first, or must never be retried.
create function tonde.publication_preview(target_workspace uuid, target_publication uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare publication tonde.publications; production tonde.productions; result_row tonde.results;
  media tonde.media_files; provider tonde.integration_providers; connection tonde.integration_connections;
  authorization_row tonde.publication_authorizations; capability_row tonde.integration_provider_capabilities;
  capability text; account_label text := ''; fingerprint text; thumbnail uuid;
  missing text[]; blocked text[] := '{}';
begin
  if not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  select * into production from tonde.productions p
    where p.workspace_id = target_workspace and p.id = publication.production_id;
  select * into result_row from tonde.results r
    where r.workspace_id = target_workspace and r.id = publication.result_id;
  select * into media from tonde.media_files m
    where m.workspace_id = target_workspace and m.id = publication.media_id;
  select id into thumbnail from tonde.media_files m
    where m.workspace_id = target_workspace and m.derived_from_id = publication.media_id
      and m.file_category = 'thumbnail' and m.upload_state = 'uploaded' limit 1;
  select * into provider from tonde.integration_providers p where p.key = publication.destination_provider;
  select * into capability_row from tonde.integration_provider_capabilities c
    where c.provider_key = publication.destination_provider and c.capability_key = 'publish';
  if publication.destination_account_id is not null then
    select * into connection from tonde.integration_connections c
      where c.workspace_id = target_workspace and c.id = publication.destination_account_id;
    account_label := coalesce(connection.external_account_label, '');
  end if;
  select * into authorization_row from tonde.publication_authorizations a
    where a.id = publication.authorization_id;
  capability := tonde_private.integration_capability_reason(target_workspace,
    publication.destination_provider, 'publish');
  fingerprint := tonde_private.publication_fingerprint(target_workspace, target_publication);
  missing := case when connection.id is null or capability_row.provider_key is null then '{}'::text[]
    else array(select s from unnest(capability_row.required_scopes) s
      where not (s = any(coalesce(connection.scopes, '{}')))) end;
  if production.id is null or production.lifecycle <> 'active' then
    blocked := array_append(blocked, 'PRODUCTION_INACTIVE');
  end if;
  if result_row.id is null then
    blocked := array_append(blocked, 'RESULT_MISSING');
  elsif result_row.revision <> publication.result_revision or result_row.media_id <> publication.media_id then
    blocked := array_append(blocked, 'RESULT_CHANGED_SINCE_PINNED');
  end if;
  if media.id is null or media.upload_state <> 'uploaded' then
    blocked := array_append(blocked, 'MEDIA_NOT_AVAILABLE');
  end if;
  if provider.key is null then blocked := array_append(blocked, 'UNKNOWN_PROVIDER'); end if;
  if capability <> 'AVAILABLE' then blocked := array_append(blocked, 'CAPABILITY_UNAVAILABLE'); end if;
  if array_length(missing, 1) is not null then blocked := array_append(blocked, 'MISSING_SCOPE'); end if;
  if authorization_row.id is null or authorization_row.decision <> 'authorize' then
    blocked := array_append(blocked, 'AUTHORIZATION_REQUIRED');
  elsif authorization_row.request_fingerprint <> fingerprint
    or authorization_row.production_revision <> publication.production_revision
    or authorization_row.result_revision <> publication.result_revision
    or authorization_row.media_id <> publication.media_id
    or authorization_row.media_checksum <> publication.media_checksum
    or authorization_row.destination_provider <> publication.destination_provider
    or authorization_row.destination_account_id is distinct from publication.destination_account_id
    or authorization_row.destination <> publication.destination then
    blocked := array_append(blocked, 'AUTHORIZATION_STALE');
  end if;
  if publication.state <> 'ready' then
    blocked := array_append(blocked, 'STATE_' || upper(publication.state::text));
  end if;
  return jsonb_build_object('publication_id', target_publication, 'state', publication.state,
    'production', jsonb_build_object('id', publication.production_id, 'title', production.title,
      'pinned_revision', publication.production_revision, 'current_revision', production.revision),
    'result', jsonb_build_object('id', publication.result_id, 'state', result_row.state,
      'approval', result_row.approval, 'pinned_revision', publication.result_revision,
      'current_revision', result_row.revision),
    'media', jsonb_build_object('id', publication.media_id, 'media_type', publication.media_type,
      'mime_type', media.mime_type, 'bytes', media.bytes, 'pinned_checksum', publication.media_checksum,
      'current_checksum', media.checksum, 'upload_state', media.upload_state,
      'thumbnail_media_id', thumbnail),
    'destination', jsonb_build_object('provider', publication.destination_provider,
      'provider_name', provider.name, 'account_id', publication.destination_account_id,
      'account_label', account_label, 'target', publication.destination,
      'visibility', publication.visibility, 'scheduled_for', publication.scheduled_for),
    'content', jsonb_build_object('title', publication.title, 'caption', publication.caption,
      'settings', publication.destination_config, 'fingerprint', fingerprint),
    'provider_constraints', coalesce(provider.restrictions, '{}'::jsonb),
    'capability', capability, 'missing_scopes', coalesce(missing, '{}'),
    'authorization', jsonb_build_object('authorization_id', publication.authorization_id,
      'decision', authorization_row.decision, 'actor_user_id', authorization_row.actor_user_id,
      'authorized_at', authorization_row.authorized_at),
    'retry_safety', tonde.publication_retry_safety(target_workspace, target_publication),
    'can_submit', array_length(blocked, 1) is null, 'blocked_by', blocked,
    'note', case when array_length(blocked, 1) is null
      then 'Everything this publication needs is present; a creator action may submit it.'
      else 'This publication cannot be submitted yet; blocked_by lists every reason.' end);
end $$;

-- Publishing is never classified safe_to_retry: a real-world action always rides the operation's
-- idempotency key, or needs reconciliation first, or must never be repeated.
create function tonde.publication_retry_safety(target_workspace uuid, target_publication uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare publication tonde.publications;
begin
  if not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  return case publication.state
    when 'draft' then 'requires_idempotency_key'
    when 'ready' then 'requires_idempotency_key'
    when 'awaiting_authorization' then 'requires_idempotency_key'
    when 'failed' then 'requires_idempotency_key'
    when 'submitting' then 'requires_reconciliation_before_retry'
    when 'submitted' then 'requires_reconciliation_before_retry'
    when 'processing' then 'requires_reconciliation_before_retry'
    when 'unknown_remote_state' then 'requires_reconciliation_before_retry'
    else 'must_not_retry' end;
end $$;

-- 11. Exposure. Publications and their records are tenant-readable so a failure is never hidden;
--     only the trusted server writes, and the human authorization path is an RPC.
alter table tonde.publications enable row level security;
alter table tonde.publication_authorizations enable row level security;
alter table tonde.publication_attempts enable row level security;
alter table tonde.publication_reconciliations enable row level security;
create policy tenant_read on tonde.publications for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
create policy tenant_read on tonde.publication_authorizations for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
create policy tenant_read on tonde.publication_attempts for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
create policy tenant_read on tonde.publication_reconciliations for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.publications, tonde.publication_authorizations,
  tonde.publication_attempts, tonde.publication_reconciliations to authenticated;
grant all on tonde.publications, tonde.publication_authorizations,
  tonde.publication_attempts, tonde.publication_reconciliations to service_role;

-- 12. Function grants. Creator decisions are authenticated user APIs; provider outcomes and the
--     submission record are trusted-server APIs and are never reachable from a client session.
revoke all on function tonde.publication_create(uuid,uuid,uuid,text,uuid,text,uuid,text,text,text,timestamptz,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function tonde.publication_update(uuid,uuid,text,text,text,jsonb,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function tonde.publication_set_state(uuid,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.publication_authorize(uuid,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.publication_submit(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.publication_record_result(uuid,uuid,uuid,text,text,text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function tonde.publication_reconcile(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function tonde.publication_preview(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.publication_retry_safety(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.publication_create(uuid,uuid,uuid,text,uuid,text,uuid,text,text,text,timestamptz,jsonb)
  to authenticated;
grant execute on function tonde.publication_update(uuid,uuid,text,text,text,jsonb,text,timestamptz) to authenticated;
grant execute on function tonde.publication_set_state(uuid,uuid,text,text) to authenticated;
grant execute on function tonde.publication_authorize(uuid,uuid,text,text) to authenticated;
grant execute on function tonde.publication_reconcile(uuid,uuid,text,text,text,text,text) to authenticated, service_role;
grant execute on function tonde.publication_preview(uuid,uuid) to authenticated;
grant execute on function tonde.publication_retry_safety(uuid,uuid) to authenticated;
grant execute on function tonde.publication_submit(uuid,uuid) to service_role;
grant execute on function tonde.publication_record_result(uuid,uuid,uuid,text,text,text,text,text,text,text,text)
  to service_role;
alter default privileges in schema tonde revoke execute on functions from public;
commit;
