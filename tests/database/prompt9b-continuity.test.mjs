import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 9B continuity engine (additive migration 020). Real embedded PostgreSQL.
// This proves the temporal model (a state is declared at a point in Production order and changes
// are declared, not inferred), the deterministic rules, the lock interaction, that history is kept
// when a statement is superseded, that a check is a recorded analysis which can go out of date,
// that resolving a finding never rewrites a statement, and workspace isolation.
// No AI is involved: inferred proposals are written explicitly and can never claim an observation.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, film, secondFilm, sceneFour, sceneFive, s12, s13, s14, s15, marcus, outsider;
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
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };
const sceneId = async (production, title) => asEditor(() => scalar(
  'select (tonde.create_studio_scene($1,$2,$3,$4)->>\'scene_id\')::uuid',
  [wa, production, null, JSON.stringify({ title, duration_ms: 20000 })]));
const shotId = async (production, scene, title) => asEditor(() => scalar(
  'select (tonde.create_studio_shot($1,$2,$3,$4,$5)->>\'shot_id\')::uuid',
  [wa, production, scene, null, JSON.stringify({ title, duration_ms: 4000 })]));
const setState = payload => asEditor(() => scalar(
  'select tonde.continuity_state_set($1,$2,$3)', [wa, film, JSON.stringify(payload)]));
const runCheck = (note = '') => asEditor(() => scalar(
  'select tonde.continuity_check($1,$2,$3)', [wa, film, note]));
const findingList = (state = null, severity = null, check = null) => asEditor(() => scalar(
  'select tonde.continuity_finding_list($1,$2,$3,$4,$5,$6,$7)', [wa, film, state, severity, check, 100, 0]));
const chain = (subject, domain = null, trait = null) => asEditor(() => scalar(
  'select tonde.continuity_chain($1,$2,$3,$4,$5)', [wa, film, subject, domain, trait]));
const summary = () => asEditor(() => scalar('select tonde.continuity_summary($1,$2)', [wa, film]));
const stateList = (includeRetired = false) => asEditor(() => scalar(
  'select tonde.continuity_state_list($1,$2,$3,$4,$5,$6,$7)', [wa, film, null, null, includeRetired, 200, 0]));
const updateFinding = (id, state, note = '') => asEditor(() => scalar(
  'select tonde.continuity_finding_update($1,$2,$3,$4,$5)', [wa, film, id, state, note]));
const recordProposal = payload => asEditor(() => scalar(
  'select tonde.continuity_finding_record($1,$2,$3)', [wa, film, JSON.stringify(payload)]));
const retireState = (id, reason = '') => asEditor(() => scalar(
  'select tonde.continuity_state_retire($1,$2,$3,$4)', [wa, film, id, reason]));
const withKind = (result, kind) => result.findings.filter(item => item.kind === kind);

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
  wa = await asUser(A, () => scalar('select tonde.bootstrap_workspace()'));
  wb = await asUser(B, () => scalar('select tonde.bootstrap_workspace()'));
  film = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Marquee film', 'short_film']));
  secondFilm = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)', [wa, 'Second film', 'short_film']));
  sceneFour = await sceneId(film, 'Scene 4 Kitchen');
  sceneFive = await sceneId(film, 'Scene 5 Street');
  s12 = await shotId(film, sceneFour, 'Shot 12');
  s13 = await shotId(film, sceneFour, 'Shot 13');
  s14 = await shotId(film, sceneFive, 'Shot 14');
  s15 = await shotId(film, sceneFive, 'Shot 15');
  marcus = await asEditor(() => scalar(
    `insert into tonde.assets(workspace_id, asset_type, name, description) values ($1,'character','Marcus','Wardrobe established in Scene 4') returning id`,
    [wa]));
  outsider = await asOther(() => scalar(
    `insert into tonde.assets(workspace_id, asset_type, name, description) values ($1,'character','Other','Belongs to another workspace') returning id`,
    [wb]));
});

after(async () => { await db?.close(); });

