import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `exports` suite with the harness.
import '@marinoscar/platform-api/exports/testing';
import { Prisma } from '@prisma/client';

// The app's registries: the user-owned and ownership manifests the sources
// read, and the export registrations (platform sources and writers, the
// examples, the app's own).
import '../../src/prisma/ownership';
import '../../src/platform/exports/exports.config';
import { permissionRegistry } from '../../src/common/permissions';
import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';

// =============================================================================
// The exports slice's conformance suite, run in the reference app (#744)
// =============================================================================
//
// Checked against THIS application's registries and real datamodel: every
// source names a registered permission and offers a registered writer, the
// user-owned registry agrees with the datamodel, and the `secret-egress` case
// fills EVERY model with sentinel values and runs `user-data` and `org-data`
// through every writer they offer: no secret, hash, hint, ciphertext or
// binary column (and no column of an excluded credential model) reaches a
// byte of any output, zips decompressed. The real-database counterpart is
// `exports-secret-egress.db.spec.ts`.
// =============================================================================

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    exports: {
      datamodel: Prisma.dmmf.datamodel,
      permissions: permissionRegistry.list(),
    },
  },
});
