// =============================================================================
// The app's own seed
// =============================================================================
//
// `seed.ts` runs `seedPlatform` (roles, permissions, default grants, the
// `global` system settings row, the initial administrator's allowlist entry)
// and then this function. This is the one place an app adds its own seed ROWS:
// a catalog table, a default record, a demo account. It is empty in the
// reference app, which has none.
//
// An app's own PERMISSIONS and SETTINGS do not belong here: register them in
// the permission and settings registries and regenerate the catalogs
// (`npm run catalog:permissions`, `npm run catalog:settings`), and
// `seedPlatform` writes them.
//
// Rules, the same as the platform's:
// - Idempotent. CI runs the seed twice and `appctl deploy update` re-runs it on
//   every upgrade, so every write is an `upsert` keyed on a natural unique,
//   never a `findFirst` followed by a `create`.
// - Never delete, and never overwrite a value an administrator may have edited
//   (`update: {}`).
// - Nest-free: this file runs under `ts-node --transpile-only` in an image that
//   carries `prisma/` but not `src/`. Import no `@nestjs/*` and nothing from
//   `src/`. `test/prisma/seed-imports.spec.ts` fails when the import graph
//   leaves that.

import type { PrismaClient } from '@prisma/client';

/**
 * Seed the app's own data, after the platform's.
 *
 * @param _prisma - The seed's Prisma client.
 */
export async function seedApp(_prisma: PrismaClient): Promise<void> {
  // Nothing to seed.
}
