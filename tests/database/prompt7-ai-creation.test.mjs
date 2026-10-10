import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 7 AI Creation & Hybrid Director persistence (additive migration 017).
// Real embedded PostgreSQL with minimal Supabase platform schemas. This does NOT
// emulate Auth HTTP, Storage HTTP, PostgREST, hosted settings or any external
// generation provider: no live generation is attempted or claimed anywhere here.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb, production, scene, character, productAsset, kitchen, styleBible, sourceMedia;
const shots = {};
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };

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
  // §123 the AI commercial fixture: one Character, a coffee Product, a kitchen World,
  // a Style Bible and six Shots, on ONE Master Production.
  production = await asEditor(() => scalar('select tonde.create_project_with_production($1,$2,$3)',
    [wa, 'Ridgeway coffee', 'commercial']));
  await asEditor(() => db.query('update tonde.productions set planned_duration_ms = 30000 where id = $1', [production]));
  const asset = (type, name, extra = {}) => asEditor(() => scalar(
    `insert into tonde.assets(workspace_id, asset_type, name, metadata) values ($1,$2,$3,$4) returning id`,
    [wa, type, name, JSON.stringify(extra)]));
  character = await asset('character', 'Barista');
  productAsset = await asset('product', 'Ridgeway bag', { fidelity: 'critical' });
  kitchen = await asset('environment', 'Kitchen');
  styleBible = await asset('style_bible', 'Slow craft');
  // The object key must live under the media row's own workspace and id, so the id is
  // chosen here rather than generated.
  sourceMedia = '00000000-0000-4000-8000-0000000000f1';
  await asEditor(() => db.query(
    `insert into tonde.media_files(id, workspace_id, bucket, object_key, original_filename, mime_type, file_category, bytes, upload_state, processing_state)
     values ($1, $2, 'tonde-asset-references', $3, 'face.png', 'image/png', 'image', 2048, 'uploaded', 'ready')`,
    [sourceMedia, wa, `${wa}/${sourceMedia}/face.png`]));
  scene = await asEditor(() => scalar('select tonde.create_studio_scene($1,$2,$3,$4)',
    [wa, production, null, JSON.stringify({ title: 'Dark kitchen', purpose: 'Earn attention' })]).then(row => row.scene_id));
  for (const [key, title, duration] of [
    ['establish', 'Establish', 5000], ['pour', 'Pour', 4000], ['label', 'Label reveal', 4000],
    ['sip', 'First sip', 5000], ['hands', 'Hands on cup', 6000], ['end', 'End card', 6000]]) {
    shots[key] = await asEditor(() => scalar('select tonde.create_studio_shot($1,$2,$3,$4,$5)',
      [wa, production, scene, null, JSON.stringify({ title, duration_ms: duration, execution_method: 'ai' })])
      .then(row => row.shot_id));
  }
});

after(async () => { await db?.close(); });

// Two declared models with opposite strengths. Neither capability claim is inferred
// from a name: both were declared for the workspace. The cheap model is text only,
// which is exactly the case routing must not send a Character-heavy Shot to.
let strongModel, cheapModel, unpricedModel;
const strongPlan = (over = {}) => ({
  plan_status: 'ready', expected_duration_ms: 5000, aspect_ratio: '9:16', generated_by: 'deterministic',
  provider_target: 'runway', model_key: 'strong-ref-v1', model_version: '2026-09',
  canonical_prompt: { subject: 'Barista pouring coffee', action: 'pours, then looks up',
    environment: 'Dark kitchen, one window', camera: 'low angle, slow push', movement: 'slow dolly push',
    lighting: 'one soft source camera left', style: 'slow craft, warm shadows',
    continuity: 'same Barista, same kitchen, same bag', negative: ['no logo distortion'] },
  provider_prompt: 'Low angle slow push as the Barista pours coffee in a dark kitchen.',
  negative_constraints: ['no logo distortion'], limitations: ['Identity is preserved as closely as the model supports.'],
  motion: { needed: true, description: 'slow dolly push, subject still', intensity: 'low' },
  audio: { needed: false },
  first_frame: { source: 'asset', asset_id: null, note: 'Character and World composite.' },
  last_frame: { source: '', note: '' },
  continuity: { must: ['character', 'kitchen', 'product'], should: ['wardrobe'], flexible: ['steam density'],
    changes: [] },
  cost_note: '', ...over,
});

// §11/§12 capability truth is only ever declared. §130 the two models differ exactly on
// image reference strength, so a Character-heavy Shot cannot route to the cheapest.
test('capability truth is declared per workspace, never inferred from a model name', async () => {
  const declared = await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)', [wa, JSON.stringify({
    provider_key: 'runway', model_key: 'strong-ref-v1', label: 'Strong reference video', operation: 'image_to_video',
    capability_state: 'SUPPORTED', modalities: ['image', 'video'], supports_image_reference: true,
    max_reference_images: 3, supports_first_frame: true, supports_last_frame: false, supports_seed: true,
    supports_negative_prompt: true, supports_camera_control: true, max_duration_ms: 10000,
    aspect_ratios: ['9:16', '16:9'], resolutions: ['1080p'], cost_unit: 'generation',
    cost_amount: 0.4, cost_currency: 'USD', availability: 'available', speed_note: 'Roughly a minute.',
    identity_note: 'Strong image-reference adherence.' }), null]));
  assert.equal(declared.capability_state, 'SUPPORTED');
  assert.equal(declared.cost_known, true);
  strongModel = declared.model_profile_id;
  cheapModel = (await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)', [wa, JSON.stringify({
    provider_key: 'flux', model_key: 'cheap-text-v1', label: 'Cheap text image', operation: 'image',
    capability_state: 'PARTIALLY SUPPORTED', supports_image_reference: false, supports_first_frame: false,
    supports_last_frame: false, max_duration_ms: null, aspect_ratios: ['9:16'],
    cost_unit: 'image', cost_amount: 0.02, cost_currency: 'USD' }), null]))).model_profile_id;
  const catalog = await asEditor(() => scalar('select tonde.ai_model_catalog($1)', [wa]));
  // TONDE knows the provider names, and it knows nothing about their capabilities.
  assert.ok(catalog.providers.some(provider => provider.provider_key === 'runway'));
  assert.ok(catalog.known_models.length === 0 || catalog.known_models.every(model => model.declared === false));
  const strong = catalog.models.find(model => model.model_profile_id === strongModel);
  // Three separate facts.
  assert.equal(strong.declared, true);
  assert.equal(strong.known, true);
  assert.equal(strong.connected, false);
  assert.equal(strong.capability_state, 'SUPPORTED');
  assert.equal(strong.supports_image_reference, true);
  assert.equal(strong.supports_last_frame, false);
  // A capability claim must come from a declaration.
  const unbacked = await failure(() => asEditor(() => db.query(
    `insert into tonde.ai_model_profiles(workspace_id, provider_key, model_key, operation, capability_state, source)
     values ($1,'kling','unbacked-v1','video','SUPPORTED','catalog')`, [wa])));
  assert.equal(unbacked.code, '23514');
  // Cost is known only when an amount and a currency were both given.
  const noPrice = await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)', [wa, JSON.stringify({
    provider_key: 'kling', model_key: 'unpriced-v1', operation: 'video', capability_state: 'UNKNOWN' }), null]));
  assert.equal(noPrice.cost_known, false);
  assert.equal(noPrice.cost_amount, null);
  unpricedModel = noPrice.model_profile_id;
});

