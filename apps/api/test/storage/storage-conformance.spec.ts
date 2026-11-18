import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `storage` suite with the harness.
import '@marinoscar/platform-api/storage/testing';

import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';
// The app's key-prefix manifest, so the suite sees exactly what the
// application registers (the platform six and the app's own).
import '../../src/platform/storage/storage-key-prefix.manifest';

// =============================================================================
// The storage slice's conformance suite, run in the reference app (PP-8.3)
// =============================================================================
//
// The invariants of the storage slice (packages/platform-api/src/storage/
// README.md, "Conformance suite"), checked against THIS application: every
// registered object-key prefix is well-formed, disjoint and present, the
// org-scoped ones build `<prefix><orgId>/` keys, and no storage settings shape
// can carry the secret access key. What stays here is the app's data: the
// prefixes its own writers need (the ones it still declares for db-backup and
// AI, until those slices register their own).
// =============================================================================

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: { storage: { requiredPrefixIds: ['database-backups', 'ai-outputs'] } },
});
