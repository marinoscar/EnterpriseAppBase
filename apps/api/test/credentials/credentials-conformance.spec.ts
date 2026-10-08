import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `credentials` suite with the harness.
import '@marinoscar/platform-api/credentials/testing';

import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';
// Importing the app's binding runs its credential purpose manifest, so the
// suite sees exactly what the application registers.
import '../../src/platform/credentials/credentials.config';

// =============================================================================
// The credentials slice's conformance suite, run in the reference app (PP-8.8)
// =============================================================================
//
// The invariants of the credentials slice (packages/platform-api/src/credentials/README.md,
// "Conformance suite"), checked against THIS application: every purpose it
// registers names a known owner, every user purpose falls back to a
// registered purpose of the right tier, and no credential response schema can
// carry a secret. What stays here is the app's data: its own owners.
// =============================================================================

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: { credentials: { appOwners: ['app'] } },
});
