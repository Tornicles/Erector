-- Prompt 10 packet 033 — exports (§24–30, §71). Two DISTINCT products on the canonical export seam
-- that migration 001 already created (`tonde.exports`, `tonde.jobs`, `tonde.media_files`): the
-- human-readable FULL DOCUMENT and the machine-oriented PRODUCTION PACKAGE. One ZIP is never called
-- both. Forward-only and additive; no parallel export table is introduced.
--
-- Laws enforced here, not merely described:
--   * The export product follows from the requested format, deterministically: PDF/DOCX is the full
--     document, ZIP (or its structured-data JSON) is the production package. A caller cannot ask for
--     one product in the other's format.
--   * Every export pins the Production revision and the recorded Production version it names, at
--     request time. Later Production changes never rewrite what an old export describes.
--   * The lifecycle is truthful: REQUESTED → BUILDING → READY | FAILED, and READY | BUILDING →
--     EXPIRED. READY requires an uploaded export artifact in the private exports bucket, a manifest
--     describing exactly this export/version/format, and a ready timestamp. FAILED requires a cause.
--   * The manifest is a first-class law, not free-form JSON: deterministic relative file paths, file
--     checksums that are recorded or omitted but never faked, referenced media that belongs to this
--     workspace, and References that TONDE does not own exported as metadata rather than copied media.
--   * Only an accepted Result ships its media; anything else is still an unaccepted Result.
--   * Export artifacts are not reachable through the client storage read path at all: the server
--     authorizes a download and mints a short-lived signed URL for the coordinates it returns.
--   * No client session can create, complete, fail or expire an export: those are server RPCs, and
--     the export row stays select-only for authenticated members.
begin;

-- 1. Vocabulary. The product and its lifecycle are explicit; the UI cannot invent either.
create type tonde.export_kind as enum ('full_document','production_package');
create type tonde.export_state as enum ('requested','building','ready','failed','expired');

-- 2. Extend the canonical export row. `kind` is GENERATED from the requested format so the two
--    products can never drift apart, and historical rows keep working without a backfill of identity.
alter table tonde.exports
  add column kind tonde.export_kind generated always as (
    case when requested_format in ('pdf','docx') then 'full_document'::tonde.export_kind
      else 'production_package'::tonde.export_kind end) stored,
  add column state tonde.export_state not null default 'requested',
  add column production_revision integer,
  add column manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  add column file_count integer check (file_count is null or file_count >= 0),
  add column total_bytes bigint check (total_bytes is null or total_bytes >= 0),
  add column content_checksum text check (content_checksum is null or length(content_checksum) between 8 and 200),
  add column ready_at timestamptz,
  add column failed_at timestamptz,
  add column expired_at timestamptz,
  add column failure_code text check (failure_code is null or length(failure_code) <= 120),
  add column failure_message text check (failure_message is null or length(failure_message) <= 2000);

-- 3. Historical rows keep their history. The revision pin is read from the recorded Production
--    version the row already names; a row that already produced an artifact is READY, and its
--    manifest is reconstructed and EXPLICITLY MARKED as reconstructed (the original builder recorded
--    no manifest, so file contents stay unknown instead of being invented).
update tonde.exports e set production_revision = coalesce((v.snapshot->>'revision')::integer, 1)
  from tonde.object_versions v where v.id = e.production_version_id and e.production_revision is null;
update tonde.exports set production_revision = 1 where production_revision is null;
update tonde.exports e set state = 'ready', ready_at = coalesce(e.completed_at, e.created_at),
  manifest = jsonb_build_object('schema_version', 'pre-prompt-10-reconstruction',
    'export_id', e.id, 'workspace_id', e.workspace_id, 'production_id', e.production_id,
    'production_revision', e.production_revision, 'format', e.requested_format,
    'generated_at', coalesce(e.completed_at, e.created_at), 'files', '[]'::jsonb,
    'checksums', '{}'::jsonb, 'reconstructed', true,
    'note', 'Reconstructed when the Prompt 10 export law was introduced; the original builder recorded no manifest, so file contents are unknown rather than invented.')
  where e.generated_media_id is not null and e.state = 'requested';

