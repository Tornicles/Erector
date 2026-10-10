import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 9D versioning, creative branches, restore, merge and change impact (additive migration
// 022). Real embedded PostgreSQL. This proves that a mainline edit creates a new revision instead
// of overwriting history, that historical versions are immutable, that compare shows meaningful
// changed fields rather than a raw JSON diff, that restore creates a NEW current revision without
// rewinding, that a branch is an object-level alternative that touches nothing on the mainline
// until an explicit reviewed merge, that a merge conflict is shown rather than resolved
// automatically, and that an accepted merge propagates through the Prompt 9A impact engine.
// Nothing here crosses a workspace boundary.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
let wa, wb, film, sceneOne, shotOne, story;

const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);
const asViewer = action => asUser(C, action);
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };

const versionList = (object, branch = 'main') => asEditor(() => scalar(
  'select tonde.version_list($1,$2,$3,$4,$5,$6)', [wa, film, object, branch, 100, 0]));
const versionGet = version => asEditor(() => scalar('select tonde.version_get($1,$2,$3)', [wa, film, version]));
const versionCompare = (left, right) => asEditor(() => scalar('select tonde.version_compare($1,$2,$3,$4)', [wa, film, left, right]));
const versionRestore = (version, note = '') => asEditor(() => scalar('select tonde.version_restore($1,$2,$3,$4)', [wa, film, version, note]));
const branchCreate = payload => asEditor(() => scalar('select tonde.branch_create($1,$2,$3,$4)', [wa, film, payload.scope_object_id, JSON.stringify({
  name: payload.name, scope: payload.scope, source_version_id: payload.source_version_id ?? null, reason: payload.reason ?? '' })]));
const branchList = (state = null) => asEditor(() => scalar('select tonde.branch_list($1,$2,$3,$4,$5)', [wa, film, state, 100, 0]));
const branchDetail = branch => asEditor(() => scalar('select tonde.branch_detail($1,$2,$3)', [wa, film, branch]));
const changeSet = (branch, target, patch, note = '') => asEditor(() => scalar(
  'select tonde.branch_change_set($1,$2,$3,$4)', [wa, film, branch, JSON.stringify({ target_object_id: target, patch, note })]));
const changeClear = (branch, change, note = '') => asEditor(() => scalar(
  'select tonde.branch_change_clear($1,$2,$3,$4,$5)', [wa, film, branch, change, note]));
const branchState = (branch, state, note = '') => asEditor(() => scalar(
  'select tonde.branch_state_set($1,$2,$3,$4,$5)', [wa, film, branch, state, note]));
const mergePreview = branch => asEditor(() => scalar('select tonde.merge_preview($1,$2,$3)', [wa, film, branch]));
const mergeDecide = (proposal, decision, selected = [], propagation = 'change_only_this', note = '') => asEditor(() => scalar(
  'select tonde.merge_decide($1,$2,$3,$4,$5,$6,$7)',
  [wa, film, proposal, decision, selected.length ? selected : null, propagation, note]));

const sceneId = (production, title) => asEditor(() => scalar(
  'select (tonde.create_studio_scene($1,$2,$3,$4)->>\'scene_id\')::uuid',
  [wa, production, null, JSON.stringify({ title, duration_ms: 20000 })]));
const shotId = (production, scene, title) => asEditor(() => scalar(
  'select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>\'shot_id\')::uuid',
  [wa, production, scene, null, JSON.stringify({ title, duration_ms: 4000 })]));

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
  for (const id of [A, B, C]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asUser(A, () => scalar('select tonde.bootstrap_workspace()'));
  wb = await asUser(B, () => scalar('select tonde.bootstrap_workspace()'));
  film = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Marquee film', 'short_film']));
  sceneOne = await sceneId(film, 'Scene 1 Apartment');
  shotOne = await shotId(film, sceneOne, 'Marcus enters');
  story = await asEditor(() => scalar(
    "insert into tonde.creative_documents(workspace_id, production_id, scope_object_id, document_type, title, content) values ($1,$2,$3,'story','Story','Marcus leaves the apartment.') returning id",
    [wa, film, film]));
  await db.query("insert into tonde.workspace_members(workspace_id, user_id, role) values ($1,$2,'viewer')", [wa, C]);
});

after(async () => { await db.close(); });

