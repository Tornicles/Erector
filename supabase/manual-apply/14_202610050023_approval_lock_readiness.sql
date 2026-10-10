begin;

-- 1. Vocabulary. Storage codes are the generated product vocabulary keys.
create type tonde.access_action as enum ('approve','request_review','reopen','lock','unlock');
create type tonde.readiness_state as enum ('ready','ready_with_warnings','needs_review','blocked','unknown');
create type tonde.readiness_dimension as enum
  ('decisions','story','script','scene_plan','shots','continuity','resources','real_execution',
   'ai_execution','approvals','dependencies','results','delivery');

-- 2. Access decisions. Append-only. Each row names the object, the action, the approval and lock
-- state before and after, and - for an approval - the exact revision it accepted, so approval can
-- never silently describe newer content. Actor and time are recorded, so unlock is explicit.
create table tonde.access_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_id uuid not null,
  object_id uuid not null,
  object_kind text not null check (length(object_kind) between 1 and 40),
  action tonde.access_action not null,
  from_approval tonde.approval,
  to_approval tonde.approval,
  from_locked boolean not null default false,
  to_locked boolean not null default false,
  pinned_revision integer check (pinned_revision is null or pinned_revision > 0),
  note text not null default '' check (length(note) <= 800),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, production_id) references tonde.productions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, object_id) references tonde.objects(workspace_id, id) on delete restrict
);
create index access_decisions_by_object on tonde.access_decisions(workspace_id, object_id, created_at desc, id);
create index access_decisions_recent on tonde.access_decisions(workspace_id, production_id, created_at desc, id);

-- A decision is a record of something that happened. It is never edited or deleted.
create function tonde_private.access_decisions_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Access decisions are an append-only record and cannot be changed' using errcode = '23514';
end $$;
create trigger access_decisions_immutable before update or delete on tonde.access_decisions
  for each row execute function tonde_private.access_decisions_immutable();
revoke all on function tonde_private.access_decisions_immutable() from public, anon, authenticated, service_role;

-- 3. Private helpers (not user-facing; reachable only through the security-definer RPCs below).

