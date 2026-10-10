import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Prompt 11 packet 037 — large media ingestion, on real embedded PostgreSQL over one 001->037 stack.
// These tests pin the laws the migration claims: the server decides the bucket and the object key, an
// upload is only VERIFIED after the stored object was actually observed, a mismatch is rejected rather
// than faked, processing work commits in the same transaction as the verification, a scanner's absence
// is recorded as NOT_CONFIGURED (never as clean), infected media is quarantined and cannot be used,
// probing and derivation are idempotent by content identity, and a client session can neither write a
// verification nor reach another workspace's media.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, production;
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
async function asService(action) {
  await db.exec('begin; set local role service_role;');
  await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);

const createIntent = (over = {}) => asUser(over.user ?? A, () => rows(
  'select tonde.media_upload_intent_create($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [over.workspace ?? wa, over.purpose ?? 'result', over.filename ?? 'clip.mp4', over.mime ?? 'video/mp4',
   over.bytes === undefined ? 2048 : over.bytes, over.production ?? null, over.resumable ?? true,
   over.checksum ?? null]).then(result => result[0].result));
const part = (intent, partNumber, bytes, etag = null, user = A, workspace = wa) => asUser(user, () => rows(
  'select tonde.media_upload_part($1,$2,$3,$4,$5) as result', [workspace, intent, partNumber, bytes, etag])
  .then(result => result[0].result));
const verify = (intent, over = {}) => asService(() => rows(
  'select tonde.media_upload_verify($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [over.workspace ?? wa, intent, over.bytes === undefined ? 2048 : over.bytes, over.mime ?? 'video/mp4',
   over.checksum === undefined ? null : over.checksum,
   over.objectVerified === undefined ? true : over.objectVerified,
   JSON.stringify(over.probe ?? {}), over.verifier ?? 'probe-verifier']).then(result => result[0].result));
const abort = (intent, reason = 'Probe abort', user = A, workspace = wa) => asUser(user, () => rows(
  'select tonde.media_upload_abort($1,$2,$3) as result', [workspace, intent, reason]).then(result => result[0].result));
const expireIntents = (limit = 200) => asService(() => rows(
  'select tonde.media_intent_expire($1) as result', [limit]).then(result => result[0].result));
const scan = (media, over = {}) => asService(() => rows(
  'select tonde.media_scan_record($1,$2,$3,$4,$5,$6) as result',
  [media, over.scanner ?? 'none', over.state ?? 'not_configured', over.version ?? '',
   JSON.stringify(over.findings ?? []), over.recordedBy ?? 'probe-scanner']).then(result => result[0].result));
const processing = (media, state, note = 'Probe processing') => asService(() => rows(
  'select tonde.media_processing_state($1,$2,$3) as result', [media, state, note])
  .then(result => result[0].result));
const probeRecord = (media, facts, tool = 'tonde-probe', version = '1') => asService(() => rows(
  'select tonde.media_probe_record($1,$2,$3,$4) as result',
  [media, JSON.stringify(facts), tool, version]).then(result => result[0].result));
const derive = (source, over = {}) => asService(() => rows(
  'select tonde.media_derivation_request($1,$2,$3,$4,$5) as result',
  [source, over.type ?? 'proxy', over.transform ?? 'h264:720p', over.version ?? '1',
   over.priority ?? null]).then(result => result[0].result));
const deriveBuilding = derivation => asService(() => rows(
  'select tonde.media_derivation_building($1) as result', [derivation]).then(result => result[0].result));
const deriveComplete = (derivation, output, over = {}) => asService(() => rows(
  'select tonde.media_derivation_complete($1,$2,$3,$4) as result',
  [derivation, output, over.bytes ?? 1024, over.checksum ?? 'sha256:proxy-1']).then(result => result[0].result));
const deriveFail = (derivation, code, message) => asService(() => rows(
  'select tonde.media_derivation_fail($1,$2,$3) as result', [derivation, code, message])
  .then(result => result[0].result));
const mediaStatus = (media, user = A, workspace = wa) => asUser(user, () => rows(
  'select tonde.media_status($1,$2) as result', [workspace, media]).then(result => result[0].result));
const intentStatus = (intent, user = A, workspace = wa) => asUser(user, () => rows(
  'select tonde.media_upload_intent_status($1,$2) as result', [workspace, intent]).then(result => result[0].result));
const limits = (user = A) => asUser(user, () => rows('select tonde.media_upload_limits() as result')
  .then(result => result[0].result));

