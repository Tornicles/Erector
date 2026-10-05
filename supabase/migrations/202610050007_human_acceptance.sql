begin;
create function tonde_private.guard_human_acceptance() returns trigger
language plpgsql set search_path = '' as $$
declare old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  new_row jsonb := to_jsonb(new); accepting boolean := false;
begin
  accepting := (new_row->>'approval' = 'approved' and old_row->>'approval' is distinct from 'approved')
    or (tg_table_name = 'results' and new_row->>'state' in ('approved','final') and old_row->>'state' is distinct from new_row->>'state');
  if accepting and (auth.uid() is null or current_user = 'service_role' or not tonde.can_edit_workspace((new_row->>'workspace_id')::uuid)) then
    raise exception 'Approval requires an authenticated creator decision' using errcode = '42501';
  end if;
  -- A combined content-change + approval request does not approve unseen work.
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
do $$ declare entity text; begin
  for entity in select table_name from information_schema.columns where table_schema='tonde' and column_name='approval' loop
    execute format('create trigger a_human_acceptance before insert or update on tonde.%I for each row execute function tonde_private.guard_human_acceptance()',entity);
  end loop;
end $$;
revoke all on function tonde_private.guard_human_acceptance() from public, anon, authenticated;
commit;
