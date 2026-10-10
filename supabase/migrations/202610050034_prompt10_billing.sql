-- Prompt 10 packet 034 — billing, entitlements, usage and webhooks (§31–47, §74–76).
--
-- The commercial authority layer. It extends the seam migration 001 already created
-- (`tonde.billing_accounts`, `tonde.usage_events`) and the AI cost structures from migration 017
-- (`ai_model_profiles`, `ai_generation_attempts`, `ai_generation_batches`) instead of inventing a
-- second commercial model.
--
-- Laws enforced here, not merely described:
--   * Commercial authority is server-only. No client role holds a write grant on any billing,
--     entitlement, usage or webhook table; the browser can start a checkout intent and nothing else.
--   * A verified provider event is the only thing that can move a subscription. Every webhook receipt
--     records WHICH signature verification was performed (scheme + time), because an unverified event
--     must be impossible to insert at all.
--   * Webhook events are deduplicated by provider event identity, and out-of-order delivery cannot
--     restore an older provider state: an event older than the applied provider state is recorded as
--     ignored with `STALE_EVENT` instead of being applied.
--   * Entitlements are derived from the plan by the server when a subscription enters an
--     entitlement-granting state; administrative grants are recorded separately with their actor.
--   * A consumable entitlement can never be overspent: `consumed + reserved <= limit` is a database
--     constraint, and a reservation takes a row lock before it checks the balance, so two simultaneous
--     requests cannot spend the same remaining credit.
--   * Provider cost, estimated cost and customer price are separate columns; a cost is never invented,
--     and `cost_basis` says what kind of number the row actually carries.
--   * AI generation cost flows in from the existing attempt rows: a usage event can name the attempt
--     it accounts for, and that attempt must belong to the same workspace.
begin;

-- 1. Vocabulary.
create type tonde.subscription_state as enum
  ('none','trialing','active','past_due','incomplete','cancel_at_period_end','cancelled','suspended');
create type tonde.entitlement_kind as enum ('feature','quota');
create type tonde.entitlement_source as enum ('plan','grant');
create type tonde.usage_cost_basis as enum ('actual','estimated','unknown');
create type tonde.reservation_state as enum ('reserved','committed','released');
create type tonde.webhook_state as enum ('received','processing','processed','failed','ignored');
create type tonde.checkout_state as enum ('started','completed','abandoned','expired');
create type tonde.commercial_actor as enum ('webhook','server','admin');

-- 2. Subscription truth on the existing billing account. The state vocabulary is a superset of the
--    historical check, so every existing row survives the conversion unchanged.
alter table tonde.billing_accounts
  add column provider_state_at timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add column entitlements_synced_at timestamptz,
  add column billing_admin_user_id uuid references auth.users(id) on delete set null;
alter table tonde.billing_accounts drop constraint billing_accounts_subscription_status_check;
alter table tonde.billing_accounts alter column subscription_status drop default;
alter table tonde.billing_accounts alter column subscription_status type tonde.subscription_state
  using subscription_status::tonde.subscription_state;
alter table tonde.billing_accounts alter column subscription_status set default 'none';
-- Only these states grant plan entitlements; everything else grants nothing.
create function tonde_private.subscription_grants_entitlements(state tonde.subscription_state)
returns boolean language sql immutable set search_path = '' as $$
  select state in ('trialing','active','cancel_at_period_end');
$$;
revoke all on function tonde_private.subscription_grants_entitlements(tonde.subscription_state)
  from public, anon, authenticated, service_role;

-- 3. Plans and entitlements. Catalog rows carry NO invented prices: a price identity is either the
--    provider's own reference or empty, and a plan without one simply cannot be checked out yet.
create table tonde.entitlement_definitions (
  key text primary key check (length(key) between 1 and 80),
  name text not null check (length(name) between 1 and 120),
  kind tonde.entitlement_kind not null,
  unit text not null default '' check (length(unit) <= 40),
  description text not null default '' check (length(description) <= 600),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger guard_mutation before insert or update on tonde.entitlement_definitions
  for each row execute function tonde_private.guard_mutation();

create table tonde.billing_plans (
  key text primary key check (length(key) between 1 and 80),
  name text not null check (length(name) between 1 and 120),
  state text not null default 'draft' check (state in ('draft','active','retired')),
  provider text not null default '' check (length(provider) <= 60),
  provider_price_id text not null default '' check (length(provider_price_id) <= 200),
  billing_interval text not null default '' check (billing_interval in ('','month','year')),
  note text not null default '' check (length(note) <= 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A plan that cannot name a provider price cannot be sold; it is a draft, not a product.
  constraint plan_sellable_has_price check (state <> 'active' or (provider <> '' and provider_price_id <> ''))
);
create trigger guard_mutation before insert or update on tonde.billing_plans
  for each row execute function tonde_private.guard_mutation();

create table tonde.plan_entitlements (
  plan_key text not null references tonde.billing_plans(key) on delete cascade,
  entitlement_key text not null references tonde.entitlement_definitions(key) on delete restrict,
  limit_amount numeric(14,4) check (limit_amount is null or limit_amount >= 0),
  note text not null default '' check (length(note) <= 400),
  primary key (plan_key, entitlement_key)
);
create trigger guard_mutation before insert or update on tonde.plan_entitlements
  for each row execute function tonde_private.guard_mutation();

-- What a workspace actually holds. Plan-derived rows are written only by the server sync; grant rows
-- are administrative decisions with an actor. consumed + reserved can never exceed the limit.
create table tonde.workspace_entitlements (
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  entitlement_key text not null references tonde.entitlement_definitions(key) on delete restrict,
  source tonde.entitlement_source not null,
  plan_key text references tonde.billing_plans(key) on delete restrict,
  limit_amount numeric(14,4) check (limit_amount is null or limit_amount >= 0),
  consumed_amount numeric(14,4) not null default 0 check (consumed_amount >= 0),
  reserved_amount numeric(14,4) not null default 0 check (reserved_amount >= 0),
  note text not null default '' check (length(note) <= 800),
  granted_by uuid references auth.users(id) on delete set null,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entitlement_key),
  constraint entitlement_never_overspent check (
    limit_amount is null or consumed_amount + reserved_amount <= limit_amount),
  constraint entitlement_source_names_origin check (
    (source = 'plan' and plan_key is not null) or (source = 'grant' and granted_by is not null))
);
create trigger guard_mutation before insert or update on tonde.workspace_entitlements
  for each row execute function tonde_private.guard_mutation();

-- 4. Commercial history. A subscription that goes ACTIVE → PAST_DUE → ACTIVE stays explainable.
create table tonde.subscription_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  provider text not null default '' check (length(provider) <= 60),
  from_state tonde.subscription_state,
  to_state tonde.subscription_state not null,
  actor tonde.commercial_actor not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  webhook_event_id uuid,
  applied boolean not null default true,
  reason text not null default '' check (length(reason) <= 600),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (workspace_id, id)
);
create index subscription_events_by_workspace on tonde.subscription_events(workspace_id, occurred_at desc, id);
create function tonde_private.guard_subscription_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Subscription history is an append-only record and cannot be changed'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_subscription_event() from public, anon, authenticated, service_role;
create trigger guard_subscription_event before insert or update or delete on tonde.subscription_events
  for each row execute function tonde_private.guard_subscription_event();

