begin;

-- Scene-level creative detail. Canonical Scenes stay the single Scene model.
alter table tonde.scenes add column story_beat text not null default '' check (length(story_beat) <= 200);
alter table tonde.scenes add column opening_state text not null default '' check (length(opening_state) <= 400);
alter table tonde.scenes add column ending_state text not null default '' check (length(ending_state) <= 400);
alter table tonde.scenes add column visual_intent text not null default '' check (length(visual_intent) <= 900);
alter table tonde.scenes add column dialogue_notes text not null default '' check (length(dialogue_notes) <= 900);
alter table tonde.scenes add column action_lines jsonb not null default '[]' check (jsonb_typeof(action_lines) = 'array' and jsonb_array_length(action_lines) <= 16);
alter table tonde.scenes add column scene_detail jsonb not null default '{}' check (jsonb_typeof(scene_detail) = 'object' and pg_column_size(scene_detail) <= 40000);
alter table tonde.scenes add column source_operation_id uuid;

-- Dialogue lines keep first-class delivery direction, not only the spoken text.
alter table tonde.dialogue_lines add column intention text not null default '' check (length(intention) <= 300);
alter table tonde.dialogue_lines add column delivery text not null default '' check (length(delivery) <= 300);
alter table tonde.dialogue_lines add column subtext text not null default '' check (length(subtext) <= 300);
alter table tonde.dialogue_lines add column pause_after_ms bigint not null default 0 check (pause_after_ms between 0 and 60000);
alter table tonde.dialogue_lines add column line_flags jsonb not null default '{}' check (jsonb_typeof(line_flags) = 'object');

-- Every Director operation carries the full operation contract and its provenance.
create table tonde.director_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  operation_id uuid not null,
  operation_type text not null check (operation_type in (
    'intent_interpretation','brief_generation','question_planning','reference_preprocessing','reference_analysis',
    'transcription','technique_extraction','style_extraction','story_generation','story_alternative','script_generation',
    'dialogue_operation','domain_content_generation','scene_generation','runtime_validation','reality_check',
    'production_plan','apply_production_plan','director_command','causal_explanation','reference_role_assignment'
  )),
  scope text not null default 'production' check (scope in ('production','brief','reference','story','script','dialogue','scene','reality')),
  schema_version text not null default 'tonde.director.1' check (length(schema_version) between 1 and 40),
  source_revision integer not null check (source_revision > 0),
  source_intake_revision integer check (source_intake_revision is null or source_intake_revision > 0),
  status text not null default 'queued' check (status in ('queued','preprocessing','analyzing','synthesizing','succeeded','partial','failed','cancelled')),
  producer text not null default 'deterministic' check (producer in ('deterministic','model','domain')),
  provider text check (provider is null or length(provider) <= 80),
  model text check (model is null or length(model) <= 120),
  model_profile text not null default 'default' check (length(model_profile) <= 120),
  attempts integer not null default 0 check (attempts between 0 and 10),
  repaired boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  collaboration_mode text not null default 'stop_at_major_decisions'
    check (collaboration_mode in ('guide_step_by_step','stop_at_major_decisions','complete_first_draft')),
  reference_ids uuid[] not null default '{}',
  constraint_summary jsonb not null default '{}' check (jsonb_typeof(constraint_summary) = 'object'),
  rationale text not null default '' check (length(rationale) <= 1200),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array' and jsonb_array_length(limitations) <= 12),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 400000),
  payload_hash text check (payload_hash is null or length(payload_hash) = 32),
  error_code text check (error_code is null or length(error_code) <= 80),
  error_message text check (error_message is null or length(error_message) <= 600),
  started_at timestamptz, completed_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, operation_id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);
create index director_operations_recent on tonde.director_operations(workspace_id, production_id, created_at desc);
create index director_operations_status on tonde.director_operations(workspace_id, status, updated_at desc);

-- One current structured Brief per Production, versioned by revision.
create table tonde.director_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  brief jsonb not null check (jsonb_typeof(brief) = 'object' and pg_column_size(brief) <= 200000),
  producer text not null default 'deterministic' check (producer in ('deterministic','model')),
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, production_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);

