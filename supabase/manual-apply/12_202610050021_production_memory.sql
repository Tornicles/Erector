begin;

-- 1. Vocabulary. Storage codes are the generated product vocabulary keys.
-- The source IS the authority tier, in the order the constitution fixes: a current creator
-- instruction outranks a current Production decision, which outranks an explicit saved
-- preference, which outranks a historical pattern, which outranks an inference.
create type tonde.memory_scope as enum ('production','series','workspace');
create type tonde.memory_kind as enum
  ('preference','decision','pattern','technique','setup_fact','asset_usage','model_outcome','series_rule','correction','other');
create type tonde.memory_source as enum
  ('creator_instruction','production_decision','saved_preference','historical_pattern','inference');
-- Declared = the creator wrote it. Accepted = the creator accepted a candidate. Inferred = TONDE
-- derived it and nobody has confirmed it.
create type tonde.memory_origin as enum ('declared','accepted','inferred');

-- 2. Memory policies. One explicit row per scope when the creator sets one. The default, when no
-- row exists, is recorded in mi_policy: candidates may be RECORDED (recording is not saving) and
-- nothing is accepted automatically. An inferred successful pattern becomes reusable memory only
-- through this policy or through an explicit creator decision.
create table tonde.memory_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  scope tonde.memory_scope not null,
  production_id uuid, series_id uuid,
  candidate_capture boolean not null default true,
  auto_accept_candidates boolean not null default false,
  note text not null default '' check (length(note) <= 600),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((scope = 'production' and production_id is not null and series_id is null)
      or (scope = 'series' and series_id is not null)
      or (scope = 'workspace' and production_id is null and series_id is null)),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, series_id) references tonde.series(workspace_id, id) on delete restrict
);
create unique index memory_policies_identity on tonde.memory_policies
  (workspace_id, scope, coalesce(production_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(series_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 3. Successful-pattern candidates. A candidate is a PROPOSAL drawn from real evidence: the
-- object and revision it was observed on, how many times it was observed, and the basis. It never
-- claims creator authority and it changes no behaviour until it is accepted.
create table tonde.memory_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  production_id uuid not null,
  scope tonde.memory_scope not null default 'production',
  kind tonde.memory_kind not null,
  subject_key text not null check (length(btrim(subject_key)) between 1 and 160),
  statement text not null check (length(btrim(statement)) between 1 and 600),
  proposed_source tonde.memory_source not null default 'historical_pattern',
  basis jsonb not null default '[]'::jsonb
    check (jsonb_typeof(basis) = 'array' and jsonb_array_length(basis) >= 1),
  observed_count integer not null default 1 check (observed_count >= 1),
  source_object_id uuid not null,
  source_revision integer not null check (source_revision > 0),
  state tonde.proposal_state not null default 'proposed',
  decided_by uuid, decided_at timestamptz,
  decision_note text not null default '' check (length(decision_note) <= 800),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  -- A candidate may never propose creator authority: only a creator writes an instruction.
  check (proposed_source <> 'creator_instruction'),
  check (state = 'proposed' or decided_at is not null),
  check (scope = 'production'),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create unique index memory_candidates_open on tonde.memory_candidates
  (workspace_id, production_id, subject_key, kind, source_object_id) where state = 'proposed';
create index memory_candidates_recent on tonde.memory_candidates(workspace_id, production_id, state, created_at desc);

-- 4. Memory items. The inspectable record itself.
create table tonde.memory_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  production_id uuid, series_id uuid,
  scope tonde.memory_scope not null,
  kind tonde.memory_kind not null,
  subject_key text not null check (length(btrim(subject_key)) between 1 and 160),
  statement text not null check (length(btrim(statement)) between 1 and 600),
  source tonde.memory_source not null,
  origin tonde.memory_origin not null,
  rationale text not null default '' check (length(rationale) <= 800),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  source_object_id uuid, source_revision integer,
  candidate_id uuid,
  confirmed_by uuid, confirmed_at timestamptz,
  state tonde.lifecycle not null default 'active',
  supersedes_id uuid,
  retired_at timestamptz, retired_by uuid,
  retire_reason text not null default '' check (length(retire_reason) <= 400),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  -- Scope is a real scope: a Production item names its Production, a Series item its Series, a
  -- workspace item neither.
  check ((scope = 'production' and production_id is not null and series_id is null)
      or (scope = 'series' and series_id is not null)
      or (scope = 'workspace' and production_id is null and series_id is null)),
  -- Only an inference may be unconfirmed; creator-confirmed knowledge names who confirmed it.
  check (origin = 'inferred' or (confirmed_by is not null and confirmed_at is not null)),
  -- An inference discloses its basis.
  check (origin <> 'inferred' or jsonb_array_length(evidence) > 0),
  -- Human authority cannot be claimed by an inference.
  check (origin <> 'inferred' or source in ('saved_preference','historical_pattern','inference')),
  -- A pinned version comes with the object that version belongs to.
  check (source_revision is null or source_object_id is not null),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, series_id) references tonde.series(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, candidate_id) references tonde.memory_candidates(workspace_id, id) on delete restrict,
  foreign key (workspace_id, supersedes_id) references tonde.memory_items(workspace_id, id) on delete restrict
);
-- One live item per subject, per scope key, per authority tier. Restating the same tier replaces
-- the older statement of that tier; a HIGHER tier does not delete the lower one, it outranks it.
create unique index memory_items_live_identity on tonde.memory_items
  (workspace_id, scope, coalesce(production_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(series_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_key, source)
  where retired_at is null and state = 'active';
create index memory_items_by_subject on tonde.memory_items(workspace_id, production_id, subject_key, kind)
  where retired_at is null;
create index memory_items_by_scope on tonde.memory_items(workspace_id, scope, kind, updated_at desc);
create index memory_items_history on tonde.memory_items(workspace_id, subject_key, created_at desc);
create index memory_items_by_source on tonde.memory_items(workspace_id, source_object_id)
  where source_object_id is not null;

-- 5. Private helpers (not user-facing; reachable only through the security-definer RPCs below).
create function tonde_private.mi_rank(target_source tonde.memory_source) returns integer
language sql immutable set search_path = '' as $$
  select case target_source::text
    when 'creator_instruction' then 1
    when 'production_decision' then 2
    when 'saved_preference' then 3
    when 'historical_pattern' then 4
    else 5 end;
$$;
revoke all on function tonde_private.mi_rank(tonde.memory_source) from public, anon, authenticated, service_role;

-- A caller-supplied uuid. A malformed id is a rejected request, not an unhandled cast error.
create function tonde_private.mi_uuid(source jsonb, key_name text, required boolean default false)
returns uuid language plpgsql immutable set search_path = '' as $$
declare value text; parsed uuid;
begin
  value := btrim(coalesce(source ->> key_name, ''));
  if value = '' then
    if required then raise exception 'The field % is required', key_name using errcode = '22023'; end if;
    return null;
  end if;
  if value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'The field % is not a valid identifier', key_name using errcode = '22023';
  end if;
  parsed := value::uuid;
  return parsed;
end $$;
revoke all on function tonde_private.mi_uuid(jsonb,text,boolean) from public, anon, authenticated, service_role;

-- Search patterns. Deterministic and disclosed: lower-cased, whitespace-split, at most six terms,
-- each at most 80 characters. There is no stemming, no fuzzy matching and no embedding.
create function tonde_private.mi_patterns(source text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(t.pattern order by t.ord), '{}'::text[])
  from (
    select '%' || left(lower(btrim(u.part)), 80) || '%' as pattern, u.ord
    from unnest(regexp_split_to_array(coalesce(source, ''), '\s+')) with ordinality as u(part, ord)
    where btrim(u.part) <> ''
    order by u.ord
    limit 6
  ) t;
$$;
revoke all on function tonde_private.mi_patterns(text) from public, anon, authenticated, service_role;

-- The Series a Production belongs to, if any. Series memory applies to that Series only.
create function tonde_private.mi_series_of(target_workspace uuid, target_production uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select e.series_id from tonde.series_episodes e
  where e.workspace_id = target_workspace and e.production_id = target_production limit 1;
$$;
revoke all on function tonde_private.mi_series_of(uuid,uuid) from public, anon, authenticated, service_role;

-- The effective memory policy for a scope. Resolution is most-specific-explicit-first and always
-- says which of the two it returned, so "capture is on" is never a guess.
create function tonde_private.mi_policy(target_workspace uuid, target_scope tonde.memory_scope,
  target_production uuid, target_series uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare found_policy tonde.memory_policies;
begin
  select * into found_policy from tonde.memory_policies p
    where p.workspace_id = target_workspace and p.scope = target_scope
      and p.production_id is not distinct from case when target_scope = 'production' then target_production else null end
      and p.series_id is not distinct from case when target_scope = 'series' then target_series else null end
    order by p.revision desc limit 1;
  if found_policy.id is not null then
    return jsonb_build_object('scope', found_policy.scope, 'explicit', true,
      'candidate_capture', found_policy.candidate_capture,
      'auto_accept_candidates', found_policy.auto_accept_candidates,
      'note', found_policy.note, 'updated_at', found_policy.updated_at);
  end if;
  return jsonb_build_object('scope', target_scope, 'explicit', false,
    'candidate_capture', true, 'auto_accept_candidates', false,
    'note', 'Default: candidates may be recorded for your review, and nothing becomes memory automatically.',
    'updated_at', null);
end $$;
revoke all on function tonde_private.mi_policy(uuid,tonde.memory_scope,uuid,uuid) from public, anon, authenticated, service_role;

-- One search lane. Each lane is a fixed template chosen by name inside this function, so no caller
-- text ever becomes SQL. Returned rows are real object references with the reason they matched.
create function tonde_private.mi_search_lane(target_workspace uuid, target_production uuid, lane text, q jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  patterns text[]; lim integer;
  f_asset uuid; f_asset_type text; f_env text; f_approval text; f_method text;
  f_provider text; f_model text; f_lens text; f_cstate text; f_severity text; f_domain text;
  f_rstate text; f_mkind text;
  items jsonb := '[]'::jsonb; total integer := 0;
begin
  lim := least(greatest(coalesce((q ->> 'limit')::integer, 50), 1), 100);
  patterns := tonde_private.mi_patterns(q ->> 'text');
  if cardinality(patterns) = 0 then patterns := null; end if;
  f_asset := nullif(q ->> '_resolved_asset_id','')::uuid;
  f_asset_type := nullif(q ->> 'asset_type','');
  f_env := nullif(btrim(coalesce(q ->> 'environment','')), '');
  f_approval := nullif(q ->> 'approval','');
  f_method := nullif(q ->> 'execution_method','');
  f_provider := nullif(q ->> 'provider','');
  f_model := nullif(q ->> 'model','');
  f_lens := nullif(q ->> 'lens','');
  f_cstate := nullif(q ->> 'continuity_state','');
  f_severity := nullif(q ->> 'severity','');
  f_domain := nullif(q ->> 'domain','');
  f_rstate := nullif(q ->> 'result_state','');
  f_mkind := nullif(q ->> 'memory_kind','');

  if lane = 'shot' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'entity_type','shot','entity_id', sh.id,'label', sh.title,
        'context', coalesce(sc.title, 'Standalone Shot'),
        'detail', left(coalesce(nullif(sh.action,''), sh.description), 200),
        'approval', sh.approval::text, 'execution_method', sh.execution_method::text,
        'revision', sh.revision, 'locked', sh.locked_at is not null,
        'matched_on', array_to_string(array_remove(array[
          case when patterns is not null then 'shot text' end,
          case when f_asset is not null then 'Character/Product binding or Scene participant' end,
          case when f_approval is not null then 'approval' end,
          case when f_method is not null then 'execution face' end,
          case when f_provider is not null or f_model is not null then 'AI Attempt provider/model' end,
          case when f_lens is not null then 'Real plan lens name' end,
          case when f_cstate is not null or f_severity is not null or f_domain is not null then 'continuity finding' end,
          case when f_rstate is not null then 'Result state' end], null), ', '))
      order by coalesce(so.scene_position, 2147483647), sh.sort_order, sh.created_at), '[]'::jsonb), count(*)
      into items, total
    from tonde.shots sh
    left join tonde.scenes sc on sc.id = sh.scene_id
    left join tonde_private.ci_scene_rank(target_workspace, target_production) so on so.scene_id = sh.scene_id
    where sh.workspace_id = target_workspace and sh.production_id = target_production and sh.lifecycle = 'active'
      and (patterns is null or (sh.title || ' ' || sh.description || ' ' || sh.action) ilike all (patterns))
      and (f_approval is null
           or (f_approval = 'not_approved' and sh.approval::text not in ('approved','changed_after_approval'))
           or (f_approval <> 'not_approved' and sh.approval::text = f_approval))
      and (f_method is null or sh.execution_method::text = f_method)
      and (f_asset is null
           or exists (select 1 from tonde.scene_participants p
                where p.workspace_id = target_workspace and p.scene_id = sh.scene_id and p.asset_id = f_asset)
           or exists (select 1 from tonde.scope_bindings b
                where b.workspace_id = target_workspace and b.asset_id = f_asset
                  and (b.scope_object_id = sh.id or b.scope_object_id = sh.scene_id)))
      and (f_provider is null or exists (select 1 from tonde.ai_generation_attempts a
            where a.workspace_id = target_workspace and a.shot_id = sh.id and a.provider_key = f_provider))
      and (f_model is null or exists (select 1 from tonde.ai_generation_attempts a
            where a.workspace_id = target_workspace and a.shot_id = sh.id
              and (a.model_key = f_model or a.model_version = f_model)))
      and (f_lens is null or exists (select 1 from tonde.execution_plans p
            join tonde.production_resources r on r.id = p.lens_resource_id
            where p.workspace_id = target_workspace and p.shot_id = sh.id
              and p.execution_method = 'real' and r.name ilike '%' || f_lens || '%'))
      and ((f_cstate is null and f_severity is null and f_domain is null)
           or exists (select 1 from tonde.continuity_findings f
                where f.workspace_id = target_workspace and f.production_id = target_production
                  and (f.at_shot_id = sh.id or (sh.scene_id is not null and f.at_scene_id = sh.scene_id))
                  and (f_cstate is null or f.state::text = f_cstate)
                  and (f_severity is null or f.severity = f_severity)
                  and (f_domain is null or f.domain::text = f_domain)))
      and (f_rstate is null or exists (select 1 from tonde.results rs
            where rs.workspace_id = target_workspace and rs.shot_id = sh.id and rs.state::text = f_rstate));

  elsif lane = 'scene' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'entity_type','scene','entity_id', sc.id,'label', sc.title,
        'context', coalesce(env.name, 'Production'),
        'detail', left(coalesce(nullif(sc.purpose,''), sc.description), 200),
        'approval', sc.approval::text, 'revision', sc.revision, 'locked', sc.locked_at is not null,
        'matched_on', array_to_string(array_remove(array[
          case when patterns is not null then 'scene text' end,
          case when f_asset is not null then 'Character/Product binding or Scene participant' end,
          case when f_env is not null then 'Environment name' end,
          case when f_approval is not null then 'approval' end,
          case when f_cstate is not null or f_severity is not null or f_domain is not null then 'continuity finding' end],
          null), ', '))
      order by coalesce(so.scene_position, 2147483647), sc.created_at), '[]'::jsonb), count(*)
      into items, total
    from tonde.scenes sc
    left join tonde.assets env on env.id = sc.environment_asset_id
    left join tonde_private.ci_scene_rank(target_workspace, target_production) so on so.scene_id = sc.id
    where sc.workspace_id = target_workspace and sc.production_id = target_production and sc.lifecycle = 'active'
      and (patterns is null or (sc.title || ' ' || sc.purpose || ' ' || sc.description) ilike all (patterns))
      and (f_approval is null
           or (f_approval = 'not_approved' and sc.approval::text not in ('approved','changed_after_approval'))
           or (f_approval <> 'not_approved' and sc.approval::text = f_approval))
      and (f_asset is null
           or exists (select 1 from tonde.scene_participants p
                where p.workspace_id = target_workspace and p.scene_id = sc.id and p.asset_id = f_asset)
           or exists (select 1 from tonde.scope_bindings b
                where b.workspace_id = target_workspace and b.asset_id = f_asset and b.scope_object_id = sc.id))
      and (f_env is null or env.name ilike '%' || f_env || '%')
      and ((f_cstate is null and f_severity is null and f_domain is null)
           or exists (select 1 from tonde.continuity_findings f
                where f.workspace_id = target_workspace and f.production_id = target_production
                  and f.at_scene_id = sc.id
                  and (f_cstate is null or f.state::text = f_cstate)
                  and (f_severity is null or f.severity = f_severity)
                  and (f_domain is null or f.domain::text = f_domain)));

  elsif lane = 'plan' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'entity_type','execution_plan','entity_id', pl.id,
        'label', (case when pl.execution_method = 'ai' then 'AI plan' else 'Real plan' end) || ' - ' || sh.title,
        'context', sh.title,
        'detail', left(concat_ws(' - ', nullif(pl.shot_size,''), nullif(pl.movement,''), nullif(lens.name,'')), 200),
        'approval', pl.approval::text, 'execution_method', pl.execution_method::text,
        'provider', pl.provider, 'model', pl.model, 'revision', pl.revision, 'locked', pl.locked_at is not null,
        'matched_on', array_to_string(array_remove(array[
          case when patterns is not null then 'plan text' end,
          case when f_method is not null then 'execution face' end,
          case when f_lens is not null then 'lens resource name' end,
          case when f_provider is not null then 'plan provider' end,
          case when f_model is not null then 'plan model' end,
          case when f_approval is not null then 'approval' end], null), ', '))
      order by coalesce(so.scene_position, 2147483647), sh.sort_order, pl.created_at), '[]'::jsonb), count(*)
      into items, total
    from tonde.execution_plans pl
    join tonde.shots sh on sh.id = pl.shot_id
    left join tonde.production_resources lens on lens.id = pl.lens_resource_id
    left join tonde_private.ci_scene_rank(target_workspace, target_production) so on so.scene_id = sh.scene_id
    where pl.workspace_id = target_workspace and pl.production_id = target_production and sh.lifecycle = 'active'
      and (patterns is null or (pl.shot_size || ' ' || pl.camera_position || ' ' || pl.camera_height || ' '
            || pl.camera_angle || ' ' || pl.framing || ' ' || pl.composition || ' ' || pl.perspective_note || ' '
            || pl.movement || ' ' || pl.movement_purpose || ' ' || pl.lighting_intent || ' ' || pl.lighting_plan || ' '
            || pl.blocking || ' ' || pl.performance || ' ' || pl.product_direction || ' ' || pl.depth_of_field
            || ' ' || pl.focus_strategy || ' ' || pl.sound_plan) ilike all (patterns))
      and (f_method is null or pl.execution_method::text = f_method)
      and (f_lens is null or lens.name ilike '%' || f_lens || '%')
      and (f_provider is null or pl.provider = f_provider)
      and (f_model is null or pl.model = f_model)
      and (f_approval is null
           or (f_approval = 'not_approved' and pl.approval::text not in ('approved','changed_after_approval'))
           or (f_approval <> 'not_approved' and pl.approval::text = f_approval));

  elsif lane = 'result' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'entity_type','result','entity_id', rs.id,
        'label', 'Result' || coalesce(' for ' || sh.title, ''),
        'context', coalesce(sh.title, 'Production'),
        'detail', rs.state::text || ' - ' || to_char(rs.created_at, 'YYYY-MM-DD')
          || case when rs.reference_id is not null then ' - compared against a Reference' else ' - no Reference' end,
        'state', rs.state::text, 'approval', rs.approval::text, 'revision', rs.revision,
        'has_plan', rs.execution_plan_id is not null, 'has_media', rs.media_id is not null,
        'matched_on', array_to_string(array_remove(array[
          case when patterns is not null then 'Shot text' end,
          case when f_rstate is not null then 'Result state' end,
          case when f_asset is not null then 'Shot Character/Product binding' end,
          case when f_approval is not null then 'approval' end], null), ', '))
      order by rs.created_at desc), '[]'::jsonb), count(*)
      into items, total
    from tonde.results rs
    left join tonde.shots sh on sh.id = rs.shot_id
    where rs.workspace_id = target_workspace and rs.production_id = target_production
      and (patterns is null or (coalesce(sh.title,'') || ' ' || coalesce(sh.action,'') || ' ' || coalesce(sh.description,'')) ilike all (patterns))
      and (f_rstate is null or rs.state::text = f_rstate)
      and (f_approval is null
           or (f_approval = 'not_approved' and rs.approval::text not in ('approved','changed_after_approval'))
           or (f_approval <> 'not_approved' and rs.approval::text = f_approval))
      and (f_asset is null or exists (select 1 from tonde.scene_participants p
            where p.workspace_id = target_workspace and p.scene_id = sh.scene_id and p.asset_id = f_asset));

  elsif lane = 'continuity_finding' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'entity_type','continuity_finding','entity_id', f.id,
        'label', left(f.explanation, 200),
        'context', coalesce('Scene ' || sc.title, 'Shot ' || sh.title, 'Production'),
        'detail', f.severity || ' - ' || f.state::text || ' - ' || f.kind::text,
        'state', f.state::text, 'severity', f.severity, 'domain', f.domain::text, 'finding_kind', f.kind::text,
        'matched_on', array_to_string(array_remove(array[
          case when patterns is not null then 'finding text' end,
          case when f_cstate is not null then 'finding state' end,
          case when f_severity is not null then 'severity' end,
          case when f_domain is not null then 'domain' end], null), ', '))
      order by case f.severity when 'critical' then 0 when 'warning' then 1 else 2 end, f.created_at desc), '[]'::jsonb), count(*)
      into items, total
    from tonde.continuity_findings f
    left join tonde.scenes sc on sc.id = f.at_scene_id
    left join tonde.shots sh on sh.id = f.at_shot_id
    where f.workspace_id = target_workspace and f.production_id = target_production
      and (patterns is null or (f.explanation || ' ' || f.trait || ' ' || f.suggested_resolution || ' ' || f.rationale) ilike all (patterns))
      and (f_cstate is null or f.state::text = f_cstate)
      and (f_severity is null or f.severity = f_severity)
      and (f_domain is null or f.domain::text = f_domain)
      and (f_asset is null or exists (select 1 from tonde.scene_participants p
            where p.workspace_id = target_workspace and p.asset_id = f_asset
              and p.scene_id = coalesce(f.at_scene_id, sh.scene_id)));

  elsif lane = 'continuity_state' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'entity_type','continuity_state','entity_id', s.id,
        'label', s.trait || ': ' || s.value,
        'context', coalesce('Scene ' || sc.title, 'Shot ' || sh.title, 'Production'),
        'detail', s.domain::text || ' - ' || s.transition::text || ' - ' || s.epistemic,
        'state', case when s.retired_at is null then 'live' else 'retired' end,
        'domain', s.domain::text, 'transition', s.transition::text,
        'matched_on', array_to_string(array_remove(array[
          case when patterns is not null then 'trait/value text' end,
          case when f_domain is not null then 'domain' end,
          case when f_asset is not null then 'subject' end], null), ', '))
      order by s.created_at desc), '[]'::jsonb), count(*)
      into items, total
    from tonde.continuity_states s
    left join tonde.scenes sc on sc.id = s.scene_id
    left join tonde.shots sh on sh.id = s.shot_id
    where s.workspace_id = target_workspace and s.production_id = target_production and s.retired_at is null
      and (patterns is null or (s.trait || ' ' || s.value || ' ' || s.reason) ilike all (patterns))
      and (f_domain is null or s.domain::text = f_domain)
      and (f_asset is null or s.subject_object_id = f_asset);

  elsif lane = 'memory' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'entity_type','memory_item','entity_id', m.id,
        'label', m.statement,
        'context', case m.scope when 'workspace' then 'Workspace' when 'series' then 'Series' else 'This Production' end,
        'detail', m.kind::text || ' - ' || m.source::text || ' - ' || m.origin::text,
        'scope', m.scope, 'memory_kind', m.kind, 'source', m.source, 'origin', m.origin,
        'authority_rank', tonde_private.mi_rank(m.source),
        'in_force', not exists (
          select 1 from tonde.memory_items better
          where better.workspace_id = m.workspace_id and better.retired_at is null and better.state = 'active'
            and better.subject_key = m.subject_key and better.id <> m.id
            and ((better.production_id = target_production)
                 or (better.production_id is null and better.series_id is null)
                 or (better.series_id is not null and better.series_id = tonde_private.mi_series_of(m.workspace_id, target_production)))
            and (tonde_private.mi_rank(better.source) < tonde_private.mi_rank(m.source)
                 or (tonde_private.mi_rank(better.source) = tonde_private.mi_rank(m.source)
                     and better.created_at > m.created_at))),
        'matched_on', array_to_string(array_remove(array[
          case when patterns is not null then 'memory text' end,
          case when f_mkind is not null then 'memory kind' end,
          case when f_asset is not null then 'source object' end], null), ', '))
      order by tonde_private.mi_rank(m.source), m.created_at desc), '[]'::jsonb), count(*)
      into items, total
    from tonde.memory_items m
    where m.workspace_id = target_workspace and m.retired_at is null and m.state = 'active'
      and ((m.production_id = target_production)
           or (m.production_id is null and m.series_id is null)
           or (m.series_id is not null and m.series_id = tonde_private.mi_series_of(target_workspace, target_production)))
      and (patterns is null or (m.statement || ' ' || m.subject_key || ' ' || m.rationale) ilike all (patterns))
      and (f_mkind is null or m.kind::text = f_mkind)
      and (f_asset is null or m.source_object_id = f_asset);

  elsif lane = 'asset' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'entity_type','asset','entity_id', a.id,'label', a.name,
        'context', a.asset_type::text,
        'detail', left(a.description, 200),
        'asset_type', a.asset_type::text, 'approval', a.approval::text, 'revision', a.revision,
        'locked', a.locked_at is not null,
        'matched_on', array_to_string(array_remove(array[
          case when patterns is not null then 'asset name or description' end,
          case when f_asset_type is not null then 'asset type' end,
          case when f_asset is not null then 'named asset' end], null), ', '))
      order by a.name), '[]'::jsonb), count(*)
      into items, total
    from tonde.assets a
    where a.workspace_id = target_workspace and a.lifecycle = 'active'
      and (patterns is null or (a.name || ' ' || a.description) ilike all (patterns))
      and (f_asset_type is null or a.asset_type::text = f_asset_type)
      and (f_asset is null or a.id = f_asset);
  end if;

  return jsonb_build_object('lane', lane, 'items', items, 'total', total, 'returned', jsonb_array_length(items));
