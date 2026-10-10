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
    // canvases in one case. Under full-suite thread contention that legitimately runs past
    // the 5s default, so the budget is explicit here instead of flaking. Assertions are
    // unchanged; only the ceiling is.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
