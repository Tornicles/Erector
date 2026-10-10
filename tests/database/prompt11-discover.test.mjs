import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 11 packet 041 — the Discover content engine and "Create This", on real embedded PostgreSQL
// over one 001->041 stack. These tests pin the laws the migration claims: a discover item states where
// it came from and that provenance can never be re-attributed; knowledge becomes discoverable only
// while it is usable, and usability is re-read from the live source so later rejection or retirement
// makes an item unusable instead of leaving stale advice on the shelf; saving is a private act that
// changes no production; DIRECT THIS / USE THIS TECHNIQUE is a preview that creates nothing followed by
// a creator-authorized apply that types the canonical id back and records exactly the object it
// created; an action the item cannot support is refused with a named reason instead of a fabricated
// object; an applied application is a closed record; TONDE-curated content is global and read by every
// workspace while a client can never mint it; and all of it stays tenant-isolated.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';
const E = '00000000-0000-4000-8000-000000000005';
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
const asOwner = action => asUser(A, action);
const asEditor = action => asUser(C, action);
const asViewer = action => asUser(E, action);
const asStranger = action => asUser(B, action);

let slug = 0;
const nextSlug = prefix => `${prefix}-${++slug}-${Math.floor(Math.random() * 1e6)}`;

const createKnowledge = (over = {}) => asOwner(() => rows(
  'select tonde.knowledge_item_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as result',
  [wa, over.canonicalId ?? nextSlug('probe-technique'), over.name ?? 'Probe technique', over.category ?? 'camera',
   over.description ?? 'A probe description', over.purpose ?? 'A probe purpose', over.effect ?? 'A probe effect',
   over.knowledgeClass ?? 'technique', over.sourceKind ?? 'creator', over.guidance ?? 'Do the thing.',
   JSON.stringify(over.applicability ?? {}), JSON.stringify({ source_says: 'x', tonde_says: 'y' }),
   JSON.stringify([]), over.pendingReview ?? false]).then(result => result[0].result));
const reviewKnowledge = (item, decision, note = 'Checked against the manual', user = D) => asUser(user, () => rows(
  'select tonde.knowledge_item_review($1,$2,$3,$4) as result', [wa, item, decision, note])
  .then(result => result[0].result));

const registerItem = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.discover_register_item($1,$2,$3) as result',
  [over.workspace ?? wa, JSON.stringify(over.item ?? over), over.visibility ?? 'workspace'])
  .then(result => result[0].result));
const registerAsService = item => asService(() => rows(
  'select tonde.discover_register_item($1,$2,$3) as result', [null, JSON.stringify(item), 'global'])
  .then(result => result[0].result));
const index = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.discover_index($1,$2,$3,$4) as result',
  [over.workspace ?? wa, over.kind ?? null, over.query ?? null, over.limit ?? 50])
  .then(result => result[0].result));
const itemStatus = (item, user = A) => asUser(user, () => rows(
  'select tonde.discover_item_status($1,$2) as result', [wa, item]).then(result => result[0].result));
const saveItem = (item, note = '', user = A) => asUser(user, () => rows(
  'select tonde.discover_save($1,$2,$3) as result', [wa, item, note]).then(result => result[0].result));
const unsaveItem = (item, user = A) => asUser(user, () => rows(
  'select tonde.discover_unsave($1,$2) as result', [wa, item]).then(result => result[0].result));
const collectionCreate = (name, description = '') => asUser(A, () => rows(
  'select tonde.discover_collection_create($1,$2,$3) as result', [wa, name, description])
  .then(result => result[0].result));
const collectionAdd = (collection, item, note = '') => asUser(A, () => rows(
  'select tonde.discover_collection_add($1,$2,$3,$4) as result', [wa, collection, item, note])
  .then(result => result[0].result));
const collectionRemove = (collection, item) => asUser(A, () => rows(
  'select tonde.discover_collection_remove($1,$2,$3) as result', [wa, collection, item])
  .then(result => result[0].result));
const preview = (item, kind, production, over = {}) => asUser(over.user ?? A, () => rows(
  'select tonde.discover_preview($1,$2,$3,$4,$5,$6,$7) as result',
  [over.workspace ?? wa, item, kind, production, over.scene ?? null, over.shot ?? null, over.note ?? ''])
  .then(result => result[0].result));
const applyApplication = (application, confirmation, note = '', user = A) => asUser(user, () => rows(
  'select tonde.discover_apply($1,$2,$3,$4) as result', [wa, application, confirmation, note])
  .then(result => result[0].result));
const withdrawApplication = (application, note = '', user = A) => asUser(user, () => rows(
  'select tonde.discover_withdraw($1,$2,$3) as result', [wa, application, note])
  .then(result => result[0].result));
const applicationStatus = (application, user = A) => asUser(user, () => rows(
  'select tonde.discover_application_status($1,$2) as result', [wa, application])
  .then(result => result[0].result));

