// The platform's invariants, run against THIS app (`runPlatformConformance`).
// The package owns each scan; the app supplies only its own data. A suite
// that ships with a slice registers when its testing entry is imported.
import '@marinoscar/platform-api/identity/testing';

import { join } from 'node:path';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { AppModule } from '../src/app.module';
import { APP_USER_OWNED_MODELS } from '../src/notes/notes.ownership';
import { PERMISSIONS, ROLES, defaultGrants } from '../src/platform/permissions';

const SOURCE_ROOT = join(__dirname, '..', 'src');

runPlatformConformance({
  sourceRoots: [SOURCE_ROOT],
  suites: {
    // Every @Cron only enqueues (CLAUDE.md queue rule 1). No exemption.
    cronEnqueueOnly: { exempt: [], minCronFiles: 1 },
    // Every foreign key to User in the APP's fragments has a registry entry
    // whose purge matches onDelete. The platform's own models are checked by
    // the platform's conformance run, so the schema here is prisma/fragments.
    userOwnedData: {
      schemaPath: join(__dirname, '..', 'prisma', 'fragments'),
      policies: APP_USER_OWNED_MODELS,
      rawSqlAllowlist: [],
      registerIn: 'src/notes/notes.ownership.ts (or your module\'s own *.ownership.ts)',
    },
    // Every route reachable from AppModule declares @Auth() or @Public(), and
    // every permission it names is one the seed writes.
    identity: {
      rootModule: AppModule,
      permissions: PERMISSIONS,
      roles: ROLES,
      grants: Object.entries(defaultGrants()).flatMap(([role, permissions]) => permissions.map((permission) => ({ role, permission }))),
      minRoutes: 4,
    },
  },
});
