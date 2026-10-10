-- Additive migration: Prompt 9B continuity engine.
-- Continuity is TEMPORAL. A statement records what is true about one trait of one subject at one
-- point in Production order, and the engine understands that state CHANGES as the Production
-- progresses: an injury, a wardrobe change or a new time of day is declared, not inferred.
-- Statements are never overwritten. A newer statement supersedes an older one and both stay
-- readable, so "what did we decide before?" has an answer.
--
-- The engine compares DECLARED statements only. It never claims to have analysed media: a clean
-- check means the declarations agree, not that the footage is consistent. That limitation is
-- returned with every check and stored on the check row.
begin;

-- 1. Vocabulary. Storage codes are the generated product vocabulary keys.
create type tonde.continuity_domain as enum
  ('character','wardrobe','prop','product','vehicle','injury','hair_makeup','weather','time_of_day',
   'environment','lighting','story_knowledge','dialogue_fact','screen_direction','eyeline',
   'camera_geography','position','product_condition','other');
create type tonde.continuity_anchor as enum ('production','scene_opening','scene_ending','shot');
create type tonde.continuity_transition as enum ('baseline','continuous','changed');
create type tonde.continuity_origin as enum ('declared','derived','inferred');
create type tonde.continuity_finding_kind as enum
  ('unexplained_change','boundary_break','missing_reason','lock_conflict','unverified_after');
create type tonde.continuity_finding_state as enum ('open','acknowledged','resolved','waived');

-- 2. Continuity statements. One trait, one subject, one point in the timeline.
create table tonde.continuity_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null,
  domain tonde.continuity_domain not null,
  subject_object_id uuid,
  trait text not null check (length(btrim(trait)) between 1 and 120),
  anchor tonde.continuity_anchor not null default 'production',
  scene_id uuid, shot_id uuid,
  value text not null check (length(btrim(value)) between 1 and 400),
  transition tonde.continuity_transition not null default 'baseline',
  origin tonde.continuity_origin not null default 'declared',
  epistemic text not null default 'observed' check (epistemic in ('observed','estimated','recommended','unknown')),
  confidence text not null default 'high' check (confidence in ('high','medium','low')),
  reason text not null default '' check (length(reason) <= 600),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  note text not null default '' check (length(note) <= 400),
  supersedes_id uuid,
  retired_at timestamptz, retired_by uuid,
  retire_reason text not null default '' check (length(retire_reason) <= 400),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, production_id, id),
  check ((anchor = 'shot') = (shot_id is not null)),
  check (anchor in ('production','shot') or scene_id is not null),
  check (anchor <> 'production' or (scene_id is null and shot_id is null)),
  -- A creator declares a fact of their own Production; only an INFERRED observation must cite evidence.
  check (epistemic <> 'observed' or origin <> 'inferred' or jsonb_array_length(evidence) > 0),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, subject_object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, supersedes_id) references tonde.continuity_states(workspace_id, id) on delete restrict
);
-- One live statement per trait per point. A different value is a new version, never a rewrite.
create unique index continuity_states_live_identity on tonde.continuity_states
  (workspace_id, production_id, domain, coalesce(subject_object_id, '00000000-0000-0000-0000-000000000000'::uuid), trait, anchor,
   coalesce(scene_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(shot_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where retired_at is null;
create index continuity_states_by_subject on tonde.continuity_states(workspace_id, production_id, subject_object_id, domain, trait)
  where retired_at is null;
create index continuity_states_by_production on tonde.continuity_states(workspace_id, production_id, created_at desc);

-- 3. A recorded check. It pins the revision, the statement count and the statement watermark it
-- was computed from, so "is this check still current?" is a comparison, not a guess.
create table tonde.continuity_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null,
  production_revision integer not null check (production_revision > 0),
  state_count integer not null default 0 check (state_count >= 0),
  state_watermark timestamptz,
  finding_count integer not null default 0 check (finding_count >= 0),
  critical_count integer not null default 0 check (critical_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  info_count integer not null default 0 check (info_count >= 0),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  verdict text not null default 'consistent' check (verdict in ('consistent','needs_review','conflict')),
  explanation text not null default '' check (length(explanation) <= 1200),
  limitations text not null default '' check (length(limitations) <= 1200),
  note text not null default '' check (length(note) <= 400),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, production_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);
create index continuity_checks_recent on tonde.continuity_checks(workspace_id, production_id, created_at desc);

-- 4. Findings. A finding is a statement about the recorded declarations. A deterministic finding
-- is observed and cites the statements it compared; an inferred proposal can never claim to be an
-- observation and can never resolve itself.
create table tonde.continuity_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null,
  check_id uuid,
  kind tonde.continuity_finding_kind not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  domain tonde.continuity_domain not null,
  subject_object_id uuid,
  trait text not null default '' check (length(trait) <= 120),
  earlier_state_id uuid, later_state_id uuid,
  at_scene_id uuid, at_shot_id uuid,
  explanation text not null check (length(explanation) between 1 and 1200),
  suggested_resolution text not null default '' check (length(suggested_resolution) <= 1200),
  origin tonde.continuity_origin not null default 'derived',
  rationale text not null default '' check (length(rationale) <= 1200),
  epistemic text not null default 'observed' check (epistemic in ('observed','estimated','recommended','unknown')),
  confidence text not null default 'high' check (confidence in ('high','medium','low')),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  state tonde.continuity_finding_state not null default 'open',
  resolution_note text not null default '' check (length(resolution_note) <= 800),
  resolved_by uuid, resolved_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (epistemic <> 'observed' or jsonb_array_length(evidence) > 0),
  check (origin = 'inferred' or epistemic = 'observed'),
  check (origin <> 'inferred' or epistemic <> 'observed'),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, check_id) references tonde.continuity_checks(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, subject_object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, earlier_state_id) references tonde.continuity_states(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, production_id, later_state_id) references tonde.continuity_states(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, at_scene_id) references tonde.scenes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, at_shot_id) references tonde.shots(workspace_id, id) on delete restrict
);
create index continuity_findings_by_check on tonde.continuity_findings(workspace_id, check_id, severity);
create index continuity_findings_open on tonde.continuity_findings(workspace_id, production_id, severity)
  where state in ('open','acknowledged');