end $$;
revoke all on function tonde_private.mi_search_lane(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;

-- 6. Policy surface. Only a workspace editor may change what TONDE is allowed to remember.
create function tonde.memory_policy_set(target_workspace uuid, target_production uuid, policy_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  desired_scope tonde.memory_scope; scope_ref uuid; series_ref uuid; saved tonde.memory_policies;
  capture_value boolean; auto_value boolean; note_value text; series_input uuid;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(policy_record) <> 'object' then
    raise exception 'A memory policy must be a JSON object' using errcode = '22023';
  end if;
  if coalesce(nullif(policy_record ->> 'scope',''), 'production') not in ('production','series','workspace') then
    raise exception 'Unsupported memory scope' using errcode = '22023';
  end if;
  desired_scope := coalesce(nullif(policy_record ->> 'scope',''), 'production')::tonde.memory_scope;
  if desired_scope = 'production' then
    scope_ref := target_production;
    series_ref := null;
  elsif desired_scope = 'series' then
    series_input := tonde_private.mi_uuid(policy_record, 'series_id', false);
    series_ref := series_input;
    if series_ref is null then
      select e.series_id into series_ref from tonde.series_episodes e
        where e.workspace_id = target_workspace and e.production_id = target_production;
    end if;
    if series_ref is null or not exists (select 1 from tonde.series s
        where s.workspace_id = target_workspace and s.id = series_ref) then
      raise exception 'This Production does not belong to a Series in this workspace' using errcode = '22023';
    end if;
    scope_ref := null;
  else
    scope_ref := null;
    series_ref := null;
  end if;
  capture_value := coalesce((policy_record ->> 'candidate_capture')::boolean, true);
  auto_value := coalesce((policy_record ->> 'auto_accept_candidates')::boolean, false);
  note_value := tonde_private.ci_text(policy_record, 'note', 600, false);
  insert into tonde.memory_policies(workspace_id, scope, production_id, series_id,
      candidate_capture, auto_accept_candidates, note)
    values (target_workspace, desired_scope, scope_ref, series_ref, capture_value, auto_value, note_value)
  on conflict (workspace_id, scope,
      coalesce(production_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(series_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set candidate_capture = excluded.candidate_capture,
      auto_accept_candidates = excluded.auto_accept_candidates, note = excluded.note
  returning * into saved;
  return jsonb_build_object('policy_id', saved.id, 'scope', saved.scope,
    'candidate_capture', saved.candidate_capture, 'auto_accept_candidates', saved.auto_accept_candidates,
    'note', saved.note, 'updated_at', saved.updated_at,
    'note_text', case when saved.candidate_capture then
        'TONDE may record pattern candidates for your review in this scope.'
      else 'TONDE will not record pattern candidates in this scope.' end
      || case when saved.auto_accept_candidates then ' Accepted candidates become memory automatically.' else ' Nothing becomes memory without your explicit decision.' end);
end $$;

create function tonde.memory_policy_get(target_workspace uuid, target_production uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare series_ref uuid; scopes jsonb := '[]'::jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  series_ref := tonde_private.mi_series_of(target_workspace, target_production);
  scopes := jsonb_build_array(
    tonde_private.mi_policy(target_workspace, 'production', target_production, null),
    tonde_private.mi_policy(target_workspace, 'workspace', null, null));
  if series_ref is not null then
    scopes := scopes || jsonb_build_array(tonde_private.mi_policy(target_workspace, 'series', null, series_ref));
  end if;
  return jsonb_build_object('production_id', target_production, 'series_id', series_ref, 'policies', scopes,
    'note', 'Memory policy decides whether TONDE may record pattern candidates and whether an accepted candidate becomes memory automatically. It never decides what you are allowed to instruct.');
end $$;

-- 7. Writing memory. An identical restatement refreshes the row; a different statement of the same
-- authority tier supersedes it and keeps the old one readable.
create function tonde.memory_item_set(target_workspace uuid, target_production uuid, item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  desired_scope tonde.memory_scope; desired_kind tonde.memory_kind; desired_source tonde.memory_source;
  desired_origin tonde.memory_origin;  subject_text text; statement_text text; rationale_text text;
  scope_production uuid; scope_series uuid; source_ref uuid; source_rev integer; evidence_value jsonb;
  series_input uuid;
  existing tonde.memory_items; saved tonde.memory_items; superseded_id uuid;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(item) <> 'object' then
    raise exception 'A memory item must be a JSON object' using errcode = '22023';
  end if;
  if coalesce(nullif(item ->> 'scope',''), 'production') not in ('production','series','workspace') then
    raise exception 'Unsupported memory scope' using errcode = '22023';
  end if;
  if coalesce(nullif(item ->> 'kind',''), 'other') not in
      ('preference','decision','pattern','technique','setup_fact','asset_usage','model_outcome','series_rule','correction','other') then
    raise exception 'Unsupported memory kind' using errcode = '22023';
  end if;
  if coalesce(nullif(item ->> 'source',''), 'saved_preference') not in
      ('creator_instruction','production_decision','saved_preference','historical_pattern','inference') then
    raise exception 'Unsupported memory source' using errcode = '22023';
  end if;
  if coalesce(nullif(item ->> 'origin',''), 'declared') not in ('declared','accepted','inferred') then
    raise exception 'Unsupported memory origin' using errcode = '22023';
  end if;
  desired_scope := coalesce(nullif(item ->> 'scope',''), 'production')::tonde.memory_scope;
  desired_kind := coalesce(nullif(item ->> 'kind',''), 'other')::tonde.memory_kind;
  desired_source := coalesce(nullif(item ->> 'source',''), 'saved_preference')::tonde.memory_source;
  desired_origin := coalesce(nullif(item ->> 'origin',''), 'declared')::tonde.memory_origin;
  if desired_origin = 'accepted' then
    raise exception 'An accepted memory item is created by accepting a candidate' using errcode = '22023';
  end if;
  -- Human authority cannot be claimed by an inference.
  if desired_origin = 'inferred' and desired_source in ('creator_instruction','production_decision') then
    raise exception 'An inference cannot claim creator authority' using errcode = '23514';
  end if;
  subject_text := tonde_private.ci_text(item, 'subject_key', 160, true);
  statement_text := tonde_private.ci_text(item, 'statement', 600, true);
  rationale_text := tonde_private.ci_text(item, 'rationale', 800, false);
  evidence_value := coalesce(item -> 'evidence', '[]'::jsonb);
  if jsonb_typeof(evidence_value) <> 'array' then
    raise exception 'The evidence of a memory item must be a list' using errcode = '22023';
  end if;
  if desired_origin = 'inferred' and jsonb_array_length(evidence_value) = 0 then
    raise exception 'An inferred memory item must disclose its basis' using errcode = '23514';
  end if;
  if desired_scope = 'production' then
    scope_production := target_production; scope_series := null;
  elsif desired_scope = 'series' then
    series_input := tonde_private.mi_uuid(item, 'series_id', false);
    scope_series := series_input;
    if scope_series is null then
      select e.series_id into scope_series from tonde.series_episodes e
        where e.workspace_id = target_workspace and e.production_id = target_production;
    end if;
    if scope_series is null or not exists (select 1 from tonde.series s
        where s.workspace_id = target_workspace and s.id = scope_series) then
      raise exception 'This Production does not belong to a Series in this workspace' using errcode = '22023';
    end if;
    scope_production := null;
  else
    scope_production := null; scope_series := null;
  end if;
  source_ref := tonde_private.mi_uuid(item, 'source_object_id', false);
  if source_ref is not null and not exists (select 1 from tonde.objects o
      where o.workspace_id = target_workspace and o.id = source_ref) then
    raise exception 'The source object of this memory is not in this workspace' using errcode = '22023';
  end if;
  source_rev := nullif(item ->> 'source_revision','')::integer;
  if source_rev is null and source_ref is not null then
    source_rev := tonde_private.pi_object_revision(target_workspace, source_ref);
  end if;

  select * into existing from tonde.memory_items m
    where m.workspace_id = target_workspace and m.retired_at is null and m.state = 'active'
      and m.scope = desired_scope and m.subject_key = subject_text and m.source = desired_source
      and m.production_id is not distinct from scope_production
      and m.series_id is not distinct from scope_series
    order by m.created_at desc limit 1;
  if existing.id is not null then
    if existing.statement = statement_text and existing.kind = desired_kind then
      -- Restating the same knowledge refreshes it; it does not create a second live item.
      update tonde.memory_items m set rationale = coalesce(nullif(rationale_text,''), m.rationale)
        where m.id = existing.id returning * into saved;
      return jsonb_build_object('item_id', saved.id, 'updated', true, 'superseded_id', null,
        'authority_rank', tonde_private.mi_rank(saved.source), 'scope', saved.scope, 'source', saved.source,
        'origin', saved.origin, 'in_force', true,
        'note_text', 'The same knowledge was already remembered; the record was refreshed instead of duplicated.');
    end if;
    -- Retire first: one live item per subject and tier is enforced by the database, not by hope.
    update tonde.memory_items m set state = 'archived', retired_at = now(), retired_by = auth.uid(),
      retire_reason = 'Superseded by a newer statement of the same authority on ' || to_char(now(), 'YYYY-MM-DD')
      where m.id = existing.id;
    superseded_id := existing.id;
  end if;

  insert into tonde.memory_items(workspace_id, production_id, series_id, scope, kind, subject_key, statement,
      source, origin, rationale, evidence, source_object_id, source_revision, confirmed_by, confirmed_at, supersedes_id)
    values (target_workspace, scope_production, scope_series, desired_scope, desired_kind, subject_text, statement_text,
      desired_source, desired_origin, rationale_text, evidence_value, source_ref, source_rev,
      case when desired_origin in ('declared','accepted') then auth.uid() else null end,
      case when desired_origin in ('declared','accepted') then now() else null end,
      superseded_id)
    returning * into saved;
  return jsonb_build_object('item_id', saved.id, 'updated', false, 'superseded_id', superseded_id,
    'authority_rank', tonde_private.mi_rank(saved.source), 'scope', saved.scope, 'source', saved.source,
    'origin', saved.origin, 'in_force', true,
    'note_text', case when saved.origin = 'inferred'
      then 'This is an inferred memory item. It is inspectable and it can be retired, and it does not outrank anything you said or decided.'
      else 'Remembered with your authority at tier ' || tonde_private.mi_rank(saved.source) || ' of 5.' end);
end $$;

create function tonde.memory_item_retire(target_workspace uuid, target_production uuid, target_item uuid,
  reason_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved tonde.memory_items;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into saved from tonde.memory_items m where m.workspace_id = target_workspace and m.id = target_item;
  if not found then raise exception 'That memory item is unavailable' using errcode = 'P0002'; end if;
  if saved.retired_at is null then
    update tonde.memory_items m set state = 'archived', retired_at = now(), retired_by = auth.uid(),
      retire_reason = coalesce(nullif(tonde_private.ci_text(jsonb_build_object('reason', reason_text), 'reason', 400, false), ''),
        'Retired by the creator without a stated reason')
      where m.id = saved.id returning * into saved;
  end if;
  return jsonb_build_object('item_id', saved.id, 'state', saved.state, 'retired_at', saved.retired_at,
    'retire_reason', saved.retire_reason,
    'note_text', 'The item stays readable as history. Nothing TONDE recorded was deleted.');
end $$;

-- 8. Reading memory. Every row carries its provenance, its authority tier and whether it is in
-- force, and whether the object it was drawn from has changed since.
create function tonde.memory_item_list(target_workspace uuid, target_production uuid,
  target_scope text default null, target_kind text default null, target_subject text default null,
  target_state text default null, target_limit integer default 100, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer; desired_state text;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  lim := least(greatest(coalesce(target_limit, 100), 1), 200);
  off := greatest(coalesce(target_offset, 0), 0);
  desired_state := coalesce(nullif(target_state,''), 'active');
  if desired_state not in ('active','archived','all') then
    raise exception 'Unsupported memory state filter' using errcode = '22023';
  end if;
  if target_scope is not null and target_scope not in ('production','series','workspace') then
    raise exception 'Unsupported memory scope filter' using errcode = '22023';
  end if;
  select count(*) into total from tonde.memory_items m
    where m.workspace_id = target_workspace
      and ((m.production_id = target_production)
           or (m.production_id is null and m.series_id is null)
           or (m.series_id is not null and m.series_id = tonde_private.mi_series_of(target_workspace, target_production)))
      and (target_scope is null or m.scope::text = target_scope)
      and (target_kind is null or m.kind::text = target_kind)
      and (target_subject is null or m.subject_key = target_subject)
      and (desired_state = 'all'
           or (desired_state = 'active' and m.retired_at is null and m.state = 'active')
           or (desired_state = 'archived' and (m.retired_at is not null or m.state <> 'active')));
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', r.id, 'scope', r.scope, 'kind', r.kind, 'subject_key', r.subject_key, 'statement', r.statement,
      'source', r.source, 'origin', r.origin, 'authority_rank', tonde_private.mi_rank(r.source),
      'rationale', r.rationale, 'evidence', r.evidence,
      'source_object_id', r.source_object_id, 'source_object_label', tonde_private.pi_label(target_workspace, r.source_object_id),
      'source_revision', r.source_revision, 'source_object_revision',
        case when r.source_object_id is null then null else tonde_private.pi_object_revision(target_workspace, r.source_object_id) end,
      'source_changed', case when r.source_object_id is null or r.source_revision is null then null
        else tonde_private.pi_object_revision(target_workspace, r.source_object_id) is distinct from r.source_revision end,
      'candidate_id', r.candidate_id, 'confirmed_by', r.confirmed_by, 'confirmed_at', r.confirmed_at,
      'state', r.state, 'retired_at', r.retired_at, 'retire_reason', r.retire_reason,
      'supersedes_id', r.supersedes_id,
      'superseded_by', (select s.id from tonde.memory_items s where s.supersedes_id = r.id order by s.created_at desc limit 1),
      'in_force', not exists (
        select 1 from tonde.memory_items better
        where better.workspace_id = r.workspace_id and better.retired_at is null and better.state = 'active'
          and better.subject_key = r.subject_key and better.id <> r.id
          and ((better.production_id = target_production)
               or (better.production_id is null and better.series_id is null)
               or (better.series_id is not null and better.series_id = tonde_private.mi_series_of(r.workspace_id, target_production)))
          and (tonde_private.mi_rank(better.source) < tonde_private.mi_rank(r.source)
               or (tonde_private.mi_rank(better.source) = tonde_private.mi_rank(r.source)
                   and better.created_at > r.created_at))),
      'production_id', r.production_id, 'series_id', r.series_id,
      'created_at', r.created_at, 'updated_at', r.updated_at, 'created_by', r.created_by) order by
        case when r.retired_at is null and r.state = 'active' then 0 else 1 end,
        tonde_private.mi_rank(r.source), r.created_at desc), '[]'::jsonb)
    into items
  from (select m.* from tonde.memory_items m
    where m.workspace_id = target_workspace
      and ((m.production_id = target_production)
           or (m.production_id is null and m.series_id is null)
           or (m.series_id is not null and m.series_id = tonde_private.mi_series_of(target_workspace, target_production)))
      and (target_scope is null or m.scope::text = target_scope)
      and (target_kind is null or m.kind::text = target_kind)
      and (target_subject is null or m.subject_key = target_subject)
      and (desired_state = 'all'
           or (desired_state = 'active' and m.retired_at is null and m.state = 'active')
           or (desired_state = 'archived' and (m.retired_at is not null or m.state <> 'active')))
    order by case when m.retired_at is null and m.state = 'active' then 0 else 1 end,
      tonde_private.mi_rank(m.source), m.created_at desc
    limit lim offset off) r;
  return jsonb_build_object('items', items, 'total', total, 'limit', lim, 'offset', off, 'truncated', total > off + lim,
    'note', 'Memory shows what TONDE remembers, where it came from, and whether it is currently in force. It is not a behavioural profile.');
end $$;

-- The authority question: "why is TONDE using this, and what did it outrank?"
create function tonde.memory_resolve(target_workspace uuid, target_production uuid,
  target_subject text, target_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare subject_text text; considered jsonb := '[]'::jsonb; winner jsonb := 'null'::jsonb; explanation text;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  subject_text := tonde_private.ci_text(jsonb_build_object('subject', target_subject), 'subject', 160, true);
  if target_kind is not null and target_kind not in
      ('preference','decision','pattern','technique','setup_fact','asset_usage','model_outcome','series_rule','correction','other') then
    raise exception 'Unsupported memory kind filter' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', r.id, 'statement', r.statement, 'kind', r.kind, 'scope', r.scope, 'source', r.source,
      'origin', r.origin, 'authority_rank', tonde_private.mi_rank(r.source),
      'confirmed', r.origin <> 'inferred', 'created_at', r.created_at, 'retired_at', r.retired_at,
      'in_force', r.position = 1) order by r.position), '[]'::jsonb)
    into considered
  from (
    select m.*, rank() over (order by tonde_private.mi_rank(m.source), m.created_at desc) as position
    from tonde.memory_items m
    where m.workspace_id = target_workspace and m.subject_key = subject_text
      and m.retired_at is null and m.state = 'active'
      and ((m.production_id = target_production)
           or (m.production_id is null and m.series_id is null)
           or (m.series_id is not null and m.series_id = tonde_private.mi_series_of(target_workspace, target_production)))
      and (target_kind is null or m.kind::text = target_kind)
  ) r;
  if jsonb_array_length(considered) = 0 then
    return jsonb_build_object('subject_key', subject_text, 'resolved', 'null'::jsonb, 'considered', considered,
      'explanation', 'TONDE remembers nothing about this subject. Nothing is being reused.');
  end if;
  select value into winner from jsonb_array_elements(considered) value where (value ->> 'in_force')::boolean limit 1;
  explanation := 'Using the ' || replace(winner ->> 'source', '_', ' ') || ' recorded on '
    || to_char((winner ->> 'created_at')::timestamptz, 'YYYY-MM-DD')
    || ' (' || case when (winner ->> 'confirmed')::boolean then 'creator-confirmed' else 'inferred and unconfirmed' end || ').';
  if jsonb_array_length(considered) > 1 then
    explanation := explanation || ' It outranks: ' || (
      select string_agg(x.v ->> 'source', ', ' order by (x.v ->> 'authority_rank')::integer)
      from jsonb_array_elements(considered) x(v) where not (x.v ->> 'in_force')::boolean) || '.';
  end if;
  return jsonb_build_object('subject_key', subject_text, 'resolved', winner, 'considered', considered,
    'explanation', explanation,
    'note_text', 'A current creator instruction outranks a Production decision, which outranks an explicit saved preference, which outranks a historical pattern, which outranks an inference.');
end $$;

-- 9. Pattern candidates. Real evidence, a policy decision, and a creator decision. Nothing becomes
-- reusable memory from one Shot without that decision.
create function tonde.memory_candidate_record(target_workspace uuid, target_production uuid, candidate jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  desired_kind tonde.memory_kind; subject_text text; statement_text text; proposed text;
  basis_value jsonb; observed integer; source_ref uuid; source_rev integer; current_rev integer;
  policy jsonb; saved tonde.memory_candidates; existing tonde.memory_candidates; created_item tonde.memory_items;
  auto_origin tonde.memory_origin;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(candidate) <> 'object' then
    raise exception 'A memory candidate must be a JSON object' using errcode = '22023';
  end if;
  if coalesce(nullif(candidate ->> 'kind',''), 'other') not in
      ('preference','decision','pattern','technique','setup_fact','asset_usage','model_outcome','series_rule','correction','other') then
    raise exception 'Unsupported memory kind' using errcode = '22023';
  end if;
  desired_kind := coalesce(nullif(candidate ->> 'kind',''), 'other')::tonde.memory_kind;
  proposed := coalesce(nullif(candidate ->> 'proposed_source',''), 'historical_pattern');
  if proposed not in ('saved_preference','historical_pattern','inference') then
    raise exception 'A candidate may only propose saved preference, historical pattern or inference' using errcode = '22023';
  end if;
  subject_text := tonde_private.ci_text(candidate, 'subject_key', 160, true);
  statement_text := tonde_private.ci_text(candidate, 'statement', 600, true);
  basis_value := coalesce(candidate -> 'basis', '[]'::jsonb);
  if jsonb_typeof(basis_value) <> 'array' or jsonb_array_length(basis_value) = 0 then
    raise exception 'A candidate must cite the evidence it was observed on' using errcode = '23514';
  end if;
  observed := greatest(coalesce((candidate ->> 'observed_count')::integer, 1), 1);
  source_ref := tonde_private.mi_uuid(candidate, 'source_object_id', false);
  if source_ref is null or not exists (select 1 from tonde.objects o
      where o.workspace_id = target_workspace and o.id = source_ref) then
    raise exception 'A candidate must name the object it was observed on' using errcode = '22023';
  end if;
  source_rev := nullif(candidate ->> 'source_revision','')::integer;
  current_rev := tonde_private.pi_object_revision(target_workspace, source_ref);
  if source_rev is null then source_rev := current_rev; end if;
  -- Section 163: a proposal pins the revision it was drawn from.
  if source_rev is null or current_rev is null or source_rev <> current_rev then
    raise exception 'The evidence changed before this candidate was recorded; record it from the current revision' using errcode = '40001';
  end if;
  policy := tonde_private.mi_policy(target_workspace, 'production', target_production, null);
  if not (policy ->> 'candidate_capture')::boolean then
    raise exception 'The memory policy for this scope does not allow recording candidates' using errcode = '23514';
  end if;
  auto_origin := case when (policy ->> 'auto_accept_candidates')::boolean then 'inferred'::tonde.memory_origin else null end;
  -- Retrying the same observation must not duplicate it, and a candidate whose evidence has moved on
  -- must not silently block the current revision from being proposed. The old candidate is retired
  -- as superseded - kept as history - and a new one is recorded against the revision that is real now.
  select * into existing from tonde.memory_candidates c
    where c.workspace_id = target_workspace and c.production_id = target_production and c.state = 'proposed'
      and c.subject_key = subject_text and c.kind = desired_kind and c.source_object_id = source_ref;
  if existing.id is not null then
    if existing.source_revision = source_rev then
      return jsonb_build_object('candidate_id', existing.id, 'state', existing.state, 'duplicate', true,
        'observed_count', existing.observed_count, 'policy', policy,
        'note_text', 'This candidate was already recorded from the same evidence. Nothing new was created.');
    end if;
    update tonde.memory_candidates c set state = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = 'Superseded: the object it was observed on moved from revision ' || existing.source_revision
        || ' to revision ' || source_rev || '.'
      where c.id = existing.id;
  end if;
  insert into tonde.memory_candidates(workspace_id, production_id, scope, kind, subject_key, statement,
      proposed_source, basis, observed_count, source_object_id, source_revision)
    values (target_workspace, target_production, 'production', desired_kind, subject_text, statement_text,
      proposed::tonde.memory_source, basis_value, observed, source_ref, source_rev)
    returning * into saved;
  if auto_origin is not null then
    insert into tonde.memory_items(workspace_id, production_id, scope, kind, subject_key, statement,
        source, origin, rationale, evidence, source_object_id, source_revision, candidate_id)
      values (target_workspace, target_production, 'production', desired_kind, subject_text, statement_text,
        proposed::tonde.memory_source, auto_origin,
        'Recorded automatically under the memory policy for this Production scope.',
        basis_value, source_ref, source_rev, saved.id)
      returning * into created_item;
    update tonde.memory_candidates c set state = 'applied', decided_by = auth.uid(), decided_at = now(),
      decision_note = 'Accepted automatically by the memory policy for this Production scope.'
      where c.id = saved.id returning * into saved;
    return jsonb_build_object('candidate_id', saved.id, 'state', saved.state, 'duplicate', false,
      'memory_item_id', created_item.id, 'policy', policy,
      'note_text', 'The memory policy for this scope accepts candidates automatically, so this one is remembered as an inference until you confirm or retire it.');
  end if;
  return jsonb_build_object('candidate_id', saved.id, 'state', saved.state, 'duplicate', false,
    'memory_item_id', null, 'policy', policy,
    'note_text', 'Recorded for review. Nothing becomes memory until you accept it.');
end $$;

create function tonde.memory_candidate_list(target_workspace uuid, target_production uuid,
  target_state text default null, target_limit integer default 50, target_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer; off integer; items jsonb; total integer; desired_state text; policy jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  lim := least(greatest(coalesce(target_limit, 50), 1), 200);
  off := greatest(coalesce(target_offset, 0), 0);
  desired_state := coalesce(nullif(target_state,''), 'proposed');
  if desired_state not in ('proposed','applied','rejected','all') then
    raise exception 'Unsupported candidate state filter' using errcode = '22023';
  end if;
  policy := tonde_private.mi_policy(target_workspace, 'production', target_production, null);
  select count(*) into total from tonde.memory_candidates c
    where c.workspace_id = target_workspace and c.production_id = target_production
      and (desired_state = 'all' or c.state::text = desired_state);
  select coalesce(jsonb_agg(jsonb_build_object(
      'candidate_id', c.id, 'kind', c.kind, 'subject_key', c.subject_key, 'statement', c.statement,
      'proposed_source', c.proposed_source, 'basis', c.basis, 'observed_count', c.observed_count,
      'source_object_id', c.source_object_id, 'source_object_label', tonde_private.pi_label(target_workspace, c.source_object_id),
      'source_revision', c.source_revision,
      'source_changed', tonde_private.pi_object_revision(target_workspace, c.source_object_id) is distinct from c.source_revision,
      'state', c.state, 'decided_by', c.decided_by, 'decided_at', c.decided_at, 'decision_note', c.decision_note,
      'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
    into items
  from (select c.* from tonde.memory_candidates c
    where c.workspace_id = target_workspace and c.production_id = target_production
      and (desired_state = 'all' or c.state::text = desired_state)
    order by c.created_at desc limit lim offset off) c;
  return jsonb_build_object('items', items, 'total', total, 'limit', lim, 'offset', off, 'truncated', total > off + lim,
    'policy', policy,
    'note', 'A candidate is a proposal drawn from real evidence. It is never a creator preference until you accept it.');
end $$;

create function tonde.memory_candidate_decide(target_workspace uuid, target_production uuid, target_candidate uuid,
  decision text, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare candidate tonde.memory_candidates; created_item tonde.memory_items; saved tonde.memory_candidates;
  current_rev integer; decision_note_value text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if decision not in ('accept','dismiss') then
    raise exception 'Unsupported candidate decision' using errcode = '22023';
  end if;
  select * into candidate from tonde.memory_candidates c
    where c.workspace_id = target_workspace and c.production_id = target_production and c.id = target_candidate;
  if not found then raise exception 'That memory candidate is unavailable' using errcode = 'P0002'; end if;
  if candidate.state <> 'proposed' then
    return jsonb_build_object('candidate_id', candidate.id, 'state', candidate.state, 'memory_item_id', null,
      'note_text', 'This candidate was already decided.');
  end if;
  decision_note_value := tonde_private.ci_text(jsonb_build_object('note', note_text), 'note', 800, false);
  if decision = 'dismiss' then
    update tonde.memory_candidates c set state = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = coalesce(nullif(decision_note_value,''), 'Dismissed by the creator')
      where c.id = candidate.id returning * into saved;
    return jsonb_build_object('candidate_id', saved.id, 'state', saved.state, 'memory_item_id', null,
      'note_text', 'Dismissed. Nothing was remembered and the candidate stays readable as history.');
  end if;
  -- Section 163: accepting pins the revision the candidate was drawn from. A changed source rejects.
  current_rev := tonde_private.pi_object_revision(target_workspace, candidate.source_object_id);
  if current_rev is distinct from candidate.source_revision then
    raise exception 'The evidence this candidate was drawn from changed; record a new candidate from the current revision' using errcode = '40001';
  end if;
  insert into tonde.memory_items(workspace_id, production_id, scope, kind, subject_key, statement,
      source, origin, rationale, evidence, source_object_id, source_revision, candidate_id,
      confirmed_by, confirmed_at)
    values (target_workspace, target_production, candidate.scope, candidate.kind, candidate.subject_key,
      candidate.statement, candidate.proposed_source, 'accepted',
      'Accepted from a pattern candidate observed on ' || to_char(candidate.created_at, 'YYYY-MM-DD') || '.',
      candidate.basis, candidate.source_object_id, candidate.source_revision, candidate.id, auth.uid(), now())
    returning * into created_item;
  update tonde.memory_candidates c set state = 'applied', decided_by = auth.uid(), decided_at = now(),
    decision_note = coalesce(nullif(decision_note_value,''), 'Accepted by the creator')
    where c.id = candidate.id returning * into saved;
  return jsonb_build_object('candidate_id', saved.id, 'state', saved.state, 'memory_item_id', created_item.id,
    'authority_rank', tonde_private.mi_rank(created_item.source),
    'note_text', 'Remembered with your authority. It outranks an inference and any unconfirmed pattern, and a later instruction of yours outranks it.');
end $$;

-- 10. Summary: what TONDE remembers, and what it is waiting for a decision on.
create function tonde.memory_summary(target_workspace uuid, target_production uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  active_items integer; archived_items integer; subjects integer; confirmed integer; inferred integer;
  changed_sources integer; proposed integer; applied integer; rejected integer; policy jsonb; series_ref uuid;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  select count(*) filter (where m.retired_at is null and m.state = 'active'),
    count(*) filter (where m.retired_at is not null or m.state <> 'active'),
    count(distinct m.subject_key) filter (where m.retired_at is null and m.state = 'active'),
    count(*) filter (where m.retired_at is null and m.state = 'active' and m.origin <> 'inferred'),
    count(*) filter (where m.retired_at is null and m.state = 'active' and m.origin = 'inferred'),
    count(*) filter (where m.retired_at is null and m.state = 'active' and m.source_object_id is not null
      and m.source_revision is not null
      and tonde_private.pi_object_revision(target_workspace, m.source_object_id) is distinct from m.source_revision)
    into active_items, archived_items, subjects, confirmed, inferred, changed_sources
  from tonde.memory_items m
  where m.workspace_id = target_workspace
    and ((m.production_id = target_production)
         or (m.production_id is null and m.series_id is null)
         or (m.series_id is not null and m.series_id = tonde_private.mi_series_of(target_workspace, target_production)));
  select count(*) filter (where c.state = 'proposed'), count(*) filter (where c.state = 'applied'),
    count(*) filter (where c.state = 'rejected')
    into proposed, applied, rejected
  from tonde.memory_candidates c
  where c.workspace_id = target_workspace and c.production_id = target_production;
  series_ref := tonde_private.mi_series_of(target_workspace, target_production);
  policy := tonde_private.mi_policy(target_workspace, 'production', target_production, null);
  return jsonb_build_object(
    'items', jsonb_build_object('active', coalesce(active_items,0), 'archived', coalesce(archived_items,0),
      'subjects', coalesce(subjects,0), 'creator_confirmed', coalesce(confirmed,0), 'inferred', coalesce(inferred,0),
      'sources_changed', coalesce(changed_sources,0)),
    'by_scope', (select coalesce(jsonb_object_agg(x.scope, x.count), '{}'::jsonb) from (
      select m.scope::text as scope, count(*) as count from tonde.memory_items m
      where m.workspace_id = target_workspace and m.retired_at is null and m.state = 'active'
        and ((m.production_id = target_production)
             or (m.production_id is null and m.series_id is null)
             or (m.series_id is not null and m.series_id = tonde_private.mi_series_of(target_workspace, target_production)))
      group by m.scope) x),
    'by_source', (select coalesce(jsonb_object_agg(x.source, x.count), '{}'::jsonb) from (
      select m.source::text as source, count(*) as count from tonde.memory_items m
      where m.workspace_id = target_workspace and m.retired_at is null and m.state = 'active'
        and ((m.production_id = target_production)
             or (m.production_id is null and m.series_id is null)
             or (m.series_id is not null and m.series_id = tonde_private.mi_series_of(target_workspace, target_production)))
      group by m.source) x),
    'candidates', jsonb_build_object('proposed', coalesce(proposed,0), 'applied', coalesce(applied,0),
      'rejected', coalesce(rejected,0)),
    'policy', policy, 'series_id', series_ref,
    'limitations', 'Memory is what the Production recorded and what you confirmed. An unconfirmed inference is labelled as an inference, and nothing here is a hidden behavioural profile.');
end $$;

-- 11. Structured production search. Relational and indexed data first; there is no embedding path.
create function tonde.production_search(target_workspace uuid, target_production uuid, query jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  lim integer; lane text; lane_json jsonb; all_items jsonb := '[]'::jsonb; lane_counts jsonb := '[]'::jsonb;
  total integer := 0; returned integer := 0; requested text[]; known text[] :=
    array['shot','scene','plan','result','continuity_finding','continuity_state','memory','asset'];
  patterns text[]; tokens jsonb; facet_list jsonb := '[]'::jsonb;
  asset_ref uuid; asset_name text; asset_type_value text; unresolved text;
  effective jsonb; series_ref uuid;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  if jsonb_typeof(query) is distinct from 'object' then
    raise exception 'A search request must be a JSON object' using errcode = '22023';
  end if;
  if not exists (select 1 from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production) then
    raise exception 'Production unavailable' using errcode = 'P0002';
  end if;
  lim := least(greatest(coalesce((query ->> 'limit')::integer, 50), 1), 100);
  -- Validate every controlled facet before any lane runs: an unknown code is a rejected request.
  if nullif(query ->> 'approval','') is not null and (query ->> 'approval') not in
      ('draft','needs_review','approved','changed_after_approval','not_approved') then
    raise exception 'Unsupported approval filter' using errcode = '22023';
  end if;
  if nullif(query ->> 'execution_method','') is not null and (query ->> 'execution_method') not in ('real','ai','hybrid') then
    raise exception 'Unsupported execution filter' using errcode = '22023';
  end if;
  if nullif(query ->> 'continuity_state','') is not null and (query ->> 'continuity_state') not in
      ('open','acknowledged','resolved','waived') then
    raise exception 'Unsupported continuity state filter' using errcode = '22023';
  end if;
  if nullif(query ->> 'severity','') is not null and (query ->> 'severity') not in ('info','warning','critical') then
    raise exception 'Unsupported severity filter' using errcode = '22023';
  end if;
  if nullif(query ->> 'result_state','') is not null and (query ->> 'result_state') not in
      ('raw','needs_review','approved','rejected','final') then
    raise exception 'Unsupported Result state filter' using errcode = '22023';
  end if;
  if nullif(query ->> 'domain','') is not null and (query ->> 'domain') not in
      ('character','wardrobe','prop','product','vehicle','injury','hair_makeup','weather','time_of_day',
       'environment','lighting','story_knowledge','dialogue_fact','screen_direction','eyeline',
       'camera_geography','position','product_condition','other') then
    raise exception 'Unsupported continuity domain filter' using errcode = '22023';
  end if;
  if nullif(query ->> 'memory_kind','') is not null and (query ->> 'memory_kind') not in
      ('preference','decision','pattern','technique','setup_fact','asset_usage','model_outcome','series_rule','correction','other') then
    raise exception 'Unsupported memory kind filter' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(query -> 'kinds', '[]'::jsonb)) <> 'array' then
    raise exception 'Search kinds must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(query -> 'kinds', '[]'::jsonb)) = 0 then
    requested := known;
  else
    select array_agg(value) into requested from jsonb_array_elements_text(query -> 'kinds') value;
    if exists (select 1 from unnest(requested) r where r <> all (known)) then
      raise exception 'Unsupported search kind' using errcode = '22023';
    end if;
    -- Keep a stable lane order regardless of what the caller listed.
    select array_agg(k order by array_position(known, k)) into requested from unnest(requested) k;
  end if;

  patterns := tonde_private.mi_patterns(query ->> 'text');
  tokens := to_jsonb(array(select btrim(p, '%') from unnest(patterns) p));

  -- An identity facet that names nothing is answered honestly instead of being ignored.
  asset_name := nullif(btrim(coalesce(query ->> 'asset_name','')), '');
  asset_ref := tonde_private.mi_uuid(query, 'asset_id', false);
  asset_type_value := nullif(query ->> 'asset_type','');
  if asset_type_value is not null and asset_type_value not in
      ('character','voice','product','environment','wardrobe','prop','vehicle','style_bible','brand') then
    raise exception 'Unsupported Asset type filter' using errcode = '22023';
  end if;
  if asset_ref is null and asset_name is not null then
    select a.id into asset_ref from tonde.assets a
      where a.workspace_id = target_workspace and a.lifecycle = 'active' and a.name ilike '%' || asset_name || '%'
      order by (a.name ilike asset_name || '%') desc, a.name limit 1;
    if asset_ref is null then unresolved := asset_name; end if;
  end if;
  if asset_ref is not null and asset_type_value is not null
    and not exists (select 1 from tonde.assets a where a.workspace_id = target_workspace
      and a.id = asset_ref and a.asset_type::text = asset_type_value) then
    unresolved := coalesce(asset_name, asset_ref::text);
  end if;

  effective := query || jsonb_build_object('limit', lim);
  if asset_ref is not null then effective := effective || jsonb_build_object('_resolved_asset_id', asset_ref::text); end if;

  facet_list := '[]'::jsonb;
  if patterns is not null and array_length(patterns, 1) > 0 then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','text',
      'value', array_to_string(array(select btrim(p,'%') from unnest(patterns) p), ' '),
      'meaning','Words matched against the visible production text of the searched kinds. No stemming and no embeddings.'));
  end if;
  if asset_ref is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','asset','value',
      coalesce((select a.name from tonde.assets a where a.id = asset_ref), asset_ref::text),
      'meaning','Objects whose Scene includes this Asset, or that bind this Asset directly.'));
  end if;
  if asset_type_value is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','asset_type','value', asset_type_value,
      'meaning','Assets of this type in the workspace.'));
  end if;
  if nullif(query ->> 'environment','') is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','environment','value', query ->> 'environment',
      'meaning','Scenes whose Environment Asset name contains this text.'));
  end if;
  if nullif(query ->> 'approval','') is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','approval','value', query ->> 'approval',
      'meaning', case when query ->> 'approval' = 'not_approved'
        then 'Objects whose approval is neither Approved nor Changed After Approval.' else 'Objects at this approval state.' end));
  end if;
  if nullif(query ->> 'execution_method','') is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','execution_method','value', query ->> 'execution_method',
      'meaning','Shots and plans on this execution face.'));
  end if;
  if coalesce(nullif(query ->> 'provider',''), nullif(query ->> 'model','')) is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','provider_model','value',
      coalesce(nullif(query ->> 'provider',''), query ->> 'model'),
      'meaning','Shots with a recorded AI Attempt, or plans naming this provider or model.'));
  end if;
  if nullif(query ->> 'lens','') is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','lens','value', query ->> 'lens',
      'meaning','Lens resource names containing this text, on Real plans. A lens name is what your Setup records; TONDE does not claim a measured focal length.'));
  end if;
  if coalesce(nullif(query ->> 'continuity_state',''), nullif(query ->> 'severity',''), nullif(query ->> 'domain','')) is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','continuity','value',
      concat_ws(' - ', nullif(query ->> 'continuity_state',''), nullif(query ->> 'severity',''), nullif(query ->> 'domain','')),
      'meaning','Continuity findings and declared states matching these filters.'));
  end if;
  if nullif(query ->> 'result_state','') is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','result_state','value', query ->> 'result_state',
      'meaning','Results at this state.'));
  end if;
  if nullif(query ->> 'memory_kind','') is not null then
    facet_list := facet_list || jsonb_build_array(jsonb_build_object('facet','memory_kind','value', query ->> 'memory_kind',
      'meaning','Remembered items of this kind that apply to this Production.'));
  end if;

  if unresolved is not null then
    return jsonb_build_object('interpretation', jsonb_build_object('text', nullif(query ->> 'text',''),
        'tokens', tokens, 'kinds', to_jsonb(requested), 'facets', facet_list, 'limit', lim,
        'limit_note', 'Empty: the named Asset was not found, so no lane ran.'),
      'lanes', '[]'::jsonb, 'results', '[]'::jsonb, 'total', 0, 'returned', 0, 'truncated', false,
      'notes', jsonb_build_array('No Asset in this workspace matches "' || unresolved || '". Nothing was searched, because ignoring the filter would return unrelated objects.'));
  end if;

  series_ref := tonde_private.mi_series_of(target_workspace, target_production);

  foreach lane in array requested loop
    lane_json := tonde_private.mi_search_lane(target_workspace, target_production, lane, effective);
    all_items := all_items || (lane_json -> 'items');
    total := total + (lane_json ->> 'total')::integer;
    lane_counts := lane_counts || jsonb_build_array(jsonb_build_object('lane', lane,
      'total', (lane_json ->> 'total')::integer, 'returned', (lane_json ->> 'returned')::integer));
  end loop;
  returned := jsonb_array_length(all_items);

  return jsonb_build_object(
    'interpretation', jsonb_build_object('text', nullif(query ->> 'text',''), 'tokens', tokens,
      'kinds', to_jsonb(requested), 'facets', facet_list, 'limit', lim, 'series_id', series_ref),
    'lanes', lane_counts, 'results', all_items, 'total', total, 'returned', returned,
    'truncated', total > returned,
    'notes', jsonb_build_array(
      'Search reads structured production state and returns real object references. It does not use embeddings and it does not read media.',
      'Memory results say whether the remembered item is currently in force, so what TONDE is reusing is visible rather than implied.',
      'Assets are workspace-wide reusable entities; they are returned for the whole workspace rather than only this Production.'));