// An upload intent plus a real per-application derivation output row, so tests never depend on a
// previous test's furniture.
const verifiedSource = async (over = {}) => {
  const intent = await createIntent({ bytes: over.bytes ?? 4096, mime: over.mime ?? 'video/mp4',
    purpose: over.purpose ?? 'result', filename: over.filename ?? 'source.mp4' });
  const verified = await verify(intent.intent_id, { bytes: over.bytes ?? 4096, mime: over.mime ?? 'video/mp4',
    checksum: over.checksum ?? 'sha256:source-probe', probe: over.probe ?? {} });
  return { ...intent, verified };
};
const seedDerivedMedia = (sourceMedia, over = {}) => asService(async () => {
  const id = randomUUID();
  const checksum = over.checksum ?? `sha256:derived-${id.slice(0, 8)}`;
  await db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,
    file_category,bytes,upload_state,processing_state,checksum,derived_from_id,verified_at,verified_by,
    verified_bytes,verified_checksum,verification,created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,'verified','ready',$9,$10,now(),'probe-deriver',$8,$9,
      jsonb_build_object('object_verified', true),$11)`,
    [id, wa, over.bucket ?? 'tonde-production-media', `${wa}/${id}/derived.${over.extension ?? 'mp4'}`,
     over.filename ?? 'derived.mp4', over.mime ?? 'video/mp4', over.category ?? 'proxy', over.bytes ?? 1024,
     checksum, sourceMedia, A]);
  return id;
});

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
  production = await asEditor(async () => {
    const project = await scalar("insert into tonde.projects(workspace_id,title,created_by) values($1,'Media probe',$2) returning id", [wa, A]);
    return scalar("insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,'Media probe production',$3) returning id", [wa, project, A]);
  });
});

after(async () => { await db?.close(); });

test('the media vocabulary, the size law and the upload limits are closed and server-owned', async () => {
  // The 001 foundation values all survive; Prompt 11 adds the verification and lifecycle states.
  assert.equal(await scalar(`select count(*)::integer from pg_constraint where conrelid = 'tonde.media_files'::regclass
    and conname = 'media_files_upload_state_check'
    and pg_get_constraintdef(oid) like '%verified%' and pg_get_constraintdef(oid) like '%quarantined%'`), 1);
  for (const state of ['pending','uploading','uploaded','verifying','verified','quarantined','rejected','aborted','failed','deleted']) {
    assert.equal(await scalar("select pg_get_constraintdef(oid) like $1 from pg_constraint where conname = 'media_files_upload_state_check'",
      [`%'${state}'%`]), true, `upload_state ${state}`);
  }
  for (const state of ['pending','blocked','processing','ready','failed','skipped']) {
    assert.equal(await scalar("select pg_get_constraintdef(oid) like $1 from pg_constraint where conname = 'media_files_processing_state_check'",
      [`%'${state}'%`]), true, `processing_state ${state}`);
  }
  // The foundation-era 50 MiB ceiling is gone; a large video row is representable.
  assert.equal(await scalar("select pg_get_constraintdef(oid) like '%52428800%' from pg_constraint where conname = 'media_files_bytes_check'"), false);
  const hugeId = randomUUID();
  const big = await asService(() => scalar(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,
    mime_type,file_category,bytes,created_by) values($1,$2,'tonde-results',$3,'huge.mp4','video/mp4','video',5368709120,$4) returning bytes`,
    [hugeId, wa, `${wa}/${hugeId}/huge.mp4`, A]));
  assert.equal(String(big), '5368709120');
  const info = await limits();
  await assert.rejects(asUser(A, () => db.query(
    `select tonde.media_upload_intent_create($1,'result','too-large.mp4','video/mp4',536870912,null,false,null)`, [wa])),
    /at most 52428800 bytes/i);
  assert.equal(info.absolute_max_bytes, 137438953472);
  assert.equal(info.scanner_configured, false);
  assert.equal(info.resumable_threshold_bytes, 8388608);
  const purposes = Object.fromEntries(info.purposes.map(entry => [entry.purpose, entry.max_bytes]));
  assert.equal(purposes.result, 52428800, 'the logical result ceiling is clamped to the 50 MiB bucket limit');
  assert.equal(purposes.export_artifact, 52428800, 'the export artifact ceiling is clamped to its bucket');
  assert.ok(purposes.attachment <= purposes.result, 'an attachment is never allowed above the configured 50 MiB storage ceiling');
  assert.ok(info.purposes.find(entry => entry.purpose === 'result').supported_mime_types.includes('video/mp4'));
  assert.equal(info.purposes.find(entry => entry.purpose === 'result').supported_mime_types.includes('image/jpeg'), true);
  assert.equal(info.purposes.find(entry => entry.purpose === 'result').supported_mime_types.includes('application/pdf'), false);
  for (const mime of ['video/mp4', 'video/webm', 'audio/flac', 'image/heic']) {
    assert.ok(info.supported_mime_types.includes(mime), mime);
  }
  assert.equal(info.supported_mime_types.includes('application/pdf'), true);
  assert.equal(info.supported_mime_types.includes('text/vtt'), true);
});

