import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
let db;
const user='00000000-0000-4000-8000-000000000001';
const viewer='00000000-0000-4000-8000-000000000002';
let workspace, production, scene, shot, reference, media, result;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
async function asRole(role, identity, operation){
  await db.exec(`begin; set local role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[identity]);
  await db.query("select set_config('request.jwt.claim.role',$1,true)",[role]);
  try{const data=await operation();await db.exec('commit');return data;}catch(error){await db.exec('rollback');throw error;}
}
const human=operation=>asRole('authenticated',user,operation);
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user) $$;
    grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;`);
  const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  // Start with populated Prompt 1 state, then upgrade that same data through
  // Prompt 2 (006-007), Prompt 2.5 (008), and security repairs (009-010).
  for(const file of files.slice(0,5))await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  for(const id of [user,viewer])await db.query('insert into auth.users(id) values($1)',[id]);
  workspace=await human(()=>scalar('select tonde.bootstrap_workspace()'));
  production=await human(()=>scalar("select tonde.create_project_with_production($1,'Original production','short_film')",[workspace]));
  scene=await human(()=>scalar("insert into tonde.scenes(workspace_id,production_id,title) values($1,$2,'Scene') returning id",[workspace,production]));
  shot=await human(()=>scalar("insert into tonde.shots(workspace_id,production_id,scene_id,title) values($1,$2,$3,'Shot') returning id",[workspace,production,scene]));
  reference=await human(()=>scalar("insert into tonde.production_references(workspace_id,production_id,source_type,source_description,rights_classification,state) values($1,$2,'description','A reference','licensed','metadata_available') returning id",[workspace,production]));
  await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",[workspace,viewer]);
  for(const file of files.slice(5,7))await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  for(const file of files.slice(7))await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  workspace=await human(()=>scalar('select tonde.bootstrap_workspace()'));
  production=await human(()=>scalar('select id from tonde.productions order by created_at limit 1'));
  scene=await human(()=>scalar('select id from tonde.scenes order by created_at limit 1'));
  shot=await human(()=>scalar('select id from tonde.shots order by created_at limit 1'));
  reference=await human(()=>scalar('select id from tonde.production_references order by created_at limit 1'));
});
after(async()=>{if(db)await db.close();});

