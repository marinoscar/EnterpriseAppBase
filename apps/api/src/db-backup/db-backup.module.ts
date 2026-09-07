import { Module } from '@nestjs/common';

import { MaintenanceModule } from '../common/maintenance/maintenance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageProvidersModule } from '../storage/providers/storage-providers.module';
import { DatabaseRestoreService } from './database-restore.service';
import { DatabaseBackupAdminService } from './db-backup-admin.service';
import { DatabaseBackupRetentionService } from './db-backup-retention.service';
import { DatabaseBackupRunnerService } from './db-backup-runner.service';
import { DatabaseBackupController } from './db-backup.controller';
import { DatabaseRestorePreflightService } from './restore-preflight.service';
import { DatabaseBackupScheduleTask } from './tasks/db-backup-schedule.task';

// =============================================================================
// DbBackupModule (issues #281, #282, #283 and #284, epic #254)
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
//
// -----------------------------------------------------------------------------
// #284 ADDS RESTORE PRE-FLIGHT, AND IT ADDS NO ROUTE
// -----------------------------------------------------------------------------
//
// `DatabaseRestorePreflightService` answers "can this archive be restored, and
// what will it cost?" without creating, dropping or renaming anything. It is a
// PROVIDER AND NOT EXPORTED, and it is NOT wired to a controller here: #286
// owns the restore endpoints, and a service reachable over HTTP before the
// route that authorizes it exists is a surface nobody has reviewed.
//
// It needs no new import. `SettingsModule` already supplies
// `SystemSettingsService` (it reads `restoreRollbackMode`), `PrismaModule` is
// `@Global()`, and every cluster call goes through a short-lived `pg.Client`
// that is deliberately OUTSIDE the Prisma pool — see
// `admin-connection.util.ts` for the two structural reasons. Notably it does
// NOT take `StorageProvidersModule`: pre-flight never touches the archive's
// bytes, because verifying them means downloading gigabytes and that belongs
// to #285's asynchronous run, not to an HTTP request.
//
// `RESTORE_PREFLIGHT_SEAM` and `RESTORE_ADMIN_CLIENT_FACTORY` are OPTIONAL
// tokens left unbound, for the identical reason `DB_BACKUP_ENGINE` and
// `DB_BACKUP_TIMERS` are: the application always probes a real cluster, and a
// stubbed cluster connection in production is a restore subsystem that reports
// a clean pre-flight against nothing at all.
//
// -----------------------------------------------------------------------------
// #285 ADDS THE RESTORE ITSELF, AND THE ONE NEW IMPORT IT NEEDS
// -----------------------------------------------------------------------------
//
// `DatabaseRestoreService` is the first thing in this repository that CREATES,
// DROPS AND RENAMES DATABASES. It is a PROVIDER AND NOT EXPORTED and it is bound
// to no controller, exactly as the pre-flight is: #286 owns the restore
// endpoints, and a service that can replace the production database must not be
// reachable over HTTP before the route that authorizes it has been reviewed.
//
// ⚠ `MaintenanceModule` IS THE ONE NEW IMPORT, and it is not optional. The swap
// renames the live database out from under this process, so for those seconds
// the PERSISTED maintenance flag — which lives inside that database — cannot be
// read. `MaintenanceModeService`'s IN-MEMORY override layer exists for this one
// caller and says so in its own header; without this import the swap would have
// no way to hold traffic back at the only moment it must.
//
// It is a plain import rather than a re-export: the module is NOT `@Global()`
// (unlike `PrismaModule`), it exports `MaintenanceModeService` explicitly, and
// the dependency direction stays acyclic — maintenance depends on settings and
// JWT, and on nothing here.
//
// `DATABASE_RESTORE_SEAM` joins the list of OPTIONAL tokens deliberately left
// unbound, and it is the most important member of that list: it carries
// `exitProcess`, and a bound stub in production would leave a process serving
// requests through a connection pool pointed at a database that has been
// renamed away.
//
// `DatabaseBackupScheduleTask` gains a third duty in the same ten-minute tick —
// dropping retained `<live>_old_<ts>` databases past their retention window — so
// it now injects the restore service. It is deliberately NOT a fourth `@Cron`,
// for the same reason retention is not a second one: a window measured in hours
// does not need a timer of its own, and a second unsynchronised deleter of
// databases is exactly the kind of thing this module has already decided once
// not to have.
// =============================================================================

// -----------------------------------------------------------------------------
// #288 ADDS `NotificationsModule`, AND THREE CALL SITES BEHIND IT
// -----------------------------------------------------------------------------
//
// Imported for `NotificationsService`'s permission-addressed entry points, used
// from three places in this module and nowhere else:
//
//   - `DatabaseBackupRunnerService.markFailed` — a run that reported an error.
//   - `DatabaseBackupScheduleTask.releaseStaleRuns` — a run whose executing
//     process went away. Both raise `db_backup.backup_failed`, differing only
//     in the payload's `outcome`, because an operator chases the two in
//     completely different places.
//   - `DatabaseRestoreService.swap` — `db_backup.restore_completed`, and the
//     ONE case in this repository that must use the AWAITED
//     `notifyPermissionHoldersNow`: the swap ends in `process.exit(0)`, which
//     would drop a detached dispatch outright. That call site carries the full
//     argument; do not "tidy" it into the detached form.
//
// The direction is acyclic, like every other import here: `NotificationsModule`
// reaches `PrismaModule`, `EmailModule` and `SettingsModule`, and none of those
// reaches back into backups.
//
// ⚠ THE RECIPIENTS ARE `db_backup:read` HOLDERS, resolved from the database —
// which for the restore notification means the RESTORED database, because the
// dispatch happens after the swap. That is deliberate and is argued at the call
// site: the post-restore answer to "who can act on this?" is the correct one.
// =============================================================================

@Module({
  imports: [
    SettingsModule,
    StorageProvidersModule,
    MaintenanceModule,
    NotificationsModule,
  ],
  controllers: [DatabaseBackupController],
  providers: [
    DatabaseBackupRunnerService,
    DatabaseBackupRetentionService,
    DatabaseBackupAdminService,
    DatabaseBackupScheduleTask,
    DatabaseRestorePreflightService,
    DatabaseRestoreService,
  ],
  exports: [DatabaseBackupRunnerService, DatabaseBackupRetentionService],
})
export class DbBackupModule {}