-- Answered decisions are persisted so the Director never re-asks a settled question.
create table tonde.director_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  decision_id text not null check (length(decision_id) between 1 and 80),
  question text not null default '' check (length(question) <= 400),
  answer text not null default '' check (length(answer) <= 500),
  priority text not null default 'high_impact' check (priority in ('blocking','high_impact','optional')),
  impact text not null default 'high' check (impact in ('critical','high','medium','low')),
  decided_by text not null default 'creator' check (decided_by in ('creator','tonde')),
  decision_source text not null default 'intake' check (decision_source in ('intake','studio','correction','tonde_default')),
  is_correction boolean not null default false,
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (production_id, decision_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);
create index director_decisions_production on tonde.director_decisions(workspace_id, production_id, priority);

-- Reference capability, staged progress and analysis output.
create table tonde.reference_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  reference_id uuid not null,
  role text not null default 'style' check (role in ('camera','lighting','pacing','character','product','color','edit','sound','style','story','composition','environment')),
  capability text not null default 'metadata_only'
    check (capability in ('full_media_available','partial_media_available','metadata_only','text_only','unavailable')),
  status text not null default 'not_started'
    check (status in ('not_started','queued','preprocessing','analyzing','synthesizing','complete','partial','failed')),
  stages text[] not null default '{}',
  progress integer not null default 0 check (progress between 0 and 100),
  summary text not null default '' check (length(summary) <= 1600),
  capabilities jsonb not null default '{}' check (jsonb_typeof(capabilities) = 'object'),
  style jsonb not null default '{}' check (jsonb_typeof(style) = 'object'),
  causal jsonb not null default '[]' check (jsonb_typeof(causal) = 'array'),
  adaptation_notes jsonb not null default '[]' check (jsonb_typeof(adaptation_notes) = 'array'),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),
  media_metadata jsonb not null default '{}' check (jsonb_typeof(media_metadata) = 'object'),
  producer text not null default 'deterministic' check (producer in ('deterministic','model')),
  model_profile text not null default 'default' check (length(model_profile) <= 120),
  producer_note text not null default '' check (length(producer_note) <= 600),
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reference_id) references tonde.production_references(workspace_id, id) on delete restrict
);
create index reference_analyses_status on tonde.reference_analyses(workspace_id, production_id, status);

create table tonde.reference_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  analysis_id uuid not null,
  finding_id text not null check (length(finding_id) between 1 and 120),
  category text not null check (category in ('camera','composition','lighting','blocking','performance','product','edit','transition','sound','color','story','typography','text','music','dialogue','voice','pacing','environment')),
  statement text not null check (length(statement) between 1 and 1200),
  epistemic text not null check (epistemic in ('observed','estimated','recommended','unknown')),
  confidence text not null check (confidence in ('high','medium','low')),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 8),
  technique_id text check (technique_id is null or length(technique_id) <= 120),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),
  sort_order bigint not null default 1024 check (sort_order >= 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (analysis_id, finding_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, analysis_id) references tonde.reference_analyses(workspace_id, id) on delete restrict,
  constraint observed_findings_cite_evidence check (epistemic <> 'observed' or jsonb_array_length(evidence) > 0 or category = 'story')
);
create index reference_findings_analysis on tonde.reference_findings(workspace_id, analysis_id, sort_order);

-- Reusable technique catalogue: workspace-scoped, never a copy of one reference.
create table tonde.creative_techniques (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  canonical_id text not null check (canonical_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(canonical_id) between 3 and 120),
  name text not null check (length(name) between 1 and 160),
  category text not null check (category in ('camera','composition','lighting','blocking','performance','product','edit','transition','sound','color','story','typography')),
  description text not null check (length(description) between 1 and 1200),
  purpose text not null check (length(purpose) between 1 and 600),
  effect text not null check (length(effect) between 1 and 600),
  conditions jsonb not null default '[]' check (jsonb_typeof(conditions) = 'array'),
  practical_concept text not null default '' check (length(practical_concept) <= 900),
  ai_concept text not null default '' check (length(ai_concept) <= 900),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),
  importance text not null default 'supporting' check (importance in ('essential','supporting','optional')),
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  technique_source text not null default 'reference' check (technique_source in ('reference','creator','story','style')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, canonical_id)
);
create index creative_techniques_category on tonde.creative_techniques(workspace_id, category, importance);

