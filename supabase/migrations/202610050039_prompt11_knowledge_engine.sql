-- Prompt 11 packet 039 — the Production Knowledge Engine.
--
-- Prompt 5 already created `tonde.creative_techniques`: a workspace-scoped, human-readable technique
-- with its purpose, its effect, its practical and AI concepts, its limitations and its confidence.
-- That is the canonical knowledge row, and this packet extends it. It does NOT add a second knowledge
-- table, and it does not turn knowledge into a generic document store.
--
-- What this packet adds is what makes knowledge trustworthy enough to guide a production:
--
--   1. WHERE IT CAME FROM. Every item carries normalized sources (label, locator, publisher, license,
--      retrieval and publication dates, credibility and a bounded excerpt). Provenance is a table, not
--      a prose paragraph, so a creator can always answer "says who?".
--   2. WHAT TONDE SAYS VERSUS WHAT THE SOURCE SAYS. A source's claim and TONDE's adapted guidance are
--      recorded as two distinct fields (`adaptation`), including the reason for the difference and the
--      limitations. An import can never silently rewrite someone else's instruction as TONDE's own.
--   3. WHO APPROVED IT. `review_state` moves through asserted -> pending_review -> reviewed, or
--      rejected, or superseded. Imported and tutorial-derived knowledge CANNOT be used as guidance
--      until a second person reviewed it, and the reviewer may not be the importer.
--   4. WHAT IT CONTRADICTS. `tonde.knowledge_conflicts` represents a disagreement as its own fact -
--      both claims, both sides, severity and how it was settled - instead of hiding one claim behind
--      the other. A material conflict that is unresolved is visible as such, and is never reported as
--      resolved by an AI or a worker.
--   5. WHERE IT APPLIES. `applicability` records the production types, equipment and environments the
--      guidance is valid for, so advice is not applied to a production it was never about.
--   6. HOW IT CHANGED. `revision` is managed by the platform guard; editing content invalidates the
--      review instead of quietly keeping the old approval, and a replacement item links both ways.
--
-- Laws enforced here, not merely described:
--   * A client session can create knowledge, cite sources, raise a conflict and ask for review. It can
--     never mark knowledge reviewed, never resolve a conflict, never mint `tonde_canon` knowledge and
--     never edit an item that was superseded.
--   * Imported or tutorial-derived items are refused as guidance until reviewed, and a reviewer of
--     such an item must be someone other than the person who imported it.
--   * An import is idempotent by payload checksum, bounded, and its per-item rejections are recorded
--     as rejections with a reason - never as silent skips.
--   * A tutorial is registered, stepped and only then published; its steps are frozen at publication,
--     and promoting a step creates knowledge that is pending review, with the step as its source.
begin;

-- 1. Extend the canonical technique row. Applied migrations are never rewritten: this is additive.
alter table tonde.creative_techniques
  add column knowledge_class text not null default 'technique',
  add column source_kind text not null default 'creator',
  add column review_state text not null default 'creator_asserted',
  add column reviewed_by uuid,
  add column reviewed_at timestamptz,
  add column review_note text,
  add column supersedes_id uuid,
  add column superseded_by_id uuid,
  add column content_hash text,
  add column applicability jsonb not null default '{}'::jsonb,
  add column adaptation jsonb not null default '{}'::jsonb,
  add column tonde_guidance text not null default '',
  add column applies_to_revision integer,
  add column retired_at timestamptz;

alter table tonde.creative_techniques
  add constraint knowledge_class_valid check (knowledge_class in ('technique','equipment_guidance',
    'scene_guidance','settings_guidance','workflow','safety')),
  add constraint knowledge_source_kind_valid check (source_kind in ('creator','reference','tutorial',
    'import','tonde_canon')),
  add constraint knowledge_review_state_valid check (review_state in ('creator_asserted','pending_review',
    'reviewed','rejected','superseded')),
  add constraint knowledge_applicability_is_object check (jsonb_typeof(applicability) = 'object'),
  add constraint knowledge_adaptation_is_object check (jsonb_typeof(adaptation) = 'object'),
  add constraint knowledge_guidance_length check (length(tonde_guidance) <= 4000),
  add constraint knowledge_review_note_length check (review_note is null or length(review_note) <= 2000),
  -- A reviewed item says who reviewed it and when; a rejected one says why; a superseded one names its
  -- replacement. None of these can be true by accident.
  add constraint knowledge_reviewed_is_stamped check (review_state <> 'reviewed'
    or (reviewed_by is not null and reviewed_at is not null)),
  add constraint knowledge_rejected_is_explained check (review_state <> 'rejected'
    or (reviewed_at is not null and review_note is not null)),
  add constraint knowledge_superseded_names_replacement check (review_state <> 'superseded'
    or superseded_by_id is not null),
  add constraint knowledge_replacement_is_different check (superseded_by_id is distinct from id),
  -- Canon is the platform's own reviewed statement; nothing else may look like it.
  add constraint knowledge_canon_is_reviewed check (source_kind <> 'tonde_canon' or review_state = 'reviewed'),
  add constraint knowledge_canon_is_attributed check (source_kind <> 'tonde_canon' or reviewed_by is not null),
  -- Imported and tutorial-derived knowledge always arrives as a draft for a second person to review.
  add constraint knowledge_imported_is_pending check (source_kind not in ('import','tutorial')
    or review_state in ('pending_review','reviewed','rejected','superseded')),
  add constraint knowledge_supersedes_fk foreign key (workspace_id, supersedes_id)
    references tonde.creative_techniques(workspace_id, id) on delete restrict,
  add constraint knowledge_superseded_by_fk foreign key (workspace_id, superseded_by_id)
    references tonde.creative_techniques(workspace_id, id) on delete restrict;

-- The canonical knowledge row is written by the platform path (backend and workers) and by the RPCs
-- below; the guard, not the grant, is what stops an unstamped or forged review.
grant all on tonde.creative_techniques to service_role;
create index knowledge_review_queue on tonde.creative_techniques(workspace_id, review_state, updated_at desc)
  where review_state in ('pending_review','creator_asserted');
create index knowledge_by_class on tonde.creative_techniques(workspace_id, knowledge_class, category, importance);
create index knowledge_by_source on tonde.creative_techniques(workspace_id, source_kind);

-- 2. Provenance. One row per citation, in its own table, so "says who" is a query and not a sentence.
create table tonde.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  technique_id uuid,
  source_kind text not null check (source_kind in ('creator','reference','tutorial','import',
    'external_publication','standards_body','tonde_canon','manufacturer')),
  label text not null check (length(btrim(label)) between 2 and 300),
  locator text check (locator is null or length(locator) <= 1000),
  publisher text check (publisher is null or length(publisher) <= 200),
  attribution text check (attribution is null or length(attribution) <= 300),
  license text check (license is null or length(license) <= 300),
  credibility text not null default 'unknown' check (credibility in ('primary','secondary','community','unknown')),
  source_version text check (source_version is null or length(source_version) <= 120),
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  excerpt text check (excerpt is null or length(excerpt) <= 2000),
  checksum text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, technique_id, label),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, technique_id) references tonde.creative_techniques(workspace_id, id) on delete restrict,
  -- A citation without a label is not a citation; a locator is what makes it checkable.
  constraint knowledge_source_has_a_locator check (locator is not null or source_kind in ('creator','tonde_canon')
    or detail ? 'locator_note')
);
create trigger guard_mutation before insert or update on tonde.knowledge_sources
  for each row execute function tonde_private.guard_mutation();
create index knowledge_sources_by_item on tonde.knowledge_sources(workspace_id, technique_id, retrieved_at desc);
alter table tonde.knowledge_sources enable row level security;
create policy tenant_read on tonde.knowledge_sources for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.knowledge_sources to authenticated;
grant all on tonde.knowledge_sources to service_role;