test('the server authorizes one exact object for one bounded window, and never a client-chosen path', async () => {
  const intent = await createIntent({ purpose: 'result', filename: 'A-roll 001.mp4', bytes: 10485760, production });
  assert.equal(intent.state, 'created');
  assert.equal(intent.bucket, 'tonde-results');
  assert.equal(intent.object_key, `${wa}/${intent.media_id}/original.mp4`);
  assert.equal(intent.storage_path_is_server_owned, true);
  assert.equal(intent.max_bytes, 52428800);
  assert.equal(intent.resumable, true);
  assert.ok(new Date(intent.expires_at) > new Date());
  const media = (await rows(`select upload_state, processing_state, file_category, bucket, bytes, upload_intent_id,
    verified_at, scan_state from tonde.media_files where id = $1`, [intent.media_id]))[0];
  assert.deepEqual(media, { upload_state: 'pending', processing_state: 'pending', file_category: 'video',
    bucket: 'tonde-results', bytes: 10485760, upload_intent_id: intent.intent_id, verified_at: null,
    scan_state: 'not_configured' });
  // The path is derived from the workspace and media identity, and the database enforces that law even
  // against a direct insert the RPC would never make.
  const forged = await failure(() => asService(() => db.query(`insert into tonde.media_upload_intents(workspace_id,
    media_id,purpose,bucket,object_key,expected_mime_type,max_bytes,expires_at,created_by)
    values($1,$2,'result','tonde-results',$3,'video/mp4',1000,now() + interval '1 hour',$4)`,
    [wa, intent.media_id, `${wb}/${randomUUID()}/original.mp4`, A])));
  assert.match(forged.message, /upload_intent_path_is_derived/);
  // A filename that is really a path is refused outright.
  assert.equal((await failure(() => createIntent({ filename: '../../etc/passwd' }))).code, '22023');
  assert.equal((await failure(() => createIntent({ filename: 'nested/clip.mp4' }))).code, '22023');
  assert.equal((await failure(() => createIntent({ filename: 'back\\slash.mp4' }))).code, '22023');
  // Unknown purposes, unaccepted types and oversized requests are refused with a reason, not silently.
  assert.equal((await failure(() => createIntent({ purpose: 'anything' }))).code, '22023');
  assert.equal((await failure(() => createIntent({ mime: 'application/x-msdownload' }))).code, '22023');
  assert.equal((await failure(() => createIntent({ purpose: 'attachment', mime: 'video/mp4', bytes: 1073741824 }))).code, '22023');
  assert.equal((await failure(() => createIntent({ bytes: 34359738369 }))).code, '22023');
  // A Production in another workspace cannot be named.
  assert.equal((await failure(() => createIntent({ production: randomUUID() }))).code, 'P0002');
});

test('parts record resumable progress, are idempotent per part, and conflict rather than overwrite', async () => {
  const intent = await createIntent({ bytes: 25165824, filename: 'long-take.mov', mime: 'video/quicktime' });
  const first = await part(intent.intent_id, 1, 8388608, 'etag-1');
  assert.equal(first.state, 'uploading');
  assert.equal(first.parts_recorded, 1);
  assert.equal(first.idempotent, false);
  const same = await part(intent.intent_id, 1, 8388608, 'etag-1');
  assert.equal(same.idempotent, true);
  assert.equal(same.parts_recorded, 1);
  const conflicts = await failure(() => part(intent.intent_id, 1, 4194304, 'etag-other'));
  assert.equal(conflicts.code, 'PT409');
  assert.match(conflicts.message, /UPLOAD_PART_CONFLICT/);
  const third = await part(intent.intent_id, 3, 8388608, 'etag-3');
  assert.equal(third.parts_recorded, 2);
  assert.equal(third.bytes_recorded, 16777216);
  const status = await intentStatus(intent.intent_id);
  assert.equal(status.state, 'uploading');
  assert.equal(status.bytes_recorded, 16777216);
  assert.equal(status.parts_recorded, 2);
  assert.equal(status.storage_path_is_server_owned, true);
  assert.equal((await failure(() => part(intent.intent_id, 0, 10))).code, '22023');
  assert.equal((await failure(() => part(intent.intent_id, 1, -5))).code, '22023');
  // A client of another workspace cannot record parts, and the refusal precedes the lookup: naming a
  // workspace they do not belong to is denied whether or not the intent exists.
  assert.equal((await failure(() => part(intent.intent_id, 4, 10, null, B))).code, '42501');
  assert.equal((await failure(() => part(randomUUID(), 1, 10, null, B))).code, '42501');
  assert.equal((await failure(() => abort(intent.intent_id, 'probe', B))).code, '42501');
});

