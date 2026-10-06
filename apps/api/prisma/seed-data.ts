// =============================================================================
// Seed Data Definitions
// =============================================================================
//
// The declarative half of `seed.ts`, in a module of its own so it can be
// asserted by a test (#256, epic #254). `seed.ts` instantiates a PrismaClient
// and calls `main()` at import time — it is a script, not a module — so nothing
// in a Jest run can import it to check that the roles it seeds actually name
// permissions it declares, or that the system-settings blob it writes still
// matches the API's `DEFAULT_SYSTEM_SETTINGS`. Splitting the data out costs one
// import and buys `test/prisma/seed-data.spec.ts`.
//
// This file stays framework-free and dependency-free on purpose (Node built-ins
// only, to read the generated catalog below): it is compiled
// by `prisma/tsconfig.json` under ts-node when `npm run prisma:seed` runs, with
// no Nest build anywhere in sight.
//
// IDEMPOTENCE IS A PROPERTY OF `seed.ts`, NOT OF THIS FILE — every write there
// is an `upsert` keyed on a natural unique (`role.name`, `permission.name`,
// `rolePermission.roleId_permissionId`, `systemSettings.key`), so a second run
// updates the same rows instead of inserting duplicates. What this file
// contributes is that the data itself contains no duplicates to insert, which
// the spec checks.
//
// WHERE THE RBAC DATA COMES FROM (#676, PP-1.4). Roles, permissions and their
// default grants are no longer written here. Each is declared once, beside the
// module that enforces it (`src/<module>/<module>.permissions.ts`,
// `src/common/permissions/platform-roles.ts`, and the app-owned
// `src/app-registrations/permissions.ts`), and registered into the role and
// permission registries (`src/common/permissions`). The seed cannot import
// those: the production image that runs `npm run prisma:seed` carries `dist/`
// and `prisma/` but no `src/`. So `npm run catalog:permissions --workspace=api`
// writes the registries out to `prisma/catalog/permissions.json`, committed,
// and this file reads that. `test/prisma/permission-catalog.spec.ts` fails when
// the JSON is stale, and pins the seeded data to a literal baseline. To change
// a permission or a grant, edit its declaration file and regenerate; never edit
// the JSON by hand. The rationale for each split and each grant lives in the
// declaration file now, next to the entry.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface PermissionCatalogFile {
  roles: Array<{ name: string; description: string }>;
  permissions: Array<{ name: string; description: string }>;
  rolePermissions: Record<string, string[]>;
}

const catalog = JSON.parse(
  readFileSync(join(__dirname, 'catalog', 'permissions.json'), 'utf8'),
) as PermissionCatalogFile;

/** Every role, in registration order (platform roles, then the app's). */
export const ROLES: ReadonlyArray<{ readonly name: string; readonly description: string }> =
  catalog.roles;

/** Every permission, in registration order (platform permissions, then the app's). */
export const PERMISSIONS: ReadonlyArray<{ readonly name: string; readonly description: string }> =
  catalog.permissions;

// Role to permissions mapping
export const ROLE_PERMISSIONS: Record<string, string[]> = catalog.rolePermissions;

// Default system settings (#677)
//
// GENERATED, NOT WRITTEN HERE. Every system settings namespace declares its
// defaults once, beside its owning module (`src/<module>/*.system-settings.ts`),
// and `npm run catalog:settings --workspace=api` renders them into
// `catalog/system-settings-defaults.json`, committed next to this file. The seed
// cannot import them from `src/`: it runs under ts-node outside the Nest build,
// and the production image carries `prisma/` but not `src/`. The comments that
// explain each default live in those declaration files.
//
// `test/prisma/seed-data.spec.ts` still pins this value against the API's
// `DEFAULT_SYSTEM_SETTINGS`, and `test/settings/settings-catalog.spec.ts`
// fails with the regenerate command when the JSON is stale. A seeded row
// missing a modelled block is not fatal (`readKnownSettings` degrades it to the
// same defaults), but it does mean the first PATCH is what materialises it.
export type SeedJsonValue = string | number | boolean | null | SeedJsonValue[] | { [key: string]: SeedJsonValue };

export const DEFAULT_SYSTEM_SETTINGS: { [namespace: string]: SeedJsonValue } = JSON.parse(
  readFileSync(join(__dirname, 'catalog', 'system-settings-defaults.json'), 'utf8'),
);
