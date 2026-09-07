import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module';
import { StorageProvidersModule } from '../storage/providers/storage-providers.module';
import { DatabaseBackupAdminService } from './db-backup-admin.service';
import { DatabaseBackupRetentionService } from './db-backup-retention.service';
import { DatabaseBackupRunnerService } from './db-backup-runner.service';
import { DatabaseBackupController } from './db-backup.controller';
import { DatabaseBackupScheduleTask } from './tasks/db-backup-schedule.task';

// =============================================================================
// DbBackupModule (issues #281, #282 and #283, epic #254)
// =============================================================================
//
// The backup engine and nothing else. #280 shipped the pure utilities this
// wraps (`pg-dump.util.ts`, `pg-restore.util.ts`, `pg-version.util.ts`,
// `schedule.util.ts`) as free functions with no module of their own, because
// none of them needed injection; `DatabaseBackupRunnerService` is the first
// thing here that does — it needs Prisma, the system settings and the active
// storage provider.
//
// Registered in `app.module.ts` for the same reason `JobsModule` was
// registered before anything enqueued: a broken provider graph fails at boot,
// where it is one line in a startup log, rather than at 02:00 on the first
// night backups were switched on.
//
// #282 added the caller the engine was missing. `DatabaseBackupScheduleTask`
// is a `@Cron` provider — `ScheduleModule.forRoot()` in `app.module.ts` is
// what makes it fire, exactly as it does for `JobStuckResetTask` in
// `JobsModule` and `NodeStaleOfflineTask` in `NodesModule` — so from here on
// this module DOES start a timer at boot. It still issues no query until a
// tick runs, and the tick is gated by `DB_BACKUP_SCHEDULE_ENABLED`.
//
// `DatabaseBackupRetentionService` is a plain provider, and it is deliberately
// NOT a second `@Cron`. Pruning happens only after a backup has been taken and
// verified (see the runner's success path), so a timer of its own would be a
// second, unsynchronised deleter of archives with no new backup to justify
// what it removes.
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
// table. `DatabaseBackupRetentionService` is exported for the same reason in
// the other direction: #283's admin surface needs to be able to report and
// re-run retention, and a second implementation of "which archives may be
// deleted" is the kind of duplicate that ends with two rules disagreeing about
// a `pre_restore` dump.
//
// `DatabaseBackupScheduleTask` is a provider and NOT exported: nothing outside
// this module should be reaching into a cron handler, and the two operations
// it owns are already reachable through the services it composes.
//
// -----------------------------------------------------------------------------
// #283 ADDS THE ADMIN SURFACE, AND IT IS A THIRD SERVICE RATHER THAN A FOURTH
// METHOD ON THE RUNNER
// -----------------------------------------------------------------------------
//
// `DatabaseBackupController` binds to `DatabaseBackupAdminService`, which reads
// the run table, projects the schedule, writes the policy through
// `SystemSettingsService` and DELEGATES the two dangerous operations — claiming
// a run and cancelling one — to the runner. Splitting it out follows the
// precedent `JobAdminService` set beside `JobsService`: what is split is the
// WORK, not the surface. The runner exists to spawn a child process and stream
// its output into a bucket under a set of guarantees its header spends 150
// lines stating; an admin service exists to page through rows and turn typed
// failures into status codes. Folding the second into the first would put HTTP
// concerns inside the file that must stay legible as a streaming contract, and
// would give a cron-driven engine a reason to import `@nestjs/common`'s
// exceptions.
//
// The admin service is a PROVIDER AND NOT EXPORTED: it is the controller's,
// and anything else that needs to start a backup must go through the runner,
// which is the one writer of this table.
//
// `DatabaseBackupAdminService` injects `STORAGE_PROVIDER` directly, exactly as
// the runner and the retention sweep do, so the `StorageProvidersModule` import
// above now serves three consumers rather than two.
// =============================================================================

@Module({
  imports: [SettingsModule, StorageProvidersModule],
  controllers: [DatabaseBackupController],
  providers: [
    DatabaseBackupRunnerService,
    DatabaseBackupRetentionService,
    DatabaseBackupAdminService,
    DatabaseBackupScheduleTask,
  ],
  exports: [DatabaseBackupRunnerService, DatabaseBackupRetentionService],
})
export class DbBackupModule {}
