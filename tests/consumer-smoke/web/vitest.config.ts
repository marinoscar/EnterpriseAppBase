import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// No `server.deps.inline` for the platform package: the smoke loads it the
// way a consumer's Vitest does by default, as an external ESM dependency.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
  },
});
