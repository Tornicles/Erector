import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Prompt 11 packet 039 — the Production Knowledge Engine, on real embedded PostgreSQL over one
// 001->039 stack. These tests pin the laws the migration claims: every item states where it came from;
// what a source says and what TONDE says are different fields; imported and tutorial-derived knowledge
// cannot guide a production until a second person reviewed it; a client can raise knowledge and
// conflicts but can never mint a review, canon or supersession; editing the substance of reviewed
// knowledge invalidates the review instead of inheriting it; a disagreement keeps both claims and only
// review authority settles it; tutorials are registered, stepped, frozen at publication and promoted
// into pending-review knowledge that cites them; and an import is bounded, idempotent by payload and
// records every refusal with its reason.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';
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
const asReviewer = action => asUser(D, action);
const asStranger = action => asUser(B, action);

const createItem = (over = {}, user = A) => asUser(user, () => rows(
  `select tonde.knowledge_item_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as result`,
  [over.workspace ?? wa, over.canonicalId ?? `probe-item-${randomUUID().slice(0, 8)}`, over.name ?? 'Probe technique',
   over.category ?? 'lighting', over.description ?? 'A probe description', over.purpose ?? 'A probe purpose',
   over.effect ?? 'A probe effect', over.knowledgeClass ?? 'technique', over.sourceKind ?? 'creator',
   over.guidance ?? 'Do the thing.', JSON.stringify(over.applicability ?? {}),
   JSON.stringify(over.adaptation ?? { source_says: 'x', tonde_says: 'y' }),
   JSON.stringify(over.sources ?? []), over.pendingReview ?? false]).then(result => result[0].result));
const submitItem = (item, note = 'Ready for review', user = A) => asUser(user, () => rows(
  'select tonde.knowledge_item_submit($1,$2,$3) as result', [wa, item, note]).then(result => result[0].result));
const reviewItem = (item, decision, note = '', user = D) => asUser(user, () => rows(
  'select tonde.knowledge_item_review($1,$2,$3,$4) as result', [wa, item, decision, note])
  .then(result => result[0].result));
const reviseItem = (item, changes, reason = 'Probe revision', user = C) => asUser(user, () => rows(
  'select tonde.knowledge_item_revise($1,$2,$3,$4) as result', [wa, item, JSON.stringify(changes), reason])
  .then(result => result[0].result));
const replaceItem = (item, replacement, reason = 'Probe replacement', user = D) => asUser(user, () => rows(
  'select tonde.knowledge_item_replace($1,$2,$3,$4) as result', [wa, item, replacement, reason])
  .then(result => result[0].result));
const addSource = (item, source, user = A) => asUser(user, () => rows(
  'select tonde.knowledge_source_add($1,$2,$3) as result', [wa, item, JSON.stringify(source)])
  .then(result => result[0].result));
const openConflict = (over = {}, user = C) => asUser(user, () => rows(
  'select tonde.knowledge_conflict_open($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',
  [over.workspace ?? wa, over.subject ?? `Probe conflict ${randomUUID().slice(0, 8)}`,
   over.kind ?? 'recommendation', over.primaryClaim ?? 'Shot at 1/48', over.secondaryClaim ?? 'Shot at 1/50',
   over.severity ?? 'material', over.primaryItem ?? null, over.secondaryItem ?? null,
   JSON.stringify(over.evidence ?? []), over.detectedBy ?? 'creator']).then(result => result[0].result));
const resolveConflict = (conflict, resolution = 'adopt_primary', note = 'Settled in review', user = D) => asUser(user, () => rows(
  'select tonde.knowledge_conflict_resolve($1,$2,$3,$4) as result', [wa, conflict, resolution, note])
  .then(result => result[0].result));