test('a connection is a reference, and never a stored credential', async () => {
  const connected = await asEditor(() => scalar('select tonde.set_ai_connection($1,$2,$3,$4,$5,$6)',
    [wa, 'runway', 'connected', 'setup: runway account (creator device)', 'Declared in Setup.', null]));
  assert.equal(connected.state, 'connected');
  const leaked = await failure(() => asEditor(() => scalar('select tonde.set_ai_connection($1,$2,$3,$4,$5,$6)',
    [wa, 'kling', 'connected', 'sk-live-abcdef123456', '', null])));
  assert.equal(leaked.code, '22023');
  assert.match(leaked.message, /never the credential/);
  const unknown = await failure(() => asEditor(() => scalar('select tonde.set_ai_connection($1,$2,$3,$4,$5,$6)',
    [wa, 'not-a-provider', 'connected', '', '', null])));
  assert.equal(unknown.code, '22023');
});

// §20–§24, §93 the plan carries the canonical prompt, the provider prompt and provenance.
test('an AI plan compiles a canonical prompt, a provider prompt and provenance', async () => {
  const saved = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production,
    shots.establish, null, JSON.stringify(strongPlan({ model_profile_id: strongModel })), JSON.stringify([
      { role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset', note: 'One good reference is enough.' },
      { role: 'environment', priority: 'MUST PRESERVE', asset_id: kitchen, origin: 'asset' },
      { role: 'product', priority: 'SHOULD PRESERVE', asset_id: productAsset, origin: 'asset' },
    ]), null]));
  assert.equal(saved.prompt_version, 1);
  // The prompt records the Shot revision it was compiled against.
  assert.equal(saved.source_shot_revision, 1);
  assert.equal(saved.references, 3);
  assert.equal(saved.readiness, 'ready_to_generate');
  const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.establish]));
  assert.equal(detail.plan.canonical_prompt.subject, 'Barista pouring coffee');
  assert.equal(detail.plan.canonical_prompt.camera, 'low angle, slow push');
  assert.equal(detail.plan.provider_prompt.startsWith('Low angle slow push'), true);
  assert.equal(detail.plan.prompt_stale, false);
  assert.deepEqual(detail.plan.negative_constraints, ['no logo distortion']);
  assert.equal(detail.references.length, 3);
  assert.equal(detail.references.find(item => item.role === 'face').asset_name, 'Barista');
  assert.equal(detail.references.find(item => item.role === 'face').priority, 'MUST PRESERVE');
  // One canonical prompt, one provider prompt: retargeting changes the provider half only.
  assert.equal(detail.plan.model_profile.model_key, 'strong-ref-v1');
  assert.equal(detail.plan.connection.state, 'connected');
});

// §124 one reference image is enough. §126/§127 World and Product stay specified.
test('one Character reference is enough, and World and Product carry across Shots', async () => {
  for (const key of ['pour', 'label']) {
    await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production, shots[key], null,
      JSON.stringify(strongPlan({ model_profile_id: strongModel, continuity: {
        must: ['character', 'kitchen', 'product'], should: [], flexible: [], changes: [] } })),
      JSON.stringify([
        { role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' },
        { role: 'environment', priority: 'MUST PRESERVE', asset_id: kitchen, origin: 'asset' },
        { role: 'product', priority: 'MUST PRESERVE', asset_id: productAsset, origin: 'asset' },
      ]), null]));
  }
  for (const key of ['establish', 'pour', 'label']) {
    const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots[key]]));
    assert.equal(detail.readiness, 'ready_to_generate', key);
    const roles = detail.references.map(item => item.role).sort();
    assert.deepEqual(roles, ['environment', 'face', 'product'], key);
    // The World and Product constraints are identical Shot to Shot.
    assert.deepEqual(detail.plan.continuity.must, ['character', 'kitchen', 'product'], key);
  }
});

// §110/§111 readiness is derived from explicit facts. Missing MUST references block it.
test('readiness reports a missing required reference rather than a score', async () => {
  // Only the World reference is required here, so the Shot is ready.
  await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production, shots.sip, null,
    JSON.stringify(strongPlan({ model_profile_id: strongModel })), JSON.stringify([
      { role: 'environment', priority: 'MUST PRESERVE', asset_id: kitchen, origin: 'asset' },
    ]), null]));
  const onlyWorld = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.sip]));
  assert.equal(onlyWorld.readiness, 'ready_to_generate');
  // Marking the Character reference required without attaching anything blocks it.
  // A required reference held as uploaded media counts too, and a SHOULD reference
  // that is not held does not block readiness.
  await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production, shots.sip, null,
    JSON.stringify(strongPlan({ model_profile_id: strongModel })), JSON.stringify([
      { role: 'face', priority: 'MUST PRESERVE', media_id: sourceMedia, origin: 'upload' },
      { role: 'environment', priority: 'SHOULD PRESERVE', asset_id: kitchen, origin: 'asset' },
    ]), null]));
  const withMedia = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.sip]));
  assert.equal(withMedia.readiness, 'ready_to_generate');
  // A required reference that names nothing is refused outright rather than silently held.
  const empty = await failure(() => asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.sip, null, JSON.stringify(strongPlan({ model_profile_id: strongModel })),
      JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE' }]), null])));
  assert.equal(empty.code, '23514');
});

// §128/§129/§45 First and Last Frame truth. The strong model has no last frame, and
// TONDE must say so instead of exposing a control that does nothing.
test('First Frame is used when supported and Last Frame is refused when it is not', async () => {
  const first = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production,
    shots.hands, null, JSON.stringify(strongPlan({ model_profile_id: strongModel,
      first_frame: { source: 'storyboard', asset_id: null, note: 'Frame 2 of the storyboard.' } })),
    JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' },
      { role: 'storyboard', priority: 'SHOULD PRESERVE', media_id: sourceMedia, origin: 'storyboard' }]), null]));
  assert.equal(first.readiness, 'ready_to_generate');
  const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.hands]));
  assert.equal(detail.plan.first_frame.source, 'storyboard');
  assert.equal(detail.plan.model_profile.supports_first_frame, true);
  // The same Shot asking for a Last Frame on a model that has none is unsupported.
  const last = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production,
    shots.hands, null, JSON.stringify(strongPlan({ model_profile_id: strongModel,
      last_frame: { source: 'target', note: 'End on the empty cup.' } })),
    JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null]));
  assert.equal(last.readiness, 'unsupported');
  const detail2 = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.hands]));
  assert.equal(detail2.plan.last_frame.source, 'target');
  // Truth is reported, not silently dropped: the capability says no.
  assert.equal(detail2.plan.model_profile.supports_last_frame, false);
  const refused = await failure(() => asEditor(() => scalar('select tonde.create_ai_attempt($1,$2,$3,$4)',
    [wa, production, shots.hands, JSON.stringify({ idempotency_key: 'last-frame-attempt-1', mode: 'manual',
      provider_key: 'manual', model_profile_id: strongModel, operation: 'image_to_video' })])));
  assert.equal(refused.code, '23514');
  assert.match(refused.message, /does not accept one|cannot do this/);
  // And a live submission on an unsupported plan is refused before anything is submitted.
  const live = await failure(() => asEditor(() => scalar('select tonde.create_ai_attempt($1,$2,$3,$4)',
    [wa, production, shots.hands, JSON.stringify({ idempotency_key: 'last-frame-live-1', mode: 'live',
      status: 'submitted', provider_key: 'runway', model_profile_id: strongModel })])));
  assert.equal(live.code, '23514');
  assert.match(live.message, /cannot do this Shot/);
});