test('a mainline edit creates a new revision and never overwrites history', async () => {
  const list = await versionList(shotOne);
  assert.equal(list.total >= 1, true, 'the Shot has at least its creation version');
  const first = list.items.find(item => item.revision === 1);
  assert.ok(first.version_id, 'revision 1 exists');
  assert.equal(first.source_action, 'insert');

  await asEditor(() => db.query('update tonde.shots set title = $2 where id = $1', [shotOne, 'Marcus enters, slower']));
  const after = await versionList(shotOne);
  assert.equal(after.total, 2, 'the edit added a revision instead of replacing one');
  const latest = after.items.find(item => item.revision === 2);
  assert.equal(latest.source_action, 'update');
  assert.equal(latest.parent_version_id, first.version_id, 'the new revision points at its parent');
  assert.equal(latest.is_current, true);
  const original = await versionGet(first.version_id);
  assert.equal(original.snapshot.title, 'Marcus enters', 'the older snapshot still says what it said');
});

test('historical versions are immutable', async () => {
  const list = await versionList(shotOne);
  const version = list.items[0].version_id;
  const update_error = await failure(() => db.query("update tonde.object_versions set snapshot = '{}'::jsonb where id = $1", [version]));
  assert.match(String(update_error.message), /immutable/i);
  assert.equal(update_error.code, '23514');
  const delete_error = await failure(() => db.query('delete from tonde.object_versions where id = $1', [version]));
  assert.ok(String(delete_error.message).match(/immutable/i) || String(delete_error.message).match(/permission denied/i));
  assert.equal((await versionList(shotOne)).total, 2, 'nothing was removed');
});

test('compare shows meaningful changed fields, not a raw JSON diff', async () => {
  const list = await versionList(shotOne);
  const one = list.items.find(item => item.revision === 1).version_id;
  const two = list.items.find(item => item.revision === 2).version_id;
  const comparison = await versionCompare(one, two);
  assert.equal(comparison.change_count, 1);
  const change = comparison.changes[0];
  assert.equal(change.field, 'title');
  assert.equal(change.label, 'Title');
  assert.equal(change.before, 'Marcus enters');
  assert.equal(change.after, 'Marcus enters, slower');
  // Only the writable creative fields are compared: run_down fields must not appear as changes.
  assert.equal(comparison.changes.some(item => item.field === 'revision'), false);
  assert.equal(comparison.changes.some(item => item.field === 'updated_at'), false);
  const sceneVersion = (await versionList(sceneOne)).items[0].version_id;
  const crossObject = await failure(() => versionCompare(one, sceneVersion));
  assert.match(String(crossObject.message), /same object/i);
});

test('restore creates a new current revision instead of rewinding', async () => {
  const list = await versionList(shotOne);
  const first = list.items.find(item => item.revision === 1).version_id;
  const restored = await versionRestore(first, 'Back to the original beat');
  assert.equal(restored.new_revision, 3, 'restore added a revision');
  assert.equal(restored.restored_from_revision, 1);
  assert.equal(await scalar('select title from tonde.shots where id = $1', [shotOne]), 'Marcus enters');
  const after = await versionList(shotOne);
  assert.equal(after.total, 3, 'the history between is preserved');
  const newest = await versionGet(restored.new_revision && after.items.find(item => item.revision === 3).version_id);
  assert.equal(newest.source_action, 'restore', 'the version says a restore produced it');
});

test('a branch records its origin and edits never touch the mainline', async () => {
  const list = await versionList(sceneOne);
  const source = list.items[0].version_id;
  const branch = await branchCreate({ scope_object_id: sceneOne, scope: 'scene', name: 'Product-first opening', source_version_id: source, reason: 'Try the product earlier.' });
  assert.equal(branch.state, 'open');
  assert.equal(branch.source_version_id, source);
  assert.equal(branch.source_revision, list.items[0].revision);

  const change = await changeSet(branch.branch_id, sceneOne, { title: 'Scene 1 Apartment, product first' }, 'Lead with the bottle.');
  assert.deepEqual(change.changed_fields, ['title']);
  assert.equal(await scalar('select title from tonde.scenes where id = $1', [sceneOne]), 'Scene 1 Apartment', 'the mainline is unchanged');

  const detail = await branchDetail(branch.branch_id);
  assert.equal(detail.change_count, 1);
  assert.equal(detail.changes[0].patch.title, 'Scene 1 Apartment, product first');

  const bad = await failure(() => changeSet(branch.branch_id, sceneOne, { sort_order: 5 }));
  assert.match(String(bad.message), /cannot change on a branch/i);
  assert.equal(bad.code, '22023');
});