test('verification requires an observed object and commits the processing work with it', async () => {
  const intent = await createIntent({ bytes: 2097152, filename: 'interview.mp4' });
  // Without an observation there is no verification: the browser saying "complete" is not evidence.
  const unobserved = await failure(() => verify(intent.intent_id, { bytes: 2097152, objectVerified: false }));
  assert.equal(unobserved.code, 'PT409');
  assert.match(unobserved.message, /OBJECT_NOT_VERIFIED/);
  assert.equal(await scalar("select upload_state from tonde.media_files where id = $1", [intent.media_id]), 'pending');
  const verified = await verify(intent.intent_id, { bytes: 2097152, checksum: 'sha256:interview-1' });
  assert.equal(verified.state, 'verified');
  assert.equal(verified.idempotent, false);
  assert.equal(verified.bytes, 2097152);
  assert.equal(verified.checksum, 'sha256:interview-1');
  assert.equal(verified.scan_state, 'not_configured');
  assert.match(verified.scan_claim, /No content scanner is configured/);
  const media = (await rows(`select upload_state, processing_state, bytes, checksum, verified_at is not null as stamped,
    verified_by, verified_bytes, verified_checksum, scan_state, verification from tonde.media_files where id = $1`,
    [intent.media_id]))[0];
  assert.deepEqual({ ...media, verified_at: undefined, verification: undefined },
    { upload_state: 'verified', processing_state: 'pending', bytes: 2097152, checksum: 'sha256:interview-1',
      stamped: true, verified_by: 'probe-verifier', verified_bytes: 2097152,
      verified_checksum: 'sha256:interview-1', scan_state: 'not_configured', verified_at: undefined,
      verification: undefined });
  assert.equal(media.verification.object_verified, true);
  assert.equal(media.verification.checksum_available, true);
  assert.equal(media.verification.scan_state, 'not_configured');
  // The durable work request and the domain change are one transaction; the same key is never queued twice.
  const job = (await rows(`select id, job_type, worker_class, status::text, input_metadata, priority,
    idempotency_key, deadline_at is not null as bounded from tonde.jobs where idempotency_key = $1`,
    [`upload.verified:${intent.intent_id}`]))[0];
  assert.ok(job, 'the preprocessing job exists');
  assert.equal(job.job_type, 'media_preprocessing');
  assert.equal(job.worker_class, 'media');
  assert.equal(job.status, 'queued');
  assert.equal(job.priority, 55);
  assert.equal(job.bounded, true);
  assert.equal(job.input_metadata.media_id, intent.media_id);
  assert.equal(job.input_metadata.purpose, 'result');
  assert.equal(Number(await scalar(`select count(*) from tonde.jobs where idempotency_key = $1`,
    [`upload.verified:${intent.intent_id}`])), 1);
  const event = (await rows(`select state, event_type, resource_id, payload from tonde.outbox_events
    where dedupe_key = $1`, [`media.verified:${intent.media_id}`]))[0];
  assert.ok(event, 'the verification emitted its outbox event');
  assert.equal(event.state, 'pending');
  assert.equal(event.event_type, 'media.verified');
  assert.equal(event.resource_id, intent.media_id);
  assert.equal(event.payload.job_id, job.id);
  // A duplicate verification is recognised and queues nothing further.
  const duplicate = await verify(intent.intent_id, { bytes: 2097152, checksum: 'sha256:interview-1' });
  assert.equal(duplicate.idempotent, true);
  assert.equal(Number(await scalar(`select count(*) from tonde.jobs where idempotency_key = $1`,
    [`upload.verified:${intent.intent_id}`])), 1);
  assert.equal(Number(await scalar('select count(*) from tonde.outbox_events where dedupe_key = $1',
    [`media.verified:${intent.media_id}`])), 1);
  // A client session can never verify anything.
  const denied = await failure(() => asEditor(() => db.query(
    "select tonde.media_upload_verify($1,$2,2097152,'video/mp4','sha256:x',true,'{}'::jsonb,'probe')",
    [wa, intent.intent_id])));
  assert.match(denied.message, /permission denied/i);
});

test('a mismatch between the stored object and the authorization is rejected, not accepted', async () => {
  // Size.
  const size = await createIntent({ bytes: 4096, filename: 'wrong-size.mp4' });
  const sizeRejected = await verify(size.intent_id, { bytes: 8192, checksum: 'sha256:x' });
  assert.equal(sizeRejected.state, 'rejected');
  assert.equal(sizeRejected.rejection_reason, 'size');
  assert.equal(await scalar("select upload_state from tonde.media_files where id = $1", [size.media_id]), 'rejected');
  assert.equal(await scalar("select processing_state from tonde.media_files where id = $1", [size.media_id]), 'failed');
  assert.equal(Number(await scalar('select count(*) from tonde.jobs where idempotency_key = $1',
    [`upload.verified:${size.intent_id}`])), 0);
  // Type.
  const type = await createIntent({ bytes: 4096, filename: 'wrong-type.mp4' });
  const typeRejected = await verify(type.intent_id, { bytes: 4096, mime: 'image/png' });
  assert.equal(typeRejected.rejection_reason, 'mime');
  // Checksum, when the creator declared one up front.
  const checksum = await createIntent({ bytes: 4096, filename: 'wrong-hash.mp4', checksum: 'sha256:declared' });
  const checksumRejected = await verify(checksum.intent_id, { bytes: 4096, checksum: 'sha256:different' });
  assert.equal(checksumRejected.rejection_reason, 'checksum');
  assert.match(checksumRejected.rejection_detail, /does not match/);
  // A rejected upload cannot be verified again: a closed intent never reopens, even if a later
  // observation would have matched.
  const reopened = await failure(() => verify(checksum.intent_id, { bytes: 4096, checksum: 'sha256:declared' }));
  assert.equal(reopened.code, 'PT409');
  assert.match(reopened.message, /UPLOAD_INTENT_CLOSED/);
  assert.equal(await scalar("select upload_state from tonde.media_files where id = $1", [checksum.media_id]), 'rejected');
  assert.equal(await scalar("select count(*)::integer from tonde.audit_events where event_type = 'media.upload_rejected'"), 3);
});

