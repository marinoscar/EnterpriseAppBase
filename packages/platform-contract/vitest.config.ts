import { defineConfig } from 'vitest/config';

// `environment: 'node'` is explicit: a jsdom global must never make code pass
// here that cannot run in a server or a terminal.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    globals: false,
  },
});
