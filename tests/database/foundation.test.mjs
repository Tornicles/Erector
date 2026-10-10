import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Real embedded PostgreSQL, with minimal Supabase platform schemas. This does NOT
// emulate Auth HTTP, OAuth providers, Storage HTTP, PostgREST or hosted settings.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const V = '00000000-0000-4000-8000-000000000003';
let wa, wb, pa, pb, projectA;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
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
  for (const id of [A, B, V]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asUser(A, () => scalar('select tonde.bootstrap_workspace()'));
  wb = await asUser(B, () => scalar('select tonde.bootstrap_workspace()'));
  pa = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Production A','short_film')", [wa]));
  pb = await asUser(B, () => scalar("select tonde.create_project_with_production($1,'Production B','photography')", [wb]));
  projectA = await scalar('select project_id from tonde.productions where id=$1', [pa]);
});
after(async () => { if (db) await db.close(); });

test('all migrations run on a clean database and every app table enables RLS', async () => {
  const rows = (await db.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('tonde','tonde_private') and c.relkind='r'")).rows;
  assert.ok(rows.length >= 35);
  assert.ok(rows.every(r => r.relrowsecurity));
  assert.equal(await scalar('select count(*) from storage.buckets where public'), 0);
});
test('forward security repair revokes inherited client EXECUTE on the external public event-trigger helper', async () => {
  const migration = await readFile('supabase/migrations/202610050009_revoke_public_rls_admin.sql', 'utf8');
  await db.exec("create function public.rls_auto_enable() returns void language sql as $$ select $$; grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role;");
  await db.exec(migration);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(await scalar(`select has_function_privilege('${role}', 'public.rls_auto_enable()', 'EXECUTE')`), false);
  }
});
test('policy helpers leave tonde RPCs and grant only scoped authenticated policy execution', async () => {
  for (const name of ['is_workspace_member', 'can_edit_workspace', 'is_workspace_admin']) {
    assert.equal(await scalar(`select to_regprocedure('tonde.${name}(uuid)') is null`), true);
    assert.equal(await scalar(`select to_regprocedure('tonde_private.${name}(uuid)') is not null`), true);
    assert.equal(await scalar(`select has_function_privilege('authenticated', 'tonde_private.${name}(uuid)', 'EXECUTE')`), true);
    assert.equal(await scalar(`select has_function_privilege('anon', 'tonde_private.${name}(uuid)', 'EXECUTE')`), false);
    assert.equal(await scalar(`select has_function_privilege('service_role', 'tonde_private.${name}(uuid)', 'EXECUTE')`), false);
  }
  for (const [name, signature] of [
    ['bootstrap_workspace', 'tonde.bootstrap_workspace()'],
    ['create_project_with_production', 'tonde.create_project_with_production(uuid,text,tonde.production_type)'],
  ]) {
    assert.equal(await scalar(`select has_function_privilege('authenticated', to_regprocedure('${signature}'), 'EXECUTE')`), true, `${name} authenticated API`);
    assert.equal(await scalar(`select has_function_privilege('anon', to_regprocedure('${signature}'), 'EXECUTE')`), false, `${name} anon denial`);
    assert.equal(await scalar(`select has_function_privilege('service_role', to_regprocedure('${signature}'), 'EXECUTE')`), false, `${name} service-role denial`);
  }
  // Storage policy helpers are invoked as authenticated clients by RLS. Signed uploads are
  // authorized through the separate creator-scoped RPC, not by granting helper access to servers.
  for (const [name, args, serviceRole] of [['can_read_storage_object', 'text,text', false], ['can_upload_storage_object', 'text,text', false]]) {
    assert.equal(await scalar(`select to_regprocedure('tonde.${name}(${args})') is null`), true);
    assert.equal(await scalar(`select has_function_privilege('authenticated', 'tonde_private.${name}(${args})', 'EXECUTE')`), true);
    assert.equal(await scalar(`select has_function_privilege('anon', 'tonde_private.${name}(${args})', 'EXECUTE')`), false);
    assert.equal(await scalar(`select has_function_privilege('service_role', 'tonde_private.${name}(${args})', 'EXECUTE')`), serviceRole, `${name} service-role`);
  }
});
test('automatic personal workspace/profile/preferences bootstrap is idempotent', async () => {
  assert.equal(await asUser(A, () => scalar('select tonde.bootstrap_workspace()')), wa);
  assert.equal(await scalar('select count(*) from tonde.workspaces where owner_user_id=$1', [A]), 1);
  assert.equal(await scalar('select default_workspace_id from tonde.profiles where user_id=$1', [A]), wa);
  assert.equal(await scalar('select role from tonde.workspace_members where workspace_id=$1 and user_id=$2', [wa,A]), 'owner');
  assert.equal(await scalar('select count(*) from tonde.user_preferences where user_id=$1', [A]), 1);
});
test('two authenticated users cannot read or update another workspace by ID', async () => {
  assert.equal(await asUser(A, () => scalar('select count(*) from tonde.productions where id=$1', [pb])), 0);
  assert.equal(await asUser(B, () => scalar('select count(*) from tonde.productions where id=$1', [pa])), 0);
  const result = await asUser(B, () => db.query("update tonde.productions set title='Intrusion' where id=$1 returning id", [pa]));
  assert.equal(result.rows.length, 0);
  await assert.rejects(asUser(A, () => db.query("insert into tonde.projects(workspace_id,title) values($1,'Intrusion')", [wb])), /row-level security/i);
  await assert.rejects(asUser(A, () => db.query('update tonde.productions set workspace_id=$1 where id=$2', [wb,pa])), /immutable/i);
});
test('viewer cannot write, self-promote, forge audit or overwrite history', async () => {
  await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [wa,V]);
  assert.equal(await asUser(V, () => scalar('select count(*) from tonde.productions where id=$1', [pa])), 1);
  const result = await asUser(V, () => db.query("update tonde.productions set title='No' where id=$1 returning id", [pa]));
  assert.equal(result.rows.length, 0);
  await assert.rejects(asUser(V, () => db.query("update tonde.workspace_members set role='owner' where workspace_id=$1 and user_id=$2", [wa,V])), /permission denied/i);
  await assert.rejects(asUser(A, () => db.query("insert into tonde.audit_events(workspace_id,event_type,object_kind) values($1,'forged','project')", [wa])), /permission denied/i);
  await assert.rejects(asUser(A, () => db.exec('delete from tonde.object_versions')), /permission denied/i);
});
test('project/production CRUD uses optimistic revision, archive and restrictive delete', async () => {
  const created = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Archive test')", [wa]));
  await asUser(A, () => db.query("update tonde.productions set title='Updated' where id=$1 and revision=1", [created]));
  assert.equal(await scalar('select revision from tonde.productions where id=$1', [created]), 2);
  const stale = await asUser(A, () => db.query("update tonde.productions set title='Stale' where id=$1 and revision=1 returning id", [created]));
  assert.equal(stale.rows.length, 0);
  await asUser(A, () => db.query("update tonde.productions set lifecycle='archived' where id=$1", [created]));
  assert.equal(await scalar('select lifecycle from tonde.productions where id=$1', [created]), 'archived');
  await asUser(A, () => db.query("update tonde.projects set lifecycle='archived' where id=(select project_id from tonde.productions where id=$1)", [created]));
  await assert.rejects(asUser(A, () => db.query('delete from tonde.productions where id=$1', [created])), /permission denied/i);
  assert.equal(await scalar('select count(*) from tonde.object_versions where object_id=$1', [created]), 3);
});
test('hierarchy preserves identities/order and rejects cross-production/workspace links and negative durations', async () => {
  const seq = await asUser(A, () => scalar("insert into tonde.sequences(workspace_id,production_id,title) values($1,$2,'Sequence') returning id", [wa,pa]));
  const scene = await asUser(A, () => scalar("insert into tonde.scenes(workspace_id,production_id,sequence_id,title) values($1,$2,$3,'Scene') returning id", [wa,pa,seq]));
  const shot = await asUser(A, () => scalar("insert into tonde.shots(workspace_id,production_id,scene_id,title,planned_duration_ms) values($1,$2,$3,'Shot',3333) returning id", [wa,pa,scene]));
  await asUser(A, () => db.query('update tonde.shots set sort_order=4096 where id=$1', [shot]));
  assert.equal(await scalar('select id from tonde.shots where scene_id=$1 and sort_order=4096', [scene]), shot);
  await assert.rejects(asUser(A, () => db.query("insert into tonde.scenes(workspace_id,production_id,sequence_id,title,sort_order) values($1,$2,$3,'Invalid',2048)", [wa,pa,'00000000-0000-4000-8000-999999999999'])), /foreign key/i);
  await assert.rejects(asUser(A, () => db.query("insert into tonde.shots(workspace_id,production_id,title,sort_order,planned_duration_ms) values($1,$2,'Invalid',8192,-1)", [wa,pa])), /check constraint/i);
  const foreignProject = await scalar('select project_id from tonde.productions where id=$1',[pb]);
  await assert.rejects(asUser(A, () => db.query("insert into tonde.productions(workspace_id,project_id,title) values($1,$2,'Invalid')", [wa,foreignProject])), /foreign key/i);
  assert.equal(await scalar('select sum(planned_duration_ms)::text from tonde.shots where production_id=$1',[pa]), '3333');
});
test('assets, media and scoped bindings stay independent and within tenant/production', async () => {
  const asset = await asUser(A, () => scalar("insert into tonde.assets(workspace_id,asset_type,name) values($1,'character','Marcus') returning id", [wa]));
  const mid = '00000000-0000-4000-8000-000000000010';
  const key = `${wa}/${mid}/reference.png`;
  await asUser(A, () => db.query("insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes) values($1,$2,'tonde-asset-references',$3,'reference.png','image/png','image',100)",[mid,wa,key]));
  await asUser(A, () => db.query('insert into tonde.asset_media(workspace_id,asset_id,media_id) values($1,$2,$3)',[wa,asset,mid]));
  await asUser(A, () => db.query("insert into tonde.scope_bindings(workspace_id,production_id,scope_object_id,asset_id,binding_role) values($1,$2,$2,$3,'character')",[wa,pa,asset]));
  await assert.rejects(asUser(A, () => db.query("insert into tonde.scope_bindings(workspace_id,production_id,scope_object_id,asset_id,binding_role) values($1,$2,$3,$4,'character')",[wa,pa,pb,asset])), /scope|foreign key/i);
  const assetB = await asUser(B, () => scalar("insert into tonde.assets(workspace_id,asset_type,name) values($1,'character','Other talent') returning id", [wb]));
  await assert.rejects(asUser(B, () => db.query('insert into tonde.asset_media(workspace_id,asset_id,media_id) values($1,$2,$3)',[wb,assetB,mid])), /foreign key/i);
  assert.equal(await asUser(B, () => scalar('select count(*) from tonde.assets where id=$1',[asset])),0);
});
test('Storage upload requires a creator-owned open intent, not client-created media metadata', async () => {
  const legacyMediaId = '00000000-0000-4000-8000-000000000011';
  const legacyKey = `${wa}/${legacyMediaId}/original.mp4`;
  await asUser(A, () => db.query(`insert into tonde.media_files
    (id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes,created_by)
    values($1,$2,'tonde-results',$3,'legacy.mp4','video/mp4','video',2048,$4)`,
    [legacyMediaId, wa, legacyKey, A]));
  assert.equal(await asUser(A, () => scalar(
    'select tonde_private.can_upload_storage_object($1,$2)', ['tonde-results', legacyKey])), false,
    'a pending media row without an intent is not an upload authorization');
  await assert.rejects(asUser(A, () => db.query(
    'insert into storage.objects(bucket_id,name) values($1,$2)', ['tonde-results', legacyKey])), /row-level security/i);

  const created = (await asUser(A, () => db.query(
    'select tonde.media_upload_intent_create($1,$2,$3,$4,$5,$6,$7,$8) as result',
    [wa, 'result', 'foundation-take.mp4', 'video/mp4', 2048, null, false, null]))).rows[0].result;
  const media = (await db.query('select * from tonde.media_files where id=$1', [created.media_id])).rows[0];
  const signedRequest = await asUser(A, () => scalar(
    'select tonde.media_upload_signed_request($1,$2)', [wa, created.intent_id]));
  assert.equal(signedRequest.intent_id, created.intent_id);
  assert.equal(signedRequest.media_id, created.media_id);
  assert.equal(signedRequest.bucket, media.bucket);
  assert.equal(signedRequest.object_key, media.object_key);
  assert.equal(await asUser(B, () => scalar(
    'select tonde_private.can_upload_storage_object($1,$2)', [media.bucket, media.object_key])), false);
  await asUser(A, () => db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[media.bucket,media.object_key]));
  assert.equal(await asUser(A, () => scalar('select count(*) from storage.objects')),1);
  assert.equal(await asUser(B, () => scalar('select count(*) from storage.objects')),0);
  await assert.rejects(asUser(B, () => db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[media.bucket,media.object_key])), /row-level security/i);
  await assert.rejects(asUser(A, () => db.query("insert into storage.objects(bucket_id,name) values('tonde-uploads',$1)",[wa+'/guess.mp4'])), /row-level security/i);
  assert.equal(await scalar("select has_function_privilege('service_role', 'tonde.media_upload_signed_request(uuid,uuid)', 'EXECUTE')"), false);
  await asUser(A, () => db.query('select tonde.media_upload_abort($1,$2,$3)', [wa, created.intent_id, 'close test']));
  await assert.rejects(asUser(A, () => db.query(
    'select tonde.media_upload_signed_request($1,$2)', [wa, created.intent_id])), /UPLOAD_INTENT_CLOSED/i);
  await db.exec('begin; set local role anon;');
  assert.equal(await scalar('select count(*) from storage.objects'),0);
  await db.exec('rollback');
});
test('Setup equipment kits work; environments cannot become production resources', async () => {
  const camera = await asUser(A, () => scalar("insert into tonde.production_resources(workspace_id,resource_type,name,mount) values($1,'camera','Travel camera','E') returning id",[wa]));
  const kit = await asUser(A, () => scalar("insert into tonde.equipment_kits(workspace_id,name) values($1,'Travel Kit') returning id",[wa]));
  await asUser(A, () => db.query('insert into tonde.kit_resources(workspace_id,kit_id,resource_id) values($1,$2,$3)',[wa,kit,camera]));
  assert.equal(await asUser(A, () => scalar('select count(*) from tonde.kit_resources where kit_id=$1',[kit])),1);
  await assert.rejects(asUser(A, () => db.query("insert into tonde.production_resources(workspace_id,resource_type,name) values($1,'environment','Apartment')",[wa])), /invalid input/i);
});
test('approval and lock differ; revisions and history are attributed and immutable', async () => {
  await asUser(A, () => db.query("update tonde.productions set approval='approved' where id=$1",[pa]));
  await asUser(A, () => db.query("update tonde.productions set title='Changed creative truth' where id=$1",[pa]));
  assert.equal(await scalar('select approval from tonde.productions where id=$1',[pa]),'changed_after_approval');
  await asUser(A, () => db.query('update tonde.productions set locked_at=now() where id=$1',[pa]));
  await assert.rejects(asUser(A, () => db.query("update tonde.productions set title='Locked change' where id=$1",[pa])), /unlock/i);
  const versions=(await db.query('select * from tonde.object_versions where object_id=$1 order by revision',[pa])).rows;
  assert.ok(versions.length>=4);
  assert.ok(versions.every(v=>v.actor_user_id===A));
  assert.ok(versions.slice(1).every(v=>v.parent_version_id));
});
test('series episodes may omit seasons, but cannot cross project boundaries', async () => {
  const seriesId = await asUser(A, () => scalar("insert into tonde.series(workspace_id,project_id,title) values($1,$2,'Daily series') returning id", [wa,projectA]));
  await asUser(A, () => db.query('insert into tonde.series_episodes(workspace_id,series_id,production_id,episode_number) values($1,$2,$3,1)', [wa,seriesId,pa]));
  assert.equal(await scalar('select collection_id from tonde.series_episodes where production_id=$1',[pa]),null);
  await assert.rejects(asUser(A,()=>db.query("insert into tonde.director_threads(workspace_id,production_id,scope_object_id,scope_type) values($1,$2,$3,'story')",[wa,pa,seriesId])),/another production/i);
  const other = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Different project')",[wa]));
  await assert.rejects(asUser(A, () => db.query('insert into tonde.series_episodes(workspace_id,series_id,production_id,episode_number) values($1,$2,$3,2)',[wa,seriesId,other])),/share a project/i);
});
test('Real and AI plans share a shot without duplicating creative truth', async () => {
  const shot = await scalar('select id from tonde.shots where production_id=$1 limit 1',[pa]);
  await asUser(A,()=>db.query("insert into tonde.execution_plans(workspace_id,production_id,shot_id,execution_method) values($1,$2,$3,'real')",[wa,pa,shot]));
  await asUser(A,()=>db.query("insert into tonde.execution_plans(workspace_id,production_id,shot_id,execution_method,provider,model) values($1,$2,$3,'ai','unconfigured','future-model')",[wa,pa,shot]));
  assert.equal(await scalar('select count(*) from tonde.execution_plans where shot_id=$1',[shot]),2);
  assert.equal(await scalar('select count(*) from tonde.shots where id=$1',[shot]),1);
});
test('Director messages are scoped, append-only and users cannot impersonate TONDE', async () => {
  const thread = await asUser(A,()=>scalar("insert into tonde.director_threads(workspace_id,production_id,scope_object_id,scope_type) values($1,$2,$2,'production') returning id",[wa,pa]));
  await asUser(A,()=>db.query("insert into tonde.director_messages(workspace_id,thread_id,role,content) values($1,$2,'user','A direction')",[wa,thread]));
  assert.equal(await asUser(B,()=>scalar('select count(*) from tonde.director_messages where thread_id=$1',[thread])),0);
  await assert.rejects(asUser(A,()=>db.query("insert into tonde.director_messages(workspace_id,thread_id,role,content) values($1,$2,'tonde','Impersonation')",[wa,thread])),/row-level security/i);
  await assert.rejects(asUser(A,()=>db.query("update tonde.director_messages set content='Rewrite' where thread_id=$1",[thread])),/permission denied/i);
});
test('Director plan proposal applies atomically, preserves timing and is idempotent', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Director acceptance','commercial')", [wa]));
  const intent = {
    goal: 'Create an original 30-second coffee commercial',
    collaboration_mode: 'complete_first_draft',
    constraints: {},
    answered_decisions: {},
    selected_reference_ids: [],
  };
  const saved = await asUser(A, () => scalar(
    'select tonde.save_director_intake($1,$2,null,$3::jsonb)', [wa, production, JSON.stringify(intent)],
  ));
  assert.equal(saved.status, 'intake');
  const plan = {
    title: 'Coffee commercial', production_type: 'commercial', execution_method: 'real',
    planned_duration_ms: 30000, creative_objective: intent.goal,
    scenes: [
      { title: 'Product reveal', purpose: 'Establish the coffee as hero', description: 'A controlled close reveal.', duration_ms: 12000 },
      { title: 'Call to action', purpose: 'Invite the audience to try it', description: 'End on the product.', duration_ms: 18000 },
    ],
    story: { structure: ['Reveal', 'Invitation'], summary: 'An original product-first reveal.', dialogue_mode: 'visual' },
    assumptions: ['Audience is not yet specified.'], requirements: [],
  };
  const proposed = await asUser(A, () => scalar(
    'select tonde.save_director_plan_proposal($1,$2,1,$3,$4,$5::jsonb)',
    [wa, production, saved.revision, '00000000-0000-4000-8000-000000000099', JSON.stringify(plan)],
  ));
  assert.equal(proposed.status, 'draft_ready');
  assert.equal(await scalar('select count(*) from tonde.scenes where production_id=$1 and lifecycle=\'active\'', [production]), 0);
  const retriedProposal = await asUser(A, () => scalar(
    'select tonde.save_director_plan_proposal($1,$2,1,$3,$4,$5::jsonb)',
    [wa, production, saved.revision, '00000000-0000-4000-8000-000000000099', JSON.stringify(plan)],
  ));
  assert.equal(retriedProposal.idempotent, true);
  assert.equal(retriedProposal.revision, proposed.revision);
  assert.equal(await scalar('select count(*) from tonde.director_plan_proposals where production_id=$1', [production]), 1);
  const applied = await asUser(A, () => scalar(
    'select tonde.apply_director_plan($1,$2,1,$3,$4,true)',
    [wa, production, proposed.revision, '00000000-0000-4000-8000-000000000099'],
  ));
  assert.equal(applied.idempotent, false);
  assert.equal(await scalar('select sum(planned_duration_ms)::text from tonde.scenes where production_id=$1', [production]), '30000');
  assert.equal(await scalar('select count(*) from tonde.scenes where production_id=$1 and lifecycle=\'active\'', [production]), 2);
  assert.equal(await scalar("select count(*) from tonde.creative_documents where production_id=$1 and document_type in ('brief','story')", [production]), 2);
  assert.equal(await scalar("select approval from tonde.productions where id=$1", [production]), 'draft');
  const retried = await asUser(A, () => scalar(
    'select tonde.apply_director_plan($1,$2,1,$3,$4,true)',
    [wa, production, proposed.revision, '00000000-0000-4000-8000-000000000099'],
  ));
  assert.equal(retried.idempotent, true);
  assert.equal(await scalar('select count(*) from tonde.scenes where production_id=$1 and lifecycle=\'active\'', [production]), 2);
});
test('Director plan proposal rejects stale Production versions without creating Scenes', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Stale Director proposal','trailer')", [wa]));
  const intent = { goal: 'A short original trailer', collaboration_mode: 'stop_at_major_decisions', constraints: {}, answered_decisions: {} };
  const saved = await asUser(A, () => scalar(
    'select tonde.save_director_intake($1,$2,null,$3::jsonb)', [wa, production, JSON.stringify(intent)],
  ));
  const plan = {
    title: 'Trailer', production_type: 'trailer', execution_method: 'real',
    planned_duration_ms: 10000, creative_objective: intent.goal,
    scenes: [{ title: 'Title beat', purpose: 'Close the trailer', description: '', duration_ms: 10000 }],
    story: null, assumptions: [], requirements: [],
  };
  const operation = '00000000-0000-4000-8000-000000000098';
  const proposal = await asUser(A, () => scalar(
    'select tonde.save_director_plan_proposal($1,$2,1,$3,$4,$5::jsonb)',
    [wa, production, saved.revision, operation, JSON.stringify(plan)],
  ));
  await asUser(A, () => db.query("update tonde.productions set title='Changed while planning' where id=$1 and revision=1", [production]));
  await assert.rejects(asUser(A, () => scalar(
    'select tonde.apply_director_plan($1,$2,1,$3,$4,true)', [wa, production, proposal.revision, operation],
  )), /changed|stale/i);
  assert.equal(await scalar('select count(*) from tonde.scenes where production_id=$1 and lifecycle=\'active\'', [production]), 0);
  assert.equal(await scalar("select status from tonde.director_intakes where production_id=$1", [production]), 'draft_ready');
});
test('another workspace cannot save or apply a Director intake by ID', async () => {
  const production = await asUser(A, () => scalar("select tonde.create_project_with_production($1,'Private Director intake','short_film')", [wa]));
  const intent = { goal: 'Private idea', collaboration_mode: 'guide_step_by_step', constraints: {}, answered_decisions: {} };
  await assert.rejects(asUser(B, () => scalar(
    'select tonde.save_director_intake($1,$2,null,$3::jsonb)', [wa, production, JSON.stringify(intent)],
  )), /workspace editor|permission denied|row-level security/i);
  assert.equal(await scalar('select count(*) from tonde.director_intakes where production_id=$1', [production]), 0);
});
test('jobs and exports preserve production/version relationships and reject fake completed jobs', async () => {
  const version = await scalar("select id from tonde.object_versions where object_id=$1 order by revision desc limit 1",[pa]);
  const job = await scalar("insert into tonde.jobs(workspace_id,production_id,job_type,requested_by) values($1,$2,'export',$3) returning id",[wa,pa,A]);
  await db.query("insert into tonde.exports(workspace_id,production_id,job_id,requested_format,package_type,production_version_id,requested_by) values($1,$2,$3,'pdf','complete',$4,$5)",[wa,pa,job,version,A]);
  assert.equal(await asUser(B,()=>scalar('select count(*) from tonde.exports where production_id=$1',[pa])),0);
  await assert.rejects(db.query("update tonde.jobs set status='succeeded' where id=$1",[job]),/check constraint/i);
  const versionB = await scalar('select id from tonde.object_versions where object_id=$1 limit 1',[pb]);
  const job2 = await scalar("insert into tonde.jobs(workspace_id,production_id,job_type,requested_by) values($1,$2,'export',$3) returning id",[wa,pa,A]);
  await assert.rejects(db.query("insert into tonde.exports(workspace_id,production_id,job_id,requested_format,package_type,production_version_id,requested_by) values($1,$2,$3,'pdf','complete',$4,$5)",[wa,pa,job2,versionB,A]),/another production|foreign key/i);
});
test('large production queries remain bounded at 40 rows and exact duration sums', async () => {
  const large = await asUser(A,()=>scalar("select tonde.create_project_with_production($1,'300 shot film','long_form_film')",[wa]));
  await asUser(A,()=>db.query("insert into tonde.shots(workspace_id,production_id,title,sort_order,planned_duration_ms) select $1,$2,'Shot '||n,n*1024,3333 from generate_series(1,300) n",[wa,large]));
  const page=(await asUser(A,()=>db.query('select id,sort_order from tonde.shots where workspace_id=$1 and production_id=$2 order by sort_order limit 40',[wa,large]))).rows;
  assert.equal(page.length,40);
  assert.equal(await scalar('select sum(planned_duration_ms)::text from tonde.shots where production_id=$1',[large]),'999900');
  assert.equal(new Set(page.map(s=>s.id)).size,40);
});
test('private tokens and privileged job/billing mutations are inaccessible to users', async () => {
  await assert.rejects(asUser(A,()=>db.exec('select * from tonde_private.integration_credentials')),/permission denied/i);
  await assert.rejects(asUser(A,()=>db.query("insert into tonde.jobs(workspace_id,job_type,requested_by) values($1,'export',$2)",[wa,A])),/permission denied/i);
  await assert.rejects(asUser(A,()=>db.query("insert into tonde.director_messages(workspace_id,thread_id,role,content) values($1,gen_random_uuid(),'tonde','Fake')",[wa])),/row-level security/i);
});
