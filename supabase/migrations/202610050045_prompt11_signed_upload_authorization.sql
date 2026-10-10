begin;

-- Storage's signed-upload token bypasses object RLS at upload time, so minting that token must be
-- preceded by this authenticated, workspace-scoped check. It returns only the server-derived object
-- identity for an intent created by this same editor; it never reads a vault secret or creates a URL.
create function tonde.media_upload_signed_request(target_workspace uuid, target_intent uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent tonde.media_upload_intents; media tonde.media_files;
begin
  if auth.uid() is null or not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  select * into intent from tonde.media_upload_intents i
    where i.workspace_id = target_workspace and i.id = target_intent;
  if not found then
    raise exception 'That upload intent does not exist in this workspace' using errcode = 'P0002';
  end if;
  if intent.created_by is distinct from auth.uid() then
    raise exception 'Only the creator who opened this upload may receive its signed upload token'
      using errcode = '42501';
  end if;
  if intent.state not in ('created','uploading','completing') or intent.expires_at <= now() then
    raise exception 'UPLOAD_INTENT_CLOSED: this upload is no longer open' using errcode = 'PT409';
  end if;
  select * into media from tonde.media_files m
    where m.workspace_id = target_workspace and m.id = intent.media_id;
  if not found or media.created_by is distinct from auth.uid()
    or media.storage_provider <> 'supabase' or media.bucket <> intent.bucket
    or media.object_key <> intent.object_key or media.upload_state not in ('pending','uploading')
    or (media.expires_at is not null and media.expires_at <= now())
    or intent.bucket = 'tonde-exports' then
    raise exception 'The upload intent no longer authorizes this Storage object' using errcode = 'PT409';
  end if;
  return jsonb_build_object('workspace_id', target_workspace, 'intent_id', intent.id,
    'media_id', media.id, 'bucket', intent.bucket, 'object_key', intent.object_key,
    'expected_mime_type', intent.expected_mime_type, 'expected_bytes', intent.expected_bytes,
    'max_bytes', intent.max_bytes, 'expires_at', intent.expires_at,
    'meaning', 'This authenticated creator may upload once to the exact object named by this open intent.');
end $$;
revoke all on function tonde.media_upload_signed_request(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.media_upload_signed_request(uuid,uuid) to authenticated;

alter default privileges in schema tonde revoke execute on functions from public;
commit;