test('§28 a continuity statement is structured state, and an unknown vocabulary code is rejected', async () => {
  const opening = await setState({ domain: 'character', subject_object_id: marcus, trait: 'shirt condition',
    anchor: 'scene_opening', scene_id: sceneFour, value: 'clean shirt', transition: 'baseline', reason: 'First appearance.' });
  assert.equal(opening.updated, false);
  const stored = await rows('select domain, anchor, value, transition, origin, retired_at from tonde.continuity_states where id = $1', [opening.state_id]);
  assert.equal(stored[0].domain, 'character');
  assert.equal(stored[0].anchor, 'scene_opening');
  assert.equal(stored[0].value, 'clean shirt');
  assert.equal(stored[0].origin, 'declared');
  assert.equal(stored[0].retired_at, null, 'the statement is live');

  const badDomain = await failure(() => setState({ domain: 'vibes', trait: 'shirt condition', value: 'x' }));
  assert.equal(badDomain.code, '22023');
  const badAnchor = await failure(() => setState({ domain: 'character', trait: 'x', value: 'y', anchor: 'shot', shot_id: s15, transition: 'nope' }));
  assert.equal(badAnchor.code, '22023');
  const noTrait = await failure(() => setState({ domain: 'character', value: 'y' }));
  assert.equal(noTrait.code, '22023');
});

test('§27 a different value at the same point supersedes the statement and keeps the old one readable', async () => {
  const superseding = await setState({ domain: 'character', subject_object_id: marcus, trait: 'shirt condition',
    anchor: 'scene_opening', scene_id: sceneFour, value: 'torn shirt', transition: 'changed',
    reason: 'Marcus is already bruised when the scene opens.' });
  assert.ok(superseding.superseded_state_id, 'the previous statement at this point is superseded');
  const history = await rows('select value, retired_at, retire_reason from tonde.continuity_states where id = $1', [superseding.superseded_state_id]);
  assert.equal(history[0].value, 'clean shirt', 'the superseded statement is still readable');
  assert.ok(history[0].retired_at, 'it is retired, not deleted');
  assert.match(history[0].retire_reason, /Superseded/);
  const all = await stateList(true);
  assert.equal(all.items.some(item => item.state_id === superseding.superseded_state_id && item.retired), true);
  const live = await stateList(false);
  assert.equal(live.items.filter(item => item.trait === 'shirt condition').length, 1, 'one live statement per trait per point');
});

test('§28 declarations that agree are consistent, and the limitation is stated rather than implied', async () => {
  const result = await runCheck('First pass.');
  // One declaration that is a declared change, with nothing after it recorded, is consistent
  // rather than a conflict: the only finding says the trait is unknown from there on.
  assert.equal(result.verdict, 'consistent');
  assert.equal(result.counts.live_states, 1);
  assert.equal(result.findings.every(item => item.severity === 'info'), true);
  assert.equal(withKind(result, 'unverified_after').length, 1);
  assert.match(result.limitations, /does not analyse media/);
  assert.match(result.explanation, /unknown rather than consistent/);
});

test('§27 an undeclared change across a Scene boundary is a continuity conflict', async () => {
  await setState({ domain: 'character', subject_object_id: marcus, trait: 'shirt condition',
    anchor: 'scene_ending', scene_id: sceneFour, value: 'blood on the left shoulder', transition: 'changed',
    reason: 'Marcus is injured during the kitchen scene.' });
  await setState({ domain: 'character', subject_object_id: marcus, trait: 'shirt condition',
    anchor: 'scene_opening', scene_id: sceneFive, value: 'shirt clean', transition: 'continuous' });
  const result = await runCheck('After the injury.');
  const breaks = withKind(result, 'boundary_break');
  assert.equal(breaks.length, 1, 'exactly one boundary break');
  assert.equal(breaks[0].severity, 'critical');
  assert.equal(breaks[0].trait, 'shirt condition');
  assert.match(breaks[0].explanation, /blood on the left shoulder/);
  assert.match(breaks[0].explanation, /across a Scene boundary/);
  assert.match(breaks[0].suggested_resolution, /declare the change/i);
  assert.equal(breaks[0].origin, 'derived');
  assert.equal(breaks[0].epistemic, 'observed');
  assert.equal(result.verdict, 'conflict');
});

test('§27 an undeclared change inside one Scene is a caution, not a boundary conflict', async () => {
  await setState({ domain: 'wardrobe', subject_object_id: marcus, trait: 'cap',
    anchor: 'shot', shot_id: s12, value: 'cap on', transition: 'baseline' });
  await setState({ domain: 'wardrobe', subject_object_id: marcus, trait: 'cap',
    anchor: 'shot', shot_id: s13, value: 'cap off', transition: 'continuous' });
  const result = await runCheck('Cap continuity.');
  const changes = withKind(result, 'unexplained_change');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].severity, 'warning');
  assert.equal(changes[0].trait, 'cap');
  assert.equal(withKind(result, 'boundary_break').length, 1, 'the same-scene change is not reported as a boundary break');
  assert.match(changes[0].explanation, /no change was declared/);
});

