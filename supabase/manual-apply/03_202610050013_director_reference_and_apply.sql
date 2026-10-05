begin;

-- 4. Reference analysis: capability, staged status, findings and technique links.
create function tonde.save_reference_analysis(
  target_workspace uuid, target_production uuid, target_reference uuid, analysis jsonb,
  findings jsonb, techniques jsonb, source_operation uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare reference_row tonde.production_references;
  saved tonde.reference_analyses;
  item jsonb;
  linked_technique_id uuid;
  technique_count integer := 0;
  finding_count integer := 0;
  desired_capability text := coalesce(analysis->>'capability', 'metadata_only');
  desired_status text := coalesce(analysis->>'status', 'not_started');
  desired_progress integer;
  reference_state text;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(analysis) <> 'object' or jsonb_typeof(findings) <> 'array' or jsonb_typeof(techniques) <> 'array'
    or jsonb_array_length(findings) > 80 or jsonb_array_length(techniques) > 40 then
    raise exception 'Invalid reference analysis payload' using errcode = '22023';
  end if;
  if desired_capability not in ('full_media_available','partial_media_available','metadata_only','text_only','unavailable')
    or desired_status not in ('not_started','queued','preprocessing','analyzing','synthesizing','complete','partial','failed') then
    raise exception 'Unsupported reference capability or analysis state' using errcode = '22023';
  end if;
  select * into reference_row from tonde.production_references
    where workspace_id = target_workspace and production_id = target_production and id = target_reference for update;
  if not found then raise exception 'Reference unavailable in this Production' using errcode = 'P0002'; end if;
  desired_progress := greatest(0, least(100, coalesce((analysis->>'progress')::integer, case when desired_status = 'complete' then 100 else 0 end)));
  -- An observed finding must cite evidence, exactly as the domain model requires.
  for item in select value from jsonb_array_elements(findings) loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'statement')), 0) = 0 or length(item->>'statement') > 1200
      or coalesce(item->>'epistemic','') not in ('observed','estimated','recommended','unknown')
      or coalesce(item->>'confidence','') not in ('high','medium','low')
      or jsonb_typeof(coalesce(item->'evidence','[]'::jsonb)) <> 'array' then
      raise exception 'Invalid reference finding' using errcode = '22023';
    end if;
    if item->>'epistemic' = 'observed' and jsonb_array_length(coalesce(item->'evidence','[]'::jsonb)) = 0
      and item->>'category' <> 'story' then
      raise exception 'An observed finding must cite evidence' using errcode = '23514';
    end if;
  end loop;
  insert into tonde.reference_analyses as ra (workspace_id, production_id, reference_id, role, capability, status, stages,
    progress, summary, capabilities, style, causal, adaptation_notes, limitations, media_metadata, producer, model_profile,
    producer_note, source_operation_id, analyzed_at)
  values (target_workspace, target_production, target_reference,
    coalesce(analysis->>'role','style'), desired_capability, desired_status,
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(analysis->'stages','[]'::jsonb)) as value), '{}'),
    desired_progress, left(coalesce(analysis->>'summary',''),1600),
    coalesce(analysis->'capabilities','{}'::jsonb), coalesce(analysis->'style','{}'::jsonb),
    coalesce(analysis->'causal','[]'::jsonb), coalesce(analysis->'adaptation_notes','[]'::jsonb),
    coalesce(analysis->'limitations','[]'::jsonb), coalesce(analysis->'media_metadata','{}'::jsonb),
    coalesce(analysis->>'producer','deterministic'), coalesce(analysis->>'model_profile','default'),
    left(coalesce(analysis->>'producer_note',''),600), source_operation,
    case when desired_status in ('complete','partial','failed') then now() else null end)
  on conflict (workspace_id, reference_id) do update set
    role = excluded.role, capability = excluded.capability, status = excluded.status, stages = excluded.stages,
    progress = excluded.progress, summary = excluded.summary, capabilities = excluded.capabilities, style = excluded.style,
    causal = excluded.causal, adaptation_notes = excluded.adaptation_notes, limitations = excluded.limitations,
    media_metadata = excluded.media_metadata, producer = excluded.producer, model_profile = excluded.model_profile,
    producer_note = excluded.producer_note, source_operation_id = coalesce(excluded.source_operation_id, ra.source_operation_id),
    analyzed_at = coalesce(excluded.analyzed_at, ra.analyzed_at)
  returning * into saved;
  delete from tonde.reference_findings where workspace_id = target_workspace and analysis_id = saved.id;
  for item in select value from jsonb_array_elements(findings) loop
    finding_count := finding_count + 1;
    insert into tonde.reference_findings(workspace_id, production_id, analysis_id, finding_id, category, statement,
      epistemic, confidence, evidence, technique_id, limitations, sort_order)
    values (target_workspace, target_production, saved.id, left(item->>'finding_id',120),
      coalesce(item->>'category','story'), left(item->>'statement',1200), item->>'epistemic', item->>'confidence',
      coalesce(item->'evidence','[]'::jsonb), nullif(left(coalesce(item->>'technique_id',''),120),''),
      coalesce(item->'limitations','[]'::jsonb), finding_count * 1024);
  end loop;
  delete from tonde.reference_technique_links where workspace_id = target_workspace and analysis_id = saved.id;
  for item in select value from jsonb_array_elements(techniques) loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'canonical_id')),0) < 3
      or coalesce(length(btrim(item->>'name')),0) = 0 or coalesce(length(btrim(item->>'description')),0) = 0
      or coalesce(length(btrim(item->>'purpose')),0) = 0 or coalesce(length(btrim(item->>'effect')),0) = 0
      or coalesce(item->>'category','') not in ('camera','composition','lighting','blocking','performance','product','edit','transition','sound','color','story','typography') then
      raise exception 'Invalid technique payload' using errcode = '22023';
    end if;
    insert into tonde.creative_techniques as ct (workspace_id, canonical_id, name, category, description, purpose, effect,
      conditions, practical_concept, ai_concept, limitations, importance, confidence, technique_source, created_by)
    values (target_workspace, left(item->>'canonical_id',120), left(item->>'name',160), item->>'category',
      left(item->>'description',1200), left(item->>'purpose',600), left(item->>'effect',600),
      coalesce(item->'conditions','[]'::jsonb), left(coalesce(item->>'practical_concept',''),900),
      left(coalesce(item->>'ai_concept',''),900), coalesce(item->'limitations','[]'::jsonb),
      coalesce(item->>'importance','supporting'), coalesce(item->>'confidence','medium'),
      coalesce(item->>'technique_source','reference'), auth.uid())
    on conflict (workspace_id, canonical_id) do update set
      name = excluded.name, category = excluded.category, description = excluded.description, purpose = excluded.purpose,
      effect = excluded.effect, conditions = excluded.conditions, practical_concept = excluded.practical_concept,
      ai_concept = excluded.ai_concept, limitations = excluded.limitations, importance = excluded.importance,
      confidence = excluded.confidence
    returning id into linked_technique_id;
    technique_count := technique_count + 1;
    insert into tonde.reference_technique_links(workspace_id, production_id, analysis_id, technique_id, reference_id, importance, evidence)
      values (target_workspace, target_production, saved.id, linked_technique_id, target_reference,
        coalesce(item->>'importance','supporting'), coalesce(item->'evidence','[]'::jsonb))
      on conflict (analysis_id, technique_id) do update set importance = excluded.importance, evidence = excluded.evidence;
  end loop;
  reference_state := case desired_status
    when 'complete' then 'analyzed'
    when 'partial' then 'partially_analyzed'
    when 'failed' then 'failed'
    when 'unavailable' then 'inaccessible'
    else 'processing' end;
  if desired_status = 'complete' and desired_capability <> 'full_media_available' then
    reference_state := 'partially_analyzed';
  end if;
  update tonde.production_references set state = reference_state::tonde.reference_state where id = target_reference and workspace_id = target_workspace;
  return jsonb_build_object('analysis_id', saved.id, 'revision', saved.revision, 'status', saved.status,
    'capability', saved.capability, 'findings', finding_count, 'techniques', technique_count, 'reference_state', reference_state);
