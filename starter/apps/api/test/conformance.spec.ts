// The platform's invariants, run against THIS app (`runPlatformConformance`).
// The package owns each scan; the app supplies only its own data. A suite
// that ships with a slice registers when its testing entry is imported.
import '@marinoscar/platform-api/identity/testing';

import { join } from 'node:path';
import {
  buildPermissionCatalog,
  catalogGrants,
  permissionRegistry,
  roleRegistry,
  userOwnedModelRegistry,
} from '@marinoscar/platform-api/core';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

// Fills the registries: the platform's entries, then the app's.
import '../src/platform/registrations';
import { AppModule } from '../src/app.module';
import { PERMISSION_OPTIONS } from '../src/platform/permissions';

const SOURCE_ROOT = join(__dirname, '..', 'src');

runPlatformConformance({
  sourceRoots: [SOURCE_ROOT],
  suites: {
    // Every @Cron only enqueues (CLAUDE.md queue rule 1). No exemption.
    cronEnqueueOnly: { exempt: [], minCronFiles: 1 },
    // Every foreign key to User in the composed schema (the platform's models
    // and the app's fragments) has a registry entry whose purge matches
    // onDelete: the platform's inventory and the app's, as registered.
    userOwnedData: {
      schemaPath: join(__dirname, '..', 'prisma', 'schema'),
      policies: userOwnedModelRegistry.list(),
      rawSqlAllowlist: [],
      registerIn: 'src/notes/notes.ownership.ts (or your module\'s own *.ownership.ts)',
    },
    // Every route reachable from AppModule declares @Auth() or @Public(), and
    // every permission it names is one the seed writes.
    identity: {
      rootModule: AppModule,
      permissions: permissionRegistry.list(),
      roles: roleRegistry.list(),
      grants: catalogGrants(buildPermissionCatalog()),
      minRoutes: 4,
    },
  },
});

// What the seed writes (`prisma/seed.ts` composes the catalog from the same
// options) is exactly what the registries hold.
describe('the seeded permission catalog', () => {
  it('equals the registries the app registered', () => {
    expect(platformPermissionCatalog(PERMISSION_OPTIONS)).toEqual(buildPermissionCatalog());
  });
});