-- 5. Checkout intents. The browser may ask to start a checkout; only a verified provider event can
--    ever complete one. Nothing here is authoritative commercial state.
create table tonde.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  plan_key text not null references tonde.billing_plans(key) on delete restrict,
  state tonde.checkout_state not null default 'started',
  provider_session_id text check (provider_session_id is null or length(provider_session_id) <= 200),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expired_at timestamptz,
  note text not null default '' check (length(note) <= 600),
  unique (workspace_id, id),
  constraint checkout_completed_records_when check (state <> 'completed' or completed_at is not null),
  constraint checkout_expired_records_when check (state <> 'expired' or expired_at is not null)
);
create index billing_checkout_intents_by_workspace on tonde.billing_checkout_intents(workspace_id, created_at desc, id);
create function tonde_private.guard_checkout_intent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare allowed text[];
begin
  -- A client can open an intent; nothing but the trusted server may move it afterwards. The state
  -- machine is still enforced so a jump never looks like a real completion.
  if tg_op = 'UPDATE' then
    if old.plan_key <> new.plan_key or old.workspace_id <> new.workspace_id
      or old.created_by <> new.created_by or old.created_at <> new.created_at then
      raise exception 'A checkout intent names the plan and workspace it was opened for'
        using errcode = '23514';
    end if;
    allowed := case old.state
      when 'started' then array['completed','abandoned','expired']
      else array[]::text[] end;
    if new.state <> old.state and not (new.state::text = any(allowed)) then
      raise exception 'A checkout in % cannot become %', old.state, new.state using errcode = 'PT409';
    end if;
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_checkout_intent() from public, anon, authenticated, service_role;
create trigger guard_checkout_intent before update on tonde.billing_checkout_intents
  for each row execute function tonde_private.guard_checkout_intent();
create trigger guard_mutation before insert or update on tonde.billing_checkout_intents
  for each row execute function tonde_private.guard_mutation();

-- 6. Webhook receipts. A receipt records the verification that was performed against the provider's
--    signature: without that witness the row cannot exist at all, so an unsigned event can never
--    reach commercial state. Payloads may not carry secrets.
create table tonde.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(provider) between 1 and 60),
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 200),
  state tonde.webhook_state not null default 'received',
  signature_scheme text not null check (length(signature_scheme) between 1 and 80),
  signature_verified_at timestamptz not null,
  event_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  failure_message text check (failure_message is null or length(failure_message) <= 2000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  unique (provider, provider_event_id),
  constraint webhook_finished_states_record_when check (
    state not in ('processed','failed','ignored') or processed_at is not null),
  constraint webhook_processing_records_when check (state <> 'processing' or processing_started_at is not null)
);
create index billing_webhook_events_recent on tonde.billing_webhook_events(provider, received_at desc, id);
-- Provenance: a subscription movement names the receipt it came from, and a receipt that was used
-- cannot be deleted out from under the history that cites it.
alter table tonde.subscription_events add constraint subscription_event_names_its_receipt
  foreign key (webhook_event_id) references tonde.billing_webhook_events(id) on delete restrict;

create function tonde_private.guard_billing_webhook() returns trigger
language plpgsql security definer set search_path = '' as $$
declare key_name text; allowed text[];
begin
  for key_name in select jsonb_object_keys(new.payload) loop
    if key_name ~* '(secret|signature|token|password|credential|api[_-]?key|client[_-]?secret)' then
      raise exception 'A webhook receipt must not store secrets; the signature is a witness, not a payload'
        using errcode = '23514';
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    if old.provider <> new.provider or old.provider_event_id <> new.provider_event_id
      or old.event_type <> new.event_type or old.event_created_at <> new.event_created_at
      or old.signature_scheme <> new.signature_scheme
      or old.signature_verified_at <> new.signature_verified_at then
      raise exception 'A webhook receipt records what the provider sent and cannot be rewritten'
        using errcode = '23514';
    end if;
    allowed := case old.state
      when 'received' then array['processing','processed','failed','ignored']
      when 'processing' then array['processed','failed','ignored']
      else array[]::text[] end;
    if new.state <> old.state and not (new.state::text = any(allowed)) then
      raise exception 'A webhook receipt in % cannot become %', old.state, new.state using errcode = 'PT409';
    end if;
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_billing_webhook() from public, anon, authenticated, service_role;
create trigger guard_billing_webhook before insert or update on tonde.billing_webhook_events
  for each row execute function tonde_private.guard_billing_webhook();
