-- 017 - Prompt 7 -- TONDE AI CREATION & HYBRID DIRECTOR
--
-- One Master Production. AI Creation is a face of the same Production, and SHOOT /
-- GENERATE / SHOOT + AI are execution methods of the same canonical Shot. This
-- migration adds no second Production, Scene or Shot model.
--
-- Capability truth is a first-class rule here. TONDE holds NO vendor capability
-- facts of its own: a model profile carries capability metadata only when it was
-- declared for a workspace or reported by a connected provider. Everything else is
-- UNKNOWN or REQUIRES CONNECTION, and routing says so rather than guessing from a
-- model name. No pricing is fabricated: cost is 'known' only when a profile carries
-- a verified amount, otherwise it is 'unknown'.
--
-- Additive and forward-only. Migrations 001-016 are untouched.
begin;

-- 1. Vocabulary. Uppercase capability states match the epistemic labels migration 016
-- already uses for claims.
create type tonde.ai_capability_state as enum
  ('SUPPORTED','PARTIALLY SUPPORTED','UNSUPPORTED','UNKNOWN','REQUIRES CONNECTION');
create type tonde.ai_operation as enum
  ('image','video','image_to_video','video_to_video','voice','speech','music','sound_effect',
   'upscale','background_removal','image_edit','frame_interpolation','lipsync','compositing');
create type tonde.ai_connection_state as enum ('not_connected','connected','unavailable');
create type tonde.ai_readiness as enum
  ('unplanned','stale','needs_reference','needs_model','needs_decision','unsupported',
   'provider_not_connected','cost_confirmation','ready_to_generate','manual_export');
create type tonde.ai_attempt_status as enum
  ('planned','queued','submitted','processing','succeeded','partial','failed','cancelled','expired');
create type tonde.ai_attempt_mode as enum ('live','manual');
create type tonde.ai_lock_scope as enum ('character','world','product','style');
create type tonde.ai_continuity_priority as enum ('MUST PRESERVE','SHOULD PRESERVE','FLEXIBLE');
create type tonde.ai_reference_role as enum
  ('face','full_body','profile','wardrobe','expression','pose','lighting_neutral',
   'environment','product','style','first_frame','last_frame','storyboard','plate','voice');
create type tonde.ai_batch_scope as enum ('shot','scene','selection','production');
create type tonde.ai_batch_state as enum ('confirmed','running','partial','succeeded','failed','cancelled');
create type tonde.ai_batch_item_state as enum ('pending','blocked','submitted','succeeded','failed','skipped');

-- 2. Provider catalog. Identity only: which providers exist and whether using them
-- needs a connection. There is deliberately no capability column here, so a provider
-- name can never imply a capability.
create table tonde.ai_providers (
  key text primary key check (length(key) between 1 and 60),
  label text not null check (length(label) between 1 and 120),
  connection_required boolean not null default true,
  manual_export_supported boolean not null default true,
  note text not null default '' check (length(note) <= 600),
  created_at timestamptz not null default now()
);
insert into tonde.ai_providers(key, label, connection_required, note) values
  ('manual', 'Manual export', false, 'No connection. TONDE compiles the prompt, references and settings for you to run yourself.'),
  ('runway', 'Runway', true, 'TONDE holds no capability facts for this provider until you declare them or it reports them.'),
  ('kling', 'Kling', true, 'TONDE holds no capability facts for this provider until you declare them or it reports them.'),
  ('veo', 'Veo', true, 'TONDE holds no capability facts for this provider until you declare them or it reports them.'),
  ('sora', 'Sora', true, 'TONDE holds no capability facts for this provider until you declare them or it reports them.'),
  ('midjourney', 'Midjourney', true, 'TONDE holds no capability facts for this provider until you declare them or it reports them.'),
  ('flux', 'FLUX', true, 'TONDE holds no capability facts for this provider until you declare them or it reports them.'),
  ('elevenlabs', 'ElevenLabs', true, 'TONDE holds no capability facts for this provider until you declare them or it reports them.');

-- 3. Model capability profiles, separate from provider account configuration.
-- workspace_id is null for TONDE's own catalog and non-null for a model the creator
-- declared. 'TONDE KNOWS THIS MODEL', 'USER HAS THIS MODEL AVAILABLE' and 'TONDE IS
-- CONNECTED TO THIS PROVIDER' are three different facts and are never conflated.
create table tonde.ai_model_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references tonde.workspaces(id) on delete restrict,
  provider_key text not null references tonde.ai_providers(key) on delete restrict,
  model_key text not null check (length(model_key) between 1 and 120),
  label text not null default '' check (length(label) <= 160),
  operation tonde.ai_operation not null,
  capability_state tonde.ai_capability_state not null default 'UNKNOWN',
  modalities text[] not null default '{}',
  supports_image_reference boolean not null default false,
  max_reference_images integer check (max_reference_images >= 0),
  supports_first_frame boolean not null default false,
  supports_last_frame boolean not null default false,
  supports_seed boolean not null default false,
  supports_negative_prompt boolean not null default false,
  supports_camera_control boolean not null default false,
  supports_audio boolean not null default false,
  supports_image_edit boolean not null default false,
  supports_lipsync boolean not null default false,
  max_duration_ms bigint check (max_duration_ms is null or max_duration_ms > 0),
  aspect_ratios text[] not null default '{}',
  resolutions text[] not null default '{}',
  cost_unit text not null default '' check (length(cost_unit) <= 80),
  cost_amount numeric(12,4) check (cost_amount is null or cost_amount >= 0),
  cost_currency text not null default '' check (length(cost_currency) <= 8),
  cost_known boolean not null default false,
  speed_note text not null default '' check (length(speed_note) <= 300),
  identity_note text not null default '' check (length(identity_note) <= 300),
  product_fidelity_note text not null default '' check (length(product_fidelity_note) <= 300),
  availability text not null default 'unknown' check (availability in ('available','deprecated','unknown')),
  safety_note text not null default '' check (length(safety_note) <= 600),
  capability_notes jsonb not null default '{}'::jsonb check (jsonb_typeof(capability_notes) = 'object'),
  source text not null default 'declared' check (source in ('declared','provider','catalog')),
  declared_by uuid references auth.users(id) on delete set null,
  lifecycle tonde.lifecycle not null default 'active',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  -- A capability claim is only as strong as its declaration: a profile that claims
  -- SUPPORTED must say where the claim came from.
  check (capability_state <> 'SUPPORTED' or source in ('declared','provider'))
);
create unique index ai_model_profiles_global_key on tonde.ai_model_profiles(provider_key, model_key, operation)
  where workspace_id is null;
create unique index ai_model_profiles_workspace_key on tonde.ai_model_profiles(workspace_id, provider_key, model_key, operation)
  where workspace_id is not null;
create index ai_model_profiles_by_workspace on tonde.ai_model_profiles(workspace_id, provider_key);

-- 4. Provider connection state, per workspace. A credential *reference* only: the
-- migration stores no secret and TONDE reads none.
create table tonde.ai_provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  provider_key text not null references tonde.ai_providers(key) on delete restrict,
  state tonde.ai_connection_state not null default 'not_connected',
  credential_reference text not null default '' check (length(credential_reference) <= 200),
  note text not null default '' check (length(note) <= 600),
  last_checked_at timestamptz,
  connected_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, provider_key), unique (workspace_id, id)
);

-- 5. AI execution plans extend the existing per-Shot execution plan, exactly as the
-- Real plan does. One Shot, one AI plan; the shared camera/lighting/performance
-- columns are reused so both faces describe the same Shot in the same language.
-- Readiness is COMPUTED from declared facts and never stored, exactly as derived timing
-- is computed in migration 015: a cached readiness column would go stale the moment a
-- reference, connection or Shot revision changed.
alter table tonde.execution_plans add column prompt_version integer not null default 0 check (prompt_version >= 0);
alter table tonde.execution_plans add column source_shot_revision integer
  check (source_shot_revision is null or source_shot_revision > 0);
alter table tonde.execution_plans add column source_versions jsonb not null default '{}'::jsonb
  check (jsonb_typeof(source_versions) = 'object');
alter table tonde.execution_plans add column canonical_prompt jsonb not null default '{}'::jsonb
  check (jsonb_typeof(canonical_prompt) = 'object');
alter table tonde.execution_plans add column provider_prompt text not null default ''
  check (length(provider_prompt) <= 8000);
alter table tonde.execution_plans add column provider_prompt_edited boolean not null default false;
alter table tonde.execution_plans add column provider_prompt_edited_at timestamptz;
alter table tonde.execution_plans add column provider_target text;
alter table tonde.execution_plans add column model_profile_id uuid;
alter table tonde.execution_plans add column fallback_model_profile_id uuid;
alter table tonde.execution_plans add column routing jsonb not null default '{}'::jsonb
  check (jsonb_typeof(routing) = 'object');
alter table tonde.execution_plans add column first_frame jsonb not null default '{}'::jsonb
  check (jsonb_typeof(first_frame) = 'object');
alter table tonde.execution_plans add column last_frame jsonb not null default '{}'::jsonb
  check (jsonb_typeof(last_frame) = 'object');
alter table tonde.execution_plans add column motion jsonb not null default '{}'::jsonb
  check (jsonb_typeof(motion) = 'object');
alter table tonde.execution_plans add column audio jsonb not null default '{}'::jsonb
  check (jsonb_typeof(audio) = 'object');
alter table tonde.execution_plans add column continuity jsonb not null default '{}'::jsonb
  check (jsonb_typeof(continuity) = 'object');
alter table tonde.execution_plans add column hybrid jsonb not null default '{}'::jsonb
  check (jsonb_typeof(hybrid) = 'object');
alter table tonde.execution_plans add column negative_constraints text[] not null default '{}';
alter table tonde.execution_plans add column limitations text[] not null default '{}';
alter table tonde.execution_plans add column aspect_ratio text not null default ''
  check (length(aspect_ratio) <= 20);
alter table tonde.execution_plans add column cost_state text not null default 'unknown'
  check (cost_state in ('known','unknown'));
alter table tonde.execution_plans add column cost_amount numeric(12,4)
  check (cost_amount is null or cost_amount >= 0);
alter table tonde.execution_plans add column cost_currency text not null default ''
  check (length(cost_currency) <= 8);
alter table tonde.execution_plans add column cost_note text not null default ''
  check (length(cost_note) <= 400);
alter table tonde.execution_plans add column model_version text not null default ''
  check (length(model_version) <= 120);

-- 6. Reference assets attached to one AI plan, with the role they serve. Prompts
-- carry only the references that are relevant; the continuity packet selects them.
create table tonde.ai_shot_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null, shot_id uuid not null, plan_id uuid not null,
  reference_role tonde.ai_reference_role not null,
  priority tonde.ai_continuity_priority not null default 'SHOULD PRESERVE',
  asset_id uuid, media_id uuid,
  origin text not null default 'asset'
    check (origin in ('asset','upload','generated_result','storyboard','captured_frame','composite')),
  source_attempt_id uuid,
  note text not null default '' check (length(note) <= 400),
  sort_order bigint not null default 1024 check (sort_order >= 0),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (num_nonnulls(asset_id, media_id) = 1),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict,
  foreign key (workspace_id, asset_id) references tonde.assets(workspace_id, id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict
);
create index ai_shot_references_by_plan on tonde.ai_shot_references(workspace_id, plan_id);

-- 7. Continuity locks. A lock states what must stay true across Shots and what the
-- Director may vary without asking.
create table tonde.ai_continuity_locks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null,
  scope tonde.ai_lock_scope not null,
  subject_id uuid, label text not null default '' check (length(label) <= 200),
  locked boolean not null default true,
  priority tonde.ai_continuity_priority not null default 'MUST PRESERVE',
  locked_traits text[] not null default '{}',
  allowed_variations text[] not null default '{}',
  prohibited_changes text[] not null default '{}',
  identity_truth text not null default '' check (length(identity_truth) <= 400),
  consent_note text not null default '' check (length(consent_note) <= 400),
  note text not null default '' check (length(note) <= 600),
  locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, subject_id) references tonde.assets(workspace_id, id) on delete restrict
);
create unique index ai_continuity_locks_by_subject on tonde.ai_continuity_locks(workspace_id, production_id, scope, subject_id)
  where subject_id is not null;
create unique index ai_continuity_locks_by_scope on tonde.ai_continuity_locks(workspace_id, production_id, scope)
  where subject_id is null;
create index ai_continuity_locks_by_production on tonde.ai_continuity_locks(workspace_id, production_id);

-- 8. Generation attempts. Every external generation is a first-class record, and the
-- idempotency key is what stops a retry from spending money twice.
create table tonde.ai_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null, shot_id uuid not null,
  plan_id uuid not null,
  operation tonde.ai_operation not null,
  attempt_number integer not null check (attempt_number > 0),
  provider_key text not null,
  model_profile_id uuid,
  model_key text not null default '' check (length(model_key) <= 120),
  model_version text not null default '' check (length(model_version) <= 120),
  prompt_version integer not null default 0 check (prompt_version >= 0),
  source_shot_revision integer check (source_shot_revision is null or source_shot_revision > 0),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  mode tonde.ai_attempt_mode not null default 'live',
  status tonde.ai_attempt_status not null default 'planned',
  external_job_id text check (external_job_id is null or length(external_job_id) <= 200),
  seed bigint,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  input_references jsonb not null default '[]'::jsonb check (jsonb_typeof(input_references) = 'array'),
  request_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(request_summary) = 'object'),
  cost_state text not null default 'unknown' check (cost_state in ('known','unknown')),
  cost_amount numeric(12,4) check (cost_amount is null or cost_amount >= 0),
  cost_currency text not null default '' check (length(cost_currency) <= 8),
  retryable boolean not null default false,
  retry_of uuid,
  started_at timestamptz, completed_at timestamptz,
  failure_code text not null default '' check (length(failure_code) <= 80),
  failure_message text not null default '' check (length(failure_message) <= 800),
  output_media_id uuid, result_id uuid,
  result_state tonde.result_state not null default 'raw',
  selected boolean not null default false,
  creator_rating integer check (creator_rating between 1 and 5),
  creator_decision text not null default '' check (creator_decision in ('','keep','reject','needs_review')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key), unique (workspace_id, id),
  unique (workspace_id, shot_id, attempt_number),
  -- Cost is either a known amount or unknown. There is no third state and no zero.
  check (cost_state <> 'known' or (cost_amount is not null and cost_currency <> '')),
  check (cost_state <> 'unknown' or cost_amount is null),
  -- A finished attempt named a real output; a failed one says why.
  check (status not in ('succeeded','partial') or output_media_id is not null),
  check (status <> 'failed' or failure_code <> ''),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict,
  foreign key (workspace_id, model_profile_id) references tonde.ai_model_profiles(workspace_id, id) on delete restrict,
  foreign key (workspace_id, retry_of) references tonde.ai_generation_attempts(workspace_id, id) on delete restrict,
  foreign key (workspace_id, output_media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  foreign key (workspace_id, result_id) references tonde.results(workspace_id, id) on delete restrict
);
-- One selected Result per Shot. Selected means "chosen current output", not approved.
create unique index ai_generation_attempts_selected on tonde.ai_generation_attempts(workspace_id, shot_id)
  where selected;
create index ai_generation_attempts_by_shot on tonde.ai_generation_attempts(workspace_id, production_id, shot_id, attempt_number);
create index ai_generation_attempts_by_job on tonde.ai_generation_attempts(workspace_id, external_job_id)
  where external_job_id is not null;
-- Submission dedupe that does not depend on the provider: one live attempt per
-- (shot, prompt version, model) may be in flight at a time.
create unique index ai_generation_attempts_in_flight on tonde.ai_generation_attempts(workspace_id, shot_id, prompt_version, provider_key, model_key)
  where status in ('queued','submitted','processing');