-- A re-run of the same rules inside one check cannot double-report: proposals (no check) are exempt.
create unique index continuity_findings_identity on tonde.continuity_findings
  (check_id, kind, domain, coalesce(subject_object_id, '00000000-0000-0000-0000-000000000000'::uuid), trait,
   coalesce(later_state_id, earlier_state_id, at_shot_id, at_scene_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where check_id is not null;

-- 5. Shared helpers (not user-facing; reachable only through the security-definer RPCs below).
create function tonde_private.ci_text(source jsonb, key_name text, max_length integer, required boolean default false)
returns text language plpgsql immutable set search_path = '' as $$
declare value text;
begin
  value := btrim(coalesce(source ->> key_name, ''));
  if value = '' then
    if required then raise exception 'The field % is required', key_name using errcode = '22023'; end if;
    return '';
  end if;
  if length(value) > max_length then
    raise exception 'The field % is longer than % characters', key_name, max_length using errcode = '22001';
  end if;
  return value;
end $$;
revoke all on function tonde_private.ci_text(jsonb,text,integer,boolean) from public, anon, authenticated, service_role;

-- The order of the Scenes of a Production: Act, then Sequence, then Scene order.
create function tonde_private.ci_scene_rank(target_workspace uuid, target_production uuid)
returns table (scene_id uuid, scene_position bigint)
language sql stable security definer set search_path = '' as $$
  select s.id,
    row_number() over (order by coalesce(a.sort_order, 0), coalesce(q.sort_order, 0), s.sort_order, s.created_at, s.id)
  from tonde.scenes s
  left join tonde.acts a on a.id = s.act_id
  left join tonde.sequences q on q.id = s.sequence_id
  where s.workspace_id = target_workspace and s.production_id = target_production and s.lifecycle = 'active';
$$;
revoke all on function tonde_private.ci_scene_rank(uuid,uuid) from public, anon, authenticated, service_role;

-- The order of the Shots of a Production: inside their Scene, by Shot order.
create function tonde_private.ci_shot_rank(target_workspace uuid, target_production uuid)
returns table (shot_id uuid, scene_id uuid, scene_position bigint, shot_order bigint, shot_position bigint)
language sql stable security definer set search_path = '' as $$
  select sh.id, sh.scene_id, r.scene_position, sh.sort_order,
    row_number() over (order by coalesce(r.scene_position, 0), sh.sort_order, sh.created_at, sh.id)
  from tonde.shots sh
  left join tonde_private.ci_scene_rank(target_workspace, target_production) r on r.scene_id = sh.scene_id
  where sh.workspace_id = target_workspace and sh.production_id = target_production and sh.lifecycle = 'active';
$$;
revoke all on function tonde_private.ci_shot_rank(uuid,uuid) from public, anon, authenticated, service_role;

-- The live statements of a Production in Production order. A Scene's opening state sorts before
-- its Shots and its ending state sorts after them, so the timeline reads the way the film plays.
create function tonde_private.ci_timeline(target_workspace uuid, target_production uuid)
returns table (
  state_id uuid, domain tonde.continuity_domain, subject_object_id uuid, subject_label text,
  trait text, anchor tonde.continuity_anchor, scene_id uuid, shot_id uuid,
  scene_label text, shot_label text, value text, transition tonde.continuity_transition,
  origin tonde.continuity_origin, epistemic text, confidence text, reason text,
  effective_scene bigint, effective_position bigint, position_label text, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with scene_order as (select * from tonde_private.ci_scene_rank(target_workspace, target_production)),
  shot_order as (select * from tonde_private.ci_shot_rank(target_workspace, target_production)),
  scene_shots as (
    select o.scene_id, min(o.shot_position) as first_shot, max(o.shot_position) as last_shot
    from shot_order o where o.scene_id is not null group by o.scene_id
  )
  select s.id, s.domain, s.subject_object_id, tonde_private.pi_label(target_workspace, s.subject_object_id),
    s.trait, s.anchor, s.scene_id, s.shot_id,
    (select sc.title from tonde.scenes sc where sc.id = s.scene_id),
    (select sh.title from tonde.shots sh where sh.id = s.shot_id),
    s.value, s.transition, s.origin, s.epistemic, s.confidence, s.reason,
    -- A Shot statement takes its place from the Shot's real position, so the timeline is ordered
    -- by where the object actually sits in the film rather than by what the caller supplied.
    case s.anchor
      when 'shot' then coalesce(o.scene_position, 0)
      when 'production' then 0
      else coalesce(so.scene_position, 0)
    end,
    case s.anchor
      when 'shot' then coalesce(o.shot_position, 0)
      when 'scene_opening' then coalesce(ss.first_shot, 0) - 1
      when 'scene_ending' then coalesce(ss.last_shot, 0) + 1
      else 0
    end,
    case s.anchor
      when 'production' then 'Production'
      when 'shot' then 'Shot ' || coalesce((select sh.title from tonde.shots sh where sh.id = s.shot_id), '')
      when 'scene_opening' then 'Scene ' || coalesce((select sc.title from tonde.scenes sc where sc.id = s.scene_id), '') || ' opening'
      else 'Scene ' || coalesce((select sc.title from tonde.scenes sc where sc.id = s.scene_id), '') || ' ending'
    end,
    s.created_at
  from tonde.continuity_states s
  left join scene_order so on so.scene_id = s.scene_id
  left join shot_order o on o.shot_id = s.shot_id
  left join scene_shots ss on ss.scene_id = s.scene_id
  where s.workspace_id = target_workspace and s.production_id = target_production and s.retired_at is null;
$$;
revoke all on function tonde_private.ci_timeline(uuid,uuid) from public, anon, authenticated, service_role;

-- A statement written after a check makes that check out of date. The marker is the same durable
-- artifact marker the rest of Production intelligence uses; nothing is deleted.
create function tonde_private.ci_mark_stale(target_workspace uuid, target_production uuid, reason_text text, caused_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform tonde_private.pi_mark_stale(target_workspace, target_production, target_production, 'continuity_analysis', null,
    left(coalesce(reason_text,''), 600), caused_by, null, null, null, 'stale');
end $$;
revoke all on function tonde_private.ci_mark_stale(uuid,uuid,text,uuid) from public, anon, authenticated, service_role;

-- 6. Writing a statement. The creator's current statement for a trait at a point is one live row:
-- an identical restatement refreshes it, a different value supersedes it and keeps the old one.
create function tonde.continuity_state_set(target_workspace uuid, target_production uuid, state_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  desired_domain tonde.continuity_domain; desired_anchor tonde.continuity_anchor; desired_transition tonde.continuity_transition;
  desired_epistemic text; desired_confidence text; desired_trait text; desired_value text;
  subject_id uuid; scene_ref uuid; shot_ref uuid; supersedes uuid; saved tonde.continuity_states; existing tonde.continuity_states;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(state_record) <> 'object' then
    raise exception 'A continuity statement must be a JSON object' using errcode = '22023';
  end if;
  -- Validate the controlled vocabulary before casting: an unknown code is a rejected request,
  -- not a database type error.
  if coalesce(nullif(state_record ->> 'domain',''), 'other') not in
      ('character','wardrobe','prop','product','vehicle','injury','hair_makeup','weather','time_of_day',
       'environment','lighting','story_knowledge','dialogue_fact','screen_direction','eyeline',
       'camera_geography','position','product_condition','other') then
    raise exception 'Unsupported continuity domain' using errcode = '22023';
  end if;
  if coalesce(nullif(state_record ->> 'anchor',''), 'production') not in ('production','scene_opening','scene_ending','shot') then
    raise exception 'Unsupported continuity anchor' using errcode = '22023';
  end if;
  if coalesce(nullif(state_record ->> 'transition',''), 'baseline') not in ('baseline','continuous','changed') then
    raise exception 'Unsupported continuity transition' using errcode = '22023';
  end if;
  desired_domain := coalesce(nullif(state_record ->> 'domain',''), 'other')::tonde.continuity_domain;
  desired_anchor := coalesce(nullif(state_record ->> 'anchor',''), 'production')::tonde.continuity_anchor;
  desired_transition := coalesce(nullif(state_record ->> 'transition',''), 'baseline')::tonde.continuity_transition;
  desired_epistemic := coalesce(nullif(state_record ->> 'epistemic',''), 'observed');
  desired_confidence := coalesce(nullif(state_record ->> 'confidence',''), 'high');
  if desired_epistemic not in ('observed','estimated','recommended','unknown') then
    raise exception 'Unsupported epistemic status' using errcode = '22023';
  end if;
  if desired_confidence not in ('high','medium','low') then
    raise exception 'Unsupported confidence' using errcode = '22023';
  end if;
  desired_trait := tonde_private.ci_text(state_record, 'trait', 120, true);
  desired_value := tonde_private.ci_text(state_record, 'value', 400, true);
  subject_id := nullif(state_record ->> 'subject_object_id','')::uuid;
  scene_ref := nullif(state_record ->> 'scene_id','')::uuid;
  shot_ref := nullif(state_record ->> 'shot_id','')::uuid;
  if desired_anchor = 'shot' then
    select sh.scene_id into scene_ref from tonde.shots sh where sh.workspace_id = target_workspace
      and sh.production_id = target_production and sh.id = shot_ref and sh.lifecycle = 'active';
    if not found then
      raise exception 'The Shot for this statement is not in this Production' using errcode = '22023';
    end if;
  else
    shot_ref := null;
    if desired_anchor = 'production' then
      scene_ref := null;
    elsif scene_ref is null or not exists (select 1 from tonde.scenes sc where sc.workspace_id = target_workspace
      and sc.production_id = target_production and sc.id = scene_ref and sc.lifecycle = 'active') then
      raise exception 'The Scene for this statement is not in this Production' using errcode = '22023';
    end if;
  end if;
  if subject_id is not null and not exists (select 1 from tonde.objects o
      where o.workspace_id = target_workspace and o.id = subject_id) then
    raise exception 'The subject of this statement is not in this workspace' using errcode = '22023';
  end if;

  select * into existing from tonde.continuity_states s
    where s.workspace_id = target_workspace and s.production_id = target_production and s.retired_at is null
      and s.domain = desired_domain and s.trait = desired_trait and s.anchor = desired_anchor
      and s.subject_object_id is not distinct from subject_id
      and s.scene_id is not distinct from scene_ref and s.shot_id is not distinct from shot_ref;
  if found then
    if existing.value = desired_value and existing.transition = desired_transition then
      update tonde.continuity_states s set
        reason = tonde_private.ci_text(state_record, 'reason', 600, false),
        note = tonde_private.ci_text(state_record, 'note', 400, false),
        epistemic = desired_epistemic, confidence = desired_confidence,
        evidence = coalesce(state_record -> 'evidence', '[]'::jsonb)
      where s.id = existing.id returning * into saved;
      return jsonb_build_object('state_id', saved.id, 'updated', true, 'superseded_state_id', null,
        'anchor', saved.anchor, 'trait', saved.trait, 'value', saved.value,
        'note', 'The statement was already recorded at this point, so it was refreshed in place.');
    end if;
    supersedes := existing.id;
  end if;

  -- Retire the older statement first: one live statement per trait per point is a constraint, not
  -- a convention, and the history row must exist before the new version takes its place.
  if supersedes is not null then
    update tonde.continuity_states s set retired_at = now(), retired_by = auth.uid(),
      retire_reason = left('Superseded by a newer statement at the same point in the Production.', 400)
    where s.id = supersedes;
  end if;
  insert into tonde.continuity_states(workspace_id, production_id, domain, subject_object_id, trait, anchor, scene_id, shot_id,
    value, transition, origin, epistemic, confidence, reason, evidence, note, supersedes_id)
  values (target_workspace, target_production, desired_domain, subject_id, desired_trait, desired_anchor, scene_ref, shot_ref,
    desired_value, desired_transition, 'declared', desired_epistemic, desired_confidence,
    tonde_private.ci_text(state_record, 'reason', 600, false),
    coalesce(state_record -> 'evidence', '[]'::jsonb),
    tonde_private.ci_text(state_record, 'note', 400, false), supersedes)
  returning * into saved;

  -- The marker names the real canonical object it can point at (the Scene or Shot), never a
  -- statement id, which is not an object in the registry.
  perform tonde_private.ci_mark_stale(target_workspace, target_production,
    'A continuity statement changed after this check was run.', coalesce(saved.shot_id, saved.scene_id));
  return jsonb_build_object('state_id', saved.id, 'updated', false, 'superseded_state_id', supersedes,
    'anchor', saved.anchor, 'trait', saved.trait, 'value', saved.value, 'transition', saved.transition,
    'note', case when supersedes is null then 'The statement is recorded.'
      else 'The previous statement at this point was kept and marked as superseded.' end);
end $$;

create function tonde.continuity_state_retire(target_workspace uuid, target_production uuid, target_state uuid,
  reason_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.continuity_states;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into saved from tonde.continuity_states s
    where s.workspace_id = target_workspace and s.production_id = target_production and s.id = target_state;
  if not found then raise exception 'That continuity statement is unavailable' using errcode = 'P0002'; end if;
  if saved.retired_at is not null then
    raise exception 'That continuity statement was already retired' using errcode = '23514';
  end if;
  update tonde.continuity_states s set retired_at = now(), retired_by = auth.uid(),
    retire_reason = left(coalesce(nullif(btrim(reason_text), ''), 'The creator retired this statement.'), 400)
  where s.id = saved.id;
  perform tonde_private.ci_mark_stale(target_workspace, target_production,
    'A continuity statement was retired after this check was run.', coalesce(saved.shot_id, saved.scene_id));
  return jsonb_build_object('state_id', saved.id, 'retired', true,
    'note', 'The statement is retired, not deleted: its history stays readable.');
end $$;

-- 7. Reading. Membership is re-checked in the database; knowing an id is not authorization.
create function tonde.continuity_state_list(target_workspace uuid, target_production uuid, target_subject uuid default null,
  target_domain text default null, include_retired boolean default false, target_limit integer default 100,
  target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer; live_count integer;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  lim := least(greatest(coalesce(target_limit, 100), 1), 200);
  off := greatest(coalesce(target_offset, 0), 0);
  select count(*) into total from tonde.continuity_states s
    where s.workspace_id = target_workspace and s.production_id = target_production
      and (include_retired or s.retired_at is null)
      and (target_subject is null or s.subject_object_id = target_subject)
      and (target_domain is null or s.domain = target_domain::tonde.continuity_domain);
  select count(*) into live_count from tonde.continuity_states s
    where s.workspace_id = target_workspace and s.production_id = target_production and s.retired_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
      'state_id', s.id, 'domain', s.domain, 'subject_object_id', s.subject_object_id,
      'subject_label', tonde_private.pi_label(target_workspace, s.subject_object_id),
      'subject_kind', (select o.kind from tonde.objects o where o.workspace_id = target_workspace and o.id = s.subject_object_id),
      'trait', s.trait, 'anchor', s.anchor, 'scene_id', s.scene_id, 'shot_id', s.shot_id,
      'scene_label', (select sc.title from tonde.scenes sc where sc.id = s.scene_id),
      'shot_label', (select sh.title from tonde.shots sh where sh.id = s.shot_id),
      'value', s.value, 'transition', s.transition, 'origin', s.origin, 'epistemic', s.epistemic,
      'confidence', s.confidence, 'reason', s.reason, 'note', s.note,
      'retired', s.retired_at is not null, 'retire_reason', s.retire_reason, 'revision', s.revision,
      'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
    into items
  from (select * from tonde.continuity_states s
    where s.workspace_id = target_workspace and s.production_id = target_production
      and (include_retired or s.retired_at is null)
      and (target_subject is null or s.subject_object_id = target_subject)
      and (target_domain is null or s.domain = target_domain::tonde.continuity_domain)
    order by s.created_at desc limit lim offset off) s;
  return jsonb_build_object('items', items, 'total', total, 'live', live_count, 'limit', lim, 'offset', off,
    'truncated', total > off + lim);
end $$;

-- The timeline of one subject: what changed, when, and why.
create function tonde.continuity_chain(target_workspace uuid, target_production uuid, target_subject uuid,
  target_domain text default null, target_trait text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb; statement_count integer;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  select coalesce(jsonb_agg(jsonb_build_object(
      'state_id', t.state_id, 'domain', t.domain, 'trait', t.trait, 'anchor', t.anchor,
      'position_label', t.position_label, 'scene_id', t.scene_id, 'shot_id', t.shot_id,
      'value', t.value, 'transition', t.transition, 'origin', t.origin, 'epistemic', t.epistemic,
      'confidence', t.confidence, 'reason', t.reason) order by t.effective_scene, t.effective_position, t.created_at, t.state_id),
    '[]'::jsonb), count(*)
    into items, statement_count
  from tonde_private.ci_timeline(target_workspace, target_production) t
  where t.subject_object_id = target_subject
    and (target_domain is null or t.domain = target_domain::tonde.continuity_domain)
    and (target_trait is null or t.trait = target_trait);
  return jsonb_build_object('subject_object_id', target_subject,
    'subject_label', tonde_private.pi_label(target_workspace, target_subject),
    'statements', coalesce(items, '[]'::jsonb), 'statement_count', coalesce(statement_count, 0),
    'note', 'This is the recorded timeline of the subject. It lists declared statements in Production order.');
end $$;

-- 8. The check. Deterministic, bounded, and truthful about what it did not look at.
create function tonde.continuity_check(target_workspace uuid, target_production uuid, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_production tonde.productions; saved tonde.continuity_checks;
  live_states integer; retired_states integer; watermark timestamptz;
  critical_found integer; warning_found integer; info_found integer; total_found integer;
  verdict_value text; explanation_text text;
  limitations constant text := 'This check compares the continuity statements recorded for this Production. It does not analyse media, so a clean result means the declarations agree, not that the footage is consistent.';
begin
  current_production := tonde_private.studio_guard(target_workspace, target_production, null);
  select count(*) filter (where s.retired_at is null), count(*) filter (where s.retired_at is not null), max(s.updated_at)
    into live_states, retired_states, watermark
  from tonde.continuity_states s
  where s.workspace_id = target_workspace and s.production_id = target_production;
  insert into tonde.continuity_checks(workspace_id, production_id, production_revision, state_count, state_watermark, note, limitations)
  values (target_workspace, target_production, current_production.revision, coalesce(live_states, 0), watermark,
    left(coalesce(note_text, ''), 400), limitations)
  returning * into saved;

  -- An undeclared value change inside one Scene: a caution the creator should confirm.
  with lagged as (
    select t.*, lag(t.value) over w as previous_value, lag(t.state_id) over w as previous_state_id,
      lag(t.effective_scene) over w as previous_scene
    from tonde_private.ci_timeline(target_workspace, target_production) t
    window w as (partition by t.subject_object_id, t.domain, t.trait
      order by t.effective_scene, t.effective_position, t.created_at, t.state_id)
  )
  insert into tonde.continuity_findings(workspace_id, production_id, check_id, kind, severity, domain, subject_object_id, trait,
    earlier_state_id, later_state_id, at_scene_id, at_shot_id, explanation, suggested_resolution, origin, epistemic, confidence, evidence)
  select target_workspace, target_production, saved.id, 'unexplained_change', 'warning', g.domain, g.subject_object_id, g.trait,
    g.previous_state_id, g.state_id, g.scene_id, g.shot_id,
    'The statement for "' || g.trait || '" at ' || g.position_label || ' says "' || g.value
      || '" but the earlier statement said "' || g.previous_value || '", and no change was declared.',
    'Declare the change explicitly with a reason, or correct the statement so the trait keeps one value.',
    'derived', 'observed', 'high',
    jsonb_build_array(jsonb_build_object('kind', 'continuity_state', 'object_id', g.previous_state_id),
      jsonb_build_object('kind', 'continuity_state', 'object_id', g.state_id))
  from lagged g
  where g.previous_state_id is not null and g.previous_value is distinct from g.value
    and g.transition <> 'changed'
    and coalesce(g.previous_scene, -1) = coalesce(g.effective_scene, -1);

  -- The same undeclared change across a Scene boundary: the state did not carry over.
  with lagged as (
    select t.*, lag(t.value) over w as previous_value, lag(t.state_id) over w as previous_state_id,
      lag(t.position_label) over w as previous_label, lag(t.effective_scene) over w as previous_scene
    from tonde_private.ci_timeline(target_workspace, target_production) t
    window w as (partition by t.subject_object_id, t.domain, t.trait
      order by t.effective_scene, t.effective_position, t.created_at, t.state_id)
  )
  insert into tonde.continuity_findings(workspace_id, production_id, check_id, kind, severity, domain, subject_object_id, trait,
    earlier_state_id, later_state_id, at_scene_id, at_shot_id, explanation, suggested_resolution, origin, epistemic, confidence, evidence)
  select target_workspace, target_production, saved.id, 'boundary_break', 'critical', g.domain, g.subject_object_id, g.trait,
    g.previous_state_id, g.state_id, g.scene_id, g.shot_id,
    'The trait "' || g.trait || '" was "' || g.previous_value || '" at ' || coalesce(g.previous_label, 'an earlier point')
      || ' and is "' || g.value || '" at ' || g.position_label || ' across a Scene boundary, and no change was declared.',
    'Confirm the state actually carries over, or declare the change and the reason for it.',
    'derived', 'observed', 'high',
    jsonb_build_array(jsonb_build_object('kind', 'continuity_state', 'object_id', g.previous_state_id),
      jsonb_build_object('kind', 'continuity_state', 'object_id', g.state_id))
  from lagged g
  where g.previous_state_id is not null and g.previous_value is distinct from g.value
    and g.transition <> 'changed'
    and coalesce(g.previous_scene, -1) <> coalesce(g.effective_scene, -1);

  -- A declared change with no reason: later Shots cannot be checked against why it happened.
  insert into tonde.continuity_findings(workspace_id, production_id, check_id, kind, severity, domain, subject_object_id, trait,
    earlier_state_id, later_state_id, at_scene_id, at_shot_id, explanation, suggested_resolution, origin, epistemic, confidence, evidence)
  select target_workspace, target_production, saved.id, 'missing_reason', 'warning', t.domain, t.subject_object_id, t.trait,
    null, t.state_id, t.scene_id, t.shot_id,
    'The change of "' || t.trait || '" to "' || t.value || '" at ' || t.position_label || ' was declared without a reason.',
    'Record why the trait changed, so later Shots can be checked against it.',
    'derived', 'observed', 'high',
    jsonb_build_array(jsonb_build_object('kind', 'continuity_state', 'object_id', t.state_id))
  from tonde_private.ci_timeline(target_workspace, target_production) t
  where t.transition = 'changed' and btrim(t.reason) = '';

  -- A declared change to a subject the creator protected with a continuity lock.
  insert into tonde.continuity_findings(workspace_id, production_id, check_id, kind, severity, domain, subject_object_id, trait,
    earlier_state_id, later_state_id, at_scene_id, at_shot_id, explanation, suggested_resolution, origin, epistemic, confidence, evidence)
  select target_workspace, target_production, saved.id, 'lock_conflict', 'critical', t.domain, t.subject_object_id, t.trait,
    null, t.state_id, t.scene_id, t.shot_id,
    'The declared change of "' || t.trait || '" at ' || t.position_label || ' touches '
      || coalesce(t.subject_label, 'a subject') || ', which is protected by a continuity lock ('
      || l.priority::text || ').',
    'Propose the change explicitly, or unlock the scope first: a locked decision is not changed incidentally.',
    'derived', 'observed', 'high',
    jsonb_build_array(jsonb_build_object('kind', 'continuity_lock', 'object_id', l.id),
      jsonb_build_object('kind', 'continuity_state', 'object_id', t.state_id))
  from tonde_private.ci_timeline(target_workspace, target_production) t
  join tonde.ai_continuity_locks l on l.workspace_id = target_workspace and l.production_id = target_production
    and l.locked and l.subject_id is not null and l.subject_id = t.subject_object_id
  where t.transition = 'changed';

  -- The last recorded statement for a trait is a declared change and work continues after it:
  -- continuity for that trait is unknown from there on, and it says so instead of guessing.
  with timeline as (select * from tonde_private.ci_timeline(target_workspace, target_production)),
  last_statement as (
    select distinct on (t.subject_object_id, t.domain, t.trait) t.*
    from timeline t
    order by t.subject_object_id, t.domain, t.trait, t.effective_scene desc, t.effective_position desc, t.created_at desc, t.state_id desc
  )
  insert into tonde.continuity_findings(workspace_id, production_id, check_id, kind, severity, domain, subject_object_id, trait,
    earlier_state_id, later_state_id, at_scene_id, at_shot_id, explanation, suggested_resolution, origin, epistemic, confidence, evidence)
  select target_workspace, target_production, saved.id, 'unverified_after', 'info', l.domain, l.subject_object_id, l.trait,
    l.state_id, null, l.scene_id, l.shot_id,
    'The last recorded statement for "' || l.trait || '" is a declared change at ' || l.position_label
      || ' and there is later work in the Production with no statement after it.',
    'Add the state for the later work, or accept that continuity for this trait is unknown after that point.',
    'derived', 'observed', 'high',
    jsonb_build_array(jsonb_build_object('kind', 'continuity_state', 'object_id', l.state_id))
  from last_statement l
  where l.transition = 'changed'
    and exists (select 1 from tonde_private.ci_shot_rank(target_workspace, target_production) o
      where (coalesce(o.scene_position, 0), o.shot_position) > (coalesce(l.effective_scene, 0), coalesce(l.effective_position, 0)));

  select count(*) filter (where f.severity = 'critical'), count(*) filter (where f.severity = 'warning'),
    count(*) filter (where f.severity = 'info'), count(*)
    into critical_found, warning_found, info_found, total_found
  from tonde.continuity_findings f
  where f.workspace_id = target_workspace and f.check_id = saved.id;
  verdict_value := case when coalesce(critical_found, 0) > 0 then 'conflict'
    when coalesce(warning_found, 0) > 0 then 'needs_review' else 'consistent' end;
  explanation_text := case
    when coalesce(live_states, 0) = 0 then 'No continuity statements are recorded for this Production, so there was nothing to compare.'
    when coalesce(total_found, 0) = 0 then 'The recorded continuity statements agree at every point they describe.'
    when coalesce(critical_found, 0) > 0 then coalesce(critical_found, 0)::text || ' continuity conflict'
      || case when critical_found = 1 then '' else 's' end || ' need a creator decision.'
    when coalesce(warning_found, 0) > 0 then coalesce(warning_found, 0)::text || ' statement'
      || case when warning_found = 1 then '' else 's' end || ' should be confirmed.'
    else coalesce(info_found, 0)::text || ' trait' || case when info_found = 1 then '' else 's' end
      || ' have no statement after a declared change, so continuity there is unknown rather than consistent.'
    end;
  update tonde.continuity_checks c set finding_count = coalesce(total_found, 0),
    critical_count = coalesce(critical_found, 0), warning_count = coalesce(warning_found, 0),
    info_count = coalesce(info_found, 0),
    counts = jsonb_build_object('critical', coalesce(critical_found, 0), 'warning', coalesce(warning_found, 0),
      'info', coalesce(info_found, 0), 'live_states', coalesce(live_states, 0), 'retired_states', coalesce(retired_states, 0)),
    verdict = verdict_value, explanation = explanation_text
  where c.id = saved.id returning * into saved;

  -- A fresh check addresses the recorded analysis: the marker closes, the history stays.
  update tonde.stale_artifacts a set state = 'current', resolved_at = now(), resolved_by = auth.uid()
    where a.workspace_id = target_workspace and a.production_id = target_production
      and a.artifact_kind = 'continuity_analysis' and a.object_id = target_production and a.state <> 'current';

  return jsonb_build_object('check_id', saved.id, 'verdict', saved.verdict, 'counts', saved.counts,
    'finding_count', saved.finding_count, 'state_count', saved.state_count, 'production_revision', saved.production_revision,
    'state_watermark', saved.state_watermark, 'explanation', saved.explanation, 'limitations', saved.limitations,
    'created_at', saved.created_at,
    'findings', (select coalesce(jsonb_agg(jsonb_build_object(
        'finding_id', f.id, 'kind', f.kind, 'severity', f.severity, 'domain', f.domain, 'trait', f.trait,
        'subject_object_id', f.subject_object_id, 'subject_label', tonde_private.pi_label(target_workspace, f.subject_object_id),
        'earlier_state_id', f.earlier_state_id, 'later_state_id', f.later_state_id,
        'scene_id', f.at_scene_id, 'shot_id', f.at_shot_id,        'explanation', f.explanation, 'suggested_resolution', f.suggested_resolution, 'origin', f.origin, 'state', f.state,
        'epistemic', f.epistemic, 'confidence', f.confidence, 'evidence', f.evidence, 'rationale', f.rationale,
        'created_at', f.created_at) order by
          case f.severity when 'critical' then 0 when 'warning' then 1 else 2 end, f.created_at), '[]'::jsonb)
      from tonde.continuity_findings f where f.workspace_id = target_workspace and f.check_id = saved.id));
end $$;

-- 9. Findings: read, and a creator decision. Nothing here approves work or rewrites a statement.
create function tonde.continuity_finding_list(target_workspace uuid, target_production uuid, target_state text default null,
  target_severity text default null, target_check uuid default null, target_limit integer default 100,
  target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer; latest uuid; latest_check jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  lim := least(greatest(coalesce(target_limit, 100), 1), 200);
  off := greatest(coalesce(target_offset, 0), 0);
  select c.id into latest from tonde.continuity_checks c
    where c.workspace_id = target_workspace and c.production_id = target_production
    order by c.created_at desc, c.id desc limit 1;
  -- Whether a check is still current is a comparison against the recorded statements, never a guess.
  select jsonb_build_object('check_id', c.id, 'verdict', c.verdict, 'counts', c.counts,
      'explanation', c.explanation, 'limitations', c.limitations, 'created_at', c.created_at,
      'state_count', c.state_count, 'state_watermark', c.state_watermark,
      'is_current', c.state_watermark is not distinct from (select max(s.updated_at) from tonde.continuity_states s
          where s.workspace_id = target_workspace and s.production_id = target_production and s.retired_at is null)
        and c.state_count = (select count(*) from tonde.continuity_states s
          where s.workspace_id = target_workspace and s.production_id = target_production and s.retired_at is null))
    into latest_check
  from tonde.continuity_checks c
  where c.workspace_id = target_workspace and c.production_id = target_production
    and c.id = coalesce(target_check, latest);
  select count(*) into total from tonde.continuity_findings f
    where f.workspace_id = target_workspace and f.production_id = target_production
      and (target_state is null or f.state = target_state::tonde.continuity_finding_state)
      and (target_severity is null or f.severity = target_severity)
      -- A recorded check's findings, or a proposal that belongs to no check. A proposal is never
      -- hidden merely because a deterministic check exists.
      and (f.check_id = coalesce(target_check, latest) or (target_check is null and f.check_id is null));
  select coalesce(jsonb_agg(jsonb_build_object(
      'finding_id', f.id, 'kind', f.kind, 'severity', f.severity, 'domain', f.domain, 'trait', f.trait,
      'subject_object_id', f.subject_object_id, 'subject_label', tonde_private.pi_label(target_workspace, f.subject_object_id),
      'earlier_state_id', f.earlier_state_id, 'later_state_id', f.later_state_id,
      'scene_id', f.at_scene_id, 'shot_id', f.at_shot_id, 'scene_label', (select sc.title from tonde.scenes sc where sc.id = f.at_scene_id),
      'shot_label', (select sh.title from tonde.shots sh where sh.id = f.at_shot_id),
      'explanation', f.explanation, 'suggested_resolution', f.suggested_resolution,
      'origin', f.origin, 'rationale', f.rationale, 'epistemic', f.epistemic, 'confidence', f.confidence,
      'evidence', f.evidence, 'state', f.state, 'resolution_note', f.resolution_note,
      'resolved_at', f.resolved_at, 'check_id', f.check_id, 'created_at', f.created_at) order by
        case f.severity when 'critical' then 0 when 'warning' then 1 else 2 end, f.created_at desc), '[]'::jsonb)
    into items
  from (select * from tonde.continuity_findings f
    where f.workspace_id = target_workspace and f.production_id = target_production
      and (target_state is null or f.state = target_state::tonde.continuity_finding_state)
      and (target_severity is null or f.severity = target_severity)
      and (f.check_id = coalesce(target_check, latest) or (target_check is null and f.check_id is null))
    order by case f.severity when 'critical' then 0 when 'warning' then 1 else 2 end, f.created_at desc
    limit lim offset off) f;
  return jsonb_build_object('items', items, 'total', total, 'limit', lim, 'offset', off, 'truncated', total > off + lim,
    'check', coalesce(latest_check, 'null'::jsonb), 'checks_available', (select count(*) from tonde.continuity_checks c
      where c.workspace_id = target_workspace and c.production_id = target_production),
    'open_count', (select count(*) from tonde.continuity_findings f
      where f.workspace_id = target_workspace and f.production_id = target_production and f.state in ('open','acknowledged')),
    'note', 'A finding describes the recorded statements. Resolving it is a creator decision and does not change the statements.');
end $$;

create function tonde.continuity_finding_update(target_workspace uuid, target_production uuid, target_finding uuid,
  desired_state text, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.continuity_findings; desired tonde.continuity_finding_state;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if desired_state not in ('open','acknowledged','resolved','waived') then
    raise exception 'Unsupported finding state' using errcode = '22023';
  end if;
  desired := desired_state::tonde.continuity_finding_state;
  select * into saved from tonde.continuity_findings f
    where f.workspace_id = target_workspace and f.production_id = target_production and f.id = target_finding;
  if not found then raise exception 'That continuity finding is unavailable' using errcode = 'P0002'; end if;
  update tonde.continuity_findings f set state = desired,
    resolution_note = tonde_private.ci_text(jsonb_build_object('note', note_text), 'note', 800, false),
    resolved_by = case when desired in ('resolved','waived') then auth.uid() else null end,
    resolved_at = case when desired in ('resolved','waived') then now() else null end
  where f.id = saved.id returning * into saved;
  return jsonb_build_object('finding_id', saved.id, 'state', saved.state, 'resolution_note', saved.resolution_note,
    'resolved_at', saved.resolved_at,
    'note', 'The finding was recorded. The continuity statements and any approval are unchanged.');
end $$;

-- An inferred proposal. It can never claim to be an observation, and it cannot resolve itself.
create function tonde.continuity_finding_record(target_workspace uuid, target_production uuid, finding_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  desired_kind tonde.continuity_finding_kind; desired_domain tonde.continuity_domain; desired_severity text;
  desired_epistemic text; desired_confidence text; subject_id uuid; scene_ref uuid; shot_ref uuid;
  explanation_text text; resolution_text text; rationale_text text; evidence_value jsonb; saved tonde.continuity_findings;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(finding_record) <> 'object' then
    raise exception 'A continuity proposal must be a JSON object' using errcode = '22023';
  end if;
  if coalesce(nullif(finding_record ->> 'kind',''), 'unexplained_change') not in
      ('unexplained_change','boundary_break','missing_reason','lock_conflict','unverified_after') then
    raise exception 'Unsupported continuity finding kind' using errcode = '22023';
  end if;
  if coalesce(nullif(finding_record ->> 'domain',''), 'other') not in
      ('character','wardrobe','prop','product','vehicle','injury','hair_makeup','weather','time_of_day',
       'environment','lighting','story_knowledge','dialogue_fact','screen_direction','eyeline',
       'camera_geography','position','product_condition','other') then
    raise exception 'Unsupported continuity domain' using errcode = '22023';
  end if;
  desired_kind := coalesce(nullif(finding_record ->> 'kind',''), 'unexplained_change')::tonde.continuity_finding_kind;
  desired_domain := coalesce(nullif(finding_record ->> 'domain',''), 'other')::tonde.continuity_domain;
  desired_severity := coalesce(nullif(finding_record ->> 'severity',''), 'info');
  desired_epistemic := coalesce(nullif(finding_record ->> 'epistemic',''), 'estimated');
  desired_confidence := coalesce(nullif(finding_record ->> 'confidence',''), 'low');
  if desired_severity not in ('info','warning','critical') then
    raise exception 'Unsupported severity' using errcode = '22023';
  end if;
  -- A proposal is an estimate or a recommendation. Observation requires evidence this path cannot produce.
  if desired_epistemic not in ('estimated','recommended','unknown') then
    raise exception 'A proposal cannot claim an observation' using errcode = '23514';
  end if;
  if desired_confidence not in ('high','medium','low') then
    raise exception 'Unsupported confidence' using errcode = '22023';
  end if;
  explanation_text := tonde_private.ci_text(finding_record, 'explanation', 1200, true);
  resolution_text := tonde_private.ci_text(finding_record, 'suggested_resolution', 1200, false);
  rationale_text := tonde_private.ci_text(finding_record, 'rationale', 1200, true);
  evidence_value := coalesce(finding_record -> 'evidence', '[]'::jsonb);
  if jsonb_typeof(evidence_value) <> 'array' or jsonb_array_length(evidence_value) = 0 then
    raise exception 'An estimated proposal must disclose its basis' using errcode = '23514';
  end if;
  subject_id := nullif(finding_record ->> 'subject_object_id','')::uuid;
  scene_ref := nullif(finding_record ->> 'scene_id','')::uuid;
  shot_ref := nullif(finding_record ->> 'shot_id','')::uuid;
  if subject_id is not null and not exists (select 1 from tonde.objects o
      where o.workspace_id = target_workspace and o.id = subject_id) then
    raise exception 'The subject of this proposal is not in this workspace' using errcode = '22023';
  end if;
  if scene_ref is not null and not exists (select 1 from tonde.scenes sc
      where sc.workspace_id = target_workspace and sc.production_id = target_production and sc.id = scene_ref) then
    raise exception 'The Scene of this proposal is not in this Production' using errcode = '22023';
  end if;
  if shot_ref is not null and not exists (select 1 from tonde.shots sh
      where sh.workspace_id = target_workspace and sh.production_id = target_production and sh.id = shot_ref) then
    raise exception 'The Shot of this proposal is not in this Production' using errcode = '22023';
  end if;
  insert into tonde.continuity_findings(workspace_id, production_id, check_id, kind, severity, domain, subject_object_id, trait,
    at_scene_id, at_shot_id, explanation, suggested_resolution, origin, rationale, epistemic, confidence, evidence, state)
  values (target_workspace, target_production, null, desired_kind, desired_severity, desired_domain, subject_id,
    tonde_private.ci_text(finding_record, 'trait', 120, false), scene_ref, shot_ref, explanation_text, resolution_text,
    'inferred', rationale_text, desired_epistemic, desired_confidence, evidence_value, 'open')
  returning * into saved;
  return jsonb_build_object('finding_id', saved.id, 'state', saved.state, 'origin', saved.origin,
    'epistemic', saved.epistemic, 'confidence', saved.confidence,
    'note', 'This is a proposal, not a finding of fact. It does not change any continuity statement.');
end $$;

-- 10. Summary: the readiness input, and the honest answer to "is the last check still true?".
create function tonde.continuity_summary(target_workspace uuid, target_production uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  live_states integer; retired_states integer; subject_count integer; domains jsonb;
  latest tonde.continuity_checks; current_watermark timestamptz; current_count integer;
  open_findings integer; acknowledged_findings integer; critical_open integer; marker_state text;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  select count(*) filter (where s.retired_at is null), count(*) filter (where s.retired_at is not null),
    count(distinct s.subject_object_id) filter (where s.retired_at is null and s.subject_object_id is not null),
    max(s.updated_at)
    into live_states, retired_states, subject_count, current_watermark
  from tonde.continuity_states s
  where s.workspace_id = target_workspace and s.production_id = target_production;
  select count(*) into current_count from tonde.continuity_states s
    where s.workspace_id = target_workspace and s.production_id = target_production and s.retired_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('domain', d.domain, 'count', d.count) order by d.count desc, d.domain), '[]'::jsonb)
    into domains
  from (select s.domain, count(*) as count from tonde.continuity_states s
    where s.workspace_id = target_workspace and s.production_id = target_production and s.retired_at is null
    group by s.domain) d;
  select * into latest from tonde.continuity_checks c
    where c.workspace_id = target_workspace and c.production_id = target_production
    order by c.created_at desc, c.id desc limit 1;
  select count(*) filter (where f.state = 'open'), count(*) filter (where f.state = 'acknowledged'),
    count(*) filter (where f.state in ('open','acknowledged') and f.severity = 'critical')
    into open_findings, acknowledged_findings, critical_open
  from tonde.continuity_findings f
  where f.workspace_id = target_workspace and f.production_id = target_production;
  select a.state::text into marker_state from tonde.stale_artifacts a
    where a.workspace_id = target_workspace and a.production_id = target_production
      and a.artifact_kind = 'continuity_analysis' and a.object_id = target_production
    order by a.created_at desc limit 1;
  return jsonb_build_object(
    'live_states', coalesce(live_states, 0), 'retired_states', coalesce(retired_states, 0),
    'subject_count', coalesce(subject_count, 0), 'domains', domains,
    'check', case when latest.id is null then 'null'::jsonb else jsonb_build_object(
      'check_id', latest.id, 'verdict', latest.verdict, 'counts', latest.counts, 'explanation', latest.explanation,
      'limitations', latest.limitations, 'created_at', latest.created_at,
      'is_current', latest.state_watermark is not distinct from current_watermark and latest.state_count = coalesce(current_count, 0),
      'state_count_at_check', latest.state_count) end,
    'findings', jsonb_build_object('open', coalesce(open_findings, 0), 'acknowledged', coalesce(acknowledged_findings, 0),
      'critical_open', coalesce(critical_open, 0)),
    'analysis_stale', coalesce(marker_state, 'none') in ('stale','conflicted'),
    'limitations', 'Continuity here is what the Production records. It is not a claim about analysed media, and an unrecorded trait is unknown rather than consistent.');
end $$;

-- 11. RLS. Every new table is workspace-isolated; enabling RLS is not optional.
do $$ declare item text; begin
  foreach item in array array['continuity_states','continuity_checks','continuity_findings'] loop
    execute format('alter table tonde.%I enable row level security', item);
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', item);
    execute format('create policy tenant_insert on tonde.%I for insert to authenticated with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('create policy tenant_update on tonde.%I for update to authenticated using (tonde_private.can_edit_workspace(workspace_id)) with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('grant select, insert, update on tonde.%I to authenticated', item);
  end loop;
end $$;

-- 12. Mutation guards: identity stays immutable and no statement is rewritten by an edit.
do $$ declare item text; begin
  foreach item in array array['continuity_states','continuity_checks','continuity_findings'] loop
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', item);
  end loop;
end $$;

-- 13. A changed Scene or Shot makes the recorded continuity analysis out of date. Nothing is
-- deleted and no statement is touched: the marker says the analysis needs to run again.
create function tonde_private.ci_stale_on_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if to_jsonb(new) - array['revision','updated_at'] is not distinct from to_jsonb(old) - array['revision','updated_at'] then
    return new;
  end if;
  perform tonde_private.ci_mark_stale(new.workspace_id, new.production_id,
    'The ' || tg_argv[0] || ' changed after this continuity analysis was run.', new.id);
  return new;
end $$;
revoke all on function tonde_private.ci_stale_on_change() from public, anon, authenticated, service_role;
create trigger zz_continuity_on_scene_change after update on tonde.scenes
  for each row execute function tonde_private.ci_stale_on_change('Scene');
create trigger zz_continuity_on_shot_change after update on tonde.shots
  for each row execute function tonde_private.ci_stale_on_change('Shot');

-- 14. Privileges: authenticated only, and the private helpers stay unreachable.
revoke all on function
  tonde.continuity_state_set(uuid,uuid,jsonb),
  tonde.continuity_state_retire(uuid,uuid,uuid,text),
  tonde.continuity_state_list(uuid,uuid,uuid,text,boolean,integer,integer),
  tonde.continuity_chain(uuid,uuid,uuid,text,text),
  tonde.continuity_check(uuid,uuid,text),
  tonde.continuity_finding_list(uuid,uuid,text,text,uuid,integer,integer),
  tonde.continuity_finding_update(uuid,uuid,uuid,text,text),
  tonde.continuity_finding_record(uuid,uuid,jsonb),
  tonde.continuity_summary(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  tonde.continuity_state_set(uuid,uuid,jsonb),
  tonde.continuity_state_retire(uuid,uuid,uuid,text),
  tonde.continuity_state_list(uuid,uuid,uuid,text,boolean,integer,integer),
  tonde.continuity_chain(uuid,uuid,uuid,text,text),
  tonde.continuity_check(uuid,uuid,text),
  tonde.continuity_finding_list(uuid,uuid,text,text,uuid,integer,integer),
  tonde.continuity_finding_update(uuid,uuid,uuid,text,text),
  tonde.continuity_finding_record(uuid,uuid,jsonb),
  tonde.continuity_summary(uuid,uuid)
  to authenticated;
commit;
