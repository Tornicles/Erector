begin;

-- 1. Vocabulary. Storage codes are the generated product vocabulary keys.
create type tonde.match_verdict as enum
  ('matches_intent','acceptable_variation','needs_attention','mismatch','unknown');
create type tonde.correction_state as enum ('proposed','applied','rejected');
create type tonde.correction_recommendation as enum
  ('none','pickup_required','regeneration_recommended','both');
create type tonde.match_origin as enum ('deterministic','creator','ai_proposal');

-- 2. The Shot Match report already exists as a review artifact. It gains the record it was missing:
-- the verified modalities, the per-dimension verdicts, the summary, who produced the analysis, the
-- recommendation, and the creator's decision. It stays read-only to clients: only the guarded
-- security-definer RPCs below write it.
alter table tonde.shot_match_reports add column capabilities jsonb not null default '{}'::jsonb
  check (jsonb_typeof(capabilities) = 'object');
alter table tonde.shot_match_reports add column dimensions jsonb not null default '[]'::jsonb
  check (jsonb_typeof(dimensions) = 'array');
alter table tonde.shot_match_reports add column summary jsonb not null default '{}'::jsonb
  check (jsonb_typeof(summary) = 'object');
alter table tonde.shot_match_reports add column limitations text[] not null default '{}';
alter table tonde.shot_match_reports add column origin tonde.match_origin not null default 'deterministic';
alter table tonde.shot_match_reports add column recommendation tonde.correction_recommendation not null default 'none';
alter table tonde.shot_match_reports add column decision text
  check (decision is null or decision in ('pickup','regeneration','accepted','dismiss'));
alter table tonde.shot_match_reports add column decision_note text not null default ''
  check (length(decision_note) <= 800);
alter table tonde.shot_match_reports add column decided_by uuid;
alter table tonde.shot_match_reports add column decided_at timestamptz;
-- The report was the one history table without a workspace-scoped identity key, so nothing could
-- reference it. Adding it is additive and lets a correction point at the analysis it came from.
alter table tonde.shot_match_reports add constraint shot_match_reports_workspace_identity unique (workspace_id, id);
create index shot_match_reports_recent on tonde.shot_match_reports(workspace_id, production_id, shot_id, created_at desc, id);

-- 3. Corrections. A scoped fix for one Shot: a field patch on one real object, with the root cause,
-- the reason and the affected scope recorded so the correction is readable years later.
create table tonde.match_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, production_id uuid not null,
  report_id uuid not null, shot_id uuid not null, result_id uuid,
  target_object_id uuid not null, target_kind text not null check (length(target_kind) between 1 and 40),
  target_label text not null default '' check (length(target_label) <= 160),
  source_revision integer not null check (source_revision > 0),
  patch jsonb not null check (jsonb_typeof(patch) = 'object' and patch <> '{}'::jsonb),
  root_cause text not null default '' check (length(root_cause) <= 800),
  why text not null default '' check (length(why) <= 800),
  affected text not null default '' check (length(affected) <= 400),
  recommendation tonde.correction_recommendation not null default 'none',
  continuity_finding_id uuid,
  state tonde.correction_state not null default 'proposed',
  preview jsonb not null default '{}'::jsonb check (jsonb_typeof(preview) = 'object'),
  applied_revision integer check (applied_revision is null or applied_revision > 0),
  applied_version_id uuid,
  propagation jsonb not null default '[]'::jsonb check (jsonb_typeof(propagation) = 'array'),
  decided_by uuid, decided_at timestamptz,
  note text not null default '' check (length(note) <= 800),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, shot_id) references tonde.shots(workspace_id, id) on delete restrict,
  foreign key (workspace_id, report_id) references tonde.shot_match_reports(workspace_id, id) on delete restrict,
  foreign key (workspace_id, target_object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, continuity_finding_id) references tonde.continuity_findings(workspace_id, id) on delete restrict
);
create index match_corrections_by_report on tonde.match_corrections(workspace_id, report_id, state);
create index match_corrections_by_shot on tonde.match_corrections(workspace_id, production_id, shot_id, created_at desc, id);

-- 4. Private helpers (not user-facing; reachable only through the security-definer RPCs below).

-- The writable field map is EXTENDED, never replaced: branching and versioning keep their existing
-- fields, and an execution plan gains the fields a scoped correction legitimately targets (prompt,
-- First Frame, last frame, motion, performance, blocking). Identity, ordering, approval and locks
-- stay out of every map.
create or replace function tonde_private.vb_fields(kind_value text) returns jsonb
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
        'camera_position','text','camera_height','text','camera_angle','text','lighting_intent','text','plan_metadata','jsonb',
        'performance','text','blocking','text','product_direction','text','provider_prompt','text',
        'canonical_prompt','jsonb','first_frame','jsonb','last_frame','jsonb','motion','jsonb'))
    when 'asset' then jsonb_build_object('table','assets','scope','workspace',
      'fields', jsonb_build_object('name','text','description','text','search_metadata','jsonb','consistency_metadata','jsonb'))
    when 'result' then jsonb_build_object('table','results','scope','production',
      'fields', jsonb_build_object('provenance','jsonb'))
    else null end;
$$;
revoke all on function tonde_private.vb_fields(text) from public, anon, authenticated, service_role;

-- Resolve a Result with Production coherence.
create function tonde_private.ms_result(target_workspace uuid, target_production uuid, target_result uuid)
returns tonde.results language plpgsql stable security definer set search_path = '' as $$
declare result_row tonde.results;
begin
  select * into result_row from tonde.results
    where workspace_id = target_workspace and production_id = target_production and id = target_result;
  if not found then raise exception 'That Result is unavailable in this Production' using errcode = 'P0002'; end if;
  return result_row;
