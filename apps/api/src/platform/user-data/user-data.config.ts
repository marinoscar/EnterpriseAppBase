// =============================================================================
// The user-data slice, configured for this app (issue #743)
// =============================================================================
//
// `UserDataModule.forRoot()` of `@marinoscar/platform-api/user-data`: the
// per-user deletion (`/api/user-data/*`), the admin factory reset and
// organization offboarding. The registries are filled by the manifest first;
// the purge planner orders deletes from the composed Prisma schema
// (`prisma/schema/`, shipped in the api image), read once at bootstrap.
// =============================================================================

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Type } from '@nestjs/common';
import { readSchemaDatamodel } from '@marinoscar/platform-api/testing';
import { UserDataModule, groupMembershipRemovalHook } from '@marinoscar/platform-api/user-data';

import './user-data.manifest';
import { UserDataHostModule } from './user-data-host.module';

/**
 * The composed schema folder: `apps/api/prisma/schema`, found by walking up
 * from this file (its depth differs between `src/` under ts-jest and `dist/`).
 */
export function appSchemaPath(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'prisma', 'schema');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('user-data: cannot find prisma/schema above ' + __dirname);
}

export const userDataModule = UserDataModule.forRoot({
  imports: [UserDataHostModule],
  datamodel: () => readSchemaDatamodel(appSchemaPath()),
  // The sharing slice's last-admin rule runs before a user row is deleted (#728).
  userRemovalHooks: [groupMembershipRemovalHook],
  // Backups are the factory reset's undo: their jobs survive it.
  factoryReset: { keepJobsReferencedBy: [{ model: 'DatabaseBackupRun', field: 'jobId' }] },
});

/** The configured module's controller classes, by class name (route metadata in tests). */
export const userDataControllers: Readonly<Record<string, Type<unknown>>> = Object.freeze(
  Object.fromEntries((userDataModule.controllers ?? []).map((controller) => [controller.name, controller])),
);