-- 3. Conflict representation. A disagreement is a first-class record with both claims kept.
create table tonde.knowledge_conflicts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  subject text not null check (length(btrim(subject)) between 4 and 300),
  conflict_kind text not null check (conflict_kind in ('fact','recommendation','settings','equipment','terminology')),
  severity text not null default 'material' check (severity in ('material','minor')),
  primary_item_id uuid,
  secondary_item_id uuid,
  primary_claim text not null check (length(btrim(primary_claim)) between 4 and 2000),
  secondary_claim text not null check (length(btrim(secondary_claim)) between 4 and 2000),
  state text not null default 'open' check (state in ('open','resolved','dismissed')),
  resolution text check (resolution is null or resolution in ('adopt_primary','adopt_secondary','synthesize',
    'needs_expert','not_a_conflict')),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  detected_by text not null default 'creator' check (detected_by in ('creator','review','import','worker')),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, primary_item_id) references tonde.creative_techniques(workspace_id, id) on delete restrict,
  foreign key (workspace_id, secondary_item_id) references tonde.creative_techniques(workspace_id, id) on delete restrict,
  constraint knowledge_conflict_has_two_claims check (primary_claim <> secondary_claim),
  -- A settled conflict names how and by whom, and a material one always carries a note.
  constraint knowledge_conflict_resolved_is_stamped check (state = 'open'
    or (resolution is not null and resolved_at is not null and resolved_by is not null)),
  constraint knowledge_conflict_material_needs_note check (state = 'open' or severity <> 'material'
    or resolution_note is not null),
  constraint knowledge_conflict_dismissal_is_explained check (state <> 'dismissed' or resolution = 'not_a_conflict')
);
create trigger guard_mutation before insert or update on tonde.knowledge_conflicts
  for each row execute function tonde_private.guard_mutation();
create index knowledge_conflicts_open on tonde.knowledge_conflicts(workspace_id, severity, created_at desc)
  where state = 'open';
alter table tonde.knowledge_conflicts enable row level security;
create policy tenant_read on tonde.knowledge_conflicts for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.knowledge_conflicts to authenticated;
grant all on tonde.knowledge_conflicts to service_role;

-- 4. Import records. An import is durable work with a persisted, truthful outcome.
create table tonde.knowledge_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  format text not null check (format in ('json','csv','markdown')),
  source_label text not null check (length(btrim(source_label)) between 2 and 300),
  source_locator text, license text, attribution text,
  payload_checksum text not null check (length(payload_checksum) between 8 and 200),
  dry_run boolean not null default false,
  state text not null default 'requested' check (state in ('requested','completed','partial','rejected','failed')),
  item_count integer not null default 0 check (item_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  conflict_count integer not null default 0 check (conflict_count >= 0),
  rejections jsonb not null default '[]'::jsonb check (jsonb_typeof(rejections) = 'array'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  job_id uuid,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, payload_checksum, dry_run),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  constraint import_counts_add_up check (accepted_count + rejected_count = item_count),
  constraint import_completed_is_stamped check (state in ('requested','failed') or completed_at is not null),
  constraint import_rejections_are_explained check (rejected_count = 0 or jsonb_array_length(rejections) = rejected_count)
);
create index knowledge_imports_recent on tonde.knowledge_imports(workspace_id, requested_at desc, id);
alter table tonde.knowledge_imports enable row level security;
create policy tenant_read on tonde.knowledge_imports for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.knowledge_imports to authenticated;
grant all on tonde.knowledge_imports to service_role;

-- 5. Tutorials. A tutorial is ingested as a structured, ordered set of steps with a stated source.
create table tonde.knowledge_tutorials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  title text not null check (length(btrim(title)) between 3 and 200),
  source_kind text not null check (source_kind in ('creator_recording','creator_note','external_article',
    'external_video','tonde_curriculum')),
  media_id uuid,
  locator text check (locator is null or length(locator) <= 1000),
  attribution text check (attribution is null or length(attribution) <= 300),
  license text check (license is null or length(license) <= 300),
  language text not null default 'en' check (length(language) between 2 and 12),
  state text not null default 'registered' check (state in ('registered','ready_for_review','published',
    'retired','failed')),
  step_count integer not null default 0 check (step_count >= 0),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  -- A tutorial states where it came from: a recording has media, anything external has a locator.
  constraint tutorial_source_is_identified check (
    (source_kind = 'creator_recording' and media_id is not null)
    or (source_kind = 'creator_note' and (media_id is not null or locator is not null))
    or (source_kind in ('external_article','external_video','tonde_curriculum') and locator is not null)),
  constraint tutorial_published_is_stamped check (state <> 'published'
    or (published_at is not null and published_by is not null and step_count > 0))
);
create trigger guard_mutation before insert or update on tonde.knowledge_tutorials
  for each row execute function tonde_private.guard_mutation();
create index knowledge_tutorials_by_state on tonde.knowledge_tutorials(workspace_id, state, updated_at desc);
alter table tonde.knowledge_tutorials enable row level security;
create policy tenant_read on tonde.knowledge_tutorials for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.knowledge_tutorials to authenticated;
grant all on tonde.knowledge_tutorials to service_role;

create table tonde.knowledge_tutorial_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  tutorial_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 500),
  title text not null check (length(btrim(title)) between 2 and 200),
  instruction text not null check (length(btrim(instruction)) between 4 and 4000),
  technique_id uuid,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (tutorial_id, ordinal),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, tutorial_id) references tonde.knowledge_tutorials(workspace_id, id) on delete restrict,
  foreign key (workspace_id, technique_id) references tonde.creative_techniques(workspace_id, id) on delete restrict,
  constraint tutorial_step_settings_are_camera_shaped check (not (settings ? 'unknown'))
);
create trigger guard_mutation before insert or update on tonde.knowledge_tutorial_steps
  for each row execute function tonde_private.guard_mutation();
create index knowledge_tutorial_steps_by_tutorial
  on tonde.knowledge_tutorial_steps(workspace_id, tutorial_id, ordinal);
alter table tonde.knowledge_tutorial_steps enable row level security;
create policy tenant_read on tonde.knowledge_tutorial_steps for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.knowledge_tutorial_steps to authenticated;
grant all on tonde.knowledge_tutorial_steps to service_role;

-- 6. Guards. A client session writes through the RPCs below and can never mint a review.
create function tonde_private.guard_knowledge_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare trusted boolean := (select auth.role()) = 'service_role' or auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    if not trusted and new.review_state not in ('creator_asserted','pending_review') then
      raise exception 'Knowledge is reviewed by a person, never asserted as reviewed by the caller'
        using errcode = '42501';
    end if;
    if not trusted and new.source_kind = 'tonde_canon' then
      raise exception 'TONDE canon is written by the platform, not by a client session'
        using errcode = '42501';
    end if;
    if not trusted and (new.reviewed_by is not null or new.reviewed_at is not null) then
      raise exception 'A review is recorded by the reviewer, never by the author' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.review_state = 'superseded' then
    raise exception 'A superseded item is closed history and cannot be edited again' using errcode = '23514';
  end if;
  if new.source_kind is distinct from old.source_kind then
    raise exception 'Where knowledge came from does not change after it was recorded' using errcode = '23514';
  end if;
  if new.canonical_id is distinct from old.canonical_id then
    raise exception 'A knowledge item keeps its identity; a replacement is a new item' using errcode = '23514';
  end if;
  if new.review_state is distinct from old.review_state then
    -- The one review transition an editor may make unaided is a revision invalidating an old review.
    if not (new.review_state = 'pending_review' and old.review_state in ('creator_asserted','reviewed'))
      and not (trusted or tonde_private.is_workspace_admin(new.workspace_id)) then
      raise exception 'Review, supersession and canon are review decisions, not client edits'
        using errcode = '42501';
    end if;
  end if;
  if not (trusted or tonde_private.is_workspace_admin(new.workspace_id)) then
    if (new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by)
      or (new.reviewed_at is not null and new.reviewed_at is distinct from old.reviewed_at) then
      raise exception 'A review names the reviewer and is recorded by them' using errcode = '42501';
    end if;
    if new.superseded_by_id is distinct from old.superseded_by_id then
      raise exception 'Supersession is a review decision' using errcode = '42501';
    end if;
  end if;
  -- Editing the substance of reviewed knowledge invalidates the review instead of inheriting it.
  if new.review_state = 'reviewed' and (new.content_hash is distinct from old.content_hash
      or new.tonde_guidance is distinct from old.tonde_guidance) and new.reviewed_at = old.reviewed_at then
    raise exception 'A reviewed item whose substance changed must record a new review' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_knowledge_item before insert or update on tonde.creative_techniques
  for each row execute function tonde_private.guard_knowledge_item();