end;
$$;

-- 5. Staged progress for long media work without touching finished findings.
create function tonde.claim_reference_analysis(
  target_workspace uuid, target_production uuid, target_reference uuid, stage_status text,
  stage_list text[] default '{}', progress_pct integer default 0, producer_note text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved tonde.reference_analyses; reference_state text;
begin
  perform tonde_private.director_guard(target_workspace);
  if stage_status not in ('queued','preprocessing','analyzing','synthesizing','partial','failed','cancelled') then
    raise exception 'Unsupported analysis stage status' using errcode = '22023';
  end if;
  if not exists(select 1 from tonde.production_references r where r.workspace_id = target_workspace
    and r.production_id = target_production and r.id = target_reference) then
    raise exception 'Reference unavailable in this Production' using errcode = 'P0002';
  end if;
  insert into tonde.reference_analyses as ra (workspace_id, production_id, reference_id, status, stages, progress, producer_note)
  values (target_workspace, target_production, target_reference, stage_status, coalesce(stage_list, '{}'),
    greatest(0, least(100, coalesce(progress_pct, 0))), left(coalesce(producer_note,''),600))
  on conflict (workspace_id, reference_id) do update set
    status = excluded.status, stages = excluded.stages, progress = excluded.progress,
    producer_note = case when excluded.producer_note = '' then ra.producer_note else excluded.producer_note end
  returning * into saved;
  reference_state := case stage_status when 'failed' then 'failed' when 'partial' then 'partially_analyzed' else 'processing' end;
  update tonde.production_references set state = reference_state::tonde.reference_state where id = target_reference and workspace_id = target_workspace;
  return jsonb_build_object('analysis_id', saved.id, 'status', saved.status, 'progress', saved.progress, 'stages', saved.stages);
end;
$$;

-- Creative domain content becomes canonical Assets and scope bindings, never a second entity model.
create function tonde_private.director_apply_assets(
  target_workspace uuid, target_production uuid, operation_id uuid, bundle jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
-- The block is labelled so the asset_id variable can be qualified against the
-- asset_id column of scope_bindings inside the existence checks below.
<<assets>>
declare item jsonb; asset_id uuid; binding text; asset_kind tonde.asset_type;
  environment_ids jsonb := '{}'::jsonb;
  character_ids jsonb := '{}'::jsonb;
  scene_row record; character_name text; environment_name text;
  characters integer := 0; environments integer := 0; products integer := 0; wardrobe integer := 0;
begin
  for item in select value from jsonb_array_elements(coalesce(bundle->'characters','[]'::jsonb)) loop
    characters := characters + 1;
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = 'character'
      and name = left(item->>'name',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, 'character', left(item->>'name',160), left(coalesce(item->>'story_function',''),10000),
        jsonb_build_object('role', item->>'role', 'story_function', item->>'story_function', 'objective', item->>'objective',
          'visual_description', item->>'visual_description', 'performance_direction', item->>'performance_direction',
          'relationships', coalesce(item->'relationships','[]'::jsonb), 'recurring', coalesce((item->>'recurring')::boolean, false)),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set metadata = jsonb_build_object('role', item->>'role', 'story_function', item->>'story_function',
          'objective', item->>'objective', 'visual_description', item->>'visual_description',
          'performance_direction', item->>'performance_direction', 'relationships', coalesce(item->'relationships','[]'::jsonb),
          'recurring', coalesce((item->>'recurring')::boolean, false)),
        provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    character_ids := character_ids || jsonb_build_object(lower(left(item->>'name',160)), asset_id::text);
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = 'character' and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, 'character', 'inherit');
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(bundle->'environments','[]'::jsonb)) loop
    environments := environments + 1;
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = 'environment'
      and name = left(item->>'name',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, 'environment', left(item->>'name',160), left(coalesce(item->>'story_purpose',''),10000),
        jsonb_build_object('visual_requirements', coalesce(item->'visual_requirements','[]'::jsonb),
          'story_purpose', item->>'story_purpose', 'spatial_needs', coalesce(item->'spatial_needs','[]'::jsonb),
          'lighting_context', item->>'lighting_context', 'scene_usage', coalesce(item->'scene_usage','[]'::jsonb)),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set metadata = jsonb_build_object('visual_requirements', coalesce(item->'visual_requirements','[]'::jsonb),
          'story_purpose', item->>'story_purpose', 'spatial_needs', coalesce(item->'spatial_needs','[]'::jsonb),
          'lighting_context', item->>'lighting_context', 'scene_usage', coalesce(item->'scene_usage','[]'::jsonb)),
        provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    environment_ids := environment_ids || jsonb_build_object(lower(left(item->>'name',160)), asset_id::text);
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = 'world' and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, 'world', 'inherit');
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(bundle->'products','[]'::jsonb)) loop
    products := products + 1;
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = 'product'
      and name = left(item->>'name',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, 'product', left(item->>'name',160), left(coalesce(item->>'role',''),10000),
        jsonb_build_object('role', item->>'role', 'required_visibility', item->>'required_visibility',
          'hero_moments', coalesce(item->'hero_moments','[]'::jsonb), 'fidelity_importance', item->>'fidelity_importance',
          'interactions', coalesce(item->'interactions','[]'::jsonb), 'packaging_notes', coalesce(item->'packaging_notes','[]'::jsonb)),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set metadata = jsonb_build_object('role', item->>'role', 'required_visibility', item->>'required_visibility',
          'hero_moments', coalesce(item->'hero_moments','[]'::jsonb), 'fidelity_importance', item->>'fidelity_importance',
          'interactions', coalesce(item->'interactions','[]'::jsonb), 'packaging_notes', coalesce(item->'packaging_notes','[]'::jsonb)),
        provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = 'product' and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, 'product', 'inherit');
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(bundle->'wardrobe_props','[]'::jsonb)) loop
    wardrobe := wardrobe + 1;
    asset_kind := case when item->>'kind' = 'wardrobe' then 'wardrobe' else 'prop' end;
    binding := case when item->>'kind' = 'wardrobe' then 'wardrobe' else 'prop' end;
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = asset_kind
      and name = left(item->>'name',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, asset_kind, left(item->>'name',160), left(coalesce(item->>'requirement',''),10000),
        jsonb_build_object('requirement', item->>'requirement', 'scene_usage', coalesce(item->'scene_usage','[]'::jsonb),
          'content_source', coalesce(item->>'source','derived')),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set metadata = jsonb_build_object('requirement', item->>'requirement',
          'scene_usage', coalesce(item->'scene_usage','[]'::jsonb), 'content_source', coalesce(item->>'source','derived')),
        provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = binding::tonde.binding_role and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, binding::tonde.binding_role, 'inherit');
    end if;
  end loop;
  if jsonb_typeof(bundle->'style_bible') = 'object' and coalesce(length(btrim(bundle->'style_bible'->>'title')),0) > 0 then
    -- The Style Bible is deduplicated by name like every other creative Asset: re-applying a plan
    -- updates the existing Style record instead of accumulating a new one per operation.
    select id into asset_id from tonde.assets where workspace_id = target_workspace and asset_type = 'style_bible'
      and name = left(bundle->'style_bible'->>'title',160) and lifecycle = 'active' limit 1;
    if asset_id is null then
      insert into tonde.assets(workspace_id, asset_type, name, description, metadata, provenance, created_by)
      values (target_workspace, 'style_bible', left(bundle->'style_bible'->>'title',160),
        left(coalesce(bundle->'style_bible'->>'summary',''),10000),
        jsonb_build_object('sections', coalesce(bundle->'style_bible'->'sections','[]'::jsonb),
          'producer', coalesce(bundle->'style_bible'->>'producer','deterministic')),
        jsonb_build_object('source','director','operation_id', operation_id::text), auth.uid())
      returning id into asset_id;
    else
      update tonde.assets set description = left(coalesce(bundle->'style_bible'->>'summary',''),10000),
          metadata = jsonb_build_object('sections', coalesce(bundle->'style_bible'->'sections','[]'::jsonb),
            'producer', coalesce(bundle->'style_bible'->>'producer','deterministic')),
          provenance = provenance || jsonb_build_object('last_operation_id', operation_id::text)
        where id = asset_id;
    end if;
    if not exists(select 1 from tonde.scope_bindings b where b.scope_object_id = target_production and b.binding_role = 'style' and b.asset_id = assets.asset_id) then
      insert into tonde.scope_bindings(workspace_id, production_id, scope_object_id, asset_id, binding_role, inheritance)
        values (target_workspace, target_production, target_production, asset_id, 'style', 'inherit');
    end if;
  end if;
  -- Link Scenes to their creative Environment and register on-camera participants.
  for scene_row in select id, sort_order, scene_detail from tonde.scenes
    where workspace_id = target_workspace and production_id = target_production and lifecycle = 'active' loop
    environment_name := lower(coalesce(scene_row.scene_detail->>'environment',''));
    if environment_name <> '' and environment_ids ? environment_name then
      update tonde.scenes set environment_asset_id = (environment_ids->>environment_name)::uuid where id = scene_row.id;
    end if;
    for character_name in select value from jsonb_array_elements_text(coalesce(scene_row.scene_detail->'characters','[]'::jsonb)) loop
      if character_ids ? lower(character_name)
        and not exists(select 1 from tonde.scene_participants sp
          where sp.scene_id = scene_row.id and sp.asset_id = (character_ids->>lower(character_name))::uuid) then
        insert into tonde.scene_participants(workspace_id, production_id, scene_id, asset_id, role)
          values (target_workspace, target_production, scene_row.id, (character_ids->>lower(character_name))::uuid, 'participant');
      end if;
    end loop;
  end loop;
  return jsonb_build_object('characters', characters, 'environments', environments, 'products', products, 'wardrobe_props', wardrobe,
    'character_assets', character_ids, 'environment_assets', environment_ids);
end;
$$;

revoke all on function tonde_private.director_apply_assets(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid),
  tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text) from public, anon, authenticated, service_role;
grant execute on function tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid),
  tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text) to authenticated;
commit;

-- Additive migration: Prompt 4 reference analysis persistence and atomic creative apply.

-- ---------------------------------------------------------------------------
-- 202610050013_202610050013_director_reference_and_apply
-- Reference analysis persistence and atomic creative apply: save_reference_analysis, claim_reference_analysis and tonde_private.director_apply_assets.
--
-- Run this file ONCE, after everything that precedes it in supabase/manual-apply/README.md.
-- It is intentionally not idempotent: running it twice fails with "already exists",
-- which means it was already applied, not that the file is broken.
-- ---------------------------------------------------------------------------
