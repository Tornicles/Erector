import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Prompt 10 packet 033 — exports, on real embedded PostgreSQL over one 001->033 stack.
// These tests pin the laws the migration claims: the full document and the production package are two
// distinct products, every export pins the Production revision it names, the lifecycle only records
// what happened, a manifest cannot describe a different export or a file it is not allowed to ship,
// and an export artifact has no client read path at all. Nothing here builds a real file; the file
// builder is backend work and the durable worker is Prompt 11.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb;
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

const seedProduction = label => asEditor(async () => {
  const project = await scalar("insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id", [wa, `Probe ${label}`, A]);
  const production = await scalar("insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id", [wa, project, `Probe Production ${label}`, A]);
  const media = randomUUID();
  await db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes,upload_state,checksum)
    values($1,$2,'tonde-results',$3,'result.mp4','video/mp4','video',2048,'uploaded',$4)`,
    [media, wa, `${wa}/${media}/result.mp4`, `sha256:result-${label}`]);
  const result = await scalar('insert into tonde.results(workspace_id,production_id,media_id) values($1,$2,$3) returning id', [wa, production, media]);
  return { project, production, media, result };
});
const seedOtherWorkspace = label => asOther(async () => {
  const project = await scalar("insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id", [wb, `Other ${label}`, B]);
  const production = await scalar("insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id", [wb, project, `Other Production ${label}`, B]);
  const media = randomUUID();
  await db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes,upload_state,checksum)
    values($1,$2,'tonde-results',$3,'other.mp4','video/mp4','video',2048,'uploaded',$4)`,
    [media, wb, `${wb}/${media}/other.mp4`, `sha256:other-${label}`]);
  const result = await scalar('insert into tonde.results(workspace_id,production_id,media_id) values($1,$2,$3) returning id', [wb, production, media]);
  return { production, media, result };
});
const seedArtifact = label => asEditor(async () => {
  const media = randomUUID();
  await db.query(`insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes,upload_state,checksum)
    values($1,$2,'tonde-exports',$3,'export.zip','application/zip','export',4096,'uploaded',$4)`,
    [media, wa, `${wa}/${media}/export.zip`, `sha256:artifact-${label}`]);
  return media;
});

const requestExport = (fields, user = A) => asUser(user, () => rows(
  'select tonde.export_request($1,$2,$3,$4,$5) as result',
  [fields.workspace ?? wa, fields.production, fields.kind, fields.format, fields.packageType ?? 'complete'])
  .then(result => result[0].result));
const markBuilding = (id, lease = 'probe-worker-1') => asService(() => rows(
  'select tonde.export_mark_building($1,$2,$3) as result', [wa, id, lease]).then(result => result[0].result));
const completeExport = (id, artifact, manifest, over = {}) => asService(() => rows(
  'select tonde.export_complete($1,$2,$3,$4,$5,$6,$7) as result',
  [wa, id, artifact, JSON.stringify(manifest), over.fileCount ?? (manifest.files ? manifest.files.length : 1),
   over.totalBytes ?? 4096, over.checksum ?? 'sha256:package-1']).then(result => result[0].result));
const failExport = (id, code, message) => asService(() => rows(
  'select tonde.export_fail($1,$2,$3,$4) as result', [wa, id, code, message]).then(result => result[0].result));
const expireExport = id => asService(() => rows(
  'select tonde.export_expire($1,$2) as result', [wa, id]).then(result => result[0].result));
const download = (id, user = A) => asUser(user, () => rows(
  'select tonde.export_download($1,$2) as result', [wa, id]).then(result => result[0].result));
const manifestFor = (requested, over = {}) => ({
  schema_version: '1',
  export_id: requested.export_id,
  workspace_id: wa,
  production_id: requested.production_id,
  production_revision: requested.production_revision,
  generated_at: new Date().toISOString(),
  format: requested.format,
  files: over.files ?? [{ path: 'production/manifest.json', checksum: 'sha256:manifest-1', bytes: 128 }],
  references: over.references ?? [],
  results: over.results ?? [],
});
// A ready export built through the real lifecycle.
const buildReady = async (fixture, over = {}) => {
  const requested = await requestExport({
    production: over.production ?? fixture.production, kind: over.kind ?? 'production_package',
    format: over.format ?? 'zip', packageType: over.packageType ?? 'complete' });
  await markBuilding(requested.export_id);
  const artifact = await seedArtifact(over.label ?? 'one');
  const manifest = manifestFor(requested, over);
  await completeExport(requested.export_id, artifact, manifest, over);
  return { requested, artifact, manifest };
};

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
});

