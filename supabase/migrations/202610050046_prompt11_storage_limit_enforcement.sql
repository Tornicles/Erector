begin;

-- Store the MIME allowlist for each protected bucket from the shared media contract. The per-bucket
-- byte ceiling is intentionally preserved: the hosted project currently caps these at 50 MiB.
update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','image/gif','image/tiff','image/heic',
  'video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav','audio/mp4','audio/aac','audio/flac',
  'application/pdf','text/plain','text/vtt','application/x-subrip','application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/zip'
] where id in ('tonde-asset-references','tonde-production-media');
update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','image/gif','image/tiff','image/heic',
  'video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav','audio/mp4','audio/aac','audio/flac'
] where id = 'tonde-results';
update storage.buckets set allowed_mime_types = array[
  'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip','application/json','text/plain'
] where id = 'tonde-exports';

-- Storage bucket limits, not the broader logical media ceilings, are the hard ceiling for an
-- upload. Derive the creator-facing per-purpose limits from the deployed bucket configuration so
-- API clients and the intent-creation RPC publish/enforce the same limit.
create or replace function tonde.media_upload_limits() returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
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
      'note', 'The upload intent carries the ceiling that applies to this configured Storage bucket. A client never chooses the bucket or the object key.') as value
  ), bucket_purposes as (
    select item.value, item.ordinality,
      case item.value ->> 'purpose'
        when 'result' then 'tonde-results'
        when 'export_artifact' then 'tonde-exports'
        when 'attachment' then 'tonde-production-media'
        else 'tonde-asset-references' end as bucket_id
    from base cross join lateral jsonb_array_elements(base.value -> 'purposes') with ordinality as item(value, ordinality)
  ), normalized_purposes as (
    select item.ordinality,
      jsonb_set(
      jsonb_set(item.value, '{max_bytes}', to_jsonb(case
        when bucket.id is null or bucket.file_size_limit is null then 0
        else least((item.value ->> 'max_bytes')::bigint, bucket.file_size_limit) end)),
        '{supported_mime_types}',
        coalesce((
          select jsonb_agg(supported.mime order by supported.mime)
          from jsonb_array_elements_text(base.value -> 'supported_mime_types') as supported(mime)
          where bucket.id is not null
            and (bucket.allowed_mime_types is null or supported.mime = any(bucket.allowed_mime_types))
        ), '[]'::jsonb)
      ) as value
    from bucket_purposes item
    cross join base
    left join storage.buckets as bucket on bucket.id = item.bucket_id
  ), purposes as (
    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) as value
    from normalized_purposes
  ), supported_mimes as (
    select coalesce(jsonb_agg(distinct mime order by mime), '[]'::jsonb) as value
    from normalized_purposes,
      lateral jsonb_array_elements_text(normalized_purposes.value -> 'supported_mime_types') as supported(mime)
  )
  select jsonb_set(jsonb_set(base.value, '{purposes}', purposes.value, true),
    '{supported_mime_types}', supported_mimes.value, true)
  from base cross join purposes cross join supported_mimes;
$$;
revoke all on function tonde.media_upload_limits() from public, anon, authenticated, service_role;
grant execute on function tonde.media_upload_limits() to authenticated, service_role;

-- The caller-visible limits are not the only guard: this trigger also protects intents if a client
-- calls the RPC directly or a bucket's supported MIME list changes after application deployment.
create function tonde_private.guard_media_upload_bucket_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare bucket_limit bigint; bucket_mimes text[];
begin
  select b.file_size_limit, b.allowed_mime_types into bucket_limit, bucket_mimes
    from storage.buckets b where b.id = new.bucket;
  if not found then
    raise exception 'The Storage bucket for this upload is not configured' using errcode = '22023';
  end if;
  if bucket_limit is null then
    raise exception 'This Storage bucket has no explicit upload size limit; the deployment limit is unknown'
      using errcode = '22023';
  end if;
  if new.expected_bytes is not null and new.expected_bytes > bucket_limit then
    raise exception 'This upload exceeds the configured Storage bucket limit of % bytes', bucket_limit
      using errcode = '22023';
  end if;
  new.max_bytes := least(new.max_bytes, bucket_limit);
  if bucket_mimes is not null and new.expected_mime_type <> all(bucket_mimes) then
    raise exception 'This file type is not enabled for the configured Storage bucket' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function tonde_private.guard_media_upload_bucket_limits() from public, anon, authenticated, service_role;
create trigger guard_media_upload_bucket_limits before insert on tonde.media_upload_intents
  for each row execute function tonde_private.guard_media_upload_bucket_limits();

alter default privileges in schema tonde revoke execute on functions from public;
commit;
