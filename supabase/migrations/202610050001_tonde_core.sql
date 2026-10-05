-- Additive migration: never drop, rename or import unknown hosted tables.
begin;
create schema tonde;
create schema tonde_private;
revoke all on schema tonde_private from public, anon, authenticated;
revoke all on schema tonde from public, anon;
grant usage on schema tonde to authenticated, service_role;

create type tonde.member_role as enum ('owner', 'admin', 'editor', 'viewer');
create type tonde.lifecycle as enum ('active', 'archived', 'deleted');
create type tonde.approval as enum ('draft', 'needs_review', 'approved', 'changed_after_approval');
create type tonde.execution_method as enum ('real', 'ai', 'hybrid');
create type tonde.job_state as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'retrying');
create type tonde.result_state as enum ('raw', 'needs_review', 'approved', 'rejected', 'final');
create type tonde.asset_type as enum ('character', 'voice', 'product', 'environment', 'wardrobe', 'prop', 'vehicle', 'style_bible', 'brand');
create type tonde.resource_type as enum ('camera', 'phone_camera', 'lens', 'light', 'modifier', 'stand', 'microphone', 'recorder', 'wireless_audio', 'gimbal', 'tripod', 'monopod', 'slider', 'drone', 'action_camera', 'filter', 'monitor', 'rigging', 'accessory', 'editing_software', 'photo_software', 'ai_tool');
create type tonde.production_type as enum ('social_video', 'commercial', 'advertisement', 'youtube', 'interview', 'documentary', 'music_video', 'photography', 'portrait', 'product_photography', 'fashion', 'food', 'automotive', 'architecture', 'campaign', 'thumbnail', 'poster', 'short_film', 'long_form_film', 'series', 'recurring_content', 'custom');

