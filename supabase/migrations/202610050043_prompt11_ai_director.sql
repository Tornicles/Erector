-- 043 - Prompt 11 -- THE DIRECTOR CORRECTION
--
-- Owner product law this migration implements: TONDE does not generate final images or videos
-- itself. TONDE directs. The product model is
--
--   IDEA / REFERENCE -> TONDE DIRECTOR -> PRODUCTION PLAN -> SHOT/SCENE PLAYBOOK
--     -> EXECUTION (REAL, or an EXTERNAL AI TOOL, or HYBRID) -> THE CREATOR EXECUTES
--     -> RESULT UPLOADED TO TONDE -> TONDE CHECKS THE RESULT -> ACCEPT or FIX -> CONTINUE.
--
-- What this migration does NOT do, deliberately:
--   * it adds no image/video-generation provider client, worker class, queue, webhook or attempt path
--     whose purpose is calling a generation service. `ai_generation_attempts` already models an attempt
--     as `live` or `manual`, and `live` needs a connection row that only exists when a real adapter was
--     verified. The core product path is the external tool the creator runs, which needs no credential.
--   * it does not turn TONDE into a media host, a reseller of third-party generation, or the owner of
--     any tool's capabilities. A tool profile is documented knowledge with a citation, not an API.
--   * it does not touch the Prompt 10 provider architecture. That general seam stays for publishing,
--     billing, OAuth, email and integrations.
--
-- Additive and forward-only. 001-042 are untouched.
begin;

-- 1. AI Tool Knowledge: what TONDE has been taught about an external creative tool.
--
-- TONDE holds no vendor capability facts of its own. A profile is knowledge a person entered or a
-- tutorial/documentation import produced, it names the documentation it came from once it is relied
-- on, it is versioned, and reviewed knowledge is never silently rewritten: a changed fact is a new
-- version, and the row that was relied on keeps saying what it said. A profile is NOT a connection.
create table tonde.ai_tool_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  tool_key text not null check (tool_key ~ '^[a-z][a-z0-9_]{1,59}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  capability_type text not null check (capability_type in ('video_generation','image_generation',
    'audio_generation','editing','compositing','upscaling','other')),
  media_kind text not null check (media_kind in ('video','image','audio','other')),
  input_types text[] not null default '{}',
  supports_reference_image boolean not null default false,
  supports_reference_video boolean not null default false,
  supports_first_frame boolean not null default false,
  supports_last_frame boolean not null default false,
  supports_negative_prompt boolean not null default false,
  supports_seed boolean not null default false,
  supports_camera_control boolean not null default false,
  max_duration_ms bigint check (max_duration_ms is null or max_duration_ms > 0),
  aspect_ratios text[] not null default '{}',
  prompt_characteristics text not null default '' check (length(prompt_characteristics) <= 4000),
  known_strengths text not null default '' check (length(known_strengths) <= 2000),
  known_limitations text not null default '' check (length(known_limitations) <= 2000),
  workflow_guidance text not null default '' check (length(workflow_guidance) <= 4000),
  typical_external_cost_note text not null default '' check (length(typical_external_cost_note) <= 600),
  tool_version text not null default '' check (length(tool_version) <= 120),
  documented_at date,
  source_title text check (source_title is null or length(btrim(source_title)) between 2 and 300),
  source_url text check (source_url is null or length(source_url) <= 1000),
  source_publisher text check (source_publisher is null or length(source_publisher) <= 200),
  source_kind text not null default 'creator' check (source_kind in ('creator','tutorial','import',
    'manufacturer','external_publication','standards_body')),
  review_state text not null default 'draft' check (review_state in ('draft','reviewed','retired')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 1000),
  superseded_by uuid,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, tool_key, tool_version),
  -- A kit entry points at the profile of the tool it names, enforced by the composite key rather than
  -- by a check constraint, because a check cannot read another row.
  unique (workspace_id, tool_key, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, superseded_by) references tonde.ai_tool_profiles(workspace_id, id)
    on delete restrict,
  -- The closed input vocabulary, so a documented input type is never a typo.
  constraint ai_tool_profile_input_types_closed
    check (input_types <@ array['text','image','video','audio']),
  -- Knowledge that will be relied on names its documentation. A draft may be unattributed.
  constraint ai_tool_profile_reviewed_is_sourced
    check (review_state <> 'reviewed' or source_title is not null or source_url is not null),
  -- A review decision names who made it and when.
  constraint ai_tool_profile_review_is_stamped
    check (review_state = 'draft' or (reviewed_by is not null and reviewed_at is not null)),
  -- A retired profile is superseded by something, or it says why in the review note.
  constraint ai_tool_profile_retirement_is_explained
    check (review_state <> 'retired' or superseded_by is not null
      or (review_note is not null and length(btrim(review_note)) > 0)),
  -- A superseded row cannot be the thing that supersedes another row.
  constraint ai_tool_profile_supersession_is_forward check (superseded_by is null or superseded_by <> id),
  -- Documented limits are bounded by what the formats can express.
  constraint ai_tool_profile_duration_sane
    check (max_duration_ms is null or max_duration_ms between 100 and 7200000)
);
create trigger guard_mutation before insert or update on tonde.ai_tool_profiles
  for each row execute function tonde_private.guard_mutation();
create index ai_tool_profiles_by_tool on tonde.ai_tool_profiles(workspace_id, tool_key, revision desc);
create index ai_tool_profiles_usable on tonde.ai_tool_profiles(workspace_id, capability_type)
  where review_state = 'reviewed';
alter table tonde.ai_tool_profiles enable row level security;
create policy tenant_read on tonde.ai_tool_profiles for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.ai_tool_profiles to authenticated;
grant all on tonde.ai_tool_profiles to service_role;

-- 2. The Production Kit names the external AI tools the creator actually has.
--
-- Kit entry, not a dependency: TONDE adapts its direction to these tools, and it never needs a
-- credential for one. A tool may be in the kit with no profile, in which case TONDE says it knows
-- nothing about how that tool reads a prompt instead of inventing it.
create table tonde.production_ai_tools (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  tool_key text not null check (tool_key ~ '^[a-z][a-z0-9_]{1,59}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  tool_profile_id uuid,
  note text not null default '' check (length(note) <= 600),
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, production_id, tool_key),
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, tool_key, tool_profile_id)
    references tonde.ai_tool_profiles(workspace_id, tool_key, id) on delete restrict
);
create trigger guard_mutation before insert or update on tonde.production_ai_tools
  for each row execute function tonde_private.guard_mutation();
create index production_ai_tools_by_production on tonde.production_ai_tools(workspace_id, production_id, sort_order);
alter table tonde.production_ai_tools enable row level security;
create policy tenant_read on tonde.production_ai_tools for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.production_ai_tools to authenticated;
grant all on tonde.production_ai_tools to service_role;

-- 3. The Result check is a check against the playbook, recorded as evidence.
--
-- A REAL Result and an AI Result are checked the same way: the shot_match report already carries the
-- findings, the severity and the recommendations. A Director check adds what the playbook is compared
-- against, the verdict, the instructions a FIX carries, the prompt that was checked and the prompt the
-- correction produces. Both prompt texts are kept, so the loop PROMPT V1 -> RESULT V1 -> CHECK ->
-- CORRECTION -> PROMPT V2 is a record rather than a claim.
alter table tonde.shot_match_reports add column execution_method text
  check (execution_method is null or execution_method in ('real','ai','hybrid'));
alter table tonde.shot_match_reports add column tool_key text
  check (tool_key is null or tool_key ~ '^[a-z][a-z0-9_]{1,59}$');
alter table tonde.shot_match_reports add column verdict text
  check (verdict is null or verdict in ('accept','fix'));
alter table tonde.shot_match_reports add column instructions text
  check (instructions is null or length(instructions) <= 4000);
alter table tonde.shot_match_reports add column criteria jsonb not null default '[]'::jsonb
  check (jsonb_typeof(criteria) = 'array');
alter table tonde.shot_match_reports add column prompt_text text
  check (prompt_text is null or length(prompt_text) <= 12000);
alter table tonde.shot_match_reports add column next_prompt text
  check (next_prompt is null or length(next_prompt) <= 12000);
alter table tonde.shot_match_reports add column previous_check_id uuid;
alter table tonde.shot_match_reports add column what_changed jsonb not null default '{}'::jsonb
  check (jsonb_typeof(what_changed) = 'object');
