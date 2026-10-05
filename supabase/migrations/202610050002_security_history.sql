begin;
-- Helpers bypass membership RLS deliberately; auth.uid() is the ONLY identity source.
create function tonde.is_workspace_member(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tonde.workspace_members m join tonde.workspaces w on w.id = m.workspace_id
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid()) and w.lifecycle = 'active');
$$;
create function tonde.can_edit_workspace(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tonde.workspace_members m join tonde.workspaces w on w.id = m.workspace_id
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
    and m.role in ('owner','admin','editor') and w.lifecycle = 'active');
$$;
create function tonde.is_workspace_admin(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tonde.workspace_members m join tonde.workspaces w on w.id = m.workspace_id
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
    and m.role in ('owner','admin') and w.lifecycle = 'active');
$$;

create function tonde_private.bootstrap_user(target_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare personal_id uuid;
begin
  -- Serialize repeated bootstrap requests from the same user, without global locks.
  perform pg_advisory_xact_lock(hashtextextended(target_user::text, 0));
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  insert into tonde.workspaces(name, owner_user_id) values ('Personal workspace', target_user)
    on conflict (owner_user_id) where kind = 'personal' do nothing;
  select id into personal_id from tonde.workspaces where owner_user_id = target_user and kind = 'personal';
  insert into tonde.workspace_members(workspace_id, user_id, role) values (personal_id, target_user, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  insert into tonde.profiles(user_id, display_name, default_workspace_id)
    select id, left(coalesce(raw_user_meta_data->>'display_name', raw_user_meta_data->>'full_name', ''), 160), personal_id
    from auth.users where id = target_user on conflict (user_id) do nothing;
  update tonde.profiles set default_workspace_id = personal_id where user_id = target_user and default_workspace_id is null;
  insert into tonde.user_preferences(user_id) values (target_user) on conflict (user_id) do nothing;
  return personal_id;
end;
$$;
create function tonde.bootstrap_workspace() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return tonde_private.bootstrap_user(auth.uid());
end;
$$;
create function tonde_private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform tonde_private.bootstrap_user(new.id);
  return new;
end;
$$;
create trigger tonde_user_created after insert on auth.users for each row execute function tonde_private.on_auth_user_created();
-- Existing users bootstrap on first TONDE sign-in; no unsolicited changes to hosted users.

create function tonde_private.guard_mutation() returns trigger
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
    and auth.uid() is not null and not tonde.is_workspace_member((new_row->>'default_workspace_id')::uuid) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  return new;
end;
$$;
-- Use JSON field access so the same guard works on heterogeneous records.

create function tonde_private.register_object() returns trigger
language plpgsql security definer set search_path = '' as $$
declare data jsonb := to_jsonb(new); prod_id uuid; object_kind text := tg_argv[0];
begin
  prod_id := case when tg_table_name = 'productions' then new.id else (data->>'production_id')::uuid end;
  insert into tonde.objects(id,workspace_id,production_id,kind) values(new.id,new.workspace_id,prod_id,object_kind);
  return new;
end;
$$;
create function tonde_private.capture_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_id uuid;
begin
  select id into parent_id from tonde.object_versions where object_id = new.id and branch_name = 'main'
    order by revision desc limit 1;
  insert into tonde.object_versions(workspace_id,object_id,revision,parent_version_id,actor_type,actor_user_id,source_action,snapshot)
    values(new.workspace_id,new.id,new.revision,parent_id,case when auth.uid() is null then 'system' else 'user' end,auth.uid(),lower(tg_op),to_jsonb(new));
  return new;
end;
$$;
create function tonde_private.record_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; event_name text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  event_name := tg_table_name || '.' || lower(tg_op);
  if tg_op = 'UPDATE' then
    if row_data ? 'lifecycle' and row_data->'lifecycle' is distinct from to_jsonb(old)->'lifecycle' then
      event_name := tg_table_name || '.' || (row_data->>'lifecycle');
    end if;
  end if;
  insert into tonde.audit_events(workspace_id,actor_user_id,event_type,object_id,object_kind,metadata)
    values((row_data->>'workspace_id')::uuid,auth.uid(),event_name,(row_data->>'id')::uuid,tg_table_name,
      jsonb_build_object('operation',tg_op));
  return coalesce(new,old);
end;
$$;

-- Polymorphic scope relationships remain validated against actual objects and production.
create function tonde_private.validate_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target tonde.objects; ref_prod uuid;
begin
  select * into target from tonde.objects where workspace_id = new.workspace_id and id = new.scope_object_id;
  if target.id is null then raise exception 'Missing scope' using errcode = '23503'; end if;
  if target.production_id is distinct from new.production_id and not coalesce((tg_table_name = 'creative_documents' and target.kind = 'series' and to_jsonb(new)->>'document_type' = 'series_bible'), false) then
    raise exception 'Scope belongs to another production' using errcode = '23514';
  end if;
  if tg_table_name = 'scope_bindings' then
    if target.kind not in ('production','act','sequence','scene','shot') then
      raise exception 'Invalid binding scope' using errcode = '23514';
    end if;
    if new.reference_id is not null then
      select production_id into ref_prod from tonde.production_references where id = new.reference_id and workspace_id = new.workspace_id;
      if ref_prod is distinct from new.production_id then raise exception 'Reference belongs to another production' using errcode = '23514'; end if;
    end if;
  end if;
  return new;
end;
$$;
-- Related records with non-hierarchy foreign keys must still stay within production.
create function tonde_private.validate_production_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare data jsonb := to_jsonb(new); field text; target_id uuid; target_prod uuid;
begin
  foreach field in array tg_argv loop
    target_id := (data->>field)::uuid;
    if target_id is not null then
      select production_id into target_prod from tonde.objects where id = target_id and workspace_id = new.workspace_id;
      if target_prod is distinct from new.production_id then raise exception 'Related object belongs to another production' using errcode = '23514'; end if;
    end if;
  end loop;
  return new;
end;
$$;
create trigger validate_document_scope before insert or update on tonde.creative_documents for each row execute function tonde_private.validate_scope();
create trigger validate_binding_scope before insert or update on tonde.scope_bindings for each row execute function tonde_private.validate_scope();
create trigger validate_thread_scope before insert or update on tonde.director_threads for each row execute function tonde_private.validate_scope();
create trigger validate_dialogue_links before insert or update on tonde.dialogue_lines for each row execute function tonde_private.validate_production_links('document_id');
create trigger validate_result_links before insert or update on tonde.results for each row execute function tonde_private.validate_production_links('reference_id','execution_plan_id');
create trigger validate_match_links before insert or update on tonde.shot_match_reports for each row execute function tonde_private.validate_production_links('result_id','corrected_plan_id');

-- Enable RLS on EVERY application table, including the private credentials table.
do $$ declare item record; begin
  for item in select schemaname, tablename from pg_tables where schemaname in ('tonde','tonde_private') loop
    execute format('alter table %I.%I enable row level security',item.schemaname,item.tablename);
  end loop;
end $$;

create policy own_profile_read on tonde.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy own_profile_update on tonde.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_preferences on tonde.user_preferences for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, update on tonde.profiles, tonde.user_preferences to authenticated;

create policy workspace_read on tonde.workspaces for select to authenticated using (tonde.is_workspace_member(id));
create policy members_read on tonde.workspace_members for select to authenticated using (tonde.is_workspace_member(workspace_id));
-- No client-side membership or workspace management: prevents self-promotion and owner removal.
grant select on tonde.workspaces, tonde.workspace_members to authenticated;

do $$ declare table_name text; begin
  foreach table_name in array array['projects','productions','series','series_collections','series_episodes','acts','sequences','scenes','shots','scene_participants','assets','production_resources','resource_compatibility','equipment_kits','kit_resources','media_files','asset_media','production_references','creative_documents','dialogue_lines','execution_plans','scope_bindings','object_dependencies','director_threads','results'] loop
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde.is_workspace_member(workspace_id))',table_name);
    execute format('create policy tenant_insert on tonde.%I for insert to authenticated with check (tonde.can_edit_workspace(workspace_id))',table_name);
    execute format('create policy tenant_update on tonde.%I for update to authenticated using (tonde.can_edit_workspace(workspace_id)) with check (tonde.can_edit_workspace(workspace_id))',table_name);
    execute format('grant select, insert, update on tonde.%I to authenticated',table_name);
    -- Hard deletion is intentionally unavailable for history-bearing entities.
    if table_name in ('scene_participants','resource_compatibility','kit_resources','asset_media','scope_bindings','object_dependencies') then
      execute format('create policy tenant_delete on tonde.%I for delete to authenticated using (tonde.can_edit_workspace(workspace_id))',table_name);
      execute format('grant delete on tonde.%I to authenticated',table_name);
    end if;
  end loop;
  foreach table_name in array array['objects','object_versions','jobs','exports','integration_connections','shot_match_reports','audit_events'] loop
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde.is_workspace_member(workspace_id))',table_name);
    execute format('grant select on tonde.%I to authenticated',table_name);
  end loop;
