import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Prompt 4 Director intelligence persistence (additive migrations 012–014).
// Real embedded PostgreSQL with minimal Supabase platform schemas. This does NOT
// emulate Auth HTTP, OAuth providers, Storage HTTP, PostgREST or hosted settings.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let wa, wb;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}

const PROMPT4_TABLES = [
  'director_operations', 'director_briefs', 'director_decisions', 'reference_analyses',
  'reference_findings', 'creative_techniques', 'reference_technique_links', 'creative_stories',
  'director_reality_checks',
];

function prompt4Bundle(overrides = {}) {
  const bundle = {
    production: { title: 'Ridgeway coffee', production_type: 'commercial', execution_method: 'real', planned_duration_ms: 30000 },
    brief: {
      production_goal: 'Create a 30-second premium coffee commercial',
      audience: 'Home espresso drinkers', core_message: 'Worth the extra minute',
      call_to_action: 'Invite the viewer to choose Ridgeway now.', story_approach: 'Hook, earn, prove, invite.',
      runtime: { kind: 'exact', exact_ms: 30000 }, assumptions: [], open_decisions: [], conflicts: [],
    },
    story: {
      title: 'Worth the minute', logline: 'A quiet kitchen earns a louder cup.',
      premise: 'The extra minute is what makes it worth it.', central_question: 'Why does this deserve the choice?',
      beats: [
        { order: 1, name: 'Hook', content: 'A kettle clicks off in a dark kitchen before anyone appears.' },
        { order: 2, name: 'Proof', content: 'Hands measure beans by weight and the scale settles on the number.' },
        { order: 3, name: 'Call to action', content: 'The cup lands on the counter and the room answers with light.' },
      ],
      variation: 'original',
    },
    scenes: [
      {
        order: 1, title: 'Dark kitchen', purpose: 'Earn attention before explaining the Product', story_beat: 'Hook',
        action_lines: ['The kettle clicks off.'], duration_ms: 12000, environment: 'Kitchen',
        characters: ['Barista'], products: ['Ridgeway coffee'], techniques: ['delayed-product-reveal'],
        shots: [{ order: 1, title: 'Establish', description: 'Set the dark kitchen.', intent: 'Hold attention.', subject: 'Kitchen' }],
        opening_state: 'Empty counter.', ending_state: 'Kettle silent.', visual_intent: 'Single soft source, deep shadow.',
      },
      {
        order: 2, title: 'Weighing', purpose: 'Prove the promise with a visible measurement', story_beat: 'Proof',
        action_lines: ['Beans hit the scale.'], duration_ms: 18000, environment: 'Kitchen',
        characters: ['Barista'], products: ['Ridgeway coffee'], techniques: [], shots: [],
        opening_state: 'Beans whole.', ending_state: 'Dose ready.', visual_intent: 'Macro on the scale readout.',
      },
    ],
    script: {
      title: 'Worth the minute', dialogue_mode: 'visual',
      scenes: [
        {
          scene_order: 1, heading: 'INT. KITCHEN - NIGHT',
          action: ['The kettle clicks off.', 'ON SCREEN TEXT: "Worth the extra minute."'],
          lines: [],
          transition: 'Cut on the click.',
        },
        {
          scene_order: 2, heading: 'INT. KITCHEN - NIGHT', action: ['Beans hit the scale.'],
          lines: [{
            order: 1, kind: 'narration', speaker: null, content: 'Twenty grams, every time.',
            estimated_ms: 2200, intention: 'Close the proof.', delivery: 'Calm and unhurried.', subtext: 'Precision is care.',
            pause_after_ms: 400,
          }],
          transition: 'Hold the final image.',
        },
      ],
    },
    characters: [{
      name: 'Barista', role: 'On-camera hands', story_function: 'Shows the routine at human scale',
      objective: 'Make the Product moment feel unforced', visual_description: 'Hands only, neutral wardrobe',
      performance_direction: 'Relaxed, economical', relationships: [], recurring: false,
    }],
    environments: [{
      name: 'Kitchen', visual_requirements: ['Single north window'], story_purpose: 'Contain the ritual',
      spatial_needs: ['Counter depth'], lighting_context: 'Soft directional key', scene_usage: [1, 2],
    }],
    products: [{
      name: 'Ridgeway coffee', role: 'Hero Product', required_visibility: 'hero',
      hero_moments: ['Scene 2: Weighing'], fidelity_importance: 'high', interactions: ['Handled at human scale'],
      packaging_notes: ['Label not supplied by the creator.'],
    }],
    wardrobe_props: [{ name: 'Ridgeway hero unit', kind: 'prop', requirement: 'One clean unit and one spare.', scene_usage: [2], source: 'derived' }],
    style_bible: {
      title: 'Coffee Style', summary: 'camera: locked off',
      sections: [{ section: 'camera', description: 'Locked off', directives: ['One move per Scene'], epistemic: 'estimated', confidence: 'medium' }],
      producer: 'deterministic',
    },
    reality: { feasibility: 'adapt', complexity: 'simple', summary: 'Owned camera, one missing light.', items: [], domains: { camera: 'owned_ready' }, limitations: [] },
    runtime_fit: { target_ms: 30000, assigned_ms: 30000, dialogue_ms: 2200, action_ms: 27800, slack_ms: 0, status: 'fits', findings: [] },
    decisions: [], producer: 'deterministic', operation: {},
  };
  return { ...bundle, ...overrides };
}

