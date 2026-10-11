import { expect, test, type Page } from '@playwright/test';

const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const prodA = '00000000-0000-4000-8000-000000000003';
const prodB = '00000000-0000-4000-8000-000000000004';

const prodRecord = (id: string, title: string, approval: string) => ({
  id, workspace_id: workspace, project_id: uid, title, production_type: 'short_film',
  custom_type: null, execution_method: 'real', lifecycle: 'active', approval,
  locked_at: null, planned_duration_ms: 30000, calculated_duration_ms: null,
  start_ms: 0, end_ms: null, created_by: uid, revision: 1,
  created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
});

const envelope = (data: unknown) => ({
  success: true, data, errors: null,
  metadata: { request_id: 'e2e-home-live', timestamp: '2026-10-05T00:00:00Z', version: '1' },
});

const sceneWithResult = {
  id: '00000000-0000-4000-8000-000000000010', order: 3,
  shots: [{ id: '00000000-0000-4000-8000-000000000014', title: 'Empty Street', result_count: 2 }],
};

function studioSurface(productionId: string, approval: string, needsAttention: number, scenes: unknown[]) {
  return {
    production: {
      id: productionId, workspace_id: workspace, title: productionId === prodA ? 'Blocked Meridian' : 'Quiet Meadow',
      production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 30000,
      calculated_duration_ms: 0, approval, locked_at: null, revision: 1, lifecycle: 'active',
      updated_at: '2026-10-05T00:00:00Z',
    },
    scenes, orphan_shots: [], assets: [], documents: {},
    timing: { total_ms: 0, target_ms: 30000, delta_ms: -30000, status: 'under', scene_states: [] },
    runtime_conflict: false, timeline: [],
    status_summary: {
      production_approval: approval, production_locked: false, scenes: scenes.length,
      shots: 1, scenes_locked: 0, shots_locked: 0, approval_counts: {}, needs_attention: needsAttention,
    },
    truncated: false,
    provider: { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' },
    capabilities: { frame_extraction: false, frame_extraction_note: '', timeline_editing: true, shot_execution: false, ai_prompt_compilation: false, note: '' },
  };
}

// Transport fixtures for the living Home: two productions, per-production
// Studio surfaces and jobs. No remote calls occur; nothing here ships.
async function platformLive(page: Page, options: { productions: 'blocked' | 'result' | 'active' | 'empty'; jobs?: 'failed' | 'none' }) {
  const approvals = options.productions === 'blocked'
    ? { [prodA]: 'needs_review', [prodB]: 'draft' }
    : options.productions === 'result'
      ? { [prodA]: 'approved', [prodB]: 'draft' }
      : { [prodA]: 'draft', [prodB]: 'draft' };
  const records = options.productions === 'empty'
    ? []
    : options.productions === 'active'
      ? [prodRecord(prodA, 'Blocked Meridian', 'draft')]
      : [prodRecord(prodA, 'Blocked Meridian', approvals[prodA]), prodRecord(prodB, 'Quiet Meadow', approvals[prodB])];
  await page.route('https://tonde-test.supabase.co/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/rpc/bootstrap_workspace')) return route.fulfill({ json: workspace });
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: uid, email: 'creator@example.com' } });
    if (path === '/rest/v1/scenes') return route.fulfill({ json: [] });
    if (path === '/rest/v1/production_references') return route.fulfill({ json: [] });
    if (path === '/rest/v1/creative_documents') return route.fulfill({ json: [] });
    if (path === '/rest/v1/productions') {
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      const first = records[0] ?? null;
      return route.fulfill({ json: single ? first : records });
    }
    return route.fulfill({ status: 400, json: { message: `Unexpected fixture endpoint: ${path}` } });
  });
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/productions/${prodA}/studio`)) {
      const needs = options.productions === 'blocked' ? 2 : 0;
      return route.fulfill({ json: envelope(studioSurface(prodA, approvals[prodA] ?? 'draft', needs, [])) });
    }
    if (path.endsWith(`/productions/${prodB}/studio`)) {
      const scenes = options.productions === 'result' || options.productions === 'blocked' ? [sceneWithResult] : [];
      return route.fulfill({ json: envelope(studioSurface(prodB, approvals[prodB] ?? 'draft', 0, scenes)) });
    }
    if (path.endsWith('/jobs')) {
      const jobs = options.jobs === 'failed'
        ? [{ job_id: 'job-failed-1', job_type: 'export_package', job_type_display_name: 'Export package', status: 'failed', attempts: 2, max_attempts: 3, production_id: prodA, error_message: 'Export ended before the package was written.' }]
        : [];
      return route.fulfill({ json: envelope({ jobs, count: jobs.length, note: '' }) });
    }
    return route.fulfill({ json: envelope(null) });
  });
  await page.addInitScript(({ uid }) => {
    const payload = btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-05T00:00:00Z' } }));
  }, { uid });
}

test('urgent Home puts the real blocker in the TONDE Live foreground with an exact destination', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 860 });
  await platformLive(page, { productions: 'blocked' });
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Keep the production moving.' })).toBeVisible();
  const live = page.getByRole('complementary', { name: 'TONDE Live' });
  await expect(live).toBeVisible();
  const cards = live.getByRole('link');
  await expect(cards).toHaveCount(3);
  const foreground = cards.first();
  await expect(foreground).toHaveClass(/hl-focus/);
  await expect(foreground).toContainText('NEEDS YOU');
  // Priority visibly controls depth: the foreground object is larger and fully opaque.
  const focusBox = await foreground.boundingBox();
  const sideBox = await cards.nth(1).boundingBox();
  expect(focusBox?.width).toBeGreaterThan(sideBox?.width ?? 0);
  expect(await foreground.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  expect(await cards.nth(1).evaluate(el => getComputedStyle(el).opacity)).toBe('0.7');
  await expect(page.getByRole('link', { name: 'Resolve top priority →' })).toHaveAttribute('href', `/studio/${prodA}`);
  // The depth field must not overlap itself or escape its region: closest = most important, nothing obscured.
  const spaceBox = await live.locator('.hl-space').boundingBox();
  const cardBoxes = await Promise.all((await cards.all()).map(card => card.boundingBox()));
  for (const box of cardBoxes) {
    expect(box?.x).toBeGreaterThanOrEqual((spaceBox?.x ?? 0) - 1);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((spaceBox?.x ?? 0) + (spaceBox?.width ?? 0) + 1);
  }
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => {
    const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return (w * h) / Math.min(a.width * a.height, b.width * b.height);
  };
  for (let i = 0; i < cardBoxes.length; i++) for (let j = i + 1; j < cardBoxes.length; j++) {
    expect(overlap(cardBoxes[i]!, cardBoxes[j]!)).toBeLessThan(0.15);
  }
  await page.screenshot({ path: 'test-results/home-live/urgent-blocker.png' });
  await foreground.click();
  await expect(page).toHaveURL(new RegExp(`/studio/${prodA}(\\?[^/]*)?$`));
  expect(errors).toEqual([]);
});

test('a ready Result teleports to the exact Studio Result context', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 860 });
  await platformLive(page, { productions: 'result' });
  await page.goto('/home');
  const live = page.getByRole('complementary', { name: 'TONDE Live' });
  const result = live.getByRole('link').first();
  await expect(result).toContainText('RESULT READY');
  const sceneId = '00000000-0000-4000-8000-000000000010';
  const shotId = '00000000-0000-4000-8000-000000000014';
  await expect(result).toHaveAttribute('href', `/studio/${prodB}?tool=Results&scene=${sceneId}&shot=${shotId}`);
  await page.screenshot({ path: 'test-results/home-live/result-ready.png' });
  await result.click();
  await expect(page).toHaveURL(new RegExp(`/studio/${prodB}`));
  expect(errors).toEqual([]);
});

test('a failed job surfaces first and routes to job recovery, never as fake progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 860 });
  await platformLive(page, { productions: 'blocked', jobs: 'failed' });
  await page.goto('/home');
  const live = page.getByRole('complementary', { name: 'TONDE Live' });
  const foreground = live.getByRole('link').first();
  await expect(foreground).toContainText('JOB FAILED');
  await expect(foreground).toContainText('Export ended before the package was written.');
  await expect(foreground).not.toContainText('%');
  await page.screenshot({ path: 'test-results/home-live/failed-job.png' });
  await foreground.click();
  await expect(page).toHaveURL(/\/jobs$/);
  expect(errors).toEqual([]);
});

test('Continue carousel centers one production and resumes its exact context', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 860 });
  await platformLive(page, { productions: 'blocked' });
  await page.goto('/home');
  const carousel = page.getByRole('region', { name: 'Continue productions' });
  await expect(carousel).toBeVisible();
  await expect(carousel.getByRole('link', { name: 'Continue →' })).toHaveAttribute('href', `/studio/${prodA}`);
  // Centered-card language: the active production sits at the track center with neighbours peeking in.
  const trackBox = await carousel.boundingBox();
  const activeBox = await carousel.locator('.hl-production.active').boundingBox();
  const trackCenter = (trackBox?.x ?? 0) + (trackBox?.width ?? 0) / 2;
  const activeCenter = (activeBox?.x ?? 0) + (activeBox?.width ?? 0) / 2;
  expect(Math.abs(trackCenter - activeCenter)).toBeLessThan(140);
  await page.screenshot({ path: 'test-results/home-live/carousel.png' });
  await page.getByRole('button', { name: 'Next production' }).click();
  await expect(carousel.getByRole('link', { name: 'Continue →' })).toHaveAttribute('href', `/studio/${prodB}`);
  await carousel.getByRole('link', { name: 'Continue →' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/${prodB}(\\?[^/]*)?$`));
  expect(errors).toEqual([]);
});