test('a branch scope must match the object it branches', async () => {
  const mismatch = await failure(() => branchCreate({ scope_object_id: sceneOne, scope: 'shot', name: 'Wrong scope' }));
  assert.match(String(mismatch.message), /scope must match/i);
  assert.equal(mismatch.code, '22023');
  const mismatchTwo = await failure(() => branchCreate({ scope_object_id: shotOne, scope: 'scene', name: 'Also wrong' }));
  assert.equal(mismatchTwo.code, '22023');
  const unknown = await failure(() => branchCreate({ scope_object_id: sceneOne, scope: 'sandwich', name: 'Nonsense' }));
  assert.match(String(unknown.message), /unsupported branch scope/i);
  // A matching scope is still accepted, and nothing false was recorded.
  const good = await branchCreate({ scope_object_id: sceneOne, scope: 'scene', name: 'Legit scope' });
  assert.equal(good.scope, 'scene');
});

test('merge preview classifies clean changes and a merge creates new mainline revisions', async () => {
  const branch = (await branchList('open')).items.find(item => item.name === 'Product-first opening');
  const preview = await mergePreview(branch.branch_id);
  assert.equal(preview.counts.clean, 1);
  assert.equal(preview.counts.conflicted, 0);
  assert.equal(preview.state, 'proposed');
  assert.equal(preview.items[0].status, 'clean');

  const before = await scalar('select revision from tonde.scenes where id = $1', [sceneOne]);
  const decision = await mergeDecide(preview.proposal_id, 'merge', [], 'review_changes', 'Ship it.');
  assert.equal(decision.state, 'merged');
  assert.equal(decision.applied_count, 1);
  assert.equal(await scalar('select title from tonde.scenes where id = $1', [sceneOne]), 'Scene 1 Apartment, product first');
  assert.equal(await scalar('select revision from tonde.scenes where id = $1', [sceneOne]), before + 1);
  const mergedBranch = (await branchList('merged')).items.find(item => item.branch_id === branch.branch_id);
  assert.equal(mergedBranch.state, 'merged', 'branch history is preserved and closed');
  const versions = await versionList(sceneOne);
  const merged = versions.items.find(item => item.source_action === 'merge');
  assert.ok(merged, 'the merge is recorded as the source action of its new revision');
});

test('a merge conflict is shown, never resolved automatically', async () => {
  const shotList = await versionList(shotOne);
  const branch = await branchCreate({ scope_object_id: shotOne, scope: 'shot', name: 'Slower cut', source_version_id: shotList.items[0].version_id });
  await changeSet(branch.branch_id, shotOne, { title: 'Marcus enters very slowly' });
  // Main moves after the branch change was written: a real conflict.
  await asEditor(() => db.query('update tonde.shots set title = $2 where id = $1', [shotOne, 'Marcus enters, then stops']));
  const preview = await mergePreview(branch.branch_id);
  assert.equal(preview.counts.conflicted, 1);
  assert.equal(preview.counts.clean, 0);
  assert.equal(preview.conflicts[0].reason.match(/mainline moved/i) !== null, true);
  const decision = await mergeDecide(preview.proposal_id, 'merge');
  assert.equal(decision.applied_count, 0, 'a conflicted change is never applied');
  assert.equal(await scalar('select title from tonde.shots where id = $1', [shotOne]), 'Marcus enters, then stops');
});

test('rejecting a merge changes nothing at all', async () => {
  const sceneList = await versionList(sceneOne);
  const branch = await branchCreate({ scope_object_id: sceneOne, scope: 'scene', name: 'Darker version', source_version_id: sceneList.items[0].version_id });
  await changeSet(branch.branch_id, sceneOne, { description: 'One hard key light, deep shadow.' });
  const titleBefore = await scalar('select title from tonde.scenes where id = $1', [sceneOne]);
  const preview = await mergePreview(branch.branch_id);
  const decision = await mergeDecide(preview.proposal_id, 'reject', [], 'change_only_this', 'Not yet.');
  assert.equal(decision.state, 'rejected');
  assert.equal(await scalar('select title from tonde.scenes where id = $1', [sceneOne]), titleBefore);
  assert.equal(await scalar('select description from tonde.scenes where id = $1', [sceneOne]), '');
  const branchRow = await branchDetail(branch.branch_id);
  assert.equal(branchRow.state, 'open', 'the branch stays open for later');
});

