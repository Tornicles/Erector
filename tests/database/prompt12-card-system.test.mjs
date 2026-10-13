// Card direction system (migration 052): the Card is the canonical Scene, so the direction write
// path is the existing guarded Scene write path plus one guarded RPC. This runs real PostgreSQL
// through PGlite and checks the authority, lock, revision, validation and tenant rules.
import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

let db;
const owner = '00000000-0000-4000-8000-000000000001';
const outsider = '00000000-0000-4000-8000-000000000002';
const viewer = '00000000-0000-4000-8000-000000000003';
let workspace, production, card;

const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function asRole(role, identity, operation) {
  await db.exec(`begin; set local role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [identity]);
  await db.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
  try {
    const data = await operation();
    await db.exec('commit');
    return data;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}
const owner_ = operation => asRole('authenticated', owner, operation);
const viewer_ = operation => asRole('authenticated', viewer, operation);
const outsider_ = operation => asRole('authenticated', outsider, operation);

const DIRECTION = {
  title: 'The Empty Street',
  purpose: 'Maya discovers the city is empty.',
  starts_from: 'Maya exits the apartment building.',
  ends_with: 'Maya hears a metallic sound and turns.',
  story_change: 'ordinary quiet to undeniable danger',
  summary: 'Maya exits into a street that should be busy but is empty.',
  what_happens: 'She walks four steps, slows, stops and turns toward a metallic sound.',
  director_direction: 'Confusion first, then fear. Do not play the turn as a scare.',
  audience_feeling: 'Exposed, uneasy, suddenly alert.',
  subject_direction: 'Walk normally for four steps, then slow without looking around.',
  camera_direction: 'Phone main 1x, vertical 9:16, eye level, seven metres from the final mark.',
  look_direction: 'Muted early-morning daylight, soft key from behind-right, no horror light.',
  audio_direction: 'Footsteps and clean street tone, metallic cue recorded separately.',
  location_direction: 'Long street with real depth and low pedestrian traffic.',
  continuity: 'Dark green jacket closed, backpack right shoulder, Maya ends facing camera-left.',
  resources: 'Maya, phone camera, backpack, jacket, quiet street.',
  next_action: 'Open Shot 03A and capture the street master.',
};

const write = (direction = DIRECTION, options = {}) => owner_(() => db.query(
  `select tonde.card_direction_write($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9) as saved`,
  [workspace, production, card, JSON.stringify(direction), options.mode ?? 'hybrid',
    JSON.stringify(options.provenance ?? { title: { source_type: 'director', confidence: 0.8 } }),
    JSON.stringify(options.validation ?? { ready: true }),
    options.generatedBy ?? 'director', options.expectedRevision ?? null]));

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user) $$;
    grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;`);
  const files = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  for (const id of [owner, outsider, viewer]) await db.query('insert into auth.users(id) values($1)', [id]);
  workspace = await owner_(() => scalar('select tonde.bootstrap_workspace()'));
  production = await owner_(() => scalar(
    "select tonde.create_project_with_production($1,'Card system production','short_film')", [workspace]));
  card = await owner_(() => scalar(
    "insert into tonde.scenes(workspace_id,production_id,title,purpose) values($1,$2,'The Empty Street','Maya discovers the city is empty.') returning id",
    [workspace, production]));
  await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
    [workspace, viewer]);
});

after(async () => { await db.close(); });

test('a Card direction is written onto the canonical Card row', async () => {
  const rows = await write();
  assert.equal(rows.rows.length, 1);
  const saved = rows.rows[0].saved;
  assert.equal(saved.card_mode, 'hybrid');
  assert.equal(saved.card_generated_by, 'director');
  assert.equal(saved.card_direction.title, 'The Empty Street');
  assert.equal(saved.revision, 2);
  const stored = await owner_(() => scalar(
    'select card_direction->>$1 from tonde.scenes where id=$2', ['next_action', card]));
  assert.equal(stored, DIRECTION.next_action);
});

