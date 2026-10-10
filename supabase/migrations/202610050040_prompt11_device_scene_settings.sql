-- Prompt 11 packet 040 — device and lens intelligence, scene intelligence, camera settings.
--
-- TONDE's promise is "make it with what you actually have". That promise is only honest if TONDE knows
-- what the equipment can DO, not merely that it exists. Prompts 1–9 already model equipment as
-- `tonde.production_resources` with `resource_compatibility` relations and per-shot `execution_plans`
-- (real: camera + lens, ai: provider + model). This packet adds the missing facts and the deterministic
-- engine that turns them into settings — and, just as important, into refusals.
--
-- Laws enforced here, not merely described:
--   * Capability is DECLARED and then VERIFIED. A declaration names its source; verification is a
--     separate, recorded act by a workspace admin. The engine reports which it is using, and never
--     presents an unverified declaration as a verified fact.
--   * The engine is deterministic arithmetic over declared capabilities and a stated intent. The same
--     inputs produce the same proposal, and every value carries its basis.
--   * A recommendation never exceeds the equipment. Where the intent cannot be satisfied, the engine
--     refuses with a named reason and the limit it hit (mount, image circle, frame rate, resolution,
--     codec, shutter, aperture, ISO, ND) instead of inventing a number.
--   * A measurement that was not supplied is not invented: with no scene exposure, ND is reported as
--     not determined and says why.
--   * Applying settings to a Production's execution plan is a creator decision. The engine proposes;
--     the creator accepts or rejects, and the acceptance is what writes into the plan.
--   * Scene requirements are the "what this scene needs" model: lighting, movement, framing,
--     environment, time of day, audio, permission, safety and cast, each mandatory or not, each with
--     its source. Scene intelligence reports the gaps rather than assuming they are covered.
begin;

-- 1. Device capability. One row per camera-class resource, with the limits that make advice possible.
create table tonde.device_capabilities (
  resource_id uuid primary key,
  workspace_id uuid not null,
  device_kind text not null check (device_kind in ('camera','phone_camera','drone','action_camera','other')),
  sensor_format text not null check (length(btrim(sensor_format)) between 2 and 60),
  crop_factor numeric(6,3) not null check (crop_factor > 0 and crop_factor <= 20),
  resolution_modes text[] not null default '{}',
  frame_rates numeric[] not null default '{}',
  max_frame_rate numeric check (max_frame_rate is null or max_frame_rate > 0),
  codecs text[] not null default '{}',
  mounts text[] not null default '{}',
  stabilization text not null default 'unknown'
    check (stabilization in ('none','optical','sensor_shift','electronic','hybrid','unknown')),
  nd_stops numeric(4,1) check (nd_stops is null or nd_stops >= 0),
  iso_min integer check (iso_min is null or iso_min > 0),
  iso_max integer check (iso_max is null or iso_max > 0),
  shutter_min_seconds numeric(10,6) check (shutter_min_seconds is null or shutter_min_seconds > 0),
  recording_limit_seconds integer check (recording_limit_seconds is null or recording_limit_seconds > 0),
  battery_runtime_minutes integer check (battery_runtime_minutes is null or battery_runtime_minutes > 0),
  raw_recording boolean not null default false,
  log_profile text,
  thermal_note text check (thermal_note is null or length(thermal_note) <= 400),
  source text not null default 'creator' check (source in ('manufacturer','creator','reference','import')),
  source_label text,
  notes text check (notes is null or length(notes) <= 1000),
  declared_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  verification_note text check (verification_note is null or length(verification_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  constraint device_iso_range_ordered check (iso_min is null or iso_max is null or iso_min <= iso_max),
  -- A CHECK may not contain a subquery, so "max_frame_rate is at most the largest declared rate"
  -- is stated as the negation of "exceeds every declared rate". Empty arrays are allowed.
  constraint device_rates_bounded check (max_frame_rate is null or cardinality(frame_rates) = 0
    or not (max_frame_rate > all(frame_rates))),
  constraint device_source_is_named check (source in ('creator','import') or source_label is not null),
  constraint device_verification_is_stamped check ((verified_at is null) = (verified_by is null))
);
create trigger guard_mutation before insert or update on tonde.device_capabilities
  for each row execute function tonde_private.guard_mutation();
alter table tonde.device_capabilities enable row level security;
create policy tenant_read on tonde.device_capabilities for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.device_capabilities to authenticated;
grant all on tonde.device_capabilities to service_role;

-- 2. Lens capability. A lens is a resource like any other; what it adds is reach and light.
create table tonde.lens_capabilities (
  resource_id uuid primary key,
  workspace_id uuid not null,
  mount text not null check (length(btrim(mount)) between 1 and 60),
  focal_min_mm numeric(7,2) not null check (focal_min_mm > 0),
  focal_max_mm numeric(7,2) not null check (focal_max_mm > 0),
  max_aperture numeric(4,1) not null check (max_aperture > 0 and max_aperture <= 64),
  min_aperture numeric(4,1) check (min_aperture is null or (min_aperture > 0 and min_aperture <= 64)),
  image_circle_mm numeric(6,2) check (image_circle_mm is null or image_circle_mm > 0),
  min_focus_m numeric(6,3) check (min_focus_m is null or min_focus_m > 0),
  stabilization text not null default 'unknown'
    check (stabilization in ('none','optical','sensor_shift','electronic','hybrid','unknown')),
  filter_thread_mm numeric(6,1) check (filter_thread_mm is null or filter_thread_mm > 0),
  source text not null default 'creator' check (source in ('manufacturer','creator','reference','import')),
  source_label text,
  notes text check (notes is null or length(notes) <= 1000),
  declared_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  constraint lens_focal_range_ordered check (focal_min_mm <= focal_max_mm),
  constraint lens_aperture_range_ordered check (min_aperture is null or max_aperture <= min_aperture),
  constraint lens_source_is_named check (source in ('creator','import') or source_label is not null),
  constraint lens_verification_is_stamped check ((verified_at is null) = (verified_by is null))
);
create trigger guard_mutation before insert or update on tonde.lens_capabilities
  for each row execute function tonde_private.guard_mutation();
alter table tonde.lens_capabilities enable row level security;
create policy tenant_read on tonde.lens_capabilities for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.lens_capabilities to authenticated;
grant all on tonde.lens_capabilities to service_role;

-- 3. Scene requirements. What a scene or shot needs before it can be filmed or generated.
create table tonde.scene_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  scene_id uuid,
  shot_id uuid,
  requirement_kind text not null check (requirement_kind in ('lighting','movement','framing','environment',
    'time_of_day','audio','permission','safety','cast','prop','wardrobe','location')),
  detail text not null check (length(btrim(detail)) between 3 and 600),
  mandatory boolean not null default true,
  source text not null default 'creator' check (source in ('creator','plan','import')),
  state text not null default 'open' check (state in ('open','met','waived')),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 1000),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  constraint scene_requirement_has_a_target check (scene_id is not null or shot_id is not null),
  constraint scene_requirement_settled_is_stamped check (state = 'open'
    or (resolved_at is not null and resolved_by is not null)),
  constraint scene_requirement_waiver_is_explained check (state <> 'waived' or resolution_note is not null)
);
create trigger guard_mutation before insert or update on tonde.scene_requirements
  for each row execute function tonde_private.guard_mutation();