test('§27 a declared change without a reason is reported so later work can be checked against it', async () => {
  await setState({ domain: 'hair_makeup', subject_object_id: marcus, trait: 'hair',
    anchor: 'shot', shot_id: s14, value: 'soaked', transition: 'changed' });
  const result = await runCheck('Hair.');
  const missing = withKind(result, 'missing_reason');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].severity, 'warning');
  assert.equal(missing[0].trait, 'hair');
  assert.match(missing[0].suggested_resolution, /why the trait changed/);
});

test('§11 a declared change to a subject the creator protected is a lock conflict', async () => {
  const lock = await asEditor(() => scalar(
    `insert into tonde.ai_continuity_locks(workspace_id, production_id, scope, subject_id, label, locked, priority)
     values ($1,$2,'character',$3,'Marcus',true,'MUST PRESERVE') returning id`, [wa, film, marcus]));
  await setState({ domain: 'wardrobe', subject_object_id: marcus, trait: 'jacket',
    anchor: 'scene_ending', scene_id: sceneFour, value: 'blue jacket', transition: 'changed', reason: 'Continuity pass.' });
  const result = await runCheck('Locked subject.');
  const conflicts = withKind(result, 'lock_conflict');
  // Every declared change to a locked subject is reported, not just the newest one.
  assert.equal(conflicts.length >= 1, true);
  assert.equal(conflicts.every(item => item.severity === 'critical' && item.subject_object_id === marcus), true);
  const jacket = conflicts.find(item => item.trait === 'jacket');
  assert.ok(jacket, 'the declared jacket change is reported');
  assert.match(jacket.explanation, /continuity lock/);
  assert.match(jacket.suggested_resolution, /unlock the scope first/i);
  assert.equal(jacket.evidence.some(item => item.kind === 'continuity_lock' && item.object_id === lock), true,
    'the conflict cites the real lock');
  assert.equal(result.verdict, 'conflict');
});

test('§27 the last declared change followed by later work reports continuity as unknown, not as consistent', async () => {
  await setState({ domain: 'injury', subject_object_id: marcus, trait: 'bandage',
    anchor: 'shot', shot_id: s12, value: 'bandaged wrist', transition: 'changed', reason: 'Applied after the stunt.' });
  const result = await runCheck('Later work.');
  const unverified = withKind(result, 'unverified_after');
  assert.equal(unverified.length >= 1, true);
  assert.equal(unverified.every(item => item.severity === 'info'), true,
    'an unknown is never promoted to a warning');
  const bandage = unverified.find(item => item.trait === 'bandage');
  assert.ok(bandage, 'each trait whose last statement is a declared change is reported');
  assert.match(bandage.suggested_resolution, /unknown after that point/);
  assert.equal(bandage.later_state_id, null, 'nothing later is invented');
});

test('§26 the timeline reads the way the film plays: opening, then Shots, then the ending', async () => {
  const result = await chain(marcus, 'character', 'shirt condition');
  assert.equal(result.statement_count, 3);
  const order = result.statements.map(item => item.value);
  assert.deepEqual(order, ['torn shirt', 'blood on the left shoulder', 'shirt clean']);
  assert.match(result.statements[0].position_label, /Scene 4 Kitchen opening/);
  assert.match(result.statements[1].position_label, /Scene 4 Kitchen ending/);
  assert.match(result.statements[2].position_label, /Scene 5 Street opening/);
  const full = await chain(marcus);
  assert.equal(full.statement_count >= 6, true, 'the whole recorded timeline of the subject is available');
  assert.equal(full.subject_label, 'Marcus');
});

test('§5 the engine is deterministic: no proposal is involved and every derived finding cites its evidence', async () => {
  const result = await runCheck('Determinism.');
  assert.equal(result.findings.length > 0, true);
  for (const item of result.findings) {
    assert.equal(item.origin, 'derived');
    assert.equal(item.epistemic, 'observed');
    assert.equal(item.evidence.length > 0, true, 'an observed finding always cites the statements it compared');
    assert.equal(item.state, 'open');
  }
  const stored = await rows('select count(*)::int as n from tonde.continuity_findings where check_id = $1 and origin <> \'derived\'', [result.check_id]);
  assert.equal(stored[0].n, 0);
});