end $$;
create policy admin_billing on tonde.billing_accounts for select to authenticated using (tonde.is_workspace_admin(workspace_id));
create policy admin_usage on tonde.usage_events for select to authenticated using (tonde.is_workspace_admin(workspace_id));
grant select on tonde.billing_accounts, tonde.usage_events to authenticated;
create policy message_read on tonde.director_messages for select to authenticated using (tonde.is_workspace_member(workspace_id));
create policy message_user_insert on tonde.director_messages for insert to authenticated with check (
  tonde.can_edit_workspace(workspace_id) and role = 'user' and created_by = (select auth.uid())
  and structured_result is null and proposal_state is null
);
grant select, insert on tonde.director_messages to authenticated;

-- Mutation metadata guards and registry/version triggers are installed centrally.
do $$ declare item record; pair text[]; begin
  for item in select table_name from information_schema.columns where table_schema = 'tonde' and column_name = 'updated_at' loop
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()',item.table_name);
  end loop;
  foreach pair slice 1 in array array[
    ['projects','project'],['productions','production'],['series','series'],['series_collections','collection'],
    ['acts','act'],['sequences','sequence'],['scenes','scene'],['shots','shot'],['assets','asset'],
    ['production_references','reference'],['creative_documents','creative_document'],['dialogue_lines','dialogue_line'],
    ['execution_plans','execution_plan'],['results','result']
  ] loop
    execute format('create trigger a_register_object after insert on tonde.%I for each row execute function tonde_private.register_object(%L)',pair[1],pair[2]);
    if exists (select 1 from information_schema.columns where table_schema = 'tonde' and table_name = pair[1] and column_name = 'revision') then
      execute format('create trigger b_capture_revision after insert or update on tonde.%I for each row execute function tonde_private.capture_revision()',pair[1]);
    end if;
  end loop;
  foreach pair slice 1 in array array[['projects'],['productions'],['assets'],['integration_connections'],['exports'],['workspace_members']] loop
    execute format('create trigger c_audit after insert or update or delete on tonde.%I for each row execute function tonde_private.record_audit()',pair[1]);
  end loop;
