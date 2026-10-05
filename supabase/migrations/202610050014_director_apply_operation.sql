-- Additive migration: the atomic Director apply path for one creative bundle.
begin;

-- The operation parameter is named target_operation so it can never be ambiguous with the
-- director_operations.operation_id column inside the upsert and its conflict target.
create function tonde.apply_director_operation(
  target_workspace uuid, target_production uuid, expected_production_revision integer,
  target_operation uuid, operation_type text, bundle jsonb, explicit_confirmation boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare production_row tonde.productions;
  existing tonde.director_operations;
  plan jsonb;
  brief jsonb;
  story jsonb;
  script jsonb;
  target_duration bigint;
  scene jsonb;
  scene_index integer := 0;
  scene_count integer := 0;
  scene_total bigint := 0;
  scene_duration bigint;
  scene_order bigint := 1024;
  scene_id uuid;
  scene_ids jsonb := '{}'::jsonb;
  scene_id_text text;
  assets_result jsonb;
  character_assets jsonb := '{}'::jsonb;
  document_row tonde.creative_documents;
  document_id uuid;
  script_scene jsonb;
  line jsonb;
  script_scene_index integer := 0;
  line_order bigint;
  dialogue_count integer := 0;
  speaker_id uuid;
  item jsonb;
  production_revision_out integer;
  bundle_hash text := md5(bundle::text);
  brief_content text;
  story_content text;
  script_content text;
  producer_kind text;
begin
  perform tonde_private.director_guard(target_workspace);
  if explicit_confirmation is not true then
    raise exception 'Creator confirmation is required to apply this Director operation' using errcode = '42501';
  end if;
  if operation_type not in ('apply_production_plan','director_command','story_generation','script_generation',
    'scene_generation','domain_content_generation','runtime_validation','reality_check') then
    raise exception 'Unsupported Director operation type' using errcode = '22023';
  end if;
  if jsonb_typeof(bundle) <> 'object' or pg_column_size(bundle) > 4000000 then
    raise exception 'Invalid Director operation bundle' using errcode = '22023';
  end if;
  plan := coalesce(bundle->'production','{}'::jsonb);
  brief := coalesce(bundle->'brief','{}'::jsonb);
  story := case when jsonb_typeof(bundle->'story') = 'object' then bundle->'story' else null end;
  script := case when jsonb_typeof(bundle->'script') = 'object' then bundle->'script' else null end;
  select * into production_row from tonde.productions
    where workspace_id = target_workspace and id = target_production for update;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  -- Idempotency first: a retried operation with identical content never duplicates content.
  select * into existing from tonde.director_operations
    where workspace_id = target_workspace and operation_id = target_operation for update;
  if found and existing.status in ('succeeded','partial') and existing.payload_hash is not null then
    if existing.payload_hash is distinct from bundle_hash then
      raise exception 'This operation id was already applied with different content' using errcode = '23505';
    end if;
    return jsonb_build_object('production_id', target_production, 'operation_id', target_operation, 'idempotent', true,
      'production_revision', production_row.revision, 'duplicate_applied', true);
  end if;
  if production_row.revision <> expected_production_revision then
    raise exception 'Production changed; reload before applying this operation' using errcode = '40001';
  end if;
  if production_row.locked_at is not null or production_row.approval <> 'draft' then
    raise exception 'Apply Director operations to an unlocked Draft Production' using errcode = '55000';
  end if;
  producer_kind := case when bundle->>'producer' = 'model' then 'model' else 'deterministic' end;
  if coalesce(length(btrim(plan->>'title')),0) = 0 or length(plan->>'title') > 160
    or coalesce(length(btrim(brief->>'production_goal')),0) = 0 or length(brief->>'production_goal') > 10000 then
    raise exception 'Invalid Director production plan' using errcode = '22023';
  end if;
  if not exists(select 1 from unnest(enum_range(null::tonde.production_type)) t where t::text = plan->>'production_type')
    or not exists(select 1 from unnest(enum_range(null::tonde.execution_method)) t where t::text = plan->>'execution_method') then
    raise exception 'Unsupported Production classification or execution method' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(bundle->'scenes','[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(bundle->'scenes','[]'::jsonb)) > 40 then
    raise exception 'Invalid Scene list' using errcode = '22023';
  end if;
  if plan->>'planned_duration_ms' is not null then
    if plan->>'planned_duration_ms' !~ '^[0-9]{1,16}$' then raise exception 'Runtime must use integer milliseconds' using errcode = '22023'; end if;
    target_duration := (plan->>'planned_duration_ms')::bigint;
    if target_duration > 9007199254740991 then raise exception 'Runtime exceeds the safe integer range' using errcode = '22023'; end if;
    if jsonb_array_length(coalesce(bundle->'scenes','[]'::jsonb)) = 0 then raise exception 'A timed Production needs at least one Scene' using errcode = '22023'; end if;
  else
    target_duration := null;
  end if;
  for scene in select value from jsonb_array_elements(coalesce(bundle->'scenes','[]'::jsonb)) loop
    scene_index := scene_index + 1;
    if jsonb_typeof(scene) <> 'object' or coalesce(length(btrim(scene->>'title')),0) = 0 or length(scene->>'title') > 160
      or length(coalesce(scene->>'purpose','')) > 1200 or length(coalesce(scene->>'story_beat','')) > 200
      or jsonb_typeof(coalesce(scene->'action_lines','[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(scene->'action_lines','[]'::jsonb)) > 16 then
      raise exception 'Invalid planned Scene' using errcode = '22023';
    end if;
    if target_duration is not null then
      if scene->>'duration_ms' is null or scene->>'duration_ms' !~ '^[0-9]{1,16}$' then
        raise exception 'Every timed Scene needs integer milliseconds' using errcode = '22023';
      end if;
      scene_duration := (scene->>'duration_ms')::bigint;
      if scene_duration > 9007199254740991 then raise exception 'Scene duration exceeds the safe integer range' using errcode = '22023'; end if;
      if scene_total > 9007199254740991 - scene_duration then raise exception 'Scene duration sum exceeds the safe integer range' using errcode = '22003'; end if;
      scene_total := scene_total + scene_duration;
    elsif scene->>'duration_ms' is not null then
      raise exception 'Scene durations require a Production runtime target' using errcode = '22023';
    end if;
  end loop;
  if target_duration is not null and scene_total <> target_duration then
    raise exception 'Scene durations must equal the Production target exactly' using errcode = '23514';
  end if;
  -- Prior Scenes are archived (never hard-deleted) and moved out of the live ordering range.
  update tonde.scenes s set lifecycle = 'archived',
    sort_order = (select coalesce(max(x.sort_order), 0) from tonde.scenes x
      where x.workspace_id = target_workspace and x.production_id = target_production) + 1000000 + s.sort_order
    where s.workspace_id = target_workspace and s.production_id = target_production and s.lifecycle = 'active';
  for scene in select value from jsonb_array_elements(coalesce(bundle->'scenes','[]'::jsonb)) loop
    scene_count := scene_count + 1;
    insert into tonde.scenes(workspace_id, production_id, title, purpose, description, story_beat, opening_state,
      ending_state, visual_intent, dialogue_notes, action_lines, scene_detail, sort_order, planned_duration_ms, source_operation_id)
    values (target_workspace, target_production, left(scene->>'title',160), left(coalesce(scene->>'purpose',''),1200),
      left(coalesce(scene->>'description',''),4000), left(coalesce(scene->>'story_beat',''),200),
      left(coalesce(scene->>'opening_state',''),400), left(coalesce(scene->>'ending_state',''),400),
      left(coalesce(scene->>'visual_intent',''),900), left(coalesce(scene->>'dialogue_notes',''),900),
      coalesce(scene->'action_lines','[]'::jsonb),
      jsonb_build_object('environment', coalesce(scene->>'environment',''), 'characters', coalesce(scene->'characters','[]'::jsonb),
        'products', coalesce(scene->'products','[]'::jsonb), 'techniques', coalesce(scene->'techniques','[]'::jsonb),
        'shots', coalesce(scene->'shots','[]'::jsonb), 'plan_order', scene_count),
      scene_order, case when target_duration is null then null else (scene->>'duration_ms')::bigint end, target_operation)
    returning id into scene_id;
    scene_ids := scene_ids || jsonb_build_object(coalesce(nullif(scene->>'order',''), scene_count::text), scene_id::text);
    scene_order := scene_order + 1024;
  end loop;
  assets_result := tonde_private.director_apply_assets(target_workspace, target_production, target_operation, bundle);
  character_assets := coalesce(assets_result->'character_assets','{}'::jsonb);
  -- Creative documents are the readable record of the same structured content.
  delete from tonde.dialogue_lines where workspace_id = target_workspace and production_id = target_production;
  delete from tonde.creative_documents where workspace_id = target_workspace and production_id = target_production
    and document_type in ('brief','story','script');
  brief_content := concat_ws(E'\n\n', 'PRODUCTION GOAL: ' || (brief->>'production_goal'),
    case when coalesce(brief->>'audience','') <> '' then 'AUDIENCE: ' || (brief->>'audience') end,
    case when coalesce(brief->>'core_message','') <> '' then 'CORE MESSAGE: ' || (brief->>'core_message') end,
    case when coalesce(brief->>'call_to_action','') <> '' then 'CALL TO ACTION: ' || (brief->>'call_to_action') end,
    case when coalesce(brief->>'story_approach','') <> '' then 'STORY APPROACH: ' || (brief->>'story_approach') end,
    case when coalesce(brief->>'dialogue_approach','') <> '' then 'DIALOGUE: ' || (brief->>'dialogue_approach') end,
    case when jsonb_typeof(brief->'hard_constraints') = 'array' and jsonb_array_length(brief->'hard_constraints') > 0
      then 'HARD CONSTRAINTS: ' || (select string_agg(value, '; ') from jsonb_array_elements_text(brief->'hard_constraints') as value) end,
    case when jsonb_typeof(brief->'assumptions') = 'array' and jsonb_array_length(brief->'assumptions') > 0
      then 'ASSUMPTIONS: ' || (select string_agg(value->>'statement', '; ') from jsonb_array_elements(brief->'assumptions') as value) end);
  insert into tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type, title, content)
    values (target_workspace, target_production, target_production, 'brief', 'Production Brief', left(brief_content, 1000000));
  if story is not null then
    story_content := concat_ws(E'\n\n', 'LOGLINE: ' || coalesce(story->>'logline',''),
      case when coalesce(story->>'premise','') <> '' then 'PREMISE: ' || (story->>'premise') end,
      case when coalesce(story->>'central_question','') <> '' then 'CENTRAL QUESTION: ' || (story->>'central_question') end,
      case when jsonb_typeof(story->'beats') = 'array' then (select string_agg((value->>'order') || '. ' || (value->>'name') || E'\n' || (value->>'content'), E'\n\n')
        from jsonb_array_elements(story->'beats') as value) end,
      case when coalesce(story->>'call_to_action','') <> '' then 'CTA: ' || (story->>'call_to_action') end);
    insert into tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type, title, content)
      values (target_workspace, target_production, target_production, 'story', left(coalesce(story->>'title','Story'),160), left(story_content, 1000000));
    insert into tonde.creative_stories as cs (workspace_id, production_id, story, variation, producer, source_operation_id)
      values (target_workspace, target_production, story, left(coalesce(story->>'variation','original'),60), producer_kind, target_operation)
      on conflict (workspace_id, production_id) do update set story = excluded.story, variation = excluded.variation,
        producer = excluded.producer, source_operation_id = excluded.source_operation_id;
  end if;
  if script is not null then
    script_content := coalesce(script->>'title','Script') || E'\n\n' ||
      coalesce((select string_agg(
        (value->>'heading') || E'\n\n' ||
        coalesce((select string_agg(action, E'\n') from jsonb_array_elements_text(coalesce(value->'action','[]'::jsonb)) as action), '') ||
        E'\n\n' ||
        coalesce((select string_agg(
          case when coalesce(script_line->>'speaker','') = '' then '' else upper(script_line->>'speaker') || E'\n' end ||
          case when coalesce(script_line->>'kind','') = 'dialogue' then '  ' || coalesce(script_line->>'content','')
            else '[' || upper(coalesce(script_line->>'kind','dialogue')) || '] ' || coalesce(script_line->>'content','') end,
          E'\n') from jsonb_array_elements(coalesce(value->'lines','[]'::jsonb)) as script_line), '') ||
        E'\n\n' ||
        case when coalesce(value->>'transition','') = '' then '' else '>> ' || (value->>'transition') end,
        E'\n\n') from jsonb_array_elements(coalesce(script->'scenes','[]'::jsonb)) as value), '');
    insert into tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type, title, content)
      values (target_workspace, target_production, target_production, 'script', left(coalesce(script->>'title','Script'),160), left(script_content, 1000000))
      returning * into document_row;
    document_id := document_row.id;
    for script_scene in select value from jsonb_array_elements(coalesce(script->'scenes','[]'::jsonb)) loop
      script_scene_index := script_scene_index + 1;
      scene_id_text := nullif(script_scene->>'scene_order','');
      scene_id := null;
      if scene_id_text is not null and scene_ids ? scene_id_text then
        scene_id := (scene_ids->>scene_id_text)::uuid;
      end if;
      line_order := 1;
      for line in select value from jsonb_array_elements(coalesce(script_scene->'lines','[]'::jsonb)) loop
        if jsonb_typeof(line) <> 'object'
          or not exists(select 1 from unnest(enum_range(null::tonde.dialogue_kind)) k where k::text = coalesce(line->>'kind','dialogue')) then
          raise exception 'Unsupported dialogue line kind' using errcode = '22023';
        end if;
        dialogue_count := dialogue_count + 1;
        speaker_id := null;
        if coalesce(line->>'speaker','') <> '' and character_assets ? lower(line->>'speaker') then
          speaker_id := (character_assets->>lower(line->>'speaker'))::uuid;
        end if;
        insert into tonde.dialogue_lines(workspace_id, production_id, document_id, scene_id, speaker_asset_id,
          line_type, content, sort_order, start_ms, duration_ms, intention, delivery, subtext, pause_after_ms, line_flags)
        values (target_workspace, target_production, document_id, scene_id, speaker_id,
          coalesce(line->>'kind','dialogue')::tonde.dialogue_kind, left(coalesce(line->>'content',''),4000),
          (coalesce(nullif(scene_id_text,'')::bigint, script_scene_index::bigint) * 1000) + line_order,
          0, greatest(0, least(9007199254740991, coalesce((line->>'estimated_ms')::bigint, 0))),
          left(coalesce(line->>'intention',''),300), left(coalesce(line->>'delivery',''),300),
          left(coalesce(line->>'subtext',''),300), greatest(0, least(60000, coalesce((line->>'pause_after_ms')::bigint, 0))),
          jsonb_build_object('interruption', coalesce((line->>'interruption')::boolean, false),
            'overlap', coalesce((line->>'overlap')::boolean, false),
            'reaction_to', line->'reaction_to', 'order', line->'order'));
        line_order := line_order + 1;
      end loop;
    end loop;
  end if;
  insert into tonde.director_briefs as db (workspace_id, production_id, brief, producer, source_operation_id)
    values (target_workspace, target_production, brief, producer_kind, target_operation)
    on conflict (workspace_id, production_id) do update set brief = excluded.brief, producer = excluded.producer,
      source_operation_id = excluded.source_operation_id;
  for item in select value from jsonb_array_elements(coalesce(bundle->'decisions','[]'::jsonb)) loop
    if jsonb_typeof(item) = 'object' and coalesce(length(btrim(item->>'decision_id')),0) > 0 then
      insert into tonde.director_decisions as d (workspace_id, production_id, decision_id, question, answer, priority, impact, decided_by, decision_source)
        values (target_workspace, target_production, left(item->>'decision_id',80), left(coalesce(item->>'question',''),400),
          left(coalesce(item->>'answer',''),500), coalesce(item->>'priority','high_impact'), coalesce(item->>'impact','high'),
          case when item->>'answer' = 'TONDE decides' then 'tonde' else coalesce(item->>'decided_by','creator') end, 'studio')
        on conflict (production_id, decision_id) do update set answer = excluded.answer, priority = excluded.priority,
          impact = excluded.impact, decided_by = excluded.decided_by, decision_source = excluded.decision_source;
    end if;
  end loop;
  if jsonb_typeof(bundle->'reality') = 'object' then
    insert into tonde.director_reality_checks as rc (workspace_id, production_id, report, feasibility, complexity, recommended_mode, source_operation_id)
      values (target_workspace, target_production, bundle->'reality',
        coalesce(bundle->'reality'->>'feasibility','ready'), coalesce(bundle->'reality'->>'complexity','simple'),
        coalesce(bundle->'reality'->'mode'->>'method','real'), target_operation)
      on conflict (workspace_id, production_id) do update set report = excluded.report, feasibility = excluded.feasibility,
        complexity = excluded.complexity, recommended_mode = excluded.recommended_mode, source_operation_id = excluded.source_operation_id;
  end if;
  update tonde.productions set title = left(plan->>'title',160),
    production_type = (plan->>'production_type')::tonde.production_type,
    execution_method = (plan->>'execution_method')::tonde.execution_method,
    planned_duration_ms = target_duration
    where workspace_id = target_workspace and id = target_production;
  insert into tonde.director_operations(workspace_id, production_id, operation_id, operation_type, scope, source_revision,
    source_intake_revision, status, producer, provider, model, model_profile, idempotency_key, collaboration_mode, rationale,
    limitations, payload, payload_hash, started_at, completed_at, created_by)
  values (target_workspace, target_production, target_operation, operation_type, 'production', expected_production_revision,
    null, 'succeeded', producer_kind, bundle->'operation'->>'provider', bundle->'operation'->>'model',
    coalesce(bundle->'operation'->>'model_profile','default'),
    coalesce(bundle->'operation'->>'idempotency_key', 'apply:' || target_operation::text),
    coalesce(bundle->'operation'->>'collaboration_mode','stop_at_major_decisions'),
    left(coalesce(bundle->'operation'->>'rationale',''),1200),
    coalesce(bundle->'operation'->'limitations','[]'::jsonb),
    jsonb_build_object('scenes', scene_count, 'dialogue_lines', dialogue_count, 'assets', assets_result),
    bundle_hash, now(), now(), auth.uid())
  on conflict (workspace_id, operation_id) do update set
    status = 'succeeded', producer = excluded.producer, provider = excluded.provider, model = excluded.model,
    model_profile = excluded.model_profile, rationale = excluded.rationale, limitations = excluded.limitations,
    payload = excluded.payload, payload_hash = excluded.payload_hash, completed_at = now(),
    error_code = null, error_message = null;
  select revision into production_revision_out from tonde.productions
    where workspace_id = target_workspace and id = target_production;
  return jsonb_build_object('production_id', target_production, 'operation_id', target_operation, 'idempotent', false,
    'production_revision', production_revision_out, 'scenes', scene_count, 'dialogue_lines', dialogue_count,
    'assets', assets_result, 'runtime_ms', target_duration);
end;
$$;

revoke all on function tonde.apply_director_operation(uuid,uuid,integer,uuid,text,jsonb,boolean) from public, anon, authenticated, service_role;
grant execute on function tonde.apply_director_operation(uuid,uuid,integer,uuid,text,jsonb,boolean) to authenticated;
commit;