// §130 the Model Router ranks on declared facts, so identity work never lands on the
// cheapest text-only model. The database supplies the verdict the engine must honour.
test('a Character-heavy Shot is not routed to the cheapest text-only model', async () => {
  await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production, shots.pour, null,
    JSON.stringify(strongPlan({ model_profile_id: strongModel })), JSON.stringify([
      { role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' },
      { role: 'environment', priority: 'MUST PRESERVE', asset_id: kitchen, origin: 'asset' },
    ]), null]));
  // The private helper is not reachable from the API, so the verdict is read through the
  // public catalogue and the computed readiness instead.
  const reachable = await failure(() => asEditor(() => scalar(
    'select tonde_private.ai_capability_check($1,$2,$3,$4)', [wa, strongModel, production, shots.pour])));
  assert.equal(reachable.code, '42501');
  const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.pour]));
  assert.equal(detail.plan.model_profile.supports_image_reference, true);
  // The cheaper text-only model cannot carry the required reference: storing it is refused.
  const refused = await failure(() => asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.pour, null, JSON.stringify(strongPlan({ model_profile_id: cheapModel,
      provider_target: 'flux', model_key: 'cheap-text-v1' })), JSON.stringify([
      { role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null])));
  assert.equal(refused.code, '23514');
  assert.match(refused.message, /does not accept image references/);
});

// §131/§65 a disconnected provider still compiles everything and offers manual export.
test('a disconnected provider compiles the plan and blocks live generation truthfully', async () => {
  const saved = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production,
    shots.end, null, JSON.stringify(strongPlan({ model_profile_id: strongModel, provider_target: 'veo',
      model_key: 'strong-ref-v1' })), JSON.stringify([
      { role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null]));
  assert.equal(saved.readiness, 'provider_not_connected');
  const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.end]));
  assert.equal(detail.plan.connection.state, 'not_connected');
  assert.ok(detail.plan.provider_prompt.length > 0, 'the provider prompt still compiles');
  assert.equal(detail.plan.canonical_prompt.subject, 'Barista pouring coffee');
  const blocked = await failure(() => asEditor(() => scalar('select tonde.create_ai_attempt($1,$2,$3,$4)',
    [wa, production, shots.end, JSON.stringify({ idempotency_key: 'veo-live-attempt-1', mode: 'live',
      status: 'submitted', provider_key: 'veo', model_profile_id: strongModel })])));
  assert.equal(blocked.code, '23514');
  assert.match(blocked.message, /not connected/);
  assert.match(blocked.message, /export the prompt/);
  // Manual mode needs no connection and is the honest path.
  const manual = await asEditor(() => scalar('select tonde.create_ai_attempt($1,$2,$3,$4)',
    [wa, production, shots.end, JSON.stringify({ idempotency_key: 'veo-manual-attempt-1', mode: 'manual',
      provider_key: 'manual', operation: 'image_to_video', model_key: 'strong-ref-v1' })]));
  assert.equal(manual.status, 'planned');
  assert.equal(manual.mode, 'manual');
});

// A generated output is media the creator owns, carried in the existing media abstraction.
const resultMedia = async (suffix) => {
  const id = `00000000-0000-4000-8000-0000000000${suffix}`;
  await asEditor(() => db.query(
    `insert into tonde.media_files(id, workspace_id, bucket, object_key, original_filename, mime_type, file_category, bytes, upload_state, processing_state)
     values ($1, $2, 'tonde-results', $3, 'take.mp4', 'video/mp4', 'video', 4096, 'uploaded', 'ready')
     on conflict (storage_provider, bucket, object_key) do nothing`,
    [id, wa, `${wa}/${id}/take.mp4`]));
  return id;
};
const attempt = (shotId, over = {}) => asEditor(() => scalar('select tonde.create_ai_attempt($1,$2,$3,$4)',
  [wa, production, shotId, JSON.stringify({ idempotency_key: 'idem-' + Math.random().toString(36).slice(2, 12),
    mode: 'manual', provider_key: 'manual', operation: 'image_to_video', ...over })]));

// §138/§98 a locked Character identity is not changed by a Director plan.
test('a locked Character identity refuses a silent change and allows an allowed variation', async () => {
  const lock = await asEditor(() => scalar('select tonde.set_ai_lock($1,$2,$3,$4)', [wa, production, JSON.stringify({
    scope: 'character', subject_id: character, label: 'Barista', priority: 'MUST PRESERVE',
    locked_traits: ['face', 'age presentation', 'hair'], allowed_variations: ['wardrobe', 'wetness'],
    prohibited_changes: ['face', 'age presentation', 'hair'],
    identity_truth: 'Preserve key identity traits as closely as the selected generation model supports.' }), null]));
  assert.equal(lock.locked, true);
  assert.equal(lock.scope, 'character');
  const refused = await failure(() => asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.pour, null, JSON.stringify(strongPlan({ model_profile_id: strongModel,
      continuity: { must: ['character'], should: [], flexible: [],
        changes: [{ scope: 'character', subject_id: character, field: 'face', to: 'a different actor' }] } })),
      JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null])));
  assert.equal(refused.code, '23514');
  assert.match(refused.message, /locked continuity trait/);
  // An allowed variation passes, because the lock says what may change as well as what may not.
  const allowed = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.pour, null, JSON.stringify(strongPlan({ model_profile_id: strongModel,
      continuity: { must: ['character'], should: [], flexible: [],
        changes: [{ scope: 'character', subject_id: character, field: 'wardrobe', to: 'flour-dusted apron' }] } })),
      JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null]));
  assert.equal(allowed.readiness, 'ready_to_generate');
});

// §139 a Product package is not swapped silently, and §37/§38 fidelity is reported.
test('a locked Product refuses a packaging swap and keeps its fidelity requirement', async () => {
  await asEditor(() => scalar('select tonde.set_ai_lock($1,$2,$3,$4)', [wa, production, JSON.stringify({
    scope: 'product', subject_id: productAsset, label: 'Ridgeway bag', priority: 'MUST PRESERVE',
    locked_traits: ['packaging', 'logo', 'label colour'], prohibited_changes: ['packaging', 'logo'],
    allowed_variations: ['steam density', 'background'],
    note: 'Exact brand fidelity is critical for this Product.' }), null]));
  const swap = await failure(() => asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.label, null, JSON.stringify(strongPlan({ model_profile_id: strongModel,
      continuity: { must: ['product'], should: [], flexible: [],
        changes: [{ scope: 'product', subject_id: productAsset, field: 'packaging', to: 'a plain generic bag' }] } })),
      JSON.stringify([{ role: 'product', priority: 'MUST PRESERVE', asset_id: productAsset, origin: 'asset' }]), null])));
  assert.equal(swap.code, '23514');
  assert.match(swap.message, /locked continuity trait/);
  const locks = await asEditor(() => scalar('select tonde_private.ai_locks_document($1,$2)', [wa, production]).catch(() => null));
  // The lock is not reachable through the private helper, so it is read from the canvas detail.
  assert.equal(locks, null);
  const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.label]));
  const productLock = detail.locks.find(item => item.scope === 'product');
  assert.equal(productLock.priority, 'MUST PRESERVE');
  assert.deepEqual(productLock.prohibited_changes, ['packaging', 'logo']);
  assert.deepEqual(productLock.allowed_variations.sort(), ['background', 'steam density']);
});

// §136/§25 a prompt compiled against an older Shot revision is STALE, never current.
test('editing the Shot after the prompt was compiled marks the prompt stale', async () => {
  const plan = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.establish, null, JSON.stringify(strongPlan({ model_profile_id: strongModel })),
      JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null]));
  const savedRevision = plan.source_shot_revision;
  const before = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.establish]));
  assert.equal(before.plan.prompt_stale, false);
  await asEditor(() => scalar('select tonde.update_studio_shot($1,$2,$3,$4,$5)', [wa, production, shots.establish,
    before.shot.revision, JSON.stringify({ movement: 'handheld drift' })]));
  const after = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.establish]));
  assert.equal(after.plan.prompt_stale, true);
  assert.equal(after.plan.source_shot_revision, savedRevision);
  assert.equal(after.readiness, 'stale');
  // The stale prompt is never quietly used for generation.
  const refused = await failure(() => asEditor(() => scalar('select tonde.create_ai_attempt($1,$2,$3,$4)',
    [wa, production, shots.establish, JSON.stringify({ idempotency_key: 'stale-attempt-key',
      mode: 'manual', provider_key: 'manual' })])));
  assert.equal(refused.code, '23514');
  assert.match(refused.message, /Recompile the prompt/);
  // Recompiling against the current revision clears it.
  const recompiled = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.establish, after.shot.revision, JSON.stringify(strongPlan({ model_profile_id: strongModel })),
      JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null]));
  assert.ok(recompiled.prompt_version > plan.prompt_version,
    `recompiling produced a new prompt version (${plan.prompt_version} -> ${recompiled.prompt_version})`);
  assert.equal(recompiled.readiness, 'ready_to_generate');
});