const newProduction = (label = 'probe', workspace = wa, owner = A) => asUser(owner, async () => {
  const project = await scalar('insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id', [workspace, `Discover ${label}`, owner]);
  const production = await scalar('insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id', [workspace, project, `Discover Production ${label}`, owner]);
  return { project, production };
});
const newTutorial = (state, label = 'probe') => asService(async () => {
  const published = state === 'published';
  return scalar(`insert into tonde.knowledge_tutorials(workspace_id,title,source_kind,locator,attribution,
    state,step_count,published_at,published_by,created_by) values($1,$2,'external_article','https://example.invalid/tutorial',
    'Somebody',$3,$4,$5,$6,$7) returning id`,
    [wa, `Probe tutorial ${label} ${++slug}`, state, published ? 3 : 0,
     published ? new Date().toISOString() : null, published ? D : null, A]);
});
const countWhere = async (table, column, value) => Number(await scalar(
  `select count(*)::int from tonde.${table} where ${column} = $1`, [value]));

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
  for (const id of [A, B, C, D, E]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asOwner(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asStranger(() => scalar('select tonde.bootstrap_workspace()'));
  await asUser(C, () => scalar('select tonde.bootstrap_workspace()'));
  await asUser(D, () => scalar('select tonde.bootstrap_workspace()'));
  await asUser(E, () => scalar('select tonde.bootstrap_workspace()'));
  // One workspace with an owner, an editor, an admin and a viewer, so the tests can tell reading
  // discover content apart from editing it and applying it.
  await asService(async () => {
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')", [wa, C]);
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'admin')", [wa, D]);
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [wa, E]);
  });
});

after(async () => { await db?.close(); });