after(async () => { await db?.close(); });

test('two distinct export products, never one format wearing both names', async () => {
  const kinds = (await rows("select unnest(enum_range(null::tonde.export_kind))::text as value")).map(row => row.value);
  assert.deepEqual(kinds, ['full_document', 'production_package']);
  const states = (await rows("select unnest(enum_range(null::tonde.export_state))::text as value")).map(row => row.value);
  assert.deepEqual(states, ['requested', 'building', 'ready', 'failed', 'expired']);
  // The product vocabulary the UI must use names both products distinctly.
  const vocabulary = JSON.parse(await readFile('product/vocabulary.json', 'utf8'));
  assert.equal(vocabulary.exportActions.full_document, 'Download Full Document');
  assert.equal(vocabulary.exportActions.production_package, 'Export Production Package');

  const fixture = await seedProduction('products');
  const document = await requestExport({ production: fixture.production, kind: 'full_document', format: 'pdf' });
  assert.equal(document.kind, 'full_document');
  const packageExport = await requestExport({ production: fixture.production, kind: 'production_package', format: 'zip' });
  assert.equal(packageExport.kind, 'production_package');

  const zipDocument = await failure(() => requestExport({ production: fixture.production, kind: 'full_document', format: 'zip' }));
  assert.match(zipDocument.message, /A full document is PDF or DOCX/);
  const pdfPackage = await failure(() => requestExport({ production: fixture.production, kind: 'production_package', format: 'docx' }));
  assert.match(pdfPackage.message, /A production package is a ZIP/);
  const unknownKind = await failure(() => requestExport({ production: fixture.production, kind: 'everything', format: 'zip' }));
  assert.match(unknownKind.message, /full_document or a production_package/);
  const unknownType = await failure(() => requestExport({ production: fixture.production, kind: 'production_package', format: 'zip', packageType: 'screensaver' }));
  assert.match(unknownType.message, /not a supported export package type/);

  // The kind is generated from the format, so it can never drift from what was requested.
  assert.equal(await scalar("select is_generated from information_schema.columns where table_schema='tonde' and table_name='exports' and column_name='kind'"), 'ALWAYS');
  assert.equal(await scalar("select count(*) from tonde.exports where (kind = 'full_document' and requested_format not in ('pdf','docx')) or (kind = 'production_package' and requested_format not in ('zip','json'))"), 0);

  // A client session cannot create or edit an export row: requesting is an authenticated RPC.
  const clientInsert = await failure(() => asEditor(() => db.query(
    `insert into tonde.exports(workspace_id,production_id,job_id,requested_format,package_type,production_version_id,requested_by)
     values($1,$2,$3,'zip','complete',$4,$5)`,
    [wa, fixture.production, document.job_id, document.production_version_id, A])));
  assert.match(clientInsert.message, /permission denied/);
  const clientUpdate = await failure(() => asEditor(() => db.query(
    "update tonde.exports set state = 'ready' where id = $1", [document.export_id])));
  assert.match(clientUpdate.message, /permission denied/);
});