// §137 an approved plan is not materially rewritten without the approval state moving.
test('editing an approved AI plan stops claiming approval', async () => {
  await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production, shots.label, null,
    JSON.stringify(strongPlan({ model_profile_id: strongModel })),
    JSON.stringify([{ role: 'product', priority: 'MUST PRESERVE', asset_id: productAsset, origin: 'asset' }]), null]));
  const approved = await asEditor(() => scalar('select tonde.set_ai_plan_approval($1,$2,$3,$4,$5)',
    [wa, production, shots.label, 'approved', null]));
  assert.equal(approved.approval, 'approved');
  const changed = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.label, null, JSON.stringify(strongPlan({ model_profile_id: strongModel,
      canonical_prompt: { subject: 'A different product entirely' } })),
      JSON.stringify([{ role: 'product', priority: 'MUST PRESERVE', asset_id: productAsset, origin: 'asset' }]), null]));
  assert.equal(changed.approval, 'changed_after_approval');
  // Smuggling approval in with unreviewed content is refused.
  const smuggled = await failure(() => asEditor(() => db.query(
    "update tonde.execution_plans set approval = 'approved', aspect_ratio = '1:1' where shot_id = $1 and execution_method = 'ai'",
    [shots.label])));
  assert.equal(smuggled.code, '23514');
});

// §57/§59/§93 an Attempt is a first-class record with provenance and real statuses.
test('a generation attempt persists its provider, model, prompt version and references', async () => {
  const created = await attempt(shots.label, { idempotency_key: 'attempt-persist-1',
    input_references: [{ role: 'product', asset_id: productAsset }],
    settings: { aspect_ratio: '9:16', resolution: '1080p' }, external_job_id: 'job-123' });
  assert.equal(created.status, 'planned');
  assert.equal(created.provider_key, 'manual');
  // The Attempt records the prompt version it was generated against, not a fresh one.
  const plan = await one("select prompt_version from tonde.execution_plans where shot_id = $1 and execution_method = 'ai'",
    [shots.label]);
  assert.equal(created.prompt_version, plan.prompt_version);
  assert.equal(created.cost_state, 'unknown');
  assert.equal(created.cost_amount, null);
  const row = await one(`select provider_key, model_key, mode, status, external_job_id, input_references
    from tonde.ai_generation_attempts where id = $1`, [created.attempt_id]);
  assert.equal(row.provider_key, 'manual');
  assert.equal(row.mode, 'manual');
  assert.equal(row.external_job_id, 'job-123');
  assert.equal(row.input_references[0].asset_id, productAsset);
  const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.label]));
  const stored = detail.attempts.find(item => item.attempt_id === created.attempt_id);
  assert.equal(stored.settings.aspect_ratio, '9:16');
  assert.equal(detail.selected_result, null);
});

// §61 the same submission returns the same Attempt instead of spending twice.
test('retrying the same submission is idempotent rather than a second billable job', async () => {
  const media = await resultMedia('e1');
  const first = await asEditor(() => scalar('select tonde.create_ai_attempt($1,$2,$3,$4)', [wa, production, shots.label,
    JSON.stringify({ idempotency_key: 'retry-same-key-0001', mode: 'manual', provider_key: 'manual',
      model_profile_id: strongModel, operation: 'image_to_video' })]));
  await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production, shots.label,
    first.attempt_id, JSON.stringify({ status: 'succeeded', output_media_id: media })]));
  const again = await asEditor(() => scalar('select tonde.create_ai_attempt($1,$2,$3,$4)', [wa, production, shots.label,
    JSON.stringify({ idempotency_key: 'retry-same-key-0001', mode: 'manual', provider_key: 'manual',
      model_profile_id: strongModel, operation: 'image_to_video' })]));
  assert.equal(again.idempotent, true);
  assert.equal(again.attempt_id, first.attempt_id);
  const count = await scalar('select count(*) from tonde.ai_generation_attempts where idempotency_key = $1',
    ['retry-same-key-0001']);
  assert.equal(Number(count), 1);
});

// §105 retryable is transient infrastructure only.
test('retry classification separates transient failure from a refusal', async () => {
  const transient = await attempt(shots.hands, { idempotency_key: 'transient-attempt-1' });
  await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production, shots.hands,
    transient.attempt_id, JSON.stringify({ status: 'queued' })]));
  const failed = await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production,
    shots.hands, transient.attempt_id, JSON.stringify({ status: 'failed', failure_code: 'provider_5xx',
      failure_message: 'The provider returned a server error.' })]));
  assert.equal(failed.retryable, true);
  assert.equal(failed.status, 'failed');
  const refused = await attempt(shots.hands, { idempotency_key: 'refused-attempt-1' });
  await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production, shots.hands,
    refused.attempt_id, JSON.stringify({ status: 'failed', failure_code: 'policy_rejection',
      failure_message: 'The provider refused this prompt.' })]));
  const stored = await one('select retryable from tonde.ai_generation_attempts where id = $1', [refused.attempt_id]);
  assert.equal(stored.retryable, false);
  // A failure must say why, and a status cannot jump backwards or skip to success.
  const unexplained = await attempt(shots.hands, { idempotency_key: 'unexplained-failure-1' });
  const missing = await failure(() => asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)',
    [wa, production, shots.hands, unexplained.attempt_id,
      JSON.stringify({ status: 'failed', failure_message: 'no code was given' })])));
  assert.equal(missing.code, '23514');
  assert.match(missing.message, /must say why/);
  const backwards = await failure(() => asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)',
    [wa, production, shots.hands, transient.attempt_id, JSON.stringify({ status: 'processing' })])));
  assert.equal(backwards.code, '23514');
  // §62 cost is never invented: a known cost needs an amount and a currency.
  const invented = await failure(() => asEditor(() => db.query(
    `update tonde.ai_generation_attempts set cost_state = 'known' where id = $1`, [transient.attempt_id])));
  assert.equal(invented.code, '23514');
});

