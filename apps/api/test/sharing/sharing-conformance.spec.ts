import { join } from 'node:path';

import { IS_PUBLIC_KEY } from '@marinoscar/platform-api/identity';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `sharing` suite with the harness.
import '@marinoscar/platform-api/sharing/testing';

import { AppModule } from '../../src/app.module';
import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';

// =============================================================================
// The sharing slice's conformance suite, run in the reference app (#732)
// =============================================================================
//
// The invariants of `@marinoscar/platform-api/sharing` (its README,
// "Conformance suite"), checked against THIS application:
//
//   - no file under src/ touches `grants`, `groups`, `group_members` or
//     `group_invites` directly (Prisma delegate or raw SQL);
//   - every model of the composed schema with an `owner_group_id` column is a
//     registered group-owned resource (this app has none yet);
//   - every route reachable from `AppModule` that serves links is behind
//     `LinkGrantGuard` and carries `@Public()` (today the slice's own
//     `GET /api/public/links/current`);
//   - the three raw-SQL partial unique indexes are in prisma/migrations;
//   - the registered resource type ids equal the snapshot below.
//
// An app that adopts the package copies these lines; what stays here is the
// app's data. The worked examples of every extension point, with a
// group-owned type and a guarded public route of their own, are under
// test/examples/sharing/ (and run this suite over themselves there).
// =============================================================================

const API_ROOT = join(__dirname, '..', '..');

/**
 * The app's shareable resource types. EMPTY: the template registers none (a
 * fork adds its own, e.g. `transcript`). A type id is permanent once grants of
 * it exist, so an id leaves this list only with a migration of its grants.
 */
const RESOURCE_TYPE_IDS: readonly string[] = [];

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    sharing: {
      schemaPath: join(API_ROOT, 'prisma', 'schema'),
      migrationsDir: join(API_ROOT, 'prisma', 'migrations'),
      rootModule: AppModule,
      isPublic: (target) => Reflect.getMetadata(IS_PUBLIC_KEY, target) === true,
      groupOwnedModels: {},
      resourceTypeIds: RESOURCE_TYPE_IDS,
      minRoutes: 150,
    },
  },
});
