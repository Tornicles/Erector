begin;

-- 1. Vocabulary. Storage codes are the generated product vocabulary keys.
create type tonde.branch_state as enum ('open','merged','abandoned');
create type tonde.branch_change_state as enum ('pending','applied','conflicted','rejected');
create type tonde.merge_state as enum ('proposed','merged','rejected');

-- 2. Historical versions are immutable. A version records what a row was; it is never rewritten.
-- `capture_revision` only ever inserts, so nothing legitimate updates or deletes a version.
create function tonde_private.versions_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Historical versions are immutable' using errcode = '23514';
end $$;
revoke all on function tonde_private.versions_immutable() from public, anon, authenticated, service_role;
create trigger versions_immutable before update or delete on tonde.object_versions
  for each row execute function tonde_private.versions_immutable();

-- 3. A restore or a merge creates a normal current revision through the canonical update path, so
-- `guard_mutation` and `capture_revision` still run. The trigger reads a transaction-local action
-- so the version says honestly what produced it, instead of guessing from the SQL verb.
create or replace function tonde_private.capture_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_id uuid; action text := nullif(current_setting('tonde.version_action', true), '');
begin
  select id into parent_id from tonde.object_versions where object_id = new.id and branch_name = 'main'
    order by revision desc limit 1;
  insert into tonde.object_versions(workspace_id,object_id,revision,parent_version_id,actor_type,actor_user_id,source_action,snapshot)
    values(new.workspace_id,new.id,new.revision,parent_id,
      case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
      left(coalesce(action, lower(tg_op)), 60), to_jsonb(new));
  return new;
end $$;

-- 4. Creative branches. A branch originates from a known version of a scope object, records its
-- name, scope, source version and reason, and carries object-level alternatives. It is NOT a
-- duplicate Production.
create table tonde.object_branches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  scope_object_id uuid not null,
  scope text not null check (scope in ('story','script','act','sequence','scene','shot','execution_plan','asset')),
  name text not null check (length(btrim(name)) between 1 and 160),
  source_version_id uuid,
  source_revision integer check (source_revision is null or source_revision > 0),
  reason text not null default '' check (length(reason) <= 600),
  state tonde.branch_state not null default 'open',
  merged_at timestamptz, merged_by uuid, merged_proposal_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, scope_object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_version_id) references tonde.object_versions(workspace_id, id) on delete restrict
);
-- A branch name is unique per scope object while the branch is open; history may reuse the name.
create unique index object_branches_open on tonde.object_branches(workspace_id, scope_object_id, lower(btrim(name)))
  where state = 'open';
create index object_branches_by_production on tonde.object_branches(workspace_id, production_id, state, created_at desc);

-- 5. Proposed edits on a branch. A branch change is a field patch for one object, computed against
-- the mainline revision it was written from. It touches nothing on the mainline until a merge.
create table tonde.branch_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null, branch_id uuid not null,
  target_object_id uuid not null,
  base_version_id uuid, base_revision integer check (base_revision is null or base_revision > 0),
  patch jsonb not null check (jsonb_typeof(patch) = 'object'),
  changed_fields text[] not null default '{}',
  note text not null default '' check (length(note) <= 600),
  state tonde.branch_change_state not null default 'pending',
  applied_version_id uuid, applied_revision integer,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, branch_id, target_object_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, branch_id) references tonde.object_branches(workspace_id, id) on delete restrict,
  foreign key (workspace_id, target_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create index branch_changes_by_branch on tonde.branch_changes(workspace_id, branch_id, state);

-- 6. Merge proposals. A merge is a REVIEWED proposal, never a silent copy: it pins every change's
-- base revision, records clean and conflicted items separately, and keeps the decision.
create table tonde.merge_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null, branch_id uuid not null,
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  conflicts jsonb not null default '[]' check (jsonb_typeof(conflicts) = 'array'),
  counts jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  structure_revision integer check (structure_revision is null or structure_revision > 0),
  state tonde.merge_state not null default 'proposed',
  decided_by uuid, decided_at timestamptz,
  decision_note text not null default '' check (length(decision_note) <= 800),
  applied jsonb not null default '[]' check (jsonb_typeof(applied) = 'array'),
  impact jsonb not null default '{}' check (jsonb_typeof(impact) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, branch_id) references tonde.object_branches(workspace_id, id) on delete restrict
);
create index merge_proposals_recent on tonde.merge_proposals(workspace_id, production_id, created_at desc);

-- 7. Private helpers (not user-facing; reachable only through the security-definer RPCs below).
-- Which canonical fields a branch change may set, per object kind. A branch change is a field
-- patch, never a whole-row replacement, so identity, ordering, approval and locks stay untouched.
create function tonde_private.vb_fields(kind_value text) returns jsonb
language sql immutable set search_path = '' as $$
  select case kind_value
    when 'creative_document' then jsonb_build_object('table','creative_documents','scope','production',
      'fields', jsonb_build_object('title','text','content','text'))
    when 'scene' then jsonb_build_object('table','scenes','scope','production',
      'fields', jsonb_build_object('title','text','description','text','purpose','text','planned_duration_ms','bigint'))
    when 'shot' then jsonb_build_object('table','shots','scope','production',
      'fields', jsonb_build_object('title','text','description','text','action','text','purpose','text','subject','text','planned_duration_ms','bigint'))
    when 'execution_plan' then jsonb_build_object('table','execution_plans','scope','production',
      'fields', jsonb_build_object('shot_size','text','movement','text','framing','text','composition','text',
        'camera_position','text','camera_height','text','camera_angle','text','lighting_intent','text','plan_metadata','jsonb'))
    when 'asset' then jsonb_build_object('table','assets','scope','workspace',
      'fields', jsonb_build_object('name','text','description','text','search_metadata','jsonb','consistency_metadata','jsonb'))
    else null end;