-- 9. Batch generation. A batch is a durable job with per-Shot items, so eight of ten
-- successes are preserved when two fail.
create table tonde.ai_generation_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null,
  scope tonde.ai_batch_scope not null,
  scene_id uuid,
  state tonde.ai_batch_state not null default 'confirmed',
  confirmation_required boolean not null default false,
  confirmation_note text not null default '' check (length(confirmation_note) <= 400),
  confirmed_at timestamptz, confirmed_by uuid,
  cost_state text not null default 'unknown' check (cost_state in ('known','unknown')),
  estimated_cost_amount numeric(12,4),
  estimated_cost_currency text not null default '' check (length(estimated_cost_currency) <= 8),
  shot_count integer not null default 0 check (shot_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  unknown_cost_count integer not null default 0 check (unknown_cost_count >= 0),
  note text not null default '' check (length(note) <= 600),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (cost_state <> 'known' or estimated_cost_amount is not null),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, scene_id) references tonde.scenes(workspace_id, id) on delete restrict
);
create table tonde.ai_generation_batch_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null,
  batch_id uuid not null, shot_id uuid not null,
  state tonde.ai_batch_item_state not null default 'pending',
  blocked_reason text not null default '' check (length(blocked_reason) <= 200),
  attempt_id uuid,
  cost_state text not null default 'unknown' check (cost_state in ('known','unknown')),
  cost_amount numeric(12,4),
  cost_currency text not null default '' check (length(cost_currency) <= 8),
  failure_code text not null default '' check (length(failure_code) <= 80),
  failure_message text not null default '' check (length(failure_message) <= 800),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (batch_id, shot_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, batch_id) references tonde.ai_generation_batches(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, attempt_id) references tonde.ai_generation_attempts(workspace_id, id) on delete restrict
);
create index ai_generation_batch_items_by_batch on tonde.ai_generation_batch_items(workspace_id, batch_id);

-- Material external spend is confirmed by a creator, not assumed. Confirmation is kept
-- beside the plan rather than inside it so that confirming cost never rewrites plan
-- content or invalidates an approval.
create table tonde.ai_cost_confirmations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null, shot_id uuid not null,
  prompt_version integer not null check (prompt_version > 0),
  provider_key text not null, model_key text not null default '' check (length(model_key) <= 120),
  cost_state text not null default 'unknown' check (cost_state in ('known','unknown')),
  cost_amount numeric(12,4), cost_currency text not null default '' check (length(cost_currency) <= 8),
  note text not null default '' check (length(note) <= 400),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, shot_id, prompt_version),
  check (cost_state <> 'known' or (cost_amount is not null and cost_currency <> '')),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict
);

-- 10. Row guards: the shared mutation guard (identity immutability, revision
-- management, lock enforcement, approval invalidation) on every new table.
do $$ declare item text; begin
  foreach item in array array['ai_model_profiles','ai_provider_connections','ai_shot_references',
    'ai_continuity_locks','ai_generation_attempts','ai_generation_batches','ai_generation_batch_items',
    'ai_cost_confirmations'] loop
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', item);
  end loop;
end $$;

-- 11. RLS. Enabling RLS is not optional: policies are inert without it. The provider
-- catalog is global reference data; every other table is tenant-scoped.
alter table tonde.ai_providers enable row level security;
create policy catalog_read on tonde.ai_providers for select to authenticated using (true);
grant select on tonde.ai_providers to authenticated;

alter table tonde.ai_model_profiles enable row level security;
create policy catalog_read on tonde.ai_model_profiles for select to authenticated
  using (workspace_id is null or tonde_private.is_workspace_member(workspace_id));
create policy tenant_insert on tonde.ai_model_profiles for insert to authenticated
  with check (workspace_id is not null and tonde_private.can_edit_workspace(workspace_id));
create policy tenant_update on tonde.ai_model_profiles for update to authenticated
  using (workspace_id is not null and tonde_private.can_edit_workspace(workspace_id))
  with check (workspace_id is not null and tonde_private.can_edit_workspace(workspace_id));
grant select, insert, update on tonde.ai_model_profiles to authenticated;

do $$ declare item text; begin
  foreach item in array array['ai_provider_connections','ai_shot_references','ai_continuity_locks',
    'ai_generation_attempts','ai_generation_batches','ai_generation_batch_items',
    'ai_cost_confirmations'] loop
    execute format('alter table tonde.%I enable row level security', item);
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', item);
    execute format('create policy tenant_insert on tonde.%I for insert to authenticated with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('create policy tenant_update on tonde.%I for update to authenticated using (tonde_private.can_edit_workspace(workspace_id)) with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('grant select, insert, update on tonde.%I to authenticated', item);
  end loop;
end $$;
-- A planned attempt that was never submitted is a log entry the creator may remove;
-- a submitted one is spend and history, and stays.
create policy tenant_delete on tonde.ai_generation_attempts for delete to authenticated
  using (tonde_private.can_edit_workspace(workspace_id) and status in ('planned','cancelled','expired'));
grant delete on tonde.ai_generation_attempts to authenticated;

-- 12. Private helpers. Not user-facing: revoked from every role and reachable only
-- through the security-definer RPCs below.
create function tonde_private.ai_json_bool(source jsonb, key text, fallback boolean) returns boolean
language sql immutable set search_path = '' as $$
  select case when source ? key and jsonb_typeof(source -> key) = 'boolean'
    then (source ->> key)::boolean else fallback end;
$$;
create function tonde_private.ai_json_int(source jsonb, key text) returns integer
language sql immutable set search_path = '' as $$
  select case when source ? key and jsonb_typeof(source -> key) = 'number'
    then (source ->> key)::integer else null end;
$$;
create function tonde_private.ai_json_text_array(source jsonb, key text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(source -> key, '[]'::jsonb))), '{}'::text[]);
$$;
revoke all on function tonde_private.ai_json_bool(jsonb,text,boolean), tonde_private.ai_json_int(jsonb,text),
  tonde_private.ai_json_text_array(jsonb,text) from public, anon, authenticated, service_role;

-- Connection truth for one provider in one workspace, as a stable JSON document.
create function tonde_private.ai_connection(target_workspace uuid, target_provider text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('provider_key', c.provider_key, 'state', c.state,
      'credential_reference', c.credential_reference, 'note', c.note,
      'connected_at', c.connected_at, 'last_checked_at', c.last_checked_at)
    from tonde.ai_provider_connections c
    where c.workspace_id = target_workspace and c.provider_key = target_provider),
    jsonb_build_object('provider_key', target_provider, 'state', 'not_connected',
      'credential_reference', '', 'note', 'No connection is declared for this provider in this workspace.',
      'connected_at', null, 'last_checked_at', null));
$$;
revoke all on function tonde_private.ai_connection(uuid,text) from public, anon, authenticated, service_role;

-- Primary operation required by a Shot's intent, derived from what the Shot asks for.
create function tonde_private.ai_primary_operation(target_workspace uuid, target_production uuid, target_shot uuid)
returns tonde.ai_operation language sql stable security definer set search_path = '' as $$
  select case
    when h.execution_method = 'hybrid' then 'image_to_video'::tonde.ai_operation
    when coalesce(pl.audio -> 'narration' ->> 'needed', 'false') = 'true' then 'speech'::tonde.ai_operation
    when coalesce(pl.motion ->> 'needed', 'false') = 'true' then 'image_to_video'::tonde.ai_operation
    else 'video'::tonde.ai_operation
  end
  from tonde.shots h
  left join tonde.execution_plans pl on pl.workspace_id = h.workspace_id and pl.shot_id = h.id
    and pl.execution_method = 'ai'
  where h.workspace_id = target_workspace and h.production_id = target_production and h.id = target_shot;