test('an export pins the Production version it names and never follows later edits', async () => {
  const fixture = await seedProduction('pinning');
  const requested = await requestExport({ production: fixture.production, kind: 'full_document', format: 'docx' });
  const pin = { revision: requested.production_revision, version: requested.production_version_id };
  assert.equal(pin.revision, 1);
  assert.equal(await scalar('select v.object_id = $2 and v.branch_name = \'main\' from tonde.object_versions v where v.id = $1', [pin.version, fixture.production]), true);

  // Editing the Production afterwards moves the Production on; the export still describes revision 1.
  await asEditor(() => db.query("update tonde.productions set title = 'Renamed after export' where id = $1", [fixture.production]));
  assert.equal(await scalar('select revision from tonde.productions where id = $1', [fixture.production]), 2);
  assert.equal(await scalar('select production_revision from tonde.exports where id = $1', [requested.export_id]), 1);
  assert.equal(await scalar('select production_version_id from tonde.exports where id = $1', [requested.export_id]), pin.version);

  // The requested work is recorded on the EXISTING jobs foundation, and stays durable work.
  const job = (await rows('select status, job_type, requested_by, production_id from tonde.jobs where id = $1', [requested.job_id]))[0];
  assert.deepEqual(job, { status: 'queued', job_type: 'export', requested_by: A, production_id: fixture.production });

  // Another workspace cannot export this Production, read this export, or learn its id.
  const crossTenant = await failure(() => requestExport({ production: fixture.production, kind: 'full_document', format: 'pdf' }, B));
  assert.match(crossTenant.message, /Production is not available for export|Workspace access denied/);
  assert.equal(Number(await asOther(() => scalar('select count(*) from tonde.exports where id = $1', [requested.export_id]))), 0);

  // An archived Production is not exportable.
  await asEditor(() => db.query("update tonde.productions set lifecycle = 'archived' where id = $1", [fixture.production]));
  const archived = await failure(() => requestExport({ production: fixture.production, kind: 'full_document', format: 'pdf' }));
  assert.match(archived.message, /not available for export/);
});

test('the export lifecycle records only what happened, with evidence', async () => {
  const fixture = await seedProduction('lifecycle');
  const requested = await requestExport({ production: fixture.production, kind: 'production_package', format: 'zip' });
  // A client cannot drive the lifecycle; only the trusted server records outcomes.
  const clientBuilding = await failure(() => asEditor(() => rows('select tonde.export_mark_building($1,$2,$3) as result', [wa, requested.export_id, 'probe-worker-1'])));
  assert.match(clientBuilding.message, /permission denied/);
  // A build is a claim: it must name the worker holding the job lease.
  const unclaimed = await failure(() => markBuilding(requested.export_id, '  '));
  assert.match(unclaimed.message, /must name the worker that holds the job lease/);
  // A request is not a build: it cannot jump to ready, and failing needs a cause.
  const prematureReady = await failure(() => asService(() => db.query(
    "update tonde.exports set state = 'ready', ready_at = now() where id = $1", [requested.export_id])));
  assert.match(prematureReady.message, /cannot become ready/);
  const noCause = await failure(() => asService(() => db.query(
    "update tonde.exports set state = 'failed', failed_at = now() where id = $1", [requested.export_id])));
  assert.match(noCause.message, /export_failed_records_cause|check constraint/i);

  const building = await markBuilding(requested.export_id);
  assert.equal(building.state, 'building');
  assert.equal(building.lease_owner, 'probe-worker-1');
  assert.equal(await scalar("select status = 'running' and lease_owner = 'probe-worker-1' and lease_expires_at > now() from tonde.jobs where id = $1", [requested.job_id]), true);
  // Nothing else may take over a build that is already underway.
  const doubleClaim = await failure(() => markBuilding(requested.export_id, 'probe-worker-2'));
  assert.match(doubleClaim.message, /starts building from REQUESTED/);

  // READY requires an uploaded artifact in the private exports bucket.
  const wrongBucket = await failure(() => completeExport(requested.export_id, fixture.media, manifestFor(requested)));
  assert.match(wrongBucket.message, /uploaded or verified export artifact/);
  const artifact = await seedArtifact('lifecycle');
  await completeExport(requested.export_id, artifact, manifestFor(requested), { fileCount: 3, totalBytes: 9000, checksum: 'sha256:package-lifecycle' });
  const ready = (await rows("select state, ready_at is not null as stamped, file_count, total_bytes, content_checksum, completed_at is not null as completed from tonde.exports where id = $1", [requested.export_id]))[0];
  assert.deepEqual(ready, { state: 'ready', stamped: true, file_count: 3, total_bytes: 9000, content_checksum: 'sha256:package-lifecycle', completed: true });
  assert.equal(await scalar("select status = 'succeeded' and lease_owner is null and lease_expires_at is null from tonde.jobs where id = $1", [requested.job_id]), true);
  // A finished export is not completed twice, and READY does not go backwards.
  const twice = await failure(() => completeExport(requested.export_id, artifact, manifestFor(requested)));
  assert.match(twice.message, /completes from BUILDING/);
  const backwards = await failure(() => markBuilding(requested.export_id));
  assert.match(backwards.message, /starts building from REQUESTED/);

  // Failure records its cause and stops the job.
  const second = await requestExport({ production: fixture.production, kind: 'production_package', format: 'zip' });
  await markBuilding(second.export_id);
  const failed = await failExport(second.export_id, 'builder_error', 'The document builder failed');
  assert.equal(failed.state, 'failed');
  assert.equal(await scalar("select state = 'failed' and failed_at is not null and failure_code = 'builder_error' from tonde.exports where id = $1", [second.export_id]), true);
  assert.equal(await scalar("select status = 'failed' and error_message = 'The document builder failed' from tonde.jobs where id = $1", [second.job_id]), true);
  const failReady = await failure(() => failExport(requested.export_id, 'late', 'too late'));
  assert.match(failReady.message, /cannot fail/);

  // Expiry is a system decision that also stops queued work.
  const third = await requestExport({ production: fixture.production, kind: 'full_document', format: 'pdf' });
  const expired = await expireExport(third.export_id);
  assert.equal(expired.state, 'expired');
  assert.equal(await scalar("select status = 'cancelled' from tonde.jobs where id = $1", [third.job_id]), true);
  const expireAgain = await failure(() => expireExport(third.export_id));
  assert.match(expireAgain.message, /cannot expire/);
});