$$;
revoke all on function tonde_private.vb_fields(text) from public, anon, authenticated, service_role;

-- A readable label for a changed field. Names are product words, not column names.
create function tonde_private.vb_field_label(field_name text) returns text
language sql immutable set search_path = '' as $$
  select case field_name
    when 'title' then 'Title' when 'content' then 'Content' when 'description' then 'Description'
    when 'purpose' then 'Purpose' when 'action' then 'Action' when 'subject' then 'Subject'
    when 'planned_duration_ms' then 'Planned duration' when 'shot_size' then 'Shot size'
    when 'movement' then 'Movement' when 'framing' then 'Framing' when 'composition' then 'Composition'
    when 'camera_position' then 'Camera position' when 'camera_height' then 'Camera height'
    when 'camera_angle' then 'Camera angle' when 'lighting_intent' then 'Lighting intent'
    when 'plan_metadata' then 'Plan metadata' when 'name' then 'Name'
    when 'search_metadata' then 'Search metadata' when 'consistency_metadata' then 'Consistency metadata'
    else initcap(replace(field_name, '_', ' ')) end;
$$;
revoke all on function tonde_private.vb_field_label(text) from public, anon, authenticated, service_role;

-- Resolve a version row, refusing a version that is not in this workspace.
create function tonde_private.vb_version(target_workspace uuid, target_version uuid) returns tonde.object_versions
language plpgsql stable security definer set search_path = '' as $$
declare version_row tonde.object_versions;
begin
  select * into version_row from tonde.object_versions where workspace_id = target_workspace and id = target_version;
  if not found then raise exception 'That version is unavailable' using errcode = 'P0002'; end if;
  return version_row;
end $$;
revoke all on function tonde_private.vb_version(uuid,uuid) from public, anon, authenticated, service_role;

-- Resolve an object, requiring Production coherence. An Asset is workspace-level, so its object row
-- has no Production; every other kind must belong to the Production the caller named.
create function tonde_private.vb_object(target_workspace uuid, target_production uuid, target_object uuid) returns tonde.objects
language plpgsql stable security definer set search_path = '' as $$
declare object_row tonde.objects;
begin
  select * into object_row from tonde.objects
    where workspace_id = target_workspace and id = target_object
      and (production_id is null or production_id = target_production);
  if not found then raise exception 'That object is unavailable in this Production' using errcode = 'P0002'; end if;
  return object_row;
