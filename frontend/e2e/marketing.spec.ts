import { expect, test } from '@playwright/test';

// Public marketing site: no authentication, no fixtures required.
test('public home loads with one nav, embeds the original design, and links real auth', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('TONDE | Your AI Production Director');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', '/login');
  await expect(page.getByRole('link', { name: 'Start creating' }).first()).toHaveAttribute('href', '/signup');
  const frame = page.frameLocator('#tonde-content');
  await expect(frame.locator('body')).toBeVisible();
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
