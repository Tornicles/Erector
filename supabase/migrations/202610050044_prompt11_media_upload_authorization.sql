-- Prompt 11 repair 044: the inherited Storage INSERT policy looked only at a pending media_files
-- row, so legacy metadata inserts also authorized direct uploads while a newly created intent could
-- not transition the storage object's authorization. Require the matching creator-owned, open intent.
begin;

create or replace function tonde_private.can_upload_storage_object(target_bucket text, target_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from tonde.media_upload_intents i
    join tonde.media_files m on m.workspace_id = i.workspace_id and m.id = i.media_id
    where i.bucket = target_bucket and i.object_key = target_name
      and m.storage_provider = 'supabase' and m.bucket = target_bucket and m.object_key = target_name
      and i.created_by = (select auth.uid()) and m.created_by = (select auth.uid())
      and tonde_private.can_edit_workspace(i.workspace_id)
      and i.state in ('created','uploading','completing') and i.expires_at > now()
      and m.upload_state in ('pending','uploading') and target_bucket <> 'tonde-exports'
      and (m.expires_at is null or m.expires_at > now())
  );
$$;
revoke all on function tonde_private.can_upload_storage_object(text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde_private.can_upload_storage_object(text,text)
  to authenticated;

alter default privileges in schema tonde revoke execute on functions from public;
commit;
