import { expect, test, type Page } from '@playwright/test';

// §157 full Series end-to-end: recurring Production on one Master Production per Episode.
// Generate Ahead previews first, requires confirmation, preserves occupied slots, records the
// requested depth instead of pretending content was written, and a held slot stays blocked.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const seriesId = '00000000-0000-4000-8000-000000000501';
const newSeriesId = '00000000-0000-4000-8000-000000000502';
const episodeId = '00000000-0000-4000-8000-000000000601';
const episodeProduction = '00000000-0000-4000-8000-000000000020';
const hostAsset = '00000000-0000-4000-8000-000000000801';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-series', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };

const production = { id: productionId, workspace_id: workspace, project_id: projectId, title: 'Money minute 3', production_type: 'recurring_content', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 45000, calculated_duration_ms: null, start_ms: 0, end_ms: null, created_by: uid, revision: 1, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };

const studioModel = {
  production: { id: productionId, workspace_id: workspace, title: production.title, production_type: 'recurring_content', custom_type: null, execution_method: 'real', planned_duration_ms: 45000, calculated_duration_ms: null, approval: 'draft', locked_at: null, revision: 1, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
  scenes: [], orphan_shots: [], assets: [], documents: {},
  timing: { total_ms: 0, target_ms: 45000, delta_ms: null, status: 'unresolved', scene_states: [] },
  runtime_conflict: false, timeline: [],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 0, shots: 0, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 1 }, needs_attention: 0 },
  truncated: false, provider,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 8 Series.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'recurring_content', execution_method: 'real', planned_duration_ms: 45000, approval: 'draft', locked_at: null, revision: 1 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 45000, assigned_ms: 0, dialogue_ms: 0, action_ms: 0, slack_ms: 45000, status: 'under' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

