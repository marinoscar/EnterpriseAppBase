// =============================================================================
// Tripwire: every User foreign key is registered, policies match onDelete,
// and raw SQL stays in allowlisted files (issue #688; run through the
// platform conformance harness since #699)
// =============================================================================
//
// The scans are the `userOwnedData` suite of `@marinoscar/platform-api/testing`;
// this app keeps its DATA:
//
//   - its registrations: the platform inventory
//     (src/prisma/ownership/platform-user-owned-models.ts) and its own
//     (src/app-registrations/user-owned-models.ts), read back from the filled
//     registry;
//   - its schema: the composed prisma/schema/ folder;
//   - its raw-SQL allowlist (./raw-sql-allowlist.ts), entries verbatim.
//
// The suite fails when a model gains a relation to `User` without a registry
// entry; when an entry names a model, field or exportOmit column that does not
// exist, or a field that is not a foreign key to `User`; when a purge policy
// contradicts the relation's `onDelete` ('delete' ⇔ Cascade, 'detach' ⇔
// SetNull, 'retain' ⇔ Restrict/NoAction); and when a non-spec file under
// src/ issues raw SQL without an allowlist entry, or an entry went stale.
//
// Mocked tier: no database. The schema is read from the .prisma files, not the
// generated client (whose datamodel has no foreign keys or onDelete).
// =============================================================================

import { join } from 'node:path';

import { userOwnedModelRegistry } from '@marinoscar/platform-api/core';
import { readSchemaDatamodel, runPlatformConformance } from '@marinoscar/platform-api/testing';

// Fills the registry: the platform inventory, then the app's own entries.
import '../../src/prisma/ownership';
import { RAW_SQL_ALLOWLIST } from './raw-sql-allowlist';

const SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema');

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: {
    userOwnedData: {
      schemaPath: SCHEMA_PATH,
      policies: userOwnedModelRegistry.list(),
      rawSqlAllowlist: RAW_SQL_ALLOWLIST,
      registerIn:
        'apps/api/src/prisma/ownership/platform-user-owned-models.ts (platform) or apps/api/src/app-registrations/user-owned-models.ts (app)',
    },
  },
});

// The app's own pin, on top of the suite: the inventory's size, so a model
// added or removed is a visible diff here as well.
describe('user-owned model registry vs prisma/schema/', () => {
  it('covers 26 models and 29 User foreign keys', () => {
    const datamodel = readSchemaDatamodel(SCHEMA_PATH);
    const withUserKeys = datamodel.filter((model) =>
      model.fields.some((field) => field.type === 'User' && (field.relation?.fields.length ?? 0) > 0),
    );
    expect(withUserKeys).toHaveLength(26);
    expect(new Set(userOwnedModelRegistry.list().map((def) => def.model))).toEqual(new Set(withUserKeys.map((model) => model.name)));
  });
});
