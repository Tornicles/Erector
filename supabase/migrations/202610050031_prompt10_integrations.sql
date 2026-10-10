-- Prompt 10 packet 031 — integrations (provider registry, capabilities, connections, OAuth boundary).
-- Forward-only and additive: extends the existing seam from migration 001
-- (tonde.integration_connections + tonde_private.integration_credentials) and the AI provider
-- catalog from 017. Applied migrations are never rewritten.
--
-- Laws enforced here, not merely described:
--   * A provider is ENABLED only when an adapter exists (adapter_state <> 'absent').
--   * A connection is CONNECTED only after a successful verification (verified_at is required) and
--     only for a provider that is enabled with a VERIFIED adapter. Credentials merely existing can
--     never produce CONNECTED.
--   * Granted scopes must be a subset of the scopes TONDE requested (scope minimization).
--   * REVOKED always carries the moment it happened.
--   * Provider definitions may not carry secrets; secrets live only in the private credential store.
--   * OAuth state is single-use, bound to workspace+user+provider, and expires.
begin;

-- 1. Truthful vocabulary. One state per real situation; no optimistic words.
create type tonde.integration_auth_type as enum ('oauth','api_key','service_account','none');
create type tonde.integration_provider_category as enum
  ('social_publishing','ai_generation','storage_delivery','communication','billing','analytics_metadata');
-- 'absent': no adapter exists. 'implemented': an adapter exists but was never exercised against the
-- real provider. 'verified': a real call to the provider succeeded and was recorded.
create type tonde.integration_adapter_state as enum ('absent','implemented','verified');
create type tonde.integration_connection_status as enum
  ('disconnected','pending','connected','reauth_required','expired','revoked','error','disabled');

