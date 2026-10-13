-- Additive migration: the Production Card direction system.
--
-- A Card IS the canonical Scene. This migration deliberately adds no second Card table: the
-- Card-level direction, its provenance and its last validation report live on the Scene row that
-- Scene already is, so there is exactly one Master Production truth (constitution: one Master
-- Production; the Card is a view of it, never a parallel copy).
--
-- Everything the Card needs from the persistence layer already exists on tonde.scenes and is
-- therefore reused rather than re-implemented:
--   * guard_mutation()      - a locked Card refuses edits, revisions are database-managed, and an
--                             approved Card becomes changed_after_approval instead of silently
--                             staying approved.
--   * capture_revision()    - every change is snapshotted into tonde.object_versions, so a Card has
--                             real revisions and undo/redo history for free.
--   * register_object()     - the Card is already a registered `scene` object.
--
-- The single new write path is one guarded RPC. It re-checks the workspace guard, the Card's
-- lifecycle, the lock and the caller's expected revision, and only then patches the Card columns.
-- A stale write raises PT409 so PostgREST returns HTTP 409 instead of retrying a conflict forever
-- (migration 030's rule: never raise a bare class-40 SQLSTATE for a product decision).
begin;

-- 1. Card-level direction on the canonical Card. `card_mode` reuses the execution_method type
-- (real / ai / hybrid) because a Card's mode is the same vocabulary as its Shots'.
alter table tonde.scenes
  add column card_mode tonde.execution_method not null default 'real';
alter table tonde.scenes
  add column card_direction jsonb not null default '{}'::jsonb
    check (jsonb_typeof(card_direction) = 'object');
alter table tonde.scenes
  add column card_provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(card_provenance) = 'object');
alter table tonde.scenes
  add column card_validation jsonb not null default '{}'::jsonb
    check (jsonb_typeof(card_validation) = 'object');
alter table tonde.scenes
  add column card_generated_by text not null default 'deterministic'
    check (card_generated_by in ('deterministic', 'director', 'creator'));

-- Which Cards have direction at all is a common Studio question, so it is indexed.
create index scenes_with_card_direction on tonde.scenes(workspace_id, production_id, sort_order)
  where card_direction <> '{}'::jsonb;

-- 2. Writing a Card's direction. One row, one revision, one authority check.
create function tonde.card_direction_write(
  target_workspace uuid, target_production uuid, target_scene uuid,
  direction jsonb, mode_input text, provenance jsonb, validation jsonb,
  generated_by text, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current tonde.scenes;
  desired_mode tonde.execution_method;
  section text;
  section_text text;
  saved tonde.scenes;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  select * into current from tonde.scenes
    where workspace_id = target_workspace and production_id = target_production and id = target_scene;
  if not found then
    raise exception 'Card unavailable' using errcode = 'P0002';
  end if;
  if current.lifecycle <> 'active' then
    raise exception 'This Card is archived' using errcode = '23514';
  end if;
  -- A locked Card is the creator's authority over a version: refuse, and say how to proceed.
  if current.locked_at is not null then
    raise exception 'This Card is locked. Unlock it before changing its direction' using errcode = 'PT409';
  end if;
  if expected_revision is not null and current.revision <> expected_revision then
    raise exception 'This Card changed since you loaded it' using errcode = 'PT409';
  end if;

  if direction is null or jsonb_typeof(direction) <> 'object' then
    raise exception 'Card direction must be a JSON object' using errcode = '22023';
  end if;
  if length(btrim(coalesce(direction ->> 'title', ''))) < 2 then
    raise exception 'A Card needs a title before its direction can be saved' using errcode = '22023';
  end if;
  if length(coalesce(direction ->> 'title', '')) > 160 then
    raise exception 'A Card title is at most 160 characters' using errcode = '22023';
  end if;
  if coalesce(mode_input, '') not in ('real', 'ai', 'hybrid') then
    raise exception 'Unsupported Card mode' using errcode = '22023';
  end if;
  if coalesce(generated_by, 'director') not in ('deterministic', 'director', 'creator') then
    raise exception 'Unsupported Card direction source' using errcode = '22023';
  end if;
  desired_mode := mode_input::tonde.execution_method;

  -- Bounds keep a Card a Card: a runaway generation must not store a production manual in one
  -- section, and a value that is not text is a rejected request rather than a silent cast.
  for section in select jsonb_object_keys(direction) loop
    if jsonb_typeof(direction -> section) not in ('string', 'array') then
      raise exception 'Card direction section % must be text', section using errcode = '22023';
    end if;
    if jsonb_typeof(direction -> section) = 'string' then
      section_text := direction ->> section;
    else
      select string_agg(value, ' ') into section_text from jsonb_array_elements_text(direction -> section) as value;
    end if;
    if length(coalesce(section_text, '')) > 6000 then
      raise exception 'Card direction section % is too long to store', section using errcode = '22023';
    end if;
  end loop;
  if octet_length(direction::text) > 40000 then
    raise exception 'This Card direction is too large to store as one Card' using errcode = '22023';
  end if;

  update tonde.scenes
    set card_direction = direction,
        card_mode = desired_mode,
        card_provenance = coalesce(provenance, '{}'::jsonb),
        card_validation = coalesce(validation, '{}'::jsonb),
        card_generated_by = coalesce(generated_by, 'director')
    where workspace_id = target_workspace and production_id = target_production and id = target_scene
    returning * into saved;

  return jsonb_build_object(
    'id', saved.id, 'revision', saved.revision, 'card_mode', saved.card_mode,
    'card_generated_by', saved.card_generated_by, 'card_direction', saved.card_direction,
    'card_validation', saved.card_validation, 'card_provenance', saved.card_provenance,
    'approval', saved.approval, 'updated_at', saved.updated_at);
end $$;
revoke all on function tonde.card_direction_write(uuid, uuid, uuid, jsonb, text, jsonb, jsonb, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function tonde.card_direction_write(uuid, uuid, uuid, jsonb, text, jsonb, jsonb, text, integer)
  to authenticated;

-- 3. Reading is a plain RLS-filtered select on tonde.scenes: Card direction is production truth, not
-- a private side channel, so no read RPC is added. The existing tenant policies already cover it,
-- and `zz_stale_on_scene_change` / `zz_continuity_on_scene_change` already mark dependent analyses
-- stale when a Card's row changes, so a new direction automatically ages the recorded analyses
-- that read it. Nothing else needs to be wired for that.

-- Rollback note: this migration is additive and forward-only. Reverting it means dropping the five
-- card_* columns and the card_direction_write function in a NEW migration; applied history is never
-- rewritten.

commit;
