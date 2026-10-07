// =============================================================================
// Seed data: the registries' snapshot, and the input derived from it
// =============================================================================
//
// What the seed writes is no longer defined here. Every role, permission, grant
// and system settings default is declared once, beside the module that owns it
// (`src/<module>/<module>.permissions.ts`, `src/<module>/*.system-settings.ts`,
// the app-owned `src/app-registrations/`), registered into the permission and
// settings registries, and rendered into the committed catalogs under
// `prisma/catalog/` (`npm run catalog:permissions`, `npm run catalog:settings`).
// This file loads those catalogs and builds the platform seed input from them
// with `@marinoscar/platform-db/seed`, which also does the writing: see
// `seed.ts`. Seeds read generated catalogs, never `src/`, because the
// production image that runs `npm run prisma:seed` carries `prisma/` but not
// `src/`.
//
// It stays a module of its own, apart from `seed.ts`, so a Jest test can import
// it: `seed.ts` connects to a database and runs `main()` at import time.
// `test/prisma/seed-data.spec.ts` asserts the derived input.
//
// Framework-free on purpose: compiled by `prisma/tsconfig.json` under ts-node
// (`--transpile-only`), with no Nest build anywhere in sight. To add an app's
// own permission or setting, register it and regenerate the catalogs; to add an
// app's own seed ROWS, use `seed-app.ts`. Never edit the JSON by hand.

import { join } from 'node:path';

import { platformSeedInputFrom, readSeedSnapshot } from '@marinoscar/platform-db/seed';

/** The permission and settings registries as plain data (the two catalogs of `prisma/catalog/`). */
export const SEED_SNAPSHOT = readSeedSnapshot(join(__dirname, 'catalog'));

/**
 * The input `seed.ts` passes to `seedPlatform`, minus the initial administrator
 * (which comes from the process environment at run time).
 */
export const SEED_INPUT = platformSeedInputFrom(SEED_SNAPSHOT, {});

/** Every role, in registration order (platform roles, then the app's). */
export const ROLES = SEED_INPUT.roles;

/** Every permission, in registration order (platform permissions, then the app's). */
export const PERMISSIONS = SEED_INPUT.permissions;

/** Role to permissions mapping: the default grants the seed writes, one role at a time. */
export const ROLE_GRANTS = SEED_INPUT.roleGrants;

/**
 * What a user holding each role can do, by the PRE-SPLIT role names (issue
 * #723): the view the RBAC matrix suites test routes against. RBAC is split
 * into system and org roles, and every system administrator also holds the
 * `org_admin` role on their membership, so `admin` here is the union of the
 * `admin` and `org_admin` grants. Every other role is exactly its own grants
 * ({@link ROLE_GRANTS}). Use `ROLE_GRANTS` for what the seed writes.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  ...ROLE_GRANTS,
  admin: [...new Set([...(ROLE_GRANTS.admin ?? []), ...(ROLE_GRANTS.org_admin ?? [])])],
};

/** The value of the `global` system settings row, every namespace's defaults in registration order. */
export const DEFAULT_SYSTEM_SETTINGS = SEED_INPUT.systemSettingsDefaults;