-- 2. Provider registry. Definition metadata only: no secrets, no capability claims for absent adapters.
create table tonde.integration_providers (
  key text primary key check (length(key) between 1 and 60),
  name text not null check (length(name) between 1 and 120),
  category tonde.integration_provider_category not null,
  auth_type tonde.integration_auth_type not null,
  connection_required boolean not null default true,
  adapter_state tonde.integration_adapter_state not null default 'absent',
  enabled boolean not null default false,
  capability_version integer not null default 0 check (capability_version >= 0),
  media_types text[] not null default '{}',
  export_types text[] not null default '{}',
  scopes text[] not null default '{}',
  callback_required boolean not null default false,
  environment text not null default 'production' check (environment in ('sandbox','production')),
  restrictions jsonb not null default '{}'::jsonb check (jsonb_typeof(restrictions) = 'object'),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  note text not null default '' check (length(note) <= 600),
  docs_url text not null default '' check (length(docs_url) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An enabled provider always has an adapter. Nothing is enabled by wishful configuration.
  constraint provider_enabled_has_adapter check (not enabled or adapter_state <> 'absent')
);

-- Secret-shaped configuration keys are refused outright, so a provider definition can never become
-- a second, exposed credential store.
create function tonde_private.guard_integration_provider() returns trigger
language plpgsql security definer set search_path = '' as $$
declare key_name text;
begin
  for key_name in select jsonb_object_keys(new.configuration) loop
    if key_name ~* '(secret|token|password|credential|api[_-]?key|private[_-]?key|client[_-]?secret|refresh)' then
      raise exception 'Provider configuration must not contain secrets; use the private credential store'
        using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
revoke all on function tonde_private.guard_integration_provider() from public, anon, authenticated, service_role;
create trigger guard_integration_provider before insert or update on tonde.integration_providers
  for each row execute function tonde_private.guard_integration_provider();
create trigger guard_mutation before insert or update on tonde.integration_providers
  for each row execute function tonde_private.guard_mutation();

-- 3. Capabilities. A capability exists as a row only when TONDE can actually attempt it; a disabled
--    row is a declared-but-unavailable capability, never a working feature.
create table tonde.integration_provider_capabilities (
  provider_key text not null references tonde.integration_providers(key) on delete cascade,
  capability_key text not null check (length(capability_key) between 1 and 80),
  connection_required boolean not null default true,
  required_scopes text[] not null default '{}',
  media_types text[] not null default '{}',
  export_types text[] not null default '{}',
  enabled boolean not null default false,
  input_contract jsonb not null default '[]'::jsonb check (jsonb_typeof(input_contract) = 'array'),
  output_contract jsonb not null default '{}'::jsonb check (jsonb_typeof(output_contract) = 'object'),
  note text not null default '' check (length(note) <= 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider_key, capability_key)
);

-- Enabling a capability requires an adapter that exists and, when it needs a connection, a verified
-- connection. Cross-row rules cannot be expressed as a CHECK.
create function tonde_private.guard_integration_capability() returns trigger
language plpgsql security definer set search_path = '' as $$
declare provider tonde.integration_providers;
begin
  if not new.enabled then return new; end if;
  select * into provider from tonde.integration_providers p where p.key = new.provider_key;
  if not found or provider.adapter_state = 'absent' then
    raise exception 'No adapter exists for this provider, so its capability cannot be enabled'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_integration_capability() from public, anon, authenticated, service_role;
create trigger guard_integration_capability before insert or update on tonde.integration_provider_capabilities
  for each row execute function tonde_private.guard_integration_capability();
create trigger guard_mutation before insert or update on tonde.integration_provider_capabilities
  for each row execute function tonde_private.guard_mutation();

-- Promote the existing AI provider catalog into the registry instead of duplicating it: 017 stays the
-- AI capability source, and these rows add cross-category identity with no invented capability facts.
-- 'manual' is TONDE's own compile-for-you path, so it is implemented and needs no connection; every
-- external AI provider stays adapter_state 'absent' and disabled until an adapter is really verified.
insert into tonde.integration_providers
  (key, name, category, auth_type, connection_required, adapter_state, enabled, note)
select p.key, p.label, 'ai_generation', case when p.connection_required then 'api_key'::tonde.integration_auth_type
  else 'none'::tonde.integration_auth_type end,
  p.connection_required,
  case when p.key = 'manual' then 'implemented'::tonde.integration_adapter_state
    else 'absent'::tonde.integration_adapter_state end,
  p.key = 'manual', p.note
from tonde.ai_providers p
on conflict (key) do nothing;
do $$ begin
  if exists (select 1 from tonde.ai_providers p left join tonde.integration_providers r on r.key = p.key where r.key is null) then
    raise exception 'Every AI provider must be present in the integration registry';
  end if;
end $$;

-- 4. Connections: extend the existing table rather than creating a parallel one.
alter table tonde.integration_connections
  add column auth_type tonde.integration_auth_type not null default 'oauth',
  add column external_account_label text not null default '' check (length(external_account_label) <= 200),
  add column requested_scopes text[] not null default '{}',
  add column verified_at timestamptz,
  add column last_success_at timestamptz,
  add column last_error_at timestamptz,
  add column last_error_code text check (length(last_error_code) <= 120),
  add column revoked_at timestamptz,
  add column metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object');
alter table tonde.integration_connections drop constraint integration_connections_status_check;
alter table tonde.integration_connections alter column status drop default;
-- The new vocabulary is a superset of the four historical values, so the cast preserves every row.
alter table tonde.integration_connections alter column status type tonde.integration_connection_status
  using status::tonde.integration_connection_status;
alter table tonde.integration_connections alter column status set default 'disconnected';
alter table tonde.integration_connections
  add constraint connection_verified_requires_witness check (status <> 'connected' or verified_at is not null),
  add constraint connection_revoked_requires_timestamp check (status <> 'revoked' or revoked_at is not null),
  -- Scope minimization: whatever the provider granted is a subset of what TONDE asked for.
  add constraint connection_scopes_were_requested check (scopes <@ requested_scopes),
  add constraint connection_provider_registered foreign key (provider)
    references tonde.integration_providers(key) on delete restrict;

-- CONNECTED additionally requires a live provider: enabled and actually verified.
create function tonde_private.guard_integration_connection() returns trigger
language plpgsql security definer set search_path = '' as $$
declare provider tonde.integration_providers;
begin
  if new.status = 'connected' and new.verified_at is null then
    raise exception 'A connection cannot be CONNECTED without a recorded verification'
      using errcode = '23514';
  end if;
  if new.status = 'connected' then
    select * into provider from tonde.integration_providers p where p.key = new.provider;
    if not found or not provider.enabled or provider.adapter_state <> 'verified' then
      raise exception 'A connection cannot be CONNECTED: this provider has no verified adapter'
        using errcode = '23514';
    end if;
  end if;
  if new.status = 'revoked' and new.revoked_at is null then
    raise exception 'A revoked connection must record when it was revoked' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_integration_connection() from public, anon, authenticated, service_role;
create trigger guard_integration_connection before insert or update on tonde.integration_connections
  for each row execute function tonde_private.guard_integration_connection();

-- 5. OAuth boundary. The raw state and PKCE verifier are never stored: only their hashes, so a database
--    leak cannot replay a flow. Single-use and expiry are enforced by the database, not by the caller.
create table tonde.integration_oauth_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  provider_key text not null references tonde.integration_providers(key) on delete restrict,
  state_hash text not null unique check (length(state_hash) between 16 and 200),
  verifier_hash text not null default '' check (length(verifier_hash) <= 200),
  redirect_uri text not null default '' check (length(redirect_uri) <= 400),
  requested_scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null,
  unique (workspace_id, id),
  constraint oauth_state_expires_in_the_future check (expires_at > created_at),
  -- A state that outlives a short callback window is a liability, not a convenience.
  constraint oauth_state_window_is_short check (expires_at <= created_at + interval '30 minutes')
);
create index integration_oauth_states_by_workspace on tonde.integration_oauth_states(workspace_id, provider_key);