test('§13 an inferred proposal is recorded as a proposal and can never claim an observation', async () => {
  const proposal = await recordProposal({ kind: 'unexplained_change', domain: 'wardrobe', subject_object_id: marcus,
    trait: 'shirt condition', scene_id: sceneFive, explanation: 'The wardrobe may not match the injury.',
    suggested_resolution: 'Check the Scene 5 continuity photograph.', rationale: 'Two statements disagree across the cut.',
    epistemic: 'estimated', confidence: 'low', evidence: [{ kind: 'continuity_state', object_id: s14 }] });
  assert.equal(proposal.origin, 'inferred');
  assert.equal(proposal.state, 'open');
  const listed = await findingList();
  assert.equal(listed.items.some(item => item.finding_id === proposal.finding_id && item.check_id === null), true,
    'a proposal is listed next to the check findings instead of being hidden by them');
  const claimed = await failure(() => recordProposal({ domain: 'wardrobe', explanation: 'Fabricated certainty.',
    suggested_resolution: 'x', rationale: 'y', epistemic: 'observed', evidence: [{ kind: 'note' }] }));
  assert.equal(claimed.code, '23514');
  const baseless = await failure(() => recordProposal({ domain: 'wardrobe', explanation: 'No basis.',
    suggested_resolution: 'x', rationale: 'y', epistemic: 'estimated', confidence: 'low', evidence: [] }));
  assert.equal(baseless.code, '23514');
  const noRationale = await failure(() => recordProposal({ domain: 'wardrobe', explanation: 'No rationale.',
    suggested_resolution: 'x', epistemic: 'estimated', confidence: 'low', evidence: [{ kind: 'note' }] }));
  assert.equal(noRationale.code, '22023');
});

test('§23/§24 a changed Scene makes the recorded analysis out of date, and a new statement does too', async () => {
  const fresh = await runCheck('Current check.');
  const current = await summary();
  assert.equal(current.check.check_id, fresh.check_id);
  assert.equal(current.check.is_current, true, 'a check taken from the current statements is current');
  assert.equal(current.analysis_stale, false);

  await asEditor(() => db.query('update tonde.scenes set description = $2 where id = $1', [sceneFour, 'Rearranged after the check.']));
  const afterSceneChange = await summary();
  assert.equal(afterSceneChange.analysis_stale, true, 'a Scene change invalidates the recorded analysis');
  assert.equal(afterSceneChange.check.is_current, true, 'the check itself is untouched, only marked out of date');

  await setState({ domain: 'prop', subject_object_id: marcus, trait: 'umbrella',
    anchor: 'shot', shot_id: s15, value: 'folded', transition: 'baseline' });
  const afterStatement = await summary();
  assert.equal(afterStatement.check.is_current, false, 'a new statement makes the last check out of date');
  assert.equal(afterStatement.analysis_stale, true);

  await runCheck('Recheck.');
  const rechecked = await summary();
  assert.equal(rechecked.check.is_current, true);
  assert.equal(rechecked.analysis_stale, false, 'a fresh check closes the marker it addresses');
});

test('§24 resolving a finding is a creator decision and never rewrites a statement or an approval', async () => {
  const before = await rows('select count(*)::int as n from tonde.continuity_states where workspace_id = $1 and production_id = $2', [wa, film]);
  const listed = await findingList();
  const breakFinding = listed.items.find(item => item.kind === 'boundary_break');
  assert.ok(breakFinding);
  const acknowledged = await updateFinding(breakFinding.finding_id, 'acknowledged', 'Watching the cut.');
  assert.equal(acknowledged.state, 'acknowledged');
  assert.equal(acknowledged.resolved_at, null);
  const resolved = await updateFinding(breakFinding.finding_id, 'resolved', 'Reshot the pick-up on Friday.');
  assert.equal(resolved.state, 'resolved');
  assert.ok(resolved.resolved_at, 'a resolved finding records when the creator decided');
  assert.match(resolved.resolution_note, /Reshot the pick-up/);
  const invalid = await failure(() => updateFinding(breakFinding.finding_id, 'approved', 'no'));
  assert.equal(invalid.code, '22023', 'a finding has no approved state: approval is not a finding decision');
  const after = await rows('select count(*)::int as n from tonde.continuity_states where workspace_id = $1 and production_id = $2', [wa, film]);
  assert.equal(after[0].n, before[0].n, 'no statement was added or removed by resolving a finding');
  const statements = await rows('select value, retired_at from tonde.continuity_states where id = $1', [breakFinding.later_state_id]);
  assert.equal(statements[0].value, 'shirt clean', 'the statement that caused the finding is unchanged');
  const sceneAfter = await rows('select approval from tonde.scenes where id = $1', [sceneFour]);
  assert.equal(sceneAfter[0].approval, 'draft', 'resolving a finding does not approve anything');
});

