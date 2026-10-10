-- INV-34/35: completion carries the worker's original identity/purpose revision.
-- A newer worker claim must not let an older worker silently complete against that new pin.
begin;


-- 4. Reference analysis: capability, staged status, findings and technique links.
create or replace function tonde.save_reference_analysis(
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
  if nullif(analysis->>'identity_revision','')::integer is distinct from reference_row.identity_revision
    or not exists(select 1 from tonde.reference_analyses a where a.workspace_id=target_workspace
      and a.reference_id=target_reference and a.identity_revision=reference_row.identity_revision) then
    raise exception 'Reference identity revision changed before analysis completion; analyze the current revision' using errcode='40001';
  end if;
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
revoke all on function tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid) from public,anon,service_role;
grant execute on function tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid) to authenticated;
commit;
