import { defineConfig } from 'vitest/config';

// jsdom + Testing Library, as apps/web. No Vite React plugin: vitest's own
// transform compiles the automatic JSX runtime from tsconfig.json.
//
// Slice tests live under test/<slice>/ rather than next to the code: a test
// imports the slice AND the `testing` slice, and the boundary lint (which
// covers src/ only) lets a slice import only the slices
// packages/platform-slices.json lists for it.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: false,
  },
});