test('§5/§28 a statement may be retired without a replacement, and the record stays', async () => {
  const created = await setState({ domain: 'time_of_day', trait: 'golden hour', anchor: 'scene_ending',
    scene_id: sceneFive, value: 'sunset', transition: 'baseline' });
  const retired = await retireState(created.state_id, 'The scene was cut.');
  assert.equal(retired.retired, true);
  const stored = await rows('select retired_at, retire_reason, revision from tonde.continuity_states where id = $1', [created.state_id]);
  assert.ok(stored[0].retired_at);
  assert.match(stored[0].retire_reason, /cut/);
  assert.equal(stored[0].revision >= 1, true);
  const all = await stateList(true);
  assert.equal(all.items.some(item => item.state_id === created.state_id), true, 'retired statements remain inspectable');
  const live = await stateList(false);
  assert.equal(live.items.some(item => item.state_id === created.state_id), false);
});

test('§38 a statement cannot be anchored to another Production, and identity cannot be rewritten', async () => {
  const foreignScene = await sceneId(secondFilm, 'Other scene');
  const wrongProduction = await failure(() => setState({ domain: 'character', trait: 'x', value: 'y',
    anchor: 'scene_opening', scene_id: foreignScene }));
  assert.equal(wrongProduction.code, '22023');
  const wrongWorkspace = await failure(() => setState({ domain: 'character', subject_object_id: outsider,
    trait: 'x', value: 'y' }));
  assert.equal(wrongWorkspace.code, '22023');
  const anyState = await rows('select id from tonde.continuity_states where workspace_id = $1 and production_id = $2 limit 1', [wa, film]);
  const immutable = await failure(() => asEditor(() => db.query(
    'update tonde.continuity_states set workspace_id = $2 where id = $1', [anyState[0].id, wb])));
  assert.equal(immutable.code, '23514');
});

test('§27 Workspace B cannot read or write Workspace A continuity state', async () => {
  const readDenied = await failure(() => asOther(() => scalar('select tonde.continuity_summary($1,$2)', [wa, film])));
  assert.equal(readDenied.code, '42501');
  const listDenied = await failure(() => asOther(() => scalar(
    'select tonde.continuity_finding_list($1,$2,$3,$4,$5,$6,$7)', [wa, film, null, null, null, 10, 0])));
  assert.equal(listDenied.code, '42501');
  const chainDenied = await failure(() => asOther(() => scalar('select tonde.continuity_chain($1,$2,$3,$4,$5)', [wa, film, marcus, null, null])));
  assert.equal(chainDenied.code, '42501');
  const writeDenied = await failure(() => asOther(() => scalar('select tonde.continuity_state_set($1,$2,$3)',
    [wa, film, JSON.stringify({ domain: 'character', trait: 'x', value: 'y' })])));
  assert.equal(writeDenied.code, '42501');
  const checkDenied = await failure(() => asOther(() => scalar('select tonde.continuity_check($1,$2,$3)', [wa, film, ''])));
  assert.equal(checkDenied.code, '42501');
  // RLS itself hides the rows, so a direct table read from the other workspace returns nothing.
  const hidden = await asOther(() => scalar('select count(*)::int from tonde.continuity_states where workspace_id = $1', [wa]));
  assert.equal(hidden, 0, 'RLS hides Workspace A statements entirely');
  const owned = await asOther(() => scalar('select count(*)::int from tonde.continuity_states where workspace_id = $1', [wb]));
  assert.equal(owned, 0, 'Workspace B has no continuity statements of its own yet');
});
