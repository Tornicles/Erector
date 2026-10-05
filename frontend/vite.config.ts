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
  },
});
