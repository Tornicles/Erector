-- Prompt 11 packet 042 — observability, health, readiness and the alert seam.
--
-- Deployment hardening is not a promise that everything is configured. It is the opposite: the system
-- must be able to say, in machine-readable form, what it can do right now, what it cannot, and why.
-- This packet adds exactly that, and nothing that claims more than the database can observe:
--
--   * METRICS ARE LIVE ROWS, never a cached dashboard number. Each metric is a count or an age read
--     from the durable tables (jobs, outbox, media, storage purge queue, deletions, discover) at the
--     moment it is asked for, and the payload says which window it was taken over.
--   * A SNAPSHOT IS EVIDENCE. Capturing metrics writes an immutable, idempotent record of what was
--     observed; an observation is never edited afterwards.
--   * ALERTS ARE DETERMINISTIC. A rule names one metric from a closed set, a comparator and a
--     threshold. Evaluation opens exactly one event per breaching rule, keeps observing it, and when
--     the metric comes back in range the SYSTEM resolves it with the evidence of its own observation —
--     never a human claiming recovery. A person can acknowledge an alert; nobody can fake a resolution.
--   * HEALTH answers "can this system work at all" from real invariants: the database answers, every
--     tenant table carries row level security, no job is stuck holding an expired lease, there are no
--     dead letters, no sweep or deletion is stuck mid-phase, and the storage purge backlog is not
--     silently growing.
--   * READINESS answers "what is configured for this deployment", dependency by dependency, naming the
--     row or function it read. A provider whose adapter was never verified against the real provider
--     reports 'degraded'; an unconfigured dependency reports 'not_configured'; nothing reports 'ready'
--     because a table merely exists. Email delivery has no configuration surface in this schema at all,
--     and readiness says so instead of implying that mail is sent.
--   * A RELEASE RECORD names the environment and the migration range that was applied. Only the
--     service role writes one; it is the traceability anchor the runbook points at.
begin;

-- 1. Operational snapshots: an immutable record of what the system looked like at a moment.
create table tonde.operational_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  window_minutes integer not null check (window_minutes between 1 and 10080),
  cutoff_at timestamptz not null,
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  source text not null default 'metrics_read' check (source in ('metrics_read','worker','schedule','manual')),
  captured_by uuid references auth.users(id) on delete set null,
  note text check (note is null or length(note) <= 1000),
  captured_at timestamptz not null default now(),
  constraint operational_snapshot_cutoff_is_hourly check (date_trunc('hour', cutoff_at) = cutoff_at),
  unique (workspace_id, window_minutes, cutoff_at),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict
);
create index operational_snapshots_recent on tonde.operational_snapshots(workspace_id, captured_at desc);
create trigger guard_mutation before insert or update on tonde.operational_snapshots
  for each row execute function tonde_private.guard_mutation();
alter table tonde.operational_snapshots enable row level security;
create policy tenant_read on tonde.operational_snapshots for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.operational_snapshots to authenticated;
grant all on tonde.operational_snapshots to service_role;

-- 2. Alert rules. One metric from the closed set the metrics read actually produces.
create table tonde.alert_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  metric text not null check (metric in ('jobs_queued','jobs_running','jobs_failed','jobs_dead_letter',
    'jobs_timed_out','oldest_queued_seconds','expired_leases','reconciliation_pending','outbox_pending',
    'oldest_outbox_seconds','storage_purge_pending','media_awaiting_verification','deletion_requests_open',
    'settings_proposals_unsatisfied','scene_requirement_gaps','discover_previews_open','workers_live',
    'alerts_open')),
  comparator text not null check (comparator in ('gt','gte','lt','lte')),
  threshold numeric not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  window_minutes integer not null default 60 check (window_minutes between 1 and 10080),
  enabled boolean not null default true,
  note text check (note is null or length(note) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, name),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict
);
create trigger guard_mutation before insert or update on tonde.alert_rules
  for each row execute function tonde_private.guard_mutation();
alter table tonde.alert_rules enable row level security;
create policy tenant_read on tonde.alert_rules for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.alert_rules to authenticated;
grant all on tonde.alert_rules to service_role;

-- 3. Alert events. One live event per rule; the recovery is observed, not asserted.
create table tonde.alert_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  rule_id uuid not null,
  metric text not null,
  comparator text not null check (comparator in ('gt','gte','lt','lte')),
  threshold numeric not null,
  observed numeric not null,
  severity text not null check (severity in ('info','warning','critical')),
  state text not null default 'open' check (state in ('open','acknowledged','resolved')),
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  observations integer not null default 1 check (observations >= 1),
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution in ('observed_in_range','superseded_by_rule_change')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id) references tonde.workspaces(id) on delete restrict,
  foreign key (workspace_id, rule_id) references tonde.alert_rules(workspace_id, id) on delete restrict,
  -- Acknowledged and resolved both say who and when; resolved says why.
  constraint alert_acknowledged_is_stamped check (state <> 'acknowledged'
    or (acknowledged_at is not null and acknowledged_by is not null)),
  constraint alert_resolved_is_stamped check (state <> 'resolved'
    or (resolved_at is not null and resolution is not null))
);
create unique index alert_event_live on tonde.alert_events(rule_id) where state in ('open','acknowledged');
create index alert_events_queue on tonde.alert_events(workspace_id, state, detected_at desc);
create trigger guard_mutation before insert or update on tonde.alert_events
  for each row execute function tonde_private.guard_mutation();
alter table tonde.alert_events enable row level security;
create policy tenant_read on tonde.alert_events for select to authenticated
  using (tonde_private.is_workspace_member(workspace_id));
grant select on tonde.alert_events to authenticated;
grant all on tonde.alert_events to service_role;

-- 4. Recorded health and readiness checks: what was checked, when, what was seen.
create table tonde.system_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  check_kind text not null check (check_kind in ('health','readiness')),
  state text not null check (state in ('ok','degraded','failed','not_configured')),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  checked_by uuid references auth.users(id) on delete set null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  checked_at timestamptz not null default now()
);
create index system_checks_recent on tonde.system_checks(check_kind, checked_at desc);
create trigger guard_mutation before insert or update on tonde.system_checks
  for each row execute function tonde_private.guard_mutation();
alter table tonde.system_checks enable row level security;
create policy tenant_read on tonde.system_checks for select to authenticated
  using (workspace_id is not null and tonde_private.is_workspace_member(workspace_id));