test('the discover vocabulary, provenance law and client boundary are closed', async () => {
  for (const table of ['discover_items', 'discover_saves', 'discover_collections', 'discover_collection_items',
    'discover_applications']) {
    assert.equal(Number(await scalar(`select count(*) from pg_tables where schemaname='tonde' and tablename=$1`, [table])), 1);
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid = ('tonde.' || $1)::regclass`, [table]), true);
    assert.equal(await scalar(`select has_table_privilege('authenticated', 'tonde.' || $1, 'SELECT')`, [table]), true);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await scalar(`select has_table_privilege('authenticated', 'tonde.' || $1, $2)`, [table, privilege]),
        false, `authenticated must not hold ${privilege} on tonde.${table}`);
    }
  }
  const kinds = await rows(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'tonde.discover_items'::regclass and contype = 'c'`);
  const kindDef = kinds.map(row => row.def).filter(def => def.includes('movie_reference'));
  assert.equal(kindDef.length, 1);
  assert.deepEqual([...kindDef[0].matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort(),
    ['inspiration', 'knowledge', 'movie_reference', 'reference_example', 'technique', 'template', 'tutorial']);
  assert.equal(kinds.filter(def => def.def.includes("? 'source_label'")).length, 1,
    'provenance must always name its source');
  const actions = await rows(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'tonde.discover_applications'::regclass and contype = 'c'`);
  assert.equal(actions.filter(row => row.def.includes('use_technique')).length, 1);
  assert.deepEqual([...actions.map(row => row.def).find(def => def.includes('use_technique'))
    .matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort(), ['attach_reference', 'direct_this', 'use_technique']);
  // The private helpers and guards are not callable by a client; the public actions are.
  for (const name of ['guard_discover_item', 'guard_discover_application', 'discover_support',
    'discover_source_state', 'discover_item_for']) {
    assert.equal(await scalar(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p
      where p.pronamespace = 'tonde_private'::regnamespace and p.proname = $1`, [name]), false);
  }
  for (const name of ['discover_index', 'discover_save', 'discover_preview', 'discover_apply']) {
    assert.equal(await scalar(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p
      where p.pronamespace = 'tonde'::regnamespace and p.proname = $1`, [name]), true);
  }
  const classes = await rows(`select data_class, purge_action, purge_exempt from tonde.retention_classes
    where data_class in ('discover_content','discover_application') order by data_class`);
  assert.deepEqual(classes, [
    { data_class: 'discover_application', purge_action: 'retain', purge_exempt: false },
    { data_class: 'discover_content', purge_action: 'retain', purge_exempt: false },
  ], 'discover data is durable in a routine sweep and removed by an authorized deletion');
});

test('an item states where it came from and its provenance never changes', async () => {
  const technique = await createKnowledge({ name: 'Silhouette reveal', category: 'lighting' });
  const item = await registerItem({ canonical_id: nextSlug('silhouette'), item_kind: 'technique',
    source_kind: 'knowledge', title: 'Silhouette reveal', summary: 'Block the key light behind the subject',
    directions: 'Put the key light behind the subject and expose for the background.',
    provenance: { source_label: 'Workshop notes', attribution: 'A person', license: 'CC BY' },
    source_technique_id: technique.item_id });
  assert.equal(item.usable, true);
  assert.equal(item.source_state, 'usable');
  assert.equal(item.replaced_existing, false);
  // Re-registering the same canonical id updates the content and leaves the provenance alone.
  const again = await registerItem({ canonical_id: item.canonical_id, item_kind: 'technique',
    source_kind: 'knowledge', title: 'Silhouette reveal (revised)', summary: 'Block the key light behind',
    directions: 'Behind the subject.', provenance: { source_label: 'Workshop notes' },
    source_technique_id: technique.item_id });
  assert.equal(again.item_id, item.item_id);
  assert.equal(again.idempotent, true);
  const stored = (await rows('select title, provenance from tonde.discover_items where id = $1', [item.item_id]))[0];
  assert.equal(stored.title, 'Silhouette reveal (revised)');
  assert.equal(stored.provenance.source_label, 'Workshop notes');
  assert.equal(stored.provenance.attribution, 'A person', 'the original provenance is kept, not rewritten');
  const rewritten = await failure(() => asService(() => db.query(
    `update tonde.discover_items set provenance = '{"source_label":"Somebody else"}'::jsonb where id = $1`,
    [item.item_id])));
  assert.equal(rewritten.code, '23514');
  assert.match(rewritten.message, /never changes/);
  const renamed = await failure(() => asService(() => db.query(
    "update tonde.discover_items set canonical_id = 'something-else' where id = $1", [item.item_id])));
  assert.equal(renamed.code, '23514');
  // Provenance is required, and the vocabulary is closed.
  const unnamed = await failure(() => registerItem({ canonical_id: nextSlug('unnamed'), item_kind: 'inspiration',
    source_kind: 'creator', title: 'Unnamed', summary: 'No source stated', provenance: {} }));
  assert.match(unnamed.message, /Provenance must name/);
  const badKind = await failure(() => registerItem({ canonical_id: nextSlug('bad-kind'), item_kind: 'stock_photo',
    source_kind: 'creator', title: 'A stock photo', summary: 'Not what Discover is for',
    provenance: { source_label: 'x' } }));
  assert.match(badKind.message, /not a TONDE discover item kind/);
  const badSource = await failure(() => registerItem({ canonical_id: nextSlug('bad-source'), item_kind: 'inspiration',
    source_kind: 'rumour', title: 'A rumour', summary: 'No source kind', provenance: { source_label: 'x' } }));
  assert.match(badSource.message, /names where it came from/);
  const badSlug = await failure(() => registerItem({ canonical_id: 'Not A Slug', item_kind: 'inspiration',
    source_kind: 'creator', title: 'A title', summary: 'A summary', provenance: { source_label: 'x' } }));
  assert.match(badSlug.message, /slug canonical id/);
});

test('knowledge becomes discoverable exactly while it is usable, and usability is read live', async () => {
  // Pending review is not usable, so it cannot become discoverable at all.
  const pending = await createKnowledge({ name: 'Unreviewed claim', pendingReview: true, sourceKind: 'creator' });
  assert.equal(pending.review_state, 'pending_review');
  const refused = await failure(() => registerItem({ canonical_id: nextSlug('pending-claim'), item_kind: 'knowledge',
    source_kind: 'knowledge', title: 'Unreviewed claim', summary: 'A claim nobody checked yet',
    provenance: { source_label: 'Creator' }, source_technique_id: pending.item_id }));
  assert.equal(refused.code, 'PT409');
  assert.match(refused.message, /KNOWLEDGE_NOT_USABLE/);
  // The same item becomes discoverable the moment a reviewer makes the knowledge usable.
  await reviewKnowledge(pending.item_id, 'reviewed', 'Checked against the manual');
  const item = await registerItem({ canonical_id: nextSlug('reviewed-claim'), item_kind: 'knowledge',
    source_kind: 'knowledge', title: 'Reviewed claim', summary: 'A claim a second person checked',
    directions: 'Handle the connector exactly as the manual says.',
    provenance: { source_label: 'Workshop manual' }, source_technique_id: pending.item_id });
  assert.equal(item.source_state, 'usable');
  assert.equal(item.usable, true);
  // The item carries the source's own substance, with the revision it was read at.
  assert.equal(item.support.use_technique.available, true);
  const status = await itemStatus(item.item_id);
  assert.equal(status.applicability.review_state, 'reviewed');
  assert.equal(status.applicability.source_revision > 0, true);
  assert.equal(status.applicability.category, 'camera');
  // Retiring the knowledge makes the item unusable on the next read, and it cannot be applied.
  await asService(() => db.query('update tonde.creative_techniques set retired_at = now() where id = $1',
    [pending.item_id]));
  const after = await itemStatus(item.item_id);
  assert.equal(after.source_state, 'retired');
  assert.equal(after.usable, false);
  assert.equal(after.support.use_technique.available, false);
  assert.equal(after.support.use_technique.reason, 'SOURCE_NOT_USABLE');
  const listed = await index({ query: 'Reviewed claim' });
  const entry = listed.items.find(row => row.item_id === item.item_id);
  assert.equal(entry.source_state, 'retired');
  assert.equal(entry.usable, false);
  const retiredTarget = await newProduction('retired');
  const blocked = await failure(() => preview(item.item_id, 'use_technique', retiredTarget.production));
  assert.equal(blocked.code, 'PT409');
  assert.match(blocked.message, /SOURCE_NOT_USABLE/);
});

test('a tutorial item waits for publication and a reference item refuses an inaccessible source', async () => {
  const registered = await newTutorial('registered');
  const refused = await failure(() => registerItem({ canonical_id: nextSlug('tutorial'), item_kind: 'tutorial',
    source_kind: 'tutorial', title: 'A tutorial', summary: 'Not published yet',
    provenance: { source_label: 'Somebody' }, source_tutorial_id: registered }));
  assert.equal(refused.code, 'PT409');
  assert.match(refused.message, /TUTORIAL_NOT_PUBLISHED/);
  const published = await newTutorial('published');
  const item = await registerItem({ canonical_id: nextSlug('tutorial'), item_kind: 'tutorial',
    source_kind: 'tutorial', title: 'A published tutorial', summary: 'Published and usable',
    directions: 'Follow the steps in order.', provenance: { source_label: 'Somebody', locator: 'https://example.invalid/t' },
    source_tutorial_id: published });
  assert.equal(item.usable, true);
  const status = await itemStatus(item.item_id);
  assert.equal(status.applicability.step_count > 0, true);
  // A reference recorded as inaccessible cannot become discoverable.
  const production = await newProduction('reference');
  const reference = await asOwner(() => scalar(`insert into tonde.production_references(workspace_id,production_id,
    source_type,state,source_url) values($1,$2,'url','inaccessible','https://example.invalid/gone') returning id`,
    [wa, production.production]));
  const inaccessible = await failure(() => registerItem({ canonical_id: nextSlug('reference'), item_kind: 'reference_example',
    source_kind: 'production_reference', title: 'A lost reference', summary: 'Recorded as inaccessible',
    provenance: { source_label: 'Wherever' }, source_reference_id: reference }));
  assert.equal(inaccessible.code, 'PT409');
  assert.match(inaccessible.message, /REFERENCE_INACCESSIBLE/);
  const missing = await failure(() => registerItem({ canonical_id: nextSlug('missing'), item_kind: 'knowledge',
    source_kind: 'knowledge', title: 'A missing item', summary: 'No such knowledge',
    provenance: { source_label: 'Nowhere' },
    source_technique_id: '00000000-0000-4000-8000-999999999999' }));
  assert.equal(missing.code, 'P0002');
});

test('saving is a private act that changes no production work', async () => {
  const technique = await createKnowledge({ name: 'Overhead food shot', category: 'camera' });
  const item = await registerItem({ canonical_id: nextSlug('overhead'), item_kind: 'technique',
    source_kind: 'knowledge', title: 'Overhead food shot', summary: 'Shoot straight down on the plate',
    directions: 'Boom the camera directly over the plate.', provenance: { source_label: 'Kitchen notes' },
    source_technique_id: technique.item_id });
  const techniquesBefore = await countWhere('creative_techniques', 'workspace_id', wa);
  const referencesBefore = Number(await scalar('select count(*)::int from tonde.production_references where workspace_id = $1', [wa]));
  const saved = await saveItem(item.item_id, 'For the menu shoot');
  assert.equal(saved.idempotent, false);
  const again = await saveItem(item.item_id, 'For the menu shoot');
  assert.equal(again.idempotent, true);
  assert.equal(again.save_id, saved.save_id);
  const noted = await saveItem(item.item_id, 'Re-read the lighting paragraph');
  assert.equal(noted.idempotent, true);
  assert.equal((await rows('select note from tonde.discover_saves where id = $1', [saved.save_id]))[0].note,
    'Re-read the lighting paragraph');
  // A save is the saver's only: the editor's own save is a different row, and the status says which is yours.
  await saveItem(item.item_id, 'Also useful for the product day', C);
  assert.equal(Number(await scalar('select count(*)::int from tonde.discover_saves where item_id = $1', [item.item_id])), 2);
  const ownerStatus = await itemStatus(item.item_id);
  assert.equal(ownerStatus.saved_by_you, true);
  assert.equal(ownerStatus.saves.length, 2);
  const editorStatus = await asEditor(() => rows('select tonde.discover_item_status($1,$2) as result', [wa, item.item_id])
    .then(result => result[0].result));
  assert.equal(editorStatus.saved_by_you, true);
  const listed = await index({ query: 'Overhead food' });
  assert.equal(listed.items.find(row => row.item_id === item.item_id).saved, true);
  assert.equal(listed.items.find(row => row.item_id === item.item_id).applied, false);
  // Saving created nothing.
  assert.equal(await countWhere('creative_techniques', 'workspace_id', wa), techniquesBefore);
  assert.equal(Number(await scalar('select count(*)::int from tonde.production_references where workspace_id = $1', [wa])), referencesBefore);
  assert.equal(Number(await scalar('select count(*)::int from tonde.discover_applications where workspace_id = $1', [wa])), 0);
  const missing = await failure(() => asViewer(() => rows('select tonde.discover_unsave($1,$2) as result', [wa, item.item_id])));
  assert.equal(missing.code, 'PT409');
  assert.match(missing.message, /SAVE_NOT_FOUND/);
  const removed = await unsaveItem(item.item_id);
  assert.equal(removed.removed, 1);
  assert.equal(Number(await scalar('select count(*)::int from tonde.discover_saves where item_id = $1', [item.item_id])), 1);
});

test('collections group saved inspiration without duplicating it', async () => {
  const technique = await createKnowledge({ name: 'Whip transition', category: 'transition' });
  const item = await registerItem({ canonical_id: nextSlug('whip'), item_kind: 'technique', source_kind: 'knowledge',
    title: 'Whip transition', summary: 'Whip the camera to cut on motion', directions: 'Whip right and cut on the blur.',
    provenance: { source_label: 'Edit notes' }, source_technique_id: technique.item_id });
  const collection = await collectionCreate('Opening titles', 'Ideas for the opening');
  const sameName = await collectionCreate('Opening titles', 'A different description');
  assert.equal(sameName.idempotent, true);
  assert.equal(sameName.collection_id, collection.collection_id);
  const added = await collectionAdd(collection.collection_id, item.item_id, 'Cut on motion');
  assert.equal(added.idempotent, false);
  const duplicate = await collectionAdd(collection.collection_id, item.item_id);
  assert.equal(duplicate.idempotent, true);
  assert.equal(Number(await scalar('select count(*)::int from tonde.discover_collection_items where collection_id = $1',
    [collection.collection_id])), 1);
  const status = await itemStatus(item.item_id);
  assert.equal(status.collections.length, 1);
  assert.equal(status.collections[0].name, 'Opening titles');
  const removed = await collectionRemove(collection.collection_id, item.item_id);
  assert.equal(removed.removed, 1);
  const gone = await failure(() => collectionRemove(collection.collection_id, item.item_id));
  assert.equal(gone.code, 'PT409');
  const noCollection = await failure(() => collectionAdd('00000000-0000-4000-8000-999999999999', item.item_id));
  assert.match(noCollection.message, /collection does not exist/);
  const unnamed = await failure(() => collectionCreate('   '));
  assert.match(unnamed.message, /needs a name/);
});

test('a preview writes down exactly what applying would create and creates nothing', async () => {
  const technique = await createKnowledge({ name: 'Motion match', category: 'edit' });
  const item = await registerItem({ canonical_id: nextSlug('motion-match'), item_kind: 'technique',
    source_kind: 'knowledge', title: 'Motion match', summary: 'Match the cut to the move',
    directions: 'Cut on the same speed and direction.', provenance: { source_label: 'Edit notes' },
    source_technique_id: technique.item_id });
  const { production } = await newProduction('preview');
  const techniquesBefore = await countWhere('creative_techniques', 'workspace_id', wa);
  const previewed = await preview(item.item_id, 'use_technique', production, { note: 'For the opening' });
  assert.equal(previewed.state, 'previewed');
  assert.equal(previewed.impact.creates_nothing, true);
  assert.equal(previewed.impact.confirmation, item.canonical_id);
  assert.equal(previewed.impact.changes.length, 1);
  assert.equal(previewed.impact.changes[0].object, 'creative_technique');
  assert.equal(previewed.impact.changes[0].canonical_id, item.canonical_id);
  assert.equal(previewed.impact.production_id, production);
  // Nothing was created, and the application is recorded as a preview only.
  assert.equal(await countWhere('creative_techniques', 'workspace_id', wa), techniquesBefore);
  const stored = (await rows('select state, applied_object_kind, applied_at, previewed_by from tonde.discover_applications where id = $1',
    [previewed.application_id]))[0];
  assert.equal(stored.state, 'previewed');
  assert.equal(stored.applied_object_kind, null);
  assert.equal(stored.applied_at, null);
  assert.equal(stored.previewed_by, A);
  // The same preview is the same draft; a different target is a different draft.
  const same = await preview(item.item_id, 'use_technique', production, { note: 'For the opening' });
  assert.equal(same.idempotent, true);
  assert.equal(same.application_id, previewed.application_id);
  const other = await newProduction('preview-other');
  const different = await preview(item.item_id, 'use_technique', other.production);
  assert.equal(different.idempotent, false);
  assert.notEqual(different.application_id, previewed.application_id);
  // A viewer may read but not prepare work.
  const viewerPreview = await failure(() => preview(item.item_id, 'use_technique', production, { user: E }));
  assert.equal(viewerPreview.code, '42501');
  // An unknown action, an unknown Production and a bad page are all named refusals.
  const badAction = await failure(() => preview(item.item_id, 'remix', production));
  assert.match(badAction.message, /not a TONDE discover action/);
  const badTarget = await failure(() => preview(item.item_id, 'use_technique', '00000000-0000-4000-8000-999999999999'));
  assert.match(badTarget.message, /Production does not exist/);
  const badPage = await failure(() => index({ limit: 0 }));
  assert.match(badPage.message, /between 1 and 200/);
});

test('an action the item cannot support is refused with the named reason', async () => {
  const { production } = await newProduction('unsupported');
  const noLocator = await registerItem({ canonical_id: nextSlug('no-locator'), item_kind: 'inspiration',
    source_kind: 'creator', title: 'An idea with no address', summary: 'Only a description',
    directions: 'Shoot it handheld.', provenance: { source_label: 'My notebook' } });
  const noDirections = await registerItem({ canonical_id: nextSlug('no-directions'), item_kind: 'reference_example',
    source_kind: 'creator', title: 'A reference with no directions', summary: 'Only a locator',
    provenance: { source_label: 'Somewhere', locator: 'https://example.invalid/ref' } });
  const attachable = await registerItem({ canonical_id: nextSlug('locator'), item_kind: 'reference_example',
    source_kind: 'creator', title: 'A reference with an address', summary: 'A locator and nothing else',
    provenance: { source_label: 'Somewhere', locator: 'https://example.invalid/good' } });
  const attachRefused = await failure(() => preview(noLocator.item_id, 'attach_reference', production));
  assert.equal(attachRefused.code, 'PT409');
  assert.match(attachRefused.message, /ITEM_HAS_NO_LOCATOR/);
  const directRefused = await failure(() => preview(noDirections.item_id, 'direct_this', production));
  assert.match(directRefused.message, /ITEM_HAS_NO_DIRECTIONS/);
  const techniqueRefused = await failure(() => preview(noLocator.item_id, 'use_technique', production));
  assert.match(techniqueRefused.message, /ITEM_HAS_NO_TECHNIQUE/);
  // The same item does support what it actually carries.
  const attachablePreview = await preview(attachable.item_id, 'attach_reference', production);
  assert.equal(attachablePreview.impact.changes[0].object, 'production_reference');
  const status = await itemStatus(noLocator.item_id);
  assert.equal(status.support.attach_reference.available, false);
  assert.equal(status.support.attach_reference.reason, 'ITEM_HAS_NO_LOCATOR');
  assert.equal(status.support.direct_this.available, true);
});

test('applying spends creator authority, needs the confirmation and records what it created', async () => {
  const technique = await createKnowledge({ name: 'Handheld tension', category: 'blocking' });
  const item = await registerItem({ canonical_id: nextSlug('handheld'), item_kind: 'technique',
    source_kind: 'knowledge', title: 'Handheld tension', summary: 'Move with the actor, never around them',
    directions: 'Stay on the actor and let the frame breathe.',
    provenance: { source_label: 'Workshop notes' }, source_technique_id: technique.item_id });
  const { production } = await newProduction('apply');
  const previewed = await preview(item.item_id, 'use_technique', production);
  const wrong = await failure(() => applyApplication(previewed.application_id, 'yes'));
  assert.equal(wrong.code, 'PT409');
  assert.match(wrong.message, /APPLICATION_CONFIRMATION_REQUIRED/);
  const byViewer = await failure(() => applyApplication(previewed.application_id, item.canonical_id, '', E));
  assert.equal(byViewer.code, '42501');
  const byStranger = await failure(() => applyApplication(previewed.application_id, item.canonical_id, '', B));
  assert.equal(byStranger.code, '42501');
  const noSuch = await failure(() => applyApplication('00000000-0000-4000-8000-999999999999', item.canonical_id));
  assert.match(noSuch.message, /application does not exist/);
  const applied = await applyApplication(previewed.application_id, item.canonical_id, 'Use it for the corridor');
  assert.equal(applied.state, 'applied');
  assert.equal(applied.applied_object_kind, 'creative_technique');
  assert.equal(applied.production_id, production);
  // The technique is real, workspace-owned, carries the item's substance and states its origin.
  const made = (await rows(`select canonical_id, name, category, technique_source, knowledge_class, source_kind,
    revision, created_by from tonde.creative_techniques where id = $1`, [applied.applied_object_id]))[0];
  assert.equal(made.canonical_id, item.canonical_id);
  assert.equal(made.name, 'Handheld tension');
  assert.equal(made.category, 'blocking');
  assert.equal(made.technique_source, 'reference');
  assert.equal(made.knowledge_class, 'technique');
  assert.equal(made.created_by, A);
  assert.equal(Number(made.revision), 1);
  // Applying again is the same application, not a second object.
  const again = await applyApplication(previewed.application_id, item.canonical_id);
  assert.equal(again.idempotent, true);
  assert.equal(again.applied_object_id, applied.applied_object_id);
  const status = await applicationStatus(previewed.application_id);
  assert.equal(status.state, 'applied');
  assert.equal(status.applied_by, A);
  assert.notEqual(status.applied_at, null);
  assert.equal(Number(await scalar('select count(*)::int from tonde.creative_techniques where workspace_id = $1 and canonical_id = $2',
    [wa, item.canonical_id])), 1);
  const listed = await index({ query: 'Handheld tension' });
  assert.equal(listed.items.find(row => row.item_id === item.item_id).applied, true);
});

test('attaching a reference records the rights class it honestly has', async () => {
  const { production } = await newProduction('attach');
  const known = await registerItem({ canonical_id: nextSlug('licensed'), item_kind: 'reference_example',
    source_kind: 'creator', title: 'A licensed example', summary: 'A clip we licensed',
    provenance: { source_label: 'Stockhouse', locator: 'https://example.invalid/clip',
      rights_classification: 'licensed' } });
  const unknownRights = await registerItem({ canonical_id: nextSlug('unknown-rights'), item_kind: 'movie_reference',
    source_kind: 'creator', title: 'A movie moment', summary: 'A reference to study',
    provenance: { source_label: 'A film', locator: 'https://example.invalid/film' } });
  const licensed = await applyApplication((await preview(known.item_id, 'attach_reference', production)).application_id,
    known.canonical_id);
  assert.equal(licensed.applied_object_kind, 'production_reference');
  const stored = (await rows(`select source_type, source_url, rights_classification, provenance from
    tonde.production_references where id = $1`, [licensed.applied_object_id]))[0];
  assert.equal(stored.source_type, 'url');
  assert.equal(stored.source_url, 'https://example.invalid/clip');
  assert.equal(stored.rights_classification, 'licensed');
  assert.equal(stored.provenance.discover_item_id, known.item_id);
  assert.equal(stored.provenance.source_label, 'Stockhouse');
  const movie = await applyApplication((await preview(unknownRights.item_id, 'attach_reference', production)).application_id,
    unknownRights.canonical_id);
  const movieRow = (await rows('select source_type, rights_classification from tonde.production_references where id = $1',
    [movie.applied_object_id]))[0];
  assert.equal(movieRow.source_type, 'movie');
  assert.equal(movieRow.rights_classification, 'unknown', 'rights are never assumed');
  // A locator that is not an address cannot be attached, even though a preview was possible.
  const notAddress = await registerItem({ canonical_id: nextSlug('not-address'), item_kind: 'reference_example',
    source_kind: 'creator', title: 'A shelf note', summary: 'Not an address',
    provenance: { source_label: 'A notebook', locator: 'shelf 4, second drawer' } });
  const previewed = await preview(notAddress.item_id, 'attach_reference', production);
  const refused = await failure(() => applyApplication(previewed.application_id, notAddress.canonical_id));
  assert.equal(refused.code, 'PT409');
  assert.match(refused.message, /REFERENCE_LOCATOR_NOT_A_URL/);
});

test('DIRECT THIS writes the item\'s directions onto the production and states them deterministically', async () => {
  const { production } = await newProduction('direct');
  const item = await registerItem({ canonical_id: nextSlug('directed'), item_kind: 'template',
    source_kind: 'creator', title: 'Interview in a car', summary: 'Two people, one moving camera',
    directions: 'Lock the wide, then hand-hold the reverse. Keep the road noise.',
    provenance: { source_label: 'Our own shoot' } });
  const status = await itemStatus(item.item_id);
  assert.match(status.directive, /Interview in a car/);
  assert.match(status.directive, /Keep the road noise/);
  assert.equal((await itemStatus(item.item_id)).directive, status.directive, 'the same item states the same direction');
  const applied = await applyApplication((await preview(item.item_id, 'direct_this', production)).application_id,
    item.canonical_id, 'Directed with this');
  assert.equal(applied.applied_object_kind, 'production_reference');
  const stored = (await rows(`select source_type, source_description, rights_classification, provenance
    from tonde.production_references where id = $1`, [applied.applied_object_id]))[0];
  assert.equal(stored.source_type, 'description');
  assert.equal(stored.source_description, 'Lock the wide, then hand-hold the reverse. Keep the road noise.');
  assert.equal(stored.rights_classification, 'unknown');
  assert.equal(stored.provenance.canonical_id, item.canonical_id);
  // The directions are exactly the item's, never a paraphrase or an extension.
  assert.equal(stored.source_description.includes('Keep the road noise'), true);
});

test('an applied application is a closed record and a withdrawn preview cannot be applied', async () => {
  const { production } = await newProduction('closed');
  const item = await registerItem({ canonical_id: nextSlug('closed'), item_kind: 'inspiration',
    source_kind: 'creator', title: 'A framing idea', summary: 'Frame within the frame',
    directions: 'Shoot through the doorway.', provenance: { source_label: 'My notebook' } });
  const withdrawn = await preview(item.item_id, 'direct_this', production);
  const result = await withdrawApplication(withdrawn.application_id, 'Changed my mind');
  assert.equal(result.state, 'withdrawn');
  const blocked = await failure(() => applyApplication(withdrawn.application_id, item.canonical_id));
  assert.equal(blocked.code, 'PT409');
  assert.match(blocked.message, /APPLICATION_NOT_OPEN/);
  const appliedPreview = await preview(item.item_id, 'direct_this', await newProduction('closed-two').then(row => row.production));
  const applied = await applyApplication(appliedPreview.application_id, item.canonical_id);
  assert.equal(applied.state, 'applied');
  const rewrite = await failure(() => asService(() => db.query(
    "update tonde.discover_applications set note = 'a different story' where id = $1", [applied.application_id])));
  assert.equal(rewrite.code, '23514');
  assert.match(rewrite.message, /closed record/);
  const repoint = await failure(() => asService(() => db.query(
    'update tonde.discover_applications set applied_object_id = null where id = $1', [applied.application_id])));
  assert.match(repoint.message, /closed record/);
  const alreadyApplied = await failure(() => withdrawApplication(applied.application_id));
  assert.equal(alreadyApplied.code, 'PT409');
  assert.match(alreadyApplied.message, /APPLICATION_ALREADY_APPLIED/);
  const forged = await failure(() => asService(() => db.query(
    `insert into tonde.discover_applications(workspace_id,item_id,application_kind,production_id,impact,state)
      values($1,$2,'direct_this',$3,'{}'::jsonb,'applied')`, [wa, item.item_id, production])));
  assert.equal(forged.code, '42501');
  // A client cannot reach the table directly either.
  const direct = await failure(() => asEditor(() => db.query(
    "update tonde.discover_applications set state = 'withdrawn' where id = $1", [applied.application_id])));
  assert.match(direct.message, /permission denied/);
});

test('TONDE-curated content is global, read by every workspace, and never minted by a client', async () => {
  const curated = await registerAsService({ canonical_id: nextSlug('curated-move'), item_kind: 'movie_reference',
    source_kind: 'tonde_canon', title: 'A curated movie reference', summary: 'A shot worth studying',
    directions: 'Study how the camera holds the exit line.',
    provenance: { source_label: 'A film', attribution: 'The filmmakers', locator: 'https://example.invalid/curated' } });
  assert.equal(curated.visibility, 'global');
  assert.equal(curated.review_state, 'curated');
  assert.equal(curated.usable, true);
  // Both workspaces see it, and either can apply it to its own production.
  assert.equal((await index({ workspace: wa })).items.some(row => row.item_id === curated.item_id), true);
  const inB = await asStranger(() => rows('select tonde.discover_index($1,null,null,50) as result', [wb])
    .then(result => result[0].result));
  assert.equal(inB.items.some(row => row.item_id === curated.item_id), true);
  const { production } = await newProduction('global-apply', wb, B);
  const previewed = await asStranger(() => rows('select tonde.discover_preview($1,$2,$3,$4,null,null,$5) as result',
    [wb, curated.item_id, 'direct_this', production, '']).then(result => result[0].result));
  const applied = await asStranger(() => rows('select tonde.discover_apply($1,$2,$3,$4) as result',
    [wb, previewed.application_id, curated.canonical_id, '']).then(result => result[0].result));
  assert.equal(applied.state, 'applied');
  assert.equal(Number(await scalar('select count(*)::int from tonde.production_references where workspace_id = $1 and id = $2',
    [wb, applied.applied_object_id])), 1);
  // A client cannot register curated content, cannot claim curation, and cannot edit a curated item.
  const asClient = await failure(() => registerItem({ canonical_id: nextSlug('client-curated'), item_kind: 'knowledge',
    source_kind: 'tonde_canon', title: 'Not mine to curate', summary: 'A client tried',
    provenance: { source_label: 'me', attribution: 'me' } }, A));
  assert.equal(asClient.code, '42501');
  assert.match(asClient.message, /registered by TONDE/);
  // An editor cannot reach the table directly, and cannot re-curate by hand either.
  const clientEdit = await failure(() => asOwner(() => db.query(
    "update tonde.discover_items set review_state = 'curated' where id = $1", [curated.item_id])));
  assert.match(clientEdit.message, /permission denied/);
  const clientDelete = await failure(() => asOwner(() => db.query(
    'delete from tonde.discover_items where id = $1', [curated.item_id])));
  assert.match(clientDelete.message, /permission denied/);
  const clientUncurate = await failure(() => asEditor(() => db.query(
    `update tonde.discover_items set title = 'Not mine' where id = $1`, [curated.item_id])));
  assert.match(clientUncurate.message, /permission denied/);
});

test('discover content is tenant-isolated', async () => {
  const technique = await createKnowledge({ name: 'Isolation probe', category: 'camera' });
  const item = await registerItem({ canonical_id: nextSlug('isolation'), item_kind: 'technique',
    source_kind: 'knowledge', title: 'Isolation probe', summary: 'Only for workspace A',
    directions: 'Keep it here.', provenance: { source_label: 'Ours' }, source_technique_id: technique.item_id });
  const { production } = await newProduction('isolation');
  const previewed = await preview(item.item_id, 'use_technique', production);
  await saveItem(item.item_id, 'Mine');
  const collection = await collectionCreate('Private ideas');
  await collectionAdd(collection.collection_id, item.item_id);
  for (const sql of ['select count(*)::int as n from tonde.discover_items where id = $1',
    'select count(*)::int as n from tonde.discover_saves where item_id = $1',
    'select count(*)::int as n from tonde.discover_collection_items where item_id = $1',
    'select count(*)::int as n from tonde.discover_applications where id = $1']) {
    const arg = sql.includes('applications') ? previewed.application_id : item.item_id;
    assert.equal(Number(await asStranger(() => scalar(sql, [arg]))), 0, `a stranger sees nothing: ${sql}`);
  }
  assert.equal(Number(await asStranger(() => scalar('select count(*)::int from tonde.discover_collections'))), 0);
  const foreignIndex = await failure(() => index({ workspace: wa }, B));
  assert.equal(foreignIndex.code, '42501');
  const foreignRegister = await failure(() => registerItem({ canonical_id: nextSlug('foreign'), item_kind: 'inspiration',
    source_kind: 'creator', title: 'Not mine', summary: 'Not my workspace', provenance: { source_label: 'x' } }, B));
  assert.equal(foreignRegister.code, '42501');
  // A member of another workspace asking about this workspace's item is told it is not visible, which is
  // the same answer a nonexistent item gets: no existence is leaked either way.
  const foreignStatus = await failure(() => asStranger(() => rows('select tonde.discover_item_status($1,$2) as result',
    [wb, item.item_id])));
  assert.equal(foreignStatus.code, 'PT409', 'a member of another workspace is told it is not visible');
  assert.match(foreignStatus.message, /NOT_VISIBLE/);
  const foreignItem = await failure(() => asStranger(() => rows('select tonde.discover_item_status($1,$2) as result',
    [wa, item.item_id])));
  assert.equal(foreignItem.code, '42501');
  const foreignRead = await failure(() => asOwner(() => rows('select tonde.discover_index($1,null,null,10) as result', [wb])));
  assert.equal(foreignRead.code, '42501', 'reading another workspace is denied, not silently emptied');
  // A viewer in the workspace may read the shelf without being able to prepare or apply work.
  const viewerIndex = await asViewer(() => rows('select tonde.discover_index($1,null,$2,200) as result',
    [wa, 'Isolation probe']).then(result => result[0].result));
  assert.equal(viewerIndex.items.some(row => row.item_id === item.item_id), true);
  const viewerRegister = await failure(() => registerItem({ canonical_id: nextSlug('viewer'), item_kind: 'inspiration',
    source_kind: 'creator', title: 'Viewer item', summary: 'No such right', provenance: { source_label: 'x' } }, E));
  assert.equal(viewerRegister.code, '42501');
  const viewerCollection = await failure(() => asViewer(() => rows(
    'select tonde.discover_collection_create($1,$2,$3) as result', [wa, 'Viewer list', ''])));
  assert.equal(viewerCollection.code, '42501');
});
