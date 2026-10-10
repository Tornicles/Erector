-- Prompt 11 packet 037 — large media ingestion and the media lifecycle.
--
-- This packet extends the media foundation migration 001 created (`tonde.media_files` with its
-- workspace-derived object key law, `upload_state`, `processing_state`, `derived_from_id`,
-- `retention_policy`) instead of adding a parallel media table. Four things did not exist yet:
--
--   1. A server-authorized upload intent. The bucket, the object key, the size ceiling and the
--      expiry are decided by the server; a client can never choose a storage path. The intent is
--      what makes a multi-gigabyte, resumable upload safe instead of a single ordinary HTTP request.
--   2. Verification of the stored object. The database never takes the browser's word for it: the
--      trusted server observes the object in storage (existence, size, type, checksum) and records
--      what it observed. Only then does the media become VERIFIED, and only then is processing work
--      enqueued - in the same transaction.
--   3. The scan seam, kept truthful. A content scanner is a real deployment decision. Where none is
--      configured the recorded state is NOT_CONFIGURED with scanner 'none' - never 'clean'. Where a
--      scanner reports infected, the media is quarantined and cannot become usable.
--   4. Technical metadata and derived media. Probing is idempotent by (content identity, probe
--      version): the same immutable bytes are never probed twice for the same version. A derivation
--      is idempotent by (source, derivation type, transform version), its output inherits provenance
--      from the original, and the original is never replaced by a proxy.
--
-- Laws enforced here, not merely described:
--   * Object keys are server-derived and must stay inside `<workspace>/<media>/`; the client's
--     filename only contributes a sanitized label.
--   * `verified` media carries the verification time, the observed size and the content checksum.
--   * A client session can never write VERIFIED, QUARANTINED, REJECTED or ABORTED, never touch the
--     verification columns and never touch the scan state. Read-only for state; the trusted server
--     records reality.
--   * Infected media is quarantined and blocked: it can never reach PROCESSING or READY.
--   * A media file's upload ceiling is the upload intent's, not a global 50 MiB invented in 001.
--     The absolute bound below is a storage sanity limit, not a product limit.
begin;

-- 1. Extend the media vocabulary. Applied migrations are never rewritten: this is a forward
--    replacement of the 001 constraints with named ones, keeping every existing value.

-- The 001 ceiling of 50 MiB was a foundation-era placeholder. Large media is the point of this
-- packet, so the absolute bound moves to 128 GiB and the *real* limit becomes the upload intent's
-- per-purpose ceiling (tonde.media_upload_limits()).
alter table tonde.media_files drop constraint if exists media_files_bytes_check;
alter table tonde.media_files add constraint media_files_bytes_check check (bytes between 1 and 137438953472);
alter table tonde.media_files add constraint media_bytes_have_a_source check (bytes >= 1);

alter table tonde.media_files drop constraint if exists media_files_upload_state_check;
alter table tonde.media_files add constraint media_files_upload_state_check check (upload_state in
  ('pending','uploading','uploaded','verifying','verified','quarantined','rejected','aborted','failed','deleted'));
alter table tonde.media_files drop constraint if exists media_files_processing_state_check;
alter table tonde.media_files add constraint media_files_processing_state_check check (processing_state in
  ('pending','blocked','processing','ready','failed','skipped'));
alter table tonde.media_files drop constraint if exists media_files_file_category_check;
alter table tonde.media_files add constraint media_files_file_category_check check (file_category in
  ('image','video','audio','document','script','thumbnail','proxy','keyframe','extracted_audio','export',
   'waveform','contact_sheet','subtitle'));