alter table tonde.exports alter column production_revision set not null;
alter table tonde.exports add constraint export_revision_is_pinned check (production_revision > 0);
alter table tonde.exports add constraint export_ready_has_artifact check (
  state <> 'ready' or (generated_media_id is not null and ready_at is not null));
alter table tonde.exports add constraint export_ready_has_manifest check (
  state <> 'ready' or (manifest ? 'export_id' and manifest ? 'files' and manifest ? 'generated_at'));
alter table tonde.exports add constraint export_failed_records_cause check (
  state <> 'failed' or (failed_at is not null and failure_message is not null));
alter table tonde.exports add constraint export_expired_records_when check (state <> 'expired' or expired_at is not null);
create index exports_by_production on tonde.exports(workspace_id, production_id, created_at desc, id);
create index exports_by_state on tonde.exports(state, created_at);

-- 4. The export law: product identity, lifecycle, artifact and manifest truth.
create function tonde_private.guard_export() returns trigger
language plpgsql security definer set search_path = '' as $$
declare production tonde.productions; artifact tonde.media_files; result_row tonde.results;
  entry jsonb; file_path text; media_id uuid; allowed text[];
begin
  if tg_op = 'INSERT' then
    if new.state <> 'requested' then
      raise exception 'An export begins as a request; its states record what actually happened'
        using errcode = '23514';
    end if;
    if new.generated_media_id is not null or new.manifest <> '{}'::jsonb then
      raise exception 'An export request carries no artifact yet' using errcode = '23514';
    end if;
    -- The revision pin comes from the Production, never from the caller's opinion of it.
    select * into production from tonde.productions p
      where p.workspace_id = new.workspace_id and p.id = new.production_id;
    if not found then
      raise exception 'That Production does not exist in this workspace' using errcode = 'P0002';
    end if;
    if new.production_revision is null then
      new := jsonb_populate_record(new, jsonb_build_object('production_revision', production.revision));
    elsif new.production_revision <> production.revision then
      raise exception 'A new export pins the Production revision it was requested at'
        using errcode = '23514';
    end if;
    return new;
  end if;
  -- The product identity and the pinned version are what the export was requested for; they are
  -- never rewritten afterwards. (guard_mutation covers id/workspace/production/created_at.) `kind` is
  -- absent from this comparison on purpose: it is a stored generated column, so it is hashed from the
  -- requested format and PostgreSQL computes it only after BEFORE triggers have run.
  if (new.requested_format, new.package_type, new.production_version_id,
      new.production_revision, new.job_id, new.requested_by)
    is distinct from
    (old.requested_format, old.package_type, old.production_version_id,
     old.production_revision, old.job_id, old.requested_by) then
    raise exception 'This export already names the exact product and Production version it was requested for'
      using errcode = '23514';
  end if;
  if new.state <> old.state then
    allowed := case old.state
      when 'requested' then array['building','failed','expired']
      when 'building' then array['ready','failed','expired']
      when 'ready' then array['expired']
      else array[]::text[] end;
    if not (new.state::text = any(allowed)) then
      raise exception 'An export in % cannot become %; that did not happen', old.state, new.state
        using errcode = 'PT409';
    end if;
  end if;
  if new.state = 'expired' and new.expired_at is null then
    new := jsonb_populate_record(new, jsonb_build_object('expired_at', now()));
  end if;
  if new.state <> 'ready' then return new; end if;
  -- READY names a real artifact: an uploaded export file in the private exports bucket.
  select * into artifact from tonde.media_files m
    where m.workspace_id = new.workspace_id and m.id = new.generated_media_id;
  if not found or artifact.bucket <> 'tonde-exports' or artifact.file_category <> 'export'
    or artifact.upload_state <> 'uploaded' then
    raise exception 'A ready export names an uploaded export artifact in the private exports bucket'
      using errcode = '23514';
  end if;
  -- The manifest describes exactly this export, this version and this format.
  if not (new.manifest ? 'schema_version' and new.manifest ? 'export_id' and new.manifest ? 'workspace_id'
    and new.manifest ? 'production_id' and new.manifest ? 'production_revision'
    and new.manifest ? 'generated_at' and new.manifest ? 'format'
    and jsonb_typeof(new.manifest->'files') = 'array') then
    raise exception 'An export manifest names the export, its Production version, its format and its files'
      using errcode = '23514';
  end if;
  if (new.manifest->>'export_id')::uuid <> new.id
    or (new.manifest->>'workspace_id')::uuid <> new.workspace_id
    or (new.manifest->>'production_id')::uuid <> new.production_id
    or (new.manifest->>'production_revision')::integer <> new.production_revision
    or new.manifest->>'format' <> new.requested_format then
    raise exception 'The manifest must describe exactly the version and format this export pins'
      using errcode = '23514';
  end if;
  -- Every file has a deterministic relative path; checksums are recorded or omitted, never faked.
  for entry in select * from jsonb_array_elements(new.manifest->'files') loop
    file_path := entry->>'path';
    if file_path is null or file_path = '' or file_path like '/%'
      or file_path ~ '(^|/)\.\.(/|$)' or file_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
      raise exception 'Every export file has a deterministic relative path' using errcode = '23514';
    end if;
    if entry ? 'checksum' and length(coalesce(entry->>'checksum', '')) < 8 then
      raise exception 'A file checksum is recorded or omitted, never invented' using errcode = '23514';
    end if;
    if entry ? 'bytes' and coalesce((entry->>'bytes')::bigint, 0) < 0 then
      raise exception 'An exported file cannot have a negative size' using errcode = '23514';
    end if;
    if entry ? 'media_id' then
      media_id := (entry->>'media_id')::uuid;
      select * into artifact from tonde.media_files m
        where m.workspace_id = new.workspace_id and m.id = media_id;
      if not found then
        raise exception 'An exported file can only reference media of this workspace' using errcode = '23514';
      end if;
    end if;
  end loop;
  -- References are shipped as metadata; copied media requires rights TONDE actually has.
  for entry in select * from jsonb_array_elements(coalesce(new.manifest->'references', '[]'::jsonb)) loop
    if entry ? 'copied_media_id' then
      if coalesce(entry->>'rights_classification', 'unknown') not in
        ('user_owned','licensed','brand_owned','authorized_identity') then
        raise exception 'A Reference TONDE does not own is exported as metadata, never as copied media'
          using errcode = '23514';
      end if;
      select * into artifact from tonde.media_files m
        where m.workspace_id = new.workspace_id and m.id = (entry->>'copied_media_id')::uuid;
      if not found then
        raise exception 'A copied Reference can only use media of this workspace' using errcode = '23514';
      end if;
    end if;
  end loop;
  -- Results in a package belong to this Production, and only an accepted Result ships its media.
  for entry in select * from jsonb_array_elements(coalesce(new.manifest->'results', '[]'::jsonb)) loop
    if not (entry ? 'result_id') then
      raise exception 'Every exported Result names the Result it describes' using errcode = '23514';
    end if;
    select * into result_row from tonde.results r
      where r.workspace_id = new.workspace_id and r.production_id = new.production_id
        and r.id = (entry->>'result_id')::uuid;
    if not found then
      raise exception 'An export can only name Results of this Production' using errcode = '23514';
    end if;
    if entry ? 'media_id' then
      if result_row.approval <> 'approved' and result_row.state not in ('approved','final') then
        raise exception 'Only an accepted Result ships its media in an export' using errcode = '23514';
      end if;
      if result_row.media_id <> (entry->>'media_id')::uuid then
        raise exception 'An exported Result names the media of that Result' using errcode = '23514';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function tonde_private.guard_export() from public, anon, authenticated, service_role;
