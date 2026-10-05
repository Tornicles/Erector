-- These SECURITY DEFINER helpers are required by RLS and private Storage
-- policies, but are not user-facing RPCs. Move them out of the exposed API.
begin;
grant usage on schema tonde_private to authenticated;

-- Move routines without rewriting dependency expressions, then recreate every
-- policy/function whose SQL text referred to the old exposed names.
alter function tonde.is_workspace_member(uuid) set schema tonde_private;
alter function tonde.can_edit_workspace(uuid) set schema tonde_private;
alter function tonde.is_workspace_admin(uuid) set schema tonde_private;
alter function tonde.can_read_storage_object(text, text) set schema tonde_private;
alter function tonde.can_upload_storage_object(text, text) set schema tonde_private;

revoke all on function tonde_private.is_workspace_member(uuid),
  tonde_private.can_edit_workspace(uuid), tonde_private.is_workspace_admin(uuid),
  tonde_private.can_read_storage_object(text, text),
  tonde_private.can_upload_storage_object(text, text)
  from public, anon, authenticated, service_role;
grant execute on function tonde_private.is_workspace_member(uuid),
  tonde_private.can_edit_workspace(uuid), tonde_private.is_workspace_admin(uuid),
  tonde_private.can_read_storage_object(text, text),
  tonde_private.can_upload_storage_object(text, text)
  to authenticated;

-- Membership-check functions are stored as SQL expressions by Postgres and
-- keep the old qualified name after ALTER FUNCTION SET SCHEMA.
do $$
declare policy_row record; rewritten_qual text; rewritten_check text;
begin
  for policy_row in
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
    where (schemaname = 'tonde' and (
      coalesce(qual, '') like '%tonde.is_workspace_member(%'
      or coalesce(qual, '') like '%tonde.can_edit_workspace(%'
      or coalesce(qual, '') like '%tonde.is_workspace_admin(%'
      or coalesce(with_check, '') like '%tonde.is_workspace_member(%'
      or coalesce(with_check, '') like '%tonde.can_edit_workspace(%'
      or coalesce(with_check, '') like '%tonde.is_workspace_admin(%'
    )) or (schemaname = 'storage' and (
      coalesce(qual, '') like '%tonde.can_read_storage_object(%'
      or coalesce(with_check, '') like '%tonde.can_upload_storage_object(%'
    ))
  loop
    rewritten_qual := policy_row.qual;
    rewritten_check := policy_row.with_check;
    if rewritten_qual is not null then
      rewritten_qual := replace(replace(replace(rewritten_qual,
        'tonde.is_workspace_member(', 'tonde_private.is_workspace_member('),
        'tonde.can_edit_workspace(', 'tonde_private.can_edit_workspace('),
        'tonde.is_workspace_admin(', 'tonde_private.is_workspace_admin(');
      rewritten_qual := replace(rewritten_qual, 'tonde.can_read_storage_object(', 'tonde_private.can_read_storage_object(');
    end if;
    if rewritten_check is not null then
      rewritten_check := replace(replace(replace(rewritten_check,
        'tonde.is_workspace_member(', 'tonde_private.is_workspace_member('),
        'tonde.can_edit_workspace(', 'tonde_private.can_edit_workspace('),
        'tonde.is_workspace_admin(', 'tonde_private.is_workspace_admin(');
      rewritten_check := replace(rewritten_check, 'tonde.can_upload_storage_object(', 'tonde_private.can_upload_storage_object(');
    end if;
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    execute format('create policy %I on %I.%I as permissive for %s to %s%s%s',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename, policy_row.cmd,
      array_to_string(policy_row.roles, ', '),
      case when rewritten_qual is not null then ' using (' || rewritten_qual || ')' else '' end,
      case when rewritten_check is not null then ' with check (' || rewritten_check || ')' else '' end);
  end loop;
end
$$;

create or replace function tonde_private.can_read_storage_object(target_bucket text, target_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from tonde.media_files m where m.storage_provider = 'supabase'
    and m.bucket = target_bucket and m.object_key = target_name and m.upload_state <> 'deleted'
    and (m.expires_at is null or m.expires_at > now())
    and tonde_private.is_workspace_member(m.workspace_id));
$$;
create or replace function tonde_private.can_upload_storage_object(target_bucket text, target_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from tonde.media_files m where m.storage_provider = 'supabase'
    and m.bucket = target_bucket and m.object_key = target_name and m.upload_state = 'pending'
    and m.created_by = (select auth.uid()) and tonde_private.can_edit_workspace(m.workspace_id)
    and target_bucket <> 'tonde-exports' and (m.expires_at is null or m.expires_at > now()));