const asLiteral = (value) => JSON.stringify(value);

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
});

after(async () => { if (db) await db.close(); });

test('Prompt 4 intelligence tables exist, enable RLS and expose only workspace-scoped read policies', async () => {
  for (const table of PROMPT4_TABLES) {
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid = 'tonde.${table}'::regclass`), true, `${table} RLS`);
    const policies = (await db.query('select policyname, cmd from pg_policies where schemaname=$1 and tablename=$2', ['tonde', table])).rows;
    assert.ok(policies.length >= 1, `${table} needs a policy`);
    assert.ok(policies.every((policy) => policy.cmd === 'SELECT'), `${table} must not expose direct writes`);
    // Direct client writes are refused; every write goes through a guarded RPC.
    await assert.rejects(
      asUser(A, () => db.query(`insert into tonde.${table}(workspace_id) values($1)`, [wa])),
      /row-level security|permission denied/i,
      `${table} direct insert`,
    );
  }
});

test('another workspace can neither read nor apply any Prompt 4 intelligence row', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Prompt 4 private','commercial')", [wa]));
  await asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,1,$3,$4,$5::jsonb,true)',
    [wa, production, '00000000-0000-4000-8000-000000000071', 'apply_production_plan', asLiteral(prompt4Bundle())],
  ));
  assert.equal(await scalar("select count(*)::text from tonde.scenes where production_id=$1 and lifecycle='active'", [production]), '2');
  for (const table of ['scenes', 'creative_stories', 'director_briefs', 'director_operations', 'dialogue_lines']) {
    assert.equal(
      await asUser(B, () => scalar(`select count(*) from tonde.${table} where production_id=$1`, [production])), 0,
      `${table} must not leak across workspaces`,
    );
  }
  await assert.rejects(asUser(B, () => scalar(
    'select tonde.apply_director_operation($1,$2,1,$3,$4,$5::jsonb,true)',
    [wa, production, '00000000-0000-4000-8000-000000000072', 'apply_production_plan', asLiteral(prompt4Bundle())],
  )), /workspace editor|permission denied|row-level security/i);
});

test('apply_director_operation requires creator confirmation and a supported operation type', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Confirmation gate','commercial')", [wa]));
  const bundle = asLiteral(prompt4Bundle());
  await assert.rejects(asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,1,$3,$4,$5::jsonb,false)',
    [wa, production, '00000000-0000-4000-8000-000000000073', 'apply_production_plan', bundle],
  )), /confirmation is required/i);
  await assert.rejects(asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,1,$3,$4,$5::jsonb,true)',
    [wa, production, '00000000-0000-4000-8000-000000000074', 'not_a_director_operation', bundle],
  )), /unsupported director operation type/i);
  assert.equal(await scalar('select count(*) from tonde.scenes where production_id=$1', [production]), 0);
});

test('apply_director_operation writes canonical Scenes, Story, Characters, Script, Style and Reality once', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Prompt 4 apply','commercial')", [wa]));
  const operation = '00000000-0000-4000-8000-000000000075';
  const bundle = asLiteral(prompt4Bundle());
  const applied = await asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,1,$3,$4,$5::jsonb,true)',
    [wa, production, operation, 'apply_production_plan', bundle],
  ));
  assert.equal(applied.idempotent, false);
  assert.equal(await scalar("select sum(planned_duration_ms)::text from tonde.scenes where production_id=$1 and lifecycle='active'", [production]), '30000');
  assert.equal(await scalar('select count(*) from tonde.creative_stories where production_id=$1', [production]), 1);
  assert.equal(await scalar('select count(*) from tonde.director_briefs where production_id=$1', [production]), 1);
  assert.equal(await scalar("select count(*) from tonde.assets where workspace_id=$1 and asset_type='character' and name='Barista'", [wa]), 1);
  assert.equal(await scalar("select count(*) from tonde.assets where workspace_id=$1 and asset_type='environment' and name='Kitchen'", [wa]), 1);
  assert.equal(await scalar("select count(*) from tonde.assets where workspace_id=$1 and asset_type='product' and name='Ridgeway coffee'", [wa]), 1);
  assert.equal(await scalar("select count(*) from tonde.assets where workspace_id=$1 and asset_type='style_bible'", [wa]), 1);
  assert.equal(await scalar('select count(*) from tonde.dialogue_lines where production_id=$1', [production]), 1);
  assert.ok(await scalar('select count(*) from tonde.creative_documents where production_id=$1', [production]) >= 3);
  // An unsupported dialogue line kind is refused rather than stored.
  const bogus = prompt4Bundle();
  bogus.script.scenes[1].lines[0].kind = 'onscreen_text';
  await assert.rejects(asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,2,$3,$4,$5::jsonb,true)',
    [wa, production, '00000000-0000-4000-8000-00000000007a', 'apply_production_plan', asLiteral(bogus)],
  )), /unsupported dialogue line kind/i);
  assert.equal(await scalar('select count(*) from tonde.scene_participants where production_id=$1', [production]), 2);
  assert.equal(await scalar('select count(*) from tonde.scenes where production_id=$1 and environment_asset_id is not null', [production]), 2);
  assert.equal(await scalar("select scene_detail->>'plan_order' from tonde.scenes where production_id=$1 and title='Weighing'", [production]), '2');
  assert.equal(await scalar('select approval from tonde.productions where id=$1', [production]), 'draft');

  // Replaying the identical operation is idempotent and duplicates nothing.
  const replay = await asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,2,$3,$4,$5::jsonb,true)',
    [wa, production, operation, 'apply_production_plan', bundle],
  ));
  assert.equal(replay.idempotent, true);
  assert.equal(await scalar("select count(*) from tonde.scenes where production_id=$1 and lifecycle='active'", [production]), 2);
  assert.equal(await scalar('select count(*) from tonde.creative_stories where production_id=$1', [production]), 1);
  assert.equal(await scalar('select count(*) from tonde.dialogue_lines where production_id=$1', [production]), 1);

  // The same operation id with different content is refused rather than silently overwritten.
  await assert.rejects(asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,2,$3,$4,$5::jsonb,true)',
    [wa, production, operation, 'apply_production_plan', asLiteral(prompt4Bundle({ producer: 'model' }))],
  )), /already applied with different content/i);
});

test('apply_director_operation rejects a stale revision, a non-exact Scene sum and keeps archived history', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Prompt 4 guards','commercial')", [wa]));
  await assert.rejects(asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,9,$3,$4,$5::jsonb,true)',
    [wa, production, '00000000-0000-4000-8000-000000000076', 'apply_production_plan', asLiteral(prompt4Bundle())],
  )), /reload before applying|changed/i);
  assert.equal(await scalar('select count(*) from tonde.scenes where production_id=$1', [production]), 0);

  const broken = prompt4Bundle();
  broken.scenes[1].duration_ms = 17000;
  await assert.rejects(asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,1,$3,$4,$5::jsonb,true)',
    [wa, production, '00000000-0000-4000-8000-000000000077', 'apply_production_plan', asLiteral(broken)],
  )), /must equal the production target exactly/i);
  assert.equal(await scalar('select count(*) from tonde.scenes where production_id=$1', [production]), 0);

  await asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,1,$3,$4,$5::jsonb,true)',
    [wa, production, '00000000-0000-4000-8000-000000000078', 'apply_production_plan', asLiteral(prompt4Bundle())],
  ));
  await asUser(A, () => scalar(
    'select tonde.apply_director_operation($1,$2,2,$3,$4,$5::jsonb,true)',
    [wa, production, '00000000-0000-4000-8000-000000000079', 'director_command', asLiteral(prompt4Bundle())],
  ));
  assert.equal(await scalar("select count(*) from tonde.scenes where production_id=$1 and lifecycle='active'", [production]), 2);
  assert.equal(await scalar("select count(*) from tonde.scenes where production_id=$1 and lifecycle='archived'", [production]), 2);
});

test('Director Brief, decision ledger and operation log persist through their guarded RPCs', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Prompt 4 records','commercial')", [wa]));
  const brief = {
    production_goal: 'Create a 30-second premium coffee commercial', audience: 'Home espresso drinkers',
    runtime: { kind: 'exact', exact_ms: 30000 },
    assumptions: [{ statement: 'No brand was supplied.', basis: 'Goal wording', status: 'assumption' }],
    open_decisions: [{ id: 'product', priority: 'blocking', impact: 'critical' }], conflicts: [],
  };
  const saved = await asUser(A, () => scalar(
    "select tonde.save_director_brief($1,$2,null,$3::jsonb,null,'deterministic')", [wa, production, asLiteral(brief)],
  ));
  assert.equal(saved.revision, 1);
  const updated = await asUser(A, () => scalar(
    "select tonde.save_director_brief($1,$2,1,$3::jsonb,null,'deterministic')", [wa, production, asLiteral(brief)],
  ));
  assert.equal(updated.revision, 2);
  await assert.rejects(asUser(A, () => scalar(
    "select tonde.save_director_brief($1,$2,1,$3::jsonb,null,'deterministic')", [wa, production, asLiteral(brief)],
  )), /brief changed|reload/i);
  await assert.rejects(asUser(A, () => scalar(
    "select tonde.save_director_brief($1,$2,null,$3::jsonb,null,'deterministic')",
    [wa, production, asLiteral({ production_goal: '' })],
  )), /invalid structured brief/i);

  // Decisions are recorded once and updated in place rather than duplicated.
  await asUser(A, () => scalar(
    "select tonde.record_director_decisions($1,$2,$3::jsonb,'studio')",
    [wa, production, asLiteral([{ decision_id: 'product', question: 'Which Product?', answer: 'Ridgeway coffee', priority: 'blocking', impact: 'critical' }])],
  ));
  await asUser(A, () => scalar(
    "select tonde.record_director_decisions($1,$2,$3::jsonb,'correction')",
    [wa, production, asLiteral([{ decision_id: 'product', question: '', answer: 'Ridgeway filter roast', priority: 'high_impact', impact: 'high', is_correction: true }])],
  ));
  assert.equal(await scalar('select count(*) from tonde.director_decisions where production_id=$1', [production]), 1);
  assert.equal(await scalar("select answer from tonde.director_decisions where production_id=$1 and decision_id='product'", [production]), 'Ridgeway filter roast');
  assert.equal(await scalar("select is_correction from tonde.director_decisions where production_id=$1 and decision_id='product'", [production]), true);
  await assert.rejects(asUser(A, () => scalar(
    "select tonde.record_director_decisions($1,$2,$3::jsonb,'nonsense')", [wa, production, asLiteral([])],
  )), /unsupported decision source/i);

  const outcome = await asUser(A, () => scalar(
    'select tonde.record_director_operation($1,$2,$3::jsonb)',
    [wa, production, asLiteral({
      operation_id: '00000000-0000-4000-8000-000000000080', operation_type: 'story_generation', scope: 'story',
      source_revision: 1, status: 'succeeded', producer: 'deterministic', provider: 'deterministic-domain',
      model: 'tonde-domain-engine', model_profile: 'default', attempts: 1, repaired: false,
      idempotency_key: 'story:demo', collaboration_mode: 'stop_at_major_decisions',
      rationale: 'Deterministic Story.', limitations: [],
    })],
  ));
  assert.equal(outcome.status, 'succeeded');
  assert.equal(await scalar('select count(*) from tonde.director_operations where production_id=$1', [production]), 1);
  // Forward 053: a repeat request carries a stable key (operation type, revisions, payload digest) but a
  // fresh process-local id. That is the same operation, so it must reconcile rather than fail the unique
  // (workspace_id, idempotency_key) constraint the way migration 012 did.
  const repeat = await asUser(A, () => scalar(
    'select tonde.record_director_operation($1,$2,$3::jsonb)',
    [wa, production, asLiteral({
      operation_id: '00000000-0000-4000-8000-000000000081', operation_type: 'story_generation', scope: 'story',
      source_revision: 1, status: 'succeeded', producer: 'deterministic', provider: 'deterministic-domain',
      model: 'tonde-domain-engine', model_profile: 'default', attempts: 1, repaired: false,
      idempotency_key: 'story:demo', collaboration_mode: 'stop_at_major_decisions',
      rationale: 'Deterministic Story.', limitations: [],
    })],
  ));
  assert.equal(repeat.idempotent, true, 'a repeated key reconciles instead of inserting');
  assert.equal(repeat.operation_id, '00000000-0000-4000-8000-000000000080', 'the recorded operation is returned');
  assert.equal(await scalar('select count(*) from tonde.director_operations where production_id=$1', [production]), 1);
  // Reusing a recorded operation id under a different key stays a mapped conflict, never a raw 503.
  const keyReuse = await asUser(A, () => scalar(
    'select tonde.record_director_operation($1,$2,$3::jsonb)',
    [wa, production, asLiteral({
      operation_id: '00000000-0000-4000-8000-000000000080', operation_type: 'story_generation', scope: 'story',
      source_revision: 1, status: 'succeeded', producer: 'deterministic', idempotency_key: 'story:rewritten',
    })],
  ).catch(error => error));
  assert.equal(keyReuse.code, 'PT409', 'an operation id reused with a different key is a mapped conflict');
  const otherProduction = await asUser(A, () => scalar(
    "select tonde.create_project_with_production($1, 'Another film', 'short_film')", [wa],
  ));
  const crossProduction = await asUser(A, () => scalar(
    'select tonde.record_director_operation($1,$2,$3::jsonb)',
    [wa, otherProduction, asLiteral({ operation_id: crypto.randomUUID(), operation_type: 'story_generation',
      status: 'succeeded', idempotency_key: 'story:demo', source_revision: 1 })],
  ).catch(error => error));
  assert.equal(crossProduction.code, 'PT409', 'workspace-wide keys cannot reconcile another Production');
  const wrongType = await asUser(A, () => scalar(
    'select tonde.record_director_operation($1,$2,$3::jsonb)',
    [wa, production, asLiteral({ operation_id: crypto.randomUUID(), operation_type: 'reference_analysis',
      status: 'succeeded', idempotency_key: 'story:demo', source_revision: 1 })],
  ).catch(error => error));
  assert.equal(wrongType.code, 'PT409', 'the operation type is part of the recorded identity');
  // The operation log itself is readable by the owner and invisible to another workspace.
  assert.equal(await asUser(B, () => scalar('select count(*) from tonde.director_operations where production_id=$1', [production])), 0);
});

test('reference analysis persists capability, staged progress, findings and techniques truthfully', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Prompt 4 reference','commercial')", [wa]));
  const reference = await asUser(A, () => scalar(
    "insert into tonde.production_references(workspace_id,production_id,source_type,source_description,rights_classification) values($1,$2,'upload','Creator reference','user_owned') returning id",
    [wa, production],
  ));
  // Amendment B: identity and creator purpose are established by the scoped creator action, not
  // written beside it, before an analysis of the Reference counts as Production shaping evidence.
  await asUser(A, () => scalar('select tonde.reference_identity_save($1,$2,$3,$4,$5)',
    [wa, production, reference, 1, JSON.stringify({
      source_identity: 'Creator reference upload', source_identity_verified: true,
      creator_purpose: 'Learn the camera movement and the reveal pacing for this Production',
    })]));

  const claimed = await asUser(A, () => scalar(
    "select tonde.claim_reference_analysis($1,$2,$3,'preprocessing',array['queued','preprocessing'],10,'Preprocessing metadata and frames.')",
    [wa, production, reference],
  ));
  assert.equal(claimed.status, 'preprocessing');

  const analysis = {
    identity_revision: await scalar('select identity_revision from tonde.production_references where id=$1', [reference]),
    role: 'camera', capability: 'partial_media_available', status: 'complete',
    stages: ['queued', 'preprocessing', 'analyzing', 'synthesizing'],
    progress: 100, summary: 'A slow push reveals the Product after a lifestyle setup.',
    capabilities: { modalities: { image: 'available', audio: 'unavailable' } },
    style: { sections: [{ section: 'camera', description: 'Slow single-direction moves.' }] },
    causal: [{ question: 'What makes this work?', explanation: 'Withholding detail makes the reveal feel premium.' }],
    adaptation_notes: ['Use the push for the hero moment.'], limitations: ['No audio track was available.'],
    producer: 'deterministic', model_profile: 'default', producer_note: 'Measured evidence only.',
  };
  const findings = [
    {
      finding_id: 'push', category: 'camera', statement: 'Slow push toward the Product.', epistemic: 'observed', confidence: 'high',
      evidence: [{ kind: 'time_range', start_ms: 8200, end_ms: 11700, detail: 'measured motion' }], limitations: [],
    },
    {
      finding_id: 'pacing', category: 'pacing', statement: 'Pacing reads as unhurried.', epistemic: 'estimated', confidence: 'medium',
      evidence: [{ kind: 'measurement', detail: 'cut density' }], limitations: [],
    },
    {
      finding_id: 'focal', category: 'camera', statement: 'Focal length is unknown.', epistemic: 'unknown', confidence: 'low',
      evidence: [], limitations: ['Exact camera settings are never inferred.'],
    },
  ];
  const techniques = [{
    canonical_id: 'delayed-product-reveal', name: 'Delayed Product reveal', category: 'product',
    description: 'Macro detail is withheld until after the lifestyle setup.', purpose: 'Make the reveal feel earned.',
    effect: 'The hero Shot lands harder.', conditions: ['Product is present but hidden'],
    practical_concept: 'Shoot the lifestyle beat first and hold the macro block for the end.',
    ai_concept: 'Request a two-block structure with the Product detail in the second half.', limitations: [],
    importance: 'essential', confidence: 'medium', technique_source: 'reference',
  }];
  const saved = await asUser(A, () => scalar(
    'select tonde.save_reference_analysis($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,null)',
    [wa, production, reference, asLiteral(analysis), asLiteral(findings), asLiteral(techniques)],
  ));
  assert.equal(saved.findings, 3);
  assert.equal(saved.techniques, 1);
  assert.equal(await scalar('select count(*) from tonde.reference_findings where analysis_id=$1', [saved.analysis_id]), 3);
  assert.equal(await scalar('select capability from tonde.reference_analyses where id=$1', [saved.analysis_id]), 'partial_media_available');
  assert.equal(await scalar('select status from tonde.reference_analyses where id=$1', [saved.analysis_id]), 'complete');
  assert.equal(await scalar('select progress from tonde.reference_analyses where id=$1', [saved.analysis_id]), 100);
  assert.equal(await scalar("select count(*) from tonde.creative_techniques where workspace_id=$1 and canonical_id='delayed-product-reveal'", [wa]), 1);
  assert.equal(await scalar('select count(*) from tonde.reference_technique_links where analysis_id=$1', [saved.analysis_id]), 1);

  // An observed finding without evidence is refused at the database boundary too.
  const unprovable = [{
    finding_id: 'lighting', category: 'lighting', statement: 'Soft key from camera left.', epistemic: 'observed', confidence: 'high', evidence: [],
  }];
  await assert.rejects(asUser(A, () => scalar(
    "select tonde.save_reference_analysis($1,$2,$3,$4::jsonb,$5::jsonb,'[]'::jsonb,null)",
    [wa, production, reference, asLiteral(analysis), asLiteral(unprovable)],
  )), /observed finding must cite evidence/i);

  // An unsupported capability or status is refused rather than stored.
  await assert.rejects(asUser(A, () => scalar(
    "select tonde.save_reference_analysis($1,$2,$3,$4::jsonb,'[]'::jsonb,'[]'::jsonb,null)",
    [wa, production, reference, asLiteral({ ...analysis, capability: 'definitely_analysed' })],
  )), /unsupported reference capability/i);

  // Re-saving replaces findings instead of accumulating duplicates.
  await asUser(A, () => scalar(
    'select tonde.save_reference_analysis($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,null)',
    [wa, production, reference, asLiteral(analysis), asLiteral(findings), asLiteral(techniques)],
  ));
  assert.equal(await scalar('select count(*) from tonde.reference_findings where analysis_id=$1', [saved.analysis_id]), 3);
  assert.equal(await scalar('select count(*) from tonde.reference_analyses where production_id=$1', [production]), 1);

  // Another workspace can neither read nor write this analysis.
  assert.equal(await asUser(B, () => scalar('select count(*) from tonde.reference_analyses where production_id=$1', [production])), 0);
  await assert.rejects(asUser(B, () => scalar(
    "select tonde.save_reference_analysis($1,$2,$3,$4::jsonb,'[]'::jsonb,'[]'::jsonb,null)",
    [wa, production, reference, asLiteral(analysis)],
  )), /workspace editor|permission denied|row-level security/i);
});

test('Prompt 4 RPCs are executable only by authenticated members and never by anon or service_role', async () => {
  const signatures = [
    'tonde.record_director_operation(uuid,uuid,jsonb)',
    'tonde.save_director_brief(uuid,uuid,integer,jsonb,uuid,text)',
    'tonde.record_director_decisions(uuid,uuid,jsonb,text)',
    'tonde.save_reference_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)',
    'tonde.claim_reference_analysis(uuid,uuid,uuid,text,text[],integer,text)',
    'tonde.apply_director_operation(uuid,uuid,integer,uuid,text,jsonb,boolean)',
  ];
  for (const signature of signatures) {
    assert.equal(await scalar(`select to_regprocedure('${signature}') is not null`), true, `${signature} exists`);
    assert.equal(await scalar(`select has_function_privilege('authenticated', '${signature}', 'EXECUTE')`), true, `${signature} authenticated`);
    assert.equal(await scalar(`select has_function_privilege('anon', '${signature}', 'EXECUTE')`), false, `${signature} anon`);
    assert.equal(await scalar(`select has_function_privilege('service_role', '${signature}', 'EXECUTE')`), false, `${signature} service_role`);
  }
  // The internal apply helper and the guard are never reachable from a client role.
  assert.equal(await scalar("select has_function_privilege('authenticated', 'tonde_private.director_apply_assets(uuid,uuid,uuid,jsonb)', 'EXECUTE')"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated', 'tonde_private.director_guard(uuid)', 'EXECUTE')"), false);
});
