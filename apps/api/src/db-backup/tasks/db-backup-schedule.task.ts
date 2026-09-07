import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DatabaseBackupStatus, DatabaseBackupTrigger } from '@prisma/client';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import type { BackupFailedEmailData } from '../../email';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemSettingsService } from '../../settings/system-settings/system-settings.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../storage/providers/storage-provider.interface';
import type { SystemDatabaseBackupValue } from '../../common/schemas/settings.schema';
import { DatabaseRestoreService } from '../database-restore.service';
import { DatabaseBackupRunnerService } from '../db-backup-runner.service';
import { DatabaseBackupAlreadyRunningError } from '../db-backup.errors';
import {
  backupScheduleToCron,
  InvalidTimezoneError,
  previousFireBoundary,
} from '../schedule.util';

// =============================================================================
// The backup scheduler and the staleness sweep (issue #282, epic #254)
// =============================================================================
//
// #281 shipped an engine with no caller. This is the caller. Every ten
// minutes it does exactly three things, in this order:
//
//   1. RELEASE STALE RUNS — a run whose heartbeat stopped is given up on and
//      marked `stale`, which frees the single-active-run slot.
//   2. FIRE A DUE BACKUP — if the schedule says one should have started and
//      none has, start one.
//   3. DROP EXPIRED RETAINED DATABASES (#285) — a `<live>_old_<ts>` database a
//      restore displaced, past `databaseBackup.oldDatabaseRetentionHours`.
//
// -----------------------------------------------------------------------------
// WHY THE THIRD DUTY IS HERE AND NOT ON A `@Cron` OF ITS OWN
// -----------------------------------------------------------------------------
//
// A retained database is a FULL SECOND COPY of the production database, kept so
// that rolling a restore back costs one rename instead of a multi-hour replay.
// Something has to drop it when the window closes, and the choice was between a
// timer of its own and a third duty in a tick that already exists.
//
// This tick, for three reasons. The window is measured in HOURS, so a
// ten-minute poll is already an order of magnitude finer than it needs to be. A
// second timer would be a second, unsynchronised thing dropping databases in
// this subsystem — the same argument `DbBackupModule` makes for why retention
// is not its own `@Cron`. And this handler already owns the pattern the sweep
// needs: one `now` for the whole tick, one policy read, one swallowing `catch`
// per duty so a failure in one does not cost the others.
//
// It goes LAST because it is the only duty that is pure housekeeping. Nothing
// waits on it, and a backup that is due must not be delayed behind a `DROP
// DATABASE` waiting on a session somebody left open.
//
// -----------------------------------------------------------------------------
// WHY THE SWEEP GOES FIRST
// -----------------------------------------------------------------------------
//
// The two are not independent: the sweep is what RELEASES the slot the fire
// needs. `database_backup_runs_active_uniq_idx` permits one active run, so a
// row abandoned by a container that vanished mid-dump holds the slot until
// something transitions it. If the fire ran first it would collide with that
// zombie, log "already running", and tonight's backup would wait for the NEXT
// tick — ten minutes of delay bought by nothing but statement order. Sweeping
// first means a zombie found at 02:00 is released at 02:00 and the backup
// starts in the same tick.
//
// The two calls are separately wrapped, so a failing sweep still lets the fire
// attempt happen (and vice versa). They are one tick, not one transaction.
//
// -----------------------------------------------------------------------------
// GATED ON `DB_BACKUP_SCHEDULE_ENABLED`, AND NEVER ON `JOBS_WORKER_MODE`
// -----------------------------------------------------------------------------
//
// The line that is not in this file matters as much as the ones that are:
// there is no `if (workerMode === 'off') return`. This is not a queue worker,
// and #351 did not make it one — what this tick does is DECIDE a backup is due
// and ENQUEUE it; a worker takes the dump. `JOBS_WORKER_MODE=off` says "this
// process executes no queued jobs"; it does not say "this deployment's
// database does not need backing up". A pure control plane in front of an
// external node fleet is still the only process with a database connection at
// all, so gating the schedule on its willingness to run jobs would mean that
// deployment silently never even QUEUES a backup. That is the same precedent
// `JOBS_REAPER_ENABLED` and `NODE_STALE_OFFLINE_ENABLED` already set: an
// always-on maintenance cron with a switch of its own.
//
// ⚠ THE HONEST CAVEAT SINCE #351: with `JOBS_WORKER_MODE=off` this tick queues
// backups that nothing will execute. `system` mode does execute them
// (`db.backup.run` is server-only by derivation, so that mode claims it); only
// `off` does not. Those unclaimed `pending` run rows would hold the single
// active backup slot forever, which is precisely the third arm the sweep below
// now carries.
//
// The switch DEFAULTS TO ON and only the literal `false` turns it off, for the
// reason every kill switch here fails open: a deployment whose backups
// silently stopped because of a typo in an env file looks exactly like a
// deployment that is being backed up.
//
// -----------------------------------------------------------------------------
// TEN MINUTES, AND WHY THAT IS NOT SLOPPY
// -----------------------------------------------------------------------------
//
// A backup scheduled for 02:00 starts somewhere in [02:00, 02:10). The
// alternative — `@Cron` on the operator's own expression — would need the
// timer re-registered every time an administrator edits the schedule, and a
// missed tick (a deploy at 01:59, a process restart, a paused container)
// would silently skip the night entirely with nothing left behind to notice
// it. A coarse poll plus the boundary check below RECOVERS a missed window
// instead of losing it, which is the property that matters for something that
// runs once a day. Ten minutes also matches the two sweeps this sits beside.
//
// -----------------------------------------------------------------------------
// THE ANTI-DOUBLE-FIRE RULE IS STATELESS, AND THAT IS THE WHOLE DESIGN
// -----------------------------------------------------------------------------
//
//     boundary = previousFireBoundary(expr, now, timezone)
//     latest   = the run with the greatest startedAt
//     fire only if latest.startedAt < boundary
//
// "Has a run already started since the moment this schedule last came due?"
// The answer is computed from the settings and the table, and from nothing
// else. That buys three properties at once:
//
//   - EXACTLY ONE RUN PER BOUNDARY. Six ticks fall inside a one-hour window
//     and five of them find a run whose `startedAt` is at or after the
//     boundary.
//   - A LATE TICK STILL FIRES. If the process was down from 01:55 to 02:40,
//     the 02:40 tick computes the same 02:00 boundary, sees no run since it,
//     and takes the backup 40 minutes late instead of not at all.
//   - RESTARTS ARE FREE. There is no in-memory "last fired" to lose and no
//     column to keep current, so a fresh process reaches the same verdict as
//     the one it replaced.
//
// REJECTED: a `lastRunAt` column (or a settings field) stamped after each
// fire. It is the obvious design and it is strictly worse in three ways. It
// DRIFTS — the value written is when the run actually started, so a fire ten
// minutes late moves the next comparison ten minutes later, and a "daily"
// backup walks forward through the day. It NEEDS A WRITE OF ITS OWN, which
// can fail after the backup started, producing a second fire on the next
// tick — two `pg_dump`s for one night, arbitrated only by the active index.
// And it CANNOT BE RECOMPUTED: if it is ever wrong (a restored settings blob,
// a hand-edited row, a clock jump) nothing can repair it, whereas a boundary
// is derived fresh from the schedule every ten minutes.
//
// REJECTED: "did we fire in the last N minutes". It answers a question nobody
// asked. Two ticks in one window both see "no run in the last 10 minutes"
// after a run that started 11 minutes ago, and a weekly schedule would need N
// to be a week — at which point a manual backup on Tuesday suppresses
// Sunday's scheduled one.
//
// ⚠ `startedAt` IS COMPARED, AND EVERY TRIGGER COUNTS. A `manual` backup taken
// at 02:05 satisfies the 02:00 boundary and the scheduler stands down. That is
// deliberate: the schedule's promise is "a backup exists for this window", not
// "a backup with the `scheduled` label exists", and taking a second full dump
// of the same database five minutes after an administrator took one is pure
// I/O for no additional safety.
//
// -----------------------------------------------------------------------------
// THE TIMEZONE IS PASSED EXPLICITLY, AND A BAD ONE STANDS THE SCHEDULER DOWN
// -----------------------------------------------------------------------------
//
// `previousFireBoundary(expr, now, policy.timezone)` — never a two-argument
// call. Omitting the zone would evaluate "02:00" in the SERVER's zone, which
// in a container is UTC, which is not what an operator in Denver typed. The
// symptom would be a backup running at the wrong hour with nothing anywhere
// reporting a problem.
//
// A zone this runtime does not know throws `InvalidTimezoneError` (#280 made
// it a throw rather than a `null` precisely so this file can tell it from
// "nothing due"). The response is to STAND DOWN, not to guess: firing in UTC
// instead would put a nightly dump in the middle of the working day, and
// because the boundary would then be wrong the "already fired" check would be
// wrong with it.
//
// ⚠ IT LOGS ONCE. Standing down happens on EVERY tick — 144 a day — and the
// error is evaluated before the due check, so an unlatched log would bury its
// own diagnosis under 144 identical copies daily until someone fixed a setting
// they could no longer find the message about. The latch is KEYED ON THE ZONE,
// so correcting the setting (or breaking it differently) logs again, and a
// zone that starts working clears the latch so a later regression is loud.
// =============================================================================

