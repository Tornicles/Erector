// Explicit hosted acceptance; never modifies application schema or pre-existing records.
// Credentials are read from ignored env files, never emitted. Run from the repository root.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

const env = Object.fromEntries(readFileSync('backend/.env','utf8').split(/\r?\n/).filter(s=>s.includes('=')&&!s.trim().startsWith('#')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const url=env.SUPABASE_URL.replace(/\/$/,'');
const key=env.SUPABASE_PUBLISHABLE_KEY, secret=env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key||!secret)throw new Error('Hosted test credentials unavailable');
const results=[],users=[],media=[],objects=[];
const record=(name,ok,detail='')=>{results.push({name,status:ok?'PASS':'FAIL',detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${detail}`);};
async function request(path,{method='GET',token,admin=false,schema,body,raw,headers={}}={}){
 const h={apikey:admin?secret:key,...headers};if(token||admin)h.Authorization=`Bearer ${admin?secret:token}`;
 if(schema)h[method==='GET'?'Accept-Profile':'Content-Profile']=schema;
 if(body!==undefined)h['Content-Type']='application/json';
 let r;
 try{r=await fetch(url+path,{method,headers:h,body:raw??(body===undefined?undefined:JSON.stringify(body)),signal:AbortSignal.timeout(30000)});}
 catch(error){throw new Error(`${method} ${path} ${error.name==='TimeoutError'?'timed out after 30s':error.message}`);}
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {ok:r.ok,status:r.status,data};
}
const rpc=(name,token,body)=>request('/rest/v1/rpc/'+name,{method:'POST',token,schema:'tonde',body});
// Bounded concurrency for the two sweep loops below. They are record-only: an iteration never
// throws and never depends on another iteration's outcome, so overlapping them cannot change
// control flow. Each iteration buffers its own evidence lines, and the buffer for item n is only
// printed and appended once every earlier item has reported, so hosted-expanded-results.json and
// the run log stay byte-identical to a strictly serial run while only the network waits overlap.
// Set TONDE_VERIFY_CONCURRENCY=1 to reproduce the old serial timing exactly.
const CONCURRENCY=Math.max(1,Number(process.env.TONDE_VERIFY_CONCURRENCY??8)||1);
async function section(items,run){
 const buffers=new Array(items.length),done=new Array(items.length).fill(false);
 let next=0,flushed=0;
 // Synchronous and index-ordered, so it is atomic under the single-threaded event loop.
 const flush=()=>{
  while(flushed<items.length&&done[flushed]){
   for(const line of buffers[flushed])console.log(`${line.status} ${line.name} ${line.detail}`);
   flushed++;
  }
 };
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,items.length)},async()=>{
  for(;;){
   const index=next++;if(index>=items.length)return;
   const lines=[];buffers[index]=lines;
   await run(items[index],(name,ok,detail='')=>lines.push({name,status:ok?'PASS':'FAIL',detail}));
   done[index]=true;flush();
  }
 }));
 flush();
 for(const lines of buffers)results.push(...lines);
}
async function makeUser(label){
 const password='Tonde!'+randomBytes(24).toString('base64url');
 const email=`tonde.cert.${label}.${Date.now()}@example.com`;
 const made=await request('/auth/v1/admin/users',{method:'POST',admin:true,body:{email,password,email_confirm:true}});
 if(!made.ok)throw new Error(`Controlled user creation HTTP ${made.status}`);
 const user={id:made.data.id,email,password};users.push(user);
 const login=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
 if(!login.ok)throw new Error(`Controlled login HTTP ${login.status}`);
 user.token=login.data.access_token;user.refresh=login.data.refresh_token;
 const ws=await request('/rest/v1/workspaces?select=id',{token:user.token,schema:'tonde'});
 if(!ws.ok||ws.data.length!==1)throw new Error('Controlled workspace bootstrap failed');
 user.workspace=ws.data[0].id;return user;
}
async function cleanup(){
 // Never delete unrelated rows/users. Keep append-only application history; archive test Productions.
 for(const o of objects){const r=await request(`/storage/v1/object/${o.bucket}`,{method:'DELETE',admin:true,body:{prefixes:[o.path]}});record('cleanup test Storage object',r.ok,`HTTP ${r.status}`);}
 for(const u of users){
  if(u.production){
   const login=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:u.email,password:u.password}});
   const r=login.ok?await request(`/rest/v1/productions?id=eq.${u.production}`,{method:'PATCH',token:login.data.access_token,schema:'tonde',headers:{Prefer:'return=representation'},body:{lifecycle:'archived'}}):login;
   record('archive controlled test Production',r.ok&&r.data?.[0]?.lifecycle==='archived',`HTTP ${r.status}`);
  }
  const r=await request(`/auth/v1/admin/users/${u.id}`,{method:'DELETE',admin:true,body:{should_soft_delete:true}});record('soft-delete controlled Auth user',r.ok,`HTTP ${r.status}`);
 }
}
try{
 const a=await makeUser('a'),b=await makeUser('b');
 for(const u of [a,b]){const r=await rpc('create_project_with_production',u.token,{target_workspace:u.workspace,production_title:'Certification-only Production',kind:'short_film'});if(!r.ok)throw new Error('Controlled Production creation failed');u.production=r.data;}
 writeFileSync('test-results/pre-prompt10/controlled-test-identifiers.json',JSON.stringify(users.map(({id,workspace,production})=>({id,workspace,production})),null,2));
 async function insert(u,table,body,admin=false){
  const r=await request(`/rest/v1/${table}`,{method:'POST',token:u.token,admin,schema:'tonde',headers:{Prefer:'return=representation'},body:{workspace_id:u.workspace,...body}});
  if(!r.ok||!r.data?.[0])throw new Error(`Controlled ${table} fixture HTTP ${r.status} ${r.data?.code??''} ${r.data?.message??''}`);
  return r.data[0];
 }
 async function fixture(u){
  const changed=await request(`/rest/v1/productions?id=eq.${u.production}`,{method:'PATCH',token:u.token,schema:'tonde',body:{planned_duration_ms:8000}});
  if(!changed.ok)throw new Error('Controlled timed Production update failed');
  const createdScene=await rpc('create_studio_scene',u.token,{target_workspace:u.workspace,target_production:u.production,expected_production_revision:null,scene:{title:'Certification Scene',duration_ms:8000}});
  if(!createdScene.ok)throw new Error(`Controlled Scene HTTP ${createdScene.status} ${createdScene.data?.code??''}`);
  u.scene=createdScene.data.scene_id;
  const createdShot=await rpc('create_studio_shot',u.token,{target_workspace:u.workspace,target_production:u.production,target_scene:u.scene,expected_production_revision:null,shot:{title:'Certification Shot',duration_ms:8000}});
  if(!createdShot.ok)throw new Error(`Controlled Shot HTTP ${createdShot.status} ${createdShot.data?.code??''}`);
  u.shot=createdShot.data.shot_id;
  u.asset=await insert(u,'assets',{asset_type:'character',name:'Certification actor'});
  u.camera=await insert(u,'production_resources',{resource_type:'camera',name:'Certification camera'});
  u.lens=await insert(u,'production_resources',{resource_type:'lens',name:'Certification 50mm lens'});
  u.kit=await insert(u,'equipment_kits',{name:'Certification Production Kit'});
  await insert(u,'kit_resources',{kit_id:u.kit.id,resource_id:u.camera.id});
  await insert(u,'resource_compatibility',{resource_id:u.camera.id,compatible_resource_id:u.lens.id,relation:'mount'});
  u.reference=await insert(u,'production_references',{production_id:u.production,source_type:'description',source_identity:'Creator-written test Reference',creator_purpose:'Learn composition without claiming unseen media',source_description:'Written test description'});
  const identity=await rpc('reference_identity_save',u.token,{target_workspace:u.workspace,target_production:u.production,target_reference:u.reference.id,expected_revision:u.reference.revision,values_json:{source_identity:'Creator-written test Reference',source_identity_verified:true,creator_purpose:'Learn composition without claiming unseen media'}});
  record('creator explicitly attests scoped Reference identity',identity.ok&&identity.data?.identity_provenance==='creator_supplied',`HTTP ${identity.status}`);
  u.document=await insert(u,'creative_documents',{production_id:u.production,scope_object_id:u.production,document_type:'script',title:'Certification Script',content:'An original test scene.'});
  u.dialogue=await insert(u,'dialogue_lines',{production_id:u.production,document_id:u.document.id,scene_id:u.scene,shot_id:u.shot,line_type:'dialogue',content:'Ready.',sort_order:1000,duration_ms:1000});
  u.plan=await insert(u,'execution_plans',{production_id:u.production,shot_id:u.shot,execution_method:'real',camera_resource_id:u.camera.id,lens_resource_id:u.lens.id});
  u.thread=await insert(u,'director_threads',{production_id:u.production,scope_object_id:u.production,scope_type:'production'});
  await insert(u,'director_messages',{thread_id:u.thread.id,role:'user',content:'Certification-only creator request'});
  const id=randomUUID(),path=`${u.workspace}/${id}/fixture.png`;
  u.media=await insert(u,'media_files',{id,bucket:'tonde-results',object_key:path,original_filename:'fixture.png',mime_type:'image/png',file_category:'image',bytes:68,created_by:u.id});
  u.result=await insert(u,'results',{production_id:u.production,scene_id:u.scene,shot_id:u.shot,media_id:id,execution_plan_id:u.plan.id});
  const version=await request(`/rest/v1/object_versions?object_id=eq.${u.production}&order=revision.desc&limit=1`,{token:u.token,schema:'tonde'});
  u.job=await insert(u,'jobs',{production_id:u.production,job_type:'export',input_object_id:u.production,requested_by:u.id},true);
  await insert(u,'exports',{production_id:u.production,job_id:u.job.id,requested_format:'json',package_type:'structured_data',production_version_id:version.data?.[0]?.id,requested_by:u.id},true);
  const audio=await rpc('audio_plan_get',u.token,{target_workspace:u.workspace,target_production:u.production});
  record('timed audiovisual Production has canonical Audio Plan',audio.ok&&!!audio.data?.id,`HTTP ${audio.status}`);u.audio=audio.data;
  const direction=await rpc('scene_audio_direction_save',u.token,{target_workspace:u.workspace,target_production:u.production,target_scene:u.scene,expected_revision:null,values_json:{music_use:'intentional_silence',sound_use:'directed',sound_direction:'Record room tone.',cue_start_ms:0,cue_end_ms:8000,cue_duration_ms:8000}});
  record('Scene Music and Sound Direction save independently with exact cues',direction.ok&&direction.data?.music_use==='intentional_silence'&&direction.data?.sound_direction==='Record room tone.',`HTTP ${direction.status}`);u.direction=direction.data;
 }
 await fixture(a);await fixture(b);
 for(const table of ['projects','productions','assets','production_resources','equipment_kits','kit_resources','resource_compatibility','scenes','shots','creative_documents','dialogue_lines','execution_plans','production_references','director_threads','director_messages','media_files','results','jobs','exports','production_audio_plans','scene_audio_directions','object_versions']){
  const r=await request(`/rest/v1/${table}?select=*&workspace_id=eq.${b.workspace}`,{token:b.token,schema:'tonde'});
  record(`B owns populated ${table} isolation fixture`,r.ok&&Array.isArray(r.data)&&r.data.length>0,`HTTP ${r.status}`);
 }
 for(const [table,id] of [['productions',a.production],['scenes',a.scene],['shots',a.shot],['assets',a.asset.id],['creative_documents',a.document.id],['dialogue_lines',a.dialogue.id],['execution_plans',a.plan.id],['results',a.result.id],['production_audio_plans',a.audio.id],['scene_audio_directions',a.direction.id]]){
  const load=()=>request(`/rest/v1/${table}?id=eq.${id}`,{token:a.token,schema:'tonde'});
  const before=await load(),revision=before.data?.[0]?.revision;
  const args={target_workspace:a.workspace,target_production:a.production,target_object:id,decision:'approve',expected_revision:revision,note_text:'Explicit controlled creator acceptance'};
  const approve=await rpc('approval_decide',a.token,args);
  record(`creator approves exact ${table} revision`,approve.ok&&approve.data?.approval==='approved',`HTTP ${approve.status} ${approve.data?.code??''}`);
  const denied=await rpc('approval_decide',b.token,args);
  record(`other tenant cannot approve ${table}`,denied.status===403&&denied.data?.code==='42501',`HTTP ${denied.status}`);
  const stale=await rpc('approval_decide',a.token,args);
  record(`stale ${table} approval rejected without retrying`,stale.status===409&&stale.data?.code==='PT409',`HTTP ${stale.status} ${stale.data?.code??'no response'}`);
  const reopened=await rpc('approval_decide',a.token,{...args,decision:'reopen',expected_revision:approve.data?.revision});
  if(!reopened.ok)throw new Error(`Controlled ${table} reopen failed`);
  const forged=await request(`/rest/v1/${table}?id=eq.${id}`,{method:'PATCH',admin:true,schema:'tonde',body:{approval:'approved'}});
  const after=await load();
  record(`service role cannot fabricate ${table} approval`,!forged.ok&&after.data?.[0]?.approval==='draft',`HTTP ${forged.status}`);
 }
 const search=await rpc('production_search',a.token,{target_workspace:a.workspace,target_production:a.production,query:{text:'Certification',kinds:['shot','scene','asset'],limit:100}});
 record('structured search returns populated canonical objects',search.ok&&JSON.stringify(search.data).includes(a.shot)&&JSON.stringify(search.data).includes(a.scene),`HTTP ${search.status}`);
 const foreignSearch=await rpc('production_search',b.token,{target_workspace:a.workspace,target_production:a.production,query:{text:'Certification'}});
 record('structured search denies other tenant',foreignSearch.status===403&&foreignSearch.data?.code==='42501',`HTTP ${foreignSearch.status}`);
 const prod=await request(`/rest/v1/productions?id=eq.${a.production}`,{token:a.token,schema:'tonde'});
 const locked=await rpc('lock_set',a.token,{target_workspace:a.workspace,target_production:a.production,target_object:a.production,locked:true,expected_revision:prod.data?.[0]?.revision,note_text:'Enclosing scope test'});
 record('creator locks canonical Production',locked.ok&&locked.data?.locked===true,`HTTP ${locked.status}`);
 const lockedShot=await request(`/rest/v1/shots?id=eq.${a.shot}`,{method:'PATCH',token:a.token,schema:'tonde',body:{title:'Forbidden incidental change'}});
 record('enclosing Production lock rejects direct Shot edit',!lockedShot.ok&&lockedShot.data?.code==='23514',`HTTP ${lockedShot.status}`);
 const lockedAudio=await rpc('audio_plan_save',a.token,{target_workspace:a.workspace,target_production:a.production,expected_revision:a.audio.revision,values_json:{overall_intent:'Forbidden incidental change'}});
 record('enclosing Production lock rejects Audio edit',!lockedAudio.ok&&lockedAudio.data?.code==='23514',`HTTP ${lockedAudio.status}`);
 const unlocked=await rpc('lock_set',a.token,{target_workspace:a.workspace,target_production:a.production,target_object:a.production,locked:false,expected_revision:locked.data?.revision,note_text:'Explicit cleanup of test lock'});
 record('creator explicitly unlocks Production',unlocked.ok&&unlocked.data?.locked===false,`HTTP ${unlocked.status}`);
 const catalog=JSON.parse(readFileSync('test-results/pre-prompt10/local-final-catalog.json'));
 const tables=catalog.filter(x=>x.k==='table'&&x.v.startsWith('tonde.')).map(x=>x.v.slice(6));
 const columns=catalog.filter(x=>x.k==='column').map(x=>x.v);
 // The reviewed catalog says which workspace-scoped tables grant `authenticated` SELECT. A table with
 // the grant must answer a foreign read with an empty list; a server-only table (no client grant at
 // all, e.g. integration_oauth_states from migration 031) must refuse the read outright. Deriving
 // this from the same catalog the comparison verified keeps the expectation honest in both
 // directions: a missing grant on a readable table fails here, and a foreign row that leaks
 // through a server-only table fails too.
 const clientReadable=new Set();
 for(const aclRow of catalog.filter(x=>x.k==='acl_table'&&x.v.startsWith('tonde.'))){
  const roles=new Map();
  for(const item of (aclRow.d||'').replace(/^\{/,'').replace(/\}$/,'').split(',')){
   if(!item)continue;const [grantee,rest]=item.split('=');roles.set(grantee||'PUBLIC',rest.split('/')[0]);
  }
  if((roles.get('authenticated')||'').includes('r'))clientReadable.add(aclRow.v.slice(6));
 }
 await section(tables,async(table,mark)=>{
  const workspace=columns.includes(`tonde.${table}.workspace_id`);const user=columns.includes(`tonde.${table}.user_id`);
  if(!workspace&&!user)return;
  const filter=workspace?`workspace_id=eq.${b.workspace}`:`user_id=eq.${b.id}`;
  const r=await request(`/rest/v1/${table}?select=*&${filter}`,{token:a.token,schema:'tonde'});
  if(clientReadable.has(table))mark(`A cannot read B ${table}`,r.ok&&Array.isArray(r.data)&&r.data.length===0,`HTTP ${r.status}`);
  else mark(`A cannot read B ${table} (server-only by catalog: no client grant)`,r.status===403,`HTTP ${r.status}`);
  if(columns.includes(`tonde.${table}.updated_at`)){
   const w=await request(`/rest/v1/${table}?${filter}`,{method:'PATCH',token:a.token,schema:'tonde',headers:{Prefer:'return=representation'},body:{updated_at:new Date().toISOString()}});
   mark(`A cannot update B ${table}`,w.status===403||(w.ok&&Array.isArray(w.data)&&w.data.length===0),`HTTP ${w.status}`);
  }
  const d=await request(`/rest/v1/${table}?${filter}`,{method:'DELETE',token:a.token,schema:'tonde',headers:{Prefer:'return=representation'}});
  mark(`A cannot delete B ${table}`,d.status===403||(d.ok&&Array.isArray(d.data)&&d.data.length===0),`HTTP ${d.status}`);
 });
 const functions=JSON.parse(readFileSync('test-results/pre-prompt10/hosted-final-rpcs.json'))[0].functions;
 await section(functions.filter(f=>f.name!=='bootstrap_workspace'),async(f,mark)=>{
  const args=Object.fromEntries(f.args.map(arg=>[arg.name,arg.name==='target_workspace'?b.workspace:arg.type==='uuid'?b.production:arg.type==='jsonb'?{}:arg.type.endsWith('[]')?[]:arg.type==='boolean'?false:/integer|bigint|numeric/.test(arg.type)?1:null]));
  const r=await rpc(f.name,a.token,args);
  mark(`cross-tenant RPC ${f.name} denied`,r.status===403&&r.data?.code==='42501',`HTTP ${r.status} ${r.data?.code??''}`);
 });
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 for(const bucket of ['tonde-uploads','tonde-asset-references','tonde-production-media','tonde-results','tonde-exports','tonde-avatars']){
  const raw=bucket==='tonde-exports'?'{}':png,mime=bucket==='tonde-exports'?'application/json':'image/png';
  // 044/045: only an open creator-owned intent authorizes a Storage upload. No intent purpose
  // addresses tonde-uploads or tonde-avatars, so direct uploads there must stay denied.
  const intentPurpose=bucket==='tonde-results'?'result':bucket==='tonde-asset-references'?'reference':bucket==='tonde-production-media'?'attachment':bucket==='tonde-exports'?'export_artifact':null;
  if(intentPurpose===null){
   const id=randomUUID(),path=`${a.workspace}/${id}/certification.png`;
   const meta=await request('/rest/v1/media_files',{method:'POST',token:a.token,schema:'tonde',body:{id,workspace_id:a.workspace,bucket,object_key:path,original_filename:'certification.png',mime_type:mime,file_category:'image',bytes:raw.length}});
   record(`${bucket} metadata registration`,meta.ok,`HTTP ${meta.status}`);if(!meta.ok)continue;media.push(id);
   const retired=await request(`/storage/v1/object/${bucket}/${path}`,{method:'POST',token:a.token,headers:{'Content-Type':mime,'x-upsert':'false'},raw});
   record(`${bucket} direct upload retired without intent path`,!retired.ok,`HTTP ${retired.status}`);
   continue;
  }
  const created=await rpc('media_upload_intent_create',a.token,{target_workspace:a.workspace,p_purpose:intentPurpose,p_original_filename:bucket==='tonde-exports'?'certification.json':'certification.png',p_mime_type:mime,p_expected_bytes:raw.length,target_production:null,p_resumable:false,p_checksum_expected:null});
  record(`${bucket} metadata registration`,created.ok&&created.data?.state==='created'&&!!created.data?.media_id,`HTTP ${created.status}`);if(!created.ok)continue;
  const id=created.data.media_id,path=created.data.object_key;media.push(id);
  const upload=await request(`/storage/v1/object/${bucket}/${path}`,{method:'POST',token:a.token,headers:{'Content-Type':mime,'x-upsert':'false'},raw});
  record(`${bucket} creator upload contract`,bucket==='tonde-exports'?!upload.ok:upload.ok,`HTTP ${upload.status}`);
  if(bucket==='tonde-exports'){
   const seeded=await request(`/storage/v1/object/${bucket}/${path}`,{method:'POST',admin:true,headers:{'Content-Type':mime},raw});if(!seeded.ok)throw new Error('Controlled export seeding failed');
  }
  objects.push({bucket,path});
  if(bucket==='tonde-exports'){
   // Prompt 10 closed the client storage read path for export artifacts (migration 033: a workspace
   // member cannot read or sign them, and the trusted server signs a short-lived URL per request).
   // Both halves are asserted: the browser is denied, and the server itself still works.
   const read=await request(`/storage/v1/object/authenticated/${bucket}/${path}`,{token:a.token});record(`${bucket} owner client read denied by design`,!read.ok,`HTTP ${read.status}`);
   const sign=await request(`/storage/v1/object/sign/${bucket}/${path}`,{method:'POST',token:a.token,body:{expiresIn:60}});record(`${bucket} owner client signing denied by design`,!sign.ok,`HTTP ${sign.status}`);
   const serverSign=await request(`/storage/v1/object/sign/${bucket}/${path}`,{method:'POST',admin:true,body:{expiresIn:60}});
   const serverSigned=serverSign.data?.signedURL||serverSign.data?.signedUrl;
   record(`${bucket} server-signed access works`,serverSign.ok&&!!serverSigned,`HTTP ${serverSign.status}`);
   if(serverSigned){const download=await fetch(serverSigned.startsWith('http')?serverSigned:`${url}/storage/v1${serverSigned.startsWith('/')?'':'/'}${serverSigned}`);record(`${bucket} server-signed URL actually downloads`,download.ok,`HTTP ${download.status}`);}
  } else {
   const read=await request(`/storage/v1/object/authenticated/${bucket}/${path}`,{token:a.token});record(`${bucket} owner read`,read.ok,`HTTP ${read.status}`);
   const sign=await request(`/storage/v1/object/sign/${bucket}/${path}`,{method:'POST',token:a.token,body:{expiresIn:60}});record(`${bucket} owner signed access`,sign.ok&&!!(sign.data.signedURL||sign.data.signedUrl),`HTTP ${sign.status}`);
   const signed=sign.data?.signedURL||sign.data?.signedUrl;
   if(signed){const download=await fetch(signed.startsWith('http')?signed:`${url}/storage/v1${signed.startsWith('/')?'':'/'}${signed}`);record(`${bucket} signed URL actually downloads`,download.ok,`HTTP ${download.status}`);}
  }
  const anonymous=await request(`/storage/v1/object/authenticated/${bucket}/${path}`);record(`${bucket} anonymous read denied`,!anonymous.ok,`HTTP ${anonymous.status}`);
  const anonymousSign=await request(`/storage/v1/object/sign/${bucket}/${path}`,{method:'POST',body:{expiresIn:60}});record(`${bucket} anonymous signing denied`,!anonymousSign.ok,`HTTP ${anonymousSign.status}`);
  for(const [method,suffix,body,rawValue] of [['GET','authenticated/',undefined,undefined],['POST','sign/',{expiresIn:60},undefined],['POST','',undefined,raw],['DELETE','',undefined,undefined]]){
   const denied=await request(`/storage/v1/object/${suffix}${bucket}/${path}`,{method,token:b.token,body,raw:rawValue,headers:method==='POST'&&!body?{'Content-Type':mime,'x-upsert':'true'}:{}});
   record(`${bucket} cross-tenant ${method} ${suffix||'mutation'} denied`,!denied.ok,`HTTP ${denied.status}`);
  }
  const replace=await request(`/storage/v1/object/${bucket}/${path}`,{method:'POST',token:a.token,headers:{'Content-Type':mime,'x-upsert':'true'},raw});record(`${bucket} owner overwrite prohibited by retention contract`,!replace.ok,`HTTP ${replace.status}`);
  const del=await request(`/storage/v1/object/${bucket}/${path}`,{method:'DELETE',token:a.token});record(`${bucket} owner hard-delete prohibited by retention contract`,!del.ok,`HTTP ${del.status}`);
 }
     // ------------------------------------------------- Prompt 10 server boundary and denial order
 // Controlled furniture on the honest footing this deployment actually has: a destination provider
 // whose adapter exists in code (adapter_state 'implemented') and was never exercised against the
 // real provider, its publish capability, a real uploaded artifact with the checksum of its bytes,
 // and one entitlement definition. Nothing here calls a provider, and no provider state is faked.
 //
 // Persistent by design, not by accident: a recorded publishing authorization cannot be erased
 // (append-only) and the publication that carries one cannot be deleted either. That is the law
 // answering under service role, so both refusals are asserted here instead of being attempted as
 // cleanup. Commercial state that is append-only by design (webhook receipts, usage events,
 // subscription events) is deliberately NOT written here: a hosted project must not carry invented
 // commercial history, so those paths are verified as client denials in this block and as positive
 // outcomes in the local database/backend suites.
 const furniture = { provider: 'certification_publisher', entitlement: 'certification.credits' };
 const controlled = [];
 const noClient = r => !r.ok && (r.status === 403 || r.data?.code === '42501');
 const denied42501 = r => r.status === 403 && r.data?.code === '42501';
 // Stable keys, so repeated certification runs reuse one declared provider instead of accumulating
 // new ones, and re-asserting its truth is idempotent.
 const upsert = (table, body) => request(`/rest/v1/${table}`, { method: 'POST', admin: true, schema: 'tonde',
   headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body });
 try {
  const providerRow = await upsert('integration_providers', { key: furniture.provider, name: 'Certification publisher',
    category: 'social_publishing', auth_type: 'oauth', connection_required: true, adapter_state: 'implemented',
    enabled: true, note: 'Controlled acceptance furniture: an adapter exists in code and was never exercised against the real provider.' });
  record('server registers a controlled destination provider whose adapter was never exercised',
    providerRow.ok && providerRow.data?.[0]?.adapter_state === 'implemented', `HTTP ${providerRow.status}`);
  const capabilityRow = await upsert('integration_provider_capabilities', { provider_key: furniture.provider,
    capability_key: 'publish', connection_required: true, required_scopes: ['publish.video'], enabled: true,
    note: 'Controlled acceptance furniture.' });
  record('server registers the publish capability with its required scopes', capabilityRow.ok, `HTTP ${capabilityRow.status}`);
  const fakeConnection = await request('/rest/v1/integration_connections', { method: 'POST', admin: true, schema: 'tonde',
    headers: { Prefer: 'return=representation' }, body: { workspace_id: a.workspace, provider: furniture.provider,
      provider_account_id: 'certification-account', status: 'connected', scopes: ['publish.video'],
      connected_by: a.id, external_account_label: 'Certification channel', verified_at: new Date().toISOString() } });
  record('a destination account cannot be CONNECTED for a provider with no verified adapter',
    !fakeConnection.ok && fakeConnection.data?.code === '23514', `HTTP ${fakeConnection.status} ${fakeConnection.data?.code ?? ''}`);
  const strayConnection = await request(`/rest/v1/integration_connections?workspace_id=eq.${a.workspace}&provider=eq.${furniture.provider}&select=id`,
    { admin: true, schema: 'tonde' });
  record('the refused connection left no row behind', strayConnection.ok && strayConnection.data.length === 0,
    `HTTP ${strayConnection.status} rows ${strayConnection.data?.length ?? 'n/a'}`);

  // A real publishable artifact: bytes in the private media bucket, registered with the checksum those
  // bytes actually have, so the publication pins a version that exists instead of a claimed one.
  const publicationChecksum = `sha256:${createHash('sha256').update(png).digest('hex')}`;
  const publicationIntent = await rpc('media_upload_intent_create', a.token, { target_workspace: a.workspace,
    p_purpose: 'attachment', p_original_filename: 'certification.png', p_mime_type: 'image/png',
    p_expected_bytes: png.length, target_production: null, p_resumable: false, p_checksum_expected: publicationChecksum });
  const publicationMediaId = publicationIntent.data?.media_id ?? null;
  const publicationPath = publicationIntent.data?.object_key ?? '';
  const publicationPending = publicationMediaId ? await request(`/rest/v1/media_files?id=eq.${publicationMediaId}&select=upload_state`, { token: a.token, schema: 'tonde' }) : null;
  record('creator registers the artifact and its real checksum before the bytes are sent',
    publicationIntent.ok && publicationIntent.data?.state === 'created' && publicationIntent.data?.storage_path_is_server_owned === true && publicationPending?.data?.[0]?.upload_state === 'pending',
    `HTTP ${publicationIntent.status} state ${publicationPending?.data?.[0]?.upload_state ?? 'n/a'}`);
  if (!publicationIntent.ok || !publicationMediaId) throw new Error('Controlled publication intent failed');
  const publicationUpload = await request(`/storage/v1/object/tonde-production-media/${publicationPath}`,
    { method: 'POST', token: a.token, headers: { 'Content-Type': 'image/png' }, raw: png });
  record('creator uploads the bytes the publication will pin', publicationUpload.ok, `HTTP ${publicationUpload.status}`);
  // The same client completion step the product's own upload path performs: the creator session that
  // sent the bytes records that the upload completed.
  const publicationCompleted = await request(`/rest/v1/media_files?id=eq.${publicationMediaId}`,
    { method: 'PATCH', token: a.token, schema: 'tonde', headers: { Prefer: 'return=representation' },
      body: { upload_state: 'uploaded' } });
  record('creator records the completed upload the product path records',
    publicationCompleted.ok && publicationCompleted.data?.[0]?.upload_state === 'uploaded', `HTTP ${publicationCompleted.status}`);
  // The verifier the product runs as (service role, like the backend completion path) observes the
  // stored object and records its checksum; only then does the media row carry a checksum to pin.
  const publicationVerified = await request('/rest/v1/rpc/media_upload_verify', { method: 'POST', admin: true,
    schema: 'tonde', body: { target_workspace: a.workspace, target_intent: publicationIntent.data?.intent_id,
      p_observed_bytes: png.length, p_observed_mime: 'image/png', p_observed_checksum: publicationChecksum,
      p_object_verified: true, p_probe: {}, p_verifier: 'certification-acceptance' } });
  record('server verifier confirms the stored bytes and records the observed checksum',
    !!publicationVerified.ok && publicationVerified.data?.state === 'verified', `HTTP ${publicationVerified.status}`);
  const publicationResult = await request('/rest/v1/results', { method: 'POST', token: a.token, schema: 'tonde',
    headers: { Prefer: 'return=representation' }, body: { workspace_id: a.workspace, production_id: a.production,
      media_id: publicationMediaId } });
  record('creator records the Result that the publication pins', publicationResult.ok, `HTTP ${publicationResult.status}`);
  const publicationResultId = publicationResult.data?.[0]?.id ?? null;

  // The creator's own publishing act, and the destination's honest capability answer.
  const created = publicationResultId ? await rpc('publication_create', a.token, { target_workspace: a.workspace,
    target_production: a.production, target_result: publicationResultId, target_provider: furniture.provider,
    target_media: publicationMediaId, target_destination: 'Certification channel', target_account: null,
    target_title: 'Certification publication', target_caption: 'Controlled acceptance fixture.',
    target_visibility: 'private', target_scheduled_for: null, target_config: {} }) : null;
  const publication = created?.data?.publication_id ?? null;
  record('creator creates a publication pinned to the exact version and checksum it will publish',
    !!created?.ok && created.data?.state === 'draft' && !!created.data?.production_revision
      && created.data?.media_checksum === publicationChecksum,
    `HTTP ${created?.status} ${created?.data?.code ?? ''}`);
  const previewBefore = publication ? await rpc('publication_preview', a.token, { target_workspace: a.workspace, target_publication: publication }) : null;
  record('a destination whose adapter was never exercised is reported unavailable, never submit-ready',
    !!previewBefore?.ok && previewBefore.data?.capability !== 'AVAILABLE' && previewBefore.data?.can_submit === false,
    `HTTP ${previewBefore?.status} capability ${previewBefore?.data?.capability ?? 'n/a'}`);
  const ready = publication ? await rpc('publication_set_state', a.token, { target_workspace: a.workspace,
    target_publication: publication, desired: 'ready', note_text: 'Controlled acceptance readiness' }) : null;
  record('creator marks the publication ready', !!ready?.ok, `HTTP ${ready?.status} ${ready?.data?.code ?? ''}`);
  const authorized = publication ? await rpc('publication_authorize', a.token, { target_workspace: a.workspace,
    target_publication: publication, decision: 'authorize', note_text: 'Controlled creator authorization' }) : null;
  // The authorization names the exact version and destination, and it was recorded by the human creator
  // session: the pinned Result was never creatively approved, so this authority is publishing authority.
  record('creator authorizes this exact version and destination as the recording human',
    !!authorized?.ok && authorized.data?.decision === 'authorize' && authorized.data?.actor_user_id === a.id
      && authorized.data?.authorized_version?.media_checksum === publicationChecksum
      && authorized.data?.authorized_version?.production_revision === created?.data?.production_revision
      && authorized.data?.destination?.provider === furniture.provider,
    `HTTP ${authorized?.status} ${authorized?.data?.code ?? ''}`);
  const approvalRead = publication ? await request(`/rest/v1/results?id=eq.${publicationResultId}&select=approval,state`,
    { token: a.token, schema: 'tonde' }) : null;
  record('the pinned Result was never creatively approved, so publishing authority is not a creative approval',
    approvalRead?.ok && approvalRead.data?.[0]?.approval !== 'approved', `HTTP ${approvalRead?.status} approval ${approvalRead?.data?.[0]?.approval ?? 'n/a'}`);
  const clientSubmit = publication ? await rpc('publication_submit', a.token, { target_workspace: a.workspace,
    target_publication: publication }) : null;
  record('authenticated creator cannot submit a publication', !!clientSubmit && noClient(clientSubmit),
    `HTTP ${clientSubmit?.status} ${clientSubmit?.data?.code ?? ''}`);
  const serverSubmit = publication ? await request('/rest/v1/rpc/publication_submit', { method: 'POST', admin: true, schema: 'tonde',
    body: { target_workspace: a.workspace, target_publication: publication } }) : null;
  record('submission refuses a destination whose adapter was never exercised instead of faking a post',
    !!serverSubmit && !serverSubmit.ok && serverSubmit.data?.code === 'PT409'
      && String(serverSubmit.data?.message ?? '').includes('PROVIDER_NOT_IMPLEMENTED'),
    `HTTP ${serverSubmit?.status} ${serverSubmit?.data?.code ?? ''}`);
  const clientResult = publication ? await rpc('publication_record_result', a.token, { target_workspace: a.workspace,
    target_publication: publication, target_attempt: publication, target_outcome: 'succeeded',
    target_remote_resource_type: 'post', target_remote_resource_id: 'certification-remote',
    target_remote_url: '', target_remote_state: 'published', target_failure_category: null,
    target_failure_code: null, target_failure_message: null }) : null;
  record('authenticated creator cannot record a submission outcome', !!clientResult && noClient(clientResult),
    `HTTP ${clientResult?.status} ${clientResult?.data?.code ?? ''}`);
  const serviceAuthorize = publication ? await request('/rest/v1/rpc/publication_authorize', { method: 'POST', admin: true,
    schema: 'tonde', body: { target_workspace: a.workspace, target_publication: publication, decision: 'authorize',
      note_text: 'Service-role attempt' } }) : null;
  record('service role cannot record a creator publishing authorization', !!serviceAuthorize && noClient(serviceAuthorize),
    `HTTP ${serviceAuthorize?.status} ${serviceAuthorize?.data?.code ?? ''}`);
  const otherAuthorize = publication ? await rpc('publication_authorize', b.token, { target_workspace: a.workspace,
    target_publication: publication, decision: 'withdraw', note_text: 'Other tenant attempt' }) : null;
  record('other tenant cannot authorize A publication', !!otherAuthorize && denied42501(otherAuthorize),
    `HTTP ${otherAuthorize?.status} ${otherAuthorize?.data?.code ?? ''}`);
  // The exact defect migration 035 repairs: a real row exists in another workspace, and the answer must
  // still be a denial rather than a lookup failure that PostgREST reports as HTTP 500.
  const otherReconcile = publication ? await rpc('publication_reconcile', b.token, { target_workspace: a.workspace,
    target_publication: publication, target_observed: 'published', target_remote_resource_id: 'certification-remote',
    target_remote_state: 'published', target_failure_category: null, note_text: 'Other tenant attempt' }) : null;
  record('other tenant reconcile of a real publication is denied 42501, never P0002/500',
    !!otherReconcile && denied42501(otherReconcile) && otherReconcile.data?.code !== 'P0002',
    `HTTP ${otherReconcile?.status} ${otherReconcile?.data?.code ?? ''}`);
  for (const [label, name, args] of [
    ['preview', 'publication_preview', () => ({ target_workspace: a.workspace, target_publication: publication })],
    ['retry safety', 'publication_retry_safety', () => ({ target_workspace: a.workspace, target_publication: publication })],
    ['state change', 'publication_set_state', () => ({ target_workspace: a.workspace, target_publication: publication,
      desired: 'cancelled', note_text: 'Other tenant attempt' })]]) {
   const answer = publication ? await rpc(name, b.token, args()) : null;
   record(`other tenant cannot call publication ${label}`, !!answer && denied42501(answer),
     `HTTP ${answer?.status} ${answer?.data?.code ?? ''}`);
  }
  // Append-only evidence, answered by the database under service role: the authorization cannot be
  // erased, and the publication that carries it cannot be deleted while the evidence exists.
  const authDelete = publication ? await request(`/rest/v1/publication_authorizations?publication_id=eq.${publication}`,
    { method: 'DELETE', admin: true, schema: 'tonde', headers: { Prefer: 'return=minimal' } }) : null;
  record('service role cannot erase a recorded publishing authorization (append-only evidence)',
    !!authDelete && !authDelete.ok && authDelete.data?.code === '23514', `HTTP ${authDelete?.status} ${authDelete?.data?.code ?? ''}`);
  const pubDelete = publication ? await request(`/rest/v1/publications?id=eq.${publication}`,
    { method: 'DELETE', admin: true, schema: 'tonde', headers: { Prefer: 'return=minimal' } }) : null;
  record('a publication that carries authorization evidence cannot be deleted while it exists',
    !!pubDelete && !pubDelete.ok && pubDelete.data?.code === '23503', `HTTP ${pubDelete?.status} ${pubDelete?.data?.code ?? ''}`);
  const stillThere = publication ? await request(`/rest/v1/publications?id=eq.${publication}&select=state,authorization_id`,
    { admin: true, schema: 'tonde' }) : null;
  record('the authorized publication still stands unchanged after both erase attempts',
    !!stillThere?.ok && stillThere.data?.[0]?.state === 'ready' && !!stillThere.data?.[0]?.authorization_id,
    `HTTP ${stillThere?.status} state ${stillThere.data?.[0]?.state ?? 'n/a'}`);

  // Server-owned export build: the artifact must be a real export file in the private exports bucket.
  const artifactMediaId = randomUUID();
  const artifactMedia = await request('/rest/v1/media_files', { method: 'POST', token: a.token, schema: 'tonde',
    headers: { Prefer: 'return=representation' }, body: { id: artifactMediaId, workspace_id: a.workspace,
      bucket: 'tonde-exports', object_key: `${a.workspace}/${artifactMediaId}/certification.json`,
      original_filename: 'certification.json', mime_type: 'application/json', file_category: 'export', bytes: 2,
      upload_state: 'uploaded', checksum: 'sha256:certification-artifact', created_by: a.id } });
  record('server records an export artifact row in the private exports bucket', artifactMedia.ok, `HTTP ${artifactMedia.status}`);
  const exportLookup = await request(`/rest/v1/exports?production_id=eq.${a.production}&select=id,production_revision,requested_format&limit=1`,
    { token: a.token, schema: 'tonde' });
  const exportRow = exportLookup.data?.[0] ?? null;
  const exportId = exportRow?.id ?? null;
  const markBuilding = exportId ? await rpc('export_mark_building', a.token, { target_workspace: a.workspace,
    target_export: exportId, lease_holder: 'certification-client' }) : null;
  record('authenticated creator cannot start an export build', !!markBuilding && noClient(markBuilding),
    `HTTP ${markBuilding?.status} ${markBuilding?.data?.code ?? ''}`);
  const serverBuild = exportId ? await request('/rest/v1/rpc/export_mark_building', { method: 'POST', admin: true, schema: 'tonde',
    body: { target_workspace: a.workspace, target_export: exportId, lease_holder: 'certification-server' } }) : null;
  // The manifest must describe exactly this export, its pinned Production revision and its format: the
  // guard refuses a plausible-looking partial manifest, so the server-side build is exercised with the
  // true coordinates read back from the export row itself.
  const manifest = exportRow ? { schema_version: '1.0', export_id: exportId, workspace_id: a.workspace,
    production_id: a.production, production_revision: exportRow.production_revision,
    generated_at: new Date().toISOString(), format: exportRow.requested_format,
    files: [{ path: 'certification.json', bytes: 2, checksum: 'sha256:certification-artifact' }],
    checksums: { 'certification.json': 'sha256:certification-artifact' } } : null;
  const serverComplete = exportId && serverBuild?.ok ? await request('/rest/v1/rpc/export_complete', { method: 'POST', admin: true,
    schema: 'tonde', body: { target_workspace: a.workspace, target_export: exportId, artifact_media_id: artifactMediaId,
      target_manifest: manifest, target_file_count: 1, target_total_bytes: 2,
      target_checksum: 'sha256:certification-artifact' } }) : null;
  record('server builds and completes the export from the pinned version',
    !!serverBuild?.ok && !!serverComplete?.ok && serverComplete?.data?.state === 'ready',
    `HTTP ${serverBuild?.status ?? 'n/a'}/${serverComplete?.status ?? 'n/a'} ${serverComplete?.data?.code ?? ''}`);
  const download = exportId ? await rpc('export_download', a.token, { target_workspace: a.workspace, target_export: exportId }) : null;
  record('creator can authorize a download of the completed artifact',
    !!download?.ok && download.data?.bucket === 'tonde-exports', `HTTP ${download?.status} ${download?.data?.code ?? ''}`);
  const otherDownload = exportId ? await rpc('export_download', b.token, { target_workspace: a.workspace, target_export: exportId }) : null;
  record('other tenant cannot authorize a download of A export', !!otherDownload && denied42501(otherDownload),
    `HTTP ${otherDownload?.status} ${otherDownload?.data?.code ?? ''}`);
  const expire = exportId ? await request('/rest/v1/rpc/export_expire', { method: 'POST', admin: true, schema: 'tonde',
    body: { target_workspace: a.workspace, target_export: exportId } }) : null;
  record('the server can expire the export it built (retention is a system decision)',
    !!expire?.ok && expire.data?.state === 'expired', `HTTP ${expire?.status} ${expire?.data?.code ?? ''}`);
  const expiredDownload = exportId ? await rpc('export_download', a.token, { target_workspace: a.workspace, target_export: exportId }) : null;
  record('an expired export authorizes no download at all', !!expiredDownload && !expiredDownload.ok
    && expiredDownload.data?.code === 'PT409', `HTTP ${expiredDownload?.status} ${expiredDownload?.data?.code ?? ''}`);

  // Commercial authority: a client cannot manufacture commercial state, and a grant must name its
  // administrator. A checkout is only asserted as a refusal here: an active plan row would have to name
  // a provider price this deployment does not sell, and a hosted project must not carry a plan it
  // cannot sell, so the authorized checkout path is covered by the local database and backend suites.
  const clientWebhook = await rpc('billing_webhook_receive', a.token, { target_provider: 'certification_billing',
    target_event_id: `client-event-${Date.now()}`, target_event_type: 'customer.subscription.updated',
    target_event_created_at: new Date().toISOString(), target_signature_scheme: 'client',
    target_signature_verified_at: new Date().toISOString(), target_payload: {} });
  record('authenticated creator cannot receive a provider webhook', noClient(clientWebhook),
    `HTTP ${clientWebhook.status} ${clientWebhook.data?.code ?? ''}`);
  const clientApply = await rpc('billing_apply_subscription', a.token, { target_workspace: a.workspace,
    target_event: a.result.id, target_state: 'active', target_plan_key: null, target_provider_customer_id: 'client-customer',
    target_provider_subscription_id: 'client-subscription', target_current_period_end: null,
    target_provider_state_at: new Date().toISOString(), reason_text: 'Client attempt' });
  record('authenticated creator cannot move a subscription', noClient(clientApply),
    `HTTP ${clientApply.status} ${clientApply.data?.code ?? ''}`);
  const clientUsage = await rpc('usage_record', a.token, { target_workspace: a.workspace, target_metric: furniture.entitlement,
    target_quantity: 1, target_unit: 'credit', target_idempotency_key: `client-${Date.now()}`, target_cost_basis: 'unknown' });
  record('authenticated creator cannot record usage', noClient(clientUsage),
    `HTTP ${clientUsage.status} ${clientUsage.data?.code ?? ''}`);
  const definitionRow = await upsert('entitlement_definitions', { key: furniture.entitlement, name: 'Certification credits',
    kind: 'quota', unit: 'credit', description: 'Controlled acceptance furniture, removed when this run ends.', enabled: true });
  record('server registers a controlled entitlement definition', definitionRow.ok, `HTTP ${definitionRow.status}`);
  controlled.push(`/rest/v1/entitlement_definitions?key=eq.${furniture.entitlement}`);
  const anonymousGrant = await request('/rest/v1/rpc/billing_grant_entitlement', { method: 'POST', admin: true, schema: 'tonde', body: {
    target_workspace: a.workspace, target_key: furniture.entitlement, limit_amount: 10, note_text: 'Unattributed attempt',
    valid_until: null, target_actor: null } });
  record('an entitlement grant must name the administrator it is for', !!anonymousGrant && !anonymousGrant.ok
    && anonymousGrant.data?.code === '42501', `HTTP ${anonymousGrant.status} ${anonymousGrant.data?.code ?? ''}`);
  const clientGrant = await rpc('billing_grant_entitlement', a.token, { target_workspace: a.workspace,
    target_key: furniture.entitlement, limit_amount: 10, note_text: 'Client attempt', valid_until: null, target_actor: a.id });
  record('authenticated creator cannot grant an entitlement', noClient(clientGrant),
    `HTTP ${clientGrant.status} ${clientGrant.data?.code ?? ''}`);
  const serverGrant = definitionRow.ok ? await request('/rest/v1/rpc/billing_grant_entitlement', { method: 'POST', admin: true,
    schema: 'tonde', body: { target_workspace: a.workspace, target_key: furniture.entitlement, limit_amount: 10,
      note_text: 'Controlled grant', valid_until: null, target_actor: a.id } }) : null;
  const grantedRow = definitionRow.ok ? await request(
    `/rest/v1/workspace_entitlements?workspace_id=eq.${a.workspace}&entitlement_key=eq.${furniture.entitlement}&select=*`,
    { admin: true, schema: 'tonde' }) : null;
  record('server grants an entitlement on behalf of the administrator it names',
    !!serverGrant?.ok && grantedRow?.ok && grantedRow.data?.[0]?.granted_by === a.id,
    `HTTP ${serverGrant?.status ?? 'n/a'} granted_by ${grantedRow?.data?.[0]?.granted_by ?? 'n/a'}`);
  const entitlementBeforeRevoke = await rpc('entitlement_state', a.token, { target_workspace: a.workspace, target_key: furniture.entitlement });
  record('creator reads the granted entitlement from the server',
    !!entitlementBeforeRevoke.ok && entitlementBeforeRevoke.data === 'AVAILABLE',
    `HTTP ${entitlementBeforeRevoke.status} ${entitlementBeforeRevoke.data}`);
  const serverRevoke = serverGrant?.ok ? await request('/rest/v1/rpc/billing_revoke_entitlement', { method: 'POST', admin: true,
    schema: 'tonde', body: { target_workspace: a.workspace, target_key: furniture.entitlement,
      note_text: 'Controlled revoke', target_actor: a.id } }) : null;
  record('server revokes the entitlement it granted', !!serverRevoke?.ok, `HTTP ${serverRevoke?.status ?? 'n/a'}`);
  const entitlementAfterRevoke = await rpc('entitlement_state', a.token, { target_workspace: a.workspace, target_key: furniture.entitlement });
  // With the grant revoked and no subscription, the honest server answer is NO_SUBSCRIPTION: nothing is
  // granted, and nothing is claimed.
  record('the revoked entitlement is gone from the server answer', !!entitlementAfterRevoke.ok
    && entitlementAfterRevoke.data === 'NO_SUBSCRIPTION', `HTTP ${entitlementAfterRevoke.status} ${entitlementAfterRevoke.data}`);
  const status = await rpc('billing_status', a.token, { target_workspace: a.workspace });
  record('creator reads a server-authoritative subscription state and no invented one',
    !!status.ok && status.data?.subscription?.state === 'none' && status.data?.provider?.configured === false,
    `HTTP ${status.status} state ${status.data?.subscription?.state ?? 'n/a'} configured ${status.data?.provider?.configured ?? 'n/a'}`);
  const checkout = await rpc('billing_checkout_start', a.token, { target_workspace: a.workspace,
    target_plan: 'no_such_plan', note_text: 'Controlled attempt' });
  record('a plan the deployment does not declare cannot be checked out (not-found; the TONDE backend maps it to HTTP 404)',
    !!checkout && !checkout.ok && checkout.data?.code === 'P0002', `HTTP ${checkout.status} ${checkout.data?.code ?? ''}`);
  for (const [label, factory] of [['capability state', () => rpc('integration_capability_state', b.token, {
      target_workspace: a.workspace, target_provider: furniture.provider, target_capability: 'publish' })],
    ['subscription state', () => rpc('billing_status', b.token, { target_workspace: a.workspace })],
    ['entitlement state', () => rpc('entitlement_state', b.token, { target_workspace: a.workspace, target_key: furniture.entitlement })],
    ['publication create', () => rpc('publication_create', b.token, { target_workspace: a.workspace,
      target_production: a.production, target_result: publicationResultId, target_provider: furniture.provider,
      target_title: 'Other tenant attempt', target_caption: '', target_visibility: 'private' })],
    ['publication update', () => rpc('publication_update', b.token, { target_workspace: a.workspace,
      target_publication: publication, target_title: 'Other tenant attempt', target_caption: '',
      target_destination: 'Other tenant', target_config: {}, target_visibility: 'private' })],
    ['export request', () => rpc('export_request', b.token, { target_workspace: a.workspace,
      target_production: a.production, target_kind: 'production_package', target_format: 'json' })],
    ['checkout start', () => rpc('billing_checkout_start', b.token, { target_workspace: a.workspace,
      target_plan: 'no_such_plan', note_text: 'Other tenant attempt' })]]) {
   const answer = await factory();
   record(`other tenant cannot read or act on A ${label}`, denied42501(answer), `HTTP ${answer.status} ${answer.data?.code ?? ''}`);
  }
  const oauthStates = await request(`/rest/v1/integration_oauth_states?select=*&workspace_id=eq.${a.workspace}`, { token: a.token, schema: 'tonde' });
  record('client cannot read OAuth state rows (server-only by catalog)', oauthStates.status === 403, `HTTP ${oauthStates.status}`);
  const webhookEvents = await request('/rest/v1/billing_webhook_events?select=*', { token: a.token, schema: 'tonde' });
  record('client cannot read webhook receipts (server-only by catalog)', webhookEvents.status === 403, `HTTP ${webhookEvents.status}`);
 } finally {
  for (const path of controlled.reverse()) {
   const removed = await request(path, { method: 'DELETE', admin: true, schema: 'tonde', headers: { Prefer: 'return=minimal' } });
   if (!removed.ok) record(`controlled furniture cleanup ${path}`, false, `HTTP ${removed.status} ${removed.data?.code ?? ''}`);
  }
  controlled.length = 0;
 }
const refreshed=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:a.refresh}});record('Auth session refresh',refreshed.ok,`HTTP ${refreshed.status}`);
 const logout=await request('/auth/v1/logout',{method:'POST',token:refreshed.data?.access_token||a.token});record('Auth logout',logout.ok,`HTTP ${logout.status}`);
 const gone=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refreshed.data?.refresh_token||a.refresh}});record('Logged-out refresh rejected',!gone.ok,`HTTP ${gone.status}`);
 const settings=await request('/auth/v1/settings');record('Auth settings endpoint',settings.ok,`HTTP ${settings.status}`);
 results.push({name:'Actual signup/verification/reset email delivery and Google callback',status:'BLOCKED',detail:'Requires controlled deliverable inbox and Google OAuth credentials; admin-confirmed test users do not verify email delivery.'});
}catch(e){record('Hosted runner completed',false,e.message);}finally{
 await cleanup();writeFileSync('test-results/pre-prompt10/hosted-expanded-results.json',JSON.stringify(results,null,2));
 console.log('Summary',results.reduce((out,r)=>(out[r.status]=(out[r.status]||0)+1,out),{}));
 process.exitCode=results.some(r=>r.status==='FAIL')?1:results.some(r=>r.status==='BLOCKED')?2:0;
}