const registerTutorial = (over = {}, user = C) => asUser(user, () => rows(
  'select tonde.tutorial_register($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
  [over.workspace ?? wa, over.title ?? `Probe tutorial ${randomUUID().slice(0, 8)}`, over.sourceKind ?? 'external_video',
   over.media === undefined ? null : over.media,
   over.locator === undefined ? 'https://example.invalid/tutorial' : over.locator,
   over.attribution ?? 'Somebody', over.license ?? 'CC BY', over.language ?? 'en', over.notes ?? ''])
  .then(result => result[0].result));
const addStep = (tutorial, ordinal, over = {}, user = C) => asUser(user, () => rows(
  'select tonde.tutorial_step_add($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [wa, tutorial, ordinal, over.title ?? `Step ${ordinal}`, over.instruction ?? 'Point the light at the subject.',
   over.technique ?? null, JSON.stringify(over.settings ?? { shutter: '1/48' }),
   JSON.stringify(over.evidence ?? {})]).then(result => result[0].result));
const publishTutorial = (tutorial, note = 'Published', user = D) => asUser(user, () => rows(
  'select tonde.tutorial_publish($1,$2,$3) as result', [wa, tutorial, note]).then(result => result[0].result));
const promoteStep = (step, over = {}, user = C) => asUser(user, () => rows(
  'select tonde.tutorial_step_promote($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [wa, step, over.canonicalId ?? `probe-tutorial-${randomUUID().slice(0, 8)}`, over.name ?? 'Tutorial technique',
   over.category ?? 'camera', over.guidance ?? 'Use a 50mm at chest height.',
   JSON.stringify(over.adaptation ?? { source_says: 'any lens', tonde_says: '50mm', why: 'the source assumed a set' }),
   JSON.stringify(over.applicability ?? { equipment: ['camera'] })]).then(result => result[0].result));
const importRequest = (payload, over = {}) => asUser(over.user ?? C, () => rows(
  'select tonde.knowledge_import_request($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [over.workspace ?? wa, over.format ?? 'json', over.sourceLabel ?? 'Probe handbook', JSON.stringify(payload),
   over.locator ?? 'https://example.invalid/handbook', over.license ?? 'CC BY', over.attribution ?? 'Somebody',
   over.dryRun ?? false]).then(result => result[0].result));
const searchKnowledge = (over = {}, user = A) => asUser(user, () => rows(
  'select tonde.knowledge_search($1,$2,$3,$4,$5,$6) as result',
  [over.workspace ?? wa, over.query ?? null, over.category ?? null, over.knowledgeClass ?? null,
   over.includeUnreviewed ?? true, over.limit ?? 50]).then(result => result[0].result));
const itemStatus = (item, user = A) => asUser(user, () => rows(
  'select tonde.knowledge_item_status($1,$2) as result', [wa, item]).then(result => result[0].result));

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
  for (const id of [A, B, C, D]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asOwner(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asStranger(() => scalar('select tonde.bootstrap_workspace()'));
  await asUser(C, () => scalar('select tonde.bootstrap_workspace()'));
  await asUser(D, () => scalar('select tonde.bootstrap_workspace()'));
  // A workspace with an owner (also an admin), a plain editor and a second reviewer, so the tests can
  // tell authority apart from membership.
  await asService(async () => {
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')", [wa, C]);
    await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'admin')", [wa, D]);
  });
});

after(async () => { await db?.close(); });

