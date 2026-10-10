-- Prompt 11 repair 047: verification (037) moves media to 'verified', but the Prompt 10
-- publishability gates only accepted 'uploaded', so honestly verified media could never be
-- published, previewed, or downloaded. 'verified' is strictly stronger than 'uploaded'
-- (bytes observed plus recorded checksum), so every gate now accepts both states.
begin;

-- 1. publication_create: verified media carries an observed checksum to pin.
create or replace function tonde.publication_create(target_workspace uuid, target_production uuid, target_result uuid,
  target_provider text, target_media uuid default null, target_destination text default '',
  target_account uuid default null, target_title text default '', target_caption text default '',
  target_visibility text default 'private', target_scheduled_for timestamptz default null,
  target_config jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare production tonde.productions; result_row tonde.results; media tonde.media_files;
  new_id uuid; category text;
begin
  if not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into production from tonde.productions p
    where p.workspace_id = target_workspace and p.id = target_production and p.lifecycle = 'active';
  if not found then raise exception 'That Production is not available for publishing' using errcode = 'P0002'; end if;
  select * into result_row from tonde.results r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.id = target_result;
  if not found then raise exception 'That Result is not available in this Production' using errcode = 'P0002'; end if;
  select * into media from tonde.media_files m
    where m.workspace_id = target_workspace and m.id = coalesce(target_media, result_row.media_id);
  if not found then raise exception 'That media file is not available in this workspace' using errcode = 'P0002'; end if;
  if media.upload_state not in ('uploaded','verified') then
    raise exception 'Only an uploaded or verified media file can be published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from tonde.integration_providers p where p.key = target_provider) then
    raise exception 'That destination provider is not registered' using errcode = '22023';
  end if;
  if target_account is not null and not exists (select 1 from tonde.integration_connections c
    where c.workspace_id = target_workspace and c.id = target_account and c.provider = target_provider) then
    raise exception 'That destination account is not connected to this provider' using errcode = '22023';
  end if;
  if target_visibility not in ('private','unlisted','public','scheduled') then
    raise exception 'Visibility is private, unlisted, public or scheduled' using errcode = '22023';
  end if;
  if target_visibility = 'scheduled' and (target_scheduled_for is null or target_scheduled_for <= now()) then
    raise exception 'A scheduled publication needs a future time' using errcode = '22023';
  end if;
  if target_visibility <> 'scheduled' and target_scheduled_for is not null then
    raise exception 'Only a scheduled publication carries a scheduled time' using errcode = '22023';
  end if;
  category := case media.file_category when 'video' then 'video' when 'image' then 'image'
    when 'audio' then 'audio' else 'document' end;
  insert into tonde.publications(workspace_id, production_id, production_revision, result_id, result_revision,
    media_id, media_checksum, destination_provider, destination_account_id, destination, destination_config,
    media_type, visibility, scheduled_for, title, caption, created_by)
  values (target_workspace, target_production, production.revision, target_result, result_row.revision,
    media.id, coalesce(media.checksum, ''), target_provider, target_account,
    left(coalesce(target_destination, ''), 300), coalesce(target_config, '{}'::jsonb),
    category, target_visibility, target_scheduled_for,
    left(coalesce(target_title, ''), 300), left(coalesce(target_caption, ''), 5000), auth.uid())
  returning id into new_id;
  return jsonb_build_object('publication_id', new_id, 'state', 'draft',
    'production_id', target_production, 'production_revision', production.revision,
    'result_id', target_result, 'result_revision', result_row.revision,
    'media_id', media.id, 'media_checksum', coalesce(media.checksum, ''),
    'destination_provider', target_provider, 'destination_account_id', target_account,
    'destination', left(coalesce(target_destination, ''), 300),
    'visibility', target_visibility, 'scheduled_for', target_scheduled_for,
    'created_by', auth.uid(), 'created_at', now(),
    'note', 'Nothing was submitted. A creator must mark this ready and authorize this exact version and destination.');
end $$;

-- 2. publication_preview: thumbnail lookup and availability block.
create or replace function tonde.publication_preview(target_workspace uuid, target_publication uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare publication tonde.publications; production tonde.productions; result_row tonde.results;
  media tonde.media_files; provider tonde.integration_providers; connection tonde.integration_connections;
  authorization_row tonde.publication_authorizations; capability_row tonde.integration_provider_capabilities;
  capability text; account_label text := ''; fingerprint text; thumbnail uuid;
  missing text[]; blocked text[] := '{}';
begin
  if not tonde_private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  select * into production from tonde.productions p
    where p.workspace_id = target_workspace and p.id = publication.production_id;
  select * into result_row from tonde.results r
    where r.workspace_id = target_workspace and r.id = publication.result_id;
  select * into media from tonde.media_files m
    where m.workspace_id = target_workspace and m.id = publication.media_id;
  select id into thumbnail from tonde.media_files m
    where m.workspace_id = target_workspace and m.derived_from_id = publication.media_id
      and m.file_category = 'thumbnail' and m.upload_state in ('uploaded','verified') limit 1;
  select * into provider from tonde.integration_providers p where p.key = publication.destination_provider;
  select * into capability_row from tonde.integration_provider_capabilities c
    where c.provider_key = publication.destination_provider and c.capability_key = 'publish';
  if publication.destination_account_id is not null then
    select * into connection from tonde.integration_connections c
      where c.workspace_id = target_workspace and c.id = publication.destination_account_id;
    account_label := coalesce(connection.external_account_label, '');
  end if;
  select * into authorization_row from tonde.publication_authorizations a
    where a.id = publication.authorization_id;
  capability := tonde_private.integration_capability_reason(target_workspace,
    publication.destination_provider, 'publish');
  fingerprint := tonde_private.publication_fingerprint(target_workspace, target_publication);
  missing := case when connection.id is null or capability_row.provider_key is null then '{}'::text[]
    else array(select s from unnest(capability_row.required_scopes) s
      where not (s = any(coalesce(connection.scopes, '{}')))) end;
  if production.id is null or production.lifecycle <> 'active' then
    blocked := array_append(blocked, 'PRODUCTION_INACTIVE');
  end if;
  if result_row.id is null then
    blocked := array_append(blocked, 'RESULT_MISSING');
  elsif result_row.revision <> publication.result_revision or result_row.media_id <> publication.media_id then
    blocked := array_append(blocked, 'RESULT_CHANGED_SINCE_PINNED');
  end if;
  if media.id is null or media.upload_state not in ('uploaded','verified') then
    blocked := array_append(blocked, 'MEDIA_NOT_AVAILABLE');
  end if;
  if provider.key is null then blocked := array_append(blocked, 'UNKNOWN_PROVIDER'); end if;
  if capability <> 'AVAILABLE' then blocked := array_append(blocked, 'CAPABILITY_UNAVAILABLE'); end if;
  if array_length(missing, 1) is not null then blocked := array_append(blocked, 'MISSING_SCOPE'); end if;
  if authorization_row.id is null or authorization_row.decision <> 'authorize' then
    blocked := array_append(blocked, 'AUTHORIZATION_REQUIRED');
  elsif authorization_row.request_fingerprint <> fingerprint
    or authorization_row.production_revision <> publication.production_revision
    or authorization_row.result_revision <> publication.result_revision
    or authorization_row.media_id <> publication.media_id
    or authorization_row.media_checksum <> publication.media_checksum
    or authorization_row.destination_provider <> publication.destination_provider
    or authorization_row.destination_account_id is distinct from publication.destination_account_id
    or authorization_row.destination <> publication.destination then
    blocked := array_append(blocked, 'AUTHORIZATION_STALE');
  end if;
  if publication.state <> 'ready' then
    blocked := array_append(blocked, 'STATE_' || upper(publication.state::text));
  end if;
  return jsonb_build_object('publication_id', target_publication, 'state', publication.state,
    'production', jsonb_build_object('id', publication.production_id, 'title', production.title,
      'pinned_revision', publication.production_revision, 'current_revision', production.revision),
    'result', jsonb_build_object('id', publication.result_id, 'state', result_row.state,
      'approval', result_row.approval, 'pinned_revision', publication.result_revision,
      'current_revision', result_row.revision),
    'media', jsonb_build_object('id', publication.media_id, 'media_type', publication.media_type,
      'mime_type', media.mime_type, 'bytes', media.bytes, 'pinned_checksum', publication.media_checksum,
      'current_checksum', media.checksum, 'upload_state', media.upload_state,
      'thumbnail_media_id', thumbnail),
    'destination', jsonb_build_object('provider', publication.destination_provider,
      'provider_name', provider.name, 'account_id', publication.destination_account_id,
      'account_label', account_label, 'target', publication.destination,
      'visibility', publication.visibility, 'scheduled_for', publication.scheduled_for),
    'content', jsonb_build_object('title', publication.title, 'caption', publication.caption,
      'settings', publication.destination_config, 'fingerprint', fingerprint),
    'provider_constraints', coalesce(provider.restrictions, '{}'::jsonb),
    'capability', capability, 'missing_scopes', coalesce(missing, '{}'),
    'authorization', jsonb_build_object('authorization_id', publication.authorization_id,
      'decision', authorization_row.decision, 'actor_user_id', authorization_row.actor_user_id,
      'authorized_at', authorization_row.authorized_at),
    'retry_safety', tonde.publication_retry_safety(target_workspace, target_publication),
    'can_submit', array_length(blocked, 1) is null, 'blocked_by', blocked,
    'note', case when array_length(blocked, 1) is null
      then 'Everything this publication needs is present; a creator action may submit it.'
      else 'This publication cannot be submitted yet; blocked_by lists every reason.' end);
end $$;

-- 3. guard_export trigger: a ready export may name a verified artifact.
create or replace function tonde_private.guard_export() returns trigger
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
    or artifact.upload_state not in ('uploaded','verified') then
    raise exception 'A ready export names an uploaded or verified export artifact in the private exports bucket'
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

-- 4. export_download: verified export files remain downloadable.
create or replace function tonde.export_download(target_workspace uuid, target_export uuid) returns jsonb
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
      and m.upload_state in ('uploaded','verified') and m.file_category = 'export';
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

commit;