end $$;
revoke all on function tonde_private.ms_result(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- Which modality a comparison dimension needs. This is what stops a visual claim being made from
-- metadata alone, and a measured lens claim being made from an image.
create function tonde_private.ms_dimension(dimension_value text) returns text
language sql immutable set search_path = '' as $$
  select case dimension_value
    when 'audio' then 'audio'
    when 'timing' then 'timeline'
    when 'transition' then 'timeline'
    else 'visual' end;
$$;
revoke all on function tonde_private.ms_dimension(text) from public, anon, authenticated, service_role;

-- VERIFIED media capability. The truth is derived from real media rows, in the database, before any
-- analysis is recorded: a thumbnail only counts when a thumbnail row exists, frames only when a
-- keyframe was actually extracted, audio only when the media is audio or an extracted track exists.
create function tonde_private.ms_capabilities(target_workspace uuid, target_result uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare media tonde.media_files; ready boolean; notes jsonb := '[]'::jsonb;
  has_thumb boolean; has_image boolean; has_frames boolean; has_audio boolean; has_text boolean;
begin
  select * into media from tonde.media_files m where m.workspace_id = target_workspace
    and m.id = (select r.media_id from tonde.results r where r.workspace_id = target_workspace and r.id = target_result);
  if media.id is null then
    return jsonb_build_object('metadata', false, 'thumbnail', false, 'image', false, 'video_frames', false,
      'audio', false, 'text', false, 'media_state', 'missing', 'notes',
      jsonb_build_array('No media row exists for this Result, so nothing can be compared.'));
  end if;
  ready := media.upload_state = 'uploaded' and media.processing_state = 'ready';
  has_thumb := media.file_category = 'thumbnail' or exists (select 1 from tonde.media_files d
    where d.workspace_id = target_workspace and d.derived_from_id = media.id and d.file_category = 'thumbnail');
  has_image := media.file_category = 'image' or exists (select 1 from tonde.media_files d
    where d.workspace_id = target_workspace and d.derived_from_id = media.id and d.file_category = 'image');
  has_frames := exists (select 1 from tonde.media_files d
    where d.workspace_id = target_workspace and d.derived_from_id = media.id and d.file_category = 'keyframe');
  has_audio := media.file_category = 'audio' or exists (select 1 from tonde.media_files d
    where d.workspace_id = target_workspace and d.derived_from_id = media.id and d.file_category = 'extracted_audio');
  has_text := media.mime_type = 'text/plain' or exists (select 1 from tonde.media_files d
    where d.workspace_id = target_workspace and d.derived_from_id = media.id and d.mime_type = 'text/plain');
  if not ready then
    return jsonb_build_object('metadata', true, 'thumbnail', false, 'image', false, 'video_frames', false,
      'audio', false, 'text', false, 'media_state', media.upload_state || '/' || media.processing_state,
      'notes', jsonb_build_array('The media is ' || media.upload_state || ' and ' || media.processing_state
        || ', so visual, frame and audio comparison cannot be claimed yet.'));
  end if;
  if not has_thumb then notes := notes || jsonb_build_array('No thumbnail was generated, so a thumbnail view is not claimed.'); end if;
  if media.file_category = 'video' and not has_frames then
    notes := notes || jsonb_build_array('No keyframe was extracted, so frame-level visual comparison is not claimed.');
  end if;
  if not has_audio and media.file_category <> 'audio' then
    notes := notes || jsonb_build_array('No audio track was extracted, so audio comparison is not claimed.');
  end if;
  return jsonb_build_object('metadata', true, 'thumbnail', has_thumb, 'image', has_image,
    'video_frames', has_frames, 'audio', has_audio, 'text', has_text,
    'media_state', media.upload_state || '/' || media.processing_state,
    'file_category', media.file_category, 'mime_type', media.mime_type,
    'notes', notes);
end $$;
revoke all on function tonde_private.ms_capabilities(uuid,uuid) from public, anon, authenticated, service_role;

create function tonde_private.ms_available(capabilities jsonb, need text) returns boolean
language sql immutable set search_path = '' as $$
  select case need
    when 'visual' then coalesce((capabilities->>'thumbnail')::boolean, false)
      or coalesce((capabilities->>'image')::boolean, false)
      or coalesce((capabilities->>'video_frames')::boolean, false)
    when 'audio' then coalesce((capabilities->>'audio')::boolean, false)
    when 'timeline' then coalesce((capabilities->>'metadata')::boolean, false)
    else coalesce((capabilities->>'metadata')::boolean, false) end;
$$;
revoke all on function tonde_private.ms_available(jsonb,text) from public, anon, authenticated, service_role;

create function tonde_private.ms_severity_verdict(severity_value text) returns tonde.match_verdict
language sql immutable set search_path = '' as $$
  select case severity_value
    when 'critical' then 'mismatch'::tonde.match_verdict
    when 'warning' then 'needs_attention'::tonde.match_verdict
    when 'info' then 'acceptable_variation'::tonde.match_verdict
    else 'unknown'::tonde.match_verdict end;
$$;
revoke all on function tonde_private.ms_severity_verdict(text) from public, anon, authenticated, service_role;

-- Prioritization: production impact first. An unreadable Product mark matters more than a slight
-- background colour variation.
create function tonde_private.ms_impact_weight(category_value text) returns integer
language sql immutable set search_path = '' as $$
  select case category_value
    when 'product_fidelity' then 95 when 'character_consistency' then 85 when 'continuity' then 80
    when 'wardrobe' then 70 when 'props' then 70 when 'performance' then 65
    when 'environment' then 60 when 'framing' then 60 when 'subject_position' then 55
    when 'screen_direction' then 55 when 'composition' then 50 when 'timing' then 50
    when 'audio' then 50 when 'lighting' then 45 when 'camera_movement' then 45
    when 'subject_movement' then 45 when 'lens_perspective' then 40 when 'transition' then 40
    when 'camera_height' then 35 when 'camera_angle' then 35 when 'depth_of_field' then 35
    when 'contrast' then 30 when 'background' then 25 when 'color' then 25
    else 30 end;
$$;
revoke all on function tonde_private.ms_impact_weight(text) from public, anon, authenticated, service_role;

-- The four-part summary, computed from the findings themselves. Nothing is invented here.
create function tonde_private.ms_summary(findings jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare item jsonb; verdict text; category_value text; weight integer; severity_value text;
  worked jsonb := '[]'::jsonb; drifted jsonb := '[]'::jsonb; ranked jsonb := '[]'::jsonb;
  fixes jsonb := '[]'::jsonb; ranked_row record;
begin
  for item in select * from jsonb_array_elements(coalesce(findings, '[]'::jsonb)) loop
    category_value := coalesce(item->>'category', 'other');
    verdict := coalesce(item->>'verdict', 'unknown');
    severity_value := coalesce(item->>'severity', 'info');
    if verdict in ('matches_intent','acceptable_variation') and coalesce(item->>'epistemic','unknown') <> 'unknown' then
      worked := worked || jsonb_build_array(jsonb_build_object('category', category_value,
        'verdict', verdict, 'observed', coalesce(item->>'observed', '')));
    elsif verdict in ('needs_attention','mismatch') then
      drifted := drifted || jsonb_build_array(jsonb_build_object('category', category_value,
        'verdict', verdict, 'severity', severity_value, 'difference', coalesce(item->>'difference', '')));
    end if;
  end loop;
  for ranked_row in
    select coalesce(f->>'category','other') as category,
      tonde_private.ms_impact_weight(coalesce(f->>'category','other')) as weight,
      case coalesce(f->>'severity','info') when 'critical' then 3 when 'warning' then 2 when 'info' then 1 else 0 end as rank,
      coalesce(f->>'difference','') as difference, coalesce(f->>'suggested_correction','') as fix,
      coalesce(f->>'verdict','unknown') as verdict
    from jsonb_array_elements(coalesce(findings, '[]'::jsonb)) f
    where coalesce(f->>'verdict','unknown') in ('needs_attention','mismatch')
    order by rank desc, weight desc, category asc limit 3
  loop
    ranked := ranked || jsonb_build_array(jsonb_build_object('category', ranked_row.category,
      'weight', ranked_row.weight, 'difference', ranked_row.difference, 'verdict', ranked_row.verdict));
    if ranked_row.fix <> '' then
      fixes := fixes || jsonb_build_array(jsonb_build_object('category', ranked_row.category, 'fix', ranked_row.fix));
    end if;
  end loop;
  return jsonb_build_object('what_worked', worked, 'what_drifted', drifted,
    'what_matters_most', ranked, 'what_to_fix_next', fixes,
    'note', 'Ordered by production impact, not by a similarity score.');
end $$;
revoke all on function tonde_private.ms_summary(jsonb) from public, anon, authenticated, service_role;

-- The execution method behind a Result, so a Real mismatch recommends a pickup and an AI mismatch
-- recommends regeneration instead of guessing.
create function tonde_private.ms_method(target_workspace uuid, target_production uuid, target_result uuid,
  target_shot uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare method text;
begin
  select p.execution_method::text into method from tonde.execution_plans p
    join tonde.results r on r.workspace_id = p.workspace_id and r.execution_plan_id = p.id
    where r.workspace_id = target_workspace and r.id = target_result;
  if method is not null then return method; end if;
  select case when count(*) = 1 then min(p.execution_method::text) else null end into method
    from tonde.execution_plans p where p.workspace_id = target_workspace
      and p.production_id = target_production and p.shot_id = target_shot;
  return method;
end $$;
revoke all on function tonde_private.ms_method(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- 5. The Result surface. A Result is what was actually created: it links to its Production, Scene,
-- Shot, execution plan, generation Attempt or Real Take, and media, and it carries its provenance.
create function tonde.result_register(target_workspace uuid, target_production uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare shot_row tonde.shots; media_row tonde.media_files; take_row tonde.shot_takes; attempt_row tonde.ai_generation_attempts;
  origin_value text; media_id uuid; plan_id uuid; reference_id uuid; take_id uuid; attempt_id uuid;
  created tonde.results; provenance jsonb; capabilities jsonb;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(payload) <> 'object' then raise exception 'Invalid Result payload' using errcode = '22023'; end if;
  origin_value := coalesce(nullif(payload->>'origin',''), 'manual_import');
  if origin_value not in ('real_take','ai_generation','hybrid','manual_import') then
    raise exception 'A Result comes from a Real Take, an AI Attempt, a Hybrid process or a manual import' using errcode = '22023';
  end if;
  select * into shot_row from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.id = nullif(payload->>'shot_id','')::uuid and h.lifecycle = 'active';
  if not found then raise exception 'That Shot is unavailable in this Production' using errcode = 'P0002'; end if;
  take_id := nullif(payload->>'take_id','')::uuid;
  attempt_id := nullif(payload->>'attempt_id','')::uuid;
  if take_id is not null then
    select * into take_row from tonde.shot_takes t where t.workspace_id = target_workspace and t.id = take_id;
    if not found then raise exception 'That Take is unavailable' using errcode = 'P0002'; end if;
    if take_row.shot_id <> shot_row.id then raise exception 'That Take belongs to another Shot' using errcode = '22023'; end if;
  end if;
  if attempt_id is not null then
    select * into attempt_row from tonde.ai_generation_attempts a where a.workspace_id = target_workspace and a.id = attempt_id;
    if not found then raise exception 'That Attempt is unavailable' using errcode = 'P0002'; end if;
    if attempt_row.shot_id <> shot_row.id then raise exception 'That Attempt belongs to another Shot' using errcode = '22023'; end if;
  end if;
  if origin_value = 'real_take' and take_id is null then
    raise exception 'A Real Take Result must name the Take it came from' using errcode = '22023';
  end if;
  if origin_value = 'ai_generation' and attempt_id is null and coalesce(payload->>'media_id','') = '' then
    raise exception 'An AI Result must name its Attempt or its media' using errcode = '22023';
  end if;
  media_id := coalesce(nullif(payload->>'media_id','')::uuid, take_row.media_id, attempt_row.output_media_id);
  if media_id is null then raise exception 'A Result needs the media that was created' using errcode = '22023'; end if;
  select * into media_row from tonde.media_files m where m.workspace_id = target_workspace and m.id = media_id;
  if not found then raise exception 'That media is unavailable' using errcode = 'P0002'; end if;
  plan_id := coalesce(nullif(payload->>'execution_plan_id','')::uuid, take_row.plan_id, attempt_row.plan_id);
  reference_id := nullif(payload->>'reference_id','')::uuid;
  provenance := jsonb_build_object('origin', origin_value, 'registered_by', auth.uid(),
    'take_id', take_id, 'take_number', take_row.take_number, 'take_status', take_row.status::text,
    'attempt_id', attempt_id, 'attempt_number', attempt_row.attempt_number,
    'provider', attempt_row.provider_key, 'model', attempt_row.model_key,
    'media_state', media_row.upload_state || '/' || media_row.processing_state,
    'note', left(coalesce(payload->>'note',''), 600), 'registered_at', now());
  -- A Result is created for review. It is never created approved and never created Final.
  insert into tonde.results(workspace_id, production_id, scene_id, shot_id, media_id, reference_id,
    execution_plan_id, state, provenance)
  values (target_workspace, target_production, shot_row.scene_id, shot_row.id, media_id, reference_id,
    plan_id, 'needs_review', provenance)
  returning * into created;
  capabilities := tonde_private.ms_capabilities(target_workspace, created.id);
  return jsonb_build_object('result_id', created.id, 'shot_id', created.shot_id, 'scene_id', created.scene_id,
    'state', created.state, 'approval', created.approval, 'revision', created.revision,
    'provenance', provenance, 'capabilities', capabilities,
    'note', 'A new Result starts as Needs review. Nothing is approved automatically, and Final is always an explicit creator decision.');
end $$;

create or replace function tonde.result_list(target_workspace uuid, target_production uuid,
  target_shot uuid default null, target_state text default null, max_rows integer default 50, skip_rows integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb := '[]'::jsonb; total integer; result_row tonde.results; rec record; plan_row tonde.execution_plans;
  report_row record; capabilities jsonb; provenance jsonb; links jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  if target_state is not null and target_state not in ('raw','needs_review','approved','rejected','final') then
    raise exception 'Unsupported Result state filter' using errcode = '22023';
  end if;
  select count(*) into total from tonde.results r where r.workspace_id = target_workspace
    and r.production_id = target_production and (target_shot is null or r.shot_id = target_shot)
    and (target_state is null or r.state::text = target_state);
  for result_row in
    select * from tonde.results r where r.workspace_id = target_workspace
      and r.production_id = target_production and (target_shot is null or r.shot_id = target_shot)
      and (target_state is null or r.state::text = target_state)
      order by r.created_at desc, r.id limit greatest(1, least(coalesce(max_rows,50),200)) offset greatest(0, coalesce(skip_rows,0))
  loop
    capabilities := tonde_private.ms_capabilities(target_workspace, result_row.id);
    provenance := result_row.provenance;
    plan_row := null;
    if result_row.execution_plan_id is not null then
      select * into plan_row from tonde.execution_plans p where p.workspace_id = target_workspace and p.id = result_row.execution_plan_id;
    end if;
    select count(*) as reports, max(m.severity) as worst,
      (array_agg(m.recommendation::text order by m.created_at desc))[1] as recommendation,
      (array_agg(m.decision order by m.created_at desc))[1] as decision
      into report_row from tonde.shot_match_reports m
      where m.workspace_id = target_workspace and m.result_id = result_row.id;
    links := jsonb_build_object(
      'shot_id', result_row.shot_id, 'scene_id', result_row.scene_id,
      'execution_plan_id', result_row.execution_plan_id,
      'execution_plan_method', plan_row.execution_method::text,
      'execution_plan_revision', plan_row.revision,
      'reference_id', result_row.reference_id,
      'attempt_id', provenance->>'attempt_id', 'take_id', provenance->>'take_id',
      'media_id', result_row.media_id, 'media_state', capabilities->>'media_state',
      'media_file_category', capabilities->>'file_category');
    items := items || jsonb_build_array(jsonb_build_object(
      'result_id', result_row.id, 'state', result_row.state, 'approval', result_row.approval,
      'locked', result_row.locked_at is not null, 'revision', result_row.revision,
      'shot_id', result_row.shot_id, 'shot_label', tonde_private.pi_label(target_workspace, result_row.shot_id),
      'origin', provenance->>'origin', 'provenance', provenance, 'links', links,
      'capabilities', capabilities,
      'match_reports', coalesce(report_row.reports, 0), 'match_worst_severity', report_row.worst,
      'match_recommendation', coalesce(report_row.recommendation, 'none'),
      'match_decision', report_row.decision,
      'created_at', result_row.created_at));
  end loop;
  return jsonb_build_object('items', items, 'total', total,
    'limit', greatest(1, least(coalesce(max_rows,50),200)), 'offset', greatest(0, coalesce(skip_rows,0)),
    'note', 'A Result is what was created, not the plan. Media capabilities are derived from real media rows.');
end $$;

create function tonde.result_detail(target_workspace uuid, target_production uuid, target_result uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result_row tonde.results; plan_row tonde.execution_plans; capabilities jsonb; versions integer;
  reports jsonb; corrections jsonb; items jsonb := '[]'::jsonb; correction_row record;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  result_row := tonde_private.ms_result(target_workspace, target_production, target_result);
  capabilities := tonde_private.ms_capabilities(target_workspace, target_result);
  if result_row.execution_plan_id is not null then
    select * into plan_row from tonde.execution_plans p where p.workspace_id = target_workspace and p.id = result_row.execution_plan_id;
  end if;
  select count(*) into versions from tonde.object_versions v
    where v.workspace_id = target_workspace and v.object_id = target_result;
  select coalesce(jsonb_agg(jsonb_build_object('report_id', m.id, 'state', m.state, 'severity', m.severity,
      'recommendation', m.recommendation, 'decision', m.decision, 'origin', m.origin,
      'approval', m.approval, 'created_at', m.created_at) order by m.created_at desc), '[]'::jsonb)
    into reports from tonde.shot_match_reports m
    where m.workspace_id = target_workspace and m.result_id = target_result;
  for correction_row in select c.id, c.state, c.target_object_id, c.target_label, c.target_kind, c.root_cause,
      c.patch, c.applied_revision, c.note, c.created_at from tonde.match_corrections c
    where c.workspace_id = target_workspace and c.result_id = target_result order by c.created_at desc loop
    items := items || jsonb_build_array(jsonb_build_object('correction_id', correction_row.id,
      'state', correction_row.state, 'target_object_id', correction_row.target_object_id,
      'target_label', correction_row.target_label, 'target_kind', correction_row.target_kind,
      'root_cause', correction_row.root_cause, 'patch', correction_row.patch,
      'applied_revision', correction_row.applied_revision, 'note', correction_row.note,
      'created_at', correction_row.created_at));
  end loop;
  return jsonb_build_object('result_id', result_row.id, 'state', result_row.state, 'approval', result_row.approval,
    'locked', result_row.locked_at is not null, 'revision', result_row.revision,
    'shot_id', result_row.shot_id, 'shot_label', tonde_private.pi_label(target_workspace, result_row.shot_id),
    'scene_id', result_row.scene_id, 'media_id', result_row.media_id, 'capabilities', capabilities,
    'provenance', result_row.provenance,
    'plan', case when plan_row.id is null then null else jsonb_build_object('plan_id', plan_row.id,
      'execution_method', plan_row.execution_method, 'approval', plan_row.approval, 'revision', plan_row.revision,
      'shot_size', plan_row.shot_size, 'camera_position', plan_row.camera_position, 'framing', plan_row.framing,
      'movement', plan_row.movement, 'lighting_intent', plan_row.lighting_intent,
      'first_frame', plan_row.first_frame, 'provider_prompt', plan_row.provider_prompt) end,
    'version_count', versions, 'match_reports', reports, 'corrections', items,
    'note', 'The Result keeps its revision history. Corrections are recorded, never overwritten.');
end $$;

-- Result state is a creator decision. Final is always explicit and requires an approval first.
create function tonde.result_state_set(target_workspace uuid, target_production uuid, target_result uuid,
  desired_state text, expected_revision integer default null, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result_row tonde.results; current_state text; allowed boolean := false; new_revision integer;
  approval_now text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  result_row := tonde_private.ms_result(target_workspace, target_production, target_result);
  if desired_state not in ('raw','needs_review','approved','rejected','final') then
    raise exception 'Unsupported Result state' using errcode = '22023';
  end if;
  current_state := result_row.state::text;
  if expected_revision is not null and result_row.revision <> expected_revision then
    raise exception 'That Result changed since you loaded it' using errcode = '40001';
  end if;
  -- Final is answered first: a creator asking for Final before accepting the Result is told what is
  -- actually missing instead of only that the move is unavailable.
  approval_now := tonde_private.ax_approval(target_workspace, target_result);
  if desired_state = 'final' and approval_now <> 'approved' then
    raise exception 'A Result becomes Final only after a creator approved it' using errcode = '23514';
  end if;
  allowed := case current_state
    when 'raw' then desired_state in ('needs_review','approved','rejected')
    when 'needs_review' then desired_state in ('approved','rejected')
    when 'approved' then desired_state in ('needs_review','final')
    when 'rejected' then desired_state = 'needs_review'
    when 'final' then desired_state = 'needs_review'
    else false end;
  if not allowed then
    raise exception 'A Result cannot move from % to %', current_state, desired_state using errcode = '23514';
  end if;
  update tonde.results set state = desired_state::tonde.result_state
    where workspace_id = target_workspace and id = target_result returning revision into new_revision;
  if new_revision is null then raise exception 'That Result is unavailable' using errcode = 'P0002'; end if;
  -- An explicit creator decision to accept a Result IS the approval. Shot Match itself never approves,
  -- and moving an accepted Result forward must not report it as merely changed after approval: the
  -- approval is written against the exact revision the creator just decided on.
  if desired_state in ('approved', 'final')
    and tonde_private.ax_approval(target_workspace, target_result) is distinct from 'approved' then
    new_revision := tonde_private.ax_set_approval(target_workspace, target_production, target_result, 'approved');
    if desired_state = 'approved' then
      insert into tonde.access_decisions(workspace_id, production_id, object_id, object_kind, action,
        from_approval, to_approval, from_locked, to_locked, pinned_revision, note, actor_user_id)
      values (target_workspace, target_production, target_result, 'result', 'approve',
        coalesce(approval_now, 'draft')::tonde.approval, 'approved',
        coalesce(tonde_private.pi_is_locked(target_workspace, target_result), false),
        coalesce(tonde_private.pi_is_locked(target_workspace, target_result), false), new_revision,
        left(coalesce(note_text,''), 800), auth.uid());
    end if;
  end if;
  return jsonb_build_object('result_id', target_result, 'state', desired_state, 'previous_state', current_state,
    'approval', tonde_private.ax_approval(target_workspace, target_result), 'revision', new_revision,
    'note', left(coalesce(note_text,''), 800),
    'meaning', case when desired_state = 'final'
        then 'Final is explicitly accepted evidence or deliverable state; generation completion never sets it.'
      when desired_state = 'approved' then 'A creator accepted this Result. Shot Match never approves a Result.'
      when desired_state = 'rejected' then 'This Result is rejected. The Shot still needs a usable take.'
      else 'This Result is waiting for a creator review.' end);
end $$;

-- 6. Shot Match. Records an analysis of what is different between Reference, Plan and Result, and how
-- to fix it. It never approves a Result and never launches generation.
create function tonde.match_analyze(target_workspace uuid, target_production uuid, target_shot uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result_row tonde.results; capabilities jsonb; claimed jsonb; item jsonb; key_value text;
  findings jsonb := '[]'::jsonb; normalized jsonb; dimension_value text; need text; severity_value text;
  verdict_value text; worst text := 'info'; worst_rank integer := 0; rank integer; category_value text;
  reference_id uuid; report tonde.shot_match_reports; method text; recommendation tonde.correction_recommendation;
  dimensions jsonb := '[]'::jsonb; dim record; continuity_id uuid; continuity_ids jsonb := '[]'::jsonb;
  limitations text[] := '{}'; origin_value tonde.match_origin; suggestions jsonb := '[]'::jsonb;
  allowed_keys text[] := array['category','verdict','expected','observed','difference','epistemic','confidence',
    'severity','evidence','suggested_correction','continuity_domain','subject_asset_id','region','time_range'];
  previous integer;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(payload) <> 'object' then raise exception 'Invalid Shot Match payload' using errcode = '22023'; end if;
  if not exists (select 1 from tonde.shots h where h.workspace_id = target_workspace
      and h.production_id = target_production and h.id = target_shot and h.lifecycle = 'active') then
    raise exception 'That Shot is unavailable in this Production' using errcode = 'P0002';
  end if;
  result_row := tonde_private.ms_result(target_workspace, target_production, nullif(payload->>'result_id','')::uuid);
  if result_row.shot_id <> target_shot then
    raise exception 'That Result belongs to another Shot' using errcode = '22023';
  end if;
  -- 110. Media capability truth: the verified modalities come from real media rows, and a claim the
  -- database cannot substantiate is refused rather than recorded.
  capabilities := tonde_private.ms_capabilities(target_workspace, result_row.id);
  claimed := coalesce(payload->'capabilities', '{}'::jsonb);
  if jsonb_typeof(claimed) <> 'object' then raise exception 'Capabilities must be an object' using errcode = '22023'; end if;
  for key_value in select jsonb_object_keys(claimed) loop
    if key_value in ('thumbnail','image','video_frames','audio','text')
      and coalesce((claimed->>key_value)::boolean, false)
      and not coalesce((capabilities->>key_value)::boolean, false) then
      raise exception 'That modality is not available for this Result: %', key_value using errcode = '23514';
    end if;
  end loop;
  if jsonb_array_length(coalesce(capabilities->'notes','[]'::jsonb)) > 0 then
    for key_value in select jsonb_array_elements_text(capabilities->'notes') loop
      limitations := limitations || key_value;
    end loop;
  end if;
  -- 111/112/113/114/115/116. Findings keep the evidence discipline.
  for item in select * from jsonb_array_elements(coalesce(payload->'findings','[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object' then raise exception 'A Shot Match finding must be an object' using errcode = '22023'; end if;
    for key_value in select jsonb_object_keys(item) loop
      if key_value ~ '(name|person|identity|face)' then
        raise exception 'Shot Match never identifies a person by name or by face' using errcode = '22023';
      end if;
      if not (key_value = any(allowed_keys)) then
        raise exception 'Unsupported finding field: %', key_value using errcode = '22023';
      end if;
    end loop;
    category_value := btrim(coalesce(item->>'category',''));
    if length(category_value) = 0 or length(category_value) > 60 then
      raise exception 'A finding names the dimension it compares' using errcode = '22023';
    end if;
    if coalesce(item->>'epistemic','') not in ('observed','estimated','recommended','unknown') then
      raise exception 'A finding carries a real epistemic state' using errcode = '22023';
    end if;
    if coalesce(item->>'confidence','') not in ('high','medium','low') then
      raise exception 'A finding carries a confidence of high, medium or low' using errcode = '22023';
    end if;
    severity_value := coalesce(nullif(item->>'severity',''), 'info');
    if severity_value not in ('info','warning','critical') then
      raise exception 'Unsupported finding severity' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(item->'evidence','[]'::jsonb)) = 0 and coalesce(item->>'epistemic','') = 'observed' then
      raise exception 'An observed difference must cite the evidence it was seen on' using errcode = '23514';
    end if;
    dimension_value := coalesce(nullif(item->>'category',''), 'other');
    need := tonde_private.ms_dimension(dimension_value);
    if coalesce(item->>'epistemic','') = 'observed' and not tonde_private.ms_available(capabilities, need) then
      raise exception 'A % difference cannot be observed from the available media', dimension_value using errcode = '23514';
    end if;
    if dimension_value = 'lens_perspective' and coalesce(item->>'epistemic','') = 'observed'
      and coalesce(item->>'observed','') ~ '([0-9]+\s*(mm|deg|degree|f/[0-9]))' then
      raise exception 'Report an estimated look, never a measured focal length' using errcode = '22023';
    end if;
    if coalesce(item->>'continuity_domain','') <> '' and coalesce(item->>'continuity_domain','') not in
      ('character','wardrobe','prop','product','vehicle','injury','hair_makeup','weather','time_of_day',
       'environment','lighting','story_knowledge','dialogue_fact','screen_direction','eyeline',
       'camera_geography','position','product_condition','other') then
      raise exception 'Unsupported continuity domain' using errcode = '22023';
    end if;
    verdict_value := coalesce(nullif(item->>'verdict',''), tonde_private.ms_severity_verdict(severity_value)::text);
    if verdict_value not in ('matches_intent','acceptable_variation','needs_attention','mismatch','unknown') then
      raise exception 'Unsupported match verdict' using errcode = '22023';
    end if;
    if verdict_value = 'matches_intent' and jsonb_array_length(coalesce(item->'evidence','[]'::jsonb)) = 0 then
      raise exception 'A match claim must cite the evidence it was judged on' using errcode = '23514';
    end if;
    rank := case severity_value when 'critical' then 3 when 'warning' then 2 else 1 end;
    if rank > worst_rank then worst_rank := rank; worst := severity_value; end if;
    normalized := jsonb_build_object('category', dimension_value, 'verdict', verdict_value,
      'expected', left(coalesce(item->>'expected',''), 600), 'observed', left(coalesce(item->>'observed',''), 600),
      'difference', left(coalesce(item->>'difference',''), 600), 'epistemic', item->>'epistemic',
      'confidence', item->>'confidence', 'severity', severity_value,
      'evidence', coalesce(item->'evidence','[]'::jsonb),
      'suggested_correction', left(coalesce(item->>'suggested_correction',''), 600),
      'region', left(coalesce(item->>'region',''), 120), 'time_range', left(coalesce(item->>'time_range',''), 120),
      'subject_asset_id', nullif(item->>'subject_asset_id',''));
    -- 139. A continuity-relevant finding links into the existing continuity system instead of
    -- creating a second issue model.
    if coalesce(item->>'continuity_domain','') <> '' then
      insert into tonde.continuity_findings(workspace_id, production_id, kind, severity, domain,
        subject_object_id, at_scene_id, at_shot_id, explanation, suggested_resolution, origin,
        epistemic, confidence, evidence)
      values (target_workspace, target_production, 'unexplained_change', severity_value,
        (item->>'continuity_domain')::tonde.continuity_domain,
        nullif(item->>'subject_asset_id','')::uuid,
        (select h.scene_id from tonde.shots h where h.workspace_id = target_workspace and h.id = target_shot),
        target_shot, left(coalesce(item->>'difference', item->>'observed', 'A Shot Match finding'), 1200),
        left(coalesce(item->>'suggested_correction',''), 1200),
        (case when item->>'epistemic' = 'observed' then 'derived' else 'inferred' end)::tonde.continuity_origin,
        item->>'epistemic', coalesce(item->>'confidence','high'), coalesce(item->'evidence','[]'::jsonb))
      returning id into continuity_id;
      normalized := jsonb_set(normalized, '{continuity_finding_id}', to_jsonb(continuity_id));
      continuity_ids := continuity_ids || jsonb_build_array(continuity_id);
    end if;
    if coalesce(normalized->>'suggested_correction','') <> '' then
      suggestions := suggestions || jsonb_build_array(jsonb_build_object('category', dimension_value,
        'correction', normalized->>'suggested_correction', 'severity', severity_value));
    end if;
    findings := findings || jsonb_build_array(normalized);
  end loop;
  if jsonb_array_length(findings) = 0 then
    raise exception 'A Shot Match analysis records at least one finding' using errcode = '22023';
  end if;
  -- Per-dimension verdicts, worst first, derived from the findings themselves.
  for dim in
    select f->>'category' as category,
      case min(case f->>'severity' when 'critical' then 3 when 'warning' then 2 else 1 end)
        when 3 then 'mismatch' when 2 then 'needs_attention' else 'acceptable_variation' end as verdict,
      count(*) as findings
    from jsonb_array_elements(findings) f group by 1 order by 1
  loop
    dimensions := dimensions || jsonb_build_array(jsonb_build_object('dimension', dim.category,
      'verdict', dim.verdict, 'findings', dim.findings,
      'weight', tonde_private.ms_impact_weight(dim.category)));
  end loop;
  method := tonde_private.ms_method(target_workspace, target_production, result_row.id, target_shot);
  recommendation := case
    when worst_rank < 2 then 'none'::tonde.correction_recommendation
    when method = 'real' then 'pickup_required'::tonde.correction_recommendation
    when method = 'ai' then 'regeneration_recommended'::tonde.correction_recommendation
    when method = 'hybrid' then 'both'::tonde.correction_recommendation
    else 'none'::tonde.correction_recommendation end;
  if method is null then
    -- The cast matters: an untyped literal would be read as an array literal and fail at runtime.
    limitations := limitations || ('The execution method behind this Result is unknown, so no pickup or regeneration recommendation is made.')::text;
  end if;
  origin_value := coalesce(nullif(payload->>'origin',''), 'deterministic')::tonde.match_origin;
  reference_id := coalesce(nullif(payload->>'reference_id','')::uuid, result_row.reference_id);
  select count(*) into previous from tonde.shot_match_reports m
    where m.workspace_id = target_workspace and m.shot_id = target_shot;
  insert into tonde.shot_match_reports(workspace_id, production_id, shot_id, result_id, state, findings,
    severity, recommendations, approval, capabilities, dimensions, summary, limitations, origin, recommendation)
  values (target_workspace, target_production, target_shot, result_row.id, 'complete', findings, worst,
    suggestions, 'draft', capabilities, dimensions, tonde_private.ms_summary(findings), limitations, origin_value,
    recommendation)
  returning * into report;
  return jsonb_build_object('report_id', report.id, 'shot_id', target_shot, 'result_id', result_row.id,
    'reference_id', reference_id, 'state', report.state, 'severity', worst, 'approval', report.approval,
    'findings', findings, 'dimensions', dimensions, 'recommendations', suggestions,
    'summary', report.summary, 'capabilities', capabilities, 'limitations', limitations,
    'origin', origin_value, 'recommendation', recommendation, 'iteration', previous + 1,
    'continuity_finding_ids', continuity_ids,
    'note', 'Shot Match diagnoses what is different and how to fix it. It is not a similarity score, it does not approve the Result, and it launches no generation.');
end $$;

create function tonde.match_reports(target_workspace uuid, target_production uuid, target_shot uuid default null,
  target_result uuid default null, max_rows integer default 25, skip_rows integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb := '[]'::jsonb; total integer; report_row record;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  select count(*) into total from tonde.shot_match_reports m where m.workspace_id = target_workspace
    and m.production_id = target_production and (target_shot is null or m.shot_id = target_shot)
    and (target_result is null or m.result_id = target_result);
  for report_row in
    select m.id, m.shot_id, m.result_id, m.state, m.severity, m.recommendation, m.decision, m.decision_note,
      m.origin, m.approval, m.capabilities, m.limitations, m.decided_by, m.decided_at, m.created_at
    from tonde.shot_match_reports m where m.workspace_id = target_workspace
      and m.production_id = target_production and (target_shot is null or m.shot_id = target_shot)
      and (target_result is null or m.result_id = target_result)
    order by m.created_at desc, m.id limit greatest(1, least(coalesce(max_rows,25),100)) offset greatest(0, coalesce(skip_rows,0))
  loop
    items := items || jsonb_build_array(jsonb_build_object('report_id', report_row.id, 'shot_id', report_row.shot_id,
      'shot_label', tonde_private.pi_label(target_workspace, report_row.shot_id), 'result_id', report_row.result_id,
      'state', report_row.state, 'severity', report_row.severity, 'recommendation', report_row.recommendation,
      'decision', report_row.decision, 'decision_note', report_row.decision_note, 'origin', report_row.origin,
      'approval', report_row.approval, 'capabilities', report_row.capabilities,
      'limitations', to_jsonb(report_row.limitations), 'decided_by', report_row.decided_by,
      'decided_at', report_row.decided_at, 'created_at', report_row.created_at));
  end loop;
  return jsonb_build_object('items', items, 'total', total,
    'note', 'Each report is one analysis in the Shot iteration history. Earlier analyses are preserved.');
end $$;

create function tonde.match_report_get(target_workspace uuid, target_production uuid, target_report uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare report tonde.shot_match_reports; items jsonb := '[]'::jsonb; correction_row record; chain jsonb := '[]'::jsonb;
  result_row tonde.results;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  select * into report from tonde.shot_match_reports m where m.workspace_id = target_workspace
    and m.production_id = target_production and m.id = target_report;
  if not found then raise exception 'That Shot Match report is unavailable' using errcode = 'P0002'; end if;
  result_row := tonde_private.ms_result(target_workspace, target_production, report.result_id);
  for correction_row in select c.id, c.state, c.target_object_id, c.target_label, c.target_kind, c.root_cause,
      c.why, c.affected, c.patch, c.recommendation, c.continuity_finding_id, c.preview, c.applied_revision,
      c.applied_version_id, c.propagation, c.decided_by, c.decided_at, c.note, c.created_at
    from tonde.match_corrections c where c.workspace_id = target_workspace and c.report_id = target_report
    order by c.created_at loop
    items := items || jsonb_build_array(jsonb_build_object('correction_id', correction_row.id,
      'state', correction_row.state, 'target_object_id', correction_row.target_object_id,
      'target_label', correction_row.target_label, 'target_kind', correction_row.target_kind,
      'root_cause', correction_row.root_cause, 'why', correction_row.why, 'affected', correction_row.affected,
      'patch', correction_row.patch, 'recommendation', correction_row.recommendation,
      'continuity_finding_id', correction_row.continuity_finding_id, 'preview', correction_row.preview,
      'applied_revision', correction_row.applied_revision, 'applied_version_id', correction_row.applied_version_id,
      'propagation', correction_row.propagation, 'decided_by', correction_row.decided_by,
      'decided_at', correction_row.decided_at, 'note', correction_row.note, 'created_at', correction_row.created_at));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('report_id', h.id, 'created_at', h.created_at,
      'severity', h.severity, 'recommendation', h.recommendation, 'decision', h.decision)
      order by h.created_at), '[]'::jsonb) into chain
    from (select * from tonde.shot_match_reports m where m.workspace_id = target_workspace and m.shot_id = report.shot_id
      order by m.created_at limit 50) h;
  return jsonb_build_object('report_id', report.id, 'shot_id', report.shot_id,
    'shot_label', tonde_private.pi_label(target_workspace, report.shot_id), 'result_id', report.result_id,
    'result_state', result_row.state, 'state', report.state, 'severity', report.severity,
    'approval', report.approval, 'decision', report.decision, 'decision_note', report.decision_note,
    'decided_by', report.decided_by, 'decided_at', report.decided_at, 'origin', report.origin,
    'recommendation', report.recommendation, 'capabilities', report.capabilities,
    'findings', report.findings, 'dimensions', report.dimensions, 'summary', report.summary,
    'recommendations', report.recommendations, 'limitations', to_jsonb(report.limitations),
    'corrected_plan_id', report.corrected_plan_id, 'corrections', items, 'iteration_chain', chain,
    'note', 'The iteration history is preserved: each analysis and correction stays readable.');
end $$;

-- The creator decides what to do with a report. Picking up a Real pickup touches the Prompt 6
-- capture state explicitly; recommending regeneration launches nothing.
create function tonde.match_report_decide(target_workspace uuid, target_production uuid, target_report uuid,
  decision_value text, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare report tonde.shot_match_reports; capture tonde.shot_capture_state;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if decision_value not in ('pickup','regeneration','accepted','dismiss') then
    raise exception 'A Shot Match decision is pickup, regeneration, accepted or dismiss' using errcode = '22023';
  end if;
  select * into report from tonde.shot_match_reports m where m.workspace_id = target_workspace
    and m.production_id = target_production and m.id = target_report;
  if not found then raise exception 'That Shot Match report is unavailable' using errcode = 'P0002'; end if;
  if report.state <> 'complete' then raise exception 'Only a completed analysis can be decided' using errcode = '23514'; end if;
  if report.decision is not null then raise exception 'That Shot Match report was already decided' using errcode = '23514'; end if;
  if decision_value = 'pickup' then
    select * into capture from tonde.shot_capture_state c where c.workspace_id = target_workspace
      and c.production_id = target_production and c.shot_id = report.shot_id;
    if capture.id is null then
      insert into tonde.shot_capture_state(workspace_id, production_id, shot_id, status, notes)
      values (target_workspace, target_production, report.shot_id, 'pickup_needed',
        'A Shot Match pickup was required.') returning * into capture;
    else
      update tonde.shot_capture_state c set status = 'pickup_needed',
        notes = left(coalesce(nullif(c.notes,'') || ' ', '') || 'A Shot Match pickup was required.', 1200)
        where c.id = capture.id returning * into capture;
    end if;
  end if;
  update tonde.shot_match_reports m set decision = decision_value,
    decision_note = left(coalesce(note_text,''), 800),
    decided_by = auth.uid(), decided_at = now()
    where m.id = report.id returning * into report;
  -- The report's approval IS its review state: Prompt 9E readiness blocks on a completed report that
  -- is still draft or needs review. It is written on its own, because a combined content change and
  -- approval never approves work the creator has not reviewed.
  update tonde.shot_match_reports m set approval = 'approved'
    where m.id = report.id and m.approval <> 'approved' returning * into report;
  return jsonb_build_object('report_id', report.id, 'shot_id', report.shot_id, 'decision', decision_value,
    'approval', report.approval, 'recommendation', report.recommendation,
    'capture_status', case when decision_value = 'pickup' then 'pickup_needed' else null end,
    'note', case when decision_value = 'pickup'
        then 'The Shot is marked for a pickup in the On-Set capture state. The Result itself is unchanged.'
      when decision_value = 'regeneration'
        then 'Regeneration is recommended. Nothing was launched: generation still needs the normal explicit confirmation.'
      when decision_value = 'accepted' then 'The diagnosis is accepted. The Result is still reviewed separately.'
      else 'The analysis was dismissed. Nothing changed.' end,
    'meaning', 'Deciding a Shot Match report is not an approval of the Result.');
end $$;

-- 7. FIX THIS SHOT. A scoped correction: one real target object, one validated patch, a recorded root
-- cause, and a previewed impact. It never regenerates a whole Production.
create function tonde.match_correction_propose(target_workspace uuid, target_production uuid, target_report uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare report tonde.shot_match_reports; target_object tonde.objects; map jsonb; field_name text;
  preview jsonb; analysis jsonb; correction tonde.match_corrections; recommendation_value tonde.correction_recommendation;
  continuity_id uuid;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if jsonb_typeof(payload) <> 'object' then raise exception 'Invalid correction payload' using errcode = '22023'; end if;
  select * into report from tonde.shot_match_reports m where m.workspace_id = target_workspace
    and m.production_id = target_production and m.id = target_report;
  if not found then raise exception 'That Shot Match report is unavailable' using errcode = 'P0002'; end if;
  if report.state <> 'complete' then raise exception 'Only a completed analysis can propose a correction' using errcode = '23514'; end if;
  target_object := tonde_private.vb_object(target_workspace, target_production, nullif(payload->>'target_object_id','')::uuid);
  map := tonde_private.vb_fields(target_object.kind);
  if map is null then
    raise exception 'That object kind cannot be corrected this way. Choose the Shot, the Real or AI execution plan, the prompt, the First Frame or the Story or Script.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(payload->'patch','{}'::jsonb)) <> 'object' or coalesce(payload->'patch','{}'::jsonb) = '{}'::jsonb then
    raise exception 'A correction needs at least one field to change' using errcode = '22023';
  end if;
  for field_name in select jsonb_object_keys(payload->'patch') loop
    if not (map->'fields' ? field_name) then
      raise exception 'The field % cannot be corrected this way', field_name using errcode = '22023';
    end if;
  end loop;
  -- The impact is computed, never applied, by this proposal.
  analysis := tonde.impact_preview(target_workspace, target_production,
    target_object.id, 2, 200);
  preview := jsonb_build_object('analysis_id', analysis->>'analysis_id', 'counts', analysis->'counts',
    'explanation', analysis->'explanation',
    'note', 'Impact is computed by this proposal and applied only when you accept the correction.');
  recommendation_value := coalesce(nullif(payload->>'recommendation',''), report.recommendation::text)::tonde.correction_recommendation;
  continuity_id := nullif(payload->>'continuity_finding_id','')::uuid;
  insert into tonde.match_corrections(workspace_id, production_id, report_id, shot_id, result_id,
    target_object_id, target_kind, target_label, source_revision, patch, root_cause, why, affected,
    recommendation, continuity_finding_id, preview)
  values (target_workspace, target_production, report.id, report.shot_id, report.result_id,
    target_object.id, target_object.kind, tonde_private.pi_label(target_workspace, target_object.id),
    tonde_private.pi_object_revision(target_workspace, target_object.id), payload->'patch',
    left(coalesce(payload->>'root_cause',''), 800), left(coalesce(payload->>'why',''), 800),
    left(coalesce(payload->>'affected',''), 400), recommendation_value, continuity_id, preview)
  returning * into correction;
  return jsonb_build_object('correction_id', correction.id, 'report_id', report.id, 'shot_id', report.shot_id,
    'state', correction.state, 'target_object_id', target_object.id, 'target_kind', target_object.kind,
    'target_label', correction.target_label, 'source_revision', correction.source_revision,
    'patch', correction.patch, 'root_cause', correction.root_cause, 'why', correction.why,
    'affected', correction.affected, 'recommendation', correction.recommendation,
    'continuity_finding_id', correction.continuity_finding_id, 'preview', preview,
    'note', 'The correction is a proposal. Applying it creates a new revision; the previous plan and Result are preserved.');
end $$;

create function tonde.match_correction_apply(target_workspace uuid, target_production uuid, target_correction uuid,
  expected_revision integer default null, propagation text default 'change_only_this', note_text text default '',
  record_candidate boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare correction tonde.match_corrections; applied jsonb; analysis jsonb; propagation_result jsonb;
  target_object tonde.objects; later integer; candidate jsonb; report tonde.shot_match_reports;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  if coalesce(propagation,'') not in ('update_all','review_changes','change_only_this') then
    raise exception 'Unsupported propagation mode' using errcode = '22023';
  end if;
  select * into correction from tonde.match_corrections c where c.workspace_id = target_workspace
    and c.production_id = target_production and c.id = target_correction;
  if not found then raise exception 'That correction is unavailable' using errcode = 'P0002'; end if;
  if correction.state <> 'proposed' then raise exception 'That correction was already decided' using errcode = '23514'; end if;
  if expected_revision is not null and correction.source_revision <> expected_revision then
    raise exception 'That correction was proposed against a different revision' using errcode = '40001';
  end if;
  target_object := tonde_private.vb_object(target_workspace, target_production, correction.target_object_id);
  -- 93. A locked decision is never changed incidentally: unlock it deliberately first.
  if tonde_private.pi_is_locked(target_workspace, correction.target_object_id) then
    raise exception 'That object is locked. Unlock it deliberately before applying a correction.' using errcode = '23514';
  end if;
  select * into report from tonde.shot_match_reports m where m.workspace_id = target_workspace and m.id = correction.report_id;
  -- 140/141. Reusable memory needs a LATER analysis that confirmed the fix helped. The refusal happens
  -- before anything is applied, so a refused memory request never changes the plan.
  if record_candidate then
    select count(*) into later from tonde.shot_match_reports m where m.workspace_id = target_workspace
      and m.shot_id = correction.shot_id and m.created_at > report.created_at;
    if later = 0 then
      raise exception 'A correction does not become reusable memory until a later Shot Match confirms it helped' using errcode = '23514';
    end if;
  end if;
  applied := tonde_private.vb_patch_apply(target_workspace, target_production, correction.target_object_id,
    correction.patch, correction.source_revision, 'correction');
  -- Propagate the consequence through the Prompt 9A impact engine.
  analysis := tonde.impact_preview(target_workspace, target_production, correction.target_object_id, 2, 200);
  propagation_result := tonde.apply_impact(target_workspace, target_production, (analysis->>'analysis_id')::uuid,
    propagation, '{}'::uuid[], null, 'FIX THIS SHOT correction approved by the creator');
  if target_object.kind = 'execution_plan' then
    update tonde.shot_match_reports m set corrected_plan_id = correction.target_object_id where m.id = report.id;
  end if;
  -- 140/141. The correction becomes reusable memory ONLY through the existing memory policy, and only
  -- because a later analysis confirmed it helped. Nothing is remembered from a single Shot.
  if record_candidate then
    candidate := tonde.memory_candidate_record(target_workspace, target_production, jsonb_build_object(
      'kind', 'technique', 'proposed_source', 'historical_pattern',
      'subject_key', 'Fix for ' || correction.target_label,
      'statement', left('For ' || correction.target_label || ': ' || coalesce(nullif(correction.why,''), correction.root_cause), 600),
      'basis', jsonb_build_array(jsonb_build_object('kind', 'shot_match_correction',
        'correction_id', correction.id, 'report_id', correction.report_id, 'shot_id', correction.shot_id,
        'target_object_id', correction.target_object_id, 'applied_revision', (applied->>'revision')::integer,
        'confirmed_by_later_report', true)),
      'observed_count', 1,
      'source_object_id', correction.target_object_id,
      'source_revision', (applied->>'revision')::integer));
  end if;
  update tonde.match_corrections c set state = 'applied', applied_revision = (applied->>'revision')::integer,
    applied_version_id = tonde_private.vb_latest_version(target_workspace, correction.target_object_id),
    propagation = jsonb_build_array(jsonb_build_object('counts', analysis->'counts',
      'marked', propagation_result->'marked', 'requiring_review', propagation_result->'requiring_review',
      'locked_skipped', propagation_result->'locked_skipped', 'unresolved_count', propagation_result->'unresolved_count')),
    decided_by = auth.uid(), decided_at = now(), note = left(coalesce(note_text,''), 800)
    where c.id = correction.id returning * into correction;
  return jsonb_build_object('correction_id', correction.id, 'report_id', correction.report_id,
    'shot_id', correction.shot_id, 'state', 'applied', 'target_object_id', correction.target_object_id,
    'target_kind', target_object.kind, 'applied_revision', correction.applied_revision,
    'applied_version_id', correction.applied_version_id,
    'changed_fields', applied->'changed_fields', 'propagation', correction.propagation,
    'candidate', case when record_candidate then candidate else null end,
    'note', 'A new revision was created. The previous plan, the Result and every earlier analysis are preserved; approved content is reported for review rather than rewritten silently.');
end $$;

create function tonde.match_correction_reject(target_workspace uuid, target_production uuid, target_correction uuid,
  note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare correction tonde.match_corrections;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into correction from tonde.match_corrections c where c.workspace_id = target_workspace
    and c.production_id = target_production and c.id = target_correction;
  if not found then raise exception 'That correction is unavailable' using errcode = 'P0002'; end if;
  if correction.state <> 'proposed' then raise exception 'That correction was already decided' using errcode = '23514'; end if;
  update tonde.match_corrections c set state = 'rejected', decided_by = auth.uid(), decided_at = now(),
    note = left(coalesce(note_text,''), 800) where c.id = correction.id returning * into correction;
  return jsonb_build_object('correction_id', correction.id, 'state', 'rejected', 'note',
    'The correction was rejected. Nothing changed and nothing was overwritten.');
end $$;

-- 8. RLS. The correction record is workspace-isolated and read-only to clients: only the guarded
-- RPCs above write it. Reports are already read-only to clients.
alter table tonde.match_corrections enable row level security;
create policy tenant_read on tonde.match_corrections for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.match_corrections to authenticated;

-- 9. Mutation guards: identity stays immutable, revisions auto-bump, nothing is rewritten.
create trigger guard_mutation before insert or update on tonde.match_corrections
  for each row execute function tonde_private.guard_mutation();

-- 10. Privileges: authenticated only, and the private helpers stay unreachable.
revoke all on function
  tonde.result_register(uuid,uuid,jsonb),
  tonde.result_list(uuid,uuid,uuid,text,integer,integer),
  tonde.result_detail(uuid,uuid,uuid),
  tonde.result_state_set(uuid,uuid,uuid,text,integer,text),
  tonde.match_analyze(uuid,uuid,uuid,jsonb),
  tonde.match_reports(uuid,uuid,uuid,uuid,integer,integer),
  tonde.match_report_get(uuid,uuid,uuid),
  tonde.match_report_decide(uuid,uuid,uuid,text,text),
  tonde.match_correction_propose(uuid,uuid,uuid,jsonb),
  tonde.match_correction_apply(uuid,uuid,uuid,integer,text,text,boolean),
  tonde.match_correction_reject(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function
  tonde.result_register(uuid,uuid,jsonb),
  tonde.result_list(uuid,uuid,uuid,text,integer,integer),
  tonde.result_detail(uuid,uuid,uuid),
  tonde.result_state_set(uuid,uuid,uuid,text,integer,text),
  tonde.match_analyze(uuid,uuid,uuid,jsonb),
  tonde.match_reports(uuid,uuid,uuid,uuid,integer,integer),
  tonde.match_report_get(uuid,uuid,uuid),
  tonde.match_report_decide(uuid,uuid,uuid,text,text),
  tonde.match_correction_propose(uuid,uuid,uuid,jsonb),
  tonde.match_correction_apply(uuid,uuid,uuid,integer,text,text,boolean),
  tonde.match_correction_reject(uuid,uuid,uuid,text)
  to authenticated;
commit;