alter table tonde.shot_match_reports add column checked_by uuid references auth.users(id) on delete set null;
alter table tonde.shot_match_reports add column checked_at timestamptz;
alter table tonde.shot_match_reports add constraint shot_match_reports_previous_fk
  foreign key (workspace_id, previous_check_id) references tonde.shot_match_reports(workspace_id, id)
  on delete restrict;
-- A FIX without instructions is not direction; an ACCEPT carries none.
alter table tonde.shot_match_reports add constraint shot_match_reports_fix_is_instructed
  check (verdict is distinct from 'fix' or (instructions is not null and length(btrim(instructions)) > 0));
alter table tonde.shot_match_reports add constraint shot_match_reports_accept_is_quiet
  check (verdict is distinct from 'accept' or instructions is null);
-- A verdict is a Director decision, so it names who made it and when.
alter table tonde.shot_match_reports add constraint shot_match_reports_verdict_is_stamped
  check (verdict is null or (checked_by is not null and checked_at is not null));
-- A correction chain never points at itself.
alter table tonde.shot_match_reports add constraint shot_match_reports_chain_is_forward
  check (previous_check_id is null or previous_check_id <> id);

-- 4. Private helpers.

-- Direction on how a tool reads a prompt is workspace knowledge: an editor maintains it.
create function tonde_private.ai_tool_librarian(target_workspace uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or (select auth.role()) <> 'authenticated'
    or not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Authenticated workspace editor required' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function tonde_private.ai_tool_librarian(uuid) from public, anon, authenticated, service_role;

-- Relying on knowledge is a review decision, so it takes workspace admin authority.
create function tonde_private.ai_tool_reviewer(target_workspace uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not tonde_private.is_workspace_admin(target_workspace) then
    raise exception 'Workspace review authority required' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function tonde_private.ai_tool_reviewer(uuid) from public, anon, authenticated, service_role;

-- One profile, as a stable document. A profile is knowledge; the connection state is not part of it.
create function tonde_private.ai_tool_profile_json(profile tonde.ai_tool_profiles) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'profile_id', profile.id, 'tool_key', profile.tool_key, 'display_name', profile.display_name,
    'capability_type', profile.capability_type, 'media_kind', profile.media_kind,
    'input_types', to_jsonb(profile.input_types),
    'supports_reference_image', profile.supports_reference_image,
    'supports_reference_video', profile.supports_reference_video,
    'supports_first_frame', profile.supports_first_frame,
    'supports_last_frame', profile.supports_last_frame,
    'supports_negative_prompt', profile.supports_negative_prompt,
    'supports_seed', profile.supports_seed, 'supports_camera_control', profile.supports_camera_control,
    'max_duration_ms', profile.max_duration_ms, 'aspect_ratios', to_jsonb(profile.aspect_ratios),
    'prompt_characteristics', profile.prompt_characteristics, 'known_strengths', profile.known_strengths,
    'known_limitations', profile.known_limitations, 'workflow_guidance', profile.workflow_guidance,
    'typical_external_cost_note', profile.typical_external_cost_note,
    'tool_version', profile.tool_version, 'documented_at', profile.documented_at,
    'source_title', profile.source_title, 'source_url', profile.source_url,
    'source_publisher', profile.source_publisher, 'source_kind', profile.source_kind,
    'review_state', profile.review_state, 'reviewed_at', profile.reviewed_at,
    'review_note', profile.review_note, 'revision', profile.revision, 'superseded_by', profile.superseded_by);
$$;
revoke all on function tonde_private.ai_tool_profile_json(tonde.ai_tool_profiles)
  from public, anon, authenticated, service_role;

-- The knowledge a playbook may rely on for one tool, plus the honest state of it.
--   reviewed  a person reviewed documented knowledge, and it is applied
--   draft     knowledge exists but nobody reviewed it, so it is reported and NOT applied
--   absent    TONDE knows nothing about this tool's prompt behaviour and says so
create function tonde_private.ai_tool_knowledge(target_workspace uuid, p_tool_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare profile tonde.ai_tool_profiles; state text;
begin
  if p_tool_key is null then
    return jsonb_build_object('status', 'absent', 'applied', false, 'profile', null,
      'detail', 'No external tool was named, so no tool-specific knowledge is applied.');
  end if;
  select * into profile from tonde.ai_tool_profiles p
    where p.workspace_id = target_workspace and p.tool_key = p_tool_key and p.review_state = 'reviewed'
      and p.superseded_by is null
    order by p.revision desc, p.updated_at desc limit 1;
  if profile.id is not null then
    return jsonb_build_object('status', 'reviewed', 'applied', true,
      'profile', tonde_private.ai_tool_profile_json(profile),
      'detail', 'Reviewed, documented knowledge of this tool is applied to the playbook.');
  end if;
  select * into profile from tonde.ai_tool_profiles p
    where p.workspace_id = target_workspace and p.tool_key = p_tool_key and p.review_state = 'draft'
    order by p.revision desc, p.updated_at desc limit 1;
  if profile.id is not null then
    return jsonb_build_object('status', 'draft', 'applied', false,
      'profile', tonde_private.ai_tool_profile_json(profile),
      'detail', 'A draft profile exists for this tool but nobody reviewed it, so TONDE reports it and
        does not let it change the prompt.');
  end if;
  return jsonb_build_object('status', 'absent', 'applied', false, 'profile', null,
    'detail', 'TONDE holds no knowledge of how this tool reads a prompt, so the playbook is compiled
      without tool-specific notes rather than guessed.');
end $$;
revoke all on function tonde_private.ai_tool_knowledge(uuid,text)
  from public, anon, authenticated, service_role;

-- The closed set of things a Director check compares. Kept as a function so a test can pin it and so
-- a check can never invent a criterion that nothing evaluates.
create function tonde_private.ai_playbook_criteria() returns text[]
language sql immutable set search_path = '' as $$
  select array['shot_objective','subject_identity','continuity','composition','lighting',
    'camera_movement','environment','wardrobe','props','performance','timing','reference_relationship'];
$$;
revoke all on function tonde_private.ai_playbook_criteria() from public, anon, authenticated, service_role;

-- The plan a Director playbook is compiled from. A Shot without an approved, saved AI plan is not a
-- playbook yet: TONDE says that instead of compiling a prompt from a plan nobody wrote.
create function tonde_private.ai_playbook_basis(target_workspace uuid, target_production uuid,
  target_shot uuid, expected_plan_revision integer default null)
returns tonde.execution_plans language plpgsql stable security definer set search_path = '' as $$
declare plan tonde.execution_plans;
begin
  select * into plan from tonde.execution_plans p
    where p.workspace_id = target_workspace and p.production_id = target_production
      and p.shot_id = target_shot and p.execution_method = 'ai';
  if plan.id is null then
    raise exception 'PLAYBOOK_NEEDS_PLAN: this Shot has no AI plan to direct from. Save the Shot''s AI
      plan first, then the playbook is compiled from it.' using errcode = 'PT404';
  end if;
  if expected_plan_revision is not null and plan.revision <> expected_plan_revision then
    -- The mapped conflict code, never the retryable SQLSTATE 40001 that PostgREST would retry forever.
    raise exception 'The Shot''s AI plan changed since you loaded it' using errcode = 'PT409';
  end if;
  return plan;
end $$;
revoke all on function tonde_private.ai_playbook_basis(uuid,uuid,uuid,integer)
  from public, anon, authenticated, service_role;

-- The tool-specific prompt. One deterministic compilation from the plan plus documented tool
-- knowledge: same inputs, same prompt, and every adaptation is named rather than silent.
create function tonde_private.ai_playbook_prompt(target_workspace uuid, target_production uuid,
  target_shot uuid, p_tool_key text, p_expected_plan_revision integer default null,
  p_correction text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare plan tonde.execution_plans; shot tonde.shots; knowledge jsonb; profile jsonb;
  sections text[] := '{}'; adaptations jsonb := '[]'::jsonb; conflicts text[] := '{}';
  duration_ms bigint; declared_aspect text; prompt text; target_media text;
begin
  plan := tonde_private.ai_playbook_basis(target_workspace, target_production, target_shot,
    p_expected_plan_revision);
  select * into shot from tonde.shots s
    where s.workspace_id = target_workspace and s.production_id = target_production and s.id = target_shot;
  knowledge := tonde_private.ai_tool_knowledge(target_workspace, p_tool_key);
  profile := knowledge -> 'profile';
  target_media := case tonde_private.ai_primary_operation(target_workspace, target_production, target_shot)::text
    when 'video' then 'video' when 'image' then 'image' when 'voice' then 'audio'
    when 'speech' then 'audio' when 'music' then 'audio' when 'sound_effect' then 'audio'
    when 'image_to_video' then 'video' when 'video_to_video' then 'video'
    when 'frame_interpolation' then 'video' when 'lipsync' then 'video' when 'upscaling' then 'video'
    else 'other' end;
  duration_ms := coalesce(plan.expected_duration_ms, shot.planned_duration_ms);
  declared_aspect := nullif(btrim(coalesce(plan.aspect_ratio, '')), '');
  -- The prompt is assembled from the plan and the Shot. A section the plan does not carry says so.
  sections := sections || format('SHOT: %s', shot.title);
  if length(btrim(coalesce(shot.description, ''))) > 0 then
    sections := sections || format('OBJECTIVE: %s', btrim(shot.description));
  end if;
  if length(btrim(coalesce(shot.action, ''))) > 0 then
    sections := sections || format('ACTION: %s', btrim(shot.action));
  end if;
  sections := sections || format('SUBJECT AND ENVIRONMENT: %s',
    coalesce(nullif(btrim(coalesce(plan.product_direction, '')), ''),
      nullif(btrim(coalesce(plan.performance, '')), ''), 'not specified in the plan'));
  sections := sections || format('CAMERA: %s %s %s',
    coalesce(nullif(btrim(coalesce(plan.shot_size, '')), ''), 'shot size not specified'),
    coalesce(nullif(btrim(coalesce(plan.framing, '')), ''), 'framing not specified'),
    coalesce(nullif(btrim(coalesce(plan.composition, '')), ''), 'composition not specified'));
  if length(btrim(coalesce(plan.movement, ''))) > 0
    or length(btrim(coalesce(plan.movement_purpose, ''))) > 0 then
    sections := sections || format('CAMERA MOVEMENT: %s %s', coalesce(nullif(btrim(coalesce(plan.movement, '')), ''),
      'movement not specified'), coalesce(nullif(btrim(coalesce(plan.movement_purpose, '')), ''), ''));
  end if;
  if coalesce(plan.motion, '{}'::jsonb) <> '{}'::jsonb then
    sections := sections || format('MOTION: %s', plan.motion::text);
  end if;
  if length(btrim(coalesce(plan.lighting_intent, ''))) > 0 then
    sections := sections || format('LIGHTING: %s', btrim(plan.lighting_intent));
  end if;
  if length(btrim(coalesce(plan.performance, ''))) > 0 then
    sections := sections || format('PERFORMANCE: %s', btrim(plan.performance));
  end if;
  if coalesce(plan.continuity, '{}'::jsonb) <> '{}'::jsonb then
    sections := sections || format('CONTINUITY: %s', plan.continuity::text);
  end if;
  if coalesce(plan.first_frame, '{}'::jsonb) <> '{}'::jsonb then
    sections := sections || format('START FRAME: %s', plan.first_frame::text);
  end if;
  if coalesce(plan.last_frame, '{}'::jsonb) <> '{}'::jsonb then
    sections := sections || format('END FRAME: %s', plan.last_frame::text);
  end if;
  if coalesce(plan.audio, '{}'::jsonb) <> '{}'::jsonb then
    sections := sections || format('AUDIO: %s', plan.audio::text);
  end if;
  if length(btrim(coalesce(plan.sound_plan, ''))) > 0 then
    sections := sections || format('SOUND: %s', btrim(plan.sound_plan));
  end if;
  if declared_aspect is not null then
    sections := sections || format('ASPECT RATIO: %s', declared_aspect);
  end if;
  if duration_ms is not null then
    sections := sections || format('DURATION: %s ms', duration_ms);
  end if;
  if cardinality(plan.negative_constraints) > 0 then
    sections := sections || format('MUST NOT APPEAR: %s', array_to_string(plan.negative_constraints, '; '));
  end if;
  if p_correction is not null and length(btrim(p_correction)) > 0 then
    sections := sections || format('CORRECTION FROM THE LAST CHECK: %s', btrim(p_correction));
  end if;
  -- Tool-specific adaptation. Only reviewed knowledge changes the prompt, and every change or
  -- disagreement is reported by name.
  if (knowledge ->> 'applied')::boolean and profile is not null then
    if length(btrim(coalesce(profile ->> 'prompt_characteristics', ''))) > 0 then
      -- The notes are named for the tool the prompt is compiled for, which may be a different tool from
      -- the one the plan targeted.
      sections := sections || format('TOOL NOTES (%s): %s', coalesce(p_tool_key, plan.provider_target),
        btrim(profile ->> 'prompt_characteristics'));
      adaptations := adaptations || jsonb_build_object('kind', 'prompt_characteristics',
        'applied', true, 'detail', 'Documented prompting behaviour for this tool is added to the prompt.');
    end if;
    if length(btrim(coalesce(profile ->> 'workflow_guidance', ''))) > 0 then
      sections := sections || format('TOOL WORKFLOW: %s', btrim(profile ->> 'workflow_guidance'));
    end if;
    if (profile ->> 'max_duration_ms') is not null and duration_ms is not null
      and duration_ms > (profile ->> 'max_duration_ms')::bigint then
      conflicts := array_append(conflicts, 'duration_beyond_documented_limit');
      adaptations := adaptations || jsonb_build_object('kind', 'duration_split_required', 'applied', true,
        'planned_duration_ms', duration_ms, 'documented_max_duration_ms',
        (profile ->> 'max_duration_ms')::bigint,
        'detail', 'The planned Shot is longer than this tool documents. Split the Shot into consecutive
          generations that cut together, or plan a longer static take for a tool that allows it.');
    end if;
    if declared_aspect is not null and jsonb_array_length(coalesce(profile -> 'aspect_ratios', '[]'::jsonb)) > 0
      and not (profile -> 'aspect_ratios') @> to_jsonb(array[declared_aspect]) then
      conflicts := array_append(conflicts, 'aspect_ratio_not_documented');
      adaptations := adaptations || jsonb_build_object('kind', 'aspect_ratio_not_documented', 'applied', true,
        'planned_aspect_ratio', declared_aspect,
        'documented_aspect_ratios', profile -> 'aspect_ratios',
        'detail', 'The documented aspect ratios for this tool do not include the planned one. Confirm the
          deliverable with the tool before you rely on this Shot matching the Production.');
    end if;
    if cardinality(plan.negative_constraints) > 0
      and coalesce((profile ->> 'supports_negative_prompt')::boolean, false) is not true then
      conflicts := array_append(conflicts, 'negative_prompt_unsupported');
      adaptations := adaptations || jsonb_build_object('kind', 'negative_prompt_needs_phrasing', 'applied', true,
        'detail', 'This tool is not documented as taking a separate negative prompt, so the exclusions must
          be phrased inside the prompt itself.');
    end if;
    if coalesce(plan.first_frame, '{}'::jsonb) <> '{}'::jsonb
      and coalesce((profile ->> 'supports_first_frame')::boolean, false) is not true then
      conflicts := array_append(conflicts, 'start_frame_unsupported');
      adaptations := adaptations || jsonb_build_object('kind', 'start_frame_needs_another_route', 'applied', true,
        'detail', 'This tool is not documented as accepting a start frame. Capture the frame practically or
          use a tool documented to accept one.');
    end if;
  end if;
  prompt := array_to_string(sections, E'\n');
  return jsonb_build_object(
    'tool_key', p_tool_key, 'target_media', target_media, 'prompt', prompt,
    'prompt_length', length(prompt), 'prompt_version', plan.prompt_version,
    'plan_revision', plan.revision, 'plan_approval', plan.approval,
    'knowledge', knowledge,
    'knowledge_status', knowledge ->> 'status',
    'adaptations', adaptations,
    'conflicts', to_jsonb(conflicts),
    'tool_connection', case when p_tool_key is null then 'not_applicable'
      when exists (select 1 from tonde.ai_provider_connections c
        where c.workspace_id = target_workspace and c.provider_key = p_tool_key and c.state = 'connected')
        then 'connected' else 'none' end,
    'meaning', 'The prompt is compiled by TONDE from the Shot''s plan and the documented behaviour of the
      tool you chose. TONDE does not run the tool, and this prompt is executed in the tool you own.');
end $$;
revoke all on function tonde_private.ai_playbook_prompt(uuid,uuid,uuid,text,integer,text)
  from public, anon, authenticated, service_role;

-- 5. Public reads and writes.

-- Knowledge maintenance. A draft may be corrected in place; knowledge that was reviewed is never
-- rewritten, so a changed fact is a new version that says which version it replaces.
create function tonde.ai_tool_profile_save(target_workspace uuid, p_tool_key text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; existing tonde.ai_tool_profiles; profile tonde.ai_tool_profiles; new_version text;
begin
  actor := tonde_private.ai_tool_librarian(target_workspace);
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A tool profile must be a JSON object' using errcode = '22023';
  end if;
  if p_tool_key is null or p_tool_key !~ '^[a-z][a-z0-9_]{1,59}$' then
    raise exception 'A tool key is lower-case letters, digits and underscores' using errcode = '22023';
  end if;
  new_version := left(btrim(coalesce(p_payload ->> 'tool_version', '')), 120);
  select * into existing from tonde.ai_tool_profiles p
    where p.workspace_id = target_workspace and p.tool_key = p_tool_key
      and p.tool_version = new_version and p.superseded_by is null;
  if existing.id is not null and existing.review_state <> 'draft' then
    -- Reviewed knowledge is a record. Change it by version, so a playbook that relied on it still has
    -- the version it used.
    raise exception 'TOOL_PROFILE_VERSION_REQUIRED: version %s of this tool was %s by review. Save the change as a new tool_version, so the version that was relied on keeps saying what it said.',
      coalesce(nullif(new_version, ''), '(unversioned)'), existing.review_state using errcode = 'PT409';
  end if;
  if existing.id is not null then
    update tonde.ai_tool_profiles set
      display_name = coalesce(nullif(btrim(coalesce(p_payload ->> 'display_name', '')), ''), existing.display_name),
      capability_type = coalesce(nullif(p_payload ->> 'capability_type', ''), existing.capability_type),
      media_kind = coalesce(nullif(p_payload ->> 'media_kind', ''), existing.media_kind),
      input_types = case when p_payload ? 'input_types'
        then tonde_private.ai_json_text_array(p_payload, 'input_types') else existing.input_types end,
      supports_reference_image = coalesce(tonde_private.ai_json_bool(p_payload, 'supports_reference_image', null),
        existing.supports_reference_image),
      supports_reference_video = coalesce(tonde_private.ai_json_bool(p_payload, 'supports_reference_video', null),
        existing.supports_reference_video),
      supports_first_frame = coalesce(tonde_private.ai_json_bool(p_payload, 'supports_first_frame', null),
        existing.supports_first_frame),
      supports_last_frame = coalesce(tonde_private.ai_json_bool(p_payload, 'supports_last_frame', null),
        existing.supports_last_frame),
      supports_negative_prompt = coalesce(tonde_private.ai_json_bool(p_payload, 'supports_negative_prompt', null),
        existing.supports_negative_prompt),
      supports_seed = coalesce(tonde_private.ai_json_bool(p_payload, 'supports_seed', null), existing.supports_seed),
      supports_camera_control = coalesce(tonde_private.ai_json_bool(p_payload, 'supports_camera_control', null),
        existing.supports_camera_control),
      max_duration_ms = case when p_payload ? 'max_duration_ms'
        then nullif(p_payload ->> 'max_duration_ms', '')::bigint else existing.max_duration_ms end,
      aspect_ratios = case when p_payload ? 'aspect_ratios'
        then tonde_private.ai_json_text_array(p_payload, 'aspect_ratios') else existing.aspect_ratios end,
      prompt_characteristics = coalesce(p_payload ->> 'prompt_characteristics', existing.prompt_characteristics),
      known_strengths = coalesce(p_payload ->> 'known_strengths', existing.known_strengths),
      known_limitations = coalesce(p_payload ->> 'known_limitations', existing.known_limitations),
      workflow_guidance = coalesce(p_payload ->> 'workflow_guidance', existing.workflow_guidance),
      typical_external_cost_note = coalesce(p_payload ->> 'typical_external_cost_note',
        existing.typical_external_cost_note),
      documented_at = case when p_payload ? 'documented_at'
        then nullif(p_payload ->> 'documented_at', '')::date else existing.documented_at end,
      source_title = coalesce(nullif(btrim(coalesce(p_payload ->> 'source_title', '')), ''), existing.source_title),
      source_url = coalesce(nullif(btrim(coalesce(p_payload ->> 'source_url', '')), ''), existing.source_url),
      source_publisher = coalesce(nullif(btrim(coalesce(p_payload ->> 'source_publisher', '')), ''),
        existing.source_publisher),
      source_kind = coalesce(nullif(p_payload ->> 'source_kind', ''), existing.source_kind),
      updated_at = now()
      where id = existing.id returning * into profile;
    perform tonde_private.audit_event(target_workspace, 'ai_tool_profile.updated', profile.id, 'ai_tool_profile',
      jsonb_build_object('tool_key', profile.tool_key, 'tool_version', profile.tool_version,
        'revision', profile.revision, 'review_state', profile.review_state));
    return tonde_private.ai_tool_profile_json(profile) || jsonb_build_object('created', false,
      'usable_for_direction', false,
      'meaning', 'The draft is updated. Nothing relies on it until a reviewer approves it.');
  end if;
  insert into tonde.ai_tool_profiles(workspace_id, tool_key, display_name, capability_type, media_kind,
    input_types, supports_reference_image, supports_reference_video, supports_first_frame,
    supports_last_frame, supports_negative_prompt, supports_seed, supports_camera_control, max_duration_ms,
    aspect_ratios, prompt_characteristics, known_strengths, known_limitations, workflow_guidance,
    typical_external_cost_note, tool_version, documented_at, source_title, source_url, source_publisher,
    source_kind, created_by)
  values (target_workspace, p_tool_key,
    left(btrim(coalesce(p_payload ->> 'display_name', p_tool_key)), 120),
    coalesce(nullif(p_payload ->> 'capability_type', ''), 'video_generation'),
    coalesce(nullif(p_payload ->> 'media_kind', ''), 'video'),
    case when p_payload ? 'input_types' then tonde_private.ai_json_text_array(p_payload, 'input_types') else '{}' end,
    coalesce(tonde_private.ai_json_bool(p_payload, 'supports_reference_image', false), false),
    coalesce(tonde_private.ai_json_bool(p_payload, 'supports_reference_video', false), false),
    coalesce(tonde_private.ai_json_bool(p_payload, 'supports_first_frame', false), false),
    coalesce(tonde_private.ai_json_bool(p_payload, 'supports_last_frame', false), false),
    coalesce(tonde_private.ai_json_bool(p_payload, 'supports_negative_prompt', false), false),
    coalesce(tonde_private.ai_json_bool(p_payload, 'supports_seed', false), false),
    coalesce(tonde_private.ai_json_bool(p_payload, 'supports_camera_control', false), false),
    case when p_payload ? 'max_duration_ms' then nullif(p_payload ->> 'max_duration_ms', '')::bigint end,
    case when p_payload ? 'aspect_ratios' then tonde_private.ai_json_text_array(p_payload, 'aspect_ratios') else '{}' end,
    coalesce(p_payload ->> 'prompt_characteristics', ''), coalesce(p_payload ->> 'known_strengths', ''),
    coalesce(p_payload ->> 'known_limitations', ''), coalesce(p_payload ->> 'workflow_guidance', ''),
    coalesce(p_payload ->> 'typical_external_cost_note', ''), new_version,
    case when p_payload ? 'documented_at' then nullif(p_payload ->> 'documented_at', '')::date end,
    nullif(btrim(coalesce(p_payload ->> 'source_title', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'source_url', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'source_publisher', '')), ''),
    coalesce(nullif(p_payload ->> 'source_kind', ''), 'creator'), actor)
  returning * into profile;
  perform tonde_private.audit_event(target_workspace, 'ai_tool_profile.created', profile.id, 'ai_tool_profile',
    jsonb_build_object('tool_key', profile.tool_key, 'tool_version', profile.tool_version,
      'capability_type', profile.capability_type, 'review_state', profile.review_state,
      'sourced', profile.source_title is not null or profile.source_url is not null));
  return tonde_private.ai_tool_profile_json(profile) || jsonb_build_object('created', true,
    'usable_for_direction', false,
    'meaning', 'The documented knowledge is recorded as a draft. Review it before TONDE directs a Shot
      with it, because until then TONDE reports it and does not apply it.');
end $$;
revoke all on function tonde.ai_tool_profile_save(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.ai_tool_profile_save(uuid,text,jsonb) to authenticated, service_role;

create function tonde.ai_tool_profile_review(target_workspace uuid, target_profile uuid, p_decision text,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; profile tonde.ai_tool_profiles; replacement uuid;
begin
  actor := tonde_private.ai_tool_reviewer(target_workspace);
  if p_decision not in ('review','retire','return_to_draft') then
    raise exception 'A review decision is review, retire or return_to_draft' using errcode = '22023';
  end if;
  select * into profile from tonde.ai_tool_profiles p
    where p.workspace_id = target_workspace and p.id = target_profile for update;
  if profile.id is null then
    raise exception 'That tool profile does not exist in this workspace' using errcode = 'P0002';
  end if;
  if p_decision = 'review' then
    if profile.source_title is null and profile.source_url is null then
      raise exception 'TOOL_PROFILE_NEEDS_SOURCE: knowledge TONDE will rely on names the documentation it
        came from.' using errcode = 'PT400';
    end if;
    if profile.review_state = 'reviewed' then
      return tonde_private.ai_tool_profile_json(profile) || jsonb_build_object('idempotent', true);
    end if;
    update tonde.ai_tool_profiles set review_state = 'reviewed', reviewed_by = actor, reviewed_at = now(),
      review_note = nullif(left(coalesce(p_note, ''), 1000), ''), updated_at = now()
      where id = profile.id returning * into profile;
    perform tonde_private.audit_event(target_workspace, 'ai_tool_profile.reviewed', profile.id, 'ai_tool_profile',
      jsonb_build_object('tool_key', profile.tool_key, 'tool_version', profile.tool_version,
        'source_title', profile.source_title));
    return tonde_private.ai_tool_profile_json(profile) || jsonb_build_object('idempotent', false,
      'usable_for_direction', true,
      'meaning', 'This documented knowledge may now change how TONDE compiles a prompt for this tool.');
  end if;
  if p_decision = 'return_to_draft' then
    update tonde.ai_tool_profiles set review_state = 'draft', reviewed_by = null, reviewed_at = null,
      review_note = nullif(left(coalesce(p_note, ''), 1000), ''), updated_at = now()
      where id = profile.id returning * into profile;
    perform tonde_private.audit_event(target_workspace, 'ai_tool_profile.returned_to_draft', profile.id,
      'ai_tool_profile', jsonb_build_object('tool_key', profile.tool_key, 'note', left(coalesce(p_note, ''), 400)));
    return tonde_private.ai_tool_profile_json(profile) || jsonb_build_object('idempotent', false,
      'usable_for_direction', false,
      'meaning', 'This knowledge is a draft again, so it is reported and no longer applied.');
  end if;
  select p.id into replacement from tonde.ai_tool_profiles p
    where p.workspace_id = target_workspace and p.tool_key = profile.tool_key and p.id <> profile.id
      and p.superseded_by is null and p.review_state in ('draft','reviewed')
    order by p.revision desc limit 1;
  if replacement is null and (p_note is null or length(btrim(p_note)) = 0) then
    raise exception 'A retired profile says why, or names the version that replaces it' using errcode = '22023';
  end if;
  update tonde.ai_tool_profiles set review_state = 'retired', reviewed_by = actor, reviewed_at = now(),
    review_note = nullif(left(coalesce(p_note, ''), 1000), ''), superseded_by = replacement,
    updated_at = now() where id = profile.id returning * into profile;
  perform tonde_private.audit_event(target_workspace, 'ai_tool_profile.retired', profile.id, 'ai_tool_profile',
    jsonb_build_object('tool_key', profile.tool_key, 'superseded_by', replacement, 'note', left(coalesce(p_note, ''), 400)));
  return tonde_private.ai_tool_profile_json(profile) || jsonb_build_object('idempotent', false,
    'usable_for_direction', false,
    'meaning', 'This version is retired. TONDE stops applying it, and it stays readable as what was known.');
end $$;
revoke all on function tonde.ai_tool_profile_review(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.ai_tool_profile_review(uuid,uuid,text,text) to authenticated, service_role;

-- What TONDE has been taught about the tools a creator might use. A connection is never implied.
create function tonde.ai_tool_catalog(target_workspace uuid, p_capability_type text default null,
  p_include_drafts boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare profiles jsonb; actor uuid := (select auth.uid());
begin
  if actor is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if p_capability_type is not null and p_capability_type not in ('video_generation','image_generation',
    'audio_generation','editing','compositing','upscaling','other') then
    raise exception 'That is not a documented tool capability type' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(tonde_private.ai_tool_profile_json(p) || jsonb_build_object(
      'tonde_connection', case when p.tool_key in (select c.provider_key from tonde.ai_provider_connections c
        where c.workspace_id = target_workspace and c.state = 'connected')
        then 'connected' else 'none' end,
      'is_connected_provider', p.tool_key in (select ap.key from tonde.ai_providers ap))
    order by p.display_name, p.revision desc), '[]'::jsonb) into profiles
    from tonde.ai_tool_profiles p
    where p.workspace_id = target_workspace
      and (p_include_drafts or p.review_state = 'reviewed')
      and p.superseded_by is null
      and (p_capability_type is null or p.capability_type = p_capability_type);
  return jsonb_build_object('workspace_id', target_workspace, 'tools', profiles,
    'count', jsonb_array_length(profiles),
    'returned_drafts', coalesce(p_include_drafts, false),
    'meaning', 'This is documented production knowledge about external tools, with its source and review
      state. It is not a list of API connections: TONDE holding knowledge about a tool never means TONDE
      can run that tool or bill for it.');
end $$;
revoke all on function tonde.ai_tool_catalog(uuid,text,boolean) from public, anon, authenticated, service_role;
grant execute on function tonde.ai_tool_catalog(uuid,text,boolean) to authenticated, service_role;

-- The Production Kit's AI TOOLS: the tools this creator actually has.
create function tonde.production_ai_tool_set(target_workspace uuid, target_production uuid, p_tool_key text,
  p_display_name text default null, p_tool_profile_id uuid default null, p_note text default '',
  p_remove boolean default false, p_sort_order integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; entry tonde.production_ai_tools; profile tonde.ai_tool_profiles; production_row tonde.productions;
begin
  actor := tonde_private.ai_tool_librarian(target_workspace);
  select * into production_row from tonde.productions pr
    where pr.workspace_id = target_workspace and pr.id = target_production;
  if production_row.id is null then
    raise exception 'That Production does not exist in this workspace' using errcode = 'P0002';
  end if;
  if p_tool_key is null or p_tool_key !~ '^[a-z][a-z0-9_]{1,59}$' then
    raise exception 'A tool key is lower-case letters, digits and underscores' using errcode = '22023';
  end if;
  select * into entry from tonde.production_ai_tools t
    where t.workspace_id = target_workspace and t.production_id = target_production and t.tool_key = p_tool_key;
  if coalesce(p_remove, false) then
    if entry.id is null then
      return jsonb_build_object('tool_key', p_tool_key, 'removed', false, 'idempotent', true);
    end if;
    delete from tonde.production_ai_tools where id = entry.id;
    perform tonde_private.audit_event(target_workspace, 'production_ai_tool.removed', entry.id,
      'production_ai_tool', jsonb_build_object('tool_key', p_tool_key, 'production_id', target_production));
    return jsonb_build_object('tool_key', p_tool_key, 'removed', true, 'idempotent', false,
      'meaning', 'The tool is no longer part of this Production''s kit. Nothing else changed.');
  end if;
  if p_tool_profile_id is not null then
    select * into profile from tonde.ai_tool_profiles p
      where p.workspace_id = target_workspace and p.id = p_tool_profile_id;
    if profile.id is null or profile.tool_key <> p_tool_key then
      raise exception 'That profile is not a profile of this tool' using errcode = '22023';
    end if;
    if profile.review_state = 'retired' then
      raise exception 'That profile version is retired' using errcode = 'PT409';
    end if;
  end if;
  if entry.id is null then
    insert into tonde.production_ai_tools(workspace_id, production_id, tool_key, display_name,
      tool_profile_id, note, sort_order, created_by)
    values (target_workspace, target_production, p_tool_key,
      left(btrim(coalesce(p_display_name, initcap(replace(p_tool_key, '_', ' ')))), 120),
      p_tool_profile_id, left(coalesce(p_note, ''), 600), coalesce(p_sort_order, 0), actor)
    returning * into entry;
    perform tonde_private.audit_event(target_workspace, 'production_ai_tool.added', entry.id,
      'production_ai_tool', jsonb_build_object('tool_key', p_tool_key, 'production_id', target_production,
        'profile_id', p_tool_profile_id));
    return jsonb_build_object('tool_key', entry.tool_key, 'display_name', entry.display_name,
      'tool_profile_id', entry.tool_profile_id, 'removed', false, 'created', true,
      'meaning', 'The tool is part of this Production''s kit. TONDE can now direct a Shot towards it, and
        it still needs no credential for it.');
  end if;
  update tonde.production_ai_tools set
    display_name = coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), entry.display_name),
    tool_profile_id = coalesce(p_tool_profile_id, entry.tool_profile_id),
    note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), entry.note),
    sort_order = coalesce(p_sort_order, entry.sort_order),
    updated_at = now()
    where id = entry.id returning * into entry;
  perform tonde_private.audit_event(target_workspace, 'production_ai_tool.updated', entry.id,
    'production_ai_tool', jsonb_build_object('tool_key', p_tool_key, 'profile_id', entry.tool_profile_id));
  return jsonb_build_object('tool_key', entry.tool_key, 'display_name', entry.display_name,
    'tool_profile_id', entry.tool_profile_id, 'removed', false, 'created', false,
    'meaning', 'The kit entry is updated.');
end $$;
revoke all on function tonde.production_ai_tool_set(uuid,uuid,text,text,uuid,text,boolean,integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.production_ai_tool_set(uuid,uuid,text,text,uuid,text,boolean,integer)
  to authenticated, service_role;

-- The Director's workstation read for one Shot: what to make, how, with which tool, why, the prompt to
-- copy, what must stay unchanged, the expected Result and how TONDE will judge it.
create function tonde.ai_playbook_for_shot(target_workspace uuid, target_production uuid, target_shot uuid,
  p_tool_key text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid; shot tonde.shots; plan tonde.execution_plans; production_row tonde.productions;
  kit jsonb; recommended text; recommended_name text; why text; compiled jsonb; criteria jsonb; check_row tonde.shot_match_reports;
  cost jsonb; profile jsonb;
begin
  if auth.uid() is not null and not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  actor := (select auth.uid());
  select * into production_row from tonde.productions pr
    where pr.workspace_id = target_workspace and pr.id = target_production;
  if production_row.id is null then
    raise exception 'That Production does not exist in this workspace' using errcode = 'P0002';
  end if;
  select * into shot from tonde.shots s
    where s.workspace_id = target_workspace and s.production_id = target_production and s.id = target_shot;
  if shot.id is null then
    raise exception 'That Shot does not exist in this Production' using errcode = 'P0002';
  end if;
  select * into plan from tonde.execution_plans p
    where p.workspace_id = target_workspace and p.production_id = target_production and p.shot_id = target_shot
      and p.execution_method = 'ai';
  -- The kit, with the documented knowledge state of each tool, so the recommendation can only ever name
  -- a tool the creator actually has.
  select coalesce(jsonb_agg(jsonb_build_object(
      'tool_key', t.tool_key, 'display_name', t.display_name, 'profile_id', t.tool_profile_id,
      'kit_note', t.note, 'knowledge_status',
      (tonde_private.ai_tool_knowledge(target_workspace, t.tool_key) ->> 'status'))
    order by t.sort_order, t.display_name), '[]'::jsonb) into kit
    from tonde.production_ai_tools t
    where t.workspace_id = target_workspace and t.production_id = target_production;
  -- The tool the playbook is compiled for: the one asked for, else the one the plan targets and the kit
  -- carries, else the first kit tool with reviewed knowledge.
  if p_tool_key is not null then
    recommended := p_tool_key;
  elsif plan.provider_target is not null and exists (select 1 from tonde.production_ai_tools t
    where t.workspace_id = target_workspace and t.production_id = target_production
      and t.tool_key = plan.provider_target) then
    recommended := plan.provider_target;
  else
    select t.tool_key into recommended from tonde.production_ai_tools t
      where t.workspace_id = target_workspace and t.production_id = target_production
        and (tonde_private.ai_tool_knowledge(target_workspace, t.tool_key) ->> 'status') = 'reviewed'
      order by t.sort_order, t.display_name limit 1;
    if recommended is null then
      select t.tool_key into recommended from tonde.production_ai_tools t
        where t.workspace_id = target_workspace and t.production_id = target_production
        order by t.sort_order, t.display_name limit 1;
    end if;
  end if;
  select t.display_name into recommended_name from tonde.production_ai_tools t
    where t.workspace_id = target_workspace and t.production_id = target_production
      and t.tool_key = recommended;
  if plan.id is not null then
    compiled := tonde_private.ai_playbook_prompt(target_workspace, target_production, target_shot,
      recommended, null, null);
  else
    compiled := null;
  end if;
  profile := compiled -> 'knowledge' -> 'profile';
  why := case
    when recommended is null then
      'No external AI tool is in this Production''s kit yet, so TONDE directs the Shot without naming a
        tool. Add the tools you own, and the playbook adapts to the one you choose.'
    when (compiled ->> 'knowledge_status') = 'reviewed' then format(
      '%s is in your kit and TONDE holds reviewed, documented knowledge of how it reads a prompt, so the
        prompt is adapted for it.', coalesce(recommended_name, initcap(replace(recommended, '_', ' '))))
    when (compiled ->> 'knowledge_status') = 'draft' then format(
      '%s is in your kit. A draft profile exists for it, but nobody reviewed it, so TONDE reports that
        knowledge and does not apply it.', coalesce(recommended_name, initcap(replace(recommended, '_', ' '))))
    else format(
      '%s is in your kit, and TONDE holds no documented knowledge of how it reads a prompt. The playbook is
        compiled from the Shot''s plan alone, and TONDE says so rather than guessing.',
      coalesce(recommended_name, initcap(replace(recommended, '_', ' ')))) end;
  select coalesce(jsonb_agg(jsonb_build_object('criterion', c, 'what_tonde_checks', case c
      when 'shot_objective' then 'the Result serves the Shot''s stated objective'
      when 'subject_identity' then 'the same subject, recognisably, as the plan and locks describe'
      when 'continuity' then 'the traits locked for this Production are preserved'
      when 'composition' then 'the framing and composition the plan asked for'
      when 'lighting' then 'the lighting intent, not merely pleasant light'
      when 'camera_movement' then 'the movement, or the absence of it, that the plan asked for'
      when 'environment' then 'the environment the Shot is set in'
      when 'wardrobe' then 'the wardrobe, as planned'
      when 'props' then 'the props the Shot depends on'
      when 'performance' then 'the performance the Shot needs'
      when 'timing' then 'duration and beat timing against the planned cut'
      when 'reference_relationship' then 'the relationship to the reference the creator started from'
      else 'the criterion the playbook names' end)), '[]'::jsonb) into criteria
    from unnest(tonde_private.ai_playbook_criteria()) as c;
  select * into check_row from tonde.shot_match_reports r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.shot_id = target_shot
      and r.verdict is not null
    order by r.checked_at desc nulls last, r.created_at desc limit 1;
  cost := jsonb_build_object(
    'tonde_cost', jsonb_build_object('state', case when plan.cost_state = 'known' then 'known' else 'unknown' end,
      'amount', plan.cost_amount, 'currency', plan.cost_currency, 'note', plan.cost_note,
      'basis', 'what TONDE would charge for the direction of this Shot, if anything'),
    'external_tool_cost', jsonb_build_object('state', 'estimate', 'kind', 'external',
      'amount', null, 'currency', '', 'note', coalesce(profile ->> 'typical_external_cost_note', ''),
      'basis', 'what the external tool may charge on the creator''s own account; it is never a TONDE charge'),
    'resold_by_tonde', false,
    'estimate_or_actual', 'estimate',
    'meaning', 'Two different costs are named separately: what TONDE charges for directing, and what the
      creator''s own external tool may charge them. TONDE does not resell generation and does not invent a
      figure for a tool whose cost it cannot document.');
  return jsonb_build_object(
    'workspace_id', target_workspace, 'production_id', target_production, 'shot_id', target_shot,
    'shot_objective', jsonb_build_object('title', shot.title, 'description', shot.description,
      'action', shot.action, 'planned_duration_ms', shot.planned_duration_ms),
    'execution', jsonb_build_object('shot_execution_method', shot.execution_method,
      'has_ai_plan', plan.id is not null, 'plan_approval', plan.approval,
      'plan_revision', plan.revision, 'prompt_version', plan.prompt_version,
      'strategies', to_jsonb(array['real','ai','hybrid']),
      'detail', 'REAL captures it, AI executes it in an external tool, HYBRID does both and TONDE
        coordinates the steps. The external tool is where the media is made.'),
    'target_media', compiled ->> 'target_media',
    'recommended_tool', recommended,
    'recommended_tool_name', recommended_name,
    'why', why,
    'kit_tools', kit,
    'prompt', compiled -> 'prompt',
    'prompt_length', compiled -> 'prompt_length',
    'reference_inputs', coalesce((select jsonb_agg(jsonb_build_object('reference_id', r.id,
        'role', r.reference_role, 'priority', r.priority, 'origin', r.origin, 'note', r.note,
        'asset_id', r.asset_id, 'media_id', r.media_id) order by r.priority, r.sort_order, r.id)
      from tonde.ai_shot_references r
      where r.workspace_id = target_workspace and r.production_id = target_production and r.shot_id = target_shot),
      '[]'::jsonb),
    'continuity', coalesce((select jsonb_agg(jsonb_build_object('scope', l.scope, 'label', l.label,
        'locked', l.locked, 'priority', l.priority, 'locked_traits', to_jsonb(l.locked_traits),
        'prohibited_changes', to_jsonb(l.prohibited_changes)) order by l.scope, l.label, l.id)
      from tonde.ai_continuity_locks l
      where l.workspace_id = target_workspace and l.production_id = target_production), '[]'::jsonb),
    'settings', jsonb_build_object('aspect_ratio', plan.aspect_ratio, 'expected_duration_ms',
      plan.expected_duration_ms, 'operation', tonde_private.ai_primary_operation(target_workspace,
        target_production, target_shot), 'model_profile_id', plan.model_profile_id,
      'model_version', plan.model_version, 'provider_target', plan.provider_target),
    'negative_constraints', to_jsonb(plan.negative_constraints),
    'limitations', to_jsonb(plan.limitations),
    'tool_knowledge', case when compiled is null then jsonb_build_object('status', 'absent', 'applied', false,
      'profile', null, 'detail', 'No AI plan is saved for this Shot yet, so there is no playbook prompt and
        no tool knowledge is applied.') else compiled -> 'knowledge' end,
    'adaptations', coalesce(compiled -> 'adaptations', '[]'::jsonb),
    'conflicts', coalesce(compiled -> 'conflicts', '[]'::jsonb),
    'tool_connection', coalesce(compiled ->> 'tool_connection', 'not_applicable'),
    'expected_result', jsonb_build_object('deliverable', compiled ->> 'target_media',
      'detail', 'Upload the file the tool produced back to this Shot. The Result is the return point for
        every execution strategy.'),
    'evaluation_criteria', criteria,
    'cost', cost,
    'last_check', case when check_row.id is null then null else jsonb_build_object(
      'check_id', check_row.id, 'verdict', check_row.verdict, 'instructions', check_row.instructions,
      'tool_key', check_row.tool_key, 'checked_at', check_row.checked_at, 'criteria', check_row.criteria,
      'next_prompt', check_row.next_prompt, 'previous_check_id', check_row.previous_check_id) end,
    'meaning', 'This is direction, not generation. TONDE names what to make, how you can execute it, which
      of your tools fits, why, and the prompt to run there. The media is produced in your tool or on your
      camera, and the Result comes back here to be checked.');
end $$;
revoke all on function tonde.ai_playbook_for_shot(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.ai_playbook_for_shot(uuid,uuid,uuid,text) to authenticated, service_role;

-- The compiled tool-specific prompt on its own, for COPY PROMPT, and for adapting to another of the
-- creator's tools without touching the Shot's plan.
create function tonde.ai_playbook_prompt_compile(target_workspace uuid, target_production uuid,
  target_shot uuid, p_tool_key text default null, p_expected_plan_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare compiled jsonb; kit_entry tonde.production_ai_tools;
begin
  if auth.uid() is not null and not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if p_tool_key is not null then
    select * into kit_entry from tonde.production_ai_tools t
      where t.workspace_id = target_workspace and t.production_id = target_production
        and t.tool_key = p_tool_key;
    if kit_entry.id is null then
      raise exception 'TOOL_NOT_IN_KIT: % is not part of this Production''s kit. Add the tools you
        actually have, and TONDE adapts to them.', p_tool_key using errcode = 'PT404';
    end if;
  end if;
  compiled := tonde_private.ai_playbook_prompt(target_workspace, target_production, target_shot,
    p_tool_key, p_expected_plan_revision, null);
  perform tonde_private.audit_event(target_workspace, 'ai_playbook.prompt_compiled', target_shot, 'shot',
    jsonb_build_object('tool_key', p_tool_key, 'knowledge_status', compiled ->> 'knowledge_status',
      'conflicts', compiled -> 'conflicts', 'plan_revision', compiled -> 'plan_revision'));
  return compiled;
end $$;
revoke all on function tonde.ai_playbook_prompt_compile(uuid,uuid,uuid,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.ai_playbook_prompt_compile(uuid,uuid,uuid,text,integer)
  to authenticated, service_role;

-- The check. TONDE compares the uploaded Result against the playbook and returns ACCEPT or FIX with
-- instructions, and a FIX produces the next prompt in the same answer.
create function tonde.ai_result_check(target_workspace uuid, target_production uuid, target_shot uuid,
  target_result uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; shot tonde.shots; result_row tonde.results; plan tonde.execution_plans;
  previous tonde.shot_match_reports; report tonde.shot_match_reports; payload jsonb := coalesce(p_payload, '{}'::jsonb);
  verdict text; criteria_in jsonb; criteria jsonb; findings jsonb; instructions text; tool_key text;
  prompt_text text; next_prompt text; severe integer; conflicts jsonb; changed jsonb; closed text[];
begin
  actor := tonde_private.ai_tool_librarian(target_workspace);
  if jsonb_typeof(payload) <> 'object' then
    raise exception 'A Director check must be a JSON object' using errcode = '22023';
  end if;
  verdict := payload ->> 'verdict';
  if verdict not in ('accept','fix') then
    raise exception 'A Director check returns accept or fix' using errcode = '22023';
  end if;
  instructions := nullif(btrim(coalesce(payload ->> 'instructions', '')), '');
  if verdict = 'fix' and instructions is null then
    raise exception 'A FIX says what to change' using errcode = '22023';
  end if;
  criteria_in := coalesce(payload -> 'criteria', '[]'::jsonb);
  if jsonb_typeof(criteria_in) <> 'array' or jsonb_array_length(criteria_in) = 0 then
    raise exception 'A Director check names the criteria it judged' using errcode = '22023';
  end if;
  closed := tonde_private.ai_playbook_criteria();
  if exists (select 1 from jsonb_array_elements(criteria_in) c
      where not ((c ->> 'criterion') = any(closed))) then
    raise exception 'CHECK_CRITERION_UNKNOWN: a check judges only %.', array_to_string(closed, ', ')
      using errcode = '22023';
  end if;
  select * into shot from tonde.shots s
    where s.workspace_id = target_workspace and s.production_id = target_production and s.id = target_shot;
  if shot.id is null then
    raise exception 'That Shot does not exist in this Production' using errcode = 'P0002';
  end if;
  select * into result_row from tonde.results r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.id = target_result;
  if result_row.id is null then
    raise exception 'That Result does not exist in this Production' using errcode = 'P0002';
  end if;
  if result_row.shot_id is distinct from target_shot then
    raise exception 'That Result belongs to a different Shot' using errcode = 'PT409';
  end if;
  select * into plan from tonde.execution_plans p
    where p.workspace_id = target_workspace and p.production_id = target_production
      and p.shot_id = target_shot and p.execution_method = 'ai';
  tool_key := coalesce(nullif(btrim(coalesce(payload ->> 'tool_key', '')), ''), plan.provider_target);
  if tool_key is not null and tool_key !~ '^[a-z][a-z0-9_]{1,59}$' then
    raise exception 'A tool key is lower-case letters, digits and underscores' using errcode = '22023';
  end if;
  prompt_text := nullif(coalesce(payload ->> 'prompt_text', ''), '');
  if prompt_text is null and plan.id is not null and length(btrim(plan.provider_prompt)) > 0 then
    prompt_text := plan.provider_prompt;
  end if;
  select * into previous from tonde.shot_match_reports r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.shot_id = target_shot
      and r.verdict is not null
    order by r.checked_at desc nulls last, r.created_at desc limit 1;
  -- What changed since the last check, criterion by criterion, so an iteration is understood rather
  -- than merely counted.
  changed := jsonb_build_object('previous_check_id', previous.id,
    'previous_verdict', previous.verdict, 'previous_instructions', previous.instructions);
  if previous.id is not null then
    changed := changed || jsonb_build_object('criteria_now_passing', coalesce((select jsonb_agg(c ->> 'criterion')
      from jsonb_array_elements(criteria_in) c
      where (c ->> 'result') = 'pass' and exists (select 1 from jsonb_array_elements(previous.criteria) o
        where (o ->> 'criterion') = (c ->> 'criterion') and (o ->> 'result') = 'fail')), '[]'::jsonb),
      'criteria_still_failing', coalesce((select jsonb_agg(c ->> 'criterion')
      from jsonb_array_elements(criteria_in) c
      where (c ->> 'result') = 'fail' and exists (select 1 from jsonb_array_elements(previous.criteria) o
        where (o ->> 'criterion') = (c ->> 'criterion') and (o ->> 'result') = 'fail')), '[]'::jsonb),
      'criteria_newly_failing', coalesce((select jsonb_agg(c ->> 'criterion')
      from jsonb_array_elements(criteria_in) c
      where (c ->> 'result') = 'fail' and not exists (select 1 from jsonb_array_elements(previous.criteria) o
        where (o ->> 'criterion') = (c ->> 'criterion') and (o ->> 'result') = 'fail')), '[]'::jsonb));
  end if;
  findings := coalesce(payload -> 'findings', '[]'::jsonb);
  if jsonb_typeof(findings) <> 'array' then
    raise exception 'Findings are an array' using errcode = '22023';
  end if;
  select count(*) into severe from jsonb_array_elements(criteria_in) c
    where (c ->> 'result') = 'fail' and coalesce(c ->> 'severity', 'material') = 'material';
  if verdict = 'accept' and severe > 0 then
    raise exception 'CHECK_CONTRADICTS_ITSELF: a material criterion is failing, so the Result cannot be
      accepted.' using errcode = 'PT409';
  end if;
  criteria := coalesce((select jsonb_agg(jsonb_build_object('criterion', c ->> 'criterion',
      'result', c ->> 'result', 'severity', coalesce(nullif(c ->> 'severity', ''), 'info'),
      'note', nullif(left(coalesce(c ->> 'note', ''), 1000), '')) order by c ->> 'criterion')
    from jsonb_array_elements(criteria_in) c), '[]'::jsonb);
  -- A FIX produces the next prompt for the same tool, with the correction in it. This is direction, not
  -- a media call: nothing is executed here.
  if verdict = 'fix' and plan.id is not null then
    next_prompt := tonde_private.ai_playbook_prompt(target_workspace, target_production, target_shot,
      tool_key, null, instructions) ->> 'prompt';
  end if;
  insert into tonde.shot_match_reports(workspace_id, production_id, shot_id, result_id, state, findings,
    severity, recommendations, approval, execution_method, tool_key, verdict, instructions, criteria,
    prompt_text, next_prompt, previous_check_id, what_changed, checked_by, checked_at)
  values (target_workspace, target_production, target_shot, target_result, 'complete', findings,
    case when severe > 0 then 'critical' else 'info' end,
    coalesce(payload -> 'recommendations', '[]'::jsonb), 'draft', shot.execution_method, tool_key, verdict,
    instructions, criteria, prompt_text, next_prompt, previous.id, changed, actor, now())
  returning * into report;
  perform tonde_private.audit_event(target_workspace, 'ai_result.checked', report.id, 'shot_match_report',
    jsonb_build_object('shot_id', target_shot, 'result_id', target_result, 'verdict', verdict,
      'tool_key', tool_key, 'failing', severe, 'previous_check_id', previous.id));
  return jsonb_build_object('check_id', report.id, 'shot_id', target_shot, 'result_id', target_result,
    'verdict', verdict, 'instructions', instructions, 'criteria', criteria, 'findings', findings,
    'severity', report.severity, 'tool_key', tool_key, 'checked_at', report.checked_at,
    'prompt_checked', prompt_text, 'next_prompt', next_prompt,
    'what_changed', changed,
    'prompt_version', coalesce(plan.prompt_version, 0),
    'next_step', case when verdict = 'accept'
      then 'The Result is accepted. The Shot is done until something upstream changes.'
      else 'Run the next prompt in your external tool, then upload the new Result and check it again.' end,
    'meaning', case when verdict = 'accept'
      then 'Every criterion TONDE checked is satisfied by the uploaded Result.'
      else 'TONDE found what does not match the playbook and what to change. It did not produce the media:
        the correction is a prompt for the tool you run.' end);
end $$;
revoke all on function tonde.ai_result_check(uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.ai_result_check(uuid,uuid,uuid,uuid,jsonb) to authenticated, service_role;

-- The iteration record for one Shot: every attempt executed externally and every Director check, in
-- order, so PROMPT V1 -> RESULT V1 -> CHECK -> CORRECTION -> PROMPT V2 is readable.
create function tonde.ai_playbook_history(target_workspace uuid, target_production uuid, target_shot uuid,
  p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare attempts jsonb; checks jsonb;
begin
  if auth.uid() is not null and not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'A history read is between 1 and 200 records' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('attempt_id', a.id, 'attempt_number', a.attempt_number,
      'mode', a.mode, 'provider_key', a.provider_key, 'prompt_version', a.prompt_version,
      'status', a.status, 'result_id', a.result_id, 'output_media_id', a.output_media_id,
      'creator_decision', a.creator_decision, 'created_at', a.created_at)
    order by a.attempt_number), '[]'::jsonb) into attempts
    from tonde.ai_generation_attempts a
    where a.workspace_id = target_workspace and a.production_id = target_production and a.shot_id = target_shot;
  select coalesce(jsonb_agg(jsonb_build_object('check_id', r.id, 'result_id', r.result_id,
      'verdict', r.verdict, 'tool_key', r.tool_key, 'instructions', r.instructions, 'criteria', r.criteria,
      'prompt_checked', r.prompt_text, 'next_prompt', r.next_prompt, 'previous_check_id', r.previous_check_id,
      'what_changed', r.what_changed, 'checked_at', r.checked_at) order by r.checked_at nulls last, r.created_at),
    '[]'::jsonb) into checks
    from tonde.shot_match_reports r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.shot_id = target_shot
      and r.verdict is not null;
  return jsonb_build_object('workspace_id', target_workspace, 'production_id', target_production,
    'shot_id', target_shot, 'attempts', attempts, 'checks', checks,
    'meaning', 'The attempts are what the creator executed in the external tool; the checks are what TONDE
      said about each Result. The media was never produced by TONDE.');
end $$;
revoke all on function tonde.ai_playbook_history(uuid,uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.ai_playbook_history(uuid,uuid,uuid,integer) to authenticated, service_role;

-- The product boundary, stated by the database so an interface can show it and a test can pin it.
create function tonde.ai_director_boundary() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'product_role', 'director',
    'direct_media_generation', false,
    'generation_provider_required', false,
    'media_generation_provider_dependency', 'none for the core product',
    'ai_creation', 'external tool playbook plus result checking',
    'execution_strategies', to_jsonb(array['real','ai','hybrid']),
    'tonde_generates_final_media', false,
    'external_tools_are_tonde_truth', false,
    'results_return_to_tonde', true,
    'tonde_compiles_prompts_for_external_tools', true,
    'tonde_evaluates_results', true,
    'tonde_bills_for_tonde_service_only', true,
    'tool_knowledge_is_documented_and_sourced', true,
    'optional_future_connector', 'allowed, optional, and not built',
    'meaning', 'TONDE is the production Director. It analyses, plans, recommends, writes the playbook and
      the prompt for the tool the creator owns, and checks the Result the creator uploads. It does not
      host image or video generation and needs no credential for one.');
$$;
revoke all on function tonde.ai_director_boundary() from public, anon, authenticated, service_role;
grant execute on function tonde.ai_director_boundary() to authenticated, service_role;

alter default privileges in schema tonde revoke execute on functions from public;
alter default privileges in schema tonde_private revoke execute on functions from public;

commit;
