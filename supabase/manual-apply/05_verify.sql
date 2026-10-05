select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, n as name, to_regclass(n) is not null as present
  from unnest(array[
    'tonde.director_intakes', 'tonde.director_plan_proposals', 'tonde.director_operations',
    'tonde.director_briefs', 'tonde.director_decisions', 'tonde.reference_analyses',
    'tonde.reference_findings', 'tonde.creative_techniques', 'tonde.reference_technique_links',
    'tonde.creative_stories', 'tonde.director_reality_checks']) as n
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.save_director_intake(uuid,uuid,integer,jsonb)',
    'tonde.save_director_plan_proposal(uuid,uuid,integer,integer,uuid,jsonb)',
    'tonde.apply_director_plan(uuid,uuid,integer,integer,uuid,boolean)',
    'tonde.record_director_operation(uuid,uuid,jsonb)',
    'tonde.save_director_brief(uuid,uuid,integer,jsonb,uuid,text)',
    'tonde.record_director_decisions(uuid,uuid,jsonb,text)',
    'tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)',
    'tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text)',
    'tonde.apply_director_operation(uuid,uuid,integer,uuid,text,jsonb,boolean)']) as s
  union all
  select 'pay_backend_private', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.director_guard(uuid)',
    'tonde_private.director_apply_assets(uuid,uuid,uuid,jsonb)']) as s
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means the matching file in this folder
-- did not apply: fix the reported error and re-run only that file.