create trigger guard_mutation before insert or update on tonde.billing_webhook_events
  for each row execute function tonde_private.guard_mutation();

-- 7. Usage accounting on the existing usage table: one row per real consumption, idempotent, with
--    provider cost, estimated cost and customer price kept apart, and linked to the AI attempt it
--    accounts for when there is one.
alter table tonde.usage_events
  add column operation text not null default '' check (length(operation) <= 120),
  add column provider text not null default '' check (length(provider) <= 60),
  add column model text not null default '' check (length(model) <= 120),
  add column production_id uuid,
  add column actor_user_id uuid,
  add column input_units numeric(14,4) check (input_units is null or input_units >= 0),
  add column output_units numeric(14,4) check (output_units is null or output_units >= 0),
  add column provider_cost numeric(14,4) check (provider_cost is null or provider_cost >= 0),
  add column estimated_cost numeric(14,4) check (estimated_cost is null or estimated_cost >= 0),
  add column price_amount numeric(14,4) check (price_amount is null or price_amount >= 0),
  add column credit_units numeric(14,4) not null default 0 check (credit_units >= 0),
  add column currency text not null default 'USD' check (length(currency) = 3),
  add column cost_basis tonde.usage_cost_basis not null default 'unknown',
  add column source_event_id text check (source_event_id is null or length(source_event_id) between 1 and 200),
  add column attempt_id uuid,
  add column metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object');
-- A quota is not always a whole number (a credit can be fractional), so the historical bigint
-- quantity is widened. The cast is lossless and the generated TypeScript type is `number` either way.
alter table tonde.usage_events alter column quantity type numeric(14,4);
alter table tonde.usage_events add constraint usage_production_same_workspace
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict;
alter table tonde.usage_events add constraint usage_attempt_same_workspace
  foreign key (workspace_id, attempt_id) references tonde.ai_generation_attempts(workspace_id, id) on delete restrict;
alter table tonde.usage_events add constraint usage_actual_cost_is_reported check (
  cost_basis <> 'actual' or provider_cost is not null);
alter table tonde.usage_events add constraint usage_unknown_cost_is_not_invented check (
  cost_basis <> 'unknown' or (provider_cost is null and estimated_cost is null));
create unique index usage_events_by_source_event
  on tonde.usage_events(workspace_id, source_event_id) where source_event_id is not null;
create index usage_events_by_workspace on tonde.usage_events(workspace_id, created_at desc, id);
create index usage_events_by_metric on tonde.usage_events(workspace_id, metric, created_at desc);

-- 8. Reservations. `consumed + reserved <= limit` is already a constraint on the entitlement row, and
--    a reservation takes that row FOR UPDATE before it reads the balance, so two simultaneous requests
--    are serialized instead of racing.
create table tonde.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  entitlement_key text not null,
  amount numeric(14,4) not null check (amount > 0),
  state tonde.reservation_state not null default 'reserved',
  operation_id text not null check (length(operation_id) between 1 and 200),
  actual_amount numeric(14,4) check (actual_amount is null or actual_amount >= 0),
  note text not null default '' check (length(note) <= 600),
  reserved_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workspace_id, operation_id),
  foreign key (workspace_id, entitlement_key)
    references tonde.workspace_entitlements(workspace_id, entitlement_key) on delete restrict,
  constraint reservation_finished_records_when check (state = 'reserved' or finished_at is not null),
  constraint reservation_committed_records_spend check (state <> 'committed' or actual_amount is not null)
);
create index usage_reservations_open on tonde.usage_reservations(workspace_id, state, reserved_at desc);

