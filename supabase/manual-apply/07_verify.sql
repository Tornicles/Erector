select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'column' as kind, 'tonde.execution_plans.' || c as name,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'execution_plans' and column_name = c) as present
  from unnest(array['plan_status','readiness_note','complexity','complexity_is_estimate','generated_by',
                    'source_operation_id','shot_size','camera_position','camera_height','camera_angle',
                    'framing','composition','perspective_note','movement','movement_purpose','stabilization',
                    'capture_fps','delivery_fps','shutter','aperture','iso_range','white_balance','nd_filter',
                    'exposure_note','focus_strategy','depth_of_field','lighting_intent','lighting_plan',
                    'lighting_diagram','blocking','performance','product_direction','sound_plan',
                    'microphone_plan','sync_strategy','solo_feasibility','crew_roles',
                    'environment_requirements','location_requirements','safety_notes','safety_flags',
                    'editorial_intent','setup_steps','capture_checklist','expected_duration_ms']) as c
  union all
  select 'table', n, to_regclass('tonde.' || n) is not null
  from unnest(array['real_plan_requirements','real_plan_alternatives','shot_capture_state',
                    'shot_takes','shot_deviations']) as n
  union all
  select 'enum', n, to_regtype('tonde.' || n) is not null
  from unnest(array['requirement_kind','requirement_status','epistemic','alternative_kind',
                    'capture_status','take_status']) as n
  union all
  select 'index', 'tonde.shot_takes_one_preferred', exists(select 1 from pg_indexes
    where schemaname = 'tonde' and indexname = 'shot_takes_one_preferred')
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.real_execution_surface(uuid,uuid,integer)',
    'tonde.real_shot_detail(uuid,uuid,uuid)',
    'tonde.save_real_plan(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,uuid)',
    'tonde.set_real_plan_approval(uuid,uuid,uuid,text,integer)',
    'tonde.set_real_plan_lock(uuid,uuid,uuid,boolean,integer)',
    'tonde.set_shot_capture_state(uuid,uuid,uuid,text,text,integer)',
    'tonde.save_shot_take(uuid,uuid,uuid,jsonb,integer)',
    'tonde.delete_shot_take(uuid,uuid,uuid,uuid)',
    'tonde.record_shot_deviation(uuid,uuid,uuid,jsonb)']) as s
  union all
  select 'pay_backend_private', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.real_setup_inventory(uuid)',
    'tonde_private.real_readiness_state(uuid,uuid,uuid)',
    'tonde_private.real_requirement_rollup(uuid,uuid)',
    'tonde_private.real_plan_document(uuid,uuid,uuid)',
    'tonde_private.json_text(jsonb,text,integer)',
    'tonde_private.json_text_array(jsonb,text)']) as s
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 07_202610050016_real_production.sql
-- did not apply: fix the reported error and re-run only that file. Do not re-run 009-015.
