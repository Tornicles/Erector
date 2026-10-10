import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Prompt 10 packet 032 — publishing, on real embedded PostgreSQL over one 001->032 stack.
// These tests pin the laws the migration claims: a publication pins the exact version it will
// publish, publishing needs its own recorded human authorization (a creative approval is not one),
// submission is idempotent so a retry can never become a second post, PUBLISHED requires a remote
// resource, an ambiguous destination answer stays unknown until it is reconciled, and no client can
// write any of it. Nothing here contacts a provider and no external publishing capability is claimed.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, connection;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
// A service-role request carries its own role claim and no user subject, like the hosted API.
async function asService(action) {
  await db.exec('begin; set local role service_role;');
  await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);

// A fresh Production, one uploaded Result media and one Result. Each test seeds its own, so no test
// depends on what an earlier one did.
const seedProduction = label => asEditor(async () => {
  const project = await scalar("insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id", [wa, `Probe ${label}`, A]);
  const production = await scalar("insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id", [wa, project, `Probe Production ${label}`, A]);
  const media = randomUUID();
  const checksum = `sha256:probe-${label}`;
  await db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes,upload_state,checksum)
    values($1,$2,'tonde-results',$3,'clip.mp4','video/mp4','video',2048,'uploaded',$4)`,
    [media, wa, `${wa}/${media}/clip.mp4`, checksum]);
  const result = await scalar('insert into tonde.results(workspace_id,production_id,media_id) values($1,$2,$3) returning id', [wa, production, media]);
  return { project, production, media, result, checksum };
});

const createPublication = (fields, user = A) => asUser(user, () => rows(
  `select tonde.publication_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result`,
  [fields.workspace ?? wa, fields.production, fields.result, fields.provider ?? 'probe_publisher',
   fields.media ?? null, fields.destination ?? 'Probe channel', 'account' in fields ? fields.account : connection,
   fields.title ?? 'Probe title', fields.caption ?? 'Probe caption', fields.visibility ?? 'public',
   fields.scheduled ?? null, JSON.stringify(fields.config ?? {})]).then(result => result[0].result));
const setState = (publication, desired) => asEditor(() => rows(
  'select tonde.publication_set_state($1,$2,$3,$4) as result', [wa, publication, desired, 'Probe state change']).then(result => result[0].result));
const authorize = (publication, user = A, decision = 'authorize') => asUser(user, () => rows(
  'select tonde.publication_authorize($1,$2,$3,$4) as result', [wa, publication, decision, 'Probe authorization']).then(result => result[0].result));
const submit = publication => asService(() => rows(
  'select tonde.publication_submit($1,$2) as result', [wa, publication]).then(result => result[0].result));
const recordResult = (publication, attempt, outcome, over = {}) => asService(() => rows(
  'select tonde.publication_record_result($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result',
  [wa, publication, attempt, outcome, over.remoteType ?? '', over.remoteId ?? null, over.remoteUrl ?? null,
   over.remoteState ?? '', over.category ?? null, over.code ?? null, over.message ?? null]).then(result => result[0].result));
const preview = publication => asEditor(() => rows(
  'select tonde.publication_preview($1,$2) as result', [wa, publication]).then(result => result[0].result));
const reconcile = (publication, observed, over = {}, user = A) => asUser(user, () => rows(
  'select tonde.publication_reconcile($1,$2,$3,$4,$5,$6,$7) as result',
  [wa, publication, observed, over.remoteId ?? null, over.remoteState ?? '', over.category ?? null,
   over.note ?? 'Probe reconciliation']).then(result => result[0].result));

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''), current_user) $$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid(), auth.role() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
  `);
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  }
  for (const id of [A, B]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asEditor(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asOther(() => scalar('select tonde.bootstrap_workspace()'));
  // A registered destination with a verified adapter and one connected account. This is test
  // furniture proving the boundary, not a real provider: nothing here ever reaches a network.
  await asService(async () => {
    await db.query(`insert into tonde.integration_providers(key,name,category,auth_type,adapter_state,enabled,note)
      values('probe_publisher','Probe publisher','social_publishing','oauth','verified',true,'Test fixture only; no real adapter exists.')`);
    await db.query(`insert into tonde.integration_provider_capabilities(provider_key,capability_key,connection_required,required_scopes,enabled,note)
      values('probe_publisher','publish',true,$1,true,'Test fixture only.')`, [['publish_content']]);
    connection = await scalar(`insert into tonde.integration_connections(workspace_id,provider,connected_by,status,verified_at,requested_scopes,scopes,external_account_label)
      values($1,'probe_publisher',$2,'connected',now(),$3,$3,'Probe account') returning id`, [wa, A, ['publish_content']]);
    // Two honest non-destinations: one with no adapter at all, one with an adapter and no account.
    await db.query(`insert into tonde.integration_providers(key,name,category,auth_type,note)
      values('probe_unimplemented','Probe unimplemented','social_publishing','oauth','Test fixture: no adapter exists.'),
        ('probe_unconnected','Probe unconnected','social_publishing','oauth','Test fixture: adapter exists, no account is connected.')`);
    await db.query("update tonde.integration_providers set adapter_state = 'verified', enabled = true where key = 'probe_unconnected'");
    await db.query(`insert into tonde.integration_provider_capabilities(provider_key,capability_key,connection_required,required_scopes,enabled)
      values('probe_unconnected','publish',true,$1,true)`, [['publish_content']]);
  });
});