create table tonde.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  kind text not null default 'personal' check (kind in ('personal', 'team')),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  lifecycle tonde.lifecycle not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, owner_user_id)
);
create unique index one_personal_workspace_per_user on tonde.workspaces(owner_user_id) where kind = 'personal';
create table tonde.workspace_members (
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role tonde.member_role not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index membership_by_user on tonde.workspace_members(user_id, workspace_id);
create table tonde.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 160),
  avatar_url text,
  onboarding_state text not null default 'new' check (onboarding_state in ('new', 'in_progress', 'complete')),
  timezone text not null default 'UTC', locale text not null default 'en',
  default_workspace_id uuid references tonde.workspaces(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table tonde.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  appearance text not null default 'dark' check (appearance in ('dark', 'system')),
  email_notifications boolean not null default true,
  in_app_notifications boolean not null default true,
  reduced_motion boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Registry gives versions, bindings, conversations and future dependency edges real FK targets.
-- Domain records remain relational, not generic JSON records.
create table tonde.objects (
  id uuid primary key,
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  production_id uuid,
  kind text not null check (kind in ('project','production','series','collection','act','sequence','scene','shot','asset','reference','creative_document','dialogue_line','execution_plan','result')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, production_id, id)
);
create index objects_production on tonde.objects(workspace_id, production_id, kind);

create table tonde.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 10000),
  lifecycle tonde.lifecycle not null default 'active',
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create table tonde.series (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  project_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  cadence_metadata jsonb not null default '{}' check (jsonb_typeof(cadence_metadata) = 'object'),
  lifecycle tonde.lifecycle not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references tonde.projects(workspace_id, id) on delete restrict
);
create table tonde.series_collections (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, series_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  sort_order bigint not null default 1024 check (sort_order >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, series_id, id), unique (workspace_id, id),
  foreign key (workspace_id, series_id) references tonde.series(workspace_id, id) on delete restrict,
  unique (series_id, sort_order) deferrable initially immediate
);
create table tonde.productions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  project_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  production_type tonde.production_type not null default 'custom', custom_type text,
  execution_method tonde.execution_method not null default 'real',
  lifecycle tonde.lifecycle not null default 'active',
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  planned_duration_ms bigint check (planned_duration_ms >= 0),
  calculated_duration_ms bigint check (calculated_duration_ms >= 0),
  start_ms bigint not null default 0 check (start_ms >= 0), end_ms bigint check (end_ms >= start_ms),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references tonde.projects(workspace_id, id) on delete restrict,
  check (production_type = 'custom' or custom_type is null)
);
alter table tonde.objects add foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict deferrable initially deferred;
create table tonde.series_episodes (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, series_id uuid not null,
  collection_id uuid, production_id uuid not null,
  episode_number bigint not null check (episode_number > 0), planned_date date, published_at timestamptz,
  runtime_target_ms bigint check (runtime_target_ms >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (production_id), unique (series_id, episode_number) deferrable initially immediate,
  foreign key (workspace_id, series_id) references tonde.series(workspace_id, id) on delete restrict,
  foreign key (workspace_id, series_id, collection_id) references tonde.series_collections(workspace_id, series_id, id) on delete restrict,
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict
);
create table tonde.acts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 160), sort_order bigint not null default 1024 check (sort_order >= 0),
  planned_duration_ms bigint check (planned_duration_ms >= 0), calculated_duration_ms bigint check (calculated_duration_ms >= 0),
  start_ms bigint not null default 0 check (start_ms >= 0), end_ms bigint check (end_ms >= start_ms),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, production_id, id), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  unique (production_id, sort_order) deferrable initially immediate
);
create table tonde.sequences (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, act_id uuid,
  title text not null check (length(btrim(title)) between 1 and 160), sort_order bigint not null default 1024 check (sort_order >= 0),
  planned_duration_ms bigint check (planned_duration_ms >= 0), calculated_duration_ms bigint check (calculated_duration_ms >= 0),
  start_ms bigint not null default 0 check (start_ms >= 0), end_ms bigint check (end_ms >= start_ms),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, production_id, id), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, act_id) references tonde.acts(workspace_id, production_id, id) on delete restrict,
  unique (production_id, sort_order) deferrable initially immediate
);
create table tonde.assets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  asset_type tonde.asset_type not null, name text not null check (length(btrim(name)) between 1 and 160),
  description text not null default '' check (length(description) <= 10000),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  provenance jsonb not null default '{}' check (jsonb_typeof(provenance) = 'object'),
  search_metadata jsonb not null default '{}' check (jsonb_typeof(search_metadata) = 'object'),
  consistency_metadata jsonb not null default '{}' check (jsonb_typeof(consistency_metadata) = 'object'),
  lifecycle tonde.lifecycle not null default 'active', approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id)
);
create table tonde.scenes (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, sequence_id uuid,
  title text not null check (length(btrim(title)) between 1 and 160), purpose text not null default '', description text not null default '',
  environment_asset_id uuid, sort_order bigint not null default 1024 check (sort_order >= 0),
  planned_duration_ms bigint check (planned_duration_ms >= 0), calculated_duration_ms bigint check (calculated_duration_ms >= 0),
  start_ms bigint not null default 0 check (start_ms >= 0), end_ms bigint check (end_ms >= start_ms),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  lifecycle tonde.lifecycle not null default 'active', revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, production_id, id), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, sequence_id) references tonde.sequences(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, environment_asset_id) references tonde.assets(workspace_id, id) on delete restrict,
  unique (production_id, sort_order) deferrable initially immediate
);
create table tonde.shots (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, scene_id uuid,
  title text not null check (length(btrim(title)) between 1 and 160), description text not null default '', action text not null default '',
  sort_order bigint not null default 1024 check (sort_order >= 0), execution_method tonde.execution_method not null default 'real',
  continuity_from_shot_id uuid,
  planned_duration_ms bigint check (planned_duration_ms >= 0), calculated_duration_ms bigint check (calculated_duration_ms >= 0),
  start_ms bigint not null default 0 check (start_ms >= 0), end_ms bigint check (end_ms >= start_ms),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  lifecycle tonde.lifecycle not null default 'active', revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, production_id, id), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, production_id, continuity_from_shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  check (continuity_from_shot_id is distinct from id),
  unique (production_id, sort_order) deferrable initially immediate
);
-- Nullable scene supports standalone photographs; scenes/sequences/acts are not artificial requirements.
create table tonde.scene_participants (
  workspace_id uuid not null, production_id uuid not null, scene_id uuid not null, asset_id uuid not null,
  role text not null default 'participant',
  primary key (scene_id, asset_id),
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, asset_id) references tonde.assets(workspace_id, id) on delete restrict
);