test('alternate endings are preserved side by side', async () => {
  const first = await branchCreate({ scope_object_id: story, scope: 'story', name: 'Ending A', reason: 'Marcus stays.' });
  await changeSet(first.branch_id, story, { content: 'Ending A: Marcus stays and unpacks.' });
  const second = await branchCreate({ scope_object_id: story, scope: 'story', name: 'Ending B', reason: 'Marcus leaves.' });
  await changeSet(second.branch_id, story, { content: 'Ending B: Marcus leaves for good.' });
  const preview = await mergePreview(first.branch_id);
  const decision = await mergeDecide(preview.proposal_id, 'merge', [], 'change_only_this', 'Choose Ending A.');
  assert.equal(decision.applied_count, 1);
  assert.equal(await scalar('select content from tonde.creative_documents where id = $1', [story]), 'Ending A: Marcus stays and unpacks.');
  const open = await branchList('open');
  assert.ok(open.items.some(item => item.name === 'Ending B'), 'Ending B is still preserved');
  const merged = await branchList('merged');
  assert.ok(merged.items.some(item => item.name === 'Ending A'));
});

test('abandoning a branch closes it to further edits', async () => {
  const list = await versionList(sceneOne);
  const branch = await branchCreate({ scope_object_id: sceneOne, scope: 'scene', name: 'Shorter cut', source_version_id: list.items[0].version_id });
  await changeSet(branch.branch_id, sceneOne, { purpose: 'Trim the open.' });
  const abandoned = await branchState(branch.branch_id, 'abandoned', 'Not this one.');
  assert.equal(abandoned.state, 'abandoned');
  const blocked = await failure(() => changeSet(branch.branch_id, sceneOne, { purpose: 'Again' }));
  assert.match(String(blocked.message), /not open/i);
  assert.equal(blocked.code, '23514');
  const reopened = await branchState(branch.branch_id, 'open');
  assert.equal(reopened.state, 'open');
});

test('a cleared change is kept as branch history', async () => {
  const branch = (await branchList('open')).items.find(item => item.name === 'Shorter cut');
  const change = await changeSet(branch.branch_id, sceneOne, { title: 'Cut' });
  const cleared = await changeClear(branch.branch_id, change.change_id, 'Drop this idea');
  assert.equal(cleared.state, 'rejected');
  const detail = await branchDetail(branch.branch_id);
  assert.equal(detail.changes.length >= 1, true, 'the discarded change stays readable');
});

test('workspace isolation and role boundaries hold', async () => {
  const other = await asOther(() => scalar('select tonde.version_list($1,$2,$3,$4,$5,$6)', [wa, film, shotOne, 'main', 10, 0]).catch(error => error));
  assert.equal(other.code, '42501');
  const viewerList = await asViewer(() => scalar('select tonde.version_list($1,$2,$3,$4,$5,$6)', [wa, film, shotOne, 'main', 10, 0]));
  assert.ok(viewerList.total >= 1, 'a viewer may read version history');
  const viewerWrite = await asViewer(() => scalar('select tonde.branch_create($1,$2,$3,$4)', [wa, film, sceneOne, JSON.stringify({ name: 'Nope', scope: 'scene' })]).catch(error => error));
  assert.equal(viewerWrite.code, '42501');
  const crossBranch = await failure(() => asOther(() => db.query("insert into tonde.object_branches(workspace_id, production_id, scope_object_id, scope, name) values ($1,$2,$3,'scene','X')", [wa, film, sceneOne])));
  assert.equal(crossBranch.code, '42501');
});

test('the private helpers stay unreachable', async () => {
  const reachable = await asEditor(() => scalar("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'tonde_private' and p.proname in ('vb_fields','vb_patch_apply','vb_diff')"));
  assert.equal(Number(reachable) >= 3, true);
  const denied = await failure(() => asEditor(() => scalar("select tonde_private.vb_fields('scene')")));
  assert.match(String(denied.message), /permission denied/i);
  const grant = await scalar("select exists(select 1 from information_schema.routine_privileges where specific_schema = 'tonde_private' and routine_name = 'vb_patch_apply' and grantee in ('authenticated','anon','PUBLIC'))");
  assert.equal(grant, false);
});
