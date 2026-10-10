import { expect, test } from '@playwright/test';

// Public marketing site: no authentication, no fixtures required.
// All pages render natively — no iframes remain.
test('public home loads the original hero natively with one nav and real auth links', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto('/');
  await expect(page).toHaveTitle('TONDE | Your AI Production Director');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', '/login');
  await expect(page.getByRole('link', { name: 'Start creating' }).first()).toHaveAttribute('href', '/signup');
  await expect(page.locator('.tnat-area1')).toBeVisible();
  await expect(page.getByText('Bring the vision.')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('home Director preview responds to samples without backend claims', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Music video' }).click();
  await expect(page.getByText(/Hybrid/i).first()).toBeVisible();
});

test('in-content route tabs navigate client-side between solution pages', async ({ page }) => {
  await page.goto('/solutions');
  await expect(page).toHaveTitle('TONDE | Solutions');
  await page.locator('#routein').getByRole('button', { name: 'Film and Video' }).click();
  await expect(page).toHaveURL(/\/solutions\/film-video$/);
  await expect(page).toHaveTitle('TONDE | Film and Video');
});

test('creation mode tabs keep working after cross-page navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/solutions');
  await page.goto('/');
  await page.getByText('Bring the vision.').first().waitFor();
  await page.goto('/create/real-production');
  await page.locator('#app').getByRole('button', { name: 'AI CREATION' }).click();
  await expect(page).toHaveURL(/\/create\/ai-creation$/);
  await expect(page).toHaveTitle('TONDE | AI Creation');
  expect(errors).toEqual([]);
});

test('technique tiles open the technique page', async ({ page }) => {
  await page.goto('/explore');
  await expect(page).toHaveTitle('TONDE | Discover');
  const tile = page.locator('.tnat-area3 [data-legacy-on-click*="selectedTechnique"]').first();
  await tile.click();
  await expect(page).toHaveURL(/\/explore\/techniques$/);
});

test('native capability page renders honest copy with per-route metadata', async ({ page }) => {
  await page.goto('/product/moment-intelligence');
  await expect(page).toHaveTitle('TONDE | Moment Intelligence');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find the moments that matter.');
  await expect(page.getByText(/must be verified in the deployed application/)).toBeVisible();
});

test('marketing discovery avoids the app Discover route and help avoids app Help', async ({ page }) => {
  await page.goto('/explore');
  await expect(page).toHaveTitle('TONDE | Discover');
  await page.goto('/resources/help');
  await expect(page).toHaveTitle('TONDE | Help Center');
});

test('signup and forgot-password reuse real authentication; app home stays protected', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.goto('/home');
  await expect(page).toHaveURL(/\/login$/);
});

test('mobile navigation toggles with correct focus attributes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/solutions/sports-live-action');
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeVisible();
});
