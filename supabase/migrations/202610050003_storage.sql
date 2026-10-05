begin;
-- Collision is a reconciliation error, not permission to overwrite existing buckets.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('tonde-uploads','tonde-uploads',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/wav','audio/mp4','application/pdf','text/plain']),
('tonde-asset-references','tonde-asset-references',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','audio/mpeg','audio/wav','audio/mp4','application/pdf','text/plain']),
('tonde-production-media','tonde-production-media',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/wav','audio/mp4','application/pdf','text/plain']),
('tonde-results','tonde-results',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/wav','audio/mp4']),
('tonde-exports','tonde-exports',false,52428800,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/zip','application/json']),
('tonde-avatars','tonde-avatars',false,5242880,array['image/jpeg','image/png','image/webp']);

create function tonde.can_read_storage_object(target_bucket text, target_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from tonde.media_files m where m.storage_provider = 'supabase'
    and m.bucket = target_bucket and m.object_key = target_name and m.upload_state <> 'deleted'
    and (m.expires_at is null or m.expires_at > now()) and tonde.is_workspace_member(m.workspace_id));
$$;
create function tonde.can_upload_storage_object(target_bucket text, target_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from tonde.media_files m where m.storage_provider = 'supabase'
    and m.bucket = target_bucket and m.object_key = target_name and m.upload_state = 'pending'
    and m.created_by = (select auth.uid()) and tonde.can_edit_workspace(m.workspace_id)
    and target_bucket <> 'tonde-exports' and (m.expires_at is null or m.expires_at > now()));
$$;
create policy tonde_private_media_read on storage.objects for select to authenticated
  using (tonde.can_read_storage_object(bucket_id,name));
create policy tonde_private_media_insert on storage.objects for insert to authenticated
  with check (tonde.can_upload_storage_object(bucket_id,name));
-- No client overwrite/delete; logical retention and permanent deletion require privileged audited services.
revoke all on function tonde.can_read_storage_object(text,text), tonde.can_upload_storage_object(text,text) from public, anon;
grant execute on function tonde.can_read_storage_object(text,text), tonde.can_upload_storage_object(text,text) to authenticated, service_role;
commit;