test('active and new creator states stay honest with no invented work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 860 });
  await platformLive(page, { productions: 'active' });
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1, name: 'Pick up exactly where you stopped.' })).toBeVisible();
  const live = page.getByRole('complementary', { name: 'TONDE Live' });
  await expect(live.getByRole('link')).toHaveCount(1);
  await expect(live.getByRole('link').first()).toContainText('CONTINUE');
  await expect(page.getByRole('form', { name: 'Director intake' })).toBeVisible();
  await page.screenshot({ path: 'test-results/home-live/active.png' });
  expect(errors).toEqual([]);
});

test('new creators get the start state with an honest empty Live region', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 860 });
  await platformLive(page, { productions: 'empty' });
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Bring the idea. Leave with the production.' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Nothing needs your attention right now.');
  await expect(page.getByRole('button', { name: 'DIRECT THIS →' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/home-live/new-creator.png' });
  expect(errors).toEqual([]);
});

test('reduced motion keeps every Live object usable with static depth', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1512, height: 860 });
  await platformLive(page, { productions: 'blocked' });
  await page.goto('/home');
  const live = page.getByRole('complementary', { name: 'TONDE Live' });
  const cards = live.getByRole('link');
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) await expect(card).toBeVisible();
  expect(await cards.first().evaluate(el => getComputedStyle(el).transitionProperty)).toBe('none');
  await cards.first().click();
  await expect(page).toHaveURL(new RegExp(`/studio/${prodA}(\\?[^/]*)?$`));
  expect(errors).toEqual([]);
});

test('mobile Home converts Live into a foreground card with swipeable secondaries', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await platformLive(page, { productions: 'blocked' });
  await page.goto('/home');
  const live = page.getByRole('complementary', { name: 'TONDE Live' });
  const cards = live.getByRole('link');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toContainText('NEEDS YOU');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Every secondary is reachable with a horizontal swipe inside the Live region.
  await cards.nth(2).scrollIntoViewIfNeeded();
  await expect(cards.nth(2)).toBeVisible();
  await page.screenshot({ path: 'test-results/home-live/mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