// §95/§151/§152 a Result attaches to its canonical Shot and selection is exclusive.
test('a generated Result attaches to the Shot, and selecting one is exclusive', async () => {
  const mediaOne = await resultMedia('e2');
  const mediaTwo = await resultMedia('e3');
  const first = await attempt(shots.sip, { idempotency_key: 'result-attempt-1' });
  const second = await attempt(shots.sip, { idempotency_key: 'result-attempt-2' });
  const done = await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production,
    shots.sip, first.attempt_id, JSON.stringify({ status: 'succeeded', output_media_id: mediaOne,
      creator_rating: 4 })]));
  assert.ok(done.result_id);
  await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production, shots.sip,
    second.attempt_id, JSON.stringify({ status: 'succeeded', output_media_id: mediaTwo })]));
  const result = await one(`select shot_id, scene_id, media_id, state, approval, execution_plan_id, provenance
    from tonde.results where id = $1`, [done.result_id]);
  assert.equal(result.shot_id, shots.sip);
  assert.equal(result.scene_id, scene);
  assert.equal(result.state, 'needs_review');
  // Provenance survives: provider, model, attempt and prompt version are all recorded.
  assert.equal(result.provenance.attempt_id, first.attempt_id);
  assert.equal(result.provenance.provider, 'manual');
  const sipPlan = await one("select prompt_version from tonde.execution_plans where shot_id = $1 and execution_method = 'ai'",
    [shots.sip]);
  assert.equal(result.provenance.prompt_version, sipPlan.prompt_version);
  const selected = await asEditor(() => scalar('select tonde.select_ai_result($1,$2,$3,$4)',
    [wa, production, shots.sip, first.attempt_id]));
  assert.equal(selected.selected, true);
  assert.equal(selected.result_state, 'needs_review');
  // Selecting is not approving: the Shot keeps its own approval.
  assert.equal(selected.shot_approval, 'draft');
  const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.sip]));
  assert.equal(detail.selected_result.attempt_id, first.attempt_id);
  assert.equal(detail.attempts.filter(item => item.selected).length, 1);
  // Selecting the other one moves the selection rather than holding both.
  await asEditor(() => scalar('select tonde.select_ai_result($1,$2,$3,$4)', [wa, production, shots.sip, second.attempt_id]));
  const after = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.sip]));
  assert.equal(after.attempts.filter(item => item.selected).length, 1);
  assert.equal(after.selected_result.attempt_id, second.attempt_id);
  assert.equal(after.attempts.find(item => item.attempt_id === first.attempt_id).selected, false);
  // An attempt with no output cannot be selected.
  const pending = await attempt(shots.sip, { idempotency_key: 'result-attempt-3' });
  const nothing = await failure(() => asEditor(() => scalar('select tonde.select_ai_result($1,$2,$3,$4)',
    [wa, production, shots.sip, pending.attempt_id])));
  assert.equal(nothing.code, '23514');
});

// §145/§146/§52 a model's real limits are reported against the Shot rather than assumed.
test('duration and aspect limits are reported against the Shot, not discovered at submit time', async () => {
  // A frame-free Shot, so this test measures duration and aspect limits alone.
  await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production, shots.pour, null,
    JSON.stringify(strongPlan({ model_profile_id: strongModel, expected_duration_ms: 12000,
      first_frame: { source: '', note: '' }, last_frame: { source: '', note: '' } })),
    JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null]));
  const shortModel = (await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)', [wa, JSON.stringify({
    provider_key: 'runway', model_key: 'short-v1', operation: 'video', capability_state: 'SUPPORTED',
    supports_image_reference: true, max_duration_ms: 4000, aspect_ratios: ['9:16'] }), null]))).model_profile_id;
  const squareModel = (await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)', [wa, JSON.stringify({
    provider_key: 'runway', model_key: 'square-v1', operation: 'video', capability_state: 'SUPPORTED',
    supports_image_reference: true, aspect_ratios: ['1:1'] }), null]))).model_profile_id;
  // 5000 ms Shot against a 4000 ms ceiling: usable, with an extension strategy to plan.
  const shortVerdict = await asEditor(() => scalar('select tonde.ai_capability_verdict($1,$2,$3,$4)',
    [wa, production, shots.pour, shortModel]));
  assert.equal(shortVerdict.state, 'SUPPORTED');
  assert.deepEqual(shortVerdict.blocking, []);
  assert.ok(shortVerdict.partial.some(note => /extension or split/.test(note)),
    `expected an extension note, got ${JSON.stringify(shortVerdict.partial)}`);
  // The Production delivers 9:16, so a model that cannot is unsupported — not a warning.
  const squareVerdict = await asEditor(() => scalar('select tonde.ai_capability_verdict($1,$2,$3,$4)',
    [wa, production, shots.pour, squareModel]));
  assert.equal(squareVerdict.state, 'UNSUPPORTED');
  assert.ok(squareVerdict.reasons.some(reason => /aspect ratio/.test(reason)));
  assert.ok(squareVerdict.blocking.some(reason => /aspect ratio/.test(reason)),
    'a delivery-format mismatch blocks the plan rather than being a note');
  const refused = await failure(() => asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)',
    [wa, production, shots.pour, null, JSON.stringify(strongPlan({ model_profile_id: squareModel,
      provider_target: 'runway', model_key: 'square-v1', aspect_ratio: '9:16' })),
      JSON.stringify([{ role: 'face', priority: 'MUST PRESERVE', asset_id: character, origin: 'asset' }]), null])));
  assert.equal(refused.code, '23514');
  assert.match(refused.message, /aspect ratio/);
  // An undeclared model is UNKNOWN, never quietly treated as capable.
  const undeclared = await asEditor(() => scalar('select tonde.ai_capability_verdict($1,$2,$3,$4)',
    [wa, production, shots.pour, '00000000-0000-4000-8000-00000000dead']));
  assert.equal(undeclared.state, 'UNKNOWN');
  assert.ok(undeclared.reasons.some(reason => /No model profile is declared/.test(reason)));
});