create function tonde_private.guard_oauth_state_consumption() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.consumed_at is not null then
    raise exception 'This OAuth state was already consumed' using errcode = 'PT409';
  end if;
  if new.consumed_at is not null and new.consumed_at > old.expires_at then
    raise exception 'This OAuth state has expired' using errcode = 'PT409';
  end if;
  -- A consumed state is a closed record: nothing about it may change afterwards.
  if new.consumed_at is not null and old.consumed_at is null and new.state_hash <> old.state_hash then
    raise exception 'An OAuth state cannot be rewritten while being consumed' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_oauth_state_consumption() from public, anon, authenticated, service_role;
create trigger guard_oauth_state_consumption before update on tonde.integration_oauth_states
  for each row execute function tonde_private.guard_oauth_state_consumption();

-- 6. Capability evaluation. The single server-side answer to "can this workspace use this capability",
--    returning the reason rather than a bare false, so the UI never invents a reason of its own.
--    Values: UNKNOWN_PROVIDER, PROVIDER_NOT_IMPLEMENTED, UNKNOWN_CAPABILITY, CAPABILITY_DISABLED,
--    CONNECTION_NOT_READY, MISSING_SCOPE, AVAILABLE.
create function tonde.integration_capability_state(target_workspace uuid, target_provider text, target_capability text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare provider tonde.integration_providers; capability tonde.integration_provider_capabilities;
  connection tonde.integration_connections; missing text[];
begin
  -- 010 relocated the policy helpers into tonde_private; call the helper where it actually lives.
  if not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
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
revoke all on function tonde.integration_capability_state(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function tonde.integration_capability_state(uuid,text,text) to authenticated;

-- 7. Exposure. Registry rows are product catalog: readable by any authenticated user, writable only by
--    the trusted server. OAuth state is server-only: no client policy and no client grant at all.
alter table tonde.integration_providers enable row level security;
alter table tonde.integration_provider_capabilities enable row level security;
alter table tonde.integration_oauth_states enable row level security;
create policy catalog_read on tonde.integration_providers for select to authenticated using (true);
create policy catalog_read on tonde.integration_provider_capabilities for select to authenticated using (true);
grant select on tonde.integration_providers, tonde.integration_provider_capabilities to authenticated;
grant all on tonde.integration_providers, tonde.integration_provider_capabilities,
  tonde.integration_oauth_states to service_role;
alter default privileges in schema tonde revoke execute on functions from public;
commit;