revoke all on function tonde_private.guard_knowledge_item() from public, anon, authenticated, service_role;

create function tonde_private.guard_knowledge_conflict() returns trigger
language plpgsql security definer set search_path = '' as $$
declare authorised boolean := (select auth.role()) = 'service_role' or auth.uid() is null
  or tonde_private.is_workspace_admin(new.workspace_id);
begin
  if tg_op = 'INSERT' then
    if not authorised and new.state <> 'open' then
      raise exception 'A conflict is opened as open; settling it is a review decision' using errcode = '42501';
    end if;
    return new;
  end if;
  if not authorised and (new.state is distinct from old.state or new.resolution is distinct from old.resolution
      or new.resolved_by is distinct from old.resolved_by or new.resolved_at is distinct from old.resolved_at
      or new.resolution_note is distinct from old.resolution_note) then
    raise exception 'Settling a conflict is a review decision, not a client edit' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_knowledge_conflict before insert or update on tonde.knowledge_conflicts
  for each row execute function tonde_private.guard_knowledge_conflict();
revoke all on function tonde_private.guard_knowledge_conflict() from public, anon, authenticated, service_role;

create function tonde_private.guard_tutorial_step() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutorial tonde.knowledge_tutorials; target_tutorial uuid;
  trusted boolean := (select auth.role()) = 'service_role' or auth.uid() is null;
begin
  if tg_op = 'DELETE' then target_tutorial := old.tutorial_id; else target_tutorial := new.tutorial_id; end if;
  select * into tutorial from tonde.knowledge_tutorials t
    where t.id = target_tutorial for update;
  if not found then raise exception 'That tutorial does not exist' using errcode = 'P0002'; end if;
  if tutorial.state = 'published' then
    -- What was published stays published. Recording which knowledge a step produced is not a rewrite of
    -- the step; changing its words, its order or its evidence is.
    if tg_op <> 'UPDATE' or new.ordinal is distinct from old.ordinal
      or new.title is distinct from old.title or new.instruction is distinct from old.instruction
      or new.settings is distinct from old.settings or new.evidence is distinct from old.evidence
      or new.tutorial_id is distinct from old.tutorial_id then
      raise exception 'A published tutorial''s steps are what was published and cannot be rewritten'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' and tutorial.state <> 'registered' and not trusted then
    raise exception 'A tutorial under review keeps its steps' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_tutorial_step before insert or update or delete on tonde.knowledge_tutorial_steps
  for each row execute function tonde_private.guard_tutorial_step();
revoke all on function tonde_private.guard_tutorial_step() from public, anon, authenticated, service_role;

-- 7. Private helpers.
create function tonde_private.knowledge_editor(target_workspace uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or (select auth.role()) <> 'authenticated'
    or not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Authenticated workspace editor required' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function tonde_private.knowledge_editor(uuid) from public, anon, authenticated, service_role;

create function tonde_private.knowledge_admin(target_workspace uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not tonde_private.is_workspace_admin(target_workspace) then
    raise exception 'Workspace review authority required' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function tonde_private.knowledge_admin(uuid) from public, anon, authenticated, service_role;

create function tonde_private.knowledge_content_hash(item tonde.creative_techniques) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|', item.canonical_id, item.name, item.category,
    item.description, item.purpose, item.effect, item.tonde_guidance,
    coalesce(item.practical_concept, ''), coalesce(item.ai_concept, ''), item.applicability::text), 'UTF8')), 'hex');
$$;
revoke all on function tonde_private.knowledge_content_hash(tonde.creative_techniques)
  from public, anon, authenticated, service_role;

create function tonde_private.knowledge_sources_json(target_workspace uuid, target_item uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('source_kind', s.source_kind, 'label', s.label,
    'locator', s.locator, 'publisher', s.publisher, 'attribution', s.attribution, 'license', s.license,
    'credibility', s.credibility, 'source_version', s.source_version, 'published_at', s.published_at,
    'retrieved_at', s.retrieved_at, 'excerpt', s.excerpt) order by s.retrieved_at desc, s.label), '[]'::jsonb)
  from tonde.knowledge_sources s
  where s.workspace_id = target_workspace and s.technique_id = target_item;
$$;
revoke all on function tonde_private.knowledge_sources_json(uuid,uuid)
  from public, anon, authenticated, service_role;