create table tonde.reference_technique_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  analysis_id uuid not null,
  technique_id uuid not null,
  reference_id uuid not null,
  importance text not null default 'supporting' check (importance in ('essential','supporting','optional')),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 8),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (analysis_id, technique_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, analysis_id) references tonde.reference_analyses(workspace_id, id) on delete restrict,
  foreign key (workspace_id, technique_id) references tonde.creative_techniques(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reference_id) references tonde.production_references(workspace_id, id) on delete restrict
);

-- The selected Story for a Production. Alternatives never overwrite it.
create table tonde.creative_stories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  story jsonb not null check (jsonb_typeof(story) = 'object' and pg_column_size(story) <= 200000),
  variation text not null default 'original' check (length(variation) <= 60),
  producer text not null default 'deterministic' check (producer in ('deterministic','model')),
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, production_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);

-- Reality Check result against the creator's real Setup.
create table tonde.director_reality_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  report jsonb not null check (jsonb_typeof(report) = 'object' and pg_column_size(report) <= 200000),
  feasibility text not null default 'ready' check (feasibility in ('ready','adapt','blocked')),
  complexity text not null default 'simple' check (complexity in ('simple','moderate','complex')),
  recommended_mode text not null default 'real' check (recommended_mode in ('real','ai','hybrid')),
  source_operation_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, production_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);

-- RLS: clients read their own workspace rows; every write goes through a guarded RPC.
alter table tonde.director_operations enable row level security;
alter table tonde.director_briefs enable row level security;
alter table tonde.director_decisions enable row level security;
alter table tonde.reference_analyses enable row level security;
alter table tonde.reference_findings enable row level security;
alter table tonde.creative_techniques enable row level security;
alter table tonde.reference_technique_links enable row level security;
alter table tonde.creative_stories enable row level security;
alter table tonde.director_reality_checks enable row level security;

do $$ declare table_name text; begin
  foreach table_name in array array['director_operations','director_briefs','director_decisions','reference_analyses',
    'reference_findings','creative_techniques','reference_technique_links','creative_stories','director_reality_checks'] loop
    execute format('create policy tenant_read on tonde.%I for select to authenticated using (tonde_private.is_workspace_member(workspace_id))', table_name);
    execute format('grant select on tonde.%I to authenticated', table_name);
    execute format('create trigger guard_mutation before insert or update on tonde.%I for each row execute function tonde_private.guard_mutation()', table_name);
  end loop;
end $$;