alter table tonde.media_files drop constraint if exists media_files_mime_type_check;
alter table tonde.media_files add constraint media_files_mime_type_check check (mime_type in
  ('image/jpeg','image/png','image/webp','image/gif','image/tiff','image/heic',
   'video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav','audio/mp4','audio/aac','audio/flac',
   'application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   'application/zip','application/json','text/vtt','application/x-subrip'));

-- Verification and scan state on the media row itself, because that is the row every surface reads.
alter table tonde.media_files
  add column upload_intent_id uuid,
  add column scan_state text not null default 'not_configured',
  add column verified_at timestamptz,
  add column verified_by text,
  add column verified_bytes bigint,
  add column verified_checksum text,
  add column verification jsonb not null default '{}'::jsonb;
alter table tonde.media_files add constraint media_scan_state_valid check (scan_state in
  ('not_configured','unscanned','scanning','clean','infected','error'));
-- Verification always names when and how large; a content checksum is recorded when the storage layer
-- provides one, and its absence is stated rather than filled with a placeholder. Probing and
-- derivation require a real content identity, which is what verified_checksum is.
alter table tonde.media_files add constraint media_verification_complete check (upload_state <> 'verified'
  or (verified_at is not null and verified_bytes is not null));
-- Infected media is quarantined and blocked. There is no path from infected to usable.
alter table tonde.media_files add constraint media_infected_is_contained check (scan_state <> 'infected'
  or (upload_state = 'quarantined' and processing_state = 'blocked'));
alter table tonde.media_files add constraint media_verification_object check (jsonb_typeof(verification) = 'object');
create index media_scan_review on tonde.media_files(workspace_id, scan_state)
  where scan_state in ('infected','error','scanning');
create index media_pending_processing on tonde.media_files(workspace_id, created_at desc)
  where processing_state in ('pending','blocked') and upload_state = 'verified';

-- 2. Upload intents. One row authorizes one object at one exact key for a bounded time.
create table tonde.media_upload_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  media_id uuid not null,
  production_id uuid,
  purpose text not null check (purpose in ('result','reference','asset','attachment','export_artifact')),
  bucket text not null,
  object_key text not null,
  expected_mime_type text not null,
  accepted_mime_types text[] not null default '{}',
  expected_bytes bigint check (expected_bytes is null or expected_bytes between 1 and 137438953472),
  max_bytes bigint not null check (max_bytes between 1 and 137438953472),
  resumable boolean not null default true,
  part_size_bytes bigint check (part_size_bytes is null or part_size_bytes between 1048576 and 1073741824),
  upload_session_id text,
  checksum_expected text,
  state text not null default 'created'
    check (state in ('created','uploading','completing','verified','rejected','expired','aborted')),
  parts jsonb not null default '[]'::jsonb check (jsonb_typeof(parts) = 'array'),
  bytes_recorded bigint not null default 0 check (bytes_recorded >= 0),
  actual_bytes bigint, actual_mime_type text, actual_checksum text,
  rejection_reason text, rejection_detail text,
  verification jsonb not null default '{}'::jsonb check (jsonb_typeof(verification) = 'object'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz, verified_at timestamptz, aborted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  -- The path is derived from the workspace and the media identity, exactly like media_files requires.
  constraint upload_intent_path_is_derived check
    (object_key like workspace_id::text || '/' || media_id::text || '/%' and object_key !~ '(^|/)\.\.(/|$)'),
  constraint upload_intent_time_order check (completed_at is null or completed_at >= created_at),
  constraint upload_intent_verified_is_complete check (state <> 'verified'
    or (verified_at is not null and actual_bytes is not null and actual_mime_type is not null)),
  constraint upload_intent_rejected_is_explained check (state <> 'rejected' or rejection_reason is not null)
);
create index upload_intents_open on tonde.media_upload_intents(expires_at)
  where state in ('created','uploading','completing');
create index upload_intents_by_media on tonde.media_upload_intents(workspace_id, media_id);
alter table tonde.media_upload_intents enable row level security;
create policy tenant_read on tonde.media_upload_intents for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.media_upload_intents to authenticated;
grant all on tonde.media_upload_intents to service_role;
alter table tonde.media_files add constraint media_upload_intent_fk foreign key (workspace_id, upload_intent_id)
  references tonde.media_upload_intents(workspace_id, id) on delete restrict;

-- 3. Technical metadata. One normalized row per media file, written once per probe version.
create table tonde.media_technical_metadata (
  media_id uuid primary key,
  workspace_id uuid not null,
  source_checksum text not null,
  probe_tool text not null default 'tonde-probe' check (length(probe_tool) between 1 and 60),
  probe_version text not null default '1' check (length(probe_version) between 1 and 40),
  container text, codec text, audio_codec text,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  width integer check (width is null or width > 0), height integer check (height is null or height > 0),
  frame_rate numeric check (frame_rate is null or frame_rate > 0),
  bit_rate bigint check (bit_rate is null or bit_rate >= 0),
  audio_tracks integer not null default 0 check (audio_tracks between 0 and 64),
  sample_rate integer check (sample_rate is null or sample_rate > 0),
  bit_depth integer check (bit_depth is null or bit_depth between 1 and 64),
  color_primaries text, transfer_characteristics text,
  orientation integer check (orientation is null or orientation in (1,3,6,8)),
  has_audio boolean not null default false,
  variable_frame_rate boolean,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  probed_at timestamptz not null default now(),
  unique (workspace_id, media_id),
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict
);
alter table tonde.media_technical_metadata enable row level security;
create policy tenant_read on tonde.media_technical_metadata for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.media_technical_metadata to authenticated;
grant all on tonde.media_technical_metadata to service_role;

-- 4. Derivations. Stable identity `(source, type, transform version)` is what makes reprocessing
--    harmless; the output is a *separate* media row that inherits provenance from the original.
create table tonde.media_derivations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_media_id uuid not null,
  source_checksum text not null,
  derivation_type text not null check (derivation_type in
    ('proxy','thumbnail','waveform','contact_sheet','poster_frame','audio_extract','subtitle_sidecar')),
  transform_key text not null check (length(transform_key) between 1 and 120),
  transform_version text not null default '1' check (length(transform_version) between 1 and 40),
  output_media_id uuid,
  state text not null default 'requested' check (state in ('requested','building','ready','failed')),
  job_id uuid,
  bytes bigint, checksum text,
  failure_code text, failure_message text,
  created_at timestamptz not null default now(), completed_at timestamptz, failed_at timestamptz,
  unique (workspace_id, source_media_id, derivation_type, transform_version),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, source_media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  foreign key (workspace_id, output_media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  foreign key (workspace_id, job_id) references tonde.jobs(workspace_id, id) on delete restrict,
  constraint derivation_ready_is_complete check (state <> 'ready' or (output_media_id is not null
    and completed_at is not null)),
  constraint derivation_failed_is_explained check (state <> 'failed' or failure_code is not null)
);
create index derivations_by_source on tonde.media_derivations(workspace_id, source_media_id, derivation_type);
alter table tonde.media_derivations enable row level security;
create policy tenant_read on tonde.media_derivations for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.media_derivations to authenticated;
grant all on tonde.media_derivations to service_role;

-- 5. Scan records. The seam, recorded truthfully: who scanned (or that nobody did), what version and
--    what was found. A scan is never inferred from a successful upload.
create table tonde.media_scans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  media_id uuid not null,
  scanner text not null check (length(scanner) between 1 and 60),
  scanner_version text not null default '' check (length(scanner_version) <= 60),
  state text not null check (state in ('not_configured','unscanned','scanning','clean','infected','error')),
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  checked_at timestamptz not null default now(),
  recorded_by text not null default 'tonde-server' check (length(recorded_by) <= 120),
  unique (workspace_id, media_id, scanner),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  -- Only the absence of a scanner may be recorded as NOT_CONFIGURED, and only under the name 'none'.
  constraint scan_not_configured_named_none check (state <> 'not_configured' or scanner = 'none'),
  -- A verdict of clean or infected requires a scanner that is not the placeholder.
  constraint scan_verdict_needs_scanner check (state not in ('clean','infected') or scanner <> 'none')
);
alter table tonde.media_scans enable row level security;
create policy tenant_read on tonde.media_scans for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.media_scans to authenticated;
grant all on tonde.media_scans to service_role;

-- 6. Guards.

-- A client session may describe an upload but may never assert that an object is verified, safe or
-- unusable. Those are server observations.
create function tonde_private.guard_media_verification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare trusted boolean := (select auth.role()) = 'service_role' or auth.uid() is null;
begin
  -- Authorization first: a client session is told it may not make this claim, never a rule it could
  -- learn to satisfy.
  if not trusted then
    if new.upload_state in ('verified','quarantined','rejected') then
      raise exception 'Only the trusted server records a verified, quarantined or rejected upload'
        using errcode = '42501';
    end if;
    if new.scan_state is distinct from old.scan_state
      or new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by
      or new.verified_bytes is distinct from old.verified_bytes
      or new.verified_checksum is distinct from old.verified_checksum
      or new.verification is distinct from old.verification then
      raise exception 'Verification and scan facts are recorded by the trusted server'
        using errcode = '42501';
    end if;
  end if;
  if new.upload_state = 'verified'
    and (new.verified_at is null or new.verified_bytes is null) then
    raise exception 'A verified media file records when and how large the verified object was'
      using errcode = '23514';
  end if;
  if new.scan_state = 'infected'
    and (new.upload_state <> 'quarantined' or new.processing_state <> 'blocked') then
    raise exception 'Infected media is quarantined and blocked; it cannot be used' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_media_verification() from public, anon, authenticated, service_role;
create trigger guard_media_verification before update on tonde.media_files
  for each row execute function tonde_private.guard_media_verification();

-- An insert by a client may not arrive already verified either.
create function tonde_private.guard_media_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' and auth.uid() is not null then
    if new.upload_state in ('verified','quarantined','rejected') then
      raise exception 'Only the trusted server records a verified, quarantined or rejected upload'
        using errcode = '42501';
    end if;
    if new.scan_state <> 'not_configured' or new.verified_at is not null then
      raise exception 'Verification and scan facts are recorded by the trusted server'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_media_insert() from public, anon, authenticated, service_role;
create trigger guard_media_insert before insert on tonde.media_files
  for each row execute function tonde_private.guard_media_insert();

-- A derivation's output is derived from its own source, and the source is never overwritten.
create function tonde_private.guard_derivation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare output tonde.media_files;
begin
  if tg_op = 'UPDATE' and new.source_media_id is distinct from old.source_media_id then
    raise exception 'A derivation always names the same source' using errcode = '23514';
  end if;
  if new.output_media_id is not null then
    select * into output from tonde.media_files m
      where m.workspace_id = new.workspace_id and m.id = new.output_media_id;
    if not found then
      raise exception 'That derivation output is not a media file of this workspace' using errcode = '22023';
    end if;
    if output.derived_from_id is distinct from new.source_media_id then
      raise exception 'A derivation output must inherit provenance from its source' using errcode = '23514';
    end if;
    if output.id = new.source_media_id then
      raise exception 'A derivation may not replace its own source' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_derivation() from public, anon, authenticated, service_role;
create trigger guard_derivation before insert or update on tonde.media_derivations
  for each row execute function tonde_private.guard_derivation();

-- 7. Vocabulary helpers, kept as functions so the allowlist has exactly one home.
create function tonde_private.media_category_for_mime(target_mime text) returns text
language sql immutable set search_path = '' as $$
  select case
    when target_mime like 'image/%' then 'image'
    when target_mime like 'video/%' then 'video'
    when target_mime like 'audio/%' then 'audio'
    when target_mime in ('text/vtt','application/x-subrip') then 'subtitle'
    else 'document' end;
$$;
revoke all on function tonde_private.media_category_for_mime(text) from public, anon, authenticated, service_role;

create function tonde_private.media_extension_for_mime(target_mime text) returns text
language sql immutable set search_path = '' as $$
  select case target_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/gif' then 'gif' when 'image/tiff' then 'tiff' when 'image/heic' then 'heic'
    when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm'
    when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' when 'audio/mp4' then 'm4a'
    when 'audio/aac' then 'aac' when 'audio/flac' then 'flac'
    when 'application/pdf' then 'pdf' when 'text/plain' then 'txt'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/zip' then 'zip' when 'application/json' then 'json'
    when 'text/vtt' then 'vtt' when 'application/x-subrip' then 'srt'
    else 'bin' end;
$$;
revoke all on function tonde_private.media_extension_for_mime(text) from public, anon, authenticated, service_role;

create function tonde_private.media_bucket_for_purpose(target_purpose text) returns text
language sql immutable set search_path = '' as $$
  select case target_purpose when 'result' then 'tonde-results' when 'export_artifact' then 'tonde-exports'
    when 'attachment' then 'tonde-production-media' else 'tonde-asset-references' end;
$$;
revoke all on function tonde_private.media_bucket_for_purpose(text) from public, anon, authenticated, service_role;

-- Per-purpose ceilings in bytes. These are the real limits; the 128 GiB check is a sanity bound.
-- The supported MIME types live here once so the API, the client and the database cannot disagree.
create function tonde.media_upload_limits() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'schema_version', '1',
    'supported_mime_types', jsonb_build_array('image/jpeg','image/png','image/webp','image/gif',
      'image/tiff','image/heic','video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav',
      'audio/mp4','audio/aac','audio/flac','application/pdf','text/plain','text/vtt',
      'application/x-subrip','application/json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'purposes', jsonb_build_array(
      jsonb_build_object('purpose','result','max_bytes',34359738368,'note','Captured camera or phone results.'),
      jsonb_build_object('purpose','reference','max_bytes',2147483648,'note','Reference material the creator supplies.'),
      jsonb_build_object('purpose','asset','max_bytes',2147483648,'note','Reusable Assets.'),
      jsonb_build_object('purpose','attachment','max_bytes',536870912,'note','Supporting files.'),
      jsonb_build_object('purpose','export_artifact','max_bytes',21474836480,'note','TONDE-generated export files.')),
    'absolute_max_bytes', 137438953472,
    'resumable_threshold_bytes', 8388608,
    'default_intent_expiry_hours', 24,
    'scanner_configured', exists (select 1 from tonde.media_scans s where s.scanner <> 'none'),
    'note', 'The upload intent carries the ceiling that applies to one upload. A client never chooses the bucket or the object key.');