test('a manifest cannot describe another export, another version, or media it may not ship', async () => {
  const fixture = await seedProduction('manifest');
  const other = await seedProduction('manifest-other');
  const built = await buildReady(fixture, { label: 'manifest' });
  const id = built.requested.export_id;

  const invalid = async over => {
    const manifest = manifestFor(built.requested, over);
    return failure(() => asService(() => db.query(
      "update tonde.exports set manifest = $2 where id = $1", [id, JSON.stringify(manifest)])));
  };
  const applyManifest = over => asService(() => db.query(
    "update tonde.exports set manifest = $2 where id = $1", [id, JSON.stringify(manifestFor(built.requested, over))]));
  // The package's own deterministic layout is accepted.
  await applyManifest({ files: [{ path: 'production/manifest.json', checksum: 'sha256:manifest-1' }] });

  const mismatched = await failure(() => asService(() => db.query(
    "update tonde.exports set manifest = jsonb_set(manifest, '{export_id}', to_jsonb($2::text)) where id = $1",
    [id, randomUUID()])));
  assert.match(mismatched.message, /must describe exactly the version and format/);
  const movedRevision = await failure(() => asService(() => db.query(
    "update tonde.exports set manifest = jsonb_set(manifest, '{production_revision}', '99'::jsonb) where id = $1", [id])));
  assert.match(movedRevision.message, /must describe exactly the version and format/);
  const absolute = await invalid({ files: [{ path: '/etc/passwd', checksum: 'sha256:absolute-1' }] });
  assert.match(absolute.message, /deterministic relative path/);
  const traversal = await invalid({ files: [{ path: 'documents/../../secret.txt', checksum: 'sha256:traversal-1' }] });
  assert.match(traversal.message, /deterministic relative path/);
  const fakedChecksum = await invalid({ files: [{ path: 'documents/short.txt', checksum: 'abc' }] });
  assert.match(fakedChecksum.message, /checksum is recorded or omitted, never invented/);

  // A file cannot reference media of another workspace.
  const foreign = await seedOtherWorkspace('manifest-foreign');
  const crossTenantFile = await invalid({ files: [{ path: 'results/foreign.mp4', media_id: foreign.media }] });
  assert.match(crossTenantFile.message, /only reference media of this workspace/);

  // A Reference TONDE does not own is exported as metadata, not as copied media; metadata-only and
  // rights-held copies are both legitimate package contents.
  const copiedReference = await invalid({ references: [{ reference_id: randomUUID(), rights_classification: 'public_reference', copied_media_id: fixture.media }] });
  assert.match(copiedReference.message, /exported as metadata, never as copied media/);
  await applyManifest({ references: [{ reference_id: randomUUID(), rights_classification: 'public_reference', source_url: 'https://example.invalid/reference' }] });
  await applyManifest({ references: [{ reference_id: randomUUID(), rights_classification: 'user_owned', copied_media_id: fixture.media }] });
  assert.equal(await scalar("select jsonb_array_length(manifest->'references') from tonde.exports where id = $1", [id]), 1);

  // Results in a package belong to this Production, and only an accepted Result ships its media.
  const wrongProduction = await invalid({ results: [{ result_id: other.result, media_id: other.media }] });
  assert.match(wrongProduction.message, /can only name Results of this Production/);
  const unaccepted = await invalid({ results: [{ result_id: fixture.result, media_id: fixture.media }] });
  assert.match(unaccepted.message, /Only an accepted Result ships its media/);
  await asEditor(() => db.query("update tonde.results set approval = 'approved', state = 'final' where id = $1", [fixture.result]));
  await asService(() => db.query(
    "update tonde.exports set manifest = $2 where id = $1",
    [id, JSON.stringify(manifestFor(built.requested, { results: [{ result_id: fixture.result, media_id: fixture.media }] }))]));
  assert.equal(await scalar("select jsonb_array_length(manifest->'results') from tonde.exports where id = $1", [id]), 1);
});