after(async () => { await db?.close(); });

test('a publication pins the exact version and refuses an unusable destination', async () => {
  const states = (await rows("select unnest(enum_range(null::tonde.publication_state))::text as value")).map(row => row.value);
  assert.deepEqual(states, ['draft', 'ready', 'awaiting_authorization', 'submitting', 'submitted',
    'processing', 'published', 'failed', 'cancelled', 'removed', 'unknown_remote_state']);
  const categories = (await rows("select unnest(enum_range(null::tonde.publication_failure_category))::text as value")).map(row => row.value);
  assert.deepEqual(categories, ['authentication_failed', 'insufficient_scope', 'rate_limited', 'invalid_media',
    'invalid_metadata', 'provider_unavailable', 'quota_exceeded', 'remote_processing_failed',
    'destination_rejected', 'policy_violation', 'unknown']);
  // Connecting a provider is an audited event, and the audit payload never carries a secret.
  assert.ok(Number(await scalar("select count(*) from tonde.audit_events where event_type = 'provider.connected'")) >= 1);
  assert.equal(Number(await scalar("select count(*) from tonde.audit_events where metadata::text ~* '(token|secret|password|bearer)'")), 0);

  const fixture = await seedProduction('pins');
  const publication = await createPublication({ production: fixture.production, result: fixture.result });
  assert.equal(publication.state, 'draft');
  assert.equal(publication.production_revision, 1);
  assert.equal(publication.result_revision, 1);
  assert.equal(publication.media_id, fixture.media);
  assert.equal(publication.media_checksum, fixture.checksum);
  assert.equal(publication.destination_provider, 'probe_publisher');
  assert.equal(await scalar('select state = \'draft\' and submission_attempts = 0 and authorization_id is null from tonde.publications where id = $1', [publication.publication_id]), true);

  // Another workspace cannot publish this workspace's Result, and cannot even read its publication.
  const crossTenant = await failure(() => createPublication({ production: fixture.production, result: fixture.result }, B));
  assert.match(crossTenant.message, /Production is not available|Workspace access denied/);
  assert.equal(Number(await asOther(() => scalar('select count(*) from tonde.publications where id = $1', [publication.publication_id]))), 0);

  const unregistered = await failure(() => createPublication({ production: fixture.production, result: fixture.result, provider: 'not_registered' }));
  assert.match(unregistered.message, /destination provider is not registered/);

  const pending = randomUUID();
  await asEditor(() => db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes)
    values($1,$2,'tonde-results',$3,'pending.mp4','video/mp4','video',2048)`, [pending, wa, `${wa}/${pending}/pending.mp4`]));
  const notUploaded = await failure(() => createPublication({ production: fixture.production, result: fixture.result, media: pending }));
  assert.match(notUploaded.message, /Only an uploaded or verified media file/);

  const badSchedule = await failure(() => createPublication({ production: fixture.production, result: fixture.result, visibility: 'scheduled' }));
  assert.match(badSchedule.message, /scheduled publication needs a future time/);

  const secretSetting = await failure(() => createPublication({
    production: fixture.production, result: fixture.result, config: { api_key: 'must-not-be-stored' } }));
  assert.match(secretSetting.message, /must not contain secrets/);

  // A publication is written by the creator RPC, never by a client session directly.
  const clientWrite = await failure(() => asEditor(() => db.query(
    `insert into tonde.publications(workspace_id,production_id,production_revision,result_id,result_revision,media_id,
      destination_provider,created_by) values($1,$2,1,$3,1,$4,'probe_publisher',$5)`,
    [wa, fixture.production, fixture.result, fixture.media, A])));
  assert.match(clientWrite.message, /permission denied/);
  const clientUpdate = await failure(() => asEditor(() => db.query(
    "update tonde.publications set title = 'client' where id = $1", [publication.publication_id])));
  assert.match(clientUpdate.message, /permission denied/);
});

test('publishing needs its own human authorization, never a creative approval', async () => {
  const fixture = await seedProduction('authorization');
  // The creative approval is recorded first and bumps the Result revision. Approval is a real
  // creator decision about creative work; it is not an authorization to publish anything.
  await asEditor(() => db.query("update tonde.results set approval = 'approved' where id = $1", [fixture.result]));
  const publication = await createPublication({ production: fixture.production, result: fixture.result });
  const id = publication.publication_id;
  assert.equal(await scalar('select authorization_id is null from tonde.publications where id = $1', [id]), true);

  // The trusted server can never manufacture a publication authorization.
  const serviceAuthorization = await failure(() => asService(() => db.query(
    `insert into tonde.publication_authorizations(workspace_id,production_id,publication_id,decision,
      production_revision,result_id,result_revision,media_id,request_fingerprint,destination_provider,actor_user_id)
      values($1,$2,$3,'authorize',1,$4,1,$5,'0123456789abcdef0123456789abcdef','probe_publisher',$6)`,
    [wa, fixture.production, id, fixture.result, fixture.media, A])));
  assert.match(serviceAuthorization.message, /human creator decision/);

  await setState(id, 'ready');
  assert.equal(await scalar("select approval::text from tonde.results where id = $1", [fixture.result]), 'approved');
  const unauthorized = await failure(() => submit(id));
  assert.match(unauthorized.message, /PUBLICATION_AUTHORIZATION_REQUIRED/);
  assert.equal(await scalar('select authorization_id is null from tonde.publications where id = $1', [id]), true);
  // The preview a creator reviews names every reason submission is not possible yet.
  const blocked = await preview(id);
  assert.equal(blocked.can_submit, false);
  assert.ok(blocked.blocked_by.includes('AUTHORIZATION_REQUIRED'));
  assert.ok(!blocked.blocked_by.some(reason => reason.startsWith('STATE_')));
  assert.equal(blocked.capability, 'AVAILABLE');

  // The creator's authorization names who, what version, which destination and when.
  const authorized = await authorize(id);
  assert.equal(authorized.decision, 'authorize');
  assert.equal(authorized.actor_user_id, A);
  assert.equal(authorized.authorized_version.result_revision, publication.result_revision);
  assert.equal(authorized.destination.provider, 'probe_publisher');
  assert.equal(await scalar('select authorization_id = $2 from tonde.publications where id = $1', [id, authorized.authorization_id]), true);
  // Authorizing publishes nothing and changes no creative decision.
  assert.equal(await scalar("select approval::text from tonde.results where id = $1", [fixture.result]), 'approved');
  assert.equal(await scalar("select state::text from tonde.publications where id = $1", [id]), 'ready');
  assert.equal(Number(await scalar('select count(*) from tonde.publication_attempts where publication_id = $1', [id])), 0);
  // Nothing is missing any more, and the preview says so with the evidence a creator reviews.
  const readyPreview = await preview(id);
  assert.deepEqual(readyPreview.blocked_by, []);
  assert.equal(readyPreview.can_submit, true);
  assert.equal(readyPreview.destination.account_label, 'Probe account');
  assert.equal(readyPreview.destination.provider, 'probe_publisher');
  assert.equal(readyPreview.content.fingerprint.length, 32);
  assert.deepEqual(readyPreview.missing_scopes, []);
  assert.equal(readyPreview.media.upload_state, 'uploaded');

  // An edit after authorization makes that authorization name different content: the publication
  // returns to waiting for authorization and the stale authorization is refused at submission.
  await asEditor(() => rows("select tonde.publication_update($1,$2,$3,$4,$5,$6,$7,$8) as result",
    [wa, id, 'Probe title', 'Edited caption', 'Probe channel', JSON.stringify({ privacy: 'public' }), 'public', null]));
  assert.equal(await scalar("select state::text from tonde.publications where id = $1", [id]), 'awaiting_authorization');
  const stalePreview = await preview(id);
  assert.equal(stalePreview.can_submit, false);
  assert.ok(stalePreview.blocked_by.includes('AUTHORIZATION_STALE'));
  await setState(id, 'ready');
  const stale = await failure(() => submit(id));
  assert.match(stale.message, /names different content/);
  // Re-authorizing the current content is what unblocks it.
  await authorize(id);
  const submitted = await submit(id);
  assert.equal(submitted.state, 'submitting');

  // Withdrawal is recorded too and blocks a later submission.
  const second = await createPublication({ production: fixture.production, result: fixture.result });
  await authorize(second.publication_id);
  const withdrawn = await authorize(second.publication_id, A, 'withdraw');
  assert.equal(withdrawn.decision, 'withdraw');
  await setState(second.publication_id, 'ready');
  const afterWithdrawal = await failure(() => submit(second.publication_id));
  assert.match(afterWithdrawal.message, /PUBLICATION_AUTHORIZATION_REQUIRED/);
  // A viewer-level member cannot authorize anything. Membership itself is a server fixture here.
  await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [wa, B]);
  const viewerAuthorization = await failure(() => authorize(second.publication_id, B));
  assert.match(viewerAuthorization.message, /Workspace access denied/);
  assert.equal(Number(await scalar("select count(*) from tonde.publication_authorizations where publication_id = $1 and actor_user_id = $2", [second.publication_id, B])), 0);
});

test('submission is idempotent and a retry reuses one real-world operation', async () => {
  const fixture = await seedProduction('idempotent');
  const publication = await createPublication({ production: fixture.production, result: fixture.result });
  const id = publication.publication_id;
  await setState(id, 'ready');
  await authorize(id);

  // A client session cannot submit: only the trusted server records an outbound attempt.
  const clientSubmit = await failure(() => asEditor(() => rows('select tonde.publication_submit($1,$2) as result', [wa, id])));
  assert.match(clientSubmit.message, /permission denied/);

  const first = await submit(id);
  assert.equal(first.attempt_number, 1);
  assert.equal(first.state, 'submitting');
  // Retry classification: in flight is not retryable, a failure is retryable through the key, and a
  // published publication must never be repeated.
  assert.equal(await asEditor(() => scalar('select tonde.publication_retry_safety($1,$2)', [wa, id])), 'requires_reconciliation_before_retry');
  assert.match(first.request_fingerprint, /^[0-9a-f]{32}$/);
  assert.equal(await scalar("select state::text from tonde.publications where id = $1", [id]), 'submitting');
  assert.equal(Number(await scalar("select count(*) from tonde.publication_attempts where publication_id = $1", [id])), 1);

  // While an attempt is in flight there is nothing to submit, so no duplicate action can start.
  const again = await failure(() => submit(id));
  assert.match(again.message, /submitted from READY/);

  const failed = await recordResult(id, first.attempt_id, 'failed', {
    category: 'rate_limited', code: 'P429', message: 'Too many requests' });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.failure_category, 'rate_limited');
  assert.equal(await scalar("select failure_category::text from tonde.publications where id = $1", [id]), 'rate_limited');
  assert.equal(await asEditor(() => scalar('select tonde.publication_retry_safety($1,$2)', [wa, id])), 'requires_idempotency_key');

  // A retry reuses the SAME operation id, idempotency key and fingerprint: the provider can
  // recognize the repeat instead of creating a second post.
  await setState(id, 'ready');
  const retry = await submit(id);
  assert.equal(retry.attempt_number, 2);
  assert.equal(retry.operation_id, first.operation_id);
  assert.equal(retry.idempotency_key, first.idempotency_key);
  assert.equal(retry.request_fingerprint, first.request_fingerprint);
  // The failure was cleared as current state because the retry is in flight; the attempt keeps it.
  assert.equal(await scalar("select failure_category is null from tonde.publications where id = $1", [id]), true);
  assert.equal(await scalar("select failure_category::text from tonde.publication_attempts where id = $1", [first.attempt_id]), 'rate_limited');

  // The adapter boundary: a destination with no adapter, or with no ready connection, cannot be
  // submitted to, and a refused submission changes nothing (the publication stays READY).
  const unimplemented = await createPublication({ production: fixture.production, result: fixture.result, provider: 'probe_unimplemented', account: null });
  await setState(unimplemented.publication_id, 'ready');
  await authorize(unimplemented.publication_id);
  const noAdapter = await failure(() => submit(unimplemented.publication_id));
  assert.match(noAdapter.message, /Publishing is not available for this destination: PROVIDER_NOT_IMPLEMENTED/);
  assert.equal(await scalar("select state::text from tonde.publications where id = $1", [unimplemented.publication_id]), 'ready');
  assert.equal(Number(await scalar('select count(*) from tonde.publication_attempts where publication_id = $1', [unimplemented.publication_id])), 0);
  const unconnected = await createPublication({ production: fixture.production, result: fixture.result, provider: 'probe_unconnected', account: null });
  await setState(unconnected.publication_id, 'ready');
  await authorize(unconnected.publication_id);
  const noConnection = await failure(() => submit(unconnected.publication_id));
  assert.match(noConnection.message, /Publishing is not available for this destination: CONNECTION_NOT_READY/);

  const published = await recordResult(id, retry.attempt_id, 'succeeded', {
    remoteType: 'post', remoteId: 'remote-post-1', remoteUrl: 'https://probe.invalid/p/1', remoteState: 'published' });
  assert.equal(published.state, 'published');
  assert.equal(await scalar("select state::text from tonde.publications where id = $1", [id]), 'published');
  assert.equal(await scalar('select published_at is not null and last_checked_at is not null and remote_resource_id = $2 from tonde.publications where id = $1', [id, 'remote-post-1']), true);
  assert.equal(await asEditor(() => scalar('select tonde.publication_retry_safety($1,$2)', [wa, id])), 'must_not_retry');
  // The consequential steps are audited as semantic events with actor, version and destination.
  const events = (await rows('select event_type, metadata from tonde.audit_events where object_id = $1', [id])).map(row => row.event_type);
  for (const expected of ['publication.authorized', 'publication.submitted', 'publication.failed', 'publication.published']) {
    assert.ok(events.includes(expected), `expected audit event ${expected}`);
  }
  const failedAudit = (await rows("select metadata from tonde.audit_events where object_id = $1 and event_type = 'publication.failed'", [id]))[0];
  assert.equal(failedAudit.metadata.outcome, 'failed');
  assert.equal(failedAudit.metadata.failure_category, 'rate_limited');

  // Attempt records are closed evidence: once an outcome is recorded they cannot be rewritten.
  const rewrite = await failure(() => asService(() => db.query(
    'update tonde.publication_attempts set failure_message = $2 where id = $1', [first.attempt_id, 'rewritten'])));
  assert.match(rewrite.message, /closed record/);
  const cancelInFlight = await failure(() => recordResult(id, retry.attempt_id, 'failed', { category: 'unknown' }));
  assert.match(cancelInFlight.message, /already recorded its outcome/);
});

test('a destination outcome is recorded truthfully: published needs a resource, unknown stays unknown', async () => {
  const fixture = await seedProduction('outcomes');
  const publication = await createPublication({ production: fixture.production, result: fixture.result });
  const id = publication.publication_id;
  const other = await createPublication({ production: fixture.production, result: fixture.result });
  await setState(id, 'ready');
  await authorize(id);
  const attempt = await submit(id);

  // The destination cannot be reported published without the resource it returned.
  const noResource = await failure(() => recordResult(id, attempt.attempt_id, 'succeeded', {}));
  assert.match(noResource.message, /records the remote resource/);
  const badOutcome = await failure(() => recordResult(id, attempt.attempt_id, 'probably_fine', {}));
  assert.match(badOutcome.message, /accepted, processing, succeeded, failed or unknown/);
  // Failed without a normalized category is not a truthful failure.
  const noCategory = await failure(() => recordResult(id, attempt.attempt_id, 'failed', {}));
  assert.match(noCategory.message, /normalized failure category/);

  // An ambiguous destination answer becomes UNKNOWN_REMOTE_STATE, not published and not failed.
  const unknown = await recordResult(id, attempt.attempt_id, 'unknown', { remoteState: 'timed out' });
  assert.equal(unknown.state, 'unknown_remote_state');
  assert.equal(await scalar("select state::text from tonde.publications where id = $1", [id]), 'unknown_remote_state');
  assert.equal(await scalar('select published_at is null and failed_at is null and last_checked_at is not null from tonde.publications where id = $1', [id]), true);
  // It cannot be retried straight from the unknown state: no duplicate action without reconciliation.
  const retryFromUnknown = await failure(() => submit(id));
  assert.match(retryFromUnknown.message, /submitted from READY/);

  // A client can record what it actually saw; the reconciliation is append-only and names the person.
  const reconciled = await reconcile(id, 'published', { remoteId: 'remote-post-2', remoteState: 'published' });
  assert.equal(reconciled.state, 'published');
  assert.equal(reconciled.source, 'manual_operator');
  assert.equal(Number(await scalar('select count(*) from tonde.publication_reconciliations where publication_id = $1', [id])), 1);
  const clientReconciliation = await failure(() => asEditor(() => db.query(
    `insert into tonde.publication_reconciliations(workspace_id,production_id,publication_id,observed_state,source,actor_user_id)
      values($1,$2,$3,'published','manual_operator',$4)`, [wa, fixture.production, id, A])));
  assert.match(clientReconciliation.message, /permission denied/);

  // Two publications can never claim the same remote resource in one workspace.
  await setState(other.publication_id, 'ready');
  await authorize(other.publication_id);
  const otherAttempt = await submit(other.publication_id);
  const duplicate = await failure(() => recordResult(other.publication_id, otherAttempt.attempt_id, 'succeeded', {
    remoteType: 'post', remoteId: 'remote-post-2' }));
  assert.match(duplicate.message, /duplicate key|unique/i);
  // An unrelated remote resource is fine, and a published publication can be reconciled to removed.
  await recordResult(other.publication_id, otherAttempt.attempt_id, 'succeeded', { remoteType: 'post', remoteId: 'remote-post-3' });
  const removed = await reconcile(other.publication_id, 'removed', { note: 'Deleted in the destination UI' });
  assert.equal(removed.state, 'removed');
  assert.equal(await scalar('select removed_at is not null from tonde.publications where id = $1', [other.publication_id]), true);
  // A draft has nothing to reconcile.
  const draft = await createPublication({ production: fixture.production, result: fixture.result });
  const premature = await failure(() => reconcile(draft.publication_id, 'published', { remoteId: 'remote-post-9' }));
  assert.match(premature.message, /cannot be reconciled/);
});

test('publication states record what happened; content freezes at the first submission', async () => {
  const fixture = await seedProduction('states');
  // A publication begins as a draft: states are history, not configuration.
  const directInsert = await failure(() => asService(() => db.query(
    `insert into tonde.publications(workspace_id,production_id,production_revision,result_id,result_revision,media_id,
      destination_provider,created_by,state) values($1,$2,1,$3,1,$4,'probe_publisher',$5,'ready')`,
    [wa, fixture.production, fixture.result, fixture.media, A])));
  assert.match(directInsert.message, /begins as a draft/);

  const publication = await createPublication({ production: fixture.production, result: fixture.result });
  const id = publication.publication_id;
  const skip = await failure(() => asService(() => db.query(
    "update tonde.publications set state = 'published' where id = $1", [id])));
  assert.match(skip.message, /cannot become published/);
  const creatorSkip = await failure(() => setState(id, 'published'));
  assert.match(creatorSkip.message, /creator action cannot move/);
  const cancelled = await setState(id, 'cancelled');
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(await scalar("select state::text from tonde.publications where id = $1", [id]), 'cancelled');

  // Cancel is terminal: nothing revives a cancelled publication.
  const revive = await failure(() => setState(id, 'ready'));
  assert.match(revive.message, /creator action cannot move|draft|failed/);

  const second = await createPublication({ production: fixture.production, result: fixture.result });
  await setState(second.publication_id, 'ready');
  await authorize(second.publication_id);
  const attempt = await submit(second.publication_id);
  // Once submitted, the content is frozen: a retry must reproduce exactly this, and different
  // content is a different publication.
  const editAfterSubmit = await failure(() => asService(() => db.query(
    "update tonde.publications set caption = 'different' where id = $1", [second.publication_id])));
  assert.match(editAfterSubmit.message, /already names the exact content/);
  const editThroughRpc = await failure(() => asEditor(() => rows(
    "select tonde.publication_update($1,$2,$3,$4,$5,$6,$7,$8) as result",
    [wa, second.publication_id, 'Probe title', 'different', 'Probe channel', '{}', 'public', null])));
  assert.match(editThroughRpc.message, /cannot be edited/);

  await recordResult(second.publication_id, attempt.attempt_id, 'accepted', { remoteState: 'queued' });
  assert.equal(await scalar("select state::text from tonde.publications where id = $1", [second.publication_id]), 'submitted');
  const doubleOutcome = await failure(() => recordResult(second.publication_id, attempt.attempt_id, 'succeeded', { remoteId: 'probe-2' }));
  assert.match(doubleOutcome.message, /already recorded its outcome/);
  // Published does not go backwards.
  const backToSubmitting = await failure(() => asService(() => db.query(
    "update tonde.publications set state = 'submitting' where id = $1", [second.publication_id])));
  assert.match(backToSubmitting.message, /cannot become submitting/);
  // The reserved failure fields cannot be parked outside a failure.
  const parkedFailure = await failure(() => asService(() => db.query(
    "update tonde.publications set failure_category = 'unknown' where id = $1", [second.publication_id])));
  assert.match(parkedFailure.message, /publication_failure_is_current|check constraint/i);
});

test('a non-member is refused before the publication is looked up (migration 035)', async () => {
  // Migration 032 resolved the publication first and only then checked workspace membership, so a
  // caller outside the workspace received P0002 ("does not exist in this workspace"). PostgREST
  // reports an unmapped P0002 as HTTP 500 - a server error for a deterministic authorization answer,
  // and an existence signal to someone with no access. Migration 035 puts the decision first, and
  // the hosted acceptance runner's cross-tenant sweep is what caught the original ordering.
  const foreign = await failure(() => asEditor(() => rows(
    'select tonde.publication_reconcile($1,$2,$3,$4,$5,$6,$7) as result',
    [wb, randomUUID(), 'published', 'remote-foreign', 'published', null, 'Probe cross-tenant'])));
  assert.equal(foreign.code, '42501');
  assert.match(foreign.message, /Workspace access denied/);
  // A member still gets the honest not-found answer, and the reconciliation is not a client write.
  const missing = await failure(() => reconcile(randomUUID(), 'published', { remoteId: 'remote-missing' }));
  assert.equal(missing.code, 'P0002');
  assert.match(missing.message, /does not exist in this workspace/);
});
