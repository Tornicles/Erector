select kind, name, case when present then 'OK' else 'MISSING' end as result
from (
  select 'table' as kind, n as name, to_regclass('tonde.' || n) is not null as present
  from unnest(array['ai_providers','ai_model_profiles','ai_provider_connections',
                    'ai_shot_references','ai_continuity_locks','ai_cost_confirmations',
                    'ai_generation_attempts','ai_generation_batches','ai_generation_batch_items']) as n
  union all
  select 'enum', n, to_regtype('tonde.' || n) is not null
  from unnest(array['ai_capability_state','ai_operation','ai_connection_state','ai_readiness',
                    'ai_attempt_status','ai_attempt_mode','ai_lock_scope','ai_continuity_priority',
                    'ai_reference_role','ai_batch_scope','ai_batch_state','ai_batch_item_state']) as n
  union all
  select 'column', 'tonde.execution_plans.' || c,
         exists (select 1 from information_schema.columns
                 where table_schema = 'tonde' and table_name = 'execution_plans' and column_name = c)
  from unnest(array['prompt_version','source_shot_revision','source_versions','canonical_prompt',
                    'provider_prompt','provider_prompt_edited','provider_prompt_edited_at',
                    'provider_target','model_profile_id','fallback_model_profile_id','routing',
                    'first_frame','last_frame','motion','audio','continuity','hybrid',
                    'negative_constraints','limitations','aspect_ratio','cost_state','cost_amount',
                    'cost_currency','cost_note','model_version']) as c
  union all
  select 'rls_enabled', n, coalesce((select relrowsecurity from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'tonde' and c.relname = n), false)
  from unnest(array['ai_providers','ai_model_profiles','ai_provider_connections','ai_shot_references',
                    'ai_continuity_locks','ai_cost_confirmations','ai_generation_attempts',
                    'ai_generation_batches','ai_generation_batch_items']) as n
  union all
  select 'index', n, exists(select 1 from pg_indexes where schemaname = 'tonde' and indexname = n)
  from unnest(array['ai_generation_attempts_selected','ai_generation_attempts_in_flight',
                    'ai_model_profiles_workspace_key','ai_continuity_locks_by_scope']) as n
  union all
  select 'rpc', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde.ai_creation_surface(uuid,uuid,integer)',
    'tonde.ai_shot_detail(uuid,uuid,uuid)',
    'tonde.ai_model_catalog(uuid)',
    'tonde.ai_capability_verdict(uuid,uuid,uuid,uuid)',
    'tonde.declare_ai_model(uuid,jsonb,integer)',
    'tonde.set_ai_connection(uuid,text,text,text,text,integer)',
    'tonde.save_ai_plan(uuid,uuid,uuid,integer,jsonb,jsonb,integer)',
    'tonde.set_ai_plan_approval(uuid,uuid,uuid,text,integer)',
    'tonde.set_ai_plan_lock(uuid,uuid,uuid,boolean,integer)',
    'tonde.confirm_ai_cost(uuid,uuid,uuid,text)',
    'tonde.set_ai_lock(uuid,uuid,jsonb,integer)',
    'tonde.create_ai_attempt(uuid,uuid,uuid,jsonb)',
    'tonde.update_ai_attempt(uuid,uuid,uuid,uuid,jsonb)',
    'tonde.select_ai_result(uuid,uuid,uuid,uuid)',
    'tonde.ai_batch_preview(uuid,uuid,uuid,jsonb)',
    'tonde.create_ai_batch(uuid,uuid,uuid,jsonb)',
    'tonde.record_ai_batch_item(uuid,uuid,uuid,uuid,jsonb)']) as s
  union all
  select 'private_helper', s, to_regprocedure(s) is not null
  from unnest(array[
    'tonde_private.ai_connection(uuid,text)',
    'tonde_private.ai_readiness_state(uuid,uuid,uuid)',
    'tonde_private.ai_capability_check(uuid,uuid,uuid,uuid)',
    'tonde_private.ai_plan_document(uuid,uuid,uuid)',
    'tonde_private.ai_locks_document(uuid,uuid)',
    'tonde_private.ai_selected_attempt(uuid,uuid)',
    'tonde_private.ai_shot_rollup(uuid,uuid)',
    'tonde_private.ai_batch_candidates(uuid,uuid,uuid,jsonb)',
    'tonde_private.ai_batch_refresh(uuid,uuid)',
    'tonde_private.ai_primary_operation(uuid,uuid,uuid)']) as s
  union all
  select 'provider_catalog', p, exists(select 1 from tonde.ai_providers where key = p)
  from unnest(array['manual','runway','kling','veo','sora','midjourney','flux','elevenlabs']) as p
) checks
order by result, kind, name;

-- Every row above must read OK. Any MISSING row means 08_202610050017_ai_creation.sql did
-- not apply: fix the reported error and re-run only that file. Do not re-run 009-016.