test('the Card keeps real revision history in object_versions', async () => {
  const versions = await owner_(() => scalar(
    'select count(*) from tonde.object_versions where object_id=$1', [card]));
  assert.ok(Number(versions) >= 2);
});

test('a stale write is refused with PT409 instead of overwriting', async () => {
  await assert.rejects(
    () => write(DIRECTION, { expectedRevision: 1 }),
    error => error.message.includes('changed since you loaded it') && error.code === 'PT409');
});

test('a locked Card refuses a direction change and says how to proceed', async () => {
  await owner_(() => db.query('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)',
    [workspace, production, 'scene', card, true, null]));
  await assert.rejects(
    () => write(DIRECTION),
    error => /locked/i.test(error.message) && error.code === 'PT409');
  await owner_(() => db.query('select tonde.set_studio_lock($1,$2,$3,$4,$5,$6)',
    [workspace, production, 'scene', card, false, null]));
});

test('editing an approved Card is recorded as changed_after_approval', async () => {
  await owner_(() => db.query('select tonde.set_studio_approval($1,$2,$3,$4,$5,$6)',
    [workspace, production, 'scene', card, 'approved', null]));
  // A real content edit, not a re-save of the same values: an approved Card that is genuinely
  // changed can no longer claim to still be approved.
  const rows = await write({ ...DIRECTION, next_action: 'Open Shot 03B and hold the beat longer.' });
  assert.equal(rows.rows[0].saved.approval, 'changed_after_approval');
  assert.equal(rows.rows[0].saved.card_direction.next_action,
    'Open Shot 03B and hold the beat longer.');
  await owner_(() => db.query('select tonde.set_studio_approval($1,$2,$3,$4,$5,$6)',
    [workspace, production, 'scene', card, 'draft', null]));
});

test('an unsupported mode is a rejected request, not a stored value', async () => {
  await assert.rejects(
    () => write(DIRECTION, { mode: 'documentary' }),
    error => error.message.includes('Unsupported Card mode') && error.code === '22023');
});

test('a direction without a title is refused', async () => {
  await assert.rejects(
    () => write({ ...DIRECTION, title: '' }),
    error => error.message.includes('needs a title') && error.code === '22023');
});

test('a non-object direction is refused', async () => {
  await assert.rejects(
    () => owner_(() => db.query(
      'select tonde.card_direction_write($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9)',
      [workspace, production, card, JSON.stringify([]), 'real', '{}', '{}', 'director', null])),
    error => error.code === '22023');
});

test('a runaway section is refused so a Card cannot become a manual', async () => {
  await assert.rejects(
    () => write({ ...DIRECTION, what_happens: 'x'.repeat(6001) }),
    error => /too long to store/.test(error.message) && error.code === '22023');
});

test('a non-member cannot read or write another creator Card direction', async () => {
  const leaked = await outsider_(() => db.query(
    'select card_direction from tonde.scenes where id=$1', [card]));
  assert.equal(leaked.rows.length, 0);
  await assert.rejects(() => asRole('authenticated', outsider, () => db.query(
    'select tonde.card_direction_write($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9)',
    [workspace, production, card, JSON.stringify(DIRECTION), 'hybrid', '{}', '{}', 'director', null])));
});

test('a viewer cannot write the Card direction', async () => {
  await assert.rejects(() => viewer_(() => db.query(
    'select tonde.card_direction_write($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9)',
    [workspace, production, card, JSON.stringify(DIRECTION), 'hybrid', '{}', '{}', 'director', null])));
});

test('an archived Card cannot receive direction', async () => {
  await owner_(() => db.query('select tonde.archive_studio_scene($1,$2,$3,$4,$5)',
    [workspace, production, card, null, false]));
  await assert.rejects(
    () => write(DIRECTION),
    error => /archived/i.test(error.message));
});
