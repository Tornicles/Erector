begin;

-- 1. Vocabulary. Storage codes are the generated product vocabulary keys.
create type tonde.dependency_strength as enum ('hard','soft','advisory');
create type tonde.dependency_origin as enum ('explicit','derived','inferred');
create type tonde.impact_class as enum ('direct','downstream','potential','unaffected','unknown');
create type tonde.impact_mode as enum ('preview','update_all','review_changes','change_only_this');
create type tonde.artifact_kind as enum
  ('real_plan','ai_plan','prompt','first_frame','last_frame','generation_context','result_comparison',
   'derived_summary','continuity_state','continuity_analysis','deliverable','dependent_object','other');
create type tonde.stale_state as enum ('current','stale','conflicted');

-- 2. Dependency edge metadata. The relation vocabulary gains the categories the product
-- actually needs (runtime, asset, result, state) instead of overloading existing strings.
alter table tonde.object_dependencies drop constraint object_dependencies_relation_check;
alter table tonde.object_dependencies add constraint object_dependencies_relation_check check (relation in
  ('creative','continuity','execution','reference','derived_from','runtime','asset','result','state'));
alter table tonde.object_dependencies add column reason text not null default '' check (length(reason) <= 600);
alter table tonde.object_dependencies add column strength tonde.dependency_strength not null default 'soft';
alter table tonde.object_dependencies add column origin tonde.dependency_origin not null default 'explicit';
alter table tonde.object_dependencies add column affected_fields text[] not null default '{}';
alter table tonde.object_dependencies add column source_version integer check (source_version is null or source_version > 0);
alter table tonde.object_dependencies add column target_version integer check (target_version is null or target_version > 0);
alter table tonde.object_dependencies add column active boolean not null default true;
alter table tonde.object_dependencies add column note text not null default '' check (length(note) <= 400);
alter table tonde.object_dependencies add column evidence jsonb not null default '{}' check (jsonb_typeof(evidence) = 'object');
alter table tonde.object_dependencies add column created_by uuid references auth.users(id) on delete set null;
alter table tonde.object_dependencies add column created_at timestamptz not null default now();
alter table tonde.object_dependencies add column updated_at timestamptz not null default now();
alter table tonde.object_dependencies add column revision integer not null default 1 check (revision > 0);
create index object_dependencies_source on tonde.object_dependencies(workspace_id, source_object_id, relation) where active;
create index object_dependencies_target on tonde.object_dependencies(workspace_id, target_object_id, relation) where active;

-- 3. Stale artifacts. A changed source never deletes derived work: the artifact is marked and
-- keeps its reason, the causing object, and both revisions so the mismatch is inspectable.
create table tonde.stale_artifacts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  artifact_kind tonde.artifact_kind not null,
  artifact_ref uuid, object_id uuid not null,
  state tonde.stale_state not null default 'stale',
  reason text not null check (length(btrim(reason)) between 1 and 600),
  caused_by_object_id uuid, caused_by_revision integer check (caused_by_revision is null or caused_by_revision > 0),
  source_revision integer check (source_revision is null or source_revision > 0),
  current_revision integer check (current_revision is null or current_revision > 0),
  note text not null default '' check (length(note) <= 400),
  revision integer not null default 1 check (revision > 0),
  resolved_at timestamptz, resolved_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, caused_by_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create unique index stale_artifacts_identity on tonde.stale_artifacts(workspace_id, artifact_kind, object_id, coalesce(artifact_ref, object_id));
create index stale_artifacts_open on tonde.stale_artifacts(workspace_id, production_id, state) where state <> 'current';

