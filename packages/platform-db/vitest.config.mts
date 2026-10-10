import { defineConfig } from 'vitest/config';

// `.mts`: this package is `"type": "commonjs"`, so a `.ts` config would be
// ESM syntax in a file Node loads as CommonJS (Vite warns about it).
//
// `environment: 'node'` is explicit: a jsdom global must never make code pass
// here that cannot run in a server or a terminal.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.spec.ts'],
    exclude: ['test/**/*.db.spec.ts', 'node_modules/**'],
    globals: false,
  },
});
