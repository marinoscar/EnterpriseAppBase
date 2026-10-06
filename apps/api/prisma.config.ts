import { defineConfig } from '@prisma/config';

/**
 * Prisma configuration for v7+.
 *
 * The DATABASE_URL is constructed by scripts/prisma-env.js from individual
 * environment variables (POSTGRES_HOST, POSTGRES_PORT, etc.) and injected
 * before the Prisma CLI is invoked.
 *
 * For runtime use, apps/api/src/config/configuration.ts does the same.
 *
 * The schema is a FOLDER of generated files (`npm run db:compose` writes
 * prisma/schema/ from the platform fragments in @marinoscar/platform-db and
 * this app's own prisma/fragments/). Two lines matter and are easy to lose:
 *   - `schema` must name the folder; without it Prisma does not find one.
 *   - `migrations.path` must be explicit: with a schema folder the default
 *     moves to `<schema folder>/migrations`, and `migrate` would report
 *     "No migration found" on a database whose history is intact.
 * Both paths resolve relative to this file. docs/adr/0002 (D1).
 */
export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: process.env.DATABASE_URL as string,
  },
  migrations: {
    path: 'prisma/migrations',
    // --transpile-only: without it ts-node type-checks against the full generated
    // Prisma Client surface at runtime, which OOMs the 512M api container on deploy.
    seed: 'ts-node --project prisma/tsconfig.json --transpile-only prisma/seed.ts',
  },
});
