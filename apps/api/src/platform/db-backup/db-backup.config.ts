// =============================================================================
// The reference app's db-backup slice, configured once (issue #740)
// =============================================================================
//
// `DbBackupModule` is the CONFIGURED dynamic module of
// `@marinoscar/platform-api/db-backup`, built once at import time. The
// deployment mode, the scheduler switch (`DB_BACKUP_SCHEDULE_ENABLED`) and the
// backup policy stay the deployment's and the administrator's: no option is
// passed that they already decide. The app passes its name (the archive key's
// slug), its version resolver (`app_version` on every run) and its host ports.
//
// A fork whose own table must survive a restore passes `extraCarryOver` here
// (or calls `registerRestoreCarryOver` from its own file before bootstrap);
// `examples/db-backup/release-artifacts.carry-over.ts` is the worked example.
// The reference app has no such table, so it registers none.
// =============================================================================

import '../storage/storage-key-prefix.manifest';

import { APP_NAME } from '@app/shared';
import { DbBackupModule as PlatformDbBackupModule } from '@marinoscar/platform-api/db-backup';

import { resolveApiVersion } from '../../openapi/version';
import { DbBackupHostModule } from './db-backup-host.module';

/** Backups, restores, their four job types, the admin routes and three Doctor checks. */
export const DbBackupModule = PlatformDbBackupModule.forRoot({
  appName: APP_NAME,
  appVersion: resolveApiVersion,
  imports: [DbBackupHostModule],
});
