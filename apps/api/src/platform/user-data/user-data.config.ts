// =============================================================================
// The user-data slice, configured for this app (issue #743)
// =============================================================================
//
// `UserDataModule.forRoot()` of `@marinoscar/platform-api/user-data`: the
// per-user deletion (`/api/user-data/*`), the admin factory reset and
// organization offboarding. The registries are filled by the manifest first;
// the purge planner orders deletes from the composed Prisma schema
// (`prisma/schema/`, shipped in the api image), read once at bootstrap by the
// slice's `composedSchemaDatamodel`. The only port this app binds is the bypass
// client (`USER_DATA_DB`, ./user-data-db.adapter.ts): the deployment and
// tenancy modes come from the slice's default environment (#880).
// =============================================================================

import type { Type } from '@nestjs/common';
import { UserDataModule, composedSchemaDatamodel, findComposedSchemaPath, groupMembershipRemovalHook } from '@marinoscar/platform-api/user-data';

import './user-data.manifest';
import { UserDataHostModule } from './user-data-host.module';

/** The composed schema folder: `apps/api/prisma/schema`, found by walking up from this file. */
export function appSchemaPath(): string {
  return findComposedSchemaPath(__dirname);
}

export const userDataModule = UserDataModule.forRoot({
  imports: [UserDataHostModule],
  datamodel: composedSchemaDatamodel(__dirname),
  // The sharing slice's last-admin rule runs before a user row is deleted (#728).
  userRemovalHooks: [groupMembershipRemovalHook],
  // Backups are the factory reset's undo: their jobs survive it.
  factoryReset: { keepJobsReferencedBy: [{ model: 'DatabaseBackupRun', field: 'jobId' }] },
});

/** The configured module's controller classes, by class name (route metadata in tests). */
export const userDataControllers: Readonly<Record<string, Type<unknown>>> = Object.freeze(
  Object.fromEntries((userDataModule.controllers ?? []).map((controller) => [controller.name, controller])),
);