test('Prompt 2 upgrade preserves existing creative identities, rights/state data and version history',async()=>{
  assert.equal(await scalar('select title from tonde.productions where id=$1',[production]),'Original production');
  assert.equal(await scalar('select rights_classification::text from tonde.production_references where id=$1',[reference]),'licensed');
  assert.equal(await scalar('select state::text from tonde.production_references where id=$1',[reference]),'metadata_available');
  assert.equal(await scalar('select count(*) from tonde.object_versions where object_id=$1',[production]),1);
  assert.equal(await scalar('select id from tonde.shots where scene_id=$1',[scene]),shot);
});
test('all 24 production types use the one canonical Production and bounded reference values are database enums',async()=>{
  const vocabulary=JSON.parse(await readFile('product/vocabulary.json','utf8'));
  const types=(await db.query("select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='tonde' and t.typname='production_type'")).rows.map(r=>r.enumlabel);
  assert.deepEqual(types.sort(),Object.keys(vocabulary.productionTypes).sort());
  for(const kind of ['product_film','trailer']){
    const id=await human(()=>scalar('select tonde.create_project_with_production($1,$2,$3)',[workspace,kind,kind]));
    assert.equal(await scalar('select production_type::text from tonde.productions where id=$1',[id]),kind);
  }
  for(const column of ['source_type','rights_classification','state']){
    assert.equal(await scalar("select data_type from information_schema.columns where table_schema='tonde' and table_name='production_references' and column_name=$1",[column]),'USER-DEFINED');
  }
  await assert.rejects(human(()=>db.query("update tonde.production_references set rights_classification='uploaded' where id=$1",[reference])),/invalid input/i);
});
test('Scene and Shot IDs survive ordering changes; optional hierarchy remains nullable',async()=>{
  await human(()=>db.query('update tonde.scenes set sort_order=8192 where id=$1',[scene]));
  await human(()=>db.query('update tonde.shots set sort_order=16384 where id=$1',[shot]));
  assert.equal(await scalar('select id from tonde.scenes where production_id=$1 and sort_order=8192',[production]),scene);
  assert.equal(await scalar('select id from tonde.shots where scene_id=$1 and sort_order=16384',[scene]),shot);
  for(const [table,column] of [['series_episodes','collection_id'],['scenes','sequence_id'],['sequences','act_id'],['shots','scene_id']]){
    assert.equal(await scalar("select is_nullable from information_schema.columns where table_schema='tonde' and table_name=$1 and column_name=$2",[table,column]),'YES');
  }
});
test('system and service-role execution cannot auto-approve; a creator decision can',async()=>{
  await assert.rejects(db.query("update tonde.productions set approval='approved' where id=$1",[production]),/creator decision|permission denied/i);
  await assert.rejects(asRole('service_role',user,()=>db.query("update tonde.productions set approval='approved' where id=$1",[production])),/creator decision|permission denied/i);
  const denied=await asRole('authenticated',viewer,()=>db.query("update tonde.productions set approval='approved' where id=$1 returning id",[production]));
  assert.equal(denied.rows.length,0);
  await assert.rejects(human(()=>db.query("update tonde.productions set title='Not reviewed',approval='approved' where id=$1",[production])),/review the changed version/i);
  await human(()=>db.query("update tonde.productions set approval='approved' where id=$1",[production]));
  assert.equal(await scalar('select approval::text from tonde.productions where id=$1',[production]),'approved');
  assert.equal(await scalar('select locked_at from tonde.productions where id=$1',[production]),null);
  await human(()=>db.query("update tonde.productions set title='Changed after acceptance' where id=$1",[production]));
  assert.equal(await scalar('select approval::text from tonde.productions where id=$1',[production]),'changed_after_approval');
});
test('Result acceptance is human controlled; editing produced evidence requires fresh review',async()=>{
  media='00000000-0000-4000-8000-000000000010';
  await human(()=>db.query("insert into tonde.media_files(id,workspace_id,bucket,object_key,original_filename,mime_type,file_category,bytes) values($1,$2,'tonde-results',$3,'result.png','image/png','image',100)",[media,workspace,`${workspace}/${media}/source`]));
  result=await human(()=>scalar('insert into tonde.results(workspace_id,production_id,shot_id,media_id) values($1,$2,$3,$4) returning id',[workspace,production,shot,media]));
  assert.equal(await scalar('select state::text from tonde.results where id=$1',[result]),'raw');
  await assert.rejects(asRole('service_role',user,()=>db.query("update tonde.results set state='final' where id=$1",[result])),/creator decision|permission denied/i);
  await assert.rejects(db.query("update tonde.results set state='final' where id=$1",[result]),/creator decision/i);
  await human(()=>db.query("update tonde.results set state='final',approval='approved' where id=$1",[result]));
  assert.equal(await scalar('select state::text from tonde.results where id=$1',[result]),'final');
  await human(()=>db.query("update tonde.results set provenance='{"+'"note":"Corrected evidence"'+"}'::jsonb where id=$1",[result]));
  assert.equal(await scalar('select state::text from tonde.results where id=$1',[result]),'needs_review');
  assert.equal(await scalar('select approval::text from tonde.results where id=$1',[result]),'changed_after_approval');
});
test('Project, Production, Setup, Settings, Assets and compiled execution are not duplicate silos',async()=>{
  assert.notEqual(await scalar('select project_id from tonde.productions where id=$1',[production]),production);
  const columns=(await db.query("select table_name,column_name from information_schema.columns where table_schema='tonde' and table_name in ('user_preferences','productions','results')")).rows;
  assert.ok(!columns.some(r=>r.table_name==='user_preferences'&&/camera|lens|equipment|ai_tool/.test(r.column_name)));
  assert.ok(!columns.some(r=>r.table_name==='productions'&&/prompt|provider|model/.test(r.column_name)));
  assert.ok(!columns.some(r=>r.table_name==='results'&&/dialogue|script|shot_description/.test(r.column_name)));
  const resources=(await db.query("select unnest(enum_range(null::tonde.resource_type))::text as value")).rows.map(r=>r.value);
  assert.ok(!resources.includes('environment'));
  assert.ok((await db.query("select unnest(enum_range(null::tonde.asset_type))::text as value")).rows.some(r=>r.value==='environment'));
});
