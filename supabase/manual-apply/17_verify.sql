select kind, name, case when present then 'OK' else 'MISSING' end as result from (
  select 'table' as kind, name, to_regclass(name) is not null as present
    from unnest(array['tonde.production_audio_plans','tonde.scene_audio_directions']) name
  union all
  select 'column', 'production_references.'||name, exists(select 1 from information_schema.columns
    where table_schema='tonde' and table_name='production_references' and column_name=name)
    from unnest(array['source_identity','creator_purpose','identity_revision','revision','source_identity_verified_at']) name
  union all
  select 'rpc', name, to_regprocedure(name) is not null
    from unnest(array['tonde.reference_identity_save(uuid,uuid,uuid,integer,jsonb)',
      'tonde.claim_reference_analysis_pinned(uuid,uuid,uuid,integer)',
      'tonde.audio_plan_get(uuid,uuid)','tonde.scene_audio_directions_get(uuid,uuid)',
      'tonde.audio_plan_save(uuid,uuid,integer,jsonb)',
      'tonde.scene_audio_direction_save(uuid,uuid,uuid,integer,jsonb)']) name
  union all
  select 'rls', name, coalesce((select relrowsecurity from pg_class where oid=to_regclass(name)),false)
    from unnest(array['tonde.production_audio_plans','tonde.scene_audio_directions']) name
  union all
  select 'acl', name||' authenticated only', has_function_privilege('authenticated',to_regprocedure(name),'execute')
    and not has_function_privilege('anon',to_regprocedure(name),'execute')
    and not has_function_privilege('service_role',to_regprocedure(name),'execute')
    from unnest(array['tonde.reference_identity_save(uuid,uuid,uuid,integer,jsonb)',
      'tonde.audio_plan_save(uuid,uuid,integer,jsonb)',
      'tonde.scene_audio_direction_save(uuid,uuid,uuid,integer,jsonb)']) name
) checks order by kind,name;
