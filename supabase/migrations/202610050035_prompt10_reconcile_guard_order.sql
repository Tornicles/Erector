-- 035 - publication_reconcile must decide authorization before it looks the row up.
--
-- Migration 032 defined tonde.publication_reconcile with the publication lookup first and the
-- workspace authorization second. A caller who is not a member of the target workspace therefore
-- received 'That publication does not exist in this workspace' (SQLSTATE P0002) instead of the
-- documented cross-tenant denial 42501, and PostgREST reports an unmapped P0002 as HTTP 500 - a
-- server error for what is a deterministic authorization answer, and an existence signal to a
-- caller who has no business knowing whether the row exists.
--
-- The expanded hosted acceptance runner caught exactly that after the Prompt 10 rollout:
--   FAIL cross-tenant RPC publication_reconcile denied HTTP 500 P0002
-- every other guarded TONDE function raises 42501 before it touches a tenant row, and this one now
-- does the same.
--
-- The repair is forward-only: 032 is an applied migration and is never rewritten. This file
-- re-defines the function with identical behavior, messages, security mode, search_path and ACLs;
-- only the order of the authorization decision changes. It is a targeted replace of one function,
-- not a replay of 032.

create or replace function tonde.publication_reconcile(target_workspace uuid, target_publication uuid, target_observed text,
  target_remote_resource_id text default null, target_remote_state text default '',
  target_failure_category text default null, note_text text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare publication tonde.publications; observed_state tonde.publication_state;
  source_value tonde.publication_reconciliation_source; allowed text[];
begin
  -- Authorization first: a non-member is refused as a denial and is never told whether the row
  -- exists. Everything below this block is unchanged from migration 032.
  if (select auth.role()) = 'service_role' then
    source_value := 'provider_api';
  else
    if auth.uid() is null or not tonde_private.can_edit_workspace(target_workspace) then
      raise exception 'Workspace access denied' using errcode = '42501';
    end if;
    source_value := 'manual_operator';
  end if;
  select * into publication from tonde.publications p
    where p.workspace_id = target_workspace and p.id = target_publication for update;
  if not found then raise exception 'That publication does not exist in this workspace' using errcode = 'P0002'; end if;
  if target_observed not in ('published','processing','removed','failed','unknown_remote_state') then
    raise exception 'A reconciliation observes published, processing, removed, failed or unknown_remote_state'
      using errcode = '22023';
  end if;
  allowed := case target_observed
    when 'published' then array['submitting','submitted','processing','published','unknown_remote_state']
    when 'processing' then array['submitting','submitted','unknown_remote_state']
    when 'failed' then array['submitting','submitted','processing','unknown_remote_state']
    when 'removed' then array['submitted','processing','published','unknown_remote_state']
    else array['submitting','submitted','processing','unknown_remote_state'] end;
  if not (publication.state::text = any(allowed)) then
    raise exception 'A publication in % cannot be reconciled to %', publication.state, target_observed
      using errcode = 'PT409';
  end if;
  if target_observed = 'published'
    and coalesce(btrim(target_remote_resource_id), publication.remote_resource_id) is null then
    raise exception 'A reconciliation to published records the remote resource it found' using errcode = '23514';
  end if;
  if target_observed = 'failed' and target_failure_category is null then
    target_failure_category := 'unknown';
  end if;
  observed_state := target_observed::tonde.publication_state;
  insert into tonde.publication_reconciliations(workspace_id, production_id, publication_id, observed_state,
    remote_state, remote_resource_id, source, note, actor_user_id)
  values (target_workspace, publication.production_id, target_publication, observed_state,
    left(coalesce(target_remote_state, ''), 200), nullif(btrim(target_remote_resource_id), ''), source_value,
    left(coalesce(note_text, ''), 800), auth.uid());
  update tonde.publications set state = observed_state,
    remote_resource_id = coalesce(nullif(btrim(target_remote_resource_id), ''), remote_resource_id),
    remote_state = left(coalesce(nullif(target_remote_state, ''), remote_state), 200),
    last_checked_at = now(),
    published_at = case when target_observed = 'published' then coalesce(published_at, now()) else published_at end,
    removed_at = case when target_observed = 'removed' then now() else removed_at end,
    failed_at = case when target_observed = 'failed' then now() end,
    failure_category = case when target_observed = 'failed'
      then target_failure_category::tonde.publication_failure_category end,
    failure_code = case when target_observed = 'failed' then null end,
    failure_message = case when target_observed = 'failed' then null end
  where workspace_id = target_workspace and id = target_publication;
  perform tonde_private.audit_event(target_workspace, 'publication.reconciled', target_publication, 'publication',
    jsonb_build_object('observed', target_observed, 'source', source_value,
      'remote_resource_id', coalesce(nullif(btrim(target_remote_resource_id), ''), publication.remote_resource_id)));
  return jsonb_build_object('publication_id', target_publication, 'previous_state', publication.state,
    'state', target_observed, 'source', source_value, 'remote_resource_id',
    coalesce(nullif(btrim(target_remote_resource_id), ''), publication.remote_resource_id),
    'remote_state', left(coalesce(nullif(target_remote_state, ''), publication.remote_state), 200),
    'failure_category', case when target_observed = 'failed' then target_failure_category end,
    'observed_at', now(), 'note', left(coalesce(note_text, ''), 800),
    'meaning', case target_observed
      when 'published' then 'The destination really holds this publication; published_at is when TONDE established it.'
      when 'processing' then 'The destination is still working on it.'
      when 'removed' then 'The destination no longer holds this publication.'
      when 'failed' then 'The destination has no usable copy and the cause is recorded.'
      else 'The destination state is still unconfirmed; nothing was claimed.' end);
end $$;

-- ACLs re-asserted exactly as 032 established them.
revoke all on function tonde.publication_reconcile(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.publication_reconcile(uuid,uuid,text,text,text,text,text)
  to authenticated, service_role;
