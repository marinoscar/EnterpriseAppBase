import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `identity` suite with the harness.
import '@marinoscar/platform-api/identity/testing';

import { AppModule } from '../../src/app.module';
import { permissionRegistry, roleRegistry } from '../../src/common/permissions';
import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';

// =============================================================================
// The identity slice's conformance suite, run in the reference app (#727)
// =============================================================================
//
// The invariants of `@marinoscar/platform-api/identity` (its README,
// "Conformance suite"), checked against THIS application: every route reachable
// from `AppModule` declares `@Auth(...)` or `@Public()` (there is no global JWT
// guard), names only registered permissions and system roles; no seeded grant
// crosses scopes; and the authentication guard confines `nod_` worker
// credentials to `/api/nodes` while resolving `pat_` tokens as personal access
// tokens everywhere.
//
// The db-tier check (every `org` table forces row-level security with a listed
// policy) runs in `test/tenancy/rls-coverage.db.spec.ts`, against a real database.
//
// An app that adopts the package copies these few lines; what stays here is the
// app's data: its root module and its permission registry.
// =============================================================================

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    identity: {
      rootModule: AppModule,
      permissions: permissionRegistry.list(),
      roles: roleRegistry.list(),
      grants: permissionRegistry
        .list()
        .flatMap((permission) => permission.defaultGrants.map((role) => ({ role, permission: permission.id }))),
      minRoutes: 150,
    },
  },
});
