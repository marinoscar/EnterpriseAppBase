// The db-backup slice's conformance suite (#740), run against the reference
// app: every dump and restore carries both halves of the row-level-security
// pair, the restore stays server-only, the backup stays node-eligible, the
// permissions are system scope and database-backups/ is a registered prefix.
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/db-backup/testing';

import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';
// The app's purge-order prefix list, database-backups included.
import '../../src/platform/storage/storage-key-prefix.manifest';

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: { dbBackup: {} },
});
