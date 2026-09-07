import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module';
import { StorageProvidersModule } from '../storage/providers/storage-providers.module';
import { DatabaseBackupRunnerService } from './db-backup-runner.service';

// =============================================================================
// DbBackupModule (issue #281, epic #254)
// =============================================================================
//
// The backup engine and nothing else. #280 shipped the pure utilities this
// wraps (`pg-dump.util.ts`, `pg-restore.util.ts`, `pg-version.util.ts`,
// `schedule.util.ts`) as free functions with no module of their own, because
// none of them needed injection; `DatabaseBackupRunnerService` is the first
// thing here that does — it needs Prisma, the system settings and the active
// storage provider.
//
// Registered in `app.module.ts` even though NOTHING TRIGGERS A BACKUP YET
// (#282 adds the scheduler and the retention/stale sweeps, #283 the admin
// API), for the same reason `JobsModule` was registered before anything
// enqueued: a broken provider graph then fails at boot, where it is one line
// in a startup log, rather than at 02:00 on the first night backups were
// switched on. It costs nothing at runtime — no timer is started and no query
// is issued until someone calls `startBackup`.
//
// -----------------------------------------------------------------------------
// WHAT IT IMPORTS, AND WHY EACH
// -----------------------------------------------------------------------------
//
// `SettingsModule` for `SystemSettingsService.getDatabaseBackupPolicy()` — the
// compression level, the stale window and the storage-provider name. The
// direction is acyclic: settings depends on nothing here. `JobsModule` and
// `NotificationsModule` import it for exactly the same kind of narrow read.
//
// ⚠ `StorageProvidersModule` AND NOT `StorageModule`, deliberately, and this
// is the same choice `JobsModule` and `NodesModule` already made. The provider
// module contributes ONE token (`STORAGE_PROVIDER`) and no controllers;
// `StorageModule` would pull `ObjectsController`, `ObjectsService` and the
// upload-processing pipeline into this graph, and would make the backup engine
// depend on the interactive storage API rather than on the ability to write
// bytes. It would also invite the genuinely wrong design underneath that
// dependency: recording each backup as a `storage_objects` row, which would
// give every archive a user-facing object an administrator could delete by
// hand, outside the retention policy that is supposed to own its lifetime.
//
// `PrismaService` is not imported: `PrismaModule` is `@Global()`.
//
// -----------------------------------------------------------------------------
// WHAT IS NOT PROVIDED, ON PURPOSE
// -----------------------------------------------------------------------------
//
// `DB_BACKUP_ENGINE` and `DB_BACKUP_TIMERS` are OPTIONAL tokens that this
// module deliberately leaves unbound, exactly as `JobsModule` leaves
// `JOB_CLOCK` and `JOB_RANDOM` unbound. The service falls back to the real
// `pg_dump` and the real timers when they resolve to nothing, so an
// application always runs on real binaries and real time, and only a test that
// constructs the service directly can substitute either. Providing them here
// would create a seam a fork could fill by accident — a stubbed dump engine in
// production is a backup subsystem that reports success and stores nothing.
//
// `DatabaseBackupRunnerService` IS exported: #282's scheduler and #283's admin
// controller both drive it, and both must go through THE SAME claim — the
// single-active-run index is only a guarantee if there is one writer of this
// table.
// =============================================================================

@Module({
  imports: [SettingsModule, StorageProvidersModule],
  providers: [DatabaseBackupRunnerService],
  exports: [DatabaseBackupRunnerService],
})
export class DbBackupModule {}