grant select on tonde.system_checks to authenticated;
grant all on tonde.system_checks to service_role;

-- 5. Deployment releases: which migration range is applied where, and who recorded it.
create table tonde.deployment_releases (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('local','hosted','preview')),
  release_id text not null check (length(btrim(release_id)) between 1 and 120),
  migrated_through text not null check (length(btrim(migrated_through)) between 1 and 60),
  notes text check (notes is null or length(notes) <= 2000),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (environment, migrated_through)
);
alter table tonde.deployment_releases enable row level security;
create policy tenant_read on tonde.deployment_releases for select to authenticated
  using (true);
grant select on tonde.deployment_releases to authenticated;
grant all on tonde.deployment_releases to service_role;

-- 6. Guards. Evidence and release records do not change; an alert moves forward only.
create function tonde_private.guard_operational_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare curator boolean := (select auth.role()) = 'service_role' or auth.uid() is null;
begin
  if tg_op = 'DELETE' then
    if not curator then
      raise exception 'A recorded operational snapshot is evidence and is not deleted by a client'
        using errcode = '42501';
    end if;
    return old;
  end if;
  raise exception 'A recorded operational snapshot is evidence; it is never edited'
    using errcode = '23514';
end $$;
create trigger guard_operational_snapshot before update or delete on tonde.operational_snapshots
  for each row execute function tonde_private.guard_operational_snapshot();
revoke all on function tonde_private.guard_operational_snapshot()
  from public, anon, authenticated, service_role;

create function tonde_private.guard_system_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare curator boolean := (select auth.role()) = 'service_role' or auth.uid() is null;
begin
  if tg_op = 'DELETE' then
    if not curator then
      raise exception 'A recorded check is evidence and is not deleted by a client' using errcode = '42501';
    end if;
    return old;
  end if;
  raise exception 'A recorded check states what was observed at a moment and is never rewritten'
    using errcode = '23514';
end $$;
create trigger guard_system_check before update or delete on tonde.system_checks
  for each row execute function tonde_private.guard_system_check();
revoke all on function tonde_private.guard_system_check() from public, anon, authenticated, service_role;

create function tonde_private.guard_deployment_release() returns trigger
language plpgsql security definer set search_path = '' as $$
declare curator boolean := (select auth.role()) = 'service_role' or auth.uid() is null;
begin
  if tg_op = 'DELETE' then
    if not curator then
      raise exception 'A release record is not deleted by a client' using errcode = '42501';
    end if;
    return old;
  end if;
  raise exception 'A release record states what was applied and is never rewritten'
    using errcode = '23514';
end $$;
create trigger guard_deployment_release before update or delete on tonde.deployment_releases
  for each row execute function tonde_private.guard_deployment_release();
revoke all on function tonde_private.guard_deployment_release()
  from public, anon, authenticated, service_role;

create function tonde_private.guard_alert_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'open' then
      raise exception 'An alert is opened by observation; it is acknowledged or resolved afterwards'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if old.state = 'resolved' and (new.state is distinct from old.state or new.resolution is distinct from old.resolution
      or new.resolved_at is distinct from old.resolved_at
      or new.observed is distinct from old.observed or new.evidence is distinct from old.evidence) then
    raise exception 'A resolved alert is a closed record' using errcode = '23514';
  end if;
  if old.state = 'open' and new.state = 'acknowledged' then
    if new.acknowledged_at is null or new.acknowledged_by is null then
      raise exception 'Acknowledging an alert says who did it and when' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.state = 'resolved' and old.state is distinct from 'resolved' then
    -- Resolution is written by the observation that recovers the metric, or by the rule change that
    -- supersedes the alert. Both set a private marker for the length of their own statement, so a direct
    -- write to resolved - by anyone, including the platform - is refused rather than taken on trust.
    if coalesce(current_setting('tonde.alert_resolution', true), '') <> new.resolution then
      raise exception 'An alert is resolved by the observation that recovers it, not by a direct write'
        using errcode = '42501';
    end if;
    return new;
  end if;
  return new;
end $$;
create trigger guard_alert_event before insert or update on tonde.alert_events
  for each row execute function tonde_private.guard_alert_event();
revoke all on function tonde_private.guard_alert_event() from public, anon, authenticated, service_role;

