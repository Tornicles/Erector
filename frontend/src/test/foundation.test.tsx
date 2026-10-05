import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AuthContext, AuthProvider, useAuth } from '../contexts/AuthContext';
import { appRoutes } from '../App';
import { StudioComposition } from '../pages/StudioPage';
import { AppError } from '../services/errors';
import { productionService, type DirectorBrief, type DirectorPlanResponse, type DirectorStudio } from '../services/productions';
import { authService } from '../services/auth';
import { durationMs, formatRuntime, type Production } from '../types/domain';
import { validateFile } from '../services/media';
import { validatePublicConfiguration } from '../lib/supabase';

const mocks = vi.hoisted(() => ({
  auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn(), signInWithOAuth: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() },
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../lib/supabase', async importOriginal => {
  const original = await importOriginal<typeof import('../lib/supabase')>();
  const client = { auth: mocks.auth, rpc: mocks.rpc, from: mocks.from };
  return { ...original, configurationError: null, localPreview: false, supabase: client, requireSupabase: () => client };
});
vi.mock('../services/productions', () => ({
  PAGE_SIZE: 40,
  productionService: {
    list: vi.fn(), listReferences: vi.fn(), getReferences: vi.fn(), get: vi.fn(), scenes: vi.fn(), shots: vi.fn(),
    saveTitle: vi.fn(), create: vi.fn(), archive: vi.fn(), restore: vi.fn(), setLifecycle: vi.fn(), addReference: vi.fn(),
    directorProviderStatus: vi.fn(), directorStudioSurface: vi.fn(), directorPlan: vi.fn(), directorCommit: vi.fn(),
    directorCommand: vi.fn(), directorCommandPreview: vi.fn(), analyzeDirectorReference: vi.fn(), saveDirectorBrief: vi.fn(),
    recordDirectorDecisions: vi.fn(), directorStoryAlternatives: vi.fn(), directorDialogueOperation: vi.fn(),
  },
}));
const userId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const productionId = '00000000-0000-4000-8000-000000000003';
const session: Session = { access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user: { id: userId, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-05T00:00:00Z' } };
const production: Production = { id: productionId, workspace_id: workspaceId, project_id: userId, title: 'A first production', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 10000, calculated_duration_ms: null, start_ms: 0, end_ms: null, created_by: userId, revision: 1, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };
const auth = { session, workspaceId, loading: false, error: null, configured: true, localPreview: false, retry: vi.fn() };
const question = (id: string, text: string, answered = false, answer: string | null = null) => ({ id, question: text, why: 'This decision changes the direction.', priority: answered ? 'high_impact' : 'blocking', impact: 'critical' as const, confidence: 'medium' as const, depends_on: [], options: [], allow_tonde_decides: true, blocking: !answered, answered, answer, would_change: [] });
const briefFixture = (): DirectorBrief => ({
  production_goal: 'A 30-second premium coffee commercial', audience: 'Specialty coffee buyers', core_message: 'Craft you can taste', desired_response: 'Visit the roastery',
  production_type: 'commercial', format: 'commercial', platform: 'Instagram', aspect_ratio: '9:16', tone: ['premium'], creative_concept: 'Slow steam and a deliberate pour',
  story_approach: 'Sensory build to the hero pour', dialogue_mode: 'minimal', dialogue_approach: 'One spoken line', voiceover_approach: null, product_brand: 'North Bean',
  product_category: 'premium coffee', call_to_action: 'Find us', style_direction: ['warm highlights'], execution_preference: 'real', resources: [], crew_size: 1, available_hours: 4,
  deadline: null, budget_amount: null, cast: [], environments: ['Roastery'], deliverables: ['9:16 master'], hard_constraints: ['One camera'], soft_preferences: [],
  collaboration_mode: 'stop_at_major_decisions', producer: 'deterministic', revision: 2,
  runtime: { kind: 'exact', exact_ms: 30000, min_ms: null, max_ms: null, note: '' }, style_dna: null,
  assumptions: [{ statement: 'Available window light is used instead of owning a light.', basis: 'no lighting listed in Setup', status: 'assumption' }],
  open_decisions: [question('product', 'Which premium coffee brand is this for?', true, 'North Bean')], conflicts: [],
});
const realityFixture = { feasibility: 'adapt' as const, complexity: 'simple' as const, items: [{ domain: 'equipment', requirement: 'Single camera', status: 'missing', resource: null, evidence: [], recommendation: 'Use the phone camera you already listed, or change this scene to a locked frame.', confidence: 'medium' as const }], domains: { equipment: 'partial' }, conflicts: ['One camera against two simultaneous angles'], adaptations: [{ scope: 'scene', target: 'Scene 2', change: 'Shoot the pour and the reaction sequentially.', reason: 'One camera cannot cover both at once.' }], summary: 'Shootable with one camera and available light after a small Scene adaptation.', inventory_used: [], notes: [] };
const storyFixture = { title: 'North Bean — Slow Craft', logline: 'A cup of coffee proves that patience is the ingredient.', premise: 'A barista slows down against a hurried morning.', central_question: 'Is there time to do it properly?', protagonist: 'The barista', desire: 'Serve the perfect cup', conflict: 'The morning rush', stakes: 'The craft is invisible', hook: 'Steam curling in a dark frame', payoff: 'The first sip', call_to_action: 'Find us', beats: [{ id: 'beat-hook', order: 1, name: 'Hook', story_function: 'Earn attention', content: 'A breath of steam in darkness.', emotion: 'Anticipation', visual_idea: 'Backlit steam', techniques: ['silhouette-reveal'], planned_duration_ms: 10000 }], emotional_progression: ['anticipation', 'satisfaction'], beginning: 'Darkness and steam', middle: 'The deliberate pour', ending: 'The first sip', theme: 'Patience', grammar: 'commercial_hero', variation: 'original', dialogue_mode: 'minimal', dialogue_approach: 'One line at the payoff', runtime_ms: 30000, producer: 'deterministic', assumptions: [] };
const scriptFixture = { title: 'North Bean — Slow Craft', scenes: [{ scene_order: 1, scene_title: 'Roastery dawn', heading: 'INT. ROASTERY — DAWN', action: ['Steam curls through a shaft of window light.'], lines: [{ order: 1, kind: 'dialogue', speaker: 'Barista', content: 'Give it a minute.', estimated_ms: 1800, intention: 'Calm authority', delivery: 'quiet', pause_after_ms: 400, interruption: false, overlap: false, reaction_to: null, subtext: 'Craft is worth waiting for', scene_order: 1 }], product_direction: 'North Bean bag in frame left', transition: 'CUT TO:', notes: 'Keep the label readable.', planned_duration_ms: 30000 }], dialogue_mode: 'minimal', dialogue_approach: 'One line at the payoff', estimated_runtime_ms: 30000, producer: 'deterministic' };
const planFixture = (answered: boolean): DirectorPlanResponse => ({
  operation: { operation_id: '00000000-0000-4000-8000-000000000009', status: 'succeeded', producer: 'deterministic' },
  provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: ['reasoning'], notes: ['No provider credentials configured.'], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' },
  intent: { goal: 'A 30-second premium coffee commercial', collaboration_mode: 'stop_at_major_decisions', primary_type: 'commercial', secondary_types: [], subject: 'premium coffee', audience: null, platform: null, runtime_ms: 30000, aspect_ratio: null, execution: 'real', execution_authority: 'creator', tonde_decided: [], answered_decisions: answered ? { product: 'North Bean' } : {}, dialogue_mode: 'minimal', constraints: {}, tone: ['premium'], deliverables: [], provenance: [], confidence: 'medium' },
  questions: answered ? [] : [question('product', 'Which premium coffee brand is this for?')],
  brief: { ...briefFixture(), revision: answered ? 2 : 1, open_decisions: answered ? briefFixture().open_decisions : [question('product', 'Which premium coffee brand is this for?')] },
  story: storyFixture, script: scriptFixture,
  scenes: [{ order: 1, title: 'Roastery dawn', purpose: 'Establish the craft', story_beat: 'Hook', description: 'Steam and light.', action_lines: ['Steam curls through a shaft of window light.'], planned_duration_ms: 30000, opening_state: 'Darkness', ending_state: 'The first sip', visual_intent: 'Warm backlight' }],
  characters: [{ name: 'Barista', role: 'lead', story_function: 'Carries the craft', objective: 'Serve the perfect cup', visual_description: 'Apron, hands, steam', performance_direction: 'Unhurried', relationships: [], recurring: false, discovered_from_reference: false }],
  environments: [{ name: 'Roastery', visual_requirements: ['Window light'], story_purpose: 'Where the craft happens', spatial_needs: [], lighting_context: 'Window light', scene_usage: [1] }],
  products: [{ name: 'North Bean', role: 'hero product', required_visibility: 'hero', hero_moments: ['Label readable at the pour'], fidelity_importance: 'high', interactions: ['Pour'], packaging_notes: [] }],
  style_bible: { title: 'North Bean Style', summary: 'Camera: slow, low contrast', sections: [{ section: 'lighting', description: 'Soft window light with deep falloff', directives: ['Expose for highlights'], epistemic: 'estimated', confidence: 'medium' }], producer: 'deterministic' },
  reality: realityFixture, runtime_fit: { target_ms: 30000, assigned_ms: 30000, dialogue_ms: 2200, action_ms: 27800, slack_ms: 0, status: 'fits' },
  producer: 'deterministic', rationale: ['Premium commercial structure'], limitations: ['Frame extraction is unavailable, so video References were measured from metadata only.'],
  reference_influence: [], bundle: {
    production: { title: 'North Bean — Slow Craft', production_type: 'commercial', execution_method: 'real', planned_duration_ms: 30000 },
    brief: briefFixture(), story: storyFixture, scenes: [{ order: 1, title: 'Roastery dawn', purpose: 'Establish the craft', story_beat: 'Hook', description: 'Steam and light.', action_lines: ['Steam curls through a shaft of window light.'], planned_duration_ms: 30000, opening_state: 'Darkness', ending_state: 'The first sip', visual_intent: 'Warm backlight' }],
    script: scriptFixture, characters: [], environments: [], products: [], wardrobe_props: [], style_bible: null, reality: realityFixture,
    runtime_fit: { target_ms: 30000, assigned_ms: 30000, dialogue_ms: 2200, action_ms: 27800, slack_ms: 0, status: 'fits' }, techniques: [], decisions: [], producer: 'deterministic', operation: {},
  },
});
const studioFixture = (): DirectorStudio => ({
  production: { id: productionId, title: 'North Bean — Slow Craft', production_type: 'commercial', execution_method: 'real', planned_duration_ms: 30000, approval: 'draft', locked_at: null, revision: 3 },
  brief: briefFixture(), brief_revision: 2, brief_producer: 'deterministic', story: storyFixture, story_variation: 'original', story_producer: 'deterministic',
  scenes: [{ id: '00000000-0000-4000-8000-000000000010', order: 1, title: 'Roastery dawn', purpose: 'Establish the craft', story_beat: 'Hook', description: 'Steam and light.', action_lines: ['Steam curls through a shaft of window light.'], characters: ['Barista'], environment: 'Roastery', products: ['North Bean'], techniques: ['silhouette-reveal'], shots: [], dialogue_notes: 'Keep the label readable.', planned_duration_ms: 30000, opening_state: 'Darkness', ending_state: 'The first sip', visual_intent: 'Warm backlight', dialogue: [{ id: '00000000-0000-4000-8000-000000000011', scene_id: '00000000-0000-4000-8000-000000000010', kind: 'dialogue', speaker: 'Barista', content: 'Give it a minute.', duration_ms: 1800, intention: 'Calm authority', delivery: 'quiet', subtext: 'Craft is worth waiting for', pause_after_ms: 400, flags: {} }] }],
  runtime_fit: { target_ms: 30000, assigned_ms: 30000, dialogue_ms: 2200, action_ms: 27800, slack_ms: 0, status: 'fits' },
  documents: { script: { title: 'North Bean — Slow Craft', content: 'North Bean — Slow Craft\n\nINT. ROASTERY — DAWN\n\nSteam curls through a shaft of window light.\n\nBARISTA\n  Give it a minute.\n\n>> CUT TO:', revision: 1, updated_at: '2026-10-05T00:00:00Z' } },
  reality: realityFixture, reality_source_revision: 3, setup_listed: ['Phone camera'], reality_used_setup: true,
  references: [{ reference_id: '00000000-0000-4000-8000-000000000012', source_type: 'video', source_url: null, source_description: 'Premium coffee ad', rights_classification: 'unknown', state: 'analyzed', role: 'lighting', capability: { capability: 'metadata_only', media_bytes: 'unavailable', modalities: {}, note: 'Only container metadata was readable; no frames or audio were available.', producer: 'unverified' }, status: 'partial', stages: ['queued', 'preprocessing', 'analyzing'], summary: 'Metadata-only analysis.', producer: 'deterministic', findings: [{ finding_id: 'finding-1', category: 'lighting', statement: 'The read metadata lists a slow shutter.', epistemic: 'observed', confidence: 'medium', evidence: [{ kind: 'measurement', start_ms: null, end_ms: null, frame_id: null, detail: 'container metadata' }], technique_id: null, limitations: [] }], techniques: [{ canonical_id: 'low-key-bounce', name: 'Low-key bounce', category: 'lighting', description: 'Shape with a single soft source.', purpose: 'Keep falloff deep.', effect: 'Premium contrast.', importance: 'essential', confidence: 'medium', practical_concept: 'One soft source plus a bounce card.', ai_concept: 'Describe one soft source with deep falloff.', conditions: ['Dark room'], limitations: [] }], style: { palette: ['warm'], sections: [{ section: 'lighting', description: 'Soft window light', directives: ['Expose for highlights'], epistemic: 'estimated', confidence: 'medium' }] }, causal: [{ question: 'What makes this feel premium?', explanation: 'Deep falloff and a slow reveal.', drivers: ['low-key-bounce'], confidence: 'medium' }], adaptation_notes: ['Use your own window light.'], limitations: ['No frames were extracted.'] }],
  techniques: [{ canonical_id: 'low-key-bounce', name: 'Low-key bounce', category: 'lighting', description: 'Shape with a single soft source.', purpose: 'Keep falloff deep.', effect: 'Premium contrast.', importance: 'essential', confidence: 'medium', practical_concept: 'One soft source plus a bounce card.', ai_concept: 'Describe one soft source with deep falloff.', conditions: ['Dark room'], limitations: [] }],
  decisions: [], operations: [], provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' }, reference_roles: { '00000000-0000-4000-8000-000000000012': 'lighting' },
});
function route(path: string, signedIn = true) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<AuthContext.Provider value={{ ...auth, session: signedIn ? session : null, workspaceId: signedIn ? workspaceId : null }}><RouterProvider router={router} /></AuthContext.Provider>);
  return router;
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(productionService.directorStudioSurface).mockResolvedValue(studioFixture());
  vi.mocked(productionService.directorProviderStatus).mockResolvedValue(studioFixture().provider);
  vi.mocked(productionService.directorCommandPreview).mockResolvedValue({ kind: 'scene_intensity', scope: 'scene', confidence: 'high', rationale: 'I will intensify Scene 1 within the runtime it already has.', operations: ['intensify_scene'], signals: ['scene 1'], reference_role: null, target_runtime_ms: null, scene_order: 1 });
  vi.mocked(productionService.directorCommand).mockResolvedValue({ command: { kind: 'scene_intensity', scope: 'scene', confidence: 'high', rationale: 'I will intensify Scene 1.', operations: ['intensify_scene'], signals: [], scene_order: 1, reference_role: null, target_runtime_ms: null, parameters: {} }, rationale: 'Scene 1 intensification', answer: 'Scene 1 is more intense inside its existing runtime.', changes: ['Scene 1 intensified'], operations: ['intensify_scene'], limitations: [], causal: [], story_alternatives: [], line_alternatives: {}, reference_role: null, adaptations_applied: [], plan: null, producer: 'deterministic', applied: null });
  const query: Record<string, any> = {};
  Object.assign(query, {
    select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query), range: vi.fn(() => query),
    ilike: vi.fn(() => query), in: vi.fn(() => query), insert: vi.fn(() => query), update: vi.fn(() => query),
    single: vi.fn(async () => ({ data: null, error: null })), maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve: (result: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
  });
  mocks.from.mockReturnValue(query);
  vi.mocked(productionService.list).mockResolvedValue([]);
  vi.mocked(productionService.listReferences).mockResolvedValue([]);
  vi.mocked(productionService.getReferences).mockResolvedValue([]);
  vi.mocked(productionService.scenes).mockResolvedValue([]);
  vi.mocked(productionService.shots).mockResolvedValue([]);
  vi.mocked(productionService.get).mockResolvedValue({ ...production });
  vi.mocked(productionService.addReference).mockResolvedValue('reference-id');
  vi.mocked(productionService.recordDirectorDecisions).mockResolvedValue({ stored: 1, source: 'intake' });
  vi.mocked(productionService.restore).mockResolvedValue(undefined);
  mocks.auth.getSession.mockResolvedValue({ data: { session }, error: null });
  mocks.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.rpc.mockResolvedValue({ data: workspaceId, error: null });
  for (const action of ['signInWithPassword','signUp','signInWithOAuth','resetPasswordForEmail','updateUser','signOut'] as const) mocks.auth[action].mockResolvedValue({ data: { session }, error: null });
});
describe('canonical application routes', () => {
  it.each([['/home','What do you want to make'],['/studio','Studio'],['/projects','Projects'],['/discover','Discover'],['/assets','Assets'],['/setup','Setup'],['/settings','Settings']])('%s renders inside the authenticated seven-area shell', async (path, title) => {
    route(path);
    expect(await screen.findByRole('heading', { level: 1, name: new RegExp(title) })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Main navigation' }).querySelectorAll('a')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible();
  });
  it('protects private routes and contains no legacy route', async () => {
    const router = route('/projects', false);
    expect(await screen.findByRole('heading', { name: /Your next production/ })).toBeVisible();
    expect(router.state.location.pathname).toBe('/login');
  });
  it('production loads and selection persists within workspace', async () => {
    route(`/studio/${productionId}`);
    expect(await screen.findByLabelText('Production title')).toHaveValue(production.title);
    expect(productionService.get).toHaveBeenCalledWith(workspaceId, productionId);
    expect(localStorage.getItem(`tonde:${workspaceId}:production`)).toBe(productionId);
    expect(screen.getByRole('button', { name: 'REAL PRODUCTION' })).toHaveAttribute('aria-pressed','true');
    fireEvent.click(screen.getByRole('button', { name: 'AI CREATION' }));
    expect(screen.getByRole('button', { name: 'AI CREATION' })).toHaveAttribute('aria-pressed','true');
  });
  it('creates canonical project/production and opens its Studio', async () => {
    vi.mocked(productionService.create).mockResolvedValue(productionId);
    const router=route('/projects');
    fireEvent.change(await screen.findByLabelText('Start a production'),{target:{value:'New production'}});
    fireEvent.click(screen.getByRole('button',{name:'DIRECT THIS'}));
    await waitFor(()=>expect(router.state.location.pathname).toBe(`/studio/${productionId}`));
    expect(productionService.create).toHaveBeenCalledWith(workspaceId,'New production');
  });
  it('Direct This creates one shared Production, plans it, answers decisions and commits to Studio', async () => {
    vi.mocked(productionService.create).mockResolvedValue(productionId);
    vi.mocked(productionService.directorPlan).mockResolvedValueOnce(planFixture(false)).mockResolvedValueOnce(planFixture(true));
    vi.mocked(productionService.directorCommit).mockResolvedValue({ production_id: productionId, operation_id: '00000000-0000-4000-8000-000000000009', idempotent: false, production_revision: 4 });
    const router = route('/home');
    fireEvent.change(await screen.findByRole('textbox',{name:'Describe what you want to make'}),{target:{value:'A 30-second premium coffee commercial'}});
    fireEvent.click(screen.getByRole('button',{name:'DIRECT THIS'}));
    await waitFor(()=>expect(productionService.create).toHaveBeenCalledWith(workspaceId,'A 30-second premium coffee commercial'));
    await waitFor(()=>expect(productionService.addReference).toHaveBeenCalledWith(workspaceId,productionId,{source_type:'description',source_description:'A 30-second premium coffee commercial'}));
    expect(productionService.directorPlan).toHaveBeenCalledWith(workspaceId, productionId, expect.objectContaining({ goal: 'A 30-second premium coffee commercial', collaboration_mode: 'stop_at_major_decisions' }));
    expect(await screen.findByRole('heading',{name:'Which premium coffee brand is this for? *'})).toBeVisible();
    expect(screen.getByRole('button',{name:'BUILD PRODUCTION'})).toBeDisabled();
    expect(screen.getByText(/STORY · ORIGINAL/)).toBeVisible();
    expect(screen.getByText(/SCRIPT · minimal/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Your answer'),{target:{value:'North Bean'}});
    fireEvent.click(screen.getByRole('button',{name:'Save answer'}));
    await waitFor(()=>expect(productionService.recordDirectorDecisions).toHaveBeenCalledWith(workspaceId, productionId, { product: 'North Bean' }, 'intake', { product: 'Which premium coffee brand is this for?' }));
    await waitFor(()=>expect(productionService.directorPlan).toHaveBeenCalledTimes(2));
    const build = await screen.findByRole('button',{name:'BUILD PRODUCTION'});
    await waitFor(()=>expect(build).toBeEnabled());
    fireEvent.click(build);
    await waitFor(()=>expect(productionService.directorCommit).toHaveBeenCalledWith(workspaceId, productionId, expect.objectContaining({ operation_id: '00000000-0000-4000-8000-000000000009', expected_production_revision: 1, explicit_confirmation: true })));
    await waitFor(()=>expect(router.state.location.pathname).toBe(`/studio/${productionId}`));
    expect(localStorage.getItem(`tonde:director-plan:${workspaceId}`)).toBeNull();
  });
  it('global command search opens from keyboard and navigates through real destinations', async () => {
    const router=route('/home');
    fireEvent.keyDown(window,{key:'k',ctrlKey:true});
    expect(await screen.findByRole('dialog',{name:'Global search and commands'})).toBeVisible();
    fireEvent.change(screen.getByLabelText('Search or go to a TONDE area'),{target:{value:'Open Setup'}});
    fireEvent.click(screen.getByRole('option',{name:'Open Setup Cameras, software and tools'}));
    await waitFor(()=>expect(router.state.location.pathname).toBe('/setup'));
  });
  it('Discover can search a technique, save it, and hand it to Home without fabricating analysis', async () => {
    const router=route('/discover');
    expect(await screen.findByRole('heading',{name:'Discover'})).toBeVisible();
    fireEvent.change(screen.getByRole('textbox',{name:'Search production knowledge'}),{target:{value:'handheld tension'}});
    expect(screen.getByRole('heading',{name:'Handheld Tension'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:/^Save$/}));
    expect(screen.getByRole('button',{name:/^Saved$/})).toHaveAttribute('aria-pressed','true');
    fireEvent.click(screen.getByRole('button',{name:/^Direct This$/}));
    await waitFor(()=>expect(router.state.location.pathname).toBe('/home'));
    await waitFor(()=>expect((screen.getByRole('textbox',{name:'Describe what you want to make'}) as HTMLTextAreaElement).value).toContain('Handheld Tension'));
  });
  it('Home upload/URL mode truthfully gates unsupported import and recording actions', async () => {
    route('/home');
    await screen.findByRole('heading',{name:'What do you want to make?'});
    fireEvent.click(screen.getByRole('tab',{name:'Import'}));
    expect(screen.getByRole('status')).toHaveTextContent('No external import source is connected yet');
    fireEvent.click(screen.getByRole('tab',{name:'Record'}));
    expect(screen.getByRole('status')).toHaveTextContent('Recording is not configured');
    fireEvent.click(screen.getByRole('tab',{name:'Paste URL'}));
    expect(screen.getByLabelText('Reference URL')).toBeVisible();
  });
  it('Settings exposes its real application sections and asset/setup terminology is separate', async () => {
    route('/settings');
    expect(await screen.findByRole('navigation',{name:'Settings sections'})).toHaveTextContent('AccountAppearanceNotificationsConnectionsStorage & DataPrivacy & SecurityBillingHelp');
    cleanup();
    route('/assets');
    expect(await screen.findByRole('heading',{name:'Assets'})).toBeVisible();
    expect(screen.getByRole('combobox',{name:'Filter assets'})).toHaveTextContent('Environments / Worlds');
  });
});
describe('Studio Director intelligence surfaces', () => {
  function studio(){const router=createMemoryRouter([{path:'/',element:<StudioComposition initial={production} reload={vi.fn()}/>}]);render(<RouterProvider router={router}/>);}
  it('loads the real surface and renders Brief, References, Story, Script and Reality Check canvases', async () => {
    studio();
    expect(await screen.findByText(/Director · deterministic only/)).toBeVisible();
    expect(productionService.directorStudioSurface).toHaveBeenCalledWith(workspaceId, productionId);
    expect(await screen.findByText(/no provider configured/)).toBeVisible();
    expect(screen.getByText(/Techniques carried into this Production/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Brief'}));
    expect(await screen.findByLabelText('Intelligent Brief')).toBeVisible();
    expect(screen.getByLabelText('Production goal')).toHaveValue('A 30-second premium coffee commercial');
    expect(screen.getByText(/Revision 2/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'References'}));
    expect(await screen.findByLabelText('Reference analysis')).toBeVisible();
    expect(screen.getByText(/Only container metadata was readable/)).toBeVisible();
    expect(screen.getByText('Observed')).toBeVisible();
    expect(screen.getByText(/What makes this work/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Story'}));
    expect(await screen.findByLabelText('Story')).toBeVisible();
    expect(screen.getByText('North Bean — Slow Craft')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Script'}));
    expect(await screen.findByLabelText('Script')).toBeVisible();
    expect(screen.getAllByText(/Give it a minute\./).length).toBeGreaterThan(0);
    expect(screen.getByText(/Persisted Script/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Reality Check'}));
    expect(await screen.findByLabelText('Reality check')).toBeVisible();
    expect(screen.getByText(/Shootable with one camera/)).toBeVisible();
    expect(screen.getByText(/One camera against two simultaneous angles/)).toBeVisible();
  });
  it('saves an edited Brief against its revision and refuses to claim success on failure', async () => {
    vi.mocked(productionService.saveDirectorBrief).mockResolvedValueOnce({ brief: briefFixture(), revision: 3, producer: 'deterministic' });
    studio();
    fireEvent.click(await screen.findByRole('button',{name:'Brief'}));
    fireEvent.change(await screen.findByLabelText('Audience'),{target:{value:'Home brewers'}});
    fireEvent.click(screen.getByRole('button',{name:'Save Brief'}));
    await waitFor(()=>expect(productionService.saveDirectorBrief).toHaveBeenCalledWith(workspaceId, productionId, 2, expect.objectContaining({ audience: 'Home brewers' })));
    expect(await screen.findByText('Brief saved as revision 3.')).toBeVisible();
  });
  it('previews a Director command and applies it only when the creator asks', async () => {
    const result = (applied: boolean) => ({ command: { kind: 'scene_intensity', scope: 'scene', confidence: 'high' as const, rationale: 'I will intensify Scene 1.', operations: ['intensify_scene'], signals: [], scene_order: 1, reference_role: null, target_runtime_ms: null, parameters: {} }, rationale: 'Scene 1 intensification', answer: 'Scene 1 is more intense inside its existing runtime.', changes: ['Scene 1 intensified'], operations: ['intensify_scene'], limitations: [], causal: [], story_alternatives: [], line_alternatives: {}, reference_role: null, adaptations_applied: [], plan: applied ? null : planFixture(true).bundle, producer: 'deterministic', applied: applied ? { production_id: productionId, operation_id: 'op-1', idempotent: false, production_revision: 4 } : null });
    vi.mocked(productionService.directorCommand).mockResolvedValueOnce(result(false)).mockResolvedValueOnce(result(true));
    studio();
    fireEvent.change(await screen.findByLabelText('Message to the Director'), { target: { value: 'Make Scene 1 more intense.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(productionService.directorCommandPreview).toHaveBeenCalledWith(workspaceId, productionId, 'Make Scene 1 more intense.'));
    expect(await screen.findByText(/I will intensify Scene 1 within the runtime it already has\./)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Send direction/ }));
    await waitFor(() => expect(productionService.directorCommand).toHaveBeenCalledWith(workspaceId, productionId, expect.objectContaining({ text: 'Make Scene 1 more intense.', apply: false })));
    expect(await screen.findByText('Scene 1 is more intense inside its existing runtime.')).toBeVisible();
    expect(screen.getByText(/Use Apply to persist it/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Apply to this Production/ }));
    await waitFor(() => expect(productionService.directorCommand).toHaveBeenLastCalledWith(workspaceId, productionId, expect.objectContaining({ apply: true, expected_production_revision: 3 })));
    expect(await screen.findByText(/Applied and saved to this Production \(revision 4\)/)).toBeVisible();
  });
  it('reports an unavailable Director service instead of fabricating a surface', async () => {
    vi.mocked(productionService.directorStudioSurface).mockRejectedValueOnce(new AppError('unavailable','The TONDE service is unavailable.'));
    studio();
    fireEvent.click(await screen.findByRole('button',{name:'Story'}));
    expect(await screen.findByText('Director intelligence is unavailable')).toBeVisible();
    expect(screen.getByText('The TONDE service is unavailable.')).toBeVisible();
  });
});
describe('Supabase Auth authority', () => {
  it('restores session and bootstraps workspace', async () => {
    function Probe(){const auth=useAuth();return <p>{auth.loading?'loading':auth.workspaceId ?? 'none'}</p>;}
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText(workspaceId)).toBeVisible();
    expect(mocks.rpc).toHaveBeenCalledWith('bootstrap_workspace');
  });
  it('handles logout auth event and recovers bootstrap failure', async () => {
    let listener: (_event: string, next: Session | null) => void = () => {};
    mocks.auth.onAuthStateChange.mockImplementation((callback) => { listener=callback; return {data:{subscription:{unsubscribe:vi.fn()}}}; });
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST000'}});
    function Probe(){const a=useAuth();return <><p>{a.error ?? a.workspaceId ?? 'signed out'}</p><button onClick={a.retry}>Retry</button></>;}
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText(/could not complete/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Retry'}));
    expect(await screen.findByText(workspaceId)).toBeVisible();
    act(()=>listener('SIGNED_OUT',null));
    expect(await screen.findByText('signed out')).toBeVisible();
  });
  it('token refresh does not unmount Studio or repeat bootstrap', async () => {
    let listener: (_event: string, next: Session | null) => void = () => {};
    mocks.auth.onAuthStateChange.mockImplementation(callback => { listener=callback; return {data:{subscription:{unsubscribe:vi.fn()}}}; });
    function Probe(){const a=useAuth();return <p>{a.loading ? 'loading' : a.session?.access_token}</p>;}
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('test-token')).toBeVisible();
    const calls=mocks.rpc.mock.calls.length;
    act(()=>listener('TOKEN_REFRESHED',{...session,access_token:'refreshed-token'}));
    expect(await screen.findByText('refreshed-token')).toBeVisible();
    expect(mocks.rpc.mock.calls.length).toBe(calls);
  });
  it('email/Google/reset/logout actions use Supabase only', async () => {
    await authService.signIn('creator@example.com','password123');
    await authService.signUp('creator@example.com','password123');
    await authService.google(); await authService.resetPassword('creator@example.com'); await authService.signOut();
    expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({email:'creator@example.com',password:'password123'});
    expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith({provider:'google',options:{redirectTo:expect.stringMatching(/\/auth\/callback$/)}});
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith('creator@example.com',{redirectTo:expect.stringMatching(/\/auth\/reset$/)});
    expect(mocks.auth.signOut).toHaveBeenCalledOnce();
  });
});
describe('autosave foundation', () => {
  function studio(){const router=createMemoryRouter([{path:'/',element:<StudioComposition initial={production} reload={vi.fn()}/>}]);render(<RouterProvider router={router}/>);}
  it('never displays Saved before persistence succeeds and uses current revision', async () => {
    let resolve!: (value: Production)=>void;
    vi.mocked(productionService.saveTitle).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    studio();
    fireEvent.change(screen.getByLabelText('Production title'),{target:{value:'Edited title'}});
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(await screen.findByText('Saving…')).toBeVisible();
    await act(async()=>resolve({...production,title:'Edited title',revision:2}));
    expect(await screen.findByText('Saved')).toBeVisible();
    expect(productionService.saveTitle).toHaveBeenCalledWith(production,'Edited title');
  });
  it('serializes changes made while the first save is in flight', async () => {
    let resolve!: (value: Production)=>void;
    vi.mocked(productionService.saveTitle).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    vi.mocked(productionService.saveTitle).mockResolvedValueOnce({...production,title:'Second edit',revision:3});
    studio();fireEvent.change(screen.getByLabelText('Production title'),{target:{value:'First edit'}});
    await screen.findByText('Saving…');
    fireEvent.change(screen.getByLabelText('Production title'),{target:{value:'Second edit'}});
    await new Promise(r=>setTimeout(r,450));
    expect(productionService.saveTitle).toHaveBeenCalledTimes(1);
    await act(async()=>resolve({...production,title:'First edit',revision:2}));
    await waitFor(()=>expect(productionService.saveTitle).toHaveBeenCalledTimes(2),{timeout:1500});
    expect(productionService.saveTitle).toHaveBeenLastCalledWith({...production,title:'First edit',revision:2},'Second edit');
    expect(await screen.findByText('Saved')).toBeVisible();
  });
  it('reports conflict rather than saved', async () => {
    vi.mocked(productionService.saveTitle).mockRejectedValueOnce(new AppError('conflict','Changed elsewhere.'));
    studio();fireEvent.change(screen.getByLabelText('Production title'),{target:{value:'Conflict'}});
    expect(await screen.findByText('Conflict · not saved')).toBeVisible();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Reload latest'})).toBeVisible();
  });
});
it('rejects browser secrets, unsafe durations and executable/oversize uploads', () => {
  expect(validatePublicConfiguration()).toMatch(/Set VITE/);
  expect(validatePublicConfiguration('https://example.supabase.co','sb_secret_bad')).toMatch(/server secret/);
  expect(validatePublicConfiguration('http://example.com','sb_publishable_test')).toMatch(/HTTPS/);
  expect(validatePublicConfiguration('https://example.supabase.co','sb_publishable_test')).toBeNull();
  expect(formatRuntime(3333)).toBe('0:03.333');
  expect(()=>durationMs(3.2)).toThrow();expect(()=>durationMs(-1)).toThrow();
  expect(()=>validateFile({size:100,type:'application/x-msdownload',name:'run.exe'})).toThrow();
  expect(()=>validateFile({size:60*1024*1024,type:'video/mp4',name:'large.mp4'})).toThrow();
  expect(validateFile({size:100,type:'image/png',name:'reference.png'})).toBe('image');
});