create table tonde.production_resources (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  resource_type tonde.resource_type not null, name text not null check (length(btrim(name)) between 1 and 160),
  manufacturer text, model text, mount text, stabilization boolean,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  lifecycle tonde.lifecycle not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id)
);
create table tonde.resource_compatibility (
  workspace_id uuid not null, resource_id uuid not null, compatible_resource_id uuid not null,
  relation text not null check (relation in ('mount', 'power', 'audio', 'software', 'accessory')),
  primary key (resource_id, compatible_resource_id, relation), check (resource_id <> compatible_resource_id),
  foreign key (workspace_id, resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  foreign key (workspace_id, compatible_resource_id) references tonde.production_resources(workspace_id, id) on delete restrict
);
create table tonde.equipment_kits (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 160), lifecycle tonde.lifecycle not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id)
);
create table tonde.kit_resources (
  workspace_id uuid not null, kit_id uuid not null, resource_id uuid not null,
  quantity integer not null default 1 check (quantity > 0), primary key (kit_id, resource_id),
  foreign key (workspace_id, kit_id) references tonde.equipment_kits(workspace_id, id) on delete restrict,
  foreign key (workspace_id, resource_id) references tonde.production_resources(workspace_id, id) on delete restrict
);

create table tonde.media_files (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 's3', 'r2')),
  bucket text not null, object_key text not null,
  original_filename text not null check (length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/wav','audio/mp4','application/pdf','text/plain')),
  file_category text not null check (file_category in ('image','video','audio','document','script','thumbnail','proxy','keyframe','extracted_audio','export')),
  bytes bigint not null check (bytes between 1 and 52428800),
  width integer check (width > 0), height integer check (height > 0), duration_ms bigint check (duration_ms >= 0), checksum text,
  upload_state text not null default 'pending' check (upload_state in ('pending','uploaded','failed','deleted')),
  processing_state text not null default 'pending' check (processing_state in ('pending','processing','ready','failed')),
  retention_policy text not null default 'persistent' check (retention_policy in ('persistent','temporary','export')),
  expires_at timestamptz, derived_from_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id),
  unique (storage_provider, bucket, object_key),
  foreign key (workspace_id, derived_from_id) references tonde.media_files(workspace_id, id) on delete restrict,
  check (derived_from_id is distinct from id),
  check (storage_provider <> 'supabase' or bucket in ('tonde-uploads','tonde-asset-references','tonde-production-media','tonde-results','tonde-exports','tonde-avatars')),
  check (object_key like workspace_id::text || '/' || id::text || '/%' and object_key !~ '(^|/)\.\.(/|$)')
);
create table tonde.asset_media (
  workspace_id uuid not null, asset_id uuid not null, media_id uuid not null,
  purpose text not null default 'reference' check (purpose in ('reference','thumbnail','voice','brand')),
  primary key (asset_id, media_id),
  foreign key (workspace_id, asset_id) references tonde.assets(workspace_id, id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict
);
create table tonde.production_references (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  source_type text not null check (source_type in ('upload','url','social_url','cloud_import','recording','asset','movie','description','generated_result','previous_production')),
  source_url text check (source_url is null or source_url ~ '^https?://'), source_description text,
  rights_classification text not null default 'unknown' check (rights_classification in ('user_owned','licensed','brand_owned','authorized_identity','public_reference','third_party_inspiration','unknown')),
  state text not null default 'received' check (state in ('received','metadata_available','media_available','processing','analyzed','partially_analyzed','inaccessible','failed')),
  media_id uuid, asset_id uuid, previous_production_id uuid,
  provenance jsonb not null default '{}' check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  foreign key (workspace_id, asset_id) references tonde.assets(workspace_id, id) on delete restrict,
  foreign key (workspace_id, previous_production_id) references tonde.productions(workspace_id, id) on delete restrict
);

create table tonde.creative_documents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  scope_object_id uuid not null,
  document_type text not null check (document_type in ('brief','story','treatment','script','scene_description','shot_description','creative_note','series_bible')),
  title text not null check (length(btrim(title)) between 1 and 160), content text not null default '' check (length(content) <= 1000000),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, scope_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
alter table tonde.series add column bible_document_id uuid;
alter table tonde.series add foreign key (workspace_id, bible_document_id) references tonde.creative_documents(workspace_id, id) on delete restrict;
create table tonde.dialogue_lines (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, document_id uuid not null,
  scene_id uuid, shot_id uuid, speaker_asset_id uuid,
  line_type text not null check (line_type in ('dialogue','voiceover','narration','pause','reaction')),
  content text not null default '', sort_order bigint not null check (sort_order >= 0),
  start_ms bigint not null default 0 check (start_ms >= 0), duration_ms bigint check (duration_ms >= 0),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, document_id) references tonde.creative_documents(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, speaker_asset_id) references tonde.assets(workspace_id, id) on delete restrict,
  unique (document_id, sort_order) deferrable initially immediate
);
create table tonde.execution_plans (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, shot_id uuid not null,
  execution_method tonde.execution_method not null check (execution_method in ('real','ai')),
  camera_resource_id uuid, lens_resource_id uuid, provider text, model text,
  plan_metadata jsonb not null default '{}' check (jsonb_typeof(plan_metadata) = 'object'),
  approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id),
  unique (shot_id, execution_method),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, camera_resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  foreign key (workspace_id, lens_resource_id) references tonde.production_resources(workspace_id, id) on delete restrict,
  check ((execution_method = 'real' and provider is null and model is null) or (execution_method = 'ai' and camera_resource_id is null and lens_resource_id is null))
);
create table tonde.scope_bindings (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null,
  scope_object_id uuid not null, asset_id uuid, reference_id uuid,
  binding_role text not null check (binding_role in ('style','character','world','wardrobe','product','prop','pose','voice','brand','vehicle')),
  inheritance text not null default 'inherit' check (inheritance in ('inherit','override','exclude')),
  locked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (num_nonnulls(asset_id, reference_id) = 1),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, scope_object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, asset_id) references tonde.assets(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reference_id) references tonde.production_references(workspace_id, id) on delete restrict
);
create unique index unique_scope_asset on tonde.scope_bindings(scope_object_id, binding_role, asset_id) where asset_id is not null;
create unique index unique_scope_reference on tonde.scope_bindings(scope_object_id, binding_role, reference_id) where reference_id is not null;