test('an abandoned or expired upload closes honestly instead of leaving a pending object', async () => {
  const abandoned = await createIntent({ bytes: 1024, filename: 'abandon.mp4' });
  const abortedResult = await abort(abandoned.intent_id, 'Creator cancelled the upload');
  assert.equal(abortedResult.state, 'aborted');
  assert.equal(abortedResult.idempotent, false);
  assert.equal((await abort(abandoned.intent_id)).idempotent, true);
  assert.equal(await scalar("select upload_state from tonde.media_files where id = $1", [abandoned.media_id]), 'aborted');
  const closed = await failure(() => verify(abandoned.intent_id, { bytes: 1024 }));
  assert.equal(closed.code, 'PT409');
  assert.match(closed.message, /UPLOAD_INTENT_CLOSED/);
  // An expired intent cannot be completed, and the sweep closes it.
  const stale = await createIntent({ bytes: 1024, filename: 'stale.mp4' });
  await db.query("update tonde.media_upload_intents set expires_at = now() - interval '1 minute' where id = $1",
    [stale.intent_id]);
  const expired = await failure(() => verify(stale.intent_id, { bytes: 1024 }));
  assert.match(expired.message, /UPLOAD_INTENT_EXPIRED/);
  const sweep = await expireIntents();
  assert.ok(sweep.expired >= 1);
  assert.equal(await scalar("select state from tonde.media_upload_intents where id = $1", [stale.intent_id]), 'expired');
  assert.equal(await scalar("select upload_state from tonde.media_files where id = $1", [stale.media_id]), 'failed');
  assert.equal((await failure(() => expireIntents(0))).code, '22023');
});

test('a client session can describe an upload but can never assert verification or safety', async () => {
  const intent = await createIntent({ bytes: 2048, filename: 'client-guard.mp4' });
  assert.match((await failure(() => asEditor(() => db.query(
    "update tonde.media_files set upload_state = 'verified' where id = $1", [intent.media_id])))).message, /trusted server/i);
  assert.match((await failure(() => asEditor(() => db.query(
    "update tonde.media_files set scan_state = 'clean' where id = $1", [intent.media_id])))).message, /trusted server/i);
  assert.match((await failure(() => asEditor(() => db.query(
    "update tonde.media_files set verified_bytes = 2048 where id = $1", [intent.media_id])))).message, /trusted server/i);
  assert.match((await failure(() => asEditor(() => db.query(
    "update tonde.media_files set verification = jsonb_build_object('object_verified', true) where id = $1",
    [intent.media_id])))).message, /trusted server/i);
  // A client cannot insert a row that arrives already verified or scanned either.
  assert.match((await failure(() => asEditor(() => db.query(`insert into tonde.media_files(workspace_id,bucket,
    object_key,original_filename,mime_type,file_category,bytes,upload_state,created_by)
    values($1,'tonde-results',$2,'liar.mp4','video/mp4','video',10,'verified',$3)`,
    [wa, `${wa}/${randomUUID()}/liar.mp4`, A])))).message, /trusted server/i);
  // The normal product path still works: a client marks its own upload as uploaded, nothing more.
  const uploaded = await asEditor(() => rows(
    "update tonde.media_files set upload_state = 'uploaded' where id = $1 returning upload_state", [intent.media_id]));
  assert.equal(uploaded[0].upload_state, 'uploaded');
  // The database refuses a verification that names no observation, whatever the role.
  const incomplete = await failure(() => asService(() => db.query(
    "update tonde.media_files set upload_state = 'verified' where id = $1", [intent.media_id])));
  assert.match(incomplete.message, /A verified media file records when and how large/);
});

