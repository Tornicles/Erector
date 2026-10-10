-- Additive migration: team workspace invitations via single-use links.
--
-- There is no email delivery in this deployment, so an invitation is a
-- single-use token link the owner/admin shares manually. The raw token is
-- shown once at creation; only its SHA-256 hash is stored. All writes pass
-- through the guarded RPCs below, which run as SECURITY DEFINER and re-check
-- owner/admin authority on every call. No grants on the table itself are
-- given to authenticated users, so invite hashes are never client-readable.
-- The invites table is deliberately excluded from the audit trigger: audit
-- rows would persist token hashes alongside history.
begin;
create table tonde.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete cascade,
  role tonde.member_role not null check (role in ('admin', 'editor', 'viewer')),
  token_hash text not null unique check (token_hash <> ''),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_user_id is null))
);
create index workspace_invites_by_workspace on tonde.workspace_invites(workspace_id);
alter table tonde.workspace_invites enable row level security;
-- Owner/admin read of invite records for the manage view. Creation,
-- revocation and acceptance go through the guarded RPCs, never RLS writes.
create policy invites_admin_read on tonde.workspace_invites for select to authenticated
  using (tonde_private.is_workspace_admin(workspace_id));
grant select on tonde.workspace_invites to authenticated;
create function tonde.create_workspace_invite(target_workspace uuid, invite_role tonde.member_role,
  token_hash text, expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invite_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception sqlstate '42501' using message = 'Sign in to continue.';
  end if;
  if not tonde_private.is_workspace_admin(target_workspace) then
    raise exception sqlstate '42501' using message = 'Only a workspace owner or administrator can invite.';
  end if;
  if invite_role not in ('admin', 'editor', 'viewer') then
    raise exception sqlstate '22023' using message = 'Invites grant admin, editor, or viewer. Ownership is never granted by invite.';
  end if;
  if token_hash is null or token_hash !~ '^[0-9a-f]{64}$' then
    raise exception sqlstate '22023' using message = 'The invite credential is malformed.';
  end if;
  if expires_at is null or expires_at <= now() + interval '1 hour' or expires_at > now() + interval '30 days' then
    raise exception sqlstate '22023' using message = 'An invite lasts between one hour and thirty days.';
  end if;
  insert into tonde.workspace_invites(workspace_id, role, token_hash, created_by, expires_at)
    values (target_workspace, invite_role, token_hash, (select auth.uid()), expires_at)
    returning id into invite_id;
  return invite_id;
end;
$$;
create function tonde.revoke_workspace_invite(invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare invite_workspace uuid;
begin
  if (select auth.uid()) is null then
    raise exception sqlstate '42501' using message = 'Sign in to continue.';
  end if;
  select workspace_id into invite_workspace from tonde.workspace_invites where id = invite_id;
  if not found then
    raise exception sqlstate 'P0002' using message = 'That invite does not exist.';
  end if;
  if not tonde_private.is_workspace_admin(invite_workspace) then
    raise exception sqlstate '42501' using message = 'Only a workspace owner or administrator can revoke invites.';
  end if;
  update tonde.workspace_invites set revoked_at = now(), updated_at = now()
    where id = invite_id and revoked_at is null and accepted_at is null;
end;
$$;
create function tonde.accept_workspace_invite(p_token_hash text)
returns table(workspace_id uuid, role tonde.member_role)
language plpgsql security definer set search_path = '' as $$
declare invite_row tonde.workspace_invites%rowtype;
declare caller uuid;
begin
  caller := (select auth.uid());
  if caller is null then
    raise exception sqlstate '42501' using message = 'Sign in to accept this invite.';
  end if;
  select * into invite_row from tonde.workspace_invites
    where token_hash = p_token_hash
    for update;
  if not found or invite_row.revoked_at is not null
    or invite_row.accepted_at is not null or invite_row.expires_at <= now() then
    raise exception sqlstate 'PT409' using message = 'This invite link is invalid, expired, revoked, or already used.';
  end if;
  if not exists (select 1 from tonde.workspaces w
    where w.id = invite_row.workspace_id and w.lifecycle = 'active') then
    raise exception sqlstate 'PT409' using message = 'That workspace is no longer active.';
  end if;
  if exists (select 1 from tonde.workspace_members m
    where m.workspace_id = invite_row.workspace_id and m.user_id = caller) then
    raise exception sqlstate 'PT409' using message = 'You are already a member of this workspace.';
  end if;
  insert into tonde.workspace_members(workspace_id, user_id, role)
    values (invite_row.workspace_id, caller, invite_row.role);
  update tonde.workspace_invites set accepted_at = now(), accepted_user_id = caller, updated_at = now()
    where id = invite_row.id;
  workspace_id := invite_row.workspace_id;
  role := invite_row.role;
  return next;
end;
$$;
grant execute on function tonde.create_workspace_invite(uuid, tonde.member_role, text, timestamptz),
  tonde.revoke_workspace_invite(uuid),
  tonde.accept_workspace_invite(text) to authenticated;
commit;