-- The approval of a canonical object, read from the table that owns it.
create function tonde_private.ax_approval(target_workspace uuid, target_object uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare kind_value text; value text;
begin
  select o.kind into kind_value from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  case kind_value
    when 'production' then select approval::text into value from tonde.productions where id = target_object;
    when 'act' then select approval::text into value from tonde.acts where id = target_object;
    when 'sequence' then select approval::text into value from tonde.sequences where id = target_object;
    when 'scene' then select approval::text into value from tonde.scenes where id = target_object;
    when 'shot' then select approval::text into value from tonde.shots where id = target_object;
    when 'execution_plan' then select approval::text into value from tonde.execution_plans where id = target_object;
    when 'dialogue_line' then select approval::text into value from tonde.dialogue_lines where id = target_object;
    when 'creative_document' then select approval::text into value from tonde.creative_documents where id = target_object;
    when 'result' then select approval::text into value from tonde.results where id = target_object;
    when 'asset' then select approval::text into value from tonde.assets where id = target_object;
    else value := null;
  end case;
  return value;
end $$;
revoke all on function tonde_private.ax_approval(uuid,uuid) from public, anon, authenticated, service_role;

-- When a canonical object's own lock column was set (the enclosing scope is resolved by pi_is_locked).
create function tonde_private.ax_locked_at(target_workspace uuid, target_object uuid) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare kind_value text; value timestamptz;
begin
  select o.kind into kind_value from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  case kind_value
    when 'production' then select locked_at into value from tonde.productions where id = target_object;
    when 'act' then select locked_at into value from tonde.acts where id = target_object;
    when 'sequence' then select locked_at into value from tonde.sequences where id = target_object;
    when 'scene' then select locked_at into value from tonde.scenes where id = target_object;
    when 'shot' then select locked_at into value from tonde.shots where id = target_object;
    when 'execution_plan' then select locked_at into value from tonde.execution_plans where id = target_object;
    when 'dialogue_line' then select locked_at into value from tonde.dialogue_lines where id = target_object;
    when 'creative_document' then select locked_at into value from tonde.creative_documents where id = target_object;
    when 'result' then select locked_at into value from tonde.results where id = target_object;
    when 'asset' then select locked_at into value from tonde.assets where id = target_object;
    else value := null;
  end case;
  return value;
end $$;
revoke all on function tonde_private.ax_locked_at(uuid,uuid) from public, anon, authenticated, service_role;

-- Write an approval to the table that owns the object. Returns the resulting revision, or null
-- when the object row is missing.
create function tonde_private.ax_set_approval(target_workspace uuid, target_production uuid,
  target_object uuid, approval_value tonde.approval) returns integer
language plpgsql security definer set search_path = '' as $$
declare kind_value text; new_rev integer;
begin
  select o.kind into kind_value from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  case kind_value
    when 'production' then update tonde.productions set approval = approval_value
      where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'act' then update tonde.acts set approval = approval_value
      where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'sequence' then update tonde.sequences set approval = approval_value
      where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'scene' then update tonde.scenes set approval = approval_value
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'shot' then update tonde.shots set approval = approval_value
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'execution_plan' then update tonde.execution_plans set approval = approval_value
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'dialogue_line' then update tonde.dialogue_lines set approval = approval_value
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'creative_document' then update tonde.creative_documents set approval = approval_value
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'result' then update tonde.results set approval = approval_value
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    else raise exception 'That object kind cannot be approved' using errcode = '22023';
  end case;
  return new_rev;
end $$;
revoke all on function tonde_private.ax_set_approval(uuid,uuid,uuid,tonde.approval) from public, anon, authenticated, service_role;

-- Write a lock to the table that owns the object. Returns the resulting revision, or null.
create function tonde_private.ax_set_lock(target_workspace uuid, target_production uuid,
  target_object uuid, locked_value boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare kind_value text; new_rev integer; stamp timestamptz;
begin
  stamp := case when coalesce(locked_value,false) then now() else null end;
  select o.kind into kind_value from tonde.objects o where o.workspace_id = target_workspace and o.id = target_object;
  case kind_value
    when 'production' then update tonde.productions set locked_at = stamp
      where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'act' then update tonde.acts set locked_at = stamp
      where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'sequence' then update tonde.sequences set locked_at = stamp
      where workspace_id = target_workspace and id = target_object returning revision into new_rev;
    when 'scene' then update tonde.scenes set locked_at = stamp
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'shot' then update tonde.shots set locked_at = stamp
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'execution_plan' then update tonde.execution_plans set locked_at = stamp
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'dialogue_line' then update tonde.dialogue_lines set locked_at = stamp
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'creative_document' then update tonde.creative_documents set locked_at = stamp
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    when 'result' then update tonde.results set locked_at = stamp
      where workspace_id = target_workspace and production_id = target_production and id = target_object returning revision into new_rev;
    else raise exception 'That object kind cannot be locked' using errcode = '22023';
  end case;
  return new_rev;
end $$;
revoke all on function tonde_private.ax_set_lock(uuid,uuid,uuid,boolean) from public, anon, authenticated, service_role;

-- One readiness blocker, with the real scope it points at so the surface can navigate to it.
create function tonde_private.rd_blocker(code_value text, severity_value text, dimension_value text,
  problem_value text, object_id uuid, label_value text, kind_value text,
  why_value text, action_value text, source_value text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('code', code_value, 'severity', severity_value, 'dimension', dimension_value,
    'problem', problem_value, 'affected_object_id', object_id, 'affected_label', label_value,
    'affected_kind', kind_value, 'why_it_matters', why_value, 'required_action', action_value,
    'action_source', source_value);
$$;
revoke all on function tonde_private.rd_blocker(text,text,text,text,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;

-- 4. Approval decision. The creator accepts a specific revision, requests review, or reopens.
-- An AI or service-role operation cannot manufacture this: guard_human_acceptance rejects it in
-- the database, and this RPC requires an authenticated workspace editor.
create function tonde.approval_decide(target_workspace uuid, target_production uuid, target_object uuid,
  decision text, expected_revision integer default null, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare object_row tonde.objects; current_rev integer; from_approval text; from_locked boolean;
  desired tonde.approval; new_rev integer; approval_after text;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  if decision not in ('approve','request_review','reopen') then
    raise exception 'A review decision is approve, request_review or reopen' using errcode = '22023';
  end if;
  current_rev := tonde_private.pi_object_revision(target_workspace, target_object);
  if current_rev is null then raise exception 'That object cannot be reviewed' using errcode = '22023'; end if;
  -- Stale operations are rejected: an approval never lands on content the creator did not see.
  if expected_revision is not null and current_rev <> expected_revision then
    raise exception 'That object changed since you loaded it. Review the current revision.' using errcode = '40001';
  end if;
  from_approval := tonde_private.ax_approval(target_workspace, target_object);
  from_locked := tonde_private.pi_is_locked(target_workspace, target_object);
  desired := case decision when 'approve' then 'approved'::tonde.approval
    when 'request_review' then 'needs_review'::tonde.approval else 'draft'::tonde.approval end;
  new_rev := tonde_private.ax_set_approval(target_workspace, target_production, target_object, desired);
  if new_rev is null then raise exception 'That object is unavailable in this Production' using errcode = 'P0002'; end if;
  approval_after := tonde_private.ax_approval(target_workspace, target_object);
  insert into tonde.access_decisions(workspace_id, production_id, object_id, object_kind, action,
    from_approval, to_approval, from_locked, to_locked, pinned_revision, note, actor_user_id)
  values (target_workspace, target_production, target_object, object_row.kind, decision::tonde.access_action,
    from_approval::tonde.approval, approval_after::tonde.approval, coalesce(from_locked,false), coalesce(from_locked,false),
    case when decision = 'approve' then new_rev else null end, left(coalesce(note_text,''), 800), auth.uid());
  return jsonb_build_object('object_id', target_object, 'object_kind', object_row.kind,
    'label', tonde_private.pi_label(target_workspace, target_object),
    'action', decision, 'approval', approval_after, 'revision', new_rev,
    'approved_revision', case when decision = 'approve' then new_rev else null end,
    'locked', coalesce(from_locked,false), 'note', left(coalesce(note_text,''), 800),
    'actor_user_id', auth.uid(), 'decided_at', now(),
    'meaning', case when decision = 'approve'
        then 'A creator accepted this exact revision. Approval is a human decision, not a generation result.'
      when decision = 'request_review' then 'This revision is waiting for a creator review.'
      else 'This revision is back to draft.' end);
end $$;

-- 5. Lock decision. Locking protects a decision from incidental change; unlocking is explicit and
-- records actor, time and reason. Lock and approval stay independent.
create function tonde.lock_set(target_workspace uuid, target_production uuid, target_object uuid,
  locked boolean, expected_revision integer default null, note_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare object_row tonde.objects; current_rev integer; was_locked boolean; new_rev integer; is_locked boolean;
begin
  perform tonde_private.studio_guard(target_workspace, target_production, null);
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  current_rev := tonde_private.pi_object_revision(target_workspace, target_object);
  if current_rev is null then raise exception 'That object cannot be locked' using errcode = '22023'; end if;
  if expected_revision is not null and current_rev <> expected_revision then
    raise exception 'That object changed since you loaded it' using errcode = '40001';
  end if;
  was_locked := coalesce(tonde_private.pi_is_locked(target_workspace, target_object), false);
  if coalesce(locked,false) = was_locked then
    raise exception 'That object is already %', case when was_locked then 'locked' else 'unlocked' end using errcode = '23514';
  end if;
  new_rev := tonde_private.ax_set_lock(target_workspace, target_production, target_object, coalesce(locked,false));
  if new_rev is null then raise exception 'That object is unavailable in this Production' using errcode = 'P0002'; end if;
  is_locked := coalesce(tonde_private.pi_is_locked(target_workspace, target_object), false);
  insert into tonde.access_decisions(workspace_id, production_id, object_id, object_kind, action,
    from_approval, to_approval, from_locked, to_locked, pinned_revision, note, actor_user_id)
  values (target_workspace, target_production, target_object, object_row.kind,
    case when coalesce(locked,false) then 'lock' else 'unlock' end::tonde.access_action,
    tonde_private.ax_approval(target_workspace, target_object)::tonde.approval,
    tonde_private.ax_approval(target_workspace, target_object)::tonde.approval,
    was_locked, is_locked, current_rev, left(coalesce(note_text,''), 800), auth.uid());
  return jsonb_build_object('object_id', target_object, 'object_kind', object_row.kind,
    'label', tonde_private.pi_label(target_workspace, target_object),
    'task', case when coalesce(locked,false) then 'lock' else 'unlock' end,
    'locked', is_locked, 'revision', new_rev, 'was_locked', was_locked,
    'note', left(coalesce(note_text,''), 800), 'actor_user_id', auth.uid(), 'decided_at', now(),
    'meaning', case when is_locked
        then 'This object is protected from incidental change. Approval is unaffected.'
        else 'This object is unlocked. The unlock and its reason are on record.' end);
end $$;

-- 6. Approval and lock state of one object: the current approval, the revision it named, whether
-- content moved since, the reviewer and time, and whether it is locked and why.
create function tonde.access_state(target_workspace uuid, target_production uuid, target_object uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare object_row tonde.objects; approval_text text; locked_value boolean; current_rev integer;
  approved_rev integer; approved_by uuid; approved_at timestamptz; locked_by uuid; lock_note text;
  lock_stamp timestamptz; decisions jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  approval_text := tonde_private.ax_approval(target_workspace, target_object);
  locked_value := coalesce(tonde_private.pi_is_locked(target_workspace, target_object), false);
  current_rev := tonde_private.pi_object_revision(target_workspace, target_object);
  select d.pinned_revision, d.actor_user_id, d.created_at into approved_rev, approved_by, approved_at
    from tonde.access_decisions d where d.workspace_id = target_workspace and d.object_id = target_object
      and d.action = 'approve' order by d.created_at desc, d.id desc limit 1;
  select d.actor_user_id, d.created_at, d.note into locked_by, lock_stamp, lock_note
    from tonde.access_decisions d where d.workspace_id = target_workspace and d.object_id = target_object
      and d.action = 'lock' order by d.created_at desc, d.id desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('action', d.action, 'from_approval', d.from_approval,
      'to_approval', d.to_approval, 'from_locked', d.from_locked, 'to_locked', d.to_locked,
      'pinned_revision', d.pinned_revision, 'note', d.note, 'actor_user_id', d.actor_user_id,
      'created_at', d.created_at) order by d.created_at desc, d.id desc), '[]'::jsonb) into decisions
    from (select * from tonde.access_decisions d where d.workspace_id = target_workspace
      and d.object_id = target_object order by d.created_at desc, d.id desc limit 20) d;
  return jsonb_build_object(
    'object_id', target_object, 'object_kind', object_row.kind,
    'label', tonde_private.pi_label(target_workspace, target_object),
    'approval', approval_text, 'locked', locked_value, 'current_revision', current_rev,
    'approved_revision', approved_rev, 'approved_by', approved_by, 'approved_at', approved_at,
    'changed_since_approval', approval_text = 'changed_after_approval',
    'locked_at', case when locked_value then coalesce(tonde_private.ax_locked_at(target_workspace, target_object), lock_stamp) else null end,
    'locked_by', case when locked_value then locked_by else null end,
    'lock_reason', case when locked_value then coalesce(lock_note, '') else '' end,
    'decisions', decisions,
    'note', 'Approval names the exact revision it accepted. Newer content is reported as changed after approval, never as still approved. Lock and approval are independent.');
end $$;

-- 7. The recorded decision history of one object.
create function tonde.access_history(target_workspace uuid, target_production uuid, target_object uuid,
  max_rows integer default 50, skip_rows integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare object_row tonde.objects; total integer; items jsonb;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  object_row := tonde_private.vb_object(target_workspace, target_production, target_object);
  select count(*) into total from tonde.access_decisions d
    where d.workspace_id = target_workspace and d.object_id = target_object;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'action', d.action, 'from_approval', d.from_approval,
      'to_approval', d.to_approval, 'from_locked', d.from_locked, 'to_locked', d.to_locked,
      'pinned_revision', d.pinned_revision, 'note', d.note, 'actor_user_id', d.actor_user_id,
      'created_at', d.created_at) order by d.created_at desc, d.id desc), '[]'::jsonb) into items
    from (select * from tonde.access_decisions d where d.workspace_id = target_workspace
      and d.object_id = target_object order by d.created_at desc, d.id desc
      limit greatest(1, least(coalesce(max_rows,50), 200)) offset greatest(0, coalesce(skip_rows,0))) d;
  return jsonb_build_object('object_id', target_object, 'object_kind', object_row.kind,
    'total', total, 'items', items,
    'note', 'This is a record of creator decisions. It is append-only.');
end $$;

-- 8. Production readiness. A category derived from real criteria, with actionable dimensions and
-- drill-down blockers - never an arbitrary score. Provider availability is external and is not
-- guessed here; nothing unavailable is fabricated.
create function tonde.production_readiness(target_workspace uuid, target_production uuid,
  expected_production_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current tonde.productions; blockers jsonb := '[]'::jsonb; dims jsonb := '[]'::jsonb;
  blocking_count integer := 0; review_count integer := 0; warning_count integer := 0;
  state_value tonde.readiness_state; dim_state tonde.readiness_state;
  db integer; dr integer; dw integer; present boolean; dim_name text;
  has_story boolean; has_script boolean; has_scenes boolean; has_shots boolean; has_continuity boolean;
  has_resources boolean; has_real boolean; has_ai boolean; has_decisions boolean; has_dependencies boolean;
  has_results boolean; has_delivery boolean; rec record; headline text;
begin
  perform tonde_private.pi_read_guard(target_workspace);
  select * into current from tonde.productions where workspace_id = target_workspace and id = target_production;
  if not found then raise exception 'Production unavailable' using errcode = 'P0002'; end if;
  if expected_production_revision is not null and current.revision <> expected_production_revision then
    raise exception 'The Production changed since you loaded it' using errcode = '40001';
  end if;
  if current.lifecycle <> 'active' then
    return jsonb_build_object('production_id', target_production, 'production_revision', current.revision,
      'title', current.title, 'state', 'unknown', 'dimensions', '[]'::jsonb, 'blockers', '[]'::jsonb,
      'counts', jsonb_build_object('blocking', 0, 'review', 0, 'warning', 0, 'total', 0),
      'headline', 'This Production is archived, so readiness is not evaluated.',
      'notes', jsonb_build_array('Archived Productions are not scored or judged.'),
      'generated_at', now());
  end if;

  has_story := exists (select 1 from tonde.creative_documents d where d.workspace_id = target_workspace
    and d.production_id = target_production and d.document_type in ('story','treatment') and length(btrim(d.content)) > 0);
  has_script := exists (select 1 from tonde.creative_documents d where d.workspace_id = target_workspace
    and d.production_id = target_production and d.document_type = 'script' and length(btrim(d.content)) > 0);
  has_scenes := exists (select 1 from tonde.scenes s where s.workspace_id = target_workspace and s.production_id = target_production and s.lifecycle = 'active');
  has_shots := exists (select 1 from tonde.shots h where h.workspace_id = target_workspace and h.production_id = target_production and h.lifecycle = 'active');
  has_continuity := exists (select 1 from tonde.continuity_findings f where f.workspace_id = target_workspace and f.production_id = target_production);
  has_resources := exists (select 1 from tonde.real_plan_requirements r where r.workspace_id = target_workspace and r.production_id = target_production);
  has_real := exists (select 1 from tonde.execution_plans p where p.workspace_id = target_workspace and p.production_id = target_production and p.execution_method = 'real');
  has_ai := exists (select 1 from tonde.execution_plans p where p.workspace_id = target_workspace and p.production_id = target_production and p.execution_method = 'ai');
  has_decisions := exists (select 1 from tonde.director_decisions d where d.workspace_id = target_workspace and d.production_id = target_production);
  has_dependencies := exists (select 1 from tonde.stale_artifacts a where a.workspace_id = target_workspace and a.production_id = target_production and a.state <> 'current');
  has_results := exists (select 1 from tonde.results r where r.workspace_id = target_workspace and r.production_id = target_production);
  has_delivery := exists (select 1 from tonde.exports e where e.workspace_id = target_workspace and e.production_id = target_production);

  -- Unresolved blocking decisions the Director defaulted on and no creator has answered.
  for rec in select d.id, d.decision_id, d.question from tonde.director_decisions d
    where d.workspace_id = target_workspace and d.production_id = target_production
      and d.priority = 'blocking' and d.decided_by = 'tonde' order by d.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('unresolved_decision','blocking','decisions',
      'An open blocking decision has no creator answer', current.id, current.title, 'production',
      'A blocking intake decision is still on a TONDE default instead of a creator answer.',
      'Answer it, or record the decision, in Director intake.', 'director_decision');
  end loop;

  -- Story and script.
  if not has_story then
    blockers := blockers || tonde_private.rd_blocker('missing_story','review','story',
      'No story or treatment has been written yet', current.id, current.title, 'production',
      'There is no narrative foundation to plan scenes and shots against.',
      'Write a story or treatment, or record why none is needed.', 'creative_document');
  end if;
  if not has_script and has_scenes then
    blockers := blockers || tonde_private.rd_blocker('missing_script','warning','script',
      'No script exists for a production that already has scenes', current.id, current.title, 'production',
      'Dialogue and action cannot be checked against a script.',
      'Write a script, or accept that this production is planned without one.', 'creative_document');
  end if;

  -- Scene plan.
  if not has_scenes then
    blockers := blockers || tonde_private.rd_blocker('no_scenes','blocking','scene_plan',
      'No scenes have been planned', current.id, current.title, 'production',
      'Shots, timing and execution all depend on a scene plan.',
      'Plan the first Scene in Studio.', 'scene');
  end if;
  for rec in select s.id, s.title from tonde.scenes s where s.workspace_id = target_workspace
    and s.production_id = target_production and s.lifecycle = 'active'
    and not exists (select 1 from tonde.shots h where h.workspace_id = s.workspace_id and h.scene_id = s.id and h.lifecycle = 'active')
    order by s.sort_order, s.title limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('scene_without_shots','warning','scene_plan',
      'A Scene has no Shots yet', rec.id, rec.title, 'scene',
      'A Scene with no Shots has no executable coverage.',
      'Add the Shots for this Scene.', 'scene');
  end loop;

  -- Shots.
  for rec in select h.id, h.title from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active'
    and coalesce(h.planned_duration_ms, 0) = 0 order by h.sort_order limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('shot_without_duration','warning','shots',
      'A Shot has no planned duration', rec.id, rec.title, 'shot',
      'The Scene and Production runtime cannot be reconciled without it.',
      'Set the Shot duration.', 'shot');
  end loop;
  for rec in select h.id, h.title from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active'
    and not exists (select 1 from tonde.execution_plans p where p.workspace_id = h.workspace_id and p.shot_id = h.id)
    order by h.sort_order limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('shot_unplanned','warning','shots',
      'A Shot has no execution plan', rec.id, rec.title, 'shot',
      'Without a Real or AI plan there is no way to execute this Shot.',
      'Choose Real or AI for this Shot and plan it.', 'shot');
  end loop;
  -- A Scene participant that names an archived Asset.
  for rec in select distinct h.id, h.title, a.name as asset_name from tonde.scene_participants sp
    join tonde.scenes s on s.workspace_id = sp.workspace_id and s.id = sp.scene_id
    join tonde.shots h on h.workspace_id = sp.workspace_id and h.scene_id = sp.scene_id and h.lifecycle = 'active'
    join tonde.assets a on a.workspace_id = sp.workspace_id and a.id = sp.asset_id
    where sp.workspace_id = target_workspace and sp.production_id = target_production and a.lifecycle <> 'active'
    limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('missing_asset','warning','scene_plan',
      'A Scene participant Asset is archived: ' || rec.asset_name, rec.id, rec.title, 'shot',
      'A Shot in this Scene expects an Asset that is no longer active.',
      'Restore the Asset or remove it from the Scene.', 'asset');
  end loop;

  -- Continuity.
  for rec in select f.id, f.explanation, f.severity from tonde.continuity_findings f
    where f.workspace_id = target_workspace and f.production_id = target_production and f.state = 'open'
      and f.severity = 'critical' order by f.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('continuity_critical','blocking','continuity',
      rec.explanation, rec.id, 'Continuity finding', 'continuity_finding',
      'A critical continuity conflict is unresolved.',
      'Resolve or explicitly accept the continuity finding.', 'continuity_finding');
  end loop;
  for rec in select f.id, f.explanation from tonde.continuity_findings f
    where f.workspace_id = target_workspace and f.production_id = target_production and f.state = 'open'
      and f.severity = 'warning' order by f.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('continuity_warning','review','continuity',
      rec.explanation, rec.id, 'Continuity finding', 'continuity_finding',
      'A continuity warning is unresolved.',
      'Review the finding and decide.', 'continuity_finding');
  end loop;

  -- References and media availability.
  for rec in select r.id, r.source_description, r.state from tonde.production_references r
    where r.workspace_id = target_workspace and r.production_id = target_production
      and r.state in ('inaccessible','failed') order by r.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('reference_unavailable','review','resources',
      'A Production Reference could not be read', rec.id, coalesce(nullif(rec.source_description, ''), 'Reference'),
      'reference', 'A reference that cannot be read cannot inform the production.',
      'Re-import or replace the reference.', 'reference');
  end loop;
  for rec in select r.id, r.source_description from tonde.production_references r
    where r.workspace_id = target_workspace and r.production_id = target_production
      and r.state = 'received' order by r.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('reference_media_unavailable','warning','resources',
      'A Production Reference has no available media yet', rec.id,
      coalesce(nullif(rec.source_description, ''), 'Reference'), 'reference',
      'Media that is not available cannot be analysed here.',
      'Upload the media, or record the reference as description-only.', 'reference');
  end loop;

  -- Resources and Real execution.
  for rec in select r.id, r.label, r.shot_id from tonde.real_plan_requirements r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.status = 'missing'
    order by r.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('missing_resource','blocking','resources',
      'A required resource is missing: ' || rec.label, rec.shot_id,
      tonde_private.pi_label(target_workspace, rec.shot_id), 'shot',
      'A Real Shot cannot be executed without its required resource.',
      'Assign a resource, a substitute, or switch the Shot to AI.', 'real_plan_requirement');
  end loop;
  for rec in select r.id, r.label, r.shot_id from tonde.real_plan_requirements r
    where r.workspace_id = target_workspace and r.production_id = target_production and r.status = 'unverified'
    order by r.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('unverified_resource','review','resources',
      'A required resource is unverified: ' || rec.label, rec.shot_id,
      tonde_private.pi_label(target_workspace, rec.shot_id), 'shot',
      'An unverified resource may or may not be available on the day.',
      'Confirm the resource or its substitute.', 'real_plan_requirement');
  end loop;
  for rec in select h.id, h.title from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active' and h.execution_method = 'real'
    and not exists (select 1 from tonde.execution_plans p where p.workspace_id = h.workspace_id
      and p.shot_id = h.id and p.execution_method = 'real')
    order by h.sort_order limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('real_shot_unplanned','review','real_execution',
      'A Real Shot has no Real plan', rec.id, rec.title, 'shot',
      'The Shot is marked Real but has no plan to shoot it.',
      'Plan the Real execution, or switch the Shot.', 'shot');
  end loop;
  for rec in select p.id, p.shot_id from tonde.execution_plans p where p.workspace_id = target_workspace
    and p.production_id = target_production and p.execution_method = 'real'
    and cardinality(p.safety_flags) > 0 order by p.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('safety_blocked','blocking','real_execution',
      'A Real plan carries an unresolved safety flag', rec.shot_id,
      tonde_private.pi_label(target_workspace, rec.shot_id), 'shot',
      'A safety flag must be resolved before this Shot is executed.',
      'Resolve the safety flag or replace the setup.', 'execution_plan');
  end loop;

  -- AI execution. Provider availability is external and is never guessed here: this reports only
  -- local, real state - an AI plan that is not yet approved.
  select count(*) into dw from tonde.execution_plans p where p.workspace_id = target_workspace
    and p.production_id = target_production and p.execution_method = 'ai'
    and p.approval in ('draft','needs_review');
  if dw > 0 then
    blockers := blockers || tonde_private.rd_blocker('ai_plan_unapproved','warning','ai_execution',
      dw || ' AI plan' || case when dw = 1 then ' is' else 's are' end || ' not approved yet', current.id,
      current.title, 'production', 'AI generation should not start from an unapproved plan.',
      'Approve the AI plan before generating.', 'execution_plan');
  end if;

  -- Approvals. Content that moved after approval needs a fresh review. Nothing is called
  -- "critical" without a real signal.
  for rec in select o.id, o.kind from tonde.objects o where o.workspace_id = target_workspace
    and o.production_id = target_production
    and tonde_private.ax_approval(target_workspace, o.id) = 'changed_after_approval'
    order by o.kind, o.id limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('changed_after_approval','review','approvals',
      'Approved content changed since it was approved', rec.id,
      tonde_private.pi_label(target_workspace, rec.id), rec.kind,
      'An approval describes a specific revision; it does not silently cover newer content.',
      'Review the new revision and approve it, or restore the approved revision.', rec.kind);
  end loop;
  select count(*) into dw from tonde.shots h where h.workspace_id = target_workspace
    and h.production_id = target_production and h.lifecycle = 'active' and h.approval <> 'approved'
    and exists (select 1 from tonde.execution_plans p where p.workspace_id = h.workspace_id and p.shot_id = h.id);
  if dw > 0 then
    blockers := blockers || tonde_private.rd_blocker('planned_shots_unapproved','warning','approvals',
      dw || ' planned Shot' || case when dw = 1 then ' is' else 's are' end || ' not approved', current.id,
      current.title, 'production', 'Planned Shots that are not approved are not cleared to execute.',
      'Review and approve the planned Shots.', 'shot');
  end if;

  -- Dependencies: stale artifacts and locked objects that need review.
  for rec in select a.id, a.object_id, a.reason from tonde.stale_artifacts a
    where a.workspace_id = target_workspace and a.production_id = target_production and a.state = 'conflicted'
    order by a.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('stale_conflicted','review','dependencies',
      rec.reason, rec.object_id, tonde_private.pi_label(target_workspace, rec.object_id), 'stale_artifact',
      'Approved content depends on a changed source and needs review.',
      'Review the dependent work against the new source.', 'stale_artifact');
  end loop;
  for rec in select a.id, a.object_id, a.reason from tonde.stale_artifacts a
    where a.workspace_id = target_workspace and a.production_id = target_production and a.state = 'stale'
    order by a.created_at limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('stale_artifact','warning','dependencies',
      rec.reason, rec.object_id, tonde_private.pi_label(target_workspace, rec.object_id), 'stale_artifact',
      'Derived work no longer matches the source it came from.',
      'Refresh or re-derive the affected work.', 'stale_artifact');
  end loop;
  for rec in select distinct a.object_id from tonde.stale_artifacts a
    where a.workspace_id = target_workspace and a.production_id = target_production and a.state <> 'current'
      and tonde_private.pi_is_locked(target_workspace, a.object_id)
    limit 25 loop
    blockers := blockers || tonde_private.rd_blocker('locked_needs_review','review','dependencies',
      'A locked object needs review', rec.object_id, tonde_private.pi_label(target_workspace, rec.object_id),
      'locked', 'Locked content was left untouched and needs an explicit unlock before it can change.',
      'Unlock it deliberately, or resolve the review without changing it.', 'locked');
  end loop;

  -- Results, when any exist.
  select count(*) filter (where r.state in ('raw','needs_review')), count(*) filter (where r.state = 'rejected')
    into dr, dw from tonde.results r where r.workspace_id = target_workspace and r.production_id = target_production;
  if dr > 0 then
    blockers := blockers || tonde_private.rd_blocker('result_needs_review','warning','results',
      dr || ' Result' || case when dr = 1 then ' needs' else 's need' end || ' review', current.id,
      current.title, 'production', 'A Result that is still raw or needs review is not final.',
      'Review the Result and accept or reject it.', 'result');
  end if;
  if dw > 0 then
    blockers := blockers || tonde_private.rd_blocker('result_rejected','warning','results',
      dw || ' Result' || case when dw = 1 then ' was' else 's were' end || ' rejected', current.id,
      current.title, 'production', 'A rejected Result means the Shot still needs a usable take.',
      'Re-plan or re-shoot the affected Shot.', 'result');
  end if;
  -- Shot Match pickup: only reported when a completed report actually requires it.
  select count(*) into dr from tonde.shot_match_reports m where m.workspace_id = target_workspace
    and m.production_id = target_production and m.state = 'complete'
    and m.severity in ('warning','critical') and m.approval in ('draft','needs_review');
  if dr > 0 then
    blockers := blockers || tonde_private.rd_blocker('shot_match_pickup','review','results',
      dr || ' completed Shot Match report' || case when dr = 1 then ' needs' else 's need' end || ' a decision',
      current.id, current.title, 'production', 'A shot match finding has not been picked up or dismissed.',
      'Open FIX THIS SHOT and accept or dismiss the recommendation.', 'shot_match_report');
  end if;

  -- Delivery, when any export exists.
  select count(*) into dw from tonde.exports e where e.workspace_id = target_workspace
    and e.production_id = target_production and e.completed_at is null;
  if dw > 0 then
    blockers := blockers || tonde_private.rd_blocker('export_incomplete','warning','delivery',
      dw || ' export' || case when dw = 1 then ' is' else 's are' end || ' not finished', current.id,
      current.title, 'production', 'An unfinished export is not a delivered package.',
      'Finish or re-run the export.', 'export');
  end if;

  -- Aggregate the category. Readiness is the worst category present; it is never a percentage.
  select count(*) filter (where b->>'severity' = 'blocking'), count(*) filter (where b->>'severity' = 'review'),
    count(*) filter (where b->>'severity' = 'warning')
    into blocking_count, review_count, warning_count from jsonb_array_elements(blockers) b;
  state_value := case when blocking_count > 0 then 'blocked'::tonde.readiness_state
    when review_count > 0 then 'needs_review'::tonde.readiness_state
    when warning_count > 0 then 'ready_with_warnings'::tonde.readiness_state
    else 'ready'::tonde.readiness_state end;

  for dim_name in select unnest(array['decisions','story','script','scene_plan','shots','continuity',
      'resources','real_execution','ai_execution','approvals','dependencies','results','delivery']) loop
    select count(*) filter (where b->>'severity' = 'blocking'), count(*) filter (where b->>'severity' = 'review'),
      count(*) filter (where b->>'severity' = 'warning')
      into db, dr, dw from jsonb_array_elements(blockers) b where b->>'dimension' = dim_name;
    present := case dim_name
      when 'decisions' then has_decisions when 'story' then has_story when 'script' then has_script
      when 'scene_plan' then has_scenes when 'shots' then has_shots when 'continuity' then has_continuity
      when 'resources' then has_resources when 'real_execution' then has_real when 'ai_execution' then has_ai
      when 'approvals' then (has_scenes or has_shots) when 'dependencies' then has_dependencies
      when 'results' then has_results when 'delivery' then has_delivery else false end;
    if present or (db + dr + dw) > 0 then
      dim_state := case when db > 0 then 'blocked'::tonde.readiness_state
        when dr > 0 then 'needs_review'::tonde.readiness_state
        when dw > 0 then 'ready_with_warnings'::tonde.readiness_state
        else 'ready'::tonde.readiness_state end;
      dims := dims || jsonb_build_array(jsonb_build_object('dimension', dim_name, 'state', dim_state,
        'present', present, 'counts', jsonb_build_object('blocking', db, 'review', dr, 'warning', dw)));
    end if;
  end loop;

  headline := case state_value
    when 'blocked' then blocking_count || ' blocker' || case when blocking_count = 1 then '' else 's' end
      || ' must be resolved before this Production can move forward.'
    when 'needs_review' then review_count || ' item' || case when review_count = 1 then '' else 's' end
      || ' need review before this Production can move forward.'
    when 'ready_with_warnings' then warning_count || ' warning' || case when warning_count = 1 then '' else 's' end
      || ' to consider. Nothing blocks moving forward.'
    when 'ready' then 'No blockers or warnings were found for this Production.'
    else 'There is not enough planned state to judge readiness yet.' end;

  return jsonb_build_object('production_id', target_production, 'production_revision', current.revision,
    'title', current.title, 'state', state_value, 'dimensions', dims, 'blockers', blockers,
    'counts', jsonb_build_object('blocking', blocking_count, 'review', review_count,
      'warning', warning_count, 'total', blocking_count + review_count + warning_count),
    'headline', headline,
    'notes', jsonb_build_array(
      'Readiness is a category derived from real production state, not a score or a percentage.',
      'AI provider availability is an external dependency and is not guessed here.',
      'Shot Match pickup is only reported when a completed report actually requires a decision.'),
    'generated_at', now());
end $$;

-- 9. RLS. The decision record is workspace-isolated and read-only to members; only the guarded
-- security-definer RPCs above write it, so a decision can never be altered after the fact.
alter table tonde.access_decisions enable row level security;
create policy tenant_read on tonde.access_decisions for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.access_decisions to authenticated;

-- 10. Privileges: authenticated only, and the private helpers stay unreachable.
revoke all on function
  tonde.approval_decide(uuid,uuid,uuid,text,integer,text),
  tonde.lock_set(uuid,uuid,uuid,boolean,integer,text),
  tonde.access_state(uuid,uuid,uuid),
  tonde.access_history(uuid,uuid,uuid,integer,integer),
  tonde.production_readiness(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  tonde.approval_decide(uuid,uuid,uuid,text,integer,text),
  tonde.lock_set(uuid,uuid,uuid,boolean,integer,text),
  tonde.access_state(uuid,uuid,uuid),
  tonde.access_history(uuid,uuid,uuid,integer,integer),
  tonde.production_readiness(uuid,uuid,integer)
  to authenticated;
commit;