$$;
revoke all on function tonde_private.ai_primary_operation(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- Deterministic AI readiness. Declared facts only, and every blocking reason is a
-- fact the creator can act on rather than a score.
create function tonde_private.ai_readiness_state(target_workspace uuid, target_production uuid, target_shot uuid)
returns tonde.ai_readiness language plpgsql stable security definer set search_path = '' as $$
declare plan_row tonde.execution_plans; shot_revision integer; shot_method tonde.execution_method;
  connection_state tonde.ai_connection_state; profile tonde.ai_model_profiles;
  must_references integer; present_references integer;
begin
  select revision, execution_method into shot_revision, shot_method from tonde.shots
    where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  if not found then return 'unplanned'; end if;
  if shot_method = 'real' then return 'unplanned'; end if;
  select * into plan_row from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if not found then return 'unplanned'; end if;
  if plan_row.plan_status = 'needs_decision' then return 'needs_decision'; end if;
  -- A prompt compiled against a Shot revision that has since changed is stale, never
  -- quietly current.
  if plan_row.source_shot_revision is not null and plan_row.source_shot_revision <> shot_revision then
    return 'stale';
  end if;
  if plan_row.prompt_version = 0 then return 'needs_model'; end if;
  -- MUST PRESERVE references are the ones generation cannot proceed without.
  select count(*) filter (where priority = 'MUST PRESERVE'),
    count(*) filter (where priority = 'MUST PRESERVE' and (asset_id is not null or media_id is not null))
    into must_references, present_references
  from tonde.ai_shot_references
  where workspace_id = target_workspace and plan_id = plan_row.id;
  if must_references > present_references then return 'needs_reference'; end if;
  if plan_row.model_profile_id is null then return 'needs_model'; end if;
  select * into profile from tonde.ai_model_profiles
    where workspace_id in (target_workspace) and id = plan_row.model_profile_id;
  if not found then return 'needs_model'; end if;
  if profile.capability_state = 'UNSUPPORTED' or profile.availability = 'deprecated' then return 'unsupported'; end if;
  if profile.lifecycle <> 'active' then return 'needs_model'; end if;
  if plan_row.model_version = '' and profile.capability_state = 'UNKNOWN' then return 'needs_decision'; end if;
  -- Capability truth: a control the selected profile does not support is never
  -- presented as usable, so the plan cannot be ready while it relies on one.
  if length(coalesce(plan_row.first_frame ->> 'source','')) > 0 and not profile.supports_first_frame then
    return 'unsupported';
  end if;
  if length(coalesce(plan_row.last_frame ->> 'source','')) > 0 and not profile.supports_last_frame then
    return 'unsupported';
  end if;
  if coalesce(plan_row.audio ->> 'needed','false') = 'true' and not profile.supports_audio then
    return 'unsupported';
  end if;
  if coalesce(plan_row.routing -> 'cost_confirmation' ->> 'required','false') = 'true'
    and not exists (select 1 from tonde.ai_cost_confirmations cc
      where cc.workspace_id = target_workspace and cc.shot_id = target_shot
        and cc.prompt_version = plan_row.prompt_version) then
    return 'cost_confirmation';
  end if;
  select c.state into connection_state from tonde.ai_provider_connections c
    where c.workspace_id = target_workspace and c.provider_key = plan_row.provider_target;
  if plan_row.provider_target is null or plan_row.provider_target = ''
    or plan_row.provider_target = 'manual' then
    return 'manual_export';
  end if;
  if connection_state is null or connection_state <> 'connected' then return 'provider_not_connected'; end if;
  if not profile.supports_image_reference
    and exists (select 1 from tonde.ai_shot_references r where r.workspace_id = target_workspace
      and r.plan_id = plan_row.id and r.priority = 'MUST PRESERVE') then
    return 'unsupported';
  end if;
  return 'ready_to_generate';
end $$;
revoke all on function tonde_private.ai_readiness_state(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- Does a declared profile cover what this Shot requires? Returns the capability
-- verdict and the reasons, so the Model Router and the UI cannot disagree.
create function tonde_private.ai_capability_check(target_workspace uuid, target_profile uuid, target_production uuid, target_shot uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare profile tonde.ai_model_profiles; plan_row tonde.execution_plans; shot_row tonde.shots;
  reasons text[] := '{}'; partial text[] := '{}'; state tonde.ai_capability_state;
  blocking text[] := '{}'; needs_audio boolean; must_references integer; duration_ms bigint;
begin
  select * into profile from tonde.ai_model_profiles
    where id = target_profile and (workspace_id = target_workspace or workspace_id is null);
  if not found then
    return jsonb_build_object('state', 'UNKNOWN', 'reasons', to_jsonb(array['No model profile is declared for that identifier.']),
      'partial', '[]'::jsonb, 'blocking', to_jsonb(array['No model profile is declared for that identifier.']),
      'requires_connection', true);
  end if;
  select * into shot_row from tonde.shots
    where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  select * into plan_row from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  -- Capability is read from the profile, never inferred from the model name.
  if profile.capability_state = 'UNKNOWN' then
    reasons := array_append(reasons, 'This model''s capability is unknown to TONDE. Declare it in Setup before relying on it.');
  elsif profile.capability_state = 'UNSUPPORTED' then
    state := 'UNSUPPORTED';
    reasons := array_append(reasons, 'This model is declared as not supporting the operation this Shot needs.');
    blocking := array_append(blocking, 'This model is declared as not supporting the operation this Shot needs.');
    return jsonb_build_object('state', state, 'reasons', to_jsonb(reasons), 'partial', to_jsonb(partial),
      'blocking', to_jsonb(blocking), 'requires_connection', false);
  elsif profile.capability_state = 'REQUIRES CONNECTION' then
    reasons := array_append(reasons, 'This model needs a provider connection before its capability can be confirmed.');
  end if;
  if plan_row.id is not null then
    needs_audio := coalesce(plan_row.audio ->> 'needed','false') = 'true';
    if needs_audio and not profile.supports_audio then
      state := 'UNSUPPORTED'; reasons := array_append(reasons, 'The Shot needs audio and this model does not generate audio.');
    elsif needs_audio then partial := array_append(partial, 'Audio is generated separately and combined editorially.');
    end if;
    if length(coalesce(plan_row.first_frame ->> 'source','')) > 0 then
      if profile.supports_first_frame then partial := array_append(partial, 'First frame is supported.'); 
      else state := 'UNSUPPORTED'; reasons := array_append(reasons, 'The Shot specifies a first frame and this model does not accept one.'); end if;
    end if;
    if length(coalesce(plan_row.last_frame ->> 'source','')) > 0 then
      if profile.supports_last_frame then partial := array_append(partial, 'Last frame is supported.');
      else state := 'UNSUPPORTED'; reasons := array_append(reasons, 'The Shot specifies a last frame and this model does not accept one.'); end if;
    end if;
    duration_ms := plan_row.expected_duration_ms;
    if duration_ms is not null and profile.max_duration_ms is not null and duration_ms > profile.max_duration_ms then
      partial := array_append(partial, format('This model generates up to %s ms, so the Shot needs an extension or split.', profile.max_duration_ms));
    end if;
    if plan_row.aspect_ratio <> '' and cardinality(profile.aspect_ratios) > 0
      and not (plan_row.aspect_ratio = any(profile.aspect_ratios)) then
      state := 'UNSUPPORTED';
      reasons := array_append(reasons, format('The Production delivers %s and this model does not list that aspect ratio.', plan_row.aspect_ratio));
      blocking := array_append(blocking, format('The Production delivers %s and this model does not list that aspect ratio.', plan_row.aspect_ratio));
    end if;
    if coalesce(plan_row.negative_constraints, '{}') <> '{}' and not profile.supports_negative_prompt then
      partial := array_append(partial, 'Negative constraints are expressed in the prompt wording because this model has no negative-prompt field.');
    end if;
    select count(*) into must_references from tonde.ai_shot_references r
      where r.workspace_id = target_workspace and r.plan_id = plan_row.id and r.priority = 'MUST PRESERVE'
        and r.asset_id is not null;
    if must_references > 0 then
      if not profile.supports_image_reference then
        state := 'UNSUPPORTED';
        reasons := array_append(reasons, 'Reference images are required and this model does not accept image references.');
        blocking := array_append(blocking, 'Reference images are required and this model does not accept image references.');
      elsif profile.max_reference_images is not null and must_references > profile.max_reference_images then
        partial := array_append(partial, format('%s required references exceed the %s this model accepts; TONDE will select the strongest.', must_references, profile.max_reference_images));
      end if;
    end if;
  end if;
  if state is null then
    if profile.capability_state = 'PARTIALLY SUPPORTED' then state := 'PARTIALLY SUPPORTED';
    elsif profile.capability_state = 'REQUIRES CONNECTION' then state := 'REQUIRES CONNECTION';
    else state := 'SUPPORTED'; end if;
  end if;
  -- 'blocking' separates a mismatch that makes the plan unusable (wrong aspect, missing
  -- reference support, an operation this model does not do) from a control the model
  -- simply lacks. The first is refused at plan time; the second is stored and reported,
  -- because a plan the creator can see and correct is more useful than a silent failure.
  return jsonb_build_object('state', state, 'reasons', to_jsonb(reasons), 'partial', to_jsonb(partial),
    'blocking', to_jsonb(blocking),
    'requires_connection', profile.capability_state = 'REQUIRES CONNECTION');
end $$;
revoke all on function tonde_private.ai_capability_check(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- The plan document for one Shot's AI plan, with prompt staleness computed from the
-- Shot revision it was compiled against.
create function tonde_private.ai_plan_document(target_workspace uuid, target_production uuid, target_shot uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else
    jsonb_build_object(
      'plan_id', p.id, 'shot_id', p.shot_id, 'execution_method', p.execution_method,
      'approval', p.approval, 'locked', p.locked_at is not null, 'revision', p.revision,
      'plan_status', p.plan_status, 'readiness_note', p.readiness_note,
      'generated_by', p.generated_by,
      'prompt_version', p.prompt_version, 'source_shot_revision', p.source_shot_revision,
      'shot_revision', h.revision,
      'prompt_stale', p.source_shot_revision is not null and p.source_shot_revision <> h.revision,
      'source_versions', p.source_versions,
      'canonical_prompt', p.canonical_prompt, 'provider_prompt', p.provider_prompt,
      'provider_prompt_edited', p.provider_prompt_edited,
      'provider_prompt_edited_at', p.provider_prompt_edited_at,
      'provider_target', p.provider_target, 'model_profile_id', p.model_profile_id,
      'fallback_model_profile_id', p.fallback_model_profile_id, 'model_version', p.model_version,
      'model', p.model, 'provider', p.provider, 'routing', p.routing,
      'first_frame', p.first_frame, 'last_frame', p.last_frame, 'motion', p.motion,
      'audio', p.audio, 'continuity', p.continuity, 'hybrid', p.hybrid,
      'negative_constraints', to_jsonb(p.negative_constraints), 'limitations', to_jsonb(p.limitations),
      'aspect_ratio', p.aspect_ratio, 'expected_duration_ms', p.expected_duration_ms,
      'cost_state', p.cost_state, 'cost_amount', p.cost_amount, 'cost_currency', p.cost_currency,
      'cost_note', p.cost_note,
      'shot_size', p.shot_size, 'framing', p.framing, 'composition', p.composition,
      'movement', p.movement, 'movement_purpose', p.movement_purpose,
      'lighting_intent', p.lighting_intent, 'performance', p.performance,
      'product_direction', p.product_direction, 'sound_plan', p.sound_plan,
      'editorial_intent', p.editorial_intent, 'updated_at', p.updated_at)
    || jsonb_build_object(
      'model_profile', case when m.id is null then null else jsonb_build_object(
        'id', m.id, 'provider_key', m.provider_key, 'model_key', m.model_key, 'label', m.label,
        'operation', m.operation, 'capability_state', m.capability_state,
        'supports_image_reference', m.supports_image_reference, 'max_reference_images', m.max_reference_images,
        'supports_first_frame', m.supports_first_frame, 'supports_last_frame', m.supports_last_frame,
        'supports_seed', m.supports_seed, 'supports_negative_prompt', m.supports_negative_prompt,
        'supports_camera_control', m.supports_camera_control, 'supports_audio', m.supports_audio,
        'max_duration_ms', m.max_duration_ms, 'aspect_ratios', to_jsonb(m.aspect_ratios),
        'resolutions', to_jsonb(m.resolutions), 'cost_unit', m.cost_unit, 'cost_amount', m.cost_amount,
        'cost_currency', m.cost_currency, 'cost_known', m.cost_known, 'availability', m.availability,
        'source', m.source, 'identity_note', m.identity_note, 'product_fidelity_note', m.product_fidelity_note,
        'speed_note', m.speed_note, 'safety_note', m.safety_note) end,
      'connection', tonde_private.ai_connection(target_workspace, coalesce(p.provider_target, 'manual')))
  end
  from tonde.execution_plans p
  join tonde.shots h on h.workspace_id = p.workspace_id and h.id = p.shot_id
  left join tonde.ai_model_profiles m on m.id = p.model_profile_id
  where p.workspace_id = target_workspace and p.production_id = target_production
    and p.shot_id = target_shot and p.execution_method = 'ai';
$$;
revoke all on function tonde_private.ai_plan_document(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- One Shot's AI rollup for the Scene and Production summaries.
create function tonde_private.ai_shot_rollup(target_workspace uuid, target_plan uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'attempts', (select count(*) from tonde.ai_generation_attempts a
      where a.workspace_id = target_workspace and a.plan_id = target_plan),
    'succeeded', (select count(*) from tonde.ai_generation_attempts a
      where a.workspace_id = target_workspace and a.plan_id = target_plan and a.status = 'succeeded'),
    'failed', (select count(*) from tonde.ai_generation_attempts a
      where a.workspace_id = target_workspace and a.plan_id = target_plan and a.status = 'failed'),
    'in_flight', (select count(*) from tonde.ai_generation_attempts a
      where a.workspace_id = target_workspace and a.plan_id = target_plan
        and a.status in ('queued','submitted','processing')),
    'selected_attempt_id', (select a.id from tonde.ai_generation_attempts a
      where a.workspace_id = target_workspace and a.plan_id = target_plan and a.selected limit 1),
    'references', (select count(*) from tonde.ai_shot_references r
      where r.workspace_id = target_workspace and r.plan_id = target_plan),
    'must_references', (select count(*) from tonde.ai_shot_references r
      where r.workspace_id = target_workspace and r.plan_id = target_plan and r.priority = 'MUST PRESERVE'));
$$;
revoke all on function tonde_private.ai_shot_rollup(uuid,uuid) from public, anon, authenticated, service_role;

-- The selected Result for a Shot, or null. Selected means chosen current output.
create function tonde_private.ai_selected_attempt(target_workspace uuid, target_shot uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from tonde.ai_generation_attempts a
  where a.workspace_id = target_workspace and a.shot_id = target_shot and a.selected limit 1;
$$;
revoke all on function tonde_private.ai_selected_attempt(uuid,uuid) from public, anon, authenticated, service_role;

-- Continuity locks for a Production, as a stable JSON document.
create function tonde_private.ai_locks_document(target_workspace uuid, target_production uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lock_id', l.id, 'scope', l.scope, 'subject_id', l.subject_id, 'label', l.label,
    'locked', l.locked, 'priority', l.priority, 'locked_traits', to_jsonb(l.locked_traits),
    'allowed_variations', to_jsonb(l.allowed_variations), 'prohibited_changes', to_jsonb(l.prohibited_changes),
    'identity_truth', l.identity_truth, 'consent_note', l.consent_note, 'note', l.note,
    'locked_at', l.locked_at, 'revision', l.revision)
    order by l.scope, l.label), '[]'::jsonb)
  from tonde.ai_continuity_locks l
  where l.workspace_id = target_workspace and l.production_id = target_production;
$$;
revoke all on function tonde_private.ai_locks_document(uuid,uuid) from public, anon, authenticated, service_role;

-- 13. Read model: the AI Creation surface for a whole Production. One round trip for
-- the Studio AI face, the readiness queue and the batch preview.
create function tonde.ai_creation_surface(target_workspace uuid, target_production uuid,
  expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare prod tonde.productions;
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into prod from tonde.productions where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and prod.revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = '40001';
  end if;
  return jsonb_build_object(
    'production', jsonb_build_object('id', prod.id, 'workspace_id', prod.workspace_id, 'title', prod.title,
      'production_type', prod.production_type, 'execution_method', prod.execution_method,
      'planned_duration_ms', prod.planned_duration_ms, 'approval', prod.approval,
      'locked_at', prod.locked_at, 'revision', prod.revision, 'lifecycle', prod.lifecycle),
    'execution_faces', to_jsonb(array['real','ai']),
    'connections', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider_key', p.key, 'label', p.label, 'connection_required', p.connection_required,
        'manual_export_supported', p.manual_export_supported,
        'state', coalesce(c.state, 'not_connected'),
        'credential_reference', coalesce(c.credential_reference, ''),
        'connected_at', c.connected_at)
        order by p.key), '[]'::jsonb)
      from tonde.ai_providers p
      left join tonde.ai_provider_connections c on c.workspace_id = target_workspace and c.provider_key = p.key),
    'models', (select coalesce(jsonb_agg(jsonb_build_object(
        'model_profile_id', m.id, 'provider_key', m.provider_key, 'model_key', m.model_key,
        'label', m.label, 'operation', m.operation, 'capability_state', m.capability_state,
        'availability', m.availability, 'cost_known', m.cost_known, 'cost_unit', m.cost_unit,
        'cost_amount', m.cost_amount, 'cost_currency', m.cost_currency,
        'supports_image_reference', m.supports_image_reference,
        'supports_first_frame', m.supports_first_frame, 'supports_last_frame', m.supports_last_frame,
        'max_duration_ms', m.max_duration_ms, 'source', m.source)
        order by m.provider_key, m.model_key, m.operation), '[]'::jsonb)
      from tonde.ai_model_profiles m
      where m.workspace_id = target_workspace and m.lifecycle = 'active'),
    'known_models', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider_key', m.provider_key, 'model_key', m.model_key, 'operation', m.operation,
        'declared', false, 'capability_state', m.capability_state)
        order by m.provider_key, m.model_key), '[]'::jsonb)
      from tonde.ai_model_profiles m where m.workspace_id is null),
    'locks', tonde_private.ai_locks_document(target_workspace, target_production),
    'scenes', (select coalesce(jsonb_agg(jsonb_build_object(
        'scene_id', s.id, 'order', s.sort_order, 'title', s.title, 'shots', s.shot_count,
        'ready', s.ready, 'blocked', s.blocked, 'unplanned', s.unplanned, 'selected', s.selected)
        order by s.sort_order, s.id), '[]'::jsonb)
      from (select sc.id, sc.sort_order, sc.title,
          count(h.id) as shot_count,
          count(h.id) filter (where r.readiness = 'ready_to_generate') as ready,
          count(h.id) filter (where r.readiness not in ('ready_to_generate','manual_export') and h.execution_method <> 'real') as blocked,
          count(h.id) filter (where h.execution_method in ('ai','hybrid') and r.readiness = 'unplanned') as unplanned,
          count(h.id) filter (where r.selected_attempt_id is not null) as selected
        from tonde.scenes sc
        left join tonde.shots h on h.workspace_id = sc.workspace_id and h.production_id = sc.production_id
          and h.scene_id = sc.id and h.lifecycle = 'active'
        left join lateral (select tonde_private.ai_readiness_state(target_workspace, target_production, h.id) as readiness,
          tonde_private.ai_selected_attempt(target_workspace, h.id) as selected_attempt_id) r on true
        where sc.workspace_id = target_workspace and sc.production_id = target_production and sc.lifecycle = 'active'
        group by sc.id, sc.sort_order, sc.title) s),
    'shots', (select coalesce(jsonb_agg(jsonb_build_object(
        'shot_id', h.id, 'scene_id', h.scene_id, 'title', h.title, 'purpose', h.purpose,
        'order', h.sort_order, 'execution_method', h.execution_method, 'approval', h.approval,
        'locked', h.locked_at is not null, 'revision', h.revision,
        'planned_duration_ms', h.planned_duration_ms,
        'readiness', tonde_private.ai_readiness_state(target_workspace, target_production, h.id),
        'plan_id', p.id, 'plan_revision', p.revision, 'plan_status', p.plan_status,
        'prompt_version', p.prompt_version, 'prompt_stale', p.source_shot_revision is not null and p.source_shot_revision <> h.revision,
        'provider_target', p.provider_target, 'model_profile_id', p.model_profile_id,
        'model_label', coalesce(m.label, m.model_key), 'model_key', m.model_key,
        'capability_state', m.capability_state,
        'cost_state', coalesce(p.cost_state, 'unknown'), 'cost_amount', p.cost_amount,
        'cost_currency', p.cost_currency,
        'aspect_ratio', coalesce(nullif(p.aspect_ratio, ''), ''),
        'expected_duration_ms', coalesce(p.expected_duration_ms, h.planned_duration_ms),
        'hybrid', p.hybrid)
        order by h.sort_order, h.id), '[]'::jsonb)
      from tonde.shots h
      left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
        and p.execution_method = 'ai'
      left join tonde.ai_model_profiles m on m.id = p.model_profile_id
      where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active'),
    'summary', (select jsonb_build_object(
        'shots', count(*),
        'ai_or_hybrid', count(*) filter (where h.execution_method in ('ai','hybrid')),
        'real', count(*) filter (where h.execution_method = 'real'),
        'planned', count(*) filter (where p.id is not null),
        'ready', count(*) filter (where tonde_private.ai_readiness_state(target_workspace, target_production, h.id) = 'ready_to_generate'),
        'manual_export', count(*) filter (where tonde_private.ai_readiness_state(target_workspace, target_production, h.id) = 'manual_export'),
        'blocked', count(*) filter (where h.execution_method in ('ai','hybrid')
          and tonde_private.ai_readiness_state(target_workspace, target_production, h.id) not in ('ready_to_generate','manual_export')),
        'stale', count(*) filter (where p.source_shot_revision is not null and p.source_shot_revision <> h.revision),
        'with_selected_result', count(*) filter (where tonde_private.ai_selected_attempt(target_workspace, h.id) is not null),
        'connected_providers', (select count(*) from tonde.ai_provider_connections c
          where c.workspace_id = target_workspace and c.state = 'connected'),
        'declared_models', (select count(*) from tonde.ai_model_profiles m
          where m.workspace_id = target_workspace and m.lifecycle = 'active'))
      from tonde.shots h
      left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
        and p.execution_method = 'ai'
      where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active'),
    'capabilities', jsonb_build_object(
      'prompt_compilation', true,
      'model_routing', true,
      'live_generation', exists (select 1 from tonde.ai_provider_connections c
        where c.workspace_id = target_workspace and c.state = 'connected'),
      'manual_export', true,
      'note', 'Provider-neutral. TONDE ranks only the models you have declared, and holds no vendor capability facts of its own.'));
end $$;
revoke all on function tonde.ai_creation_surface(uuid,uuid,integer) from public, anon, authenticated, service_role;

-- The Model Router's input. Three separate facts are reported separately: TONDE knows
-- this model, this workspace declared this model, and TONDE is connected to this
-- provider. Capability metadata is only ever what was declared.
create function tonde.ai_model_catalog(target_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'providers', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider_key', p.key, 'label', p.label, 'connection_required', p.connection_required,
        'manual_export_supported', p.manual_export_supported, 'note', p.note,
        'connection', tonde_private.ai_connection(target_workspace, p.key))
        order by p.key), '[]'::jsonb)
      from tonde.ai_providers p),
    'models', (select coalesce(jsonb_agg(jsonb_build_object(
        'model_profile_id', m.id, 'provider_key', m.provider_key, 'model_key', m.model_key,
        'label', m.label, 'operation', m.operation, 'capability_state', m.capability_state,
        'modalities', to_jsonb(m.modalities), 'source', m.source, 'availability', m.availability,
        'supports_image_reference', m.supports_image_reference, 'max_reference_images', m.max_reference_images,
        'supports_first_frame', m.supports_first_frame, 'supports_last_frame', m.supports_last_frame,
        'supports_seed', m.supports_seed, 'supports_negative_prompt', m.supports_negative_prompt,
        'supports_camera_control', m.supports_camera_control, 'supports_audio', m.supports_audio,
        'supports_image_edit', m.supports_image_edit, 'supports_lipsync', m.supports_lipsync,
        'max_duration_ms', m.max_duration_ms, 'aspect_ratios', to_jsonb(m.aspect_ratios),
        'resolutions', to_jsonb(m.resolutions), 'cost_unit', m.cost_unit, 'cost_amount', m.cost_amount,
        'cost_currency', m.cost_currency, 'cost_known', m.cost_known, 'speed_note', m.speed_note,
        'identity_note', m.identity_note, 'product_fidelity_note', m.product_fidelity_note,
        'safety_note', m.safety_note, 'capability_notes', m.capability_notes,
        'declared', true, 'known', true,
        'connected', coalesce((select c.state = 'connected' from tonde.ai_provider_connections c
          where c.workspace_id = target_workspace and c.provider_key = m.provider_key), false))
        order by m.provider_key, m.model_key, m.operation), '[]'::jsonb)
      from tonde.ai_model_profiles m
      where m.workspace_id = target_workspace and m.lifecycle = 'active'),
    'known_models', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider_key', m.provider_key, 'model_key', m.model_key, 'operation', m.operation,
        'label', m.label, 'capability_state', m.capability_state, 'declared', false, 'known', true)
        order by m.provider_key, m.model_key), '[]'::jsonb)
      from tonde.ai_model_profiles m where m.workspace_id is null),
    'truth', jsonb_build_object(
      'known', 'TONDE recognises this model identifier.',
      'declared', 'This workspace declared what the model can do. Capability is never inferred from a name.',
      'connected', 'TONDE holds a connection for this provider in this workspace.',
      'manual', 'Manual export needs no connection and always remains available.'));
