begin;
create function tonde_private.guard_relationship_identity() returns trigger
language plpgsql set search_path = '' as $$
declare old_row jsonb := to_jsonb(old); new_row jsonb := to_jsonb(new); field text;
begin
  foreach field in array array['workspace_id','production_id','created_at'] loop
    if old_row ? field and new_row->field is distinct from old_row->field then
      raise exception 'Relationship ownership is immutable' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
do $$ declare entity text; begin
  foreach entity in array array['scene_participants','resource_compatibility','kit_resources','asset_media','object_dependencies'] loop
    execute format('create trigger guard_relationship_identity before update on tonde.%I for each row execute function tonde_private.guard_relationship_identity()',entity);
  end loop;
end $$;
alter table tonde.jobs add check (attempts <= max_attempts);
alter table tonde.jobs add check ((lease_owner is null) = (lease_expires_at is null));
alter table tonde.jobs add check (status <> 'running' or (started_at is not null and lease_owner is not null));
alter table tonde.jobs add check (status <> 'succeeded' or (progress = 100 and completed_at is not null));
alter table tonde.jobs add check (status not in ('failed','cancelled') or completed_at is not null);
alter table tonde.jobs add check (completed_at is null or completed_at >= created_at);
alter table tonde.exports add check (completed_at is null or generated_media_id is not null);

create function tonde_private.validate_job_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_id uuid; target_production uuid;
begin
  if new.production_id is not null then
    foreach target_id in array array[new.input_object_id,new.output_object_id] loop
      if target_id is not null then
        select production_id into target_production from tonde.objects where id = target_id;
        if target_production is not null and target_production <> new.production_id then
          raise exception 'Job input/output belongs to another production' using errcode = '23514';
        end if;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
create trigger validate_job_links before insert or update on tonde.jobs for each row execute function tonde_private.validate_job_links();
revoke all on function tonde_private.guard_relationship_identity(), tonde_private.validate_job_links() from public, anon, authenticated;
commit;