test('the scan seam is recorded truthfully: absent means absent, infected means contained', async () => {
  const { media_id: media } = await verifiedSource({ filename: 'scan-me.mp4' });
  const recorded = await scan(media);
  assert.equal(recorded.scan_state, 'not_configured');
  assert.match(recorded.meaning, /No content scanner is configured/);
  const record = (await rows(`select scanner, scanner_version, state, recorded_by from tonde.media_scans
    where media_id = $1`, [media]))[0];
  assert.deepEqual(record, { scanner: 'none', scanner_version: '', state: 'not_configured', recorded_by: 'probe-scanner' });
  // A verdict needs a scanner: 'none' may never be reported as clean.
  assert.equal((await failure(() => scan(media, { scanner: 'none', state: 'clean' }))).code, '22023');
  assert.equal((await failure(() => scan(media, { scanner: 'clamav', state: 'not_configured' }))).code, '22023');
  assert.equal((await failure(() => scan(media, { scanner: 'clamav', state: 'maybe' }))).code, '22023');
  assert.equal((await failure(() => scan(media, { scanner: '', state: 'clean' }))).code, '22023');
  // A real scanner that reports clean is recorded as clean, with its version.
  const clean = await scan(media, { scanner: 'clamav', state: 'clean', version: '1.3.0' });
  assert.equal(clean.scan_state, 'clean');
  assert.equal(await scalar('select scan_state from tonde.media_files where id = $1', [media]), 'clean');
  assert.equal(await scalar('select count(*)::integer from tonde.media_scans where media_id = $1', [media]), 2);
  // An infected verdict quarantines and blocks, and there is no path from there to usable.
  const infected = await scan(media, { scanner: 'clamav', state: 'infected', version: '1.3.0',
    findings: [{ signature: 'EICAR-Test-File', path: 'original.mp4' }] });
  assert.equal(infected.scan_state, 'infected');
  assert.equal(infected.upload_state, 'quarantined');
  assert.equal(infected.processing_state, 'blocked');
  assert.equal(await scalar("select upload_state = 'quarantined' and processing_state = 'blocked' from tonde.media_files where id = $1", [media]), true);
  const blocked = await failure(() => processing(media, 'ready'));
  assert.equal(blocked.code, 'PT409');
  assert.match(blocked.message, /MEDIA_QUARANTINED/);
  // Even a direct write cannot leave an infected row usable.
  const direct = await failure(() => asService(() => db.query(
    "update tonde.media_files set upload_state = 'verified' where id = $1", [media])));
  assert.match(direct.message, /Infected media is quarantined and blocked/);
  const status = await mediaStatus(media);
  assert.equal(status.usable, false);
  assert.match(status.scan_claim, /unsafe/);
});

test('processing refuses unverified media and records the transitions it is allowed to make', async () => {
  const intent = await createIntent({ bytes: 2048, filename: 'unverified.mp4' });
  const refused = await failure(() => processing(intent.media_id, 'processing'));
  assert.equal(refused.code, 'PT409');
  assert.match(refused.message, /MEDIA_NOT_VERIFIED/);
  const { media_id: media } = await verifiedSource({ filename: 'processing.mp4' });
  const started = await processing(media, 'processing');
  assert.equal(started.previous_state, 'pending');
  assert.equal(started.processing_state, 'processing');
  const ready = await processing(media, 'ready', 'Probe finished the normalization');
  assert.equal(ready.processing_state, 'ready');
  assert.match(ready.meaning, /usable/);
  const status = await mediaStatus(media);
  assert.equal(status.usable, true);
  assert.equal(status.processing_state, 'ready');
  assert.equal((await failure(() => processing(media, 'somewhere'))).code, '22023');
});

test('probing is recorded once per content identity and probe version, and never invents metadata', async () => {
  const { media_id: media } = await verifiedSource({ filename: 'probe.mp4' });
  const facts = { container: 'mov,mp4,m4a,3gp,3g2,mj2', codec: 'h264', audio_codec: 'aac',
    duration_ms: 4200, width: 3840, height: 2160, frame_rate: 23.976, bit_rate: 48000000,
    audio_tracks: 2, sample_rate: 48000, bit_depth: 16, color_primaries: 'bt709',
    transfer_characteristics: 'bt709', orientation: 1, has_audio: true, variable_frame_rate: false };
  const first = await probeRecord(media, facts);
  assert.equal(first.idempotent, false);
  assert.equal(first.probe_version, '1');
  const again = await probeRecord(media, facts);
  assert.equal(again.idempotent, true);
  const record = (await rows(`select container, codec, audio_codec, duration_ms, width, height, frame_rate,
    bit_rate, audio_tracks, sample_rate, bit_depth, orientation, has_audio, probe_version, source_checksum
    from tonde.media_technical_metadata where media_id = $1`, [media]))[0];
  assert.equal(record.container, facts.container);
  assert.equal(record.codec, 'h264');
  assert.equal(String(record.duration_ms), '4200');
  assert.equal(record.width, 3840);
  assert.equal(record.height, 2160);
  assert.equal(Number(record.frame_rate), 23.976);
  assert.equal(record.audio_tracks, 2);
  assert.equal(record.orientation, 1);
  assert.equal(record.has_audio, true);
  assert.equal(record.source_checksum, 'sha256:source-probe');
  // A new probe version records a new normalization without losing the identity.
  const nextVersion = await probeRecord(media, { ...facts, codec: 'hevc' }, 'tonde-probe', '2');
  assert.equal(nextVersion.idempotent, false);
  assert.equal(await scalar('select codec from tonde.media_technical_metadata where media_id = $1', [media]), 'hevc');
  assert.equal(await scalar('select count(*)::integer from tonde.media_technical_metadata where media_id = $1', [media]), 1);
  // An unverified object is never probed, and facts are validated.
  const intent = await createIntent({ bytes: 1024, filename: 'not-yet.mp4' });
  assert.equal((await failure(() => probeRecord(intent.media_id, facts))).code, 'PT409');
  assert.equal((await failure(() => probeRecord(media, 'not an object'))).code, '22023');
  // Metadata is tenant-readable and never world-readable.
  const mine = await asEditor(() => rows('select count(*)::integer as total from tonde.media_technical_metadata where media_id = $1', [media]));
  assert.equal(mine[0].total, 1);
  const theirs = await asOther(() => rows('select count(*)::integer as total from tonde.media_technical_metadata where media_id = $1', [media]));
  assert.equal(theirs[0].total, 0);
});

