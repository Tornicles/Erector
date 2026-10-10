import { expect, test, type Page } from '@playwright/test';
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const initialProduction = { id: productionId, workspace_id: workspace, project_id: uid, title: 'Browser test production', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 3333, calculated_duration_ms: null, start_ms: 0, end_ms: null, created_by: uid, revision: 1, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };
// These are transport fixtures, not a demo login shipped in TONDE. No remote calls occur.
async function platform(page: Page, signedIn = true) {
  let production={...initialProduction};
  await page.route('https://tonde-test.supabase.co/**', async route => {
    const request=route.request(); const path=new URL(request.url()).pathname;
    if(path.endsWith('/rpc/bootstrap_workspace')) return route.fulfill({json:workspace});
    if(path.endsWith('/rpc/create_project_with_production')) return route.fulfill({json:productionId});
    if(path==='/auth/v1/user') return route.fulfill({json:{id:uid,email:'creator@example.com'}});
    if(path==='/auth/v1/logout') return route.fulfill({status:204});
    if(path==='/rest/v1/scenes') return route.fulfill({json:[]});
    if(path==='/rest/v1/production_references') {
      if(request.method()==='POST') return route.fulfill({json:{id:'00000000-0000-4000-8000-0000000000ff',...request.postDataJSON()}});
      return route.fulfill({json:[]});
    }
    if(path==='/rest/v1/creative_documents') return route.fulfill({json:[]});
    if(path==='/rest/v1/productions') {
      if(request.method()==='PATCH') { production={...production,...request.postDataJSON(),revision:production.revision+1}; return route.fulfill({json:production}); }
      const single=request.headers().accept?.includes('vnd.pgrst.object');
      return route.fulfill({json:single?production:[production]});
    }
    return route.fulfill({status:400,json:{message:`Unexpected fixture endpoint: ${path}`}});
  });
  if(signedIn) await page.addInitScript(({uid}) => {
    const payload=btoa(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600}));
    localStorage.setItem('sb-tonde-test-auth-token',JSON.stringify({access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`,refresh_token:'test-only',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:uid,email:'creator@example.com',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:'2026-10-05T00:00:00Z'}}));
  },{uid});
}
test('all seven destinations render and browser back/forward retain canonical routes', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await platform(page); await page.goto('/home');
  for(const [label, route] of [['Home','home'],['Studio','studio'],['Projects','projects'],['Discover','discover'],['Assets','assets'],['Production Kit','setup'],['Settings','settings']]) {
    await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:label,exact:true}).click();
    await expect(page).toHaveURL(new RegExp('/'+route+'$'));
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
  }
  await page.goBack();await expect(page).toHaveURL(/\/setup$/);
  expect(errors).toEqual([]);
});
test('Studio defaults to Real, switches to AI, saves persistently and restores selected production', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await platform(page);await page.goto(`/studio/${productionId}`);
  await expect(page.getByLabel('Production title')).toHaveValue(initialProduction.title);
  await expect(page.getByText('Draft', {exact:true})).toBeVisible();
  const executionWrites: string[] = [];
  page.on('request', request => { if (request.method() === 'PATCH') executionWrites.push(request.postData() ?? ''); });
  await expect(page.getByRole('button',{name:'REAL PRODUCTION',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'AI CREATION',exact:true}).click();
  await expect(page.getByRole('button',{name:'AI CREATION',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(executionWrites).toEqual([]); // Switching representation is local UI state, not a second production or assignment.
  await page.getByLabel('Production title').fill('Persisted browser title');
  await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByLabel('Production title')).toHaveValue('Persisted browser title');
  await expect(page.getByRole('button',{name:'REAL PRODUCTION',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Studio',exact:true}).click();
  await expect(page.getByRole('link',{name:'Continue selected production'})).toHaveAttribute('href',`/studio/${productionId}`);
  await expect(page.getByText('Short Film · 0:03.333')).toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile shell collapses navigation deliberately with no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await platform(page);await page.goto('/home');
  await expect(page.getByRole('navigation',{name:'Main navigation'})).not.toBeVisible();
  await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Settings',exact:true}).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('navigation',{name:'Main navigation'})).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.goto(`/studio/${productionId}`);
  await expect(page.getByRole('button',{name:'REAL PRODUCTION',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('unauthenticated users cannot open productions and login actions stay in Supabase',async({page})=>{
  await platform(page,false);await page.goto(`/studio/${productionId}`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email address')).toBeEnabled();
  await page.getByRole('button',{name:'Create an account'}).click();
  await expect(page.getByRole('heading',{name:'Create your account'})).toBeVisible();
  await page.getByRole('button',{name:'Forgot password?'}).click();
  await expect(page.getByRole('heading',{name:'Reset your password'})).toBeVisible();
});
const apiEnvelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const studioSurfaceFixture = { production: { id: productionId, title: 'Browser test production', production_type: 'short_film', execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 2 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 30000, assigned_ms: 0, dialogue_ms: 0, action_ms: 0, slack_ms: 30000, status: 'under' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' }, reference_roles: {} };
function directorPlanFixture(answered: boolean) {
  return { operation: { operation_id: '00000000-0000-4000-8000-0000000000aa', status: 'succeeded', producer: 'deterministic' }, provider: studioSurfaceFixture.provider, intent: { goal: 'A 30-second premium coffee commercial', collaboration_mode: 'stop_at_major_decisions', primary_type: 'commercial', secondary_types: [], subject: 'premium coffee', audience: null, platform: null, runtime_ms: 30000, aspect_ratio: null, execution: 'real', execution_authority: 'creator', tonde_decided: [], answered_decisions: answered ? { product: 'North Bean' } : {}, dialogue_mode: 'minimal', constraints: {}, tone: [], deliverables: [], provenance: [], confidence: 'medium' }, questions: answered ? [] : [{ id: 'product', question: 'Which premium coffee brand is this for?', why: 'The product shapes direction.', priority: 'blocking', impact: 'critical', confidence: 'medium', depends_on: [], options: [], allow_tonde_decides: true, blocking: true, answered: false, answer: null, would_change: [] }], brief: { production_goal: 'A 30-second premium coffee commercial', production_type: 'commercial', producer: 'deterministic', revision: answered ? 2 : 1, tone: [], style_direction: [], resources: [], cast: [], environments: [], deliverables: [], hard_constraints: [], soft_preferences: [], assumptions: [], open_decisions: [], conflicts: [], runtime: { kind: 'exact', exact_ms: 30000, min_ms: null, max_ms: null, note: '' } }, story: null, script: null, scenes: [], characters: [], environments: [], products: [], style_bible: null, reality: { feasibility: 'ready', complexity: 'simple', items: [], domains: {}, conflicts: [], adaptations: [], summary: 'Ready with what you have, using one camera and available light.', inventory_used: [], notes: [] }, runtime_fit: { target_ms: 30000, assigned_ms: 0, dialogue_ms: 0, action_ms: 0, slack_ms: 30000, status: 'under' }, producer: 'deterministic', rationale: [], limitations: [], reference_influence: [], bundle: { production: { title: 'Browser test production', production_type: 'commercial', execution_method: 'real', planned_duration_ms: 30000 }, brief: {}, story: null, scenes: [], script: null, characters: [], environments: [], products: [], wardrobe_props: [], style_bible: null, reality: { feasibility: 'ready', complexity: 'simple', items: [], domains: {}, conflicts: [], adaptations: [], summary: 'Ready.', inventory_used: [], notes: [] }, runtime_fit: { target_ms: 30000, assigned_ms: 0, dialogue_ms: 0, action_ms: 0, slack_ms: 30000, status: 'under' }, techniques: [], decisions: [], producer: 'deterministic', operation: {} } };
}
test('Home plans one Production, applies the answered decisions and opens that same Production in Studio',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await platform(page);
  const plans:boolean[]=[];
  await page.route('http://127.0.0.1:8001/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/director/plan')) { const body=route.request().postDataJSON() as {answered_decisions?:Record<string,string>}; const answered=Boolean(body.answered_decisions?.product); plans.push(answered); return route.fulfill({json:apiEnvelope(directorPlanFixture(answered))}); }
    if(path.endsWith('/director/decisions')) return route.fulfill({json:apiEnvelope({stored:1,source:'intake'})});
    if(path.endsWith('/director/commit')) return route.fulfill({json:apiEnvelope({production_id:productionId,operation_id:'00000000-0000-4000-8000-0000000000aa',idempotent:false,production_revision:2,scenes:1,dialogue_lines:1})});
    if(path.endsWith('/director/studio')) return route.fulfill({json:apiEnvelope(studioSurfaceFixture)});
    if(path.endsWith('/director/provider')) return route.fulfill({json:apiEnvelope(studioSurfaceFixture.provider)});
    if(path.endsWith(`/productions/${productionId}/studio`)) return route.fulfill({json:apiEnvelope({
      production:{id:productionId,workspace_id:workspace,title:initialProduction.title,production_type:'short_film',custom_type:null,execution_method:'real',planned_duration_ms:30000,calculated_duration_ms:0,approval:'draft',locked_at:null,revision:2,lifecycle:'active',updated_at:'2026-10-05T00:00:00Z'},
      scenes:[],orphan_shots:[],assets:[],documents:{},
      timing:{total_ms:0,target_ms:30000,delta_ms:-30000,status:'under',scene_states:[]},runtime_conflict:true,timeline:[],
      status_summary:{production_approval:'draft',production_locked:false,scenes:0,shots:0,scenes_locked:0,shots_locked:0,approval_counts:{},needs_attention:0},truncated:false,
      provider:studioSurfaceFixture.provider,
      capabilities:{frame_extraction:false,frame_extraction_note:'ffmpeg is not installed.',timeline_editing:true,shot_execution:false,ai_prompt_compilation:false,note:'Real execution planning arrives with Prompt 6.'},
    })});
    return route.fulfill({json:apiEnvelope(null)});
  });
  await page.goto('/home');
  await page.getByRole('textbox',{name:'Describe what you want to make'}).fill('A 30-second premium coffee commercial');
  await page.getByRole('button',{name:'DIRECT THIS'}).click();
  await expect(page.getByRole('heading',{name:'TONDE is shaping one Master Production'})).toBeVisible();
  await expect(page.getByText(/No model provider is configured, so this plan is deterministic/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Which premium coffee brand is this for? *'})).toBeVisible();
  await expect(page.getByRole('button',{name:'BUILD PRODUCTION'})).toBeDisabled();
  await page.getByLabel('Your answer').fill('North Bean');
  await page.getByRole('button',{name:'Save answer'}).click();
  const build=page.getByRole('button',{name:'BUILD PRODUCTION'});
  await expect(build).toBeEnabled();
  expect(plans).toEqual([false,true]);
  await build.click();
  // Studio canonicalises its own query (tool/scene) after the read model loads, so the Production id
  // is the stable assertion and the canonical query is allowed to be present or still pending.
  await expect(page).toHaveURL(new RegExp(`/studio/${productionId}(\\?[^/]*)?$`));
  await expect(page.getByLabel('Production title')).toHaveValue(initialProduction.title);
  await expect(page.getByText(/Director · deterministic only/)).toBeVisible();
  await page.getByRole('button',{name:'Reality Check'}).click();
  await expect(page.getByText('No Reality Check yet')).toBeVisible();
  expect(await page.evaluate((key)=>localStorage.getItem(key),`tonde:director-plan:${workspace}`)).toBeNull();
  expect(errors).toEqual([]);
});
test('global command search finds and opens an exact Production result',async({page})=>{
  await platform(page);await page.goto('/home');
  await page.getByRole('button',{name:'Open global search'}).click();
  const dialog=page.getByRole('dialog',{name:'Global search and commands'});
  await page.getByLabel('Search or go to a TONDE area').fill('Browser test production');
  const result=dialog.getByRole('option',{name:/Browser test production/});
  await expect(result).toBeVisible();
  await result.click();
  // Studio canonicalises its own query (tool/scene) after the read model loads, so the Production id
  // is the stable assertion and the canonical query is allowed to be present or still pending.
  await expect(page).toHaveURL(new RegExp(`/studio/${productionId}(\\?[^/]*)?$`));
  await expect(page.getByLabel('Production title')).toHaveValue(initialProduction.title);
});
test('global search dialog traps focus and restores it on close',async({page})=>{
  await platform(page);await page.goto('/home');
  const trigger=page.getByRole('button',{name:'Open global search'});
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const dialog=page.getByRole('dialog',{name:'Global search and commands'});
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Search or go to a TONDE area')).toBeFocused();
  // Focus must never leave the modal dialog while it is open.
  for(let i=0;i<12;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
test('asset detail and archive dialogs trap focus and restore their invoker',async({page})=>{
  const asset={id:'00000000-0000-4000-8000-000000000004',workspace_id:workspace,asset_type:'character',name:'Maya',description:'Lead character',metadata:{},provenance:{},search_metadata:{},consistency_metadata:{},lifecycle:'active',approval:'draft',locked_at:null,revision:1,created_by:uid,created_at:'2026-10-05T00:00:00Z',updated_at:'2026-10-05T00:00:00Z'};
  await platform(page);
  await page.route('https://tonde-test.supabase.co/rest/v1/assets**',route=>route.fulfill({json:[asset]}));
  await page.route('https://tonde-test.supabase.co/rest/v1/scope_bindings**',route=>route.fulfill({json:[],headers:{'content-range':'0-0/0'}}));
  await page.goto('/assets');
  const row=page.getByRole('button',{name:/Maya/});await row.click();
  const drawer=page.getByRole('dialog',{name:'Maya asset details'});
  const close=drawer.getByRole('button',{name:'Close asset details'});
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button',{name:'Archive Asset'})).toBeFocused();
  await close.click();await expect(drawer).toBeHidden();await expect(row).toBeFocused();
  await row.click();const reopened=page.getByRole('dialog',{name:'Maya asset details'});
  const archive=reopened.getByRole('button',{name:'Archive Asset'});await archive.click();
  const confirmation=page.getByRole('dialog',{name:'Archive Maya?'});
  const cancel=confirmation.getByRole('button',{name:'Cancel archive'});
  await expect(cancel).toBeFocused();await page.keyboard.press('Shift+Tab');
  await expect(confirmation.getByRole('button',{name:'Archive Asset',exact:true})).toBeFocused();
  await cancel.click();await expect(confirmation).toBeHidden();await expect(archive).toBeFocused();
});