-- One authorization gate for every Director write path.
create function tonde_private.director_guard(target_workspace uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (select auth.role()) <> 'authenticated' or not tonde_private.can_edit_workspace(target_workspace) then
    raise exception 'Authenticated workspace editor required' using errcode = '42501';
  end if;
end;
$$;

-- 1. AI operation ledger: idempotent claim and completion of one Director operation.
create function tonde.record_director_operation(
  target_workspace uuid, target_production uuid, operation_record jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing tonde.director_operations; saved tonde.director_operations;
  desired_status text;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(operation_record) <> 'object' or pg_column_size(operation_record) > 500000
    or coalesce(length(operation_record->>'operation_id'), 0) <> 36
    or coalesce(length(btrim(operation_record->>'operation_type')), 0) = 0
    or coalesce(length(btrim(operation_record->>'idempotency_key')), 0) = 0 then
    raise exception 'Invalid Director operation record' using errcode = '22023';
  end if;
  if not exists(select 1 from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production) then
    raise exception 'Production unavailable' using errcode = 'P0002';
  end if;
  desired_status := coalesce(operation_record->>'status', 'queued');
  if desired_status not in ('queued','preprocessing','analyzing','synthesizing','succeeded','partial','failed','cancelled') then
    raise exception 'Unsupported operation status' using errcode = '22023';
  end if;
  select * into existing from tonde.director_operations
    where workspace_id = target_workspace and operation_id = (operation_record->>'operation_id')::uuid for update;
  if found then
    if existing.idempotency_key <> operation_record->>'idempotency_key' then
      raise exception 'An operation id cannot be reused with a different idempotency key' using errcode = '23505';
    end if;
    if existing.status in ('succeeded','partial') and existing.payload_hash is not null
      and operation_record->>'payload_hash' is not null and existing.payload_hash <> operation_record->>'payload_hash' then
      raise exception 'A completed operation cannot be rewritten with different content' using errcode = '23505';
    end if;
    update tonde.director_operations set status = desired_status,
      producer = coalesce(operation_record->>'producer', producer),
      provider = coalesce(operation_record->>'provider', provider),
      model = coalesce(operation_record->>'model', model),
      model_profile = coalesce(operation_record->>'model_profile', model_profile),
      attempts = coalesce((operation_record->>'attempts')::integer, attempts),
      repaired = coalesce((operation_record->>'repaired')::boolean, repaired),
      rationale = coalesce(operation_record->>'rationale', rationale),
      limitations = coalesce(operation_record->'limitations', limitations),
      payload = coalesce(operation_record->'payload', payload),
      payload_hash = coalesce(operation_record->>'payload_hash', payload_hash),
      error_code = coalesce(operation_record->>'error_code', error_code),
      error_message = coalesce(operation_record->>'error_message', error_message),
      completed_at = case when desired_status in ('succeeded','partial','failed','cancelled') then now() else completed_at end
      where id = existing.id returning * into saved;
    return jsonb_build_object('id', saved.id, 'status', saved.status, 'operation_id', saved.operation_id,
      'revision', saved.revision, 'idempotent', true);
  end if;
  insert into tonde.director_operations(workspace_id, production_id, operation_id, operation_type, scope, schema_version,
    source_revision, source_intake_revision, status, producer, provider, model, model_profile, attempts, repaired,
    idempotency_key, collaboration_mode, reference_ids, constraint_summary, rationale, limitations, payload, payload_hash,
    error_code, error_message, started_at, completed_at, created_by)
  values (target_workspace, target_production, (operation_record->>'operation_id')::uuid, operation_record->>'operation_type',
    coalesce(operation_record->>'scope', 'production'), coalesce(operation_record->>'schema_version', 'tonde.director.1'),
    (operation_record->>'source_revision')::integer, nullif(operation_record->>'source_intake_revision','')::integer,
    desired_status, coalesce(operation_record->>'producer', 'deterministic'), operation_record->>'provider', operation_record->>'model',
    coalesce(operation_record->>'model_profile', 'default'), coalesce((operation_record->>'attempts')::integer, 0),
    coalesce((operation_record->>'repaired')::boolean, false), operation_record->>'idempotency_key',
    coalesce(operation_record->>'collaboration_mode', 'stop_at_major_decisions'),
    coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(operation_record->'reference_ids','[]'::jsonb)) as value), '{}'),
    coalesce(operation_record->'constraint_summary','{}'::jsonb), coalesce(operation_record->>'rationale',''),
    coalesce(operation_record->'limitations','[]'::jsonb), coalesce(operation_record->'payload','{}'::jsonb),
    operation_record->>'payload_hash', operation_record->>'error_code', operation_record->>'error_message',
    now(), case when desired_status in ('succeeded','partial','failed','cancelled') then now() else null end, auth.uid())
  returning * into saved;
  return jsonb_build_object('id', saved.id, 'status', saved.status, 'operation_id', saved.operation_id,
    'revision', saved.revision, 'idempotent', false);
end;
$$;

