select kind,name,case when present then 'OK' else 'MISSING' end as result from (
  select 'rpc' as kind,'tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)' as name,
    to_regprocedure('tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)') is not null as present
  union all
  select 'completion_pin','save_reference_analysis verifies original worker revision',
    coalesce((select position('analysis->>''identity_revision''' in prosrc)>0
      and position('identity revision changed before analysis completion' in prosrc)>0
      and position('40001' in prosrc)>0 from pg_proc
      where oid=to_regprocedure('tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)')),false)
  union all
  select 'acl','save_reference_analysis authenticated only',
    has_function_privilege('authenticated','tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)','execute')
    and not has_function_privilege('anon','tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)','execute')
    and not has_function_privilege('service_role','tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)','execute')
) checks order by kind,name;