create trigger guard_export before insert or update on tonde.exports
  for each row execute function tonde_private.guard_export();

-- 5. Creator action: request an export. The request records intent, pins the Production version and
--    enqueues durable work on the EXISTING jobs foundation — it produces no file and fakes no
--    background durability (Prompt 11 owns the worker fleet that will build it).
create function tonde.export_request(target_workspace uuid, target_production uuid, target_kind text,
  target_format text, target_package_type text default 'complete') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare production tonde.productions; version_id uuid; job_id uuid; export_id uuid;
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
      'package_type', target_package_type))
  returning id into job_id;
  insert into tonde.exports(workspace_id, production_id, job_id, requested_format, package_type,
    production_version_id, production_revision, requested_by)
  values (target_workspace, target_production, job_id, target_format, target_package_type,
    version_id, production.revision, auth.uid())
  returning id into export_id;
  perform tonde_private.audit_event(target_workspace, 'export.requested', export_id, 'export',
    jsonb_build_object('kind', target_kind, 'format', target_format,
      'package_type', target_package_type, 'production_revision', production.revision, 'job_id', job_id));
  return jsonb_build_object('export_id', export_id, 'job_id', job_id, 'state', 'requested',
    'kind', target_kind, 'format', target_format, 'package_type', target_package_type,
    'production_id', target_production, 'production_revision', production.revision,
    'production_version_id', version_id,
    'note', 'The export is requested and pinned to this Production version. Building runs as durable work; no file exists yet and no download is available.');
