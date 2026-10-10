select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, t as name, to_regclass('tonde.' || t) is not null as present
  from unnest(array['shot_match_reports','match_corrections']) as x(t)
  union all
  select 'enum', t, to_regtype('tonde.' || t) is not null
  from unnest(array['match_verdict','correction_state','correction_recommendation','match_origin']) as x(t)
  union all
  select 'enum_labels', 'tonde.' || labels.name, (
    select string_agg(e.enumlabel, ',' order by e.enumsortorder) = labels.expected
    from pg_enum e join pg_type ty on ty.oid = e.enumtypid join pg_namespace ns on ns.oid = ty.typnamespace
    where ns.nspname = 'tonde' and ty.typname = labels.name)
  from (values
    ('match_verdict', 'matches_intent,acceptable_variation,needs_attention,mismatch,unknown'),
    ('correction_state', 'proposed,applied,rejected'),
    ('correction_recommendation', 'none,pickup_required,regeneration_recommended,both'),
    ('match_origin', 'deterministic,creator,ai_proposal')
  ) as labels(name, expected)
  union all
  select 'column', 'tonde.shot_match_reports.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'shot_match_reports' and column_name = c)
  from unnest(array['capabilities','dimensions','summary','limitations','origin','recommendation',
                    'decision','decision_note','decided_by','decided_at']) as x(c)
  union all
  select 'column', 'tonde.shot_match_reports.' || c || ' uses the ' || t || ' enum', exists (
    select 1 from information_schema.columns where table_schema = 'tonde'
      and table_name = 'shot_match_reports' and column_name = c and udt_name = t)
  from (values ('origin','match_origin'), ('recommendation','correction_recommendation')) as e(c, t)
  union all
  select 'column', 'tonde.match_corrections.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'match_corrections' and column_name = c)
  from unnest(array['id','workspace_id','production_id','report_id','shot_id','result_id','target_object_id',
                    'target_kind','target_label','source_revision','patch','root_cause','why','affected',
                    'recommendation','continuity_finding_id','state','preview','applied_revision',
                    'applied_version_id','propagation','decided_by','decided_at','note','revision','created_by',
                    'created_at','updated_at']) as x(c)
  union all
  select 'column', 'tonde.match_corrections.state uses the correction_state enum', exists (
    select 1 from information_schema.columns where table_schema = 'tonde' and table_name = 'match_corrections'
      and column_name = 'state' and udt_name = 'correction_state')
  union all
  select 'constraint', 'a report has a workspace-scoped identity so a correction can reference it', exists (
    select 1 from pg_constraint where conname = 'shot_match_reports_workspace_identity'
      and conrelid = 'tonde.shot_match_reports'::regclass and contype = 'u')
  union all
  select 'constraint', 'a correction keeps its Production, Shot, analysis, target and finding inside the workspace', (
    select count(*) = 5 from pg_constraint c where c.conrelid = 'tonde.match_corrections'::regclass
      and c.contype = 'f' and c.confdeltype = 'r'
      and cardinality(c.conkey) = 2)
  union all
  select 'constraint', 'a correction patch is a non-empty object', exists (
    select 1 from pg_constraint where conrelid = 'tonde.match_corrections'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%jsonb_typeof(patch)%' and pg_get_constraintdef(oid) like '%{}%')
  union all
  select 'index', t, exists (select 1 from pg_indexes where schemaname = 'tonde' and indexname = t)
  from unnest(array['shot_match_reports_recent','match_corrections_by_report','match_corrections_by_shot']) as x(t)
  union all
  select 'function', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.ms_result(uuid,uuid,uuid)',
    'tonde_private.ms_dimension(text)',
    'tonde_private.ms_capabilities(uuid,uuid)',
    'tonde_private.ms_available(jsonb,text)',
    'tonde_private.ms_severity_verdict(text)',
    'tonde_private.ms_impact_weight(text)',
    'tonde_private.ms_summary(jsonb)',
    'tonde_private.ms_method(uuid,uuid,uuid,uuid)',
    'tonde.result_register(uuid,uuid,jsonb)',
    'tonde.result_list(uuid,uuid,uuid,text,integer,integer)',
    'tonde.result_detail(uuid,uuid,uuid)',
    'tonde.result_state_set(uuid,uuid,uuid,text,integer,text)',
    'tonde.match_analyze(uuid,uuid,uuid,jsonb)',
    'tonde.match_reports(uuid,uuid,uuid,uuid,integer,integer)',
    'tonde.match_report_get(uuid,uuid,uuid)',
    'tonde.match_report_decide(uuid,uuid,uuid,text,text)',
    'tonde.match_correction_propose(uuid,uuid,uuid,jsonb)',
    'tonde.match_correction_apply(uuid,uuid,uuid,integer,text,text,boolean)',
    'tonde.match_correction_reject(uuid,uuid,uuid,text)']) as x(s)
  union all
  select 'private_helper_locked', s, not exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde_private' and rp.routine_name = split_part(s, '(', 1)
      and rp.grantee in ('authenticated','anon','service_role','PUBLIC'))
  from unnest(array['ms_result','ms_dimension','ms_capabilities','ms_available','ms_severity_verdict',
                    'ms_impact_weight','ms_summary','ms_method','vb_fields']) as x(s)
  union all
  select 'public_rpc_grant', s, exists(
    select 1 from information_schema.routine_privileges rp
    where rp.specific_schema = 'tonde' and rp.routine_name = s and rp.grantee = 'authenticated')
  from unnest(array['result_register','result_list','result_detail','result_state_set','match_analyze',
                    'match_reports','match_report_get','match_report_decide','match_correction_propose',
                    'match_correction_apply','match_correction_reject']) as x(s)
  union all
  select 'security', 'tonde.match_corrections has row level security enabled', (
    select relrowsecurity from pg_class where oid = 'tonde.match_corrections'::regclass)
  union all
  select 'security', 'a correction record is readable to a workspace member', exists (
    select 1 from pg_policies where schemaname = 'tonde' and tablename = 'match_corrections'
      and policyname = 'tenant_read' and cmd = 'SELECT')
  union all
  select 'security', 'a correction record is written only through the guarded RPCs', not exists (
    select 1 from pg_policies where schemaname = 'tonde' and tablename = 'match_corrections'
      and cmd in ('INSERT','UPDATE','DELETE'))
  union all
  select 'security', 'the workspace-isolation predicate is used by the correction policy', exists (
    select 1 from pg_policies where schemaname = 'tonde' and tablename = 'match_corrections'
      and policyname = 'tenant_read' and coalesce(qual, '') like '%is_workspace_member%')
  union all
  select 'trigger', 'a correction row is guarded like every other production record', exists (
    select 1 from pg_trigger where tgrelid = 'tonde.match_corrections'::regclass
      and tgname = 'guard_mutation' and not tgisinternal)
  union all
  select 'table', 'tonde.match_corrections.workspace_id is not client-writable', (
    select count(*) = 1 from information_schema.role_table_grants
    where table_schema = 'tonde' and table_name = 'match_corrections'
      and grantee = 'authenticated' and privilege_type = 'SELECT')
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 15_202610050024_results_shot_match.sql did not
-- apply: fix the reported error and re-run only that file. Do not re-run 009-023.
