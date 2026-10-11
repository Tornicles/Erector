-- 050: card-scoped downloads ride the Prompt 10 export law, unchanged.
--
-- A download is still a pinned-version export built by the server and served through authorized
-- expiring access. This migration only records *which cards* a full-document PDF covers, so Studio
-- can offer Current Card / Selected Cards / Episode / Shot-prompt downloads without a second system:
--
-- * `scope_type` names the download shape; `scope_refs` carries the card/shot selection.
-- * `full_production` is the previous behavior (every card, in production order) and stays default.
-- * A non-full scope is only honest for a full_document PDF: the card renderer is a PDF renderer,
--   and a production package is a different product with its own package_type narrowing.
-- * Requested ids are verified against this production at request time; the builder additionally
--   filters everything it renders to this production, so an unknown id can only narrow, never leak.
--
-- Schema impact: two additive columns on tonde.exports (text + jsonb with justification below).
-- Ownership/hierarchy/status/timing/revision/access/storage/index notes:
-- * No new table, no new bucket, no RLS change: the columns inherit the exports row policy.
-- * No status/approval/lock semantics change; plain text/jsonb hold no durations or versions.
-- * No new index: exports are read by id; scope is never a query predicate.
-- * Backfill: existing rows read as full_production via the column defaults; old clients that omit
--   scope keep previous behavior. Rollback: drop the columns and the replaced function version.
-- * Invariants: INV-EXPORT-PIN (Amendment D law 9, constitution section 12/21).

begin;

alter table tonde.exports
  add column if not exists scope_type text not null default 'full_production',
  add column if not exists scope_refs jsonb not null default '{}'::jsonb;

-- The creator action is replaced, not edited in place: the previous 5-argument version stays in
-- history (migration 033) and this 7-argument version carries scope forward.
drop function if exists tonde.export_request(uuid,uuid,text,text,text);

create function tonde.export_request(target_workspace uuid, target_production uuid, target_kind text,
  target_format text, target_package_type text default 'complete',
  target_scope_type text default 'full_production', target_scope_refs jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare production tonde.productions; version_id uuid; job_id uuid; export_id uuid;
declare scope_refs jsonb := coalesce(target_scope_refs, '{}'::jsonb);
declare scene_id uuid; shot_id uuid; scene_text text; shot_text text;
begin
  if not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into production from tonde.productions p
    where p.workspace_id = target_workspace and p.id = target_production and p.lifecycle = 'active';
  if not found then raise exception 'That Production is not available for export' using errcode = 'P0002'; end if;
  if target_kind not in ('full_document','production_package') then
    raise exception 'An export is a full_document or a production_package' using errcode = '22023';
  end if;
  if target_format not in ('pdf','docx','zip','json') then
    raise exception 'Export formats are pdf, docx, zip and json' using errcode = '22023';
  end if;
  if target_kind = 'full_document' and target_format not in ('pdf','docx') then
    raise exception 'A full document is PDF or DOCX; a ZIP is the production package'
      using errcode = '22023';
  end if;
  if target_kind = 'production_package' and target_format not in ('zip','json') then
    raise exception 'A production package is a ZIP (or its structured-data JSON); a PDF is the full document'
      using errcode = '22023';
  end if;
  if target_package_type not in ('complete','script','shot_list','storyboard','prompt_pack',
    'camera_plan','continuity_report','audio_plan','edit_plan','structured_data') then
    raise exception 'That is not a supported export package type' using errcode = '22023';
  end if;
  if target_scope_type not in ('full_production','current_card','selected_cards','episode','shot_prompt') then
    raise exception 'That is not a supported download scope' using errcode = '22023';
  end if;
  if target_scope_type <> 'full_production'
    and (target_kind <> 'full_document' or target_format <> 'pdf') then
    raise exception 'A card download is a PDF full document; other products keep their own narrowing'
      using errcode = '22023';
  end if;
  if jsonb_typeof(scope_refs) <> 'object' then
    raise exception 'Download scope must name its cards as an object' using errcode = '22023';
  end if;
  -- Every requested card and shot must belong to this production; anything else is refused here,
  -- and the builder filters to this production again, so scope can only narrow, never leak.
  -- The id lists are validated as UUID text before casting: a malformed id is an honest 22023
  -- refusal, never a bare cast error, and `#>>` is never applied to text (it is a jsonb operator).
  if jsonb_typeof(coalesce(scope_refs->'scene_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'Download scope must name its cards as a list' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(scope_refs->'shot_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'Download scope must name its shots as a list' using errcode = '22023';
  end if;
  for scene_text in select value from jsonb_array_elements_text(
    coalesce(scope_refs->'scene_ids', '[]'::jsonb)) as value loop
    if scene_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'A download can only name cards of this Production' using errcode = '22023';
    end if;
    scene_id := scene_text::uuid;
    if not exists (select 1 from tonde.scenes s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.id = scene_id and s.lifecycle = 'active') then
      raise exception 'A download can only name cards of this Production' using errcode = '22023';
    end if;
  end loop;
  for shot_text in select value from jsonb_array_elements_text(
    coalesce(scope_refs->'shot_ids', '[]'::jsonb)) as value loop
    if shot_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'A download can only name shots of this Production' using errcode = '22023';
    end if;
    shot_id := shot_text::uuid;
    if not exists (select 1 from tonde.shots s where s.workspace_id = target_workspace
      and s.production_id = target_production and s.id = shot_id and s.lifecycle = 'active') then
      raise exception 'A download can only name shots of this Production' using errcode = '22023';
    end if;
  end loop;
  -- The version this export names comes from the canonical history, not from the caller.
  select id into version_id from tonde.object_versions v
    where v.workspace_id = target_workspace and v.object_id = target_production and v.branch_name = 'main'
    order by v.revision desc limit 1;
  if version_id is null then
    raise exception 'This Production has no recorded version to export' using errcode = 'PT409';
  end if;
  insert into tonde.jobs(workspace_id, production_id, job_type, requested_by, input_metadata)
  values (target_workspace, target_production, 'export', auth.uid(),
    jsonb_build_object('export_kind', target_kind, 'format', target_format,
      'package_type', target_package_type, 'scope_type', target_scope_type))
  returning id into job_id;
  insert into tonde.exports(workspace_id, production_id, job_id, requested_format, package_type,
    production_version_id, production_revision, requested_by, scope_type, scope_refs)
  values (target_workspace, target_production, job_id, target_format, target_package_type,
    version_id, production.revision, auth.uid(), target_scope_type, scope_refs)
  returning id into export_id;
  perform tonde_private.audit_event(target_workspace, 'export.requested', export_id, 'export',
    jsonb_build_object('kind', target_kind, 'format', target_format,
      'package_type', target_package_type, 'scope_type', target_scope_type,
      'production_revision', production.revision, 'job_id', job_id));
  return jsonb_build_object('export_id', export_id, 'job_id', job_id, 'state', 'requested',
    'kind', target_kind, 'format', target_format, 'package_type', target_package_type,
    'scope_type', target_scope_type, 'scope_refs', scope_refs,
    'production_id', target_production, 'production_revision', production.revision,
    'production_version_id', version_id,
    'note', 'The export is requested and pinned to this Production version. Building runs as durable work; no file exists yet and no download is available.');
end $$;

revoke all on function tonde.export_request(uuid,uuid,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.export_request(uuid,uuid,text,text,text,text,jsonb) to authenticated;

commit;