test('derivations are idempotent by source and transform, and never replace the original', async () => {
  const source = await verifiedSource({ filename: 'derive.mp4', checksum: 'sha256:derive-source' });
  const first = await derive(source.media_id, { type: 'proxy', transform: 'h264:720p' });
  assert.equal(first.state, 'requested');
  assert.equal(first.idempotent, false);
  assert.equal(first.source_checksum, 'sha256:derive-source');
  const job = (await rows('select job_type, worker_class, input_metadata, idempotency_key, status::text from tonde.jobs where id = $1',
    [first.job_id]))[0];
  assert.equal(job.job_type, 'proxy');
  assert.equal(job.worker_class, 'media');
  assert.equal(job.status, 'queued');
  assert.equal(job.idempotency_key, `derivation:${first.derivation_id}`);
  assert.equal(job.input_metadata.transform_key, 'h264:720p');
  // The same transform of the same source is not built twice.
  const repeat = await derive(source.media_id, { type: 'proxy', transform: 'h264:720p' });
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.derivation_id, first.derivation_id);
  assert.equal(Number(await scalar('select count(*) from tonde.jobs where idempotency_key = $1',
    [`derivation:${first.derivation_id}`])), 1);
  // A different transform version is a different derivation.
  const versioned = await derive(source.media_id, { type: 'proxy', transform: 'h264:720p', version: '2' });
  assert.equal(versioned.derivation_id === first.derivation_id, false);
  // A thumbnail is its own derivation type.
  const thumbnail = await derive(source.media_id, { type: 'thumbnail', transform: 'poster:1s' });
  assert.equal(thumbnail.derivation_type, 'thumbnail');
  assert.equal(thumbnail.derivation_id === first.derivation_id, false);
  assert.equal(await scalar("select job_type from tonde.jobs where id = $1", [thumbnail.job_id]), 'thumbnail');
  // Building → ready, with the output inheriting provenance from the original.
  await deriveBuilding(first.derivation_id);
  const output = await seedDerivedMedia(source.media_id, { checksum: 'sha256:proxy-output' });
  const completed = await deriveComplete(first.derivation_id, output, { bytes: 65536, checksum: 'sha256:proxy-output' });
  assert.equal(completed.state, 'ready');
  assert.equal(completed.idempotent, false);
  assert.equal(completed.source_unchanged, true);
  assert.equal(completed.output_media_id, output);
  const duplicate = await deriveComplete(first.derivation_id, output);
  assert.equal(duplicate.idempotent, true);
  // The original is untouched: same bytes, same checksum, not replaced by the proxy.
  assert.equal(await scalar("select verified_checksum = 'sha256:derive-source' and bytes = 4096 from tonde.media_files where id = $1",
    [source.media_id]), true);
  assert.equal(await scalar('select derived_from_id from tonde.media_files where id = $1', [output]), source.media_id);
  // An output that does not inherit provenance is refused.
  const stranger = await derivedMediaWithoutProvenance();
  const wrongOutput = await failure(() => deriveComplete(thumbnail.derivation_id, stranger));
  assert.match(wrongOutput.message, /inherit provenance from its source/);
  const missingOutput = await failure(() => deriveComplete(thumbnail.derivation_id, randomUUID()));
  assert.equal(missingOutput.code, '22023');
});