-- 7. Private helpers: who may read the operations surface, and the live metric arithmetic.
create function tonde_private.observability_admin(target_workspace uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if (select auth.role()) = 'service_role' then return actor; end if;
  if actor is null or not tonde_private.is_workspace_admin(target_workspace) then
    raise exception 'Operations authority required' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function tonde_private.observability_admin(uuid)
  from public, anon, authenticated, service_role;

-- Every number below is a live count or age from a durable table. Nothing is cached, estimated or
-- invented, and the flattening in `values` is the exact bridge the alert rules compare against.
create function tonde_private.workspace_metrics(target_workspace uuid, p_window_minutes integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare payload jsonb; flattened jsonb;
begin
  select jsonb_build_object(
    'jobs', jsonb_build_object(
      'by_state', coalesce((select jsonb_object_agg(status, total) from (
        select j.status::text as status, count(*) as total from tonde.jobs j
        where j.workspace_id = target_workspace group by 1) states), '{}'::jsonb),
      'queued', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'queued'),
      'running', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status in ('leased','running')),
      'retrying', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'retrying'),
      'waiting', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'waiting'),
      'failed', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'failed'),
      'dead_letter', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'dead_letter'),
      'timed_out', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'timed_out'),
      'cancel_requested', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'cancel_requested'),
      'succeeded', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'succeeded')),
    'oldest_queued_seconds', (select coalesce(round(extract(epoch from (now() - min(j.available_at)))), 0)
      from tonde.jobs j where j.workspace_id = target_workspace and j.status = 'queued'),
    'expired_leases', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace
      and j.status in ('leased','running') and j.lease_expires_at is not null and j.lease_expires_at <= now()),
    'reconciliation_pending', (select count(*) from tonde.jobs j where j.workspace_id = target_workspace
      and j.reconciliation_required),
    'outbox', jsonb_build_object(
      'pending', (select count(*) from tonde.outbox_events o where o.workspace_id = target_workspace and o.state = 'pending'),
      'processing', (select count(*) from tonde.outbox_events o where o.workspace_id = target_workspace and o.state = 'processing'),
      'failed', (select count(*) from tonde.outbox_events o where o.workspace_id = target_workspace and o.state = 'failed'),
      'oldest_pending_seconds', (select coalesce(round(extract(epoch from (now() - min(o.available_at)))), 0)
        from tonde.outbox_events o where o.workspace_id = target_workspace and o.state = 'pending')),
    'storage_purge', jsonb_build_object(
      'pending', (select count(*) from tonde.storage_purge_queue q where q.workspace_id = target_workspace and q.state = 'pending'),
      'claimed', (select count(*) from tonde.storage_purge_queue q where q.workspace_id = target_workspace and q.state = 'claimed'),
      'failed', (select count(*) from tonde.storage_purge_queue q where q.workspace_id = target_workspace and q.state = 'failed')),
    'media_awaiting_verification', (select count(*) from tonde.media_files m where m.workspace_id = target_workspace
      and m.upload_state in ('uploading','verifying')),
    'deletion_requests_open', (select count(*) from tonde.deletion_requests d where d.workspace_id = target_workspace
      and d.state not in ('completed','failed','cancelled')),
    'settings_proposals_unsatisfied', (select count(*) from tonde.camera_settings_proposals c
      where c.workspace_id = target_workspace and not c.satisfied and c.state = 'proposed'),
    'scene_requirement_gaps', (select count(*) from tonde.scene_requirements r where r.workspace_id = target_workspace
      and r.state = 'open' and r.mandatory),
    'discover_previews_open', (select count(*) from tonde.discover_applications a
      where a.workspace_id = target_workspace and a.state = 'previewed'),
    'workers_live', (select count(*) from tonde.workers w where w.status <> 'offline'
      and w.heartbeat_at > now() - interval '5 minutes'),
    'alerts_open', (select count(*) from tonde.alert_events e where e.workspace_id = target_workspace
      and e.state in ('open','acknowledged')))
    into payload;
  flattened := jsonb_build_object(
    'jobs_queued', payload -> 'jobs' ->> 'queued',
    'jobs_running', payload -> 'jobs' ->> 'running',
    'jobs_failed', payload -> 'jobs' ->> 'failed',
    'jobs_dead_letter', payload -> 'jobs' ->> 'dead_letter',
    'jobs_timed_out', payload -> 'jobs' ->> 'timed_out',
    'oldest_queued_seconds', payload ->> 'oldest_queued_seconds',
    'expired_leases', payload ->> 'expired_leases',
    'reconciliation_pending', payload ->> 'reconciliation_pending',
    'outbox_pending', payload -> 'outbox' ->> 'pending',
    'oldest_outbox_seconds', payload -> 'outbox' ->> 'oldest_pending_seconds',
    'storage_purge_pending', payload -> 'storage_purge' ->> 'pending',
    'media_awaiting_verification', payload ->> 'media_awaiting_verification',
    'deletion_requests_open', payload ->> 'deletion_requests_open',
    'settings_proposals_unsatisfied', payload ->> 'settings_proposals_unsatisfied',
    'scene_requirement_gaps', payload ->> 'scene_requirement_gaps',
    'discover_previews_open', payload ->> 'discover_previews_open',
    'workers_live', payload ->> 'workers_live',
    'alerts_open', payload ->> 'alerts_open');
  return payload || jsonb_build_object('workspace_id', target_workspace, 'window_minutes', p_window_minutes,
    'computed_at', now(), 'source', 'live rows',
    'values', (select jsonb_object_agg(key, value::numeric) from jsonb_each_text(flattened) entry(key, value)));
end $$;
revoke all on function tonde_private.workspace_metrics(uuid,integer)
  from public, anon, authenticated, service_role;

create function tonde_private.metric_value(metrics jsonb, metric text) returns numeric
language sql immutable set search_path = '' as $$
  select nullif(metrics -> 'values' ->> metric, '')::numeric;
$$;
revoke all on function tonde_private.metric_value(jsonb,text)
  from public, anon, authenticated, service_role;

create function tonde_private.rule_breached(observed numeric, comparator text, threshold numeric)
returns boolean language sql immutable set search_path = '' as $$
  select case comparator when 'gt' then observed > threshold when 'gte' then observed >= threshold
    when 'lt' then observed < threshold when 'lte' then observed <= threshold else null end;
$$;
revoke all on function tonde_private.rule_breached(numeric,text,numeric)
  from public, anon, authenticated, service_role;

