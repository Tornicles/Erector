import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    // Worker threads instead of child-process forks: same file-level isolation,
    // much cheaper startup on Windows (dominates suite wall time).
    pool: 'threads',
    // The Studio integration tests mount a whole Production read model and walk several
    // canvases in one case. Under full-suite thread contention — and on the slower
    // shared GitHub Actions runners — individual cases legitimately run 15-25s, so the
    // 15s ceiling flaked there (all failures were timeouts, never assertion failures).
    // Assertions are unchanged; only the ceiling is.
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