create table tonde.object_versions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, object_id uuid not null,
  revision integer not null check (revision > 0), parent_version_id uuid,
  branch_name text not null default 'main' check (length(branch_name) between 1 and 100),
  actor_type text not null check (actor_type in ('user','tonde','system')), actor_user_id uuid references auth.users(id) on delete set null,
  source_action text not null, snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (object_id, revision, branch_name), unique (workspace_id, id),
  foreign key (workspace_id, object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, parent_version_id) references tonde.object_versions(workspace_id, id) on delete restrict
);
create table tonde.object_dependencies (
  workspace_id uuid not null, source_object_id uuid not null, target_object_id uuid not null,
  relation text not null check (relation in ('creative','continuity','execution','reference','derived_from')),
  primary key (source_object_id, target_object_id, relation), check (source_object_id <> target_object_id),
  foreign key (workspace_id, source_object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, target_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create table tonde.director_threads (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, scope_object_id uuid not null,
  scope_type text not null check (scope_type in ('production','story','script','act','sequence','scene','shot','character','environment','audio','edit','results')),
  title text not null default 'Production Director',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, scope_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create table tonde.director_messages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, thread_id uuid not null,
  role text not null check (role in ('user','tonde','system','tool')),
  content text not null default '' check (length(content) <= 50000),
  structured_result jsonb check (structured_result is null or jsonb_typeof(structured_result) = 'object'),
  proposal_state text check (proposal_state in ('proposed','applied','rejected')),
  related_object_id uuid, created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, thread_id) references tonde.director_threads(workspace_id, id) on delete restrict,
  foreign key (workspace_id, related_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create table tonde.results (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, scene_id uuid, shot_id uuid,
  media_id uuid not null, reference_id uuid, execution_plan_id uuid,
  state tonde.result_state not null default 'raw', approval tonde.approval not null default 'draft', locked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  provenance jsonb not null default '{}' check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_id, scene_id) references tonde.scenes(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, media_id) references tonde.media_files(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reference_id) references tonde.production_references(workspace_id, id) on delete restrict,
  foreign key (workspace_id, execution_plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict
);
create table tonde.shot_match_reports (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, shot_id uuid not null,
  result_id uuid not null, corrected_plan_id uuid,
  state text not null default 'pending' check (state in ('pending','processing','complete','failed')),
  findings jsonb not null default '[]' check (jsonb_typeof(findings) = 'array'),
  severity text check (severity in ('info','warning','critical')), recommendations jsonb not null default '[]' check (jsonb_typeof(recommendations) = 'array'),
  approval tonde.approval not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (workspace_id, production_id, shot_id) references tonde.shots(workspace_id, production_id, id) on delete restrict,
  foreign key (workspace_id, result_id) references tonde.results(workspace_id, id) on delete restrict,
  foreign key (workspace_id, corrected_plan_id) references tonde.execution_plans(workspace_id, id) on delete restrict
);

create table tonde.jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid,
  job_type text not null check (job_type in ('media_preprocessing','transcription','reference_analysis','story_generation','production_generation','prompt_compilation','shot_match','export','thumbnail','proxy','cloud_import')),
  status tonde.job_state not null default 'queued', progress integer not null default 0 check (progress between 0 and 100),
  input_object_id uuid, output_object_id uuid, input_metadata jsonb not null default '{}' check (jsonb_typeof(input_metadata) = 'object'),
  attempts integer not null default 0 check (attempts >= 0), max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  error_code text, error_message text, lease_owner text, lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz, updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, input_object_id) references tonde.objects(workspace_id, id) on delete restrict,
  foreign key (workspace_id, output_object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create table tonde.exports (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, production_id uuid not null, job_id uuid not null,
  requested_format text not null check (requested_format in ('pdf','docx','zip','json')),
  package_type text not null check (package_type in ('complete','script','shot_list','storyboard','prompt_pack','camera_plan','continuity_report','audio_plan','edit_plan','structured_data')),
  production_version_id uuid not null, generated_media_id uuid,
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), completed_at timestamptz, expires_at timestamptz,
  unique (job_id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, job_id) references tonde.jobs(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_version_id) references tonde.object_versions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, generated_media_id) references tonde.media_files(workspace_id, id) on delete restrict
);
-- Provider credentials are NEVER stored in the exposed schema.
create table tonde.integration_connections (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  provider text not null check (length(provider) between 1 and 100), provider_account_id text,
  status text not null default 'disconnected' check (status in ('disconnected','connected','expired','revoked')),
  scopes text[] not null default '{}', connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, provider, provider_account_id)
);
create table tonde_private.integration_credentials (
  connection_id uuid primary key references tonde.integration_connections(id) on delete restrict,
  ciphertext bytea not null check (octet_length(ciphertext) >= 32), encryption_key_id text not null,
  expires_at timestamptz, updated_at timestamptz not null default now()
);
create table tonde.billing_accounts (
  workspace_id uuid primary key references tonde.workspaces(id) on delete restrict,
  provider text not null, provider_customer_id text not null unique, provider_subscription_id text unique,
  plan_reference text, subscription_status text not null default 'none' check (subscription_status in ('none','trialing','active','past_due','cancelled','incomplete')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table tonde.usage_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  metric text not null, quantity bigint not null check (quantity >= 0), unit text not null,
  idempotency_key text not null, job_id uuid, created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, job_id) references tonde.jobs(workspace_id, id) on delete restrict
);
create table tonde.audit_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references tonde.workspaces(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null, event_type text not null,
  object_id uuid, object_kind text not null,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

-- Index query boundaries: workspace lists; production hierarchy slices; ordered messages/versions; worker claims.
create index projects_workspace_recent on tonde.projects(workspace_id, lifecycle, updated_at desc, id);
create index productions_project on tonde.productions(workspace_id, project_id, lifecycle, updated_at desc, id);
create index productions_approval on tonde.productions(workspace_id, approval) where lifecycle = 'active';
create index series_project on tonde.series(workspace_id, project_id);
create index episodes_series on tonde.series_episodes(workspace_id, series_id, episode_number);
create index acts_production on tonde.acts(workspace_id, production_id, sort_order);
create index sequences_parent on tonde.sequences(workspace_id, production_id, act_id, sort_order);
create index scenes_parent on tonde.scenes(workspace_id, production_id, sequence_id, sort_order);
create index shots_parent on tonde.shots(workspace_id, production_id, scene_id, sort_order);
create index assets_type on tonde.assets(workspace_id, asset_type, lifecycle, updated_at desc);
create index resources_type on tonde.production_resources(workspace_id, resource_type, lifecycle);
create index media_processing on tonde.media_files(workspace_id, processing_state, created_at desc);
create index references_production on tonde.production_references(workspace_id, production_id, state);
create index bindings_scope on tonde.scope_bindings(workspace_id, production_id, scope_object_id);
create index documents_scope on tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type);
create index versions_history on tonde.object_versions(workspace_id, object_id, created_at desc, id);
create index dependencies_target on tonde.object_dependencies(workspace_id, target_object_id);
create index threads_production on tonde.director_threads(workspace_id, production_id, updated_at desc);
create index messages_history on tonde.director_messages(workspace_id, thread_id, created_at desc, id);
create index results_shot on tonde.results(workspace_id, production_id, shot_id, created_at desc);
create index match_shot on tonde.shot_match_reports(workspace_id, production_id, shot_id);
create index exports_production on tonde.exports(workspace_id, production_id, created_at desc);
create index jobs_workspace on tonde.jobs(workspace_id, status, created_at desc);
create index jobs_claimable on tonde.jobs(available_at, created_at) where status in ('queued','retrying');
create index audits_workspace on tonde.audit_events(workspace_id, created_at desc, id);
create index usage_workspace on tonde.usage_events(workspace_id, created_at desc);
commit;