-- 9. Entitlement derivation and evaluation. The plan decides what a workspace holds; a grant is an
--    explicit administrative decision; both are evaluated in one place so no surface invents a rule.
create function tonde_private.billing_sync_entitlements(target_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare account tonde.billing_accounts; granted integer := 0; revoked integer := 0; row_count integer;
begin
  select * into account from tonde.billing_accounts b where b.workspace_id = target_workspace;
  delete from tonde.workspace_entitlements e
    where e.workspace_id = target_workspace and e.source = 'plan'
      and (account.workspace_id is null or not tonde_private.subscription_grants_entitlements(account.subscription_status)
        or e.plan_key is distinct from account.plan_reference);
  get diagnostics revoked = row_count;
  if account.workspace_id is not null and account.plan_reference is not null
    and tonde_private.subscription_grants_entitlements(account.subscription_status) then
    insert into tonde.workspace_entitlements(workspace_id, entitlement_key, source, plan_key, limit_amount, note)
    select target_workspace, p.entitlement_key, 'plan', account.plan_reference, p.limit_amount,
      'Derived from the active plan; the server owns this row.'
    from tonde.plan_entitlements p where p.plan_key = account.plan_reference
    on conflict (workspace_id, entitlement_key) do update
      set limit_amount = excluded.limit_amount, plan_key = excluded.plan_key, source = 'plan',
        note = excluded.note, updated_at = now()
      where tonde.workspace_entitlements.source = 'plan';
    get diagnostics granted = row_count;
  end if;
  update tonde.billing_accounts set entitlements_synced_at = now() where workspace_id = target_workspace;
  return jsonb_build_object('workspace_id', target_workspace, 'granted', granted, 'revoked', revoked,
    'state', coalesce(account.subscription_status::text, 'none'),
    'grants_entitlements', account.workspace_id is not null
      and tonde_private.subscription_grants_entitlements(account.subscription_status));
end $$;
revoke all on function tonde_private.billing_sync_entitlements(uuid)
  from public, anon, authenticated, service_role;

-- The one server-side answer to "does this workspace hold this entitlement", reason-bearing, so no
-- caller has to interpret a plan name.
create function tonde.entitlement_state(target_workspace uuid, target_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare definition tonde.entitlement_definitions; entitlement tonde.workspace_entitlements;
  account tonde.billing_accounts; remaining numeric;
begin
  if not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into definition from tonde.entitlement_definitions d where d.key = target_key;
  if not found then return 'UNKNOWN_ENTITLEMENT'; end if;
  if not definition.enabled then return 'ENTITLEMENT_DISABLED'; end if;
  select * into entitlement from tonde.workspace_entitlements e
    where e.workspace_id = target_workspace and e.entitlement_key = target_key;
  if not found then
    select * into account from tonde.billing_accounts b where b.workspace_id = target_workspace;
    if account.workspace_id is null or account.subscription_status = 'none' then
      return 'NO_SUBSCRIPTION';
    end if;
    if not tonde_private.subscription_grants_entitlements(account.subscription_status) then
      return 'SUBSCRIPTION_NOT_ACTIVE';
    end if;
    return 'NOT_INCLUDED';
  end if;
  if entitlement.valid_until is not null and entitlement.valid_until <= now() then return 'EXPIRED'; end if;
  if entitlement.limit_amount is null then return 'AVAILABLE'; end if;
  remaining := entitlement.limit_amount - entitlement.consumed_amount - entitlement.reserved_amount;
  if remaining <= 0 then return 'EXHAUSTED'; end if;
  return 'AVAILABLE';
end $$;
revoke all on function tonde.entitlement_state(uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.entitlement_state(uuid,text) to authenticated;

-- 10. Server RPCs. Billing authority, webhook application, usage, quotas and grants are all
--     service-role APIs; a client session cannot call one.

create function tonde.billing_checkout_start(target_workspace uuid, target_plan text, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan tonde.billing_plans; intent uuid; account tonde.billing_accounts;
begin
  -- Billing administration is an authority, not a membership: only a workspace admin may open one.
  if not tonde_private.is_workspace_admin(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into plan from tonde.billing_plans p where p.key = target_plan;
  if not found then raise exception 'That plan does not exist' using errcode = 'P0002'; end if;
  if plan.state <> 'active' then
    raise exception 'That plan is %, so it cannot be checked out', plan.state using errcode = 'PT409';
  end if;
  insert into tonde.billing_checkout_intents(workspace_id, plan_key, created_by, note)
  values (target_workspace, target_plan, auth.uid(), left(coalesce(note_text, ''), 600))
  returning id into intent;
  select * into account from tonde.billing_accounts b where b.workspace_id = target_workspace;
  perform tonde_private.audit_event(target_workspace, 'billing.checkout_initiated', intent,
    'billing_checkout_intent', jsonb_build_object('plan_key', target_plan,
      'provider', coalesce(account.provider, plan.provider), 'actor_user_id', auth.uid()));
  return jsonb_build_object('intent_id', intent, 'plan_key', target_plan, 'state', 'started',
    'provider', coalesce(nullif(account.provider, ''), plan.provider),
    'provider_price_id', plan.provider_price_id,
    'note', 'The provider session is created by the backend from this intent. Nothing is subscribed and no entitlement is granted until a verified provider event says so.');
end $$;

-- A verified provider event moves a subscription. The receipt must already exist and be signed for;
-- an older provider state can never overwrite a newer one.
create function tonde.billing_apply_subscription(target_workspace uuid, target_event uuid, target_state text,
  target_plan_key text default null, target_provider_customer_id text default null,
  target_provider_subscription_id text default null, target_current_period_end timestamptz default null,
  target_provider_state_at timestamptz default null, reason_text text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare account tonde.billing_accounts; receipt tonde.billing_webhook_events;
  new_state tonde.subscription_state; before_state tonde.subscription_state; sync jsonb;
  state_time timestamptz := coalesce(target_provider_state_at, now());
begin
  select * into receipt from tonde.billing_webhook_events w where w.id = target_event;
  if not found then
    raise exception 'A subscription change must name the verified webhook receipt it came from'
      using errcode = 'P0002';
  end if;
  if receipt.signature_verified_at is null then
    raise exception 'A subscription change requires a verified provider signature' using errcode = '42501';
  end if;
  if receipt.state in ('failed','ignored') then
    raise exception 'A webhook receipt in % cannot move a subscription', receipt.state
      using errcode = 'PT409';
  end if;
  if target_state not in ('none','trialing','active','past_due','incomplete','cancel_at_period_end',
    'cancelled','suspended') then
    raise exception 'That is not a subscription state' using errcode = '22023';
  end if;
  new_state := target_state::tonde.subscription_state;
  select * into account from tonde.billing_accounts b where b.workspace_id = target_workspace for update;
  if not found then
    -- A placeholder customer identity would collide across workspaces (`provider_customer_id` is
    -- unique), so a first subscription must carry the identity the provider actually assigned.
    if coalesce(btrim(target_provider_customer_id), '') = '' then
      raise exception 'A new subscription must name the provider customer identity it belongs to'
        using errcode = 'PT409';
    end if;
    insert into tonde.billing_accounts(workspace_id, provider, provider_customer_id, plan_reference)
    values (target_workspace, coalesce(nullif(btrim(receipt.provider), ''), 'unknown'),
      btrim(target_provider_customer_id), target_plan_key);
    select * into account from tonde.billing_accounts b where b.workspace_id = target_workspace for update;
  end if;
  before_state := account.subscription_status;
  -- Out-of-order delivery: an event describing an older provider state is recorded, not applied.
  if account.provider_state_at is not null and state_time < account.provider_state_at then
    insert into tonde.subscription_events(workspace_id, provider, from_state, to_state, actor,
      webhook_event_id, applied, reason, occurred_at)
    values (target_workspace, receipt.provider, before_state, new_state, 'webhook', target_event, false,
      'STALE_EVENT: the applied provider state is newer', state_time);
    return jsonb_build_object('applied', false, 'reason', 'STALE_EVENT',
      'state', before_state, 'provider_state_at', account.provider_state_at,
      'note', 'This event describes an older provider state and was recorded without applying it.');
  end if;
  update tonde.billing_accounts set subscription_status = new_state,
    provider_customer_id = coalesce(nullif(target_provider_customer_id, ''), provider_customer_id),
    provider_subscription_id = coalesce(nullif(target_provider_subscription_id, ''), provider_subscription_id),
    plan_reference = coalesce(target_plan_key, plan_reference),
    current_period_end = coalesce(target_current_period_end, current_period_end),
    cancel_at_period_end = (new_state = 'cancel_at_period_end'),
    provider_state_at = state_time, billing_admin_user_id = coalesce(billing_admin_user_id, auth.uid())
  where workspace_id = target_workspace;
  sync := tonde_private.billing_sync_entitlements(target_workspace);
  insert into tonde.subscription_events(workspace_id, provider, from_state, to_state, actor,
    webhook_event_id, applied, reason, occurred_at)
  values (target_workspace, receipt.provider, before_state, new_state, 'webhook', target_event, true,
    left(coalesce(reason_text, ''), 600), state_time);
  perform tonde_private.audit_event(target_workspace, 'subscription.changed', target_workspace,
    'billing_account', jsonb_build_object('from', before_state::text, 'to', new_state::text,
      'plan_key', account.plan_reference, 'webhook_event_id', target_event,
      'entitlements_granted', sync->'granted', 'entitlements_revoked', sync->'revoked'));
  return jsonb_build_object('applied', true, 'state', new_state, 'previous_state', before_state,
    'provider_state_at', state_time, 'entitlements', sync,
    'note', 'The subscription moved because a verified provider event said so.');
end $$;

create function tonde.billing_grant_entitlement(target_workspace uuid, target_key text,
  limit_amount numeric default null, note_text text default '', valid_until timestamptz default null,
  target_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare definition tonde.entitlement_definitions; account tonde.billing_accounts;
  -- A grant is an administrative decision, so it must name who made it. The trusted server has no
  -- session of its own, so it passes the administrator it is acting for; a grant that names nobody
  -- is not a decision and is refused rather than recorded anonymously.
  actor_user uuid := coalesce(target_actor, auth.uid());
begin
  select * into definition from tonde.entitlement_definitions d where d.key = target_key;
  if not found then raise exception 'That entitlement does not exist' using errcode = 'P0002'; end if;
  if actor_user is null then
    raise exception 'An entitlement grant must name the administrator who approved it' using errcode = '42501';
  end if;
  if limit_amount is not null and limit_amount < 0 then
    raise exception 'An entitlement limit cannot be negative' using errcode = '22023';
  end if;
  insert into tonde.workspace_entitlements(workspace_id, entitlement_key, source, plan_key, limit_amount,
    note, granted_by, valid_until)
  values (target_workspace, target_key, 'grant',
    (select b.plan_reference from tonde.billing_accounts b where b.workspace_id = target_workspace),
    limit_amount, left(coalesce(note_text, ''), 800), actor_user, valid_until)
  on conflict (workspace_id, entitlement_key) do update
    set source = 'grant', limit_amount = excluded.limit_amount, note = excluded.note,
      granted_by = excluded.granted_by, valid_until = excluded.valid_until, updated_at = now();
  perform tonde_private.audit_event(target_workspace, 'entitlement.changed', target_workspace,
    'workspace_entitlement', jsonb_build_object('entitlement', target_key, 'action', 'grant',
      'limit_amount', limit_amount, 'valid_until', valid_until, 'actor_user_id', actor_user));
  return jsonb_build_object('workspace_id', target_workspace, 'entitlement', target_key,
    'limit_amount', limit_amount, 'valid_until', valid_until, 'source', 'grant',
    'granted_by', actor_user);
end $$;

create function tonde.billing_revoke_entitlement(target_workspace uuid, target_key text,
  note_text text default '', target_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare removed integer; actor_user uuid := coalesce(target_actor, auth.uid());
begin
  delete from tonde.workspace_entitlements e
    where e.workspace_id = target_workspace and e.entitlement_key = target_key and e.source = 'grant';
  get diagnostics removed = row_count;
  perform tonde_private.audit_event(target_workspace, 'entitlement.changed', target_workspace,
    'workspace_entitlement', jsonb_build_object('entitlement', target_key, 'action', 'revoke',
      'removed', removed, 'note', left(coalesce(note_text, ''), 800), 'actor_user_id', actor_user));
  return jsonb_build_object('workspace_id', target_workspace, 'entitlement', target_key,
    'revoked', removed > 0, 'note', left(coalesce(note_text, ''), 800));
end $$;

-- Quota consumption. The row lock plus the constraint make overspending impossible, even if two
-- requests arrive at the same instant.
create function tonde.usage_reserve(target_workspace uuid, target_key text, target_amount numeric,
  target_operation text, note_text text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare entitlement tonde.workspace_entitlements; reservation uuid; remaining numeric;
begin
  if target_amount is null or target_amount <= 0 then
    raise exception 'A reservation must be for a positive amount' using errcode = '22023';
  end if;
  select * into entitlement from tonde.workspace_entitlements e
    where e.workspace_id = target_workspace and e.entitlement_key = target_key for update;
  if not found then
    raise exception 'This workspace holds no entitlement for %', target_key using errcode = 'PT409';
  end if;
  if entitlement.valid_until is not null and entitlement.valid_until <= now() then
    raise exception 'This entitlement expired' using errcode = 'PT409';
  end if;
  if entitlement.limit_amount is not null then
    remaining := entitlement.limit_amount - entitlement.consumed_amount - entitlement.reserved_amount;
    if remaining < target_amount then
      raise exception 'ENTITLEMENT_EXHAUSTED: % of % remains and % was requested', remaining, target_key,
        target_amount using errcode = 'PT409';
    end if;
  end if;
  update tonde.workspace_entitlements set reserved_amount = reserved_amount + target_amount
    where workspace_id = target_workspace and entitlement_key = target_key;
  insert into tonde.usage_reservations(workspace_id, entitlement_key, amount, operation_id, note)
  values (target_workspace, target_key, target_amount, left(coalesce(target_operation, ''), 200),
    left(coalesce(note_text, ''), 600))
  returning id into reservation;
  return jsonb_build_object('reservation_id', reservation, 'workspace_id', target_workspace,
    'entitlement', target_key, 'amount', target_amount, 'state', 'reserved',
    'remaining_after_reservation', case when entitlement.limit_amount is null then null
      else entitlement.limit_amount - entitlement.consumed_amount - entitlement.reserved_amount - target_amount end);
end $$;

create function tonde.usage_commit(target_workspace uuid, target_reservation uuid,
  actual_amount numeric default null, note_text text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare reservation tonde.usage_reservations; spend numeric;
begin
  select * into reservation from tonde.usage_reservations r
    where r.workspace_id = target_workspace and r.id = target_reservation for update;
  if not found then raise exception 'That reservation does not exist in this workspace' using errcode = 'P0002'; end if;
  if reservation.state <> 'reserved' then
    raise exception 'A reservation in % cannot be committed', reservation.state using errcode = 'PT409';
  end if;
  spend := coalesce(actual_amount, reservation.amount);
  if spend < 0 then raise exception 'A committed amount cannot be negative' using errcode = '22023'; end if;
  update tonde.workspace_entitlements set reserved_amount = reserved_amount - reservation.amount,
    consumed_amount = consumed_amount + spend
    where workspace_id = target_workspace and entitlement_key = reservation.entitlement_key;
  update tonde.usage_reservations set state = 'committed', actual_amount = spend, finished_at = now(),
    note = left(coalesce(note_text, note), 600)
    where id = target_reservation;
  return jsonb_build_object('reservation_id', target_reservation, 'state', 'committed',
    'reserved_amount', reservation.amount, 'consumed_amount', spend,
    'entitlement', reservation.entitlement_key,
    'note', case when spend = reservation.amount then 'The reserved amount was consumed.'
      else 'The reservation was settled at the amount that was actually used.' end);
end $$;

create function tonde.usage_release(target_workspace uuid, target_reservation uuid, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare reservation tonde.usage_reservations;
begin
  select * into reservation from tonde.usage_reservations r
    where r.workspace_id = target_workspace and r.id = target_reservation for update;
  if not found then raise exception 'That reservation does not exist in this workspace' using errcode = 'P0002'; end if;
  if reservation.state <> 'reserved' then
    raise exception 'A reservation in % cannot be released', reservation.state using errcode = 'PT409';
  end if;
  update tonde.workspace_entitlements set reserved_amount = reserved_amount - reservation.amount
    where workspace_id = target_workspace and entitlement_key = reservation.entitlement_key;
  update tonde.usage_reservations set state = 'released', finished_at = now(),
    note = left(coalesce(note_text, note), 600)
    where id = target_reservation;
  return jsonb_build_object('reservation_id', target_reservation, 'state', 'released',
    'released_amount', reservation.amount, 'entitlement', reservation.entitlement_key,
    'note', 'The reserved amount is available again.');
end $$;

-- Usage ingestion. Idempotent by the caller's key and by the provider event identity, and honest
-- about what the cost number is.
create function tonde.usage_record(target_workspace uuid, target_metric text, target_quantity numeric,
  target_unit text default 'operation', target_idempotency_key text default null,
  target_operation text default '', target_provider text default '', target_model text default '',
  target_production uuid default null, target_actor uuid default null,
  target_provider_cost numeric default null, target_estimated_cost numeric default null,
  target_price numeric default null, target_credit_units numeric default 0,
  target_currency text default 'USD', target_cost_basis text default 'unknown',
  target_source_event_id text default null, target_attempt uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare key text := coalesce(nullif(btrim(target_idempotency_key), ''),
    'usage:' || coalesce(nullif(target_source_event_id, ''), gen_random_uuid()::text));
  basis tonde.usage_cost_basis; existing tonde.usage_events; new_id uuid;
begin
  if target_quantity is null or target_quantity < 0 then
    raise exception 'A usage quantity cannot be negative' using errcode = '22023';
  end if;
  if target_cost_basis not in ('actual','estimated','unknown') then
    raise exception 'A cost basis is actual, estimated or unknown' using errcode = '22023';
  end if;
  basis := target_cost_basis::tonde.usage_cost_basis;
  -- Two identities can name the same consumption: the caller's key and the external event it came
  -- from. Either one alone must be enough to recognise a repeat, or a retry without a key would be
  -- counted twice and a retry with the same key would raise a unique violation instead of answering.
  if nullif(btrim(target_source_event_id), '') is not null then
    select * into existing from tonde.usage_events e
      where e.workspace_id = target_workspace and e.source_event_id = btrim(target_source_event_id);
    if found then
      return jsonb_build_object('usage_event_id', existing.id, 'recorded', false, 'duplicate', true,
        'metric', existing.metric,
        'note', 'This provider event was already counted; nothing was counted twice.');
    end if;
  end if;
  select * into existing from tonde.usage_events e
    where e.workspace_id = target_workspace and e.idempotency_key = key;
  if found then
    return jsonb_build_object('usage_event_id', existing.id, 'recorded', false, 'duplicate', true,
      'metric', existing.metric, 'note', 'This exact usage was already recorded; nothing was counted twice.');
  end if;
  if basis = 'actual' and target_provider_cost is null then
    raise exception 'An actual provider cost must carry the amount the provider reported'
      using errcode = '23514';
  end if;
  if basis = 'unknown' and (target_provider_cost is not null or target_estimated_cost is not null) then
    raise exception 'An unknown cost basis cannot carry a cost' using errcode = '23514';
  end if;
  insert into tonde.usage_events(workspace_id, metric, quantity, unit, idempotency_key, operation, provider,
    model, production_id, actor_user_id, provider_cost, estimated_cost, price_amount, credit_units,
    currency, cost_basis, source_event_id, attempt_id)
  values (target_workspace, left(target_metric, 120), target_quantity, left(coalesce(target_unit, 'operation'), 40),
    left(key, 200), left(coalesce(target_operation, ''), 120), left(coalesce(target_provider, ''), 60),
    left(coalesce(target_model, ''), 120), target_production, target_actor, target_provider_cost,
    target_estimated_cost, target_price, coalesce(target_credit_units, 0), upper(left(coalesce(target_currency, 'USD'), 3)),
    basis, nullif(btrim(target_source_event_id), ''), target_attempt)
  returning id into new_id;
  perform tonde_private.audit_event(target_workspace, 'usage.recorded', new_id, 'usage_event',
    jsonb_build_object('metric', target_metric, 'quantity', target_quantity, 'unit', target_unit,
      'provider', target_provider, 'model', target_model, 'cost_basis', target_cost_basis,
      'provider_cost', target_provider_cost, 'estimated_cost', target_estimated_cost,
      'price_amount', target_price, 'credit_units', target_credit_units));
  return jsonb_build_object('usage_event_id', new_id, 'recorded', true, 'duplicate', false,
    'metric', target_metric, 'cost_basis', target_cost_basis, 'quantity', target_quantity);
end $$;

-- 11. Webhook ingestion. Receive → verify witness → deduplicate → process → record the result.
create function tonde.billing_webhook_receive(target_provider text, target_event_id text,
  target_event_type text, target_event_created_at timestamptz, target_signature_scheme text,
  target_signature_verified_at timestamptz, target_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare receipt tonde.billing_webhook_events;
begin
  if coalesce(btrim(target_signature_scheme), '') = '' or target_signature_verified_at is null then
    raise exception 'A webhook receipt must record the signature verification that was performed'
      using errcode = '42501';
  end if;
  if target_event_created_at is null then
    raise exception 'A webhook receipt must record when the provider created the event'
      using errcode = '22023';
  end if;
  select * into receipt from tonde.billing_webhook_events w
    where w.provider = target_provider and w.provider_event_id = target_event_id;
  if found then
    return jsonb_build_object('event_id', receipt.id, 'duplicate', true, 'state', receipt.state,
      'note', 'This provider event was already received; processing it again would double-count it.');
  end if;
  insert into tonde.billing_webhook_events(provider, provider_event_id, event_type, signature_scheme,
    signature_verified_at, event_created_at, payload)
  values (left(target_provider, 60), left(target_event_id, 200), left(target_event_type, 200),
    left(target_signature_scheme, 80), target_signature_verified_at, target_event_created_at,
    coalesce(target_payload, '{}'::jsonb))
  returning * into receipt;
  return jsonb_build_object('event_id', receipt.id, 'duplicate', false, 'state', 'received',
    'note', 'The receipt is recorded. Processing is a separate, recorded step.');
end $$;

create function tonde.billing_webhook_finish(target_event uuid, target_state text,
  target_message text default null, target_workspace uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare receipt tonde.billing_webhook_events; audited boolean := false;
begin
  if target_state not in ('processing','processed','failed','ignored') then
    raise exception 'A webhook receipt is processed, failed or ignored' using errcode = '22023';
  end if;
  select * into receipt from tonde.billing_webhook_events w where w.id = target_event for update;
  if not found then raise exception 'That webhook receipt does not exist' using errcode = 'P0002'; end if;
  update tonde.billing_webhook_events set state = target_state::tonde.webhook_state,
    processing_started_at = case when target_state = 'processing' then coalesce(processing_started_at, now())
      else processing_started_at end,
    processed_at = case when target_state in ('processed','failed','ignored') then now() else processed_at end,
    failure_message = case when target_state = 'failed' then left(coalesce(target_message, ''), 2000) end
  where id = target_event;
  -- The caller names the workspace the event concerned. A provider-level event that belongs to no
  -- TONDE workspace is still recorded on the receipt; it is simply not attributed to one, because
  -- guessing a workspace from "the first account on this provider" would be a false attribution.
  if target_workspace is not null then
    perform tonde_private.audit_event(target_workspace,
      case when target_state = 'failed' then 'webhook.failed' when target_state = 'ignored' then 'webhook.ignored'
        else 'webhook.processed' end, target_event, 'billing_webhook_event',
      jsonb_build_object('provider', receipt.provider, 'event_type', receipt.event_type, 'state', target_state));
    audited := true;
  end if;
  return jsonb_build_object('event_id', target_event, 'state', target_state, 'audited', audited,
    'note', case when audited then 'The receipt records what happened; failure is kept rather than discarded.'
      else 'The receipt records what happened; this event named no workspace, so no workspace history was written.' end);
end $$;

-- 12. Read surfaces. Billing status is an administrator view; the entitlement answer is member-scoped
--     so a surface can explain an unavailable feature instead of hiding it silently.
create function tonde.billing_status(target_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare account tonde.billing_accounts; plan tonde.billing_plans; entitlements jsonb; pending jsonb;
begin
  if not tonde_private.is_workspace_admin(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into account from tonde.billing_accounts b where b.workspace_id = target_workspace;
  if account.plan_reference is not null then
    select * into plan from tonde.billing_plans p where p.key = account.plan_reference;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', e.entitlement_key, 'name', d.name, 'kind', d.kind,
      'unit', d.unit, 'source', e.source, 'limit_amount', e.limit_amount,
      'consumed_amount', e.consumed_amount, 'reserved_amount', e.reserved_amount,
      'remaining', case when e.limit_amount is null then null
        else e.limit_amount - e.consumed_amount - e.reserved_amount end,
      'valid_until', e.valid_until) order by e.entitlement_key), '[]'::jsonb) into entitlements
    from tonde.workspace_entitlements e join tonde.entitlement_definitions d on d.key = e.entitlement_key
    where e.workspace_id = target_workspace;
  select coalesce(jsonb_agg(jsonb_build_object('intent_id', i.id, 'plan_key', i.plan_key, 'state', i.state,
      'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb) into pending
    from tonde.billing_checkout_intents i where i.workspace_id = target_workspace and i.state = 'started';
  return jsonb_build_object('workspace_id', target_workspace,
    'subscription', jsonb_build_object('state', coalesce(account.subscription_status::text, 'none'),
      'plan_key', account.plan_reference, 'plan_name', plan.name,
      'cancel_at_period_end', coalesce(account.cancel_at_period_end, false),
      'current_period_end', account.current_period_end,
      'provider_state_at', account.provider_state_at,
      'grants_entitlements', account.workspace_id is not null
        and tonde_private.subscription_grants_entitlements(account.subscription_status)),
    'provider', jsonb_build_object('name', coalesce(account.provider, ''), 'configured',
      coalesce(nullif(account.provider, ''), '') <> ''),
    'entitlements', entitlements, 'open_checkouts', pending,
    'note', 'Commercial facts come from verified provider events. This surface never edits them.');
end $$;

-- 13. Exposure. Catalog rows are readable; workspace rows are administrator-readable; webhook
--     receipts and reservations are server-only. No client role holds any write grant.
alter table tonde.entitlement_definitions enable row level security;
alter table tonde.billing_plans enable row level security;
alter table tonde.plan_entitlements enable row level security;
alter table tonde.workspace_entitlements enable row level security;
alter table tonde.subscription_events enable row level security;
alter table tonde.billing_checkout_intents enable row level security;
alter table tonde.billing_webhook_events enable row level security;
alter table tonde.usage_reservations enable row level security;
create policy catalog_read on tonde.entitlement_definitions for select to authenticated using (true);
create policy catalog_read on tonde.billing_plans for select to authenticated using (true);
create policy catalog_read on tonde.plan_entitlements for select to authenticated using (true);
create policy admin_read on tonde.workspace_entitlements for select to authenticated
  using (tonde_private.is_workspace_admin(workspace_id));
create policy admin_read on tonde.subscription_events for select to authenticated
  using (tonde_private.is_workspace_admin(workspace_id));
create policy admin_read on tonde.billing_checkout_intents for select to authenticated
  using (tonde_private.is_workspace_admin(workspace_id));
create policy admin_read on tonde.usage_reservations for select to authenticated
  using (tonde_private.is_workspace_admin(workspace_id));
grant select on tonde.entitlement_definitions, tonde.billing_plans, tonde.plan_entitlements,
  tonde.workspace_entitlements, tonde.subscription_events, tonde.billing_checkout_intents,
  tonde.usage_reservations to authenticated;
grant all on tonde.entitlement_definitions, tonde.billing_plans, tonde.plan_entitlements,
  tonde.workspace_entitlements, tonde.subscription_events, tonde.billing_checkout_intents,
  tonde.billing_webhook_events, tonde.usage_reservations to service_role;

-- 14. Function grants. Creator/admin read surfaces are authenticated; everything that writes
--     commercial state is service-role only.
revoke all on function tonde.billing_checkout_start(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.billing_apply_subscription(uuid,uuid,text,text,text,text,timestamptz,timestamptz,text) from public, anon, authenticated, service_role;
revoke all on function tonde.billing_grant_entitlement(uuid,text,numeric,text,timestamptz,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.billing_revoke_entitlement(uuid,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.usage_reserve(uuid,text,numeric,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.usage_commit(uuid,uuid,numeric,text) from public, anon, authenticated, service_role;
revoke all on function tonde.usage_release(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function tonde.usage_record(uuid,text,numeric,text,text,text,text,text,uuid,uuid,numeric,numeric,numeric,numeric,text,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.billing_webhook_receive(text,text,text,timestamptz,text,timestamptz,jsonb) from public, anon, authenticated, service_role;
revoke all on function tonde.billing_webhook_finish(uuid,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.billing_status(uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.billing_checkout_start(uuid,text,text) to authenticated;
grant execute on function tonde.billing_status(uuid) to authenticated;
grant execute on function tonde.billing_apply_subscription(uuid,uuid,text,text,text,text,timestamptz,timestamptz,text) to service_role;
grant execute on function tonde.billing_grant_entitlement(uuid,text,numeric,text,timestamptz,uuid) to service_role;
grant execute on function tonde.billing_revoke_entitlement(uuid,text,text,uuid) to service_role;
grant execute on function tonde.usage_reserve(uuid,text,numeric,text,text) to service_role;
grant execute on function tonde.usage_commit(uuid,uuid,numeric,text) to service_role;
grant execute on function tonde.usage_release(uuid,uuid,text) to service_role;
grant execute on function tonde.usage_record(uuid,text,numeric,text,text,text,text,text,uuid,uuid,numeric,numeric,numeric,numeric,text,text,text,uuid) to service_role;
grant execute on function tonde.billing_webhook_receive(text,text,text,timestamptz,text,timestamptz,jsonb) to service_role;
grant execute on function tonde.billing_webhook_finish(uuid,text,text,uuid) to service_role;
alter default privileges in schema tonde revoke execute on functions from public;
commit;