end $$;

-- Atomic creation avoids orphan projects when a second browser request fails.
create function tonde.create_project_with_production(target_workspace uuid, production_title text, kind tonde.production_type default 'custom')
returns uuid language plpgsql security definer set search_path = '' as $$
declare project_id uuid; production_id uuid;
begin
  if not tonde.can_edit_workspace(target_workspace) then raise exception 'Workspace access denied' using errcode = '42501'; end if;
  insert into tonde.projects(workspace_id,title,created_by) values(target_workspace,production_title,auth.uid()) returning id into project_id;
  insert into tonde.productions(workspace_id,project_id,title,production_type,created_by)
    values(target_workspace,project_id,production_title,kind,auth.uid()) returning id into production_id;
  return production_id;
end;
$$;
-- Functions are NOT globally executable by default.
revoke all on all functions in schema tonde from public, anon, authenticated;
revoke all on all functions in schema tonde_private from public, anon, authenticated;
grant execute on function tonde.is_workspace_member(uuid), tonde.can_edit_workspace(uuid), tonde.is_workspace_admin(uuid), tonde.bootstrap_workspace(), tonde.create_project_with_production(uuid,text,tonde.production_type) to authenticated;
grant all on all tables in schema tonde to service_role;
grant usage on schema tonde_private to service_role;
grant all on all tables in schema tonde_private to service_role;
grant execute on all functions in schema tonde to service_role;
-- New migrations must explicitly grant only intended privileges, with RLS tests.
alter default privileges in schema tonde revoke execute on functions from public;
alter default privileges in schema tonde_private revoke execute on functions from public;
commit;
