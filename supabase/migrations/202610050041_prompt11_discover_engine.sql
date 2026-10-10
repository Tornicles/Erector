-- Prompt 11 packet 041 — the Discover content engine and "Create This".
--
-- The responsibility matrix gives DISCOVER one job: production knowledge, techniques,
-- references/examples/templates, movie references, saved inspiration and collections, with
-- DIRECT THIS / USE THIS TECHNIQUE / SAVE REFERENCE. It must never become a mere image gallery or a
-- stock marketplace. This packet makes that concrete, and makes the honesty laws enforceable:
--
--   * A discover item states where it came from. `provenance` is required, and where it came from is
--     immutable: a client cannot re-attribute an item to a different source after the fact.
--   * Knowledge becomes discoverable only when it is usable. An item built on a knowledge item is
--     registered only while that knowledge passes the Production Knowledge Engine's own usability law
--     (`tonde_private.knowledge_is_usable`), and its usability is re-read from the live source row on
--     every read — so knowledge that is later rejected, retired or superseded makes the item
--     unusable, and the index says so instead of presenting it as guidance.
--   * An item carries the source's own substance, not a paraphrase of it: registering an item on a
--     knowledge source copies that source's category, purpose, effect and limits with its revision.
--   * SAVING is not applying. A save is a creator's private note against an item and changes no
--     production.
--   * DIRECT THIS / USE THIS TECHNIQUE is a two-step creator decision. A PREVIEW writes down exactly
--     what would be created and creates nothing; APPLY spends creator authority, requires the item's
--     canonical id to be typed back, re-checks that the source is still usable, and records the exact
--     object it created. An applied application is a closed record.
--   * Where an item cannot support an action at all, the action is refused with the named reason
--     (no technique substance, no locator, no directions) rather than a fabricated object.
begin;

-- 1. Discover items. Curated TONDE content is global; everything a workspace adds is workspace-scoped.
create table tonde.discover_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  visibility text not null default 'workspace' check (visibility in ('workspace','global')),
  canonical_id text not null check (canonical_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(canonical_id) between 3 and 120),
  item_kind text not null check (item_kind in ('technique','knowledge','tutorial','reference_example',
    'movie_reference','template','inspiration')),
  title text not null check (length(btrim(title)) between 3 and 200),
  summary text not null check (length(btrim(summary)) between 3 and 600),
  directions text not null default '' check (length(directions) <= 6000),
  applicability jsonb not null default '{}'::jsonb check (jsonb_typeof(applicability) = 'object'),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  source_kind text not null check (source_kind in ('knowledge','tutorial','production_reference','creator',
    'import','tonde_canon')),
  source_technique_id uuid,
  source_tutorial_id uuid,
  source_reference_id uuid,
  source_media_id uuid,
  review_state text not null default 'creator_asserted' check (review_state in ('creator_asserted','curated')),
  registered_by uuid references auth.users(id) on delete set null,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, source_technique_id) references tonde.creative_techniques(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_tutorial_id) references tonde.knowledge_tutorials(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_reference_id) references tonde.production_references(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  -- Curated content has no workspace; workspace content always has one.
  constraint discover_item_is_owned check ((visibility = 'workspace') = (workspace_id is not null)),
  -- An item names its source row, or it is honestly authored rather than derived.
  constraint discover_item_source_identified check (
    (source_kind = 'knowledge' and source_technique_id is not null)
    or (source_kind = 'tutorial' and source_tutorial_id is not null)
    or (source_kind = 'production_reference' and source_reference_id is not null)
    or source_kind in ('creator','import','tonde_canon')),
  -- Provenance always names where it came from.
  constraint discover_item_provenance_is_named check (provenance ? 'source_label'),
  constraint discover_curated_names_its_attribution check (review_state <> 'curated'
    or (provenance ? 'attribution'))
);
create unique index discover_item_workspace_canonical on tonde.discover_items(workspace_id, canonical_id)
  where workspace_id is not null;
create unique index discover_item_global_canonical on tonde.discover_items(canonical_id)
  where workspace_id is null;
create index discover_items_kind on tonde.discover_items(visibility, item_kind, title);
create trigger guard_mutation before insert or update on tonde.discover_items
  for each row execute function tonde_private.guard_mutation();
alter table tonde.discover_items enable row level security;
create policy tenant_read on tonde.discover_items for select to authenticated
  using (visibility = 'global' or tonde_private.is_workspace_member(workspace_id));
grant select on tonde.discover_items to authenticated;
grant all on tonde.discover_items to service_role;

-- 2. SAVE REFERENCE. A save is a creator's own note against an item; it creates no production work.
create table tonde.discover_saves (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  item_id uuid not null references tonde.discover_items(id) on delete restrict,
  saved_by uuid not null,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, item_id, saved_by),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, saved_by) references tonde.workspace_members(workspace_id, user_id) on delete restrict
);
create trigger guard_mutation before insert or update on tonde.discover_saves
  for each row execute function tonde_private.guard_mutation();
alter table tonde.discover_saves enable row level security;
create policy tenant_read on tonde.discover_saves for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.discover_saves to authenticated;
grant all on tonde.discover_saves to service_role;

-- 3. Collections: saved inspiration the creator grouped on purpose.
create table tonde.discover_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  description text check (description is null or length(description) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, name),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict
);
create trigger guard_mutation before insert or update on tonde.discover_collections
  for each row execute function tonde_private.guard_mutation();
alter table tonde.discover_collections enable row level security;
create policy tenant_read on tonde.discover_collections for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.discover_collections to authenticated;
grant all on tonde.discover_collections to service_role;

create table tonde.discover_collection_items (
  workspace_id uuid not null,
  collection_id uuid not null,
  item_id uuid not null references tonde.discover_items(id) on delete restrict,
  added_by uuid not null references auth.users(id) on delete restrict,
  note text check (note is null or length(note) <= 1000),
  added_at timestamptz not null default now(),
  primary key (collection_id, item_id),
  foreign key (workspace_id, collection_id) references tonde.discover_collections(workspace_id, id) on delete restrict,
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict
);
alter table tonde.discover_collection_items enable row level security;
create policy tenant_read on tonde.discover_collection_items for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.discover_collection_items to authenticated;
grant all on tonde.discover_collection_items to service_role;

