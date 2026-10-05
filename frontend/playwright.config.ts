import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
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
