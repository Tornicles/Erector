select kind,name,case when present then 'OK' else 'MISSING' end as result from (
  select 'trigger' as kind,'production_references.b_capture_revision' as name,exists(select 1 from pg_trigger
    where tgrelid='tonde.production_references'::regclass and tgname='b_capture_revision' and not tgisinternal) as present
  union all
  select 'trigger',table_name||'.guard_enclosing_scope',exists(select 1 from pg_trigger
    where tgrelid=to_regclass('tonde.'||table_name) and tgname='guard_enclosing_scope' and not tgisinternal)
    from unnest(array['acts','sequences','scenes','shots','production_audio_plans','scene_audio_directions']) table_name
  union all
  select 'trigger','reference_findings.guard_reference_observation',exists(select 1 from pg_trigger
    where tgrelid='tonde.reference_findings'::regclass and tgname='guard_reference_observation' and not tgisinternal)
  union all
  select 'private_function',name,to_regprocedure(name) is not null
    from unnest(array['tonde_private.guard_enclosing_scope_mutation()',
      'tonde_private.guard_reference_observation()','tonde_private.pi_is_locked(uuid,uuid)']) name
) checks order by kind,name;