-- 2. Structured Brief version with optimistic revision.
create function tonde.save_director_brief(
  target_workspace uuid, target_production uuid, expected_brief_revision integer, brief_content jsonb,
  source_operation uuid default null, producer_kind text default 'deterministic'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing tonde.director_briefs; saved tonde.director_briefs; production_row tonde.productions;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(brief_content) <> 'object' or pg_column_size(brief_content) > 200000
    or coalesce(length(btrim(brief_content->>'production_goal')), 0) = 0 or length(brief_content->>'production_goal') > 10000 then
    raise exception 'Invalid structured Brief' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(brief_content->'assumptions','[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(brief_content->'open_decisions','[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(brief_content->'conflicts','[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(brief_content->'runtime','{}'::jsonb)) <> 'object' then
    raise exception 'Invalid Brief structure' using errcode = '22023';
  end if;
  if producer_kind not in ('deterministic','model') then
    raise exception 'Unsupported Brief producer' using errcode = '22023';
  end if;
  select * into production_row from tonde.productions where workspace_id = target_workspace and id = target_production for update;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if production_row.locked_at is not null or production_row.approval <> 'draft' then
    raise exception 'This Production is protected; unlock a draft revision before editing the Brief' using errcode = '55000';
  end if;
  select * into existing from tonde.director_briefs where workspace_id = target_workspace and production_id = target_production for update;
  if found then
    if expected_brief_revision is null or existing.revision <> expected_brief_revision then
      raise exception 'The Brief changed; reload before saving' using errcode = '40001';
    end if;
    update tonde.director_briefs set brief = brief_content, producer = producer_kind,
      source_operation_id = coalesce(source_operation, source_operation_id)
      where id = existing.id returning * into saved;
  else
    if expected_brief_revision is not null then
      raise exception 'The Brief changed; reload before saving' using errcode = '40001';
    end if;
    insert into tonde.director_briefs(workspace_id, production_id, brief, producer, source_operation_id)
      values(target_workspace, target_production, brief_content, producer_kind, source_operation) returning * into saved;
  end if;
  return jsonb_build_object('id', saved.id, 'revision', saved.revision, 'producer', saved.producer);
end;
$$;

-- 3. Decision ledger: settled decisions are recorded once and re-used, never re-asked.
create function tonde.record_director_decisions(
  target_workspace uuid, target_production uuid, decision_list jsonb, decision_source text default 'studio'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item jsonb; stored integer := 0;
begin
  perform tonde_private.director_guard(target_workspace);
  if jsonb_typeof(decision_list) <> 'array' or jsonb_array_length(decision_list) > 40 then
    raise exception 'Invalid decision list' using errcode = '22023';
  end if;
  if decision_source not in ('intake','studio','correction','tonde_default') then
    raise exception 'Unsupported decision source' using errcode = '22023';
  end if;
  if not exists(select 1 from tonde.productions p where p.workspace_id = target_workspace and p.id = target_production) then
    raise exception 'Production unavailable' using errcode = 'P0002';
  end if;
  for item in select value from jsonb_array_elements(decision_list) loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'decision_id')), 0) = 0
      or length(item->>'decision_id') > 80 or length(coalesce(item->>'answer','')) > 500 then
      raise exception 'Invalid decision' using errcode = '22023';
    end if;
    insert into tonde.director_decisions as d (workspace_id, production_id, decision_id, question, answer, priority, impact, decided_by, decision_source, is_correction)
      values (target_workspace, target_production, item->>'decision_id', coalesce(item->>'question',''), coalesce(item->>'answer',''),
        coalesce(item->>'priority','high_impact'), coalesce(item->>'impact','high'),
        case when item->>'answer' = 'TONDE decides' then 'tonde' else coalesce(item->>'decided_by','creator') end,
        decision_source, coalesce((item->>'is_correction')::boolean, false))
      on conflict (production_id, decision_id) do update set
        answer = excluded.answer,
        question = case when excluded.question = '' then d.question else excluded.question end,
        priority = excluded.priority,
        impact = excluded.impact,
        decided_by = excluded.decided_by,
        decision_source = excluded.decision_source,
        is_correction = excluded.is_correction or d.is_correction;
    stored := stored + 1;
  end loop;
  return jsonb_build_object('stored', stored, 'decision_source', decision_source);
end;
$$;

revoke all on function tonde_private.director_guard(uuid) from public, anon, authenticated;
revoke all on function tonde.record_director_operation(uuid,uuid,jsonb),
  tonde.save_director_brief(uuid,uuid,integer,jsonb,uuid,text),
  tonde.record_director_decisions(uuid,uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function tonde.record_director_operation(uuid,uuid,jsonb),
  tonde.save_director_brief(uuid,uuid,integer,jsonb,uuid,text),
  tonde.record_director_decisions(uuid,uuid,jsonb,text) to authenticated;
commit;

-- Additive migration: Prompt 4 Director intelligence persistence.
-- Never rewrites an applied migration. Migrations 009/010 were applied manually by
-- the creator; this migration is additive only and does not touch them.

-- ---------------------------------------------------------------------------
-- 202610050012_202610050012_director_intelligence
-- Director intelligence: director_operations, director_briefs, director_decisions, reference_analyses, reference_findings, creative_techniques, reference_technique_links, creative_stories, director_reality_checks, plus tonde_private.director_guard and the record/save RPCs.
--
-- Run this file ONCE, after everything that precedes it in supabase/manual-apply/README.md.
-- It is intentionally not idempotent: running it twice fails with "already exists",
-- which means it was already applied, not that the file is broken.
-- ---------------------------------------------------------------------------