-- 4. Impact analyses. A preview is a durable record pinned to the root revision it was
-- computed from, so a later apply can reject a stale operation instead of guessing.
create table tonde.impact_analyses (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  root_object_id uuid not null, root_label text not null default '' check (length(root_label) <= 160),
  root_kind text not null default '' check (length(root_kind) <= 40),
  root_revision integer not null check (root_revision > 0),
  structure_revision integer check (structure_revision is null or structure_revision > 0),
  direction text not null default 'forward' check (direction in ('forward','reverse')),
  requested_depth integer not null default 2 check (requested_depth between 1 and 8),
  mode tonde.impact_mode not null default 'preview',
  classifications jsonb not null default '{}' check (jsonb_typeof(classifications) = 'object'),
  counts jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  locked_ids uuid[] not null default '{}',
  approved_ids uuid[] not null default '{}',
  explanation text not null default '' check (length(explanation) <= 1200),
  unresolved_count integer not null default 0 check (unresolved_count >= 0),
  note text not null default '' check (length(note) <= 400),
  applied_mode tonde.impact_mode, applied_at timestamptz,
  created_by uuid not null default auth.uid(),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, root_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create index impact_analyses_recent on tonde.impact_analyses(workspace_id, production_id, created_at desc);

-- 5. Shared helpers (not user-facing).
create function tonde_private.pi_read_guard(target_workspace uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
end $$;
revoke all on function tonde_private.pi_read_guard(uuid) from public, anon, authenticated, service_role;

-- The creator-facing name of an object. Never invented: an unknown kind falls back to its kind.
create function tonde_private.pi_label(target_workspace uuid, target_object uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare kind text; label text;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  if kind is null then return null; end if;
  case kind
    when 'production' then select title into label from tonde.productions where id = target_object;
    when 'act' then select title into label from tonde.acts where id = target_object;
    when 'sequence' then select title into label from tonde.sequences where id = target_object;
    when 'scene' then select title into label from tonde.scenes where id = target_object;
    when 'shot' then select title into label from tonde.shots where id = target_object;
    when 'asset' then select name into label from tonde.assets where id = target_object;
    when 'reference' then select coalesce(nullif(source_description,''), source_url, 'Reference')
      into label from tonde.production_references where id = target_object;
    when 'execution_plan' then select case when execution_method = 'ai' then 'AI plan' else 'Real plan' end
      into label from tonde.execution_plans where id = target_object;
    when 'creative_document' then select coalesce(nullif(title,''),'Document') into label from tonde.creative_documents where id = target_object;
    when 'dialogue_line' then select left(coalesce(content,''), 60) into label from tonde.dialogue_lines where id = target_object;
    when 'result' then select 'Result' into label from tonde.results where id = target_object;
    when 'episode' then select title into label from tonde.series_episodes where id = target_object;
    when 'series' then select title into label from tonde.series where id = target_object;
    when 'project' then select title into label from tonde.projects where id = target_object;
    else label := kind;
  end case;
  return coalesce(nullif(btrim(coalesce(label,'')),''), kind);
end $$;
revoke all on function tonde_private.pi_label(uuid,uuid) from public, anon, authenticated, service_role;

-- The revision of any canonical object, read from the table that owns it.
create function tonde_private.pi_object_revision(target_workspace uuid, target_object uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare kind text; value integer;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  case kind
    when 'production' then select revision into value from tonde.productions where id = target_object;
    when 'act' then select revision into value from tonde.acts where id = target_object;
    when 'sequence' then select revision into value from tonde.sequences where id = target_object;
    when 'scene' then select revision into value from tonde.scenes where id = target_object;
    when 'shot' then select revision into value from tonde.shots where id = target_object;
    when 'asset' then select revision into value from tonde.assets where id = target_object;
    when 'reference' then select 1 into value;
    when 'execution_plan' then select revision into value from tonde.execution_plans where id = target_object;
    when 'creative_document' then select revision into value from tonde.creative_documents where id = target_object;
    when 'dialogue_line' then select revision into value from tonde.dialogue_lines where id = target_object;
    when 'result' then select revision into value from tonde.results where id = target_object;
    when 'episode' then select revision into value from tonde.series_episodes where id = target_object;
    when 'series' then select revision into value from tonde.series where id = target_object;
    else value := null;
  end case;
  return value;
end $$;
revoke all on function tonde_private.pi_object_revision(uuid,uuid) from public, anon, authenticated, service_role;

-- Is a canonical object locked? An object is locked when its own lock column is set or when an
-- enclosing scope (Shot -> Scene -> Act -> Sequence -> Production) is locked by the creator.
create function tonde_private.pi_is_locked(target_workspace uuid, target_object uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare kind text; locked boolean := false; scene_ref uuid; act_ref uuid; sequence_ref uuid;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  if kind = 'shot' then
    select locked_at is not null, scene_id into locked, scene_ref from tonde.shots where id = target_object;
    if not locked and scene_ref is not null then
      select locked_at is not null into locked from tonde.scenes where id = scene_ref;
    end if;
  elsif kind = 'scene' then
    select locked_at is not null into locked from tonde.scenes where id = target_object;
  elsif kind = 'act' then
    select locked_at is not null into locked from tonde.acts where id = target_object;
  elsif kind = 'sequence' then
    select locked_at is not null into locked from tonde.sequences where id = target_object;
  elsif kind = 'asset' then
    select locked_at is not null into locked from tonde.assets where id = target_object;
  elsif kind = 'execution_plan' then
    select locked_at is not null into locked from tonde.execution_plans where id = target_object;
  elsif kind = 'dialogue_line' then
    select locked_at is not null into locked from tonde.dialogue_lines where id = target_object;
  elsif kind = 'creative_document' then
    select locked_at is not null into locked from tonde.creative_documents where id = target_object;
  end if;
  return coalesce(locked, false);
end $$;
revoke all on function tonde_private.pi_is_locked(uuid,uuid) from public, anon, authenticated, service_role;

create function tonde_private.pi_is_approved(target_workspace uuid, target_object uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare kind text; status text;
begin
  select o.kind into kind from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  case kind
    when 'production' then select approval::text into status from tonde.productions where id = target_object;
    when 'act' then select approval::text into status from tonde.acts where id = target_object;
    when 'sequence' then select approval::text into status from tonde.sequences where id = target_object;
    when 'scene' then select approval::text into status from tonde.scenes where id = target_object;
    when 'shot' then select approval::text into status from tonde.shots where id = target_object;
    when 'execution_plan' then select approval::text into status from tonde.execution_plans where id = target_object;
    when 'dialogue_line' then select approval::text into status from tonde.dialogue_lines where id = target_object;
    when 'creative_document' then select approval::text into status from tonde.creative_documents where id = target_object;
    when 'result' then select approval::text into status from tonde.results where id = target_object;
    else status := null;
  end case;
  return status in ('approved','changed_after_approval');
end $$;
revoke all on function tonde_private.pi_is_approved(uuid,uuid) from public, anon, authenticated, service_role;

-- Bounded, cycle-safe traversal. `seen` carries the visited path so a legitimate creative
-- cycle (A depends on B depends on A) terminates instead of recursing forever.
create function tonde_private.pi_walk(target_workspace uuid, root uuid, max_depth integer, direction text)
returns table (object_id uuid, depth integer, relation text, via uuid)
language sql stable security definer set search_path = '' as $$
  with recursive walk as (
    select case when direction = 'reverse' then d.source_object_id else d.target_object_id end as object_id,
      1 as depth, d.relation, case when direction = 'reverse' then d.target_object_id else d.source_object_id end as via,
      array[root, case when direction = 'reverse' then d.source_object_id else d.target_object_id end] as seen
    from tonde.object_dependencies d
    where d.workspace_id = target_workspace and d.active
      and ((direction = 'reverse' and d.target_object_id = root) or (direction <> 'reverse' and d.source_object_id = root))
    union all
    select case when direction = 'reverse' then d.source_object_id else d.target_object_id end,
      w.depth + 1, d.relation, case when direction = 'reverse' then d.target_object_id else d.source_object_id end,
      w.seen || case when direction = 'reverse' then d.source_object_id else d.target_object_id end
    from tonde.object_dependencies d
    join walk w on (case when direction = 'reverse' then d.target_object_id else d.source_object_id end) = w.object_id
    where d.workspace_id = target_workspace and d.active and w.depth < greatest(coalesce(max_depth, 1), 1)
      and not (case when direction = 'reverse' then d.source_object_id else d.target_object_id end = any(w.seen))
  )
  select w.object_id, min(w.depth) as depth, (array_agg(w.relation order by w.depth))[1] as relation,
    (array_agg(w.via order by w.depth))[1] as via
  from walk w group by w.object_id;
$$;
revoke all on function tonde_private.pi_walk(uuid,uuid,integer,text) from public, anon, authenticated, service_role;

-- A creator-facing sentence, built from the real direct edges, never from a generic template.
create function tonde_private.pi_explain(target_workspace uuid, target_object uuid, direct_count integer,
  downstream_count integer, sample_reason text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare label text; kind text; sentence text;
begin
  label := tonde_private.pi_label(target_workspace, target_object);
  select o.kind into kind from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  if direct_count = 0 and downstream_count = 0 then
    return 'Changing ' || coalesce(label, 'this object') || ' has no known dependents in this Production.';
  end if;
  sentence := 'Changing ' || coalesce(label, 'this object') || ' affects ' || direct_count::text || ' direct object'
    || case when direct_count = 1 then '' else 's' end;
  if downstream_count > 0 then
    sentence := sentence || ' and ' || downstream_count::text || ' further downstream object'
      || case when downstream_count = 1 then '' else 's' end;
  end if;
  if coalesce(nullif(btrim(sample_reason), ''), '') <> '' then
    sentence := sentence || ' because ' || left(btrim(sample_reason), 400);
  else
    sentence := sentence || ' through recorded ' || coalesce(kind, 'production') || ' dependencies.';
  end if;
  return sentence;
end $$;
revoke all on function tonde_private.pi_explain(uuid,uuid,integer,integer,text) from public, anon, authenticated, service_role;

-- Mark (or refresh) a stale artifact. Never deletes, never rewrites the artifact itself.
create function tonde_private.pi_mark_stale(target_workspace uuid, target_production uuid, target_object uuid,
  kind tonde.artifact_kind, reference uuid, reason_text text, caused_by uuid, caused_rev integer,
  source_rev integer, current_rev integer, desired_state tonde.stale_state default 'stale')
returns uuid language plpgsql security definer set search_path = '' as $$
declare marker uuid; ref uuid := coalesce(reference, target_object);
begin
  insert into tonde.stale_artifacts as artifact(workspace_id, production_id, artifact_kind, artifact_ref, object_id, state, reason,
    caused_by_object_id, caused_by_revision, source_revision, current_revision)
  values (target_workspace, target_production, kind, reference, target_object, desired_state, left(reason_text, 600),
    caused_by, caused_rev, source_rev, current_rev)
  on conflict (workspace_id, artifact_kind, object_id, (coalesce(artifact_ref, object_id))) do update
    set state = case when artifact.state = 'conflicted' and desired_state = 'stale'
        then 'conflicted'::tonde.stale_state else desired_state end,
      reason = left(reason_text, 600), caused_by_object_id = coalesce(caused_by, artifact.caused_by_object_id),
      caused_by_revision = coalesce(caused_rev, artifact.caused_by_revision),
      source_revision = coalesce(source_rev, artifact.source_revision),
      current_revision = coalesce(current_rev, artifact.current_revision),
      resolved_at = null, resolved_by = null
  returning artifact.id into marker;
  return marker;
end $$;
revoke all on function tonde_private.pi_mark_stale(uuid,uuid,uuid,tonde.artifact_kind,uuid,text,uuid,integer,integer,integer,tonde.stale_state)
  from public, anon, authenticated, service_role;

-- 6. When a canonical object changes, artifacts derived from it are marked stale in place.
-- Nothing is deleted, and the marker records which revision caused the mismatch.
create function tonde_private.pi_stale_on_source_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare object_kind text := tg_argv[0]; changed boolean;
begin
  changed := to_jsonb(new) - array['revision','updated_at'] is distinct from to_jsonb(old) - array['revision','updated_at'];
  if not changed then return new; end if;
  update tonde.stale_artifacts
    set state = 'stale', reason = left('The ' || object_kind || ' changed after this artifact was derived.', 600),
      caused_by_object_id = new.id, caused_by_revision = new.revision,
      current_revision = new.revision, resolved_at = null, resolved_by = null
  where workspace_id = new.workspace_id and object_id = new.id and state = 'current'
    and artifact_kind in ('real_plan','ai_plan','prompt','first_frame','last_frame','generation_context','result_comparison','derived_summary');
  return new;
end $$;
revoke all on function tonde_private.pi_stale_on_source_change() from public, anon, authenticated, service_role;

-- 7. Derived edges: an explicit relationship the database already knows. A Shot that binds a
-- Character Asset depends on that Asset; a plan depends on its Shot; a dialogue line feeds its
-- Scene runtime. No AI inference is involved in creating these.
create function tonde.dependency_sync(target_workspace uuid, target_production uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare made integer := 0; binding record; plan_row record; line_row record; desired boolean; edge_reason text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  for binding in
    select b.scope_object_id, b.asset_id, b.reference_id, b.binding_role, b.inheritance
    from tonde.scope_bindings b
    where b.workspace_id = target_workspace and b.production_id = target_production
  loop
    desired := binding.inheritance <> 'exclude';
    edge_reason := case
      when binding.inheritance = 'exclude' then 'This scope excluded the ' || binding.binding_role || ' binding.'
      else 'This ' || binding.binding_role || ' binding references the source directly.' end;
    if binding.asset_id is not null then
      insert into tonde.object_dependencies(workspace_id, source_object_id, target_object_id, relation, reason,
        strength, origin, affected_fields, active, created_by, updated_at)
      values (target_workspace, binding.asset_id, binding.scope_object_id, 'asset', edge_reason,
        (case when binding.binding_role in ('character','product','world','style') then 'hard' else 'soft' end)::tonde.dependency_strength,
        'derived'::tonde.dependency_origin, array[binding.binding_role], desired, auth.uid(), now())
      on conflict (source_object_id, target_object_id, relation) do update
        set reason = edge_reason, active = desired, updated_at = now();
      made := made + 1;
    elsif binding.reference_id is not null then
      insert into tonde.object_dependencies(workspace_id, source_object_id, target_object_id, relation, reason,
        strength, origin, affected_fields, active, created_by, updated_at)
      values (target_workspace, binding.reference_id, binding.scope_object_id, 'reference', edge_reason,
        'soft'::tonde.dependency_strength, 'derived'::tonde.dependency_origin, array[binding.binding_role], desired, auth.uid(), now())
      on conflict (source_object_id, target_object_id, relation) do update
        set reason = edge_reason, active = desired, updated_at = now();
      made := made + 1;
    end if;
  end loop;
  for plan_row in
    select p.id, p.shot_id, p.execution_method from tonde.execution_plans p
    where p.workspace_id = target_workspace and p.production_id = target_production
  loop
    insert into tonde.object_dependencies(workspace_id, source_object_id, target_object_id, relation, reason,
      strength, origin, affected_fields, active, created_by, updated_at)
    values (target_workspace, plan_row.shot_id, plan_row.id, 'execution',
      'This ' || plan_row.execution_method::text || ' plan executes the Shot direction.',
      'hard'::tonde.dependency_strength, 'derived'::tonde.dependency_origin,
      array['direction','framing','duration'], true, auth.uid(), now())
    on conflict (source_object_id, target_object_id, relation) do update set active = true, updated_at = now();
    made := made + 1;
  end loop;
  for line_row in
    select l.id, l.scene_id from tonde.dialogue_lines l
    where l.workspace_id = target_workspace and l.production_id = target_production and l.scene_id is not null
  loop
    insert into tonde.object_dependencies(workspace_id, source_object_id, target_object_id, relation, reason,
      strength, origin, affected_fields, active, created_by, updated_at)
    values (target_workspace, line_row.id, line_row.scene_id, 'runtime',
      'This Dialogue line contributes to the Scene runtime.',
      'soft'::tonde.dependency_strength, 'derived'::tonde.dependency_origin,
      array['planned_duration_ms'], true, auth.uid(), now())
    on conflict (source_object_id, target_object_id, relation) do update set active = true, updated_at = now();
    made := made + 1;
  end loop;
  return jsonb_build_object('production_id', target_production, 'edges_considered', made,
    'note', 'Derived edges come from real bindings, plans and dialogue. Nothing was inferred here.');
end $$;

-- 8. Explicit or AI-inferred edges. An inferred edge keeps its rationale, confidence and origin
-- so it is never presented as canonical certainty.
create function tonde.dependency_edge(target_workspace uuid, target_production uuid, source_object uuid,
  target_object uuid, relation_value text, strength_value text default 'soft', origin_value text default 'explicit',
  reason_value text default '', fields_value text[] default '{}', evidence_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if source_object = target_object then
    raise exception 'An object cannot depend on itself' using errcode = '22023';
  end if;
  if relation_value not in ('creative','continuity','execution','reference','derived_from','runtime','asset','result','state') then
    raise exception 'Unsupported dependency relation' using errcode = '22023';
  end if;
  if strength_value not in ('hard','soft','advisory') then raise exception 'Unsupported dependency strength' using errcode = '22023'; end if;
  if origin_value not in ('explicit','derived','inferred') then raise exception 'Unsupported dependency origin' using errcode = '22023'; end if;
  if not exists (select 1 from tonde.objects o where o.workspace_id = target_workspace and o.id = source_object)
    or not exists (select 1 from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object) then
    raise exception 'Dependency edge needs two real objects in this workspace' using errcode = 'P0002';
  end if;
  insert into tonde.object_dependencies as edge(workspace_id, source_object_id, target_object_id, relation, reason, strength,
    origin, affected_fields, active, evidence, created_by, updated_at)
  values (target_workspace, source_object, target_object, relation_value, left(coalesce(reason_value,''), 600),
    strength_value::tonde.dependency_strength, origin_value::tonde.dependency_origin, coalesce(fields_value,'{}'), true,
    coalesce(evidence_value,'{}'::jsonb), auth.uid(), now())
  on conflict (source_object_id, target_object_id, relation) do update
    set reason = left(coalesce(nullif(reason_value,''), edge.reason), 600),
      strength = strength_value::tonde.dependency_strength, origin = origin_value::tonde.dependency_origin,
      affected_fields = coalesce(nullif(fields_value,'{}'), edge.affected_fields),
      evidence = coalesce(nullif(evidence_value,'{}'::jsonb), edge.evidence),
      active = true, updated_at = now()
  returning edge.revision into saved;
  return jsonb_build_object('source_object_id', source_object, 'target_object_id', target_object, 'relation', relation_value,
    'strength', strength_value, 'origin', origin_value, 'active', true, 'revision', saved,
    'note', 'An inferred edge is a proposal with its rationale, not canonical certainty.');
end $$;

create function tonde.dependency_active(target_workspace uuid, target_production uuid, edge_ids uuid[],
  desired_active boolean, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  update tonde.object_dependencies d set active = coalesce(desired_active, true),
    note = left(coalesce(note_text,''), 400), updated_at = now()
  where d.workspace_id = target_workspace
    and (d.source_object_id = any(edge_ids) or d.target_object_id = any(edge_ids));
  get diagnostics changed = row_count;
  return jsonb_build_object('changed', changed, 'active', coalesce(desired_active,true),
    'note', 'Edges are deactivated, never deleted: the history of a relationship stays readable.');
end $$;

-- 9. Graph read: forward (what does this affect) and reverse (what does this depend on),
-- bounded by depth and page size, with the classification of every reachable object.
create function tonde.dependency_graph(target_workspace uuid, target_production uuid, target_object uuid,
  direction text default 'forward', target_depth integer default 2, target_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare depth_value integer; lim integer; nodes jsonb; edges jsonb; total integer; root_kind text; root_label text;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  if direction not in ('forward','reverse') then raise exception 'Direction must be forward or reverse' using errcode = '22023'; end if;
  depth_value := least(greatest(coalesce(target_depth, 2), 1), 8);
  lim := least(greatest(coalesce(target_limit, 200), 1), 500);
  select o.kind, tonde_private.pi_label(target_workspace, target_object) into root_kind, root_label
    from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  if root_kind is null then raise exception 'That object is unavailable in this workspace' using errcode = 'P0002'; end if;
  select count(*) into total from tonde_private.pi_walk(target_workspace, target_object, depth_value, direction);
  select coalesce(jsonb_agg(jsonb_build_object(
      'object_id', w.object_id, 'level', o.kind, 'label', tonde_private.pi_label(target_workspace, w.object_id),
      'depth', w.depth, 'relation', w.relation,
      -- An inferred relationship is a POTENTIAL impact even when it is one hop away: the
      -- deterministic graph alone does not prove it must change.
      'classification', case when (select d.origin from tonde.object_dependencies d where d.workspace_id = target_workspace and d.active
          and d.relation = w.relation
          and ((direction = 'reverse' and d.source_object_id = w.object_id and d.target_object_id = w.via)
            or (direction <> 'reverse' and d.target_object_id = w.object_id and d.source_object_id = w.via))
          limit 1) = 'inferred' then 'potential'
        when w.depth = 1 then 'direct' else 'downstream' end,
      'locked', tonde_private.pi_is_locked(target_workspace, w.object_id),
      'approved', tonde_private.pi_is_approved(target_workspace, w.object_id),
      'revision', tonde_private.pi_object_revision(target_workspace, w.object_id)) order by w.depth, w.object_id), '[]'::jsonb)
    into nodes
  from (select * from tonde_private.pi_walk(target_workspace, target_object, depth_value, direction) order by depth, object_id limit lim) w
  join tonde.objects o on o.workspace_id = target_workspace and o.id = w.object_id;
  select coalesce(jsonb_agg(jsonb_build_object('source_object_id', d.source_object_id, 'target_object_id', d.target_object_id,
      'relation', d.relation, 'strength', d.strength, 'origin', d.origin, 'reason', d.reason,
      'affected_fields', d.affected_fields, 'active', d.active, 'revision', d.revision)), '[]'::jsonb)
    into edges
  from tonde.object_dependencies d
  where d.workspace_id = target_workspace and d.active
    and (d.source_object_id = target_object or d.target_object_id = target_object
      or d.source_object_id in (select w.object_id from tonde_private.pi_walk(target_workspace, target_object, depth_value, direction) w)
      or d.target_object_id in (select w.object_id from tonde_private.pi_walk(target_workspace, target_object, depth_value, direction) w));
  return jsonb_build_object('root_object_id', target_object, 'root_kind', root_kind, 'root_label', root_label,
    'direction', direction, 'depth', depth_value, 'nodes', nodes, 'edges', edges, 'total', total,
    'truncated', total > lim, 'cycles_safe', true,
    'note', 'Traversal is bounded and cycle-safe. Edges only ever mean: the source is relied upon, the target depends on it.');
end $$;

create function tonde.dependency_edges(target_workspace uuid, target_production uuid, target_object uuid,
  target_limit integer default 100, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  lim := least(greatest(coalesce(target_limit, 100), 1), 200);
  off := greatest(coalesce(target_offset, 0), 0);
  select coalesce(jsonb_agg(jsonb_build_object('source_object_id', d.source_object_id, 'target_object_id', d.target_object_id,
      'relation', d.relation, 'strength', d.strength, 'origin', d.origin, 'reason', d.reason,
      'affected_fields', d.affected_fields, 'active', d.active, 'note', d.note, 'evidence', d.evidence,
      'revision', d.revision, 'updated_at', d.updated_at,
      'source_label', tonde_private.pi_label(target_workspace, d.source_object_id),
      'target_label', tonde_private.pi_label(target_workspace, d.target_object_id)) order by d.active desc, d.updated_at desc), '[]'::jsonb)
    into items
  from (select * from tonde.object_dependencies d
    where d.workspace_id = target_workspace and (d.source_object_id = target_object or d.target_object_id = target_object)
    order by d.active desc, d.updated_at desc limit lim offset off) d;
  return jsonb_build_object('object_id', target_object, 'items', items, 'limit', lim, 'offset', off);
end $$;

-- 10. Impact preview. Computes and records the analysis; it never changes a Production object.
create function tonde.impact_preview(target_workspace uuid, target_production uuid, target_object uuid,
  target_depth integer default 2, target_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare graph jsonb; nodes jsonb; node jsonb; direct integer := 0; downstream integer := 0; potential integer := 0;
  locked_ids uuid[] := '{}'; approved_ids uuid[] := '{}'; counts jsonb := '{}'::jsonb; kind text; label text;
  root_revision integer; locked uuid[] := '{}'; approved uuid[] := '{}'; analysis uuid; sample_reason text;
  explanation text; group_counts jsonb := '{}'::jsonb; structure_rev integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  graph := tonde.dependency_graph(target_workspace, target_production, target_object, 'forward', target_depth, target_limit);
  nodes := graph->'nodes';
  select o.kind, tonde_private.pi_label(target_workspace, target_object), tonde_private.pi_object_revision(target_workspace, target_object)
    into kind, label, root_revision
    from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  if kind is null then raise exception 'That object is unavailable in this workspace' using errcode = 'P0002'; end if;
  select coalesce(sum(revision), 0) into structure_rev from (
    select revision from tonde.productions where workspace_id = target_workspace and id = target_production
    union all select revision from tonde.acts where workspace_id = target_workspace and production_id = target_production
    union all select revision from tonde.sequences where workspace_id = target_workspace and production_id = target_production
    union all select revision from tonde.scenes where workspace_id = target_workspace and production_id = target_production
    union all select revision from tonde.shots where workspace_id = target_workspace and production_id = target_production) summed;
  for node in select * from jsonb_array_elements(nodes) loop
    if node->>'classification' = 'direct' then
      direct := direct + 1;
      if coalesce((node->>'locked')::boolean, false) then locked := locked || (node->>'object_id')::uuid; end if;
      if coalesce((node->>'approved')::boolean, false) then approved := approved || (node->>'object_id')::uuid; end if;
    elsif node->>'classification' = 'potential' then
      potential := potential + 1;
    else
      downstream := downstream + 1;
    end if;
    counts := jsonb_set(counts, array[node->>'level'], to_jsonb(coalesce((counts->>(node->>'level'))::integer, 0) + 1), true);
  end loop;
  select d.reason into sample_reason
    from tonde.object_dependencies d
    where d.workspace_id = target_workspace and d.source_object_id = target_object and d.active and d.reason <> ''
    order by case d.strength when 'hard' then 1 when 'soft' then 2 else 3 end, d.relation limit 1;
  explanation := tonde_private.pi_explain(target_workspace, target_object, direct, downstream, coalesce(sample_reason, ''));
  group_counts := jsonb_build_object('direct', direct, 'downstream', downstream, 'potential', potential,
    'locked', coalesce(array_length(locked, 1), 0), 'approved', coalesce(array_length(approved, 1), 0),
    'by_level', counts, 'total', jsonb_array_length(nodes));
  insert into tonde.impact_analyses(workspace_id, production_id, root_object_id, root_label, root_kind, root_revision,
    structure_revision, direction, requested_depth, mode, classifications, counts, locked_ids, approved_ids, explanation)
  values (target_workspace, target_production, target_object, coalesce(label,''), coalesce(kind,''), root_revision,
    structure_rev, 'forward', least(greatest(coalesce(target_depth,2),1),8), 'preview',
    jsonb_build_object('nodes', nodes, 'edges', graph->'edges'), group_counts, locked, approved, explanation)
  returning id into analysis;
  return jsonb_build_object('analysis_id', analysis, 'root_object_id', target_object, 'root_kind', kind, 'root_label', label,
    'root_revision', root_revision, 'structure_revision', structure_rev, 'depth', least(greatest(coalesce(target_depth,2),1),8),
    'nodes', nodes, 'counts', group_counts, 'locked_ids', to_jsonb(locked), 'approved_ids', to_jsonb(approved),
    'explanation', explanation, 'applied', false,
    'rule', 'Impact is computed, never applied. Nothing in this Production changed yet.');
end $$;

create function tonde.impact_history(target_workspace uuid, target_production uuid, target_limit integer default 20,
  target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  lim := least(greatest(coalesce(target_limit, 20), 1), 100);
  off := greatest(coalesce(target_offset, 0), 0);
  select count(*) into total from tonde.impact_analyses where workspace_id = target_workspace and production_id = target_production;
  select coalesce(jsonb_agg(jsonb_build_object('analysis_id', a.id, 'root_object_id', a.root_object_id, 'root_label', a.root_label,
      'root_kind', a.root_kind, 'root_revision', a.root_revision, 'structure_revision', a.structure_revision,
      'mode', a.mode, 'applied_mode', a.applied_mode, 'applied_at', a.applied_at, 'counts', a.counts,
      'explanation', a.explanation, 'unresolved_count', a.unresolved_count, 'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
    into items
  from (select * from tonde.impact_analyses where workspace_id = target_workspace and production_id = target_production
    order by created_at desc limit lim offset off) a;
  return jsonb_build_object('items', items, 'total', total, 'limit', lim, 'offset', off, 'truncated', total > off + lim);
end $$;

-- 11. Applying an impact. Three modes that mean something:
--   update_all        mark every affected dependent's derived artifacts (locked objects reported,
--                     approved objects flagged for review rather than rewritten)
--   review_changes    only the selected dependent ids
--   change_only_this  the change stays local: direct dependents keep their work but it is marked
--                     stale and the remaining downstream impact is recorded as unresolved
create function tonde.apply_impact(target_workspace uuid, target_production uuid, target_analysis uuid,
  desired_mode text, selected_ids uuid[] default '{}', expected_root_revision integer default null, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare analysis tonde.impact_analyses; current_revision integer; node jsonb; target uuid; marked integer := 0;
  locked_skipped jsonb := '[]'::jsonb; requiring_review jsonb := '[]'::jsonb; direct_ids uuid[] := '{}';
  downstream_count integer := 0; unresolved integer := 0; kinds text[] := array['real_plan','ai_plan','prompt','first_frame',
  'last_frame','generation_context','result_comparison','derived_summary','continuity_state'];
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into analysis from tonde.impact_analyses
    where workspace_id = target_workspace and production_id = target_production and id = target_analysis;
  if not found then raise exception 'That impact analysis is unavailable' using errcode = 'P0002'; end if;
  if analysis.applied_mode is not null then
    raise exception 'That impact analysis was already applied' using errcode = '23514';
  end if;
  current_revision := tonde_private.pi_object_revision(target_workspace, analysis.root_object_id);
  if current_revision is distinct from analysis.root_revision
    or (expected_root_revision is not null and expected_root_revision <> analysis.root_revision) then
    raise exception 'The source changed since this impact was computed. Preview the impact again.' using errcode = '40001';
  end if;
  if desired_mode not in ('update_all','review_changes','change_only_this') then
    raise exception 'Unsupported impact mode' using errcode = '22023';
  end if;
  for node in select * from jsonb_array_elements(analysis.classifications->'nodes') loop
    target := (node->>'object_id')::uuid;
    -- Every proposal pins the revisions it was computed from: if a dependent moved on since the
    -- preview, this operation is stale and is rejected instead of applied against newer content.
    if (node->>'revision') is not null
      and tonde_private.pi_object_revision(target_workspace, target) is distinct from (node->>'revision')::integer then
      raise exception 'A dependent object changed since this impact was computed. Preview the impact again.' using errcode = '40001';
    end if;
    if coalesce((node->>'depth')::integer, 1) > 1 then downstream_count := downstream_count + 1; end if;
    if node->>'classification' = 'direct' then direct_ids := direct_ids || target; end if;
    if desired_mode = 'review_changes' and not (target = any(selected_ids)) then continue; end if;
    if desired_mode = 'change_only_this' then
      -- The direct dependents keep their artifacts (nothing is rewritten) but they stop claiming
      -- to be current; everything further downstream stays explicitly unresolved.
      if node->>'classification' <> 'direct' then continue; end if;
      if tonde_private.pi_is_locked(target_workspace, target) then
        locked_skipped := locked_skipped || to_jsonb(jsonb_build_object('object_id', target, 'label', node->>'label',
          'reason', 'locked')); continue;
      end if;
      marked := marked + 1;
      perform tonde_private.pi_mark_stale(target_workspace, target_production, target, 'dependent_object', null,
        'CHANGE ONLY THIS: the source changed and this dependent was intentionally left as it was.', analysis.root_object_id,
        analysis.root_revision, analysis.root_revision, tonde_private.pi_object_revision(target_workspace, target), 'stale');
      continue;
    end if;
    if tonde_private.pi_is_locked(target_workspace, target) then
      locked_skipped := locked_skipped || to_jsonb(jsonb_build_object('object_id', target, 'label', node->>'label',
        'reason', 'The dependent object is locked. Unlock it before TONDE updates it.'));
      continue;
    end if;
    if tonde_private.pi_is_approved(target_workspace, target) then
      requiring_review := requiring_review || to_jsonb(jsonb_build_object('object_id', target, 'label', node->>'label',
        'revision', tonde_private.pi_object_revision(target_workspace, target),
        'reason', 'Approved content is never rewritten silently.'));
      perform tonde_private.pi_mark_stale(target_workspace, target_production, target, 'dependent_object', null,
        'Approved content depends on a changed source and needs review.', analysis.root_object_id, analysis.root_revision,
        analysis.root_revision, tonde_private.pi_object_revision(target_workspace, target), 'conflicted');
      marked := marked + 1;
      continue;
    end if;
    marked := marked + 1;
    perform tonde_private.pi_mark_stale(target_workspace, target_production, target, 'dependent_object', null,
      'The source ' || coalesce(analysis.root_label,'object') || ' changed after this artifact was derived.',
      analysis.root_object_id, analysis.root_revision, analysis.root_revision,
      tonde_private.pi_object_revision(target_workspace, target), 'stale');
  end loop;
  unresolved := case when desired_mode = 'change_only_this' then greatest(downstream_count, 0) else 0 end;
  update tonde.impact_analyses a set mode = desired_mode::tonde.impact_mode,
    applied_mode = desired_mode::tonde.impact_mode, applied_at = now(),
    unresolved_count = unresolved, note = left(coalesce(note_text,''), 400)
  where a.id = analysis.id;
  return jsonb_build_object('analysis_id', analysis.id, 'mode', desired_mode, 'marked', marked,
    'locked_skipped', locked_skipped, 'requiring_review', requiring_review,
    'direct_count', coalesce(array_length(direct_ids, 1), 0), 'downstream_count', downstream_count,
    'unresolved_count', unresolved,
    'note', case when desired_mode = 'update_all'
        then 'Affected derived artifacts were marked. Approved content and locked objects were reported, not rewritten.'
      when desired_mode = 'review_changes'
        then 'Only the selected dependents were marked.'
      else 'CHANGE ONLY THIS: the change stayed local and the remaining downstream impact is recorded as unresolved.' end);
end $$;

-- 12. Stale artifacts: read and explicit resolution. A stale artifact is never resurrected by
-- changing its own row: the creator resolves it (or re-derives it), and the record stays.
create function tonde.stale_artifact_list(target_workspace uuid, target_production uuid, target_state text default null,
  target_limit integer default 100, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer; open_count integer;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  lim := least(greatest(coalesce(target_limit, 100), 1), 200);
  off := greatest(coalesce(target_offset, 0), 0);
  select count(*) into total from tonde.stale_artifacts
    where workspace_id = target_workspace and production_id = target_production
      and (target_state is null or state = target_state::tonde.stale_state);
  select count(*) into open_count from tonde.stale_artifacts
    where workspace_id = target_workspace and production_id = target_production and state <> 'current';
  select coalesce(jsonb_agg(jsonb_build_object('artifact_id', s.id, 'artifact_kind', s.artifact_kind, 'artifact_ref', s.artifact_ref,
      'object_id', s.object_id, 'object_label', tonde_private.pi_label(target_workspace, s.object_id),
      'object_kind', (select kind from tonde.objects where workspace_id = target_workspace and id = s.object_id),
      'state', s.state, 'reason', s.reason, 'caused_by_object_id', s.caused_by_object_id,
      'caused_by_label', tonde_private.pi_label(target_workspace, s.caused_by_object_id),
      'caused_by_revision', s.caused_by_revision, 'source_revision', s.source_revision, 'current_revision', s.current_revision,
      'resolved_at', s.resolved_at, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
    into items
  from (select * from tonde.stale_artifacts where workspace_id = target_workspace and production_id = target_production
    and (target_state is null or state = target_state::tonde.stale_state)
    order by created_at desc limit lim offset off) s;
  return jsonb_build_object('items', items, 'total', total, 'open', open_count, 'limit', lim, 'offset', off,
    'note', 'Stale means the artifact may no longer match its source. Nothing was deleted.');
end $$;

create function tonde.resolve_stale_artifact(target_workspace uuid, target_production uuid, target_artifact uuid,
  note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare marker tonde.stale_artifacts; current_revision integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into marker from tonde.stale_artifacts
    where workspace_id = target_workspace and production_id = target_production and id = target_artifact;
  if not found then raise exception 'That artifact marker is unavailable' using errcode = 'P0002'; end if;
  current_revision := tonde_private.pi_object_revision(target_workspace, marker.object_id);
  update tonde.stale_artifacts s set state = 'current', note = left(coalesce(note_text,''), 400),
    resolved_at = now(), resolved_by = auth.uid()
  where s.id = marker.id;
  return jsonb_build_object('artifact_id', marker.id, 'state', 'current',
    'note', 'The creator resolved this artifact. Historical markers stay readable.');
end $$;

create function tonde.mark_stale_artifact(target_workspace uuid, target_production uuid, target_object uuid,
  kind_value text, reason_text text, reference uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare marker uuid;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if kind_value not in ('real_plan','ai_plan','prompt','first_frame','last_frame','generation_context','result_comparison',
      'derived_summary','continuity_state','continuity_analysis','deliverable','dependent_object','other') then
    raise exception 'Unsupported artifact kind' using errcode = '22023';
  end if;
  marker := tonde_private.pi_mark_stale(target_workspace, target_production, target_object, kind_value::tonde.artifact_kind, reference,
    left(coalesce(reason_text,''), 600), null, null, null, tonde_private.pi_object_revision(target_workspace, target_object), 'stale');
  return jsonb_build_object('artifact_id', marker, 'state', 'stale');
end $$;

-- 13. RLS. Every new workspace-owned table is isolated; enabling RLS is not optional.
do $$ declare item text; begin
  foreach item in array array['stale_artifacts','impact_analyses'] loop
    execute format('alter table tonde.%I enable row level security', item);
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', item);
    execute format('create policy tenant_insert on tonde.%I for insert to authenticated with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('create policy tenant_update on tonde.%I for update to authenticated using (tonde_private.can_edit_workspace(workspace_id)) with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('grant select, insert, update on tonde.%I to authenticated', item);
  end loop;
end $$;
alter table tonde.object_dependencies enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'tonde' and tablename = 'object_dependencies' and policyname = 'tenant_read') then
    create policy tenant_read on tonde.object_dependencies for select to authenticated
      using (tonde_private.is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'tonde' and tablename = 'object_dependencies' and policyname = 'tenant_insert') then
    create policy tenant_insert on tonde.object_dependencies for insert to authenticated
      with check (tonde_private.can_edit_workspace(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'tonde' and tablename = 'object_dependencies' and policyname = 'tenant_update') then
    create policy tenant_update on tonde.object_dependencies for update to authenticated
      using (tonde_private.can_edit_workspace(workspace_id)) with check (tonde_private.can_edit_workspace(workspace_id));
  end if;
end $$;
grant select, insert, update on tonde.object_dependencies to authenticated;

-- 14. Mutation guards on the new tables (nothing here rewrites identity or bypasses a lock).
do $$ declare item text; begin
  foreach item in array array['stale_artifacts','impact_analyses'] loop
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', item);
  end loop;
end $$;
create trigger guard_mutation before insert or update on tonde.object_dependencies
  for each row execute function tonde_private.guard_mutation();

-- 15. Stale markers follow real source changes.
create trigger zz_stale_on_shot_change after update on tonde.shots
  for each row execute function tonde_private.pi_stale_on_source_change('Shot');
create trigger zz_stale_on_scene_change after update on tonde.scenes
  for each row execute function tonde_private.pi_stale_on_source_change('Scene');
create trigger zz_stale_on_document_change after update on tonde.creative_documents
  for each row execute function tonde_private.pi_stale_on_source_change('document');
create trigger zz_stale_on_plan_change after update on tonde.execution_plans
  for each row execute function tonde_private.pi_stale_on_source_change('plan');

-- 16. Privileges: authenticated only, and the private helpers stay unreachable.
revoke all on function
  tonde.dependency_sync(uuid,uuid),
  tonde.dependency_edge(uuid,uuid,uuid,uuid,text,text,text,text,text[],jsonb),
  tonde.dependency_active(uuid,uuid,uuid[],boolean,text),
  tonde.dependency_graph(uuid,uuid,uuid,text,integer,integer),
  tonde.dependency_edges(uuid,uuid,uuid,integer,integer),
  tonde.impact_preview(uuid,uuid,uuid,integer,integer),
  tonde.impact_history(uuid,uuid,integer,integer),
  tonde.apply_impact(uuid,uuid,uuid,text,uuid[],integer,text),
  tonde.stale_artifact_list(uuid,uuid,text,integer,integer),
  tonde.resolve_stale_artifact(uuid,uuid,uuid,text),
  tonde.mark_stale_artifact(uuid,uuid,uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  tonde.dependency_sync(uuid,uuid),
  tonde.dependency_edge(uuid,uuid,uuid,uuid,text,text,text,text,text[],jsonb),
  tonde.dependency_active(uuid,uuid,uuid[],boolean,text),
  tonde.dependency_graph(uuid,uuid,uuid,text,integer,integer),
  tonde.dependency_edges(uuid,uuid,uuid,integer,integer),
  tonde.impact_preview(uuid,uuid,uuid,integer,integer),
  tonde.impact_history(uuid,uuid,integer,integer),
  tonde.apply_impact(uuid,uuid,uuid,text,uuid[],integer,text),
  tonde.stale_artifact_list(uuid,uuid,text,integer,integer),
  tonde.resolve_stale_artifact(uuid,uuid,uuid,text),
  tonde.mark_stale_artifact(uuid,uuid,uuid,text,text,uuid)
  to authenticated;
commit;