end $$;
revoke all on function tonde.ai_model_catalog(uuid) from public, anon, authenticated, service_role;

-- One Shot's AI Creation detail: the canvas data for section 112, including the Real plan it
-- must coordinate with when the Shot is Hybrid.
create function tonde.ai_shot_detail(target_workspace uuid, target_production uuid, target_shot uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare shot_row tonde.shots; scene_row tonde.scenes; plan_row tonde.execution_plans;
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into shot_row from tonde.shots
    where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  if not found then raise exception 'That Shot is unavailable in this Production' using errcode = 'P0002'; end if;
  select * into scene_row from tonde.scenes
    where workspace_id = target_workspace and production_id = target_production and id = shot_row.scene_id;
  select * into plan_row from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  return jsonb_build_object(
    'shot', jsonb_build_object('shot_id', shot_row.id, 'scene_id', shot_row.scene_id, 'title', shot_row.title,
      'description', shot_row.description, 'action', shot_row.action, 'purpose', shot_row.purpose,
      'subject', shot_row.subject, 'framing', shot_row.framing, 'angle', shot_row.angle,
      'movement', shot_row.movement, 'composition', shot_row.composition, 'transition', shot_row.transition,
      'story_relationship', shot_row.story_relationship, 'story_beat', shot_row.story_beat,
      'creative_notes', shot_row.creative_notes, 'execution_method', shot_row.execution_method,
      'approval', shot_row.approval, 'locked', shot_row.locked_at is not null, 'revision', shot_row.revision,
      'planned_duration_ms', shot_row.planned_duration_ms),
    'scene', jsonb_build_object('scene_id', scene_row.id, 'title', scene_row.title, 'order', scene_row.sort_order,
      'purpose', scene_row.purpose, 'description', scene_row.description,
      'environment_asset_id', scene_row.environment_asset_id),
    'readiness', tonde_private.ai_readiness_state(target_workspace, target_production, target_shot),
    'plan', tonde_private.ai_plan_document(target_workspace, target_production, target_shot),
    'real_plan', tonde_private.real_plan_document(target_workspace, target_production, target_shot),
    'references', (select coalesce(jsonb_agg(jsonb_build_object(
        'reference_id', r.id, 'role', r.reference_role, 'priority', r.priority,
        'asset_id', r.asset_id, 'media_id', r.media_id, 'origin', r.origin,
        'source_attempt_id', r.source_attempt_id, 'note', r.note, 'sort_order', r.sort_order,
        'asset_name', a.name, 'asset_type', a.asset_type)
        order by r.sort_order, r.reference_role), '[]'::jsonb)
      from tonde.ai_shot_references r
      left join tonde.assets a on a.workspace_id = r.workspace_id and a.id = r.asset_id
      where r.workspace_id = target_workspace and r.plan_id = plan_row.id),
    'locks', tonde_private.ai_locks_document(target_workspace, target_production),
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object(
        'attempt_id', a.id, 'attempt_number', a.attempt_number, 'operation', a.operation,
        'provider_key', a.provider_key, 'model_key', a.model_key, 'model_version', a.model_version,
        'model_profile_id', a.model_profile_id, 'prompt_version', a.prompt_version,
        'source_shot_revision', a.source_shot_revision, 'mode', a.mode, 'status', a.status,
        'external_job_id', a.external_job_id, 'seed', a.seed, 'settings', a.settings,
        'input_references', a.input_references, 'cost_state', a.cost_state, 'cost_amount', a.cost_amount,
        'cost_currency', a.cost_currency, 'retryable', a.retryable, 'retry_of', a.retry_of,
        'started_at', a.started_at, 'completed_at', a.completed_at,
        'failure_code', a.failure_code, 'failure_message', a.failure_message,
        'output_media_id', a.output_media_id, 'result_id', a.result_id, 'result_state', a.result_state,
        'selected', a.selected, 'creator_rating', a.creator_rating, 'creator_decision', a.creator_decision,
        'idempotency_key', a.idempotency_key, 'created_at', a.created_at, 'revision', a.revision)
        order by a.attempt_number), '[]'::jsonb)
      from tonde.ai_generation_attempts a
      where a.workspace_id = target_workspace and a.plan_id = plan_row.id),
    'selected_result', (select case when a.id is null then null else jsonb_build_object(
        'attempt_id', a.id, 'attempt_number', a.attempt_number, 'status', a.status,
        'provider_key', a.provider_key, 'model_key', a.model_key, 'result_id', a.result_id,
        'output_media_id', a.output_media_id, 'result_state', a.result_state,
        'selected', a.selected, 'completed_at', a.completed_at) end
      from tonde.ai_generation_attempts a
      where a.workspace_id = target_workspace and a.plan_id = plan_row.id and a.selected limit 1),
    'batch_items', (select coalesce(jsonb_agg(jsonb_build_object(
        'batch_id', i.batch_id, 'state', i.state, 'blocked_reason', i.blocked_reason,
        'attempt_id', i.attempt_id, 'failure_code', i.failure_code, 'failure_message', i.failure_message,
        'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
      from tonde.ai_generation_batch_items i
      where i.workspace_id = target_workspace and i.shot_id = target_shot),
    'script_line', (select case when d.id is null then null else jsonb_build_object(
        'dialogue_id', d.id, 'line_type', d.line_type,
        'speaker', (select a.name from tonde.assets a
          where a.workspace_id = d.workspace_id and a.id = d.speaker_asset_id),
        'content', d.content, 'duration_ms', d.duration_ms) end
      from tonde.dialogue_lines d
      where d.workspace_id = target_workspace and d.production_id = target_production
        and d.scene_id = shot_row.scene_id and d.line_type in ('dialogue','voiceover','narration')
      order by d.sort_order limit 1));
end $$;
revoke all on function tonde.ai_shot_detail(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- 14. Declaring capability metadata. This is where capability truth comes from: the
-- creator declares what their tool can do, or a connected provider reports it. TONDE
-- never derives a capability from a model name.
create function tonde.declare_ai_model(target_workspace uuid, payload jsonb,
  expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.ai_model_profiles; provider text; model_name text; op tonde.ai_operation;
begin
  perform tonde_private.director_guard(target_workspace);
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'A model declaration must be a JSON object' using errcode = '22023';
  end if;
  provider := coalesce(nullif(btrim(payload ->> 'provider_key'), ''), '');
  model_name := coalesce(nullif(btrim(payload ->> 'model_key'), ''), '');
  if not exists (select 1 from tonde.ai_providers p where p.key = provider) then
    raise exception 'That provider is not one TONDE recognises' using errcode = '22023';
  end if;
  if model_name = '' then raise exception 'A model identifier is required' using errcode = '22023'; end if;
  op := coalesce(nullif(payload ->> 'operation', ''), 'video')::tonde.ai_operation;
  insert into tonde.ai_model_profiles(workspace_id, provider_key, model_key, label, operation,
    capability_state, modalities, supports_image_reference, max_reference_images,
    supports_first_frame, supports_last_frame, supports_seed, supports_negative_prompt,
    supports_camera_control, supports_audio, supports_image_edit, supports_lipsync,
    max_duration_ms, aspect_ratios, resolutions, cost_unit, cost_amount, cost_currency, cost_known,
    speed_note, identity_note, product_fidelity_note, availability, safety_note, capability_notes,
    source, declared_by)
  values (target_workspace, provider, model_name,
    left(coalesce(payload ->> 'label', ''), 160), op,
    coalesce(nullif(payload ->> 'capability_state',''), 'UNKNOWN')::tonde.ai_capability_state,
    tonde_private.ai_json_text_array(payload, 'modalities'),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_image_reference', false), false),
    tonde_private.ai_json_int(payload, 'max_reference_images'),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_first_frame', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_last_frame', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_seed', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_negative_prompt', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_camera_control', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_audio', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_image_edit', false), false),
    coalesce(tonde_private.ai_json_bool(payload, 'supports_lipsync', false), false),
    case when payload ? 'max_duration_ms' and jsonb_typeof(payload -> 'max_duration_ms') = 'number'
      then (payload ->> 'max_duration_ms')::bigint end,
    tonde_private.ai_json_text_array(payload, 'aspect_ratios'), tonde_private.ai_json_text_array(payload, 'resolutions'),
    left(coalesce(payload ->> 'cost_unit', ''), 80),
    case when payload ? 'cost_amount' and jsonb_typeof(payload -> 'cost_amount') = 'number'
      then (payload ->> 'cost_amount')::numeric(12,4) end,
    left(coalesce(payload ->> 'cost_currency', ''), 8),
    -- Cost is known only when an amount and a currency were actually given.
    (payload ? 'cost_amount' and jsonb_typeof(payload -> 'cost_amount') = 'number'
      and coalesce(payload ->> 'cost_currency','') <> ''),
    left(coalesce(payload ->> 'speed_note', ''), 300), left(coalesce(payload ->> 'identity_note', ''), 300),
    left(coalesce(payload ->> 'product_fidelity_note', ''), 300),
    coalesce(nullif(payload ->> 'availability',''), 'unknown'), left(coalesce(payload ->> 'safety_note', ''), 600),
    coalesce(payload -> 'capability_notes', '{}'::jsonb),
    coalesce(nullif(payload ->> 'source',''), 'declared'), auth.uid())
  on conflict do nothing
  returning * into saved;
  if saved.id is null then
    select * into saved from tonde.ai_model_profiles m
      where m.workspace_id = target_workspace and m.provider_key = provider
        and m.model_key = model_name and m.operation = op;
    if expected_revision is not null and saved.revision <> expected_revision then
      raise exception 'That model declaration changed since you loaded it' using errcode = '40001';
    end if;
    update tonde.ai_model_profiles m set
      label = left(coalesce(payload ->> 'label', m.label), 160),
      capability_state = coalesce(nullif(payload ->> 'capability_state','')::tonde.ai_capability_state,
        m.capability_state),
      modalities = case when payload ? 'modalities' then tonde_private.ai_json_text_array(payload,'modalities') else m.modalities end,
      supports_image_reference = coalesce(tonde_private.ai_json_bool(payload,'supports_image_reference', m.supports_image_reference), m.supports_image_reference),
      supports_first_frame = coalesce(tonde_private.ai_json_bool(payload,'supports_first_frame', m.supports_first_frame), m.supports_first_frame),
      supports_last_frame = coalesce(tonde_private.ai_json_bool(payload,'supports_last_frame', m.supports_last_frame), m.supports_last_frame),
      supports_seed = coalesce(tonde_private.ai_json_bool(payload,'supports_seed', m.supports_seed), m.supports_seed),
      supports_negative_prompt = coalesce(tonde_private.ai_json_bool(payload,'supports_negative_prompt', m.supports_negative_prompt), m.supports_negative_prompt),
      supports_camera_control = coalesce(tonde_private.ai_json_bool(payload,'supports_camera_control', m.supports_camera_control), m.supports_camera_control),
      supports_audio = coalesce(tonde_private.ai_json_bool(payload,'supports_audio', m.supports_audio), m.supports_audio),
      -- Every declared capability must be correctable, or a wrong fact could never be fixed.
      supports_image_edit = coalesce(tonde_private.ai_json_bool(payload,'supports_image_edit', m.supports_image_edit), m.supports_image_edit),
      supports_lipsync = coalesce(tonde_private.ai_json_bool(payload,'supports_lipsync', m.supports_lipsync), m.supports_lipsync),
      max_duration_ms = case when payload ? 'max_duration_ms' and jsonb_typeof(payload -> 'max_duration_ms') = 'number'
        then (payload ->> 'max_duration_ms')::bigint else m.max_duration_ms end,
      aspect_ratios = case when payload ? 'aspect_ratios' then tonde_private.ai_json_text_array(payload,'aspect_ratios') else m.aspect_ratios end,
      cost_unit = left(coalesce(payload ->> 'cost_unit', m.cost_unit), 80),
      cost_amount = case when payload ? 'cost_amount' and jsonb_typeof(payload -> 'cost_amount') = 'number'
        then (payload ->> 'cost_amount')::numeric(12,4) else m.cost_amount end,
      cost_currency = left(coalesce(payload ->> 'cost_currency', m.cost_currency), 8),
      availability = coalesce(nullif(payload ->> 'availability',''), m.availability),
      speed_note = left(coalesce(payload ->> 'speed_note', m.speed_note), 300),
      identity_note = left(coalesce(payload ->> 'identity_note', m.identity_note), 300),
      product_fidelity_note = left(coalesce(payload ->> 'product_fidelity_note', m.product_fidelity_note), 300),
      capability_notes = coalesce(payload -> 'capability_notes', m.capability_notes),
      -- Cost is known only when both an amount and a currency are present. Computed in the same
      -- statement as the rest of the declaration, so one edit is exactly one revision.
      cost_known = (case when payload ? 'cost_amount' and jsonb_typeof(payload -> 'cost_amount') = 'number'
          then (payload ->> 'cost_amount')::numeric(12,4) else m.cost_amount end is not null
        and left(coalesce(payload ->> 'cost_currency', m.cost_currency), 8) <> '')
    where m.id = saved.id returning * into saved;
  end if;
  return jsonb_build_object('model_profile_id', saved.id, 'provider_key', saved.provider_key,
    'model_key', saved.model_key, 'operation', saved.operation, 'capability_state', saved.capability_state,
    'cost_known', saved.cost_known, 'cost_amount', saved.cost_amount, 'cost_currency', saved.cost_currency,
    'revision', saved.revision);
end $$;
revoke all on function tonde.declare_ai_model(uuid,jsonb,integer) from public, anon, authenticated, service_role;

-- Provider connection state. A reference only: no secret is stored or read here.
create function tonde.set_ai_connection(target_workspace uuid, target_provider text,
  target_state text, credential_reference text default '', note text default '', expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.ai_provider_connections;
begin
  perform tonde_private.director_guard(target_workspace);
  if not exists (select 1 from tonde.ai_providers p where p.key = target_provider) then
    raise exception 'That provider is not one TONDE recognises' using errcode = '22023';
  end if;
  if target_state not in ('not_connected','connected','unavailable') then
    raise exception 'That connection state is not valid' using errcode = '22023';
  end if;
  if length(coalesce(credential_reference, '')) > 0 and credential_reference ~* '(sk-|secret|password|bearer )' then
    raise exception 'Store only a reference to the credential, never the credential itself' using errcode = '22023';
  end if;
  insert into tonde.ai_provider_connections(workspace_id, provider_key, state, credential_reference, note,
    last_checked_at, connected_at)
  values (target_workspace, target_provider, target_state::tonde.ai_connection_state,
    left(coalesce(credential_reference,''), 200), left(coalesce(note,''), 600), now(),
    case when target_state = 'connected' then now() end)
  on conflict (workspace_id, provider_key) do update set
    state = excluded.state, credential_reference = excluded.credential_reference, note = excluded.note,
    last_checked_at = now(),
    connected_at = case when excluded.state = 'connected' then coalesce(tonde.ai_provider_connections.connected_at, now()) end
  returning * into saved;
  if expected_revision is not null and saved.revision <> expected_revision + 1 then
    raise exception 'That connection changed since you loaded it' using errcode = '40001';
  end if;
  return jsonb_build_object('provider_key', saved.provider_key, 'state', saved.state,
    'credential_reference', saved.credential_reference, 'note', saved.note,
    'connected_at', saved.connected_at, 'revision', saved.revision);
end $$;
revoke all on function tonde.set_ai_connection(uuid,text,text,text,text,integer) from public, anon, authenticated, service_role;

-- The capability verdict for one declared model against one Shot, exposed so the Model
-- Router and the creator see exactly the same truth. This is where 'can this model
-- actually do this Shot' is answered, and it is answered from declared facts only.
create function tonde.ai_capability_verdict(target_workspace uuid, target_production uuid,
  target_shot uuid, target_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare shot_row tonde.shots;
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into shot_row from tonde.shots
    where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  if not found then raise exception 'That Shot is unavailable in this Production' using errcode = 'P0002'; end if;
  return tonde_private.ai_capability_check(target_workspace, target_profile, target_production, target_shot)
    || jsonb_build_object('model_profile_id', target_profile, 'shot_id', target_shot);
end $$;
revoke all on function tonde.ai_capability_verdict(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- 15. Saving an AI plan. The database is the last line of defence for four rules the
-- engine also holds: a capability the selected model does not support is never stored
-- as usable, a locked trait is never changed silently, a hand-edited provider prompt is
-- never overwritten without confirmation, and a prompt always records the Shot revision
-- it was compiled against.
create function tonde.save_ai_plan(target_workspace uuid, target_production uuid, target_shot uuid,
  expected_shot_revision integer, plan jsonb, references_json jsonb default '[]'::jsonb,
  expected_plan_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous tonde.execution_plans; saved tonde.execution_plans; item jsonb; change_item jsonb;
  lock_row tonde.ai_continuity_locks; shot_row tonde.shots; capability jsonb; next_version integer;
  profile tonde.ai_model_profiles; reference_count integer := 0; duration_ms bigint; aspect text;
  conflict_fields text[] := '{}'; effective_shot_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  perform tonde_private.studio_revision_guard(target_workspace, target_production, target_shot, 'shot', expected_shot_revision);
  if plan is null or jsonb_typeof(plan) <> 'object' then
    raise exception 'An AI plan must be a JSON object' using errcode = '22023';
  end if;
  select * into shot_row from tonde.shots
    where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  select * into previous from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if previous.id is not null then
    if previous.locked_at is not null then
      raise exception 'This AI plan is locked. Unlock it before editing.' using errcode = '23514';
    end if;
    if expected_plan_revision is not null and previous.revision <> expected_plan_revision then
      raise exception 'That AI plan changed since you loaded it' using errcode = '40001';
    end if;
    if previous.provider_prompt_edited and plan ? 'provider_prompt'
      and coalesce(plan ->> 'accept_provider_prompt', 'false') <> 'true' then
      raise exception 'This provider prompt was edited by hand. Confirm the replacement before TONDE overwrites it.'
        using errcode = '23514';
    end if;
  end if;

  -- Continuity locks: a locked trait is not changed without an explicit proposal.
  if jsonb_typeof(plan -> 'continuity') = 'object' and jsonb_typeof(plan -> 'continuity' -> 'changes') = 'array' then
    for change_item in select jsonb_array_elements(plan -> 'continuity' -> 'changes') loop
      if coalesce(change_item ->> 'scope','') in ('character','world','product','style') then
        select * into lock_row from tonde.ai_continuity_locks l
          where l.workspace_id = target_workspace and l.production_id = target_production
            and l.scope = (change_item ->> 'scope')::tonde.ai_lock_scope and l.locked
            and (change_item ->> 'subject_id' is null or l.subject_id = (change_item ->> 'subject_id')::uuid)
          order by l.priority limit 1;
        if lock_row.id is not null then
          if coalesce(change_item ->> 'field','') = any(lock_row.prohibited_changes)
            or (lock_row.priority = 'MUST PRESERVE'
              and not (coalesce(change_item ->> 'field','') = any(lock_row.allowed_variations))) then
            conflict_fields := conflict_fields || (lock_row.scope::text || ' - ' || coalesce(change_item ->> 'field',''));
          end if;
        end if;
      end if;
    end loop;
  end if;
  if cardinality(conflict_fields) > 0 then
    raise exception 'These changes touch a locked continuity trait: %. Propose the change explicitly or unlock the scope first.',
      array_to_string(conflict_fields, ', ') using errcode = '23514';
  end if;

  -- The selected model must be one this workspace declared. The capability verdict itself
  -- is taken after the plan is stored, so it judges exactly the plan being saved rather
  -- than the one it replaces.
  if plan ? 'model_profile_id' and coalesce(plan ->> 'model_profile_id','') <> '' then
    select * into profile from tonde.ai_model_profiles m
      where m.id = (plan ->> 'model_profile_id')::uuid and m.workspace_id = target_workspace and m.lifecycle = 'active';
    if profile.id is null then
      raise exception 'That model is not declared for this workspace' using errcode = '23514';
    end if;
  end if;

  duration_ms := case when plan ? 'expected_duration_ms' and jsonb_typeof(plan -> 'expected_duration_ms') = 'number'
    then (plan ->> 'expected_duration_ms')::bigint end;
  aspect := left(coalesce(plan ->> 'aspect_ratio', ''), 20);
  -- Duration authority: the Shot carries the timing, exactly as the Real plan does. The
  -- write happens before the plan so the revision the prompt records is the Shot state
  -- the compiled plan actually describes -- otherwise the timing write alone would mark
  -- every compiled prompt stale.
  effective_shot_revision := shot_row.revision;
  if duration_ms is not null and duration_ms is distinct from shot_row.planned_duration_ms then
    update tonde.shots set planned_duration_ms = duration_ms
      where workspace_id = target_workspace and production_id = target_production and id = target_shot;
    select revision into effective_shot_revision from tonde.shots
      where workspace_id = target_workspace and production_id = target_production and id = target_shot;
  end if;
  next_version := coalesce(tonde_private.ai_json_int(plan, 'prompt_version'), coalesce(previous.prompt_version, 0) + 1);
  if next_version < 1 then next_version := coalesce(previous.prompt_version, 0) + 1; end if;

  insert into tonde.execution_plans(workspace_id, production_id, shot_id, execution_method,
    plan_status, readiness_note, generated_by, provider, model, model_version,
    provider_target, model_profile_id, fallback_model_profile_id,
    prompt_version, source_shot_revision, source_versions, canonical_prompt, provider_prompt,
    provider_prompt_edited, provider_prompt_edited_at, routing, first_frame, last_frame, motion, audio,
    continuity, hybrid, negative_constraints, limitations, aspect_ratio, expected_duration_ms,
    cost_state, cost_amount, cost_currency, cost_note,
    shot_size, framing, composition, movement, movement_purpose, lighting_intent, performance,
    product_direction, sound_plan, editorial_intent)
  values (target_workspace, target_production, target_shot, 'ai',
    coalesce(nullif(plan ->> 'plan_status',''), 'draft'), tonde_private.json_text(plan, 'readiness_note', 600),
    coalesce(nullif(plan ->> 'generated_by',''), 'deterministic'),
    nullif(plan ->> 'provider_target',''), nullif(plan ->> 'model_key',''),
    left(coalesce(plan ->> 'model_version',''), 120),
    nullif(plan ->> 'provider_target',''),
    nullif(plan ->> 'model_profile_id','')::uuid, nullif(plan ->> 'fallback_model_profile_id','')::uuid,
    next_version, effective_shot_revision,
    coalesce(plan -> 'source_versions', jsonb_build_object('shot_revision', effective_shot_revision)),
    coalesce(plan -> 'canonical_prompt', '{}'::jsonb), left(coalesce(plan ->> 'provider_prompt',''), 8000),
    coalesce(tonde_private.ai_json_bool(plan, 'provider_prompt_edited', false), false),
    case when coalesce(tonde_private.ai_json_bool(plan, 'provider_prompt_edited', false), false) then now() end,
    coalesce(plan -> 'routing', '{}'::jsonb), coalesce(plan -> 'first_frame','{}'::jsonb),
    coalesce(plan -> 'last_frame','{}'::jsonb), coalesce(plan -> 'motion','{}'::jsonb),
    coalesce(plan -> 'audio','{}'::jsonb), coalesce(plan -> 'continuity','{}'::jsonb),
    coalesce(plan -> 'hybrid','{}'::jsonb), tonde_private.ai_json_text_array(plan, 'negative_constraints'),
    tonde_private.ai_json_text_array(plan, 'limitations'), aspect, duration_ms,
    case when left(coalesce(plan ->> 'cost_currency',''),8) <> '' and plan ? 'cost_amount'
      and jsonb_typeof(plan -> 'cost_amount') = 'number' then 'known' else 'unknown' end,
    case when left(coalesce(plan ->> 'cost_currency',''),8) <> '' and plan ? 'cost_amount'
      and jsonb_typeof(plan -> 'cost_amount') = 'number' then (plan ->> 'cost_amount')::numeric(12,4) end,
    left(coalesce(plan ->> 'cost_currency',''), 8), left(coalesce(plan ->> 'cost_note',''), 400),
    tonde_private.json_text(plan,'shot_size',80), tonde_private.json_text(plan,'framing',300),
    tonde_private.json_text(plan,'composition',400), tonde_private.json_text(plan,'movement',200),
    tonde_private.json_text(plan,'movement_purpose',600), tonde_private.json_text(plan,'lighting_intent',400),
    tonde_private.json_text(plan,'performance',2000), tonde_private.json_text(plan,'product_direction',1200),
    tonde_private.json_text(plan,'sound_plan',2000), tonde_private.json_text(plan,'editorial_intent',300))
  on conflict (shot_id, execution_method) do update set
    plan_status = excluded.plan_status, readiness_note = excluded.readiness_note,
    generated_by = excluded.generated_by, provider = excluded.provider, model = excluded.model,
    model_version = excluded.model_version, provider_target = excluded.provider_target,
    model_profile_id = excluded.model_profile_id, fallback_model_profile_id = excluded.fallback_model_profile_id,
    prompt_version = excluded.prompt_version, source_shot_revision = excluded.source_shot_revision,
    source_versions = excluded.source_versions, canonical_prompt = excluded.canonical_prompt,
    provider_prompt = excluded.provider_prompt, provider_prompt_edited = excluded.provider_prompt_edited,
    provider_prompt_edited_at = coalesce(excluded.provider_prompt_edited_at, tonde.execution_plans.provider_prompt_edited_at),
    routing = excluded.routing, first_frame = excluded.first_frame, last_frame = excluded.last_frame,
    motion = excluded.motion, audio = excluded.audio, continuity = excluded.continuity,
    hybrid = excluded.hybrid, negative_constraints = excluded.negative_constraints,
    limitations = excluded.limitations, aspect_ratio = excluded.aspect_ratio,
    expected_duration_ms = excluded.expected_duration_ms, cost_state = excluded.cost_state,
    cost_amount = excluded.cost_amount, cost_currency = excluded.cost_currency, cost_note = excluded.cost_note,
    shot_size = excluded.shot_size, framing = excluded.framing, composition = excluded.composition,
    movement = excluded.movement, movement_purpose = excluded.movement_purpose,
    lighting_intent = excluded.lighting_intent, performance = excluded.performance,
    product_direction = excluded.product_direction, sound_plan = excluded.sound_plan,
    editorial_intent = excluded.editorial_intent
  returning * into saved;

  -- References are replaced wholesale: the plan's reference set is one decision.
  delete from tonde.ai_shot_references r where r.workspace_id = target_workspace and r.plan_id = saved.id;
  if jsonb_typeof(references_json) = 'array' then
    for item in select jsonb_array_elements(references_json) loop
      insert into tonde.ai_shot_references(workspace_id, production_id, shot_id, plan_id, reference_role,
        priority, asset_id, media_id, origin, source_attempt_id, note, sort_order)
      values (target_workspace, target_production, target_shot, saved.id,
        (item ->> 'role')::tonde.ai_reference_role,
        coalesce(nullif(item ->> 'priority',''), 'SHOULD PRESERVE')::tonde.ai_continuity_priority,
        nullif(item ->> 'asset_id','')::uuid, nullif(item ->> 'media_id','')::uuid,
        coalesce(nullif(item ->> 'origin',''), 'asset'), nullif(item ->> 'source_attempt_id','')::uuid,
        left(coalesce(item ->> 'note',''), 400), coalesce(tonde_private.ai_json_int(item, 'sort_order'), 1024));
      reference_count := reference_count + 1;
    end loop;
  end if;

  -- Capability truth, judged on what was actually stored. A blocking mismatch is refused
  -- and nothing is written; anything else is reported through readiness and limitations.
  if saved.model_profile_id is not null then
    capability := tonde_private.ai_capability_check(target_workspace, saved.model_profile_id, target_production, target_shot);
    if jsonb_array_length(coalesce(capability -> 'blocking', '[]'::jsonb)) > 0 then
      raise exception 'The selected model cannot do this: %',
        array_to_string(array(select jsonb_array_elements_text(capability -> 'blocking')), ' ') using errcode = '23514';
    end if;
  end if;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'prompt_version', saved.prompt_version,
    'source_shot_revision', saved.source_shot_revision, 'references', reference_count,
    'revision', saved.revision, 'approval', saved.approval,
    'readiness', tonde_private.ai_readiness_state(target_workspace, target_production, target_shot),
    'plan', tonde_private.ai_plan_document(target_workspace, target_production, target_shot));
end $$;
revoke all on function tonde.save_ai_plan(uuid,uuid,uuid,integer,jsonb,jsonb,integer) from public, anon, authenticated, service_role;

-- Plan approval and plan lock, mirroring the Real plan surface.
create function tonde.set_ai_plan_approval(target_workspace uuid, target_production uuid, target_shot uuid,
  target_approval text, expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.execution_plans;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if target_approval not in ('draft','needs_review','approved','changed_after_approval') then
    raise exception 'That approval state is not valid' using errcode = '22023';
  end if;
  select * into saved from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if saved.id is null then raise exception 'There is no AI plan for that Shot' using errcode = 'P0002'; end if;
  if expected_revision is not null and saved.revision <> expected_revision then
    raise exception 'That AI plan changed since you loaded it' using errcode = '40001';
  end if;
  update tonde.execution_plans set approval = target_approval::tonde.approval
    where id = saved.id returning * into saved;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'approval', saved.approval,
    'revision', saved.revision);
end $$;
revoke all on function tonde.set_ai_plan_approval(uuid,uuid,uuid,text,integer) from public, anon, authenticated, service_role;

create function tonde.set_ai_plan_lock(target_workspace uuid, target_production uuid, target_shot uuid,
  target_locked boolean, expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.execution_plans;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into saved from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if saved.id is null then raise exception 'There is no AI plan for that Shot' using errcode = 'P0002'; end if;
  if expected_revision is not null and saved.revision <> expected_revision then
    raise exception 'That AI plan changed since you loaded it' using errcode = '40001';
  end if;
  update tonde.execution_plans set locked_at = case when target_locked then now() end
    where id = saved.id returning * into saved;
  return jsonb_build_object('plan_id', saved.id, 'shot_id', target_shot, 'locked', saved.locked_at is not null,
    'revision', saved.revision);
end $$;
revoke all on function tonde.set_ai_plan_lock(uuid,uuid,uuid,boolean,integer) from public, anon, authenticated, service_role;

-- Creator confirmation for generation that may incur material external spend.
create function tonde.confirm_ai_cost(target_workspace uuid, target_production uuid, target_shot uuid,
  note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan_row tonde.execution_plans; saved tonde.ai_cost_confirmations;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into plan_row from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if plan_row.id is null then raise exception 'There is no AI plan for that Shot' using errcode = 'P0002'; end if;
  if plan_row.prompt_version = 0 then
    raise exception 'Compile a prompt before confirming generation cost' using errcode = '23514';
  end if;
  insert into tonde.ai_cost_confirmations(workspace_id, production_id, shot_id, prompt_version,
    provider_key, model_key, cost_state, cost_amount, cost_currency, note)
  values (target_workspace, target_production, target_shot, plan_row.prompt_version,
    coalesce(plan_row.provider_target, 'manual'), coalesce(plan_row.model, ''),
    plan_row.cost_state, plan_row.cost_amount, plan_row.cost_currency, left(coalesce(note,''), 400))
  on conflict (workspace_id, shot_id, prompt_version) do update set
    provider_key = excluded.provider_key, model_key = excluded.model_key,
    cost_state = excluded.cost_state, cost_amount = excluded.cost_amount,
    cost_currency = excluded.cost_currency, note = excluded.note
  returning * into saved;
  return jsonb_build_object('shot_id', target_shot, 'prompt_version', saved.prompt_version,
    'provider_key', saved.provider_key, 'cost_state', saved.cost_state, 'cost_amount', saved.cost_amount,
    'cost_currency', saved.cost_currency, 'confirmed_at', saved.updated_at,
    'readiness', tonde_private.ai_readiness_state(target_workspace, target_production, target_shot));
end $$;
revoke all on function tonde.confirm_ai_cost(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;

-- Continuity locks. A lock records what must stay true and what may vary, so the
-- Director can be helpful without quietly changing a locked identity.
create function tonde.set_ai_lock(target_workspace uuid, target_production uuid, payload jsonb,
  expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.ai_continuity_locks; scope_value tonde.ai_lock_scope; subject uuid; existing_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'A continuity lock must be a JSON object' using errcode = '22023';
  end if;
  scope_value := coalesce(nullif(payload ->> 'scope',''), 'character')::tonde.ai_lock_scope;
  subject := nullif(payload ->> 'subject_id','')::uuid;
  if subject is not null and not exists (select 1 from tonde.assets a
    where a.workspace_id = target_workspace and a.id = subject) then
    raise exception 'That locked subject is not an Asset in this workspace' using errcode = '23514';
  end if;
  select l.revision into existing_revision from tonde.ai_continuity_locks l
    where l.workspace_id = target_workspace and l.production_id = target_production
      and l.scope = scope_value and l.subject_id is not distinct from subject;
  if existing_revision is not null then
    if expected_revision is not null and existing_revision <> expected_revision then
      raise exception 'That lock changed since you loaded it' using errcode = '40001';
    end if;
    update tonde.ai_continuity_locks l set
      label = left(coalesce(payload ->> 'label', l.label), 200),
      locked = coalesce(tonde_private.ai_json_bool(payload, 'locked', l.locked), l.locked),
      priority = coalesce(nullif(payload ->> 'priority',''), l.priority::text)::tonde.ai_continuity_priority,
      locked_traits = case when payload ? 'locked_traits' then tonde_private.ai_json_text_array(payload,'locked_traits') else l.locked_traits end,
      allowed_variations = case when payload ? 'allowed_variations' then tonde_private.ai_json_text_array(payload,'allowed_variations') else l.allowed_variations end,
      prohibited_changes = case when payload ? 'prohibited_changes' then tonde_private.ai_json_text_array(payload,'prohibited_changes') else l.prohibited_changes end,
      identity_truth = left(coalesce(payload ->> 'identity_truth', l.identity_truth), 400),
      consent_note = left(coalesce(payload ->> 'consent_note', l.consent_note), 400),
      note = left(coalesce(payload ->> 'note', l.note), 600),
      locked_at = case when coalesce(tonde_private.ai_json_bool(payload, 'locked', l.locked), l.locked) then now() end
    where l.id = (select l2.id from tonde.ai_continuity_locks l2
        where l2.workspace_id = target_workspace and l2.production_id = target_production
          and l2.scope = scope_value and l2.subject_id is not distinct from subject)
    returning * into saved;
  else
    insert into tonde.ai_continuity_locks(workspace_id, production_id, scope, subject_id, label, locked,
      priority, locked_traits, allowed_variations, prohibited_changes, identity_truth, consent_note, note, locked_at)
    values (target_workspace, target_production, scope_value, subject,
      left(coalesce(payload ->> 'label',''), 200),
      coalesce(tonde_private.ai_json_bool(payload, 'locked', true), true),
      coalesce(nullif(payload ->> 'priority',''), 'MUST PRESERVE')::tonde.ai_continuity_priority,
      tonde_private.ai_json_text_array(payload,'locked_traits'),
      tonde_private.ai_json_text_array(payload,'allowed_variations'),
      tonde_private.ai_json_text_array(payload,'prohibited_changes'),
      left(coalesce(payload ->> 'identity_truth',''), 400), left(coalesce(payload ->> 'consent_note',''), 400),
      left(coalesce(payload ->> 'note',''), 600),
      case when coalesce(tonde_private.ai_json_bool(payload, 'locked', true), true) then now() end)
    returning * into saved;
  end if;
  return jsonb_build_object('lock_id', saved.id, 'scope', saved.scope, 'subject_id', saved.subject_id,
    'label', saved.label, 'locked', saved.locked, 'priority', saved.priority,
    'locked_traits', to_jsonb(saved.locked_traits), 'allowed_variations', to_jsonb(saved.allowed_variations),
    'prohibited_changes', to_jsonb(saved.prohibited_changes), 'revision', saved.revision);
end $$;
revoke all on function tonde.set_ai_lock(uuid,uuid,jsonb,integer) from public, anon, authenticated, service_role;

-- 16. Generation attempts. Submission is idempotent, so a retry cannot spend twice.
create function tonde.create_ai_attempt(target_workspace uuid, target_production uuid, target_shot uuid,
  payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan_row tonde.execution_plans; existing tonde.ai_generation_attempts; saved tonde.ai_generation_attempts;
  idem text; desired_status tonde.ai_attempt_status; mode_value tonde.ai_attempt_mode; op tonde.ai_operation;
  profile tonde.ai_model_profiles; capability jsonb; reference jsonb; next_number integer; provider text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'A generation request must be a JSON object' using errcode = '22023';
  end if;
  select * into plan_row from tonde.execution_plans
    where workspace_id = target_workspace and production_id = target_production
      and shot_id = target_shot and execution_method = 'ai';
  if plan_row.id is null then
    raise exception 'This Shot has no AI plan. Plan it before generating.' using errcode = '23514';
  end if;
  if plan_row.source_shot_revision is not null
    and plan_row.source_shot_revision <> (select revision from tonde.shots
      where workspace_id = target_workspace and production_id = target_production and id = target_shot) then
    raise exception 'The Shot changed after this prompt was compiled. Recompile the prompt before generating.'
      using errcode = '23514';
  end if;
  idem := coalesce(nullif(payload ->> 'idempotency_key',''), '');
  if length(idem) < 8 then
    raise exception 'A generation request needs an idempotency key of at least eight characters' using errcode = '22023';
  end if;
  -- Idempotency first: the same submission returns the same Attempt instead of buying
  -- the same generation again.
  select * into existing from tonde.ai_generation_attempts a
    where a.workspace_id = target_workspace and a.idempotency_key = idem;
  if existing.id is not null then
    return jsonb_build_object('attempt_id', existing.id, 'shot_id', existing.shot_id,
      'attempt_number', existing.attempt_number, 'status', existing.status, 'idempotent', true,
      'mode', existing.mode, 'provider_key', existing.provider_key, 'model_key', existing.model_key,
      'prompt_version', existing.prompt_version, 'cost_state', existing.cost_state,
      'cost_amount', existing.cost_amount, 'cost_currency', existing.cost_currency);
  end if;
  op := coalesce(nullif(payload ->> 'operation','')::tonde.ai_operation,
    tonde_private.ai_primary_operation(target_workspace, target_production, target_shot));
  mode_value := coalesce(nullif(payload ->> 'mode',''), 'live')::tonde.ai_attempt_mode;
  desired_status := coalesce(nullif(payload ->> 'status',''), 'planned')::tonde.ai_attempt_status;
  provider := coalesce(nullif(payload ->> 'provider_key',''), nullif(plan_row.provider_target,''), 'manual');
  if provider <> 'manual' and not exists (select 1 from tonde.ai_providers p where p.key = provider) then
    raise exception 'That provider is not one TONDE recognises' using errcode = '22023';
  end if;
  -- Live submission is the only path that needs a real connection. A model whose declared
  -- facts rule this Shot out is never submitted live, because GENERATE must only be
  -- enabled when capability is compatible.
  if mode_value = 'live' and desired_status in ('queued','submitted','processing')
    and tonde_private.ai_readiness_state(target_workspace, target_production, target_shot) = 'unsupported' then
    raise exception 'The selected model cannot do this Shot. Choose a compatible model before generating.'
      using errcode = '23514';
  end if;
  if mode_value = 'live' and desired_status in ('queued','submitted','processing')
    and not exists (select 1 from tonde.ai_provider_connections c
      where c.workspace_id = target_workspace and c.provider_key = provider and c.state = 'connected') then
    raise exception 'TONDE is not connected to %. Connect it in Setup, or export the prompt and run it yourself.',
      provider using errcode = '23514';
  end if;
  if payload ? 'model_profile_id' and coalesce(payload ->> 'model_profile_id','') <> '' then
    select * into profile from tonde.ai_model_profiles m
      where m.id = (payload ->> 'model_profile_id')::uuid and m.workspace_id = target_workspace and m.lifecycle = 'active';
    if profile.id is null then raise exception 'That model is not declared for this workspace' using errcode = '23514'; end if;
    capability := tonde_private.ai_capability_check(target_workspace, profile.id, target_production, target_shot);
    if capability ->> 'state' = 'UNSUPPORTED' then
      raise exception 'The selected model cannot do this: %',
        array_to_string(array(select jsonb_array_elements_text(capability -> 'reasons')), ' ') using errcode = '23514';
    end if;
  end if;
  -- Reference inputs are private workspace media, never public URLs.
  if jsonb_typeof(payload -> 'input_references') = 'array' then
    for reference in select jsonb_array_elements(payload -> 'input_references') loop
      if coalesce(reference ->> 'url','') ~* '^https?://' then
        raise exception 'Reference inputs must be workspace media, never a public URL' using errcode = '22023';
      end if;
      if reference ? 'asset_id' and not exists (select 1 from tonde.assets a
        where a.workspace_id = target_workspace and a.id = (reference ->> 'asset_id')::uuid) then
        raise exception 'A reference names an Asset outside this workspace' using errcode = '42501';
      end if;
      if reference ? 'media_id' and not exists (select 1 from tonde.media_files f
        where f.workspace_id = target_workspace and f.id = (reference ->> 'media_id')::uuid) then
        raise exception 'A reference names media outside this workspace' using errcode = '42501';
      end if;
    end loop;
  end if;
  -- One live attempt in flight per Shot, prompt version and model.
  if existing.id is null and desired_status in ('queued','submitted','processing') and mode_value = 'live' then
    if exists (select 1 from tonde.ai_generation_attempts a
      where a.workspace_id = target_workspace and a.shot_id = target_shot
        and a.prompt_version = plan_row.prompt_version and a.provider_key = provider
        and a.model_key = coalesce(payload ->> 'model_key', plan_row.model, '') and a.mode = 'live'
        and a.status in ('queued','submitted','processing')) then
      raise exception 'A live generation for this Shot and prompt is already in flight' using errcode = '23514';
    end if;
  end if;
  select coalesce(max(a.attempt_number), 0) + 1 into next_number from tonde.ai_generation_attempts a
    where a.workspace_id = target_workspace and a.shot_id = target_shot;
  insert into tonde.ai_generation_attempts(workspace_id, production_id, shot_id, plan_id, operation,
    attempt_number, provider_key, model_profile_id, model_key, model_version, prompt_version,
    source_shot_revision, idempotency_key, mode, status, external_job_id, seed, settings,
    input_references, request_summary, cost_state, cost_amount, cost_currency, retry_of,
    started_at, failure_code, failure_message)
  values (target_workspace, target_production, target_shot, plan_row.id, op, next_number,
    provider, nullif(payload ->> 'model_profile_id','')::uuid,
    left(coalesce(payload ->> 'model_key', plan_row.model, ''), 120),
    left(coalesce(payload ->> 'model_version', plan_row.model_version, ''), 120),
    coalesce(tonde_private.ai_json_int(payload, 'prompt_version'), plan_row.prompt_version),
    plan_row.source_shot_revision, idem, mode_value, desired_status,
    nullif(payload ->> 'external_job_id',''),
    case when payload ? 'seed' and jsonb_typeof(payload -> 'seed') = 'number' then (payload ->> 'seed')::bigint end,
    coalesce(payload -> 'settings', '{}'::jsonb), coalesce(payload -> 'input_references', '[]'::jsonb),
    coalesce(payload -> 'request_summary', jsonb_build_object('plan_id', plan_row.id,
      'prompt_version', plan_row.prompt_version, 'aspect_ratio', plan_row.aspect_ratio,
      'expected_duration_ms', plan_row.expected_duration_ms)),
    case when left(coalesce(payload ->> 'cost_currency',''),8) <> '' and payload ? 'cost_amount'
      and jsonb_typeof(payload -> 'cost_amount') = 'number' then 'known' else 'unknown' end,
    case when left(coalesce(payload ->> 'cost_currency',''),8) <> '' and payload ? 'cost_amount'
      and jsonb_typeof(payload -> 'cost_amount') = 'number' then (payload ->> 'cost_amount')::numeric(12,4) end,
    left(coalesce(payload ->> 'cost_currency',''), 8), nullif(payload ->> 'retry_of','')::uuid,
    case when desired_status in ('submitted','processing') then now() end,
    left(coalesce(payload ->> 'failure_code',''), 80), left(coalesce(payload ->> 'failure_message',''), 800))
  returning * into saved;
  return jsonb_build_object('attempt_id', saved.id, 'shot_id', saved.shot_id,
    'attempt_number', saved.attempt_number, 'status', saved.status, 'idempotent', false,
    'mode', saved.mode, 'provider_key', saved.provider_key, 'model_key', saved.model_key,
    'prompt_version', saved.prompt_version, 'cost_state', saved.cost_state,
    'cost_amount', saved.cost_amount, 'cost_currency', saved.cost_currency);
end $$;
revoke all on function tonde.create_ai_attempt(uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;

-- Attempt progress and completion. Statuses are real transitions, never invented
-- success: a finished attempt named a real output media, and a failed one says why.
-- Retry classification is explicit so a policy refusal is never retried in a loop.
create function tonde.update_ai_attempt(target_workspace uuid, target_production uuid, target_shot uuid,
  target_attempt uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare attempt tonde.ai_generation_attempts; saved tonde.ai_generation_attempts; media uuid;
  next_status tonde.ai_attempt_status; failure text; retryable_value boolean; result_row tonde.results;
  batch_key uuid;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'An attempt update must be a JSON object' using errcode = '22023';
  end if;
  select * into attempt from tonde.ai_generation_attempts a
    where a.workspace_id = target_workspace and a.production_id = target_production
      and a.shot_id = target_shot and a.id = target_attempt;
  if attempt.id is null then raise exception 'That generation attempt is unavailable' using errcode = 'P0002'; end if;
  next_status := coalesce(nullif(payload ->> 'status','')::tonde.ai_attempt_status, attempt.status);
  if next_status <> attempt.status then
    if not (
      (attempt.status = 'planned' and next_status in ('queued','cancelled','failed'))
      -- In manual mode nothing was submitted to a provider, so a creator who ran the
      -- prompt themselves records the finished output directly. In live mode TONDE does
      -- not skip the submission it is supposedly tracking.
      or (attempt.status = 'planned' and attempt.mode = 'manual'
        and next_status in ('submitted','processing','succeeded','partial'))
      or (attempt.status = 'queued' and next_status in ('submitted','cancelled','failed','expired'))
      or (attempt.status = 'submitted' and next_status in ('processing','succeeded','partial','failed','expired','cancelled'))
      or (attempt.status = 'processing' and next_status in ('succeeded','partial','failed','expired'))
      or (attempt.status in ('succeeded','partial') and next_status in ('partial','failed'))) then
      raise exception 'A generation attempt cannot move from % to %', attempt.status, next_status using errcode = '23514';
    end if;
  end if;
  media := coalesce(nullif(payload ->> 'output_media_id','')::uuid, attempt.output_media_id);
  if next_status in ('succeeded','partial') then
    if media is null then
      raise exception 'A finished attempt must name the media it produced' using errcode = '23514';
    end if;
    if not exists (select 1 from tonde.media_files f
      where f.workspace_id = target_workspace and f.id = media) then
      raise exception 'That output media is not in this workspace' using errcode = '42501';
    end if;
  end if;
  failure := left(coalesce(nullif(payload ->> 'failure_code',''), attempt.failure_code), 80);
  if next_status = 'failed' and failure = '' then
    raise exception 'A failed attempt must say why it failed' using errcode = '23514';
  end if;
  -- Retryable is transient infrastructure only. Anything else is not retried blindly.
  if payload ? 'retryable' then
    retryable_value := tonde_private.ai_json_bool(payload, 'retryable', false);
  elsif next_status in ('failed','expired') and failure <> '' then
    retryable_value := failure = any(array['provider_5xx','rate_limited','network_timeout','provider_unavailable','expired_job']);
  else
    retryable_value := attempt.retryable;
  end if;
  update tonde.ai_generation_attempts a set
    status = next_status,
    external_job_id = left(coalesce(nullif(payload ->> 'external_job_id',''), a.external_job_id), 200),
    seed = case when payload ? 'seed' and jsonb_typeof(payload -> 'seed') = 'number'
      then (payload ->> 'seed')::bigint else a.seed end,
    settings = coalesce(payload -> 'settings', a.settings),
    failure_code = failure,
    failure_message = left(coalesce(nullif(payload ->> 'failure_message',''), a.failure_message), 800),
    retryable = retryable_value,
    cost_state = case when left(coalesce(payload ->> 'cost_currency',''),8) <> '' and payload ? 'cost_amount'
      and jsonb_typeof(payload -> 'cost_amount') = 'number' then 'known' else a.cost_state end,
    cost_amount = case when left(coalesce(payload ->> 'cost_currency',''),8) <> '' and payload ? 'cost_amount'
      and jsonb_typeof(payload -> 'cost_amount') = 'number' then (payload ->> 'cost_amount')::numeric(12,4) else a.cost_amount end,
    cost_currency = left(coalesce(nullif(payload ->> 'cost_currency',''), a.cost_currency), 8),
    output_media_id = media,
    started_at = case when a.started_at is null and next_status in ('submitted','processing','succeeded','partial')
      then now() else a.started_at end,
    completed_at = case when next_status in ('succeeded','partial','failed','cancelled','expired')
      then coalesce(a.completed_at, now()) else a.completed_at end,
    creator_rating = coalesce(tonde_private.ai_json_int(payload, 'creator_rating'), a.creator_rating),
    creator_decision = left(coalesce(nullif(payload ->> 'creator_decision',''), a.creator_decision), 40)
  where a.id = attempt.id returning * into saved;

  -- A finished attempt becomes a Result attached to its canonical Shot, with the
  -- provenance Prompt 9 will need. This does not approve anything.
  if next_status in ('succeeded','partial') and saved.result_id is null and media is not null then
    insert into tonde.results(workspace_id, production_id, scene_id, shot_id, media_id,
      execution_plan_id, state, provenance)
    values (target_workspace, target_production,
      (select h.scene_id from tonde.shots h where h.workspace_id = target_workspace and h.id = target_shot),
      target_shot, media, saved.plan_id, 'needs_review',
      jsonb_build_object('provider', saved.provider_key, 'model', saved.model_key,
        'model_version', saved.model_version, 'operation', saved.operation,
        'attempt_id', saved.id, 'attempt_number', saved.attempt_number,
        'prompt_version', saved.prompt_version, 'source_shot_revision', saved.source_shot_revision,
        'input_references', saved.input_references, 'seed', saved.seed,
        'mode', saved.mode, 'origin', 'ai_generation', 'generated_at', now()))
    returning * into result_row;
    update tonde.ai_generation_attempts a set result_id = result_row.id where a.id = saved.id
      returning * into saved;
  end if;

  -- Keep the batch item for this Shot current, so a partial batch shows real progress
  -- instead of being re-run from the start.
  if next_status in ('succeeded','partial','failed') then
    update tonde.ai_generation_batch_items i set state = case
        when next_status in ('succeeded','partial') then 'succeeded'::tonde.ai_batch_item_state
        else 'failed'::tonde.ai_batch_item_state end,
      attempt_id = saved.id,
      failure_code = case when next_status = 'failed' then failure else '' end,
      failure_message = case when next_status = 'failed'
        then left(coalesce(nullif(payload ->> 'failure_message',''), ''), 800) else '' end
    where i.workspace_id = target_workspace and i.attempt_id = saved.id;
    for batch_key in select distinct i.batch_id from tonde.ai_generation_batch_items i
      where i.workspace_id = target_workspace and i.attempt_id = saved.id loop
      perform tonde_private.ai_batch_refresh(target_workspace, batch_key);
    end loop;
  end if;
  return jsonb_build_object('attempt_id', saved.id, 'shot_id', saved.shot_id, 'status', saved.status,
    'previous_status', attempt.status, 'external_job_id', saved.external_job_id, 'seed', saved.seed,
    'cost_state', saved.cost_state, 'cost_amount', saved.cost_amount, 'cost_currency', saved.cost_currency,
    'retryable', saved.retryable, 'failure_code', saved.failure_code,
    'output_media_id', saved.output_media_id, 'result_id', saved.result_id,
    'result_state', saved.result_state, 'selected', saved.selected, 'revision', saved.revision);
end $$;
revoke all on function tonde.update_ai_attempt(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;

-- Selecting a Result means "this is the current output", never "this Shot is approved".
create function tonde.select_ai_result(target_workspace uuid, target_production uuid, target_shot uuid,
  target_attempt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare attempt tonde.ai_generation_attempts; result_state_value tonde.result_state; result_approval tonde.approval;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into attempt from tonde.ai_generation_attempts a
    where a.workspace_id = target_workspace and a.production_id = target_production
      and a.shot_id = target_shot and a.id = target_attempt;
  if attempt.id is null then raise exception 'That generation attempt is unavailable' using errcode = 'P0002'; end if;
  if attempt.output_media_id is null then
    raise exception 'That attempt has no output to select' using errcode = '23514';
  end if;
  -- Deselecting the previous output clears the selection only. The creator's earlier decision
  -- (needs_review, reject) is theirs to change, not something a new selection overwrites.
  update tonde.ai_generation_attempts a set selected = false
    where a.workspace_id = target_workspace and a.shot_id = target_shot and a.selected and a.id <> target_attempt;
  -- Selecting an output records the choice. A creator decision the creator already made is
  -- left exactly as it is; only an undecided Attempt defaults to 'keep'.
  update tonde.ai_generation_attempts a set selected = true,
    creator_decision = case when a.creator_decision = '' then 'keep' else a.creator_decision end
    where a.id = target_attempt;
  -- The Shot's own approval is untouched, and the Result keeps its own state.
  select state, approval into result_state_value, result_approval from tonde.results r where r.id = attempt.result_id;
  return jsonb_build_object('shot_id', target_shot, 'attempt_id', target_attempt, 'selected', true,
    'result_id', attempt.result_id, 'result_state', result_state_value, 'result_approval', result_approval,
    'shot_approval', (select h.approval from tonde.shots h
      where h.workspace_id = target_workspace and h.id = target_shot),
    'truthfulness', 'Selected means chosen current output. It is not a Shot approval.');
end $$;
revoke all on function tonde.select_ai_result(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- Batch progress lives in one place, so the batch row and its per-Shot items can never
-- disagree about how far a job actually got.
create function tonde_private.ai_batch_refresh(target_workspace uuid, target_batch uuid)
returns tonde.ai_batch_state language plpgsql security definer set search_path = '' as $$
declare succeeded integer; failed integer; active integer; total integer; state_value tonde.ai_batch_state;
begin
  select count(*) filter (where state = 'succeeded'), count(*) filter (where state = 'failed'),
    count(*) filter (where state in ('pending','submitted')), count(*)
    into succeeded, failed, active, total
  from tonde.ai_generation_batch_items i
  where i.workspace_id = target_workspace and i.batch_id = target_batch;
  if total = 0 then return 'confirmed'; end if;
  -- A batch claims success only when every Shot in it succeeded. A blocked or failed Shot
  -- keeps it partial, because eight of ten is not ten.
  state_value := case
    when active > 0 then 'running'::tonde.ai_batch_state
    when succeeded = total then 'succeeded'::tonde.ai_batch_state
    when failed > 0 and succeeded > 0 then 'partial'::tonde.ai_batch_state
    when failed > 0 and succeeded = 0 then 'failed'::tonde.ai_batch_state
    else 'partial'::tonde.ai_batch_state end;
  update tonde.ai_generation_batches b set state = state_value where b.id = target_batch;
  return state_value;
end $$;
revoke all on function tonde_private.ai_batch_refresh(uuid,uuid) from public, anon, authenticated, service_role;

-- 17. Batch generation. Preview first, so a paid batch is never launched blind, and
-- every Shot carries its own item so a partial failure preserves what worked.
create function tonde_private.ai_batch_candidates(target_workspace uuid, target_production uuid,
  target_shot uuid, payload jsonb)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare scope_value tonde.ai_batch_scope; ids uuid[];
begin
  scope_value := coalesce(nullif(payload ->> 'scope',''), 'shot')::tonde.ai_batch_scope;
  if scope_value = 'shot' then
    return array[coalesce(nullif(payload ->> 'shot_id','')::uuid, target_shot)];
  elsif scope_value = 'selection' then
    if jsonb_typeof(payload -> 'shot_ids') <> 'array' then
      raise exception 'A selected batch needs the Shot identifiers it covers' using errcode = '22023';
    end if;
    select array(select (value)::uuid from jsonb_array_elements_text(payload -> 'shot_ids') as value)
      into ids;
    return coalesce(ids, '{}'::uuid[]);
  elsif scope_value = 'scene' then
    select array(select h.id from tonde.shots h
      where h.workspace_id = target_workspace and h.production_id = target_production
        and h.scene_id = coalesce(nullif(payload ->> 'scene_id','')::uuid, target_shot)
        and h.lifecycle = 'active' and h.execution_method in ('ai','hybrid')
      order by h.sort_order, h.id) into ids;
    return coalesce(ids, '{}'::uuid[]);
  else
    select array(select h.id from tonde.shots h
      where h.workspace_id = target_workspace and h.production_id = target_production
        and h.lifecycle = 'active' and h.execution_method in ('ai','hybrid')
      order by h.sort_order, h.id) into ids;
    return coalesce(ids, '{}'::uuid[]);
  end if;
end $$;
revoke all on function tonde_private.ai_batch_candidates(uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;

create function tonde.ai_batch_preview(target_workspace uuid, target_production uuid, target_shot uuid,
  payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare candidates uuid[]; shots jsonb; summary jsonb; cost jsonb; confirmation boolean; reasons text[] := '{}';
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  candidates := tonde_private.ai_batch_candidates(target_workspace, target_production, target_shot, coalesce(payload,'{}'::jsonb));
  if cardinality(candidates) = 0 then
    raise exception 'There are no AI or Hybrid Shots in that scope' using errcode = '23514';
  end if;
  with rows as (
    select h.id as shot_id, h.title, h.planned_duration_ms,
      tonde_private.ai_readiness_state(target_workspace, target_production, h.id) as readiness,
      p.provider_target, p.model as model_key, p.model_profile_id, p.expected_duration_ms,
      p.aspect_ratio,
      -- Cost truth: the plan's own recorded cost, or the pricing declared on the model it
      -- selected. If neither exists the batch says unknown rather than inventing a number.
      case when coalesce(p.cost_state,'unknown') = 'known'
        or (m.cost_amount is not null and coalesce(m.cost_currency,'') <> '') then 'known' else 'unknown' end as cost_state,
      coalesce(p.cost_amount, m.cost_amount) as cost_amount,
      coalesce(nullif(p.cost_currency,''), m.cost_currency, '') as cost_currency,
      coalesce(p.routing -> 'cost_confirmation' ->> 'required','false') = 'true' as wants_confirmation,
      m.label as model_label,
      exists (select 1 from tonde.ai_provider_connections c where c.workspace_id = target_workspace
        and c.provider_key = p.provider_target and c.state = 'connected') as live,
      (select count(*) from tonde.ai_shot_references r where r.workspace_id = target_workspace
        and r.plan_id = p.id and r.priority = 'MUST PRESERVE') as must_references,
      (select count(*) from tonde.ai_shot_references r where r.workspace_id = target_workspace
        and r.plan_id = p.id and r.priority = 'MUST PRESERVE' and r.asset_id is not null) as held_references
    from unnest(candidates) c(shot_id)
    join tonde.shots h on h.workspace_id = target_workspace and h.id = c.shot_id
    left join tonde.execution_plans p on p.workspace_id = h.workspace_id and p.shot_id = h.id
      and p.execution_method = 'ai'
    left join tonde.ai_model_profiles m on m.id = p.model_profile_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'shot_id', shot_id, 'title', title, 'readiness', readiness,
      'blocked', readiness not in ('ready_to_generate','manual_export'),
      'blocked_reason', case
        when readiness = 'unplanned' then 'No AI plan yet.'
        when readiness = 'needs_model' then 'No compatible model is selected.'
        when readiness = 'needs_reference' then 'Required references are missing.'
        when readiness = 'provider_not_connected' then 'The provider is not connected.'
        when readiness = 'unsupported' then 'The selected model cannot do this.'
        when readiness = 'needs_decision' then 'A decision is required before generating.'
        when readiness = 'stale' then 'The Shot changed after the prompt was compiled.'
        when readiness = 'cost_confirmation' then 'Generation cost needs your confirmation.'
        else '' end,
      'provider_key', provider_target, 'model_key', model_key, 'model_label', model_label,
      'model_profile_id', model_profile_id, 'live', coalesce(live, false),
      'cost_state', coalesce(cost_state, 'unknown'), 'cost_amount', cost_amount,
      'cost_currency', cost_currency, 'duration_ms', coalesce(expected_duration_ms, planned_duration_ms),
      'aspect_ratio', coalesce(aspect_ratio, ''), 'must_references', coalesce(must_references, 0),
      'held_references', coalesce(held_references, 0), 'manual_export', readiness = 'manual_export')
      order by shot_id), '[]'::jsonb),
    jsonb_build_object(
      'shots', count(*),
      'ready', count(*) filter (where readiness = 'ready_to_generate'),
      'manual_export', count(*) filter (where readiness = 'manual_export'),
      'blocked', count(*) filter (where readiness not in ('ready_to_generate','manual_export')),
      'live', count(*) filter (where coalesce(live,false)),
      'known_cost', count(*) filter (where cost_state = 'known'),
      'unknown_cost', count(*) filter (where coalesce(cost_state,'unknown') <> 'known'))
  into shots, summary from rows;
  with rows as (
    select case when coalesce(p.cost_state,'unknown') = 'known'
        or (m.cost_amount is not null and coalesce(m.cost_currency,'') <> '') then 'known' else 'unknown' end as cost_state,
      coalesce(p.cost_amount, m.cost_amount) as cost_amount,
      coalesce(nullif(p.cost_currency,''), m.cost_currency, '') as cost_currency,
      p.provider_target,
      coalesce(p.routing -> 'cost_confirmation' ->> 'required','false') = 'true' as wants_confirmation,
      exists (select 1 from tonde.ai_provider_connections c where c.workspace_id = target_workspace
        and c.provider_key = p.provider_target and c.state = 'connected') as live
    from unnest(candidates) c(shot_id)
    join tonde.execution_plans p on p.workspace_id = target_workspace
      and p.production_id = target_production and p.shot_id = c.shot_id and p.execution_method = 'ai'
    left join tonde.ai_model_profiles m on m.id = p.model_profile_id
  )
  select jsonb_build_object(
      'state', case when count(*) filter (where cost_state <> 'known') > 0 then 'unknown' else 'known' end,
      'amount', case when count(*) filter (where cost_state <> 'known') = 0 then sum(cost_amount) end,
      'currency', case when count(*) filter (where cost_state <> 'known') = 0
        then min(cost_currency) end,
      'known_subtotal_amount', coalesce(sum(cost_amount) filter (where cost_state = 'known'), 0),
      'known_subtotal_currency', coalesce(min(cost_currency) filter (where cost_state = 'known'), ''),
      'unknown_count', count(*) filter (where cost_state <> 'known'),
      'note', case when count(*) filter (where cost_state <> 'known') > 0
        then 'Some selected models have no verified pricing. TONDE will not invent an amount.'
        else 'Based on the pricing you declared for each model.' end),
    (count(*) filter (where coalesce(live,false) and coalesce(wants_confirmation,false))) > 0
      or (count(*) filter (where coalesce(live,false) and cost_state = 'known' and cost_amount > 0)) > 0
  into cost, confirmation from rows;
  if confirmation then
    reasons := array_append(reasons, 'A connected provider with declared pricing is included, so this batch spends real money.');
  end if;
  if (summary ->> 'unknown_cost')::integer > 0 then
    reasons := array_append(reasons, 'Some Shots have no verified pricing, so TONDE reports COST UNKNOWN rather than a number.');
  end if;
  return jsonb_build_object('production_id', target_production, 'scope',
    coalesce(nullif(payload ->> 'scope',''), 'shot'), 'shots', shots, 'summary', summary,
    'cost', cost, 'confirmation_required', confirmation,
    'confirmation_reasons', to_jsonb(reasons),
    'partial_failure_policy', 'Each Shot keeps its own Attempt, so a failure preserves the Shots that succeeded.');
end $$;
revoke all on function tonde.ai_batch_preview(uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;

create function tonde.create_ai_batch(target_workspace uuid, target_production uuid, target_shot uuid,
  payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare preview jsonb; saved tonde.ai_generation_batches; item jsonb; scope_value tonde.ai_batch_scope;
  shot_key uuid; attempt_saved tonde.ai_generation_attempts; plan_row tonde.execution_plans;
  next_number integer; blocked boolean; item_state tonde.ai_batch_item_state;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'A batch request must be a JSON object' using errcode = '22023';
  end if;
  preview := tonde.ai_batch_preview(target_workspace, target_production, target_shot, payload);
  -- Material external spend needs the creator, always.
  if (preview ->> 'confirmation_required')::boolean
    and coalesce(payload ->> 'confirmed','false') <> 'true' then
    raise exception 'This batch spends real money at the provider. Confirm the batch before it is created.'
      using errcode = '23514';
  end if;
  scope_value := coalesce(nullif(payload ->> 'scope',''), 'shot')::tonde.ai_batch_scope;
  insert into tonde.ai_generation_batches(workspace_id, production_id, scope, scene_id, state,
    confirmation_required, confirmation_note, confirmed_at, confirmed_by,
    cost_state, estimated_cost_amount, estimated_cost_currency,
    shot_count, blocked_count, unknown_cost_count, note)
  values (target_workspace, target_production, scope_value,
    nullif(payload ->> 'scene_id','')::uuid, 'confirmed',
    (preview ->> 'confirmation_required')::boolean, left(coalesce(payload ->> 'note',''), 400),
    case when (preview ->> 'confirmation_required')::boolean then now() end,
    case when (preview ->> 'confirmation_required')::boolean then auth.uid() end,
    preview -> 'cost' ->> 'state',
    case when preview -> 'cost' ->> 'state' = 'known'
      then (preview -> 'cost' ->> 'amount')::numeric(12,4) end,
    coalesce(preview -> 'cost' ->> 'currency', ''),
    (preview -> 'summary' ->> 'shots')::integer, (preview -> 'summary' ->> 'blocked')::integer,
    (preview -> 'summary' ->> 'unknown_cost')::integer, left(coalesce(payload ->> 'note',''), 600))
  returning * into saved;
  -- One item per Shot, and a planned Attempt for everything that is not blocked, so the
  -- batch is a durable job rather than a loop that holds a request open.
  for item in select jsonb_array_elements(preview -> 'shots') loop
    shot_key := (item ->> 'shot_id')::uuid;
    blocked := (item ->> 'blocked')::boolean;
    item_state := case when blocked then 'blocked'::tonde.ai_batch_item_state else 'pending'::tonde.ai_batch_item_state end;
    attempt_saved := null;
    if not blocked then
      select * into plan_row from tonde.execution_plans p
        where p.workspace_id = target_workspace and p.production_id = target_production
          and p.shot_id = shot_key and p.execution_method = 'ai';
      select coalesce(max(a.attempt_number), 0) + 1 into next_number from tonde.ai_generation_attempts a
        where a.workspace_id = target_workspace and a.shot_id = shot_key;
      insert into tonde.ai_generation_attempts(workspace_id, production_id, shot_id, plan_id, operation,
        attempt_number, provider_key, model_profile_id, model_key, model_version, prompt_version,
        source_shot_revision, idempotency_key, mode, status, settings, input_references, request_summary,
        cost_state, cost_amount, cost_currency)
      -- The operation the Shot actually needs, not a blanket 'video': a narration Shot batched
      -- through here is recorded as the speech attempt it is.
      values (target_workspace, target_production, shot_key, plan_row.id,
        tonde_private.ai_primary_operation(target_workspace, target_production, shot_key), next_number,
        coalesce(plan_row.provider_target, 'manual'), plan_row.model_profile_id, coalesce(plan_row.model, ''),
        plan_row.model_version, plan_row.prompt_version, plan_row.source_shot_revision,
        'batch:' || saved.id::text || ':' || shot_key::text,
        case when plan_row.provider_target is null or plan_row.provider_target in ('','manual')
          then 'manual'::tonde.ai_attempt_mode else 'live'::tonde.ai_attempt_mode end,
        'planned', '{}'::jsonb,
        coalesce((select jsonb_agg(jsonb_build_object('role', r.reference_role, 'asset_id', r.asset_id,
            'media_id', r.media_id) order by r.sort_order)
          from tonde.ai_shot_references r where r.workspace_id = target_workspace and r.plan_id = plan_row.id), '[]'::jsonb),
        jsonb_build_object('batch_id', saved.id, 'prompt_version', plan_row.prompt_version),
        coalesce(plan_row.cost_state, 'unknown'), plan_row.cost_amount,
        coalesce(plan_row.cost_currency, ''))
      on conflict (workspace_id, idempotency_key) do nothing
      returning * into attempt_saved;
      if attempt_saved.id is null then
        select * into attempt_saved from tonde.ai_generation_attempts a
          where a.workspace_id = target_workspace
            and a.idempotency_key = 'batch:' || saved.id::text || ':' || shot_key::text;
      end if;
    end if;
    insert into tonde.ai_generation_batch_items(workspace_id, production_id, batch_id, shot_id, state,
      blocked_reason, attempt_id, cost_state, cost_amount, cost_currency)
    values (target_workspace, target_production, saved.id, shot_key, item_state,
      case when blocked then left(coalesce(item ->> 'blocked_reason',''), 200) else '' end,
      attempt_saved.id, coalesce(item ->> 'cost_state','unknown'),
      case when item ->> 'cost_state' = 'known' then (item ->> 'cost_amount')::numeric(12,4) end,
      coalesce(item ->> 'cost_currency',''))
    on conflict (batch_id, shot_id) do nothing;
  end loop;
  return jsonb_build_object('batch_id', saved.id, 'production_id', target_production, 'scope', saved.scope,
    'state', saved.state, 'confirmation_required', saved.confirmation_required,
    'confirmed_at', saved.confirmed_at, 'cost_state', saved.cost_state,
    'estimated_cost_amount', saved.estimated_cost_amount,
    'estimated_cost_currency', saved.estimated_cost_currency,
    'summary', preview -> 'summary', 'cost', preview -> 'cost',
    'items', (select coalesce(jsonb_agg(jsonb_build_object('shot_id', i.shot_id, 'state', i.state,
        'blocked_reason', i.blocked_reason, 'attempt_id', i.attempt_id,
        'cost_state', i.cost_state, 'cost_amount', i.cost_amount,
        'cost_currency', i.cost_currency) order by i.shot_id), '[]'::jsonb)
      from tonde.ai_generation_batch_items i
      where i.workspace_id = target_workspace and i.batch_id = saved.id));
end $$;
revoke all on function tonde.create_ai_batch(uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;

-- Per-item progress. A partial batch keeps its successes and retries only what failed.
create function tonde.record_ai_batch_item(target_workspace uuid, target_production uuid,
  target_batch uuid, target_shot uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item tonde.ai_generation_batch_items; batch tonde.ai_generation_batches;
  next_state tonde.ai_batch_item_state; succeeded integer; failed integer; running integer; total integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into item from tonde.ai_generation_batch_items i
    where i.workspace_id = target_workspace and i.production_id = target_production
      and i.batch_id = target_batch and i.shot_id = target_shot;
  if item.id is null then raise exception 'That Shot is not part of that batch' using errcode = 'P0002'; end if;
  select * into batch from tonde.ai_generation_batches b
    where b.workspace_id = target_workspace and b.id = target_batch;
  -- Failed and partial batches stay open on purpose: that is where a retry lives. A batch
  -- whose every Shot succeeded has nothing left to record.
  if batch.state in ('succeeded','cancelled') then
    raise exception 'That batch is already closed' using errcode = '23514';
  end if;
  next_state := coalesce(nullif(payload ->> 'state','')::tonde.ai_batch_item_state, item.state);
  update tonde.ai_generation_batch_items i set
    state = next_state,
    blocked_reason = left(coalesce(payload ->> 'blocked_reason', i.blocked_reason), 200),
    attempt_id = coalesce(nullif(payload ->> 'attempt_id','')::uuid, i.attempt_id),
    failure_code = left(coalesce(payload ->> 'failure_code', i.failure_code), 80),
    failure_message = left(coalesce(payload ->> 'failure_message', i.failure_message), 800)
  where i.id = item.id returning * into item;
  -- The Attempt carries the same failure, so the batch item and the Attempt never
  -- disagree about why a Shot did not generate.
  if next_state = 'failed' and item.attempt_id is not null then
    update tonde.ai_generation_attempts a set
      status = 'failed',
      failure_code = left(coalesce(payload ->> 'failure_code', 'provider_error'), 80),
      failure_message = left(coalesce(payload ->> 'failure_message', ''), 800),
      retryable = left(coalesce(payload ->> 'failure_code', ''), 80) = any(array['provider_5xx','rate_limited','network_timeout','provider_unavailable','expired_job']),
      completed_at = coalesce(a.completed_at, now())
    where a.workspace_id = target_workspace and a.id = item.attempt_id
      and a.status in ('planned','queued','submitted','processing');
  end if;
  perform tonde_private.ai_batch_refresh(target_workspace, target_batch);
  select * into batch from tonde.ai_generation_batches b where b.id = target_batch;
  select count(*) filter (where state = 'succeeded'), count(*) filter (where state = 'failed'),
    count(*) filter (where state in ('pending','submitted')), count(*)
    into succeeded, failed, running, total
  from tonde.ai_generation_batch_items i
  where i.workspace_id = target_workspace and i.batch_id = target_batch;
  return jsonb_build_object('batch_id', batch.id, 'state', batch.state, 'shot_id', target_shot,
    'item_state', item.state, 'attempt_id', item.attempt_id,
    'failure_code', item.failure_code, 'failure_message', item.failure_message,
    'progress', jsonb_build_object('succeeded', succeeded, 'failed', failed, 'total', total),
    'partial_failure_policy', 'Retry only the failed Shots; the successful Attempts are kept.');
end $$;
revoke all on function tonde.record_ai_batch_item(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;

-- 18. Privileges: authenticated only, never anon or service_role. Private helpers stay
-- unreachable from the API.
revoke all on function tonde.ai_creation_surface(uuid,uuid,integer),
  tonde.ai_shot_detail(uuid,uuid,uuid),
  tonde.ai_model_catalog(uuid),
  tonde.ai_capability_verdict(uuid,uuid,uuid,uuid),
  tonde.declare_ai_model(uuid,jsonb,integer),
  tonde.set_ai_connection(uuid,text,text,text,text,integer),
  tonde.save_ai_plan(uuid,uuid,uuid,integer,jsonb,jsonb,integer),
  tonde.set_ai_plan_approval(uuid,uuid,uuid,text,integer),
  tonde.set_ai_plan_lock(uuid,uuid,uuid,boolean,integer),
  tonde.confirm_ai_cost(uuid,uuid,uuid,text),
  tonde.set_ai_lock(uuid,uuid,jsonb,integer),
  tonde.create_ai_attempt(uuid,uuid,uuid,jsonb),
  tonde.update_ai_attempt(uuid,uuid,uuid,uuid,jsonb),
  tonde.select_ai_result(uuid,uuid,uuid,uuid),
  tonde.ai_batch_preview(uuid,uuid,uuid,jsonb),
  tonde.create_ai_batch(uuid,uuid,uuid,jsonb),
  tonde.record_ai_batch_item(uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.ai_creation_surface(uuid,uuid,integer),
  tonde.ai_capability_verdict(uuid,uuid,uuid,uuid),
  tonde.ai_shot_detail(uuid,uuid,uuid),
  tonde.ai_model_catalog(uuid),
  tonde.declare_ai_model(uuid,jsonb,integer),
  tonde.set_ai_connection(uuid,text,text,text,text,integer),
  tonde.save_ai_plan(uuid,uuid,uuid,integer,jsonb,jsonb,integer),
  tonde.set_ai_plan_approval(uuid,uuid,uuid,text,integer),
  tonde.set_ai_plan_lock(uuid,uuid,uuid,boolean,integer),
  tonde.confirm_ai_cost(uuid,uuid,uuid,text),
  tonde.set_ai_lock(uuid,uuid,jsonb,integer),
  tonde.create_ai_attempt(uuid,uuid,uuid,jsonb),
  tonde.update_ai_attempt(uuid,uuid,uuid,uuid,jsonb),
  tonde.select_ai_result(uuid,uuid,uuid,uuid),
  tonde.ai_batch_preview(uuid,uuid,uuid,jsonb),
  tonde.create_ai_batch(uuid,uuid,uuid,jsonb),
  tonde.record_ai_batch_item(uuid,uuid,uuid,uuid,jsonb)
  to authenticated;
commit;