create unique index scene_requirement_unique on tonde.scene_requirements(production_id,
  coalesce(shot_id, scene_id), requirement_kind, detail);
create index scene_requirements_by_target on tonde.scene_requirements(workspace_id, production_id,
  requirement_kind, state);
alter table tonde.scene_requirements enable row level security;
create policy tenant_read on tonde.scene_requirements for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.scene_requirements to authenticated;
grant all on tonde.scene_requirements to service_role;

-- 4. Settings proposals. The engine's output, with its basis and its refusals kept as evidence.
create table tonde.camera_settings_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  scene_id uuid,
  shot_id uuid,
  camera_resource_id uuid not null,
  lens_resource_id uuid,
  intent jsonb not null default '{}'::jsonb check (jsonb_typeof(intent) = 'object'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  basis jsonb not null default '{}'::jsonb check (jsonb_typeof(basis) = 'object'),
  refusals jsonb not null default '[]'::jsonb check (jsonb_typeof(refusals) = 'array'),
  satisfied boolean not null default false,
  capability_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(capability_snapshot) = 'object'),
  capability_state text not null default 'declared' check (capability_state in ('missing','declared','verified')),
  engine_version text not null default '1',
  intent_hash text not null,
  state text not null default 'proposed' check (state in ('proposed','accepted','rejected','superseded')),
  proposed_by uuid references auth.users(id) on delete set null,
  proposed_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  applied_plan_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, camera_resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  foreign key (workspace_id, lens_resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  foreign key (workspace_id, applied_plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict,
  -- A satisfied proposal has no refusals, and a refusal is never hidden by a satisfied flag.
  constraint settings_satisfied_has_no_refusals check (satisfied = (jsonb_array_length(refusals) = 0)),
  constraint settings_decision_is_stamped check (state in ('proposed','superseded')
    or (decided_at is not null and decided_by is not null))
);
create unique index camera_settings_proposal_unique on tonde.camera_settings_proposals(production_id,
  coalesce(shot_id, scene_id), camera_resource_id, coalesce(lens_resource_id, '00000000-0000-0000-0000-000000000000'::uuid),
  intent_hash) where state in ('proposed','accepted');
create index camera_settings_proposals_open on tonde.camera_settings_proposals(workspace_id, production_id,
  state, proposed_at desc);
create trigger guard_mutation before insert or update on tonde.camera_settings_proposals
  for each row execute function tonde_private.guard_mutation();
alter table tonde.camera_settings_proposals enable row level security;
create policy tenant_read on tonde.camera_settings_proposals for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.camera_settings_proposals to authenticated;
grant all on tonde.camera_settings_proposals to service_role;

-- 5. Guards. A client may declare what it owns and may accept a proposal; it may not verify capability,
--    and it may not rewrite a decided proposal.
create function tonde_private.guard_device_capability() returns trigger
language plpgsql security definer set search_path = '' as $$
declare admin boolean;
begin
  admin := (select auth.role()) = 'service_role' or auth.uid() is null
    or tonde_private.is_workspace_admin(new.workspace_id);
  if tg_op = 'INSERT' then
    if new.verified_at is not null and not admin then
      raise exception 'Capability is verified by a workspace admin, not by the session declaring it'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.resource_id is distinct from old.resource_id or new.workspace_id is distinct from old.workspace_id then
    raise exception 'A capability belongs to the resource it describes' using errcode = '23514';
  end if;
  if (new.verified_at is distinct from old.verified_at or new.verified_by is distinct from old.verified_by)
    and not admin then
    raise exception 'Capability verification is recorded by a workspace admin' using errcode = '42501';
  end if;
  -- Verification is about exact facts. Changing a limit withdraws verification rather than refusing the
  -- correction, so a declared limit is always correctable; the withdrawn row drops back to 'declared' and
  -- must be verified again by a workspace admin before advice may call it verified.
  if new.verified_at is not null and (new.crop_factor is distinct from old.crop_factor
      or new.iso_max is distinct from old.iso_max or new.mounts is distinct from old.mounts
      or new.codecs is distinct from old.codecs or new.resolution_modes is distinct from old.resolution_modes
      or new.frame_rates is distinct from old.frame_rates or new.nd_stops is distinct from old.nd_stops
      or new.shutter_min_seconds is distinct from old.shutter_min_seconds
      or new.max_frame_rate is distinct from old.max_frame_rate) then
    new.verified_at := null;
    new.verified_by := null;
    new.verification_note := null;
  end if;
  return new;
end $$;
create trigger guard_device_capability before insert or update on tonde.device_capabilities
  for each row execute function tonde_private.guard_device_capability();
revoke all on function tonde_private.guard_device_capability() from public, anon, authenticated, service_role;

create function tonde_private.guard_camera_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'proposed' then
      raise exception 'A settings proposal is proposed first and decided afterwards' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.state in ('accepted','rejected') and (new.state is distinct from old.state
      or new.settings is distinct from old.settings or new.refusals is distinct from old.refusals) then
    raise exception 'A decided proposal is a closed record; propose again with a new intent'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_camera_settings before insert or update on tonde.camera_settings_proposals
  for each row execute function tonde_private.guard_camera_settings();
revoke all on function tonde_private.guard_camera_settings() from public, anon, authenticated, service_role;

-- 6. Private helpers: the arithmetic, named so a test can pin it.
create function tonde_private.device_sensor_diagonal_mm(crop_factor numeric) returns numeric
language sql immutable set search_path = '' as $$
  -- Full-frame 36x24 has a 43.27mm diagonal; a crop factor scales the required image circle.
  select round((43.2666 / greatest(crop_factor, 0.1))::numeric, 2);
$$;
revoke all on function tonde_private.device_sensor_diagonal_mm(numeric)
  from public, anon, authenticated, service_role;

create function tonde_private.exposure_ev(p_aperture numeric, p_shutter_seconds numeric, p_iso numeric)
returns numeric language sql immutable set search_path = '' as $$
  -- Exposure value at ISO 100 for an aperture and a shutter time, adjusted for the working ISO.
  select round((2 * log(2, greatest(p_aperture, 0.1)) - log(2, greatest(p_shutter_seconds, 0.000001))
    - log(2, greatest(p_iso, 1) / 100.0))::numeric, 2);
$$;
revoke all on function tonde_private.exposure_ev(numeric,numeric,numeric)
  from public, anon, authenticated, service_role;

create function tonde_private.device_capability_state(target_workspace uuid, target_resource uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when c.resource_id is null then 'missing'
    when c.verified_at is not null then 'verified' else 'declared' end
  from (select 1) probe left join tonde.device_capabilities c
    on c.workspace_id = target_workspace and c.resource_id = target_resource;
$$;
revoke all on function tonde_private.device_capability_state(uuid,uuid)
  from public, anon, authenticated, service_role;

-- 7. Declaring, verifying and reading capability.
create function tonde.device_capability_declare(target_workspace uuid, target_resource uuid, p_facts jsonb,
  p_source text default 'creator', p_source_label text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; resource tonde.production_resources; capability tonde.device_capabilities;
  existing tonde.device_capabilities;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if jsonb_typeof(p_facts) <> 'object' then
    raise exception 'Capability is declared as an object' using errcode = '22023';
  end if;
  if p_source not in ('manufacturer','creator','reference','import') then
    raise exception 'A capability declaration names where it came from' using errcode = '22023';
  end if;
  select * into resource from tonde.production_resources r
    where r.workspace_id = target_workspace and r.id = target_resource;
  if not found then raise exception 'That production resource does not exist' using errcode = 'P0002'; end if;
  if resource.resource_type = 'lens' then
    raise exception 'A lens declares lens capability, not device capability' using errcode = '22023';
  end if;
  select * into existing from tonde.device_capabilities c where c.resource_id = target_resource;
  insert into tonde.device_capabilities(resource_id, workspace_id, device_kind, sensor_format, crop_factor,
    resolution_modes, frame_rates, max_frame_rate, codecs, mounts, stabilization, nd_stops, iso_min, iso_max,
    shutter_min_seconds, recording_limit_seconds, battery_runtime_minutes, raw_recording, log_profile,
    thermal_note, source, source_label, notes, declared_by)
  values (target_resource, target_workspace,
    coalesce(nullif(p_facts ->> 'device_kind', ''), case when resource.resource_type::text in ('camera','phone_camera','drone','action_camera')
      then resource.resource_type::text else 'other' end),
    coalesce(nullif(btrim(p_facts ->> 'sensor_format'), ''), 'unspecified'),
    coalesce(nullif(p_facts ->> 'crop_factor', '')::numeric, 1),
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(p_facts -> 'resolution_modes', '[]'::jsonb)) as value), '{}'),
    coalesce((select array_agg(value::numeric) from jsonb_array_elements_text(coalesce(p_facts -> 'frame_rates', '[]'::jsonb)) as value), '{}'),
    nullif(p_facts ->> 'max_frame_rate', '')::numeric,
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(p_facts -> 'codecs', '[]'::jsonb)) as value), '{}'),
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(p_facts -> 'mounts', '[]'::jsonb)) as value), '{}'),
    coalesce(nullif(p_facts ->> 'stabilization', ''), 'unknown'),
    nullif(p_facts ->> 'nd_stops', '')::numeric,
    nullif(p_facts ->> 'iso_min', '')::integer, nullif(p_facts ->> 'iso_max', '')::integer,
    nullif(p_facts ->> 'shutter_min_seconds', '')::numeric,
    nullif(p_facts ->> 'recording_limit_seconds', '')::integer,
    nullif(p_facts ->> 'battery_runtime_minutes', '')::integer,
    coalesce((p_facts ->> 'raw_recording')::boolean, false),
    nullif(btrim(coalesce(p_facts ->> 'log_profile', '')), ''),
    nullif(left(coalesce(p_facts ->> 'thermal_note', ''), 400), ''),
    p_source, nullif(btrim(coalesce(p_source_label, '')), ''), nullif(left(coalesce(p_notes, ''), 1000), ''), actor)
  on conflict (resource_id) do update set device_kind = excluded.device_kind,
    sensor_format = excluded.sensor_format, crop_factor = excluded.crop_factor,
    resolution_modes = excluded.resolution_modes, frame_rates = excluded.frame_rates,
    max_frame_rate = excluded.max_frame_rate, codecs = excluded.codecs, mounts = excluded.mounts,
    stabilization = excluded.stabilization, nd_stops = excluded.nd_stops, iso_min = excluded.iso_min,
    iso_max = excluded.iso_max, shutter_min_seconds = excluded.shutter_min_seconds,
    recording_limit_seconds = excluded.recording_limit_seconds,
    battery_runtime_minutes = excluded.battery_runtime_minutes, raw_recording = excluded.raw_recording,
    log_profile = excluded.log_profile, thermal_note = excluded.thermal_note, source = excluded.source,
    source_label = excluded.source_label, notes = excluded.notes, declared_by = excluded.declared_by,
    updated_at = now()
  returning * into capability;
  perform tonde_private.audit_event(target_workspace, 'device.capability_declared', target_resource,
    'production_resource', jsonb_build_object('device_kind', capability.device_kind, 'source', p_source,
      'source_label', p_source_label, 'crop_factor', capability.crop_factor,
      'verified', capability.verified_at is not null));
  return jsonb_build_object('resource_id', capability.resource_id, 'device_kind', capability.device_kind,
    'crop_factor', capability.crop_factor, 'sensor_format', capability.sensor_format,
    'sensor_diagonal_mm', tonde_private.device_sensor_diagonal_mm(capability.crop_factor),
    'capability_state', tonde_private.device_capability_state(target_workspace, target_resource),
    'replaced_existing_declaration', existing.resource_id is not null,
    'verification_withdrawn', existing.verified_at is not null and capability.verified_at is null,
    'meaning', 'The limits are recorded as declared. Advice built on them says so until a person verifies
      them.');
end $$;
revoke all on function tonde.device_capability_declare(uuid,uuid,jsonb,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.device_capability_declare(uuid,uuid,jsonb,text,text,text)
  to authenticated, service_role;

create function tonde.lens_capability_declare(target_workspace uuid, target_resource uuid, p_facts jsonb,
  p_source text default 'creator', p_source_label text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; resource tonde.production_resources; capability tonde.lens_capabilities;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if jsonb_typeof(p_facts) <> 'object' then
    raise exception 'Capability is declared as an object' using errcode = '22023';
  end if;
  if p_source not in ('manufacturer','creator','reference','import') then
    raise exception 'A capability declaration names where it came from' using errcode = '22023';
  end if;
  select * into resource from tonde.production_resources r
    where r.workspace_id = target_workspace and r.id = target_resource;
  if not found then raise exception 'That production resource does not exist' using errcode = 'P0002'; end if;
  if resource.resource_type <> 'lens' then
    raise exception 'Lens capability is declared for a lens resource' using errcode = '22023';
  end if;
  insert into tonde.lens_capabilities(resource_id, workspace_id, mount, focal_min_mm, focal_max_mm,
    max_aperture, min_aperture, image_circle_mm, min_focus_m, stabilization, filter_thread_mm, source,
    source_label, notes, declared_by)
  values (target_resource, target_workspace, btrim(p_facts ->> 'mount'),
    (p_facts ->> 'focal_min_mm')::numeric, (p_facts ->> 'focal_max_mm')::numeric,
    (p_facts ->> 'max_aperture')::numeric, nullif(p_facts ->> 'min_aperture', '')::numeric,
    nullif(p_facts ->> 'image_circle_mm', '')::numeric, nullif(p_facts ->> 'min_focus_m', '')::numeric,
    coalesce(nullif(p_facts ->> 'stabilization', ''), 'unknown'),
    nullif(p_facts ->> 'filter_thread_mm', '')::numeric, p_source,
    nullif(btrim(coalesce(p_source_label, '')), ''), nullif(left(coalesce(p_notes, ''), 1000), ''), actor)
  on conflict (resource_id) do update set mount = excluded.mount, focal_min_mm = excluded.focal_min_mm,
    focal_max_mm = excluded.focal_max_mm, max_aperture = excluded.max_aperture,
    min_aperture = excluded.min_aperture, image_circle_mm = excluded.image_circle_mm,
    min_focus_m = excluded.min_focus_m, stabilization = excluded.stabilization,
    filter_thread_mm = excluded.filter_thread_mm, source = excluded.source,
    source_label = excluded.source_label, notes = excluded.notes, declared_by = excluded.declared_by,
    updated_at = now()
  returning * into capability;
  perform tonde_private.audit_event(target_workspace, 'lens.capability_declared', target_resource,
    'production_resource', jsonb_build_object('mount', capability.mount, 'focal_min_mm', capability.focal_min_mm,
      'focal_max_mm', capability.focal_max_mm, 'source', p_source));
  return jsonb_build_object('resource_id', capability.resource_id, 'mount', capability.mount,
    'focal_range', jsonb_build_array(capability.focal_min_mm, capability.focal_max_mm),
    'max_aperture', capability.max_aperture, 'image_circle_mm', capability.image_circle_mm,
    'capability_state', case when capability.verified_at is null then 'declared' else 'verified' end,
    'meaning', 'The lens limits are recorded as declared.');
end $$;
revoke all on function tonde.lens_capability_declare(uuid,uuid,jsonb,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.lens_capability_declare(uuid,uuid,jsonb,text,text,text)
  to authenticated, service_role;

create function tonde.device_capability_verify(target_workspace uuid, target_resource uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; device tonde.device_capabilities; lens tonde.lens_capabilities;
begin
  actor := tonde_private.knowledge_admin(target_workspace);
  select * into device from tonde.device_capabilities c
    where c.workspace_id = target_workspace and c.resource_id = target_resource;
  if device.resource_id is not null then
    update tonde.device_capabilities set verified_at = now(), verified_by = actor,
      verification_note = nullif(left(coalesce(p_note, ''), 1000), ''), updated_at = now()
      where resource_id = target_resource returning * into device;
  else
    select * into lens from tonde.lens_capabilities c
      where c.workspace_id = target_workspace and c.resource_id = target_resource;
    if lens.resource_id is null then
      raise exception 'That resource has no declared capability to verify' using errcode = 'PT409';
    end if;
    update tonde.lens_capabilities set verified_at = now(), verified_by = actor, updated_at = now()
      where workspace_id = target_workspace and resource_id = target_resource returning * into lens;
  end if;
  perform tonde_private.audit_event(target_workspace, 'device.capability_verified', target_resource,
    'production_resource', jsonb_build_object('note', p_note, 'verified_by', actor));
  return jsonb_build_object('resource_id', target_resource, 'capability_state', 'verified',
    'verified_by', actor,
    'meaning', 'A person verified these limits; advice built on them may be presented as verified.');
end $$;
revoke all on function tonde.device_capability_verify(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.device_capability_verify(uuid,uuid,text) to authenticated, service_role;

-- 8. The settings engine. Deterministic arithmetic over declared limits and a stated intent.
create function tonde.camera_settings_propose(target_workspace uuid, target_production uuid, target_shot uuid,
  target_camera uuid, target_lens uuid default null, p_intent jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; camera tonde.device_capabilities; lens tonde.lens_capabilities;
  refused jsonb := '[]'::jsonb; basis jsonb := '{}'::jsonb; settings jsonb := '{}'::jsonb;
  required_circle numeric; frame_rate numeric; shutter_angle numeric; shutter_seconds numeric;
  aperture numeric; iso integer; nd numeric; ev_settings numeric; ev_needed numeric;
  capability_state text; proposal_hash text; production tonde.productions; shot tonde.shots;
  proposal tonde.camera_settings_proposals; existing tonde.camera_settings_proposals; mount_ok boolean;
  snapshots jsonb; lens_ready boolean := true; camera_ready boolean := true; lighting text;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if jsonb_typeof(p_intent) <> 'object' then
    raise exception 'An intent is an object' using errcode = '22023';
  end if;
  select * into production from tonde.productions p where p.workspace_id = target_workspace
    and p.id = target_production;
  if not found then raise exception 'That Production does not exist' using errcode = 'P0002'; end if;
  select * into shot from tonde.shots s where s.workspace_id = target_workspace
    and s.production_id = target_production and s.id = target_shot;
  if not found then raise exception 'That shot does not exist in this Production' using errcode = 'P0002'; end if;
  select * into camera from tonde.device_capabilities c
    where c.workspace_id = target_workspace and c.resource_id = target_camera;
  capability_state := case when camera.resource_id is null then 'missing'
    when camera.verified_at is not null then 'verified' else 'declared' end;
  if camera.resource_id is null then
    -- No invented advice: the refusal names the missing input.
    raise exception 'CAPABILITY_MISSING: declare what this camera can do before asking for settings'
      using errcode = 'PT409';
  end if;
  if target_lens is not null then
    select * into lens from tonde.lens_capabilities c
      where c.workspace_id = target_workspace and c.resource_id = target_lens;
    if lens.resource_id is null then
      raise exception 'LENS_CAPABILITY_MISSING: declare what this lens can do first' using errcode = 'PT409';
    end if;
    mount_ok := lens.mount = any (camera.mounts) or exists (select 1 from tonde.resource_compatibility rc
      where rc.workspace_id = target_workspace and rc.relation = 'mount'
        and ((rc.resource_id = target_camera and rc.compatible_resource_id = target_lens)
          or (rc.resource_id = target_lens and rc.compatible_resource_id = target_camera)));
    if not mount_ok then
      refused := refused || jsonb_build_object('reason', 'MOUNT_MISMATCH', 'detail',
        format('The %s mount is not one of this camera''s mounts (%s)', lens.mount,
          array_to_string(camera.mounts, ', ')), 'limit', camera.mounts);
    end if;
    select * into lens from tonde.lens_capabilities c
      where c.workspace_id = target_workspace and c.resource_id = target_lens;
  end if;
  -- Frame rate and shutter: a stated intent, or the honest default of 24p at a 180 degree shutter.
  frame_rate := coalesce(nullif(p_intent ->> 'frame_rate', '')::numeric, 24);
  if camera.max_frame_rate is not null and frame_rate > camera.max_frame_rate then
    refused := refused || jsonb_build_object('reason', 'FRAME_RATE_UNSUPPORTED', 'requested', frame_rate,
      'limit', camera.max_frame_rate);
  elsif cardinality(camera.frame_rates) > 0 and not (frame_rate = any (camera.frame_rates)) then
    refused := refused || jsonb_build_object('reason', 'FRAME_RATE_UNSUPPORTED', 'requested', frame_rate,
      'limit', camera.frame_rates);
  else
    basis := basis || jsonb_build_object('frame_rate',
      case when p_intent ? 'frame_rate' then 'Requested and supported by the declared limit.'
        else 'No frame rate was requested, so the 24p default is used.' end);
  end if;
  shutter_angle := coalesce(nullif(p_intent ->> 'shutter_angle', '')::numeric, 180);
  if shutter_angle <= 0 or shutter_angle > 360 then
    raise exception 'A shutter angle is between 0 and 360 degrees' using errcode = '22023';
  end if;
  shutter_seconds := round((1 / frame_rate * shutter_angle / 360)::numeric, 6);
  if camera.shutter_min_seconds is not null and shutter_seconds < camera.shutter_min_seconds then
    refused := refused || jsonb_build_object('reason', 'SHUTTER_TOO_FAST', 'requested_seconds', shutter_seconds,
      'limit', camera.shutter_min_seconds);
  else
    basis := basis || jsonb_build_object('shutter_seconds', format(
      'A %s degree shutter at %s fps gives %s s (%s).', shutter_angle, frame_rate, shutter_seconds,
      case when p_intent ? 'shutter_angle' then 'requested' else 'the 180 degree default' end));
  end if;
  -- Aperture: from the lens range, never outside it.
  aperture := nullif(p_intent ->> 'aperture', '')::numeric;
  if target_lens is not null then
    if aperture is null then
      aperture := lens.max_aperture;
      basis := basis || jsonb_build_object('aperture',
        'No aperture was requested, so the lens is used wide open at f/' || lens.max_aperture || '.');
    elsif aperture < lens.max_aperture then
      refused := refused || jsonb_build_object('reason', 'APERTURE_UNAVAILABLE', 'requested', aperture,
        'limit', 'the lens opens to f/' || lens.max_aperture);
      aperture := lens.max_aperture;
    elsif lens.min_aperture is not null and aperture > lens.min_aperture then
      refused := refused || jsonb_build_object('reason', 'APERTURE_UNAVAILABLE', 'requested', aperture,
        'limit', 'the lens closes to f/' || lens.min_aperture);
      aperture := lens.min_aperture;
    else
      basis := basis || jsonb_build_object('aperture',
        'Requested and inside the lens range f/' || lens.max_aperture || '-f/' || lens.min_aperture || '.');
    end if;
  elsif aperture is not null then
    basis := basis || jsonb_build_object('aperture', 'Requested; no lens limit was supplied to check it against.');
  end if;
  -- ISO: the light level maps to a starting sensitivity, clamped to the declared range.
  lighting := nullif(p_intent ->> 'lighting', '');
  if lighting is not null and lighting not in ('low','medium','high') then
    raise exception 'A lighting level is low, medium or high' using errcode = '22023';
  end if;
  iso := nullif(p_intent ->> 'iso', '')::integer;
  if iso is null then
    iso := case lighting when 'low' then 200 when 'high' then 3200 when 'medium' then 800
      else camera.iso_min end;
    basis := basis || jsonb_build_object('iso', case lighting
      when 'low' then 'A low light level starts at ISO 200; raise it only if the scene needs it.'
      when 'medium' then 'A medium light level starts at ISO 800.'
      when 'high' then 'A bright scene starts at ISO 3200 only if the shutter and aperture are fixed.'
      else 'No light level or ISO was given, so the declared base sensitivity is used.' end);
  else
    basis := basis || jsonb_build_object('iso', 'Requested.');
  end if;
  if camera.iso_max is not null and iso > camera.iso_max then
    refused := refused || jsonb_build_object('reason', 'INSUFFICIENT_SENSITIVITY', 'requested', iso,
      'limit', camera.iso_max);
    iso := camera.iso_max;
  end if;
  if camera.iso_min is not null and iso < camera.iso_min then
    iso := camera.iso_min;
  end if;
  -- Resolution and codec: requested values must exist in the declared capability.
  if p_intent ? 'resolution' and nullif(p_intent ->> 'resolution', '') is not null then
    if cardinality(camera.resolution_modes) > 0
      and not (p_intent ->> 'resolution' = any (camera.resolution_modes)) then
      refused := refused || jsonb_build_object('reason', 'RESOLUTION_UNSUPPORTED',
        'requested', p_intent ->> 'resolution', 'limit', camera.resolution_modes);
    else
      settings := settings || jsonb_build_object('resolution', p_intent ->> 'resolution');
      basis := basis || jsonb_build_object('resolution', 'Requested and supported by the declared modes.');
    end if;
  end if;
  if p_intent ? 'codec' and nullif(p_intent ->> 'codec', '') is not null then
    if cardinality(camera.codecs) > 0 and not (p_intent ->> 'codec' = any (camera.codecs)) then
      refused := refused || jsonb_build_object('reason', 'CODEC_UNSUPPORTED', 'requested', p_intent ->> 'codec',
        'limit', camera.codecs);
    else
      settings := settings || jsonb_build_object('codec', p_intent ->> 'codec');
      basis := basis || jsonb_build_object('codec', 'Requested and supported by the declared codecs.');
    end if;
  end if;
  -- Focal length and coverage: the lens must reach the framing and cover the sensor.
  if target_lens is not null then
    required_circle := tonde_private.device_sensor_diagonal_mm(camera.crop_factor);
    if lens.image_circle_mm is not null and lens.image_circle_mm < required_circle then
      refused := refused || jsonb_build_object('reason', 'IMAGE_CIRCLE_TOO_SMALL',
        'required_mm', required_circle, 'limit', lens.image_circle_mm);
    else
      basis := basis || jsonb_build_object('coverage', format(
        'The sensor needs a %s mm image circle; the lens provides %s mm.', required_circle,
        coalesce(lens.image_circle_mm::text, 'an unstated circle')));
    end if;
    if p_intent ? 'focal_mm' and nullif(p_intent ->> 'focal_mm', '') is not null then
      if (p_intent ->> 'focal_mm')::numeric < lens.focal_min_mm
        or (p_intent ->> 'focal_mm')::numeric > lens.focal_max_mm then
        refused := refused || jsonb_build_object('reason', 'FOCAL_LENGTH_UNAVAILABLE',
          'requested', (p_intent ->> 'focal_mm')::numeric,
          'limit', format('%s-%s mm', lens.focal_min_mm, lens.focal_max_mm));
      else
        settings := settings || jsonb_build_object('focal_mm', (p_intent ->> 'focal_mm')::numeric);
        basis := basis || jsonb_build_object('focal_mm', 'Requested and inside the lens range.');
      end if;
    end if;
  end if;
  -- Neutral density: only from a stated scene exposure. Without a measurement, ND is not determined.
  if p_intent ? 'scene_ev' and nullif(p_intent ->> 'scene_ev', '') is not null then
    ev_needed := (p_intent ->> 'scene_ev')::numeric;
    if aperture is not null then
      ev_settings := tonde_private.exposure_ev(aperture, shutter_seconds, iso);
      nd := ceil(greatest(ev_needed - ev_settings, 0));
      if camera.nd_stops is not null and nd > camera.nd_stops then
        refused := refused || jsonb_build_object('reason', 'INSUFFICIENT_ND', 'required_stops', nd,
          'limit', camera.nd_stops);
        nd := camera.nd_stops;
      end if;
      -- Zero stops is a real answer (no filter needed), so it is recorded as a value, not as an absence.
      settings := settings || jsonb_build_object('nd_stops', nd);
      basis := basis || jsonb_build_object('nd_stops', format(
        'Scene EV %s against settings EV %s needs %s stop(s) of neutral density.', ev_needed, ev_settings,
        greatest(ceil(ev_needed - ev_settings), 0)));
    else
      nd := null;
      basis := basis || jsonb_build_object('nd_stops',
        'No aperture is available to compute an exposure, so neutral density is not determined.');
    end if;
  else
    nd := null;
    settings := settings || jsonb_build_object('nd_stops', null);
    basis := basis || jsonb_build_object('nd_stops',
      'No scene exposure was measured, so neutral density is not determined rather than guessed.');
  end if;
  settings := settings || jsonb_build_object('frame_rate', frame_rate, 'shutter_angle', shutter_angle,
    'shutter_seconds', shutter_seconds, 'iso', iso, 'aperture', aperture,
    'camera_resource_id', target_camera, 'lens_resource_id', target_lens);
  snapshots := jsonb_build_object('camera', jsonb_build_object('crop_factor', camera.crop_factor,
    'mounts', camera.mounts, 'iso_range', jsonb_build_array(camera.iso_min, camera.iso_max),
    'frame_rates', camera.frame_rates, 'max_frame_rate', camera.max_frame_rate,
    'resolution_modes', camera.resolution_modes, 'codecs', camera.codecs, 'nd_stops', camera.nd_stops,
    'shutter_min_seconds', camera.shutter_min_seconds, 'source', camera.source,
    'verified', camera.verified_at is not null),
    'lens', case when target_lens is null then null else jsonb_build_object('mount', lens.mount,
      'focal_range', jsonb_build_array(lens.focal_min_mm, lens.focal_max_mm),
      'aperture_range', jsonb_build_array(lens.max_aperture, lens.min_aperture),
      'image_circle_mm', lens.image_circle_mm, 'verified', lens.verified_at is not null) end);
  proposal_hash := encode(sha256(convert_to(jsonb_build_object('camera', target_camera, 'lens', target_lens,
    'intent', p_intent, 'capability', snapshots)::text, 'UTF8')), 'hex');
  select * into existing from tonde.camera_settings_proposals p
    where p.workspace_id = target_workspace and p.production_id = target_production
      and p.shot_id = target_shot and p.camera_resource_id = target_camera
      and p.lens_resource_id is not distinct from target_lens and p.intent_hash = proposal_hash
      and p.state in ('proposed','accepted');
  if existing.id is not null then
    return jsonb_build_object('proposal_id', existing.id, 'state', existing.state, 'satisfied', existing.satisfied,
      'settings', existing.settings, 'basis', existing.basis, 'refusals', existing.refusals,
      'capability_state', existing.capability_state, 'idempotent', true);
  end if;
  insert into tonde.camera_settings_proposals(workspace_id, production_id, scene_id, shot_id,
    camera_resource_id, lens_resource_id, intent, settings, basis, refusals, satisfied, capability_snapshot,
    capability_state, intent_hash, proposed_by)
  values (target_workspace, target_production, shot.scene_id, target_shot, target_camera, target_lens,
    p_intent, settings, basis, refused, jsonb_array_length(refused) = 0, snapshots, capability_state,
    proposal_hash, actor)
  returning * into proposal;
  perform tonde_private.audit_event(target_workspace, 'camera.settings_proposed', proposal.id,
    'camera_settings_proposal', jsonb_build_object('shot_id', target_shot, 'camera', target_camera,
      'lens', target_lens, 'satisfied', proposal.satisfied, 'refusals', refused,
      'capability_state', capability_state));
  return jsonb_build_object('proposal_id', proposal.id, 'state', proposal.state, 'satisfied', proposal.satisfied,
    'settings', proposal.settings, 'basis', proposal.basis, 'refusals', proposal.refusals,
    'capability_state', capability_state, 'engine_version', proposal.engine_version, 'idempotent', false,
    'meaning', case when proposal.satisfied
      then 'Every value follows from the declared limits and the stated intent; each value carries its basis.'
      else 'The equipment cannot satisfy this intent as stated. The refusals name the limit that was hit;
        nothing was invented to fill the gap.' end);
end $$;
revoke all on function tonde.camera_settings_propose(uuid,uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.camera_settings_propose(uuid,uuid,uuid,uuid,uuid,jsonb)
  to authenticated, service_role;

-- 9. Accepting a proposal is the creator's decision, and it is what writes into the execution plan.
create function tonde.camera_settings_decide(target_workspace uuid, target_proposal uuid, p_decision text,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; proposal tonde.camera_settings_proposals; plan tonde.execution_plans; applied uuid;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if p_decision not in ('accept','reject') then
    raise exception 'A proposal is accepted or rejected' using errcode = '22023';
  end if;
  select * into proposal from tonde.camera_settings_proposals p
    where p.workspace_id = target_workspace and p.id = target_proposal for update;
  if not found then raise exception 'That settings proposal does not exist' using errcode = 'P0002'; end if;
  if proposal.state <> 'proposed' then
    return jsonb_build_object('proposal_id', proposal.id, 'state', proposal.state, 'idempotent', true);
  end if;
  if p_decision = 'accept' and not proposal.satisfied then
    raise exception 'SETTINGS_UNSATISFIED: this proposal refuses part of the intent; change the equipment or the
      intent first' using errcode = 'PT409';
  end if;
  if p_decision = 'reject' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'A rejection says why' using errcode = '22023';
  end if;
  select * into plan from tonde.execution_plans p where p.workspace_id = target_workspace
    and p.shot_id = proposal.shot_id and p.execution_method = 'real';
  if p_decision = 'accept' and plan.id is not null then
    update tonde.execution_plans set camera_resource_id = coalesce(proposal.camera_resource_id, camera_resource_id),
      lens_resource_id = coalesce(proposal.lens_resource_id, lens_resource_id),
      plan_metadata = plan_metadata || jsonb_build_object('camera_settings', proposal.settings,
        'camera_settings_proposal_id', proposal.id, 'camera_settings_basis', proposal.basis),
      updated_at = now()
      where id = plan.id returning * into plan;
    applied := plan.id;
  end if;
  update tonde.camera_settings_proposals set state = case when p_decision = 'accept' then 'accepted' else 'rejected' end,
    decided_by = actor, decided_at = now(), decision_note = nullif(left(coalesce(p_note, ''), 1000), ''),
    applied_plan_id = applied, updated_at = now()
    where id = proposal.id returning * into proposal;
  perform tonde_private.audit_event(target_workspace, 'camera.settings_' || p_decision, proposal.id,
    'camera_settings_proposal', jsonb_build_object('shot_id', proposal.shot_id, 'applied_plan_id', applied,
      'note', p_note, 'settings', proposal.settings));
  return jsonb_build_object('proposal_id', proposal.id, 'state', proposal.state, 'idempotent', false,
    'applied_plan_id', applied,
    'meaning', case when p_decision = 'accept' and applied is not null
      then 'The creator accepted the settings and they are recorded on this shot''s real execution plan.'
      when p_decision = 'accept' then 'The creator accepted the settings; no real execution plan existed to
        record them on yet.'
      else 'The proposal was rejected with a reason and nothing was applied.' end);
end $$;
revoke all on function tonde.camera_settings_decide(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.camera_settings_decide(uuid,uuid,text,text) to authenticated, service_role;

-- 10. Scene requirements and the scene intelligence read.
create function tonde.scene_requirement_add(target_workspace uuid, target_production uuid,
  requirement_kind text, detail text, target_scene uuid default null, target_shot uuid default null,
  p_mandatory boolean default true, p_source text default 'creator') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; requirement tonde.scene_requirements; existing tonde.scene_requirements;
  v_kind text; v_detail text;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  -- The names a client sends and the names of the columns are the same words, so they are copied into
  -- unambiguous locals before any statement that reads the table.
  v_kind := requirement_kind;
  v_detail := btrim(coalesce(detail, ''));
  if v_kind not in ('lighting','movement','framing','environment','time_of_day','audio','permission',
    'safety','cast','prop','wardrobe','location') then
    raise exception 'That is not a TONDE scene requirement' using errcode = '22023';
  end if;
  if p_source not in ('creator','plan','import') then
    raise exception 'A requirement names where it came from' using errcode = '22023';
  end if;
  if target_scene is null and target_shot is null then
    raise exception 'A requirement belongs to a scene or a shot' using errcode = '22023';
  end if;
  if target_shot is not null then
    select s.scene_id into target_scene from tonde.shots s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.id = target_shot;
    if target_scene is null then
      raise exception 'That shot does not exist in this Production' using errcode = 'P0002';
    end if;
  end if;
  select * into existing from tonde.scene_requirements r where r.production_id = target_production
    and coalesce(r.shot_id, r.scene_id) = coalesce(target_shot, target_scene)
    and r.requirement_kind = v_kind and r.detail = v_detail;
  if existing.id is not null then
    return jsonb_build_object('requirement_id', existing.id, 'state', existing.state, 'idempotent', true);
  end if;
  insert into tonde.scene_requirements(workspace_id, production_id, scene_id, shot_id, requirement_kind,
    detail, mandatory, source, created_by)
  values (target_workspace, target_production, target_scene, target_shot, v_kind,
    left(v_detail, 600), coalesce(p_mandatory, true), p_source, actor)
  returning * into requirement;
  perform tonde_private.audit_event(target_workspace, 'scene.requirement_added', requirement.id,
    'scene_requirement', jsonb_build_object('kind', v_kind, 'mandatory', requirement.mandatory,
      'shot_id', target_shot, 'scene_id', target_scene));
  return jsonb_build_object('requirement_id', requirement.id, 'state', requirement.state,
    'mandatory', requirement.mandatory, 'idempotent', false);
end $$;
revoke all on function tonde.scene_requirement_add(uuid,uuid,text,text,uuid,uuid,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.scene_requirement_add(uuid,uuid,text,text,uuid,uuid,boolean,text)
  to authenticated, service_role;

create function tonde.scene_requirement_settle(target_workspace uuid, target_requirement uuid, p_state text,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; requirement tonde.scene_requirements;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if p_state not in ('met','waived','open') then
    raise exception 'A requirement is met, waived or open' using errcode = '22023';
  end if;
  select * into requirement from tonde.scene_requirements r
    where r.workspace_id = target_workspace and r.id = target_requirement for update;
  if not found then raise exception 'That requirement does not exist' using errcode = 'P0002'; end if;
  if p_state = 'waived' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Waiving a requirement says why' using errcode = '22023';
  end if;
  update tonde.scene_requirements set state = p_state,
    resolution_note = nullif(left(coalesce(p_note, ''), 1000), ''),
    resolved_by = case when p_state = 'open' then null else actor end,
    resolved_at = case when p_state = 'open' then null else now() end, updated_at = now()
    where id = requirement.id returning * into requirement;
  return jsonb_build_object('requirement_id', requirement.id, 'state', requirement.state,
    'meaning', case when p_state = 'waived'
      then 'The requirement was waived and the reason is recorded with it.'
      else 'The requirement state is recorded as it is.' end);
end $$;
revoke all on function tonde.scene_requirement_settle(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.scene_requirement_settle(uuid,uuid,text,text) to authenticated, service_role;

create function tonde.scene_intelligence(target_workspace uuid, target_production uuid, target_scene uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare by_service boolean := (select auth.role()) = 'service_role'; requirements jsonb; shots jsonb;
  devices jsonb; gaps jsonb; scene_count integer;
begin
  if not by_service and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from tonde.productions p where p.workspace_id = target_workspace
      and p.id = target_production) then
    raise exception 'That Production does not exist' using errcode = 'P0002';
  end if;
  select count(*) into scene_count from tonde.scenes s where s.workspace_id = target_workspace
    and s.production_id = target_production and (target_scene is null or s.id = target_scene);
  select coalesce(jsonb_agg(jsonb_build_object('requirement_id', r.id, 'kind', r.requirement_kind,
    'detail', r.detail, 'mandatory', r.mandatory, 'state', r.state, 'source', r.source,
    'scene_id', r.scene_id, 'shot_id', r.shot_id, 'resolution_note', r.resolution_note)
    order by r.mandatory desc, r.requirement_kind), '[]'::jsonb) into requirements
    from tonde.scene_requirements r where r.workspace_id = target_workspace
      and r.production_id = target_production
      and (target_scene is null or r.scene_id = target_scene or exists (
        select 1 from tonde.scenes s2 where s2.id = r.scene_id and s2.id = target_scene));
  select coalesce(jsonb_agg(jsonb_build_object('shot_id', s.id, 'scene_id', s.scene_id, 'title', s.title,
    'execution_method', s.execution_method, 'camera_resource_id', p.camera_resource_id,
    'lens_resource_id', p.lens_resource_id, 'settings_accepted',
      coalesce(p.plan_metadata ? 'camera_settings', false),
    'settings', p.plan_metadata -> 'camera_settings') order by s.sort_order), '[]'::jsonb) into shots
    from tonde.shots s left join tonde.execution_plans p on p.shot_id = s.id and p.execution_method = 'real'
    where s.workspace_id = target_workspace and s.production_id = target_production
      and s.lifecycle = 'active' and (target_scene is null or s.scene_id = target_scene);
  select coalesce(jsonb_agg(jsonb_build_object('resource_id', r.id, 'name', r.name, 'resource_type', r.resource_type,
    'capability_state', case when d.resource_id is not null and d.verified_at is not null then 'verified'
      when d.resource_id is not null then 'declared' when l.resource_id is not null and l.verified_at is not null
        then 'verified' when l.resource_id is not null then 'declared' else 'missing' end)
    order by r.resource_type, r.name), '[]'::jsonb) into devices
    from tonde.production_resources r
      left join tonde.device_capabilities d on d.resource_id = r.id
      left join tonde.lens_capabilities l on l.resource_id = r.id
    where r.workspace_id = target_workspace and r.lifecycle = 'active'
      and r.resource_type in ('camera','phone_camera','lens','drone','action_camera','light');
  -- A gap is a mandatory requirement that nothing satisfies. It is reported, never assumed away.
  select coalesce(jsonb_agg(jsonb_build_object('requirement_id', r.id, 'kind', r.requirement_kind,
    'detail', r.detail, 'scene_id', r.scene_id, 'shot_id', r.shot_id,
    'reason', case when r.shot_id is not null and not exists (select 1 from tonde.execution_plans p
        where p.workspace_id = target_workspace and p.shot_id = r.shot_id) then 'NO_EXECUTION_PLAN'
      when r.requirement_kind in ('lighting','framing','movement','location')
        and not exists (select 1 from tonde.production_resources px where px.workspace_id = target_workspace
          and px.lifecycle = 'active' and px.resource_type in ('camera','phone_camera','lens','drone','action_camera'))
        then 'NO_DEVICE_DECLARED' else 'UNRESOLVED' end) order by r.requirement_kind), '[]'::jsonb)
    into gaps
    from tonde.scene_requirements r where r.workspace_id = target_workspace
      and r.production_id = target_production and r.state = 'open' and r.mandatory
      and (target_scene is null or r.scene_id = target_scene);
  return jsonb_build_object('workspace_id', target_workspace, 'production_id', target_production,
    'scene_id', target_scene, 'scenes_considered', scene_count, 'requirements', requirements, 'shots', shots,
    'devices', devices, 'gaps', gaps,
    'meaning', 'Intelligence is reported as requirements, per-shot execution, available devices with their
      capability state, and the mandatory requirements nothing yet satisfies. Where a device limit is
      unknown it is reported as missing rather than assumed.');
end $$;
revoke all on function tonde.scene_intelligence(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.scene_intelligence(uuid,uuid,uuid) to authenticated, service_role;

create function tonde.device_readiness(target_workspace uuid, target_production uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare by_service boolean := (select auth.role()) = 'service_role'; devices jsonb; refusals jsonb;
  coverage jsonb;
begin
  if not by_service and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('resource_id', r.id, 'name', r.name, 'resource_type',
    r.resource_type, 'mount', r.mount, 'manufacturer', r.manufacturer, 'model', r.model,
    'capability_state', case when d.resource_id is not null and d.verified_at is not null then 'verified'
      when d.resource_id is not null then 'declared' when l.resource_id is not null and l.verified_at is not null
        then 'verified' when l.resource_id is not null then 'declared' else 'missing' end,
    'device_kind', d.device_kind, 'crop_factor', d.crop_factor, 'sensor_diagonal_mm',
      case when d.crop_factor is null then null else tonde_private.device_sensor_diagonal_mm(d.crop_factor) end,
    'lens', case when l.resource_id is null then null else jsonb_build_object('mount', l.mount,
      'focal_range', jsonb_build_array(l.focal_min_mm, l.focal_max_mm), 'max_aperture', l.max_aperture,
      'image_circle_mm', l.image_circle_mm) end,
    'source', coalesce(d.source, l.source), 'source_label', coalesce(d.source_label, l.source_label))
    order by r.resource_type, r.name), '[]'::jsonb) into devices
    from tonde.production_resources r
      left join tonde.device_capabilities d on d.resource_id = r.id
      left join tonde.lens_capabilities l on l.resource_id = r.id
    where r.workspace_id = target_workspace and r.lifecycle = 'active'
      and r.resource_type in ('camera','phone_camera','lens','drone','action_camera');
  select coalesce(jsonb_agg(jsonb_build_object('proposal_id', p.id, 'shot_id', p.shot_id,
    'camera_resource_id', p.camera_resource_id, 'lens_resource_id', p.lens_resource_id,
    'satisfied', p.satisfied, 'refusals', p.refusals, 'capability_state', p.capability_state,
    'state', p.state) order by p.proposed_at desc), '[]'::jsonb) into refusals
    from tonde.camera_settings_proposals p where p.workspace_id = target_workspace
      and p.production_id = target_production and not p.satisfied and p.state in ('proposed','rejected');
  select coalesce(jsonb_agg(jsonb_build_object('shot_id', s.id, 'execution_method', s.execution_method,
    'has_real_plan', p.id is not null, 'settings_accepted', coalesce(p.plan_metadata ? 'camera_settings', false))
    order by s.sort_order), '[]'::jsonb) into coverage
    from tonde.shots s left join tonde.execution_plans p on p.shot_id = s.id and p.execution_method = 'real'
    where s.workspace_id = target_workspace and s.production_id = target_production and s.lifecycle = 'active';
  return jsonb_build_object('workspace_id', target_workspace, 'production_id', target_production,
    'devices', devices, 'shots', coverage, 'unsatisfied_proposals', refusals,
    'meaning', 'Readiness reports the equipment, what is actually known about it, which shots have an
      execution plan, and every proposal the equipment could not satisfy.');
end $$;
revoke all on function tonde.device_readiness(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.device_readiness(uuid,uuid) to authenticated, service_role;

alter default privileges in schema tonde revoke execute on functions from public;
alter default privileges in schema tonde_private revoke execute on functions from public;

commit;