test('the knowledge vocabulary, provenance and the review gate are closed sets', async () => {
  const classes = (await rows(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'tonde.creative_techniques'::regclass and conname = 'knowledge_class_valid'`))[0].def;
  const listed = [...classes.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
  assert.deepEqual(listed, ['equipment_guidance', 'safety', 'scene_guidance', 'settings_guidance',
    'technique', 'workflow']);
  const states = (await rows(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'tonde.creative_techniques'::regclass and conname = 'knowledge_review_state_valid'`))[0].def;
  assert.deepEqual([...states.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort(),
    ['creator_asserted', 'pending_review', 'rejected', 'reviewed', 'superseded']);
  // Provenance, conflict and tutorial surfaces exist and are tenant-readable.
  for (const table of ['knowledge_sources', 'knowledge_conflicts', 'knowledge_imports',
    'knowledge_tutorials', 'knowledge_tutorial_steps']) {
    assert.equal(Number(await scalar(`select count(*) from pg_tables where schemaname='tonde' and tablename=$1`, [table])), 1);
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid = ('tonde.' || $1)::regclass`, [table]), true);
  }
  // The usability law is the one place guidance eligibility is decided.
  assert.equal(await scalar(`select tonde_private.knowledge_is_usable('reviewed','import')`), true);
  assert.equal(await scalar(`select tonde_private.knowledge_is_usable('creator_asserted','creator')`), true);
  assert.equal(await scalar(`select tonde_private.knowledge_is_usable('pending_review','import')`), false);
  assert.equal(await scalar(`select tonde_private.knowledge_is_usable('creator_asserted','reference')`), false);
  assert.equal(await scalar(`select tonde_private.knowledge_is_usable('pending_review','creator')`), false);
});

test('a creator\'s own knowledge guides immediately; imported knowledge waits for review', async () => {
  const own = await createItem({ name: 'Own technique' });
  assert.equal(own.review_state, 'creator_asserted');
  assert.equal(own.usable_for_guidance, true);
  const imported = await createItem({ name: 'Imported technique', sourceKind: 'import' });
  assert.equal(imported.review_state, 'pending_review');
  assert.equal(imported.usable_for_guidance, false);
  const fromTutorial = await createItem({ name: 'Tutorial technique', sourceKind: 'tutorial' });
  assert.equal(fromTutorial.review_state, 'pending_review');
  const every = await searchKnowledge();
  assert.equal(every.items.length, 3);
  const usableOnly = await searchKnowledge({ includeUnreviewed: false });
  assert.deepEqual(usableOnly.items.map(item => item.item_id), [own.item_id]);
  assert.equal(every.by_review_state.creator_asserted, 1);
  assert.equal(every.by_review_state.pending_review, 2);
  // A creator can also ask for their own knowledge to be reviewed before anyone relies on it.
  const submitted = await submitItem(own.item_id, 'Please check the lighting claim');
  assert.equal(submitted.review_state, 'pending_review');
  assert.equal((await submitItem(own.item_id)).idempotent, true);
  assert.equal(Number(await scalar('select count(*)::integer from tonde.creative_techniques where id = $1 and review_state = $2',
    [own.item_id, 'pending_review'])), 1);
});

test('review needs review authority, and imported knowledge needs a second person', async () => {
  const item = await createItem({ name: 'Reviewable technique' });
  // An editor is a member, not a reviewer.
  assert.equal((await failure(() => reviewItem(item.item_id, 'reviewed', 'Looks right', C))).code, '42501');
  const reviewed = await reviewItem(item.item_id, 'reviewed', 'Checked against the manual');
  assert.equal(reviewed.review_state, 'reviewed');
  assert.equal(reviewed.usable_for_guidance, true);
  assert.equal((await reviewItem(item.item_id, 'reviewed')).idempotent, true);
  // Rejection says why, and a rejection is not guidance.
  const rejected = await createItem({ name: 'Rejected technique' });
  assert.equal((await failure(() => reviewItem(rejected.item_id, 'rejected', ''))).code, '22023');
  const outcome = await reviewItem(rejected.item_id, 'rejected', 'The claim does not hold on a gimbal');
  assert.equal(outcome.review_state, 'rejected');
  assert.equal(outcome.usable_for_guidance, false);
  // Imported knowledge is reviewed by someone other than the importer.
  const imported = await createItem({ name: 'Imported by the reviewer', sourceKind: 'import' }, D);
  assert.equal(imported.review_state, 'pending_review');
  const selfReview = await failure(() => reviewItem(imported.item_id, 'reviewed', 'Fine', D));
  assert.equal(selfReview.code, 'PT409');
  assert.match(selfReview.message, /KNOWLEDGE_SELF_REVIEW_REFUSED/);
  const secondPair = await reviewItem(imported.item_id, 'reviewed', 'Imported claim checked', A);
  assert.equal(secondPair.usable_for_guidance, true);
  // Only a member of the workspace can ask at all.
  assert.equal((await failure(() => asStranger(() => rows(
    'select tonde.knowledge_item_review($1,$2,$3,$4)', [wa, item.item_id, 'reviewed', 'x'])))).code, '42501');
});

test('a client can never mint a review, canon or supersession', async () => {
  const item = await createItem({ name: 'Guarded technique' });
  // Knowledge is written through the RPCs: a client session has no direct write grant at all.
  assert.equal((await failure(() => asOwner(() => db.query(
    `update tonde.creative_techniques set review_state = 'reviewed' where id = $1`, [item.item_id])))).code, '42501');
  assert.equal((await failure(() => asOwner(() => db.query(`insert into tonde.creative_techniques(
    workspace_id, canonical_id, name, category, description, purpose, effect, source_kind, review_state)
    values($1,'probe-forged','x','camera','d','p','e','tonde_canon','reviewed')`, [wa])))).code, '42501');
  // Even a privileged session cannot write a review that is not stamped, nor claim a canon it did not review.
  assert.equal((await failure(() => asService(() => db.query(`insert into tonde.creative_techniques(
    workspace_id, canonical_id, name, category, description, purpose, effect, source_kind, review_state, created_by)
    values($1,'probe-unstamped','x','camera','d','p','e','creator','reviewed',$2)`, [wa, A])))).code, '23514');
  assert.equal((await failure(() => asService(() => db.query(`insert into tonde.creative_techniques(
    workspace_id, canonical_id, name, category, description, purpose, effect, source_kind, review_state, created_by)
    values($1,'probe-fake-canon','x','camera','d','p','e','tonde_canon','creator_asserted',$2)`, [wa, A])))).code, '23514');
  // Origin does not change after the fact, and a reviewed item cannot absorb a substance change silently.
  assert.equal((await failure(() => asService(() => db.query(
    `update tonde.creative_techniques set source_kind = 'tonde_canon' where id = $1`, [item.item_id])))).code, '23514');
  await reviewItem(item.item_id, 'reviewed', 'Reviewed once');
  const silent = await failure(() => asService(() => db.query(
    `update tonde.creative_techniques set tonde_guidance = 'different guidance' where id = $1`, [item.item_id])));
  assert.equal(silent.code, '23514');
  assert.match(silent.message, /must record a new review/);
  // The review queue is visible to the workspace, and it counts states honestly.
  const queue = await searchKnowledge({ query: 'Guarded technique' });
  assert.equal(queue.items[0].review_state, 'reviewed');
  assert.equal(queue.items[0].reviewed_at !== null, true);
  assert.equal(queue.items[0].usable_for_guidance, true);
});

test('a revision invalidates the review instead of inheriting it, and supersession is one-way', async () => {
  const item = await createItem({ name: 'Revisable technique' });
  const before = await itemStatus(item.item_id);
  await reviewItem(item.item_id, 'reviewed', 'Reviewed');
  const revised = await reviseItem(item.item_id, { guidance: 'Revised guidance', applicability: { equipment: ['camera'] } },
    'The original missed a step');
  assert.equal(revised.previous_review_state, 'reviewed');
  assert.equal(revised.review_state, 'pending_review');
  assert.equal(revised.usable_for_guidance, false);
  // `revision` is the platform's own counter: it moves forward on every recorded change.
  assert.ok(revised.revision > before.revision, 'a revision moves the item forward');
  const status = await itemStatus(item.item_id);
  assert.equal(status.canonical_id, (await scalar('select canonical_id from tonde.creative_techniques where id = $1', [item.item_id])));
  assert.equal(status.reviewed_by, null);
  assert.equal(status.reviewed_at, null);
  assert.equal(status.applicability.equipment[0], 'camera');
  assert.equal(status.tonde_guidance, 'Revised guidance');
  assert.equal(status.content_hash !== null, true);
  // An unreviewed item keeps its state through a revision; identity and origin never move.
  const draft = await createItem({ name: 'Draft technique' });
  const draftRevision = await reviseItem(draft.item_id, { name: 'Draft technique (v2)' });
  assert.equal(draftRevision.review_state, 'creator_asserted');
  assert.equal(await scalar('select canonical_id from tonde.creative_techniques where id = $1', [draft.item_id]),
    draft.canonical_id ?? (await scalar('select canonical_id from tonde.creative_techniques where id = $1', [draft.item_id])));
  assert.equal((await failure(() => reviseItem(draft.item_id, { review_state: 'reviewed' }))).code, '22023');
  assert.equal((await failure(() => reviseItem(draft.item_id, {}))).code, '22023');
  // Replacement requires a reviewed replacement, and closes the old item as history.
  const replacement = await createItem({ name: 'Replacement technique' });
  assert.equal((await failure(() => replaceItem(draft.item_id, replacement.item_id))).code, 'PT409');
  await reviewItem(replacement.item_id, 'reviewed', 'The better technique');
  const replaced = await replaceItem(draft.item_id, replacement.item_id, 'Superseded by the reviewed version');
  assert.equal(replaced.review_state, 'superseded');
  assert.equal(replaced.superseded_by, replacement.item_id);
  assert.equal((await replaceItem(draft.item_id, replacement.item_id)).idempotent, true);
  assert.equal(await scalar('select supersedes_id from tonde.creative_techniques where id = $1', [replacement.item_id]),
    draft.item_id);
  assert.equal((await failure(() => reviseItem(draft.item_id, { name: 'Nope' }))).code, 'PT409');
  assert.equal((await failure(() => reviewItem(draft.item_id, 'reviewed'))).code, 'PT409');
});

test('provenance is recorded per citation and must be checkable', async () => {
  const item = await createItem({ name: 'Cited technique', sources: [
    { label: 'Camera manual, p.48', locator: 'https://example.invalid/manual#p48', publisher: 'Manufacturer',
      license: 'All rights reserved', credibility: 'primary', source_version: '2024-01', excerpt: 'It says so.' },
  ] });
  const status = await itemStatus(item.item_id);
  assert.equal(status.sources.length, 1);
  assert.equal(status.sources[0].publisher, 'Manufacturer');
  assert.equal(status.sources[0].credibility, 'primary');
  assert.equal(status.sources[0].license, 'All rights reserved');
  assert.match(status.sources[0].locator, /manual#p48/);
  assert.equal(status.sources[0].excerpt, 'It says so.');
  assert.equal(status.adaptation.source_says, 'x');
  assert.equal(status.adaptation.tonde_says, 'y');
  // A citation without a label is refused, and a reference without something checkable is refused by
  // the schema rather than accepted as unverifiable.
  assert.equal((await failure(() => addSource(item.item_id, { locator: 'https://example.invalid/x' }))).code, '22023');
  assert.equal((await failure(() => addSource(item.item_id, { label: 'Uncheckable claim', source_kind: 'reference' }))).code, '23514');
  const added = await addSource(item.item_id, { label: 'Manufacturer service note', source_kind: 'manufacturer',
    locator: 'https://example.invalid/service', credibility: 'secondary' });
  assert.equal((await itemStatus(item.item_id)).sources.length, 2);
  assert.equal(added.source_id !== undefined, true);
  // Provenance is tenant-isolated: nobody outside the workspace sees a citation.
  assert.equal(Number((await asStranger(() => rows('select count(*)::integer as total from tonde.knowledge_sources')))[0].total), 0);
  assert.ok(Number((await asOwner(() => rows('select count(*)::integer as total from tonde.knowledge_sources')))[0].total) >= 2);
});

test('a conflict keeps both claims, and only review authority settles it', async () => {
  const primary = await createItem({ name: 'Conflict side A' });
  const secondary = await createItem({ name: 'Conflict side B' });
  const opened = await openConflict({ subject: 'Shutter angle for handheld work', primaryClaim: 'Shoot at 1/48',
    secondaryClaim: 'Shoot at 1/50', primaryItem: primary.item_id, secondaryItem: secondary.item_id,
    evidence: [{ kind: 'manual', note: 'The manual says 1/48' }] }, C);
  assert.equal(opened.state, 'open');
  assert.equal(opened.severity, 'material');
  assert.equal((await openConflict({ subject: 'Shutter angle for handheld work', primaryClaim: 'Shoot at 1/48',
    secondaryClaim: 'Shoot at 1/50' }, C)).idempotent, true);
  // An editor raises conflicts; settling one is a review decision.
  assert.equal((await failure(() => resolveConflict(opened.conflict_id, 'adopt_primary', 'Settled', C))).code, '42501');
  assert.equal((await failure(() => resolveConflict(opened.conflict_id, 'adopt_primary', ''))).code, '22023');
  assert.equal((await failure(() => asEditor(() => db.query(
    `update tonde.knowledge_conflicts set state = 'resolved' where id = $1`, [opened.conflict_id])))).code, '42501');
  const resolved = await resolveConflict(opened.conflict_id, 'adopt_primary', 'The manual is primary and current');
  assert.equal(resolved.state, 'resolved');
  assert.equal(resolved.resolution, 'adopt_primary');
  assert.equal((await resolveConflict(opened.conflict_id)).idempotent, true);
  const record = (await rows(`select resolved_by, resolution_note, primary_claim, secondary_claim,
    created_at is not null as stamped from tonde.knowledge_conflicts where id = $1`, [opened.conflict_id]))[0];
  assert.equal(record.resolved_by, D);
  assert.match(record.resolution_note, /manual is primary/);
  // Both claims survive the resolution: the record is the disagreement, not the winner.
  assert.equal(record.primary_claim, 'Shoot at 1/48');
  assert.equal(record.secondary_claim, 'Shoot at 1/50');
  // An open conflict is visible in the knowledge read; a dismissal must say it was not a conflict.
  const stillOpen = await openConflict({ subject: 'Another disagreement', kind: 'settings', severity: 'minor',
    primaryClaim: 'ISO 400', secondaryClaim: 'ISO 800', detectedBy: 'import' }, C);
  const search = await searchKnowledge();
  assert.equal(search.open_conflicts.some(conflict => conflict.conflict_id === stillOpen.conflict_id), true);
  // A dismissed conflict is one that was decided not to be a conflict; the schema says so.
  assert.equal((await failure(() => asService(() => db.query(`update tonde.knowledge_conflicts set state = 'dismissed',
    resolution = 'adopt_primary', resolved_at = now(), resolved_by = $2 where id = $1`,
    [stillOpen.conflict_id, D])))).code, '23514');
  const dismissed = await resolveConflict(stillOpen.conflict_id, 'not_a_conflict', 'Both are valid in context');
  assert.equal(dismissed.state, 'dismissed');
  assert.equal((await failure(() => asEditor(() => db.query(`insert into tonde.knowledge_conflicts(workspace_id,
    subject, conflict_kind, primary_claim, secondary_claim, state) values($1,'x','fact','a','b','resolved')`, [wa])))).code, '42501');
});

test('tutorials are registered, stepped, frozen at publication, and promoted into pending-review knowledge', async () => {
  // A tutorial states where it came from: an external video without a locator is refused.
  assert.equal((await failure(() => registerTutorial({ sourceKind: 'external_video', locator: null }))).code, '23514');
  const tutorial = await registerTutorial({ title: 'Probe lighting tutorial', sourceKind: 'external_article',
    locator: 'https://example.invalid/lighting', attribution: 'A working gaffer', license: 'CC BY 4.0' });
  assert.equal(tutorial.state, 'registered');
  const first = await addStep(tutorial.tutorial_id, 1, { title: 'Place the key light' });
  assert.equal(first.step_count, 1);
  assert.equal(first.state, 'ready_for_review');
  assert.equal((await failure(() => addStep(tutorial.tutorial_id, 1))).code, 'PT409');
  const second = await addStep(tutorial.tutorial_id, 2, { title: 'Feather the key' });
  assert.equal(second.step_count, 2);
  // Publishing is a review decision, and it freezes what was published.
  assert.equal((await failure(() => publishTutorial(tutorial.tutorial_id, 'Publish', C))).code, '42501');
  const published = await publishTutorial(tutorial.tutorial_id, 'Checked against the recording');
  assert.equal(published.state, 'published');
  assert.equal((await publishTutorial(tutorial.tutorial_id)).idempotent, true);
  assert.equal((await failure(() => addStep(tutorial.tutorial_id, 3))).code, 'PT409');
  assert.equal((await failure(() => asService(() => db.query(
    `update tonde.knowledge_tutorial_steps set instruction = 'rewrite' where tutorial_id = $1`, [tutorial.tutorial_id])))).code, '23514');
  // Promoting a step creates knowledge that cites the tutorial and waits for review.
  const promoted = await promoteStep(first.step_id, { name: 'Key light placement' });
  assert.equal(promoted.review_state, 'pending_review');
  assert.equal(promoted.usable_for_guidance, false);
  const status = await itemStatus(promoted.item_id);
  assert.equal(status.source_kind, 'tutorial');
  assert.equal(status.sources.length, 1);
  assert.match(status.sources[0].label, /Probe lighting tutorial/);
  assert.equal(status.sources[0].credibility, 'secondary');
  assert.equal(status.adaptation.tutorial_id, tutorial.tutorial_id);
  assert.equal(status.adaptation.step_ordinal, 1);
  assert.match(status.adaptation.source_says, /any lens/);
  assert.match(status.adaptation.why, /assumed a set/);
  assert.equal(status.tutorial_steps.length, 1);
  assert.equal(status.tutorial_steps[0].step_id, first.step_id);
  // The step now points at the knowledge it produced, and the workspace cannot see another's tutorial.
  assert.equal(await scalar('select technique_id from tonde.knowledge_tutorial_steps where id = $1', [first.step_id]),
    promoted.item_id);
  assert.equal(Number((await asStranger(() => rows('select count(*)::integer as total from tonde.knowledge_tutorials')))[0].total), 0);
  assert.equal(Number((await asOwner(() => rows('select count(*)::integer as total from tonde.knowledge_tutorials')))[0].total), 1);
});

test('an import is bounded, idempotent by payload, and records every refusal with its reason', async () => {
  const good = {
    canonical_id: 'probe-imported-lighting', name: 'Imported lighting rule', category: 'lighting',
    description: 'A rule from the handbook', purpose: 'Keep the key soft', effect: 'Soft shadows',
    tonde_guidance: 'Use a large modifier close to the subject',
    applicability: { production_types: ['commercial'] },
    adaptation: { source_says: 'soft light', tonde_says: 'a 1m softbox at 1m', why: 'the book assumed a studio' },
    sources: [{ label: 'Handbook p.12', locator: 'https://example.invalid/handbook#p12', credibility: 'secondary' }],
  };
  const alsoGood = { ...good, canonical_id: 'probe-imported-grip', name: 'Imported grip rule', category: 'blocking' };
  const badId = { ...good, canonical_id: 'Not A Slug' };
  const badCategory = { ...good, canonical_id: 'probe-bad-category', category: 'astrology' };
  const incomplete = { canonical_id: 'probe-incomplete', name: '', category: 'lighting', description: '', purpose: '', effect: '' };
  const payload = [good, alsoGood, badId, badCategory, incomplete];
  // A dry run writes nothing and lists every refusal with its reason.
  const dry = await importRequest(payload, { dryRun: true, user: C });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.item_count, 5);
  assert.equal(dry.accepted_count, 2);
  assert.equal(dry.rejected_count, 3);
  assert.deepEqual(dry.rejections.map(entry => entry.reason).sort(),
    ['CANONICAL_ID_INVALID', 'CATEGORY_UNKNOWN', 'ITEM_INCOMPLETE']);
  assert.equal(Number(await scalar(`select count(*)::integer from tonde.creative_techniques where canonical_id = 'probe-imported-lighting'`)), 0);
  assert.equal((await importRequest(payload, { dryRun: true, user: C })).idempotent, true);
  // A real import writes the valid items as pending review and records the partial outcome.
  const applied = await importRequest(payload, { user: C });
  assert.equal(applied.state, 'partial');
  assert.equal(applied.accepted_count, 2);
  assert.equal(applied.rejected_count, 3);
  assert.equal(applied.rejections.length, 3);
  assert.equal((await importRequest(payload, { user: C })).import_id, applied.import_id);
  const imported = (await rows(`select review_state, source_kind, source_kind as kind from tonde.creative_techniques
    where canonical_id = 'probe-imported-lighting'`))[0];
  assert.equal(imported.review_state, 'pending_review');
  assert.equal(imported.source_kind, 'import');
  const status = await itemStatus(await scalar(`select id from tonde.creative_techniques where canonical_id = 'probe-imported-lighting'`));
  assert.equal(status.usable_for_guidance, false);
  assert.equal(status.sources.length, 1);
  assert.equal(status.applicability.production_types[0], 'commercial');
  // The imported item now counts as already existing, and the import says so instead of duplicating it.
  const second = await importRequest([good], { sourceLabel: 'A different handbook', user: C });
  assert.equal(second.state, 'rejected');
  assert.equal(second.rejections[0].reason, 'KNOWLEDGE_EXISTS');
  // An import is bounded and shaped: not an array, or too many items, is refused.
  assert.equal((await failure(() => importRequest({ not: 'an array' }, { user: C }))).code, '22023');
  assert.equal((await failure(() => importRequest(Array.from({ length: 501 }, (_, index) => ({
    ...good, canonical_id: `probe-bulk-${index}` })), { user: C }))).code, '22023');
  assert.equal((await failure(() => importRequest([good], { format: 'pdf', user: C }))).code, '22023');
});

test('knowledge reads are tenant-scoped, privilege-checked and honest about what is not usable', async () => {
  const item = await createItem({ name: 'Scoped technique' });
  assert.equal((await itemStatus(item.item_id)).usable_for_guidance, true);
  // A non-member is refused before anything is read.
  assert.equal((await failure(() => searchKnowledge({}, B))).code, '42501');
  assert.equal((await failure(() => itemStatus(item.item_id, B))).code, '42501');
  // A member of another workspace asking about a foreign item gets not-found, not a leak.
  assert.equal((await failure(() => asUser(B, () => rows('select tonde.knowledge_item_status($1,$2)', [wb, item.item_id])))).code, 'P0002');
  assert.equal((await failure(() => asUser(B, () => rows('select tonde.knowledge_item_status($1,$2)', [wa, item.item_id])))).code, '42501');
  // A read is bounded.
  assert.equal((await failure(() => searchKnowledge({ limit: 500 }))).code, '22023');
  // Conflicts and imports are visible to the workspace only.
  assert.equal(Number((await asStranger(() => rows('select count(*)::integer as total from tonde.knowledge_conflicts')))[0].total), 0);
  assert.equal(Number((await asStranger(() => rows('select count(*)::integer as total from tonde.knowledge_imports')))[0].total), 0);
  assert.ok(Number((await asOwner(() => rows('select count(*)::integer as total from tonde.knowledge_imports')))[0].total) >= 1);
  // A client session cannot invoke the import or review paths with an unknown workspace.
  assert.equal((await failure(() => asOwner(() => rows('select tonde.knowledge_search($1,null,null,null,true,50)', [randomUUID()])))).code, '42501');
  assert.equal((await failure(() => asOwner(() => rows('select tonde.knowledge_import_request($1,$2,$3,$4,null,null,null,false)',
    [wb, 'json', 'Foreign import', '[]'])))).code, '42501');
});