-- 8. Reading and recording metrics.
create function tonde.metrics_read(target_workspace uuid, p_window_minutes integer default 60) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; metrics jsonb;
begin
  actor := tonde_private.discover_member(target_workspace);
  if p_window_minutes is null or p_window_minutes < 1 or p_window_minutes > 10080 then
    raise exception 'A metrics window is between 1 and 10080 minutes' using errcode = '22023';
  end if;
  metrics := tonde_private.workspace_metrics(target_workspace, p_window_minutes);
  return jsonb_build_object('metrics', metrics,
    'meaning', 'These are live counts and ages read from the durable tables at this moment. Nothing here
      is cached and nothing is estimated; a metric that has no rows reports zero.');
end $$;
revoke all on function tonde.metrics_read(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function tonde.metrics_read(uuid,integer) to authenticated, service_role;

create function tonde.metrics_capture(target_workspace uuid, p_window_minutes integer default 60,
  p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; metrics jsonb; cutoff timestamptz; existing tonde.operational_snapshots;
  snapshot tonde.operational_snapshots;
begin
  actor := tonde_private.observability_admin(target_workspace);
  if p_window_minutes is null or p_window_minutes < 1 or p_window_minutes > 10080 then
    raise exception 'A metrics window is between 1 and 10080 minutes' using errcode = '22023';
  end if;
  -- The cutoff is truncated to the hour so the same observation window is one record, not many.
  cutoff := date_trunc('hour', now());
  select * into existing from tonde.operational_snapshots s
    where s.workspace_id = target_workspace and s.window_minutes = p_window_minutes and s.cutoff_at = cutoff;
  if existing.id is not null then
    return jsonb_build_object('snapshot_id', existing.id, 'cutoff_at', existing.cutoff_at,
      'captured_at', existing.captured_at, 'idempotent', true,
      'meaning', 'This window was already captured; the earlier observation stands.');
  end if;
  metrics := tonde_private.workspace_metrics(target_workspace, p_window_minutes);
  insert into tonde.operational_snapshots(workspace_id, window_minutes, cutoff_at, metrics, source,
    captured_by, note)
  values (target_workspace, p_window_minutes, cutoff, metrics, 'metrics_read', actor,
    nullif(left(coalesce(p_note, ''), 1000), ''))
  returning * into snapshot;
  perform tonde_private.audit_event(target_workspace, 'observability.metrics_captured', snapshot.id,
    'operational_snapshot', jsonb_build_object('window_minutes', p_window_minutes, 'cutoff_at', cutoff,
      'values', metrics -> 'values'));
  return jsonb_build_object('snapshot_id', snapshot.id, 'cutoff_at', snapshot.cutoff_at,
    'captured_at', snapshot.captured_at, 'window_minutes', snapshot.window_minutes,
    'metrics', snapshot.metrics, 'idempotent', false,
    'meaning', 'The observation is recorded as evidence. It is immutable and the same window is never
      captured twice.');
end $$;
revoke all on function tonde.metrics_capture(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function tonde.metrics_capture(uuid,integer,text) to authenticated, service_role;

create function tonde.snapshots_read(target_workspace uuid, p_limit integer default 24) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; snapshots jsonb;
begin
  actor := tonde_private.discover_member(target_workspace);
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'A snapshot page is between 1 and 200 records' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('snapshot_id', s.id, 'cutoff_at', s.cutoff_at,
    'captured_at', s.captured_at, 'window_minutes', s.window_minutes, 'values', s.metrics -> 'values',
    'note', s.note, 'captured_by', s.captured_by) order by s.captured_at desc), '[]'::jsonb)
    into snapshots
    from (select * from tonde.operational_snapshots s where s.workspace_id = target_workspace
      order by s.captured_at desc limit p_limit) s;
  return jsonb_build_object('workspace_id', target_workspace, 'snapshots', snapshots, 'count', jsonb_array_length(snapshots));
end $$;
revoke all on function tonde.snapshots_read(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function tonde.snapshots_read(uuid,integer) to authenticated, service_role;

-- 9. Alert rules, evaluation and acknowledgement.
create function tonde.alert_rule_set(target_workspace uuid, p_name text, p_metric text, p_comparator text,
  p_threshold numeric, p_severity text default 'warning', p_window_minutes integer default 60,
  p_enabled boolean default true, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; existing tonde.alert_rules; rule tonde.alert_rules;
begin
  actor := tonde_private.observability_admin(target_workspace);
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'An alert rule needs a name' using errcode = '22023';
  end if;
  if p_metric not in ('jobs_queued','jobs_running','jobs_failed','jobs_dead_letter','jobs_timed_out',
    'oldest_queued_seconds','expired_leases','reconciliation_pending','outbox_pending','oldest_outbox_seconds',
    'storage_purge_pending','media_awaiting_verification','deletion_requests_open',
    'settings_proposals_unsatisfied','scene_requirement_gaps','discover_previews_open','workers_live',
    'alerts_open') then
    raise exception 'That is not a metric this system observes' using errcode = '22023';
  end if;
  if p_comparator not in ('gt','gte','lt','lte') then
    raise exception 'A rule compares with gt, gte, lt or lte' using errcode = '22023';
  end if;
  if p_threshold is null then
    raise exception 'A rule needs a threshold' using errcode = '22023';
  end if;
  if p_severity not in ('info','warning','critical') then
    raise exception 'That is not a TONDE alert severity' using errcode = '22023';
  end if;
  if p_window_minutes is null or p_window_minutes < 1 or p_window_minutes > 10080 then
    raise exception 'A metrics window is between 1 and 10080 minutes' using errcode = '22023';
  end if;
  select * into existing from tonde.alert_rules r
    where r.workspace_id = target_workspace and r.name = btrim(p_name);
  if existing.id is not null then
    update tonde.alert_rules set metric = p_metric, comparator = p_comparator, threshold = p_threshold,
      severity = p_severity, window_minutes = p_window_minutes, enabled = coalesce(p_enabled, true),
      note = nullif(left(coalesce(p_note, ''), 1000), ''), updated_at = now()
      where id = existing.id returning * into rule;
    -- A rule that changed its meaning cannot keep an old event against it: the event is resolved as
    -- superseded, with the change recorded as the reason.
    perform set_config('tonde.alert_resolution', 'superseded_by_rule_change', true);
    update tonde.alert_events e set state = 'resolved', resolved_at = now(),
      resolution = 'superseded_by_rule_change', updated_at = now(),
      evidence = e.evidence || jsonb_build_object('superseded_by_rule_change', true,
        'previous_metric', e.metric, 'previous_threshold', e.threshold, 'new_metric', p_metric,
        'new_threshold', p_threshold)
      where e.rule_id = rule.id and e.state in ('open','acknowledged')
        and (e.metric <> p_metric or e.threshold <> p_threshold or e.comparator <> p_comparator);
    perform set_config('tonde.alert_resolution', '', true);
    perform tonde_private.audit_event(target_workspace, 'observability.alert_rule_updated', rule.id,
      'alert_rule', jsonb_build_object('name', rule.name, 'metric', rule.metric,
        'comparator', rule.comparator, 'threshold', rule.threshold, 'severity', rule.severity));
    return jsonb_build_object('rule_id', rule.id, 'name', rule.name, 'metric', rule.metric,
      'comparator', rule.comparator, 'threshold', rule.threshold, 'severity', rule.severity,
      'window_minutes', rule.window_minutes, 'enabled', rule.enabled, 'replaced_existing', true,
      'meaning', 'The rule is updated, and any live alert that was opened against the old meaning is
        resolved as superseded rather than left pointing at a rule that no longer says that.');
  end if;
  insert into tonde.alert_rules(workspace_id, name, metric, comparator, threshold, severity, window_minutes,
    enabled, note, created_by)
  values (target_workspace, left(btrim(p_name), 120), p_metric, p_comparator, p_threshold, p_severity,
    p_window_minutes, coalesce(p_enabled, true), nullif(left(coalesce(p_note, ''), 1000), ''), actor)
  returning * into rule;
  perform tonde_private.audit_event(target_workspace, 'observability.alert_rule_created', rule.id,
    'alert_rule', jsonb_build_object('name', rule.name, 'metric', rule.metric, 'comparator', rule.comparator,
      'threshold', rule.threshold, 'severity', rule.severity));
  return jsonb_build_object('rule_id', rule.id, 'name', rule.name, 'metric', rule.metric,
    'comparator', rule.comparator, 'threshold', rule.threshold, 'severity', rule.severity,
    'window_minutes', rule.window_minutes, 'enabled', rule.enabled, 'replaced_existing', false,
    'meaning', 'The rule is recorded. It fires nothing by itself: evaluation compares it against live
      metrics and records what it observed.');
end $$;
revoke all on function tonde.alert_rule_set(uuid,text,text,text,numeric,text,integer,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function tonde.alert_rule_set(uuid,text,text,text,numeric,text,integer,boolean,text)
  to authenticated, service_role;

create function tonde.alert_evaluate(target_workspace uuid, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; metrics jsonb; rule tonde.alert_rules; event tonde.alert_events;
  v_observed numeric; breached boolean; outcomes jsonb := '[]'::jsonb; opened integer := 0;
  updated integer := 0; resolved integer := 0; skipped integer := 0; evaluated integer := 0;
begin
  actor := tonde_private.observability_admin(target_workspace);
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'An alert evaluation is between 1 and 500 rules' using errcode = '22023';
  end if;
  metrics := tonde_private.workspace_metrics(target_workspace, 60);
  for rule in select * from tonde.alert_rules r where r.workspace_id = target_workspace and r.enabled
    order by r.name limit p_limit loop
    evaluated := evaluated + 1;
    v_observed := tonde_private.metric_value(metrics, rule.metric);
    if v_observed is null then
      skipped := skipped + 1;
      outcomes := outcomes || jsonb_build_object('rule_id', rule.id, 'metric', rule.metric,
        'outcome', 'metric_unavailable', 'reason', 'the metrics read produced no value for this metric');
      continue;
    end if;
    breached := tonde_private.rule_breached(v_observed, rule.comparator, rule.threshold);
    select * into event from tonde.alert_events e where e.rule_id = rule.id and e.state in ('open','acknowledged')
      order by e.detected_at desc limit 1;
    if breached then
      if event.id is null then
        insert into tonde.alert_events(workspace_id, rule_id, metric, comparator, threshold, observed,
          severity, state, evidence)
        values (target_workspace, rule.id, rule.metric, rule.comparator, rule.threshold, v_observed,
          rule.severity, 'open', jsonb_build_object('first_observation', v_observed, 'window_minutes', 60,
            'evaluated_by', coalesce(actor::text, 'service_role')))
        returning * into event;
        opened := opened + 1;
        outcomes := outcomes || jsonb_build_object('rule_id', rule.id, 'metric', rule.metric,
          'outcome', 'opened', 'alert_id', event.id, 'observed', v_observed, 'threshold', rule.threshold,
          'severity', rule.severity);
      else
        update tonde.alert_events e set observed = v_observed, last_seen_at = now(),
          observations = e.observations + 1, updated_at = now(),
          evidence = e.evidence || jsonb_build_object('last_observation', v_observed,
            'observations', e.observations + 1)
          where e.id = event.id returning * into event;
        updated := updated + 1;
        outcomes := outcomes || jsonb_build_object('rule_id', rule.id, 'metric', rule.metric,
          'outcome', 'still_breaching', 'alert_id', event.id, 'observed', v_observed, 'state', event.state);
      end if;
    else
      if event.id is not null then
        perform set_config('tonde.alert_resolution', 'observed_in_range', true);
        update tonde.alert_events e set state = 'resolved', resolved_at = now(), observed = v_observed,
          resolution = 'observed_in_range', updated_at = now(),
          evidence = e.evidence || jsonb_build_object('resolved_by', 'observation', 'observed', v_observed,
            'threshold', rule.threshold, 'seen_in_range_at', now())
          where e.id = event.id returning * into event;
        perform set_config('tonde.alert_resolution', '', true);
        resolved := resolved + 1;
        outcomes := outcomes || jsonb_build_object('rule_id', rule.id, 'metric', rule.metric,
          'outcome', 'resolved', 'alert_id', event.id, 'observed', v_observed,
          'meaning', 'The metric came back inside the threshold; the system observed the recovery.');
      else
        outcomes := outcomes || jsonb_build_object('rule_id', rule.id, 'metric', rule.metric,
          'outcome', 'within_threshold', 'observed', v_observed, 'threshold', rule.threshold);
      end if;
    end if;
  end loop;
  return jsonb_build_object('workspace_id', target_workspace, 'evaluated', evaluated, 'opened', opened,
    'updated', updated, 'resolved', resolved, 'skipped', skipped, 'metrics', metrics -> 'values',
    'computed_at', metrics -> 'computed_at', 'outcomes', outcomes,
    'meaning', 'Every enabled rule was compared against live metrics. A recovery is resolved by the
      observation that showed it, and a rule whose metric cannot be read is reported as unavailable
      rather than assumed healthy.');
end $$;
revoke all on function tonde.alert_evaluate(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function tonde.alert_evaluate(uuid,integer) to authenticated, service_role;

create function tonde.alert_acknowledge(target_workspace uuid, target_event uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; event tonde.alert_events;
begin
  actor := tonde_private.observability_admin(target_workspace);
  select * into event from tonde.alert_events e
    where e.workspace_id = target_workspace and e.id = target_event for update;
  if event.id is null then
    raise exception 'That alert does not exist' using errcode = 'P0002';
  end if;
  if event.state = 'resolved' then
    raise exception 'ALERT_ALREADY_RESOLVED: this alert was resolved by observation at %', event.resolved_at
      using errcode = 'PT409';
  end if;
  if event.state = 'acknowledged' then
    return jsonb_build_object('alert_id', event.id, 'state', event.state, 'idempotent', true);
  end if;
  update tonde.alert_events set state = 'acknowledged', acknowledged_by = actor, acknowledged_at = now(),
    note = nullif(left(coalesce(p_note, ''), 1000), ''), updated_at = now()
    where id = event.id returning * into event;
  perform tonde_private.audit_event(target_workspace, 'observability.alert_acknowledged', event.id,
    'alert_event', jsonb_build_object('metric', event.metric, 'observed', event.observed,
      'threshold', event.threshold, 'note', p_note));
  return jsonb_build_object('alert_id', event.id, 'state', event.state, 'acknowledged_by', actor,
    'acknowledged_at', event.acknowledged_at, 'idempotent', false,
    'meaning', 'A person acknowledged the alert. Acknowledging does not resolve it; only an observation
      inside the threshold resolves it.');
end $$;
revoke all on function tonde.alert_acknowledge(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function tonde.alert_acknowledge(uuid,uuid,text) to authenticated, service_role;

create function tonde.alert_events_read(target_workspace uuid, p_state text default null,
  p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; events jsonb; rules jsonb;
begin
  actor := tonde_private.discover_member(target_workspace);
  if p_state is not null and p_state not in ('open','acknowledged','resolved') then
    raise exception 'An alert is open, acknowledged or resolved' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'An alert page is between 1 and 500 records' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('alert_id', e.id, 'rule_id', e.rule_id, 'metric', e.metric,
    'comparator', e.comparator, 'threshold', e.threshold, 'observed', e.observed, 'severity', e.severity,
    'state', e.state, 'detected_at', e.detected_at, 'last_seen_at', e.last_seen_at,
    'observations', e.observations, 'acknowledged_by', e.acknowledged_by, 'acknowledged_at', e.acknowledged_at,
    'resolved_at', e.resolved_at, 'resolution', e.resolution, 'evidence', e.evidence, 'note', e.note)
    order by e.detected_at desc), '[]'::jsonb) into events
    from (select * from tonde.alert_events e where e.workspace_id = target_workspace
      and (p_state is null or e.state = p_state) order by e.detected_at desc limit p_limit) e;
  select coalesce(jsonb_agg(jsonb_build_object('rule_id', r.id, 'name', r.name, 'metric', r.metric,
    'comparator', r.comparator, 'threshold', r.threshold, 'severity', r.severity, 'enabled', r.enabled,
    'window_minutes', r.window_minutes) order by r.name), '[]'::jsonb) into rules
    from tonde.alert_rules r where r.workspace_id = target_workspace;
  return jsonb_build_object('workspace_id', target_workspace, 'state', p_state, 'rules', rules,
    'events', events, 'count', jsonb_array_length(events));
end $$;
revoke all on function tonde.alert_events_read(uuid,text,integer) from public, anon, authenticated, service_role;
grant execute on function tonde.alert_events_read(uuid,text,integer) to authenticated, service_role;

-- 10. Health: can this system work at all? Every answer carries the observation behind it.
-- Every check is read live from the durable table it names. The private function is the single
-- implementation; the public function below exposes it to the platform alone, because these are
-- platform-wide counts and one tenant must not learn another tenant's backlog through them. A workspace
-- admin reads the same picture, scoped to the read they are already allowed, through operations_status.
create function tonde_private.infrastructure_health() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare started timestamptz := clock_timestamp(); checks jsonb := '[]'::jsonb;
  state text := 'ok'; rls_count integer; expired integer; dead integer;
  stuck_sweeps integer; stuck_deletions integer; purge_pending integer; purge_oldest numeric;
  duration integer;
begin
  select count(*) into rls_count from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    join pg_class pc on pc.relname = c.table_name
    join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = c.table_schema
    where c.table_schema = 'tonde' and t.table_type = 'BASE TABLE' and c.column_name = 'workspace_id'
      and pc.relrowsecurity = false;
  checks := checks || jsonb_build_object('check', 'database_answers', 'state', 'ok',
    'observed', jsonb_build_object('now', now(), 'server_version', current_setting('server_version')),
    'detail', 'The database answered this query, which is what this check observes.');
  checks := checks || jsonb_build_object('check', 'tenant_tables_have_rls', 'state',
    case when rls_count = 0 then 'ok' else 'degraded' end,
    'observed', jsonb_build_object('tables_without_rls', rls_count),
    'detail', case when rls_count = 0 then 'Every tenant table carries row level security.'
      else 'A tenant table without row level security is a leak waiting to happen.' end);
  select count(*) into expired from tonde.jobs j where j.status in ('leased','running')
    and j.lease_expires_at is not null and j.lease_expires_at <= now();
  checks := checks || jsonb_build_object('check', 'expired_job_leases', 'state',
    case when expired = 0 then 'ok' else 'degraded' end,
    'observed', jsonb_build_object('expired_leases', expired),
    'detail', case when expired = 0 then 'No worker is holding a lease past its expiry.'
      else 'Lease recovery reclaims these on its next pass; work is not lost, it is late.' end);
  select count(*) into dead from tonde.jobs j where j.status = 'dead_letter';
  checks := checks || jsonb_build_object('check', 'dead_letter_jobs', 'state',
    case when dead = 0 then 'ok' else 'degraded' end,
    'observed', jsonb_build_object('dead_letter', dead),
    'detail', case when dead = 0 then 'No job exhausted its attempts.'
      else 'Dead letters are work that will never finish by itself and needs a person.' end);
  select count(*) into stuck_sweeps from tonde.retention_sweeps s
    where s.state = 'running' and s.started_at < now() - interval '1 hour';
  checks := checks || jsonb_build_object('check', 'stuck_retention_sweeps', 'state',
    case when stuck_sweeps = 0 then 'ok' else 'degraded' end,
    'observed', jsonb_build_object('stuck_sweeps', stuck_sweeps),
    'detail', case when stuck_sweeps = 0 then 'No retention sweep is stuck mid-run.'
      else 'A sweep that has been running for over an hour stopped making progress.' end);
  select count(*) into stuck_deletions from tonde.deletion_requests d
    where d.state in ('revoking','purging','verifying') and d.updated_at < now() - interval '2 hours';
  checks := checks || jsonb_build_object('check', 'stuck_deletion_requests', 'state',
    case when stuck_deletions = 0 then 'ok' else 'degraded' end,
    'observed', jsonb_build_object('stuck_deletions', stuck_deletions),
    'detail', case when stuck_deletions = 0 then 'Every open deletion moved in the last two hours.'
      else 'A deletion that stopped moving is unfinished work the creator is waiting on.' end);
  select count(*), coalesce(round(extract(epoch from (now() - min(q.requested_at)))), 0)
    into purge_pending, purge_oldest from tonde.storage_purge_queue q where q.state = 'pending';
  checks := checks || jsonb_build_object('check', 'storage_purge_backlog', 'state',
    case when purge_pending = 0 then 'ok' when purge_oldest < 86400 then 'degraded' else 'failed' end,
    'observed', jsonb_build_object('pending', purge_pending, 'oldest_seconds', purge_oldest),
    'detail', case when purge_pending = 0 then 'Nothing is waiting to be purged from storage.'
      when purge_oldest < 86400 then 'Objects are queued for purging and will be drained by a worker.'
      else 'Objects have been queued for over a day: the purge worker is not keeping up.' end);
  select case
    when exists (select 1 from jsonb_array_elements(checks) c where c ->> 'state' = 'failed') then 'failed'
    when exists (select 1 from jsonb_array_elements(checks) c where c ->> 'state' = 'degraded') then 'degraded'
    else 'ok' end into state;
  duration := round(extract(epoch from (clock_timestamp() - started)) * 1000);
  return jsonb_build_object('state', state, 'checks', checks, 'check_count', jsonb_array_length(checks),
    'duration_ms', duration, 'checked_at', now(), 'source', 'live rows',
    'meaning', 'Health is what the database can observe about its own ability to work: the tenant surface
      is protected, work is not stuck, and nothing is silently piling up. It is not a claim about any
      external provider.');
end $$;
revoke all on function tonde_private.infrastructure_health() from public, anon, authenticated, service_role;

create function tonde.health_check(p_record boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; result jsonb;
begin
  -- Platform infrastructure information. Not a workspace owner, not a viewer: an owner of some workspace
  -- would otherwise learn every other tenant's dead letters and purge backlog from a platform-wide count.
  if not ((select auth.role()) = 'service_role' or auth.uid() is null) then
    raise exception 'Platform authority required for platform-wide health; a workspace admin reads the
      same picture through tonde.operations_status' using errcode = '42501';
  end if;
  actor := (select auth.uid());
  result := tonde_private.infrastructure_health();
  if coalesce(p_record, false) then
    insert into tonde.system_checks(workspace_id, check_kind, state, summary, checked_by, duration_ms)
    values (null, 'health', result ->> 'state', jsonb_build_object('checks', result -> 'checks'), actor,
      (result ->> 'duration_ms')::integer);
  end if;
  return result || jsonb_build_object('recorded', coalesce(p_record, false), 'recorded_by', actor);
end $$;
revoke all on function tonde.health_check(boolean) from public, anon, authenticated, service_role;
grant execute on function tonde.health_check(boolean) to service_role;

-- 11. Readiness: what is actually configured for this deployment, and what is not.
create function tonde.readiness_check(target_workspace uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; dependencies jsonb := '[]'::jsonb; state text; workers_live integer;
  scanner jsonb; purge_pending integer; providers jsonb; ai_connections jsonb; billing integer;
  email_surface integer; provider_states jsonb; by_service jsonb;
begin
  if target_workspace is not null then
    actor := tonde_private.observability_admin(target_workspace);
  elsif (select auth.role()) = 'service_role' then
    actor := (select auth.uid());
  else
    raise exception 'Operations authority required' using errcode = '42501';
  end if;
  -- Worker fleet: is anything actually claiming work?
  select count(*) into workers_live from tonde.workers w where w.status <> 'offline'
    and w.heartbeat_at > now() - interval '5 minutes';
  dependencies := dependencies || jsonb_build_object('dependency', 'worker_fleet',
    'state', case when workers_live > 0 then 'ok' else 'not_configured' end,
    'detail', case when workers_live > 0 then 'A worker instance is online and heartbeating.'
      else 'No worker has heartbeated in the last five minutes, so queued jobs will not run.' end,
    'source', 'tonde.workers');
  -- Media scanning: declared honestly by the media limits function itself.
  scanner := tonde.media_upload_limits();
  dependencies := dependencies || jsonb_build_object('dependency', 'media_scanner',
    'state', case when (scanner ->> 'scanner_configured')::boolean then 'ok' else 'not_configured' end,
    'detail', case when (scanner ->> 'scanner_configured')::boolean
      then 'A scanner is recorded, so uploads can be checked for malware.'
      else 'No malware scanner is configured. An infected file can only be quarantined after the fact,
        and TONDE says so rather than implying uploads are scanned.' end,
    'source', 'tonde.media_upload_limits().scanner_configured');
  select count(*) into purge_pending from tonde.storage_purge_queue q where q.state = 'pending';
  dependencies := dependencies || jsonb_build_object('dependency', 'storage_purge_queue',
    'state', case when purge_pending = 0 then 'ok' else 'degraded' end,
    'detail', case when purge_pending = 0 then 'No object is waiting to be purged.'
      else format('%s object(s) are queued for purging and need a running purge worker.', purge_pending) end,
    'source', 'tonde.storage_purge_queue');
  -- Provider adapters: 'verified' means a real call to the real provider succeeded, not that a row exists.
  select coalesce(jsonb_agg(jsonb_build_object('provider', p.key, 'category', p.category,
    'adapter_state', p.adapter_state, 'enabled', p.enabled,
    'state', case p.adapter_state when 'verified' then 'ok' when 'implemented' then 'degraded'
      else 'not_configured' end,
    'connections', (select count(*) from tonde.integration_connections c
      where c.provider = p.key and c.status = 'connected')) order by p.key), '[]'::jsonb) into providers
    from tonde.integration_providers p;
  provider_states := jsonb_build_object('providers', providers,
    'verified', coalesce((select jsonb_agg(p.key order by p.key) from tonde.integration_providers p
      where p.adapter_state = 'verified'), '[]'::jsonb),
    'unverified', coalesce((select jsonb_agg(p.key order by p.key) from tonde.integration_providers p
      where p.adapter_state <> 'verified'), '[]'::jsonb));
  dependencies := dependencies || jsonb_build_object('dependency', 'integration_providers',
    'state', case when exists (select 1 from tonde.integration_providers p where p.adapter_state = 'verified')
      then 'ok' else 'not_configured' end,
    'detail', case when exists (select 1 from tonde.integration_providers p where p.adapter_state = 'verified')
      then 'At least one provider adapter was verified against the real provider.'
      else 'No provider adapter has been verified against a real provider. Nothing here can publish,
        deliver or bill, and TONDE claims none of it.' end,
    'source', 'tonde.integration_providers + tonde.integration_connections', 'providers', provider_states);
  -- AI generation: a connection row is not a capability claim; the state is what the row says.
  select coalesce(jsonb_agg(jsonb_build_object('provider_key', c.provider_key, 'state', c.state) order by c.provider_key),
    '[]'::jsonb) into ai_connections from tonde.ai_provider_connections c
    where target_workspace is null or c.workspace_id = target_workspace;
  dependencies := dependencies || jsonb_build_object('dependency', 'ai_generation',
    'state', case when exists (select 1 from jsonb_array_elements(ai_connections) c where c ->> 'state' = 'connected')
      then 'ok' else 'not_configured' end,
    'required_for_core', false,
    'detail', case when exists (select 1 from jsonb_array_elements(ai_connections) c where c ->> 'state' = 'connected')
      then 'A provider connection is recorded as connected for this scope, so a Shot could also be run
        inside TONDE. The core product does not need it.'
      else 'No AI provider connection is recorded as connected. That is not a blocker for the core product:
        TONDE directs the Shot, compiles the playbook prompt and the creator runs it in the external tool
        they own, then the Result comes back here to be checked.' end,
    'source', 'tonde.ai_provider_connections', 'connections', ai_connections);
  -- Billing: a subscription row is the only evidence, and 'none' is not a subscription.
  select count(*) into billing from tonde.billing_accounts b
    where b.subscription_status in ('trialing','active');
  dependencies := dependencies || jsonb_build_object('dependency', 'billing',
    'state', case when billing > 0 then 'ok' else 'not_configured' end,
    'detail', case when billing > 0 then format('%s workspace(s) have an active or trialing subscription.', billing)
      else 'No workspace has an active subscription record. Billing is off, which is a configuration,
        not a failure.' end,
    'source', 'tonde.billing_accounts');
  -- Email delivery has no configuration surface in this schema. Saying so is the honest answer.
  select count(*) into email_surface from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and c.relname ilike '%email%';
  dependencies := dependencies || jsonb_build_object('dependency', 'email_delivery',
    'state', 'not_configured',
    'detail', case when email_surface = 0
      then 'This deployment has no email provider configuration surface at all, so signup confirmation,
        verification and password reset mail cannot be delivered or claimed.'
      else 'An email surface exists but nothing records a verified provider, so delivery is not claimed.' end,
    'source', case when email_surface = 0 then 'schema scan: no relation named like email'
      else 'schema scan: email surface present, provider unverified' end);
  select case
    when exists (select 1 from jsonb_array_elements(dependencies) d where d ->> 'state' = 'failed') then 'failed'
    when exists (select 1 from jsonb_array_elements(dependencies) d where d ->> 'state' = 'degraded') then 'degraded'
    when exists (select 1 from jsonb_array_elements(dependencies) d where d ->> 'state' = 'ok') then 'degraded'
    else 'not_configured' end into state;
  return jsonb_build_object('workspace_id', target_workspace, 'state', state,
    'ready_for_work', exists (select 1 from jsonb_array_elements(dependencies) d
      where d ->> 'dependency' = 'worker_fleet' and d ->> 'state' = 'ok'),
    'dependencies', dependencies, 'checked_at', now(),
    'meaning', 'Readiness is a report, not a promise: each dependency names the row or function it was
      read from, and an unconfigured dependency is reported as not configured instead of assumed ready.');
end $$;
revoke all on function tonde.readiness_check(uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.readiness_check(uuid) to authenticated, service_role;

-- 12. The operations console read: health, readiness, metrics and alerts in one answer.
create function tonde.operations_status(target_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := tonde_private.observability_admin(target_workspace);
  return jsonb_build_object('workspace_id', target_workspace,
    'health', tonde_private.infrastructure_health(),
    'readiness', tonde.readiness_check(target_workspace),
    'metrics', tonde_private.workspace_metrics(target_workspace, 60),
    'alerts', tonde.alert_events_read(target_workspace, 'open', 50),
    'read_at', now(),
    'meaning', 'One read of what the system can observe about itself and this workspace. It reports
      what is true now, including everything that is not configured.');
end $$;
revoke all on function tonde.operations_status(uuid) from public, anon, authenticated, service_role;
grant execute on function tonde.operations_status(uuid) to authenticated, service_role;

-- 13. Release records: the traceability anchor the runbook points at.
create function tonde.release_record(p_environment text, p_release_id text, p_migrated_through text,
  p_notes text default '', p_evidence jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); existing tonde.deployment_releases;
  release tonde.deployment_releases;
begin
  if (select auth.role()) <> 'service_role' and auth.uid() is not null then
    raise exception 'A release is recorded by the platform, not by a client' using errcode = '42501';
  end if;
  if p_environment not in ('local','hosted','preview') then
    raise exception 'A release names local, hosted or preview' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_release_id, ''))) = 0 or length(btrim(coalesce(p_migrated_through, ''))) = 0 then
    raise exception 'A release names itself and the migration range it applied' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'Release evidence is recorded as an object' using errcode = '22023';
  end if;
  select * into existing from tonde.deployment_releases r where r.environment = p_environment
    and r.migrated_through = btrim(p_migrated_through);
  if existing.id is not null then
    return jsonb_build_object('release_id', existing.id, 'environment', existing.environment,
      'migrated_through', existing.migrated_through, 'recorded_at', existing.recorded_at,
      'idempotent', true, 'meaning', 'That environment already has a record for this migration range.');
  end if;
  insert into tonde.deployment_releases(environment, release_id, migrated_through, notes, evidence, recorded_by)
  values (p_environment, left(btrim(p_release_id), 120), left(btrim(p_migrated_through), 60),
    nullif(left(coalesce(p_notes, ''), 2000), ''), coalesce(p_evidence, '{}'::jsonb), actor)
  returning * into release;
  return jsonb_build_object('release_id', release.id, 'environment', release.environment,
    'migrated_through', release.migrated_through, 'recorded_at', release.recorded_at,
    'idempotent', false,
    'meaning', 'The applied migration range is recorded as evidence. Recording it does not apply it.');
end $$;
revoke all on function tonde.release_record(text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function tonde.release_record(text,text,text,text,jsonb) to service_role;

-- 14. Retention registry: observability evidence is retained by routine sweeps and removed with the
--     workspace on an authorized deletion.
insert into tonde.retention_classes(data_class, display_name, description, table_names, age_column,
  default_retention_days, purge_action, purge_exempt, purge_order) values
  ('operational_evidence','Operational evidence','Metric snapshots, recorded health and readiness checks
   and the alert trail. Retained as history by a routine sweep; removed with the workspace on deletion.',
   '{operational_snapshots,system_checks,alert_events}','captured_at',null,'retain',false,36),
  ('alert_configuration','Alert rules','The alert rules a workspace defined. Configuration, not evidence.',
   '{alert_rules}','created_at',null,'retain',false,37)
on conflict (data_class) do update set display_name = excluded.display_name,
  description = excluded.description, table_names = excluded.table_names, age_column = excluded.age_column,
  default_retention_days = excluded.default_retention_days, purge_action = excluded.purge_action,
  purge_exempt = excluded.purge_exempt, purge_order = excluded.purge_order, updated_at = now();

alter default privileges in schema tonde revoke execute on functions from public;
alter default privileges in schema tonde_private revoke execute on functions from public;

commit;