// §107/§108/§109 a batch previews, needs confirmation for real spend, and keeps its
// successes when some Shots fail.
test('a batch previews its cost and readiness, and a partial failure keeps its successes', async () => {
  // Connecting the second provider leaves exactly one genuinely blocked Shot in the scene.
  await asEditor(() => scalar('select tonde.set_ai_connection($1,$2,$3,$4,$5,$6)',
    [wa, 'veo', 'connected', 'setup: veo account', '', null]));
  const preview = await asEditor(() => scalar('select tonde.ai_batch_preview($1,$2,$3,$4)',
    [wa, production, shots.establish, JSON.stringify({ scope: 'scene', scene_id: scene })]));
  assert.equal(preview.summary.shots, 6);
  assert.equal(preview.summary.blocked, 1, 'only the unsupported Shot is blocked');
  assert.equal(preview.summary.blocked + preview.summary.ready + preview.summary.manual_export, 6);
  // Cost is either verified or honestly unknown. It is never zero by default.
  assert.equal(preview.cost.state, 'known');
  assert.equal(preview.cost.currency, 'USD');
  assert.ok(preview.cost.amount > 0);
  // §148 a connected provider with declared pricing is real spend and needs the creator.
  assert.equal(preview.confirmation_required, true);
  const unconfirmed = await failure(() => asEditor(() => scalar('select tonde.create_ai_batch($1,$2,$3,$4)',
    [wa, production, shots.establish, JSON.stringify({ scope: 'scene', scene_id: scene })])));
  assert.equal(unconfirmed.code, '23514');
  assert.match(unconfirmed.message, /Confirm the batch/);
  const batch = await asEditor(() => scalar('select tonde.create_ai_batch($1,$2,$3,$4)',
    [wa, production, shots.establish, JSON.stringify({ scope: 'scene', scene_id: scene, confirmed: true })]));
  assert.equal(batch.state, 'confirmed');
  assert.equal(batch.items.length, 6);
  assert.equal(batch.items.filter(item => item.state === 'blocked').length, preview.summary.blocked);
  // Every unblocked Shot got its own planned Attempt: a durable job, not an open request.
  const planned = batch.items.filter(item => item.attempt_id !== null);
  assert.equal(planned.length, 6 - preview.summary.blocked);
  const mediaOne = await resultMedia('e4');
  const mediaTwo = await resultMedia('e5');
  const mediaThree = await resultMedia('e6');
  const workable = batch.items.filter(item => item.state === 'pending');
  assert.ok(workable.length >= 3);
  // These are live attempts, so they are completed the way a provider job really ends:
  // submitted, then polling reports it processing, then it succeeds.
  for (const [index, item] of workable.slice(0, 3).entries()) {
    const media = [mediaOne, mediaTwo, mediaThree][index];
    await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production, item.shot_id,
      item.attempt_id, JSON.stringify({ status: 'queued' })]));
    await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production, item.shot_id,
      item.attempt_id, JSON.stringify({ status: 'submitted', external_job_id: `job-${index}` })]));
    const processing = await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)',
      [wa, production, item.shot_id, item.attempt_id, JSON.stringify({ status: 'processing' })]));
    assert.equal(processing.external_job_id, `job-${index}`);
    const done = await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)',
      [wa, production, item.shot_id, item.attempt_id, JSON.stringify({ status: 'succeeded', output_media_id: media })]));
    assert.ok(done.result_id);
  }
  const failedItems = [];
  for (const [index, item] of workable.slice(3, 5).entries()) {
    const result = await asEditor(() => scalar('select tonde.record_ai_batch_item($1,$2,$3,$4,$5)',
      [wa, production, batch.batch_id, item.shot_id, JSON.stringify({ state: 'failed',
        failure_code: index === 0 ? 'provider_5xx' : 'policy_rejection',
        failure_message: 'The provider did not complete this Shot.' })]));
    assert.equal(result.item_state, 'failed');
    failedItems.push(item);
  }
  assert.equal(failedItems.length, 2);
  const after = await asEditor(() => scalar('select tonde.ai_batch_preview($1,$2,$3,$4)',
    [wa, production, shots.establish, JSON.stringify({ scope: 'scene', scene_id: scene })]));
  assert.equal(after.summary.shots, 6);
  const status = await one('select state, shot_count, blocked_count from tonde.ai_generation_batches where id = $1',
    [batch.batch_id]);
  assert.equal(status.state, 'partial');
  assert.equal(status.shot_count, 6);
  // The successes are preserved: their Attempts and Results still exist.
  const succeeded = await one(`select count(*) as count from tonde.ai_generation_batch_items
    where batch_id = $1 and state = 'succeeded'`, [batch.batch_id]);
  assert.ok(Number(succeeded.count) >= 3);
  const keptResults = await one(`select count(*) as count from tonde.results r
    join tonde.ai_generation_attempts a on a.result_id = r.id
    join tonde.ai_generation_batch_items i on i.attempt_id = a.id
    where i.batch_id = $1 and i.state = 'succeeded'`, [batch.batch_id]);
  assert.equal(Number(keptResults.count), Number(succeeded.count));
  // Only the failed Shots need retrying, and a partial batch stays open for exactly that.
  assert.equal(workable.length, 5, `the preview promised five workable Shots, got ${workable.length}`);
  assert.equal(preview.summary.unknown_cost, 0);
  // The failure lands on the Attempt too, classified so only the transient one is retried.
  const transient = await one(`select status, failure_code, retryable from tonde.ai_generation_attempts
    where id = $1`, [failedItems[0].attempt_id]);
  assert.equal(transient.status, 'failed');
  assert.equal(transient.failure_code, 'provider_5xx');
  assert.equal(transient.retryable, true);
  const refusedAttempt = await one(`select retryable from tonde.ai_generation_attempts where id = $1`,
    [failedItems[1].attempt_id]);
  assert.equal(refusedAttempt.retryable, false);
  const resumed = await asEditor(() => scalar('select tonde.record_ai_batch_item($1,$2,$3,$4,$5)',
    [wa, production, batch.batch_id, failedItems[0].shot_id, JSON.stringify({ state: 'submitted' })]));
  assert.equal(resumed.item_state, 'submitted');
  assert.equal(resumed.state, 'running');
  const retried = await asEditor(() => scalar('select tonde.record_ai_batch_item($1,$2,$3,$4,$5)',
    [wa, production, batch.batch_id, failedItems[0].shot_id, JSON.stringify({ state: 'succeeded' })]));
  assert.equal(retried.item_state, 'succeeded');
  // Five of six succeeded is not a success: the blocked Shot keeps the batch partial.
  assert.equal(retried.state, 'partial');
  // A single-Shot batch that fully succeeds closes, and then refuses more changes.
  const single = await asEditor(() => scalar('select tonde.create_ai_batch($1,$2,$3,$4)',
    [wa, production, shots.establish, JSON.stringify({ scope: 'shot', shot_id: shots.establish, confirmed: true })]));
  assert.equal(single.items.length, 1);
  const singleAttempt = single.items[0].attempt_id;
  const singleMedia = await resultMedia('e7');
  for (const status of ['queued', 'submitted', 'processing']) {
    await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production, shots.establish,
      singleAttempt, JSON.stringify({ status })]));
  }
  const finished = await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production,
    shots.establish, singleAttempt, JSON.stringify({ status: 'succeeded', output_media_id: singleMedia })]));
  assert.ok(finished.result_id);
  const closedBatch = await one('select state from tonde.ai_generation_batches where id = $1', [single.batch_id]);
  assert.equal(closedBatch.state, 'succeeded');
  const closed = await failure(() => asEditor(() => scalar('select tonde.record_ai_batch_item($1,$2,$3,$4,$5)',
    [wa, production, single.batch_id, shots.establish, JSON.stringify({ state: 'submitted' })])));
  assert.equal(closed.code, '23514');
  assert.match(closed.message, /already closed/);
});

// §147 when no verified pricing exists the batch says COST UNKNOWN instead of a number.
test('a batch with no verified pricing reports unknown cost, never zero', async () => {
  // This Shot selects a model with no verified pricing at all.
  await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production, shots.sip, null,
    JSON.stringify(strongPlan({ model_profile_id: unpricedModel, provider_target: 'kling',
      model_key: 'unpriced-v1', cost_note: 'No verified pricing for this provider.',
      first_frame: { source: '', note: '' }, last_frame: { source: '', note: '' } })),
    JSON.stringify([{ role: 'environment', priority: 'SHOULD PRESERVE', asset_id: kitchen, origin: 'asset' }]), null]));
  const preview = await asEditor(() => scalar('select tonde.ai_batch_preview($1,$2,$3,$4)',
    [wa, production, shots.sip, JSON.stringify({ scope: 'shot', shot_id: shots.sip })]));
  assert.equal(preview.cost.state, 'unknown');
  assert.equal(preview.cost.amount ?? null, null);
  assert.equal(preview.cost.unknown_count, 1);
  assert.match(preview.cost.note, /will not invent an amount/);
  assert.equal(preview.summary.unknown_cost, 1);
  const saved = await one("select cost_state, cost_amount from tonde.execution_plans where shot_id = $1 and execution_method = 'ai'",
    [shots.sip]);
  assert.equal(saved.cost_state, 'unknown');
  assert.equal(saved.cost_amount, null);
});