end $$;

-- 12. RLS. Every new table is workspace-isolated; enabling RLS is not optional.
do $$ declare item text; begin
  foreach item in array array['memory_items','memory_candidates','memory_policies'] loop
    execute format('alter table tonde.%I enable row level security', item);
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', item);
    execute format('create policy tenant_insert on tonde.%I for insert to authenticated with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('create policy tenant_update on tonde.%I for update to authenticated using (tonde_private.can_edit_workspace(workspace_id)) with check (tonde_private.can_edit_workspace(workspace_id))', item);
    execute format('grant select on tonde.%I to authenticated', item);
  end loop;
end $$;

-- 13. Mutation guards: identity stays immutable, revisions auto-bump, no row is rewritten.
do $$ declare item text; begin
  foreach item in array array['memory_items','memory_candidates','memory_policies'] loop
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', item);
  end loop;
end $$;

-- 14. Privileges: authenticated only, and the private helpers stay unreachable.
revoke all on function
  tonde.memory_policy_set(uuid,uuid,jsonb),
  tonde.memory_policy_get(uuid,uuid),
  tonde.memory_item_set(uuid,uuid,jsonb),
  tonde.memory_item_retire(uuid,uuid,uuid,text),
  tonde.memory_item_list(uuid,uuid,text,text,text,text,integer,integer),
  tonde.memory_resolve(uuid,uuid,text,text),
  tonde.memory_candidate_record(uuid,uuid,jsonb),
  tonde.memory_candidate_list(uuid,uuid,text,integer,integer),
  tonde.memory_candidate_decide(uuid,uuid,uuid,text,text),
  tonde.memory_summary(uuid,uuid),
  tonde.production_search(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  tonde.memory_policy_set(uuid,uuid,jsonb),
  tonde.memory_policy_get(uuid,uuid),
  tonde.memory_item_set(uuid,uuid,jsonb),
  tonde.memory_item_retire(uuid,uuid,uuid,text),
  tonde.memory_item_list(uuid,uuid,text,text,text,text,integer,integer),
  tonde.memory_resolve(uuid,uuid,text,text),
  tonde.memory_candidate_record(uuid,uuid,jsonb),
  tonde.memory_candidate_list(uuid,uuid,text,integer,integer),
  tonde.memory_candidate_decide(uuid,uuid,uuid,text,text),
  tonde.memory_summary(uuid,uuid),
  tonde.production_search(uuid,uuid,jsonb)
  to authenticated;
commit;