end $$;
revoke all on function tonde_private.vb_object(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- The latest mainline version of an object, if it has been captured at least once.
create function tonde_private.vb_latest_version(target_workspace uuid, target_object uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select (array_agg(v.id order by v.revision desc, v.created_at desc))[1]
  from tonde.object_versions v
  where v.workspace_id = target_workspace and v.object_id = target_object and v.branch_name = 'main';
$$;
revoke all on function tonde_private.vb_latest_version(uuid,uuid) from public, anon, authenticated, service_role;

-- Meaningful differences between two snapshots, limited to the fields a branch change can set for
-- the object's kind. A raw JSON diff is never what the creator sees.
create function tonde_private.vb_diff(target_workspace uuid, kind_value text, left_snapshot jsonb, right_snapshot jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare fields jsonb; field_name text; items jsonb := '[]'::jsonb; before_value jsonb; after_value jsonb;
begin
  fields := tonde_private.vb_fields(kind_value);
  if fields is null then return items; end if;
  for field_name in select jsonb_object_keys(fields->'fields') order by 1 loop
    before_value := left_snapshot -> field_name;
    after_value := right_snapshot -> field_name;
    if before_value is distinct from after_value then
      items := items || jsonb_build_array(jsonb_build_object(
        'field', field_name, 'label', tonde_private.vb_field_label(field_name),
        'before', coalesce(before_value, 'null'::jsonb), 'after', coalesce(after_value, 'null'::jsonb)));
    end if;
  end loop;
  return items;
end $$;
revoke all on function tonde_private.vb_diff(uuid,text,jsonb,jsonb) from public, anon, authenticated, service_role;

-- Apply a validated patch to the canonical row. This is the ONLY place a version operation reaches
-- mainline, and it runs through the normal update path: guard_mutation and capture_revision still
-- apply. It refuses stale operations (40001) and unsupported fields (22023).
create function tonde_private.vb_patch_apply(target_workspace uuid, target_production uuid, target_object uuid,
  patch jsonb, expected_revision integer default null, action text default 'update')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare object_row tonde.objects; map jsonb; field_name text; field_type text; assignments text := '';
  scope_kind text; new_revision integer; changed text[] := '{}'; value_text text;
begin
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  map := tonde_private.vb_fields(object_row.kind);
  if map is null then raise exception 'That object kind cannot be changed by a version operation' using errcode = '22023'; end if;
  if jsonb_typeof(patch) <> 'object' then raise exception 'A change is an object of fields' using errcode = '22023'; end if;
  for field_name in select jsonb_object_keys(patch) order by 1 loop
    if not (map->'fields' ? field_name) then
      raise exception 'The field % cannot be changed this way', field_name using errcode = '22023';
    end if;
    field_type := map->'fields'->>field_name;
    if patch->field_name = 'null'::jsonb then
      assignments := assignments || format(', %I = null', field_name);
    else
      value_text := case when field_type = 'jsonb' then (patch->field_name)::text else patch->>field_name end;
      assignments := assignments || format(', %I = %L::%s', field_name, value_text, field_type);
    end if;
    changed := changed || field_name;
  end loop;
  if assignments = '' then
    raise exception 'Provide at least one field to change' using errcode = '22023';
  end if;
  assignments := ltrim(assignments, ', ');
  scope_kind := map->>'scope';
  perform set_config('tonde.version_action', coalesce(nullif(action, ''), 'update'), true);
  if scope_kind = 'workspace' then
    execute format('update tonde.%I set %s where workspace_id = $1 and id = $2 and ($3 is null or revision = $3) returning revision',
      map->>'table', assignments) using target_workspace, target_object, expected_revision into new_revision;
  else
    execute format('update tonde.%I set %s where workspace_id = $1 and production_id = $2 and id = $3 and ($4 is null or revision = $4) returning revision',
      map->>'table', assignments) using target_workspace, target_production, target_object, expected_revision into new_revision;
  end if;
  perform set_config('tonde.version_action', '', true);
  if new_revision is null then
    raise exception 'That object changed since this change was written. Preview the merge again.' using errcode = '40001';
  end if;
  return jsonb_build_object('object_id', target_object, 'kind', object_row.kind, 'revision', new_revision,
    'changed_fields', to_jsonb(changed), 'action', coalesce(nullif(action,''),'update'));
end $$;
revoke all on function tonde_private.vb_patch_apply(uuid,uuid,uuid,jsonb,integer,text)
  from public, anon, authenticated, service_role;

-- A bounded "structure revision" for a Production, so a merge proposal can be rejected as stale
-- rather than merged against a timeline the creator never previewed.
create function tonde_private.vb_structure_revision(target_workspace uuid, target_production uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(revision), 0)::integer from (
    select revision from tonde.productions where workspace_id = target_workspace and id = target_production
    union all select revision from tonde.acts where workspace_id = target_workspace and production_id = target_production
    union all select revision from tonde.sequences where workspace_id = target_workspace and production_id = target_production
    union all select revision from tonde.scenes where workspace_id = target_workspace and production_id = target_production
    union all select revision from tonde.shots where workspace_id = target_workspace and production_id = target_production) summed;
$$;
revoke all on function tonde_private.vb_structure_revision(uuid,uuid) from public, anon, authenticated, service_role;

-- 8. Version read surface.
create function tonde.version_list(target_workspace uuid, target_production uuid, target_object uuid,
  target_branch text default 'main', target_limit integer default 50, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer; current_revision integer; object_row tonde.objects; branch_value text;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  lim := least(greatest(coalesce(target_limit, 50), 1), 200);
  off := greatest(coalesce(target_offset, 0), 0);
  branch_value := coalesce(nullif(btrim(coalesce(target_branch, '')), ''), 'main');
  select tonde_private.pi_object_revision(target_workspace, target_object) into current_revision;
  select count(*) into total from tonde.object_versions v
    where v.workspace_id = target_workspace and v.object_id = target_object and v.branch_name = branch_value;
  select coalesce(jsonb_agg(jsonb_build_object(
      'version_id', v.id, 'object_id', v.object_id, 'revision', v.revision, 'branch', v.branch_name,
      'parent_version_id', v.parent_version_id, 'actor_type', v.actor_type, 'actor_user_id', v.actor_user_id,
      'source_action', v.source_action, 'created_at', v.created_at,
      'is_current', case when v.branch_name = 'main' and v.revision = current_revision then true else false end)
      order by v.revision desc, v.created_at desc), '[]'::jsonb)
    into items
  from (select * from tonde.object_versions v
    where v.workspace_id = target_workspace and v.object_id = target_object and v.branch_name = branch_value
    order by v.revision desc, v.created_at desc limit lim offset off) v;
  return jsonb_build_object('object_id', target_object, 'object_kind', object_row.kind, 'object_label',
    tonde_private.pi_label(target_workspace, target_object), 'branch', branch_value, 'current_revision', current_revision,
    'items', items, 'total', total, 'limit', lim, 'offset', off, 'truncated', total > off + lim,
    'note', 'Versions are immutable records of what the object was. Historical versions are never edited.');
end $$;

create function tonde.version_get(target_workspace uuid, target_production uuid, target_version uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare version_row tonde.object_versions; object_row tonde.objects; current_revision integer;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  version_row := tonde_private.vb_version(target_workspace, target_version);
  object_row := tonde_private.vb_object(target_workspace, target_production, version_row.object_id);
  select tonde_private.pi_object_revision(target_workspace, version_row.object_id) into current_revision;
  return jsonb_build_object('version_id', version_row.id, 'object_id', version_row.object_id,
    'object_kind', object_row.kind, 'object_label', tonde_private.pi_label(target_workspace, version_row.object_id),
    'revision', version_row.revision, 'branch', version_row.branch_name, 'parent_version_id', version_row.parent_version_id,
    'actor_type', version_row.actor_type, 'actor_user_id', version_row.actor_user_id,
    'source_action', version_row.source_action, 'snapshot', version_row.snapshot, 'created_at', version_row.created_at,
    'is_current', version_row.branch_name = 'main' and version_row.revision = current_revision,
    'note', 'This is what the object was at revision ' || version_row.revision || '. It cannot be edited.');
end $$;

create function tonde.version_compare(target_workspace uuid, target_production uuid, left_version uuid, right_version uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare left_row tonde.object_versions; right_row tonde.object_versions; object_row tonde.objects; changes jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  left_row := tonde_private.vb_version(target_workspace, left_version);
  right_row := tonde_private.vb_version(target_workspace, right_version);
  if left_row.object_id <> right_row.object_id then
    raise exception 'Only versions of the same object can be compared' using errcode = '22023';
  end if;
  object_row := tonde_private.vb_object(target_workspace, target_production, left_row.object_id);
  changes := tonde_private.vb_diff(target_workspace, object_row.kind, left_row.snapshot, right_row.snapshot);
  return jsonb_build_object('object_id', left_row.object_id, 'object_kind', object_row.kind,
    'object_label', tonde_private.pi_label(target_workspace, left_row.object_id),
    'left_version_id', left_row.id, 'left_revision', left_row.revision,
    'right_version_id', right_row.id, 'right_revision', right_row.revision,
    'changes', changes, 'change_count', jsonb_array_length(changes),
    'note', case when jsonb_array_length(changes) = 0 then 'No meaningful creative field changed between these versions.'
      else 'Only meaningful creative fields are shown, not a raw JSON diff.' end);
end $$;

-- 9. Restore: create a NEW current revision based on an older version. Intervening history stays.
create function tonde.version_restore(target_workspace uuid, target_production uuid, target_version uuid,
  note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare version_row tonde.object_versions; object_row tonde.objects; map jsonb; field_name text; field_type text;
  patch jsonb := '{}'::jsonb; result jsonb; current_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  version_row := tonde_private.vb_version(target_workspace, target_version);
  object_row := tonde_private.vb_object(target_workspace, target_production, version_row.object_id);
  map := tonde_private.vb_fields(object_row.kind);
  if map is null then raise exception 'That object kind cannot be restored' using errcode = '22023'; end if;
  for field_name in select jsonb_object_keys(map->'fields') order by 1 loop
    field_type := map->'fields'->>field_name;
    patch := jsonb_set(patch, array[field_name], coalesce(version_row.snapshot->field_name, 'null'::jsonb), true);
  end loop;
  current_revision := tonde_private.pi_object_revision(target_workspace, version_row.object_id);
  if current_revision = version_row.revision then
    raise exception 'That version is already the current revision' using errcode = '23514';
  end if;
  result := tonde_private.vb_patch_apply(target_workspace, target_production, version_row.object_id, patch, current_revision, 'restore');
  return jsonb_build_object('object_id', version_row.object_id, 'restored_from_version_id', version_row.id,
    'restored_from_revision', version_row.revision, 'new_revision', result->'revision',
    'changed_fields', result->'changed_fields', 'note_text', left(coalesce(note_text,''), 400),
    'note', 'A new current revision was created from an older version. Nothing was rewound and no history was deleted.');
end $$;

-- 10. Branches.
create function tonde.branch_create(target_workspace uuid, target_production uuid, scope_object uuid, branch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare object_row tonde.objects; created tonde.object_branches; scope_value text; name_value text;
  source_version uuid; source_rev integer; version_row tonde.object_versions;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(branch) <> 'object' then raise exception 'Invalid branch payload' using errcode = '22023'; end if;
  object_row := tonde_private.vb_object(target_workspace, target_production, scope_object);
  name_value := btrim(coalesce(branch->>'name', ''));
  if length(name_value) = 0 or length(name_value) > 160 then
    raise exception 'A branch needs a name of 1 to 160 characters' using errcode = '22023';
  end if;
  scope_value := coalesce(nullif(branch->>'scope',''), 'production');
  if scope_value not in ('story','script','act','sequence','scene','shot','execution_plan','asset') then
    raise exception 'Unsupported branch scope' using errcode = '22023';
  end if;
  -- The declared scope must describe the object actually being branched, or the branch would
  -- report a scope that is not true.
  if not ((object_row.kind = 'creative_document' and scope_value in ('story','script'))
    or (object_row.kind = 'scene' and scope_value = 'scene')
    or (object_row.kind = 'shot' and scope_value = 'shot')
    or (object_row.kind = 'execution_plan' and scope_value = 'execution_plan')
    or (object_row.kind = 'act' and scope_value = 'act')
    or (object_row.kind = 'sequence' and scope_value = 'sequence')
    or (object_row.kind = 'asset' and scope_value = 'asset')) then
    raise exception 'The branch scope must match the object it branches' using errcode = '22023';
  end if;
  if coalesce(branch->>'source_version_id','') <> '' then
    source_version := (branch->>'source_version_id')::uuid;
    version_row := tonde_private.vb_version(target_workspace, source_version);
    if version_row.object_id <> scope_object then
      raise exception 'A branch must originate from a version of its scope object' using errcode = '22023';
    end if;
    source_rev := version_row.revision;
  else
    source_version := tonde_private.vb_latest_version(target_workspace, scope_object);
    source_rev := case when source_version is null then null
      else tonde_private.pi_object_revision(target_workspace, scope_object) end;
  end if;
  insert into tonde.object_branches(workspace_id, production_id, scope_object_id, scope, name, source_version_id,
    source_revision, reason)
  values (target_workspace, target_production, scope_object, scope_value, left(name_value,160), source_version,
    source_rev, left(coalesce(branch->>'reason',''),600))
  returning * into created;
  return jsonb_build_object('branch_id', created.id, 'name', created.name, 'scope', created.scope,
    'scope_object_id', created.scope_object_id, 'source_version_id', created.source_version_id,
    'source_revision', created.source_revision, 'state', created.state,
    'note', 'The branch is an alternative. Nothing on the mainline changed.');
end $$;

create function tonde.branch_list(target_workspace uuid, target_production uuid, target_state text default null,
  target_limit integer default 50, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  lim := least(greatest(coalesce(target_limit, 50), 1), 200);
  off := greatest(coalesce(target_offset, 0), 0);
  if target_state is not null and target_state not in ('open','merged','abandoned') then
    raise exception 'Unsupported branch state' using errcode = '22023';
  end if;
  select count(*) into total from tonde.object_branches b
    where b.workspace_id = target_workspace and b.production_id = target_production
      and (target_state is null or b.state = target_state::tonde.branch_state);
  select coalesce(jsonb_agg(jsonb_build_object(
      'branch_id', b.id, 'name', b.name, 'scope', b.scope, 'scope_object_id', b.scope_object_id,
      'scope_object_label', tonde_private.pi_label(target_workspace, b.scope_object_id),
      'source_version_id', b.source_version_id, 'source_revision', b.source_revision,
      'state', b.state, 'reason', b.reason, 'merged_at', b.merged_at, 'merged_proposal_id', b.merged_proposal_id,
      'changes', (select count(*) from tonde.branch_changes c where c.branch_id = b.id and c.state = 'pending'),
      'created_at', b.created_at, 'updated_at', b.updated_at) order by b.created_at desc), '[]'::jsonb)
    into items
  from (select * from tonde.object_branches b
    where b.workspace_id = target_workspace and b.production_id = target_production
      and (target_state is null or b.state = target_state::tonde.branch_state)
    order by b.created_at desc limit lim offset off) b;
  return jsonb_build_object('items', items, 'total', total, 'limit', lim, 'offset', off, 'truncated', total > off + lim,
    'note', 'A branch is an object-level alternative, not a duplicate Production.');
end $$;

create function tonde.branch_detail(target_workspace uuid, target_production uuid, target_branch uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b tonde.object_branches; changes jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  select * into b from tonde.object_branches where workspace_id = target_workspace and id = target_branch
    and production_id = target_production;
  if not found then raise exception 'That branch is unavailable' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'change_id', c.id, 'target_object_id', c.target_object_id,
      'target_label', tonde_private.pi_label(target_workspace, c.target_object_id),
      'target_kind', (select kind from tonde.objects where workspace_id = target_workspace and id = c.target_object_id),
      'base_version_id', c.base_version_id, 'base_revision', c.base_revision, 'patch', c.patch,
      'changed_fields', to_jsonb(c.changed_fields), 'note', c.note, 'state', c.state,
      'applied_version_id', c.applied_version_id, 'applied_revision', c.applied_revision,
      'current_revision', tonde_private.pi_object_revision(target_workspace, c.target_object_id),
      'created_at', c.created_at) order by c.created_at), '[]'::jsonb)
    into changes
  from tonde.branch_changes c where c.workspace_id = target_workspace and c.branch_id = b.id;
  return jsonb_build_object('branch_id', b.id, 'name', b.name, 'scope', b.scope, 'scope_object_id', b.scope_object_id,
    'scope_object_label', tonde_private.pi_label(target_workspace, b.scope_object_id),
    'source_version_id', b.source_version_id, 'source_revision', b.source_revision, 'reason', b.reason,
    'state', b.state, 'merged_at', b.merged_at, 'merged_proposal_id', b.merged_proposal_id,
    'changes', changes, 'change_count', jsonb_array_length(changes),
    'note', 'Branch edits never change the mainline. Only an accepted merge does.');
end $$;

-- Record or replace a proposed change on a branch. Nothing on the mainline is touched.
create function tonde.branch_change_set(target_workspace uuid, target_production uuid, target_branch uuid, change jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b tonde.object_branches; object_row tonde.objects; map jsonb; field_name text; target uuid;
  patch_value jsonb; note_value text; existing tonde.branch_changes; base_version uuid; base_rev integer; changed_list text[] := '{}';
  result tonde.branch_changes;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(change) <> 'object' then raise exception 'Invalid branch change payload' using errcode = '22023'; end if;
  select * into b from tonde.object_branches where workspace_id = target_workspace and id = target_branch
    and production_id = target_production;
  if not found then raise exception 'That branch is unavailable' using errcode = 'P0002'; end if;
  if b.state <> 'open' then raise exception 'That branch is not open' using errcode = '23514'; end if;
  if coalesce(change->>'target_object_id','') = '' then
    raise exception 'A branch change names the object it changes' using errcode = '22023';
  end if;
  target := (change->>'target_object_id')::uuid;
  object_row := tonde_private.vb_object(target_workspace, target_production, target);
  map := tonde_private.vb_fields(object_row.kind);
  if map is null then raise exception 'That object kind cannot change on a branch' using errcode = '22023'; end if;
  patch_value := coalesce(change->'patch', '{}'::jsonb);
  if jsonb_typeof(patch_value) <> 'object' then raise exception 'A branch change patch is an object of fields' using errcode = '22023'; end if;
  for field_name in select jsonb_object_keys(patch_value) order by 1 loop
    if not (map->'fields' ? field_name) then
      raise exception 'The field % cannot change on a branch', field_name using errcode = '22023';
    end if;
    changed_list := changed_list || field_name;
  end loop;
  if coalesce(array_length(changed_list, 1), 0) = 0 then
    raise exception 'Provide at least one field to change' using errcode = '22023';
  end if;
  note_value := left(coalesce(change->>'note',''), 600);
  base_version := tonde_private.vb_latest_version(target_workspace, target);
  base_rev := tonde_private.pi_object_revision(target_workspace, target);
  select * into existing from tonde.branch_changes
    where workspace_id = target_workspace and branch_id = b.id and target_object_id = target;
  if found then
    update tonde.branch_changes c set patch = patch_value, changed_fields = changed_list, note = note_value,
      base_version_id = base_version, base_revision = base_rev, state = 'pending',
      applied_version_id = null, applied_revision = null
    where c.id = existing.id returning * into result;
  else
    insert into tonde.branch_changes(workspace_id, production_id, branch_id, target_object_id, base_version_id,
      base_revision, patch, changed_fields, note)
    values (target_workspace, target_production, b.id, target, base_version, base_rev, patch_value, changed_list, note_value)
    returning * into result;
  end if;
  return jsonb_build_object('change_id', result.id, 'branch_id', b.id, 'target_object_id', result.target_object_id,
    'target_label', tonde_private.pi_label(target_workspace, result.target_object_id), 'target_kind', object_row.kind,
    'base_revision', result.base_revision, 'changed_fields', to_jsonb(result.changed_fields), 'state', result.state,
    'note', 'Recorded on the branch. The mainline is unchanged until a merge is accepted.');
end $$;

create function tonde.branch_change_clear(target_workspace uuid, target_production uuid, target_branch uuid,
  target_change uuid, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b tonde.object_branches; c tonde.branch_changes;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into b from tonde.object_branches where workspace_id = target_workspace and id = target_branch
    and production_id = target_production;
  if not found then raise exception 'That branch is unavailable' using errcode = 'P0002'; end if;
  select * into c from tonde.branch_changes where workspace_id = target_workspace and branch_id = b.id and id = target_change;
  if not found then raise exception 'That branch change is unavailable' using errcode = 'P0002'; end if;
  if c.state = 'applied' then raise exception 'That change was already merged' using errcode = '23514'; end if;
  update tonde.branch_changes ch set state = 'rejected', note = left(coalesce(note_text, ch.note), 600)
    where ch.id = c.id;
  return jsonb_build_object('change_id', c.id, 'state', 'rejected',
    'note', 'The proposed change was discarded. It stays readable as branch history.');
end $$;

create function tonde.branch_state_set(target_workspace uuid, target_production uuid, target_branch uuid,
  desired_state text, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b tonde.object_branches;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if desired_state not in ('open','abandoned') then
    raise exception 'A branch is opened or abandoned here; merging happens through a merge decision' using errcode = '22023';
  end if;
  select * into b from tonde.object_branches where workspace_id = target_workspace and id = target_branch
    and production_id = target_production;
  if not found then raise exception 'That branch is unavailable' using errcode = 'P0002'; end if;
  if b.state = 'merged' then raise exception 'A merged branch is closed history' using errcode = '23514'; end if;
  update tonde.object_branches br set state = desired_state::tonde.branch_state, reason = left(coalesce(nullif(note_text,''), br.reason), 600)
    where br.id = b.id;
  return jsonb_build_object('branch_id', b.id, 'state', desired_state,
    'note', case when desired_state = 'abandoned' then 'The branch was abandoned. Its history stays readable.'
      else 'The branch is open again.' end);
end $$;

-- 11. Merge preview. A reviewed proposal: every pending change is classified clean or conflicted,
-- pinned to the revision it was written from, and a dependency-aware impact summary is recorded.
create function tonde.merge_preview(target_workspace uuid, target_production uuid, target_branch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b tonde.object_branches; change_row tonde.branch_changes; object_row tonde.objects; map jsonb;
  items jsonb := '[]'::jsonb; conflicts jsonb := '[]'::jsonb; clean_count integer := 0; conflict_count integer := 0;
  current_rev integer; field_name text; field_type text; field_conflicts jsonb; base_snapshot jsonb; current_snapshot jsonb;
  schema_table text; scope_kind text; base_ver tonde.object_versions; proposal uuid; structure_rev integer;
  impact_map jsonb := '{}'::jsonb; target_ids uuid[] := '{}';
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into b from tonde.object_branches where workspace_id = target_workspace and id = target_branch
    and production_id = target_production;
  if not found then raise exception 'That branch is unavailable' using errcode = 'P0002'; end if;
  if b.state <> 'open' then raise exception 'That branch is not open' using errcode = '23514'; end if;
  structure_rev := tonde_private.vb_structure_revision(target_workspace, target_production);
  for change_row in select * from tonde.branch_changes c
    where c.workspace_id = target_workspace and c.branch_id = b.id and c.state in ('pending','conflicted')
    order by c.created_at loop
    object_row := tonde_private.vb_object(target_workspace, target_production, change_row.target_object_id);
    map := tonde_private.vb_fields(object_row.kind);
    current_rev := tonde_private.pi_object_revision(target_workspace, change_row.target_object_id);
    base_ver := case when change_row.base_version_id is null then null
      else tonde_private.vb_version(target_workspace, change_row.base_version_id) end;
    base_snapshot := coalesce(base_ver.snapshot, '{}'::jsonb);
    schema_table := map->>'table';
    scope_kind := map->>'scope';
    if scope_kind = 'workspace' then
      execute format('select to_jsonb(t) from tonde.%I t where t.workspace_id = $1 and t.id = $2',
        schema_table) using target_workspace, change_row.target_object_id into current_snapshot;
    else
      execute format('select to_jsonb(t) from tonde.%I t where t.workspace_id = $1 and t.production_id = $2 and t.id = $3',
        schema_table) using target_workspace, target_production, change_row.target_object_id into current_snapshot;
    end if;
    field_conflicts := '[]'::jsonb;
    if change_row.base_revision is distinct from current_rev then
      for field_name in select unnest(change_row.changed_fields) order by 1 loop
        field_type := map->'fields'->>field_name;
        -- A real conflict: main moved AND the branch changes the same field to a different value.
        if (current_snapshot -> field_name) is distinct from (base_snapshot -> field_name)
          and (change_row.patch -> field_name) is distinct from (current_snapshot -> field_name) then
          field_conflicts := field_conflicts || jsonb_build_array(jsonb_build_object(
            'field', field_name, 'label', tonde_private.vb_field_label(field_name),
            'branch_value', coalesce(change_row.patch -> field_name, 'null'::jsonb),
            'main_value', coalesce(current_snapshot -> field_name, 'null'::jsonb),
            'base_value', coalesce(base_snapshot -> field_name, 'null'::jsonb)));
        end if;
      end loop;
    end if;
    if change_row.base_revision is distinct from current_rev then
      conflict_count := conflict_count + 1;
      items := items || jsonb_build_array(jsonb_build_object(
        'change_id', change_row.id, 'target_object_id', change_row.target_object_id,
        'target_label', tonde_private.pi_label(target_workspace, change_row.target_object_id),
        'target_kind', object_row.kind, 'base_revision', change_row.base_revision, 'current_revision', current_rev,
        'changed_fields', to_jsonb(change_row.changed_fields), 'status', 'conflict', 'conflicts', field_conflicts));
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'change_id', change_row.id, 'target_object_id', change_row.target_object_id,
        'target_label', tonde_private.pi_label(target_workspace, change_row.target_object_id),
        'base_revision', change_row.base_revision, 'current_revision', current_rev,
        'reason', 'The mainline moved after this branch change was written.',
        'fields', field_conflicts));
    else
      clean_count := clean_count + 1;
      items := items || jsonb_build_array(jsonb_build_object(
        'change_id', change_row.id, 'target_object_id', change_row.target_object_id,
        'target_label', tonde_private.pi_label(target_workspace, change_row.target_object_id),
        'target_kind', object_row.kind, 'base_revision', change_row.base_revision, 'current_revision', current_rev,
        'changed_fields', to_jsonb(change_row.changed_fields), 'status', 'clean', 'conflicts', '[]'::jsonb));
      target_ids := target_ids || change_row.target_object_id;
    end if;
  end loop;
  -- Dependency-aware impact of what the merge would touch, computed but not applied.
  if coalesce(array_length(target_ids, 1), 0) > 0 then
    select coalesce(jsonb_object_agg(entry.object_id::text, entry.summary), '{}'::jsonb) into impact_map
    from (
      select t as object_id,
        jsonb_build_object(
          'direct', (select count(*) from jsonb_array_elements(g->'nodes') n where n->>'classification' = 'direct'),
          'downstream', (select count(*) from jsonb_array_elements(g->'nodes') n where n->>'classification' = 'downstream'),
          'potential', (select count(*) from jsonb_array_elements(g->'nodes') n where n->>'classification' = 'potential'),
          'total', jsonb_array_length(g->'nodes'),
          'truncated', coalesce((g->>'truncated')::boolean, false)) as summary
      from unnest(target_ids) as t
      cross join lateral (select tonde.dependency_graph(target_workspace, target_production, t, 'forward', 2, 100) as g) graph_row
    ) entry;
  end if;
  insert into tonde.merge_proposals(workspace_id, production_id, branch_id, items, conflicts, counts, structure_revision, impact)
  values (target_workspace, target_production, b.id, items, conflicts,
    jsonb_build_object('clean', clean_count, 'conflicted', conflict_count, 'total', clean_count + conflict_count),
    structure_rev, jsonb_build_object('targets', impact_map, 'note', 'Impact is computed, never applied, by this preview.'))
  returning id into proposal;
  update tonde.branch_changes c set state = case when c.base_revision is distinct from
      tonde_private.pi_object_revision(target_workspace, c.target_object_id) then 'conflicted'::tonde.branch_change_state
      else 'pending'::tonde.branch_change_state end
    where c.workspace_id = target_workspace and c.branch_id = b.id and c.state in ('pending','conflicted');
  return jsonb_build_object('proposal_id', proposal, 'branch_id', b.id, 'branch_name', b.name,
    'structure_revision', structure_rev, 'items', items, 'conflicts', conflicts,
    'counts', jsonb_build_object('clean', clean_count, 'conflicted', conflict_count, 'total', clean_count + conflict_count),
    'impact', impact_map, 'state', 'proposed',
    'note', 'Merge is a proposal. Conflicted changes are never resolved automatically.');
end $$;

-- 12. Merge decision. Accepting applies only the selected clean changes as NEW mainline revisions,
-- then propagates the consequence through the 9A impact engine. Rejecting changes nothing.
create function tonde.merge_decide(target_workspace uuid, target_production uuid, target_proposal uuid,
  decision text, selected_ids uuid[] default '{}', propagation text default 'change_only_this', note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare proposal tonde.merge_proposals; b tonde.object_branches; change_row tonde.branch_changes; applied_items jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb; result jsonb; analysis jsonb; propagation_result jsonb; impact_summary jsonb := '[]'::jsonb;
  applied_count integer := 0; current_rev integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if decision not in ('merge','reject') then raise exception 'A merge decision is merge or reject' using errcode = '22023'; end if;
  if coalesce(propagation,'') not in ('update_all','review_changes','change_only_this') then
    raise exception 'Unsupported propagation mode' using errcode = '22023';
  end if;
  select * into proposal from tonde.merge_proposals
    where workspace_id = target_workspace and production_id = target_production and id = target_proposal;
  if not found then raise exception 'That merge proposal is unavailable' using errcode = 'P0002'; end if;
  if proposal.state <> 'proposed' then raise exception 'That merge proposal was already decided' using errcode = '23514'; end if;
  if proposal.structure_revision is distinct from tonde_private.vb_structure_revision(target_workspace, target_production) then
    raise exception 'The Production changed since this merge was previewed. Preview the merge again.' using errcode = '40001';
  end if;
  select * into b from tonde.object_branches where workspace_id = target_workspace and id = proposal.branch_id;
  if decision = 'reject' then
    update tonde.merge_proposals p set state = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = left(coalesce(note_text,''), 800) where p.id = proposal.id;
    return jsonb_build_object('proposal_id', proposal.id, 'branch_id', b.id, 'state', 'rejected',
      'applied', '[]'::jsonb, 'note', 'The merge was rejected. The mainline and the branch are unchanged.');
  end if;
  for change_row in select * from tonde.branch_changes c
    where c.workspace_id = target_workspace and c.branch_id = b.id and c.state = 'pending'
    order by c.created_at loop
    if coalesce(array_length(selected_ids, 1), 0) > 0 and not (change_row.id = any(selected_ids)) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('change_id', change_row.id,
        'target_object_id', change_row.target_object_id, 'reason', 'not selected'));
      continue;
    end if;
    result := tonde_private.vb_patch_apply(target_workspace, target_production, change_row.target_object_id,
      change_row.patch, change_row.base_revision, 'merge');
    update tonde.branch_changes c set state = 'applied', applied_revision = (result->>'revision')::integer,
      applied_version_id = tonde_private.vb_latest_version(target_workspace, change_row.target_object_id)
      where c.id = change_row.id;
    applied_count := applied_count + 1;
    applied_items := applied_items || jsonb_build_array(jsonb_build_object('change_id', change_row.id,
      'target_object_id', change_row.target_object_id,
      'target_label', tonde_private.pi_label(target_workspace, change_row.target_object_id),
      'revision', (result->>'revision')::integer, 'changed_fields', result->'changed_fields'));
    -- Propagate the consequence through the dependency-aware impact engine.
    analysis := tonde.impact_preview(target_workspace, target_production, change_row.target_object_id, 2, 200);
    propagation_result := tonde.apply_impact(target_workspace, target_production, (analysis->>'analysis_id')::uuid,
      propagation, '{}'::uuid[], null, 'Merged from branch ' || b.name);
    impact_summary := impact_summary || jsonb_build_array(jsonb_build_object(
      'object_id', change_row.target_object_id, 'analysis_id', analysis->>'analysis_id',
      'mode', propagation, 'counts', analysis->'counts', 'marked', propagation_result->'marked',
      'requiring_review', propagation_result->'requiring_review', 'locked_skipped', propagation_result->'locked_skipped',
      'unresolved_count', propagation_result->'unresolved_count'));
  end loop;
  update tonde.merge_proposals p set state = 'merged', decided_by = auth.uid(), decided_at = now(),
    decision_note = left(coalesce(note_text,''), 800), applied = applied_items,
    impact = jsonb_set(p.impact, '{propagation}', to_jsonb(impact_summary), true)
    where p.id = proposal.id;
  update tonde.object_branches br set state = 'merged', merged_at = now(), merged_by = auth.uid(),
    merged_proposal_id = proposal.id where br.id = b.id;
  return jsonb_build_object('proposal_id', proposal.id, 'branch_id', b.id, 'state', 'merged',
    'applied', applied_items, 'applied_count', applied_count, 'skipped', skipped, 'propagation', propagation,
    'impact', impact_summary,
    'note', case when applied_count = 0
        then 'Nothing was merged: no clean change was selected.'
      else 'New mainline revisions were created. Branch history is preserved.' end);
end $$;

-- 13. RLS. Every new table is workspace-isolated; enabling RLS is not optional.
do $$ declare item text; begin
  foreach item in array array['object_branches','branch_changes','merge_proposals'] loop
    execute format('alter table tonde.%I enable row level security', item);
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', item);
    execute format('create policy tenant_insert on tonde.%I for insert to authenticated with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('create policy tenant_update on tonde.%I for update to authenticated using (tonde_private.can_edit_workspace(workspace_id)) with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('grant select on tonde.%I to authenticated', item);
  end loop;
end $$;

-- 14. Mutation guards: identity stays immutable, revisions auto-bump, no row is rewritten.
do $$ declare item text; begin
  foreach item in array array['object_branches','branch_changes','merge_proposals'] loop
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', item);
  end loop;
end $$;

-- 15. Privileges: authenticated only, and the private helpers stay unreachable.
revoke all on function
  tonde.version_list(uuid,uuid,uuid,text,integer,integer),
  tonde.version_get(uuid,uuid,uuid),
  tonde.version_compare(uuid,uuid,uuid,uuid),
  tonde.version_restore(uuid,uuid,uuid,text),
  tonde.branch_create(uuid,uuid,uuid,jsonb),
  tonde.branch_list(uuid,uuid,text,integer,integer),
  tonde.branch_detail(uuid,uuid,uuid),
  tonde.branch_change_set(uuid,uuid,uuid,jsonb),
  tonde.branch_change_clear(uuid,uuid,uuid,uuid,text),
  tonde.branch_state_set(uuid,uuid,uuid,text,text),
  tonde.merge_preview(uuid,uuid,uuid),
  tonde.merge_decide(uuid,uuid,uuid,text,uuid[],text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  tonde.version_list(uuid,uuid,uuid,text,integer,integer),
  tonde.version_get(uuid,uuid,uuid),
  tonde.version_compare(uuid,uuid,uuid,uuid),
  tonde.version_restore(uuid,uuid,uuid,text),
  tonde.branch_create(uuid,uuid,uuid,jsonb),
  tonde.branch_list(uuid,uuid,text,integer,integer),
  tonde.branch_detail(uuid,uuid,uuid),
  tonde.branch_change_set(uuid,uuid,uuid,jsonb),
  tonde.branch_change_clear(uuid,uuid,uuid,uuid,text),
  tonde.branch_state_set(uuid,uuid,uuid,text,text),
  tonde.merge_preview(uuid,uuid,uuid),
  tonde.merge_decide(uuid,uuid,uuid,text,uuid[],text,text)
  to authenticated;
commit;