$$;
create or replace function tonde_private.guard_mutation() returns trigger
language plpgsql set search_path = '' as $$
declare old_row jsonb; new_row jsonb; field text;
begin
  new_row := to_jsonb(new);
  if tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    foreach field in array array['id','workspace_id','production_id','created_by','created_at','user_id','owner_user_id'] loop
      if old_row ? field and new_row->field is distinct from old_row->field then
        raise exception 'Identity and ownership are immutable' using errcode = '23514';
      end if;
    end loop;
    if old_row ? 'locked_at' and old_row->>'locked_at' is not null
      and (new_row - array['locked_at','updated_at','revision','approval']) is distinct from (old_row - array['locked_at','updated_at','revision','approval']) then
      raise exception 'Unlock this object before editing' using errcode = '23514';
    end if;
    if old_row ? 'revision' then
      if (new_row->>'revision')::integer <> (old_row->>'revision')::integer then
        raise exception 'Revision is managed by the database' using errcode = '23514';
      end if;
      new := jsonb_populate_record(new, jsonb_build_object('revision', (old_row->>'revision')::integer + 1));
      if old_row->>'approval' = 'approved'
        and (new_row - array['approval','locked_at','updated_at','revision']) is distinct from (old_row - array['approval','locked_at','updated_at','revision']) then
        new := jsonb_populate_record(new, jsonb_build_object('approval','changed_after_approval'));
      end if;
    end if;
  elsif new_row ? 'revision' and (new_row->>'revision')::integer <> 1 then
    raise exception 'Initial revision must be one' using errcode = '23514';
  end if;
  if new_row ? 'updated_at' then new := jsonb_populate_record(new, jsonb_build_object('updated_at', now())); end if;
  if tg_op = 'INSERT' and new_row ? 'created_by' and auth.uid() is not null
    and new_row->>'created_by' is distinct from auth.uid()::text then
    raise exception 'Creator does not match authenticated user' using errcode = '42501';
  end if;
  if tg_table_name = 'profiles' and new_row->>'default_workspace_id' is not null
    and auth.uid() is not null and not tonde_private.is_workspace_member((new_row->>'default_workspace_id')::uuid) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  return new;
end;
$$;
create or replace function tonde_private.guard_human_acceptance() returns trigger
language plpgsql set search_path = '' as $$
declare old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  new_row jsonb := to_jsonb(new); accepting boolean := false;
begin
  accepting := (new_row->>'approval' = 'approved' and old_row->>'approval' is distinct from 'approved')
    or (tg_table_name = 'results' and new_row->>'state' in ('approved','final') and old_row->>'state' is distinct from new_row->>'state');
  if accepting and (auth.uid() is null or (select auth.role()) = 'service_role' or not tonde_private.can_edit_workspace((new_row->>'workspace_id')::uuid)) then
    raise exception 'Approval requires an authenticated creator decision' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and accepting and
    (new_row - array['approval','state','locked_at','updated_at','revision']) is distinct from
    (old_row - array['approval','state','locked_at','updated_at','revision']) then
    raise exception 'Review the changed version before approving it' using errcode = '23514';
  end if;
  if tg_table_name = 'results' and tg_op = 'UPDATE' and old_row->>'state' in ('approved','final') and
    (new_row - array['approval','state','locked_at','updated_at','revision']) is distinct from
    (old_row - array['approval','state','locked_at','updated_at','revision']) then
    new := jsonb_populate_record(new, jsonb_build_object('state','needs_review'));
  end if;
  return new;
end;
$$;
create or replace function tonde.create_project_with_production(target_workspace uuid, production_title text, kind tonde.production_type default 'custom')
returns uuid language plpgsql security definer set search_path = '' as $$
declare project_id uuid; production_id uuid;
begin
  if not tonde_private.can_edit_workspace(target_workspace) then raise exception 'Workspace access denied' using errcode = '42501'; end if;
  insert into tonde.projects(workspace_id,title,created_by) values(target_workspace,production_title,auth.uid()) returning id into project_id;
  insert into tonde.productions(workspace_id,project_id,title,production_type,created_by)
    values(target_workspace,project_id,production_title,kind,auth.uid()) returning id into production_id;
  return production_id;
end;
$$;

-- These are authenticated user APIs, not system/service-role entry points.
revoke execute on function tonde.bootstrap_workspace(),
  tonde.create_project_with_production(uuid, text, tonde.production_type)
  from public, anon, service_role;
grant execute on function tonde.bootstrap_workspace(),
  tonde.create_project_with_production(uuid, text, tonde.production_type)
  to authenticated;
commit;