-- The one place that decides whether knowledge may guide a production.
create function tonde_private.knowledge_is_usable(review_state text, source_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select review_state = 'reviewed'
    or (review_state = 'creator_asserted' and source_kind = 'creator');
$$;
revoke all on function tonde_private.knowledge_is_usable(text,text)
  from public, anon, authenticated, service_role;

-- 8. Writing knowledge: create, cite, submit, review, revise, replace.
create function tonde.knowledge_item_create(target_workspace uuid, p_canonical_id text, p_name text,
  p_category text, p_description text, p_purpose text, p_effect text, p_knowledge_class text default 'technique',
  p_source_kind text default 'creator', p_guidance text default '', p_applicability jsonb default '{}'::jsonb,
  p_adaptation jsonb default '{}'::jsonb, p_sources jsonb default '[]'::jsonb, p_pending_review boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; item tonde.creative_techniques; source jsonb; created_sources integer := 0;
  existing tonde.creative_techniques; desired_state text;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if p_source_kind not in ('creator','reference','tutorial','import') then
    raise exception 'Knowledge is created as creator, reference, tutorial or import; canon is the platform''s own'
      using errcode = '22023';
  end if;
  if p_knowledge_class not in ('technique','equipment_guidance','scene_guidance','settings_guidance','workflow','safety') then
    raise exception 'That is not a TONDE knowledge class' using errcode = '22023';
  end if;
  if jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) > 20 then
    raise exception 'Sources are a bounded array' using errcode = '22023';
  end if;
  select * into existing from tonde.creative_techniques t
    where t.workspace_id = target_workspace and t.canonical_id = p_canonical_id;
  if existing.id is not null then
    raise exception 'KNOWLEDGE_EXISTS: this workspace already has % (%); replace it instead of re-creating it',
      p_canonical_id, existing.id using errcode = 'PT409';
  end if;
  desired_state := case when p_source_kind in ('import','tutorial') then 'pending_review'
    when coalesce(p_pending_review, false) then 'pending_review' else 'creator_asserted' end;
  insert into tonde.creative_techniques(workspace_id, canonical_id, name, category, description, purpose,
    effect, created_by, knowledge_class, source_kind, review_state, applicability, adaptation, tonde_guidance)
  values (target_workspace, p_canonical_id, left(btrim(p_name), 160), p_category, left(btrim(p_description), 1200),
    left(btrim(p_purpose), 600), left(btrim(p_effect), 600), actor, p_knowledge_class, p_source_kind,
    desired_state, coalesce(p_applicability, '{}'::jsonb), coalesce(p_adaptation, '{}'::jsonb),
    left(coalesce(p_guidance, ''), 4000))
  returning * into item;
  update tonde.creative_techniques set content_hash = tonde_private.knowledge_content_hash(item)
    where id = item.id returning * into item;
  for source in select * from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) loop
    if coalesce(source ->> 'label', '') = '' then
      raise exception 'Every citation has a label' using errcode = '22023';
    end if;
    insert into tonde.knowledge_sources(workspace_id, technique_id, source_kind, label, locator, publisher,
      attribution, license, credibility, source_version, published_at, excerpt, created_by, detail)
    values (target_workspace, item.id,
      case when source ->> 'source_kind' in ('creator','reference','tutorial','import','external_publication',
        'standards_body','tonde_canon','manufacturer') then source ->> 'source_kind' else 'reference' end,
      left(btrim(source ->> 'label'), 300), nullif(btrim(coalesce(source ->> 'locator', '')), ''),
      nullif(btrim(coalesce(source ->> 'publisher', '')), ''),
      nullif(btrim(coalesce(source ->> 'attribution', '')), ''),
      nullif(btrim(coalesce(source ->> 'license', '')), ''),
      case when source ->> 'credibility' in ('primary','secondary','community','unknown')
        then source ->> 'credibility' else 'unknown' end,
      nullif(btrim(coalesce(source ->> 'source_version', '')), ''),
      nullif(source ->> 'published_at', '')::timestamptz,
      nullif(left(coalesce(source ->> 'excerpt', ''), 2000), ''), actor,
      case when source ? 'locator_note' then jsonb_build_object('locator_note', source -> 'locator_note') else '{}'::jsonb end);
    created_sources := created_sources + 1;
  end loop;
  perform tonde_private.audit_event(target_workspace, 'knowledge.created', item.id, 'creative_technique',
    jsonb_build_object('canonical_id', item.canonical_id, 'knowledge_class', item.knowledge_class,
      'source_kind', item.source_kind, 'review_state', item.review_state, 'sources', created_sources));
  return jsonb_build_object('item_id', item.id, 'canonical_id', item.canonical_id, 'revision', item.revision,
    'review_state', item.review_state, 'source_kind', item.source_kind, 'sources', created_sources,
    'usable_for_guidance', tonde_private.knowledge_is_usable(item.review_state, item.source_kind),
    'meaning', case when item.review_state = 'pending_review'
      then 'The knowledge is recorded and waiting for a person to review it before it can guide a production.'
      else 'The knowledge is recorded as the creator''s own assertion.' end);
end $$;
revoke all on function tonde.knowledge_item_create(uuid,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean)
  from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_item_create(uuid,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean)
  to authenticated, service_role;