async function platform(page: Page, seriesRows: () => unknown[]) {
  await page.route('https://tonde-test.supabase.co/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: uid, email: 'creator@example.com' } });
    if (path === '/rest/v1/productions') {
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      if (request.method() === 'PATCH') return route.fulfill({ json: { ...production, ...request.postDataJSON(), revision: 2 } });
      return route.fulfill({ json: single ? production : [production] });
    }
    if (path === '/rest/v1/series') return route.fulfill({ json: seriesRows() });
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(({ uid }) => {
    const payload = btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-05T00:00:00Z' } }));
  }, { uid });
}

const seriesRow = (id: string, title: string) => ({ id, workspace_id: workspace, project_id: projectId, title, series_kind: 'recurring', timezone: 'Europe/London', lifecycle: 'active', revision: 2, cadence_metadata: { kind: 'daily' }, format: { planned_episodes: 10 }, summary: {}, bible_document_id: null, created_by: uid, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' });

test('Series Studio runs the production line, Generate Ahead and a scoped Series command (§157)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let rows = [seriesRow(seriesId, 'Daily Personal Finance')];
  await platform(page, () => rows);
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let created: Array<Record<string, unknown>> = [];
  const lineItem = (overrides: Record<string, unknown> = {}) => ({
    episode_id: episodeId, episode_number: 3, title: 'Money minute 3', planned_date: '2026-10-08',
    production_id: episodeProduction, production_title: 'Money minute 3', lifecycle: 'active', production_lifecycle: 'active',
    requested_depth: 'complete_plan', depth: 'idea', line_state: 'idea', approval: 'draft', locked: false,
    production_revision: 1, episode_revision: 1, collection_id: null, execution_summary: { real: 0, ai: 0, hybrid: 0 },
    timing: { production: { target_ms: 45000, calculated_ms: 0, status: 'under' }, counts: { scenes: 0, shots: 0 } },
    blockers: [{ code: 'requested_depth_missing', severity: 'blocking', message: 'The Story is not written yet.', action: 'Write or generate the Story for this Episode.' }],
    readiness: { blocking: 1, warnings: 0, state: 'BLOCKED' }, ...overrides,
  });
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });
    if (path.endsWith('/series') && request.method() === 'POST') {
      writes.push({ path, body });
      rows = [...rows, seriesRow(newSeriesId, String(body.title))];
      return route.fulfill({ json: envelope({ series_id: newSeriesId, title: body.title, revision: 1 }) });
    }
    if (path.endsWith(`/series/${seriesId}`)) return route.fulfill({ json: envelope({
      series_id: seriesId, title: 'Daily Personal Finance', series_kind: 'recurring', timezone: 'Europe/London',
      lifecycle: 'active', revision: 2, cadence_metadata: { kind: 'daily' }, format: { planned_episodes: 10 }, summary: null,
      collections: [], counts: { episodes_active: 7, episodes_archived: 0, collections: 0, planned_episodes: '10', next_episode_number: 8 },
      reuse: [{ asset_id: hostAsset, name: 'Host', asset_type: 'character', missing: false }], upcoming: [], last_generate_ahead: null,
      note: 'Recurring context is referenced, never copied: each Episode stays its own canonical Production.' }) });
    if (path.endsWith('/production-line')) return route.fulfill({ json: envelope({
      total: 1, limit: 30, offset: 0, truncated: false,
      items: [lineItem(), ...created.map(episode => lineItem({ episode_id: episode.episode_id, episode_number: episode.episode_number, title: episode.title, planned_date: episode.planned_date, depth: 'idea', readiness: { blocking: 1, warnings: 0, state: 'BLOCKED' } }))],
      note: 'States come from real domain state. No percentage is invented.' }) });
    if (path.endsWith('/slots')) return route.fulfill({ json: envelope({
      horizon: 'next_7', timezone: 'Europe/London', today: '2026-10-05', cadence_metadata: { kind: 'daily' },
      slots: [{ slot_key: '2026-10-06', planned_date: '2026-10-06', episode_number: 8, state: 'open', existing_episode_id: null }],
      counts: { open: 7, preserved: 0, held: 0, total: 7 }, note: 'Slot dates come from the Series timezone and cadence.' }) });
    if (path.endsWith('/jobs')) return route.fulfill({ json: envelope({ jobs: [{
      job_id: 'job-1', shared_job_id: 'shared-1', state: 'retrying', horizon: 'next_14', depth: 'briefs', timezone: 'Europe/London',
      created_count: 12, preserved_count: 7, blocked_count: 2, failed_count: 0, note: 'Some slots are held by the creator and were skipped.',
      items: [{ slot_key: '2026-10-08', planned_date: '2026-10-08', episode_number: 9, state: 'blocked', created_production_id: null, created_episode_id: null, error_message: 'This slot is held by the creator.' }] }] }) });
    if (path.endsWith('/generate-ahead/preview')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({
        horizon: 'next_7', depth: body.depth, depth_label: 'Ideas Only', timezone: 'Europe/London', today: '2026-10-05',
        slots: [{ slot_key: '2026-10-06', planned_date: '2026-10-06', episode_number: 8, state: 'open', existing_episode_id: null },
          { slot_key: '2026-10-08', planned_date: '2026-10-08', episode_number: 9, state: 'held', existing_episode_id: null, note: 'Held by the creator.' }],
        counts: { open: 6, preserved: 0, held: 1, total: 7 }, reuse: [], recent_titles: [], requires_confirmation: true,
        reuse_note: 'Series-level Assets are referenced through inheriting bindings.',
        depth_note: 'Generate Ahead records the requested depth and creates the Production shell.',
        do_not_overwrite: 'Existing Episodes at these slots are preserved and never overwritten.',
        recent_jobs: [], series_revision: 2, note: 'Preview only: nothing was created.' }) });
    }
    if (path.endsWith('/generate-ahead')) {
      writes.push({ path, body });
      created = [{ episode_id: '00000000-0000-4000-8000-000000000602', episode_number: 8, title: 'Money minute 8', planned_date: '2026-10-06' }];
      return route.fulfill({ json: envelope({
        job_id: 'job-2', shared_job_id: 'shared-2', state: 'succeeded', horizon: 'next_7', depth: body.depth, timezone: 'Europe/London',
        counts: { created: 6, preserved: 0, blocked: 1, failed: 0, planned: 7 },
        created_episodes: [{ episode_id: '00000000-0000-4000-8000-000000000602', episode_number: 8, production_id: episodeProduction, title: 'Money minute 8', planned_date: '2026-10-06', slot_key: '2026-10-06', topic_source: 'title_pattern' }],
        blocked_slots: [{ slot_key: '2026-10-08', state: 'held' }], preview: {}, note: 'Existing Episodes and approved work were preserved.' }) });
    }
    if (path.endsWith('/retry')) { writes.push({ path, body }); return route.fulfill({ json: envelope({ job_id: 'job-1', state: 'retrying', counts: { created: 1, preserved: 0, blocked: 1, failed: 0 } }) }); }
    if (path.endsWith('/director/scope')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({
        resolution: { horizon: 'next_7', avoid_recent_topics: true, ambiguous: false, note: 'Finite horizon.' },
        context: { series_id: seriesId, title: 'Daily Personal Finance', series_kind: 'recurring', timezone: 'Europe/London', cadence_metadata: { kind: 'daily' }, format_metadata_keys: ['title_pattern'], recent_titles: [{ episode_number: 3, title: 'Money minute 3', planned_date: '2026-10-08', line_state: 'idea' }], upcoming: [], avoid_list: ['Money minute 3'] },
        next_horizon_label: 'next_7', rule: 'Series context is bounded: titles, dates, states and the avoid list only. Nothing was created by resolving the command.' }) });
    }
    return route.fulfill({ json: envelope(null) });
  });

  await page.goto(`/studio/${productionId}?tool=Series`);

  // 1. Series are discovered for this Project, and the Production Line shows real state.
  await page.getByRole('button', { name: /Daily Personal Finance/ }).first().click();
  await expect(page.locator('table.series-line')).toBeVisible();
  await expect(page.getByText('BLOCKED').first()).toBeVisible();
  await expect(page.getByText(/The Story is not written yet\./)).toBeVisible();
  await expect(page.getByRole('link', { name: /3 · Money minute 3/ })).toHaveAttribute('href', `/studio/${episodeProduction}?tool=Movie Mode`);
  await expect(page.getByText(/referenced, never copied/).first()).toBeVisible();
  await expect(page.getByText('Host · character')).toBeVisible();

  // 2. Generate Ahead previews first, names the held slot and creates nothing.
  await page.getByLabel('Depth').selectOption('ideas_only');
  await page.getByRole('button', { name: /^Preview$/ }).click();
  await expect(page.getByText(/PREVIEW · Next 7 days · Ideas Only/)).toBeVisible();
  await expect(page.getByText(/6 open · 0 preserved · 1 held · 7 total/)).toBeVisible();
  await expect(page.getByText(/Preview only: nothing was created\./)).toBeVisible();
  await expect(page.getByText(/never overwritten/)).toBeVisible();
  expect(writes.some(write => write.path.endsWith('/generate-ahead'))).toBe(false);

  // 3. Confirmation creates Production shells, keeps the blocked slot and records the depth.
  await page.getByRole('button', { name: /Confirm and create 6 Episode shell/ }).click();
  await expect(page.getByText(/6 created · 0 preserved · 1 blocked · 0 failed/)).toBeVisible();
  const applied = writes.find(write => write.path.endsWith('/generate-ahead'));
  expect(applied?.body).toMatchObject({ horizon: 'next_7', depth: 'ideas_only', confirm: true, expected_series_revision: 2 });
  await expect(page.getByRole('link', { name: /open Production/ })).toHaveAttribute('href', `/studio/${episodeProduction}?tool=Movie Mode`);

  // 4. A blocked slot is retried through its durable job, not by regenerating everything.
  await page.getByText(/This slot is held by the creator\./).click();
  await page.getByRole('button', { name: /Retry blocked slots/ }).click();
  await expect.poll(() => writes.filter(write => write.path.endsWith('/retry')).length).toBe(1);

  // 5. A Series Director command resolves to a finite horizon and creates nothing.
  const writesBefore = writes.length;
  await page.getByRole('textbox', { name: 'Direction' }).fill("Plan next seven episodes but don't repeat this week's topics.");
  await page.getByRole('button', { name: /Resolve Series scope/ }).click();
  await expect(page.getByText(/Horizon Next 7 days\./)).toBeVisible();
  await expect(page.getByText(/Avoid list: Money minute 3\./)).toBeVisible();
  expect(writes.length).toBe(writesBefore + 1);

  // 6. Creating a Series maps the real timezone, cadence and format, and selects it.
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Weekly Deep Dive');
  await page.getByRole('textbox', { name: 'Timezone' }).fill('Europe/London');
  await page.getByLabel('Cadence').selectOption('weekly');
  await page.getByRole('button', { name: /Create Series/ }).click();
  await expect(page.getByRole('button', { name: /Weekly Deep Dive/ })).toBeVisible();
  expect(writes.find(write => write.path.endsWith('/series'))?.body).toMatchObject({ title: 'Weekly Deep Dive', timezone: 'Europe/London', cadence_metadata: { kind: 'weekly' } });

  expect(errors).toEqual([]);
});