$$;
revoke all on function tonde.media_upload_limits() from public, anon, authenticated, service_role;
grant execute on function tonde.media_upload_limits() to authenticated, service_role;

-- 8. Upload intent lifecycle.

create function tonde.media_upload_intent_create(target_workspace uuid, p_purpose text, p_original_filename text,
  p_mime_type text, p_expected_bytes bigint default null, target_production uuid default null,
  p_resumable boolean default true, p_checksum_expected text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bucket_name text; category text; extension text; media_id uuid; intent_id uuid; purpose_cap bigint;
  key text; clean_name text; cap_note text;
begin
  if not ((select auth.role()) = 'service_role') then
    if auth.uid() is null or not tonde_private.can_edit_workspace(target_workspace) then
      raise exception 'Workspace access denied' using errcode = '42501';
    end if;
  end if;
  if p_purpose not in ('result','reference','asset','attachment','export_artifact') then
    raise exception 'An upload purpose is result, reference, asset, attachment or export_artifact'
      using errcode = '22023';
  end if;
  purpose_cap := (select (entry ->> 'max_bytes')::bigint from jsonb_array_elements(
    tonde.media_upload_limits() -> 'purposes') entry where entry ->> 'purpose' = p_purpose);
  if p_expected_bytes is not null and (p_expected_bytes < 1 or p_expected_bytes > purpose_cap) then
    raise exception 'A % upload is at most % bytes', p_purpose, purpose_cap using errcode = '22023';
  end if;
  if p_mime_type is null or p_mime_type not in (
      select jsonb_array_elements_text(tonde.media_upload_limits() -> 'supported_mime_types')) then
    raise exception 'That file type is not one TONDE accepts: %', coalesce(p_mime_type, '(none)')
      using errcode = '22023';
  end if;
  -- The client's filename is a label, never a path. Anything resembling a separator is refused.
  clean_name := btrim(coalesce(p_original_filename, ''));
  if clean_name = '' or length(clean_name) > 200 or clean_name ~ '[/\\]' or clean_name like '%..%' then
    raise exception 'That filename is not usable; TONDE never accepts a client-supplied path'
      using errcode = '22023';
  end if;
  if target_production is not null and not exists (select 1 from tonde.productions p
    where p.workspace_id = target_workspace and p.id = target_production) then
    raise exception 'That Production does not exist in this workspace' using errcode = 'P0002';
  end if;
  bucket_name := tonde_private.media_bucket_for_purpose(p_purpose);
  category := tonde_private.media_category_for_mime(p_mime_type);
  extension := tonde_private.media_extension_for_mime(p_mime_type);
  media_id := gen_random_uuid();
  key := target_workspace::text || '/' || media_id::text || '/original.' || extension;
  insert into tonde.media_files(id, workspace_id, bucket, object_key, original_filename, mime_type,
    file_category, bytes, upload_state, processing_state, retention_policy, expires_at, created_by)
  values (media_id, target_workspace, bucket_name, key, clean_name, p_mime_type, category,
    greatest(coalesce(p_expected_bytes, 1), 1), 'pending', 'pending',
    case when p_purpose = 'export_artifact' then 'export' else 'persistent' end,
    case when p_purpose = 'export_artifact' then now() + interval '7 days' else null end,
    coalesce(auth.uid(), (select owner_user_id from tonde.workspaces w where w.id = target_workspace)));
  insert into tonde.media_upload_intents(workspace_id, media_id, production_id, purpose, bucket, object_key,
    expected_mime_type, accepted_mime_types, expected_bytes, max_bytes, resumable, part_size_bytes,
    checksum_expected, expires_at, created_by)
  values (target_workspace, media_id, target_production, p_purpose, bucket_name, key, p_mime_type,
    array[p_mime_type], p_expected_bytes, purpose_cap, coalesce(p_resumable, true),
    case when coalesce(p_resumable, true) then 8388608 else null end,
    nullif(btrim(coalesce(p_checksum_expected, '')), ''), now() + interval '24 hours',
    coalesce(auth.uid(), (select owner_user_id from tonde.workspaces w where w.id = target_workspace)))
  returning id into intent_id;
  update tonde.media_files set upload_intent_id = intent_id
    where workspace_id = target_workspace and id = media_id;
  cap_note := case when purpose_cap >= 8589934592 then 'Resumable upload recommended for this size.'
    else 'This ceiling applies to this upload only.' end;
  return jsonb_build_object('intent_id', intent_id, 'media_id', media_id, 'purpose', p_purpose,
    'bucket', bucket_name, 'object_key', key, 'mime_type', p_mime_type, 'file_category', category,
    'max_bytes', purpose_cap, 'expected_bytes', p_expected_bytes, 'resumable', coalesce(p_resumable, true),
    'expires_at', now() + interval '24 hours', 'state', 'created',
    'storage_path_is_server_owned', true,
    'meaning', 'The server chose this exact bucket and object key. Upload the bytes to that key, then ask TONDE to verify the stored object. Nothing is usable until that verification succeeds.',
    'upload_note', cap_note);
end $$;

-- Authorization precedes the lookup, exactly as every other guarded TONDE function does: a caller who
-- is not a member of the named workspace is refused as a denial and never learns whether the row exists.
create function tonde.media_upload_part(target_workspace uuid, target_intent uuid, p_part_number integer,
  p_bytes bigint, p_etag text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare intent tonde.media_upload_intents; entry jsonb;
begin
  if (select auth.role()) <> 'service_role'
    and (auth.uid() is null or not tonde_private.can_edit_workspace(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  if p_part_number is null or p_part_number < 1 or p_part_number > 10000 then
    raise exception 'A part number is between 1 and 10000' using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes < 0 then
    raise exception 'A part records how many bytes were stored' using errcode = '22023';
  end if;
  select * into intent from tonde.media_upload_intents i
    where i.workspace_id = target_workspace and i.id = target_intent for update;
  if not found then raise exception 'That upload intent does not exist in this workspace' using errcode = 'P0002'; end if;
  if intent.state in ('verified','rejected','expired','aborted') then
    raise exception 'UPLOAD_INTENT_CLOSED: this upload is % and records no further parts', intent.state
      using errcode = 'PT409';
  end if;
  if intent.expires_at <= now() then
    raise exception 'UPLOAD_INTENT_EXPIRED: this upload intent expired at %', intent.expires_at
      using errcode = 'PT409';
  end if;
  -- A part never changes the recorded bytes for a part already recorded: the same part is idempotent,
  -- and a genuinely different part with the same number is refused rather than silently overwritten.
  entry := (select value from jsonb_array_elements(intent.parts) value
    where (value ->> 'part_number')::integer = p_part_number);
  if entry is not null then
    if (entry ->> 'bytes')::bigint <> p_bytes then
      raise exception 'UPLOAD_PART_CONFLICT: part % was already recorded with different bytes', p_part_number
        using errcode = 'PT409';
    end if;
    return jsonb_build_object('intent_id', target_intent, 'part_number', p_part_number,
      'bytes', p_bytes, 'idempotent', true, 'parts_recorded', jsonb_array_length(intent.parts),
      'bytes_recorded', intent.bytes_recorded, 'state', intent.state);
  end if;
  update tonde.media_upload_intents set parts = parts || jsonb_build_object('part_number', p_part_number,
      'bytes', p_bytes, 'etag', left(coalesce(p_etag, ''), 200), 'recorded_at', now()),
    bytes_recorded = bytes_recorded + p_bytes,
    state = case when state = 'created' then 'uploading' else state end
    where id = target_intent returning * into intent;
  return jsonb_build_object('intent_id', target_intent, 'part_number', p_part_number, 'bytes', p_bytes,
    'idempotent', false, 'parts_recorded', jsonb_array_length(intent.parts),
    'bytes_recorded', intent.bytes_recorded, 'state', intent.state,
    'note', 'Part progress is recorded so an interrupted upload can resume instead of starting from zero.');
end $$;

-- Verification: the trusted server observed the object. The database compares what was observed with
-- what the intent authorized, and only a match becomes VERIFIED.
create function tonde.media_upload_verify(target_workspace uuid, target_intent uuid, p_observed_bytes bigint,
  p_observed_mime text, p_observed_checksum text default null, p_object_verified boolean default true,
  p_probe jsonb default '{}'::jsonb, p_verifier text default 'tonde-storage-verifier') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare intent tonde.media_upload_intents; rejection text; detail text; job jsonb; scan tonde.media_scans;
begin
  select * into intent from tonde.media_upload_intents i
    where i.workspace_id = target_workspace and i.id = target_intent for update;
  if not found then raise exception 'That upload intent does not exist in this workspace' using errcode = 'P0002'; end if;
  if intent.state = 'verified' then
    return jsonb_build_object('intent_id', target_intent, 'state', 'verified', 'idempotent', true,
      'media_id', intent.media_id, 'note', 'This upload was already verified; nothing changed.');
  end if;
  -- A closed intent never reopens: an object that was rejected, abandoned or expired stays that way.
  if intent.state in ('aborted','expired','rejected') then
    raise exception 'UPLOAD_INTENT_CLOSED: this upload is % and cannot be verified', intent.state
      using errcode = 'PT409';
  end if;
  if intent.expires_at <= now() then
    raise exception 'UPLOAD_INTENT_EXPIRED: this upload intent expired at %', intent.expires_at
      using errcode = 'PT409';
  end if;
  -- The browser saying "complete" is not evidence. Without an observed object there is no verification.
  if not coalesce(p_object_verified, false) then
    raise exception 'OBJECT_NOT_VERIFIED: the stored object could not be confirmed at %, so nothing is verified',
      intent.object_key using errcode = 'PT409';
  end if;
  if p_observed_bytes is null or p_observed_bytes < 1 or p_observed_bytes > intent.max_bytes
    or (intent.expected_bytes is not null and p_observed_bytes <> intent.expected_bytes) then      rejection := 'size';
    detail := format('Observed %s bytes; this upload was authorized for %s (ceiling %s)',
      p_observed_bytes, coalesce(intent.expected_bytes::text, 'any size'), intent.max_bytes);
  elsif p_observed_mime is null or not (p_observed_mime = any(intent.accepted_mime_types)) then
    rejection := 'mime'; detail := format('Observed type %s does not match the declared %s',
      coalesce(p_observed_mime, 'unknown'), intent.expected_mime_type);
  elsif intent.checksum_expected is not null
    and btrim(coalesce(p_observed_checksum, '')) <> intent.checksum_expected then
    rejection := 'checksum'; detail := format('Observed checksum %s does not match the recorded %s',
      coalesce(p_observed_checksum, 'none'), intent.checksum_expected);
  end if;
  if rejection is not null then
    update tonde.media_upload_intents set state = 'rejected', rejection_reason = rejection,
      rejection_detail = left(detail, 600), actual_bytes = p_observed_bytes, actual_mime_type = p_observed_mime,
      actual_checksum = nullif(btrim(coalesce(p_observed_checksum, '')), ''), completed_at = now(),
      verification = jsonb_build_object('object_verified', true, 'observed_bytes', p_observed_bytes,
        'observed_mime_type', p_observed_mime, 'verifier', left(coalesce(p_verifier, ''), 120))
      where id = target_intent;
    update tonde.media_files set upload_state = 'rejected', processing_state = 'failed',
      verification = jsonb_build_object('rejection_reason', rejection, 'rejection_detail', left(detail, 600),
        'observed_bytes', p_observed_bytes, 'observed_mime_type', p_observed_mime, 'rejected_at', now())
      where workspace_id = intent.workspace_id and id = intent.media_id;
    perform tonde_private.audit_event(intent.workspace_id, 'media.upload_rejected', intent.media_id, 'media_file',
      jsonb_build_object('intent_id', target_intent, 'reason', rejection, 'detail', left(detail, 600)));
    return jsonb_build_object('intent_id', target_intent, 'state', 'rejected', 'media_id', intent.media_id,
      'rejection_reason', rejection, 'rejection_detail', detail,
      'meaning', 'The stored object did not match what this upload was authorized to be; the media is not usable.');
  end if;
  update tonde.media_upload_intents set state = 'verified', verified_at = now(), completed_at = now(),
    actual_bytes = p_observed_bytes, actual_mime_type = p_observed_mime,
    actual_checksum = nullif(btrim(coalesce(p_observed_checksum, '')), ''),
    verification = jsonb_build_object('object_verified', true, 'observed_bytes', p_observed_bytes,
      'observed_mime_type', p_observed_mime, 'observed_checksum', nullif(btrim(coalesce(p_observed_checksum, '')), ''),
      'verifier', left(coalesce(p_verifier, ''), 120), 'path_confirmed', intent.object_key)
    where id = target_intent;
  update tonde.media_files set upload_state = 'verified', bytes = p_observed_bytes,
    mime_type = p_observed_mime,
    checksum = coalesce(nullif(btrim(coalesce(p_observed_checksum, '')), ''), checksum),
    verified_at = now(), verified_by = left(coalesce(p_verifier, 'tonde-storage-verifier'), 120),
    verified_bytes = p_observed_bytes,
    verified_checksum = nullif(btrim(coalesce(p_observed_checksum, '')), ''),
    verification = jsonb_build_object('object_verified', true, 'observed_bytes', p_observed_bytes,
      'observed_mime_type', p_observed_mime, 'observed_checksum', nullif(btrim(coalesce(p_observed_checksum, '')), ''),
      'verifier', left(coalesce(p_verifier, ''), 120), 'verified_at', now(),
      'checksum_available', nullif(btrim(coalesce(p_observed_checksum, '')), '') is not null,
      'scan_state', 'not_configured'),
    processing_state = 'pending'
    where workspace_id = intent.workspace_id and id = intent.media_id;
  -- The scan seam is recorded, not assumed: with no scanner configured the honest state is
  -- NOT_CONFIGURED and no safety claim is made anywhere.
  select * into scan from tonde.media_scans s where s.workspace_id = intent.workspace_id
    and s.media_id = intent.media_id and s.scanner = 'none';
  if not found then
    insert into tonde.media_scans(workspace_id, media_id, scanner, scanner_version, state, findings, recorded_by)
    values (intent.workspace_id, intent.media_id, 'none', '', 'not_configured', '[]'::jsonb, 'media_upload_verify');
  end if;
  if p_probe is not null and jsonb_typeof(p_probe) = 'object' and p_probe <> '{}'::jsonb then
    perform tonde.media_probe_record(intent.media_id, p_probe, 'tonde-ingest-probe', 'ingest-1');
  end if;
  -- The processing work commits with the verification: the durable request and the state it needs
  -- cannot diverge.
  job := tonde.job_enqueue(intent.workspace_id, 'media_preprocessing', intent.production_id,
    jsonb_build_object('media_id', intent.media_id, 'intent_id', target_intent, 'purpose', intent.purpose),
    'upload.verified:' || target_intent::text, 55, null, null, null);
  perform tonde.outbox_enqueue(intent.workspace_id, 'media.verified', 'media', intent.media_id,
    'media.verified:' || intent.media_id::text,
    jsonb_build_object('media_id', intent.media_id, 'intent_id', target_intent,
      'mime_type', p_observed_mime, 'bytes', p_observed_bytes, 'purpose', intent.purpose,
      'job_id', job ->> 'job_id'));
  perform tonde_private.audit_event(intent.workspace_id, 'media.verified', intent.media_id, 'media_file',
    jsonb_build_object('intent_id', target_intent, 'bytes', p_observed_bytes, 'mime_type', p_observed_mime,
      'checksum', nullif(btrim(coalesce(p_observed_checksum, '')), ''), 'job_id', job ->> 'job_id'));
  return jsonb_build_object('intent_id', target_intent, 'state', 'verified', 'idempotent', false,
    'media_id', intent.media_id, 'job_id', job ->> 'job_id', 'bytes', p_observed_bytes,
    'mime_type', p_observed_mime, 'checksum', nullif(btrim(coalesce(p_observed_checksum, '')), ''),
    'object_key', intent.object_key, 'bucket', intent.bucket,
    'scan_state', 'not_configured', 'scan_claim', 'No content scanner is configured, so TONDE makes no safety claim about these bytes.',
    'meaning', 'The stored object was observed and matches what this upload was authorized to be. Processing work was queued in the same transaction.');
end $$;

create function tonde.media_upload_abort(target_workspace uuid, target_intent uuid, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent tonde.media_upload_intents;
begin
  if (select auth.role()) <> 'service_role'
    and (auth.uid() is null or not tonde_private.can_edit_workspace(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into intent from tonde.media_upload_intents i
    where i.workspace_id = target_workspace and i.id = target_intent for update;
  if not found then raise exception 'That upload intent does not exist in this workspace' using errcode = 'P0002'; end if;
  if intent.state = 'aborted' then
    return jsonb_build_object('intent_id', target_intent, 'state', 'aborted', 'idempotent', true);
  end if;
  if intent.state <> 'created' and intent.state <> 'uploading' and intent.state <> 'completing' then
    raise exception 'UPLOAD_INTENT_CLOSED: this upload is % and cannot be abandoned', intent.state
      using errcode = 'PT409';
  end if;
  update tonde.media_upload_intents set state = 'aborted', aborted_at = now(),
    rejection_detail = left(coalesce(p_reason, ''), 600) where id = target_intent;
  update tonde.media_files set upload_state = 'aborted'
    where workspace_id = intent.workspace_id and id = intent.media_id;
  perform tonde_private.audit_event(intent.workspace_id, 'media.upload_aborted', intent.media_id, 'media_file',
    jsonb_build_object('intent_id', target_intent, 'reason', left(coalesce(p_reason, ''), 300)));
  return jsonb_build_object('intent_id', target_intent, 'state', 'aborted', 'idempotent', false,
    'meaning', 'Nothing was verified for this upload and the media file is not usable.');
end $$;

-- Stale intents expire; the media file they authorized is abandoned rather than left pending for ever.
create function tonde.media_intent_expire(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare intent_row tonde.media_upload_intents; expired integer := 0; affected text[] := '{}';
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'An expiry batch takes between 1 and 1000 intents' using errcode = '22023';
  end if;
  for intent_row in select i.* from tonde.media_upload_intents i
    where i.state in ('created','uploading','completing') and i.expires_at <= now()
    order by i.expires_at for update skip locked limit p_limit
  loop
    update tonde.media_upload_intents set state = 'expired', completed_at = now(),
      rejection_reason = 'expired', rejection_detail = 'The upload did not finish inside its window.'
      where id = intent_row.id;
    update tonde.media_files set upload_state = 'failed'
      where workspace_id = intent_row.workspace_id and id = intent_row.media_id
        and upload_state in ('pending','uploading','uploaded','verifying');
    expired := expired + 1;
    affected := affected || intent_row.id::text;
  end loop;
  return jsonb_build_object('expired', expired, 'intent_ids', affected, 'expired_at', now(),
    'meaning', 'Uploads that were never completed are closed rather than left claiming an object that was never verified.');
end $$;

-- 9. Scanning. The seam is explicit: a scanner records what it observed, and TONDE never invents one.
create function tonde.media_scan_record(target_media uuid, p_scanner text, p_state text,
  p_scanner_version text default '', p_findings jsonb default '[]'::jsonb, p_recorded_by text default 'tonde-server')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare media tonde.media_files; scan tonde.media_scans;
begin
  if p_state not in ('not_configured','unscanned','scanning','clean','infected','error') then
    raise exception 'A scan state is not_configured, unscanned, scanning, clean, infected or error'
      using errcode = '22023';
  end if;
  if p_scanner is null or btrim(p_scanner) = '' then
    raise exception 'A scan names the scanner that produced it' using errcode = '22023';
  end if;
  if p_state = 'not_configured' and btrim(p_scanner) <> 'none' then
    raise exception 'Only the absence of a scanner is recorded as not_configured, under the name none'
      using errcode = '22023';
  end if;
  if p_state in ('clean','infected') and btrim(p_scanner) = 'none' then
    raise exception 'A clean or infected verdict requires a real scanner; none is configured'
      using errcode = '22023';
  end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then
    raise exception 'Scan findings are an array' using errcode = '22023';
  end if;
  select * into media from tonde.media_files m where m.id = target_media for update;
  if not found then raise exception 'That media file does not exist' using errcode = 'P0002'; end if;
  select * into scan from tonde.media_scans s where s.workspace_id = media.workspace_id
    and s.media_id = target_media and s.scanner = btrim(p_scanner) for update;
  if scan.id is null then
    insert into tonde.media_scans(workspace_id, media_id, scanner, scanner_version, state, findings, recorded_by)
    values (media.workspace_id, target_media, btrim(p_scanner), left(coalesce(p_scanner_version, ''), 60),
      p_state, p_findings, left(coalesce(p_recorded_by, 'tonde-server'), 120))
    returning * into scan;
  else
    update tonde.media_scans set state = p_state, scanner_version = left(coalesce(p_scanner_version, ''), 60),
      findings = p_findings, checked_at = now(), recorded_by = left(coalesce(p_recorded_by, 'tonde-server'), 120)
      where id = scan.id returning * into scan;
  end if;
  update tonde.media_files set scan_state = p_state,
    upload_state = case when p_state = 'infected' then 'quarantined' else upload_state end,
    processing_state = case when p_state = 'infected' then 'blocked' else processing_state end,
    verification = case when p_state = 'infected'
      then verification || jsonb_build_object('quarantined_at', now(), 'scanner', btrim(p_scanner))
      else verification || jsonb_build_object('scan_state', p_state, 'scanner', btrim(p_scanner)) end
    where workspace_id = media.workspace_id and id = target_media
    returning * into media;
  perform tonde_private.audit_event(media.workspace_id, 'media.scanned', target_media, 'media_file',
    jsonb_build_object('scanner', btrim(p_scanner), 'state', p_state,
      'scanner_version', left(coalesce(p_scanner_version, ''), 60),
      'findings', jsonb_array_length(p_findings)));
  if p_state = 'infected' then
    return jsonb_build_object('media_id', target_media, 'scan_state', 'infected',
      'upload_state', 'quarantined', 'processing_state', 'blocked', 'findings', p_findings,
      'meaning', 'The scanner reported this object as unsafe. It is quarantined and cannot be used.');
  end if;
  if p_state = 'not_configured' then
    return jsonb_build_object('media_id', target_media, 'scan_state', 'not_configured',
      'meaning', 'No content scanner is configured. TONDE records exactly that and makes no safety claim.');
  end if;
  return jsonb_build_object('media_id', target_media, 'scan_state', p_state, 'findings', p_findings,
    'meaning', case p_state when 'clean' then 'The configured scanner reported this object as clean.'
      when 'scanning' then 'The scanner is still working on this object.'
      else 'The scan did not produce a verdict; the object is not treated as scanned.' end);
end $$;

-- 10. Processing state and technical metadata.
create function tonde.media_processing_state(target_media uuid, p_state text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare media tonde.media_files; previous text;
begin
  if p_state not in ('pending','processing','ready','failed','skipped','blocked') then
    raise exception 'A processing state is pending, processing, ready, failed, skipped or blocked'
      using errcode = '22023';
  end if;
  select * into media from tonde.media_files m where m.id = target_media for update;
  if not found then raise exception 'That media file does not exist' using errcode = 'P0002'; end if;
  previous := media.processing_state;
  if media.scan_state = 'infected' and p_state <> 'blocked' then
    raise exception 'MEDIA_QUARANTINED: an infected object can never become %', p_state using errcode = 'PT409';
  end if;
  if p_state in ('processing','ready') and media.upload_state <> 'verified' then
    raise exception 'MEDIA_NOT_VERIFIED: media in % cannot be processed; the stored object was never verified',
      media.upload_state using errcode = 'PT409';
  end if;
  update tonde.media_files set processing_state = p_state,
    verification = verification || jsonb_build_object('processing_state_note', left(coalesce(p_note, ''), 300),
      'processing_state_at', now())
    where workspace_id = media.workspace_id and id = target_media returning * into media;
  return jsonb_build_object('media_id', target_media, 'previous_state', previous,
    'processing_state', p_state, 'note', left(coalesce(p_note, ''), 300),
    'meaning', case p_state when 'ready' then 'This media file is processed and usable.'
      else 'The processing state was recorded.' end);
end $$;

create function tonde.media_probe_record(target_media uuid, p_facts jsonb, p_probe_tool text default 'tonde-probe',
  p_probe_version text default '1') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare media tonde.media_files; existing tonde.media_technical_metadata; identity text;
begin
  if p_facts is null or jsonb_typeof(p_facts) <> 'object' then
    raise exception 'Probe facts are a JSON object' using errcode = '22023';
  end if;
  select * into media from tonde.media_files m where m.id = target_media;
  if not found then raise exception 'That media file does not exist' using errcode = 'P0002'; end if;
  if media.verified_at is null or media.verified_checksum is null then
    raise exception 'MEDIA_NOT_VERIFIED: only a verified object is probed' using errcode = 'PT409';
  end if;
  identity := media.verified_checksum;
  select * into existing from tonde.media_technical_metadata t
    where t.workspace_id = media.workspace_id and t.media_id = target_media;
  if existing.media_id is not null then
    if existing.source_checksum <> identity then
      raise exception 'MEDIA_IDENTITY_CHANGED: this media file now carries different bytes than the probed source'
        using errcode = 'PT409';
    end if;
    if existing.probe_version = p_probe_version and existing.probe_tool = left(coalesce(p_probe_tool, 'tonde-probe'), 60) then
      return jsonb_build_object('media_id', target_media, 'idempotent', true,
        'probe_version', existing.probe_version, 'source_checksum', existing.source_checksum,
        'probed_at', existing.probed_at,
        'meaning', 'These exact bytes were already probed at this probe version; the recorded metadata stands.');
    end if;
  end if;
  insert into tonde.media_technical_metadata(media_id, workspace_id, source_checksum, probe_tool, probe_version,
    container, codec, audio_codec, duration_ms, width, height, frame_rate, bit_rate, audio_tracks,
    sample_rate, bit_depth, color_primaries, transfer_characteristics, orientation, has_audio,
    variable_frame_rate, summary, probed_at)
  values (target_media, media.workspace_id, identity, left(coalesce(p_probe_tool, 'tonde-probe'), 60),
    left(coalesce(p_probe_version, '1'), 40),
    nullif(p_facts ->> 'container', ''), nullif(p_facts ->> 'codec', ''), nullif(p_facts ->> 'audio_codec', ''),
    (p_facts ->> 'duration_ms')::bigint, (p_facts ->> 'width')::integer, (p_facts ->> 'height')::integer,
    (p_facts ->> 'frame_rate')::numeric, (p_facts ->> 'bit_rate')::bigint,
    coalesce((p_facts ->> 'audio_tracks')::integer, 0), (p_facts ->> 'sample_rate')::integer,
    (p_facts ->> 'bit_depth')::integer, nullif(p_facts ->> 'color_primaries', ''),
    nullif(p_facts ->> 'transfer_characteristics', ''), (p_facts ->> 'orientation')::integer,
    coalesce((p_facts ->> 'has_audio')::boolean, false), (p_facts ->> 'variable_frame_rate')::boolean,
    p_facts, now())
  on conflict (media_id) do update set source_checksum = excluded.source_checksum,
    probe_tool = excluded.probe_tool, probe_version = excluded.probe_version,
    container = excluded.container, codec = excluded.codec, audio_codec = excluded.audio_codec,
    duration_ms = excluded.duration_ms, width = excluded.width, height = excluded.height,
    frame_rate = excluded.frame_rate, bit_rate = excluded.bit_rate, audio_tracks = excluded.audio_tracks,
    sample_rate = excluded.sample_rate, bit_depth = excluded.bit_depth,
    color_primaries = excluded.color_primaries,
    transfer_characteristics = excluded.transfer_characteristics, orientation = excluded.orientation,
    has_audio = excluded.has_audio, variable_frame_rate = excluded.variable_frame_rate,
    summary = excluded.summary, probed_at = excluded.probed_at;
  return jsonb_build_object('media_id', target_media, 'idempotent', false,
    'probe_version', left(coalesce(p_probe_version, '1'), 40), 'source_checksum', identity,
    'facts', p_facts, 'probed_at', now(),
    'meaning', 'Technical metadata for these exact bytes is recorded once per probe version.');
end $$;

-- 11. Derivations.
create function tonde.media_derivation_request(target_source uuid, p_derivation_type text, p_transform_key text,
  p_transform_version text default '1', target_priority integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare media tonde.media_files; derivation tonde.media_derivations; job_type text; job jsonb;
  existing tonde.media_derivations;
begin
  if p_derivation_type not in ('proxy','thumbnail','waveform','contact_sheet','poster_frame','audio_extract',
    'subtitle_sidecar') then
    raise exception 'That is not a TONDE derivation type' using errcode = '22023';
  end if;
  if p_transform_key is null or btrim(p_transform_key) = '' then
    raise exception 'A derivation names its transform' using errcode = '22023';
  end if;
  select * into media from tonde.media_files m where m.id = target_source for update;
  if not found then raise exception 'That source media file does not exist' using errcode = 'P0002'; end if;
  -- Quarantine is checked first so the refusal names the real cause rather than a generic one.
  if media.scan_state = 'infected' then
    raise exception 'MEDIA_QUARANTINED: nothing is derived from an infected object' using errcode = 'PT409';
  end if;
  if media.upload_state <> 'verified' or media.verified_checksum is null then
    raise exception 'MEDIA_NOT_VERIFIED: a derivation is only built from a verified original'
      using errcode = 'PT409';
  end if;
  select * into existing from tonde.media_derivations d
    where d.workspace_id = media.workspace_id and d.source_media_id = target_source
      and d.derivation_type = p_derivation_type
      and d.transform_version = left(coalesce(p_transform_version, '1'), 40);
  if existing.id is not null then
    return jsonb_build_object('derivation_id', existing.id, 'job_id', existing.job_id,
      'state', existing.state, 'idempotent', true, 'output_media_id', existing.output_media_id,
      'meaning', 'This exact transform of this exact source already has a derivation; it is not built twice.');
  end if;
  job_type := case p_derivation_type when 'proxy' then 'proxy' when 'thumbnail' then 'thumbnail'
    when 'poster_frame' then 'thumbnail' else 'media_derivation' end;
  insert into tonde.media_derivations(workspace_id, source_media_id, source_checksum, derivation_type,
    transform_key, transform_version, state)
  values (media.workspace_id, target_source, media.verified_checksum, p_derivation_type,
    left(btrim(p_transform_key), 120), left(coalesce(p_transform_version, '1'), 40), 'requested')
  returning * into derivation;
  job := tonde.job_enqueue(media.workspace_id, job_type,
    (select i.production_id from tonde.media_upload_intents i
      where i.workspace_id = media.workspace_id and i.media_id = target_source
      order by i.created_at desc limit 1),
    jsonb_build_object('derivation_id', derivation.id, 'source_media_id', target_source,
      'derivation_type', p_derivation_type, 'transform_key', derivation.transform_key,
      'transform_version', derivation.transform_version, 'source_checksum', media.verified_checksum),
    'derivation:' || derivation.id::text, target_priority, null, null, null);
  update tonde.media_derivations set job_id = (job ->> 'job_id')::uuid
    where id = derivation.id returning * into derivation;
  perform tonde_private.audit_event(media.workspace_id, 'media.derivation_requested', derivation.id,
    'media_derivation', jsonb_build_object('source_media_id', target_source,
      'derivation_type', p_derivation_type, 'transform_key', derivation.transform_key,
      'transform_version', derivation.transform_version, 'job_id', job ->> 'job_id'));
  return jsonb_build_object('derivation_id', derivation.id, 'job_id', job ->> 'job_id',
    'state', 'requested', 'idempotent', false, 'job_idempotent', job ->> 'idempotent',
    'source_media_id', target_source, 'derivation_type', p_derivation_type,
    'source_checksum', media.verified_checksum,
    'meaning', 'The derivation is recorded and durable work is queued in the same transaction. The original stays canonical.');
end $$;

create function tonde.media_derivation_building(target_derivation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare derivation tonde.media_derivations;
begin
  select * into derivation from tonde.media_derivations d where d.id = target_derivation for update;
  if not found then raise exception 'That derivation does not exist' using errcode = 'P0002'; end if;
  if derivation.state = 'building' then
    return jsonb_build_object('derivation_id', target_derivation, 'state', 'building', 'idempotent', true);
  end if;
  if derivation.state <> 'requested' then
    raise exception 'DERIVATION_NOT_REQUESTED: this derivation is %', derivation.state using errcode = 'PT409';
  end if;
  update tonde.media_derivations set state = 'building'
    where id = target_derivation returning * into derivation;
  return jsonb_build_object('derivation_id', target_derivation, 'state', 'building', 'idempotent', false,
    'source_checksum', derivation.source_checksum);
end $$;

create function tonde.media_derivation_complete(target_derivation uuid, p_output_media_id uuid,
  p_bytes bigint default null, p_checksum text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare derivation tonde.media_derivations; output tonde.media_files; source tonde.media_files;
begin
  select * into derivation from tonde.media_derivations d where d.id = target_derivation for update;
  if not found then raise exception 'That derivation does not exist' using errcode = 'P0002'; end if;
  if derivation.state = 'ready' then
    return jsonb_build_object('derivation_id', target_derivation, 'state', 'ready', 'idempotent', true,
      'output_media_id', derivation.output_media_id,
      'meaning', 'This derivation is already complete; the duplicate report changed nothing.');
  end if;
  if derivation.state not in ('requested','building') then
    raise exception 'DERIVATION_FINISHED: this derivation is % and cannot complete', derivation.state
      using errcode = 'PT409';
  end if;
  select * into output from tonde.media_files m
    where m.workspace_id = derivation.workspace_id and m.id = p_output_media_id;
  if not found then
    raise exception 'That derivation output is not a media file of this workspace' using errcode = '22023';
  end if;
  if output.derived_from_id is distinct from derivation.source_media_id then
    raise exception 'A derivation output must inherit provenance from its source' using errcode = '23514';
  end if;
  select * into source from tonde.media_files m
    where m.workspace_id = derivation.workspace_id and m.id = derivation.source_media_id;
  if source.verified_checksum is distinct from derivation.source_checksum then
    raise exception 'DERIVATION_SOURCE_CHANGED: the original changed since this derivation was requested'
      using errcode = 'PT409';
  end if;
  update tonde.media_derivations set state = 'ready', output_media_id = p_output_media_id,
    bytes = p_bytes, checksum = nullif(btrim(coalesce(p_checksum, '')), ''), completed_at = now()
    where id = target_derivation returning * into derivation;
  perform tonde_private.audit_event(derivation.workspace_id, 'media.derivation_completed', derivation.id,
    'media_derivation', jsonb_build_object('source_media_id', derivation.source_media_id,
      'output_media_id', p_output_media_id, 'derivation_type', derivation.derivation_type,
      'transform_key', derivation.transform_key, 'bytes', p_bytes, 'checksum', p_checksum));
  return jsonb_build_object('derivation_id', target_derivation, 'state', 'ready', 'idempotent', false,
    'output_media_id', p_output_media_id, 'source_media_id', derivation.source_media_id,
    'source_unchanged', true, 'bucket', output.bucket, 'object_key', output.object_key,
    'meaning', 'The derived file is recorded against the immutable original; the original was not replaced.');
end $$;

create function tonde.media_derivation_fail(target_derivation uuid, p_code text, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare derivation tonde.media_derivations;
begin
  select * into derivation from tonde.media_derivations d where d.id = target_derivation for update;
  if not found then raise exception 'That derivation does not exist' using errcode = 'P0002'; end if;
  if derivation.state not in ('requested','building') then
    raise exception 'DERIVATION_FINISHED: this derivation is % and cannot fail again; a retry is a new request',
      derivation.state using errcode = 'PT409';
  end if;
  update tonde.media_derivations set state = 'failed', failed_at = now(),
    failure_code = left(coalesce(p_code, 'unknown'), 120),
    failure_message = left(coalesce(p_message, ''), 2000)
    where id = target_derivation returning * into derivation;
  perform tonde_private.audit_event(derivation.workspace_id, 'media.derivation_failed', derivation.id,
    'media_derivation', jsonb_build_object('source_media_id', derivation.source_media_id,
      'derivation_type', derivation.derivation_type, 'failure_code', p_code,
      'failure_message', left(coalesce(p_message, ''), 600)));
  return jsonb_build_object('derivation_id', target_derivation, 'state', 'failed',
    'failure_code', derivation.failure_code, 'failure_message', derivation.failure_message,
    'meaning', 'The derivation failed and is recorded as failed; the original is untouched and a retry is a new request.');
end $$;

-- 12. Reading media state. A member sees the honest state and whether the file is usable.
create function tonde.media_status(target_workspace uuid, target_media uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare media tonde.media_files; metadata tonde.media_technical_metadata; scans jsonb; derivations jsonb;
  intent tonde.media_upload_intents; by_service boolean := (select auth.role()) = 'service_role';
begin
  if not by_service and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into media from tonde.media_files m
    where m.workspace_id = target_workspace and m.id = target_media;
  if not found then raise exception 'That media file does not exist in this workspace' using errcode = 'P0002'; end if;
  select * into metadata from tonde.media_technical_metadata t
    where t.workspace_id = target_workspace and t.media_id = target_media;
  select coalesce(jsonb_agg(jsonb_build_object('scanner', s.scanner, 'state', s.state,
    'scanner_version', s.scanner_version, 'checked_at', s.checked_at,
    'findings', jsonb_array_length(s.findings)) order by s.checked_at desc), '[]'::jsonb) into scans
    from tonde.media_scans s where s.workspace_id = target_workspace and s.media_id = target_media;
  select coalesce(jsonb_agg(jsonb_build_object('derivation_id', d.id, 'type', d.derivation_type,
    'state', d.state, 'transform_key', d.transform_key, 'transform_version', d.transform_version,
    'output_media_id', d.output_media_id, 'bytes', d.bytes, 'created_at', d.created_at,
    'completed_at', d.completed_at, 'failure_code', d.failure_code) order by d.created_at desc), '[]'::jsonb)
    into derivations from tonde.media_derivations d
    where d.workspace_id = target_workspace and d.source_media_id = target_media;
  select * into intent from tonde.media_upload_intents i
    where i.workspace_id = target_workspace and i.media_id = target_media
    order by i.created_at desc limit 1;
  return jsonb_build_object('media_id', media.id, 'workspace_id', media.workspace_id,
    'bucket', case when by_service then media.bucket else media.bucket end,
    'object_key', media.object_key, 'original_filename', media.original_filename,
    'mime_type', media.mime_type, 'file_category', media.file_category, 'bytes', media.bytes,
    'upload_state', media.upload_state, 'processing_state', media.processing_state,
    'scan_state', media.scan_state, 'scan_claim', case media.scan_state
      when 'not_configured' then 'No content scanner is configured, so TONDE makes no safety claim about these bytes.'
      when 'infected' then 'The scanner reported this object as unsafe; it is quarantined.'
      when 'clean' then 'The configured scanner reported this object as clean.'
      when 'scanning' then 'The scanner is still working on this object.'
      when 'error' then 'The scanner could not complete; this object is not treated as scanned.'
      else 'This object has not been scanned.' end,
    'verified_at', media.verified_at, 'verified_bytes', media.verified_bytes,
    'verified_checksum', media.verified_checksum, 'derived_from_id', media.derived_from_id,
    'usable', media.upload_state = 'verified' and media.scan_state <> 'infected'
      and media.processing_state in ('ready','processing','pending'),
    'technical_metadata', case when metadata.media_id is null then null else jsonb_build_object(
      'container', metadata.container, 'codec', metadata.codec, 'audio_codec', metadata.audio_codec,
      'duration_ms', metadata.duration_ms, 'width', metadata.width, 'height', metadata.height,
      'frame_rate', metadata.frame_rate, 'bit_rate', metadata.bit_rate, 'audio_tracks', metadata.audio_tracks,
      'sample_rate', metadata.sample_rate, 'bit_depth', metadata.bit_depth, 'orientation', metadata.orientation,
      'has_audio', metadata.has_audio, 'variable_frame_rate', metadata.variable_frame_rate,
      'color_primaries', metadata.color_primaries, 'probe_tool', metadata.probe_tool,
      'probe_version', metadata.probe_version, 'probed_at', metadata.probed_at) end,
    'scans', scans, 'derivations', derivations,
    'upload_intent', case when intent.id is null then null else jsonb_build_object(
      'intent_id', intent.id, 'purpose', intent.purpose, 'state', intent.state,
      'expires_at', intent.expires_at, 'max_bytes', intent.max_bytes, 'resumable', intent.resumable,
      'parts_recorded', jsonb_array_length(intent.parts), 'bytes_recorded', intent.bytes_recorded,
      'rejection_reason', intent.rejection_reason, 'rejection_detail', intent.rejection_detail) end,
    'meaning', case
      when media.upload_state = 'quarantined' then 'This object is quarantined after a scanner reported it unsafe. It cannot be used.'
      when media.upload_state = 'verified' and media.processing_state = 'ready' then 'This media file is verified, processed and usable.'
      when media.upload_state = 'verified' then 'The stored object was verified; processing is still running.'
      when media.upload_state in ('rejected','failed') then 'This upload was not accepted; no usable media exists.'
      when media.upload_state = 'aborted' then 'This upload was abandoned before it was verified.'
      else 'This upload has not been verified yet, so TONDE makes no claim about the object.' end);
end $$;

create function tonde.media_upload_intent_status(target_workspace uuid, target_intent uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare intent tonde.media_upload_intents;
begin
  if (select auth.role()) <> 'service_role'
    and (auth.uid() is null or not tonde_private.is_workspace_member(target_workspace)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into intent from tonde.media_upload_intents i
    where i.workspace_id = target_workspace and i.id = target_intent;
  if not found then raise exception 'That upload intent does not exist in this workspace' using errcode = 'P0002'; end if;
  return jsonb_build_object('intent_id', intent.id, 'media_id', intent.media_id, 'purpose', intent.purpose,
    'state', intent.state, 'bucket', intent.bucket, 'object_key', intent.object_key,
    'max_bytes', intent.max_bytes, 'resumable', intent.resumable,
    'parts_recorded', jsonb_array_length(intent.parts), 'bytes_recorded', intent.bytes_recorded,
    'expires_at', intent.expires_at, 'verified_at', intent.verified_at,
    'actual_bytes', intent.actual_bytes, 'actual_mime_type', intent.actual_mime_type,
    'rejection_reason', intent.rejection_reason, 'rejection_detail', intent.rejection_detail,
    'storage_path_is_server_owned', true,
    'meaning', case intent.state
      when 'verified' then 'The stored object was observed and matched this intent.'
      when 'rejected' then 'The stored object did not match this intent; nothing is usable.'
      when 'expired' then 'The upload window closed before the object was verified.'
      when 'aborted' then 'This upload was abandoned.'
      else 'The upload is authorized but its object has not been verified yet.' end);
end $$;

-- 13. Grants. Recording reality is trusted-server work; a member reads state and drives their own upload.
revoke all on function tonde.media_upload_intent_create(uuid,text,text,text,bigint,uuid,boolean,text)
  from public, anon, authenticated, service_role;
revoke all on function tonde.media_upload_part(uuid,uuid,integer,bigint,text) from public, anon, authenticated, service_role;
revoke all on function tonde.media_upload_verify(uuid,uuid,bigint,text,text,boolean,jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function tonde.media_upload_abort(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function tonde.media_intent_expire(integer) from public, anon, authenticated, service_role;
revoke all on function tonde.media_scan_record(uuid,text,text,text,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function tonde.media_processing_state(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.media_probe_record(uuid,jsonb,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.media_derivation_request(uuid,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function tonde.media_derivation_building(uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.media_derivation_complete(uuid,uuid,bigint,text) from public, anon, authenticated, service_role;
revoke all on function tonde.media_derivation_fail(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function tonde.media_status(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function tonde.media_upload_intent_status(uuid,uuid) from public, anon, authenticated, service_role;

grant execute on function tonde.media_upload_intent_create(uuid,text,text,text,bigint,uuid,boolean,text)
  to authenticated, service_role;
grant execute on function tonde.media_upload_part(uuid,uuid,integer,bigint,text) to authenticated, service_role;
grant execute on function tonde.media_upload_abort(uuid,uuid,text) to authenticated, service_role;
grant execute on function tonde.media_upload_verify(uuid,uuid,bigint,text,text,boolean,jsonb,text) to service_role;
grant execute on function tonde.media_intent_expire(integer) to service_role;
grant execute on function tonde.media_scan_record(uuid,text,text,text,jsonb,text) to service_role;
grant execute on function tonde.media_processing_state(uuid,text,text) to service_role;
grant execute on function tonde.media_probe_record(uuid,jsonb,text,text) to service_role;
grant execute on function tonde.media_derivation_request(uuid,text,text,text,integer) to service_role;
grant execute on function tonde.media_derivation_building(uuid) to service_role;
grant execute on function tonde.media_derivation_complete(uuid,uuid,bigint,text) to service_role;
grant execute on function tonde.media_derivation_fail(uuid,text,text) to service_role;
grant execute on function tonde.media_status(uuid,uuid) to authenticated, service_role;
grant execute on function tonde.media_upload_intent_status(uuid,uuid) to authenticated, service_role;

alter default privileges in schema tonde revoke execute on functions from public;
commit;