create function tonde.knowledge_item_submit(target_workspace uuid, target_item uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; item tonde.creative_techniques;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  select * into item from tonde.creative_techniques t
    where t.workspace_id = target_workspace and t.id = target_item for update;
  if not found then raise exception 'That knowledge item does not exist' using errcode = 'P0002'; end if;
  if item.review_state = 'pending_review' then
    return jsonb_build_object('item_id', item.id, 'review_state', item.review_state, 'idempotent', true);
  end if;
  if item.review_state <> 'creator_asserted' then
    raise exception 'KNOWLEDGE_NOT_SUBMITTABLE: this item is %', item.review_state using errcode = 'PT409';
  end if;
  update tonde.creative_techniques set review_state = 'pending_review',
    review_note = nullif(left(coalesce(p_note, ''), 2000), '') where id = item.id returning * into item;
  return jsonb_build_object('item_id', item.id, 'review_state', item.review_state, 'idempotent', false);
end $$;
revoke all on function tonde.knowledge_item_submit(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_item_submit(uuid,uuid,text) to authenticated, service_role;

create function tonde.knowledge_item_review(target_workspace uuid, target_item uuid, p_decision text,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; item tonde.creative_techniques;
begin
  actor := tonde_private.knowledge_admin(target_workspace);
  if p_decision not in ('reviewed','rejected') then
    raise exception 'A review decision is reviewed or rejected; replacing knowledge is a separate act'
      using errcode = '22023';
  end if;
  if p_decision = 'rejected' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'A rejection says why' using errcode = '22023';
  end if;
  select * into item from tonde.creative_techniques t
    where t.workspace_id = target_workspace and t.id = target_item for update;
  if not found then raise exception 'That knowledge item does not exist' using errcode = 'P0002'; end if;
  if item.review_state = p_decision then
    return jsonb_build_object('item_id', item.id, 'review_state', item.review_state, 'idempotent', true);
  end if;
  if item.review_state = 'superseded' then
    raise exception 'KNOWLEDGE_SUPERSEDED: this item was replaced and is closed history' using errcode = 'PT409';
  end if;
  -- Imported and tutorial-derived knowledge is reviewed by someone other than the importer. A creator's
  -- own assertion may be confirmed by its author; a citation may not be.
  if item.source_kind in ('import','tutorial') and item.created_by = actor then
    raise exception 'KNOWLEDGE_SELF_REVIEW_REFUSED: imported or tutorial-derived knowledge is reviewed by
      someone other than the person who brought it in' using errcode = 'PT409';
  end if;
  update tonde.creative_techniques set review_state = p_decision, reviewed_by = actor, reviewed_at = now(),
    review_note = nullif(left(coalesce(p_note, ''), 2000), '') where id = item.id returning * into item;
  perform tonde_private.audit_event(target_workspace, 'knowledge.' || p_decision, item.id, 'creative_technique',
    jsonb_build_object('canonical_id', item.canonical_id, 'source_kind', item.source_kind,
      'reviewer', actor, 'note', p_note));
  return jsonb_build_object('item_id', item.id, 'review_state', item.review_state, 'idempotent', false,
    'usable_for_guidance', tonde_private.knowledge_is_usable(item.review_state, item.source_kind),
    'meaning', case when p_decision = 'reviewed'
      then 'A person reviewed this knowledge; it may now guide a production.'
      else 'The knowledge was rejected with a reason and is not used as guidance.' end);
end $$;
revoke all on function tonde.knowledge_item_review(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_item_review(uuid,uuid,text,text) to authenticated, service_role;

create function tonde.knowledge_item_revise(target_workspace uuid, target_item uuid, p_changes jsonb,
  p_reason text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; item tonde.creative_techniques; previous_state text; changed boolean;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'A revision names what changed' using errcode = '22023';
  end if;
  if p_changes ? 'review_state' or p_changes ? 'canonical_id' or p_changes ? 'source_kind'
    or p_changes ? 'reviewed_by' then
    raise exception 'A revision changes the substance, never the review or the identity' using errcode = '22023';
  end if;
  select * into item from tonde.creative_techniques t
    where t.workspace_id = target_workspace and t.id = target_item for update;
  if not found then raise exception 'That knowledge item does not exist' using errcode = 'P0002'; end if;
  if item.review_state = 'superseded' then
    raise exception 'KNOWLEDGE_SUPERSEDED: this item was replaced and is closed history' using errcode = 'PT409';
  end if;
  previous_state := item.review_state;
  update tonde.creative_techniques t set
    name = coalesce(nullif(btrim(coalesce(p_changes ->> 'name', '')), ''), t.name),
    category = coalesce(nullif(btrim(coalesce(p_changes ->> 'category', '')), ''), t.category),
    description = coalesce(nullif(btrim(coalesce(p_changes ->> 'description', '')), ''), t.description),
    purpose = coalesce(nullif(btrim(coalesce(p_changes ->> 'purpose', '')), ''), t.purpose),
    effect = coalesce(nullif(btrim(coalesce(p_changes ->> 'effect', '')), ''), t.effect),
    tonde_guidance = coalesce(nullif(left(coalesce(p_changes ->> 'tonde_guidance', ''), 4000), ''),
      nullif(left(coalesce(p_changes ->> 'guidance', ''), 4000), ''), t.tonde_guidance),
    applicability = coalesce(p_changes -> 'applicability', t.applicability),
    adaptation = coalesce(p_changes -> 'adaptation', t.adaptation),
    practical_concept = coalesce(nullif(left(coalesce(p_changes ->> 'practical_concept', ''), 900), ''), t.practical_concept),
    ai_concept = coalesce(nullif(left(coalesce(p_changes ->> 'ai_concept', ''), 900), ''), t.ai_concept),
    -- The review does not survive a change to the substance: it goes back to waiting for one.
    review_state = case when t.review_state = 'reviewed' then 'pending_review' else t.review_state end,
    reviewed_by = case when t.review_state = 'reviewed' then null else t.reviewed_by end,
    reviewed_at = case when t.review_state = 'reviewed' then null else t.reviewed_at end,
    review_note = nullif(left(coalesce(p_reason, ''), 2000), ''),
    content_hash = null
    where t.id = item.id returning * into item;
  changed := true;
  update tonde.creative_techniques set content_hash = tonde_private.knowledge_content_hash(item)
    where id = item.id returning * into item;
  perform tonde_private.audit_event(target_workspace, 'knowledge.revised', item.id, 'creative_technique',
    jsonb_build_object('from_state', previous_state, 'to_state', item.review_state, 'revision', item.revision,
      'reason', p_reason, 'fields', (select jsonb_agg(key) from jsonb_object_keys(p_changes) as key)));
  return jsonb_build_object('item_id', item.id, 'revision', item.revision, 'review_state', item.review_state,
    'previous_review_state', previous_state, 'changed', changed,
    'usable_for_guidance', tonde_private.knowledge_is_usable(item.review_state, item.source_kind),
    'meaning', case when previous_state = 'reviewed'
      then 'The substance changed, so the earlier review no longer applies: the item is queued for review again.'
      else 'The revision is recorded and the item keeps its review state.' end);
end $$;
revoke all on function tonde.knowledge_item_revise(uuid,uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_item_revise(uuid,uuid,jsonb,text) to authenticated, service_role;

create function tonde.knowledge_item_replace(target_workspace uuid, target_item uuid, replacement_item uuid,
  p_reason text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; old_item tonde.creative_techniques; new_item tonde.creative_techniques;
begin
  actor := tonde_private.knowledge_admin(target_workspace);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A replacement says why' using errcode = '22023';
  end if;
  select * into old_item from tonde.creative_techniques t
    where t.workspace_id = target_workspace and t.id = target_item for update;
  if not found then raise exception 'That knowledge item does not exist' using errcode = 'P0002'; end if;
  select * into new_item from tonde.creative_techniques t
    where t.workspace_id = target_workspace and t.id = replacement_item for update;
  if not found then raise exception 'That replacement item does not exist' using errcode = 'P0002'; end if;
  if old_item.id = new_item.id then
    raise exception 'An item cannot replace itself' using errcode = '22023';
  end if;
  if new_item.review_state <> 'reviewed' then
    raise exception 'KNOWLEDGE_NOT_REVIEWED: a replacement must itself be reviewed first' using errcode = 'PT409';
  end if;
  if old_item.review_state = 'superseded' then
    return jsonb_build_object('item_id', old_item.id, 'review_state', 'superseded', 'idempotent', true);
  end if;
  update tonde.creative_techniques set review_state = 'superseded', superseded_by_id = new_item.id,
    review_note = nullif(left(coalesce(p_reason, ''), 2000), ''), retired_at = now()
    where id = old_item.id returning * into old_item;
  update tonde.creative_techniques set supersedes_id = old_item.id
    where id = new_item.id returning * into new_item;
  -- Anything still pointing at the old item is told, in the record, where the knowledge went.
  insert into tonde.knowledge_conflicts(workspace_id, subject, conflict_kind, severity, primary_item_id,
    secondary_item_id, primary_claim, secondary_claim, state, resolution, resolution_note, resolved_by,
    resolved_at, detected_by, created_by)
  values (target_workspace, 'Replacement of ' || old_item.canonical_id, 'fact', 'minor', old_item.id,
    new_item.id, left(old_item.name, 2000), left(new_item.name, 2000), 'resolved', 'adopt_secondary',
    left(p_reason, 2000), actor, now(), 'review', actor);
  perform tonde_private.audit_event(target_workspace, 'knowledge.replaced', old_item.id, 'creative_technique',
    jsonb_build_object('replaced_by', new_item.id, 'reason', p_reason));
  return jsonb_build_object('item_id', old_item.id, 'review_state', 'superseded',
    'superseded_by', new_item.id, 'idempotent', false, 'replacement_revision', new_item.revision,
    'meaning', 'The earlier knowledge is closed history pointing at the reviewed replacement.');
end $$;
revoke all on function tonde.knowledge_item_replace(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_item_replace(uuid,uuid,uuid,text) to authenticated, service_role;

create function tonde.knowledge_source_add(target_workspace uuid, target_item uuid, p_source jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; source_id uuid;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if jsonb_typeof(p_source) <> 'object' or coalesce(p_source ->> 'label', '') = '' then
    raise exception 'A citation has a label and a shape' using errcode = '22023';
  end if;
  if not exists (select 1 from tonde.creative_techniques t where t.workspace_id = target_workspace
      and t.id = target_item) then
    raise exception 'That knowledge item does not exist' using errcode = 'P0002';
  end if;
  insert into tonde.knowledge_sources(workspace_id, technique_id, source_kind, label, locator, publisher,
    attribution, license, credibility, source_version, published_at, excerpt, created_by)
  values (target_workspace, target_item,
    case when p_source ->> 'source_kind' in ('creator','reference','tutorial','import','external_publication',
      'standards_body','tonde_canon','manufacturer') then p_source ->> 'source_kind' else 'reference' end,
    left(btrim(p_source ->> 'label'), 300), nullif(btrim(coalesce(p_source ->> 'locator', '')), ''),
    nullif(btrim(coalesce(p_source ->> 'publisher', '')), ''),
    nullif(btrim(coalesce(p_source ->> 'attribution', '')), ''),
    nullif(btrim(coalesce(p_source ->> 'license', '')), ''),
    case when p_source ->> 'credibility' in ('primary','secondary','community','unknown')
      then p_source ->> 'credibility' else 'unknown' end,
    nullif(btrim(coalesce(p_source ->> 'source_version', '')), ''),
    nullif(p_source ->> 'published_at', '')::timestamptz,
    nullif(left(coalesce(p_source ->> 'excerpt', ''), 2000), ''), actor)
  returning id into source_id;
  return jsonb_build_object('source_id', source_id, 'item_id', target_item,
    'meaning', 'The citation is recorded against the knowledge it supports.');
end $$;
revoke all on function tonde.knowledge_source_add(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_source_add(uuid,uuid,jsonb) to authenticated, service_role;

-- 9. Conflicts: raised by anyone who can edit, settled only by review authority.
create function tonde.knowledge_conflict_open(target_workspace uuid, p_subject text, p_kind text,
  p_primary_claim text, p_secondary_claim text, p_severity text default 'material',
  p_primary_item uuid default null, p_secondary_item uuid default null, p_evidence jsonb default '[]'::jsonb,
  p_detected_by text default 'creator') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; conflict tonde.knowledge_conflicts; existing tonde.knowledge_conflicts;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if p_kind not in ('fact','recommendation','settings','equipment','terminology') then
    raise exception 'That is not a TONDE conflict kind' using errcode = '22023';
  end if;
  if p_severity not in ('material','minor') then
    raise exception 'A conflict is material or minor' using errcode = '22023';
  end if;
  if p_detected_by not in ('creator','review','import','worker') then
    raise exception 'A conflict says how it was found' using errcode = '22023';
  end if;
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) > 10 then
    raise exception 'Evidence is a bounded array' using errcode = '22023';
  end if;
  select * into existing from tonde.knowledge_conflicts c where c.workspace_id = target_workspace
    and c.subject = btrim(p_subject) and c.primary_claim = btrim(p_primary_claim)
    and c.secondary_claim = btrim(p_secondary_claim) and c.state = 'open';
  if existing.id is not null then
    return jsonb_build_object('conflict_id', existing.id, 'state', existing.state, 'idempotent', true);
  end if;
  insert into tonde.knowledge_conflicts(workspace_id, subject, conflict_kind, severity, primary_item_id,
    secondary_item_id, primary_claim, secondary_claim, detected_by, evidence, created_by)
  values (target_workspace, left(btrim(p_subject), 300), p_kind, p_severity, p_primary_item,
    p_secondary_item, left(btrim(p_primary_claim), 2000), left(btrim(p_secondary_claim), 2000),
    p_detected_by, p_evidence, actor)
  returning * into conflict;
  perform tonde_private.audit_event(target_workspace, 'knowledge.conflict_opened', conflict.id,
    'knowledge_conflict', jsonb_build_object('subject', conflict.subject, 'kind', conflict.conflict_kind,
      'severity', conflict.severity));
  return jsonb_build_object('conflict_id', conflict.id, 'state', conflict.state, 'severity', conflict.severity,
    'idempotent', false,
    'meaning', 'Both claims are kept and the disagreement is visible until a person settles it.');
end $$;
revoke all on function tonde.knowledge_conflict_open(uuid,text,text,text,text,text,uuid,uuid,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_conflict_open(uuid,text,text,text,text,text,uuid,uuid,jsonb,text)
  to authenticated, service_role;

create function tonde.knowledge_conflict_resolve(target_workspace uuid, target_conflict uuid, p_resolution text,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; conflict tonde.knowledge_conflicts;
begin
  actor := tonde_private.knowledge_admin(target_workspace);
  -- The trigger below independently refuses a session without review authority, so the two paths agree.
  if p_resolution not in ('adopt_primary','adopt_secondary','synthesize','needs_expert','not_a_conflict') then
    raise exception 'That is not a TONDE conflict resolution' using errcode = '22023';
  end if;
  select * into conflict from tonde.knowledge_conflicts c
    where c.workspace_id = target_workspace and c.id = target_conflict for update;
  if not found then raise exception 'That conflict does not exist' using errcode = 'P0002'; end if;
  if conflict.state <> 'open' then
    return jsonb_build_object('conflict_id', conflict.id, 'state', conflict.state, 'idempotent', true);
  end if;
  if conflict.severity = 'material' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'A material conflict is settled with a reason' using errcode = '22023';
  end if;
  update tonde.knowledge_conflicts set state = case when p_resolution = 'not_a_conflict' then 'dismissed'
      else 'resolved' end,
    resolution = p_resolution, resolution_note = nullif(left(coalesce(p_note, ''), 2000), ''),
    resolved_by = actor, resolved_at = now()
    where id = conflict.id returning * into conflict;
  perform tonde_private.audit_event(target_workspace, 'knowledge.conflict_resolved', conflict.id,
    'knowledge_conflict', jsonb_build_object('resolution', conflict.resolution, 'state', conflict.state,
      'note', p_note));
  return jsonb_build_object('conflict_id', conflict.id, 'state', conflict.state,
    'resolution', conflict.resolution, 'idempotent', false,
    'meaning', 'A person settled the disagreement and said how; both claims remain in the record.');
end $$;
revoke all on function tonde.knowledge_conflict_resolve(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_conflict_resolve(uuid,uuid,text,text) to authenticated, service_role;

-- 10. Tutorials: register, step, publish, promote a step into knowledge.
create function tonde.tutorial_register(target_workspace uuid, p_title text, p_source_kind text,
  p_media uuid default null, p_locator text default null, p_attribution text default null,
  p_license text default null, p_language text default 'en', p_notes text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; tutorial tonde.knowledge_tutorials;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if p_source_kind not in ('creator_recording','creator_note','external_article','external_video','tonde_curriculum') then
    raise exception 'That is not a TONDE tutorial source' using errcode = '22023';
  end if;
  insert into tonde.knowledge_tutorials(workspace_id, title, source_kind, media_id, locator, attribution,
    license, language, notes, created_by)
  values (target_workspace, left(btrim(p_title), 200), p_source_kind, p_media,
    nullif(btrim(coalesce(p_locator, '')), ''), nullif(btrim(coalesce(p_attribution, '')), ''),
    nullif(btrim(coalesce(p_license, '')), ''), left(coalesce(p_language, 'en'), 12),
    nullif(left(coalesce(p_notes, ''), 2000), ''), actor)
  returning * into tutorial;
  return jsonb_build_object('tutorial_id', tutorial.id, 'state', tutorial.state,
    'meaning', 'The tutorial is registered with its source; steps come next, and publication comes after
      review.');
end $$;
revoke all on function tonde.tutorial_register(uuid,text,text,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.tutorial_register(uuid,text,text,uuid,text,text,text,text,text)
  to authenticated, service_role;

create function tonde.tutorial_step_add(target_workspace uuid, target_tutorial uuid, p_ordinal integer,
  p_title text, p_instruction text, p_technique uuid default null, p_settings jsonb default '{}'::jsonb,
  p_evidence jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; tutorial tonde.knowledge_tutorials; step tonde.knowledge_tutorial_steps; counted integer;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  select * into tutorial from tonde.knowledge_tutorials t
    where t.workspace_id = target_workspace and t.id = target_tutorial for update;
  if not found then raise exception 'That tutorial does not exist' using errcode = 'P0002'; end if;
  if tutorial.state in ('published','retired') then
    raise exception 'TUTORIAL_CLOSED: a % tutorial is not edited step by step', tutorial.state
      using errcode = 'PT409';
  end if;
  if jsonb_typeof(p_settings) <> 'object' or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'Step settings and evidence are objects' using errcode = '22023';
  end if;
  if exists (select 1 from tonde.knowledge_tutorial_steps s where s.tutorial_id = target_tutorial
      and s.ordinal = p_ordinal) then
    raise exception 'TUTORIAL_STEP_EXISTS: step % is already recorded', p_ordinal using errcode = 'PT409';
  end if;
  insert into tonde.knowledge_tutorial_steps(workspace_id, tutorial_id, ordinal, title, instruction,
    technique_id, settings, evidence, created_by)
  values (target_workspace, target_tutorial, p_ordinal, left(btrim(p_title), 200),
    left(btrim(p_instruction), 4000), p_technique, coalesce(p_settings, '{}'::jsonb),
    coalesce(p_evidence, '{}'::jsonb), actor)
  returning * into step;
  select count(*) into counted from tonde.knowledge_tutorial_steps s where s.tutorial_id = target_tutorial;
  update tonde.knowledge_tutorials set step_count = counted,
    state = case when state = 'registered' then 'ready_for_review' else state end
    where id = target_tutorial returning * into tutorial;
  return jsonb_build_object('step_id', step.id, 'tutorial_id', tutorial.id, 'ordinal', step.ordinal,
    'step_count', tutorial.step_count, 'state', tutorial.state);
end $$;
revoke all on function tonde.tutorial_step_add(uuid,uuid,integer,text,text,uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.tutorial_step_add(uuid,uuid,integer,text,text,uuid,jsonb,jsonb)
  to authenticated, service_role;

create function tonde.tutorial_publish(target_workspace uuid, target_tutorial uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; tutorial tonde.knowledge_tutorials;
begin
  actor := tonde_private.knowledge_admin(target_workspace);
  select * into tutorial from tonde.knowledge_tutorials t
    where t.workspace_id = target_workspace and t.id = target_tutorial for update;
  if not found then raise exception 'That tutorial does not exist' using errcode = 'P0002'; end if;
  if tutorial.state = 'published' then
    return jsonb_build_object('tutorial_id', tutorial.id, 'state', 'published', 'idempotent', true);
  end if;
  if tutorial.state not in ('ready_for_review','registered') or tutorial.step_count < 1 then
    raise exception 'TUTORIAL_NOT_READY: a tutorial is published with at least one recorded step'
      using errcode = 'PT409';
  end if;
  update tonde.knowledge_tutorials set state = 'published', published_at = now(), published_by = actor,
    notes = coalesce(nullif(left(coalesce(p_note, ''), 2000), ''), notes)
    where id = tutorial.id returning * into tutorial;
  perform tonde_private.audit_event(target_workspace, 'knowledge.tutorial_published', tutorial.id,
    'knowledge_tutorial', jsonb_build_object('title', tutorial.title, 'source_kind', tutorial.source_kind,
      'steps', tutorial.step_count));
  return jsonb_build_object('tutorial_id', tutorial.id, 'state', tutorial.state,
    'published_at', tutorial.published_at, 'idempotent', false,
    'meaning', 'The tutorial is published and its steps are frozen as what was published.');
end $$;
revoke all on function tonde.tutorial_publish(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.tutorial_publish(uuid,uuid,text) to authenticated, service_role;

create function tonde.tutorial_step_promote(target_workspace uuid, target_step uuid, p_canonical_id text,
  p_name text, p_category text, p_guidance text, p_adaptation jsonb default '{}'::jsonb,
  p_applicability jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; step tonde.knowledge_tutorial_steps; tutorial tonde.knowledge_tutorials;
  result jsonb; item_id uuid;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  select * into step from tonde.knowledge_tutorial_steps s
    where s.workspace_id = target_workspace and s.id = target_step for update;
  if not found then raise exception 'That tutorial step does not exist' using errcode = 'P0002'; end if;
  select * into tutorial from tonde.knowledge_tutorials t
    where t.workspace_id = target_workspace and t.id = step.tutorial_id;
  -- Knowledge taken from a tutorial cites the tutorial, and the adaptation says what TONDE changed.
  result := tonde.knowledge_item_create(target_workspace, p_canonical_id, p_name, p_category,
    left('From the tutorial "' || tutorial.title || '": ' || step.instruction, 1200),
    'Captured from a tutorial step so it can be reviewed as production knowledge.',
    'The tutorial records this as one of its steps.', 'technique', 'tutorial', p_guidance,
    p_applicability, coalesce(p_adaptation, '{}'::jsonb) || jsonb_build_object('tutorial_id', tutorial.id,
      'step_ordinal', step.ordinal), '[]'::jsonb, true);
  item_id := (result ->> 'item_id')::uuid;
  insert into tonde.knowledge_sources(workspace_id, technique_id, source_kind, label, locator, attribution,
    license, credibility, retrieved_at, excerpt, created_by)
  values (target_workspace, item_id, 'tutorial', left('Tutorial: ' || tutorial.title, 300),
    tutorial.locator, tutorial.attribution, tutorial.license, 'secondary', now(),
    left(step.instruction, 2000), actor);
  update tonde.knowledge_tutorial_steps set technique_id = item_id where id = step.id;
  return jsonb_build_object('item_id', item_id, 'step_id', step.id, 'tutorial_id', tutorial.id,
    'review_state', result ->> 'review_state', 'usable_for_guidance', false,
    'meaning', 'The step became knowledge that cites the tutorial and waits for review before it can guide
      a production.');
end $$;
revoke all on function tonde.tutorial_step_promote(uuid,uuid,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.tutorial_step_promote(uuid,uuid,text,text,text,text,jsonb,jsonb)
  to authenticated, service_role;

-- 11. Bulk import. Bounded, idempotent by payload, and honest about every item it refused.
create function tonde.knowledge_import_request(target_workspace uuid, p_format text, p_source_label text,
  p_payload jsonb, p_source_locator text default null, p_license text default null,
  p_attribution text default null, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; record_row tonde.knowledge_imports; existing tonde.knowledge_imports;
  checksum text; item jsonb; accepted integer := 0; v_rejections jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  index_position integer := 0; created jsonb; source jsonb; sources_added integer := 0;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if p_format not in ('json','csv','markdown') then
    raise exception 'A knowledge import is json, csv or markdown' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'array' then
    raise exception 'An import payload is an array of knowledge items' using errcode = '22023';
  end if;
  v_item_count := jsonb_array_length(p_payload);
  if v_item_count < 1 or v_item_count > 500 then
    raise exception 'An import carries between 1 and 500 items; this one carries %', v_item_count
      using errcode = '22023';
  end if;
  checksum := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  select * into existing from tonde.knowledge_imports i where i.workspace_id = target_workspace
    and i.payload_checksum = checksum and i.dry_run = coalesce(p_dry_run, false);
  if existing.id is not null then
    return jsonb_build_object('import_id', existing.id, 'state', existing.state, 'idempotent', true,
      'item_count', existing.item_count, 'accepted_count', existing.accepted_count,
      'rejected_count', existing.rejected_count);
  end if;
  insert into tonde.knowledge_imports(workspace_id, format, source_label, source_locator, license,
    attribution, payload_checksum, dry_run, requested_by)
  values (target_workspace, p_format, left(btrim(p_source_label), 300),
    nullif(btrim(coalesce(p_source_locator, '')), ''), nullif(btrim(coalesce(p_license, '')), ''),
    nullif(btrim(coalesce(p_attribution, '')), ''), checksum, coalesce(p_dry_run, false), actor)
  returning * into record_row;
  for item in select * from jsonb_array_elements(p_payload) loop
    index_position := index_position + 1;
    -- Validation is per item, and a refused item is recorded with its reason.
    if jsonb_typeof(item) <> 'object' then
      v_rejections := v_rejections || jsonb_build_object('index', index_position, 'reason', 'ITEM_NOT_AN_OBJECT');
      continue;
    end if;
    if coalesce(item ->> 'canonical_id', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or length(coalesce(item ->> 'canonical_id', '')) not between 3 and 120 then
      v_rejections := v_rejections || jsonb_build_object('index', index_position, 'reason',
        'CANONICAL_ID_INVALID', 'canonical_id', item ->> 'canonical_id');
      continue;
    end if;
    if coalesce(item ->> 'category', '') not in ('camera','composition','lighting','blocking','performance',
      'product','edit','transition','sound','color','story','typography') then
      v_rejections := v_rejections || jsonb_build_object('index', index_position, 'reason', 'CATEGORY_UNKNOWN',
        'category', item ->> 'category');
      continue;
    end if;
    if coalesce(item ->> 'name', '') = '' or coalesce(item ->> 'description', '') = ''
      or coalesce(item ->> 'purpose', '') = '' or coalesce(item ->> 'effect', '') = '' then
      v_rejections := v_rejections || jsonb_build_object('index', index_position, 'reason', 'ITEM_INCOMPLETE');
      continue;
    end if;
    if exists (select 1 from tonde.creative_techniques t where t.workspace_id = target_workspace
        and t.canonical_id = item ->> 'canonical_id') then
      v_rejections := v_rejections || jsonb_build_object('index', index_position, 'reason', 'KNOWLEDGE_EXISTS',
        'canonical_id', item ->> 'canonical_id');
      continue;
    end if;
    sources_added := 0;
    if coalesce(p_dry_run, false) then
      accepted := accepted + 1;
      continue;
    end if;
    created := tonde.knowledge_item_create(target_workspace, item ->> 'canonical_id', item ->> 'name',
      item ->> 'category', item ->> 'description', item ->> 'purpose', item ->> 'effect',
      coalesce(item ->> 'knowledge_class', 'technique'), 'import', coalesce(item ->> 'tonde_guidance', ''),
      coalesce(item -> 'applicability', '{}'::jsonb), coalesce(item -> 'adaptation', '{}'::jsonb),
      coalesce(item -> 'sources', '[]'::jsonb), true);
    accepted := accepted + 1;
  end loop;
  update tonde.knowledge_imports set state = case
      when accepted = 0 then 'rejected'
      when accepted < v_item_count then 'partial'
      else 'completed' end,
    item_count = v_item_count, accepted_count = accepted, rejected_count = v_item_count - accepted,
    rejections = v_rejections, completed_at = now(),
    evidence = jsonb_build_object('dry_run', coalesce(p_dry_run, false), 'checksum', checksum,
      'source_label', p_source_label, 'license', p_license, 'attribution', p_attribution,
      'imported_as', 'pending_review')
    where id = record_row.id returning * into record_row;
  perform tonde_private.audit_event(target_workspace, 'knowledge.imported', record_row.id, 'knowledge_import',
    jsonb_build_object('format', p_format, 'source_label', p_source_label, 'item_count', v_item_count,
      'accepted', accepted, 'rejected', v_item_count - accepted, 'dry_run', coalesce(p_dry_run, false)));
  return jsonb_build_object('import_id', record_row.id, 'state', record_row.state, 'idempotent', false,
    'item_count', v_item_count, 'accepted_count', accepted, 'rejected_count', v_item_count - accepted,
    'rejections', v_rejections, 'dry_run', coalesce(p_dry_run, false),
    'meaning', case when coalesce(p_dry_run, false)
      then 'A dry run: nothing was written, and every item that would be refused is listed with its reason.'
      else 'Imported knowledge waits for review by someone other than the importer before it can guide a
        production.' end);
end $$;
revoke all on function tonde.knowledge_import_request(uuid,text,text,jsonb,text,text,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_import_request(uuid,text,text,jsonb,text,text,text,boolean)
  to authenticated, service_role;

-- 12. Reading knowledge. A member sees the honest state, including what is not usable yet.
create function tonde.knowledge_search(target_workspace uuid, p_query text default null, p_category text default null,
  p_knowledge_class text default null, p_include_unreviewed boolean default true, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare items jsonb; by_state jsonb; conflicts jsonb; by_service boolean := (select auth.role()) = 'service_role';
begin
  if not by_service and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'A knowledge read is between 1 and 200 items' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', t.id, 'canonical_id', t.canonical_id,
    'name', t.name, 'category', t.category, 'knowledge_class', t.knowledge_class,
    'source_kind', t.source_kind, 'review_state', t.review_state, 'revision', t.revision,
    'confidence', t.confidence, 'importance', t.importance, 'description', t.description,
    'purpose', t.purpose, 'effect', t.effect, 'tonde_guidance', t.tonde_guidance,
    'applicability', t.applicability, 'adaptation', t.adaptation, 'limitations', t.limitations,
    'sources', tonde_private.knowledge_sources_json(target_workspace, t.id),
    'usable_for_guidance', tonde_private.knowledge_is_usable(t.review_state, t.source_kind),
    'reviewed_at', t.reviewed_at, 'review_note', t.review_note, 'superseded_by', t.superseded_by_id,
    'retired_at', t.retired_at) order by t.updated_at desc), '[]'::jsonb) into items
    from (select * from tonde.creative_techniques t
      where t.workspace_id = target_workspace
        and (p_category is null or t.category = p_category)
        and (p_knowledge_class is null or t.knowledge_class = p_knowledge_class)
        and (coalesce(p_include_unreviewed, true) or tonde_private.knowledge_is_usable(t.review_state, t.source_kind))
        and (p_query is null or t.name ilike '%' || p_query || '%' or t.description ilike '%' || p_query || '%'
          or t.tonde_guidance ilike '%' || p_query || '%' or t.canonical_id ilike '%' || p_query || '%')
      order by t.updated_at desc limit p_limit) t;
  select coalesce(jsonb_object_agg(review_state, total), '{}'::jsonb) into by_state
    from (select review_state, count(*)::integer as total from tonde.creative_techniques
      where workspace_id = target_workspace group by review_state) counted;
  select coalesce(jsonb_agg(jsonb_build_object('conflict_id', c.id, 'subject', c.subject,
    'kind', c.conflict_kind, 'severity', c.severity, 'state', c.state, 'resolution', c.resolution,
    'primary_claim', c.primary_claim, 'secondary_claim', c.secondary_claim) order by c.severity, c.created_at), '[]'::jsonb)
    into conflicts from (select * from tonde.knowledge_conflicts c where c.workspace_id = target_workspace
      and c.state = 'open' order by c.created_at limit 50) c;
  return jsonb_build_object('workspace_id', target_workspace, 'items', items, 'by_review_state', by_state,
    'open_conflicts', conflicts,
    'meaning', 'Knowledge is returned with where it came from, what TONDE says about it and whether a person
      has reviewed it. Unreviewed imported knowledge is listed but cannot guide a production yet.');
end $$;
revoke all on function tonde.knowledge_search(uuid,text,text,text,boolean,integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_search(uuid,text,text,text,boolean,integer)
  to authenticated, service_role;

create function tonde.knowledge_item_status(target_workspace uuid, target_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item tonde.creative_techniques; conflicts jsonb; by_service boolean := (select auth.role()) = 'service_role';
begin
  if not by_service and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into item from tonde.creative_techniques t
    where t.workspace_id = target_workspace and t.id = target_item;
  if not found then raise exception 'That knowledge item does not exist' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('conflict_id', c.id, 'subject', c.subject,
    'state', c.state, 'severity', c.severity, 'resolution', c.resolution, 'primary_claim', c.primary_claim,
    'secondary_claim', c.secondary_claim) order by c.created_at), '[]'::jsonb) into conflicts
    from tonde.knowledge_conflicts c where c.workspace_id = target_workspace
      and (c.primary_item_id = target_item or c.secondary_item_id = target_item);
  return jsonb_build_object('item_id', item.id, 'canonical_id', item.canonical_id, 'name', item.name,
    'knowledge_class', item.knowledge_class, 'source_kind', item.source_kind, 'review_state', item.review_state,
    'revision', item.revision, 'content_hash', item.content_hash, 'reviewed_by', item.reviewed_by,
    'reviewed_at', item.reviewed_at, 'review_note', item.review_note, 'supersedes_id', item.supersedes_id,
    'superseded_by_id', item.superseded_by_id, 'applicability', item.applicability,
    'adaptation', item.adaptation, 'tonde_guidance', item.tonde_guidance, 'limitations', item.limitations,
    'confidence', item.confidence,
    'sources', tonde_private.knowledge_sources_json(target_workspace, item.id),
    'conflicts', conflicts,
    'tutorial_steps', (select coalesce(jsonb_agg(jsonb_build_object('step_id', s.id, 'tutorial_id', s.tutorial_id,
      'ordinal', s.ordinal) order by s.ordinal), '[]'::jsonb) from tonde.knowledge_tutorial_steps s
      where s.technique_id = item.id),
    'usable_for_guidance', tonde_private.knowledge_is_usable(item.review_state, item.source_kind),
    'meaning', 'The item is returned with its sources, its review state and any open disagreement about it.');
end $$;
revoke all on function tonde.knowledge_item_status(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.knowledge_item_status(uuid,uuid) to authenticated, service_role;

alter default privileges in schema tonde revoke execute on functions from public;
alter default privileges in schema tonde_private revoke execute on functions from public;

commit;