/** What one `fireDueBackup` decided. Exposed so a test can assert the verdict directly. */
export type BackupFireOutcome =
  /** A run was claimed and is streaming. */
  | 'fired'
  /** `databaseBackup.enabled` is false. */
  | 'disabled'
  /** Nothing is due, or a run already covers this boundary. */
  | 'not_due'
  /** Something already holds the active slot — the guard did its job. */
  | 'already_running'
  /** `databaseBackup.timezone` is not a zone this runtime knows. */
  | 'bad_timezone';

/** Anything thrown, as an `Error`. JavaScript lets you throw a string. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

@Injectable()
export class DatabaseBackupScheduleTask {
  private readonly logger = new Logger(DatabaseBackupScheduleTask.name);

  /**
   * The in-process overlap guard.
   *
   * Not a lock and not pretending to be one — cross-replica exclusion is the
   * partial unique index's job, and the sweep's `updateMany` re-asserts its
   * own predicate so two replicas racing produce one winner and one no-op.
   * This exists for the single-process case the sweep cannot absorb: a tick
   * that is still waiting on a slow database when the next one fires would
   * otherwise run the boundary check twice against the same unchanged table.
   */
  private ticking = false;

  /**
   * The timezone whose failure has already been reported, or `null`.
   *
   * KEYED ON THE VALUE, not a boolean: a boolean would mean an operator who
   * fixed one typo and made another never hears about the second. Cleared the
   * moment a boundary computes successfully, so a zone that breaks again later
   * — a runtime downgrade, an ICU build without full data — is loud again.
   */
  private reportedBadTimezone: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly runner: DatabaseBackupRunnerService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly config: ConfigService,
    // #285's retained-database sweep. Injected rather than reimplemented here:
    // the restore service owns the admin connection, the identifier rules and
    // the seam, and a second place that issues `DROP DATABASE` is a second place
    // to get the guard wrong.
    private readonly restore: DatabaseRestoreService,
    // #288 (epic #254). `db_backup.backup_failed` is raised from BOTH give-up
    // paths — the runner's own `markFailed` and this sweep — because they are
    // genuinely different events: one is a run that reported an error, the
    // other is a run whose executing process went away and was never heard from
    // again. The `outcome` field on the payload is what tells them apart.
    private readonly notifications: NotificationsService
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron(): Promise<void> {
    if (!this.enabled()) {
      this.logger.debug(
        'The database backup scheduler is disabled (DB_BACKUP_SCHEDULE_ENABLED); skipping'
      );

      return;
    }

    if (this.ticking) {
      this.logger.warn(
        'The previous database backup tick has not finished; skipping this one rather ' +
          'than running two boundary checks against the same table'
      );

      return;
    }

    this.ticking = true;

    try {
      const policy = await this.settings.getDatabaseBackupPolicy();

      // ONE `now` for the whole tick, so the stale cutoff and the schedule
      // boundary are judged against the same instant — and so a test can pin
      // it without touching the wall clock.
      const now = new Date();

      // SWEEP FIRST — see the header. Wrapped on its own so a failed sweep
      // does not also cost tonight's backup: the two are separate duties that
      // happen to share a tick.
      try {
        const released = await this.releaseStaleRuns(policy, now);

        if (released > 0) {
          this.logger.warn(
            `Database backup sweep: ${released} run(s) stopped heartbeating and were ` +
              'marked stale; the active slot is free again'
          );
        }
      } catch (error) {
        this.logger.error(
          `The database backup stale sweep failed: ${toError(error).message}`
        );
      }

      await this.fireDueBackup(policy, now);

      // LAST, and wrapped on its own like the sweep above it. Pure
      // housekeeping: nothing waits on it, and a `DROP DATABASE` blocked by a
      // session somebody left open must not be able to cost tonight's backup.
      try {
        const dropped = await this.restore.dropExpiredOldDatabases(policy, now);

        if (dropped > 0) {
          this.logger.warn(
            `Dropped ${dropped} database(s) displaced by a restore and past ` +
              `${policy.oldDatabaseRetentionHours}h; rolling those restores back now means ` +
              'restoring an archive rather than renaming a database'
          );
        }
      } catch (error) {
        this.logger.error(
          `The retained-database sweep failed: ${toError(error).message}`
        );
      }
    } catch (error) {
      // SWALLOWED, like every other scheduled task here. A throw out of a
      // `@Cron` handler is an unhandled rejection, and an unhandled rejection
      // terminates the process by default: a database blip must not be able to
      // take the API down, and it must not stop the scheduler permanently
      // either — the next tick would have run anyway.
      this.logger.error(
        `The database backup scheduler tick failed: ${toError(error).message}`
      );
    } finally {
      // ALWAYS. A guard left set by a throw would stop the scheduler forever,
      // which is the one failure this whole file exists to not have.
      this.ticking = false;
    }
  }

  /**
   * Gives up on runs whose heartbeat stopped, freeing the active slot.
   *
   * ⚠ `stale` IS TERMINAL AND NOTHING RE-QUEUES IT. Automatically restarting a
   * multi-gigabyte dump that just OOM-killed its own process is not obviously
   * right — it burns hours of I/O on a database that is probably already
   * unwell, and it does it unattended, repeatedly, at whatever hour the first
   * attempt died. The retry for a backup is the next scheduled run, which is
   * the same answer the handler's `maxAttempts: 1` profile gives (#351).
   *
   * `stale` is also distinct from `failed` on purpose: nothing OBSERVED these
   * runs fail. The process holding them disappeared, and an operator reading
   * the list needs to be able to tell "the dump errored" from "the container
   * went away mid-dump".
   *
   * Exposed as its own method so a test can drive it without going through the
   * kill switch and the swallowing `catch`.
   *
   * @returns how many rows this call actually transitioned.
   */
  async releaseStaleRuns(policy: SystemDatabaseBackupValue, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - policy.runStaleMinutes * 60_000);

    const candidates = await this.prisma.databaseBackupRun.findMany({
      where: {
        // ⚠ THREE ARMS, AND THE THIRD IS NEW IN #351. The predicate used to
        // read `status: 'running'` with a note that "a future path that DOES
        // insert a `pending` row must extend this predicate with it, or that
        // row holds the active slot with no heartbeat that could ever age it
        // out". `queueBackup` is that path — a queued backup's run row is
        // written `pending` and stays that way until a worker claims its job —
        // so the arm is now here.
        OR: [
          // The ordinary case: it was beating and stopped.
          { status: 'running', lastHeartbeatAt: { lt: cutoff } },
          // THE ZOMBIE THAT NEVER BEAT — a process that died between the claim
          // and its first progress write. `NULL < cutoff` is NULL in SQL and
          // never true, so the first arm cannot see it, and without this arm
          // the row holds the active slot FOREVER. `startedAt` is the
          // substitute age, and the claim always sets it. Same two-armed
          // defence the queue's lease reaper uses.
          { status: 'running', lastHeartbeatAt: null, startedAt: { lt: cutoff } },
          // THE QUEUED BACKUP NOBODY EVER CLAIMED. `createdAt` is the age —
          // not `startedAt`, which is NULL by definition on a `pending` row,
          // and not `lastHeartbeatAt`, which is NULL for the same reason: this
          // row has never claimed anything started, and a sweep that inferred
          // an age from a column the row deliberately left empty would be
          // reading its own default.
          //
          // WHAT IT ACTUALLY CATCHES: a job an administrator deleted from
          // `GET /api/admin/jobs` (the FK's `SetNull` releases the link and
          // leaves this row `pending` forever), a job queued on a deployment
          // whose worker is off (`JOBS_WORKER_MODE=off`), and a job that
          // permanently failed before its handler ever ran. Each of those
          // leaves a row that HOLDS THE SINGLE ACTIVE SLOT with nothing coming
          // to settle it — which, under the tightened index, blocks every
          // backup this deployment would ever take again.
          //
          // The window is `runStaleMinutes` (120 by default), so an ordinary
          // queue delay never trips it: a backup that has sat unclaimed for two
          // hours is not a backup that is about to run.
          { status: 'pending', createdAt: { lt: cutoff } },
        ],
      },
      // `startedAt` and `trigger` join the projection for #288: they are what
      // `db_backup.backup_failed` renders, and reading them here — in the query
      // the sweep was making anyway — is cheaper and less racy than a second
      // read after the row has been rewritten. `status` joins it for #351: the
      // compare-and-swap below has to re-assert THE STATUS THIS ROW WAS READ
      // WITH, and a literal `'running'` there would silently skip every
      // `pending` candidate the arm above just found.
      select: {
        id: true,
        status: true,
        storageKey: true,
        startedAt: true,
        trigger: true,
      },
    });

    // ONE COPY OF THE EXPLANATION PER CASE, written to the row AND carried
    // into the notification (#288). Two copies of either would be two places
    // to reword, and the email quoting something the row does not say is worse
    // than no email.
    //
    // ⚠ TWO MESSAGES, NOT ONE, because the two states fail for genuinely
    // different reasons and an operator fixes them in different places: a
    // `running` row was executing somewhere and that somewhere went away; a
    // `pending` row was never picked up at all, which is a statement about the
    // QUEUE (no worker, a deleted job) and not about any dump. Flattening them
    // into "stopped heartbeating" would send somebody looking through
    // `pg_dump` logs for a process that never existed.
    const staleMessage = (status: DatabaseBackupStatus): string =>
      status === 'pending'
        ? `The run was queued but no worker claimed its job within ` +
          `${policy.runStaleMinutes} minute(s) (databaseBackup.runStaleMinutes), so it was ` +
          'given up on to free the single active backup slot. No dump was ever started. ' +
          'Check that a worker is running (JOBS_WORKER_MODE) and that the job was not ' +
          'deleted; the next scheduled backup is the retry.'
        : `The run stopped heartbeating for more than ${policy.runStaleMinutes} ` +
          'minute(s) (databaseBackup.runStaleMinutes) and was given up on. Nothing ' +
          'observed it fail: the process executing it went away. It is not retried ' +
          'automatically; the next scheduled backup is the retry.';

    let released = 0;

    for (const candidate of candidates) {
      const message = staleMessage(candidate.status);
      // ⚠ THE ROW TRANSITION HAPPENS FIRST, AND THE ROW *IS* THE GUARD.
      //
      // A conditional `updateMany` re-asserting `status: 'running'`, not an
      // `update` by id: the read above and this write are not atomic, and the
      // interesting case is the run that FINISHED in between — a dump whose
      // heartbeat was starved by a lock wait, that then completed normally two
      // seconds later. `count === 0` means exactly that, and it must NOT be
      // stomped: overwriting a `completed` row with `stale` would discard a
      // perfectly good verified backup's record, and (worse) the object
      // cleanup below would then delete the archive it points at.
      //
      // ⚠ `candidate.status`, NOT THE LITERAL `'running'` IT USED TO BE. The
      // guard's job is to re-assert the state the row was READ in, so that a
      // row which moved on since is left alone — and since #351 that state can
      // be `pending` as well. A hard-coded `'running'` here would make every
      // `pending` candidate `count === 0` and the sweep would quietly free
      // nothing, which is the failure mode that looks exactly like working.
      const { count } = await this.prisma.databaseBackupRun.updateMany({
        where: { id: candidate.id, status: candidate.status },
        data: {
          status: 'stale',
          finishedAt: now,
          lastError: message,
        },
      });

      if (count === 0) {
        this.logger.debug(
          `Database backup run ${candidate.id} settled between the stale sweep's read ` +
            'and its write; leaving it alone.'
        );

        continue;
      }

      released += 1;

      // ⚠ AFTER THE `stale` ROW HAS COMMITTED, and only on the branch where
      // THIS process is the one that transitioned it (`count === 1` — the
      // `continue` above covers the replica that lost the race). One settled run
      // raises exactly one notification however many replicas are sweeping.
      //
      // Before the object cleanup below, deliberately: the delete is
      // best-effort and may take a while against a slow bucket, and the report
      // of the failure should not wait on the tidying-up of a partial archive.
      // `notifyPermissionHolders` is detached and never rejects, so this costs
      // the sweep nothing and cannot fail it.
      this.announceStale(candidate, message, now);

      // ⚠ AND OBJECT CLEANUP FOLLOWS, NEVER PRECEDES.
      //
      // Same ordering as the runner's failure path and the retention sweep,
      // for the same reason read the other way round: if the delete went first
      // and this process died before the row was transitioned, the row would
      // still say `running` and still point at an object that no longer
      // exists — and it would keep holding the active slot. With the row
      // first, a failed delete leaves a VISIBLE `stale` row naming an orphaned
      // object an operator can find and remove, rather than an invisible
      // billable one nothing points at.
      //
      // Best-effort, and it never fails the sweep: the slot is already free,
      // which is the part that had to happen.
      try {
        await this.storage.delete(candidate.storageKey);
      } catch (error) {
        this.logger.warn(
          `Marked database backup run ${candidate.id} stale but could not delete its ` +
            `partial object "${candidate.storageKey}"; it may need removing by hand: ` +
            `${toError(error).message}`
        );
      }
    }

    return released;
  }

  /**
   * Raise `db_backup.backup_failed` for a run this sweep gave up on. Never
   * throws.
   *
   * ⚠ `outcome: 'stale'` AND NOT `'failed'`, and the distinction is the whole
   * reason the field exists. A `failed` run reported an error: something
   * observed it break and wrote down what. A `stale` run reported nothing —
   * the process executing it went away, and the sweep is inferring the failure
   * from silence. An operator chasing the two looks in completely different
   * places (a dump's stderr versus a host that disappeared), so the message
   * says which it is rather than flattening both into "backup failed".
   *
   * SYNCHRONOUS AND FIRE-AND-FORGET: `notifyPermissionHolders` schedules the
   * audience query and the sends and returns, so a ten-minute cron never waits
   * on a mail server, and the try/catch means a notifier bug cannot abort a
   * sweep that has already freed the active slot.
   */
  private announceStale(
    run: { id: string; startedAt: Date | null; trigger: DatabaseBackupTrigger },
    reason: string,
    settledAt: Date
  ): void {
    try {
      // ANNOTATED WITH THE TEMPLATE'S TYPE: `notifyPermissionHolders` takes
      // `data: unknown`, so this is the only place the shape is checked.
      const payload: BackupFailedEmailData = {
        runId: run.id,
        outcome: 'stale',
        error: reason,
        startedAt: run.startedAt,
        failedAt: settledAt,
        trigger: run.trigger,
        appUrl: this.appUrl(),
      };

      // `db_backup:read` — the exact string `db-backup.controller.ts` enforces,
      // and the same one the runner's own failure path uses.
      // ⚠ `.catch()` DESPITE THE DISPATCHER CONTRACTING NEVER TO REJECT — same
      // reason as everywhere else this event is raised: an unhandled rejection
      // inside a `@Cron` tick has no caller, and the `try/catch` around this
      // block cannot see one.
      void this.notifications
        .notifyPermissionHolders(
          'db_backup.backup_failed',
          PERMISSIONS.DB_BACKUP_READ,
          payload
        )
        .catch((error: unknown) => {
          this.logger.error(
            `Dispatching 'db_backup.backup_failed' for run ${run.id} rejected, ` +
              `which the dispatcher contracts never to do: ${toError(error).message}`
          );
        });
    } catch (error) {
      this.logger.error(
        `Could not raise 'db_backup.backup_failed' for run ${run.id}; the run is ` +
          `still marked stale and its slot is free: ${toError(error).message}`
      );
    }
  }

  /**
   * The application root, trailing slashes trimmed, or `undefined`.
   *
   * Same shape as `UsersService.appUrl()`; `undefined` makes the template omit
   * its CTA rather than render a button that goes nowhere.
   */
  private appUrl(): string | undefined {
    const appUrl = this.config.get<string>('appUrl');
    return appUrl ? appUrl.replace(/\/+$/, '') : undefined;
  }

  /**
   * Starts a backup if the schedule says one is due and none has covered this
   * boundary.
   *
   * Exposed as its own method so a test can pin `now` — which is what makes
   * the DST and late-tick criteria testable at all — without going through the
   * kill switch and the swallowing `catch`.
   */
  async fireDueBackup(
    policy: SystemDatabaseBackupValue,
    now: Date
  ): Promise<BackupFireOutcome> {
    if (!policy.enabled) {
      // ⚠ ONLY THE FIRING IS GATED. The sweep above runs whatever this says,
      // and that asymmetry is deliberate: a run orphaned BEFORE an
      // administrator switched scheduled backups off still holds the single
      // active slot, and leaving it there would make every later MANUAL backup
      // (#283) fail with "already running" for a schedule nobody is using. The
      // setting is a statement about taking backups automatically, not about
      // cleaning up after ones that were already taken.
      this.logger.debug(
        'Scheduled database backups are disabled (databaseBackup.enabled); not firing'
      );

      return 'disabled';
    }

    const expression = backupScheduleToCron(policy);
    let boundary: Date | null;

    try {
      // THE ZONE IS ALWAYS PASSED. Omitting it evaluates the operator's
      // "02:00" in the server's zone, which in a container is UTC.
      boundary = previousFireBoundary(expression, now, policy.timezone);
    } catch (error) {
      if (error instanceof InvalidTimezoneError) {
        this.reportBadTimezone(error);

        return 'bad_timezone';
      }

      // Anything else (an expression outside the supported subset) is a bug in
      // `backupScheduleToCron`, not a configuration mistake, and must stay
      // loud: it reaches the tick's `catch` and is logged as an error.
      throw error;
    }

    // The zone works. Clear the latch so a LATER failure of the same zone is
    // reported again rather than swallowed by a stale one.
    this.reportedBadTimezone = null;

    if (boundary === null) {
      // Nothing due inside `SCHEDULE_SEARCH_LIMIT_DAYS`. Not reachable from
      // any expression `backupScheduleToCron` emits (every one of them fires
      // at least monthly), so this is the honest answer to a case that should
      // not happen rather than a case worth logging about.
      return 'not_due';
    }

    // "Has anything started since this schedule last came due?" — the whole
    // anti-double-fire rule, in one indexed query against `startedAt DESC`.
    // `startedAt: { not: null }` because a row that never started says nothing
    // about whether a window was covered.
    //
    // ⚠ #351 MADE `startedAt` NULL FOR A WHILE, AND THIS QUERY IS DELIBERATELY
    // UNCHANGED. A queued backup's run row is created `pending` with no
    // `startedAt`, and stays that way until a worker claims the job — so
    // between the enqueue and the claim this query cannot see it, and a tick
    // in that window will decide the boundary is still uncovered and fire
    // again. That is safe, and fixing it here would be worse than the problem:
    // the second fire is collapsed by the queue's CONSTANT dedup key (the
    // enqueue returns the job already in flight, `queueBackup` raises
    // `DatabaseBackupAlreadyRunningError`, and the branch below stands down at
    // debug level). Widening this predicate to count `pending` rows would mean
    // a run row that never gets claimed — a job deleted by an administrator,
    // say — could silently suppress every scheduled backup that came after it,
    // which is the failure this subsystem must not have. A row that never
    // started still says nothing about whether a window was covered.
    const latest = await this.prisma.databaseBackupRun.findFirst({
      where: { startedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, startedAt: true },
    });

    if (latest?.startedAt != null && latest.startedAt >= boundary) {
      this.logger.debug(
        `A database backup already covers the ${boundary.toISOString()} boundary ` +
          `(run ${latest.id} started ${latest.startedAt.toISOString()}); not firing.`
      );

      return 'not_due';
    }

    try {
      const { run, job } = await this.runner.queueBackup({
        trigger: 'scheduled',
        // No `createdById`. A timer has no user, and attributing this to the
        // last administrator who logged in would put a name on an action
        // nobody took.
      });

      this.logger.log(
        `Queued scheduled database backup ${run.id} (job ${job.id}) for the ` +
          `${boundary.toISOString()} boundary (${expression} in ${policy.timezone}).`
      );

      return 'fired';
    } catch (error) {
      if (error instanceof DatabaseBackupAlreadyRunningError) {
        // DEBUG, NOT ERROR. The single-active-run index refused a second dump,
        // which is precisely what it is for: another replica's tick got there
        // first, or a long dump from the previous window is still streaming.
        // Nothing is wrong, and logging it as an error would train an operator
        // to ignore this subsystem's errors.
        this.logger.debug(
          `A database backup is already running; the scheduler stood down: ${error.message}`
        );

        return 'already_running';
      }

      // A misconfigured storage provider, or anything else: loud, and it
      // recurs until an operator fixes it. That repetition is correct for a
      // subsystem whose failure mode is silence — no row is created when the
      // claim is refused before it happens, so this log line is the only
      // evidence that backups are not being taken.
      throw error;
    }
  }

  /**
   * Logs an unusable timezone ONCE per offending value.
   *
   * The message names the setting and what the scheduler did about it, because
   * the reader of this line has a deployment that is silently not being backed
   * up and needs both facts in one place.
   */
  private reportBadTimezone(error: InvalidTimezoneError): void {
    if (this.reportedBadTimezone === error.timezone) return;

    this.reportedBadTimezone = error.timezone;

    this.logger.error(
      `Scheduled database backups are standing down: ${error.message} Fix ` +
        'databaseBackup.timezone in system settings; nothing will be backed up on a ' +
        'schedule until it names a zone this runtime knows. (Logged once per value.)'
    );
  }

  /**
   * Whether this process schedules backups at all.
   *
   * DEFAULTS TO ON, and only the literal `false` turns it off (see
   * `configuration.ts`) — the same fail-open direction `JOBS_REAPER_ENABLED`
   * and `NODE_STALE_OFFLINE_ENABLED` take, for the same reason stated more
   * sharply here: a deployment whose backups silently stopped because of a
   * typo in an env file is indistinguishable from one that is being backed up,
   * right up until somebody needs a restore.
   *
   * It exists for the one legitimate case: several API replicas sharing one
   * database where an operator wants exactly one of them scheduling. Running
   * it everywhere is safe anyway — the active index makes the second claim a
   * no-op and the sweep re-asserts its own predicate — the switch just saves
   * the duplicated queries.
   */
  private enabled(): boolean {
    return this.config.get<boolean>('dbBackup.scheduleEnabled') !== false;
  }
}