end $$;

-- 6. Server outcomes. The trusted server records building, completion and failure — with evidence.
--    BUILDING is a claim: the existing jobs foundation requires a `running` job to name the holder of
--    its lease (jobs_check2), so a build must name the worker that takes responsibility for it. That
--    is the Prompt 10 side of the durable boundary; Prompt 11 owns the worker fleet and leases.
create function tonde.export_mark_building(target_workspace uuid, target_export uuid, lease_holder text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare export_row tonde.exports; lease text := left(coalesce(btrim(lease_holder), ''), 120);
begin
  if lease = '' then
    raise exception 'A build must name the worker that holds the job lease' using errcode = '22023';
  end if;
  select * into export_row from tonde.exports e
    where e.workspace_id = target_workspace and e.id = target_export for update;
  if not found then raise exception 'That export does not exist in this workspace' using errcode = 'P0002'; end if;
  if export_row.state <> 'requested' then
    raise exception 'An export starts building from REQUESTED; this one is %', export_row.state
      using errcode = 'PT409';
  end if;
  update tonde.exports set state = 'building'
    where workspace_id = target_workspace and id = target_export;
  update tonde.jobs set status = 'running', started_at = coalesce(started_at, now()),
    lease_owner = lease, lease_expires_at = now() + interval '15 minutes'
    where workspace_id = target_workspace and id = export_row.job_id;
  perform tonde_private.audit_event(target_workspace, 'export.building', target_export, 'export',
    jsonb_build_object('job_id', export_row.job_id, 'kind', export_row.kind::text,
      'format', export_row.requested_format, 'lease_owner', lease));
  return jsonb_build_object('export_id', target_export, 'state', 'building',
    'job_id', export_row.job_id, 'kind', export_row.kind, 'lease_owner', lease, 'started_at', now(),
    'lease_expires_at', now() + interval '15 minutes');
end $$;

create function tonde.export_complete(target_workspace uuid, target_export uuid, artifact_media_id uuid,
  target_manifest jsonb, target_file_count integer, target_total_bytes bigint,
  target_checksum text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare export_row tonde.exports; artifact tonde.media_files;
begin
  select * into export_row from tonde.exports e
    where e.workspace_id = target_workspace and e.id = target_export for update;
  if not found then raise exception 'That export does not exist in this workspace' using errcode = 'P0002'; end if;
  if export_row.state <> 'building' then
    raise exception 'An export completes from BUILDING; this one is %', export_row.state using errcode = 'PT409';
  end if;
  select * into artifact from tonde.media_files m
    where m.workspace_id = target_workspace and m.id = artifact_media_id;
  if not found then
    raise exception 'That export artifact is not a media file of this workspace' using errcode = '22023';
  end if;
  update tonde.exports set state = 'ready', generated_media_id = artifact_media_id,
    manifest = target_manifest, file_count = target_file_count, total_bytes = target_total_bytes,
    content_checksum = target_checksum, ready_at = now(), completed_at = coalesce(completed_at, now())
  where workspace_id = target_workspace and id = target_export;
  update tonde.jobs set status = 'succeeded', progress = 100, completed_at = now(),
    lease_owner = null, lease_expires_at = null,
    input_metadata = input_metadata || jsonb_build_object('export_id', target_export,
      'artifact_media_id', artifact_media_id)
  where workspace_id = target_workspace and id = export_row.job_id;
  perform tonde_private.audit_event(target_workspace, 'export.generated', target_export, 'export',
    jsonb_build_object('kind', export_row.kind::text, 'format', export_row.requested_format,
      'file_count', target_file_count, 'total_bytes', target_total_bytes,
      'content_checksum', target_checksum, 'artifact_media_id', artifact_media_id));
  return jsonb_build_object('export_id', target_export, 'state', 'ready', 'kind', export_row.kind,
    'format', export_row.requested_format, 'media_id', artifact_media_id, 'bucket', artifact.bucket,
    'object_key', artifact.object_key, 'file_count', target_file_count, 'total_bytes', target_total_bytes,
    'content_checksum', target_checksum, 'ready_at', now(),
    'note', 'The export file exists in private storage. Downloads are authorized per request and signed for a short window.');
end $$;

create function tonde.export_fail(target_workspace uuid, target_export uuid, target_code text,
  target_message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare export_row tonde.exports;
begin
  select * into export_row from tonde.exports e
    where e.workspace_id = target_workspace and e.id = target_export for update;
  if not found then raise exception 'That export does not exist in this workspace' using errcode = 'P0002'; end if;
  if export_row.state not in ('requested','building') then
    raise exception 'An export in % cannot fail; only a requested or building export can', export_row.state
      using errcode = 'PT409';
  end if;
  update tonde.exports set state = 'failed', failed_at = now(),
    failure_code = left(coalesce(target_code, ''), 120), failure_message = left(coalesce(target_message, ''), 2000)
  where workspace_id = target_workspace and id = target_export;
  update tonde.jobs set status = 'failed', completed_at = now(),
    lease_owner = null, lease_expires_at = null,
    error_code = left(coalesce(target_code, ''), 120), error_message = left(coalesce(target_message, ''), 2000)
  where workspace_id = target_workspace and id = export_row.job_id;
  perform tonde_private.audit_event(target_workspace, 'export.failed', target_export, 'export',
    jsonb_build_object('job_id', export_row.job_id, 'kind', export_row.kind::text,
      'failure_code', target_code, 'failure_message', left(coalesce(target_message, ''), 2000)));
  return jsonb_build_object('export_id', target_export, 'state', 'failed',
    'failure_code', target_code, 'failure_message', target_message, 'failed_at', now());
end $$;

-- Retention is a system decision, not a creator action; Prompt 11 owns the lifecycle engine that
-- will call this when a window closes.
create function tonde.export_expire(target_workspace uuid, target_export uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare export_row tonde.exports;
begin
  select * into export_row from tonde.exports e
    where e.workspace_id = target_workspace and e.id = target_export for update;
  if not found then raise exception 'That export does not exist in this workspace' using errcode = 'P0002'; end if;
  if export_row.state not in ('requested','building','ready') then
    raise exception 'An export in % cannot expire', export_row.state using errcode = 'PT409';
  end if;
  update tonde.exports set state = 'expired', expired_at = now()
    where workspace_id = target_workspace and id = target_export;
  update tonde.jobs set status = 'cancelled', completed_at = now(),
    lease_owner = null, lease_expires_at = null
    where workspace_id = target_workspace and id = export_row.job_id
      and status in ('queued','running','retrying');
  perform tonde_private.audit_event(target_workspace, 'export.expired', target_export, 'export',
    jsonb_build_object('previous_state', export_row.state::text, 'kind', export_row.kind::text));
  return jsonb_build_object('export_id', target_export, 'state', 'expired', 'expired_at', now());
end $$;

-- 7. Download authorization. Checked at request time for THIS export; the decision returns storage
--    coordinates and a short window, and the server mints the signed URL from them. TONDE never
--    stores a public URL and never relies on the obscurity of a path.
create function tonde.export_download(target_workspace uuid, target_export uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare export_row tonde.exports; artifact tonde.media_files;
begin
  if not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into export_row from tonde.exports e
    where e.workspace_id = target_workspace and e.id = target_export;
  if not found then raise exception 'That export does not exist in this workspace' using errcode = 'P0002'; end if;
  if export_row.state = 'expired' then
    raise exception 'This export expired and has no file to download' using errcode = 'PT409';
  end if;
  if export_row.state <> 'ready' then
    raise exception 'This export is % and has no file to download yet', export_row.state using errcode = 'PT409';
  end if;
  if export_row.expires_at is not null and export_row.expires_at <= now() then
    raise exception 'This export has reached the end of its download window' using errcode = 'PT409';
  end if;
  select * into artifact from tonde.media_files m
    where m.workspace_id = target_workspace and m.id = export_row.generated_media_id
      and m.upload_state = 'uploaded' and m.file_category = 'export';
  if not found then
    raise exception 'The export file is not available' using errcode = 'PT409';
  end if;
  return jsonb_build_object('export_id', target_export, 'authorized', true,
    'kind', export_row.kind, 'format', export_row.requested_format,
    'production_id', export_row.production_id, 'production_revision', export_row.production_revision,
    'media_id', artifact.id, 'bucket', artifact.bucket, 'object_key', artifact.object_key,
    'bytes', artifact.bytes, 'file_count', export_row.file_count,
    'content_checksum', export_row.content_checksum,
    'download_expires_at', now() + interval '5 minutes',
    'note', 'The backend mints a short-lived signed URL for exactly these coordinates; the export bucket has no client read path.');
end $$;

-- 8. Export artifacts are not client-readable at all. Prompt 10 §30: a download is an authorization
--    decision plus a short-lived signed URL from the server, never a direct member storage read.
create or replace function tonde_private.can_read_storage_object(target_bucket text, target_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from tonde.media_files m where m.storage_provider = 'supabase'
    and m.bucket = target_bucket and m.object_key = target_name and m.upload_state <> 'deleted'
    and target_bucket <> 'tonde-exports'
    and (m.expires_at is null or m.expires_at > now()) and tonde_private.is_workspace_member(m.workspace_id));
$$;

-- 9. Exposure unchanged in shape: the export row stays select-only for members (no client insert,
--    update or delete), and only the server RPCs above decide lifecycle.
alter table tonde.exports enable row level security;

-- 10. Function grants.
revoke all on function tonde.export_request(uuid,uuid,text,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.export_mark_building(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function tonde.export_complete(uuid,uuid,uuid,jsonb,integer,bigint,text) from public, anon, authenticated, service_role;
revoke all on function tonde.export_fail(uuid,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.export_expire(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.export_download(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.export_request(uuid,uuid,text,text,text) to authenticated;
grant execute on function tonde.export_download(uuid,uuid) to authenticated;
grant execute on function tonde.export_mark_building(uuid,uuid,text) to service_role;
grant execute on function tonde.export_complete(uuid,uuid,uuid,jsonb,integer,bigint,text) to service_role;
grant execute on function tonde.export_fail(uuid,uuid,text,text) to service_role;
grant execute on function tonde.export_expire(uuid,uuid) to service_role;
alter default privileges in schema tonde revoke execute on functions from public;
commit;