-- 4. Applications: the two-step DIRECT THIS / USE THIS TECHNIQUE record.
create table tonde.discover_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  item_id uuid not null references tonde.discover_items(id) on delete restrict,
  application_kind text not null check (application_kind in ('use_technique','attach_reference','direct_this')),
  production_id uuid not null,
  scene_id uuid,
  shot_id uuid,
  intent_note text check (intent_note is null or length(intent_note) <= 1000),
  impact jsonb not null check (jsonb_typeof(impact) = 'object'),
  state text not null default 'previewed' check (state in ('previewed','applied','withdrawn','expired')),
  applied_object_kind text check (applied_object_kind is null
    or applied_object_kind in ('creative_technique','production_reference')),
  applied_object_id uuid,
  previewed_by uuid references auth.users(id) on delete set null,
  previewed_at timestamptz not null default now(),
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  -- Applied means an object exists and a person applied it. Previewed means neither is true yet.
  constraint application_applied_is_stamped check (state <> 'applied'
    or (applied_at is not null and applied_by is not null and applied_object_kind is not null
      and applied_object_id is not null)),
  constraint application_preview_has_not_applied check (state = 'applied' or applied_object_id is null)
);
create unique index discover_application_live on tonde.discover_applications(workspace_id, item_id,
  application_kind, production_id, coalesce(scene_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(shot_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where state in ('previewed','applied');
create index discover_application_queue on tonde.discover_applications(workspace_id, state, previewed_at desc);
create trigger guard_mutation before insert or update on tonde.discover_applications
  for each row execute function tonde_private.guard_mutation();
alter table tonde.discover_applications enable row level security;
create policy tenant_read on tonde.discover_applications for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.discover_applications to authenticated;
grant all on tonde.discover_applications to service_role;

-- 5. Guards. Curated content and applied work are both closed records.
create function tonde_private.guard_discover_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare curator boolean := (select auth.role()) = 'service_role' or auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    if new.visibility = 'global' or new.review_state = 'curated' then
      if not curator then
        raise exception 'Curated discover content is registered by TONDE, not by a workspace client'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  -- Where an item came from, and what it is, never change after the fact.
  if new.canonical_id is distinct from old.canonical_id or new.visibility is distinct from old.visibility
    or new.workspace_id is distinct from old.workspace_id or new.item_kind is distinct from old.item_kind
    or new.source_kind is distinct from old.source_kind
    or new.source_technique_id is distinct from old.source_technique_id
    or new.source_tutorial_id is distinct from old.source_tutorial_id
    or new.source_reference_id is distinct from old.source_reference_id
    or new.source_media_id is distinct from old.source_media_id
    or new.provenance is distinct from old.provenance
    or new.registered_by is distinct from old.registered_by then
    raise exception 'Where a discover item came from never changes' using errcode = '23514';
  end if;
  if old.review_state = 'curated' and not curator then
    raise exception 'Curated discover content is edited by TONDE' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_discover_item before insert or update on tonde.discover_items
  for each row execute function tonde_private.guard_discover_item();
revoke all on function tonde_private.guard_discover_item() from public, anon, authenticated, service_role;

create function tonde_private.guard_discover_application() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'previewed' then
      raise exception 'An application is previewed first and applied afterwards' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.state = 'applied' and (new.state is distinct from old.state
      or new.impact is distinct from old.impact or new.item_id is distinct from old.item_id
      or new.application_kind is distinct from old.application_kind
      or new.production_id is distinct from old.production_id
      or new.applied_object_kind is distinct from old.applied_object_kind
      or new.applied_object_id is distinct from old.applied_object_id
      or new.note is distinct from old.note) then
    raise exception 'An applied application is a closed record; what was created stays as it was recorded'
      using errcode = '23514';
  end if;
  if old.state in ('withdrawn','expired') and new.state = 'applied' then
    raise exception 'A withdrawn preview cannot be applied' using errcode = '23514';
  end if;
  if new.state = 'applied' and (new.applied_at is null or new.applied_by is null
      or new.applied_object_kind is null or new.applied_object_id is null) then
    raise exception 'An applied application names the object it created and who applied it'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_discover_application before insert or update on tonde.discover_applications
  for each row execute function tonde_private.guard_discover_application();
revoke all on function tonde_private.guard_discover_application() from public, anon, authenticated, service_role;

-- 6. Private helpers. Usability is read from the live source row, never cached on the item.
create function tonde_private.discover_source_state(item tonde.discover_items) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when item.source_technique_id is not null then (
      select case when t.retired_at is not null then 'retired'
        when tonde_private.knowledge_is_usable(t.review_state, t.source_kind) then 'usable'
        else t.review_state end
      from tonde.creative_techniques t where t.id = item.source_technique_id)
    when item.source_tutorial_id is not null then (
      select case when u.state = 'published' then 'usable' else u.state end
      from tonde.knowledge_tutorials u where u.id = item.source_tutorial_id)
    when item.source_reference_id is not null then (
      select case when r.state = 'inaccessible' then 'unusable' else 'available' end
      from tonde.production_references r where r.id = item.source_reference_id)
    else 'authored' end;
$$;
revoke all on function tonde_private.discover_source_state(tonde.discover_items)
  from public, anon, authenticated, service_role;

create function tonde_private.discover_is_usable(item tonde.discover_items) returns boolean
language sql stable security definer set search_path = '' as $$
  select tonde_private.discover_source_state(item) in ('usable','available','authored');
$$;
revoke all on function tonde_private.discover_is_usable(tonde.discover_items)
  from public, anon, authenticated, service_role;

-- Any workspace member may read; service_role reads on behalf of the platform.
create function tonde_private.discover_member(target_workspace uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if (select auth.role()) = 'service_role' then return actor; end if;
  if actor is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function tonde_private.discover_member(uuid) from public, anon, authenticated, service_role;

-- Curation and application both read an item under the caller's visibility.
create function tonde_private.discover_item_for(target_workspace uuid, target_item uuid) returns tonde.discover_items
language plpgsql stable security definer set search_path = '' as $$
declare item tonde.discover_items;
begin
  select * into item from tonde.discover_items i where i.id = target_item
    and (i.visibility = 'global' or i.workspace_id = target_workspace);
  if item.id is null then
    raise exception 'DISCOVER_ITEM_NOT_VISIBLE: that discover item is not visible to this workspace'
      using errcode = 'PT409';
  end if;
  return item;
end $$;
revoke all on function tonde_private.discover_item_for(uuid,uuid) from public, anon, authenticated, service_role;

-- What each action could do with this item, and the named reason when it could not.
create function tonde_private.discover_support(item tonde.discover_items) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare state text := tonde_private.discover_source_state(item); usable boolean;
begin
  usable := state in ('usable','available','authored');
  return jsonb_build_object(
    'source_state', state,
    'usable', usable,
    'use_technique', case
      when item.source_technique_id is null and not (item.applicability ? 'category') then
        jsonb_build_object('available', false, 'reason', 'ITEM_HAS_NO_TECHNIQUE',
          'detail', 'This item carries no technique substance to add to the workspace.')
      when not usable then
        jsonb_build_object('available', false, 'reason', 'SOURCE_NOT_USABLE',
          'detail', format('The knowledge behind this item is %s, so it cannot guide a production.', state))
      else jsonb_build_object('available', true, 'reason', null, 'detail', null) end,
    'attach_reference', case
      when item.source_media_id is null
        and not (item.provenance ? 'locator' and length(btrim(coalesce(item.provenance ->> 'locator', ''))) > 0) then
        jsonb_build_object('available', false, 'reason', 'ITEM_HAS_NO_LOCATOR',
          'detail', 'This item names no accessible reference to attach.')
      when item.source_reference_id is not null and state = 'unusable' then
        jsonb_build_object('available', false, 'reason', 'REFERENCE_INACCESSIBLE',
          'detail', 'The reference this item came from is recorded as inaccessible.')
      else jsonb_build_object('available', true, 'reason', null, 'detail', null) end,
    'direct_this', case
      when length(btrim(item.directions)) = 0 then
        jsonb_build_object('available', false, 'reason', 'ITEM_HAS_NO_DIRECTIONS',
          'detail', 'This item states no directions to direct with.')
      else jsonb_build_object('available', true, 'reason', null, 'detail', null) end);
end $$;
revoke all on function tonde_private.discover_support(tonde.discover_items)
  from public, anon, authenticated, service_role;

-- A deterministic, copy-ready direction: the same item always states the same thing.
create function tonde_private.discover_directive(item tonde.discover_items) returns text
language sql immutable set search_path = '' as $$
  select format('%s — %s%s', item.title, item.summary,
    case when length(btrim(item.directions)) = 0 then '' else ' Directions: ' || item.directions end);
$$;
revoke all on function tonde_private.discover_directive(tonde.discover_items)
  from public, anon, authenticated, service_role;

-- 7. Registering items. Knowledge only becomes discoverable while it is usable.
create function tonde.discover_register_item(target_workspace uuid, p_item jsonb,
  p_visibility text default 'workspace') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; curator boolean := (select auth.role()) = 'service_role' or auth.uid() is null;
  item tonde.discover_items; existing tonde.discover_items; technique tonde.creative_techniques;
  tutorial tonde.knowledge_tutorials; reference tonde.production_references;
  -- The client's words and the column names are the same words; the locals are prefixed so no
  -- statement in this function can be ambiguous about which one it means.
  v_canonical text; v_kind text; v_source text; v_state text; v_applicability jsonb; v_provenance jsonb;
begin
  if jsonb_typeof(p_item) <> 'object' then
    raise exception 'A discover item is registered as an object' using errcode = '22023';
  end if;
  if p_visibility not in ('workspace','global') then
    raise exception 'A discover item is workspace-scoped or TONDE-curated' using errcode = '22023';
  end if;
  if p_visibility = 'global' then
    if not curator then
      raise exception 'Curated discover content is registered by TONDE' using errcode = '42501';
    end if;
    actor := null;
  else
    actor := tonde_private.knowledge_editor(target_workspace);
    if not exists (select 1 from tonde.workspaces w where w.id = target_workspace) then
      raise exception 'That workspace does not exist' using errcode = 'P0002';
    end if;
  end if;
  v_canonical := btrim(coalesce(p_item ->> 'canonical_id', ''));
  if v_canonical !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_canonical) not between 3 and 120 then
    raise exception 'A discover item needs a slug canonical id' using errcode = '22023';
  end if;
  v_kind := btrim(coalesce(p_item ->> 'item_kind', ''));
  if v_kind not in ('technique','knowledge','tutorial','reference_example','movie_reference','template',
    'inspiration') then
    raise exception 'That is not a TONDE discover item kind' using errcode = '22023';
  end if;
  v_source := btrim(coalesce(p_item ->> 'source_kind', ''));
  if v_source not in ('knowledge','tutorial','production_reference','creator','import','tonde_canon') then
    raise exception 'A discover item names where it came from' using errcode = '22023';
  end if;
  -- Only TONDE records canon content: a client can neither curate nor claim canon provenance.
  if v_source = 'tonde_canon' and not curator then
    raise exception 'Canon discover content is registered by TONDE' using errcode = '42501';
  end if;
  v_provenance := coalesce(p_item -> 'provenance', '{}'::jsonb);
  if jsonb_typeof(v_provenance) <> 'object'
    or length(btrim(coalesce(v_provenance ->> 'source_label', ''))) = 0 then
    raise exception 'Provenance must name the source it came from' using errcode = '22023';
  end if;
  v_applicability := coalesce(p_item -> 'applicability', '{}'::jsonb);
  if jsonb_typeof(v_applicability) <> 'object' then
    raise exception 'Applicability is recorded as an object' using errcode = '22023';
  end if;
  -- Knowledge, tutorials and references must exist here, and knowledge must be usable NOW.
  if v_source = 'knowledge' then
    select * into technique from tonde.creative_techniques t
      where t.workspace_id = target_workspace and t.id = (p_item ->> 'source_technique_id')::uuid;
    if technique.id is null then
      raise exception 'That knowledge item does not exist in this workspace' using errcode = 'P0002';
    end if;
    if technique.retired_at is not null then
      raise exception 'KNOWLEDGE_RETIRED: this knowledge was retired and cannot become discoverable'
        using errcode = 'PT409';
    end if;
    if not tonde_private.knowledge_is_usable(technique.review_state, technique.source_kind) then
      raise exception 'KNOWLEDGE_NOT_USABLE: this knowledge is % / % and cannot become discoverable',
        technique.review_state, technique.source_kind using errcode = 'PT409';
    end if;
    -- The item carries the source's own substance with the revision it was read at, never a paraphrase.
    v_applicability := v_applicability || jsonb_build_object('category', technique.category,
      'purpose', technique.purpose, 'effect', technique.effect, 'description', technique.description,
      'conditions', technique.conditions, 'limitations', technique.limitations,
      'importance', technique.importance, 'practical_concept', technique.practical_concept,
      'ai_concept', technique.ai_concept, 'confidence', technique.confidence,
      'knowledge_class', technique.knowledge_class,
      'source_revision', technique.revision, 'review_state', technique.review_state);
  elsif v_source = 'tutorial' then
    select * into tutorial from tonde.knowledge_tutorials u
      where u.workspace_id = target_workspace and u.id = (p_item ->> 'source_tutorial_id')::uuid;
    if tutorial.id is null then
      raise exception 'That tutorial does not exist in this workspace' using errcode = 'P0002';
    end if;
    if tutorial.state <> 'published' then
      raise exception 'TUTORIAL_NOT_PUBLISHED: this tutorial is % and is not yet discoverable', tutorial.state
        using errcode = 'PT409';
    end if;
    v_applicability := v_applicability || jsonb_build_object('step_count', tutorial.step_count,
      'source_kind', tutorial.source_kind, 'attribution', tutorial.attribution, 'license', tutorial.license);
  elsif v_source = 'production_reference' then
    select * into reference from tonde.production_references r
      where r.workspace_id = target_workspace and r.id = (p_item ->> 'source_reference_id')::uuid;
    if reference.id is null then
      raise exception 'That reference does not exist in this workspace' using errcode = 'P0002';
    end if;
    if reference.state = 'inaccessible' then
      raise exception 'REFERENCE_INACCESSIBLE: that reference is recorded as inaccessible'
        using errcode = 'PT409';
    end if;
    v_applicability := v_applicability || jsonb_build_object('source_type', reference.source_type,
      'rights_classification', reference.rights_classification, 'state', reference.state);
  end if;
  v_state := case when curator and p_visibility = 'global' then 'curated' else 'creator_asserted' end;
  select * into existing from tonde.discover_items i where i.canonical_id = v_canonical
    and i.workspace_id is not distinct from (case when p_visibility = 'global' then null else target_workspace end);
  if existing.id is not null then
    update tonde.discover_items set title = btrim(p_item ->> 'title'), summary = btrim(p_item ->> 'summary'),
      directions = coalesce(p_item ->> 'directions', ''), applicability = v_applicability,
      notes = nullif(left(coalesce(p_item ->> 'notes', ''), 1000), ''), updated_at = now()
      where id = existing.id returning * into item;
    if item.workspace_id is not null then
      perform tonde_private.audit_event(target_workspace, 'discover.item_reregistered', item.id, 'discover_item',
        jsonb_build_object('canonical_id', v_canonical, 'item_kind', v_kind, 'source_kind', v_source,
          'source_state', tonde_private.discover_source_state(item)));
    end if;
    return jsonb_build_object('item_id', item.id, 'canonical_id', item.canonical_id, 'visibility', item.visibility,
      'item_kind', item.item_kind, 'review_state', item.review_state,
      'source_state', tonde_private.discover_source_state(item), 'usable', tonde_private.discover_is_usable(item),
      'support', tonde_private.discover_support(item), 'replaced_existing', true, 'idempotent', true,
      'meaning', 'The item was already here; its content was updated and its provenance left exactly as it was.');
  end if;
  insert into tonde.discover_items(workspace_id, visibility, canonical_id, item_kind, title, summary,
    directions, applicability, provenance, source_kind, source_technique_id, source_tutorial_id,
    source_reference_id, source_media_id, review_state, registered_by, notes)
  values (case when p_visibility = 'global' then null else target_workspace end, p_visibility, v_canonical,
    v_kind, btrim(p_item ->> 'title'), btrim(p_item ->> 'summary'), coalesce(p_item ->> 'directions', ''),
    v_applicability, v_provenance, v_source, (p_item ->> 'source_technique_id')::uuid,
    (p_item ->> 'source_tutorial_id')::uuid, (p_item ->> 'source_reference_id')::uuid,
    (p_item ->> 'source_media_id')::uuid, v_state, actor,
    nullif(left(coalesce(p_item ->> 'notes', ''), 1000), ''))
  returning * into item;
  if item.workspace_id is not null then
    perform tonde_private.audit_event(target_workspace, 'discover.item_registered', item.id, 'discover_item',
      jsonb_build_object('canonical_id', v_canonical, 'item_kind', v_kind, 'source_kind', v_source,
        'source_state', tonde_private.discover_source_state(item)));
  end if;
  return jsonb_build_object('item_id', item.id, 'canonical_id', item.canonical_id, 'visibility', item.visibility,
    'item_kind', item.item_kind, 'review_state', item.review_state,
    'source_state', tonde_private.discover_source_state(item), 'usable', tonde_private.discover_is_usable(item),
    'support', tonde_private.discover_support(item), 'replaced_existing', false, 'idempotent', false,
    'meaning', case when tonde_private.discover_is_usable(item)
      then 'The item is discoverable and states where it came from and what it can do.'
      else 'The item is recorded but its source is not usable, so it can guide nothing yet.' end);
end $$;
revoke all on function tonde.discover_register_item(uuid,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.discover_register_item(uuid,jsonb,text) to authenticated, service_role;

-- 8. Reading Discover. Usability is re-read from the live source on every call.
create function tonde.discover_index(target_workspace uuid, p_kind text default null, p_query text default null,
  p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; items jsonb; total integer;
begin
  actor := tonde_private.discover_member(target_workspace);
  if p_kind is not null and p_kind not in ('technique','knowledge','tutorial','reference_example',
    'movie_reference','template','inspiration') then
    raise exception 'That is not a TONDE discover item kind' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'A discover page is between 1 and 200 items' using errcode = '22023';
  end if;
  if p_query is not null and length(p_query) > 200 then
    raise exception 'A discover search is at most 200 characters' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(entry order by entry ->> 'item_kind', entry ->> 'title'), '[]'::jsonb),
    count(*)::integer
    into items, total
    from (
      select jsonb_build_object('item_id', i.id, 'canonical_id', i.canonical_id, 'item_kind', i.item_kind,
        'title', i.title, 'summary', i.summary, 'visibility', i.visibility, 'review_state', i.review_state,
        'provenance', i.provenance, 'applicability', i.applicability,
        'source_state', tonde_private.discover_source_state(i),
        'usable', tonde_private.discover_is_usable(i),
        'support', tonde_private.discover_support(i),
        'saved', actor is not null and exists (select 1 from tonde.discover_saves s
          where s.workspace_id = target_workspace and s.item_id = i.id and s.saved_by = actor),
        'save_count', (select count(*) from tonde.discover_saves s
          where s.workspace_id = target_workspace and s.item_id = i.id),
        'applied', exists (select 1 from tonde.discover_applications a
          where a.workspace_id = target_workspace and a.item_id = i.id and a.state = 'applied')) as entry
      from tonde.discover_items i
      where (i.visibility = 'global' or i.workspace_id = target_workspace)
        and (p_kind is null or i.item_kind = p_kind)
        and (p_query is null or i.title ilike '%' || p_query || '%' or i.summary ilike '%' || p_query || '%'
          or i.directions ilike '%' || p_query || '%' or i.canonical_id ilike '%' || p_query || '%')
      order by i.item_kind, i.title limit p_limit) listed;
  return jsonb_build_object('workspace_id', target_workspace, 'items', items, 'count', total,
    'kind', p_kind, 'query', p_query, 'limit', p_limit,
    'meaning', 'Every item states where it came from and whether its source is usable right now. An item
      whose source is not usable is listed with that state and cannot be applied.');
end $$;
revoke all on function tonde.discover_index(uuid,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.discover_index(uuid,text,text,integer) to authenticated, service_role;

create function tonde.discover_item_status(target_workspace uuid, target_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; item tonde.discover_items; support jsonb;
begin
  actor := tonde_private.discover_member(target_workspace);
  item := tonde_private.discover_item_for(target_workspace, target_item);
  support := tonde_private.discover_support(item);
  return jsonb_build_object('item_id', item.id, 'canonical_id', item.canonical_id, 'item_kind', item.item_kind,
    'title', item.title, 'summary', item.summary, 'directions', item.directions,
    'applicability', item.applicability, 'provenance', item.provenance,
    'visibility', item.visibility, 'review_state', item.review_state,
    'source_state', support ->> 'source_state', 'usable', (support ->> 'usable')::boolean,
    'support', support, 'directive', tonde_private.discover_directive(item),
    'saved_by_you', actor is not null and exists (select 1 from tonde.discover_saves s
      where s.workspace_id = target_workspace and s.item_id = item.id and s.saved_by = actor),
    'saves', (select coalesce(jsonb_agg(jsonb_build_object('saved_by', s.saved_by, 'note', s.note,
        'saved_at', s.created_at) order by s.created_at), '[]'::jsonb)
      from tonde.discover_saves s where s.workspace_id = target_workspace and s.item_id = item.id),
    'collections', (select coalesce(jsonb_agg(jsonb_build_object('collection_id', c.id, 'name', c.name)
        order by c.name), '[]'::jsonb)
      from tonde.discover_collection_items ci join tonde.discover_collections c on c.id = ci.collection_id
      where ci.workspace_id = target_workspace and ci.item_id = item.id),
    'applications', (select coalesce(jsonb_agg(jsonb_build_object('application_id', a.id,
        'application_kind', a.application_kind, 'production_id', a.production_id, 'scene_id', a.scene_id,
        'shot_id', a.shot_id, 'state', a.state, 'applied_object_kind', a.applied_object_kind,
        'applied_object_id', a.applied_object_id, 'previewed_at', a.previewed_at, 'applied_at', a.applied_at)
        order by a.previewed_at desc), '[]'::jsonb)
      from tonde.discover_applications a where a.workspace_id = target_workspace and a.item_id = item.id),
    'meaning', 'What this item is, where it came from, what can be done with it right now, and every
      application of it in this workspace.');
end $$;
revoke all on function tonde.discover_item_status(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.discover_item_status(uuid,uuid) to authenticated, service_role;

-- 9. SAVE REFERENCE, and collections of saved inspiration.
create function tonde.discover_save(target_workspace uuid, target_item uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; item tonde.discover_items; existing tonde.discover_saves; saved tonde.discover_saves;
begin
  actor := tonde_private.discover_member(target_workspace);
  if actor is null then
    raise exception 'A save belongs to a person, not to the platform' using errcode = '42501';
  end if;
  item := tonde_private.discover_item_for(target_workspace, target_item);
  select * into existing from tonde.discover_saves s
    where s.workspace_id = target_workspace and s.item_id = item.id and s.saved_by = actor;
  if existing.id is not null then
    if coalesce(p_note, '') is not distinct from coalesce(existing.note, '') then
      return jsonb_build_object('save_id', existing.id, 'item_id', item.id, 'idempotent', true,
        'meaning', 'This item was already saved by you, with the same note.');
    end if;
    update tonde.discover_saves set note = nullif(left(coalesce(p_note, ''), 1000), ''), updated_at = now()
      where id = existing.id returning * into saved;
    return jsonb_build_object('save_id', saved.id, 'item_id', item.id, 'idempotent', true,
      'meaning', 'The save was already there; its note is updated.');
  end if;
  insert into tonde.discover_saves(workspace_id, item_id, saved_by, note)
  values (target_workspace, item.id, actor, nullif(left(coalesce(p_note, ''), 1000), ''))
  returning * into saved;
  perform tonde_private.audit_event(target_workspace, 'discover.saved', saved.id, 'discover_item',
    jsonb_build_object('item_id', item.id, 'canonical_id', item.canonical_id));
  return jsonb_build_object('save_id', saved.id, 'item_id', item.id, 'idempotent', false,
    'meaning', 'Saved as a reference for later. Nothing about a production changed.');
end $$;
revoke all on function tonde.discover_save(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.discover_save(uuid,uuid,text) to authenticated, service_role;

create function tonde.discover_unsave(target_workspace uuid, target_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; item tonde.discover_items; removed integer;
begin
  actor := tonde_private.discover_member(target_workspace);
  if actor is null then
    raise exception 'A save belongs to a person, not to the platform' using errcode = '42501';
  end if;
  item := tonde_private.discover_item_for(target_workspace, target_item);
  delete from tonde.discover_saves s where s.workspace_id = target_workspace and s.item_id = item.id
    and s.saved_by = actor;
  get diagnostics removed := row_count;
  if removed = 0 then
    raise exception 'SAVE_NOT_FOUND: you had not saved that item' using errcode = 'PT409';
  end if;
  return jsonb_build_object('item_id', item.id, 'removed', removed,
    'meaning', 'The save is gone. The item itself is unchanged.');
end $$;
revoke all on function tonde.discover_unsave(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.discover_unsave(uuid,uuid) to authenticated, service_role;

create function tonde.discover_collection_create(target_workspace uuid, p_name text, p_description text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; collection tonde.discover_collections; existing tonde.discover_collections;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'A collection needs a name' using errcode = '22023';
  end if;
  select * into existing from tonde.discover_collections c
    where c.workspace_id = target_workspace and c.name = btrim(p_name);
  if existing.id is not null then
    return jsonb_build_object('collection_id', existing.id, 'name', existing.name, 'idempotent', true);
  end if;
  insert into tonde.discover_collections(workspace_id, name, description, created_by)
  values (target_workspace, left(btrim(p_name), 160), nullif(left(coalesce(p_description, ''), 1000), ''), actor)
  returning * into collection;
  perform tonde_private.audit_event(target_workspace, 'discover.collection_created', collection.id,
    'discover_collection', jsonb_build_object('name', collection.name));
  return jsonb_build_object('collection_id', collection.id, 'name', collection.name, 'idempotent', false);
end $$;
revoke all on function tonde.discover_collection_create(uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.discover_collection_create(uuid,text,text) to authenticated, service_role;

create function tonde.discover_collection_add(target_workspace uuid, target_collection uuid, target_item uuid,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; collection tonde.discover_collections; item tonde.discover_items; existing integer;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  select * into collection from tonde.discover_collections c
    where c.workspace_id = target_workspace and c.id = target_collection;
  if collection.id is null then
    raise exception 'That collection does not exist' using errcode = 'P0002';
  end if;
  item := tonde_private.discover_item_for(target_workspace, target_item);
  select count(*) into existing from tonde.discover_collection_items ci
    where ci.collection_id = collection.id and ci.item_id = item.id;
  if existing > 0 then
    return jsonb_build_object('collection_id', collection.id, 'item_id', item.id, 'idempotent', true);
  end if;
  insert into tonde.discover_collection_items(workspace_id, collection_id, item_id, added_by, note)
  values (target_workspace, collection.id, item.id, actor, nullif(left(coalesce(p_note, ''), 1000), ''));
  return jsonb_build_object('collection_id', collection.id, 'item_id', item.id, 'idempotent', false);
end $$;
revoke all on function tonde.discover_collection_add(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.discover_collection_add(uuid,uuid,uuid,text) to authenticated, service_role;

create function tonde.discover_collection_remove(target_workspace uuid, target_collection uuid, target_item uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; removed integer;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  delete from tonde.discover_collection_items ci where ci.workspace_id = target_workspace
    and ci.collection_id = target_collection and ci.item_id = target_item;
  get diagnostics removed := row_count;
  if removed = 0 then
    raise exception 'COLLECTION_ITEM_NOT_FOUND: that item is not in that collection' using errcode = 'PT409';
  end if;
  return jsonb_build_object('collection_id', target_collection, 'item_id', target_item, 'removed', removed);
end $$;
revoke all on function tonde.discover_collection_remove(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function tonde.discover_collection_remove(uuid,uuid,uuid) to authenticated, service_role;

-- 10. DIRECT THIS / USE THIS TECHNIQUE: a preview that creates nothing, then the creator's apply.
create function tonde.discover_preview(target_workspace uuid, target_item uuid, p_kind text,
  target_production uuid, target_scene uuid default null, target_shot uuid default null,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; item tonde.discover_items; support jsonb; production tonde.productions;
  existing tonde.discover_applications; application tonde.discover_applications; v_impact jsonb;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  item := tonde_private.discover_item_for(target_workspace, target_item);
  support := tonde_private.discover_support(item);
  if p_kind is null or p_kind not in ('use_technique','attach_reference','direct_this') then
    raise exception 'That is not a TONDE discover action' using errcode = '22023';
  end if;
  if not (support -> p_kind ->> 'available')::boolean then
    raise exception '%: %', support -> p_kind ->> 'reason', support -> p_kind ->> 'detail'
      using errcode = 'PT409';
  end if;
  select * into production from tonde.productions p
    where p.workspace_id = target_workspace and p.id = target_production;
  if production.id is null then
    raise exception 'That Production does not exist' using errcode = 'P0002';
  end if;
  if target_scene is not null and not exists (select 1 from tonde.scenes s
      where s.workspace_id = target_workspace and s.production_id = production.id and s.id = target_scene) then
    raise exception 'That scene does not exist in this Production' using errcode = 'P0002';
  end if;
  if target_shot is not null and not exists (select 1 from tonde.shots sh
      where sh.workspace_id = target_workspace and sh.production_id = production.id and sh.id = target_shot) then
    raise exception 'That shot does not exist in this Production' using errcode = 'P0002';
  end if;
  -- The preview states exactly what applying would create, and that string is the confirmation.
  v_impact := jsonb_build_object('application_kind', p_kind, 'item_id', item.id, 'canonical_id', item.canonical_id,
    'item_kind', item.item_kind, 'title', item.title, 'source_state', support ->> 'source_state',
    'production_id', production.id, 'production_title', production.title, 'scene_id', target_scene,
    'shot_id', target_shot, 'confirmation', item.canonical_id,
    'changes', case p_kind
      when 'use_technique' then jsonb_build_array(jsonb_build_object('object', 'creative_technique',
        'action', 'create_or_reuse', 'detail', format('A workspace technique "%s" carrying this item''s own substance.',
          item.title), 'canonical_id', item.canonical_id,
        'category', item.applicability ->> 'category'))
      when 'attach_reference' then jsonb_build_array(jsonb_build_object('object', 'production_reference',
        'action', 'create', 'detail', format('A reference on "%s" pointing at where this item came from.',
          production.title), 'locator', item.provenance ->> 'locator'))
      else jsonb_build_array(jsonb_build_object('object', 'production_reference', 'action', 'create',
        'detail', format('A description reference on "%s" carrying these directions.', production.title),
        'source_type', 'description'))
    end,
    'creates_nothing', true,
    'meaning', 'This is a preview. Nothing has been created. Applying is a separate decision that requires
      the canonical id to be typed back.');
  select * into existing from tonde.discover_applications a
    where a.workspace_id = target_workspace and a.item_id = item.id and a.application_kind = p_kind
      and a.production_id = production.id
      and a.scene_id is not distinct from target_scene and a.shot_id is not distinct from target_shot
      and a.state = 'previewed';
  if existing.id is not null then
    return jsonb_build_object('application_id', existing.id, 'state', existing.state, 'impact', existing.impact,
      'idempotent', true, 'meaning', 'This preview was already open; it is the same draft.');
  end if;
  insert into tonde.discover_applications(workspace_id, item_id, application_kind, production_id, scene_id,
    shot_id, intent_note, impact, previewed_by)
  values (target_workspace, item.id, p_kind, production.id, target_scene, target_shot,
    nullif(left(coalesce(p_note, ''), 1000), ''), v_impact, actor)
  returning * into application;
  perform tonde_private.audit_event(target_workspace, 'discover.previewed', application.id, 'discover_application',
    jsonb_build_object('item_id', item.id, 'application_kind', p_kind, 'production_id', production.id,
      'scene_id', target_scene, 'shot_id', target_shot));
  return jsonb_build_object('application_id', application.id, 'state', application.state,
    'impact', application.impact, 'idempotent', false,
    'meaning', 'The preview is recorded and nothing was created.');
end $$;
revoke all on function tonde.discover_preview(uuid,uuid,text,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.discover_preview(uuid,uuid,text,uuid,uuid,uuid,text)
  to authenticated, service_role;

create function tonde.discover_apply(target_workspace uuid, target_application uuid, p_confirmation text,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; application tonde.discover_applications; item tonde.discover_items; support jsonb;
  production tonde.productions; technique tonde.creative_techniques; reference tonde.production_references;
  v_object_kind text; v_object_id uuid; v_locator text; v_source_type tonde.reference_source;
  v_rights tonde.reference_rights; v_category text;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  select * into application from tonde.discover_applications a
    where a.workspace_id = target_workspace and a.id = target_application for update;
  if application.id is null then
    raise exception 'That discover application does not exist' using errcode = 'P0002';
  end if;
  if application.state = 'applied' then
    return jsonb_build_object('application_id', application.id, 'state', 'applied', 'idempotent', true,
      'applied_object_kind', application.applied_object_kind, 'applied_object_id', application.applied_object_id);
  end if;
  if application.state <> 'previewed' then
    raise exception 'APPLICATION_NOT_OPEN: this application is % and cannot be applied', application.state
      using errcode = 'PT409';
  end if;
  item := tonde_private.discover_item_for(target_workspace, application.item_id);
  if coalesce(btrim(p_confirmation), '') <> item.canonical_id then
    raise exception 'APPLICATION_CONFIRMATION_REQUIRED: type the item''s canonical id (% ) to apply it',
      item.canonical_id using errcode = 'PT409';
  end if;
  -- The world may have moved since the preview: re-check the source and the target.
  support := tonde_private.discover_support(item);
  if not (support -> application.application_kind ->> 'available')::boolean then
    raise exception 'APPLICATION_NO_LONGER_VALID: %: %', support -> application.application_kind ->> 'reason',
      support -> application.application_kind ->> 'detail' using errcode = 'PT409';
  end if;
  select * into production from tonde.productions p
    where p.workspace_id = target_workspace and p.id = application.production_id;
  if production.id is null then
    raise exception 'That Production no longer exists' using errcode = 'P0002';
  end if;
  if application.application_kind = 'use_technique' then
    -- The creator's own technique, carrying the item's recorded substance and naming its origin. No
    -- category is invented: an item without one cannot become a workspace technique.
    v_category := nullif(item.applicability ->> 'category', '');
    if v_category is null or v_category not in ('camera','composition','lighting','blocking','performance',
      'product','edit','transition','sound','color','story','typography') then
      raise exception 'ITEM_HAS_NO_TECHNIQUE: this item records no technique category, so nothing is created'
        using errcode = 'PT409';
    end if;
    select * into technique from tonde.creative_techniques t
      where t.workspace_id = target_workspace and t.canonical_id = item.canonical_id;
    if technique.id is null then
      insert into tonde.creative_techniques(workspace_id, canonical_id, name, category, description, purpose,
        effect, conditions, practical_concept, ai_concept, limitations, importance, confidence,
        technique_source, knowledge_class, source_kind, applicability, tonde_guidance, created_by)
      values (target_workspace, item.canonical_id, item.title, v_category,
        left(coalesce(nullif(item.applicability ->> 'description', ''), item.summary), 1200),
        left(coalesce(nullif(item.applicability ->> 'purpose', ''), item.summary), 600),
        left(coalesce(nullif(item.applicability ->> 'effect', ''), item.summary), 600),
        coalesce(item.applicability -> 'conditions', '[]'::jsonb),
        left(coalesce(item.applicability ->> 'practical_concept', ''), 900),
        left(coalesce(item.applicability ->> 'ai_concept', ''), 900),
        coalesce(item.applicability -> 'limitations', '[]'::jsonb),
        coalesce(nullif(item.applicability ->> 'importance', ''), 'supporting'),
        coalesce(nullif(item.applicability ->> 'confidence', ''), 'medium'), 'reference',
        coalesce(nullif(item.applicability ->> 'knowledge_class', ''), 'technique'), 'reference',
        item.applicability, left(coalesce(item.applicability ->> 'ai_concept', ''), 4000), actor)
      returning * into technique;
    end if;
    v_object_kind := 'creative_technique'; v_object_id := technique.id;
  else
    v_locator := nullif(btrim(coalesce(item.provenance ->> 'locator', '')), '');
    v_rights := 'unknown';
    if coalesce(item.provenance ->> 'rights_classification', '') in ('user_owned','licensed','brand_owned',
        'authorized_identity','public_reference','third_party_inspiration','unknown') then
      v_rights := (item.provenance ->> 'rights_classification')::tonde.reference_rights;
    end if;
    if application.application_kind = 'direct_this' then
      v_source_type := 'description';
    elsif item.source_media_id is not null then
      v_source_type := 'asset';
    elsif item.item_kind = 'movie_reference' then
      v_source_type := 'movie';
    elsif v_locator ~ '^https?://' then
      v_source_type := 'url';
    else
      raise exception 'REFERENCE_LOCATOR_NOT_A_URL: this item''s locator is not an address that can be
        attached' using errcode = 'PT409';
    end if;
    insert into tonde.production_references(workspace_id, production_id, source_type, source_url,
      source_description, rights_classification, state, media_id, provenance)
    values (target_workspace, production.id, v_source_type,
      case when v_source_type in ('url','movie') then v_locator else null end,
      case when v_source_type = 'description' then left(item.directions, 4000)
        else left(item.summary, 4000) end,
      v_rights, 'received', item.source_media_id,
      jsonb_build_object('discover_item_id', item.id, 'canonical_id', item.canonical_id,
        'item_kind', item.item_kind, 'source_label', item.provenance ->> 'source_label',
        'attribution', item.provenance ->> 'attribution', 'license', item.provenance ->> 'license',
        'application_id', application.id))
    returning * into reference;
    v_object_kind := 'production_reference'; v_object_id := reference.id;
  end if;
  update tonde.discover_applications set state = 'applied', applied_object_kind = v_object_kind,
    applied_object_id = v_object_id, applied_by = actor, applied_at = now(),
    note = nullif(left(coalesce(p_note, ''), 1000), ''), updated_at = now()
    where id = application.id returning * into application;
  perform tonde_private.audit_event(target_workspace, 'discover.applied', application.id, 'discover_application',
    jsonb_build_object('item_id', item.id, 'application_kind', application.application_kind,
      'production_id', production.id, 'applied_object_kind', v_object_kind, 'applied_object_id', v_object_id,
      'confirmation', item.canonical_id));
  return jsonb_build_object('application_id', application.id, 'state', 'applied', 'idempotent', false,
    'applied_object_kind', v_object_kind, 'applied_object_id', v_object_id, 'production_id', production.id,
    'meaning', case v_object_kind
      when 'creative_technique' then format('"%s" is now a technique in this workspace, carrying its own
        recorded substance and naming where it came from.', item.title)
      else format('The reference is recorded on "%s" with the rights class it honestly has.', production.title)
      end);
end $$;
revoke all on function tonde.discover_apply(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function tonde.discover_apply(uuid,uuid,text,text) to authenticated, service_role;

create function tonde.discover_withdraw(target_workspace uuid, target_application uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; application tonde.discover_applications;
begin
  actor := tonde_private.knowledge_editor(target_workspace);
  select * into application from tonde.discover_applications a
    where a.workspace_id = target_workspace and a.id = target_application for update;
  if application.id is null then
    raise exception 'That discover application does not exist' using errcode = 'P0002';
  end if;
  if application.state = 'applied' then
    raise exception 'APPLICATION_ALREADY_APPLIED: what was applied is a real record; withdrawing does not
      remove it' using errcode = 'PT409';
  end if;
  if application.state = 'withdrawn' then
    return jsonb_build_object('application_id', application.id, 'state', 'withdrawn', 'idempotent', true);
  end if;
  update tonde.discover_applications set state = 'withdrawn',
    note = nullif(left(coalesce(p_note, ''), 1000), ''), updated_at = now()
    where id = application.id returning * into application;
  return jsonb_build_object('application_id', application.id, 'state', 'withdrawn', 'idempotent', false,
    'meaning', 'The preview is withdrawn. Nothing had been created, so nothing is removed.');
end $$;
revoke all on function tonde.discover_withdraw(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.discover_withdraw(uuid,uuid,text) to authenticated, service_role;

create function tonde.discover_application_status(target_workspace uuid, target_application uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; application tonde.discover_applications; item tonde.discover_items;
begin
  actor := tonde_private.discover_member(target_workspace);
  select * into application from tonde.discover_applications a
    where a.workspace_id = target_workspace and a.id = target_application;
  if application.id is null then
    raise exception 'That discover application does not exist' using errcode = 'P0002';
  end if;
  item := tonde_private.discover_item_for(target_workspace, application.item_id);
  return jsonb_build_object('application_id', application.id, 'state', application.state,
    'application_kind', application.application_kind, 'item_id', item.id, 'canonical_id', item.canonical_id,
    'title', item.title, 'source_state', tonde_private.discover_source_state(item),
    'production_id', application.production_id, 'scene_id', application.scene_id, 'shot_id', application.shot_id,
    'impact', application.impact, 'applied_object_kind', application.applied_object_kind,
    'applied_object_id', application.applied_object_id, 'previewed_at', application.previewed_at,
    'previewed_by', application.previewed_by, 'applied_at', application.applied_at,
    'applied_by', application.applied_by, 'note', application.note,
    'meaning', 'A preview that created nothing, or the applied record naming the exact object it created.');
end $$;
revoke all on function tonde.discover_application_status(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function tonde.discover_application_status(uuid,uuid) to authenticated, service_role;

-- 11. The retention registry learns about discover data. Knowledge is durable: a routine sweep retains
--     it, and a creator-authorized workspace deletion is what removes workspace-scoped items.
insert into tonde.retention_classes(data_class, display_name, description, table_names, age_column,
  default_retention_days, purge_action, purge_exempt, purge_order) values
  ('discover_content','Discover content','Discover items, saves, collections and their members. Production
   knowledge is durable: a routine sweep retains it, a workspace deletion removes the workspace rows.',
   '{discover_items,discover_saves,discover_collections,discover_collection_items}','created_at',null,
   'retain',false,32),
  ('discover_application','Discover applications','Previews and the records of what applying created.',
   '{discover_applications}','created_at',null,'retain',false,34)
on conflict (data_class) do update set display_name = excluded.display_name,
  description = excluded.description, table_names = excluded.table_names, age_column = excluded.age_column,
  default_retention_days = excluded.default_retention_days, purge_action = excluded.purge_action,
  purge_exempt = excluded.purge_exempt, purge_order = excluded.purge_order, updated_at = now();

alter default privileges in schema tonde revoke execute on functions from public;
alter default privileges in schema tonde_private revoke execute on functions from public;

commit;
