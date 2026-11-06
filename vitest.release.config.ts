import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * The release-blocker suite (tests/release). It is kept apart from the default
 * config on purpose: these tests fail until each blocker is cleared, so they
 * run only through `npm run test:release`, which CI calls on the release pull
 * request into main. No coverage: they guard facts, not code paths.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/release/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