// §140/§149/§150 a Hybrid Shot is one Shot with a practical component and a generated
// component. Nothing is duplicated: same Production, same Scene, same Shot identifier.
test('a Hybrid Shot keeps one identifier while holding both a Real and an AI plan', async () => {
  const labelRevision = (await one('select revision from tonde.shots where id = $1', [shots.label])).revision;
  await asEditor(() => scalar('select tonde.update_studio_shot($1,$2,$3,$4,$5)', [wa, production, shots.label,
    labelRevision, JSON.stringify({ execution_method: 'hybrid' })]));
  const real = await asEditor(() => scalar('select tonde.save_real_plan($1,$2,$3,$4,$5,$6,$7,$8)', [wa, production,
    shots.label, null, JSON.stringify({ plan_status: 'ready', readiness_note: '', complexity: 'quick',
      movement: 'locked', stabilization: 'tripod', lighting_intent: 'soft premium',
      product_direction: 'Bag label faces camera, lit separately for exact packaging fidelity.',
      expected_duration_ms: 4000 }), '[]', '[]', null]));
  assert.ok(real.plan_id);
  const ai = await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production,
    shots.label, null, JSON.stringify(strongPlan({ model_profile_id: strongModel, expected_duration_ms: 4000,
      hybrid: { shoot_component: 'Shoot the bag practically for exact packaging fidelity.',
        generate_component: 'Generate the kitchen environment and the steam.',
        combine: ['Match the practical key light direction in the prompt'],
        matching: ['Camera height and lens character', 'Shadow direction on the counter'],
        limitations: ['Compositing quality depends on the plate you capture.'],
        plate_requirements: ['Locked camera, clean plate, consistent exposure, extra headroom'] } })),
    JSON.stringify([{ role: 'product', priority: 'MUST PRESERVE', asset_id: productAsset, origin: 'asset' }]), null]));
  assert.equal(ai.readiness, 'ready_to_generate');
  // One Shot, one Scene, one Production: two plans, not two Shots.
  const counts = await one(`select (select count(*) from tonde.shots where production_id = $1) as shots,
    (select count(*) from tonde.scenes where production_id = $1) as scenes,
    (select count(*) from tonde.productions where id = $1) as productions,
    (select count(*) from tonde.execution_plans where shot_id = $2) as plans`, [production, shots.label]);
  assert.equal(Number(counts.shots), 6);
  assert.equal(Number(counts.scenes), 1);
  assert.equal(Number(counts.productions), 1);
  assert.equal(Number(counts.plans), 2);
  const detail = await asEditor(() => scalar('select tonde.ai_shot_detail($1,$2,$3)', [wa, production, shots.label]));
  // §81 the AI plan names what the practical component must provide.
  assert.equal(detail.plan.hybrid.shoot_component.startsWith('Shoot the bag practically'), true);
  assert.ok(detail.plan.hybrid.plate_requirements.includes('Locked camera, clean plate, consistent exposure, extra headroom'));
  assert.ok(detail.real_plan.plan_id, 'the Real plan is visible from the AI canvas');
  assert.equal(detail.shot.execution_method, 'hybrid');
  // §114 the shot keeps one execution method for the timeline.
  const surface = await asEditor(() => scalar('select tonde.ai_creation_surface($1,$2,$3)', [wa, production, null]));
  assert.equal(surface.shots.filter(item => item.shot_id === shots.label).length, 1);
  assert.equal(surface.shots.find(item => item.shot_id === shots.label).execution_method, 'hybrid');
});

// §153/§170 another workspace reaches nothing: not a prompt, an Attempt, a reference, a
// Result or a lock.
test('another workspace cannot read or change any AI Creation state', async () => {
  // Built from the signature so the call is real, with real placeholders.
  const call = (schema, signature) => {
    const arity = signature.split(',').length;
    const placeholders = Array.from({ length: arity }, (_, index) => `$${index + 1}`).join(',');
    return `select ${schema}.${signature.slice(0, signature.indexOf('('))}(${placeholders})`;
  };
  const reads = [
    ['ai_creation_surface(uuid,uuid,integer)', wa, production, null],
    ['ai_shot_detail(uuid,uuid,uuid)', wa, production, shots.establish],
    ['ai_model_catalog(uuid)', wa],
    ['ai_capability_verdict(uuid,uuid,uuid,uuid)', wa, production, shots.establish, strongModel],
    ['ai_batch_preview(uuid,uuid,uuid,jsonb)', wa, production, shots.establish, JSON.stringify({ scope: 'shot' })],
  ];
  for (const [signature, ...args] of reads) {
    const denied = await failure(() => asUser(B, () => scalar(call('tonde', signature), args)));
    assert.equal(denied.code, '42501', signature);
  }
  const writes = [
    ['declare_ai_model(uuid,jsonb,integer)', wa, JSON.stringify({ provider_key: 'flux', model_key: 'stolen', operation: 'image' }), null],
    ['set_ai_connection(uuid,text,text,text,text,integer)', wa, 'runway', 'connected', '', '', null],
    ['save_ai_plan(uuid,uuid,uuid,integer,jsonb,jsonb,integer)', wa, production, shots.establish, null,
      JSON.stringify(strongPlan()), '[]', null],
    ['set_ai_plan_approval(uuid,uuid,uuid,text,integer)', wa, production, shots.establish, 'approved', null],
    ['set_ai_lock(uuid,uuid,jsonb,integer)', wa, production, JSON.stringify({ scope: 'character' }), null],
    ['create_ai_attempt(uuid,uuid,uuid,jsonb)', wa, production, shots.establish,
      JSON.stringify({ idempotency_key: 'cross-workspace-attempt', mode: 'manual' })],
    ['select_ai_result(uuid,uuid,uuid,uuid)', wa, production, shots.sip, '00000000-0000-4000-8000-0000000000ff'],
    ['create_ai_batch(uuid,uuid,uuid,jsonb)', wa, production, shots.establish,
      JSON.stringify({ scope: 'shot', confirmed: true })],
  ];
  for (const [signature, ...args] of writes) {
    const denied = await failure(() => asUser(B, () => scalar(call('tonde', signature), args)));
    assert.equal(denied.code, '42501', signature);
  }
  // Private helpers are unreachable from the API at all.
  for (const signature of ['ai_readiness_state(uuid,uuid,uuid)', 'ai_capability_check(uuid,uuid,uuid,uuid)',
    'ai_plan_document(uuid,uuid,uuid)', 'ai_locks_document(uuid,uuid)', 'ai_batch_refresh(uuid,uuid)']) {
    const args = [wa, production, shots.establish, strongModel].slice(0, signature.split(',').length);
    const denied = await failure(() => asEditor(() => scalar(call('tonde_private', signature), args)));
    assert.equal(denied.code, '42501', signature);
  }
  const anonDenied = await failure(async () => {
    await db.exec('begin; set local role anon;');
    try { await db.query('select tonde.ai_creation_surface($1,$2,$3)', [wa, production, null]); }
    finally { await db.exec('rollback'); }
  });
  assert.equal(anonDenied.code, '42501');
  // A fully valid row is still refused across workspaces: the policy is what refuses it.
  const planId = (await one("select id from tonde.execution_plans where shot_id = $1 and execution_method = 'ai'",
    [shots.establish])).id;
  const inserts = {
    ai_shot_references: [`insert into tonde.ai_shot_references(workspace_id, production_id, shot_id, plan_id, reference_role, asset_id)
      values ($1,$2,$3,$4,'face',$5) returning id`, [wa, production, shots.establish, planId, character]],
    ai_continuity_locks: [`insert into tonde.ai_continuity_locks(workspace_id, production_id, scope, label)
      values ($1,$2,'world','Cross-workspace world lock') returning id`, [wa, production]],
    ai_generation_attempts: [`insert into tonde.ai_generation_attempts(workspace_id, production_id, shot_id, plan_id,
      operation, attempt_number, provider_key, idempotency_key, mode, status)
      values ($1,$2,$3,$4,'video',99,'manual','cross-workspace-raw-row','manual','planned') returning id`,
      [wa, production, shots.establish, planId]],
    ai_generation_batches: [`insert into tonde.ai_generation_batches(workspace_id, production_id, scope, shot_count)
      values ($1,$2,'shot',1) returning id`, [wa, production]],
    ai_cost_confirmations: [`insert into tonde.ai_cost_confirmations(workspace_id, production_id, shot_id, prompt_version, provider_key)
      values ($1,$2,$3,1,'manual') returning id`, [wa, production, shots.establish]],
  };
  for (const [table, [sql, args]] of Object.entries(inserts)) {
    const rls = await scalar(`select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tonde' and c.relname = '${table}'`);
    assert.equal(rls, true, table);
    const policies = await scalar(`select count(*) from pg_policies where schemaname = 'tonde' and tablename = '${table}'`);
    assert.ok(policies >= 3, `${table} has ${policies} policies`);
    const denied = await failure(() => asUser(B, () => scalar(sql, args)));
    assert.equal(denied.code, '42501', `${table} allowed a cross-workspace insert (${denied.code})`);
    const allowed = await asEditor(() => scalar(sql, args));
    assert.ok(allowed, `${table} refused a legitimate insert`);
  }
  // The published catalogue is readable by any authenticated member and has no capability claims.
  const catalog = await asUser(B, () => scalar('select tonde.ai_model_catalog($1)', [wb]));
  assert.ok(catalog.providers.length >= 8);
  assert.deepEqual(catalog.models, [], 'workspace B declared nothing and sees nothing');
  // No model profile mixes workspaces.
  const wrongHome = await failure(() => asEditor(() => db.query(
    `insert into tonde.ai_model_profiles(workspace_id, provider_key, model_key, operation)
     values ($1,'flux','leaked-v1','image')`, [wb])));
  assert.equal(wrongHome.code, '42501');
});

