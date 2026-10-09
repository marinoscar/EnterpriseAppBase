// =============================================================================
// The user-data slice, configured for this app (issue #880)
// =============================================================================
//
// `UserDataModule.forRoot()` of `@marinoscar/platform-api/user-data`: the
// per-user deletion (`/api/user-data/*`), the admin factory reset and
// organization offboarding, with their Danger Zone pages on the web side. The
// manifest (./user-data.manifest.ts) is the app's whole contribution; the
// purge planner orders deletes from the composed Prisma schema folder
// (`prisma/schema/`, shipped in the api image), found by the slice itself. The
// deployment and tenancy modes come from the host core and identity. The one
// port bound here is the bypass client (./user-data-host.module.ts).
//
// ⚠ With the sharing slice enabled, add its last-admin rule before a user row
// is deleted: `userRemovalHooks: [groupMembershipRemovalHook]`. With the
// database backup slice, keep its jobs: `factoryReset: { keepJobsReferencedBy:
// [{ model: 'DatabaseBackupRun', field: 'jobId' }] }`.
// =============================================================================

import { UserDataModule, composedSchemaDatamodel } from '@marinoscar/platform-api/user-data';

import './user-data.manifest';
import { UserDataHostModule } from './user-data-host.module';

export const userDataModule = UserDataModule.forRoot({
  imports: [UserDataHostModule],
  datamodel: composedSchemaDatamodel(__dirname),
});
