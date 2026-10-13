import { defineConfig } from '@playwright/test';

// On CI the step log is not readable without repository access, so a failing run has to say
// what failed through an artifact: the HTML report carries the spec name, the assertion and
// the stack without needing repo admin to read the log. One CI retry turns a genuine red into
// a visibly flaky result; every attempt still appears in the report.
const onCi = process.env.CI === 'true' || process.env.CI === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: onCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  retries: onCi ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run start -- --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 60000,
    // A distinct privileged API origin: exactly how production shapes the browser/API split. Tests intercept it.
    env: { VITE_SUPABASE_URL: 'https://tonde-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only', VITE_API_URL: 'http://127.0.0.1:8001' },
  },
});