// Peer-review repair: every declared capability must be correctable, in one revision.
test('re-declaring a model corrects every capability, and one edit is one revision', async () => {
  const declaration = {
    provider_key: 'elevenlabs', model_key: 'voice-v2', label: 'Voice', operation: 'speech',
    capability_state: 'SUPPORTED', supports_image_edit: false, supports_lipsync: false,
    supports_audio: true, cost_unit: 'generation', cost_amount: 0.3, cost_currency: 'USD' };
  const first = await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)',
    [wa, JSON.stringify(declaration), null]));
  assert.equal(first.model_profile_id.length > 0, true);
  const before = await one(`select revision, supports_image_edit, supports_lipsync from tonde.ai_model_profiles
    where id = $1`, [first.model_profile_id]);
  assert.equal(before.supports_image_edit, false);
  assert.equal(before.supports_lipsync, false);
  // Correcting two facts at once: both must land, and the revision must move exactly once.
  const corrected = await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)',
    [wa, JSON.stringify({ ...declaration, capability_state: 'PARTIALLY SUPPORTED',
      supports_image_edit: true, supports_lipsync: true, cost_amount: 0.5 }), null]));
  assert.equal(corrected.model_profile_id, first.model_profile_id);
  assert.equal(corrected.capability_state, 'PARTIALLY SUPPORTED');
  assert.equal(corrected.cost_amount, 0.5);
  assert.equal(corrected.cost_known, true);
  assert.equal(corrected.revision, before.revision + 1,
    'one declaration edit is one revision, not two');
  const after = await one(`select supports_image_edit, supports_lipsync from tonde.ai_model_profiles
    where id = $1`, [first.model_profile_id]);
  assert.equal(after.supports_image_edit, true);
  assert.equal(after.supports_lipsync, true);
  // Removing the price makes cost unknown again rather than leaving a stale number.
  const unpriced = await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)',
    [wa, JSON.stringify({ provider_key: 'elevenlabs', model_key: 'voice-v3', operation: 'speech',
      capability_state: 'SUPPORTED', cost_amount: 0.4, cost_currency: 'USD' }), null]));
  assert.equal(unpriced.cost_known, true);
  const cleared = await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)',
    [wa, JSON.stringify({ provider_key: 'elevenlabs', model_key: 'voice-v4', operation: 'speech',
      capability_state: 'SUPPORTED', cost_currency: '' }), null]));
  assert.equal(cleared.cost_known, false);
  assert.equal(cleared.cost_amount, null);
});

// Peer-review repair: a batched Attempt records the operation the Shot actually needs.
test('a batched Attempt records the operation the Shot needs, not a blanket video', async () => {
  // A narration Shot needs a model that actually generates audio, so declare one and connect it.
  const voice = await asEditor(() => scalar('select tonde.declare_ai_model($1,$2,$3)', [wa, JSON.stringify({
    provider_key: 'elevenlabs', model_key: 'narration-v1', label: 'Narration', operation: 'speech',
    capability_state: 'SUPPORTED', supports_audio: true, cost_unit: 'generation',
    cost_amount: 0.2, cost_currency: 'USD' }), null]));
  await asEditor(() => scalar('select tonde.set_ai_connection($1,$2,$3,$4,$5,$6)',
    [wa, 'elevenlabs', 'connected', 'setup: narration account', '', null]));
  await asEditor(() => scalar('select tonde.save_ai_plan($1,$2,$3,$4,$5,$6,$7)', [wa, production,
    shots.pour, null, JSON.stringify(strongPlan({ model_profile_id: voice.model_profile_id,
      expected_duration_ms: 5000, provider_target: 'elevenlabs',
      audio: { needed: true, narration: { needed: true, direction: 'Warm, unhurried.' } },
      motion: { needed: false, description: '', intensity: 'none' },
      first_frame: { source: '', note: '' }, last_frame: { source: '', note: '' } })),
    JSON.stringify([]), null]));
  const batch = await asEditor(() => scalar('select tonde.create_ai_batch($1,$2,$3,$4)',
    [wa, production, shots.pour, JSON.stringify({ scope: 'shot', shot_id: shots.pour, confirmed: true })]));
  const item = batch.items[0];
  assert.equal(item.state, 'pending', `the Shot should be workable, not blocked: ${item.blocked_reason}`);
  assert.ok(item.attempt_id, 'the batch created its own planned Attempt');
  const operation = await scalar('select operation from tonde.ai_generation_attempts where id = $1',
    [item.attempt_id]);
  assert.equal(operation, 'speech', 'a narration Shot is a speech attempt, not a video attempt');
  // An explicit operation on a single Attempt still wins over the derived one.
  const explicit = await attempt(shots.pour, { idempotency_key: 'explicit-op-attempt', operation: 'image' });
  const explicitOperation = await scalar('select operation from tonde.ai_generation_attempts where id = $1',
    [explicit.attempt_id]);
  assert.equal(explicitOperation, 'image');
});

// Peer-review repair: a new selection clears the selection, not the creator's decision.
test('selecting a new result never overwrites the previous creator decision', async () => {
  const mediaOne = await resultMedia('e7');
  const mediaTwo = await resultMedia('e8');
  const first = await attempt(shots.establish, { idempotency_key: 'decision-attempt-1' });
  const second = await attempt(shots.establish, { idempotency_key: 'decision-attempt-2' });
  await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production,
    shots.establish, first.attempt_id, JSON.stringify({ status: 'succeeded', output_media_id: mediaOne,
      creator_decision: 'needs_review' })]));
  await asEditor(() => scalar('select tonde.update_ai_attempt($1,$2,$3,$4,$5)', [wa, production,
    shots.establish, second.attempt_id, JSON.stringify({ status: 'succeeded', output_media_id: mediaTwo })]));
  await asEditor(() => scalar('select tonde.select_ai_result($1,$2,$3,$4)',
    [wa, production, shots.establish, first.attempt_id]));
  await asEditor(() => scalar('select tonde.select_ai_result($1,$2,$3,$4)',
    [wa, production, shots.establish, second.attempt_id]));
  const previous = await one(`select selected, creator_decision from tonde.ai_generation_attempts where id = $1`,
    [first.attempt_id]);
  assert.equal(previous.selected, false);
  assert.equal(previous.creator_decision, 'needs_review',
    'the creator\'s earlier decision is theirs to change, not something a new selection overwrites');
});

// §170 the manual hosted-apply verification query reports every AI Creation object present.
test('the manual hosted-apply verification query reports every AI object present', async () => {
  const sql = await readFile('supabase/manual-apply/08_verify.sql', 'utf8');
  const rows = (await db.query(sql)).rows;
  assert.ok(rows.length > 0, 'the verification query returned no rows');
  const missing = rows.filter(row => row.result !== 'OK').map(row => `${row.kind} ${row.name}`);
  assert.deepEqual(missing, [], `objects missing after the migration chain: ${missing.join(', ')}`);
});