test('a derivation refuses unverified or quarantined sources and records its failures', async () => {
  const intent = await createIntent({ bytes: 1024, filename: 'underived.mp4' });
  assert.equal((await failure(() => derive(intent.media_id))).code, 'PT409');
  const quarantined = await verifiedSource({ filename: 'infected-source.mp4' });
  await scan(quarantined.media_id, { scanner: 'clamav', state: 'infected', version: '1.3.0' });
  const refused = await failure(() => derive(quarantined.media_id));
  assert.equal(refused.code, 'PT409');
  assert.match(refused.message, /MEDIA_QUARANTINED/);
  assert.equal((await failure(() => derive(quarantined.media_id, { type: 'not_a_derivation' }))).code, '22023');
  assert.equal((await failure(() => derive(quarantined.media_id, { transform: '   ' }))).code, '22023');
  // A failure is recorded with its cause, and a finished derivation cannot change state.
  const source = await verifiedSource({ filename: 'failing-derivation.mp4' });
  const request = await derive(source.media_id, { type: 'waveform', transform: 'peaks:1000' });
  const failed = await deriveFail(request.derivation_id, 'DECODE_FAILED', 'The audio track could not be decoded');
  assert.equal(failed.state, 'failed');
  assert.equal(failed.failure_code, 'DECODE_FAILED');
  assert.equal((await failure(() => deriveComplete(request.derivation_id, randomUUID()))).code, 'PT409');
  assert.equal((await failure(() => deriveFail(request.derivation_id, 'x', 'y'))).code, 'PT409');
  // A derivation cannot be requested before the source has an identity at all.
  const rawId = randomUUID();
  const unverified = await asService(() => scalar(`insert into tonde.media_files(id,workspace_id,bucket,object_key,
    original_filename,mime_type,file_category,bytes,upload_state,created_by)
    values($1,$2,'tonde-results',$3,'raw.mp4','video/mp4','video',10,'uploaded',$4) returning id`,
    [rawId, wa, `${wa}/${rawId}/raw.mp4`, A]));
  assert.equal((await failure(() => derive(unverified))).code, 'PT409');
  assert.equal((await failure(() => probeRecord(unverified, { duration_ms: 1 }))).code, 'PT409');
});

test('media status answers the honest state, and another workspace sees nothing', async () => {
  const source = await verifiedSource({ filename: 'status.mp4', checksum: 'sha256:status-source' });
  await scan(source.media_id, { scanner: 'clamav', state: 'clean', version: '1.3.0' });
  await probeRecord(source.media_id, { duration_ms: 1200, width: 1920, height: 1080, has_audio: false });
  await processing(source.media_id, 'processing');
  const derivation = await derive(source.media_id, { type: 'thumbnail', transform: 'poster:2s' });
  await deriveBuilding(derivation.derivation_id);
  await deriveComplete(derivation.derivation_id, await seedDerivedMedia(source.media_id, { category: 'thumbnail', extension: 'jpg', mime: 'image/jpeg', filename: 'poster.jpg' }));
  const status = await mediaStatus(source.media_id);
  assert.equal(status.upload_state, 'verified');
  assert.equal(status.processing_state, 'processing');
  assert.equal(status.scan_state, 'clean');
  assert.match(status.scan_claim, /clean/);
  assert.equal(status.verified_checksum, 'sha256:status-source');
  assert.equal(status.usable, true);
  assert.equal(status.technical_metadata.width, 1920);
  assert.equal(status.technical_metadata.duration_ms, 1200);
  assert.equal(status.scans.length, 2);
  assert.equal(status.derivations.length, 1);
  assert.equal(status.derivations[0].state, 'ready');
  assert.equal(status.derivations[0].type, 'thumbnail');
  assert.equal(status.upload_intent.state, 'verified');
  assert.equal(status.upload_intent.purpose, 'result');
  assert.ok(status.meaning.length > 0);
  // Another workspace cannot read it at all, and the guard precedes the lookup.
  assert.equal((await failure(() => mediaStatus(source.media_id, B))).code, '42501');
  assert.equal((await failure(() => intentStatus(source.intent_id, B))).code, '42501');
  assert.equal((await failure(() => mediaStatus(randomUUID(), B))).code, '42501');
  // A member of their own workspace asking about a foreign media file gets not-found, not a leak.
  assert.equal((await failure(() => mediaStatus(source.media_id, B, wb))).code, 'P0002');
  // Media metadata rows are tenant-isolated in both directions.
  const theirs = await asOther(() => rows('select count(*)::integer as total from tonde.media_derivations'));
  assert.equal(theirs[0].total, 0);
  const mine = await asEditor(() => rows('select count(*)::integer as total from tonde.media_derivations'));
  assert.ok(mine[0].total >= 1);
});

async function derivedMediaWithoutProvenance() {
  const id = randomUUID();
  await asService(() => db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,
    mime_type,file_category,bytes,upload_state,processing_state,created_by)
    values($1,$2,'tonde-production-media',$3,'loose.mp4','video/mp4','proxy',10,'uploaded','pending',$4)`,
    [id, wa, `${wa}/${id}/loose.mp4`, A]));
  return id;
}