test('downloads are authorized per request and export artifacts have no client read path', async () => {
  const fixture = await seedProduction('download');
  const requested = await requestExport({ production: fixture.production, kind: 'full_document', format: 'pdf' });
  // Nothing to download before the file exists.
  const early = await failure(() => download(requested.export_id));
  assert.match(early.message, /is requested and has no file to download/);
  await markBuilding(requested.export_id);
  const artifact = await seedArtifact('download');
  await completeExport(requested.export_id, artifact, manifestFor(requested), { checksum: 'sha256:document-download' });

  const authorized = await download(requested.export_id);
  assert.equal(authorized.authorized, true);
  assert.equal(authorized.kind, 'full_document');
  assert.equal(authorized.format, 'pdf');
  assert.equal(authorized.bucket, 'tonde-exports');
  assert.equal(authorized.object_key, `${wa}/${artifact}/export.zip`);
  assert.equal(authorized.content_checksum, 'sha256:document-download');
  const window = (await rows("select now() + interval '5 minutes' as expected"))[0];
  assert.ok(Math.abs(new Date(authorized.download_expires_at) - new Date(window.expected)) < 5000);
  assert.equal(await scalar('select count(*) from tonde.exports where id = $1 and manifest ? \'files\'', [requested.export_id]), 1);

  // Another workspace cannot authorize a download for this export.
  const crossTenant = await failure(() => download(requested.export_id, B));
  assert.match(crossTenant.message, /Workspace access denied|does not exist in this workspace/);
  // The export artifact is not reachable through the member storage read path at all.
  assert.equal(await asEditor(() => scalar('select tonde_private.can_read_storage_object($1,$2)', ['tonde-exports', `${wa}/${artifact}/export.zip`])), false);
  // A member can still read non-export media of their workspace.
  assert.equal(await asEditor(() => scalar('select tonde_private.can_read_storage_object($1,$2)', ['tonde-results', `${wa}/${fixture.media}/result.mp4`])), true);

  // An expired export stops authorizing downloads.
  await expireExport(requested.export_id);
  const afterExpiry = await failure(() => download(requested.export_id));
  assert.match(afterExpiry.message, /expired and has no file/);
});

test('consequential export actions are audited without secrets', async () => {
  const events = (await rows('select event_type from tonde.audit_events order by created_at')).map(row => row.event_type);
  for (const expected of ['export.requested', 'export.generated', 'export.failed', 'export.expired']) {
    assert.ok(events.includes(expected), `expected audit event ${expected}`);
  }
  const generated = (await rows("select metadata from tonde.audit_events where event_type = 'export.generated' limit 1"))[0];
  assert.ok(generated.metadata.kind === 'full_document' || generated.metadata.kind === 'production_package');
  assert.ok(typeof generated.metadata.format === 'string');
  assert.equal(Number(await scalar("select count(*) from tonde.audit_events where metadata::text ~* '(token|secret|password|bearer|refresh)'")), 0);
  // A viewer-level member may download but may not request exports.
  await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [wa, B]);
  const fixture = await seedProduction('viewer');
  const viewerRequest = await failure(() => requestExport({ production: fixture.production, kind: 'full_document', format: 'pdf' }, B));
  assert.match(viewerRequest.message, /Workspace access denied/);
});
