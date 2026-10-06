import { defineConfig } from 'vitest/config';

// jsdom + Testing Library, as apps/web. No Vite React plugin: vitest's own
// transform compiles the automatic JSX runtime from tsconfig.json.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
